// ============================================================================
// MAF-Saude -- Supabase Edge Function "gerar-pdf-relatorio" (Fase 3, SW-05)
//
// Por que existe / por que este desenho: o SW-05 precisa converter o
// diagnostico em PDF. A primeira opcao (sidecar Browserless no VPS do n8n)
// foi descartada -- usuario sem acesso ao VPS. A segunda opcao (Cloud
// Function no Firebase com Chromium headless, ver web/functions/index.js)
// funciona mas exige o plano Blaze (cartao cadastrado, mesmo ficando
// dentro do free tier). O usuario pediu uma alternativa 100% gratuita, sem
// cartao em lugar nenhum -- esta e essa alternativa.
//
// Trade-off aceito conscientemente: em vez de "printar" a pagina
// relatorio.html com um navegador headless (visualmente identica ao que o
// cliente ve), este PDF e MONTADO programaticamente com pdf-lib a partir
// dos MESMOS dados (`conteudo` de relatorios_diagnostico). Isso significa
// um SEGUNDO lugar para atualizar se o layout do relatorio mudar algum dia
// -- documentado como debito tecnico aceito, nao esquecido.
//
// Autenticacao: o gateway do Supabase ja exige um JWT valido (Authorization:
// Bearer <anon ou service_role>) antes de a requisicao chegar aqui --
// nenhum codigo extra de auth precisa existir nesta function. O n8n chama
// usando a MESMA credencial "Supabase MAF" (service_role) ja usada em todo
// o resto do projeto -- nenhuma credencial nova precisou ser criada.
//
// Deploy (feito 1x por mudanca de codigo, nao a cada chamada):
//   supabase functions deploy gerar-pdf-relatorio --project-ref swdiulaxutckfccgeyyo
// Custo: dentro do free tier do Supabase (500.000 invocacoes/mes inclusas),
// sem exigir cartao cadastrado.
// ============================================================================

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "npm:pdf-lib@1.17.1";

// Paleta "Clinico Claro" -- mesma paleta de web/public/style.css (fundo
// branco, azul-petroleo + verde-agua como destaque), escolhida para o
// usuario final da area da saude em vez do estilo escuro/tech comum em
// dashboards de TI. Mantida sincronizada manualmente com as variaveis CSS
// (--maf-petroleo, --maf-agua, etc.) -- mesmo debito tecnico ja documentado
// de duas implementacoes do layout (ver README desta function).
const PETROLEO = rgb(0.055, 0.290, 0.361); // #0e4a5c
const PETROLEO_ESCURO = rgb(0.035, 0.220, 0.275); // #093846
const AGUA = rgb(0.078, 0.659, 0.612); // #14a89c
const AGUA_ESCURA = rgb(0.047, 0.518, 0.471); // #0c8478
const CINZA_ESCURO = rgb(0.122, 0.176, 0.200); // #1f2d33 (texto)
const CINZA_MEDIO = rgb(0.333, 0.408, 0.431); // #55686e (texto secundario)
const CINZA_CLARO = rgb(0.867, 0.898, 0.906); // #dde5e7 (bordas/fundos neutros)
const VERDE = rgb(0.184, 0.561, 0.357); // #2f8f5b (status: nivel bom)
const AMARELO = rgb(0.659, 0.525, 0.039); // #a8860a (status: alerta)
const VERMELHO = rgb(0.702, 0.255, 0.227); // #b3413a (status: critico)
// Aliases para minimizar o diff do restante do arquivo.
const AZUL = PETROLEO;

const PAGE_W = 595.28; // A4 em pontos
const PAGE_H = 841.89;
const MARGEM = 48;
const LARGURA_UTIL = PAGE_W - MARGEM * 2;

// --- utilidades de layout -----------------------------------------------

