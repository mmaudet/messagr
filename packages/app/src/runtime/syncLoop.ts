// Type-only, for the reason `outgoingPumpCycle.ts` states at length:
// importing react-native-matrix-crypto as a value installs its native JSI
// bootstrap as a side effect, which crashes Vitest's parser. The real
// functions are bound by the caller.
import type { SyncDelta } from 'react-native-matrix-crypto'

import {
  drainOutgoingRequests,
  type CryptoMachine,
  type HttpRequester,
} from './pump'
import type { SecretStore } from './sessionStore'
import { readSyncCursor, writeSyncCursor } from './syncCursor'
import type { EncryptionSliceFn } from './syncDelta'
import {
  fetchSync,
  readChangedScopes,
  readNextBatch,
  LONG_POLL_TIMEOUT_MS,
} from './syncResponse'

/**
 * The application's own live sync loop. ADR-0007.
 *
 * A long-polling `/sync` through the same authenticated-request escape hatch
 * the outgoing pump uses, reduced by `encryptionSlice` and fed to the bridge.
 * It is not matrix-js-sdk's loop and it takes nothing of the SDK's room model
 * back: what it hands the caller is a list of conversation spaces that moved,
 * and the caller re-derives its own timeline from them (ADR-0005).
 *
 * Feeding the bridge is not a detail of this loop, it is the point of it. A
 * message arriving is two things — an event in a timeline and a Megolm
 * session in a to-device message — and only the second makes the first
 * readable. Before this loop existed, to-device messages reached the machine
 * through matrix-js-sdk's loop for the length of a single launch. Now they
 * reach it here, for as long as the application is open.
 */

/**
 * What the loop is doing, in the words the screen uses.
 *
 * `starting` covers the first poll, which has not yet proven the homeserver
 * answers at all. `reconnecting` is the honest word for every failure this
 * loop retries — a network that changed, a homeserver that restarted, a poll
 * cut short — because from here they are one thing: nothing is arriving and
 * the loop is trying again. `stopped` is emitted whatever ends the loop,
 * including a fault nothing here anticipated, so that a screen can never look
 * live over a loop that is gone.
 */
export type SyncLoopState = 'starting' | 'running' | 'reconnecting' | 'stopped'

/** What one completed poll observed. */
export interface SyncTick {
  /** The joined conversation spaces that moved, possibly none. */
  readonly changedScopes: readonly string[]
  /**
   * Whether the cursor this poll ended at reached the keystore. `false` is
   * survivable — the loop carries on from the token it holds in memory, and
   * only the next launch replays — but it is not silent.
   */
  readonly cursorPersisted: boolean
}

/** What this loop needs from the crypto machine, beyond `pump.ts`'s own. */
export interface SyncLoopMachine extends CryptoMachine {
  readonly receiveSyncChanges: (delta: SyncDelta) => Promise<void>
}

export interface SyncLoopDeps {
  readonly http: HttpRequester
  readonly machine: SyncLoopMachine
  readonly encryptionSlice: EncryptionSliceFn
  readonly cursorStore: SecretStore
  readonly onTick: (tick: SyncTick) => void
  readonly onState: (state: SyncLoopState) => void
  /** Injected so tests need no timers, and so backoff is observable. */
  readonly sleep: (ms: number) => Promise<void>
  readonly timeoutMs?: number
}

export interface RunningSyncLoop {
  /**
   * Ends the loop after the poll in flight returns. The poll itself is not
   * cancelled: `HttpRequester` carries no abort signal, and giving it one to
   * save at most one round trip would widen the seam the pump shares. What a
   * stopped loop does with a response that arrives late is discard it, which
   * is why the cursor is not advanced for it — those events arrive again.
   */
  readonly stop: () => void
  /** Resolves once the loop has actually ended and said so. */
  readonly stopped: Promise<void>
}

/**
 * How long to wait after a failure before polling again: one second,
 * doubling, capped.
 *
 * The cap matters more than the growth. ADR-0007 names spinning and stopping
 * as the two ways a loop mishandles a network that went away; unbounded
 * backoff is the second one wearing the first one's clothes, a loop that is
 * technically alive and will next try in an hour.
 */
