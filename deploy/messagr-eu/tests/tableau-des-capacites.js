// DE LA PROSE SUR LES FONCTIONNALITÉS VIEILLIT EN SILENCE.
//
// Deux fois déjà, sur ce produit :
//
//   - la fiche du magasin annonce encore « pas d'images, pas de réactions ».
//     Les deux sont dans le paquet que cette page propose. Personne n'est
//     repassé sur la fiche et rien nulle part ne l'aurait dit ;
//   - la page d'accueil a promis « Vos messages exportables à tout moment »
//     jusqu'au 7 septembre 2026. L'application n'exporte rien, et ce n'était
//     ni livré, ni en cours, ni même ouvert comme ticket.
//
// Un tableau que personne ne vérifie est de la prose avec des bordures. Ce
// contrôle en fait une propriété, en trois règles :
//
//   1. LE TABLEAU EST COMPLET ET SANS DOUBLON. Chaque capacité connue y est
//      exactement une fois, dans exactement un des trois groupes.
//   2. AUCUNE PASTILLE NE CONTREDIT LE TABLEAU. Tout élément de la page qui
//      porte un état -- une carte de la galerie, une ligne de la bande sombre
//      -- nomme sa capacité par `data-cap`, et l'état qu'il affiche est celui
//      que le tableau lui donne. C'est mécanique : aucun vocabulaire, aucun
//      jugement.
//   3. LA PAGE NE RÉCLAME RIEN HORS DU TABLEAU. Une poignée de mots ne peuvent
//      apparaître dans la prose que si le tableau porte leur capacité comme
//      faite. Ailleurs, ils doivent être dans le tableau ou sous une pastille.
//
// La règle 3 est la seule qui demande du vocabulaire, donc la seule qui peut
// se tromper. Elle est tenue courte exprès, et chaque mot est ancré à une
// capacité : mieux vaut une liste qui attrape peu et sûrement qu'une liste
// large qui crie au loup et qu'on finit par désarmer.
//
// CE QU'IL NE DEMANDE PAS. Il ne dit pas si un état est VRAI -- aucun contrôle
// statique ne peut lire un APK et dire « les réactions marchent ». Ce que
// porte la construction servie est mesuré à la main, et `build-landing.mjs`
// refuse de publier un tableau vérifié contre un autre fichier que celui que
// la page propose : la vérification a une date parce qu'elle a une empreinte.
//
// LES LIGNES « FAIT » NE REPOSENT PAS TOUTES SUR LA MÊME FORCE DE PREUVE, et
// il vaut mieux l'écrire ici que de laisser quelqu'un le découvrir :
//
//   - l'entrée par invitation, la conversation à deux, le chiffrement et les
//     notifications sont éprouvés par la suite Detox SUR UN APPAREIL QUI
//     TOURNE -- `boot.test.ts` et `roundTrip.test.ts` : l'invitation dépensée,
//     un message chiffré envoyé, un chiffré altéré refusé, un message écrit
//     par un client indépendant relu, un message écrit qui arrive ;
//   - les photographies, les réactions, le parrainage, l'éviction et les noms
//     locaux reposent sur trois faits plus faibles : le geste est câblé dans
//     `App.tsx`, ses `.spec` couvrent le chemin d'envoi, et son marqueur de
//     journal est dans le paquet servi. C'est plus qu'une lecture du journal
//     des commits et moins qu'une exécution. Le jour où la suite marche sur
//     ces écrans -- #157 -- cette distinction disparaît.
//
// Aucun élément ne dit qu'elles ne marchent pas. Elles sont dans « fait » pour
// cette raison, et la raison est écrite plutôt que supposée connue.
'use strict'

var fs = require('fs')
var os = require('os')
var path = require('path')
var { execFileSync } = require('child_process')

var racine = path.join(__dirname, '..')
var status = 0

function echouer(message) {
  console.error('capacites: FAIL: ' + message)
  status = 1
}

// ── Les six pages construites ─────────────────────────────────────────────
//
// Lues depuis la construction et non depuis `site/`, pour la raison qui a fait
// exister `build-site.sh` : la page committée n'est pas la page servie, et
// c'est la servie qui ment quand elle ment.
var sortie = fs.mkdtempSync(path.join(os.tmpdir(), 'capacites-'))
fs.rmSync(sortie, { recursive: true, force: true })
// LA CONSTRUCTION QUI ÉCHOUE EST UN RÉSULTAT, PAS UNE TRACE DE PILE. Retirer
// une ligne du tableau retire aussi l'unique emploi de sa clef, et
// `build-landing.mjs` refuse alors une clef que nul élément ne porte : c'est
// le bon comportement, et il doit se lire comme un échec de ce contrôle plutôt
// que comme un plantage de node.
try {
  execFileSync(path.join(racine, 'build-site.sh'), [path.join(racine, 'site'), sortie], {
    stdio: 'pipe',
  })
} catch (e) {
  var dit = String((e && e.stderr) || (e && e.stdout) || e).trim()
  console.error(
    'capacites: FAIL: la construction du site s\'arrête, donc il n\'y a pas de ' +
      'page à lire :\n' +
      dit.split('\n').map(function (l) { return '  ' + l }).join('\n')
  )
  process.exit(1)
}

