import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { ConversationSummary } from './conversationList'
import {
  BLIND_ID,
  blindNotification,
  dataOf,
  missedNotification,
  openedByTheTap,
  pressOf,
  readNotification,
  ringingNotification,
  scopeOfPress,
  showingTheBlocked,
  takeDownNotificationsOfTheBlocked,
  type Displayed,
  type Drawn,
  type Notification,
} from './notifying'

describe('blindNotification', () => {
  it('names nobody and quotes nothing', () => {
    // The assertion #90 asks to be pinned. What woke the device carried no
    // sender, no conversation and no content, so nothing here can name one --
    // and a test that only read the copy file would pass whatever the copy
    // said, which is why this looks for the shapes rather than the strings.
    const blind = blindNotification()
    const wire = `${blind.title} ${blind.body}`
    expect(wire).not.toMatch(/@[a-z0-9._=\-/]+:/i)
    expect(wire).not.toMatch(/![a-z0-9._=\-/]+:/i)
    expect(wire).not.toMatch(/\$[A-Za-z0-9]/)
  })

  it('says something arrived, which is all it knows', () => {
    expect(blindNotification().body.length).toBeGreaterThan(0)
  })

  it('collapses onto one, because every blind wake says the same thing', () => {
    expect(blindNotification().id).toBe(blindNotification().id)
  })
})

describe('readNotification', () => {
  it('is keyed by the conversation, so a second message replaces the first', () => {
    const one = readNotification('!a:x', 'Maria', 'first')
    const two = readNotification('!a:x', 'Maria', 'second')
    expect(one.id).toBe(two.id)
  })

  it('keys two conversations apart', () => {
    expect(readNotification('!a:x', 'Maria', 'hi').id).not.toBe(
      readNotification('!b:x', 'Jo', 'hi').id,
    )
  })

  it('carries what was decrypted, because by then it is on this device', () => {
    const read = readNotification('!a:x', 'Maria', 'see you at eight')
    expect(read.title).toBe('Maria')
    expect(read.body).toBe('see you at eight')
  })
})

describe('the notifications a block takes down (#472)', () => {
  // A notification shows one account: whose message arrived last, or who is
  // calling. It carries that account, unseen, so that a block takes down
  // what shows the blocked account, and nothing that shows somebody else --
  // a conversation of more than two whose latest message is another's keeps
  // its notification.
  const BLOCKED = '@bothers:messagr.eu'
  const HER = '@maria:messagr.eu'

  it('names the account each one shows', () => {
    expect(readNotification('!a:x', 'Bothers', 'go away', BLOCKED).from).toBe(
      BLOCKED,
    )
    expect(ringingNotification('!a:x', 'Bothers', false, BLOCKED).from).toBe(
      BLOCKED,
    )
    expect(missedNotification('!a:x', 'Bothers', 0, BLOCKED).from).toBe(BLOCKED)
    // The blind one shows nobody, and nothing takes it down for a block.
    expect(blindNotification().from).toBeUndefined()
  })

  it('takes down those that show a blocked account, and only those', () => {
    // As the platform lists them: the account rides unseen in their data.
    const displayed: Displayed[] = [
      {
        id: '!three-of-us:x',
        notification: { id: '!three-of-us:x', data: { from: BLOCKED } },
      },
      {
        id: '!three-of-us-too:x',
        notification: { id: '!three-of-us-too:x', data: { from: HER } },
      },
      // Listed with no identifier of its own: the notification's stands in.
      {
        notification: { id: 'ringing:!with-them:x', data: { from: BLOCKED } },
      },
      // Drawn by an earlier version, or the blind one: nothing says whose.
      { id: '!older:x', notification: { id: '!older:x' } },
      { id: BLIND_ID, notification: { id: BLIND_ID, data: {} } },
      // Something else than an account where one is expected.
      { id: '!odd:x', notification: { id: '!odd:x', data: { from: {} } } },
    ]

    expect(showingTheBlocked(displayed, new Set([BLOCKED]))).toEqual([
      '!three-of-us:x',
      'ringing:!with-them:x',
    ])
    expect(showingTheBlocked(displayed, new Set())).toEqual([])
  })

  it('carries the account it shows through the platform, and nothing for the blind one (#498)', () => {
    // What the platform hands back is what it was given to draw.
    const drawn = [
      readNotification('!a:x', 'Bothers', 'go away', BLOCKED),
      ringingNotification('!b:x', 'Bothers', true, BLOCKED),
      blindNotification(),
    ].map(listedAsDrawn)

    expect(drawn.map(one => one.notification.data)).toEqual([
      { from: BLOCKED },
      { from: BLOCKED },
      undefined,
    ])
    expect(showingTheBlocked(drawn, new Set([BLOCKED]))).toEqual([
      '!a:x',
      'ringing:!b:x',
    ])
  })
})

