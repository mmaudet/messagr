//! The limit on masking (#401, #392, ADR 0014): each proven number has at
//! most 5,000 numbers masked over thirty sliding days, and, during a key
//! change, 5,000 more under the new key, once (#409).
//!
//! A device may ask the service to mask any number; only this limit bounds
//! how much of the directory a findable account can walk. So it is counted
//! on the mask of the caller's proven number, under its key, and not on the
//! account: withdrawing the number, or proving it again, on this account or
//! on another, leaves the count where it was. Under a new key too: the proof
//! that moves the number onto it carries its counts over (#409).
//!
//! # THE EXTENSION OF A KEY CHANGE, A COUNT OF ITS OWN
//!
//! While two keys serve, and for 28 days at most from the new one's first
//! service, a batch under the new key is counted apart, up to `EXTENSION`
//! numbers, once: what lets a device compare its address book again under the
//! new key without eating into its limit (#392, story 36), which the batches
//! under the old key still need for the accounts that have not renewed. What
//! the extension cannot hold of a batch goes on the limit. What it counted
//! never counts against the limit, and is forgotten once it ends.
//!
//! # A DAY AT A TIME
//!
//! The limit is kept per calendar day, in UTC, and a day leaves the window
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
//! what it counted. The caller's proven number is read under that lock too:
//! a batch that crosses a renewal is counted on the number as the renewal
//! left it, never on the one it moved away from.

use sqlx::SqlitePool;

use crate::masking::MaskingKeys;

/// The most numbers one proven number has masked in the window.
pub const PER_NUMBER: i64 = 5_000;

/// How many more a key change allows under the new key, once (#409).
pub const EXTENSION: i64 = 5_000;

/// How long the extension lasts from the new key's first service: the 28
/// days two keys serve together, a proof's lifetime (`handlers/discovery.rs`),
/// rather than the one day of the change, as the owner chose on 27 September
/// 2026.
pub const EXTENSION_SECONDS: i64 = 28 * DAY_SECONDS;

const WINDOW_DAYS: i64 = 30;
const DAY_SECONDS: i64 = 86_400;

/// A proven number, as the count knows it: its mask under its key.
pub struct Number<'a> {
    pub key_id: i64,
    pub mask: &'a [u8],
}

/// What was counted, to give back if the batch is not masked after all: on
/// the extension of a key change, on the limit's day, or on both.
pub struct Counted {
    key_id: i64,
    mask: Vec<u8>,
    /// The key whose change it extends, and how many went on the extension.
    extension: Option<(i64, i64)>,
    /// The calendar day, and how many went on the limit.
    day: Option<(i64, i64)>,
}

pub enum Verdict {
    Counted(Counted),
    /// Over the limit: how many numbers are still allowed, and when the
    /// oldest day counted leaves the window, in Unix time.
    Over {
        remaining: i64,
        frees_at: i64,
    },
    /// The caller has no current proof any more: it proved nothing, or its
    /// proof ended since it was asked.
    NotFindable,
}

/// Counts `elements` numbers masked under `batch_key` on the proven number of
/// `user`, if the extension of a key change holds them all, or the limit
/// does.
pub async fn count_if_allowed(
    pool: &SqlitePool,
    user: &str,
    keys: &MaskingKeys,
    batch_key: u32,
    elements: i64,
    now: i64,
) -> anyhow::Result<Verdict> {
    // A transaction sqlx knows about, for the reason `ceilings.rs` gives: a
    // request dropped while it waits for the lock rolls back with it.
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
    let verdict = judge_and_count(&mut tx, user, keys, batch_key, elements, now).await;
    if matches!(verdict, Ok(Verdict::Counted(_))) {
        tx.commit().await?;
    } else {
        tx.rollback().await?;
    }
    verdict
}

