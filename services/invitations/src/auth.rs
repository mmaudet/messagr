use axum::http::HeaderMap;

use crate::{error::AppError, matrix::MatrixClient};

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
pub async fn authenticate_and_borrow(
    mx: &MatrixClient,
    headers: &HeaderMap,
) -> Result<(String, String), AppError> {
    let token = extract_bearer(headers)?;
    let user_id = mx
        .whoami(&token)
        .await
        .map_err(|_| AppError::Unauthenticated)?;
    Ok((user_id, token))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderMap;

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
}
