import { by, device, element, expect as detoxExpect, waitFor } from 'detox'

/**
 * The boot contract, asserted on a real device rather than in configuration.
 *
 * Everything here was verified by hand first, screenshot by screenshot. This
 * suite exists so that the next change does not have to be.
 *
 * Assertions match on the rendered text rather than on a testID with
 * `toHaveText`. Under the New Architecture the latter finds the view and
 * reads a null string from it on Android, so it fails on a correct screen.
 * Matching the text asserts the same thing: that the value reached the
 * display.
 */
describe('boot', () => {
  // Jest's per-test testTimeout (jest.config.js) does not cover beforeAll:
  // hooks fall back to Jest's own 5000ms default unless given one here. A
  // cold launch that restores a session and syncs against a real homeserver
  // routinely takes longer than that.
  beforeAll(async () => {
    // Opened BY the invitation, which is how a real person arrives: the
    // application carries no session of its own any more, so this url is the
    // only thing that gives it one. A launch without it would reach a screen
    // saying so, correctly, and every assertion below would fail for that
    // reason rather than for anything they are about.
    await device.launchApp({
      newInstance: true,
      url: process.env.MESSAGR_INVITATION_LINK,
      delete: true,
    })
  }, 120000)

  it('enters by spending the invitation it was opened with', async () => {
    // The first launch of a freshly installed application: no session kept,
    // so the link is claimed. `delete: true` above is what makes that true
    // rather than accidental -- it clears the keystore entry a previous run
    // would have left.
    await waitFor(element(by.text('entry: invitation claimed')))
      .toBeVisible()
      .withTimeout(60000)
  })

  it('runs on the New Architecture', async () => {
    // The crypto bridge is a JSI turbo module with no legacy mode, so this is
    // a precondition for everything below rather than a nice-to-have.
    await detoxExpect(element(by.text('enabled: true'))).toBeVisible()
    await detoxExpect(element(by.text('fabric: true'))).toBeVisible()
  })

  it('runs on Hermes rather than a JSC fallback', async () => {
    // Asserted as a negative rather than against the version the label
    // carries: that version moves with every React Native upgrade, while
    // "not Hermes" is exactly the regression worth catching. The build-time
    // half of this lives in scripts/assert-hermes-bytecode.sh, which reads
    // the release APK; this half reads the engine that actually answered.
    await detoxExpect(element(by.id('js-engine'))).toBeVisible()
    await detoxExpect(element(by.text('engine: not Hermes'))).not.toBeVisible()
  })

  it('leaves no runtime gap open', async () => {
    await detoxExpect(element(by.id('runtime-gaps'))).toBeVisible()
    await detoxExpect(element(by.text('none'))).toBeVisible()
  })

  it('creates a Matrix client', async () => {
    // Reported as created only when the transport carries no crypto backend
    // of its own, so this also asserts the single-implementation invariant of
    // ADR-0001.
    await detoxExpect(
      element(by.text('client created, https://homeserver.invalid')),
    ).toBeVisible()
  })

  it('loads the crypto bridge across the JSI boundary', async () => {
    await detoxExpect(
      element(by.text('loaded, core 0.1.0+emit.f6ddf39b')),
    ).toBeVisible()
  })

  it('restores a session and syncs against a real homeserver', async () => {
    // waitFor rather than an immediate assertion: this is the one status on
    // screen that depends on a network round trip. The room count is exact,
    // not a loose match, because scripts/provision-bench-accounts.sh always
    // invites the provisioned account into exactly one room.
    //
    // This is also what keeps Detox's own synchronization usable at all:
    // restoreAndSync stops the client once this first sync lands, rather
    // than leaving matrix-js-sdk's long-polling loop running underneath it.
    // Left running, Detox's network-idle tracker never sees the app go
    // quiet, and launchApp above hangs forever on "Network is busy, with 1
    // in-flight calls" instead of failing on anything the app did — watched
    // failing exactly that way before the client was stopped.
    await waitFor(element(by.text('synced, 1 room(s)')))
      .toBeVisible()
      .withTimeout(30000)
  })

  it('measures the cold-start sync duration', async () => {
    // The exact figure is not asserted, only that one was recorded: that is
    // this ticket's baseline requirement, and the number itself will move
    // with the network and the account's room history.
    await detoxExpect(element(by.id('session-sync-duration'))).toBeVisible()
    await detoxExpect(element(by.text('cold-start sync: —'))).not.toBeVisible()
  })

  it("publishes this device's identity and one-time keys", async () => {
    // Runs after the session sync above, not concurrently with it: the pump
    // only starts once that sync has landed (App.tsx), so this waits on the
    // same network dependency the previous test already resolved, plus the
    // pump's own round trips (a drain, a raw sync fetch, a second drain, and
    // an independent /keys/query verifying what the drains actually sent).
    await waitFor(element(by.text('device keys published: true')))
      .toBeVisible()
      .withTimeout(30000)
    // Asked of the server, not of this run. The count itself is not
    // asserted: it falls as keys are claimed and rises as they are
    // replenished, and pinning a number would be pinning a moment.
    await detoxExpect(
      element(by.text('one-time keys on server: yes')),
    ).toBeVisible()
  })

  it('gives the account it just created a signing identity of its own', async () => {
    // Created, not published or resumed: this launch spent the invitation, so
    // the account is seconds old and has never had one. The three words are
    // deliberately different on screen because they are very different
    // events, and only one of them may ever happen to an account.
    await detoxExpect(
      element(by.text('signing identity: created')),
    ).toBeVisible()
  })

  it('shares room keys by identity once one vouches for this device', async () => {
    // 0.4.0 collects recipients by identity (MSC4153) for a machine holding a
    // cross-signing identity of its own, instead of sharing with every
    // unblacklisted device. This is the observable consequence of the line
    // above, read out of the machine rather than taken from the release
    // notes -- and it was `device-based` here until the account had an
    // identity to be vouched for by.
    await detoxExpect(
      element(by.text('room keys shared: identity-based')),
    ).toBeVisible()
  })

  it('encrypts a message and sends it into the room', async () => {
    // The event id itself is not asserted: it is minted by the homeserver and
    // differs every run. What is asserted is that the line says a send
    // happened at all -- a status of "not sent: ..." or "not run" is a
    // failure this test has to fail on, and an earlier version of it passed
    // on both.
    // A fixed string, because the event id differs every run and Detox
    // matches rendered text exactly. The id is rendered on its own line,
    // which this asserts is present but does not pin.
    await waitFor(element(by.text('encrypted send: sent')))
      .toBeVisible()
      .withTimeout(30000)
    await detoxExpect(element(by.id('send-event'))).toBeVisible()
    await detoxExpect(element(by.text('event: —'))).not.toBeVisible()
  })

  it('decrypts its own intact ciphertext, which is the control', async () => {
    // Without this the refusal below proves nothing: a machine that cannot
    // decrypt anything refuses a tampered ciphertext too, for a reason that
    // has nothing to do with the tampering.
    await waitFor(element(by.text('intact ciphertext: decrypted')))
      .toBeVisible()
      .withTimeout(30000)
  })

  it('refuses a ciphertext with one character changed', async () => {
    // The whole difference between end-to-end encryption and an expensive
    // encoding. Asserted on the refusal, and separately on the acceptance
    // never appearing, because a screen that failed to render this line at
    // all would otherwise pass the first assertion by absence.
    await waitFor(element(by.text('tampered ciphertext: refused')))
      .toBeVisible()
      .withTimeout(30000)
    await detoxExpect(
      element(by.text('tampered ciphertext: ACCEPTED')),
    ).not.toBeVisible()
  })
})
