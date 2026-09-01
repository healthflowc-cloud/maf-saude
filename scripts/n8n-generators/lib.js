const crypto = require("crypto");

function uid() {
  return crypto.randomUUID();
}

function makeNode({ name, type, typeVersion = 1, params = {}, position, credentials, notes, retryOnFail, maxTries, waitBetweenTries, onError }) {
  const n = {
    id: uid(),
    name,
    type,
    typeVersion,
    position: position || [0, 0],
    parameters: params,
  };
  if (credentials) n.credentials = credentials;
  if (notes) n.notes = notes;
  if (retryOnFail) {
    n.retryOnFail = true;
    n.maxTries = maxTries || 3;
    n.waitBetweenTries = waitBetweenTries || 4000;
  }
  if (onError) n.onError = onError; // "continueRegularOutput" | "continueErrorOutput" | "stopWorkflow"
  return n;
}

function workflow({ name, nodes, connections, settings = {} }) {
  return {
    name,
    nodes,
    connections,
    active: false,
    settings: { executionOrder: "v1", ...settings },
    pinData: {},
    meta: { instanceId: "maf-saude-mvp" },
  };
}

// Cria uma conexão simples main[0] -> main[0] entre nós em sequência linear.
function chain(...nodeList) {
  const connections = {};
  for (let i = 0; i < nodeList.length - 1; i++) {
    const from = nodeList[i].name;
    const to = nodeList[i + 1].name;
    connections[from] = connections[from] || { main: [[]] };
    connections[from].main[0].push({ node: to, type: "main", index: 0 });
  }
  return connections;
}

// Uma saída de `from` alimentando vários nós em paralelo (fan-out).
function fanOut(from, toNodes) {
  return {
    [from.name]: {
      main: [toNodes.map((n) => ({ node: n.name, type: "main", index: 0 }))],
    },
  };
}

// IF node: outputs[0] = true, outputs[1] = false
function ifBranch(fromIf, trueNode, falseNode) {
  return {
    [fromIf.name]: {
      main: [
        trueNode ? [{ node: trueNode.name, type: "main", index: 0 }] : [],
        falseNode ? [{ node: falseNode.name, type: "main", index: 0 }] : [],
      ],
    },
  };
}

function mergeConnections(...objs) {
  const out = {};
  for (const obj of objs) {
    for (const [k, v] of Object.entries(obj)) {
      if (!out[k]) {
        out[k] = { main: v.main.map((arr) => [...arr]) };
      } else {
        // merge output-by-output
        v.main.forEach((arr, idx) => {
          out[k].main[idx] = out[k].main[idx] || [];
          out[k].main[idx].push(...arr);
        });
      }
    }
  }
  return out;
}

// Validador estrutural: confere que toda conexão aponta para um node que existe,
// que não há nomes de node duplicados, e que ids são únicos.
function validate(wf) {
  const errors = [];
  const names = new Set();
  const ids = new Set();
  for (const n of wf.nodes) {
    if (names.has(n.name)) errors.push(`nome de node duplicado: ${n.name}`);
    names.add(n.name);
    if (ids.has(n.id)) errors.push(`id de node duplicado: ${n.id}`);
    ids.add(n.id);
    if (!n.type || !n.type.includes(".")) errors.push(`node "${n.name}" com type suspeito: ${n.type}`);
  }
  for (const [from, conn] of Object.entries(wf.connections)) {
    if (!names.has(from)) errors.push(`connections referencia node inexistente como origem: ${from}`);
    for (const output of conn.main) {
      for (const target of output) {
        if (!names.has(target.node)) errors.push(`connections referencia node inexistente como destino: ${target.node} (a partir de ${from})`);
      }
    }
  }
  if (!wf.name) errors.push("workflow sem name");
  return errors;
}

module.exports = { uid, makeNode, workflow, chain, fanOut, ifBranch, mergeConnections, validate };
