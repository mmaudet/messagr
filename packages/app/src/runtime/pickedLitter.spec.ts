import { describe, expect, it } from 'vitest'

import {
  isOurs,
  isPickedLitter,
  sweepPickedLitter,
  type Sweeping,
} from './pickedLitter'

const OURS = ['/data/user/0/eu.messagr/cache', '/data/user/0/eu.messagr/files']

describe('whether a path is this application’s to remove', () => {
  it('recognises a file in one of its own directories', () => {
    expect(isOurs('/data/user/0/eu.messagr/cache/a.jpg', OURS)).toBe(true)
  })

  it('sees through a file:// scheme, on either side', () => {
    expect(isOurs('file:///data/user/0/eu.messagr/cache/a.jpg', OURS)).toBe(
      true,
    )
    expect(isOurs('/tmp/a.jpg', ['file:///tmp'])).toBe(true)
  })

  it('refuses a photograph in the gallery, which is the whole point', () => {
    // A module that unlinked whatever path it was handed would be one bad
    // answer away from deleting somebody's picture.
    expect(isOurs('/storage/emulated/0/DCIM/Camera/IMG_1.jpg', OURS)).toBe(
      false,
    )
  })

  it('is not fooled by a directory whose name merely starts the same', () => {
    expect(isOurs('/data/user/0/eu.messagr/cache-elsewhere/a.jpg', OURS)).toBe(
      false,
    )
  })

  it('tolerates a trailing separator on the root', () => {
    expect(isOurs('/tmp/a.jpg', ['/tmp/'])).toBe(true)
  })

  it('answers no when it has no directory of its own to compare against', () => {
    expect(isOurs('/tmp/a.jpg', [])).toBe(false)
    expect(isOurs('/tmp/a.jpg', [''])).toBe(false)
  })
})

describe('what a picked photograph leaves behind', () => {
  it('knows the picker’s own copies by their prefix', () => {
    expect(
      isPickedLitter('rn_image_picker_lib_temp_48451c81-83d2-49cc-bb1b-b.jpg'),
    ).toBe(true)
  })

  it('knows the resizer’s output by its shape', () => {
    expect(isPickedLitter('6965a6dc-01cd-406b-9427-c7e9380bc1ab.JPEG')).toBe(
      true,
    )
  })

  it('leaves everything else in that directory alone', () => {
    // The web view, the notification library, the HTTP cache. A sweep that
    // guessed would one day delete something that mattered.
    for (const name of [
      'WebView',
      'http-cache',
      'notifee_core_database.lck',
      'data',
      'index.android.bundle',
      // Close to the resizer's shape and not it: a lowercase extension, a
      // name that is not a uuid, a uuid with something appended.
      '6965a6dc-01cd-406b-9427-c7e9380bc1ab.jpg',
      'photo.JPEG',
      '6965a6dc-01cd-406b-9427-c7e9380bc1ab.JPEG.bak',
    ]) {
      expect(isPickedLitter(name)).toBe(false)
    }
  })
})

describe('sweeping what earlier versions left', () => {
  function sweeping(over: Partial<Sweeping> = {}) {
    const gone: string[] = []
    const deps: Sweeping = {
      directories: ['/cache'],
      list: async () => [
        'rn_image_picker_lib_temp_a.jpg',
        '6965a6dc-01cd-406b-9427-c7e9380bc1ab.JPEG',
        'http-cache',
        'notifee_core_database.lck',
      ],
      forget: async path => {
        gone.push(path)
      },
      ...over,
    }
    return { deps, gone }
  }

  it('removes both shapes and nothing else', async () => {
    const { deps, gone } = sweeping()
    expect(await sweepPickedLitter(deps)).toBe(2)
    expect(gone).toEqual([
      '/cache/rn_image_picker_lib_temp_a.jpg',
      '/cache/6965a6dc-01cd-406b-9427-c7e9380bc1ab.JPEG',
    ])
  })

  it('walks every directory it was given', async () => {
    const { deps, gone } = sweeping({
      directories: ['/cache', '/tmp'],
      list: async () => ['rn_image_picker_lib_temp_a.jpg'],
    })
    await sweepPickedLitter(deps)
    expect(gone).toEqual([
      '/cache/rn_image_picker_lib_temp_a.jpg',
      '/tmp/rn_image_picker_lib_temp_a.jpg',
    ])
  })

  it('carries on past a directory it cannot read', async () => {
    // A launch must not be less likely to succeed because of housekeeping.
    const { deps, gone } = sweeping({
      directories: ['/gone', '/cache'],
      list: async directory => {
        if (directory === '/gone') throw new Error('no such directory')
        return ['rn_image_picker_lib_temp_a.jpg']
      },
    })
    expect(await sweepPickedLitter(deps)).toBe(1)
    expect(gone).toEqual(['/cache/rn_image_picker_lib_temp_a.jpg'])
  })

  it('carries on past a file it cannot remove, and does not count it', async () => {
    const { deps } = sweeping({
      forget: async path => {
        if (path.endsWith('.JPEG')) throw new Error('busy')
      },
    })
    expect(await sweepPickedLitter(deps)).toBe(1)
  })

  it('removes nothing on a telephone with nothing to remove', async () => {
    const { deps, gone } = sweeping({ list: async () => ['WebView'] })
    expect(await sweepPickedLitter(deps)).toBe(0)
    expect(gone).toEqual([])
  })
})
