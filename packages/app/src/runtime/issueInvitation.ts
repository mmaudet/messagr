import { getErrorMessage } from './errors'
import type { HttpRequester } from './pump'

/**
 * Inviting somebody, which is the same gesture as starting a conversation
 * with them.
 *
 * `CONTEXT.md` defines a direct conversation as being between exactly two
 * participants. An empty one waiting for its second is not a conversation; it
 * is a Matrix room, and the glossary refuses that word as a product noun. So
 * there is no "create a conversation" here separate from inviting into it:
 * one call makes both, or neither.
 *
 * # The step that is easy to miss
 *
 * A minted invitation is not yet claimable. The first claim **draws** an
 * account and answers 409, because the drawn account is in no conversation
 * yet; what unblocks it is the issuer inviting that account, and then a
 * second claim. Measured while proving #47, and the reason this module has
 * two halves with the entrant's own first claim in between.
 *
 * The issuer's half is [`admitDrawnEntrant`], and nobody taps anything for
 * it: a person who has handed over a link has finished, and an application
 * that made them come back to press "let them in" would have invented a
 * ceremony the protocol does not need.
 */

/**
 * What this module needs from the invitation service. Its own port rather
 * than `pump.ts`'s `HttpRequester`, for one reason: minting an invitation
 * needs an idempotency key, which is a header, and `HttpRequester` carries
 * none. Widening a seam the whole pump shares, to pass one header used in one
 * place, is the wrong trade.
 */
export interface InvitationService {
  /** `POST /invitations`, authenticated, with the idempotency key. */
  readonly issue: (
    body: string,
    idempotencyKey: string,
  ) => Promise<{ readonly status: number; readonly body: string }>
  /** `GET /invitations/{id}`, authenticated. */
  readonly status: (
    invitationId: string,
  ) => Promise<{ readonly status: number; readonly body: string }>
}

export interface IssuingDeps {
  readonly http: HttpRequester
  readonly service: InvitationService
  /**
   * Required by the service, and it says why: without one, every retry would
   * create a new pool of definitive accounts.
   */
  readonly newIdempotencyKey: () => string
  /** Awaited between polls. Absent in tests, which should not sleep. */
  readonly wait?: (ms: number) => Promise<void>
}

export type Issued =
  | {
      readonly issued: true
      /** The conversation that was created for it. */
      readonly scope: string
      /** The link to hand over. */
      readonly link: string
      /** Needed by [`admitDrawnEntrant`], and by nothing a person sees. */
      readonly invitationId: string
    }
  | {
      readonly issued: false
      readonly reason: string
      /**
       * The conversation, when one was created before the failure.
       *
       * Reported rather than swallowed: a conversation that exists with no
       * invitation for it is a real thing on the homeserver, and a person
       * seeing it appear with no explanation is worse than being told.
       */
      readonly scope?: string
    }

/** How long a link is good for. An hour, which is the bench's own figure. */
const TTL_SECONDS = 3600

/** What a conversation of this product costs to invite into. */
const INVITE_COST = 50

/**
 * Creates the conversation, sets the rules it must carry, and mints one
 * single-use invitation for it.
 *
 * # The rules are not decoration
 *
 * `createRoom` leaves no `invite` key, and the specification's default for a
 * missing one is **0**: every member may invite. A conversation of this
 * product costs 50 to invite into and admits members at 0, which is what
 * makes "an entrant cannot invite, a promoted member can" true at all — and
 * the invitation service reads that event rather than taking the
 * application's word for it.
 *
 * Encryption likewise: the presets do not turn it on, and a client that asks
 * whether the conversation is encrypted — which is what a Matrix client does
 * before deciding to encrypt — would be told no and send plaintext.
 *
 * # Order, and what a failure leaves behind
 *
 * The conversation first, because the invitation is *for* it and the service
 * refuses to mint one for nothing. That means a failure after this point
 * leaves a conversation with no invitation. It is reported rather than
 * cleaned up: deleting a conversation somebody may already be in is a worse
 * answer than an empty one they can see.
 */
