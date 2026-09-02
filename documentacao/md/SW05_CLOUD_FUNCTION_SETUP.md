# SW-05 — Setup da Cloud Function de PDF (Firebase) — histórico (opção descartada)

> ⚠️ **SUPERSEDIDO.** Esta opção (Cloud Function no Firebase, Puppeteer +
> Chromium embutido) foi descartada porque **exige o plano Blaze
> (pay-as-you-go) do Firebase** — cartão cadastrado, mesmo custando R$0/mês
> na prática — e você pediu uma alternativa 100% gratuita sem essa
> exigência. A abordagem atual está em
> `SW05_SUPABASE_FUNCTION_SETUP.md` (Supabase Edge Function + pdf-lib,
> sem cartão em lugar nenhum). Mantido aqui só como registro de decisão
> (por que essa opção foi cogitada e por que não seguiu adiante) — não
> execute as instruções abaixo. A credencial n8n "PDF Function MAF"
> (`httpCustomAuth`) já foi **deletada**; o código da function
> (`web/functions/index.js`) fica no repositório só como referência, não
> implantado.

Decisão original (substituía a opção de sidecar no VPS, que exigia acesso
que você não tem — ver `SW05_BROWSERLESS_SETUP.md` para o histórico): gerar
o PDF com uma **Cloud Function** rodando dentro do mesmo projeto Firebase
que já hospeda o site (`hf-maf`). Usa Puppeteer + Chromium headless
embutido (`@sparticuz/chromium`) para tirar um "print" fiel de
`relatorio.html` — visualmente idêntico ao que o cliente vê no navegador.

## Custo real

- **R$0/mês** para o volume esperado do piloto — o free tier do Cloud
  Functions (2ª geração, que roda sobre Cloud Run) cobre **2 milhões de
  invocações/mês, 400.000 GB-segundo e 200.000 GHz-segundo de computação**.
  Cada exportação de PDF consome uma fração ínfima disso.
- **Mas o Firebase exige o plano Blaze (pay-as-you-go) para implantar
  Cloud Functions** — mesmo ficando dentro do free tier, é preciso ter um
  cartão cadastrado no projeto. Isso é uma ação sua, no console do Firebase
  — eu nunca insiro dados de pagamento em lugar nenhum.

## Passo 1 (você): confirmar o plano Blaze no projeto `hf-maf`

1. Acesse https://console.firebase.google.com/project/hf-maf/usage
2. Se ainda aparecer "Spark" (gratuito), clique em "Fazer upgrade" e
   selecione **Blaze**.
3. Cadastre um cartão (exigido pelo Google mesmo para uso dentro do free
   tier) — considere configurar um **orçamento e alerta de faturamento**
   (Google Cloud Console > Faturamento > Orçamentos e alertas) como rede de
   segurança, por exemplo um alerta em R$10, para saber imediatamente se
   algo sair do esperado.

Sem esse upgrade, `firebase deploy --only functions` falha com um erro
claro pedindo o Blaze — se isso acontecer quando eu tentar implantar, vou
te avisar exatamente essa mensagem.

## Passo 2 (eu): implantar a function

Assim que o Blaze estiver ativo, eu implanto usando o mesmo mecanismo já
validado para o Hosting (Google Cloud Shell via navegador, que já vem com
Firebase CLI autenticado):

```bash
cd web
firebase functions:secrets:set PDF_SHARED_SECRET
# (vou colar o valor do segredo quando o prompt pedir -- o mesmo valor já
# gravado na credencial "PDF Function MAF" do n8n, nunca em texto plano
# neste repositório)
firebase deploy --only functions
```

A function fica publicada em:
```
https://us-central1-hf-maf.cloudfunctions.net/gerarPdfRelatorio
```
(URL já pré-configurada no node "Gerar PDF (Cloud Function)" do SW-05.)

## Segurança embutida na function (`web/functions/index.js`)

- Só aceita `POST`, e só renderiza URLs que comecem com
  `https://hf-maf.web.app/` — evita que o endpoint vire um "proxy aberto"
  de URL-para-PDF que qualquer pessoa na internet poderia abusar (risco de
  SSRF se isso não existisse).
- Exige o header `Authorization: Bearer <segredo>` — o segredo vive como
  **Firebase Secret** (`PDF_SHARED_SECRET`, gerenciado pelo Secret Manager
  do Google, nunca em texto plano no código) e como credencial `httpCustomAuth`
  "PDF Function MAF" no n8n (id `Hn0QzUy5n8ivef0L`).
- `memory: 1GiB`, `timeoutSeconds: 90` — margem para o cold start do
  Chromium embutido, que costuma ser mais lento que uma function comum.

## Ponto de atenção já documentado — página renderizada client-side

`relatorio.html` busca os dados no Supabase via JavaScript **depois** do
HTML carregar. A function já usa `waitUntil: networkidle2` + um buffer de
1.5s, o que cobre a maioria dos casos, mas não é garantia absoluta sob rede
lenta. Se algum PDF sair "em branco"/carregando, o próximo passo é
adicionar um elemento marcador em `relatorio.html` (ex.:
`<div data-relatorio-pronto>`, inserido só depois do fetch terminar) e
trocar para `page.waitForSelector(...)` no Puppeteer — mais robusto, mas
exige uma pequena alteração no HTML público. Não implementado agora para
não ampliar escopo além do pedido.

## Pendências para o SW-05 ficar 100% operacional

1. **Você**: upgrade do projeto `hf-maf` para o plano Blaze (Passo 1).
2. **Você**: abrir o node "Enviar Relatorio por Email" do SW-05 na UI do
   n8n e selecionar a credencial "Gmail MAF" (bloqueia a ativação do
   workflow inteiro, inclusive o branch de download — detalhe técnico no
   log de deploy, Seção 7.5).
3. **Você**: completar o "Connect my account" da credencial "Gmail MAF"
   (mesmo passo pendente do SW-04).
4. **Claude**: depois de 1, implantar a Cloud Function via Cloud Shell.
5. **Claude**: depois de 2 e 3, reativar o SW-05 via API.
6. **Claude**: testar ponta a ponta (download de PDF e envio por e-mail)
   contra o relatório-piloto.
