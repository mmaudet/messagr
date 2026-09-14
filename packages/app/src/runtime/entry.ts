import type { InQuestion } from './accountInQuestion'
import { afterReinstall } from './afterReinstall'
import {
  claimForExistingAccount,
  claimInvitation,
  REFUSED,
  type ClaimResult,
  type ServicePoster,
} from './claimInvitation'
import type { DeviceIdentity } from './deviceIdentity'
import type { LinkSource } from './incomingLink'
import { parseInvitationLink, type InvitationLink } from './invitationLink'
import { leaveAccount, type Closed, type Departure } from './leaveAccount'
import { keepRecoverySecret, readRecoverySecret } from './recoverySecret'
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
   * Where the account's password is kept: by this module, right after the
   * session it belongs to, and by nobody after that. See `keepTheClaim`, and
   * `leaveForTheLink` for the one time an old password is written back.
   *
   * Read too, with `storeExists`, to tell whether this device can still use
   * the account it holds.
   */
  readonly recovery: SecretStore
  /**
   * Awaited between claim attempts. Absent in tests, which should not sleep.
   *
   * A claim is two calls with somebody else's application in between: see
   * `claimInvitation.ts`. Passing nothing makes it try once and give up,
   * which is right for a test and wrong on a device.
   */
  readonly wait?: (ms: number) => Promise<void>
  /**
   * Whether the crypto store of `account`'s device is on this device. #307.
   *
   * A session whose store is gone and which kept no password is one this
   * device can no longer use: `afterReinstall.ts` calls that `stranded`, and
   * this module asks it the same two facts. Found on an iPhone on 14 September
   * 2026, after an uninstall that kept the keychain and took the store: a new
   * invitation was spent for that session, and the device could not get in.
   */
  readonly storeExists: (account: DeviceIdentity) => Promise<boolean>
  /** What leaving the account this device holds for a link needs. See `Leaving`. */
  readonly leaving: Leaving
}

/**
 * What leaving the account this device holds for a link needs: after a
 * question when the link leads to another server (#304), and without one when
 * this device can no longer use that account (#307).
 */
