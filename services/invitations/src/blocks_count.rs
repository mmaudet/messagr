//! The operator's daily count of blocks (#469, #462, ADR 0015): a pass of the
//! hourly sweep, beside the other alerts' (`cleanup::sweep_sms`).
//!
//! Once a day, at the sweep's first pass between 07:00 and 19:00 UTC, the
//! operator is told how many blocks were recorded since the blocks last told
//! (`handlers::blocks`), and nothing when there were none. The SMS names no
//! account: `Alert::Blocks` carries a number and nothing else. The operator
//! learns who blocked whom from the service's records, never from an alert,
//! and never what was said.
//!
//! # TOLD, OR KEPT FOR THE NEXT COUNT
//!
//! Two marks, in `blocks_count` (migration 021). `counted_at` is when the last
//! count was made, told or not: one a day, and a block recorded after it is
//! dated at or after it. `told_up_to` moves only once a count is told: by SMS,
//! or in the log when the log is the operator's only channel.
//!
//! - **An SMS refused, or that could not leave**: the blocks it counted stay
//!   before `told_up_to`, and the next day's count has them with the new ones.
//! - **No SMS provider or no operator's number**: the log is the only place
//!   the operator reads alerts (#464), so a count written there is told, and
//!   the next one does not repeat it. That is the way chosen for the log-only
//!   case: the same blocks said again every day in the log would be a count
//!   that means nothing.
//! - **A stop between the count and its SMS**: the day's count is spent, and
//!   its blocks wait for the next day's, as for a refused SMS.

use std::{num::NonZeroU64, ops::Range};

use crate::{
    alert::{tell_the_operator, Alert, Told},
    handlers::request::HOUR_SECONDS,
    util::DAY_SECONDS,
    AppState,
};

/// When in the UTC day the count may be told: from 07:00 to 19:00, which is
/// from 08:00 to 20:00 in Paris in winter and from 09:00 to 21:00 in summer.
/// « Prévenu sans être réveillé » (#462): a count due at night waits for the
/// morning's first sweep.
const TOLD_BETWEEN: Range<i64> = 7 * HOUR_SECONDS..19 * HOUR_SECONDS;

/// Tells the operator how many blocks were recorded since the blocks last
/// told, at the first sweep of the day within `TOLD_BETWEEN`. How many were
/// told: zero when no count was due, when there was none to tell, or when the
/// SMS did not leave.
pub async fn tell_the_day_s_count(st: &AppState, now: i64) -> anyhow::Result<u64> {
    let second_of_the_day = now.rem_euclid(DAY_SECONDS);
    if !TOLD_BETWEEN.contains(&second_of_the_day) {
        return Ok(0);
    }
    let day_start = now - second_of_the_day;
    // COUNTED UNDER THE LOCK, for the reason `handlers::blocks::recorded`
    // gives: a block written now comes wholly before this count or wholly
    // after it, and after it is dated at `now` at least.
    let mut tx = st.pool.begin_with("BEGIN IMMEDIATE").await?;
    let (told_up_to, counted_at): (i64, i64) =
        sqlx::query_as("SELECT told_up_to, counted_at FROM blocks_count WHERE id = 1")
            .fetch_one(&mut *tx)
            .await?;
    if counted_at >= day_start {
        tx.rollback().await?;
        return Ok(0);
    }
    let since: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM delivered_blocks WHERE blocked_at >= ? AND blocked_at < ?",
    )
    .bind(told_up_to)
    .bind(now)
    .fetch_one(&mut *tx)
    .await?;
    sqlx::query("UPDATE blocks_count SET counted_at = MAX(counted_at, ?) WHERE id = 1")
        .bind(now)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;

    let since = u64::try_from(since)?;
    let Some(count) = NonZeroU64::new(since) else {
        // Nothing to tell, so nothing waits: none was dated before `now`
        // that is not told already, and those recorded from now on are dated
        // at `now` at least.
        told_up_to_now(st, now).await?;
        return Ok(0);
    };
    let by_sms = st.cfg.sms.to_the_operator().is_ok();
    let told = tell_the_operator(st, &Alert::Blocks(count), now).await;
    if told == Told::BySms || !by_sms {
        told_up_to_now(st, now).await?;
        return Ok(since);
    }
    Ok(0)
}

