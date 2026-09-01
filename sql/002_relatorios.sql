-- ============================================================================
-- MAF-Saúde — Migração 002: relatorios_diagnostico (gerado por SW-03)
-- Projeto: MAF-Saude | Banco: Supabase (Postgres)
-- Por quê uma tabela separada de iao_calculado, em vez de uma coluna a mais:
--   iao_calculado guarda só os NÚMEROS (fonte da verdade matemática, gerada
--   por SW-02). relatorios_diagnostico guarda a NARRATIVA/apresentação
--   (rótulos, ação recomendada, texto de aviso) gerada por SW-03 a partir
--   desses números — se o texto do relatório mudar (ex.: reescrever a ação
--   recomendada), não é preciso tocar em iao_calculado nem recalcular nada.
-- Como rodar: cole este arquivo inteiro no SQL Editor do Supabase e execute
-- DEPOIS de 001_init_mvp.sql. Idempotente: pode rodar mais de uma vez.
-- ============================================================================

create table if not exists public.relatorios_diagnostico (
  id             uuid primary key default gen_random_uuid(),
  setor_id       uuid not null references public.setores(id) on delete cascade,
  periodo        date not null,
  conteudo       jsonb not null,   -- objeto retornado por montarRelatorio() (report_logic.js)
  gerado_em      timestamptz not null default now(),
  unique (setor_id, periodo)
);
comment on column public.relatorios_diagnostico.conteudo is
  'Estrutura: { resumo_executivo, blocos, ponto_de_atencao_principal, acao_recomendada, alerta, amostra, gerado_em }. Ver report_logic.js / montarRelatorio().';

alter table public.relatorios_diagnostico enable row level security;

drop policy if exists anon_select_relatorio on public.relatorios_diagnostico;
create policy anon_select_relatorio on public.relatorios_diagnostico
  for select to anon using (true);
  -- Mesma lógica de segurança-por-obscuridade de iao_calculado (Seção "RLS"
  -- de 001_init_mvp.sql): o id/setor_id+periodo não é adivinhável em massa,
  -- suficiente para o MVP. Evoluir para link assinado/expirável é item do
  -- README ("Pontos críticos de atenção").

grant select on public.relatorios_diagnostico to anon;
grant select on public.relatorios_diagnostico to authenticated;

-- Nenhum INSERT/UPDATE/DELETE liberado para anon/authenticated — só o
-- service_role (SW-03) grava nesta tabela, via upsert em (setor_id, periodo).

-- ============================================================================
-- Fim da migração 002.
-- ============================================================================