/**
 * A notification as the platform lists it once drawn under its identifier
 * with what `dataOf` hands it, the way `showNotification.ts` draws every one.
 */
function listedAsDrawn(notification: Notification): Displayed {
  return {
    id: notification.id,
    notification: { id: notification.id, ...dataOf(notification) },
  }
}

describe('what a block takes down, and where a tap lands afterwards (#469, #472, #498)', () => {
  const BLOCKED = '@bothers:messagr.eu'
  const HER = '@maria:messagr.eu'

  function row(scope: string, other: string | null): ConversationSummary {
    return {
      scope,
      other,
      others: other === null ? 2 : 1,
      preview: 'hello',
      lastAt: 1,
      unread: 0,
    }
  }

  /** The list, the conversation with the blocked account included. */
  const ROWS = [
    row('!with-them:x', BLOCKED),
    row('!three-of-us:x', null),
    row('!with-her:x', HER),
  ]

  /** The platform, as a double: what it lists, and what it was asked. */
  function platform(displayed: readonly Displayed[] | 'will not list'): {
    readonly drawn: Drawn
    readonly cancelled: string[]
  } {
    const cancelled: string[] = []
    return {
      cancelled,
      drawn: {
        displayed: async () => {
          if (displayed === 'will not list') throw new Error('not listed')
          return displayed
        },
        cancel: async id => {
          cancelled.push(id)
        },
      },
    }
  }

  it('takes down all of the conversation with the account newly blocked, whoever they show, and elsewhere those that show it', async () => {
    const { drawn, cancelled } = platform(
      [
        readNotification('!with-them:x', 'Bothers', 'go away', BLOCKED),
        missedNotification('!with-them:x', 'Bothers', 0, BLOCKED),
        readNotification('!three-of-us:x', 'Nous trois', 'again', BLOCKED),
        readNotification('!three-of-us-too:x', 'Nous trois', 'hi', HER),
        readNotification('!with-her:x', 'Maria', 'hello', HER),
        blindNotification(),
      ].map(listedAsDrawn),
    )

    await takeDownNotificationsOfTheBlocked(drawn, ROWS, new Set([BLOCKED]))

    expect(new Set(cancelled)).toEqual(
      new Set(['!with-them:x', 'ringing:!with-them:x', '!three-of-us:x']),
    )
  })

  it('takes down the conversation’s own even when the platform will not say what it shows', async () => {
    // The conversation's notifications are keyed by it, so they are taken
    // down by their key; only those elsewhere needed the listing.
    const { drawn, cancelled } = platform('will not list')

    await takeDownNotificationsOfTheBlocked(drawn, ROWS, new Set([BLOCKED]))

    expect(cancelled).toEqual(['!with-them:x', 'ringing:!with-them:x'])
  })

  it('takes down nothing when nobody new is blocked', async () => {
    const { drawn, cancelled } = platform(
      [readNotification('!with-them:x', 'Bothers', 'go away', BLOCKED)].map(
        listedAsDrawn,
      ),
    )

    await takeDownNotificationsOfTheBlocked(drawn, ROWS, new Set())

    expect(cancelled).toEqual([])
  })

  it('never opens the conversation with a blocked account from a tap on what was drawn before the block', () => {
    // Drawn before the block, on this device or another: the tap lands on
    // the list, where that conversation is not.
    const blocked = new Set([BLOCKED])
    const tap = (scope: string | null) => ({ scope, from: null })

    expect(openedByTheTap(tap('!with-them:x'), ROWS, blocked)).toBeNull()
    expect(openedByTheTap(tap('!three-of-us:x'), ROWS, blocked)).toBe(
      '!three-of-us:x',
    )
    expect(openedByTheTap(tap('!with-her:x'), ROWS, blocked)).toBe(
      '!with-her:x',
    )
    // The blind one, and one the platform drew, open the list.
    expect(openedByTheTap(tap(null), ROWS, blocked)).toBeNull()
    // Nobody blocked: whatever the tap names.
    expect(openedByTheTap(tap('!with-them:x'), ROWS, new Set())).toBe(
      '!with-them:x',
    )
  })

  it('opens nothing from a tap at a cold start on what showed the blocked account, though the rows kept say nothing of it', () => {
    // A cold start draws the list the notebook kept, which never holds the
    // conversation with a blocked account: its row cannot tell. What the
    // notification carries unseen can, against the blocked accounts the
    // notebook kept, before anything is opened even for an instant.
    const keptRows = [row('!with-her:x', HER), row('!three-of-us:x', null)]
    const blocked = new Set([BLOCKED])
    const press = pressOf(
      listedAsDrawn(
        readNotification('!with-them:x', 'Bothers', 'go away', BLOCKED),
      ).notification,
    )

    expect(press).toEqual({ scope: '!with-them:x', from: BLOCKED })
    expect(openedByTheTap(press, keptRows, blocked)).toBeNull()
    // A message of somebody else still opens its conversation.
    expect(
      openedByTheTap(
        pressOf(
          listedAsDrawn(
            readNotification('!three-of-us:x', 'Nous trois', 'hi', HER),
          ).notification,
        ),
        keptRows,
        blocked,
      ),
    ).toBe('!three-of-us:x')
  })

  it('reads what a tap says off the notification, and nothing it does not carry', () => {
    expect(pressOf(undefined)).toEqual({ scope: null, from: null })
    expect(pressOf({ id: BLIND_ID })).toEqual({ scope: null, from: null })
    expect(pressOf({ id: '!a:x', data: { from: {} } })).toEqual({
      scope: '!a:x',
      from: null,
    })
  })
})

