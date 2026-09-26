import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { applePushToken } from './applePushToken'

/**
 * Reading Apple's own token, on a runtime shaped like the one that ships.
 *
 * # THE CASE IS THE WHOLE TEST, AND #325 IS WHY
 *
 * `RNFBMessagingSerializer.m` formatted the token with `%02.2hhX` -- upper
 * case hexadecimal, no separator -- and nothing between there and sygnal ever
 * touched it: not `pushDevice.ts`, not `pusher.ts`, and not sygnal, which is
 * configured `convert_device_token_to_hex: false`. So the string this module
 * answers IS the `pushkey` the account carries.
 *
 * A module handing back lower case would therefore not be a cosmetic
 * difference. It would register a second pusher under a key this device's own
 * ghost removal cannot recognise, and hand Apple a token in a form nobody
 * here has established Apple accepts. That is #325 exactly: everything green
 * up to Apple, `BadDeviceToken` at every push, and a pair of environments
 * perfectly matched.
 *
 * So the case is asserted rather than repaired. Upper case travels through
 * untouched; anything else is refused and named, and never reaches
 * `pusher.ts`. Repairing it with `toUpperCase` would have made this test
 * unable to fail: every input would pass, and a native half that had drifted
 * would go on drifting in silence.
 */

const registry = vi.hoisted(() => ({ modules: new Map<string, unknown>() }))

vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  // The one lookup that answers under either architecture (`deviceLocale.ts`
  // carries the argument, and #353 carries its price).
  TurboModuleRegistry: {
    get: (name: string) => registry.modules.get(name) ?? null,
  },
  NativeModules: new Proxy(
    {},
    { get: (_target, name) => registry.modules.get(String(name)) },
  ),
}))

/** Thirty-two bytes, as Apple hands them over, in the case UIKit gives. */
const TOKEN = '7A6B1F0C2D3E4F5061728394A5B6C7D8E9FA0B1C2D3E4F5061728394A5B6C7D8'

/** What the native half looks like from here: two methods and nothing else. */
function appleModule(answers: {
  readonly token?: string | null
  readonly refused?: boolean
  readonly throws?: boolean
  readonly answersAfter?: number
}): { asks: number; looks: number } {
  const counted = { asks: 0, looks: 0 }
  registry.modules.set('MessagrApplePush', {
    askApple: async () => {
      counted.asks += 1
      if (answers.throws === true) throw new Error('no native half')
    },
    readApple: async () => {
      counted.looks += 1
      if (answers.throws === true) throw new Error('no native half')
      const answered = counted.looks > (answers.answersAfter ?? 0)
      return {
        token: answered ? (answers.token ?? null) : null,
        refused: answers.refused === true,
      }
    },
  })
  return counted
}

/** What the log wrote, whatever level it wrote it at. */
function linesWrittenBy(gesture: () => unknown): {
  readonly lines: string[]
  readonly done: Promise<unknown>
} {
  const lines: string[] = []
  for (const method of ['log', 'warn', 'error'] as const) {
    vi.spyOn(console, method).mockImplementation((...written: unknown[]) => {
      lines.push(String(written[0]))
    })
  }
  return { lines, done: Promise.resolve(gesture()) }
}

/** No wait at all, so a test that exhausts the looks costs nothing. */
const NOW = { tries: 3, gapMs: 0 }

