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
- `convert_device_token_to_hex: false` côté sygnal, parce que l'application
  enregistre le jeton APNs en hexadécimal. Ajouté le 15 septembre 2026 (#325).

## Le piège, avant tout le reste

Une build distribuée par TestFlight reçoit un jeton APNs de **production**,
quel que soit le nom qu'on donne au canal. Une entitlement `development` sur
une telle build produit un jeton sandbox : Apple répond `BadDeviceToken` à
chaque poussée, rien n'arrive, et **rien ne le signale nulle part**. Le
symptôme est un collègue qui verrouille son téléphone et attend une
notification qui ne viendra jamais, et une conclusion fausse sur #109.

`scripts/assert-ios-push.sh` refuse que l'entitlement et le `platform` de
sygnal divergent, dans `checks`, en lisant les sources.

**Un second piège a tenu jusqu'au 15 septembre 2026** (#325). L'application
enregistre le jeton APNs tel que `getAPNSToken` le donne, en hexadécimal. Par
défaut, sygnal décode un pushkey APNs en base64 : il envoyait donc à Apple
48 octets sans rapport avec le jeton, et Apple répondait `BadDeviceToken`, avec
une paire d'environnements parfaitement accordée. `convert_device_token_to_hex:
false` sur `eu.messagr.apns` le règle, et `scripts/assert-ios-push.sh` le vérifie.
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
./scripts/build.sh          # le Pixel puis TestFlight
./scripts/build.sh ios      # TestFlight seulement
```

`build.sh` **incrémente le numéro de build** avant d'archiver, dans les deux
configurations à la fois. C'est le geste qu'on oublie, et App Store Connect
ne le dit qu'au téléversement — vingt minutes après l'archive, pour une
information qu'un `sed` connaît. Le numéro reste dans l'arbre de travail :
c'est à vous de le commiter avec ce que la build transporte.

Les deux identifiants se lisent dans `~/.appstoreconnect/env`, deux lignes,
`chmod 600`, hors du dépôt puisqu'il est public :

```
ASC_KEY_ID=<le Key ID, il est dans le nom du fichier .p8>
ASC_ISSUER_ID=<l'Issuer ID, au-dessus du tableau des clés>
```

Ils peuvent toujours être passés dans l'environnement, ce que fait la CI si
elle en fait un jour :

```
ASC_KEY_ID=... ASC_ISSUER_ID=... ./scripts/publish-ios.sh
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

#### La conformité à l'export

Déclarée **exemptée**, dans le build comme dans le compte :
`ITSAppUsesNonExemptEncryption` vaut `false`, et le titulaire du compte a
répondu la même chose dans App Store Connect le 7 septembre 2026, sur la
build 1.0 (2). Les deux enregistrent une seule déclaration, et
`assert-ios-info-plist.sh` vérifie que le fichier reste cohérent.

**Ce n'est pas au dépôt de trancher.** Une première version de ce document
plaidait pour « non exempté », en partant du chiffrement de bout en bout
d'Olm et Megolm. Ces faits techniques n'ont pas changé et ils ne décident
rien : l'exemption se lit dans la réglementation, la déclaration est signée
par Linagora, et le dépôt enregistre la réponse plutôt que de la déduire.

**Un piège si la réponse change un jour.** `true` ne se déclare pas seul : il
exige `ITSEncryptionExportComplianceCode`, le code qu'Apple délivre après
avoir reçu la documentation d'export. Une livraison a été refusée pour
l'avoir posé sans lui — erreur 90592 — et le garde refuse désormais la paire
à moitié faite, dans les deux sens.

**Et sans la clé du tout**, App Store Connect marque chaque build
« Conformité manquante » et la retient loin des testeurs jusqu'à ce que
quelqu'un réponde dans l'interface. C'est ce qui est arrivé à la build 2
avant que la clé n'y soit posée.

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
première chose à regarder est le journal de sygnal. `BadDeviceToken` y a deux
causes connues : la paire d'environnements, ou l'encodage du jeton. Mesurer la
longueur du jeton rejeté, sans l'afficher : 64 caractères hexadécimaux,
l'encodage est juste ; 96, sygnal a décodé en base64 un jeton hexadécimal.

## Tests externes : faire entrer le relecteur d'Apple

Un testeur externe ne reçoit une build qu'après la revue bêta d'Apple, et le relecteur doit pouvoir entrer dans l'application. Or on n'entre dans Messagr que par invitation (ADR-0004) : il n'y a ni formulaire, ni nom d'utilisateur, ni mot de passe à lui confier.

### Pourquoi l'application ne suffit pas

**Une invitation de l'application vit une heure** (`TTL_SECONDS = 3600`, `issueInvitation.ts`), et le téléphone qui l'a émise ne fait entrer que pendant cette heure (`STOP_ASKING_AFTER_MS`, `admitAnyoneWaiting.ts`). La revue prend en général une journée.

**Et une invitation plus longue ne suffit pas non plus**, parce que la réclamation se fait en deux appels. Le premier tire un compte et reçoit `409 MESSAGR_NOT_YET_INVITED` ; tant que l'émetteur n'invite pas ce compte dans la conversation, les suivants reçoivent la même chose. C'est l'application de l'émetteur qui fait ce geste, sans que personne le demande. Une invitation créée hors de l'application n'est donc admise par personne, quelle que soit sa durée.

`scripts/testflight-reviewer.mjs` tient les deux moitiés pendant toute la vie de l'invitation : il émet comme l'application émet, puis il admet comme elle admet.

### Les commandes, dans l'ordre

```
node scripts/testflight-reviewer.mjs emettre --dry-run
node scripts/testflight-reviewer.mjs emettre
caffeinate -i node scripts/testflight-reviewer.mjs admettre 2>&1 | tee -a ~/.messagr-exploitation/relecteur-apple.log
node scripts/testflight-reviewer.mjs etat
node scripts/testflight-reviewer.mjs revoquer
```

Par défaut, le script agit en tant que `@exploitation:messagr.eu`, dont les identifiants sont dans `~/.messagr-exploitation/messagr-eu.json`. Il ne les écrit, ne les affiche et ne les journalise jamais, et ne les envoie qu'au serveur de ce fichier.

**`emettre --dry-run`** décrit les cinq requêtes sans rien appeler, avec les constructeurs mêmes que le vrai lancement envoie.

**`emettre`** crée une conversation de la forme exacte de celles de l'application (salon en version 11, `private_chat`, inviter coûte 50, membres à 0, caviardage à 101, chiffrement megolm), puis y émet **une** invitation : sept jours et deux usages par défaut, `--duree` et `--usages` pour autre chose. Il affiche le lien et l'échéance, et les écrit dans `~/.messagr-exploitation/exploitation-relecteur-apple.json`, en `chmod 600` : **le lien fait entrer, il se garde comme un secret.** Coupé en route, il reprend où il s'était arrêté, et redemande l'invitation avec la même clé d'idempotence, ce qui rend la même invitation au lieu d'en poser une seconde. `--self-test`, dans `checks`, relit `issueInvitation.ts` : une conversation du script qui cesserait de ressembler à celles de l'application y échoue.

**`admettre`, avant de soumettre, et jusqu'à l'approbation.** Il interroge le service toutes les vingt à trente secondes et invite, une fois, chaque compte que le service nomme. Après une invitation, il suit de près (deux secondes, pendant quinze secondes) : l'application en face renonce après quinze essais à deux secondes d'écart, et un lien ouvert par quelqu'un qui a déjà un compte demande une seconde invitation quelques secondes après la première. Il écrit une ligne par événement, jamais le lien ni un jeton ; il survit aux coupures du réseau et aux redémarrages du service ; il s'arrête quand l'invitation est révoquée ou expirée, cinq minutes après l'échéance, ou quand l'unique usage d'une invitation à un usage est pris. Après un redémarrage du Mac, la même commande reprend sans réinviter personne.

`caffeinate -i` empêche la mise en veille tant que la commande tourne. Il n'empêche pas celle d'un portable qu'on referme : laissez-le ouvert et branché, ou relancez `admettre` au réveil.

**Soumettre** ensuite la build au groupe externe, avec les notes de revue plus bas. Il n'y a ni nom d'utilisateur ni mot de passe à fournir : tout passe par les notes, où l'on colle le lien et l'échéance que montre `etat`.

**Les builds suivantes d'une même version ne repassent pas en revue.** Une fois la 1.0 (24) approuvée, les builds 25 et 26 ont été ajoutées au groupe « Testeurs externes », puis soumises, le 14 septembre 2026. Leur état externe est passé à `IN_BETA_TESTING` dans la minute. Personne n'était entré par l'invitation du relecteur, et sa révocation n'a désactivé aucun compte.

**La note « à tester » française arrive vide.** `build.sh ios` remplace le « What to Test », mais les builds 25 et 26 sont arrivées avec la note en-US remplie et la note fr-FR vide. Or le français est la langue principale de l'application, et celle des testeurs. Remplir la note fr-FR avant d'ajouter la build au groupe externe. La phrase acceptée par la revue de la 24, puis reprise pour la 25 et la 26, est « Version à destination de tests uniquement ».

**`etat`** montre, à tout moment, le lien, l'échéance, les comptes invités et ce que dit le service. Il n'écrit rien.

**`revoquer`, après l'approbation.** Le lien cesse de fonctionner. **Et le service désactive les comptes que l'invitation a créés, celui du relecteur compris** (`handlers/revoke.rs`) : c'est irréversible, un homeserver ne rend jamais un nom. C'est pourquoi le script demande de taper `revoquer`, et qu'un tube ne lui fournit aucune confirmation. Ce pouvoir ne dure que la vie de l'invitation : dans l'heure qui suit l'échéance, le service détruit ce qui le permettait (`purge_claimed_secrets_of_expired`), et un compte entré reste alors en vie. Si Apple revoit une build plus tard, `emettre` recommence, et range l'état clos à côté du nouveau.

### Ce que le service ne dit pas

Combien d'usages il reste. `GET /invitations/{id}` ne rend ni `used_count` ni `max_uses`, et une invitation à deux usages dont un seul est pris lit `claimed` comme celle dont les deux le sont. `admettre` ne devine pas : avec deux usages, il continue d'interroger jusqu'à l'échéance, une requête toutes les vingt-cinq secondes environ, même quand plus personne ne peut entrer. La révocation fait partie de la procédure aussi pour cette raison.

### Ce que devient le compte du relecteur

Le compte n'existe pas avant que le relecteur ouvre le lien : le service le crée à la réclamation, sous un identifiant tiré au hasard, et le graphe d'invitations note `@exploitation` comme son invitant.

C'est un **entrant** : niveau 0, dans une conversation créée pour lui seul par `@exploitation`, qui y est à 100. Il peut y écrire ; il ne peut y inviter personne, puisqu'inviter coûte 50 ; personne ne répond de lui. **Il n'entre jamais dans le salon de quelqu'un** : la conversation ne contient que `@exploitation` et lui. Le second usage, s'il sert (un second appareil, un second relecteur), y ajoute un second compte, et rien d'autre.

Révoqué, le compte est désactivé. Laissé à l'échéance sans révocation, il reste, seul avec `@exploitation`.

`production-entry-point.md` ne change pas : `@exploitation` émettait déjà, et le relecteur arrive par invitation, comme tout le monde.

### Ce qu'il verra

Lu dans le code, pas supposé ; les phrases sont celles de l'interface anglaise.

**Le lien.** Sur un ordinateur, la page d'invitation montre un code QR (« Open this link on your phone: Messagr is a mobile application. Scan this code: ») : l'appareil photo de l'iPhone l'ouvre, et le domaine associé `/i*` le remet à Messagr. Touché sur l'iPhone lui-même, depuis Notes ou Mail, le lien fait de même. **Tapé dans Safari, il ne mène qu'à la page** : son bouton « Open in Messagr » recharge la même adresse, et Safari n'ouvre pas une application pour un lien de son propre domaine. Le bouton « Copy the link » promet que l'application proposera de le coller ; elle ne lit jamais le presse-papiers, et aucun écran ne permet de saisir un lien.

**Non vérifié sur iPhone, et c'est le risque principal.** `AppDelegate.swift` ne transmet ni `continueUserActivity` ni `openURL` à React Native. Un lien ouvert pendant que Messagr tourne n'arrive donc probablement pas au JavaScript ; un lancement à froid le lit par `getInitialURL`, ce qui reste à constater sur un appareil. D'où la consigne des notes : fermer complètement Messagr avant d'ouvrir le lien.

**Le premier écran**, un seul : « The messenger that asks you for nothing. », « Choose your language », la case « I accept Messagr’s terms and conditions of use. » et le bouton « Begin ». La réclamation ne part qu'après « Begin ».

**Pendant la réclamation**, aucun indicateur : la liste dit « No conversations yet. Invite someone to start one. ». Si elle échoue, pour quelque raison que ce soit, y compris un compte qu'`admettre` n'a pas invité à temps : « You are not in yet. Open the invitation link somebody sent you: it is the only door, and the application can do nothing before it. », et rien ne réessaie. Rouvrir le lien suffit : le compte tiré attend, invité, et la seconde tentative aboutit.

**Juste après l'entrée**, iOS demande l'autorisation d'envoyer des notifications, sans explication préalable.

**La conversation** s'appelle « @exploitation » : l'identifiant sans le serveur. Elle dit « Nothing has been said here yet. », et elle n'est pas ouverte d'office. **Rien n'y arrivera** : le script ne chiffre pas et n'écrit pas.

**Un message envoyé** porte une seule coche grise, « Handed to the server », et jamais la seconde. Le script ne publie aucune clé d'appareil pour `@exploitation`, et rien dans ce dépôt ne lui en donne : si ce compte n'a aucun appareil de chiffrement, la clé du message n'est remise à personne de son côté, et **rien à l'écran ne le dit**. Un appel sonne dans le vide, puis « Nobody answered » au bout de 90 secondes.

**L'écran de ce qu'on sait d'une personne** dit de `@exploitation` que quelqu'un a répondu d'elle, parce qu'il lit son niveau de créateur comme une promotion. Répondre d'elle échoue avec une ligne restée en anglais dans l'interface française ; la retirer échoue aussi.

### Le même script, pour un téléphone du porteur

Faire entrer un téléphone sous la racine est le même geste, avec une invitation courte :

```
node scripts/testflight-reviewer.mjs emettre --compte ~/.messagr-exploitation/racine-mmaudet.json --objet pixel --duree 1h --usages 1
node scripts/testflight-reviewer.mjs admettre --compte ~/.messagr-exploitation/racine-mmaudet.json --objet pixel
```

L'état est alors `~/.messagr-exploitation/mmaudet-pixel.json` : un par compte et par objet, pour que l'invitation du relecteur et celle du téléphone ne s'écrasent pas. Le `room_id` du fichier de la racine ne sert pas : chaque émission crée sa conversation, comme l'application.

Lancer `admettre`, puis ouvrir le lien sur le téléphone. Un téléphone qui porte déjà un compte prend l'autre chemin du service : deux invitations, le compte tiré puis le sien, que le suivi de deux secondes enchaîne. Ce chemin n'écrit pas `claimed`, donc `admettre` s'arrête cinq minutes après l'échéance, ou à ctrl-c, qui ne défait rien.

### Les notes de revue, à coller dans App Store Connect

TestFlight, informations de test de la build, rubrique des notes pour la revue bêta. Remplacer `<LINK>` et `<DEADLINE>` par ce qu'affiche `etat`.

```
Messagr can only be joined by invitation, by design: there is no sign-up
form, no user name and no password. An account is created on the device at
the moment an invitation link is opened. We have created an invitation for
you.

1. Install Messagr from TestFlight. If you open it from TestFlight, close it
   completely afterwards (swipe it away in the app switcher).

2. Open this link on your computer:

   <LINK>

   The page shows a QR code. Scan it with the iPhone's Camera app and tap the
   banner: Messagr opens. Tapping the link on the iPhone itself, for example
   from Notes or Mail, works the same way. Typing it into Safari does not: it
   only shows the page.

   The link is valid until <DEADLINE> and can be used twice.

3. The first screen states what Messagr promises. Choose a language, tick
   "I accept Messagr's terms and conditions of use", and tap "Begin".

4. Messagr creates your account from the invitation. This takes a few
   seconds and shows no progress. iOS then asks whether Messagr may send
   notifications.

5. A conversation named "@exploitation" appears in the list. It is a
   conversation with the Messagr operations account, which issued your
   invitation, and nobody else is in it. You can write in it; messages are
   end-to-end encrypted. The operations account does not reply.

If Messagr says "You are not in yet", close it completely and open the link
again as in step 2. The invitation is still valid and the second attempt
completes.

Accounts are pseudonymous: Messagr asks for no email address and no phone
number, which is why we cannot provide demo credentials.
```

## Ce que la build écrit d'elle-même

Depuis le 11 septembre 2026, une build qui part chez Apple laisse une trace. `build.sh ios` enchaîne deux choses après l'envoi, et **aucune des deux ne peut faire échouer la build** : à ce moment-là l'artefact est déjà parti, et un journal qui n'a pas été publié est une commande à relancer, pas une build à refaire.

**Une release GitHub**, taguée `build-<n>`, dont les notes sont les pull requests fusionnées depuis la build précédente. Le dépôt fusionne en squash, donc `master` porte un commit par changement et son sujet est une phrase écrite pour être lue — le générateur sélectionne et met en forme, il n'invente aucune prose.

Le tag nomme le produit et non un magasin : `<n>` compte les builds publiées de ce dépôt, et n'est ni le numéro de TestFlight ni le `versionCode` de Play, qui sont deux compteurs indépendants. Le magasin et son numéro sont inscrits dans le **message** du tag (`ios 25`), ce que la build suivante relit pour mesurer depuis la dernière build **du même magasin** : mesurer une release Android depuis la dernière release iOS effacerait de la liste tout ce qui est parti chez Apple entre les deux, c'est-à-dire exactement ce qu'un lecteur Android attend.

**Le « What to Test » de TestFlight**, avec le même texte. Il faut qu'Apple ait fini de traiter la build, ce qui prend cinq à trente minutes ; l'attente est bornée à trente minutes et son expiration le dit plutôt que de ressembler à un problème d'identifiants. Si elle expire :

```
node scripts/testflight-notes.mjs <numéro> --notes-file .build/ios/notes-<numéro>.md
```

Le jeton est signé en ES256 par Node lui-même, sans dépendance. Le seul point à connaître est `dsaEncoding: 'ieee-p1363'` : sans lui, Node produit une signature DER qu'Apple rejette avec un message parlant d'authentification — c'est ainsi qu'on passe un après-midi à examiner une clé qui n'a rien.

Pour la toute première build d'un magasin, aucun tag ne porte encore l'une des siennes, donc il n'y a rien d'où mesurer. Le script refuse plutôt que de deviner, et il faut lui donner un plancher :

```
node scripts/release-notes.mjs ios <numéro> --since <ref> --publish
```

### Le plancher de la première, et comment il a été trouvé

Pour iOS, c'est **`1e93c9a`**, le commit de #230.

Une build laisse sa propre empreinte dans l'historique : `build.sh` incrémente `CURRENT_PROJECT_VERSION` dans l'arbre de travail, et ce numéro est commité avec ce que la build transportait. Donc le commit qui pose un numéro **est** la build.

```
git log --oneline -S'CURRENT_PROJECT_VERSION = 24' -- packages/app/ios/Messagr.xcodeproj/project.pbxproj
```

La 24, partie chez Apple le 11 septembre 2026, a été numérotée dans #230 ; la 23 l'avait été dans #223. Mesurer depuis `1e93c9a` donne donc exactement ce que les testeurs de la 24 n'ont pas encore, et rien d'autre.

La même commande retrouvera le plancher d'Android le jour où sa première release sera publiée, en cherchant le `versionCode` de la dernière montée sur la piste.

## Et la CI

Le travail que ce document décrivait comme « à faire un jour » est fait : la
clé d'API existe, `ExportOptions.plist` est dans le dépôt, et
`publish-ios.sh` ne demande rien d'interactif. Ce qui manque pour que la CI
téléverse toute seule est un runner macOS et trois secrets
(`MESSAGR_ASC_KEY_ID`, `MESSAGR_ASC_ISSUER_ID`,
`MESSAGR_ASC_KEY_BASE64`) — soit exactement la forme que `publish.yml` a déjà
pour Play, y compris sa règle de matérialiser la clé hors de l'espace de
travail et de ne partir que sur déclenchement manuel.
