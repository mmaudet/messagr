import { describe, expect, it } from 'vitest'

import type { TimelineEntry } from './mergeTimeline'
import {
  blockable,
  canCopy,
  canFavourite,
  canForward,
  canRemoveForEveryone,
  copyText,
  forwarded,
  forwardingWithoutTheBlocked,
  onlyPhotograph,
  reportable,
  selectionWithoutTheBlocked,
  toggle,
} from './selection'
import { shownOf } from '../runtime/notShown'

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
        {
          kind: 'text',
          eventId: '$h1',
          sentAt: 1000,
          sender: HER,
          text: 'salut',
        },
        {
          kind: 'text',
          eventId: '$h2',
          sentAt: 2000,
          sender: HER,
          text: 'encore',
        },
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

  /**
   * The key material of an encrypted file, as `readImageEvent` and
   * `readFileEvent` hand it on: the event's `file` without its address.
   */
  const MATERIAL = {
    v: 'v2',
    key: {
      kty: 'oct',
      key_ops: ['encrypt', 'decrypt'],
      alg: 'A256CTR',
      k: 'qcHVMSgYg-71CauWBezXI5qkaRb0LuIy-Wx5kIaHMIA',
      ext: true,
    },
    iv: 'X85+XgHN+HEAAAAAAAAAAA',
    hashes: { sha256: 'eZjVdFJp2cSnZjB2S2BWrPCtbWRXjt0ZRkAyXvqSFw8' },
  }

  /**
   * The key material of a thumbnail's encrypted file: a key of its own, not
   * the photograph's (`imageEvent.ts`).
   */
  const THUMBNAIL_MATERIAL = {
    v: 'v2',
    key: {
      kty: 'oct',
      key_ops: ['encrypt', 'decrypt'],
      alg: 'A256CTR',
      k: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8',
      ext: true,
    },
    iv: 'oKGio6SlpqcAAAAAAAAAAA',
    hashes: { sha256: 'piM3s213LABROxYZnnkExsCsjY9idjZfqVCxYxA3TRE' },
  }

  /**
   * A photograph this device read, as the conversation holds it, with the
   * thumbnail its sender made, unless `thumbnail` says otherwise.
   */
  function photographed(
    eventId: string,
    sender: string,
    sentAt: number,
    secret = JSON.stringify(MATERIAL),
    thumbnail: string | null = JSON.stringify(THUMBNAIL_MATERIAL),
  ): TimelineEntry {
    return {
      eventId,
      claimedSender: sender,
      sentAt,
      body: 'image.jpg',
      msgtype: 'm.image',
      image: {
        url: `mxc://x/photo-${eventId.slice(1)}`,
        secret,
        mimeType: 'image/jpeg',
        width: 800,
        height: 600,
        size: 482_113,
        thumbnail:
          thumbnail === null
            ? null
            : {
                url: `mxc://x/thumbnail-${eventId.slice(1)}`,
                secret: thumbnail,
                mimeType: 'image/jpeg',
                width: 80,
                height: 60,
              },
      },
    }
  }

  /** A document this device read, as the conversation holds it. */
  function filed(
    eventId: string,
    sender: string,
    sentAt: number,
    secret = JSON.stringify(MATERIAL),
  ): TimelineEntry {
    return {
      eventId,
      claimedSender: sender,
      sentAt,
      body: 'contrat.pdf',
      msgtype: 'm.file',
      document: {
        url: `mxc://x/file-${eventId.slice(1)}`,
        secret,
        name: 'contrat.pdf',
        mimeType: null,
        size: 10_240,
      },
    }
  }

  it('carries photographs and documents of the one other participant beside their words, each as the description of its encrypted file (#471)', () => {
    // #462: « Signaler » on a selection that mixes words, photographs and
    // documents of one other participant. A file goes as the address of its
    // encrypted copy on the server, its key, its counter, its hashes, its
    // type, its name and its size, and a photograph with its thumbnail's
    // (#496): never their bytes.
    const held = [
      HERS_FIRST,
      photographed('$p', HER, 1500),
      MY_WORDS,
      filed('$d', HER, 1800),
      HERS_THEN,
    ]

    expect(
      reportable(new Set(['$h2', '$d', '$p', '$h1']), held, ME)?.messages,
    ).toEqual([
      {
        kind: 'text',
        eventId: '$h1',
        sentAt: 1000,
        sender: HER,
        text: 'salut',
      },
      {
        kind: 'photograph',
        eventId: '$p',
        sentAt: 1500,
        sender: HER,
        file: { ...MATERIAL, url: 'mxc://x/photo-p' },
        mimetype: 'image/jpeg',
        name: 'image.jpg',
        size: 482_113,
        thumbnail: {
          file: { ...THUMBNAIL_MATERIAL, url: 'mxc://x/thumbnail-p' },
          mimetype: 'image/jpeg',
        },
      },
      {
        kind: 'document',
        eventId: '$d',
        sentAt: 1800,
        sender: HER,
        file: { ...MATERIAL, url: 'mxc://x/file-d' },
        mimetype: null,
        name: 'contrat.pdf',
        size: 10_240,
      },
      {
        kind: 'text',
        eventId: '$h2',
        sentAt: 2000,
        sender: HER,
        text: 'encore',
      },
    ])
  })

  it('carries a photograph’s thumbnail, what the conversation drew of it, with its own key, and nothing for a photograph without one (#496)', () => {
    // A photograph goes with its thumbnail (`reportFormat.ts`, « THE
    // PAYLOAD »), as the event carried it in `info.thumbnail_file`.
    const held = [
      photographed('$p', HER, 1),
      photographed('$n', HER, 2, JSON.stringify(MATERIAL), null),
    ]

    const [withOne, withNone] =
      reportable(new Set(['$p', '$n']), held, ME)?.messages ?? []

    expect(withOne).toMatchObject({
      kind: 'photograph',
      file: { ...MATERIAL, url: 'mxc://x/photo-p' },
      thumbnail: {
        file: { ...THUMBNAIL_MATERIAL, url: 'mxc://x/thumbnail-p' },
        mimetype: 'image/jpeg',
      },
    })
    expect(withNone).toMatchObject({ kind: 'photograph', thumbnail: null })
  })

  it('leaves out a thumbnail the operator could not open, and carries its photograph all the same (#496)', () => {
    // A thumbnail that fails is not a photograph that fails (`imageEvent.ts`):
    // the operator opens the photograph itself.
    const held = [
      photographed('$p', HER, 1, JSON.stringify(MATERIAL), '{"other":"key"}'),
      photographed('$q', HER, 2, JSON.stringify(MATERIAL), 'not JSON'),
      photographed(
        '$r',
        HER,
        3,
        JSON.stringify(MATERIAL),
        JSON.stringify({ ...THUMBNAIL_MATERIAL, hashes: {} }),
      ),
    ]

    expect(
      reportable(new Set(['$p', '$q', '$r']), held, ME)?.messages,
    ).toMatchObject([
      { eventId: '$p', file: { url: 'mxc://x/photo-p' }, thumbnail: null },
      { eventId: '$q', file: { url: 'mxc://x/photo-q' }, thumbnail: null },
      { eventId: '$r', file: { url: 'mxc://x/photo-r' }, thumbnail: null },
    ])
  })

  it('carries nothing for a photograph or a document of somebody else, or of this account', () => {
    const held = [
      HERS_FIRST,
      photographed('$p', '@him:x', 1500),
      filed('$d', ME, 1800),
    ]
    expect(reportable(new Set(['$h1', '$p']), held, ME)).toBeNull()
    expect(reportable(new Set(['$h1', '$d']), held, ME)).toBeNull()
    expect(reportable(new Set(['$d']), held, ME)).toBeNull()
  })

  it('carries nothing for a photograph or a document whose encrypted file this device cannot describe', () => {
    // The operator could not open it: a report without it would be a report
    // quietly missing what was chosen.
    const held = [
      photographed('$p', HER, 1, 'not JSON'),
      filed('$d', HER, 2, JSON.stringify({ ...MATERIAL, key: {} })),
      photographed('$q', HER, 3, JSON.stringify({ ...MATERIAL, hashes: {} })),
    ]
    for (const eventId of ['$p', '$d', '$q']) {
      expect(reportable(new Set([eventId]), held, ME), eventId).toBeNull()
    }
  })

  it('carries nothing of a video, a voice message, a place or a sticker', () => {
    // Not carried at all, and a selection holding one is not a report
    // rather than a report quietly missing it.
    const sticker: TimelineEntry = {
      eventId: '$s',
      claimedSender: HER,
      sentAt: 5,
      body: 'un chat',
    }
    const held = [
      HERS_FIRST,
      wrote('$v', HER, 2, 'film.mp4', 'm.video'),
      wrote('$a', HER, 3, 'voix.ogg', 'm.audio'),
      wrote('$l', HER, 4, 'Ici', 'm.location'),
      sticker,
    ]
    for (const other of ['$v', '$a', '$l', '$s']) {
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

describe('whom « Bloquer l’expéditeur » blocks (#472)', () => {
  // #462: offered when every message chosen comes from one and the same
  // other participant, absent otherwise and never greyed. A block is one
  // relation with one account (ADR 0015), and the account is the one the
  // homeserver attributes the messages to: the one its ignored list holds
  // back.
  const HIM = '@him:x'
  const HERS_THEN = said('$h2', HER, 'encore')
  const HIS = said('$b1', HIM, 'et toi')

  it('names the one other participant who wrote every message chosen', () => {
    const held = [MINE, HERS, HIS, HERS_THEN]

    expect(blockable(new Set(['$h1']), held, ME)).toBe(HER)
    expect(blockable(new Set(['$h2', '$h1']), held, ME)).toBe(HER)
    expect(blockable(new Set(['$b1']), held, ME)).toBe(HIM)
  })

  it('names them whatever their messages hold, since a block carries none of it', () => {
    // Unlike a report, which carries what it names: a photograph, a message
    // this device could not open and one removed each still say who sent it.
    const unreadable: TimelineEntry = {
      eventId: '$u',
      claimedSender: HER,
      sentAt: 0,
      body: null,
      reason: 'no key',
    }
    const gone: TimelineEntry = {
      eventId: '$g',
      claimedSender: HER,
      sentAt: 0,
      body: null,
      removed: true,
    }
    const held = [HERS, shown('$p', HER), unreadable, gone]

    expect(blockable(new Set(['$p', '$u', '$g', '$h1']), held, ME)).toBe(HER)
  })

  it('names nobody, so it is absent, when two participants wrote them', () => {
    // The conversation of three the App Store reviewer is in: one message of
    // each of the two others names neither.
    expect(blockable(new Set(['$h1', '$b1']), [HERS, HIS], ME)).toBeNull()
  })

  it('names nobody when the selection holds this account’s own messages', () => {
    expect(blockable(new Set(['$m1', '$m2']), [MINE, MINE_TOO], ME)).toBeNull()
    expect(blockable(new Set(['$m1']), [MINE, HERS], ME)).toBeNull()
    // Whichever comes first in the conversation.
    expect(blockable(new Set(['$m1', '$h1']), [MINE, HERS], ME)).toBeNull()
    expect(blockable(new Set(['$m1', '$h1']), [HERS, MINE], ME)).toBeNull()
  })

  it('names nobody for a selection the conversation no longer holds, or none', () => {
    // Nothing can say whose it is, as for removing and reporting.
    expect(blockable(new Set(['$h1', '$gone']), [HERS], ME)).toBeNull()
    expect(blockable(new Set(), [HERS], ME)).toBeNull()
  })
})

describe('a selection when an account is blocked meanwhile (#494)', () => {
  // From another device, while messages are selected in a conversation that
  // stays: that account's messages leave the screen, and the selection with
  // them, so that nothing is offered on what nobody can see any more.
  const HIM = '@him:x'
  const HIS = said('$b1', HIM, 'et toi')

  it('drops the selected messages of the account now blocked, and keeps the rest', () => {
    const held = [MINE, HERS, HIS]

    expect([
      ...selectionWithoutTheBlocked(
        new Set(['$h1', '$b1', '$m1']),
        held,
        new Set([HER]),
      ),
    ]).toEqual(['$b1', '$m1'])
  })

  it('hands the same selection back when it holds nothing of theirs', () => {
    const selected = new Set(['$b1', '$m1'])

    expect(
      selectionWithoutTheBlocked(selected, [MINE, HERS, HIS], new Set([HER])),
    ).toBe(selected)
  })
})

describe('what a forward sends, and an account blocked meanwhile (#498)', () => {
  // The picker is up: the messages chosen wait in it for a conversation to
  // go to, and a block made meanwhile, here or on another device, can take
  // their author off the screens before one is picked.
  const HIM = '@him:x'
  const HIS = said('$b1', HIM, 'et toi')
  const held = [MINE, HERS, HIS, MINE_TOO]

  it('keeps no message of the account now blocked in the picker, and the rest in the order chosen', () => {
    expect(
      forwardingWithoutTheBlocked(
        ['$m2', '$h1', '$b1', '$m1'],
        held,
        new Set([HER]),
      ),
    ).toEqual(['$m2', '$b1', '$m1'])
  })

  it('leaves nothing in the picker when all of them were that account’s', () => {
    expect(
      forwardingWithoutTheBlocked(['$h1'], held, new Set([HER])),
    ).toBeNull()
  })

  it('hands the same messages back when none of them was theirs', () => {
    const waiting = ['$b1', '$m1']

    expect(forwardingWithoutTheBlocked(waiting, held, new Set([HER]))).toBe(
      waiting,
    )
  })

  it('sends the messages chosen from the conversation as it is shown, in the order chosen', () => {
    // A message of an account blocked since, or one hidden here since, is
    // not shown any more, and nothing sends it on.
    const asShown = shownOf(held, {
      hidden: new Set(['$m2']),
      blocked: new Set([HER]),
    })

    expect(
      forwarded(['$m2', '$h1', '$b1', '$m1'], asShown).map(one => one.eventId),
    ).toEqual(['$b1', '$m1'])
  })

  it('sends nothing the conversation no longer shows at all', () => {
    expect(forwarded(['$gone'], held)).toEqual([])
  })
})
