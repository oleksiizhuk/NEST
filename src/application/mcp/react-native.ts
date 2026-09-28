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
  'Metro / the red screen for a JS error; the Xcode build log for an iOS ' +
  'build failure; the Xcode debug console, the device crash report or ' +
  '`xcrun simctl spawn booted log stream --predicate \'process == "<App>"\'` ' +
  'for an iOS crash; the Gradle output for an Android build failure; ' +
  '`adb logcat --pid=$(adb shell pidof -s <applicationId>)` for an Android ' +
  'crash (the app only, not the whole device)';

// The same, short enough for one checklist line
export const RN_LOGS_SHORT =
  'Metro / red screen for JS; Xcode build log, debug console or crash ' +
  'report for iOS; Gradle output or adb logcat for Android';

// The same, short enough for one checklist line
export const RN_NATIVE_CONFIG_SHORT =
  'app.json / app.config.js, Podfile, Info.plist, AppDelegate, ' +
  'android/app/build.gradle, gradle.properties, AndroidManifest.xml, ' +
  'MainApplication, metro / babel config';

export const RN_NATIVE_CONFIG =
  'app.json / app.config.js, eas.json, ios/Podfile, Podfile.properties.json, ' +
  'Info.plist, *.entitlements, AppDelegate, android/build.gradle (sdk and ' +
  'Kotlin versions), android/app/build.gradle, android/gradle.properties ' +
  '(newArchEnabled, hermesEnabled), android/app/proguard-rules.pro, ' +
  'AndroidManifest.xml, MainApplication, metro.config.js, babel.config.js, ' +
  'react-native.config.js';
