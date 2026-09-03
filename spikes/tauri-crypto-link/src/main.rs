//! Does the crypto core link into a Tauri binary and encrypt an event?
//!
//! That is the whole question. The product specification's desktop section is
//! normative and rests on one claim -- that the same Rust crate serving mobile
//! is linked directly into the desktop binary -- and no such binding existed
//! when this was written. This is the falsifier.
//!
//! It runs inside Tauri's `setup` hook rather than in `main` before the app is
//! built, so what is proven is the crate working inside a running Tauri
//! application, not merely two things compiled into one executable. The window
//! is configured invisible and the process exits as soon as there is a verdict:
//! nobody should have to click anything to learn the answer.
//!
//! Not product code. See README.md.

use std::process::ExitCode;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use matrix_crypto_core::{
    create_machine, encrypt_event, in_runtime, share_scope_key, MachineConfig,
};

const USER: &str = "@spike:example.org";
const DEVICE: &str = "SPIKEDEVICE";
const SCOPE: &str = "!spike:example.org";
const PAYLOAD: &str = r#"{"body":"encrypted inside a tauri binary","msgtype":"m.text"}"#;

/// What the spike learned, in the shape the report needs: either a ciphertext
/// that could only exist if the crate linked and ran, or the specific reason
/// it could not be produced.
enum Verdict {
    Encrypted { algorithm: String, ciphertext_len: usize },
    Failed { at: &'static str, reason: String },
}

fn run_crypto() -> Verdict {
    let dir = match tempfile::tempdir() {
        Ok(dir) => dir,
        Err(error) => {
            return Verdict::Failed { at: "tempdir", reason: error.to_string() };
        }
    };
    let store_path = dir.path().join("store").to_string_lossy().into_owned();

    futures::executor::block_on(in_runtime(async move {
        if let Err(error) = create_machine(MachineConfig {
            user_id: USER.to_string(),
            device_id: DEVICE.to_string(),
            store_path,
            store_passphrase: Some("spike-passphrase".to_string()),
        })
        .await
        {
            return Verdict::Failed { at: "create_machine", reason: format!("{error:?}") };
        }

        // Required, and the spike learned that the hard way: called without
        // it, `encrypt_event` does not return an error, it panics inside
        // upstream's own group session manager ("Session wasn't created nor
        // shared", matrix-sdk-crypto 0.18.0
        // session_manager/group_sessions/mod.rs:218) and, on a tokio worker,
        // that abort takes the process with it. Recorded in the report: it is
        // a finding about the crate's API, not about Tauri.
        //
        // Only this machine's own user: a spike with no homeserver has no
        // peer devices to share with, and this is enough for the outbound
        // session to exist.
        if let Err(error) = share_scope_key(SCOPE, &[USER.to_string()]).await {
            return Verdict::Failed { at: "share_scope_key", reason: format!("{error:?}") };
        }

        match encrypt_event(SCOPE, "m.room.message", PAYLOAD).await {
            // The envelope is already structured, so nothing is parsed back
            // out of it. The ciphertext is only measured, never printed: it
            // is real output from a real Megolm session, and a spike has no
            // business putting it on a terminal.
            Ok(envelope) => Verdict::Encrypted {
                algorithm: envelope.algorithm,
                ciphertext_len: envelope.ciphertext.len(),
            },
            Err(error) => Verdict::Failed { at: "encrypt_event", reason: format!("{error:?}") },
        }
    }))
}

fn report(verdict: &Verdict) -> bool {
    match verdict {
        Verdict::Encrypted { algorithm, ciphertext_len } => {
            println!("SPIKE RESULT: linked and encrypted");
            println!("  algorithm:      {algorithm}");
            println!("  ciphertext len: {ciphertext_len}");
            true
        }
        Verdict::Failed { at, reason } => {
            println!("SPIKE RESULT: did not encrypt");
            println!("  failed at: {at}");
            println!("  reason:    {reason}");
            false
        }
    }
}

fn main() -> ExitCode {
    // Shared rather than captured by reference: tauri's setup closure must be
    // 'static and Send, so it cannot borrow a local. The verdict still has to
    // outlive the app, because `run` hands back only `()` and the exit code is
    // what a script reads.
    let succeeded = Arc::new(AtomicBool::new(false));
    let from_setup = Arc::clone(&succeeded);

    tauri::Builder::default()
        .setup(move |app| {
            let verdict = run_crypto();
            from_setup.store(report(&verdict), Ordering::SeqCst);
            // The verdict is the whole product. Nothing here needs a window,
            // an event loop, or a second frame.
            app.handle().exit(0);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("the tauri application must start");

    if succeeded.load(Ordering::SeqCst) {
        ExitCode::SUCCESS
    } else {
        ExitCode::FAILURE
    }
}
