//! What the operator does with a report, typed on the host (#473, #462,
//! ADR 0015): list the reports that await a decision, export one sealed
//! report for the opening tool, record a decision, hold a report for the
//! authorities and release it, and record an account terminated after a
//! confirmed decision among the account deletions. What a command line names
//! is read in `command_line`, what a motivation may hold in `motivation`, and
//! what the hourly sweep erases after a decision in `erasure`.
//!
//! # MODES OF THE BINARY, AS THE NAMED DEACTIVATION IS
//!
//! `messagr-invitations --reports`, and the others below, run on the host with
//! `docker compose run --rm invitations …` (`deploy/messagr-eu-invitations.md`
//! writes the whole procedure). They bind no port and start no sweeper, so
//! they run beside the live service. One gesture per run:
//!
//! - `--reports`: the reports awaiting a decision, by number, instant of
//!   reception and reason, the urgent ones first, and the decided ones held
//!   for the authorities. Never the reporting account.
//! - `--reports <number>`: one report, with its reporting account, its
//!   decision and when what it keeps is erased.
//! - `--export-report <number>`: its sealed report, as the JSON the opening
//!   tool reads (`scripts/ouvrir-un-signalement.mjs`), on stdout and nothing
//!   else there: `{ "reason", "reporter", "sealed" }`, sealed in standard
//!   base64.
//! - `--decide-report <number> <unfounded|lifted|confirmed> "<motivation>"`.
//! - `--hold-report <number>` and `--release-report <number>`.
//! - `--record-termination <@account:server>`.
//!
//! The first three write nothing, and ask nothing. The last four say what
//! they will write and wait for it to be typed back: a flag is typed by
//! reflex, an identifier cannot be typed back without reading the plan, and
//! the end of stdin is a refusal, so a pasted runbook or a pipeline finds no
//! way through. A REPORT NUMBER is taken back in any spelling a report number
//! is typed in (`is_the_number`): any case, a hyphen, a space or nothing
//! between its groups, since it is read off an SMS and read out (#375). AN
//! ACCOUNT is taken back exactly, case included (`operator::typed_back`), as
//! the named deactivation takes one: a localpart is case-sensitive, and an
//! operator who typed another case did not read it off the plan.
//!
//! # A DECISION
//!
//! It finds the report unfounded, lifts the suspension, or confirms it by a
//! termination (CONTEXT.md, « Decision »): `unfounded`, `lifted`, `confirmed`.
//! It is kept with its motivation, which is the reasoned decision and never a
//! quotation (`motivation`), and with the day of the first decision, from
//! which the erasures count (`erasure`). A second decision on the same
//! report, after a contestation, replaces the first one's outcome and
//! motivation, and moves no erasure.
//!
//! # WHAT A COPY OF THE DATABASE SHOWS
//!
//! A report keeps its number, the reporting account, the reason, the sealed
//! report and the instant it came (#468), then its decision, its motivation
//! and the day it was first decided. A confirmed decision names no account:
//! the account the homeserver deactivates is recorded apart, among the
//! account deletions (`handlers::deletion::record`, #385), so that the purge
//! within thirty days applies to it, and that row names no report. Both carry
//! the day, never the hour.
//!
//! That is all this does, and what remains is said plainly (ADR 0015, amended
//! on 30 September 2026): a copy of the database can relate a confirmed
//! report to an account deletion by their dates, when deletions are few; and
//! a deletion dated at midnight UTC is a termination, where one announced from
//! the application carries its second.

mod command_line;
mod erasure;
mod motivation;

pub use command_line::the_gesture;
pub use erasure::sweep;

use command_line::{DECIDE, RECORD_TERMINATION};
use data_encoding::BASE64;
use erasure::{record_goes_on, sealed_goes_on, RECORD_KEPT_DAYS, SEALED_KEPT_DAYS};
use motivation::{the_motivation, WHAT_A_MOTIVATION_IS};
use serde::Serialize;
use sqlx::{sqlite::SqliteRow, Row, SqlitePool};

use crate::{
    handlers::deletion::PURGE_AFTER_SECONDS,
    operator::{is_a_user_id, typed_back},
    report::{Reason, ReportNumber},
    util::{date, day_of, instant, DAY_SECONDS},
};

/// What a decision concludes (CONTEXT.md, « Decision »): it finds the report
/// unfounded, lifts the suspension, or confirms it by a termination.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Decision {
    /// « Sans suite »: nothing in the report is forbidden. Nothing was taken
    /// down, or the operator restored what it could.
    Unfounded,
    /// « Levée »: the takedown stands, and the suspension is lifted.
    Lifted,
    /// « Confirmée »: the suspension is confirmed, and the operator terminates
    /// the account, which is recorded apart (`RECORD_TERMINATION`).
    Confirmed,
}

impl Decision {
    const ALL: [Decision; 3] = [Decision::Unfounded, Decision::Lifted, Decision::Confirmed];

    /// The word typed on the command line, and kept.
    pub fn code(self) -> &'static str {
        match self {
            Decision::Unfounded => "unfounded",
            Decision::Lifted => "lifted",
            Decision::Confirmed => "confirmed",
        }
    }

    fn from_code(code: &str) -> Option<Decision> {
        Decision::ALL.into_iter().find(|d| d.code() == code)
    }
}

/// One gesture of the operator, as a command line names it.
#[derive(Debug, PartialEq, Eq)]
pub enum Gesture {
    /// The reports awaiting a decision, and those held.
    List,
    /// One report, reporting account included.
    Show(ReportNumber),
    /// One sealed report, for the opening tool.
    Export(ReportNumber),
    /// A decision on one report.
    Decide {
        number: ReportNumber,
        decision: Decision,
        motivation: String,
    },
    /// One report held for the authorities.
    Hold(ReportNumber),
    /// One report's hold released.
    Release(ReportNumber),
    /// An account terminated, recorded among the account deletions.
    RecordTermination(String),
}

/// The whole gesture, with the asking injected so that a test can drive it,
/// and assert that nothing was written without it. What it returns is what
/// stdout says; a refusal is an `Err`, which leaves with a non-zero status.
pub async fn run<A>(pool: &SqlitePool, gesture: Gesture, now: i64, ask: A) -> Result<String, String>
where
    A: FnOnce(&str) -> Option<String>,
{
    match gesture {
        Gesture::List => list(pool, now).await,
        Gesture::Show(number) => show(pool, number, now).await,
        Gesture::Export(number) => export(pool, number).await,
        Gesture::Decide {
            number,
            decision,
            motivation,
        } => decide(pool, number, decision, &motivation, now, ask).await,
        Gesture::Hold(number) => hold(pool, number, now, ask).await,
        Gesture::Release(number) => release(pool, number, ask).await,
        Gesture::RecordTermination(account) => record_termination(pool, &account, now, ask).await,
    }
}

/// Whether `answer` types `number` back, in any spelling a report number is
/// typed in (`ReportNumber::parse`). The end of stdin is a refusal.
fn is_the_number(answer: Option<&str>, number: ReportNumber) -> bool {
    answer.and_then(|typed| ReportNumber::parse(typed.trim())) == Some(number)
}

/// A decision, as a report keeps it.
struct Decided {
    decision: Decision,
    motivation: String,
    /// The day of the first decision, from which the erasures count.
    on: i64,
}

