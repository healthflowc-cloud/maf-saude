-- ============================================================================
-- MAF-Saúde — Migração 003: Auth + Autoatendimento da Instituição (Fase 3)
-- Projeto: MAF-Saude | Banco: Supabase (Postgres)
-- Objetivo: ligar `instituicoes` ao Supabase Auth (auth.users), permitindo
-- que a própria instituição se cadastre, faça login, gerencie seus setores
-- e veja o histórico de relatórios pelo dashboard — sem depender de um
-- humano (Lucas) rodando INSERT manual no SQL Editor como no piloto.
--
-- Pré-requisito: 001_init_mvp.sql e 002_relatorios.sql já rodados.
-- Como rodar: cole este arquivo inteiro no SQL Editor do Supabase e execute.
-- Idempotente: pode rodar mais de uma vez sem duplicar objetos.
--
-- ⚠️ CORREÇÃO DE SEGURANÇA incluída nesta migração (não é só feature nova):
-- 001_init_mvp.sql concedeu `grant select on instituicoes to anon` em nível
-- de TABELA. RLS restringe LINHAS, não COLUNAS — então, apesar do comentário
-- no script dizendo "expõe apenas nome/porte", QUALQUER cliente anônimo
-- podia fazer `GET /instituicoes?select=token_acesso` direto na REST API do
-- PostgREST e ler o token de acesso de TODAS as instituições, já que a
-- policy `anon_select_instituicao_nome` é `using (true)` sem filtro de
-- coluna. Isso não foi explorado nem detectado no piloto (ninguém tentou),
-- mas é uma falha real que precisa ser fechada antes de abrir cadastro
-- público — quanto mais instituições, maior a superfície e o incentivo para
-- alguém tentar. Esta migração troca o grant de tabela por um grant de
-- COLUNA (só id/nome/porte/ativo), que o Postgres aplica antes mesmo da RLS.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) instituicoes: vincular ao dono (auth.users)
-- ----------------------------------------------------------------------------
alter table public.instituicoes
  add column if not exists owner_user_id uuid references auth.users(id) on delete set null;

comment on column public.instituicoes.owner_user_id is
  'Usuário do Supabase Auth dono desta instituição (criado no cadastro via cadastro.html). Nulo para a instituição-piloto criada manualmente antes desta migração.';

create index if not exists idx_instituicoes_owner on public.instituicoes (owner_user_id);

-- --- fechar o vazamento de token_acesso descrito acima -----------------------
revoke select on public.instituicoes from anon;
revoke select on public.instituicoes from authenticated;
grant select (id, nome, porte, ativo) on public.instituicoes to anon;
-- authenticated ganha a mesma coluna limitada quando NÃO é o dono (ver policy
-- owner_select_instituicao abaixo para quando FOR o dono, que usa esta mesma
-- concessão de coluna + RLS — por isso o dono também precisa de uma policy
-- própria que libere o restante das colunas; ver nota no fim da seção 2).
grant select (id, nome, porte, ativo) on public.instituicoes to authenticated;
grant select (id, nome, porte, ativo, email_contato, token_acesso, sistema_erp_pep, plano_contratado, owner_user_id, created_at)
  on public.instituicoes to authenticated;
-- (o GRANT mais amplo acima sobrepõe o mais restrito para o mesmo role —
-- no Postgres, grants de coluna são cumulativos; deixamos assim, de propósito,
-- e é a RLS abaixo (owner_select_instituicao) que decide QUAIS LINHAS um
-- authenticated enxerga com essas colunas extras. Sem a policy, zero linhas.)

-- ----------------------------------------------------------------------------
-- 2) RLS — instituicoes: dono gerencia a própria instituição
-- ----------------------------------------------------------------------------
drop policy if exists owner_select_instituicao on public.instituicoes;
create policy owner_select_instituicao on public.instituicoes
  for select to authenticated
  using (owner_user_id = auth.uid());

drop policy if exists owner_insert_instituicao on public.instituicoes;
create policy owner_insert_instituicao on public.instituicoes
  for insert to authenticated
  with check (owner_user_id = auth.uid());
  -- Isto é o "cadastro": depois de auth.signUp() + login, o frontend faz
  -- 1 INSERT autenticado com owner_user_id = auth.uid() (nunca outro uuid —
  -- o with check rejeita). token_acesso continua sendo gerado pelo DEFAULT
  -- da coluna (gen_random_bytes), o cliente nunca envia esse campo.

drop policy if exists owner_update_instituicao on public.instituicoes;
create policy owner_update_instituicao on public.instituicoes
  for update to authenticated
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

