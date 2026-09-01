---
title: MAF-Saúde v1 — Diagnóstico Express (MVP)
versao: 1.0.0
data: 2026-09-01
autor: Lucas Lemes — Analista de Governança, Compliance e Automação (Weknow Healthtech)
classificacao: Interno / Confidencial
---

# README Técnico — MAF-Saúde v1 (MVP "Diagnóstico Express")

## 1. Objetivo do fluxo e sistemas envolvidos

Este pacote implementa o **Pacote 1 — Diagnóstico Express** do modelo MAF-Saúde
(metodologia proprietária que unifica UTAUT, TAM e Lean Healthcare — ver
`MAF-Saude_Consolidado_v1.md` no Projeto): um questionário de 16 itens que mede a
aderência tecnológica de um setor hospitalar em 4 construtos (VC, UI, FD, CC),
calcula o Índice de Aderência Orgânica (IAO), classifica o setor num de 5 níveis de
maturidade e entrega um relatório de diagnóstico automático — sem intervenção manual
entre a resposta do profissional de saúde e a leitura do gestor.

**Escopo desta versão (decisão de escopo registrada com o usuário):** só o
questionário → cálculo → relatório. Ficam FORA do v1, propositalmente: Data Pool /
Benchmarking entre instituições, Selo MAF, multi-tenant com múltiplos planos, e
qualquer coleta de perguntas de perfil (cargo/tempo de casa) — o schema de dados do
MVP não tem onde guardar essas últimas.

**Sistemas envolvidos:**

| Sistema | Papel neste projeto |
|---|---|
| **n8n** | Orquestração — 4 subworkflows (SW-00 a SW-03), ver Seção 2 |
| **Supabase (Postgres + PostgREST)** | Banco de dados + API REST automática + Row Level Security |
| **Firebase Hosting** | Hospeda o formulário público (`formulario.html`) e a página de relatório (`relatorio.html`) — sites estáticos, sem backend próprio |
| **GitHub** | Versionamento deste pacote (subworkflows, SQL, frontend, documentação) |
| **Discord/Slack/Teams (webhook)** | Canal de alerta estruturado — falhas técnicas (SW-00) e alertas de negócio (IAO abaixo do limiar, SW-02) |
| **SMTP** | Notificação por e-mail ao gestor quando o relatório fica pronto (SW-03) |

## 2. Estrutura de Diretórios e Subworkflows

```
Projetos/MAF-Saude/
├── subworkflows/                      # JSONs importáveis no n8n (Import from File)
│   ├── SW-00-Error-Handler.json       #  4 nodes — Error Workflow central
│   ├── SW-01-Ingestao-Validacao.json  # 18 nodes — recebe e valida respostas do formulário
│   ├── SW-02-Calculo-IAO.json         #  8 nodes — calcula IAO/IAO_crítico e classifica maturidade
│   └── SW-03-Geracao-Relatorio.json   #  5 nodes — monta o relatório, grava, envia e-mail
│
├── documentacao/
│   ├── pdf/
│   │   └── DOCUMENTACAO_TECNICA.pdf   # versão formal, para assinatura/auditoria
│   └── md/
│       ├── README.md                  # este arquivo
│       └── API_MAPEAMENTO.md          # contrato técnico completo (endpoints, payloads, riscos)
│
├── historico/                         # changelogs e logs de execução (ver Seção 6)
│
├── divulgacao/
│   ├── posts/                         # textos prontos para LinkedIn (Tarefa 19)
│   └── assets/                        # briefs de banner/imagem (Tarefa 19)
│
├── sql/
│   ├── 001_init_mvp.sql               # schema completo (5 tabelas + RLS), testado em Postgres 16 real
│   └── 002_relatorios.sql             # migração aditiva: tabela relatorios_diagnostico + RLS
│
├── scripts/
│   └── n8n-generators/                # FONTE DA VERDADE dos JSONs de subworkflows/ — ver README próprio
│       ├── lib.js, sw00.js..sw03.js   # geradores (rodar `node swNN.js` regrava o JSON correspondente)
│       ├── calculo_iao_logic.js       # fórmula do IAO (39 testes unitários)
│       ├── report_logic.js            # narrativa do relatório (19 testes unitários)
│       └── test_*.js                  # 71 testes unitários + teste funcional headless do frontend
│
└── web/
    ├── firebase.json                  # config do Firebase Hosting
    ├── .firebaserc                    # id do projeto Firebase (placeholder — trocar antes do deploy)
    └── public/
        ├── index.html                 # página institucional (não usada no fluxo real)
        ├── formulario.html            # questionário de 16 itens → POST em SW-01
        ├── relatorio.html             # leitura do relatório → GET direto no Supabase (anon key)
        ├── style.css                  # estilo compartilhado
        └── config.js                  # placeholders de URL/chave — TROCAR antes do deploy
```

