# Déclarations aux magasins

Ce qu'il faut répondre dans la Play Console (« Sécurité des données ») et dans App Store Connect (« App Privacy »), question par question, et ce que déclare le manifeste iOS. Écrit pour #321, le 15 septembre 2026.

**La page de confidentialité fait foi.** Les réponses viennent de `deploy/messagr-eu/site/confidentialite/index.html`, version du 15 septembre 2026, publiée sur <https://messagr.eu/confidentialite>. Chacune cite la phrase qui la justifie. Quand la page change, ce document change avec elle, et avec lui `packages/app/ios/Messagr/PrivacyInfo.xcprivacy` et les deux consoles.

**Ce qui était déclaré jusqu'ici était faux.** `scripts/setup-play-publishing.sh` consignait « this application sends no analytics and collects no data », et le formulaire Play a été rempli sur cette phrase. Le manifeste iOS déclarait une liste vide. La page dit le contraire : le serveur conserve des métadonnées, et Google comme Apple reçoivent un jeton d'appareil.

**Certaines réponses sont des jugements.** Elles portent un renvoi, par exemple « tranché, 2 » ou « à trancher, 6 », vers la section « Les jugements », où chaque point donne la règle lue et la réponse. Les tableaux et le manifeste portent cette réponse.

**Les points 1 à 5 sont tranchés** par le porteur le 16 septembre 2026. Le 5 et le 7 sont devenus des tickets, #334 et #333. Le 6 attend ce que le porteur décide de la lecture faite le 16 septembre.

## Sources

Toutes lues le 15 septembre 2026, dans des copies faites ce jour-là.

**Google**

- Aide Play Console, « Fournir les informations pour la section Sécurité des données de Google Play » : <https://support.google.com/googleplay/android-developer/answer/10787469?hl=fr>. Les libellés et les règles citées en français viennent de cette page. Sa version anglaise, « Provide information for Google Play's Data safety section », a servi à vérifier les règles : <https://support.google.com/googleplay/android-developer/answer/10787469?hl=en>.
- Aide Play Console, « Understanding Google Play's app account deletion requirements » : <https://support.google.com/googleplay/android-developer/answer/13327111?hl=en>.
- Firebase, « Prepare for Google Play's data disclosure requirements » : <https://firebase.google.com/docs/android/play-data-disclosure>.
- Firebase, « Get started with Firebase Cloud Messaging in Apple platform apps » : <https://firebase.google.com/docs/cloud-messaging/ios/get-started>.

**Apple**

- « App privacy details on the App Store » : <https://developer.apple.com/app-store/app-privacy-details/>.
- App Store Connect Help, « Manage app privacy » : <https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy/>.
- « Privacy manifest files » : <https://developer.apple.com/documentation/bundleresources/privacy-manifest-files>.
- « Describing data use in privacy manifests » : <https://developer.apple.com/documentation/bundleresources/describing-data-use-in-privacy-manifests>.
- Les pages des clés, sous <https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacycollecteddatatypes> : `NSPrivacyCollectedDataType`, `NSPrivacyCollectedDataTypeLinked`, `NSPrivacyCollectedDataTypeTracking` et `NSPrivacyCollectedDataTypePurposes`.

Les deux premières pages d'Apple n'ont pas de version française lisible : leur adresse sous `developer.apple.com/fr/` répond « Page non trouvée ». Les libellés Apple sont donc donnés en anglais, tels que la documentation les écrit, et la console peut les afficher traduits.

**Le code, lu et non mesuré.** Aucun appareil n'a servi à ce document. Ce qu'il dit du comportement de l'application vient de `packages/app/src/runtime/pushDevice.ts`, `pusher.ts`, `mediaRepository.ts`, `sendImage.ts`, `sendFile.ts` et `backupCalls.ts`, de `packages/app/ios/Messagr/AppDelegate.swift`, et des sources de FirebaseMessaging 12.18.0 installées par CocoaPods dans `packages/app/ios/Pods`, hors dépôt.

## Ce que la page dit, donnée par donnée

| Donnée                                         | Où                               | Combien de temps                                                                             | Déclarée                      |
| ---------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------- |
| Identifiant du compte, pseudonyme              | serveur                          | vie du compte                                                                                | oui                           |
| Appartenance aux conversations                 | serveur                          | vie du compte                                                                                | oui                           |
| Date et heure des événements, taille           | serveur                          | vie du compte                                                                                | oui                           |
| Appareils du compte et leurs clés publiques    | serveur                          | vie du compte                                                                                | oui                           |
| Demande d'accès au relais pour un appel        | serveur, relais                  | la page ne le dit pas                                                                        | oui                           |
| Adresses IP des requêtes                       | journaux techniques              | douze mois                                                                                   | oui                           |
| Jeton de notification                          | serveur, Google ou Apple         | tant que les notifications sont actives, et chez Google tant que l'application est installée | oui                           |
| Lien entre celui qui invite et celui qui entre | service d'invitations            | trente jours après la dépense de l'invitation                                                | oui                           |
| Contenu : textes, photos, fichiers             | serveur, chiffré de bout en bout | vie de la conversation                                                                       | non, illisible                |
| Son et image des appels                        | relais, chiffrés                 | temps réel                                                                                   | non                           |
| Clés, session, journal de l'appareil           | appareil                         | sans objet                                                                                   | non, ne quitte pas l'appareil |

À la suppression d'un compte, la page promet une désactivation immédiate et une purge sous trente jours. `deploy/messagr-eu/retention.json` note que cette purge est encore manuelle (#71).

Deux faits que la page ne dit pas pèsent sur les réponses : les clés de salon sont sauvegardées sur le serveur, chiffrées (ADR 0013), et Firebase est initialisé sur iOS. Ils sont traités aux points 4 et 5 de « À trancher par le porteur », et repris dans « Ce que la page ne dit pas encore ».

## Google Play : « Sécurité des données »

**Où.** Play Console → Messagr → « Contenu de l'application » → « Sécurité des données » → « Commencer ». « Contenu de l'application » est la page que `docs/publishing-android.md` situe sous _Monitor and improve → Policy and programmes → App content_. Le formulaire s'enregistre en brouillon et s'exporte en CSV.

**Ce que Play ne demande pas.** Ni si une donnée est liée à la personne, ni si elle sert au suivi. Deux choses en tiennent lieu : les données pseudonymes se déclarent comme les autres, et aucune finalité « Publicité ou marketing » n'est cochée.

### Les règles appliquées

Six phrases de l'aide Play décident de presque tout.

