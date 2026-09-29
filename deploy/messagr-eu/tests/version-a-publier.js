// UNE VERSION DES PAGES LÉGALES QUI S'APPLIQUE LE JOUR OÙ ELLE EST PUBLIÉE
// (#466), MESURÉE SUR LE SITE CONSTRUIT.
//
// Les conditions générales en vigueur ne fixent aucun préavis (leur clause
// 7) : une nouvelle version peut s'appliquer le jour même où elle paraît. Ce
// jour, c'est le porteur qui le choisit, en publiant avec le déploiement en
// production (#474). La date n'existe donc pas avant, et la version attend
// dans `<page>/a-publier/`, avec sa traduction anglaise sous `en/`, une marque
// à la place de la date. Les façons de rater, et chacune est tenue ici :
//
//   1. Publier trop tôt : un déploiement fait pour autre chose servirait la
//      nouvelle version, ou sa traduction, avant le jour choisi.
//      `build-site.sh` ne construit rien de `a-publier/`, et refuse une page
//      construite qui porte encore la marque.
//   2. Publier mal : une date qui n'est pas celle du jour à Paris, une marque
//      oubliée quelque part, la version remplacée perdue au lieu de rester
//      lisible à son adresse datée, un renvoi qui ne mène nulle part, une
//      traduction qui ne dit pas quel texte fait foi, l'annonce de la
//      version à venir perdue en chemin, ou `retention.json` qui chercherait
//      encore une durée nouvelle à l'adresse d'une version publiée, où plus
//      rien ne répond, au lieu de la politique en vigueur qui la dit (#467).
//   3. Mêler deux changements : annoncer une version à venir pendant qu'une
//      autre attend d'être publiée sur la même page, ou appliquer une version
//      à venir qui laisserait une traduction traduire une version remplacée.
//
// LE TEST CONDUIT LES VRAIS SCRIPTS sur une copie du site, comme
// version-a-venir.js, et il tient dans les deux états du dépôt : une version
// qui attend d'être publiée, et aucune, après la publication. Dans le second,
// la copie en reçoit une, préparée à partir de la version en vigueur comme
// LISEZ-MOI-pages-legales.md le dit ; les pages sont trouvées par leur forme,
// comme `version-a-venir.mjs` les trouve.
'use strict';

var fs = require('fs');
var os = require('os');
var path = require('path');
var child = require('child_process');

var root = path.join(__dirname, '..');
var build = path.join(root, 'build-site.sh');
var tool = path.join(root, 'version-a-venir.mjs');
var siteDir = path.join(root, 'site');
var retentionFile = path.join(root, 'retention.json');
var MARQUE = 'MESSAGR-DATE-DE-PUBLICATION';
var A_VENIR = 'MESSAGR-DATE-A-VENIR';
var status = 0;

function fail(message) {
  console.error('version-a-publier: FAIL: ' + message);
  status = 1;
}

// La sortie d'erreur est gardée même quand le geste réussit : c'est là qu'il
// dit quelle page attend, et pourquoi.
function run(file, args) {
  var result = child.spawnSync(file, args, {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
  });
  return {
    code: result.status === null ? -1 : result.status,
    out: String(result.stdout || ''),
    err: String(result.stderr || '') + (result.error ? String(result.error.message) : ''),
  };
}

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function exists(file) {
  return fs.existsSync(file);
}

var MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet',
  'août', 'septembre', 'octobre', 'novembre', 'décembre'];
var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

/** La date telle qu'une page de cette langue l'écrit. */
function said(date, lang) {
  var parts = date.split('-').map(Number);
  var words = lang === 'en'
    ? parts[2] + ' ' + MONTHS[parts[1] - 1] + ' ' + parts[0]
    : (parts[2] === 1 ? '1er' : String(parts[2])) + ' ' + MOIS[parts[1] - 1] + ' ' + parts[0];
  return '<time datetime="' + date + '">' + words + '</time>';
}

/** Le texte d'une page, sans balises ni commentaires, comme on le lit. */
function textOf(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');
}

