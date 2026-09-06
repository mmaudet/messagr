import { by, device, element, expect as detoxExpect, waitFor } from 'detox'

import { IGNORING_THE_LIVE_POLL } from './longPoll'
import { NOTIFICATIONS_GRANTED } from './permissions'
import { acceptThePromise } from './promise'
import {
  forgetTheLog,
  syncedSession,
  whatItMeasured,
  whatItReported,
  whatTheLoopReported,
  type GeometryReport,
  type RuntimeReport,
} from './reported'

/**
 * The launch, read from what the application says about itself.
 *
 * # It used to read the screen, and that was the mistake
 *
 * Every probe was rendered into a scrolling readout and this file asserted on
 * the words. Which meant every assertion was really an assertion about scroll
 * position. Four continuous-integration failures were paid for it, and all
 * four were correct behaviour reported as a product failure: a block inserted
 * rather than appended, a focusable button pulling the readout down to reach
 * it, and a label rendered exactly right and merely not 75 per cent visible.
 *
 * The readout is gone with #105: it was the application before there were
 * screens, and nobody installing Messagr should ever have seen it. What
 * survives is the half that actually found the defects -- one line of
 * structured JSON. Reading that is not a workaround for the screen's removal;
 * it is what this suite should have read all along. It cannot be scrolled
 * off, cannot be truncated by a layout, and says the same thing whatever the
 * product's screens become.
 *
 * # Read once, asserted many times
 *
 * The report is written when the launch effect finishes, so there is one of
 * it. Reading it per test would be re-parsing the same line and would let a
 * test pass against a *later* launch than the one its neighbours saw.
 *
 * # Two tests still read the screen, and they are the right two
 *
 * Typing a message and seeing it arrive is the criterion the screen exists
 * for, and no log line can stand in for it.
 */
