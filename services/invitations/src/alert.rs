//! Telling the operator (#399, #464).
//!
//! An alert is a sentence for the operator, in French. The service writes it
//! in its log, with a warning that starts `told to the operator: `, and sends
//! it by SMS to the operator's number through its provider when it has both
//! (`config::Sms`), whether discovery is on or not. Without either, the log
//! is all there is, and the service starts all the same: production had
//! neither when #464 was written.
//!
//! Two cadences:
//!
//! - `tell_the_operator`: now, one SMS at each call, and an answer that says
//!   whether it left (`Told`). A route calls it with its state, the hourly
//!   sweep with its own: what the reports (#468) and the daily count of
//!   blocks (#469) are to be told with;
//! - `tell_the_operator_once_a_day`: by SMS once a day per subject, in the
//!   log at each call. What the ceilings of #399 are told with.
//!
//! # NO ACCOUNT, AND NOTHING THAT WAS SAID
//!
//! An alert says what happened, never who did it nor what was written
//! (#462). What was written never reaches this service readable: a report
//! arrives sealed. Accounts do, and a sentence that carries one is held back:
//! no SMS leaves, and the log says only that an alert was held back.
//!
//! Every SMS that leaves is erased from OVHcloud's history once it has had a
//! day to arrive (`sms_history`).

use sqlx::SqlitePool;

use crate::{sms_history, AppState};

/// How long an alert is worth delivering: it is still news the next day.
const VALID_MINUTES: i64 = 24 * 60;
const DAY_SECONDS: i64 = 86_400;

/// What became of an alert told at once: what a caller reads to know whether
/// the operator heard, such as one that groups what it tells and tells again
/// what did not leave.
#[derive(Debug, PartialEq, Eq)]
pub enum Told {
    /// By SMS at the operator's number, and in the log.
    BySms,
    /// In the log alone: this deployment has no SMS provider, or no
    /// operator's number (`config::Sms`).
    OnlyInTheLog,
    /// In the log alone: the provider refused the SMS or could not be
    /// reached, which the log says too.
    SmsFailed,
    /// Nowhere: the sentence names an account. The log says that an alert
    /// was held back, and not what it said.
    HeldBack,
}

/// Tells the operator `alert` now: one SMS at each call, whatever was told
/// before.
///
/// It waits for OVHcloud's answer, fifteen seconds at most: a route that must
/// not wait for it spawns this with its `Arc<AppState>`. `now` is the Unix
/// time it is told at, which signs the request to OVHcloud.
pub async fn tell_the_operator(st: &AppState, alert: &str, now: i64) -> Told {
    if !logged(alert) {
        return Told::HeldBack;
    }
    let Ok((provider, number)) = st.cfg.sms.to_the_operator() else {
        return Told::OnlyInTheLog;
    };
    match provider.send(number, alert, VALID_MINUTES, now).await {
        Ok(message_id) => {
            let erase_after = now + VALID_MINUTES * 60;
            if let Err(e) = sms_history::remember(&st.pool, message_id, erase_after).await {
                tracing::warn!("the alert will not be erased at OVHcloud: {e}");
            }
            Told::BySms
        }
        Err(e) => {
            tracing::warn!("the alert could not be sent: {e}");
            Told::SmsFailed
        }
    }
}

/// Tells the operator `alert` as `tell_the_operator` does, once a day per
/// `subject`, and only writes it in the log at the other calls of the day.
/// The subject is a name that stays the same from one call to the next, such
/// as `budget` for the budget of #399.
pub async fn tell_the_operator_once_a_day(st: &AppState, subject: &str, alert: &str, now: i64) {
    match first_of_the_day(&st.pool, subject, now).await {
        Ok(true) => {
            tell_the_operator(st, alert, now).await;
        }
        Ok(false) => {
            logged(alert);
        }
        Err(e) => {
            tracing::warn!("the alert could not be recorded: {e}");
            logged(alert);
        }
    }
}

/// Writes `alert` in the log, unless it names an account: whether it was
/// written, and so may leave.
fn logged(alert: &str) -> bool {
    if names_an_account(alert) {
        tracing::warn!("an alert to the operator was held back: it named an account");
        return false;
    }
    tracing::warn!("told to the operator: {alert}");
    true
}

/// Whether `text` carries an account's identifier, `@name:server`: the form
/// in which a route learns who calls it (`auth`).
fn names_an_account(text: &str) -> bool {
    text.split('@').skip(1).any(|after| {
        let word = after.split(char::is_whitespace).next().unwrap_or_default();
        word.split_once(':')
            .is_some_and(|(name, server)| !name.is_empty() && !server.is_empty())
    })
}