- **Collecte.** « Le terme “Collecte” désigne la transmission des données de l'application depuis l'appareil d'un utilisateur. » Les SDK comptent : « les données utilisateur sont ici transmises depuis un appareil à partir de votre application par des bibliothèques et/ou des SDK utilisés dans votre application, qu'elles soient transmises à vous ou à un serveur tiers. »
- **Données pseudonymes.** « les données utilisateur collectées de manière pseudonyme doivent être déclarées. Par exemple, les données qui peuvent raisonnablement être réassociées à un utilisateur doivent être déclarées. »
- **Chiffrement de bout en bout.** « les données utilisateur envoyées depuis l'appareil, mais que vous ou toute personne autre que l'expéditeur et le destinataire ne pouvez pas lire en raison d'un chiffrement de bout en bout, n'ont pas besoin d'être déclarées. » Et : « Seuls l'expéditeur et le destinataire peuvent disposer des clés nécessaires. »
- **Traitement éphémère.** « Traiter des données de façon “éphémère” consiste à accéder aux données et à les utiliser alors qu'elles ne sont conservées en mémoire que le temps de répondre en temps réel à une demande précise. » Ce qui est conservé n'est donc pas éphémère.
- **Fournisseurs de services.** Un transfert ne se déclare pas comme partage quand il va à un fournisseur de services : « transfert de données utilisateur à un “fournisseur de services” qui les traite pour le compte du développeur ». La FAQ y range « un fournisseur cloud qui héberge les données utilisateur de votre application pour votre propre usage ».
- **Sur l'appareil.** « les données utilisateur auxquelles votre application accède, qui ne sont traitées que localement sur l'appareil de l'utilisateur et qui n'ont pas été envoyées depuis l'appareil, n'ont pas besoin d'être déclarées. »

### Étape « Collecte des données et sécurité »

| Question                                                                                                      | Réponse                      |
| ------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| L'application collecte-t-elle ou partage-t-elle « l'un des types de données utilisateur obligatoires » ?      | **Oui**                      |
| « Les données utilisateur que collecte votre application sont-elles toutes chiffrées lors de leur transit ? » | **Oui**, tranché le 16/09, 6 |
| « Proposez-vous aux utilisateurs un moyen de demander la suppression de leurs données ? »                     | **Oui**, à trancher, 7       |

**Des données sont collectées**, et la page le dit en ouvrant sa liste : « Faire circuler un message suppose de savoir où l'envoyer, et le serveur conserve donc : ».

**Chiffrées en transit.** L'application parle au serveur et au service d'invitations en HTTPS, et le SDK de Firebase parle à Google en TLS. Play s'en contente : « TLS (Transport Layer Security) et HTTPS sont les protocoles de chiffrement les plus courants. » La page, elle, ne parle que du chiffrement du contenu. La réserve est le relais d'appel, servi aussi sans TLS : à trancher, 6.

**Suppression sur demande.** « Vous disposez des droits d'accès, de rectification, d'effacement, de limitation, d'opposition et de portabilité. Écrivez à conformite@messagr.eu. » Une adresse suffit à Play, pour qui ce mécanisme « peut être, sans s'y limiter, une fonctionnalité intégrée à l'application, un formulaire de contact ou un alias d'adresse e-mail dédié. »

**La suppression de compte demande davantage.** L'aide sur la suppression de compte fait répondre tous les développeurs à des questions de suppression dans ce même formulaire. Une application qui permet de créer un compte doit en plus « provide users with an in-app path to delete their app accounts and associated data », et « provide a web link resource where users can request app account deletion and associated data deletion ». Messagr crée le compte dans l'application, à l'ouverture d'une invitation. Aucune des deux conditions n'est remplie aujourd'hui : à trancher, 7.

### Étape « Types de données »

Cocher ces quatre types, et aucun autre :

- « Informations personnelles » → « ID utilisateur » ;
- « Contacts » → « Contacts », tranché, 3 ;
- « Activité dans les applications » → « Autres actions » ;
- « Appareil ou autres ID » → « Appareil ou autres ID », tranché, 1 et 2.

### Étape « Utilisation et traitement des données »

Pour chaque type coché, Play pose les mêmes questions :

1. « Ces données sont-elles collectées, partagées ou les deux ? »
2. « Ces données sont-elles traitées de manière éphémère ? »
3. « Ces données sont-elles requises pour votre application, ou les utilisateurs peuvent-ils décider qu'elles soient collectées ou non ? » L'option « Obligatoire » du tableau est « La collecte de données est obligatoire (les utilisateurs ne peuvent pas désactiver cette collecte) ».
4. « Pourquoi ces données utilisateur sont-elles collectées ? Plusieurs réponses possibles. »

La question « Pourquoi ces données utilisateur sont-elles partagées ? » ne concerne que les données partagées, et aucune ne l'est.

| Type                  | 1          | 2   | 3           | 4                                                                                |
| --------------------- | ---------- | --- | ----------- | -------------------------------------------------------------------------------- |
| ID utilisateur        | Collectées | Non | Obligatoire | Fonctionnement de l'application ; Gestion des comptes                            |
| Contacts              | Collectées | Non | Obligatoire | Fonctionnement de l'application ; Prévention des fraudes, sécurité et conformité |
| Autres actions        | Collectées | Non | Obligatoire | Fonctionnement de l'application                                                  |
| Appareil ou autres ID | Collectées | Non | Obligatoire | Fonctionnement de l'application ; Prévention des fraudes, sécurité et conformité |

Le chiffrement en transit et la suppression se déclarent pour toute l'application, à l'étape précédente, et valent donc pour les quatre types : chiffrés en transit, oui ; suppression sur demande, oui, à conformite@messagr.eu.

#### « ID utilisateur »

- **Ce que c'est.** L'identifiant Matrix du compte, tiré au hasard à l'entrée.
- **Définition Play.** « Identifiants associés à une personne identifiable. Par exemple, un ID de compte, un numéro de compte ou un nom de compte. »
- **Page.** « les identifiants pseudonymes des comptes » ; « L'identifiant de votre compte est tiré au hasard au moment où vous entrez. Il n'est rattaché à rien d'autre que lui-même. »
- **Pourquoi le déclarer, bien qu'il soit pseudonyme.** Par la règle des données pseudonymes. Un identifiant pseudonyme se déclare dès qu'il peut être réassocié à quelqu'un, et les journaux techniques existent pour cela : ils gardent douze mois « les données permettant d'identifier la source d'une connexion, dont les adresses IP ».
- **Partagé : non.** Il reste chez l'hébergeur, fournisseur de services : « Le serveur est hébergé par Hetzner Online GmbH, à Helsinki, en Finlande, au sein de l'Union européenne. »
- **Éphémère : non.** « Les métadonnées d'une conversation vivent aussi longtemps que le compte. »
- **Obligatoire.** Il n'y a pas d'application sans compte.
- **Finalités.** « Fonctionnement de l'application », puisque ces métadonnées « ne servent à aucun autre usage que l'acheminement ». « Gestion des comptes », que Play définit comme « Données utilisées par le développeur pour configurer ou gérer le compte d'un utilisateur. »
- **Suppression.** « À la suppression d'un compte, il est désactivé immédiatement et ses données sont purgées sous trente jours. » Avec la limite que la page reconnaît : « supprimer un compte le désactive et empêche toute réutilisation de son identifiant, mais les événements qu'il a produits restent des événements du salon. »

#### « Contacts »