/// The blocks dated before `now` are told.
async fn told_up_to_now(st: &AppState, now: i64) -> anyhow::Result<()> {
    sqlx::query("UPDATE blocks_count SET told_up_to = MAX(told_up_to, ?) WHERE id = 1")
        .bind(now)
        .execute(&st.pool)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{Config, Sms};
    use crate::handlers::blocks::test_support::{blocking, held, service, service_through, told};
    use crate::handlers::discovery::test_support::{set_clock, state_from, whoami_hs, DAY, T0};
    use crate::sms::test_support::{fake_ovhcloud, fake_ovhcloud_with};
    use sqlx::SqlitePool;
    use std::sync::Arc;

    /// One pass of the hourly sweep at `at`, which must go through.
    async fn swept(st: &Arc<AppState>, at: i64) {
        assert!(
            crate::cleanup::sweep_once(st, at).await,
            "the sweep at {at}"
        );
    }

    /// The start of `T0`'s UTC day.
    fn day_of_t0() -> i64 {
        T0 - T0.rem_euclid(DAY)
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn once_a_day_the_operator_is_told_how_many_blocks_since_the_previous_count(
        pool: SqlitePool,
    ) {
        // #462: « un SMS par jour qui compte les blocages depuis le
        // précédent », and it names no account.
        let (st, time, inbox) = service(pool).await;
        blocking(&st, "bob", "@alice:h").await.unwrap();
        blocking(&st, "carol", "@alice:h").await.unwrap();
        blocking(&st, "dave", "@erin:h").await.unwrap();

        swept(&st, T0 + HOUR_SECONDS).await;
        // The sweep of the next hour, the same day, tells nothing more.
        swept(&st, T0 + 2 * HOUR_SECONDS).await;
        set_clock(&time, T0 + 3 * HOUR_SECONDS);
        blocking(&st, "frank", "@alice:h").await.unwrap();
        swept(&st, T0 + 4 * HOUR_SECONDS).await;
        swept(&st, T0 + DAY).await;

        let said = told(&inbox);
        assert_eq!(
            said,
            [
                "Messagr : 3 blocages depuis le dernier décompte.",
                "Messagr : 1 blocage depuis le dernier décompte.",
            ]
        );
        for text in &said {
            assert!(!text.contains('@') && !text.contains(":h"), "{text}");
        }
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn no_sms_when_there_were_no_blocks_and_a_replay_is_no_block(pool: SqlitePool) {
        let (st, time, inbox) = service(pool).await;
        swept(&st, T0).await;
        assert!(told(&inbox).is_empty(), "nothing to count");

        blocking(&st, "bob", "@alice:h").await.unwrap();
        swept(&st, T0 + DAY).await;
        // Replayed on the third day: the same block, never counted again.
        set_clock(&time, T0 + 2 * DAY);
        blocking(&st, "bob", "@alice:h").await.unwrap();
        swept(&st, T0 + 3 * DAY).await;

        assert_eq!(
            told(&inbox),
            ["Messagr : 1 blocage depuis le dernier décompte."]
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_count_whose_sms_was_refused_is_told_with_the_next_one(pool: SqlitePool) {
        // OVHcloud refuses the first day, and sends the second: the block of
        // the first day is not lost, and not told apart either.
        let (refusing, refused) = fake_ovhcloud(true).await;
        let (st, time) = service_through(pool.clone(), refusing).await;
        blocking(&st, "bob", "@alice:h").await.unwrap();
        swept(&st, T0 + HOUR_SECONDS).await;
        assert_eq!(
            told(&refused),
            ["Messagr : 1 blocage depuis le dernier décompte."],
            "asked, and refused"
        );
        // Once a day all the same: the refusal is not retried every hour.
        swept(&st, T0 + 2 * HOUR_SECONDS).await;
        assert_eq!(told(&refused).len(), 1);

        let (sending, inbox) = fake_ovhcloud(false).await;
        let (next_day, _) = service_through(pool, sending).await;
        set_clock(&time, T0 + 3 * HOUR_SECONDS);
        blocking(&st, "carol", "@alice:h").await.unwrap();
        swept(&next_day, T0 + DAY).await;

        assert_eq!(
            told(&inbox),
            ["Messagr : 2 blocages depuis le dernier décompte."]
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_count_only_the_log_could_tell_is_told_once(pool: SqlitePool) {
        // Without the SMS provider, the log is the operator's only channel
        // (#464): a count written there is not written again the next day.
        let hs = whoami_hs().await;
        let (clock, _) = crate::util::Clock::settable(T0);
        let log_only = state_from(
            pool.clone(),
            hs.clone(),
            Config {
                homeserver_url: hs,
                sms: Sms::default(),
                clock,
                ..Config::for_tests()
            },
        );
        blocking(&log_only, "bob", "@alice:h").await.unwrap();
        assert_eq!(
            tell_the_day_s_count(&log_only, T0 + HOUR_SECONDS)
                .await
                .unwrap(),
            1
        );

        let (with_sms, time, inbox) = service(pool).await;
        set_clock(&time, T0 + 3 * HOUR_SECONDS);
        blocking(&with_sms, "carol", "@alice:h").await.unwrap();
        swept(&with_sms, T0 + DAY).await;

        assert_eq!(
            told(&inbox),
            ["Messagr : 1 blocage depuis le dernier décompte."]
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_block_recorded_while_the_sms_leaves_is_counted_the_next_day(pool: SqlitePool) {
        // OVHcloud takes half a second to answer. A block recorded in that
        // half-second, with a time read before the count, is neither in the
        // count on its way nor lost.
        let (slow, inbox) = fake_ovhcloud_with(false, 500, 1_000.0).await;
        let (st, time) = service_through(pool.clone(), slow).await;
        blocking(&st, "bob", "@alice:h").await.unwrap();

        let counting_at = T0 + HOUR_SECONDS;
        let sweeping = {
            let st = st.clone();
            tokio::spawn(async move { crate::cleanup::sweep_once(&st, counting_at).await })
        };
        // Once the count is made, and while its SMS is on its way.
        for _ in 0..500 {
            let counted_at: i64 =
                sqlx::query_scalar("SELECT counted_at FROM blocks_count WHERE id = 1")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            if counted_at == counting_at {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
        set_clock(&time, counting_at - 10);
        blocking(&st, "carol", "@alice:h").await.unwrap();
        assert!(sweeping.await.unwrap(), "the sweep went through");

        swept(&st, T0 + DAY).await;
        assert_eq!(
            told(&inbox),
            [
                "Messagr : 1 blocage depuis le dernier décompte.",
                "Messagr : 1 blocage depuis le dernier décompte.",
            ]
        );
        let carol_s = held(&pool).await.into_iter().find(|b| b.0 == "@carol:h");
        assert_eq!(carol_s.and_then(|b| b.2), Some(counting_at));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_restart_counts_no_block_twice_and_misses_none(pool: SqlitePool) {
        let (st, time, inbox) = service(pool).await;
        blocking(&st, "bob", "@alice:h").await.unwrap();
        swept(&st, T0 + HOUR_SECONDS).await;

        // The same service started again, its database and nothing else: the
        // count it made is in the database, not in the process.
        let restarted = Arc::new(AppState {
            pool: st.pool.clone(),
            mx: st.mx.clone(),
            cfg: st.cfg.clone(),
        });
        swept(&restarted, T0 + 2 * HOUR_SECONDS).await;
        set_clock(&time, T0 + 3 * HOUR_SECONDS);
        blocking(&restarted, "carol", "@alice:h").await.unwrap();
        swept(&restarted, T0 + DAY).await;

        assert_eq!(
            told(&inbox),
            [
                "Messagr : 1 blocage depuis le dernier décompte.",
                "Messagr : 1 blocage depuis le dernier décompte.",
            ]
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn the_count_is_told_in_the_daytime_never_at_night(pool: SqlitePool) {
        // « afin d'être prévenu sans être réveillé » (#462): between 07:00
        // and 19:00 UTC.
        let (st, _, inbox) = service(pool).await;
        blocking(&st, "bob", "@alice:h").await.unwrap();
        let next_day = day_of_t0() + DAY;

        for night in [
            next_day,
            next_day + 3 * HOUR_SECONDS,
            next_day + 7 * HOUR_SECONDS - 1,
        ] {
            swept(&st, night).await;
        }
        assert!(told(&inbox).is_empty(), "{:?}", told(&inbox));
        swept(&st, next_day + 7 * HOUR_SECONDS).await;
        assert_eq!(told(&inbox).len(), 1);
        // And the evening of a day with no count yet waits for the morning.
        blocking(&st, "carol", "@alice:h").await.unwrap();
        swept(&st, next_day + DAY + 19 * HOUR_SECONDS).await;
        assert_eq!(told(&inbox).len(), 1);
        swept(&st, next_day + 2 * DAY + 7 * HOUR_SECONDS).await;
        assert_eq!(told(&inbox).len(), 2);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn the_blocks_of_406_made_before_their_date_are_never_counted(pool: SqlitePool) {
        // Migration 021: « les blocages d'avant n'en ont pas ».
        let (st, _, inbox) = service(pool.clone()).await;
        sqlx::query(
            "INSERT INTO delivered_blocks (blocker_user_id, blocked_user_id) \
             VALUES ('@bob:h', '@alice:h')",
        )
        .execute(&pool)
        .await
        .unwrap();

        swept(&st, T0).await;
        assert!(told(&inbox).is_empty(), "{:?}", told(&inbox));
        // Blocking again what was blocked before keeps the block as it was.
        blocking(&st, "bob", "@alice:h").await.unwrap();
        assert_eq!(
            held(&pool).await,
            [("@bob:h".into(), "@alice:h".into(), None)]
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_block_recorded_as_a_count_is_made_is_counted_by_the_next(pool: SqlitePool) {
        // The route reads the time, then writes. A count made between the two
        // has counted up to its own instant: the block takes that instant as
        // its date, and the next count has it.
        let (st, time, inbox) = service(pool.clone()).await;
        let counted_at = T0 + HOUR_SECONDS;
        swept(&st, counted_at).await;
        set_clock(&time, counted_at - 5);
        blocking(&st, "bob", "@alice:h").await.unwrap();

        assert_eq!(
            held(&pool).await,
            [("@bob:h".into(), "@alice:h".into(), Some(counted_at))]
        );
        swept(&st, T0 + DAY).await;
        assert_eq!(
            told(&inbox),
            ["Messagr : 1 blocage depuis le dernier décompte."]
        );
    }
}
