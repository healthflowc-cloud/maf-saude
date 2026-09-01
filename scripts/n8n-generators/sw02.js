const fs = require("fs");
const path = require("path");
const { makeNode, workflow, chain, fanOut, ifBranch, mergeConnections, validate } = require("./lib.js");

const SUPA_HEADERS = () => ({
  parameters: [
    { name: "apikey", value: "={{ $env.SUPABASE_SERVICE_ROLE_KEY }}" },
    { name: "Authorization", value: "=Bearer {{ $env.SUPABASE_SERVICE_ROLE_KEY }}" },
  ],
});

const webhook = makeNode({
  name: "Receber Trigger Calculo",
  type: "n8n-nodes-base.webhook",
  typeVersion: 2,
  position: [0, 0],
  params: {
    httpMethod: "POST",
    path: "maf-calculo-iao",
    responseMode: "onReceived",
    options: {},
  },
  notes: "URL final: https://<seu-host-n8n>/webhook/maf-calculo-iao. Chamado internamente por SW-01 (fire-and-forget) logo após gravar uma resposta — NÃO é exposto ao formulário público, então não recebe/valida token_instituicao aqui (a validação já ocorreu em SW-01). responseMode=onReceived: o n8n confirma o recebimento (HTTP 200 vazio) imediatamente e o workflow continua rodando em background, sem o chamador esperar o cálculo terminar. Configure este workflow com SW-00 como 'Error Workflow' (Settings > Error Workflow).",
});

const buscarSetor = makeNode({
  name: "Buscar Setor",
  type: "n8n-nodes-base.httpRequest",
  typeVersion: 4.2,
  position: [260, -120],
  retryOnFail: true,
  maxTries: 3,
  waitBetweenTries: 4000,
  params: {
    method: "GET",
    url: "={{ $env.SUPABASE_URL }}/rest/v1/setores",
    authentication: "none",
    sendHeaders: true,
    headerParameters: SUPA_HEADERS(),
    sendQuery: true,
    queryParameters: {
      parameters: [
        { name: "id", value: "=eq.{{ $json.body.setor_id }}" },
        { name: "select", value: "id,nivel_criticidade" },
      ],
    },
    options: { timeout: 10000 },
  },
  notes: "Busca o nível de criticidade do setor — necessário para decidir se usa a fórmula iao_critico (Protocolo 3.3 do docx) e qual limiar de alerta aplicar (SW-02 não repete a checagem de cross-tenant feita em SW-01; assume setor_id já validado).",
});

const buscarRespostas = makeNode({
  name: "Buscar Respostas do Periodo",
  type: "n8n-nodes-base.httpRequest",
  typeVersion: 4.2,
  position: [520, -120],
  retryOnFail: true,
  maxTries: 3,
  waitBetweenTries: 4000,
  params: {
    method: "GET",
    url: "={{ $env.SUPABASE_URL }}/rest/v1/respostas_validadas",
    authentication: "none",
    sendHeaders: true,
    headerParameters: SUPA_HEADERS(),
    sendQuery: true,
    queryParameters: {
      parameters: [
        { name: "setor_id", value: "=eq.{{ $('Receber Trigger Calculo').first().json.body.setor_id }}" },
        { name: "periodo", value: "=eq.{{ $('Receber Trigger Calculo').first().json.body.periodo }}" },
        { name: "select", value: "respostas" },
      ],
    },
    options: { timeout: 10000 },
  },
  notes: "Busca TODAS as respostas já gravadas para este setor+período (não só a que acabou de disparar o cálculo) — o IAO é sempre recalculado sobre a amostra completa do período, nunca incremental.",
});

