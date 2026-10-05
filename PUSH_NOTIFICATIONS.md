# Push Notifications: 24-hour task reminders

**Feature:** if a task is still incomplete 24 hours after it was created, the user gets a push
notification. Each task is reminded once, and a user with several overdue tasks gets one
notification that summarizes them, not one per task.

## 1. Architecture

```
          ┌──────────────── on the phone ────────────────┐
App start │ expo-notifications: ask permission            │
          │ → Expo push token  "ExponentPushToken[...]"   │
          │ → supabase.rpc('register_push_token')  ───────┼──► public.push_tokens
          └──────────────────────────────────────────────┘

          ┌──────────────── inside Supabase ─────────────────────────────────────┐
every     │ pg_cron job ──pg_net HTTP POST (apikey = secret key from Vault)──┐   │
15 min    │                                                                   ▼   │
          │ Edge Function send-task-reminders  (auth: 'secret', supabaseAdmin)   │
          │   1. claim_due_task_reminders('24 hours')  → overdue tasks, marked    │
          │   2. select push_tokens for those users                              │
          │   3. POST https://exp.host/--/api/v2/push/send                       │
          │   4. delete tokens Expo reports as DeviceNotRegistered               │
          └──────────────────────────────────────────────────────────────────────┘
                                         │
                       Expo Push Service → APNs (iOS) / FCM (Android) → phone
```

### Why the server decides, not the phone
A local notification scheduled on the phone ("remind me in 24 h") would be simpler, but:
- it can't know about tasks created or completed on **another device**,
- it would have to be rescheduled or cancelled on every edit,
- it isn't a *push* notification, so it doesn't teach the backend half.

The server already has the source of truth (the `tasks` table), so it's the right place to
decide. The phone only says *where* to deliver.

### Why pg_cron + an Edge Function
- **pg_cron** is a scheduler that runs inside Postgres, so there's no separate cron server.
- **pg_net** lets SQL make HTTP calls, which is how the cron job calls the function.
- **Edge Function**: calling Expo's HTTP API (and optionally holding `EXPO_ACCESS_TOKEN`) is
  integration work, which is the Edge Function's job (LEARNING_GUIDE §11).
- **`claim_due_task_reminders()`** is a Postgres function because "find overdue tasks and
  mark them reminded" must be **atomic**. Doing it in one SQL statement, with
  `FOR UPDATE SKIP LOCKED` and `ON CONFLICT DO NOTHING`, means two overlapping runs can never
  send the same reminder twice.

## 2. The pieces

| File | Role |
|---|---|
| `supabase/migrations/…_create_push_reminders.sql` | `push_tokens` (RLS), `task_reminders` (server-only), `register_push_token()`, `claim_due_task_reminders()` |
| `supabase/migrations/…_schedule_task_reminders.sql` | Enables pg_cron and pg_net, and schedules the job every 15 minutes |
| `supabase/functions/send-task-reminders/index.ts` | The Edge Function |
| `supabase/functions/send-task-reminders/reminders.ts` | Pure message-building logic (unit-tested in `reminders_test.ts`) |
| `src/services/notifications.ts` | Permission, token, register/unregister |
| `src/hooks/useTaskReminders.ts` | Registers after sign-in; the task screen shows the status |
| `src/services/auth.ts` | `signOut()` deletes this device's token first |

## 3. Security design (worth explaining in an interview)

| Decision | Why |
|---|---|
| `push_tokens` has **no insert/update policy**; writes go only through `register_push_token()` | The function is `security definer`, so it can move a token when a phone changes hands (Alice signs out, Bob signs in), but it only ever writes `auth.uid()` |
| Users can **select/delete** their own tokens | Transparency, and sign-out cleanup |
| `task_reminders` has RLS on, **no policies, no grants** | Invisible to the app; only `service_role` touches it |
| `claim_due_task_reminders()` is **executable only by `service_role`** | The app must never trigger a sweep across all users |
| The function uses `withSupabase({ auth: 'secret' })` | Only a caller holding a **secret key** gets in. Verified locally: no key, the publishable key, or a wrong key all get **401** |
| The secret key lives in **Vault**, never in a migration or the repo | Migrations are in git. The cron job reads the key from encrypted storage at run time |
| Reminders are **at most once** | We mark first, then send. If Expo is down, that reminder is skipped, not repeated. Spamming users is worse than missing one reminder |

