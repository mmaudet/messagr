// Type-only: no matrix-js-sdk import reaches this module's runtime
// behaviour, only the shape `makePumpHttp` adapts to, the same discipline
// `sessionSync.ts` keeps for `SyncClient`.
import type { createClient } from 'matrix-js-sdk'

import { getErrorMessage } from './errors'

/**
 * The pump: the crypto machine hands out requests it needs sent, this module
 * sends them and feeds back the response, and feeds it what arrives down
 * sync. A product that never drains the queue encrypts to nobody, silently
 * and with no error.
 *
 * Routing follows matrix-js-sdk's own `OutgoingRequestProcessor`
 * (`rust-crypto/OutgoingRequestProcessor.ts`) rather than inventing a shape:
 * the raw authenticated request path, not the typed endpoint wrappers, which
 * take structured arguments and build the body themselves where the crypto
 * machine hands over an opaque pre-serialised JSON string.
 */

/** Mirrors `react-native-matrix-crypto`'s own `OutgoingRequest`, structurally: this module names no dependency on the package that produces it. */
export interface OutgoingRequest {
  readonly id: string
  readonly kind: string
  readonly body: string
}

/**
 * Thrown by a `HttpRequester` on a refused or failed send. `status` is `0`
 * for a failure that carried none at all, such as a dropped connection, a
 * DNS failure, or a timeout — matching what `markRequestFailed` itself asks
 * for.
 */
export class PumpHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'PumpHttpError'
  }
}

/**
 * What this module needs from the transport, and nothing more: matrix-js-sdk
 * is named nowhere here. `makePumpHttp` below is the one adapter that closes
 * the gap, the same split `sessionSync.ts` draws for `SyncClient`.
 */
export interface HttpRequester {
  authedRequest: (
    method: string,
    path: string,
    queryParams: Record<string, string>,
    body: string | undefined,
  ) => Promise<string>
}

/** What this module needs from the crypto machine to drive its outgoing side. */
export interface CryptoMachine {
  takeOutgoingRequests: () => Promise<readonly OutgoingRequest[]>
  markRequestSent: (id: string, responseJson: string) => Promise<void>
  markRequestFailed: (id: string, status: number) => Promise<void>
}

interface ParsedToDeviceBody {
  event_type?: unknown
  txn_id?: unknown
  messages?: unknown
}

interface ParsedRoomMessageBody {
  room_id?: unknown
  event_type?: unknown
  txn_id?: unknown
}

/**
 * Sends one request the pump handed out to the endpoint its `kind` names,
 * and returns the homeserver's own response body verbatim, for
 * `markRequestSent`. Throws (a `PumpHttpError`, if the request reached the
 * server and was refused) on anything else.
 *
 * `to_device` and `room_message` carry their own path segments inside `body`
 * itself, alongside the wire content this library never interprets — see
 * `OutgoingRequest`'s own documentation in react-native-matrix-crypto for
 * the two disclosed exceptions this reflects.
 */
export async function sendOutgoingRequest(
  http: HttpRequester,
  request: OutgoingRequest,
): Promise<string> {
  switch (request.kind) {
    case 'keys_upload':
      return http.authedRequest(
        'POST',
        '/_matrix/client/v3/keys/upload',
        {},
        request.body,
      )
    case 'keys_query':
      return http.authedRequest(
        'POST',
        '/_matrix/client/v3/keys/query',
        {},
        request.body,
      )
    case 'keys_claim':
      return http.authedRequest(
        'POST',
        '/_matrix/client/v3/keys/claim',
        {},
        request.body,
      )
    case 'signature_upload':
      return http.authedRequest(
        'POST',
        '/_matrix/client/v3/keys/signatures/upload',
        {},
        request.body,
      )
    case 'signing_keys_upload':
      // No UIA handling here: bootstrapCrossSigning is out of this ticket's
      // scope, and the endpoint's own 401-with-challenge is not a send this
      // function can retry blind. A caller that reaches this kind gets the
      // 401 back through PumpHttpError like any other refusal.
      return http.authedRequest(
        'POST',
        '/_matrix/client/v3/keys/device_signing/upload',
        {},
        request.body,
      )
    case 'to_device': {
      const parsed = JSON.parse(request.body) as ParsedToDeviceBody
      if (
        typeof parsed.event_type !== 'string' ||
        typeof parsed.txn_id !== 'string'
      ) {
        throw new Error(
          'a to_device request must name its event type and transaction id',
        )
      }
      const path =
        `/_matrix/client/v3/sendToDevice/${encodeURIComponent(parsed.event_type)}` +
        `/${encodeURIComponent(parsed.txn_id)}`
      return http.authedRequest(
        'PUT',
        path,
        {},
        JSON.stringify({ messages: parsed.messages }),
      )
    }
    case 'room_message': {
      const parsed = JSON.parse(request.body) as ParsedRoomMessageBody
      if (
        typeof parsed.room_id !== 'string' ||
        typeof parsed.event_type !== 'string' ||
        typeof parsed.txn_id !== 'string'
      ) {
        throw new Error(
          'a room_message request must name its room, event type and transaction id',
        )
      }
      const path =
        `/_matrix/client/v3/rooms/${encodeURIComponent(parsed.room_id)}/send/` +
        `${encodeURIComponent(parsed.event_type)}/${encodeURIComponent(parsed.txn_id)}`
      return http.authedRequest('PUT', path, {}, request.body)
    }
    default:
      // Not skipped. kind is an open tag, so a value this app cannot route
      // is a finding about the surface, not something to work around.
      throw new Error(
        `the pump handed out a request of kind "${request.kind}", which this app cannot route`,
      )
  }
}

