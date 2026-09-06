// THE SENTENCE AND THE LINKS CANNOT CONTRADICT EACH OTHER, AND THIS IS WHERE
// THAT IS MEASURED RATHER THAN RE-READ.
//
// The page says, when it has no destination to offer:
//
//   "L'application n'est pas encore publiee. Demandez a la personne qui vous
//    a invite comment l'obtenir."
//
// That sentence is true on 16 August 2026 and it is built to become false.
// The day a store address or a direct download exists, a page still carrying
// it is a page that lies to someone holding a working invitation -- and
// nobody would notice, because the sentence is correct-looking prose in a
// file nobody re-reads at deployment time.
//
// TWO WAYS IT COULD GO WRONG, AND BOTH ARE HELD HERE.
//
//   1. The destination is set but the page keeps the sentence. This is not
//      hypothetical: until 16 August 2026 deploy.sh substituted the
//      destinations with `sed -e "s|ios: ''|...|"`, and sed EXITS ZERO WHEN
//      IT SUBSTITUTES NOTHING. Rename the marker in the page and the
//      operator sets MESSAGR_DEST_IOS, sees a green deployment, and serves
//      the waiting sentence to everyone. build-site.sh now verifies that
//      each value it was given actually landed, and this test drives
//      build-site.sh rather than re-implementing it.
//   2. The page carries a destination nobody configured. The committed page
//      must hold empty slots and nothing else, so the only way an address
//      reaches production is through the deployment that was asked for it.
//
// THE TEST DRIVES THE PAGE, IT DOES NOT COPY IT -- the same rule as
// qr-page-invitation.js, for the same reason. The real build script runs,
// the real page script is evaluated against a recording DOM, and what a
// person would SEE is what is asserted. A test that reimplemented the branch
// would agree with itself forever.
'use strict';

var fs = require('fs');
var os = require('os');
var path = require('path');
var child = require('child_process');

var root = path.join(__dirname, '..');
var build = path.join(root, 'build-site.sh');
// The site under test. Defaults to the committed one; an argument aims the
// whole suite at a COPY, which is how it is checked that these assertions
// still fail on a page that contradicts itself.
var siteDir = process.argv[2] || path.join(root, 'site');
var status = 0;

function fail(message) {
  console.error('destinations: FAIL: ' + message);
  status = 1;
}

// THE WAITING SENTENCE IS RECOGNISED BY ITS TAIL, NOT BY ITS OPENING, AND THE
// REASON IS A DEFECT THIS GATE ALMOST HID. It used to match
// "L'application n'est pas encore publi", the opening words. On 18 August 2026
// the sentence learned to name the platform it speaks about: an iPhone reader
// now gets "Messagr n'est pas encore disponible sur iPhone", because the old
// wording became false for Android the moment the APK went online and was
// still shown to everyone.
//
// Matching the opening would have made this gate refuse a correct page and
// pass a wrong one: any future wording that keeps those five words while
// offering nothing useful would still read as "waiting". The tail is what the
// sentence DOES, which is to send the reader back to whoever invited them, and
// it is the same on every platform. What this gate exists to hold is unchanged:
// a sentence or an address, never both, measured on the BUILT page.
var WAITING = "Demandez \u00e0 la personne qui vous a invit\u00e9 comment l'obtenir.";
var IOS_URL = 'https://apps.apple.com/app/id0000000000';
var STORE_URL = 'https://play.google.com/store/apps/details?id=cloud.maudet.messagr';
var APK_URL = 'https://messagr.eu/messagr.apk';

var AGENTS = {
  ios: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', maxTouchPoints: 5 },
  android: { userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 8)', maxTouchPoints: 5 },
  desktop: { userAgent: 'Mozilla/5.0 (X11; Linux x86_64)', maxTouchPoints: 0 }
};

