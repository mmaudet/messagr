//! Telling the operator (#399, #462, #464).
//!
//! What the operator is told is one of a closed list, `Alert`, and each alert
//! is told by a sentence written here from typed figures only: a country's
//! code, a ceiling, a balance, report numbers and reasons (`report`), a
//! count. No sentence comes from anywhere else, so no SMS can carry an
//! account or anything that was said: what was said never reaches this
//! service readable, a report arrives sealed (ADR 0015).
//!
//! The service writes each alert in its log, with a warning that starts
//! `told to the operator: `, and sends it by SMS to the operator's number
//! through its provider when it has both (`config::Sms`), whether discovery
//! is on or not. Without either, the log is all there is, and the service
//! starts all the same: production had neither when #464 was written.
//!
//! The cadence belongs to the alert. The ceilings of #399 and the prepaid
//! balance go by SMS once a day each. Reports and blocks go at each call,
//! since their callers keep their own: #468 tells each report, #478 will
//! group them every quarter of an hour, and #469 counts the blocks once a
//! day from the hourly sweep.
//!
//! Every SMS that leaves is erased from OVHcloud's history once it has had a
//! day to arrive (`sms_history`).

use std::num::NonZeroU64;

use sqlx::SqlitePool;

use crate::{countries::CountryCode, report::Reports, sms_history, util::DAY_SECONDS, AppState};

/// How long an alert is worth delivering: it is still news the next day.
const VALID_MINUTES: i64 = 24 * 60;
/// How long the day a subject was told is kept: past a day it limits
/// nothing, and the sweep forgets it at thirty, like the ceilings' counters.
const DAYS_KEPT_SECONDS: i64 = 30 * DAY_SECONDS;

/// What the operator is told: the whole list.
#[derive(Debug)]
pub enum Alert {
    /// A country's ceiling for the day on the SMS that prove numbers is
    /// reached (#399). Once a day per country.
    CountryCeiling { country: CountryCode, per_day: i64 },
    /// The budget of SMS over thirty days is reached (#399). Once a day.
    Budget { per_thirty_days: i64 },
    /// The prepaid credits at OVHcloud run low (#399). Once a day.
    CreditsLow { left: f64 },
    /// Reports received (#462): their numbers and reasons. At each call.
    #[cfg_attr(
        not(test),
        expect(dead_code, reason = "the reports route of #468 tells them")
    )]
    ReportsReceived(Reports),
    /// Blocks since the previous count (#462), one at least. At each call.
    #[cfg_attr(
        not(test),
        expect(dead_code, reason = "the daily count of #469 tells them")
    )]
    Blocks(NonZeroU64),
}

/// When an alert goes by SMS.
enum Cadence {
    AtEachCall,
    /// The first time in a day, under a subject that stays the same from one
    /// call to the next.
    OnceADay(String),
}

impl Alert {
    fn cadence(&self) -> Cadence {
        match self {
            Alert::CountryCeiling { country, .. } => {
                Cadence::OnceADay(format!("country:{country}"))
            }
            Alert::Budget { .. } => Cadence::OnceADay("budget".into()),
            Alert::CreditsLow { .. } => Cadence::OnceADay("credits".into()),
            Alert::ReportsReceived(_) | Alert::Blocks(_) => Cadence::AtEachCall,
        }
    }

    /// What the operator reads, in French.
    fn text(&self) -> String {
        match self {
            Alert::CountryCeiling { country, per_day } => format!(
                "Messagr : le plafond du jour est atteint pour les numéros {country} \
                 ({per_day} SMS). Les nouvelles preuves attendent, les renouvellements passent."
            ),
            Alert::Budget { per_thirty_days } => format!(
                "Messagr : le budget de SMS des trente derniers jours est atteint \
                 ({per_thirty_days} SMS). Les nouvelles preuves attendent, les renouvellements \
                 passent."
            ),
            // Whether discovery is on or not (#464): with it off, what stops
            // is the operator's alerts.
            Alert::CreditsLow { left } => format!(
                "Messagr : il reste {left} crédits SMS chez OVHcloud. Sans recharge, plus \
                 aucun SMS ne partira, ces alertes comprises."
            ),
            Alert::ReportsReceived(reports) => {
                let received = match reports.count() {
                    1 => "1 signalement reçu".to_string(),
                    n => format!("{n} signalements reçus"),
                };
                let listed: Vec<String> = reports
                    .urgent_first()
                    .map(|(number, reason)| format!("{number} ({})", reason.in_an_sms()))
                    .collect();
                format!("Messagr : {received} : {}.", listed.join(", "))
            }
            Alert::Blocks(count) => match count.get() {
                1 => "Messagr : 1 blocage depuis le dernier décompte.".to_string(),
                n => format!("Messagr : {n} blocages depuis le dernier décompte."),
            },
        }
    }
}

