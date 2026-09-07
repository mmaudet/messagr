// LES SIX DÉTAILS DE CONVERSATION DU HERO.
//
// Une conversation française sur `/de/` annulerait ce que les six adresses
// corrigent, donc il y en a une par langue. Les deux phrases sont de
// l'illustration et non de la copie produit : elles ne vivent pas dans
// `landing/copy.json`, que le générateur confronte au balisage de la page, mais
// ici, avec l'image qu'elles habitent.
//
// Le rendu demande un navigateur, donc il n'est pas fait à la construction :
// l'intégration continue n'en a pas, et en ajouter un pour une image qui change
// une fois par an est un mauvais marché. Les PNG sont versionnés à côté, et
// cette commande les refait :
//
//     node deploy/messagr-eu/landing/rendre-conversation.mjs
//
// La provenance de l'écran, et les trois choses qui en ont été retirées parce
// qu'elles ne tournent pas encore, sont expliquées en tête de
// `landing/conversation.html`.

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const ici = dirname(fileURLToPath(import.meta.url))
const site = join(ici, '..', 'site')

const CHROME =
  process.env.MESSAGR_CHROME ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

// Des phrases de tous les jours, courtes, sans terme de produit : ce qu'on
// écrit vraiment à quelqu'un, et le plus facile à traduire sans le trahir.
// Le séparateur de jour est la troisième marque, et il vaut son commentaire :
// « Hier » laissé tel quel sur la page allemande se lit « ici ». Un faux ami
// dans une image, personne ne le corrige jamais parce que personne ne relit une
// image.
const PHRASES = {
  fr: [
    'Tu passes toujours vendredi ?',
    'Oui, vers 18 h. Je ramène le dossier.',
    'Hier',
  ],
  en: [
    'Still coming on Friday?',
    "Yes, around six. I'll bring the file.",
    'Yesterday',
  ],
  de: [
    'Kommst du Freitag noch?',
    'Ja, gegen 18 Uhr. Ich bringe die Mappe mit.',
    'Gestern',
  ],
  es: [
    '¿Sigues viniendo el viernes?',
    'Sí, sobre las seis. Llevo el expediente.',
    'Ayer',
  ],
  it: ['Passi sempre venerdì?', 'Sì, verso le 18. Porto il fascicolo.', 'Ieri'],
  nl: [
    'Kom je vrijdag nog steeds?',
    'Ja, rond zes uur. Ik neem het dossier mee.',
    'Gisteren',
  ],
}

const gabarit = readFileSync(join(ici, 'conversation.html'), 'utf8')
const travail = mkdtempSync(join(tmpdir(), 'conversation-'))

const echapper = t =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

for (const [langue, [question, reponse, veille]] of Object.entries(PHRASES)) {
  const page = gabarit
    .split('%QUESTION%')
    .join(echapper(question))
    .split('%REPONSE%')
    .join(echapper(reponse))
    .split('%VEILLE%')
    .join(echapper(veille))
  if (/%[A-Z]+%/.test(page)) {
    console.error(
      `rendre-conversation: FAIL: une marque a survécu en ${langue}`,
    )
    process.exit(1)
  }
  const source = join(travail, `${langue}.html`)
  writeFileSync(source, page)

  const plein = join(travail, `${langue}-plein.png`)
  execFileSync(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      `--screenshot=${plein}`,
      '--window-size=520,305',
      '--force-device-scale-factor=2',
      '--virtual-time-budget=4000',
      `file://${source}`,
    ],
    { stdio: 'pipe' },
  )

  // LE CADRAGE EST CELUI DE LA FENÊTRE, ET PLUS CELUI DE `sips`. La source
  // extraite a perdu la contrainte de hauteur du cadre de téléphone, donc le
  // rendu traîne du vide sous le composeur. Une première version le coupait
  // avec `sips -c` : l'outil recadre en CENTRANT, `--cropOffset 0 0` ou non,
  // et le nom du correspondant se retrouvait tranché en haut de l'image.
  // Dimensionner la fenêtre au contenu n'a pas ce défaut, et supprime un
  // outil au passage.
  const sortie = join(site, `messagr-conversation-${langue}.png`)
  execFileSync('cp', [plein, sortie], { stdio: 'pipe' })
  console.log(`  ${langue}`)
}

rmSync(travail, { recursive: true, force: true })
console.log(
  `rendre-conversation: ${Object.keys(PHRASES).length} détails, un par langue`,
)
