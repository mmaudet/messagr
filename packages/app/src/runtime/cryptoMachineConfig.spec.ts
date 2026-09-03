import { describe, expect, it } from 'vitest'

import { computeCryptoMachineConfig } from './cryptoMachineConfig'

describe('computeCryptoMachineConfig', () => {
  it('derives a store path from storeDir and the device id', () => {
    const config = computeCryptoMachineConfig(
      { userId: '@alice:example.org', deviceId: 'DEVICE1' },
      '/data/user/0/com.messagr/files',
    )
    expect(config).toEqual({
      userId: '@alice:example.org',
      deviceId: 'DEVICE1',
      storePath: '/data/user/0/com.messagr/files/crypto/DEVICE1',
      storePassphrase: expect.any(String),
    })
  })

  it('is null when the host supplied no writable directory', () => {
    expect(
      computeCryptoMachineConfig(
        { userId: '@alice:example.org', deviceId: 'DEVICE1' },
        '',
      ),
    ).toBeNull()
  })

  it('keys the path by device id, so two accounts never collide', () => {
    const storeDir = '/files'
    const a = computeCryptoMachineConfig(
      { userId: '@alice:example.org', deviceId: 'DEVICE1' },
      storeDir,
    )
    const b = computeCryptoMachineConfig(
      { userId: '@bob:example.org', deviceId: 'DEVICE2' },
      storeDir,
    )
    expect(a?.storePath).not.toBe(b?.storePath)
  })
})
