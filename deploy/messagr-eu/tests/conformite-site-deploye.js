// LE SERVEUR EST LA SEULE CHOSE QUE PERSONNE NE REGARDAIT.
//
// Le 7 septembre 2026, https://messagr.eu/ servait une page que `master` ne
// contenait pas : le correctif du sélecteur de langue était déployé et non
// fusionné. Choisir « Español » sur la page en ligne la changeait ; la choisir
// sur la page que `master` aurait construite ne faisait rien. Le prochain
// déploiement depuis `master` aurait donc remis le sélecteur cassé, et rien
// nulle part ne l'aurait dit.
//
// C'est la même classe de défaut que l'empreinte servie cinq jours durant avec
// une intégration continue verte : tout le dépôt se vérifiait lui-même, et
// personne ne demandait au serveur ce qu'il répondait.
//
// # Ce que ce contrôle compare, et ce qu'il ne compare pas
//
// Il compare le tréé CONSTRUIT vers le SERVI, fichier par fichier, et dans ce
// sens seulement. HTTP ne permet pas d'énumérer ce qu'un serveur détient : un
// fichier oublié là-haut et absent d'ici reste invisible, et le dire est plus
// honnête que de laisser croire le contraire. `identical-page-invitation.sh`
// tient l'autre moitié pour le répertoire qui en a besoin.
//
// # La seule différence tolérée, et pourquoi elle ne peut pas s'élargir
//
// Le déploiement substitue trois adresses de magasin dans la page
// d'invitation, et lui seul les connaît : `build-site.sh` reçoit
// `MESSAGR_DEST_IOS`, `MESSAGR_DEST_ANDROID` et `MESSAGR_DEST_ANDROID_APK` de
// l'opérateur. Une construction locale les laisse vides. Comparer octet pour
// octet ferait donc échouer un déploiement parfaitement conforme.
//
// La tolérance est écrite au plus étroit que la construction permet :
//
//   1. Elle ne vaut que pour `i/index.html`, le SEUL fichier dans lequel
//      `build-site.sh` substitue quoi que ce soit.
//   2. Elle ne vaut que pour les trois noms d'emplacement qu'il connaît.
//   3. Elle ne vaut que si la valeur servie est une adresse https simple,
//      c'est-à-dire exactement ce que `build-site.sh` accepte lui-même. Une
//      valeur qui s'échapperait du littéral JavaScript n'est pas tolérée : elle
//      est signalée comme n'importe quel autre écart, parce qu'un serveur qui
//      sert cela ne sert pas ce que le dépôt construit.
//
// # Pourquoi la moitié hors ligne existe
//
// Le tour de boucle de l'intégration continue lance chaque `.js` de ce
// répertoire SANS argument, et sans réseau. Un contrôle qui ne saurait que
// parler au serveur n'y serait donc jamais exercé, et le jour où il se
// tromperait, il se tromperait en silence. Sans argument, ce fichier construit
// le site puis éprouve son propre comparateur contre des serveurs fabriqués :
// un conforme, un qui a changé un octet, un qui substitue correctement, un qui
// substitue n'importe quoi, un à qui il manque un fichier, et un qui substitue
// dans une page où la construction ne substitue jamais. C'est cette dernière
// qui tient le « et rien d'autre ».
//
// # Usage
//
//   node conformite-site-deploye.js                    éprouve le comparateur
//   node conformite-site-deploye.js --live             contre messagr.eu
//   node conformite-site-deploye.js --live https://... contre un autre serveur
'use strict';

var fs = require('fs');
var os = require('os');
var path = require('path');
var child = require('child_process');
var https = require('https');
var http = require('http');
// Requis plutôt que pris dans les globales : la configuration ESLint de ce
// dépôt est celle de React Native, qui ne déclare pas `Buffer`. Le nommer ici
// coûte une ligne et évite une exception dans une configuration partagée.
var Buffer = require('buffer').Buffer;


var racine = path.join(__dirname, '..');
var construction = path.join(racine, 'build-site.sh');
var source = path.join(racine, 'site');

