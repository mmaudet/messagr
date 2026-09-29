//! Blocking an account from a conversation (#469, #462, ADR 0015).
//!
//! - `POST /blocks`, with `{"blocked_user_id": "@x:h"}`: the caller blocks
//!   that account. Answered `204` whether the block is new or not.
//!
//! # ONE BLOCK
//!
//! It writes the relation « Refuser et bloquer » writes (#406,
//! `handlers::delivered`), `delivered_blocks`, which keeps the name it had
//! then and now also holds the blocks made from a conversation: a
//! recipient's lasting refusal of another account, whichever way it was made.
//! Everything #406 says of a block holds for this one. The blocked account's
//! invitations delivered inside Messagr are taken and never delivered, read
//! as pending and run out, and every limit applies to them as to any other;
//! those it sent before leave the caller's list. It lasts as long as both
//! accounts exist, and goes with the purge of a deleted one, never with the
//! announcement of its deletion.
//!
//! The application ignores the account on the homeserver before it calls
//! here (`m.ignored_user_list`), and the homeserver then holds back whatever
//! that account sends. This route is what keeps it from delivering an
//! invitation inside Messagr, which the homeserver never sees, and what the
//! operator's daily count reads (`blocks_count`).
//!
//! # SILENT
//!
//! Nothing tells the blocked account, here or anywhere: the answer is the
//! caller's alone, and the same whether the block is new or not.
//!
//! # DATED, ONCE
//!
//! A block carries the time it was first recorded (migration 021). A replay
//! changes nothing and keeps the first date: a second call after an answer
//! that got lost is not a second block, and nothing counts it twice. The
//! blocks recorded before 021 carry no date.

use std::sync::Arc;

use axum::{extract::State, http::HeaderMap, http::StatusCode};
use serde::Deserialize;

use crate::{auth, error::AppError, extract::Body, named_deactivation::is_a_user_id, AppState};

/// The longest user identifier the Matrix specification allows, in bytes.
const USER_ID_MAX_BYTES: usize = 255;

#[derive(Deserialize)]
pub struct BlockRequest {
    /// The account to block, as a Matrix user identifier.
    pub blocked_user_id: String,
}

/// `POST /blocks`: the caller blocks the account it names.
///
/// Refused without a valid token, and for anything but a Matrix user
/// identifier, the caller's own included: nothing is written then. Recorded
/// however many times it is asked, once.
pub async fn block(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
    Body(req): Body<BlockRequest>,
) -> Result<StatusCode, AppError> {
    let blocker = auth::authenticate(&st.mx, &headers).await?;
    let blocked = req.blocked_user_id;
    if blocked.len() > USER_ID_MAX_BYTES || !is_a_user_id(&blocked) {
        return Err(AppError::InvalidRequest(
            "blocked_user_id must be a Matrix user identifier, @localpart:server".into(),
        ));
    }
    if blocked == blocker {
        return Err(AppError::InvalidRequest(
            "blocked_user_id names the caller: an account does not block itself".into(),
        ));
    }
    recorded(&st.pool, &blocker, &blocked, st.cfg.clock.now()).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// `blocker` blocks `blocked` at `now`, or already did: the one statement
/// that writes a block, from a conversation or on an invitation (#406).
///
/// NEVER DATED BEFORE THE LAST COUNT. The time is read before the statement
/// runs, and the daily count can be made in between: dated as read, the
/// block would fall before the instant that count counted up to, and no
/// count would ever have it. It takes that instant instead, and the next
/// count has it (`blocks_count`). One statement, so that SQLite runs it
/// wholly before a count or wholly after.
pub(crate) async fn recorded<'e, E>(
    executor: E,
    blocker: &str,
    blocked: &str,
    now: i64,
) -> Result<(), AppError>
where
    E: sqlx::Executor<'e, Database = sqlx::Sqlite>,
{
    sqlx::query(
        "INSERT INTO delivered_blocks (blocker_user_id, blocked_user_id, blocked_at) \
         VALUES (?1, ?2, MAX(?3, COALESCE( \
             (SELECT counted_at FROM blocks_count WHERE id = 1), ?3))) \
         ON CONFLICT DO NOTHING",
    )
    .bind(blocker)
    .bind(blocked)
    .bind(now)
    .execute(executor)
    .await
    .map_err(anyhow::Error::from)?;
    Ok(())
}

/// What the tests of the route and of the daily count set up alike: the
/// service with the SMS double and the operator's number, a clock the test
/// moves, and the blocks the database holds.
#[cfg(test)]
pub(crate) mod test_support {
    use super::*;
    use crate::config::Config;
    use crate::handlers::discovery::test_support::{bearer, state_from, whoami_hs, T0};
    use crate::sms::test_support::{sms_through, Inbox};
    use sqlx::SqlitePool;
    use std::sync::atomic::AtomicI64;
    use std::sync::Mutex;