/// What became of an alert.
#[derive(Debug, PartialEq, Eq)]
pub enum Told {
    /// By SMS at the operator's number, and in the log.
    BySms,
    /// In the log alone: this deployment has no SMS provider or no
    /// operator's number (`config::Sms`), OVHcloud refused the SMS or could
    /// not be reached, or the subject was told by SMS already that day.
    OnlyInTheLog,
}

/// Tells the operator `alert`: in the log at each call, and by SMS at the
/// alert's cadence.
///
/// It waits for OVHcloud's answer, fifteen seconds at most: a route that must
/// not wait for it spawns this with its `Arc<AppState>`. `now` is the Unix
/// time it is told at, which signs the request to OVHcloud.
pub async fn tell_the_operator(st: &AppState, alert: &Alert, now: i64) -> Told {
    let text = alert.text();
    tracing::warn!("told to the operator: {text}");
    if let Cadence::OnceADay(subject) = alert.cadence() {
        match first_of_the_day(&st.pool, &subject, now).await {
            Ok(true) => {}
            Ok(false) => return Told::OnlyInTheLog,
            Err(e) => {
                tracing::warn!("the alert could not be recorded: {e}");
                return Told::OnlyInTheLog;
            }
        }
    }
    let Ok((provider, number)) = st.cfg.sms.to_the_operator() else {
        return Told::OnlyInTheLog;
    };
    match provider.send(number, &text, VALID_MINUTES, now).await {
        Ok(message_id) => {
            let erase_after = now + VALID_MINUTES * 60;
            if let Err(e) = sms_history::remember(&st.pool, message_id, erase_after).await {
                tracing::warn!("the alert will not be erased at OVHcloud: {e}");
            }
            Told::BySms
        }
        Err(e) => {
            tracing::warn!("the alert could not be sent: {e}");
            Told::OnlyInTheLog
        }
    }
}

/// Whether nothing was told about `subject` in the last day, in which case
/// this call is recorded as the day's, before its SMS leaves (#399).
///
/// The table's `ceiling` column holds any subject told once a day, the
/// prepaid balance's too: it kept the name it had when only ceilings were.
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