async fn judge_and_count(
    conn: &mut sqlx::SqliteConnection,
    user: &str,
    keys: &MaskingKeys,
    batch_key: u32,
    elements: i64,
    now: i64,
) -> anyhow::Result<Verdict> {
    let proven: Option<(i64, Vec<u8>)> = sqlx::query_as(
        "SELECT key_id, mask FROM findable_numbers \
         WHERE user_id = ? AND withdrawn_at IS NULL AND expires_at > ?",
    )
    .bind(user)
    .bind(now)
    .fetch_optional(&mut *conn)
    .await?;
    let Some((key_id, mask)) = proven else {
        return Ok(Verdict::NotFindable);
    };
    let number = Number {
        key_id,
        mask: &mask,
    };

    // THE EXTENSION FIRST, AS FAR AS IT GOES (#409), and the rest on the
    // limit: a device that compares again under the new key, from a second
    // telephone or a page that did not hold, spends what is left of the
    // extension before the limit the batches under the old key need.
    let (extended, room) = match extended_key(conn, keys, batch_key, now).await? {
        Some(to) => {
            let used: i64 = sqlx::query_scalar(
                "SELECT COALESCE(SUM(masked), 0) FROM masking_extensions \
                 WHERE key_id = ? AND mask = ? AND extension_key = ?",
            )
            .bind(number.key_id)
            .bind(number.mask)
            .bind(to)
            .fetch_one(&mut *conn)
            .await?;
            (Some(to), (EXTENSION - used).max(0))
        }
        None => (None, 0),
    };
    let on_extension = elements.min(room);
    let on_the_limit = elements - on_extension;

    let today = now.div_euclid(DAY_SECONDS);
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
    if used + on_the_limit > PER_NUMBER {
        // With nothing counted, a batch cannot be over: the largest batch
        // (`MAX_BATCH`, `handlers/discovery.rs`) is the limit itself. The
        // oldest day is then today, at worst. What is still allowed is what
        // the extension and the limit can hold together, as a batch sent
        // again is spread between them.
        let oldest = days.first().map_or(today, |(day, _)| *day);
        return Ok(Verdict::Over {
            remaining: (PER_NUMBER - used).max(0) + room,
            frees_at: (oldest + WINDOW_DAYS) * DAY_SECONDS,
        });
    }
    let extension = match extended {
        Some(to) if on_extension > 0 => {
            sqlx::query(
                "INSERT INTO masking_extensions (key_id, mask, extension_key, masked) \
                 VALUES (?, ?, ?, ?) \
                 ON CONFLICT(key_id, mask, extension_key) \
                 DO UPDATE SET masked = masked + excluded.masked",
            )
            .bind(number.key_id)
            .bind(number.mask)
            .bind(to)
            .bind(on_extension)
            .execute(&mut *conn)
            .await?;
            Some((to, on_extension))
        }
        _ => None,
    };
    let day = if on_the_limit > 0 {
        sqlx::query(
            "INSERT INTO masking_counts (key_id, mask, day, masked) VALUES (?, ?, ?, ?) \
             ON CONFLICT(key_id, mask, day) DO UPDATE SET masked = masked + excluded.masked",
        )
        .bind(number.key_id)
        .bind(number.mask)
        .bind(today)
        .bind(on_the_limit)
        .execute(&mut *conn)
        .await?;
        Some((today, on_the_limit))
    } else {
        None
    };
    Ok(Verdict::Counted(Counted {
        key_id: number.key_id,
        mask: number.mask.to_vec(),
        extension,
        day,
    }))
}

/// The key whose change extends a batch under `batch_key`, if any: the
/// newest key, while an older one serves too, and for `EXTENSION_SECONDS`
/// from its first service, which the start notes
/// (`handlers::discovery::note_keys_served`).
async fn extended_key(
    conn: &mut sqlx::SqliteConnection,
    keys: &MaskingKeys,
    batch_key: u32,
    now: i64,
) -> anyhow::Result<Option<i64>> {
    if keys.len() < 2 || batch_key != keys.current().id() {
        return Ok(None);
    }
    let since: Option<i64> =
        sqlx::query_scalar("SELECT since FROM masking_keys_served WHERE key_id = ?")
            .bind(i64::from(batch_key))
            .fetch_optional(&mut *conn)
            .await?;
    Ok(since
        .filter(|since| now < since + EXTENSION_SECONDS)
        .map(|_| i64::from(batch_key)))
}

/// Carries every count of a proven number from what one key masks it as to
/// what another does, when a proof moves it onto a new key (#409): the days of
/// the limit and what an extension counted alike, added to whatever the other
/// already holds. On the connection, and under the lock, of the proof's end.
pub async fn carry(
    conn: &mut sqlx::SqliteConnection,
    from: &Number<'_>,
    to: &Number<'_>,
) -> anyhow::Result<()> {
    for (moved, left) in [
        (
            "INSERT INTO masking_counts (key_id, mask, day, masked) \
             SELECT ?, ?, day, masked FROM masking_counts WHERE key_id = ? AND mask = ? \
             ON CONFLICT(key_id, mask, day) DO UPDATE SET masked = masked + excluded.masked",
            "DELETE FROM masking_counts WHERE key_id = ? AND mask = ?",
        ),
        (
            "INSERT INTO masking_extensions (key_id, mask, extension_key, masked) \
             SELECT ?, ?, extension_key, masked FROM masking_extensions \
             WHERE key_id = ? AND mask = ? \
             ON CONFLICT(key_id, mask, extension_key) \
             DO UPDATE SET masked = masked + excluded.masked",
            "DELETE FROM masking_extensions WHERE key_id = ? AND mask = ?",
        ),
    ] {
        sqlx::query(moved)
            .bind(to.key_id)
            .bind(to.mask)
            .bind(from.key_id)
            .bind(from.mask)
            .execute(&mut *conn)
            .await?;
        sqlx::query(left)
            .bind(from.key_id)
            .bind(from.mask)
            .execute(&mut *conn)
            .await?;
    }
    Ok(())
}

