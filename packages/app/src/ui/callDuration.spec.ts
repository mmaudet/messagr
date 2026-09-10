import { describe, expect, it } from 'vitest'

import { spokenFor } from './callDuration'

describe('how long a call lasted', () => {
  it('reads as a clock, the way the in-call screen printed it', () => {
    expect(spokenFor(222)).toBe('3:42')
  })

  it('pads the seconds so a single digit is not read as ten', () => {
    expect(spokenFor(65)).toBe('1:05')
  })

  it('shows a call under a minute as a minute of zero', () => {
    // Not "0:42 s" and not « moins d'une minute »: a duration column whose
    // rows are different shapes is a column nobody can scan.
    expect(spokenFor(42)).toBe('0:42')
  })

  it('has a zero to print, because a call can end in the second it began', () => {
    expect(spokenFor(0)).toBe('0:00')
  })

  it('grows an hour field rather than counting past sixty minutes', () => {
    expect(spokenFor(3905)).toBe('1:05:05')
  })

  it('does not pad the leading field, whichever field that is', () => {
    // `09:05` reads as nine hours five to anybody who has seen a duration
    // written out in full.
    expect(spokenFor(545)).toBe('9:05')
    expect(spokenFor(32_705)).toBe('9:05:05')
  })

  it('rounds rather than truncating, so a call is never a second short', () => {
    expect(spokenFor(59.6)).toBe('1:00')
  })

  it('prints a zero for anything that is not a duration', () => {
    // A file on a device can hold anything. `-1:-1` on a screen is worse
    // than a zero, and the store already refuses to write these.
    expect(spokenFor(-5)).toBe('0:00')
    expect(spokenFor(Number.NaN)).toBe('0:00')
    expect(spokenFor(Number.POSITIVE_INFINITY)).toBe('0:00')
  })
})