var status = 0;

function echouer(message) {
  console.error('conformite: FAIL: ' + message);
  status = 1;
}

// ── Le tréé construit, et son adressage ────────────────────────────────────
//
// Un `index.html` s'atteint par son répertoire avec la barre finale, parce que
// c'est ainsi que nginx le sert (`index index.html`). Tout le reste s'atteint
// par son chemin. Demander `/index.html` marcherait et mesurerait autre chose
// que ce qu'un lecteur reçoit.
function adresseDe(chemin) {
  var morceaux = chemin.split('/');
  if (morceaux[morceaux.length - 1] === 'index.html') {
    morceaux.pop();
    return '/' + (morceaux.length ? morceaux.join('/') + '/' : '');
  }
  return '/' + chemin;
}

function lister(repertoire, prefixe, sortie) {
  prefixe = prefixe || '';
  sortie = sortie || [];
  var entrees = fs.readdirSync(repertoire, { withFileTypes: true }).sort(function (a, b) {
    return a.name < b.name ? -1 : 1;
  });
  for (var i = 0; i < entrees.length; i++) {
    var e = entrees[i];
    var relatif = prefixe ? prefixe + '/' + e.name : e.name;
    if (e.isDirectory()) {
      lister(path.join(repertoire, e.name), relatif, sortie);
    } else {
      sortie.push({
        chemin: relatif,
        adresse: adresseDe(relatif),
        octets: fs.readFileSync(path.join(repertoire, e.name))
      });
    }
  }
  return sortie;
}

function construire(destinations) {
  var sortie = fs.mkdtempSync(path.join(os.tmpdir(), 'conformite-'));
  fs.rmSync(sortie, { recursive: true, force: true });
  var env = Object.assign({}, process.env, {
    MESSAGR_DEST_IOS: (destinations && destinations.ios) || '',
    MESSAGR_DEST_ANDROID: (destinations && destinations.android) || '',
    MESSAGR_DEST_ANDROID_APK: (destinations && destinations.androidApk) || ''
  });
  child.execFileSync(construction, [source, sortie], { env: env, stdio: 'pipe' });
  return sortie;
}

// ── Le comparateur ─────────────────────────────────────────────────────────
//
// `lire` est une fonction plutôt qu'un client HTTP, et c'est la couture qui
// rend tout ceci éprouvable sans réseau : hors ligne elle répond depuis une
// table, en direct elle interroge le serveur. Le comparateur ne sait pas
// laquelle des deux il tient.

