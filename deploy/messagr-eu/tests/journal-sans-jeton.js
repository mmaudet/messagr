// UN JETON D'INVITATION NE DOIT NI ENTRER DANS UN JOURNAL, NI Y RESTER.
//
// Le lien d'invitation porte son jeton dans le chemin,
// `https://messagr.eu/i/<jeton>`, et ce jeton est un secret porteur : tant
// que l'invitation n'est ni réclamée ni expirée, il fait entrer. Jusqu'au
// 15 septembre 2026 nginx écrivait ce chemin entier dans son journal d'accès,
// que `logrotate` garde 366 jours (#313).
//
// La correction tient en deux moitiés, et ce contrôle tient les deux :
//
//   1. LE VHOST N'ÉCRIT PLUS LE JETON. Un `map` sur `$request_uri` et un
//      `log_format` dédié, posés sur `location /i/` et `location = /i`.
//   2. LA PURGE RETIRE CE QUI EST DÉJÀ ÉCRIT, sans perdre une seule ligne :
//      les données de connexion se conservent douze mois, et
//      `retention.json` le déclare. C'est le jeton qui part, pas la ligne.
//
// CE QUE CE FICHIER NE PEUT PAS FAIRE : démarrer nginx. Il lit la
// configuration, pas son effet. La vérification par `nginx -t` puis par un
// vrai serveur est décrite dans la demande de fusion de #313 ; ici on tient
// la forme, qui est ce qui se perd au prochain `location` ajouté.
'use strict';

var child = require('child_process');
var fs = require('fs');
var os = require('os');
var path = require('path');
var zlib = require('zlib');

var RACINE = path.join(__dirname, '..');
var VHOST = path.join(RACINE, 'nginx-messagr-eu.conf');
var PURGE = path.join(RACINE, 'purge-jetons-journaux.sh');
var FORMAT = 'messagr_sans_jeton';
var VARIABLE = '$messagr_chemin_sans_jeton';
var SANS_JETON = '/i/...';

var status = 0;

function echouer(message) {
  console.error('journal: FAIL: ' + message);
  status = 1;
}

function verifier(condition, message) {
  if (!condition) {
    echouer(message);
  }
}

// ═══ 1. LE VHOST ═══════════════════════════════════════════════════════════

var vhost = fs.readFileSync(VHOST, 'utf8');

