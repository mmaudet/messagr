import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

import { by, device, element, waitFor } from 'detox'

/**
 * Everything this file asserts sits at the bottom of a readout that has
 * grown past one screen, so every assertion has to scroll to reach it.
 * Detox does not scroll on its own: an element below the fold is reported
 * absent, which is indistinguishable from an element that was never
 * rendered. That cost five continuous-integration runs and a wrong theory
 * about key delivery -- the application had decrypted the message correctly
 * every single time.
 */
const SCROLL = by.id('diagnostic-scroll')

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
    await device.launchApp({ newInstance: true, delete: true, url: INVITATION })
    await waitFor(element(by.text('encrypted send: sent')))
      .toBeVisible()
      .withTimeout(60000)
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
    await device.launchApp({ newInstance: true })
    await waitFor(element(by.text('entry: session restored')))
      .toBeVisible()
      .whileElement(SCROLL)
      .scroll(400, 'down')

    // The store's passphrase survived too, and that is a separate claim from
    // the session's. A relaunch that minted a new one would have opened a
    // new, empty store and lost every room key the old one held -- which the
    // decryption below would then fail on, several minutes later and looking
    // like a key-delivery problem rather than a storage one.
    await waitFor(
      element(by.text('store passphrase: reused, the store reopened')),
    )
      .toBeVisible()
      .whileElement(SCROLL)
      .scroll(400, 'down')
  })

  it('reads a message an independent client encrypted for it', async () => {
    // Sent only now: before this device published its keys, there was
    // nothing for the counterparty to encrypt to.
    runCounterparty('send')

    // Relaunched, repeatedly, and that is not a workaround dressed up: the
    // application has no live sync loop. It stops after one sync by design
    // (sessionSync.ts), so its whole attempt at decrypting happens in the
    // seconds after launch and then stops for good. Reopening the app is
    // the only retry a user has today, so it is the only retry this test is
    // entitled to model.
    //
    // Waiting longer inside one launch would not help and would be a lie
    // about the product: the screen it is waiting on has already settled.
    // The day a timeline brings a live loop (ADR-0005), this becomes one
    // launch and one wait.
    let seen = false
    for (let attempt = 0; attempt < 4 && !seen; attempt += 1) {
      await device.launchApp({ newInstance: true })
      try {
        await waitFor(element(by.text(`decrypted: ${COUNTERPARTY_BODY}`)))
          .toBeVisible()
          .whileElement(SCROLL)
          .scroll(400, 'down')
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

  it('does not present the sender as established', async () => {
    // The trust model, asserted on screen rather than trusted to a comment.
    // Decrypting an event does not establish who wrote it, and the day this
    // line loses the word "unauthenticated" is the day the product starts
    // implying otherwise.
    await waitFor(
      element(
        by.text(
          `claims to be from: ${process.env.MESSAGR_INTEROP_USER ?? ''} (unauthenticated)`,
        ),
      ),
    )
      .toBeVisible()
      .whileElement(SCROLL)
      .scroll(400, 'down')
  })
})
