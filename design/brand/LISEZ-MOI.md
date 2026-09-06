# Messagr — identité, fichiers vectoriels

Version 1 · 7 août 2026 · concept retenu : **Pli** (4c), dosage de coupe **12 %**.

## Le geste
Une seule coupe à 45° dans le coin supérieur droit.
Échelle : **la coupe vaut 12 % de la hauteur de référence de la forme**.
- lettres : 12 % de la hauteur de capitale = 0,084 em
- surfaces : la coupe vaut le rayon d'angle de la surface

## Signe (grille de 100 unités)
- carré porteur 76 × 76 u, centré
- rayon d'angle 18 u
- entaille du pli : 12 u de large, à 45°, départ x = 54 u sur l'arête haute
- le rabat n'est jamais recollé
- clearspace : 12 u sur les quatre côtés
- taille minimale : 16 px écran, 6 mm impression
- icône d'application : boîte de 100 u à 57 % du gabarit, soit un signe visible à 44 %

## Logotype
Base : Schibsted Grotesk 600, interlettrage −0,03 em.
Coupe sur le **M** (depuis le haut de capitale) et sur le **r** (depuis le haut de l'œil), 0,084 em **mesuré sur l'encre**.
En CSS, la coupe porte sur la boîte de la lettre : utiliser 0,108 em pour le M (il compense son approche droite de 0,024 em) et 0,084 em pour le r.
Les cinq lettres du milieu restent intactes. Espace signe / mot : 0,36 em.
Six déclinaisons : `-vert`, `-vert-inverse`, `-degrade`, `-degrade-inverse`, `-noir`, `-blanc`.

**Les six sont vectorisées depuis le 18 août 2026**, et ne contiennent plus de
texte vivant. Tant qu'elles en contenaient, elles ne montraient la marque nulle
part : la fonte n'était ni dans le dépôt ni sur la machine, et tout ce qui les
rendait tombait sur un repli — le site comme les captures. La vectorisation est
donc ce qui a rendu le mot-marque conforme, pas seulement ce qui l'a figé.

La fonte est désormais dans `identite/fonts/` avec sa licence : Schibsted
Grotesk 1.100, axe de graisse 400 à 900, **SIL Open Font License 1.1**, prise
sur `google/fonts`. Les tracés ont été produits à l'axe **600**, mesuré et non
supposé : à 600 le mot fait 331,65 unités de large, à 400 il en fait 317,72.
Le crénage est celui de la fonte, appliqué par CoreText, pas un espacement
recalculé à la main.

**Pour refaire les tracés** si le mot ou les métriques changent : composer le
texte à 84 px, interlettrage −2,5 unité, origine x 104, ligne de base y 82, et
remplacer les deux `<path>` — le premier porte `Messag`, le second le `r`, qui
est le seul à changer de couleur d'une déclinaison à l'autre.

## Couleurs
- signe : #12B76A
- appuis : #06614A
- bulles sortantes : #C9F2DC
- texte : #0C1F19
- dégradé de communication : #F4A03C -> #E2497F

## Interface
- bulle sortante : pli en haut à droite ; bulle entrante : pli en haut à gauche
- badge, tuiles, boutons : coupe = rayon d'angle ; jamais deux coins pliés sur une même forme
- monogramme r : 24 px minimum (le r se ferme en dessous)

## Neutres d'interface

Les gris et crèmes que les écrans emploient hors palette de marque. Les huit
premières lignes sont relevées sur les dessins 01 à 13, **à deux exceptions
près, signalées ci-dessous**. Les quatre dernières lignes viennent du
prototype de messagerie, pas des dessins 01 à 13.

| Rôle | Valeur |
|---|---|
| Fond crème | `#F4F1EA` |
| Points du fond | `#E4DED0` |
| Encadré, fond | `#FBF3D9` |
| Encadré, bord | `#EEE2B4` |
| Encadré, texte | `#7A6A3A` |
| Bord de carte | `#E9E4D9` |
| Texte atténué | `#6A6E76` |
| Horodatage | `#777768` |
| Barre d'onglets, fond | `#FBF8F3` |
| Barre d'onglets, bord | `#E6E0D5` |
| Onglet inactif | `#777267` |
| Référence différée | `#8A5A2B` |

**Trois valeurs s'écartent de leur source, et ce n'est pas une erreur de
relevé.** Ne pas les « corriger » vers la source sans refaire la mesure
ci-dessous.

Les dessins portaient `#8B8F97` pour le texte atténué et `#A3A396` pour
l'horodatage (corrigés depuis, ils portent les valeurs de ce tableau).
Mesurés le 10 août 2026, ils donnaient **2,88** et **2,55** de
contraste sur leurs fonds respectifs, là où le seuil AA du texte est de 4,5 et
celui des grands caractères de 3,0. Ces deux rôles portent de l'information,
séparateurs de date, accusés de lecture, heures, et non de la décoration : sous
3,0 ils deviennent illisibles au soleil, sur une dalle terne ou avec une vue
moyenne.

Le prototype de messagerie porte `#8F8A7E` pour l'onglet inactif (corrigé
depuis, il porte la valeur de ce tableau). Mesuré le 12 août 2026 sur le fond
de la barre d'onglets (`#FBF8F3`), il donnait **3,25** de contraste, sous le
seuil AA de 4,5 : un libellé d'onglet à 11,5sp porte de l'information au même
titre qu'un horodatage ou un séparateur de date, pas de la décoration. À
noter : le jeton qu'il remplaçait (`timestamp`, `#777768`) mesurait 4,29 sur
ce même fond, plus près du seuil que le prototype lui-même. Rendre la barre
fidèle au dessin du prototype avait donc éloigné le libellé de l'AA, pas
rapproché.

