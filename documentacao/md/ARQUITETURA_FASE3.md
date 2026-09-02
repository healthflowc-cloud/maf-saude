---
title: MAF-Saúde — Arquitetura Fase 3 (Autoatendimento + IA + Export)
status: em construção
complementa: claude/MAF-Saude_Consolidado_v1.md, claude/MAF-Saude_Deploy_Log_v1.md
---

# Arquitetura Fase 3 — Autoatendimento, Insights por IA e Export

## 1. Escopo desta fase

A Fase 1/2 (MVP "Diagnóstico Express") exigia um humano (Lucas) para: cadastrar
a instituição e o setor via SQL manual, montar o link do formulário à mão, e
não gerava narrativa nem PDF/e-mail. A Fase 3 fecha essas lacunas:

1. **Autoatendimento**: a instituição se cadastra e faz login sozinha.
2. **Link automático**: o link do formulário por setor é gerado e exibido no
   dashboard, sem SQL manual.
3. **Insights por IA**: narrativa consultiva gerada automaticamente a partir
   do IAO calculado (via Gemini, API gratuita do Google).
4. **Export**: a instituição exporta o relatório em PDF ou manda por e-mail,
   pelo próprio sistema.

## 2. Decisão de arquitetura: nem tudo precisa passar pelo n8n

**Isto é a decisão mais importante desta fase, e por isso vem antes da lista
de subworkflows.** O reflexo natural seria criar um subworkflow n8n para
"cadastro" e outro para "gerenciar setor" — mas cadastro/login/CRUD de setor
são operações de posse (quem é dono de qual linha), e o Postgres já resolve
isso nativamente via **RLS + Supabase Auth**, sem precisar de uma camada de
orquestração no meio:

- Cadastro = `supabase.auth.signUp()` (o próprio SDK do Supabase, direto do
  browser) + 1 `insert` autenticado em `instituicoes` (RLS garante
  `owner_user_id = auth.uid()` — ver `sql/003_auth_instituicoes.sql`).
- Gerenciar setor = `select`/`insert`/`update`/`delete` autenticado em
  `setores`, protegido por RLS via join com `instituicoes.owner_user_id`.
- Link do formulário = **não existe como dado gravado** — é calculado no
  próprio browser a partir de `token_acesso` (já existe) + `setor.id` (já
  existe): `${FORM_BASE_URL}/formulario.html?token=...&setor=...`.

