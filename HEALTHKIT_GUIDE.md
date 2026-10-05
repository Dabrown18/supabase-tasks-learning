# HealthKit Guide: owning a native iOS integration in an Expo app

This feature adds a **Health** screen that reads today's steps, recent workouts and last
night's sleep from Apple Health, using **our own Swift code**. No React Native HealthKit
library is involved. An optional button syncs a minimal daily summary to Supabase.

---

## 0. Architecture

```
┌──────────────────────────────┐
│ React Native / TypeScript    │  src/app/(app)/health.tsx
└──────────────┬───────────────┘
               │  NativeHealthKit.getTodaySteps()
               ▼
┌──────────────────────────────┐
│ Our Native Health Module     │  modules/health-kit/index.ts
│ Expo Modules API             │  modules/health-kit/src/HealthKitModule.ts
└──────────────┬───────────────┘
               │  JSI call → AsyncFunction("getTodaySteps")
               ▼
┌──────────────────────────────┐
│ Swift                        │  modules/health-kit/ios/HealthKitModule.swift
│ HealthKit Integration        │
└──────────────┬───────────────┘
               │  HKStatisticsQueryDescriptor(...).result(for: store)
               ▼
┌──────────────────────────────┐
│ Apple HealthKit              │  the on-device, encrypted Health database
└──────────────────────────────┘
```

The backend flow is separate, optional, and always started by the user:

```
HealthKit
   ↓   (Swift reads samples, returns totals)
Swift
   ↓   (Records → plain JS objects)
React Native
   ↓   buildDailySummary(): 3 numbers + a date
Supabase SDK
   ↓   upsert(..., { onConflict: 'user_id,date' })
Supabase API (PostgREST)
   ↓   JWT → role authenticated → RLS
PostgreSQL   public.health_daily_summary
```

### Files

| File | What it is |
|---|---|
| `modules/health-kit/expo-module.config.json` | Tells Expo autolinking "this folder is a native module; its iOS class is `HealthKitModule`" |
| `modules/health-kit/ios/HealthKitModule.podspec` | CocoaPods spec: compiles our Swift and links `HealthKit.framework` |
| `modules/health-kit/ios/HealthKitModule.swift` | **All HealthKit logic** |
| `modules/health-kit/src/HealthKitModule.ts` | TypeScript declaration of the native API |
| `modules/health-kit/index.ts` | The friendly public API (`NativeHealthKit`) |
| `modules/health-kit/app.plugin.js` | Config plugin: adds the HealthKit entitlement and Info.plist text during prebuild |
| `src/app/(app)/health.tsx` | The screen |
| `src/services/healthSync.ts` | Builds the minimal summary and upserts it |
| `supabase/migrations/…_create_health_daily_summary.sql` | Table and RLS |

---

## 1. What HealthKit is

HealthKit is Apple's framework for the **Health database on the iPhone**: steps, heart rate,
workouts, sleep, nutrition, medications, and more. Data comes from the iPhone's sensors, Apple
Watch, and other apps. It's stored **on the device, encrypted**, and is accessible only while
the phone is unlocked. Apps read and write it **only with per-type user permission**.

## 2. Why HealthKit is an iOS-native framework

It's an Apple system framework (`import HealthKit`), exposed only through Swift/Objective-C
APIs, backed by a system daemon and tied to app entitlements and code signing. There's no HTTP
API and no JavaScript API. To use it you must run native code inside an app binary that is
**signed with the HealthKit entitlement**.

## 3. Why React Native can't call Swift directly

Your TypeScript runs in a JavaScript engine (Hermes). Hermes knows nothing about Swift classes,
Objective-C runtime objects, or `HKHealthStore`. Something must:

1. **Expose** chosen native functions to JavaScript under a name,
2. **Convert arguments** (JS number → Swift `Int`) and **results** (Swift struct → JS object),
3. **Bridge threading** (JS thread ↔ native async work) and turn native errors into rejected promises.

That "something" is a **native module**. In modern React Native it's built on **JSI** (the
JavaScript Interface): C++ bindings that let JS hold direct references to native functions,
without the old asynchronous JSON "bridge". The **Expo Modules API** generates all of that
plumbing from a small Swift DSL, so we only write `Name(...)`, `Function(...)` and
`AsyncFunction(...)`.