var LANGUES = ['fr', 'en', 'de', 'es', 'it', 'nl']
var pages = {}
LANGUES.forEach(function (langue) {
  var ou = langue === 'fr' ? 'index.html' : path.join(langue, 'index.html')
  pages[langue] = fs.readFileSync(path.join(sortie, ou), 'utf8')
})

// ── 1. Le tableau est complet, et chaque capacité n'y est qu'une fois ─────
//
// La liste est écrite ici plutôt que déduite de la page : déduite, elle serait
// d'accord avec la page quoi que la page dise, et une capacité qu'on retire du
// tableau sortirait des contrôles en même temps que de la vue.
var CONNUES = [
  'tete-a-tete',
  'invitation',
  'chiffrement',
  'photos',
  'reactions',
  'noms',
  'parrainage',
  'notifications',
  'iphone',
  'appels',
  'vocaux',
  'video',
  'salons',
  'communautes',
  'agents',
  'bureau',
]

// Un groupe est une colonne du tableau : sa pastille donne l'état, ses `li`
// donnent les capacités.
function lireLeTableau(html, langue) {
  var section = /<section class="bande capacites"[\s\S]*?<\/section>/.exec(html)
  if (!section) {
    echouer('la page ' + langue + ' ne porte pas le tableau des états')
    return null
  }
  var etats = {}
  var groupes = section[0].match(/<div class="groupe">[\s\S]*?<\/div>/g) || []
  if (groupes.length !== 3) {
    echouer(
      'le tableau de la page ' +
        langue +
        ' porte ' +
        groupes.length +
        ' groupe(s), trois attendus (fait, en cours, à venir)'
    )
    return null
  }
  groupes.forEach(function (groupe) {
    var pastille = /<span class="etat (fait|encours|avenir)"/.exec(groupe)
    if (!pastille) {
      echouer('un groupe du tableau ' + langue + " n'annonce pas son état")
      return
    }
    var lignes = groupe.match(/data-cap="([a-z-]+)"/g) || []
    lignes.forEach(function (brute) {
      var cap = /data-cap="([a-z-]+)"/.exec(brute)[1]
      if (Object.prototype.hasOwnProperty.call(etats, cap)) {
        echouer(
          'la capacité « ' + cap + ' » est dans deux groupes de la page ' + langue
        )
      }
      etats[cap] = pastille[1]
    })
  })
  return etats
}

var tableau = null
LANGUES.forEach(function (langue) {
  var lu = lireLeTableau(pages[langue], langue)
  if (!lu) return
  var manquantes = CONNUES.filter(function (c) {
    return !Object.prototype.hasOwnProperty.call(lu, c)
  })
  if (manquantes.length) {
    echouer(
      'le tableau de la page ' +
        langue +
        ' ne porte pas ' +
        manquantes.join(', ') +
        '. Une capacité retirée du tableau sort des contrôles en même temps ' +
        "que de la vue, et c'est ainsi qu'une annonce fausse survit."
    )
  }
  var inconnues = Object.keys(lu).filter(function (c) {
    return CONNUES.indexOf(c) === -1
  })
  if (inconnues.length) {
    echouer(
      'le tableau de la page ' +
        langue +
        ' porte ' +
        inconnues.join(', ') +
        ", que ce contrôle ne connaît pas. Ajoutez-les à CONNUES et dites " +
        'quel mot les réclamerait.'
    )
  }
  if (langue === 'fr') {
    tableau = lu
  } else if (tableau) {
    // LES SIX PAGES DISENT LE MÊME ÉTAT. Une traduction qui décale une ligne
    // d'un groupe à l'autre annoncerait à un lecteur allemand ce qu'on refuse
    // d'annoncer à un lecteur français.
    CONNUES.forEach(function (cap) {
      if (lu[cap] && tableau[cap] && lu[cap] !== tableau[cap]) {
        echouer(
          'la page ' +
            langue +
            ' donne « ' +
            cap +
            ' » pour ' +
            lu[cap] +
            ' quand la page fr la donne pour ' +
            tableau[cap]
        )
      }
    })
  }
})

