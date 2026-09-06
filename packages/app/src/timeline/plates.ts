import type { TimelineEntry } from './mergeTimeline'

/**
 * Photographs sent together, read as one plate.
 *
 * # Matrix has no album event, and this does not invent one
 *
 * Each photograph is its own `m.image`, which is what every other client
 * reads. The grouping is a **reading** of the timeline rather than a thing
 * that was sent: consecutive images, from one sender, close in time.
 *
 * That matters beyond tidiness. An album event would be a shape only this
 * application could open, in a protocol whose point is that it is not only
 * this application — the same argument `imageEvent.ts` makes about the
 * attachment secret, and the same answer.
 *
 * # Why all three conditions, and not just "consecutive"
 *
 * **One sender**, because two people posting at once is two plates, and
 * merging them attributes one person's photographs to the other — the worst
 * thing a grouping can do.
 *
 * **Nothing said in between**, because a sentence between two pictures means
 * they were not one gesture. Drawing them as one would say they were.
 *
 * **Close in time**, because consecutive in a timeline is not the same as
 * sent together: a conversation with one photograph a week is a column of
 * plates of one, not a single plate spanning a month.
 *
 * # A plate of one is still a plate
 *
 * So a screen has one shape to draw rather than two. Whether a plate of one
 * is drawn as a grid or as a picture is the screen's business.
 */

/** How far apart two photographs can be and still be one gesture. */
const WITHIN_MS = 5 * 60 * 1000

export interface Plate {
  /**
   * The event the plate is drawn at, and the one a reaction on it
   * annotates. Its first, because that is where it appears in the thread.
   */
  readonly at: string
  readonly entries: readonly TimelineEntry[]
  /**
   * The entries a screen must not also draw on their own — everything after
   * the first. Without this a screen draws each photograph twice.
   */
  readonly swallowed: ReadonlySet<string>
}

export function platesIn(entries: readonly TimelineEntry[]): readonly Plate[] {
  const plates: Plate[] = []
  let run: TimelineEntry[] = []

  const close = () => {
    if (run.length === 0) return
    plates.push({
      at: run[0]!.eventId,
      entries: run,
      swallowed: new Set(run.slice(1).map(entry => entry.eventId)),
    })
    run = []
  }

  for (const entry of entries) {
    if (entry.image === undefined) {
      close()
      continue
    }
    const previous = run.at(-1)
    const continues =
      previous !== undefined &&
      previous.claimedSender === entry.claimedSender &&
      entry.sentAt - previous.sentAt <= WITHIN_MS
    if (!continues) close()
    run.push(entry)
  }
  close()

  return plates
}
