//! What the hourly sweep erases of a report after its decision (#473,
//! ADR 0015): its sealed report and its idempotency key 181 days after the
//! first decision, which never exceeds six calendar months, and the whole
//! record 365 days after it, which never exceeds twelve. Neither while the
//! report is held for the authorities, and neither while it has no decision:
//! the terms promise a decision within thirty days, and the list shows the
//! report as awaiting until there is one.
//!
//! The erasures count from the first decision. A second one, after a
//! contestation, replaces the first one's outcome and motivation, and moves
//! neither: `decided_on` is written once (`moderation::decide`).

use sqlx::SqlitePool;

use crate::util::DAY_SECONDS;

/// How long the sealed report and its idempotency key outlive the first
/// decision: 181 days, which never exceed six calendar months.
pub const SEALED_KEPT_DAYS: i64 = 181;
/// How long the record outlives the first decision: 365 days, which never
/// exceed twelve calendar months.
pub const RECORD_KEPT_DAYS: i64 = 365;

/// When the sealed report of a report first decided on `decided_on` goes.
pub fn sealed_goes_on(decided_on: i64) -> i64 {
    decided_on + SEALED_KEPT_DAYS * DAY_SECONDS
}

/// When the record of a report first decided on `decided_on` goes.
pub fn record_goes_on(decided_on: i64) -> i64 {
    decided_on + RECORD_KEPT_DAYS * DAY_SECONDS
}

/// Erases the sealed report and the idempotency key of every report whose
/// `sealed_goes_on` has come, and not held for the authorities. A report with
/// no decision is not touched: its `decided_on` is NULL.
pub async fn erase_sealed_reports(pool: &SqlitePool, now: i64) -> anyhow::Result<u64> {
    let erased = sqlx::query(
        "UPDATE reports SET sealed = NULL, idempotency_key = NULL \
         WHERE (sealed IS NOT NULL OR idempotency_key IS NOT NULL) \
           AND held_since IS NULL AND decided_on + ? <= ?",
    )
    .bind(SEALED_KEPT_DAYS * DAY_SECONDS)
    .bind(now)
    .execute(pool)
    .await?;
    Ok(erased.rows_affected())
}

/// Erases every report whose `record_goes_on` has come, and not held for the
/// authorities: what was decided, and whom it came from. A report with no
/// decision is not touched.
pub async fn erase_decided_reports(pool: &SqlitePool, now: i64) -> anyhow::Result<u64> {
    let erased =
        sqlx::query("DELETE FROM reports WHERE held_since IS NULL AND decided_on + ? <= ?")
            .bind(RECORD_KEPT_DAYS * DAY_SECONDS)
            .bind(now)
            .execute(pool)
            .await?;
    Ok(erased.rows_affected())
}

