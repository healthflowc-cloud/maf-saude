// ============================================================================
// MAF-Saude -- Cloud Function "gerarPdfRelatorio" (Fase 3, SW-05)
// Por que existe: o SW-05 precisa converter a pagina publica relatorio.html
// em PDF. A opcao mais barata seria um sidecar Browserless/Chromium no
// mesmo VPS do n8n -- mas o usuario nao tem acesso a esse VPS. Segunda
// opcao mais economica que fica DENTRO do que o usuario ja tem (Firebase,
// onde o site ja esta hospedado): uma Cloud Function com Chromium headless
// embutido (@sparticuz/chromium + puppeteer-core), rodando sob demanda --
// custo real R$0/mes para o volume do piloto (dentro do free tier de 2M
// invocacoes/mes do plano Blaze). Requer o projeto Firebase estar no plano
// Blaze (pay-as-you-go) para poder implantar Cloud Functions -- upgrade
// feito pelo proprio usuario no console (cartao nunca passa por aqui).
//
// Seguranca: este endpoint SO aceita renderizar URLs do proprio dominio
// hf-maf.web.app (evita virar um proxy aberto de "URL -> PDF" que qualquer
// um na internet poderia abusar -- risco de SSRF se nao fosse restrito) e
// exige um header Authorization: Bearer <segredo> que so o n8n conhece
// (guardado como Firebase Secret, nunca em texto plano no repo).
// ============================================================================

const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const chromium = require("@sparticuz/chromium");
const puppeteer = require("puppeteer-core");

const PDF_SHARED_SECRET = defineSecret("PDF_SHARED_SECRET");

const URL_PERMITIDA_PREFIXO = "https://hf-maf.web.app/";

exports.gerarPdfRelatorio = onRequest(
  {
    region: "us-central1",
    memory: "1GiB",
    timeoutSeconds: 90,
    secrets: [PDF_SHARED_SECRET],
    cors: false, // chamado servidor-a-servidor pelo n8n, nao por navegador
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json({ status: "erro", motivo: "method_not_allowed" });
      return;
    }

    const authHeader = req.get("Authorization") || "";
    const esperado = `Bearer ${PDF_SHARED_SECRET.value()}`;
    if (authHeader !== esperado) {
      res.status(401).json({ status: "erro", motivo: "nao_autorizado" });
      return;
    }

    const url = req.body && req.body.url;
    if (typeof url !== "string" || !url.startsWith(URL_PERMITIDA_PREFIXO)) {
      res.status(400).json({
        status: "erro",
        motivo: "url_invalida_ou_fora_do_dominio_permitido",
        prefixo_exigido: URL_PERMITIDA_PREFIXO,
      });
      return;
    }

    let browser;
    try {
      browser = await puppeteer.launch({
        args: chromium.args,
        defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath(),
        headless: chromium.headless,
      });

      const page = await browser.newPage();
      await page.goto(url, { waitUntil: "networkidle2", timeout: 45000 });

      // relatorio.html busca os dados no Supabase via JS DEPOIS do HTML
      // carregar -- networkidle2 cobre a maioria dos casos, este buffer
      // extra e uma rede de seguranca pragmatica. Ver nota de hardening
      // futuro no README do projeto (waitForSelector com marcador na
      // pagina seria mais robusto, nao implementado agora).
      await new Promise((resolve) => setTimeout(resolve, 1500));

      const pdfBuffer = await page.pdf({
        format: "A4",
        printBackground: true,
        margin: { top: "12mm", bottom: "12mm", left: "10mm", right: "10mm" },
      });

      res.set("Content-Type", "application/pdf");
      res.status(200).send(pdfBuffer);
    } catch (err) {
      console.error("Erro ao gerar PDF do relatorio:", err);
      res.status(500).json({
        status: "erro",
        motivo: "falha_geracao_pdf",
        detalhe: String((err && err.message) || err),
      });
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }
);
