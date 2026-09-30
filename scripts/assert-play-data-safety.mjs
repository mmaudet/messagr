// CE QUE LA CONSOLE PLAY DÉCLARE, RELU CONTRE CE QUE LE DOCUMENT DIT.
//
// `docs/declarations-magasins.md` dit, question par question, ce que la
// section « Sécurité des données » de Google Play doit répondre. La console ne
// relit rien : une case voisine s'y coche aussi bien que la bonne, et la fiche
// publique affiche l'une comme l'autre. Le 30 septembre 2026, la saisie du
// point 9 en a fait trois avant d'être juste, sur quatre exports : « Fichiers
// audio » → « Enregistrements audio ou vidéo » cochée, « Photos » décochée une
// fois, « Partagées » cochée une fois. Chacune se lisait dans l'export CSV de
// la console, à condition de le relire ligne à ligne contre le document.
//
// Ce contrôle fait cette relecture. Il dit ce qui manque et ce qui est en trop,
// et sort en erreur au moindre écart.
//
// # D'où viennent les réponses attendues
//
// DU DOCUMENT, ET DE LUI SEUL. Aucune réponse n'est recopiée ici : ce fichier
// lit les tableaux de deux sections du document, « Étape « Collecte des
// données et sécurité » » et « Étape « Utilisation et traitement des
// données » ». Une réponse changée dans le document change ce que ce contrôle
// attend, et il n'y a pas de seconde copie à oublier.
//
// Ce qu'il sait, c'est le vocabulaire de Play : sous quel identifiant l'export
// range « ID utilisateur », « Obligatoire » ou « Gestion des comptes ». Un
// libellé du document qui n'y est pas le fait échouer plutôt que d'être
// ignoré : un tableau mal lu attendrait moins que ce que le document dit.
//
// Les tableaux de « Utilisation et traitement des données » se lisent dans
// l'ordre, et un type qui revient remplace sa ligne : c'est ainsi que le
// tableau de la build qui signale donne à « ID utilisateur » sa troisième
// finalité, et ajoute trois types aux quatre de la première saisie.
//
// # Ce qui est comparé
//
// L'export a une ligne par réponse possible, donnée ou non : 782 le
// 30 septembre 2026, en cinq colonnes (identifiant de la question, identifiant
// de la réponse, valeur, exigence, libellé). Sont comparées les réponses
// données aux trois questions de la première étape, aux types de données, et
// aux questions d'utilisation de chaque type, coché ou non. Le reste (méthodes
// de création de compte, adresses de suppression, badges) n'est pas dans ces
// tableaux, et n'est pas comparé.
//
// # Usage
//
//   node scripts/assert-play-data-safety.mjs <export.csv>
//   node scripts/assert-play-data-safety.mjs --self-test

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..')
const DOCUMENT = 'docs/declarations-magasins.md'
const EXPORTS = 'docs/declarations'

// ── Le vocabulaire de Play ─────────────────────────────────────────────────
//
// Lu dans l'export du 30 septembre 2026. À gauche le libellé du document, à
// droite l'identifiant sous lequel l'export range la réponse. Le document suit
// l'aide Play, dont les libellés diffèrent parfois de ceux de la console
// (« Appareil ou autres ID », là où la console écrit « ID de l'appareil ou
// autres ID ») : l'identifiant, lui, ne change pas avec le libellé.

// Chaque type, avec la question de sa catégorie dans « Types de données ».
const TYPES = {
  'ID utilisateur': ['PSL_DATA_TYPES_PERSONAL', 'PSL_USER_ACCOUNT'],
  'Autres messages via une appli': [
    'PSL_DATA_TYPES_EMAIL_AND_TEXT',
    'PSL_OTHER_MESSAGES',
  ],
  Photos: ['PSL_DATA_TYPES_PHOTOS_AND_VIDEOS', 'PSL_PHOTOS'],
  'Fichiers et documents': [
    'PSL_DATA_TYPES_FILES_AND_DOCS',
    'PSL_FILES_AND_DOCS',
  ],
  Contacts: ['PSL_DATA_TYPES_CONTACTS', 'PSL_CONTACTS'],
  'Autres actions': ['PSL_DATA_TYPES_APP_ACTIVITY', 'PSL_OTHER_APP_ACTIVITY'],
  'Appareil ou autres ID': ['PSL_DATA_TYPES_IDENTIFIERS', 'PSL_DEVICE_ID'],
}

const EPHEMERE = { Non: 'false', Oui: 'true' }

