#!/usr/bin/env node
// deploy/messagr-eu/version-a-venir.mjs — la version à venir des pages
// légales, de son annonce au jour où elle s'applique (#412), et la version
// qui s'applique le jour où elle est publiée (#466). Le nom du fichier est
// resté celui du premier usage : les guides le citent.
//
//   node deploy/messagr-eu/version-a-venir.mjs annoncer AAAA-MM-JJ [site]
//   node deploy/messagr-eu/version-a-venir.mjs reporter AAAA-MM-JJ [site]
//   node deploy/messagr-eu/version-a-venir.mjs appliquer [site]
//   node deploy/messagr-eu/version-a-venir.mjs preavis <page a-venir construite>
//   node deploy/messagr-eu/version-a-venir.mjs publier [site]
//
// `site` vaut `deploy/messagr-eu/site` par défaut. Chaque geste écrit dans le
// dépôt, et rien d'autre : le reste, c'est un commit et un déploiement, que
// `LISEZ-MOI-pages-legales.md` décrit.
//
// ANNONCER. La date est celle où la version à venir s'appliquera, que le
// porteur fixe : la mise en ligne de ce qu'elle décrit. Elle est écrite à la
// place de la marque MESSAGR-DATE-A-VENIR, dans chaque page `a-venir/` et dans
// le passage de la version en vigueur qui l'annonce, sous la forme
// `<time datetime="AAAA-MM-JJ">1er novembre 2026</time>` : lisible par une
// personne, et relisible par les deux autres gestes.
//
// TRENTE JOURS AU MOINS, OU RIEN. La politique promet qu'un changement est
// annoncé avant d'être appliqué, et #392 a fixé ce délai à trente jours : une
// date plus proche est refusée, plutôt que d'être publiée avec un préavis que
// la page ne tient pas. Compté en jours du calendrier de Paris, où vit la
// personne qui lit la date, et à partir d'aujourd'hui : le préavis court du
// déploiement, qui suit l'annonce le jour même.
//
// PREAVIS, qui n'écrit rien, le mesure de nouveau le jour où la page est
// servie pour la première fois : `deploy.sh` le demande pour chaque page
// `a-venir/` que le serveur ne sert pas encore, et s'arrête s'il est trop
// court. Une annonce déployée une semaine plus tard donnerait sinon une
// semaine de moins.
//
// REPORTER. Une date annoncée peut reculer, jamais avancer : le préavis donné
// vaut pour toute date plus lointaine. Avancer demande une annonce nouvelle,
// avec ses trente jours.
//
// APPLIQUER, le jour venu et pas avant. Pour chaque page dont la version à
// venir est annoncée pour aujourd'hui ou avant, décision du porteur du 27
// septembre 2026 :
//   - la version en vigueur part à `<page>/jusqu-au-AAAA-MM-JJ/`, où elle
//     reste lisible, et dit jusqu'à quand elle s'est appliquée ;
//   - la version à venir devient `<page>/index.html`, et renvoie à celle
//     qu'elle remplace ;
//   - `<page>/a-venir/` disparaît, et `retention.json` cesse d'y renvoyer.
// Une version annoncée pour plus tard, ou pas encore annoncée, attend.
//
// CHAQUE GESTE VÉRIFIE CE QU'IL S'APPRÊTE À ÉCRIRE, et n'écrit rien si une
// page ne dit pas exactement ce qu'il faut : `build-site.sh` vérifie de même
// sa sortie plutôt que ses intentions. Une date réécrite dans une page et pas
// dans l'autre serait publiée comme deux dates.
//
// Le passage qui n'existe que tant qu'une version est à venir se trouve entre
// `<!-- a-venir -->` et `<!-- /a-venir -->` : l'annonce en tête de la version
// en vigueur, et l'en-tête de la version à venir. `build-site.sh` retire le
// premier tant que la marque y est, et `appliquer` remplace les deux.
//
// PUBLIER, LE JOUR MÊME, ET SANS PRÉAVIS (#466). Quand la version en vigueur
// ne fixe aucun préavis, comme la clause 7 des conditions générales du 5
// septembre 2026, une nouvelle version s'applique le jour où elle paraît. Ce
// jour-là, c'est la publication qui le fixe, avec le déploiement en
// production : la version attend donc dans `<page>/a-publier/`, écrite telle
// qu'elle sera, la marque MESSAGR-DATE-DE-PUBLICATION à la place de sa date,
// et sa traduction à côté, sous `en/`. `build-site.sh` n'en construit rien.
// `publier` y écrit le jour de Paris, et
//   - la version en vigueur part à `<page>/jusqu-au-AAAA-MM-JJ/`, comme pour
//     `appliquer` ;
//   - la version qui attendait devient `<page>/index.html`, et sa traduction
//     `<page>/en/index.html`, sa propre adresse ;
//   - `<page>/a-publier/` disparaît.
// Le texte, c'est la page qui le porte, dans sa langue : le geste n'écrit que
// des dates, et vérifie qu'il n'en manque aucune.
//
// UNE TRADUCTION TRADUIT LA VERSION EN VIGUEUR, ET AUCUNE AUTRE. Une version à
// venir ne porte pas encore la sienne : l'annoncer ou l'appliquer sur une page
// traduite laisserait la traduction publiée traduire une version remplacée.
// De même tant qu'une version attend d'être publiée sur la même page : la
// version à venir est écrite par-dessus elle, et ce qu'elle dit changer se lit
// contre elle. Dans ces deux cas, CETTE PAGE-LÀ ATTEND, ET ELLE SEULE : les
// trois gestes de la version à venir avancent sur les autres pages, et disent
// de celle qui attend ce qui lui manque. La politique de confidentialité ne se
// voit pas retenue par les conditions générales.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const MARQUE = 'MESSAGR-DATE-A-VENIR'
const MARQUE_PUBLICATION = 'MESSAGR-DATE-DE-PUBLICATION'
const PREAVIS_JOURS = 30
const MOIS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
]
const SITE_PAR_DEFAUT = join(dirname(fileURLToPath(import.meta.url)), 'site')
const PASSAGE = /<!-- a-venir -->[\s\S]*?<!-- \/a-venir -->/g
const DEPUIS = /<!-- depuis -->[\s\S]*?<!-- \/depuis -->/g
const DATES = /<time datetime="([^"]*)">/g
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

