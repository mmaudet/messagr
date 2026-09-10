// The one module that reaches a homeserver without matrix-js-sdk, kept thin
// for the reason `imageLibrary.ts` and `photoLibrary.ts` are: nothing worth
// unit-testing lives here. What it adapts to is `reenter.ts`'s `Reentering`,
// which the tests drive with two functions.
import { exists } from '@dr.pogodin/react-native-fs'

import type { Reentering } from './reenter'

/**
 * Two calls the SDK cannot make for us.
 *
 * `createClient` restores a session; it has no gesture for *replacing* one,
 * because replacing one means logging in as somebody who already has a
 * client. `/login` here is therefore made before any client exists, and
 * `/devices` is made with the token the login just handed back rather than
 * with the one the dead device held.
 *
 * A status and a parsed body rather than a throw: `401` is the middle of
 * user-interactive authentication and not a failure. See `retireDevice`.
 */
export function homeserverCalls(baseUrl: string): Reentering {
  const send = async (
    method: 'POST' | 'DELETE',
    path: string,
    body: unknown,
    bearer?: string,
  ) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(bearer === undefined ? {} : { Authorization: `Bearer ${bearer}` }),
      },
      body: JSON.stringify(body),
    })
    const text = await response.text()
    let parsed: unknown = null
    try {
      parsed = JSON.parse(text)
    } catch {
      // A body that is not JSON is a body with nothing to read. The status
      // is what every caller here actually decides on.
    }
    return { status: response.status, body: parsed }
  }

  return {
    post: async (path, body, bearer) => send('POST', path, body, bearer),
    remove: async (path, body, bearer) => send('DELETE', path, body, bearer),
  }
}

/**
 * Whether this session's crypto store is still on the disk.
 *
 * The path is `cryptoMachineConfig.ts`'s, spelled the same way and
 * deliberately not shared through a constant: that module builds it for the
 * library and this one asks about it before the library is given a chance to
 * create it. Two readers of one convention, which a comment can hold and an
 * import would quietly reverse -- asking `computeCryptoMachineConfig` would
 * mean handing this a passphrase it has no business seeing.
 *
 * `false` when the question cannot be asked. A launch that cannot read its
 * own directory should not conclude that a device was reinstalled and go
 * logging in again; it should carry on exactly as it did before, which is
 * what `afterReinstall` does with `storeExists: true`... and this is the one
 * place that is inverted on purpose. See its caller.
 */
export async function cryptoStoreExists(
  storeDir: string,
  deviceId: string,
): Promise<boolean> {
  if (storeDir === '' || deviceId === '') return true
  try {
    return await exists(`${storeDir}/crypto/${deviceId}`)
  } catch {
    // Unknown reads as present: the cost of being wrong here is a launch
    // that behaves as it always has, against a launch that replaces a
    // working device over a question it could not ask.
    return true
  }
}
