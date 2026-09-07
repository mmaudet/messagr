// UNE ADRESSE PAR LANGUE, ET CHAQUE PAGE ENTIÈRE SANS SCRIPT.
//
// La page d'accueil parlait six langues à une seule URL : le français était
// dans le balisage et un script remplaçait les phrases selon
// `navigator.languages`. Trois conséquences, et la troisième est la pire :
//
//   - un moteur de recherche n'indexait que le français ;
//   - il n'existait aucun `hreflang`, donc rien ne reliait les six versions ;
//   - on ne pouvait pas envoyer « la page en allemand » à quelqu'un, puisque
//     l'adresse était la même et que le rendu dépendait du lecteur.
//
// Cinq marchés sur six étaient invisibles.
//
// # Ce que ce générateur produit
//
// `/` reste le français, et reste LA SOURCE. C'est délibéré : la page
// française est un gabarit qui s'ouvre dans un navigateur et se relit comme
// une page, pas un fichier à trous. La propriété dont l'ancienne version était
// fière -- sans script, la page est française et entière -- devient : sans
// script, CHAQUE page est entière dans sa langue.
//
// Les cinq autres sont écrites à côté, `/en/`, `/de/`, `/es/`, `/it/`, `/nl/`,
// en remplaçant le texte de chaque élément marqué `data-t`. Les six reçoivent
// un `canonical` et le jeu complet des `hreflang`, x-default compris.
//
// # Le refus, et pourquoi il est là
//
// Une clé marquée dans la page et absente du catalogue, ou l'inverse, arrête
// la construction. Un remplacement qui ne remplace rien aussi. C'est la règle
// de `build-site.sh`, pour la raison écrite dans son en-tête : une
// substitution silencieusement sans effet produit un déploiement vert et une
// page fausse. Ici elle produirait une page allemande avec une phrase
// française au milieu, et personne ne la lirait avant un lecteur allemand.
//
// # Usage
//
//   node build-landing.mjs <répertoire construit>
//
// Il travaille sur l'arbre DÉJÀ COPIÉ par build-site.sh, jamais sur `site/`.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ici = dirname(fileURLToPath(import.meta.url))
const CATALOGUE = join(ici, 'landing', 'copy.json')

// Le français est la source et n'a pas de répertoire : il est servi à la
// racine, comme il l'a toujours été. Les liens ne bougent donc pas.
const RACINE = 'fr'
const ORIGINE = 'https://messagr.eu'

const destination = process.argv[2]
if (!destination) {
  console.error('usage: build-landing.mjs <répertoire construit>')
  process.exit(2)
}

const echouer = message => {
  console.error(`build-landing: FAIL: ${message}`)
  process.exit(1)
}

const copie = JSON.parse(readFileSync(CATALOGUE, 'utf8'))
const langues = Object.keys(copie)
if (!langues.includes(RACINE)) {
  echouer(
    `le catalogue ne porte pas « ${RACINE} », qui est la langue de la racine`,
  )
}

const source = join(destination, 'index.html')
let gabarit
try {
  gabarit = readFileSync(source, 'utf8')
} catch {
  echouer(`${source} est introuvable : build-site.sh ne l'a pas copié`)
}

// ── Les clés des deux côtés doivent coïncider ──────────────────────────────
//
// Une clé de plus dans le balisage est une phrase que cinq lecteurs sur six
// verraient en français ; une clé de plus dans le catalogue est une traduction
// que personne n'affiche. Les deux sont des erreurs, et aucune ne se voit.
const marquees = [...gabarit.matchAll(/data-t="([^"]+)"/g)].map(m => m[1])
const uniques = [...new Set(marquees)].sort()
if (marquees.length !== uniques.length) {
  echouer('une clé data-t apparaît deux fois dans la page')
}

for (const langue of langues) {
  const cles = Object.keys(copie[langue]).sort()
  const manque = uniques.filter(c => !cles.includes(c))
  const enTrop = cles.filter(c => !uniques.includes(c))
  if (manque.length) {
    echouer(`le catalogue « ${langue} » ne porte pas ${manque.join(', ')}`)
  }
  if (enTrop.length) {
    echouer(
      `le catalogue « ${langue} » porte ${enTrop.join(', ')}, que la page ne marque pas`,
    )
  }
}

// ── Les liens entre les six ────────────────────────────────────────────────

const cheminDe = langue => (langue === RACINE ? '/' : `/${langue}/`)

// x-default désigne la page servie à qui ne demande rien de particulier, et
// c'est la racine. Sans lui, un moteur choisit lui-même, ce qui revient à ne
// pas décider.
const liens = langues
  .map(
    l =>
      `<link rel="alternate" hreflang="${l}" href="${ORIGINE}${cheminDe(l)}">`,
  )
  .concat(
    `<link rel="alternate" hreflang="x-default" href="${ORIGINE}${cheminDe(RACINE)}">`,
  )
  .join('\n')

