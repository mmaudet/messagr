/**
 * How many invitations this device is waiting for. #329.
 *
 * # WHAT A SPENT LINK ENTITLES A DEVICE TO
 *
 * Opening an invitation link is a decision, taken by the person holding the
 * telephone: they claim the link, the service admits their account, and the
 * conversation it was for sends this device a Matrix invitation. That
 * invitation is the one the application is expecting, and entering it asks
 * nobody anything, because the decision was made a moment earlier.
 *
 * So one link spent is one invitation owed, and this is the register of what
 * is owed. `entry.ts` records a claim here; `enterInvitations.ts` reads the
 * count and walks through that many doors; `cryptoPump.ts` says how many were
 * answered. An invitation beyond what is owed is entered by nobody and waits
 * for the screen of §13.3, which describes it before any decision and offers
 * two symmetric actions, join and refuse.
 *
 * # WHY A COUNT AND NOT A CONVERSATION
 *
 * Nothing in a claim names the conversation the link was for: the service
 * answers a session and nothing else (`claim.rs`'s `ClaimResponse`), and the
 * state of an invitation can only be read with the account of whoever issued
 * it. What this device knows is that it spent a link and that an invitation
 * is on its way -- which is a number, and this holds it.
 *
 * # MODULE STATE, FOR THE LIFE OF THE PROCESS
 *
 * Like `accountInQuestion.ts`, and for the same reason: a launch, a wake and
 * the pump's ticks share one JavaScript context and nothing else. A claim is
 * answered on the launch that made it or on a tick a few seconds later --
 * the issuer's application admits the account a poll after the link is
 * claimed -- so nothing here needs to outlive the process. A relaunch waits
 * for nothing, which is the same answer as for an invitation nobody claimed a
 * link for: it waits for the screen.
 */
export interface AwaitedInvitations {
  /** A link has been spent, so one invitation is on its way to this device. */
  readonly claimed: () => void
  /** How many invitations are still owed to links this process spent. */
  readonly count: () => number
  /** Records that `many` of them have been answered -- entered, or declined. */
  readonly settled: (many: number) => void
}

export function awaitedInvitations(): AwaitedInvitations {
  let owed = 0
  return {
    claimed: () => {
      owed += 1
    },
    count: () => owed,
    settled: many => {
      // A FLOOR AT ZERO RATHER THAN A DEBT. An invitation this device was
      // waiting for can arrive on the same tick as one entered earlier, and a
      // negative count would then owe the next claim less than one door.
      owed = Math.max(0, owed - Math.max(0, many))
    },
  }
}

/** This context's: written by entry, read by the pump. */
export const theAwaitedInvitations = awaitedInvitations()
