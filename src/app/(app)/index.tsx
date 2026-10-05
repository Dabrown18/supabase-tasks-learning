/**
 * Task list screen.
 *
 * Data flow for every action on this screen:
 *   this component → useTasks (React state) → services/tasks.ts (Supabase SDK)
 *   → PostgREST (/rest/v1/tasks) → Postgres (RLS policies) → back again
 */
import { Link, Stack } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, FlatList, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/AppButton';
import { NewTaskForm } from '@/components/NewTaskForm';
import { TaskRow } from '@/components/TaskRow';
import { useTaskReminders } from '@/hooks/useTaskReminders';
import { useTasks } from '@/hooks/useTasks';
import { useAuth } from '@/providers/AuthProvider';
import { signOut } from '@/services/auth';

export default function TasksScreen() {
  const { session } = useAuth();
  const { tasks, isLoading, isRefreshing, error, refresh, addTask, toggleTask, removeTask } =
    useTasks();
  const reminders = useTaskReminders();
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
    } catch (e) {
      Alert.alert('Sign out failed', e instanceof Error ? e.message : String(e));
      setSigningOut(false);
    }
  };

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <AppButton
              title="Sign out"
              variant="secondary"
              onPress={handleSignOut}
              disabled={signingOut}
            />
          ),
        }}
      />

      <Text style={styles.email}>Signed in as {session?.user.email}</Text>
      <Text style={styles.reminders}>{reminderLabel(reminders)}</Text>

      <NewTaskForm onSubmit={addTask} />

      {error && <Text style={styles.error}>{error}</Text>}

      <FlatList
        data={tasks}
        keyExtractor={(t) => t.id}
        renderItem={({ item }) => (
          <TaskRow task={item} onToggle={toggleTask} onDelete={removeTask} />
        )}
        refreshing={isRefreshing}
        onRefresh={refresh}
        ListEmptyComponent={
          isLoading ? (
            <ActivityIndicator style={styles.empty} />
          ) : (
            <Text style={styles.empty}>No tasks yet. Add one above.</Text>
          )
        }
      />

      <Link href="/stats" asChild>
        <AppButton title="Compare: Query vs RPC vs Edge Function" variant="secondary" />
      </Link>
      <Link href="/health" asChild>
        <AppButton title="Health (Apple HealthKit via our Swift module)" variant="secondary" />
      </Link>
    </View>
  );
}

function reminderLabel(r: ReturnType<typeof useTaskReminders>): string {
  switch (r.status) {
    case 'registered':
      return '🔔 Reminders on: unfinished tasks get a push after 24 hours';
    case 'denied':
      return '🔕 Reminders off: notifications not allowed in Settings';
    case 'unavailable':
      return `🔕 Reminders unavailable: ${r.reason}`;
    default:
      return 'Checking reminder status…';
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12, backgroundColor: '#f6f8fa' },
  email: { color: '#57606a' },
  reminders: { color: '#57606a', fontSize: 12 },
  error: { color: '#e5484d' },
  empty: { textAlign: 'center', color: '#8b949e', marginTop: 24 },
});
