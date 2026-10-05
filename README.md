# Supabase Tasks (a learning project)

A small Expo + TypeScript task app built to show how **React Native, Supabase, PostgreSQL,
Auth, Row Level Security, RPC and Edge Functions** fit together.

| Read this | For |
|---|---|
| [SETUP.md](SETUP.md) | Getting it running (needs your Supabase project) |
| [LEARNING_GUIDE.md](LEARNING_GUIDE.md) | How every layer works, and why |
| [INTERVIEW_NOTES.md](INTERVIEW_NOTES.md) | Senior-level Q&A to rehearse |
| [GOOGLE_CALENDAR_PLAN.md](GOOGLE_CALENDAR_PLAN.md) | How Google OAuth + Calendar would be added |
| [AI_INTEGRATION_PLAN.md](AI_INTEGRATION_PLAN.md) | LLM intent → Edge Function → Calendar, and where MCP fits |

## Where things live

```
src/
  app/                      Expo Router screens (UI only)
    _layout.tsx             Auth gate: Stack.Protected by session
    sign-in.tsx             Sign in / sign up
    (app)/index.tsx         Task list (CRUD)
    (app)/stats.tsx         Same stats three ways: query vs RPC vs Edge Function
  components/               Small presentational components
  hooks/useTasks.ts         React state around the task service
  providers/AuthProvider    Subscribes to the Supabase session
  services/                 ⬅ the ONLY code that talks to Supabase
    auth.ts                 supabase.auth.*
    tasks.ts                supabase.from('tasks')  → PostgREST → Postgres
    stats.ts                supabase.rpc(...) and supabase.functions.invoke(...)
    calendar.ts             🚧 placeholder for the Google Calendar plan
  lib/supabase.ts           The one Supabase client + env var rules
  types/database.ts         Typed schema (regenerate with `npm run db:types`)

supabase/
  config.toml               Supabase CLI config (local dev + function settings)
  migrations/               ⬅ ALL schema changes, version-controlled SQL
  functions/get-task-summary/   Edge Function (Deno/TypeScript, runs on Supabase)
  tests/rls_check.sql       Proves the RLS policies work
```

Follow any user action down the stack:
**screen → hook → `services/*` → Supabase SDK → Supabase API → Postgres (RLS)**.

## Scripts

| Command | What it does |
|---|---|
| `npm start` | Expo dev server |
| `npm run typecheck` / `npm run lint` | App checks |
| `npm run db:push` | Apply migrations to the linked Supabase project |
| `npm run db:types` | Regenerate `src/types/database.ts` from the real database |
| `npm run functions:deploy` | Deploy the `get-task-summary` Edge Function |
| `npm run functions:check` | Type-check the Edge Function with Deno |
