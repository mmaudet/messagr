# Les pages légales de messagr.eu

Deux pages, servies à `/confidentialite` et `/conditions-generales`.

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

## Vérifier après publication

    curl -sS -o /dev/null -w '%{http_code}\n' https://messagr.eu/confidentialite
    curl -sS -o /dev/null -w '%{http_code}\n' https://messagr.eu/conditions-generales

Les deux doivent répondre 200. Google suit le lien pendant l'examen, et une
404 le fait échouer sans dire clairement pourquoi.
