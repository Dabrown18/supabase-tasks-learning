/**
 * Three ways to get the same numbers — compare them side by side.
 *
 * 1. CLIENT-SIDE      (see computeStatsLocally)
 *    Download the rows with a normal query, count them in JavaScript.
 *    Simple, but transfers every row just to produce three numbers.
 *
 * 2. POSTGRES FUNCTION via RPC   (getStatsViaRpc)
 *    RN → SDK → PostgREST /rest/v1/rpc/get_task_stats → SQL function in Postgres
 *    The counting happens inside the database, next to the data. Only the
 *    result travels over the network. RLS still applies (SECURITY INVOKER).
 *
 * 3. EDGE FUNCTION    (getSummaryViaEdgeFunction)
 *    RN → SDK → /functions/v1/get-task-summary → TypeScript on Deno → Postgres
 *    Your own server-side code. Overkill for counting, but it's the place
 *    for secrets, third-party APIs (Google Calendar, an LLM), and logic that
 *    must not live on the device.
 */
import { FunctionsHttpError } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';
import type { Task, TaskStats } from '@/types/database';

/** 1. Client-side: count rows we already downloaded. */
export function computeStatsLocally(tasks: Task[]): TaskStats {
  const completed_count = tasks.filter((t) => t.completed).length;
  return {
    total_count: tasks.length,
    completed_count,
    incomplete_count: tasks.length - completed_count,
  };
}

/** 2. Postgres function, called through Supabase RPC. */
export async function getStatsViaRpc(): Promise<TaskStats> {
  // `returns table (...)` gives back a set of rows; ours always has exactly
  // one row, so `.single()` unwraps it into an object.
  const { data, error } = await supabase.rpc('get_task_stats').single();
  if (error) throw error;
  return data;
}

/** Shape returned by supabase/functions/get-task-summary/index.ts */
export type TaskSummary = {
  userId: string;
  total: number;
  completed: number;
  incomplete: number;
  completionRate: number;
  oldestIncompleteTask: { id: string; title: string; created_at: string } | null;
  generatedAt: string;
  source: 'edge-function';
};

/** 3. Supabase Edge Function. */
export async function getSummaryViaEdgeFunction(): Promise<TaskSummary> {
  // functions.invoke() POSTs to https://<ref>.supabase.co/functions/v1/get-task-summary
  // and automatically adds `Authorization: Bearer <current user's JWT>`.
  // The function uses that JWT to identify the caller.
  const { data, error } = await supabase.functions.invoke<TaskSummary>(
    'get-task-summary',
  );

  if (error) {
    // For non-2xx responses, the function's own JSON error body is available.
    // Our handler returns { error }, while @supabase/server's built-in auth
    // rejections (401) return { message, code, hint }.
    if (error instanceof FunctionsHttpError) {
      const body = await error.context.json().catch(() => null);
      throw new Error(body?.error ?? body?.message ?? error.message);
    }
    throw error;
  }
  if (!data) throw new Error('Edge Function returned no data');
  return data;
}
