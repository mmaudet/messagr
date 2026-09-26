import type { Invitation } from './encryptedSend'

/**
 * What is left on the threshold, and whether it has moved. #329.
 *
 * # WHERE THESE COME FROM
 *
 * `enterInvitations.ts` walks through one door per invitation link this
 * process has spent, and reports every other invitation as `waiting`:
 * neither joined nor declined, standing on the homeserver exactly as it
 * arrived. `Invited.tsx` is what decides those, one at a time, and this is
 * the small amount of bookkeeping between the two.
 *
 * # WHY AN ANSWER HAS TO BE REMEMBERED HERE
 *
 * Neither answer takes effect instantly in what the next sync reports. A
 * join takes a tick to leave `rooms.invite`; a refusal goes on being listed
 * for a while after it lands -- `cryptoPump.ts`'s own `declined` set is
 * there for exactly that, and was measured on the bench in the minute after
 * a collapse. Without `answered`, the screen would come straight back on the
 * invitation somebody has just decided, which reads as a decision that did
 * not take.
 *
 * # AND WHY SAMENESS IS WORTH A FUNCTION
 *
 * This is read on every sync tick, and almost every tick reports the same
 * invitations standing. Handing React a new array each time would redraw the
 * whole application several times a minute for nothing, so the state is
 * replaced only when the threshold has actually changed.
 */

/**
 * The invitations still to decide: what this walk found, less what has
 * already been answered on this run.
 */
export function stillStanding(
  found: readonly Invitation[],
  answered: ReadonlySet<string>,
): readonly Invitation[] {
  return found.filter(one => !answered.has(one.scope))
}

/**
 * Whether two readings of the threshold hold the same invitations, in the
 * same order.
 *
 * Order counts because one invitation is decided at a time and the order
 * decides which: a reordering that compared equal would swap the screen
 * under somebody's finger. The creator counts because a homeserver may send
 * an invitation's stripped state without `m.room.create` on one tick and
 * with it on the next, and the screen names whoever it can name.
 */
export function sameThreshold(
  before: readonly Invitation[],
  now: readonly Invitation[],
): boolean {
  if (before.length !== now.length) return false
  return before.every(
    (one, at) => one.scope === now[at]?.scope && one.from === now[at]?.from,
  )
}
