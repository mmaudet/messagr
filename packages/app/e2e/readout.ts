import { by, element, waitFor } from 'detox'

/** The readout's scroll container. Every assertion here starts from its top. */
export const SCROLL = by.id('diagnostic-scroll')

/**
 * Assert something on screen, from wherever the screen happens to be.
 *
 * Detox does not scroll on its own, so an assertion written as a plain
 * expectation is really an assertion about scroll position. That has cost
 * this suite four continuous-integration runs, each for a different reason
 * and each looking like a product failure: a block inserted rather than
 * appended, a focusable button pulling the whole readout down to reach it,
 * and a two-line label that was rendered exactly right and merely not 75 per
 * cent visible.
 *
 * All three were correct behaviour. Going to the top and searching downwards
 * removes the dependency instead of accommodating it once more.
 */
export async function seeText(text: string): Promise<void> {
  await element(SCROLL).scrollTo('top')
  await waitFor(element(by.text(text)))
    .toBeVisible()
    .whileElement(SCROLL)
    .scroll(300, 'down')
}

/** The same, for a line reached by its identifier rather than its words. */
export async function seeId(id: string): Promise<void> {
  await element(SCROLL).scrollTo('top')
  await waitFor(element(by.id(id)))
    .toBeVisible()
    .whileElement(SCROLL)
    .scroll(300, 'down')
}

/**
 * The same, scoped to one part of the screen.
 *
 * The conversation list shows the opening of the last message, and the
 * conversation shows that message: one sentence, two places, and a matcher
 * that only says "this text is on screen" matches both and fails as
 * ambiguous. Anything asserted about a conversation says which conversation
 * view it means.
 */
export async function seeTextWithin(
  ancestorId: string,
  text: string,
): Promise<void> {
  await element(SCROLL).scrollTo('top')
  await waitFor(element(by.text(text).withAncestor(by.id(ancestorId))))
    .toBeVisible()
    .whileElement(SCROLL)
    .scroll(300, 'down')
}
