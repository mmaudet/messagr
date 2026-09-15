import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ClientPrefix,
  MatrixHttpApi,
  Method,
  type HttpApiEvent,
  type HttpApiEventHandlerMap,
} from 'matrix-js-sdk/lib/http-api/index'
import { logger as sdkLogger, type Logger } from 'matrix-js-sdk/lib/logger'
import { TypedEventEmitter } from 'matrix-js-sdk/lib/models/typed-event-emitter'

import type { LogFields } from './log'
import { keepTheSdkToWarnings, logEvent, logWhenChanged } from './log'

function captured(level: 'info' | 'warn' | 'error', fields: LogFields): string {
  const method = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'
  const spy = vi.spyOn(console, method).mockImplementation(() => undefined)
  logEvent(level, 'EVENT', fields)
  const line = String(spy.mock.calls.at(-1)?.[0])
  return line
}

/** Every line a gesture wrote, whatever the level it wrote it at. */
function linesWrittenBy(gesture: () => void): string[] {
  const lines: string[] = []
  for (const method of ['log', 'warn', 'error'] as const) {
    vi.spyOn(console, method).mockImplementation((...written: unknown[]) => {
      lines.push(String(written[0]))
    })
  }
  gesture()
  return lines
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('writing an event', () => {
  it('writes the event name and its fields', () => {
    expect(captured('info', { a: 1, b: 'two' })).toBe('EVENT {"a":1,"b":"two"}')
  })

  it('writes errors through console.error and warnings through console.warn', () => {
    expect(captured('error', { a: 1 })).toContain('EVENT')
    expect(captured('warn', { a: 1 })).toContain('EVENT')
  })
})

describe('a field that cannot be serialised', () => {
  function cyclical(): LogFields {
    const loop: Record<string, unknown> = { name: 'loop' }
    loop.self = loop
    return loop
  }

  it('does not throw, which is the whole point', () => {
    // The defect this exists for: one `JSON.stringify(fields)` threw inside
    // the effect that drives the launch, so the report killed the thing it
    // was reporting on. Every screen below stayed empty and the only evidence
    // was the exception from the line whose job was to explain.
    expect(() => logEvent('info', 'EVENT', { bad: cyclical() })).not.toThrow()
  })

  it('keeps every field it can and names the one it lost', () => {
    const line = captured('info', {
      good: 'kept',
      bad: cyclical(),
      alsoGood: 42,
    })
    const body = JSON.parse(line.slice('EVENT '.length)) as Record<
      string,
      unknown
    >
    expect(body.good).toBe('kept')
    expect(body.alsoGood).toBe(42)
    expect(body.bad).toBeUndefined()
    expect(body._unserialisable).toEqual(['bad'])
  })

  it('names every lost field, not just the first', () => {
    const line = captured('info', {
      one: cyclical(),
      two: cyclical(),
      fine: true,
    })
    const body = JSON.parse(line.slice('EVENT '.length)) as Record<
      string,
      unknown
    >
    expect(body._unserialisable).toEqual(['one', 'two'])
    expect(body.fine).toBe(true)
  })

  it('still says something when nothing at all can be serialised', () => {
    // A getter that throws, a proxy, a `toJSON` that does: the failure is not
    // in any one field, so the field-by-field pass fails too. Throwing here
    // would be the behaviour this function exists to stop.
    const hostile = {
      get boom(): never {
        throw new Error('no')
      },
    }
    let line = ''
    expect(() => {
      line = captured('info', hostile)
    }).not.toThrow()
    expect(line).toContain('_unserialisable')
  })
})

describe('a store build', () => {
  // What the Play and TestFlight builds are to this module: a bundle built
  // with `--dev false`, which Metro opens with `__DEV__=false`, and without
  // either of the flags a bench sets on the bundle it is going to read.
  beforeEach(() => {
    vi.stubGlobal('__DEV__', false)
    vi.stubEnv('MESSAGR_SEND_PROBE', '')
    vi.stubEnv('MESSAGR_WHOLE_LOG', '')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('writes nothing for an event outside the trace, at any level', () => {
    expect(
      linesWrittenBy(() => {
        logEvent('info', 'MESSAGR_ENTERED', { entered: true })
        logEvent('warn', 'MESSAGR_LIVE_STATE', { state: 'reconnecting' })
        logEvent('error', 'MESSAGR_RUNTIME_FAILED', { reason: 'boom' })
      }),
    ).toEqual([])
  })

  it('writes the decision on the backup offer', () => {
    expect(
      linesWrittenBy(() =>
        logEvent('info', 'MESSAGR_BACKUP_OFFER', {
          offer: true,
          backedUp: false,
          asked: false,
          received: true,
          unreadable: 'none',
        }),
      ),
    ).toEqual([
      'MESSAGR_BACKUP_OFFER {"offer":true,"backedUp":false,"asked":false,"received":true,"unreadable":"none"}',
    ])
  })

  it("writes a call's state without the call's identifier or its offer", () => {
    expect(
      linesWrittenBy(() =>
        logEvent('info', 'MESSAGR_CALL_STATE', {
          call: 'incomingInvite',
          callId: 'messagr-1726241234567-493021',
          autoAccept: false,
          offer: {
            type: 'offer',
            sdp: 'v=0\r\no=- 4611731400430051336 2 IN IP4 192.168.1.23\r\n',
          },
        }),
      ),
    ).toEqual([
      'MESSAGR_CALL_STATE {"call":"incomingInvite","autoAccept":false}',
    ])
  })

  it('withholds a reason that names an account, and says which field it withheld', () => {
    expect(
      linesWrittenBy(() =>
        logEvent('warn', 'MESSAGR_PUSH_NOT_REGISTERED', {
          reason: 'M_FORBIDDEN: @rabr642vve6v:messagr.eu may not add a pusher',
        }),
      ),
    ).toEqual(['MESSAGR_PUSH_NOT_REGISTERED {"_withheld":["reason"]}'])
  })

  it('writes a reason that is words and nothing else', () => {
    expect(
      linesWrittenBy(() => {
        logEvent('info', 'MESSAGR_PUSH_NOT_REGISTERED', {
          reason: 'notifications were not permitted',
        })
        logEvent('info', 'MESSAGR_PUSH_NOT_REGISTERED', {
          reason: 'Apple has not answered with a token yet',
        })
      }),
    ).toEqual([
      'MESSAGR_PUSH_NOT_REGISTERED {"reason":"notifications were not permitted"}',
      'MESSAGR_PUSH_NOT_REGISTERED {"reason":"Apple has not answered with a token yet"}',
    ])
  })

  it.each([
    ['an account', '@rabr642vve6v:messagr.eu'],
    ['a room', '!OGEhHVWSdvArJzumhm:messagr.eu'],
    ['an event', '$VKSfJkXhoGbEQDHcA_5ptO9MUYdxBEqqr7DVy-sMEYY'],
    ['a device', 'KMPLGEOJWD'],
    ['a token', 'syt_cmFicjY0MnZ2ZTZ2_VEbKXHVgAlpRVVGSUjMC_0dH1cJ'],
    ['an address', 'https://messagr.eu/_matrix/push/v1/notify'],
  ])('withholds %s from every kind of field it can arrive in', (_, value) => {
    expect(
      linesWrittenBy(() => {
        logEvent('info', 'MESSAGR_CALL_STATE', {
          call: value,
          autoAccept: value,
        })
        logEvent('info', 'MESSAGR_PUSH_NOT_REGISTERED', { reason: value })
      }),
    ).toEqual([
      'MESSAGR_CALL_STATE {"_withheld":["call","autoAccept"]}',
      'MESSAGR_PUSH_NOT_REGISTERED {"_withheld":["reason"]}',
    ])
  })

  it('writes how a call ended, down to the reason its hangup carried', () => {
    expect(
      linesWrittenBy(() =>
        logEvent('info', 'MESSAGR_CALL_STATE', {
          call: 'ended',
          reason: { ended: 'hangup', reason: 'user_hangup' },
        }),
      ),
    ).toEqual([
      'MESSAGR_CALL_STATE {"call":"ended","reason":{"ended":"hangup","reason":"user_hangup"}}',
    ])
  })

  it('withholds a field of the trace that cannot even be read, and does not throw', () => {
    // The rule the rest of this file is about holds here too: the report
    // must not take down what it reports on. A getter that throws costs its
    // own field.
    const hostile = {
      get reason(): never {
        throw new Error('no')
      },
    }
    expect(
      linesWrittenBy(() =>
        logEvent('warn', 'MESSAGR_PUSH_NOT_REGISTERED', hostile),
      ),
    ).toEqual(['MESSAGR_PUSH_NOT_REGISTERED {"_withheld":["reason"]}'])
  })

  it('writes what a notification woke, and why it could not look', () => {
    expect(
      linesWrittenBy(() => {
        logEvent('info', 'MESSAGR_WOKE', { drew: 'read', count: 2 })
        logEvent('info', 'MESSAGR_WOKE', {
          drew: 'nothing',
          reason: 'switched off',
        })
        logEvent('info', 'MESSAGR_WAKE_BLIND', {
          reason: 'this device holds no session',
        })
        logEvent('error', 'MESSAGR_WAKE_UNAVAILABLE', {
          reason:
            "No Firebase App '[DEFAULT]' has been created - call firebase.initializeApp()",
        })
      }),
    ).toEqual([
      'MESSAGR_WOKE {"drew":"read","count":2}',
      'MESSAGR_WOKE {"drew":"nothing","reason":"switched off"}',
      'MESSAGR_WAKE_BLIND {"reason":"this device holds no session"}',
      'MESSAGR_WAKE_UNAVAILABLE {"_withheld":["reason"]}',
    ])
  })

  it('writes what became of the pusher', () => {
    expect(
      linesWrittenBy(() => {
        logEvent('info', 'MESSAGR_PUSH_REGISTERED', {})
        logEvent('info', 'MESSAGR_PUSH_REMOVED', {})
      }),
    ).toEqual(['MESSAGR_PUSH_REGISTERED {}', 'MESSAGR_PUSH_REMOVED {}'])
  })

  it('writes the countdown of a call that is reconnecting', () => {
    expect(
      linesWrittenBy(() =>
        logEvent('warn', 'MESSAGR_CALL_STATE', {
          call: 'reconnecting',
          callId: 'messagr-1726241234567-493021',
          secondsLeft: 12,
        }),
      ),
    ).toEqual(['MESSAGR_CALL_STATE {"call":"reconnecting","secondsLeft":12}'])
  })

  it('writes where replacing the recovery key stopped, under the word replace', () => {
    // #284, found in review: a replacement that failed wrote no line at all.
    // It writes the acceptance's line, and `from` says it was a replacement.
    expect(
      linesWrittenBy(() =>
        logEvent('warn', 'MESSAGR_BACKUP_ACCEPT_FAILED', {
          from: 'replace',
          failedAt: 'thrownAfterPublishing',
          forgotten: false,
        }),
      ),
    ).toEqual([
      'MESSAGR_BACKUP_ACCEPT_FAILED {"from":"replace","failedAt":"thrownAfterPublishing","forgotten":false}',
    ])
  })

  it('writes which stores a backup reading could not open', () => {
    expect(
      linesWrittenBy(() =>
        logEvent('info', 'MESSAGR_BACKUP_OFFER', {
          offer: false,
          backedUp: false,
          asked: true,
          received: false,
          unreadable: 'commitment,asked',
        }),
      ),
    ).toEqual([
      'MESSAGR_BACKUP_OFFER {"offer":false,"backedUp":false,"asked":true,"received":false,"unreadable":"commitment,asked"}',
    ])
  })

  it('writes the decision on the backup offer once while it stays the same', () => {
    // #291. Build 135, a tester who had backed up, during a call: this very
    // line ten times in seventeen seconds, once for each sync cycle that
    // touched the open conversation. A telephone's log buffer holds 256 KiB,
    // and a line repeated pushes out the ones that would have explained
    // something.
    const decision = logWhenChanged('MESSAGR_BACKUP_OFFER')

    expect(
      linesWrittenBy(() => {
        for (let cycle = 0; cycle < 10; cycle += 1) {
          decision.log('info', {
            offer: false,
            backedUp: true,
            asked: true,
            received: true,
            unreadable: 'none',
          })
        }
      }),
    ).toEqual([
      'MESSAGR_BACKUP_OFFER {"offer":false,"backedUp":true,"asked":true,"received":true,"unreadable":"none"}',
    ])
  })

  it('writes the decision again as soon as what it says changes', () => {
    // The offer made, and then the question recorded: the second line is the
    // one that says the offer will not come back, and it must not be taken
    // for a repeat of the first.
    const decision = logWhenChanged('MESSAGR_BACKUP_OFFER')
    const offered = {
      offer: true,
      backedUp: false,
      asked: false,
      received: true,
      unreadable: 'none',
    }

    expect(
      linesWrittenBy(() => {
        decision.log('info', offered)
        decision.log('info', offered)
        decision.log('info', { ...offered, offer: false, asked: true })
        decision.log('info', { ...offered, offer: false, asked: true })
      }),
    ).toEqual([
      'MESSAGR_BACKUP_OFFER {"offer":true,"backedUp":false,"asked":false,"received":true,"unreadable":"none"}',
      'MESSAGR_BACKUP_OFFER {"offer":false,"backedUp":false,"asked":true,"received":true,"unreadable":"none"}',
    ])
  })

  it('writes the decision again after forgetting it, as opening a conversation does', () => {
    // The device suite opens a conversation and reads the decision that
    // follows its own tap (`e2e/conversation.ts`), and two openings can share
    // a launch. A line held back because the opening before already said it
    // would leave the second one waiting for nothing.
    const decision = logWhenChanged('MESSAGR_BACKUP_OFFER')
    const settled = {
      offer: false,
      backedUp: true,
      asked: true,
      received: true,
      unreadable: 'none',
    }

    expect(
      linesWrittenBy(() => {
        decision.log('info', settled)
        decision.forget()
        decision.log('info', settled)
      }),
    ).toEqual([
      'MESSAGR_BACKUP_OFFER {"offer":false,"backedUp":true,"asked":true,"received":true,"unreadable":"none"}',
      'MESSAGR_BACKUP_OFFER {"offer":false,"backedUp":true,"asked":true,"received":true,"unreadable":"none"}',
    ])
  })
})

describe('a build that is going to be read', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it.each([
    ['a debug bundle', true, '', ''],
    ['the probe build the device bench runs', false, '1', ''],
    ['a release bundle built with MESSAGR_WHOLE_LOG=1', false, '', '1'],
  ])('writes every event whole: %s', (_, dev, probe, whole) => {
    vi.stubGlobal('__DEV__', dev)
    vi.stubEnv('MESSAGR_SEND_PROBE', probe)
    vi.stubEnv('MESSAGR_WHOLE_LOG', whole)
    expect(
      linesWrittenBy(() =>
        logEvent('info', 'MESSAGR_CALL_POLL', {
          scope: '!OGEhHVWSdvArJzumhm:messagr.eu',
          carried: 2,
        }),
      ),
    ).toEqual([
      'MESSAGR_CALL_POLL {"scope":"!OGEhHVWSdvArJzumhm:messagr.eu","carried":2}',
    ])
  })
})

describe("matrix-js-sdk's own logger", () => {
  // Loggers the library makes itself, one for each test, through its own
  // `getChild`. The one `bootstrap.ts` hands over is shared by the whole
  // process: a test that changed it would change every test after it.

  /** Every line the library wrote to the console, whatever its level. */
  async function sdkLinesWrittenBy(
    gesture: () => Promise<void>,
  ): Promise<string[]> {
    const lines: string[] = []
    const methods = ['trace', 'debug', 'info', 'log', 'warn', 'error'] as const
    for (const method of methods) {
      vi.spyOn(console, method).mockImplementation((...written: unknown[]) => {
        lines.push(written.map(String).join(' '))
      })
    }
    await gesture()
    return lines
  }

  /**
   * The request the Play build 135 wrote a line about, made through the
   * library's own HTTP layer, which is handed `sdk` the way a client hands it
   * the logger it was made with (`client.js`).
   */
  async function aSync(sdk: Logger): Promise<void> {
    const http = new MatrixHttpApi(
      new TypedEventEmitter<HttpApiEvent, HttpApiEventHandlerMap>(),
      {
        baseUrl: 'https://messagr.eu',
        prefix: ClientPrefix.V3,
        onlyData: true,
        logger: sdk,
        fetchFn: async () => new Response('{}', { status: 200 }),
      },
    )
    await http.request(Method.Get, '/sync', { timeout: '30000' })
  }

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('writes nothing below warnings in a store build, from its logger or a child it makes later', async () => {
    // Read on the Play build 135, 14 September 2026, beside the trace and not
    // through it: `FetchHttpApi: --> GET
    // https://messagr.eu/_matrix/client/v3/sync?timeout=xxx`.
    vi.stubGlobal('__DEV__', false)
    vi.stubEnv('MESSAGR_SEND_PROBE', '')
    vi.stubEnv('MESSAGR_WHOLE_LOG', '')
    const sdk = sdkLogger.getChild('[a store build]')
    keepTheSdkToWarnings(sdk)
    expect(
      await sdkLinesWrittenBy(async () => {
        await aSync(sdk)
        const sync = sdk.getChild('[sync]')
        sync.trace('a trace')
        sync.debug('a debug line')
        sync.info('an info line')
      }),
    ).toEqual([])
  })

  it('still writes its warnings and errors in a store build', async () => {
    vi.stubGlobal('__DEV__', false)
    vi.stubEnv('MESSAGR_SEND_PROBE', '')
    vi.stubEnv('MESSAGR_WHOLE_LOG', '')
    const sdk = sdkLogger.getChild('[warnings]')
    keepTheSdkToWarnings(sdk)
    expect(
      await sdkLinesWrittenBy(async () => {
        sdk.warn('a warning')
        sdk.getChild('[sync]').error('an error')
      }),
    ).toEqual(['[warnings] a warning', '[warnings][sync] an error'])
  })

  it.each([
    ['a debug bundle', true, '', ''],
    ['the probe build the device bench runs', false, '1', ''],
    ['a release bundle built with MESSAGR_WHOLE_LOG=1', false, '', '1'],
  ])('writes every line it logs: %s', async (build, dev, probe, whole) => {
    vi.stubGlobal('__DEV__', dev)
    vi.stubEnv('MESSAGR_SEND_PROBE', probe)
    vi.stubEnv('MESSAGR_WHOLE_LOG', whole)
    const sdk = sdkLogger.getChild(`[${build}]`)
    keepTheSdkToWarnings(sdk)
    expect(await sdkLinesWrittenBy(() => aSync(sdk))).toContain(
      `[${build}] FetchHttpApi: --> GET https://messagr.eu/_matrix/client/v3/sync?timeout=xxx`,
    )
  })
})
