import { describe, expect, it, vi } from 'vitest'

import {
  subscribeToDeviceMessages,
  type CryptoMachineSyncFeed,
  type ToDeviceSource,
} from './toDeviceBridge'

function fakeSource(): ToDeviceSource & {
  emit: (payload: { message: unknown }) => void
} {
  let handler: ((payload: { message: unknown }) => void) | null = null
  return {
    on: (_event, h) => {
      handler = h
    },
    off: (_event, h) => {
      if (handler === h) handler = null
    },
    emit: payload => handler?.(payload),
  }
}

function fakeMachine(): CryptoMachineSyncFeed & {
  received: Array<{ to_device_events?: unknown[] }>
} {
  const received: Array<{ to_device_events?: unknown[] }> = []
  return {
    receiveSyncChanges: async delta => {
      received.push(delta)
    },
    received,
  }
}

describe('subscribeToDeviceMessages', () => {
  it('feeds an incoming message to the crypto machine as one to_device_events entry', async () => {
    const source = fakeSource()
    const machine = fakeMachine()
    subscribeToDeviceMessages(source, machine, () => {})

    const message = { type: 'm.room_key', sender: '@alice:example.org' }
    source.emit({ message })
    await Promise.resolve()

    expect(machine.received).toEqual([{ to_device_events: [message] }])
  })

  it('feeds each message as its own call, in arrival order', async () => {
    const source = fakeSource()
    const machine = fakeMachine()
    subscribeToDeviceMessages(source, machine, () => {})

    source.emit({ message: { id: 1 } })
    source.emit({ message: { id: 2 } })
    await Promise.resolve()

    expect(machine.received).toEqual([
      { to_device_events: [{ id: 1 }] },
      { to_device_events: [{ id: 2 }] },
    ])
  })

  it('reports a feed failure without throwing into the event source', async () => {
    const source = fakeSource()
    const machine: CryptoMachineSyncFeed = {
      receiveSyncChanges: async () => {
        throw new Error('malformed_payload')
      },
    }
    const onError = vi.fn()
    subscribeToDeviceMessages(source, machine, onError)

    source.emit({ message: { id: 1 } })
    await Promise.resolve()
    await Promise.resolve()

    expect(onError).toHaveBeenCalledWith(expect.any(Error))
  })

  it('returns an unsubscribe function that stops feeding further messages', async () => {
    const source = fakeSource()
    const machine = fakeMachine()
    const unsubscribe = subscribeToDeviceMessages(source, machine, () => {})

    unsubscribe()
    source.emit({ message: { id: 1 } })
    await Promise.resolve()

    expect(machine.received).toEqual([])
  })
})
