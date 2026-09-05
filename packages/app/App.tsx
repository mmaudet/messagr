import React, { useEffect, useMemo, useRef, useState } from 'react'
import { AppState, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { createClient } from 'matrix-js-sdk'

import { runProbe } from 'react-native-matrix-crypto'

import {
  fetchBridgeStatus,
  type BridgeStatus,
} from './src/runtime/cryptoBridge'
import {
  claimOfferedHistory,
  evictMember,
  firstJoinedRoom,
  receiveOneEncryptedMessage,
  runPanicProbe,
  type ProbeReport,
  loadConversation,
  runOutgoingPump,
  sendOneEncryptedMessage,
  startCryptoMachine,
  startLiveSync,
  vouchForEntrant,
  type CryptoPumpReport,
  type FormMigration,
  type ReceiveReport,
  type RunningSyncLoop,
  type SendReport,
  type SyncLoopState,
} from './src/runtime/cryptoPump'
import { getErrorMessage } from './src/runtime/errors'
import { computeHermesReport, type HermesReport } from './src/runtime/hermes'
import { logEvent } from './src/runtime/log'
import { polyfillReport } from './src/runtime/bootstrap'
import { computeRuntimeGapReport } from './src/runtime/runtimeGaps'
import { computeNewArchitectureReport } from './src/runtime/newArchitecture'
import {
  promiseSecrets,
  sessionSecrets,
  signUpSecrets,
} from './src/runtime/deviceSecrets'
import { hasSeenPromise, rememberPromiseSeen } from './src/runtime/promiseSeen'
import { clearSignUp, isSignUpUnfinished } from './src/runtime/signUpMarker'
import {
  color,
  floors,
  notch,
  space,
  type as typeScale,
} from './src/design/tokens'
import { mergeTimeline, type TimelineEntry } from './src/timeline/mergeTimeline'
import { makePumpHttp } from './src/runtime/pump'
import { fetchJoinedMembers } from './src/runtime/encryptedSend'
import { theOtherMember, type VouchOutcome } from './src/runtime/vouch'
import type { EvictOutcome } from './src/runtime/evict'
import type { HistoryClaim } from './src/runtime/claimHistory'
import { Conversation } from './src/ui/Conversation'
import { FirstLaunch } from './src/ui/FirstLaunch'
import { Evict } from './src/ui/Evict'
import { Vouch } from './src/ui/Vouch'
import { t } from './src/copy'
import { NotchedButton } from './src/ui/NotchedButton'
import { notchLegFor } from './src/ui/notchGeometry'
import { enterWithASession, type EntryResult } from './src/runtime/entry'
import { initialLink } from './src/runtime/incomingLink'
import { servicePoster } from './src/runtime/servicePoster'
import {
  fetchSessionSyncStatus,
  makeSyncClient,
  type SessionSyncStatus,
} from './src/runtime/sessionSync'
import {
  computeTransportStatus,
  type TransportStatus,
} from './src/runtime/transportStatus'

/**
 * The pump's outcome, folded in at screen level exactly as `session` already
 * folds in `credentials === null` alongside `sessionSync.ts`'s own
 * `SessionSyncStatus` — `cryptoPump.ts` reports its two phases separately
 * (see its own documentation for why), so this is where they become one
 * thing this screen shows.
 */
type PumpStatus =
  | 'not-configured'
  | { readonly outcome: 'not-started'; readonly reason: string }
  | { readonly outcome: 'sync-required'; readonly reason: string }
  | { readonly outcome: 'ran'; readonly report: CryptoPumpReport }

/**
 * The scaffold's only screen. It exists to answer the two questions this
 * milestone has to answer on a device rather than in configuration: is the New
 * Architecture actually running, and does the crypto bridge actually load.
 * Nothing here is product surface, so the design tokens do not govern it yet.
 */
export function App({
  // Absent on any host that has not been updated to supply it (iOS has not
  // been, this ticket is Android-only): `computeCryptoMachineConfig` treats
  // an empty string as "no writable directory", which is exactly true here.
  storeDir = '',
}: {
  readonly storeDir?: string
}): React.JSX.Element {
  // Memoised because it is the effect's dependency. Recomputed each render it
  // would be a new object every time, the effect would re-run, its setState
  // would render again, and the bridge would be probed without end.
  const architecture = useMemo(() => computeNewArchitectureReport(), [])
  const gaps = useMemo(() => computeRuntimeGapReport(), [])
  const hermes = useMemo(() => computeHermesReport(), [])
  // No request is made: constructing a client is local. The address is a
  // reserved-TLD placeholder until account provisioning lands, so that a
  // real deployment's address is not carried in a public repository.
  const client = useMemo(
    () => computeTransportStatus(createClient, 'https://homeserver.invalid'),
    [],
  )
  // THE PROMISE GATES EVERYTHING BELOW IT, and that is the screen's whole
  // claim rather than an ordering preference. Its own words are "l'application
  // ne réclame rien avant d'avoir montré ce qu'elle promet" — so nothing may
  // reach the network, claim an invitation or ask a permission until somebody
  // has read it and tapped through.
  //
  // `null` means the keystore has not answered yet. It is a third state and
  // not a synonym for `false`: rendering the promise while the answer is
  // unknown would flash it at every relaunch of a device that has long since
  // seen it.
  const [promiseSeen, setPromiseSeen] = useState<boolean | null>(null)
  const [bridge, setBridge] = useState<BridgeStatus | null>(null)
  const [entry, setEntry] = useState<EntryResult | null>(null)
  // The conversation this application holds, derived from the room on every
  // launch rather than read from a copy on disk. See ADR-0006.
  const [conversation, setConversation] = useState<TimelineEntry[] | null>(null)
  // What the live sync loop is doing, shown rather than assumed. ADR-0007
  // names a loop that dies silently as worse than no loop, because the
  // screen keeps looking live.
  const [live, setLive] = useState<SyncLoopState | null>(null)
  const runningSyncRef = useRef<RunningSyncLoop | null>(null)
  // Set once by the launch effect, which is the only place that holds
  // everything a loop needs. Read by the foreground handler below, which
  // runs long after that effect has finished.
  const resumeSyncRef = useRef<(() => void) | null>(null)
  // Which loop the screen is currently listening to. See `beginLiveSync`.
  const liveGenerationRef = useRef(0)
  // The other person in this conversation, and the two halves of #34's
  // gesture. `party` is `null` for anything that is not a conversation of
  // two: vouching names one person, so it has nothing to offer a group.
  const [party, setParty] = useState<{
    readonly scope: string
    readonly other: string
  } | null>(null)
  const [vouch, setVouch] = useState<'idle' | 'working' | VouchOutcome>('idle')
  // Refs rather than state, and for one reason: the gesture's button lives
  // outside the effect that built the session, and re-rendering when a
  // client is stored would be a render nothing on screen depends on.
  const sessionClientRef = useRef<ReturnType<typeof createClient> | null>(null)
  const credentialsRef = useRef<{
    readonly baseUrl: string
    readonly accessToken: string
  } | null>(null)
  const [claimed, setClaimed] = useState<HistoryClaim | null>(null)
  const [evicted, setEvicted] = useState<'idle' | 'working' | EvictOutcome>(
    'idle',
  )
  const [selfUserId, setSelfUserId] = useState('')
  const [sending, setSending] = useState<'idle' | 'sending' | 'failed'>('idle')
  // Held rather than rebuilt: it closes over the session and the room, which
  // only the probe below knows. `useState` with a function needs the extra
  // wrapper, since a bare function would be read as an updater.
  const [sendMessage, setSendMessage] = useState<
    ((body: string) => void) | null
  >(null)
  // Whether this launch minted the crypto store's passphrase or reopened
  // with the one it already held -- never the passphrase itself. A relaunch
  // that mints is a relaunch that lost every room key it had.
  // Whether the passphrase sits at the accessibility a background wake needs.
  // ADR-0008. Reported whether or not the machine then started: it is the
  // difference between a device that can decrypt while its screen is off and
  // one that cannot, and it is invisible everywhere else.
  const [keystoreForm, setKeystoreForm] = useState<FormMigration | null>(null)
  const [storePassphrase, setStorePassphrase] = useState<
    'minted' | 'reused' | null
  >(null)
  // Whether this device still carries the marker saying its sign-up never
  // finished. Reported because it is the entitlement to the one destructive
  // call on the crypto surface, and a marker that never clears would leave
  // that call armed on every launch, forever.
  const [signUpState, setSignUpState] = useState<
    'unfinished' | 'complete' | null
  >(null)
  // What the notched button actually laid out at, reported from the device.
  // The shape is the brand's, so something has to be able to check it where
  // it renders rather than only where it is computed.
  const [geometry, setGeometry] = useState<{
    height: number
    leg: number
  } | null>(null)
  // #27's diagnostic, off in every ordinary build. A static read, because
  // that is the only shape babel's inliner replaces (sessionCredentials.ts
  // says the same about its four).
  const panicProbeRequested = useMemo(
    () => process.env.MESSAGR_PANIC_PROBE === '1',
    [],
  )
  const [probe, setProbe] = useState<ProbeReport | null>(null)
  const [session, setSession] = useState<
    SessionSyncStatus | 'not-configured' | null
  >(null)
  const [pump, setPump] = useState<PumpStatus | null>(null)
  const [send, setSend] = useState<SendReport | 'not-run' | null>(null)
  const [received, setReceived] = useState<ReceiveReport | 'not-run' | null>(
    null,
  )

  // BACKGROUNDING, AND WHY IT IS NOT LEFT TO CHANCE.
  //
  // A held-open poll does not survive the process being suspended: the
  // operating system takes the socket with it, and a loop left running comes
  // back waiting on a connection that will never answer -- alive by every
  // measure this code has, and receiving nothing. Ending the poll on the way
  // out and starting a fresh one on the way back turns that into one extra
  // round trip.
  //
  // The cleanup is also the unmount path, so a loop cannot outlive the screen
  // that shows its state.
  useEffect(() => {
    const pause = () => {
      runningSyncRef.current?.stop()
      runningSyncRef.current = null
    }
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') resumeSyncRef.current?.()
      else pause()
    })
    return () => {
      subscription.remove()
      pause()
    }
  }, [])

  // Asked once, before anything else. A keystore read and nothing more: no
  // network, which is what lets it run under the promise rather than after it.
  useEffect(() => {
    hasSeenPromise(promiseSecrets)
      .then(setPromiseSeen)
      .catch(() => setPromiseSeen(false))
  }, [])

  useEffect(() => {
    // Not started until the promise has been accepted. The effect re-runs when
    // it is, because `promiseSeen` is one of its dependencies — which is the
    // whole mechanism, and why it is listed there rather than read from a ref.
    if (promiseSeen !== true) return

    const probeAndReport = async (): Promise<void> => {
      const status = await fetchBridgeStatus(runProbe)
      setBridge(status)

      // Answers one question and does nothing else. The machine it creates
      // carries a made-up identity and its own store, so letting the normal
      // flow run afterwards would be driving a bridge configured for
      // somebody who does not exist.
      if (panicProbeRequested) {
        setProbe({ outcome: 'attempting', detail: 'calling encryptEvent' })
        const report = await runPanicProbe(
          { userId: '@probe:example.invalid', deviceId: 'PROBEDEVICE' },
          storeDir,
        )
        setProbe(report)
        logEvent('info', 'MESSAGR_PANIC_PROBE', { ...report })
        return
      }

      // No provisioned account: report it rather than attempt a sync that has
      // nothing to restore. This keeps the screen runnable for a developer
      // who has not run scripts/provision-bench-accounts.sh.
      // How this application comes to have a session: one kept from a
      // previous launch, or one obtained by spending the invitation it was
      // opened with. Nothing arrives from the build any more.
      let historyClaim: HistoryClaim | null = null
      const entered = await enterWithASession({
        secrets: sessionSecrets,
        poster: servicePoster,
        link: initialLink,
        signUp: signUpSecrets,
      })
      setEntry(entered)
      const credentials = entered.entered ? entered.session : null

      let sessionStatus: SessionSyncStatus | 'not-configured'
      let pumpStatus: PumpStatus
      let sendStatus: SendReport | 'not-run' = 'not-run'
      let receiveStatus: ReceiveReport | 'not-run' = 'not-run'
      if (credentials === null) {
        sessionStatus = 'not-configured'
        pumpStatus = 'not-configured'
      } else {
        const sessionClient = createClient(credentials)
        sessionClientRef.current = sessionClient
        credentialsRef.current = credentials
        // Started before the sync below, not after: see startCryptoMachine's
        // own documentation for why the ordering is load-bearing.
        const start = await startCryptoMachine(
          sessionClient,
          credentials,
          storeDir,
          cause =>
            logEvent('error', 'MESSAGR_TO_DEVICE_FEED_FAILED', {
              reason: getErrorMessage(cause),
            }),
        )

        // Outside the `started` test below, deliberately: the migration runs
        // before the store is opened, so it has an answer even on a launch
        // that then fails to start a machine at all.
        setKeystoreForm(start.passphraseForm)

        try {
          sessionStatus = await fetchSessionSyncStatus(
            makeSyncClient(sessionClient),
          )

          if (start.started) {
            setStorePassphrase(start.passphraseMinted ? 'minted' : 'reused')
          }

          if (!start.started) {
            pumpStatus = { outcome: 'not-started', reason: start.reason }
          } else if (!sessionStatus.synced) {
            pumpStatus = {
              outcome: 'sync-required',
              reason: sessionStatus.reason,
            }
          } else {
            // The entitlement to create this account's first cross-signing
            // identity, and the only launch that ever carries it. A claim
            // created the account seconds ago by spending a single-use
            // token, so no other device can have published an identity --
            // which is the fact the library cannot have and refuses to
            // guess. See crossSigningIdentity.ts.
            // THE ENTITLEMENT TO CREATE THIS ACCOUNT'S FIRST IDENTITY.
            //
            // A claim carries it outright: the account is seconds old, so
            // nothing can be overwritten. A restore carries it only when the
            // device still holds the sign-up marker, which says a previous
            // launch began a sign-up it may not have finished.
            //
            // Everything uncertain resolves to `restored-session`, which
            // creates nothing. See signUpMarker.ts.
            const entitlement =
              entered.entered && entered.claimed
                ? ('account-just-created' as const)
                : (await isSignUpUnfinished(signUpSecrets))
                  ? ('finishing-sign-up' as const)
                  : ('restored-session' as const)

            const report = await runOutgoingPump(
              sessionClient,
              credentials,
              entitlement,
            )
            pumpStatus = { outcome: 'ran', report }

            // Cleared only once a homeserver has acknowledged the identity,
            // which is exactly what `established` means here: the machine
            // reports holding one and reports no publication pending. Clearing
            // any earlier would strand a device that still needed to finish.
            if (report.identity.established) {
              await clearSignUp(signUpSecrets)
            }
            setSignUpState(
              (await isSignUpUnfinished(signUpSecrets))
                ? 'unfinished'
                : 'complete',
            )
            // Only once the keys are published: a message encrypted before
            // this device's own keys are on the server is one nobody can
            // ask about, let alone decrypt.
            sendStatus = await sendOneEncryptedMessage(
              sessionClient,
              credentials,
            )
            // Attempted whether or not this run's own send worked: what is
            // being read was written by somebody else, and one direction
            // failing should not hide the other. The room is the one the
            // send resolved, or the first joined room when there was no
            // send to resolve it.
            const roomId = sendStatus.sent
              ? sendStatus.roomId
              : await firstJoinedRoom(sessionClient)
            // THE LOOP THAT MAKES THIS A MESSENGER. ADR-0007.
            //
            // Started here, at the end of the launch path, for two reasons
            // that are one reason: everything above had to happen first.
            // matrix-js-sdk's own loop is stopped by now
            // (`fetchSessionSyncStatus`), so nothing else is consuming the
            // to-device messages that carry room keys; and this device's
            // keys are published, so a key sent in answer to what arrives
            // here can actually be claimed.
            //
            // The conversation is re-derived rather than merged out of the
            // sync response. The timeline stays the application's own state
            // (ADR-0005) and `loadConversation` is the one thing that knows
            // how to build it: the loop's job is to say *when*, not *what*.
            //
            // ONE SCREEN, AND FOR A FEW SECONDS SOMETIMES TWO LOOPS. `stop`
            // does not cancel the poll in flight -- nothing here can, see
            // `RunningSyncLoop.stop` -- so a loop stopped on the way to the
            // background may still hold a socket open when the application
            // comes back and starts its replacement. Its last word is
            // `stopped`, and it would land *after* the new loop had already
            // said `starting`: a screen reading `stopped` over a loop that is
            // running, which is the lie ADR-0007 names told the other way
            // round. So each loop is handed the generation it was started in,
            // and anything it says once superseded is dropped. A loop merely
            // paused has not been superseded, and its `stopped` still reaches
            // the screen, which is correct: it did stop.
            const beginLiveSync = () => {
              if (runningSyncRef.current !== null) return
              const generation = liveGenerationRef.current + 1
              liveGenerationRef.current = generation
              runningSyncRef.current = startLiveSync(
                sessionClient,
                tick => {
                  if (generation !== liveGenerationRef.current) return
                  if (!tick.cursorPersisted) {
                    // Survivable -- this launch stays live off the token it
                    // holds in memory -- but the next launch replays from
                    // wherever the keystore last accepted one, and that is
                    // not something to discover as a slow start.
                    logEvent('warn', 'MESSAGR_LIVE_CURSOR_LOST', {})
                  }
                  if (roomId === null) return
                  if (!tick.changedScopes.includes(roomId)) return
                  loadConversation(sessionClient, roomId)
                    .then(fresh =>
                      setConversation(held => mergeTimeline(held ?? [], fresh)),
                    )
                    .catch((cause: unknown) => {
                      // The cursor has already advanced past this, but the
                      // next poll that touches this conversation derives it
                      // whole again, so nothing is lost for good. Reported
                      // rather than swallowed: a screen that stopped
                      // updating under a loop still saying `running` is
                      // exactly the lie ADR-0007 names.
                      logEvent('warn', 'MESSAGR_LIVE_DERIVE_FAILED', {
                        reason: getErrorMessage(cause),
                      })
                    })
                },
                state => {
                  if (generation !== liveGenerationRef.current) return
                  setLive(state)
                  // Logged as well as rendered, for the reason every other
                  // probe here is: the emulator's screencap returns a blank
                  // frame, so the log is the only machine-readable evidence
                  // that the loop lived, reconnected, or stopped.
                  logEvent(
                    state === 'reconnecting' ? 'warn' : 'info',
                    'MESSAGR_LIVE_STATE',
                    { state },
                  )
                },
              )
            }
            if (roomId !== null) {
              receiveStatus = await receiveOneEncryptedMessage(
                sessionClient,
                credentials,
                roomId,
              )

              // THE CONVERSATION, DERIVED RATHER THAN STORED.
              //
              // ADR-0006: nothing decrypted reaches the disk, so this is
              // fetched and decrypted on every launch instead of read from a
              // second copy. It costs a round trip and it is why a device
              // holds no cleartext history.
              setSelfUserId(credentials.userId)

              // Who this conversation's gesture is for, and the passive half
              // of it. Both run before the timeline is built, so history
              // that arrives on this launch is history this launch can read:
              // `claimOfferedHistory` imports Megolm sessions, and
              // `loadConversation` below decrypts with whatever the store
              // then holds. The other order would show the gap and import
              // the key that closed it a moment later, with nothing on
              // screen changing until the next launch.
              const members = await fetchJoinedMembers(
                makePumpHttp(sessionClient),
                roomId,
              )
              const other = theOtherMember(members, credentials.userId)
              // Reported in the launch log below, not only rendered. A gap
              // that closed and a gap that never opened look identical on
              // screen -- both show a readable conversation -- so the only
              // way to tell "history arrived" from "the key came by some
              // other route" is to say which one happened.
              if (other !== null) {
                setParty({ scope: roomId, other })
                // Never throws: see claimHistory.ts for why a history that
                // did not arrive must not be a launch that did not finish.
                historyClaim = await claimOfferedHistory(
                  credentials,
                  roomId,
                  other,
                )
                setClaimed(historyClaim)
              }

              // Merged into whatever is held rather than replacing it: the
              // loop started above may already have derived this conversation,
              // and a launch that overwrote its result would be a race whose
              // loser the network picks.
              const derived = await loadConversation(sessionClient, roomId)
              setConversation(held => mergeTimeline(held ?? [], derived))

              setSendMessage(() => (body: string) => {
                setSending('sending')
                const deliver = async () => {
                  const sent = await sendOneEncryptedMessage(
                    sessionClient,
                    credentials,
                    body,
                  )
                  if (!sent.sent) {
                    setSending('failed')
                    return
                  }
                  setSending('idle')
                  const fresh = await loadConversation(sessionClient, roomId)
                  setConversation(held => mergeTimeline(held ?? [], fresh))
                }
                // A send that failed for a reason nothing here anticipated
                // still has to leave the composer usable. Reported on the
                // screen rather than swallowed.
                deliver().catch(() => setSending('failed'))
              })
            }

            // Started last, after the `Received` probe above has had its
            // rounds. That probe syncs with no cursor at all, so it cannot
            // take anything from the loop -- but the loop advances a cursor,
            // and a cursor moving past a to-device message is what tells the
            // homeserver to stop offering it. Reading the diagnostic first
            // keeps it a diagnostic. Outside the branch above, because an
            // account in no room still has device lists and to-device
            // messages to take, and a loop that only existed where there was
            // already something to read would leave a device invited a minute
            // later showing `not started` until somebody relaunched it.
            //
            // The delay costs nothing a person sees: the conversation on
            // screen was just derived whole, and the loop only matters for
            // what arrives after that.
            resumeSyncRef.current = beginLiveSync
            beginLiveSync()
          }
        } finally {
          // Nothing left to feed once this run is done: the sync above
          // already stopped matrix-js-sdk's own loop, and to-device messages
          // only ever arrive through it.
          if (start.started) start.unsubscribeToDevice()
        }
      }
      setSession(sessionStatus)
      setPump(pumpStatus)
      setSend(sendStatus)
      setReceived(receiveStatus)

      // Logged as well as rendered. The Android emulator's screencap returns a
      // blank frame regardless of what is on screen, so the log is the only
      // machine-readable evidence there, and it is what the Detox harness will
      // read rather than pixels.
      logEvent('info', 'MESSAGR_RUNTIME', {
        architecture,
        hermes,
        bridge: status,
        gaps,
        polyfills: polyfillReport,
        client,
        // NOT `entered` itself. `EntryResult.session` is a
        // `RestoreCredentials`, which carries the account's access token --
        // "whoever reads it is the account", as sessionStore.ts puts it. This
        // line used to log the whole thing, and the only reason no token ever
        // reached logcat is that the object also happened to be cyclical, so
        // the stringify threw and took the launch down with it. The accident
        // was doing the work of the rule; the rule is here now.
        entry: entered.entered
          ? { entered: true, claimed: entered.claimed, kept: entered.kept }
          : { entered: false, reason: entered.reason },
        session: sessionStatus,
        pump: pumpStatus,
        send: sendStatus,
        received: receiveStatus,
        history: historyClaim,
      })
    }

    probeAndReport().catch((cause: unknown) => {
      // The stack, not only the message. A launch failure reported as
      // "TypeError: cyclical structure in JSON object" names a symptom and
      // no location, and the first real device run of #34 spent its
      // diagnosis on exactly that. Reported through a second call so a
      // stack that is itself unserialisable cannot swallow the first.
      logEvent('error', 'MESSAGR_RUNTIME_FAILED', { reason: String(cause) })
      if (cause instanceof Error && typeof cause.stack === 'string') {
        logEvent('error', 'MESSAGR_RUNTIME_FAILED_WHERE', {
          stack: cause.stack.split('\n').slice(0, 8).join(' | '),
        })
      }
    })
  }, [
    architecture,
    hermes,
    gaps,
    client,
    storeDir,
    panicProbeRequested,
    promiseSeen,
  ])

  // The synced case computed once rather than repeated at each of its two
  // uses below: narrowing `session` inline in both the status and the
  // duration text was the same three-part guard written out twice.
  const synced =
    session !== null && session !== 'not-configured' && session.synced
      ? session
      : null

  // Same idiom as `synced` above: narrowed once rather than repeated at each
  // of this block's two uses.
  const ranPump =
    pump !== null && pump !== 'not-configured' && pump.outcome === 'ran'
      ? pump
      : null

  // BEFORE ANYTHING ELSE, AND WITHOUT A FLASH BETWEEN.
  //
  // While the keystore has not answered, the same ground the launch frame
  // paints, and nothing on it. The alternative — rendering the readout for the
  // handful of frames it takes to read one keystore entry — is precisely the
  // flash the launch frame exists to prevent, and it would show the diagnostic
  // screen to somebody who has not yet been told what this is.
  if (promiseSeen === null) {
    return (
      <SafeAreaProvider>
        <View style={styles.promiseGround} />
      </SafeAreaProvider>
    )
  }

  if (!promiseSeen) {
    return (
      <SafeAreaProvider>
        <FirstLaunch
          onBegin={() => {
            // Set first, kept second. A keystore that refuses must not leave
            // somebody stuck on a screen whose only action does nothing —
            // being shown the promise twice is the cost, and `promiseSeen.ts`
            // says why that is the right way round.
            setPromiseSeen(true)
            rememberPromiseSeen(promiseSecrets)
              .then(kept => {
                if (!kept) logEvent('warn', 'MESSAGR_PROMISE_NOT_KEPT', {})
              })
              .catch(() => logEvent('warn', 'MESSAGR_PROMISE_NOT_KEPT', {}))
          }}
        />
      </SafeAreaProvider>
    )
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.screen}>
        <ScrollView
          testID="diagnostic-scroll"
          contentContainerStyle={styles.content}>
          {probe !== null && (
            <View style={styles.block}>
              <Text style={styles.heading}>Panic probe (#27)</Text>
              <Text testID="panic-probe" style={styles.line}>
                {`${probe.outcome}: ${probe.detail}`}
              </Text>
            </View>
          )}

          {conversation !== null && sendMessage !== null && (
            <View style={styles.block}>
              <Conversation
                entries={conversation}
                selfUserId={selfUserId}
                onSend={sendMessage}
                sending={sending}
              />

              {/* #34's gesture, and only where it means something: a
                  conversation of two, where "the other person" names
                  somebody rather than being chosen by this application. */}
              {party !== null && sessionClientRef.current !== null && (
                <Vouch
                  entrantId={party.other}
                  hasHistory={conversation.length > 0}
                  state={vouch}
                  onVouch={() => {
                    const vouching = sessionClientRef.current
                    const held = credentialsRef.current
                    if (vouching === null || held === null) return
                    setVouch('working')
                    // The outcome is a value rather than a throw --
                    // `vouchFor` reports which step stopped -- so there is
                    // nothing here to catch, and the promise is deliberately
                    // left to settle into state.
                    vouchForEntrant(
                      vouching,
                      held,
                      party.scope,
                      party.other,
                    ).then(setVouch, () => {
                      setVouch({
                        vouched: false,
                        stage: 'assembling',
                        reason: 'the gesture could not be started',
                        promoted: false,
                      })
                    })
                  }}
                />
              )}

              {/* The mirror gesture, offered beside the one it undoes the
                  effect of. Same two-step shape, because removing somebody
                  cannot be undone either -- and the sentence it owes a
                  person is a different one. */}
              {party !== null && (
                <Evict
                  memberId={party.other}
                  state={evicted}
                  onEvict={() => {
                    const evicting = sessionClientRef.current
                    if (evicting === null) return
                    setEvicted('working')
                    evictMember(evicting, party.scope, party.other).then(
                      setEvicted,
                      () => {
                        setEvicted({
                          evicted: false,
                          stage: 'removing',
                          reason: 'the gesture could not be started',
                          rotated: false,
                        })
                      },
                    )
                  }}
                />
              )}

              {/* What the passive half found, when it found anything. A
                  refusal for an untrusted sender is the one worth saying:
                  what fixes it is verifying them, and this screen is where
                  somebody would otherwise just see a gap. */}
              {claimed !== null && claimed.claimed !== 'none' && (
                <Text testID="history-claim" style={styles.line}>
                  {claimed.claimed === 'imported'
                    ? t('vouch_history_arrived')
                    : claimed.kind === 'untrusted'
                      ? t('vouch_history_untrusted')
                      : `${claimed.kind}: ${claimed.reason}`}
                </Text>
              )}
            </View>
          )}

          {/* Everything below is the instrument, not the product. It is what
              proves the increment on a device, and it goes when the product
              has screens of its own to prove it. */}
          <View style={styles.block}>
            <Text style={styles.heading}>New Architecture</Text>
            <Text testID="arch-enabled" style={styles.line}>
              {`enabled: ${architecture.enabled}`}
            </Text>
            <Text testID="arch-bridgeless" style={styles.line}>
              {`bridgeless: ${architecture.bridgeless}`}
            </Text>
            <Text testID="arch-turbomodules" style={styles.line}>
              {`turboModules: ${architecture.turboModules}`}
            </Text>
            <Text testID="arch-fabric" style={styles.line}>
              {`fabric: ${architecture.fabric}`}
            </Text>
            <Text testID="js-engine" style={styles.line}>
              {computeEngineLabel(hermes)}
            </Text>
          </View>

          <View style={styles.block}>
            <Text style={styles.heading}>Runtime gaps</Text>
            <Text testID="runtime-gaps" style={styles.line}>
              {gaps.missing.length === 0
                ? 'none'
                : // The reason, not just the name: a gap that stayed open
                  // because a module would not load reads differently from one
                  // no provider covers, and the difference is what gets fixed.
                  polyfillReport.stillMissing
                    .map(gap => `${gap.name} (${gap.reason})`)
                    .join(', ')}
            </Text>
          </View>

          <View style={styles.block}>
            <Text style={styles.heading}>Matrix transport</Text>
            <Text testID="client-status" style={styles.line}>
              {computeTransportLabel(client)}
            </Text>
          </View>

          <View style={styles.block}>
            <Text style={styles.heading}>Entry</Text>
            <Text testID="entry-status" style={styles.line}>
              {computeEntryLabel(entry)}
            </Text>
          </View>

          <View style={styles.block}>
            <Text style={styles.heading}>Session sync</Text>
            <Text testID="session-status" style={styles.line}>
              {computeSessionLabel(session)}
            </Text>
            <Text testID="session-sync-duration" style={styles.line}>
              {computeSyncDurationLabel(synced)}
            </Text>
          </View>

          <View style={styles.block}>
            <Text style={styles.heading}>Crypto bridge</Text>
            <Text testID="bridge-status" style={styles.line}>
              {computeBridgeLabel(bridge)}
            </Text>
            <Text testID="crypto-store" style={styles.line}>
              {computeStoreLabel(storePassphrase)}
            </Text>
          </View>

          <View style={styles.block}>
            <Text style={styles.heading}>Crypto pump</Text>
            <Text testID="pump-status" style={styles.line}>
              {computePumpStatusLabel(pump)}
            </Text>
            <Text testID="pump-device-keys" style={styles.line}>
              {computePumpDeviceKeysLabel(ranPump)}
            </Text>
            <Text testID="pump-one-time-keys" style={styles.line}>
              {computePumpOneTimeKeysLabel(ranPump)}
            </Text>
            <Text testID="pump-sharing-strategy" style={styles.line}>
              {computeSharingStrategyLabel(ranPump)}
            </Text>
            <Text testID="pump-identity" style={styles.line}>
              {computeIdentityLabel(ranPump)}
            </Text>
            <Text testID="pump-signup" style={styles.line}>
              {computeSignUpLabel(signUpState)}
            </Text>
          </View>

          <View style={styles.block}>
            <Text style={styles.heading}>Encrypted send</Text>
            <Text testID="send-status" style={styles.line}>
              {computeSendLabel(send)}
            </Text>
            <Text testID="send-event" style={styles.line}>
              {computeSendEventLabel(send)}
            </Text>
            <Text testID="send-control" style={styles.line}>
              {computeControlLabel(send)}
            </Text>
            <Text testID="send-tamper" style={styles.line}>
              {computeTamperLabel(send)}
            </Text>
          </View>

          <View style={styles.block}>
            <Text style={styles.heading}>Received</Text>
            <Text testID="received-body" style={styles.line}>
              {computeReceivedLabel(received)}
            </Text>
            <Text testID="received-sender" style={styles.line}>
              {computeClaimedSenderLabel(received)}
            </Text>
          </View>
          {/* Appended, and new blocks must be. Every block here was added at
              the end of the readout, and the suite's assertions assume that
              order: Detox does not scroll on its own, so inserting this one
              in the middle pushed the crypto readout below the fold and
              failed six assertions on a change that touched none of them. */}
          <View style={styles.block}>
            <Text style={styles.heading}>Brand geometry</Text>
            <NotchedButton
              label="Action principale"
              testID="notched-button"
              onGeometry={setGeometry}
            />
            <Text testID="notch-touch-target" style={styles.line}>
              {computeTouchTargetLabel(geometry)}
            </Text>
            <Text testID="notch-proportion" style={styles.line}>
              {computeNotchLabel(geometry)}
            </Text>
          </View>

          <View style={styles.block}>
            <Text style={styles.heading}>Live sync</Text>
            <Text testID="live-sync-status" style={styles.line}>
              {computeLiveSyncLabel(live)}
            </Text>
          </View>

          <View style={styles.block}>
            <Text style={styles.heading}>Keystore form</Text>
            <Text testID="keystore-form" style={styles.line}>
              {computeKeystoreFormLabel(keystoreForm)}
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    </SafeAreaProvider>
  )
}

