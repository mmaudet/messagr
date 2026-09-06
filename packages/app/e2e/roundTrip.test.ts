import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

import { expect } from '@jest/globals'
import { by, device, element, waitFor } from 'detox'

import { IGNORING_THE_LIVE_POLL } from './longPoll'
import { acceptThePromise } from './promise'
import { NOTIFICATIONS_GRANTED } from './permissions'
import { forgetTheLog, whatItReported } from './reported'

/**
 * WHAT THIS FILE READS, AND WHY IT CHANGED.
 *
 * It used to assert on a readout that had grown past one screen, so every
 * assertion had to scroll to reach it -- and Detox does not scroll on its
 * own, so an element below the fold is reported absent, which is
 * indistinguishable from one that was never rendered. That cost five
 * continuous-integration runs and a wrong theory about key delivery: the
 * application had decrypted the message correctly every single time.
 *
 * `expect` is imported by name, and that is not decoration: Detox's test
 * environment puts its own in the global scope, which takes an element
 * matcher and refuses a value. See boot.test.ts.
 *
 * The readout is gone with #105. What each launch says about itself is one
 * line of structured JSON, which cannot be scrolled off. The two assertions
 * that are genuinely about the screen -- what the conversation says about a
 * sender it cannot authenticate -- are still made on the screen, because
 * that is where the claim is made to a person.
 */

/**
 * The round trip, and the verdict ADR-0001 asks for: a message encrypted by
 * this application read by an independent client, and a message that client
 * encrypted read back here.
 *
 * # Why this drives a subprocess
 *
 * The ticket asks for a Detox test across two devices. Detox drives one. The
 * second device is the `matrix-nio` counterparty, driven from here as a
 * subprocess, which is how the crypto library's own level 2 proof does it and
 * is a stronger claim than two of our own devices agreeing: two instances of
 * the same implementation share any misreading of the protocol, and an
 * independent one does not.
 *
 * # Why the app is launched twice
 *
 * The ordering is forced by Megolm, not by convenience. A room key is shared
 * with the devices that exist and have published keys at the moment of
 * sharing. This device publishes its keys on its first run, so a counterparty
 * that encrypts before that run has nothing to encrypt to. So: the app runs,
 * then the counterparty sends, then the app runs again and reads.
 *
 * # Why this suite claims an invitation of its own
 *
 * The harness uninstalls the application between test files, so this one
 * starts on a device with an empty keystore: it cannot inherit the session
 * the boot suite claimed, and an invitation is single-use so it cannot spend
 * that suite's link either. Provisioning therefore mints one invitation per
 * suite, and they are two different people in the same room -- which is what
 * they are.
 *
 * None of this showed until the application began claiming its own
 * invitation. Before that the session was baked into the build, so a
 * reinstall cost nothing and the two suites looked independent while sharing
 * one identity.
 *
 * # Skipped without a counterparty
 *
 * The environment variables come from continuous integration, which
 * provisions the accounts and both invitations. A developer running the suite
 * locally without them gets a skip rather than a failure that says nothing
 * about their change.
 */

const COUNTERPARTY = resolve(
  __dirname,
  '../../../scripts/interop/nio_counterparty.py',
)
const COUNTERPARTY_BODY = 'encrypted by matrix-nio, for the application to read'

const INVITATION = process.env.MESSAGR_ROUNDTRIP_INVITATION_LINK

const hasCounterparty =
  process.env.MESSAGR_INTEROP_HOMESERVER !== undefined &&
  process.env.MESSAGR_INTEROP_ROOM !== undefined &&
  process.env.MESSAGR_INTEROP_WORKDIR !== undefined &&
  INVITATION !== undefined

function runCounterparty(phase: 'send'): void {
  execFileSync('python3', [COUNTERPARTY, phase], {
    stdio: 'inherit',
    // Long, because this phase queries keys and shares a group session
    // against a real homeserver before it sends anything.
    timeout: 120_000,
  })
}

const describeRoundTrip = hasCounterparty ? describe : describe.skip

