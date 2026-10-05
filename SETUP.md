# SETUP — getting the app running

Everything that could be built without your accounts is already built and verified
(type check, lint, `expo-doctor`, iOS + Android JS bundles, SQL migrations + RLS tests run
against an in-memory Postgres, Edge Function type-checked and run under Deno).

What's left needs **your** Supabase account. Expect ~15 minutes.

## What works right now vs. after setup

| Piece | Works now? | Needs |
|---|---|---|
| App launches | ✅ shows a "Supabase is not configured yet" screen | — |
| Sign up / in / out | ❌ | Steps 1–3 |
| Task CRUD | ❌ | Steps 1–4 |
| Stats via RPC (`get_task_stats`) | ❌ | Steps 1–4 |
| Stats via Edge Function | ❌ | Steps 1–6 |
| Google Calendar | 🚧 not built (plan only) | `GOOGLE_CALENDAR_PLAN.md` |
| AI assistant | 🚧 not built (plan only) | `AI_INTEGRATION_PLAN.md` |

---

## Prerequisites

- Node.js 20+ (you have 20.19.5)
- One of these to run the app:
  - **Expo Go** on your phone (App Store / Play Store), or
  - iOS Simulator (Xcode) / Android Emulator
- A free Supabase account: <https://supabase.com/dashboard>

You do **not** need Docker unless you want the optional fully-local setup at the end.

---

## Step 1 — Create a Supabase project ⚠️ MANUAL

1. <https://supabase.com/dashboard> → **New project**.
2. Choose a name, a strong **database password** (save it in your password manager; you'll
   need it once for `supabase link`), and the region closest to you.
3. Wait for it to finish provisioning (~2 min).
4. Note the **project ref**: the `abcdefghijklmnop` part of
   `https://supabase.com/dashboard/project/abcdefghijklmnop`.

## Step 2 — Put the two PUBLIC values in `.env` ⚠️ MANUAL

1. Dashboard → **Project Settings → API Keys**. Copy the **publishable key**
   (`sb_publishable_...`). If your project only shows legacy keys, the **anon** key works too.
2. Dashboard → **Project Settings → Data API** (or the Connect button). Copy the **Project URL**
   (`https://<ref>.supabase.co`).
3. In the project folder:

```bash
cp .env.example .env
```

4. Edit `.env` and fill in `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.

> 🚫 Do **not** copy the **secret** key (`sb_secret_...`) or the legacy **service_role** key
> into `.env`. Those bypass Row Level Security. See LEARNING_GUIDE.md §4.

## Step 3 — Auth setting for development ⚠️ MANUAL (recommended)

Hosted projects require email confirmation by default. For quick testing:

Dashboard → **Authentication → Sign In / Providers → Email** → turn **off** "Confirm email" → Save.

(If you leave it on, sign-up works but you must click the link in the email before you can sign in.
The app shows a "Check your email" alert in that case.)

## Step 4 — Create the database schema (run the migrations) ⚠️ MANUAL

Using the Supabase CLI (run through `npx`, nothing to install globally):

```bash
npx supabase login
```

```bash
npx supabase link --project-ref YOUR_PROJECT_REF
```

(it asks for the database password from Step 1)

```bash
npx supabase db push
```

This applies, in order:

- `supabase/migrations/20261004225838_create_tasks_table.sql`: table, trigger, grants, RLS policies
- `supabase/migrations/20261004225840_create_task_stats_function.sql`: the `get_task_stats()` RPC function

Check it: Dashboard → **Table Editor → tasks** shows the table with an "RLS enabled" badge, and
**Authentication → Policies** lists four policies.

<details>
<summary>No-CLI alternative</summary>

Paste each migration file into **SQL Editor** and run them in filename order. This works, but the
CLI's migration history (`supabase_migrations.schema_migrations`) won't know they ran, so a
later `db push` would try to run them again. Prefer the CLI.
</details>

## Step 5 — Prove RLS works (optional, recommended)

Dashboard → **SQL Editor** → paste the contents of `supabase/tests/rls_check.sql` → **Run**.

You should see `All RLS checks passed`. The individual PASS lines show up as notices. The
script rolls back, so it leaves no data behind.

## Step 6 — Deploy the Edge Function ⚠️ MANUAL

```bash
npx supabase functions deploy get-task-summary
```

If it complains that Docker isn't running, add `--use-api` to bundle on Supabase's servers instead.

`SUPABASE_URL` and the project keys are injected into the function automatically. **No secrets
need to be set for this function.**

## Step 7 — Generate real TypeScript types (optional)

`src/types/database.ts` was hand-written to match the migrations. Replace it with generated types:

```bash
npm run db:types
```

## Step 8 — Run the app

```bash
npx expo start --clear
```

- Press `i` for the iOS Simulator, `a` for the Android emulator, or scan the QR code with Expo Go.
- `--clear` matters after editing `.env`: `EXPO_PUBLIC_*` values are inlined at bundle time.

Then try this:

1. **Create account** with any email and a password of 6+ characters.
2. Add a few tasks, tick some off, delete one.
3. Tap **Compare: Query vs RPC vs Edge Function**. All three cards should show the same counts.
4. Dashboard → **Table Editor → tasks**: your rows, each with your `user_id`.
5. Create a **second** account and confirm it sees none of the first account's tasks. That's RLS at work.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Still shows "not configured" | `.env` not saved or Metro cache stale → `npx expo start --clear` |
| `Invalid API key` | Wrong key copied, or the URL and key belong to different projects |
| `Email not confirmed` | Step 3, or click the link in the confirmation email |
| `relation "public.tasks" does not exist` | Step 4 not done |
| `Could not find the function public.get_task_stats` | Step 4 not fully done. Also try Dashboard → Settings → Data API → reload schema |
| Edge card: `Requested function was not found` | Step 6 not done |
| Edge card: 401 / `INVALID_JWT` | Signed out, or the session expired. Sign out and back in |
| `new row violates row-level security policy` | Working as designed: something tried to write a row for another user |

---

## Optional: fully local Supabase (needs Docker Desktop)

```bash
npx supabase start
```

This runs Postgres, Auth, PostgREST, Studio and the rest in Docker, applies `supabase/migrations/`,
and prints a local API URL plus a publishable key. Put those in `.env`. Other useful commands:

```bash
npx supabase functions serve
```

```bash
npx supabase db reset
```

`db reset` wipes the local database and replays every migration from scratch. Use it to test
that your migration history really rebuilds the schema.

On a **physical phone**, `127.0.0.1` means the phone itself. Use your Mac's LAN IP
(e.g. `http://192.168.1.20:54321`) in `.env`.

---

## Optional: put the project under git

The folder is not a git repository yet:

```bash
git init && git add -A && git commit -m "Supabase learning project"
```

`.env` is already in `.gitignore`.
