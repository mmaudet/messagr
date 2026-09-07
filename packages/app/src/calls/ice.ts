/**
 * How the media path may reach the peer.
 *
 * # One policy, and the type is what makes it one
 *
 * A call on this product is between two people who know each other, and
 * RFC 8827 §6.4 is about exactly that case: *"A side effect of the default
 * ICE behavior is that the peer learns one's IP address"*, and the API
 * *"MUST provide a mechanism for the calling application JS to indicate that
 * only TURN candidates are to be used. This prevents the peer from learning
 * one's IP address at all."*
 *
 * So the media is relayed by the server's own TURN, always. That is not a
 * default somebody can turn off: it is a union with one member, so any other
 * policy is inexpressible. The day a second is wanted it is added **here**,
 * in the type, where every place that reads it stops compiling until it has
 * been thought about — never as a boolean at a call site.
 *
 * Ported from the previous repository's `core/src/ice.rs`, which made the
 * same argument in a Rust enum with one variant and a pin test that failed to
 * compile if it ever moved. TypeScript's equivalent is a literal type.
 */
export type IceTransportPolicy = 'relay-only'

/** Everything the media layer needs, once the policy has filtered it. */
export interface IceConfig {
  /**
   * `turn:` and `turns:` only. A `stun:` URI in the server's answer is
   * dropped on arrival -- see `iceConfigFrom`.
   */
  readonly uris: readonly string[]
  /** The short-lived credentials, exactly as the homeserver issued them. */
  readonly username: string
  readonly credential: string
  /** Their lifetime in seconds, passed through untouched. Refreshing is the
   * caller's business, which is why nothing here starts a timer. */
  readonly ttlSeconds: number
  readonly transportPolicy: IceTransportPolicy
}

/**
 * Why no configuration could be produced.
 *
 * # Every arm fails closed, and that is the whole module
 *
 * There is no fallback to STUN and none to host candidates. A call that
 * cannot be relayed is a call that is **not placed**: the alternative is
 * putting this device's address on the wire to the peer, under an interface
 * that promised the opposite. The operator learns it from an error rather
 * than the user learning it from a leak they cannot see.
 */
export type IceConfigFailure =
  | {
      /**
       * The homeserver has no TURN configured -- the endpoint's own error
       * table says it SHOULD answer 404 `M_NOT_FOUND` -- or does not
       * implement the endpoint at all, which the specification's general
       * rule reads the same way.
       */
      readonly kind: 'no-relay-configured'
    }
  | {
      /**
       * The answer carried URIs and none of them relays. A `stun:` URI buys
       * nothing under relay-only, since STUN cannot relay; its presence says
       * the operator configured STUN where the product needs TURN. That is a
       * misconfiguration somebody must hear about, not a soft degradation.
       */
      readonly kind: 'no-relay-uris'
      readonly dropped: number
    }
  | { readonly kind: 'unreachable'; readonly reason: string }

/** What the homeserver answers at `/_matrix/client/v3/voip/turnServer`. */
export interface TurnServerAnswer {
  readonly uris?: unknown
  readonly username?: unknown
  readonly password?: unknown
  readonly ttl?: unknown
}

/** A `turn:` or `turns:` URI, and nothing else, case-insensitively. */
function relays(uri: string): boolean {
  const scheme = uri.slice(0, uri.indexOf(':')).toLowerCase()
  return scheme === 'turn' || scheme === 'turns'
}

/**
 * The answer to a configuration, or the reason there is none.
 *
 * Pure, and deliberately: the privacy rules above are the part worth testing,
 * and testing them must not need a homeserver. `fetchIceConfig` is the thin
 * shell that does the request and hands the body here.
 */
export function iceConfigFrom(
  answer: TurnServerAnswer,
):
  | { readonly ok: true; readonly config: IceConfig }
  | { readonly ok: false; readonly failure: IceConfigFailure } {
  const offered = Array.isArray(answer.uris)
    ? answer.uris.filter((uri): uri is string => typeof uri === 'string')
    : []
  const usable = offered.filter(relays)

  if (usable.length === 0) {
    // Told apart on purpose. Nothing offered is a homeserver with no relay;
    // something offered and none of it relaying is a homeserver whose
    // operator meant to configure one. Two different conversations.
    return offered.length === 0
      ? { ok: false, failure: { kind: 'no-relay-configured' } }
      : {
          ok: false,
          failure: { kind: 'no-relay-uris', dropped: offered.length },
        }
  }

  return {
    ok: true,
    config: {
      uris: usable,
      // Read defensively rather than cast: this is a body off a network, and
      // credentials that arrived as the wrong type are credentials that will
      // fail at the relay with a message about authentication rather than
      // about a malformed answer.
      username: typeof answer.username === 'string' ? answer.username : '',
      credential: typeof answer.password === 'string' ? answer.password : '',
      ttlSeconds: typeof answer.ttl === 'number' ? answer.ttl : 0,
      transportPolicy: 'relay-only',
    },
  }
}
