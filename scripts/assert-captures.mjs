// UNE CAPTURE BLANCHE EST UNE CAPTURE RATÉE, ET RIEN NE LE DISAIT.
//
// Le 7 septembre 2026, `capture-store-screenshots.sh` a tourné sur un banc où
// Metro écoutait et où `eu.messagr/.MainActivity` était bien au premier plan.
// Il a produit quatre fichiers, imprimé « store screenshots captured », et
// sorti zéro. Les quatre étaient le MÊME rectangle blanc de 1080 par 2400,
// octet pour octet identiques : même empreinte pour le thème clair et le
// thème sombre, et pour deux écrans différents.
//
// Le script ne pouvait pas s'en apercevoir. Il éteint l'application, la
// relance, attend vingt-cinq secondes et photographie ce qu'il y a. Sa seule
// garantie est de ne tourner qu'après une suite verte, et cette garantie porte
// sur le COMPORTEMENT que les essais ont vérifié, pas sur ce que l'écran
// affichait à l'instant du `screencap`.
//
// Deux propriétés suffisent à attraper ce cas, et aucune des deux ne demande
// de décoder l'image.
//
// # 1. Deux captures d'une même série ne peuvent pas être identiques
//
// C'est la plus forte des deux, et elle est exacte : aucun seuil, aucun
// réglage. Le thème clair et le thème sombre d'un même écran diffèrent par
// construction, puisque `color.dark` est une seconde palette complète. Deux
// écrans différents diffèrent aussi. Une égalité octet pour octet ne peut
// signifier qu'une chose : l'appareil a montré la même chose deux fois, et le
// script ne le savait pas.
//
// # 2. Une capture unie pèse presque rien
//
// Un PNG compresse une surface unie jusqu'à la disparition. Le rectangle blanc
// ci-dessus pesait 10 195 octets pour 2,59 mégapixels, soit environ 3 900
// octets par mégapixel. Une vraie capture d'interface, avec du texte, des
// bulles et une barre, se situe entre 40 000 et 200 000. Le plancher est donc
// posé à 15 000 octets par mégapixel : quatre fois au-dessus du blanc, très en
// dessous du plus dépouillé des écrans réels.
//
// Il est exprimé PAR MÉGAPIXEL et non en octets, parce que les bancs n'ont pas
// tous la même définition et qu'un plancher absolu réglé sur un Pixel refuserait
// les captures d'un écran plus petit sans que personne ne comprenne pourquoi.
//
// # Usage
//
//   node scripts/assert-captures.mjs <répertoire>
//
// Il lit un répertoire de captures, celui que la course vient de produire ou
// celui d'un artefact d'intégration continue téléchargé plus tard.

import { readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

const PLANCHER_PAR_MEGAPIXEL = 15000

const repertoire = process.argv[2]
if (!repertoire) {
  console.error('usage: node scripts/assert-captures.mjs <répertoire>')
  process.exit(2)
}

let echecs = 0
const echouer = message => {
  console.error(`captures: FAIL: ${message}`)
  echecs += 1
}

const fichiers = readdirSync(repertoire)
  .filter(nom => nom.endsWith('.png'))
  .sort()

if (fichiers.length === 0) {
  echouer(`${repertoire} ne contient aucune capture`)
  process.exit(1)
}

// Les dimensions viennent de l'en-tête IHDR, qui est toujours le premier bloc
// d'un PNG : huit octets de signature, quatre de longueur, quatre de type,
// puis la largeur et la hauteur en gros-boutiste. Décoder l'image entière
// demanderait une bibliothèque, et tout ce qui est nécessaire ici est sa
// taille.
const mesurer = octets => {
  const signature = octets.subarray(0, 8).toString('hex')
  if (signature !== '89504e470d0a1a0a') {
    return null
  }
  return { largeur: octets.readUInt32BE(16), hauteur: octets.readUInt32BE(20) }
}

const empreintes = new Map()

for (const nom of fichiers) {
  const octets = readFileSync(join(repertoire, nom))
  const taille = mesurer(octets)

  if (!taille) {
    echouer(`${nom} n'est pas un PNG`)
    continue
  }

  const megapixels = (taille.largeur * taille.hauteur) / 1e6
  const parMegapixel = Math.round(octets.length / megapixels)
  if (parMegapixel < PLANCHER_PAR_MEGAPIXEL) {
    echouer(
      `${nom} pèse ${parMegapixel} octets par mégapixel, sous le plancher de ` +
        `${PLANCHER_PAR_MEGAPIXEL}. Une surface unie compresse jusque-là ; un écran ` +
        `avec du texte, jamais. L'application n'a probablement rien dessiné.`,
    )
  }

  const empreinte = createHash('sha256').update(octets).digest('hex')
  const jumelle = empreintes.get(empreinte)
  if (jumelle) {
    echouer(
      `${nom} est octet pour octet identique à ${jumelle}. Deux captures d'une ` +
        `même série ne peuvent pas l'être : deux thèmes diffèrent par construction, ` +
        `deux écrans aussi. L'appareil a montré la même chose deux fois.`,
    )
  } else {
    empreintes.set(empreinte, nom)
  }
}

if (echecs > 0) {
  process.exit(1)
}

console.log(
  `captures: ${fichiers.length} captures, toutes distinctes et aucune unie`,
)
