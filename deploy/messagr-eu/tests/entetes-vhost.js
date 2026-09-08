// `add_header` NE DESCEND PAS TOUJOURS, ET C'EST UN PIÈGE À EN-TÊTES.
//
// nginx hérite les `add_header` du niveau supérieur UNIQUEMENT si le niveau
// courant n'en déclare aucun. Six `location` du vhost portent déjà un
// `Cache-Control` propre : posés seulement au niveau du serveur, les en-têtes
// de sécurité ne s'appliqueraient pas là où ils comptent le plus, la page
// d'invitation, l'APK et les déclarations d'app-links.
//
// La réponse est de les répéter, et la répétition est exactement le genre de
// discipline qui se perd au prochain `location` ajouté. Ce contrôle en fait
// une propriété : tout bloc qui déclare un `add_header` déclare aussi les
// trois en-têtes de sécurité, sinon la construction s'arrête.
//
// CE QU'IL NE DEMANDE PAS. La politique de contenu n'est exigée qu'au niveau
// du serveur. La page d'invitation en porte une dans son balisage, plus
// stricte, éprouvée à chaque construction par `doctrine-page-invitation.sh` :
// deux politiques s'appliquent par intersection, et la sienne doit rester la
// seule chose à lire pour savoir ce qu'elle s'autorise.
'use strict';

var fs = require('fs');
var path = require('path');

var chemin = process.argv[2] || path.join(__dirname, '..', 'nginx-messagr-eu.conf');
var vhost = fs.readFileSync(chemin, 'utf8');
var status = 0;

function echouer(message) {
  console.error('entetes: FAIL: ' + message);
  status = 1;
}

var TROIS = [
  'Strict-Transport-Security',
  'X-Content-Type-Options',
  'Referrer-Policy'
];

// ── Le serveur TLS porte les quatre ───────────────────────────────────────
var blocs = vhost.split(/^server \{/m).slice(1);
var tls = blocs.filter(function (b) {
  return /listen\s+443/.test(b);
});
if (tls.length !== 1) {
  echouer('le vhost porte ' + tls.length + ' serveur(s) TLS, un attendu');
} else {
  TROIS.concat('Content-Security-Policy').forEach(function (nom) {
    if (tls[0].indexOf('add_header ' + nom) === -1) {
      echouer('le serveur TLS ne pose pas ' + nom);
    }
  });
  // HTTP/2 se déclare sur `listen` jusqu'à nginx 1.25 ; hermes est en 1.24.
  if (!/listen\s+443\s+ssl\s+http2;/.test(tls[0])) {
    echouer("le serveur TLS ne répond pas en HTTP/2 (`listen 443 ssl http2;`)");
  }
  // `includeSubDomains` engagerait tout sous-domaine pour un an, y compris
  // ceux qui n'existent pas encore. L'absence est une décision, donc elle est
  // tenue ici plutôt que laissée au prochain qui passera.
  if (/Strict-Transport-Security[^;]*includeSubDomains/.test(tls[0])) {
    echouer(
      'HSTS porte includeSubDomains : il engage tout sous-domaine de ' +
        "messagr.eu pour un an, et l'erreur est irréversible côté navigateur"
    );
  }
}

// ── Tout `location` qui déclare un add_header déclare aussi les trois ─────
var lignes = vhost.split('\n');
var courant = null;
var vus = [];
lignes.forEach(function (l) {
  var ouvre = /^ {4}location (.+) \{/.exec(l);
  if (ouvre) {
    courant = { nom: ouvre[1], entetes: [] };
    return;
  }
  if (courant && /^ {4}\}/.test(l)) {
    vus.push(courant);
    courant = null;
    return;
  }
  if (courant) {
    var e = /add_header\s+([A-Za-z-]+)/.exec(l);
    if (e) {
      courant.entetes.push(e[1]);
    }
  }
});

// LE BLOC RACINE POSE AUSSI UN `Cache-Control`, et il le doit : les noms de
// fichiers ne portent aucune empreinte, donc une image redéployée garde son
// adresse. Sans revalidation, un lecteur verrait l'ancienne.
var racine = vus.filter(function (b) {
  return b.nom === '/';
});
if (racine.length === 0) {
  echouer('aucun bloc `location /` trouvé');
} else if (racine[racine.length - 1].entetes.indexOf('Cache-Control') === -1) {
  echouer('le bloc `location /` ne pose pas de Cache-Control');
}

if (vus.length < 8) {
  echouer('seulement ' + vus.length + ' blocs location lus, le vhost en porte plus');
}

var tenus = 0;
vus.forEach(function (b) {
  if (b.entetes.length === 0) {
    // Aucun add_header : le bloc hérite de ceux du serveur, et c'est correct.
    return;
  }
  tenus += 1;
  TROIS.forEach(function (nom) {
    if (b.entetes.indexOf(nom) === -1) {
      echouer(
        'le bloc `location ' +
          b.nom +
          '` déclare ses propres add_header, donc il' +
          " n'hérite d'aucun de ceux du serveur, et il ne pose pas " +
          nom
      );
    }
  });
});

if (status === 0) {
  console.log(
    'entetes: le serveur TLS pose les quatre en-têtes et répond en HTTP/2, et ' +
      'les ' +
      tenus +
      ' blocs qui coupent l\'héritage reposent les trois'
  );
}
process.exit(status);
