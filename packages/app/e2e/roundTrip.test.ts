import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { expect } from '@jest/globals'
import { by, device, element, waitFor } from 'detox'

import { openTheFirstConversation } from './conversation'
import { demandTheRotation, type OutcomeScreen } from './eviction'
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
// Le nom EST le corps d'un `m.file`, et c'est ce que l'écran affiche. Il doit
// s'accorder au caractère près avec `nio_counterparty.py`, qui l'écrit.
const COUNTERPARTY_FILE_NAME = 'relevé-de-nio.txt'

const INVITATION = process.env.MESSAGR_ROUNDTRIP_INVITATION_LINK

const hasCounterparty =
  process.env.MESSAGR_INTEROP_HOMESERVER !== undefined &&
  process.env.MESSAGR_INTEROP_ROOM !== undefined &&
  process.env.MESSAGR_INTEROP_WORKDIR !== undefined &&
  INVITATION !== undefined

function runCounterparty(
  phase: 'send' | 'send-file' | 'claim-place' | 'witness-eviction',
  extra: Record<string, string> = {},
): void {
  execFileSync('python3', [COUNTERPARTY, phase], {
    env: { ...process.env, ...extra },
    stdio: 'inherit',
    // Long, because this phase queries keys and shares a group session
    // against a real homeserver before it sends anything.
    timeout: 120_000,
  })
}

/**
 * Le salon que `claim-place` a rejoint, tel qu'il l'a écrit.
 *
 * Personne d'autre ne le connaît : il naît avec l'invitation, l'écran montre
 * une personne plutôt qu'un salon, et la contrepartie est celle qui vient d'y
 * entrer. La moitié qui écrit est dans `claim_place`.
 */
function claimedRoom(): string {
  const workdir = process.env.MESSAGR_INTEROP_WORKDIR
  if (workdir === undefined) {
    throw new Error('MESSAGR_INTEROP_WORKDIR is unset: no claimed room to read')
  }
  const room = readFileSync(resolve(workdir, 'claimed-room'), 'utf8').trim()
  if (room === '') {
    throw new Error('claim-place joined a room and wrote no identifier for it')
  }
  return room
}

/**
 * Écrire un message dans la conversation ouverte, et attendre de le voir.
 *
 * `replaceText` plutôt que `typeText` : le clavier de l'émulateur ne sait pas
 * traduire un accent en événement de touche, et échoue sur un message qui
 * parle de touches plutôt que d'accents. C'est ce que fait déjà boot.test.ts,
 * qui est la preuve que ce geste marche sur ce banc.
 *
 * Le rond du composeur est un micro quand le champ est vide et un envoi quand
 * il ne l'est pas : `composer-send` n'existe donc qu'après le texte, et on
 * l'attend au lieu de le supposer.
 */
async function sendInTheConversation(written: string): Promise<void> {
  await waitFor(element(by.id('conversation-input')))
    .toBeVisible()
    .withTimeout(60000)
  await element(by.id('conversation-input')).replaceText(written)
  await waitFor(element(by.id('composer-send')))
    .toBeVisible()
    .withTimeout(30000)
  await element(by.id('composer-send')).tap()
  // VU À L'ÉCRAN, ET PAS SEULEMENT ENVOYÉ. Cela chiffre, partage une clé de
  // salon si la session en demande une, envoie, puis relit le salon.
  await waitFor(element(by.text(written)))
    .toBeVisible()
    .withTimeout(60000)
}

/**
 * L'écran, tel que la garde d'éviction le questionne. Detox lève quand il ne
 * trouve pas ; ici « pas là » est une réponse, pas une panne.
 */
