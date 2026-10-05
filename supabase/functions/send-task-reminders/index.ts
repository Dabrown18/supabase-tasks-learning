/**
 * Edge Function: send-task-reminders
 *
 * Path:  pg_cron (every 15 min, inside Postgres)
 *        → pg_net HTTP POST /functions/v1/send-task-reminders  (apikey: secret key)
 *        → THIS FILE
 *        → claim_due_task_reminders()  (Postgres: find + mark overdue tasks)
 *        → Expo Push API → APNs (iOS) / FCM (Android) → the user's phone
 *
 * Unlike get-task-summary, this is NOT a per-user endpoint: it works across
 * all users, so it needs the service role. That's why:
 *   - auth is 'secret': only callers holding a Supabase SECRET key get in
 *     (the cron job reads one from Vault). The mobile app can never call it.
 *   - it uses ctx.supabaseAdmin, which bypasses RLS. That's appropriate here
 *     because the function itself decides exactly what to read and write.
 *
 * Optional request body (handy for testing):
 *   { "olderThanMinutes": 1 }   remind tasks older than 1 minute instead of 24h
 *
 * Optional function secrets:
 *   REMINDER_AFTER_HOURS   default 24
 *   EXPO_ACCESS_TOKEN      only if "Enhanced push security" is on in EAS
 */
import '@supabase/functions-js/edge-runtime.d.ts';
import { withSupabase } from '@supabase/server';

import {
  buildReminderMessages,
  chunk,
  deadTokens,
  EXPO_BATCH_LIMIT,
  type DueTask,
  type ExpoPushMessage,
  type ExpoPushTicket,
  type PushTokenRow,
} from './reminders.ts';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

async function sendToExpo(messages: ExpoPushMessage[]): Promise<ExpoPushTicket[]> {
  const accessToken = Deno.env.get('EXPO_ACCESS_TOKEN');
  const tickets: ExpoPushTicket[] = [];

  // Expo accepts at most 100 messages per request.
  for (const batch of chunk(messages, EXPO_BATCH_LIMIT)) {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(batch),
    });
    if (!res.ok) {
      throw new Error(`Expo push request failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as { data: ExpoPushTicket[] };
    tickets.push(...json.data);
  }
  return tickets;
}

async function readOlderThanMinutes(req: Request): Promise<number> {
  const defaultMinutes = Number(Deno.env.get('REMINDER_AFTER_HOURS') ?? 24) * 60;
  const body = await req.json().catch(() => ({}));
  const minutes = Number(body?.olderThanMinutes);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : defaultMinutes;
}

export default {
  fetch: withSupabase({ auth: 'secret' }, async (req, ctx) => {
    const olderThanMinutes = await readOlderThanMinutes(req);

    // 1. Find overdue, incomplete, not-yet-reminded tasks AND mark them as
    //    reminded, atomically, in Postgres (see the migration).
    const { data: due, error: claimError } = await ctx.supabaseAdmin.rpc(
      'claim_due_task_reminders',
      { p_older_than: `${olderThanMinutes} minutes` },
    );
    if (claimError) {
      console.error('claim_due_task_reminders failed', claimError);
      return Response.json({ error: 'Could not load due tasks' }, { status: 500 });
    }

    const dueTasks = (due ?? []) as DueTask[];
    if (dueTasks.length === 0) {
      return Response.json({ olderThanMinutes, dueTasks: 0, sent: 0 });
    }

    // 2. Look up the devices of the users who have due tasks.
    const userIds = [...new Set(dueTasks.map((t) => t.user_id))];
    const { data: tokenRows, error: tokenError } = await ctx.supabaseAdmin
      .from('push_tokens')
      .select('user_id, token')
      .in('user_id', userIds);
    if (tokenError) {
      console.error('push_tokens query failed', tokenError);
      return Response.json({ error: 'Could not load push tokens' }, { status: 500 });
    }

    // 3. One notification per user, to each of their devices.
    const messages = buildReminderMessages(dueTasks, (tokenRows ?? []) as PushTokenRow[]);
    const tickets = await sendToExpo(messages);

    // 4. Clean up tokens for uninstalled apps / revoked permissions.
    const dead = deadTokens(messages, tickets);
    if (dead.length > 0) {
      await ctx.supabaseAdmin.from('push_tokens').delete().in('token', dead);
    }

    const failed = tickets.filter((t) => t.status === 'error');
    if (failed.length > 0) console.warn('Some pushes failed', failed);

    return Response.json({
      olderThanMinutes,
      dueTasks: dueTasks.length,
      users: userIds.length,
      sent: tickets.length - failed.length,
      failed: failed.length,
      removedTokens: dead.length,
    });
  }),
};

/* Invoke manually (needs a SECRET key — never put it in the app):

  curl -X POST 'https://<ref>.supabase.co/functions/v1/send-task-reminders' \
    -H 'apikey: sb_secret_...' -H 'Content-Type: application/json' \
    -d '{"olderThanMinutes": 1}'
*/