// ── Le remplacement, qui refuse de ne rien faire ───────────────────────────
//
// La référence arrière `\2` reprend le nom de la balise ouvrante, donc la
// fermeture est forcément la sienne. `[^<]*` au milieu dit que le contenu ne
// porte aucune balise : c'est vrai de ces treize éléments, et si cela cessait
// de l'être le compte ci-dessous tomberait à zéro et la construction
// s'arrêterait plutôt que de produire une page tronquée.
const remplacer = (html, cle, valeur, langue) => {
  const motif = new RegExp(
    `(<([a-z0-9]+)[^>]*\\bdata-t="${cle}"[^>]*>)[^<]*(</\\2>)`,
    'g',
  )
  let vus = 0
  const sortie = html.replace(motif, (entier, ouvrante, balise, fermante) => {
    vus += 1
    return ouvrante + echapper(valeur) + fermante
  })
  if (vus !== 1) {
    echouer(
      `« ${cle} » a été remplacée ${vus} fois dans la page ${langue}, une attendue. ` +
        `Un remplacement sans effet laisse la phrase française au milieu d'une ` +
        `page qui ne l'est pas.`,
    )
  }
  return sortie
}

const echapper = texte =>
  texte.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// LA PRÉSENCE SE VÉRIFIE AVANT LE REMPLACEMENT, PAS APRÈS. Comparer l'avant et
// l'après confond deux choses très différentes : la balise absente, et la
// balise remplacée par la valeur qu'elle portait déjà. C'est exactement le cas
// du français, dont la page est la source : `lang="fr"` remplacé par
// `lang="fr"` ne change rien, et la construction s'arrêtait en annonçant une
// balise introuvable qui était sous ses yeux.
const exigerUneFois = (html, motif, quoi, langue) => {
  const trouves = html.match(motif)
  if (!trouves || trouves.length !== 1) {
    echouer(
      `${quoi} apparaît ${trouves ? trouves.length : 0} fois dans la page ${langue}, une attendue`,
    )
  }
}

const entete = (html, langue) => {
  const motifLang = /<html lang="[^"]*">/g
  exigerUneFois(html, motifLang, 'la balise <html lang="…">', langue)
  let sortie = html.replace(motifLang, `<html lang="${langue}">`)

  // La description reprend le titre et le chapô plutôt qu'une phrase de plus à
  // traduire : une septième chaîne par langue serait une septième à oublier.
  const description = `${copie[langue].titre} ${copie[langue].chapo}`
  const motifDesc = /<meta name="description" content="[^"]*">/g
  exigerUneFois(
    sortie,
    motifDesc,
    'la balise <meta name="description">',
    langue,
  )
  sortie = sortie.replace(
    motifDesc,
    `<meta name="description" content="${echapper(description).replace(/"/g, '&quot;')}">`,
  )
  // L'APERÇU DE LIEN, PAR LANGUE. Une carte française sur `/de/` annulerait ce
  // que les six adresses viennent de corriger, et c'est la surface par laquelle
  // ce produit se diffuse : quelqu'un envoie un lien à quelqu'un.
  //
  // Chaque balise est exigée avant d'être réécrite, pour la raison écrite plus
  // haut : une balise renommée doit arrêter la construction plutôt que de se
  // faire remplacer par rien, en silence.
  const social = [
    ['og:title', copie[langue].titre],
    ['og:description', copie[langue].chapo],
    ['og:url', `${ORIGINE}${cheminDe(langue)}`],
    ['og:image', `${ORIGINE}/messagr-partage-${langue}.png`],
  ]
  for (const [propriete, valeur] of social) {
    const motif = new RegExp(
      `<meta property="${propriete}" content="[^"]*">`,
      'g',
    )
    exigerUneFois(
      sortie,
      motif,
      `la balise <meta property="${propriete}">`,
      langue,
    )
    sortie = sortie.replace(
      motif,
      `<meta property="${propriete}" content="${echapper(valeur).replace(/"/g, '&quot;')}">`,
    )
  }

  const canonique = `<link rel="canonical" href="${ORIGINE}${cheminDe(langue)}">`
  return sortie.replace('</head>', `${canonique}\n${liens}\n</head>`)
}