export interface DrainResult {
  readonly sent: number
  readonly failed: number
  /**
   * The `kind` of each request that actually succeeded, in the order it was
   * sent. Not response bodies: `markRequestSent`'s own validation already
   * rejects a body that does not match its endpoint's documented shape, so a
   * `keys_upload` appearing here already proves the server answered with a
   * well-shaped `one_time_key_counts` — a caller that needs to know whether
   * one-time keys were published checks for the kind, not a parsed count.
   */
  readonly sentKinds: readonly string[]
  /**
   * What each failure was, in the order it happened: the request's `kind`
   * and the HTTP status that refused it (`0` when nothing HTTP did).
   *
   * A count alone says a drain failed without saying what to look at, and
   * the kinds differ in what a failure means -- a refused `signing_keys_upload`
   * is a server asking for interactive authentication, while a refused
   * `to_device` is a message that did not arrive. Reporting the pair is what
   * lets a caller say which happened instead of a reader guessing.
   */
  readonly failures: readonly {
    readonly kind: string
    readonly status: number
  }[]
}

/**
 * Drains one batch: takes every outstanding request, sends each in the order
 * it was handed out, and reports it sent or failed.
 *
 * Sends stay strictly ordered — request n+1 is not sent before request n's
 * send has completed — because the server relays a to-device message to its
 * recipient in the order it receives them, and two requests in one batch can
 * carry a verification pair whose far side silently discards the second
 * message if it arrives first. Marking is not ordered: each request's
 * response is reported as soon as it is known.
 */
export async function drainOutgoingRequests(
  http: HttpRequester,
  machine: CryptoMachine,
): Promise<DrainResult> {
  const requests = await machine.takeOutgoingRequests()
  let sent = 0
  let failed = 0
  const sentKinds: string[] = []
  const failures: { kind: string; status: number }[] = []

  for (const request of requests) {
    try {
      const responseJson = await sendOutgoingRequest(http, request)
      await machine.markRequestSent(request.id, responseJson)
      sent += 1
      sentKinds.push(request.kind)
    } catch (cause: unknown) {
      const status = cause instanceof PumpHttpError ? cause.status : 0
      await machine.markRequestFailed(request.id, status)
      failed += 1
      failures.push({ kind: request.kind, status })
    }
  }

  return { sent, failed, sentKinds, failures }
}

/**
 * Adapts a real matrix-js-sdk client to `HttpRequester`, the one place this
 * module names the SDK's concrete type. `client.http` is documented
 * "intended private, used in code" by the SDK itself and is exactly what its
 * own `OutgoingRequestProcessor` uses — see the opts object below, which is
 * that class's `rawJsonRequest` verbatim: `json:false` so a body this
 * module already serialised is not serialised twice, the full path prefix,
 * and a bounded timeout so a stuck request cannot wedge the whole pump.
 */
export function makePumpHttp(
  client: ReturnType<typeof createClient>,
): HttpRequester {
  return {
    authedRequest: async (method, path, queryParams, body) => {
      try {
        return await client.http.authedRequest<string>(
          method as Parameters<typeof client.http.authedRequest>[0],
          path,
          queryParams,
          body,
          {
            json: false,
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            prefix: '',
            localTimeoutMs: 60_000,
            // The SDK's own IRequestOpts picks `priority` from DOM's
            // RequestInit, which this project's ambient types resolve as
            // required rather than optional. 'auto' is the standard's own
            // default value; the SDK's own internal callers never pass this
            // field at all, so this changes nothing about the request.
            priority: 'auto',
          },
        )
      } catch (cause: unknown) {
        // Duck-typed rather than `instanceof HTTPError`, so this adapter
        // names no runtime import of the SDK's error classes either — only
        // `createClient`'s type, above. `httpStatus` is `HTTPError`'s own
        // field name; a `ConnectionError` (a dropped connection, a timeout)
        // carries none, which is exactly the `status: 0` case
        // `markRequestFailed` asks for.
        const status =
          typeof (cause as { httpStatus?: unknown } | null)?.httpStatus ===
          'number'
            ? (cause as { httpStatus: number }).httpStatus
            : 0
        throw new PumpHttpError(getErrorMessage(cause), status)
      }
    },
  }
}
