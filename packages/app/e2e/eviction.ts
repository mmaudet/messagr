import { evictOutcomeTestId } from '../src/runtime/evict'

/**
 * Ce que le banc exige de l'écran après une éviction, et la raison pour
 * laquelle il l'exige ici plutôt que dans le test.
 *
 * # LE DÉFAUT QUE CE FICHIER RÉPARE
 *
 * `roundTrip.test.ts` touchait `evict-confirm`, attendait que `evict-outcome`
 * soit visible, prenait une capture, et s'arrêtait là. L'écran affichait
 * `evict-outcome` pour les quatre issues -- éviction réussie ou non, clé
 * tournée ou non : le texte changeait, le `testID` non. Le test passait donc
 * aussi quand l'éviction échouait, sous un nom qui annonçait une éviction
 * prouvée. C'est #276, et c'est pire qu'un test absent : personne ne va
 * vérifier derrière une garde qui a l'air de fermer la porte.
 *
 * # POURQUOI CETTE GARDE EST UNE FONCTION, ET PAS TROIS LIGNES DE DETOX
 *
 * Une garde qui n'a jamais rougi ne prouve rien, et c'est exactement le
 * défaut qu'on répare. Detox demande un appareil, donc une garde écrite dans
 * le test ne peut être vue échouer qu'au banc, c'est-à-dire jamais pendant
 * qu'on l'écrit.
 *
 * Ici l'écran est un paramètre. `eviction.spec.ts` lui donne un écran qui
 * montre chacune des quatre issues, et montre que la garde rougit sur les
 * trois qui ne sont pas la rotation -- en particulier sur
 * `evict-outcome-no-key`, qui est un SUCCÈS et que le test d'avant acceptait.
 * `roundTrip.test.ts` lui donne Detox. La garde éprouvée est celle qui tourne
 * au banc, à la ligne près.
 *
 * # CE QUE CETTE GARDE PROUVE, ET CE QU'ELLE NE PROUVE PAS
 *
 * Elle prouve que l'application DIT que la clé du salon a tourné. C'est son
 * propre témoignage, et #35 demande mieux : la preuve doit venir d'un client
 * indépendant. `nio_counterparty.py witness-eviction` est ce juge-là, et il
 * dit dans son en-tête ce que le banc lui permet d'établir et ce qu'il ne
 * peut pas.
 */

/** L'issue que le banc exige : retirée, et la clé du salon remplacée. */
export const ROTATED_OUTCOME = evictOutcomeTestId({
  evicted: true,
  rotated: true,
})

/**
 * Les trois autres phrases que cet écran sait dire, et ce que trouver l'une
 * d'elles veut dire pour la conversation.
 *
 * Dérivées de `evictOutcomeTestId` plutôt que recopiées : le produit et le
 * banc nomment ainsi la même issue par construction. Que ces noms soient les
 * bons, et qu'ils soient quatre distincts, est épinglé sur des chaînes
 * écrites en toutes lettres dans `src/runtime/evict.spec.ts` -- sans quoi une
 * fonction qui rendrait le même nom partout passerait des deux côtés.
 */
export const OTHER_OUTCOMES: readonly {
  readonly testID: string
  readonly means: string
}[] = [
  {
    testID: evictOutcomeTestId({ evicted: true, rotated: false }),
    means:
      "la personne est retirée, et aucune clé de cet appareil n'existait " +
      "dans ce salon : rien n'a été remplacé. C'est un succès du geste et " +
      "ce n'est pas une rotation, donc ce banc le refuse -- il vient " +
      "d'envoyer un message dans ce salon, donc une clé de cet appareil y " +
      'existait.',
  },
  {
    testID: evictOutcomeTestId({
      evicted: false,
      stage: 'removing',
      reason: '',
      rotated: false,
    }),
    means:
      "le retrait a été refusé par le homeserver : rien n'a changé, la " +
      'personne est toujours dans la conversation.',
  },
  {
    testID: evictOutcomeTestId({
      evicted: false,
      stage: 'rotating',
      reason: '',
      rotated: false,
    }),
    means:
      'le demi-état dangereux : la personne est dehors et garde une clé qui ' +
      'ouvre encore tout ce qui sera envoyé ensuite.',
  },
]

/**
 * L'écran, réduit à la seule question que cette garde lui pose.
 *
 * `appeared` rend `false` plutôt que de lever : « pas là » est une réponse,
 * et une garde qui prend une absence pour une panne ne peut pas nommer ce
 * qu'elle a trouvé à la place.
 */
export interface OutcomeScreen {
  readonly appeared: (testID: string, within: number) => Promise<boolean>
}

export interface Patience {
  /** Attente accordée à la rotation. Le geste parle à un homeserver. */
  readonly within?: number
  /**
   * Attente accordée à chacune des autres, une fois la première épuisée.
   * Courte : à ce moment l'écran a fini de travailler, on lit ce qu'il dit.
   */
  readonly probe?: number
}

/**
 * Exige que l'écran dise que la clé a tourné, et nomme ce qu'il dit sinon.
 *
 * Échouer n'est pas suffisant : un échec qui dit « `evict-outcome-rotated`
 * introuvable » enverrait chercher un défaut d'affichage là où il y a une
 * éviction refusée. Alors la garde, quand elle ne trouve pas la rotation, va
 * lire les trois autres et rapporte celle qui est à l'écran, avec ce qu'elle
 * veut dire.
 */
export async function demandTheRotation(
  screen: OutcomeScreen,
  { within = 120000, probe = 5000 }: Patience = {},
): Promise<void> {
  if (await screen.appeared(ROTATED_OUTCOME, within)) return

  const instead: string[] = []
  for (const other of OTHER_OUTCOMES) {
    if (await screen.appeared(other.testID, probe)) {
      instead.push(`${other.testID} : ${other.means}`)
    }
  }

  if (instead.length === 0) {
    throw new Error(
      `l'éviction n'a rien dit : ni ${ROTATED_OUTCOME}, ni aucune des trois
       autres issues, après ${within} ms.

       L'écran n'a donc affiché AUCUN résultat -- ce qui n'est pas une
       éviction ratée mais un geste qui n'a pas abouti à un état, ou un écran
       qui a changé sous le test (la personne retirée, « la personne » ne
       désigne plus personne et le panneau disparaît). Lire la capture
       eviction-6-le-resultat et le journal de l'appareil.`,
    )
  }

  throw new Error(
    `la clé du salon n'a pas tourné : ${ROTATED_OUTCOME} n'est pas à l'écran.

     Ce que l'écran dit à la place -- ${instead.join(' ; ')}

     C'est le critère de #35 : « l'éviction fait tourner la clé du salon, et
     c'est la rotation que le test assert, pas le changement d'appartenance ».`,
  )
}