## 4. What our native module does

`HealthKitModule.swift` exposes six functions:

| JS method | Swift | HealthKit API |
|---|---|---|
| `isAvailable()` | `Function` (sync) | `HKHealthStore.isHealthDataAvailable()` |
| `getAuthorizationRequestStatus()` | `AsyncFunction` | `statusForAuthorizationRequest(toShare:read:)` |
| `requestAuthorization()` | `AsyncFunction` | `requestAuthorization(toShare:read:)` |
| `getTodaySteps()` | `AsyncFunction` | `HKStatisticsQueryDescriptor` + `.cumulativeSum` |
| `getRecentWorkouts(limit, days)` | `AsyncFunction` | `HKSampleQueryDescriptor` + `.workout` |
| `getLastSleep()` | `AsyncFunction` | `HKSampleQueryDescriptor` + `.categorySample(.sleepAnalysis)` |

It is **read-only** and requests exactly three data types.

## 5–6. How TypeScript calls Swift, and how Swift returns data

Follow `getTodaySteps()` end to end:

```
TypeScript    const steps = await NativeHealthKit.getTodaySteps();
                │  modules/health-kit/index.ts → native().getTodaySteps()
Native bridge   requireOptionalNativeModule('HealthKitModule') gave us a JSI host object;
                │  calling a method schedules the Swift closure off the JS thread and
                │  returns a Promise immediately
Swift           AsyncFunction("getTodaySteps") { () async throws -> Double in ... }
                │
HealthKit       HKStatisticsQueryDescriptor(...).result(for: store)
                │  → HKStatistics? → sumQuantity()?.doubleValue(for: .count())
Swift result    return 8432.0     (or throw HealthKitQueryException)
                │  Expo Modules converts Double → JS number
JavaScript      Promise resolves with 8432   (a throw → Promise rejects with Error{code, message})
```

Type conversions used here:

| Swift | JavaScript |
|---|---|
| `Bool`, `Double`, `Int`, `String` | `boolean`, `number`, `number`, `string` |
| `struct WorkoutRecord: Record` | `{ id, activityType, startDate, endDate, durationMinutes }` |
| `[WorkoutRecord]` | `Workout[]` |
| `SleepRecord?` (`nil`) | `SleepSummary \| null` |
| `throw SomeException()` | rejected Promise: `Error` with `code` and `message` |

We convert `Date` to **ISO 8601 strings** in Swift, so no platform date types cross the
boundary, and JS can parse them with `new Date(...)`.

## 7. How permissions work

1. **Declare** in Info.plist *why* you want access: `NSHealthShareUsageDescription` (read).
   Our config plugin adds it. Without it, `requestAuthorization` **crashes** the app.
2. **Entitlement**: the binary must be signed with `com.apple.developer.healthkit`. Our config
   plugin adds it, the same thing Xcode's "+ Capability → HealthKit" does.
3. **Request at runtime**: `requestAuthorization(toShare: [], read: [steps, sleep, workouts])`
   shows the system sheet, with a separate toggle for each type.
4. **The sheet appears once.** After that, the user changes access only in
   **Settings → Health → Data Access & Devices → (app)**. Calling it again just returns.
5. **Read status is secret.** HealthKit never tells an app whether *read* access was granted.
   A denied read looks exactly like "no data" (an empty result or 0 steps). If an app could
   detect "denied", it would learn something about the user (for example, that they hide
   reproductive health data). `statusForAuthorizationRequest` only says whether the sheet would
   appear (`shouldRequest`) or was already answered (`unnecessary`). The UI says this explicitly.

## 8. What HKHealthStore does

`HKHealthStore` is your app's **connection to the Health database**. Every permission request,
query and save goes through it. Apple recommends **one long-lived instance per app**, so it's a
`let` property created once with the module. It's not a `lazy var`, because JS can call several
functions in parallel and Swift's lazy initialization isn't thread-safe.

## 9. How HealthKit queries work

Data is stored as **samples**: a type, a value, start and end dates, and a source.

- `HKQuantityType(.stepCount)`: numeric samples ("212 steps from 9:01 to 9:06, iPhone")
- `HKCategoryType(.sleepAnalysis)`: enum samples ("asleepCore from 23:40 to 01:10, Watch")
- `HKObjectType.workoutType()`: `HKWorkout` objects (activity type, duration, ...)