-- Trava em nível de COLUNA: mesmo com a policy de UPDATE acima, o dono só
-- pode de fato alterar estes campos — token_acesso/owner_user_id/ativo/
-- plano_contratado ficam fora do GRANT de UPDATE, então um UPDATE que tente
-- tocar neles falha na permissão antes mesmo de avaliar a RLS.
grant insert (nome, porte, sistema_erp_pep, email_contato, owner_user_id) on public.instituicoes to authenticated;
grant update (nome, porte, sistema_erp_pep, email_contato) on public.instituicoes to authenticated;

-- ----------------------------------------------------------------------------
-- 3) RLS — setores: dono gerencia os setores da própria instituição
-- ----------------------------------------------------------------------------
grant select, insert, update, delete on public.setores to authenticated;

drop policy if exists owner_select_setores on public.setores;
create policy owner_select_setores on public.setores
  for select to authenticated
  using (
    exists (
      select 1 from public.instituicoes i
      where i.id = setores.instituicao_id and i.owner_user_id = auth.uid()
    )
  );

drop policy if exists owner_insert_setores on public.setores;
create policy owner_insert_setores on public.setores
  for insert to authenticated
  with check (
    exists (
      select 1 from public.instituicoes i
      where i.id = setores.instituicao_id and i.owner_user_id = auth.uid()
    )
  );

drop policy if exists owner_update_setores on public.setores;
create policy owner_update_setores on public.setores
  for update to authenticated
  using (
    exists (select 1 from public.instituicoes i where i.id = setores.instituicao_id and i.owner_user_id = auth.uid())
  )
  with check (
    exists (select 1 from public.instituicoes i where i.id = setores.instituicao_id and i.owner_user_id = auth.uid())
  );

drop policy if exists owner_delete_setores on public.setores;
create policy owner_delete_setores on public.setores
  for delete to authenticated
  using (
    exists (select 1 from public.instituicoes i where i.id = setores.instituicao_id and i.owner_user_id = auth.uid())
  );

-- ----------------------------------------------------------------------------
-- 4) RLS — iao_calculado / relatorios_diagnostico: dono vê o HISTÓRICO
--    completo dos seus setores (não só um id que já conhece de antemão,
--    como a policy anon_select_* de 001/002 permite para a página pública).
-- ----------------------------------------------------------------------------
drop policy if exists owner_select_iao on public.iao_calculado;
create policy owner_select_iao on public.iao_calculado
  for select to authenticated
  using (
    exists (
      select 1 from public.setores s
      join public.instituicoes i on i.id = s.instituicao_id
      where s.id = iao_calculado.setor_id and i.owner_user_id = auth.uid()
    )
  );

drop policy if exists owner_select_relatorios on public.relatorios_diagnostico;
create policy owner_select_relatorios on public.relatorios_diagnostico
  for select to authenticated
  using (
    exists (
      select 1 from public.setores s
      join public.instituicoes i on i.id = s.instituicao_id
      where s.id = relatorios_diagnostico.setor_id and i.owner_user_id = auth.uid()
    )
  );

-- ----------------------------------------------------------------------------
-- 5) respostas_validadas: DE PROPÓSITO sem nenhuma policy/grant novo aqui.
--    O próprio formulário público promete ao respondente: "suas respostas
--    são agregadas por setor — nenhuma resposta individual é exibida
--    isoladamente" (ver cabeçalho de formulario.html). Dar ao dono da
--    instituição acesso de leitura linha-a-linha quebraria essa promessa
--    (ele poderia, com poucas respostas no setor, inferir quem respondeu o
--    quê). Só o service_role (n8n) acessa esta tabela — mantém-se assim.
-- ----------------------------------------------------------------------------

-- ============================================================================
-- Fim da migração 003.
--
-- Fluxo de cadastro resultante (tudo client-side, sem precisar de n8n):
--   1. cadastro.html: supabase.auth.signUp({ email, password }) — Supabase
--      Auth cuida de hash de senha, confirmação de e-mail, sessão/JWT.
--   2. Após confirmação e login: 1 INSERT autenticado em instituicoes com
--      owner_user_id = (await supabase.auth.getUser()).data.user.id — RLS
--      valida, DEFAULT gera token_acesso.
--   3. dashboard.html: lista setores (owner_select_setores), permite criar
--      novos (owner_insert_setores), e para cada setor calcula o link do
--      formulário no próprio browser:
--      `${FORM_BASE_URL}/formulario.html?token=${instituicao.token_acesso}&setor=${setor.id}`
--      — nenhum backend novo precisa existir só para isso.
-- ============================================================================
