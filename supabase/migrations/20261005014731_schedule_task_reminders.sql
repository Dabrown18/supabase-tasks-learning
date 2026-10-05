-- =============================================================================
-- Migration: schedule_task_reminders
--
-- Runs the send-task-reminders Edge Function every 15 minutes, from INSIDE
-- Postgres:
--   pg_cron  — a job scheduler that lives in the database
--   pg_net   — lets SQL make asynchronous HTTP requests
--   Vault    — encrypted secret storage (supabase_vault, enabled by default)
--
-- No secrets live in this file. The job reads two Vault secrets at run time:
--   project_url                 https://<ref>.supabase.co
--   task_reminders_secret_key   a Supabase SECRET key (sb_secret_...)
-- They're created once by hand (see PUSH_NOTIFICATIONS.md → "Vault secrets").
-- Until they exist the job still runs, but the request has no valid key and
-- the function answers 401 — nothing breaks.
--
-- Why a secret key? The function sends notifications for ALL users, so it is
-- not a "user" endpoint. It's protected with withSupabase({ auth: 'secret' }):
-- only callers holding a secret key (this cron job) are accepted.
-- =============================================================================

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net  with schema extensions;

-- cron.schedule with a job name is an upsert: re-running this migration (or a
-- later one) with the same name replaces the job instead of duplicating it.
select cron.schedule(
  'send-task-reminders',
  '*/15 * * * *',                 -- every 15 minutes
  $job$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets
                where name = 'project_url') || '/functions/v1/send-task-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets
                 where name = 'task_reminders_secret_key')
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
  $job$
);