// ── 2. Aucune pastille de la page ne contredit le tableau ────────────────
//
// La galerie porte six écrans dont trois ne tournent pas, et la bande sombre
// une ligne sur les appels. Chacun de ces endroits nomme sa capacité, donc
// aucun ne peut dériver du tableau sans que la construction s'arrête. C'est la
// règle qui n'a besoin d'aucun vocabulaire.
if (tableau) {
  LANGUES.forEach(function (langue) {
    var html = pages[langue]
    var horsTableau = html.replace(
      /<section class="bande capacites"[\s\S]*?<\/section>/,
      ''
    )
    // AUTANT DE PASTILLES QUE DE NOMS, ET C'EST LA MOITIÉ QUI MANQUAIT. La
    // règle ci-dessous va des noms vers les pastilles : tout `data-cap` doit
    // afficher l'état que le tableau lui donne. Elle ne dit rien d'une
    // pastille posée sans nom, qui échappait donc à tout -- et une pastille
    // est précisément l'endroit où une page affirme un état.
    //
    // Le compte referme la boucle dans l'autre sens, sans avoir à deviner à
    // quel élément une pastille appartient.
    var pastilles = (horsTableau.match(/class="etat /g) || []).length
    var noms = (horsTableau.match(/data-cap="/g) || []).length
    if (pastilles !== noms) {
      echouer(
        'la page ' +
          langue +
          ' porte ' +
          pastilles +
          ' pastille(s) hors du tableau pour ' +
          noms +
          ' capacité(s) nommée(s). Une pastille sans nom affirme un état que ' +
          'rien ne compare au tableau, et un nom sans pastille montre une ' +
          "capacité sans dire où elle en est."
      )
    }

    // Un porteur est un élément qui déclare `data-cap` : on lit l'état qu'il
    // affiche jusqu'à la fin de son bloc.
    var porteurs = horsTableau.split(/data-cap="/).slice(1)
    if (porteurs.length === 0) {
      echouer(
        'la page ' +
          langue +
          " ne porte aucune pastille nommée hors du tableau. La galerie en " +
          'portait six et la bande sombre une : leur disparition silencieuse ' +
          'est exactement ce que ce contrôle existe pour voir.'
      )
    }
    porteurs.forEach(function (morceau) {
      var cap = /^([a-z-]+)"/.exec(morceau)
      if (!cap) {
        echouer('un `data-cap` de la page ' + langue + " n'a pas de valeur lisible")
        return
      }
      var etat = /<span class="etat (fait|encours|avenir)"/.exec(
        morceau.slice(0, 900)
      )
      if (!etat) {
        echouer(
          'la page ' +
            langue +
            ' marque « ' +
            cap[1] +
            " » sans afficher d'état. Montrer une capacité sans dire où elle " +
            "en est est la seule manière sûre de perdre le lecteur qu'on " +
            'cherchait à convaincre.'
        )
        return
      }
      if (tableau[cap[1]] !== etat[1]) {
        echouer(
          'la page ' +
            langue +
            ' affiche « ' +
            cap[1] +
            ' » comme ' +
            etat[1] +
            ' quand le tableau la donne pour ' +
            tableau[cap[1]]
        )
      }
    })
  })
}

// ── 3. La page ne réclame rien que le tableau ne donne pour fait ─────────
//
// Chaque mot est ancré à une capacité, et n'est cherché que dans la prose :
// hors du tableau, et hors de tout élément qui affiche déjà un état.
//
// Le mot est cherché avec ses frontières, sinon « appel » attrape « rappel »
// et « rappelle ». Les formes fléchies sont listées à la main plutôt que
// devinées : une racine trop courte fait un contrôle qui crie au loup, et un
// contrôle qui crie au loup finit désarmé.
var MOTS = {
  appels: {
    fr: ['appels', 'appel audio', 'appeler'],
    en: ['audio call', 'audio calls', 'phone call'],
    de: ['Audioanruf', 'Audioanrufe', 'anrufen'],
    es: ['llamada de audio', 'llamadas de audio'],
    it: ['chiamata audio', 'chiamate audio'],
    nl: ['audiogesprek', 'audiogesprekken'],
  },
  video: {
    fr: ['appel vidéo', 'appels vidéo', 'visioconférence'],
    en: ['video call', 'video calls'],
    de: ['Videoanruf', 'Videoanrufe'],
    es: ['videollamada', 'videollamadas'],
    it: ['videochiamata', 'videochiamate'],
    nl: ['videogesprek', 'videogesprekken'],
  },
  vocaux: {
    fr: ['message vocal', 'messages vocaux'],
    en: ['voice message', 'voice messages'],
    de: ['Sprachnachricht', 'Sprachnachrichten'],
    es: ['mensaje de voz', 'mensajes de voz'],
    it: ['messaggio vocale', 'messaggi vocali'],
    nl: ['spraakbericht', 'spraakberichten'],
  },
  salons: {
    fr: ['salons', 'groupes', 'conversation de groupe'],
    en: ['group chat', 'group chats', 'channels'],
    de: ['Gruppenchat', 'Kanäle'],
    es: ['grupos', 'canales'],
    it: ['gruppi', 'canali'],
    nl: ['groepsgesprek', 'kanalen'],
  },
  communautes: {
    fr: ['communautés'],
    en: ['communities'],
    de: ['Gemeinschaften'],
    es: ['comunidades'],
    it: ['comunità'],
    nl: ['gemeenschappen'],
  },
  agents: {
    fr: ['agents'],
    en: ['agents'],
    de: ['Agenten'],
    es: ['agentes'],
    it: ['agenti'],
    nl: ['agenten'],
  },
  bureau: {
    fr: ['application de bureau', 'ordinateur de bureau'],
    en: ['desktop application', 'desktop app'],
    de: ['Desktop-Anwendung'],
    es: ['aplicación de escritorio'],
    it: ['applicazione desktop'],
    nl: ['bureaubladtoepassing'],
  },
}

// LA CAPACITÉ QUI A COÛTÉ LE PLUS CHER N'EST DANS AUCUN TABLEAU. « Vos
// messages exportables à tout moment » a vécu ici parce qu'aucune règle ne
// regardait ce que la page promettait. L'export n'est ni livré, ni en cours,
// ni ouvert comme ticket : il n'a donc pas de ligne, et le mot est interdit
// partout. Le jour où il est fait, on lui donne une ligne et on retire ceci.
var JAMAIS = {
  fr: ['exportable', 'exportables', 'exporter vos messages'],
  en: ['exportable', 'export your messages'],
  de: ['exportierbar'],
  es: ['exportable', 'exportables'],
  it: ['esportabile', 'esportabili'],
  nl: ['exporteerbaar'],
}

function echapper(mot) {
  return mot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// La prose, c'est-à-dire : sans le tableau, sans les commentaires -- ils
// expliquent volontiers ce que la page ne fait PAS -- et sans les blocs qui
// affichent déjà un état.
function prose(html) {
  return html
    .replace(/<section class="bande capacites"[\s\S]*?<\/section>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<style>[\s\S]*?<\/style>/g, '')
    .replace(/<script>[\s\S]*?<\/script>/g, '')
    .replace(/<div class="vue" data-cap="[\s\S]*?<\/div>\s*<\/div>/g, '')
    .replace(/<div class="loupe"[^>]*data-cap="[\s\S]*?<\/figure>\s*<\/div>/g, '')
    .replace(/<li data-cap="[\s\S]*?<\/li>/g, '')
}

if (tableau) {
  LANGUES.forEach(function (langue) {
    var texte = prose(pages[langue])
    Object.keys(MOTS).forEach(function (cap) {
      if (tableau[cap] === 'fait') return
      ;(MOTS[cap][langue] || []).forEach(function (mot) {
        var motif = new RegExp('(^|[^\\p{L}])' + echapper(mot) + '($|[^\\p{L}])', 'iu')
        if (motif.test(texte)) {
          echouer(
            'la page ' +
              langue +
              ' écrit « ' +
              mot +
              ' » hors du tableau, alors que « ' +
              cap +
              ' » y est donnée pour ' +
              tableau[cap] +
              '. Une capacité montrée sans son état se lit comme une capacité ' +
              'livrée.'
          )
        }
      })
    })
    ;(JAMAIS[langue] || []).forEach(function (mot) {
      var motif = new RegExp('(^|[^\\p{L}])' + echapper(mot) + '($|[^\\p{L}])', 'iu')
      if (motif.test(texte)) {
        echouer(
          'la page ' +
            langue +
            ' écrit « ' +
            mot +
            ' », et rien de tel n\'existe : ni livré, ni en cours, ni ouvert ' +
            'comme ticket. C\'est le mot exact qui a vécu sur cette page ' +
            "jusqu'au 7 septembre 2026."
        )
      }
    })
  })
}

fs.rmSync(sortie, { recursive: true, force: true })

if (status === 0) {
  console.log(
    'capacites: ' +
      CONNUES.length +
      ' capacités, trois états, les mêmes sur les six pages ; aucune pastille ' +
      'ne contredit le tableau et la prose ne réclame rien qui ne soit fait'
  )
}
process.exit(status)
