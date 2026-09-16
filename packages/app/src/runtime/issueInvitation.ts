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
 * The level required to redact somebody else's event, set above every level
 * anybody in a conversation of this product ever holds.
 *
 * # WHY THERE IS A NUMBER HERE AT ALL
 *
 * #196: nobody decided that the inviter could delete the other person's
 * words, and in a conversation between two people that is what was true.
 * `createRoom` writes no `redact` key and the specification's default is 50,
 * so the creator (100) cleared it and the other person (0, or 50 once
 * vouched for) did not. An asymmetry of moderation at the centre of a
 * relationship the product presents as symmetric, and the glossary knows
 * neither a privileged inviter nor a moderator in a tête-à-tête.
 *
 * Above 100, which is what `createRoom` gives the creator, so **nobody**
 * reaches it. What survives is the rule Matrix always applies: a person may
 * redact their own events whatever the level says. Two people, each able to
 * withdraw their own words and neither able to touch the other's.
 *
 * # WHY 101 AND NOT SOMETHING DERIVED
 *
 * The levels this product hands out are known and few -- 100 to the creator,
 * 50 to somebody vouched for, 0 to an entrant -- so one above the top is a
 * fact rather than a guess. A value computed from whatever the homeserver
 * happened to write would be a number that changes meaning when the server
 * does, which is the opposite of what this is for.
 */
const NOBODY_ELSE_REDACTS = 101

/**
 * The room version a conversation is created in, and it is pinned on purpose.
 *
 * MEASURED, NOT REASONED. The homeserver makes version 12 rooms by default,
 * and in version 12 the creator's power is **implicit and infinite**: `users`
 * comes back empty and no finite `redact` can be put above them. Tried on
 * 10 September 2026 against a real conversation -- `redact` set to 101,
 * accepted, and the creator still redacted the other person's message with a
 * `200`.
 *
 * The same experiment in version 11, where the creator is an ordinary member
 * at 100:
 *
 * | | their own words | the other's |
 * |---|---|---|
 * | the inviter (creator) | 200 | **403** |
 * | the other person | 200 | **403** |
 *
 * So the symmetry this product claims is only reachable below version 12.
 * What version 12 adds is a creator nobody can strip of power, which exists
 * to stop a room being taken over -- worth having where there is a hierarchy
 * to protect, and worth nothing between two people who are supposed to be
 * equals. Given the choice between the two, this product wants the equality.
 *
 * CONVERSATIONS MADE BEFORE THIS ARE VERSION 12 AND STAY THAT WAY. Nothing
 * short of upgrading a room changes its version, and an upgrade is a visible,
 * disruptive act -- a new room, a tombstone in the old one. The asymmetry
 * remains in conversations already started, which is worth knowing rather
 * than quietly assuming otherwise.
 */
const ROOM_VERSION = '11'

/**
 * Creates the conversation, sets the rules it must carry, and mints one
 * single-use invitation for it.
 *
 * # The rules are not decoration
 *
 * `createRoom` leaves no `redact` key either, and there the default is 50 --
 * which the creator clears and nobody else does. #196: that made the inviter
 * able to delete the other person's words in a conversation of two, which
 * nobody decided and which the glossary has no word for. See
 * `NOBODY_ELSE_REDACTS`, and `ROOM_VERSION` for why the room version is
 * pinned rather than left to the homeserver.
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
      JSON.stringify({ preset: 'private_chat', room_version: ROOM_VERSION }),
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
      // HTTPS, NOT THE APPLICATION'S OWN SCHEME, AND A CAMERA IS WHY.
      //
      // `invitationLink.ts` accepts both and has always said which is which:
      // "`https` is what travels through a message or a QR code; the
      // application's own scheme is what the operating system hands over."
      // This minted the second one, so the QR code on the invitation screen
      // encoded `messagr://` -- a scheme iOS's camera and most Android
      // scanners ignore. Nothing could read it: not a camera, and not
      // Messagr, which has no scanner. Reported from a Pixel Fold on
      // 7 September 2026, and the screen had been offering that picture
      // since it was built.
      //
      // The host is untouched: it is the account's own homeserver, so a link
      // still names its instance and nobody is asked which server they are
      // joining. On messagr.eu that yields `https://messagr.eu/i/<token>`,
      // which every camera opens, which Android App Links route into the
      // application -- the Play fingerprints served since this morning are
      // what makes that verification pass -- and which iOS routes through
      // the AASA's `/i*`. Somebody without the application lands on the
      // invitation page instead, which exists for exactly that.
      //
      // No scanner is needed, and that is the point: the camera everybody
      // already has is the scanner.
      link: `https://${linkHost}/i/${minted.token}`,
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
 * Reads the power levels, raises the cost of inviting, puts redaction of
 * somebody else's words out of everybody's reach, and turns encryption on.
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
    JSON.stringify({
      ...held,
      invite: INVITE_COST,
      users_default: 0,
      redact: NOBODY_ELSE_REDACTS,
    }),
  )

  await http.authedRequest(
    'PUT',
    `${path}/m.room.encryption`,
    {},
    JSON.stringify({ algorithm: 'm.megolm.v1.aes-sha2' }),
  )
}

export type Admission =
  | {
      readonly admitted: true
      /**
       * Everybody let in for this invitation, in the order they were named.
       *
       * A LIST BECAUSE THERE CAN BE TWO, and the second is the one that
       * matters. A newcomer's link needs exactly one invite: the account the
       * service drew. A link opened by somebody who already has an account
       * needs two -- the drawn account first, so it can join and try to hand
       * its place over, and then the real person, because the drawn account
       * is refused when it tries.
       *
       * That refusal is the design rather than a fault, and the service says
       * so in the log line it writes: « the reserved account may not invite
       * into this room, which is the designed state; the target is now named
       * to the inviter's client, which holds the right and invites on its
       * next poll ». The conversation costs 50 to invite into and the drawn
       * account holds 0. Only the issuer can let the second one in.
       */
      readonly entrants: readonly string[]
    }
  | { readonly admitted: false; readonly reason: string }

