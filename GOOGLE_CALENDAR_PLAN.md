# Google Calendar Integration Plan

> Status: 🚧 **design only.** Nothing here requires Google credentials yet. The only code
> present is the typed placeholder `src/services/calendar.ts`, which shows the shape the app
> will use.

Target architecture:

```
React Native ──(Supabase JWT)──► Supabase Edge Function ──(Google access token)──► Google Calendar API
      │                                   │
      └── opens Google consent screen     └── stores the Google REFRESH token, encrypted, server-side
```

---

## 1. Core principle: the device never holds Google's long-lived credentials

| Item | Lives where | Why |
|---|---|---|
| Google OAuth **client ID** | RN app and backend | Public identifier |
| Google OAuth **client secret** | **Edge Function secrets only** | Anyone with it can impersonate your app |
| Google **refresh token** | **Database, encrypted, server-side only** | Long-lived access to the user's calendar. Losing it is a serious breach |
| Google **access token** | Edge Function memory (optionally cached server-side) | Short-lived (~1 h). Minted from the refresh token as needed |
| Supabase session (JWT) | RN device | Identifies the user to *our* backend |

The app only ever calls **our** Edge Function with its Supabase JWT. The Edge Function looks up
that user's Google tokens and calls Google.

## 2. Two separate concerns: identity vs. calendar authorization

1. **Signing in to the app** (identity). Today that's email/password. You *could* add
   "Sign in with Google" through Supabase Auth, but it's optional and independent.
