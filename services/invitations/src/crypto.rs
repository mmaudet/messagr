use anyhow::{anyhow, Result};
use chacha20poly1305::{
    aead::{Aead, KeyInit, OsRng},
    ChaCha20Poly1305, Nonce,
};
use data_encoding::BASE32_NOPAD;
use rand::RngCore;
use sha2::{Digest, Sha256};

/// 20 bytes = 160 bits of entropy, beyond the 128 bits required by the spec.
/// Base32 without padding: readable aloud and typable if the QR is printed.
pub fn generate_token() -> String {
    let mut raw = [0u8; 20];
    rand::thread_rng().fill_bytes(&mut raw);
    BASE32_NOPAD.encode(&raw)
}

pub fn generate_password() -> String {
    let mut raw = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut raw);
    BASE32_NOPAD.encode(&raw)
}

/// The localpart of a dormant account: 12 characters from `[a-z2-7]`.
///
/// Lives HERE, and no longer in `MatrixClient::register_dormant`, because the
/// account name must be known to the CALLER **before** the registration: it is
/// the caller that writes the trace, and a trace cannot name what it does not
/// know. See `handlers::claim::create_account_for_claim`.
///
/// 60 bits of entropy once lowercased (the base32 alphabet `A-Z2-7` folds
/// onto 32 case-insensitive values): far beyond what is needed for two
/// reservations to never contend for a name, and the homeserver would reject
/// an `M_USER_IN_USE` anyway.
pub fn generate_localpart() -> String {
    generate_token()[..12].to_lowercase()
}

/// Bare SHA-256, no stretching: the token is 160-bit random, a dictionary
/// attack is pointless.
pub fn token_hash(token: &str) -> Vec<u8> {
    Sha256::digest(token.as_bytes()).to_vec()
}

pub fn seal(key: &[u8; 32], plaintext: &str) -> Result<Vec<u8>> {
    let cipher = ChaCha20Poly1305::new(key.into());
    let mut nonce = [0u8; 12];
    OsRng.fill_bytes(&mut nonce);
    let ct = cipher
        .encrypt(Nonce::from_slice(&nonce), plaintext.as_bytes())
        .map_err(|_| anyhow!("encryption failed"))?;
    let mut out = nonce.to_vec();
    out.extend_from_slice(&ct);
    Ok(out)
}

pub fn open(key: &[u8; 32], sealed: &[u8]) -> Result<String> {
    if sealed.len() < 12 {
        return Err(anyhow!("truncated sealed data"));
    }
    let (nonce, ct) = sealed.split_at(12);
    let cipher = ChaCha20Poly1305::new(key.into());
    let plaintext = cipher
        .decrypt(Nonce::from_slice(nonce), ct)
        .map_err(|_| anyhow!("decryption failed"))?;
    Ok(String::from_utf8(plaintext)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_token_has_the_right_shape_and_is_unique() {
        let a = generate_token();
        let b = generate_token();
        assert_eq!(a.len(), 32, "20 bytes in base32 without padding");
        assert_ne!(a, b);
        assert!(a
            .chars()
            .all(|c| "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".contains(c)));
    }

    /// The localpart goes out on the network AND serves as the key of the row
    /// written ahead: its shape is therefore a contract, not a detail. The six
    /// orphans recorded on 6 August have exactly this shape — that is what
    /// allowed them to be traced back to `register_dormant` rather than to
    /// something else.
    #[test]
    fn the_localpart_has_the_expected_shape_and_is_unique() {
        let a = generate_localpart();
        assert_eq!(a.len(), 12);
        assert_ne!(a, generate_localpart());
        assert!(
            a.chars()
                .all(|c| "abcdefghijklmnopqrstuvwxyz234567".contains(c)),
            "lowercased base32, without 0/1/8/9: {a}"
        );
    }

    #[test]
    fn the_fingerprint_is_stable_and_discriminating() {
        assert_eq!(token_hash("ABC"), token_hash("ABC"));
        assert_ne!(token_hash("ABC"), token_hash("ABD"));
        assert_eq!(token_hash("ABC").len(), 32);
    }

    #[test]
    fn encryption_round_trips() {
        let key = [7u8; 32];
        let sealed = seal(&key, "secret").unwrap();
        assert!(
            !sealed.windows(6).any(|w| w == b"secret"),
            "the plaintext must not leak"
        );
        assert_eq!(open(&key, &sealed).unwrap(), "secret");
    }

    #[test]
    fn a_wrong_key_does_not_decrypt() {
        let sealed = seal(&[7u8; 32], "secret").unwrap();
        assert!(open(&[8u8; 32], &sealed).is_err());
    }

    /// The nonce is 12 bytes (`seal`): below that, `sealed.split_at(12)` would
    /// panic without the explicit length guard at the top of `open`.
    #[test]
    fn open_rejects_an_input_shorter_than_the_nonce() {
        assert!(open(&[7u8; 32], &[0u8; 5]).is_err(), "well below 12 bytes");
        assert!(
            open(&[7u8; 32], &[0u8; 11]).is_err(),
            "a single byte under the boundary"
        );
        assert!(open(&[7u8; 32], &[]).is_err(), "empty input");
    }

    /// AEAD authentication must reject a modified ciphertext, even under the
    /// right key — that is what distinguishes an authenticated encryption from
    /// a mere encryption, and what `ReservedAccountUnusable` and consorts take
    /// for granted upstream (a secret read back must be intact or reported,
    /// never silently corrupted).
    #[test]
    fn an_altered_ciphertext_does_not_decrypt_even_under_the_right_key() {
        let key = [9u8; 32];
        let mut sealed = seal(&key, "secret").unwrap();
        let last = sealed.len() - 1;
        sealed[last] ^= 0xFF; // alters the ciphertext/tag; the nonce (first 12 bytes) stays intact
        assert!(
            open(&key, &sealed).is_err(),
            "one modified ciphertext byte must make decryption fail"
        );
    }

    /// `generate_password` had no dedicated test. Two properties: each call
    /// must produce a different value (otherwise `generate_password` could
    /// degenerate into a constant without any test noticing), and the
    /// generated password must survive the `seal`/`open` round trip intact —
    /// exactly the path it takes in production (stored encrypted, read back
    /// as needed).
    #[test]
    fn generate_password_is_unique_and_round_trips() {
        let a = generate_password();
        let b = generate_password();
        assert_ne!(a, b, "two generated passwords must not coincide");

        let key = [3u8; 32];
        let sealed = seal(&key, &a).unwrap();
        assert_eq!(
            open(&key, &sealed).unwrap(),
            a,
            "a generated password must come out of seal/open identical"
        );
    }
}
