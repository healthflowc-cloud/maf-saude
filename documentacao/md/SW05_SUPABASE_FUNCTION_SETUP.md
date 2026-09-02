# SW-05 — Setup da Edge Function de PDF (Supabase) — decisão atual

Decisão final (3ª e definitiva), substitui as duas opções anteriores:

1. Sidecar Browserless/Chromium no VPS do n8n — descartada porque você não
   tem acesso a esse VPS (`SW05_BROWSERLESS_SETUP.md`).
2. Cloud Function no Firebase (Puppeteer + Chromium embutido) — descartada
   porque exige o plano **Blaze** (pay-as-you-go), com cartão cadastrado
   mesmo custando R$0/mês na prática, e você pediu uma alternativa **100%
   gratuita** sem essa exigência (`SW05_CLOUD_FUNCTION_SETUP.md`).

Solução atual: **Supabase Edge Function** (`gerar-pdf-relatorio`), rodando
no mesmo projeto Supabase que já hospeda o banco (`swdiulaxutckfccgeyyo`).
Sem VPS, sem cartão, sem vendor novo.

## Por que não é um "print" da página, e sim um PDF gerado em código

As duas opções anteriores renderizavam `relatorio.html` num navegador
headless e tiravam um "print". A Edge Function do Supabase roda em
**Deno**, que não tem suporte confiável para embutir/rodar Chromium
headless dentro do sandbox do Edge Runtime. Por isso a function **constrói
o PDF programaticamente**, com a biblioteca `pdf-lib` (import
`npm:pdf-lib@1.17.1`, suportado nativamente pelo Deno) — desenhando texto,
barras e cores diretamente nas páginas do PDF, sem depender de navegador.

**Trade-off aceito e documentado**: isso é uma segunda implementação do
layout do relatório, separada de `relatorio.html`. Se o layout do relatório
mudar (novo bloco, novo texto, nova cor), os dois lugares precisam ser
atualizados — `relatorio.html` (versão web/client-side) e
`supabase/functions/gerar-pdf-relatorio/index.ts` (versão PDF). Não há
solução automática para isso sem voltar a depender de um navegador headless
em algum lugar pago.

## Custo real: R$0/mês, sem cartão

- Free tier de Edge Functions do Supabase: **500.000 invocações/mês**
  (fonte: supabase.com/pricing). O volume esperado do piloto é uma fração
  ínfima disso.
- Diferente do Firebase Blaze, o tier gratuito do Supabase **não exige
  cartão cadastrado** para publicar Edge Functions — este é o motivo
  principal da escolha, atendendo diretamente ao seu pedido.

## Autenticação: reaproveita a credencial já existente, sem segredo novo

Por padrão, toda Edge Function do Supabase fica atrás do **gateway da
plataforma** com `verify_jwt = true`: uma requisição sem um JWT válido no
header `Authorization` é rejeitada pelo próprio Supabase, **antes** do
código da function rodar. Isso significa que o n8n pode chamar a function
usando a **mesma credencial "Supabase MAF"** (`httpCustomAuth`, service
role, id `5vXuC6cfVPwkjmWO`) já usada no SW-04 para gravar insights — não
foi criada nenhuma credencial nova, nenhum segredo novo, nada para você
gerenciar além do que já existe.

## O que a function recebe e devolve

- **Entrada** (`POST`, corpo JSON): `{ conteudo, insights? }` — o mesmo
  objeto `conteudo` já gravado em `relatorios_diagnostico.conteudo` (ver
  `scripts/n8n-generators/report_logic.js` para a forma exata:
  `resumo_executivo`, `blocos` com siglas VC/UI/FD/CC, `ponto_de_atencao_principal`,
  `acao_recomendada`, `amostra.inconclusivo/aviso`) e, opcionalmente, o
  `insights` gerado pelo SW-04 (Gemini) para incluir uma seção extra de
  "Análise gerada por IA" no PDF.
- **Saída de sucesso**: bytes do PDF, `Content-Type: application/pdf`.
- **Erros**: JSON com `status 400` (payload inválido/faltando
  `resumo_executivo`/`blocos`), `405` (método diferente de POST) ou `500`
  (erro interno ao montar o PDF).

## Cadeia no SW-05 (workflow `EkgaZcsGZWcijAXq`)

Webhook → busca o relatório com RLS do usuário chamador (agora selecionando
também `insights,insights_gerado_em`) → normalização → IF encontrado/não →
(não) 403 / (sim) **"Montar Payload do PDF"** monta `{conteudo, insights}`
+ metadados (nomes, período, ação, e-mail destino, link de referência para
a versão online) → **"Gerar PDF (Supabase Edge Function)"** faz o `POST`
para `https://swdiulaxutckfccgeyyo.supabase.co/functions/v1/gerar-pdf-relatorio`
com a credencial "Supabase MAF", resposta como binário → recompõe `json`
(resgatando os campos de `Montar Payload do PDF`, mesmo padrão de resgate
usado no resto do projeto) → IF ação = download: responde o PDF direto;
senão: monta e-mail e envia via Gmail com o PDF anexado → responde 200.

