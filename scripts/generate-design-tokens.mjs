#!/usr/bin/env node
//
// design/tokens.json -> packages/app/src/design/tokens.ts
//
// # Why this is generated rather than written
//
// A hand-kept mirror of a token file drifts, and the question is when rather
// than whether. But copying would not be enough on its own either: the token
// file is authored for two targets and a reader, not for React Native. It
// carries `$ref` indirections, tracking in `em`, shadows as CSS strings, and
// prose alongside every value. Translating those is work a mirror would have
// to do by hand every time, which is the drift.
//
// # Why the floors are checked here
//
// The floors are constraints, not values: a minimum body size, a minimum
// mono size, minimum line-height ratios. They mean nothing unless something
// can fail on them, and the moment a violation could enter the codebase is
// this one. So a token that breaks a floor stops the build here, with the
// arithmetic shown, rather than being emitted and trusted.
//
// The lint is the other half and enforces a different thing: that the
// application uses these values rather than literals. Together they are what
// makes interface invariant 11 a rule instead of a sentence.
//
// Usage:
//   node scripts/generate-design-tokens.mjs           write the module
//   node scripts/generate-design-tokens.mjs --check    fail if it is stale

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { format, resolveConfig } from 'prettier'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = join(root, 'design/tokens.json')
const TARGET = join(root, 'packages/app/src/design/tokens.ts')

const tokens = JSON.parse(readFileSync(SOURCE, 'utf8'))

/**
 * Keys that address a reader rather than a renderer. `$`-prefixed by
 * convention, but the file also carries bare `note` and `use` alongside real
 * values -- prose that has no business in a shipped module.
 */
const isMeta = key => key.startsWith('$') || key === 'note' || key === 'use'

const entries = object => Object.entries(object).filter(([key]) => !isMeta(key))

/** Resolves a `{ "$ref": "space.l" }` indirection against the whole file. */
function resolveRef(path) {
  const value = path
    .split('.')
    .reduce((node, key) => (node === undefined ? undefined : node[key]), tokens)
  if (value === undefined) {
    throw new Error(`token $ref "${path}" points at nothing`)
  }
  return value && typeof value === 'object' && 'value' in value
    ? value.value
    : value
}

// ---------------------------------------------------------------- the floors

/**
 * Checked against the token set itself, and loudly. Each floor declares the
 * `type` class it applies to, because a floor without a scope is
 * unenforceable -- a mono size held to the system-font minimum would be a
 * false defect, and one held to nothing at all would be no floor.
 */
function assertFloors() {
  const { floors, type } = tokens
  const failures = []

  const sizeFloor = (name, floor) => {
    for (const [key, spec] of entries(type)) {
      if (!floor.appliesTo.includes(spec.class)) continue
      if (spec.size < floor.value) {
        failures.push(
          `type.${key}.size is ${spec.size}${floor.unit ?? ''}, below floors.${name} (${floor.value}${floor.unit ?? ''})`,
        )
      }
    }
  }

  const ratioFloor = (name, floor) => {
    for (const [key, spec] of entries(type)) {
      if (!floor.appliesTo.includes(spec.class)) continue
      const ratio = spec.lineHeight / spec.size
      if (ratio < floor.value) {
        failures.push(
          `type.${key} has a line-height ratio of ${ratio.toFixed(3)} (${spec.lineHeight}/${spec.size}), below floors.${name} (${floor.value})`,
        )
      }
    }
  }

  sizeFloor('bodySizeMin', floors.bodySizeMin)
  sizeFloor('monoSizeMin', floors.monoSizeMin)
  ratioFloor('lineHeightRatioMin', floors.lineHeightRatioMin)
  ratioFloor('titleLineHeightRatioMin', floors.titleLineHeightRatioMin)

  // Every type class must be covered by at least one floor, or a class added
  // later would inherit no minimum at all -- a floor that silently stops
  // applying is worse than one that was never written.
  //
  // At least one, not a size floor each: the title classes deliberately have
  // no size minimum, because the file says they are above it by
  // construction, and they carry a line-height floor of their own instead.
  // Demanding a size floor here invented a rule the design had not made, and
  // this check reported it as a defect in the tokens -- which is the right
  // failure and the wrong subject.
  const covered = new Set(
    Object.values(floors)
      .filter(floor => Array.isArray(floor?.appliesTo))
      .flatMap(floor => floor.appliesTo),
  )
  for (const [key, spec] of entries(type)) {
    if (!covered.has(spec.class)) {
      failures.push(
        `type.${key} is class "${spec.class}", which no floor covers at all`,
      )
    }
  }

  if (failures.length > 0) {
    console.error('design tokens break their own floors:')
    for (const failure of failures) console.error(`  - ${failure}`)
    process.exit(1)
  }
}

