import { describe, expect, it } from 'vitest'

import { oneMachine, type MachineStart } from './oneMachine'

const nothingInQuestion = () => false

/** The creation a start was granted, and a failure if it was granted anything else. */
function creation(start: MachineStart) {
  if (start.kind !== 'create') {
    throw new Error(`expected to create a machine, was answered ${start.kind}`)
  }
  return start
}

/** The wait a start was handed, and a failure if it was handed anything else. */
function waiting(start: MachineStart) {
  if (start.kind !== 'wait') {
    throw new Error(
      `expected to wait for a machine, was answered ${start.kind}`,
    )
  }
  return start
}

describe('oneMachine', () => {
  it('creates one machine, and every later start for that device reuses it', () => {
    const machines = oneMachine(nothingInQuestion)
    creation(machines.start('DEVICE1')).settle(true)
    expect(machines.start('DEVICE1')).toEqual({ kind: 'reuse' })
  })

  it('never creates a machine for another device beside one that exists or is being created', () => {
    // The rule this whole guard is for: a second machine in one process is not
    // something this application does, whichever device it would serve.
    const machines = oneMachine(nothingInQuestion)
    const creating = creation(machines.start('OLDDEVICE'))
    expect(machines.start('NEWDEVICE').kind).toBe('refused')
    creating.settle(true)
    expect(machines.start('NEWDEVICE').kind).toBe('refused')
  })

  it('makes a start that arrives during a creation wait for it, rather than create a second', async () => {
    // A wake and a launch reaching the same device at once. The second used to
    // create again, against the same store.
    const machines = oneMachine(nothingInQuestion)
    const creating = creation(machines.start('DEVICE1'))
    const second = waiting(machines.start('DEVICE1'))
    creating.settle(true)
    expect(await second.created).toBe(true)
  })

  it('counts a machine as running from the moment its creation begins', () => {
    // So a launch that looks after somebody answers sees a wake's machine even
    // while the library is still creating it.
    const machines = oneMachine(nothingInQuestion)
    expect(machines.running()).toBe(false)
    creation(machines.start('DEVICE1'))
    expect(machines.running()).toBe(true)
  })

  it('creates nothing while this device decides whether to leave its account', () => {
    // Read at the moment a machine would start, not once beforehand: a wake
    // that began before the question is put reaches this line after it.
    let inQuestion = true
    const machines = oneMachine(() => inQuestion)
    expect(machines.start('OLDDEVICE').kind).toBe('refused')
    expect(machines.running()).toBe(false)
    inQuestion = false
    expect(machines.start('NEWDEVICE').kind).toBe('create')
  })

  it('frees the context when a creation fails', async () => {
    const machines = oneMachine(nothingInQuestion)
    const creating = creation(machines.start('DEVICE1'))
    const second = waiting(machines.start('DEVICE1'))
    creating.settle(false)
    expect(await second.created).toBe(false)
    expect(machines.running()).toBe(false)
    expect(machines.start('DEVICE2').kind).toBe('create')
  })
})
