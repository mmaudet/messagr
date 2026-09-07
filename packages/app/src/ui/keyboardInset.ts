import { useEffect, useState } from 'react'
import { Keyboard, Platform } from 'react-native'

/**
 * How much of the screen the software keyboard is covering.
 *
 * # `adjustResize` used to do this, and it stopped
 *
 * `AndroidManifest.xml` declares `windowSoftInputMode="adjustResize"`, and
 * for years that was the whole answer: the system shrank the window and a
 * composer at the bottom rose with it. **Under the edge-to-edge display that
 * Android 15 enforces, it no longer resizes anything.** The window is the
 * whole screen by definition, so there is nothing to shrink, and an
 * application that relied on the system doing it gets a keyboard drawn over
 * its own text field.
 *
 * Reported on a Pixel running Android 16 with `targetSdk 36`, where somebody
 * trying to answer a message could not see what they were typing.
 *
 * # Why a listener rather than `KeyboardAvoidingView`
 *
 * `KeyboardAvoidingView`'s Android behaviour is exactly the one that stopped
 * working: it defers to the window resize. Its `height` and `padding`
 * behaviours are written for iOS, where they are what this hook does with
 * more machinery around it. One hook, used the same way on both platforms, is
 * fewer moving parts than one component behaving differently on each.
 *
 * # `Will` on iOS, `Did` on Android, and neither platform has both
 *
 * iOS emits `keyboardWillShow` before the animation, which is what lets the
 * screen move with the keyboard rather than after it. Android emits only
 * `keyboardDidShow`. Subscribing to the pair each platform actually has is
 * the difference between a composer that rises with the keyboard and one that
 * jumps once the keyboard has arrived.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0)

  useEffect(() => {
    const shown = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const hidden =
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'
    const up = Keyboard.addListener(shown, event => {
      // `endCoordinates.height` is what the keyboard will occupy once it has
      // finished arriving. The screen height minus its top would be the same
      // number the long way round, and wrong on a split keyboard.
      setInset(event.endCoordinates.height)
    })
    const down = Keyboard.addListener(hidden, () => setInset(0))
    return () => {
      up.remove()
      down.remove()
    }
  }, [])

  return inset
}
