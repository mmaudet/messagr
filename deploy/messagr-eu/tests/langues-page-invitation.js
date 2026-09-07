// SIX LANGUES, ET AUCUNE À MOITIÉ.
//
// L'application embarque six catalogues et n'a aucun repli : #103 le dit
// sans détour -- un repli est la manière dont une langue à moitié traduite
// part en production sans que personne ne s'en aperçoive, parce que l'écran
// se lit très bien pour celui qui l'a écrit. Le compilateur tient cette
// promesse côté application : `Record<CopyKey, string>` n'a aucune clé
// optionnelle.
//
// Cette page n'a pas de compilateur. Ce fichier en tient lieu, et il tient
// deux choses différentes :
//
//   1. LES CATALOGUES SONT COMPLETS L'UN PAR RAPPORT À L'AUTRE. Une clé
//      ajoutée à l'anglais et oubliée en néerlandais donnerait une page
//      néerlandaise avec une phrase française au milieu -- et personne ne le
//      verrait, exactement pour la raison que #103 nomme.
//
//   2. LA PAGE CHANGE VRAIMENT DE LANGUE. Un catalogue complet que rien ne
//      lit est un catalogue mort ; ce test fait tourner le script de la page
//      avec un navigateur allemand et lit ce qui s'affiche.
//
// LE FRANÇAIS N'EST PAS UN CATALOGUE, et c'est délibéré : il est dans le
// HTML. Sans script la page reste française et complète, ce dont le
// commentaire des trois destinations est déjà fier. `TRADUCTIONS.fr` vaut
// donc `null`, et c'est ce que ce test attend.
'use strict';

var fs = require('fs');
var path = require('path');

var racine = path.join(__dirname, '..');
var chemin = process.argv[2] || path.join(racine, 'site/i/index.html');
var page = fs.readFileSync(chemin, 'utf8');
var script = /<script>([\s\S]*?)<\/script>/.exec(page);
if (!script) { echouer('la page ne porte aucun script'); }

var status = 0;
function echouer(message) {
  console.error('langues: FAIL: ' + message);
  status = 1;
}

// ── Faire tourner la page comme un navigateur ───────────────────────────
function rendre(langues) {
  function texteDuBalisage(id) {
    var trouve = new RegExp('<([a-z]+)[^>]*\\bid="' + id + '"[^>]*>([\\s\\S]*?)</\\1>')
      .exec(page);
    return trouve ? trouve[2].replace(/\s+/g, ' ').trim() : '';
  }

  var noeuds = {};
  function noeud(id) {
    if (!noeuds[id]) {
      noeuds[id] = {
        id: id, hidden: true, textContent: texteDuBalisage(id),
        attributs: {},
        appendChild: function () {},
        addEventListener: function () {},
        getAttribute: function (nom) { return noeuds[id].attributs[nom] || null; },
        setAttribute: function (nom, valeur) { noeuds[id].attributs[nom] = valeur; },
        getContext: undefined
      };
    }
    return noeuds[id];
  }
  noeud('qr').getContext = function () {
    return { fillStyle: '', fillRect: function () {} };
  };

  // Les éléments marqués, relevés du balisage : le script les cherche par
  // `querySelectorAll`, et un faux document qui en rendrait aucun ferait
  // passer ce test sur une page qui ne traduit rien.
  function marques(attribut) {
    var trouves = [];
    var motif = new RegExp('<([a-z]+)[^>]*\\b' + attribut + '="([^"]+)"[^>]*>([\\s\\S]*?)</\\1>', 'g');
    var m;
    while ((m = motif.exec(page)) !== null) {
      (function (cle, texte) {
        trouves.push({
          cle: cle,
          textContent: texte.replace(/\s+/g, ' ').trim(),
          attributs: {},
          getAttribute: function (nom) {
            return nom === attribut ? cle : (this.attributs[nom] || null);
          },
          setAttribute: function (nom, valeur) { this.attributs[nom] = valeur; }
        });
      })(m[2], m[3]);
    }
    return trouves;
  }

  var marquees = marques('data-t');
  var etiquetees = marques('data-t-label');
  var racineHtml = { lang: 'fr' };

  var document_ = {
    documentElement: racineHtml,
    title: 'Messagr — invitation',
    getElementById: function (id) { return noeud(id); },
    createElement: function () { return { href: '', textContent: '' }; },
    querySelectorAll: function (selecteur) {
      if (selecteur === '[data-t]') { return marquees; }
      if (selecteur === '[data-t-label]') { return etiquetees; }
      return [];
    }
  };

  var navigateur = {
    // Un agent de bureau : c'est la seule branche qui dessine le symbole et
    // qui écrit la phrase « ouvrez ce lien depuis votre téléphone ».
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
    maxTouchPoints: 0,
    languages: langues,
    language: langues[0]
  };

  // eslint-disable-next-line no-new-func
  var run = new Function('document', 'navigator', 'location', script[1]);
  run(document_, navigateur, { href: 'https://messagr.eu/i/abcdef0123456789' });

  return {
    lang: racineHtml.lang,
    titre: document_.title,
    marquees: marquees,
    etiquetees: etiquetees,
    autre: noeud('dest-autre').textContent,
    ios: noeud('dest-ios').textContent
  };
}

