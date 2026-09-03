import React, { useEffect, useMemo, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'

import { runProbe } from 'react-native-matrix-crypto'

import {
  fetchBridgeStatus,
  type BridgeStatus,
} from './src/runtime/cryptoBridge'
import { logEvent } from './src/runtime/log'
import { computeNewArchitectureReport } from './src/runtime/newArchitecture'

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
  const [bridge, setBridge] = useState<BridgeStatus | null>(null)

  useEffect(() => {
    const probeAndReport = async (): Promise<void> => {
      const status = await fetchBridgeStatus(runProbe)
      setBridge(status)
      // Logged as well as rendered. The Android emulator's screencap returns a
      // blank frame regardless of what is on screen, so the log is the only
      // machine-readable evidence there, and it is what the Detox harness will
      // read rather than pixels.
      logEvent('info', 'MESSAGR_RUNTIME', { architecture, bridge: status })
    }

    probeAndReport().catch((cause: unknown) => {
      logEvent('error', 'MESSAGR_RUNTIME_FAILED', { reason: String(cause) })
    })
  }, [architecture])

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.screen}>
        <View style={styles.block}>
          <Text style={styles.heading}>New Architecture</Text>
          <Text testID="arch-enabled" style={styles.line}>
            enabled: {String(architecture.enabled)}
          </Text>
          <Text testID="arch-bridgeless" style={styles.line}>
            bridgeless: {String(architecture.bridgeless)}
          </Text>
          <Text testID="arch-turbomodules" style={styles.line}>
            turboModules: {String(architecture.turboModules)}
          </Text>
          <Text testID="arch-fabric" style={styles.line}>
            fabric: {String(architecture.fabric)}
          </Text>
        </View>

        <View style={styles.block}>
          <Text style={styles.heading}>Crypto bridge</Text>
          <Text testID="bridge-status" style={styles.line}>
            {bridge === null
              ? 'probing'
              : bridge.loaded
                ? `loaded, core ${bridge.coreVersion}`
                : `absent: ${bridge.reason}`}
          </Text>
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  )
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
