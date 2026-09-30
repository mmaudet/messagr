//! The operator's gestures on reports, as typed on the host (#473): the
//! binary itself, its command line, its stdin, its stdout and its exit
//! status, against a database of its own. `src/moderation/` tests what each
//! gesture does; this holds what only the process shows: that the export's
//! stdout carries the document and nothing else, that a confirmation is read
//! from stdin, that a command line naming a gesture badly is refused before
//! anything is read, and that one naming what no mode takes starts nothing.
//!
//! No homeserver and no network: the gestures reach neither.

use std::io::Write;
use std::path::Path;
use std::process::{Command, Output, Stdio};

use sqlx::sqlite::SqlitePoolOptions;

/// The binary under test, as cargo built it for these tests.
const BINARY: &str = env!("CARGO_BIN_EXE_messagr-invitations");

/// How long a gesture may take. Each ends within a second; a binary that runs
/// on has not taken the flag for a gesture, and started the service instead:
/// another build than this branch's, in a target directory shared with
/// another checkout, say. It is killed and said, rather than waited for.
const DEADLINE: std::time::Duration = std::time::Duration::from_secs(60);

/// What `child` said once it ended, or a failure naming why it did not.
fn finished(mut child: std::process::Child) -> Output {
    let started = std::time::Instant::now();
    while child.try_wait().unwrap().is_none() {
        if started.elapsed() > DEADLINE {
            let _ = child.kill();
            let _ = child.wait();
            panic!(
                "{BINARY} ran on past {DEADLINE:?}: it took no gesture from its command line, \
                 and started the service. Is it this branch's build?"
            );
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    child.wait_with_output().unwrap()
}

/// Runs the binary with `args` and `stdin` against the database in `dir`,
/// with the four variables every start needs, and nothing that reaches out.
fn gesture(dir: &Path, args: &[&str], stdin: &str) -> Output {
    let mut child = Command::new(BINARY)
        .args(args)
        .env_clear()
        .env(
            "DATABASE_URL",
            format!("sqlite://{}?mode=rwc", dir.join("invitations.db").display()),
        )
        .env("HOMESERVER_URL", "http://127.0.0.1:9")
        .env("REGISTRATION_TOKEN", "unused")
        .env(
            "ENCRYPTION_KEY",
            "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        )
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(stdin.as_bytes())
        .unwrap();
    finished(child)
}

fn stdout(output: &Output) -> String {
    String::from_utf8(output.stdout.clone()).unwrap()
}

/// The test report of `scripts/fixtures`, sealed for the test key, kept as
/// `POST /reports` keeps what an application sends, once the binary has made
/// the database.
async fn the_test_report_kept(dir: &Path, number: &str) {
    let fixture: serde_json::Value = serde_json::from_str(include_str!(
        "../../../scripts/fixtures/signalement-de-test.json"
    ))
    .unwrap();
    let field = |name: &str| fixture[name].as_str().unwrap().to_string();
    let pool = SqlitePoolOptions::new()
        .connect(&format!(
            "sqlite://{}",
            dir.join("invitations.db").display()
        ))
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO reports \
         (number, reporter_user_id, reason, sealed, received_at, idempotency_key) \
         VALUES (?, ?, ?, ?, 1790000000, 'key')",
    )
    .bind(number)
    .bind(field("reporter"))
    .bind(field("reason"))
    .bind(
        data_encoding::BASE64
            .decode(field("sealed").as_bytes())
            .unwrap(),
    )
    .execute(&pool)
    .await
    .unwrap();
    pool.close().await;
}

/// The text `sql` selects, `None` for no row as for NULL.
async fn one_value(dir: &Path, sql: &str) -> Option<String> {
    let pool = SqlitePoolOptions::new()
        .connect(&format!(
            "sqlite://{}",
            dir.join("invitations.db").display()
        ))
        .await
        .unwrap();
    let value: Option<Option<String>> =
        sqlx::query_scalar(sql).fetch_optional(&pool).await.unwrap();
    pool.close().await;
    value.flatten()
}

#[tokio::test]
async fn the_export_s_stdout_is_the_document_the_opening_tool_reads_and_nothing_else() {
    let dir = tempfile::tempdir().unwrap();
    let listed = gesture(dir.path(), &["--reports"], "");
    assert!(listed.status.success(), "{listed:?}");
    assert_eq!(stdout(&listed), "No report awaits a decision.\n");
    the_test_report_kept(dir.path(), "K7QM-4ZT2").await;

    let exported = gesture(dir.path(), &["--export-report", "K7QM-4ZT2"], "");

    assert!(exported.status.success(), "{exported:?}");
    assert_eq!(
        stdout(&exported),
        include_str!("../../../scripts/fixtures/signalement-exporte-de-test.json"),
        "stdout goes straight into the opening tool: the document, and nothing else"
    );
}

#[tokio::test]
async fn a_decision_is_written_once_the_number_is_typed_back_on_stdin_and_never_without() {
    let dir = tempfile::tempdir().unwrap();
    gesture(dir.path(), &["--reports"], "");
    the_test_report_kept(dir.path(), "K7QM-4ZT2").await;
    let decide = [
        "--decide-report",
        "K7QM-4ZT2",
        "lifted",
        "Le signalement montre un harcèlement répété, que les conditions interdisent.",
    ];

    // The end of stdin is a refusal: a pipeline or a pasted runbook finds no
    // way through.
    let refused = gesture(dir.path(), &decide, "");
    assert!(!refused.status.success(), "{refused:?}");
    assert_eq!(
        one_value(dir.path(), "SELECT decision FROM reports").await,
        None
    );

    let decided = gesture(dir.path(), &decide, "K7QM-4ZT2\n");
    assert!(decided.status.success(), "{decided:?}");
    assert!(
        stdout(&decided).contains("Type the report number"),
        "the plan comes first"
    );
    assert_eq!(
        one_value(dir.path(), "SELECT decision FROM reports").await,
        Some("lifted".into())
    );
}

#[tokio::test]
async fn a_termination_is_recorded_once_the_account_is_typed_back_on_stdin() {
    let dir = tempfile::tempdir().unwrap();

    let recorded = gesture(
        dir.path(),
        &["--record-termination", "@bob:messagr.eu"],
        "@bob:messagr.eu\n",
    );

    assert!(recorded.status.success(), "{recorded:?}");
    assert_eq!(
        one_value(dir.path(), "SELECT user_id FROM account_deletions").await,
        Some("@bob:messagr.eu".into())
    );
}

#[test]
fn a_gesture_named_badly_is_refused_before_anything_is_read() {
    // No variable at all: a refusal that needed the configuration would say
    // DATABASE_URL is missing instead.
    for (args, says) in [
        (vec!["--reports=K7QM-4ZT2"], "nothing was started"),
        (
            vec!["--decide-report", "K7QM-4ZT2", "lifted"],
            "The operator's gestures on reports",
        ),
        (
            vec!["--hold-report", "K7QM-4ZT2", "ABCD-EFGH"],
            "The operator's gestures on reports",
        ),
    ] {
        let refused = finished(
            Command::new(BINARY)
                .args(&args)
                .env_clear()
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .unwrap(),
        );
        let said = String::from_utf8_lossy(&refused.stderr);
        assert!(!refused.status.success(), "{args:?}");
        assert!(said.contains(says), "{args:?}: {said}");
        assert!(!said.contains("DATABASE_URL"), "{args:?}: {said}");
    }
}

/// A MISTYPED FLAG STARTS NOTHING. With every variable a start needs, the
/// service would start, sweeper and all, and its log would flow into the
/// opening tool through the operator's pipe: an argument no mode takes is
/// refused at once instead, and the process ends (`finished` kills and fails
/// a process that runs on).
#[tokio::test]
async fn an_argument_no_mode_takes_starts_nothing_and_ends_at_once() {
    let dir = tempfile::tempdir().unwrap();
    for args in [
        vec!["--export-reprot", "K7QM-4ZT2"],
        vec!["--reports", "--verbose"],
        vec!["--record-termination", "@bob:messagr.eu", "--yes"],
        vec!["K7QM-4ZT2"],
        vec!["serve"],
    ] {
        let refused = gesture(dir.path(), &args, "");
        let said = String::from_utf8_lossy(&refused.stderr);
        assert!(!refused.status.success(), "{args:?}");
        assert!(said.contains("nothing was started"), "{args:?}: {said}");
        assert_eq!(stdout(&refused), "", "{args:?}");
    }
    assert!(
        !dir.path().join("invitations.db").exists(),
        "and the database was never opened"
    );
}
