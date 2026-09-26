import { describe, expect, it, vi } from 'vitest'

const finalizeOprf = vi.fn()

vi.mock('react-native-matrix-crypto', () => ({
  blindOprf: vi.fn(),
  finalizeOprf: (...args: unknown[]) => finalizeOprf(...args),
  isCryptoError: (e: unknown) =>
    typeof e === 'object' && e !== null && 'kind' in e,
}))

import { bridgeMasking } from './bridgeMasking'

const blinding = { blindedElements: [new Uint8Array([1])] }
const finalize = () =>
  bridgeMasking.finalize(
    blinding,
    [new Uint8Array([2])],
    new Uint8Array([3]),
    new Uint8Array([4]),
  )

describe("the bridge's masking", () => {
  it('hands the bridge the blinding it returned, and gives back the outputs', async () => {
    finalizeOprf.mockResolvedValueOnce([new Uint8Array([9])])

    expect(await finalize()).toEqual([new Uint8Array([9])])
    expect(finalizeOprf.mock.calls[0]?.[0]).toBe(blinding)
  })

  it('reads a batch proof that does not verify as an answer not from the published key', async () => {
    finalizeOprf.mockRejectedValueOnce({ kind: 'proof_rejected' })

    expect(await finalize()).toBe('not-the-published-key')
  })

  it('throws any other failure on', async () => {
    finalizeOprf.mockRejectedValueOnce({ kind: 'malformed_payload' })

    await expect(finalize()).rejects.toEqual({ kind: 'malformed_payload' })
  })
})
