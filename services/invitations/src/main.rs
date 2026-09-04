mod auth;
mod cleanup;
mod config;
mod crypto;
mod db;
mod error;
mod extract;
mod handlers;
mod matrix;
mod named_deactivation;
mod util;

use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{delete, get, post},
    Json, Router,
};
use sqlx::SqlitePool;
use std::sync::Arc;

pub struct AppState {
    pub pool: SqlitePool,
    pub mx: Arc<matrix::MatrixClient>,
    pub cfg: config::Config,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt::init();
    let cfg = config::Config::from_env()?;
    let pool = db::connect(&cfg.database_url).await?;
    let mx = Arc::new(matrix::MatrixClient::new(
        cfg.homeserver_url.clone(),
        cfg.registration_token.clone(),
    ));
    let addr = cfg.bind_addr.clone();
    let state = Arc::new(AppState { pool, mx, cfg });

    // THE NAMED DEACTIVATION IS A MODE, NOT A ROUTE — see the header of
    // `named_deactivation`. It binds no port and spawns NO `run_forever`, so it
    // may be run beside the live service without a second sweeper or a fight
    // over the port. Both of those are true by reading the lines below: the
    // dispatch returns before either happens.
    if let Some(named) =
        named_deactivation::selects_the_named_deactivation(&std::env::args().collect::<Vec<_>>())
    {
        let seed_path = named_deactivation::the_seed_path();
        return match named_deactivation::run(&state, &named, &seed_path, ask_on_the_terminal).await
        {
            Ok(outcome) => {
                println!("{outcome:?}");
                Ok(())
            }
            // A refusal leaves the process with a NON-ZERO status: an operator
            // reading only the exit code must never read a refusal as a done
            // deed.
            Err(refusal) => Err(anyhow::anyhow!("{refusal}")),
        };
    }

    tokio::spawn(cleanup::run_forever(state.clone()));

    let app = router(state);

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!(
        "messagr-invitations version {} — listening on {addr}",
        version()
    );
    axum::serve(listener, app).await?;
    Ok(())
}

/// Prints the plan and reads one line back. THE ONLY caller of stdin in this
/// binary, and it is deliberately trivial: everything worth testing about the
/// confirmation lives in `named_deactivation::is_the_confirmation`, which takes
/// the answer as a value.
///
/// End of stdin gives `None`, which is a refusal — so a cron entry, a pipeline
/// or a pasted runbook finds no way through.
fn ask_on_the_terminal(plan: &str) -> Option<String> {
    println!("{plan}");
    let mut answer = String::new();
    match std::io::stdin().read_line(&mut answer) {
        Ok(0) | Err(_) => None,
        Ok(_) => Some(answer),
    }
}

/// The router, isolated from startup so it can be tested: the responses we
/// care about here are produced BEFORE any handler, so only a real router
/// produces them.
fn router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/invitations", post(handlers::create::create))
        .route("/invitations/claim", post(handlers::claim::claim))
        .route(
            "/invitations/:id",
            delete(handlers::revoke::revoke).get(handlers::status::status),
        )
        // Without these two fallbacks, axum answers unknown routes and wrong
        // methods with an EMPTY body, without even a `Content-Type`. A client
        // expecting the service envelope then has nothing to read — and its
        // 404 "unknown route" is indistinguishable from the business 404
        // "invitation not found", which does carry a body.
        .fallback(unknown_route)
        .method_not_allowed_fallback(method_not_allowed)
        .with_state(state)
}

/// The served version, stamped at compile time.
///
/// It serves one purpose: making OBSERVABLE, from the outside and with no side
/// effect, which version the service is running. Without it, no path
/// distinguishes two binaries — one had to create an account to tell, which is
/// an irreversible side effect on the homeserver.
///
/// "unknown" when the variable is not provided at build time: better to admit
/// it than to announce a false version.
fn version() -> &'static str {
    option_env!("MESSAGR_VERSION").unwrap_or("unknown")
}

/// The body stays EXACTLY `ok` — that is the probe's contract, and changing it
/// would break any monitoring that compares it. The version goes into a
/// header, where it competes with nothing.
async fn health() -> Response {
    ([("x-messagr-version", version())], "ok").into_response()
}

/// `M_UNRECOGNIZED` is the Matrix code for an unknown endpoint: it stands
/// apart from the business `M_NOT_FOUND`s, which speak of an invitation, not
/// of a route.
fn envelope(code: StatusCode, message: &str) -> Response {
    (
        code,
        Json(serde_json::json!({"errcode": "M_UNRECOGNIZED", "error": message})),
    )
        .into_response()
}

async fn unknown_route() -> Response {
    envelope(StatusCode::NOT_FOUND, "unknown route")
}

