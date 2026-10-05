/**
 * Config plugin for our HealthKit module.
 *
 * `npx expo prebuild` (also run by `npx expo run:ios`) regenerates ios/ from
 * app.json. This plugin hooks into that step so the generated Xcode project
 * gets what HealthKit requires — no manual Xcode clicking:
 *
 *   1. Entitlement  com.apple.developer.healthkit = true
 *      (the same thing Xcode's "Signing & Capabilities → + HealthKit" adds)
 *   2. Info.plist   NSHealthShareUsageDescription
 *      (the text on the permission sheet; the app CRASHES on
 *       requestAuthorization if it's missing)
 *
 * We only READ health data, so we deliberately do NOT add
 * NSHealthUpdateUsageDescription (needed only for writing).
 *
 * Used from app.json:
 *   "plugins": [["./modules/health-kit/app.plugin.js", { "healthSharePermission": "..." }]]
 */
const { withEntitlementsPlist, withInfoPlist } = require('expo/config-plugins');

const DEFAULT_SHARE_PERMISSION =
  'Allow $(PRODUCT_NAME) to read your steps, workouts and sleep to show your daily summary.';

function withHealthKit(config, props = {}) {
  config = withEntitlementsPlist(config, (mod) => {
    mod.modResults['com.apple.developer.healthkit'] = true;
    // Xcode adds this key with an empty array by default. It's only populated
    // for Clinical Health Records, which we don't use.
    mod.modResults['com.apple.developer.healthkit.access'] = [];
    return mod;
  });

  config = withInfoPlist(config, (mod) => {
    mod.modResults.NSHealthShareUsageDescription =
      props.healthSharePermission ?? DEFAULT_SHARE_PERMISSION;
    return mod;
  });

  return config;
}

module.exports = withHealthKit;
