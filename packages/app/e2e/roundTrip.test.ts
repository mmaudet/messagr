import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

import { by, device, element, waitFor } from 'detox'

import { IGNORING_THE_LIVE_POLL } from './longPoll'
import { seeText } from './readout'

/**
 * Everything this file asserts sits at the bottom of a readout that has
 * grown past one screen, so every assertion has to scroll to reach it.
 * Detox does not scroll on its own: an element below the fold is reported
 * absent, which is indistinguishable from an element that was never
 * rendered. That cost five continuous-integration runs and a wrong theory
 * about key delivery -- the application had decrypted the message correctly
 * every single time.
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
    await device.launchApp({
      newInstance: true,
      delete: true,
      url: INVITATION,
      launchArgs: IGNORING_THE_LIVE_POLL,
    })
    // Existence first, then visibility. `toBeVisible` with a timeout was
    // answering two questions at once -- has the send finished, and can the
    // line be seen -- and the conversation screen rendering above the readout
    // pushed the line below the fold, which failed as if the send had never
    // happened.
    await waitFor(element(by.text('encrypted send: sent')))
      .toExist()
      .withTimeout(60000)
    await seeText('encrypted send: sent')
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
    await device.launchApp({
      newInstance: true,
      launchArgs: IGNORING_THE_LIVE_POLL,
    })
    await seeText('entry: session restored')

    // The store's passphrase survived too, and that is a separate claim from
    // the session's. A relaunch that minted a new one would have opened a
    // new, empty store and lost every room key the old one held -- which the
    // decryption below would then fail on, several minutes later and looking
    // like a key-delivery problem rather than a storage one.
    await seeText('store passphrase: reused, the store reopened')

    // And the sign-up marker is still cleared, so this relaunch created
    // nothing. `published` rather than `created` or `resumed` is what says
    // the destructive call was not reached: the identity was republished,
    // not minted a second time.
    //
    // Existence first: the identity line is written when the pump finishes,
    // and the two lines above are set long before that. Asserting visibility
    // straight away read a readout still saying "signing identity: —" and
    // failed on a screen that was simply not finished yet.
    await waitFor(element(by.text('signing identity: published')))
      .toExist()
      .withTimeout(60000)
    await seeText('sign-up: complete, the marker is cleared')
    await seeText('signing identity: published')
  })

  it('reads a message an independent client encrypted for it', async () => {
    // Sent only now: before this device published its keys, there was
    // nothing for the counterparty to encrypt to.
    runCounterparty('send')

    // Relaunched, repeatedly. The application now runs a live sync loop
    // (ADR-0007), so waiting inside one launch is no longer a lie about the
    // product — but this block is skipped unless a counterparty is built,
    // and the counterparty has not run since the mautrix-go one-time-key
    // signature bug was found (docs/interop-otk-bug). Rewriting a test that
    // cannot be watched failing is how a suite acquires assertions nobody
    // has ever seen pass, so this keeps the retry it was proven with until
    // somebody can run it.
    let seen = false
    for (let attempt = 0; attempt < 4 && !seen; attempt += 1) {
      await device.launchApp({
        newInstance: true,
        launchArgs: IGNORING_THE_LIVE_POLL,
      })
      try {
        await seeText(`decrypted: ${COUNTERPARTY_BODY}`)
        seen = true
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

  it("shows the independent client's message as announced, not as known", async () => {
    // The trust model, on the screen a person actually reads rather than on
    // a diagnostic line. Decrypting proves which key wrote the message and
    // nothing about who holds it, so the conversation says the sender is
    // announced -- and the word "vérifier" appears nowhere on it.
    // The label is two lines tall, because a Matrix user id is long. A
    // scroll that merely reached it left it 60 per cent visible and the
    // assertion failed on a screen that was rendering exactly the right
    // words. Going to the top first lands it properly.
    await seeText(`Se présente comme ${process.env.MESSAGR_INTEROP_USER ?? ''}`)
  })

  it('does not present the sender as established', async () => {
    // The trust model, asserted on screen rather than trusted to a comment.
    // Decrypting an event does not establish who wrote it, and the day this
    // line loses the word "unauthenticated" is the day the product starts
    // implying otherwise.
    await seeText(
      `claims to be from: ${process.env.MESSAGR_INTEROP_USER ?? ''} (unauthenticated)`,
    )
  })
})
