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
  name: "Receber Submissao",
  type: "n8n-nodes-base.webhook",
  typeVersion: 2,
  position: [0, 0],
  params: {
    httpMethod: "POST",
    path: "maf-intake",
    responseMode: "responseNode",
    options: {
      allowedOrigins: "*", // ver README: restrinja ao domínio exato do Firebase Hosting em produção
    },
  },
  notes: "URL final: https://<seu-host-n8n>/webhook/maf-intake. 'allowedOrigins: *' resolve CORS para o formulário HTML rodar em outro domínio (Firebase Hosting) — trocar por domínio específico antes de ir para produção com clientes reais.",
});

const validarEstrutura = makeNode({
  name: "Validar Estrutura do Payload",
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position: [260, 0],
  params: {
    language: "javaScript",
    jsCode: `// Função pura: valida forma e faixa de valores do payload recebido do
// formulário público. Não faz nenhuma chamada externa.
function validarEstrutura(payload) {
  const erros = [];

  if (!payload || typeof payload !== "object") {
    return { valido: false, motivo: "payload_malformado", detalhes: ["body vazio ou não é objeto"] };
  }
  if (typeof payload.token_instituicao !== "string" || payload.token_instituicao.length < 8) {
    erros.push("token_instituicao ausente ou inválido");
  }
  if (typeof payload.setor_id !== "string" || !/^[0-9a-f-]{36}$/i.test(payload.setor_id)) {
    erros.push("setor_id ausente ou não é um UUID válido");
  }
  if (typeof payload.periodo !== "string" || !/^\\d{4}-\\d{2}-\\d{2}$/.test(payload.periodo)) {
    erros.push("periodo ausente ou fora do formato AAAA-MM-DD");
  }
  if (typeof payload.respondente_hash !== "string" || payload.respondente_hash.length < 4) {
    erros.push("respondente_hash ausente");
  }

  const blocos = ["VC", "UI", "FD", "CC"];
  const respostas = payload.respostas || {};
  for (const bloco of blocos) {
    const valores = respostas[bloco];
    if (!Array.isArray(valores) || valores.length !== 4) {
      erros.push("bloco " + bloco + " ausente ou sem exatamente 4 itens");
      continue;
    }
    for (const v of valores) {
      if (!Number.isInteger(v) || v < 1 || v > 5) {
        erros.push("bloco " + bloco + " contém valor fora da escala 1-5: " + v);
      }
    }
  }

  if (erros.length > 0) {
    return { valido: false, motivo: "payload_malformado", detalhes: erros };
  }

  return {
    valido: true,
    token_instituicao: payload.token_instituicao,
    setor_id: payload.setor_id,
    periodo: payload.periodo,
    respondente_hash: payload.respondente_hash,
    respostas,
  };
}

// O n8n coloca o corpo do POST em $json.body; fallback para $json cobre
// versões/configurações onde o body já chega no nível raiz.
const entrada = $input.first().json;
const payload = entrada.body ?? entrada;
return [{ json: validarEstrutura(payload) }];`,
  },
});

const ifPayloadValido = makeNode({
  name: "Payload Valido?",
  type: "n8n-nodes-base.if",
  typeVersion: 1,
  position: [520, 0],
  params: {
    conditions: {
      boolean: [{ value1: "={{ $json.valido }}", value2: true }],
    },
  },
});

const respondErroPayload = makeNode({
  name: "Erro 400 - Payload",
  type: "n8n-nodes-base.respondToWebhook",
  typeVersion: 1.1,
  position: [780, 120],
  params: {
    respondWith: "json",
    responseCode: 400,
    responseBody: '={{ JSON.stringify({ status: "erro", motivo: $json.motivo, detalhes: $json.detalhes || [] }) }}',
  },
});

const checarStraight = makeNode({
  name: "Checar Straight-Lining",
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position: [780, -120],
  params: {
    language: "javaScript",
    jsCode: `// Função pura: detecta "straight-lining" (mesma nota nos 16 itens) —
// Protocolo 7.2.4 da metodologia. Registros assim são descartados porque
// geram contradição matemática na fórmula do IAO.
function checarStraightLining(dados) {
  const todosValores = [
    ...dados.respostas.VC,
    ...dados.respostas.UI,
    ...dados.respostas.FD,
    ...dados.respostas.CC,
  ];
  const primeiro = todosValores[0];
  const straightlining = todosValores.every((v) => v === primeiro);
  return { ...dados, straightlining };
}

return [{ json: checarStraightLining($input.first().json) }];`,
  },
});

const ifStraightlining = makeNode({
  name: "Straight-Lining Detectado?",
  type: "n8n-nodes-base.if",
  typeVersion: 1,
  position: [1040, -120],
  params: {
    conditions: {
      boolean: [{ value1: "={{ $json.straightlining }}", value2: true }],
    },
  },
});

