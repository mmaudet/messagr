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
 * Needed after any launch with `delete: true`, and only those: the flag lives
 * in the keystore, which a plain relaunch keeps and a delete clears.
 */
export async function acceptThePromise(): Promise<void> {
  await waitFor(element(by.id('promise-action')))
    .toBeVisible()
    .withTimeout(30000)
  await element(by.id('promise-action')).tap()
}