### 2.1. Arquitetura de subworkflows — por que cada um é isolado

Cada subworkflow tem uma responsabilidade única e uma fronteira de falha própria —
decisão deliberada de governança, não só estilo de código:

- **SW-00 (Error Handler):** configurado como *Error Workflow* dos outros três
  (Settings → Error Workflow, em cada um). Centraliza log de auditoria e alerta —
  se amanhã o canal de alerta mudar de Discord para Teams, muda-se **um** node, não
  quatro workflows.
- **SW-01 (Ingestão e Validação):** é o ÚNICO subworkflow exposto ao público
  (o formulário HTML fala só com ele). Isola toda a superfície de ataque/validação
  de entrada num único lugar auditável — os outros três nunca recebem dado bruto
  não validado.
- **SW-02 (Cálculo do IAO):** isola a fórmula matemática (Protocolo 3.3 do docx)
  num módulo que pode ser testado unitariamente sem precisar simular um POST HTTP
  completo — ver `gen_n8n/calculo_iao_logic.js` e `test_sw02_logic.js` (39 testes).
  Recalcula sempre a amostra completa do período — nunca incremental — para nunca
  divergir do que está em `respostas_validadas`.
- **SW-03 (Geração do Relatório):** isola a TRADUÇÃO dos números em narrativa
  (rótulos, ação recomendada) — ver `gen_n8n/report_logic.js` e
  `test_sw03_logic.js` (19 testes). Separar isso do cálculo (SW-02) significa que
  mudar o TEXTO do relatório nunca arrisca alterar a MATEMÁTICA do IAO, e vice-versa.

