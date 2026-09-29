# Les pages légales de messagr.eu

Deux pages, servies à `/confidentialite` et `/conditions-generales`, et une
troisième à `/aide` qui n'est pas un texte juridique mais que les magasins
exigent au même titre : voir « La page d'aide » plus bas.

## Pourquoi elles sont ici

Google Play refuse d'examiner une application sans URL de politique de
confidentialité, et l'URL doit répondre avant l'examen : la page est vérifiée,
pas seulement déclarée.

Les conditions générales existaient déjà, comme document et comme écran dans
l'application. Elles n'étaient publiées nulle part, et la politique de
confidentialité n'existait pas du tout — ce sont deux textes différents. Les
conditions relèvent de l'article 14 du DSA : qui exploite, ce qui est interdit,
comment la modération décide. La politique relève du RGPD : quelles données,
pourquoi, combien de temps, quels droits.

Le texte des conditions est repris tel quel du document rédigé le 8 août 2026.
La politique est écrite d'après ce que le produit fait réellement, vérifié
contre le code plutôt que contre une intention.

## Ce que les pages annoncent, et qu'il faut maintenant tenir

L'identité de l'exploitant est complète : SARL à associé unique, capital de
5 087 000 euros, tirés de l'extrait Kbis du 4 mars 2021.

**Les durées de conservation sont publiées, donc elles engagent.** Une seule
n'est pas un choix : le décret n° 2021-1362 impose douze mois pour les données
permettant d'identifier la source d'une connexion, adresses IP comprises. Les
autres sont des décisions, et le serveur doit désormais les appliquer :

- journaux techniques : effacement à douze mois ;
- compte supprimé : désactivation immédiate, purge sous trente jours ;
- métadonnées : durée de vie du compte ;
- contenu chiffré : durée de vie du salon ;
- graphe des invitations : tant que les comptes qu'il relie existent, parce que
  la révocation en cascade en dépend.

Rien de tout cela n'est configuré aujourd'hui. Une politique publiée que le
serveur n'applique pas est un manquement, pas une intention.

## Publier

Le site est encore déployé depuis l'ancien dépôt
(`deploy/messagr-eu/build-site.sh` et `deploy.sh`). Ces deux pages y sont
copiables telles quelles, ou servies directement :

    rsync -a deploy/messagr-eu/site/confidentialite \
             deploy/messagr-eu/site/conditions-generales \
             hermes:/var/www/messagr.eu/

Le chemin exact du racine web est celui que nginx sert pour messagr.eu ; il est
décrit dans `nginx-messagr-eu.conf` de l'ancien dépôt. Le rapatriement complet
du site relève de #47.

## La page d'aide, `/aide`

Elle est arrivée avec #333, et elle lève deux exigences d'un coup.

**Google Play.** Une application qui crée un compte doit offrir un chemin de
suppression dans l'application et une ressource web où la demander, où « the
pathway to request account deletion should be prominently featured and easily
discoverable on the page ». C'est la section `#supprimer-votre-compte`, et son
adresse complète est
`https://messagr.eu/aide/#supprimer-votre-compte`.

**Apple.** La fiche de l'App Store exige une URL d'assistance, et le relecteur
la visite. Elle pointait faute de mieux sur les conditions générales, qui sont
un texte juridique et non une page d'aide. C'est `https://messagr.eu/aide/`.

**L'ancre est une adresse publiée.** L'écran « Informations légales » de
l'application l'ouvre, et les deux fiches la portent. La renommer ne fait
répondre 404 à personne : la page s'ouvre, le lecteur arrive en haut, et rien
ne dit qu'il a manqué ce qu'il venait chercher.

**Ce qu'elle ne promet pas.** Aucun délai que le produit ne tient pas. Elle
cite l'engagement de la politique de confidentialité — désactivation
immédiate, purge sous trente jours — et écrit dans la même carte que cette
purge est faite à la main à l'échelle de la bêta (#71).

## Vérifier après publication

    curl -sS -o /dev/null -w '%{http_code}\n' https://messagr.eu/confidentialite
    curl -sS -o /dev/null -w '%{http_code}\n' https://messagr.eu/conditions-generales
    curl -sS -o /dev/null -w '%{http_code}\n' https://messagr.eu/aide

Les trois doivent répondre 200, et `scripts/assert-legal-pages.sh` fait
exactement ces trois requêtes — le travail de publication le lance avant de
construire quoi que ce soit. Google suit le lien de la politique pendant
l'examen, il va chercher la ressource de suppression, Apple visite l'URL
d'assistance, et une 404 fait échouer sans dire clairement pourquoi.

Le même contrôle connaît aussi les versions autour de celle en vigueur,
décrites ci-dessous : une version à venir répond une fois annoncée, et pas
avant ; une version remplacée répond à son adresse datée ; une traduction
répond à la sienne, `/conditions-generales/en/` ; une version qui attend
d'être publiée ne répond pas, ni sa traduction.

