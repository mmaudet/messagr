import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { isValidElement, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { TabIcon, type TabGlyph } from './TabIcon'

/**
 * The glyphs, held to the files they were transcribed from.
 *
 * `TabIcon` says the files in `design/icons/` stay the source and that it is
 * their transcription, geometry verbatim. So the expected shapes are read from
 * the file rather than copied here: a copy in this spec would be a second
 * transcription, checked against the first.
 *
 * `react-native-svg` cannot load in Node, and to a glyph its components are
 * only the names of the shapes it draws, so that is what they become.
 */

vi.mock('react-native-svg', () => ({
  default: 'Svg',
  Circle: 'Circle',
  Path: 'Path',
  Rect: 'Rect',
}))

const TINT = 'tint'

/** What each shape is made of, in the file's own attribute names. */
const GEOMETRY: Readonly<Record<string, readonly string[]>> = {
  path: ['d'],
  circle: ['cx', 'cy', 'r'],
  rect: ['x', 'y', 'width', 'height', 'rx'],
}
const PAINT = ['stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin']

type Shape = Readonly<Record<string, string | undefined>>

function shapeOf(
  element: string,
  read: (attribute: string) => string | undefined,
): Shape {
  // `2.4` and `2.40` are one number, and a path is not a number at all.
  const same = (value: string | undefined) =>
    value === undefined || value === '' || Number.isNaN(Number(value))
      ? value
      : String(Number(value))
  return Object.fromEntries([
    ['element', element],
    ...[...(GEOMETRY[element] ?? []), ...PAINT].map(attribute => [
      attribute,
      same(read(attribute)),
    ]),
  ])
}

function attributesIn(tag: string): Readonly<Record<string, string>> {
  return Object.fromEntries(
    [...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, name, value]) => [
      name,
      value,
    ]),
  )
}

/** The shapes a file in `design/icons/` draws, in its order. */
function inFile(name: string): Shape[] {
  const svg = readFileSync(
    join(__dirname, '../../../../design/icons', name),
    'utf8',
  )
  // The stroke is set once, on the group, and every shape inherits it.
  const group = attributesIn(svg.match(/<g\b([^>]*)>/)?.[1] ?? '')
  return [...svg.matchAll(/<(path|circle|rect)\b([^>]*)>/g)].map(
    ([, element, tag]) => {
      const own = attributesIn(tag)
      return shapeOf(element, attribute => own[attribute] ?? group[attribute])
    },
  )
}

/** The shapes `TabIcon` draws for `glyph`, in its order. */
function drawn(glyph: TabGlyph): Shape[] {
  const shapes: Shape[] = []
  const walk = (node: ReactNode): void => {
    if (Array.isArray(node)) {
      node.forEach(walk)
      return
    }
    if (!isValidElement<Record<string, unknown>>(node)) return
    const element = typeof node.type === 'string' ? node.type.toLowerCase() : ''
    if (element in GEOMETRY) {
      shapes.push(
        shapeOf(element, attribute => {
          const value =
            node.props[attribute.replace(/-(\w)/g, (_, c) => c.toUpperCase())]
          // `currentColor` becomes the tint, which is the set's whole rule
          // about colour.
          if (value === TINT) return 'currentColor'
          return value === undefined ? undefined : String(value)
        }),
      )
    }
    walk(node.props.children as ReactNode)
  }
  walk(TabIcon({ glyph, tint: TINT }))
  return shapes
}

describe('the glyphs of the call controls', () => {
  it.each([
    ['cam.off', 'messagr-icon-cam.off.svg'],
    ['flip', 'messagr-icon-flip.svg'],
  ] as const)('draws %s as %s does, shape for shape', (glyph, file) => {
    const expected = inFile(file)
    // A file read as empty would match a glyph that draws nothing.
    expect(expected.length).toBeGreaterThan(0)
    expect(drawn(glyph)).toEqual(expected)
  })
})
