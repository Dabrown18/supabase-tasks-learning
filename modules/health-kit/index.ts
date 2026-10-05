/**
 * Public API of our HealthKit module — what the app imports.
 *
 *   import { NativeHealthKit } from '@modules/health-kit';
 *
 *   NativeHealthKit.isLinked                    // is the native code in this build?
 *   NativeHealthKit.isAvailable()               // does this device support HealthKit?
 *   await NativeHealthKit.requestAuthorization();
 *   await NativeHealthKit.getTodaySteps();
 *   await NativeHealthKit.getRecentWorkouts();
 *   await NativeHealthKit.getLastSleep();
 *
 * Thin by design: all HealthKit logic lives in Swift. This file only adds
 * defaults and a clear error when the native module isn't present.
 */
import NativeModule from './src/HealthKitModule';

export type { AuthorizationRequestStatus, SleepSummary, Workout } from './src/HealthKitModule';

function native() {
  if (!NativeModule) {
    throw new Error(
      'HealthKitModule is not in this build. It needs an iOS development build ' +
        '(npx expo run:ios), not Expo Go. See HEALTHKIT_GUIDE.md.',
    );
  }
  return NativeModule;
}

export const NativeHealthKit = {
  /** False in Expo Go, on Android/web, or in an iOS build without this module. */
  isLinked: NativeModule != null,

  isAvailable: (): boolean => NativeModule?.isAvailable() ?? false,

  getAuthorizationRequestStatus: () => native().getAuthorizationRequestStatus(),

  requestAuthorization: () => native().requestAuthorization(),

  getTodaySteps: () => native().getTodaySteps(),

  getRecentWorkouts: (limit = 5, days = 7) => native().getRecentWorkouts(limit, days),

  getLastSleep: () => native().getLastSleep(),
};
