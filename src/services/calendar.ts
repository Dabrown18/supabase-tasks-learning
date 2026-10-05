/**
 * ⚠️ NOT IMPLEMENTED YET — placeholder for GOOGLE_CALENDAR_PLAN.md.
 *
 * Shows where Google Calendar access will plug in. Nothing in the UI calls
 * this yet, and the `google-calendar` Edge Function does not exist yet.
 *
 * The important design decision is already visible: the app NEVER talks to
 * Google's Calendar API directly and NEVER holds a Google refresh token. It
 * calls our own Edge Function with its Supabase JWT; the function looks up
 * the user's stored Google tokens server-side and calls Google.
 *
 *   RN → supabase.functions.invoke('google-calendar') → Edge Function
 *      → (stored, encrypted refresh token) → Google Calendar API
 */
import { supabase } from '@/lib/supabase';

export type CalendarEvent = {
  id: string;
  summary: string;
  start: string; // ISO 8601
  end: string; // ISO 8601
  description?: string;
};

export type NewCalendarEvent = Omit<CalendarEvent, 'id'>;

type CalendarRequest =
  | { action: 'list'; timeMin: string; timeMax: string }
  | { action: 'create'; event: NewCalendarEvent }
  | { action: 'update'; eventId: string; event: Partial<NewCalendarEvent> }
  | { action: 'delete'; eventId: string };

async function callCalendarFunction<T>(body: CalendarRequest): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>('google-calendar', { body });
  if (error) throw error;
  return data as T;
}

export const listEvents = (timeMin: string, timeMax: string) =>
  callCalendarFunction<CalendarEvent[]>({ action: 'list', timeMin, timeMax });

export const createEvent = (event: NewCalendarEvent) =>
  callCalendarFunction<CalendarEvent>({ action: 'create', event });

export const updateEvent = (eventId: string, event: Partial<NewCalendarEvent>) =>
  callCalendarFunction<CalendarEvent>({ action: 'update', eventId, event });

export const deleteEvent = (eventId: string) =>
  callCalendarFunction<void>({ action: 'delete', eventId });