## 4. Manual setup ⚠️

### A. Get an EAS project id (required for Expo push tokens)

```bash
npx eas-cli@latest login
```

```bash
npx eas-cli@latest init
```

This creates a free Expo project and writes `extra.eas.projectId` into `app.json`. Until then,
the task screen shows "Reminders unavailable: No EAS projectId".

### B. Credentials, depending on how you run the app

| Where | Works? | What's needed |
|---|---|---|
| **Expo Go on a physical iPhone** | ✅ easiest | Just step A |
| Expo Go on Android | ❌ | Expo Go dropped remote push on Android in SDK 53. Use a development build |
| **iOS development build** (`npx expo run:ios`) | ✅ | A **paid Apple Developer account** and an APNs key: `npx eas-cli@latest credentials` → iOS → Push Notifications. Without it, getting a token fails, and the app shows the reason instead of crashing |
| iOS Simulator | ⚠️ partly | Simulators (Xcode 14+, Apple Silicon) can register, but sending still needs APNs credentials. To check how a notification *looks* without a server: `xcrun simctl push booted <bundle id> payload.apns` |
| Android development build | ✅ | Firebase project + FCM V1 credentials uploaded via `eas credentials` |

### C. Deploy the backend

```bash
npx supabase db push
```

```bash
npx supabase functions deploy send-task-reminders --use-api
```

### D. Store the two Vault secrets (once, in Dashboard → SQL Editor)

Recommended: create a **dedicated** secret key for this job, so you can revoke it without
touching anything else. Go to Dashboard → **Project Settings → API Keys → Secret keys → New
secret key**, name it `reminders-cron`, and copy it. Then run:

```sql
select vault.create_secret('https://tbgakdwbjhcbpcmuahzm.supabase.co', 'project_url');
select vault.create_secret('PASTE_THE_sb_secret_KEY_HERE', 'task_reminders_secret_key');
```

Run this yourself in the SQL Editor. Never commit the key or paste it into chat. To rotate it
later: `select vault.update_secret((select id from vault.secrets where name = 'task_reminders_secret_key'), 'NEW_KEY');`

### E. Test it without waiting 24 hours

1. Run the app and sign in. The task screen should say "🔔 Reminders on".
2. Add a task.
3. Trigger the function with a 1-minute threshold:

```bash
curl -X POST 'https://tbgakdwbjhcbpcmuahzm.supabase.co/functions/v1/send-task-reminders' \
  -H 'apikey: YOUR_sb_secret_KEY' -H 'Content-Type: application/json' \
  -d '{"olderThanMinutes": 1}'
```

The response looks like `{"dueTasks":1,"users":1,"sent":1,...}`, and the notification arrives.

To check the scheduled job is healthy, run in the SQL Editor:

```sql
select jobname, schedule, active from cron.job;
select status, return_message, start_time from cron.job_run_details order by start_time desc limit 5;
select status_code, content::text, created from net._http_response order by created desc limit 5;
```

A `401` in `net._http_response` means the Vault secret from step D is missing or wrong.

## 5. Behaviour details

- **Threshold:** 24 hours after `created_at`. Change it with
  `npx supabase secrets set REMINDER_AFTER_HOURS=12`.
- **Granularity:** the job runs every 15 minutes, so a reminder arrives 24h–24h15m after creation.
- **Completed before 24h:** never reminded.
- **Re-opened after a reminder:** not reminded again, because `task_reminders` remembers it.
- **No device registered:** the task isn't claimed. If the user enables notifications later,
  they get one reminder for it.
- **Signed out:** the device token is deleted, so the next user of that phone doesn't get your reminders.
- **App uninstalled:** Expo returns `DeviceNotRegistered`, and the function deletes the token.
