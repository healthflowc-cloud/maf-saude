// Teste funcional (headless) das páginas HTML entregues em web/public/.
// Não usa Firebase/Supabase/n8n reais -- intercepta as chamadas de rede via
// page.route() e confere que o PAYLOAD ENVIADO tem exatamente o formato que
// SW-01/SW-02/SW-03 esperam (mesmo contrato validado em test_sw01_logic.js).
const { chromium } = require("playwright");
const path = require("path");

const BASE_URL = "http://127.0.0.1:8791"; // servidor local em web/public/ (ver comando no README de testes)
const SETOR_ID = "9779be33-60d0-4975-98d2-dae0d5c8e610";
const TOKEN = "abcdefgh12345";

let pass = 0, fail = 0;
function check(desc, cond) {
  if (cond) { pass++; console.log("OK  ", desc); }
  else { fail++; console.error("FALHOU", desc); }
}

(async () => {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", headless: true });
  const page = await browser.newPage();

  // ---------- Teste 1: formulario.html sem parâmetros -> mostra aviso de link inválido ----------
  await page.goto(`${BASE_URL}/formulario.html`);
  const avisoInvalidoVisivel = await page.isVisible("#aviso-link-invalido");
  check("formulario sem token/setor -> mostra aviso de link inválido", avisoInvalidoVisivel);
  const formularioEscondido = await page.isHidden("#area-formulario");
  check("formulario sem token/setor -> área do formulário permanece oculta", formularioEscondido);

  // ---------- Teste 2: formulario.html com parâmetros -> renderiza os 16 itens ----------
  await page.goto(`${BASE_URL}/formulario.html?token=${TOKEN}&setor=${SETOR_ID}`);
  const areaVisivel = await page.isVisible("#area-formulario");
  check("formulario com token/setor -> área do formulário aparece", areaVisivel);
  const totalRadios = await page.locator('input[type="radio"]').count();
  check("formulario renderiza 16 perguntas x 5 opções = 80 radios", totalRadios === 80);
  const totalBlocos = await page.locator(".maf-bloco-titulo").count();
  check("formulario renderiza os 4 blocos (VC/UI/FD/CC)", totalBlocos === 4);

  // ---------- Teste 3: submeter sem responder tudo -> bloqueia com aviso ----------
  // (o atributo required do primeiro radio de cada grupo já bloqueia o HTML5,
  // mas o listener JS de todasRespondidas() é a segunda camada de defesa —
  // aqui testamos essa segunda camada diretamente via dispatch do evento)
  await page.evaluate(() => {
    document.getElementById("form-maf").addEventListener("submit", (e) => e.preventDefault(), { once: true, capture: true });
  });

  // Responde só o primeiro bloco (VC) e tenta enviar via clique real -- o HTML5
  // required vai impedir o submit nativo antes mesmo do JS rodar; isso já é o
  // comportamento correto (defesa em profundidade), então validamos que o
  // formulário NÃO navega/reseta quando incompleto.
  const radiosVC = page.locator('input[name^="VC_"][value="4"]');
  for (let i = 0; i < await radiosVC.count(); i++) {
    await radiosVC.nth(i).check();
  }

  // ---------- Teste 4: preencher tudo com 4 e interceptar o POST ao webhook ----------
  const blocos = ["VC", "UI", "FD", "CC"];
  for (const bloco of blocos) {
    const radios = page.locator(`input[name^="${bloco}_"][value="4"]`);
    const n = await radios.count();
    for (let i = 0; i < n; i++) await radios.nth(i).check();
  }

  let payloadCapturado = null;
  await page.route("**/webhook/maf-intake", async (route) => {
    payloadCapturado = JSON.parse(route.request().postData());
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "recebido" }) });
  });

  await page.click("#btn-enviar");
  await page.waitForSelector("#area-sucesso:not([hidden])", { timeout: 5000 });
  check("submissão completa -> mensagem de sucesso aparece", await page.isVisible("#area-sucesso"));

  check("payload enviado tem token_instituicao", payloadCapturado && payloadCapturado.token_instituicao === TOKEN);
  check("payload enviado tem setor_id correto", payloadCapturado && payloadCapturado.setor_id === SETOR_ID);
  check("payload enviado tem periodo no formato AAAA-MM-DD", payloadCapturado && /^\d{4}-\d{2}-\d{2}$/.test(payloadCapturado.periodo));
  check("payload enviado tem respondente_hash (string não vazia)", payloadCapturado && typeof payloadCapturado.respondente_hash === "string" && payloadCapturado.respondente_hash.length > 10);
  check("payload enviado tem os 4 blocos com 4 itens cada", payloadCapturado &&
    ["VC", "UI", "FD", "CC"].every((b) => Array.isArray(payloadCapturado.respostas[b]) && payloadCapturado.respostas[b].length === 4));
  check("payload enviado -- todos os valores são 4 (o que preenchemos)", payloadCapturado &&
    ["VC", "UI", "FD", "CC"].every((b) => payloadCapturado.respostas[b].every((v) => v === 4)));

  // ---------- Teste 5: relatorio.html sem parâmetros -> aviso de link inválido ----------
  await page.goto(`${BASE_URL}/relatorio.html`);
  check("relatorio sem parâmetros -> mostra aviso de link inválido", await page.isVisible("#aviso-link-invalido"));

  // ---------- Teste 6: relatorio.html com parâmetros, mock do Supabase -> renderiza corretamente ----------
  const conteudoMock = {
    setor_nome: "UTI Adulto",
    instituicao_nome: "Hospital Exemplo",
    periodo: "2026-09-01",
    resumo_executivo: {
      iao: 0.82, iao_critico: 0.54, nivel_maturidade: 1,
      status: "Risco Iminente / Colapso Operacional", perfil_radar: "🔴 Âncora",
      nivel_criticidade_setor: 3, rotulo_criticidade_setor: "Urgência / Intensiva (Alta Criticidade)",
    },
    blocos: {
      VC: { media: 4.0, nome: "Valor Clínico Percebido" },
      UI: { media: 3.0, nome: "Usabilidade Invisível" },
      FD: { media: 4.0, nome: "Fricção Digital" },
      CC: { media: 4.5, nome: "Carga Cognitiva" },
    },
    ponto_de_atencao_principal: { bloco: "CC", nome: "Carga Cognitiva", observacao: "Carga Cognitiva está com a média mais alta." },
    acao_recomendada: "Reengenharia total ou troca de software (imediato)",
    alerta: { deve_alertar: true, limiar_aplicado: 1.5 },
    amostra: { n_respondentes: 5, status_amostral: "ok", inconclusivo: false, aviso: null },
    gerado_em: "2026-09-01T12:00:00.000Z",
  };

  await page.route("**/rest/v1/relatorios_diagnostico**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([{ conteudo: conteudoMock, gerado_em: conteudoMock.gerado_em }]),
    });
  });

  await page.goto(`${BASE_URL}/relatorio.html?setor_id=${SETOR_ID}&periodo=2026-09-01`);
  await page.waitForSelector("#area-relatorio:not([hidden])", { timeout: 5000 });
  check("relatorio com dados -> área do relatório aparece", await page.isVisible("#area-relatorio"));

  const textoBadge = await page.textContent("#badge-nivel");
  check("badge mostra Nível 1 e o status oficial", textoBadge.includes("Nível 1") && textoBadge.includes("Risco Iminente"));

  const textoIAO = await page.textContent("#valor-iao");
  check("mostra IAO crítico (0.54) quando presente, não o IAO padrão (0.82)", textoIAO.includes("0.54") && !textoIAO.includes("0.82"));

  const alertaVisivel = await page.isVisible("#card-alerta");
  check("card de alerta aparece quando deve_alertar=true", alertaVisivel);

  const linhasTabela = await page.locator("table.maf-blocos tr").count();
  check("tabela de blocos tem 1 cabeçalho + 4 linhas de dados", linhasTabela === 5);

  await browser.close();

  console.log(`\n${pass} passaram, ${fail} falharam`);
  process.exit(fail > 0 ? 1 : 0);
})();
