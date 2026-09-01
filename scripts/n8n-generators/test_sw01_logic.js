// Testa as funções puras dos Code nodes de SW-01 fora do n8n, com casos reais.
// Não importa o JSON do workflow -- copia as mesmas funções para evitar
// acoplamento com o parser de n8n, mas os textos devem ficar idênticos aos
// gerados em sw01.js (checagem manual de paridade abaixo).

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
  if (typeof payload.periodo !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(payload.periodo)) {
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
  if (erros.length > 0) return { valido: false, motivo: "payload_malformado", detalhes: erros };
  return { valido: true, token_instituicao: payload.token_instituicao, setor_id: payload.setor_id, periodo: payload.periodo, respondente_hash: payload.respondente_hash, respostas };
}

function checarStraightLining(dados) {
  const todosValores = [...dados.respostas.VC, ...dados.respostas.UI, ...dados.respostas.FD, ...dados.respostas.CC];
  const primeiro = todosValores[0];
  const straightlining = todosValores.every((v) => v === primeiro);
  return { ...dados, straightlining };
}

function checarInstituicao(respostaSupabase, dadosAnteriores) {
  const registros = Array.isArray(respostaSupabase) ? respostaSupabase : [];
  if (registros.length === 0) return { ...dadosAnteriores, instituicao_valida: false, motivo: "token_invalido" };
  const instituicao = registros[0];
  if (instituicao.ativo !== true) return { ...dadosAnteriores, instituicao_valida: false, motivo: "instituicao_inativa" };
  return { ...dadosAnteriores, instituicao_valida: true, instituicao_id: instituicao.id, instituicao_nome: instituicao.nome };
}

function checarSetor(respostaSupabase, dadosAnteriores) {
  const registros = Array.isArray(respostaSupabase) ? respostaSupabase : [];
  if (registros.length === 0) return { ...dadosAnteriores, setor_valido: false, motivo: "setor_nao_encontrado" };
  const setor = registros[0];
  if (setor.instituicao_id !== dadosAnteriores.instituicao_id) return { ...dadosAnteriores, setor_valido: false, motivo: "setor_nao_pertence_a_instituicao" };
  return { ...dadosAnteriores, setor_valido: true, nivel_criticidade: setor.nivel_criticidade };
}

// ---------------- casos de teste ----------------
let pass = 0, fail = 0;
function check(desc, cond) {
  if (cond) { pass++; }
  else { fail++; console.error("FALHOU:", desc); }
}

const payloadValido = {
  token_instituicao: "abcdefgh12345",
  setor_id: "9779be33-60d0-4975-98d2-dae0d5c8e610",
  periodo: "2026-09-01",
  respondente_hash: "hash1",
  respostas: { VC: [5,4,5,4], UI: [4,4,3,5], FD: [2,3,2,2], CC: [3,2,3,2] },
};

const r1 = validarEstrutura(payloadValido);
check("payload valido -> valido true", r1.valido === true);

const r2 = validarEstrutura({ ...payloadValido, setor_id: "nao-e-uuid" });
check("setor_id invalido -> valido false", r2.valido === false);

const r3 = validarEstrutura({ ...payloadValido, respostas: { ...payloadValido.respostas, VC: [5,4,5] } });
check("bloco com 3 itens -> valido false", r3.valido === false && r3.detalhes.some(d => d.includes("VC")));

const r4 = validarEstrutura({ ...payloadValido, respostas: { ...payloadValido.respostas, CC: [5,4,6,2] } });
check("valor fora de 1-5 -> valido false", r4.valido === false);

const r5 = validarEstrutura({ ...payloadValido, respostas: { ...payloadValido.respostas, UI: [3, 3.5, 3, 3] } });
check("valor nao-inteiro -> valido false", r5.valido === false);

const straightAllFive = checarStraightLining({ respostas: { VC:[5,5,5,5], UI:[5,5,5,5], FD:[5,5,5,5], CC:[5,5,5,5] } });
check("todos 5 -> straightlining true", straightAllFive.straightlining === true);

const straightNormal = checarStraightLining({ respostas: payloadValido.respostas });
check("respostas variadas -> straightlining false", straightNormal.straightlining === false);

const straightAllOnesExceptLast = checarStraightLining({ respostas: { VC:[3,3,3,3], UI:[3,3,3,3], FD:[3,3,3,3], CC:[3,3,3,4] } });
check("15 iguais + 1 diferente -> straightlining false (não é falso positivo)", straightAllOnesExceptLast.straightlining === false);

const instOk = checarInstituicao([{ id: "inst-1", nome: "Hospital X", ativo: true }], { setor_id: "s1" });
check("instituicao ativa encontrada -> valida true", instOk.instituicao_valida === true && instOk.instituicao_id === "inst-1");

const instVazia = checarInstituicao([], { setor_id: "s1" });
check("instituicao nao encontrada -> valida false, motivo token_invalido", instVazia.instituicao_valida === false && instVazia.motivo === "token_invalido");

const instInativa = checarInstituicao([{ id: "inst-1", ativo: false }], { setor_id: "s1" });
check("instituicao inativa -> valida false, motivo instituicao_inativa", instInativa.instituicao_valida === false && instInativa.motivo === "instituicao_inativa");

const setorOk = checarSetor([{ id: "setor-1", instituicao_id: "inst-1", nivel_criticidade: 3 }], { instituicao_id: "inst-1" });
check("setor pertence a instituicao -> valido true", setorOk.setor_valido === true && setorOk.nivel_criticidade === 3);

const setorCross = checarSetor([{ id: "setor-1", instituicao_id: "inst-OUTRA", nivel_criticidade: 3 }], { instituicao_id: "inst-1" });
check("setor de OUTRA instituicao -> valido false (protecao cross-tenant)", setorCross.setor_valido === false && setorCross.motivo === "setor_nao_pertence_a_instituicao");

console.log(`\n${pass} passaram, ${fail} falharam`);
process.exit(fail > 0 ? 1 : 0);
