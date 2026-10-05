# CocoaPods spec for OUR local module. Expo autolinking finds it through
# ../expo-module.config.json and adds it to the app's Podfile automatically.
Pod::Spec.new do |s|
  s.name           = 'HealthKitModule'
  s.version        = '0.1.0'
  s.summary        = 'Read-only Apple HealthKit bridge owned by this app'
  s.description    = 'Steps, workouts and sleep via the Expo Modules API (Swift).'
  s.author         = 'Darron Brown'
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.license        = 'MIT'
  s.platforms      = { :ios => '16.4' } # HealthKit is iOS-only (no tvOS)
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'HealthKit'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
