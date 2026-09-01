const { montarRelatorio, identificarBlocoMaisFraco, NIVEIS_MATURIDADE, NIVEIS_CRITICIDADE } = require("./report_logic.js");

let pass = 0, fail = 0;
function check(desc, cond) {
  if (cond) { pass++; }
  else { fail++; console.error("FALHOU:", desc); }
}

// ---------- Caso 1: exemplo oficial do docx (VC=4,0 UI=3,0 FD=4,0 CC=4,5 -> IAO=0,82 -> Nível 2) ----------
const iaoRowCaso1 = {
  periodo: "2026-09-01",
  vc_medio: 4.0, ui_medio: 3.0, fd_medio: 4.0, cc_medio: 4.5,
  iao: 0.82, iao_critico: null,
  nivel_maturidade: 2,
  nivel_criticidade: 1,
  n_respondentes: 5,
  status_amostral: "ok",
  deve_alertar: false,
  limiar_aplicado: 0.8,
};
const rel1 = montarRelatorio({ iaoRow: iaoRowCaso1, setorNome: "UTI Adulto", instituicaoNome: "Hospital Exemplo" });
check("caso1: status = Adoção Dolorosa (Burnout) (rótulo oficial da Seção 4)", rel1.resumo_executivo.status === "Adoção Dolorosa (Burnout)");
check("caso1: usa iao (não iao_critico) na classificação quando iao_critico é null", rel1.resumo_executivo.valor_usado_na_classificacao === 0.82);
check("caso1: acao_recomendada = Mutirão Lean (rótulo oficial)", rel1.acao_recomendada === "Mutirão Lean: reduzir cliques/pop-ups (SLA 72h)");
check("caso1: rotulo_criticidade_setor = Administrativo", rel1.resumo_executivo.rotulo_criticidade_setor === "Administrativo");
check("caso1: amostra não é inconclusiva (n=5, status ok)", rel1.amostra.inconclusivo === false && rel1.amostra.aviso === null);
check("caso1: setor_nome e instituicao_nome propagados", rel1.setor_nome === "UTI Adulto" && rel1.instituicao_nome === "Hospital Exemplo");

// ---------- Caso 2: setor nível 3 (alta criticidade) usando iao_critico na classificação ----------
const iaoRowCaso2 = {
  periodo: "2026-09-01",
  vc_medio: 4.0, ui_medio: 3.0, fd_medio: 4.0, cc_medio: 4.5,
  iao: 0.82, iao_critico: 0.54,
  nivel_maturidade: 1, // classificado pelo iao_critico, não pelo iao
  nivel_criticidade: 3,
  n_respondentes: 5,
  status_amostral: "ok",
  deve_alertar: true,
  limiar_aplicado: 1.5,
};
const rel2 = montarRelatorio({ iaoRow: iaoRowCaso2, setorNome: "Pronto-Socorro", instituicaoNome: "Hospital Exemplo" });
check("caso2: usa iao_critico (0.54) como valor_usado_na_classificacao, não iao (0.82)", rel2.resumo_executivo.valor_usado_na_classificacao === 0.54);
check("caso2: status = Risco Iminente / Colapso Operacional", rel2.resumo_executivo.status === "Risco Iminente / Colapso Operacional");
check("caso2: rotulo_criticidade_setor = Urgência / Intensiva (Alta Criticidade)", rel2.resumo_executivo.rotulo_criticidade_setor === "Urgência / Intensiva (Alta Criticidade)");
check("caso2: alerta.deve_alertar = true", rel2.alerta.deve_alertar === true);

// ---------- Caso 3: amostra inconclusiva -> aviso presente ----------
const iaoRowCaso3 = { ...iaoRowCaso1, n_respondentes: 3, status_amostral: "inconclusivo_amostra_insuficiente" };
const rel3 = montarRelatorio({ iaoRow: iaoRowCaso3, setorNome: "Enfermaria", instituicaoNome: "Hospital Exemplo" });
check("caso3: amostra.inconclusivo = true", rel3.amostra.inconclusivo === true);
check("caso3: amostra.aviso não é nulo e menciona piso de 5 respondentes", typeof rel3.amostra.aviso === "string" && rel3.amostra.aviso.includes("5 respondentes"));

// ---------- Caso 4: registro ausente ou malformado -> lança erro (não gera relatório de lixo) ----------
let erro4a = false;
try { montarRelatorio({ iaoRow: null }); } catch (e) { erro4a = true; }
check("caso4a: iaoRow nulo -> lança erro", erro4a === true);

let erro4b = false;
try { montarRelatorio({ iaoRow: { ...iaoRowCaso1, nivel_maturidade: 9 } }); } catch (e) { erro4b = true; }
check("caso4b: nivel_maturidade fora de 1-5 -> lança erro", erro4b === true);

// ---------- Caso 5: identificarBlocoMaisFraco - impulso baixo (VC) deve vencer quando é o pior ----------
const blocoFraco1 = identificarBlocoMaisFraco({ vc_medio: 1.5, ui_medio: 4.5, fd_medio: 2.0, cc_medio: 2.0 });
// impulso: VC=5-1.5=3.5 (pior), UI=5-4.5=0.5 | atrito: FD=2.0, CC=2.0 -> maior é VC (3.5)
check("caso5: VC muito baixo (1.5) é identificado como bloco mais fraco", blocoFraco1 === "VC");

// ---------- Caso 6: identificarBlocoMaisFraco - atrito alto (CC) deve vencer quando é o pior ----------
const blocoFraco2 = identificarBlocoMaisFraco({ vc_medio: 4.5, ui_medio: 4.5, fd_medio: 2.0, cc_medio: 4.8 });
// impulso: VC=0.5, UI=0.5 | atrito: FD=2.0, CC=4.8 (pior) -> maior é CC (4.8)
check("caso6: CC muito alto (4.8) é identificado como bloco mais fraco", blocoFraco2 === "CC");

// ---------- Caso 7: paridade de rótulos com a tabela oficial da Seção 4 (todos os 5 níveis existem) ----------
check("caso7: NIVEIS_MATURIDADE tem exatamente os níveis 1 a 5", Object.keys(NIVEIS_MATURIDADE).sort().join(",") === "1,2,3,4,5");
check("caso7: NIVEIS_CRITICIDADE tem exatamente os níveis 1 a 3 (FCS)", Object.keys(NIVEIS_CRITICIDADE).sort().join(",") === "1,2,3");
check("caso7: nível 5 = Selo Padrão Ouro MAF / Aderência Orgânica (rótulo oficial)", NIVEIS_MATURIDADE[5].status === "Selo Padrão Ouro MAF / Aderência Orgânica");

console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail > 0 ? 1 : 0);
