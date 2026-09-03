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
| `icons/*.svg` | The icon set, 18 glyphs. Geometry matches `tokens.json`'s `icon` family exactly: 24 grid, 1.5 stroke, round cap and join, `currentColor`. |

Everything here comes from the designer's export. Do not hand-edit it: a local
change makes this a second source of truth, and the drift is silent. Corrections
go back to the designer and return through the next export.

## Resolved in this export

Five families were missing and are now present: `space` (the v1 spacing scale,
reintegrated), `stroke` (border weights, including the agent dotted border's
exact pattern and a per-platform implementation note), `state.disabled` (what
"greyed" means: no opacity, a fixed text/surface pair, the reason always fully
readable), `zIndex` (stacking order, with the incoming-call-over-modal rule
made explicit) and `icon` (the grid and stroke this file's SVGs already used).
`color.dark` also arrived: a full second palette, one role for one role with
the light side, plus a rule that dark surfaces get lighter rather than more
shadowed as they rise.

The floors scope is fixed too: `bodySizeMin` now applies to `body` only,
`monoSizeMin` replaces the old `monoLabelSizeMin` and covers `monoId` as well,
and a new `titleLineHeightRatioMin` (1.2) covers the title roles instead of
holding them to the running-text ratio. Independently re-verified: all eight
`type` roles pass every floor that applies to them, where four used to fail.

Nothing that was already there changed value. The only edits to existing
entries are two added cross-references (`color.agent.border` now points at
`stroke.agentDotted`; `color.neutral.200` now mentions `state.disabled`).