/// A report as the service keeps it, its sealed report reduced to whether it
/// is still there.
struct Kept {
    number: ReportNumber,
    reporter: String,
    reason: Reason,
    sealed: bool,
    received_at: i64,
    decided: Option<Decided>,
    held_since: Option<i64>,
}

impl Kept {
    const COLUMNS: &'static str = "number, reporter_user_id, reason, \
         sealed IS NOT NULL AS sealed_kept, received_at, decision, motivation, decided_on, \
         held_since";

    fn from_row(row: &SqliteRow) -> Result<Kept, String> {
        let number: String = row.get("number");
        let number = ReportNumber::parse(&number)
            .ok_or_else(|| format!("a report number kept does not read back: {number:?}"))?;
        let reason: String = row.get("reason");
        let reason = Reason::from_code(&reason)
            .ok_or_else(|| format!("report {number}: {reason:?} is no reason of the terms"))?;
        let decided = match (
            row.get::<Option<String>, _>("decision"),
            row.get::<Option<String>, _>("motivation"),
            row.get::<Option<i64>, _>("decided_on"),
        ) {
            (Some(code), Some(motivation), Some(on)) => Some(Decided {
                decision: Decision::from_code(&code)
                    .ok_or_else(|| format!("report {number}: {code:?} is no decision"))?,
                motivation,
                on,
            }),
            _ => None,
        };
        Ok(Kept {
            number,
            reporter: row.get("reporter_user_id"),
            reason,
            sealed: row.get("sealed_kept"),
            received_at: row.get("received_at"),
            decided,
            held_since: row.get("held_since"),
        })
    }

    /// Its reason by its code and as the operator's SMS names it, and said
    /// urgent when it is.
    fn reason(&self) -> String {
        let urgent = if self.reason.is_urgent() {
            ", urgent"
        } else {
            ""
        };
        format!(
            "{} ({}){urgent}",
            self.reason.code(),
            self.reason.in_an_sms()
        )
    }
}

/// The report kept under `number`, or the refusal that says there is none.
async fn kept(pool: &SqlitePool, number: ReportNumber) -> Result<Kept, String> {
    let row = sqlx::query(&format!(
        "SELECT {} FROM reports WHERE number = ?",
        Kept::COLUMNS
    ))
    .bind(number.to_string())
    .fetch_optional(pool)
    .await
    .map_err(unreadable)?
    .ok_or_else(|| format!("no report {number}"))?;
    Kept::from_row(&row)
}

fn unreadable(e: sqlx::Error) -> String {
    format!("the database could not be read: {e}")
}

fn unwritten(number: ReportNumber) -> impl Fn(sqlx::Error) -> String {
    move |e| format!("report {number}: nothing was written: {e}")
}

/// `--reports`: what awaits a decision, the urgent first, then what is held
/// once decided. Never the reporting account: the list is what the operator
/// reads to know what to open, and nobody's account is needed for that.
async fn list(pool: &SqlitePool, now: i64) -> Result<String, String> {
    let all = sqlx::query(&format!(
        "SELECT {} FROM reports ORDER BY received_at, number",
        Kept::COLUMNS
    ))
    .fetch_all(pool)
    .await
    .map_err(unreadable)?
    .iter()
    .map(Kept::from_row)
    .collect::<Result<Vec<Kept>, String>>()?;
    let (mut awaiting, decided): (Vec<&Kept>, Vec<&Kept>) =
        all.iter().partition(|report| report.decided.is_none());
    // Stable: each group stays in the order of reception.
    awaiting.sort_by_key(|report| !report.reason.is_urgent());
    let held: Vec<&Kept> = decided
        .into_iter()
        .filter(|report| report.held_since.is_some())
        .collect();

    let mut said = match awaiting.len() {
        0 => "No report awaits a decision.\n".to_string(),
        1 => "1 report awaits a decision:\n".to_string(),
        many => format!("{many} reports await a decision, the urgent ones first:\n"),
    };
    for report in &awaiting {
        said.push_str(&format!(
            "  {}  received {}, {}  {}{}\n",
            report.number,
            instant(report.received_at),
            ago(report.received_at, now),
            report.reason(),
            held_since(report)
        ));
    }
    if !held.is_empty() {
        said.push_str(&match held.len() {
            1 => "1 decided report is held for the authorities:\n".to_string(),
            many => format!("{many} decided reports are held for the authorities:\n"),
        });
        for report in &held {
            if let Some(decided) = &report.decided {
                said.push_str(&format!(
                    "  {}  {}, decided on {}{}\n",
                    report.number,
                    decided.decision.code(),
                    date(decided.on),
                    held_since(report)
                ));
            }
        }
    }
    Ok(said)
}

/// `, held for the authorities since <date>` for a report held, nothing
/// otherwise.
fn held_since(report: &Kept) -> String {
    report
        .held_since
        .map(|since| format!(", held for the authorities since {}", date(since)))
        .unwrap_or_default()
}

/// `--reports <number>`: one report, its reporting account included, and
/// when what it keeps is erased.
async fn show(pool: &SqlitePool, number: ReportNumber, now: i64) -> Result<String, String> {
    let report = kept(pool, number).await?;
    let mut said = format!(
        "Report {}\n\
         \x20 reporting account : {}\n\
         \x20 received          : {}\n\
         \x20 reason            : {}\n",
        report.number,
        report.reporter,
        instant(report.received_at),
        report.reason()
    );
    match &report.decided {
        Some(decided) => said.push_str(&format!(
            "  decision          : {}\n\
             \x20 decided on        : {}, the first decision, from which the erasures count\n\
             \x20 motivation        : {}\n",
            decided.decision.code(),
            date(decided.on),
            decided.motivation
        )),
        None => said.push_str(&format!(
            "  decision          : awaiting, received {}\n",
            ago(report.received_at, now)
        )),
    }
    said.push_str(&format!(
        "  authorities       : {}\n",
        match report.held_since {
            Some(since) => format!("held since {}", date(since)),
            None => "not held".into(),
        }
    ));
    let (sealed, record) = match (&report.decided, report.held_since) {
        (_, Some(_)) => (
            "kept while the report is held".to_string(),
            "kept while the report is held".to_string(),
        ),
        (None, None) => (
            format!("kept until {SEALED_KEPT_DAYS} days after a decision"),
            format!("kept until {RECORD_KEPT_DAYS} days after a decision"),
        ),
        (Some(decided), None) => (
            format!(
                "kept until {}, {SEALED_KEPT_DAYS} days after the decision",
                date(sealed_goes_on(decided.on))
            ),
            format!(
                "kept until {}, {RECORD_KEPT_DAYS} days after the decision",
                date(record_goes_on(decided.on))
            ),
        ),
    };
    let sealed = if report.sealed {
        sealed
    } else {
        "erased".into()
    };
    said.push_str(&format!(
        "  sealed report     : {sealed}\n\
         \x20 record            : {record}\n"
    ));
    Ok(said)
}

/// How long ago `at` was, in whole days.
fn ago(at: i64, now: i64) -> String {
    match (now - at).div_euclid(DAY_SECONDS) {
        days if days < 1 => "less than a day ago".into(),
        1 => "1 day ago".into(),
        days => format!("{days} days ago"),
    }
}

/// What the opening tool reads (`scripts/ouvrir-un-signalement.mjs`): the
/// reason and the reporting account the seal binds, and the sealed report,
/// in this order.
#[derive(Serialize)]
struct Exported {
    reason: String,
    reporter: String,
    /// Standard base64 with its padding, as the application sent it.
    sealed: String,
}