const CONTROLE = {
  Obligatoire: 'PSL_DATA_USAGE_USER_CONTROL_REQUIRED',
  'Les utilisateurs peuvent choisir si ces données sont collectées ou non':
    'PSL_DATA_USAGE_USER_CONTROL_OPTIONAL',
}

const FINALITES = {
  "Fonctionnement de l'application": 'PSL_APP_FUNCTIONALITY',
  Analyse: 'PSL_ANALYTICS',
  'Communications du développeur': 'PSL_DEVELOPER_COMMUNICATIONS',
  'Prévention des fraudes, sécurité et conformité':
    'PSL_FRAUD_PREVENTION_SECURITY',
  'Publicité ou marketing': 'PSL_ADVERTISING',
  Personnalisation: 'PSL_PERSONALIZATION',
  'Gestion des comptes': 'PSL_ACCOUNT_MANAGEMENT',
}

// Les trois questions de la première étape, reconnues à quelques mots de leur
// libellé dans le document, et ce que « Oui » et « Non » y rangent.
const PREMIERE_ETAPE = [
  {
    mots: 'collecte-t-elle ou partage-t-elle',
    question: 'PSL_DATA_COLLECTION_COLLECTS_PERSONAL_DATA',
    reponses: { Oui: ['', 'true'], Non: ['', 'false'] },
  },
  {
    mots: 'chiffrées',
    question: 'PSL_DATA_COLLECTION_ENCRYPTED_IN_TRANSIT',
    reponses: { Oui: ['', 'true'], Non: ['', 'false'] },
  },
  {
    mots: 'suppression',
    question: 'PSL_SUPPORT_DATA_DELETION_BY_USER',
    reponses: {
      Oui: ['DATA_DELETION_YES', 'true'],
      Non: ['DATA_DELETION_NO', 'true'],
    },
  },
]

const UTILISATION = 'PSL_DATA_USAGE_RESPONSES:'

// Les questions que les tableaux du document décident.
const comparee = question =>
  question.startsWith('PSL_DATA_TYPES_') ||
  question.startsWith(UTILISATION) ||
  PREMIERE_ETAPE.some(etape => etape.question === question)

const cle = (question, reponse) => `${question} ${reponse}`

// ── Ce que le document attend ──────────────────────────────────────────────

// Les lignes d'une section, de son titre au titre suivant de même niveau.
const section = (texte, titre) => {
  const lignes = texte.split('\n')
  const debut = lignes.indexOf(titre)
  if (debut < 0) {
    throw new Error(`${DOCUMENT} n'a plus de titre « ${titre} »`)
  }
  const niveau = titre.indexOf(' ')
  const fin = lignes.findIndex(
    (ligne, i) =>
      i > debut && /^#+ /.test(ligne) && ligne.indexOf(' ') <= niveau,
  )
  return lignes.slice(debut + 1, fin < 0 ? lignes.length : fin)
}

// Les tableaux d'une section, dans l'ordre, sans leur ligne de tirets.
const tableaux = lignes => {
  const lus = []
  let courant = null
  for (const ligne of lignes) {
    if (!ligne.startsWith('|')) {
      courant = null
      continue
    }
    if (!courant) {
      courant = []
      lus.push(courant)
    }
    courant.push(
      ligne
        .split('|')
        .slice(1, -1)
        .map(cellule => cellule.trim()),
    )
  }
  return lus.map(([entete, , ...rangees]) => ({
    entete: entete.join(' | '),
    rangees,
  }))
}

/**
 * Les réponses que le document attend, par question et réponse de l'export :
 * une table de `{ question, reponse, valeur, dit }`, `dit` étant ce que le
 * document écrit, pour le cas où l'export n'aurait même pas la ligne.
 */