// One small label function per probe, named `compute…` to match this
// module's own idiom (computeTransportStatus, computeSessionCredentials):
// each is a pure derivation from a status already held in state, not a
// generic formatter forcing three differently-shaped probes through one
// abstraction.

/**
 * Where the passphrase's keystore accessibility stands. ADR-0008.
 *
 * The five outcomes are not five ways of saying the same thing, so none of
 * them collapses into another: `current` and `rewritten` both end at the
 * right place but only one of them touched a secret; `deferred` is a launch
 * that was right not to try; `failed` is the one that leaves a device unable
 * to decrypt while its screen is off, and it is the only one worth an alarm.
 */
function computeKeystoreFormLabel(migration: FormMigration | null): string {
  if (migration === null) return 'keystore form: —'
  const said = {
    current: 'already after first unlock',
    rewritten: 'moved to after first unlock',
    'nothing-stored': 'nothing stored yet, the first write moves it',
    deferred: 'not attempted, this launch could not read the old form',
    failed: `NOT MOVED: ${migration.reason ?? 'no reason given'}`,
  }[migration.outcome]
  // Whether it will be attempted again, said only when it will be: a settled
  // migration that also says "settled" is noise on a line read at a glance.
  return `keystore form: ${said}${migration.marked ? '' : ', unmarked'}`
}

