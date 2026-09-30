//! The idempotency key of a request: the one reading of it, for every route
//! that takes one (#491). `POST /invitations` (`handlers::create`) had it
//! first, and `POST /reports` (`handlers::reports`) read it with a copy of
//! the same lines until both came here.
//!
//! The header, its bounds and its form are read here and nowhere else. What
//! differs from one route to the next is what the key protects there, which a
//! caller that sent none is told: each route says it (`PROTECTS_A_POOL`,
//! `PROTECTS_A_REPORT`).
//!
//! **A header, not a body field**, for three reasons drawn from the code and
//! the incident of `POST /invitations`:
//!
//! 1. The duplicate measured on 6 August came from an **automatic HTTP-stack
//!    retry**, not a deliberate re-call from the client. What replays a
//!    request at that level — a reqwest/OkHttp interceptor, nginx's
//!    `proxy_next_upstream` — manipulates headers; that is the layer that
//!    sets the key, and it has no business knowing the body's schema or
//!    re-encoding it.
//! 2. The key is a transport metadata, not business data: adding it to a
//!    route's body would mix it with the fields on which the MEANING of the
//!    request depends. A route already receives the `HeaderMap` for
//!    authentication — no signature to change.
//! 3. It is the conventional shape (`Idempotency-Key`), hence the one retry
//!    layers know how to set without specific code.
//!
//! **Mandatory, not optional.** An optional key does not fix the observed
//! defect: the measured duplicate came from a retry the caller did not know
//! it was emitting, and a caller unaware of the key gets exactly the old
//! behaviour back. The price of the requirement is a loud 400 on the very
//! first call, before anything is done; the price of silence is a duplicate
//! nobody can take back — a pool of definitive Matrix accounts, a report kept
//! and told twice.

use axum::http::HeaderMap;

use crate::error::AppError;

/// The header carrying the key. Compared in lowercase: `HeaderMap`
/// normalises header names, so the case used by the caller is irrelevant.
pub const HEADER: &str = "idempotency-key";

/// Bounds of the key. The minimum is not decorative: the key is carried by
/// the caller and stands as a promise of uniqueness; a value like `1` or `x`
/// would collide with their own next request and hand them the previous
/// answer back — a silent, inverted duplicate.
pub const KEY_MIN: usize = 8;
pub const KEY_MAX: usize = 200;

/// Refuses a key outside its bounds or its form: `KEY_MIN` to `KEY_MAX`
/// visible ASCII characters, no spaces.
pub fn validate(key: &str) -> Result<(), AppError> {
    let invalid = |what: &str| {
        Err(AppError::InvalidRequest(format!(
            "header {HEADER} {what}: {KEY_MIN} to {KEY_MAX} visible ASCII characters, no spaces"
        )))
    };
    if key.len() < KEY_MIN || key.len() > KEY_MAX {
        return invalid("of invalid length");
    }
    if !key.bytes().all(|b| b.is_ascii_graphic()) {
        return invalid("malformed");
    }
    Ok(())
}

