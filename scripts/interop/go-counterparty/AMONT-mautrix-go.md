# L'amont a déjà corrigé, et aucune version publiée ne le porte

Ce fichier disait comment envoyer une pull request chez `mautrix/go`. Ce
n'est plus la chose à faire : **le correctif y est depuis le 25 août 2026**,
et il est exactement celui qui était écrit ici.

```
300ee8dcde80  2026-08-25  crypto/account: fix otk signatures on jsonv2
```

Vérifié en clonant l'amont : `crypto/account.go` sur `main` construit
maintenant la clé avec `IsSigned: true` et ne repose plus le drapeau après
la signature. Envoyer la pull request écrite ici aurait proposé un
correctif déjà appliqué.

## Pourquoi nous étions bloqués quand même

Parce qu'il n'est dans **aucune version publiée**.

|                                  | date         |
| -------------------------------- | ------------ |
| `v0.30.0`, la dernière étiquette | 16 août 2026 |
| le correctif                     | 25 août 2026 |

Neuf jours d'écart, et aucune étiquette depuis. `go.mod` épinglait
`v0.30.0`, donc la contrepartie Go embarquait la bibliothèque d'avant le
correctif. Le défaut était corrigé en amont et présent chez nous.

C'est la forme d'impasse la plus coûteuse à diagnostiquer : chercher dans
le dépôt de quelqu'un d'autre un défaut qu'il a déjà réparé.

## Ce que nous avons fait

Épinglé la pseudo-version du commit qui porte le correctif, plutôt qu'une
étiquette qui ne le porte pas :

```
maunium.net/go/mautrix v0.30.1-0.20260825124633-300ee8dcde80
```

Le commit exact et non la tête de `main` : c'est le minimum qui débloque,
et il n'emporte pas les semaines de changements qui ont suivi.

**Le jour où une version paraît**, passer dessus et supprimer ce fichier.
Une pseudo-version est une dette lisible, et elle doit rester lisible.

## Le défaut, pour qui lira le journal d'un ancien lot

`getOneTimeKeys` signait une `OneTimeKey` **avant** de poser `IsSigned`.
`OneTimeKey.MarshalJSON` rend la chaîne nue tant que le drapeau est faux, et
l'objet entier une fois qu'il est vrai.

```
ce qui était signé : "AAAA…"
ce qui était envoyé : {"key":"AAAA…","signatures":{…}}
```

La signature couvrait un message différent de l'objet auquel elle était
attachée. Tout client qui vérifie refuse, ne peut pas ouvrir de session
Olm, et répond `m.room_key.withheld` avec `m.no_olm`, ce qui est le bon
comportement de sa part.

## Pourquoi ce dépôt n'a pas contourné

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

Un contournement aurait donc laissé une contrepartie dont les clés sont à
moitié fausses. Attendre était juste ; chercher où attendre l'était moins.

## Ce que ça débloque

Les critères 1 et 3 de #58 tenaient déjà : la contrepartie porte une
identité de signature croisée et un appareil signé par elle, et son
chiffrement n'est ni `matrix-sdk-crypto`, ni vodozemac, ni libolm. Le
critère 2, l'aller-retour complet, attendait cette ligne de `go.mod`.
