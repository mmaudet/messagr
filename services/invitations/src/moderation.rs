//! What the operator does with a report, typed on the host (#473, #462,
//! ADR 0015): list the reports that await a decision, export one sealed
//! report for the opening tool, record a decision, hold a report for the
//! authorities and release it, and record a termination as an account
//! deletion. Then what the hourly sweep erases after a decision.
//!
//! # MODES OF THE BINARY, AS THE NAMED DEACTIVATION IS
//!
//! `messagr-invitations --reports`, and the others below, run on the host with
//! `docker compose run --rm invitations …` (`deploy/messagr-eu-invitations.md`,
//! which writes the whole procedure). They bind no port and start no sweeper,
//! so they run beside the live service. One gesture per run.
//!
//! - `--reports`: the reports awaiting a decision, by number, instant of
//!   reception and reason, the urgent ones first, and those held for the
//!   authorities. Never the reporting account.
//! - `--reports <number>`: one report, with its reporting account, its
//!   decision and when what it keeps is erased.
//! - `--export-report <number>`: its sealed report, as the JSON the opening
//!   tool reads (`scripts/ouvrir-un-signalement.mjs`), on stdout and nothing
//!   else there: `{ "reason", "reporter", "sealed" }`, sealed in standard
//!   base64.
//! - `--decide-report <number> <maintained|lifted|termination> "<motivation>"`.
//! - `--hold-report <number>` and `--release-report <number>`.
//! - `--record-termination <@account:server>`.
//!
//! The first three write nothing, and ask nothing. The last four say what
//! they will write and wait for the report number, or the account, typed
//! back: a flag is typed by reflex, an identifier cannot be typed back
//! without reading the plan, and the end of stdin is a refusal, so a pasted
//! runbook or a pipeline finds no way through (`operator::typed_back`).
//!
//! # WHAT THE SERVICE LEARNS, AND WHAT IT NEVER DOES
//!
//! A decision is kept with its motivation and its date. The motivation is the
//! reasoned decision, never a quotation: it names no account and copies
//! nothing that was said, and a motivation holding a Matrix identifier is
//! refused (`the_motivation`). What was decided is kept, never what was said.
//!
//! A TERMINATION IS TWO GESTURES THAT NOTHING RELATES. Its decision is
//! recorded on the report, by its number, and names no account. The account
//! is recorded apart, by its identifier, as an account deletion
//! (`handlers::deletion`, #385), so that the purge within thirty days applies
//! to it as to a deletion its holder made: the row is the same row, and names
//! no report. The date of a decision is a day, never an hour, so that not
//! even the second at which both were typed relates them. The service thus
//! learns neither who is reported nor what: a copy of its database shows
//! nothing that was reported.
//!
//! # WHAT IS ERASED, AND WHEN
//!
//! The sealed report and its idempotency key, 181 days after the decision,
//! which never exceeds six calendar months; the whole record, 365 days after
//! it, which never exceeds twelve. Neither while the report is held for the
//! authorities, and neither for a report with no decision: the terms promise
//! a decision within thirty days, and the list shows it as awaiting until
//! there is one. The hourly sweep applies both (`sweep`, from
//! `cleanup::sweep_once`).

use data_encoding::BASE64;
use serde::Serialize;
use sqlx::{Row, SqlitePool};

use crate::{
    named_deactivation::is_a_user_id,
    report::{Reason, ReportNumber},
    util::DAY_SECONDS,
};

/// How long the sealed report and its idempotency key outlive the decision:
/// 181 days, which never exceed six calendar months.
pub const SEALED_KEPT_DAYS: i64 = 181;
/// How long the record outlives the decision: 365 days, which never exceed
/// twelve calendar months.
pub const RECORD_KEPT_DAYS: i64 = 365;

/// The flags of the gestures, each selecting one. Anything starting with one
/// selects it too, for the reason `operator::named_after` gives.
pub const LIST: &str = "--reports";
pub const EXPORT: &str = "--export-report";
pub const DECIDE: &str = "--decide-report";
pub const HOLD: &str = "--hold-report";
pub const RELEASE: &str = "--release-report";
pub const RECORD_TERMINATION: &str = "--record-termination";
const THE_FLAGS: [&str; 6] = [LIST, EXPORT, DECIDE, HOLD, RELEASE, RECORD_TERMINATION];

/// What a decision concludes (CONTEXT.md, « Decision »).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Decision {
    /// The report shows what the terms forbid: the takedown and the
    /// suspension are maintained.
    Maintained,
    /// It does not, or not enough: the suspension is lifted.
    Lifted,
    /// It confirms the suspension, and the account is terminated. The
    /// account itself is recorded apart (`RECORD_TERMINATION`).
    Termination,
}

impl Decision {
    const ALL: [Decision; 3] = [
        Decision::Maintained,
        Decision::Lifted,
        Decision::Termination,
    ];

