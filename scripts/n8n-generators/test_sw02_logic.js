// Testa as funções puras de cálculo do IAO (SW-02) fora do n8n.
// Mesma lógica de calculo_iao_logic.js -- se corrigir um bug aqui, corrija
// também lá (e depois re-cole no jsCode do sw02.js).

const {
  calcularIAO,
  classificarNivelMaturidade,
  limiarAlertaPorCriticidade,
  calcularMediasPorBloco,
  PISO_AMOSTRAL_MINIMO,
} = require("./calculo_iao_logic.js");

let pass = 0, fail = 0;
function check(desc, cond) {
  if (cond) { pass++; }
  else { fail++; console.error("FALHOU:", desc); }
}

function linha(vc, ui, fd, cc) {
  return { respostas: { VC: vc, UI: ui, FD: fd, CC: cc } };
}

// ---------- Caso 1: exemplo documentado no docx (Seção 5, exemplo numérico) ----------
// VC=4.0, UI=3.0, FD=4.0, CC=4.5 -> IAO = (4+3)/(4+4.5) = 7/8.5 = 0.8235... ~ 0.82 -> Nível 2
// 5 respondentes idênticos para bater o piso amostral mínimo (5) e não cair em "inconclusivo".
const linhasCaso1 = Array.from({ length: 5 }, () => linha([4,4,4,4], [3,3,3,3], [4,4,4,4], [4,5,4,5]));
const r1 = calcularIAO({ linhasRespostas: linhasCaso1, nivelCriticidade: 1 });
check("caso1: vc_medio = 4.0", r1.vc_medio === 4);
check("caso1: ui_medio = 3.0", r1.ui_medio === 3);
check("caso1: fd_medio = 4.0", r1.fd_medio === 4);
check("caso1: cc_medio = 4.5", r1.cc_medio === 4.5);
check("caso1: iao = 0.82 (exemplo do docx)", r1.iao === 0.82);
check("caso1: iao_critico = null (nível de criticidade 1, não é setor nível 3)", r1.iao_critico === null);
check("caso1: nivel_maturidade = 2", r1.nivel_maturidade === 2);
check("caso1: n_respondentes = 5", r1.n_respondentes === 5);
check("caso1: status_amostral = ok (n=5 bate o piso)", r1.status_amostral === "ok");
check("caso1: nível 1 só alerta com valor < 0.8, e 0.82 não alerta", r1.deve_alertar === false);

// ---------- Caso 2: setor de alta criticidade (nível 3) usando iao_critico e limiar 1.5 ----------
// Mesmas médias do caso 1, mas nível_criticidade=3 -> iao_critico = (VC+UI)/(FD+CC*2) = 7/(4+9) = 7/13 = 0.5385 -> 0.54
// 0.54 < 1.5 (limiar nível 3) -> deve_alertar = true; classificação usa iao_critico, não iao.
const r2 = calcularIAO({ linhasRespostas: linhasCaso1, nivelCriticidade: 3 });
check("caso2: iao_critico = 0.54", r2.iao_critico === 0.54);
check("caso2: valor_classificado usa iao_critico (0.54), não iao (0.82)", r2.valor_classificado === 0.54);
check("caso2: nivel_maturidade classificado por iao_critico -> nível 1 (< 0.8)", r2.nivel_maturidade === 1);
check("caso2: limiar_aplicado = 1.5 (nível 3)", r2.limiar_aplicado === 1.5);
check("caso2: deve_alertar = true (0.54 < 1.5)", r2.deve_alertar === true);

// ---------- Caso 3: amostra abaixo do piso mínimo (n=3 < PISO_AMOSTRAL_MINIMO=5) ----------
const linhasCaso3 = Array.from({ length: 3 }, () => linha([4,4,4,4], [3,3,3,3], [4,4,4,4], [4,5,4,5]));
const r3 = calcularIAO({ linhasRespostas: linhasCaso3, nivelCriticidade: 1 });
check("caso3: n_respondentes = 3", r3.n_respondentes === 3);
check("caso3: status_amostral = inconclusivo_amostra_insuficiente", r3.status_amostral === "inconclusivo_amostra_insuficiente");
check("caso3 (constante): PISO_AMOSTRAL_MINIMO = 5", PISO_AMOSTRAL_MINIMO === 5);

