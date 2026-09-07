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
 * BOTH ARE USED NOW, AND A TESTER IS WHY.
 *
 * Only the cold one was, on the reasoning that a warm invitation raised a
 * product question -- what a second invitation means for an account that
 * already exists. That reasoning skipped the case that actually happened on
 * 7 September 2026: somebody installed the application, opened it, and only
 * THEN was sent a link. The application was already running, so the link
 * brought it to the front and nothing read it. He watched an empty
 * conversation list and could do nothing at all.
 *
 * The warm case is not one question but two, and only one of them is open.
 * **With no session it is the same as the cold one**: there is nothing to do
 * but claim, and the ambiguity was never there. With a session, the answer is
 * already written -- `entry.ts` refuses to spend it and says so on screen.
 */
export type LinkSource = () => Promise<string | null>

export const initialLink: LinkSource = async () =>
  // `?? null`: the platform types this as possibly undefined, and a caller
  // deciding between "no link" and "a link" should have one shape to check,
  // not two.
  (await Linking.getInitialURL()) ?? null

/**
 * Every link handed over while the application is running.
 *
 * Answers the function that stops listening, which is what a React effect
 * returns. The url arrives whole: `entry.ts` parses it, and a listener that
 * decided anything here would be a second place the link's shape is known.
 */
export function watchLinks(arrived: (url: string) => void): () => void {
  const subscription = Linking.addEventListener('url', ({ url }) => {
    arrived(url)
  })
  return () => subscription.remove()
}
