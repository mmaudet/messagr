import { by, device, element, expect as detoxExpect, waitFor } from 'detox'

import { IGNORING_THE_LIVE_POLL } from './longPoll'
import { SCROLL, seeId, seeText } from './readout'

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
      // The live sync loop starts inside this launch and holds a poll open.
      // See longPoll.ts: without this, `launchApp` never returns.
      launchArgs: IGNORING_THE_LIVE_POLL,
    })
  }, 120000)

  it('enters by spending the invitation it was opened with', async () => {
    // The first launch of a freshly installed application: no session kept,
    // so the link is claimed. `delete: true` above is what makes that true
    // rather than accidental -- it clears the keystore entry a previous run
    // would have left.
    await waitFor(element(by.text('entry: invitation claimed')))
      .toExist()
      .withTimeout(60000)
    await seeText('entry: invitation claimed')
  })

  it('runs on the New Architecture', async () => {
    // The crypto bridge is a JSI turbo module with no legacy mode, so this is
    // a precondition for everything below rather than a nice-to-have.
    await seeText('enabled: true')
    await seeText('fabric: true')
  })

  it('runs on Hermes rather than a JSC fallback', async () => {
    // Asserted as a negative rather than against the version the label
    // carries: that version moves with every React Native upgrade, while
    // "not Hermes" is exactly the regression worth catching. The build-time
    // half of this lives in scripts/assert-hermes-bytecode.sh, which reads
    // the release APK; this half reads the engine that actually answered.
    await seeId('js-engine')
    await detoxExpect(element(by.text('engine: not Hermes'))).not.toBeVisible()
  })

  it('leaves no runtime gap open', async () => {
    await seeId('runtime-gaps')
    await seeText('none')
  })

  it('creates a Matrix client', async () => {
    // Reported as created only when the transport carries no crypto backend
    // of its own, so this also asserts the single-implementation invariant of
    // ADR-0001.
    await seeText('client created, https://homeserver.invalid')
  })

  it('loads the crypto bridge across the JSI boundary', async () => {
    await seeText('loaded, core 0.1.0+emit.f6ddf39b')
  })

  it('restores a session and syncs against a real homeserver', async () => {
    // waitFor rather than an immediate assertion: this is the one status on
    // screen that depends on a network round trip. The room count is exact,
    // not a loose match, because scripts/provision-bench-accounts.sh always
    // invites the provisioned account into exactly one room.
    //
    // restoreAndSync still stops matrix-js-sdk's client once this first
    // sync lands, and now for a second reason: the application's own loop
    // (ADR-0007) takes over from here, and two loops polling one account
    // would race for the to-device messages that carry room keys.
    //
    // Detox's network-idle tracker used to be the reason. It no longer is —
    // `/sync` is blacklisted at launch (longPoll.ts) — but the failure it
    // caused is worth keeping written down: with a long poll tracked,
    // launchApp hangs forever on "Network is busy, with 1 in-flight calls"
    // instead of failing on anything the app did, watched failing exactly
    // that way.
    await waitFor(element(by.text('synced, 1 room(s)')))
      .toExist()
      .withTimeout(30000)
    await seeText('synced, 1 room(s)')
  })

  it('measures the cold-start sync duration', async () => {
    // The exact figure is not asserted, only that one was recorded: that is
    // this ticket's baseline requirement, and the number itself will move
    // with the network and the account's room history.
    await seeId('session-sync-duration')
    await detoxExpect(element(by.text('cold-start sync: —'))).not.toBeVisible()
  })

  it("publishes this device's identity and one-time keys", async () => {
    // Runs after the session sync above, not concurrently with it: the pump
    // only starts once that sync has landed (App.tsx), so this waits on the
    // same network dependency the previous test already resolved, plus the
    // pump's own round trips (a drain, a raw sync fetch, a second drain, and
    // an independent /keys/query verifying what the drains actually sent).
    await waitFor(element(by.text('device keys published: true')))
      .toExist()
      .withTimeout(30000)
    await seeText('device keys published: true')
    // Asked of the server, not of this run. The count itself is not
    // asserted: it falls as keys are claimed and rises as they are
    // replenished, and pinning a number would be pinning a moment.
    await seeText('one-time keys on server: yes')
  })

  it("shows the conversation, with this account's own message in it", async () => {
    // The pump sent one message during boot, so the conversation is not
    // empty by the time this looks. It is this account's own, which is why
    // no "se présente comme" line accompanies it: nothing is claimed about a
    // message this device encrypted itself.
    await seeText('encrypted by the bridge, sent by the application')
  })

  it('lets a person write a message and see it arrive', async () => {
    // The criterion the whole screen exists for, and the one no unit test can
    // reach: type, send, and find it in the conversation afterwards.
    const written = `écrit à la main ${Date.now()}`
    await element(SCROLL).scrollTo('top')
    // `replaceText`, not `typeText`: the emulator's input method cannot
    // translate accented characters into key events, and fails with a message
    // about key events rather than about the accent. Setting the field
    // directly is what Espresso itself suggests, and it is closer to what a
    // person does anyway -- nobody types a message one key event at a time
    // while a test watches.
    await element(by.id('conversation-input')).replaceText(written)
    await element(by.id('conversation-send')).tap()

    // Generous: this encrypts, shares a room key if the session needs one,
    // sends, and then reads the room back.
    await waitFor(element(by.text(written)))
      .toExist()
      .withTimeout(60000)
    await seeText(written)
  })

  it('carries the brand geometry at a size the device gave it', async () => {
    // The notch is a CSS clip path in the prototype and React Native has
    // none, so the shape is drawn. A unit test can check the path against
    // the original polygon -- it does -- but not that a real layout produced
    // a real height for it to follow. These two lines are computed on the
    // device from what it actually measured.
    //
    // The touch-target floor is asserted here and nowhere else it could be:
    // a button's height is geometry, so no token-provenance rule reaches it.
    await seeText('touch target: met')
    await seeText('notch: derived from height (16pt at 48pt)')
  })

  it('gives the account it just created a signing identity of its own', async () => {
    // Created, not published or resumed: this launch spent the invitation, so
    // the account is seconds old and has never had one. The three words are
    // deliberately different on screen because they are very different
    // events, and only one of them may ever happen to an account.
    await seeText('signing identity: created')
  })

  it('shares room keys by identity once one vouches for this device', async () => {
    // 0.4.0 collects recipients by identity (MSC4153) for a machine holding a
    // cross-signing identity of its own, instead of sharing with every
    // unblacklisted device. This is the observable consequence of the line
    // above, read out of the machine rather than taken from the release
    // notes -- and it was `device-based` here until the account had an
    // identity to be vouched for by.
    await seeText('room keys shared: identity-based')
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
      .toExist()
      .withTimeout(30000)
    await seeText('encrypted send: sent')
    await seeId('send-event')
    await detoxExpect(element(by.text('event: —'))).not.toBeVisible()
  })

  it('decrypts its own intact ciphertext, which is the control', async () => {
    // Without this the refusal below proves nothing: a machine that cannot
    // decrypt anything refuses a tampered ciphertext too, for a reason that
    // has nothing to do with the tampering.
    await waitFor(element(by.text('intact ciphertext: decrypted')))
      .toExist()
      .withTimeout(30000)
    await seeText('intact ciphertext: decrypted')
  })

  it('refuses a ciphertext with one character changed', async () => {
    // The whole difference between end-to-end encryption and an expensive
    // encoding. Asserted on the refusal, and separately on the acceptance
    // never appearing, because a screen that failed to render this line at
    // all would otherwise pass the first assertion by absence.
    await waitFor(element(by.text('tampered ciphertext: refused')))
      .toExist()
      .withTimeout(30000)
    await seeText('tampered ciphertext: refused')
    await detoxExpect(
      element(by.text('tampered ciphertext: ACCEPTED')),
    ).not.toBeVisible()
  })
})
