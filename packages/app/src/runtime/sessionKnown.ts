import { createClient } from 'matrix-js-sdk'

import { errcodeOf } from './errors'
import type { RestoreCredentials } from './sessionCredentials'

/**
 * Whether the account's own server still knows this session: `false` only
 * when it says the token is unknown, `null` when it does not answer.
 *
 * Measured on 26 September 2026: once an account is deactivated, `whoami`
 * answers `401 M_UNKNOWN_TOKEN`. Asked after a deletion that looked failed
 * (#382), and before a reinstall comes back by itself (#391). Through a
 * client restored from the session, which carries it to its own server and
 * to no other.
 */
export async function stillKnown(
  account: RestoreCredentials,
): Promise<boolean | null> {
  try {
    await createClient(account).whoami()
    return true
  } catch (error) {
    return errcodeOf(error) === 'M_UNKNOWN_TOKEN' ? false : null
  }
}

/**
 * The account ID exactly as the account's own server answers `whoami` for
 * this session's token (#468): what the invitation service asks too, and
 * keeps as the account a report comes from, so what the report's seal must
 * bind. Throws when the server does not answer.
 */
export async function accountIdOf(
  account: RestoreCredentials,
): Promise<string> {
  return (await createClient(account).whoami()).user_id
}