    /// The service at `T0`, 14:13 UTC, on a clock the test moves, sending
    /// through the fake OVHcloud at `ovh` to the operator's number, and
    /// nothing of discovery: production's configuration once it is given
    /// both (#464).
    pub(crate) async fn service_through(
        pool: SqlitePool,
        ovh: String,
    ) -> (Arc<AppState>, Arc<AtomicI64>) {
        let hs = whoami_hs().await;
        let (clock, time) = crate::util::Clock::settable(T0);
        let st = state_from(
            pool,
            hs.clone(),
            Config {
                homeserver_url: hs,
                sms: sms_through(ovh),
                clock,
                ..Config::for_tests()
            },
        );
        (st, time)
    }

    /// The same, through a fake OVHcloud that sends everything.
    pub(crate) async fn service(
        pool: SqlitePool,
    ) -> (Arc<AppState>, Arc<AtomicI64>, Arc<Mutex<Inbox>>) {
        let (ovh, inbox) = crate::sms::test_support::fake_ovhcloud(false).await;
        let (st, time) = service_through(pool, ovh).await;
        (st, time, inbox)
    }

    /// `who` blocks `blocked`, through the route.
    pub(crate) async fn blocking(
        st: &Arc<AppState>,
        who: &str,
        blocked: &str,
    ) -> Result<StatusCode, AppError> {
        block(
            State(st.clone()),
            bearer(who),
            Body(BlockRequest {
                blocked_user_id: blocked.into(),
            }),
        )
        .await
    }

    /// Every block the service holds: who blocked whom, and when.
    pub(crate) async fn held(pool: &SqlitePool) -> Vec<(String, String, Option<i64>)> {
        sqlx::query_as(
            "SELECT blocker_user_id, blocked_user_id, blocked_at FROM delivered_blocks \
             ORDER BY blocker_user_id, blocked_user_id",
        )
        .fetch_all(pool)
        .await
        .unwrap()
    }

    /// What reached the operator's number, in order.
    pub(crate) fn told(inbox: &Arc<Mutex<Inbox>>) -> Vec<String> {
        inbox
            .lock()
            .unwrap()
            .sent
            .iter()
            .map(|(_, text)| text.clone())
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::{blocking, held, service, told};
    use super::*;
    use crate::config::Config;
    use crate::handlers::discovery::test_support::{bearer, set_clock, state_from, DAY, T0};
    use sqlx::SqlitePool;

    #[sqlx::test(migrations = "./migrations")]
    async fn a_block_is_recorded_with_its_date_and_a_replay_keeps_the_first(pool: SqlitePool) {
        let (st, time, inbox) = service(pool.clone()).await;

        assert_eq!(
            blocking(&st, "bob", "@alice:h").await.unwrap(),
            StatusCode::NO_CONTENT
        );
        // A second call after an answer that got lost, a day later: the same
        // answer, and nothing moves.
        set_clock(&time, T0 + DAY);
        assert_eq!(
            blocking(&st, "bob", "@alice:h").await.unwrap(),
            StatusCode::NO_CONTENT
        );

        assert_eq!(
            held(&pool).await,
            [("@bob:h".into(), "@alice:h".into(), Some(T0))]
        );
        // SILENT, and the operator is told by the daily count, never at the
        // moment of the block.
        assert!(told(&inbox).is_empty(), "{:?}", told(&inbox));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_block_names_a_matrix_account_and_never_the_caller(pool: SqlitePool) {
        let (st, _, _) = service(pool.clone()).await;
        let too_long = format!("@{}:h", "a".repeat(254));
        for refused in [
            "",
            "alice",
            "@alice",
            "@:h",
            "@alice:",
            "@Alice Smith:h",
            too_long.as_str(),
            // Bob himself.
            "@bob:h",
        ] {
            assert!(
                matches!(
                    blocking(&st, "bob", refused).await,
                    Err(AppError::InvalidRequest(_))
                ),
                "{refused:?}"
            );
        }
        assert!(held(&pool).await.is_empty());

        // Another server's account is an account like any other.
        blocking(&st, "bob", "@alice:elsewhere.example:8448")
            .await
            .unwrap();
        assert_eq!(held(&pool).await.len(), 1);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn without_a_valid_token_nothing_is_recorded(pool: SqlitePool) {
        let (st, _, _) = service(pool.clone()).await;
        let request = || {
            Body(BlockRequest {
                blocked_user_id: "@alice:h".into(),
            })
        };
        assert!(matches!(
            block(State(st.clone()), HeaderMap::new(), request()).await,
            Err(AppError::Unauthenticated)
        ));
        // A token the homeserver does not vouch for.
        let unreachable = state_from(
            pool.clone(),
            "http://127.0.0.1:1".into(),
            Config::for_tests(),
        );
        assert!(matches!(
            block(State(unreachable), bearer("bob"), request()).await,
            Err(AppError::Unauthenticated)
        ));
        assert!(held(&pool).await.is_empty());
    }
}