/**
 * What the loop is doing, in the words ADR-0007 asks for. `not started` is
 * its own answer rather than a synonym for stopped: a launch that never got
 * far enough to start one and a loop that ended are different faults, and
 * only the second one means something went wrong with the loop.
 */
function computeLiveSyncLabel(state: SyncLoopState | null): string {
  if (state === null) return 'live sync: not started'
  return `live sync: ${
    {
      starting: 'starting, no answer from the homeserver yet',
      running: 'running',
      reconnecting: 'reconnecting',
      stopped: 'stopped',
    }[state]
  }`
}

function computeTransportLabel(status: TransportStatus): string {
  return status.created
    ? `client created, ${status.homeserver}`
    : `not created: ${status.reason}`
}

/**
 * Says which of the three ways in produced this session, because they are
 * not interchangeable: an invitation is single-use, so "restored" and
 * "claimed" describe different amounts of remaining road.
 */
function computeEntryLabel(entry: EntryResult | null): string {
  if (entry === null) {
    return 'entry: probing'
  }
  if (!entry.entered) {
    return `entry: none (${entry.reason})`
  }
  if (!entry.claimed) {
    return 'entry: session restored'
  }
  return entry.kept === false
    ? 'entry: invitation claimed, BUT THE SESSION WAS NOT KEPT'
    : 'entry: invitation claimed'
}

