import React, { useEffect, useMemo, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { createClient } from 'matrix-js-sdk'

import { runProbe } from 'react-native-matrix-crypto'

import {
  fetchBridgeStatus,
  type BridgeStatus,
} from './src/runtime/cryptoBridge'
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
 * The scaffold's only screen. It exists to answer the two questions this
 * milestone has to answer on a device rather than in configuration: is the New
 * Architecture actually running, and does the crypto bridge actually load.
 * Nothing here is product surface, so the design tokens do not govern it yet.
 */
export function App(): React.JSX.Element {
  // Memoised because it is the effect's dependency. Recomputed each render it
  // would be a new object every time, the effect would re-run, its setState
  // would render again, and the bridge would be probed without end.
  const architecture = useMemo(() => computeNewArchitectureReport(), [])
  const gaps = useMemo(() => computeRuntimeGapReport(), [])
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
  const [session, setSession] = useState<
    SessionSyncStatus | 'not-configured' | null
  >(null)

  useEffect(() => {
    const probeAndReport = async (): Promise<void> => {
      const status = await fetchBridgeStatus(runProbe)
      setBridge(status)

      // No provisioned account: report it rather than attempt a sync that has
      // nothing to restore. This keeps the screen runnable for a developer
      // who has not run scripts/provision-bench-accounts.sh.
      let sessionStatus: SessionSyncStatus | 'not-configured'
      if (credentials === null) {
        sessionStatus = 'not-configured'
      } else {
        sessionStatus = await fetchSessionSyncStatus(
          makeSyncClient(createClient(credentials)),
        )
      }
      setSession(sessionStatus)

      // Logged as well as rendered. The Android emulator's screencap returns a
      // blank frame regardless of what is on screen, so the log is the only
      // machine-readable evidence there, and it is what the Detox harness will
      // read rather than pixels.
      logEvent('info', 'MESSAGR_RUNTIME', {
        architecture,
        bridge: status,
        gaps,
        polyfills: polyfillReport,
        client,
        session: sessionStatus,
      })
    }

    probeAndReport().catch((cause: unknown) => {
      logEvent('error', 'MESSAGR_RUNTIME_FAILED', { reason: String(cause) })
    })
  }, [architecture, gaps, client, credentials])

  // The synced case computed once rather than repeated at each of its two
  // uses below: narrowing `session` inline in both the status and the
  // duration text was the same three-part guard written out twice.
  const synced =
    session !== null && session !== 'not-configured' && session.synced
      ? session
      : null

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.screen}>
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

// Values are literal rather than tokenised on purpose: this screen is
// scaffolding, not product surface. Anything that survives into a real screen
// must come from design/tokens.json, per interface invariant 11.
const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', padding: 24 },
  block: { marginBottom: 32 },
  heading: { fontSize: 17, fontWeight: '600', marginBottom: 8 },
  line: { fontSize: 14.5, lineHeight: 21 },
})
