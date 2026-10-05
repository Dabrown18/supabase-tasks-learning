/**
 * Push notifications — the device side of the 24h task reminders.
 *
 * Layer: app → expo-notifications (permission + Expo push token)
 *            → supabase.rpc('register_push_token') → public.push_tokens
 *
 * The app only REGISTERS where to send pushes. Deciding when to remind
 * happens on the server (pg_cron → send-task-reminders Edge Function),
 * because the phone may be off, the app closed, or the user signed in
 * on several devices. See PUSH_NOTIFICATIONS.md.
 */
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

/** Must match ANDROID_CHANNEL_ID in supabase/functions/send-task-reminders. */
export const TASK_REMINDER_CHANNEL_ID = 'task-reminders';

// How notifications behave while the app is in the FOREGROUND
// (when backgrounded, the OS shows them on its own).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export type PushRegistrationResult =
  | { status: 'registered'; token: string }
  | { status: 'denied' }
  | { status: 'unavailable'; reason: string };

let registeredToken: string | null = null;

/**
 * Ask for permission, get this device's Expo push token, and store it in
 * Supabase for the signed-in user. Safe to call on every launch.
 */
export async function registerForTaskReminders(): Promise<PushRegistrationResult> {
  if (Platform.OS === 'android') {
    // Android 8+ needs a channel; users can tune it in system settings.
    await Notifications.setNotificationChannelAsync(TASK_REMINDER_CHANNEL_ID, {
      name: 'Task reminders',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const existing = await Notifications.getPermissionsAsync();
  const { status } = existing.granted ? existing : await Notifications.requestPermissionsAsync();
  if (status !== 'granted') return { status: 'denied' };

  // Expo push tokens are scoped to an EAS project. Until `eas init` has
  // written the id into app.json, push can't work (see SETUP.md).
  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) {
    return { status: 'unavailable', reason: 'No EAS projectId. Run `npx eas-cli init`.' };
  }

  let token: string;
  try {
    token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  } catch (e) {
    // e.g. Expo Go on Android, missing APNs/FCM credentials in a dev build.
    return { status: 'unavailable', reason: e instanceof Error ? e.message : String(e) };
  }

  const { error } = await supabase.rpc('register_push_token', {
    p_token: token,
    p_platform: Platform.OS === 'ios' ? 'ios' : 'android',
  });
  if (error) throw error;

  registeredToken = token;
  return { status: 'registered', token };
}

/**
 * Called before sign-out (while we still have a session, so RLS lets us
 * delete our own row) so the next user of this phone doesn't get our reminders.
 */
export async function unregisterFromTaskReminders(): Promise<void> {
  if (!registeredToken) return;
  await supabase.from('push_tokens').delete().eq('token', registeredToken);
  registeredToken = null;
}
