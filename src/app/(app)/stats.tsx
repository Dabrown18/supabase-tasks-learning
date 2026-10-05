/**
 * The same statistics fetched three different ways, so you can see (and time)
 * each architectural path. Read services/stats.ts alongside this screen.
 */
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { StatLine, StatsCard } from '@/components/StatsCard';
import {
  computeStatsLocally,
  getStatsViaRpc,
  getSummaryViaEdgeFunction,
} from '@/services/stats';
import { listTasks } from '@/services/tasks';
import type { TaskStats } from '@/types/database';

/** Result of one fetch: the data or an error, plus how long it took. */
type Timed<T> = { data?: T; error?: string; ms: number };

async function timed<T>(fn: () => Promise<T>): Promise<Timed<T>> {
  const start = Date.now();
  try {
    return { data: await fn(), ms: Date.now() - start };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e), ms: Date.now() - start };
  }
}

/** Runs all three approaches in parallel. Pure: no React state involved. */
async function fetchAll() {
  const [local, rpc, edge] = await Promise.all([
    timed(async () => computeStatsLocally(await listTasks())),
    timed(getStatsViaRpc),
    timed(getSummaryViaEdgeFunction),
  ]);
  return { local, rpc, edge };
}

type Results = Awaited<ReturnType<typeof fetchAll>>;

export default function StatsScreen() {
  const [results, setResults] = useState<Results>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetchAll().then((r) => {
      if (!active) return;
      setResults(r);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  const reload = async () => {
    setLoading(true);
    setResults(await fetchAll());
    setLoading(false);
  };

  const { local, rpc, edge } = results ?? {};

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <StatsCard
        title="1. Normal query + count in JS"
        path="RN → SDK → PostgREST /rest/v1/tasks → SELECT * (RLS) → count on device"
      >
        <Counts result={local} />
      </StatsCard>

      <StatsCard
        title="2. Postgres function via RPC"
        path="RN → SDK → PostgREST /rest/v1/rpc/get_task_stats → SQL function (RLS)"
      >
        <Counts result={rpc} />
      </StatsCard>

      <StatsCard
        title="3. Supabase Edge Function"
        path="RN → SDK → /functions/v1/get-task-summary → Deno/TypeScript → Postgres (RLS)"
      >
        {edge?.data ? (
          <>
            <StatLine label="Total" value={edge.data.total} />
            <StatLine label="Completed" value={edge.data.completed} />
            <StatLine label="Incomplete" value={edge.data.incomplete} />
            <StatLine label="Completion rate" value={`${edge.data.completionRate}%`} />
            <StatLine
              label="Oldest open task"
              value={edge.data.oldestIncompleteTask?.title ?? '—'}
            />
            <StatLine label="Time" value={`${edge.ms} ms`} />
          </>
        ) : (
          <ErrorOrLoading result={edge} />
        )}
      </StatsCard>

      <AppButton title={loading ? 'Loading…' : 'Reload all'} onPress={reload} disabled={loading} />
    </ScrollView>
  );
}

function Counts({ result }: { result?: Timed<TaskStats> }) {
  if (!result?.data) return <ErrorOrLoading result={result} />;
  return (
    <>
      <StatLine label="Total" value={result.data.total_count} />
      <StatLine label="Completed" value={result.data.completed_count} />
      <StatLine label="Incomplete" value={result.data.incomplete_count} />
      <StatLine label="Time" value={`${result.ms} ms`} />
    </>
  );
}

function ErrorOrLoading({ result }: { result?: Timed<unknown> }) {
  if (result?.error) return <Text style={styles.error}>Error: {result.error}</Text>;
  return <Text style={styles.muted}>Loading…</Text>;
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12, backgroundColor: '#f6f8fa' },
  error: { color: '#e5484d' },
  muted: { color: '#8b949e' },
});
