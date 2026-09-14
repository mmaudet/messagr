import {
  claimForExistingAccount,
  claimInvitation,
  type ClaimResult,
  type ServicePoster,
} from './claimInvitation'
import type { LinkSource } from './incomingLink'
import { parseInvitationLink, type InvitationLink } from './invitationLink'
import { leaveAccount, type Closed, type Departure } from './leaveAccount'
import { hostShown, sameOrigin } from './sameOrigin'
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
  /**
   * What following a link into another server needs, or `null` when this
   * launch cannot follow one.
   *
   * # WHY A QUESTION, WHERE THERE WAS A REFUSAL
   *
   * #279 refused such a link outright, and it was right about what it
   * protected: this account's token has no business on another server. It had
   * nothing to say about the person holding the telephone. #304, from an
   * iPhone on 14 September 2026: an account left over from the bench, every
   * invitation to messagr.eu refused, a new link refused the same way, and an
   * uninstall that changed nothing because iOS keeps the keychain. No gesture
   * anywhere could leave that account.
   *
   * So the refusal became a question, and both answers keep the rule. Staying
   * sends nothing anywhere. Leaving claims the link as a device with no
   * account would, and only then forgets the old account and tells its
   * server. Nothing of the old account travels towards the link's host either
   * way.
   *
   * # WHY IT CAN BE NULL
   *
   * Decided on 14 September 2026: the account changes only at a cold launch.
   * A process that is already running holds the account's crypto machine, and
   * the next account would need a second one beside it. A link that arrives
   * while Messagr is open is therefore not asked about: the list says to close
   * Messagr completely and open the link again, and that launch asks.
   */
  readonly otherServer: OtherServer | null
}

/** What following a link into another server needs. See `EntryDeps.otherServer`. */
export interface OtherServer {
  /**
   * Put to the person: leave this device's account for the link, or stay.
   *
   * NOTHING CONTINUES UNTIL IT IS ANSWERED, and not by courtesy: this is
   * awaited inside entry, and the reinstall's re-entry and the pump that
   * publishes keys both come after entry.
   */
  readonly ask: (hosts: {
    /** The server this device's account lives on, as a person reads it. */
    readonly account: string
    /** The server the link leads to. */
    readonly link: string
  }) => Promise<'leave' | 'stay'>
  /** What leaving the old account needs, once the link has been claimed. */
  readonly departure: Departure
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
  /**
   * Used, and the conversation it opened was declined because one with that
   * person already exists.
   *
   * NOT PRODUCED HERE. Entry spends the link; whether the conversation it
   * opens is one to keep is decided a moment later, when the Matrix
   * invitation arrives and `enterInvitations.ts` looks at who it is from.
   * The kind lives in this type because a screen has one question -- what
   * became of the link I opened -- and three answers, and splitting them
   * across two vocabularies would put that question in two places.
   */
  | { readonly kind: 'already'; readonly from: string }
  /**
   * For a server other than this account's, and the person chose to keep the
   * account. Nothing was sent anywhere.
   *
   * Its own kind rather than a `refused` with a reason, because the list has
   * to say something else: not « demandez-en une nouvelle », since a new link
   * into that server would lead to the same question, but why this one was not
   * followed.
   */
  | { readonly kind: 'elsewhere' }
  /**
   * For a server other than this account's, and it arrived while Messagr was
   * already running. Nothing was asked, sent or forgotten: the account changes
   * only at a cold launch, so the list says to close Messagr completely and
   * open the link again.
   */
  | { readonly kind: 'reopen' }

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
      /**
       * The account's password, present only on the launch that claimed it.
       *
       * Passed through rather than kept here: this module decides entry, and
       * where a credential lives is `deviceSecrets.ts`'s answer. The caller
       * keeps it, because it is the one moment the service ever offers it --
       * see `recoverySecret.ts` and #190.
       */
      readonly password?: string
      /**
       * Present only when this launch left the account the device held for a
       * link into another server, after claiming that link. `closing` is what
       * became of the old account on its own server, and it settles whenever
       * that server answers -- the launch does not wait for it.
       */
      readonly left?: { readonly closing: Promise<Closed> }
    }
  | { readonly entered: false; readonly reason: string }

