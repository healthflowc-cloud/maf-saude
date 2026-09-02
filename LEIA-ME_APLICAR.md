# MAF-Saúde — Pacote de mudanças (Fase 3b: rebrand, layout, dashboard geral, botões)

## Como aplicar

1. Copie os arquivos deste pacote para dentro da sua pasta local do projeto
   `MAF-Saude`, sobrescrevendo os que já existem (mesma estrutura de pastas:
   `sql/`, `supabase/functions/gerar-pdf-relatorio/`, `web/public/`,
   `subworkflows/`).
2. No GitHub Desktop: revise o diff, faça commit e push para o repositório.
3. Siga os passos de implantação abaixo (nenhum deles pode ser feito por
   mim automaticamente — são ações que só você pode confirmar).

## Passos de implantação (nesta ordem)

1. **SQL — rode `sql/005_setor_dados_e_rebrand.sql`** no SQL Editor do
   Supabase. Ele cria as colunas novas em `setores` e renomeia a
   instituição-piloto de "Weknow Healthtech" para "Hospital Modelo".
2. **Edge Function do PDF** — redeploy de `gerar-pdf-relatorio` com o
   `index.ts` novo (paleta clínico-claro + seções "Como melhorar"/"Plano de
   ação" + remoção do rodapé com marca). Mesmo processo já usado antes:
   editor inline do dashboard da Supabase (`Functions > gerar-pdf-relatorio
   > Edit function`), colar o conteúdo do arquivo e clicar em "Deploy
   updates". Se quiser, eu faço esse redeploy pelo navegador na sua próxima
   sessão comigo — só preciso que você esteja logado no dashboard.
3. **Firebase Hosting** — redeploy do conteúdo de `web/public/` (os HTML +
   `config.js` + `style.css` novos). Comando de sempre:
   `firebase deploy --only hosting` na pasta do projeto.
4. **n8n — SW-04 (opcional, baixa prioridade)**: o Code node "Montar Prompt
   (Gemini)" do workflow ativo ainda tem a string antiga "...da Weknow
   Healthtech" no `systemPrompt` enviado à IA (isso não aparece em nenhuma
   tela, mas pode vazar indiretamente em texto gerado pela IA). O código já
   foi corrigido no arquivo local `subworkflows/SW-04_codigo_preparado.md` e
   no gerador `build_sw04.py` — falta só eu (ou você) colar o texto
   corrigido no node, dentro do n8n. Posso fazer isso via navegador na
   próxima sessão.

## O que mudou (resumo funcional)

- **Rebrand**: nenhuma página, PDF ou prompt de IA menciona mais "Weknow
  Healthtech" — o produto agora é 100% white-label "MAF-Saúde". A
  instituição-piloto no banco será renomeada para "Hospital Modelo" (passo 1
  acima).
- **Visual "Clínico Claro"**: nova paleta em `style.css` (fundo
  branco/cinza muito claro, azul-petróleo `#0e4a5c` + verde-água `#14a89c`
  como destaque) aplicada em todas as páginas (login, cadastro, dashboard,
  formulário, relatório) e replicada no PDF.
- **Botões do dashboard "ligados" de verdade**: "Gerar análise", "Exportar
  PDF" e "Enviar e-mail" agora chamam os webhooks reais do SW-04/SW-05 (não
  são mais placeholders desabilitados), com estados de carregamento, erro e
  download/envio funcionando.
- **Dashboard geral por instituição**: novo card com KPIs agregados —
  setores cadastrados, pesquisas realizadas, respostas coletadas, média de
  respostas por pesquisa, nota geral (IAO médio da última rodada de cada
  setor), % de relatórios com análise de IA, % da meta de respondentes
  atingida, e uma tabela de nota individual por setor. Tudo calculado no
  navegador a partir de dados que o dono já enxerga via RLS — nenhuma
  tabela ou policy nova.
- **Mais dados de setor**: quantidade de funcionários, meta de respondentes
  (ou heurística automática: 30% do quadro, piso de 5), sistema
  informatizado avaliado, responsável e e-mail do responsável.
- **Termo de Consentimento + metodologia no formulário**: antes de
  responder, o participante vê uma explicação da metodologia
  (UTAUT+TAM+Lean Healthcare) e precisa ler e aceitar o TCLE (conforme
  Resolução 466/2012, texto do documento que você enviou) para liberar o
  questionário.
- **Relatório mais rico**: além do IAO e das médias por bloco, agora
  mostra "Pontos fortes/Oportunidades de evolução", uma seção "Como
  melhorar" com dicas práticas para o bloco mais fraco, um "Plano de ação"
  em 3 horizontes (imediato/curto/médio prazo) por nível de maturidade, e a
  análise de IA (quando já gerada) — replicado também no PDF exportado.

## Pendências residuais (documentadas, não bloqueantes)

- O aceite do Termo de Consentimento é **exigido na tela** antes de liberar
  o questionário, e é enviado no payload do webhook de intake
  (`consentimento_aceito`, `consentimento_aceito_em`) — mas o SW-01 e a
  tabela `respostas_validadas` ainda não têm uma coluna para persistir esse
  registro. Item de próxima iteração se você quiser esse dado auditável no
  banco (hoje ele só é exigido no front-end).
- Redeploy da Edge Function, do Firebase Hosting e a correção do prompt do
  SW-04 (passos 2–4 acima) dependem de você estar logado nos respectivos
  painéis — nenhum foi feito automaticamente nesta entrega.
