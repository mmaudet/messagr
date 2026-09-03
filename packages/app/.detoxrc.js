// The Metro port, overridable because 8081 is not always free: a second
// project's dev server on the same machine will answer instead, and the app
// then loads a bundle that does not register it. Both the build and the port
// reversal have to agree, which is why this is one value.
const metroPort = Number(process.env.RCT_METRO_PORT || 8081)

/** @type {Detox.DetoxConfig} */
module.exports = {
  testRunner: {
    args: { $0: 'jest', config: 'e2e/jest.config.js' },
    jest: { setupTimeout: 180000 },
  },
  apps: {
    'ios.release': {
      type: 'ios.app',
      binaryPath:
        'ios/build/Build/Products/Release-iphonesimulator/Messagr.app',
      // Built by hand rather than by Detox so that the artifact the end-to-end
      // run exercises is the same one built and shipped, not a variant.
      build:
        'xcodebuild -workspace ios/Messagr.xcworkspace -scheme Messagr -configuration Release -destination "generic/platform=iOS Simulator" -derivedDataPath ios/build build',
    },
    'android.debug': {
      type: 'android.apk',
      binaryPath: 'android/app/build/outputs/apk/debug/app-debug.apk',
      // Scoped to :app. An unscoped assembleAndroidTest builds the test
      // variant of every module, and react-native-matrix-crypto's then fails
      // merging native libraries: it ships a prebuilt libc++_shared.so that
      // collides with the toolchain's own. Detox needs only the app's.
      build: `cd android && ./gradlew :app:assembleDebug :app:assembleDebugAndroidTest -PreactNativeDevServerPort=${metroPort}`,
      reversePorts: [metroPort],
    },
  },
  devices: {
    simulator: { type: 'ios.simulator', device: { type: 'iPhone 17 Pro' } },
    emulator: {
      type: 'android.emulator',
      // Named by the environment so that a clone is not tied to one machine's
      // virtual devices. Continuous integration creates 'messagr-e2e'.
      device: { avdName: process.env.MESSAGR_AVD || 'messagr-e2e' },
    },
  },
  configurations: {
    'ios.sim.release': { device: 'simulator', app: 'ios.release' },
    'android.emu.debug': { device: 'emulator', app: 'android.debug' },
  },
}
