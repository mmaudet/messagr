//! What the operator's SMS may say of a report (#462, #464): its number and
//! its reason, and nothing else. What a report carries reaches the service
//! sealed for the operator key (ADR 0015); these two are all an alert tells.
//!
//! The route of #468 draws the numbers and reads the reasons; until it does,
//! only tests build them, hence the expectation below, which fails the build
//! once it no longer holds.
#![cfg_attr(
    not(test),
    expect(dead_code, reason = "the reports route of #468 builds them")
)]

/// The strong suffix's alphabet (`design/tokens.json`, `identifier`): no `0`,
/// `O`, `1` or `I`, so that a number read aloud or typed back is not mistaken.
const ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/// A report number: eight characters of the strong suffix's alphabet, shown
/// grouped by four, `K7QM-4ZT2` (#462). Typed back in any case, with a
/// hyphen, a space or nothing between the groups: it is copied into an email
/// and read out to the operator (#375).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ReportNumber([u8; 8]);

impl ReportNumber {
    /// The number `typed` stands for, or `None` for anything else.
    pub fn parse(typed: &str) -> Option<ReportNumber> {
        let typed = typed.as_bytes();
        let (first, second) = match typed.len() {
            8 => typed.split_at(4),
            9 if matches!(typed[4], b'-' | b' ') => (&typed[..4], &typed[5..]),
            _ => return None,
        };
        let mut number = [0u8; 8];
        for (slot, byte) in number.iter_mut().zip(first.iter().chain(second)) {
            let byte = byte.to_ascii_uppercase();
            if !ALPHABET.contains(&byte) {
                return None;
            }
            *slot = byte;
        }
        Some(ReportNumber(number))
    }
}

impl std::fmt::Display for ReportNumber {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // Only bytes of the alphabet are ever kept: ASCII.
        let [a, b, c, d, e, g, h, i] = self.0.map(char::from);
        write!(f, "{a}{b}{c}{d}-{e}{g}{h}{i}")
    }
}

/// Why a report was sent: one reason per prohibition of the terms (#462).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Reason {
    /// Pédocriminalité.
    ChildSexualAbuse,
    /// Menace contre la vie ou la sécurité.
    Threat,
    /// Harcèlement.
    Harassment,
    /// Usurpation d'identité.
    Impersonation,
    /// Contenu haineux.
    Hate,
    /// Contenu sexuel imposé ou image intime diffusée sans accord.
    SexualWithoutConsent,
    /// Démarchage.
    Solicitation,
    /// Autre contenu illégal.
    OtherIllegal,
}

impl Reason {
    /// The eight, in the order of the terms.
    pub const ALL: [Reason; 8] = [
        Reason::ChildSexualAbuse,
        Reason::Threat,
        Reason::Harassment,
        Reason::Impersonation,
        Reason::Hate,
        Reason::SexualWithoutConsent,
        Reason::Solicitation,
        Reason::OtherIllegal,
    ];

    /// The code the application sends a reason by (#468). Stable: a
    /// reason's code never changes, and a code is never given to another.
    pub fn code(self) -> &'static str {
        match self {
            Reason::ChildSexualAbuse => "child_sexual_abuse",
            Reason::Threat => "threat",
            Reason::Harassment => "harassment",
            Reason::Impersonation => "impersonation",
            Reason::Hate => "hate",
            Reason::SexualWithoutConsent => "sexual_without_consent",
            Reason::Solicitation => "solicitation",
            Reason::OtherIllegal => "other_illegal",
        }
    }

    /// The reason `code` stands for, or `None` for any other text.
    pub fn from_code(code: &str) -> Option<Reason> {
        Reason::ALL.into_iter().find(|reason| reason.code() == code)
    }

    /// Whether the operator reads it first (#462): a child in danger, a
    /// threat to a life or to someone's safety.
    pub fn is_urgent(self) -> bool {
        matches!(self, Reason::ChildSexualAbuse | Reason::Threat)
    }

    /// How the operator's SMS names it, in French.
    pub fn in_an_sms(self) -> &'static str {
        match self {
            Reason::ChildSexualAbuse => "pédocriminalité",
            Reason::Threat => "menace",
            Reason::Harassment => "harcèlement",
            Reason::Impersonation => "usurpation d'identité",
            Reason::Hate => "contenu haineux",
            Reason::SexualWithoutConsent => "contenu sexuel sans accord",
            Reason::Solicitation => "démarchage",
            Reason::OtherIllegal => "autre contenu illégal",
        }
    }
}

