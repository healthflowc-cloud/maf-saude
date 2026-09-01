const fs = require("fs");
const path = require("path");
const { makeNode, workflow, chain, mergeConnections, validate } = require("./lib.js");

const SUPA_HEADERS = () => ({
  parameters: [
    { name: "apikey", value: "={{ $env.SUPABASE_SERVICE_ROLE_KEY }}" },
    { name: "Authorization", value: "=Bearer {{ $env.SUPABASE_SERVICE_ROLE_KEY }}" },
  ],
});

const webhook = makeNode({
  name: "Receber Trigger Relatorio",
  type: "n8n-nodes-base.webhook",
  typeVersion: 2,
  position: [0, 0],
  params: {
    httpMethod: "POST",
    path: "maf-gerar-relatorio",
    responseMode: "onReceived",
    options: {},
  },
  notes: "URL final: https://<seu-host-n8n>/webhook/maf-gerar-relatorio. Chamado internamente por SW-02 (fire-and-forget) logo após persistir o IAO — não é exposto ao formulário público. Configure SW-00 como Error Workflow (Settings > Error Workflow).",
});

const buscarContexto = makeNode({
  name: "Buscar IAO e Contexto",
  type: "n8n-nodes-base.httpRequest",
  typeVersion: 4.2,
  position: [260, 0],
  retryOnFail: true,
  maxTries: 3,
  waitBetweenTries: 4000,
  params: {
    method: "GET",
    url: "={{ $env.SUPABASE_URL }}/rest/v1/iao_calculado",
    authentication: "none",
    sendHeaders: true,
    headerParameters: SUPA_HEADERS(),
    sendQuery: true,
    queryParameters: {
      parameters: [
        { name: "setor_id", value: "=eq.{{ $json.body.setor_id }}" },
        { name: "periodo", value: "=eq.{{ $json.body.periodo }}" },
        { name: "select", value: "*,setores(nome,nivel_criticidade,instituicoes(nome,email_contato))" },
      ],
    },
    options: { timeout: 10000 },
  },
  notes: "Usa o recurso de embedding do PostgREST (select=*,setores(...)) para trazer numa única chamada o registro de iao_calculado JUNTO com nome do setor e nome/email da instituição — evita 2 chamadas HTTP separadas.",
});

