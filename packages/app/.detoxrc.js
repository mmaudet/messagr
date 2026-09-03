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
      // UNVERIFIED. This configuration has never been run: Detox on iOS needs
      // applesimutils, whose Homebrew tap has to be trusted on the machine
      // first, and that is the developer's decision rather than this file's.
      // Continuous integration runs the suite on Android, for a tenth of the
      // billed minutes, so nothing here depends on this being right.
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
    attached: {
      // A phone on the end of a cable. The boot criterion names a physical
      // device, and an emulator is not one: it runs the host's processor, its
      // kernel and its graphics, and answers questions about none of them.
      type: 'android.attached',
      device: { adbName: process.env.ANDROID_SERIAL || '.*' },
    },
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
    'android.attached.debug': { device: 'attached', app: 'android.debug' },
  },
}