/// `--export-report <number>`: the sealed report as the opening tool reads
/// it, and nothing else, so that stdout can go straight into the tool on the
/// operator's machine and nothing is written on either side.
async fn export(pool: &SqlitePool, number: ReportNumber) -> Result<String, String> {
    let row = sqlx::query(
        "SELECT reason, reporter_user_id, sealed, decided_on FROM reports WHERE number = ?",
    )
    .bind(number.to_string())
    .fetch_optional(pool)
    .await
    .map_err(unreadable)?
    .ok_or_else(|| format!("no report {number}"))?;
    let Some(sealed) = row.get::<Option<Vec<u8>>, _>("sealed") else {
        let on = row
            .get::<Option<i64>, _>("decided_on")
            .map(|on| format!(" on {}", date(sealed_goes_on(on))))
            .unwrap_or_default();
        return Err(format!(
            "report {number}: its sealed report was erased{on}, {SEALED_KEPT_DAYS} days after \
             its decision; its record alone is kept"
        ));
    };
    let exported = Exported {
        reason: row.get("reason"),
        reporter: row.get("reporter_user_id"),
        sealed: BASE64.encode(&sealed),
    };
    // Laid out as the committed fixture is, two spaces, one field a line.
    serde_json::to_string_pretty(&exported)
        .map(|document| document + "\n")
        .map_err(|e| format!("report {number} could not be written out: {e}"))
}

/// `--decide-report`: the decision and its motivation, once the number is
/// typed back, dated by the day of the first decision. A second decision
/// replaces the first one's outcome and motivation, and keeps its day: the
/// erasures run from the first decision, never later.
async fn decide<A>(
    pool: &SqlitePool,
    number: ReportNumber,
    decision: Decision,
    motivation: &str,
    now: i64,
    ask: A,
) -> Result<String, String>
where
    A: FnOnce(&str) -> Option<String>,
{
    let motivation = the_motivation(motivation)?;
    let report = kept(pool, number).await?;
    let on = report
        .decided
        .as_ref()
        .map_or(day_of(now), |first| first.on);
    let mut plan = format!(
        "Recording a decision on report {number}, received {}, reason: {}.\n\
         \x20 decision   : {}\n\
         \x20 motivation : {motivation}\n",
        instant(report.received_at),
        report.reason(),
        decision.code()
    );
    match &report.decided {
        None => plan.push_str(&format!(
            "  dated      : {} (the day is kept, never the hour)\n",
            date(on)
        )),
        Some(first) => plan.push_str(&format!(
            "It was first decided {} on {}: this decision replaces that outcome and its \
             motivation, and the erasures still count from {}.\n",
            first.decision.code(),
            date(first.on),
            date(first.on)
        )),
    }
    plan.push_str(&match report.held_since {
        Some(since) => format!(
            "It is held for the authorities since {}: nothing of it is erased until it is \
             released.\n",
            date(since)
        ),
        None => format!(
            "Its sealed report is erased on {}, {SEALED_KEPT_DAYS} days after the first \
             decision, and its record on {}, {RECORD_KEPT_DAYS} days after.\n",
            date(sealed_goes_on(on)),
            date(record_goes_on(on))
        ),
    });
    if decision == Decision::Confirmed {
        plan.push_str(&format!(
            "The decision names no account. Terminate the account on the homeserver once every \
             reported message is taken down (scripts/admin-messagr.sh fermer), then record it \
             among the account deletions: {RECORD_TERMINATION} <@account:server>.\n"
        ));
    }
    plan.push_str(&format!(
        "{WHAT_A_MOTIVATION_IS}\n\
         Type the report number to record this decision, or anything else to leave the report \
         as it is:"
    ));
    if !is_the_number(ask(&plan).as_deref(), number) {
        return Err(format!(
            "report {number} was not decided: nothing was written"
        ));
    }

    // THE FIRST DECISION'S DAY IS WRITTEN ONCE, in the statement itself, so
    // that no interleaving moves it.
    let written = sqlx::query(
        "UPDATE reports SET decision = ?, motivation = ?, decided_on = COALESCE(decided_on, ?) \
         WHERE number = ?",
    )
    .bind(decision.code())
    .bind(&motivation)
    .bind(on)
    .bind(number.to_string())
    .execute(pool)
    .await
    .map_err(unwritten(number))?
    .rows_affected();
    if written == 0 {
        return Err(format!(
            "report {number} is no longer kept: nothing was written"
        ));
    }
    Ok(format!(
        "Report {number}: {}, decided on {}.\n",
        decision.code(),
        date(on)
    ))
}

/// `--hold-report`: kept for the authorities, content included, whatever its
/// decision, until it is released. Holding what is held asks nothing.
async fn hold<A>(
    pool: &SqlitePool,
    number: ReportNumber,
    now: i64,
    ask: A,
) -> Result<String, String>
where
    A: FnOnce(&str) -> Option<String>,
{
    let report = kept(pool, number).await?;
    if let Some(since) = report.held_since {
        return Ok(format!(
            "Report {number} is already held for the authorities since {}: nothing was \
             written.\n",
            date(since)
        ));
    }
    let erased = if report.sealed {
        ""
    } else {
        "Its sealed report was already erased: its record alone is kept.\n"
    };
    let plan = format!(
        "Holding report {number} for the authorities. Received {}, reason: {}.\n\
         While it is held, neither its sealed report nor its record is erased, whatever its \
         decision.\n\
         {erased}\
         Type the report number to hold it, or anything else to leave it as it is:",
        instant(report.received_at),
        report.reason()
    );
    if !is_the_number(ask(&plan).as_deref(), number) {
        return Err(format!("report {number} was not held: nothing was written"));
    }
    let since = day_of(now);
    sqlx::query("UPDATE reports SET held_since = ? WHERE number = ? AND held_since IS NULL")
        .bind(since)
        .bind(number.to_string())
        .execute(pool)
        .await
        .map_err(unwritten(number))?;
    Ok(format!(
        "Report {number} is held for the authorities since {}.\n",
        date(since)
    ))
}

/// `--release-report`: the erasures resume, and the next hourly sweep erases
/// whatever is already due. Releasing what is not held asks nothing.
async fn release<A>(pool: &SqlitePool, number: ReportNumber, ask: A) -> Result<String, String>
where
    A: FnOnce(&str) -> Option<String>,
{
    let report = kept(pool, number).await?;
    let Some(since) = report.held_since else {
        return Ok(format!(
            "Report {number} is not held: nothing was written.\n"
        ));
    };
    let then = match &report.decided {
        None => "It has no decision: nothing of it is erased until it has one.".to_string(),
        Some(decided) => format!(
            "Its sealed report is erased on {}, {SEALED_KEPT_DAYS} days after its first \
             decision, and its record on {}, {RECORD_KEPT_DAYS} days after: the next hourly \
             sweep erases whatever is already due.",
            date(sealed_goes_on(decided.on)),
            date(record_goes_on(decided.on))
        ),
    };
    let plan = format!(
        "Releasing report {number}, held for the authorities since {}. {then}\n\
         Type the report number to release it, or anything else to leave it held:",
        date(since)
    );
    if !is_the_number(ask(&plan).as_deref(), number) {
        return Err(format!(
            "report {number} was not released: nothing was written"
        ));
    }
    sqlx::query("UPDATE reports SET held_since = NULL WHERE number = ?")
        .bind(number.to_string())
        .execute(pool)
        .await
        .map_err(unwritten(number))?;
    Ok(format!("Report {number} is no longer held.\n"))
}

