// Run with:  npm run functions:test
import { assertEquals } from 'jsr:@std/assert@1';

import { buildReminderMessages, chunk, deadTokens, reminderText, type DueTask } from './reminders.ts';

const task = (user_id: string, title: string, created_at: string): DueTask => ({
  user_id,
  task_id: `${user_id}-${title}`,
  title,
  created_at,
});

Deno.test('one task → names the task', () => {
  const { title, body } = reminderText([task('a', 'Buy milk', '2026-10-01T00:00:00Z')]);
  assertEquals(title, 'Task reminder');
  assertEquals(body, '"Buy milk" is still waiting to be done.');
});

Deno.test('several tasks → one summary, oldest task first', () => {
  const { title, body } = reminderText([
    task('a', 'Oldest', '2026-10-01T00:00:00Z'),
    task('a', 'Newer', '2026-10-02T00:00:00Z'),
    task('a', 'Newest', '2026-10-03T00:00:00Z'),
  ]);
  assertEquals(title, 'You have 3 unfinished tasks');
  assertEquals(body, '"Oldest" and 2 more are still not done.');
});

Deno.test('long titles are truncated', () => {
  const { body } = reminderText([task('a', 'x'.repeat(100), '2026-10-01T00:00:00Z')]);
  assertEquals(body.startsWith(`"${'x'.repeat(57)}..."`), true);
});

Deno.test('one message per user per device; users without devices get none', () => {
  const messages = buildReminderMessages(
    [
      task('a', 'Newer', '2026-10-02T00:00:00Z'),
      task('a', 'Older', '2026-10-01T00:00:00Z'),
      task('b', 'B task', '2026-10-01T00:00:00Z'),
      task('c', 'No device', '2026-10-01T00:00:00Z'),
    ],
    [
      { user_id: 'a', token: 'ExponentPushToken[a-phone]' },
      { user_id: 'a', token: 'ExponentPushToken[a-tablet]' },
      { user_id: 'b', token: 'ExponentPushToken[b-phone]' },
    ],
  );
  assertEquals(messages.map((m) => m.to), [
    'ExponentPushToken[a-phone]',
    'ExponentPushToken[a-tablet]',
    'ExponentPushToken[b-phone]',
  ]);
  assertEquals(messages[0].body, '"Older" and 1 more is still not done.');
  assertEquals(messages[0].data.taskIds, ['a-Older', 'a-Newer']);
  assertEquals(messages[0].channelId, 'task-reminders');
});

Deno.test('chunk splits into batches', () => {
  assertEquals(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});

Deno.test('deadTokens picks only DeviceNotRegistered', () => {
  const messages = buildReminderMessages(
    [task('a', 'T', '2026-10-01T00:00:00Z')],
    [
      { user_id: 'a', token: 'ExponentPushToken[ok]' },
      { user_id: 'a', token: 'ExponentPushToken[gone]' },
      { user_id: 'a', token: 'ExponentPushToken[other-error]' },
    ],
  );
  const dead = deadTokens(messages, [
    { status: 'ok', id: '1' },
    { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
    { status: 'error', message: 'rate', details: { error: 'MessageRateExceeded' } },
  ]);
  assertEquals(dead, ['ExponentPushToken[gone]']);
});