/// Whether nothing was told about `subject` in the last day, in which case
/// this call is recorded as the day's, before its SMS leaves (#399).
async fn first_of_the_day(pool: &SqlitePool, subject: &str, now: i64) -> anyhow::Result<bool> {
    let last: Option<i64> = sqlx::query_scalar("SELECT sent_at FROM sms_alerts WHERE ceiling = ?")
        .bind(subject)
        .fetch_optional(pool)
        .await?;
    if last.is_some_and(|at| at > now - DAY_SECONDS) {
        return Ok(false);
    }
    sqlx::query(
        "INSERT INTO sms_alerts (ceiling, sent_at) VALUES (?, ?) \
         ON CONFLICT(ceiling) DO UPDATE SET sent_at = excluded.sent_at",
    )
    .bind(subject)
    .bind(now)
    .execute(pool)
    .await?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::handlers::discovery::test_support::{
        bearer, fake_ovhcloud, fake_ovhcloud_with, sent_to, sms_through, state_from, whoami_hs,
        ALERT, DAY, T0,
    };
    use sqlx::SqlitePool;
    use std::sync::Arc;

    /// The service with its SMS provider, the fake OVHcloud at `ovh`, and the
    /// operator's number, and nothing of discovery: production's
    /// configuration once it is given both (#464).
    async fn told_by_sms(pool: SqlitePool, ovh: String) -> Arc<AppState> {
        let hs = whoami_hs().await;
        let (clock, _) = crate::util::Clock::settable(T0);
        state_from(
            pool,
            hs.clone(),
            crate::config::Config {
                homeserver_url: hs,
                sms: sms_through(ovh),
                clock,
                ..crate::config::Config::for_tests()
            },
        )
    }

    const ALERT_TEXT: &str = "Messagr : un essai.";

    #[sqlx::test(migrations = "./migrations")]
    async fn an_alert_leaves_by_sms_at_each_call_with_discovery_off(pool: SqlitePool) {
        let (ovh, inbox) = fake_ovhcloud(false).await;
        let st = told_by_sms(pool, ovh).await;
        assert!(st.cfg.discovery().is_err(), "discovery stays off");

        assert_eq!(tell_the_operator(&st, ALERT_TEXT, T0).await, Told::BySms);
        assert_eq!(tell_the_operator(&st, ALERT_TEXT, T0).await, Told::BySms);
        let sent = inbox.lock().unwrap().sent.clone();
        assert_eq!(
            sent,
            vec![(vec![ALERT.to_string()], ALERT_TEXT.to_string()); 2],
            "one SMS at each call, both at the same instant"
        );
        assert_eq!(sent_to(&inbox, ALERT), 2);

        // Erased from OVHcloud's history once it has had a day to arrive,
        // like the alerts of #399.
        let erased = |at| crate::sms_history::erase_due(&st, at);
        assert_eq!(erased(T0 + DAY - 1).await.unwrap(), 0);
        assert_eq!(erased(T0 + DAY).await.unwrap(), 2);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn the_subjects_of_399_keep_their_day_beside_alerts_told_at_each_call(pool: SqlitePool) {
        // 12 credits left, under the threshold of 100 (#399). Watched with
        // discovery off: the alerts spend the same credits as the proofs.
        let (ovh, inbox) = fake_ovhcloud_with(false, 0, 12.0).await;
        let st = told_by_sms(pool, ovh).await;
        let credits = |at| crate::ceilings::check_the_credits(&st, at);

        credits(T0).await.unwrap();
        assert_eq!(tell_the_operator(&st, ALERT_TEXT, T0).await, Told::BySms);
        credits(T0 + 3_600).await.unwrap();
        assert_eq!(
            tell_the_operator(&st, ALERT_TEXT, T0 + 3_600).await,
            Told::BySms
        );
        credits(T0 + DAY).await.unwrap();

        let at_once: Vec<bool> = inbox
            .lock()
            .unwrap()
            .sent
            .iter()
            .map(|(_, text)| text == ALERT_TEXT)
            .collect();
        assert_eq!(
            at_once,
            [false, true, true, false],
            "the credits, the alert, the alert again, the credits the next day"
        );
        assert_eq!(sent_to(&inbox, ALERT), 4);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn an_alert_that_names_an_account_is_held_back(pool: SqlitePool) {
        let (ovh, inbox) = fake_ovhcloud(false).await;
        let st = told_by_sms(pool, ovh).await;
        // The account as a route knows it: from its token.
        let alice = crate::auth::authenticate(&st.mx, &bearer("alice"))
            .await
            .unwrap();
        for naming in [
            format!("Messagr : {alice} a signalé des messages."),
            format!("Messagr : un blocage ({alice})."),
        ] {
            assert_eq!(
                tell_the_operator(&st, &naming, T0).await,
                Told::HeldBack,
                "{naming}"
            );
        }
        assert_eq!(sent_to(&inbox, ALERT), 0, "no SMS names an account");

        // The same sentence without the account leaves: nothing else held
        // it back.
        assert_eq!(
            tell_the_operator(&st, "Messagr : un compte a signalé des messages.", T0).await,
            Told::BySms
        );
        assert_eq!(sent_to(&inbox, ALERT), 1);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn without_a_provider_or_a_number_an_alert_is_only_logged(pool: SqlitePool) {
        // Production's configuration when #464 was written had neither.
        let (ovh, inbox) = fake_ovhcloud(false).await;
        let hs = whoami_hs().await;
        for sms in [
            crate::config::Sms::default(),
            crate::config::Sms {
                operator: None,
                ..sms_through(ovh.clone())
            },
            crate::config::Sms {
                provider: None,
                ..sms_through(ovh.clone())
            },
        ] {
            let st = state_from(
                pool.clone(),
                hs.clone(),
                crate::config::Config {
                    sms,
                    ..crate::config::Config::for_tests()
                },
            );
            assert_eq!(
                tell_the_operator(&st, ALERT_TEXT, T0).await,
                Told::OnlyInTheLog
            );
        }
        assert!(inbox.lock().unwrap().sent.is_empty(), "no SMS left");
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn an_sms_the_provider_refuses_is_said_to_the_caller(pool: SqlitePool) {
        // What a caller that groups its alerts reads, to tell them again.
        let (ovh, inbox) = fake_ovhcloud(true).await;
        let st = told_by_sms(pool, ovh).await;
        assert_eq!(
            tell_the_operator(&st, ALERT_TEXT, T0).await,
            Told::SmsFailed
        );
        assert_eq!(sent_to(&inbox, ALERT), 1, "asked, and refused");
        assert_eq!(
            crate::sms_history::erase_due(&st, T0 + DAY).await.unwrap(),
            0,
            "nothing to erase"
        );
    }
}
