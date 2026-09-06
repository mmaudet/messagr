// THE TWO WELL-KNOWN FILES, AND THE ONE RULE THAT MAKES THEM GOVERNABLE:
// NO FINGERPRINT WITHOUT A WRITTEN ORIGIN.
//
// WHAT THIS GATE WAS BUILT FROM. On 16 August 2026 the deployed
// assetlinks.json declared exactly one fingerprint:
//
//   B6:6F:5A:6D:7F:D3:9A:AB:EF:C9:7E:56:80:8E:73:22:37:65:7B:15:58:B8:9C:C4:56:8C:5F:6D:49:7E:14:30
//
// It was imported on 9 August 2026 (commit 385d26b) from a file hand-placed
// on the server and absent from the repository, and NOTHING anywhere said
// which key had produced it. Measured the same morning against the only
// signing key this machine holds -- the Android debug keystore, whose
// SHA-256 is 4B:19:FF:28:... -- it matched nothing. Android link
// verification therefore could not succeed whatever the application did,
// and `pm get-app-links` on the device returned nothing at all.
//
// The defect was never the wrong value. It was that a value could be
// declared with no recorded origin, and that no gate noticed for a week.
// This file is that gate.
//
// WHAT IT HOLDS.
//
//   1. assetlinks.json is canonical Digital Asset Links and NOTHING ELSE.
//      No extra key is tolerated: the file is parsed by Android, and a
//      parser we do not control is not a place to keep our notes. The notes
//      live in android-fingerprints.json, which is never deployed.
//   2. Every fingerprint the file declares is registered, and its registry
//      entry is `vouched` -- meaning somebody wrote down which key it comes
//      from and the command that reproduces it. Any other status is refused
//      BY NAME, so the refusal says what is missing.
//   3. Every registry entry is complete: an origin that is prose and not a
//      placeholder, a reproduction command, and for a vouched entry a
//      canonical fingerprint and the date it was last measured.
//   4. The registry may hold entries with NO fingerprint yet -- the
//      publication key, and the key the store generates when it re-signs.
//      They are slots, declared in advance, and they are refused in
//      assetlinks.json until they hold a measured value.
//   5. The AASA is checked and NOT changed: its team ID and bundle are the
//      decision of 16 August 2026, and this gate pins them so a later edit
//      cannot quietly undo it.
//
// WHAT IT DOES NOT PROVE. It never opens a keystore. It cannot: the release
// key does not exist yet, and the debug key is on one machine while this
// runs on every machine and in CI. It holds that an origin is WRITTEN, not
// that the origin is TRUE. Reproducing a fingerprint is a human act, and
// the `reproduce` field is the command to do it with.
'use strict';

var fs = require('fs');
var path = require('path');

// The directory holding android-fingerprints.json and site/. Defaults to
// deploy/messagr-eu; an argument lets the gate be aimed at a COPY, which is
// how it is checked that it still refuses what it is meant to refuse.
var root = process.argv[2] || path.join(__dirname, '..');
var status = 0;

function fail(message) {
  console.error('app-links: FAIL: ' + message);
  status = 1;
}

function readJson(relative) {
  var full = path.join(root, relative);
  var text;
  try {
    text = fs.readFileSync(full, 'utf8');
  } catch (e) {
    fail('no file at ' + relative + ' (' + e.code + ')');
    return null;
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    // A file Android cannot parse is a file that silently verifies nothing.
    fail(relative + ' is not valid JSON: ' + e.message);
    return null;
  }
}

// A fingerprint is 32 bytes, uppercase hex, colon separated -- the exact
// shape `keytool` prints and the exact shape Android compares. A lowercase
// or space-separated variant is not "the same value written differently":
// it is a value that will not match, so it is refused here.
var FINGERPRINT = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

// The closed vocabulary. A status outside it is a typo, and a typo that
// silently meant "not vouched" would be the same defect over again.
var STATUSES = ['vouched', 'awaited', 'unattributed'];
var KINDS = ['debug', 'release', 'store'];

