import { by, device, element, expect as detoxExpect } from 'detox'

/**
 * The boot contract, asserted on a real device rather than in configuration.
 *
 * Everything here was verified by hand first, screenshot by screenshot. This
 * suite exists so that the next change does not have to be.
 *
 * Assertions match on the rendered text rather than on a testID with
 * `toHaveText`. Under the New Architecture the latter finds the view and
 * reads a null string from it on Android, so it fails on a correct screen.
 * Matching the text asserts the same thing: that the value reached the
 * display.
 */
describe('boot', () => {
  beforeAll(async () => {
    await device.launchApp({ newInstance: true })
  })

  it('runs on the New Architecture', async () => {
    // The crypto bridge is a JSI turbo module with no legacy mode, so this is
    // a precondition for everything below rather than a nice-to-have.
    await detoxExpect(element(by.text('enabled: true'))).toBeVisible()
    await detoxExpect(element(by.text('fabric: true'))).toBeVisible()
  })

  it('leaves no runtime gap open', async () => {
    await detoxExpect(element(by.id('runtime-gaps'))).toBeVisible()
    await detoxExpect(element(by.text('none'))).toBeVisible()
  })

  it('creates a Matrix client', async () => {
    // Reported as created only when the transport carries no crypto backend
    // of its own, so this also asserts the single-implementation invariant of
    // ADR-0001.
    await detoxExpect(
      element(by.text('client created, https://homeserver.invalid')),
    ).toBeVisible()
  })

  it('loads the crypto bridge across the JSI boundary', async () => {
    await detoxExpect(
      element(by.text('loaded, core 0.1.0+emit.f6ddf39b')),
    ).toBeVisible()
  })
})
