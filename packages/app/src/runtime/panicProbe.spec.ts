import { describe, expect, it } from 'vitest'

import { probeUnsettledEncrypt, type ProbeMachine } from './panicProbe'

const IDENTITY = { userId: '@probe:example.invalid', deviceId: 'PROBEDEVICE' }

function machine(overrides: Partial<ProbeMachine> = {}): ProbeMachine {
  return {
    createCryptoMachine: async () => undefined,
    encryptEvent: async () => {
      throw new Error('Session wasn’t created nor shared')
    },
    getDeviceIdentityKeys: async () => ({ curve25519: 'c', ed25519: 'e' }),
    ...overrides,
  }
}

describe('probeUnsettledEncrypt', () => {
  it('reports a caught error, which is the answer that says the net holds', async () => {
    const report = await probeUnsettledEncrypt(machine(), IDENTITY, '/store')
    expect(report.outcome).toBe('caught')
    expect(report.detail).toContain('created nor shared')
    expect(report.stillAlive).toBe(true)
  })

  it('reports a machine that stopped answering afterwards, which is the worse outcome', async () => {
    // Alive with dead cryptography is barely better than dead, and much
    // harder to notice.
    const report = await probeUnsettledEncrypt(
      machine({
        getDeviceIdentityKeys: async () => {
          throw new Error('poisoned')
        },
      }),
      IDENTITY,
      '/store',
    )
    expect(report.outcome).toBe('caught')
    expect(report.stillAlive).toBe(false)
  })

  it('reports an encrypt that unexpectedly succeeded, rather than calling that a pass', async () => {
    // If this ever happens the probe is not asking what it thinks it is:
    // a session existed, and nothing was learned about panics.
    const report = await probeUnsettledEncrypt(
      machine({ encryptEvent: async () => undefined }),
      IDENTITY,
      '/store',
    )
    expect(report.outcome).toBe('encrypted')
  })

  it('separates a machine that could not be created from the question being asked', async () => {
    const report = await probeUnsettledEncrypt(
      machine({
        createCryptoMachine: async () => {
          throw new Error('store unavailable')
        },
      }),
      IDENTITY,
      '/store',
    )
    expect(report.outcome).toBe('unavailable')
    expect(report.detail).toContain('store unavailable')
  })

  it('names a scope no session could exist for', async () => {
    let seen = ''
    await probeUnsettledEncrypt(
      machine({
        encryptEvent: async scope => {
          seen = scope
          throw new Error('no session')
        },
      }),
      IDENTITY,
      '/store',
    )
    expect(seen).toMatch(/^!/)
  })
})
