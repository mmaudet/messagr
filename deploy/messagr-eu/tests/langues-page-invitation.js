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

// ── 3. LE CATALOGUE DE LA PAGE D'ACCUEIL, QUI EST MAINTENANT UN FICHIER ──
//
// Les catalogues vivaient dans le script de la page, et la page se traduisait
// à l'affichage. C'était juste pour le lecteur et invisible pour tout le
// reste : un moteur n'indexait que le français, et « la page en allemand »
// n'était pas une adresse qu'on pouvait envoyer. Les six pages sont désormais
// écrites par `build-landing.mjs`.
//
// La règle de complétude ne change pas, et sa raison non plus : une clé
// oubliée dans une langue donne une page allemande avec une phrase française
// au milieu, que personne ne lira avant un lecteur allemand.
var accueil = fs.readFileSync(path.join(racine, 'site/index.html'), 'utf8');
var copie = JSON.parse(
  fs.readFileSync(path.join(racine, 'landing/copy.json'), 'utf8')
);

var marqueesAccueil = [];
(function () {
  var motif = /data-t="([^"]+)"/g;
  var trouve;
  while ((trouve = motif.exec(accueil)) !== null) {
    if (marqueesAccueil.indexOf(trouve[1]) === -1) { marqueesAccueil.push(trouve[1]); }
  }
})();
marqueesAccueil.sort();

if (marqueesAccueil.length === 0) {
  echouer("la page d'accueil ne marque plus aucune phrase");
}

CODES.forEach(function (code) {
  if (!copie[code]) {
    echouer('le catalogue de l\'accueil ne porte pas « ' + code + ' »');
    return;
  }
  marqueesAccueil.forEach(function (cle) {
    if (typeof copie[code][cle] !== 'string' || !copie[code][cle]) {
      echouer("l'accueil : « " + code + ' » ne traduit pas « ' + cle + ' »');
    }
  });
  Object.keys(copie[code]).forEach(function (cle) {
    if (marqueesAccueil.indexOf(cle) === -1) {
      echouer("l'accueil : « " + code + ' » porte « ' + cle +
        ' », que la page ne marque pas');
    }
  });
});

// LE FRANÇAIS DU CATALOGUE EST CELUI DU BALISAGE, et pas une seconde copie.
// Deux sources pour la même phrase, c'est une phrase qui finit par différer
// d'elle-même sans que rien ne le dise.
(function () {
  var balise = /<([a-z0-9]+)[^>]*\bdata-t="([^"]+)"[^>]*>([^<]*)<\/\1>/g;
  var m;
  while ((m = balise.exec(accueil)) !== null) {
    var dansLaPage = m[3].replace(/\s+/g, ' ').trim();
    if (copie.fr[m[2]] !== dansLaPage) {
      echouer('« ' + m[2] + ' » : le balisage dit "' + dansLaPage +
        '" et le catalogue français dit "' + copie.fr[m[2]] + '"');
    }
  }
})();

