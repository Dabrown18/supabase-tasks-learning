/**
 * The ONE Supabase client for the whole app.
 *
 * Layer: React Native UI → **Supabase JS SDK (this file)** → Supabase APIs → Postgres
 *
 * The client is a thin, typed wrapper around Supabase's HTTP APIs:
 *   supabase.from('tasks')...     → PostgREST   (/rest/v1/tasks)
 *   supabase.rpc('fn')            → PostgREST   (/rest/v1/rpc/fn)
 *   supabase.auth...              → Auth/GoTrue (/auth/v1/...)
 *   supabase.functions.invoke()   → Edge Functions (/functions/v1/...)
 *
 * On every request it sends two headers:
 *   apikey:        <publishable key>   — identifies the PROJECT (public)
 *   Authorization: Bearer <user JWT>   — identifies the USER (after sign-in)
 * Postgres uses the JWT to decide which RLS policies apply.
 */

// Gives the SDK a persistent `localStorage` backed by SQLite, so the session
// (access + refresh token) survives app restarts. Must be imported first.
import 'expo-sqlite/localStorage/install';

import { createClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

import type { Database } from '@/types/database';

/*
 * ENVIRONMENT VARIABLES
 *
 * Expo inlines any `process.env.EXPO_PUBLIC_*` variable into the JavaScript
 * bundle at build time. That means:
 *   - They MUST be referenced with the full static name (no destructuring,
 *     no process.env[name]) or Expo can't inline them.
 *   - Anyone can read them by unzipping the app. EXPO_PUBLIC_ == public.
 *
 * SAFE to ship in the app (designed to be public; RLS protects your data):
 *   - Project URL                     https://<ref>.supabase.co
 *   - Publishable key                 sb_publishable_...   (legacy name: "anon" key)
 *
 * NEVER ship in the app (bypass RLS = full read/write of every row):
 *   - Secret key                      sb_secret_...        (legacy name: "service_role" key)
 *   - Database password / connection string
 *   - JWT signing secret
 *   - Third-party secrets (Google client secret, OpenAI/Anthropic API keys…)
 * Those belong in Edge Function secrets (`supabase secrets set ...`).
 */
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabasePublishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

/**
 * False until you complete SETUP.md and fill in `.env`. The root layout shows
 * a "finish setup" screen instead of crashing when this is false.
 */
export const isSupabaseConfigured =
  !!supabaseUrl &&
  !!supabasePublishableKey &&
  !supabaseUrl.includes('YOUR-PROJECT-REF');

export const supabase = createClient<Database>(
  // createClient throws on an empty URL, so fall back to harmless placeholders
  // while unconfigured. No request is made in that state.
  isSupabaseConfigured ? supabaseUrl! : 'http://localhost:54321',
  isSupabaseConfigured ? supabasePublishableKey! : 'not-configured',
  {
    auth: {
      storage: localStorage,
      persistSession: true,
      // Access tokens (JWTs) are short-lived (1 hour by default). The SDK
      // swaps the refresh token for a new access token before it expires.
      autoRefreshToken: true,
      // Only relevant on the web, where OAuth redirects put tokens in the URL.
      detectSessionInUrl: false,
    },
  },
);

/*
 * On native, timers don't run reliably in the background, so tell the SDK to
 * pause/resume its token-refresh loop as the app goes to background/foreground.
 */
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}
