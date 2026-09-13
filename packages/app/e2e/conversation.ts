import { by, element, waitFor } from 'detox'

import { markTheLog, whatCameAfter } from './reported'

/**
 * Ouvrir la première conversation de la liste, comme une personne le fait, et
 * répondre à ce que le produit montre à ce moment-là.
 *
 * Tout test qui ouvre une conversation passe par ici. C'est la raison d'être
 * de ce fichier : l'offre de sauvegarde se traite à un seul endroit, ou elle
 * se traite mal à plusieurs.
 *
 * # L'OFFRE DE SAUVEGARDE RECOUVRE LA CONVERSATION
 *
 * Le produit propose de sauvegarder les clés une fois par installation, quand
 * une conversation qui se dessine contient un message reçu d'un autre compte
 * (`offerBackup.ts`, et l'effet sur `conversation` dans `App.tsx`). Son écran
 * couvre tout, la conversation comprise.
 *
 * Mesuré le 12 septembre 2026, run 34717623056 : « names the sender » ouvre la
 * conversation, `MESSAGR_BACKUP_OFFER {"offer":true}` tombe à 21:19:31.132, et
 * la capture d'échec montre « Retrouver vos messages si vous perdez ce
 * téléphone » par-dessus la ligne que le test attendait. Le run 34721727472 de
 * #260 porte la même ligne à 22:25:15.896, et le même test y passe. Un vert qui
 * dépend de qui arrive le premier, du test ou de l'écran, n'en est pas un.
 *
 * # LA DÉCISION EST LUE, L'ÉCRAN N'EST PAS GUETTÉ
 *
 * « Toucher "Pas maintenant" s'il est visible » répondrait selon l'heure à
 * laquelle on regarde. Le produit écrit ce qu'il décide, dans deux lignes
 * faites pour ça : `MESSAGR_BACKUP_TRIGGER` pour chaque conversation qui se
 * dessine, avec `received`, puis `MESSAGR_BACKUP_OFFER`, avec `offer`, chaque
 * fois qu'un message reçu pose la question. Le test lit les deux après son
 * propre toucher, et attend l'écran si et seulement si elles disent qu'il
 * vient.
 *
 * La première sert aussi de preuve d'ouverture. Une conversation qui ne
 * s'ouvre pas n'en écrit aucune, et l'échec le dit en ces termes, au lieu de
 * laisser croire que c'est ce qu'on cherchait dedans qui manque.
 *
 * Ce que ça couvre : l'offre faite à l'ouverture, le seul moment où cette
 * suite peut la déclencher. Un message reçu pendant qu'une conversation est
 * déjà ouverte la déclencherait plus tard, et aucun test ne le fait.
 *
 * # REFUSÉE, PAS ACCEPTÉE
 *
 * Accepter crée une sauvegarde et montre une clé, ce que `boot.test.ts`
 * éprouve déjà depuis Réglages. Ici l'offre n'est pas le sujet, et le refus
 * laisse l'appareil comme il était. Le produit inscrit la question avant la
 * réponse, donc elle ne revient plus sur cette installation : les ouvertures
 * suivantes lisent `offer: false` et passent.
 */
export async function openTheFirstConversation(): Promise<void> {
  await waitFor(element(by.id('first-conversation')))
    .toBeVisible()
    .withTimeout(60000)
  const mark = markTheLog()
  await element(by.id('first-conversation')).tap()

  let drawn: { readonly tag: string; readonly value: unknown }
  try {
    drawn = await whatCameAfter(
      mark,
      ['MESSAGR_BACKUP_TRIGGER', 'MESSAGR_OPEN_CONVERSATION_FAILED'],
      30000,
    )
  } catch (cause: unknown) {
    throw new Error(
      'the tap on first-conversation opened nothing: no conversation drew ' +
        `after it (${cause instanceof Error ? cause.message : String(cause)})`,
    )
  }
  if (drawn.tag === 'MESSAGR_OPEN_CONVERSATION_FAILED') {
    throw new Error(
      `the conversation could not be derived: ${JSON.stringify(drawn.value)}`,
    )
  }

  if (field(drawn.value, 'received') === true) {
    const decided = await whatCameAfter(mark, ['MESSAGR_BACKUP_OFFER'], 30000)
    if (field(decided.value, 'offer') === true) {
      await waitFor(element(by.id('backup-offer')))
        .toBeVisible()
        .withTimeout(30000)
      await element(by.id('backup-offer-refuse')).tap()
      await waitFor(element(by.id('backup-overlay')))
        .not.toExist()
        .withTimeout(30000)
    }
  }

  await waitFor(element(by.id('conversation-input')))
    .toBeVisible()
    .withTimeout(30000)
}

/** Un champ d'une ligne de journal, sans rien supposer de sa forme. */
function field(value: unknown, name: string): unknown {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)[name]
    : undefined
}
