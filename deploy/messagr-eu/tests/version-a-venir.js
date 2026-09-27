// LA VERSION À VENIR DES PAGES LÉGALES NE PARAÎT QU'UNE FOIS ANNONCÉE, ET NE
// S'APPLIQUE QUE LE JOUR DIT (#412), MESURÉ SUR LE SITE CONSTRUIT.
//
// La politique promet qu'un changement est annoncé avant d'être appliqué, et
// #392 a fixé ce délai à trente jours. La version à venir attend donc dans le
// dépôt, sous `a-venir/`, avec une marque à la place de la date que le
// porteur fixera. Les façons de rater, et chacune est tenue ici :
//
//   1. Publier trop tôt : un déploiement fait pour autre chose servirait une
//      page qui s'appliquera « le MESSAGR-DATE-A-VENIR », ou annoncerait une
//      version sans date. `build-site.sh` ne construit pas une page qui porte
//      la marque, et retire de la version en vigueur le passage qui
//      l'annonce. Avant l'annonce, le site construit est celui d'aujourd'hui.
//   2. Annoncer mal : une date à moins de trente jours, mal écrite, avancée
//      après coup, ou une marque oubliée quelque part. `version-a-venir.mjs`
//      refuse les trois premières, et `build-site.sh` la dernière.
//   3. Appliquer mal : avant le jour, ou en perdant la version remplacée,
//      qui reste lisible à son adresse datée (décision du porteur du 27
//      septembre 2026), ou en laissant `retention.json` vérifier les durées
//      à une adresse qui n'existe plus.
//   4. Dire moins que la configuration : la version à venir remplacera la
//      version en vigueur, et doit dire chaque durée que `retention.json`
//      déclare.
//
// LE TEST CONDUIT LES VRAIS SCRIPTS sur une copie du site, comme
// destinations-page-invitation.js conduit build-site.sh, et il mène le cycle
// deux fois : une version appliquée laisse le site dans l'état où la suivante
// commence. Quand le dépôt ne tient aucune version à venir, entre deux cycles,
// la copie en reçoit une, préparée comme `LISEZ-MOI-pages-legales.md` le dit.
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
var MARQUE = 'MESSAGR-DATE-A-VENIR';
var PAGES = ['confidentialite', 'conditions-generales'];
var status = 0;

function fail(message) {
  console.error('version-a-venir: FAIL: ' + message);
  status = 1;
}

function run(file, args) {
  try {
    var stdout = child.execFileSync(file, args, {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out: stdout, err: '' };
  } catch (e) {
    return {
      code: e.status === undefined || e.status === null ? -1 : e.status,
      out: String(e.stdout || ''),
      err: String(e.stderr || '') + String(e.message || ''),
    };
  }
}

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function exists(file) {
  return fs.existsSync(file);
}

/** AAAA-MM-JJ, `days` jours après aujourd'hui à Paris. */
function inDays(days) {
  var today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  var at = new Date(Date.parse(today + 'T00:00:00Z') + days * 86400000);
  return at.toISOString().slice(0, 10);
}

var MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet',
  'août', 'septembre', 'octobre', 'novembre', 'décembre'];
function enFrancais(date) {
  var parts = date.split('-').map(Number);
  return (parts[2] === 1 ? '1er' : String(parts[2])) + ' ' + MOIS[parts[1] - 1] + ' ' + parts[0];
}
function said(date) {
  return '<time datetime="' + date + '">' + enFrancais(date) + '</time>';
}

/** Le texte d'une page, sans balises ni commentaires, comme on le lit. */
function textOf(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');
}

/**
 * Une version à venir préparée comme LISEZ-MOI-pages-legales.md le dit,
 * quand le dépôt n'en tient aucune : la version en vigueur recopiée, « à
 * venir » dans son titre et en tête, la marque à la place de la date, un
 * passage `a-venir` de chaque côté.
 */