/// Reports to tell the operator about, one at least: with none there is
/// nothing to tell.
#[derive(Debug)]
pub struct Reports(Vec<(ReportNumber, Reason)>);

impl Reports {
    /// `None` for no report.
    pub fn new(reports: Vec<(ReportNumber, Reason)>) -> Option<Reports> {
        (!reports.is_empty()).then_some(Reports(reports))
    }

    pub fn count(&self) -> usize {
        self.0.len()
    }

    /// Every report, the urgent ones first, each group in the order given.
    pub fn urgent_first(&self) -> impl Iterator<Item = &(ReportNumber, Reason)> {
        let urgent = self.0.iter().filter(|(_, reason)| reason.is_urgent());
        urgent.chain(self.0.iter().filter(|(_, reason)| !reason.is_urgent()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_report_number_is_eight_characters_of_the_strong_suffix_grouped_by_four() {
        // #462: the strong suffix's alphabet, without 0, O, 1 or I, grouped
        // by four, and typed back in any case (#375).
        for typed in [
            "K7QM-4ZT2",
            "k7qm-4zt2",
            "K7qm-4Zt2",
            "K7QM 4ZT2",
            "K7QM4ZT2",
        ] {
            let number = ReportNumber::parse(typed).unwrap_or_else(|| panic!("{typed}"));
            assert_eq!(number.to_string(), "K7QM-4ZT2", "{typed}");
        }
        assert_eq!(
            ReportNumber::parse("ABCD-EFGH").map(|n| n.to_string()),
            Some("ABCD-EFGH".into())
        );
        assert_eq!(
            ReportNumber::parse("2345-6789").map(|n| n.to_string()),
            Some("2345-6789".into())
        );
    }

    #[test]
    fn a_report_number_refuses_anything_else() {
        for typed in [
            "",
            "K7QM-4ZT",
            "K7QM-4ZT22",
            "K0QM-4ZT2",
            "KOQM-4ZT2",
            "K1QM-4ZT2",
            "KIQM-4ZT2",
            "K7Q-M4ZT2",
            "K7QM--4ZT2",
            "K7QM_4ZT2",
            "K7QM-4ZTÉ",
            "@alice:h",
            "@al:h",
            "+33612345678",
        ] {
            assert_eq!(ReportNumber::parse(typed), None, "{typed:?}");
        }
    }

    #[test]
    fn the_eight_reasons_of_the_terms_have_stable_codes() {
        // #462 lists them, one per prohibition of the terms. The codes are
        // what the application sends (#468): they never change.
        let codes: Vec<&str> = Reason::ALL.iter().map(|r| r.code()).collect();
        assert_eq!(
            codes,
            [
                "child_sexual_abuse",
                "threat",
                "harassment",
                "impersonation",
                "hate",
                "sexual_without_consent",
                "solicitation",
                "other_illegal",
            ]
        );
        for reason in Reason::ALL {
            assert_eq!(Reason::from_code(reason.code()), Some(reason));
        }
        for unknown in ["", "Threat", "spam", "other"] {
            assert_eq!(Reason::from_code(unknown), None, "{unknown}");
        }
    }

    #[test]
    fn a_child_in_danger_and_a_threat_to_a_life_come_first() {
        // #462: « les motifs urgents en tête (pédocriminalité, menace) ».
        let urgent: Vec<Reason> = Reason::ALL.into_iter().filter(|r| r.is_urgent()).collect();
        assert_eq!(urgent, [Reason::ChildSexualAbuse, Reason::Threat]);
    }
}
