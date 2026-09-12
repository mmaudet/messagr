import { describe, expect, it } from 'vitest'

import { statedSize } from './documentSize'

describe('statedSize', () => {
  it('says nothing when the sender stated no size', () => {
    // Matrix makes `size` optional, and Android does not always carry one.
    // A row can head itself with a name and say nothing about the weight;
    // inventing « 0 Ko » would say something false about a real file.
    expect(statedSize(null)).toBeNull()
  })

  it('reads small files in kilobytes, rounded up to one', () => {
    // Zero kilobytes is not a size a person can act on, and every file that
    // exists weighs something.
    expect(statedSize(1)).toEqual({ key: 'file_size_kb %@', amount: '1' })
    expect(statedSize(12_800)).toEqual({ key: 'file_size_kb %@', amount: '13' })
  })

  it('reads larger files in megabytes, to one decimal', () => {
    expect(statedSize(1024 * 1024)).toEqual({
      key: 'file_size_mb %@',
      amount: '1.0',
    })
    expect(statedSize(3_500_000)).toEqual({
      key: 'file_size_mb %@',
      amount: '3.3',
    })
  })

  it('turns over at a megabyte, not at a million', () => {
    // A thousand kilobytes is not a megabyte here: the sizes a file manager
    // shows are binary, and a row disagreeing with the system's own file
    // list by five per cent is a row somebody double-checks.
    expect(statedSize(1024 * 1024 - 1)?.key).toBe('file_size_kb %@')
    expect(statedSize(1024 * 1024)?.key).toBe('file_size_mb %@')
  })
})
