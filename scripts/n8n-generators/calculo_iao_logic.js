// Módulo de cálculo do IAO — extraído como arquivo próprio para poder ser
// unit-testado isoladamente (test_sw02_logic.js) antes de ser colado dentro
// do Code node do n8n (sw02.js). Mantenha as duas cópias em sincronia.

const PISO_AMOSTRAL_MINIMO = 5;
// ⚠️ Isto NÃO é o piso amostral científico do Protocolo 7.2.2 do docx
// (n≥30 ou ≥30% do quadro do setor). É um piso técnico mínimo só para a
// média não ser dominada por 1-2 respondentes isolados. Ajuste esta
// constante para o piso real assim que houver volume de piloto suficiente
// — documentado também no README como pendência consciente do MVP.

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

// Classificação em nível de maturidade (Seção 5.2 do docx). A tabela original
// tem lacunas entre os cortes (0,8–1,2 / 1,3–1,7 / 1,8–2,3 / >2,4) sem
// definir o que ocorre em 1,25 ou 2,35. Interpretação adotada aqui — cada
// nível vai até (exclusive) o início do próximo, sem lacuna — e documentada
// como ponto de atenção no README (recomenda-se decidir isso oficialmente
// na calibração empírica, Seção 12 item 1 do docx).
function classificarNivelMaturidade(valor) {
  if (valor < 0.8) return 1;
  if (valor < 1.3) return 2;
  if (valor < 1.8) return 3;
  if (valor < 2.4) return 4;
  return 5;
}

// Limiar mínimo aceitável por nível de criticidade (Protocolo 3.3 do docx).
// Nível 3 (alta criticidade) tem o corte mais rígido: abaixo de 1,5 dispara alerta.
function limiarAlertaPorCriticidade(nivelCriticidade) {
  if (nivelCriticidade === 3) return 1.5;
  if (nivelCriticidade === 2) return 1.1;
  return 0.8; // nível 1 (administrativo) — só alerta em colapso total
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

module.exports = { calcularIAO, classificarNivelMaturidade, limiarAlertaPorCriticidade, calcularMediasPorBloco, PISO_AMOSTRAL_MINIMO };
