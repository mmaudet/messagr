# Le prototype, et ce qu'il fait autorité sur

`messagr-prototype-v3.html` est l'export de « Messagr Prototype V3 » depuis le
projet de design. Il dessine quarante et un écrans — la liste des
conversations, la conversation, l'invitation, la confiance et le QR, les
appels, les réglages, la récupération, l'effacement — et il est la référence
d'ergonomie des tickets du lot produit.

## Comment le lire

Ouvrez-le dans un navigateur. Le fichier est au format `.dc.html` : il a
besoin de `support.js`, le moteur du canvas de design, qui n'est **pas** dans
ce dépôt. Sans lui, le fichier reste lisible comme source — c'est du HTML
avec les styles en ligne — mais il ne s'anime pas. Pour le voir tourner,
passez par le projet de design lui-même.

Cette absence est délibérée : `support.js` et `image-slot.js` sont l'outillage
du canvas, régénérés en amont et sans rapport avec le produit. Les recopier
ici reviendrait à versionner le moteur de quelqu'un d'autre.

## Le partage d'autorité avec `design/tokens.json`

Les deux ne disent pas la même chose et ne se départagent pas au cas par cas :

- **`design/tokens.json` fait autorité sur les valeurs.** Couleurs, corps,
  interlignes, rayons, entailles, planchers. C'est lui qui est compilé en
  `packages/app/src/design/tokens.ts`, lui qui porte les planchers §13.17, et
  lui que le lint fait respecter. Il est en 3.1.0, c'est-à-dire **en avance**
  sur le `tokens.json` exporté à côté du prototype, qui est en 3.0.0 : ne
  réimportez pas ce dernier par-dessus.
- **Le prototype fait autorité sur la disposition.** Ce qui est à côté de
  quoi, dans quel ordre, à quelle densité, et ce qu'un geste déclenche.

Là où le prototype montre une couleur ou un corps qui n'est pas dans les
tokens, ce sont les tokens qui ont raison et le prototype qui a vieilli.
L'inverse n'arrive pas : une disposition n'a pas de version.

## Ce qu'il n'est pas

Ce n'est pas une spécification, et il ne remplace pas `docs/product-spec.md`.
Il ne dit rien de ce qui se passe quand le réseau tombe, quand une clé
manque, ou quand un message ne se déchiffre pas — le produit a des états que
le prototype ne dessine pas, et les inventer d'après lui serait le lire pour
ce qu'il n'est pas.
