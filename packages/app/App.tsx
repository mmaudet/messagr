import React, { useEffect, useMemo, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
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
import { computeSessionCredentials } from './src/runtime/sessionCredentials'
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
  // Read once: the four MESSAGR_SESSION_* values are baked into the bundle at
  // build time (babel.config.js), not read live, so there is nothing here a
  // dependency array could usefully react to.
  const credentials = useMemo(() => computeSessionCredentials(), [])
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

          if (!start.started) {
            pumpStatus = { outcome: 'not-started', reason: start.reason }
          } else if (!sessionStatus.synced) {
            pumpStatus = {
              outcome: 'sync-required',
              reason: sessionStatus.reason,
            }
          } else {
            const report = await runOutgoingPump(sessionClient, credentials)
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
        session: sessionStatus,
        pump: pumpStatus,
        send: sendStatus,
        received: receiveStatus,
      })
    }

    probeAndReport().catch((cause: unknown) => {
      logEvent('error', 'MESSAGR_RUNTIME_FAILED', { reason: String(cause) })
    })
  }, [
    architecture,
    hermes,
    gaps,
    client,
    credentials,
    storeDir,
    panicProbeRequested,
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

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.screen}>
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

function computeSessionLabel(
  status: SessionSyncStatus | 'not-configured' | null,
): string {
  if (status === null) {
    return 'probing'
  }
  if (status === 'not-configured') {
    return 'not configured: set MESSAGR_SESSION_* env vars'
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

function computePumpStatusLabel(status: PumpStatus | null): string {
  if (status === null) {
    return 'probing'
  }
  if (status === 'not-configured') {
    return 'not configured: set MESSAGR_SESSION_* env vars'
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

function computePumpOneTimeKeysLabel(
  ran: Extract<PumpStatus, { outcome: 'ran' }> | null,
): string {
  return ran === null
    ? 'one-time keys published: —'
    : `one-time keys published: ${ran.report.oneTimeKeysPublished}`
}

// Values are literal rather than tokenised on purpose: this screen is
// scaffolding, not product surface. Anything that survives into a real screen
// must come from design/tokens.json, per interface invariant 11.
const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', padding: 24 },
  block: { marginBottom: 32 },
  heading: { fontSize: 17, fontWeight: '600', marginBottom: 8 },
  line: { fontSize: 14.5, lineHeight: 21 },
})
