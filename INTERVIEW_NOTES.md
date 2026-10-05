# Interview Notes: React Native + Supabase / PostgreSQL

Short, senior-level answers. Each one points to where this project demonstrates it.

---

## Key ideas in one breath

- Supabase is **Postgres plus generated APIs plus Auth**. The mobile app talks to the database
  API directly, so **authorization lives in Postgres (RLS)**, not in a server you wrote.
- The **JWT** carries identity from Auth → SDK → API → Postgres (`auth.uid()`), and into Edge Functions.
- **Publishable key = public project identifier. Secret / service_role key = bypasses RLS,
  server-only.**
- Three execution paths: **direct query** (CRUD + RLS), **RPC** (logic inside Postgres),
  **Edge Function** (your server code: secrets, third parties, workflows).
- Schema, policies and functions live in **migrations**, in git.
- Third-party OAuth **refresh tokens live on the backend, encrypted**, never on the device.

---

## Core questions

### What is Supabase?
A backend platform built around a dedicated PostgreSQL database. It adds an auto-generated REST
API (PostgREST), Auth (JWT-based, with email and OAuth providers), Storage, Realtime, and Edge
Functions (Deno serverless), plus a dashboard and CLI. You get a Firebase-like developer
experience, but the core is standard SQL, so the data model, constraints and authorization are
portable Postgres.

### How does Supabase relate to PostgreSQL?
Postgres is the foundation and the source of truth. Supabase's services are layers over it:
PostgREST generates endpoints from your schema, Auth stores users in `auth.users`, Storage keeps
metadata in Postgres, and authorization is Postgres RLS. Requests run as real Postgres roles
(`anon`, `authenticated`, `service_role`) with JWT claims available via `auth.uid()` /
`auth.jwt()`. So most "Supabase skill" is really Postgres skill: schema design, indexes, RLS,
functions and migrations.

### Why use RLS?
Because the client talks to the database API directly, and the client is untrusted. Anyone can
extract the URL and publishable key and call the API with curl. RLS enforces per-row rules
inside Postgres for every access path (SDK, raw HTTP, Realtime, Edge Functions using the user's
JWT), and it's deny-by-default once enabled. I write explicit policies per command, using
`using` for row visibility and `with check` for new values, add indexes on the policy columns,
wrap `auth.uid()` in `(select ...)` so it's evaluated once per query, and test policies by
impersonating roles in SQL (`supabase/tests/rls_check.sql`).

### How would you secure a React Native app using Supabase?
- Ship only the URL and **publishable** key. Never the secret/service_role key, the DB
  password, or third-party secrets. Treat everything in the bundle as public.
- **RLS on every exposed table**, explicit GRANTs, nothing for `anon` unless it's intended.
- Constraints and validation in the DB (`check`, `not null`, FKs), plus validation in Edge
  Functions. The UI-side checks are only UX.
- `security invoker` functions by default. `security definer` only with internal auth checks
  and a pinned `search_path`. Revoke `EXECUTE` from `PUBLIC`.
- Secrets and privileged work in **Edge Functions**, with `service_role` used sparingly.
- Session handling: short-lived JWTs with refresh-token rotation. Consider encrypted storage
  for the session (e.g. a key in `expo-secure-store` encrypting the stored session), because
  plain SQLite/AsyncStorage isn't encrypted at rest.
- Auth hardening: email confirmation, password rules, rate limits, CAPTCHA, MFA where it fits.
- Use the dashboard's Security and Performance Advisors, and keep schema in reviewed migrations.

### When would you use an Edge Function?
When the logic needs secrets, calls third-party APIs (Google, Stripe, LLMs), receives webhooks,
needs privileges beyond the user's own rows (with explicit checks), or orchestrates multi-step
workflows. Also when it's logic I want to change without an app release. For plain CRUD that RLS
covers, I query directly, because it means less code and less latency.

