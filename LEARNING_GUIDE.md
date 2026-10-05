# Learning Guide: React Native + Supabase + PostgreSQL

This guide explains the architecture of this project in plain language. Each section points at
the file where you can see the idea in code.

---

## 1. The big picture

### Path A: the app talks to the database (through Supabase's APIs)

```
React Native / Expo            src/app/*, src/hooks/*        screens, state, user input
        ↓
Supabase JavaScript SDK        src/services/*, src/lib/supabase.ts
        ↓                      builds HTTP requests, attaches the user's JWT
Supabase APIs                  PostgREST (/rest/v1), Auth (/auth/v1)
        ↓                      verifies the JWT, turns HTTP into SQL
PostgreSQL                     supabase/migrations/*
                               tables, constraints, RLS policies, functions
```

### Path B: the app calls server code you wrote

```
React Native
        ↓   supabase.functions.invoke('get-task-summary')  (+ user JWT)
Supabase Edge Function         supabase/functions/get-task-summary/index.ts
        ↓   your TypeScript, running on Supabase's servers (Deno)
PostgreSQL                     still queried as the user, so RLS still applies
```

### What each layer is responsible for

| Layer | Responsible for | NOT responsible for |
|---|---|---|
| **React Native UI** | Rendering, input, local UI state, user experience | Security. Anything on the device can be read or modified by a determined user |
| **Supabase JS SDK** | Building requests, storing and refreshing the session, attaching the JWT, typing results | Deciding who may see what |
| **Supabase APIs** | Verifying JWTs, mapping requests to Postgres roles, translating HTTP to SQL, rate limits | Your business rules (they live in Postgres or in functions) |
| **Edge Functions** | Server-only logic: secrets, third-party APIs, multi-step workflows, webhooks | Simple CRUD that RLS already covers |
| **PostgreSQL** | The data, its integrity (types, keys, constraints), **authorization (RLS)**, set-based computation | Talking to Google, OpenAI and other outside services |

The key mental shift from a classic backend: **in Path A there is no application server of
yours.** The database itself enforces who can do what. That's why RLS is essential rather
than optional.

---

## 2. What PostgreSQL is

PostgreSQL ("Postgres") is an open-source relational database, the same model you studied:
tables, rows, primary and foreign keys, SQL, ACID transactions. Things about it that matter here:

- **Rich types**: `uuid`, `timestamptz`, `jsonb`, arrays, enums. See the `tasks` table.
- **Constraints**: `not null`, `check (...)`, foreign keys with `on delete cascade`. These are
  rules the database enforces no matter which client writes.
- **Roles and GRANTs**: Postgres has its own users ("roles") and table-level permissions.
- **Row Level Security (RLS)**: per-row access rules (§5).
- **Functions and triggers**: code that runs inside the database in SQL or PL/pgSQL (§9).
- **Schemas**: namespaces inside a database. Supabase uses `public` (your tables), `auth`
  (users, managed by Supabase Auth), `storage`, and others.

## 3. What Supabase is, and how it sits on top of Postgres

Supabase is a **backend platform built around a dedicated Postgres database.** Every project
*is* a full Postgres instance. Supabase adds open-source services around it:

```
                   ┌─────────────── Supabase project ───────────────┐
 mobile app ──►    │  API gateway (checks apikey header)            │
                   │    ├─ PostgREST  /rest/v1      REST over tables │
                   │    ├─ Auth       /auth/v1      users, JWTs      │
                   │    ├─ Storage    /storage/v1   files            │
                   │    ├─ Realtime   /realtime/v1  live changes     │
                   │    └─ Edge Fns   /functions/v1 your TypeScript  │
                   │                  │                              │
                   │            PostgreSQL  ◄── Studio (dashboard)   │
                   └────────────────────────────────────────────────┘
```

- **PostgREST** reads your schema and *generates* a REST API: a `tasks` table becomes
  `/rest/v1/tasks` automatically. No controllers or routes to write.
- **Auth** (GoTrue) manages `auth.users`, passwords, OAuth providers and magic links, and
  issues JWTs.
- Everything ends up as **Postgres state**: users live in `auth.users`, file metadata in
  `storage.objects`, and authorization in RLS policies.

