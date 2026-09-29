//! A report as the service holds it (#462, #464, #468): its number, its
//! reason, and its sealed report, kept as it came and never opened. What a
//! report carries reaches the service sealed for the operator key (ADR 0015):
//! the number and the reason are all an alert tells of it.
//!
//! The route that receives reports is `handlers::reports`.

use data_encoding::BASE64;
use rand::Rng;

/// The strong suffix's alphabet (`design/tokens.json`, `identifier`): no `0`,
/// `O`, `1` or `I`, so that a number read aloud or typed back is not mistaken.
const ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/// The first byte of every sealed report: its format's number
/// (`packages/app/src/runtime/reportFormat.ts`, which writes the format).
const SEALED_FORMAT: u8 = 0x01;
/// What a sealed report carries beside its blocks: the format's number, the
/// 32-byte key HPKE encapsulates (X25519), and the 16-byte tag of
/// ChaCha20-Poly1305.
const SEALED_OVERHEAD: usize = 1 + 32 + 16;
/// The payload is padded to a whole number of these, so that its length says
/// little of what it holds.
const SEALED_BLOCK: usize = 4096;
/// The most blocks a sealed report may hold: 65,535 bytes of payload.
const SEALED_MOST_BLOCKS: usize = 16;

/// A report number: eight characters of the strong suffix's alphabet, shown
/// grouped by four, `K7QM-4ZT2` (#462). Typed back in any case, with a
/// hyphen, a space or nothing between the groups: it is copied into an email
/// and read out to the operator (#375).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ReportNumber([u8; 8]);

impl ReportNumber {
    /// A number drawn at random, each of its eight characters from the
    /// alphabet: forty bits, so that two reports seldom draw the same one,
    /// and the route that keeps them draws again when they do
    /// (`handlers::reports`).
    pub fn draw() -> ReportNumber {
        let mut rng = rand::thread_rng();
        ReportNumber(std::array::from_fn(|_| {
            ALPHABET[rng.gen_range(0..ALPHABET.len())]
        }))
    }

    /// The number `typed` stands for, or `None` for anything else.
    #[cfg_attr(
        not(test),
        expect(dead_code, reason = "the operator's modes of #473 read it typed back")
    )]
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

/// A sealed report, as `reportFormat.ts` writes it, and as it came: the
/// service keeps its bytes and cannot open them. Only the operator does, on
/// its own machine (ADR 0015).
#[derive(Debug, PartialEq, Eq)]
pub struct SealedReport(Vec<u8>);

impl SealedReport {
    /// The sealed report `text` carries in standard base64 with its padding
    /// (RFC 4648, section 4), or `None` for anything else: another alphabet,
    /// a space or a line, missing padding, bits left over after the last
    /// byte, another format's number, or a size that is not 49 bytes and one
    /// to sixteen blocks.
    pub fn from_base64(text: &str) -> Option<SealedReport> {
        let bytes = BASE64.decode(text.as_bytes()).ok()?;
        let blocks = bytes.len().checked_sub(SEALED_OVERHEAD)?;
        let of_the_format = bytes.first() == Some(&SEALED_FORMAT)
            && blocks % SEALED_BLOCK == 0
            && (1..=SEALED_MOST_BLOCKS).contains(&(blocks / SEALED_BLOCK));
        of_the_format.then_some(SealedReport(bytes))
    }