var PLACEHOLDERS = /^(todo|tbd|unknown|inconnu|inconnue|\?+|-+|n\/a)$/i;

// ── 1. The registry ──────────────────────────────────────────────────────
var registry = readJson('android-fingerprints.json');
var vouched = {};
var seen = {};
// fingerprint -> kind, for the vouched entries only. It used to be
// kind -> name, which is the shape that made the rule at the foot of this
// file ask its question of the registry instead of asking it of what is
// served; see the note there.
var vouchedKinds = {};
var known = {};

if (registry) {
  if (typeof registry.package_name !== 'string' || !registry.package_name) {
    fail('the registry declares no package_name');
  }
  if (!Array.isArray(registry.fingerprints)) {
    fail('the registry has no `fingerprints` array');
    registry.fingerprints = [];
  }
  registry.fingerprints.forEach(function (entry, index) {
    var where = 'registry entry ' +
      (entry && entry.name ? '"' + entry.name + '"' : '#' + index);

    if (!entry || typeof entry !== 'object') {
      fail(where + ' is not an object');
      return;
    }
    if (typeof entry.name !== 'string' || !entry.name) {
      fail(where + ' has no name');
    }
    if (STATUSES.indexOf(entry.status) === -1) {
      fail(where + ' has status ' + JSON.stringify(entry.status) +
        ', which is not one of: ' + STATUSES.join(', '));
    }
    if (KINDS.indexOf(entry.kind) === -1) {
      fail(where + ' has kind ' + JSON.stringify(entry.kind) +
        ', which is not one of: ' + KINDS.join(', '));
    }
    if (typeof entry.withdraw_when !== 'string' ||
        entry.withdraw_when.trim().length < 20) {
      fail(where + ' does not say when it is to be withdrawn: a fingerprint ' +
        'that outlives its reason is the next one nobody can explain');
    }

    // THE ORIGIN IS THE WHOLE POINT. It is refused empty, refused as a
    // placeholder, and refused when it is too short to say anything: the
    // failure this gate exists for was a value nobody could trace, and
    // "unknown" written in the origin field would reproduce it exactly.
    if (typeof entry.origin !== 'string' || entry.origin.trim().length < 40) {
      fail(where + ' has no written origin (a sentence saying which key ' +
        'produced this fingerprint, at least 40 characters)');
    } else if (PLACEHOLDERS.test(entry.origin.trim())) {
      fail(where + ' has a placeholder origin: ' + JSON.stringify(entry.origin));
    }
    if (typeof entry.reproduce !== 'string' || entry.reproduce.trim().length < 10) {
      fail(where + ' has no `reproduce` command: an origin nobody can ' +
        'recompute is a claim, not a record');
    }

    if (entry.status === 'awaited') {
      if (entry.sha256 !== null) {
        fail(where + ' is awaited but already carries a fingerprint: ' +
          'a slot waiting for a key holds null');
      }
      return;
    }

    if (typeof entry.sha256 !== 'string' || !FINGERPRINT.test(entry.sha256)) {
      fail(where + ' has a fingerprint that is not 32 uppercase hex bytes ' +
        'separated by colons: ' + JSON.stringify(entry.sha256));
      return;
    }
    if (Object.prototype.hasOwnProperty.call(known, entry.sha256)) {
      fail(where + ' repeats the fingerprint of "' + known[entry.sha256] +
        '": one key, one entry');
      return;
    }
    known[entry.sha256] = entry.name;

    if (entry.status === 'vouched') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.measured_on || '')) {
        fail(where + ' is vouched without a `measured_on` date (YYYY-MM-DD): ' +
          'a fingerprint nobody has measured is not vouched for');
      } else {
        vouched[entry.sha256] = entry.name;
        vouchedKinds[entry.sha256] = entry.kind;
      }
    }
  });
}