function prepare(site, page) {
  var inForcePath = path.join(site, page, 'index.html');
  var inForce = read(inForcePath);
  var upcoming = inForce
    .replace(/<!-- depuis -->[\s\S]*?<!-- \/depuis -->/, '')
    .replace(/<title>([^<]*?) — Messagr<\/title>/, '<title>$1 à venir — Messagr</title>')
    .replace(/<h1>([^<]*?)<\/h1>/, '<h1>$1 à venir</h1>')
    .replace(/<p class="stamp">[\s\S]*?<\/p>/,
      '<p class="stamp">Version applicable le ' + MARQUE + '</p>\n' +
      '      <div class="card">\n' +
      '        <!-- a-venir -->\n' +
      '        <p><b>Cette version s\'appliquera le ' + MARQUE + '.</b>\n' +
      '        <a href="/' + page + '/">La version en vigueur.</a></p>\n' +
      '        <p>Ce qui change&nbsp;:</p>\n' +
      '        <!-- /a-venir -->\n' +
      '        <ul><li>une version préparée par ce test.</li></ul>\n' +
      '      </div>');
  fs.mkdirSync(path.join(site, page, 'a-venir'));
  fs.writeFileSync(path.join(site, page, 'a-venir', 'index.html'), upcoming);
  fs.writeFileSync(inForcePath, inForce.replace(/(<p class="stamp">[\s\S]*?<\/p>)/,
    '$1\n      <!-- a-venir -->\n' +
    '      <div class="card"><p><b>Une nouvelle version s\'appliquera le ' + MARQUE + '.</b>\n' +
    '      <a href="/' + page + '/a-venir/">La lire.</a></p></div>\n' +
    '      <!-- /a-venir -->'));
}

/** Une copie du site et de retention.json, chaque page avec sa version à venir. */
function aCopy() {
  var copy = fs.mkdtempSync(path.join(os.tmpdir(), 'a-venir-source-'));
  var site = path.join(copy, 'site');
  fs.mkdirSync(site);
  child.execFileSync('cp', ['-R', siteDir + '/.', site]);
  child.execFileSync('cp', [retentionFile, path.join(copy, 'retention.json')]);
  PAGES.forEach(function (page) {
    if (!exists(path.join(site, page, 'a-venir', 'index.html'))) {
      prepare(site, page);
    }
  });
  return { site: site, retention: path.join(copy, 'retention.json') };
}

function built(source) {
  var out = fs.mkdtempSync(path.join(os.tmpdir(), 'a-venir-site-'));
  var result = run(build, [source, out]);
  return { result: result, out: out };
}

function gesture(args) {
  return run('node', [tool].concat(args));
}

