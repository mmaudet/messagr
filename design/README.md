# Design

The V3 prototype export. `tokens.json` is normative: product spec §13.19,
invariant 11, forbids any colour, size, radius, elevation or duration in the
product that is not referenced from it.

| File | Status |
| --- | --- |
| `tokens.json` | The single source. Consumed by React Native as TypeScript and by Tauri as CSS variables. |
| `Messagr Prototype V3.dc.html` | The 41 screens. Authoritative for geometry, labels and icons. |
| `Messagr - tokens de design.dc.html` | Screen 41, which exposes the tokens. |
| `Messagr Prototype V2.dc.html` | Superseded by V3. Kept for history. |
| `support.js`, `image-slot.js` | Generated rendering engines. No specification value; present so the prototypes open. |

Everything here comes from the designer's export. Do not hand-edit it: a local
change makes this a second source of truth, and the drift is silent. Corrections
go back to the designer and return through the next export.

## Open point

`floors.lineHeightRatioMin` (1.35) and `floors.bodySizeMin` (11.5 pt) are stated
as applying to every entry of `type`. Four of the eight roles fail that reading:
`display` (1.20), `titleLg` (1.227) and `titleMd` (1.294) on line height, and
`monoId` (11 pt) on body size. Tight leading on large type is correct
typography, and `monoId` carries fingerprints and identifiers like `monoLabel`
does, so the scope of the floors is what needs narrowing, not the scale. A lint
written today must not enforce these two floors on headings or on `monoId`
until the next export settles it.
