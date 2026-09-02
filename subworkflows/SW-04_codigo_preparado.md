# SW-04 — Gerar Insights (Gemini) — código preparado, aguardando API key do n8n

Rascunho pronto para colar nos Code nodes assim que eu tiver uma API key
temporária do n8n para criar o subworkflow via API (mesmo padrão do SW-00..03).

## Cadeia de nodes

1. **Webhook** `POST /webhook/maf-gerar-insights` — recebe `{ relatorio_id, access_token }` do dashboard.
2. **HTTP Request "Buscar Relatorio (RLS do usuario)"** — `GET {SUPABASE_URL}/rest/v1/relatorios_diagnostico?id=eq.{{ $json.relatorio_id }}&select=id,conteudo`, headers `apikey: <anon key, literal>` + `Authorization: Bearer {{ $json.access_token }}` (o token de QUEM CHAMOU, não a service_role — RLS de `owner_select_relatorios` decide se a linha aparece ou não). **Não é uma credencial salva** — o Authorization muda por chamada.
3. **Code "Normalizar Relatorio"** — mesmo padrão de normalização array/objeto-único/vazio corrigido no SW-01/02 hoje: `const registros = Array.isArray(x) ? x : (x && Object.keys(x).length > 0 ? [x] : []);`
4. **IF "Relatorio encontrado?"** → falso: **RespondToWebhook 403** `{status:"erro", motivo:"nao_encontrado_ou_nao_autorizado"}`.
5. **Code "Montar Prompt (Gemini)"** — monta o corpo da requisição inteiro em JS (lição do fluxo de referência: nunca montar JSON com chaves aninhadas dentro da expressão `{{ }}` do HTTP Request node — quebra o parser). Ver `montar_prompt_gemini.js` abaixo.
6. **HTTP Request "Chamar Gemini API"** — `POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent`, credencial `httpCustomAuth` "Gemini MAF" (header `x-goog-api-key`, `allowedHttpRequestDomains: generativelanguage.googleapis.com`), body = `{{ $json.geminiRequestBody }}` (raw JSON).
7. **Code "Validar Insights (Gemini)"** — gate anti-alucinação + parsing defensivo. Ver `validar_insights_gemini.js` abaixo.
8. **HTTP Request "Gravar Insights"** — `PATCH .../relatorios_diagnostico?id=eq.{{ relatorio_id }}`, credencial `httpCustomAuth` "Supabase MAF" (já existe, service_role) — seta `insights` e `insights_gerado_em`.
9. **RespondToWebhook 200** — devolve `{status:"ok", insights: {...}}` pro dashboard renderizar na hora.
10. `settings.errorWorkflow` = SW-00 (mesmo padrão).

## montar_prompt_gemini.js

```js
const relatorio = $input.first().json;
const conteudo = relatorio.conteudo;

const systemPrompt = 'Você é o motor de insights da metodologia MAF-Saúde (Modelo de Aderência e Fricção em Saúde). '
  + 'O diagnóstico já foi CALCULADO matematicamente (não recalcule, não invente números) a partir de 4 blocos: '
  + 'VC (Valor Clínico Percebido), UI (Usabilidade Invisível), FD (Fricção Digital, nota alta é RUIM), CC (Carga Cognitiva, nota alta é RUIM). '
  + 'Gere: (1) um resumo executivo curto (MÁXIMO 60 palavras); (2) uma avaliação personalizada consultiva (MÁXIMO 220 palavras) conectando os 4 blocos, '
  + 'SEMPRE ancorada nos números REAIS fornecidos, nunca genérica; (3) para CADA bloco (VC, UI, FD, CC): fortalezas, fraquezas/oportunidades e uma '
  + 'recomendação priorizada e concreta, cada campo com NO MÁXIMO 40 palavras. Se a amostra estiver marcada como inconclusiva, mencione isso '
  + 'explicitamente no resumo executivo como ressalva. Nunca invente dados que não estejam no contexto fornecido. '
  + 'RESPEITE ESTRITAMENTE os limites de palavras acima em TODOS os campos. '
  + 'Responda SOMENTE em JSON válido, exatamente com estas chaves: resumo_executivo (string), avaliacao_personalizada (string), '
  + 'VC (objeto com fortalezas, fraquezas, recomendacao_priorizada, todas string), UI (mesmos 3 campos), FD (mesmos 3 campos), CC (mesmos 3 campos).';

const contextoCliente = {
  instituicao: conteudo.instituicao_nome,
  setor: conteudo.setor_nome,
  periodo: conteudo.periodo,
  resumo_executivo_calculado: conteudo.resumo_executivo,
  medias_por_bloco: conteudo.blocos,
  ponto_de_atencao_principal: conteudo.ponto_de_atencao_principal,
  acao_recomendada_regra: conteudo.acao_recomendada,
  amostra: conteudo.amostra,
};

const corpoRequisicao = {
  contents: [{ role: 'user', parts: [{ text: 'Dados do diagnóstico:\n' + JSON.stringify(contextoCliente) }] }],
  systemInstruction: { parts: [{ text: systemPrompt }] },
  generationConfig: { temperature: 0.4, maxOutputTokens: 2048, responseMimeType: 'application/json' },
  // responseMimeType:'application/json' é um recurso nativo da Gemini API que
  // Claude/Anthropic não tem — reduz (não elimina) o risco de cerca markdown.
};

return [{ json: { relatorio_id: relatorio.id, geminiRequestBody: JSON.stringify(corpoRequisicao) } }];
```

