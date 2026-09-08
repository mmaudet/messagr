// LA FICHE DU MAGASIN DÉCRIVAIT UN PRODUIT QUI N'EXISTAIT PLUS.
//
// Elle annonçait « Pas de groupes, pas d'appels, pas d'images, pas de
// réactions ». Les photographies et les réactions sont dans le paquet que le
// site propose au téléchargement, mesuré et non déduit. Deux de ses quatre
// affirmations étaient donc fausses, et RIEN NULLE PART NE L'AURAIT DIT :
// personne ne repasse sur une fiche de magasin quand une fonctionnalité est
// livrée, et aucune règle ne reliait les deux.
//
// La page d'accueil porte depuis le 7 septembre 2026 un tableau daté de ce que
// l'application fait. Ce contrôle relie la fiche à ce tableau, pour que les
// deux ne puissent plus diverger en silence.
//
// # Pourquoi une déclaration, et pas une phrase engendrée
//
// Engendrer la prose depuis le tableau supprimerait le problème et coûterait
// ce que la fiche a de mieux : elle est écrite, pas assemblée. Le paragraphe
// « CE QUE NOUS DISONS AUSSI » est la meilleure prose de ce projet, et une
// phrase construite par une machine à partir d'étiquettes se reconnaît.
//
// La fiche déclare donc, dans un champ que `publish.py` n'envoie pas à Play,
// ce qu'elle dit porter et ce qu'elle dit ne pas porter. Trois règles, et
// aucune ne demande à la machine d'écrire :
//
//   1. LA DÉCLARATION S'ACCORDE AU TABLEAU. Tout ce qu'elle dit porter y est
//      « fait » ; rien de ce qu'elle dit ne pas porter n'y est « fait ».
//   2. LA PROSE DIT CE QUE LA DÉCLARATION DÉCLARE. Chaque capacité citée dans
//      l'un des deux camps a son mot dans le texte, sinon la déclaration
//      dérive du texte qu'elle est censée décrire.
//   3. LA PROSE NE PARLE DE RIEN D'AUTRE. Un mot de capacité trouvé dans le
//      texte et absent des deux listes arrête la construction, et le mot
//      « exportable » est interdit partout.
//
// # Ce qu'il ne fait pas
//
// Il ne relit pas la prose : « chiffré de bout en bout » pourrait être faux
// sans qu'il s'en aperçoive. Il tient la seule chose qui se soit réellement
// cassée ici, deux fois : une liste de fonctionnalités qui vieillit pendant
// que le produit avance.
'use strict'

var fs = require('fs')
var os = require('os')
var path = require('path')
var { execFileSync } = require('child_process')

var racine = path.join(__dirname, '..')
var status = 0

function echouer(message) {
  console.error('fiche: FAIL: ' + message)
  status = 1
}

var VOCABULAIRE = JSON.parse(
  fs.readFileSync(path.join(racine, 'landing', 'mots-des-capacites.json'), 'utf8')
)

// ── Le tableau, lu sur la page construite ─────────────────────────────────
//
// Construite et non committée, pour la raison qui a fait exister
// `build-site.sh` : c'est la page servie qui ment quand elle ment.
var sortie = fs.mkdtempSync(path.join(os.tmpdir(), 'fiche-'))
fs.rmSync(sortie, { recursive: true, force: true })
try {
  execFileSync(
    path.join(racine, 'build-site.sh'),
    [path.join(racine, 'site'), sortie],
    { stdio: 'pipe' }
  )
} catch (e) {
  var dit = String((e && e.stderr) || (e && e.stdout) || e).trim()
  console.error(
    "fiche: FAIL: la construction du site s'arrête, donc il n'y a pas de " +
      'tableau à lire :\n' +
      dit
        .split('\n')
        .map(function (l) {
          return '  ' + l
        })
        .join('\n')
  )
  process.exit(1)
}

var accueil = fs.readFileSync(path.join(sortie, 'index.html'), 'utf8')
fs.rmSync(sortie, { recursive: true, force: true })

var tableau = {}
var section = /<section class="bande capacites"[\s\S]*?<\/section>/.exec(accueil)
if (!section) {
  echouer("la page d'accueil ne porte pas le tableau des états")
  process.exit(1)
}
;(section[0].match(/<div class="groupe">[\s\S]*?<\/div>/g) || []).forEach(
  function (groupe) {
    var pastille = /<span class="etat (fait|encours|avenir)"/.exec(groupe)
    if (!pastille) return
    ;(groupe.match(/data-cap="([a-z-]+)"/g) || []).forEach(function (brute) {
      tableau[/data-cap="([a-z-]+)"/.exec(brute)[1]] = pastille[1]
    })
  }
)
if (Object.keys(tableau).length === 0) {
  echouer("le tableau des états n'a livré aucune capacité")
  process.exit(1)
}

// ── Les fiches ────────────────────────────────────────────────────────────
var dossier = path.join(racine, 'play-listing')
var fiches = fs.readdirSync(dossier).filter(function (f) {
  return f.endsWith('.json')
})
if (fiches.length === 0) {
  echouer('aucune fiche à lire dans play-listing/')
}