// ── Le plan du site ────────────────────────────────────────────────────────
//
// Six adresses et les deux pages légales. La page d'invitation n'y est pas :
// elle n'a pas de contenu propre à indexer, elle répond les mêmes octets pour
// tout jeton, et l'inscrire reviendrait à proposer à un moteur de parcourir
// des jetons.
// ── Ce que pèse le téléchargement ─────────────────────────────────────────
//
// MESURÉ, JAMAIS TAPÉ. Un chiffre écrit à la main est périmé au premier
// changement du fichier, et rien ne le dirait : c'est la faute que
// `build-site.sh` a été écrit pour rendre impossible sur les destinations.
//
// Les trois valeurs viennent de l'environnement, que `deploy.sh` exporte après
// avoir lu le fichier qu'il s'apprête à envoyer. Un jeu INCOMPLET arrête la
// construction : annoncer un poids sans dire de quel fichier il est vaut moins
// que se taire. Un jeu VIDE est légitime — c'est le cas de l'intégration
// continue, qui n'a pas l'APK : les deux lignes de faits sortent alors de la
// page plutôt que d'y afficher leurs marques.
//
// PAS DE NUMÉRO DE VERSION, ET C'EST UNE DÉCISION. `aapt2` lit
// versionName='1.0' et versionCode='1' sur le fichier en ligne, jamais
// incrémentés depuis la première construction. Les annoncer ressemblerait à
// une information et n'en serait pas une. L'empreinte, elle, distingue deux
// constructions et se vérifie en une commande.
const CLES_DE_FAITS = ['apk-faits', 'apk-empreinte']

const faitsDuTelechargement = () => {
  const octets = process.env.MESSAGR_APK_OCTETS || ''
  const empreinte = process.env.MESSAGR_APK_SHA256 || ''
  const date = process.env.MESSAGR_APK_DATE || ''
  const donnes = [octets, empreinte, date].filter(Boolean).length
  if (donnes === 0) return null
  if (donnes !== 3) {
    echouer(
      'les faits du téléchargement sont incomplets : MESSAGR_APK_OCTETS, ' +
        'MESSAGR_APK_SHA256 et MESSAGR_APK_DATE se donnent ensemble ou pas du tout',
    )
  }
  if (!/^[0-9]+$/.test(octets)) {
    echouer(
      `MESSAGR_APK_OCTETS vaut « ${octets} », qui n'est pas un nombre d'octets`,
    )
  }
  if (!/^[0-9a-f]{64}$/.test(empreinte)) {
    echouer(
      `MESSAGR_APK_SHA256 vaut « ${empreinte} », qui n'est pas une empreinte SHA-256`,
    )
  }
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)) {
    echouer(`MESSAGR_APK_DATE vaut « ${date} », qui n'est pas une date ISO`)
  }
  return { octets: Number(octets), empreinte, date }
}

// Le séparateur décimal et le nom du mois viennent d'`Intl`, donc de la langue
// de la page : « 132,6 Mo » et « 132.6 MB » sont le même chiffre écrit pour
// deux lecteurs, et chacun se lit mal dans la langue de l'autre.
const ecrireLesFaits = (html, langue, faits) => {
  if (!faits) {
    for (const cle of CLES_DE_FAITS) {
      const motif = new RegExp(
        `\\n\\s*<p[^>]*\\bdata-t="${cle}"[^>]*>[^<]*</p>`,
        'g',
      )
      exigerUneFois(html, motif, `le paragraphe « ${cle} »`, langue)
      html = html.replace(motif, '')
    }
    return html
  }
  const taille =
    new Intl.NumberFormat(langue, { maximumFractionDigits: 1 }).format(
      faits.octets / (1024 * 1024),
    ) + (langue === 'fr' ? ' Mo' : ' MB')
  const date = new Intl.DateTimeFormat(langue, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${faits.date}T00:00:00Z`))
  return html
    .split('%TAILLE%')
    .join(taille)
    .split('%DATE%')
    .join(date)
    .split('%EMPREINTE%')
    .join(faits.empreinte)
}

const planDuSite = () => {
  const pages = langues
    .map(l => `${ORIGINE}${cheminDe(l)}`)
    .concat([`${ORIGINE}/confidentialite/`, `${ORIGINE}/conditions-generales/`])
  const entrees = pages.map(u => `  <url><loc>${u}</loc></url>`).join('\n')
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    entrees +
    '\n</urlset>\n'
  )
}

// ── Écriture ───────────────────────────────────────────────────────────────

const faits = faitsDuTelechargement()
let ecrites = 0
for (const langue of langues) {
  let page = gabarit
  if (langue !== RACINE) {
    for (const cle of uniques) {
      page = remplacer(page, cle, copie[langue][cle], langue)
    }
  }
  page = entete(page, langue)
  page = ecrireLesFaits(page, langue, faits)

  // AUCUNE MARQUE NE DOIT SURVIVRE. Une page qui montrerait « %TAILLE% » à un
  // lecteur est pire qu'une page muette : elle a l'air cassée, et elle l'est.
  const restante = /%[A-Z]+%/.exec(page)
  if (restante) {
    echouer(`la page ${langue} porte encore la marque ${restante[0]}`)
  }

  const chemin =
    langue === RACINE ? source : join(destination, langue, 'index.html')
  mkdirSync(dirname(chemin), { recursive: true })
  writeFileSync(chemin, page)
  ecrites += 1
}

writeFileSync(join(destination, 'sitemap.xml'), planDuSite())

console.log(
  `build-landing: ${ecrites} pages, une par langue, chacune entière sans script, ` +
    `et un plan du site de ${langues.length + 2} adresses`,
)
