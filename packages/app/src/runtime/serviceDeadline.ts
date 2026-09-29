/**
 * How long the invitation service is given to answer a call nothing on
 * screen waits for, and what stands for its answer past that.
 *
 * Shared by the two calls made on the way to something else: announcing a
 * deletion before the deactivation that counts (`deleteAccount.ts`), and
 * telling the service of a block the screens have already taken into account
 * (`block.ts`). A service that takes the connection and never answers must
 * not hold a screen. Given up, not cancelled: an answer that comes later
 * still does what it does.
 */
export const SERVICE_DEADLINE_MS = 10_000

/** `answer`, or `late` when `after(SERVICE_DEADLINE_MS)` comes first. */
export function withinTheDeadline<T, L>(
  answer: Promise<T>,
  after: (ms: number) => Promise<void>,
  late: L,
): Promise<T | L> {
  return Promise.race([answer, after(SERVICE_DEADLINE_MS).then(() => late)])
}
