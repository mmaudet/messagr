import { describe, expect, it } from 'vitest'

import { computeCryptoMachineConfig } from './cryptoMachineConfig'

describe('computeCryptoMachineConfig', () => {
  it('derives a store path from storeDir and the device id', () => {
    const config = computeCryptoMachineConfig(
      { userId: '@alice:example.org', deviceId: 'DEVICE1' },
      '/data/user/0/eu.messagr/files',
      'a-passphrase',
    )
    expect(config).toEqual({
      userId: '@alice:example.org',
      deviceId: 'DEVICE1',
      storePath: '/data/user/0/eu.messagr/files/crypto/DEVICE1',
      // Handed in, not invented: the constant that used to live in the
      // source could open any device's store for anyone who read the
      // repository.
      storePassphrase: 'a-passphrase',
    })
  })

  it('is null when the host supplied no writable directory', () => {
    expect(
      computeCryptoMachineConfig(
        { userId: '@alice:example.org', deviceId: 'DEVICE1' },
        '',
        'a-passphrase',
      ),
    ).toBeNull()
  })

  it('keys the path by device id, so two accounts never collide', () => {
    const storeDir = '/files'
    const a = computeCryptoMachineConfig(
      { userId: '@alice:example.org', deviceId: 'DEVICE1' },
      storeDir,
      'a-passphrase',
    )
    const b = computeCryptoMachineConfig(
      { userId: '@bob:example.org', deviceId: 'DEVICE2' },
      storeDir,
      'a-passphrase',
    )
    expect(a?.storePath).not.toBe(b?.storePath)
  })
})