const respondErroStraight = makeNode({
  name: "Erro 400 - Straightlining",
  type: "n8n-nodes-base.respondToWebhook",
  typeVersion: 1.1,
  position: [1300, 0],
  params: {
    respondWith: "json",
    responseCode: 400,
    responseBody: '={{ JSON.stringify({ status: "erro", motivo: "straightlining_detectado" }) }}',
  },
});

const validarToken = makeNode({
  name: "Validar Token da Instituicao",
  type: "n8n-nodes-base.httpRequest",
  typeVersion: 4.2,
  position: [1300, -240],
  retryOnFail: true,
  maxTries: 3,
  waitBetweenTries: 4000,
  params: {
    method: "GET",
    url: "={{ $env.SUPABASE_URL }}/rest/v1/instituicoes",
    authentication: "none",
    sendHeaders: true,
    headerParameters: SUPA_HEADERS(),
    sendQuery: true,
    queryParameters: {
      parameters: [
        { name: "token_acesso", value: "=eq.{{ $json.token_instituicao }}" },
        { name: "select", value: "id,nome,ativo" },
      ],
    },
    options: { timeout: 10000 },
  },
});

const checarInstituicao = makeNode({
  name: "Checar Instituicao Valida",
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position: [1560, -240],
  params: {
    language: "javaScript",
    jsCode: `// Função pura: interpreta o array retornado pelo PostgREST em
// GET /instituicoes?token_acesso=eq...
function checarInstituicao(respostaSupabase, dadosAnteriores) {
  const registros = Array.isArray(respostaSupabase) ? respostaSupabase : [];
  if (registros.length === 0) {
    return { ...dadosAnteriores, instituicao_valida: false, motivo: "token_invalido" };
  }
  const instituicao = registros[0];
  if (instituicao.ativo !== true) {
    return { ...dadosAnteriores, instituicao_valida: false, motivo: "instituicao_inativa" };
  }
  return { ...dadosAnteriores, instituicao_valida: true, instituicao_id: instituicao.id, instituicao_nome: instituicao.nome };
}

// Referenciar o node anterior PELO NOME EXATO — se renomear o node no editor,
// atualize esta referência também (ver README, seção "Convenção de nomes").
const dadosAnteriores = $('Checar Straight-Lining').item.json;
return [{ json: checarInstituicao($input.first().json, dadosAnteriores) }];`,
  },
});

const ifInstituicaoValida = makeNode({
  name: "Instituicao Valida?",
  type: "n8n-nodes-base.if",
  typeVersion: 1,
  position: [1820, -240],
  params: {
    conditions: {
      boolean: [{ value1: "={{ $json.instituicao_valida }}", value2: true }],
    },
  },
});

const respondErroToken = makeNode({
  name: "Erro 400 - Token",
  type: "n8n-nodes-base.respondToWebhook",
  typeVersion: 1.1,
  position: [2080, -120],
  params: {
    respondWith: "json",
    responseCode: 400,
    responseBody: '={{ JSON.stringify({ status: "erro", motivo: $json.motivo }) }}',
  },
});

const buscarSetor = makeNode({
  name: "Buscar Setor",
  type: "n8n-nodes-base.httpRequest",
  typeVersion: 4.2,
  position: [2080, -360],
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
        { name: "id", value: "=eq.{{ $json.setor_id }}" },
        { name: "select", value: "id,nivel_criticidade,instituicao_id" },
      ],
    },
    options: { timeout: 10000 },
  },
});

const checarSetor = makeNode({
  name: "Checar Setor Pertence a Instituicao",
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position: [2340, -360],
  params: {
    language: "javaScript",
    jsCode: `// Função pura: confere que o setor existe E pertence à MESMA instituição
// do token usado. Sem isso, um token válido de uma instituição poderia ser
// combinado com o setor_id de outra instituição (setor_id sozinho não é segredo).
function checarSetor(respostaSupabase, dadosAnteriores) {
  const registros = Array.isArray(respostaSupabase) ? respostaSupabase : [];
  if (registros.length === 0) {
    return { ...dadosAnteriores, setor_valido: false, motivo: "setor_nao_encontrado" };
  }
  const setor = registros[0];
  if (setor.instituicao_id !== dadosAnteriores.instituicao_id) {
    return { ...dadosAnteriores, setor_valido: false, motivo: "setor_nao_pertence_a_instituicao" };
  }
  return { ...dadosAnteriores, setor_valido: true, nivel_criticidade: setor.nivel_criticidade };
}

const dadosAnteriores = $('Checar Instituicao Valida').item.json;
return [{ json: checarSetor($input.first().json, dadosAnteriores) }];`,
  },
});

const ifSetorValido = makeNode({
  name: "Setor Valido?",
  type: "n8n-nodes-base.if",
  typeVersion: 1,
  position: [2600, -360],
  params: {
    conditions: {
      boolean: [{ value1: "={{ $json.setor_valido }}", value2: true }],
    },
  },
});