export function lireDocument(texte) {
  const attendues = new Map()
  const attendre = (question, reponse, valeur, dit) =>
    attendues.set(cle(question, reponse), { question, reponse, valeur, dit })
  const illisible = (ou, libelle) =>
    new Error(
      `${DOCUMENT}, ${ou}, écrit « ${libelle} », que ce contrôle ne sait pas ` +
        `lire. S'il est juste, son identifiant dans l'export manque à ` +
        `scripts/assert-play-data-safety.mjs.`,
    )

  const premiere = tableaux(
    section(texte, '### Étape « Collecte des données et sécurité »'),
  )
  if (premiere.length !== 1 || premiere[0].entete !== 'Question | Réponse') {
    throw new Error(
      `${DOCUMENT} : l'étape « Collecte des données et sécurité » n'a plus ` +
        `un seul tableau « Question | Réponse »`,
    )
  }
  for (const [libelle, reponse] of premiere[0].rangees) {
    const etape = PREMIERE_ETAPE.find(({ mots }) => libelle.includes(mots))
    if (!etape) throw illisible('première étape', libelle)
    const oui = /^\*\*(Oui|Non)\*\*/.exec(reponse)
    if (!oui) throw illisible('première étape', reponse)
    const [id, valeur] = etape.reponses[oui[1]]
    attendre(etape.question, id, valeur, `${libelle} → ${oui[1]}`)
  }
  for (const { question } of PREMIERE_ETAPE) {
    if (![...attendues.values()].some(a => a.question === question)) {
      throw new Error(`${DOCUMENT} ne répond plus à ${question}`)
    }
  }

  const utilisation = tableaux(
    section(texte, '### Étape « Utilisation et traitement des données »'),
  )
  if (utilisation.length === 0) {
    throw new Error(
      `${DOCUMENT} : l'étape « Utilisation et traitement des données » n'a ` +
        `plus de tableau`,
    )
  }
  const types = new Map()
  for (const { entete, rangees } of utilisation) {
    if (entete !== 'Type | 1 | 2 | 3 | 4') {
      throw illisible('utilisation, en-tête', entete)
    }
    for (const [type, collecte, ephemere, controle, finalites] of rangees) {
      if (!TYPES[type]) throw illisible('utilisation, type', type)
      // Rien n'est partagé, et le tableau n'a pas de colonne pour les
      // finalités d'un partage : une autre réponse ne se lirait qu'à moitié.
      if (collecte !== 'Collectées') {
        throw illisible(`utilisation de « ${type} »`, collecte)
      }
      if (!EPHEMERE[ephemere]) {
        throw illisible(`utilisation de « ${type} »`, ephemere)
      }
      if (!CONTROLE[controle]) {
        throw illisible(`utilisation de « ${type} »`, controle)
      }
      const lues = finalites.split(' ; ')
      for (const finalite of lues) {
        if (!FINALITES[finalite]) {
          throw illisible(`utilisation de « ${type} »`, finalite)
        }
      }
      types.set(type, { ephemere, controle, finalites: lues })
    }
  }

  for (const [type, { ephemere, controle, finalites }] of types) {
    const [categorie, id] = TYPES[type]
    const usage = `${UTILISATION}${id}:`
    attendre(categorie, id, 'true', `« ${type} » coché`)
    attendre(
      `${usage}PSL_DATA_USAGE_COLLECTION_AND_SHARING`,
      'PSL_DATA_USAGE_ONLY_COLLECTED',
      'true',
      `« ${type} » : Collectées`,
    )
    attendre(
      `${usage}PSL_DATA_USAGE_EPHEMERAL`,
      '',
      EPHEMERE[ephemere],
      `« ${type} » : éphémère, ${ephemere}`,
    )
    attendre(
      `${usage}DATA_USAGE_USER_CONTROL`,
      CONTROLE[controle],
      'true',
      `« ${type} » : ${controle}`,
    )
    for (const finalite of finalites) {
      attendre(
        `${usage}DATA_USAGE_COLLECTION_PURPOSE`,
        FINALITES[finalite],
        'true',
        `« ${type} » : ${finalite}`,
      )
    }
  }
  return attendues
}

// ── Ce que l'export dit ────────────────────────────────────────────────────

const ENTETE = [
  'Question ID (machine readable)',
  'Response ID (machine readable)',
  'Response value',
  'Answer requirement',
  'Human-friendly question label',
]

/**
 * Les lignes de l'export, en `{ question, reponse, valeur, libelle }`. Le CSV
 * de la console met entre guillemets les libellés qui portent une virgule, et
 * finit ses lignes en CRLF : un découpage aux virgules ne suffirait pas.
 */