// LA PAGE D'INVITATION, ET AUCUNE AUTRE. `build-site.sh` ne substitue que là.
var PAGE_SUBSTITUEE = 'i/index.html';
var EMPLACEMENTS = ['ios', 'android', 'androidApk'];
// L'adresse acceptable est celle de `build-site.sh`, recopiée d'un caractère à
// l'autre. Les deux doivent bouger ensemble : une tolérance plus large ici
// laisserait passer ce que la construction refuse d'écrire.
var ADRESSE_SIMPLE = /^https:\/\/[A-Za-z0-9._~:/?#@!$&()*+,;=%-]+$/;
var OUVERTURE = 'var DESTINATIONS = {';

// LA TOLÉRANCE NE VAUT QUE DANS L'OBJET DES DESTINATIONS, et ce resserrement
// est venu du contrôle lui-même. La première version cherchait `ios: '...'`
// dans toute la page : les six catalogues de traduction portent aussi une clé
// `ios` et une clé `android`, dont les valeurs sont des phrases
// (« Install Messagr for iPhone »). Une tolérance qui les couvrait aurait
// laissé un serveur réécrire dix phrases visibles sans que rien ne le dise.
//
// L'objet introuvable est un échec, pas un laissez-passer : c'est la règle que
// `build-site.sh` applique déjà à ses emplacements, pour la même raison. Un
// bloc renommé sous ce contrôle rendrait toute comparaison muette, et le
// déploiement continuerait d'avoir l'air parfait.
function neutraliserDestinations(texte, signaler) {
  var debut = texte.indexOf(OUVERTURE);
  var fin = debut === -1 ? -1 : texte.indexOf('};', debut);
  if (debut === -1 || fin === -1) {
    signaler(
      "l'objet `" +
        OUVERTURE +
        '` est introuvable dans la page : le bloc a été renommé, et plus rien ' +
        'ici ne sait ce que le déploiement a le droit de substituer'
    );
    return texte;
  }

  var bloc = texte.slice(debut, fin);
  for (var i = 0; i < EMPLACEMENTS.length; i++) {
    var nom = EMPLACEMENTS[i];
    var motif = new RegExp('(^|[^A-Za-z])' + nom + ": '([^']*)'", 'g');
    var vus = 0;
    bloc = bloc.replace(motif, function (entier, avant, valeur) {
      vus++;
      if (valeur !== '' && !ADRESSE_SIMPLE.test(valeur)) {
        signaler(nom + ' porte « ' + valeur + " », qui n'est pas une adresse https simple");
        return entier;
      }
      return avant + nom + ": ''";
    });
    if (vus !== 1) {
      signaler(
        "l'emplacement `" + nom + '` apparaît ' + vus + ' fois dans les destinations, une attendue'
      );
    }
  }
  return texte.slice(0, debut) + bloc + texte.slice(fin);
}

// L'ÉCART SE DIT AVEC UN OCTET ET DEUX EXTRAITS, pas avec « les fichiers
// diffèrent ». Celui qui lit ce message est en train de se demander si son
// déploiement a raté ou si quelqu'un a poussé à la main ; les trente octets de
// part et d'autre du premier désaccord répondent tout de suite.
function decrire(construit, servi) {
  var commun = Math.min(construit.length, servi.length);
  var i = 0;
  while (i < commun && construit[i] === servi[i]) {
    i++;
  }
  function extrait(octets) {
    return JSON.stringify(octets.slice(Math.max(0, i - 30), i + 30).toString('utf8'));
  }
  return (
    'le serveur sert ' +
    servi.length +
    ' octets, le dépôt en construit ' +
    construit.length +
    " ; premier écart à l'octet " +
    i +
    '\n      construit : ' +
    extrait(construit) +
    '\n      servi     : ' +
    extrait(servi)
  );
}

function comparer(construit, lire) {
  var ecarts = [];
  for (var i = 0; i < construit.length; i++) {
    var fichier = construit[i];
    var reponse = lire(fichier.adresse);

    if (!reponse || !reponse.status) {
      ecarts.push({
        adresse: fichier.adresse,
        quoi: 'injoignable : ' + ((reponse && reponse.erreur) || 'aucune réponse')
      });
      continue;
    }
    if (reponse.status !== 200) {
      ecarts.push({
        adresse: fichier.adresse,
        quoi: 'le serveur répond ' + reponse.status + ', et le dépôt construit ce fichier'
      });
      continue;
    }
    if (fichier.octets.equals(reponse.corps)) {
      continue;
    }

    // Pas identique. Reste la seule question qui vaille : est-ce que TOUT
    // l'écart tient dans ce que le déploiement a le droit de substituer ?
    if (fichier.chemin === PAGE_SUBSTITUEE) {
      var refus = [];
      var signaler = function (message) {
        if (refus.indexOf(message) === -1) {
          refus.push(message);
        }
      };
      var ici = neutraliserDestinations(fichier.octets.toString('utf8'), signaler);
      var la = neutraliserDestinations(reponse.corps.toString('utf8'), signaler);
      if (refus.length) {
        ecarts.push({ adresse: fichier.adresse, quoi: refus.join(' ; ') });
        continue;
      }
      if (ici === la) {
        continue;
      }
    }

    ecarts.push({ adresse: fichier.adresse, quoi: decrire(fichier.octets, reponse.corps) });
  }
  return ecarts;
}

// ── La moitié hors ligne : le comparateur contre des serveurs fabriqués ────

function serveurDepuis(table) {
  return function (adresse) {
    if (!Object.prototype.hasOwnProperty.call(table, adresse)) {
      return { status: 404, corps: Buffer.from('') };
    }
    return { status: 200, corps: table[adresse] };
  };
}

function tableConforme(construit) {
  var table = {};
  for (var i = 0; i < construit.length; i++) {
    table[construit[i].adresse] = construit[i].octets;
  }
  return table;
}

function attendre(nom, ecarts, combien, doitNommer) {
  if (ecarts.length !== combien) {
    echouer(
      nom +
        ' : ' +
        combien +
        ' écart(s) attendu(s), ' +
        ecarts.length +
        ' obtenu(s)' +
        (ecarts.length
          ? ' (' +
            ecarts
              .map(function (e) {
                return e.adresse + ' ' + e.quoi;
              })
              .join(' ; ') +
            ')'
          : '')
    );
    return;
  }
  if (!doitNommer) {
    return;
  }
  var nomme = ecarts.some(function (e) {
    return e.adresse === doitNommer;
  });
  if (!nomme) {
    echouer(
      nom +
        " : l'écart devait nommer " +
        doitNommer +
        ', il nomme ' +
        ecarts
          .map(function (e) {
            return e.adresse;
          })
          .join(', ')
    );
  }
}

function eprouverLeComparateur() {
  var sortie = construire(null);
  var construit = lister(sortie);

  if (construit.length < 5) {
    echouer('le tréé construit ne porte que ' + construit.length + ' fichier(s)');
  }
  var porteLaPage = construit.some(function (f) {
    return f.chemin === PAGE_SUBSTITUEE;
  });
  if (!porteLaPage) {
    echouer(
      'le tréé construit ne porte pas ' +
        PAGE_SUBSTITUEE +
        ", donc la tolérance de ce contrôle ne vise plus rien d'existant"
    );
  }

  // 1. Un serveur conforme.
  attendre('serveur conforme', comparer(construit, serveurDepuis(tableConforme(construit))), 0);

  // 2. Un octet changé dans la page d'accueil.
  var change = tableConforme(construit);
  change['/'] = Buffer.concat([change['/'], Buffer.from('<!-- ajouté -->')]);
  attendre('octet changé', comparer(construit, serveurDepuis(change)), 1, '/');

  // 3. Les trois destinations substituées, correctement.
  var substitue = tableConforme(construit);
  substitue['/i/'] = Buffer.from(
    substitue['/i/']
      .toString('utf8')
      .replace("ios: ''", "ios: 'https://apps.apple.com/app/id0000000000'")
      .replace("androidApk: ''", "androidApk: 'https://messagr.eu/messagr.apk'")
      .replace(
        "android: ''",
        "android: 'https://play.google.com/store/apps/details?id=eu.messagr'"
      ),
    'utf8'
  );
  attendre('destinations substituées', comparer(construit, serveurDepuis(substitue)), 0);

  // 4. Une destination qui n'est pas une adresse https simple. C'est le cas que
  //    `build-site.sh` refuse d'écrire ; un serveur qui le sert ne sert pas ce
  //    que le dépôt construit, et la tolérance ne doit pas l'absoudre.
  var evade = tableConforme(construit);
  evade['/i/'] = Buffer.from(
    evade['/i/'].toString('utf8').replace("ios: ''", "ios: 'x'; alert(1); var y='"),
    'utf8'
  );
  attendre('destination qui échappe au littéral', comparer(construit, serveurDepuis(evade)), 1, '/i/');

  // 5. Un fichier absent du serveur.
  var absent = tableConforme(construit);
  delete absent['/confidentialite/'];
  attendre('fichier absent', comparer(construit, serveurDepuis(absent)), 1, '/confidentialite/');

  // 6. LE « ET RIEN D'AUTRE », premier sens : une substitution dans une page où
  //    la construction ne substitue jamais est un écart, pas une tolérance.
  var ailleurs = tableConforme(construit);
  ailleurs['/'] = Buffer.from(
    ailleurs['/'].toString('utf8').replace('<main>', "<main><!-- ios: 'https://exemple.test' -->"),
    'utf8'
  );
  attendre('substitution hors de la page prévue', comparer(construit, serveurDepuis(ailleurs)), 1, '/');

  // 7. LE « ET RIEN D'AUTRE », second sens, et c'est celui que la première
  //    version de ce contrôle laissait passer : dans la BONNE page, mais hors
  //    de l'objet des destinations. Les catalogues de traduction portent une
  //    clé `ios` dont la valeur est une phrase affichée ; un serveur qui la
  //    réécrit change ce que dix lecteurs voient.
  var horsBloc = tableConforme(construit);
  horsBloc['/i/'] = Buffer.from(
    horsBloc['/i/'].toString('utf8').replace(
      "ios: 'Install Messagr for iPhone'",
      "ios: 'Install Messagr for iPhone, from somewhere else'"
    ),
    'utf8'
  );
  attendre(
    "substitution dans la page d'invitation mais hors des destinations",
    comparer(construit, serveurDepuis(horsBloc)),
    1,
    '/i/'
  );

  // 8. L'objet renommé sous ce contrôle. Sans ce cas, la tolérance
  //    deviendrait muette le jour où le bloc changerait de nom, et un
  //    déploiement quelconque passerait pour conforme.
  var renomme = tableConforme(construit);
  renomme['/i/'] = Buffer.from(
    renomme['/i/'].toString('utf8').replace(OUVERTURE, 'var ADRESSES = {'),
    'utf8'
  );
  attendre('objet des destinations renommé', comparer(construit, serveurDepuis(renomme)), 1, '/i/');

  fs.rmSync(sortie, { recursive: true, force: true });
}

// ── La moitié en direct ────────────────────────────────────────────────────

// LE RÉSEAU EST RÉCOLTÉ D'ABORD, LE COMPARATEUR RESTE SYNCHRONE. C'est ce qui
// permet aux huit cas ci-dessus de l'éprouver sans rien brancher : il ne sait
// pas s'il lit un serveur ou une table.
//
// Aucune redirection n'est suivie. Un 301 vers la même page est déjà une
// différence entre ce que le dépôt construit et ce que le serveur répond, et
// la suivre en silence est exactement le genre de complaisance qui a laissé
// vivre le défaut que ce fichier existe pour attraper.
function chercher(origine, adresse) {
  return new Promise(function (resoudre) {
    var base = new URL(origine);
    var transport = base.protocol === 'http:' ? http : https;
    var requete = transport.request(
      {
        protocol: base.protocol,
        hostname: base.hostname,
        port: base.port || undefined,
        path: adresse,
        method: 'GET',
        // Les octets bruts, sinon on comparerait une compression.
        headers: { 'Accept-Encoding': 'identity', 'User-Agent': 'messagr-conformite' },
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

async function recolter(origine, construit) {
  var table = {};
  for (var i = 0; i < construit.length; i++) {
    table[construit[i].adresse] = await chercher(origine, construit[i].adresse);
  }
  return function (adresse) {
    return table[adresse];
  };
}

async function main() {
  var vivant = process.argv.indexOf('--live');
  if (vivant === -1) {
    eprouverLeComparateur();
  } else {
    var origine = process.argv[vivant + 1] || 'https://messagr.eu';
    var sortie = construire(null);
    var construit = lister(sortie);
    var ecarts = comparer(construit, await recolter(origine, construit));
    for (var i = 0; i < ecarts.length; i++) {
      echouer(origine + ecarts[i].adresse + ' : ' + ecarts[i].quoi);
    }
    if (!ecarts.length) {
      console.log(
        'conformite: ' +
          origine +
          ' sert les ' +
          construit.length +
          ' fichiers que ce dépôt construit'
      );
    }
    fs.rmSync(sortie, { recursive: true, force: true });
  }
  if (!status) {
    console.log('conformite: OK');
  }
  process.exit(status);
}

main();
