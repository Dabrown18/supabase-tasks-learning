-- =============================================================================
-- Migration: create_task_stats_function
--
-- A PostgreSQL function that computes task statistics INSIDE the database.
--
-- Supabase exposes functions in the `public` schema over HTTP:
--   POST /rest/v1/rpc/get_task_stats
-- and the JS SDK wraps that as:
--   supabase.rpc('get_task_stats')
-- "RPC" = Remote Procedure Call: you call a named procedure instead of
-- querying a table.
-- =============================================================================

create or replace function public.get_task_stats()
returns table (
  total_count      bigint,
  completed_count  bigint,
  incomplete_count bigint
)
language sql
-- STABLE: reads data but never modifies it. Lets Postgres optimise, and
-- lets the API allow calling it with GET as well as POST.
stable
-- SECURITY INVOKER (the default, written out for clarity): the function runs
-- with the CALLER's privileges, so the RLS policies on public.tasks still
-- apply. The explicit `where` below is belt-and-braces and helps the index.
--
-- The alternative, SECURITY DEFINER, runs as the function's OWNER and
-- BYPASSES RLS. Use it only deliberately, and then you must do your own
-- authorization checks inside the function.
security invoker
set search_path = ''
as $$
  select
    count(*)                                  as total_count,
    count(*) filter (where completed)         as completed_count,
    count(*) filter (where not completed)     as incomplete_count
  from public.tasks
  where user_id = (select auth.uid());
$$;

comment on function public.get_task_stats() is
  'Task counts for the calling user. Exposed via Supabase RPC.';

-- Postgres grants EXECUTE on new functions to PUBLIC (every role) by default.
-- Tighten that: only signed-in users may call it.
revoke execute on function public.get_task_stats() from public, anon;
grant  execute on function public.get_task_stats() to authenticated;
