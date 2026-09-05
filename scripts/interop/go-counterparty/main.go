// A counterparty that can actually receive what this application sends.
//
// # Why this exists, and why it is not the Python one
//
// The application collects room-key recipients by identity (MSC4153) since it
// began holding a cross-signing identity of its own. `matrix-nio` has no
// cross-signing at all -- its whole surface is device-level verification -- so
// nothing vouches for its device and it is given no room key. That is the
// feature working, and it cost the outbound half of the interoperability
// proof: the Python counterparty can now only assert that it was *excluded*.
//
// This one holds a cross-signing identity, signs its own device with it, and
// is therefore included. It proves what the Python one no longer can: that an
// implementation which is not ours can read what we produce.
//
// # Why Go, and why the goolm build tag is not optional
//
// An independent counterparty exists to rule out a shared misreading of the
// protocol, so anything built on `matrix-sdk-crypto` is worthless here -- and
// that rules out `matrix-rust-sdk` and, now, `matrix-js-sdk` too. The obvious
// remaining lead was `matrix-dart-sdk`, which does cross-signing and whose
// protocol logic is genuinely separate; but its primitives come from the
// `vodozemac` package, which is the very crate the Rust stack sits on. The
// claim would have had a footnote.
//
// `mautrix-go` built with `-tags goolm` has none. `goolm` is a reimplementation
// of libolm in pure Go, so neither the protocol logic NOR the primitives are
// shared with anything this application links. Build it any other way and it
// falls back to cgo bindings against libolm, which is still independent of
// `matrix-sdk-crypto` but weaker than what this file claims -- so the tag is
// checked at run time rather than trusted, below.
//
// # The phases, and the one this exists for
//
//	login    creates the device, publishes a cross-signing identity, signs
//	         its own device with it, and confirms it is in the room. Runs
//	         BEFORE the application shares, so there is a signed device for
//	         the application's own strategy to find.
//	collect  waits for an encrypted event from the application and decrypts
//	         it. This is the proof.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"go.mau.fi/util/dbutil"
	_ "github.com/mattn/go-sqlite3"
	"maunium.net/go/mautrix"
	"maunium.net/go/mautrix/crypto/cryptohelper"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"
)

const collectDeadline = 120 * time.Second

type session struct {
	UserID      string `json:"user_id"`
	DeviceID    string `json:"device_id"`
	AccessToken string `json:"access_token"`
	Homeserver  string `json:"homeserver"`
}

func env(name string) (string, error) {
	value := os.Getenv(name)
	if value == "" {
		return "", fmt.Errorf("%s must be set", name)
	}
	return value, nil
}

func workdir() (string, error) {
	return env("MESSAGR_INTEROP_WORKDIR")
}

func sessionPath(work string) string { return filepath.Join(work, "go-counterparty-session.json") }
func storePath(work string) string   { return filepath.Join(work, "go-counterparty.db") }

func main() {
	if len(os.Args) != 2 {
		fmt.Fprintln(os.Stderr, "usage: counterparty login|collect")
		os.Exit(2)
	}
	if !builtIndependently {
		fmt.Fprintf(os.Stderr,
			"FAIL: this binary was built against %s.\n"+
				"      Build it with -tags goolm. The point of this "+
				"counterparty is that\n"+
				"      neither its protocol logic nor its primitives are "+
				"shared with the\n"+
				"      application, and without the tag the second half "+
				"stops being true.\n", cryptoBackend)
		os.Exit(1)
	}

	var err error
	switch os.Args[1] {
	case "login":
		err = login()
	case "collect":
		err = collect()
	default:
		fmt.Fprintln(os.Stderr, "usage: counterparty login|collect")
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintf(os.Stderr, "FAIL: %v\n", err)
		os.Exit(1)
	}
}

