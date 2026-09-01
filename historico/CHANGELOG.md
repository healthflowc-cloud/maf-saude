# Changelog — Sistema MAF-Saúde

## v1.0.0 — 2026-09-01

Primeira versão do sistema (MVP "Diagnóstico Express" — Pacote 1). Escopo
decidido com o usuário: só questionário → cálculo do IAO → relatório
automático, usando a infraestrutura já existente (n8n, Supabase, Firebase,
GitHub).

**Entregue:**
- 4 subworkflows n8n (SW-00 Error Handler, SW-01 Ingestão e Validação, SW-02
  Cálculo do IAO, SW-03 Geração e Entrega do Relatório) — 35 nodes no total,
  gerados por scripts versionados (`scripts/n8n-generators/`), não editados
  à mão.
- Schema Supabase/Postgres com 6 tabelas (`instituicoes`, `setores`,
  `respostas_validadas`, `iao_calculado`, `log_auditoria`,
  `relatorios_diagnostico`), Row Level Security testada com `SET ROLE anon`
  contra um Postgres 16 real (não só revisão de código).
- Formulário público (16 itens) e página de relatório em HTML estático,
  prontos para Firebase Hosting.
- 71 testes unitários (lógica de validação, cálculo do IAO, montagem do
  relatório) + 18 testes funcionais headless (Playwright) do formulário e
  da página de relatório — todos passando nesta versão.
- Documentação técnica: `README.md`, `API_MAPEAMENTO.md` e
  `DOCUMENTACAO_TECNICA.pdf` (capa, índice navegável, tabela de aprovações,
  diagrama de arquitetura).
- Material de divulgação: 2 posts para LinkedIn (técnico e executivo), brief
  de banner e estratégia de publicação.

**Decisões de escopo registradas:**
- Sem Data Pool/Benchmarking, sem Selo MAF, sem perguntas de perfil
  (cargo/tempo de casa) — deferidas para v2.
- Piso amostral técnico do MVP = 5 respondentes (≠ piso científico oficial
  do Protocolo 7.2.2, que é maior) — todo relatório abaixo disso é marcado
  `inconclusivo_amostra_insuficiente`.
- Encadeamento entre subworkflows via HTTP fire-and-forget (não via node
  nativo "Execute Workflow" do n8n) — decisão para viabilizar entrega como
  pacote de arquivos importáveis sem coordenação de IDs pós-import.

**Pontos em aberto para v2** — ver Seção 6 (Pontos Críticos de Atenção) do
`README.md` e `DOCUMENTACAO_TECNICA.pdf`: CORS aberto em SW-01, segurança por
obscuridade nos links (sem expiração), calibração estatística dos limiares
do IAO, paginação nas consultas ao Supabase.
