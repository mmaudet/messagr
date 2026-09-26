//! Masking the numbers of address-book discovery (#392, ADR 0014, #396).
//!
//! The oblivious pseudorandom function of RFC 9497, suite ristretto255-SHA512,
//! in its verifiable mode. The service masks in two ways with the same key:
//!
//! - **directly**, a number it holds in clear for a moment, while a proof is
//!   being made: RFC 9497's `Evaluate`. The mask is what the service keeps;
//!   the number is forgotten.
//! - **blind**, a batch of elements a device sent: the service cannot read
//!   them, returns them evaluated, and adds one batch proof for all of them
//!   (the RFC's DLEQ proof, not the proof of a number), which the device
//!   checks against the published public key.
//!
//! A device that unblinds a blind evaluation obtains the very mask the direct
//! evaluation gives: the RFC's test vectors pin both halves to the byte.
//!
//! # THE KEYS NEVER LIVE IN THE DATABASE
//!
//! They come from the host's environment, like the service's other secrets,
//! each with its key number so that two can serve together while one replaces
//! the other; `config` reads them. Nothing here prints one: `MaskingKey` has
//! its own `Debug`, because the library's would print the secret scalar.

use data_encoding::HEXLOWER;
use rand::{CryptoRng, RngCore};
use voprf::{BlindedElement, Group, Ristretto255, VoprfServer};

/// Why a masking could not be done. None carries a key, an element or a
/// number.
#[derive(Debug, thiserror::Error)]
pub enum MaskingError {
    #[error("a masking key could not be derived from its seed")]
    Derivation,
    #[error("a batch to mask is empty")]
    EmptyBatch,
    #[error("an element to mask is not a point of the group")]
    NotAnElement,
    #[error("the masking failed")]
    Evaluation,
}

/// One masking key: its key number, and the server of RFC 9497 it drives.
///
/// Neither `Clone` nor `Copy`: the secret scalar is held once, and whoever
/// needs a key borrows it from `MaskingKeys`, which the configuration shares
/// behind an `Arc`.
pub struct MaskingKey {
    id: u32,
    server: VoprfServer<Ristretto255>,
}

/// What the service returns for a batch a device sent: each element evaluated,
/// and one batch proof for all of them.
pub struct MaskedBatch {
    pub evaluated: Vec<[u8; 32]>,
    pub batch_proof: [u8; 64],
}

impl MaskingKey {
    /// The key of this key number and this seed. The two together make the
    /// key: the same seed under another number is another key.
    pub fn from_seed(id: u32, seed: &[u8; 32]) -> Result<Self, MaskingError> {
        Self::derive(id, seed, &info_for(id))
    }

    /// The key RFC 9497's `DeriveKeyPair` gives for this seed and this `info`.
    fn derive(id: u32, seed: &[u8], info: &[u8]) -> Result<Self, MaskingError> {
        let server = VoprfServer::<Ristretto255>::new_from_seed(seed, info)
            .map_err(|_| MaskingError::Derivation)?;
        Ok(Self { id, server })
    }

    pub fn id(&self) -> u32 {
        self.id
    }

    /// What devices check every masked batch against, and what tells them
    /// that the key changed.
    pub fn public_key(&self) -> [u8; 32] {
        Ristretto255::serialize_elem(self.server.get_public_key()).into()
    }

    /// Masks a number the service holds in clear for a moment: RFC 9497's
    /// `Evaluate`. The same mask a device obtains by unblinding.
    // Its caller is the proof of a number (#397).
    #[allow(dead_code)]
    pub fn mask(&self, input: &[u8]) -> Result<[u8; 64], MaskingError> {
        let output = self
            .server
            .evaluate(input)
            .map_err(|_| MaskingError::Evaluation)?;
        Ok(output.into())
    }

    /// Masks a batch of blinded elements a device sent, with one batch proof
    /// for all of them. Any element that is not a point of the group refuses
    /// the batch: nothing is evaluated.
    // Its caller is a device looking for its own contacts (#400).
    #[allow(dead_code)]
    pub fn mask_blinded<R: RngCore + CryptoRng>(
        &self,
        rng: &mut R,
        blinded: &[Vec<u8>],
    ) -> Result<MaskedBatch, MaskingError> {
        if blinded.is_empty() {
            return Err(MaskingError::EmptyBatch);
        }
        let elements = blinded
            .iter()
            .map(|b| BlindedElement::<Ristretto255>::deserialize(b))
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| MaskingError::NotAnElement)?;
        let result = self
            .server
            .batch_blind_evaluate(rng, &elements)
            .map_err(|_| MaskingError::Evaluation)?;
        Ok(MaskedBatch {
            evaluated: result
                .messages
                .iter()
                .map(|m| m.serialize().into())
                .collect(),
            batch_proof: result.proof.serialize().into(),
        })
    }
}