const FIRST_BACKOFF_MS = 1_000
const MAX_BACKOFF_MS = 30_000

function nextBackoff(previous: number): number {
  return previous === 0
    ? FIRST_BACKOFF_MS
    : Math.min(previous * 2, MAX_BACKOFF_MS)
}

/**
 * Whether a failure looks like the homeserver refusing the request rather
 * than failing to answer it.
 *
 * Duck-typed on a numeric `status`, the same way `pump.ts`'s own adapter
 * duck-types the SDK's `httpStatus`: `HttpRequester` is an interface, and a
 * caller is entitled to supply a transport that throws something else.
 *
 * 400 only. A 401 or 403 is about who is asking, which no amount of dropping
 * a cursor will fix; a 5xx is a server that is unwell and will recover.
 */
function isRefusedRequest(cause: unknown): boolean {
  return (cause as { status?: unknown } | null)?.status === 400
}

/**
 * Starts polling. Returns immediately; the loop runs until `stop`.
 *
 * THE ORDER IS THE CORRECTNESS. Each poll feeds the machine, sends whatever
 * that queued, and only then advances the cursor. A cursor written first
 * would be a claim that events had been handled by a launch that was about
 * to be killed before handling them, and ADR-0007 names exactly that: "a
 * token that advances past unprocessed events loses them. Neither crashes."
 *
 * The drain is not optional either. A sync that reports a changed device list
 * queues a `keys_query` the machine needs answered before it can encrypt to
 * that device; a loop that fetched but never sent would go quietly blind to
 * every device that appeared after launch.
 */
export function startSyncLoop(deps: SyncLoopDeps): RunningSyncLoop {
  const {
    http,
    machine,
    encryptionSlice,
    cursorStore,
    onTick,
    onState,
    sleep,
    timeoutMs = LONG_POLL_TIMEOUT_MS,
  } = deps

  let stopping = false

  const run = async (): Promise<void> => {
    try {
      onState('starting')
      let cursor = await readSyncCursor(cursorStore)
      let backoff = 0

      while (!stopping) {
        try {
          const sync = await fetchSync(http, cursor, timeoutMs)
          // Checked here rather than only at the top: a poll held open for
          // thirty seconds can outlive the decision to stop, and what came
          // back belongs to a loop that no longer exists.
          if (stopping) break

          await machine.receiveSyncChanges(encryptionSlice(sync))
          await drainOutgoingRequests(http, machine)

          const next = readNextBatch(sync)
          let cursorPersisted = true
          if (next !== null) {
            cursor = next
            cursorPersisted = await writeSyncCursor(cursorStore, next)
          }

          backoff = 0
          onState('running')
          onTick({ changedScopes: readChangedScopes(sync), cursorPersisted })
        } catch (cause: unknown) {
          if (stopping) break
          onState('reconnecting')

          // A CURSOR THE HOMESERVER WILL NEVER ACCEPT.
          //
          // The only part of this request the loop chose is the cursor, so a
          // refusal is first of all a claim about that. It happens for
          // ordinary reasons: a homeserver restored from a backup no longer
          // knows the token it issued, and a cursor outlives the account that
          // earned it -- nothing clears the keystore entry when a second
          // invitation is claimed on an install that already held a session.
          //
          // Retried unchanged, that is `reconnecting` for good on a device
          // that is online with credentials that are fine: the loop would be
          // alive, trying, and permanently wrong. Dropping the cursor costs
          // one replay, which is the recoverable direction, and the next poll
          // that works writes a good one over it. Exactly one immediate retry
          // -- if the refusal was about something else, the retry carries no
          // cursor, this branch does not fire again, and it backs off like
          // any other failure.
          if (cursor !== null && isRefusedRequest(cause)) {
            cursor = null
            continue
          }

          // Everything else is the same failure from here: nothing arrived
          // and the cursor did not move, so the events this poll would have
          // carried are still waiting on the server. Retrying from the same
          // token is what makes that true.
          backoff = nextBackoff(backoff)
          await sleep(backoff)
        }
      }
    } finally {
      onState('stopped')
    }
  }

  return { stop: () => (stopping = true), stopped: run() }
}