Query types we use (the modern **async/await descriptor** API, iOS 15.4+):

| Query | Use | Why |
|---|---|---|
| `HKStatisticsQueryDescriptor` | Totals and averages over a time range | HealthKit aggregates **and de-duplicates** overlapping sources. iPhone and Watch both count steps; adding up raw samples would double count |
| `HKSampleQueryDescriptor` | The actual samples (workouts, sleep segments) | Need individual records, sorted and limited |

A **predicate** limits the time range: `HKQuery.predicateForSamples(withStart:end:)`.

## 10. Why HealthKit permissions are privacy-sensitive

Health data is among the most sensitive personal data there is: it can reveal illness,
pregnancy, disability, mental health and habits. It's often legally protected (HIPAA in some US
contexts, GDPR "special category" data in the EU), and Apple's App Store rules forbid using it
for advertising, selling it, or storing it in iCloud. Apple also reviews **why** you ask for
each type.

## 11. Request only what you need

- Each extra type is another toggle that makes users hesitate, so fewer types means more trust and more grants.
- App Review checks that requested types match visible features.
- Less data accessed means less to protect and less liability.

So: three read types, zero write types, and no `NSHealthUpdateUsageDescription`.

## 12. Why we own the native code instead of using a wrapper library

Third-party React Native HealthKit wrappers exist and are fine for many apps. We wrote our own because:
- **Learning**: you see exactly how JS reaches Swift.
- **Minimal surface**: about 200 lines covering our three types, instead of a library exposing
  hundreds of types and write paths.
- **Control over privacy**: we decide exactly what's requested, read, converted and returned.
- **Upgrade independence**: when iOS or React Native changes, we fix our own code instead of
  waiting for a maintainer.
- **No transitive dependencies** in a health-data path.

## 13. Advantages and disadvantages of owning native code

| ✅ Advantages | ❌ Disadvantages |
|---|---|
| Exactly the API you need, typed your way | You maintain Swift: iOS updates, deprecations, Xcode changes |
| Easy to audit (privacy and security) | The team needs native skills, and code review for Swift |
| No waiting on third-party fixes | No community testing across edge cases |
| Can use the newest Apple APIs right away | You write the Android equivalent separately (Kotlin + Health Connect) |
| Smaller binary and attack surface | Native changes need a **rebuild**; Fast Refresh only reloads JS |

A sensible rule: **wrap a library when the integration is broad and commodity; own it when it's
narrow, sensitive, or core to the product.**

## 14. Expo development builds vs. Expo Go

- **Expo Go** is a prebuilt app from the App Store with a **fixed** set of native modules.
  It can't contain *your* Swift. It also lacks *your* entitlements (HealthKit), so even its
  own code couldn't use HealthKit for your app.
- A **development build** is *your* app binary, built from *your* project (with
  `npx expo run:ios` or EAS Build). It includes your local modules, config plugins and
  entitlements, plus dev tools for loading JS from Metro.
- **Continuous Native Generation**: `ios/` is generated from `app.json`, config plugins and
  autolinking (`npx expo prebuild`). We never hand-edit `ios/`; our module carries its own
  config plugin, so a clean regeneration always ends up correct.
- **Autolinking**: Expo scans `modules/*/expo-module.config.json`, adds our podspec to the
  Podfile, and registers `HealthKitModule` with the Expo runtime. That's why `pod install`
  printed `Installing HealthKitModule (0.1.0)`.

In Expo Go, `requireOptionalNativeModule` returns `null`, and the Health screen explains that a
development build is needed. It **never shows fake data**.

## 15. Syncing HealthKit data with Supabase

- **User-initiated only.** Nothing uploads automatically. The **Sync** button first shows an
  alert listing exactly what will be uploaded.
- **Minimal summary.** `buildDailySummary()` reduces everything to `{ date, steps, workout_minutes, sleep_minutes }`.
- **Idempotent upsert.** `UNIQUE (user_id, date)` plus `onConflict: 'user_id,date'`, so
  re-syncing the same day updates that row.
- **RLS.** Same pattern as `tasks`: four policies, all `auth.uid() = user_id`. An upsert needs
  **both** the INSERT and UPDATE policies. Tested: users can't read, write, update, reassign or
  delete other users' rows, anonymous callers have no access, and check constraints reject
  impossible values.