function quebrarLinhas(texto: string, font: PDFFont, tamanho: number, larguraMax: number): string[] {
  const palavras = String(texto ?? "").split(/\s+/).filter(Boolean);
  const linhas: string[] = [];
  let atual = "";
  for (const palavra of palavras) {
    const teste = atual ? `${atual} ${palavra}` : palavra;
    if (font.widthOfTextAtSize(teste, tamanho) > larguraMax && atual) {
      linhas.push(atual);
      atual = palavra;
    } else {
      atual = teste;
    }
  }
  if (atual) linhas.push(atual);
  return linhas.length ? linhas : [""];
}

// Escreve um paragrafo com quebra de linha automatica; devolve o novo y.
function escreverParagrafo(
  page: PDFPage,
  texto: string,
  x: number,
  y: number,
  font: PDFFont,
  tamanho: number,
  larguraMax: number,
  cor: RGB = CINZA_ESCURO,
  entreLinhas = 1.35,
): number {
  const linhas = quebrarLinhas(sanitizarTextoPdf(texto), font, tamanho, larguraMax);
  let cursor = y;
  for (const linha of linhas) {
    page.drawText(linha, { x, y: cursor, size: tamanho, font, color: cor });
    cursor -= tamanho * entreLinhas;
  }
  return cursor;
}

function corPorNivel(nivel: number): RGB {
  if (nivel <= 2) return VERMELHO;
  if (nivel === 3) return AMARELO;
  return VERDE;
}

// As fontes padrao do pdf-lib (Helvetica, sem embutir arquivo de fonte
// proprio) so suportam WinAnsi (Windows-1252, 1 byte por caractere) --
// QUALQUER caractere fora disso (emoji, "⚠", certos tracos/aspas
// tipograficas, setas, marcadores "•") faz `drawText` lancar excecao e
// derruba a geracao inteira do PDF (foi exatamente o que aconteceu no
// primeiro teste ponta a ponta contra o relatorio-piloto, com o aviso de
// amostra inconclusiva). Risco recorrente, nao pontual: a partir do SW-04,
// parte do texto desenhado aqui vem de uma IA (Gemini) e pode trazer esses
// caracteres a qualquer momento, sem aviso previo e sem controle do time.
// Por isso: sanitiza TODO texto antes de desenhar, em vez de corrigir só o
// caractere que quebrou hoje.
const MAPA_SUBSTITUICOES_PDF: Record<string, string> = {
  "⚠️": "!", "⚠": "!",
  "✅": "OK", "✔️": "OK", "✔": "OK", "✓": "OK",
  "❌": "x", "✘": "x", "✗": "x",
  "→": "->", "⇒": "=>", "←": "<-", "↔": "<->",
  "•": "-", "●": "-", "◦": "-", "▪": "-",
  "…": "...",
};

// WinAnsiEncoding (base do PDF para Windows-1252) NAO e simplesmente
// "codepoint <= 255" -- os bytes 0x80-0x9F mapeiam para um conjunto
// especifico de codepoints ALTOS (travessao, aspas tipograficas, etc.).
// Sem essa lista, um filtro ingenuo por codepoint removeria o travessao
// usado em varios textos estaticos deste arquivo (bug encontrado e
// corrigido antes do primeiro deploy desta versao).
const WINANSI_CODEPOINTS_EXTRA = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030,
  0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022,
  0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);

function winAnsiSeguro(codepoint: number): boolean {
  if (codepoint >= 0x20 && codepoint <= 0x7e) return true; // ASCII imprimivel
  if (codepoint >= 0xa0 && codepoint <= 0xff) return true; // Latin-1 (acentos PT-BR)
  return WINANSI_CODEPOINTS_EXTRA.has(codepoint);
}

function sanitizarTextoPdf(texto: unknown): string {
  let resultado = String(texto ?? "");
  for (const [de, para] of Object.entries(MAPA_SUBSTITUICOES_PDF)) {
    if (resultado.includes(de)) resultado = resultado.split(de).join(para);
  }
  // Qualquer coisa que sobrar fora do WinAnsi e removida -- preferimos
  // perder um caractere decorativo isolado a derrubar o PDF inteiro.
  return Array.from(resultado)
    .filter((ch) => winAnsiSeguro(ch.codePointAt(0) ?? 0))
    .join("");
}

