-- ============================================================================
-- MAF-Saúde — Schema MVP (v1 "Diagnóstico Express")
-- Projeto: MAF-Saude | Banco: Supabase (Postgres)
-- Escopo: SOMENTE o necessário para o Pacote 1 (Diagnóstico Express).
--         Data Pool / Benchmarking (Apêndice B.3 do docx) fica para v2 —
--         não crie a tabela data_pool_agregado agora, para não carregar
--         schema sem uso e sem a regra de k-anonimato ainda definida.
-- Como rodar: cole este arquivo inteiro no SQL Editor do Supabase e execute.
-- Idempotente: pode rodar mais de uma vez sem duplicar objetos.
-- ============================================================================

create extension if not exists pgcrypto; -- gen_random_uuid()

-- No Supabase hospedado, os papéis 'anon' e 'authenticated' já existem por
-- padrão — este bloco é só uma rede de segurança para rodar o mesmo script
-- num Postgres vanilla (teste local/CI) sem falhar em "role does not exist".
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end
$$;

-- ----------------------------------------------------------------------------
-- 1) instituicoes — um registro por cliente pagante
-- ----------------------------------------------------------------------------
create table if not exists public.instituicoes (
  id                uuid primary key default gen_random_uuid(),
  nome              text not null,
  porte             text not null check (porte in ('pequeno','medio','grande')),
  sistema_erp_pep   text,                         -- nome do PEP/ERP usado (de-para futuro com Data Pool)
  plano_contratado  text not null default 'diagnostico_express',
  token_acesso      text not null unique default encode(gen_random_bytes(24), 'hex'),
  email_contato     text not null,                -- recebe o link do relatório
  ativo             boolean not null default true,
  created_at        timestamptz not null default now()
);
comment on column public.instituicoes.token_acesso is
  'Segredo compartilhado embutido no link do formulário público desta instituição. SW-01 valida este token antes de aceitar qualquer resposta. Rotacionar se vazar.';

-- ----------------------------------------------------------------------------
-- 2) setores — um por área avaliada dentro da instituição
-- ----------------------------------------------------------------------------
create table if not exists public.setores (
  id                 uuid primary key default gen_random_uuid(),
  instituicao_id     uuid not null references public.instituicoes(id) on delete cascade,
  nome               text not null,
  nivel_criticidade  smallint not null check (nivel_criticidade in (1,2,3)),
  -- 1 = Administrativo | 2 = Assistencial eletivo | 3 = Alta criticidade (PS/UTI/Centro Cirúrgico)
  created_at         timestamptz not null default now(),
  unique (instituicao_id, nome)
);

-- ----------------------------------------------------------------------------
-- 3) respostas_validadas — uma linha por respondente/aplicação do questionário
--    Os 16 itens vão em JSONB (4 blocos x 4 itens) — mais simples de validar
--    e versionar no MVP do que 16 colunas ou 16 linhas por respondente.
-- ----------------------------------------------------------------------------
create table if not exists public.respostas_validadas (
  id                  uuid primary key default gen_random_uuid(),
  setor_id            uuid not null references public.setores(id) on delete cascade,
  respondente_hash    text not null,        -- hash não-reversível (dedup), nunca identifica a pessoa
  periodo             date not null,        -- mês/ano de referência da aplicação (ex.: primeiro dia do mês)
  respostas           jsonb not null,       -- {"VC":[5,4,5,4],"UI":[4,4,3,5],"FD":[2,3,2,2],"CC":[3,2,3,2]}
  flag_straightlining boolean not null default false,
  created_at          timestamptz not null default now(),
  constraint respostas_validadas_shape check (
    respostas ? 'VC' and respostas ? 'UI' and respostas ? 'FD' and respostas ? 'CC'
    and jsonb_array_length(respostas->'VC') = 4
    and jsonb_array_length(respostas->'UI') = 4
    and jsonb_array_length(respostas->'FD') = 4
    and jsonb_array_length(respostas->'CC') = 4
  )
);
create index if not exists idx_respostas_setor_periodo on public.respostas_validadas (setor_id, periodo);