So "learning Supabase" is mostly learning **Postgres plus the conventions Supabase layers on top.**

## 4. How the Supabase JS client works

File: `src/lib/supabase.ts`

```ts
export const supabase = createClient<Database>(url, publishableKey, { auth: {...} });
```

The client is a typed HTTP client. Each call maps to an endpoint:

| SDK call | HTTP | SQL (roughly) |
|---|---|---|
| `from('tasks').select('*').order('created_at', {ascending:false})` | `GET /rest/v1/tasks?select=*&order=created_at.desc` | `SELECT * FROM tasks ORDER BY created_at DESC` |
| `from('tasks').insert({title}).select().single()` | `POST /rest/v1/tasks` + `Prefer: return=representation` | `INSERT ... RETURNING *` |
| `from('tasks').update({completed}).eq('id', id)` | `PATCH /rest/v1/tasks?id=eq.<id>` | `UPDATE ... WHERE id = $1` |
| `from('tasks').delete().eq('id', id)` | `DELETE /rest/v1/tasks?id=eq.<id>` | `DELETE ... WHERE id = $1` |
| `rpc('get_task_stats')` | `POST /rest/v1/rpc/get_task_stats` | `SELECT * FROM get_task_stats()` |
| `functions.invoke('get-task-summary')` | `POST /functions/v1/get-task-summary` | *(your code decides)* |
| `auth.signInWithPassword(...)` | `POST /auth/v1/token?grant_type=password` | *(Auth checks `auth.users`)* |

Every request carries two headers:

- `apikey: <publishable key>`: which **project** this is. Public.
- `Authorization: Bearer <access token>`: which **user** this is. Added after sign-in.

The SDK also **stores the session** (we give it SQLite-backed `localStorage`, so you stay signed
in across launches) and **refreshes the access token** before it expires. `AppState` starts and
stops that refresh loop when the app goes to the foreground or background.

Two behaviours that surprise people:

- The SDK **does not throw**. It returns `{ data, error }`. `services/tasks.ts` converts errors to exceptions.
- Insert, update and delete return **no rows** unless you chain `.select()`.

### Which values are safe in the mobile app?

| Value | Safe in the RN bundle? | Why |
|---|---|---|
| Project URL | ✅ | It's an address, not a credential |
| Publishable key (`sb_publishable_…`, legacy "anon") | ✅ | Only identifies the project. Requests made with it run as the `anon` role (or `authenticated` with a user JWT), and RLS limits what they can do |
| User access token / refresh token | ✅ on that user's device only | They belong to that user. Kept in device storage |
| **Secret key** (`sb_secret_…`, legacy "service_role") | ❌ **NEVER** | Runs as `service_role`, which **bypasses RLS**: full read/write of every row |
| Database password / connection string | ❌ NEVER | Direct superuser-level DB access |
| JWT secret / signing keys | ❌ NEVER | Anyone holding them can mint a token for any user |
| Google client secret, LLM API keys, etc. | ❌ NEVER | Put them in Edge Function secrets |

Rule of thumb: **anything in an app bundle is public.** `EXPO_PUBLIC_` variables are inlined into
the JavaScript and can be read from the app binary. A value is safe there only if it was
designed to be public.

## 5. What Row Level Security (RLS) is

File: `supabase/migrations/20261004225838_create_tasks_table.sql`, section 4

RLS adds **a WHERE clause that Postgres applies to every query, enforced by the database**:

```sql
alter table public.tasks enable row level security;   -- deny everything by default

create policy "Users can view their own tasks"
  on public.tasks for select to authenticated
  using ( (select auth.uid()) = user_id );
```

When the app runs `SELECT * FROM tasks`, Postgres effectively runs
`SELECT * FROM tasks WHERE auth.uid() = user_id`.

Anatomy of a policy:

| Part | Meaning |
|---|---|
| `for select / insert / update / delete` | Which command the policy covers |
| `to authenticated` | Which Postgres role it applies to (signed-in users) |
| `using (...)` | Which **existing** rows are visible or targetable (SELECT, UPDATE, DELETE) |
| `with check (...)` | Which **new or changed** row values are allowed (INSERT, UPDATE) |

