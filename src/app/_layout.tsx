/**
 * Root layout: decides which screens exist based on the auth session.
 *
 * Stack.Protected removes screens whose `guard` is false and redirects away
 * from them. Signed out → only `sign-in` exists. Signed in → only `(app)`.
 *
 * NOTE: this is UX, not security. Hiding a screen doesn't protect data — RLS
 * in Postgres does. A signed-out client could still call the API directly and
 * would get nothing back.
 */
import { SplashScreen, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { SetupRequired } from '@/components/SetupRequired';
import { isSupabaseConfigured } from '@/lib/supabase';
import { AuthProvider, useAuth } from '@/providers/AuthProvider';
import { SplashScreenController } from '@/splash';

export default function RootLayout() {
  if (!isSupabaseConfigured) {
    SplashScreen.hide();
    return <SetupRequired />;
  }

  return (
    <AuthProvider>
      <SplashScreenController />
      <RootNavigator />
      <StatusBar style="dark" />
    </AuthProvider>
  );
}

function RootNavigator() {
  const { session } = useAuth();

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!!session}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>

      <Stack.Protected guard={!session}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
    </Stack>
  );
}
