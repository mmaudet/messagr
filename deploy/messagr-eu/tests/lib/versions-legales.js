// CE QUE LES ESSAIS DES VERSIONS DES PAGES LÉGALES PARTAGENT (#467).
//
// L'adresse d'une version, `/confidentialite/a-publier/`, vient de
// `version-a-venir.mjs`, qui la construit pour les gestes : un essai qui
// l'écrirait à la main pourrait passer sur une adresse que le geste n'écrit
// pas. Et une seule façon de poser, dans un retention.json copié, une durée
// que seule une version à publier dit.
//
// Dans `lib/`, hors de `tests/*.js` : l'intégration continue lance chaque
// fichier de `tests/` comme un essai, et celui-ci n'en est pas un.
'use strict';

var fs = require('fs');
var path = require('path');
var versions = require(path.join(__dirname, '..', '..', 'version-a-venir.mjs'));

/** L'adresse de la version à publier d'une page, telle que les gestes l'écrivent. */
function aPublier(page) {
  return versions.adresseDe(page, versions.A_PUBLIER);
}

/**
 * Pose dans le retention.json `file` une durée d'essai par adresse, et rend le
 * fichier tel qu'il est ensuite, lu. Le reste du fichier garde la forme que
 * prettier lui donne, celle que `publier` retire ligne à ligne ; et la clé
 * « page » est la dernière de son objet, pour que la virgule de la clé qui la
 * précède doive tomber avec elle.
 */
function withTrialDurations(file, addresses) {
  var added = addresses.map(function (address, i) {
    return '  "essai_' + i + '": {\n' +
      '    "duree": "une durée que seule la version à publier dit",\n' +
      '    "page": "' + address + '"\n' +
      '  }';
  });
  var text = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, text.replace(/\n}\s*$/, ',\n' + added.join(',\n') + '\n}\n'));
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

module.exports = { aPublier: aPublier, withTrialDurations: withTrialDurations };