/** Les traductions d'une version : ses sous-dossiers de deux lettres. */
function translationsOf(dir) {
  if (!exists(dir)) {
    return [];
  }
  return fs.readdirSync(dir).filter(function (name) {
    return /^[a-z]{2}$/.test(name) && exists(path.join(dir, name, 'index.html'));
  }).sort();
}

/** Les pages légales : celles qui ont une version à publier, à venir, ou datée. */
function legalPages(site) {
  return fs.readdirSync(site).filter(function (name) {
    var dir = path.join(site, name);
    return fs.statSync(dir).isDirectory() &&
      (exists(path.join(dir, 'a-publier', 'index.html')) ||
       exists(path.join(dir, 'a-venir', 'index.html')) ||
       fs.readdirSync(dir).some(function (entry) { return /^jusqu-au-/.test(entry); }));
  }).sort();
}
var PAGES = legalPages(siteDir);

/**
 * Une version prête à publier, écrite à partir de la version en vigueur quand
 * la page n'en tient aucune : sa carte « depuis » remplacée par une qui porte
 * la marque, sa date aussi. Sa traduction, si elle en a une, passe dans
 * `a-publier/` de la même façon : la version en vigueur n'en garde pas, comme
 * celle du 5 septembre 2026 n'en avait pas.
 */
function waitingForm(html, page, lang) {
  var since = lang === 'en'
    ? '<p><b>This version has been in force since ' + MARQUE + '.</b>\n' +
      '        <a href="/' + page + '/jusqu-au-' + MARQUE + '/">The version it replaces.</a></p>'
    : '<p><b>Cette version s\'applique depuis le ' + MARQUE + '.</b>\n' +
      '        <a href="/' + page + '/jusqu-au-' + MARQUE + '/">La version qu\'elle remplace.</a></p>';
  return html
    .replace(/<!-- depuis -->[\s\S]*?<!-- \/depuis -->/, '')
    .replace(/<p class="stamp">[\s\S]*?<\/p>/,
      '<p class="stamp">' + (lang === 'en' ? 'Version of ' : 'Version du ') + MARQUE + '</p>\n' +
      '      <div class="card">\n' +
      '        <!-- depuis -->\n' +
      '        ' + since + '\n' +
      '        <!-- /depuis -->\n' +
      '        <ul><li>une version préparée par ce test.</li></ul>\n' +
      '      </div>');
}

function prepare(site, page) {
  var dir = path.join(site, page);
  var waiting = path.join(dir, 'a-publier');
  fs.mkdirSync(waiting);
  fs.writeFileSync(path.join(waiting, 'index.html'),
    waitingForm(read(path.join(dir, 'index.html')), page, 'fr'));
  translationsOf(dir).forEach(function (lang) {
    fs.mkdirSync(path.join(waiting, lang));
    fs.writeFileSync(path.join(waiting, lang, 'index.html'),
      waitingForm(read(path.join(dir, lang, 'index.html')), page, lang));
    fs.rmSync(path.join(dir, lang), { recursive: true });
  });
}

/** Une copie du site, et de retention.json à côté comme dans le dépôt. */
function aPlainCopy() {
  var copy = fs.mkdtempSync(path.join(os.tmpdir(), 'a-publier-source-'));
  var site = path.join(copy, 'site');
  fs.mkdirSync(site);
  child.execFileSync('cp', ['-R', siteDir + '/.', site]);
  child.execFileSync('cp', [retentionFile, path.join(copy, 'retention.json')]);
  return site;
}

/**
 * `retention.json` de la copie, avec une durée que chaque version qui attend
 * dit, comme une durée nouvelle attend la version qui la dit (#467). Sa clé
 * « page » est la dernière de son objet : la virgule de la clé qui la précède
 * doit tomber avec elle. Rend le fichier tel qu'il est avant la publication.
 */
function withWaitingDurations(site) {
  var file = path.join(site, '..', 'retention.json');
  var added = PAGES.filter(function (page) {
    return exists(path.join(site, page, 'a-publier', 'index.html'));
  }).map(function (page) {
    return '  "essai_' + page.replace(/-/g, '_') + '": {\n' +
      '    "duree": "une durée que ce test fait dire",\n' +
      '    "page": "/' + page + '/a-publier/"\n' +
      '  }';
  });
  fs.writeFileSync(file, read(file).replace(/\n}\s*$/, ',\n' + added.join(',\n') + '\n}\n'));
  return JSON.parse(read(file));
}

