// LE CONTRÔLE DES PAGES LÉGALES ET CELUI DE L'ÉCRAN LÉGAL, MENÉS CONTRE LE
// SITE CONSTRUIT (#466).
//
// `scripts/assert-legal-pages.sh` et `scripts/assert-legal-screen.sh` ne
// tournent qu'au moment de publier une build, et contre messagr.eu : c'est le
// site servi qui engage, et un site en panne ne doit pas faire échouer une
// pull request. Mais un contrôle qui n'a jamais refusé ne prouve rien, et
// ceux-là n'avaient jamais tourné ailleurs qu'en production, là où il est trop
// tard pour apprendre qu'ils ne regardent pas la page anglaise, ou qu'ils
// laissent passer une phrase que les conditions ne disent plus.
//
// Ils sont donc menés ici contre le site construit : servi par un petit
// serveur local qui répond comme nginx (la page, un 404, une redirection vers
// la barre oblique) pour le premier, lu comme fichiers pour le second. Chacun
// doit passer sur le site tel qu'il sera publié, et refuser chaque défaut
// qu'il existe pour voir.
//
// DANS LES DEUX ÉTATS DU DÉPÔT : une version qui attend d'être publiée, et
// aucune. Avant la publication, la copie est publiée d'abord, puisque c'est la
// version publiée que l'écran doit dire ; après, elle l'est déjà. Et une page
// qui attend est préparée quand le dépôt n'en tient aucune.
'use strict';

var fs = require('fs');
var os = require('os');
var path = require('path');
var child = require('child_process');

var root = path.join(__dirname, '..');
var repository = path.join(root, '..', '..');
var build = path.join(root, 'build-site.sh');
var tool = path.join(root, 'version-a-venir.mjs');
var siteDir = path.join(root, 'site');
var pagesCheck = path.join(repository, 'scripts', 'assert-legal-pages.sh');
var screenCheck = path.join(repository, 'scripts', 'assert-legal-screen.sh');
var copyDir = path.join(repository, 'packages', 'app', 'src', 'copy');
var status = 0;

function fail(message) {
  console.error('controles-legaux: FAIL: ' + message);
  status = 1;
}

