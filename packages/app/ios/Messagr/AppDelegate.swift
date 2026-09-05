import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  /// A directory this process may write the crypto store into.
  ///
  /// `createCryptoMachine` needs one, `react-native-matrix-crypto` deliberately chooses none (a
  /// crypto library that picked its own on-disk location would write somewhere the product never
  /// agreed to), and React Native exposes no path API. So the platform's own answer travels to the
  /// root component as an initial property, exactly as `filesDir` does on Android -- see
  /// `MainActivity.kt`, whose comment this one is the other half of.
  ///
  /// **Application Support, not Documents.** Documents is user-visible through the Files app the
  /// moment a build declares it, and it is the wrong place for a store whose whole content is key
  /// material. Application Support is the platform's own answer for data the app maintains and the
  /// person never browses. Not Caches either: the system may delete that under pressure, and a
  /// crypto store that vanishes takes every conversation's history with it.
  ///
  /// **The directory is created here rather than assumed.** Application Support does not exist in
  /// a freshly installed app's container, and `createCryptoMachine` would fail on a path that is
  /// not there -- on the first launch only, which is the launch hardest to reproduce and the one
  /// every new install performs.
  ///
  /// **A note left where somebody would otherwise have to rediscover it:** this directory is
  /// included in iCloud and iTunes backups by default, while the passphrase that opens the store
  /// lives in the keychain and may not be. A device restored from backup can therefore hold a
  /// store it cannot open. Nothing here decides that question -- it belongs with the keychain
  /// accessibility choice, not with a path -- but the two have to be decided together, and this is
  /// the first place a reader meets half of it.
  private static func cryptoStoreDirectory() -> String? {
    guard
      let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)
        .first
    else {
      return nil
    }
    do {
      try FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
    } catch {
      // Returning nil rather than an unusable path: `cryptoMachineConfig` refuses an empty
      // `storeDir` with a reason a person can read, and a path that exists in a string but not on
      // disk would fail deeper down with a message about SQLite.
      return nil
    }
    return base.path
  }

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    window = UIWindow(frame: UIScreen.main.bounds)

    // RULE FOR ANYONE ADDING A KEY HERE: initial properties are printed verbatim to the system
    // log. React Native's own AppRegistry logs the whole map on startup in a debug build --
    // `Running "Messagr" with {"rootTag":1,"initialProps":{"storeDir":"..."},...}` -- and they are
    // ordinary JavaScript props afterwards, which any code may print. So NO PASSPHRASE, NO KEY
    // MATERIAL AND NO USER OR DEVICE IDENTIFIER may travel this way. `storeDir` is here because it
    // is the app's own container path, derivable from the bundle identifier and secret from
    // nobody. The session credentials this app carries travel a different way entirely (baked into
    // the bundle at build time, App.tsx / babel.config.js), precisely so they never pass through
    // this path or this log line. No gate in this repository enforces that -- this comment is the
    // enforcement, on both platforms.
    var initialProperties: [AnyHashable: Any] = [:]
    if let storeDir = AppDelegate.cryptoStoreDirectory() {
      initialProperties["storeDir"] = storeDir
    }

    factory.startReactNative(
      withModuleName: "Messagr",
      in: window,
      initialProperties: initialProperties,
      launchOptions: launchOptions
    )

    return true
  }
}

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