/// The library's `Debug` would print the secret scalar: this one prints the
/// key number and the public key, which is published anyway.
impl std::fmt::Debug for MaskingKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MaskingKey")
            .field("id", &self.id)
            .field("public_key", &HEXLOWER.encode(&self.public_key()))
            .finish()
    }
}

/// The keys in service. Two serve together while one replaces the other, and
/// the highest key number is the current one.
#[derive(Debug)]
pub struct MaskingKeys {
    /// Sorted by key number, never empty.
    keys: Vec<MaskingKey>,
}

impl MaskingKeys {
    /// The keys, or nothing when there are none: a setting that names no key
    /// is not a set of keys. Each key number is expected once; `config`
    /// refuses a setting that repeats one.
    pub fn new(mut keys: Vec<MaskingKey>) -> Option<Self> {
        if keys.is_empty() {
            return None;
        }
        keys.sort_by_key(|k| k.id);
        Some(Self { keys })
    }

    /// The key new masks are made with: the highest key number.
    pub fn current(&self) -> &MaskingKey {
        self.keys.last().expect("`new` refuses an empty set")
    }

    // Its callers are the routes of discovery (#397, #400).
    #[allow(dead_code)]
    pub fn get(&self, id: u32) -> Option<&MaskingKey> {
        self.keys.iter().find(|k| k.id == id)
    }

    pub fn len(&self) -> usize {
        self.keys.len()
    }
}