const calcularIAO = makeNode({
  name: "Calcular IAO",
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position: [780, -120],
  params: {
    language: "javaScript",
    jsCode: `// Módulo de cálculo do IAO — cópia literal e testada de calculo_iao_logic.js
// (39/39 testes em test_sw02_logic.js). Se precisar alterar a fórmula, altere
// primeiro lá, rode os testes, e só então copie aqui.

const PISO_AMOSTRAL_MINIMO = 5;
// ⚠️ Isto NÃO é o piso amostral científico do Protocolo 7.2.2 do docx
// (n≥30 ou ≥30% do quadro do setor). É um piso técnico mínimo só para a
// média não ser dominada por 1-2 respondentes isolados. Ajuste esta
// constante para o piso real assim que houver volume de piloto suficiente.

function media(valores) {
  return valores.reduce((a, b) => a + b, 0) / valores.length;
}

function calcularMediasPorBloco(linhasRespostas) {
  const blocos = ["VC", "UI", "FD", "CC"];
  const medias = {};
  for (const bloco of blocos) {
    const todosValoresDoBloco = linhasRespostas.flatMap((linha) => linha.respostas[bloco]);
    medias[bloco] = media(todosValoresDoBloco);
  }
  return medias;
}

// Classificação em nível de maturidade (Seção 5.2 do docx). Interpretação
// adotada para as lacunas entre os cortes: cada nível vai até (exclusive) o
// início do próximo, sem lacuna — documentado como ponto de atenção no
// README (recomenda-se decidir isso oficialmente na calibração empírica).
function classificarNivelMaturidade(valor) {
  if (valor < 0.8) return 1;
  if (valor < 1.3) return 2;
  if (valor < 1.8) return 3;
  if (valor < 2.4) return 4;
  return 5;
}

// Limiar mínimo aceitável por nível de criticidade (Protocolo 3.3 do docx).
function limiarAlertaPorCriticidade(nivelCriticidade) {
  if (nivelCriticidade === 3) return 1.5;
  if (nivelCriticidade === 2) return 1.1;
  return 0.8;
}

function calcularIAO({ linhasRespostas, nivelCriticidade }) {
  if (!Array.isArray(linhasRespostas) || linhasRespostas.length === 0) {
    throw new Error("calcularIAO: nenhuma resposta válida encontrada para este setor/período");
  }

  const { VC, UI, FD, CC } = calcularMediasPorBloco(linhasRespostas);
  const iao = (VC + UI) / (FD + CC);
  const iaoCritico = nivelCriticidade === 3 ? (VC + UI) / (FD + CC * 2) : null;

  const nRespondentes = linhasRespostas.length;
  const statusAmostral = nRespondentes < PISO_AMOSTRAL_MINIMO ? "inconclusivo_amostra_insuficiente" : "ok";

  const valorParaClassificar = nivelCriticidade === 3 ? iaoCritico : iao;
  const nivelMaturidade = classificarNivelMaturidade(valorParaClassificar);

  const limiar = limiarAlertaPorCriticidade(nivelCriticidade);
  const deveAlertar = valorParaClassificar < limiar;

  return {
    vc_medio: Number(VC.toFixed(2)),
    ui_medio: Number(UI.toFixed(2)),
    fd_medio: Number(FD.toFixed(2)),
    cc_medio: Number(CC.toFixed(2)),
    iao: Number(iao.toFixed(2)),
    iao_critico: iaoCritico !== null ? Number(iaoCritico.toFixed(2)) : null,
    nivel_maturidade: nivelMaturidade,
    n_respondentes: nRespondentes,
    status_amostral: statusAmostral,
    deve_alertar: deveAlertar,
    valor_classificado: Number(valorParaClassificar.toFixed(2)),
    limiar_aplicado: limiar,
  };
}

// ---------------- glue com o contexto do n8n ----------------

const setorRegistros = $('Buscar Setor').first().json;
const setor = Array.isArray(setorRegistros) ? setorRegistros[0] : setorRegistros;
if (!setor) {
  throw new Error("Setor não encontrado no Supabase para o setor_id recebido — abortando cálculo de IAO (isto dispara o Error Workflow SW-00).");
}

const linhasRespostas = $input.first().json;
const resultado = calcularIAO({
  linhasRespostas: Array.isArray(linhasRespostas) ? linhasRespostas : [],
  nivelCriticidade: setor.nivel_criticidade,
});

const gatilho = $('Receber Trigger Calculo').first().json;
const bodyGatilho = gatilho.body ?? gatilho;

return [{
  json: {
    setor_id: bodyGatilho.setor_id,
    periodo: bodyGatilho.periodo,
    nivel_criticidade: setor.nivel_criticidade,
    ...resultado,
  },
}];`,
  },
});

const gravarIAO = makeNode({
  name: "Gravar IAO Calculado",
  type: "n8n-nodes-base.httpRequest",
  typeVersion: 4.2,
  position: [1040, -200],
  retryOnFail: true,
  maxTries: 3,
  waitBetweenTries: 4000,
  params: {
    method: "POST",
    url: "={{ $env.SUPABASE_URL }}/rest/v1/iao_calculado?on_conflict=setor_id,periodo",
    authentication: "none",
    sendHeaders: true,
    headerParameters: {
      parameters: [
        ...SUPA_HEADERS().parameters,
        { name: "Content-Type", value: "application/json" },
        { name: "Prefer", value: "resolution=merge-duplicates,return=representation" },
      ],
    },
    sendBody: true,
    specifyBody: "json",
    jsonBody:
      "={{ JSON.stringify({ setor_id: $json.setor_id, periodo: $json.periodo, vc_medio: $json.vc_medio, ui_medio: $json.ui_medio, fd_medio: $json.fd_medio, cc_medio: $json.cc_medio, iao: $json.iao, iao_critico: $json.iao_critico, nivel_maturidade: $json.nivel_maturidade, n_respondentes: $json.n_respondentes, status_amostral: $json.status_amostral }) }}",
    options: { timeout: 10000 },
  },
  notes: "Upsert por (setor_id, periodo) — reprocessar o mesmo período (ex.: mais respostas chegaram depois) ATUALIZA a linha existente em vez de duplicar (constraint unique(setor_id,periodo) em iao_calculado).",
});