// ── 1 bis. The package name is the SHELL'S, not this file's opinion ──────
//
// assetlinks.json names an application. If `applicationId` moves in
// android/app/build.gradle.kts and this file does not, Android looks for a
// statement about a package that is no longer served and link verification
// stops -- silently, and only on devices, and only after an install. It is
// the same shape of defect as the unattributed fingerprint: a file
// declaring something that stopped being true, with nothing to notice.
//
// READ-ONLY, and outside this directory on purpose: the shell is the
// authority on its own identifier, and this gate follows it rather than
// asserting a copy. `root` is honoured so the mutation checks can aim
// elsewhere; when they do, the comparison is simply skipped.
if (registry && !process.argv[2]) {
  var gradle = path.join(
    __dirname,
    '../../../packages/app/android/app/build.gradle',
  );
  var declared = null;
  try {
    // Groovy, not the Kotlin DSL: `applicationId "eu.messagr"` with no
    // `=`. The repository moved and the build file changed dialect with it;
    // a pattern that still wanted `= "..."` matched nothing and this check
    // could only ever fail.
    declared = /^\s*applicationId\s+"([^"]+)"/m.exec(
      fs.readFileSync(gradle, 'utf8'),
    );
  } catch (e) {
    fail('cannot read packages/app/android/app/build.gradle (' + e.code + '): the ' +
      'package name assetlinks.json declares cannot be checked against the ' +
      'shell that has to carry it');
  }
  if (declared && declared[1] !== registry.package_name) {
    fail('the Android shell declares applicationId "' + declared[1] +
      '" and this registry declares "' + registry.package_name + '". ' +
      'assetlinks.json would name an application nobody installs, and link ' +
      'verification would fail on the device with nothing reporting it.');
  }
}

// ── 2. assetlinks.json ───────────────────────────────────────────────────
var assetlinks = readJson('site/.well-known/assetlinks.json');

if (assetlinks) {
  if (!Array.isArray(assetlinks)) {
    fail('assetlinks.json is not an array of statements');
    assetlinks = [];
  }
  assetlinks.forEach(function (statement, index) {
    var where = 'assetlinks statement #' + index;
    var keys = Object.keys(statement || {}).sort();
    if (keys.join(',') !== 'relation,target') {
      fail(where + ' carries the keys [' + keys.join(', ') + ']: a Digital ' +
        'Asset Links statement holds `relation` and `target` and nothing ' +
        'else. Notes belong in android-fingerprints.json, which Android ' +
        'never reads.');
      return;
    }
    if (!Array.isArray(statement.relation) ||
        statement.relation.indexOf('delegate_permission/common.handle_all_urls') === -1) {
      fail(where + ' does not delegate handle_all_urls');
    }
    var target = statement.target || {};
    if (target.namespace !== 'android_app') {
      fail(where + ' has namespace ' + JSON.stringify(target.namespace) +
        ', expected "android_app"');
    }
    if (registry && target.package_name !== registry.package_name) {
      fail(where + ' names the package ' + JSON.stringify(target.package_name) +
        ', while the registry declares ' + JSON.stringify(registry.package_name));
    }
    if (!Array.isArray(target.sha256_cert_fingerprints)) {
      fail(where + ' has no sha256_cert_fingerprints array');
      return;
    }
    target.sha256_cert_fingerprints.forEach(function (print) {
      if (typeof print !== 'string' || !FINGERPRINT.test(print)) {
        fail(where + ' declares a fingerprint that is not 32 uppercase hex ' +
          'bytes separated by colons: ' + JSON.stringify(print));
        return;
      }
      if (Object.prototype.hasOwnProperty.call(seen, print)) {
        fail(where + ' declares ' + print + ' twice');
        return;
      }
      seen[print] = true;

      if (!Object.prototype.hasOwnProperty.call(known, print)) {
        fail('assetlinks.json declares a fingerprint that NO registry entry ' +
          'records:\n    ' + print + '\n  Nothing says which key produced ' +
          'it, so nothing can say whether it is right. Add an entry to ' +
          'android-fingerprints.json naming the key and the command that ' +
          'reproduces the value, or remove the fingerprint.');
        return;
      }
      if (!Object.prototype.hasOwnProperty.call(vouched, print)) {
        fail('assetlinks.json declares ' + print + ', registered as "' +
          known[print] + '" but NOT vouched for. Only a `vouched` entry -- ' +
          'one whose origin is written and whose value has been measured -- ' +
          'may be served to Android.');
      }
    });
  });
}