/// Gives back what a batch counted, when it was not masked after all.
pub async fn release(pool: &SqlitePool, counted: Counted) -> anyhow::Result<()> {
    if let Some((to, elements)) = counted.extension {
        sqlx::query(
            "UPDATE masking_extensions SET masked = masked - ? \
             WHERE key_id = ? AND mask = ? AND extension_key = ?",
        )
        .bind(elements)
        .bind(counted.key_id)
        .bind(&counted.mask)
        .bind(to)
        .execute(pool)
        .await?;
    }
    if let Some((day, elements)) = counted.day {
        sqlx::query(
            "UPDATE masking_counts SET masked = masked - ? \
             WHERE key_id = ? AND mask = ? AND day = ?",
        )
        .bind(elements)
        .bind(counted.key_id)
        .bind(&counted.mask)
        .bind(day)
        .execute(pool)
        .await?;
    }
    Ok(())
}

/// Forgets the days that left the window, and what extensions that ended
/// counted: neither counts any more, and nothing else reads them.
pub async fn purge(pool: &SqlitePool, now: i64) -> anyhow::Result<u64> {
    let today = now.div_euclid(DAY_SECONDS);
    let days = sqlx::query("DELETE FROM masking_counts WHERE day <= ?")
        .bind(today - WINDOW_DAYS)
        .execute(pool)
        .await?;
    let extensions = sqlx::query(
        "DELETE FROM masking_extensions WHERE extension_key NOT IN \
         (SELECT key_id FROM masking_keys_served WHERE since > ?)",
    )
    .bind(now - EXTENSION_SECONDS)
    .execute(pool)
    .await?;
    Ok(days.rows_affected() + extensions.rows_affected())
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

    /// `@a:h` findable by the number masked `[7; 64]` under key #1, until
    /// far away.
    async fn findable(pool: &SqlitePool) {
        sqlx::query(
            "INSERT INTO findable_numbers \
             (key_id, mask, user_id, reference, proven_at, expires_at) \
             VALUES (1, ?, '@a:h', 'r', 0, 4000000000)",
        )
        .bind(vec![7_u8; 64])
        .execute(pool)
        .await
        .unwrap();
    }

    fn one_key() -> MaskingKeys {
        MaskingKeys::new(vec![
            crate::masking::MaskingKey::from_seed(1, &[0x01; 32]).unwrap()
        ])
        .unwrap()
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_day_is_forgotten_once_it_has_left_the_window(pool: SqlitePool) {
        findable(&pool).await;
        let at = DAY_ZERO * DAY_SECONDS + 3_600;
        assert!(matches!(
            count_if_allowed(&pool, "@a:h", &one_key(), 1, 10, at)
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

    #[sqlx::test(migrations = "./migrations")]
    async fn an_account_with_no_current_proof_counts_nothing(pool: SqlitePool) {
        assert!(matches!(
            count_if_allowed(&pool, "@a:h", &one_key(), 1, 10, DAY_ZERO * DAY_SECONDS)
                .await
                .unwrap(),
            Verdict::NotFindable
        ));
        assert_eq!(days_kept(&pool).await, 0);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn what_an_extension_counted_is_forgotten_once_it_has_ended(pool: SqlitePool) {
        sqlx::query("INSERT INTO masking_keys_served (key_id, since) VALUES (2, ?)")
            .bind(DAY_ZERO * DAY_SECONDS)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO masking_extensions (key_id, mask, extension_key, masked) \
             VALUES (1, x'07', 2, 100)",
        )
        .execute(&pool)
        .await
        .unwrap();
        let kept = || async {
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM masking_extensions")
                .fetch_one(&pool)
                .await
                .unwrap()
        };

        purge(&pool, DAY_ZERO * DAY_SECONDS + EXTENSION_SECONDS - 1)
            .await
            .unwrap();
        assert_eq!(kept().await, 1, "while the extension lasts");
        purge(&pool, DAY_ZERO * DAY_SECONDS + EXTENSION_SECONDS)
            .await
            .unwrap();
        assert_eq!(kept().await, 0);
    }
}
