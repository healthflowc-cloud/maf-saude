-- ============================================================================
-- MAF-Saúde — Migração 005: dados adicionais de setor + rebrand da instituição-piloto
-- Projeto: MAF-Saude | Banco: Supabase (Postgres)
--
-- Duas mudanças independentes, agrupadas num único arquivo por terem sido
-- pedidas juntas (ajustes de 02/09/2026):
--
-- 1) Novos campos em `setores`, usados por três funcionalidades novas do
--    frontend: (a) contexto do setor mostrado no dashboard, (b) cálculo da
--    "meta" de respondentes no Dashboard Geral (novo agregado por
--    instituição), (c) rastreabilidade/governança (quem é o responsável
--    pelo setor — relevante para o perfil de Analista de Governança).
--
-- 2) Rebranding da instituição-piloto: ela foi criada via INSERT manual no
--    SQL Editor (antes da Fase 3 existir) com o nome literal
--    "Weknow Healthtech" — o próprio nome comercial da empresa que constrói
--    o produto, não deveria estar em dado de cliente-piloto. Renomeada para
--    "Hospital Modelo" (nome genérico, sem vínculo com nenhuma marca real).
--
-- Como rodar: cole este arquivo inteiro no SQL Editor do Supabase e execute
-- DEPOIS de 001, 002, 003 e 004. Idempotente (colunas com IF NOT EXISTS; o
-- UPDATE da seção 2 é condicionado ao nome atual, então rodar de novo não
-- muda nada se já tiver sido renomeada).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) setores — campos adicionais
-- ----------------------------------------------------------------------------
alter table public.setores
  add column if not exists quantidade_funcionarios integer check (quantidade_funcionarios is null or quantidade_funcionarios >= 0),
  add column if not exists meta_respondentes        integer check (meta_respondentes is null or meta_respondentes > 0),
  add column if not exists sistema_principal         text,
  add column if not exists responsavel_nome          text,
  add column if not exists responsavel_email         text;

comment on column public.setores.quantidade_funcionarios is
  'Nº de funcionários do setor (informado pela instituição). Usado para calcular a meta de respondentes quando meta_respondentes não é preenchida explicitamente (heurística: maior valor entre 5 e 30% do quadro — mesmo piso citado no aviso de amostra inconclusiva, Protocolo 7.2.2).';
comment on column public.setores.meta_respondentes is
  'Meta explícita de respondentes por aplicação do questionário neste setor. Se nula, o Dashboard Geral usa a heurística de quantidade_funcionarios (ver comentário acima) ou 5 como piso absoluto.';
comment on column public.setores.sistema_principal is
  'Nome do sistema informatizado (PEP/ERP/prontuário) que este setor usa no dia a dia — é o SISTEMA sendo avaliado pelo questionário UTAUT/TAM, não a instituição inteira (uma instituição pode ter setores em sistemas diferentes).';
comment on column public.setores.responsavel_nome is
  'Nome do responsável/champion do setor para fins de governança e rastreabilidade (quem acompanha o diagnóstico e a ação recomendada) — dado operacional da instituição-cliente, não um dado de pesquisa/participante do questionário (esses permanecem anônimos, ver respostas_validadas).';
comment on column public.setores.responsavel_email is
  'E-mail do responsável do setor — opcional, usado como destino sugerido ao enviar o relatório por e-mail (SW-05).';

-- Nenhuma mudança de grant/RLS necessária: 003_auth_instituicoes.sql já
-- concede select/insert/update/delete de TABELA (não por coluna) para
-- authenticated em setores — colunas novas ficam automaticamente
-- acessíveis/editáveis pelo dono, nas mesmas linhas que já eram.

-- ----------------------------------------------------------------------------
-- 2) Rebrand da instituição-piloto
-- ----------------------------------------------------------------------------
update public.instituicoes
set nome = 'Hospital Modelo'
where id = 'ae659848-222e-4f54-ac22-97d3f25aa3ce'
  and nome = 'Weknow Healthtech';

-- Conferir o resultado:
-- select id, nome, owner_user_id from public.instituicoes where id = 'ae659848-222e-4f54-ac22-97d3f25aa3ce';

-- ============================================================================
-- Fim da migração 005.
-- ============================================================================
