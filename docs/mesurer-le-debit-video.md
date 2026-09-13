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

> **`max-bps=400000` a été relu sur le relais le 13 septembre 2026.** La
> configuration de coturn ne vit pas dans ce dépôt, où le chiffre est
> seulement _cité_, dans `packages/app/src/calls/ceiling.ts` et dans
> `callMedia.ts`. Sur l'hôte `hermes`, le relais est le conteneur Docker
> `messagr-turn`, qui lit le fichier monté
> `/opt/messagr-turn/conf/turnserver.conf` : on y lisait ce jour-là
> `max-bps=400000` à la ligne 268, `user-quota=6`, `log-file=stdout` et
> `verbose`. Première chose à faire en montant sur l'hôte : relire ces clés,
> et seulement elles.
>
> ```
> ssh hermes 'grep -nE "^(max-bps|user-quota|log-file|verbose)\b" /opt/messagr-turn/conf/turnserver.conf'
> ```
>
> Si la citation n'est plus juste, tout le raisonnement de la moitié tombe, et
> c'est la mesure qui l'apprendra.

> **Ne jamais afficher la configuration ni la ligne de commande complètes du
> conteneur : elles portent un secret.** La configuration se lit en filtrant
> des clés nommées du fichier monté, comme ci-dessus ; les comptes se lisent
> dans le journal du conteneur.

## Ce qu'il faut

- **Deux téléphones**, et **deux réseaux différents**. Deux appareils sur le
  même Wi-Fi peuvent trouver un chemin direct si la politique de transport ICE
  est mal appliquée ; deux réseaux forcent le relais à servir, ce qui est ce
  qu'on mesure.
- **Deux comptes sur le même serveur**, puisque le relais qu'on lit est celui
  que ce serveur distribue. Le 13 septembre, `messagr.eu` comme le banc
  `messagr-fork.maudet.cloud` distribuaient `turn:messagr.eu:3479` et
  `turns:messagr.eu:5350`, qui sont les ports de `messagr-turn`.
- Les deux builds de la section suivante.
- Un accès au journal de chaque appareil (`adb logcat` sur Android,
  Console.app sur iOS).
- Un accès à `hermes`, l'hôte du relais, pour lire ce que coturn a compté.
- **Un chronomètre**, ou mieux : une durée fixe décidée d'avance. Soixante
  secondes suffisent et se comparent.

## Les deux builds

Le plafond est une constante compilée dans le JavaScript : le mesurer à
2,5 Mbit/s demande une autre build, et celle du magasin ne porte que 1,2. Deux
APK de debug ont été construites le 13 septembre 2026 depuis `3b0153c`,
identiques à la constante près, et rangées sur la machine du porteur avec un
`SHA256SUMS` et un `LISEZ-MOI.txt` :

```
~/messagr-builds/199/messagr-plafond-1200000.apk
~/messagr-builds/199/messagr-plafond-2500000.apk
```

Toutes deux sont signées par le keystore de debug commité
(`FA:C6:17:45:…:3B:9C`), comme la build de debug que porte le Pixel de
démonstration, et portent le même `versionCode`. Passer de sa build à l'une
d'elles, ou de l'une à l'autre, est donc une mise à jour : le compte reste.

**Le Pixel ne reçoit que des mises à jour.** Depuis le 13 septembre 2026, il
porte le compte de production qui invitera à l'essai. Jamais de
désinstallation, ni d'effacement de ses données : l'une comme l'autre
perdrait ce compte, ses clés et son historique, et `scripts/pixel.sh` dit ce
que cela coûte.

```
adb -s 59021FDCG003NW install -r ~/messagr-builds/199/messagr-plafond-1200000.apk
```

**Le second téléphone sert d'abord à la répétition de l'essai**, avec la build
de la piste interne de Play, et à #199 seulement ensuite. Play signe avec sa
propre clé, et Android refuse une mise à jour signée par une autre
(`INSTALL_FAILED_UPDATE_INCOMPATIBLE`) : la build Play se retire avant de poser
l'APK. Cela efface le compte de la répétition, ses clés et son historique.

```
adb -s <série> uninstall eu.messagr
adb -s <série> install ~/messagr-builds/199/messagr-plafond-1200000.apk
```

**Il entre ensuite en production par une invitation du Pixel.** L'application
n'a aucun champ où coller un lien : son écran d'accueil le dit, le lien
d'invitation est « la seule porte ». Sur le Pixel, _Inviter quelqu'un_ (le
« + »), puis _Partager le lien_ pour le faire arriver sur le Mac. Il vaut une
heure et ne sert qu'une fois.