- **Ce que cela couvre.** Qui échange avec qui, et quand ; le fait qu'un compte est en appel ; le lien entre celui qui invite et celui qui entre. Pas le carnet d'adresses : « pas de carnet d'adresses, ni de contacts lus sur votre appareil. »
- **Définition Play.** « Informations sur les contacts de l'utilisateur (nom des contacts, historique des messages et informations des graphes sociaux comme les noms d'utilisateur, la récence et la fréquence des contacts, la durée des interactions, et l'historique des appels, par exemple). »
- **Page.** « l'appartenance aux conversations » et « donc qui échange avec qui » ; « quand un compte est en appel » ; « Le lien entre celui qui invite et celui qui entre est effacé trente jours après que l'invitation a été dépensée. »
- **Partagé : non.** Même hébergeur.
- **Éphémère : non.** L'appartenance vit avec le compte, le lien d'invitation jusqu'à trente jours après la dépense.
- **Obligatoire.** Acheminer un message suppose de savoir à qui.
- **Finalités.** « Fonctionnement de l'application ». « Prévention des fraudes, sécurité et conformité », parce que le lien d'invitation sert à la sécurité : « Pendant ce délai, il permet de révoquer une branche d'invitation entière », et « Un lien gelé par un signalement en cours fait exception : il est conservé tant que l'examen dure. » Play définit cette finalité ainsi : « Données utilisées pour prévenir les fraudes, assurer la sécurité ou respecter les lois ».
- **Suppression.** L'appartenance suit le compte. Le lien d'invitation s'efface à trente jours, sauf s'il est gelé.

#### « Autres actions »

- **Ce que cela couvre.** La date et l'heure de chaque événement, la taille approximative de ce qui transite, et la demande d'accès au relais que déclenche un appel.
- **Définition Play.** « Toute autre activité ou action de l'utilisateur effectuée dans une application et non listée ici, par exemple les actions dans les jeux, les clics sur “J'aime” et les options des boîtes de dialogue. »
- **Page.** « la date et l'heure de chaque événement » ; « la taille approximative de ce qui transite » ; « pour chaque appel, l'application demande au serveur l'accès au relais qui achemine le son et l'image ».
- **Partagé : non. Éphémère : non. Obligatoire.** Pour les mêmes raisons que les deux types précédents.
- **Finalité.** « Fonctionnement de l'application », et elle seule. Pas « Analyse » : « Nous ne les enrichissons pas, nous ne les croisons avec rien, et elles ne servent à aucun autre usage que l'acheminement. »
- **Suppression.** Ces métadonnées suivent le compte.

#### « Appareil ou autres ID »

- **Ce que cela couvre.**
  - les identifiants des appareils du compte et leurs clés publiques ;
  - le jeton FCM que l'application enregistre auprès du serveur pour être réveillée ;
  - l'identifiant d'installation Firebase, que le SDK génère et envoie à Google ;
  - les adresses IP des journaux techniques, et celles que voit le relais d'appel, tranché, 2.
- **Définition Play.** « Identifiants associés à un appareil, à un navigateur ou à une application donnés. Par exemple, code IMEI, adresse MAC, ID d'appareil Widevine, ID d'installation Firebase ou identifiant publicitaire. »
- **Firebase.** Firebase Cloud Messaging dépend du SDK d'installations, qui « Generates and collects a per-installation identifier (FID) that does not uniquely identify a user or physical device. »
- **Page.** « la liste des appareils d'un compte et leurs clés publiques » ; « Le signal envoyé porte l'identifiant technique de votre appareil, une priorité de remise, et un nombre tiré au hasard. » ; « Ce que Google détient donc, c'est un jeton d'appareil et le fait que quelque chose est arrivé à un moment donné. » ; « les adresses IP au moment des requêtes, dans les journaux techniques. »
- **Partagé : non.** Google achemine le réveil pour le compte de Messagr, ce qui est la définition du fournisseur de services : tranché, 1.
- **Éphémère : non.** Chez Google, le jeton est « conservé tant que l'application est installée » ; les journaux techniques gardent les adresses douze mois.
- **Obligatoire.** Le jeton seul serait facultatif, puisque « Les notifications se désactivent dans les réglages de l'application ». Mais le type couvre aussi les clés d'appareil et les adresses IP, sans lesquelles rien ne fonctionne, et Play tranche : « Si la fonctionnalité principale de votre application nécessite ce type de données, vous devez déclarer ces données comme “obligatoires”. »
- **Finalités.** « Fonctionnement de l'application ». « Prévention des fraudes, sécurité et conformité », pour les adresses IP que le décret n° 2021-1362 impose de conserver.
- **Suppression.** Les appareils et le jeton suivent le compte. Les adresses IP restent douze mois quoi qu'on demande, ce que Play admet : « Vous pouvez sélectionner ce badge même si vous devez conserver certaines données pour des raisons légitimes (que ce soit pour respecter les lois ou prévenir des abus). »

### Ce qui n'est pas déclaré sur Play

| Type Play                                                                              | Pourquoi                                                              | Règle                                             |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------- |
| « Messages » → « Autres messages dans l'application »                                  | chiffrés de bout en bout                                              | chiffrement de bout en bout, tranché, 4           |
| « Photos et vidéos » → « Photos »                                                      | chiffrées de bout en bout ; l'application n'envoie pas de vidéo       | chiffrement de bout en bout, tranché, 4           |
| « Fichiers et documents »                                                              | chiffrés de bout en bout                                              | chiffrement de bout en bout, tranché, 4           |
| « Fichiers audio »                                                                     | pas de message vocal ; le son des appels passe chiffré, en temps réel | chiffrement de bout en bout ; traitement éphémère |
| « Position »                                                                           | aucune position n'est déduite des adresses IP                         | la note de Play sur la position déduite           |
| « Informations personnelles » : nom, adresse e-mail, téléphone, adresse                | jamais demandés                                                       | rien n'est transmis                               |
| « Infos et performance des applis »                                                    | aucun outil de mesure ; le journal reste sur l'appareil               | traitement sur l'appareil, tranché, 5             |
| Interactions, recherches, applications installées, navigation, agenda, finances, santé | rien de tel                                                           | rien n'est transmis                               |

- **Le contenu.** « Le contenu de vos conversations est chiffré de bout en bout : il est chiffré sur l'appareil qui l'écrit et déchiffré sur celui qui le lit. Les clés ne quittent jamais les appareils. » Le code le confirme pour les photos et les fichiers : ce qui est téléversé est le chiffré, déclaré `application/octet-stream`, sans nom de fichier (`cryptoPump.ts`, `mediaRepository.ts`).
- **Les appels.** « ce relais voit l'adresse IP des téléphones qui s'en servent, jamais le contenu de l'appel ».
- **La position.** Play : « Vous devez indiquer ici la position approximative déduite, par exemple à partir de l'adresse IP ou du nom du point d'accès. » Rien n'en est déduit : « Nous ne les enrichissons pas, nous ne les croisons avec rien ».
- **L'identité.** « pas de numéro de téléphone » ; « pas d'adresse électronique » ; « pas de nom, réel ou déclaré ».
- **La mesure.** « L'application ne contient aucun outil de mesure, aucun traceur, aucune bibliothèque tierce d'analyse, aucune publicité. » Et le journal de l'appareil : « Elles ne portent ni contenu ni identifiant, et l'application ne les envoie nulle part ».