- **Local date.** The date is computed on the device in the user's time zone, because
  "today's steps" is a local-day concept.

## 16. What should and shouldn't be stored on the backend

| ✅ Store (when a feature needs it) | ❌ Don't store |
|---|---|
| Daily aggregates the product actually uses | Raw HealthKit samples |
| The user's explicit opt-in, and when they gave it | Workout routes or GPS, heart-rate series |
| `updated_at` for sync logic | Source and device names, bundle IDs |
| | Anything "just in case" |
| | Health data in analytics, logs or crash reports |
| | Health data in push notification payloads (they appear on lock screens) |

Also provide **deletion**: our policies let users delete their rows, and deleting the account
cascades. Document retention, keep it out of non-production databases, and never use it for ads.

---

## 17. Swift code walkthrough (`modules/health-kit/ios/HealthKitModule.swift`)

### Imports

```swift
import ExpoModulesCore   // Module, ModuleDefinition, Record, @Field, Exception
import HealthKit         // HKHealthStore, HKQuantityType, query descriptors
```

The podspec's `s.frameworks = 'HealthKit'` links the framework.

### Records: the shapes that cross into JS

```swift
struct WorkoutRecord: Record {
  @Field var id: String = ""
  @Field var activityType: String = ""
  @Field var startDate: String = ""        // ISO 8601
  @Field var endDate: String = ""
  @Field var durationMinutes: Double = 0
}
```

`Record` plus `@Field` tells Expo Modules how to serialize the struct into a JS object. Only
simple types go in, so no `HKWorkout` or `Date` ever reaches JS.

### Errors

```swift
final class HealthDataUnavailableException: Exception {
  override var reason: String { "HealthKit is not available on this device." }
}
final class HealthKitQueryException: GenericException<String> {
  override var reason: String { "HealthKit query failed: \(param)" }
}
```

Throwing these in an `AsyncFunction` **rejects the JS promise** with an `Error`. Its `code` is
derived from the class name (`ERR_HEALTH_DATA_UNAVAILABLE`), and its message is `reason`.

### HKHealthStore and the types we request

```swift
private let store = HKHealthStore()                    // one per app; `let` is thread-safe
private let stepType = HKQuantityType(.stepCount)          // HKQuantityType: numeric samples
private let sleepType = HKCategoryType(.sleepAnalysis)     // HKCategoryType: enum samples
private let workoutType = HKObjectType.workoutType()       // HKWorkout objects
private var readTypes: Set<HKObjectType> { [stepType, sleepType, workoutType] }
```

`HKObjectType` is the base class. Permissions are requested as a `Set<HKObjectType>`.

### Module definition: the JS-facing API

```swift
public func definition() -> ModuleDefinition {
  Name("HealthKitModule")                       // requireNativeModule('HealthKitModule')
  Function("isAvailable") { () -> Bool in       // sync: returns directly
    HKHealthStore.isHealthDataAvailable()
  }
  AsyncFunction("requestAuthorization") { () async throws in   // returns a Promise in JS
    try self.ensureAvailable()
    try await self.store.requestAuthorization(toShare: [], read: self.readTypes)
  }
  ...
}
```

`AsyncFunction` with an `async throws` closure lets us use Swift concurrency directly. Expo
Modules runs the closure off the JS thread and resolves or rejects the promise. `toShare: []`
means we never write.

### Steps: a statistics query

```swift
let startOfDay = Calendar.current.startOfDay(for: now)              // local midnight
let predicate = HKQuery.predicateForSamples(withStart: startOfDay, end: now)
let descriptor = HKStatisticsQueryDescriptor(
  predicate: .quantitySample(type: self.stepType, predicate: predicate),
  options: .cumulativeSum)                                          // sum, de-duplicated
let statistics = try await descriptor.result(for: self.store)       // async/await
return statistics?.sumQuantity()?.doubleValue(for: .count()) ?? 0   // HKQuantity → Double
```

`HKQuantity` carries units. `doubleValue(for: .count())` converts it to a plain number.

### Workouts: a sample query

