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

// ── LES PAGES ENGENDRÉES, ET IL Y EN A PLUS D'UNE ─────────────────────────
//
// Ce générateur n'a longtemps connu qu'une page. La deuxième -- celle du
// téléchargement -- n'est pas un cas particulier de la première : elle a son
// propre titre, son propre chapô, ses propres adresses canoniques et son propre
// jeu de `hreflang`. Une liste plutôt qu'un `if`, pour que la troisième ne
// demande qu'une entrée.
//
// `conversation` dit si la page cite l'écran de conversation, qui suit la
// langue. Le mettre en donnée plutôt qu'en test : une page qui ne le cite pas
// n'est pas une page en faute.
const PAGES = [
  {
    nom: 'accueil',
    source: 'index.html',
    dossier: langue => (langue === RACINE ? '' : `${langue}/`),
    titre: 'titre',
    chapo: 'chapo',
    conversation: true,
  },
  {
    nom: 'telechargement',
    source: 'telechargement/index.html',
    dossier: langue =>
      langue === RACINE ? 'telechargement/' : `${langue}/telechargement/`,
    titre: 'dl-titre',
    chapo: 'dl-chapo',
    conversation: false,
  },
]

const lireLeGabarit = page => {
  const chemin = join(destination, page.source)
  try {
    return readFileSync(chemin, 'utf8')
  } catch {
    echouer(`${chemin} est introuvable : build-site.sh ne l'a pas copié`)
    return ''
  }
}

for (const page of PAGES) {
  page.gabarit = lireLeGabarit(page)
}

