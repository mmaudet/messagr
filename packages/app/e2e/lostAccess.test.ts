import { expect } from '@jest/globals'
import { by, device, element, waitFor } from 'detox'

import { runCounterparty } from './counterparty'
import { joinTheInvitation } from './invitation'
import { IGNORING_THE_LIVE_POLL } from './longPoll'
import { NOTIFICATIONS_GRANTED } from './permissions'
import { acceptThePromise } from './promise'
import { forgetTheLog, whatItReported, whatTheLoopReported } from './reported'

/**
 * Un téléphone que son serveur n'accepte plus (#391).
 *
 * # LE COMPTE DÉSACTIVÉ SANS QUE L'APPLICATION LE SACHE
 *
 * L'inviteur révoque l'invitation par laquelle cette suite est entrée, et le
 * service désactive le compte qu'elle a fait entrer (§8.2). Une suppression
 * par courriel et un téléphone retiré du compte font la même chose à
 * l'appareil : un jeton que son serveur refuse désormais.
 *
 * # UNE SUITE À ELLE, ET LA DERNIÈRE
 *
 * Écrit d'abord comme le dernier test de `boot.test.ts`, et c'était faux :
 * le compte désactivé quitte ses salons, et `roundTrip.test.ts`, qui passe
 * après boot, a besoin que le compte de boot soit encore dans le salon du
 * banc (voir `sequencer.js`). Cette suite entre donc par une invitation à
 * elle, et passe après toutes les autres : ce qu'elle retire au salon, plus
 * personne ne le cherche.
 *
 * # SANS CONTREPARTIE, SAUTÉE
 *
 * Comme `roundTrip.test.ts` : les variables viennent de l'intégration
 * continue, qui provisionne l'invitation et connecte l'inviteur.
 */

const INVITATION = process.env.MESSAGR_LOST_ACCESS_INVITATION_LINK
const INVITATION_ID = process.env.MESSAGR_LOST_ACCESS_INVITATION_ID

const hasCounterparty =
  process.env.MESSAGR_INTEROP_HOMESERVER !== undefined &&
  process.env.MESSAGR_INTEROP_WORKDIR !== undefined &&
  INVITATION !== undefined &&
  INVITATION_ID !== undefined

const describeLostAccess = hasCounterparty ? describe : describe.skip

describeLostAccess('a telephone its server no longer lets in (#391)', () => {
  beforeAll(async () => {
    // Une installation neuve, qui entre par son lien, comme roundTrip.test.ts
    // le fait et dit pourquoi.
    forgetTheLog()
    await device.launchApp({
      newInstance: true,
      permissions: NOTIFICATIONS_GRANTED,
      delete: true,
      url: INVITATION,
      launchArgs: IGNORING_THE_LIVE_POLL,
    })
    await acceptThePromise()
    await joinTheInvitation()
    const entered = await whatItReported(120000)
    expect(entered.entry.entered).toBe(true)
    // LA BOUCLE TOURNE, sinon le test ne prouverait que le lancement à froid :
    // c'est elle qui doit entendre le refus la première.
    await whatTheLoopReported()
  }, 180000)

  it('says so while running and at the next cold launch, then comes back to the screen of a deleted account', async () => {
    runCounterparty('revoke-invitation', {
      MESSAGR_REVOKE_INVITATION_ID: INVITATION_ID ?? '',
    })

    // LA BOUCLE LE VOIT AU POLL SUIVANT, s'arrête, et l'écran remplace tout.
    await waitFor(element(by.id('lost-access')))
      .toBeVisible()
      .withTimeout(120000)
    await device.takeScreenshot('acces-perdu-1-l-ecran')

    // ET LE LANCEMENT À FROID SUIVANT LE DIT AUSSI, sans rien qu'on ait
    // touché : sa première synchronisation entend le même refus.
    await device.launchApp({
      newInstance: true,
      launchArgs: IGNORING_THE_LIVE_POLL,
    })
    await waitFor(element(by.id('lost-access')))
      .toBeVisible()
      .withTimeout(120000)

    // REVENIR, AVEC LE MOT DE PASSE GARDÉ : le serveur répond que le compte
    // est désactivé, et l'écran d'un compte supprimé le dit.
    await element(by.id('lost-access-come-back')).tap()
    await waitFor(element(by.id('account-deleted')))
      .toBeVisible()
      .withTimeout(60000)
    await device.takeScreenshot('acces-perdu-2-le-compte-supprime')

    // ET LE LANCEMENT À FROID SUIVANT L'OUBLIE : l'écran d'un appareil sans
    // compte.
    await device.launchApp({
      newInstance: true,
      launchArgs: IGNORING_THE_LIVE_POLL,
    })
    await waitFor(element(by.id('paste-link-field')))
      .toExist()
      .withTimeout(60000)
  }, 420000)
})