Our four policies:

| Command | Rule | What an attacker would see |
|---|---|---|
| SELECT | `using (auth.uid() = user_id)` | Other users' rows are invisible. No error, just absent |
| INSERT | `with check (auth.uid() = user_id)` | Insert with someone else's `user_id` → `new row violates row-level security policy` |
| UPDATE | `using` + `with check` | Can't target others' rows (0 rows updated), and can't hand a task to someone else |
| DELETE | `using (auth.uid() = user_id)` | Deleting someone else's id affects 0 rows |

Notes:

- `(select auth.uid())` instead of bare `auth.uid()` makes Postgres evaluate it **once per
  query** rather than once per row. This is a documented Supabase performance practice.
- The index on `(user_id, created_at desc)` keeps the policy filter fast.
- **GRANTs come first.** RLS filters rows only for roles that already have table privileges.
  We `grant ... to authenticated` and give `anon` nothing.
- `service_role` and table owners **bypass** RLS. That's why the secret key must stay on servers.
- `supabase/tests/rls_check.sql` impersonates users exactly as the API does
  (`set local role authenticated` + `request.jwt.claims`) and proves each rule. Running it with
  RLS disabled makes it fail, which shows it tests the right thing.

## 6. Why RLS matters when the mobile app talks to Supabase directly

In a classic architecture, your API server is the gatekeeper. It checks the session and adds
`WHERE user_id = ?` itself. The database trusts the server.

Here **the app talks to the database API directly**, and the app is untrusted. A user can:

- decompile the app and read the URL and publishable key,
- call `/rest/v1/tasks` with `curl`,
- edit the JavaScript to remove your `.eq('user_id', ...)` filters.

None of that matters with RLS, because the rule lives in Postgres and the identity comes from a
JWT signed by Supabase Auth, which the user cannot forge. **Without RLS, the publishable key
plus the auto-generated REST API would expose the whole table to anyone.** Supabase's dashboard
warns about tables in exposed schemas that have RLS disabled for exactly this reason.

Also note `src/app/_layout.tsx`: hiding screens with `Stack.Protected` is **UX, not security.**

## 7. What Supabase Auth does

File: `src/services/auth.ts`, `src/providers/AuthProvider.tsx`

1. **Sign up** creates a row in `auth.users` (password hashed with bcrypt). It may email a
   confirmation link.
2. **Sign in** checks the password and returns a **session**:
   - `access_token`: a **JWT**, short-lived (default 1 hour)
   - `refresh_token`: long-lived and opaque, used to get new access tokens (rotated on use)
3. **Refresh**: before expiry, the SDK swaps the refresh token for a new pair.
4. **Sign out** revokes the refresh token and clears local storage.

The app reacts through `onAuthStateChange` (`INITIAL_SESSION`, `SIGNED_IN`, `SIGNED_OUT`,
`TOKEN_REFRESHED`). The root layout swaps between the sign-in screen and the task list based on
whether a session exists.

The `tasks.user_id` foreign key points at `auth.users(id)`. Auth and your data share one
database, so referential integrity works across them.

## 8. What JWTs are doing in this architecture

A JWT is `header.payload.signature`, Base64url-encoded JSON signed by Supabase Auth. A decoded
payload looks roughly like:

```json
{
  "sub": "3f1c…",           // user id → what auth.uid() returns
  "role": "authenticated",  // which Postgres role to use
  "email": "you@example.com",
  "exp": 1760000000,        // expiry
  "aud": "authenticated",
  "session_id": "…"
}
```

What happens on each request:

1. The app sends `Authorization: Bearer <JWT>`.
2. The API verifies the **signature** (so the user can't edit `sub`) and the **expiry**.
3. PostgREST opens a transaction and runs, in effect:
   `SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claims = '<payload>';`
4. Your query runs. `auth.uid()` reads `sub` from those claims, and RLS policies use it.

So the JWT is **stateless proof of identity** that crosses every layer: SDK → API gateway →
PostgREST → Postgres, and SDK → Edge Function → Postgres. No server-side session lookup is needed.

Without a user JWT (signed out), the request runs as the `anon` role.

## 9. What a PostgreSQL function is, and what RPC means

File: `supabase/migrations/20261004225840_create_task_stats_function.sql`

A Postgres function is named code stored and executed **inside the database**:

```sql
create function public.get_task_stats()
returns table (total_count bigint, completed_count bigint, incomplete_count bigint)
language sql stable security invoker set search_path = ''
as $$ select count(*), count(*) filter (where completed), ... from public.tasks
      where user_id = (select auth.uid()); $$;
```

**RPC** (Remote Procedure Call) means calling a procedure by name instead of querying a table.
PostgREST exposes every function in an exposed schema at `/rest/v1/rpc/<name>`, and the SDK wraps
it as `supabase.rpc('get_task_stats')` (see `src/services/stats.ts`).

Important keywords:

- `security invoker` (the default) runs with the **caller's** rights, so **RLS applies**.
- `security definer` runs with the **owner's** rights and **bypasses RLS**. That's useful
  (e.g. an admin report), but you must check authorization inside the function and pin
  `search_path`.
- `stable` / `immutable` / `volatile` tell the planner whether the function reads or writes data.
- `set search_path = ''` stops name-hijacking attacks. Reference objects fully qualified (`public.tasks`).
- New functions are executable by `PUBLIC` by default, so we `revoke` and then `grant` to `authenticated`.

Good uses: aggregates and reports, multi-table writes that must be **atomic** (one function
call is one transaction), and logic that should sit next to the data for performance.

## 10. What an Edge Function is

File: `supabase/functions/get-task-summary/index.ts`

An Edge Function is **TypeScript you write, running on Supabase's servers** in a Deno-based
runtime, deployed globally and exposed at `/functions/v1/<name>`. It works like a serverless
function (AWS Lambda, Cloudflare Workers) that is already integrated with your Supabase project.

Our function:

1. **Authenticates the caller.** `withSupabase({ auth: 'user' })` from `@supabase/server`
   reads the `Authorization` header, verifies the JWT, and returns 401 before your code runs
   if it's missing or invalid. (Verified locally: no token → 401 `MISSING_CREDENTIALS`, bad
   token → 401 `INVALID_JWT`.)
2. **Queries data for that user** with `ctx.supabase`, a client that forwards the user's JWT,
   so **RLS still applies**.
3. **Computes** totals, completion rate, and the oldest open task.
4. **Returns JSON.**

`ctx.supabaseAdmin` also exists. It uses the secret key and bypasses RLS. We deliberately don't
use it (least privilege). Use it only when the function must act beyond the user's own rights,
and then do your own authorization checks.

Secrets for functions are set with `npx supabase secrets set NAME=value` and read with
`Deno.env.get('NAME')`. They never reach the device.

## 11. When to use an Edge Function instead of querying Supabase directly

Query directly (Path A) when:

- it's CRUD on the user's own data and RLS expresses the rule,
- you want the least code and latency.

Use an **Edge Function** when you need:

- **Secrets**: API keys, OAuth client secrets, the service-role key
- **Third-party APIs**: Google Calendar, Stripe, an LLM, email or SMS
- **Webhooks**: Stripe or Google calling *you*
- **Privileged operations**: actions beyond the user's own rows, with checks in code
- **Orchestration**: several steps across systems (call an LLM → validate → write DB → call Google)
- **Heavy or long work**, or logic you want to change without shipping a new app build
- **Input validation that can't be expressed in SQL**, or response shaping for the client

Use a **Postgres function** (RPC) when the work is **data-centric** (aggregates, atomic
multi-row writes, complex queries) and should sit next to the data.

## 12. Postgres function vs. Edge Function