    /// The word typed on the command line, and kept.
    pub fn code(self) -> &'static str {
        match self {
            Decision::Maintained => "maintained",
            Decision::Lifted => "lifted",
            Decision::Termination => "termination",
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
    /// An account terminated, recorded as a deletion.
    RecordTermination(String),
}

/// What a motivation is, said wherever one is asked for or refused.
pub const WHAT_A_MOTIVATION_IS: &str = "The motivation is the reasoned decision: what the \
     report shows, and which rule of the terms it breaks or does not. It is never a quotation: \
     it copies nothing that was said, and names no account, no conversation and no message.";

/// The gestures, said with every refusal of a command line.
fn usage() -> String {
    format!(
        "The operator's gestures on reports, one per run:\n\
         \x20 {LIST}                     the reports awaiting a decision, and those held\n\
         \x20 {LIST} <number>            one report, its reporting account included\n\
         \x20 {EXPORT} <number>      its sealed report, for scripts/ouvrir-un-signalement.mjs\n\
         \x20 {DECIDE} <number> <maintained|lifted|termination> \"<motivation>\"\n\
         \x20   {WHAT_A_MOTIVATION_IS}\n\
         \x20 {HOLD} <number>        held for the authorities: nothing of it is erased\n\
         \x20 {RELEASE} <number>     the hold released\n\
         \x20 {RECORD_TERMINATION} <@account:server>   an account the homeserver deactivated, \
         recorded as a deletion"
    )
}

/// The gesture a command line names: `None` when it names none of them, which
/// leaves the command line to the other modes and to the service.
///
/// ANYTHING STARTING WITH ONE OF THE FLAGS SELECTS THIS, deliberately: a near
/// miss such as `--reports=K7QM-4ZT2` is refused here, where taking it for no
/// flag would start a second service. So is a second flag, of these gestures
/// or of the other modes, and any option: `--yes` and `--force` confirm
/// nothing here.
pub fn the_gesture(argv: &[String]) -> Option<Result<Gesture, String>> {
    let words: Vec<&str> = argv.iter().skip(1).map(String::as_str).collect();
    if !words
        .iter()
        .any(|word| THE_FLAGS.iter().any(|flag| word.starts_with(flag)))
    {
        return None;
    }
    Some(read(&words).map_err(|why| format!("{why}\n\n{}", usage())))
}

/// The gesture `words` name, all of them after the program.
fn read(words: &[&str]) -> Result<Gesture, String> {
    let (options, named): (Vec<&str>, Vec<&str>) =
        words.iter().partition(|word| word.starts_with('-'));
    let [flag] = options[..] else {
        return Err(format!(
            "one gesture per run, and no option beside it: {}",
            options.join(" ")
        ));
    };
    let Some(&gesture) = THE_FLAGS.iter().find(|known| **known == flag) else {
        return Err(format!(
            "{flag:?} is not one of the gestures: write the flag alone, then what it names, \
             separated by spaces"
        ));
    };
    let a_number = |typed: &str| {
        ReportNumber::parse(typed)
            .ok_or_else(|| format!("{typed:?} is not a report number, such as K7QM-4ZT2"))
    };
    let one_number = || match named[..] {
        [typed] => a_number(typed),
        _ => Err(format!("{gesture} names one report number, and only one")),
    };
    match gesture {
        LIST => match named[..] {
            [] => Ok(Gesture::List),
            [typed] => a_number(typed).map(Gesture::Show),
            _ => Err(format!("{LIST} names one report number at most")),
        },
        EXPORT => one_number().map(Gesture::Export),
        HOLD => one_number().map(Gesture::Hold),
        RELEASE => one_number().map(Gesture::Release),
        DECIDE => match named[..] {
            [typed, decision, motivation] => Ok(Gesture::Decide {
                number: a_number(typed)?,
                decision: Decision::from_code(decision).ok_or_else(|| {
                    format!("{decision:?} is not a decision: maintained, lifted or termination")
                })?,
                motivation: motivation.to_string(),
            }),
            [_, _] => Err(format!("the motivation is missing. {WHAT_A_MOTIVATION_IS}")),
            _ => Err(format!(
                "{DECIDE} names the report number, the decision, and the motivation in quotes, \
                 one argument"
            )),
        },
        _ => match named[..] {
            [account] if is_a_user_id(account) => Ok(Gesture::RecordTermination(account.into())),
            [account] => Err(format!(
                "{account:?} is not a Matrix account ID, such as @localpart:messagr.eu"
            )),
            _ => Err(format!(
                "{RECORD_TERMINATION} names one account, and only one"
            )),
        },
    }
}

/// The fewest characters a motivation holds: it says why.
const MOTIVATION_LEAST: usize = 10;
/// The most: a reasoned decision is a few sentences, not a transcript.
const MOTIVATION_MOST: usize = 1_000;

/// The motivation `typed`, trimmed, or why it is refused: too short or too
/// long, more than one line, or holding a Matrix identifier. The refusal
/// never repeats what it refuses.
pub fn the_motivation(typed: &str) -> Result<String, String> {
    let motivation = typed.trim();
    let refused = |why: String| Err(format!("{why}. {WHAT_A_MOTIVATION_IS}"));
    let length = motivation.chars().count();
    if length < MOTIVATION_LEAST {
        return refused(format!(
            "a motivation says why, in {MOTIVATION_LEAST} characters at least"
        ));
    }
    if length > MOTIVATION_MOST {
        return refused(format!(
            "a motivation is a few sentences, {MOTIVATION_MOST} characters at most"
        ));
    }
    if motivation.chars().any(char::is_control) {
        return refused("a motivation is one line, without a tab".into());
    }
    if let Some(what) = a_matrix_identifier_in(motivation) {
        return refused(format!("this motivation holds {what}"));
    }
    Ok(motivation.to_string())
}

/// What in `text` looks like a Matrix identifier, if anything: an account, a
/// room or its alias, an event, or a file's address on the homeserver. A
/// motivation holds none, so that the service never learns from one who or
/// what was reported.
fn a_matrix_identifier_in(text: &str) -> Option<&'static str> {
    if text.to_lowercase().contains("mxc://") {
        return Some("a file's address (mxc://…)");
    }
    let chars: Vec<char> = text.chars().collect();
    for (at, &sigil) in chars.iter().enumerate() {
        let what = match sigil {
            '@' => "an account ID (@…)",
            '#' => "a room alias (#…)",
            '!' => "a room ID (!…)",
            '$' => "an event ID ($…)",
            _ => continue,
        };
        let after = &chars[at + 1..];
        // `@localpart:server`, `#alias:server`, `!opaque:server` and
        // `$opaque:server`: a run, a colon, and the start of a server name.
        let run = after
            .iter()
            .take_while(|c| !c.is_whitespace() && **c != ':')
            .count();
        let a_server = after
            .get(run + 1)
            .is_some_and(|c| c.is_ascii_alphanumeric() || *c == '[');
        if run > 0 && after.get(run) == Some(&':') && a_server {
            return Some(what);
        }
        // A room or an event of the room versions that drop the server: a
        // hash, in base64.
        let hash = after
            .iter()
            .take_while(|c| c.is_ascii_alphanumeric() || "+/=_-.".contains(**c))
            .count();
        if matches!(sigil, '!' | '$') && hash >= 8 {
            return Some(what);
        }
        // `@bob`, starting a word: an account, mentioned.
        let starts_a_word = at == 0 || !chars[at - 1].is_alphanumeric();
        if sigil == '@' && starts_a_word && after.first().is_some_and(|c| c.is_alphanumeric()) {
            return Some(what);
        }
    }
    None
}

