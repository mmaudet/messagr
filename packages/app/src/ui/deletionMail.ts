import { t } from '../copy'

/** Where deletion is asked for by e-mail: the address the legal screen names. */
export const DELETION_ADDRESS = 'conformite@messagr.eu'

/**
 * A mail ready to send, for a device that cannot delete its account itself
 * (#384).
 *
 * # THE IDENTIFIER GOES IN THE MAIL, NOT ON THE SCREEN
 *
 * Decided on 26 September 2026. The operator needs to find the account, and
 * an account carries no e-mail, no telephone number and no real name: what the
 * help page asks for by hand -- the name somebody goes by in their
 * conversations, and the inviter's -- is an inquiry. The account's identifier
 * ends it. The product shows no identifier, and this does not either: it is
 * written into a mail the person reads before sending, to the one address
 * that needs it.
 */
export function deletionMail(accountId: string): string {
  const subject = encodeURIComponent(t('delete_mail_subject'))
  const body = encodeURIComponent(t('delete_mail_body %@', accountId))
  return `mailto:${DELETION_ADDRESS}?subject=${subject}&body=${body}`
}