/** Une copie où chaque page légale tient une version qui attend d'être publiée. */
function aCopy() {
  var site = aPlainCopy();
  PAGES.forEach(function (page) {
    if (!exists(path.join(site, page, 'a-publier', 'index.html'))) {
      prepare(site, page);
    }
  });
  return site;
}

/** Chaque fichier d'un arbre et son contenu, pour dire que rien n'a bougé. */
function snapshot(dir) {
  var all = {};
  (function walk(at) {
    fs.readdirSync(at).sort().forEach(function (name) {
      var file = path.join(at, name);
      if (fs.statSync(file).isDirectory()) {
        walk(file);
      } else {
        all[path.relative(dir, file)] = fs.readFileSync(file).toString('base64');
      }
    });
  })(dir);
  return JSON.stringify(all);
}

function built(source) {
  var out = fs.mkdtempSync(path.join(os.tmpdir(), 'a-publier-site-'));
  return { result: run(build, [source, out]), out: out };
}

/** Refusé par le geste, et non tombé en cours de route. */
function refused(result) {
  return result.code !== 0 && /REFUS|Refus \[Error\]/.test(result.err);
}

/** `publier` à l'instant donné, que la ligne de commande ne permet pas de choisir. */
function publishAt(site, instant) {
  return run('node', ['--input-type=module', '-e',
    'import { publier } from ' + JSON.stringify(tool) + ';\n' +
    'publier(' + JSON.stringify(site) + ', new Date(' + JSON.stringify(instant) + '));']);
}

/**
 * `appliquer` à l'instant donné, comme version-a-venir.js le fait, et ce qui
 * retient les pages qui attendent, dit comme la ligne de commande le dit.
 */
function applyAt(site, instant) {
  return run('node', ['--input-type=module', '-e',
    'import { appliquer } from ' + JSON.stringify(tool) + ';\n' +
    'const fait = appliquer(' + JSON.stringify(site) + ', ' +
    JSON.stringify(path.join(site, '..', 'retention.json')) +
    ', new Date(' + JSON.stringify(instant) + '));\n' +
    'for (const retenue of fait.attendent) console.error(retenue);']);
}

/**
 * Minuit à Paris, le jour `date`, moins `minutes`. Le décalage est lu la
 * veille à midi : l'heure change à deux ou trois heures du matin, jamais à
 * minuit, donc celui de la veille est celui de minuit.
 */
function parisMidnight(date, minutes) {
  var offset = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Paris', timeZoneName: 'shortOffset',
  }).formatToParts(new Date(Date.parse(date + 'T00:00:00Z') - 12 * 3600000)).filter(function (p) {
    return p.type === 'timeZoneName';
  })[0].value; // « GMT+1 » ou « GMT+2 »
  var hours = Number(offset.replace('GMT', ''));
  return new Date(Date.parse(date + 'T00:00:00Z') - hours * 3600000 - minutes * 60000).toISOString();
}

/** Aujourd'hui à Paris, AAAA-MM-JJ. */
function todayInParis() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