const dispararRelatorio = makeNode({
  name: "Disparar Geracao Relatorio (fire-and-forget)",
  type: "n8n-nodes-base.httpRequest",
  typeVersion: 4.2,
  position: [1300, -200],
  onError: "continueRegularOutput",
  params: {
    method: "POST",
    url: "={{ $env.N8N_BASE_URL }}/webhook/maf-gerar-relatorio",
    authentication: "none",
    sendBody: true,
    specifyBody: "json",
    jsonBody: "={{ JSON.stringify({ setor_id: $json[0] ? $json[0].setor_id : $json.setor_id, periodo: $json[0] ? $json[0].periodo : $json.periodo }) }}",
    options: { timeout: 3000 },
  },
  notes: "Chama o webhook de SW-03 (ainda a construir) sem bloquear. onError=continueRegularOutput: se SW-03 estiver indisponível, SW-02 termina como sucesso mesmo assim — o iao_calculado já foi persistido e o relatório pode ser gerado sob demanda depois. $json[0] cobre o caso de 'Gravar IAO Calculado' retornar um array (Prefer: return=representation do Supabase); $json.setor_id cobre o caso de item único.",
});

const ifDeveAlertar = makeNode({
  name: "Deve Alertar?",
  type: "n8n-nodes-base.if",
  typeVersion: 1,
  position: [1040, 80],
  params: {
    conditions: {
      boolean: [{ value1: "={{ $json.deve_alertar }}", value2: true }],
    },
  },
  notes: "Lê deve_alertar do output de 'Calcular IAO' (branch paralela — não depende de 'Gravar IAO Calculado' ter terminado, então o alerta sai mesmo que a gravação esteja lenta).",
});

const alertaIAOCritico = makeNode({
  name: "Alerta IAO Critico",
  type: "n8n-nodes-base.httpRequest",
  typeVersion: 4.2,
  position: [1300, 80],
  retryOnFail: true,
  maxTries: 2,
  waitBetweenTries: 3000,
  onError: "continueRegularOutput",
  params: {
    method: "POST",
    url: "={{ $env.ALERTA_WEBHOOK_URL }}",
    authentication: "none",
    sendBody: true,
    specifyBody: "json",
    jsonBody: `={{ JSON.stringify({
  embeds: [{
    title: "🟠 MAF-Saúde — IAO abaixo do limiar",
    description: "Setor " + $json.setor_id + " ficou abaixo do limiar aceitável para seu nível de criticidade.",
    color: 15105570,
    fields: [
      { name: "Período", value: $json.periodo, inline: true },
      { name: "Nível de Criticidade do Setor", value: String($json.nivel_criticidade), inline: true },
      { name: "Valor Classificado", value: String($json.valor_classificado), inline: true },
      { name: "Limiar Aplicado", value: String($json.limiar_aplicado), inline: true },
      { name: "Nível de Maturidade", value: String($json.nivel_maturidade), inline: true },
      { name: "Amostra", value: $json.n_respondentes + " respondentes (" + $json.status_amostral + ")", inline: true }
    ]
  }]
}) }}`,
    options: { timeout: 10000 },
  },
  notes: "Alerta de NEGÓCIO (setor com risco de resistência/baixa maturidade), diferente do alerta TÉCNICO de SW-00 (falha de execução). onError=continueRegularOutput para não derrubar o workflow inteiro por causa de um webhook de alerta fora do ar.",
});

const nodes = [
  webhook, buscarSetor, buscarRespostas, calcularIAO,
  gravarIAO, dispararRelatorio,
  ifDeveAlertar, alertaIAOCritico,
];

const connections = mergeConnections(
  chain(webhook, buscarSetor, buscarRespostas, calcularIAO),
  fanOut(calcularIAO, [gravarIAO, ifDeveAlertar]),
  chain(gravarIAO, dispararRelatorio),
  ifBranch(ifDeveAlertar, alertaIAOCritico, null)
);

const wf = workflow({
  name: "SW-02 - Calculo do IAO (MAF-Saude)",
  nodes,
  connections,
});

const errors = validate(wf);
if (errors.length) {
  console.error("VALIDAÇÃO FALHOU:", errors);
  process.exit(1);
}

fs.writeFileSync(
  path.join(__dirname, "..", "..", "subworkflows", "SW-02-Calculo-IAO.json"),
  JSON.stringify(wf, null, 2)
);
console.log("OK: SW-02 gerado e validado. Nodes:", nodes.length);
