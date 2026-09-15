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
photographique, et la légende qui la désignait. Les appels tournent depuis, et cette
conversation ne montre toujours pas leurs boutons. Le détail est en tête de
`landing/conversation.html`.

## Ce que chacun montre, et son état

| Fichier | Écran | État |
| --- | --- | --- |
| `premier-lancement.html` | La promesse, avant qu'on demande quoi que ce soit | Fait |
| `lien-expire.html` | Une invitation ne sert qu'une fois | Fait |
| (`../conversation.html`) | La conversation en tête-à-tête | Fait |
| `salon.html` | Une conversation à plusieurs | À venir |
| `agent.html` | La fiche de capacités d'un agent | À venir |
| `appel.html` | Un appel chiffré de bout en bout | Fait |

L'état n'est pas lu depuis le tableau daté de #149 : il est écrit deux fois, ici
et dans la page. Ce qui empêche les deux de se contredire est
`tests/tableau-des-capacites.js`, qui refuse une pastille dont l'état diffère de
celui que le tableau donne à la même capacité. Cette table-ci n'est donc pas la
source : elle est une copie de courtoisie, et la construction s'arrête si la
page la démentait.

L'appel est passé de « À venir » à « En cours » le 7 septembre 2026 : le module
`src/calls/` existe sur master, couvert par ses `.spec`, et n'est importé par
rien -- écrit, éprouvé, pas embarqué.

Il est passé à « Fait » le 15 septembre 2026 : les appels audio et vidéo sont
dans les builds distribuées, et ont tenu les répétitions des 13 et 14 septembre.

## La page d'invitation, qui n'est pas de cette famille

`messagr-ecran-invitation.png` ne sort pas du prototype : c'est la **vraie page
d'invitation**, celle que ce site sert, rendue avec l'agent d'un téléphone.
C'est la première image du parcours en trois étapes de la page d'accueil, et la
première chose qu'une personne invitée voit, avant d'avoir rien installé.
`rendre-ecrans.mjs` la produit comme les autres, dans l'état qu'un téléphone
Android lit depuis le 13 septembre 2026 : « Installer Messagr pour Android »,
sans téléchargement direct. Sa destination y est une adresse en `.invalid`, qui
ne mène nulle part : l'image n'en montre que le libellé, et le lien
d'inscription de la piste interne n'a pas à entrer dans ce dépôt.

## Refaire les images

    node deploy/messagr-eu/landing/rendre-ecrans.mjs

Elles sont en français seul. Six écrans par six langues feraient trente-six
rendus et autant de traductions de prose, ce qui n'est pas proportionné pour des
illustrations ; les légendes, elles, sont traduites comme le reste de la page.