/** La veille d'une date AAAA-MM-JJ. */
function dayBefore(date) {
  return new Date(Date.parse(date + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
}

/** Une version, la marque remplacée par la date, comme `publier` doit l'écrire. */
function dated(waiting, page, date, lang) {
  return waiting
    .split('/' + page + '/jusqu-au-' + MARQUE + '/').join('/' + page + '/jusqu-au-' + date + '/')
    .split(MARQUE).join(said(date, lang));
}

/** Le passage qui annonce la version à venir, et rien d'autre. */
function announcements(html) {
  return html.match(/<!-- a-venir -->[\s\S]*?<!-- \/a-venir -->/g) || [];
}

if (PAGES.length === 0) {
  fail('no page of the site has a version to publish, an upcoming or a dated version: nothing here is exercised');
}

// Une date lointaine, pour qu'aucune version datée du dépôt ne porte déjà son
// adresse, et un changement d'heure : le 30 mars 2031, Paris passe à l'heure
// d'été, et le jour se compte quand même à minuit.
var LATER = '2031-03-30';

// ── 1. Une version qui attend n'est pas servie ───────────────────────────
//
// Sur le dépôt tel qu'il est s'il en tient une, et sur une copie qui en tient
// une à chaque page sinon.
(function () {
  [siteDir, aCopy()].forEach(function (source, n) {
    var label = n === 0 ? 'the repository' : 'a copy holding a version to publish';
    var site = built(source);
    if (site.result.code !== 0) {
      fail(label + ': the site does not build: ' + site.result.err);
      return;
    }
    PAGES.forEach(function (page) {
      var waiting = path.join(source, page, 'a-publier');
      if (!exists(path.join(waiting, 'index.html'))) {
        return;
      }
      if (exists(path.join(site.out, page, 'a-publier'))) {
        fail(label + ': ' + page + '/a-publier/ is built before it is published');
      }
      translationsOf(waiting).forEach(function (lang) {
        if (!exists(path.join(source, page, lang, 'index.html')) &&
            exists(path.join(site.out, page, lang))) {
          fail(label + ': ' + page + '/' + lang + '/ is built before the version it translates is published');
        }
      });
      // La version en vigueur est servie comme avant, à son annonce près :
      // la nouvelle ne change rien au site tant qu'elle attend.
      var inForceSource = read(path.join(source, page, 'index.html'));
      var expected = inForceSource.indexOf(A_VENIR) === -1 ? inForceSource : inForceSource.replace(
        / *<!-- a-venir -->[\s\S]*?<!-- \/a-venir --> *\n?/, '');
      if (read(path.join(site.out, page, 'index.html')) !== expected) {
        fail(label + ': ' + page + ' is not served as the version in force while another waits');
      }
    });
    if (run('grep', ['-rlF', MARQUE, site.out]).code === 0) {
      fail(label + ': a built page carries ' + MARQUE);
    }
  });
})();

// ── 2. Publiée, le jour de Paris, et la version remplacée reste lisible ──
(function () {
  [[LATER, 0, LATER], [LATER, 1, dayBefore(LATER)]].forEach(function (when) {
    var site = aCopy();
    var retentionBefore = withWaitingDurations(site);
    var instant = parisMidnight(when[0], when[1]);
    var date = when[2];
    var before = {};
    PAGES.forEach(function (page) {
      var dir = path.join(site, page);
      before[page] = {
        inForce: read(path.join(dir, 'index.html')),
        waiting: read(path.join(dir, 'a-publier', 'index.html')),
        translations: translationsOf(path.join(dir, 'a-publier')).map(function (lang) {
          return { lang: lang, text: read(path.join(dir, 'a-publier', lang, 'index.html')) };
        }),
        upcoming: exists(path.join(dir, 'a-venir', 'index.html')),
      };
    });

    var published = publishAt(site, instant);
    if (published.code !== 0) {
      fail('publishing at ' + instant + ' was refused: ' + published.err);
      return;
    }

    PAGES.forEach(function (page) {
      var dir = path.join(site, page);
      var was = before[page];
      var inForce = read(path.join(dir, 'index.html'));
      if (exists(path.join(dir, 'a-publier'))) {
        fail(page + '/a-publier/ is still there once published');
      }
      // La nouvelle version, exactement celle qui attendait, datée du jour de
      // Paris où elle est publiée.
      if (inForce !== dated(was.waiting, page, date, 'fr')) {
        fail(page + ' is not the version that waited, dated ' + date + ' (published at ' + instant + ')');
      }
      if (inForce.indexOf('href="/' + page + '/jusqu-au-' + date + '/"') === -1) {
        fail(page + ' does not lead to the version it replaced');
      }
      // Sa traduction, à sa propre adresse, datée de même, en anglais.
      was.translations.forEach(function (translation) {
        var file = path.join(dir, translation.lang, 'index.html');
        if (!exists(file)) {
          fail(page + '/' + translation.lang + '/ is not published with the version it translates');
          return;
        }
        if (read(file) !== dated(translation.text, page, date, translation.lang)) {
          fail(page + '/' + translation.lang + '/ is not the translation that waited, dated ' + date);
        }
      });
      // La version remplacée, lisible à son adresse, qui dit jusqu'à quand.
      var replaced = path.join(dir, 'jusqu-au-' + date, 'index.html');
      if (!exists(replaced)) {
        fail(page + '/jusqu-au-' + date + '/ does not keep the replaced version');
        return;
      }
      var datedVersion = read(replaced);
      var body = function (html) {
        return textOf(html.replace(/<!-- (a-venir|jusqu-au) -->[\s\S]*?<!-- \/(a-venir|jusqu-au) -->/g, '')
          .replace(/<title>[^<]*<\/title>/, ''));
      };
      if (body(datedVersion) !== body(was.inForce)) {
        fail(page + '/jusqu-au-' + date + '/ is not the version that was in force');
      }
      if (datedVersion.indexOf("s'est appliquée jusqu'au " + said(date, 'fr')) === -1 ||
          datedVersion.indexOf('href="/' + page + '/"') === -1) {
        fail(page + '/jusqu-au-' + date + '/ does not say until when, and what replaced it');
      }
      // L'annonce de la version à venir passe dans la nouvelle version, une
      // seule fois, toujours sans date : elle ne peut pas être annoncée tant
      // qu'une version attend.
      var passages = announcements(inForce);
      if (was.upcoming && (passages.length !== 1 ||
          passages[0].indexOf('href="/' + page + '/a-venir/"') === -1 ||
          passages[0].indexOf(A_VENIR) === -1)) {
        fail(page + ' no longer announces its upcoming version once published');
      }
    });

    // Ce que la version publiée dit se vérifie désormais sur la version en
    // vigueur : `retention.json` perd chaque « page » qui nommait une version
    // publiée, et rien d'autre, et reste lisible (#467).
    var expected = JSON.parse(JSON.stringify(retentionBefore));
    Object.keys(expected).forEach(function (key) {
      var entry = expected[key];
      if (entry && typeof entry === 'object' && /^\/[^/]+\/a-publier\/$/.test(entry.page || '')) {
        delete entry.page;
      }
    });
    var retentionAfter = read(path.join(site, '..', 'retention.json'));
    var parsedAfter = null;
    try {
      parsedAfter = JSON.parse(retentionAfter);
    } catch (e) {
      fail('retention.json no longer parses once published: ' + e.message);
    }
    if (parsedAfter !== null && JSON.stringify(parsedAfter) !== JSON.stringify(expected)) {
      fail('retention.json is not what it was without the pages naming a published version');
    }
    if (/"page": "\/[^"]*\/a-publier\/"/.test(retentionAfter)) {
      fail('retention.json still checks a duration at an address under a-publier/ once published');
    }

    var site2 = built(site);
    if (site2.result.code !== 0) {
      fail('the published site does not build: ' + site2.result.err);
      return;
    }
    PAGES.forEach(function (page) {
      var out = path.join(site2.out, page);
      if (!exists(path.join(out, 'jusqu-au-' + date, 'index.html')) || exists(path.join(out, 'a-publier'))) {
        fail(page + ' is not built as published');
      }
      before[page].translations.forEach(function (translation) {
        if (!exists(path.join(out, translation.lang, 'index.html'))) {
          fail(page + '/' + translation.lang + '/ is not built once published');
        }
      });
    });
    if (run('grep', ['-rlF', MARQUE, site2.out]).code === 0) {
      fail('a published page is built with ' + MARQUE + ' still in it');
    }

    // Une seconde publication, sans rien qui attende : refusée.
    if (!refused(publishAt(site, instant))) {
      fail('a second publication was not refused with nothing waiting');
    }
  });
})();

// ── 2 bis. Une page qui n'annonce aucune version à venir ─────────────────
//
// La carte qui dit jusqu'à quand prend d'ordinaire la place de l'annonce ;
// sans annonce, elle se pose sous la date, et la version remplacée le dit
// quand même.
(function () {
  var site = aCopy();
  PAGES.forEach(function (page) {
    var dir = path.join(site, page);
    if (exists(path.join(dir, 'a-venir'))) {
      fs.rmSync(path.join(dir, 'a-venir'), { recursive: true });
    }
    [path.join(dir, 'index.html'), path.join(dir, 'a-publier', 'index.html')].forEach(function (file) {
      fs.writeFileSync(file, read(file).replace(/ *<!-- a-venir -->[\s\S]*?<!-- \/a-venir --> *\n?/, ''));
    });
  });
  var published = publishAt(site, parisMidnight(LATER, 0));
  if (published.code !== 0) {
    fail('a page announcing no upcoming version could not be published: ' + published.err);
    return;
  }
  PAGES.forEach(function (page) {
    var datedVersion = read(path.join(site, page, 'jusqu-au-' + LATER, 'index.html'));
    var stamp = datedVersion.indexOf('<p class="stamp">');
    var card = datedVersion.indexOf("s'est appliquée jusqu'au " + said(LATER, 'fr'));
    if (stamp === -1 || card === -1 || card < stamp) {
      fail(page + '/jusqu-au-' + LATER + '/, which announced nothing, does not say under its date until when it applied');
    }
  });
})();

// ── 3. Une forme qui ne permettrait pas la publication : refusée, et rien d'écrit
(function () {
  var first = PAGES[0];
  var flaws = [
    ['nothing waits at all', function (site) {
      PAGES.forEach(function (page) {
        fs.rmSync(path.join(site, page, 'a-publier'), { recursive: true });
      });
    }],
    ['the stamp does not wait for the date', function (site) {
      var file = path.join(site, first, 'a-publier', 'index.html');
      fs.writeFileSync(file, read(file).replace(/<p class="stamp">[\s\S]*?<\/p>/, '<p class="stamp">Version du 1er janvier 2031</p>'));
    }],
    ['the card does not lead to the replaced version', function (site) {
      var file = path.join(site, first, 'a-publier', 'index.html');
      fs.writeFileSync(file, read(file).split('/' + first + '/jusqu-au-' + MARQUE + '/').join('/' + first + '/'));
    }],
    ['the card that says since when is missing', function (site) {
      var file = path.join(site, first, 'a-publier', 'index.html');
      fs.writeFileSync(file, read(file).replace(/<!-- depuis -->[\s\S]*?<!-- \/depuis -->/, ''));
    }],
    ['the upcoming version is no longer announced', function (site) {
      PAGES.forEach(function (page) {
        if (exists(path.join(site, page, 'a-venir', 'index.html'))) {
          var file = path.join(site, page, 'a-publier', 'index.html');
          fs.writeFileSync(file, read(file).replace(/<!-- a-venir -->[\s\S]*?<!-- \/a-venir -->/, ''));
        }
      });
    }],
    ['the replaced version already has its dated address', function (site) {
      PAGES.forEach(function (page) {
        fs.mkdirSync(path.join(site, page, 'jusqu-au-' + LATER));
        fs.writeFileSync(path.join(site, page, 'jusqu-au-' + LATER, 'index.html'), '<p>déjà là</p>');
      });
    }],
    ['the version in force keeps a translation nothing would date', function (site) {
      PAGES.forEach(function (page) {
        fs.mkdirSync(path.join(site, page, 'en'));
        fs.writeFileSync(path.join(site, page, 'en', 'index.html'), '<html lang="en"><p>An earlier translation.</p></html>');
      });
    }],
    // Les durées ne pourraient pas suivre, et une durée nouvelle resterait
    // vérifiée à une adresse que la publication fait disparaître.
    ['retention.json is missing beside the site', function (site) {
      withWaitingDurations(site);
      fs.rmSync(path.join(site, '..', 'retention.json'));
    }],
  ];
  var sample = aCopy();
  var translated = PAGES.filter(function (page) {
    return translationsOf(path.join(sample, page, 'a-publier')).length > 0;
  });
  if (translated.length === 0) {
    fail('no version to publish carries a translation: the English page is exercised nowhere');
  }
  translated.forEach(function (page) {
    var english = function (site) { return path.join(site, page, 'a-publier', 'en', 'index.html'); };
    flaws.push(
      ['the translation does not say which text is authoritative (' + page + ')', function (site) {
        fs.writeFileSync(english(site), read(english(site)).split('href="/' + page + '/"').join('href="/"'));
      }],
      ['the translation calls itself another language (' + page + ')', function (site) {
        fs.writeFileSync(english(site), read(english(site)).replace('<html lang="en">', '<html lang="fr">'));
      }],
      ['the translation does not wait for the date (' + page + ')', function (site) {
        fs.writeFileSync(english(site), read(english(site)).split(MARQUE).join('30 March 2031'));
      }],
      ['the French text does not lead to its translation (' + page + ')', function (site) {
        var file = path.join(site, page, 'a-publier', 'index.html');
        fs.writeFileSync(file, read(file).split('href="/' + page + '/en/"').join('href="/' + page + '/"'));
      }]);
  });
  flaws.forEach(function (flaw) {
    var site = aCopy();
    flaw[1](site);
    var untouched = snapshot(site);
    if (!refused(publishAt(site, parisMidnight(LATER, 0)))) {
      fail('a version to publish where ' + flaw[0] + ' was not refused');
    }
    if (snapshot(site) !== untouched) {
      fail('a refused publication (' + flaw[0] + ') wrote into the site');
    }
  });
})();

// ── 4. Deux changements sur une page : cette page attend, et elle seule ──
//
// Tant qu'une version attend d'être publiée, la version à venir de la même
// page est écrite par-dessus elle ; une fois publiée avec sa traduction, la
// version à venir n'a pas la sienne. Dans les deux cas cette page attend, le
// geste dit ce qui lui manque, et les autres pages avancent : la politique de
// confidentialité ne se voit pas retenue par les conditions générales.
(function () {
  var upcoming = PAGES.filter(function (page) {
    return exists(path.join(siteDir, page, 'a-venir', 'index.html'));
  });
  if (upcoming.length === 0) {
    return;
  }
  var soon = new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 10);

  function both(site, page) {
    return read(path.join(site, page, 'a-venir', 'index.html')) + read(path.join(site, page, 'index.html'));
  }

  /**
   * Annonce, puis vérifie que chaque page que `waits` retient est nommée avec
   * ce qui lui manque (`lacks`), ses deux pages inchangées, et que chaque
   * autre page est annoncée à côté d'elle.
   */
  function announceBeside(site, waits, lacks, label) {
    var before = {};
    upcoming.forEach(function (page) { before[page] = both(site, page); });
    var free = upcoming.filter(function (page) { return !waits(page); });
    var result = run('node', [tool, 'annoncer', soon, site]);
    if (free.length === 0 ? !refused(result) : result.code !== 0) {
      fail(label + ': the announcement ' + (free.length === 0 ? 'with every page waiting was not refused' : 'of the pages that wait for nothing failed') + ': ' + result.out + result.err);
    }
    upcoming.forEach(function (page) {
      if (!waits(page)) {
        if (both(site, page).indexOf(said(soon, 'fr')) === -1) {
          fail(label + ': ' + page + ', which waits for nothing, was not announced beside the page that waits');
        }
        return;
      }
      if (both(site, page) !== before[page]) {
        fail(label + ': ' + page + ', which waits, was written into');
      }
      if (result.err.indexOf('/' + page + '/a-venir/ attend') === -1 || !lacks.test(result.err)) {
        fail(label + ': the announcement does not say what ' + page + ' waits for: ' + result.err);
      }
    });
    return free;
  }

  // Une version qui attend d'être publiée sur une page, et sur elle seule :
  // celle du dépôt s'il en tient une, une préparée sinon ; les autres pages
  // n'en ont pas, pour qu'il y ait de quoi annoncer à côté.
  var waiting = aPlainCopy();
  var holder = upcoming.filter(function (page) {
    return exists(path.join(waiting, page, 'a-publier', 'index.html'));
  })[0] || upcoming[0];
  upcoming.forEach(function (page) {
    var dir = path.join(waiting, page, 'a-publier');
    if (page === holder && !exists(dir)) {
      prepare(waiting, page);
    } else if (page !== holder && exists(dir)) {
      fs.rmSync(dir, { recursive: true });
    }
  });
  announceBeside(waiting, function (page) { return page === holder; }, /publi/, 'a version waiting to be published');

  // Une fois publiée avec sa traduction : la page traduite attend sa
  // traduction, les autres s'annoncent.
  var site = aCopy();
  publishAt(site, parisMidnight(LATER, 0));
  var translated = function (page) { return translationsOf(path.join(site, page)).length > 0; };
  var free = announceBeside(site, translated, /traduction/, 'a published translation');

  // Et le jour venu, la page traduite, datée à la main comme l'aurait fait une
  // annonce plus ancienne, attend encore ; les autres s'appliquent.
  upcoming.filter(translated).forEach(function (page) {
    [path.join(site, page, 'a-venir', 'index.html'), path.join(site, page, 'index.html')].forEach(function (file) {
      fs.writeFileSync(file, read(file).split(A_VENIR).join(said(soon, 'fr')));
    });
  });
  var held = {};
  upcoming.filter(translated).forEach(function (page) { held[page] = both(site, page); });
  var applied = applyAt(site, parisMidnight(soon, 0));
  if (free.length === 0 ? !refused(applied) : applied.code !== 0) {
    fail('applying beside a translated page ' + (free.length === 0 ? 'was not refused with every page waiting' : 'failed') + ': ' + applied.out + applied.err);
  }
  upcoming.forEach(function (page) {
    var hasDatedVersion = exists(path.join(site, page, 'jusqu-au-' + soon, 'index.html'));
    if (!translated(page)) {
      if (!hasDatedVersion) {
        fail(page + ', which waits for nothing, was not applied beside a translated page');
      }
      return;
    }
    if (hasDatedVersion || both(site, page) !== held[page]) {
      fail(page + ', translated, was applied without a translation of its upcoming version');
    }
    if (applied.err.indexOf('/' + page + '/a-venir/ attend') === -1 || !/traduction/.test(applied.err)) {
      fail('the application does not say what ' + page + ' waits for: ' + applied.err);
    }
  });
})();