### What's the difference between an Edge Function and a Postgres function?
A Postgres function runs **inside the database** in SQL or PL/pgSQL, is called through RPC
(`/rest/v1/rpc/name`), runs in one transaction, and with `security invoker` respects RLS. It's
ideal for aggregates and atomic multi-table writes. An Edge Function is **TypeScript on
Supabase's serverless runtime**, called over HTTP (`/functions/v1/name`). It can hold secrets and
reach the internet, but it talks to the DB as a client, so it has no single transaction across
calls. Rule: data-centric work goes in Postgres; integration and secret-holding work goes in an
Edge Function. Postgres functions ship through migrations; Edge Functions through `functions deploy`.

### How would you integrate Google Calendar?
Keep the app's identity (Supabase Auth) separate from calendar authorization. Add a "Connect
Google Calendar" flow: an Edge Function builds the Google auth URL with `state` and PKCE,
`access_type=offline` and the narrowest scope (`calendar.events`). The app opens it with
`expo-web-browser`. Google redirects to a callback Edge Function, which validates `state`,
exchanges the code using the **client secret**, and stores the **refresh token encrypted** in a
non-exposed schema. Calendar CRUD goes RN → Edge Function (Supabase JWT) → refresh to an access
token → Calendar API. Handle `invalid_grant` by prompting reconnect, always send time zones, and
revoke on disconnect. Details: `GOOGLE_CALENDAR_PLAN.md`.

### How would OAuth work in a React Native application?
Use the authorization code flow with **PKCE**, in the **system browser** (ASWebAuthenticationSession
or Custom Tabs via `expo-web-browser` / `expo-auth-session`), never an embedded WebView. The
redirect comes back through a custom scheme or universal link. The app never holds a client
secret, because a public client can't keep one. For *sign-in*, Supabase handles it:
`signInWithOAuth` plus PKCE code exchange, or native Google/Apple sign-in followed by
`signInWithIdToken`. For *API access on the user's behalf*, the code (or a native
`serverAuthCode`) goes to the backend, which exchanges it and keeps the tokens.

### Where should refresh tokens be stored?
- **Third-party refresh tokens (Google, etc.)**: on the **backend**, encrypted at rest
  (app-level AES-GCM with the key in secrets, or Supabase Vault), in a table the client can't
  reach, never returned to clients, revocable.
- **The app's own Supabase refresh token**: on the device, because that's what keeps the user
  signed in. Use the OS keystore (Keychain/Keystore via `expo-secure-store`) or encrypt the
  stored session with a key from it. Rotation and short-lived access tokens limit the damage if
  one is stolen. Never put tokens in logs, analytics, or unencrypted backups.

### How would an AI assistant interact with Calendar, Gmail, or Slack?
Through **tool use**, orchestrated on the backend. The app sends the user's request (plus
context such as time zone) to an Edge Function. The LLM, whose API key lives server-side, picks a
tool and returns structured arguments. The server **validates** them, asks the user to
**confirm** side effects, then executes with the user's stored OAuth credentials and narrow
scopes. The model never sees tokens. Treat tool outputs (email bodies, messages) as untrusted
input because of prompt injection, keep an audit log, and rate-limit. Details: `AI_INTEGRATION_PLAN.md`.

### What role could MCP play?
MCP standardizes how AI agents discover and call tools: MCP servers expose tools and resources,
and MCP clients inside agents consume them, with OAuth for per-user remote access. Instead of
hand-building Calendar, Gmail, Slack and M365 integrations, the backend agent becomes an MCP
client of servers for each service. We could also publish **our** app's capabilities as an MCP
server so external assistants can act on a user's tasks, still bounded by OAuth scopes and RLS.
The fundamentals don't change: least privilege, human confirmation for side effects, and
treating tool output as untrusted.

---

## Likely follow-ups

**What's the difference between `using` and `with check`?**
`using` filters which existing rows a command can see or target. `with check` validates the
row as it will be after an INSERT or UPDATE. An UPDATE policy needs both, or a user could
re-assign ownership.

**What does `security definer` do, and what's the risk?**
The function runs as its owner and bypasses RLS. Risks: privilege escalation and search-path
hijacking. Mitigations: check `auth.uid()` or roles inside, `set search_path = ''`, fully
qualify names, revoke `PUBLIC` execute, and keep these functions in non-exposed schemas where
possible.

