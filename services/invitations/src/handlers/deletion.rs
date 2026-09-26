//! An account's deletion, announced by the application just before it
//! deactivates the account (#385).
//!
//! # WHAT THE SERVICE DOES WITH IT
//!
//! Two things, in one transaction. It records the account and the instant,
//! once, whatever the number of calls: what the manual purge within thirty
//! days needs, which the privacy policy promises and #423 will automate --
//! not the whole list, since a deletion made by e-mail is never announced. And
//! it expires, at once, the caller's invitations that could still let
//! somebody in, a partly used one included (decided on 26 September 2026): an
//! invitee holding one is refused at once, rather than left waiting for an
//! inviter who can no longer let anybody in.
//!
//! The row itself goes after thirty days (`PURGE_AFTER_SECONDS`): it names a
//! deleted account, and the promise holds for it too.
//!
//! # WHAT IT DOES NOT DO
//!
//! It deactivates nothing. The application does that itself, with the
//! account's password, right after this call; and an expiry never deactivates
//! an account already handed out -- it lives on, held by a person. The hourly
//! sweep then neutralises the accounts drawn for these invitations and never
//! handed out, as it does for every expired invitation.
//!
//! AN ANNOUNCEMENT, NOT A PROOF. The deactivation comes after, and can fail.
//! Whoever purges checks that the account is deactivated first.
//!
//! # WHY THE CALLER'S OWN TOKEN
//!
//! Like every route here that acts for an account: the caller is who the
//! homeserver says the token belongs to, and nobody announces somebody
//! else's deletion. It has to come BEFORE the deactivation, which makes the
//! token worthless -- and the application treats its failure, an unknown
//! route included, as nothing that should stop the deletion.

use std::sync::Arc;

use axum::{extract::State, http::HeaderMap, Json};
use serde::Serialize;

use crate::{auth, error::AppError, util::now, AppState};

/// How long the row that announces a deletion is kept: the thirty days of
/// `compte_supprime` in `deploy/messagr-eu/retention.json`, within which the
/// privacy policy promises the account's data is purged.
pub const PURGE_AFTER_SECONDS: i64 = 30 * 86_400;

#[derive(Serialize)]
pub struct DeletionResponse {
    /// When the deletion was first announced: a replay gets the same answer.
    pub announced_at: i64,
    /// How many of the caller's invitations this call expired.
    pub expired_invitations: u64,
}