**Por que isso é a escolha certa, não um atalho**: cada subworkflow n8n a
mais é mais uma superfície pra auditar, mais um ponto de falha, mais uma
credencial pra rotacionar. RLS já é o mecanismo de segurança que este
projeto usa desde o MVP (ver comentário em `config.js`: "a proteção real é a
Row Level Security no Postgres") — usar o mesmo mecanismo para autorização
de dono é consistência arquitetural, não improviso. **n8n fica reservado
para o que genuinamente precisa de orquestração**: chamar uma IA externa,
gerar um PDF, mandar e-mail — coisas com retry/backoff, credenciais de
terceiro e lógica de negócio, não CRUD simples.

## 3. Subworkflows novos

| Subworkflow | Dispara quando | Chama | Isolamento — por quê |
|---|---|---|---|
| **SW-04 — Gerar Insights (Gemini)** | Sob demanda (botão "Gerar análise" no dashboard) OU automaticamente logo após SW-03 gravar o relatório | Gemini API (`generativelanguage.googleapis.com`) | Gemini tem rate limit de tier gratuito e pode ficar indisponível — se fosse código dentro de SW-03, uma falha ali quebraria a gravação do relatório numérico, que é o dado mais crítico. Separado, o pior caso é "relatório sem narrativa ainda" — nunca "relatório não gravado". |
| **SW-05 — Exportar Relatório (PDF + E-mail)** | Sob demanda (botões "Exportar PDF" / "Enviar por e-mail" no dashboard) | Serviço de PDF (Chromium headless) + Gmail API | Duas dependências externas diferentes (renderização de PDF, envio de e-mail via OAuth Google) isoladas do pipeline de cálculo — uma falha aqui nunca deve poder corromper ou atrasar `iao_calculado`/`relatorios_diagnostico`. |

Ambos usam `settings.errorWorkflow → SW-00` (mesmo padrão dos demais), e
ambos devem ser **subworkflows on-demand** (trigger por webhook autenticado
chamado pelo dashboard), não automáticos no pipeline principal — decisão
consciente: gerar insights por IA e mandar e-mail tem custo/quota, não deve
rodar automaticamente pra todo período calculado sem o usuário pedir.

**Autorização do webhook do SW-04/SW-05**: o dashboard envia o
`access_token` da sessão Supabase Auth do usuário logado junto com o
`relatorio_id`. O node HTTP Request que lê `relatorios_diagnostico` dentro
do subworkflow usa esse token (não a service_role key) como
`Authorization: Bearer` — a RLS de `owner_select_relatorios` (migração 003)
garante que só o dono enxerga a linha. Se o PostgREST devolver vazio, o
subworkflow responde 403 sem nunca ter tido acesso irrestrito. Isso evita
reimplementar verificação de posse em JavaScript dentro do n8n — a mesma
regra de negócio (RLS) vale nos dois lugares (frontend e n8n).

## 4. Estrutura de diretórios (atualizada da Fase 1/2)

```
/Projetos/MAF-Saude/
├── subworkflows/          # SW-00..03 (existentes) + SW-04, SW-05 (novos, .json)
├── sql/                   # 001, 002 (existentes) + 003_auth_instituicoes.sql (novo)
├── web/public/
│   ├── formulario.html    # existente, sem mudança de lógica
│   ├── relatorio.html     # existente, sem mudança de lógica
│   ├── login.html         # novo
│   ├── cadastro.html      # novo
│   ├── dashboard.html     # novo — setores, link do form, histórico, export
│   └── config.js          # existente + GEMINI_WEBHOOK_URL / EXPORT_WEBHOOK_URL
├── documentacao/
│   ├── pdf/
│   └── md/                # este arquivo + demais
├── historico/
└── divulgacao/
    ├── posts/
    └── assets/
```

## 5. Fluxo de dados ponta a ponta (Fase 3 completa)

```
[cadastro.html] --signUp+insert(RLS)--> [instituicoes/setores]
        |
        v
[dashboard.html] --calcula no browser--> link do formulário por setor
        |
        v
[formulario.html] --(pipeline já testado)--> SW-01 -> SW-02 -> SW-03
        |                                                        |
        |                                          grava relatorios_diagnostico
        v
[dashboard.html] <--RLS owner_select_relatorios-- lista relatórios do dono
        |
        +--(botão "Gerar análise")--> webhook SW-04 --> Gemini --> grava narrativa
        |
        +--(botão "Exportar PDF")----> webhook SW-05 --> Chromium headless --> PDF
        |
        +--(botão "Enviar e-mail")---> webhook SW-05 --> Gmail API --> envia
```

## 6. Autorização (resumo — detalhe completo em `sql/003_auth_instituicoes.sql`)

- `instituicoes.owner_user_id` liga a instituição ao `auth.users` do
  Supabase Auth.
- Dono: `select`/`update` completo da própria instituição (via RLS +
  grants de coluna — `token_acesso`/`owner_user_id`/`ativo` nunca são
  atualizáveis pelo próprio dono, só leitura).
- Dono: CRUD completo dos próprios `setores`, leitura do histórico de
  `iao_calculado`/`relatorios_diagnostico` dos próprios setores.
- `respostas_validadas`: **sem nenhum acesso para o dono, de propósito** —
  preserva a promessa de anonimato agregado já feita ao respondente no
  próprio texto do formulário público.
- **Correção de segurança incluída**: o `grant select on instituicoes to
  anon` de nível de TABELA do MVP (001_init_mvp.sql) expunha
  `token_acesso` de qualquer instituição a qualquer cliente anônimo via
  PostgREST (`?select=token_acesso`) — RLS não filtra coluna, só linha.
  Migração 003 troca isso por `grant select (id, nome, porte, ativo)`,
  fechando a exposição antes de abrir cadastro público (mais
  instituições = mais incentivo pra alguém tentar).

## 7. Pendências que precisam de decisão/provisionamento do usuário

Estas três coisas **não podem ser resolvidas de dentro desta sessão** —
dependem de contas/credenciais do usuário:

1. **Gemini API**: precisa de uma API key gratuita gerada em
   [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
   Atenção: os limites do tier gratuito (requisições/minuto,
   requisições/dia) mudam com frequência — confirmar o limite atual antes
   de assumir quanto volume o SW-04 aguenta sem cair em erro 429. n8n não
   tem credencial nativa pra Gemini — vai ser `httpCustomAuth` como já
   usamos pro Supabase, ou header `x-goog-api-key`.
2. **Gmail API**: diferente de uma API key simples — precisa de um projeto
   no Google Cloud Console com OAuth consent screen configurado e
   credencial OAuth2 Client ID/Secret. A boa notícia: **n8n tem um node
   Gmail nativo com credencial OAuth2 pronta** (bem mais simples que o
   `HTTP Request` cru pro Microsoft Graph que o fluxo de referência usa
   pra Outlook) — só precisa que o usuário crie o app OAuth no Google Cloud
   e autorize uma vez pela UI do n8n.
3. **Hospedagem do Chromium headless (geração de PDF)**: preciso saber se
   o VPS onde o n8n self-hosted roda (`n8n.tangramhub.com.br`) permite
   instalar um serviço adicional (ex.: um pequeno serviço Node+Puppeteer
   rodando como sidecar) — só o dono da infra sabe responder isso. Se não
   der, a alternativa gratuita mais viável é uma Cloud Function/Cloud Run
   (tier gratuito do Google Cloud, mas exige ativar faturamento no projeto
   GCP mesmo permanecendo dentro da cota grátis).

Enquanto essas três pendências não são resolvidas, o restante da Fase 3
(SQL, páginas de cadastro/login/dashboard) pode ser construído e testado
normalmente — os botões de "Gerar análise"/"Exportar PDF"/"Enviar e-mail"
ficam com o endpoint como placeholder em `config.js`, no mesmo padrão já
usado no MVP para Supabase/n8n.