Ouvrir ce lien sur le second téléphone ne suffit pas. Une build de debug neuve
ne vérifie pas les liens de `messagr.eu` : le Pixel, réinstallé en debug le
13 septembre, répond `messagr.eu: 1024` à `adb shell pm get-app-links
eu.messagr`. Android garde donc le lien dans le navigateur, et le bouton
_Ouvrir dans Messagr_ de la page n'y peut rien : c'est un lien vers la même
adresse, qui n'entre dans l'application que si ses liens sont vérifiés
(`deploy/messagr-eu/site/i/index.html` le dit en commentaire). La porte est la
commande qui adresse le lien au paquet lui-même, depuis le Mac, et qui ne
demande aucune vérification :

```
adb -s <série> shell am start -a android.intent.action.VIEW -d 'https://messagr.eu/i/<jeton>' eu.messagr
```

Garder Messagr ouvert sur le Pixel pendant ce temps : il admet la personne qui
a réclamé à chaque tour de synchronisation, pendant l'heure que vaut le lien.

> **Une build de debug préfère Metro à son propre bundle.** Au lancement, elle
> demande à `localhost:8081` si Metro tourne et, s'il répond, exécute le
> JavaScript qu'il sert (`ReactHostImpl.kt`). Un téléphone branché à une
> machine où Metro tourne, avec un `adb reverse tcp:8081`, exécute donc le code
> de cette machine et pas celui de l'APK. `adb -s <série> reverse --list` ne
> doit rien lister, et l'étape 1 est ce qui le prouve.

Pour les refaire : ce que fait `scripts/pixel.sh` sans l'installation, une fois
par valeur, depuis `packages/app`. Une build de debug n'embarque pas le
JavaScript d'elle-même, et une APK sans bundle frais transporterait un vieux
code sans rien dire. Sur une machine où la suite de bout en bout a construit,
ajouter `--reset-cache` au bundle : `babel.config.js` dit pourquoi.

```
npx react-native bundle --platform android --dev false --entry-file index.js \
  --bundle-output android/app/src/main/assets/index.android.bundle \
  --assets-dest android/app/src/main/res
(cd android && ./gradlew assembleDebug)
```

Le minifieur n'écrit pas `1_200_000` mais `12e5`. Ce que porte une APK se lit
donc ainsi, et doit rendre une seule ligne :

```
unzip -p messagr-plafond-2500000.apk assets/index.android.bundle | grep -oE '(12|25)e5'
```

## Étape 1 — vérifier que le plafond a bien été posé

Sans ça, la mesure porte sur autre chose que ce qu'on croit lire. L'appareil
le dit lui-même, une fois par piste vidéo ajoutée. Sur chaque téléphone, dans
son propre terminal, lancé avant l'appel :

```
adb -s <série> logcat -s ReactNativeJS | grep --line-buffered MESSAGR_VIDEO_CEILING
```

```
MESSAGR_VIDEO_CEILING {"bps":1200000}
```

`logEvent` écrit par `console.log`, sans condition de build : la ligne sort
aussi d'une build de debug.

`{"bps":null}` veut dire qu'il n'y avait aucun encodage à plafonner au moment
où l'on a demandé — la négociation n'avait pas encore produit de couche. Une
mesure prise sur cet appel-là ne dit rien du plafond.

## Étape 2 — l'appel, à durée fixe

Noter l'heure juste avant de placer l'appel, dans le terminal où l'on lira le
relais : son journal se lit à partir d'elle.

```
T0=$(date -u +%Y-%m-%dT%H:%M:%SZ)
```

Placer l'appel vidéo depuis le bouton caméra de l'en-tête, décrocher sur
l'autre appareil, laisser tourner **soixante secondes**, raccrocher.

Pendant l'appel, noter à l'œil : l'image est-elle nette ? saccade-t-elle ?
Ces deux observations valent autant que les octets, et elles ne se
retrouveront pas après coup.

## Étape 3 — lire ce que le relais a compté

coturn est le seul juge neutre : il voit les deux sens, et il ne se ment pas
à lui-même comme un émetteur pourrait le faire sur ce qu'il croit avoir
envoyé.

Sur `hermes`, coturn n'est pas un service systemd : `journalctl -u coturn`
répond « No entries », ce qui se lirait comme un relais qui n'a rien vu. C'est
le conteneur `messagr-turn`. Il écrit sur sa sortie standard
(`log-file=stdout`), donc dans le journal du conteneur, et ses lignes de compte
n'existent que parce que `verbose` est posé.

