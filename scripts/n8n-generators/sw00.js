const fs = require("fs");
const path = require("path");
const { makeNode, workflow, chain, fanOut, mergeConnections, validate } = require("./lib.js");

const errorTrigger = makeNode({
  name: "Erro Capturado",
  type: "n8n-nodes-base.errorTrigger",
  typeVersion: 1,
  position: [0, 0],
  notes: "Configure este workflow como 'Error Workflow' nas Settings de SW-01, SW-02 e SW-03 (Workflow Settings > Error Workflow). O n8n dispara este trigger automaticamente sempre que qualquer um deles falhar.",
});

const formatarErro = makeNode({
  name: "Formatar Payload de Erro",
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position: [260, 0],
  params: {
    language: "javaScript",
    jsCode: `// Função pura: recebe o contexto de erro nativo do n8n (Error Trigger)
// e formata um payload estruturado e seguro para log e alerta.
// Regra de privacidade (Protocolo 7.1.2 do docx): nunca incluir dado de
// paciente ou dado sensível do respondente aqui — só metadados técnicos
// de execução (nome do workflow, id da execução, node onde falhou, mensagem).

const errorData = $input.first().json;

function formatarPayloadErro(errorData) {
  const workflowNome = errorData.workflow && errorData.workflow.name
    ? errorData.workflow.name
    : "desconhecido";
  const execucaoId = errorData.execution && errorData.execution.id
    ? String(errorData.execution.id)
    : "sem-id";
  const nodeComErro = errorData.execution && errorData.execution.lastNodeExecuted
    ? errorData.execution.lastNodeExecuted
    : "desconhecido";
  const mensagemBruta = errorData.execution && errorData.execution.error && errorData.execution.error.message
    ? errorData.execution.error.message
    : "erro sem mensagem capturada";

  return {
    timestamp: new Date().toISOString(),
    subworkflow_origem: workflowNome,
    execucao_id: execucaoId,
    status: "erro",
    payload_erro: {
      node: nodeComErro,
      // corta a mensagem para não estourar o campo jsonb nem vazar stack trace gigante
      mensagem: String(mensagemBruta).slice(0, 500),
    },
  };
}

return [{ json: formatarPayloadErro(errorData) }];`,
  },
});

const gravarLog = makeNode({
  name: "Gravar em log_auditoria",
  type: "n8n-nodes-base.httpRequest",
  typeVersion: 4.2,
  position: [560, -80],
  retryOnFail: true,
  maxTries: 3,
  waitBetweenTries: 4000,
  params: {
    method: "POST",
    url: "={{ $env.SUPABASE_URL }}/rest/v1/log_auditoria",
    authentication: "none",
    sendHeaders: true,
    headerParameters: {
      parameters: [
        { name: "apikey", value: "={{ $env.SUPABASE_SERVICE_ROLE_KEY }}" },
        { name: "Authorization", value: "=Bearer {{ $env.SUPABASE_SERVICE_ROLE_KEY }}" },
        { name: "Content-Type", value: "application/json" },
        { name: "Prefer", value: "return=minimal" },
      ],
    },
    sendBody: true,
    specifyBody: "json",
    jsonBody: "={{ JSON.stringify($json) }}",
    options: { timeout: 10000 },
  },
  notes: "Grava o erro na tabela de auditoria. Se isso falhar 3x, o próprio n8n mostra a execução como falha órfã no painel — não há um 'erro do erro' recursivo porque este workflow não tem seu próprio Error Workflow configurado (proposital).",
});

const alertaDiscord = makeNode({
  name: "Alerta Discord/Slack",
  type: "n8n-nodes-base.httpRequest",
  typeVersion: 4.2,
  position: [560, 80],
  retryOnFail: true,
  maxTries: 2,
  waitBetweenTries: 3000,
  params: {
    method: "POST",
    url: "={{ $env.ALERTA_WEBHOOK_URL }}",
    authentication: "none",
    sendBody: true,
    specifyBody: "json",
    jsonBody: `={{ JSON.stringify({
  embeds: [{
    title: "🔴 Alerta MAF-Saúde — Falha em Subworkflow",
    description: $json.payload_erro.mensagem,
    color: 15158332,
    fields: [
      { name: "Subworkflow", value: $json.subworkflow_origem, inline: true },
      { name: "Execução", value: $json.execucao_id, inline: true },
      { name: "Node", value: $json.payload_erro.node, inline: true },
      { name: "Timestamp", value: $json.timestamp, inline: false }
    ]
  }]
}) }}`,
    options: { timeout: 10000 },
  },
  notes: "ALERTA_WEBHOOK_URL é a URL do webhook do Discord/Slack/Teams (variável de ambiente do n8n). Compatível com Discord nativamente; para Slack/Teams, adaptar o formato do body (ver README).",
});

const nodes = [errorTrigger, formatarErro, gravarLog, alertaDiscord];
const connections = mergeConnections(
  chain(errorTrigger, formatarErro),
  fanOut(formatarErro, [gravarLog, alertaDiscord])
);

const wf = workflow({
  name: "SW-00 - Error Handler (MAF-Saude)",
  nodes,
  connections,
});

const errors = validate(wf);
if (errors.length) {
  console.error("VALIDAÇÃO FALHOU:", errors);
  process.exit(1);
}

fs.writeFileSync(
  path.join(__dirname, "..", "..", "subworkflows", "SW-00-Error-Handler.json"),
  JSON.stringify(wf, null, 2)
);
console.log("OK: SW-00 gerado e validado.");
