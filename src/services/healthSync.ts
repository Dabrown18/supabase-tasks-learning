/**
 * Optional, user-initiated sync of a daily health SUMMARY to Supabase.
 *
 * Flow: HealthKit → Swift module → React Native (this file builds a tiny
 *       summary) → Supabase SDK → PostgREST → public.health_daily_summary (RLS)
 *
 * Only three numbers and a date leave the device. No raw HealthKit samples,
 * workout details, timestamps or device info are uploaded.
 */
import { supabase } from '@/lib/supabase';
import type { HealthDailySummary } from '@/types/database';
import type { SleepSummary, Workout } from '@modules/health-kit';

export type DailySummaryInput = {
  date: string; // YYYY-MM-DD, device-local
  steps: number;
  workout_minutes: number;
  sleep_minutes: number | null;
};

/** Local calendar date, not UTC: "today" should match the user's day. */
export function localDateString(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Reduce what we read from HealthKit to the minimal summary we store. */
export function buildDailySummary(
  steps: number,
  workouts: Workout[],
  sleep: SleepSummary | null,
  now = new Date(),
): DailySummaryInput {
  const today = localDateString(now);
  const todaysWorkoutMinutes = workouts
    .filter((w) => localDateString(new Date(w.startDate)) === today)
    .reduce((sum, w) => sum + w.durationMinutes, 0);

  return {
    date: today,
    steps: Math.round(steps),
    workout_minutes: Math.min(1440, Math.round(todaysWorkoutMinutes)),
    sleep_minutes: sleep ? Math.min(1440, Math.round(sleep.asleepMinutes)) : null,
  };
}

/**
 * Insert or update today's row. The UNIQUE (user_id, date) constraint makes
 * this an upsert, and RLS guarantees it can only touch the caller's rows.
 */
export async function syncDailySummary(
  summary: DailySummaryInput,
): Promise<HealthDailySummary> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error('Not signed in');

  const { data, error } = await supabase
    .from('health_daily_summary')
    // user_id is sent explicitly so the ON CONFLICT (user_id, date) target is
    // unambiguous; RLS rejects it if it isn't the caller's own id.
    .upsert({ ...summary, user_id: userId }, { onConflict: 'user_id,date' })
    .select()
    .single();

  if (error) throw error;
  return data;
}