2. **Connecting Google Calendar** (authorization to call an API on the user's behalf, offline).
   This is what we need, and it should be its own explicit "Connect Google Calendar" flow.

Why keep them separate? If you request Calendar scopes during Supabase's Google sign-in,
Supabase returns `provider_token` / `provider_refresh_token` **once**, in the client session.
Supabase does **not** store or refresh them for you. You'd have to capture them on the device
and send them to the backend, which means the refresh token passes through the device. A
server-side authorization-code flow avoids that.

## 3. Google Cloud setup ⚠️ MANUAL (later)

1. Google Cloud Console → create or select a project.
2. **APIs & Services → Library → Google Calendar API → Enable.**
3. **OAuth consent screen**: app name, support email, and scopes. Add yourself as a
   **test user** while the app is in *Testing*.
   - In *Testing* status, refresh tokens **expire after 7 days**. Expect to reconnect while developing.
   - Calendar scopes are **sensitive** scopes. Production use requires Google's verification review.
4. **Credentials → Create OAuth client ID → Web application** (used by the Edge Function).
   - Authorized redirect URI: `https://<project-ref>.supabase.co/functions/v1/google-oauth-callback`
5. (Only for the native Sign-In option in §5) also create **iOS** and **Android** OAuth clients.
6. Store the secrets server-side:

```bash
npx supabase secrets set GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... TOKEN_ENCRYPTION_KEY=...
```

## 4. Scopes

Request the **narrowest** scope that works, and only when the user taps "Connect":

| Scope | Allows |
|---|---|
| `https://www.googleapis.com/auth/calendar.events.readonly` | Read events |
| `https://www.googleapis.com/auth/calendar.events` | Read **and write** events (what we need for CRUD) |
| `https://www.googleapis.com/auth/calendar` | Full calendar management. Avoid unless needed |

Auth URL parameters that matter:

- `access_type=offline`: ask for a **refresh token**
- `prompt=consent`: guarantees a refresh token is returned again on reconnect
- `include_granted_scopes=true`: incremental authorization
- `state=<random, single-use>`: CSRF protection, and how we know *which Supabase user* is connecting
- PKCE (`code_challenge` / `code_verifier`): recommended even for confidential clients

## 5. OAuth flow (recommended: server-side authorization code)

```
 RN app                       Edge Fn: google-oauth-start      Google            Edge Fn: google-oauth-callback
   │ tap "Connect Calendar"          │                           │                         │
   │──invoke (Supabase JWT)─────────►│ verify JWT → user_id      │                         │
   │                                 │ create state + PKCE,      │                         │
   │                                 │ save {state,user_id,      │                         │
   │                                 │   verifier,expires}       │                         │
   │◄────────── auth URL ────────────│                           │                         │
   │ WebBrowser.openAuthSessionAsync(url, 'supabasetasks://calendar-connected')            │
   │────────────────────────── user signs in & consents ────────►│                         │
   │                                                             │──redirect ?code&state──►│
   │                                                             │                         │ look up + delete state
   │                                                             │◄─ POST /token (code,    │ (one-time, not expired)
   │                                                             │   client_secret,        │
   │                                                             │   code_verifier) ───────│
   │                                                             │── access+refresh ──────►│ encrypt + store refresh
   │◄──────────────── 302 supabasetasks://calendar-connected?status=ok ────────────────────│
   │ refresh "connected" status                                                             │
```

React Native side (`expo-web-browser`, already a typical Expo dependency):

```ts
const { data } = await supabase.functions.invoke<{ url: string }>('google-oauth-start');
const result = await WebBrowser.openAuthSessionAsync(data!.url, 'supabasetasks://calendar-connected');
if (result.type === 'success') { /* parse status from result.url, refetch connection status */ }
```

The `supabasetasks` scheme is already configured in `app.json`.

**Alternative (native Google Sign-In SDK):** `@react-native-google-signin/google-signin` with
`offlineAccess: true` and your **web** client ID returns a one-time `serverAuthCode`. The app
sends that code to an Edge Function, which exchanges it for tokens using the client secret.
The refresh token still never touches the device. This gives a nicer native UI, but needs a
development build (not Expo Go) and iOS/Android OAuth clients.

## 6. Secure token storage (backend)

New migration, e.g. `supabase/migrations/<ts>_google_connections.sql`:

```sql
-- A schema NOT exposed through the Data API: the app can't even address it.
create schema if not exists private;

create table private.google_connections (
  user_id                  uuid primary key references auth.users (id) on delete cascade,
  google_email             text,
  scopes                   text[] not null,
  refresh_token_ciphertext text not null,   -- AES-GCM encrypted in the Edge Function
  access_token_ciphertext  text,            -- optional short-lived cache
  access_token_expires_at  timestamptz,
  connected_at             timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
alter table private.google_connections enable row level security;   -- and NO policies
revoke all on schema private from anon, authenticated;

create table private.oauth_states (
  state          text primary key,
  user_id        uuid not null references auth.users (id) on delete cascade,
  code_verifier  text not null,
  expires_at     timestamptz not null default now() + interval '10 minutes'
);

-- What the APP may know: a status, never a token.
create function public.get_calendar_connection()
returns table (connected boolean, google_email text, scopes text[])
language sql stable security definer set search_path = ''
as $$
  select true, c.google_email, c.scopes
  from private.google_connections c
  where c.user_id = (select auth.uid());
$$;
revoke execute on function public.get_calendar_connection() from public, anon;
grant  execute on function public.get_calendar_connection() to authenticated;
```

- Only Edge Functions touch `private.*`. Because the schema isn't exposed through the Data API,
  they reach it in one of two ways: narrowly scoped `security definer` functions in `public`
  that are granted **only to `service_role`** (called via `ctx.supabaseAdmin.rpc(...)`), or a
  direct Postgres connection using the `SUPABASE_DB_URL` that functions receive automatically.
- **Encrypt** refresh tokens with AES-GCM (Web Crypto in Deno) using `TOKEN_ENCRYPTION_KEY`
  from function secrets. A database dump alone then reveals nothing.
  (Alternative: **Supabase Vault**, which stores secrets encrypted at rest and exposes them only
  to privileged roles via `vault.decrypted_secrets`.)
- Never log tokens. Never return them in responses.

## 7. Calendar operations

One function `google-calendar` (matching `src/services/calendar.ts`) or one per action. Each request:

1. `withSupabase({ auth: 'user' })` → `user_id`
2. Load the connection, decrypt the refresh token
3. If there's no valid cached access token: `POST https://oauth2.googleapis.com/token`
   with `grant_type=refresh_token`
4. Call Google:

| Action | Google Calendar API v3 |
|---|---|
| Read | `GET /calendars/primary/events?timeMin=…&timeMax=…&singleEvents=true&orderBy=startTime` |
| Create | `POST /calendars/primary/events` body `{ summary, description, start:{dateTime,timeZone}, end:{…} }` |
| Update | `PATCH /calendars/primary/events/{eventId}` (partial update) |
| Delete | `DELETE /calendars/primary/events/{eventId}` |

Base URL: `https://www.googleapis.com/calendar/v3`.

5. Map Google's response to our `CalendarEvent` type and return it.

Error handling:

- `invalid_grant` on refresh → the user revoked access or the token expired → delete the
  connection and return `409 { error: 'calendar_reconnect_required' }` so the app can prompt.
- 401 from Calendar → refresh once and retry.
- 429 / 5xx → backoff.
- **Always send an explicit `timeZone`** (from the device, e.g.
  `Intl.DateTimeFormat().resolvedOptions().timeZone`).

Disconnect: an Edge Function calls `https://oauth2.googleapis.com/revoke?token=<refresh>` and
then deletes the row.

Optional task ↔ event link: add `google_event_id text` to `public.tasks` in a migration.

## 8. Responsibilities

| React Native | Backend (Edge Functions + Postgres) |
|---|---|
| "Connect / Disconnect Google Calendar" UI | Build the Google auth URL, `state`, PKCE |
| Open the system browser (`expo-web-browser`) | OAuth callback: validate `state`, exchange code with **client secret** |
| Handle the deep link back (`supabasetasks://…`) | Encrypt and store the **refresh token**; never return it |
| Show connection status (via RPC, no tokens) | Mint and cache access tokens; handle `invalid_grant` |
| Collect event input; send the device time zone | Call the Calendar API (list / create / update / delete) |
| Call `supabase.functions.invoke('google-calendar')` | Validate input, enforce per-user limits, log (without tokens) |
| Display events and errors | Revoke on disconnect |

## 9. Files to add later

```
supabase/migrations/<ts>_google_connections.sql
supabase/functions/_shared/google.ts          token exchange/refresh + crypto helpers
supabase/functions/google-oauth-start/index.ts
supabase/functions/google-oauth-callback/index.ts   # verify_jwt = false: Google calls it; `state` is the auth
supabase/functions/google-calendar/index.ts
src/services/calendar.ts                       # exists as a placeholder
src/app/(app)/calendar.tsx                     # UI
```