// Barra horizontal 0-5 com rotulo e valor. `corRuimSeAlto` inverte a leitura
// de cor (FD/CC: quanto maior, pior) sem inverter a barra em si (a barra
// sempre mostra a media crua, 0-5).
function desenharBarraBloco(
  page: PDFPage,
  font: PDFFont,
  fontBold: PDFFont,
  x: number,
  y: number,
  largura: number,
  nomeBloco: string,
  sigla: string,
  valor: number,
  corRuimSeAlto: boolean,
): void {
  const alturaBarra = 10;
  const max = 5;
  const proporcao = Math.max(0, Math.min(1, valor / max));

  page.drawText(sanitizarTextoPdf(`${sigla} — ${nomeBloco}`), { x, y: y + 4, size: 10, font: fontBold, color: CINZA_ESCURO });
  page.drawText(valor.toFixed(2), {
    x: x + largura - font.widthOfTextAtSize(valor.toFixed(2), 10),
    y: y + 4,
    size: 10,
    font: fontBold,
    color: CINZA_ESCURO,
  });

  const yBarra = y - 10;
  page.drawRectangle({ x, y: yBarra, width: largura, height: alturaBarra, color: CINZA_CLARO });

  let corPreenchimento: RGB;
  const ruim = corRuimSeAlto ? proporcao > 0.6 : proporcao < 0.4;
  const bom = corRuimSeAlto ? proporcao < 0.4 : proporcao > 0.6;
  corPreenchimento = ruim ? VERMELHO : bom ? VERDE : AMARELO;

  page.drawRectangle({ x, y: yBarra, width: largura * proporcao, height: alturaBarra, color: corPreenchimento });
}

// --- conteudo informativo (valor agregado alem dos numeros crus) -----------
// Textos estaticos, independentes do relatorio especifico -- nao substituem
// a "acao_recomendada" (essa vem calculada por report_logic.js/SW-03 a
// partir do nivel_maturidade real). Duplicado propositalmente em
// relatorio.html (mesmo debito tecnico ja documentado de duas
// implementacoes do layout do relatorio).
const COMO_MELHORAR: Record<string, string[]> = {
  VC: [
    "Priorize a integracao de dados clinicos ja existentes (historico, exames, alergias) nas telas mais usadas.",
    "Registre exemplos concretos de decisoes que o sistema ajudou ou atrapalhou -- e a evidencia que prioriza melhorias com a equipe de TI.",
  ],
  UI: [
    "Compare o fluxo real de trabalho com o fluxo do sistema -- cada divergencia e candidata a redesenho de tela.",
    "Padronize a ordem dos campos criticos (sinais vitais, alergias) para reduzir a carga de decisao.",
  ],
  FD: [
    "Identifique os campos mais redigitados entre telas e proponha integracao ou preenchimento automatico.",
    "Registre travamentos/lentidao com horario -- e o dado que justifica investimento em infraestrutura.",
  ],
  CC: [
    "Reduza alertas nao-criticos -- fadiga de alerta e um risco de seguranca do paciente bem documentado na literatura.",
    "Simplifique a hierarquia visual das telas mais usadas -- menos cores/botoes concorrendo por atencao.",
  ],
};

const PLANO_ACAO_POR_NIVEL: Record<number, { imediato: string; curto_prazo: string; medio_prazo: string }> = {
  1: {
    imediato: "Reengenharia total ou troca de software.",
    curto_prazo: "Mapear os 3 pontos de maior friccao e formar um mutirao Lean de resposta rapida.",
    medio_prazo: "Reavaliar em 60 dias com nova rodada do questionario para medir o efeito das mudancas.",
  },
  2: {
    imediato: "Mutirao Lean: reduzir cliques/pop-ups (SLA 72h).",
    curto_prazo: "Padronizar os fluxos mais usados e treinar multiplicadores por turno.",
    medio_prazo: "Reaplicar o diagnostico em 90 dias e comparar o IAO por bloco.",
  },
  3: {
    imediato: "Integracoes via API, suporte a decisao clinica.",
    curto_prazo: "Priorizar 1-2 integracoes de maior impacto apontadas pelo bloco mais fraco.",
    medio_prazo: "Formalizar um comite de governanca de TI clinica com revisao trimestral.",
  },
  4: {
    imediato: "Sustentacao e escuta continua.",
    curto_prazo: "Criar canal permanente de feedback dos usuarios finais.",
    medio_prazo: "Monitorar a tendencia do IAO por setor a cada ciclo, sem reduzir a cadencia.",
  },
  5: {
    imediato: "Certificacao + Employer Branding.",
    curto_prazo: "Documentar as praticas que levaram ao Selo Padrao Ouro MAF como referencia interna.",
    medio_prazo: "Usar o setor como padrao de benchmarking interno para os demais.",
  },
};

