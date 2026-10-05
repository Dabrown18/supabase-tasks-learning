-- =============================================================================
-- Migration: create_push_reminders
--
-- Data needed to send "you still haven't finished this task" push reminders:
--
--   push_tokens       one row per device: which Expo push token belongs to which user
--   task_reminders    which tasks have already been reminded (so we never repeat)
--   register_push_token(token, platform)   called by the app (RPC)
--   claim_due_task_reminders(older_than)   called by the send-task-reminders
--                                          Edge Function (server-only)
--
-- Flow:  pg_cron (every 15 min) → Edge Function → claim_due_task_reminders()
--        → Expo Push API → APNs / FCM → the phone
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Device push tokens
-- -----------------------------------------------------------------------------
create table public.push_tokens (
  -- The Expo push token itself is the natural key: one row per device install.
  token       text        primary key
                          check (token ~ '^Expo(nent)?PushToken\[.+\]$'),
  user_id     uuid        not null references auth.users (id) on delete cascade,
  platform    text        not null check (platform in ('ios', 'android')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.push_tokens is
  'Expo push tokens per device. Written only via register_push_token().';

create index push_tokens_user_id_idx on public.push_tokens (user_id);

alter table public.push_tokens enable row level security;

-- Users can see and remove their own devices (the app deletes the token on
-- sign-out). There is deliberately NO insert/update policy: writes go through
-- register_push_token() below, which can safely re-assign a device.
revoke all on table public.push_tokens from anon;
revoke all on table public.push_tokens from authenticated;
grant select, delete on table public.push_tokens to authenticated;

create policy "Users can view their own push tokens"
  on public.push_tokens for select to authenticated
  using ( (select auth.uid()) = user_id );

create policy "Users can delete their own push tokens"
  on public.push_tokens for delete to authenticated
  using ( (select auth.uid()) = user_id );


-- -----------------------------------------------------------------------------
-- 2. register_push_token(): upsert this device's token for the caller
--
-- Why SECURITY DEFINER here? A phone can change hands: Alice signs out, Bob
-- signs in on the same device, so the same token must move from Alice to Bob.
-- Bob's RLS can't see or update Alice's row, so a plain upsert would fail.
-- This function runs as its owner (bypassing RLS) but only ever writes
-- auth.uid() — the caller can't assign a token to anyone else.
-- -----------------------------------------------------------------------------
create or replace function public.register_push_token(p_token text, p_platform text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  insert into public.push_tokens (token, user_id, platform)
  values (p_token, (select auth.uid()), p_platform)
  on conflict (token) do update
    set user_id    = excluded.user_id,
        platform   = excluded.platform,
        updated_at = now();
end;
$$;

revoke execute on function public.register_push_token(text, text) from public, anon;
grant  execute on function public.register_push_token(text, text) to authenticated;


-- -----------------------------------------------------------------------------
-- 3. Reminder log — one row per task that has been reminded
--
-- A separate table (rather than a column on tasks) keeps reminder bookkeeping
-- out of the user's data: no updated_at bumps, no RLS changes on tasks.
-- -----------------------------------------------------------------------------
create table public.task_reminders (
  task_id  uuid        primary key references public.tasks (id) on delete cascade,
  sent_at  timestamptz not null default now()
);

comment on table public.task_reminders is
  'Tasks that already received a 24h reminder. Server-only (service_role).';

-- RLS on with NO policies + no grants = invisible to the app. Only the
-- service_role (used by the Edge Function, which bypasses RLS) touches it.
alter table public.task_reminders enable row level security;
revoke all on table public.task_reminders from anon, authenticated;


-- -----------------------------------------------------------------------------
-- 4. claim_due_task_reminders(): find AND mark due tasks in one statement
--
-- "Due" = not completed, not reminded yet, older than p_older_than, and the
-- owner has at least one device to notify.
--
-- Doing the SELECT and the INSERT into task_reminders atomically means two
-- overlapping cron runs can never remind the same task twice
-- (FOR UPDATE SKIP LOCKED + ON CONFLICT DO NOTHING). The trade-off is
-- "at most once": if the push send fails afterwards, that task isn't retried.
-- -----------------------------------------------------------------------------
create or replace function public.claim_due_task_reminders(
  p_older_than interval default interval '24 hours',
  p_limit      integer  default 500
)
returns table (user_id uuid, task_id uuid, title text, created_at timestamptz)
language sql
volatile
security invoker
set search_path = ''
as $$
  with due as (
    select t.id, t.user_id, t.title, t.created_at
    from public.tasks t
    where not t.completed
      and t.created_at <= now() - p_older_than
      and not exists (select 1 from public.task_reminders r where r.task_id = t.id)
      and exists (select 1 from public.push_tokens p where p.user_id = t.user_id)
    order by t.created_at
    limit p_limit
    for update of t skip locked
  ),
  claimed as (
    insert into public.task_reminders (task_id)
    select id from due
    on conflict (task_id) do nothing
    returning task_id
  )
  select due.user_id, due.id, due.title, due.created_at
  from due
  join claimed on claimed.task_id = due.id;
$$;

comment on function public.claim_due_task_reminders(interval, integer) is
  'Marks overdue incomplete tasks as reminded and returns them. service_role only.';

-- Server-only: the app must never be able to call this.
revoke execute on function public.claim_due_task_reminders(interval, integer)
  from public, anon, authenticated;
grant execute on function public.claim_due_task_reminders(interval, integer)
  to service_role;