// Le `map` et le `log_format` vivent dans le contexte `http`, donc HORS de
// tout `server`. Posés par erreur dans un `server`, nginx refuse de démarrer.
var avantLePremierServeur = vhost.split(/^server \{/m)[0];

verifier(
  /^map \$request_uri \$messagr_chemin_sans_jeton \{/m.test(avantLePremierServeur),
  'le vhost ne porte pas de `map $request_uri ' +
    VARIABLE +
    '` avant son premier bloc `server`'
);

var blocMap = /^map \$request_uri \$messagr_chemin_sans_jeton \{([^}]*)\}/m.exec(vhost);
if (!blocMap) {
  echouer('le `map` du chemin sans jeton est introuvable');
} else {
  var corps = blocMap[1];

  // Tout ce qui n'est pas une invitation garde son chemin entier. Sans cette
  // ligne, le `map` rendrait la chaîne vide pour le reste du site et le
  // journal perdrait tous ses chemins d'un coup.
  verifier(
    /^\s*default\s+\$request_uri;/m.test(corps),
    'le `map` ne rend pas `$request_uri` par défaut : le reste du site ' +
      'perdrait son chemin dans le journal'
  );

  verifier(
    corps.indexOf('"' + SANS_JETON + '"') !== -1,
    'le `map` ne remplace pas le chemin par "' + SANS_JETON + '"'
  );

  // TROIS POINTS ASCII, PAS `…`. nginx échappe dans le journal tout octet
  // au-dessus de 0x7E que porte une VARIABLE : le caractère de suspension y
  // arriverait écrit `\xE2\x80\xA6`. Le seul moyen de le garder lisible
  // serait `escape=none`, qui cesserait aussi d'échapper l'agent utilisateur
  // -- du texte que l'appelant choisit, et par lequel il écrirait alors des
  // retours à la ligne dans le journal.
  var valeurs = corps.match(/"[^"]*"\s*;/g) || [];
  valeurs.forEach(function (valeur) {
    for (var i = 0; i < valeur.length; i += 1) {
      if (valeur.charCodeAt(i) > 0x7e) {
        echouer(
          'le `map` rend une valeur qui porte un octet au-dessus de 0x7E (' +
            JSON.stringify(valeur) +
            '). nginx l\'échapperait en `\\xHH` dans le journal, et le ' +
            'rendre lisible demanderait `escape=none`, qui cesserait aussi ' +
            "d'échapper l'agent utilisateur."
        );
        return;
      }
    }
  });

  // Les trois formes que peut prendre un lien d'invitation, et rien d'autre.
  // La règle est lue telle qu'elle est écrite plutôt que reproduite ici : ce
  // qui compte est qu'elle exige un `/`, un `?` ou la fin après `/i`, sans
  // quoi `/index.html` et `/images/` perdraient aussi leur chemin.
  verifier(
    /~\^\/i\(\/\|\\\?\|\$\)/.test(corps),
    'la règle du `map` ne vaut pas exactement pour `/i/`, `/i?` et `/i` nu. ' +
      'Trop large, elle mangerait le chemin de `/index.html` et de ' +
      '`/images/` ; trop étroite, elle laisserait passer un jeton.'
  );
}

var blocFormat = /^log_format messagr_sans_jeton\b([\s\S]*?);/m.exec(avantLePremierServeur);
if (!blocFormat) {
  echouer('le vhost ne déclare pas `log_format ' + FORMAT + '` au niveau http');
} else {
  var format = blocFormat[1];

  verifier(
    format.indexOf(VARIABLE) !== -1,
    'le `log_format ' + FORMAT + '` n\'écrit pas ' + VARIABLE
  );

  // `$request` EST LA LIGNE DE REQUÊTE ENTIÈRE, jeton compris. Un format qui
  // la garde ne corrige rien, et c'est exactement la variable qu'on remet
  // sans y penser en recopiant `combined`.
  verifier(
    !/\$request\b/.test(format),
    'le `log_format ' + FORMAT + '` écrit `$request`, qui porte le chemin ' +
      'entier et donc le jeton'
  );
  verifier(
    !/\$request_uri\b/.test(format),
    'le `log_format ' + FORMAT + '` écrit `$request_uri`, qui porte le jeton'
  );
  verifier(
    !/\$http_referer\b/.test(format),
    'le `log_format ' + FORMAT + '` écrit `$http_referer` : une page ' +
      "atteinte depuis `/i/<jeton>` y mettrait le jeton, et `Referrer-Policy` " +
      "est une politique que le navigateur applique, pas une garantie du serveur"
  );

  // Ce qui reste écrit, et que `retention.json` déclare pour douze mois.
  ['$remote_addr', '$time_local', '$status', '$body_bytes_sent', '$http_user_agent'].forEach(
    function (variable) {
      verifier(
        format.indexOf(variable) !== -1,
        'le `log_format ' +
          FORMAT +
          "` n'écrit pas " +
          variable +
          ' : la ligne doit garder la date, l\'adresse IP, le statut, la ' +
          "taille et l'agent. C'est le jeton qui disparaît, pas la ligne."
      );
    }
  );
}

// Les deux `location` qui servent une invitation, et les deux seulement.
var lignes = vhost.split('\n');
var courant = null;
var blocs = [];
lignes.forEach(function (ligne) {
  var ouvre = /^ {4}location (.+) \{/.exec(ligne);
  if (ouvre) {
    courant = { nom: ouvre[1], corps: [] };
    return;
  }
  if (courant && /^ {4}\}/.test(ligne)) {
    blocs.push(courant);
    courant = null;
    return;
  }
  if (courant) {
    courant.corps.push(ligne);
  }
});

['/i/', '= /i'].forEach(function (nom) {
  var trouves = blocs.filter(function (bloc) {
    return bloc.nom === nom;
  });
  if (trouves.length !== 1) {
    echouer('le vhost porte ' + trouves.length + ' bloc(s) `location ' + nom + '`, un attendu');
    return;
  }
  var corpsDuBloc = trouves[0].corps.join('\n');
  verifier(
    new RegExp('^\\s*access_log\\s+\\S+\\s+' + FORMAT + ';', 'm').test(corpsDuBloc),
    'le bloc `location ' +
      nom +
      "` ne déclare pas `access_log ... " +
      FORMAT +
      ';`. Sans lui il hérite du journal par défaut, qui écrit le chemin ' +
      'entier — donc le jeton.'
  );
});

// ═══ 2. LA PURGE ═══════════════════════════════════════════════════════════

// Des jetons factices, assez distinctifs pour qu'un `indexOf` sur l'arbre
// entier prouve qu'il n'en reste rien.
var JETONS = [
  'JETONUNfaux111111',
  'JETONDEUXfaux22222',
  'JETONTROISfaux3333',
  'JETONCINQfaux55555',
  'JETONSIXfaux666666',
  'ARCHIVEUNfaux11111',
  'ARCHIVEGZfaux222222',
  'ARCHIVEGZREFfaux33',
];

// Celui-ci N'EST PAS un jeton : il est dans l'agent utilisateur, qui est du
// texte que l'appelant choisit. Le purger reviendrait à réécrire une donnée
// qui n'est pas un secret, et à prouver qu'on remplace au hasard dans la
// ligne au lieu de viser le champ requête.
var JETON_DANS_LAGENT = 'JETONQUATREfaux444';

var COURANT = [
  '203.0.113.7 - - [14/Sep/2026:10:11:12 +0000] "GET /i/JETONUNfaux111111 HTTP/2.0" 200 4321 "-" "Mozilla/5.0 (iPhone)"',
  '203.0.113.8 - - [14/Sep/2026:10:11:13 +0000] "GET / HTTP/2.0" 200 38 "-" "curl/8.7.1"',
  '203.0.113.9 - - [14/Sep/2026:10:11:14 +0000] "GET /i/JETONDEUXfaux22222?x=1 HTTP/1.1" 200 4321 "https://messagr.eu/i/JETONTROISfaux3333" "Mozilla/5.0 (Android 16)"',
  '203.0.113.10 - - [14/Sep/2026:10:11:15 +0000] "GET /index.html HTTP/1.1" 200 38 "-" "un agent qui parle de /i/' +
    JETON_DANS_LAGENT +
    ' sans etre une requete"',
  '203.0.113.11 - - [14/Sep/2026:10:11:16 +0000] "GET /i HTTP/1.1" 200 41 "-" "curl/8.7.1"',
  '203.0.113.12 - - [14/Sep/2026:10:11:17 +0000] "GET /i?t=JETONCINQfaux55555 HTTP/1.1" 200 41 "-" "curl/8.7.1"',
  '203.0.113.13 - - [14/Sep/2026:10:11:18 +0000] "GET /i18n.txt HTTP/1.1" 200 2 "-" "curl/8.7.1"',
  '203.0.113.14 - - [14/Sep/2026:10:11:19 +0000] "POST /i/JETONSIXfaux666666 HTTP/1.1" 405 157 "-" "curl/8.7.1"',
  '203.0.113.15 - - [14/Sep/2026:10:11:20 +0000] "-" 400 0 "-" "-"',
].join('\n') + '\n';

var ARCHIVE = [
  '198.51.100.1 - - [13/Sep/2026:09:00:00 +0000] "GET /i/ARCHIVEUNfaux11111 HTTP/2.0" 200 4321 "-" "Mozilla/5.0"',
  '198.51.100.2 - - [13/Sep/2026:09:00:01 +0000] "GET /images/logo.png HTTP/2.0" 200 900 "-" "Mozilla/5.0"',
].join('\n') + '\n';

var ARCHIVE_GZ = [
  '198.51.100.3 - - [12/Sep/2026:08:00:00 +0000] "GET /i/ARCHIVEGZfaux222222 HTTP/2.0" 200 4321 "https://messagr.eu/i/ARCHIVEGZREFfaux33" "Mozilla/5.0"',
  '198.51.100.4 - - [12/Sep/2026:08:00:01 +0000] "GET /confidentialite HTTP/2.0" 200 9000 "-" "Mozilla/5.0"',
].join('\n') + '\n';

// `error.log` n'a pas la forme d'un journal d'accès : la purge n'y écrit pas,
// et sa présence vérifie qu'elle ne l'abîme pas non plus.
var ERREURS =
  '2026/09/14 10:11:12 [error] 12#12: *3 open() "/var/www/messagr-eu-site/absent"' +
  ' failed (2: No such file or directory), client: 203.0.113.9, server: messagr.eu,' +
  ' request: "GET /absent HTTP/2.0", host: "messagr.eu"\n';

function fabriquer() {
  var dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'journal-sans-jeton-'));
  fs.writeFileSync(path.join(dossier, 'access.log'), COURANT);
  fs.writeFileSync(path.join(dossier, 'access.log.1'), ARCHIVE);
  fs.writeFileSync(path.join(dossier, 'access.log.2.gz'), zlib.gzipSync(ARCHIVE_GZ));
  fs.writeFileSync(path.join(dossier, 'error.log'), ERREURS);
  return dossier;
}