describe('what draws a notification (#498)', () => {
  // THE CLAIM THE COMMENTS OF `showNotification.ts` MAKE, HELD HERE: on an
  // iPhone this application's JavaScript draws no notification, calls
  // included. What an iPhone shows is the push gateway's sentence, drawn by
  // the system. A second place that drew one, or the wake registered on both
  // platforms, would make them false, and this says so.
  const app = join(__dirname, '..', '..')

  /** `source` without its comments, which may name anything. */
  function withoutComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  }

  /** The body of `function name() { ... }` in `source`, between its braces. */
  function functionBody(source: string, name: string): string {
    const opening = `function ${name}() {`
    const start = source.indexOf(opening) + opening.length
    let depth = 1
    let at = start
    for (; at < source.length && depth > 0; at += 1) {
      if (source[at] === '{') depth += 1
      if (source[at] === '}') depth -= 1
    }
    return source.slice(start, at - 1)
  }

  function sources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) return sources(path)
      return /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.spec.ts')
        ? [path]
        : []
    })
  }

  it('is the wake alone, which is registered on Android alone', () => {
    const drawing = [
      ...sources(join(app, 'src')),
      join(app, 'App.tsx'),
      join(app, 'index.js'),
    ]
      .filter(path => !path.endsWith(join('runtime', 'showNotification.ts')))
      .filter(path =>
        /\b(drawNotification|ringNotification|displayNotification)\b/.test(
          withoutComments(readFileSync(path, 'utf8')),
        ),
      )
      .map(path => path.slice(app.length + 1))
    expect(drawing).toEqual(['index.js'])
  })

  it('draws from inside the branch `registerTheWake` keeps for Android, and from nowhere else in `index.js`', () => {
    const index = withoutComments(readFileSync(join(app, 'index.js'), 'utf8'))
    const wake = functionBody(index, 'registerTheWake')
    const drawingCall = /draw: drawNotification|ringNotification\(/g

    // The guard is a statement of the function itself, not of a block
    // nested in it: past it, the function runs on Android only.
    const guard = wake.indexOf("if (Platform.OS !== 'android') return")
    expect(guard).toBeGreaterThan(-1)
    const before = wake.slice(0, guard)
    expect(before.split('{').length).toBe(before.split('}').length)

    // Every call that draws is past it, inside that function.
    const inside = [...wake.matchAll(drawingCall)].map(found => found.index)
    expect(inside.length).toBeGreaterThan(0)
    expect(inside.every(at => at > guard)).toBe(true)
    expect([...index.replace(wake, '').matchAll(drawingCall)]).toEqual([])
  })
})

describe('scopeOfPress', () => {
  it('routes a read notification to its conversation', () => {
    expect(scopeOfPress('!a:messagr.eu')).toBe('!a:messagr.eu')
  })

  it('routes the blind one nowhere', () => {
    // Nothing that woke the device said which conversation, so there is none
    // to open. Tapping it opens the application, which then syncs and shows
    // the list with something waiting -- the honest destination.
    expect(scopeOfPress(BLIND_ID)).toBeNull()
  })

  it('routes a notification with no id nowhere either', () => {
    expect(scopeOfPress(undefined)).toBeNull()
  })

  it('routes a notification this application did not draw to the list', () => {
    // SINCE #341 THE PUSH ITSELF CAN DISPLAY SOMETHING. ADR-0009's visible
    // fallback is an `aps.alert`, which iOS shows without the application
    // ever running -- on a phone that is killed and locked, which is the
    // whole point of it. Its identifier is then Apple's, a value this
    // application never chose, and every identifier used to be read as a
    // conversation to open.
    //
    // The ADR asks for the other half in the same breath: "A notification the
    // user taps must land somewhere sensible even when the wake failed and
    // the application does not yet know what arrived." Somewhere sensible is
    // the list. A room identifier begins with `!`; a system identifier does
    // not, and opening a conversation named after one is a screen for a
    // conversation that does not exist.
    expect(scopeOfPress('8C1E0C4F-0B1B-4D5B-9A2E-9E7E2B1A0000')).toBeNull()
    expect(scopeOfPress('')).toBeNull()
    expect(scopeOfPress('@her:messagr.eu')).toBeNull()
  })
})