async fn method_not_allowed() -> Response {
    envelope(
        StatusCode::METHOD_NOT_ALLOWED,
        "method not allowed on this route",
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// **D2** — every error response must stay within the service envelope.
    ///
    /// Six cases measured on the live service before the fix escaped the
    /// `{errcode, error}` shape: four returned `text/plain` (`Content-Type`
    /// absent → 415, malformed JSON → 400, missing field → 422, field of the
    /// wrong type → 422), two returned an EMPTY body with no `Content-Type`
    /// (unknown route → 404, wrong method → 405). None of them goes through
    /// the handlers, so none could be seen by the handler tests — which is
    /// exactly why this one mounts a REAL router behind a REAL socket, and
    /// queries it over HTTP.
    ///
    /// The task 2 client deserializes strictly, by design: on those responses
    /// it fails to read the error itself, and the diagnosis points at the
    /// client when the fault is in the service.
    ///
    /// The application state is deliberately inert (empty database, homeserver
    /// on a closed port): these six responses are produced BEFORE any handler,
    /// and nothing in this test must be able to depend on anything else.
    #[sqlx::test(migrations = "./migrations")]
    async fn every_error_stays_within_the_service_envelope(pool: SqlitePool) {
        let st = Arc::new(AppState {
            pool,
            mx: Arc::new(matrix::MatrixClient::new(
                "http://127.0.0.1:1".into(),
                "token".into(),
            )),
            cfg: config::Config {
                database_url: String::new(),
                homeserver_url: "http://127.0.0.1:1".into(),
                registration_token: "token".into(),
                encryption_key: [0u8; 32],
                edge_retention_days: 30,
                bind_addr: String::new(),
                // Field brought in by the "ceiling" fix; inert here. The seven
                // cases below are produced BEFORE any handler, so none of them
                // reaches the ceiling check: the conservative default is fine
                // and commits nothing.
                max_reserved_accounts_per_inviter: config::DEFAULT_RESERVED_ACCOUNTS_CEILING,
            },
        });
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let app = router(st);
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });

        let http = reqwest::Client::new();
        let json = "application/json";
        let cases: Vec<(&str, reqwest::RequestBuilder)> = vec![
            (
                "missing Content-Type header",
                http.post(format!("{base}/invitations"))
                    .body(r#"{"max_uses":1,"ttl_seconds":60,"room_id":"!r:h"}"#),
            ),
            // The room is REQUIRED since the issuance gate: a body without it
            // is refused by the extractor, before the handler, so it must come
            // back inside the service envelope like every other refusal.
            (
                "missing room_id",
                http.post(format!("{base}/invitations"))
                    .header("content-type", json)
                    .body(r#"{"max_uses":1,"ttl_seconds":60}"#),
            ),
            (
                "malformed JSON",
                http.post(format!("{base}/invitations"))
                    .header("content-type", json)
                    .body("{not json"),
            ),
            (
                "missing field",
                http.post(format!("{base}/invitations"))
                    .header("content-type", json)
                    .body(r#"{"max_uses":1}"#),
            ),
            (
                "field of the wrong type",
                http.post(format!("{base}/invitations"))
                    .header("content-type", json)
                    .body(r#"{"max_uses":-1,"ttl_seconds":60,"room_id":"!r:h"}"#),
            ),
            (
                "unreadable body on claim, unauthenticated",
                http.post(format!("{base}/invitations/claim"))
                    .header("content-type", json)
                    .body("not json"),
            ),
            ("unknown route", http.get(format!("{base}/unknown"))),
            (
                "method not allowed",
                http.get(format!("{base}/invitations")),
            ),
        ];

        for (name, request) in cases {
            let r = request.send().await.unwrap();
            let status = r.status();
            assert!(
                status.is_client_error(),
                "{name}: unexpected status {status}"
            );
            let content_type = r
                .headers()
                .get("content-type")
                .and_then(|v| v.to_str().ok())
                .unwrap_or_default()
                .to_string();
            assert!(
                content_type.starts_with(json),
                "{name}: Content-Type \"{content_type}\", expected {json}"
            );
            let body: serde_json::Value = r
                .json()
                .await
                .unwrap_or_else(|e| panic!("{name}: body not readable as JSON ({e})"));
            assert!(body["errcode"].is_string(), "{name}: no errcode — {body}");
            assert!(body["error"].is_string(), "{name}: no error — {body}");
        }

        // Control: the router still serves, and the fallbacks have not eaten
        // the real routes. Without it, a router answering 404 to EVERYTHING
        // would make the loop above pass.
        let healthy = http.get(format!("{base}/health")).send().await.unwrap();
        assert_eq!(healthy.status(), StatusCode::OK);
        // The served version must be observable without side effects: it is
        // the only way, from the outside, to know which binary is answering.
        // Its VALUE depends on the build; its PRESENCE does not.
        assert!(
            healthy.headers().contains_key("x-messagr-version"),
            "without this header, nothing distinguishes two versions of the \
             service without creating an account, that is, without an \
             irreversible side effect"
        );
        // And the body stays EXACTLY `ok`: that is the probe's contract.
        assert_eq!(healthy.text().await.unwrap(), "ok");
    }
}
