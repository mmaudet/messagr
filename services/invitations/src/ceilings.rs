//! The ceilings on the SMS that prove numbers (#399, #392, Q37 of #38).
//!
//! Three of them. An account's: three codes a day and ten in thirty days, for
//! every request, renewals included. A country's in a calendar day, and the
//! service's budget over thirty calendar days: beyond either, new proofs wait
//! and renewals go through, and the operator is told by SMS, once a day and
//! per ceiling. So is a prepaid balance running low at OVHcloud, which the
//! sweep checks: the budget counts SMS, OVHcloud bills credits, and a proof
//! that cannot be paid for is one nobody receives.
//!
//! # COUNTED BEFORE THE SMS LEAVES
//!
//! A code is counted in the same transaction that checks the ceilings, which
//! holds the database's write lock, and uncounted if the SMS does not leave.
//! Counting after the send let requests sent together all read the same
//! counts, and get past every ceiling at once.
//!
//! # COUNTERS, NEVER A NUMBER, AND NO LINK BETWEEN AN ACCOUNT AND A COUNTRY
//!
//! The codes an account asked for are kept by time, without a country; the SMS
//! sent to a country are kept by calendar day, without an account. Nothing
//! here says which country an account's number is in. The sweep forgets both
//! past thirty days.

use std::sync::Arc;

use sqlx::SqlitePool;

use crate::{config::SmsCeilings, sms, sms_history, AppState};

const DAY_SECONDS: i64 = 86_400;
/// The window of an account's monthly ceiling and of the budget.
pub const THIRTY_DAYS_SECONDS: i64 = 30 * DAY_SECONDS;
/// How long an alert is worth delivering: it is still news the next day.
const ALERT_VALID_MINUTES: i64 = 24 * 60;

/// A request for a code, as the ceilings see it.
pub struct Asked<'a> {
    pub user: &'a str,
    /// ISO 3166-1 alpha-2 of the number's country.
    pub country: &'a str,
    /// Whether it proves again the number this account proves now.
    pub renewal: bool,
    pub at: i64,
}

/// What a request for a code may do.
#[derive(Debug, PartialEq)]
pub enum Verdict {
    /// The code may go, and is counted already: `release` it if it does not.
    Counted(Counted),
    /// This account asked too often: it may ask again at `retry_at`.
    TooMany { retry_at: i64 },
    /// A ceiling beyond one account is reached: a new proof waits.
    Later(Reached),
}

/// A code counted before its SMS leaves, to be taken back if it does not.
#[derive(Debug, PartialEq, Eq)]
pub struct Counted {
    account_row: i64,
    country: String,
    day: i64,
}

/// What the operator is told about.
#[derive(Debug, PartialEq)]
pub enum Reached {
    Country(String),
    Budget,
    /// The prepaid balance at OVHcloud, in credits.
    Credits(f64),
}

impl Reached {
    /// The alert's name, to tell the operator once a day per subject.
    fn subject(&self) -> String {
        match self {
            Reached::Country(code) => format!("country:{code}"),
            Reached::Budget => "budget".to_string(),
            Reached::Credits(_) => "credits".to_string(),
        }
    }

    /// What the operator reads: which ceiling, at what figure, and what it does.
    pub fn message(&self, ceilings: &SmsCeilings) -> String {
        match self {
            Reached::Country(code) => format!(
                "Messagr : le plafond du jour est atteint pour les numéros {code} ({} SMS). \
                 Les nouvelles preuves attendent, les renouvellements passent.",
                ceilings.per_country_day
            ),
            Reached::Budget => format!(
                "Messagr : le budget de SMS des trente derniers jours est atteint ({} SMS). \
                 Les nouvelles preuves attendent, les renouvellements passent.",
                ceilings.budget
            ),
            Reached::Credits(left) => format!(
                "Messagr : il reste {left} crédits SMS chez OVHcloud. Sans recharge, les \
                 preuves et leurs renouvellements s'arrêteront."
            ),
        }
    }
}