function run(file, args, extra, cwd) {
  var env = { PATH: process.env.PATH, HOME: process.env.HOME };
  Object.keys(extra || {}).forEach(function (name) { env[name] = extra[name]; });
  try {
    var stdout = child.execFileSync(file, args, {
      encoding: 'utf8',
      env: env,
      cwd: cwd || repository,
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

function aCopy() {
  var copy = fs.mkdtempSync(path.join(os.tmpdir(), 'controles-source-'));
  var site = path.join(copy, 'site');
  fs.mkdirSync(site);
  child.execFileSync('cp', ['-R', siteDir + '/.', site]);
  return site;
}

/** Une copie telle qu'elle sera publiée : ce qui attend l'est, aujourd'hui. */
function aPublishedCopy() {
  var site = aCopy();
  if (PAGES.some(function (page) { return exists(path.join(site, page, 'a-publier', 'index.html')); })) {
    var published = run('node', [tool, 'publier', site]);
    if (published.code !== 0) {
      throw new Error('the copy could not publish what waits in a-publier/: ' + published.err);
    }
  }
  return site;
}

/**
 * Une copie où chaque page légale tient une version qui attend d'être
 * publiée, avec la traduction de la version en vigueur passée dans
 * `a-publier/` si elle en a une : le contrôle des pages ne lit que la forme.
 */
function aWaitingCopy() {
  var site = aCopy();
  PAGES.forEach(function (page) {
    var dir = path.join(site, page);
    var waiting = path.join(dir, 'a-publier');
    if (exists(path.join(waiting, 'index.html'))) {
      return;
    }
    fs.mkdirSync(waiting);
    fs.copyFileSync(path.join(dir, 'index.html'), path.join(waiting, 'index.html'));
    translationsOf(dir).forEach(function (lang) {
      fs.renameSync(path.join(dir, lang), path.join(waiting, lang));
    });
  });
  return site;
}

function built(source) {
  var out = fs.mkdtempSync(path.join(os.tmpdir(), 'controles-site-'));
  var result = run(build, [source, out]);
  if (result.code !== 0) {
    throw new Error('the site does not build: ' + result.err);
  }
  return out;
}

// Un serveur qui répond comme le `location /` de nginx-messagr-eu.conf :
// `try_files $uri $uri/ =404`, et la redirection d'un dossier vers sa barre
// oblique. Dans un processus à lui, puisque les contrôles sont lancés d'ici
// en attendant leur fin ; il s'arrête quand ce test ferme son entrée.
var SERVER = [
  "var http = require('http');",
  "var fs = require('fs');",
  "var path = require('path');",
  'var root = process.argv[1];',
  'var portFile = process.argv[2];',
  'var server = http.createServer(function (req, res) {',
  "  var address = decodeURIComponent(req.url.split('?')[0]);",
  '  var file = path.join(root, address);',
  '  if (file.indexOf(root) !== 0) { res.statusCode = 404; res.end(); return; }',
  '  fs.stat(file, function (err, stat) {',
  "    if (!err && stat.isDirectory() && address.slice(-1) !== '/') {",
  "      res.statusCode = 301; res.setHeader('Location', address + '/'); res.end(); return;",
  '    }',
  "    fs.readFile(!err && stat.isDirectory() ? path.join(file, 'index.html') : file, function (e, body) {",
  "      if (e) { res.statusCode = 404; res.end('not found'); return; }",
  '      res.statusCode = 200; res.end(body);',
  '    });',
  '  });',
  '});',
  "server.listen(0, '127.0.0.1', function () {",
  '  fs.writeFileSync(portFile, String(server.address().port));',
  '});',
  "process.stdin.on('end', function () { process.exit(0); });",
  'process.stdin.resume();',
].join('\n');

function serve(dir) {
  var portFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'controles-port-')), 'port');
  var server = child.spawn(process.execPath, ['-e', SERVER, dir, portFile], {
    stdio: ['pipe', 'ignore', 'inherit'],
  });
  for (var i = 0; i < 100 && !(exists(portFile) && read(portFile).trim() !== ''); i++) {
    child.execFileSync('sleep', ['0.1']);
  }
  if (!exists(portFile)) {
    server.kill();
    throw new Error('the local server did not start');
  }
  return {
    base: 'http://127.0.0.1:' + read(portFile).trim(),
    stop: function () {
      server.stdin.end();
      server.kill();
    },
  };
}

function checkPages(server, source) {
  return run(pagesCheck, [], { MESSAGR_SITE: server.base, MESSAGR_SITE_SOURCE: source });
}

function checkScreen(french, english, catalogues) {
  var extra = {
    MESSAGR_TERMS_URL: 'file://' + french,
    MESSAGR_TERMS_EN_URL: 'file://' + english,
  };
  if (catalogues) {
    extra.MESSAGR_COPY_DIR = catalogues;
  }
  return run(screenCheck, [], extra);
}

/** Les adresses des traductions en vigueur d'un site : `/conditions-generales/en/`. */
function translatedAddresses(site) {
  var all = [];
  PAGES.forEach(function (page) {
    translationsOf(path.join(site, page)).forEach(function (lang) {
      all.push('/' + page + '/' + lang + '/');
    });
  });
  return all;
}

// ── 1. Les pages servies, la traduction anglaise comprise ────────────────
(function () {
  var source = aPublishedCopy();
  var out = built(source);
  var translated = translatedAddresses(source);
  if (translated.length === 0) {
    fail('no legal page has a translation once published: the English terms are checked nowhere');
  }
  var server = serve(out);
  try {
    var passed = checkPages(server, source);
    if (passed.code !== 0) {
      fail('the legal pages check refuses the site as it will be published: ' + passed.out + passed.err);
    }
    translated.forEach(function (address) {
      if (passed.out.indexOf('OK    ' + server.base + address) === -1) {
        fail('the legal pages check does not look at ' + address + ': ' + passed.out);
      }
      // Sans elle : refusé, en la nommant.
      var served = path.join(out, address);
      var aside = served.replace(/\/$/, '') + '-a-cote';
      fs.renameSync(served, aside);
      var missing = checkPages(server, source);
      fs.renameSync(aside, served);
      if (missing.code === 0 || missing.err.indexOf(server.base + address) === -1) {
        fail('the legal pages check passes a site that does not serve ' + address);
      }
    });
  } finally {
    server.stop();
  }
})();

// ── 2. Ce qui attend d'être publié ne répond pas ─────────────────────────
(function () {
  var source = aWaitingCopy();
  var out = built(source);
  var server = serve(out);
  try {
    var passed = checkPages(server, source);
    if (passed.code !== 0) {
      fail('the legal pages check refuses a site where a version waits, unserved: ' + passed.out + passed.err);
    }
    PAGES.forEach(function (page) {
      var address = '/' + page + '/a-publier/';
      if (passed.out.indexOf(server.base + address + ' is not served (404)') === -1) {
        fail('the legal pages check does not make sure ' + address + ' is not served: ' + passed.out);
      }
      // Servie par erreur : refusé.
      child.execFileSync('cp', ['-R', path.join(source, page, 'a-publier'), path.join(out, page, 'a-publier')]);
      var early = checkPages(server, source);
      fs.rmSync(path.join(out, page, 'a-publier'), { recursive: true });
      if (early.code === 0 || early.err.indexOf(server.base + address) === -1) {
        fail('the legal pages check passes a site that serves ' + address);
      }
      // Et la traduction qui attend avec elle, servie avant elle : refusé.
      translationsOf(path.join(source, page, 'a-publier')).forEach(function (lang) {
        var translation = '/' + page + '/' + lang + '/';
        if (passed.out.indexOf(server.base + translation + ' is not served (404)') === -1) {
          fail('the legal pages check does not make sure ' + translation + ' waits for its version');
        }
        child.execFileSync('cp', ['-R', path.join(source, page, 'a-publier', lang), path.join(out, page, lang)]);
        var ahead = checkPages(server, source);
        fs.rmSync(path.join(out, page, lang), { recursive: true });
        if (ahead.code === 0 || ahead.err.indexOf(server.base + translation) === -1) {
          fail('the legal pages check passes a site that serves ' + translation + ' before its version');
        }
      });
    });
  } finally {
    server.stop();
  }
})();

// ── 3. L'écran légal et les conditions disent la même chose ──────────────
(function () {
  var source = aPublishedCopy();
  var out = built(source);
  var french = path.join(out, 'conditions-generales', 'index.html');
  var english = path.join(out, 'conditions-generales', 'en', 'index.html');
  if (!exists(english)) {
    fail('the terms have no English page once published');
    return;
  }
  var agreed = checkScreen(french, english);
  if (agreed.code !== 0) {
    fail('the legal screen and the terms as they will be published disagree: ' + agreed.out + agreed.err);
  }
  // La version à venir deviendra les conditions en vigueur : elle dit ce que
  // l'écran dit, elle aussi.
  var upcoming = path.join(source, 'conditions-generales', 'a-venir', 'index.html');
  if (exists(upcoming)) {
    var ahead = checkScreen(upcoming, english);
    if (ahead.code !== 0) {
      fail('the upcoming terms no longer say what the legal screen says: ' + ahead.out + ahead.err);
    }
  }

  function altered(file, change) {
    var copy = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'controles-page-')), 'index.html');
    fs.writeFileSync(copy, change(read(file)));
    return copy;
  }
  [
    ['a French page that no longer commits to twenty-four hours', function () {
      return checkScreen(altered(french, function (html) {
        return html.split('vingt-quatre heures').join('quarante-huit heures');
      }), english);
    }],
    ['an English page that no longer commits to twenty-four hours', function () {
      return checkScreen(french, altered(english, function (html) {
        return html.split('twenty-four hours').join('forty-eight hours');
      }));
    }],
    ['a French page that says again that reporting does not exist', function () {
      return checkScreen(altered(french, function (html) {
        return html.replace('</main>', "<p>Le geste depuis l'application n'existe pas encore.</p></main>");
      }), english);
    }],
    ['an English page that says again the operator cannot take a message down', function () {
      return checkScreen(french, altered(english, function (html) {
        return html.replace('</main>', '<p>What it cannot do: take down a particular message.</p></main>');
      }));
    }],
  ].forEach(function (flaw) {
    if (flaw[1]().code === 0) {
      fail('the legal screen check passes ' + flaw[0]);
    }
  });

  // Les sept langues de l'écran : chacune porte chaque fait, et aucune ne
  // garde une ancienne phrase. Ce qui compte est ce que l'écran affiche, pas
  // les commentaires du catalogue, qui citent les anciens textes exprès.
  function catalogues(lang, change) {
    var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'controles-copy-'));
    fs.readdirSync(copyDir).forEach(function (name) {
      fs.copyFileSync(path.join(copyDir, name), path.join(dir, name));
    });
    var file = path.join(dir, lang + '.ts');
    fs.writeFileSync(file, change(read(file)));
    return dir;
  }
  [
    ['uz', 'an Uzbek screen that lost the twenty-four hours', function (ts) {
      return ts.split('Yigirma toʻrt soat').join('Qirq sakkiz soat');
    }, 'uz'],
    ['de', 'a German screen that says again that reporting does not exist yet', function (ts) {
      return ts.replace(/(legal_report_how:\s*')/, '$1Das Melden aus der App heraus gibt es noch nicht. ');
    }, 'de'],
    ['es', 'a Spanish screen that lost the report number', function (ts) {
      return ts.split('número de denuncia').join('referencia');
    }, 'es'],
  ].forEach(function (flaw) {
    var refused = checkScreen(french, english, catalogues(flaw[0], flaw[2]));
    if (refused.code === 0 || (refused.out + refused.err).indexOf('[' + flaw[3] + ']') === -1) {
      fail('the legal screen check passes ' + flaw[1] + ', or does not name the language: ' + refused.out);
    }
  });
  var commented = checkScreen(french, english, catalogues('fr', function (ts) {
    return ts.replace('export const fr = {', "export const fr = {\n  // Le geste depuis l'application n'existe pas encore.");
  }));
  if (commented.code !== 0) {
    fail('the legal screen check reads a comment of the catalogue as if the screen displayed it: ' + commented.out + commented.err);
  }
})();

if (status === 0) {
  console.log('controles-legaux: both legal checks pass on the site as it will be published, French and English, and refuse what they exist to see');
}
process.exit(status);
