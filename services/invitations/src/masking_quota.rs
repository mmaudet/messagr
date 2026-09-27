//! The limit on masking (#401, #392, ADR 0014): each proven number has at
//! most 5,000 numbers masked over thirty sliding days.
//!
//! A device may ask the service to mask any number; only this limit bounds
//! how much of the directory a findable account can walk. So it is counted
//! on the mask of the caller's proven number, under its key, and not on the
//! account: withdrawing the number, or proving it again, on this account or
//! on another, leaves the count where it was. Under a new key too: the proof
//! that moves the number onto it carries its count over (#409).
//!
//! # THE EXTENSION OF A KEY CHANGE
//!
//! While two keys serve, and for 28 days from the new one's first service,
//! a batch under the new key may count `EXTENSION` more: what lets a device
//! compare its address book again under the new key, once (#409,
//! `handlers/discovery.rs`).
//!
//! # A DAY AT A TIME
//!
//! The count is kept per calendar day, in UTC, and a day leaves the window
//! thirty days after it began. A refusal says how many numbers are still
//! allowed, and when the oldest day that counts leaves, which is the first
//! moment more are. Ordinary use never locks a number out for good: every day
//! counted leaves within thirty days, and nothing else is kept.
//!
//! # COUNTED BEFORE THE WORK, RELEASED WHEN IT FAILS
//!
//! As the SMS ceilings are (`ceilings.rs`): the check and the count are one
//! transaction under the write lock, so batches sent together cannot all
//! pass on one reading, and a batch refused for what it holds gives back
//! what it counted.

use sqlx::SqlitePool;

/// The most numbers one proven number has masked in the window.
pub const PER_NUMBER: i64 = 5_000;

/// How many more a key change allows under the new key, while two keys serve
/// (#409, `handlers/discovery.rs`).
pub const EXTENSION: i64 = 5_000;
const WINDOW_DAYS: i64 = 30;
const DAY_SECONDS: i64 = 86_400;

/// A proven number, as the count knows it: its mask under its key.
pub struct Number<'a> {
    pub key_id: i64,
    pub mask: &'a [u8],
}

/// What was counted, to give back if the batch is not masked after all.
pub struct Counted {
    key_id: i64,
    mask: Vec<u8>,
    day: i64,
    elements: i64,
}

pub enum Verdict {
    Counted(Counted),
    /// Over the limit: how many numbers are still allowed, and when the
    /// oldest day counted leaves the window, in Unix time.
    Over {
        remaining: i64,
        frees_at: i64,
    },
}

/// Counts `elements` numbers on `number` if `limit` allows them all:
/// `PER_NUMBER`, or more during a key change (#409).
pub async fn count_if_allowed(
    pool: &SqlitePool,
    number: &Number<'_>,
    elements: i64,
    now: i64,
    limit: i64,
) -> anyhow::Result<Verdict> {
    let today = now.div_euclid(DAY_SECONDS);
    let mut conn = pool.acquire().await?;
    sqlx::query("BEGIN IMMEDIATE").execute(&mut *conn).await?;
    let verdict = judge_and_count(&mut conn, number, elements, today, limit).await;
    let end = if matches!(verdict, Ok(Verdict::Counted(_))) {
        "COMMIT"
    } else {
        "ROLLBACK"
    };
    sqlx::query(end).execute(&mut *conn).await?;
    verdict
}

async fn judge_and_count(
    conn: &mut sqlx::SqliteConnection,
    number: &Number<'_>,
    elements: i64,
    today: i64,
    limit: i64,
) -> anyhow::Result<Verdict> {
    let days: Vec<(i64, i64)> = sqlx::query_as(
        // A day whose batches were all given back counts nothing, and its
        // leaving would free nothing: it is not the oldest day that counts.
        "SELECT day, masked FROM masking_counts \
         WHERE key_id = ? AND mask = ? AND day > ? AND masked > 0 ORDER BY day",
    )
    .bind(number.key_id)
    .bind(number.mask)
    .bind(today - WINDOW_DAYS)
    .fetch_all(&mut *conn)
    .await?;
    let used: i64 = days.iter().map(|(_, masked)| masked).sum();
    if used + elements > limit {
        // With nothing counted, a batch cannot be over: the largest batch
        // (`MAX_BATCH`, `handlers/discovery.rs`) is the limit itself. The
        // oldest day is then today, at worst.
        let oldest = days.first().map_or(today, |(day, _)| *day);
        return Ok(Verdict::Over {
            remaining: (limit - used).max(0),
            frees_at: (oldest + WINDOW_DAYS) * DAY_SECONDS,
        });
    }
    sqlx::query(
        "INSERT INTO masking_counts (key_id, mask, day, masked) VALUES (?, ?, ?, ?) \
         ON CONFLICT(key_id, mask, day) DO UPDATE SET masked = masked + excluded.masked",
    )
    .bind(number.key_id)
    .bind(number.mask)
    .bind(today)
    .bind(elements)
    .execute(&mut *conn)
    .await?;
    Ok(Verdict::Counted(Counted {
        key_id: number.key_id,
        mask: number.mask.to_vec(),
        day: today,
        elements,
    }))
}

/// Gives back what a batch counted, when it was not masked after all.
pub async fn release(pool: &SqlitePool, counted: Counted) -> anyhow::Result<()> {
    sqlx::query(
        "UPDATE masking_counts SET masked = masked - ? \
         WHERE key_id = ? AND mask = ? AND day = ?",
    )
    .bind(counted.elements)
    .bind(counted.key_id)
    .bind(&counted.mask)
    .bind(counted.day)
    .execute(pool)
    .await?;
    Ok(())
}

/// Forgets the days that left the window: they no longer count, and nothing
/// else reads them.
pub async fn purge(pool: &SqlitePool, now: i64) -> anyhow::Result<u64> {
    let today = now.div_euclid(DAY_SECONDS);
    let done = sqlx::query("DELETE FROM masking_counts WHERE day <= ?")
        .bind(today - WINDOW_DAYS)
        .execute(pool)
        .await?;
    Ok(done.rows_affected())
}

#[cfg(test)]
mod tests {
    use super::*;

    const DAY_ZERO: i64 = 20_717;

    async fn days_kept(pool: &SqlitePool) -> i64 {
        sqlx::query_scalar("SELECT COUNT(*) FROM masking_counts")
            .fetch_one(pool)
            .await
            .unwrap()
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_day_is_forgotten_once_it_has_left_the_window(pool: SqlitePool) {
        let number = Number {
            key_id: 1,
            mask: &[7; 64],
        };
        let at = DAY_ZERO * DAY_SECONDS + 3_600;
        assert!(matches!(
            count_if_allowed(&pool, &number, 10, at, PER_NUMBER)
                .await
                .unwrap(),
            Verdict::Counted(_)
        ));

        assert_eq!(purge(&pool, at + 29 * DAY_SECONDS).await.unwrap(), 0);
        assert_eq!(days_kept(&pool).await, 1, "still in the window");
        assert_eq!(
            purge(&pool, (DAY_ZERO + 30) * DAY_SECONDS).await.unwrap(),
            1,
            "the day it leaves"
        );
        assert_eq!(days_kept(&pool).await, 0);
    }
}
