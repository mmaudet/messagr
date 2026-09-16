import { by, element, waitFor } from 'detox'

import { markTheLog, whatCameAfter, whatItReported } from './reported'

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
 * dessine, avec `received`, puis `MESSAGR_BACKUP_OFFER`, avec `offer`, une
 * fois par conversation ouverte et de nouveau quand la décision change, mais
 * pas à chaque tour de synchronisation (#291). Le test lit les deux après son
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
  // ET PAS AVANT QUE LE LANCEMENT SACHE OUVRIR QUOI QUE CE SOIT.
  //
  // La liste est dessinée depuis le carnet au tout début du lancement
  // (`MESSAGR_LIST_REMEMBERED`), et `App.tsx` ne lie ce qu'une ligne appelle
  // qu'à la fin de son chemin de lancement, après la pompe, la sonde d'envoi
  // et `enterAnyInvitations`.
  //
  // Mesuré sur le run 34717623056, où le test du `m.file` touchait 29 ms
  // après le retour de `launchApp` : Espresso a effectué ses trois touchers
  // 158, 201 et 837 ms au moins avant que la référence soit liée, et aucune
  // conversation ne s'est ouverte. Detox n'avait aucune raison d'attendre :
  // `/sync` est hors de sa synchronisation (longPoll.ts), et c'est un `/sync`
  // que le lancement attendait à chaque fois.
  //
  // CE QUE #280 A CHANGÉ, ET CE QU'IL N'A PAS CHANGÉ. Le produit ne perd plus
  // ce toucher-là : il le garde et l'ouvre dès que le lancement peut
  // (`waitingToOpen.ts`), et la ligne touchée dit « Ouverture… » en
  // attendant. La phrase « un toucher ne fait rien et rien ne le dit » était
  // vraie et ne l'est plus.
  //
  // L'attente ci-dessous reste, et pour une autre raison que celle-là : cet
  // aide-mémoire sert à ouvrir une conversation de façon reproductible dans
  // toute la suite, pas à éprouver la course. Toucher tôt ferait dépendre
  // chaque test qui passe par ici du délai que met le lancement à répondre.
  // Un test qui touche exprès à 29 ms et attend l'ouverture prouverait #280
  // sur un appareil ; il n'existe pas, et ce fichier n'est pas l'endroit.
  //
  // Le signal est le rapport du lancement. `MESSAGR_RUNTIME` n'est écrit
  // qu'au bout du chemin qui lie l'ouverture, et `pump.outcome` à `ran` dit
  // que c'est bien ce chemin-là qu'il a parcouru. Rien n'est attendu au
  // jugé : c'est une ligne que le produit écrit après le moment qui compte.
  //
  // « Stable » ne veut pas dire que la liste ne bouge plus, la boucle la
  // redessine à chaque tour. Ses lignes sont indexées par salon, donc un
  // nouveau dessin garde le même `Pressable` : ce qui décidait du sort d'un
  // toucher, c'était l'état du lancement et non la ligne.
  //
  // Cela suppose le journal vidé avant la relance, comme chaque lancement de
  // cette suite le fait : sinon le rapport lu serait celui du lancement
  // d'avant, et il répondrait tout de suite.
  const launch = await whatItReported(60000)
  if (launch.pump === 'not-configured' || launch.pump.outcome !== 'ran') {
    throw new Error(
      'this launch never bound what a row of the list calls, so a tap ' +
        `could open nothing: ${JSON.stringify(launch.pump)}`,
    )
  }

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
