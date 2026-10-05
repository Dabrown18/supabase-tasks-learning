import { useEffect, useState } from 'react';

import { registerForTaskReminders, type PushRegistrationResult } from '@/services/notifications';

/**
 * Registers this device for task reminders once the user is signed in.
 * Returns the outcome so the UI can explain why reminders aren't active.
 */
export function useTaskReminders() {
  const [result, setResult] = useState<PushRegistrationResult | { status: 'pending' }>({
    status: 'pending',
  });

  useEffect(() => {
    let active = true;
    registerForTaskReminders()
      .then((r) => active && setResult(r))
      .catch((e) =>
        active &&
        setResult({ status: 'unavailable', reason: e instanceof Error ? e.message : String(e) }),
      );
    return () => {
      active = false;
    };
  }, []);

  return result;
}
