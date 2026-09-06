import { by, element, waitFor } from 'detox'

/**
 * Reading the promise and tapping through it, which is what a person does.
 *
 * The first-launch screen gates the whole launch path: nothing reaches the
 * network, claims an invitation or asks a permission until somebody has
 * accepted it. That is the screen's claim rather than an ordering preference,
 * so a suite that bypassed it — by seeding the keystore flag, say — would be
 * testing an application nobody runs.
 *
 * # The terms are ticked, and that is part of the gesture
 *
 * #103 put a checkbox in front of the action, and the action does nothing
 * until it is ticked. Doing it here rather than in each test is what keeps
 * every test honest about it: a helper that tapped the action alone would
 * fail everywhere the day the gate arrived, which is how a suite ends up with
 * the gate quietly disabled.
 *
 * Needed after any launch with `delete: true`, and only those: the flag lives
 * in the keystore, which a plain relaunch keeps and a delete clears.
 */
export async function acceptThePromise(): Promise<void> {
  await waitFor(element(by.id('promise-terms')))
    .toBeVisible()
    .withTimeout(30000)
  await element(by.id('promise-terms')).tap()
  await element(by.id('promise-action')).tap()
}