**Encadeamento:** SW-01 → (fire-and-forget) → SW-02 → (fire-and-forget) → SW-03.
Nenhum usa o node nativo "Execute Workflow" do n8n (que exigiria fixar o ID interno
de cada workflow — só conhecido DEPOIS do import, inviável para "pacotes prontos
para importar"). Em vez disso, cada subworkflow chama o **webhook público** do
próximo via HTTP Request comum. Ver `documentacao/md/API_MAPEAMENTO.md` para os 3
contratos de webhook.

## 3. Pré-requisitos

### 3.1. Variáveis de ambiente do n8n

Configurar em **Settings → Environment Variables** (self-hosted) ou nas variáveis
do ambiente de execução, ANTES de ativar os workflows:

| Variável | Usada por | Exemplo |
|---|---|---|
| `SUPABASE_URL` | SW-00, SW-01, SW-02, SW-03 | `https://xxxxxxxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | SW-00, SW-01, SW-02, SW-03 | (Project Settings → API → `service_role`, **secreta**) |
| `N8N_BASE_URL` | SW-01 (dispara SW-02), SW-02 (dispara SW-03) | `https://n8n.seudominio.com.br` (sem barra final) |
| `ALERTA_WEBHOOK_URL` | SW-00 (alerta técnico), SW-02 (alerta de negócio) | URL do webhook do Discord/Slack/Teams |
| `SMTP_FROM_EMAIL` | SW-03 | `diagnostico@weknowhealthtech.com.br` |
| `FIREBASE_REPORT_BASE_URL` | SW-03 (monta o link do e-mail) | `https://maf-saude.web.app` |

### 3.2. Credenciais do n8n (Credentials store, não são env vars)

| Subworkflow | Credencial necessária | Observação |
|---|---|---|
| SW-00 | Nenhuma (só env vars) | — |
| SW-01 | Nenhuma (só env vars) | Webhook público — sem autenticação de credencial, a validação é o `token_instituicao` no payload |
| SW-02 | Nenhuma (só env vars) | Webhook interno |
| SW-03 | **SMTP** (nome sugerido: "SMTP MAF-Saude") | **O n8n NÃO importa credenciais de dentro do JSON por segurança.** Após importar `SW-03-Geracao-Relatorio.json`, abra o node "Enviar Email de Notificacao" e religue manualmente a credencial SMTP (host/porta/usuário/senha do provedor da Weknow) |

### 3.3. Webhooks a publicar (checklist pós-import)

Depois de importar os 4 JSONs e **ativar** (toggle "Active") cada workflow, confirme
que as 3 URLs abaixo respondem (mesmo que só com o handshake HTTP, sem payload):

1. `POST {N8N_BASE_URL}/webhook/maf-intake` — pública, usada por `formulario.html`
2. `POST {N8N_BASE_URL}/webhook/maf-calculo-iao` — interna (SW-01 → SW-02)
3. `POST {N8N_BASE_URL}/webhook/maf-gerar-relatorio` — interna (SW-02 → SW-03)

### 3.4. Supabase

1. Rodar `sql/001_init_mvp.sql` no SQL Editor do projeto (uma vez).
2. Rodar `sql/002_relatorios.sql` logo em seguida (idempotente, pode rodar de novo se precisar).
3. Cadastrar a primeira instituição-piloto (comando no final de `001_init_mvp.sql`) e guardar o `token_acesso` retornado.
4. Cadastrar os setores da instituição (`insert into public.setores ...`), guardando os `id` (UUID) de cada um.

### 3.5. Firebase Hosting

1. Editar `web/public/config.js` com `SUPABASE_URL`, `SUPABASE_ANON_KEY` (a chave
   **anon**, pública — nunca a `service_role`) e `N8N_BASE_URL`.
2. Editar `web/.firebaserc` com o ID real do projeto Firebase.
3. `firebase deploy --only hosting` a partir da pasta `web/`.
4. Montar o link de cada setor: `https://<seu-projeto>.web.app/formulario.html?token=<token_acesso>&setor=<setor_id>`.

## 4. Mapeamento De-Para — Input/Output por módulo

### SW-01 — Ingestão e Validação

| Etapa (node) | Input | Output |
|---|---|---|
| Receber Submissao (Webhook) | `POST` do formulário (ver payload na Seção 1.1 de `API_MAPEAMENTO.md`) | `{ body: {...} }` |
| Validar Estrutura do Payload | `body` bruto | `{ valido, motivo?, detalhes?, token_instituicao, setor_id, periodo, respondente_hash, respostas }` |
| Checar Straight-Lining | saída acima | `{ ...mesmo objeto, straightlining: bool }` |
| Validar Token / Checar Instituição | `token_instituicao` + resposta do Supabase | `{ instituicao_valida, instituicao_id, instituicao_nome, motivo? }` |
| Buscar Setor / Checar Setor | `setor_id` + `instituicao_id` (proteção cross-tenant) | `{ setor_valido, nivel_criticidade, motivo? }` |
| Gravar Resposta | `setor_id, respondente_hash, periodo, respostas` | linha inserida em `respostas_validadas` |
| Responder Sucesso | — | `200 {"status":"recebido"}` ao navegador |
| Disparar Calculo IAO | `setor_id, periodo` | `POST` fire-and-forget para SW-02 |

### SW-02 — Cálculo do IAO

| Etapa (node) | Input | Output |
|---|---|---|
| Receber Trigger Calculo (Webhook) | `{ setor_id, periodo }` | — |
| Buscar Setor | `setor_id` | `[{ id, nivel_criticidade }]` |
| Buscar Respostas do Periodo | `setor_id, periodo` | `[{ respostas: {VC,UI,FD,CC} }, ...]` (todas as respostas do período) |
| Calcular IAO | as duas saídas acima | `{ setor_id, periodo, nivel_criticidade, vc_medio, ui_medio, fd_medio, cc_medio, iao, iao_critico, nivel_maturidade, n_respondentes, status_amostral, deve_alertar, valor_classificado, limiar_aplicado }` |
| Gravar IAO Calculado | objeto acima | upsert em `iao_calculado` |
| Deve Alertar? → Alerta IAO Critico | `deve_alertar` | `POST` no webhook de alerta (se `true`) |
| Disparar Geracao Relatorio | `setor_id, periodo` | `POST` fire-and-forget para SW-03 |

### SW-03 — Geração e Entrega do Relatório

| Etapa (node) | Input | Output |
|---|---|---|
| Receber Trigger Relatorio (Webhook) | `{ setor_id, periodo }` | — |
| Buscar IAO e Contexto | `setor_id, periodo` | linha de `iao_calculado` com `setores`/`instituicoes` embutidos (PostgREST embedding) |
| Montar Relatorio | linha acima | `{ setor_id, periodo, email_contato, relatorio: {resumo_executivo, blocos, ponto_de_atencao_principal, acao_recomendada, alerta, amostra, gerado_em} }` |
| Gravar Relatorio | `relatorio` | upsert em `relatorios_diagnostico` |
| Enviar Email de Notificacao | `email_contato`, dados do relatório | e-mail HTML com link para `relatorio.html` |

### SW-00 — Error Handler

| Etapa (node) | Input | Output |
|---|---|---|
| Erro Capturado (Error Trigger) | contexto de erro nativo do n8n (workflow, execução, node, mensagem) | — |
| Formatar Payload de Erro | contexto acima | `{ timestamp, subworkflow_origem, execucao_id, status: "erro", payload_erro: {node, mensagem} }` |
| Gravar em log_auditoria / Alerta Discord | objeto acima | linha em `log_auditoria` + mensagem no canal de alerta |

## 5. Plano de manutenção preventiva

| O que monitorar | Como | Periodicidade |
|---|---|---|
| Execuções com falha em qualquer subworkflow | Painel de execuções do n8n + tabela `log_auditoria` (`status='erro'`) | **Diária** |
| Alertas de negócio (setor abaixo do limiar) | Canal Discord/Slack/Teams configurado em `ALERTA_WEBHOOK_URL` | **Diária** (reativo, chega em tempo real) |
| Taxa de resposta por instituição/setor (meta ≥60%, ver docx Seção 8) | Contagem manual em `respostas_validadas` vs. quadro de funcionários informado pelo cliente | **Semanal** durante a coleta ativa de cada cliente |
| Registros com `status_amostral = 'inconclusivo_amostra_insuficiente'` | Query em `iao_calculado` | **Semanal** — indica que o relatório entregue é indicativo, não conclusivo |
| Validade da credencial SMTP (token/senha expira) | Teste de envio manual ou log de falha em "Enviar Email de Notificacao" | **Mensal** |
| Calibração dos limiares do IAO (0,8/1,3/1,8/2,4) — hoje arbitrários (Seção 12 do docx) | Revisão junto com dados reais de piloto acumulados | **Trimestral**, assim que houver volume |
| Revisão de RLS/GRANT sempre que o schema mudar | Reexecutar os testes de `SET ROLE anon` documentados nos comentários de `001_init_mvp.sql`/`002_relatorios.sql` | **A cada migração nova** |

## 6. Pontos críticos de atenção (consolidado — ver também `API_MAPEAMENTO.md`)

1. **CORS do Webhook SW-01 está aberto (`allowedOrigins: "*"`)** — restringir ao
   domínio exato do Firebase Hosting antes de operar com clientes reais.
2. **Segurança por obscuridade nos links de relatório e formulário** — UUIDs não
   são adivinháveis, mas também não expiram nem são revogáveis individualmente.
   Suficiente para o MVP/piloto; evoluir para link assinado/expirável antes de
   escalar para muitos clientes simultâneos.
3. **Piso amostral do MVP (`PISO_AMOSTRAL_MINIMO = 5`, em `calculo_iao_logic.js`)
   é técnico, não científico** — o piso oficial do Protocolo 7.2.2 (n≥30 ou ≥30%
   do quadro do setor) é maior. Todo relatório com amostra abaixo de 5 é marcado
   `inconclusivo_amostra_insuficiente`; entre 5 e o piso oficial, o relatório sai
   como "ok" mas ainda é estatisticamente frágil — decisão consciente de MVP,
   registrada aqui para não ser esquecida.
4. **Fronteiras de classificação de nível de maturidade** (0,8/1,3/1,8/2,4) usam
   "menor que" em cada corte — interpretação própria para preencher uma lacuna do
   docx original (que não definia o que ocorre exatamente em 1,3 ou 2,4). Ver
   comentário em `calculo_iao_logic.js`. Não é um bug; é uma decisão de engenharia
   documentada que pode ser revisada na calibração empírica futura.
5. **Cadeia assíncrona sem retry automático entre subworkflows** — se SW-02 ou
   SW-03 falharem depois de receber o "fire-and-forget", não há reprocessamento
   automático (só alerta via SW-00). Reprocessar é chamar o webhook de novo com o
   mesmo `setor_id`/`periodo` — seguro porque SW-02 e SW-03 são idempotentes
   (upsert).
6. **Credencial SMTP não sobrevive ao import do JSON** — é preciso religar
   manualmente em SW-03 após cada import numa instância nova do n8n (ver Seção 3.2).
7. **`respondente_hash` é uma heurística de UX, não uma pseudonimização real** —
   documentado em 3 lugares (código, `API_MAPEAMENTO.md`, aqui) para não ser
   confundido com um mecanismo de anonimização formal em uma eventual auditoria
   LGPD.
8. **Sem paginação nas consultas ao Supabase** — aceitável no volume do MVP (uma
   instituição-piloto, poucas dezenas de respostas por setor/período); revisitar
   antes do Data Pool/Benchmarking (v2), quando as consultas passarão a cruzar
   múltiplas instituições.

---
*Documento técnico do pacote MAF-Saude v1 (MVP). Gerado e mantido junto com o
código — qualquer mudança de schema, payload ou fórmula deve atualizar este
arquivo e `API_MAPEAMENTO.md` no mesmo commit.*
