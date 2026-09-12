# Le correctif amont, prêt à envoyer

Ce fichier existe parce que #58 est bloqué par un défaut qui n'est pas
dans ce dépôt, et que le geste qui le débloque est public : ouvrir une
pull request chez `mautrix/go`. Le patch, le texte et la reproduction sont
écrits ici pour que l'envoi soit une décision et non un chantier.

Mesuré contre `maunium.net/go/mautrix v0.30.0`, la version que
`go.mod` épingle à côté.

## Le défaut, à la ligne

`crypto/account.go`, dans `getOneTimeKeys` :

```go
for keyID, key := range internalKeys {
    key := mautrix.OneTimeKey{Key: key}
    signature, _ := account.SignJSON(key)
    key.Signatures = signatures.NewSingleSignature(userID, id.KeyAlgorithmEd25519, deviceID.String(), signature)
    key.IsSigned = true
    oneTimeKeys[id.NewKeyID(id.KeyAlgorithmSignedCurve25519, keyID)] = key
}
```

`OneTimeKey.MarshalJSON` (`requests.go`) rend **la chaîne nue** tant que
`IsSigned` est faux, et l'objet entier une fois qu'il est vrai. Or
`SignJSON` est appelé **avant** que le drapeau soit posé.

```
ce qui est signé : "AAAA…"
ce qui est envoyé : {"key":"AAAA…","signatures":{…}}
```

La signature couvre un message différent de l'objet auquel elle est
attachée. Tout client qui vérifie une clé à usage unique signée la refuse,
ne peut pas ouvrir de session Olm, et répond `m.room_key.withheld` avec
`m.no_olm`, ce qui est le bon comportement de sa part.

`SignJSON` supprime `signatures` et `unsigned` avant de canonicaliser
(`crypto/account.go`), donc signer avec `IsSigned` **déjà vrai** produit
une signature sur `{"key":"…"}`, qui est exactement ce que le vérificateur
recalcule. Le correctif ne change donc rien d'autre que l'ordre.

## Le patch

```diff
--- a/crypto/account.go
+++ b/crypto/account.go
@@
 	for keyID, key := range internalKeys {
-		key := mautrix.OneTimeKey{Key: key}
+		// The signature must cover what is actually uploaded.
+		// OneTimeKey.MarshalJSON emits the bare key string while IsSigned is
+		// false, so signing before setting it signs "AAAA…" while the object
+		// sent is {"key":"AAAA…"}. SignJSON strips "signatures" itself, so
+		// setting the flag first is safe and is what a verifier recomputes.
+		key := mautrix.OneTimeKey{Key: key, IsSigned: true}
 		signature, _ := account.SignJSON(key)
 		key.Signatures = signatures.NewSingleSignature(userID, id.KeyAlgorithmEd25519, deviceID.String(), signature)
-		key.IsSigned = true
 		oneTimeKeys[id.NewKeyID(id.KeyAlgorithmSignedCurve25519, keyID)] = key
 	}
```

Une ligne déplacée, un champ posé à la construction.

## Le texte de la pull request

À copier tel quel. Écrit court et en anglais simple : le lecteur est un
mainteneur pressé, et la moitié des gens qui liront ce fil ne sont pas
anglophones.

---

**Sign one-time keys over what is actually uploaded**

In `crypto/account.go`, `getOneTimeKeys` signs a `OneTimeKey` before it
sets the `IsSigned` flag.

`OneTimeKey.MarshalJSON` returns two different things. While `IsSigned` is
false it returns the bare key string. Once it is true it returns the whole
object. So the signature covers `"AAAA..."`, but what goes to
`/keys/upload` is `{"key":"AAAA...","signatures":{...}}`.

The signature does not match the object it is attached to. Any client that
checks a signed one-time key will reject it. It cannot start an Olm
session, so it answers `m.room_key.withheld` with `m.no_olm`. That is the
right thing for it to do.

Device keys are fine. `DeviceKeys` has no such flag, so only the one-time
key path is affected.

**The fix**

Set the flag when the key is built, before signing:

```go
key := mautrix.OneTimeKey{Key: key, IsSigned: true}
```

and drop the later `key.IsSigned = true`. `SignJSON` already removes
`signatures` and `unsigned` before it canonicalises, so signing with the
flag set is safe. The signed bytes are then exactly what a verifier
recomputes. Only the order changes.

**How to reproduce**

1. Log in with this library and upload one-time keys.
2. Claim one from a client that checks signatures: matrix-nio,
   matrix-sdk-crypto, or Element.

The claim works and the check fails.

One thing to know: a homeserver cannot delete a one-time key. Keys
uploaded before the fix stay claimable until they are used up.

Tested against `maunium.net/go/mautrix v0.30.0`.

---

## Pourquoi ce dépôt ne contourne pas

Signer correctement depuis l'extérieur est facile : mesuré, les 22 bonnes
clés d'un lot mixte vérifient toutes. Ce qui ne peut pas se faire depuis
l'extérieur, c'est **empêcher mautrix de téléverser son propre mauvais lot
d'abord** :

- un compte au plafond n'aide pas : `getOneTimeKeys` téléverse tout ce qui
  n'est pas publié, quel qu'ait été le nombre demandé, et un compte neuf en
  tient déjà ;
- les marquer publiées d'abord n'aide pas non plus : mesuré, le serveur a
  reçu 101 clés, dont 51 de l'amont ;
- un homeserver ne sait pas supprimer une clé à usage unique, donc le
  mauvais lot reste servi jusqu'à épuisement, et continuwuity les sert dans
  l'ordre d'insertion.

Un contournement laisserait donc une contrepartie dont les clés sont à
moitié fausses, ce qui prouve moins qu'une contrepartie dont les clés sont
fausses pour une raison que personne n'a à deviner.

## Ce que l'envoi débloque ici

`collect` échoue aujourd'hui honnêtement, et les critères 1 et 3 de #58
tiennent déjà : la contrepartie porte une identité de signature croisée et
un appareil signé par elle, et son chiffrement n'est ni
`matrix-sdk-crypto`, ni vodozemac, ni libolm. Le critère 2, l'aller-retour
complet, attend cette ligne.
