/**
 * Invitations delivered inside the application (#404, #392): a findable
 * account invites the account behind a contact it found, by the reference the
 * directory lists for it, and never its number. The service holds each one
 * good for a week, for one use (`services/invitations/src/handlers/
 * delivered.rs`).
 *
 * # THE INVITER'S SIDE
 *
 * The conversation is created as for a link, with the same rules
 * (`createTheConversation`), then the invitation is sent to the service,
 * which never learns the conversation: this device keeps it, on a page of its
 * notebook (`sentInvitationStore.ts`). At each sync tick it asks where each
 * invitation stands. Once the recipient has joined, the service names the
 * account, and this device invites it into the conversation, where it enters
 * at level 0 as any entrant (ADR 0004), and gives it the name typed in
 * « Qui invitez-vous ? ».
 *
 * A link is asked about at every tick for the hour it is good
 * (`admitAnyoneWaiting.ts`). A sent invitation is asked about at every tick
 * until it is joined or runs out: a week, and past its deadline for as long
 * as the service keeps it, since one joined in time must still be honoured
 * by a device that reads late.
 */
import { parsed, type Answer } from './discovery'
import { getErrorMessage } from './errors'
import { createTheConversation } from './issueInvitation'
import type { HttpRequester } from './pump'

/** The routes of the service for invitations delivered inside Messagr. */
export interface DeliveryService {
  /** `POST /discovery/invitations`, with the reference. */
  readonly sendInvitation: (body: string) => Promise<Answer>
  /** `GET /discovery/invitations/:id`: where an invitation sent stands. */
  readonly sentStatus: (id: string) => Promise<Answer>
}

/** An invitation this device sent, that nobody has been let in through. */
export interface SentInvitation {
  readonly invitationId: string
  /** The conversation it leads to, which the service never learns. */
  readonly scope: string
  /** Milliseconds since the epoch. */
  readonly expiresAt: number
  /**
   * The name to give whoever comes through, as typed in « Qui invitez-vous ? »,
   * or `null`.
   */
  readonly given: string | null
  /**
   * The service said it ran out without being joined: nobody is asked about
   * any more, and the list says it expired.
   */
  readonly expired: boolean
}

/** The page of the notebook that keeps them: `sentInvitationStore.ts`. */
export interface SentInvitations {
  readonly all: () => Promise<readonly SentInvitation[]>
  /** Whether it held, as every page of the notebook says. */
  readonly remember: (sent: SentInvitation) => Promise<boolean>
  readonly forget: (invitationId: string) => Promise<boolean>
}

/**
 * The page, and what this launch sent besides.
 *
 * A page that will not open or will not write would otherwise leave an
 * invitation nobody is ever let in through, while the form said it was sent:
 * a link has its minute of asking to fall back on, and this has nothing.
 * What was sent on this launch is kept here as well, so that this launch at
 * least lets its recipient in; a relaunch knows only what the page kept.
 *
 * `page` is read at each call: the notebook opens after the application
 * starts, and opens again for another account (#304).
 */
export function keptThisLaunchToo(
  page: () => SentInvitations,
): SentInvitations {
  const here = new Map<string, SentInvitation>()
  return {
    all: async () => {
      const kept = new Map(
        (await page().all()).map(sent => [sent.invitationId, sent]),
      )
      for (const [id, sent] of here) if (!kept.has(id)) kept.set(id, sent)
      return [...kept.values()]
    },
    remember: async sent => {
      here.set(sent.invitationId, sent)
      return page().remember(sent)
    },
    forget: async invitationId => {
      here.delete(invitationId)
      return page().forget(invitationId)
    },
  }
}

/**
 * Why the service would not take an invitation, when it said so: the
 * caller's own number (`own-reference`), a contact no longer findable
 * (`unknown-reference`), or the caller no longer findable (`not-findable`).
 */
export type DeliveryRefusal =
  'own-reference' | 'unknown-reference' | 'not-findable'

