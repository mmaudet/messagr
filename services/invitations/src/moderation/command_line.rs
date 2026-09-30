//! Which gesture a command line names, and what it names (#473). Read with
//! `operator::named_after`, as the other modes of the binary are: anything
//! starting with a flag selects its gesture. Options no mode takes never get
//! here: `operator::known_arguments` refuses them first, in `main`.

use super::{Decision, Gesture};
use crate::{
    moderation::motivation::WHAT_A_MOTIVATION_IS,
    operator::{is_a_user_id, named_after},
    report::ReportNumber,
};

pub const LIST: &str = "--reports";
pub const EXPORT: &str = "--export-report";
pub const DECIDE: &str = "--decide-report";
pub const HOLD: &str = "--hold-report";
pub const RELEASE: &str = "--release-report";
pub const RECORD_TERMINATION: &str = "--record-termination";

/// Declares the flags once: the enumeration, its every value in `Flag::ALL`,
/// and each one's text. A flag is therefore in the list by construction, and
/// reading one below is a match the compiler holds whole: a flag added here
/// and not read there does not build.
macro_rules! flags {
    ($($flag:ident => $text:expr),+ $(,)?) => {
        /// The flags, one per gesture.
        #[derive(Clone, Copy, Debug, PartialEq, Eq)]
        enum Flag {
            $($flag),+
        }

        impl Flag {
            const ALL: &'static [Flag] = &[$(Flag::$flag),+];

            fn text(self) -> &'static str {
                match self {
                    $(Flag::$flag => $text),+
                }
            }
        }
    };
}

flags! {
    List => LIST,
    Export => EXPORT,
    Decide => DECIDE,
    Hold => HOLD,
    Release => RELEASE,
    RecordTermination => RECORD_TERMINATION,
}

/// The flags of the gestures on reports, which `main` counts among those the
/// binary takes (`operator::known_arguments`).
pub fn flags() -> impl Iterator<Item = &'static str> {
    Flag::ALL.iter().map(|flag| flag.text())
}

/// An account as the homeserver reads it: in lowercase. Continuwuity reads
/// an identifier in lowercase whole, so `@bob:MESSAGR.EU` is `@bob:messagr.eu`,
/// and a deletion recorded under another spelling would name no account.
pub fn as_the_homeserver_reads(account: &str) -> String {
    account.to_lowercase()
}

/// The gestures, said with every refusal of a command line.
fn usage() -> String {
    format!(
        "The operator's gestures on reports, one per run:\n\
         \x20 {LIST}                     the reports awaiting a decision, and those held\n\
         \x20 {LIST} <number>            one report, its reporting account included\n\
         \x20 {EXPORT} <number>      its sealed report, for scripts/ouvrir-un-signalement.mjs\n\
         \x20 {DECIDE} <number> <unfounded|lifted|confirmed> \"<motivation>\"\n\
         \x20   {WHAT_A_MOTIVATION_IS}\n\
         \x20 {HOLD} <number>        held for the authorities: nothing of it is erased\n\
         \x20 {RELEASE} <number>     the hold released\n\
         \x20 {RECORD_TERMINATION} <@account:server>   an account the homeserver deactivated \
         after a confirmed decision, recorded among the account deletions"
    )
}

/// The gesture a command line names: `None` when it names none of them, which
/// leaves the command line to the other modes and to the service.
pub fn the_gesture(argv: &[String]) -> Option<Result<Gesture, String>> {
    let selected: Vec<(Flag, Vec<String>)> = Flag::ALL
        .iter()
        .copied()
        .filter_map(|flag| named_after(argv, flag.text()).map(|named| (flag, named)))
        .collect();
    if selected.is_empty() {
        return None;
    }
    Some(read(argv, &selected).map_err(|why| format!("{why}\n\n{}", usage())))
}

