import { describe, expect, it } from 'vitest'

import type { TimelineEntry } from './mergeTimeline'
import {
  canCopy,
  canFavourite,
  canForward,
  canRemoveForEveryone,
  copyText,
  onlyPhotograph,
  reportable,
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

describe('what can be kept as a favourite', () => {
  it('keeps anything readable, words or a photograph', () => {
    const held = [MINE, shown('$p1', HER)]
    expect(canFavourite(new Set(['$m1']), held)).toBe(true)
    expect(canFavourite(new Set(['$p1']), held)).toBe(true)
    expect(canFavourite(new Set(['$m1', '$p1']), held)).toBe(true)
  })

  it('refuses a message this device could not open', () => {
    // A favourite is a promise that this can be found again, and there is
    // nothing to find in a message whose key never arrived.
    const unreadable: TimelineEntry[] = [
      { eventId: '$x', claimedSender: '@her:x', sentAt: 1, body: null },
    ]
    expect(canFavourite(new Set(['$x']), unreadable)).toBe(false)
  })

  it('refuses a message that was removed for everyone', () => {
    const gone: TimelineEntry[] = [
      {
        eventId: '$x',
        claimedSender: '@her:x',
        sentAt: 1,
        body: null,
        removed: true,
      },
    ]
    expect(canFavourite(new Set(['$x']), gone)).toBe(false)
  })

  it('refuses an empty selection', () => {
    expect(canFavourite(new Set(), [MINE])).toBe(false)
  })
})

describe('what a report carries (#468)', () => {
  /** A message of `kind` that this device read. */
  function wrote(
    eventId: string,
    sender: string,
    sentAt: number,
    body: string,
    msgtype = 'm.text',
  ): TimelineEntry {
    return { eventId, claimedSender: sender, sentAt, body, msgtype }
  }

  const HERS_FIRST = wrote('$h1', HER, 1000, 'salut')
  const HERS_THEN = wrote('$h2', HER, 2000, 'encore')
  const HIS = wrote('$b1', '@him:x', 1500, 'et toi')
  const MY_WORDS = wrote('$m1', ME, 500, 'bonjour')

  it('carries every text selected, from the one other participant who wrote them, in the conversation’s order', () => {
    // #462: « Signaler » on the messages of one other participant, several
    // of them if they wrote several, whatever order they were chosen in.
    const held = [MY_WORDS, HERS_FIRST, HIS, HERS_THEN]
    expect(reportable(new Set(['$h2', '$h1']), held, ME)).toEqual({
      author: HER,
      messages: [
        { eventId: '$h1', sentAt: 1000, sender: HER, text: 'salut' },
        { eventId: '$h2', sentAt: 2000, sender: HER, text: 'encore' },
      ],
    })
  })

  it('carries words of every kind a person writes: a text, a notice, an emote', () => {
    const held = [
      wrote('$n', HER, 1, 'avis', 'm.notice'),
      wrote('$e', HER, 2, 'salue', 'm.emote'),
    ]
    expect(reportable(new Set(['$n', '$e']), held, ME)?.messages).toHaveLength(
      2,
    )
  })

  it('carries nothing, so « Signaler » is absent, when two people wrote them', () => {
    const held = [HERS_FIRST, HIS]
    expect(reportable(new Set(['$h1', '$b1']), held, ME)).toBeNull()
  })

  it('carries nothing when one of them is this account’s own', () => {
    const held = [MY_WORDS, HERS_FIRST]
    expect(reportable(new Set(['$m1']), held, ME)).toBeNull()
    expect(reportable(new Set(['$m1', '$h1']), held, ME)).toBeNull()
  })

  it('carries nothing but words: a video, a voice message, a place, a sticker, a photograph or a document', () => {
    // Photographs and documents are #471's; the others are not carried at
    // all, and a selection holding one is not a report rather than a report
    // quietly missing it.
    const sticker: TimelineEntry = {
      eventId: '$s',
      claimedSender: HER,
      sentAt: 5,
      body: 'un chat',
    }
    const photograph: TimelineEntry = {
      ...shown('$p', HER),
      msgtype: 'm.image',
    }
    const document: TimelineEntry = {
      eventId: '$d',
      claimedSender: HER,
      sentAt: 7,
      body: 'contrat.pdf',
      msgtype: 'm.file',
      document: {} as TimelineEntry['document'],
    }
    const held = [
      HERS_FIRST,
      wrote('$v', HER, 2, 'film.mp4', 'm.video'),
      wrote('$a', HER, 3, 'voix.ogg', 'm.audio'),
      wrote('$l', HER, 4, 'Ici', 'm.location'),
      sticker,
      photograph,
      document,
    ]
    for (const other of ['$v', '$a', '$l', '$s', '$p', '$d']) {
      expect(reportable(new Set([other]), held, ME), other).toBeNull()
      expect(reportable(new Set(['$h1', other]), held, ME), other).toBeNull()
    }
  })

  it('carries nothing for a message this device could not open, or one removed', () => {
    // Nothing readable to send: a report carries the messages as read.
    const unreadable: TimelineEntry = {
      eventId: '$u',
      claimedSender: HER,
      sentAt: 1,
      body: null,
      reason: 'no key',
    }
    const gone: TimelineEntry = {
      eventId: '$g',
      claimedSender: HER,
      sentAt: 1,
      body: null,
      removed: true,
    }
    const held = [HERS_FIRST, unreadable, gone]
    expect(reportable(new Set(['$h1', '$u']), held, ME)).toBeNull()
    expect(reportable(new Set(['$g']), held, ME)).toBeNull()
  })

  it('carries nothing for a selection the conversation no longer holds, or none', () => {
    expect(reportable(new Set(['$h1', '$gone']), [HERS_FIRST], ME)).toBeNull()
    expect(reportable(new Set(), [HERS_FIRST], ME)).toBeNull()
  })
})