const montarRelatorio = makeNode({
  name: "Montar Relatorio",
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position: [520, 0],
  params: {
    language: "javaScript",
    jsCode: `// Cópia literal e testada de report_logic.js (19/19 testes em
// test_sw03_logic.js). Se precisar alterar rótulos/texto, altere lá, rode os
// testes, e só então copie aqui. NÃO recalcula IAO — só traduz em narrativa.

const NIVEIS_MATURIDADE = {
  1: { status: "Risco Iminente / Colapso Operacional", perfil_radar: "🔴 Âncora", acao: "Reengenharia total ou troca de software (imediato)" },
  2: { status: "Adoção Dolorosa (Burnout)", perfil_radar: "🟠 Distorcido", acao: "Mutirão Lean: reduzir cliques/pop-ups (SLA 72h)" },
  3: { status: "Estabilidade Burocrática", perfil_radar: "🟡 Simétrico central", acao: "Integrações via API, suporte à decisão clínica" },
  4: { status: "Fluidez Operacional", perfil_radar: "🔵 Balão (base)", acao: "Sustentação e escuta contínua" },
  5: { status: "Selo Padrão Ouro MAF / Aderência Orgânica", perfil_radar: "🟢 Balão (alto)", acao: "Certificação + Employer Branding" },
};

const NIVEIS_CRITICIDADE = {
  1: "Administrativo",
  2: "Assistencial Eletivo",
  3: "Urgência / Intensiva (Alta Criticidade)",
};

const NOMES_BLOCOS = { VC: "Valor Clínico Percebido", UI: "Usabilidade Invisível", FD: "Fricção Digital", CC: "Carga Cognitiva" };

function identificarBlocoMaisFraco(iaoRow) {
  const impulso = { VC: 5 - iaoRow.vc_medio, UI: 5 - iaoRow.ui_medio };
  const atrito = { FD: iaoRow.fd_medio, CC: iaoRow.cc_medio };
  const candidatos = { ...impulso, ...atrito };
  let piorBloco = null, piorValor = -Infinity;
  for (const [bloco, valor] of Object.entries(candidatos)) {
    if (valor > piorValor) { piorValor = valor; piorBloco = bloco; }
  }
  return piorBloco;
}

function montarRelatorio({ iaoRow, setorNome, instituicaoNome }) {
  if (!iaoRow || typeof iaoRow.nivel_maturidade !== "number") {
    throw new Error("montarRelatorio: registro de iao_calculado ausente ou sem nivel_maturidade");
  }
  const nivelInfo = NIVEIS_MATURIDADE[iaoRow.nivel_maturidade];
  if (!nivelInfo) {
    throw new Error("montarRelatorio: nivel_maturidade fora do intervalo 1-5: " + iaoRow.nivel_maturidade);
  }
  const rotuloCriticidade = NIVEIS_CRITICIDADE[iaoRow.nivel_criticidade] || "Não classificado";
  const blocoMaisFraco = identificarBlocoMaisFraco(iaoRow);
  const inconclusivo = iaoRow.status_amostral !== "ok";

  return {
    setor_nome: setorNome || "(setor não identificado)",
    instituicao_nome: instituicaoNome || "(instituição não identificada)",
    periodo: iaoRow.periodo,
    resumo_executivo: {
      iao: iaoRow.iao,
      iao_critico: iaoRow.iao_critico,
      valor_usado_na_classificacao: iaoRow.iao_critico !== null && iaoRow.iao_critico !== undefined ? iaoRow.iao_critico : iaoRow.iao,
      nivel_maturidade: iaoRow.nivel_maturidade,
      status: nivelInfo.status,
      perfil_radar: nivelInfo.perfil_radar,
      nivel_criticidade_setor: iaoRow.nivel_criticidade,
      rotulo_criticidade_setor: rotuloCriticidade,
    },
    blocos: {
      VC: { media: iaoRow.vc_medio, nome: NOMES_BLOCOS.VC },
      UI: { media: iaoRow.ui_medio, nome: NOMES_BLOCOS.UI },
      FD: { media: iaoRow.fd_medio, nome: NOMES_BLOCOS.FD },
      CC: { media: iaoRow.cc_medio, nome: NOMES_BLOCOS.CC },
    },
    ponto_de_atencao_principal: {
      bloco: blocoMaisFraco,
      nome: NOMES_BLOCOS[blocoMaisFraco],
      observacao:
        blocoMaisFraco === "VC" || blocoMaisFraco === "UI"
          ? NOMES_BLOCOS[blocoMaisFraco] + " está com a média mais baixa relativa aos demais — é a maior alavanca de melhoria de curto prazo (heurística por bloco, não é análise de causalidade)."
          : NOMES_BLOCOS[blocoMaisFraco] + " está com a média mais alta (mais atrito) relativa aos demais — é a maior alavanca de melhoria de curto prazo (heurística por bloco, não é análise de causalidade).",
    },
    acao_recomendada: nivelInfo.acao,
    alerta: { deve_alertar: iaoRow.deve_alertar === true, limiar_aplicado: iaoRow.limiar_aplicado },
    amostra: {
      n_respondentes: iaoRow.n_respondentes,
      status_amostral: iaoRow.status_amostral,
      inconclusivo,
      aviso: inconclusivo
        ? "Amostra abaixo do piso técnico mínimo do MVP (5 respondentes) — resultado é indicativo, não conclusivo. O piso científico oficial (Protocolo 7.2.2) exige volume de piloto ainda maior."
        : null,
    },
    gerado_em: new Date().toISOString(),
  };
}

// ---------------- glue com o contexto do n8n ----------------

const registros = $input.first().json;
const iaoRow = Array.isArray(registros) ? registros[0] : registros;
if (!iaoRow) {
  throw new Error("Nenhum registro de iao_calculado encontrado para este setor_id/periodo — abortando geração de relatório (dispara o Error Workflow SW-00).");
}

const setorEmbed = Array.isArray(iaoRow.setores) ? iaoRow.setores[0] : iaoRow.setores;
const instituicaoEmbed = setorEmbed ? (Array.isArray(setorEmbed.instituicoes) ? setorEmbed.instituicoes[0] : setorEmbed.instituicoes) : null;

const relatorio = montarRelatorio({
  iaoRow,
  setorNome: setorEmbed ? setorEmbed.nome : null,
  instituicaoNome: instituicaoEmbed ? instituicaoEmbed.nome : null,
});

return [{
  json: {
    setor_id: iaoRow.setor_id,
    periodo: iaoRow.periodo,
    email_contato: instituicaoEmbed ? instituicaoEmbed.email_contato : null,
    relatorio,
  },
}];`,
  },
});

