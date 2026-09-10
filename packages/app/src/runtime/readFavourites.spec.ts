import { describe, expect, it } from 'vitest'

import type { TimelineEntry } from '../timeline/mergeTimeline'
import { readFavourites, type ReadingFavourites } from './readFavourites'

function said(eventId: string, body: string): TimelineEntry {
  return { eventId, claimedSender: '@her:x', sentAt: 1, body }
}

const MARKS = [
  { eventId: '$a', scope: '!one:x', at: 3 },
  { eventId: '$b', scope: '!two:x', at: 2 },
  { eventId: '$c', scope: '!one:x', at: 1 },
]

function reading(over: Partial<ReadingFavourites> = {}) {
  const asked: string[] = []
  const deps: ReadingFavourites = {
    entries: async scope => {
      asked.push(scope)
      return scope === '!one:x'
        ? [said('$a', 'bonjour'), said('$c', 'à tout à l’heure')]
        : [said('$b', 'entendu')]
    },
    ...over,
  }
  return { deps, asked }
}

describe('the messages behind the marks', () => {
  it('answers each mark with the message it points at', async () => {
    const { deps } = reading()
    const read = await readFavourites(deps, MARKS)
    expect(read.map(one => one.entry?.body)).toEqual([
      'bonjour',
      'entendu',
      'à tout à l’heure',
    ])
  })

  it('keeps the order the page answered in, which is newest kept first', async () => {
    const { deps } = reading()
    const read = await readFavourites(deps, MARKS)
    expect(read.map(one => one.favourite.eventId)).toEqual(['$a', '$b', '$c'])
  })

  it('derives a conversation once however many marks it holds', async () => {
    // Two of the three marks are in the same conversation.
    const { deps, asked } = reading()
    await readFavourites(deps, MARKS)
    expect(asked).toEqual(['!one:x', '!two:x'])
  })

  it('answers null for a mark whose message is not there any more', async () => {
    // Beyond what one fetch reaches, a key that never arrived, or removed
    // for everyone since. A row that vanished silently would leave somebody
    // sure they had kept something they cannot find.
    const { deps } = reading({ entries: async () => [] })
    const read = await readFavourites(deps, [MARKS[0]!])
    expect(read).toEqual([{ favourite: MARKS[0], entry: null }])
  })

  it('lets one conversation that will not derive cost only its own marks', async () => {
    const { deps } = reading({
      entries: async scope => {
        if (scope === '!one:x') throw new Error('the homeserver refused')
        return [said('$b', 'entendu')]
      },
    })
    const read = await readFavourites(deps, MARKS)
    expect(read.map(one => one.entry?.body ?? null)).toEqual([
      null,
      'entendu',
      null,
    ])
  })

  it('asks nothing at all when nothing is kept', async () => {
    const { deps, asked } = reading()
    expect(await readFavourites(deps, [])).toEqual([])
    expect(asked).toEqual([])
  })
})
