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

## Deux choses manquent, et elles ne peuvent pas être inventées

**La forme sociale et le capital social.** L'article R123-237 du code de
commerce les exige sur tout document destiné aux tiers. Elles ne peuvent venir
que de l'extrait Kbis. Les deux pages nomment l'exploitant sans elles, ce qui
est incomplet.

**Les durées de conservation.** Le RGPD, article 13.2.a, les exige. La page de
confidentialité le dit à l'endroit où elles devraient figurer, plutôt que
d'annoncer une durée que le serveur n'applique pas — ce qui serait pire que de
reconnaître le manque. Il faut décider, publier, et configurer le serveur en
conséquence.

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
