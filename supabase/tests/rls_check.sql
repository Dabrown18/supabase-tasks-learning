-- =============================================================================
-- RLS check — prove that the policies on public.tasks work.
--
-- HOW TO RUN: paste this whole file into Supabase Dashboard → SQL Editor → Run.
-- Everything happens inside one transaction that is ROLLED BACK at the end,
-- so it leaves no data behind.
--
-- WHAT IT DOES: creates two throwaway users (Alice, Bob), gives each a task,
-- then *impersonates* Alice exactly the way the Supabase API does for a real
-- request:
--     set local role authenticated;                       -- Postgres role
--     set request.jwt.claims = '{"sub": "<alice id>"}'    -- the JWT payload
-- auth.uid() reads `sub` from those claims, so the policies now apply to
-- "Alice". Any failed expectation raises an exception with a clear message.
-- =============================================================================

begin;

-- Throwaway users (as the `postgres` superuser, which bypasses RLS).
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'alice@rls-test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'bob@rls-test.local');

insert into public.tasks (user_id, title) values
  ('00000000-0000-0000-0000-00000000000a', 'Alice task'),
  ('00000000-0000-0000-0000-00000000000b', 'Bob task');

do $$
declare
  alice constant uuid := '00000000-0000-0000-0000-00000000000a';
  bob   constant uuid := '00000000-0000-0000-0000-00000000000b';
  n     bigint;
begin
  -- ---- Become Alice, the way PostgREST does for each API request ----------
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', alice, 'role', 'authenticated')::text, true);

  -- SELECT: Alice sees only her own task.
  select count(*) into n from public.tasks;
  if n <> 1 then raise exception 'SELECT: expected 1 visible task, got %', n; end if;
  raise notice 'PASS select: Alice sees only her own task';

  -- UPDATE: targeting Bob's task affects 0 rows (it is invisible to her).
  update public.tasks set title = 'hacked' where user_id = bob;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'UPDATE: Alice modified % of Bob''s rows', n; end if;
  raise notice 'PASS update: Alice cannot update Bob''s task';

  -- DELETE: same — 0 rows.
  delete from public.tasks where user_id = bob;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'DELETE: Alice deleted % of Bob''s rows', n; end if;
  raise notice 'PASS delete: Alice cannot delete Bob''s task';

  -- INSERT with default user_id: auth.uid() fills it in → allowed.
  insert into public.tasks (title) values ('Alice second task');
  raise notice 'PASS insert: Alice can insert her own task (user_id defaulted)';

  -- INSERT pretending to be Bob → rejected by the WITH CHECK clause.
  begin
    insert into public.tasks (user_id, title) values (bob, 'spoofed');
    raise exception 'INSERT: spoofed insert for Bob was allowed!';
  exception when insufficient_privilege then
    raise notice 'PASS insert: spoofing user_id is rejected (%)', sqlerrm;
  end;

  -- UPDATE that tries to give her task to Bob → rejected by WITH CHECK.
  begin
    update public.tasks set user_id = bob where user_id = alice;
    raise exception 'UPDATE: Alice re-assigned a task to Bob!';
  exception when insufficient_privilege then
    raise notice 'PASS update: re-assigning ownership is rejected';
  end;

  -- RPC function respects RLS too (SECURITY INVOKER).
  select total_count into n from public.get_task_stats();
  if n <> 2 then raise exception 'get_task_stats: expected 2, got %', n; end if;
  raise notice 'PASS rpc: get_task_stats() counts only Alice''s tasks';

  -- ---- Become a signed-out caller (anon) ------------------------------
  set local role anon;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  begin
    perform 1 from public.tasks;
    raise exception 'ANON: signed-out caller could read tasks!';
  exception when insufficient_privilege then
    raise notice 'PASS anon: signed-out callers have no access to tasks';
  end;

  reset role;
end;
$$;

select 'All RLS checks passed — see the NOTICE messages for details.' as result;

rollback;