// helperFor wires an OlmMachine to a logged-in client, over a SQLite store in
// the work directory so a `collect` run sees what `login` established.
func helperFor(client *mautrix.Client, work string) (*cryptohelper.CryptoHelper, error) {
	db, err := dbutil.NewWithDialect(storePath(work), "sqlite3")
	if err != nil {
		return nil, fmt.Errorf("opening the crypto store: %w", err)
	}
	// The pickle key protects the store at rest. This counterparty's store is
	// a test artefact that lives for one run, so a constant is honest here in
	// a way it would never be in a product.
	helper, err := cryptohelper.NewCryptoHelper(client, []byte("messagr-interop"), db)
	if err != nil {
		return nil, fmt.Errorf("building the crypto helper: %w", err)
	}
	return helper, nil
}

func login() error {
	homeserver, err := env("MESSAGR_INTEROP_HOMESERVER")
	if err != nil {
		return err
	}
	userID, err := env("MESSAGR_INTEROP_USER")
	if err != nil {
		return err
	}
	password, err := env("MESSAGR_INTEROP_PASSWORD")
	if err != nil {
		return err
	}
	roomID, err := env("MESSAGR_INTEROP_ROOM")
	if err != nil {
		return err
	}
	work, err := workdir()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(work, 0o755); err != nil {
		return err
	}

	ctx := context.Background()
	client, err := mautrix.NewClient(homeserver, "", "")
	if err != nil {
		return fmt.Errorf("building the client: %w", err)
	}

	helper, err := helperFor(client, work)
	if err != nil {
		return err
	}
	helper.LoginAs = &mautrix.ReqLogin{
		Type:       mautrix.AuthTypePassword,
		Identifier: mautrix.UserIdentifier{Type: mautrix.IdentifierTypeUser, User: userID},
		Password:   password,
		DeviceID:   "",
		InitialDeviceDisplayName: "messagr-interop-counterparty-go",
	}
	if err := helper.Init(ctx); err != nil {
		return fmt.Errorf("logging in and starting the crypto machine: %w", err)
	}
	client.Crypto = helper

	machine := helper.Machine()

	// THE WHOLE POINT OF THIS COUNTERPARTY. Without an identity of its own,
	// and without this device signed by it, the application's identity-based
	// strategy has nothing to vouch for and shares no room key -- which is
	// exactly the state the Python counterparty is stuck in.
	//
	// Generate, publish, then sign, in that order and not the convenient one.
	// `GenerateAndUploadCrossSigningKeys` would do all of it in a call, and
	// it also generates a server-side secret storage key and puts the private
	// halves in it -- which needs a passphrase and user-interactive
	// authentication, and stores this throwaway account's signing keys on the
	// homeserver for no reason. This counterparty's keys should die with its
	// run.
	//
	// No UIA callback is passed, and that is a claim rather than an omission:
	// MSC3967, stable since Matrix 1.11, lets an account with no
	// cross-signing identity upload its first one without authenticating
	// again. An account that already had one would need the callback, and
	// this one never does -- it is fresh every run.
	keys, err := machine.GenerateCrossSigningKeys()
	if err != nil {
		return fmt.Errorf("generating a cross-signing identity: %w", err)
	}
	if err := machine.PublishCrossSigningKeys(ctx, keys, nil); err != nil {
		return fmt.Errorf("publishing the cross-signing identity: %w", err)
	}
	machine.CrossSigningKeys = keys
	if err := machine.SignOwnMasterKey(ctx); err != nil {
		return fmt.Errorf("signing the master key with this device: %w", err)
	}
	if err := machine.SignOwnDevice(ctx, machine.OwnIdentity()); err != nil {
		return fmt.Errorf("signing this device with the new identity: %w", err)
	}

	if _, err := client.JoinRoomByID(ctx, id.RoomID(roomID)); err != nil {
		return fmt.Errorf("joining %s: %w", roomID, err)
	}

	// PUBLISH ONE-TIME KEYS, OR NOTHING ABOVE MATTERS.
	//
	// A cross-signing identity says this device may receive a room key. It
	// does not make receiving one possible: a room key is delivered inside an
	// Olm message, and an Olm session cannot exist until the sender has
	// claimed one of this device's one-time keys. With none published, the
	// application's key sharing reaches a device it is willing to share with
	// and cannot open a channel to it.
	//
	// Measured, on the first run of this counterparty: the application sent
	// `m.room_key.withheld` with `code=m.no_olm` and "Unable to establish a
	// secure channel", and every symptom above that pointed at the identity
	// -- which was correct, published, and signing this device. A run without
	// this call fails in a way that reads as a protocol disagreement and is
	// a missing upload.
	//
	// Zero as the current count, deliberately: this device has just been
	// created and holds none, so upstream fills the server to its target
	// rather than topping up from a number nothing has measured.
	if err := machine.ShareKeys(ctx, 0); err != nil {
		return fmt.Errorf("publishing device and one-time keys: %w", err)
	}

	saved := session{
		UserID:      client.UserID.String(),
		DeviceID:    client.DeviceID.String(),
		AccessToken: client.AccessToken,
		Homeserver:  homeserver,
	}
	blob, err := json.MarshalIndent(saved, "", " ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(sessionPath(work), append(blob, '\n'), 0o600); err != nil {
		return err
	}

	fmt.Printf("PASS: %s signed in as %s, cross-signing published, keys uploaded, joined %s\n",
		saved.UserID, saved.DeviceID, roomID)
	return nil
}

