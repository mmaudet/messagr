//! JSON body extraction, with the service's own errors.

use axum::{
    extract::{rejection::JsonRejection, FromRequest, Request},
    Json,
};

use crate::error::AppError;

/// `Json<T>`, but whose REJECTION goes through `AppError`.
///
/// `axum::Json` answers bodies it cannot read by itself, and it answers in
/// `text/plain`: the handler is never reached, so `AppError::into_response`
/// is not either, so the `{errcode, error}` envelope the rest of the service
/// honours is short-circuited. This affected four of the most likely cases on
/// the client side — missing `Content-Type` header (415), malformed JSON
/// (400), missing field (422), field of the wrong type (422).
///
/// A client that deserializes strictly, by design, then cannot read the ERROR
/// response itself: it fails on it, and the diagnosis points at the client
/// when the fault is here.
///
/// The status becomes uniformly 400 `M_INVALID_PARAM`. That is a choice, and
/// it loses the 415/422 distinction: the distinction says nothing a client
/// could act on differently, and `body_text()` preserves it word for word in
/// the message.
pub struct Body<T>(pub T);

#[axum::async_trait]
impl<T, S> FromRequest<S> for Body<T>
where
    Json<T>: FromRequest<S, Rejection = JsonRejection>,
    S: Send + Sync,
{
    type Rejection = AppError;

    async fn from_request(req: Request, state: &S) -> Result<Self, Self::Rejection> {
        // `body_text()` describes the request the caller has just sent, never
        // the state of the service: handing it back to an anonymous caller —
        // `claim` is not authenticated — teaches it nothing beyond what it
        // wrote.
        Json::<T>::from_request(req, state)
            .await
            .map(|Json(value)| Body(value))
            .map_err(|rejection| AppError::InvalidRequest(rejection.body_text()))
    }
}