/// Checks the ceilings for `asked` and, when the code may go, counts it at
/// once, all in one transaction holding the write lock.
pub async fn count_if_allowed(
    pool: &SqlitePool,
    ceilings: &SmsCeilings,
    asked: &Asked<'_>,
) -> anyhow::Result<Verdict> {
    // A TRANSACTION SQLX KNOWS ABOUT, and not `BEGIN IMMEDIATE` sent as a
    // statement: a request dropped while it waits for the lock (a client
    // gone) rolls back with the transaction, where a statement sent by hand
    // left its connection in the pool still holding the lock, and every
    // write after it failed or went nowhere.
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;
    let verdict = judge_and_count(&mut tx, ceilings, asked).await;
    if matches!(verdict, Ok(Verdict::Counted(_))) {
        tx.commit().await?;
    } else {
        tx.rollback().await?;
    }
    verdict
}

async fn judge_and_count(
    conn: &mut sqlx::SqliteConnection,
    ceilings: &SmsCeilings,
    asked: &Asked<'_>,
) -> anyhow::Result<Verdict> {
    // AN ACCOUNT'S CEILINGS HOLD EVERY REQUEST, renewals included, and say
    // when it may ask again: when enough of its codes have left the window.
    let mut retry_at: Option<i64> = None;
    for (window, ceiling) in [
        (DAY_SECONDS, ceilings.per_account_day),
        (THIRTY_DAYS_SECONDS, ceilings.per_account_month),
    ] {
        let sent: Vec<i64> = sqlx::query_scalar(
            "SELECT sent_at FROM sms_by_account WHERE user_id = ? AND sent_at > ? ORDER BY sent_at",
        )
        .bind(asked.user)
        .bind(asked.at - window)
        .fetch_all(&mut *conn)
        .await?;
        let over = i64::try_from(sent.len())? - ceiling;
        if over >= 0 {
            let leaving = usize::try_from(over)
                .ok()
                .and_then(|i| sent.get(i))
                .map_or(asked.at + window, |at| at + window);
            retry_at = Some(retry_at.map_or(leaving, |r| r.max(leaving)));
        }
    }
    if let Some(retry_at) = retry_at {
        return Ok(Verdict::TooMany { retry_at });
    }
    let day = asked.at.div_euclid(DAY_SECONDS);
    if !asked.renewal {
        let this_country: i64 = sqlx::query_scalar(
            "SELECT COALESCE(SUM(sent), 0) FROM sms_by_country_day WHERE country = ? AND day = ?",
        )
        .bind(asked.country)
        .bind(day)
        .fetch_one(&mut *conn)
        .await?;
        if this_country >= ceilings.per_country_day {
            return Ok(Verdict::Later(Reached::Country(asked.country.to_string())));
        }
        let thirty_days: i64 = sqlx::query_scalar(
            "SELECT COALESCE(SUM(sent), 0) FROM sms_by_country_day WHERE day > ?",
        )
        .bind(day - 30)
        .fetch_one(&mut *conn)
        .await?;
        if thirty_days >= ceilings.budget {
            return Ok(Verdict::Later(Reached::Budget));
        }
    }
    let account_row = sqlx::query("INSERT INTO sms_by_account (user_id, sent_at) VALUES (?, ?)")
        .bind(asked.user)
        .bind(asked.at)
        .execute(&mut *conn)
        .await?
        .last_insert_rowid();
    sqlx::query(
        "INSERT INTO sms_by_country_day (country, day, sent) VALUES (?, ?, 1) \
         ON CONFLICT(country, day) DO UPDATE SET sent = sent + 1",
    )
    .bind(asked.country)
    .bind(day)
    .execute(&mut *conn)
    .await?;
    Ok(Verdict::Counted(Counted {
        account_row,
        country: asked.country.to_string(),
        day,
    }))
}

/// Takes back a code counted for an SMS that did not leave.
pub async fn release(pool: &SqlitePool, counted: Counted) -> anyhow::Result<()> {
    sqlx::query("DELETE FROM sms_by_account WHERE rowid = ?")
        .bind(counted.account_row)
        .execute(pool)
        .await?;
    sqlx::query("UPDATE sms_by_country_day SET sent = sent - 1 WHERE country = ? AND day = ?")
        .bind(&counted.country)
        .bind(counted.day)
        .execute(pool)
        .await?;
    Ok(())
}

