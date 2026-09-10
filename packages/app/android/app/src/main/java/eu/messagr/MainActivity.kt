package eu.messagr

import android.os.Bundle
import android.view.View
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
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
    liftTheContentAboveTheKeyboard()
  }

  /**
   * Pads the content up by whatever the software keyboard covers.
   *
   * WHY THE MANIFEST'S `adjustResize` IS NOT ENOUGH ANY MORE. It is declared,
   * and for years it was the whole answer: the system shrank the window and a
   * composer at the bottom rose with it. Under the edge-to-edge display
   * Android 15 enforces there is nothing left to shrink -- the window IS the
   * screen -- so the keyboard is simply drawn over the text field somebody is
   * typing into. Reported twice from a Pixel running Android 16 with
   * `targetSdk 36`, the second time after a JavaScript fix that could not
   * work: React Native's `keyboardDidShow` reports a height on Android by way
   * of the same window resize, so under edge-to-edge it reports nothing.
   *
   * The inset has to come from where it still exists, which is
   * `WindowInsetsCompat.Type.ime()`. This is the smallest thing that reads
   * it: the listener runs on the activity's own content view, applies the
   * keyboard's height as bottom padding, and returns the insets untouched so
   * nothing else that wants them is deprived.
   *
   * `ime()` and not `systemBars()`: the bars are the window's own furniture
   * and this listener is about the keyboard.
   *
   * # THE WHOLE KEYBOARD, AND IT USED TO SUBTRACT THE NAVIGATION BAR
   *
   * It padded by `keyboard.bottom - bars.bottom`, on the reasoning that the
   * navigation bar's inset was "already handled by the safe-area context on
   * the JavaScript side". **It is not.** `App.tsx` takes
   * `edges={['left', 'right']}` -- the bottom edge is deliberately not
   * reserved, because the tab bar is meant to sit against the bottom of the
   * screen. So the subtraction removed a reservation nobody was making, and
   * the composer stopped exactly one navigation bar short of the keyboard.
   *
   * Reported from a Pixel 10 Pro Fold with a screenshot: « le clavier
   * recouvre à moitié le champ de saisie ». Measured on the emulator, where
   * it very nearly did not show: the keyboard's top at 1580, the composer's
   * controls ending at 1557 -- twenty-three pixels of clearance, which a
   * different screen turns negative.
   *
   * While the keyboard is up the navigation bar is behind it, so there is
   * nothing there to leave room for. And while it is down `ime()` is zero,
   * so this changes nothing at rest.
   */
  private fun liftTheContentAboveTheKeyboard() {
    val content: View = findViewById(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val keyboard: Insets = insets.getInsets(WindowInsetsCompat.Type.ime())
      view.setPadding(0, 0, 0, keyboard.bottom)
      insets
    }
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