Les valeurs retenues gardent la teinte et la saturation d'origine, et ne
descendent la luminosité que jusqu'au seuil : `#6A6E76` donne 4,54 sur le fond
crème et 5,12 sur blanc, `#777768` donne 4,54 sur blanc et 4,03 sur le fond
crème, `#777267` donne 4,52 sur le fond de la barre d'onglets. L'écart visuel
est faible, l'écart de lisibilité ne l'est pas.

Les points du fond sont à 1,19 de contraste et le restent : ils sont
décoratifs, jamais porteurs d'information.

**La pilule de référence différée rejoint ce tableau sans écart avec le
prototype.** Le prototype de messagerie la colore en `#8A5A2B` ; la valeur
est reprise telle quelle. Mesurée le 12 août 2026 sur le fond crème
(`#F4F1EA`), elle donne **5,20** de contraste, au-dessus du seuil AA de 4,5
sans assombrissement.

Le vert que le même prototype pose sur les pilules de référence non
différées, `#0E8F63`, **ne rejoint pas** ce tableau : mesuré sur le même
fond crème, il donne **3,63**, sous le seuil que cette section défend. Ces
pilules utilisent le jeton `accents` (`#06614A`, 6,61 sur ce fond) à la
place. Un futur lecteur qui verrait cette absence comme un oubli et
voudrait « restaurer » le vert du prototype réintroduirait une couleur
sous AA : ce n'est pas une dérive à corriger.

## Échelle d'espacement et de rayons

Une échelle de 4, dont le pas M vaut le clearspace du signe.

| Rôle | Valeur |
|---|---|
| Espacement XS | 4 |
| Espacement S | 8 |
| Espacement M (clearspace) | 12 |
| Espacement L | 16 |
| Espacement XL | 24 |
| Espacement XXL | 32 |
| Rayon bulle | 16 |
| Rayon pilule | 9 |
| Rayon champ | 26 |

## À ne pas faire
Recoller le rabat du signe. Plier les lettres du milieu. Ajouter cadenas, bouclier, enveloppe.
Poser le signe sur un dégradé multicolore. Étirer ou incliner le signe.

## Fichiers du dossier
**Grille et règles** : messagr-grille-construction.svg · messagr-clearspace.svg · messagr-reductions.svg
**Signe** : messagr-signe-{vert,noir,blanc,degrade}.svg
**Monogramme r** : messagr-monogramme-r-{vert,noir,blanc,degrade}.svg
**Logotype** : messagr-logotype-{vert,vert-inverse,degrade,degrade-inverse,noir,blanc}.svg
**Application** : messagr-icone-ios-1024.svg · messagr-icone-android-adaptive.svg · messagr-icone-degrade-1024.svg · messagr-bulle-entrante.svg · messagr-bulle-sortante.svg · messagr-badge-notification.svg