const gravarRelatorio = makeNode({
  name: "Gravar Relatorio",
  type: "n8n-nodes-base.httpRequest",
  typeVersion: 4.2,
  position: [780, -80],
  retryOnFail: true,
  maxTries: 3,
  waitBetweenTries: 4000,
  params: {
    method: "POST",
    url: "={{ $env.SUPABASE_URL }}/rest/v1/relatorios_diagnostico?on_conflict=setor_id,periodo",
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
    jsonBody: "={{ JSON.stringify({ setor_id: $json.setor_id, periodo: $json.periodo, conteudo: $json.relatorio }) }}",
    options: { timeout: 10000 },
  },
  notes: "Upsert por (setor_id, periodo) — reprocessar o mesmo período ATUALIZA o relatório existente em vez de duplicar (constraint unique(setor_id,periodo) em relatorios_diagnostico, migração 002_relatorios.sql).",
});

const enviarEmail = makeNode({
  name: "Enviar Email de Notificacao",
  type: "n8n-nodes-base.emailSend",
  typeVersion: 2.1,
  position: [1040, -80],
  onError: "continueRegularOutput",
  credentials: {
    smtp: { id: "PLACEHOLDER_TROCAR_NO_IMPORT", name: "SMTP MAF-Saude" },
  },
  params: {
    fromEmail: "={{ $env.SMTP_FROM_EMAIL }}",
    toEmail: "={{ $('Montar Relatorio').first().json.email_contato }}",
    subject: "=Diagnóstico MAF-Saúde disponível — {{ $('Montar Relatorio').first().json.relatorio.setor_nome }}",
    emailFormat: "html",
    html: "={{ '<p>O diagnóstico do setor <b>' + $('Montar Relatorio').first().json.relatorio.setor_nome + '</b> (' + $('Montar Relatorio').first().json.periodo + ') está pronto.</p><p>Nível de maturidade: <b>' + $('Montar Relatorio').first().json.relatorio.resumo_executivo.status + '</b></p><p><a href=\\'' + $env.FIREBASE_REPORT_BASE_URL + '/relatorio.html?setor_id=' + $('Montar Relatorio').first().json.setor_id + '&periodo=' + $('Montar Relatorio').first().json.periodo + '\\'>Ver relatório completo</a></p>' }}",
    options: {},
  },
  notes: "PRECISA de credencial SMTP configurada manualmente após o import (n8n > Credentials > SMTP) — o id 'PLACEHOLDER_TROCAR_NO_IMPORT' é substituído automaticamente pelo n8n na tela de import se a credencial tiver o mesmo nome, ou precisa ser religada manualmente. onError=continueRegularOutput: falha de e-mail não deve derrubar o workflow — o relatório já foi gravado e pode ser acessado direto pelo link/página de relatório sem depender do e-mail.",
});

const nodes = [webhook, buscarContexto, montarRelatorio, gravarRelatorio, enviarEmail];
const connections = mergeConnections(
  chain(webhook, buscarContexto, montarRelatorio, gravarRelatorio, enviarEmail)
);

const wf = workflow({
  name: "SW-03 - Geracao e Entrega do Relatorio (MAF-Saude)",
  nodes,
  connections,
});

const errors = validate(wf);
if (errors.length) {
  console.error("VALIDAÇÃO FALHOU:", errors);
  process.exit(1);
}

fs.writeFileSync(
  path.join(__dirname, "..", "..", "subworkflows", "SW-03-Geracao-Relatorio.json"),
  JSON.stringify(wf, null, 2)
);
console.log("OK: SW-03 gerado e validado. Nodes:", nodes.length);