function lire(dossier, nom) {
  var complet = path.join(dossier, nom);
  var octets = fs.readFileSync(complet);
  if (/\.gz$/.test(nom)) {
    return zlib.gunzipSync(octets).toString('utf8');
  }
  return octets.toString('utf8');
}

function empreinte(dossier) {
  return fs
    .readdirSync(dossier)
    .sort()
    .map(function (nom) {
      return nom + ':' + fs.readFileSync(path.join(dossier, nom)).toString('base64');
    })
    .join('\n');
}

function purger(cible, options) {
  var args = (options && options.args) || [];
  var cheminVhost = (options && options.vhost) || VHOST;
  return child.spawnSync('sh', [PURGE].concat(args, [cible]), {
    encoding: 'utf8',
    env: Object.assign({}, process.env, { MESSAGR_VHOST: cheminVhost }),
  });
}

function compterLignes(texte) {
  if (texte === '') {
    return 0;
  }
  return texte.replace(/\n$/, '').split('\n').length;
}

// ── a. La purge retire les jetons, et ne perd pas une ligne ───────────────

var dossier = fabriquer();
var inodeAvant = fs.statSync(path.join(dossier, 'access.log')).ino;
var resultat = purger(dossier);

if (resultat.status !== 0) {
  echouer('la purge a échoué (code ' + resultat.status + ') :\n' + resultat.stderr);
} else {
  [
    ['access.log', COURANT],
    ['access.log.1', ARCHIVE],
    ['access.log.2.gz', ARCHIVE_GZ],
    ['error.log', ERREURS],
  ].forEach(function (paire) {
    var nom = paire[0];
    var avant = paire[1];
    var apres = lire(dossier, nom);
    verifier(
      compterLignes(avant) === compterLignes(apres),
      nom +
        ' : ' +
        compterLignes(avant) +
        ' ligne(s) avant, ' +
        compterLignes(apres) +
        ' après. Une ligne de journal de connexion se conserve douze mois : ' +
        "la purge réécrit le chemin, elle ne supprime pas l'entrée."
    );
  });

  // Plus un seul jeton, nulle part, dans aucun fichier du dossier.
  fs.readdirSync(dossier).forEach(function (nom) {
    var contenu = lire(dossier, nom);
    JETONS.forEach(function (jeton) {
      verifier(contenu.indexOf(jeton) === -1, nom + ' porte encore le jeton ' + jeton);
    });
  });

  // L'agent utilisateur est intact : la purge vise le champ requête et le
  // champ référent, pas la ligne entière.
  var courantApres = lire(dossier, 'access.log');
  verifier(
    courantApres.indexOf(JETON_DANS_LAGENT) !== -1,
    "la purge a réécrit l'agent utilisateur. Elle ne doit toucher que le " +
      'champ requête et le champ référent : une substitution globale abîme ' +
      "du texte que l'appelant a choisi, et dit qu'elle remplace au hasard."
  );

  // Ce qui n'est pas une invitation garde son chemin entier.
  ['GET / HTTP/2.0', 'GET /index.html HTTP/1.1', 'GET /i18n.txt HTTP/1.1', '"-" 400 0'].forEach(
    function (extrait) {
      verifier(
        courantApres.indexOf(extrait) !== -1,
        'la purge a modifié une ligne qui ne portait pas de jeton : ' + extrait
      );
    }
  );
  verifier(
    lire(dossier, 'access.log.1').indexOf('GET /images/logo.png HTTP/2.0') !== -1,
    'la purge a modifié `/images/logo.png`, qui commence par `/i` sans être ' +
      'une invitation'
  );

  // Les cinq formes d'invitation sont devenues le même chemin.
  verifier(
    (courantApres.match(/"(GET|POST) \/i\/\.\.\. HTTP/g) || []).length === 5,
    'les cinq requêtes d\'invitation ne se lisent pas toutes `' +
      SANS_JETON +
      '` : ' +
      JSON.stringify(courantApres.match(/"(GET|POST) [^ ]+ HTTP/g))
  );
  verifier(
    courantApres.indexOf('"https://messagr.eu/i/..."') !== -1,
    'le référent qui portait un jeton ne se lit pas `https://messagr.eu' +
      SANS_JETON +
      '`'
  );

  // `access.log` est ouvert par nginx, qui écrit par descripteur. Le
  // remplacer par `mv` lui laisserait un descripteur sur un fichier délié :
  // il écrirait dans un fichier que plus rien ne nomme, et que rien ne ferait
  // jamais tourner.
  verifier(
    fs.statSync(path.join(dossier, 'access.log')).ino === inodeAvant,
    "le fichier courant a changé d'inode. nginx le tient ouvert : il " +
      "continuerait d'écrire dans le fichier délié, invisible et jamais tourné."
  );

  // Le `.gz` est toujours un `.gz`, et logrotate compte dessus.
  try {
    zlib.gunzipSync(fs.readFileSync(path.join(dossier, 'access.log.2.gz')));
  } catch (erreur) {
    echouer('`access.log.2.gz` ne se décompresse plus : ' + erreur.message);
  }

  // Le rapport ne cite jamais un jeton : il compte des lignes. L'écrire dans
  // un terminal le mettrait dans un endroit de plus.
  JETONS.concat(JETON_DANS_LAGENT).forEach(function (jeton) {
    verifier(
      (resultat.stdout + resultat.stderr).indexOf(jeton) === -1,
      'la purge a écrit le jeton ' + jeton + ' sur sa sortie'
    );
  });

  // ── b. Idempotente ──────────────────────────────────────────────────────
  var avantSecondPassage = empreinte(dossier);
  var second = purger(dossier);
  verifier(second.status === 0, 'le second passage a échoué :\n' + second.stderr);
  verifier(
    empreinte(dossier) === avantSecondPassage,
    'le second passage a modifié les journaux. Une ligne déjà purgée porte ' +
      '`' +
      SANS_JETON +
      '` et doit être reconstruite à l\'identique.'
  );
}

fs.rmSync(dossier, { recursive: true, force: true });

// ── c. `--dry-run` n'écrit rien ───────────────────────────────────────────

var dossierSec = fabriquer();
var avantSec = empreinte(dossierSec);
var sec = purger(dossierSec, { args: ['--dry-run'] });
verifier(sec.status === 0, '`--dry-run` a échoué :\n' + sec.stderr);
verifier(empreinte(dossierSec) === avantSec, '`--dry-run` a modifié les journaux');
verifier(
  /à purger/.test(sec.stdout),
  '`--dry-run` ne dit pas combien de lignes seraient purgées'
);
fs.rmSync(dossierSec, { recursive: true, force: true });

// ── d. La garde d'ordre : le vhost d'abord, la purge ensuite ──────────────
//
// Purger avant que le vhost sans jeton soit déployé nettoierait un fichier
// que nginx continue de remplir de jetons. Le script tient cet ordre plutôt
// que de le rappeler dans un commentaire.

var dossierGarde = fabriquer();
var avantGarde = empreinte(dossierGarde);
var faux = path.join(os.tmpdir(), 'vhost-sans-le-format-' + process.pid + '.conf');
fs.writeFileSync(faux, 'server { listen 80; }\n');
var garde = purger(dossierGarde, { vhost: faux });
verifier(
  garde.status !== 0,
  'la purge a accepté de tourner avec un vhost qui ne porte pas `' +
    FORMAT +
    '` : elle nettoierait un fichier que nginx remplit encore'
);
verifier(
  empreinte(dossierGarde) === avantGarde,
  'la purge a écrit alors que sa garde refusait de tourner'
);

// `--dry-run` ne demande pas cette garde : il ne sert qu'à mesurer, et
// mesurer avant de déployer est exactement ce qu'on veut pouvoir faire.
var mesure = purger(dossierGarde, { args: ['--dry-run'], vhost: faux });
verifier(
  mesure.status === 0,
  "`--dry-run` exige la garde alors qu'il n'écrit rien : il doit pouvoir " +
    'mesurer AVANT le déploiement du vhost'
);
fs.unlinkSync(faux);
fs.rmSync(dossierGarde, { recursive: true, force: true });

if (status === 0) {
  console.log(
    'journal: le vhost écrit `' +
      SANS_JETON +
      '` à la place du chemin sur les deux blocs `/i`, et la purge retire ' +
      JETONS.length +
      ' jetons de trois journaux sans perdre une ligne, deux fois de suite'
  );
}
process.exit(status);