export async function enterWithASession(deps: EntryDeps): Promise<EntryResult> {
  const { secrets, poster, link, wait } = deps

  const held = await loadSession(secrets)
  if (held !== null) {
    const offered = await link()
    const usable = offered === null ? null : parseInvitationLink(offered)
    if (usable === null) {
      return { entered: true, session: held, claimed: false }
    }
    // THE ACCOUNT'S CREDENTIALS GO TO ITS OWN SERVER, AND TO NO OTHER.
    //
    // Spending the link for a held account authenticates the request with that
    // account's access token (`claimForExistingAccount` -> `servicePoster`),
    // and the link names the host the request is sent to. A link is written by
    // whoever issued it, so the host it names is checked against the server
    // this account actually lives on -- an invitation into a different instance
    // is one this account can have no part in, and its token has no business
    // travelling there.
    //
    // THAT USED TO END IN A REFUSAL, AND NOW IT ENDS IN A QUESTION (#304), put
    // at a cold launch only. Nothing is sent before the answer, and staying
    // sends nothing at all.
    if (!sameOrigin(usable.homeserver, held.baseUrl)) {
      return followAnotherServer(deps, held, usable)
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

  return claimWithoutAccount(deps, invitation)
}

/**
 * A link into another server, offered to a device that holds an account. #304.
 *
 * # CLAIMED FIRST
 *
 * Decided on 14 September 2026. The link is claimed the way a device with no
 * account claims one -- no bearer, since the account this device holds has no
 * business on that server -- before anything of the old account is touched. A
 * refused claim leaves the old account exactly as it was, and its server is
 * told nothing.
 *
 * # THEN, IN THIS ORDER
 *
 * 1. The old password is forgotten.
 * 2. The new account is kept: the sign-up marker, then its session. Its token
 *    is spent, so the only writes between the claim and its session are the
 *    password's erasure and the marker a first launch writes there too.
 * 3. What the old account left is forgotten, sparing the session and the
 *    marker the new account has just written, and the old server is told --
 *    the pusher, then the session -- with the credentials held in memory,
 *    without waiting. See `leaveAccount.ts`.
 * 4. The caller keeps the new password once entry answers, as on every first
 *    launch.
 *
 * # THE WINDOW A STOP LEAVES OPEN
 *
 * Between the claim and the new session, a stop loses the new account: its
 * token is spent, and the next launch finds the old account, less its
 * password. A first launch stopped there loses its account the same way.
 *
 * Between the new session and the end of step 3, a stop leaves the new account
 * beside what the old one left: its crypto store under its own device id,
 * which nothing opens again; its notebook, which the next launch opens for the
 * new account and draws from until the list is derived again; its sync
 * cursor, its backup commitment and its pushkey. Its server is never told, so
 * it keeps the pusher and may still wake this telephone. None of that is a
 * credential of the old account. Its token lived only in the session the new
 * one replaced, and its password went first -- which is why it goes first: a
 * launch that re-enters after a reinstall sends the password it holds to the
 * server of the session it holds, and with the old password gone that pair can
 * never be the old password and the new server.
 *
 * Between step 3 and the caller keeping the new password, a stop leaves the
 * new account without one, as it would leave a first launch.
 */
async function followAnotherServer(
  deps: EntryDeps,
  held: RestoreCredentials,
  link: InvitationLink,
): Promise<EntryResult> {
  const { secrets, poster, signUp, wait, otherServer } = deps

  if (otherServer === null) {
    return {
      entered: true,
      session: held,
      claimed: false,
      invitation: { kind: 'reopen' },
    }
  }

  const answer = await otherServer.ask({
    account: hostShown(held.baseUrl),
    link: hostShown(link.homeserver),
  })
  if (answer === 'stay') {
    return {
      entered: true,
      session: held,
      claimed: false,
      invitation: { kind: 'elsewhere' },
    }
  }

  const claim = await claimInvitation(poster, link, wait)
  if (!claim.claimed) {
    return {
      entered: true,
      session: held,
      claimed: false,
      invitation: { kind: 'refused', reason: claim.reason },
    }
  }

  await otherServer.departure.forgetPassword()
  const entered = await keepTheClaim(deps, claim)
  if (entered.kept === false) {
    // THE OLD ACCOUNT STAYS WHERE IT IS. The keystore refused the new session,
    // so the old one is still the session the next launch will find, and the
    // new account lives only as long as this launch. Forgetting what the old
    // account left, or ending its session, would leave that next launch
    // nothing to enter with.
    return entered
  }

  const left = await leaveAccount(otherServer.departure, held, [
    secrets,
    signUp,
  ])
  return { ...entered, left }
}

/** Spends an invitation for a device that holds no account, and keeps what it gets. */
async function claimWithoutAccount(
  deps: EntryDeps,
  invitation: InvitationLink,
): Promise<EntryResult> {
  const claim = await claimInvitation(deps.poster, invitation, deps.wait)
  if (!claim.claimed) {
    return { entered: false, reason: claim.reason }
  }
  return keepTheClaim(deps, claim)
}

/**
 * Keeps what a claim handed back: the sign-up marker, then the session.
 *
 * Its own function because two roads reach it: a device that never had an
 * account, and one that has just claimed a link into another server. The
 * second must keep its claim exactly as the first does -- the ordinary first
 * launch -- and one body is how that stays true.
 */
async function keepTheClaim(
  deps: EntryDeps,
  claim: Extract<ClaimResult, { readonly claimed: true }>,
): Promise<Extract<EntryResult, { readonly entered: true }>> {
  const { secrets, signUp } = deps

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

  // Carried out only on this launch. A restore has none to pass on, which is
  // right: the password is offered once, when the account is made.
  const password =
    claim.password === undefined ? {} : { password: claim.password }

  const kept = await saveSession(secrets, claim.session)
  if (kept) {
    return { entered: true, session: claim.session, claimed: true, ...password }
  }

  // Entered anyway. The token is spent and the account exists; refusing here
  // would throw away an invitation that has already been consumed and cannot
  // be consumed again.
  return {
    entered: true,
    session: claim.session,
    claimed: true,
    kept: false,
    ...password,
  }
}