export type Delivered =
  | {
      readonly delivered: true
      readonly scope: string
      readonly invitationId: string
      /** Milliseconds since the epoch. */
      readonly expiresAt: number
      /** Whether the page kept it: see `keptThisLaunchToo`. */
      readonly kept: boolean
    }
  | {
      readonly delivered: false
      readonly reason: string
      readonly refusal?: DeliveryRefusal
    }

const REFUSALS: Readonly<Record<string, DeliveryRefusal>> = {
  MESSAGR_OWN_REFERENCE: 'own-reference',
  MESSAGR_UNKNOWN_REFERENCE: 'unknown-reference',
  MESSAGR_NOT_FINDABLE: 'not-findable',
}

/**
 * Creates the conversation as for a link, sends the invitation to the
 * account behind `reference`, and keeps it on `deps.sent` with the name
 * typed. What leaves for the service is the reference and nothing else:
 * never a number, never a name, never the conversation.
 *
 * AN INVITATION THE SERVICE REFUSED LEAVES NO CONVERSATION BEHIND. A link
 * keeps its conversation when minting fails, since somebody may be in it
 * already (`issueInvitation`); nobody can be in one whose invitation was
 * refused, and it would sit on the list looking like one waiting.
 */
export async function deliverInvitation(
  deps: {
    readonly http: HttpRequester
    readonly service: DeliveryService
    readonly sent: SentInvitations
  },
  reference: string,
  given: string | null,
): Promise<Delivered> {
  const conversation = await createTheConversation(deps.http)
  if (!conversation.created) {
    return { delivered: false, reason: conversation.reason }
  }
  const { scope } = conversation
  const refused = async (
    reason: string,
    refusal?: DeliveryRefusal,
  ): Promise<Delivered> => {
    await leave(deps.http, scope)
    return {
      delivered: false,
      reason,
      ...(refusal === undefined ? {} : { refusal }),
    }
  }
  let answer: Answer
  try {
    answer = await deps.service.sendInvitation(JSON.stringify({ reference }))
  } catch (cause: unknown) {
    return refused(
      `the invitation could not be sent: ${getErrorMessage(cause)}`,
    )
  }
  const body = parsed(answer.body)
  if (answer.status < 200 || answer.status >= 300 || body === null) {
    const errcode = typeof body?.errcode === 'string' ? body.errcode : null
    return refused(
      `the invitation service refused it: ${errcode ?? answer.status}`,
      errcode === null ? undefined : REFUSALS[errcode],
    )
  }
  const { id, expires_at: expiresAt } = body
  if (typeof id !== 'string' || id === '' || typeof expiresAt !== 'number') {
    return refused('the invitation service answered something unexpected')
  }
  const sent: SentInvitation = {
    invitationId: id,
    scope,
    expiresAt: expiresAt * 1000,
    given,
    expired: false,
  }
  const kept = await deps.sent.remember(sent)
  return {
    delivered: true,
    scope,
    invitationId: id,
    expiresAt: sent.expiresAt,
    kept,
  }
}

/** Leaves a conversation nobody can enter; a failure leaves it on the list. */
async function leave(http: HttpRequester, scope: string): Promise<void> {
  try {
    await http.authedRequest(
      'POST',
      `/_matrix/client/v3/rooms/${encodeURIComponent(scope)}/leave`,
      {},
      '{}',
    )
  } catch {
    // An empty conversation on the list is untidy, not wrong: it says
    // nobody joined, which is true.
  }
}

/**
 * How long after its deadline an invitation is kept: the thirty days the
 * service keeps it (#416). One joined in time is let in however late this
 * device asks; one run out is shown as expired; past those days, the service
 * has forgotten it, and so does this device.
 */
export const KEPT_AFTER_DEADLINE_MS = 30 * 86_400_000

