/**
 * L'ordre dans lequel les fichiers du banc passent, écrit plutôt que subi.
 *
 * # CE QUI DÉCIDAIT DE CET ORDRE, ET QUI N'EST PAS UNE DÉCISION
 *
 * Jest trie les fichiers par DURÉE quand son cache en connaît une, et par
 * TAILLE EN OCTETS quand il n'en connaît pas -- le plus gros d'abord
 * (`@jest/test-sequencer`). Un runner de CI est neuf à chaque run : il n'y a
 * jamais de cache, donc l'ordre du banc était celui de deux nombres d'octets.
 *
 * `boot.test.ts` pesait 30 649 octets et `roundTrip.test.ts` 29 919 : boot
 * passait en premier, depuis toujours, sans que personne l'ait voulu ni
 * écrit. #276 a ajouté cent vingt-huit lignes à `roundTrip.test.ts`, qui est
 * passé à 35 622 octets et donc devant -- et un test que cette branche ne
 * touche pas a rougi.
 *
 * # POURQUOI L'ORDRE COMPTE ICI, ET CE N'EST PAS UN DÉFAUT DU BANC
 *
 * Les deux suites entrent dans LE MÊME salon du banc :
 * `provision-bench-accounts.sh` crée un salon et y invite les deux entrants,
 * un par suite. Le salon compte donc trois comptes joints une fois les deux
 * suites entrées, et deux tant qu'une seule l'est.
 *
 * Or « names the sender » assert la ligne « Se présente comme », et le
 * produit ne la pose QUE là où elle apprend quelque chose : §13.26, et
 * `Conversation.tsx` -- `unexpected` est vrai quand l'autre partie n'est pas
 * désignable, ce que `theOtherMember` refuse de faire au-delà de deux. Dans
 * un salon à deux, la ligne est absente à bon droit.
 *
 * Mesuré sur le run 35103084809, où `roundTrip` est passé le premier :
 * `MESSAGR_RUNTIME` y porte `"whoElse":{"joined":2,"derived":true}` pour ses
 * lancements et `{"joined":3,"derived":false}` pour ceux de boot, qui
 * tournaient après. Le test a cherché `claimed-$…` jusqu'en haut du fil et a
 * échoué sur « Got: was null », c'est-à-dire sur une ligne que le produit
 * avait raison de ne pas afficher.
 *
 * # POURQUOI UN ORDRE ÉCRIT PLUTÔT QU'UN FICHIER MAINTENU PLUS COURT
 *
 * Remettre `roundTrip.test.ts` sous les 30 649 octets rendrait le banc vert
 * aujourd'hui et le laisserait dépendre d'un nombre d'octets que rien ne
 * déclare ni ne vérifie : le prochain commentaire de huit cents octets
 * casserait de nouveau un test que personne n'a touché, avec le même message
 * illisible. C'est exactement le défaut que #276 répare ailleurs -- une
 * garde qui tient par accident -- et le réintroduire ici pour le réparer là
 * n'aurait aucun sens.
 *
 * La dépendance est réelle : elle est donc nommée, et tenue.
 */
const Sequencer = require('@jest/test-sequencer').default

/**
 * Les fichiers dont l'ordre est une exigence, du premier au dernier.
 *
 * Tout ce qui n'est pas listé passe après, dans l'ordre que Jest aurait
 * choisi seul : une suite nouvelle n'a pas à se déclarer ici pour tourner,
 * seulement pour exiger une place.
 */
const ORDERED = ['boot.test.ts', 'roundTrip.test.ts']

const rankOf = test => {
  const rank = ORDERED.indexOf(test.path.split('/').pop())
  return rank === -1 ? ORDERED.length : rank
}

module.exports = class BenchSequencer extends Sequencer {
  // `async`, et pas par goût : Jest attend ce que `sort` rend
  // (`await sequencer.sort(allTests)`), et la classe de base le rend
  // aujourd'hui de façon synchrone. Attendre les deux cas coûte un mot et
  // survit à une version de Jest qui changerait d'avis.
  async sort(tests) {
    // Le tri de Jest d'abord, pour que les fichiers hors de `ORDERED` gardent
    // le sien, puis le nôtre par-dessus : `Array.prototype.sort` est stable
    // depuis ES2019, donc deux fichiers de même rang restent dans l'ordre que
    // Jest leur a donné.
    const sorted = Array.from(await super.sort(tests))
    return sorted.sort((a, b) => rankOf(a) - rankOf(b))
  }
}
