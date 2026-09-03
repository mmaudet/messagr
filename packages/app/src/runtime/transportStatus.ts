import { getErrorMessage } from './errors'

/**
 * Builds the Matrix transport client, and reports what came of it.
 *
 * Named for the status rather than the client because the client is not
 * returned: this answers whether the transport can be built here at all, and
 * whether it brought cryptography of its own.
 *
 * ADR-0001 allows exactly one crypto implementation in the binary, and it is
 * the native bridge. matrix-js-sdk carries a second behind `initRustCrypto`,
 * which this application never calls; asserting the result rather than
 * trusting the omission is what turns that decision into something a test can
 * hold.
 *
 * `usingExternalCrypto` is refused for a different and sharper reason. The
 * name reads like a description of exactly this architecture, which is the
 * trap: it does not tell matrix-js-sdk that crypto happens elsewhere, it
 * tells it to send plaintext into rooms it believes are encrypted, for an
 * end-to-end proxy that is archived. A flag whose name invites the mistake is
 * one to assert about rather than to leave at its default.
 *
 * No request is made. Constructing a client is a local act, and it is the
 * first place the polyfill layer is exercised for real: the constructor
 * reaches for `crypto.getRandomValues` before any network call.
 */
export interface TransportClient {
  getCrypto: () => unknown
  getHomeserverUrl: () => string
  // A property rather than a method, matching matrix-js-sdk's own shape, and
  // optional so a fake that predates this reads as the default the SDK
  // itself applies.
  usingExternalCrypto?: boolean
}

export type ClientFactory = (options: { baseUrl: string }) => TransportClient

export type TransportStatus =
  | { readonly created: true; readonly homeserver: string }
  | { readonly created: false; readonly reason: string }

export function computeTransportStatus(
  factory: ClientFactory,
  baseUrl: string,
): TransportStatus {
  let client: TransportClient
  try {
    client = factory({ baseUrl })
  } catch (cause: unknown) {
    return { created: false, reason: getErrorMessage(cause) }
  }

  if (client.getCrypto() != null) {
    return {
      created: false,
      reason: 'the transport initialised its own crypto backend',
    }
  }

  if (client.usingExternalCrypto === true) {
    return {
      created: false,
      reason: 'the transport would send plaintext into encrypted rooms',
    }
  }

  return { created: true, homeserver: client.getHomeserverUrl() }
}