// ── Running the real build ───────────────────────────────────────────────
// execFileSync throws on a non-zero exit and carries the status on the
// error. NOTHING IS PIPED: the status read here is the build script's own,
// never some last command of a pipeline.
function runBuild(env, sourceDir) {
  var out = fs.mkdtempSync(path.join(os.tmpdir(), 'd4-site-'));
  var full = { PATH: process.env.PATH, HOME: process.env.HOME };
  Object.keys(env).forEach(function (k) { full[k] = env[k]; });
  try {
    var stdout = child.execFileSync(build, [sourceDir || siteDir, out],
      { encoding: 'utf8', env: full, stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out: out, stdout: stdout, stderr: '' };
  } catch (e) {
    return {
      code: e.status === undefined || e.status === null ? -1 : e.status,
      out: out,
      stdout: String(e.stdout || ''),
      stderr: String(e.stderr || '') + String(e.message || '')
    };
  }
}

// ── Driving the built page ───────────────────────────────────────────────
function render(pagePath, agent) {
  var page = fs.readFileSync(pagePath, 'utf8');
  var script = /<script>([\s\S]*?)<\/script>/.exec(page);
  if (!script) { throw new Error('the built page carries no script'); }

  // A node starts with the text the HTML gives it, exactly as a browser
  // would. The unknown-sources warning is written in the markup and merely
  // REVEALED by the script -- the page's own rule -- so a fake DOM that
  // started every node empty would report the warning as missing while a
  // real visitor read it.
  function markupText(id) {
    var found = new RegExp('<([a-z]+)[^>]*\\bid="' + id + '"[^>]*>([\\s\\S]*?)</\\1>')
      .exec(page);
    return found ? found[2].replace(/\s+/g, ' ').trim() : '';
  }

  var nodes = {};
  function node(id) {
    if (!nodes[id]) {
      nodes[id] = {
        id: id, hidden: true, textContent: markupText(id), links: [],
        appendChild: function (child_) { nodes[id].links.push(child_); },
        addEventListener: function () {},
        getContext: undefined
      };
    }
    return nodes[id];
  }
  // The canvas answers getContext so the desktop branch can draw; what it
  // draws is qr-page-invitation.js's business, not this test's.
  var canvas = node('qr');
  canvas.getContext = function () {
    return { fillStyle: '', fillRect: function () {} };
  };

  var sandbox = {
    document: {
      getElementById: function (id) { return node(id); },
      createElement: function () { return { href: '', textContent: '' }; }
    },
    navigator: { userAgent: agent.userAgent, maxTouchPoints: agent.maxTouchPoints },
    location: { href: 'https://messagr.eu/i/abcdef0123456789' }
  };

  // eslint-disable-next-line no-new-func
  var run = new Function('document', 'navigator', 'location', script[1]);
  run(sandbox.document, sandbox.navigator, sandbox.location);
  return nodes;
}

// What a person actually sees: the text of every revealed node, plus the
// href of every link inside one.
function shown(nodes) {
  var text = [], hrefs = [];
  Object.keys(nodes).forEach(function (id) {
    var n = nodes[id];
    if (n.hidden) { return; }
    if (n.textContent) { text.push(n.textContent); }
    n.links.forEach(function (a) {
      hrefs.push(a.href);
      if (a.textContent) { text.push(a.textContent); }
    });
  });
  return { text: text.join(' ‖ '), hrefs: hrefs };
}

function check(name, env, agent, expect) {
  var built = runBuild(env);
  if (built.code !== 0) {
    fail(name + ': build-site.sh exited ' + built.code + ' when it should ' +
      'have succeeded\n' + built.stderr);
    return;
  }
  var seen;
  try {
    seen = shown(render(path.join(built.out, 'i/index.html'), AGENTS[agent]));
  } catch (e) {
    fail(name + ': the built page could not be driven: ' + e.message);
    return;
  }

  var waits = seen.text.indexOf(WAITING) !== -1;
  if (waits !== expect.waiting) {
    fail(name + ' (' + agent + '): the waiting sentence is ' +
      (waits ? 'SHOWN' : 'ABSENT') + ', expected ' +
      (expect.waiting ? 'SHOWN' : 'ABSENT') + '\n  shown: ' + seen.text);
  }
  // THE CONTRADICTION ITSELF: a destination offered while the page still
  // says there is none. Held separately from the case above so the failure
  // names the thing that is wrong, not just the case that noticed.
  if (waits && seen.hrefs.length > 0) {
    fail(name + ' (' + agent + '): the page offers ' + seen.hrefs.join(', ') +
      ' AND says the application is not published yet. One of the two is a lie.');
  }
  var expected = expect.hrefs || [];
  if (seen.hrefs.join(',') !== expected.join(',')) {
    fail(name + ' (' + agent + '): offers [' + seen.hrefs.join(', ') +
      '], expected [' + expected.join(', ') + ']');
  }
  if (expect.contains) {
    expect.contains.forEach(function (needle) {
      if (seen.text.indexOf(needle) === -1) {
        fail(name + ' (' + agent + '): the page never says ' +
          JSON.stringify(needle) + '\n  shown: ' + seen.text);
      }
    });
  }
  if (expect.absent) {
    expect.absent.forEach(function (needle) {
      if (seen.text.indexOf(needle) !== -1) {
        fail(name + ' (' + agent + '): the page says ' + JSON.stringify(needle) +
          ' and should not\n  shown: ' + seen.text);
      }
    });
  }
}

// ── 0. Nothing is baked into the committed page ──────────────────────────
var committed = fs.readFileSync(path.join(siteDir, 'i/index.html'), 'utf8');
['ios', 'android', 'androidApk'].forEach(function (slot) {
  var marker = slot + ": ''";
  var count = committed.split(marker).length - 1;
  if (count !== 1) {
    fail('the committed page holds the empty slot `' + marker + '` ' + count +
      ' time(s), expected exactly once. The committed page must carry NO ' +
      'address: every address reaches production through a deployment that ' +
      'was asked for it, and through no other path.');
  }
});

// ── 0 bis. ONE ADDRESS, THREE FILES, AND THEY MUST AGREE ─────────────────
// deploy.sh derives the download address from the file it publishes; nginx
// has to have a location for that exact path; this suite asserts against
// it. Three places, and a rename in any one of them produces a page that
// offers a 404 with nothing anywhere disagreeing.
var deployScript = fs.readFileSync(path.join(root, 'deploy.sh'), 'utf8');
var declaredName = /^APK_NAME=(\S+)$/m.exec(deployScript);
var declaredUrl = /^APK_URL="([^"]+)"$/m.exec(deployScript);
if (!declaredName || !declaredUrl) {
  fail('deploy.sh no longer declares APK_NAME and APK_URL: nothing ties the ' +
    'download the page offers to the file the deployment publishes');
} else {
  var expectedUrl = declaredUrl[1].replace('$APK_NAME', declaredName[1]);
  if (expectedUrl !== APK_URL) {
    fail('deploy.sh publishes the download at ' + expectedUrl +
      ' and this suite asserts ' + APK_URL);
  }
  var vhost = fs.readFileSync(path.join(root, 'nginx-messagr-eu.conf'), 'utf8');
  if (vhost.indexOf('location = /' + declaredName[1] + ' ') === -1) {
    fail('nginx-messagr-eu.conf has no `location = /' + declaredName[1] +
      '`: the page would offer a download the server answers 404 for');
  }
}