/// `--record-termination`: an account the homeserver deactivated after a
/// confirmed decision, recorded among the account deletions
/// (`handlers::deletion::record`, #385) so that the purge within thirty days
/// applies to it, once the account is typed back, case included. Dated by the
/// day, never the hour, like a decision; the row it writes has the columns of
/// any other deletion, and names no report.
async fn record_termination<A>(
    pool: &SqlitePool,
    account: &str,
    now: i64,
    ask: A,
) -> Result<String, String>
where
    A: FnOnce(&str) -> Option<String>,
{
    if !is_a_user_id(account) {
        return Err(format!(
            "{account:?} is not a Matrix account ID, such as @localpart:messagr.eu"
        ));
    }
    let recorded: Option<i64> =
        sqlx::query_scalar("SELECT announced_at FROM account_deletions WHERE user_id = ?")
            .bind(account)
            .fetch_optional(pool)
            .await
            .map_err(unreadable)?;
    if let Some(at) = recorded {
        return Ok(format!(
            "{account} is already among the account deletions, since {}: the purge within \
             thirty days applies to it. Nothing was written.\n",
            date(at)
        ));
    }
    let on = day_of(now);
    let purge_by = date(on + PURGE_AFTER_SECONDS);
    let plan = format!(
        "Recording the termination of {account} among the account deletions, so that the \
         purge within thirty days applies to it:\n\
         \x20 - it is listed there until {purge_by}; the purge of an account's data is still \
         done by hand (#423);\n\
         \x20 - its invitations still open expire, and its number leaves discovery;\n\
         \x20 - it is dated {}, the day and never the hour, like a decision, and names no \
         report: the decision is recorded on the report with {DECIDE}.\n\
         Record it once the homeserver has deactivated the account \
         (scripts/admin-messagr.sh fermer), and not before.\n\
         Type the account to record it, or anything else to leave everything as it is:",
        date(on)
    );
    if !typed_back(ask(&plan).as_deref(), account) {
        return Err(format!("{account}: nothing was recorded"));
    }
    let recorded = crate::handlers::deletion::record(pool, account, on)
        .await
        .map_err(|e| format!("{account}: nothing was recorded: {e}"))?;
    Ok(format!(
        "{account} is among the account deletions, dated {}: to purge by {purge_by}. \
         Invitations it had still open, now expired: {}.\n",
        date(on),
        recorded.expired_invitations
    ))
}

#[cfg(test)]
mod tests {
    use super::erasure::{erase_decided_reports, erase_sealed_reports};
    use super::*;
    use crate::report::test_support::sealed_of;

    const DAY: i64 = DAY_SECONDS;
    /// 2026-09-21 14:13:20 UTC.
    const RECEIVED: i64 = 1_790_000_000;
    /// 2026-10-01 14:03:20 UTC, when the decisions of these tests are typed.
    const DECIDED: i64 = 1_790_863_400;
    /// 2026-10-01 00:00 UTC: the day they keep.
    const DECIDED_ON: i64 = 1_790_812_800;
    const MOTIVATION: &str = "Le signalement montre des menaces répétées contre la personne \
         qui signale, ce que les conditions interdisent : suspension confirmée.";

    fn number(typed: &str) -> ReportNumber {
        ReportNumber::parse(typed).unwrap()
    }