Ce journal porte les adresses IP des gens qui appellent. Les commandes
ci-dessous n'en affichent aucune : les lignes de compte n'en portent pas, et le
tri se fait sur le serveur. Pour lire autre chose du journal, masquer avant
d'afficher, IPv6 comprise :

```
ssh hermes 'docker logs --since 10m messagr-turn 2>&1 | sed -E "s/[0-9]{1,3}(\.[0-9]{1,3}){3}/<ip>/g; s/([0-9a-fA-F]{0,4}:){3,8}[0-9a-fA-F]{0,4}/<ip6>/g"'
```

### Ce que disent les lignes

Deux lignes par session, écrites au même instant. Ici une paire d'un vrai
appel relayé, le 9 septembre, compte masqué :

```
session 000000000000000188: usage: realm=<messagr.eu>, username=<1789059245:@…:messagr-fork.maudet.cloud>, rp=1162, rb=731670, sp=886, sb=575117
session 000000000000000188: peer usage: realm=<messagr.eu>, username=<1789059245:@…:messagr-fork.maudet.cloud>, rp=886, rb=571493, sp=1162, sb=731598
```

- Une **session** est une allocation sur le relais. Un téléphone en ouvre
  plusieurs par appel (son serveur distribue trois adresses), et une seule
  porte le média : on les somme toutes.
- `usage:` est le côté du téléphone. `rp` et `rb` sont les paquets et les
  octets que le relais a **reçus du téléphone**, donc ce qu'il envoie ; `sp` et
  `sb`, ce que le relais **lui a envoyé**, donc ce qu'il reçoit.
- `peer usage:` est l'autre bout : `rp` et `rb` reçus de l'autre partie, `sp`
  et `sb` envoyés vers elle. C'est le même trafic : les 1 162 paquets reçus du
  téléphone repartent en 1 162 paquets, et les octets ne diffèrent que de
  l'encadrement TURN, moins d'un pour cent.
- **Les lignes sont périodiques, pas cumulées.** coturn écrit une paire chaque
  fois que ses quatre compteurs de paquets totalisent 4 096, puis les remet à
  zéro ; la paire écrite à la fermeture porte le reste. Le total d'une session
  est donc la **somme** de ses lignes, et il n'est complet qu'une fois sa ligne
  `closed` écrite. Lu le 13 septembre dans `turn_report_session_usage`, dans le
  source de coturn 4.11.0, la version que le conteneur annonce au démarrage, et
  vérifié sur cet appel : quinze paires, dont les quatre compteurs font 4 096 à
  chacune sauf la dernière.

### Les commandes

Sur la machine du porteur, après avoir raccroché, avec `T0` noté à l'étape 2.
Quels comptes ont pris le relais depuis :

```
ssh hermes "docker logs --since '$T0' messagr-turn 2>&1 | grep -F 'ALLOCATE processed, success' | grep -oE 'user <[0-9]+:@[^>]+>'" | sed -E 's/user <[0-9]+://; s/>$//' | sort | uniq -c
```

Puis, pour chacun des deux :

```
COMPTE='@…:messagr.eu'
```

Ses sessions sont-elles closes ? Chaque `usage` doit avoir son `closed`, sinon
le reste n'est pas encore écrit. Un appel raccroché rend ses allocations dans
la seconde ; un téléphone qui a perdu le réseau laisse les siennes expirer.

```
ssh hermes "docker logs --since '$T0' messagr-turn 2>&1 | grep -F ':$COMPTE>' | grep -oE 'session [0-9]+: (usage|closed)'" | sort | uniq -c
```

Son débit moyen par sens, sur les soixante secondes :

```
ssh hermes "docker logs --since '$T0' messagr-turn 2>&1 | grep -F ':$COMPTE>' | grep -E ': (peer )?usage: '" | awk -v duree=60 '
    { cote = ($0 ~ / peer usage: /) ? "pair" : "tel"
      for (i = 1; i <= NF; i++) if ($i ~ /^(rp|rb|sp|sb)=/) { split($i, kv, "="); t[cote, kv[1]] += kv[2] + 0 } }
    END {
      printf "sortant : %.2f Mbit/s (%.0f octets)\n", t["tel", "rb"] * 8 / duree / 1e6, t["tel", "rb"]
      printf "entrant : %.2f Mbit/s (%.0f octets)\n", t["tel", "sb"] * 8 / duree / 1e6, t["tel", "sb"]
      printf "requêtes %.0f, réponses %.0f : un écart est un paquet jeté\n", t["tel", "rp"] - t["pair", "sp"], t["tel", "sp"] - t["pair", "rp"]
    }'
```

