import { describe, expect, it } from 'vitest'

import { keepPhotograph, readDataUri, type Keeping } from './keepPhotograph'

const JPEG = 'data:image/jpeg;base64,QUJD'

function keeping(over: Partial<Keeping> = {}) {
  const done: string[] = []
  const deps: Keeping = {
    temporary: '/tmp',
    write: async path => {
      done.push(`write ${path}`)
    },
    keep: async path => {
      done.push(`keep ${path}`)
    },
    forget: async path => {
      done.push(`forget ${path}`)
    },
    name: () => 'one',
    ...over,
  }
  return { deps, done }
}

describe('what a data URI carries', () => {
  it('reads the bytes and the extension the gallery needs', () => {
    expect(readDataUri(JPEG)).toEqual({ extension: 'jpg', base64: 'QUJD' })
  })

  it('knows the kinds this product can send', () => {
    expect(readDataUri('data:image/png;base64,QQ==')?.extension).toBe('png')
    expect(readDataUri('data:image/webp;base64,QQ==')?.extension).toBe('webp')
    expect(readDataUri('data:image/heic;base64,QQ==')?.extension).toBe('heic')
  })

  it('refuses a kind it has no extension for rather than guessing', () => {
    // A gallery decides what a file is by its extension. A `.jpg` holding
    // something else is a picture the person finds and cannot open.
    expect(readDataUri('data:application/pdf;base64,QQ==')).toBeNull()
  })

  it('refuses anything that is not a base64 data URI', () => {
    expect(readDataUri('https://example.test/a.jpg')).toBeNull()
    expect(readDataUri('data:image/jpeg,not-base64')).toBeNull()
    expect(readDataUri('')).toBeNull()
  })

  it('does not stop at a newline inside the payload', () => {
    // Base64 wraps in some encoders, and `.` without `s` would cut it there.
    expect(readDataUri('data:image/png;base64,QQ\n==')?.base64).toBe('QQ\n==')
  })
})

describe('keeping a photograph', () => {
  it('writes, hands over, and forgets, in that order', async () => {
    const { deps, done } = keeping()
    expect(await keepPhotograph(deps, JPEG)).toEqual({ kept: true })
    expect(done).toEqual([
      'write /tmp/one.jpg',
      'keep /tmp/one.jpg',
      'forget /tmp/one.jpg',
    ])
  })

  it('forgets the plaintext even when the hand-over fails', async () => {
    // The whole reason the removal is in a `finally`: a failure that left a
    // decrypted photograph on the disk would be exactly the defect ADR-0006
    // exists to prevent.
    const { deps, done } = keeping({
      keep: async () => {
        throw new Error('the gallery said no')
      },
    })
    expect(await keepPhotograph(deps, JPEG)).toEqual({
      kept: false,
      reason: 'the gallery said no',
    })
    expect(done).toContain('forget /tmp/one.jpg')
  })

  it('forgets the plaintext even when the write half-succeeded', async () => {
    const { deps, done } = keeping({
      write: async () => {
        throw new Error('the disk is full')
      },
    })
    expect(await keepPhotograph(deps, JPEG)).toEqual({
      kept: false,
      reason: 'the disk is full',
    })
    expect(done).toEqual(['forget /tmp/one.jpg'])
  })

  it('still reports the photograph when the removal is what failed', async () => {
    // A temporary file that will not delete is one the system clears on its
    // own. Saying so would replace the sentence about the picture with one
    // about housekeeping.
    const { deps } = keeping({
      forget: async () => {
        throw new Error('busy')
      },
    })
    expect(await keepPhotograph(deps, JPEG)).toEqual({ kept: true })
  })

  it('touches no disk at all for something that is not a photograph', async () => {
    const { deps, done } = keeping()
    const kept = await keepPhotograph(deps, 'https://example.test/a.jpg')
    expect(kept.kept).toBe(false)
    expect(done).toEqual([])
  })

  it('gives each photograph a name of its own', async () => {
    let n = 0
    const { deps, done } = keeping({ name: () => `n${(n += 1)}` })
    await keepPhotograph(deps, JPEG)
    await keepPhotograph(deps, JPEG)
    expect(done.filter(one => one.startsWith('keep'))).toEqual([
      'keep /tmp/n1.jpg',
      'keep /tmp/n2.jpg',
    ])
  })
})
