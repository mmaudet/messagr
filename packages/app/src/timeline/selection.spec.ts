import { describe, expect, it } from 'vitest'

import type { TimelineEntry } from './mergeTimeline'
import {
  canCopy,
  canForward,
  canRemoveForEveryone,
  copyText,
  onlyPhotograph,
  toggle,
} from './selection'

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
    expect([...toggle(new Set(), ['$m1'])]).toEqual(['$m1'])
    expect([...toggle(new Set(['$m1']), ['$m1'])]).toEqual([])
    expect([...toggle(new Set(['$m1']), ['$m2'])]).toEqual(['$m1', '$m2'])
  })

  it('moves a plate’s events together, in the first one’s direction', () => {
    // A plate is one thing on screen. Half in and half out is a state its
    // single outline cannot draw -- and a removal that took one photograph
    // of three is what that state produced.
    expect([...toggle(new Set(), ['$p1', '$p2', '$p3'])]).toEqual([
      '$p1',
      '$p2',
      '$p3',
    ])
    expect([...toggle(new Set(['$p1', '$p2']), ['$p1', '$p2', '$p3'])]).toEqual(
      [],
    )
  })

  it('changes nothing when asked to toggle nothing', () => {
    const held = new Set(['$m1'])
    expect(toggle(held, [])).toBe(held)
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

  it('puts nothing in the text clipboard for a photograph', () => {
    // `copyText` still skips it -- pasting a file name is pasting something
    // nobody wrote. What changed is that a lone photograph now has a
    // clipboard of its own; see the block at the end of this file.
    expect(copyText(new Set(['$p1']), [MY_PHOTO])).toBe('')
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

describe('forwarding', () => {
  it('is offered on words and on photographs alike', () => {
    // Unlike Copy: forwarding a picture is most of why anybody forwards.
    expect(canForward(new Set(['$m1', '$p1']), [MINE, MY_PHOTO])).toBe(true)
  })

  it('is absent on an empty selection', () => {
    expect(canForward(new Set(), [MINE])).toBe(false)
  })

  it('is absent as soon as one cannot be read', () => {
    // Nothing to send on. Sending part of a selection silently is the thing
    // this screen refuses everywhere else.
    const unreadable: TimelineEntry = {
      eventId: '$u',
      claimedSender: HER,
      sentAt: 0,
      body: null,
    }
    expect(canForward(new Set(['$m1', '$u']), [MINE, unreadable])).toBe(false)
  })

  it('is absent on a message that was removed', () => {
    const gone: TimelineEntry = {
      eventId: '$g',
      claimedSender: HER,
      sentAt: 0,
      body: null,
      removed: true,
    }
    expect(canForward(new Set(['$g']), [gone])).toBe(false)
  })
})

describe('copying a photograph', () => {
  it('is offered on a lone photograph', () => {
    // The rule moved once: #192 refused it because there was no way to put a
    // picture on a clipboard, and the dependency added for text turned out
    // to carry `setImage`.
    expect(canCopy(new Set(['$p1']), [MY_PHOTO])).toBe(true)
    expect(onlyPhotograph(new Set(['$p1']), [MY_PHOTO])?.eventId).toBe('$p1')
  })

  it('is not offered for two photographs', () => {
    // A clipboard holds one thing; the second would overwrite the first.
    const other = shown('$p2', ME)
    expect(
      onlyPhotograph(new Set(['$p1', '$p2']), [MY_PHOTO, other]),
    ).toBeNull()
  })

  it('gives way to the words when both are selected', () => {
    // `setString` and `setImage` are the same clipboard. Choosing silently
    // would put half of a selection somewhere nobody can see it.
    expect(onlyPhotograph(new Set(['$m1', '$p1']), [MINE, MY_PHOTO])).toBeNull()
    expect(copyText(new Set(['$m1', '$p1']), [MINE, MY_PHOTO])).toBe('bonjour')
  })

  it('is not offered on a photograph that was removed', () => {
    const gone: TimelineEntry = {
      eventId: '$g',
      claimedSender: ME,
      sentAt: 0,
      body: null,
      removed: true,
      image: {} as TimelineEntry['image'],
    }
    expect(onlyPhotograph(new Set(['$g']), [gone])).toBeNull()
  })
})
