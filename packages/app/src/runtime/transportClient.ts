/**
 * Builds the Matrix transport client, and refuses one that brought its own
 * cryptography.
 *
 * ADR-0001 allows exactly one crypto implementation in the binary, and it is
 * the native bridge. matrix-js-sdk carries a second one behind
 * `initRustCrypto`, which this application never calls; asserting the result
 * rather than trusting the omission is what turns that decision into
 * something a test can hold.
 *
 * No request is made here. Constructing a client is a local act, and it is
 * the first place the polyfill layer is exercised for real: the constructor
 * reaches for `crypto.getRandomValues` before any network call.
 */
export interface TransportClient {
  getCrypto: () => unknown
  getHomeserverUrl: () => string
}

export type ClientFactory = (options: { baseUrl: string }) => TransportClient

export type ClientStatus =
  | { readonly created: true; readonly homeserver: string }
  | { readonly created: false; readonly reason: string }

export function createTransportClient(
  factory: ClientFactory,
  baseUrl: string,
): ClientStatus {
  let client: TransportClient
  try {
    client = factory({ baseUrl })
  } catch (cause: unknown) {
    return {
      created: false,
      reason: cause instanceof Error ? cause.message : String(cause),
    }
  }

  if (client.getCrypto() != null) {
    return {
      created: false,
      reason: 'the transport initialised its own crypto backend',
    }
  }

  return { created: true, homeserver: client.getHomeserverUrl() }
}