// ── 2 bis. THE DEBUG KEY, ASKED OF WHAT IS SERVED AND NOT OF WHAT IS KEPT ─
//
// WHAT THIS RULE SAYS. A debug fingerprint and a publication fingerprint may
// not be SERVED from assetlinks.json at the same time. A debug keystore that
// Android will accept as a claimant of messagr.eu links is one file, carrying
// a password Google documents, standing between anybody who holds it and the
// invitation links. It is tolerable only while nothing else can do the job.
//
// WHAT IT SAID UNTIL 17 AUGUST 2026, AND WHY THAT WAS THE WRONG QUESTION.
// It read the REGISTRY: `vouchedKinds.debug && vouchedKinds.release`, firing
// the moment a publication key was recorded, whatever assetlinks.json
// contained. The harm its own comment named was a debug key "in a production
// assetlinks.json"; the condition it evaluated was a debug key in the ledger.
// Those are different facts, and the registry's own header says so -- "a
// fingerprint may appear in assetlinks.json only if it appears here with
// status `vouched`" makes vouching a PRECONDITION of serving, not the act of
// it. `vouched` means somebody wrote down which key this is and how to
// recompute it. The Makefile states the subject of this gate in one line:
// "no signing fingerprint may be SERVED unless android-fingerprints.json
// records which key produced it."
//
// WHAT THAT MISMATCH COST, MEASURED. On 17 August 2026 the publication key
// was traced to the maintainer's keystore and vouched -- an act of pure
// record-keeping, changing nothing that any device can reach. This rule fired
// on it, and `scripts/check-apk-signing.sh` refuses any state in which
// `debug-local` is NOT vouched, because the debug lane of `apk.yml` holds the
// certificate it reads off its artefact against that entry. No registry state
// satisfied both gates; all three were tried on a copy and all three failed.
// The deadlock was manufactured entirely by asking the ledger a question that
// is about the deployment.
//
// WHAT IS NOT DECIDED HERE, AND IT IS THE PART THAT MATTERS.
//
// This is a correction of what the rule MEASURES. It is not an answer to when
// the debug key goes, and it deliberately does not become one. The rule's
// original premise -- that a debug install is disposable, so the debug key can
// be withdrawn as soon as a real one exists -- is false in this repository:
// AGENTS.md §7.2 freezes the demonstration Pixel on its debug signature and
// forbids uninstalling it, and an uninstall is the only way an install changes
// signature. So the day the publication fingerprint is added to
// assetlinks.json -- which is what publishing to any other device needs -- this
// rule fires again, and it fires on a state that is genuinely contested rather
// than on a bookkeeping entry.
//
// THAT IS THE INTENDED BEHAVIOUR AND NOT AN OVERSIGHT. The rule's own promise
// is to fire "on the right day rather than the day someone remembers". Today
// nothing but the debug key is served and no decision is due. On the day both
// must be served, one is. A proposal for what the rule should say then -- and
// what it costs the Pixel and the friend's phone either way -- is in
// .superpowers/sdd/2026-08-17-publication/task-M-report.md. It is a decision
// for the maintainer, so it is written down and not coded in.
var servedKinds = {};
Object.keys(seen).forEach(function (print) {
  var kind = vouchedKinds[print];
  if (kind) { servedKinds[kind] = known[print]; }
});