`scripts/assert-legal-screen.sh` va chercher les conditions, en français et
en anglais, et vérifie que l'écran « Informations légales » dit les mêmes
faits dans les sept langues de l'application, et qu'aucune ne garde les
trois phrases retirées par #466. Le travail de publication d'une build le
lance aussi : tant que les conditions publiées ne disent pas ce que l'écran
dit, aucune build ne part. `deploy/messagr-eu/tests/controles-legaux.js` mène
ces deux contrôles contre le site construit, à chaque changement.

## Une nouvelle version

La politique promet qu'un changement est annoncé avant d'être appliqué, et
#392 a fixé ce délai à trente jours. Une nouvelle version paraît donc à sa
propre adresse, `/confidentialite/a-venir/` ou
`/conditions-generales/a-venir/`, datée, avec la liste de ce qui change, et
la version en vigueur l'annonce en tête. Le jour où elle s'applique, elle
prend l'adresse habituelle, et celle qu'elle remplace reste lisible à une
adresse qui porte sa date de fin, par exemple
`/confidentialite/jusqu-au-2026-11-01/`. Décisions du porteur du 27
septembre 2026, sur #412.

Trois gestes, dans `version-a-venir.mjs`, écrivent dans le dépôt et rien
d'autre. Chacun est suivi d'un commit et d'un déploiement
(`deploy/messagr-eu/deploy.sh`), puis des trois contrôles :

    ./scripts/assert-legal-pages.sh
    ./scripts/assert-retention.sh
    ./scripts/assert-push-payload.sh --live

Le déploiement de messagr.eu se fait avec l'accord du porteur.

### Préparer

Une version à venir attend dans le dépôt tant que le porteur n'a pas fixé
sa date. Pendant ce temps, rien d'elle n'est servi : `build-site.sh` ne
construit pas une page qui porte la marque `MESSAGR-DATE-A-VENIR`, et
retire de la version en vigueur le passage qui l'annonce. Un déploiement
fait pour autre chose publie donc le site d'aujourd'hui, exactement.

Pour en préparer une, à partir de la version en vigueur :

1. La recopier dans `<page>/a-venir/index.html`, et y dire « à venir » dans
   le titre (`… à venir — Messagr`) et dans le `h1`. Si elle vient d'une
   version appliquée, retirer de la copie sa carte « Cette version s'applique
   depuis… », entre `<!-- depuis -->` et `<!-- /depuis -->` : la version à
   venir en porte une à elle, et `annoncer` refuse une copie qui garde
   l'ancienne.
2. Écrire en tête, dans le `<p class="stamp">`, « Version applicable le
   MESSAGR-DATE-A-VENIR », puis une carte dont le début, entre
   `<!-- a-venir -->` et `<!-- /a-venir -->`, dit « Cette version
   s'appliquera le MESSAGR-DATE-A-VENIR. », renvoie à la version en vigueur
   (`href="/<page>/"`) et se termine par « Ce qui change : ». La liste de ce
   qui change suit, hors de ce passage : elle reste, sous « Ce qui a
   changé », une fois la version appliquée.
3. Dans la version en vigueur, juste après sa date, un passage entre les
   mêmes marques, qui porte la marque et renvoie à `/<page>/a-venir/`.
4. Pour une durée nouvelle, une entrée de `retention.json` avec sa phrase
   exacte et `"page": "/confidentialite/a-venir/"` : `assert-retention.sh`
   la vérifie à cette adresse une fois la version annoncée.

`deploy/messagr-eu/tests/version-a-venir.js` prépare une version ainsi
quand le dépôt n'en tient aucune, et mène le cycle entier deux fois.

### Annoncer

    node deploy/messagr-eu/version-a-venir.mjs annoncer AAAA-MM-JJ

La date est celle où la version s'appliquera, trente jours au moins après
aujourd'hui, comptés en jours du calendrier de Paris ; une date plus proche
est refusée. Le geste l'écrit à la place de la marque, dans la version à
venir et dans le passage qui l'annonce. Il refuse une version dont la forme
ne permettrait pas les deux gestes suivants.

Le préavis court du jour où la page est servie : le déploiement suit
l'annonce le jour même. `deploy.sh` le mesure de nouveau avant d'envoyer une
version à venir que le serveur ne sert pas encore
(`version-a-venir.mjs preavis`), et s'arrête s'il reste moins de trente
jours : la date se reporte d'abord.

### Reporter

    node deploy/messagr-eu/version-a-venir.mjs reporter AAAA-MM-JJ

Une date annoncée peut reculer, jamais avancer : le préavis donné vaut pour
toute date plus lointaine. Avancer demande une annonce nouvelle, avec ses
trente jours : annuler le commit d'annonce, annoncer la nouvelle date, et
déployer.

### Appliquer

    node deploy/messagr-eu/version-a-venir.mjs appliquer

Le jour venu, à Paris, et pas avant. Une version annoncée pour plus tard,
ou pas encore annoncée, attend. Pour chaque page dont la version à venir est
annoncée pour ce jour-là ou avant :

- la version en vigueur part à `<page>/jusqu-au-AAAA-MM-JJ/`, et dit
  jusqu'à quand elle s'est appliquée, et ce qui l'a remplacée ;