```swift
let descriptor = HKSampleQueryDescriptor(
  predicates: [.workout(predicate)],                         // typed: results are [HKWorkout]
  sortDescriptors: [SortDescriptor(\.endDate, order: .reverse)],
  limit: max(1, min(limit, 50)))                             // clamp input from JS
let workouts = try await descriptor.result(for: self.store)
return workouts.map { self.toRecord($0) }                    // HKWorkout → WorkoutRecord
```

`toRecord` maps `workoutActivityType` (an enum) to a readable name, `duration` from seconds to
minutes, and dates to ISO strings. Arguments from JS are **clamped**, because native code
shouldn't trust its inputs either.

### Sleep: category samples and merging overlaps

```swift
let asleepValues = HKCategoryValueSleepAnalysis.allAsleepValues.map(\.rawValue)  // core/deep/REM/unspecified
let asleep = samples.filter { asleepValues.contains($0.value) }
...
record.asleepMinutes = (Self.mergedDuration(asleep) / 60).rounded()
```

Sleep comes as many segments (stages), often from **multiple sources** for the same night.
`mergedDuration` sorts intervals and merges overlaps so time is counted once. The window is
"samples overlapping 6 PM yesterday until now". If nothing is found it returns `nil`, which
becomes `null` in JS.

### Error handling summary

- Device without HealthKit → `HealthDataUnavailableException` (checked in every async function).
- HealthKit errors → caught and rethrown as `HealthKitQueryException` with HealthKit's message.
- Missing module (Expo Go or Android) → handled in TypeScript (`isLinked`), not Swift.

## 18. TypeScript walkthrough

`modules/health-kit/src/HealthKitModule.ts` describes the native object:

```ts
declare class HealthKitNativeModule extends NativeModule<Record<string, never>> {
  isAvailable(): boolean;
  getTodaySteps(): Promise<number>;
  getRecentWorkouts(limit: number, days: number): Promise<Workout[]>;
  getLastSleep(): Promise<SleepSummary | null>;
  ...
}
export default requireOptionalNativeModule<HealthKitNativeModule>('HealthKitModule');
```

- The method names **must match** the Swift `Function`/`AsyncFunction` names. TypeScript can't
  verify that across the boundary, so keep the two files side by side when changing either.
- `requireOptionalNativeModule` returns `null` when the native code isn't in the binary.

`modules/health-kit/index.ts` wraps it: `isLinked`, defaults (`limit = 5, days = 7`), and a
clear error if called without the native module. The app imports only this:
`import { NativeHealthKit } from '@modules/health-kit'`.

## 19. Android (not implemented)

Android's equivalent is **Health Connect**: a system-level health data store with per-type
permissions, used through a Kotlin SDK.

```
React Native
     ↓
Our native Android module   (same Expo module: add an android/ folder + Kotlin class)
     ↓
Kotlin
     ↓
Health Connect   (androidx.health.connect.client)
```

Differences to plan for: permissions are declared in the manifest and requested with Health
Connect's permission contract. Data is read with `readRecords` / `aggregate`
(`StepsRecord.COUNT_TOTAL`, `ExerciseSessionRecord`, `SleepSessionRecord`). The Health Connect
app may need installing on older Android versions. Google Play requires a declaration and
privacy policy for health permissions. The TypeScript API (`NativeHealthKit`, or a neutral name
like `NativeHealth`) can stay identical, so the screen wouldn't change.
`npx create-expo-module add-platform-support` can add the Android side to this module.

## 20. Testing and limitations

- **iOS Simulator:** HealthKit *is* available on iPhone simulators. Open the simulator's
  **Health** app, then **Browse → Activity → Steps → Add Data** (and Sleep similarly), and the
  screen will read it. Workouts usually come from the Watch or Fitness apps, so expect an empty
  workout list on a simulator unless another app writes one.
- **Physical iPhone:** real data. Needs signing with a team that has the HealthKit capability.
  If Xcode says your free Personal Team can't use HealthKit, a paid Apple Developer membership
  is required.
- **Expo Go / Android / web:** the screen explains that the module isn't available. No fake data.
- **Native changes need a rebuild** (`npx expo run:ios`). JS changes reload as usual.
- **iOS 27 simulators:** this Expo SDK 57 build doesn't launch on iOS 27 because of the UIScene
  requirement. Use an iOS 26.x simulator or device until Expo SDK 58.
