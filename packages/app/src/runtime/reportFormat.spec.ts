import { describe, expect, it } from 'vitest'

import { reportAad } from './reportFormat'

function hex(of: Uint8Array): string {
  return Array.from(of, b => b.toString(16).padStart(2, '0')).join('')
}

describe('What binds a report to its reason and its reporting account', () => {
  it('lays both fields out as the format says: two length bytes, then the ASCII', () => {
    // Written from the format's description, byte by byte: 10 is 0x000a,
    // « harassment » in ASCII, 18 is 0x0012, « @alice:example.org » in ASCII.
    expect(
      hex(reportAad({ reason: 'harassment', reporter: '@alice:example.org' })),
    ).toBe(
      '000a' +
        '6861726173736d656e74' +
        '0012' +
        '40616c6963653a6578616d706c652e6f7267',
    )
  })

  it('tells a reason from an account, whatever their lengths', () => {
    // The same eleven characters, cut in two places: a plain concatenation
    // would give both the same bytes.
    const cutEarly = reportAad({ reason: 'ab', reporter: '@c:d.example' })
    const cutLate = reportAad({ reason: 'ab@', reporter: 'c:d.example' })

    expect(hex(cutEarly)).not.toBe(hex(cutLate))
  })

  it('refuses a field it could not write back the same way', () => {
    const reporter = '@alice:example.org'
    for (const reason of [
      '',
      'two words',
      'harcèlement',
      'tab\there',
      'line\nbreak',
      'x'.repeat(256),
    ]) {
      expect(() => reportAad({ reason, reporter })).toThrow(RangeError)
    }
    expect(() => reportAad({ reason: 'harassment', reporter: '' })).toThrow(
      RangeError,
    )
    expect(() =>
      reportAad({ reason: 'harassment', reporter: '@é:example.org' }),
    ).toThrow(RangeError)
  })

  it('takes a Matrix user ID up to the 255 characters the specification allows', () => {
    const longest = `@${'a'.repeat(242)}:example.org`
    expect(longest).toHaveLength(255)

    expect(reportAad({ reason: 'threat', reporter: longest })).toHaveLength(
      2 + 6 + 2 + 255,
    )
  })
})