function computeSessionLabel(
  status: SessionSyncStatus | 'not-configured' | null,
): string {
  if (status === null) {
    return 'probing'
  }
  if (status === 'not-configured') {
    return 'no session: see Entry above'
  }
  return status.synced
    ? `synced, ${status.roomCount} room(s)`
    : `not synced: ${status.reason}`
}

function computeSyncDurationLabel(
  synced: Extract<SessionSyncStatus, { synced: true }> | null,
): string {
  return synced === null
    ? 'cold-start sync: —'
    : `cold-start sync: ${synced.durationMs}ms`
}

function computeBridgeLabel(status: BridgeStatus | null): string {
  if (status === null) {
    return 'probing'
  }
  return status.loaded
    ? `loaded, core ${status.coreVersion}`
    : `absent: ${status.reason}`
}

function computeEngineLabel(report: HermesReport): string {
  if (!report.present) {
    // Named rather than left blank: a release build that quietly fell back to
    // JSC is exactly what this line exists to catch.
    return 'engine: not Hermes'
  }
  return report.version === null
    ? 'engine: Hermes'
    : `engine: Hermes ${report.version}`
}

/**
 * Deliberately a fixed string in the case that matters. Detox matches on
 * rendered text (see e2e/boot.test.ts on why not testIDs), so a verdict that
 * embedded the event id would be unassertable: the homeserver mints a
 * different one every run. The id goes on its own line below.
 */