    /// Its bytes, as they came.
    pub fn bytes(&self) -> &[u8] {
        &self.0
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
    fn a_number_is_drawn_from_the_whole_alphabet_and_nothing_else() {
        // #462: eight characters of the strong suffix, without 0, O, 1 or I,
        // grouped by four. Drawn at random: a thousand draws cover the
        // thirty-two characters, and repeat none.
        let alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        let drawn: Vec<String> = (0..1000)
            .map(|_| ReportNumber::draw().to_string())
            .collect();
        for number in &drawn {
            let (first, second) = number.split_once('-').expect(number);
            for group in [first, second] {
                assert_eq!(group.len(), 4, "{number}");
                assert!(group.chars().all(|c| alphabet.contains(c)), "{number}");
            }
            assert_eq!(
                ReportNumber::parse(number).map(|n| n.to_string()).as_ref(),
                Some(number)
            );
        }
        for character in alphabet.chars() {
            assert!(
                drawn.iter().any(|number| number.contains(character)),
                "{character} is never drawn"
            );
        }
        let distinct: std::collections::HashSet<&String> = drawn.iter().collect();
        assert_eq!(distinct.len(), drawn.len());
    }

    /// A sealed report as `reportFormat.ts` lays one out: the format's
    /// number, a 32-byte encapsulated key, then `blocks` blocks of 4,096
    /// bytes and the 16-byte tag, every byte after the first `fill`.
    fn sealed_of(blocks: usize, fill: u8) -> Vec<u8> {
        let mut bytes = vec![0x01];
        bytes.resize(1 + 32 + blocks * 4096 + 16, fill);
        bytes
    }

    #[test]
    fn a_sealed_report_is_taken_as_it_came_from_one_block_to_sixteen() {
        // 49 + 4,096 × k bytes for k blocks (`reportFormat.ts`), and at most
        // sixteen: 65,535 bytes of payload.
        for blocks in [1, 2, 16] {
            let sealed = sealed_of(blocks, 7);
            let taken = SealedReport::from_base64(&BASE64.encode(&sealed));
            assert_eq!(
                taken.as_ref().map(|s| s.bytes()),
                Some(&sealed[..]),
                "{blocks} blocks"
            );
        }
    }

    #[test]
    fn a_sealed_report_the_format_does_not_write_is_refused() {
        let one_block = BASE64.encode(&sealed_of(1, 7));
        // The last group of four holds the last two bytes, 0x07 0x07: its
        // third character carries two bits beyond them, zero in the one
        // spelling standard base64 has.
        assert!(
            one_block.ends_with("Bwc="),
            "{}",
            &one_block[one_block.len() - 4..]
        );
        let with_its_last_bits_set = format!("{}Bwd=", &one_block[..one_block.len() - 4]);
        // 0xfb three times is `+/v7`: the characters another alphabet writes
        // `-_`.
        let url_safe = BASE64
            .encode(&sealed_of(1, 0xfb))
            .replace('+', "-")
            .replace('/', "_");
        let mut another_format = sealed_of(1, 7);
        another_format[0] = 0x02;
        let refused = [
            ("not base64".to_string(), "!!!!".to_string()),
            ("another alphabet".into(), url_safe),
            (
                "without its padding".into(),
                one_block.trim_end_matches('=').into(),
            ),
            (
                "cut by a line".into(),
                format!("{}\n{}", &one_block[..64], &one_block[64..]),
            ),
            ("its last bits set".into(), with_its_last_bits_set),
            (
                "another format's number".into(),
                BASE64.encode(&another_format),
            ),
            ("nothing".into(), String::new()),
            ("48 bytes".into(), BASE64.encode(&sealed_of(1, 7)[..48])),
            ("no block".into(), BASE64.encode(&sealed_of(0, 7))),
            (
                "a block short of a byte".into(),
                BASE64.encode(&sealed_of(1, 7)[..4144]),
            ),
            (
                "a block and a byte".into(),
                BASE64.encode(&[sealed_of(1, 7), vec![7]].concat()),
            ),
            ("seventeen blocks".into(), BASE64.encode(&sealed_of(17, 7))),
        ];
        for (what, text) in refused {
            assert_eq!(SealedReport::from_base64(&text), None, "{what}");
        }
    }

    #[test]
    fn a_child_in_danger_and_a_threat_to_a_life_come_first() {
        // #462: « les motifs urgents en tête (pédocriminalité, menace) ».
        let urgent: Vec<Reason> = Reason::ALL.into_iter().filter(|r| r.is_urgent()).collect();
        assert_eq!(urgent, [Reason::ChildSexualAbuse, Reason::Threat]);
    }
}