// ── Les clés des deux côtés doivent coïncider ──────────────────────────────
//
// Une clé de plus dans le balisage est une phrase que cinq lecteurs sur six
// verraient en français ; une clé de plus dans le catalogue est une traduction
// que personne n'affiche. Les deux sont des erreurs, et aucune ne se voit.
// L'UNION DES PAGES, ET NON UNE SEULE. Une clé qui ne sert qu'à la page du
// téléchargement doit être dans le catalogue sans que la page d'accueil la
// porte, et l'inverse.
for (const page of PAGES) {
  page.uniques = [
    ...new Set([...page.gabarit.matchAll(/data-t="([^"]+)"/g)].map(m => m[1])),
  ].sort()
}
const uniques = [...new Set(PAGES.flatMap(p => p.uniques))].sort()
// UNE CLÉ PEUT SERVIR PLUSIEURS FOIS, ET LA GALERIE EN A BESOIN. La règle
// était « une clé, une occurrence » : un garde-fou contre une substitution qui
// frapperait un endroit que personne ne visait. La galerie porte six écrans et
// deux étiquettes d'état, donc « Fait » paraît trois fois, et c'est légitime.
// Ce qui doit être tenu n'est pas le compte mais la COUVERTURE : toute clé
// marquée est remplacée, partout, et aucune ne reste en français sur une page
// qui ne l'est pas. C'est `remplacer` qui le vérifie.

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

const cheminDe = (page, langue) => `/${page.dossier(langue)}`

// x-default désigne la page servie à qui ne demande rien de particulier, et
// c'est la racine. Sans lui, un moteur choisit lui-même, ce qui revient à ne
// pas décider.
const liensDe = page =>
  langues
    .map(
      l =>
        `<link rel="alternate" hreflang="${l}" href="${ORIGINE}${cheminDe(page, l)}">`,
    )
    .concat(
      `<link rel="alternate" hreflang="x-default" href="${ORIGINE}${cheminDe(page, RACINE)}">`,
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
  // ZÉRO EST LA SEULE FAUTE. Plusieurs occurrences sont légitimes -- une
  // étiquette d'état se répète sur chaque écran de la galerie -- et elles sont
  // toutes remplacées. Zéro veut dire qu'un remplacement n'a rien fait, et
  // c'est ainsi qu'une phrase française reste au milieu d'une page qui ne
  // l'est pas.
  if (vus === 0) {
    echouer(
      `« ${cle} » n'a été remplacée nulle part dans la page ${langue}. ` +
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

const entete = (html, langue, page) => {
  const motifLang = /<html lang="[^"]*">/g
  exigerUneFois(html, motifLang, 'la balise <html lang="…">', langue)
  let sortie = html.replace(motifLang, `<html lang="${langue}">`)

  // La description reprend le titre et le chapô plutôt qu'une phrase de plus à
  // traduire : une septième chaîne par langue serait une septième à oublier.
  const description = `${copie[langue][page.titre]} ${copie[langue][page.chapo]}`
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
    ['og:title', copie[langue][page.titre]],
    ['og:description', copie[langue][page.chapo]],
    ['og:url', `${ORIGINE}${cheminDe(page, langue)}`],
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

  const canonique = `<link rel="canonical" href="${ORIGINE}${cheminDe(page, langue)}">`
  return sortie.replace('</head>', `${canonique}\n${liensDe(page)}\n</head>`)
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
//
// `etat-verifie` en fait partie parce que le tableau des états est vérifié
// CONTRE une construction : sans fichier proposé, « vérifié sur la
// construction du … » n'a rien à nommer, et la ligne sort avec les deux
// autres plutôt que d'afficher sa marque.
const CLES_DE_FAITS = ['apk-faits', 'apk-empreinte', 'etat-verifie']

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
// L'OFFRE ET SON ABSENCE SONT DEUX BLOCS, ET UN SEUL SURVIT.
//
// `deploy.sh` accepte `MESSAGR_APK=none` : le fichier quitte le serveur, et la
// page doit cesser de le proposer dans le même geste. Un bouton qui reste avec
// le poids d'hier est pire qu'une page qui se tait.
//
// Les deux blocs sont écrits dans le balisage, donc tous deux relisibles ; la
// construction en retire un. Exigés avant d'être retirés, comme le reste : un
// bloc renommé doit arrêter la construction plutôt que de laisser les deux.
const trancherLOffre = (html, langue, offert) => {
  const garder = offert ? 'telechargement' : 'pas-de-telechargement'
  const retirer = offert ? 'pas-de-telechargement' : 'telechargement'
  const present = new RegExp(`<div data-si="${garder}">`)
  if (!present.test(html)) {
    return html
  }
  const motif = new RegExp(
    `\\n\\s*<div data-si="${retirer}">[\\s\\S]*?\\n  </div>`,
    'g',
  )
  exigerUneFois(html, motif, `le bloc « ${retirer} »`, langue)
  return html.replace(motif, '').replace(`<div data-si="${garder}">`, '<div>')
}

const ecrireLesFaits = (html, langue, faits) => {
  // SEULEMENT LES CLÉS QUE CETTE PAGE PORTE. `etat-verifie` ne vit que sur
  // l'accueil ; l'exiger sur la page du téléchargement arrêterait la
  // construction sur une page parfaitement correcte.
  html = trancherLOffre(html, langue, Boolean(faits))
  const siennes = CLES_DE_FAITS.filter(cle => html.includes(`data-t="${cle}"`))
  if (!faits) {
    for (const cle of siennes) {
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
  const pages = PAGES.flatMap(page =>
    langues.map(l => `${ORIGINE}${cheminDe(page, l)}`),
  ).concat([`${ORIGINE}/confidentialite/`, `${ORIGINE}/conditions-generales/`])
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

// ── Le tableau des états ne peut pas dater d'une autre construction ────────
//
// C'EST LA MANIÈRE EXACTE DONT LA FICHE DU MAGASIN EST DEVENUE FAUSSE. Elle
// annonce encore « pas d'images, pas de réactions » ; les deux ont été livrées
// depuis, personne n'est repassé sur la fiche, et rien nulle part ne l'a dit.
// Le tableau porte donc l'empreinte contre laquelle il a été vérifié, et un
// téléchargement qui change sans revérification arrête la construction.
//
// Le contrôle ne se pose que lorsque l'empreinte est connue, c'est-à-dire au
// déploiement. L'intégration continue n'a pas l'APK, et une règle qui ne peut
// pas s'appliquer ne doit pas se deviner.
const verifieContre = (html => {
  const trouve = /data-verifie-sur="([0-9a-f]{64})"/.exec(html)
  if (!trouve) {
    echouer(
      "le tableau des états ne porte pas d'attribut `data-verifie-sur` : sans " +
        "l'empreinte contre laquelle il a été vérifié, rien ne dirait qu'il " +
        "parle d'une construction que cette page ne propose plus",
    )
  }
  return trouve[1]
})(PAGES.find(p => p.nom === 'accueil').gabarit)

if (faits && faits.empreinte !== verifieContre) {
  echouer(
    'le téléchargement a changé depuis que le tableau des états a été ' +
      `vérifié.\n  proposé  : ${faits.empreinte}\n  vérifié  : ${verifieContre}\n` +
      '  Revérifiez ce que porte la nouvelle construction, corrigez les états ' +
      "qui ont bougé, puis reportez l'empreinte dans `data-verifie-sur`.",
  )
}
let ecrites = 0
for (const modele of PAGES) {
  for (const langue of langues) {
    let page = modele.gabarit
    if (langue !== RACINE) {
      for (const cle of modele.uniques) {
        page = remplacer(page, cle, copie[langue][cle], langue)
      }
    }
    page = entete(page, langue, modele)
    page = ecrireLesFaits(page, langue, faits)

    // LE DÉTAIL DE CONVERSATION SUIT LA LANGUE DE LA PAGE. Une conversation
    // française sur `/de/` annulerait ce que les six adresses corrigent, et le
    // séparateur « Hier » s'y lirait « ici ». Exigé avant d'être remplacé,
    // comme tout le reste : une image renommée doit arrêter la construction.
    //
    // TOUTES LES OCCURRENCES, ET PLUS UNE SEULE. Le hero et la galerie
    // montrent le même écran ; exiger une occurrence unique interdisait de le
    // citer deux fois. Ce qui compte n'est pas le compte, c'est qu'aucune page
    // ne montre l'image d'une autre langue -- donc au moins une, et toutes
    // remplacées.
    if (modele.conversation) {
      const motifConversation = /\/messagr-conversation-[a-z]{2}\.png/g
      const citations = page.match(motifConversation)
      if (!citations || citations.length === 0) {
        echouer(
          `la page ${modele.nom} ${langue} ne cite aucune image de conversation`,
        )
      }
      page = page.replace(
        motifConversation,
        `/messagr-conversation-${langue}.png`,
      )
    }

    // AUCUNE MARQUE NE DOIT SURVIVRE. Une page qui montrerait « %TAILLE% » à
    // un lecteur est pire qu'une page muette : elle a l'air cassée, et elle
    // l'est.
    const restante = /%[A-Z]+%/.exec(page)
    if (restante) {
      echouer(
        `la page ${modele.nom} ${langue} porte encore la marque ${restante[0]}`,
      )
    }

    const chemin = join(destination, modele.dossier(langue), 'index.html')
    mkdirSync(dirname(chemin), { recursive: true })
    writeFileSync(chemin, page)
    ecrites += 1
  }
}

const plan = planDuSite()
writeFileSync(join(destination, 'sitemap.xml'), plan)

console.log(
  `build-landing: ${ecrites} pages (${PAGES.length} par langue, ${langues.length} langues), ` +
    `chacune entière sans script, et un plan du site de ` +
    `${(plan.match(/<loc>/g) || []).length} adresses`,
)