/**
 * How many times to ask the service who it drew, and how long to wait
 * between. Thirty times two seconds: a minute, which is the bench's own
 * figure and long enough for somebody to open a link they were just handed.
 */
const ATTEMPTS = 30
const BETWEEN_MS = 2000

/**
 * Admissions in flight, by invitation. #277.
 *
 * # THE LOOP THAT FED ITSELF
 *
 * The sync loop starts an admission on every tick and deliberately does not
 * wait for it -- « the loop's tick must not wait on a poll of the invitation
 * service », App.tsx -- while one admission lasts a minute. That alone piles
 * ticks up; what made it a burst is that each invite is itself a membership
 * event, so it ends the long poll, which makes the next tick, which starts
 * another admission, which invites again. The artefacts of run
 * 34738990621 counted fifteen `POST .../invite` for one entrant in under four
 * seconds.
 *
 * Harmless to the homeserver, which answers 403 to the ones after the first.
 * Not harmless to the telephone: fifteen round trips of radio, and fifteen
 * more sync responses to decrypt, for a person who was already invited.
 *
 * # WHY THE REPETITION STAYS
 *
 * Asking thirty times over a minute is not the defect. A link is opened when
 * whoever holds it opens it, and the interoperability client claims in a loop
 * inside that same minute (`scripts/interop/nio_counterparty.py`, 45 seconds
 * of `409 MESSAGR_NOT_YET_INVITED`). What was wrong is that the repetition
 * was multiplied by the ticks instead of belonging to one run.
 *
 * So: an invitation already being admitted is not admitted again, and a claim
 * that has not arrived yet is still served -- by the run in flight, which is
 * still polling, and by the next one, which the tick after it ends starts.
 *
 * # WHY THE CALLER IS HANDED THE RUN RATHER THAN TURNED AWAY
 *
 * There are two callers, and one of them cannot be skipped: the gesture that
 * issued the invitation awaits this to put the given name on whoever came in
 * and to tell the screen they are in. It writes the invitation down before it
 * calls (#118), so a tick can reach this first, and being told "somebody else
 * is doing it" would cost that name with nobody able to say why. Every caller
 * gets the same answer; only one of them makes the requests.
 *
 * # MODULE STATE, FOR THE LIFE OF THE PROCESS
 *
 * Like `awaitedInvitations.ts` and `accountInQuestion.ts`. A launch, a wake
 * and the pump's ticks share one JavaScript context, and that is exactly the
 * set of callers that can collide; nothing here needs to outlive the process,
 * because a run that the process ended does not go on inviting.
 */
const running = new Map<string, Promise<Admission>>()

/**
 * Whether an admission is already going for `invitationId`.
 *
 * Asked for one thing: a caller that is about to join one can say so in its
 * log line. The whole of #277 was counted in artefacts rather than seen on a
 * screen, and after this a run and the ticks that shared it are the same
 * `MESSAGR_ADMIT` line repeated -- which is how the count that mattered was
 * read wrong in the first place. Read in the same turn as the call it
 * describes, and true of that turn only.
 */
export function anAdmissionIsRunning(invitationId: string): boolean {
  return running.has(invitationId)
}

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
 *
 * ONE RUN AT A TIME PER INVITATION, which is the whole of #277 and is done
 * here rather than by whoever calls: see `running` above.
 */
