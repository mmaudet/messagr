// LES CINQ ÉCRANS DE LA GALERIE.
//
// Extraits du prototype de conception, nettoyés de leurs gabarits, et rendus
// ici. Ce ne sont pas des photographies d'une application qui tourne ; la
// provenance et ce qui en a été retiré sont dans `ecrans/LISEZ-MOI.md`.
//
// La conversation n'est pas dans cette liste : elle est rendue dans les six
// langues par `rendre-conversation.mjs`, parce qu'elle est dans le hero et que
// ses trois phrases sont courtes. Ces cinq-là portent des paragraphes, et six
// écrans par six langues feraient trente-six rendus et autant de traductions de
// prose. Les légendes de la page, elles, sont traduites comme le reste.
//
// Le rendu demande un navigateur, donc les PNG sont versionnés à côté :
//
//     node deploy/messagr-eu/landing/rendre-ecrans.mjs

import { readdirSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ici = dirname(fileURLToPath(import.meta.url))
const sources = join(ici, 'ecrans')
const site = join(ici, '..', 'site')

const CHROME =
  process.env.MESSAGR_CHROME ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

// La hauteur est celle du contenu de chaque écran, mesurée une fois. La donner
// plutôt que de recadrer après coup : `sips` recadre en CENTRANT quoi qu'on lui
// passe en offset, et un nom tranché par le haut ne se voit pas dans une image.
const HAUTEURS = {
  'premier-lancement': 520,
  'lien-expire': 440,
  salon: 600,
  agent: 800,
  appel: 450,
}

let faits = 0
for (const fichier of readdirSync(sources).sort()) {
  if (!fichier.endsWith('.html')) {
    continue
  }
  const cle = fichier.replace(/\.html$/, '')
  const hauteur = HAUTEURS[cle]
  if (!hauteur) {
    console.error(`rendre-ecrans: FAIL: aucune hauteur connue pour « ${cle} »`)
    process.exit(1)
  }
  const sortie = join(site, `messagr-ecran-${cle}.png`)
  execFileSync(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      `--screenshot=${sortie}`,
      `--window-size=520,${hauteur}`,
      '--force-device-scale-factor=2',
      '--virtual-time-budget=4000',
      `file://${join(sources, fichier)}`,
    ],
    { stdio: 'pipe' },
  )
  if (!existsSync(sortie)) {
    console.error(`rendre-ecrans: FAIL: ${cle} n'a rien produit`)
    process.exit(1)
  }
  console.log(`  ${cle}`)
  faits += 1
}

console.log(`rendre-ecrans: ${faits} écrans`)
