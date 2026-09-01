// Módulo de montagem do relatório (SW-03). Puramente de apresentação/tradução
// dos números já calculados por SW-02 (calculo_iao_logic.js) em texto para o
// Diagnóstico Express (Pacote 1 — "só questionário + dashboard", Seção 11 do
// consolidado). NÃO recalcula IAO — assume que o registro de iao_calculado
// já veio pronto do Supabase.
//
// Rótulos e ações copiados literalmente da Tabela "5 Níveis Oficiais de
// Maturidade" (Seção 4 do MAF-Saude_Consolidado_v1.md) para manter
// rastreabilidade com o documento oficial — qualquer mudança de texto deve
// ser feita nos DOIS lugares.

const NIVEIS_MATURIDADE = {
  1: { status: "Risco Iminente / Colapso Operacional", perfil_radar: "🔴 Âncora", acao: "Reengenharia total ou troca de software (imediato)" },
  2: { status: "Adoção Dolorosa (Burnout)", perfil_radar: "🟠 Distorcido", acao: "Mutirão Lean: reduzir cliques/pop-ups (SLA 72h)" },
  3: { status: "Estabilidade Burocrática", perfil_radar: "🟡 Simétrico central", acao: "Integrações via API, suporte à decisão clínica" },
  4: { status: "Fluidez Operacional", perfil_radar: "🔵 Balão (base)", acao: "Sustentação e escuta contínua" },
  5: { status: "Selo Padrão Ouro MAF / Aderência Orgânica", perfil_radar: "🟢 Balão (alto)", acao: "Certificação + Employer Branding" },
};

// Rótulos do Fator de Criticidade Setorial (FCS — Seção 6, Lacuna 3). Escala
// DIFERENTE e independente da escala de nivel_maturidade acima — mesmo nome
// "nível" para duas coisas distintas é uma armadilha de leitura conhecida do
// projeto; o relatório deixa isso explícito com rótulos próprios.
const NIVEIS_CRITICIDADE = {
  1: "Administrativo",
  2: "Assistencial Eletivo",
  3: "Urgência / Intensiva (Alta Criticidade)",
};

// Bloco com pior média = maior alavanca de melhoria de curto prazo — heurística
// simples (não é análise de causalidade), documentada como tal no README.
const NOMES_BLOCOS = {
  VC: "Valor Clínico Percebido",
  UI: "Usabilidade Invisível",
  FD: "Fricção Digital",
  CC: "Carga Cognitiva",
};

function identificarBlocoMaisFraco(iaoRow) {
  // VC e UI: quanto MAIOR, melhor (forças de impulso). FD e CC: quanto MENOR,
  // melhor (forças de atrito) — então normalizamos para "quanto esse bloco
  // está puxando o IAO para baixo", numa escala comum onde maior = pior.
  const impulso = { VC: 5 - iaoRow.vc_medio, UI: 5 - iaoRow.ui_medio }; // inverso: nota baixa em VC/UI é ruim
  const atrito = { FD: iaoRow.fd_medio, CC: iaoRow.cc_medio }; // nota alta em FD/CC é ruim
  const candidatos = { ...impulso, ...atrito };
  let piorBloco = null;
  let piorValor = -Infinity;
  for (const [bloco, valor] of Object.entries(candidatos)) {
    if (valor > piorValor) {
      piorValor = valor;
      piorBloco = bloco;
    }
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
          ? `${NOMES_BLOCOS[blocoMaisFraco]} está com a média mais baixa relativa aos demais — é a maior alavanca de melhoria de curto prazo (heurística por bloco, não é análise de causalidade).`
          : `${NOMES_BLOCOS[blocoMaisFraco]} está com a média mais alta (mais atrito) relativa aos demais — é a maior alavanca de melhoria de curto prazo (heurística por bloco, não é análise de causalidade).`,
    },
    acao_recomendada: nivelInfo.acao,
    alerta: {
      deve_alertar: iaoRow.deve_alertar === true,
      limiar_aplicado: iaoRow.limiar_aplicado,
    },
    amostra: {
      n_respondentes: iaoRow.n_respondentes,
      status_amostral: iaoRow.status_amostral,
      inconclusivo,
      aviso: inconclusivo
        ? "Amostra abaixo do piso técnico mínimo do MVP (5 respondentes) — resultado é indicativo, não conclusivo. O piso científico oficial do Protocolo 7.2.2 (n≥30 ou ≥30% do quadro do setor) exige volume de piloto ainda maior."
        : null,
    },
    gerado_em: new Date().toISOString(),
  };
}

module.exports = { montarRelatorio, identificarBlocoMaisFraco, NIVEIS_MATURIDADE, NIVEIS_CRITICIDADE, NOMES_BLOCOS };
