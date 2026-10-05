import { Stack } from 'expo-router';

/** Everything in this (app) group is only reachable while signed in. */
export default function AppLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: 'My Tasks' }} />
      <Stack.Screen name="stats" options={{ title: 'Compare data paths' }} />
    </Stack>
  );
}
