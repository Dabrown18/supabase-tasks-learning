/**
 * Edge Function: get-task-summary
 *
 * Path:  React Native → supabase.functions.invoke('get-task-summary')
 *        → POST https://<ref>.supabase.co/functions/v1/get-task-summary
 *        → THIS FILE (TypeScript running on Deno, on Supabase's servers)
 *        → Postgres (as the calling user, so RLS still applies)
 *
 * This is YOUR server code. It is the place for logic that must not run on
 * the device: secrets, third-party APIs (Google Calendar, an LLM), multi-step
 * workflows, and webhooks. Counting tasks doesn't really need it — it's here
 * to show the moving parts.
 *
 * Runtime notes:
 *   - This file is NOT part of the React Native bundle. It is type-checked by
 *     Deno (not the app's tsc) and deployed with
 *       npx supabase functions deploy get-task-summary
 *   - Imports use `npm:` / `jsr:` specifiers, mapped in ./deno.json.
 *   - SUPABASE_URL, SUPABASE_PUBLISHABLE_KEYS, SUPABASE_SECRET_KEYS and
 *     SUPABASE_JWKS are injected automatically by the platform. Your own
 *     secrets (e.g. GOOGLE_CLIENT_SECRET) are added with `supabase secrets set`.
 */

// Type definitions for the Supabase Edge Runtime (Deno globals etc.).
import '@supabase/functions-js/edge-runtime.d.ts';
import { withSupabase } from '@supabase/server';

type TaskRow = {
  id: string;
  title: string;
  completed: boolean;
  created_at: string;
};

export default {
  /**
   * withSupabase({ auth: 'user' }) does the authentication for us, before our
   * handler runs:
   *   1. Reads `Authorization: Bearer <JWT>` from the request (the RN SDK sent
   *      the signed-in user's access token).
   *   2. Verifies the JWT's signature and expiry against the project's keys.
   *      Missing/invalid/expired → it responds 401 and our code never runs.
   *   3. Builds `ctx.supabase`: a client that forwards the SAME JWT to
   *      Postgres, so queries run as that user and RLS applies.
   *   4. Handles CORS preflight requests (only matters for web callers).
   *
   * That's why config.toml has `verify_jwt = false` for this function: the
   * platform-level check is switched off because the code verifies the token
   * itself (the pattern the Supabase CLI now generates).
   *
   * ctx.supabaseAdmin also exists — it uses the SECRET key and BYPASSES RLS.
   * We deliberately don't touch it: least privilege.
   */
  fetch: withSupabase({ auth: 'user' }, async (_req, ctx) => {
    // 1. Who is calling? (claims decoded from the verified JWT)
    const userId = ctx.userClaims?.id;
    if (!userId) {
      return Response.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // 2. Query data for that user. No `.eq('user_id', userId)` needed: RLS
    //    filters to the caller's rows because ctx.supabase carries their JWT.
    const { data, error } = await ctx.supabase
      .from('tasks')
      .select('id, title, completed, created_at')
      .order('created_at', { ascending: true });

    if (error) {
      console.error('get-task-summary query failed', error);
      return Response.json({ error: 'Could not load tasks' }, { status: 500 });
    }

    // 3. Business logic in TypeScript on the server.
    const tasks = (data ?? []) as TaskRow[];
    const completed = tasks.filter((t) => t.completed).length;
    const total = tasks.length;
    const oldestIncomplete = tasks.find((t) => !t.completed) ?? null;

    // 4. Return JSON.
    return Response.json({
      userId,
      total,
      completed,
      incomplete: total - completed,
      completionRate: total === 0 ? 0 : Math.round((completed / total) * 100),
      oldestIncompleteTask: oldestIncomplete && {
        id: oldestIncomplete.id,
        title: oldestIncomplete.title,
        created_at: oldestIncomplete.created_at,
      },
      generatedAt: new Date().toISOString(),
      source: 'edge-function',
    });
  }),
};

/* Invoke locally (requires Docker + `npx supabase start`, see SETUP.md):

  curl -i -X POST 'http://127.0.0.1:54321/functions/v1/get-task-summary' \
    --header 'Authorization: Bearer <a signed-in user access_token>' \
    --header 'apikey: <local publishable key>'
*/
