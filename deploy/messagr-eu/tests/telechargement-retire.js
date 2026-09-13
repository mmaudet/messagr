// AUCUNE PAGE SERVIE NE NOMME UN TÉLÉCHARGEMENT QUE LE DÉPLOIEMENT A RETIRÉ.
//
// Le 13 septembre 2026, le déploiement de 03:33 UTC a été lancé avec
// `MESSAGR_APK=none`. Le fichier a quitté le serveur, et
// `https://messagr.eu/messagr.apk` répondait 404. La vérification finale de
// `deploy.sh` a lu la page d'invitation, n'y a trouvé aucune adresse de
// téléchargement, et affiché « no download offered, and the page says so ».
// Pendant ce temps, les six pages d'accueil servaient le badge « Android,
// Téléchargement direct » vers ce 404. La vérification lisait une page, et
// celle qui mentait en était une autre.
//
// # Ce que ce contrôle lit
//
// TOUTES LES PAGES QUE CE DÉPÔT CONSTRUIT, telles que le serveur les répond, et
// pas une liste : une liste est exactement ce qui a laissé l'accueil hors du
// champ. Les adresses viennent d'une construction du site, comme pour
// `conformite-site-deploye.js`, parce que HTTP ne permet pas d'énumérer ce
// qu'un serveur détient.
//
// Une page que le serveur ne répond pas est un échec, pas un laissez-passer :
// dire qu'une page ne nomme pas le fichier demande de l'avoir lue.
//
// # Ce qu'il cherche
//
// Le chemin du fichier, `/` suivi du nom que `deploy.sh` publie, n'importe où
// dans la page. Le nom est LU dans `deploy.sh`, comme le font déjà
// `destinations-page-invitation.js` et `landing/rendre-ecrans.mjs`. N'importe
// où, et pas seulement dans un `href` : l'adresse absolue que la page
// d'invitation porterait dans ses destinations mène au même 404.
//
// # Pourquoi la moitié hors ligne existe
//
// L'intégration continue lance chaque `.js` de ce répertoire sans argument et
// sans réseau. Sans argument, ce fichier construit le site avec et sans
// fichier proposé, et éprouve son contrôle contre cinq serveurs faits de ces
// pages construites. Un contrôle qui ne saurait que parler au serveur ne
// serait exercé qu'au déploiement, c'est-à-dire trop tard pour apprendre qu'il
// se trompe.
//
// # Usage
//
//   node telechargement-retire.js                    éprouve le contrôle
//   node telechargement-retire.js --live             contre https://messagr.eu
//   node telechargement-retire.js --live https://... contre un autre serveur
//
// La forme en direct AFFIRME qu'aucun téléchargement n'est proposé. Sur un site
// qui en propose un, l'accueil et la page du téléchargement le nomment et elle
// échoue : c'est pourquoi `deploy.sh` ne la lance que lorsque le déploiement
// n'en propose aucun.
'use strict';

var fs = require('fs');
var os = require('os');
var path = require('path');
var child = require('child_process');
var https = require('https');
// Requis plutôt que pris dans les globales, pour la raison écrite dans
// `conformite-site-deploye.js` : la configuration ESLint de ce dépôt ne
// déclare pas `Buffer`.
var Buffer = require('buffer').Buffer;

var racine = path.join(__dirname, '..');
var construction = path.join(racine, 'build-site.sh');
// Les pages sont écrites pour ce domaine, quel que soit le serveur interrogé :
// l'adresse absolue du fichier est la sienne.
var DOMAINE = 'https://messagr.eu';

var status = 0;

function echouer(message) {
  console.error('telechargement: FAIL: ' + message);
  status = 1;
}

// ── Le chemin du fichier, lu et non recopié ────────────────────────────────
//
// Introuvable, c'est un échec : un contrôle qui chercherait un nom par défaut
// continuerait de passer en cherchant autre chose que ce qui est publié.
function lireLeChemin() {
  var deploiement = fs.readFileSync(path.join(racine, 'deploy.sh'), 'utf8');
  var trouve = /^APK_NAME=(\S+)$/m.exec(deploiement);
  if (!trouve) {
    echouer('deploy.sh ne déclare plus APK_NAME : ce contrôle ne sait plus ' +
      'quel fichier chercher, et passerait sans rien chercher');
    return null;
  }
  return '/' + trouve[1];
}

