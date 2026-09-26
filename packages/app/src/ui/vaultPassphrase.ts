/**
 * Whether the key vault has a passphrase to work with.
 *
 * Its own function because two buttons and the keyboard's return key ask the
 * same question. On 15 September 2026 they answered it by doing nothing:
 * « Créer le coffre », touched with the field empty, returned without a word
 * on an iPhone and on the Pixel, while looking exactly as it does when it
 * works. The buttons are now drawn inert until this is true.
 *
 * Spaces alone are no passphrase. The passphrase itself is never trimmed:
 * spaces around it are part of what somebody typed.
 */
export function passphraseGiven(draft: string): boolean {
  return draft.trim() !== ''
}
