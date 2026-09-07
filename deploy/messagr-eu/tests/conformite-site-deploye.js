// LE SERVEUR EST LA CHOSE QUE PRESQUE PERSONNE NE REGARDAIT.
//
// Le 7 septembre 2026, deux pages servies par messagr.eu ne correspondaient pas
// à ce que `master` construit, et les deux cas ne se ressemblent pas :
//
//   - LA PAGE D'ACCUEIL portait un correctif du sélecteur de langue que
//     `master` n'a pas (#137). Rien ne regardait celle-là : le prochain
//     déploiement depuis `master` aurait remis le sélecteur cassé, en silence.
//
//   - LA POLITIQUE DE CONFIDENTIALITÉ servie était celle d'avant #102, et
//     affirmait encore « il n'existe aucun tiers dans cette application »
//     alors que l'application embarque @react-native-firebase/messaging.
//     Quelque chose regardait celle-là : `scripts/assert-push-payload.sh`
//     imprime « AHEAD the repository page is not deployed yet » à chaque
//     exécution de l'intégration continue, et sort zéro. L'avertissement était
//     dans tous les journaux, et une page légale publiée a affirmé pendant des
//     jours ce que le dépôt avait déjà corrigé.
//
// Ce contrôle-ci tient tout l'arbre, pas quatre phrases d'une page, et il est
// contraignant partout où il tourne.
//
// # Ce qu'il compare, et ce qu'il ne compare pas
//
// Il compare l'arbre CONSTRUIT vers le SERVI, fichier par fichier, et dans ce
// sens seulement. HTTP ne permet pas d'énumérer ce qu'un serveur détient : un
// fichier oublié là-haut et absent d'ici reste invisible, et le dire est plus
// honnête que de laisser croire le contraire. `identical-page-invitation.sh`
// tient l'autre moitié pour le répertoire qui en a besoin.
//
// # La seule différence tolérée, et quand elle ne l'est plus
//
// Le déploiement substitue trois adresses de magasin dans la page
// d'invitation, et lui seul les connaît. Une construction locale les laisse
// vides, donc comparer octet pour octet ferait échouer un déploiement
// parfaitement conforme.
//
// La tolérance est écrite au plus étroit que la construction permet :
//
//   1. Elle ne vaut que pour `i/index.html`, le SEUL fichier dans lequel
//      `build-site.sh` substitue quoi que ce soit.
//   2. Elle ne vaut que dans l'objet `DESTINATIONS`, et pour ses trois noms.
//   3. Elle ne vaut que si la valeur servie satisfait la grammaire d'adresse
//      de `build-site.sh`, LUE DANS CE FICHIER et non recopiée ici.
//   4. ELLE DISPARAÎT dès que les destinations attendues sont connues. Quand
//      `MESSAGR_DEST_IOS` et ses deux sœurs sont dans l'environnement, comme
//      elles le sont pendant un déploiement, la construction les pose et la
//      comparaison redevient octet pour octet. Tolérer une adresse https
//      quelconque là où l'on sait laquelle on vient de poser reviendrait à
//      accepter le magasin de quelqu'un d'autre.
//
// # Pourquoi la moitié hors ligne existe
//
// Le tour de boucle de l'intégration continue lance chaque `.js` de ce
// répertoire SANS argument, et sans réseau. Un contrôle qui ne saurait que
// parler au serveur n'y serait jamais exercé, et le jour où il se tromperait,
// il se tromperait en silence. Sans argument, ce fichier construit le site puis
// éprouve son comparateur contre neuf serveurs fabriqués.
//
// C'est aussi la raison pour laquelle ce fichier ne prend pas d'argument de
// site comme ses voisins le font pour viser une COPIE : ses neuf serveurs sont
// déjà des copies contradictoires, fabriquées en mémoire. `--site` existe
// quand même, parce qu'il sert à autre chose : comparer un site local MODIFIÉ
// à la production, pour voir ce qu'un déploiement changerait.
//
// # Usage
//
//   node conformite-site-deploye.js                    éprouve le comparateur
//   node conformite-site-deploye.js --live             contre messagr.eu
//   node conformite-site-deploye.js --live https://... contre un autre serveur
//   node conformite-site-deploye.js --site <repertoire> --live ...
'use strict';