// ── 5. La construction ne laisse aucune marque ───────────────────────────
(function () {
  var site = aCopy();
  var page = path.join(site, 'aide', 'index.html');
  fs.writeFileSync(page, read(page).replace('</main>', '<p>' + MARQUE + '</p></main>'));
  if (built(site).result.code === 0) {
    fail('a site with ' + MARQUE + ' outside a version to publish was built');
  }
})();

// ── 6. Le geste tel que le porteur le lance, aujourd'hui à Paris ─────────
(function () {
  var site = aCopy();
  var today = todayInParis();
  var taken = PAGES.some(function (page) {
    return exists(path.join(site, page, 'jusqu-au-' + today));
  });
  var link = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'a-publier-lien-')), 'version-a-venir.mjs');
  fs.symlinkSync(tool, link);
  var published = run('node', [link, 'publier', site]);
  if (taken) {
    // Le jour même d'une publication du dépôt : l'adresse datée existe, et
    // une seconde publication ce jour-là est refusée plutôt que d'écraser.
    if (!refused(published)) {
      fail('publishing again on ' + today + ', whose dated address exists, was not refused');
    }
    return;
  }
  if (published.code !== 0) {
    fail('publishing today from the command line was refused: ' + published.err);
    return;
  }
  PAGES.forEach(function (page) {
    if (!exists(path.join(site, page, 'jusqu-au-' + today, 'index.html')) ||
        read(path.join(site, page, 'index.html')).indexOf(said(today, 'fr')) === -1) {
      fail(page + ' published from the command line is not dated today in Paris, ' + today);
    }
  });
  if (published.out.indexOf(today) === -1 && published.out.indexOf(said(today, 'fr').replace(/<[^>]+>/g, '')) === -1) {
    fail('the command line does not say which date it wrote: ' + published.out);
  }
})();

if (status === 0) {
  console.log('version-a-publier: a version to publish is served from the day it is published, dated that day in Paris, with its translation, the one it replaces stays readable, and the durations it states are checked on it from then on');
}
process.exit(status);
