import type { Invitation } from './encryptedSend'
import { displayNameFor, isNamed } from './givenName'
import type { Described } from './linkOnScreen'

/**
 * What this device can truthfully state about an invitation it is being
 * asked to decide. #329, §13.3's first screen.
 *
 * # ONE INVITATION IS MET IN TWO PLACES, AND THEY KNOW OPPOSITE THINGS
 *
 * A LINK, before anything is spent: it names the instance it leads to and
 * carries whatever name the inviter gave themselves, and it knows no Matrix
 * identifier at all -- the account on the far side is drawn at the moment
 * the token is spent, and nothing has been spent.
 *
 * AN INVITATION STANDING ON THE THRESHOLD, which no link was spent for on
 * this telephone: it names the account that created the conversation, and
 * carries no declared name whatsoever -- nothing travels with a Matrix
 * invitation to say what its sender calls themselves, and the link that
 * would have said so was never held here.
 *
 * Neither is a degraded version of the other, so `source` says which one is
 * being drawn and the screen says different true things about each. The
 * alternative -- inferring it from which fields happen to be empty -- would
 * make « the link declares nobody » and « the conversation does not say who
 * created it » the same sentence, and they are two different facts about two
 * different things.
 *
 * # THE SCREEN ASKS FOR SIX FACTS AND THIS DEVICE HOLDS THREE
 *
 * §13.3: *« sender, scope (room or 1:1), validity, remaining uses, origin
 * instance »*, plus any agent in the room. An invitation that reaches this
 * screen is one no link was spent for on this telephone -- that is the
 * definition of standing on the threshold -- so three of those facts are not
 * this device's to read, and the difference is structural rather than
 * unfinished work.
 *
 * **Sender, yes.** `m.room.create`'s sender made the conversation, and on
 * this product that is the person who issued the link rather than the
 * throwaway account that delivered the Matrix invitation; `encryptedSend.ts`
 * argues which of the two to read. `null` when the homeserver left the
 * creation event out of the stripped state, which it is allowed to do.
 *
 * **Origin instance, yes**, off the identifier: everything after the first
 * colon is the server that account lives on. Worth stating on its own and
 * worth marking when it is not this account's server, since a conversation
 * across two instances is a different thing to walk into.
 *
 * **Validity and remaining uses, no, and no future version of this module
 * changes that.** Both belong to the invitation link, which this device
 * never held. `services/invitations/src/handlers/status.rs` answers only the
 * account that issued the invitation, and a Matrix invitation carries no
 * trace of the link that led to it. The screen says so rather than leaving
 * the reader to assume there are no limits.
 *
 * **Scope, as the conversation rather than as a kind.** Every conversation
 * this product makes is `preset: 'private_chat'` with one invitee
 * (`issueInvitation.ts`), unnamed, with no `is_direct` flag -- so there is
 * nothing in a stripped state that distinguishes a room from a 1:1, and
 * printing either word would be a guess in the one place somebody is
 * deciding.
 *
 * **Agents, none.** Nothing in this application creates, inserts or reads
 * one yet, so there is no member of that kind to announce.
 *
 * # THE NAME, AND WHOSE IT IS
 *
 * A given name is what THIS device calls somebody, held here and nowhere
 * else (`givenName.ts`). It is the readable thing available, and it is shown
 * -- but `named` is reported beside it so a screen never presents one as a
 * name its bearer declared. §13.26's *« Se présente comme »* is for a
 * declared name, and an invitation standing on the threshold carries none:
 * nothing travels with a Matrix invitation to say what its sender calls
 * themselves.
 */
export interface WhatIsKnown {
  /** Which of the two places this invitation is being met in. */
  readonly source: 'link' | 'threshold'
  /**
   * The conversation, which is what joining and refusing act on. Empty on
   * the link path: there is no conversation to act on yet, and the two
   * actions there are answered by entry rather than by the homeserver.
   */
  readonly scope: string
  /**
   * The name the inviter gave themselves, drawn as « Se présente comme %@ ».
   * Empty when there is none.
   *
   * ONLY EVER FROM A LINK (`declaredName.ts`), and never the name this
   * device gave somebody: §13.26's formula reports what its bearer claimed,
   * and a given name was claimed by nobody. Putting one under that sentence
   * would be this screen attributing to the inviter a word the person
   * holding the telephone wrote themselves.
   */
  readonly declared: string
  /**
   * What to call whoever made the conversation: the name this device gave
   * them, or their localpart. Empty when nobody can be named.
   */
  readonly who: string
  /** Whether `who` is a name this device gave rather than an identifier. */
  readonly named: boolean
  /** The identifier itself, drawn under the name. Empty when unknown. */
  readonly identifier: string
  /** The server that account lives on, or `null` when it cannot be read. */
  readonly instance: string | null
  /** Whether that server is not the one this account lives on. */
  readonly elsewhere: boolean
}

export function whatIsKnown(
  invitation: Invitation,
  self: string,
  names: ReadonlyMap<string, string>,
): WhatIsKnown {
  const { scope, from } = invitation
  if (from === null) {
    return {
      source: 'threshold',
      scope,
      declared: '',
      who: '',
      named: false,
      identifier: '',
      instance: null,
      elsewhere: false,
    }
  }
  const given = names.get(from)
  const instance = serverOf(from)
  return {
    source: 'threshold',
    scope,
    // NOTHING TRAVELS WITH A MATRIX INVITATION TO SAY THIS. The name lives
    // in the link's fragment and the link was never held on this telephone.
    declared: '',
    who: displayNameFor(from, given),
    named: isNamed(given),
    identifier: from,
    instance,
    // NEVER "ELSEWHERE" ON A SERVER THAT CANNOT BE READ. `null` is not this
    // account's server and is not somebody else's either; a screen warning
    // about an instance it could not name would be a warning about nothing.
    elsewhere:
      instance !== null &&
      serverOf(self) !== null &&
      instance.toLowerCase() !== serverOf(self)?.toLowerCase(),
  }
}

/**
 * The same screen, for a link nobody has spent yet. #329.
 *
 * Three facts and no more, because a link holds three. It names no account
 * and gives nobody a name of this device's own: there is no participant yet
 * to have been given one, and the drawn account does not exist until the
 * token is spent.
 *
 * `elsewhere` is carried through rather than worked out again here. Entry
 * decides it with `sameOrigin`, comparing the link's origin with the one the
 * account's own session actually uses; a second answer computed off a server
 * name would disagree with the first the day an instance is reached under a
 * name its identifiers do not carry -- and the disagreement would show up as
 * a warning on the screen where somebody decides.
 */
export function whatALinkSays(described: Described): WhatIsKnown {
  return {
    source: 'link',
    scope: '',
    declared: described.declared ?? '',
    who: '',
    named: false,
    identifier: '',
    instance: described.instance,
    elsewhere: described.elsewhere,
  }
}

/**
 * The server name inside a Matrix identifier: everything after the first
 * colon, port included.
 *
 * The FIRST colon, because a server name may carry one of its own --
 * `@her:other.example:8448` lives on `other.example:8448` -- and the
 * localpart may not contain one at all.
 *
 * `null` rather than a guess for anything that is not shaped like an
 * identifier. Nothing downstream treats `null` as a mismatch, so a shape
 * nobody expected produces silence rather than a false warning.
 */
function serverOf(userId: string): string | null {
  const at = userId.indexOf(':')
  if (at <= 0) return null
  const server = userId.slice(at + 1)
  return server === '' ? null : server
}