var fs = require('fs');
var os = require('os');
var path = require('path');
var child = require('child_process');
var https = require('https');
// Requis plutôt que pris dans les globales : la configuration ESLint de ce
// dépôt est celle de React Native, qui ne déclare pas `Buffer`. Le nommer ici
// coûte une ligne et évite une exception dans une configuration partagée.
var Buffer = require('buffer').Buffer;

var racine = path.join(__dirname, '..');
var construction = path.join(racine, 'build-site.sh');

var status = 0;

function echouer(message) {
  console.error('conformite: FAIL: ' + message);
  status = 1;
}

// ── La grammaire d'adresse, LUE et non recopiée ────────────────────────────
//
// `build-site.sh` refuse une destination qui n'est pas une adresse https
// simple, et la règle est écrite là-bas. La recopier ici en donnerait deux, et
// deux règles finissent par diverger sans que rien ne le dise : c'est
// exactement ce que `destinations-page-invitation.js` évite déjà en lisant
// `deploy.sh` et le vhost plutôt qu'en les paraphrasant.
//
// Introuvable, c'est un échec. Un contrôle qui se rabattrait sur une valeur par
// défaut continuerait de passer en mesurant autre chose.
function lireGrammaireDesAdresses() {
  var script = fs.readFileSync(construction, 'utf8');
  var trouve = /grep -Eq '(\^https:\/\/[^']*)'/.exec(script);
  if (!trouve) {
    echouer(
      "la grammaire d'adresse de build-site.sh est introuvable : ce contrôle ne " +
        'peut plus savoir ce que la construction accepte, et tolérerait ' +
        "n'importe quoi"
    );
    return null;
  }
  return new RegExp(trouve[1]);
}

// ── L'arbre construit, et son adressage ────────────────────────────────────
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

// Le répertoire de mktemp est passé tel quel : `build-site.sh` fait `mkdir -p`
// et écrit dedans. L'effacer d'abord rendrait à quelqu'un d'autre le nom que
// mktemp venait de réserver.
function construire(source, destinations) {
  var sortie = fs.mkdtempSync(path.join(os.tmpdir(), 'conformite-'));
  var env = Object.assign({}, process.env, {
    MESSAGR_DEST_IOS: destinations.ios || '',
    MESSAGR_DEST_ANDROID: destinations.android || '',
    MESSAGR_DEST_ANDROID_APK: destinations.androidApk || ''
  });
  try {
    child.execFileSync(construction, [source, sortie], { env: env, stdio: 'pipe' });
  } catch (e) {
    // Sans ceci, l'échec sort en exception brute : une trace de pile sans le
    // préfixe que tout ce répertoire imprime, dans un journal où personne ne
    // la relie à ce contrôle.
    fs.rmSync(sortie, { recursive: true, force: true });
    var dit = e.stderr ? e.stderr.toString() : e.message;
    echouer('build-site.sh a refusé de construire le site :\n' + dit.trim());
    return null;
  }
  return sortie;
}

// ── Le comparateur ─────────────────────────────────────────────────────────
//
// `lire` est une fonction plutôt qu'un client HTTP, et c'est la couture qui
// rend tout ceci éprouvable sans réseau : hors ligne elle répond depuis une
// table, en direct elle rend ce qui a été récolté. Le comparateur ne sait pas
// laquelle des deux il tient.

// LA PAGE D'INVITATION, ET AUCUNE AUTRE. `build-site.sh` ne substitue que là.
var PAGE_SUBSTITUEE = 'i/index.html';
var EMPLACEMENTS = ['ios', 'android', 'androidApk'];
var OUVERTURE = 'var DESTINATIONS = {';

