import React, { useEffect, useMemo, useState } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { createClient } from 'matrix-js-sdk'

import { runProbe } from 'react-native-matrix-crypto'

import {
  fetchBridgeStatus,
  type BridgeStatus,
} from './src/runtime/cryptoBridge'
import {
  firstJoinedRoom,
  receiveOneEncryptedMessage,
  runPanicProbe,
  type ProbeReport,
  runOutgoingPump,
  sendOneEncryptedMessage,
  startCryptoMachine,
  type CryptoPumpReport,
  type ReceiveReport,
  type SendReport,
} from './src/runtime/cryptoPump'
import { getErrorMessage } from './src/runtime/errors'
import { computeHermesReport, type HermesReport } from './src/runtime/hermes'
import { logEvent } from './src/runtime/log'
import { polyfillReport } from './src/runtime/bootstrap'
import { computeRuntimeGapReport } from './src/runtime/runtimeGaps'
import { computeNewArchitectureReport } from './src/runtime/newArchitecture'
import { sessionSecrets } from './src/runtime/deviceSecrets'
import { space, type as typeScale } from './src/design/tokens'
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
  const [bridge, setBridge] = useState<BridgeStatus | null>(null)
  const [entry, setEntry] = useState<EntryResult | null>(null)
  // Whether this launch minted the crypto store's passphrase or reopened
  // with the one it already held -- never the passphrase itself. A relaunch
  // that mints is a relaunch that lost every room key it had.
  const [storePassphrase, setStorePassphrase] = useState<
    'minted' | 'reused' | null
  >(null)
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

  useEffect(() => {
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
      const entered = await enterWithASession({
        secrets: sessionSecrets,
        poster: servicePoster,
        link: initialLink,
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
            const report = await runOutgoingPump(
              sessionClient,
              credentials,
              entered.entered && entered.claimed
                ? 'account-just-created'
                : 'restored-session',
            )
            pumpStatus = { outcome: 'ran', report }
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
            if (roomId !== null) {
              receiveStatus = await receiveOneEncryptedMessage(
                sessionClient,
                credentials,
                roomId,
              )
            }
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
        entry: entered,
        session: sessionStatus,
        pump: pumpStatus,
        send: sendStatus,
        received: receiveStatus,
      })
    }

    probeAndReport().catch((cause: unknown) => {
      logEvent('error', 'MESSAGR_RUNTIME_FAILED', { reason: String(cause) })
    })
  }, [architecture, hermes, gaps, client, storeDir, panicProbeRequested])

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
