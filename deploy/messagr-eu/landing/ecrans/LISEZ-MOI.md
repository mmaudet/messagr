# Les écrans de la galerie, et d'où ils viennent

Cinq écrans extraits de `design/prototype/messagr-prototype-v3.html`, qui fait
autorité sur la disposition (`design/prototype/lisez-moi.md`). Le sixième, la
conversation, vit à côté dans `landing/conversation.html` parce qu'il est le
seul à être rendu dans les six langues : il est dans le hero.

**Ce ne sont pas des photographies d'une application qui tourne.** Le jour où un
banc peut photographier un état de produit (#157), ils sont remplacés par les
vraies captures.

## Ce qui a été retiré, et pourquoi

Tout élément portant un gabarit non rempli (`{{ … }}`) a été supprimé avec sa
rangée : le moteur de canvas qui les remplirait n'est délibérément pas versionné,
et `{{ c.label }}` montré à un lecteur est pire qu'un silence.

Sur la conversation, quatre choses de plus sont parties parce qu'elles ne
tournent pas : les boutons d'appel, le message vocal, la vignette
photographique, et la légende qui la désignait. Le détail est en tête de
`landing/conversation.html`.

## Ce que chacun montre, et son état

| Fichier | Écran | État |
| --- | --- | --- |
| `premier-lancement.html` | La promesse, avant qu'on demande quoi que ce soit | Fait |
| `lien-expire.html` | Une invitation ne sert qu'une fois | Fait |
| (`../conversation.html`) | La conversation en tête-à-tête | Fait |
| `salon.html` | Une conversation à plusieurs | À venir |
| `agent.html` | La fiche de capacités d'un agent | À venir |
| `appel.html` | Un appel chiffré de bout en bout | À venir |

L'état vient de la même source que le tableau daté de #149, pour que les deux ne
puissent pas se contredire.

## Refaire les images

    node deploy/messagr-eu/landing/rendre-ecrans.mjs

Elles sont en français seul. Six écrans par six langues feraient trente-six
rendus et autant de traductions de prose, ce qui n'est pas proportionné pour des
illustrations ; les légendes, elles, sont traduites comme le reste de la page.
