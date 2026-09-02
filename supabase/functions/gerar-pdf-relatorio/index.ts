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

const AZUL = rgb(0.10, 0.28, 0.55);
const CINZA_ESCURO = rgb(0.20, 0.22, 0.25);
const CINZA_MEDIO = rgb(0.45, 0.48, 0.52);
const CINZA_CLARO = rgb(0.90, 0.91, 0.93);
const VERDE = rgb(0.16, 0.55, 0.35);
const AMARELO = rgb(0.80, 0.60, 0.10);
const VERMELHO = rgb(0.75, 0.25, 0.20);

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
  const linhas = quebrarLinhas(texto, font, tamanho, larguraMax);
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

  page.drawText(`${sigla} — ${nomeBloco}`, { x, y: y + 4, size: 10, font: fontBold, color: CINZA_ESCURO });
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
    pdf.setProducer("MAF-Saude (Weknow Healthtech)");

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
      `${conteudo.instituicao_nome ?? "—"}  ·  ${conteudo.setor_nome ?? "—"}  ·  Período: ${conteudo.periodo ?? "—"}`,
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
    page.drawText(`Nível ${nivel} — ${resumo.status ?? ""}`, { x: MARGEM, y, size: 12, font: fontBold, color: CINZA_ESCURO });
    y -= 16;
    if (resumo.rotulo_criticidade_setor) {
      page.drawText(`Criticidade do setor: ${resumo.rotulo_criticidade_setor}`, {
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
      p.drawText(`Weknow Healthtech · Modelo MAF-Saúde · Gerado em ${new Date().toLocaleDateString("pt-BR")}`, {
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
