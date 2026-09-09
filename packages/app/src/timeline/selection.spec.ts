import { describe, expect, it } from 'vitest'

import type { TimelineEntry } from './mergeTimeline'
import { canCopy, canRemoveForEveryone, copyText, toggle } from './selection'

const ME = '@me:x'
const HER = '@her:x'

function said(eventId: string, sender: string, body: string): TimelineEntry {
  return { eventId, claimedSender: sender, sentAt: 0, body }
}

function shown(eventId: string, sender: string): TimelineEntry {
  return {
    eventId,
    claimedSender: sender,
    sentAt: 0,
    body: 'photo.jpg',
    image: {} as TimelineEntry['image'],
  }
}

const MINE = said('$m1', ME, 'bonjour')
const MINE_TOO = said('$m2', ME, 'et aussi')
const HERS = said('$h1', HER, 'salut')
const MY_PHOTO = shown('$p1', ME)

describe('the selection', () => {
  it('adds and removes on the same gesture', () => {
    expect([...toggle(new Set(), '$m1')]).toEqual(['$m1'])
    expect([...toggle(new Set(['$m1']), '$m1')]).toEqual([])
    expect([...toggle(new Set(['$m1']), '$m2')]).toEqual(['$m1', '$m2'])
  })
})

describe('removing for everyone', () => {
  it('is offered when everything selected is this account’s own', () => {
    expect(
      canRemoveForEveryone(new Set(['$m1', '$m2']), [MINE, MINE_TOO], ME),
    ).toBe(true)
  })

  it('is absent as soon as one is somebody else’s', () => {
    // Not "applies to the subset it can". Destroying three of five without
    // saying so is worse than not offering the action.
    expect(
      canRemoveForEveryone(new Set(['$m1', '$h1']), [MINE, HERS], ME),
    ).toBe(false)
  })

  it('is offered on this account’s own photograph', () => {
    expect(canRemoveForEveryone(new Set(['$p1']), [MY_PHOTO], ME)).toBe(true)
  })

  it('is absent on an empty selection', () => {
    expect(canRemoveForEveryone(new Set(), [MINE], ME)).toBe(false)
  })

  it('is absent when a selected event is not in the timeline', () => {
    // Nothing can say whose it is, so nothing offers to destroy it.
    expect(canRemoveForEveryone(new Set(['$gone']), [MINE], ME)).toBe(false)
  })
})

describe('copying', () => {
  it('is offered when at least one selected event has something to say', () => {
    expect(canCopy(new Set(['$m1', '$p1']), [MINE, MY_PHOTO])).toBe(true)
  })

  it('is absent when the selection is only photographs', () => {
    // The one deliberate exception to "absent unless it applies to all of
    // it": a photograph contributes nothing to a clipboard, and there is no
    // image clipboard without a native module. Written down in #192.
    expect(canCopy(new Set(['$p1']), [MY_PHOTO])).toBe(false)
  })

  it('is absent on an empty selection', () => {
    expect(canCopy(new Set(), [MINE])).toBe(false)
  })

  it('joins the bodies in the order the conversation reads', () => {
    const text = copyText(new Set(['$m2', '$m1']), [MINE, MINE_TOO])
    expect(text).toBe('bonjour\net aussi')
  })

  it('carries no name and no time, ever', () => {
    // ADR-0010: a given name says who somebody is TO YOU, on the device
    // where you said it. The clipboard is the least controlled destination
    // there is, so nothing that identifies anybody goes into it.
    const text = copyText(new Set(['$h1']), [HERS])
    expect(text).toBe('salut')
    expect(text).not.toContain(HER)
  })

  it('skips a photograph rather than pasting its file name', () => {
    expect(copyText(new Set(['$m1', '$p1']), [MINE, MY_PHOTO])).toBe('bonjour')
  })

  it('skips a message this device could not read', () => {
    const unreadable: TimelineEntry = {
      eventId: '$u',
      claimedSender: HER,
      sentAt: 0,
      body: null,
    }
    expect(copyText(new Set(['$u', '$m1']), [MINE, unreadable])).toBe('bonjour')
  })
})