/** « 1er novembre 2026 », « 12 novembre 2026 ». */
function enFrancais(date) {
  const [annee, mois, jour] = date.split('-').map(Number)
  return `${jour === 1 ? '1er' : jour} ${MOIS[mois - 1]} ${annee}`
}

/** La date telle que les pages l'écrivent. */
function balise(date) {
  return `<time datetime="${date}">${enFrancais(date)}</time>`
}

/** « 30 September 2026 », « 1 October 2026 ». */
function inEnglish(date) {
  const [annee, mois, jour] = date.split('-').map(Number)
  return `${jour} ${MONTHS[mois - 1]} ${annee}`
}

/** Comment chaque langue des pages légales écrit une date, et il n'y en a pas d'autre. */
const ECRITURES = { fr: enFrancais, en: inEnglish }

/** La date telle qu'une page de cette langue l'écrit. */
function baliseDans(date, langue) {
  return `<time datetime="${date}">${ECRITURES[langue](date)}</time>`
}

/** Le jour du calendrier de Paris, AAAA-MM-JJ, à l'instant `maintenant`. */
function aujourdhuiAParis(maintenant) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(maintenant)
}

/** Combien de jours du calendrier séparent deux dates AAAA-MM-JJ. */
function joursEntre(de, a) {
  return Math.round(
    (Date.parse(`${a}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000,
  )
}

class Refus extends Error {}

/** Refuse ce qui n'est pas une date AAAA-MM-JJ du calendrier. */
function exigerUneDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) {
    throw new Refus('la date s’écrit AAAA-MM-JJ')
  }
  const [annee, mois, jour] = date.split('-').map(Number)
  const lue = new Date(Date.UTC(annee, mois - 1, jour))
  if (
    lue.getUTCFullYear() !== annee ||
    lue.getUTCMonth() !== mois - 1 ||
    lue.getUTCDate() !== jour
  ) {
    throw new Refus(`${date} n’est pas une date du calendrier`)
  }
}

const lire = fichier => readFileSync(fichier, 'utf8')
const passageDe = texte => texte.match(PASSAGE) ?? []
const depuisDe = texte => texte.match(DEPUIS) ?? []
const datesDe = texte => [...texte.matchAll(DATES)].map(d => d[1])
const langueDe = texte => texte.match(/<html lang="([a-z]{2})"/)?.[1] ?? null

/**
 * Les traductions d'une version : ses sous-dossiers de deux lettres qui
 * portent une page, `en/` pour l'anglais.
 */
function traductionsDe(dossier) {
  if (!existsSync(dossier)) return []
  return readdirSync(dossier)
    .filter(
      nom =>
        /^[a-z]{2}$/.test(nom) && existsSync(join(dossier, nom, 'index.html')),
    )
    .sort()
}

/**
 * Les pages légales qui tiennent une version dans leur sous-dossier `sous` :
 * chaque dossier du site qui porte `<sous>/index.html`, avec sa version en
 * vigueur à côté. `venir` nomme la page de cette version.
 */
function versionsDans(site, sous) {
  const trouvees = []
  for (const nom of readdirSync(site)) {
    const dossier = join(site, nom, sous)
    const venir = join(dossier, 'index.html')
    if (!statSync(join(site, nom)).isDirectory() || !existsSync(venir)) continue
    trouvees.push({
      nom,
      dossier,
      venir,
      enVigueur: join(site, nom, 'index.html'),
    })
  }
  return trouvees
}

/** Les pages légales qui ont une version à venir. */
const versionsAVenir = site => versionsDans(site, 'a-venir')

/** Les pages légales qui ont une version qui attend d'être publiée. */
const versionsAPublier = site => versionsDans(site, 'a-publier')

/** Le titre de toute page légale, « … — Messagr », que la version datée reprend. */
function exigerUnTitre(fichier, adresse) {
  if (!/<title>[^<]*? — Messagr<\/title>/.test(lire(fichier))) {
    throw new Refus(`${adresse} doit avoir un titre « … — Messagr »`)
  }
}

/**
 * Ce qui retient une version à venir, ou `null` si rien ne la retient : une
 * version qui attend d'être publiée sur la même page, ou une traduction de la
 * version en vigueur, qu'une version à venir ne porte pas encore. Ce n'est
 * pas une faute de forme : la page attend, et les autres avancent.
 */
function ceQuiLaRetient({ nom, enVigueur }) {
  const page = dirname(enVigueur)
  if (existsSync(join(page, 'a-publier'))) {
    return `/${nom}/a-venir/ attend que /${nom}/a-publier/ soit publiée : la version à venir est écrite par-dessus elle (version-a-venir.mjs publier)`
  }
  const traductions = traductionsDe(page)
  if (traductions.length > 0) {
    return `/${nom}/a-venir/ attend sa traduction : ${traductions.map(l => `/${nom}/${l}/`).join(', ')} traduit la version en vigueur, et il manque la traduction de la version à venir, que ces gestes ne savent pas encore dater ni servir avec elle (LISEZ-MOI-pages-legales.md, « Une traduction »)`
  }
  return null
}

/**
 * Les versions qui avancent, et ce qui retient les autres. Aucune qui avance :
 * le geste est refusé, et le refus dit pourquoi chacune attend.
 */
function trier(versions) {
  const avancent = []
  const attendent = []
  for (const version of versions) {
    const retenue = ceQuiLaRetient(version)
    if (retenue) attendent.push(retenue)
    else avancent.push(version)
  }
  if (avancent.length === 0) throw new Refus(attendent.join(' ; '))
  return { avancent, attendent }
}

/**
 * Ce qu'une version à venir doit porter pour que les trois gestes la
 * trouvent : un passage `a-venir` de chaque côté, l'annonce qui renvoie à
 * la version à venir, la version à venir qui renvoie à celle en vigueur, et
 * « à venir » dans son titre et en tête, qu'`appliquer` retire. Rien de la
 * version qu'elle recopie : la carte `depuis` d'une version appliquée
 * porterait une seconde date.
 */
function verifierLaForme({ nom, venir, enVigueur }) {
  if (!existsSync(enVigueur)) {
    throw new Refus(`${nom}/a-venir/ n’a pas de version en vigueur à côté`)
  }
  const texte = lire(venir)
  if (
    !/<title>[^<]*? à venir — Messagr<\/title>/.test(texte) ||
    !/<h1>[^<]*? à venir<\/h1>/.test(texte) ||
    !texte.includes('<p class="stamp">Version applicable le ')
  ) {
    throw new Refus(
      `${nom}/a-venir/ doit dire « à venir » dans son titre et son h1, et « Version applicable le » en tête`,
    )
  }
  if (texte.includes('<!-- depuis -->')) {
    throw new Refus(
      `${nom}/a-venir/ porte encore la carte « depuis » de la version qu’elle recopie`,
    )
  }
  exigerUnTitre(enVigueur, `${nom}/index.html`)
  const annonce = passageDe(lire(enVigueur))
  if (annonce.length !== 1 || !annonce[0].includes(`href="/${nom}/a-venir/"`)) {
    throw new Refus(
      `${nom}/index.html doit porter un passage a-venir, un seul, qui renvoie à /${nom}/a-venir/`,
    )
  }
  const entete = passageDe(texte)
  if (entete.length !== 1 || !entete[0].includes(`href="/${nom}/"`)) {
    throw new Refus(
      `${nom}/a-venir/ doit porter un passage a-venir, un seul, qui renvoie à /${nom}/`,
    )
  }
}

/** La date annoncée, lue sur la version à venir, ou `null` si elle ne l'est pas. */
function dateAnnoncee({ nom, venir }) {
  const texte = lire(venir)
  if (texte.includes(MARQUE)) return null
  const uniques = [...new Set(datesDe(texte))]
  if (uniques.length !== 1) {
    throw new Refus(
      `${nom}/a-venir/ ne porte ni la marque ni une date annoncée, une seule`,
    )
  }
  exigerUneDate(uniques[0])
  return uniques[0]
}

/**
 * La date réécrite dans les deux pages d'une version, vérifiée avant d'être
 * écrite : plus de marque, et `date` seule, dans la version à venir comme dans
 * le passage qui l'annonce.
 */
function redater({ nom, venir, enVigueur }, ancienne, date) {
  const pages = [venir, enVigueur].map(page => ({
    page,
    texte: lire(page).split(ancienne).join(balise(date)),
  }))
  const [aVenir, annonce] = [pages[0].texte, passageDe(pages[1].texte)[0] ?? '']
  for (const texte of [aVenir, annonce]) {
    const dates = datesDe(texte)
    if (
      texte.includes(MARQUE) ||
      !texte.includes(balise(date)) ||
      dates.some(d => d !== date)
    ) {
      throw new Refus(
        `${nom} : la date ne s’écrirait pas partout où la version à venir la porte, rien n’est écrit`,
      )
    }
  }
  return pages
}

/**
 * Écrit la date à la place de la marque, et dit dans quelles pages, et ce qui
 * retient celles qui attendent.
 */
function annoncer(date, site) {
  exigerUneDate(date)
  const jours = joursEntre(aujourdhuiAParis(new Date()), date)
  if (jours < PREAVIS_JOURS) {
    throw new Refus(
      `${date} est à ${jours} jour(s) : la politique promet ${PREAVIS_JOURS} jours de préavis`,
    )
  }
  const aAnnoncer = versionsAVenir(site).filter(v =>
    lire(v.venir).includes(MARQUE),
  )
  if (aAnnoncer.length === 0) {
    throw new Refus(
      'aucune version à venir ne porte la marque, il n’y a rien à annoncer',
    )
  }
  const { avancent, attendent } = trier(aAnnoncer)
  const ecritures = avancent.flatMap(version => {
    verifierLaForme(version)
    return redater(version, MARQUE, date)
  })
  for (const { page, texte } of ecritures) writeFileSync(page, texte)
  return { touchees: ecritures.map(e => e.page), attendent }
}

/** Recule la date annoncée, et dit dans quelles pages, et ce qui retient les autres. */
function reporter(date, site) {
  exigerUneDate(date)
  const annoncees = versionsAVenir(site).filter(v => dateAnnoncee(v) !== null)
  if (annoncees.length === 0) {
    throw new Refus(
      'aucune version à venir n’est annoncée, il n’y a rien à reporter',
    )
  }
  const { avancent, attendent } = trier(annoncees)
  const ecritures = avancent.flatMap(version => {
    verifierLaForme(version)
    const avant = dateAnnoncee(version)
    if (date <= avant) {
      throw new Refus(
        `${version.nom}/a-venir/ est annoncée pour le ${avant} : une date peut reculer, pas avancer`,
      )
    }
    return redater(version, balise(avant), date)
  })
  for (const { page, texte } of ecritures) writeFileSync(page, texte)
  return { touchees: ecritures.map(e => e.page), attendent }
}

/**
 * Le préavis, en jours, que donne une page `a-venir/` construite si elle est
 * servie aujourd'hui, ou le refus s'il est trop court.
 */
function preavis(page) {
  if (!page || !existsSync(page)) {
    throw new Refus('preavis prend la page a-venir construite')
  }
  const dates = [...new Set(datesDe(lire(page)))]
  if (dates.length !== 1 || lire(page).includes(MARQUE)) {
    throw new Refus(`${page} ne porte pas une date annoncée, une seule`)
  }
  exigerUneDate(dates[0])
  const jours = joursEntre(aujourdhuiAParis(new Date()), dates[0])
  if (jours < PREAVIS_JOURS) {
    throw new Refus(
      `servie aujourd’hui pour la première fois, ${page} s’appliquerait dans ${jours} jour(s), et la politique promet ${PREAVIS_JOURS} jours de préavis : reculer d’abord la date (reporter AAAA-MM-JJ)`,
    )
  }
  return jours
}

/** L'unique passage `a-venir` d'une page, remplacé. */
function remplacerLePassage(texte, remplacement) {
  return texte.replace(PASSAGE, () => remplacement)
}

/**
 * La version en vigueur, telle qu'elle reste lisible à son adresse datée : la
 * carte qui dit jusqu'à quand prend la place de l'annonce de la version à
 * venir, ou se pose sous la date quand la page n'en annonce aucune, comme
 * une version remplacée par une version publiée sans préavis.
 */
function versionDatee(texte, nom, date) {
  const carte = `<!-- jusqu-au -->
      <div class="card">
        <p>
          <b>Cette version s'est appliquée jusqu'au ${balise(date)}</b>, où la
          <a href="/${nom}/">version en vigueur</a> l'a remplacée.
        </p>
      </div>
      <!-- /jusqu-au -->`
  const datee =
    passageDe(texte).length > 0
      ? remplacerLePassage(texte, carte)
      : texte.replace(
          /<p class="stamp">[\s\S]*?<\/p>/,
          tampon => `${tampon}\n      ${carte}`,
        )
  return datee.replace(
    /<title>([^<]*?) — Messagr<\/title>/,
    (_, titre) =>
      `<title>${titre}, jusqu'au ${enFrancais(date)} — Messagr</title>`,
  )
}

/** La version à venir, telle qu'elle s'applique. */
function enVigueurDepuis(texte, nom, date) {
  return remplacerLePassage(
    texte,
    `<!-- depuis -->
        <p>
          <b>Cette version s'applique depuis le ${balise(date)}.</b> La
          <a href="/${nom}/jusqu-au-${date}/">version qu'elle remplace</a> reste
          lisible.
        </p>
        <p>Ce qui a changé&nbsp;:</p>
        <!-- /depuis -->`,
  )
    .replace(/(<title>[^<]*?) à venir/, '$1')
    .replace(/(<h1>[^<]*?) à venir<\/h1>/, '$1</h1>')
    .replace(/Version applicable le /, 'Version du ')
}

/**
 * `retention.json` sans les « page » qui renvoient aux adresses qui
 * disparaissent. Retiré ligne à ligne plutôt que réécrit, pour que le
 * fichier garde la forme que prettier lui donne ; relu ensuite, pour que le
 * résultat soit exactement le fichier moins ces clés.
 */
function retentionSans(texte, adresses) {
  const attendu = JSON.parse(texte)
  for (const entree of Object.values(attendu)) {
    if (
      entree &&
      typeof entree === 'object' &&
      adresses.includes(entree.page)
    ) {
      delete entree.page
    }
  }
  const lignes = texte.split('\n')
  const gardees = []
  for (const ligne of lignes) {
    const cle = ligne.match(/^\s*"page": "([^"]*)",?$/)
    if (cle && adresses.includes(cle[1])) {
      if (!ligne.endsWith(',')) {
        // La dernière clé de son objet : la précédente perd sa virgule.
        const precedente = gardees.length - 1
        gardees[precedente] = gardees[precedente].replace(/,$/, '')
      }
      continue
    }
    gardees.push(ligne)
  }
  const resultat = gardees.join('\n')
  if (JSON.stringify(JSON.parse(resultat)) !== JSON.stringify(attendu)) {
    throw new Refus(
      'retention.json ne se laisse pas retirer ses « page » ligne à ligne',
    )
  }
  return resultat
}

/**
 * Applique chaque version à venir annoncée pour aujourd'hui ou avant, et dit
 * ce qui a été écrit, et ce qui retient celles qui attendent. `retention`
 * vaut le `retention.json` voisin du site.
 */
export function appliquer(
  site,
  retention = join(site, '..', 'retention.json'),
  maintenant = new Date(),
) {
  const aujourdhui = aujourdhuiAParis(maintenant)
  const echues = versionsAVenir(site).filter(version => {
    const date = dateAnnoncee(version)
    return date !== null && joursEntre(aujourdhui, date) <= 0
  })
  if (echues.length === 0) {
    throw new Refus(
      `aucune version à venir n’est annoncée pour le ${enFrancais(aujourdhui)} ou avant, il n’y a rien à appliquer`,
    )
  }
  const { avancent, attendent } = trier(echues)
  const ecritures = []
  const retirees = []
  for (const version of avancent) {
    const { nom, venir, enVigueur } = version
    verifierLaForme(version)
    const date = dateAnnoncee(version)
    const adresseDatee = join(site, nom, `jusqu-au-${date}`)
    if (existsSync(adresseDatee)) {
      throw new Refus(`${nom}/jusqu-au-${date}/ existe déjà`)
    }
    ecritures.push(
      {
        dossier: adresseDatee,
        page: join(adresseDatee, 'index.html'),
        texte: versionDatee(lire(enVigueur), nom, date),
      },
      { page: enVigueur, texte: enVigueurDepuis(lire(venir), nom, date) },
    )
    retirees.push({ dossier: dirname(venir), adresse: `/${nom}/a-venir/` })
  }
  if (!existsSync(retention)) {
    throw new Refus(
      `${retention} n’existe pas : les durées ne peuvent pas suivre`,
    )
  }
  const nouvelleRetention = retentionSans(
    lire(retention),
    retirees.map(r => r.adresse),
  )

  for (const { dossier, page, texte } of ecritures) {
    if (dossier) mkdirSync(dossier)
    writeFileSync(page, texte)
  }
  for (const { dossier } of retirees) rmSync(dossier, { recursive: true })
  writeFileSync(retention, nouvelleRetention)
  return {
    touchees: [
      ...ecritures.map(e => e.page),
      ...retirees.map(r => `${r.dossier} (retiré)`),
      retention,
    ],
    attendent,
  }
}

/**
 * Ce qu'une version à publier doit porter pour que `publier` n'ait qu'à
 * écrire des dates : son titre et son texte définitifs ; la marque en tête,
 * à la place de sa date ; une carte « depuis », une seule, qui porte la
 * marque et renvoie à l'adresse datée de la version qu'elle remplace ; pour
 * sa traduction, la langue qu'elle se donne et un renvoi au texte français,
 * qui fait foi ; et l'annonce de la version à venir, s'il y en a une, qu'elle
 * reprend à la version en vigueur.
 */
function verifierLaFormeAPublier({ nom, dossier, venir, enVigueur }) {
  if (!existsSync(enVigueur)) {
    throw new Refus(
      `${nom}/a-publier/ n’a pas de version en vigueur à remplacer`,
    )
  }
  exigerUnTitre(enVigueur, `${nom}/index.html`)
  if (
    passageDe(lire(enVigueur)).length === 0 &&
    !/<p class="stamp">/.test(lire(enVigueur))
  ) {
    throw new Refus(
      `${nom}/index.html n’a ni annonce ni date en tête où dire jusqu’à quand elle s’est appliquée`,
    )
  }
  const anciennes = traductionsDe(dirname(enVigueur))
  if (anciennes.length > 0) {
    throw new Refus(
      `${anciennes.map(l => `${nom}/${l}/`).join(', ')} traduit la version en vigueur, et publier ne sait pas encore dater une traduction remplacée : elle resterait servie, traduisant une version qui ne s’applique plus`,
    )
  }
  const traductions = traductionsDe(dossier)
  const pages = [
    { langue: 'fr', adresse: `${nom}/a-publier/`, fichier: venir },
    ...traductions.map(langue => ({
      langue,
      adresse: `${nom}/a-publier/${langue}/`,
      fichier: join(dossier, langue, 'index.html'),
    })),
  ]
  const renvoi = `href="/${nom}/jusqu-au-${MARQUE_PUBLICATION}/"`
  for (const { langue, adresse, fichier } of pages) {
    const texte = lire(fichier)
    if (langueDe(texte) !== langue || !Object.hasOwn(ECRITURES, langue)) {
      throw new Refus(
        `${adresse} doit se dire <html lang="${langue}">, dans une langue dont publier sait écrire la date (${Object.keys(ECRITURES).join(', ')})`,
      )
    }
    exigerUnTitre(fichier, adresse)
    if (/<title>[^<]*? à venir/.test(texte)) {
      throw new Refus(
        `${adresse} doit porter son titre définitif, sans « à venir »`,
      )
    }
    const tampon = texte.match(/<p class="stamp">([\s\S]*?)<\/p>/)
    if (!tampon || !tampon[1].includes(MARQUE_PUBLICATION)) {
      throw new Refus(
        `${adresse} doit porter ${MARQUE_PUBLICATION} en tête, à la place de sa date`,
      )
    }
    const depuis = depuisDe(texte)
    if (
      depuis.length !== 1 ||
      !depuis[0].includes(renvoi) ||
      !depuis[0].split(renvoi).join('').includes(MARQUE_PUBLICATION)
    ) {
      throw new Refus(
        `${adresse} doit porter une carte « depuis », une seule, qui dit sa date et renvoie à /${nom}/jusqu-au-${MARQUE_PUBLICATION}/`,
      )
    }
    if (langue !== 'fr') {
      if (!texte.includes(`href="/${nom}/"`)) {
        throw new Refus(
          `${adresse} doit renvoyer au texte français, qui fait foi : href="/${nom}/"`,
        )
      }
      if (passageDe(texte).length > 0) {
        throw new Refus(
          `${adresse} annonce une version à venir, et une traduction n’en annonce pas encore`,
        )
      }
    }
  }
  const francais = lire(venir)
  for (const langue of traductions) {
    if (!francais.includes(`href="/${nom}/${langue}/"`)) {
      throw new Refus(
        `${nom}/a-publier/ doit renvoyer à sa traduction, /${nom}/${langue}/`,
      )
    }
  }
  const annonce = passageDe(francais)
  if (existsSync(join(dirname(enVigueur), 'a-venir', 'index.html'))) {
    if (
      annonce.length !== 1 ||
      !annonce[0].includes(`href="/${nom}/a-venir/"`) ||
      !annonce[0].includes(MARQUE)
    ) {
      throw new Refus(
        `${nom}/a-publier/ doit reprendre l’annonce de /${nom}/a-venir/, une seule, sans date : la version à venir ne s’annonce qu’une fois celle-ci publiée`,
      )
    }
  } else if (annonce.length > 0) {
    throw new Refus(
      `${nom}/a-publier/ annonce une version à venir que le site ne tient pas`,
    )
  }
}

/** Une version à publier, sa marque remplacée par la date, dans sa langue. */
function dater(texte, nom, date, langue) {
  return texte
    .split(`/${nom}/jusqu-au-${MARQUE_PUBLICATION}/`)
    .join(`/${nom}/jusqu-au-${date}/`)
    .split(MARQUE_PUBLICATION)
    .join(baliseDans(date, langue))
}

/**
 * Publie chaque version qui attend dans `a-publier/`, datée du jour de Paris
 * à l'instant `maintenant`, et dit ce qui a été écrit. Rien n'est écrit si
 * une page ne dit pas exactement ce qu'il faut.
 */
export function publier(site, maintenant = new Date()) {
  const date = aujourdhuiAParis(maintenant)
  const aPublier = versionsAPublier(site)
  if (aPublier.length === 0) {
    throw new Refus(
      'aucune version n’attend dans a-publier/, il n’y a rien à publier',
    )
  }
  const ecritures = []
  for (const version of aPublier) {
    verifierLaFormeAPublier(version)
    const { nom, dossier, venir, enVigueur } = version
    const page = dirname(enVigueur)
    const adresseDatee = join(page, `jusqu-au-${date}`)
    if (existsSync(adresseDatee)) {
      throw new Refus(
        `${nom}/jusqu-au-${date}/ existe déjà : une version y a déjà été remplacée ce jour-là`,
      )
    }
    ecritures.push(
      {
        dossier: adresseDatee,
        page: join(adresseDatee, 'index.html'),
        texte: versionDatee(lire(enVigueur), nom, date),
        verifier: texte =>
          texte.includes(`s'est appliquée jusqu'au ${balise(date)}`) &&
          texte.includes(`href="/${nom}/"`),
      },
      {
        page: enVigueur,
        texte: dater(lire(venir), nom, date, 'fr'),
        verifier: texte =>
          texte.includes(`href="/${nom}/jusqu-au-${date}/"`) &&
          texte.includes(baliseDans(date, 'fr')),
      },
      ...traductionsDe(dossier).map(langue => ({
        dossier: join(page, langue),
        page: join(page, langue, 'index.html'),
        texte: dater(
          lire(join(dossier, langue, 'index.html')),
          nom,
          date,
          langue,
        ),
        verifier: texte =>
          texte.includes(`href="/${nom}/jusqu-au-${date}/"`) &&
          texte.includes(baliseDans(date, langue)),
      })),
    )
  }
  for (const { page, texte, verifier } of ecritures) {
    if (texte.includes(MARQUE_PUBLICATION) || !verifier(texte)) {
      throw new Refus(
        `${page} ne porterait pas la date partout où elle doit la porter, rien n’est écrit`,
      )
    }
  }

  for (const { dossier, page, texte } of ecritures) {
    if (dossier) mkdirSync(dossier, { recursive: true })
    writeFileSync(page, texte)
  }
  for (const { dossier } of aPublier) rmSync(dossier, { recursive: true })
  return {
    touchees: [
      ...ecritures.map(e => e.page),
      ...aPublier.map(v => `${v.dossier} (retiré)`),
    ],
    attendent: [],
  }
}

const SUITE = 'puis à lancer les contrôles de LISEZ-MOI-pages-legales.md.'

/** Chaque geste, avec ses arguments tels que la ligne de commande les donne. */
const GESTES = {
  annoncer: ([date, site = SITE_PAR_DEFAUT]) => ({
    ...annoncer(date, site),
    suite: `la version à venir s’appliquera le ${enFrancais(date)}. Reste à commiter et à déployer aujourd’hui, le préavis courant du jour où la page est servie, ${SUITE}`,
  }),
  reporter: ([date, site = SITE_PAR_DEFAUT]) => ({
    ...reporter(date, site),
    suite: `la version à venir s’appliquera le ${enFrancais(date)}. Reste à commiter et à déployer aujourd’hui, la page servie disant l’ancienne date d’ici là, ${SUITE}`,
  }),
  appliquer: ([site = SITE_PAR_DEFAUT]) => ({
    ...appliquer(site),
    suite: `la version à venir est en vigueur. Reste à commiter, à déployer, ${SUITE}`,
  }),
  preavis: ([page]) => ({
    touchees: [],
    attendent: [],
    suite: `servie aujourd’hui, ${page} donne ${preavis(page)} jours de préavis`,
  }),
  publier: ([site = SITE_PAR_DEFAUT]) => {
    const maintenant = new Date()
    return {
      ...publier(site, maintenant),
      suite: `la version publiée s’applique depuis aujourd’hui, le ${enFrancais(aujourdhuiAParis(maintenant))}. Reste à commiter et à déployer aujourd’hui même, la date écrite étant celle où la page est servie, ${SUITE}`,
    }
  },
}

// Par le chemin réel : lancé par un lien symbolique, `argv[1]` nomme le lien
// et `import.meta.url` le fichier, et le geste ne se ferait pas, en silence.
if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [nom, ...reste] = process.argv.slice(2)
  try {
    if (!Object.hasOwn(GESTES, nom)) {
      throw new Refus(
        'annoncer AAAA-MM-JJ, reporter AAAA-MM-JJ, appliquer, preavis <page> ou publier',
      )
    }
    const { touchees, attendent, suite } = GESTES[nom](reste)
    for (const page of touchees) console.log(`version-a-venir : ${page}`)
    // Sur la sortie d'erreur, qu'un regard pressé ne prenne pas une page qui
    // attend pour une page faite.
    for (const retenue of attendent) {
      console.error(`version-a-venir : ${retenue}`)
    }
    console.log(`version-a-venir : ${suite}`)
  } catch (e) {
    if (!(e instanceof Refus)) throw e
    console.error(`version-a-venir : REFUS : ${e.message}`)
    process.exit(1)
  }
}
