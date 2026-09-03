/**
 * The message to report for something thrown, whatever it turned out to be.
 *
 * Rejections are not always Errors, and every status type here carries a
 * reason rather than a bare failure, so this is the one place that reduction
 * happens.
 */
export function getErrorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