export function lireExport(texte) {
  const rangees = []
  let rangee = []
  let cellule = ''
  let entreGuillemets = false
  const source = texte.replace(/^﻿/, '')
  for (let i = 0; i < source.length; i += 1) {
    const signe = source[i]
    if (entreGuillemets) {
      if (signe !== '"') {
        cellule += signe
      } else if (source[i + 1] === '"') {
        cellule += '"'
        i += 1
      } else {
        entreGuillemets = false
      }
    } else if (signe === '"') {
      entreGuillemets = true
    } else if (signe === ',') {
      rangee.push(cellule)
      cellule = ''
    } else if (signe === '\r' || signe === '\n') {
      if (signe === '\r' && source[i + 1] === '\n') i += 1
      rangee.push(cellule)
      rangees.push(rangee)
      rangee = []
      cellule = ''
    } else {
      cellule += signe
    }
  }
  if (cellule !== '' || rangee.length > 0) {
    rangee.push(cellule)
    rangees.push(rangee)
  }

  const [entete, ...lignes] = rangees
  if (!entete || entete.join(',') !== ENTETE.join(',')) {
    throw new Error(
      "ce fichier n'est pas un export de « Sécurité des données » : son " +
        "en-tête n'est pas celui de la console",
    )
  }
  const vues = new Set()
  return lignes.map((cellules, i) => {
    if (cellules.length !== ENTETE.length) {
      throw new Error(
        `la ligne ${i + 2} de l'export a ${cellules.length} colonnes, et non ` +
          `${ENTETE.length}`,
      )
    }
    const [question, reponse, valeur, , libelle] = cellules
    if (vues.has(cle(question, reponse))) {
      throw new Error(
        `la ligne ${i + 2} de l'export répète ${question} ${reponse}`,
      )
    }
    vues.add(cle(question, reponse))
    return { question, reponse, valeur, libelle }
  })
}

// ── La comparaison ─────────────────────────────────────────────────────────

const OUI_NON = { true: 'Oui', false: 'Non' }

// Une réponse à choix se dit par son libellé, qui finit par le choix ; une
// réponse oui ou non, par son libellé et sa valeur.
const decrire = (ligne, valeur) =>
  ligne.reponse
    ? ligne.libelle
    : `${ligne.libelle} → ${OUI_NON[valeur] ?? valeur}`

/**
 * Ce qui manque à l'export et ce qui y est en trop, par rapport au document.
 * Une valeur différente sur une même ligne est les deux à la fois : la
 * réponse attendue manque, celle qui est lue est en trop.
 */
export function comparer(attendues, lignes) {
  const manque = []
  const enTrop = []
  const lues = new Map()
  for (const ligne of lignes) {
    if (!comparee(ligne.question)) continue
    const lue = cle(ligne.question, ligne.reponse)
    lues.set(lue, ligne)
    if (ligne.valeur !== '' && ligne.valeur !== attendues.get(lue)?.valeur) {
      enTrop.push(decrire(ligne, ligne.valeur))
    }
  }
  for (const [lue, attendue] of attendues) {
    const ligne = lues.get(lue)
    if (!ligne) {
      manque.push(`${attendue.dit}, que l'export ne propose même pas`)
    } else if (ligne.valeur !== attendue.valeur) {
      manque.push(decrire(ligne, attendue.valeur))
    }
  }
  return { manque, enTrop }
}

// ── Le contrôle du contrôle ────────────────────────────────────────────────
//
// Il part du dernier export gardé dans `docs/declarations/`, daté dans son nom,
// qui doit passer : c'est ce qui prouve, sur de vraies données, que les
// tableaux du document sont lus en entier. Une réponse changée dans le
// document sans nouvel export gardé fait donc échouer ce contrôle, et c'est
// voulu : le document dit ce que la console déclare.
//
// Puis il casse cet export d'une réponse à la fois, et exige chaque fois le
// refus, sur la ligne cassée, dans le bon sens, et sur elle seule. Les trois
// premiers cas sont les trois erreurs du 30 septembre 2026.

const exportDeReference = () => {
  const dates = readdirSync(join(RACINE, EXPORTS))
    .filter(nom =>
      /^play-securite-des-donnees-\d{4}-\d{2}-\d{2}\.csv$/.test(nom),
    )
    .sort()
  if (dates.length === 0) {
    throw new Error(`aucun export daté dans ${EXPORTS}`)
  }
  return join(EXPORTS, dates[dates.length - 1])
}

