// React Native facts the whole task protocol shares: the answer prompt, the
// start_task checklist and its fallback, the server instructions and the
// tool descriptions. Edit here, not in each text, so they never drift.

// What to take from package.json: never the whole file
export const RN_VERSIONS =
  'the react-native and expo versions and the dependencies involved, from ' +
  'package.json (not the whole file)';

// How the native folders are made: it decides how native changes are done
export const RN_PROJECT_KINDS =
  'Expo with generated native folders (CNG: ios/ and android/ come from ' +
  'prebuild and are usually in .gitignore), Expo with committed native ' +
  'folders, or bare React Native CLI';

export const RN_RUNTIME = 'Expo Go or a development build (expo-dev-client)';

// The right log for each failure
export const RN_LOGS =
  'JS: the red screen / LogBox, plus the Metro terminal (Expo CLI) or React ' +
  'Native DevTools (press j; bare RN 0.77+ no longer prints console.log in ' +
  'Metro), and in a release build logcat tag ReactNativeJS; iOS build: the ' +
  'Xcode build log; iOS crash: the Xcode debug console, on a simulator ' +
  "`xcrun simctl spawn booted log stream --predicate 'process == " +
  '"<executable name>"\'`, on a device Console.app or Xcode > Devices > ' +
  'View Device Logs, from TestFlight / App Store Xcode Organizer > ' +
  'Crashes; Android build: the Gradle output; Android crash at ' +
  'launch: `adb logcat -b crash` (or `adb logcat AndroidRuntime:E ' +
  'ReactNativeJS:V *:S`), in a running app `adb logcat --pid=<pid>` from ' +
  '`adb shell pidof -s <applicationId>`';

// Short form of RN_LOGS, for one checklist line
export const RN_LOGS_SHORT =
  'red screen and Metro or React Native DevTools for JS; Xcode build log, ' +
  'debug console or device logs for iOS; Gradle output or adb logcat -b ' +
  'crash for Android';

export const RN_NATIVE_CONFIG =
  'app.json / app.config.js (with expo-build-properties), eas.json, ios/Podfile, Podfile.properties.json, ' +
  'Gemfile, ios/.xcode.env(.local), Info.plist, *.entitlements, ' +
  'AppDelegate, android/build.gradle (sdk and Kotlin versions), ' +
  'android/settings.gradle, android/gradle/wrapper/gradle-wrapper.properties, ' +
  'android/app/build.gradle, android/gradle.properties (newArchEnabled, ' +
  'hermesEnabled), android/app/proguard-rules.pro, AndroidManifest.xml, ' +
  'MainApplication, metro.config.js, babel.config.js, react-native.config.js';

// Short form of RN_NATIVE_CONFIG, for one checklist line
export const RN_NATIVE_CONFIG_SHORT =
  'app.json / app.config.js, Podfile, Info.plist, AppDelegate, ' +
  'android/app/build.gradle, gradle.properties, AndroidManifest.xml, ' +
  'MainApplication, metro / babel config';