// ── 1. Les catalogues, complets l'un par rapport à l'autre ──────────────
var catalogues = (function () {
  // eslint-disable-next-line no-new-func
  var lire = new Function(
    /var TRADUCTIONS = \{[\s\S]*?\n {2}\};/.exec(script[1])[0] + '\nreturn TRADUCTIONS;'
  );
  return lire();
})();

var CODES = ['fr', 'en', 'de', 'es', 'it', 'nl'];
CODES.forEach(function (code) {
  if (!Object.prototype.hasOwnProperty.call(catalogues, code)) {
    echouer('aucun catalogue pour « ' + code + ' »');
  }
});
if (catalogues.fr !== null) {
  echouer('le français doit valoir null : il est dans le HTML, et une page ' +
    'sans script doit rester française et complète');
}

var reference = catalogues.en;
if (!reference) {
  echouer("l'anglais sert de référence de complétude et n'existe pas");
} else {
  var clefs = Object.keys(reference).sort();
  CODES.forEach(function (code) {
    if (code === 'fr' || !catalogues[code]) { return; }
    var siennes = Object.keys(catalogues[code]).sort();
    clefs.forEach(function (cle) {
      if (siennes.indexOf(cle) === -1) {
        echouer('« ' + code + ' » ne traduit pas « ' + cle + ' ». La page ' +
          'afficherait une phrase française au milieu, et personne ne le ' +
          'verrait.');
      }
    });
    siennes.forEach(function (cle) {
      if (clefs.indexOf(cle) === -1) {
        echouer('« ' + code + ' » porte « ' + cle + ' » que rien d\'autre ne ' +
          "porte : soit une clé morte, soit une phrase que les autres langues " +
          'ont perdue.');
      }
    });
  });
}

// ── 2. La page change vraiment de langue ────────────────────────────────
var allemand = rendre(['de-AT', 'de']);
if (allemand.lang !== 'de') {
  echouer('la racine du document reste en « ' + allemand.lang + " » pour un " +
    'navigateur allemand');
}
if (allemand.titre !== catalogues.de.titre) {
  echouer('le titre reste « ' + allemand.titre + ' »');
}
allemand.marquees.forEach(function (n) {
  var attendu = catalogues.de[n.cle];
  if (attendu && n.textContent !== attendu) {
    echouer('« ' + n.cle + ' » affiche « ' + n.textContent + ' » et non « ' +
      attendu + ' »');
  }
});
allemand.etiquetees.forEach(function (n) {
  var attendu = catalogues.de[n.cle];
  if (attendu && n.attributs['aria-label'] !== attendu) {
    echouer("l'étiquette « " + n.cle + ' » n\'a pas été traduite');
  }
});
// La phrase que le script construit, pas celle que le HTML porte.
if (allemand.autre !== catalogues.de.ordinateur) {
  echouer('la phrase de bureau reste « ' + allemand.autre + ' »');
}