/// Both erasures, as the hourly sweep runs them (`cleanup::sweep_once`):
/// each runs whatever the other does, and a failure is returned once both
/// have.
pub async fn sweep(pool: &SqlitePool, now: i64) -> anyhow::Result<[u64; 2]> {
    let sealed = erase_sealed_reports(pool, now).await;
    let records = erase_decided_reports(pool, now).await;
    Ok([sealed?, records?])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::util::{civil, day_of, days_from_civil};

    /// What `retention.json` names as applying `entry`, one line a measure.
    fn applied(retention: &serde_json::Value, entry: &str) -> String {
        retention[entry]["applique_par"]
            .as_array()
            .unwrap_or_else(|| panic!("{entry}: no applique_par"))
            .iter()
            .map(|line| line.as_str().unwrap().to_string())
            .collect::<Vec<_>>()
            .join("\n")
    }

    /// The name of an item as the code spells it, from the item itself: the
    /// one token both come from, so that a rename changes the name, and a name
    /// that no longer exists does not compile.
    macro_rules! named {
        ($item:ident) => {{
            let _ = $item;
            stringify!($item)
        }};
    }

    /// `deploy/messagr-eu/retention.json` holds each duration once, and the
    /// published policy is checked against it (`scripts/assert-retention.sh`).
    /// Here the other half: the file names these erasures and the constants
    /// of the days they keep, as the code names them, with those days, and
    /// says the durations the policy says. A function or a constant renamed or
    /// changed without the file, or the file without the code, turns this red.
    #[test]
    fn retention_json_names_these_erasures_and_the_days_they_keep() {
        let retention: serde_json::Value =
            serde_json::from_str(include_str!("../../../../deploy/messagr-eu/retention.json"))
                .unwrap();

        let content = applied(&retention, "signalements_contenu");
        assert!(names(&content, named!(erase_sealed_reports)), "{content}");
        let sealed_days = format!("{} = {SEALED_KEPT_DAYS} jours", named!(SEALED_KEPT_DAYS));
        assert!(names(&content, &sealed_days), "{sealed_days}: {content}");
        assert_eq!(
            retention["signalements_contenu"]["duree"],
            "six mois après la décision"
        );

        let decisions = applied(&retention, "signalements_decisions");
        assert!(
            names(&decisions, named!(erase_decided_reports)),
            "{decisions}"
        );
        let record_days = format!("{} = {RECORD_KEPT_DAYS} jours", named!(RECORD_KEPT_DAYS));
        assert!(
            names(&decisions, &record_days),
            "{record_days}: {decisions}"
        );
        assert!(names(&decisions, named!(sweep)), "{decisions}");
        assert_eq!(
            retention["signalements_decisions"]["duree"],
            "douze mois après la décision"
        );
    }

    /// Whether `text` names `name` whole: `sweep` in `moderation::sweep`, not
    /// in `cleanup::sweep_once`, whose own name holds it.
    fn names(text: &str, name: &str) -> bool {
        let a_part_of_a_name = |c: Option<char>| c.is_some_and(|c| c.is_alphanumeric() || c == '_');
        text.match_indices(name).any(|(at, _)| {
            !a_part_of_a_name(text[..at].chars().next_back())
                && !a_part_of_a_name(text[at + name.len()..].chars().next())
        })
    }

    #[test]
    fn a_name_is_found_whole_or_not_at_all() {
        assert!(names("par moderation::sweep, puis", "sweep"));
        assert!(!names("par cleanup::sweep_once", "sweep"));
        assert!(!names("the_sweep", "sweep"));
        assert!(names(
            "SEALED_KEPT_DAYS = 181 jours",
            "SEALED_KEPT_DAYS = 181 jours"
        ));
        assert!(!names(
            "XSEALED_KEPT_DAYS = 181 jours",
            "SEALED_KEPT_DAYS = 181 jours"
        ));
    }

    /// `months` calendar months after a date, on the same day of the month,
    /// or on the last day of a shorter month.
    fn months_after(year: i64, month: i64, day: i64, months: i64) -> i64 {
        let index = year * 12 + (month - 1) + months;
        let (year, month) = (index.div_euclid(12), index.rem_euclid(12) + 1);
        let last = days_from_civil(year + i64::from(month == 12), month % 12 + 1, 1)
            - days_from_civil(year, month, 1);
        days_from_civil(year, month, day.min(last))
    }

    /// Six months for the content, twelve for what was decided: ADR 0015
    /// (« Its content is erased six months after the decision ») and #462
    /// (« Le ménage horaire efface le pli six mois après la décision, sauf
    /// s'il a été transmis aux autorités, et l'enregistrement douze mois après
    /// la décision »). Whatever the day of a decision, what is erased goes
    /// within six and twelve calendar months.
    #[test]
    fn neither_erasure_ever_comes_later_than_six_and_twelve_calendar_months() {
        for day in days_from_civil(2026, 1, 1)..days_from_civil(2034, 1, 1) {
            let (year, month, day_of_the_month) = civil(day);
            let (month, day_of_the_month) = (i64::from(month), i64::from(day_of_the_month));
            // The earliest instant of the day is the latest the erasures can
            // be, measured from the decision.
            let on = day_of(day * DAY_SECONDS);
            assert!(
                sealed_goes_on(on) <= months_after(year, month, day_of_the_month, 6) * DAY_SECONDS,
                "{year}-{month}-{day_of_the_month}: six months"
            );
            assert!(
                record_goes_on(on) <= months_after(year, month, day_of_the_month, 12) * DAY_SECONDS,
                "{year}-{month}-{day_of_the_month}: twelve months"
            );
        }
    }
}
