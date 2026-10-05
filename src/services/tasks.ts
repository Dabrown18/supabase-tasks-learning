/**
 * Task CRUD — "React Native → Supabase SDK → PostgREST → Postgres" directly.
 *
 * Every function here builds an HTTP request to PostgREST, Supabase's
 * auto-generated REST API over your Postgres tables. For example
 *
 *   supabase.from('tasks').select('*').order('created_at', { ascending: false })
 *
 * becomes   GET /rest/v1/tasks?select=*&order=created_at.desc
 * becomes   SELECT * FROM public.tasks ORDER BY created_at DESC
 *
 * Notice what is MISSING: there is no `.eq('user_id', currentUser.id)`.
 * We don't need it — Postgres runs the query as the `authenticated` role with
 * the user's JWT, and the RLS policies add `WHERE auth.uid() = user_id` for us.
 * Even if this client code were modified maliciously, the database would still
 * refuse to return or change other users' rows.
 *
 * Errors: the SDK never throws; it returns `{ data, error }`. We convert errors
 * into exceptions so callers can use ordinary try/catch.
 */
import { supabase } from '@/lib/supabase';
import type { Task } from '@/types/database';

export async function listTasks(): Promise<Task[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data;
}

export async function createTask(title: string): Promise<Task> {
  const { data, error } = await supabase
    .from('tasks')
    // No user_id: the column defaults to auth.uid() in Postgres, and the
    // INSERT policy's WITH CHECK would reject any other value anyway.
    .insert({ title: title.trim() })
    // PostgREST returns nothing from an INSERT unless you ask for it.
    // `.select().single()` adds `Prefer: return=representation` so we get
    // back the created row, including the server-generated id and timestamps.
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function setTaskCompleted(
  id: string,
  completed: boolean,
): Promise<Task> {
  const { data, error } = await supabase
    .from('tasks')
    .update({ completed }) // updated_at is set by a Postgres trigger
    .eq('id', id)
    .select()
    // If RLS hides the row (not yours) the update matches 0 rows and
    // .single() turns that into an error instead of silently succeeding.
    .single();

  if (error) throw error;
  return data;
}

export async function deleteTask(id: string): Promise<void> {
  const { error } = await supabase.from('tasks').delete().eq('id', id);
  if (error) throw error;
}
