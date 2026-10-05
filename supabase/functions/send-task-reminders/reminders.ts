/**
 * Pure helpers for send-task-reminders: no network, no Supabase.
 * Kept separate so they can be unit-tested (see reminders_test.ts).
 */

/** A row returned by public.claim_due_task_reminders(). */
export type DueTask = {
  user_id: string;
  task_id: string;
  title: string;
  created_at: string;
};

export type PushTokenRow = { user_id: string; token: string };

/** The subset of Expo's push message format we use. */
export type ExpoPushMessage = {
  to: string;
  title: string;
  body: string;
  sound: 'default';
  channelId: string; // Android channel (created by the app)
  data: { type: 'task-reminder'; taskIds: string[] };
};

/** Expo's per-message result ("ticket"). */
export type ExpoPushTicket =
  | { status: 'ok'; id: string }
  | { status: 'error'; message: string; details?: { error?: string } };

export const ANDROID_CHANNEL_ID = 'task-reminders';
export const EXPO_BATCH_LIMIT = 100;

const quote = (title: string) =>
  `"${title.length > 60 ? `${title.slice(0, 57)}...` : title}"`;

/** Notification text for one user's overdue tasks (oldest first). */
export function reminderText(tasks: DueTask[]): { title: string; body: string } {
  const [first, ...rest] = tasks;
  if (rest.length === 0) {
    return {
      title: 'Task reminder',
      body: `${quote(first.title)} is still waiting to be done.`,
    };
  }
  return {
    title: `You have ${tasks.length} unfinished tasks`,
    body: `${quote(first.title)} and ${rest.length} more ${rest.length === 1 ? 'is' : 'are'} still not done.`,
  };
}

/**
 * One notification per user (not one per task), sent to every device that
 * user has registered.
 */
export function buildReminderMessages(
  dueTasks: DueTask[],
  tokens: PushTokenRow[],
): ExpoPushMessage[] {
  const tasksByUser = new Map<string, DueTask[]>();
  for (const task of dueTasks) {
    const list = tasksByUser.get(task.user_id) ?? [];
    list.push(task);
    tasksByUser.set(task.user_id, list);
  }

  const messages: ExpoPushMessage[] = [];
  for (const [userId, tasks] of tasksByUser) {
    tasks.sort((a, b) => a.created_at.localeCompare(b.created_at));
    const { title, body } = reminderText(tasks);
    for (const { token } of tokens.filter((t) => t.user_id === userId)) {
      messages.push({
        to: token,
        title,
        body,
        sound: 'default',
        channelId: ANDROID_CHANNEL_ID,
        data: { type: 'task-reminder', taskIds: tasks.map((t) => t.task_id) },
      });
    }
  }
  return messages;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Tokens Expo says are dead (app uninstalled, notifications revoked...).
 * Tickets come back in the same order as the messages we sent.
 */
export function deadTokens(messages: ExpoPushMessage[], tickets: ExpoPushTicket[]): string[] {
  return tickets.flatMap((ticket, i) =>
    ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered'
      ? [messages[i].to]
      : [],
  );
}