export interface Letting {
  readonly sent: SentInvitations
  readonly service: DeliveryService
  readonly http: HttpRequester
  /** Gives `userId` the name typed for it on this device. */
  readonly giveName: (userId: string, name: string) => Promise<void>
  readonly now: () => number
}

/** What one round of asking did. */
export interface LettingRound {
  /** Who was let in. Usually nobody, which is not a failure. */
  readonly admitted: readonly string[]
  /** The invitations whose account could not be invited, and why. */
  readonly failed: readonly {
    readonly invitationId: string
    readonly reason: string
  }[]
}

/**
 * Whether a round is under way: ticks do not wait for one another, and two
 * rounds at once would invite the same account twice.
 */
let asking = false

/**
 * Asks where each invitation sent stands, and lets in whoever joined one.
 *
 * - « claimed »: the account named is invited into the conversation, unless
 *   it is there already, given the name typed for it, and the invitation is
 *   forgotten;
 * - « expired »: kept as expired, for the list to say so, and not asked
 *   about any more;
 * - unknown to the service (`M_NOT_FOUND`): forgotten;
 * - anything else, or no answer: asked again at the next tick.
 *
 * A round while another is under way does nothing.
 */
export async function letInTheJoined(letting: Letting): Promise<LettingRound> {
  if (asking) return { admitted: [], failed: [] }
  asking = true
  try {
    return await oneRound(letting)
  } finally {
    asking = false
  }
}

async function oneRound(letting: Letting): Promise<LettingRound> {
  const admitted: string[] = []
  const failed: { invitationId: string; reason: string }[] = []
  for (const invitation of await letting.sent.all()) {
    if (letting.now() > invitation.expiresAt + KEPT_AFTER_DEADLINE_MS) {
      await letting.sent.forget(invitation.invitationId)
      continue
    }
    if (invitation.expired) continue
    let answer: Answer
    try {
      answer = await letting.service.sentStatus(invitation.invitationId)
    } catch {
      continue
    }
    const read = parsed(answer.body)
    if (answer.status === 404 && read?.errcode === 'M_NOT_FOUND') {
      await letting.sent.forget(invitation.invitationId)
      continue
    }
    if (answer.status !== 200) continue
    if (read?.status === 'expired') {
      await letting.sent.remember({ ...invitation, expired: true })
      continue
    }
    const entrant = read?.entrant_user_id
    if (
      read?.status !== 'claimed' ||
      typeof entrant !== 'string' ||
      entrant === ''
    ) {
      continue
    }
    try {
      // ASKED BEFORE INVITING, rather than read from a refusal: the
      // homeserver refuses to invite somebody already in the conversation
      // with the same answer as a real refusal, and a round that invited and
      // was stopped before forgetting would otherwise try for ever.
      if (!(await isThere(letting.http, invitation.scope, entrant))) {
        await letting.http.authedRequest(
          'POST',
          `/_matrix/client/v3/rooms/${encodeURIComponent(invitation.scope)}/invite`,
          {},
          JSON.stringify({ user_id: entrant }),
        )
      }
    } catch (cause: unknown) {
      failed.push({
        invitationId: invitation.invitationId,
        reason: getErrorMessage(cause),
      })
      continue
    }
    if (invitation.given !== null) {
      await letting.giveName(entrant, invitation.given)
    }
    await letting.sent.forget(invitation.invitationId)
    admitted.push(entrant)
  }
  return { admitted, failed }
}

/** Whether `userId` is invited into `scope`, or in it, already. */
async function isThere(
  http: HttpRequester,
  scope: string,
  userId: string,
): Promise<boolean> {
  try {
    const member = JSON.parse(
      await http.authedRequest(
        'GET',
        `/_matrix/client/v3/rooms/${encodeURIComponent(scope)}/state/m.room.member/${encodeURIComponent(userId)}`,
        {},
        undefined,
      ),
    ) as { membership?: unknown }
    return member.membership === 'invite' || member.membership === 'join'
  } catch {
    // No membership at all is answered with an error: never invited.
    return false
  }
}
