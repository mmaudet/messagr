import { describe, expect, it } from 'vitest'

import type { Invitation } from './encryptedSend'
import { sameThreshold, stillStanding } from './standingInvitations'

const standing = (...scopes: string[]): readonly Invitation[] =>
  scopes.map(scope => ({ scope, from: `@her:x` }))

describe('stillStanding', () => {
  it('is everything the walk found when nothing has been answered', () => {
    expect(stillStanding(standing('!a:x', '!b:x'), new Set())).toEqual(
      standing('!a:x', '!b:x'),
    )
  })

  it('drops the one that has just been answered', () => {
    // The homeserver goes on listing a conversation for a while after a
    // refusal lands, and a join takes a tick to leave `rooms.invite`. Without
    // this the screen would come straight back on the invitation somebody has
    // just decided.
    expect(stillStanding(standing('!a:x', '!b:x'), new Set(['!a:x']))).toEqual(
      standing('!b:x'),
    )
  })

  it('keeps the order the walk reported', () => {
    expect(
      stillStanding(standing('!b:x', '!a:x'), new Set()).map(one => one.scope),
    ).toEqual(['!b:x', '!a:x'])
  })

  it('answers nothing when everything found has been answered', () => {
    expect(stillStanding(standing('!a:x'), new Set(['!a:x']))).toEqual([])
  })
})

describe('sameThreshold', () => {
  it('holds for two readings of the same conversations', () => {
    // Every sync tick reports the invitations standing, and almost every tick
    // reports the same ones. Replacing the state with an equal array would
    // redraw the whole application several times a minute.
    expect(sameThreshold(standing('!a:x'), standing('!a:x'))).toBe(true)
  })

  it('holds for two empty thresholds', () => {
    expect(sameThreshold([], [])).toBe(true)
  })

  it('breaks when an invitation arrives', () => {
    expect(sameThreshold(standing('!a:x'), standing('!a:x', '!b:x'))).toBe(
      false,
    )
  })

  it('breaks when an invitation is answered', () => {
    expect(sameThreshold(standing('!a:x', '!b:x'), standing('!b:x'))).toBe(
      false,
    )
  })

  it('breaks when the same conversation names a different creator', () => {
    // The stripped state is a homeserver's to send, and a creation event that
    // was missing on one tick can be there on the next. The screen names
    // whoever it can name, so that is a redraw rather than a no-op.
    expect(
      sameThreshold(
        [{ scope: '!a:x', from: null }],
        [{ scope: '!a:x', from: '@her:x' }],
      ),
    ).toBe(false)
  })

  it('breaks when the same conversations arrive in a different order', () => {
    // One invitation is decided at a time, so the order decides which. A
    // silent reordering would swap the screen under the finger.
    expect(
      sameThreshold(standing('!a:x', '!b:x'), standing('!b:x', '!a:x')),
    ).toBe(false)
  })
})
