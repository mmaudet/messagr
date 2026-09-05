import { afterEach, describe, expect, it, vi } from 'vitest'

import type { LogFields } from './log'
import { logEvent } from './log'

function captured(level: 'info' | 'warn' | 'error', fields: LogFields): string {
  const method = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'
  const spy = vi.spyOn(console, method).mockImplementation(() => undefined)
  logEvent(level, 'EVENT', fields)
  const line = String(spy.mock.calls.at(-1)?.[0])
  return line
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('writing an event', () => {
  it('writes the event name and its fields', () => {
    expect(captured('info', { a: 1, b: 'two' })).toBe('EVENT {"a":1,"b":"two"}')
  })

  it('writes errors through console.error and warnings through console.warn', () => {
    expect(captured('error', { a: 1 })).toContain('EVENT')
    expect(captured('warn', { a: 1 })).toContain('EVENT')
  })
})

describe('a field that cannot be serialised', () => {
  function cyclical(): LogFields {
    const loop: Record<string, unknown> = { name: 'loop' }
    loop.self = loop
    return loop
  }

  it('does not throw, which is the whole point', () => {
    // The defect this exists for: one `JSON.stringify(fields)` threw inside
    // the effect that drives the launch, so the report killed the thing it
    // was reporting on. Every screen below stayed empty and the only evidence
    // was the exception from the line whose job was to explain.
    expect(() => logEvent('info', 'EVENT', { bad: cyclical() })).not.toThrow()
  })

  it('keeps every field it can and names the one it lost', () => {
    const line = captured('info', {
      good: 'kept',
      bad: cyclical(),
      alsoGood: 42,
    })
    const body = JSON.parse(line.slice('EVENT '.length)) as Record<
      string,
      unknown
    >
    expect(body.good).toBe('kept')
    expect(body.alsoGood).toBe(42)
    expect(body.bad).toBeUndefined()
    expect(body._unserialisable).toEqual(['bad'])
  })

  it('names every lost field, not just the first', () => {
    const line = captured('info', {
      one: cyclical(),
      two: cyclical(),
      fine: true,
    })
    const body = JSON.parse(line.slice('EVENT '.length)) as Record<
      string,
      unknown
    >
    expect(body._unserialisable).toEqual(['one', 'two'])
    expect(body.fine).toBe(true)
  })

  it('still says something when nothing at all can be serialised', () => {
    // A getter that throws, a proxy, a `toJSON` that does: the failure is not
    // in any one field, so the field-by-field pass fails too. Throwing here
    // would be the behaviour this function exists to stop.
    const hostile = {
      get boom(): never {
        throw new Error('no')
      },
    }
    let line = ''
    expect(() => {
      line = captured('info', hostile)
    }).not.toThrow()
    expect(line).toContain('_unserialisable')
  })
})