- la version à venir devient la version en vigueur, et renvoie à celle
  qu'elle remplace ;
- `<page>/a-venir/` disparaît du dépôt, et `retention.json` perd ses
  `"page"`, dont les phrases se vérifient désormais sur la politique en
  vigueur.

Le déploiement retire `<page>/a-venir/` du serveur : sans cela, la page
resterait servie, et dirait que la politique « s'appliquera » le jour où
elle s'applique déjà.

## Une version qui s'applique le jour où elle est publiée

Quand la version en vigueur ne fixe aucun préavis, une nouvelle version
s'applique le jour où elle paraît : c'est le cas des conditions générales du
5 septembre 2026, dont la clause 7 dit seulement que « toute modification de
ces conditions est portée à la connaissance des destinataires du service ».
La version qui les remplace (#466) dit la tolérance zéro, après le refus
d'Apple en 1.2 le 29 septembre 2026. Ce jour-là, c'est la publication qui le
fixe, avec le déploiement en production (#474) : il n'existe pas avant.

La version attend donc dans `<page>/a-publier/index.html`, écrite telle
qu'elle s'appliquera, et sa traduction à côté, dans
`<page>/a-publier/en/index.html`. `build-site.sh` n'en construit rien : un
déploiement fait pour autre chose publie le site d'aujourd'hui, exactement,
sans les conditions d'avance ni leur traduction.

### Préparer

À partir de la version en vigueur, recopiée dans `<page>/a-publier/` :

1. Écrire en tête, dans le `<p class="stamp">`, « Version du
   MESSAGR-DATE-DE-PUBLICATION », puis une carte dont le début, entre
   `<!-- depuis -->` et `<!-- /depuis -->`, dit « Cette version s'applique
   depuis le MESSAGR-DATE-DE-PUBLICATION. », renvoie à
   `href="/<page>/jusqu-au-MESSAGR-DATE-DE-PUBLICATION/"` et se termine par
   « Ce qui a changé : ». La liste de ce qui change suit, hors de ce passage.
2. Garder l'annonce de la version à venir, s'il y en a une : la version à
   venir s'annoncera depuis la version publiée.
3. Pour la traduction, la même chose dans sa langue, avec `<html lang="en">`,
   un renvoi au texte français, `href="/<page>/"`, qui dit qu'il fait foi, et
   le texte français qui renvoie à `/<page>/en/`.

`publier` refuse une version dont la forme ne permettrait pas de la dater
partout, et n'écrit rien alors.

### Publier

    node deploy/messagr-eu/version-a-venir.mjs publier

Le jour de la mise en production, à Paris. La date est celle du jour, et
aucune autre : le geste l'écrit à la place de la marque, dans la version et
dans sa traduction (« 30 septembre 2026 », « 30 September 2026 »), puis :

- la version en vigueur part à `<page>/jusqu-au-AAAA-MM-JJ/`, et dit
  jusqu'à quand elle s'est appliquée, et ce qui l'a remplacée ;
- la version qui attendait devient la version en vigueur, et renvoie à celle
  qu'elle remplace ;
- sa traduction devient `<page>/en/index.html`, sa propre adresse ;
- `<page>/a-publier/` disparaît du dépôt.

Puis commiter, et déployer **le jour même** (`deploy/messagr-eu/deploy.sh`,
avec l'accord du porteur) : la date écrite dit depuis quand les conditions
s'appliquent, et elles ne s'appliquent que servies. Un déploiement qui
glisserait au lendemain ferait dire à la page qu'elle s'applique depuis la
veille : annuler alors le commit de publication, et publier de nouveau.
Enfin les contrôles :

    ./scripts/assert-legal-pages.sh
    ./scripts/assert-legal-screen.sh

Le premier attend les pages françaises et anglaise, et la version remplacée
à son adresse datée ; le second, que l'écran « Informations légales » dise
dans les sept langues ce que disent les conditions publiées. Avant la
publication, le second échoue : c'est l'ordre voulu, puisqu'une build qui
signale ne part pas avant les conditions qui le disent.

### Une traduction

Depuis #466, les conditions générales ont une traduction anglaise, à
`/conditions-generales/en/`, que l'application ouvre quand elle n'est pas en
français. Une traduction traduit la version en vigueur, et aucune autre.

**Une version à venir n'en porte pas encore.** L'annoncer, puis l'appliquer,
laisserait la traduction publiée traduire une version remplacée : les trois
gestes de la version à venir (`annoncer`, `reporter`, `appliquer`) refusent
donc une page traduite, et le disent. C'est le cas de la version à venir des
conditions générales, celle de la découverte (#392) : avant de l'annoncer,
il faut sa traduction anglaise, et apprendre aux trois gestes à la dater, à
la servir avec elle et à ranger l'ancienne à l'adresse datée. Ce n'est pas
fait, et rien ne le fera en silence.

**Tant qu'une version attend d'être publiée** sur une page, sa version à
venir ne s'annonce pas non plus : elle est écrite par-dessus la version qui
attend, et ce qu'elle dit changer se lit contre elle.