export async function issueInvitation(
  deps: IssuingDeps,
  linkHost: string,
): Promise<Issued> {
  let scope: string
  try {
    const created = await deps.http.authedRequest(
      'POST',
      '/_matrix/client/v3/createRoom',
      {},
      JSON.stringify({ preset: 'private_chat' }),
    )
    const roomId = (JSON.parse(created) as { room_id?: unknown }).room_id
    if (typeof roomId !== 'string' || roomId === '') {
      return { issued: false, reason: 'the conversation was not created' }
    }
    scope = roomId
  } catch (cause: unknown) {
    return {
      issued: false,
      reason: `the conversation was not created: ${getErrorMessage(cause)}`,
    }
  }

  try {
    await setTheRules(deps.http, scope)
  } catch (cause: unknown) {
    return {
      issued: false,
      scope,
      reason: `the conversation's rules were refused: ${getErrorMessage(cause)}`,
    }
  }

  try {
    const answer = await deps.service.issue(
      JSON.stringify({
        max_uses: 1,
        ttl_seconds: TTL_SECONDS,
        room_id: scope,
      }),
      deps.newIdempotencyKey(),
    )
    if (answer.status < 200 || answer.status >= 300) {
      return {
        issued: false,
        scope,
        reason: 'the invitation service refused to mint an invitation',
      }
    }
    const minted = JSON.parse(answer.body) as {
      token?: unknown
      invitation_id?: unknown
    }
    if (
      typeof minted.token !== 'string' ||
      typeof minted.invitation_id !== 'string'
    ) {
      return {
        issued: false,
        scope,
        reason: 'the invitation service answered something unexpected',
      }
    }
    return {
      issued: true,
      scope,
      invitationId: minted.invitation_id,
      link: `messagr://${linkHost}/i/${minted.token}`,
    }
  } catch (cause: unknown) {
    return {
      issued: false,
      scope,
      reason: `the invitation could not be minted: ${getErrorMessage(cause)}`,
    }
  }
}

/**
 * Reads the power levels, raises the cost of inviting, and turns encryption
 * on.
 *
 * Read then write, touching only what has to change: `powerLevels.ts` carries
 * the content as an opaque object for exactly this reason — a PUT replaces
 * the whole event, so building one from scratch would silently drop whatever
 * the homeserver put there.
 */
async function setTheRules(http: HttpRequester, scope: string): Promise<void> {
  const path = `/_matrix/client/v3/rooms/${encodeURIComponent(scope)}/state`
  const held = JSON.parse(
    await http.authedRequest(
      'GET',
      `${path}/m.room.power_levels`,
      {},
      undefined,
    ),
  ) as Record<string, unknown>

  await http.authedRequest(
    'PUT',
    `${path}/m.room.power_levels`,
    {},
    JSON.stringify({ ...held, invite: INVITE_COST, users_default: 0 }),
  )

  await http.authedRequest(
    'PUT',
    `${path}/m.room.encryption`,
    {},
    JSON.stringify({ algorithm: 'm.megolm.v1.aes-sha2' }),
  )
}

export type Admission =
  | { readonly admitted: true; readonly entrant: string }
  | { readonly admitted: false; readonly reason: string }

/**
 * How many times to ask the service who it drew, and how long to wait
 * between. Thirty times two seconds: a minute, which is the bench's own
 * figure and long enough for somebody to open a link they were just handed.
 */
const ATTEMPTS = 30
const BETWEEN_MS = 2000

/**
 * Waits for the service to name the account it drew, and invites it.
 *
 * The issuer's half of a two-party dance, and it runs without anybody asking
 * for it. Until it happens the link does not work: the entrant's first claim
 * drew an account and was told 409, and their second will keep being told the
 * same until that account is a member.
 *
 * Gives up rather than waiting for ever. A link nobody opens is the ordinary
 * case — somebody was handed one and has not got to it yet — and a poll that
 * ran until the application closed would spend a minute of radio on every
 * invitation ever issued. The link stays valid for its hour either way; what
 * stops is the watching, and issuing again is what resumes it.
 */
export async function admitDrawnEntrant(
  deps: IssuingDeps,
  invitationId: string,
  scope: string,
): Promise<Admission> {
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    let entrant: string | null = null
    try {
      const answer = await deps.service.status(invitationId)
      if (answer.status >= 200 && answer.status < 300) {
        const named = (JSON.parse(answer.body) as { entrant_user_id?: unknown })
          .entrant_user_id
        if (typeof named === 'string' && named !== '') entrant = named
      }
    } catch {
      // A failed poll is not a failed invitation: the next attempt asks
      // again, and the link is unaffected by this application's connectivity.
    }

    if (entrant !== null) {
      try {
        await deps.http.authedRequest(
          'POST',
          `/_matrix/client/v3/rooms/${encodeURIComponent(scope)}/invite`,
          {},
          JSON.stringify({ user_id: entrant }),
        )
        return { admitted: true, entrant }
      } catch (cause: unknown) {
        return {
          admitted: false,
          reason: `${entrant} was drawn and could not be invited: ${getErrorMessage(cause)}`,
        }
      }
    }

    await deps.wait?.(BETWEEN_MS)
  }

  return {
    admitted: false,
    reason: 'nobody has opened the link yet',
  }
}