/// The key a request carries, required: refused rather than done without,
/// and a caller that sent none is told what it protects on the route it
/// called, `protects`.
pub fn required(headers: &HeaderMap, protects: &str) -> Result<String, AppError> {
    let raw = headers
        .get(HEADER)
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| {
            AppError::InvalidRequest(format!("header {HEADER} is required: {protects}"))
        })?;
    validate(raw)?;
    Ok(raw.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// What a key protects on a route of these tests, and on none of the
    /// service's.
    const PROTECTS: &str = "it keeps this request from being done twice";

    /// The key alone carries the promise of uniqueness: what cannot keep it
    /// must be refused BEFORE any network call.
    ///
    /// The lengths exercised here are ABSOLUTE, not expressed in terms of the
    /// constants. An assertion written `KEY_MIN - 1` only compares the
    /// constant to itself: it survives a `KEY_MIN = 1` intact, and so would
    /// never have said anything about the fact that a "1" key must be
    /// refused. The exact bounds are verified AS WELL, for the off-by-one
    /// error.
    #[test]
    fn the_key_is_refused_outside_its_bounds_and_its_form() {
        let a = |n: usize| "k".repeat(n);

        // Too short to be a credible uniqueness promise: a one- or
        // two-character key would collide with the same caller's next
        // request, which would be handed the previous answer back.
        for short_key in ["1", "ab", "abcd", "short"] {
            assert!(
                validate(short_key).is_err(),
                "too-short key accepted: {short_key:?}"
            );
        }
        // Excessive: it would end up as-is in the database, in the index and
        // in the logs.
        assert!(
            validate(&a(1000)).is_err(),
            "a thousand-character key must be refused"
        );
        assert!(validate("").is_err(), "empty key");

        // The EXACT bounds, for the off-by-one error.
        assert!(
            validate(&a(KEY_MIN - 1)).is_err(),
            "one character under the lower bound"
        );
        assert!(
            validate(&a(KEY_MIN)).is_ok(),
            "the EXACT lower bound must be accepted"
        );
        assert!(
            validate(&a(KEY_MAX)).is_ok(),
            "the EXACT upper bound must be accepted"
        );
        assert!(
            validate(&a(KEY_MAX + 1)).is_err(),
            "one character above the upper bound"
        );

        for malformed in [
            "        ",        // spaces only: sufficient length, null content
            "key with space",  // internal space
            "key\twith\ttab",  // control character
            "key\nwith\nlf",   // line feed: injection into the logs
            "kéy-accented-ok", // outside ASCII
        ] {
            assert!(
                validate(malformed).is_err(),
                "malformed key accepted: {malformed:?}"
            );
        }

        // Control: the forms genuinely expected from a caller pass, without
        // which the validation could refuse everything and the assertions
        // above would prove nothing. A UUID v4 (36 characters) and a
        // 32-character base32 token, like those the service generates.
        assert!(validate("6f1c9d3e-2b47-4a0e-9c11-8de5a2f30b64").is_ok());
        assert!(validate("MFRGGZDFMZTWQ2LKNRWW6ZDFMZTWQ2LK").is_ok());
    }

    /// The header is MANDATORY: its absence must produce a refusal, never a
    /// silent fallback to a key generated by the service — which would make
    /// every retry unique, hence duplicate what the key protects, i.e. the
    /// very defect being fixed.
    #[test]
    fn the_header_is_required_and_its_case_is_irrelevant() {
        assert!(
            required(&HeaderMap::new(), PROTECTS).is_err(),
            "without the header, the request must be refused"
        );

        // `HeaderMap` normalises names: the case used by the caller must not
        // decide the fate of the request.
        for name in ["Idempotency-Key", "idempotency-key", "IDEMPOTENCY-KEY"] {
            let mut h = HeaderMap::new();
            h.insert(name, "key-of-test-1".parse().unwrap());
            assert_eq!(
                required(&h, PROTECTS).unwrap(),
                "key-of-test-1",
                "header not recognised under the case {name}"
            );
        }

        let mut h = HeaderMap::new();
        h.insert(HEADER, "short".parse().unwrap());
        assert!(
            required(&h, PROTECTS).is_err(),
            "a present but invalid key must be refused, not ignored"
        );
    }

    /// #491: what a missing key protects is the route's to say, and the
    /// caller is told it, whatever it is.
    #[test]
    fn a_caller_without_a_key_is_told_what_it_protects() {
        for protects in [PROTECTS, "it keeps that other request single"] {
            match required(&HeaderMap::new(), protects) {
                Err(AppError::InvalidRequest(said)) => {
                    assert!(said.contains(HEADER), "{said}");
                    assert!(said.contains(protects), "{said}");
                }
                other => panic!("a missing key must be refused, got {other:?}"),
            }
        }
    }
}