// --- corpo principal -------------------------------------------------------

interface RequisicaoPdf {
  conteudo: Record<string, any>;
  insights?: Record<string, any> | null;
}

// CORS: o uso real (n8n chamando servidor-a-servidor) nao precisa disso --
// navegador nenhum roda o HTTP Request node do n8n. Adicionado mesmo assim
// por seguranca/testabilidade: permite testar a function direto do painel
// do Supabase ou de qualquer chamada feita a partir de um navegador (ex.:
// debug manual), sem exigir uma origem especifica (nao ha credencial nem
// dado sensivel exposto por esta rota alem do proprio relatorio pedido).
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ status: "erro", motivo: "method_not_allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }

  let body: RequisicaoPdf;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ status: "erro", motivo: "json_invalido" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }

  const conteudo = body?.conteudo;
  if (!conteudo || typeof conteudo !== "object" || !conteudo.resumo_executivo || !conteudo.blocos) {
    return new Response(
      JSON.stringify({ status: "erro", motivo: "conteudo_ausente_ou_incompleto_esperado_forma_de_relatorios_diagnostico" }),
      { status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
    );
  }
  const insights = body?.insights || null;

  try {
    const pdf = await PDFDocument.create();
    pdf.setTitle(`Relatorio MAF-Saude - ${conteudo.setor_nome ?? ""} - ${conteudo.periodo ?? ""}`);
    pdf.setProducer("MAF-Saude");

    const fontRegular = await pdf.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const fontItalic = await pdf.embedFont(StandardFonts.HelveticaOblique);

    let page = pdf.addPage([PAGE_W, PAGE_H]);
    let y = PAGE_H - MARGEM;

    const novaPaginaSeNecessario = (espacoNecessario: number) => {
      if (y - espacoNecessario < MARGEM + 40) {
        page = pdf.addPage([PAGE_W, PAGE_H]);
        y = PAGE_H - MARGEM;
      }
    };

    // Cabecalho
    page.drawText("MAF-Saude — Relatório de Maturidade e Fricção", { x: MARGEM, y, size: 16, font: fontBold, color: AZUL });
    y -= 22;
    page.drawText(
      sanitizarTextoPdf(`${conteudo.instituicao_nome ?? "—"}  ·  ${conteudo.setor_nome ?? "—"}  ·  Período: ${conteudo.periodo ?? "—"}`),
      { x: MARGEM, y, size: 10.5, font: fontRegular, color: CINZA_MEDIO },
    );
    y -= 10;
    page.drawLine({ start: { x: MARGEM, y }, end: { x: PAGE_W - MARGEM, y }, thickness: 0.75, color: CINZA_CLARO });
    y -= 26;

    // Aviso de amostra inconclusiva (se houver) -- vem primeiro de proposito,
    // e o cliente precisa ver essa ressalva antes de qualquer numero.
    if (conteudo.amostra?.inconclusivo && conteudo.amostra?.aviso) {
      page.drawRectangle({ x: MARGEM, y: y - 34, width: LARGURA_UTIL, height: 34, color: rgb(0.99, 0.95, 0.88) });
      y -= 8;
      y = escreverParagrafo(page, `⚠ ${conteudo.amostra.aviso}`, MARGEM + 10, y, fontRegular, 9, LARGURA_UTIL - 20, AMARELO);
      y -= 14;
    }

    // IAO / nivel de maturidade
    const resumo = conteudo.resumo_executivo;
    const nivel = Number(resumo.nivel_maturidade) || 0;
    const iaoTexto = typeof resumo.iao === "number" ? resumo.iao.toFixed(2) : String(resumo.iao ?? "—");
    page.drawText(`IAO: ${iaoTexto}`, { x: MARGEM, y, size: 22, font: fontBold, color: corPorNivel(nivel) });
    y -= 20;
    page.drawText(sanitizarTextoPdf(`Nível ${nivel} — ${resumo.status ?? ""}`), { x: MARGEM, y, size: 12, font: fontBold, color: CINZA_ESCURO });
    y -= 16;
    if (resumo.rotulo_criticidade_setor) {
      page.drawText(sanitizarTextoPdf(`Criticidade do setor: ${resumo.rotulo_criticidade_setor}`), {
        x: MARGEM,
        y,
        size: 9.5,
        font: fontItalic,
        color: CINZA_MEDIO,
      });
      y -= 18;
    } else {
      y -= 4;
    }

    // Barras por bloco
    const blocos = conteudo.blocos;
    const ORDEM: Array<{ sigla: string; ruimSeAlto: boolean }> = [
      { sigla: "VC", ruimSeAlto: false },
      { sigla: "UI", ruimSeAlto: false },
      { sigla: "FD", ruimSeAlto: true },
      { sigla: "CC", ruimSeAlto: true },
    ];
    for (const { sigla, ruimSeAlto } of ORDEM) {
      const bloco = blocos[sigla];
      if (!bloco) continue;
      novaPaginaSeNecessario(30);
      desenharBarraBloco(page, fontRegular, fontBold, MARGEM, y, LARGURA_UTIL, bloco.nome ?? sigla, sigla, Number(bloco.media) || 0, ruimSeAlto);
      y -= 30;
    }
    y -= 8;

    // Ponto de atencao principal
    if (conteudo.ponto_de_atencao_principal) {
      novaPaginaSeNecessario(60);
      page.drawText("Ponto de atenção principal", { x: MARGEM, y, size: 11.5, font: fontBold, color: AZUL });
      y -= 16;
      y = escreverParagrafo(
        page,
        `${conteudo.ponto_de_atencao_principal.nome ?? ""}: ${conteudo.ponto_de_atencao_principal.observacao ?? ""}`,
        MARGEM,
        y,
        fontRegular,
        10,
        LARGURA_UTIL,
      );
      y -= 14;
    }

    // Acao recomendada
    if (conteudo.acao_recomendada) {
      novaPaginaSeNecessario(50);
      page.drawText("Ação recomendada", { x: MARGEM, y, size: 11.5, font: fontBold, color: AZUL });
      y -= 16;
      y = escreverParagrafo(page, String(conteudo.acao_recomendada), MARGEM, y, fontRegular, 10, LARGURA_UTIL);
      y -= 14;
    }

    // Como melhorar -- dicas praticas do bloco mais fraco (valor agregado,
    // independente do texto calculado, ver COMO_MELHORAR acima).
    const blocoFraco = conteudo.ponto_de_atencao_principal?.bloco;
    const dicas = blocoFraco ? COMO_MELHORAR[blocoFraco] : null;
    if (dicas && dicas.length) {
      novaPaginaSeNecessario(60);
      page.drawText("Como melhorar", { x: MARGEM, y, size: 11.5, font: fontBold, color: AGUA_ESCURA });
      y -= 16;
      for (const dica of dicas) {
        novaPaginaSeNecessario(24);
        y = escreverParagrafo(page, `-  ${dica}`, MARGEM, y, fontRegular, 9.5, LARGURA_UTIL);
      }
      y -= 8;
    }

    // Plano de acao (imediato / curto prazo / medio prazo) -- deriva do
    // mesmo nivel_maturidade ja calculado, sem inventar numero novo.
    const planoAcao = PLANO_ACAO_POR_NIVEL[nivel];
    if (planoAcao) {
      novaPaginaSeNecessario(90);
      page.drawRectangle({ x: MARGEM, y: y - 4, width: 3, height: 78, color: PETROLEO });
      page.drawText("Plano de ação sugerido", { x: MARGEM + 12, y, size: 11.5, font: fontBold, color: AZUL });
      y -= 18;
      const etapas: Array<[string, string]> = [
        ["Imediato", planoAcao.imediato],
        ["Curto prazo (até 90 dias)", planoAcao.curto_prazo],
        ["Médio prazo", planoAcao.medio_prazo],
      ];
      for (const [rotulo, texto] of etapas) {
        novaPaginaSeNecessario(28);
        page.drawText(`${rotulo}:`, { x: MARGEM + 12, y, size: 9.5, font: fontBold, color: CINZA_ESCURO });
        y -= 12;
        y = escreverParagrafo(page, texto, MARGEM + 12, y, fontRegular, 9.5, LARGURA_UTIL - 12);
        y -= 6;
      }
      y -= 10;
    }

    // Insights de IA (Gemini), se ja tiverem sido gerados pelo SW-04
    if (insights && insights.resumo_executivo) {
      novaPaginaSeNecessario(80);
      page.drawLine({ start: { x: MARGEM, y }, end: { x: PAGE_W - MARGEM, y }, thickness: 0.75, color: CINZA_CLARO });
      y -= 20;
      page.drawText("Análise gerada por IA", { x: MARGEM, y, size: 13, font: fontBold, color: AZUL });
      y -= 18;

      page.drawText("Resumo executivo", { x: MARGEM, y, size: 10.5, font: fontBold, color: CINZA_ESCURO });
      y -= 14;
      y = escreverParagrafo(page, String(insights.resumo_executivo), MARGEM, y, fontRegular, 9.5, LARGURA_UTIL);
      y -= 12;

      if (insights.avaliacao_personalizada) {
        novaPaginaSeNecessario(60);
        page.drawText("Avaliação personalizada", { x: MARGEM, y, size: 10.5, font: fontBold, color: CINZA_ESCURO });
        y -= 14;
        y = escreverParagrafo(page, String(insights.avaliacao_personalizada), MARGEM, y, fontRegular, 9.5, LARGURA_UTIL);
        y -= 12;
      }

      for (const { sigla } of ORDEM) {
        const detalheBloco = insights[sigla];
        if (!detalheBloco) continue;
        novaPaginaSeNecessario(70);
        page.drawText(`${sigla} — recomendação priorizada`, { x: MARGEM, y, size: 9.5, font: fontBold, color: CINZA_ESCURO });
        y -= 13;
        y = escreverParagrafo(page, String(detalheBloco.recomendacao_priorizada ?? ""), MARGEM, y, fontRegular, 9, LARGURA_UTIL);
        y -= 10;
      }
    }

    // Rodape em todas as paginas
    const paginas = pdf.getPages();
    paginas.forEach((p, i) => {
      p.drawText(`Modelo MAF-Saúde · Gerado em ${new Date().toLocaleDateString("pt-BR")}`, {
        x: MARGEM,
        y: 28,
        size: 7.5,
        font: fontRegular,
        color: CINZA_MEDIO,
      });
      const rotuloPagina = `${i + 1}/${paginas.length}`;
      p.drawText(rotuloPagina, {
        x: PAGE_W - MARGEM - fontRegular.widthOfTextAtSize(rotuloPagina, 7.5),
        y: 28,
        size: 7.5,
        font: fontRegular,
        color: CINZA_MEDIO,
      });
    });

    const bytes = await pdf.save();
    return new Response(bytes, {
      status: 200,
      headers: { "Content-Type": "application/pdf", ...CORS_HEADERS },
    });
  } catch (err) {
    console.error("Erro ao montar PDF do relatorio:", err);
    return new Response(
      JSON.stringify({ status: "erro", motivo: "falha_geracao_pdf", detalhe: String((err as Error)?.message ?? err) }),
      { status: 500, headers: { "Content-Type": "application/json", ...CORS_HEADERS } },
    );
  }
});