// ------------------------------------------------------------- the emitters

const quote = value =>
  typeof value === 'string' ? `'${value.replace(/'/g, "\\'")}'` : String(value)

/**
 * `-0.03em` is a ratio of the font size, and React Native's `letterSpacing`
 * is points. The multiplication has to happen somewhere, and doing it here
 * means it happens once rather than at every call site.
 */
function letterSpacing(tracking, size) {
  const em = Number.parseFloat(tracking)
  return Number.parseFloat((em * size).toFixed(3))
}

/**
 * `0 12px 28px rgba(12,31,25,.06)` is CSS, and React Native has no shadow
 * shorthand: it wants an offset, a radius, a colour and an opacity as four
 * separate properties, plus an `elevation` number that only Android reads.
 */
function shadow(css) {
  const match =
    /^(-?[\d.]+)\w*\s+(-?[\d.]+)px\s+([\d.]+)px\s+rgba\(([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]*)\)$/.exec(
      css,
    )
  if (match === null) {
    throw new Error(`elevation "${css}" is not a shadow this can translate`)
  }
  const [, x, y, blur, r, g, b, alpha] = match
  const hex = [r, g, b]
    .map(channel => Number(channel).toString(16).padStart(2, '0'))
    .join('')
  return {
    shadowColor: `#${hex}`,
    shadowOffset: { width: Number(x), height: Number(y) },
    shadowRadius: Number(blur),
    shadowOpacity: Number(`0${alpha}`),
    // Android reads only this one, and reads it as a depth rather than a
    // geometry. Derived from the blur so the two stay in step, with a floor
    // of 1: rounding a 1px blur to zero would turn the lowest shadow in the
    // set into no shadow at all, which is the one thing it must not be.
    elevation: Math.max(1, Math.round(Number(blur) / 4)),
  }
}

const serialise = (value, indent = '  ') => {
  if (value === null || typeof value !== 'object') return quote(value)
  const inner = Object.entries(value)
    .map(([key, v]) => `${indent}  ${key}: ${serialise(v, `${indent}  `)},`)
    .join('\n')
  return `{\n${inner}\n${indent}}`
}

function emitSpace() {
  const lines = entries(tokens.space)
    .filter(([, value]) => typeof value === 'number')
    .map(([key, value]) => `  ${key}: ${value},`)
  return `/**\n * The spacing scale. Every margin, padding and gap comes from here.\n *\n * ${tokens.space.$forbidden}\n */\nexport const space = {\n${lines.join('\n')}\n} as const\n`
}

function emitColor() {
  const groups = entries(tokens.color).map(([group, shades]) => {
    const lines = entries(shades).map(([name, spec]) => {
      const value = typeof spec === 'object' ? spec.value : spec
      // Read directly rather than through `entries`, which now drops prose:
      // here the prose is the point. Every colour states what it is for, and
      // a palette whose reasons travelled separately would be one nobody
      // could apply correctly.
      const use = typeof spec === 'object' && spec.use ? ` // ${spec.use}` : ''
      return `    ${JSON.stringify(name)}: ${quote(value)},${use}`
    })
    return `  ${group}: {\n${lines.join('\n')}\n  },`
  })
  return `/**\n * ${tokens.$meta.note}\n */\nexport const color = {\n${groups.join('\n')}\n} as const\n`
}