const respondErroSetor = makeNode({
  name: "Erro 400 - Setor",
  type: "n8n-nodes-base.respondToWebhook",
  typeVersion: 1.1,
  position: [2860, -240],
  params: {
    respondWith: "json",
    responseCode: 400,
    responseBody: '={{ JSON.stringify({ status: "erro", motivo: $json.motivo }) }}',
  },
});

const gravarResposta = makeNode({
  name: "Gravar Resposta",
  type: "n8n-nodes-base.httpRequest",
  typeVersion: 4.2,
  position: [2860, -480],
  retryOnFail: true,
  maxTries: 3,
  waitBetweenTries: 4000,
  params: {
    method: "POST",
    url: "={{ $env.SUPABASE_URL }}/rest/v1/respostas_validadas",
    authentication: "none",
    sendHeaders: true,
    headerParameters: {
      parameters: [
        ...SUPA_HEADERS().parameters,
        { name: "Content-Type", value: "application/json" },
        { name: "Prefer", value: "return=representation" },
      ],
    },
    sendBody: true,
    specifyBody: "json",
    jsonBody:
      "={{ JSON.stringify({ setor_id: $json.setor_id, respondente_hash: $json.respondente_hash, periodo: $json.periodo, respostas: $json.respostas, flag_straightlining: false }) }}",
    options: { timeout: 10000 },
  },
  notes: "Ponto crítico de durabilidade do dado — por isso tem retry (3x/4s). Se falhar mesmo assim, o Error Workflow (SW-00) grava em log_auditoria e alerta o time.",
});

const responderSucesso = makeNode({
  name: "Responder Sucesso",
  type: "n8n-nodes-base.respondToWebhook",
  typeVersion: 1.1,
  position: [3120, -560],
  params: {
    respondWith: "json",
    responseCode: 200,
    responseBody: '={{ JSON.stringify({ status: "recebido" }) }}',
  },
  notes: "Responde ao navegador do respondente IMEDIATAMENTE após gravar a resposta bruta — não espera o cálculo do IAO nem o envio de e-mail (ver risco #2 em API_MAPEAMENTO.md).",
});

const dispararCalculo = makeNode({
  name: "Disparar Calculo IAO (fire-and-forget)",
  type: "n8n-nodes-base.httpRequest",
  typeVersion: 4.2,
  position: [3120, -400],
  onError: "continueRegularOutput",
  params: {
    method: "POST",
    url: "={{ $env.N8N_BASE_URL }}/webhook/maf-calculo-iao",
    authentication: "none",
    sendBody: true,
    specifyBody: "json",
    jsonBody: "={{ JSON.stringify({ setor_id: $json.setor_id, periodo: $json.periodo }) }}",
    options: { timeout: 3000 },
  },
  notes: "Chama o webhook do SW-02 sem bloquear a resposta ao usuário (já respondida em paralelo por 'Responder Sucesso'). onError=continueRegularOutput: mesmo se esta chamada falhar/der timeout, a execução de SW-01 termina como sucesso — o dado já está salvo em respostas_validadas, e o cálculo pode ser reprocessado depois se necessário.",
});

const nodes = [
  webhook, validarEstrutura, ifPayloadValido, respondErroPayload,
  checarStraight, ifStraightlining, respondErroStraight,
  validarToken, checarInstituicao, ifInstituicaoValida, respondErroToken,
  buscarSetor, checarSetor, ifSetorValido, respondErroSetor,
  gravarResposta, responderSucesso, dispararCalculo,
];

const connections = mergeConnections(
  chain(webhook, validarEstrutura, ifPayloadValido),
  ifBranch(ifPayloadValido, checarStraight, respondErroPayload),
  chain(checarStraight, ifStraightlining),
  ifBranch(ifStraightlining, respondErroStraight, validarToken),
  chain(validarToken, checarInstituicao, ifInstituicaoValida),
  ifBranch(ifInstituicaoValida, buscarSetor, respondErroToken),
  chain(buscarSetor, checarSetor, ifSetorValido),
  ifBranch(ifSetorValido, gravarResposta, respondErroSetor),
  fanOut(gravarResposta, [responderSucesso, dispararCalculo])
);

const wf = workflow({
  name: "SW-01 - Ingestao e Validacao (MAF-Saude)",
  nodes,
  connections,
  settings: { errorWorkflow: "" }, // preencher com o ID de SW-00 após importar (ver README)
});

const errors = validate(wf);
if (errors.length) {
  console.error("VALIDAÇÃO FALHOU:", errors);
  process.exit(1);
}

fs.writeFileSync(
  path.join(__dirname, "..", "..", "subworkflows", "SW-01-Ingestao-Validacao.json"),
  JSON.stringify(wf, null, 2)
);
console.log("OK: SW-01 gerado e validado. Nodes:", nodes.length);
