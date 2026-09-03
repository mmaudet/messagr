/**
 * Whether the New Architecture is actually running, read from the markers the
 * runtime sets rather than from build configuration.
 *
 * Configuration can say `newArchEnabled=true` while a stale build runs the
 * legacy one, and the crypto bridge this application depends on is a JSI turbo
 * module with no legacy mode: it does not merely degrade there, it does not
 * load. So the question has to be asked of the runtime.
 */
export interface NewArchitectureReport {
  /** The bridgeless runtime is active. */
  readonly bridgeless: boolean
  /**
   * The turbo module system is available.
   *
   * This is React Native's own test, copied from
   * `ReactNativeFeatureFlagsBase`, where it guards a message the framework
   * declines to log "in the legacy architecture". Bridgeless implies turbo
   * modules; a proxy on its own is also sufficient.
   */
  readonly turboModules: boolean
  /** The Fabric renderer is installed. */
  readonly fabric: boolean
  /**
   * The New Architecture is running.
   *
   * Deliberately equal to `turboModules` and not to `turboModules && fabric`:
   * the module system is what React Native itself uses to tell the two
   * architectures apart, and it is what the crypto bridge needs. Fabric is
   * reported beside it as corroboration, not folded into the verdict.
   */
  readonly enabled: boolean
}

interface RuntimeMarkers {
  readonly RN$Bridgeless?: unknown
  readonly __turboModuleProxy?: unknown
  readonly nativeFabricUIManager?: unknown
}

export function computeNewArchitectureReport(
  scope: object = globalThis,
): NewArchitectureReport {
  const markers = scope as RuntimeMarkers

  const bridgeless = markers.RN$Bridgeless === true
  const turboModules = bridgeless || markers.__turboModuleProxy != null
  const fabric = markers.nativeFabricUIManager != null

  return { bridgeless, turboModules, fabric, enabled: turboModules }
}
