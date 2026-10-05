// =============================================================================
// HealthKitModule.swift — OUR native bridge between React Native and HealthKit.
//
//   TypeScript (modules/health-kit/src/HealthKitModule.ts)
//     → Expo Modules API (JSI, generated from definition() below)
//     → this Swift class
//     → HealthKit (HKHealthStore + queries)
//     → back out as plain values / Records that become JS objects
//
// Read-only on purpose: we request read access to exactly three data types
// and never write to Health. See HEALTHKIT_GUIDE.md for a walkthrough.
// =============================================================================

import ExpoModulesCore
import HealthKit

// MARK: - Values that cross the bridge
//
// A `Record` is a Swift struct the Expo Modules API knows how to convert to a
// plain JavaScript object. Only simple types (String, Double, Bool, arrays,
// optionals, other Records) go inside, so nothing HealthKit-specific
// (HKWorkout, HKQuantity, Date...) ever leaks into JavaScript.

struct WorkoutRecord: Record {
  @Field var id: String = ""
  @Field var activityType: String = ""
  @Field var startDate: String = ""        // ISO 8601
  @Field var endDate: String = ""          // ISO 8601
  @Field var durationMinutes: Double = 0
}

struct SleepRecord: Record {
  @Field var startDate: String = ""        // first sleep sample start (ISO 8601)
  @Field var endDate: String = ""          // last sleep sample end (ISO 8601)
  @Field var asleepMinutes: Double = 0     // time actually asleep (overlaps merged)
  @Field var inBedMinutes: Double = 0      // time in bed, if a source recorded it
}

// MARK: - Errors that reach JavaScript as rejected promises
//
// Subclassing ExpoModulesCore's `Exception` gives JS an Error with a stable
// `code` derived from the class name (e.g. "ERR_HEALTH_DATA_UNAVAILABLE")
// plus the `reason` as the message.

final class HealthDataUnavailableException: Exception, @unchecked Sendable {
  override var reason: String {
    "HealthKit is not available on this device."
  }
}

final class HealthKitQueryException: GenericException<String>, @unchecked Sendable {
  override var reason: String {
    "HealthKit query failed: \(param)"
  }
}

// MARK: - The module

public class HealthKitModule: Module {
  // One long-lived store for the whole app, as Apple recommends. HKHealthStore
  // is the gateway to all HealthKit data and permission requests.
  // A `let` (not `lazy var`): JS may call several AsyncFunctions in parallel,
  // and lazy initialization isn't thread-safe.
  private let store = HKHealthStore()

  // The ONLY types we ask for. Each one shows as a separate toggle on the
  // iOS permission sheet, so request the minimum the feature needs.
  private let stepType = HKQuantityType(.stepCount)
  private let sleepType = HKCategoryType(.sleepAnalysis)
  private let workoutType = HKObjectType.workoutType()

  private var readTypes: Set<HKObjectType> {
    [stepType, sleepType, workoutType]
  }

  private let iso = ISO8601DateFormatter()

  public func definition() -> ModuleDefinition {
    // The name JavaScript uses: requireNativeModule('HealthKitModule').
    Name("HealthKitModule")

    // Synchronous: cheap, no I/O. false on e.g. some iPads/Macs.
    Function("isAvailable") { () -> Bool in
      HKHealthStore.isHealthDataAvailable()
    }

    // Has the permission sheet been shown for our types yet?
    // NOTE: HealthKit never tells an app whether READ access was granted or
    // denied (that itself would leak health info). This only says whether
    // asking again would show the sheet.
    AsyncFunction("getAuthorizationRequestStatus") { () async throws -> String in
      try self.ensureAvailable()
      let status = try await self.store.statusForAuthorizationRequest(
        toShare: [], read: self.readTypes)
      switch status {
      case .shouldRequest: return "shouldRequest"
      case .unnecessary: return "unnecessary"
      default: return "unknown"
      }
    }

    // Shows the system permission sheet (only the first time; afterwards the
    // user changes access in Settings → Health → Data Access & Devices).
    // Resolves when the sheet is dismissed — NOT an indication of "granted".
    AsyncFunction("requestAuthorization") { () async throws in
      try self.ensureAvailable()
      try await self.store.requestAuthorization(toShare: [], read: self.readTypes)
    }

    // Total steps since local midnight.
    AsyncFunction("getTodaySteps") { () async throws -> Double in
      try self.ensureAvailable()
      let now = Date()
      let startOfDay = Calendar.current.startOfDay(for: now)
      let predicate = HKQuery.predicateForSamples(withStart: startOfDay, end: now)

      // A statistics query asks HealthKit to aggregate for us. .cumulativeSum
      // de-duplicates overlapping samples from multiple sources (iPhone +
      // Apple Watch), which naively adding samples up would double count.
      let descriptor = HKStatisticsQueryDescriptor(
        predicate: .quantitySample(type: self.stepType, predicate: predicate),
        options: .cumulativeSum)

      do {
        let statistics = try await descriptor.result(for: self.store)
        // nil = no samples (or read access denied — indistinguishable by design).
        return statistics?.sumQuantity()?.doubleValue(for: .count()) ?? 0
      } catch {
        throw self.queryError(error)
      }
    }

    // Most recent workouts in the last `days` days, newest first.
    AsyncFunction("getRecentWorkouts") { (limit: Int, days: Int) async throws -> [WorkoutRecord] in
      try self.ensureAvailable()
      let now = Date()
      let start = Calendar.current.date(byAdding: .day, value: -max(days, 1), to: now) ?? now
      let predicate = HKQuery.predicateForSamples(withStart: start, end: now)

      // A sample query returns the individual records (HKWorkout objects).
      let descriptor = HKSampleQueryDescriptor(
        predicates: [.workout(predicate)],
        sortDescriptors: [SortDescriptor(\.endDate, order: .reverse)],
        limit: max(1, min(limit, 50)))

      do {
        let workouts = try await descriptor.result(for: self.store)
        return workouts.map { self.toRecord($0) }
      } catch {
        throw self.queryError(error)
      }
    }

    // The most recent night's sleep: sleep samples that ended between
    // yesterday 6 PM and now. Returns nil (JS null) if nothing was recorded.
    AsyncFunction("getLastSleep") { () async throws -> SleepRecord? in
      try self.ensureAvailable()
      let now = Date()
      let startOfDay = Calendar.current.startOfDay(for: now)
      let windowStart = Calendar.current.date(byAdding: .hour, value: -6, to: startOfDay) ?? startOfDay
      let predicate = HKQuery.predicateForSamples(withStart: windowStart, end: now)

      let descriptor = HKSampleQueryDescriptor(
        predicates: [.categorySample(type: self.sleepType, predicate: predicate)],
        sortDescriptors: [SortDescriptor(\.startDate, order: .forward)])

      do {
        let samples = try await descriptor.result(for: self.store)
        return self.summarizeSleep(samples)
      } catch {
        throw self.queryError(error)
      }
    }
  }

