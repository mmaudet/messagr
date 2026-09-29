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
//      après coup, écrite dans une page et pas dans l'autre, ou une marque
//      oubliée quelque part. `version-a-venir.mjs` refuse les premières, et
//      `build-site.sh` la dernière. Et le préavis se mesure de nouveau le
//      jour où la page est servie pour la première fois.
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
// commence.
//
// IL TIENT DANS LES TROIS ÉTATS DU DÉPÔT, puisque l'intégration continue le
// lance à chaque changement : une version qui attend sa date, une version
// annoncée, et aucune version à venir, entre deux cycles. La copie est
// ramenée au premier état avant chaque scénario : une version annoncée y
// reprend la marque, et une page qui n'en a pas en reçoit une, préparée comme
// `LISEZ-MOI-pages-legales.md` le dit. Les pages sont trouvées par leur forme
// (une version à venir, ou une version datée), comme `build-site.sh` et
// `version-a-venir.mjs` les trouvent. Depuis #466, le dépôt peut aussi tenir
// une version qui attend d'être publiée, et une traduction une fois qu'elle
// l'est : `aCopy` dit ce qu'il en fait, et version-a-publier.js le reste.
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

/** Les pages légales du site : celles qui ont une version à venir, ou datée. */
function legalPages(site) {
  return fs.readdirSync(site).filter(function (name) {
    var dir = path.join(site, name);
    return fs.statSync(dir).isDirectory() &&
      (exists(path.join(dir, 'a-venir', 'index.html')) ||
       fs.readdirSync(dir).some(function (entry) { return /^jusqu-au-/.test(entry); }));
  }).sort();
}
var PAGES = legalPages(siteDir);

/**
 * Une version à venir préparée comme LISEZ-MOI-pages-legales.md le dit,
 * quand le dépôt n'en tient aucune : la version en vigueur recopiée, sans sa
 * carte « depuis », « à venir » dans son titre et en tête, la marque à la
 * place de la date, un passage `a-venir` de chaque côté.
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

/** Une version annoncée qui reprend la marque, dans ses deux pages. */
function unannounce(site, page) {
  var upcoming = path.join(site, page, 'a-venir', 'index.html');
  var dated = /<time datetime="(\d{4}-\d{2}-\d{2})">/.exec(read(upcoming));
  if (read(upcoming).indexOf(MARQUE) !== -1 || dated === null) {
    return;
  }
  [upcoming, path.join(site, page, 'index.html')].forEach(function (file) {
    fs.writeFileSync(file, read(file).split(said(dated[1])).join(MARQUE));
  });
}

/**
 * Une copie du site et de retention.json, chaque page avec sa version à venir
 * non annoncée.
 *
 * DEUX CHOSES EN SONT ÉCARTÉES, ET CE N'EST PAS UNE COMMODITÉ (#466). Une
 * version qui attend dans `a-publier/` y est publiée d'abord : la version à
 * venir est écrite par-dessus elle, et les trois gestes refusent de
 * l'annoncer avant. Puis la traduction que cette publication pose est
 * retirée : une version à venir n'en porte pas encore, et les trois gestes
 * refusent une page traduite, qu'ils laisseraient traduire une version
 * remplacée. version-a-publier.js tient ces deux refus sur le dépôt tel qu'il
 * est ; ici, c'est le cycle de la version à venir qui est mené, en français,
 * par-dessus la version publiée.
 */