export interface Leaving {
  /**
   * Put to the person: leave this device's account for the link, or stay. Or
   * `null` when this entry cannot put it.
   *
   * NOTHING CONTINUES UNTIL IT IS ANSWERED, and not by courtesy: this is
   * awaited inside entry, and the reinstall's re-entry and the pump that
   * publishes keys both come after entry. Every way the question can leave
   * the screen answers it: see `questionOnScreen.ts`.
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
   * Decided on 14 September 2026: an account somebody can still use changes
   * only at a cold launch. An entry that is not part of the launch reads a
   * link handed to an application that was already running --
   * `launchEntries.ts` says what that means, which is not the order the link's
   * events arrived in -- and the list says to close Messagr completely and
   * open the link again. A session this device can no longer use is left
   * without a question, and so without this (#307).
   */
  readonly ask:
    | ((hosts: {
        /** The server this device's account lives on, as a person reads it. */
        readonly account: string
        /** The server the link leads to. */
        readonly link: string
      }) => Promise<'leave' | 'stay'>)
    | null
  /**
   * Whether this context holds a crypto machine, or is creating one.
   *
   * Read before anything is begun: a process a wake started holds the old
   * account's machine before any screen opens, and the next account would
   * need a second machine beside it, which this application never makes. Read
   * again once a question has been answered.
   */
  readonly aMachineIsRunning: () => boolean
  /**
   * Puts an account's device in question until what this answers is lifted:
   * no crypto machine is made for that device meanwhile, and none for the rest
   * of the process once its account has departed. See `accountInQuestion.ts`.
   */
  readonly holdInQuestion: (account: DeviceIdentity) => InQuestion
  /**
   * Resolves after `ms`. What bounds each claim request: see
   * `REQUEST_DEADLINE_MS`.
   */
  readonly after: (ms: number) => Promise<void>
  /** What leaving the old account needs, once the new one is kept. */
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
   * For a link read by an entry that could not change accounts: a link into
   * another server handed to an application already running, or a context
   * that already holds a crypto machine. Nothing was claimed or forgotten, and
   * the list says to close Messagr completely and open the link again.
   */
  | { readonly kind: 'reopen' }
  /**
   * For a link that was to replace the account this device holds -- after a
   * yes (#304), or for a session this device can no longer use (#307) -- and
   * that the service refused: unknown, spent, revoked or expired, which it
   * does not tell apart. The old account stays, and since opening the link
   * again would be refused again, the list says to ask for a new one.
   *
   * Its own kind rather than `refused`, because `refused` is said after the
   * pump, and the pump talks to the old account's server: when that server
   * did not answer, nothing was said at all.
   */
  | { readonly kind: 'unusable'; readonly reason: string }
  /**
   * For a link that was to replace the account this device holds, whose claim
   * did not go through for a reason that may not hold next time -- a service
   * out of reach, one that did not answer in time, or an issuer whose
   * application has not let the account in yet. The old account stays, and
   * opening the link again tries again.
   *
   * Not `unusable`: « demandez-en une nouvelle » is wrong for a link that may
   * be perfectly good. Said on entry, for the same reason.
   */
  | { readonly kind: 'retry'; readonly reason: string }
  /**
   * For a link that was to replace the account this device holds: the claim
   * went through, and this device could not keep the new account. The token is
   * spent, so opening the link again would be refused. The old account stays,
   * its password written back if it had one, and the list says to ask for a
   * new invitation. Said on entry too.
   */
  | { readonly kind: 'spent'; readonly reason: string }

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
       * Whether the account's password was kept, present only when the claim
       * handed one back and its session was kept.
       *
       * KEPT HERE, AND IT USED TO BE PASSED THROUGH. The caller wrote it once
       * entry had answered, which was harmless while nothing came between the
       * two. #304 put the whole of leaving the old account there: a stop in the
       * middle of it found the new account with a session, no crypto store and
       * no password, and the next launch had nothing to come back with. So the
       * password is kept right after its session and nowhere else -- a second
       * writer would be a second moment it could land beside the wrong session.
       * `recoverySecret.ts` and #190 say why it is kept at all.
       */
      readonly passwordKept?: boolean
      /**
       * Present only when this launch left the account the device held for a
       * link, after keeping the account that link made: after a yes (#304), or
       * for a session this device could no longer use (#307). `closing` is
       * what became of the old account on its own server, and it settles
       * whenever that server answers -- the launch does not wait.
       */
      readonly left?: { readonly closing: Promise<Closed> }
    }
  | { readonly entered: false; readonly reason: string }

