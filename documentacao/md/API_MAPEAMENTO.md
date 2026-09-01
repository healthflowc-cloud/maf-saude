---
title: MAF-Saúde v1 — Mapeamento de API e Contratos de Integração
status: MVP (Pacote 1 — Diagnóstico Express)
---

# Mapeamento de API — MVP

Este documento é o contrato técnico entre os 4 subworkflows do n8n, o Supabase, o
formulário/relatório no Firebase Hosting e os canais de alerta. Qualquer mudança de
schema ou de payload deve ser refletida aqui **antes** de mudar o código.

## 1. Webhooks n8n (os 4 subworkflows)

### 1.1. SW-01 — entrada pública (chamado pelo formulário HTML)

```
POST https://<seu-host-n8n>/webhook/maf-intake
Content-Type: application/json
```

**Body esperado (enviado por `web/public/formulario.html`):**
```json
{
  "token_instituicao": "string — token_acesso da tabela instituicoes",
  "setor_id": "uuid",
  "periodo": "2026-09-01",
  "respondente_hash": "string — SHA-256 gerado no client, ver web/public/formulario.html",
  "respostas": {
    "VC": [5, 4, 5, 4],
    "UI": [4, 4, 3, 5],
    "FD": [2, 3, 2, 2],
    "CC": [3, 2, 3, 2]
  }
}
```