// ---------- Caso 4: nenhuma resposta -> deve lançar erro (não retornar NaN silenciosamente) ----------
let lancouErro = false;
try {
  calcularIAO({ linhasRespostas: [], nivelCriticidade: 1 });
} catch (e) {
  lancouErro = true;
}
check("caso4: array vazio de respostas -> lança erro (não retorna NaN)", lancouErro === true);

// ---------- Caso 5: fronteiras de classificação de nível de maturidade ----------
// Cortes: <0.8 -> 1 | <1.3 -> 2 | <1.8 -> 3 | <2.4 -> 4 | >=2.4 -> 5
check("fronteira: 0.79 -> nível 1", classificarNivelMaturidade(0.79) === 1);
check("fronteira: 0.80 -> nível 2 (limite inclusive no nível seguinte)", classificarNivelMaturidade(0.80) === 2);
check("fronteira: 1.29 -> nível 2", classificarNivelMaturidade(1.29) === 2);
check("fronteira: 1.30 -> nível 3", classificarNivelMaturidade(1.30) === 3);
check("fronteira: 1.79 -> nível 3", classificarNivelMaturidade(1.79) === 3);
check("fronteira: 1.80 -> nível 4", classificarNivelMaturidade(1.80) === 4);
check("fronteira: 2.39 -> nível 4", classificarNivelMaturidade(2.39) === 4);
check("fronteira: 2.40 -> nível 5", classificarNivelMaturidade(2.40) === 5);

// ---------- Caso 6: limiares de alerta por criticidade ----------
check("limiar nível 3 (alta criticidade) = 1.5", limiarAlertaPorCriticidade(3) === 1.5);
check("limiar nível 2 (média criticidade) = 1.1", limiarAlertaPorCriticidade(2) === 1.1);
check("limiar nível 1 (baixa criticidade) = 0.8", limiarAlertaPorCriticidade(1) === 0.8);
check("limiar para valor inesperado (undefined) cai no default 0.8", limiarAlertaPorCriticidade(undefined) === 0.8);

// ---------- Caso 7: calcularMediasPorBloco com múltiplos respondentes heterogêneos ----------
const linhasCaso7 = [
  linha([5,5,5,5], [4,4,4,4], [2,2,2,2], [3,3,3,3]),
  linha([3,3,3,3], [2,2,2,2], [4,4,4,4], [3,3,3,3]),
];
const medias7 = calcularMediasPorBloco(linhasCaso7);
// VC: (5*4 + 3*4)/8 = (20+12)/8 = 4.0 | UI: (4*4+2*4)/8=3.0 | FD:(2*4+4*4)/8=3.0 | CC: 3.0
check("caso7: media agregada VC entre 2 respondentes = 4.0", medias7.VC === 4);
check("caso7: media agregada UI entre 2 respondentes = 3.0", medias7.UI === 3);
check("caso7: media agregada FD entre 2 respondentes = 3.0", medias7.FD === 3);
check("caso7: media agregada CC entre 2 respondentes = 3.0", medias7.CC === 3);

// ---------- Caso 8: setor nível 2 (média criticidade) não calcula iao_critico ----------
const r8 = calcularIAO({ linhasRespostas: linhasCaso1, nivelCriticidade: 2 });
check("caso8: nível 2 -> iao_critico = null (só nível 3 usa a fórmula ponderada)", r8.iao_critico === null);
check("caso8: nível 2 -> classifica pelo iao normal (0.82 -> nível 2)", r8.nivel_maturidade === 2 && r8.valor_classificado === 0.82);
check("caso8: nível 2 -> limiar_aplicado = 1.1", r8.limiar_aplicado === 1.1);
check("caso8: nível 2 -> 0.82 < 1.1 -> deve_alertar = true", r8.deve_alertar === true);

console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail > 0 ? 1 : 0);
