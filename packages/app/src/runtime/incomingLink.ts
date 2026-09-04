// Type-only for the same reason every other adapter here is: the pure half
// takes a plain function, and only this file names React Native.
import { Linking } from 'react-native'

/**
 * The link the application was opened with, if it was opened with one.
 *
 * Two ways in, and the product needs both. `getInitialURL` answers when the
 * application was not running and the operating system started it to handle
 * the link — the cold case, which is what happens to somebody who has just
 * installed it and tapped what a friend sent. The event listener answers when
 * it was already running.
 *
 * Only the first is used for now: an application with no session has nothing
 * to do but claim, and one that already has a session ignores a second
 * invitation rather than spending it. Handling the warm case means deciding
 * what a second invitation means for an account that already exists, which is
 * a product question this slice does not have to answer.
 */
export type LinkSource = () => Promise<string | null>

export const initialLink: LinkSource = async () =>
  // `?? null`: the platform types this as possibly undefined, and a caller
  // deciding between "no link" and "a link" should have one shape to check,
  // not two.
  (await Linking.getInitialURL()) ?? null
