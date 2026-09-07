# Publier sur TestFlight

Le pendant iOS de `publishing-android.md`, et il commence plus bas : l'Android
avait déjà sa machinerie quand ce document a été écrit, l'iOS n'avait rien.

## Pourquoi TestFlight et pas autre chose

Un collègue à distance ne peut pas brancher son téléphone sur votre Mac. Les
deux autres voies le demandent — une distribution _ad hoc_ ou une build de
développement exigent l'UDID de l'appareil, un profil qui le nomme, et un
câble ou un fichier à lui faire installer à la main. TestFlight ne demande
qu'une adresse électronique.

**Interne plutôt qu'externe.** Un testeur interne doit être utilisateur d'App
Store Connect, et il y a jusqu'à cent places ; en échange, la build lui arrive
**en quelques minutes, sans examen**. Un testeur externe n'a besoin que d'une
adresse, mais la première build passe par la revue bêta d'Apple, en général
vingt-quatre heures. Pour vérifier un réveil push avec un collègue, l'attente
ne se justifie pas.

## Ce que le dépôt porte déjà

- `PRODUCT_BUNDLE_IDENTIFIER = eu.messagr`, les deux configurations.
- `DEVELOPMENT_TEAM = KUT463DS29` et `CODE_SIGN_STYLE = Automatic`, ajoutés le
  7 septembre 2026 : le projet n'avait aucun réglage de signature, parce que
  le seul travail iOS de la CI est une build simulateur, qui ne signe rien.
- `aps-environment: production` dans les entitlements, et `platform: production`
  côté sygnal. **Les deux ensemble, et c'est le point le plus facile à rater.**

## Le piège, avant tout le reste

Une build distribuée par TestFlight reçoit un jeton APNs de **production**,
quel que soit le nom qu'on donne au canal. Une entitlement `development` sur
une telle build produit un jeton sandbox : Apple répond `BadDeviceToken` à
chaque poussée, rien n'arrive, et **rien ne le signale nulle part**. Le
symptôme est un collègue qui verrouille son téléphone et attend une
notification qui ne viendra jamais, et une conclusion fausse sur #109.

`scripts/assert-ios-push.sh` refuse que l'entitlement et le `platform` de
sygnal divergent. Il tourne dans `checks`. Faites-lui confiance et ne
contournez pas son refus.

Le prix de ce réglage est réel : **une build lancée depuis Xcode sur un
téléphone branché ne peut plus être réveillée**, puisqu'elle réclamerait un
jeton de production sans y avoir droit. Si vous voulez un jour tester en
développement, il faut rebasculer les deux, ensemble.

## Les gestes, dans l'ordre

Seul le premier n'est pas reproductible : les suivants se refont à chaque
build.

### 1. La fiche App Store Connect (une seule fois)

<https://appstoreconnect.apple.com> → **Mes applications** → **+** →
**Nouvelle application**.

- Plateforme : iOS
- Nom : `Messagr`
- Langue principale : Français
- ID de forfait : `eu.messagr` — il doit déjà exister, l'App ID a été créé
  pour #109
- SKU : n'importe quoi de stable, `messagr-ios` fait l'affaire

### 2. Archiver

Depuis `packages/app/ios`, ouvrez `Messagr.xcworkspace` — **le workspace, pas
le projet** : les pods n'existent que dans le premier.

- Le schéma sur **Messagr**, la cible sur **Any iOS Device (arm64)**
- **Product → Archive**

Si Xcode réclame un profil, laissez-le le créer : la signature est automatique
et l'équipe est déjà renseignée.

### 3. Téléverser

**Il n'y a aucun fichier à choisir.** Le mot induit en erreur, et la question
s'est posée : l'archive de l'étape 2 est rangée par Xcode lui-même, sous
`~/Library/Developer/Xcode/Archives/<date>/`, et l'Organizer s'ouvre dessus
quand l'archivage réussit. Vous ne la manipulez jamais dans le Finder, et il
n'y a de sélecteur de fichier nulle part dans ce chemin.

Dans l'Organizer, onglet **Archives**, la plus récente est en haut :
sélectionnez-la, puis **Distribute App** → **App Store Connect** →
**Upload**. Laissez les options par défaut ; « Manage Version and Build
Number » évite de buter sur un numéro de build déjà pris.

Si l'Organizer s'est fermé entre-temps, **Window → Organizer** le ramène ;
l'archive `Messagr` y est avec sa date.

L'autre voie existe et ne vaut pas la peine ici : **Export** au lieu d'**Upload**
écrit bien un `.ipa` sur le disque, qu'il faut ensuite donner à Transporter ou
à `xcrun altool`. C'est le même téléversement en deux gestes de plus, et une
occasion supplémentaire de se tromper de fichier.

Le traitement chez Apple prend de cinq à trente minutes. Un courriel arrive
quand la build est prête, ou une pastille dans TestFlight.

### 4. Inviter le testeur

App Store Connect → **Utilisateurs et accès** → **+** : son adresse, son rôle.
Puis l'application → **TestFlight** → **Testeurs internes** → l'ajouter au
groupe.

Il reçoit un courriel, installe TestFlight, et la build est là.

### 5. Ce qu'on lui demande de faire, pour #109

Le ticket ne demande pas d'utiliser l'application. Il demande une seule chose,
et elle se vérifie en une minute :

1. ouvrir Messagr une fois, accepter les conditions, choisir sa langue ;
2. **verrouiller le téléphone** et le poser ;
3. quelqu'un lui envoie un message ;
4. la notification arrive-t-elle, et que dit-elle ?

Ce que #107 exige de la notification vaut pour iOS comme pour Android : elle
nomme la conversation et ne nomme personne d'autre. S'il ne se passe rien, la
première chose à regarder est le journal de sygnal — `BadDeviceToken` y
désignerait la paire d'environnements, et non l'application.

## Et la CI, plus tard

Ce document décrit des gestes manuels parce que le premier téléversement en
vaut la peine : le chemin CI demande une clé d'API App Store Connect (issuer
ID, key ID, un `.p8`), un runner macOS, et un export signé — soit le même
travail que #43 a fait pour Play, mais à déboguer à distance. Un archivage
depuis le Mac coûte trente minutes et ne bloque personne.

Le jour où une seconde build sera nécessaire — l'essai #91, puis les appels —
`publish.yml` est le modèle à suivre : il matérialise sa clé hors de l'espace
de travail, vérifie que ce qu'il a produit est bien signé, et ne pousse que
sur déclenchement manuel.