## App Store Connect : « App Privacy »

**Où.** App Store Connect → Apps → Messagr → « App Privacy », dans la barre latérale. Rôle requis : « Account Holder, Admin, or App Manager ».

**La démarche, telle que l'aide la décrit.** « Get Started », puis dire si l'application ou ses partenaires collectent des données : « Yes, we collect data from this app », « Next ». Cocher les types, « Save ». Ouvrir chaque type et répondre « to the questions that follow », « Save ». Relire « Product Page Preview », puis « Publish ».

### Les règles appliquées

- **Collecte.** « “Collect” refers to transmitting data off the device in a way that allows you and/or your third-party partners to access it for a period longer than what is necessary to service the transmitted request in real time. » Et plus bas, le même mot précisé : « storing it in a readable form for longer than the time it takes you and/or your third-party partners to service the request ».
- **Partenaires.** « “Third-party partners” refers to analytics tools, advertising networks, third-party SDKs, or other external vendors whose code you've added to your app. » Firebase en est un.
- **Lié à l'utilisateur.** « Note: “Personal Information” and “Personal Data”, as defined under relevant privacy laws, are considered linked to the user. » Un identifiant pseudonyme reste une donnée personnelle au sens du règlement que la page cite : « RV Myriagone Holding est le responsable de ce traitement au sens du règlement (UE) 2016/679. » Tout ce que garde le serveur est donc lié.
- **Suivi.** « “Tracking” refers to linking data collected from your app about a particular end-user or device, such as a user ID, device ID, or profile, with Third-Party Data for targeted advertising or advertising measurement purposes, or sharing data collected from your app about a particular end-user or device with a data broker. » Rien de tel : « aucun traceur, aucune bibliothèque tierce d'analyse, aucune publicité », et « nous ne les croisons avec rien ».
- **Adresse IP.** « Declare the relevant data types based on how you use IP address, such as precise location, coarse location, device ID, or diagnostics. »
- **Messagerie.** Pour une application qui offre « in-app private messaging between users that are not SMS text messages » : « Declare emails or text messages on your label. »
- **Sur l'appareil.** « Data that is processed only on device is not “collected” and does not need to be disclosed in your answers. »
- **Apple elle-même.** « You are not responsible for disclosing data collected by Apple. » Ce que garde le service de notifications d'Apple ne se déclare pas. La copie du jeton APNs que garde le serveur, si.

### Les liens

- « Privacy Policy », obligatoire : <https://messagr.eu/confidentialite>.
- « Privacy Choices », facultatif, qu'Apple décrit comme « a webpage where users can access their data, request deletion, or make changes ». À laisser vide tant que la page n'a pas de section de suppression qu'un lien peut viser : à trancher, 7.

Les deux se saisissent dans « App Privacy », à côté de « Privacy Policy », par « Edit ». L'aide prévient : « Any changes to the URLs releases with your next app version. »

### Les types à cocher

- « Identifiers » → « User ID » ;
- « Identifiers » → « Device ID », tranché, 1 et 2 ;
- « User Content » → « Emails or Text Messages », tranché, 4 ;
- « Contacts » → « Contacts », tranché, 3 ;
- « Usage Data » → « Other Usage Data » ;
- « Diagnostics » → « Other Diagnostic Data », tranché, 5.

### Pour chaque type

Les questions qui suivent chaque type portent sur les trois notions du guide d'Apple : l'usage (« Data use »), le lien à l'identité (« Data linked to the user ») et le suivi (« Tracking »).

Apple ne demande ni si la donnée est partagée, ni si elle est facultative. Son seul équivalent est la « Optional disclosure », qui ne vaut pour aucun type ici, puisqu'elle exige entre autres que « Collection of the data occurs only in infrequent cases that are not part of your app's primary functionality, and which are optional for the user. »

| Type                    | Data use          | Linked to the user | Tracking |
| ----------------------- | ----------------- | ------------------ | -------- |
| User ID                 | App Functionality | Yes                | No       |
| Device ID               | App Functionality | Yes                | No       |
| Emails or Text Messages | App Functionality | Yes                | No       |
| Contacts                | App Functionality | Yes                | No       |
| Other Usage Data        | App Functionality | Yes                | No       |
| Other Diagnostic Data   | App Functionality | No                 | No       |

« App Functionality » se lit « Such as to authenticate the user, enable features, prevent fraud, implement security measures, ensure server up-time, minimize app crashes, improve scalability and performance, or perform customer support ». Elle couvre donc aussi la sécurité et la révocation d'une branche d'invitation, que Play range à part. Aucune autre finalité : ni « Analytics », ni « Product Personalization », ni publicité.

#### « User ID »

- **Définition Apple.** « Such as screen name, handle, account ID, assigned user ID, customer number, or other user- or account-level ID that can be used to identify a particular user or account »
- **Page.** « les identifiants pseudonymes des comptes ».
- **Lié : oui.** C'est l'identifiant du compte lui-même.

#### « Device ID »

- **Définition Apple.** « Such as the device's advertising identifier, or other device-level ID »
- **Ce que cela couvre.** Les identifiants et les clés publiques des appareils du compte ; le jeton APNs que le serveur garde pour réveiller l'iPhone ; les adresses IP des journaux techniques et du relais, tranché, 2 ; et, chez Google, l'identifiant d'installation Firebase, tranché, 5.
- **Page.** « la liste des appareils d'un compte et leurs clés publiques » ; « Sur iOS le même rôle est tenu par le service de notifications d'Apple. » ; « les adresses IP au moment des requêtes, dans les journaux techniques. »
- **Lié : oui.** Chaque appareil et chaque jeton sont enregistrés sous un compte.

#### « Emails or Text Messages »

- **Définition Apple.** « Including subject line, sender, recipients, and contents of the email or message »
- **Ce qui est collecté.** L'expéditeur et les destinataires, que le serveur lit. Pas le contenu, qu'il ne peut pas lire. Ce sont eux, et la consigne d'Apple sur la messagerie, qui font déclarer ce type : tranché, 4.
- **Page.** « l'appartenance aux conversations » et « donc qui échange avec qui » ; « Le serveur ne détient pas les clés : il ne peut pas lire vos messages ».
- **Lié : oui.**

#### « Contacts »

- **Définition Apple.** « Such as a list of contacts in the user's phone, address book, or social graph »
- **Ce que cela couvre.** Le graphe social que garde le serveur : qui échange avec qui, et qui a fait entrer qui. Pas le carnet d'adresses : « pas de carnet d'adresses, ni de contacts lus sur votre appareil. » À trancher, 3.
- **Page.** « donc qui échange avec qui » ; « Le lien entre celui qui invite et celui qui entre est effacé trente jours après que l'invitation a été dépensée. »
- **Lié : oui.**

#### « Other Usage Data »

- **Définition Apple.** « Any other data about user activity in the app »
- **Ce que cela couvre.** La date et l'heure de chaque événement, la taille approximative de ce qui transite, et le fait qu'un compte est en appel. Pas « Product Interaction », qui vise « app launches, taps, clicks, scrolling information » : rien de cela ne quitte l'appareil.
- **Page.** « la date et l'heure de chaque événement » ; « la taille approximative de ce qui transite » ; « quand un compte est en appel ».
- **Lié : oui.**