// ── 1. No destination at all: the waiting sentence, and only it ──────────
check('nothing configured', {}, 'ios', { waiting: true, hrefs: [] });
check('nothing configured', {}, 'android', { waiting: true, hrefs: [] });

// ── 2. A store address: the link, and NOT the sentence ───────────────────
check('ios store', { MESSAGR_DEST_IOS: IOS_URL }, 'ios',
  { waiting: false, hrefs: [IOS_URL] });
check('android store', { MESSAGR_DEST_ANDROID: STORE_URL }, 'android',
  { waiting: false, hrefs: [STORE_URL] });

// ── 3. The two platforms do not answer for each other ────────────────────
// An Android address must not silence the iOS sentence, and the reverse.
check('android store, seen from iOS', { MESSAGR_DEST_ANDROID: STORE_URL }, 'ios',
  { waiting: true, hrefs: [] });
check('ios store, seen from Android', { MESSAGR_DEST_IOS: IOS_URL }, 'android',
  { waiting: true, hrefs: [] });

// ── 4. THE DIRECT DOWNLOAD, WHICH IS THE POINT OF THIS TASK ──────────────
// The application is published in no store and the first tester is meant to
// have it BEFORE it is. Without this path the page can only say "ask the
// person who invited you", which is honest and useless.
check('apk only', { MESSAGR_DEST_ANDROID_APK: APK_URL }, 'android',
  { waiting: false, hrefs: [APK_URL],
    contains: ['sources inconnues'] });