  // MARK: - Helpers

  private func ensureAvailable() throws {
    guard HKHealthStore.isHealthDataAvailable() else {
      throw HealthDataUnavailableException()
    }
  }

  private func queryError(_ error: Error) -> Exception {
    // Surface HealthKit's own description to JS as a rejected promise.
    HealthKitQueryException(error.localizedDescription)
  }

  /// HKWorkout (a HealthKit class) → WorkoutRecord (JS-friendly values).
  private func toRecord(_ workout: HKWorkout) -> WorkoutRecord {
    let record = WorkoutRecord()
    record.id = workout.uuid.uuidString
    record.activityType = Self.name(for: workout.workoutActivityType)
    record.startDate = iso.string(from: workout.startDate)
    record.endDate = iso.string(from: workout.endDate)
    record.durationMinutes = (workout.duration / 60).rounded()
    return record
  }

  /// Sleep samples are categorized (in bed / core / deep / REM / awake...),
  /// and several sources may record the same night. Merge overlapping
  /// intervals per category before adding up, or minutes get double counted.
  private func summarizeSleep(_ samples: [HKCategorySample]) -> SleepRecord? {
    let asleepValues = HKCategoryValueSleepAnalysis.allAsleepValues.map(\.rawValue)
    let asleep = samples.filter { asleepValues.contains($0.value) }
    let inBed = samples.filter { $0.value == HKCategoryValueSleepAnalysis.inBed.rawValue }
    guard !asleep.isEmpty || !inBed.isEmpty else { return nil }

    let all = asleep + inBed
    let record = SleepRecord()
    record.startDate = iso.string(from: all.map(\.startDate).min()!)
    record.endDate = iso.string(from: all.map(\.endDate).max()!)
    record.asleepMinutes = (Self.mergedDuration(asleep) / 60).rounded()
    record.inBedMinutes = (Self.mergedDuration(inBed) / 60).rounded()
    return record
  }

  /// Total seconds covered by the samples, counting overlapping time once.
  private static func mergedDuration(_ samples: [HKCategorySample]) -> TimeInterval {
    let intervals = samples
      .map { ($0.startDate, $0.endDate) }
      .sorted { $0.0 < $1.0 }

    var total: TimeInterval = 0
    var current: (start: Date, end: Date)?
    for (start, end) in intervals {
      if let c = current, start <= c.end {
        current = (c.start, max(c.end, end))      // overlaps: extend
      } else {
        if let c = current { total += c.end.timeIntervalSince(c.start) }
        current = (start, end)                    // gap: start a new interval
      }
    }
    if let c = current { total += c.end.timeIntervalSince(c.start) }
    return total
  }

  /// Human-readable names for common activity types (HealthKit exposes an enum).
  private static func name(for type: HKWorkoutActivityType) -> String {
    switch type {
    case .running: return "Running"
    case .walking: return "Walking"
    case .cycling: return "Cycling"
    case .swimming: return "Swimming"
    case .hiking: return "Hiking"
    case .yoga: return "Yoga"
    case .traditionalStrengthTraining: return "Weight Training"
    case .functionalStrengthTraining: return "Functional Strength"
    case .highIntensityIntervalTraining: return "HIIT"
    case .elliptical: return "Elliptical"
    case .rowing: return "Rowing"
    case .dance: return "Dance"
    case .coreTraining: return "Core Training"
    case .pilates: return "Pilates"
    case .soccer: return "Soccer"
    case .basketball: return "Basketball"
    case .tennis: return "Tennis"
    case .mixedCardio: return "Mixed Cardio"
    default: return "Workout"
    }
  }
}