// ── 4. LE GÉNÉRATEUR, MIS À L'ÉPREUVE PLUTÔT QUE RECOPIÉ ─────────────────
//
// Il tourne pour de vrai, sur une copie du site, et on lit ce qu'il a écrit.
// Un test qui réimplémenterait la substitution serait d'accord avec lui-même
// pour toujours -- la même règle que `destinations-page-invitation.js` et
// `qr-page-invitation.js` appliquent déjà.
(function () {
  var os = require('os');
  var child = require('child_process');

  function construire(preparer) {
    var source = fs.mkdtempSync(path.join(os.tmpdir(), 'langues-src-'));
    var sortie = fs.mkdtempSync(path.join(os.tmpdir(), 'langues-out-'));
    fs.cpSync(path.join(racine, 'site'), source, { recursive: true });
    var catalogue = path.join(racine, 'landing/copy.json');
    var sauvegarde = fs.readFileSync(catalogue, 'utf8');
    if (preparer) { preparer(source, catalogue); }
    var resultat = child.spawnSync(
      path.join(racine, 'build-site.sh'), [source, sortie],
      { encoding: 'utf8' }
    );
    fs.writeFileSync(catalogue, sauvegarde);
    return { code: resultat.status, sortie: sortie, dit: (resultat.stderr || '') };
  }

  var bon = construire(null);
  if (bon.code !== 0) {
    echouer('la construction refuse un site intact : ' + bon.dit.trim());
    return;
  }

  // Les six pages, chacune dans sa langue, et sans une phrase de la source.
  CODES.forEach(function (code) {
    var ou = code === 'fr'
      ? path.join(bon.sortie, 'index.html')
      : path.join(bon.sortie, code, 'index.html');
    if (!fs.existsSync(ou)) {
      echouer('la page « ' + code + ' » n\'a pas été écrite');
      return;
    }
    var rendue = fs.readFileSync(ou, 'utf8');

    if (rendue.indexOf('<html lang="' + code + '">') === -1) {
      echouer('la page « ' + code + ' » ne se déclare pas dans sa langue');
    }
    var adresse = code === 'fr' ? 'https://messagr.eu/' : 'https://messagr.eu/' + code + '/';
    if (rendue.indexOf('rel="canonical" href="' + adresse + '"') === -1) {
      echouer('la page « ' + code + ' » ne porte pas son canonical');
    }
    // Le jeu complet des hreflang, sur CHAQUE page : un lien qui ne part que
    // dans un sens ne relie rien.
    CODES.forEach(function (autre) {
      var vers = autre === 'fr' ? 'https://messagr.eu/' : 'https://messagr.eu/' + autre + '/';
      if (rendue.indexOf('hreflang="' + autre + '" href="' + vers + '"') === -1) {
        echouer('la page « ' + code + ' » ne renvoie pas vers « ' + autre + ' »');
      }
    });
    if (rendue.indexOf('hreflang="x-default"') === -1) {
      echouer('la page « ' + code + ' » ne porte pas x-default');
    }

    // Et le texte : chaque phrase marquée est celle de SA langue.
    //
    // Les blancs sont normalisés avant la recherche. Le balisage français
    // coupe `invitation-corps` sur deux lignes, ce qui ne change rien à ce
    // qu'un lecteur voit et empêchait la comparaison littérale de trouver une
    // phrase qui était bien là.
    var plat = rendue.replace(/\s+/g, ' ');
    // LES TROIS LIGNES DE FAITS SONT ABSENTES ICI, ET C'EST LE COMPORTEMENT.
    // Cette construction n'a pas reçu les mesures du téléchargement, donc le
    // générateur les retire au lieu d'afficher « %TAILLE% ». Les exiger
    // reviendrait à exiger une page qui ment. Elles sont éprouvées plus bas,
    // dans leurs deux états.
    //
    // `etat-verifie` en fait partie pour la même raison : le tableau des états
    // est vérifié CONTRE une construction, donc sans fichier proposé la phrase
    // « vérifié sur la construction du … » n'a rien à nommer.
    var FAITS = ['apk-faits', 'apk-empreinte', 'etat-verifie'];
    marqueesAccueil.filter(function (c) {
      return FAITS.indexOf(c) === -1;
    }).forEach(function (cle) {
      if (plat.indexOf(copie[code][cle]) === -1) {
        echouer('la page « ' + code + ' » ne porte pas sa phrase « ' + cle + ' »');
      }
    });
    if (code !== 'fr' && plat.indexOf('>' + copie.fr.titre + '<') !== -1) {
      echouer('la page « ' + code + ' » a gardé le titre français');
    }
    // L'APERÇU DE LIEN, PAR LANGUE. Une carte française sur `/de/` annulerait
    // ce que les six adresses corrigent, et c'est la seule surface par
    // laquelle ce produit se diffuse : quelqu'un envoie un lien à quelqu'un.
    var social = [
      ['og:title', copie[code].titre],
      ['og:description', copie[code].chapo],
      ['og:url', adresse],
      ['og:image', 'https://messagr.eu/messagr-partage-' + code + '.png']
    ];
    social.forEach(function (paire) {
      var attendu = '<meta property="' + paire[0] + '" content="' +
        paire[1].replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;') + '">';
      if (rendue.indexOf(attendu) === -1) {
        echouer('la page « ' + code + ' » ne porte pas ' + paire[0] + ' dans sa langue');
      }
    });
    // ET L'IMAGE DOIT EXISTER. Une carte nommée et absente donne un aperçu
    // gris, c'est-à-dire exactement le défaut que tout ceci corrige, avec le
    // balisage en plus pour faire croire le contraire.
    var carte = path.join(bon.sortie, 'messagr-partage-' + code + '.png');
    if (!fs.existsSync(carte)) {
      echouer('la carte de partage « ' + code + ' » est nommée et absente de la construction');
    }
  });

  // ── LES FAITS DU TÉLÉCHARGEMENT, DANS LEURS DEUX ÉTATS ─────────────────
  //
  // Sans eux, les deux paragraphes doivent SORTIR de la page : une marque
  // « %TAILLE% » montrée à un lecteur est pire qu'un silence. Avec eux, ils
  // doivent porter le chiffre de la langue — « 132,6 Mo » et « 132.6 MB » sont
  // le même nombre écrit pour deux lecteurs.
  ['%TAILLE%', '%DATE%', '%EMPREINTE%'].forEach(function (marque) {
    CODES.forEach(function (code) {
      var ou = code === 'fr'
        ? path.join(bon.sortie, 'index.html')
        : path.join(bon.sortie, code, 'index.html');
      if (fs.readFileSync(ou, 'utf8').indexOf(marque) !== -1) {
        echouer('la page « ' + code + ' » montre la marque ' + marque);
      }
    });
  });

  // L'EMPREINTE FABRIQUÉE EST CELLE QUE LA PAGE DÉCLARE, ET NON UNE SUITE DE
  // « a ». Le tableau des états porte `data-verifie-sur` : l'empreinte contre
  // laquelle il a été vérifié, et `build-landing.mjs` refuse de publier un
  // tableau vérifié contre un autre fichier que celui que la page propose.
  // Un jeu de faits inventé au hasard tombe donc sur ce refus, qui est le bon
  // comportement -- mais ce bloc-ci éprouve l'écriture des faits, pas le
  // garde-fou, et il ne doit pas échouer pour la raison d'un autre.
  var declaree = /data-verifie-sur="([0-9a-f]{64})"/.exec(accueil);
  if (!declaree) {
    echouer("le tableau des états ne déclare pas `data-verifie-sur`");
  }
  var EMPREINTE = declaree ? declaree[1] : 'a'.repeat(64);
  var avecFaits = construire(function () {
    process.env.MESSAGR_APK_OCTETS = '139006945';
    process.env.MESSAGR_APK_SHA256 = EMPREINTE;
    process.env.MESSAGR_APK_DATE = '2026-09-07';
  });
  delete process.env.MESSAGR_APK_OCTETS;
  delete process.env.MESSAGR_APK_SHA256;
  delete process.env.MESSAGR_APK_DATE;
  if (avecFaits.code !== 0) {
    echouer('la construction refuse des faits de téléchargement valides : ' +
      avecFaits.dit.trim());
  } else {
    var pageFr = fs.readFileSync(path.join(avecFaits.sortie, 'index.html'), 'utf8');
    if (pageFr.indexOf('132,6 Mo') === -1) {
      echouer("le français devrait écrire « 132,6 Mo », il ne l'écrit pas");
    }
    if (pageFr.indexOf(EMPREINTE) === -1) {
      echouer("l'empreinte n'apparaît pas sur la page française");
    }
    var pageDe = fs.readFileSync(path.join(avecFaits.sortie, 'de', 'index.html'), 'utf8');
    if (pageDe.indexOf('132,6 MB') === -1) {
      echouer("l'allemand devrait écrire « 132,6 MB », il ne l'écrit pas");
    }
    if (/%[A-Z]+%/.test(pageDe)) {
      echouer('une marque a survécu sur la page allemande');
    }
  }
  fs.rmSync(avecFaits.sortie, { recursive: true, force: true });

  // ET UN JEU INCOMPLET DOIT ARRÊTER LA CONSTRUCTION. Annoncer un poids sans
  // dire de quel fichier il est vaut moins que se taire.
  var incomplet = construire(function () {
    process.env.MESSAGR_APK_OCTETS = '139006945';
  });
  delete process.env.MESSAGR_APK_OCTETS;
  if (incomplet.code === 0) {
    echouer('la construction accepte un poids sans empreinte ni date');
  }
  fs.rmSync(incomplet.sortie, { recursive: true, force: true });

  // Ce qu'un moteur et un navigateur vont chercher sans qu'on le leur dise.
  ['favicon.ico', 'robots.txt', 'sitemap.xml'].forEach(function (nom) {
    if (!fs.existsSync(path.join(bon.sortie, nom))) {
      echouer(nom + " manque à la construction");
    }
  });
  var plan = fs.readFileSync(path.join(bon.sortie, 'sitemap.xml'), 'utf8');
  CODES.forEach(function (code) {
    var adresse = code === 'fr' ? 'https://messagr.eu/' : 'https://messagr.eu/' + code + '/';
    if (plan.indexOf('<loc>' + adresse + '</loc>') === -1) {
      echouer('le plan du site ne nomme pas « ' + code + ' »');
    }
  });
  fs.rmSync(bon.sortie, { recursive: true, force: true });

  // ET IL DOIT REFUSER. Une clé retirée d'un catalogue est le défaut que tout
  // ceci existe pour attraper ; si la construction l'accepte, rien au-dessus
  // ne vaut.
  var ampute = construire(function (source, catalogue) {
    var c = JSON.parse(fs.readFileSync(catalogue, 'utf8'));
    delete c.de.titre;
    fs.writeFileSync(catalogue, JSON.stringify(c, null, 2) + '\n');
  });
  if (ampute.code === 0) {
    echouer('la construction accepte un catalogue allemand amputé de « titre »');
  }
  fs.rmSync(ampute.sortie, { recursive: true, force: true });

  // Et l'inverse : une phrase marquée que nul catalogue ne traduit.
  var enTrop = construire(function (source) {
    var fichier = path.join(source, 'index.html');
    var texte = fs.readFileSync(fichier, 'utf8');
    fs.writeFileSync(fichier, texte.replace('</main>', '<p data-t="inconnue">Bonjour</p></main>'));
  });
  if (enTrop.code === 0) {
    echouer('la construction accepte une clé que les catalogues ignorent');
  }
  fs.rmSync(enTrop.sortie, { recursive: true, force: true });
})();

