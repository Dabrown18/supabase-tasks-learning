/**
 * Health screen.
 *
 * Data flow:
 *   this screen → NativeHealthKit (modules/health-kit/index.ts)
 *   → Expo Modules API → HealthKitModule.swift → HKHealthStore → Apple Health
 *
 * Optional, explicit upload:
 *   this screen → services/healthSync.ts → Supabase → health_daily_summary
 */
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { StatLine, StatsCard } from '@/components/StatsCard';
import { buildDailySummary, syncDailySummary } from '@/services/healthSync';
import {
  NativeHealthKit,
  type AuthorizationRequestStatus,
  type SleepSummary,
  type Workout,
} from '@modules/health-kit';

type HealthData = { steps: number; workouts: Workout[]; sleep: SleepSummary | null };

const formatMinutes = (minutes: number) =>
  minutes >= 60 ? `${Math.floor(minutes / 60)} hr ${Math.round(minutes % 60)} min` : `${minutes} min`;

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function HealthScreen() {
  // Not linked → Expo Go, Android, web, or a build made before the module existed.
  if (!NativeHealthKit.isLinked) {
    return (
      <Notice title="Needs an iOS development build">
        This screen uses our own Swift module, which isn&apos;t included in Expo Go or on
        Android. Build the app with `npx expo run:ios` (see HEALTHKIT_GUIDE.md).
      </Notice>
    );
  }
  if (!NativeHealthKit.isAvailable()) {
    return (
      <Notice title="HealthKit unavailable">
        This device doesn&apos;t support Apple Health.
      </Notice>
    );
  }
  return <HealthDashboard />;
}

function HealthDashboard() {
  const [requestStatus, setRequestStatus] = useState<AuthorizationRequestStatus | null>(null);
  const [data, setData] = useState<HealthData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastSynced, setLastSynced] = useState<string | null>(null);

  const connectAndLoad = async () => {
    setBusy(true);
    setError(null);
    try {
      // 1. Permission sheet (only appears the first time).
      await NativeHealthKit.requestAuthorization();
      setRequestStatus(await NativeHealthKit.getAuthorizationRequestStatus());

      // 2. Three independent queries, run in parallel in Swift.
      const [steps, workouts, sleep] = await Promise.all([
        NativeHealthKit.getTodaySteps(),
        NativeHealthKit.getRecentWorkouts(5, 7),
        NativeHealthKit.getLastSleep(),
      ]);
      setData({ steps, workouts, sleep });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const confirmSync = () => {
    if (!data) return;
    const summary = buildDailySummary(data.steps, data.workouts, data.sleep);
    // Explicit consent: show exactly what will be uploaded.
    Alert.alert(
      'Sync to Supabase?',
      `Only this summary will be uploaded:\n\n` +
        `Date: ${summary.date}\nSteps: ${summary.steps}\n` +
        `Workout minutes: ${summary.workout_minutes}\n` +
        `Sleep minutes: ${summary.sleep_minutes ?? 'none recorded'}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Upload',
          onPress: async () => {
            try {
              const row = await syncDailySummary(summary);
              setLastSynced(new Date(row.updated_at).toLocaleTimeString());
            } catch (e) {
              Alert.alert('Sync failed', errorMessage(e));
            }
          },
        },
      ],
    );
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <StatsCard title="Status" path="RN → our Swift module → HKHealthStore">
        <StatLine label="HealthKit" value="Available" />
        <StatLine label="Permission prompt" value={describeStatus(requestStatus)} />
      </StatsCard>

      <AppButton
        title={busy ? 'Loading…' : data ? 'Refresh' : 'Connect Apple Health'}
        onPress={connectAndLoad}
        disabled={busy}
      />

      {error && <Text style={styles.error}>{error}</Text>}

      {data && (
        <>
          <StatsCard title="Today's Steps" path="HKStatisticsQueryDescriptor (.cumulativeSum)">
            <Text style={styles.big}>{Math.round(data.steps).toLocaleString()}</Text>
          </StatsCard>

          <StatsCard title="Recent Workouts" path="HKSampleQueryDescriptor (.workout), last 7 days">
            {data.workouts.length === 0 ? (
              <Text style={styles.muted}>No workouts recorded</Text>
            ) : (
              data.workouts.map((w) => (
                <StatLine
                  key={w.id}
                  label={`${w.activityType} · ${new Date(w.startDate).toLocaleDateString()}`}
                  value={formatMinutes(w.durationMinutes)}
                />
              ))
            )}
          </StatsCard>

          <StatsCard title="Last Sleep" path="HKSampleQueryDescriptor (.sleepAnalysis)">
            {data.sleep ? (
              <>
                <Text style={styles.big}>{formatMinutes(data.sleep.asleepMinutes)}</Text>
                {data.sleep.inBedMinutes > 0 && (
                  <StatLine label="In bed" value={formatMinutes(data.sleep.inBedMinutes)} />
                )}
              </>
            ) : (
              <Text style={styles.muted}>No sleep recorded last night</Text>
            )}
          </StatsCard>

          <Text style={styles.muted}>
            Zero or empty results can also mean access was declined: iOS doesn&apos;t tell apps
            whether read permission was granted. Check Settings → Health → Data Access &amp; Devices.
          </Text>

          <StatsCard title="Optional: sync to Supabase" path="RN → Supabase SDK → health_daily_summary (RLS)">
            <Text style={styles.muted}>
              Uploads only today&apos;s totals (steps, workout minutes, sleep minutes). Nothing is
              uploaded automatically.
            </Text>
            <AppButton title="Sync today's summary…" variant="secondary" onPress={confirmSync} />
            {lastSynced && <Text style={styles.muted}>Last synced at {lastSynced}</Text>}
          </StatsCard>
        </>
      )}
    </ScrollView>
  );
}

function describeStatus(status: AuthorizationRequestStatus | null): string {
  switch (status) {
    case 'shouldRequest':
      return 'Not asked yet';
    case 'unnecessary':
      return 'Answered';
    case 'unknown':
      return 'Unknown';
    default:
      return 'Tap Connect';
  }
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.notice}>
      <Text style={styles.noticeTitle}>{title}</Text>
      <Text style={styles.noticeBody}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: '#f6f8fa' },
  container: { padding: 16, gap: 12 },
  big: { fontSize: 32, fontWeight: '700' },
  muted: { color: '#57606a', fontSize: 13 },
  error: { color: '#e5484d' },
  notice: { flex: 1, padding: 24, gap: 8, justifyContent: 'center', backgroundColor: '#f6f8fa' },
  noticeTitle: { fontSize: 18, fontWeight: '700' },
  noticeBody: { fontSize: 15, lineHeight: 22, color: '#57606a' },
});