describe('boot', () => {
  let report: RuntimeReport
  let shape: GeometryReport

  // Jest's per-test testTimeout (jest.config.js) does not cover beforeAll:
  // hooks fall back to Jest's own 5000ms default unless given one here. A
  // cold launch that restores a session and syncs against a real homeserver
  // routinely takes longer than that.
  beforeAll(async () => {
    // Cleared before the launch, not after: a previous run's report is the
    // same shape as this one's, and reading it would be a green suite about
    // an application that never started.
    forgetTheLog()
    // Opened BY the invitation, which is how a real person arrives: the
    // application carries no session of its own any more, so this url is the
    // only thing that gives it one. A launch without it would reach a screen
    // saying so, correctly, and every assertion below would fail for that
    // reason rather than for anything they are about.
    await device.launchApp({
      newInstance: true,
      // See permissions.ts: a system dialog over the application would fail
      // every assertion after it, for a reason none of them is about.
      permissions: NOTIFICATIONS_GRANTED,
      url: process.env.MESSAGR_INVITATION_LINK,
      delete: true,
      // The live sync loop starts inside this launch and holds a poll open.
      // See longPoll.ts: without this, `launchApp` never returns.
      launchArgs: IGNORING_THE_LIVE_POLL,
    })
    // `delete: true` cleared the keystore, so the promise is shown again and
    // nothing below it has started. See promise.ts.
    //
    // It is also where the geometry is measured: the promise screen's action
    // is a real `NotchedButton`, so accepting the promise is what makes the
    // shape observable.
    await acceptThePromise()
    shape = await whatItMeasured()
    report = await whatItReported()
  }, 180000)

  it('enters by spending the invitation it was opened with', () => {
    // The first launch of a freshly installed application: no session kept,
    // so the link is claimed. `delete: true` above is what makes that true
    // rather than accidental -- it clears the keystore entry a previous run
    // would have left.
    expect(report.entry.entered).toBe(true)
    expect(report.entry.claimed).toBe(true)
  })

  it('runs on the New Architecture', () => {
    // The crypto bridge is a JSI turbo module with no legacy mode, so this is
    // a precondition for everything below rather than a nice-to-have.
    expect(report.architecture.enabled).toBe(true)
    expect(report.architecture.fabric).toBe(true)
    expect(report.architecture.bridgeless).toBe(true)
    expect(report.architecture.turboModules).toBe(true)
  })

  it('runs on Hermes rather than a JSC fallback', () => {
    // Asserted as presence rather than against a version: the version moves
    // with every React Native upgrade, while "not Hermes" is exactly the
    // regression worth catching. The build-time half lives in
    // scripts/assert-hermes-bytecode.sh, which reads the release APK; this
    // half reads the engine that actually answered.
    expect(report.hermes.present).toBe(true)
  })

  it('leaves no runtime gap open', () => {
    expect(report.gaps.missing).toEqual([])
  })

  it('creates a Matrix client', () => {
    // Reported as created only when the transport carries no crypto backend
    // of its own, so this also asserts the single-implementation invariant of
    // ADR-0001.
    expect(report.client.created).toBe(true)
    expect(report.client.homeserver).toBe('https://homeserver.invalid')
  })

  it('loads the crypto bridge across the JSI boundary', () => {
    expect(report.bridge.loaded).toBe(true)
    expect(report.bridge.coreVersion).toBe('0.1.0+emit.f6ddf39b')
  })

  it('restores a session and syncs against a real homeserver', () => {
    // The room count is exact, not a loose match, because
    // scripts/provision-bench-accounts.sh always invites the provisioned
    // account into exactly one room.
    //
    // restoreAndSync still stops matrix-js-sdk's client once this first sync
    // lands, and now for a second reason: the application's own loop
    // (ADR-0007) takes over from here, and two loops polling one account
    // would race for the to-device messages that carry room keys.
    const session = syncedSession(report)
    expect(session.synced).toBe(true)
    expect(session.roomCount).toBe(1)
  })

  it('measures the cold-start sync duration', () => {
    // The figure is not asserted, only that one was recorded: that is the
    // baseline requirement, and the number moves with the network and with
    // the account's room history.
    expect(syncedSession(report).durationMs).toBeGreaterThan(0)
  })

  it('keeps the store passphrase it minted, so no room key is lost', () => {
    // This launch created the account, so the passphrase is new. A *relaunch*
    // reporting `minted` would mean it did not survive -- a new and empty
    // store, and every room key the old one held gone. roundTrip.test.ts is
    // where that is asserted, because only a second launch can see it.
    expect(report.passphrase).toBe('minted')
  })

  it("publishes this device's identity and one-time keys", () => {
    // The pump only starts once the session sync has landed (App.tsx), so
    // this depends on the same network round trip the test above resolved,
    // plus the pump's own -- a drain, a raw sync fetch, a second drain, and
    // an independent /keys/query verifying what the drains actually sent.
    const pump = ranPump()
    expect(pump.deviceKeysVerified).toBe(true)
    // Asked of the server, not of this run. The count itself is not
    // asserted: it falls as keys are claimed and rises as they are
    // replenished, and pinning a number would be pinning a moment. But
    // `null` is refused, because "the question could not be answered" is
    // not the same as an answer.
    expect(pump.oneTimeKeysOnServer).not.toBeNull()
    expect(pump.oneTimeKeysOnServer ?? 0).toBeGreaterThan(0)
  })

  it('gives the account it just created a signing identity of its own', () => {
    // Created, not published or resumed: this launch spent the invitation, so
    // the account is seconds old and has never had one. The three words are
    // deliberately different because they are very different events, and only
    // one of them may ever happen to an account.
    const { identity } = ranPump()
    expect(identity.established).toBe(true)
    expect(identity.how).toBe('created')
  })

  it('finishes the sign-up it began, and clears the marker', () => {
    // The marker says a launch started a sign-up it may not have finished. A
    // launch that published an identity and left it set would make the next
    // one believe it was entitled to create a second.
    expect(report.signUp).toBe('complete')
  })

  it('shares room keys by identity once one vouches for this device', () => {
    // 0.4.0 collects recipients by identity (MSC4153) for a machine holding a
    // cross-signing identity of its own, instead of sharing with every
    // unblacklisted device. This is the observable consequence of the test
    // above, read out of the machine rather than taken from the release
    // notes -- and it was `device-based` here until the account had an
    // identity to be vouched for by.
    expect(ranPump().sharingStrategy).toBe('identity-based')
  })

  it('encrypts a message and sends it into the room', () => {
    // The event id is not asserted: it is minted by the homeserver and
    // differs every run. What is asserted is that a send happened at all --
    // an earlier version of this passed on `not run` and on `not sent`.
    expect(sentMessage().sent).toBe(true)
  })

  it('decrypts its own intact ciphertext, which is the control', () => {
    // Without this the refusal below proves nothing: a machine that cannot
    // decrypt anything refuses a tampered ciphertext too, for a reason that
    // has nothing to do with the tampering.
    expect(sentMessage().intactDecrypted).toBe(true)
  })

  it('refuses a ciphertext with one character changed', () => {
    // The whole difference between end-to-end encryption and an expensive
    // encoding. `not-attempted` is refused explicitly rather than left to
    // fall through: a run that never tampered with anything would otherwise
    // pass a test asserting only that the word is not `accepted`.
    expect(sentMessage().tamper).toBe('refused')
  })

  it('carries the brand geometry at a size the device gave it', () => {
    // The touch-target floor is asserted here and nowhere else it could be:
    // a button's height is geometry, so no token-provenance rule reaches it.
    // And the leg follows the height that a real layout produced, rather than
    // the height a style asked for.
    expect(shape.touchTargetMet).toBe(true)
    expect(shape.height).toBeGreaterThanOrEqual(shape.floor)
    expect(shape.leg).toBeGreaterThan(0)
    expect(shape.leg).toBeLessThan(shape.height)
  })

  it('runs a live sync loop, so a message can arrive without a relaunch', async () => {
    // The one thing #79 changes about what the product *is*, asserted here
    // because nothing else in this suite would notice the loop failing to
    // start: every other fact is written by the launch path, which finishes
    // either way.
    const loop = await whatTheLoopReported()
    expect(loop.state).toBe('running')
  }, 90000)

  // ── And the two that are about the screen, which is the point of it ──

  it("shows the conversation, with this account's own message in it", async () => {
    // The pump sent one message during boot, so the conversation is not empty
    // by the time this looks. On screen and not in the log: what is asserted
    // is that a person sees it.
    await waitFor(element(by.id('conversation')))
      .toBeVisible()
      .withTimeout(60000)
  })

  it('lets a person write a message and see it arrive', async () => {
    // The criterion the whole screen exists for, and the one no log line can
    // reach: type, send, and find it in the conversation afterwards.
    const written = `écrit à la main ${Date.now()}`
    // `replaceText`, not `typeText`: the emulator's input method cannot
    // translate accented characters into key events, and fails with a message
    // about key events rather than about the accent. Setting the field
    // directly is what Espresso itself suggests, and it is closer to what a
    // person does anyway -- nobody types a message one key event at a time
    // while a test watches.
    await element(by.id('conversation-input')).replaceText(written)
    // THE RETURN KEY IS THE SEND KEY, and there is no other. The bar has no
    // send button: its round green place belongs to recording, which is V2.
    // A suite that tapped a button would be testing an application nobody
    // ships.
    await element(by.id('conversation-input')).tapReturnKey()

    // Generous: this encrypts, shares a room key if the session needs one,
    // sends, and then reads the room back.
    await waitFor(element(by.text(written)))
      .toBeVisible()
      .withTimeout(60000)
    await detoxExpect(element(by.text(written))).toBeVisible()
  })

  /** The pump, narrowed. A launch that never ran one is a failure to say so. */
  function ranPump() {
    const { pump } = report
    if (pump === 'not-configured' || pump.outcome !== 'ran') {
      throw new Error(
        `the pump did not run: ${JSON.stringify(pump)}. Nothing below this is
         about the pump, so failing here rather than on each of its facts is
         one failure instead of four saying the same thing.`,
      )
    }
    return pump.report
  }

  /** The send, narrowed, for the same reason. */
  function sentMessage() {
    const { send } = report
    if (send === 'not-run') throw new Error('no message was sent this launch')
    return send
  }
})
