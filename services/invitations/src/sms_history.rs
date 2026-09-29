//! What OVHcloud's history keeps of the SMS this service sends, and erasing it
//! (#399, Q38 of #38).
//!
//! Every SMS the service sends, a proof's or an alert, is remembered by the id
//! OVHcloud gave it, with the moment it may be erased without keeping it from
//! arriving: once a proof's code has run out, once an alert has had a day. The
//! hourly sweep erases what is due and forgets it when that is done.
//!
//! # AN SMS THE HISTORY DOES NOT KNOW IS NOT AN SMS ERASED
//!
//! The ids `POST /jobs` answers are the history's own: observed on the real
//! account on 26 September 2026, where the deletion of a delivered SMS
//! answered 200, then 404 when asked again (`deploy/messagr-eu-invitations.md`).
//! A 404 may still be an SMS not in the history yet, or one already gone. So
//! it is tried again each hour, and given up a day later with a warning,
//! rather than counted as done at once.

use std::sync::Arc;

use sqlx::SqlitePool;

use crate::{sms::SmsError, AppState};

/// How long an erasure that fails is tried again before it is given up, and
/// said.
const TRIED_FOR_SECONDS: i64 = 86_400;

/// Remembers to erase an SMS from OVHcloud's history from `erase_after` on.
pub async fn remember(pool: &SqlitePool, message_id: u64, erase_after: i64) -> anyhow::Result<()> {
    sqlx::query("INSERT OR IGNORE INTO sms_to_erase (message_id, erase_after) VALUES (?, ?)")
        .bind(i64::try_from(message_id)?)
        .bind(erase_after)
        .execute(pool)
        .await?;
    Ok(())
}

/// Erases every SMS that is due, and answers how many left the history. Without
/// a provider there is nothing to erase with: the rows wait.
pub async fn erase_due(st: &Arc<AppState>, now: i64) -> anyhow::Result<u64> {
    let Some(provider) = st.cfg.sms.provider.as_ref() else {
        return Ok(0);
    };
    let due: Vec<(i64, i64)> =
        sqlx::query_as("SELECT message_id, erase_after FROM sms_to_erase WHERE erase_after <= ?")
            .bind(now)
            .fetch_all(&st.pool)
            .await?;
    let mut erased = 0;
    for (message_id, erase_after) in due {
        let outcome = provider.erase(u64::try_from(message_id)?, now).await;
        let given_up = erase_after <= now - TRIED_FOR_SECONDS;
        let forget = match &outcome {
            Ok(()) => {
                erased += 1;
                true
            }
            Err(SmsError::Unknown) if given_up => {
                tracing::warn!(
                    "OVHcloud's history never knew SMS {message_id}: given up, and it may still be there"
                );
                true
            }
            Err(e) => {
                if given_up {
                    tracing::warn!("SMS {message_id} is still in OVHcloud's history: {e}");
                }
                false
            }
        };
        if forget {
            sqlx::query("DELETE FROM sms_to_erase WHERE message_id = ?")
                .bind(message_id)
                .execute(&st.pool)
                .await?;
        }
    }
    Ok(erased)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{routing::delete, Router};

    /// An OVHcloud whose history knows no SMS at all.
    async fn a_history_that_knows_nothing() -> String {
        let app = Router::new().route(
            "/sms/sms-test-1/outgoing/:id",
            delete(|| async { axum::http::StatusCode::NOT_FOUND }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        base
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn an_sms_the_history_does_not_know_is_tried_for_a_day_then_given_up(pool: SqlitePool) {
        let base_url = a_history_that_knows_nothing().await;
        let st = Arc::new(AppState {
            pool: pool.clone(),
            mx: Arc::new(crate::matrix::MatrixClient::new(
                "http://127.0.0.1:1".into(),
                "token".into(),
            )),
            cfg: crate::config::Config {
                sms: crate::config::Sms {
                    operator_number: None,
                    ..crate::handlers::discovery::test_support::sms_through(base_url)
                },
                ..crate::config::Config::for_tests()
            },
        });
        remember(&pool, 7, 1_000).await.unwrap();
        let waiting = || async {
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM sms_to_erase")
                .fetch_one(&pool)
                .await
                .unwrap()
        };

        assert_eq!(erase_due(&st, 1_000).await.unwrap(), 0);
        assert_eq!(waiting().await, 1, "tried again at the next pass");
        assert_eq!(
            erase_due(&st, 1_000 + TRIED_FOR_SECONDS - 1).await.unwrap(),
            0
        );
        assert_eq!(waiting().await, 1, "for a day");
        assert_eq!(erase_due(&st, 1_000 + TRIED_FOR_SECONDS).await.unwrap(), 0);
        assert_eq!(
            waiting().await,
            0,
            "then given up, and never counted as erased"
        );
    }
}