function aCopy() {
  var copy = fs.mkdtempSync(path.join(os.tmpdir(), 'a-venir-source-'));
  var site = path.join(copy, 'site');
  fs.mkdirSync(site);
  child.execFileSync('cp', ['-R', siteDir + '/.', site]);
  child.execFileSync('cp', [retentionFile, path.join(copy, 'retention.json')]);
  if (PAGES.some(function (page) { return exists(path.join(site, page, 'a-publier', 'index.html')); })) {
    var published = run('node', [tool, 'publier', site]);
    if (published.code !== 0) {
      throw new Error('the copy could not publish the version waiting in a-publier/: ' + published.err);
    }
  }
  PAGES.forEach(function (page) {
    fs.readdirSync(path.join(site, page)).filter(function (name) {
      return /^[a-z]{2}$/.test(name);
    }).forEach(function (translation) {
      fs.rmSync(path.join(site, page, translation), { recursive: true });
    });
  });
  PAGES.forEach(function (page) {
    if (exists(path.join(site, page, 'a-venir', 'index.html'))) {
      unannounce(site, page);
    } else {
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

/** Refusé par le geste, et non tombé en cours de route. */
function refused(result) {
  return result.code !== 0 && /REFUS|Refus \[Error\]/.test(result.err);
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

if (PAGES.length === 0) {
  fail('no page of the site has an upcoming or a dated version: nothing here is exercised');
}

// ── 1. Le dépôt, tel qu'il est, et chaque état qu'il peut prendre ──────
//
// Rejoué plus bas sur des copies : annoncée, appliquée, et préparée de
// nouveau après une application. Le dépôt passera par chacun.
function checkState(source, retentionPath, label) {
  var site = built(source);
  if (site.result.code !== 0) {
    fail(label + ': the site does not build: ' + site.result.err);
    return;
  }
  PAGES.forEach(function (page) {
    var upcoming = path.join(source, page, 'a-venir', 'index.html');
    var inForce = read(path.join(source, page, 'index.html'));
    var served = read(path.join(site.out, page, 'index.html'));
    var announces = 'href="/' + page + '/a-venir/"';
    if (!exists(upcoming)) {
      if (inForce.indexOf('<!-- a-venir -->') !== -1) {
        fail(label + ': ' + page + ' announces an upcoming version the site does not hold');
      }
      return;
    }
    if (read(upcoming).indexOf(MARQUE) === -1) {
      if (!exists(path.join(site.out, page, 'a-venir', 'index.html')) ||
          served.indexOf(announces) === -1) {
        fail(label + ': ' + page + '/a-venir/ is announced and not built, or not announced by ' + page);
      }
      return;
    }
    if (exists(path.join(site.out, page, 'a-venir'))) {
      fail(label + ': ' + page + '/a-venir/ is built before it is announced');
    }
    if (served.indexOf(MARQUE) !== -1) {
      fail(label + ': ' + page + ' is built with the mark in it');
    }
    if (served.indexOf(announces) !== -1) {
      fail(label + ': ' + page + ' announces an upcoming version nobody has dated');
    }
    // Rien d'autre ne change : la page servie est la source, sans le passage.
    var withoutPassage = inForce.replace(
      / {6}<!-- a-venir -->\n[\s\S]*? {6}<!-- \/a-venir -->\n/, '');
    if (served !== withoutPassage) {
      fail(label + ': ' + page + ' is built with more than its announcement taken out');
    }
  });

  // Les durées : chaque « page » nomme une version à venir que le site
  // tient, et la version à venir de la politique dit chaque durée déclarée,
  // puisqu'elle deviendra la politique.
  var retention = JSON.parse(read(retentionPath));
  var policy = path.join(source, 'confidentialite', 'a-venir', 'index.html');
  var upcomingText = exists(policy) ? textOf(read(policy)) : null;
  Object.keys(retention).forEach(function (key) {
    var entry = retention[key];
    if (!entry || typeof entry !== 'object') {
      return;
    }
    if (entry.page !== undefined &&
        !exists(path.join(source, entry.page.replace(/^\//, ''), 'index.html'))) {
      fail(label + ': retention.json checks ' + key + ' at ' + entry.page + ', which the site does not hold');
    }
    if (upcomingText === null) {
      return;
    }
    (entry.duree === undefined ? [] : [entry.duree]).concat(entry.dit || []).forEach(function (phrase) {
      if (upcomingText.indexOf(phrase) === -1) {
        fail(label + ': the upcoming policy never says "' + phrase + '" (' + key + ')');
      }
    });
  });
}
checkState(siteDir, retentionFile, 'the repository');

// ── 2. Une fois annoncée, les deux versions, avec la date ────────────────
(function () {
  var copy = aCopy();
  var date = inDays(40);
  var announced = gesture(['annoncer', date, copy.site]);
  if (announced.code !== 0) {
    fail('announcing ' + date + ' was refused: ' + announced.err);
    return;
  }
  checkState(copy.site, copy.retention, 'an announced copy');
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
    // Le préavis se mesure de nouveau le jour où la page est servie.
    var notice = gesture(['preavis', upcoming]);
    if (notice.code !== 0 || notice.out.indexOf('40 jours') === -1) {
      fail(page + '/a-venir/ served today should give forty days of notice: ' + notice.out + notice.err);
    }
    [[29, false], [30, true]].forEach(function (days) {
      var late = path.join(site.out, page, 'a-venir', 'tard.html');
      fs.writeFileSync(late, text.split(date).join(inDays(days[0])));
      var measured = gesture(['preavis', late]);
      if (days[1] ? measured.code !== 0 : !refused(measured)) {
        fail(page + '/a-venir/ served ' + days[0] + ' days before it applies was ' +
          (days[1] ? 'refused' : 'let through'));
      }
    });
    ['2026-11-1', '', date.slice(0, 8) + '32'].forEach(function (bad) {
      var wrong = path.join(site.out, page, 'a-venir', 'mal-datee.html');
      fs.writeFileSync(wrong, text.split(date).join(bad));
      if (!refused(gesture(['preavis', wrong]))) {
        fail(page + '/a-venir/ dated "' + bad + '" was let through by the notice');
      }
    });
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
  ].forEach(function (wrong) {
    if (!refused(gesture(['annoncer', wrong[0], copy.site]))) {
      fail('announcing ' + JSON.stringify(wrong[0]) + ' was not refused: ' + wrong[1]);
    }
  });
  PAGES.forEach(function (page) {
    if (read(path.join(copy.site, page, 'a-venir', 'index.html')).indexOf(MARQUE) === -1) {
      fail('a refused announcement wrote into ' + page + '/a-venir/');
    }
  });

  // Une page dont la forme ne permettrait pas les gestes suivants : refusée,
  // et rien d'écrit nulle part, quel que soit l'ordre où les pages sont lues.
  var malformed = [
    ['whose version in force does not announce it', function (site, page) {
      var file = path.join(site, page, 'index.html');
      fs.writeFileSync(file, read(file).replace(/<!-- a-venir -->[\s\S]*?<!-- \/a-venir -->/, ''));
    }],
    ['whose announcement is already dated', function (site, page) {
      var file = path.join(site, page, 'index.html');
      fs.writeFileSync(file, read(file).replace(/(<!-- a-venir -->[\s\S]*?)MESSAGR-DATE-A-VENIR/, '$1' + said(inDays(45))));
    }],
    ['that still carries the card of an applied version', function (site, page) {
      var file = path.join(site, page, 'a-venir', 'index.html');
      fs.writeFileSync(file, read(file).replace('</main>', '<!-- depuis --><p></p><!-- /depuis --></main>'));
    }],
  ];
  malformed.forEach(function (flaw) {
    PAGES.forEach(function (broken) {
      var bare = aCopy();
      flaw[1](bare.site, broken);
      if (!refused(gesture(['annoncer', inDays(40), bare.site]))) {
        fail('an upcoming version ' + flaw[0] + ' (' + broken + ') was not refused');
      }
      PAGES.forEach(function (other) {
        if (other !== broken &&
            read(path.join(bare.site, other, 'a-venir', 'index.html')).indexOf(MARQUE) === -1) {
          fail('a refused announcement (' + broken + ' ' + flaw[0] + ') wrote into ' + other);
        }
      });
    });
  });

  if (gesture(['annoncer', inDays(30), copy.site]).code !== 0) {
    fail('thirty days exactly, the notice promised, was refused');
  }
  if (!refused(gesture(['annoncer', inDays(31), copy.site]))) {
    fail('a second announcement was not refused with nothing left to date');
  }
})();

// ── 4. La construction ne coupe rien, et ne laisse aucune marque ─────────
(function () {
  var copy = aCopy();
  var page = path.join(copy.site, 'aide', 'index.html');
  fs.writeFileSync(page, read(page).replace('</main>', '<p>' + MARQUE + '</p></main>'));
  if (built(copy.site).result.code === 0) {
    fail('a site still carrying the mark was built');
  }

  // Le passage d'annonce sur une seule ligne : retiré, et le reste construit.
  var oneLine = aCopy();
  var inForce = path.join(oneLine.site, PAGES[0], 'index.html');
  var flat = read(inForce).replace(/<!-- a-venir -->[\s\S]*?<!-- \/a-venir -->/, function (passage) {
    return passage.replace(/\s*\n\s*/g, ' ');
  });
  fs.writeFileSync(inForce, flat);
  var site = built(oneLine.site);
  var served = site.result.code === 0 ? read(path.join(site.out, PAGES[0], 'index.html')) : '';
  if (served !== flat.replace(/ *<!-- a-venir -->.*?<!-- \/a-venir --> *\n?/, '')) {
    fail('a passage on one line is not removed alone: ' + served.length + ' characters built');
  }
})();

// ── 5. Une date annoncée recule, et n'avance pas ─────────────────────────
(function () {
  var copy = aCopy();
  if (!refused(gesture(['reporter', inDays(50), copy.site]))) {
    fail('postponing a version nobody announced was not refused');
  }
  var first = inDays(40);
  gesture(['annoncer', first, copy.site]);
  [first, inDays(39)].forEach(function (earlier) {
    if (!refused(gesture(['reporter', earlier, copy.site]))) {
      fail('moving an announced date from ' + first + ' to ' + earlier + ' was not refused');
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

  // Une date que le geste ne trouverait pas dans une page : rien d'écrit.
  var rewrapped = path.join(copy.site, PAGES[0], 'index.html');
  fs.writeFileSync(rewrapped, read(rewrapped).split(said(later)).join(
    '<time datetime="' + later + '">\n' + enFrancais(later) + '</time>'));
  var before = PAGES.map(function (page) {
    return read(path.join(copy.site, page, 'a-venir', 'index.html'));
  });
  if (!refused(gesture(['reporter', inDays(55), copy.site]))) {
    fail('a postponement that could not rewrite ' + PAGES[0] + ' was not refused');
  }
  PAGES.forEach(function (page, i) {
    if (read(path.join(copy.site, page, 'a-venir', 'index.html')) !== before[i]) {
      fail('a refused postponement wrote into ' + page + '/a-venir/');
    }
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
      checkState(copy.site, copy.retention, 'an applied copy');
      PAGES.forEach(function (page) {
        before[page] = read(path.join(copy.site, page, 'index.html'));
        prepare(copy.site, page);
      });
      checkState(copy.site, copy.retention, 'a version prepared after an application');
    }
    var upcoming = {};
    gesture(['annoncer', date, copy.site]);
    PAGES.forEach(function (page) {
      upcoming[page] = read(path.join(copy.site, page, 'a-venir', 'index.html'));
    });

    if (!refused(gesture(['appliquer', copy.site]))) {
      fail('cycle ' + (cycle + 1) + ': applying today, before ' + date + ', was not refused');
    }
    if (!refused(applyAt(copy, parisMidnight(date, 1)))) {
      fail('cycle ' + (cycle + 1) + ': applying at 23:59 in Paris, the evening before ' + date + ', was not refused');
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
      if (was && typeof was === 'object') {
        var expected = JSON.parse(JSON.stringify(was));
        delete expected.page;
        if (JSON.stringify(retention[key]) !== JSON.stringify(expected)) {
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
    if (!refused(applyAt(copy, parisMidnight(date, -60)))) {
      fail('cycle ' + (cycle + 1) + ': a second application was not refused with nothing upcoming');
    }
  });
})();

// ── 7. Seules les versions échues s'appliquent ───────────────────────────
(function () {
  if (PAGES.length < 2) {
    return;
  }
  var copy = aCopy();
  var date = inDays(40);
  gesture(['annoncer', date, copy.site]);
  var waiting = PAGES[1];
  unannounce(copy.site, waiting);
  var untouched = read(path.join(copy.site, waiting, 'index.html'));
  var applied = applyAt(copy, parisMidnight(date, 0));
  if (applied.code !== 0) {
    fail('an announced version was not applied beside one still waiting: ' + applied.err);
    return;
  }
  if (!exists(path.join(copy.site, PAGES[0], 'jusqu-au-' + date, 'index.html'))) {
    fail(PAGES[0] + ' was not applied on its date');
  }
  if (!exists(path.join(copy.site, waiting, 'a-venir', 'index.html')) ||
      read(path.join(copy.site, waiting, 'index.html')) !== untouched) {
    fail(waiting + ', not announced, was applied with ' + PAGES[0]);
  }
})();

// ── 8. Une forme défaite après l'annonce, refusée le jour venu ───────────
(function () {
  var copy = aCopy();
  var date = inDays(40);
  gesture(['annoncer', date, copy.site]);
  var inForce = path.join(copy.site, PAGES[0], 'index.html');
  fs.writeFileSync(inForce, read(inForce).replace(/<!-- a-venir -->[\s\S]*?<!-- \/a-venir -->/, ''));
  if (!refused(applyAt(copy, parisMidnight(date, 0)))) {
    fail('an upcoming version whose announcement was taken out was applied, or fell over');
  }
  PAGES.forEach(function (page) {
    if (exists(path.join(copy.site, page, 'jusqu-au-' + date)) ||
        !exists(path.join(copy.site, page, 'a-venir', 'index.html'))) {
      fail('a refused application wrote into ' + page);
    }
  });
})();

// ── 9. Lancé par un lien symbolique, le geste se fait ────────────────────
(function () {
  var copy = aCopy();
  var date = inDays(40);
  var link = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'a-venir-lien-')), 'version-a-venir.mjs');
  fs.symlinkSync(tool, link);
  var launched = run('node', [link, 'annoncer', date, copy.site]);
  if (launched.code !== 0 || read(path.join(copy.site, PAGES[0], 'a-venir', 'index.html')).indexOf(MARQUE) !== -1) {
    fail('run through a symbolic link, the announcement did not happen: ' + launched.out + launched.err);
  }
})();

if (status === 0) {
  console.log('version-a-venir: nothing upcoming is served before it is dated, both versions are once it is, and the replaced one stays readable once applied');
}
process.exit(status);