// LA TOLÉRANCE NE VAUT QUE DANS L'OBJET DES DESTINATIONS, et ce resserrement
// est venu du contrôle lui-même. La première version cherchait `ios: '...'`
// dans toute la page : les six catalogues de traduction portent aussi une clé
// `ios` et une clé `android`, dont les valeurs sont des phrases affichées
// (« Install Messagr for iPhone »). Une tolérance qui les couvrait aurait
// laissé un serveur réécrire dix phrases visibles sans que rien ne le dise.
//
// L'objet introuvable est un échec, pas un laissez-passer : c'est la règle que
// `build-site.sh` applique déjà à ses emplacements, pour la même raison.
//
// La fin du bloc est cherchée au premier `};`. Un objet imbriqué le tronquerait
// — et le tronquerait vers le SÛR : un emplacement tombé hors de la zone
// compte zéro fois, `vus !== 1` le dit, et le contrôle échoue bruyamment. Il ne
// peut pas s'élargir de cette manière, seulement crier.
function neutraliserDestinations(texte, grammaire, signaler) {
  var debut = texte.indexOf(OUVERTURE);
  var fin = debut === -1 ? -1 : texte.indexOf('};', debut);
  if (debut === -1 || fin === -1) {
    signaler(
      "l'objet `" +
        OUVERTURE +
        '` est introuvable : le bloc a été renommé, et plus rien ici ne sait ce ' +
        'que le déploiement a le droit de substituer'
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
      if (valeur !== '' && !grammaire.test(valeur)) {
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

function comparer(construit, lire, grammaire, tolerer) {
  var ecarts = [];
  for (var i = 0; i < construit.length; i++) {
    var fichier = construit[i];
    var reponse = lire(fichier.adresse);

    if (!reponse || !reponse.status) {
      ecarts.push({
        adresse: fichier.adresse,
        ecart: 'injoignable : ' + ((reponse && reponse.erreur) || 'aucune réponse')
      });
      continue;
    }
    if (reponse.status !== 200) {
      ecarts.push({
        adresse: fichier.adresse,
        ecart: 'le serveur répond ' + reponse.status + ', et le dépôt construit ce fichier'
      });
      continue;
    }
    if (fichier.octets.equals(reponse.corps)) {
      continue;
    }

    // Pas identique. Reste la seule question qui vaille : est-ce que TOUT
    // l'écart tient dans ce que le déploiement a le droit de substituer ?
    if (tolerer && fichier.chemin === PAGE_SUBSTITUEE) {
      var refus = [];
      // Les deux côtés sont signalés séparément. Confondus, une construction
      // locale abîmée se lisait comme un défaut du serveur, et l'opérateur
      // serait allé chercher au mauvais endroit.
      var pour = function (cote) {
        return function (message) {
          var dit = cote + ' : ' + message;
          if (refus.indexOf(dit) === -1) {
            refus.push(dit);
          }
        };
      };
      var neutraliseConstruit = neutraliserDestinations(
        fichier.octets.toString('utf8'),
        grammaire,
        pour('construit')
      );
      var neutraliseServi = neutraliserDestinations(
        reponse.corps.toString('utf8'),
        grammaire,
        pour('servi')
      );
      if (refus.length) {
        ecarts.push({ adresse: fichier.adresse, ecart: refus.join(' ; ') });
        continue;
      }
      if (neutraliseConstruit === neutraliseServi) {
        continue;
      }
    }

    ecarts.push({ adresse: fichier.adresse, ecart: decrire(fichier.octets, reponse.corps) });
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

// FABRIQUER UN SERVEUR QUI DIT AUTRE CHOSE, ET VÉRIFIER QU'IL LE DIT.
//
// `String.replace` avec une chaîne ne remplace rien quand elle est absente, et
// rend l'original sans se plaindre. Un cas d'essai construit ainsi resterait
// CONFORME, le comparateur ne trouverait aucun écart, et l'assertion « aucun
// écart attendu » passerait au vert en ne mesurant rien. C'est mot pour mot le
// défaut fondateur de `build-site.sh` — « sed EXITS ZERO WHEN IT SUBSTITUTES
// NOTHING » — et il se serait réinstallé ici, dans le fichier écrit pour
// attraper ce genre de chose.
function servirAutrement(construit, adresse, avant, apres) {
  var table = tableConforme(construit);
  var texte = table[adresse].toString('utf8');
  if (texte.indexOf(avant) === -1) {
    echouer(
      'cas fabriqué : ' +
        adresse +
        ' ne contient pas « ' +
        avant +
        " », donc ce cas n'éprouve rien"
    );
  }
  table[adresse] = Buffer.from(texte.replace(avant, apres), 'utf8');
  return table;
}

function exiger(nom, ecarts, combien, doitNommer) {
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
                return e.adresse + ' ' + e.ecart;
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

var ADRESSES_DE_MAGASIN = {
  ios: 'https://apps.apple.com/app/id0000000000',
  android: 'https://play.google.com/store/apps/details?id=eu.messagr',
  androidApk: 'https://messagr.eu/messagr.apk'
};

function eprouverLeComparateur(source, grammaire) {
  var sortie = construire(source, {});
  if (!sortie) {
    return;
  }
  try {
    var construit = lister(sortie);
    var conforme = function (table) {
      return comparer(construit, serveurDepuis(table), grammaire, true);
    };

    if (construit.length < 5) {
      echouer("l'arbre construit ne porte que " + construit.length + ' fichier(s)');
    }
    var porteLaPage = construit.some(function (f) {
      return f.chemin === PAGE_SUBSTITUEE;
    });
    if (!porteLaPage) {
      echouer(
        "l'arbre construit ne porte pas " +
          PAGE_SUBSTITUEE +
          ", donc la tolérance de ce contrôle ne vise plus rien d'existant"
      );
    }

    // 1. Un serveur conforme.
    exiger('serveur conforme', conforme(tableConforme(construit)), 0);

    // 2. Un octet changé dans la page d'accueil.
    exiger(
      'octet changé',
      conforme(servirAutrement(construit, '/', '</main>', '<!-- ajouté --></main>')),
      1,
      '/'
    );

    // 3. Les trois destinations substituées, correctement. Les trois, et pas
    //    seulement la première : un emplacement laissé de côté ici serait un
    //    emplacement dont la tolérance n'est éprouvée nulle part.
    var troisPosees = tableConforme(construit);
    var texteI = troisPosees['/i/'].toString('utf8');
    for (var k = 0; k < EMPLACEMENTS.length; k++) {
      var slot = EMPLACEMENTS[k];
      var marque = slot + ": ''";
      if (texteI.indexOf(marque) === -1) {
        echouer('cas fabriqué : la page construite ne porte pas `' + marque + '`');
      }
      texteI = texteI.replace(marque, slot + ": '" + ADRESSES_DE_MAGASIN[slot] + "'");
    }
    troisPosees['/i/'] = Buffer.from(texteI, 'utf8');
    exiger('destinations substituées', conforme(troisPosees), 0);

    // 4. Une destination qui échappe au littéral JavaScript : ce que
    //    `build-site.sh` refuse d'écrire. Les trois emplacements, un par un.
    for (var j = 0; j < EMPLACEMENTS.length; j++) {
      var e = EMPLACEMENTS[j];
      exiger(
        'destination qui échappe au littéral (' + e + ')',
        conforme(servirAutrement(construit, '/i/', e + ": ''", e + ": 'x'; alert(1); var y='")),
        1,
        '/i/'
      );
    }

    // 5. Un fichier absent du serveur.
    var absent = tableConforme(construit);
    delete absent['/confidentialite/'];
    exiger('fichier absent', conforme(absent), 1, '/confidentialite/');

    // 6. LE « ET RIEN D'AUTRE », premier sens : une substitution dans une page
    //    où la construction ne substitue jamais est un écart.
    exiger(
      'substitution hors de la page prévue',
      conforme(servirAutrement(construit, '/', '<main>', "<main><!-- ios: 'https://exemple.test' -->")),
      1,
      '/'
    );

    // 7. LE « ET RIEN D'AUTRE », second sens, et c'est celui que la première
    //    version laissait passer : dans la BONNE page, mais hors de l'objet des
    //    destinations. Les catalogues portent une clé `ios` dont la valeur est
    //    une phrase affichée ; un serveur qui la réécrit change ce que dix
    //    lecteurs voient.
    exiger(
      "substitution dans la page d'invitation mais hors des destinations",
      conforme(
        servirAutrement(
          construit,
          '/i/',
          "ios: 'Install Messagr for iPhone'",
          "ios: 'Install Messagr for iPhone, from somewhere else'"
        )
      ),
      1,
      '/i/'
    );

    // 8. L'objet renommé sous ce contrôle. Sans ce cas, la tolérance
    //    deviendrait muette le jour où le bloc changerait de nom.
    exiger(
      'objet des destinations renommé',
      conforme(servirAutrement(construit, '/i/', OUVERTURE, 'var ADRESSES = {')),
      1,
      '/i/'
    );

    // 9. Un emplacement en double. C'est le garde `vus !== 1`, et sans ce cas
    //    il n'était atteint par aucun des huit autres : du code non éprouvé au
    //    milieu de la seule chose que ce fichier tolère.
    exiger(
      'emplacement en double',
      conforme(servirAutrement(construit, '/i/', "ios: ''", "ios: '', ios: ''")),
      1,
      '/i/'
    );

    // 10. La tolérance éteinte. Quand les destinations attendues sont connues,
    //     une adresse https quelconque n'est plus acceptable : c'est ce qui
    //     distingue « le déploiement a posé une adresse » de « le déploiement a
    //     posé CELLE qu'il venait de construire ».
    var quelconque = servirAutrement(
      construit,
      '/i/',
      "ios: ''",
      "ios: 'https://apps.apple.com/app/id9999999999'"
    );
    exiger(
      'tolérance éteinte, adresse https quelconque',
      comparer(construit, serveurDepuis(quelconque), grammaire, false),
      1,
      '/i/'
    );

    if (!status) {
      console.log(
        'conformite: le comparateur tient ses dix serveurs fabriqués sur ' +
          construit.length +
          ' fichiers construits'
      );
    }
  } finally {
    fs.rmSync(sortie, { recursive: true, force: true });
  }
}

// ── La moitié en direct ────────────────────────────────────────────────────
//
// Aucune redirection n'est suivie. Un 301 vers la même page est déjà une
// différence entre ce que le dépôt construit et ce que le serveur répond, et la
// suivre en silence est le genre de complaisance qui a laissé vivre le défaut
// que ce fichier existe pour attraper.
//
// https seulement : `build-site.sh` n'accepte pas d'autre schéma pour une
// destination, et un contrôle plus permissif que la construction mesurerait un
// site que le déploiement ne saurait pas produire.
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

// LES DESTINATIONS ATTENDUES VIENNENT DE L'ENVIRONNEMENT, comme elles viennent
// pour `build-site.sh`. `deploy.sh` les passe, donc la vérification qui suit un
// déploiement exige les adresses exactes ; un lancement à la main depuis un
// portable n'en passe aucune et retombe sur la tolérance.
function destinationsAttendues() {
  return {
    ios: process.env.MESSAGR_DEST_IOS || '',
    android: process.env.MESSAGR_DEST_ANDROID || '',
    androidApk: process.env.MESSAGR_DEST_ANDROID_APK || ''
  };
}

async function enDirect(source, grammaire, origine) {
  if (!/^https:\/\//.test(origine)) {
    echouer(
      'l\'origine « ' + origine + ' » n\'est pas une adresse https : ' +
        "build-site.sh n'accepte pas d'autre schéma, et ce contrôle non plus"
    );
    return;
  }

  var attendues = destinationsAttendues();
  var connues = EMPLACEMENTS.some(function (nom) {
    return attendues[nom] !== '';
  });

  var sortie = construire(source, attendues);
  if (!sortie) {
    return;
  }
  try {
    var construit = lister(sortie);
    var ecarts = comparer(construit, await recolter(origine, construit), grammaire, !connues);
    for (var i = 0; i < ecarts.length; i++) {
      echouer(origine + ecarts[i].adresse + ' : ' + ecarts[i].ecart);
    }
    if (!ecarts.length) {
      console.log(
        'conformite: ' +
          origine +
          ' sert les ' +
          construit.length +
          ' fichiers que ce dépôt construit' +
          (connues ? ', destinations comprises' : '')
      );
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
  var grammaire = lireGrammaireDesAdresses();
  if (!grammaire) {
    process.exit(status);
  }
  var source = argument('--site', path.join(racine, 'site'));

  if (process.argv.indexOf('--live') === -1) {
    eprouverLeComparateur(source, grammaire);
  } else {
    await enDirect(source, grammaire, argument('--live', 'https://messagr.eu'));
  }

  if (!status) {
    console.log('conformite: OK');
  }
  process.exit(status);
}

main();
