import {
  claimForExistingAccount,
  claimInvitation,
  type ServicePoster,
} from './claimInvitation'
import type { LinkSource } from './incomingLink'
import { parseInvitationLink } from './invitationLink'
import type { RestoreCredentials } from './sessionCredentials'
import { loadSession, saveSession, type SecretStore } from './sessionStore'
import { markSignUpStarted } from './signUpMarker'

/**
 * How this application comes to have a session at all.
 *
 * Three situations and one order between them: a session already kept, an
 * invitation to spend, or neither. The order is the decision, and it is not
 * about convenience.
 *
 * **A held session always wins over a link.** An invitation must never be
 * able to replace an account somebody already has: that would be a way of
 * taking their account from them, and no link may do that.
 *
 * **Which is not the same as throwing the link away**, and for a while this
 * module did. Somebody issued it deliberately, to reach the person holding
 * this telephone; ignoring it left the issuer watching « personne n'a encore
 * ouvert le lien » forever while the person they invited read that the
 * invitation had not been used. Both ends of the same invitation, both
 * stuck, and a conversation on the issuer's device that nobody would ever
 * join.
 *
 * So a held session spends the link the other way: `claimForExistingAccount`
 * asks the service to invite *this* account into the conversation instead of
 * drawing a new one. The account is untouched, the invitation does what it
 * was for, and there is one conversation rather than two halves of none.
 *
 * There is no third source. Nothing is baked into the build any more, which
 * is what makes this application installable by somebody who did not build
 * it.
 */
export interface EntryDeps {
  readonly secrets: SecretStore
  readonly poster: ServicePoster
  readonly link: LinkSource
  /**
   * Where the sign-up marker is written. Claiming an invitation is the moment
   * a sign-up begins, and the marker is what lets a later launch finish a
   * publication this one might not complete. See signUpMarker.ts.
   */
  readonly signUp: SecretStore
  /**
   * Awaited between claim attempts. Absent in tests, which should not sleep.
   *
   * A claim is two calls with somebody else's application in between: see
   * `claimInvitation.ts`. Passing nothing makes it try once and give up,
   * which is right for a test and wrong on a device.
   */
  readonly wait?: (ms: number) => Promise<void>
}

/**
 * What happened to an invitation offered to a device that already has an
 * account.
 *
 * `used` is the ordinary path: the service invited this account into the
 * conversation the invitation was for, and the Matrix invitation is on its
 * way. Walking through it is `enterInvitations.ts`'s job, not this one's --
 * which is why this says *invited* and never *joined*.
 */
export type InvitationOutcome =
  | { readonly kind: 'used' }
  | { readonly kind: 'refused'; readonly reason: string }

export type EntryResult =
  | {
      readonly entered: true
      readonly session: RestoreCredentials
      /** Whether this launch spent an invitation, or restored what was kept. */
      readonly claimed: boolean
      /**
       * Present, and `false`, only when a freshly claimed session could not
       * be kept. The account exists regardless — the token is spent — so this
       * is a warning about the next launch rather than about this one.
       */
      readonly kept?: boolean
      /**
       * What became of an invitation this launch was opened with, when it
       * was opened with one and already had a session.
       *
       * Absent when there was no link, or when the link was the thing that
       * created the session -- that case is `claimed`.
       *
       * SILENCE WAS THE FIRST DEFECT: the application drew its conversation
       * list exactly as if the icon had been tapped, so somebody who scanned
       * an invitation on a telephone that already had Messagr saw nothing at
       * all and could not tell whether the code had been read. Reported from
       * a Pixel on 7 September 2026, and answered with a line on the list.
       *
       * THE LINE WAS NOT ENOUGH, which is the second defect and the reason
       * this is no longer a boolean. Saying « elle n'a pas été utilisée »
       * politely is still not using it. Now the link is spent for the account
       * this device already has, and what a screen needs to know is which of
       * three things happened.
       *
       * Reported rather than acted on: what to draw is a screen's business,
       * and this module decides entry.
       */
      readonly invitation?: InvitationOutcome
    }
  | { readonly entered: false; readonly reason: string }

export async function enterWithASession(deps: EntryDeps): Promise<EntryResult> {
  const { secrets, poster, link, signUp, wait } = deps

  const held = await loadSession(secrets)
  if (held !== null) {
    const offered = await link()
    const usable = offered === null ? null : parseInvitationLink(offered)
    if (usable === null) {
      return { entered: true, session: held, claimed: false }
    }
    // SPENT FOR THE ACCOUNT THIS DEVICE ALREADY HAS, never against it. The
    // service draws nobody on this path: it invites `held.userId` into the
    // conversation and neutralises the account it had reserved. Nothing this
    // device holds is touched, which is the property the rule above exists
    // to protect.
    const invited = await claimForExistingAccount(poster, usable, held, wait)
    return {
      entered: true,
      session: held,
      claimed: false,
      invitation: invited.invited
        ? { kind: 'used' }
        : { kind: 'refused', reason: invited.reason },
    }
  }

  const raw = await link()
  if (raw === null) {
    return {
      entered: false,
      reason:
        'this device has no session and was not opened with an invitation',
    }
  }

  const invitation = parseInvitationLink(raw)
  if (invitation === null) {
    return { entered: false, reason: 'this link is not an invitation' }
  }

  const claim = await claimInvitation(poster, invitation, wait)
  if (!claim.claimed) {
    return { entered: false, reason: claim.reason }
  }

  // Before the session is kept, because this is the moment the sign-up
  // began. A marker written after a crash that happened in between would be
  // a marker for a sign-up nobody started; one written here covers the whole
  // of what follows.
  //
  // Its failure is not reported upward. An account was just created and the
  // token is spent, so refusing to enter over it would throw away an
  // invitation that cannot be spent again. What is lost is the ability of a
  // later launch to finish an interrupted publication, which is a smaller
  // loss than the account.
  await markSignUpStarted(signUp)

  const kept = await saveSession(secrets, claim.session)
  if (kept) {
    return { entered: true, session: claim.session, claimed: true }
  }

  // Entered anyway. The token is spent and the account exists; refusing here
  // would throw away an invitation that has already been consumed and cannot
  // be consumed again.
  return { entered: true, session: claim.session, claimed: true, kept: false }
}
