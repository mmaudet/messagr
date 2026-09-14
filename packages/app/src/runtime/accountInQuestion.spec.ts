import { describe, expect, it } from 'vitest'

import { accountsInQuestion } from './accountInQuestion'

const OLD = { userId: '@old:bench.example', deviceId: 'OLDDEVICE' }
const NEW = { userId: '@new:messagr.eu', deviceId: 'NEWDEVICE' }

/** Lets every settled promise run on before a test looks. */
const flush = () => new Promise(resolve => setImmediate(resolve))

describe('accountsInQuestion', () => {
  it('holds the device of the account in question, and no other', () => {
    // Found in review on 14 September 2026: a question that held every
    // creation kept any machine from being made while it waited, and a
    // question nobody answered kept that up for the life of the process.
    const questions = accountsInQuestion()
    questions.hold(OLD)
    expect(questions.mayCreateMachineFor(OLD)).toBe(false)
    expect(questions.mayCreateMachineFor(NEW)).toBe(true)
    // That account's device: the same device name on another account is not
    // in question.
    expect(
      questions.mayCreateMachineFor({ ...NEW, deviceId: OLD.deviceId }),
    ).toBe(true)
  })

  it('gives the device its machine back once the question is lifted', () => {
    const questions = accountsInQuestion()
    questions.hold(OLD).lift()
    expect(questions.mayCreateMachineFor(OLD)).toBe(true)
  })

  it('keeps a departed account’s device from any machine for the rest of the process', () => {
    // A wake that read the old session before its account departed can reach
    // the machine long after. That device is gone from this telephone, and a
    // machine made for it now would take the place of the next account's.
    const questions = accountsInQuestion()
    const question = questions.hold(OLD)
    question.departed()
    question.lift()
    expect(questions.mayCreateMachineFor(OLD)).toBe(false)
    expect(questions.mayCreateMachineFor(NEW)).toBe(true)
  })

  it('lets a run go on at once when its account is not in question, as before #304', async () => {
    // The same link into the same server, delivered twice: one run claims it,
    // and the other used to wait for that claim -- half a minute when the
    // issuer's application is slow to let the account in.
    expect(await accountsInQuestion().waitFor(OLD)).toBe(false)
  })

  it('makes a run wait while its account is in question, then says to look again', async () => {
    const questions = accountsInQuestion()
    const question = questions.hold(OLD)
    const waited: boolean[] = []
    questions.waitFor(OLD).then(answer => {
      waited.push(answer)
    })
    await flush()
    expect(waited).toEqual([])
    question.lift()
    await flush()
    expect(waited).toEqual([true])
  })

  it('says to look again at an account that departed before the run asked', async () => {
    const questions = accountsInQuestion()
    const question = questions.hold(OLD)
    question.departed()
    question.lift()
    expect(await questions.waitFor(OLD)).toBe(true)
  })

  it('is not lifted twice by the same lift', () => {
    // Module state, read by the wake. A lift called again must not lift a
    // question put since.
    const questions = accountsInQuestion()
    const first = questions.hold(OLD)
    first.lift()
    questions.hold(OLD)
    first.lift()
    expect(questions.mayCreateMachineFor(OLD)).toBe(false)
  })

  it('keeps the device held while another question still holds it', () => {
    const questions = accountsInQuestion()
    const first = questions.hold(OLD)
    const second = questions.hold(OLD)
    second.lift()
    expect(questions.mayCreateMachineFor(OLD)).toBe(false)
    first.lift()
    expect(questions.mayCreateMachineFor(OLD)).toBe(true)
  })
})
