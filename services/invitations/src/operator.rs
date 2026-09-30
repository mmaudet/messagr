//! What the gestures an operator types on the host share: how a command line
//! selects one, what an account identifier looks like, and one way an answer
//! to a plan confirms it. The named deactivation (`named_deactivation.rs`),
//! the retirement of a masking key (`retire_key.rs`) and the gestures on
//! reports (`moderation`, #473) are modes of the binary, never routes, and
//! each argues there why.
//!
//! # HOW EACH CONFIRMS
//!
//! Each says what it will write and waits for an identifier typed back; the
//! end of stdin is a refusal everywhere. The named deactivation and the
//! retirement of a key take the account or the key number back exactly, case
//! included (`typed_back`). The gestures on reports take a report number back
//! in any spelling a report number is typed in, and an account in any case,
//! since the homeserver reads an identifier in lowercase: both are written in
//! `moderation`, which says why.

/// The words a command line names beside `flag`, when an argument starts
/// with it; `None` when none does.
///
/// ANYTHING STARTING WITH THE FLAG SELECTS THE MODE, deliberately: a near
/// miss such as `--flag=x` lands in the mode naming nothing and is refused
/// there. Options are left out of what is named; `known_arguments` refuses
/// them before any mode is chosen.
pub fn named_after(argv: &[String], flag: &str) -> Option<Vec<String>> {
    let after_the_program = argv.iter().skip(1).collect::<Vec<_>>();
    if !after_the_program.iter().any(|a| a.starts_with(flag)) {
        return None;
    }
    Some(
        after_the_program
            .into_iter()
            .filter(|a| !a.starts_with('-'))
            .cloned()
            .collect(),
    )
}

/// Refuses a command line that names what no mode takes, before anything is
/// read or started (#473).
///
/// THE SERVICE TAKES NO ARGUMENT. So a command line with any argument is a
/// mode's, and one whose options are not all, exactly, the flags of `modes`,
/// or which names words beside no flag, is a mistake. Starting the service
/// instead would be the worst answer to it: its sweeper would run, its log
/// would go where the operator piped the mode's output, and the container
/// would not return.
pub fn known_arguments(argv: &[String], modes: &[&str]) -> Result<(), String> {
    let words: Vec<&str> = argv.iter().skip(1).map(String::as_str).collect();
    if words.is_empty() {
        return Ok(());
    }
    let unknown: Vec<&str> = words
        .iter()
        .copied()
        .filter(|word| word.starts_with('-') && !modes.contains(word))
        .collect();
    if !unknown.is_empty() {
        return Err(format!(
            "{} is no flag of the binary, whose modes are {}; nothing was started",
            unknown.join(" "),
            modes.join(", ")
        ));
    }
    if !words.iter().any(|word| modes.contains(word)) {
        return Err(format!(
            "{} names no mode, and the service takes no argument; nothing was started",
            words.join(" ")
        ));
    }
    Ok(())
}

/// Whether `answer` types `expected` back. Surrounding whitespace is
/// forgiven, since a terminal supplies a newline; case is not. `None` is the
/// end of stdin, and a refusal: a cron entry, a pipeline or a pasted runbook
/// finds no way through.
pub fn typed_back(answer: Option<&str>, expected: &str) -> bool {
    answer.is_some_and(|typed| typed.trim() == expected)
}

/// `@localpart:server`, on the specification's grammar for the localpart.
pub fn is_a_user_id(s: &str) -> bool {
    let Some(rest) = s.strip_prefix('@') else {
        return false;
    };
    let Some((local, server)) = rest.split_once(':') else {
        return false;
    };
    !local.is_empty()
        && !server.is_empty()
        && local
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b"._=/+-".contains(&b))
        && server
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b".-:[]".contains(&b))
}

#[cfg(test)]
mod tests {
    use super::*;

    const MODES: [&str; 3] = ["--reports", "--export-report", "--retire-masking-key"];

    fn line(words: &[&str]) -> Vec<String> {
        std::iter::once("messagr-invitations")
            .chain(words.iter().copied())
            .map(String::from)
            .collect()
    }

    #[test]
    fn the_service_starts_with_nothing_and_a_mode_with_its_flag() {
        for words in [
            vec![],
            vec!["--reports"],
            vec!["--export-report", "K7QM-4ZT2"],
            vec!["--retire-masking-key", "3"],
        ] {
            assert_eq!(known_arguments(&line(&words), &MODES), Ok(()), "{words:?}");
        }
    }

    #[test]
    fn an_argument_no_mode_takes_is_refused_rather_than_starting_the_service() {
        for words in [
            vec!["--export-reprot", "K7QM-4ZT2"],
            vec!["--reports", "--verbose"],
            vec!["--reports=K7QM-4ZT2"],
            vec!["--retire-masking-key", "3", "--yes"],
            vec!["-h"],
            vec!["K7QM-4ZT2"],
            vec!["serve"],
        ] {
            let refused = known_arguments(&line(&words), &MODES);
            assert!(
                refused
                    .as_ref()
                    .is_err_and(|why| why.contains("nothing was started")),
                "{words:?}: {refused:?}"
            );
        }
    }
}