const onTheScreen: OutcomeScreen = {
  appeared: async (testID: string, within: number) => {
    try {
      await waitFor(element(by.id(testID)))
        .toBeVisible()
        .withTimeout(within)
      return true
    } catch {
      return false
    }
  },
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
    // ONE-TIME KEYS ON THE SERVER, ASSERTED BEFORE THE COUNTERPARTY RUNS.
    //
    // #234: this test fails intermittently, at the far end, after four
    // launches and a hundred seconds, with « the counterparty's message
    // never decrypted ». The logs say `m.no_olm` in substance every time:
    // « Missing session for device », « no session found with session id ».
    //
    // A room key travels INSIDE an Olm message, and an Olm session cannot
    // exist until the sender has claimed one of this device's one-time keys.
    // So a device with none on the server is a device nothing can be shared
    // with -- `go-counterparty/main.go` measured exactly that and wrote it
    // down: « A run without this call fails in a way that reads as a
    // protocol disagreement and is a missing upload. »
    //
    // The test above asserts the IDENTITY is published. It never asserted
    // the one-time keys were, and the comment below it says « before this
    // device published its keys » about a fact nothing checked.
    //
    // Zero here is a claim about the server; `null` is a question that could
    // not be answered. Both are refused, and both name the cause where it
    // happens rather than a hundred seconds later.
    const before = await whatItReported(60000)
    const ready = before.pump
    if (ready === 'not-configured' || ready.outcome !== 'ran') {
      throw new Error(
        `no pump before the counterparty: ${JSON.stringify(ready)}`,
      )
    }
    if (ready.report.oneTimeKeysOnServer === null) {
      throw new Error(
        'the server would not say how many one-time keys it holds for this ' +
          'device, so there is no way to know whether the counterparty can ' +
          'open an Olm session to it.',
      )
    }
    if (ready.report.oneTimeKeysOnServer === 0) {
      throw new Error(
        'this device has no one-time key on the server, so the counterparty ' +
          'cannot open an Olm session to it and the room key it shares will ' +
          'never arrive. See #234.',
      )
    }

    // Sent only now: before this device published its keys, there was
    // nothing for the counterparty to encrypt to.
    runCounterparty('send')

    // Relaunched, repeatedly. The application now runs a live sync loop
    // (ADR-0007), so waiting inside one launch is no longer a lie about the
    // product.
    //
    // WHAT WAS WRITTEN HERE WAS FALSE, and it was the sentence protecting
    // this loop from scrutiny: « the counterparty has not run since the
    // mautrix-go one-time-key signature bug was found », therefore the block
    // « cannot be watched failing », therefore the retry stays. Every link
    // fails. #234 recovered the full logs of three occurrences -- runs
    // 34590785553, 34615662123 and 34675023641 -- and the counterparty sent
    // successfully in all three, event id and all. It runs. This block is
    // reached. It HAS been watched failing.
    //
    // So the retry no longer rests on « nobody can run it ». What the three
    // logs show is that it rescues nothing: all four launches failed every
    // time, with fifty one-time keys on the server and the ciphertext
    // arriving without its room key. It is kept for now because #239's two
    // guards landed after those measurements and nothing has been seen
    // since -- which is a reason with an expiry date, not a principle. If
    // #234 closes without this loop ever turning red on attempt two or
    // later, it should go: four launches and a hundred seconds are what this
    // suite pays for it.
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

  it('reads an m.file an independent client wrote for it', async () => {
    // LE CRITÈRE DE #111, ENFIN MESURÉ — dans le sens qui peut l'être.
    //
    // Ce dépôt affirmait qu'un document « arrive en `m.file` qu'un autre
    // client Matrix reconnaîtrait », et rien ne l'établissait : le seul test
    // sur la question s'intitule « builds an m.file the specification would
    // recognise » et n'assert que le msgtype et la forme d'`info`. C'est
    // Messagr qui se relit lui-même.
    //
    // Ici une implémentation indépendante écrit l'événement — sa clé, son IV
    // et ses empreintes sont celles de nio — et l'application le lit. Si
    // `encryptedFile.ts` diverge d'un nom de champ, d'une variante de base64
    // ou d'une empreinte, c'est ici que ça se voit, et nulle part ailleurs.
    //
    // L'AUTRE SENS N'EST PAS PROUVÉ, ET C'EST ÉCRIT POUR QU'ON NE LE CHERCHE
    // PAS. Que le `m.file` de Messagr soit lu par nio demanderait que
    // l'application joigne un document, donc qu'elle ouvre un sélecteur de
    // fichiers — et l'émulateur n'en ouvre aucun. `nio_counterparty.py` sait
    // désormais reconnaître un fichier reçu, de sorte que le jour où un banc
    // peut en envoyer un, la preuve est une ligne d'assertion et non un
    // chantier.
    runCounterparty('send-file')

    // La même boucle que le message, et pour la même raison : la clé de salon
    // voyage dans un message Olm, qui n'arrive pas toujours dans le premier
    // lancement. Voir le paragraphe de #234 plus haut.
    // TROIS TENTATIVES ET DES ATTENTES PLUS COURTES, parce que le budget
    // est réel : quatre relances à deux attentes de soixante secondes
    // dépassaient les 180 000 ms de Jest, et le test mourait sur le temps
    // plutôt que sur ce qu'il mesure -- ce qui ne dit rien de l'interop.
    //
    // Trois suffisent ici : le test précédent a déjà fait arriver la clé de
    // salon, donc le fichier arrive en général au premier lancement. La
    // boucle reste pour la même raison que la sienne, #234.
    let seen = false
    let lastFailure = 'nothing was attempted'
    for (let attempt = 0; attempt < 3 && !seen; attempt += 1) {
      forgetTheLog()
      await device.launchApp({
        newInstance: true,
        permissions: NOTIFICATIONS_GRANTED,
        launchArgs: IGNORING_THE_LIVE_POLL,
      })
      // LA CONVERSATION EST-ELLE SEULEMENT OUVERTE ? C'EST LA QUESTION QUE
      // CE TEST NE POSAIT PAS, PUIS POSAIT TROP TÔT.
      //
      // Sans elle, un échec disait « le fichier n'est jamais apparu » et
      // laissait croire que l'application ne savait pas lire un `m.file`
      // d'une autre implémentation, alors que la capture montrait la LISTE.
      //
      // Et elle ne suffisait pas : ce test touchait `first-conversation` dès
      // que la ligne était visible, c'est-à-dire dès que la liste mémorisée
      // est dessinée, avant que le lancement ait lié ce que la ligne appelle.
      // Trois touchers perdus sur le run 34717623056. `openTheFirstConversation`
      // attend le rapport du lancement, prouve l'ouverture par la ligne que
      // toute conversation qui se dessine écrit, répond à l'offre de
      // sauvegarde, qui tombe ici, et finit sur `conversation-input`. S'il
      // échoue, son message nomme la navigation plutôt que l'interop.
      try {
        await openTheFirstConversation()
      } catch (cause: unknown) {
        // GARDÉE, ET PAS AVALÉE. La boucle jetait la raison, donc l'échec
        // final ne pouvait pas dire laquelle des attentes avait expiré --
        // celle qui ouvre la conversation, ou celle qui cherche le fichier
        // dedans. C'est le même défaut que le message d'origine, que ce test
        // reproche plus bas.
        lastFailure = cause instanceof Error ? cause.message : String(cause)
        continue
      }
      try {
        // SUR LE NOM, parce que le nom EST le corps d'un `m.file` et que
        // c'est ce qu'une personne lit. Accentué à dessein : un aller-retour
        // qui ne passerait que de l'ASCII ne dirait rien des encodages, et
        // c'est exactement là que deux implémentations divergent.
        await waitFor(element(by.text(COUNTERPARTY_FILE_NAME)))
          .toBeVisible()
          .withTimeout(45000)
        seen = true
      } catch (cause: unknown) {
        // Gardée aussi, pour la même raison.
        lastFailure = cause instanceof Error ? cause.message : String(cause)
      }
      // REFERMÉE DANS LE TEST, et pas seulement ouverte. « names the sender »
      // part de la liste, comme une application relancée : c'était vrai par
      // accident tant que ce test n'arrivait pas à ouvrir la conversation.
      // Refermée à chaque tentative qui l'a ouverte, trouvée ou non, pour que
      // l'état laissé ne dépende pas de laquelle a été la dernière.
      await element(by.id('conversation-back')).tap()
      await waitFor(element(by.id('first-conversation')))
        .toBeVisible()
        .withTimeout(30000)
    }

    if (!seen) {
      throw new Error(
        `the file written by matrix-nio never appeared: no row named
         ${COUNTERPARTY_FILE_NAME} across three launches.

         READ THE DEVICE LOG BEFORE BLAMING THE INTEROP. The application says
         MESSAGR_DOCUMENT_READ with the name when it has read the m.file, and
         that line separates two failures this message used to confuse:

           the line is there  -> the file was read, and this test was looking
                                 at a screen it could not be on. The
                                 conversation not opening reads exactly like
                                 an interop failure and is not one.
           the line is absent -> either the room key never arrived (#234) or
                                 the application cannot read an m.file
                                 another implementation wrote, which is the
                                 thing this test exists to find out.

         Measured on 12 September 2026: the line was there twice, and the
         failure screenshot showed the conversation list. Read on 13
         September in run 34717623056: all three taps had been made before
         the launch bound what a row calls. openTheFirstConversation now
         waits for the launch report first, and names the tap when it opens
         nothing.

         The last attempt failed with: ${lastFailure}`,
      )
    }
    // Le budget de Jest est à 180 000 ms par défaut ; trois relances avec
    // leurs deux attentes le dépassent. Élargi ici plutôt que pour toute la
    // suite : les autres tests n'en ont pas besoin, et un budget global plus
    // large ferait disparaître les blocages au lieu de les montrer.
  }, 300000)

  it('names the sender on the screen, and not only in the report', async () => {
    // #123, RÉTABLI, ET CE QUI L'AVAIT GARÉ N'ÉTAIT PAS CE QU'ON CROYAIT.
    //
    // L'assertion échouait avec `toExist`, et sept runs ont cherché si
    // l'entrée du fil portait seulement un `claimedSender`. Elle le porte :
    // `loadConversation` passe par `toTimelineEntries`, qui ÉCARTE tout
    // événement sans `sender` au lieu d'en rendre un sans nom, et
    // `buildTimeline.spec.ts` l'épingle déjà.
    //
    // Ce qui manquait était mécanique. La ligne rend « Se présente comme »
    // suivi de l'identifiant complet, et `by.text` est une correspondance
    // EXACTE sur Android : une assertion portant sur le gabarit ou sur un
    // préfixe ne trouve rien, la ligne étant pourtant à l'écran.
    //
    // Donc on vise le `testID` que la ligne porte déjà, et le rapport dit
    // désormais quel événement il a lu pour qu'on sache lequel regarder.
    const read = await whatItReported(60000)
    if (read.received === 'not-run' || !read.received.received) {
      throw new Error('nothing was received, so there is no line to look for')
    }
    const named = read.received.eventId
    if (named === undefined) {
      throw new Error('the report does not say which event it read')
    }

    // ET IL FAUT OUVRIR LA CONVERSATION, ce que le titre de #123 dit et que
    // ce fichier ne faisait pas : cette suite lit tout dans le rapport de la
    // sonde et n'a jamais navigué nulle part. Une application relancée
    // s'ouvre sur la LISTE, donc une assertion d'écran posée là ne trouve
    // rien -- ce qu'un premier essai a confirmé en trente secondes de
    // matcher qui ne correspond jamais.
    // Par l'aide commune, qui répond aussi à l'offre de sauvegarde là où le
    // produit la fait. Voir conversation.ts.
    await openTheFirstConversation()

    // §13.26 : la ligne paraît dès que le salon compte plus d'un autre
    // membre, ce qui est le cas de celui-ci -- le rapport dit `whoElse`
    // joined 3. Un salon à deux nomme personne, et c'est délibéré.
    // PLUS HAUT QUE L'ÉCRAN, ET UNE PERSONNE REMONTE POUR LE LIRE.
    //
    // La conversation s'ouvre sur son message le plus récent, et celui que
    // le rapport nomme est plus ancien. Sur le run Device 34739896093, cinq
    // entrées le suivaient -- le fichier et une sonde par relance -- et la
    // capture montre sa bulle coupée sous l'en-tête, sa ligne « Se présente
    // comme » hors de l'écran. Le test remonte donc par pas jusqu'à la voir,
    // comme `promise.ts` le fait pour l'action d'un écran qui défile.
    await waitFor(element(by.id(`claimed-${named}`)))
      .toBeVisible()
      .whileElement(by.id('screen-scroll'))
      .scroll(300, 'up')
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

  it('removes somebody it invited, and rotates the key behind them', async () => {
    // #35, LE GESTE PILOTÉ CONTRE UN VRAI HOMESERVER.
    //
    // Les `testID` d'éviction existent depuis `dd896dc` et **rien ne les
    // pilotait** : `git grep evict packages/app/e2e` rendait zéro. Le code
    // était écrit, la vérification demandée n'avait pas eu lieu.
    //
    // # CE QUE CE TEST ASSERTAIT, ET POURQUOI C'ÉTAIT PIRE QUE RIEN
    //
    // Il touchait `evict-confirm`, attendait `evict-outcome`, prenait une
    // capture. L'écran portait `evict-outcome` pour les QUATRE issues : le
    // texte changeait, le `testID` non. Ce test passait donc aussi quand
    // l'éviction échouait, et quand aucune clé n'avait tourné -- sous un nom
    // qui annonce une éviction prouvée. Une porte laissée ouverte par ce qui
    // a l'air de la fermer : personne ne va vérifier derrière. C'est #276.
    //
    // Il exige maintenant `evict-outcome-rotated`, et `eviction.ts` nomme ce
    // que l'écran dit à la place quand ce n'est pas elle. Cette garde a été
    // vue rougir sur chacune des trois autres issues, sans appareil, dans
    // `eviction.spec.ts` -- une garde qu'on n'a jamais vue échouer ne prouve
    // rien, et c'est le défaut qu'on répare ici.
    //
    // # DEUX MESSAGES, UN AVANT ET UN APRÈS, ET AUCUN N'EST DÉCORATIF
    //
    // AVANT : sans lui, ce salon est muet, aucune clé de cet appareil n'y a
    // jamais servi, et l'issue honnête de l'éviction est
    // `evict-outcome-no-key` -- un succès qui ne fait tourner aucune clé.
    // Exiger la rotation sur un salon muet, ce serait exiger ce que le
    // produit n'a pas à faire.
    //
    // APRÈS : « la partie retirée ne peut pas déchiffrer un message envoyé
    // après l'éviction » n'est une preuve que s'il existe un tel message.
    // Sans lui, la garde serait vraie faute de matière -- une garde qui
    // fabrique son entrée, le défaut jumeau de celui-ci.
    //
    // # ET LE JUGE N'EST PAS L'APPLICATION
    //
    // L'écran ci-dessous est le témoignage de l'application sur elle-même.
    // `witness-eviction` interroge le homeserver avec la session de la
    // contrepartie : le retrait a eu lieu, c'est l'application qui l'a posé,
    // ce qu'elle avait écrit avant est passé chiffré, et rien de ce qu'elle a
    // envoyé après n'est visible. Ce que ce banc ne permet PAS de prouver --
    // la rotation elle-même -- est écrit au long dans le docstring de cette
    // phase, plutôt que maquillé en assertion.
    //
    // # POURQUOI CE TEST DOIT INVITER D'ABORD
    //
    // L'appareil du banc entre par invitation, donc au niveau zéro du salon
    // du banc : il n'y a personne qu'il puisse en retirer, et `kick` y
    // répondrait 403. Mais inviter CRÉE un salon dont il est l'auteur --
    // `issueInvitation.ts` y pose `invite: 50` et `users_default: 0` — et
    // c'est là, et seulement là, que le geste existe.
    //
    // # ET POURQUOI LA CONTREPARTIE RÉCLAME AVEC SON IDENTITÉ
    //
    // `ClaimRequest` porte `existing_user_id`. Lui faire tirer un compte
    // réservé donnerait un troisième inconnu, et la preuve que #35 demande
    // — « prouvée avec un client indépendant plutôt qu'avec le nôtre » —
    // perdrait ce qui la rend indépendante.
    //
    // # DES CAPTURES À CHAQUE ÉTAPE, ET DÈS LE DÉPART
    //
    // Trois allers-retours de CI ont été dépensés ailleurs aujourd'hui à
    // supposer ce qu'un écran montrait. Une image coûte une seconde et
    // répond à la place d'une hypothèse. Prises systématiquement : une
    // capture qu'on ne prend qu'en cas d'échec est une capture qu'on n'a
    // jamais quand on en a besoin.
    await device.launchApp({
      newInstance: true,
      permissions: NOTIFICATIONS_GRANTED,
      launchArgs: IGNORING_THE_LIVE_POLL,
    })
    await waitFor(element(by.id('invite-open')))
      .toBeVisible()
      .withTimeout(60000)
    await device.takeScreenshot('eviction-1-liste')

    await element(by.id('invite-open')).tap()
    await waitFor(element(by.id('invite-name')))
      .toBeVisible()
      .withTimeout(30000)
    await element(by.id('invite-name')).replaceText('la contrepartie')
    await element(by.id('invite')).tap()

    await waitFor(element(by.id('invite-link')))
      .toBeVisible()
      .withTimeout(120000)
    await device.takeScreenshot('eviction-2-le-lien')

    const shown = await element(by.id('invite-link')).getAttributes()
    const link = 'text' in shown ? shown.text : undefined
    if (typeof link !== 'string' || link.trim() === '') {
      throw new Error('the invitation link was not readable from the screen')
    }
    // LE JETON EST LE DERNIER SEGMENT. La page d'invitation le porte dans
    // son chemin, et c'est ce que le service attend -- pas l'adresse.
    const token = link.trim().split('/').pop() ?? ''
    if (token === '') throw new Error(`no token in the link shown: ${link}`)

    // Bloquant jusqu'à cent vingt secondes : la contrepartie réclame tant que
    // le client de l'inviteur -- cette application, qui tourne -- ne l'a pas
    // laissée entrer, puis rejoint le salon.
    runCounterparty('claim-place', { MESSAGR_INTEROP_CLAIM_TOKEN: token })
    const scope = claimedRoom()

    await element(by.id('invite-close')).tap()
    await device.takeScreenshot('eviction-3-apres-le-claim')

    // LA CONVERSATION QUE LA CONTREPARTIE A REJOINTE, PAS LA PREMIÈRE LIGNE.
    //
    // Ce test ouvrait `first-conversation` en écrivant « la conversation neuve
    // est en tête ». Elle ne peut pas l'être ici. La liste trie par dernière
    // activité (`conversationList.ts`), une conversation où rien n'a été dit
    // compte zéro, et le lancement de ce test vient d'écrire la sonde dans le
    // salon du banc. Mesuré sur le run 34738990621 : le salon du banc en
    // tête, la conversation neuve en dessous, et un écran de la personne où
    // ne restait que « Retour » -- `theOtherMember` ne désigne personne dans
    // un salon de plus de deux, donc rien à retirer.
    //
    // L'avatar porte le salon dans son `testID` sur chaque ligne, la première
    // comprise : c'est lui qu'on touche, où que la ligne se trouve.
    await waitFor(element(by.id(`avatar-${scope}`)))
      .toBeVisible()
      .withTimeout(60000)
    await element(by.id(`avatar-${scope}`)).tap()

    // UN MESSAGE AVANT, POUR QU'IL Y AIT UNE CLÉ À FAIRE TOURNER.
    //
    // `discardScopeKey` rend `false` quand cet appareil n'a jamais chiffré
    // dans le salon -- ce qui est le cas d'une conversation qui vient de
    // naître et où rien n'a été dit. L'issue serait alors
    // `evict-outcome-no-key` : un succès, et pas une rotation. Ce message
    // crée la session Megolm que l'éviction devra invalider.
    //
    // `replaceText` puis `composer-send`, comme boot.test.ts : le clavier de
    // l'émulateur ne sait pas traduire un accent en événement de touche.
    await sendInTheConversation(`avant l'éviction ${Date.now()}`)
    await device.takeScreenshot('eviction-4-avant-leviction')

    await waitFor(element(by.id('open-person')))
      .toBeVisible()
      .withTimeout(30000)
    await element(by.id('open-person')).tap()

    await waitFor(element(by.id('evict-open')))
      .toBeVisible()
      .withTimeout(30000)
    await device.takeScreenshot('eviction-5-la-personne')
    await element(by.id('evict-open')).tap()

    // DEUX TEMPS, et le second est celui qui agit. La forme est celle de
    // tout ce qui ne se reprend pas dans ce produit.
    await waitFor(element(by.id('evict-confirm')))
      .toBeVisible()
      .withTimeout(30000)
    await element(by.id('evict-confirm')).tap()

    // L'ISSUE LUE À L'ISSUE PRÈS. Voir eviction.ts : `evict-outcome-rotated`
    // et rien d'autre, et un échec qui nomme laquelle des trois autres est à
    // l'écran plutôt que de dire « élément introuvable ».
    await demandTheRotation(onTheScreen)
    await device.takeScreenshot('eviction-6-le-resultat')

    // UN MESSAGE APRÈS, DANS LA MÊME CONVERSATION. C'est celui dont le juge
    // constatera qu'il n'arrive pas jusqu'à la personne retirée. Le geste
    // s'est fait depuis l'écran de la personne ; on revient à la
    // conversation, qui est toujours là -- l'application en est membre.
    await element(by.id('person-back')).tap()
    await sendInTheConversation(`après l'éviction ${Date.now()}`)
    await device.takeScreenshot('eviction-7-apres-leviction')

    // LE JUGE, ET IL N'EST PAS CETTE APPLICATION. Il sort non nul, donc
    // `runCounterparty` lève, et son propre texte dit ce qu'il a constaté.
    runCounterparty('witness-eviction')
    // ÉLARGI DE 420 À 600 SECONDES : deux envois et le juge s'ajoutent à ce
    // que ce test faisait déjà, et un budget dépassé tue le test sur le temps
    // plutôt que sur ce qu'il mesure -- ce qui ne dit rien de l'éviction.
  }, 600000)
})