## ✅ Status: implantada e ativa

Publicada via editor inline do dashboard da Supabase (`Functions > Deploy
a new function > Via Editor`, colando o código e clicando em "Deploy
function" com automação de navegador, depois de você logar no dashboard).
O deploy via CLI a partir do ambiente cloud desta sessão não funcionou
(`403` do firewall de saída do ambiente ao tentar alcançar
`api.supabase.com`) — não é um problema da sua conta nem do token, é uma
restrição de rede do ambiente. Se algum dia eu precisar redeployar de novo
e você não estiver disponível para logar no navegador, a Opção A abaixo
(CLI na sua própria máquina) continua valendo.

**URL em produção**:
`https://swdiulaxutckfccgeyyo.supabase.co/functions/v1/gerar-pdf-relatorio`

**Teste rápido** (rode no seu terminal, não depende de navegador nem de
sessão logada — só da chave anon, que já está em `web/public/config.js`):

```bash
curl -sS -X POST "https://swdiulaxutckfccgeyyo.supabase.co/functions/v1/gerar-pdf-relatorio" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <SUPABASE_ANON_KEY>" \
  -H "apikey: <SUPABASE_ANON_KEY>" \
  -o teste-relatorio.pdf \
  -d '{"conteudo":{"setor_nome":"Teste","instituicao_nome":"Hospital Teste","periodo":"2026-08","resumo_executivo":{"iao":3.4,"nivel_maturidade":3,"status":"Em desenvolvimento","rotulo_criticidade_setor":"Médio"},"blocos":{"VC":{"media":3.1,"nome":"Valor e Competencia"},"UI":{"media":3.8,"nome":"Usabilidade e Interface"},"FD":{"media":2.5,"nome":"Fricção e Dependência"},"CC":{"media":2.0,"nome":"Custo e Complexidade"}},"ponto_de_atencao_principal":{"nome":"Fricção e Dependência","observacao":"Teste."},"acao_recomendada":"Teste."}}'
```

Se `teste-relatorio.pdf` abrir normalmente, a function está 100% operante.

**Pendência menor, não bloqueante**: adicionei suporte a CORS no código
local (`OPTIONS` + headers `Access-Control-Allow-*`, commit `f9cdc6a`) para
permitir testar a function direto de um navegador — mas o redeploy dessa
versão ainda não foi feito (a sessão do dashboard expirou no meio da
tentativa). Não afeta o uso real: o n8n chama a function servidor-a-servidor,
sem CORS envolvido. Assim que você logar de novo no dashboard eu completo
esse redeploy.

**Opção A — deploy via CLI na sua própria máquina** (se precisar redeployar
sem depender de navegador):

```bash
npm install -g supabase
```

Salve o `index.ts` atualizado (posso reenviar) em
`supabase/functions/gerar-pdf-relatorio/index.ts`. Depois, na pasta que
**contém** a pasta `supabase/`:

```bash
# Windows PowerShell:
$env:SUPABASE_ACCESS_TOKEN="<seu personal access token>"
# Linux/Mac:
export SUPABASE_ACCESS_TOKEN=<seu personal access token>

supabase functions deploy gerar-pdf-relatorio --project-ref swdiulaxutckfccgeyyo --use-api
```

## Pendências para o SW-05 ficar 100% operacional

1. ✅ **Concluído**: Edge Function implantada e ativa.
2. **Você**: abrir o node "Enviar Relatorio por Email" do SW-05 na UI do
   n8n e selecionar a credencial "Gmail MAF" (bloqueia a ativação do
   workflow inteiro, inclusive o branch de download — detalhe técnico no
   log de deploy, Seção 7.5).
3. **Você**: completar o "Connect my account" da credencial "Gmail MAF"
   (mesmo passo pendente do SW-04).
4. **Claude**: depois de 2 e 3, reativar o SW-05 via API.
5. **Claude**: testar ponta a ponta (download de PDF e envio por e-mail)
   contra o relatório-piloto — isso também serve como teste real da Edge
   Function, sem precisar do `curl` manual acima.

## Risco documentado

`pdf-lib` não tem quebra de linha/parágrafo embutida — foi escrita uma
função própria (`quebrarLinhas`/`escreverParagrafo`, medindo a largura do
texto com `font.widthOfTextAtSize`) para isso. É um padrão comum e
necessário para essa biblioteca, mas significa que ajustes finos de
tipografia (kerning, hifenização) não têm o mesmo polimento de um
navegador renderizando HTML/CSS — aceitável para um relatório de
diagnóstico, não para um documento de marketing.