function selfTest() {
  const texte = readFileSync(join(RACINE, DOCUMENT), 'utf8')
  const reference = exportDeReference()
  const lignes = lireExport(readFileSync(join(RACINE, reference), 'utf8'))

  // Une copie de l'export où des réponses changent. Une ligne introuvable fait
  // échouer le cas : sinon il ne casserait rien et passerait pour juste.
  const changer = (...changements) =>
    changements.reduce((copie, [question, reponse, valeur]) => {
      if (!copie.some(l => l.question === question && l.reponse === reponse)) {
        throw new Error(`l'export n'a pas de ligne ${question} ${reponse}`)
      }
      return copie.map(l =>
        l.question === question && l.reponse === reponse ? { ...l, valeur } : l,
      )
    }, lignes)
  const usage = (type, question) => `${UTILISATION}${type}:${question}`

  // Chaque écart attendu est une liste de fragments à trouver dans un même
  // écart obtenu ; il n'en faut ni un de plus, ni un de moins.
  const cas = []
  const poser = (nom, construire, attendu) =>
    cas.push({ nom, construire, attendu })

  poser(`${reference} dit ce que dit le document`, () => ({ lignes }), {
    manque: [],
    enTrop: [],
  })
  poser(
    '« Fichiers audio » → « Enregistrements audio ou vidéo » cochée, comme le 30 septembre',
    () => ({ lignes: changer(['PSL_DATA_TYPES_AUDIO', 'PSL_AUDIO', 'true']) }),
    {
      manque: [],
      enTrop: [['Fichiers audio/Enregistrements audio ou vidéo']],
    },
  )
  poser(
    '« Photos » décochée, comme le 30 septembre',
    () => ({
      lignes: changer(['PSL_DATA_TYPES_PHOTOS_AND_VIDEOS', 'PSL_PHOTOS', '']),
    }),
    { manque: [['Photos et vidéos/Photos']], enTrop: [] },
  )
  poser(
    '« Partagées » cochée, comme le 30 septembre',
    () => ({
      lignes: changer([
        usage('PSL_PHOTOS', 'PSL_DATA_USAGE_COLLECTION_AND_SHARING'),
        'PSL_DATA_USAGE_ONLY_SHARED',
        'true',
      ]),
    }),
    { manque: [], enTrop: [['(Photos)', '/Partagées']] },
  )
  poser(
    '« Vidéos » cochée à côté de « Photos »',
    () => ({
      lignes: changer([
        'PSL_DATA_TYPES_PHOTOS_AND_VIDEOS',
        'PSL_VIDEOS',
        'true',
      ]),
    }),
    { manque: [], enTrop: [['Photos et vidéos/Vidéos']] },
  )
  poser(
    '« Photos » traitées de façon éphémère',
    () => ({
      lignes: changer([
        usage('PSL_PHOTOS', 'PSL_DATA_USAGE_EPHEMERAL'),
        '',
        'true',
      ]),
    }),
    {
      manque: [['(Photos)', 'éphémère', '→ Non']],
      enTrop: [['(Photos)', 'éphémère', '→ Oui']],
    },
  )
  poser(
    '« Photos » requises au lieu de facultatives',
    () => {
      const question = usage('PSL_PHOTOS', 'DATA_USAGE_USER_CONTROL')
      return {
        lignes: changer(
          [question, 'PSL_DATA_USAGE_USER_CONTROL_REQUIRED', 'true'],
          [question, 'PSL_DATA_USAGE_USER_CONTROL_OPTIONAL', ''],
        ),
      }
    },
    {
      manque: [['(Photos)', '/Les utilisateurs peuvent choisir']],
      enTrop: [['(Photos)', '/La collecte de données est requise']],
    },
  )
  poser(
    'une finalité de trop : « Analyse » pour « Contacts »',
    () => ({
      lignes: changer([
        usage('PSL_CONTACTS', 'DATA_USAGE_COLLECTION_PURPOSE'),
        'PSL_ANALYTICS',
        'true',
      ]),
    }),
    { manque: [], enTrop: [['(Contacts)', 'collectées', '/Analyse']] },
  )
  poser(
    'une finalité en moins : « Gestion des comptes » pour « ID utilisateur »',
    () => ({
      lignes: changer([
        usage('PSL_USER_ACCOUNT', 'DATA_USAGE_COLLECTION_PURPOSE'),
        'PSL_ACCOUNT_MANAGEMENT',
        '',
      ]),
    }),
    {
      manque: [['(ID utilisateur)', 'collectées', '/Gestion des comptes']],
      enTrop: [],
    },
  )
  poser(
    'une finalité de partage, alors que rien n’est partagé',
    () => ({
      lignes: changer([
        usage('PSL_CONTACTS', 'DATA_USAGE_SHARING_PURPOSE'),
        'PSL_FRAUD_PREVENTION_SECURITY',
        'true',
      ]),
    }),
    {
      manque: [],
      enTrop: [['(Contacts)', 'partagées', '/Prévention des fraudes']],
    },
  )
  poser(
    'le chiffrement en transit à « Non »',
    () => ({
      lignes: changer([
        'PSL_DATA_COLLECTION_ENCRYPTED_IN_TRANSIT',
        '',
        'false',
      ]),
    }),
    {
      manque: [['chiffrées', '→ Oui']],
      enTrop: [['chiffrées', '→ Non']],
    },
  )
  poser(
    'une réponse restée sur un type que rien ne coche',
    () => ({
      lignes: changer([
        usage('PSL_VIDEOS', 'PSL_DATA_USAGE_EPHEMERAL'),
        '',
        'false',
      ]),
    }),
    { manque: [], enTrop: [['(Vidéos)', 'éphémère', '→ Non']] },
  )
  poser(
    'ce que les tableaux ne disent pas n’est pas comparé',
    () => ({
      lignes: changer(['PSL_DATA_DELETION_URL', '', 'https://example.org/']),
    }),
    { manque: [], enTrop: [] },
  )
  poser(
    'un fichier qui n’est pas un export est refusé',
    () => ({ brut: 'Question,Réponse\r\nPSL_PHOTOS,true' }),
    { illisible: "n'est pas un export" },
  )
  poser(
    'un libellé du document que ce contrôle ne connaît pas le fait échouer',
    () => {
      // Sans dépendre de l'alignement des colonnes, que prettier refait.
      const ligne = /^(\| Contacts +\| Collectées +\| Non +\| )Obligatoire/m
      if (!ligne.test(texte)) {
        throw new Error("le document n'a plus la ligne « Contacts » attendue")
      }
      return { doc: texte.replace(ligne, '$1Requise'), lignes }
    },
    { illisible: '« Requise »' },
  )

  const trouve = (ecarts, fragments) =>
    ecarts.some(ecart => fragments.every(fragment => ecart.includes(fragment)))

  let rates = 0
  for (const { nom, construire, attendu } of cas) {
    let obtenu
    try {
      const { doc = texte, brut, lignes: lues } = construire()
      obtenu = comparer(lireDocument(doc), lues ?? lireExport(brut))
    } catch (erreur) {
      obtenu = { illisible: erreur.message }
    }
    const juste = attendu.illisible
      ? Boolean(obtenu.illisible?.includes(attendu.illisible))
      : !obtenu.illisible &&
        ['manque', 'enTrop'].every(
          sens =>
            obtenu[sens].length === attendu[sens].length &&
            attendu[sens].every(fragments => trouve(obtenu[sens], fragments)),
        )
    if (!juste) {
      rates += 1
      console.error(`self-test: ${nom} : ne décide pas juste`)
      console.error(`    attendu : ${JSON.stringify(attendu)}`)
      console.error(`    obtenu : ${JSON.stringify(obtenu)}`)
    }
  }

  if (rates > 0) {
    console.error(
      `self-test: ${rates} cas sur ${cas.length} ne décident pas juste`,
    )
    process.exit(1)
  }
  console.log(
    `self-test: ${cas.length} cas, le contrôle décide juste, à partir de ` +
      reference,
  )
}

