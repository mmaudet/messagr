/**
 * Invitations delivered inside the application (#404, #392): a findable
 * account invites the account behind a contact it found, by the reference the
 * directory lists for it, and never its number. The service keeps the
 * invitation a week, for one use (`services/invitations/src/handlers/
 * delivered.rs`).
 *
 * # THE INVITER'S SIDE
 *
 * The conversation is created as for a link, with the same rules
 * (`issueInvitation.ts`), then the invitation is sent to the service, which
 * never learns the conversation: this device keeps it, on a page of its
 * notebook (`sentInvitationStore.ts`). At each sync tick it asks where each
 * invitation stands. Once the recipient has joined, the service names the
 * account, and this device invites it into the conversation, where it enters
 * at level 0 as any entrant (ADR 0004), and gives it the name typed in
 * « Qui invitez-vous ? ».
 *
 * The recipient may join days after the invitation left, and a link's
 * minute of asking does not fit that (`admitAnyoneWaiting.ts`): a sent
 * invitation is asked about once a tick, until it is joined or runs out.
 */
import { parsed, type Answer } from './discovery'
import { getErrorMessage } from './errors'
import { createTheConversation } from './issueInvitation'
import type { HttpRequester } from './pump'

/** The routes of the service for invitations delivered inside Messagr. */
export interface DeliveryService {
  /** `POST /discovery/invitations`, with the reference. */
  readonly send: (body: string) => Promise<Answer>
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
}

/** The page of the notebook that keeps them: `sentInvitationStore.ts`. */
export interface SentInvitations {
  readonly all: () => Promise<readonly SentInvitation[]>
  /** Whether it held, as every page of the notebook says. */
  readonly remember: (sent: SentInvitation) => Promise<boolean>
  readonly forget: (invitationId: string) => Promise<boolean>
}

export type Delivered =
  | {
      readonly delivered: true
      readonly scope: string
      readonly invitationId: string
      /** Milliseconds since the epoch. */
      readonly expiresAt: number
    }
  | {
      readonly delivered: false
      readonly reason: string
      /** The conversation, when it was created before the failure. */
      readonly scope?: string
    }

/**
 * Creates the conversation as for a link, then sends the invitation to the
 * account behind `reference`. What leaves for the service is the reference,
 * and nothing else: never a number, never a name, never the conversation.
 */
export async function deliverInvitation(
  deps: { readonly http: HttpRequester; readonly service: DeliveryService },
  reference: string,
): Promise<Delivered> {
  const conversation = await createTheConversation(deps.http)
  if (!conversation.created) return { delivered: false, ...conversation }
  const { scope } = conversation
  let answer: Answer
  try {
    answer = await deps.service.send(JSON.stringify({ reference }))
  } catch (cause: unknown) {
    return {
      delivered: false,
      scope,
      reason: `the invitation could not be sent: ${getErrorMessage(cause)}`,
    }
  }
  const body = parsed(answer.body)
  if (answer.status < 200 || answer.status >= 300 || body === null) {
    const errcode =
      typeof body?.errcode === 'string' ? body.errcode : `${answer.status}`
    return {
      delivered: false,
      scope,
      reason: `the invitation service refused it: ${errcode}`,
    }
  }
  const { id, expires_at: expiresAt } = body
  if (typeof id !== 'string' || id === '' || typeof expiresAt !== 'number') {
    return {
      delivered: false,
      scope,
      reason: 'the invitation service answered something unexpected',
    }
  }
  return {
    delivered: true,
    scope,
    invitationId: id,
    expiresAt: expiresAt * 1000,
  }
}

/**
 * How long after its deadline an invitation is still asked about: the thirty
 * days the service keeps it (#416). One joined in time is still let in
 * however late this device asks; past those days, the service has forgotten
 * it, and so does this device.
 */
export const STOP_ASKING_AFTER_DEADLINE_MS = 30 * 86_400_000

export interface Letting {
  readonly sent: SentInvitations
  readonly service: DeliveryService
  readonly http: HttpRequester
  /** Gives `userId` the name typed for it on this device. */
  readonly name: (userId: string, name: string) => Promise<void>
  readonly now: () => number
}

/**
 * Asks where each invitation sent stands, and lets in whoever joined one.
 * What was let in is returned; usually nobody, which is not a failure.
 *
 * - « claimed »: the account named is invited into the conversation, unless
 *   it is there already, given the name typed for it, and the invitation is
 *   forgotten;
 * - « expired », or unknown to the service: forgotten, and the conversation
 *   stays, with nobody else in it, as a link's that nobody spent;
 * - anything else, or no answer: asked again at the next tick.
 */
export async function letInTheJoined(
  letting: Letting,
): Promise<readonly string[]> {
  const admitted: string[] = []
  for (const invitation of await letting.sent.all()) {
    if (letting.now() > invitation.expiresAt + STOP_ASKING_AFTER_DEADLINE_MS) {
      await letting.sent.forget(invitation.invitationId)
      continue
    }
    try {
      const answer = await letting.service.sentStatus(invitation.invitationId)
      const read = parsed(answer.body)
      if (
        answer.status === 404 ||
        (answer.status === 200 && read?.status === 'expired')
      ) {
        await letting.sent.forget(invitation.invitationId)
        continue
      }
      const entrant = read?.entrant_user_id
      if (
        answer.status !== 200 ||
        read?.status !== 'claimed' ||
        typeof entrant !== 'string' ||
        entrant === ''
      ) {
        continue
      }
      // ASKED BEFORE INVITING, rather than read from a refusal: the
      // homeserver refuses to invite somebody already in the conversation
      // with the same answer as a real refusal, and a tick that invited and
      // was stopped before forgetting would otherwise try for ever.
      if (!(await isThere(letting.http, invitation.scope, entrant))) {
        await letting.http.authedRequest(
          'POST',
          `/_matrix/client/v3/rooms/${encodeURIComponent(invitation.scope)}/invite`,
          {},
          JSON.stringify({ user_id: entrant }),
        )
      }
      if (invitation.given !== null) {
        await letting.name(entrant, invitation.given)
      }
      await letting.sent.forget(invitation.invitationId)
      admitted.push(entrant)
    } catch {
      // Deliberately swallowed: the next tick asks again, and a failed ask
      // about one invitation says nothing about the next.
    }
  }
  return admitted
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