export async function enterWithASession(deps: EntryDeps): Promise<EntryResult> {
  const { secrets, poster, link, wait } = deps

  const held = await loadSession(secrets)
  if (held !== null) {
    // WHETHER THIS DEVICE CAN STILL USE THE ACCOUNT IT HOLDS, read before the
    // link is taken (#307). Read after it, these reads would come between
    // taking the link and putting the account in question, and a run of the
    // same launch that was handed no link could find the account not yet
    // held. A launch reads both anyway, right after entry (`App.tsx`).
    const stranded = await strandedHere(deps, held)
    const offered = await link()
    const usable = offered === null ? null : parseInvitationLink(offered)
    if (usable === null) {
      return { entered: true, session: held, claimed: false }
    }
    // A SESSION THIS DEVICE CAN NO LONGER USE, AND A LINK TO ENTER WITH (#307).
    // Spent for that session, as below, the link invited an account whose
    // keys are gone and drew nothing, and the device could not get in.
    // Whichever server the link leads to, it enters with a new account.
    if (stranded) {
      return leaveADeadSession(deps, held, usable)
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
 * Whether `held` is a session this device can no longer use: its store gone,
 * and no password kept -- `afterReinstall.ts`'s `stranded`, asked of the same
 * two facts. #307.
 */
async function strandedHere(
  deps: EntryDeps,
  held: RestoreCredentials,
): Promise<boolean> {
  const what = afterReinstall({
    claimed: false,
    storeExists: await deps.storeExists(held),
    password: await readRecoverySecret(deps.recovery),
  })
  return what.kind === 'stranded'
}

/**
 * How long one claim request may go unanswered when a device leaves the
 * account it holds for a link. #304, #307.
 *
 * Entry waits on the claim with the old account in question, and the launch
 * waits on entry, while the poster has no limit of its own: a request the
 * network held open would hold both for as long as it did. So a request is
 * given up after this, and the claim ends with it -- no request goes out after
 * one that was given up.
 *
 * ON EACH REQUEST, NOT ON THE CLAIM. Found in review on 14 September 2026: a
 * minute over the whole claim fell in the middle of the handshake, whose
 * pauses alone make twenty-eight seconds, and left its loop running, so a 200
 * that came later spent the token while the list said to try again. The
 * handshake now runs to its own end (`claimInvitation.ts`).
 *
 * This path only: a device with no account claims as it always has. A request
 * given up is no longer awaited, not cancelled, and one the service grants all
 * the same spends the token for an account this device never keeps.
 */
const REQUEST_DEADLINE_MS = 30_000

/** `poster`, giving up each request left unanswered for `REQUEST_DEADLINE_MS`. */
function givingUpTheUnanswered(
  poster: ServicePoster,
  after: (ms: number) => Promise<void>,
): ServicePoster {
  return {
    post: (url, body, bearer) =>
      new Promise((resolve, reject) => {
        after(REQUEST_DEADLINE_MS).then(() =>
          reject(new Error('the invitation service did not answer in time')),
        )
        poster.post(url, body, bearer).then(resolve, reject)
      }),
  }
}

/**
 * A link into another server, offered to a device that holds an account it
 * can still use. #304.
 *
 * The person is asked, from a cold launch only, and the account is left only
 * on a yes, the way `leaveForTheLink` leaves it.
 */
async function followAnotherServer(
  deps: EntryDeps,
  held: RestoreCredentials,
  link: InvitationLink,
): Promise<EntryResult> {
  const { ask, aMachineIsRunning, holdInQuestion } = deps.leaving
  if (ask === null || aMachineIsRunning()) {
    return onTheHeldAccount(held, { kind: 'reopen' })
  }

  // IN QUESTION BEFORE ANYTHING IS AWAITED, so in the same step as the link
  // this entry was handed (`spentLinks.ts` hands it over in one step too). A
  // run of the same launch that was handed no link restored this account, and
  // it finds the account held and waits for the answer.
  const question = holdInQuestion(held)
  try {
    const answer = await ask({
      account: hostShown(held.baseUrl),
      link: hostShown(link.homeserver),
    })
    if (answer === 'stay') {
      return onTheHeldAccount(held, { kind: 'elsewhere' })
    }
    // READ AGAIN, NOW THAT IT IS ANSWERED. The question kept this account's
    // machine from being made while it waited, so none should be running; a
    // yes that found one could not be carried out in this process, and nothing
    // of it is begun.
    if (aMachineIsRunning()) {
      return onTheHeldAccount(held, { kind: 'reopen' })
    }
    return await leaveForTheLink(deps, held, link, question)
  } finally {
    question.lift()
  }
}

/**
 * A link offered to a device that holds a session it can no longer use. #307.
 *
 * # NO QUESTION
 *
 * Nothing is left on this device to lose: what came before is unreadable, and
 * the account can send nothing from here. So the link is followed whichever
 * server it leads to, its own included, and the dead session is left exactly
 * as #304 leaves an account after a yes (`leaveForTheLink`). The list had
 * already said that a new invitation was needed.
 *
 * # APPLICATION OPEN OR NOT
 *
 * A stranded launch starts no crypto machine, so a link handed to Messagr
 * while it is open is followed too, and not only at a cold launch: that is
 * where somebody who has just read that a new invitation is needed opens one.
 * If this context holds a machine all the same, nothing is begun, and the
 * list says to reopen Messagr, as for #304.
 */
async function leaveADeadSession(
  deps: EntryDeps,
  held: RestoreCredentials,
  link: InvitationLink,
): Promise<EntryResult> {
  const { aMachineIsRunning, holdInQuestion } = deps.leaving
  if (aMachineIsRunning()) {
    return onTheHeldAccount(held, { kind: 'reopen' })
  }
  // IN QUESTION BEFORE ANYTHING IS AWAITED, as in `followAnotherServer`: a run
  // of the same launch that restored the dead session waits for this one.
  const dead = holdInQuestion(held)
  try {
    return await leaveForTheLink(deps, held, link, dead)
  } finally {
    dead.lift()
  }
}

/**
 * Claims `link` as a device with no account would, keeps the account the claim
 * makes, and only then leaves the account this device held. #304, #307.
 *
 * Its caller has put the held account in question, and lifts it. What is
 * claimed, kept, forgotten and closed is the same whether the account is left
 * after a yes or because this device can no longer use it.
 *
 * # CLAIMED FIRST
 *
 * Decided on 14 September 2026. The link is claimed the way a device with no
 * account claims one -- no bearer, since the account this device holds has no
 * business on another server and no use left on this device -- before
 * anything of the old account is touched. A refused claim, a service that
 * cannot be reached, or one that does not answer in time leaves the old
 * account exactly as it was, and its server is told nothing.
 *
 * # IN THIS ORDER
 *
 * 1. The link is claimed, each request given up after `REQUEST_DEADLINE_MS`.
 * 2. The new account is put in question too, and the old password, if there
 *    is one, is forgotten -- held in memory, for step 3.
 * 3. The new account is kept: the sign-up marker, its session, then its
 *    password. A keystore that refuses the session keeps the old one, and the
 *    old password is written back beside it.
 * 4. The old account departs. What it left is forgotten, sparing the three
 *    entries of step 3, and its server is told -- the pusher, then the
 *    session -- with the credentials held in memory, without waiting. See
 *    `leaveAccount.ts`.
 * 5. The new account's question is lifted, however this ends.
 *
 * # THE WINDOW A STOP LEAVES OPEN
 *
 * Between the claim and step 2, a stop loses the new account -- its token is
 * spent -- and leaves the old one whole. Between step 2 and the new session,
 * it also leaves the old account without its password, and a reinstall then
 * finds it stranded rather than coming back. The sign-up marker, if it was
 * written by then, lies beside the old session, and that is harmless: it only
 * lets a launch finish publishing an identity this device created and no
 * homeserver acknowledged (`crossSigningIdentity.ts`, its `finishing-sign-up`
 * branch), and the old account's identity was acknowledged long ago.
 *
 * Between the new session and its password -- one keystore write -- a stop
 * leaves the new account with neither a password nor a crypto store, and the
 * next launch finds it stranded. That write is as close to the session as it
 * can be put, and nothing else comes between them.
 *
 * Between the new password and the end of step 4, a stop leaves the new
 * account whole, beside what the old one left: its crypto store under its own
 * device id, which nothing opens again; its notebook, which the next launch
 * opens for the new account and draws from until the list is derived again;
 * its sync cursor, its backup commitment and its pushkey. The old server is
 * never told, so it keeps the pusher and may still wake this telephone. None
 * of that is a credential of the old account. Its token lived only in the
 * session the new one replaced, and its password went at step 2 -- before the
 * new session, because a launch that re-enters after a reinstall sends the
 * password it holds to the server of the session it holds, and the old
 * password must never lie beside the new session.
 */
async function leaveForTheLink(
  deps: EntryDeps,
  held: RestoreCredentials,
  link: InvitationLink,
  question: InQuestion,
): Promise<EntryResult> {
  const { secrets, poster, signUp, recovery, wait } = deps
  const { after, holdInQuestion, departure } = deps.leaving

  const claim = await claimInvitation(
    givingUpTheUnanswered(poster, after),
    link,
    wait,
  )
  if (!claim.claimed) {
    // Two sentences, because a person acts on the difference: a refusal is
    // final and the link will be refused again, and anything else may go
    // through next time.
    return onTheHeldAccount(
      held,
      claim.reason === REFUSED
        ? { kind: 'unusable', reason: claim.reason }
        : { kind: 'retry', reason: claim.reason },
    )
  }

  // THE NEW ACCOUNT IN QUESTION TOO, until the old one is forgotten. Its
  // session is kept first, and a push the old server sends meanwhile wakes
  // this context: that wake would find the new session and make its machine
  // with the store passphrase the old account left, which forgetting then
  // erases -- and the next launch could not open that store.
  const arriving = holdInQuestion(claim.session)
  try {
    const oldPassword = await readRecoverySecret(recovery)
    await departure.forgetPassword()
    const entered = await keepTheClaim(deps, claim)
    if (entered.kept === false) {
      // THE OLD ACCOUNT STAYS THE ONE THIS DEVICE HOLDS. The keystore refused
      // the new session, so the old one is what the next launch will find,
      // and this launch stays on it too: running the new account from memory
      // would write its sync cursor and its notebook into what the old account
      // left. `keepTheClaim` kept no password for the new account -- beside
      // the old session, a re-entry would send it to the old server.
      //
      // THE OLD PASSWORD GOES BACK BESIDE THE OLD SESSION. Found in review on
      // 14 September 2026: without it, a reinstalled iPhone found that session
      // with no password and was stranded, where it would have come back. A
      // keystore that refuses this write too leaves exactly that, and nothing
      // more can be done about it here.
      if (oldPassword !== null) await keepRecoverySecret(recovery, oldPassword)
      return onTheHeldAccount(held, {
        kind: 'spent',
        reason: 'this device could not keep the new account',
      })
    }

    question.departed()
    const left = await leaveAccount(departure, held, [
      secrets,
      signUp,
      recovery,
    ])
    return { ...entered, left }
  } finally {
    arriving.lift()
  }
}

/** The account this device holds, still the one it enters with, and what became of the link. */
function onTheHeldAccount(
  held: RestoreCredentials,
  invitation: InvitationOutcome,
): EntryResult {
  return { entered: true, session: held, claimed: false, invitation }
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
 * Keeps what a claim handed back: the sign-up marker, the session, then the
 * password.
 *
 * Its own function because two roads reach it: a device that never had an
 * account, and one leaving the account it held for a link (#304, #307). The
 * second must keep its claim exactly as the first does -- the ordinary first
 * launch -- and one body is how that stays true.
 */
async function keepTheClaim(
  deps: EntryDeps,
  claim: Extract<ClaimResult, { readonly claimed: true }>,
): Promise<Extract<EntryResult, { readonly entered: true }>> {
  const { secrets, signUp, recovery } = deps

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
  if (!kept) {
    // Entered anyway. The token is spent and the account exists; refusing
    // here would throw away an invitation that has already been consumed and
    // cannot be consumed again. Its password is not kept: there is no session
    // for it to go with, and beside whatever session this device still holds
    // it would be the wrong password.
    return {
      entered: true,
      session: claim.session,
      claimed: true,
      kept: false,
    }
  }

  // THE PASSWORD, RIGHT AFTER ITS SESSION, and offered once: the service hands
  // it back with the claim and nowhere else. See `EntryResult.passwordKept`.
  const password =
    claim.password === undefined
      ? {}
      : { passwordKept: await keepRecoverySecret(recovery, claim.password) }
  return { entered: true, session: claim.session, claimed: true, ...password }
}
