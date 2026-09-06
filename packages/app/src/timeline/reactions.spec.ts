import { describe, expect, it } from 'vitest'

import { readReaction, tallyReactions, type LooseReaction } from './reactions'

const ME = '@me:x'
const HER = '@her:x'

function reaction(
  eventId: string,
  target: string,
  key: string,
  claimedSender: string,
): LooseReaction {
  return { eventId, target, key, claimedSender }
}

describe('readReaction', () => {
  it('reads Matrix’s own annotation shape, carried inside the ciphertext', () => {
    expect(
      readReaction('$r1', HER, {
        'm.relates_to': {
          rel_type: 'm.annotation',
          event_id: '$m1',
          key: '👍',
        },
      }),
    ).toEqual({ eventId: '$r1', target: '$m1', key: '👍', claimedSender: HER })
  })

  it('is null for a message, which is what most decrypted events are', () => {
    expect(readReaction('$m1', HER, { body: 'bonjour' })).toBeNull()
  })

  it('is null for a relation that is not an annotation', () => {
    expect(
      readReaction('$r1', HER, {
        'm.relates_to': { rel_type: 'm.replace', event_id: '$m1', key: 'x' },
      }),
    ).toBeNull()
  })

  it('is null when the shape is not what it claims', () => {
    expect(readReaction('$r1', HER, null)).toBeNull()
    expect(readReaction('$r1', HER, { 'm.relates_to': 'nope' })).toBeNull()
    expect(
      readReaction('$r1', HER, {
        'm.relates_to': { rel_type: 'm.annotation', key: '👍' },
      }),
    ).toBeNull()
    expect(
      readReaction('$r1', HER, {
        'm.relates_to': { rel_type: 'm.annotation', event_id: '$m1', key: 7 },
      }),
    ).toBeNull()
  })
})

describe('tallyReactions', () => {
  it('groups by the message reacted to', () => {
    const tally = tallyReactions(
      [reaction('$r1', '$m1', '👍', HER), reaction('$r2', '$m2', '❤️', HER)],
      ME,
    )
    expect(tally.get('$m1')).toEqual([{ key: '👍', count: 1, mine: null }])
    expect(tally.get('$m2')).toEqual([{ key: '❤️', count: 1, mine: null }])
  })

  it('counts the same key from different people once each', () => {
    const tally = tallyReactions(
      [reaction('$r1', '$m1', '👍', HER), reaction('$r2', '$m1', '👍', ME)],
      ME,
    )
    expect(tally.get('$m1')).toEqual([{ key: '👍', count: 2, mine: '$r2' }])
  })

  it('carries the id of this account’s own reaction, because removing it is a redaction', () => {
    // A screen offering "remove" without knowing which event to redact would
    // be offering a gesture it cannot perform.
    const tally = tallyReactions([reaction('$mine', '$m1', '👍', ME)], ME)
    expect(tally.get('$m1')?.[0]?.mine).toBe('$mine')
  })

  it('does not claim a reaction of somebody else as this account’s', () => {
    const tally = tallyReactions([reaction('$r1', '$m1', '👍', HER)], ME)
    expect(tally.get('$m1')?.[0]?.mine).toBeNull()
  })

  it('keeps keys in the order they were first seen, whatever the counts', () => {
    // A tally that reordered as people reacted would move under a thumb.
    const tally = tallyReactions(
      [
        reaction('$r1', '$m1', '🙂', HER),
        reaction('$r2', '$m1', '👍', HER),
        reaction('$r3', '$m1', '👍', ME),
      ],
      ME,
    )
    expect(tally.get('$m1')?.map(t => t.key)).toEqual(['🙂', '👍'])
  })

  it('keeps a reaction pointing at a message it has not seen', () => {
    // Ordinary: a device can hold the key for one and not the other, and the
    // message may be one fetch away.
    const tally = tallyReactions([reaction('$r1', '$absent', '👍', HER)], ME)
    expect(tally.get('$absent')).toHaveLength(1)
  })

  it('drops an empty key rather than showing a blank chip', () => {
    const tally = tallyReactions([reaction('$r1', '$m1', '', HER)], ME)
    expect(tally.get('$m1')).toBeUndefined()
  })

  it('is empty for a conversation nobody reacted in', () => {
    expect(tallyReactions([], ME).size).toBe(0)
  })
})
