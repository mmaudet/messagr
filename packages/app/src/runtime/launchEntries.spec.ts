import { describe, expect, it } from 'vitest'

import { launchEntries } from './launchEntries'

describe('launchEntries', () => {
  it('treats the first entry of a context as its launch, however the link arrived', () => {
    // iOS may hand the launch link over as an event before the launch reads
    // it, and a process a wake started may open its first screen long after it
    // began. Neither is a link handed to a running application: the first
    // entry of this context is the launch, whatever came before it.
    expect(launchEntries().begin().cold).toBe(true)
  })

  it('counts an entry that begins before the first one has ended as the same launch', () => {
    // One opening can reach the launch twice. Whichever delivery comes second
    // is still the launch's link, not a link handed over later.
    const entries = launchEntries()
    const first = entries.begin()
    expect(entries.begin().cold).toBe(true)
    first.end()
  })

  it('treats an entry that begins once the first has ended as a link handed to a running application', () => {
    const entries = launchEntries()
    entries.begin().end()
    expect(entries.begin().cold).toBe(false)
  })

  it('ends the launch with its first entry and with no other', () => {
    const entries = launchEntries()
    const first = entries.begin()
    const second = entries.begin()
    second.end()
    expect(entries.begin().cold).toBe(true)
    first.end()
    expect(entries.begin().cold).toBe(false)
  })
})
