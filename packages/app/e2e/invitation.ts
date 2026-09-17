import { by, element, waitFor } from 'detox'

/**
 * Answering §13.3's first screen, which is what a person does now. #329.
 *
 * A launch opened with an invitation link no longer spends it on arrival.
 * `entry.ts` stops above the fork, describes the link — who claims to be
 * inviting, from which instance, and what this device cannot state — and
 * waits inside the launch for one of two actions. Nothing reaches the
 * invitation service until « Rejoindre la conversation » is tapped.
 *
 * So every suite that launches with a `url` needs this, in the same way and
 * for the same reason it needs `acceptThePromise`: the gate is the product's
 * claim rather than an ordering preference, and a suite that bypassed it —
 * by seeding a flag, say — would be testing an application nobody runs.
 *
 * Needed after ANY launch with a `url`, and only those: a relaunch with no
 * link has nothing to describe and this screen never appears. Waiting for it
 * there would fail a test about session restoration, on a screen that is
 * correctly absent.
 *
 * # SCROLLED TO, LIKE THE PROMISE
 *
 * `Invited.tsx` wraps itself in a ScrollView with its reason written down:
 * this screen is the only way to answer an invitation at all, so an action a
 * longer label could push off a short telephone would be an invitation
 * nobody could refuse. Tapping where the action happens to be holds only
 * while the screen happens to be short — which is exactly what the promise
 * screen cost six runs to learn.
 */
export async function joinTheInvitation(): Promise<void> {
  await waitFor(element(by.id('invited')))
    .toBeVisible()
    .withTimeout(60000)
  await waitFor(element(by.id('invited-join')))
    .toBeVisible()
    .whileElement(by.id('invited'))
    .scroll(300, 'down')
  await element(by.id('invited-join')).tap()
}
