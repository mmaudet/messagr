package eu.messagr

import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "Messagr"

  /**
   * Back to the ordinary theme before React draws anything.
   *
   * The activity is declared with `AppTheme.Launch`, whose window background
   * is the launch drawable, so the frame is up from the moment the system
   * creates the window. Left in place it would stay behind the React view and
   * show through wherever nothing is painted over it -- which looks like a
   * rendering fault rather than a splash that outstayed its welcome.
   *
   * Before `super.onCreate`, because that is where the window's decor is
   * built: after it, the swap has no effect.
   */
  override fun onCreate(savedInstanceState: Bundle?) {
    setTheme(R.style.AppTheme)
    super.onCreate(savedInstanceState)
  }

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   *
   * The delegate is subclassed here for exactly one reason: to hand JavaScript a directory this
   * process may write to. `createCryptoMachine` needs one, react-native-matrix-crypto deliberately
   * chooses none (a crypto library that picks its own on-disk location writes somewhere the
   * product did not agree to), and React Native exposes no path API. So the platform's own
   * answer, `filesDir`, travels to the root component as an initial property -- see App.tsx. This
   * follows the library's own example app (packages/example-app/android in
   * linagora/react-native-matrix-crypto) exactly: no dependency was added, and nothing was added
   * to the library.
   *
   * RULE FOR ANYONE ADDING A KEY TO THIS BUNDLE: initial properties are printed verbatim to the
   * system log. React Native's own AppRegistry logs the whole map on startup in a debug build --
   * `Running "Messagr" with {"rootTag":1,"initialProps":{"storeDir":"..."},...}`, in logcat here
   * and in the iOS system log on the other platform -- and they are ordinary JavaScript props
   * afterwards, which any code may print. So NO PASSPHRASE, NO KEY MATERIAL AND NO USER OR DEVICE
   * IDENTIFIER may travel this way. `storeDir` is here because it is the app's own private files
   * directory, derivable from the package name and secret from nobody. The session credentials
   * this app already carries travel a different way entirely (baked into the bundle at build
   * time, App.tsx / babel.config.js), precisely so they never pass through this path or this log
   * line. No gate in this repository enforces that -- this comment is the enforcement.
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      object : DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled) {
        override fun getLaunchOptions(): Bundle =
            Bundle().apply {
              putString("storeDir", this@MainActivity.applicationContext.filesDir.absolutePath)
            }
      }
}
