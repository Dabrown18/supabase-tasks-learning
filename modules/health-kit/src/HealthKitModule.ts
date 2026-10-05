/**
 * The TypeScript side of the bridge: a typed description of what the Swift
 * module (ios/HealthKitModule.swift) exposes.
 *
 * Every method here corresponds 1:1 to a Function/AsyncFunction in the Swift
 * `definition()`. The Expo Modules API converts arguments and return values
 * between JS and Swift (Record → plain object, [Record] → array, nil → null).
 */
import { NativeModule, requireOptionalNativeModule } from 'expo';

/** Whether the iOS permission sheet would be shown if we asked now. */
export type AuthorizationRequestStatus = 'shouldRequest' | 'unnecessary' | 'unknown';

/** Mirrors WorkoutRecord in Swift. Dates are ISO 8601 strings. */
export type Workout = {
  id: string;
  activityType: string;
  startDate: string;
  endDate: string;
  durationMinutes: number;
};

/** Mirrors SleepRecord in Swift. */
export type SleepSummary = {
  startDate: string;
  endDate: string;
  asleepMinutes: number;
  inBedMinutes: number;
};

declare class HealthKitNativeModule extends NativeModule<Record<string, never>> {
  isAvailable(): boolean;
  getAuthorizationRequestStatus(): Promise<AuthorizationRequestStatus>;
  requestAuthorization(): Promise<void>;
  getTodaySteps(): Promise<number>;
  getRecentWorkouts(limit: number, days: number): Promise<Workout[]>;
  getLastSleep(): Promise<SleepSummary | null>;
}

/**
 * `requireOptionalNativeModule` returns null instead of throwing when the
 * native code isn't in this binary: Expo Go, Android, web, or an iOS build
 * made before this module was added. Callers must handle null — we never
 * substitute fake data.
 */
export default requireOptionalNativeModule<HealthKitNativeModule>('HealthKitModule');
