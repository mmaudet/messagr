import { by, element, waitFor } from 'detox'

/**
 * Finding something on a screen taller than the viewport.
 *
 * # This is not the readout helper coming back
 *
 * `readout.ts` did this and was deleted with #105, and the reason it was
 * deleted is worth keeping straight: it was used to assert on *diagnostic
 * text*, so every assertion in the suite was really an assertion about scroll
 * position, and four continuous-integration failures were paid for it. The
 * facts moved to the log, where they cannot be scrolled off.
 *
 * What survives is the technique, for the handful of assertions that are
 * genuinely about a screen. A conversation is longer than a phone. Detox does
 * not scroll on its own, so an element below the fold is reported absent,
 * which is indistinguishable from one that was never rendered.
 *
 * # Why not simply assert visibility
 *
 * Because that was tried, on the branch this file was written for, and it
 * failed on a screen rendering exactly the right words. The sender's line is
 * two lines tall -- a Matrix user id is long -- and Detox wants 75 per cent of
 * an element's area visible. Master's suite has always gone to the top and
 * searched down for that one, and the assertion that replaced it timed out at
 * sixty seconds against a label that was there.
 *
 * # Where it is deliberately NOT used
 *
 * `boot.test.ts` asserts a sent message is visible with no scrolling at all,
 * and that is the point of it: the conversation is supposed to rest at its
 * newest message, and a search that scrolled to find it would pass whether or
 * not it does.
 */

/** The product's own frame. One per screen -- see `key` in App.tsx. */
export const SCREEN = by.id('screen-scroll')

/** Assert some text is on screen, from wherever the screen happens to be. */
export async function seeOnScreen(text: string): Promise<void> {
  await element(SCREEN).scrollTo('top')
  await waitFor(element(by.text(text)))
    .toBeVisible()
    .whileElement(SCREEN)
    .scroll(300, 'down')
}
