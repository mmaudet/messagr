import { describe, expect, it } from 'vitest'

import {
  KIND_KEY,
  kindOfRedaction,
  leavesALine,
  redactionBody,
} from './redactionKind'

/** A redacted event, as the homeserver hands one back. */
function redacted(content?: Record<string, unknown>) {
  return {
    event_id: '$e',
    sender: '@her:x',
    type: 'm.room.encrypted',
    unsigned: {
      redacted_because: {
        type: 'm.room.redaction',
        redacts: '$e',
        ...(content === undefined ? {} : { content }),
      },
    },
  }
}

describe('what a redaction says it removed', () => {
  it('writes the kind into the body it sends', () => {
    expect(redactionBody('message')).toEqual({ [KIND_KEY]: 'message' })
    expect(redactionBody('reaction')).toEqual({ [KIND_KEY]: 'reaction' })
  })

  it('reads the kind back off a redacted event', () => {
    expect(kindOfRedaction(redacted({ [KIND_KEY]: 'message' }))).toBe('message')
    expect(kindOfRedaction(redacted({ [KIND_KEY]: 'reaction' }))).toBe(
      'reaction',
    )
  })

  it('answers null for an event nobody redacted', () => {
    expect(kindOfRedaction({ event_id: '$e', sender: '@her:x' })).toBeNull()
  })

  it('answers null when the redaction carries no kind', () => {
    // Another client, or a Messagr from before this key existed.
    expect(kindOfRedaction(redacted())).toBeNull()
    expect(kindOfRedaction(redacted({ reason: 'parce que' }))).toBeNull()
  })

  it('answers null for a kind it does not recognise', () => {
    expect(kindOfRedaction(redacted({ [KIND_KEY]: 'poisson' }))).toBeNull()
    expect(kindOfRedaction(redacted({ [KIND_KEY]: 42 }))).toBeNull()
  })

  describe('and whether it deserves a line', () => {
    it('gives a removed message one', () => {
      expect(leavesALine(redacted({ [KIND_KEY]: 'message' }))).toBe(true)
    })

    it('gives a withdrawn reaction none', () => {
      expect(leavesALine(redacted({ [KIND_KEY]: 'reaction' }))).toBe(false)
    })

    it('gives an unmarked redaction none', () => {
      // THE MIGRATION, AND WHY SILENCE IS THE SAFE DEFAULT. Every redaction
      // this application made before this key existed was somebody taking a
      // reaction back, so an unmarked one in an existing conversation is a
      // reaction. And the two failures are not symmetric: a missing line is
      // what yesterday already did, while a spurious one is the phantom
      // message that was reported from a Pixel and fixed on 8 September.
      expect(leavesALine(redacted())).toBe(false)
    })
  })
})
