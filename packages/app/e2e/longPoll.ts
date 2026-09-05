/**
 * Telling Detox that one request is meant to stay open.
 *
 * ADR-0007 names this as the first piece of work under the live sync loop
 * rather than an afterthought, and it is the exact problem ADR-0005 walked
 * around: Detox's network-idle tracker treats an in-flight request as an
 * application that has not settled, so a long poll makes `launchApp` hang on
 * "Network is busy, with 1 in-flight calls" forever. The boot suite has
 * watched that happen, back when matrix-js-sdk's own loop was left running.
 *
 * The choice ADR-0007 leaves open is between telling the suite and suspending
 * the loop for tests. This is the first, and it is the one worth having: a
 * suite that ran against an application with its defining behaviour switched
 * off would be green about a product nobody ships.
 *
 * It is a launch argument rather than `device.setURLBlacklist`, because the
 * loop starts inside the launch this has to survive — a blacklist installed
 * after `launchApp` returned would be installed after the call it was meant
 * to rescue had already hung.
 *
 * Everything else stays tracked. Only `/sync` is expected to stay open, and
 * every other request this application makes is still something Detox should
 * wait for.
 */
export const IGNORING_THE_LIVE_POLL = {
  // Anchored at both ends with `.*` because Android matches the pattern
  // against the whole URL, and the real one carries a homeserver in front and
  // a timeout and cursor behind.
  detoxURLBlacklistRegex: ['.*/_matrix/client/v3/sync.*'],
}