/// Erases the sealed report and the idempotency key of every report decided
/// `SEALED_KEPT_DAYS` days ago or more, and not held for the authorities. A
/// report with no decision is not touched: `decided_on` is NULL.
pub async fn erase_sealed_reports(pool: &SqlitePool, now: i64) -> anyhow::Result<u64> {
    let erased = sqlx::query(
        "UPDATE reports SET sealed = NULL, idempotency_key = NULL \
         WHERE (sealed IS NOT NULL OR idempotency_key IS NOT NULL) \
           AND held_since IS NULL AND decided_on <= ?",
    )
    .bind(now - SEALED_KEPT_DAYS * DAY_SECONDS)
    .execute(pool)
    .await?;
    Ok(erased.rows_affected())
}

/// Erases every report decided `RECORD_KEPT_DAYS` days ago or more, and not
/// held for the authorities: what was decided, and whom it came from. A
/// report with no decision is not touched.
pub async fn erase_decided_reports(pool: &SqlitePool, now: i64) -> anyhow::Result<u64> {
    let erased = sqlx::query("DELETE FROM reports WHERE held_since IS NULL AND decided_on <= ?")
        .bind(now - RECORD_KEPT_DAYS * DAY_SECONDS)
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

/// Whether `answer` types `number` back: any spelling of the number counts,
/// in any case, with a hyphen, a space or nothing between its groups, as a
/// report number is typed anywhere (`ReportNumber::parse`). The end of stdin
/// is a refusal.
fn is_the_number(answer: Option<&str>, number: ReportNumber) -> bool {
    answer.and_then(|typed| ReportNumber::parse(typed.trim())) == Some(number)
}

fn unwritten(number: ReportNumber) -> impl Fn(sqlx::Error) -> String {
    move |e| format!("report {number}: nothing was written: {e}")
}

/// `--decide-report`: the decision, its motivation and its day, once the
/// number is typed back. A new decision replaces the previous one, and what
/// is erased after a decision counts from the new one.
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
    let on = the_day_of(now);
    let mut plan = format!(
        "Recording a decision on report {number}, received {}, reason: {}.\n\
         \x20 decision   : {}\n\
         \x20 motivation : {motivation}\n\
         \x20 dated      : {} (the day is kept, never the hour)\n",
        instant(report.received_at),
        report.reason(),
        decision.code(),
        date(on)
    );
    if let (Some(previous), Some(previous_on)) = (&report.decision, report.decided_on) {
        plan.push_str(&format!(
            "It was decided {previous} on {}: this decision replaces that one, and what is \
             erased after a decision counts from this one.\n",
            date(previous_on)
        ));
    }
    plan.push_str(&match report.held_since {
        Some(since) => format!(
            "It is held for the authorities since {}: nothing of it is erased until it is \
             released.\n",
            date(since)
        ),
        None => format!(
            "Its sealed report is erased on {}, {SEALED_KEPT_DAYS} days after that date, and \
             its record on {}, {RECORD_KEPT_DAYS} days after.\n",
            date(on + SEALED_KEPT_DAYS * DAY_SECONDS),
            date(on + RECORD_KEPT_DAYS * DAY_SECONDS)
        ),
    });
    if decision == Decision::Termination {
        plan.push_str(&format!(
            "The account is recorded apart, by itself, once the homeserver has deactivated it: \
             {RECORD_TERMINATION} <@account:server>. Nothing in the database relates the two.\n"
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

    let written = sqlx::query(
        "UPDATE reports SET decision = ?, motivation = ?, decided_on = ? WHERE number = ?",
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
        "Report {number}: {} on {}.\n",
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
    let since = the_day_of(now);
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
    let then = match report.decided_on {
        None => "It has no decision: nothing of it is erased until it has one.".to_string(),
        Some(on) => format!(
            "Its sealed report is erased on {}, {SEALED_KEPT_DAYS} days after its decision, and \
             its record on {}, {RECORD_KEPT_DAYS} days after: the next hourly sweep erases \
             whatever is already due.",
            date(on + SEALED_KEPT_DAYS * DAY_SECONDS),
            date(on + RECORD_KEPT_DAYS * DAY_SECONDS)
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

/// `--record-termination`: an account the homeserver deactivated, recorded as
/// its holder's own deletion would be (`handlers::deletion::record`), once
/// the account is typed back, case included, as the named deactivation asks.
/// It names no report, and nothing it writes does.
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
            instant(at)
        ));
    }
    let purge_by = date(now + crate::handlers::deletion::PURGE_AFTER_SECONDS);
    let plan = format!(
        "Recording the termination of {account} as an account deletion, as if its holder had \
         deleted it from the application:\n\
         \x20 - it joins the account deletions the purge within thirty days works from, until \
         {purge_by};\n\
         \x20 - its invitations still open expire now, and its number leaves discovery;\n\
         \x20 - nothing relates it to a report: its decision is recorded apart, on the report, \
         with {DECIDE}.\n\
         Record it once the homeserver has deactivated the account \
         (scripts/admin-messagr.sh fermer), and not before.\n\
         Type the account to record it, or anything else to leave everything as it is:"
    );
    if !crate::operator::typed_back(ask(&plan).as_deref(), account) {
        return Err(format!("{account}: nothing was recorded"));
    }
    let recorded = crate::handlers::deletion::record(pool, account, now)
        .await
        .map_err(|e| format!("{account}: nothing was recorded: {e}"))?;
    Ok(format!(
        "{account} is among the account deletions: to purge by {purge_by}. Invitations it had \
         still open, now expired: {}.\n",
        recorded.expired_invitations
    ))
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
            .map(|on| format!(" on {}", date(on + SEALED_KEPT_DAYS * DAY_SECONDS)))
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

/// A report as the service keeps it, its sealed report reduced to whether it
/// is still there.
struct Kept {
    number: String,
    reporter: String,
    reason: String,
    sealed: bool,
    received_at: i64,
    decision: Option<String>,
    motivation: Option<String>,
    decided_on: Option<i64>,
    held_since: Option<i64>,
}

impl Kept {
    const COLUMNS: &'static str = "number, reporter_user_id, reason, sealed IS NOT NULL, \
         received_at, decision, motivation, decided_on, held_since";

    fn from_row(row: &sqlx::sqlite::SqliteRow) -> Kept {
        Kept {
            number: row.get(0),
            reporter: row.get(1),
            reason: row.get(2),
            sealed: row.get(3),
            received_at: row.get(4),
            decision: row.get(5),
            motivation: row.get(6),
            decided_on: row.get(7),
            held_since: row.get(8),
        }
    }

    /// Its reason by its code and as the operator's SMS names it, and said
    /// urgent when it is.
    fn reason(&self) -> String {
        match Reason::from_code(&self.reason) {
            Some(reason) if reason.is_urgent() => {
                format!("{} ({}), urgent", self.reason, reason.in_an_sms())
            }
            Some(reason) => format!("{} ({})", self.reason, reason.in_an_sms()),
            None => self.reason.clone(),
        }
    }

    fn is_urgent(&self) -> bool {
        Reason::from_code(&self.reason).is_some_and(Reason::is_urgent)
    }
}

/// The report kept under `number`, or the refusal that says there is none.
async fn kept(pool: &SqlitePool, number: ReportNumber) -> Result<Kept, String> {
    sqlx::query(&format!(
        "SELECT {} FROM reports WHERE number = ?",
        Kept::COLUMNS
    ))
    .bind(number.to_string())
    .fetch_optional(pool)
    .await
    .map_err(unreadable)?
    .map(|row| Kept::from_row(&row))
    .ok_or_else(|| format!("no report {number}"))
}

fn unreadable(e: sqlx::Error) -> String {
    format!("the database could not be read: {e}")
}

/// `--reports`: what awaits a decision, the urgent first, then what is held
/// once decided. Never the reporting account: the list is what the operator
/// reads to know what to open, and nobody's account is needed for that.
async fn list(pool: &SqlitePool, now: i64) -> Result<String, String> {
    let all: Vec<Kept> = sqlx::query(&format!(
        "SELECT {} FROM reports ORDER BY received_at, number",
        Kept::COLUMNS
    ))
    .fetch_all(pool)
    .await
    .map_err(unreadable)?
    .iter()
    .map(Kept::from_row)
    .collect();
    let (mut awaiting, decided): (Vec<&Kept>, Vec<&Kept>) =
        all.iter().partition(|report| report.decision.is_none());
    // Stable: each group stays in the order of reception.
    awaiting.sort_by_key(|report| !report.is_urgent());
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
            said.push_str(&format!(
                "  {}  {} on {}{}\n",
                report.number,
                report.decision.as_deref().unwrap_or_default(),
                report.decided_on.map(date).unwrap_or_default(),
                held_since(report)
            ));
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
    match (&report.decision, report.decided_on) {
        (Some(decision), Some(on)) => {
            said.push_str(&format!(
                "  decision          : {decision} on {}\n\
                 \x20 motivation        : {}\n",
                date(on),
                report.motivation.as_deref().unwrap_or_default()
            ));
        }
        _ => said.push_str(&format!(
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
    let (sealed, record) = match (report.decided_on, report.held_since) {
        (_, Some(_)) => (
            "kept while the report is held".to_string(),
            "kept while the report is held".to_string(),
        ),
        (None, None) => (
            format!("kept until {SEALED_KEPT_DAYS} days after a decision"),
            format!("kept until {RECORD_KEPT_DAYS} days after a decision"),
        ),
        (Some(on), None) => (
            format!(
                "kept until {}, {SEALED_KEPT_DAYS} days after the decision",
                date(on + SEALED_KEPT_DAYS * DAY_SECONDS)
            ),
            format!(
                "kept until {}, {RECORD_KEPT_DAYS} days after the decision",
                date(on + RECORD_KEPT_DAYS * DAY_SECONDS)
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

/// Midnight UTC of the day `at` falls on: the date a gesture of the operator
/// leaves on a report, never its hour (the header says why).
fn the_day_of(at: i64) -> i64 {
    at - at.rem_euclid(DAY_SECONDS)
}

/// `at` as a date in UTC, `2026-10-01`.
fn date(at: i64) -> String {
    let (year, month, day) = civil(at.div_euclid(DAY_SECONDS));
    format!("{year:04}-{month:02}-{day:02}")
}

/// `at` in UTC to the minute, `2026-10-01 14:03 UTC`.
fn instant(at: i64) -> String {
    let seconds = at.rem_euclid(DAY_SECONDS);
    format!(
        "{} {:02}:{:02} UTC",
        date(at),
        seconds / 3_600,
        seconds % 3_600 / 60
    )
}

/// The civil date of a day counted from 1970-01-01, in the proleptic
/// Gregorian calendar (Howard Hinnant's `civil_from_days`).
fn civil(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let of_the_era = z.rem_euclid(146_097);
    let year_of_the_era =
        (of_the_era - of_the_era / 1_460 + of_the_era / 36_524 - of_the_era / 146_096) / 365;
    let day_of_the_year =
        of_the_era - (365 * year_of_the_era + year_of_the_era / 4 - year_of_the_era / 100);
    let shifted_month = (5 * day_of_the_year + 2) / 153;
    let day = day_of_the_year - (153 * shifted_month + 2) / 5 + 1;
    let month = if shifted_month < 10 {
        shifted_month + 3
    } else {
        shifted_month - 9
    };
    let year = year_of_the_era + era * 400 + i64::from(month <= 2);
    // Both are bounded by the arithmetic above: 1 to 31, and 1 to 12.
    (year, month as u32, day as u32)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::report::test_support::sealed_of;

    const DAY: i64 = DAY_SECONDS;
    /// 2026-09-21 14:13:20 UTC.
    const RECEIVED: i64 = 1_790_000_000;

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

    // ── Migration 022 ────────────────────────────────────────────────────

    /// THE TABLE IS REBUILT, AND WHAT IT HELD IS NOT LOST: the reports a
    /// service before #473 received are kept as they came, awaiting a
    /// decision. An idempotency key still names one report of an account,
    /// and two erased keys of the same account no longer collide.
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
            "../../../scripts/fixtures/signalement-de-test.json"
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
            include_str!("../../../scripts/fixtures/signalement-exporte-de-test.json")
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

    /// 2026-10-01 14:03:20 UTC, when the decisions of these tests are typed.
    const DECIDED: i64 = 1_790_863_400;
    /// 2026-10-01 00:00 UTC: the date they keep.
    const DECIDED_ON: i64 = 1_790_812_800;
    const MOTIVATION: &str = "Le signalement montre des menaces répétées contre la personne \
         qui signale, ce que les conditions interdisent : suspension confirmée.";

    fn decide(number_typed: &str, decision: Decision, motivation: &str) -> Gesture {
        Gesture::Decide {
            number: number(number_typed),
            decision,
            motivation: motivation.into(),
        }
    }

    /// The decision kept on `number`: what, why and when.
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

    #[sqlx::test(migrations = "./migrations")]
    async fn a_decision_is_kept_with_its_motivation_and_its_day_once_the_number_is_typed_back(
        pool: SqlitePool,
    ) {
        a_report(&pool, "K7QM-4ZT2", "@alice:h", "threat", RECEIVED).await;

        let (plan, done) = answered(
            &pool,
            decide("K7QM-4ZT2", Decision::Maintained, MOTIVATION),
            DECIDED,
            Some("K7QM-4ZT2\n"),
        )
        .await;

        assert!(done.is_ok(), "{done:?}");
        assert_eq!(
            decision_on(&pool, "K7QM-4ZT2").await,
            (
                Some("maintained".into()),
                Some(MOTIVATION.into()),
                Some(DECIDED_ON)
            ),
            "the day of the decision, never its hour"
        );
        // The plan says what is kept, and when it goes: 181 and 365 days
        // after 2026-10-01.
        for said in [
            "maintained",
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
                decide("K7QM-4ZT2", Decision::Maintained, MOTIVATION),
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
            decide("K7QM-4ZT2", Decision::Maintained, MOTIVATION),
            DECIDED,
        )
        .await;
        assert_eq!(refused, Err("no report K7QM-4ZT2".into()));
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_new_decision_replaces_the_previous_one_and_says_so(pool: SqlitePool) {
        a_report(&pool, "K7QM-4ZT2", "@alice:h", "threat", RECEIVED).await;
        answered(
            &pool,
            decide("K7QM-4ZT2", Decision::Maintained, MOTIVATION),
            DECIDED,
            Some("K7QM-4ZT2"),
        )
        .await
        .1
        .unwrap();

        // Contested, and cleared ten days later.
        let cleared = "La contestation montre que les messages signalés répondaient à une \
             menace reçue : aucun manquement retenu, suspension levée.";
        let (plan, done) = answered(
            &pool,
            decide("K7QM-4ZT2", Decision::Lifted, cleared),
            DECIDED + 10 * DAY,
            Some("K7QM-4ZT2"),
        )
        .await;

        assert!(done.is_ok(), "{done:?}");
        assert!(
            plan.contains("decided maintained on 2026-10-01"),
            "the plan says what it replaces: {plan}"
        );
        assert_eq!(
            decision_on(&pool, "K7QM-4ZT2").await,
            (
                Some("lifted".into()),
                Some(cleared.into()),
                Some(DECIDED_ON + 10 * DAY)
            )
        );
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn a_termination_s_plan_says_the_account_is_recorded_apart(pool: SqlitePool) {
        a_report(&pool, "K7QM-4ZT2", "@alice:h", "threat", RECEIVED).await;

        let (plan, done) = answered(
            &pool,
            decide("K7QM-4ZT2", Decision::Termination, MOTIVATION),
            DECIDED,
            Some("K7QM-4ZT2"),
        )
        .await;

        assert!(done.is_ok(), "{done:?}");
        assert!(plan.contains(RECORD_TERMINATION), "{plan}");
        assert!(
            plan.contains("Nothing in the database relates the two"),
            "{plan}"
        );
        assert_eq!(
            decision_on(&pool, "K7QM-4ZT2").await.0.as_deref(),
            Some("termination")
        );
    }

    // ── The motivation ───────────────────────────────────────────────────

    #[test]
    fn a_motivation_naming_an_account_a_conversation_a_message_or_a_file_is_refused() {
        for (what, motivation) in [
            (
                "an account",
                "Menaces répétées de @bob:messagr.eu, suspension confirmée.",
            ),
            ("an account first", "@bob:messagr.eu menace la personne."),
            (
                "an account last",
                "Suspension confirmée pour le compte @bob:messagr.eu",
            ),
            (
                "an account in brackets",
                "Le compte (@bob:messagr.eu) menace la personne.",
            ),
            (
                "an account in guillemets",
                "Le compte «@Bob.Smith:example.org» menace la personne.",
            ),
            ("an account's mention", "Les messages de @bob menacent la personne."),
            (
                "a room",
                "Menaces dans !rrITrtfgg8HrvpdgSsHUiTgJ7LqqSjGE8q2gsUbZEOI, confirmées.",
            ),
            (
                "a room of an older version",
                "Menaces dans !abc:messagr.eu, suspension confirmée.",
            ),
            (
                "a room's alias",
                "Menaces dans #general:messagr.eu, suspension confirmée.",
            ),
            (
                "a message",
                "Le message $4KfZcXgWvRgUe4N2Qo5sT3yLmPk0aJhBdCiEfGnH1Iu menace la personne.",
            ),
            (
                "a message of an older version",
                "Le message $abc:messagr.eu menace la personne.",
            ),
            (
                "a file",
                "La photo mxc://messagr.eu/AbCdEfGhIjKlMn est une image intime diffusée sans accord.",
            ),
        ] {
            let refused = the_motivation(motivation);
            assert!(
                refused
                    .as_ref()
                    .is_err_and(|why| why.contains(WHAT_A_MOTIVATION_IS)),
                "{what}: {refused:?}"
            );
            // The refusal does not repeat what it refuses.
            assert!(
                !refused.unwrap_err().contains("messagr.eu"),
                "{what}: the refusal repeats the identifier"
            );
        }
    }

    #[test]
    fn a_motivation_is_one_line_of_ten_to_a_thousand_characters() {
        for (what, motivation) in [
            ("nothing", String::new()),
            ("spaces", "          ".into()),
            ("too short", "Menace.".into()),
            ("a thousand and one", "a".repeat(1_001)),
            (
                "two lines",
                "Menaces répétées.\nSuspension confirmée.".into(),
            ),
            ("a tab", "Menaces répétées.\tSuspension confirmée.".into()),
        ] {
            assert!(the_motivation(&motivation).is_err(), "{what}");
        }
    }

    #[test]
    fn a_reasoned_motivation_is_taken_as_written_and_trimmed() {
        for motivation in [
            MOTIVATION,
            "Aucun manquement : le message signalé ne montre rien que les conditions interdisent !",
            "Contestation reçue à conformite@messagr.eu : suspension levée.",
            "Démarchage répété, clause 3 des conditions : retrait maintenu.",
            "Menace de mort ! Transmis aux autorités, compte fermé.",
        ] {
            assert_eq!(
                the_motivation(&format!("  {motivation} ")),
                Ok(motivation.to_string())
            );
        }
        assert_eq!(
            the_motivation(&"a".repeat(1_000)).map(|m| m.len()),
            Ok(1_000)
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
                Decision::Termination,
                "Menaces répétées de @bob:messagr.eu : compte fermé.",
            ),
            DECIDED,
        )
        .await;

        assert!(refused.is_err());
        assert_eq!(decision_on(&pool, "K7QM-4ZT2").await, (None, None, None));
    }

    // ── Held for the authorities ─────────────────────────────────────────

    async fn held_since(pool: &SqlitePool, number: &str) -> Option<i64> {
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
        assert_eq!(held_since(&pool, "K7QM-4ZT2").await, Some(DECIDED_ON));
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
        assert_eq!(held_since(&pool, "K7QM-4ZT2").await, None);
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

        assert_eq!(held_since(&pool, "K7QM-4ZT2").await, None);
        assert_eq!(held_since(&pool, "ABCD-EFGH").await, Some(DECIDED_ON));
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
        assert_eq!(held_since(&pool, "K7QM-4ZT2").await, Some(DECIDED_ON));
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

    /// `number` received, then decided at `DECIDED`.
    async fn a_decided_report(pool: &SqlitePool, number_typed: &str) {
        a_report(pool, number_typed, "@alice:h", "harassment", RECEIVED).await;
        answered(
            pool,
            decide(number_typed, Decision::Maintained, MOTIVATION),
            DECIDED,
            Some(number_typed),
        )
        .await
        .1
        .unwrap();
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn the_sealed_report_and_its_key_go_181_days_after_the_decision_and_not_a_second_before(
        pool: SqlitePool,
    ) {
        a_decided_report(&pool, "K7QM-4ZT2").await;
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
            Some("maintained")
        );
        let shown = said(&pool, Gesture::Show(number("K7QM-4ZT2")), due)
            .await
            .unwrap();
        assert!(shown.contains("sealed report     : erased\n"), "{shown}");
        assert!(shown.contains("reporting account : @alice:h\n"), "{shown}");
    }

    #[sqlx::test(migrations = "./migrations")]
    async fn the_record_goes_365_days_after_the_decision_and_not_a_second_before(pool: SqlitePool) {
        a_decided_report(&pool, "K7QM-4ZT2").await;
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
        a_decided_report(&pool, "K7QM-4ZT2").await;
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
        a_decided_report(&pool, "K7QM-4ZT2").await;
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

    /// Days from 1970-01-01 to a civil date: the inverse of `civil`, written
    /// apart from it (Howard Hinnant's `days_from_civil`).
    fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
        let year = if month <= 2 { year - 1 } else { year };
        let era = year.div_euclid(400);
        let of_the_era = year.rem_euclid(400);
        let shifted = if month > 2 { month - 3 } else { month + 9 };
        let of_the_year = (153 * shifted + 2) / 5 + day - 1;
        let day_of_the_era = of_the_era * 365 + of_the_era / 4 - of_the_era / 100 + of_the_year;
        era * 146_097 + day_of_the_era - 719_468
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

    /// The promise the privacy policy makes: « six mois après la décision »,
    /// « douze mois après la décision ». Whatever the day and the hour of a
    /// decision, what is erased goes within six and twelve calendar months.
    #[test]
    fn neither_erasure_ever_comes_later_than_six_and_twelve_calendar_months() {
        for day in days_from_civil(2026, 1, 1)..days_from_civil(2034, 1, 1) {
            let (year, month, day_of_the_month) = civil(day);
            let (month, day_of_the_month) = (i64::from(month), i64::from(day_of_the_month));
            // The earliest instant of the day is the latest the erasures can
            // be, measured from the decision.
            let decided_at = day * DAY;
            let on = the_day_of(decided_at);
            assert!(
                on + SEALED_KEPT_DAYS * DAY <= months_after(year, month, day_of_the_month, 6) * DAY,
                "{year}-{month}-{day_of_the_month}: six months"
            );
            assert!(
                on + RECORD_KEPT_DAYS * DAY
                    <= months_after(year, month, day_of_the_month, 12) * DAY,
                "{year}-{month}-{day_of_the_month}: twelve months"
            );
        }
        assert_eq!(civil(days_from_civil(2026, 10, 1)), (2026, 10, 1));
    }

    // ── A termination, recorded as an account deletion ───────────────────

    /// Every account deletion kept: account, instant, end of its purge.
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
    async fn a_termination_is_among_the_account_deletions_once_the_account_is_typed_back(
        pool: SqlitePool,
    ) {
        let (plan, done) = answered(&pool, termination("@bob:h"), DECIDED, Some("@bob:h\n")).await;

        assert!(done.is_ok(), "{done:?}");
        // As a deletion announced from the application: its instant, and the
        // purge within thirty days (`handlers::deletion`).
        assert_eq!(
            deletions(&pool).await,
            [("@bob:h".to_string(), DECIDED, DECIDED + 30 * DAY)]
        );
        assert!(plan.contains("thirty days"), "{plan}");
        assert!(plan.contains("nothing relates it to a report"), "{plan}");
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
    async fn a_termination_ends_the_account_s_open_invitations_as_a_deletion_does(
        pool: SqlitePool,
    ) {
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

        let status: String = sqlx::query_scalar("SELECT status FROM invitations WHERE id = 'open'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(status, "expired");
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
            [("@bob:h".to_string(), DECIDED, DECIDED + 30 * DAY)]
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

    /// ADR 0015: the service learns neither who is reported nor what. A
    /// termination decided on a report, and the account recorded in the same
    /// second: no row holds both, the decision holds no account but the one
    /// that reported, and not even its date is the deletion's instant.
    #[sqlx::test(migrations = "./migrations")]
    async fn nothing_in_the_database_relates_a_termination_to_its_report(pool: SqlitePool) {
        a_report(&pool, "K7QM-4ZT2", "@alice:h", "threat", RECEIVED).await;
        answered(
            &pool,
            decide("K7QM-4ZT2", Decision::Termination, MOTIVATION),
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
                "{table} relates them: {row}"
            );
            if row.contains("bob") {
                assert_eq!(table, "account_deletions", "{row}");
            }
        }
        // The deletion is the row an announcement writes, and no more.
        let columns: Vec<String> =
            sqlx::query_scalar("SELECT name FROM pragma_table_info('account_deletions')")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(columns, ["user_id", "announced_at", "purge_after"]);
        // And the decision's date is a day, not the second both were typed.
        assert_eq!(decision_on(&pool, "K7QM-4ZT2").await.2, Some(DECIDED_ON));
        assert_eq!(deletions(&pool).await[0].1, DECIDED);
    }

    // ── The command line ─────────────────────────────────────────────────

    fn line(words: &[&str]) -> Vec<String> {
        std::iter::once("messagr-invitations")
            .chain(words.iter().copied())
            .map(String::from)
            .collect()
    }

    fn gesture_of(words: &[&str]) -> Option<Result<Gesture, String>> {
        the_gesture(&line(words))
    }

    #[test]
    fn each_flag_names_its_gesture() {
        assert_eq!(gesture_of(&[]), None);
        assert_eq!(gesture_of(&["--retire-masking-key", "1"]), None);
        assert_eq!(gesture_of(&["--reports"]), Some(Ok(Gesture::List)));
        assert_eq!(
            gesture_of(&["--reports", "k7qm-4zt2"]),
            Some(Ok(Gesture::Show(number("K7QM-4ZT2"))))
        );
        assert_eq!(
            gesture_of(&["--export-report", "K7QM-4ZT2"]),
            Some(Ok(Gesture::Export(number("K7QM-4ZT2"))))
        );
        assert_eq!(
            gesture_of(&["--decide-report", "K7QM-4ZT2", "termination", MOTIVATION]),
            Some(Ok(decide("K7QM-4ZT2", Decision::Termination, MOTIVATION)))
        );
        assert_eq!(
            gesture_of(&["--hold-report", "K7QM-4ZT2"]),
            Some(Ok(Gesture::Hold(number("K7QM-4ZT2"))))
        );
        assert_eq!(
            gesture_of(&["--release-report", "K7QM-4ZT2"]),
            Some(Ok(Gesture::Release(number("K7QM-4ZT2"))))
        );
        assert_eq!(
            gesture_of(&["--record-termination", "@bob:messagr.eu"]),
            Some(Ok(termination("@bob:messagr.eu")))
        );
    }

    #[test]
    fn a_command_line_naming_a_gesture_badly_is_refused_rather_than_starting_the_service() {
        for words in [
            vec!["--reports", "K7QM-4ZT2", "ABCD-EFGH"],
            vec!["--reports", "@alice:h"],
            vec!["--reports=K7QM-4ZT2"],
            vec!["--export-report"],
            vec!["--export-report", "K0QM-4ZT2"],
            vec!["--decide-report", "K7QM-4ZT2", "maintained"],
            vec!["--decide-report", "K7QM-4ZT2", "upheld", MOTIVATION],
            vec![
                "--decide-report",
                "K7QM-4ZT2",
                "maintained",
                "Menaces",
                "répétées",
            ],
            vec!["--hold-report", "K7QM-4ZT2", "ABCD-EFGH"],
            vec!["--release-report"],
            vec!["--record-termination"],
            vec!["--record-termination", "bob:messagr.eu"],
            vec![
                "--record-termination",
                "@bob:messagr.eu",
                "@carol:messagr.eu",
            ],
            vec!["--record-termination", "@bob:messagr.eu", "--yes"],
            vec![
                "--hold-report",
                "K7QM-4ZT2",
                "--release-report",
                "K7QM-4ZT2",
            ],
            vec!["--reports", "--retire-masking-key", "1"],
            vec!["--reports", "--deactivate-claimed", "@bob:messagr.eu"],
        ] {
            assert!(
                matches!(gesture_of(&words), Some(Err(_))),
                "{words:?}: {:?}",
                gesture_of(&words)
            );
        }
    }

    #[test]
    fn the_help_of_a_decision_says_what_a_motivation_is() {
        let Some(Err(help)) = gesture_of(&["--decide-report", "K7QM-4ZT2", "maintained"]) else {
            panic!("refused");
        };
        assert!(help.contains(WHAT_A_MOTIVATION_IS), "{help}");
        assert!(help.contains("never a quotation"), "{help}");
    }
}