function computeSendLabel(status: SendReport | 'not-run' | null): string {
  if (status === null) {
    return 'encrypted send: probing'
  }
  if (status === 'not-run') {
    return 'encrypted send: not run'
  }
  return status.sent
    ? 'encrypted send: sent'
    : `encrypted send: not sent (${status.reason})`
}

function computeSendEventLabel(status: SendReport | 'not-run' | null): string {
  if (status === null || status === 'not-run' || !status.sent) {
    return 'event: —'
  }
  return `event: ${status.eventId} in ${status.roomId}`
}

/**
 * The positive control, and the line below is worth nothing without it: a
 * machine that cannot decrypt anything refuses a tampered ciphertext for a
 * reason that has nothing to do with the tampering.
 */
function computeControlLabel(status: SendReport | 'not-run' | null): string {
  if (status === null || status === 'not-run' || !status.sent) {
    return 'intact ciphertext: —'
  }
  return status.intactDecrypted
    ? 'intact ciphertext: decrypted'
    : 'intact ciphertext: NOT decrypted'
}

function computeTamperLabel(status: SendReport | 'not-run' | null): string {
  if (status === null || status === 'not-run' || !status.sent) {
    return 'tampered ciphertext: —'
  }
  // The word this line exists for is "refused". A product that encrypts
  // correctly and accepts anything on the way back has built an expensive
  // encoding, and nothing on this screen would otherwise say so.
  if (status.tamper === 'not-attempted') {
    return 'tampered ciphertext: not attempted'
  }
  return status.tamper === 'refused'
    ? 'tampered ciphertext: refused'
    : 'tampered ciphertext: ACCEPTED'
}