Le sortant de l'un retrouve l'entrant de l'autre, puisque les deux passent par
le même relais. Sur l'appel du 9 septembre, les deux sessions qui portaient le
média se recoupaient à moins d'un pour cent : 9 026 445 octets sortis d'un
côté, 8 981 748 entrés de l'autre, et 9 701 156 contre 9 709 427 dans l'autre
sens.

> **Moyenne, et pas crête.** Un appel qui démarre doucement puis monte a une
> moyenne plus basse que son régime. C'est pourquoi la durée est fixe et
> annoncée : deux mesures de soixante secondes se comparent, deux mesures de
> durées différentes non. Le régime, si on le veut, se lit entre deux paires
> successives avec `docker logs -t` : sur l'appel du 9 septembre, 731 670
> octets en 4,9 secondes, soit 1,19 Mbit/s.

### Jeté ou pas

coturn n'écrit rien quand il jette : le chemin qui abandonne un paquet en
écriture « fait comme si tout allait bien ». Son budget est de `max-bps`
octets par seconde d'horloge, par socket et par sens, si bien qu'une moyenne
sous 3,2 Mbit/s n'exclut pas une seconde au-dessus.

Ce qu'il jette **en écrivant** se lit pourtant dans la dernière ligne de la
commande. `usage rp` moins `peer usage sp` compte les requêtes du téléphone au
relais, `usage sp` moins `peer usage rp` les réponses du relais ; les deux sont
égaux quand rien n'est jeté (13 et 13, 7 et 7 sur l'appel du 9 septembre), et
chaque paquet jeté, dans un sens ou dans l'autre, creuse l'écart d'un. Ce qu'il
jette **en lisant** n'entre dans aucun compte, le contrôle précédant le
comptage : celui-là ne se voit qu'à l'image.

### Refusé

L'autre limite du relais ne jette pas, elle refuse : `user-quota=6` borne les
allocations simultanées d'un même nom d'utilisateur. Sur l'appel du
9 septembre, l'un des deux téléphones en a obtenu six et s'en est vu refuser
douze dans la même minute (`error 486: Allocation Quota Reached`), l'autre en a
eu trois. L'appel a tenu, mais un appel qui ne s'établit pas commence par ce
compte-là :

```
ssh hermes "docker logs --since '$T0' messagr-turn 2>&1 | grep -F ':$COMPTE>' | grep -c 'ALLOCATE processed, error 486'"
```

## Étape 4 — recommencer à 2,5 Mbit/s

Poser la seconde APK sur les deux téléphones, par-dessus la première :

```
adb -s 59021FDCG003NW install -r ~/messagr-builds/199/messagr-plafond-2500000.apk
adb -s <série> install -r ~/messagr-builds/199/messagr-plafond-2500000.apk
```

Rouvrir l'application sur chacun, et refaire les étapes 1 à 3 à l'identique —
même durée, mêmes réseaux, si possible dans la même demi-heure. Un réseau n'est
pas le même à deux heures d'intervalle. L'étape 1 doit dire `{"bps":2500000}` ;
si elle dit encore 1200000, le téléphone n'exécute pas l'APK qu'on croit.

Sans les APK, c'est `VIDEO_CEILING_BPS` dans
`packages/app/src/calls/ceiling.ts` qui change, avant de refaire les builds :

```ts
export const VIDEO_CEILING_BPS = 2_500_000
```

Un test de `ceiling.spec.ts` rougira : il refuse un plafond au-delà de la
moitié de ce que coturn autorise. C'est voulu — il est là pour empêcher que
ce changement parte par mégarde, pas pour empêcher de le mesurer. Le rendre
vert n'est pas le but de l'expérience.

À la fin, rendre au Pixel la valeur de `master` :

```
adb -s 59021FDCG003NW install -r ~/messagr-builds/199/messagr-plafond-1200000.apk
```

## Le tableau à remplir

|                                         | 1,2 Mbit/s | 2,5 Mbit/s |
| --------------------------------------- | ---------- | ---------- |
| débit sortant mesuré (moyenne sur 60 s) |            |            |
| débit entrant mesuré                    |            |            |
| coturn a-t-il jeté des paquets ?        |            |            |
| a-t-il refusé des allocations ?         |            |            |
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
