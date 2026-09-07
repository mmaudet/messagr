/**
 * One poll's worth of a conversation, turned into the events a call listens
 * for.
 *
 * # WHY A CALL'S EVENTS ARRIVE SEALED
 *
 * `session.ts` sends its signalling encrypted and the specification says
 * why: a `party_id` identifies which of somebody's devices is on a call, and
 * in an unencrypted room that is disclosed to anybody who can read the
 * timeline. The cost lands here. What a sync carries is `m.room.encrypted`,
 * whose outer type says nothing at all, so **the only way to know an event
 * was a call is to open it** -- and the inner type comes back on the
 * envelope, which is the one place it exists.
 *
 * # Pure, like every other module under `src/calls/`
 *
 * The crypto machine is a port. `callPump.ts` binds it to the real bridge;
 * here it is two functions, so which events reach a call can be tested
 * without a homeserver, a microphone or a device.
 */

/** What this needs from a crypto machine, and nothing more. */
export interface OpeningMachine {
  readonly decryptEvent: (
    scope: string,
    rawEvent: unknown,
  ) => Promise<{ readonly eventType: string; readonly ciphertext: Uint8Array }>
}

export interface OpeningDeps {
  readonly machine: OpeningMachine
  /**
   * The field is called `ciphertext` and carries the **plaintext** on this
   * direction -- the library's own naming, which `buildTimeline.ts` and
   * `receiveDecrypt.ts` both match rather than rename, so that one surprise
   * lives in one place instead of three.
   */
  readonly decodeUtf8: (bytes: Uint8Array) => string
}

/** The prefix that makes an event this module's business. */
const CALL = 'm.call.'

/**
 * The call events inside `carried`, in the order they arrived.
 *
 * Order is not a nicety: an answer before its invite is not the same call,
 * and candidates applied before a remote description are candidates applied
 * to a connection with nowhere to put them.
 *
 * # ONE FAILURE DOES NOT COST THE OTHERS
 *
 * An event that will not open is dropped and the rest are still delivered.
 * ICE needs one path to work, so half a candidate list is worth having --
 * and this runs on the sync loop's own thread, where a throw belongs to
 * nobody.
 */
export async function openCallEvents(
  deps: OpeningDeps,
  scope: string,
  carried: readonly unknown[],
): Promise<readonly unknown[]> {
  const opened: unknown[] = []
  for (const raw of carried) {
    const event = raw as {
      type?: unknown
      sender?: unknown
      unsigned?: unknown
    }
    // Never sealed, so never a call: this application encrypts its
    // signalling, and handing a plaintext event to a decryptor is a failure
    // reported for a reason that has nothing to do with what happened.
    if (event.type !== 'm.room.encrypted') continue
    // A call is between two people, and `incomingCallEventOf` refuses an
    // event with no sender anyway. Refusing here saves the decryption.
    if (typeof event.sender !== 'string') continue

    try {
      const envelope = await deps.machine.decryptEvent(scope, raw)
      if (!envelope.eventType.startsWith(CALL)) continue
      opened.push({
        type: envelope.eventType,
        sender: event.sender,
        content: JSON.parse(deps.decodeUtf8(envelope.ciphertext)) as unknown,
        // CARRIED THROUGH, BECAUSE AGE DECIDES WHETHER A TELEPHONE RINGS.
        // `unsigned.age` is how the transport tells an invitation that is
        // arriving from one that arrived while the application was closed,
        // and it lives on the *outer* event: encryption does not touch it,
        // and dropping it here would make every replayed invite look new.
        ...(event.unsigned === undefined ? {} : { unsigned: event.unsigned }),
      })
    } catch {
      // A key that never came, or an event somebody took back -- a redaction
      // leaves an `m.room.encrypted` with nothing in it. Neither is a call,
      // and neither is worth the poll.
    }
  }
  return opened
}
