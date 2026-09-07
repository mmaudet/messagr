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
sygnal divergent, dans `checks`, en lisant les sources.
`scripts/assert-ipa-push.sh` refuse le même désaccord dans le **binaire
construit**, juste avant le téléversement — et c'est celui-là qui compte,
parce que la signature peut changer l'entitlement sans que la source bouge.
Faites-leur confiance et ne contournez pas leur refus.

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

### 2 et 3. Archiver, vérifier, téléverser — en une commande

**Ces deux étapes ne se font plus dans Xcode.** Elles ont été faites à la
main une fois, le 7 septembre 2026, et ce qu'elles ont appris est dans
`scripts/publish-ios.sh` plutôt que dans un enchaînement de clics.

```
export ASC_KEY_ID=BV84NRG5SB
export ASC_ISSUER_ID=<l'Issuer ID, sur la page Clés d'App Store Connect>
./scripts/publish-ios.sh
```

La clé `.p8` se télécharge **une seule fois** depuis App Store Connect →
Utilisateurs et accès → Intégrations → Clés, et se range dans
`~/.appstoreconnect/private_keys/` en `chmod 600` : c'est là que `xcodebuild`
et `altool` la trouvent par identifiant seul. Elle ne va jamais dans le
dépôt — `.gitignore` refuse `*.p8` et `AuthKey_*`, et ce dépôt est public.

Le script fait quatre choses, dans cet ordre, et s'arrête à la première qui
échoue :

1. **archive** avec `-allowProvisioningUpdates`, qui enregistre l'App ID,
   active la capacité Push que réclament les entitlements, et crée le profil ;
2. **exporte** un `.ipa` signé pour la distribution, via `ExportOptions.plist` ;
3. **vérifie** ce `.ipa` avec `scripts/assert-ipa-push.sh` ;
4. **valide** auprès d'Apple, puis **téléverse**.

#### Pourquoi il exporte un fichier au lieu d'envoyer directement

`xcodebuild -exportArchive` sait signer et envoyer d'un seul geste
(`destination: upload`), sans jamais écrire d'`.ipa`. C'est ce que faisait la
première version, et c'est aveugle.

**L'archive sort avec `aps-environment: development`**, quoi que disent les
entitlements. La signature automatique intersecte les entitlements avec ce que
le profil accorde, et l'étape d'archivage signe contre un profil de
développement ; c'est l'export qui resigne contre un profil de distribution et
rend `production`. Constaté sur la première archive réelle, à un geste du
téléversement.

C'est précisément le piège décrit plus haut, et « l'export le corrige » est
une affirmation qu'on vérifie. Le fichier est donc écrit, lu, et seulement
ensuite envoyé. `assert-ipa-push.sh` lit l'environnement attendu dans
`sygnal.yaml` plutôt que de l'écrire en dur : celui qui bascule une moitié de
la paire voit l'autre le contredire.

#### Ce qui a été trouvé en le faisant, et qui ne se voyait nulle part

`AppIcon.appiconset` déclarait neuf emplacements et ne contenait aucun
fichier. Ça compile, ça s'installe, ça tourne, l'écran d'accueil montre un
carré blanc, et la CI reste verte : App Store Connect a été la première chose
à s'en apercevoir, avec trois erreurs d'un coup (90713, 90022, 90023).
Réparé depuis `design/brand/messagr-icone-ios-1024.svg`, et
`scripts/assert-ios-icon.sh` le vérifie maintenant dans `checks`.

#### La conformité à l'export, répondue une fois pour toutes

Sans `ITSAppUsesNonExemptEncryption` dans l'`Info.plist`, App Store Connect
marque chaque build « Conformité manquante » et la retient loin des testeurs
jusqu'à ce que quelqu'un réponde dans un formulaire web. La réponse est la
même à chaque fois, donc elle est dans la build.

Elle vaut `true`, et c'est le produit qui le dicte : l'exemption qui
permettrait `false` vise les applications n'utilisant que le chiffrement
fourni par iOS — HTTPS, le trousseau, l'authentification. Messagr chiffre ses
propres messages de bout en bout avec Olm et Megolm, ce qui n'est pas ça, et
qui est toute la raison d'être.

Les algorithmes sont standards et publiés — AES-256, Curve25519, Ed25519,
HMAC-SHA-256 — donc c'est de la cryptographie de marché de masse et non du
propriétaire : ce qui découle de `true` est un rapport d'auto-classification
annuel, pas une revue CCATS.

**La toute première build, celle du 7 septembre 2026, est partie sans cette
clé.** Il a fallu répondre une fois dans l'interface pour celle-là ; toutes
les suivantes la portent.

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

## Et la CI

Le travail que ce document décrivait comme « à faire un jour » est fait : la
clé d'API existe, `ExportOptions.plist` est dans le dépôt, et
`publish-ios.sh` ne demande rien d'interactif. Ce qui manque pour que la CI
téléverse toute seule est un runner macOS et trois secrets
(`MESSAGR_ASC_KEY_ID`, `MESSAGR_ASC_ISSUER_ID`,
`MESSAGR_ASC_KEY_BASE64`) — soit exactement la forme que `publish.yml` a déjà
pour Play, y compris sa règle de matérialiser la clé hors de l'espace de
travail et de ne partir que sur déclenchement manuel.