#### « Other Diagnostic Data »

- **Définition Apple.** « Any other data collected for the purposes of measuring technical diagnostics related to the app »
- **Ce que cela couvre.** Ce que le SDK de Firebase envoie de lui-même à Google sur iOS, et que ses pods déclarent sous ce type. Rien de ce que l'application écrit : son journal ne quitte pas l'appareil. À trancher, 5.
- **Page.** Aucune phrase, et c'est l'objet du point 5.
- **Lié : non.** Les pods Firebase le déclarent avec `NSPrivacyCollectedDataTypeLinked` à `false`.

### Ce qui n'est pas déclaré sur l'App Store

- **« Photos or Videos », « Other User Content ».** Le contenu n'est conservé que chiffré, sous des clés que le serveur n'a pas : il n'est jamais « in a readable form ». À trancher, 4.
- **« Audio Data ».** Apple vise « The user's voice or sound recordings ». Messagr n'enregistre rien, et le son d'un appel passe chiffré, en temps réel.
- **« Contact Info ».** « pas de numéro de téléphone » ; « pas d'adresse électronique » ; « pas de nom, réel ou déclaré ».
- **« Location ».** Une adresse IP se classe selon son usage, et Messagr n'en tire aucune position : « Nous ne les enrichissons pas, nous ne les croisons avec rien ».
- **« Crash Data », « Performance Data ».** « L'application ne contient aucun outil de mesure », et le journal de l'appareil n'en sort pas.
- **« Customer Support ».** Une demande écrite à conformite@messagr.eu ne passe pas par l'application.
- **« Product Interaction », « Search History », « Browsing History », « Purchases », « Financial Info », « Health & Fitness », « Sensitive Info », « Surroundings », « Body ».** Rien de tel.

### La note au relecteur d'App Store Connect

À coller dans « App Review Information > Notes » à chaque soumission, décidé au point 4. Elle est en anglais, la langue dans laquelle le relecteur lit.

> Messagr is an end-to-end encrypted messenger. Photos, files and message
> text are encrypted on the device before they are uploaded. The server
> stores ciphertext only and never holds the key, so it cannot render any
> of it.
>
> We therefore do not declare "Photos or Videos" or "Other User Content"
> under App Privacy. We follow Apple's own definition of collection as
> retaining data "in a readable form" (App privacy details on the App
> Store). We are aware of the guidance that an app which lets users upload
> a media type should disclose that type, and we read it against that
> definition: there is no readable form of this data on our side to
> disclose.
>
> We do declare "Emails or Text Messages", linked to the user, no tracking,
> App Functionality. The server reads who sends to whom and when, which is
> what that type covers here, and Apple's guidance on messaging apps asks
> for it.
>
> Our full answers, question by question, each quoting the sentence of our
> privacy policy it rests on, are public at
> https://github.com/mmaudet/messagr/blob/master/docs/declarations-magasins.md
> Our privacy policy is at https://messagr.eu/confidentialite

### Le manifeste `PrivacyInfo.xcprivacy`

Il déclare ce que l'application fait collecter elle-même, c'est-à-dire ce que garde le serveur, et pas ce que collecte Firebase : « Third-party SDKs need to provide their own privacy manifest files that record the types of data they collect. Your app's privacy manifest file doesn't need to cover data collected by third-party SDKs that your app links to. »

| `NSPrivacyCollectedDataType`                     | `Linked` | `Tracking` | `Purposes`                                          |
| ------------------------------------------------ | -------- | ---------- | --------------------------------------------------- |
| `NSPrivacyCollectedDataTypeUserID`               | `true`   | `false`    | `NSPrivacyCollectedDataTypePurposeAppFunctionality` |
| `NSPrivacyCollectedDataTypeDeviceID`             | `true`   | `false`    | `NSPrivacyCollectedDataTypePurposeAppFunctionality` |
| `NSPrivacyCollectedDataTypeEmailsOrTextMessages` | `true`   | `false`    | `NSPrivacyCollectedDataTypePurposeAppFunctionality` |
| `NSPrivacyCollectedDataTypeContacts`             | `true`   | `false`    | `NSPrivacyCollectedDataTypePurposeAppFunctionality` |
| `NSPrivacyCollectedDataTypeOtherUsageData`       | `true`   | `false`    | `NSPrivacyCollectedDataTypePurposeAppFunctionality` |

`NSPrivacyTracking` reste à `false`, sans `NSPrivacyTrackingDomains`, qu'Apple ne demande que dans l'autre cas : « To provide a list of internet domains in `NSPrivacyTrackingDomains`, set `NSPrivacyTracking` to `true`. » Les quatre catégories d'API à raison déclarée (`NSPrivacyAccessedAPITypes`) n'ont pas changé.

**Le rapport de confidentialité de Xcode en montrera davantage.** « Xcode can create a privacy report by aggregating the privacy manifests from your app and the third-party SDKs it links to. » Les pods Firebase que verrouille `Podfile.lock` déclarent, dans leurs propres manifestes :

| Pod                   | Type                  | Linked  | Purposes         |
| --------------------- | --------------------- | ------- | ---------------- |
| FirebaseMessaging     | `DeviceID`            | `false` | AppFunctionality |
| FirebaseMessaging     | `OtherDataTypes`      | `false` | Analytics        |
| FirebaseMessaging     | `OtherDiagnosticData` | `false` | AppFunctionality |
| FirebaseInstallations | `OtherDiagnosticData` | `false` | Analytics        |
| GoogleDataTransport   | `OtherDiagnosticData` | `false` | Analytics        |

Pourquoi les réponses d'App Store Connect n'en reprennent qu'une partie : tranché, 5.

## Les jugements

Sept questions où la règle laisse un choix. Chacune donne les faits, la règle lue, la réponse, et ce qui change si elle est prise autrement. Les tableaux plus haut et le manifeste portent cette réponse.

**Tranchés par le porteur le 16 septembre 2026 :** les points 1, 2, 3, 4 et 5.

**Devenus des tickets :** le 5 est #334, le 7 est #333.

**Encore ouvert :** le 6. Il n'attendait pas une décision mais une lecture de la configuration du relais, faite le 16 septembre ; ce qu'elle a trouvé est écrit dans sa section.

### 1. Le jeton de notification compte-t-il comme collecté ?

**Les faits.** Le serveur enregistre le jeton sous le compte, tant que les notifications sont actives (`pusher.ts`). Sur Android, le SDK de Firebase le fabrique et Google le garde : « Le jeton est un identifiant d'installation, renouvelé par Google, conservé tant que l'application est installée. » Sur iOS, le serveur garde le jeton APNs.

**Les règles.** Apple ne compte comme collecte que ce qui est gardé « for a period longer than what is necessary to service the transmitted request in real time ». Play n'exempte que le traitement éphémère, où les données « ne sont conservées en mémoire que le temps de répondre en temps réel à une demande précise », et cite l'« ID d'installation Firebase » parmi les exemples d'« Appareil ou autres ID ».