**Why doesn't your insert send `user_id`?**
The column defaults to `auth.uid()`, and the INSERT policy's `with check` rejects any other
value. The server decides ownership; the client never asserts it.

**How do you test RLS?**
In SQL, inside a transaction: `set local role authenticated`, set `request.jwt.claims` to a
user's `sub`, then assert what is visible or allowed, and roll back. pgTAP via
`supabase test db` for CI. Also do a negative test: disabling RLS should make the test fail.

**RLS performance?**
Index the columns policies filter on, wrap `auth.uid()` in `(select ...)`, keep policies simple
(or use `security definer` helper functions for membership lookups), specify `to authenticated`
so policies aren't evaluated for `anon`, and add explicit filters in queries too, which helps
the planner.

**Multi-tenant (teams/orgs)?**
A `memberships(user_id, org_id, role)` table. Policies check
`org_id in (select org_id from memberships where user_id = (select auth.uid()))`, often through a
`security definer` helper to avoid recursive RLS. Alternatively put the org or role in custom
JWT claims via an Auth hook.

**What's the publishable key, really?**
It identifies the project to the API gateway. Requests with only that key run as `anon`. It's
designed to be public. The new `sb_publishable_`/`sb_secret_` keys replace the legacy JWT-based
anon/service_role keys and can be rotated independently of the JWT signing keys.

**How do schema changes ship?**
`supabase migration new`, then write SQL, test with `supabase db reset` locally, review in a PR,
apply with `supabase db push` in CI per environment, and regenerate types. Never edit applied
migrations. Seed data goes in `seed.sql`.

**Typed queries?**
`supabase gen types typescript` produces a `Database` type, and `createClient<Database>()`
types every `from()`, `select()` and `rpc()`. Regenerate after each migration.

**Realtime?**
Postgres changes are streamed over websockets (`supabase.channel().on('postgres_changes', …)`).
RLS applies to what each subscriber receives. Use it for live lists; unsubscribe on unmount.

**Offline?**
Supabase isn't offline-first by default. Options: optimistic updates plus a local cache (React
Query persistence), a local DB (SQLite) with a sync layer (e.g. PowerSync or WatermelonDB with
Supabase), and conflict rules (`updated_at`, last-write-wins or server-authoritative).

**Why `timestamptz`, why UUIDs?**
`timestamptz` stores an absolute instant and avoids time-zone bugs. UUID ids aren't guessable or
enumerable and can be generated client-side for offline creation.

**Expo environment variables?**
`EXPO_PUBLIC_*` values are inlined at build time and are public. Reference them statically.
Restart with `--clear` after changes. For per-environment builds use EAS environment variables.
Secrets never belong in them.

**Compared to Node/Express + Postgres?**
Supabase removes hand-written CRUD endpoints and auth plumbing, and moves authorization into
the database, where every access path is covered. The trade-off: you need strong SQL and RLS
skills, and complex domain logic needs a deliberate home (RPC or Edge Function). An Express
layer still makes sense for heavy domain logic, long-running jobs, or strict API contracts.
Supabase can coexist with it, since a Node service can verify Supabase JWTs.

---

## Push notifications (24h task reminders)

**How would you send a reminder when a task has been open for 24 hours?**
The server decides, not the phone. The app registers its Expo push token through a
`security definer` RPC that only writes `auth.uid()`. A **pg_cron** job calls an Edge Function
every 15 minutes, authenticated with a secret key stored in **Vault**. The function calls a
Postgres function that atomically finds and marks overdue tasks (`FOR UPDATE SKIP LOCKED` plus
a reminder log with `ON CONFLICT DO NOTHING`, so each reminder is sent at most once), then
sends one notification per user through the Expo Push API and deletes tokens that come back
`DeviceNotRegistered`. Local notifications can't see changes made on other devices.
(`PUSH_NOTIFICATIONS.md`)

**Why is the reminder function protected with a secret key rather than a user JWT?**
It acts across all users, so it isn't a user endpoint. Only the cron job holds the key; the
app's publishable key gets 401. Inside, it uses the service role deliberately and narrowly.

---

## Apple HealthKit (native module)