| | Postgres function (RPC) | Edge Function |
|---|---|---|
| Runs | Inside the database | On Supabase's serverless runtime (Deno) |
| Language | SQL, PL/pgSQL | TypeScript / JavaScript |
| Called via | `supabase.rpc('name')` → `/rest/v1/rpc/name` | `supabase.functions.invoke('name')` → `/functions/v1/name` |
| Data access | Direct, set-based, no network hop | Over HTTP via supabase-js (or a DB driver) |
| Transactions | The whole call is one transaction | You coordinate it; each query is separate |
| Auth | The caller's role and JWT claims; RLS applies (invoker) | You verify the JWT (helper does it); RLS applies if you forward the JWT |
| Secrets / outside world | No (well, avoid it) | Yes: env secrets, `fetch` to any API |
| Best for | Aggregates, atomic writes, data rules | Integrations, secrets, workflows, webhooks |
| Deployed by | A **migration** (`db push`) | `functions deploy` |

The compare screen (`src/app/(app)/stats.tsx`) runs a direct query (counted on the device), the
RPC, and the Edge Function side by side, with timings.

## 13. How migrations work, and where schema changes live

**All schema changes live in `supabase/migrations/` as timestamped `.sql` files.** They are the
source of truth for the database, version-controlled next to the app code.

```
supabase/migrations/
  20261004225838_create_tasks_table.sql
  20261004225840_create_task_stats_function.sql
```

Workflow:

```bash
npx supabase migration new add_due_date     # creates an empty timestamped file
# write the SQL: alter table public.tasks add column due_at timestamptz;
npx supabase db reset                        # (local, Docker) rebuild from scratch to test
npx supabase db push                         # apply new migrations to the linked project
npm run db:types                             # regenerate TypeScript types
```

- Supabase records applied migrations in `supabase_migrations.schema_migrations`. `db push`
  runs only the ones not yet applied.
- **Never edit a migration that has already run** in a shared environment. Add a new one.
- Avoid clicking schema changes in the dashboard for real projects. If you prototype there,
  capture the change with `npx supabase db diff -f name` so it becomes a migration.
- Policies, functions, triggers and grants are schema too. They belong in migrations.
- Seed data for local development goes in `supabase/seed.sql`, not in migrations.

## 14. How this differs from React Native → Node/Express → PostgreSQL

```
Classic:   RN ──► Express API (your server) ──► Postgres
                  auth middleware, routes, controllers, ORM, WHERE user_id = req.user.id

Supabase:  RN ──► PostgREST / Auth (generated)  ──► Postgres (RLS does authorization)
           RN ──► Edge Function (only where needed) ──► Postgres / third parties
```

| Concern | Node/Express | Supabase |
|---|---|---|
| API endpoints | Written by hand | Generated from the schema (PostgREST) |
| AuthN | Passport, JWT library, sessions you build | Supabase Auth, JWTs out of the box |
| AuthZ | In application code (middleware or queries) | **In the database** (RLS), plus code in Edge Functions where needed |
| DB connection | Server holds a pool and credentials | Client never connects to Postgres directly; the API layer does |
| Where a bug leaks data | Forgetting a `WHERE` in one route | Forgetting to enable RLS or writing a weak policy |
| Custom logic | Anywhere in the server | Postgres functions or Edge Functions |
| Ops | You run and scale servers | Managed. Edge Functions are serverless |
| Lock-in / portability | Portable | Postgres is portable. Auth/RLS patterns mostly are (it's all SQL); the API layer is Supabase's |

Trade-off summary: Supabase removes a lot of boilerplate and puts authorization next to the
data, where every client path must pass through it. The cost is that you must be **fluent in
SQL and RLS**, and complex business logic needs a deliberate home (RPC or Edge Function) rather
than "just add a route".

## 15. Tour: follow "tick a task" through every layer

1. `TaskRow` `onPress` → `useTasks().toggleTask(task)`
2. `services/tasks.ts` → `supabase.from('tasks').update({completed}).eq('id', id).select().single()`
3. SDK → `PATCH https://<ref>.supabase.co/rest/v1/tasks?id=eq.<id>` with `apikey` + `Authorization: Bearer <JWT>`
4. Gateway checks the `apikey`. PostgREST verifies the JWT and runs `SET LOCAL ROLE authenticated`
   plus the JWT claims
5. Postgres: GRANT allows UPDATE → RLS `using` limits it to your rows → `with check` validates
   the new row → trigger sets `updated_at` → `RETURNING *`
6. JSON row back → SDK returns `{ data }` → hook replaces the task in state → UI re-renders