const argument = process.argv[2]
if (argument === '--self-test') {
  selfTest()
} else if (!argument) {
  console.error('usage: node scripts/assert-play-data-safety.mjs <export.csv>')
  console.error('       node scripts/assert-play-data-safety.mjs --self-test')
  process.exit(2)
} else {
  let attendues
  let ecarts
  try {
    attendues = lireDocument(readFileSync(join(RACINE, DOCUMENT), 'utf8'))
    ecarts = comparer(attendues, lireExport(readFileSync(argument, 'utf8')))
  } catch (erreur) {
    console.error(`play: FAIL: ${erreur.message}`)
    process.exit(1)
  }
  for (const ecart of ecarts.manque) console.error(`play: manque : ${ecart}`)
  for (const ecart of ecarts.enTrop) console.error(`play: en trop : ${ecart}`)
  if (ecarts.manque.length + ecarts.enTrop.length > 0) {
    console.error(
      `play: FAIL: ${argument} ne dit pas ce que dit ${DOCUMENT} ` +
        `(${ecarts.manque.length} manque, ${ecarts.enTrop.length} en trop)`,
    )
    process.exit(1)
  }
  console.log(
    `play: ${argument} dit ce que dit ${DOCUMENT} : ${attendues.size} ` +
      `réponses, rien en trop`,
  )
}