function computeReceivedLabel(
  status: ReceiveReport | 'not-run' | null,
): string {
  if (status === null) {
    return 'decrypted: probing'
  }
  if (status === 'not-run') {
    return 'decrypted: not run'
  }
  return status.received
    ? `decrypted: ${status.body}`
    : `decrypted: nothing (${status.reason})`
}

/**
 * Says "claims", and says it every time, because decrypting an event does
 * not establish who wrote it. The sender is transport metadata read off the
 * event; verifying a device would not change that, and a screen that printed
 * it as a fact would be the first place this product started lying about its
 * own trust model.
 */
function computeClaimedSenderLabel(
  status: ReceiveReport | 'not-run' | null,
): string {
  if (status === null || status === 'not-run' || !status.received) {
    return 'claims to be from: —'
  }
  return `claims to be from: ${status.claimedSender} (unauthenticated)`
}

/**
 * Read out of the machine, not out of a changelog. 0.4.0 shares room keys by
 * identity once a machine holds a cross-signing identity of its own, and a
 * device no identity vouches for then stops receiving keys entirely. This
 * application creates no such identity, so it should say device-based — and
 * saying it on screen is what makes that a fact continuous integration
 * checks rather than an assumption.
 */
function computeSharingStrategyLabel(
  ran: Extract<PumpStatus, { outcome: 'ran' }> | null,
): string {
  return ran === null
    ? 'room keys shared: —'
    : `room keys shared: ${ran.report.sharingStrategy}`
}