/// Binds each derivation to its key number, so that two key numbers given the
/// same seed by mistake still make two keys.
fn info_for(id: u32) -> Vec<u8> {
    format!("messagr masking key {id}").into_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A random source that yields one chosen scalar, as RFC 9497's vectors
    /// fix the proof's randomness. The library draws 64 bytes and reduces
    /// them: the scalar's 32 bytes followed by zeros reduce to the scalar.
    struct Fixed([u8; 32]);

    impl RngCore for Fixed {
        fn next_u32(&mut self) -> u32 {
            unimplemented!("only fill_bytes is drawn from")
        }
        fn next_u64(&mut self) -> u64 {
            unimplemented!("only fill_bytes is drawn from")
        }
        fn fill_bytes(&mut self, dest: &mut [u8]) {
            dest.fill(0);
            let n = dest.len().min(32);
            dest[..n].copy_from_slice(&self.0[..n]);
        }
        fn try_fill_bytes(&mut self, dest: &mut [u8]) -> Result<(), rand::Error> {
            self.fill_bytes(dest);
            Ok(())
        }
    }

    impl CryptoRng for Fixed {}

    fn hex(s: &str) -> Vec<u8> {
        HEXLOWER.decode(s.as_bytes()).unwrap()
    }

    fn scalar(s: &str) -> [u8; 32] {
        hex(s).try_into().unwrap()
    }

    // RFC 9497, appendix A.1.2: VOPRF mode, ristretto255-SHA512.
    const SEED: &str = "a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3a3";
    const KEY_INFO: &str = "74657374206b6579";
    const PK_SM: &str = "c803e2cc6b05fc15064549b5920659ca4a77b2cca6f04f6b357009335476ad4e";
    const INPUT_1: &str = "00";
    const INPUT_2: &str = "5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a";
    const BLINDED_1: &str = "863f330cc1a1259ed5a5998a23acfd37fb4351a793a5b3c090b642ddc439b945";
    const BLINDED_2: &str = "cc0b2a350101881d8a4cba4c80241d74fb7dcbfde4a61fde2f91443c2bf9ef0c";
    const EVALUATED_1: &str = "aa8fa048764d5623868679402ff6108d2521884fa138cd7f9c7669a9a014267e";
    const EVALUATED_2: &str = "60a59a57208d48aca71e9e850d22674b611f752bed48b36f7a91b372bd7ad468";
    const PROOF_1: &str = "ddef93772692e535d1a53903db24367355cc2cc78de93b3be5a8ffcc6985dd06\
                           6d4346421d17bf5117a2a1ff0fcb2a759f58a539dfbe857a40bce4cf49ec600d";
    const PROOF_2: &str = "401a0da6264f8cf45bb2f5264bc31e109155600babb3cd4e5af7d181a2c9dc0a\
                           67154fabf031fd936051dec80b0b6ae29c9503493dde7393b722eafdf5a50b02";
    const PROOF_RANDOM: &str = "222a5e897cf59db8145db8d16e597e8facb80ae7d4e26d9881aa6f61d645fc0e";
    const OUTPUT_1: &str = "b58cfbe118e0cb94d79b5fd6a6dafb98764dff49c14e1770b566e42402da1a7d\
                            a4d8527693914139caee5bd03903af43a491351d23b430948dd50cde10d32b3c";
    const OUTPUT_2: &str = "8a9a2f3c7f085b65933594309041fc1898d42d0858e59f90814ae90571a6df60\
                            356f4610bf816f27afdd84f47719e480906d27ecd994985890e5f539e7ea74b6";
    // Test vector 3: the batch of the two inputs above.
    const BATCH_BLINDED_2: &str =
        "90a0145ea9da29254c3a56be4fe185465ebb3bf2a1801f7124bbbadac751e654";
    const BATCH_EVALUATED_2: &str =
        "cc5ac221950a49ceaa73c8db41b82c20372a4c8d63e5dded2db920b7eee36a2a";
    const BATCH_PROOF: &str = "cc203910175d786927eeb44ea847328047892ddf8590e723c37205cb74600b0a\
                               5ab5337c8eb4ceae0494c2cf89529dcf94572ed267473d567aeed6ab873dee08";
    const BATCH_PROOF_RANDOM: &str =
        "419c4f4f5052c53c45f3da494d2b67b220d02118e0857cdbcf037f9ea84bbe0c";

    fn rfc_key() -> MaskingKey {
        MaskingKey::derive(1, &hex(SEED), &hex(KEY_INFO)).unwrap()
    }

    #[test]
    fn the_key_derived_from_the_rfc_seed_has_the_rfc_public_key() {
        assert_eq!(rfc_key().public_key().to_vec(), hex(PK_SM));
    }

    #[test]
    fn masking_a_number_directly_gives_the_rfc_output() {
        let key = rfc_key();
        assert_eq!(key.mask(&hex(INPUT_1)).unwrap().to_vec(), hex(OUTPUT_1));
        assert_eq!(key.mask(&hex(INPUT_2)).unwrap().to_vec(), hex(OUTPUT_2));
    }

    #[test]
    fn masking_one_blinded_element_gives_the_rfc_element_and_batch_proof() {
        let key = rfc_key();
        for (blinded, evaluated, proof) in [
            (BLINDED_1, EVALUATED_1, PROOF_1),
            (BLINDED_2, EVALUATED_2, PROOF_2),
        ] {
            let batch = key
                .mask_blinded(&mut Fixed(scalar(PROOF_RANDOM)), &[hex(blinded)])
                .unwrap();
            assert_eq!(batch.evaluated.len(), 1);
            assert_eq!(batch.evaluated[0].to_vec(), hex(evaluated));
            assert_eq!(batch.batch_proof.to_vec(), hex(proof));
        }
    }

    #[test]
    fn masking_a_batch_gives_one_batch_proof_for_all_of_it() {
        let batch = rfc_key()
            .mask_blinded(
                &mut Fixed(scalar(BATCH_PROOF_RANDOM)),
                &[hex(BLINDED_1), hex(BATCH_BLINDED_2)],
            )
            .unwrap();
        assert_eq!(batch.evaluated[0].to_vec(), hex(EVALUATED_1));
        assert_eq!(batch.evaluated[1].to_vec(), hex(BATCH_EVALUATED_2));
        assert_eq!(batch.batch_proof.to_vec(), hex(BATCH_PROOF));
    }

    #[test]
    fn an_element_that_is_not_a_point_is_refused() {
        let refused = rfc_key().mask_blinded(&mut Fixed(scalar(PROOF_RANDOM)), &[vec![0xff; 32]]);
        assert!(refused.is_err());
        let short = rfc_key().mask_blinded(&mut Fixed(scalar(PROOF_RANDOM)), &[vec![0; 31]]);
        assert!(short.is_err());
    }

    #[test]
    fn the_keys_are_known_by_their_key_number() {
        let key = |id, byte| MaskingKey::from_seed(id, &[byte; 32]).unwrap();
        let keys = MaskingKeys::new(vec![key(2, 0x02), key(1, 0x01)]).unwrap();

        assert_eq!(
            keys.current().id(),
            2,
            "the highest key number is the current key"
        );
        assert_eq!(keys.get(1).map(MaskingKey::id), Some(1));
        assert!(keys.get(3).is_none());
        assert_ne!(
            keys.get(1).unwrap().public_key(),
            keys.get(2).unwrap().public_key()
        );
        assert!(MaskingKeys::new(Vec::new()).is_none(), "no key, no set");
    }

    #[test]
    fn the_same_seed_under_another_key_number_is_another_key() {
        let seed = [0x01; 32];
        assert_ne!(
            MaskingKey::from_seed(1, &seed).unwrap().public_key(),
            MaskingKey::from_seed(2, &seed).unwrap().public_key()
        );
    }

    #[test]
    fn a_key_never_prints_its_secret() {
        let key = MaskingKey::derive(7, &[0x42; 32], b"info").unwrap();
        let printed = format!("{key:?}");
        assert!(printed.contains("id: 7"), "the number is shown: {printed}");
        // What the library's own `Debug` prints: `sk: Scalar { bytes: [...] }`.
        assert!(!printed.contains("sk:"), "{printed}");
        assert!(!printed.contains("Scalar"), "{printed}");
    }
}