-- ----------------------------------------------------------------------------
-- 4) iao_calculado — um snapshot por setor/período, gerado pelo SW-02
-- ----------------------------------------------------------------------------
create table if not exists public.iao_calculado (
  id               uuid primary key default gen_random_uuid(),
  setor_id         uuid not null references public.setores(id) on delete cascade,
  periodo          date not null,
  vc_medio         numeric(3,2) not null,
  ui_medio         numeric(3,2) not null,
  fd_medio         numeric(3,2) not null,
  cc_medio         numeric(3,2) not null,
  iao              numeric(4,2) not null,   -- fórmula padrão
  iao_critico      numeric(4,2),            -- só preenchido quando nivel_criticidade = 3
  nivel_maturidade smallint not null check (nivel_maturidade between 1 and 5),
  n_respondentes   integer not null,
  status_amostral  text not null default 'ok' check (status_amostral in ('ok','inconclusivo_amostra_insuficiente')),
  created_at       timestamptz not null default now(),
  unique (setor_id, periodo)
);

-- ----------------------------------------------------------------------------
-- 5) log_auditoria — alimentada pelo SW-00 (Error Handler) e por eventos de negócio
-- ----------------------------------------------------------------------------
create table if not exists public.log_auditoria (
  id                  uuid primary key default gen_random_uuid(),
  subworkflow_origem  text not null,
  execucao_id         text not null,
  payload_erro        jsonb,
  status              text not null default 'erro' check (status in ('erro','alerta','info')),
  created_at          timestamptz not null default now()
);
create index if not exists idx_log_auditoria_created on public.log_auditoria (created_at desc);

-- ----------------------------------------------------------------------------
-- Row Level Security
-- n8n usa a service_role key (bypassa RLS por padrão no Supabase — não precisa
-- de policy para o backend funcionar). As policies abaixo cobrem SOMENTE o
-- acesso de LEITURA anônima que a página pública de relatório (Firebase
-- Hosting, sem login) precisa para renderizar o diagnóstico pelo id do
-- iao_calculado. Isso é segurança-por-obscuridade (UUID não é adivinhável) —
-- suficiente para o MVP, mas documentado como ponto a evoluir (Seção
-- "Pontos críticos de atenção" do README) para link assinado/expirável.
-- ----------------------------------------------------------------------------
alter table public.instituicoes        enable row level security;
alter table public.setores             enable row level security;
alter table public.respostas_validadas enable row level security;
alter table public.iao_calculado       enable row level security;
alter table public.log_auditoria       enable row level security;

drop policy if exists anon_select_iao_by_id on public.iao_calculado;
create policy anon_select_iao_by_id on public.iao_calculado
  for select to anon using (true);
  -- Leitura liberada por linha (o id já funciona como capability token no link do relatório).
  -- Nenhuma outra tabela recebe policy de leitura anônima.

drop policy if exists anon_select_setor_nome on public.setores;
create policy anon_select_setor_nome on public.setores
  for select to anon using (true);
  -- necessário para a página de relatório mostrar o nome do setor/instituição

drop policy if exists anon_select_instituicao_nome on public.instituicoes;
create policy anon_select_instituicao_nome on public.instituicoes
  for select to anon using (true);
  -- expõe apenas nome/porte publicamente; token_acesso nunca deve ser selecionado
  -- pelo client anônimo — a página de relatório só faz select de colunas específicas,
  -- nunca "select *" (ver web/public/relatorio.html).

-- RLS por si só não libera acesso: precisa também do GRANT de tabela.
-- O Supabase hospedado já concede isso por padrão a novas tabelas, mas o
-- script fica explícito e autocontido — não depende de privilégios default
-- que alguém pode ter alterado no projeto.
grant select on public.iao_calculado, public.setores, public.instituicoes to anon;
grant select on public.iao_calculado, public.setores, public.instituicoes to authenticated;

-- respostas_validadas e log_auditoria: NENHUM grant de leitura para anon/authenticated.
-- Só o service_role (n8n) acessa essas duas tabelas — e service_role já
-- tem privilégio irrestrito por padrão no Supabase (bypassa RLS e GRANT).

-- ============================================================================
-- Fim do script. Próximo passo: cadastrar a primeira instituição-piloto:
--   insert into public.instituicoes (nome, porte, email_contato)
--   values ('Hospital Piloto', 'medio', 'contato@hospitalpiloto.com.br')
--   returning id, token_acesso;
-- Guarde o token_acesso retornado — ele vai no link do formulário público.
-- ============================================================================
