# La clé dans `google-services.json`

GitHub signale une « Google API Key » exposée dans ce dépôt, qui est public.
Ce document existe pour que la prochaine personne qui reçoit cette alerte
trouve la réponse au lieu de refaire l'analyse — et surtout pour qu'elle ne
fasse pas le geste qui semble évident et qui ne sert à rien.

## Ce n'est pas un secret, et Google le dit

L'`api_key` de `google-services.json` est **conçue pour être embarquée**. Elle
est dans chaque APK distribué : quiconque télécharge l'application l'a déjà, et
l'extraire d'un `.apk` prend une commande. La publier dans un dépôt public
n'ajoute rien à ce que la distribution expose de toute façon.

Elle **identifie** le projet Firebase ; elle n'**autorise** rien par elle-même.
Le contrôle d'accès aux services Firebase passe par les règles de sécurité et
par App Check, pas par le secret de cette chaîne.

## Ce qui serait faux de faire

**La faire tourner.** Une rotation ne réduit aucune exposition — la nouvelle
clé partirait dans le prochain APK, exactement comme l'ancienne — et casserait
chaque installation existante jusqu'à sa mise à jour. Sur ce projet, à ce jour,
cela veut dire le Pixel de démonstration et le téléphone de la première
personne invitée : deux appareils qu'AGENTS.md §7.2 gèle sur leur signature et
interdit de désinstaller.

Le geste coûteux, visible, et sans effet.

## Ce qui compte vraiment

**Une clé d'API Google peut appeler toute API activée sur le projet tant
qu'elle n'est pas restreinte.** C'est le seul risque réel, et il n'a rien à
voir avec la publication du fichier : il existait déjà dans l'APK.

La mitigation est dans la console Google Cloud, sur la clé elle-même :

- **Restriction d'application** : Android, avec le nom de paquet `eu.messagr`
  et les empreintes SHA-1 de signature — celles que
  `deploy/messagr-eu/android-fingerprints.json` tient déjà, et pour la même
  raison qu'il les tient.
- **Restriction d'API** : uniquement ce dont Firebase Cloud Messaging a besoin.
  Une clé qui ne peut appeler que FCM ne peut pas faire grimper une facture
  ailleurs.

Une clé restreinte dans un dépôt public est moins intéressante qu'une clé non
restreinte dans un APK.

## Ce qui a été retiré le 7 septembre 2026

Le fichier déclarait **trois** paquets : `eu.messagr`, plus
`cloud.maudet.messagr` et `cloud.maudet.reveil`, morts depuis que le namespace
du gabarit a été corrigé. Les mêmes noms périmés que `assetlinks.json` servait
encore la veille.

Ils ne créaient pas de faille — mais ils élargissaient ce que la clé couvre à
deux applications qui n'existent plus, ce qui est exactement ce qu'une
restriction d'application cherche à empêcher. Un seul client reste, et il
correspond à l'`applicationId` du build.

## Et si l'alerte revient

Elle reviendra : le motif est toujours là, et il doit l'être. Marquez-la
traitée en renvoyant ici plutôt qu'en la refermant sans raison — une alerte
close sans motif est une alerte que la suivante ressemblera à tort.
