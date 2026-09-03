import { describe, expect, it } from 'vitest'

import { fetchBridgeStatus } from './cryptoBridge'

// The core reverses the payload by contract, to prove the bytes made a real
// round trip rather than being handed back untouched by a stub.
const echo = (input: string, payload: Uint8Array) =>
  Promise.resolve({
    echoed: input,
    payload: payload.slice().reverse(),
    coreVersion: '0.3.0',
  })

describe('fetchBridgeStatus', () => {
  it('reports the core version when the round trip is faithful', async () => {
    await expect(fetchBridgeStatus(echo)).resolves.toEqual({
      loaded: true,
      coreVersion: '0.3.0',
    })
  })

  it('refuses a bridge that alters the text it echoes', async () => {
    const status = await fetchBridgeStatus((_input, payload) =>
      Promise.resolve({
        echoed: 'something else',
        payload,
        coreVersion: '0.3.0',
      }),
    )
    expect(status.loaded).toBe(false)
  })

  it('refuses a bridge that returns the bytes unreversed', async () => {
    const status = await fetchBridgeStatus((input, payload) =>
      Promise.resolve({ echoed: input, payload, coreVersion: '0.3.0' }),
    )
    expect(status.loaded).toBe(false)
  })

  it('refuses a bridge that returns unrelated bytes', async () => {
    const status = await fetchBridgeStatus(input =>
      Promise.resolve({
        echoed: input,
        payload: new Uint8Array([9, 9, 9]),
        coreVersion: '0.3.0',
      }),
    )
    expect(status.loaded).toBe(false)
  })

  it('refuses a bridge that names no core version', async () => {
    const status = await fetchBridgeStatus((input, payload) =>
      Promise.resolve({ echoed: input, payload, coreVersion: '' }),
    )
    expect(status.loaded).toBe(false)
  })

  it('carries the reason when the native module is absent', async () => {
    const status = await fetchBridgeStatus(() =>
      Promise.reject(new Error('module not found')),
    )
    expect(status).toEqual({ loaded: false, reason: 'module not found' })
  })

  it('survives a rejection that is not an Error', async () => {
    const status = await fetchBridgeStatus(() => Promise.reject('nope'))
    expect(status.loaded).toBe(false)
  })
})
