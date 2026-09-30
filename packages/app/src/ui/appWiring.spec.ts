import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * What `App.tsx` hands the rules it calls, read in its source (#498).
 *
 * The screen cannot be rendered in this workspace, and the defects #498
 * names were in its wiring, not in the rules: the rules were right and were
 * handed the wrong account. So the wiring is read where it is written, as
 * `copy.spec.ts` reads every screen for labels and `notifying.spec.ts`
 * reads what draws a notification.
 *
 * Read as code: without comments, and without whitespace, so that what is
 * checked does not depend on how Prettier wraps a call.
 */
const code = readFileSync(join(__dirname, '..', '..', 'App.tsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\s+/g, '')

/** How many times `text`, without whitespace, appears in the code. */
function count(text: string): number {
  return code.split(text).length - 1
}

/**
 * The body of the function `const name = (...) => { ... }`, between its
 * braces, or `null` when there is no such function.
 */
function bodyOf(name: string): string | null {
  const found = new RegExp(
    `const${name}=(?:useCallback\\()?\\([^)]*\\)=>\\{`,
  ).exec(code)
  if (found === null) return null
  let depth = 1
  let at = found.index + found[0].length
  const start = at
  for (; at < code.length && depth > 0; at += 1) {
    if (code[at] === '{') depth += 1
    if (code[at] === '}') depth -= 1
  }
  return code.slice(start, at - 1)
}

/**
 * The arguments of every call of `callee` in the code, each as written: the
 * text between its parentheses, split where a comma stands at its own depth.
 */
function callsOf(callee: string): readonly (readonly string[])[] {
  const calls: string[][] = []
  const opening = new RegExp(`(?<![\\w.])${callee}\\(`, 'g')
  for (const found of code.matchAll(opening)) {
    let depth = 0
    let argument = ''
    const args: string[] = []
    for (const character of code.slice(found.index + found[0].length)) {
      if (depth === 0 && (character === ')' || character === ',')) {
        if (argument !== '') args.push(argument)
        argument = ''
        if (character === ')') break
        continue
      }
      if ('([{'.includes(character)) depth += 1
      if (')]}'.includes(character)) depth -= 1
      argument += character
    }
    calls.push(args)
  }
  return calls
}

describe('the one account App.tsx reads (#472, #494, #498)', () => {
  it('is the session’s, held where the session is, and set nowhere else', () => {
    // A second account, set only by a launch that found a conversation, was
    // empty after one that found none.
    expect(count('setSelfUserId')).toBe(0)
    expect(count('credentialsRef.current=')).toBe(1)
    expect(count('setSelfNow(')).toBe(1)
    expect(bodyOf('holdTheSession')).toBe(
      'credentialsRef.current=accountsetSelfNow(account.userId)',
    )
    // The launch holds its session before it looks for any conversation.
    const held = code.indexOf('holdTheSession(credentials)')
    expect(held).toBeGreaterThan(-1)
    expect(held).toBeLessThan(code.indexOf('firstJoinedRoom('))
  })

  it('is the account every reading of the conversation open is handed', () => {
    // What the bar offers, what a report would carry, whom a block would
    // name, « pour tout le monde », the reactions, the ticks and the bubbles.
    const handed = [
      'offersOf',
      'reportable',
      'blockable',
      'canRemoveForEveryone',
      'reactionsShown',
      'readMarkNow',
    ].flatMap(callee =>
      callsOf(callee).map(args => [callee, args[args.length - 1]]),
    )

    expect(handed.length).toBeGreaterThanOrEqual(6)
    for (const [callee, account] of handed) {
      expect(`${callee}: ${account}`).toBe(`${callee}: selfNow`)
    }
    expect(count('selfUserId={selfNow}')).toBe(1)
    expect(count('selfUserId={')).toBe(1)
  })

  it('is the account the invitation on the threshold and the offer of a backup read', () => {
    expect(callsOf('whatIsKnown')).toEqual([['deciding', 'selfNow', 'names']])
    expect(callsOf('receivedFromSomebodyElse')).toEqual([
      ['conversation', 'selfNow'],
    ])
  })
})

describe('a tap on a notification (#469, #498)', () => {
  it('is read whole, what the notification showed included, against the blocked accounts held since the notebook opened', () => {
    // At a cold start the rows are the notebook's, which never hold the
    // conversation with a blocked account: what the notification showed says
    // it, against the blocked accounts the notebook kept.
    expect(callsOf('openedByTheTap')).toEqual([
      ['press', 'derivedSummariesRef.current', 'ignoredRef.current??newSet()'],
    ])
    expect(code).toContain('whenNotificationPressed(press=>{')
  })
})

describe('the ways out of the conversation open (#494, #498)', () => {
  it('closes it by one function, which puts down everything drawn over it', () => {
    expect(bodyOf('leaveTheConversation')).toBe(
      'setOpenScope(null)openScopeRef.current=nullsetOver(NOTHING_OVER)',
    )
    // Nowhere else is it closed by hand.
    expect(count('setOpenScope(null)')).toBe(1)
  })

  it('says so on the list when a block is what closes it', () => {
    expect(bodyOf('leaveAfterABlock')).toBe(
      'leaveTheConversation()setBlockOnScreen(on=>saidOnLeaving(on,scope))',
    )
  })

  it('takes a share that failed back to the list as `backToTheList` says, looking for contacts closed with the rest', () => {
    // It closed the conversation by hand, and left the sheets over the list
    // and looking for contacts drawn in its place.
    const body = bodyOf('sayTheShareFailed') ?? ''

    expect(callsOf('backToTheList')).toHaveLength(1)
    expect(body).toContain('constnext=backToTheList(')
    for (const applied of [
      'setOpenScope(next.open)',
      'openScopeRef.current=next.open',
      'setOver(next.over)',
      'setTab(next.tab)',
      'setInvite(next.invite)',
      'setPlusOpen(next.plusOpen)',
      'setAdmission(next.admission)',
      "if(next.finding.stage==='shut')findingRef.current.close()",
    ]) {
      expect(body).toContain(applied)
    }
  })

  it('puts the layers down when another conversation opens, and when a tab is chosen, where none is open', () => {
    expect(count('setOver(NOTHING_OVER)')).toBe(3)
    expect(code).toMatch(
      /openScopeRef\.current=scopesetConversation\(null\)setOver\(NOTHING_OVER\)/,
    )
    expect(code).toMatch(/onSelect=\{next=>\{setOver\(NOTHING_OVER\)/)
  })
})