// ── Les pages construites, et leur adresse ─────────────────────────────────
//
// `adresseDe`, `chercher` et `argument` sont ceux de
// `conformite-site-deploye.js`, recopiés : ce fichier-là s'exécute dès qu'on le
// charge et ne s'importe pas.
//
// Un `index.html` s'atteint par son répertoire avec la barre finale, comme
// nginx le sert (`index index.html`).
function adresseDe(chemin) {
  var morceaux = chemin.split('/');
  if (morceaux[morceaux.length - 1] === 'index.html') {
    morceaux.pop();
    return '/' + (morceaux.length ? morceaux.join('/') + '/' : '');
  }
  return '/' + chemin;
}

// Chaque page HTML de l'arbre, sans exception et sans liste.
function pagesConstruites(repertoire, prefixe) {
  prefixe = prefixe || '';
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

// L'ENVIRONNEMENT EST POSÉ, PAS HÉRITÉ. Une construction « sans fichier » qui
// verrait des mesures exportées par l'appelant en proposerait un, et le cas qui
// doit ne rien nommer nommerait douze pages pour une raison qui n'est pas la
// sienne.
function construire(variables) {
  var sortie = fs.mkdtempSync(path.join(os.tmpdir(), 'telechargement-'));
  var env = { PATH: process.env.PATH, HOME: process.env.HOME };
  Object.keys(variables).forEach(function (nom) {
    env[nom] = variables[nom];
  });
  try {
    child.execFileSync(construction, [path.join(racine, 'site'), sortie],
      { env: env, stdio: 'pipe' });
  } catch (e) {
    fs.rmSync(sortie, { recursive: true, force: true });
    var dit = e.stderr ? e.stderr.toString() : e.message;
    echouer('build-site.sh a refusé de construire le site :\n' + dit.trim());
    return null;
  }
  return sortie;
}

// ── Le contrôle ────────────────────────────────────────────────────────────
//
// `lire` est une fonction plutôt qu'un client HTTP : la couture de
// `conformite-site-deploye.js`, pour la même raison. Hors ligne elle répond
// depuis une table, en direct elle rend ce qui a été récolté, et le contrôle ne
// sait pas laquelle des deux il tient.
function pagesQuiNomment(adresses, lire, chemin) {
  var ecarts = [];
  adresses.forEach(function (adresse) {
    var reponse = lire(adresse);
    if (!reponse || reponse.status !== 200) {
      var quoi = reponse && reponse.status
        ? 'répond ' + reponse.status
        : 'ne répond pas' + (reponse && reponse.erreur ? ' (' + reponse.erreur + ')' : '');
      ecarts.push({
        adresse: adresse,
        ecart: 'le serveur ' + quoi + " : une page qui n'a pas été lue ne peut " +
          'pas être dite sans lien vers le fichier'
      });
      return;
    }
    reponse.corps.toString('utf8').split('\n').forEach(function (ligne, rang) {
      if (ligne.indexOf(chemin) !== -1) {
        ecarts.push({
          adresse: adresse,
          ecart: 'nomme ' + chemin + ', que le déploiement ne propose pas (ligne ' +
            (rang + 1) + ' : ' + ligne.trim().slice(0, 160) + ')'
        });
      }
    });
  });
  return ecarts;
}

// ── La moitié hors ligne : le contrôle contre des serveurs fabriqués ───────
//
// CHAQUE SERVEUR EST FAIT DE PAGES CONSTRUITES, pas de phrases écrites ici. Un
// contrôle éprouvé sur un badge recopié dans ce fichier dirait qu'il sait lire
// ce badge-là, et rien de celui que la page porte vraiment.
function serveurDepuis(repertoire) {
  var table = {};
  pagesConstruites(repertoire).forEach(function (relatif) {
    table[adresseDe(relatif)] = fs.readFileSync(path.join(repertoire, relatif));
  });
  return table;
}

function lecteur(table) {
  return function (adresse) {
    if (!Object.prototype.hasOwnProperty.call(table, adresse)) {
      return { status: 404, corps: Buffer.from('') };
    }
    return { status: 200, corps: table[adresse] };
  };
}

function exiger(nom, ecarts, attendues) {
  var nommees = ecarts
    .map(function (e) { return e.adresse; })
    .filter(function (a, rang, toutes) { return toutes.indexOf(a) === rang; })
    .sort();
  var voulues = attendues.slice().sort();
  if (nommees.join(' ') !== voulues.join(' ')) {
    echouer(nom + ' : devait nommer [' + voulues.join(', ') + '], nomme [' +
      nommees.join(', ') + ']' +
      ecarts.map(function (e) { return '\n    ' + e.adresse + ' ' + e.ecart; }).join(''));
  }
}

function eprouver(chemin) {
  var accueil = fs.readFileSync(path.join(racine, 'site/index.html'), 'utf8');
  var declaree = /data-verifie-sur="([0-9a-f]{64})"/.exec(accueil);
  if (!declaree) {
    echouer("l'accueil ne déclare pas `data-verifie-sur` : la construction " +
      'avec fichier ne peut pas être fabriquée');
    return;
  }
  var sans = construire({});
  // L'EMPREINTE EST CELLE QUE L'ACCUEIL DÉCLARE, pour la raison écrite dans
  // `langues-page-invitation.js` : une autre tomberait sur le garde-fou du
  // tableau des états, et la construction échouerait pour la raison d'un autre.
  var avec = construire({
    MESSAGR_APK_OCTETS: '139006945',
    MESSAGR_APK_SHA256: declaree[1],
    MESSAGR_APK_DATE: '2026-09-07'
  });
  try {
    if (!sans || !avec) {
      return;
    }
    var adresses = pagesConstruites(sans).map(adresseDe);
    if (pagesConstruites(avec).map(adresseDe).join(' ') !== adresses.join(' ')) {
      echouer("les constructions avec et sans fichier n'écrivent pas les mêmes pages");
    }
    var langues = Object.keys(JSON.parse(
      fs.readFileSync(path.join(racine, 'landing/copy.json'), 'utf8')
    ));
    // UN CONTRÔLE QUI NE LIT RIEN PASSE TOUJOURS. Moins de pages que les deux
    // que chaque langue engendre, et « aucune ne nomme le fichier » ne voudrait
    // rien dire.
    if (adresses.length < langues.length * 2) {
      echouer("la construction n'écrit que " + adresses.length + ' page(s)');
    }
    var serveurSans = serveurDepuis(sans);
    var serveurAvec = serveurDepuis(avec);

    // 1. Le site construit sans fichier : aucune page ne le nomme.
    exiger('site construit sans fichier',
      pagesQuiNomment(adresses, lecteur(serveurSans), chemin), []);

    // 2. Le site construit avec le fichier : l'accueil et la page du
    //    téléchargement, dans chaque langue, et elles seules. C'est ce cas qui
    //    dit que le contrôle voit le badge et le bouton tels qu'ils sont écrits.
    var offrantes = [];
    langues.forEach(function (langue) {
      var dossier = langue === 'fr' ? '/' : '/' + langue + '/';
      offrantes.push(dossier, dossier + 'telechargement/');
    });
    exiger('site construit avec fichier',
      pagesQuiNomment(adresses, lecteur(serveurAvec), chemin), offrantes);

    // 3. LE 13 SEPTEMBRE, EN PETIT : un site sans fichier dont une seule page
    //    est restée celle d'une construction qui le proposait. Celle-là, et
    //    aucune autre.
    var reste = Object.assign({}, serveurSans);
    reste['/de/'] = serveurAvec['/de/'];
    exiger("une page restée d'une construction avec fichier",
      pagesQuiNomment(adresses, lecteur(reste), chemin), ['/de/']);

    // 4. Une page que le serveur ne répond pas.
    var trouee = Object.assign({}, serveurSans);
    delete trouee['/confidentialite/'];
    exiger('une page absente du serveur',
      pagesQuiNomment(adresses, lecteur(trouee), chemin), ['/confidentialite/']);

    // 5. L'adresse absolue, dans les destinations de la page d'invitation.
    //    Fabriquée par un remplacement qui refuse de ne rien faire : un
    //    emplacement renommé laisserait la page intacte, et ce cas éprouverait
    //    un serveur sans défaut en croyant en éprouver un.
    var invitation = Object.assign({}, serveurSans);
    var fente = "androidApk: ''";
    var texteI = invitation['/i/'] ? invitation['/i/'].toString('utf8') : '';
    if (texteI.indexOf(fente) === -1) {
      echouer("cas fabriqué : la page d'invitation construite ne porte pas `" +
        fente + "`, donc ce cas n'éprouve rien");
    }
    invitation['/i/'] = Buffer.from(
      texteI.replace(fente, "androidApk: '" + DOMAINE + chemin + "'"), 'utf8'
    );
    exiger("l'adresse absolue dans la page d'invitation",
      pagesQuiNomment(adresses, lecteur(invitation), chemin), ['/i/']);

    if (!status) {
      console.log('telechargement: le contrôle tient ses cinq serveurs ' +
        'fabriqués sur les ' + adresses.length + ' pages construites');
    }
  } finally {
    [sans, avec].forEach(function (repertoire) {
      if (repertoire) {
        fs.rmSync(repertoire, { recursive: true, force: true });
      }
    });
  }
}

// ── La moitié en direct ────────────────────────────────────────────────────
//
// La requête de `conformite-site-deploye.js` : aucune redirection suivie, les
// octets bruts plutôt qu'une compression, https seulement.
function chercher(origine, adresse) {
  return new Promise(function (resoudre) {
    var base = new URL(origine);
    var requete = https.request(
      {
        protocol: base.protocol,
        hostname: base.hostname,
        port: base.port || undefined,
        path: adresse,
        method: 'GET',
        headers: { 'Accept-Encoding': 'identity', 'User-Agent': 'messagr-telechargement' },
        timeout: 30000
      },
      function (res) {
        var morceaux = [];
        res.on('data', function (m) {
          morceaux.push(m);
        });
        res.on('end', function () {
          resoudre({ status: res.statusCode, corps: Buffer.concat(morceaux) });
        });
      }
    );
    requete.on('error', function (e) {
      resoudre({ status: 0, corps: Buffer.from(''), erreur: e.message });
    });
    requete.on('timeout', function () {
      requete.destroy(new Error('délai dépassé'));
    });
    requete.end();
  });
}

async function enDirect(origine, chemin) {
  if (!/^https:\/\//.test(origine)) {
    echouer("l'origine « " + origine + " » n'est pas une adresse https");
    return;
  }
  var sortie = construire({});
  if (!sortie) {
    return;
  }
  try {
    var adresses = pagesConstruites(sortie).map(adresseDe);
    var table = {};
    for (var i = 0; i < adresses.length; i++) {
      table[adresses[i]] = await chercher(origine, adresses[i]);
    }
    var ecarts = pagesQuiNomment(adresses, function (adresse) {
      return table[adresse];
    }, chemin);
    ecarts.forEach(function (e) {
      echouer(origine + e.adresse + ' ' + e.ecart);
    });
    if (!ecarts.length) {
      console.log('telechargement: aucune des ' + adresses.length + ' pages que ' +
        'ce dépôt construit, telles que ' + origine + ' les sert, ne nomme ' + chemin);
    }
  } finally {
    fs.rmSync(sortie, { recursive: true, force: true });
  }
}

function argument(nom, defaut) {
  var ou = process.argv.indexOf(nom);
  if (ou === -1) {
    return defaut;
  }
  var suivant = process.argv[ou + 1];
  return suivant && suivant.indexOf('--') !== 0 ? suivant : defaut;
}

async function main() {
  var chemin = lireLeChemin();
  if (chemin) {
    if (process.argv.indexOf('--live') === -1) {
      eprouver(chemin);
    } else {
      await enDirect(argument('--live', DOMAINE), chemin);
    }
  }
  process.exit(status);
}

main();