**Tranché le 16 septembre 2026 : collecté, et non partagé.** Le jeton est conservé, donc aucune des deux exceptions ne s'applique. Il n'est pas partagé au sens de Play, parce que Google ne s'en sert que pour acheminer le réveil de Messagr, ce qui fait de lui un fournisseur de services. Apple ne pose pas la question du partage, et ce qu'Apple garde elle-même ne se déclare pas.

**L'autre réponse, écartée.** « Appareil ou autres ID » et « Device ID » seraient restés déclarés de toute façon, pour les identifiants et les clés des appareils du compte. Seule la description aurait changé, et le manifeste n'aurait pas bougé.

### 2. Les adresses IP : dans quelle catégorie ?

**Les faits.** Elles sont à deux endroits : dans les journaux techniques, douze mois, par obligation légale ; et sous les yeux du relais d'appel, qui voit « l'adresse IP des téléphones qui s'en servent ». Aucune position n'en est tirée.

**Les règles.** Apple : « Declare the relevant data types based on how you use IP address, such as precise location, coarse location, device ID, or diagnostics. » Play : « vous devez indiquer que vous collectez, utilisez et partagez les adresses IP en fonction de leur utilisation et de leurs pratiques. Par exemple, si des développeurs se servent d'adresses IP pour déterminer la zone géographique, ils doivent déclarer ce type de données. »

**Tranché le 16 septembre 2026 : un identifiant d'appareil.** L'usage que la page nomme est celui du décret : conserver « les données permettant d'identifier la source d'une connexion, dont les adresses IP ». Identifier la source d'une connexion est l'usage d'un identifiant. D'où « Appareil ou autres ID » sur Play et « Device ID » chez Apple, avec « App Functionality », qui couvre « implement security measures ».

Sur Play, **deux finalités et non une seule**, parce que les adresses sont à deux endroits pour deux raisons : « Prévention des fraudes, sécurité et conformité » pour la conservation qu'impose le décret, et « Fonctionnement de l'application » pour le relais d'appel, qui voit une adresse afin d'acheminer le son et l'image. Le tableau de « Appareil ou autres ID », plus haut, porte déjà les deux.

**L'autre réponse, écartée.** Des diagnostics : « Diagnostics » sur Play, « Other Diagnostic Data » chez Apple, avec les mêmes finalités. C'est défendable pour des journaux de serveur web, moins pour une conservation que la loi impose afin d'identifier. Chez Apple, la conservation légale pourrait aussi ajouter « Other Purposes » (« Any other purposes not listed ») ; ce n'est pas recommandé, « App Functionality » la couvrant déjà.

### 3. « Contacts » pour le graphe des échanges et des invitations

**La question.** Sur une fiche, « Contacts » se lit « carnet d'adresses », et la page dit : « pas de carnet d'adresses, ni de contacts lus sur votre appareil. »

**Les règles.** Les deux définitions vont au-delà du carnet d'adresses. Play vise les « informations des graphes sociaux comme les noms d'utilisateur, la récence et la fréquence des contacts, la durée des interactions, et l'historique des appels ». Apple : « Such as a list of contacts in the user's phone, address book, or social graph ».

**Tranché le 16 septembre 2026 : déclarer « Contacts » dans les deux magasins.** Le serveur garde exactement un graphe social : « donc qui échange avec qui », et le lien « entre celui qui invite et celui qui entre ». Ne pas le déclarer reviendrait à choisir la lecture la plus commode d'une définition qui nomme ce cas. La nuance, un carnet d'adresses jamais lu, est dans la page, que les deux fiches lient.

