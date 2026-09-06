import { sendEncryptedEvent } from './encryptedSend'
import { getErrorMessage } from './errors'
import type { HttpRequester } from './pump'

/**
 * Adding and removing a reaction.
 *
 * ADR-0011: a reaction is an encrypted event like any other, so adding one is
 * the ordinary encrypt-and-put and nothing about the payload is novel — only
 * where the boundary sits. What is inside the ciphertext is Matrix's own
 * `m.relates_to` annotation shape, so the day this has to be legible to
 * another client only the boundary moves.
 *
 * # Removing is a redaction, and that is not symmetrical
 *
 * Adding sends an event. Removing redacts the event that was added, which
 * means the server learns that somebody withdrew *something* attached to a
 * particular message — it does not learn what. The ADR says so plainly rather
 * than leaving it to be discovered, and it is the reason a tally carries the
 * id of this account's own reaction: without it, "remove" would be a gesture
 * with nothing to point at.
 */

export interface ReactingMachine {
  readonly encryptEvent: (
    scope: string,
    eventType: string,
    payload: Record<string, unknown>,
  ) => Promise<{ ciphertext: Uint8Array }>
}

export interface ReactingDeps {
  readonly http: HttpRequester
  readonly machine: ReactingMachine
  readonly decodeUtf8: (bytes: Uint8Array) => string
  readonly newTransactionId: () => string
}

export type Reacted =
  | { readonly reacted: true; readonly eventId: string }
  | { readonly reacted: false; readonly reason: string }

/**
 * Reacts to `target` with `key`.
 *
 * The event type is `m.reaction`, kept even though nothing outside this
 * application will read it: an encrypted event's type is the *outer* type,
 * `m.room.encrypted`, so this one lives inside the ciphertext where it costs
 * nothing and says what the payload is to anybody who can open it.
 *
 * No session is established here. A reaction is made from inside a
 * conversation that already carries messages, so the group session exists by
 * the time anybody can tap anything — and a reaction is not the place to
 * discover that it does not.
 */
export async function reactTo(
  deps: ReactingDeps,
  scope: string,
  target: string,
  key: string,
): Promise<Reacted> {
  if (key === '') {
    return {
      reacted: false,
      reason: 'a reaction needs something to react with',
    }
  }

  try {
    const envelope = await deps.machine.encryptEvent(scope, 'm.reaction', {
      'm.relates_to': {
        rel_type: 'm.annotation',
        event_id: target,
        key,
      },
    })
    // The library's own naming warning: on this direction the field called
    // `ciphertext` is the whole wire content of the encrypted event.
    const eventId = await sendEncryptedEvent(
      deps.http,
      scope,
      deps.decodeUtf8(envelope.ciphertext),
      deps.newTransactionId(),
    )
    return { reacted: true, eventId }
  } catch (cause: unknown) {
    return { reacted: false, reason: getErrorMessage(cause) }
  }
}

/**
 * Removes a reaction this account made, by redacting the event that made it.
 *
 * `true` or a reason, never a throw: a reaction that would not come off is a
 * chip that stays on screen, which a person can act on, and not a failure
 * worth losing a conversation over.
 */
export async function unreact(
  deps: ReactingDeps,
  scope: string,
  reactionEventId: string,
): Promise<{ readonly removed: boolean; readonly reason?: string }> {
  try {
    await deps.http.authedRequest(
      'PUT',
      `/_matrix/client/v3/rooms/${encodeURIComponent(scope)}/redact/` +
        `${encodeURIComponent(reactionEventId)}/` +
        `${encodeURIComponent(deps.newTransactionId())}`,
      {},
      JSON.stringify({}),
    )
    return { removed: true }
  } catch (cause: unknown) {
    return { removed: false, reason: getErrorMessage(cause) }
  }
}