**Resposta (SW-01 responde IMEDIATAMENTE, antes do cálculo do IAO rodar — ver risco #2 abaixo):**
- `200 {"status":"recebido"}`
- `400 {"status":"erro","motivo":"payload_malformado" | "straightlining_detectado" | "token_invalido" | "instituicao_inativa" | "setor_nao_encontrado" | "setor_nao_pertence_a_instituicao","detalhes":[...]}`

### 1.2. SW-02 — cálculo do IAO (chamado internamente por SW-01, fire-and-forget)

```
POST https://<seu-host-n8n>/webhook/maf-calculo-iao
Content-Type: application/json
Body: {"setor_id":"uuid","periodo":"2026-09-01"}
```
`responseMode: onReceived` — SW-01 não espera a resposta. Não é exposto ao formulário público nem revalida `token_instituicao` (assume que SW-01 já validou).

### 1.3. SW-03 — geração e entrega do relatório (chamado internamente por SW-02, fire-and-forget)

```
POST https://<seu-host-n8n>/webhook/maf-gerar-relatorio
Content-Type: application/json
Body: {"setor_id":"uuid","periodo":"2026-09-01"}
```
`responseMode: onReceived` — mesma lógica assíncrona do item 1.2.

## 2. Supabase REST (PostgREST) — usado por SW-01, SW-02, SW-03, SW-00

```
Base URL: https://<project-ref>.supabase.co/rest/v1/
Headers (todas as chamadas, sempre via credencial "Supabase MAF" no n8n):
  apikey: <SUPABASE_SERVICE_ROLE_KEY>
  Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
  Content-Type: application/json
```
> **Nunca** usar a `anon key` nos subworkflows n8n — sempre `service_role`, que
> bypassa RLS. A `anon key` é só para o `web/public/relatorio.html` (client-side).

| Operação | Método/Rota | Header extra | Usado por |
|---|---|---|---|
| Validar token da instituição | `GET /instituicoes?token_acesso=eq.<token>&select=id,nome,ativo` | — | SW-01 |
| Buscar setor (validação cross-tenant) | `GET /setores?id=eq.<setor_id>&select=id,nivel_criticidade,instituicao_id` | — | SW-01 |
| Gravar resposta | `POST /respostas_validadas` | `Prefer: return=representation` | SW-01 |
| Buscar setor (nível de criticidade p/ fórmula) | `GET /setores?id=eq.<setor_id>&select=id,nivel_criticidade` | — | SW-02 |
| Buscar respostas do período | `GET /respostas_validadas?setor_id=eq.<id>&periodo=eq.<periodo>&select=respostas` | — | SW-02 |
| Gravar/atualizar IAO | `POST /iao_calculado?on_conflict=setor_id,periodo` | `Prefer: resolution=merge-duplicates,return=representation` | SW-02 |
| Buscar IAO + contexto p/ relatório (embedding PostgREST) | `GET /iao_calculado?setor_id=eq.<id>&periodo=eq.<periodo>&select=*,setores(nome,nivel_criticidade,instituicoes(nome,email_contato))` | — | SW-03 |
| Gravar/atualizar relatório | `POST /relatorios_diagnostico?on_conflict=setor_id,periodo` | `Prefer: resolution=merge-duplicates,return=representation` | SW-03 |
| Gravar log de erro | `POST /log_auditoria` | `Prefer: return=minimal` | SW-00 |
| **Ler relatório (client-side, chave `anon`, não `service_role`)** | `GET /relatorios_diagnostico?setor_id=eq.<id>&periodo=eq.<periodo>&select=conteudo,gerado_em` | `apikey`/`Authorization` com **SUPABASE_ANON_KEY** | `web/public/relatorio.html` |

> A última linha é a ÚNICA chamada REST feita fora do n8n (direto do navegador do
> gestor que abre o link do relatório). Todas as outras usam a `service_role key`
> dentro dos subworkflows. Ver `sql/002_relatorios.sql` para a policy RLS que libera
> essa leitura anônima especificamente em `relatorios_diagnostico`.

**Paginação:** nenhuma consulta do MVP retorna mais do que algumas dezenas de linhas
(um setor por vez), então paginação (`Range`/`limit`/`offset` do PostgREST) não é
necessária agora. **Vira necessária no v2** quando o Data Pool/Benchmarking (Apêndice
B.3 do docx) passar a consultar múltiplas instituições de uma vez — não implementar
isso agora, só não esquecer de revisitar.

**Rate limits:** o Supabase não documenta um limite fixo de req/s no REST para o
plano Free/Pro além dos limites gerais de conexão do compute add-on contratado. Para
o volume do MVP (algumas dezenas de submissões/dia, poucas instituições-piloto),
isso não é gargalo. Fica registrado como **ponto a monitorar quando o número de
clientes crescer** — não algo a resolver agora.

## 3. Alerta estruturado (Discord/Slack/Teams) — SW-00 e SW-03

```
POST https://discord.com/api/webhooks/<id>/<token>
Content-Type: application/json
```
```json
{
  "embeds": [{
    "title": "🔴 Alerta MAF-Saúde",
    "description": "<mensagem>",
    "color": 15158332,
    "fields": [
      {"name": "Subworkflow", "value": "SW-02-Calculo-IAO", "inline": true},
      {"name": "Execução", "value": "{{execution_id}}", "inline": true},
      {"name": "Timestamp", "value": "{{iso timestamp}}", "inline": false}
    ]
  }]
}
```
**Rate limit do Discord:** 30 requisições/minuto por webhook. O volume de alertas do
MVP (erros + IAO abaixo do limiar crítico) fica muito abaixo disso — sem risco.

## 4. E-mail (SW-03)

Requer credencial SMTP configurada no n8n (host, porta, usuário, senha/app password
do provedor que a Weknow já usa). Sem API HTTP própria — usa o node nativo "Send
Email" do n8n.

---

## Riscos e gargalos identificados nesta etapa (proativo, não pedido)

1. **CORS no Webhook do n8n:** o formulário público vai rodar em
   `https://<seu-projeto>.web.app` (Firebase Hosting) e postar via `fetch()` para o
   webhook do n8n, que está em outro domínio. Isso é uma requisição cross-origin. O
   node Webhook do SW-01 já vem com `allowedOrigins: "*"` (ver
   `subworkflows/SW-01-Ingestao-Validacao.json`) para resolver isso — **mas isso
   libera qualquer origem**. Antes de operar com clientes reais, trocar `"*"` pelo
   domínio exato do Firebase Hosting (ex.: `https://maf-saude.web.app`).
2. **Cadeia assíncrona SW-01 → SW-02 → SW-03:** os três não rodam em cadeia
   síncrona (o mesmo request HTTP esperando os três terminarem), o que arriscaria
   timeout no navegador do respondente se o SMTP do SW-03 demorar. **Decisão de
   arquitetura:** SW-01 responde ao formulário imediatamente após validar e gravar
   a resposta bruta, e dispara SW-02 via HTTP fire-and-forget
   (`onError: continueRegularOutput`, timeout curto de 3s); SW-02 faz o mesmo para
   disparar SW-03. O respondente nunca espera o cálculo do IAO nem o envio de
   e-mail. Efeito colateral aceito no MVP: se SW-02/SW-03 falharem silenciosamente
   depois do "fire", não há retry automático da cadeia — só o registro em
   `log_auditoria` via SW-00. Reprocessamento é manual (rechamar o webhook com o
   mesmo `setor_id`/`periodo` — os dois passos são idempotentes via upsert).
3. **Token da instituição exposto no client-side:** como o formulário é HTML
   estático (sem backend próprio), o `token_instituicao` fica visível no código-fonte
   da página e no payload da requisição (inspecionável via DevTools). Isso não expõe
   dado de paciente nem dado sensível — na pior hipótese, alguém com o link do
   formulário de outra instituição poderia enviar respostas falsas para o setor
   dela. Mitigação para o MVP: cada instituição tem um token próprio (rotacionável
   trocando `token_acesso` na tabela), e o link do formulário não é público/indexado.
   **Não é adequado para v2 com muitos clientes simultâneos** — nesse ponto, migrar
   para autenticação por link assinado com expiração (JWT de curta duração emitido
   sob demanda), não reaproveitar este mecanismo.
4. **`respondente_hash` gerado no client:** gerado em `web/public/formulario.html`
   como SHA-256 de `setor_id + identificador aleatório persistido em localStorage`
   — não é PII, só uma heurística de deduplicação por navegador (não é controle de
   segurança nem pseudonimização real de identidade). Requer contexto seguro
   (HTTPS) para `crypto.subtle` funcionar — Firebase Hosting já serve tudo em
   HTTPS por padrão, então isso não é um risco em produção, mas É a razão pela
   qual testar essas páginas abrindo o arquivo `.html` direto no navegador
   (`file://`) falha silenciosamente; use um servidor local (`python3 -m http.server`)
   para testar antes do deploy.
5. **Relatório lido direto do navegador com a chave `anon`:** diferente das outras
   chamadas (sempre via n8n com `service_role`), `web/public/relatorio.html` chama o
   Supabase diretamente do navegador do gestor. Isso é seguro **somente** porque a
   RLS de `relatorios_diagnostico`, `iao_calculado`, `setores` e `instituicoes`
   libera exclusivamente `select` (nunca insert/update/delete) — ver
   `sql/001_init_mvp.sql` e `sql/002_relatorios.sql`. Qualquer nova coluna sensível
   adicionada a essas 4 tabelas no futuro fica **automaticamente exposta** a quem
   tiver a `anon key` (que é pública, embutida em `config.js`) — revisar RLS
   sempre que o schema dessas tabelas mudar.