function computeIdentityLabel(
  ran: Extract<PumpStatus, { outcome: 'ran' }> | null,
): string {
  if (ran === null) {
    return 'signing identity: —'
  }
  const { identity } = ran.report
  return identity.established
    ? `signing identity: ${identity.how}`
    : `signing identity: none (${identity.reason})`
}

/**
 * The store's own continuity, which nothing else on this readout shows. A
 * relaunch reporting "minted" would mean the passphrase did not survive, and
 * therefore that this device opened a new, empty store and lost every room
 * key the old one held.
 */
function computeStoreLabel(state: 'minted' | 'reused' | null): string {
  if (state === null) return 'store passphrase: —'
  return state === 'minted'
    ? 'store passphrase: minted for this device'
    : 'store passphrase: reused, the store reopened'
}

/**
 * The touch-target floor is the one floor no provenance rule can reach: a
 * button's height is geometry, not a token. So it is asserted here, against
 * the height the device actually gave it rather than the height the style
 * asked for.
 */
function computeTouchTargetLabel(
  geometry: { height: number; leg: number } | null,
): string {
  if (geometry === null) return 'touch target: —'
  return geometry.height >= floors.touchTargetMin
    ? 'touch target: met'
    : `touch target: MISSED (${geometry.height.toFixed(1)}pt)`
}

