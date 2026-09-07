// `hidden` NE CACHE RIEN DÈS QU'UNE RÈGLE D'AUTEUR POSE `display`.
//
// L'attribut ne vaut que par `[hidden] { display: none }` dans la feuille du
// NAVIGATEUR. Toute règle écrite dans la page la bat, quelle que soit la
// spécificité : une feuille d'auteur passe avant celle de l'agent, et la
// question de spécificité ne se pose même pas.
//
// Le 7 septembre 2026 `canvas#qr { display: block }` battait le `hidden` du
// canevas. Sur un téléphone -- où le code QR n'est jamais dessiné, puisque le
// lien s'ouvre directement -- la page d'invitation réservait un bloc blanc de
// 330 pixels entre l'avertissement d'installation et le bouton de copie. Elle
// était en ligne, et toute personne invitée depuis un téléphone le voyait.
// `button.copier` portait la même faute, en dormance.
//
// Aucun contrôle ne pouvait le voir : ils lisent le balisage et font tourner
// le script, aucun ne met la page en page. Celui-ci ne la met pas en page non
// plus -- il lit la règle, ce qui suffit, parce que la faute est dans la
// cascade et non dans le rendu.
//
// CE QU'IL TIENT. Pour chaque règle de la page qui pose un `display` autre que
// `none`, si un élément du balisage correspond à son sélecteur ET porte
// `hidden`, alors la page doit neutraliser `[hidden]` avec `!important`. Sinon
// l'attribut est décoratif, et un élément que le script laisse caché occupe
// quand même sa place.
//
// LES SÉLECTEURS DE CETTE PAGE SONT SIMPLES, et c'est ce qui rend le contrôle
// possible sans moteur CSS : `tag`, `tag#id`, `tag.classe`. Un sélecteur d'une
// autre forme arrête la construction plutôt que d'être ignoré en silence --
// ignorer ce qu'on ne sait pas lire est la manière dont un contrôle devient
// décoratif à son tour.
'use strict'

var fs = require('fs')
var path = require('path')

var chemin =
  process.argv[2] || path.join(__dirname, '..', 'site', 'i', 'index.html')
var page = fs.readFileSync(chemin, 'utf8')
var status = 0

function echouer(message) {
  console.error('cache: FAIL: ' + message)
  status = 1
}

// ── La feuille de la page ─────────────────────────────────────────────────
var style = /<style>([\s\S]*?)<\/style>/.exec(page)
if (!style) {
  echouer("la page d'invitation n'a plus de feuille de style")
  process.exit(1)
}
var feuille = style[1].replace(/\/\*[\s\S]*?\*\//g, '')

// ── Est-ce que `[hidden]` est remis en vigueur, et fortement ? ────────────
//
// `!important` est exigé, pas seulement la règle : sans lui elle perdrait
// contre toute règle plus spécifique posée plus bas, ce qui est précisément la
// situation qu'on répare.
var neutralise = /\[hidden\][^{]*\{[^}]*display\s*:\s*none\s*!important/.test(
  feuille
)

// ── Les règles qui posent un display autre que `none` ─────────────────────
var regles = []
var motif = /([^{}]+)\{([^}]*)\}/g
var m
while ((m = motif.exec(feuille)) !== null) {
  var selecteur = m[1].trim()
  var corps = m[2]
  var display = /(^|[;\s])display\s*:\s*([a-z-]+)/.exec(corps)
  if (!display || display[2] === 'none') {
    continue
  }
  regles.push({ selecteur: selecteur, valeur: display[2] })
}
if (regles.length === 0) {
  echouer(
    "aucune règle de la page ne pose de `display` : la feuille n'a pas été " +
      'lue comme prévu, et un contrôle qui ne lit rien passe toujours'
  )
}

// ── Les éléments du balisage qui portent `hidden` ─────────────────────────
//
// La balise, son id et ses classes suffisent : ce sont les trois choses que
// les sélecteurs de cette page savent nommer.
var caches = []
var baliseMotif = /<([a-z]+)([^>]*\bhidden\b[^>]*)>/g
while ((m = baliseMotif.exec(page)) !== null) {
  var attributs = m[2]
  var id = /\bid="([^"]+)"/.exec(attributs)
  var classe = /\bclass="([^"]+)"/.exec(attributs)
  caches.push({
    balise: m[1],
    id: id ? id[1] : null,
    classes: classe ? classe[1].split(/\s+/) : [],
  })
}
if (caches.length === 0) {
  echouer(
    "aucun élément de la page ne porte `hidden` : le balisage n'a pas été lu " +
      'comme prévu'
  )
}

// ── Le rapprochement ──────────────────────────────────────────────────────
function correspond(simple, element) {
  var forme = /^([a-z]+)?(?:#([a-z0-9-]+))?(?:\.([a-z0-9-]+))?$/.exec(simple)
  if (!forme) {
    echouer(
      'le sélecteur « ' +
        simple +
        " » n'est pas d'une forme que ce contrôle sait lire (balise, #id, " +
        '.classe). Étendez la lecture plutôt que de le laisser passer : un ' +
        "sélecteur ignoré est une règle qui n'est plus tenue."
    )
    return false
  }
  if (forme[1] && forme[1] !== element.balise) return false
  if (forme[2] && forme[2] !== element.id) return false
  if (forme[3] && element.classes.indexOf(forme[3]) === -1) return false
  return Boolean(forme[1] || forme[2] || forme[3])
}

var exposes = []
regles.forEach(function (regle) {
  regle.selecteur.split(',').forEach(function (part) {
    var seul = part.trim()
    if (seul === '' || seul.indexOf('[hidden]') !== -1) return
    caches.forEach(function (element) {
      if (correspond(seul, element)) {
        exposes.push({
          selecteur: seul,
          valeur: regle.valeur,
          quoi: element.id ? '#' + element.id : element.balise,
        })
      }
    })
  })
})

if (exposes.length && !neutralise) {
  exposes.forEach(function (e) {
    echouer(
      '`' +
        e.selecteur +
        '` pose `display: ' +
        e.valeur +
        '` sur ' +
        e.quoi +
        ', qui porte `hidden`. La feuille du navigateur ne peut pas gagner ' +
        "contre celle de la page : l'attribut ne cache donc rien, et " +
        "l'élément occupe sa place même quand le script le laisse caché. " +
        'Posez `[hidden] { display: none !important; }` une fois pour toutes.'
    )
  })
}

if (status === 0) {
  console.log(
    'cache: ' +
      caches.length +
      ' éléments portent `hidden`, ' +
      exposes.length +
      ' seraient découverts par une règle de la page, et `[hidden]` est ' +
      (neutralise ? 'remis en vigueur' : "sans concurrence")
  )
}
process.exit(status)
