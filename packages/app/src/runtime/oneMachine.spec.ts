import { describe, expect, it } from 'vitest'

import { accountsInQuestion } from './accountInQuestion'
import { oneMachine, type MachineStart } from './oneMachine'

const OLD = { userId: '@old:bench.example', deviceId: 'OLDDEVICE' }
const NEW = { userId: '@new:messagr.eu', deviceId: 'NEWDEVICE' }

const anyDevice = () => true

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
    const machines = oneMachine(anyDevice)
    creation(machines.start(OLD)).settle(true)
    expect(machines.start(OLD)).toEqual({ kind: 'reuse' })
  })

  it('never creates a machine for another device beside one that exists or is being created', () => {
    // The rule this whole guard is for: a second machine in one process is not
    // something this application does, whichever device it would serve.
    const machines = oneMachine(anyDevice)
    const creating = creation(machines.start(OLD))
    expect(machines.start(NEW).kind).toBe('refused')
    creating.settle(true)
    expect(machines.start(NEW).kind).toBe('refused')
  })

  it('makes a start that arrives during a creation wait for it, rather than create a second', async () => {
    // A wake and a launch reaching the same device at once. The second used to
    // create again, against the same store.
    const machines = oneMachine(anyDevice)
    const creating = creation(machines.start(OLD))
    const second = waiting(machines.start(OLD))
    creating.settle(true)
    expect(await second.created).toBe(true)
  })

  it('counts a machine as running from the moment its creation begins', () => {
    // So a launch that looks after somebody answers sees a wake's machine even
    // while the library is still creating it.
    const machines = oneMachine(anyDevice)
    expect(machines.running()).toBe(false)
    creation(machines.start(OLD))
    expect(machines.running()).toBe(true)
  })

  it('creates no machine for a device it is told not to, asked at that moment', () => {
    // Asked at the moment a machine would start, not once beforehand: a wake
    // that began before a question was put reaches this line after it.
    let mayCreate = false
    const machines = oneMachine(() => mayCreate)
    expect(machines.start(OLD).kind).toBe('refused')
    expect(machines.running()).toBe(false)
    mayCreate = true
    expect(machines.start(OLD).kind).toBe('create')
  })

  it('grants another account its machine while one account is in question', () => {
    // Found in review on 14 September 2026: the question used to refuse every
    // creation, whichever account it was for.
    const questions = accountsInQuestion()
    const machines = oneMachine(questions.mayCreateMachineFor)
    questions.hold(OLD)
    expect(machines.start(OLD).kind).toBe('refused')
    expect(machines.start(NEW).kind).toBe('create')
  })

  it('refuses a stale wake the departed account’s machine, and grants the next account its own', () => {
    // A wake that read the old session before the departure reaches this line
    // after it, and finds that device closed for the rest of the process.
    const questions = accountsInQuestion()
    const machines = oneMachine(questions.mayCreateMachineFor)
    const question = questions.hold(OLD)
    question.departed()
    question.lift()
    expect(machines.start(OLD).kind).toBe('refused')
    expect(machines.running()).toBe(false)
    expect(machines.start(NEW).kind).toBe('create')
  })

  it('frees the context when a creation fails', async () => {
    const machines = oneMachine(anyDevice)
    const creating = creation(machines.start(OLD))
    const second = waiting(machines.start(OLD))
    creating.settle(false)
    expect(await second.created).toBe(false)
    expect(machines.running()).toBe(false)
    expect(machines.start(NEW).kind).toBe('create')
  })

  it('makes the machine once itself when the creation it waited for failed', async () => {
    // Found in review on 14 September 2026. A wake on a locked screen began
    // the machine and could not make it, the person opened the application
    // meanwhile, and the launch that had waited for the wake gave up there.
    const machines = oneMachine(anyDevice)
    const wake = creation(machines.start(OLD))
    const made: string[] = []
    const launch = machines.open(OLD, async () => {
      made.push('by the launch')
    })
    wake.settle(false)
    expect(await launch).toEqual({ started: true })
    expect(made).toEqual(['by the launch'])
    expect(machines.start(OLD)).toEqual({ kind: 'reuse' })
  })

  it('makes it only once, and says why when that fails too', async () => {
    const machines = oneMachine(anyDevice)
    const wake = creation(machines.start(OLD))
    let attempts = 0
    const launch = machines.open(OLD, async () => {
      attempts += 1
      throw new Error('the store would not open')
    })
    wake.settle(false)
    expect(await launch).toEqual({
      started: false,
      reason: 'the store would not open',
    })
    expect(attempts).toBe(1)
    expect(machines.running()).toBe(false)
  })
})