/** `appliquer` à l'instant donné, que la ligne de commande ne permet pas de choisir. */
function applyAt(copy, instant) {
  return run('node', ['--input-type=module', '-e',
    'import { appliquer } from ' + JSON.stringify(tool) + ';\n' +
    'appliquer(' + JSON.stringify(copy.site) + ', ' + JSON.stringify(copy.retention) +
    ', new Date(' + JSON.stringify(instant) + '));']);
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

// ── 1. Le dépôt, tel qu'il est ───────────────────────────────────────────
(function () {
  var site = built(siteDir);
  if (site.result.code !== 0) {
    fail('the committed site does not build: ' + site.result.err);
    return;
  }
  PAGES.forEach(function (page) {
    var upcoming = path.join(siteDir, page, 'a-venir', 'index.html');
    var source = read(path.join(siteDir, page, 'index.html'));
    var served = read(path.join(site.out, page, 'index.html'));
    if (!exists(upcoming)) {
      if (source.indexOf('<!-- a-venir -->') !== -1) {
        fail(page + ' announces an upcoming version the repository does not hold');
      }
      return;
    }
    if (read(upcoming).indexOf(MARQUE) === -1) {
      if (!exists(path.join(site.out, page, 'a-venir', 'index.html'))) {
        fail(page + '/a-venir/ is announced and not built');
      }
      return;
    }
    if (exists(path.join(site.out, page, 'a-venir'))) {
      fail(page + '/a-venir/ is built before it is announced');
    }
    if (served.indexOf(MARQUE) !== -1) {
      fail(page + ' is built with the mark in it');
    }
    if (served.indexOf('/' + page + '/a-venir/') !== -1) {
      fail(page + ' announces an upcoming version nobody has dated');
    }
    // Rien d'autre ne change : la page servie est la source, sans le passage.
    var withoutPassage = source.replace(
      / {6}<!-- a-venir -->\n[\s\S]*? {6}<!-- \/a-venir -->\n/, '');
    if (served !== withoutPassage) {
      fail(page + ' is built with more than its announcement taken out');
    }
  });

  // Les durées : chaque « page » nomme une version à venir que le dépôt
  // tient, et la version à venir de la politique dit chaque durée déclarée,
  // puisqu'elle deviendra la politique.
  var retention = JSON.parse(read(retentionFile));
  var policy = path.join(siteDir, 'confidentialite', 'a-venir', 'index.html');
  var upcomingText = exists(policy) ? textOf(read(policy)) : null;
  Object.keys(retention).forEach(function (key) {
    var entry = retention[key];
    if (!entry || typeof entry !== 'object') {
      return;
    }
    if (entry.page !== undefined &&
        !exists(path.join(siteDir, entry.page.replace(/^\//, ''), 'index.html'))) {
      fail('retention.json checks ' + key + ' at ' + entry.page + ', which the repository does not hold');
    }
    if (upcomingText === null) {
      return;
    }
    (entry.duree === undefined ? [] : [entry.duree]).concat(entry.dit || []).forEach(function (phrase) {
      if (upcomingText.indexOf(phrase) === -1) {
        fail('the upcoming policy never says "' + phrase + '" (' + key + ')');
      }
    });
  });
})();

// ── 2. Une fois annoncée, les deux versions, avec la date ────────────────
(function () {
  var copy = aCopy();
  var date = inDays(40);
  var announced = gesture(['annoncer', date, copy.site]);
  if (announced.code !== 0) {
    fail('announcing ' + date + ' was refused: ' + announced.err);
    return;
  }
  var site = built(copy.site);
  if (site.result.code !== 0) {
    fail('the announced site does not build: ' + site.result.err);
    return;
  }
  PAGES.forEach(function (page) {
    var upcoming = path.join(site.out, page, 'a-venir', 'index.html');
    if (!exists(upcoming)) {
      fail(page + '/a-venir/ is not built once announced');
      return;
    }
    var text = read(upcoming);
    if (text.indexOf("s'appliquera le " + said(date)) === -1) {
      fail(page + '/a-venir/ does not say when it applies: ' + said(date));
    }
    if (text.indexOf('href="/' + page + '/"') === -1) {
      fail(page + '/a-venir/ does not lead to the version in force');
    }
    if (text.indexOf('Ce qui change') === -1) {
      fail(page + '/a-venir/ does not list what changes');
    }
    var inForce = read(path.join(site.out, page, 'index.html'));
    if (inForce.indexOf('href="/' + page + '/a-venir/"') === -1) {
      fail(page + ' does not announce its upcoming version once dated');
    }
    if (inForce.indexOf(said(date)) === -1) {
      fail(page + ' announces its upcoming version without its date');
    }
  });
})();

// ── 3. Trente jours au moins, une date du calendrier, et une fois ────────
(function () {
  var copy = aCopy();
  [
    [inDays(29), 'twenty-nine days is less than the notice promised'],
    ['2026-02-30', 'the thirtieth of February'],
    ['1/11/2026', 'a date not written AAAA-MM-JJ'],
    ['', 'no date at all'],
  ].forEach(function (refused) {
    if (gesture(['annoncer', refused[0], copy.site]).code === 0) {
      fail('announcing ' + JSON.stringify(refused[0]) + ' was accepted: ' + refused[1]);
    }
  });
  PAGES.forEach(function (page) {
    if (read(path.join(copy.site, page, 'a-venir', 'index.html')).indexOf(MARQUE) === -1) {
      fail('a refused announcement wrote into ' + page + '/a-venir/');
    }
  });

  // Une version en vigueur qui ne l'annoncerait pas : refusée, et rien d'écrit.
  var bare = aCopy();
  var inForce = path.join(bare.site, 'conditions-generales', 'index.html');
  fs.writeFileSync(inForce, read(inForce).replace(/<!-- a-venir -->[\s\S]*?<!-- \/a-venir -->/, ''));
  if (gesture(['annoncer', inDays(40), bare.site]).code === 0) {
    fail('an upcoming version the version in force does not announce was announced');
  }
  if (read(path.join(bare.site, 'confidentialite', 'a-venir', 'index.html')).indexOf(MARQUE) === -1) {
    fail('a refused announcement wrote into the other page');
  }

  if (gesture(['annoncer', inDays(30), copy.site]).code !== 0) {
    fail('thirty days exactly, the notice promised, was refused');
  }
  if (gesture(['annoncer', inDays(31), copy.site]).code === 0) {
    fail('a second announcement was accepted with nothing left to date');
  }
})();

// ── 4. Une marque oubliée ailleurs arrête la construction ────────────────
(function () {
  var copy = aCopy();
  var page = path.join(copy.site, 'aide', 'index.html');
  fs.writeFileSync(page, read(page).replace('</main>', '<p>' + MARQUE + '</p></main>'));
  if (built(copy.site).result.code === 0) {
    fail('a site still carrying the mark was built');
  }
})();

// ── 5. Une date annoncée recule, et n'avance pas ─────────────────────────
(function () {
  var copy = aCopy();
  if (gesture(['reporter', inDays(50), copy.site]).code === 0) {
    fail('a version nobody announced was postponed');
  }
  var first = inDays(40);
  gesture(['annoncer', first, copy.site]);
  [first, inDays(39)].forEach(function (earlier) {
    if (gesture(['reporter', earlier, copy.site]).code === 0) {
      fail('an announced date moved from ' + first + ' to ' + earlier);
    }
  });
  var later = inDays(47);
  var postponed = gesture(['reporter', later, copy.site]);
  if (postponed.code !== 0) {
    fail('postponing to ' + later + ' was refused: ' + postponed.err);
    return;
  }
  PAGES.forEach(function (page) {
    [path.join(page, 'a-venir', 'index.html'), path.join(page, 'index.html')].forEach(function (file) {
      var text = read(path.join(copy.site, file));
      if (text.indexOf(said(later)) === -1 || text.indexOf(first) !== -1) {
        fail(file + ' does not carry the postponed date alone');
      }
    });
  });
})();

// ── 6. Le jour venu, et deux fois de suite ───────────────────────────────
(function () {
  var copy = aCopy();
  var before = {};
  PAGES.forEach(function (page) {
    before[page] = read(path.join(copy.site, page, 'index.html'));
  });
  var retentionBefore = JSON.parse(read(copy.retention));

  [inDays(40), inDays(80)].forEach(function (date, cycle) {
    if (cycle === 1) {
      PAGES.forEach(function (page) {
        before[page] = read(path.join(copy.site, page, 'index.html'));
        prepare(copy.site, page);
      });
    }
    var upcoming = {};
    gesture(['annoncer', date, copy.site]);
    PAGES.forEach(function (page) {
      upcoming[page] = read(path.join(copy.site, page, 'a-venir', 'index.html'));
    });

    if (gesture(['appliquer', copy.site]).code === 0) {
      fail('cycle ' + (cycle + 1) + ': applied today, before ' + date);
    }
    if (applyAt(copy, parisMidnight(date, 1)).code === 0) {
      fail('cycle ' + (cycle + 1) + ': applied at 23:59 in Paris, the evening before ' + date);
    }
    var applied = applyAt(copy, parisMidnight(date, 0));
    if (applied.code !== 0) {
      fail('cycle ' + (cycle + 1) + ': applying on ' + date + ' was refused: ' + applied.err);
      return;
    }

    PAGES.forEach(function (page) {
      var dated = path.join(copy.site, page, 'jusqu-au-' + date, 'index.html');
      var inForce = read(path.join(copy.site, page, 'index.html'));
      if (exists(path.join(copy.site, page, 'a-venir'))) {
        fail(page + '/a-venir/ is still there once applied');
      }
      // La version remplacée, lisible à son adresse, qui dit jusqu'à quand.
      if (!exists(dated)) {
        fail(page + '/jusqu-au-' + date + '/ does not keep the replaced version');
      } else {
        var archived = read(dated);
        var body = function (html) {
          return textOf(html.replace(/<!-- (a-venir|jusqu-au) -->[\s\S]*?<!-- \/(a-venir|jusqu-au) -->/, '')
            .replace(/<title>[^<]*<\/title>/, ''));
        };
        if (body(archived) !== body(before[page])) {
          fail(page + '/jusqu-au-' + date + '/ is not the version that was in force');
        }
        if (archived.indexOf("s'est appliquée jusqu'au " + said(date)) === -1 ||
            archived.indexOf('href="/' + page + '/"') === -1) {
          fail(page + '/jusqu-au-' + date + '/ does not say until when, and what replaced it');
        }
      }
      // La version à venir, en vigueur, qui renvoie à celle qu'elle remplace.
      if (inForce.indexOf('href="/' + page + '/jusqu-au-' + date + '/"') === -1 ||
          inForce.indexOf("s'applique depuis le " + said(date)) === -1) {
        fail(page + ' does not say since when it applies, and what it replaced');
      }
      if (/<title>[^<]*à venir|<h1>[^<]*à venir|Version applicable le /.test(inForce)) {
        fail(page + ' still calls itself upcoming');
      }
      var withoutHeader = function (html) {
        return textOf(html.replace(/<!-- (a-venir|depuis) -->[\s\S]*?<!-- \/(a-venir|depuis) -->/, '')
          .replace(/<title>[^<]*<\/title>/, '').replace(/<h1>[^<]*<\/h1>/, '')
          .replace(/<p class="stamp">[\s\S]*?<\/p>/, ''));
      };
      if (withoutHeader(inForce) !== withoutHeader(upcoming[page])) {
        fail(page + ' is not the version that was upcoming');
      }
    });

    // Les durées se vérifient désormais sur la politique en vigueur.
    var retention = JSON.parse(read(copy.retention));
    Object.keys(retentionBefore).forEach(function (key) {
      var was = retentionBefore[key];
      var now = retention[key];
      if (was && typeof was === 'object') {
        var expected = JSON.parse(JSON.stringify(was));
        delete expected.page;
        if (JSON.stringify(now) !== JSON.stringify(expected)) {
          fail('retention.json ' + key + ' is not what it was without its page');
        }
      }
    });

    var site = built(copy.site);
    if (site.result.code !== 0) {
      fail('cycle ' + (cycle + 1) + ': the applied site does not build: ' + site.result.err);
      return;
    }
    PAGES.forEach(function (page) {
      if (!exists(path.join(site.out, page, 'jusqu-au-' + date, 'index.html')) ||
          exists(path.join(site.out, page, 'a-venir'))) {
        fail('cycle ' + (cycle + 1) + ': ' + page + ' is not built as applied');
      }
    });
    if (applyAt(copy, parisMidnight(date, -60)).code === 0) {
      fail('cycle ' + (cycle + 1) + ': a second application was accepted with nothing upcoming');
    }
  });
})();

if (status === 0) {
  console.log('version-a-venir: nothing upcoming is served before it is dated, both versions are once it is, and the replaced one stays readable once applied');
}
process.exit(status);
