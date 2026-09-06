# La passerelle sygnal de messagr.eu

Le fichier `sygnal.yaml` déployé, versionné ici parce qu'il ne l'était pas.

## Pourquoi il est dans le dépôt

Il ne vivait que sur hermes, dans `/opt/messagr-sygnal/conf/`. C'est la même
situation que celle décrite dans #108 pour le service d'invitations et dans
#106 pour le site : une surface du produit avec des propriétés réelles, dont
rien ici ne verrait le changement.

Aucun secret dedans. `service_account_file` et `keyfile` sont des chemins vers
des fichiers montés ; `key_id` et `team_id` sont des identifiants Apple
publics.

## Ce qui a été ajouté, et pourquoi c'était cassé

Une entrée `apps:` pour **`eu.messagr`**. La clé d'une entrée sygnal doit être
exactement l'`app_id` que le client déclare dans son pusher, c'est-à-dire son
`applicationId` Gradle. Le client déclarait `cloud.maudet.messagr` —
l'ancien identifiant, celui du prototype Kotlin — et sygnal ne portait aucune
entrée pour le nouveau.

**Un désaccord ne produit aucune erreur.** Le homeserver ne trouve pas de
pushkin, laisse tomber la notification, et n'en dit rien. Sygnal ne journalise
rien. L'appareil n'est simplement jamais réveillé. C'est le genre de panne
qu'on ne trouve qu'en la cherchant, et elle a été trouvée en relecture.

## Ce qui n'est pas encore déployé

Ce fichier. Le pusher pointe sur `/_messagr/_matrix/push/v1/notify`, qui
n'existe que dans le service de ce dépôt, lequel n'est pas celui qui tourne
(#108). Déployer cette entrée seule ne réveillerait rien de plus. Les deux
vont ensemble.

## Deux pièges consignés

- **`api_version: v1` doit être écrit** dans chaque entrée. Sans cette ligne,
  sygnal retombe silencieusement sur l'API que Google a retirée en juin 2024 :
  la passerelle démarre, reçoit, et n'envoie jamais rien.
- **Sygnal journalise le `pushkey` en entier, au niveau INFO, à chaque envoi.**
  C'est le jeton FCM de l'appareil, et qui le détient peut réveiller cet
  appareil. À trancher avant d'expédier ces journaux ailleurs.