if (servedKinds.debug && (servedKinds.release || servedKinds.store)) {
  fail('assetlinks.json SERVES the debug key "' + servedKinds.debug +
    '" alongside "' + (servedKinds.release || servedKinds.store) + '". A ' +
    'debug keystore Android will accept as a claimant of messagr.eu links is ' +
    'one file, carrying a documented password, and it is tolerable only while ' +
    'nothing else can open those links.\n' +
    '  THE REMEDY IS NOT AUTOMATIC, and this refusal is not asking for the ' +
    'obvious one. AGENTS.md §7.2 freezes the demonstration Pixel on its debug ' +
    'signature and forbids the uninstall that changing it would require, so ' +
    'removing ' + servedKinds.debug + ' from assetlinks.json stops ' +
    'https://messagr.eu/i/<token> opening the application on a device that ' +
    'cannot be migrated. Read the debug entry\'s `withdraw_when` in ' +
    'android-fingerprints.json, and task-M-report.md, before choosing.');
}

// ── 3. The AASA: verified, and pinned so it stays verified ───────────────
//
// This file is NOT changed by this task. It declares
// KUT463DS29.cloud.maudet.messagr, which is the decision of 16 August 2026:
// the iOS bundle identifier aligns on the value already deployed rather
// than the deployed file being chased to match the shell. iOS caches the
// AASA on the device, so the value that is already out there is the cheaper
// of the two to keep. What follows pins that decision.
var aasa = readJson('site/.well-known/apple-app-site-association');

if (aasa) {
  var details = ((aasa.applinks || {}).details) || [];
  if (!Array.isArray(details) || details.length === 0) {
    fail('the AASA declares no applinks.details');
    details = [];
  }
  var coversInvitations = false;
  details.forEach(function (detail, index) {
    var where = 'AASA detail #' + index;
    var appIDs = detail.appIDs || detail.appID;
    if (typeof appIDs === 'string') { appIDs = [appIDs]; }
    if (!Array.isArray(appIDs) || appIDs.length === 0) {
      fail(where + ' declares no appIDs');
      appIDs = [];
    }
    appIDs.forEach(function (appID) {
      // The placeholder guard deploy.sh already carries, held here too so
      // it fails on a laptop and in CI and not only at the moment of
      // deployment -- iOS caches this file, and a placeholder served once
      // stays served.
      if (/APPLE_TEAM_ID/.test(appID)) {
        fail(where + ' still carries the APPLE_TEAM_ID placeholder');
        return;
      }
      var parts = /^([A-Z0-9]{10})\.(.+)$/.exec(appID);
      if (!parts) {
        fail(where + ' has an appID that is not <10-character team ID>.' +
          '<bundle identifier>: ' + JSON.stringify(appID));
        return;
      }
      // ONE IDENTIFIER FOR BOTH STORES, and this is where that holds. The
      // bundle half of the appID is the Android package name: the same
      // string names the application on both platforms, so a change on one
      // side cannot pass unnoticed on the other.
      if (registry && parts[2] !== registry.package_name) {
        fail(where + ' declares the bundle ' + JSON.stringify(parts[2]) +
          ', while the Android package is ' +
          JSON.stringify(registry.package_name) + '. The two are the same ' +
          'identifier by the decision of 16 August 2026.');
      }
    });
    // `/i*` is one pattern covering both link shapes the vhost serves:
    // `/i/<token>` today and the bare `/i` the compact payload will use.
    (detail.components || []).forEach(function (component) {
      if (component['/'] === '/i*') { coversInvitations = true; }
    });
  });
  if (!coversInvitations) {
    fail('the AASA covers no component `{"/": "/i*"}`: the invitation links ' +
      'would not open the application. Both /i/<token> and the bare /i are ' +
      'served by nginx-messagr-eu.conf and both must be covered.');
  }
}

if (status === 0) {
  // COUNTED ON WHAT IS SERVED, not on what the registry holds. A summary
  // line that reported the registry would say "1 fingerprint" for a file
  // declaring none, and a gate that misreports its own subject is the
  // defect this file exists for, one level up.
  var served = Object.keys(seen);
  console.log('app-links: assetlinks.json serves ' + served.length +
    ' fingerprint(s), each vouched for by a written origin' +
    (served.length ? ' (' + served.map(function (p) {
      return known[p];
    }).join(', ') + ')' : '') +
    '; the AASA holds its team ID, its bundle and /i*');
}
process.exit(status);