func collect() error {
	roomID, err := env("MESSAGR_INTEROP_ROOM")
	if err != nil {
		return err
	}
	sender, err := env("MESSAGR_INTEROP_SENDER")
	if err != nil {
		return err
	}
	work, err := workdir()
	if err != nil {
		return err
	}

	blob, err := os.ReadFile(sessionPath(work))
	if err != nil {
		return fmt.Errorf("no session: run `login` first (%w)", err)
	}
	var saved session
	if err := json.Unmarshal(blob, &saved); err != nil {
		return err
	}

	ctx := context.Background()
	client, err := mautrix.NewClient(saved.Homeserver, id.UserID(saved.UserID), saved.AccessToken)
	if err != nil {
		return err
	}
	client.DeviceID = id.DeviceID(saved.DeviceID)

	helper, err := helperFor(client, work)
	if err != nil {
		return err
	}
	if err := helper.Init(ctx); err != nil {
		return fmt.Errorf("starting the crypto machine: %w", err)
	}
	client.Crypto = helper

	decrypted := make(chan string, 1)
	syncer := client.Syncer.(*mautrix.DefaultSyncer)

	// A key that was deliberately NOT shared says why, and the reason is the
	// difference between "the application is broken" and "the application
	// refused this counterparty on purpose". Without printing it, a run that
	// fails looks the same either way -- which is the failure mode this whole
	// counterparty exists to remove, reappearing one level up.
	syncer.OnEventType(event.ToDeviceRoomKeyWithheld, func(ctx context.Context, evt *event.Event) {
		content := evt.Content.AsRoomKeyWithheld()
		fmt.Fprintf(os.Stderr, "  %s withheld a key: code=%q reason=%q room=%s\n",
			evt.Sender, content.Code, content.Reason, content.RoomID)
	})
	syncer.OnEventType(event.EventEncrypted, func(ctx context.Context, evt *event.Event) {
		if evt.RoomID != id.RoomID(roomID) || evt.Sender != id.UserID(sender) {
			return
		}
		plain, err := helper.Decrypt(ctx, evt)
		if err != nil {
			fmt.Fprintf(os.Stderr, "  an event from %s did not decrypt yet: %v\n", sender, err)
			return
		}
		if body := plain.Content.AsMessage().Body; body != "" {
			select {
			case decrypted <- body:
			default:
			}
		}
	})

	go func() {
		if err := client.SyncWithContext(ctx); err != nil && !errors.Is(err, context.Canceled) {
			fmt.Fprintf(os.Stderr, "  sync stopped: %v\n", err)
		}
	}()

	select {
	case body := <-decrypted:
		// The claim, stated as narrowly as it is true: an implementation that
		// shares neither protocol logic nor primitives with the application
		// read what the application encrypted.
		fmt.Printf("PASS: decrypted an event from %s: %q\n", sender, body)
		return nil
	case <-time.After(collectDeadline):
		return fmt.Errorf(
			"no event from %s decrypted within %s. Either the application "+
				"never sent, or it did not share the room key with this "+
				"device -- which is what this counterparty exists to rule out",
			sender, collectDeadline)
	}
}