**How would you integrate Apple HealthKit into a React Native application?**
Write a small native module in Swift that owns an `HKHealthStore`, requests read access to only
the needed types, and runs HealthKit queries: `HKStatisticsQueryDescriptor` for de-duplicated
totals such as steps, `HKSampleQueryDescriptor` for workouts and sleep. Convert the results
into plain records (ISO date strings, numbers) and expose a typed promise-based API to
TypeScript. In Expo that's a local Expo module with a config plugin for the entitlement and
`NSHealthShareUsageDescription`, running in a development build. (`HEALTHKIT_GUIDE.md`)

**Would you use a React Native library or write it natively?**
It depends on scope. For broad, commodity access a maintained library saves time. For a narrow,
privacy-sensitive, product-critical integration I'd own it: a couple of hundred lines of Swift,
an exact permission surface, no transitive dependencies in the health-data path, easy to audit,
and no waiting on a maintainer when iOS changes. The cost is native maintenance and writing the
Android side separately.

**Why might you own the native HealthKit implementation?**
Control (exactly which types are requested, read and returned), auditability for health-data
compliance, upgrade independence, minimal binary and API surface, and access to new Apple APIs
on day one.

**How does React Native communicate with Swift?**
Through a native module. In the New Architecture that means **JSI**: the JS runtime holds a
host object whose methods are C++ functions that call into native code, with no JSON bridge.
The Expo Modules API generates that layer from a Swift DSL (`Name`, `Function`,
`AsyncFunction`, `Record`), converting types both ways. An `async throws` Swift closure becomes
a JS Promise, and a thrown `Exception` becomes a rejected promise with a `code`.

**How would this work with Expo?**
Create a local module (`npx create-expo-module --local`), which goes in `modules/<name>` with
an `expo-module.config.json`. Autolinking adds its podspec at `pod install`, and a config
plugin modifies the generated Xcode project during `prebuild` (entitlements, Info.plist). You
never hand-edit `ios/` (Continuous Native Generation). Build with `npx expo run:ios` or EAS Build.

**Why won't this work in Expo Go?**
Expo Go is a prebuilt binary with a fixed set of native modules and its own entitlements. It
can't include our Swift or the HealthKit entitlement. On the JS side,
`requireOptionalNativeModule` returns `null` there, and the UI explains that a development
build is needed rather than faking data.

**How do HealthKit permissions work?**
Declare the purpose string in Info.plist, sign with the HealthKit entitlement, and request
per-type read/write access at runtime. The sheet appears once; after that, users change access
in Settings → Health. Crucially, apps can't tell whether **read** access was denied, because
that would itself leak information. Denied reads look like "no data", so the UI and analytics
must not assume "no data" means "no permission". `statusForAuthorizationRequest` only says
whether the sheet would show.

**How would you securely synchronize HealthKit information with a backend?**
Only with explicit, informed consent: show exactly what is sent, and make it opt-in or
user-initiated. Send minimal **aggregates**, not raw samples. Use authenticated requests (JWT),
enforce per-user RLS, and make the write idempotent (unique `(user_id, date)` plus upsert).
Validate ranges with check constraints, encrypt in transit and at rest, keep it out of logs,
analytics and push payloads, support deletion (cascade on account deletion), set a retention
policy, and keep production health data out of dev environments.

**What privacy concerns exist when handling health information?**
It's special-category data (GDPR, potentially HIPAA). Risks include inference (pregnancy,
illness, location from workout routes), leakage through logs, crash reports, analytics, lock
screen notifications or backups, over-collection, and secondary use. Apple forbids advertising
use and requires purpose strings and justified types. Mitigations: data minimization, purpose
limitation, least-privilege access, user control and deletion, and transparency.

**How would you design the equivalent functionality on Android?**
Use **Health Connect** through a Kotlin native module, added to the same Expo module as an
`android/` folder. Declare the health permissions in the manifest and request them with Health
Connect's permission contract. Read with `aggregate` (e.g. `StepsRecord.COUNT_TOTAL`) and
`readRecords` (`ExerciseSessionRecord`, `SleepSessionRecord`), and handle Health Connect not
being installed on older Android versions. Complete Google Play's health permissions
declaration. Keep the same TypeScript interface so the screen stays platform-agnostic.