// ── 5. LE SÉLECTEUR, QUI NAVIGUE MAINTENANT AU LIEU DE TRADUIRE ─────────
//
// Il a déjà été branché sur rien une fois : il existait, il s'ouvrait, et
// choisir « Español » ne changeait rien parce qu'aucun code ne lisait sa
// valeur (7 septembre 2026, sur une page dont tous les tests étaient verts).
// Son travail a changé, la leçon non : on le fait tourner.
(function () {
  var bloc = /<script>([\s\S]*?)<\/script>/.exec(accueil);
  if (!bloc) { echouer("la page d'accueil n'a plus de script"); return; }

  function jouer(langueDeLaPage, ou, langues, memoire, fragment) {
    var abonnes = [];
    var choix = {
      value: '',
      addEventListener: function (nom, fn) { abonnes.push(fn); }
    };
    var alle = { vers: null, remplace: null };
    var stock = {};
    if (memoire) { stock['messagr-langue'] = memoire; }
    var faux = {
      document: {
        documentElement: { lang: langueDeLaPage },
        getElementById: function (id) { return id === 'langue' ? choix : null; }
      },
      navigator: { languages: langues },
      location: {
        pathname: ou,
        hash: fragment || '',
        set href(v) { alle.vers = v; },
        replace: function (v) { alle.remplace = v; }
      },
      sessionStorage: {
        getItem: function (k) { return Object.prototype.hasOwnProperty.call(stock, k) ? stock[k] : null; },
        setItem: function (k, v) { stock[k] = v; }
      }
    };
    // eslint-disable-next-line no-new-func
    new Function('document', 'navigator', 'location', 'sessionStorage', bloc[1])(
      faux.document, faux.navigator, faux.location, faux.sessionStorage
    );
    return { choix: choix, alle: alle, declencher: function () {
      abonnes.forEach(function (fn) { fn(); });
    } };
  }

  // Le contrôle reflète la langue de la page qu'on lit.
  var sur = jouer('de', '/de/', ['de-DE'], null);
  if (sur.choix.value !== 'de') {
    echouer('sur /de/, le sélecteur devrait afficher « de »');
  }
  // Une page de langue n'est jamais renvoyée ailleurs : c'est une adresse que
  // quelqu'un a demandée.
  if (sur.alle.remplace !== null) {
    echouer('/de/ ne doit renvoyer nulle part, il renvoie vers ' + sur.alle.remplace);
  }
  // Et il navigue vraiment.
  sur.choix.value = 'es';
  sur.declencher();
  if (sur.alle.vers !== '/es/') {
    echouer('choisir « es » devrait mener à /es/, il mène à ' + sur.alle.vers);
  }

  // La racine renvoie vers la langue du lecteur.
  var racineAllemande = jouer('fr', '/', ['de-AT', 'en'], null);
  if (racineAllemande.alle.remplace !== '/de/') {
    echouer('un lecteur allemand à la racine devrait aller vers /de/, il va vers ' +
      racineAllemande.alle.remplace);
  }
  // Un lecteur français y reste.
  var racineFrancaise = jouer('fr', '/', ['fr-FR'], null);
  if (racineFrancaise.alle.remplace !== null) {
    echouer('un lecteur français à la racine ne doit être renvoyé nulle part');
  }
  // Une langue non portée y reste aussi : le repli est le comportement, pas
  // un échec.
  var racineAutre = jouer('fr', '/', ['pt-BR', 'ja'], null);
  if (racineAutre.alle.remplace !== null) {
    echouer('une langue non portée ne doit pas être renvoyée');
  }
  // LE PIÈGE, ET IL EST LA RAISON DE LA MÉMOIRE. Sans elle, un lecteur
  // allemand qui choisit « Français » atterrit sur `/` et se fait renvoyer
  // vers `/de/` : il ne pourrait jamais lire le français.
  var apresChoix = jouer('fr', '/', ['de-DE'], 'fr');
  if (apresChoix.alle.remplace !== null) {
    echouer('un choix explicite de français doit tenir, il renvoie vers ' +
      apresChoix.alle.remplace);
  }

  // LE FRAGMENT SURVIT AUX DEUX DÉPLACEMENTS.
  //
  // Il ne coûtait rien de le perdre tant qu'aucune adresse de cette page n'en
  // portait. La loupe en a fait une adresse : `#loupe-salon` ouvre un écran en
  // grand, et le lien envoyé à quelqu'un dont le navigateur demande l'anglais
  // le déposait sur `/en/` sans rien d'ouvert -- un lien qui a l'air de marcher
  // et ne montre pas ce qu'on lui a montré.
  var avecFragment = jouer('fr', '/', ['de-DE'], null, '#loupe-salon');
  if (avecFragment.alle.remplace !== '/de/#loupe-salon') {
    echouer('le renvoi vers la langue du lecteur doit garder le fragment, ' +
      'il mène à ' + avecFragment.alle.remplace);
  }
  // Et le sélecteur : changer de langue devant un écran ouvert doit rouvrir le
  // même écran, pas revenir en haut de la page.
  var choisiDevantUnEcran = jouer('de', '/de/', ['de-DE'], null, '#loupe-appel');
  choisiDevantUnEcran.choix.value = 'it';
  choisiDevantUnEcran.declencher();
  if (choisiDevantUnEcran.alle.vers !== '/it/#loupe-appel') {
    echouer('le sélecteur doit garder le fragment, il mène à ' +
      choisiDevantUnEcran.alle.vers);
  }
  // Sans fragment, aucune adresse ne gagne un `#` vide.
  var sansFragment = jouer('fr', '/', ['nl-NL'], null);
  if (sansFragment.alle.remplace !== '/nl/') {
    echouer('sans fragment, le renvoi doit rester nu, il mène à ' +
      sansFragment.alle.remplace);
  }
})();

if (status === 0) {
  console.log('langues: ' + CODES.length + ' catalogues complets sur les deux ' +
    'pages, la page d\'invitation se traduit pour le navigateur qui la lit, ' +
    'la construction écrit une page d\'accueil par langue et refuse un ' +
    'catalogue troué, et le sélecteur navigue vraiment');
}
process.exit(status);