beforeEach(() => {
  registry.modules.clear()
  for (const method of ['log', 'warn', 'error'] as const) {
    vi.spyOn(console, method).mockImplementation(() => undefined)
  }
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('the token Apple answered', () => {
  it('travels through in the case UIKit gave it, character for character', async () => {
    appleModule({ token: TOKEN })
    expect(await applePushToken(NOW)).toEqual({ token: TOKEN, unread: null })
  })

  it('is refused and named when it comes back in lower case', async () => {
    appleModule({ token: TOKEN.toLowerCase() })
    expect(await applePushToken(NOW)).toEqual({ token: null, unread: 'notHex' })
  })

  it('is not quietly upper-cased on the way through', async () => {
    // The repair that would make this file prove nothing. Named so that
    // whoever reaches for it meets the reason first.
    appleModule({ token: TOKEN.toLowerCase() })
    const read = await applePushToken(NOW)
    expect(read.token).not.toBe(TOKEN)
  })

  it('is refused when it carries anything that is not hexadecimal', async () => {
    appleModule({ token: 'Z'.repeat(64) })
    expect(await applePushToken(NOW)).toEqual({ token: null, unread: 'notHex' })
  })

  it('is refused when it has an odd number of characters, which is no bytes', async () => {
    appleModule({ token: TOKEN.slice(1) })
    expect(await applePushToken(NOW)).toEqual({ token: null, unread: 'notHex' })
  })

  it('says so in the trace, which is all a store build writes', async () => {
    vi.stubGlobal('__DEV__', false)
    vi.stubEnv('MESSAGR_SEND_PROBE', '')
    vi.stubEnv('MESSAGR_WHOLE_LOG', '')
    appleModule({ token: TOKEN.toLowerCase() })
    const written = linesWrittenBy(() => applePushToken(NOW))
    await written.done
    expect(written.lines).toEqual([
      'MESSAGR_APNS_TOKEN_UNREAD {"unread":"notHex"}',
    ])
  })

  it('writes nothing at all when the device answered', async () => {
    appleModule({ token: TOKEN })
    const written = linesWrittenBy(() => applePushToken(NOW))
    await written.done
    expect(written.lines).toEqual([])
  })
})

describe('asking Apple', () => {
  it('happens once, before anything is read', async () => {
    const counted = appleModule({ token: TOKEN })
    await applePushToken(NOW)
    expect(counted.asks).toBe(1)
    expect(counted.looks).toBe(1)
  })

  it('stops looking the moment the token is there', async () => {
    const counted = appleModule({ token: TOKEN, answersAfter: 1 })
    expect(await applePushToken(NOW)).toEqual({ token: TOKEN, unread: null })
    expect(counted.looks).toBe(2)
  })
})

describe('when no token arrives', () => {
  /**
   * FOUR SILENCES, AND THEY USED TO BE ONE SENTENCE.
   *
   * `pushDevice.ts` answered "Apple has not answered with a token yet" for
   * every one of these, which is true of exactly one of them. A build with no
   * native half at all, a build Apple refused, and a build that is simply
   * early read identically from outside a telephone -- and outside a
   * telephone is the only place anybody reads a store build.
   */
  it('names a build that does not carry the native half', async () => {
    expect(await applePushToken(NOW)).toEqual({
      token: null,
      unread: 'noModule',
    })
  })

  it('names a refusal from Apple rather than call it a wait', async () => {
    appleModule({ token: null, refused: true })
    expect(await applePushToken(NOW)).toEqual({
      token: null,
      unread: 'appleRefused',
    })
  })

  it('names a wait that ran out, having looked every time it was told to', async () => {
    const counted = appleModule({ token: null })
    expect(await applePushToken(NOW)).toEqual({
      token: null,
      unread: 'noAnswer',
    })
    expect(counted.looks).toBe(NOW.tries)
  })

  it('does not fail a launch when the native half throws, and says that too', async () => {
    appleModule({ throws: true })
    const written = linesWrittenBy(() => applePushToken(NOW))
    await expect(written.done).resolves.toEqual({
      token: null,
      unread: 'threw',
    })
  })

  it('writes each silence to the trace under its own word', async () => {
    vi.stubGlobal('__DEV__', false)
    vi.stubEnv('MESSAGR_SEND_PROBE', '')
    vi.stubEnv('MESSAGR_WHOLE_LOG', '')
    const written = linesWrittenBy(() => applePushToken(NOW))
    await written.done
    expect(written.lines).toEqual([
      'MESSAGR_APNS_TOKEN_UNREAD {"unread":"noModule"}',
    ])
  })
})