## validar_insights_gemini.js

```js
const respostaIA = $input.first().json;
const candidato = respostaIA.candidates?.[0];
const textoIA = candidato?.content?.parts?.[0]?.text || '';

if (candidato?.finishReason === 'MAX_TOKENS') {
  throw new Error('Resposta do Gemini foi CORTADA por atingir maxOutputTokens (finishReason=MAX_TOKENS) — texto incompleto. Reduza a verbosidade pedida ou aumente maxOutputTokens.');
}
if (candidato?.finishReason === 'SAFETY' || respostaIA.promptFeedback?.blockReason) {
  throw new Error('Gemini bloqueou a resposta (finishReason=' + candidato?.finishReason + ', blockReason=' + respostaIA.promptFeedback?.blockReason + ').');
}

function limparCercaMarkdown(texto) {
  const limpo = String(texto ?? '').trim();
  const match = limpo.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : limpo;
}

let insights;
const textoLimpo = limparCercaMarkdown(textoIA);
try {
  insights = JSON.parse(textoLimpo);
} catch (e) {
  const blocoJson = textoLimpo.match(/\{[\s\S]*\}/);
  if (!blocoJson) throw new Error('Gemini não retornou um JSON válido. Resposta bruta: ' + textoIA);
  try {
    insights = JSON.parse(blocoJson[0]);
  } catch (e2) {
    throw new Error('Gemini não retornou um JSON válido (falhou mesmo extraindo o bloco {...}). Resposta bruta: ' + textoIA);
  }
}

function exigirTextoNaoVazio(valor, caminho) {
  if (!valor || typeof valor !== 'string' || valor.trim().length === 0) {
    throw new Error('Campo obrigatório ausente/vazio no JSON do Gemini: ' + caminho);
  }
}
exigirTextoNaoVazio(insights.resumo_executivo, 'resumo_executivo');
exigirTextoNaoVazio(insights.avaliacao_personalizada, 'avaliacao_personalizada');

const BLOCOS = ['VC', 'UI', 'FD', 'CC'];
const CAMPOS = ['fortalezas', 'fraquezas', 'recomendacao_priorizada'];
for (const bloco of BLOCOS) {
  if (!insights[bloco] || typeof insights[bloco] !== 'object') {
    throw new Error(`Campo obrigatório ausente no JSON do Gemini: "${bloco}" deveria ser um objeto.`);
  }
  for (const campo of CAMPOS) {
    exigirTextoNaoVazio(insights[bloco][campo], `${bloco}.${campo}`);
  }
}

const dadosAnteriores = $('Montar Prompt (Gemini)').item.json;
return [{ json: { relatorio_id: dadosAnteriores.relatorio_id, insights } }];
```

## Segurança da chave Gemini

A key foi recebida em texto puro no chat. **Não vai para nenhum arquivo do
projeto nem para o git** — só entra numa credencial `httpCustomAuth` do n8n
(mesmo padrão da "Supabase MAF"), criptografada pelo próprio n8n,
restrita por `allowedHttpRequestDomains` a `generativelanguage.googleapis.com`.
