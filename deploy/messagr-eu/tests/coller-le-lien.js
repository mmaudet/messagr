// AUCUNE PAGE CONSTRUITE NE PROMET DE COLLER LE LIEN.
//
// Le site l'a promis dans les six langues jusqu'au 13 septembre 2026. La page
// d'invitation offrait « Copier le lien », puis disait « Ouvrez Messagr après
// l'installation : il vous proposera de le coller » ; la page du téléchargement
// disait « Ouvrez Messagr, et collez-le ». L'application n'a aucun champ où
// coller un lien et ne lit pas le presse-papiers. Son écran d'avant l'entrée le
// dit lui-même : « Ouvrez le lien d'invitation qu'on vous a envoyé : c'est la
// seule porte ». Une personne dont le lien ouvrait le navigateur copiait,
// installait, ouvrait l'application, et n'avait rien où coller.
//
// # Ce que ce contrôle lit
//
// TOUTES LES PAGES QUE LA CONSTRUCTION ÉCRIT, sans fichier proposé et avec, et
// pas une liste : la promesse vivait sur deux pages, et rien ne dit que la
// suivante ne s'en choisirait pas une troisième. La page entière, attributs et
// catalogues embarqués compris, puisque la page d'invitation porte cinq de ses
// six langues dans son script. Les commentaires sont retirés d'abord : ils
// racontent volontiers ce que la page ne fait plus, et un commentaire n'est une
// promesse faite à personne.
//
// # Ce qu'il cherche
//
// Les formes du verbe dans chacune des six langues, sur chaque page quelle que
// soit sa langue, et avec leurs frontières : sans elles, « plak » attraperait
// « plakkaat ». Listées à la main, pour la raison que donne
// `landing/mots-des-capacites.json` : une racine trop courte fait un contrôle
// qui crie au loup, et un contrôle qui crie au loup finit désarmé.
//
// Coller est refusé partout, et pas seulement vers l'application. Aucune page
// ne demande aujourd'hui de coller quoi que ce soit ; le jour où l'une le fera
// pour une bonne raison, c'est ici qu'on l'écrira, avec cette raison.
//
// # Et il prouve qu'il sait lire
//
// Les douze phrases qui ont porté la promesse repassent au détecteur, et
// chacune doit être prise dans sa langue ; enfermée dans un commentaire, aucune
// ne doit l'être. Un balayage qui ne trouve rien parce qu'il lit mal ressemble
// exactement à un site qui ne promet rien.
'use strict';

var fs = require('fs');
var os = require('os');
var path = require('path');
var child = require('child_process');

var racine = path.join(__dirname, '..');
var status = 0;

function echouer(message) {
  console.error('coller: FAIL: ' + message);
  status = 1;
}

// ── Les formes du verbe, par langue ──────────────────────────────────────
var FORMES = {
  fr: ['coller', 'collez', 'collera', 'collerez', 'colle-le'],
  en: ['paste', 'pastes', 'pasted', 'pasting'],
  de: ['einfügen', 'einzufügen', 'eingefügt', 'fügen Sie ihn ein'],
  es: ['pegar', 'pegarlo', 'péguelo', 'pégalo', 'pegue', 'pegado'],
  it: ['incollare', 'incollarlo', 'incollalo', 'incolla', 'incollato'],
  nl: ['plakken', 'plak', 'plakt', 'geplakt']
};

function echapper(mot) {
  return mot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

var MOTIFS = [];
Object.keys(FORMES).forEach(function (langue) {
  FORMES[langue].forEach(function (forme) {
    MOTIFS.push({
      langue: langue,
      forme: forme,
      motif: new RegExp('(^|[^\\p{L}])' + echapper(forme) + '($|[^\\p{L}])', 'iu')
    });
  });
});

// Ce qu'une personne peut lire : la page sans ses commentaires, sous les trois
// formes qu'ils prennent dans ces pages -- HTML, bloc de feuille ou de script,
// ligne de script -- et les blancs ramenés à un seul, parce que le balisage
// coupe les phrases où il veut.
function lisible(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[ \t]*\/\/.*$/gm, ' ')
    .replace(/\s+/g, ' ');
}

function promesses(texte) {
  return MOTIFS.filter(function (m) {
    return m.motif.test(texte);
  }).map(function (m) {
    return m.langue + ' « ' + m.forme + ' »';
  });
}

// ── 1. Le détecteur, sur les phrases qui ont porté la promesse ───────────
var PORTEES = {
  fr: [
    "Lien copié. Ouvrez Messagr après l'installation : il vous proposera de le coller.",
    "Sur la page qui s'affiche, touchez « Copier le lien ». Ouvrez Messagr, et collez-le."
  ],
  en: [
    'Link copied. Open Messagr after installing: it will offer to paste it.',
    'On the page that appears, tap “Copy the link”. Open Messagr, and paste it.'
  ],
  de: [
    'Link kopiert. Öffnen Sie Messagr nach der Installation: es bietet Ihnen an, ihn einzufügen.',
    'Tippen Sie auf der angezeigten Seite auf „Link kopieren“. Öffnen Sie Messagr und fügen Sie ihn ein.'
  ],
  es: [
    'Enlace copiado. Abra Messagr después de instalarlo: le propondrá pegarlo.',
    'En la página que aparece, toque «Copiar el enlace». Abra Messagr y péguelo.'
  ],
  it: [
    "Link copiato. Apri Messagr dopo l'installazione: ti proporrà di incollarlo.",
    'Nella pagina che compare, tocca «Copia il link». Apri Messagr e incollalo.'
  ],
  nl: [
    'Link gekopieerd. Open Messagr na de installatie: het biedt aan om hem te plakken.',
    'Tik op de pagina die verschijnt op “De link kopiëren”. Open Messagr en plak hem.'
  ]
};