/**
 * That the cut followed the height rather than a constant. A fixed leg looks
 * deliberate at one size and like a mistake at every other, and a screenshot
 * would not tell the two apart.
 */
function computeNotchLabel(
  geometry: { height: number; leg: number } | null,
): string {
  if (geometry === null) return 'notch: —'
  const expected = notchLegFor(geometry.height)
  const held = Math.abs(geometry.leg - expected) < 0.01
  return held
    ? `notch: derived from height (${notch.button.size}pt at 48pt)`
    : `notch: WRONG (${geometry.leg.toFixed(2)} where ${expected.toFixed(2)} was due)`
}

/**
 * Whether the entitlement to create an identity is still on this device.
 *
 * "unfinished" after a launch that published successfully would mean the
 * marker did not clear, and that every later launch stays entitled to the one
 * destructive call on the crypto surface -- which is the failure this whole
 * mechanism exists to prevent, so it is worth being able to see.
 */
function computeSignUpLabel(state: 'unfinished' | 'complete' | null): string {
  if (state === null) return 'sign-up: —'
  return state === 'complete'
    ? 'sign-up: complete, the marker is cleared'
    : 'sign-up: unfinished, this device may still finish it'
}

function computePumpStatusLabel(status: PumpStatus | null): string {
  if (status === null) {
    return 'probing'
  }
  if (status === 'not-configured') {
    return 'no session: see Entry above'
  }
  if (status.outcome === 'ran') {
    return 'ran'
  }
  return `not started: ${status.reason}`
}

function computePumpDeviceKeysLabel(
  ran: Extract<PumpStatus, { outcome: 'ran' }> | null,
): string {
  return ran === null
    ? 'device keys published: —'
    : `device keys published: ${ran.report.deviceKeysVerified}`
}

/**
 * Counted on the server rather than inferred from this run's own uploads: a
 * warm store queues none because it needs none, and the old signal read
 * false there while the server held a full set.
 */
function computePumpOneTimeKeysLabel(
  ran: Extract<PumpStatus, { outcome: 'ran' }> | null,
): string {
  if (ran === null) {
    return 'one-time keys on server: —'
  }
  const count = ran.report.oneTimeKeysOnServer
  return count === null
    ? 'one-time keys on server: unknown'
    : `one-time keys on server: ${count > 0 ? 'yes' : 'none'}`
}

// Values are literal rather than tokenised on purpose: this screen is
// scaffolding, not product surface. Anything that survives into a real screen
// must come from design/tokens.json, per interface invariant 11.
const styles = StyleSheet.create({
  // The launch frame's own colour, so the handover between them shows nothing.
  promiseGround: {
    flex: 1,
    backgroundColor: color.brand.ink900,
  },
  // Scrolls, and no longer centres. This readout has grown one block per
  // ticket -- architecture, engine, gaps, transport, session, pump, send,
  // received -- and its last lines had reached past the bottom of a phone.
  // Detox reads rendered text, so a line pushed off-screen is a line the
  // suite reports as absent: the round trip's sender assertion failed for
  // that reason and for no other, which is a false negative about the trust
  // model, the one place this project can least afford one.
  screen: { flex: 1 },
  // The bottom padding was 48, which is not on the scale and never could be:
  // the file forbids its own intermediate values outright. `xxl` is the
  // answer the scale gives, and a screen that needed more would be a
  // composition error rather than a missing token.
  content: { padding: space.xl, paddingBottom: space.xxl },
  block: { marginBottom: space.xxl },
  // Spread rather than picked apart: size, leading, weight and tracking
  // travel together, and separating them is how a line-height floor gets
  // broken without anyone deciding to break it.
  heading: { ...typeScale.titleMd, marginBottom: space.s },
  line: typeScale.body,
})