/// The one gesture `selected` holds, and what it names.
fn read(argv: &[String], selected: &[(Flag, Vec<String>)]) -> Result<Gesture, String> {
    // ONE GESTURE PER RUN, and no other mode of the binary beside it.
    let [(flag, named)] = selected else {
        return Err("one gesture per run".into());
    };
    let other_modes = [
        crate::retire_key::THE_FLAG,
        crate::named_deactivation::THE_FLAG,
    ];
    if other_modes
        .iter()
        .any(|other| named_after(argv, other).is_some())
    {
        return Err("one gesture per run, and no other mode beside it".into());
    }
    // A NEAR MISS IS REFUSED, where `named_after` takes it for the flag:
    // `--reports=K7QM-4ZT2` would list every report instead of one.
    let text = flag.text();
    if let Some(near) = argv
        .iter()
        .skip(1)
        .find(|word| word.starts_with(text) && word.as_str() != text)
    {
        return Err(format!(
            "{near:?} is not {text}: write the flag alone, then what it names, separated by \
             spaces"
        ));
    }
    let named: Vec<&str> = named.iter().map(String::as_str).collect();
    let a_number = |typed: &str| {
        ReportNumber::parse(typed)
            .ok_or_else(|| format!("{typed:?} is not a report number, such as K7QM-4ZT2"))
    };
    let one_number = || match named[..] {
        [typed] => a_number(typed),
        _ => Err(format!("{text} names one report number, and only one")),
    };
    match flag {
        Flag::List => match named[..] {
            [] => Ok(Gesture::List),
            [typed] => a_number(typed).map(Gesture::Show),
            _ => Err(format!("{LIST} names one report number at most")),
        },
        Flag::Export => one_number().map(Gesture::Export),
        Flag::Hold => one_number().map(Gesture::Hold),
        Flag::Release => one_number().map(Gesture::Release),
        Flag::Decide => match named[..] {
            [typed, decision, motivation] => Ok(Gesture::Decide {
                number: a_number(typed)?,
                decision: Decision::from_code(decision).ok_or_else(|| {
                    format!("{decision:?} is not a decision: unfounded, lifted or confirmed")
                })?,
                motivation: motivation.to_string(),
            }),
            [_, _] => Err(format!("the motivation is missing. {WHAT_A_MOTIVATION_IS}")),
            _ => Err(format!(
                "{DECIDE} names the report number, the decision, and the motivation in quotes, \
                 one argument"
            )),
        },
        Flag::RecordTermination => match named[..] {
            [account] if is_a_user_id(&as_the_homeserver_reads(account)) => {
                Ok(Gesture::RecordTermination(as_the_homeserver_reads(account)))
            }
            [account] => Err(format!(
                "{account:?} is not a Matrix account ID, such as @localpart:messagr.eu"
            )),
            _ => Err(format!(
                "{RECORD_TERMINATION} names one account, and only one"
            )),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MOTIVATION: &str = "Harcèlement répété, que les conditions interdisent.";

    fn number(typed: &str) -> ReportNumber {
        ReportNumber::parse(typed).unwrap()
    }

    fn gesture_of(words: &[&str]) -> Option<Result<Gesture, String>> {
        let line: Vec<String> = std::iter::once("messagr-invitations")
            .chain(words.iter().copied())
            .map(String::from)
            .collect();
        the_gesture(&line)
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
        for (code, decision) in [
            ("unfounded", Decision::Unfounded),
            ("lifted", Decision::Lifted),
            ("confirmed", Decision::Confirmed),
        ] {
            assert_eq!(
                gesture_of(&["--decide-report", "K7QM-4ZT2", code, MOTIVATION]),
                Some(Ok(Gesture::Decide {
                    number: number("K7QM-4ZT2"),
                    decision,
                    motivation: MOTIVATION.into()
                }))
            );
        }
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
            Some(Ok(Gesture::RecordTermination("@bob:messagr.eu".into())))
        );
    }

    /// The homeserver reads an identifier in lowercase: the account is taken
    /// as it reads it, so that a deletion is recorded under the account's own
    /// name.
    #[test]
    fn an_account_is_taken_as_the_homeserver_reads_it() {
        for typed in ["@Bob:messagr.eu", "@bob:MESSAGR.EU", "@BOB:Messagr.Eu"] {
            assert_eq!(
                gesture_of(&["--record-termination", typed]),
                Some(Ok(Gesture::RecordTermination("@bob:messagr.eu".into()))),
                "{typed}"
            );
        }
    }

    /// Every flag is listed, and each one names a gesture: the list `main`
    /// counts among the binary's is the one read here.
    #[test]
    fn every_flag_is_listed_and_names_a_gesture() {
        let listed: Vec<&str> = flags().collect();
        assert_eq!(
            listed,
            [LIST, EXPORT, DECIDE, HOLD, RELEASE, RECORD_TERMINATION]
        );
        for flag in listed {
            assert!(gesture_of(&[flag]).is_some(), "{flag}");
        }
    }

    #[test]
    fn a_command_line_naming_a_gesture_badly_is_refused_rather_than_starting_the_service() {
        for words in [
            vec!["--reports", "K7QM-4ZT2", "ABCD-EFGH"],
            vec!["--reports", "@alice:h"],
            vec!["--reports=K7QM-4ZT2"],
            vec!["--reports-all"],
            vec!["--export-report"],
            vec!["--export-report", "K0QM-4ZT2"],
            vec!["--decide-report", "K7QM-4ZT2", "lifted"],
            vec!["--decide-report", "K7QM-4ZT2", "maintained", MOTIVATION],
            vec!["--decide-report", "K7QM-4ZT2", "termination", MOTIVATION],
            vec![
                "--decide-report",
                "K7QM-4ZT2",
                "lifted",
                "Harcèlement",
                "répété",
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
    fn the_help_of_a_decision_says_what_a_motivation_is_and_the_three_decisions() {
        let Some(Err(help)) = gesture_of(&["--decide-report", "K7QM-4ZT2", "lifted"]) else {
            panic!("refused");
        };
        assert!(help.contains(WHAT_A_MOTIVATION_IS), "{help}");
        assert!(help.contains("never a quotation"), "{help}");
        assert!(help.contains("<unfounded|lifted|confirmed>"), "{help}");
    }
}