function emitType() {
  const groups = entries(tokens.type).map(([name, spec]) => {
    const style = {
      fontSize: spec.size,
      lineHeight: spec.lineHeight,
      fontWeight: String(spec.weight),
    }
    if (spec.tracking !== undefined) {
      style.letterSpacing = letterSpacing(spec.tracking, spec.size)
    }
    if (spec.transform !== undefined) style.textTransform = spec.transform
    return `  ${name}: ${serialise(style)},`
  })
  return `/**\n * The type ramp, as React Native styles rather than as design values:\n * spread one into a style and the size, leading, weight and tracking travel\n * together. Splitting them is how a line-height floor gets broken.\n */\nexport const type = {\n${groups.join('\n')}\n} as const\n`
}

function emitElevation() {
  const groups = entries(tokens.elevation).map(
    ([name, css]) => `  ${JSON.stringify(name)}: ${serialise(shadow(css))},`,
  )
  return `/**\n * Shadows, translated from CSS into the four properties React Native\n * wants plus the Android depth.\n *\n * ${tokens.elevation.$darkRule}\n */\nexport const elevation = {\n${groups.join('\n')}\n} as const\n`
}

function emitPlain(name, node, doc) {
  const walk = value => {
    if (value === null || typeof value !== 'object') return value
    if ('$ref' in value) return resolveRef(value.$ref)
    if ('value' in value && Object.keys(value).length <= 3) return value.value
    const out = {}
    for (const [key, child] of entries(value)) out[key] = walk(child)
    return Object.keys(out).length > 0 ? out : undefined
  }
  const body = entries(node)
    .map(([key, value]) => [key, walk(value)])
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `  ${JSON.stringify(key)}: ${serialise(value)},`)
  return `/**\n * ${doc}\n */\nexport const ${name} = {\n${body.join('\n')}\n} as const\n`
}

function emitFloors() {
  const body = entries(tokens.floors).map(
    ([key, spec]) => `  ${key}: ${quote(spec.value)},`,
  )
  return `/**\n * The contractual minimums, checked against the tokens above when this\n * module is generated. They are exported so a component can assert one it\n * cannot inherit -- a touch target's height is geometry, not a token.\n */\nexport const floors = {\n${body.join('\n')}\n} as const\n`
}

assertFloors()

const generated = [
  `// GENERATED FROM design/tokens.json -- DO NOT EDIT.`,
  `//`,
  `// Regenerate with \`yarn tokens\`. Continuous integration runs`,
  `// \`yarn tokens:check\`, so a stale copy of this file fails the build rather`,
  `// than drifting quietly away from the design it claims to carry.`,
  `//`,
  `// Source: ${tokens.$meta.source}, tokens v${tokens.$meta.version}`,
  ``,
  emitSpace(),
  emitColor(),
  emitType(),
  emitPlain('radius', tokens.radius, 'Corner radii.'),
  emitPlain('stroke', tokens.stroke, tokens.stroke.$note),
  emitPlain('icon', tokens.icon, tokens.icon.$note),
  emitPlain('notch', tokens.notch, tokens.notch.$note),
  emitElevation(),
  emitPlain('zIndex', tokens.zIndex, tokens.zIndex.$note),
  emitPlain('motion', tokens.motion, 'Durations and easings.'),
  emitPlain('layout', tokens.layout, 'Layout geometry, with $refs resolved.'),
  emitFloors(),
].join('\n')

// Formatted here rather than left to the repository's formatter. Two tools
// writing one file disagree the moment either changes its mind, and the
// disagreement surfaces as a staleness failure with no stale token in it.
// Emitting what `prettier --check` already accepts removes the argument.
const formatted = await format(generated, {
  ...(await resolveConfig(TARGET)),
  parser: 'typescript',
})

if (process.argv.includes('--check')) {
  let existing = ''
  try {
    existing = readFileSync(TARGET, 'utf8')
  } catch {
    console.error(`${TARGET} does not exist. Run \`yarn tokens\`.`)
    process.exit(1)
  }
  if (existing !== formatted) {
    console.error(
      `${TARGET} is stale: design/tokens.json has moved on. Run \`yarn tokens\`.`,
    )
    process.exit(1)
  }
  console.log('design tokens are current')
} else {
  writeFileSync(TARGET, formatted)
  console.log(`wrote ${TARGET}`)
}
