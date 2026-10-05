import { SplashScreen } from 'expo-router';

import { useAuth } from '@/providers/AuthProvider';

// Keep the native splash screen up until we know whether a session exists,
// so the user never sees the sign-in screen flash before their tasks.
SplashScreen.preventAutoHideAsync();

export function SplashScreenController() {
  const { isLoading } = useAuth();
  if (!isLoading) {
    SplashScreen.hide();
  }
  return null;
}