describeRoundTrip('encrypted round trip', () => {
  beforeAll(async () => {
    // `delete` because this suite owns its device state: a clean install is
    // what an invited person actually starts from, and it is the only way to
    // be sure the session asserted below is the one this launch created.
    //
    // The first run claims the invitation, publishes this device's keys and
    // sends its own message.
    // CLEARED FIRST, EVERY TIME. `whatItReported` takes the newest
    // MESSAGR_RUNTIME line, and immediately after `launchApp` returns the
    // newest one is still the *previous* launch's -- so a relaunch would be
    // asserted against the launch it replaced. Clearing removes the race
    // rather than sleeping through it.
    forgetTheLog()
    await device.launchApp({
      newInstance: true,
      // See permissions.ts: a system dialog over the application would fail
      // every assertion after it, for a reason none of them is about.
      permissions: NOTIFICATIONS_GRANTED,
      delete: true,
      url: INVITATION,
      launchArgs: IGNORING_THE_LIVE_POLL,
    })
    // See promise.ts: `delete: true` cleared the flag, so the launch path is
    // waiting behind the first-launch screen and nothing below has started.
    await acceptThePromise()
    // Existence first, then visibility. `toBeVisible` with a timeout was
    // answering two questions at once -- has the send finished, and can the
    // line be seen -- and the conversation screen rendering above the readout
    // pushed the line below the fold, which failed as if the send had never
    // happened.
    const first = await whatItReported(120000)
    if (first.send === 'not-run' || !first.send.sent) {
      throw new Error(
        `the first launch never sent: ${JSON.stringify(first.send)}. Nothing
         below can pass without it -- the counterparty has nothing to read
         and no key to be shared with.`,
      )
    }
  }, 180000)

  it('restores its session on relaunch instead of claiming again', async () => {
    // Relaunched with no link at all. The application enters anyway, so the
    // session came out of the device's keystore rather than from a second
    // claim.
    //
    // This is not a convenience. An invitation is single-use, so an
    // application that lost its session and claimed again would find the
    // token spent and the account unreachable -- losing a session is losing
    // the account.
    // Cleared first: see the launch above for why every one of them is.
    forgetTheLog()
    await device.launchApp({
      newInstance: true,
      // See permissions.ts: a system dialog over the application would fail
      // every assertion after it, for a reason none of them is about.
      permissions: NOTIFICATIONS_GRANTED,
      launchArgs: IGNORING_THE_LIVE_POLL,
    })
    // The last report is this relaunch's: `whatItReported` takes the newest
    // line, and the launch above wrote its own before this one started.
    const again = await whatItReported(120000)
    expect(again.entry.entered).toBe(true)
    expect(again.entry.claimed).toBe(false)

    // The store's passphrase survived too, and that is a separate claim from
    // the session's. A relaunch that minted a new one would have opened a
    // new, empty store and lost every room key the old one held -- which the
    // decryption below would then fail on, several minutes later and looking
    // like a key-delivery problem rather than a storage one.
    expect(again.passphrase).toBe('reused')

    // And the sign-up marker is still cleared, so this relaunch created
    // nothing. `published` rather than `created` or `resumed` is what says
    // the destructive call was not reached: the identity was republished,
    // not minted a second time.
    expect(again.signUp).toBe('complete')
    const pump = again.pump
    if (pump === 'not-configured' || pump.outcome !== 'ran') {
      throw new Error(`the relaunch ran no pump: ${JSON.stringify(pump)}`)
    }
    expect(pump.report.identity.established).toBe(true)
    expect(pump.report.identity.how).toBe('published')
  })

  it('reads a message an independent client encrypted for it', async () => {
    // Sent only now: before this device published its keys, there was
    // nothing for the counterparty to encrypt to.
    runCounterparty('send')

    // Relaunched, repeatedly. The application now runs a live sync loop
    // (ADR-0007), so waiting inside one launch is no longer a lie about the
    // product — but this block is skipped unless a counterparty is built,
    // and the counterparty has not run since the mautrix-go one-time-key
    // signature bug was found -- diagnosed on the docs/interop-otk-bug
    // branch, which is not merged. Rewriting a test that
    // cannot be watched failing is how a suite acquires assertions nobody
    // has ever seen pass, so this keeps the retry it was proven with until
    // somebody can run it.
    let seen = false
    for (let attempt = 0; attempt < 4 && !seen; attempt += 1) {
      // Cleared first, and here it does more than remove a race: the loop
      // asks the same question of each launch, so a line left by the one
      // before would answer for it and the retry would prove nothing.
      forgetTheLog()
      await device.launchApp({
        newInstance: true,
        permissions: NOTIFICATIONS_GRANTED,
        launchArgs: IGNORING_THE_LIVE_POLL,
      })
      try {
        const read = await whatItReported(60000)
        if (
          read.received !== 'not-run' &&
          read.received.received &&
          read.received.body === COUNTERPARTY_BODY
        ) {
          seen = true
        } else {
          throw new Error('not this launch')
        }
      } catch {
        // The room key had not arrived within this launch's own attempt.
        // Another launch asks again.
      }
    }

    if (!seen) {
      throw new Error(
        "the counterparty's message never decrypted across four launches",
      )
    }
  })

  it("shows the independent client's message on the screen a person reads", async () => {
    // WHAT THIS ASKS, AND WHY IT ASKS THIS NOW.
    //
    // It used to assert the sender's line -- « Se présente comme … » -- and
    // failed five continuous-integration runs in five ways. The last is the
    // informative one: `toExist` failed too, so the label is not merely
    // off-screen, it is not rendered at all.
    //
    // That should not be possible. The room holds three people -- the
    // provisioning script puts both suites' entrants and the inviter
    // together -- so `theOtherMember` answers null, which the launch report
    // confirms on every run by reporting `history` as null, and a message
    // from somebody who is not "the other person" is named. Which leaves two
    // candidates, and this assertion tells them apart:
    //
    //   1. the counterparty's message is not in the *rendered* conversation
    //      at all, only in the diagnostic probe's own fetch; or
    //   2. it is rendered, and the label above it is not.
    //
    // If this passes it is (2), and the naming rule has a defect worth its
    // own ticket. If it fails it is (1) -- the live loop is not putting a
    // received message on screen, which is a much larger finding and exactly
    // what ADR-0007 exists to make impossible.
    //
    // Either way the trust model itself is asserted by the test below, off
    // the launch report, and has passed all five of those runs.
    await waitFor(element(by.text(COUNTERPARTY_BODY)))
      .toExist()
      .withTimeout(60000)
  })

  it('does not present the sender as established', async () => {
    // Decrypting an event proves which key wrote it and nothing about who
    // holds that key. The readout used to say so in the word
    // "unauthenticated"; the report says it in the field's name, which is
    // `claimedSender` everywhere it is carried -- and the screen above says
    // it to a person, in « Se présente comme ».
    //
    // Asserted here as the sender the application *claims*, matching the
    // counterparty the harness actually ran, so a report that named somebody
    // else -- or named nobody -- fails rather than passing by absence.
    const read = await whatItReported(60000)
    if (read.received === 'not-run' || !read.received.received) {
      throw new Error('nothing was received, so there is no sender to check')
    }
    expect(read.received.claimedSender).toBe(process.env.MESSAGR_INTEROP_USER)
  })
})