pub async fn announce(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<DeletionResponse>, AppError> {
    let user_id = auth::authenticate(&st.mx, &headers).await?;
    let at = now();
    let mut tx = st.pool.begin().await.map_err(anyhow::Error::from)?;

    sqlx::query(
        "INSERT INTO account_deletions (user_id, announced_at, purge_after) \
         VALUES (?, ?, ?) ON CONFLICT(user_id) DO NOTHING",
    )
    .bind(&user_id)
    .bind(at)
    .bind(at + PURGE_AFTER_SECONDS)
    .execute(&mut *tx)
    .await
    .map_err(anyhow::Error::from)?;
    let announced_at: i64 =
        sqlx::query_scalar("SELECT announced_at FROM account_deletions WHERE user_id = ?")
            .bind(&user_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(anyhow::Error::from)?;

    // STILL OPEN MEANS STILL PENDING AND NOT USED UP. One whose every use has
    // been spent lets nobody in any more, so expiring it would change nothing
    // but the moment its sealed secrets are wiped. Its end is moved to now as
    // well, so that what is timed from an invitation's end starts today.
    let expired = sqlx::query(
        "UPDATE invitations SET status = 'expired', expires_at = MIN(expires_at, ?) \
         WHERE inviter_user_id = ? AND status = 'pending' AND used_count < max_uses",
    )
    .bind(at)
    .bind(&user_id)
    .execute(&mut *tx)
    .await
    .map_err(anyhow::Error::from)?
    .rows_affected();

    tx.commit().await.map_err(anyhow::Error::from)?;
    Ok(Json(DeletionResponse {
        announced_at,
        expired_invitations: expired,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::SqlitePool;

    /// Un homeserver réduit à `whoami`, qui croit le porteur sur parole :
    /// « Bearer alice » devient « @alice:h ». Même forme que `request.rs`.
    async fn whoami_hs() -> String {
        async fn whoami(headers: HeaderMap) -> Json<serde_json::Value> {
            let bearer = headers
                .get("authorization")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.strip_prefix("Bearer "))
                .unwrap_or("unknown");
            Json(serde_json::json!({"user_id": format!("@{bearer}:h")}))
        }
        let app = axum::Router::new().route(
            "/_matrix/client/v3/account/whoami",
            axum::routing::get(whoami),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        base
    }

    fn bearer(who: &str) -> HeaderMap {
        let mut h = HeaderMap::new();
        h.insert("authorization", format!("Bearer {who}").parse().unwrap());
        h
    }

    fn state_with(pool: SqlitePool, hs: String) -> Arc<AppState> {
        Arc::new(AppState {
            pool,
            mx: Arc::new(crate::matrix::MatrixClient::new(hs.clone(), "token".into())),
            cfg: crate::config::Config {
                homeserver_url: hs,
                ..crate::config::Config::for_tests()
            },
        })
    }

    async fn seed(pool: &SqlitePool, id: &str, inviter: &str, max_uses: i64, used: i64) {
        sqlx::query(
            "INSERT INTO invitations \
             (id, inviter_user_id, token_sha256, created_at, expires_at, max_uses, \
              used_count, status) \
             VALUES (?,?,?,0,4000000000,?,?,'pending')",
        )
        .bind(id)
        .bind(inviter)
        .bind(crate::crypto::token_hash(id))
        .bind(max_uses)
        .bind(used)
        .execute(pool)
        .await
        .unwrap();
    }

    async fn status_of(pool: &SqlitePool, id: &str) -> String {
        sqlx::query_scalar("SELECT status FROM invitations WHERE id = ?")
            .bind(id)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_replayed_announcement_is_recorded_once(pool: SqlitePool) {
        // The application may call again: a retry after a failed deactivation
        // announces the same deletion twice. One row, and the first instant.
        let st = state_with(pool.clone(), whoami_hs().await);
        let Json(first) = announce(State(st.clone()), bearer("alice")).await.unwrap();
        let Json(again) = announce(State(st), bearer("alice")).await.unwrap();

        let rows: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM account_deletions WHERE user_id = '@alice:h'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(rows, 1);
        assert_eq!(again.announced_at, first.announced_at);

        // And it goes after thirty days, counted from the first announcement.
        let purge_after: i64 = sqlx::query_scalar(
            "SELECT purge_after FROM account_deletions WHERE user_id = '@alice:h'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(purge_after, first.announced_at + 30 * 86_400);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn the_caller_s_invitations_still_open_expire_and_nothing_else_moves(pool: SqlitePool) {
        // An invitee holding one of these links reads « this invitation cannot
        // be used » rather than waiting for an inviter who will never let them
        // in. One already used up changes nothing by expiring, and one of
        // somebody else's is not the caller's to end.
        seed(&pool, "alice-open", "@alice:h", 1, 0).await;
        seed(&pool, "alice-half-used", "@alice:h", 5, 1).await;
        seed(&pool, "alice-used-up", "@alice:h", 1, 1).await;
        seed(&pool, "bob-open", "@bob:h", 1, 0).await;

        let st = state_with(pool.clone(), whoami_hs().await);
        let Json(said) = announce(State(st), bearer("alice")).await.unwrap();

        assert_eq!(said.expired_invitations, 2);
        assert_eq!(status_of(&pool, "alice-open").await, "expired");
        assert_eq!(status_of(&pool, "alice-half-used").await, "expired");
        assert_eq!(status_of(&pool, "alice-used-up").await, "pending");
        assert_eq!(status_of(&pool, "bob-open").await, "pending");
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn an_announcement_without_a_valid_token_is_refused(pool: SqlitePool) {
        // No bearer at all, and a bearer the homeserver does not vouch for:
        // nothing is recorded and nothing expires.
        seed(&pool, "alice-open", "@alice:h", 1, 0).await;
        let st = state_with(pool.clone(), whoami_hs().await);
        assert!(matches!(
            announce(State(st), HeaderMap::new()).await,
            Err(AppError::Unauthenticated)
        ));
        let unreachable = state_with(pool.clone(), "http://127.0.0.1:1".into());
        assert!(matches!(
            announce(State(unreachable), bearer("alice")).await,
            Err(AppError::Unauthenticated)
        ));

        let rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM account_deletions")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(rows, 0);
        assert_eq!(status_of(&pool, "alice-open").await, "pending");
    }
}
