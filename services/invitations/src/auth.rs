use axum::http::HeaderMap;

use crate::{
    error::AppError,
    matrix::{MatrixClient, TokenRefused},
};

pub fn extract_bearer(headers: &HeaderMap) -> Result<String, AppError> {
    headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .filter(|v| !v.is_empty())
        .map(str::to_string)
        .ok_or(AppError::Unauthenticated)
}

/// The service sees the caller's token to authenticate them, but never stores
/// it (a limit documented in §5 of the spec).
pub async fn authenticate(mx: &MatrixClient, headers: &HeaderMap) -> Result<String, AppError> {
    Ok(authenticate_and_borrow(mx, headers).await?.0)
}

/// [`authenticate`], and it also hands back the token it just proved the
/// ownership of.
///
/// **ONE CALLER, AND IT IS THE ISSUANCE GATE.** `handlers::create` must read a
/// room's power levels AS THE PERSON ASKING — the service holds no
/// room-reading right of its own, and would have none to lend. That read needs
/// the bearer, not only the identity it resolves to, so this function exists
/// rather than a second `extract_bearer` at the call site: there must be
/// exactly one place where a token becomes a principal, or the two could
/// eventually disagree about which token was proved.
///
/// The token is BORROWED, not stored: it lives as long as the request and
/// reaches no column of the database. The §5 limit is unchanged.
///
/// **A REFUSED TOKEN IS 401, A HOMESERVER THAT DOES NOT ANSWER IS 503**
/// (#491). Only the homeserver's own refusal of the token
/// ([`TokenRefused`]) makes the caller unauthenticated. Any other failure of
/// `whoami` says nothing about the token, and was answered 401 until then,
/// which a client reads as final: it is `HomeserverUnavailable`, which tells
/// the caller to come back, before anything is done or kept. A homeserver
/// that never answers is one of them, once `WHOAMI_DEADLINE` has passed
/// (#496): it no longer holds the route for as long as its caller waits.
pub async fn authenticate_and_borrow(
    mx: &MatrixClient,
    headers: &HeaderMap,
) -> Result<(String, String), AppError> {
    let token = extract_bearer(headers)?;
    let user_id = mx.whoami(&token).await.map_err(|cause| {
        if cause.is::<TokenRefused>() {
            AppError::Unauthenticated
        } else {
            AppError::HomeserverUnavailable
        }
    })?;
    Ok((user_id, token))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::handlers::discovery::test_support::{mute_hs, whoami_answering};
    use axum::http::HeaderMap;
    use std::time::{Duration, Instant};

    #[test]
    fn extracts_a_well_formed_bearer() {
        let mut h = HeaderMap::new();
        h.insert("authorization", "Bearer abc123".parse().unwrap());
        assert_eq!(extract_bearer(&h).unwrap(), "abc123");
    }

    #[test]
    fn refuses_a_missing_or_malformed_header() {
        assert!(extract_bearer(&HeaderMap::new()).is_err());
        let mut h = HeaderMap::new();
        h.insert("authorization", "Basic abc".parse().unwrap());
        assert!(extract_bearer(&h).is_err());
    }

    /// A homeserver whose `whoami` answers `status` and `body`, whatever the
    /// token it is shown.
    async fn homeserver_answering(status: u16, body: &'static str) -> MatrixClient {
        MatrixClient::new(whoami_answering(status, body).await, String::new())
    }

    fn bearing(token: &str) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert("authorization", format!("Bearer {token}").parse().unwrap());
        headers
    }

    #[tokio::test]
    async fn a_token_its_homeserver_refuses_is_unauthenticated() {
        for status in [401, 403] {
            let mx = homeserver_answering(status, r#"{"errcode":"M_UNKNOWN_TOKEN"}"#).await;
            assert!(
                matches!(
                    authenticate(&mx, &bearing("alice")).await,
                    Err(AppError::Unauthenticated)
                ),
                "{status}"
            );
        }
        // Control: the same double names the account when it answers 200.
        let answering = homeserver_answering(200, r#"{"user_id":"@alice:h"}"#).await;
        assert_eq!(
            authenticate(&answering, &bearing("alice")).await.unwrap(),
            "@alice:h"
        );
    }

    /// #491, the review of #493: a failure of the service's own `whoami` was
    /// a 401 whatever it was, and a client reads a 401 as final. A homeserver
    /// that does not answer, or not as a homeserver does, says nothing about
    /// the token: the caller is told to come back, not that it is refused.
    #[tokio::test]
    async fn a_homeserver_that_does_not_answer_as_one_does_is_unavailable_not_a_refusal() {
        let unreachable = MatrixClient::new("http://127.0.0.1:1".into(), String::new());
        assert!(matches!(
            authenticate(&unreachable, &bearing("alice")).await,
            Err(AppError::HomeserverUnavailable)
        ));
        for (status, body) in [
            (500, r#"{"errcode":"M_UNKNOWN"}"#),
            (502, "{}"),
            (429, r#"{"errcode":"M_LIMIT_EXCEEDED"}"#),
            (200, "{}"),
        ] {
            let mx = homeserver_answering(status, body).await;
            assert!(
                matches!(
                    authenticate(&mx, &bearing("alice")).await,
                    Err(AppError::HomeserverUnavailable)
                ),
                "{status} {body}"
            );
        }
    }

    /// #496: a homeserver that takes the question and never answers held the
    /// caller for as long as the caller waited, and its 503 never came. The
    /// deadline ends the wait: unavailable, once the deadline has passed and
    /// well before the caller would give up.
    #[tokio::test]
    async fn a_homeserver_that_never_answers_is_unavailable_within_the_deadline() {
        let deadline = Duration::from_millis(300);
        let mx = MatrixClient::new(mute_hs().await, String::new()).whoami_within(deadline);

        let started = Instant::now();
        let answered =
            tokio::time::timeout(deadline * 10, authenticate(&mx, &bearing("alice"))).await;

        assert!(
            matches!(answered, Ok(Err(AppError::HomeserverUnavailable))),
            "no answer within ten times the deadline, or another answer"
        );
        // It is the deadline that ended it, not a refused connection.
        assert!(started.elapsed() >= deadline);
    }
}