// `de-AT` compte comme `de` : refuser sur la sous-étiquette régionale
// rendrait la page française pour la moitié de l'Europe germanophone.
if (rendre(['de-AT']).lang !== 'de') {
  echouer('une sous-étiquette régionale fait retomber la page en français');
}

// Et le repli, qui est le comportement par défaut et non un échec.
if (rendre(['pt-BR', 'ja']).lang !== 'fr') {
  echouer('une langue non portée devrait laisser la page française');
}

// ── 3. La page d'accueil, qui porte les siens ───────────────────────────
//
// Elle n'avait aucun script et garde la propriété qui va avec : le français
// est dans le balisage, le bloc ne fait que le remplacer. Ses catalogues
// sont les siens -- ce ne sont pas les mêmes phrases -- mais la règle de
// complétude est la même, et pour la même raison.
var accueil = fs.readFileSync(path.join(racine, 'site/index.html'), 'utf8');
var scriptAccueil = /<script>([\s\S]*?)<\/script>/.exec(accueil);
if (!scriptAccueil) {
  echouer("la page d'accueil ne porte plus de traductions");
} else {
  // eslint-disable-next-line no-new-func
  var lireAccueil = new Function(
    /var T = \{[\s\S]*?\n {2}\};/.exec(scriptAccueil[1])[0] + '\nreturn T;'
  );
  var siens = lireAccueil();
  CODES.forEach(function (code) {
    if (!Object.prototype.hasOwnProperty.call(siens, code)) {
      echouer("la page d'accueil n'a aucun catalogue pour « " + code + ' »');
    }
  });
  if (siens.fr !== null) {
    echouer("le français de la page d'accueil doit valoir null : il est dans " +
      'le balisage, et sans script la page doit rester entière');
  }
  var clefsAccueil = Object.keys(siens.en || {}).sort();
  // Chaque phrase marquée dans le balisage doit exister dans chaque
  // catalogue : une marque sans traduction est une phrase française au
  // milieu d'une page allemande.
  var motif = /data-t="([^"]+)"/g;
  var vues = {};
  var trouve;
  while ((trouve = motif.exec(accueil)) !== null) { vues[trouve[1]] = true; }
  Object.keys(vues).forEach(function (cle) {
    if (clefsAccueil.indexOf(cle) === -1) {
      echouer("la page d'accueil marque « " + cle + ' » que ses catalogues ne ' +
        'traduisent pas');
    }
  });
  CODES.forEach(function (code) {
    if (code === 'fr' || !siens[code]) { return; }
    var aElle = Object.keys(siens[code]).sort();
    clefsAccueil.forEach(function (cle) {
      if (aElle.indexOf(cle) === -1) {
        echouer("la page d'accueil : « " + code + ' » ne traduit pas « ' +
          cle + ' »');
      }
    });
  });
}