var eprouvees = 0;
Object.keys(PORTEES).forEach(function (langue) {
  PORTEES[langue].forEach(function (phrase) {
    eprouvees += 1;
    var prises = promesses(lisible('<p>' + phrase + '</p>')).filter(function (p) {
      return p.indexOf(langue + ' ') === 0;
    });
    if (!prises.length) {
      echouer('le détecteur ne prend pas, en ' + langue + ', la phrase « ' + phrase + ' »');
    }
    var commentee = '<!-- ' + phrase + ' -->\n<script>\n  // ' + phrase +
      '\n  /* ' + phrase + ' */\n</script>';
    var prisesEnCommentaire = promesses(lisible(commentee));
    if (prisesEnCommentaire.length) {
      echouer('le détecteur prend pour une promesse un commentaire qui porte « ' +
        phrase + ' » (' + prisesEnCommentaire.join(', ') + ')');
    }
  });
});

// ── 2. Les pages que la construction écrit ───────────────────────────────
//
// L'ENVIRONNEMENT EST POSÉ, PAS HÉRITÉ, comme dans `telechargement-retire.js` :
// une construction « sans fichier » qui verrait des mesures exportées par
// l'appelant en proposerait un.
function construire(variables) {
  var sortie = fs.mkdtempSync(path.join(os.tmpdir(), 'coller-'));
  var env = { PATH: process.env.PATH, HOME: process.env.HOME };
  Object.keys(variables).forEach(function (nom) {
    env[nom] = variables[nom];
  });
  try {
    child.execFileSync(path.join(racine, 'build-site.sh'),
      [path.join(racine, 'site'), sortie], { env: env, stdio: 'pipe' });
  } catch (e) {
    fs.rmSync(sortie, { recursive: true, force: true });
    var dit = e.stderr ? e.stderr.toString() : e.message;
    echouer('build-site.sh a refusé de construire le site :\n' + dit.trim());
    return null;
  }
  return sortie;
}

// Chaque page HTML de l'arbre, sans exception et sans liste.
function pagesConstruites(repertoire, prefixe) {
  var trouvees = [];
  fs.readdirSync(path.join(repertoire, prefixe), { withFileTypes: true })
    .forEach(function (entree) {
      var relatif = prefixe ? prefixe + '/' + entree.name : entree.name;
      if (entree.isDirectory()) {
        trouvees = trouvees.concat(pagesConstruites(repertoire, relatif));
      } else if (/\.html$/.test(entree.name)) {
        trouvees.push(relatif);
      }
    });
  return trouvees.sort();
}

var langues = Object.keys(JSON.parse(
  fs.readFileSync(path.join(racine, 'landing/copy.json'), 'utf8')
));
// L'EMPREINTE EST CELLE QUE L'ACCUEIL DÉCLARE, pour la raison écrite dans
// `langues-page-invitation.js` : une autre tomberait sur le garde-fou du
// tableau des états, et la construction échouerait pour la raison d'un autre.
var declaree = /data-verifie-sur="([0-9a-f]{64})"/.exec(
  fs.readFileSync(path.join(racine, 'site/index.html'), 'utf8')
);
if (!declaree) {
  echouer("l'accueil ne déclare pas `data-verifie-sur` : la construction avec " +
    'fichier ne peut pas être fabriquée');
}
var CONSTRUCTIONS = [
  { nom: 'sans fichier proposé', variables: {} },
  {
    nom: 'avec le fichier',
    variables: declaree
      ? {
        MESSAGR_APK_OCTETS: '139006945',
        MESSAGR_APK_SHA256: declaree[1],
        MESSAGR_APK_DATE: '2026-09-07'
      }
      : null
  }
];

var lues = 0;
CONSTRUCTIONS.forEach(function (construction) {
  if (!construction.variables) {
    return;
  }
  var sortie = construire(construction.variables);
  if (!sortie) {
    return;
  }
  try {
    var pages = pagesConstruites(sortie, '');
    // UN BALAYAGE QUI NE LIT RIEN PASSE TOUJOURS. Moins de pages que les deux
    // que chaque langue engendre, et « aucune ne promet » ne voudrait rien dire.
    if (pages.length < langues.length * 2) {
      echouer('la construction ' + construction.nom + " n'écrit que " +
        pages.length + ' page(s)');
    }
    pages.forEach(function (relatif) {
      var prises = promesses(lisible(fs.readFileSync(path.join(sortie, relatif), 'utf8')));
      if (prises.length) {
        echouer('la page construite « ' + relatif + ' » (' + construction.nom +
          ') promet de coller le lien : ' + prises.join(', '));
      }
    });
    lues += pages.length;
  } finally {
    fs.rmSync(sortie, { recursive: true, force: true });
  }
});

if (status === 0) {
  console.log('coller: aucune des ' + lues + ' pages construites, avec et sans ' +
    'fichier, ne promet de coller le lien, et le détecteur prend les ' +
    eprouvees + ' phrases qui l\'ont promis');
}
process.exit(status);
