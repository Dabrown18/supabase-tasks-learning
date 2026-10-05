-- =============================================================================
-- Migration: create_health_daily_summary
--
-- One row per user per day with a MINIMAL summary of Apple Health data,
-- written only when the user explicitly taps "Sync" in the app.
--
-- Privacy by design:
--   - aggregates only (counts / minutes), never raw HealthKit samples,
--     workout routes, heart rate, device names or timestamps of activities
--   - users can only see/modify their own rows (RLS)
--   - deleting the user deletes their summaries (on delete cascade)
-- =============================================================================

create table public.health_daily_summary (
  id               uuid        primary key default gen_random_uuid(),
  user_id          uuid        not null default auth.uid()
                               references auth.users (id) on delete cascade,
  -- A calendar date in the USER's local time zone (computed on the device).
  date             date        not null,
  steps            integer     not null default 0 check (steps between 0 and 200000),
  workout_minutes  integer     not null default 0 check (workout_minutes between 0 and 1440),
  -- NULL = no sleep recorded (different from 0 minutes of sleep).
  sleep_minutes    integer     check (sleep_minutes between 0 and 1440),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- Re-syncing the same day updates the row instead of creating duplicates.
  -- This constraint is what the app's upsert(onConflict: 'user_id,date') targets.
  unique (user_id, date)
);

comment on table public.health_daily_summary is
  'User-initiated daily health aggregates synced from Apple Health. No raw samples.';

-- Reuse the updated_at trigger function from the tasks migration.
create trigger health_daily_summary_set_updated_at
  before update on public.health_daily_summary
  for each row
  execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Privileges + Row Level Security (same pattern as public.tasks)
-- -----------------------------------------------------------------------------
revoke all on table public.health_daily_summary from anon;
grant select, insert, update, delete on table public.health_daily_summary to authenticated;

alter table public.health_daily_summary enable row level security;

create policy "Users can view their own health summaries"
  on public.health_daily_summary for select to authenticated
  using ( (select auth.uid()) = user_id );

-- An upsert needs BOTH insert and update policies: INSERT for a new day,
-- UPDATE when the (user_id, date) row already exists.
create policy "Users can create their own health summaries"
  on public.health_daily_summary for insert to authenticated
  with check ( (select auth.uid()) = user_id );

create policy "Users can update their own health summaries"
  on public.health_daily_summary for update to authenticated
  using      ( (select auth.uid()) = user_id )
  with check ( (select auth.uid()) = user_id );

create policy "Users can delete their own health summaries"
  on public.health_daily_summary for delete to authenticated
  using ( (select auth.uid()) = user_id );
