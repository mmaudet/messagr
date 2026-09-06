import { describe, expect, it } from 'vitest'

import type { ReadImage } from './imageEvent'
import type { TimelineEntry } from './mergeTimeline'
import { platesIn } from './plates'

const HER = '@maria:x'
const ME = '@me:x'

const picture = (url: string): ReadImage => ({
  url,
  secret: '{}',
  mimeType: 'image/jpeg',
  width: 100,
  height: 100,
})

const said = (
  id: string,
  sentAt: number,
  claimedSender: string,
  image?: string,
): TimelineEntry =>
  ({
    eventId: id,
    sentAt,
    claimedSender,
    body: image === undefined ? 'hello' : 'image.jpg',
    ...(image === undefined ? {} : { image: picture(image) }),
  }) as TimelineEntry

describe('platesIn', () => {
  it('gathers consecutive photographs from one sender', () => {
    const plates = platesIn([
      said('$a', 100, HER, 'mxc://h/1'),
      said('$b', 101, HER, 'mxc://h/2'),
      said('$c', 102, HER, 'mxc://h/3'),
    ])
    expect(plates).toHaveLength(1)
    expect(plates[0]?.entries.map(e => e.eventId)).toEqual(['$a', '$b', '$c'])
  })

  it('does not gather across senders', () => {
    // Two people posting at once is two plates. Merging them would attribute
    // one person's photographs to the other, which is the worst thing a
    // grouping can do.
    const plates = platesIn([
      said('$a', 100, HER, 'mxc://h/1'),
      said('$b', 101, ME, 'mxc://h/2'),
    ])
    expect(plates).toHaveLength(2)
  })

  it('does not gather across a message', () => {
    // Something said between two photographs breaks them apart: they were
    // not sent as one gesture, and drawing them as one would say they were.
    const plates = platesIn([
      said('$a', 100, HER, 'mxc://h/1'),
      said('$b', 101, HER),
      said('$c', 102, HER, 'mxc://h/2'),
    ])
    expect(plates).toHaveLength(2)
  })

  it('does not gather photographs sent an hour apart', () => {
    // Consecutive in the timeline is not the same as sent together. An hour
    // is far beyond any burst a picker produces.
    const plates = platesIn([
      said('$a', 100, HER, 'mxc://h/1'),
      said('$b', 100 + 60 * 60 * 1000, HER, 'mxc://h/2'),
    ])
    expect(plates).toHaveLength(2)
  })

  it('leaves a lone photograph as a plate of one', () => {
    // So a screen has one shape to draw rather than two. A plate of one is
    // drawn as a single picture; that is the screen's business, not this
    // function's.
    const plates = platesIn([said('$a', 100, HER, 'mxc://h/1')])
    expect(plates).toHaveLength(1)
    expect(plates[0]?.entries).toHaveLength(1)
  })

  it('is empty for a conversation with no photographs', () => {
    expect(platesIn([said('$a', 100, HER)])).toEqual([])
  })

  it('keys each plate by its first event, which is its identity', () => {
    // A screen draws the plate where its first entry was, and a reaction on
    // the plate annotates that event. Both need the same answer.
    const plates = platesIn([
      said('$a', 100, HER, 'mxc://h/1'),
      said('$b', 101, HER, 'mxc://h/2'),
    ])
    expect(plates[0]?.at).toBe('$a')
  })

  it('says which entries a screen should not draw on their own', () => {
    // Everything after a plate's first entry is drawn inside it. Without
    // this a screen would draw each photograph twice: once in the plate and
    // once as itself.
    const plates = platesIn([
      said('$a', 100, HER, 'mxc://h/1'),
      said('$b', 101, HER, 'mxc://h/2'),
      said('$c', 102, HER, 'mxc://h/3'),
    ])
    expect([...(plates[0]?.swallowed ?? [])]).toEqual(['$b', '$c'])
  })
})