// ── 4. LE SÉLECTEUR DE LA PAGE D'ACCUEIL, QUI ÉTAIT BRANCHÉ SUR RIEN ────
//
// La section 3 vérifiait que les catalogues de l'accueil sont complets, et
// s'arrêtait là : elle ne faisait jamais tourner son script. Le `select`
// existait donc, s'ouvrait, et choisir « Español » ne changeait rien --
// aucun code ne lisait sa valeur. Signalé depuis le site en production le
// 7 septembre 2026, sur une page dont tous les tests étaient verts.
//
// Ce bloc le fait tourner pour de vrai : détection, reflet dans le contrôle,
// changement, et retour au français.
(function () {
  function rendreAccueil(langues) {
    var bloc = accueil.match(/<script>([\s\S]*?)<\/script>/);
    if (!bloc) { echouer("la page d'accueil n'a plus de script"); return null; }

    var marquees = [];
    var balise = /<([a-z0-9]+)[^>]*\bdata-t="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g;
    var m;
    while ((m = balise.exec(accueil)) !== null) {
      (function (cle, texte) {
        marquees.push({
          cle: cle,
          textContent: texte.replace(/\s+/g, ' ').trim(),
          getAttribute: function () { return cle; }
        });
      })(m[2], m[3]);
    }

    // Le `select`, avec ce que le balisage lui donne comme options, et un
    // écouteur qu'on pourra déclencher : c'est exactement la pièce dont
    // l'absence rendait ce défaut invisible.
    var abonnes = [];
    var choix = {
      value: '',
      addEventListener: function (nom, fn) {
        if (nom === 'change') { abonnes.push(fn); }
      }
    };
    var racineHtml = { lang: 'fr' };
    var document_ = {
      documentElement: racineHtml,
      getElementById: function (id) { return id === 'langue' ? choix : null; },
      querySelectorAll: function (sel) { return sel === '[data-t]' ? marquees : []; }
    };
    // eslint-disable-next-line no-new-func
    new Function('document', 'navigator', bloc[1])(document_, {
      languages: langues,
      language: langues[0]
    });
    return {
      // UNE FONCTION, PAS UNE COPIE. La première version relevait
      // `racineHtml.lang` à la construction, donc elle lisait toujours la
      // valeur d'avant la bascule et accusait la page d'un défaut qui était
      // dans ce fichier.
      lang: function () { return racineHtml.lang; },
      choix: choix,
      marquees: marquees,
      basculer: function (code) {
        choix.value = code;
        abonnes.forEach(function (fn) { fn(); });
      },
      dit: function (cle) {
        for (var i = 0; i < marquees.length; i++) {
          if (marquees[i].cle === cle) { return marquees[i].textContent; }
        }
        return null;
      }
    };
  }

  var vue = rendreAccueil(['fr-FR', 'fr']);
  if (!vue) { return; }
  var enFrancais = vue.dit('titre');

  if (vue.choix.value !== 'fr') {
    echouer("le sélecteur n'affiche pas la langue détectée (" +
      JSON.stringify(vue.choix.value) + ' au lieu de "fr")');
  }

  // LE DÉFAUT SIGNALÉ, DANS LES DEUX SENS.
  vue.basculer('es');
  if (vue.lang() !== 'es') {
    echouer('choisir « es » ne change pas la langue du document');
  }
  if (vue.dit('titre') === enFrancais) {
    echouer('choisir « es » ne traduit pas la page');
  }

  // ET LE RETOUR, QUI EST L'AUTRE MOITIÉ. Le français est dans le balisage,
  // donc son catalogue est vide : sans un relevé fait avant la première
  // traduction, revenir au français ne remplacerait rien et la page
  // resterait espagnole.
  vue.basculer('fr');
  if (vue.dit('titre') !== enFrancais) {
    echouer('revenir au français ne rend pas la page au français');
  }
  if (vue.lang() !== 'fr') {
    echouer('revenir au français ne remet pas la langue du document');
  }

  // Et la détection continue de fonctionner pour qui ne touche à rien.
  var espagnol = rendreAccueil(['es-ES', 'es']);
  if (espagnol && espagnol.choix.value !== 'es') {
    echouer("un navigateur espagnol n'obtient pas « es » dans le sélecteur");
  }
})();

if (status === 0) {
  console.log('langues: ' + (CODES.length - 1) + ' catalogues complets sur ' +
    'les deux pages, la page d\'invitation se traduit pour le navigateur ' +
    'qui la lit, et le sélecteur de l\'accueil change vraiment de langue');
}
process.exit(status);