// The download is Android's alone. iOS has no sideload, and offering one
// there would be the same class of lie.
check('apk only, seen from iOS', { MESSAGR_DEST_ANDROID_APK: APK_URL }, 'ios',
  { waiting: true, hrefs: [] });

// ── 5. Both: the store wins, and exactly one address is offered ──────────
check('store and apk together',
  { MESSAGR_DEST_ANDROID: STORE_URL, MESSAGR_DEST_ANDROID_APK: APK_URL },
  'android', { waiting: false, hrefs: [STORE_URL] });

// ── 6. The desktop branch is untouched by any of it ──────────────────────
check('desktop, nothing configured', {}, 'desktop',
  { waiting: false, hrefs: [], contains: ['Scannez ce code'] });

// ── 7. THE SILENT SUBSTITUTION, WHICH IS WHAT `sed` USED TO DO ───────────
// Give the build a page whose marker has been renamed. A build that reports
// success here is a build that serves the waiting sentence to a published
// application, and that is the defect this whole file exists for.
var mutated = fs.mkdtempSync(path.join(os.tmpdir(), 'd4-source-'));
// `fs.cpSync` AND NOT `cp -R`, AND THE DIFFERENCE IS A PLATFORM ONE THAT ONLY
// CI COULD SEE. `cp -R source/ dest/` copies the CONTENTS of source into dest
// on BSD (macOS, where this gate was written and passed), and copies source
// AS A DIRECTORY INTO dest on GNU coreutils (Linux, where CI runs) — leaving
// `dest/site/i/index.html` where the next line reads `dest/i/index.html`.
// Green on the author's machine, `ENOENT` on the first CI run, 16 August 2026.
// Node's own recursive copy has no platform: it always copies the contents.
fs.cpSync(siteDir, mutated, { recursive: true });
var mutatedPage = path.join(mutated, 'i/index.html');
fs.writeFileSync(mutatedPage,
  fs.readFileSync(mutatedPage, 'utf8').replace("android: ''", "androidStore: ''"));

var renamed = runBuild({ MESSAGR_DEST_ANDROID: STORE_URL }, mutated);
if (renamed.code === 0) {
  fail('build-site.sh SUCCEEDED on a page whose `android` slot had been ' +
    'renamed, with MESSAGR_DEST_ANDROID set. The address went nowhere and ' +
    'nothing said so: this is exactly what `sed` did silently.');
}

// ── 8. A value that is not a plain address is refused ────────────────────
// The substitution lands inside a JavaScript string literal. A quote in the
// value does not produce a broken page, it produces an EXECUTING one.
var injected = runBuild({ MESSAGR_DEST_ANDROID: "https://x'+alert(1)+'" });
if (injected.code === 0) {
  fail('build-site.sh accepted a destination containing a quote: the value ' +
    'lands inside a JavaScript string literal, so that is code injection, ' +
    'not a typo.');
}

// ── 9. A foreign origin is refused, on the BUILT page ────────────────────
// doctrine-page-invitation.sh allow-lists the stores and messagr.eu. Until
// build-site.sh ran it on its output, that allow-list only ever saw the
// committed page -- the one that carries no address at all.
var foreign = runBuild({ MESSAGR_DEST_ANDROID: 'https://example.invalid/messagr' });
if (foreign.code === 0) {
  fail('build-site.sh accepted a destination outside the allow-list of ' +
    'doctrine-page-invitation.sh. The doctrine must hold on the page that ' +
    'is DEPLOYED, not only on the one that is committed.');
}

if (status === 0) {
  console.log('destinations: the sentence and the addresses cannot ' +
    'contradict each other, on either platform');
}
process.exit(status);