    /// A report as `handlers::reports` keeps it, one block sealed.
    async fn a_report(pool: &SqlitePool, number: &str, reporter: &str, reason: &str, at: i64) {
        sqlx::query(
            "INSERT INTO reports \
             (number, reporter_user_id, reason, sealed, received_at, idempotency_key) \
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(number)
        .bind(reporter)
        .bind(reason)
        .bind(sealed_of(1, 7))
        .bind(at)
        .bind(format!("key-of-{number}"))
        .execute(pool)
        .await
        .unwrap();
    }

    /// What `gesture` says, when it asks nothing.
    async fn said(pool: &SqlitePool, gesture: Gesture, now: i64) -> Result<String, String> {
        run(pool, gesture, now, |plan| panic!("asked: {plan}")).await
    }

    /// `gesture` run at `now`, answered `answer`; the plan it said, and what
    /// it returned.
    async fn answered(
        pool: &SqlitePool,
        gesture: Gesture,
        now: i64,
        answer: Option<&str>,
    ) -> (String, Result<String, String>) {
        let plan = std::cell::RefCell::new(String::new());
        let done = run(pool, gesture, now, |said| {
            *plan.borrow_mut() = said.to_string();
            answer.map(Into::into)
        })
        .await;
        (plan.into_inner(), done)
    }

    fn decide(number_typed: &str, decision: Decision, motivation: &str) -> Gesture {
        Gesture::Decide {
            number: number(number_typed),
            decision,
            motivation: motivation.into(),
        }
    }

    /// The decision kept on `number`: what, why and from which day.
    async fn decision_on(
        pool: &SqlitePool,
        number: &str,
    ) -> (Option<String>, Option<String>, Option<i64>) {
        sqlx::query_as("SELECT decision, motivation, decided_on FROM reports WHERE number = ?")
            .bind(number)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    /// `number` received, then decided at `DECIDED`.
    async fn a_decided_report(pool: &SqlitePool, number_typed: &str, decision: Decision) {
        a_report(pool, number_typed, "@alice:h", "harassment", RECEIVED).await;
        answered(
            pool,
            decide(number_typed, decision, MOTIVATION),
            DECIDED,
            Some(number_typed),
        )
        .await
        .1
        .unwrap();
    }

    // ── Migration 022 ────────────────────────────────────────────────────

    /// THE TABLE IS REBUILT, AND WHAT IT HELD IS NOT LOST: the reports a
    /// service before #473 received are kept as they came, awaiting a
    /// decision. An idempotency key still names one report of an account,
    /// two erased keys of the same account no longer collide, and a decision
    /// is one of the three.
    #[sqlx::test(migrations = false)]
    async fn migration_022_keeps_every_report_already_received_awaiting(pool: SqlitePool) {
        let mut before = sqlx::migrate!("./migrations");
        before.migrations = before
            .migrations
            .iter()
            .filter(|m| m.version < 22)
            .cloned()
            .collect::<Vec<_>>()
            .into();
        before.run(&pool).await.unwrap();
        a_report(&pool, "K7QM-4ZT2", "@alice:h", "threat", RECEIVED).await;
        a_report(&pool, "ABCD-EFGH", "@alice:h", "hate", RECEIVED + 60).await;

        sqlx::migrate!("./migrations").run(&pool).await.unwrap();

        type Row = (String, String, String, Vec<u8>, i64, String, Option<String>);
        let kept: Vec<Row> = sqlx::query_as(
            "SELECT number, reporter_user_id, reason, sealed, received_at, idempotency_key, \
             decision FROM reports ORDER BY received_at",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(
            kept,
            [
                (
                    "K7QM-4ZT2".to_string(),
                    "@alice:h".to_string(),
                    "threat".to_string(),
                    sealed_of(1, 7),
                    RECEIVED,
                    "key-of-K7QM-4ZT2".to_string(),
                    None
                ),
                (
                    "ABCD-EFGH".to_string(),
                    "@alice:h".to_string(),
                    "hate".to_string(),
                    sealed_of(1, 7),
                    RECEIVED + 60,
                    "key-of-ABCD-EFGH".to_string(),
                    None
                ),
            ]
        );
        let again = sqlx::query(
            "INSERT INTO reports \
             (number, reporter_user_id, reason, sealed, received_at, idempotency_key) \
             VALUES ('2345-6789', '@alice:h', 'hate', X'01', 0, 'key-of-K7QM-4ZT2')",
        )
        .execute(&pool)
        .await;
        assert!(again.is_err(), "a key still names one report of an account");
        sqlx::query("UPDATE reports SET sealed = NULL, idempotency_key = NULL")
            .execute(&pool)
            .await
            .expect("two erased keys of one account");
        for (code, taken) in [
            ("unfounded", true),
            ("lifted", true),
            ("confirmed", true),
            ("maintained", false),
            ("termination", false),
        ] {
            let decided = sqlx::query(
                "UPDATE reports SET decision = ?, motivation = 'm', decided_on = 0 \
                 WHERE number = 'K7QM-4ZT2'",
            )
            .bind(code)
            .execute(&pool)
            .await;
            assert_eq!(decided.is_ok(), taken, "{code}");
        }
    }

    // ── The list ─────────────────────────────────────────────────────────

    #[sqlx::test(migrations = "./migrations")]
    async fn the_list_shows_each_report_awaiting_by_number_reception_and_reason_the_urgent_first(
        pool: SqlitePool,
    ) {
        a_report(&pool, "ABCD-EFGH", "@alice:h", "harassment", RECEIVED).await;
        a_report(&pool, "K7QM-4ZT2", "@bob:h", "threat", RECEIVED + 3_600).await;

        let listed = said(&pool, Gesture::List, RECEIVED + 3 * DAY)
            .await
            .unwrap();

        let lines: Vec<&str> = listed.lines().collect();
        assert_eq!(
            lines[0],
            "2 reports await a decision, the urgent ones first:"
        );
        assert!(lines[1].starts_with("  K7QM-4ZT2"), "{listed}");
        assert!(
            lines[1].contains("received 2026-09-21 15:13 UTC"),
            "{listed}"
        );
        assert!(lines[1].contains("threat (menace), urgent"), "{listed}");
        assert!(lines[2].starts_with("  ABCD-EFGH"), "{listed}");
        assert!(
            lines[2].contains("received 2026-09-21 14:13 UTC, 3 days ago"),
            "{listed}"
        );
        assert!(lines[2].contains("harassment (harcèlement)"), "{listed}");
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn the_list_never_shows_the_reporting_account(pool: SqlitePool) {
        a_report(&pool, "ABCD-EFGH", "@alice:h", "harassment", RECEIVED).await;
        a_report(&pool, "K7QM-4ZT2", "@bob:h", "threat", RECEIVED).await;

        let listed = said(&pool, Gesture::List, RECEIVED + DAY).await.unwrap();

        for account in ["alice", "bob", "@"] {
            assert!(!listed.contains(account), "{account}: {listed}");
        }
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn with_nothing_awaiting_the_list_says_so(pool: SqlitePool) {
        assert_eq!(
            said(&pool, Gesture::List, RECEIVED).await.unwrap(),
            "No report awaits a decision.\n"
        );
    }

    // ── One report ───────────────────────────────────────────────────────

    #[sqlx::test(migrations = "./migrations")]
    async fn one_report_shows_its_reporting_account_and_that_it_awaits(pool: SqlitePool) {
        a_report(&pool, "K7QM-4ZT2", "@alice:h", "hate", RECEIVED).await;

        let shown = said(&pool, Gesture::Show(number("k7qm4zt2")), RECEIVED + DAY)
            .await
            .unwrap();

        assert!(shown.starts_with("Report K7QM-4ZT2\n"), "{shown}");
        assert!(shown.contains("reporting account : @alice:h\n"), "{shown}");
        assert!(
            shown.contains("received          : 2026-09-21 14:13 UTC\n"),
            "{shown}"
        );
        assert!(
            shown.contains("reason            : hate (contenu haineux)\n"),
            "{shown}"
        );
        assert!(
            shown.contains("decision          : awaiting, received 1 day ago\n"),
            "{shown}"
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_report_nobody_sent_is_refused(pool: SqlitePool) {
        let refused = said(&pool, Gesture::Show(number("K7QM-4ZT2")), RECEIVED).await;
        assert_eq!(refused, Err("no report K7QM-4ZT2".into()));
    }

    // ── The export ───────────────────────────────────────────────────────

    /// The test report of `scripts/fixtures`, sealed for the test key: its
    /// reason, its reporting account, and its sealed report in standard base64.
    fn the_test_report() -> (String, String, String) {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../../scripts/fixtures/signalement-de-test.json"
        ))
        .unwrap();
        let field = |name: &str| fixture[name].as_str().unwrap().to_string();
        (field("reason"), field("reporter"), field("sealed"))
    }

    /// The test report, kept by the service as `handlers::reports` keeps
    /// what an application sends.
    async fn the_test_report_kept(pool: &SqlitePool, number: &str) {
        let (reason, reporter, sealed) = the_test_report();
        let sealed = crate::report::SealedReport::from_base64(&sealed).expect("format 1");
        sqlx::query(
            "INSERT INTO reports \
             (number, reporter_user_id, reason, sealed, received_at, idempotency_key) \
             VALUES (?, ?, ?, ?, ?, 'key-of-the-test-report')",
        )
        .bind(number)
        .bind(reporter)
        .bind(reason)
        .bind(sealed.bytes())
        .bind(RECEIVED)
        .execute(pool)
        .await
        .unwrap();
    }

    /// THE EXPORT OPENS WITH THE TOOL. `signalement-exporte-de-test.json` is
    /// what this gesture prints, byte for byte, for the test report; the
    /// opening tool's own suite opens that file with the test key
    /// (`packages/app/src/runtime/exportedReport.spec.ts`). Either side
    /// changing its shape turns one of the two red.
    #[sqlx::test(migrations = "./migrations")]
    async fn the_export_is_the_document_the_opening_tool_opens_byte_for_byte(pool: SqlitePool) {
        the_test_report_kept(&pool, "K7QM-4ZT2").await;

        let exported = said(&pool, Gesture::Export(number("K7QM-4ZT2")), RECEIVED)
            .await
            .unwrap();

        assert_eq!(
            exported,
            include_str!("../../../../scripts/fixtures/signalement-exporte-de-test.json")
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn the_export_carries_the_reason_the_reporting_account_and_the_sealed_report_and_nothing_else(
        pool: SqlitePool,
    ) {
        the_test_report_kept(&pool, "K7QM-4ZT2").await;
        let (reason, reporter, sealed) = the_test_report();

        let exported = said(&pool, Gesture::Export(number("K7QM-4ZT2")), RECEIVED)
            .await
            .unwrap();

        let document: serde_json::Value = serde_json::from_str(&exported).unwrap();
        assert_eq!(
            document,
            serde_json::json!({"reason": reason, "reporter": reporter, "sealed": sealed})
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn an_erased_sealed_report_is_not_exported(pool: SqlitePool) {
        a_report(&pool, "K7QM-4ZT2", "@alice:h", "hate", RECEIVED).await;
        sqlx::query("UPDATE reports SET sealed = NULL")
            .execute(&pool)
            .await
            .unwrap();

        let refused = said(&pool, Gesture::Export(number("K7QM-4ZT2")), RECEIVED).await;

        assert!(
            refused.as_ref().is_err_and(|why| why.contains("erased")),
            "{refused:?}"
        );
        assert_eq!(
            said(&pool, Gesture::Export(number("ABCD-EFGH")), RECEIVED).await,
            Err("no report ABCD-EFGH".into())
        );
    }

    // ── A decision ───────────────────────────────────────────────────────

    #[sqlx::test(migrations = "./migrations")]
    async fn a_decision_is_kept_with_its_motivation_and_its_day_once_the_number_is_typed_back(
        pool: SqlitePool,
    ) {
        a_report(&pool, "K7QM-4ZT2", "@alice:h", "threat", RECEIVED).await;

        let (plan, done) = answered(
            &pool,
            decide("K7QM-4ZT2", Decision::Confirmed, MOTIVATION),
            DECIDED,
            Some("K7QM-4ZT2\n"),
        )
        .await;

        assert!(done.is_ok(), "{done:?}");
        assert_eq!(
            decision_on(&pool, "K7QM-4ZT2").await,
            (
                Some("confirmed".into()),
                Some(MOTIVATION.into()),
                Some(DECIDED_ON)
            ),
            "the day of the decision, never its hour"
        );
        // The plan says what is kept, and when it goes: 181 and 365 days
        // after 2026-10-01.
        for said in [
            "confirmed",
            MOTIVATION,
            "2026-10-01",
            "2027-03-31",
            "2027-10-01",
            "never a quotation",
        ] {
            assert!(plan.contains(said), "{said}: {plan}");
        }
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn the_number_is_typed_back_in_any_case_with_or_without_its_hyphen(pool: SqlitePool) {
        a_report(&pool, "K7QM-4ZT2", "@alice:h", "threat", RECEIVED).await;

        let (_, done) = answered(
            &pool,
            decide("K7QM-4ZT2", Decision::Lifted, MOTIVATION),
            DECIDED,
            Some(" k7qm 4zt2 \n"),
        )
        .await;

        assert!(done.is_ok(), "{done:?}");
        assert_eq!(
            decision_on(&pool, "K7QM-4ZT2").await.0.as_deref(),
            Some("lifted")
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn nothing_is_decided_without_the_number_typed_back(pool: SqlitePool) {
        a_report(&pool, "K7QM-4ZT2", "@alice:h", "threat", RECEIVED).await;

        for answer in [
            None,
            Some(""),
            Some("yes"),
            Some("ABCD-EFGH"),
            Some("K7QM-4ZT"),
        ] {
            let (_, done) = answered(
                &pool,
                decide("K7QM-4ZT2", Decision::Unfounded, MOTIVATION),
                DECIDED,
                answer,
            )
            .await;
            assert!(done.is_err(), "{answer:?}");
        }

        assert_eq!(decision_on(&pool, "K7QM-4ZT2").await, (None, None, None));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_decision_on_a_report_nobody_sent_is_refused_before_anything_is_asked(
        pool: SqlitePool,
    ) {
        let refused = said(
            &pool,
            decide("K7QM-4ZT2", Decision::Unfounded, MOTIVATION),
            DECIDED,
        )
        .await;
        assert_eq!(refused, Err("no report K7QM-4ZT2".into()));
    }

    /// A contestation may change the outcome, never the time the report is
    /// kept: the erasures run from the first decision.
    #[sqlx::test(migrations = "./migrations")]
    async fn a_second_decision_replaces_the_first_and_moves_no_erasure(pool: SqlitePool) {
        a_decided_report(&pool, "K7QM-4ZT2", Decision::Lifted).await;

        let cleared = "La contestation montre que les messages signalés répondaient à une \
             menace reçue : sans suite, et la suspension est levée.";
        let (plan, done) = answered(
            &pool,
            decide("K7QM-4ZT2", Decision::Unfounded, cleared),
            DECIDED + 10 * DAY,
            Some("K7QM-4ZT2"),
        )
        .await;

        assert!(done.is_ok(), "{done:?}");
        assert!(
            plan.contains("It was first decided lifted on 2026-10-01"),
            "the plan says what it replaces: {plan}"
        );
        assert!(
            plan.contains("the erasures still count from 2026-10-01"),
            "{plan}"
        );
        assert_eq!(
            decision_on(&pool, "K7QM-4ZT2").await,
            (
                Some("unfounded".into()),
                Some(cleared.into()),
                Some(DECIDED_ON)
            ),
            "the outcome and the motivation change; the day does not"
        );
        // 181 days after the FIRST decision, not the second.
        let sealed_due = DECIDED_ON + 181 * DAY;
        assert_eq!(
            erase_sealed_reports(&pool, sealed_due - 1).await.unwrap(),
            0
        );
        assert_eq!(erase_sealed_reports(&pool, sealed_due).await.unwrap(), 1);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_confirmed_decision_names_no_account_and_says_how_the_account_is_recorded(
        pool: SqlitePool,
    ) {
        a_report(&pool, "K7QM-4ZT2", "@alice:h", "threat", RECEIVED).await;

        let (plan, done) = answered(
            &pool,
            decide("K7QM-4ZT2", Decision::Confirmed, MOTIVATION),
            DECIDED,
            Some("K7QM-4ZT2"),
        )
        .await;

        assert!(done.is_ok(), "{done:?}");
        assert!(plan.contains(RECORD_TERMINATION), "{plan}");
        assert!(plan.contains("The decision names no account"), "{plan}");
        assert!(plan.contains("scripts/admin-messagr.sh fermer"), "{plan}");
        assert_eq!(
            decision_on(&pool, "K7QM-4ZT2").await.0.as_deref(),
            Some("confirmed")
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_decision_whose_motivation_names_an_account_is_refused_before_anything_is_asked(
        pool: SqlitePool,
    ) {
        a_report(&pool, "K7QM-4ZT2", "@alice:h", "threat", RECEIVED).await;

        let refused = said(
            &pool,
            decide(
                "K7QM-4ZT2",
                Decision::Confirmed,
                "Menaces répétées de @bob:messagr.eu : suspension confirmée.",
            ),
            DECIDED,
        )
        .await;

        assert!(refused.is_err());
        assert_eq!(decision_on(&pool, "K7QM-4ZT2").await, (None, None, None));
    }

    // ── Held for the authorities ─────────────────────────────────────────

    async fn held_since_of(pool: &SqlitePool, number: &str) -> Option<i64> {
        sqlx::query_scalar("SELECT held_since FROM reports WHERE number = ?")
            .bind(number)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_report_is_held_and_released_once_its_number_is_typed_back(pool: SqlitePool) {
        a_report(
            &pool,
            "K7QM-4ZT2",
            "@alice:h",
            "child_sexual_abuse",
            RECEIVED,
        )
        .await;

        let (plan, held) = answered(
            &pool,
            Gesture::Hold(number("K7QM-4ZT2")),
            DECIDED,
            Some("K7QM-4ZT2"),
        )
        .await;
        assert!(held.is_ok(), "{held:?}");
        assert!(
            plan.contains("neither its sealed report nor its record"),
            "{plan}"
        );
        assert_eq!(held_since_of(&pool, "K7QM-4ZT2").await, Some(DECIDED_ON));
        let listed = said(&pool, Gesture::List, DECIDED).await.unwrap();
        assert!(
            listed.contains("held for the authorities since 2026-10-01"),
            "{listed}"
        );

        let (_, released) = answered(
            &pool,
            Gesture::Release(number("K7QM-4ZT2")),
            DECIDED + DAY,
            Some("K7QM-4ZT2"),
        )
        .await;
        assert!(released.is_ok(), "{released:?}");
        assert_eq!(held_since_of(&pool, "K7QM-4ZT2").await, None);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn nothing_is_held_or_released_without_the_number_typed_back(pool: SqlitePool) {
        a_report(&pool, "K7QM-4ZT2", "@alice:h", "threat", RECEIVED).await;
        a_report(&pool, "ABCD-EFGH", "@alice:h", "threat", RECEIVED).await;
        answered(
            &pool,
            Gesture::Hold(number("ABCD-EFGH")),
            DECIDED,
            Some("ABCD-EFGH"),
        )
        .await
        .1
        .unwrap();

        for answer in [None, Some(""), Some("yes"), Some("ABCD-EFGH")] {
            let (_, held) =
                answered(&pool, Gesture::Hold(number("K7QM-4ZT2")), DECIDED, answer).await;
            assert!(held.is_err(), "{answer:?}");
        }
        for answer in [None, Some(""), Some("yes"), Some("K7QM-4ZT2")] {
            let (_, released) = answered(
                &pool,
                Gesture::Release(number("ABCD-EFGH")),
                DECIDED,
                answer,
            )
            .await;
            assert!(released.is_err(), "{answer:?}");
        }

        assert_eq!(held_since_of(&pool, "K7QM-4ZT2").await, None);
        assert_eq!(held_since_of(&pool, "ABCD-EFGH").await, Some(DECIDED_ON));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn holding_what_is_held_or_releasing_what_is_not_asks_nothing(pool: SqlitePool) {
        a_report(&pool, "K7QM-4ZT2", "@alice:h", "threat", RECEIVED).await;
        assert!(said(&pool, Gesture::Release(number("K7QM-4ZT2")), DECIDED)
            .await
            .unwrap()
            .contains("not held"));
        answered(
            &pool,
            Gesture::Hold(number("K7QM-4ZT2")),
            DECIDED,
            Some("K7QM-4ZT2"),
        )
        .await
        .1
        .unwrap();

        let again = said(&pool, Gesture::Hold(number("K7QM-4ZT2")), DECIDED + DAY)
            .await
            .unwrap();

        assert!(
            again.contains("already held for the authorities since 2026-10-01"),
            "{again}"
        );
        assert_eq!(held_since_of(&pool, "K7QM-4ZT2").await, Some(DECIDED_ON));
    }

    // ── What is erased, and when ─────────────────────────────────────────

    /// What is left of `number`: its sealed report, its idempotency key, and
    /// whether its record is there at all.
    async fn left_of(pool: &SqlitePool, number: &str) -> Option<(Option<Vec<u8>>, Option<String>)> {
        sqlx::query_as("SELECT sealed, idempotency_key FROM reports WHERE number = ?")
            .bind(number)
            .fetch_optional(pool)
            .await
            .unwrap()
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn the_sealed_report_and_its_key_go_181_days_after_the_decision_and_not_a_second_before(
        pool: SqlitePool,
    ) {
        a_decided_report(&pool, "K7QM-4ZT2", Decision::Lifted).await;
        // 2027-03-31 00:00 UTC.
        let due = 1_806_451_200;
        assert_eq!(due, DECIDED_ON + 181 * DAY);

        assert_eq!(erase_sealed_reports(&pool, due - 1).await.unwrap(), 0);
        assert_eq!(
            left_of(&pool, "K7QM-4ZT2").await,
            Some((Some(sealed_of(1, 7)), Some("key-of-K7QM-4ZT2".into())))
        );

        assert_eq!(erase_sealed_reports(&pool, due).await.unwrap(), 1);
        assert_eq!(left_of(&pool, "K7QM-4ZT2").await, Some((None, None)));
        // What was decided stays, and whom it came from.
        assert_eq!(
            decision_on(&pool, "K7QM-4ZT2").await.0.as_deref(),
            Some("lifted")
        );
        let shown = said(&pool, Gesture::Show(number("K7QM-4ZT2")), due)
            .await
            .unwrap();
        assert!(shown.contains("sealed report     : erased\n"), "{shown}");
        assert!(shown.contains("reporting account : @alice:h\n"), "{shown}");
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn the_record_goes_365_days_after_the_decision_and_not_a_second_before(pool: SqlitePool) {
        a_decided_report(&pool, "K7QM-4ZT2", Decision::Confirmed).await;
        // 2027-10-01 00:00 UTC.
        let due = 1_822_348_800;
        assert_eq!(due, DECIDED_ON + 365 * DAY);
        erase_sealed_reports(&pool, due - 1).await.unwrap();

        assert_eq!(erase_decided_reports(&pool, due - 1).await.unwrap(), 0);
        assert_eq!(left_of(&pool, "K7QM-4ZT2").await, Some((None, None)));

        assert_eq!(erase_decided_reports(&pool, due).await.unwrap(), 1);
        assert_eq!(left_of(&pool, "K7QM-4ZT2").await, None);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_report_held_for_the_authorities_is_erased_by_neither_rule_until_it_is_released(
        pool: SqlitePool,
    ) {
        a_decided_report(&pool, "K7QM-4ZT2", Decision::Confirmed).await;
        answered(
            &pool,
            Gesture::Hold(number("K7QM-4ZT2")),
            DECIDED,
            Some("K7QM-4ZT2"),
        )
        .await
        .1
        .unwrap();
        let years_later = DECIDED_ON + 3 * 365 * DAY;

        assert_eq!(erase_sealed_reports(&pool, years_later).await.unwrap(), 0);
        assert_eq!(erase_decided_reports(&pool, years_later).await.unwrap(), 0);
        assert_eq!(
            left_of(&pool, "K7QM-4ZT2").await,
            Some((Some(sealed_of(1, 7)), Some("key-of-K7QM-4ZT2".into()))),
            "kept, content included, while the authorities need it"
        );

        answered(
            &pool,
            Gesture::Release(number("K7QM-4ZT2")),
            years_later,
            Some("K7QM-4ZT2"),
        )
        .await
        .1
        .unwrap();
        assert_eq!(erase_sealed_reports(&pool, years_later).await.unwrap(), 1);
        assert_eq!(erase_decided_reports(&pool, years_later).await.unwrap(), 1);
        assert_eq!(left_of(&pool, "K7QM-4ZT2").await, None);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_report_with_no_decision_is_erased_by_neither_rule_and_stays_listed(
        pool: SqlitePool,
    ) {
        a_report(&pool, "K7QM-4ZT2", "@alice:h", "harassment", RECEIVED).await;
        let years_later = RECEIVED + 3 * 365 * DAY;

        assert_eq!(erase_sealed_reports(&pool, years_later).await.unwrap(), 0);
        assert_eq!(erase_decided_reports(&pool, years_later).await.unwrap(), 0);
        assert_eq!(
            left_of(&pool, "K7QM-4ZT2").await,
            Some((Some(sealed_of(1, 7)), Some("key-of-K7QM-4ZT2".into())))
        );
        let listed = said(&pool, Gesture::List, years_later).await.unwrap();
        assert!(
            listed.starts_with("1 report awaits a decision:\n"),
            "{listed}"
        );
        assert!(listed.contains("K7QM-4ZT2"), "{listed}");
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn the_hourly_sweep_erases_the_sealed_report_then_the_record(pool: SqlitePool) {
        a_decided_report(&pool, "K7QM-4ZT2", Decision::Unfounded).await;
        let st = std::sync::Arc::new(crate::AppState {
            pool: pool.clone(),
            mx: std::sync::Arc::new(crate::matrix::MatrixClient::new(
                "http://127.0.0.1:1".into(),
                "token".into(),
            )),
            cfg: crate::config::Config::for_tests(),
        });

        assert!(crate::cleanup::sweep_once(&st, DECIDED_ON + 181 * DAY).await);
        assert_eq!(left_of(&pool, "K7QM-4ZT2").await, Some((None, None)));
        assert!(crate::cleanup::sweep_once(&st, DECIDED_ON + 365 * DAY).await);
        assert_eq!(left_of(&pool, "K7QM-4ZT2").await, None);
    }

    // ── A termination, recorded among the account deletions ──────────────

    /// Every account deletion kept: account, date, end of its purge.
    async fn deletions(pool: &SqlitePool) -> Vec<(String, i64, i64)> {
        sqlx::query_as(
            "SELECT user_id, announced_at, purge_after FROM account_deletions ORDER BY user_id",
        )
        .fetch_all(pool)
        .await
        .unwrap()
    }

    fn termination(account: &str) -> Gesture {
        Gesture::RecordTermination(account.into())
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_termination_is_among_the_account_deletions_by_the_day_once_the_account_is_typed_back(
        pool: SqlitePool,
    ) {
        let (plan, done) = answered(&pool, termination("@bob:h"), DECIDED, Some("@bob:h\n")).await;

        assert!(done.is_ok(), "{done:?}");
        // The row an announcement from the application writes, dated by the
        // day, and the purge within thirty days (`handlers::deletion`).
        assert_eq!(
            deletions(&pool).await,
            [("@bob:h".to_string(), DECIDED_ON, DECIDED_ON + 30 * DAY)]
        );
        for said in ["thirty days", "#423", "names no report", "2026-10-01"] {
            assert!(plan.contains(said), "{said}: {plan}");
        }
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn nothing_is_recorded_without_the_account_typed_back(pool: SqlitePool) {
        for answer in [
            None,
            Some(""),
            Some("yes"),
            Some("@Bob:h"),
            Some("@carol:h"),
        ] {
            let (_, done) = answered(&pool, termination("@bob:h"), DECIDED, answer).await;
            assert!(done.is_err(), "{answer:?}");
        }
        assert_eq!(deletions(&pool).await, []);
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_termination_ends_the_account_s_open_invitations_by_the_day(pool: SqlitePool) {
        sqlx::query(
            "INSERT INTO invitations (id, inviter_user_id, token_sha256, created_at, \
             expires_at, max_uses, used_count, status) \
             VALUES ('open', '@bob:h', X'01', 0, 4000000000, 1, 0, 'pending')",
        )
        .execute(&pool)
        .await
        .unwrap();

        answered(&pool, termination("@bob:h"), DECIDED, Some("@bob:h"))
            .await
            .1
            .unwrap();

        let (status, expires_at): (String, i64) =
            sqlx::query_as("SELECT status, expires_at FROM invitations WHERE id = 'open'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            (status.as_str(), expires_at),
            ("expired", DECIDED_ON),
            "expired as a deletion expires it, dated by the day"
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn an_account_already_recorded_is_not_asked_again(pool: SqlitePool) {
        answered(&pool, termination("@bob:h"), DECIDED, Some("@bob:h"))
            .await
            .1
            .unwrap();

        let again = said(&pool, termination("@bob:h"), DECIDED + DAY)
            .await
            .unwrap();

        assert!(again.contains("already"), "{again}");
        assert_eq!(
            deletions(&pool).await,
            [("@bob:h".to_string(), DECIDED_ON, DECIDED_ON + 30 * DAY)]
        );
    }

    /// EVERY VALUE OF EVERY ROW OF EVERY TABLE, as text: what a copy of the
    /// database shows.
    async fn every_row(pool: &SqlitePool) -> Vec<(String, String)> {
        let tables: Vec<String> = sqlx::query_scalar(
            "SELECT name FROM sqlite_master WHERE type = 'table' \
             AND name NOT LIKE 'sqlite_%' AND name <> '_sqlx_migrations'",
        )
        .fetch_all(pool)
        .await
        .unwrap();
        let mut rows = Vec::new();
        for table in tables {
            let columns: Vec<String> =
                sqlx::query_scalar(&format!("SELECT name FROM pragma_table_info('{table}')"))
                    .fetch_all(pool)
                    .await
                    .unwrap();
            let values = columns
                .iter()
                .map(|c| format!("COALESCE(CAST(\"{c}\" AS TEXT), '')"))
                .collect::<Vec<_>>()
                .join(" || ' ' || ");
            let texts: Vec<String> =
                sqlx::query_scalar(&format!("SELECT {values} FROM \"{table}\""))
                    .fetch_all(pool)
                    .await
                    .unwrap();
            rows.extend(texts.into_iter().map(|text| (table.clone(), text)));
        }
        rows
    }

    /// WHAT THIS HOLDS, AND NO MORE. A report confirmed and its account
    /// recorded in the same second: no row of any table holds both, the
    /// decision names no account but the reporting one, the deletion has the
    /// columns of any other, and both carry the day, not the second. It does
    /// not show that nothing relates them: a copy of the database can relate
    /// them by their dates when deletions are few, and a deletion dated at
    /// midnight is a termination (ADR 0015, amended on 30 September 2026).
    #[sqlx::test(migrations = "./migrations")]
    async fn no_row_holds_both_a_confirmed_report_and_the_account_it_terminated(pool: SqlitePool) {
        a_report(&pool, "K7QM-4ZT2", "@alice:h", "threat", RECEIVED).await;
        answered(
            &pool,
            decide("K7QM-4ZT2", Decision::Confirmed, MOTIVATION),
            DECIDED,
            Some("K7QM-4ZT2"),
        )
        .await
        .1
        .unwrap();
        answered(&pool, termination("@bob:h"), DECIDED, Some("@bob:h"))
            .await
            .1
            .unwrap();

        let rows = every_row(&pool).await;
        assert!(
            rows.iter()
                .any(|(table, row)| table == "account_deletions" && row.contains("@bob:h")),
            "the termination is among the deletions: {rows:?}"
        );
        for (table, row) in &rows {
            assert!(
                !(row.contains("K7QM-4ZT2") && row.contains("bob")),
                "{table} holds both: {row}"
            );
            if row.contains("bob") {
                assert_eq!(table, "account_deletions", "{row}");
            }
        }
        let columns: Vec<String> =
            sqlx::query_scalar("SELECT name FROM pragma_table_info('account_deletions')")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(columns, ["user_id", "announced_at", "purge_after"]);
        // Both by the day: the same day, which is the trace that remains.
        assert_eq!(decision_on(&pool, "K7QM-4ZT2").await.2, Some(DECIDED_ON));
        assert_eq!(deletions(&pool).await[0].1, DECIDED_ON);
    }
}
