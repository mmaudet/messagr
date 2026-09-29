# shellcheck shell=bash
#
# Ce qu'une version d'une page légale est devenue, lu dans l'arbre que le
# dépôt tient (#412, #466, #467). Sourcé par assert-legal-pages.sh,
# assert-retention.sh et assert-push-payload.sh, qui en tiraient chacun leur
# propre règle : trois règles pour un même fait finissent par en dire trois.
#
# Une version à venir, `<page>/a-venir/`, est servie une fois annoncée, quand
# sa page ne porte plus la marque MESSAGR-DATE-A-VENIR ; d'ici là, elle attend
# son annonce (`build-site.sh` ne la construit pas). Une version à publier,
# `<page>/a-publier/`, n'est jamais servie : elle attend sa publication tant
# que le dépôt la tient, et `version-a-venir.mjs publier` la fait disparaître.
# L'adresse est construite ici et nulle part ailleurs du côté de bash, comme
# `adresseDe` la construit dans version-a-venir.mjs.

# adresse_version PAGE SOUS-DOSSIER, par exemple `confidentialite a-publier` :
# « /confidentialite/a-publier/ ».
adresse_version() {
  printf '/%s/%s/\n' "$1" "$2"
}

# etat_version ARBRE ADRESSE : ce que l'arbre ARBRE tient à ADRESSE.
#   servie                la page y est, et le site construit la sert ;
#   annonce-attendue      une version à venir que personne n'a datée ;
#   publication-attendue  une version qui attend d'être publiée ;
#   absente               l'arbre ne tient rien à cette adresse.
etat_version() {
  local page="$1$2index.html"
  if [ ! -f "$page" ]; then
    echo absente
    return 0
  fi
  case "$2" in
    */a-venir/)
      if grep -qF 'MESSAGR-DATE-A-VENIR' "$page"; then
        echo annonce-attendue
      else
        echo servie
      fi
      ;;
    */a-publier/) echo publication-attendue ;;
    *) echo servie ;;
  esac
}