/// Tells the operator by SMS, once a day per subject. Nothing here refuses
/// anything: an alert that could not leave is written in the log.
pub async fn tell_the_operator(
    st: &AppState,
    sender: &sms::Ovhcloud,
    operator: &str,
    reached: &Reached,
    now: i64,
) {
    tracing::warn!("told to the operator: {reached:?}");
    match first_alert_of_the_day(&st.pool, reached, now).await {
        Ok(true) => {}
        Ok(false) => return,
        Err(e) => {
            tracing::warn!("the alert could not be recorded: {e}");
            return;
        }
    }
    let message = reached.message(&st.cfg.sms_ceilings);
    match sender
        .send(operator, &message, ALERT_VALID_MINUTES, now)
        .await
    {
        Ok(message_id) => {
            let erase_after = now + ALERT_VALID_MINUTES * 60;
            if let Err(e) = sms_history::remember(&st.pool, message_id, erase_after).await {
                tracing::warn!("the alert will not be erased at OVHcloud: {e}");
            }
        }
        Err(e) => tracing::warn!("the alert could not be sent: {e}"),
    }
}

async fn first_alert_of_the_day(
    pool: &SqlitePool,
    reached: &Reached,
    now: i64,
) -> anyhow::Result<bool> {
    let subject = reached.subject();
    let last: Option<i64> = sqlx::query_scalar("SELECT sent_at FROM sms_alerts WHERE ceiling = ?")
        .bind(&subject)
        .fetch_optional(pool)
        .await?;
    if last.is_some_and(|at| at > now - DAY_SECONDS) {
        return Ok(false);
    }
    sqlx::query(
        "INSERT INTO sms_alerts (ceiling, sent_at) VALUES (?, ?) \
         ON CONFLICT(ceiling) DO UPDATE SET sent_at = excluded.sent_at",
    )
    .bind(&subject)
    .bind(now)
    .execute(pool)
    .await?;
    Ok(true)
}

/// Tells the operator when the prepaid balance at OVHcloud falls under
/// `SMS_CREDITS_ALERT_BELOW`. Run by the sweep, while discovery is served.
pub async fn check_the_credits(st: &Arc<AppState>, now: i64) -> anyhow::Result<()> {
    let Ok(served) = st.cfg.discovery() else {
        return Ok(());
    };
    let left = served.provider.credits_left(now).await?;
    if left < st.cfg.sms_ceilings.credits_alert_below as f64 {
        tell_the_operator(
            st,
            served.provider,
            served.operator,
            &Reached::Credits(left),
            now,
        )
        .await;
    }
    Ok(())
}

/// The counters and the alerts, forgotten thirty days later: past the longest
/// window, they count nothing any more.
pub async fn purge_counters(pool: &SqlitePool, now: i64) -> anyhow::Result<u64> {
    let by_account = sqlx::query("DELETE FROM sms_by_account WHERE sent_at <= ?")
        .bind(now - THIRTY_DAYS_SECONDS)
        .execute(pool)
        .await?;
    let by_country = sqlx::query("DELETE FROM sms_by_country_day WHERE day <= ?")
        .bind(now.div_euclid(DAY_SECONDS) - 30)
        .execute(pool)
        .await?;
    let alerts = sqlx::query("DELETE FROM sms_alerts WHERE sent_at <= ?")
        .bind(now - THIRTY_DAYS_SECONDS)
        .execute(pool)
        .await?;
    Ok(by_account.rows_affected() + by_country.rows_affected() + alerts.rows_affected())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[sqlx::test(migrations = "./migrations")]
    async fn the_counters_are_forgotten_thirty_days_later(pool: SqlitePool) {
        let now = 100 * DAY_SECONDS + 3_600;
        let today = now.div_euclid(DAY_SECONDS);
        for (at, day) in [
            (now - THIRTY_DAYS_SECONDS, today - 30),
            (now - THIRTY_DAYS_SECONDS + 1, today - 29),
        ] {
            sqlx::query("INSERT INTO sms_by_account (user_id, sent_at) VALUES ('@a:h', ?)")
                .bind(at)
                .execute(&pool)
                .await
                .unwrap();
            sqlx::query("INSERT INTO sms_by_country_day (country, day, sent) VALUES ('FR', ?, 3)")
                .bind(day)
                .execute(&pool)
                .await
                .unwrap();
            sqlx::query("INSERT INTO sms_alerts (ceiling, sent_at) VALUES (?, ?)")
                .bind(format!("country:{day}"))
                .bind(at)
                .execute(&pool)
                .await
                .unwrap();
        }

        assert_eq!(purge_counters(&pool, now).await.unwrap(), 3);
        for table in ["sms_by_account", "sms_by_country_day", "sms_alerts"] {
            let left: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table}"))
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(left, 1, "{table} keeps what is still in its window");
        }
    }
}
