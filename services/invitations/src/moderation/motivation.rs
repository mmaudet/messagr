//! The motivation of a decision (#473, ADR 0015): the reasoned decision,
//! never a quotation. It is kept a year after the decision, when what was
//! said is long erased, so it names no account and copies nothing that was
//! said. That a motivation copies nothing cannot be checked; that it names no
//! account, room, event or file can, and is.

/// What a motivation is, said wherever one is asked for or refused.
pub const WHAT_A_MOTIVATION_IS: &str = "The motivation is the reasoned decision: what the \
     report shows, and which rule of the terms it breaks or does not. It is never a quotation: \
     it copies nothing that was said, and names no account, no conversation and no message.";

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
/// room or its alias, an event, or a file's address on the homeserver.
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

#[cfg(test)]
mod tests {
    use super::*;

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
            "Le signalement montre des menaces répétées, que les conditions interdisent.",
            "Rien d'interdit dans le signalement : sans suite, et la suspension est levée !",
            "Contestation reçue à conformite@messagr.eu : suspension levée.",
            "Démarchage répété, clause 3 des conditions : le retrait est maintenu.",
            "Menace de mort ! Transmis aux autorités, suspension confirmée.",
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
}
