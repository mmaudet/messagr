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
  // THE LANGUAGE IS PINNED, AND SIX RUNS WERE PAID TO LEARN WHY.
  //
  // Every text this suite asserts is French, and the application follows the
  // device unless somebody chooses -- so a suite that chose nothing was
  // asserting French against whatever locale the emulator happened to carry.
  // It got away with it while nothing scrolled.
  //
  // Then the language selector became a column (#115's sibling), the promise
  // screen grew past one screen, and this helper was taught to scroll to
  // reach the action. Detox scrolls a container at its centre -- and the
  // centre of that screen is now the language column, a nested scrollable.
  // The gesture dragged the languages instead of the page, the strip settled
  // on a neighbour, and the application rendered « Presents itself as »
  // where the suite wanted « Se présente comme ». Five earlier runs were
  // spent theorising about scroll offsets and visibility thresholds; the
  // label was never there to be found.
  //
  // Choosing explicitly is also what a person does, so this is not a test
  // accommodating a defect: it is the test stopping being accidental.
  await element(by.id('language-fr')).tap()
  await element(by.id('promise-terms')).tap()

  // SCROLLED TO, BECAUSE THIS SCREEN SAYS IT SCROLLS.
  //
  // `FirstLaunch` wraps itself in a ScrollView with its reason written down:
  // the four points and the thesis do not fit a small phone at the largest
  // system text size, and "a promise with its action below the fold is a
  // promise nobody can accept". This helper tapped the action where it
  // happened to be, which held only while the screen happened to be short.
  //
  // It stopped holding the day the language selector became a column -- four
  // rows instead of one strip -- and every test in the suite failed at the
  // hook, on a screen that was rendering correctly and an action Detox
  // reported at y=2344 on a 2364-tall phone. Searching for it is what makes
  // the helper honest about the screen it drives.
  await waitFor(element(by.id('promise-action')))
    .toBeVisible()
    .whileElement(by.id('promise-scroll'))
    .scroll(300, 'down')
  await element(by.id('promise-action')).tap()
}
