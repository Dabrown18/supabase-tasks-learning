/**
 * Authentication — thin wrappers around Supabase Auth.
 *
 * Layer: UI → **SDK (supabase.auth)** → Supabase Auth API (/auth/v1) → auth.users table
 *
 * Supabase Auth checks the password, creates/reads the row in `auth.users`,
 * and returns a SESSION containing:
 *   access_token   a short-lived JWT; its `sub` claim is the user id that
 *                  auth.uid() returns inside Postgres RLS policies
 *   refresh_token  a long-lived opaque token used to get new access tokens
 * The SDK stores the session (see lib/supabase.ts) and attaches the access
 * token to every later request automatically.
 */
import { supabase } from '@/lib/supabase';
import { unregisterFromTaskReminders } from '@/services/notifications';

export async function signUp(email: string, password: string) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;

  // If "Confirm email" is ON in the Supabase dashboard (the default for hosted
  // projects), signUp succeeds but returns NO session until the user clicks
  // the link in their inbox. Tell the UI so it can show the right message.
  return { needsEmailConfirmation: data.session === null };
}

export async function signIn(email: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  // No need to return the session: AuthProvider hears about it through
  // onAuthStateChange and the router swaps screens.
}

export async function signOut() {
  // Remove this device's push token first, while we still have a session
  // (RLS only lets us delete our own row). Don't block sign-out on failure.
  await unregisterFromTaskReminders().catch(() => {});
  // Revokes the refresh token on the server and clears local storage.
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}