export function admitDrawnEntrant(
  deps: IssuingDeps,
  invitationId: string,
  scope: string,
): Promise<Admission> {
  // The run already going is this call's answer too. Read and written in one
  // turn, with nothing awaited between: a check in one turn and a record in
  // the next is how #304 let two crypto machines be created, and the same
  // hole here would let two ticks each start a minute of inviting.
  const going = running.get(invitationId)
  if (going !== undefined) return going

  const run = admitWhoeverWasDrawn(deps, invitationId, scope)
  running.set(invitationId, run)
  const forget = () => {
    // Only its own record: a run that has already been forgotten was
    // replaced by the next tick's, and dropping that one would open the
    // door this closes.
    if (running.get(invitationId) === run) running.delete(invitationId)
  }
  // Both ways, and on a branch nobody returns: `admitWhoeverWasDrawn` catches
  // its own polls and its own invites, so only an injected `wait` can reject
  // here -- and a rejection with no handler is what Hermes turns into a
  // warning nobody reads.
  run.then(forget, forget)
  return run
}

/**
 * The minute of asking itself, which only `admitDrawnEntrant` starts.
 *
 * Not exported, and that is the point: one caller means the register above
 * cannot be gone round. A guard that lived in the wiring instead would be
 * the behaviour of no unit, and no unit test would have it.
 */
async function admitWhoeverWasDrawn(
  deps: IssuingDeps,
  invitationId: string,
  scope: string,
): Promise<Admission> {
  // Everybody this loop has tried, whether the invite held or not: a second
  // attempt at the same person is a round trip that would fail the same way.
  const admitted: string[] = []
  const held: string[] = []
  let failure: string | null = null

  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    let entrant: string | null = null
    let settled = false
    try {
      const answer = await deps.service.status(invitationId)
      if (answer.status >= 200 && answer.status < 300) {
        const read = JSON.parse(answer.body) as {
          entrant_user_id?: unknown
          status?: unknown
        }
        // CLAIMED, REVOKED OR EXPIRED MEANS THERE IS NOBODY LEFT TO LET IN,
        // and going on asking would be asking a question already answered.
        //
        // Said this way round on purpose: a body with no `status` at all is
        // not a settled invitation, it is a shape this code did not expect,
        // and stopping the wait on it would strand whoever is on the other
        // side of the link. Only an explicit answer other than `pending`
        // ends the wait.
        settled = typeof read.status === 'string' && read.status !== 'pending'
        const named = read.entrant_user_id
        if (typeof named === 'string' && named !== '') entrant = named
      }
    } catch {
      // A failed poll is not a failed invitation: the next attempt asks
      // again, and the link is unaffected by this application's connectivity.
    }

    if (settled) break

    // ALREADY LET IN IS NOT SOMEBODY TO LET IN AGAIN. The service goes on
    // naming whoever is still waiting, and re-inviting a person who is
    // already invited is a round trip that changes nothing.
    if (entrant !== null && !admitted.includes(entrant)) {
      try {
        await deps.http.authedRequest(
          'POST',
          `/_matrix/client/v3/rooms/${encodeURIComponent(scope)}/invite`,
          {},
          JSON.stringify({ user_id: entrant }),
        )
        admitted.push(entrant)
        held.push(entrant)
      } catch (cause: unknown) {
        // KEPT, AND THE LOOP GOES ON. It used to return here, and on the
        // path with two invites that turned a harmless refusal into a
        // reported failure: the homeserver answers `403 Event is not
        // authorized` for inviting somebody who is already in the room, and
        // by the time the second poll names the real person they sometimes
        // are -- the claim completed and their device walked through the
        // door on its own sync tick. Measured on the bench: the person was
        // in the conversation and the issuer's log said they could not be
        // invited.
        //
        // Nobody in at the end is still a failure, and the reason below is
        // the last one there was.
        failure = `${entrant} was named and could not be invited: ${getErrorMessage(cause)}`
        // Not retried on the next turn either: the same call would fail the
        // same way, and the service goes on naming them until it settles.
        admitted.push(entrant)
      }
    }

    await deps.wait?.(BETWEEN_MS)
  }

  // IT USED TO RETURN AT THE FIRST INVITE, and that is the whole of the
  // defect this loop now answers. One invite is the newcomer's whole path,
  // so nothing was ever wrong for a newcomer; a link opened by somebody who
  // already has an account needs a second, and the polling had stopped by
  // then. Measured from both ends on the bench: the issuer's screen said
  // « c'est fait : cette personne peut entrer » while the service answered
  // the other telephone `403 Forbidden` every two seconds until it gave up.
  if (held.length > 0) return { admitted: true, entrants: held }
  return {
    admitted: false,
    reason: failure ?? 'nobody has opened the link yet',
  }
}