/// The days subjects were told, forgotten thirty days later
/// (`DAYS_KEPT_SECONDS`).
pub async fn forget_the_days(pool: &SqlitePool, now: i64) -> anyhow::Result<u64> {
    let forgotten = sqlx::query("DELETE FROM sms_alerts WHERE sent_at <= ?")
        .bind(now - DAYS_KEPT_SECONDS)
        .execute(pool)
        .await?;
    Ok(forgotten.rows_affected())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{Config, Sms};
    use crate::handlers::discovery::test_support::{state_from, whoami_hs, DAY, T0};
    use crate::report::{Reason, ReportNumber, Reports};
    use crate::sms::test_support::{
        fake_ovhcloud, fake_ovhcloud_with, sent_to, sms_through, Inbox, OPERATOR_NUMBER,
    };
    use sqlx::SqlitePool;
    use std::sync::{Arc, Mutex};

    /// The service with its SMS provider, the fake OVHcloud at `ovh`, and the
    /// operator's number, and nothing of discovery: production's
    /// configuration once it is given both (#464).
    async fn told_by_sms(pool: SqlitePool, ovh: String) -> Arc<AppState> {
        let hs = whoami_hs().await;
        let (clock, _) = crate::util::Clock::settable(T0);
        state_from(
            pool,
            hs.clone(),
            Config {
                homeserver_url: hs,
                sms: sms_through(ovh),
                clock,
                ..Config::for_tests()
            },
        )
    }

    /// The same, through an OVHcloud nobody answers at, under an SMS account
    /// no other test names, since the log is the whole binary's.
    async fn told_through_nobody(
        pool: SqlitePool,
        service_name: &str,
        operator_number: Option<&str>,
    ) -> Arc<AppState> {
        let mut sms = Sms {
            operator_number: operator_number.map(Into::into),
            ..sms_through("http://127.0.0.1:1".into())
        };
        if let Some(provider) = sms.provider.as_mut() {
            provider.service_name = service_name.into();
        }
        state_from(
            pool,
            whoami_hs().await,
            Config {
                sms,
                ..Config::for_tests()
            },
        )
    }

    fn reports(given: &[(&str, Reason)]) -> Alert {
        let given = given
            .iter()
            .map(|(typed, reason)| (ReportNumber::parse(typed).unwrap(), *reason))
            .collect();
        Alert::ReportsReceived(Reports::new(given).unwrap())
    }

    fn blocks(count: u64) -> Alert {
        Alert::Blocks(std::num::NonZeroU64::new(count).unwrap())
    }

    /// What reached the operator's number, in order, and nothing reached
    /// another.
    fn told(inbox: &Arc<Mutex<Inbox>>) -> Vec<String> {
        let inbox = inbox.lock().unwrap();
        for (to, _) in &inbox.sent {
            assert_eq!(to, &[OPERATOR_NUMBER]);
        }
        inbox.sent.iter().map(|(_, text)| text.clone()).collect()
    }

    /// The service's log, as the operator reads it.
    #[derive(Clone, Default)]
    struct Log(Arc<Mutex<Vec<u8>>>);

    impl Log {
        /// Everything the tests of this binary log from the first call on.
        /// ONE SUBSCRIBER FOR THE WHOLE BINARY, and each test looks for what
        /// only it writes: a subscriber per thread misses lines when tests run
        /// in parallel, since tracing decides for every thread at once whether
        /// a line is worth writing.
        fn of_the_service() -> &'static Log {
            static LOG: std::sync::OnceLock<Log> = std::sync::OnceLock::new();
            LOG.get_or_init(|| {
                let log = Log::default();
                let subscriber = tracing_subscriber::fmt()
                    .with_writer(log.clone())
                    .with_ansi(false)
                    .finish();
                tracing::subscriber::set_global_default(subscriber)
                    .expect("the only subscriber of the tests");
                log
            })
        }

        fn read(&self) -> String {
            String::from_utf8_lossy(&self.0.lock().unwrap()).into_owned()
        }
    }

    impl std::io::Write for Log {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(bytes);
            Ok(bytes.len())
        }

        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    impl<'a> tracing_subscriber::fmt::MakeWriter<'a> for Log {
        type Writer = Log;

        fn make_writer(&'a self) -> Log {
            self.clone()
        }
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn reports_are_told_at_each_call_with_their_numbers_and_reasons_urgent_first(
        pool: SqlitePool,
    ) {
        // #462: « avec le nombre, les numéros et les motifs, les motifs
        // urgents en tête ».
        let (ovh, inbox) = fake_ovhcloud(false).await;
        let st = told_by_sms(pool, ovh).await;
        assert!(st.cfg.discovery().is_err(), "discovery stays off");

        let one = reports(&[("K7QM-4ZT2", Reason::Harassment)]);
        assert_eq!(tell_the_operator(&st, &one, T0).await, Told::BySms);
        assert_eq!(tell_the_operator(&st, &one, T0).await, Told::BySms);
        let two = reports(&[
            ("ABCD-EFGH", Reason::Solicitation),
            ("K7QM-4ZT2", Reason::Threat),
        ]);
        assert_eq!(tell_the_operator(&st, &two, T0).await, Told::BySms);
        assert_eq!(
            told(&inbox),
            [
                "Messagr : 1 signalement reçu : K7QM-4ZT2 (harcèlement).",
                "Messagr : 1 signalement reçu : K7QM-4ZT2 (harcèlement).",
                "Messagr : 2 signalements reçus : K7QM-4ZT2 (menace), ABCD-EFGH (démarchage).",
            ]
        );

        // Erased from OVHcloud's history once they have had a day to arrive,
        // like the alerts of #399.
        let erased = |at| crate::sms_history::erase_due(&st, at);
        assert_eq!(erased(T0 + DAY - 1).await.unwrap(), 0);
        assert_eq!(erased(T0 + DAY).await.unwrap(), 3);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn blocks_are_counted_and_told_at_each_call(pool: SqlitePool) {
        // #462: one SMS a day counts the blocks since the previous one. The
        // day is kept by the count's caller (#469): each count it tells leaves.
        let (ovh, inbox) = fake_ovhcloud(false).await;
        let st = told_by_sms(pool, ovh).await;
        for count in [1, 12, 12] {
            assert_eq!(
                tell_the_operator(&st, &blocks(count), T0).await,
                Told::BySms
            );
        }
        assert_eq!(
            told(&inbox),
            [
                "Messagr : 1 blocage depuis le dernier décompte.",
                "Messagr : 12 blocages depuis le dernier décompte.",
                "Messagr : 12 blocages depuis le dernier décompte.",
            ]
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn the_subjects_of_399_keep_their_day_beside_alerts_told_at_each_call(pool: SqlitePool) {
        // 12 credits left, under the threshold of 100 (#399). Watched with
        // discovery off: the alerts spend the same credits as the proofs.
        let (ovh, inbox) = fake_ovhcloud_with(false, 0, 12.0).await;
        let st = told_by_sms(pool, ovh).await;
        let credits = |at| crate::ceilings::check_the_credits(&st, at);

        credits(T0).await;
        tell_the_operator(&st, &blocks(1), T0).await;
        credits(T0 + 3_600).await;
        tell_the_operator(&st, &blocks(1), T0 + 3_600).await;
        credits(T0 + DAY).await;

        let the_balance = "Messagr : il reste 12 crédits SMS chez OVHcloud. Sans recharge, \
                           plus aucun SMS ne partira, ces alertes comprises.";
        let a_block = "Messagr : 1 blocage depuis le dernier décompte.";
        assert_eq!(
            told(&inbox),
            [the_balance, a_block, a_block, the_balance],
            "the balance, a block, a block again, the balance the next day"
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn without_a_provider_or_a_number_an_alert_is_only_logged(pool: SqlitePool) {
        // Production's configuration when #464 was written had neither.
        let (ovh, inbox) = fake_ovhcloud(false).await;
        let hs = whoami_hs().await;
        let log = Log::of_the_service();
        // A count no other test tells, since the log is the whole binary's.
        let alert = blocks(4641);
        for sms in [
            Sms::default(),
            Sms {
                operator_number: None,
                ..sms_through(ovh.clone())
            },
            Sms {
                provider: None,
                ..sms_through(ovh.clone())
            },
        ] {
            let st = state_from(
                pool.clone(),
                hs.clone(),
                Config {
                    sms,
                    ..Config::for_tests()
                },
            );
            assert_eq!(tell_the_operator(&st, &alert, T0).await, Told::OnlyInTheLog);
        }
        assert!(inbox.lock().unwrap().sent.is_empty(), "no SMS left");
        let said = log.read();
        assert_eq!(
            said.matches(
                "told to the operator: Messagr : 4641 blocages depuis le dernier décompte."
            )
            .count(),
            3,
            "the log is where the operator reads it: {said}"
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn an_sms_the_provider_refuses_leaves_the_alert_in_the_log(pool: SqlitePool) {
        let (ovh, inbox) = fake_ovhcloud(true).await;
        let st = told_by_sms(pool, ovh).await;
        assert_eq!(
            tell_the_operator(&st, &blocks(1), T0).await,
            Told::OnlyInTheLog
        );
        assert_eq!(sent_to(&inbox, OPERATOR_NUMBER), 1, "asked, and refused");
        assert_eq!(
            crate::sms_history::erase_due(&st, T0 + DAY).await.unwrap(),
            0,
            "nothing to erase"
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn without_the_operator_s_number_the_credits_are_not_read(pool: SqlitePool) {
        // Nobody could be told by SMS: the hourly sweep asks OVHcloud
        // nothing, so a provider nobody answers at says nothing either.
        let log = Log::of_the_service();
        let st = told_through_nobody(pool, "sms-sans-numero-1", None).await;
        crate::ceilings::check_the_credits(&st, T0).await;
        assert!(
            !log.read().contains("sms-sans-numero-1"),
            "OVHcloud was asked"
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn an_unreachable_provider_is_said_once_a_sweep_and_fails_nothing_else(pool: SqlitePool) {
        let log = Log::of_the_service();
        let st = told_through_nobody(pool, "sms-injoignable-1", Some(OPERATOR_NUMBER)).await;
        assert!(
            crate::cleanup::sweep_once(&st, T0).await,
            "the rest of the sweep went through"
        );
        let said = log.read();
        let about_it: Vec<&str> = said
            .lines()
            .filter(|line| line.contains("sms-injoignable-1"))
            .collect();
        assert_eq!(about_it.len(), 1, "{said}");
        assert!(about_it[0].contains("could not be read"), "{}", about_it[0]);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn the_days_alerts_were_told_are_forgotten_after_thirty_days(pool: SqlitePool) {
        // #399: a day limits nothing past a day; the sweep forgets it at
        // thirty, like the ceilings' counters.
        for (subject, at) in [("budget", T0), ("credits", T0 + 1)] {
            sqlx::query("INSERT INTO sms_alerts (ceiling, sent_at) VALUES (?, ?)")
                .bind(subject)
                .bind(at)
                .execute(&pool)
                .await
                .unwrap();
        }
        assert_eq!(forget_the_days(&pool, T0 + 30 * DAY).await.unwrap(), 1);
        let left: Vec<String> = sqlx::query_scalar("SELECT ceiling FROM sms_alerts")
            .fetch_all(&pool)
            .await
            .unwrap();
        assert_eq!(left, ["credits"]);
    }
}
