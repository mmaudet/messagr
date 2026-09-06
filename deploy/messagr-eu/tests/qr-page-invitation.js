// THE PAGE'S QR ENCODER, PINNED ON A KNOWN VECTOR.
//
// The page carries a SECOND QR encoder. The first lives in the core, and the
// share specification put it there so there would be only one; a web page
// cannot reach the core, and the content security policy forbids any external
// script, so this one is the price of the desktop QR.
//
// That price is only worth paying if the encoder is guarded. It was written
// on 11 August 2026 and was WRONG THREE TIMES before it was right:
//
//   - the BCH remainder for the version information was computed with a loop
//     that cleared the wrong bits;
//   - the same defect in the format information;
//   - the fifteen format bits were written LEAST significant first, when the
//     placement runs from bit 14 at (8,0) down to bit 0 at (0,8);
//   - and the second copy of those bits took eight rows instead of seven,
//     overwriting the DARK MODULE at (side-8, 8), which is always set.
//
// None of those made the encoder throw. Each one produced a well-formed,
// good-looking symbol that no reader could decode. That is exactly why this
// test compares module by module against a vector, instead of checking that
// the function returns something.
//
// The vector was verified end to end before being pinned: rendered to pixels
// and handed to an independent decoder, which read back the exact link.
'use strict';

var fs = require('fs');
var path = require('path');

var racine = path.join(__dirname, '..');
var page = fs.readFileSync(path.join(racine, 'site/i/index.html'), 'utf8');
var attendu = fs.readFileSync(path.join(__dirname, 'qr-vecteur-attendu.txt'), 'utf8')
  .trim().split('\n');

var LIEN = 'https://messagr.eu/i/eyJ2IjoxLCJzIjoiaHR0cHM6Ly9tZXNzYWdyLmV1L19tZX' +
  'NzYWdyIiwidCI6IjAxMjM0NTY3ODlhYmNkZWYwMTIzNDU2Nzg5YWJjZGVmMDEyMzQ1NjciLCJjIj' +
  'oiIUFiQ2RFZkdoSWpLbE1uT3BRcjptZXNzYWdyLmV1IiwiZiI6IldOaFJaZ3RWNk5wRVFIVWVFdl' +
  'VCdjkyY2lpZEdGR1crREV6blhlV2pzZXciLCJuIjoiQ2FtaWxsZSJ9';

var script = /<script>([\s\S]*?)<\/script>/.exec(page);
if (!script) { echouer('the page carries no script'); }

function echouer(message) {
  console.error('qr: FAIL: ' + message);
  process.exit(1);
}

// THE TEST DRIVES THE PAGE, IT DOES NOT COPY IT. The script is run as the
// browser would run it, against a canvas that records what was painted; the
// matrix is then rebuilt from those rectangles. A test that re-implemented
// the drawing would pass while the page stayed broken.
var rectangles = [];
var toile = {
  width: 0, height: 0, hidden: true,
  getContext: function () {
    return {
      set fillStyle(v) { toile.teinte = v; },
      get fillStyle() { return toile.teinte; },
      fillRect: function (x, y, w, h) { rectangles.push([x, y, w, h, toile.teinte]); }
    };
  }
};
var muet = {
  textContent: '', hidden: true,
  appendChild: function () {}, addEventListener: function () {}
};

global.document = {
  getElementById: function (id) { return id === 'qr' ? toile : muet; },
  createElement: function () { return {}; }
};
// A desktop agent: neither iPhone nor Android, which is the only branch that
// draws the symbol.
//
// `defineProperty` and not a plain assignment: Node ships its own `navigator`
// global since version 21, and it is getter-only — assigning to it throws.
Object.defineProperty(global, 'navigator', {
  value: { userAgent: 'Mozilla/5.0 (X11; Linux x86_64)', maxTouchPoints: 0 },
  configurable: true,
  writable: true
});
global.location = { href: LIEN };

/* eslint-disable no-eval */
eval(script[1]);

if (toile.hidden) { echouer('the canvas stayed hidden: no symbol was drawn'); }

// The first rectangle is the light ground; the others are the dark modules,
// each one pixel wider than a module so no hairline separates neighbours.
var fond = rectangles[0];
if (fond[4] !== '#ffffff') { echouer('the ground is not light: ' + fond[4]); }
var echelle = rectangles[1][2] - 1;
var silence = 4;
var cote = Math.round(toile.width / echelle) - 2 * silence;

if (cote !== attendu.length) {
  echouer('side ' + cote + ', the vector pins ' + attendu.length);
}

var grille = [];
for (var i = 0; i < cote; i++) { grille.push(new Array(cote).fill('0')); }
for (var r = 1; r < rectangles.length; r++) {
  if (rectangles[r][4] !== '#0C1F19') {
    echouer('a module is painted ' + rectangles[r][4] + ', not the charter ink');
  }
  var c = Math.round(rectangles[r][0] / echelle) - silence;
  var l = Math.round(rectangles[r][1] / echelle) - silence;
  if (l < 0 || l >= cote || c < 0 || c >= cote) {
    echouer('a module falls outside the symbol, at (' + l + ',' + c + ')');
  }
  grille[l][c] = '1';
}

var ecarts = 0;
for (var y = 0; y < cote; y++) {
  if (grille[y].join('') !== attendu[y]) { ecarts++; }
}
if (ecarts > 0) {
  echouer(ecarts + ' rows out of ' + cote + ' differ from the pinned vector. ' +
    'If the encoder changed on purpose, re-pin the vector — but PROVE the new ' +
    'symbol decodes first, because every past defect produced a symbol that ' +
    'looked perfectly fine.');
}

console.log('qr: the page draws the pinned symbol, ' + cote + ' modules a side');
