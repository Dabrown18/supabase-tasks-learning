/**
 * Holds the current Supabase session in React state.
 *
 * The SDK is the source of truth for the session (it persists and refreshes
 * it). This provider just subscribes to it so React re-renders on sign-in,
 * sign-out and token refresh.
 */
import type { Session } from '@supabase/supabase-js';
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type PropsWithChildren,
} from 'react';

import { supabase } from '@/lib/supabase';

type AuthContextValue = {
  session: Session | null;
  /** True until the stored session has been read from disk on launch. */
  isLoading: boolean;
};

const AuthContext = createContext<AuthContextValue>({
  session: null,
  isLoading: true,
});

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // onAuthStateChange fires INITIAL_SESSION immediately with whatever was
    // persisted (or null), then SIGNED_IN / SIGNED_OUT / TOKEN_REFRESHED later.
    const { data } = supabase.auth.onAuthStateChange((_event, newSession) => {
      // Keep this callback synchronous: awaiting other supabase calls inside
      // it can deadlock the SDK's internal auth lock.
      setSession(newSession);
      setIsLoading(false);
    });

    return () => data.subscription.unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{ session, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
