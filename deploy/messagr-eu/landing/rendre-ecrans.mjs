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

import {
  readdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdtempSync,
  rmSync,
  cpSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ici = dirname(fileURLToPath(import.meta.url))
const sources = join(ici, 'ecrans')
const site = join(ici, '..', 'site')

// Un Pixel : la page d'invitation se comporte différemment selon l'appareil,
// et c'est l'état téléphone qu'il faut montrer.
const TELEPHONE =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126 Mobile Safari/537.36'

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

// ── LA PAGE D'INVITATION, QUI N'EST PAS UN ÉCRAN D'APPLICATION ────────────
//
// Les cinq ci-dessus viennent du prototype de conception. Celle-ci est la
// VRAIE page, celle que le site sert : c'est la première chose qu'une personne
// invitée voit, avant d'avoir rien installé, et le parcours en trois images de
// la page d'accueil commence par elle.
//
// Rendue avec l'agent d'un téléphone, parce que c'est le seul appareil pour
// lequel ce parcours existe -- et parce que la version bureau montre un code QR
// qui ne veut rien dire dans une illustration.
//
// L'ADRESSE DU TÉLÉCHARGEMENT EST LUE DANS `deploy.sh`, JAMAIS RECOPIÉE. Elle
// y est dérivée du nom du fichier et non configurable, exprès (voir son
// en-tête). L'écrire une seconde fois ici, c'est deux vérités qui se
// contrediront le jour où l'une bouge ; la lire, c'est zéro.
const deploiement = readFileSync(join(ici, '..', 'deploy.sh'), 'utf8')
const adresse = /^APK_URL="([^"]+)"$/m.exec(deploiement)
if (!adresse) {
  console.error(
    "rendre-ecrans: FAIL: `APK_URL` est introuvable dans deploy.sh. L'adresse " +
      'du téléchargement ne doit pas être recopiée ici : si elle a changé de ' +
      'forme, ajustez la lecture.',
  )
  process.exit(1)
}
const apkUrl = adresse[1].replace('$APK_NAME', 'messagr.apk')

const atelier = mkdtempSync(join(tmpdir(), 'ecran-invitation-'))
try {
  const pageSource = join(site, 'i', 'index.html')
  const page = readFileSync(pageSource, 'utf8')
  const fente = "androidApk: ''"
  if (!page.includes(fente)) {
    console.error(
      `rendre-ecrans: FAIL: la page d'invitation ne porte plus la fente ` +
        `\`${fente}\`. Sans destination, l'illustration montrerait la phrase ` +
        `d'attente au lieu du téléchargement que le site propose vraiment.`,
    )
    process.exit(1)
  }
  cpSync(join(site, 'i'), join(atelier, 'i'), { recursive: true })
  writeFileSync(
    join(atelier, 'i', 'index.html'),
    page.replace(fente, `androidApk: '${apkUrl}'`),
  )

  const sortie = join(site, 'messagr-ecran-invitation.png')
  execFileSync(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      // La page se traduit pour le navigateur qui la lit ; l'illustration est
      // française comme les cinq autres.
      '--accept-lang=fr-FR,fr',
      `--user-agent=${TELEPHONE}`,
      `--screenshot=${sortie}`,
      '--window-size=520,460',
      '--force-device-scale-factor=2',
      '--virtual-time-budget=4000',
      `file://${join(atelier, 'i', 'index.html')}`,
    ],
    { stdio: 'pipe' },
  )
  if (!existsSync(sortie)) {
    console.error("rendre-ecrans: FAIL: la page d'invitation n'a rien produit")
    process.exit(1)
  }
  console.log('  invitation')
  faits += 1
} finally {
  rmSync(atelier, { recursive: true, force: true })
}

console.log(`rendre-ecrans: ${faits} écrans`)
