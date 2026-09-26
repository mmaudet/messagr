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

/**
 * The Matrix error code something thrown or answered carried, if it carried
 * one: matrix-js-sdk's `MatrixError`, the pump's own error, or a response
 * body. Duck-typed, because each of those is its own shape.
 */
export function errcodeOf(cause: unknown): string | null {
  if (typeof cause !== 'object' || cause === null) return null
  const code = (cause as { readonly errcode?: unknown }).errcode
  return typeof code === 'string' ? code : null
}
