//! What the gestures an operator types on the host share: how a command line
//! selects one, how the answer to its plan confirms it, and what an account
//! identifier looks like. The named deactivation (`named_deactivation.rs`),
//! the retirement of a masking key (`retire_key.rs`) and the gestures on
//! reports (`moderation`, #473) are modes of the binary, never routes, and
//! each argues there why.

/// The words a command line names beside `flag`, when an argument starts
/// with it; `None` when none does, which starts the service, as every command
/// line without it always has.
///
/// ANYTHING STARTING WITH THE FLAG SELECTS THE MODE, deliberately: a near
/// miss such as `--flag=x` lands in the mode naming nothing and is refused
/// there, where treating it as no flag would start a second service. Options
/// are left out of what is named, so that `--all`, `--yes` or `--force` arrive
/// as nothing named, and are refused for it.
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