function echapper(mot) {
  return mot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function cite(texte, mot) {
  return new RegExp('(^|[^\\p{L}])' + echapper(mot) + '($|[^\\p{L}])', 'iu').test(
    texte
  )
}

// Les mots d'une capacité, dans la langue de la fiche. Une langue sans
// vocabulaire ARRÊTE plutôt que de passer : une fiche allemande qu'on ne sait
// pas lire est une fiche qu'on ne tient pas, et un contrôle qui saute en
// silence ce qu'il ne comprend pas est décoratif.
function motsDe(cap, langue, quoi) {
  var famille = VOCABULAIRE.aVenir[cap] || VOCABULAIRE.livrees[cap]
  if (!famille) {
    echouer(
      quoi +
        ' nomme « ' +
        cap +
        " », que `mots-des-capacites.json` ne connaît pas. Ajoutez-lui ses mots."
    )
    return null
  }
  if (!famille[langue] || famille[langue].length === 0) {
    echouer(
      quoi +
        ' est en « ' +
        langue +
        ' » et `mots-des-capacites.json` ne donne aucun mot de « ' +
        cap +
        ' » dans cette langue. Une fiche qu\'on ne sait pas lire est une fiche ' +
        "qu'on ne tient pas."
    )
    return null
  }
  return famille[langue]
}

fiches.forEach(function (fichier) {
  var quoi = 'la fiche ' + fichier
  var fiche = JSON.parse(fs.readFileSync(path.join(dossier, fichier), 'utf8'))
  var texte = fiche.fullDescription || ''
  var langue = String(fiche.language || '').split('-')[0]
  if (!langue) {
    echouer(quoi + ' ne dit pas sa langue')
    return
  }

  var declare = fiche.capacites
  if (!declare || !Array.isArray(declare.porte) || !Array.isArray(declare.pasEncore)) {
    echouer(
      quoi +
        " ne déclare pas ce qu'elle porte. Sans `capacites: { porte: [], " +
        'pasEncore: [] }`, rien ne relie sa prose au tableau daté, et une ' +
        'fonctionnalité livrée la laisse fausse sans que personne le voie.'
    )
    return
  }

  // ── 1. La déclaration s'accorde au tableau ─────────────────────────────
  declare.porte.forEach(function (cap) {
    if (!Object.prototype.hasOwnProperty.call(tableau, cap)) {
      echouer(quoi + ' dit porter « ' + cap + ' », qui n\'est pas dans le tableau')
    } else if (tableau[cap] !== 'fait') {
      echouer(
        quoi +
          ' dit porter « ' +
          cap +
          ' », que le tableau donne pour ' +
          tableau[cap] +
          ". Une fiche de magasin qui annonce ce qui ne tourne pas est la " +
          'raison de ce contrôle.'
      )
    }
  })
  declare.pasEncore.forEach(function (cap) {
    if (!Object.prototype.hasOwnProperty.call(tableau, cap)) {
      echouer(
        quoi + ' dit ne pas porter « ' + cap + ' », qui n\'est pas dans le tableau'
      )
    } else if (tableau[cap] === 'fait') {
      echouer(
        quoi +
          ' dit ne pas porter « ' +
          cap +
          " », que le tableau donne pour fait. C'est le sens exact dans lequel " +
          'cette fiche est devenue fausse : elle annonçait « pas d\'images, pas ' +
          'de réactions » pendant que les deux étaient livrées.'
      )
    }
  })
  var deuxFois = declare.porte.filter(function (c) {
    return declare.pasEncore.indexOf(c) !== -1
  })
  if (deuxFois.length) {
    echouer(quoi + ' déclare ' + deuxFois.join(', ') + ' dans les deux camps')
  }

  // ── 2. La prose dit ce que la déclaration déclare ──────────────────────
  declare.porte.concat(declare.pasEncore).forEach(function (cap) {
    var mots = motsDe(cap, langue, quoi)
    if (!mots) return
    var trouve = mots.some(function (mot) {
      return cite(texte, mot)
    })
    if (!trouve) {
      echouer(
        quoi +
          ' déclare « ' +
          cap +
          " » et n'en dit pas un mot dans son texte (cherché : " +
          mots.join(', ') +
          '). La déclaration doit décrire la prose, pas la remplacer.'
      )
    }
  })

  // ── 3. La prose ne parle de rien d'autre ───────────────────────────────
  Object.keys(VOCABULAIRE.aVenir).forEach(function (cap) {
    if (
      declare.porte.indexOf(cap) !== -1 ||
      declare.pasEncore.indexOf(cap) !== -1
    ) {
      return
    }
    var mots = VOCABULAIRE.aVenir[cap][langue] || []
    mots.forEach(function (mot) {
      if (cite(texte, mot)) {
        echouer(
          quoi +
            ' écrit « ' +
            mot +
            ' » sans déclarer « ' +
            cap +
            " ». Un mot de capacité qui n'est dans aucun des deux camps " +
            "échappe à la comparaison avec le tableau, et c'est là que la " +
            'fiche recommencerait à vieillir en silence.'
        )
      }
    })
  })
  ;(VOCABULAIRE.jamais[langue] || []).forEach(function (mot) {
    if (cite(texte, mot)) {
      echouer(
        quoi +
          ' écrit « ' +
          mot +
          " », et rien de tel n'existe : ni livré, ni en cours, ni ouvert " +
          'comme ticket.'
      )
    }
  })
})

if (status === 0) {
  console.log(
    'fiche: ' +
      fiches.length +
      ' fiche(s) de magasin, accordée(s) au tableau daté : ce qu’elles disent ' +
      'porter y est fait, ce qu’elles disent ne pas porter ne l’est pas, et ' +
      'leur prose ne parle d’aucune capacité qu’elles ne déclarent pas'
  )
}
process.exit(status)