Le coût est assumé : sur une fiche, « Contacts » se lira « lit mon carnet d'adresses », ce qui est faux. Deux choses l'atténuent. La page dit déjà « pas de carnet d'adresses, ni de contacts lus sur votre appareil ». Et la découverte par carnet d'adresses est en cadrage (#38) : le jour où elle arrive, ce type devra être déclaré de toute façon, et l'ajouter à ce moment-là ressemblerait à un aveu tardif.

**L'autre réponse, écartée.** Sur Play, tout ranger sous « Autres actions ». Chez Apple, garder « Emails or Text Messages » pour les échanges et ajouter « Other Data Types » pour les invitations. Retirer alors `NSPrivacyCollectedDataTypeContacts` du manifeste, et y mettre `NSPrivacyCollectedDataTypeOtherDataTypes`.

### 4. Le contenu chiffré de bout en bout, et la sauvegarde des clés

**Les faits.** Textes, photos et fichiers partent chiffrés, et le serveur garde le chiffré aussi longtemps que la conversation. Les clés de salon peuvent en outre être sauvegardées sur le serveur, chiffrées « by a recovery key the device generates and the server never sees » (ADR 0013). La page ne dit rien de cette sauvegarde.

**Play : une exception écrite.** Ce que « vous ou toute personne autre que l'expéditeur et le destinataire ne pouvez pas lire en raison d'un chiffrement de bout en bout » ne se déclare pas. Messages, photos et fichiers ne se déclarent donc pas. La sauvegarde non plus : sa clé de récupération n'est jamais envoyée au serveur, et l'expéditeur et le destinataire sont la même personne.

**Apple : pas d'exception écrite, mais une définition.** La collecte, c'est conserver « in a readable form ». Un chiffré dont le serveur n'a pas la clé n'est pas lisible : ne pas déclarer « Photos or Videos », ni « Other User Content ». L'expéditeur et les destinataires, eux, sont lisibles, et la définition d'« Emails or Text Messages » les nomme : ce type se déclare, comme le veut la consigne d'Apple sur la messagerie.

**Le risque.** Apple écrit aussi : « if you have a feature that enables users to upload a particular media type, such as photos or videos, then you'll need to disclose the specific type of data. » Un relecteur peut lire cette phrase sans la définition qui la précède. Déclarer « Photos or Videos » (App Functionality, lié, sans suivi) éviterait la discussion, au prix d'une collecte affichée que le serveur ne peut pas faire. Il faudrait alors ajouter `NSPrivacyCollectedDataTypePhotosorVideos` au manifeste, avec cette casse, qui est celle d'Apple.

**Tranché le 16 septembre 2026.** Sur Play, rien de plus que les quatre types. Chez Apple, « Emails or Text Messages » et pas « Photos or Videos ». C'est la réponse exacte : un chiffré dont le serveur n'a pas la clé n'est pas conservé « in a readable form ».

**Et la note au relecteur est écrite d'avance**, pour que la seule discussion probable se règle avant d'être ouverte plutôt qu'en pleine revue. Elle est plus bas, dans « La note au relecteur d'App Store Connect ». Déclarer « Photos or Videos » aurait fermé la question aussi, au prix d'une étiquette disant que Messagr collecte vos photos, liées à votre compte, ce que le serveur ne peut pas faire.

### 5. Firebase sur iOS, et ce que le SDK envoie de lui-même

**Les faits, lus dans le code et non mesurés sur un appareil.**

- L'application iOS ne demande à Firebase que le jeton APNs : `pushDevice.ts` appelle `registerDeviceForRemoteMessages`, puis `getAPNSToken`, et le réveil passe par Apple seule.
- Mais `AppDelegate.swift` appelle `FirebaseApp.configure()` dès que `GoogleService-Info.plist` est dans le bundle, et il y est.
- FirebaseMessaging 12.18.0 lit son initialisation automatique dans la clé `FirebaseMessagingAutoInitEnabled`. Faute de cette clé dans `Info.plist`, et faute de `firebase.json`, il se rabat sur le réglage global de collecte de Firebase, actif par défaut (`FIRMessaging.m`). La clé y est depuis #334, à `false` ; ce qu'elle change et ce qu'elle ne change pas est en fin de point.
- Quand le jeton APNs arrive sur une installation neuve, le gestionnaire de jetons obtient un identifiant d'installation Firebase, puis prépare une demande de jeton FCM qui porte le jeton APNs et l'identifiant de l'application Firebase (`FIRMessagingTokenManager.m`). Ses opérations de jeton reçoivent le « heartbeat » de Firebase.
- Firebase le dit à sa manière : « The FCM SDK performs method swizzling in two key areas: mapping your APNs token to the Firebase Installation ID or FCM registration token and capturing analytics data during downstream message callback handling. »

**Ce que cela contredit.** La page : « Sur iOS le même rôle est tenu par le service de notifications d'Apple. » Et `pushDevice.ts` : « Nothing about the push then goes near Google ». C'est vrai du réveil. D'après ce code, ce ne l'est pas de l'enregistrement : Google recevrait le jeton APNs et un identifiant d'installation.

**Les règles.** Apple fait déclarer les partenaires : « You must include information about your app's privacy practices and those of third-party partners whose code you integrate into your app. » Les manifestes des pods Firebase déclarent `DeviceID`, `OtherDataTypes` et `OtherDiagnosticData` (tableau du manifeste, plus haut).

**Tranché le 16 septembre 2026 au matin, puis RÉVISÉ le soir même. Les deux chemins sont pris, dans cet ordre.**

La décision du matin était : corriger le code, et rien d'autre. Mettre `FirebaseMessagingAutoInitEnabled` à `NO` dans `Info.plist`, après quoi la page redeviendrait vraie telle qu'elle était écrite. L'autre chemin — réécrire la page pour dire que Google reçoit aussi quelque chose sur iPhone — était écarté, au motif qu'il affaiblit la promesse sur iOS et demande un redéploiement du site.

**Ce qui a changé : la clé ne coupe pas ce qu'on croyait.** En la posant (#361), la lecture du pod a montré que ses trois seuls points de lecture sont hors de portée de cette application, et que la demande qui porte le jeton APNs vers Google part d'ailleurs — `setAPNSToken:withUserInfo:` dans `FIRMessagingTokenManager.m`, qui ne consulte cette clé à aucun moment. Le détail est en fin de point. La page ne redevenait donc pas vraie, et rien n'avait été corrigé.

- **La page est réécrite, et c'est fait** (#365). Elle dit désormais que le réveil d'un iPhone passe par Apple **et** que Google reçoit tout de même un identifiant d'installation et le jeton d'Apple, parce que la bibliothèque s'enregistre d'elle-même. Elle précise que c'est une correction de description et non de comportement, la section « Modifications » de cette page promettant qu'un changement est annoncé avant d'être appliqué. Date de version portée au 16 septembre 2026. **Ce n'est pas un affaiblissement de la promesse : c'est la promesse cessant de dire moins que ce qui se passe.**
- **Le code est corrigé ensuite, et autrement** : sortir Firebase du paquet iOS, où il ne sert qu'à demander le jeton d'Apple, et obtenir ce jeton par UIKit. En hexadécimal, comme `getAPNSToken` le rend aujourd'hui, sygnal étant configuré `convert_device_token_to_hex: false` (#325). En cadrage au 16 septembre 2026. Le jour où c'est fait, les deux paragraphes ajoutés à la page se resimplifient.
- **La vérification sur iPhone reste due**, et elle se groupe avec celles de #308 et #341, sur le même appareil. Elle exige un appareil **neuf ou effacé** : supprimer l'application ne vide pas de façon fiable le jeton conservé dans le trousseau, et une capture sur un téléphone qui a déjà porté `eu.messagr` ne prouverait rien. La marche exacte est écrite dans #361.
- La clé `FirebaseMessagingAutoInitEnabled` reste posée à `false`, et gardée par `scripts/assert-ios-push.sh` : elle remplace un défaut implicite par un choix explicite, ce qui vaut d'être tenu même si elle ne coupe rien.
- **D'ici là, chez Apple**, « Device ID » est déjà coché pour d'autres raisons. Ajouter « Other Diagnostic Data », non lié, « App Functionality », comme le déclare FirebaseMessaging.
- **Pas d'« Analytics »**, bien que FirebaseInstallations et GoogleDataTransport le déclarent. GoogleDataTransport n'est appelé que par `exportDeliveryMetricsToBigQueryWithMessageInfo:` (`FIRMessagingExtensionHelper.m`), que l'application n'appelle pas, et Firebase décrit cet export comme optionnel : « Collects and sends message delivery metrics to BigQuery if the BigQuery integration is enabled and setDeliveryMetricsExportToBigQuery is set to true. » Le reste sert à Google « to determine platform and version adoption in order to provide, maintain, and improve Firebase services », ce qui n'est pas évaluer le comportement des personnes dans l'application, la définition d'« Analytics » chez Apple.
- **Sur Android**, le même « Firebase user agent » part avec les requêtes de Firebase : « Device metadata: OS version, name, model, brand, and form factor », le magasin d'installation et les SDK présents. Il ne correspond à aucun type de Play : ce n'est pas un identifiant (« It is never linked to a user or device identifier. »), ni une mesure de performance. Ne rien ajouter sur Play, mais le dire sur la page.

**Ce que la clé fait, relu le 16 septembre 2026 en la posant (#334), et il en faut moins que ce qui est écrit plus haut.** `FirebaseMessagingAutoInitEnabled` est posée à `false`, et elle ne garde, dans FirebaseMessaging 12.18.0, que trois endroits dont aucun n'est atteint par cette application : la branche de `didCompleteConfigure` qui exige un jeton APNs déjà présent, ce qui n'arrive jamais pendant `FirebaseApp.configure()` ; `deleteDataWithCompletion:` ; et le passage de `setAutoInitEnabled:` à `YES`. La demande décrite au quatrième point ci-dessus part d'ailleurs : de `setAPNSToken:withUserInfo:` dans `FIRMessagingTokenManager.m`, qui sur une installation neuve demande un identifiant d'installation puis un jeton FCM, et ne lit cette clé à aucun moment. Le jeton APNs, lui, continue d'arriver : rien sur son chemin ne lit cette clé non plus.

**Ce que la clé ne fait donc pas encore, et ce que cela change pour les formulaires.** Il faut tenir pour possible que Firebase parle toujours à Google sur iPhone. « Other Diagnostic Data » reste donc déclaré, et le conditionnel ci-dessous n'est pas encore rempli. Les deux hôtes à observer pendant la mesure de #334 sont `firebaseinstallations.googleapis.com` et `fcmtoken.googleapis.com`, et au besoin `fcmregistrations.googleapis.com` et `device-provisioning.googleapis.com`.

**Si Firebase cesse de parler à Google sur iOS**, retirer « Other Diagnostic Data » d'App Store Connect. Le rapport de Xcode continuera d'afficher les types que déclarent les pods, puisqu'il lit leurs manifestes et non leur comportement. **La condition est une mesure sur un appareil, pas la présence de la clé** : c'est exactement ce que la lecture ci-dessus dit de ne pas confondre.

### 6. « Toutes chiffrées lors de leur transit », et le relais en `turn:`

**Les faits.** L'application joint le serveur et le service d'invitations en HTTPS, Firebase parle à Google en HTTPS, et le son et l'image d'un appel sont chiffrés. Mais le 13 septembre 2026, messagr.eu distribuait deux adresses de relais, `turn:messagr.eu:3479` et `turns:messagr.eu:5350` (`docs/mesurer-le-debit-video.md`), et `ice.ts` accepte les deux. Sur `turn:`, les messages de contrôle du relais passent en clair, avec le nom d'utilisateur que le serveur délivre pour l'appel. Avec l'authentification par secret partagé que proposent Synapse et Continuwuity, ce nom est de la forme « expiration:identifiant du compte ». La configuration de messagr.eu n'est pas dans le dépôt, et ce document ne l'a pas vérifiée.

**La règle.** Play demande si les données « sont-elles chiffrées lors de leur transfert entre l'appareil de l'utilisateur final et le serveur ? », et précise, dans le format proposé aux fournisseurs de SDK, que « les développeurs ne peuvent déclarer le chiffrement en transit que s'il s'applique à toutes les données utilisateur collectées par leur application (y compris l'ensemble des bibliothèques et des SDK) et transmises en dehors de l'appareil de l'utilisateur. »

**RÉPONSE : Oui. Le premier des deux points est établi depuis le 16 septembre 2026** (#338).

`turn_uris` du homeserver de production ne porte plus qu'une adresse, `turns:messagr.eu:5350?transport=tcp`. Les deux `turn:messagr.eu:3479` sont retirées, donc le nom d'utilisateur — `<expiration>:<user_id>` — ne traverse plus le réseau en clair.

Mettre `turns:` en premier ne suffisait pas, et le croire était l'erreur à défaire : WebRTC alloue contre **chaque** URI de la liste pendant la collecte de candidats, il n'essaie pas la première puis les suivantes. L'ordre pèse sur la priorité des candidats obtenus, pas sur le fait de contacter un serveur (`packages/app/src/calls/ice.ts` garde toutes les URI qui relaient, `callMedia.ts:164` les verse toutes dans une seule entrée `iceServers`).

**Le filet retiré, et pourquoi il pouvait l'être.** Les URI en clair servaient de secours : un certificat expiré ne fait pas tomber coturn, il le fait retomber sur l'écouteur en clair ; sans elles, il fera échouer les appels. Ce filet n'a été retiré qu'après avoir **mesuré** le renouvellement, et non l'avoir supposé. `/etc/letsencrypt/renewal-hooks/deploy/messagr-turn.sh` recopie le certificat puis envoie `SIGUSR2` à `messagr-turn` ; exercé à la main comme certbot l'appelle, coturn a journalisé « Reloading TLS certificates and keys » et son PID n'a pas bougé — donc pas une allocation coupée. `certbot.timer` tourne deux fois par jour depuis mai 2026. Et si ce crochet échouait, l'ancien certificat reste valide un mois après la date de renouvellement.

**Ce qui n'est pas mesuré**, et ne l'empêche pas : que les adresses en clair étaient effectivement jointes. Une adresse qu'on n'annonce plus ne peut pas l'être.

### 7. La suppression de compte

**Les faits.**

- L'application n'offre aucun chemin de suppression de compte : ni écran, ni appel de désactivation, dans `packages/app/src` relu le 15 septembre 2026.
- La page donne l'adresse et le délai : « Écrivez à conformite@messagr.eu. » ; « À la suppression d'un compte, il est désactivé immédiatement et ses données sont purgées sous trente jours. » Ses titres n'ont pas d'ancre, et aucun lien ne peut viser « Vos droits ».
- La purge n'est pas outillée : « Aucune purge automatique n'existe. » (`deploy/messagr-eu/retention.json`, #71).

**Les règles.** Un compte Messagr est un compte au sens de Play : « a unique user identity that developers provide as a user-facing feature to serve the user across applications and/or devices ». Une application qui en crée doit « provide users with an in-app path to delete their app accounts and associated data », ce qui peut être un lien : « you can choose to provide a link within your app that takes users to your app account deletion web resource ». Elle doit aussi fournir une ressource web qui « reference the app or developer name », où « the pathway to request account deletion should be prominently featured and easily discoverable on the page ». Une adresse suffit comme moyen (« a customer service email »), et une politique de confidentialité peut servir si « the data deletion section should be highlighted and reasonably prominent (for example, through an anchor link) ».

**Recommandation.**

- Répondre **Oui** à « Proposez-vous aux utilisateurs un moyen de demander la suppression de leurs données ? » : conformite@messagr.eu en est un.
- Savoir que l'exigence de suppression de compte n'est pas remplie pour autant, et que c'est **#333** : sur la page, une section consacrée à la suppression, avec une ancre, qui nomme Messagr et dit quoi écrire ; dans les réglages, un lien vers elle. L'adresse de cette section répond aussi à la question de Play sur le lien de suppression, et à « Privacy Choices » chez Apple.
- Outiller la purge (#71) avant d'afficher « trente jours » dans un magasin.
- Les « App Review Guidelines » d'Apple ont une règle comparable sur la suppression de compte. Elles n'ont pas été relues pour ce document : à vérifier avant la prochaine soumission.

## Ce que la page ne dit pas encore

Ce que les questions des magasins demandent et que la page ne permet pas de citer. Aucun de ces points n'a été corrigé ici : #321 ne touche pas la page.

1. **La sauvegarde des clés de salon sur le serveur**, chiffrée sous une clé qu'il n'a pas (ADR 0013). La page dit : « Les clés ne quittent jamais les appareils. » (point 4)
2. **Firebase sur iOS.** La page ne nomme qu'Apple pour l'iPhone ; d'après le code du SDK, Google reçoit le jeton APNs et un identifiant d'installation. (point 5)
3. **Ce que le SDK de Firebase envoie de lui-même**, sur les deux plateformes : l'identifiant d'installation, le modèle et la version du système, les SDK présents. La page ne nomme que « un jeton d'appareil ». (point 5)
4. **Le chiffrement du transport.** Play le demande ; la page ne parle que du contenu. (point 6)
5. **Comment demander la suppression d'un compte**, dans une section qu'un lien peut viser, avec ce qui reste après. (point 7)
6. **Combien de temps durent la trace des demandes d'accès au relais et les adresses IP qu'il voit.** La page dit ce que voit le relais, pas combien de temps il le garde.
