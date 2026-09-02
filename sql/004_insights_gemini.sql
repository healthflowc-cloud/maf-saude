-- ============================================================================
-- MAF-Saúde — Migração 004: coluna de insights (SW-04, Gemini)
-- Projeto: MAF-Saude | Banco: Supabase (Postgres)
-- Por quê colunas novas em relatorios_diagnostico, em vez de mais uma tabela:
-- mesma lógica de 002_relatorios.sql — iao_calculado guarda os NÚMEROS,
-- relatorios_diagnostico guarda a NARRATIVA. `insights` é uma segunda camada
-- de narrativa (gerada por IA, sob demanda, pode não existir ainda ou ser
-- regenerada) sobre o mesmo relatório — não é um novo conceito de domínio,
-- não precisa de tabela própria. Fica null até o usuário clicar em "Gerar
-- análise" no dashboard (SW-04).
-- Como rodar: cole este arquivo inteiro no SQL Editor do Supabase e execute
-- DEPOIS de 001, 002 e 003. Idempotente.
-- ============================================================================

alter table public.relatorios_diagnostico
  add column if not exists insights jsonb,
  add column if not exists insights_gerado_em timestamptz;

comment on column public.relatorios_diagnostico.insights is
  'Narrativa gerada sob demanda pelo SW-04 (Gemini API) a partir de conteudo. Estrutura: { resumo_executivo, avaliacao_personalizada, VC/UI/UI/FD/CC: {fortalezas, fraquezas, recomendacao_priorizada} }. Null até o usuário pedir a análise pelo dashboard.';

-- Nenhuma mudança de RLS/grant necessária: relatorios_diagnostico já tem
-- `grant select ... to anon/authenticated` de nível de TABELA (002), então
-- as colunas novas ficam visíveis nas mesmas linhas que já eram visíveis —
-- inclusive na página pública relatorio.html, de propósito: é uma narrativa
-- sobre um score que já é público via link (mesmo modelo de "segurança por
-- capability" documentado em 002_relatorios.sql), não um dado novo sensível.
-- Só o service_role (SW-04) faz UPDATE nesta coluna.

-- ============================================================================
-- Fim da migração 004.
-- ============================================================================
