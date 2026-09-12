# Mesurer le débit d'un appel vidéo

`VIDEO_CEILING_BPS` vaut 1 200 000, et le commentaire qui l'accompagne dit
d'elle qu'elle est **un nombre à mesurer, pas à croire**. #199 demande cette
mesure, comparée à 2,5 Mbit/s, sur un appel réel entre deux téléphones.

Ce document existe pour que ce soit un geste de vingt minutes le jour où un
second appareil se présente, plutôt qu'un chantier à réinventer. Il ne
remplace pas la mesure : il la rend possible.

## Ce qu'on cherche à savoir, et ce n'est pas « combien »

La question n'est pas le débit en soi. C'est : **le plafond choisi donne-t-il
une image acceptable, et le relais tient-il ?**

Deux échecs sont possibles et se ressemblent à l'œil :

- **trop haut** — coturn atteint `max-bps=400000` (3,2 Mbit/s par sens) et
  **jette**. Ce qui se voit est une image qui hache, indiscernable d'un
  mauvais réseau ;
- **trop bas** — WebRTC descend en résolution avant d'en avoir besoin, et
  l'image est douce pour rien.

Le plafond applicatif existe pour que le premier n'arrive jamais : dire à
l'émetteur de se tenir fait descendre WebRTC en résolution _proprement_, au
lieu de laisser le relais trancher dans le flux.

> **`max-bps=400000` n'est pas vérifiable depuis ce dépôt.** La
> configuration de coturn vit sur l'hôte du relais, pas ici ; le chiffre est
> seulement _cité_, dans `packages/app/src/calls/ceiling.ts` et dans
> `callMedia.ts`. Première chose à faire en montant sur l'hôte : relire
> `turnserver.conf` et confirmer que la citation est encore juste. Si elle ne
> l'est pas, tout le raisonnement de la moitié tombe, et c'est la mesure qui
> l'apprendra.

## Ce qu'il faut

- **Deux téléphones**, et **deux réseaux différents**. Deux appareils sur le
  même Wi-Fi peuvent trouver un chemin direct si la politique de transport ICE
  est mal appliquée ; deux réseaux forcent le relais à servir, ce qui est ce
  qu'on mesure.
- Un accès au journal de chaque appareil (`adb logcat` sur Android,
  Console.app sur iOS).
- Un accès à l'hôte du relais pour lire ce que coturn a compté.
- **Un chronomètre**, ou mieux : une durée fixe décidée d'avance. Soixante
  secondes suffisent et se comparent.

## Étape 1 — vérifier que le plafond a bien été posé

Sans ça, la mesure porte sur autre chose que ce qu'on croit lire. L'appareil
le dit lui-même, une fois par piste vidéo ajoutée :

```
adb logcat -s ReactNativeJS | grep MESSAGR_VIDEO_CEILING
```

```
MESSAGR_VIDEO_CEILING {"bps":1200000}
```

`{"bps":null}` veut dire qu'il n'y avait aucun encodage à plafonner au moment
où l'on a demandé — la négociation n'avait pas encore produit de couche. Une
mesure prise sur cet appel-là ne dit rien du plafond.

## Étape 2 — l'appel, à durée fixe

Placer l'appel vidéo depuis le bouton caméra de l'en-tête, décrocher sur
l'autre appareil, laisser tourner **soixante secondes**, raccrocher.

Pendant l'appel, noter à l'œil : l'image est-elle nette ? saccade-t-elle ?
Ces deux observations valent autant que les octets, et elles ne se
retrouveront pas après coup.

## Étape 3 — lire ce que le relais a compté

coturn est le seul juge neutre : il voit les deux sens, et il ne se ment pas
à lui-même comme un émetteur pourrait le faire sur ce qu'il croit avoir
envoyé.

Sur l'hôte du relais, chaque session close écrit son compte :

```
journalctl -u coturn --since '-10 min' | grep -E 'closed|usage'
```

Les lignes d'usage portent les octets et les paquets, par sens. Diviser par
la durée de l'appel donne le débit moyen.

> **Moyenne, et pas crête.** Un appel qui démarre doucement puis monte a une
> moyenne plus basse que son régime. C'est pourquoi la durée est fixe et
> annoncée : deux mesures de soixante secondes se comparent, deux mesures de
> durées différentes non.

## Étape 4 — recommencer à 2,5 Mbit/s

Changer `VIDEO_CEILING_BPS` dans `packages/app/src/calls/ceiling.ts` :

```ts
export const VIDEO_CEILING_BPS = 2_500_000
```

Reconstruire, réinstaller **sur les deux appareils**, et refaire les étapes 1
à 3 à l'identique — même durée, mêmes réseaux, si possible dans la même
demi-heure. Un réseau n'est pas le même à deux heures d'intervalle.

Un test de `ceiling.spec.ts` rougira : il refuse un plafond au-delà de la
moitié de ce que coturn autorise. C'est voulu — il est là pour empêcher que
ce changement parte par mégarde, pas pour empêcher de le mesurer. Le rendre
vert n'est pas le but de l'expérience.

## Le tableau à remplir

|                                         | 1,2 Mbit/s | 2,5 Mbit/s |
| --------------------------------------- | ---------- | ---------- |
| débit sortant mesuré (moyenne sur 60 s) |            |            |
| débit entrant mesuré                    |            |            |
| coturn a-t-il jeté des paquets ?        |            |            |
| l'image saccade-t-elle ?                |            |            |
| la résolution tient-elle ?              |            |            |

## Ce que la mesure décide

**Si 1,2 donne une image acceptable et 2,5 ne fait pas mieux** — le plafond
reste où il est, et le commentaire de `ceiling.ts` cesse de dire « à
mesurer » pour dire « mesuré, tel jour, tels chiffres ».

**Si 2,5 fait nettement mieux sans que coturn jette** — le plafond monte, et
`max-bps` du relais est à relire en même temps : la moitié est une règle de
pouce, pas une loi.

**Si 2,5 fait jeter coturn** — c'est la démonstration que le plafond
applicatif sert à quelque chose, et elle vaut d'être écrite : c'est
exactement le défaut qu'il existe pour éviter, observé une fois plutôt que
supposé.

Dans les trois cas, le résultat va dans le commentaire de `VIDEO_CEILING_BPS`
et dans #199. Une mesure qu'on ne consigne pas est une mesure à refaire.
