// LES DIMENSIONS SONT CELLES D'APPLE, DONC ELLES SE VÉRIFIENT CONTRE APPLE.
//
// `capture-ios-store-screenshots.sh` démarre un simulateur, y installe
// l'application et photographie ce qui s'affiche. Rien dans ces gestes ne sait
// si le résultat entrera dans la fiche : `simctl io screenshot` écrit ce que
// l'appareil rend, à la définition de cet appareil, et une classe résolue sur
// le mauvais modèle produit une capture parfaitement nette qu'App Store
// Connect refuse. La console est alors le premier instrument à s'en apercevoir,
// après le téléversement, ce qui est exactement l'endroit où on ne veut pas
// l'apprendre.
//
// Ce fichier est le pendant iOS d'`assert-captures.mjs`. Il en reprend les deux
// gardes — deux captures d'une même série ne peuvent pas être identiques, une
// capture unie pèse presque rien — et y ajoute ce que seul l'iOS impose : des
// tailles en pixels énumérées par Apple, et une exigence par classe d'écran.
//
// # Les tailles, et d'où elles viennent
//
// « Screenshot specifications », developer.apple.com/help/app-store-connect,
// lu le 16 septembre 2026. La page donne pour chaque classe les tailles
// acceptées, en portrait et en paysage, et une phrase d'exigence.
//
// # La classe 6,5 pouces, qui est la question du ticket
//
// La page dit, mot pour mot, pour la ligne des 6,5 pouces :
//
//     Requirement: Required if app runs on iPhone and screenshots for 6.9"
//     display aren't provided
//     Note: If screenshots with the accepted sizes aren't provided, scaled
//     screenshots for 6.9" displays are used.
//
// Donc une capture de 6,9 pouces satisfait l'exigence des 6,5 : la console
// met à l'échelle. Ce n'est pas une raison de n'en produire qu'une. Le
// simulateur `iPhone 11 Pro Max` existe encore sous iOS 26.5 — vérifié le
// 16 septembre 2026, il se crée, démarre et rend 1242x2688 — donc les deux
// classes se photographient pour le prix d'un appareil de plus, et aucune des
// deux cases de la console ne peut être celle qui bloque une soumission.
//
// # L'iPad n'est pas optionnel ici
//
// « Required if app runs on iPad », et `TARGETED_DEVICE_FAMILY = "1,2"` dans
// `project.pbxproj` : l'application tourne sur iPad. La case est donc exigée,
// et ce contrôle la traite comme telle.
//
// # Le témoin, et ce qu'il départage
//
// La capture Android a rendu quatre rectangles blancs identiques un jour où
// tout allait bien par ailleurs, et ce qui a tranché est d'avoir photographié
// l'écran d'accueil du système : la même trame vide en est revenue, donc la
// panne était celle du banc et pas celle de l'application. Le script iOS prend
// ce cliché à chaque fois, avant d'installer quoi que ce soit, et le range
// dans `temoins/`. Une capture identique à son témoin est une capture de
// l'écran d'accueil : l'application n'est jamais venue. C'est une égalité
// exacte, sans seuil.
//
// # Usage
//
//   node scripts/assert-ios-captures.mjs <répertoire>
//   node scripts/assert-ios-captures.mjs --self-test

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { crc32, deflateSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Un PNG uni pèse entre 3 666 et 4 061 octets par mégapixel aux trois
// définitions en jeu ici — mesuré le 16 septembre 2026 en en fabriquant un —
// et la trame blanche qu'avait rendue le banc Android en pesait 3 937. Le
// plancher est le même que côté Android, et pour la même raison : quatre fois
// au-dessus de l'uni, très en dessous d'un écran réel. Il est exprimé par
// mégapixel parce qu'un iPad et un iPhone ne rendent pas le même nombre de
// pixels, et qu'un plancher absolu réglé sur l'un refuserait l'autre.
//
// LA MARGE EST MESURÉE PLUTÔT QU'ESPÉRÉE, parce que l'écran photographié est
// le plus dépouillé de l'application : un fond uni, un logotype et une
// quinzaine de lignes. Les trois vraies captures du 16 septembre 2026 pèsent
// 40 300 octets par mégapixel sur l'iPad — la plus maigre, ses grandes bandes
// vides comprises —, 60 939 et 66 460 sur les deux iPhone. Le plancher est
// donc encore à moins du tiers de la plus pauvre, et à presque quatre fois
// au-dessus de l'uni.
const PLANCHER_PAR_MEGAPIXEL = 15000

// Chaque classe, les tailles qu'Apple accepte en portrait, et ce qu'elle
// exige. Le paysage est la transposée de chaque portrait, et il est dérivé
// plutôt qu'écrit : deux listes à tenir d'accord finissent par ne plus l'être.
const CLASSES = {
  'iphone-6.9': {
    libelle: 'iPhone 6,9 pouces',
    portraits: [
      [1260, 2736],
      [1290, 2796],
      [1320, 2868],
    ],
  },
  'iphone-6.5': {
    libelle: 'iPhone 6,5 pouces',
    portraits: [
      [1284, 2778],
      [1242, 2688],
    ],
  },
  'ipad-13': {
    libelle: 'iPad 13 pouces',
    portraits: [
      [2064, 2752],
      [2048, 2732],
    ],
  },
}

// « Required if app runs on iPad ». Une seule des deux classes d'iPhone
// suffit, l'autre étant mise à l'échelle par la console.
const EXIGENCES = [
  {
    classes: ['ipad-13'],
    pourquoi: 'exigée dès que l’application tourne sur iPad',
  },
  {
    classes: ['iphone-6.9', 'iphone-6.5'],
    pourquoi: 'la console exige l’une des deux et met l’autre à l’échelle',
  },
]

// Un nom se lit `<numéro>-<écran>-<classe>[-<langue>].png`. La langue est
// facultative parce que le script n'en produit pas aujourd'hui : l'application
// ne suit pas la langue de l'appareil sur iOS, et une capture étiquetée `-en`
// qui montre du français serait pire qu'aucune. Le suffixe reste accepté pour
// le jour où elle la suivra.
const NOM_ATTENDU = new RegExp(
  `^(.+)-(${Object.keys(CLASSES)
    .map(c => c.replace('.', '\\.'))
    .join('|')})(-[a-z]{2})?\\.png$`,
)

/**
 * Les dimensions viennent de l'en-tête IHDR, qui est toujours le premier bloc
 * d'un PNG : huit octets de signature, quatre de longueur, quatre de type,
 * puis la largeur et la hauteur en gros-boutiste. Décoder l'image entière
 * demanderait une bibliothèque, et tout ce qui est nécessaire ici est sa
 * taille.
 */
const mesurer = octets => {
  if (octets.length < 24) return null
  if (octets.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return null
  return { largeur: octets.readUInt32BE(16), hauteur: octets.readUInt32BE(20) }
}

const acceptees = classe =>
  CLASSES[classe].portraits.flatMap(([l, h]) => [
    [l, h],
    [h, l],
  ])

const dire = taille => `${taille[0]}x${taille[1]}`

export function verifier(repertoire) {
  const echecs = []
  const echouer = message => echecs.push(message)

  if (!existsSync(repertoire)) {
    return [`${repertoire} n'existe pas`]
  }

  const fichiers = readdirSync(repertoire)
    .filter(nom => nom.endsWith('.png'))
    .sort()

  if (fichiers.length === 0) {
    return [`${repertoire} ne contient aucune capture`]
  }

  const empreintes = new Map()
  const vues = new Set()

  for (const nom of fichiers) {
    const correspondance = NOM_ATTENDU.exec(nom)
    if (!correspondance) {
      // Un fichier dont le nom ne dit pas sa classe est un fichier que
      // personne ne saura poser dans la bonne case de la console, et que ce
      // contrôle ne saurait pas mesurer non plus.
      echouer(
        `${nom} ne nomme pas sa classe. Un nom se lit ` +
          `<numéro>-<écran>-<classe>.png, la classe étant ` +
          `${Object.keys(CLASSES).join(', ')}.`,
      )
      continue
    }

    const classe = correspondance[2]
    const octets = readFileSync(join(repertoire, nom))
    const taille = mesurer(octets)

    if (!taille) {
      echouer(`${nom} n'est pas un PNG`)
      continue
    }

    const permises = acceptees(classe)
    const admise = permises.some(
      ([l, h]) => l === taille.largeur && h === taille.hauteur,
    )
    if (!admise) {
      echouer(
        `${nom} fait ${dire([taille.largeur, taille.hauteur])}, ` +
          `qu'App Store Connect n'accepte pas pour ${CLASSES[classe].libelle}. ` +
          `Les tailles admises sont ${permises.map(dire).join(', ')}. ` +
          `Le simulateur qui a servi n'est pas de cette classe.`,
      )
      continue
    }
    vues.add(classe)

    const megapixels = (taille.largeur * taille.hauteur) / 1e6
    const parMegapixel = Math.round(octets.length / megapixels)
    if (parMegapixel < PLANCHER_PAR_MEGAPIXEL) {
      echouer(
        `${nom} pèse ${parMegapixel} octets par mégapixel, sous le plancher ` +
          `de ${PLANCHER_PAR_MEGAPIXEL}. Une surface unie compresse jusque-là ; ` +
          `un écran avec du texte, jamais. Rien n'a été rendu.`,
      )
    }

    // CE QUE CETTE GARDE ATTRAPE, ET CE QU'ELLE NE PEUT PAS ATTRAPER. Deux
    // classes rendent deux définitions différentes, donc une égalité octet
    // pour octet ne peut signifier qu'un fichier copié sur un autre. Elle est
    // exacte dans ce sens et muette dans l'autre : le 16 septembre 2026, deux
    // lancements du même écran sur le même appareil ont rendu deux fichiers
    // qui différaient de onze octets sur deux cent trente mille, pour une
    // image identique à l'œil. « Différents » ne veut donc pas dire « deux
    // écrans différents », et aucune comparaison d'octets ne le dira.
    const empreinte = createHash('sha256').update(octets).digest('hex')
    const jumelle = empreintes.get(empreinte)
    if (jumelle) {
      echouer(
        `${nom} est octet pour octet identique à ${jumelle}. Deux captures ` +
          `d'une même série ne peuvent pas l'être : deux classes rendent deux ` +
          `définitions différentes. Un fichier a été copié sur un autre.`,
      )
    } else {
      empreintes.set(empreinte, nom)
    }

    // Le témoin est l'écran d'accueil du simulateur, pris avant que
    // l'application n'y soit installée. Une capture qui lui est égale est une
    // capture de cet écran d'accueil.
    const temoin = join(repertoire, 'temoins', `${classe}.png`)
    if (!existsSync(temoin)) {
      echouer(
        `${nom} n'a pas de témoin à temoins/${classe}.png. C'est le cliché de ` +
          `l'écran d'accueil du simulateur, pris avant l'installation, et ` +
          `c'est lui qui départage « l'application n'a rien dessiné » de « ce ` +
          `banc ne rend rien ». Sans lui, une capture de l'écran d'accueil ` +
          `passerait pour une capture du produit.`,
      )
    } else if (readFileSync(temoin).equals(octets)) {
      echouer(
        `${nom} est identique au témoin temoins/${classe}.png, qui est ` +
          `l'écran d'accueil du simulateur. L'application n'est jamais venue ` +
          `au premier plan.`,
      )
    }
  }

  for (const exigence of EXIGENCES) {
    if (!exigence.classes.some(classe => vues.has(classe))) {
      echouer(
        `aucune capture pour ${exigence.classes
          .map(c => CLASSES[c].libelle)
          .join(' ni ')} — ${exigence.pourquoi}. ` +
          `App Store Connect refuse la soumission sans elle.`,
      )
    }
  }

  return echecs
}

// ── Le contrôle du contrôle ───────────────────────────────────────────────
//
// `scripts/` n'a pas de harnais de tests, et la table de tailles ci-dessus est
// la seule chose que ce fichier sait. Elle est donc exercée ici, comme
// `release-notes.mjs` et `testflight-reviewer.mjs` exercent la leur, et la
// chaîne d'intégration lance ce mode à chaque poussée. Sans lui, une taille
// fautive serait découverte par App Store Connect.

// DE VRAIS PNG, ET PAS DES EN-TÊTES BRICOLÉS. Ce contrôle ne lit aujourd'hui
// que la signature, l'IHDR et la taille du fichier, donc huit octets et un
// bloc suffiraient à le tromper dans les deux sens. Des fichiers que `sips` ou
// n'importe quel visualiseur ouvrent coûtent quinze lignes de plus et gardent
// le contrôle libre d'en lire davantage un jour sans que ses propres vignettes
// deviennent le premier obstacle. `zlib.crc32` plutôt qu'une somme écrite à la
// main : Node la donne depuis la 22.2, et le dépôt exige au moins 22.22.
const pngDe = (largeur, hauteur, uni, graine = 0) => {
  const lignes = []
  for (let y = 0; y < hauteur; y += 1) {
    const ligne = Buffer.alloc(largeur * 3 + 1)
    if (!uni) {
      for (let x = 0; x < largeur; x += 1) {
        // Du bruit, pour peser ce que pèse un écran chargé de texte. Le
        // motif est déterministe : deux appels avec les mêmes arguments
        // rendent le même fichier, ce dont le test des doublons a besoin.
        // La graine sépare un témoin d'une capture, comme l'écran d'accueil
        // d'un simulateur diffère de l'application qui tourne dessus.
        ligne[x * 3 + 1] = (x * 31 + y * 17 + graine) % 251
        ligne[x * 3 + 2] = (x * 7 + y * 53 + graine) % 241
        ligne[x * 3 + 3] = (x * 97 + y * 3 + graine) % 239
      }
    }
    lignes.push(ligne)
  }
  const bloc = (type, donnees) => {
    const entete = Buffer.alloc(8)
    entete.writeUInt32BE(donnees.length, 0)
    entete.write(type, 4, 'ascii')
    const somme = Buffer.alloc(4)
    somme.writeUInt32BE(
      crc32(Buffer.concat([Buffer.from(type, 'ascii'), donnees])),
      0,
    )
    return Buffer.concat([entete, donnees, somme])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(largeur, 0)
  ihdr.writeUInt32BE(hauteur, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    bloc('IHDR', ihdr),
    bloc('IDAT', deflateSync(Buffer.concat(lignes), { level: 9 })),
    bloc('IEND', Buffer.alloc(0)),
  ])
}

function selfTest() {
  const cas = []
  const poser = (nom, construire, attendu) =>
    cas.push({ nom, construire, attendu })

  const ecrire = (racine, chemin, octets) => {
    const complet = join(racine, chemin)
    mkdirSync(join(complet, '..'), { recursive: true })
    writeFileSync(complet, octets)
  }

  const completeEtSaine = racine => {
    for (const [classe, taille] of [
      ['iphone-6.9', [1320, 2868]],
      ['iphone-6.5', [1242, 2688]],
      ['ipad-13', [2064, 2752]],
    ]) {
      ecrire(
        racine,
        `temoins/${classe}.png`,
        pngDe(taille[0], taille[1], false, 97),
      )
      ecrire(
        racine,
        `01-promesse-${classe}.png`,
        pngDe(taille[0], taille[1], false),
      )
    }
  }

  poser('une série complète passe', completeEtSaine, 0)

  poser(
    'une capture à la mauvaise taille est refusée',
    racine => {
      completeEtSaine(racine)
      ecrire(racine, '01-promesse-ipad-13.png', pngDe(1179, 2556, false))
    },
    1,
  )

  poser(
    'une classe exigée absente est refusée',
    racine => {
      completeEtSaine(racine)
      // L'iPad retiré : la console refuse la soumission sans lui.
      unlinkSync(join(racine, '01-promesse-ipad-13.png'))
    },
    1,
  )

  poser(
    'une capture unie est refusée',
    racine => {
      completeEtSaine(racine)
      ecrire(racine, '01-promesse-ipad-13.png', pngDe(2064, 2752, true))
    },
    1,
  )

  poser(
    'une capture égale à son témoin est refusée',
    racine => {
      completeEtSaine(racine)
      const temoin = pngDe(1242, 2688, false)
      ecrire(racine, 'temoins/iphone-6.5.png', temoin)
      ecrire(racine, '01-promesse-iphone-6.5.png', temoin)
    },
    1,
  )

  poser(
    'deux captures identiques sont refusées',
    racine => {
      completeEtSaine(racine)
      ecrire(racine, '02-promesse-iphone-6.5.png', pngDe(1242, 2688, false))
    },
    1,
  )

  poser(
    'un nom qui ne dit pas sa classe est refusé',
    racine => {
      completeEtSaine(racine)
      ecrire(racine, 'capture.png', pngDe(1242, 2688, false))
    },
    1,
  )

  poser(
    'un témoin manquant est refusé',
    racine => {
      completeEtSaine(racine)
      unlinkSync(join(racine, 'temoins/ipad-13.png'))
    },
    1,
  )

  let rates = 0
  for (const { nom, construire, attendu } of cas) {
    const racine = mkdtempSync(join(tmpdir(), 'messagr-captures-'))
    construire(racine)
    const echecs = verifier(racine)
    const obtenu = echecs.length > 0 ? 1 : 0
    if (obtenu !== attendu) {
      rates += 1
      console.error(
        `self-test: ${nom} : attendu ${attendu === 0 ? 'accepté' : 'refusé'}, ` +
          `obtenu ${obtenu === 0 ? 'accepté' : 'refusé'}`,
      )
      for (const echec of echecs) console.error(`    ${echec}`)
    }
  }

  if (rates > 0) {
    console.error(
      `self-test: ${rates} cas sur ${cas.length} ne décident pas juste`,
    )
    process.exit(1)
  }
  console.log(`self-test: ${cas.length} cas, la table de tailles décide juste`)
}

const argument = process.argv[2]
if (argument === '--self-test') {
  selfTest()
} else if (!argument) {
  console.error('usage: node scripts/assert-ios-captures.mjs <répertoire>')
  console.error('       node scripts/assert-ios-captures.mjs --self-test')
  process.exit(2)
} else {
  const echecs = verifier(argument)
  for (const echec of echecs) console.error(`captures: FAIL: ${echec}`)
  if (echecs.length > 0) process.exit(1)
  const combien = readdirSync(argument).filter(n => n.endsWith('.png')).length
  console.log(
    `captures: ${combien} captures, aux tailles qu'App Store Connect accepte`,
  )
}
