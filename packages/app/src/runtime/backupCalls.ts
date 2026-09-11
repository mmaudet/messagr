import type { HttpRequester } from './pump'

/**
 * The three `/room_keys` requests this application makes itself, and the one
 * it does not.
 *
 * # WHY THREE AND NOT FOUR
 *
 * Uploading keys is the fourth, and it does not live here: it goes through
 * the pump as `room_key_backup`, because ADR-0013 puts it on the protocol's
 * path — *« un second endroit qui parle au homeserver avec des règles à lui
 * est la façon dont deux endroits finissent par diverger »*. `pump.ts`
 * routes it.
 *
 * These three are the ones the pump cannot carry, and the reason is the same
 * one the bridge gives for handing them back rather than queueing them: a
 * pump entry is a body to send and a report that it was sent, with no value
 * coming back. Creating a version answers with the version; reading one
 * answers with a description; downloading answers with every key. All three
 * need what comes back.
 *
 * # THE VERSION IS AN OPAQUE STRING, AND THIS IS WHERE THAT IS ENFORCED
 *
 * `publishVersion` reads `version` out of the answer and refuses anything
 * that is not a non-empty string — including a number, which is exactly what
 * a homeserver answering `{"version": 947281}` would give a client that
 * trusted `JSON.parse`. Synapse answers with a counter from `"1"` and
 * Continuwuity 26.7.2 with a six-digit integer; the specification makes the
 * field opaque, so a client that accepted a number and carried it would
 * work against one homeserver and lose a leading zero against the other.
 */
export interface BackupVersionInfo {
  /** Opaque. Never parsed, compared for order, or generated. */
  readonly version: string
  /** The whole description, for `restoreKeyMatches`. */
  readonly info: unknown
}

/**
 * Creates a backup version and answers with the identifier the homeserver
 * chose.
 *
 * Throws when the answer carries no usable version — which a caller reports
 * as a publishing failure, because that is what it is: the homeserver either
 * refused or answered something this client cannot use, and in both cases
 * nothing on this device has changed.
 */
export async function publishVersion(
  http: HttpRequester,
  body: unknown,
): Promise<string> {
  const answer = await http.authedRequest(
    'POST',
    '/_matrix/client/v3/room_keys/version',
    {},
    JSON.stringify(body),
  )
  const parsed = JSON.parse(answer) as { version?: unknown }
  if (typeof parsed.version !== 'string' || parsed.version === '') {
    throw new Error('the homeserver named no version for the backup it made')
  }
  return parsed.version
}

/**
 * The current backup on this account, or `null` when there is none.
 *
 * A homeserver with no backup answers `404` with `M_NOT_FOUND`, which the
 * transport raises. That is not a failure and must not be reported as one:
 * *no backup exists* is the ordinary answer for most accounts and is what
 * `offerRestore` turns on. Any other refusal is left to propagate — a
 * caller that cannot tell "there is none" from "the server is unreachable"
 * would tell somebody their past is gone during an outage.
 */
export async function readVersion(
  http: HttpRequester,
  notFound: (cause: unknown) => boolean,
): Promise<BackupVersionInfo | null> {
  let answer: string
  try {
    answer = await http.authedRequest(
      'GET',
      '/_matrix/client/v3/room_keys/version',
      {},
      undefined,
    )
  } catch (cause: unknown) {
    if (notFound(cause)) return null
    throw cause
  }

  const parsed = JSON.parse(answer) as { version?: unknown }
  if (typeof parsed.version !== 'string' || parsed.version === '') {
    // A description with no usable version is a description of nothing this
    // client can restore from, and saying "there is no backup" is both true
    // enough to act on and the safe direction: it offers nothing rather than
    // offering a restore that cannot run.
    return null
  }
  return { version: parsed.version, info: parsed }
}

/**
 * Every key in a backup version, as the homeserver holds them.
 *
 * The whole thing in one request, which is what `GET /room_keys/keys`
 * answers with. It can be large — every key an account ever held — and that
 * is the reason `restoreKeyMatches` exists and is asked first: a wrong key
 * found before this call costs a few hundred bytes, and found after it costs
 * all of them.
 *
 * Handed back as text rather than parsed, because the bridge takes it as an
 * object and parsing it here to re-serialise there would be two passes over
 * the largest payload this application handles.
 */
export async function downloadKeys(
  http: HttpRequester,
  version: string,
): Promise<unknown> {
  const answer = await http.authedRequest(
    'GET',
    '/_matrix/client/v3/room_keys/keys',
    { version },
    undefined,
  )
  return JSON.parse(answer)
}

/**
 * Retires a backup version: `DELETE /room_keys/version/{version}`.
 *
 * # WHAT THIS DESTROYS, AND WHY IT IS CALLED ANYWAY
 *
 * Every key the homeserver held under that version, and with them the only
 * thing the old restore key opened. There is no undo: the homeserver keeps
 * no copy of what it deletes, and this application never held one.
 *
 * It is called because the alternative is a false sentence. Réglages says a
 * replaced key « cessera d'ouvrir quoi que ce soit », and somebody replaces
 * a key precisely when they think the old one is written down somewhere they
 * cannot account for. A replacement that left the old backup standing would
 * leave that paper opening everything, which is the one thing the person was
 * trying to stop.
 *
 * # IT IS THE LAST STEP AND THAT IS NOT ARBITRARY
 *
 * See `replaceBackup.ts`: the new version is published, remembered and
 * enabled first. Between enabling and this call both versions stand, which
 * costs nothing — two keys open two backups and both are the person's. Doing
 * it the other way round leaves a window where the old backup is gone and
 * the new one is not yet running, and a device that stops there has no
 * backup at all and a key that opens nothing.
 *
 * A failure here is therefore survivable and must be REPORTED rather than
 * swallowed: the replacement worked, and the old key still opens the old
 * backup. That is a true sentence somebody can act on, and « c'est fait »
 * would not be.
 */
export async function retireVersion(
  http: HttpRequester,
  version: string,
): Promise<void> {
  await http.authedRequest(
    'DELETE',
    `/_matrix/client/v3/room_keys/version/${encodeURIComponent(version)}`,
    {},
    undefined,
  )
}
