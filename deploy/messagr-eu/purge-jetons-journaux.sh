#!/bin/sh
# deploy/messagr-eu/purge-jetons-journaux.sh — retire les jetons d'invitation
# des journaux d'accès DÉJÀ ÉCRITS.
#
# LE VHOST ARRÊTE L'HÉMORRAGIE, PAS CE QUI A COULÉ. Depuis #313 le vhost
# journalise `/i/...` à la place du chemin, donc plus aucun jeton n'entre dans
# `/var/log/nginx/access.log`. Les lignes écrites AVANT ce déploiement portent
# encore le leur, et `/etc/logrotate.d/nginx` les garde 366 jours : sans cette
# purge, la correction ne vaut que pour l'avenir et le passé reste lisible sur
# le serveur jusqu'à un an.
#
# IL RÉÉCRIT LE CHEMIN, IL NE SUPPRIME PAS LA LIGNE. La date, l'adresse IP, le
# statut, la taille et l'agent restent, et la durée de conservation ne bouge
# pas : `deploy/messagr-eu/retention.json` déclare douze mois pour les données
# de connexion, que le décret n° 2021-1362 impose. Une ligne perdue serait une
# donnée que la loi demande de garder ; le script refuse d'écrire un fichier
# qui n'a pas exactement autant de lignes qu'il en a lues.
#
# IL NE MONTRE JAMAIS UN JETON. Ni en marche normale, ni en `--dry-run`, ni
# dans un message d'erreur : il compte des lignes, il n'en cite aucune. Un
# rapport qui recopierait la ligne fautive écrirait le jeton dans un endroit
# de plus — le terminal, l'historique du shell, la transcription d'une
# session.
#
# IL EST IDEMPOTENT. Une ligne déjà purgée porte `/i/...`, qui est un chemin
# d'invitation comme un autre pour la règle ci-dessous : elle est reconstruite
# à l'identique. Le relancer ne coûte que du temps.
#
#   purge-jetons-journaux.sh [--dry-run] [répertoire | fichiers...]
#
# Sans argument : `/var/log/nginx`, d'où il prend `access.log` et tous ses
# `access.log.*`, `.gz` compris.
#
# ── L'ORDRE DES DEUX ACCORDS ──────────────────────────────────────────────
#
# Le porteur donne son accord DEUX fois, et dans cet ordre : d'abord déployer
# le vhost, ensuite réécrire les journaux. L'inverse nettoierait un fichier
# que nginx continue de remplir de jetons — du travail qui s'annule tout seul.
# Le script tient cet ordre plutôt que de le rappeler : il refuse d'écrire
# tant que le vhost installé ne porte pas `messagr_sans_jeton`. `--dry-run`
# n'écrit rien, donc il n'a pas cette exigence : il sert justement à mesurer
# l'ampleur avant de décider.
#
# ── LE FICHIER COURANT, QUE NGINX TIENT OUVERT ────────────────────────────
#
# `access.log` est ouvert par nginx, qui écrit par DESCRIPTEUR et pas par nom.
# Le remplacer par `mv` lui laisserait un descripteur sur un fichier délié :
# nginx écrirait dans un fichier que plus rien ne nomme, invisible et jamais
# tourné. Ce fichier-là est donc réécrit DANS SON INODE — la fin arrivée
# pendant le traitement est recopiée d'abord, puis l'ensemble est versé dans
# le même fichier. Les archives, elles, ne sont ouvertes par personne et sont
# remplacées par `mv`, atomiquement, avec leurs droits et leur date.
set -eu

DRY_RUN=non
VHOST=${MESSAGR_VHOST:-/etc/nginx/sites-available/messagr-eu}
MARQUEUR=messagr_sans_jeton

usage() {
  echo "usage: purge-jetons-journaux.sh [--dry-run] [répertoire | fichiers...]" >&2
  exit 2
}

cibles=""
for argument in "$@"; do
  case "$argument" in
    --dry-run) DRY_RUN=oui ;;
    -h | --help) usage ;;
    -*) echo "option inconnue : $argument" >&2; usage ;;
    *) cibles="$cibles $argument" ;;
  esac
done
[ -n "$cibles" ] || cibles=/var/log/nginx

travail=$(mktemp -d "${TMPDIR:-/tmp}/purge-jetons.XXXXXX")
nettoyer() { rm -rf "$travail"; }
trap nettoyer EXIT HUP INT TERM

echoue=0
signaler() { echo "purge: FAIL: $1" >&2; echoue=1; }

# ── Le programme de réécriture ────────────────────────────────────────────
#
# Perl et pas sed : `perl-base` est essentiel sur Debian, donc présent sur
# hermes sans rien installer, et présent aussi sur la machine de qui relit ce
# script. Les expressions de sed diffèrent entre GNU et BSD juste assez pour
# qu'un test vert localement ne prouve rien du serveur.
#
# TROIS MODES, UN SEUL PROGRAMME : `reecrire` produit le journal purgé,
# `compter` ne produit rien et dit seulement combien de lignes changeraient,
# `scanner` cherche ce qui RESTE — y compris dans un fichier qui n'a pas la
# forme d'un journal d'accès, comme `error.log`.
#
# LE CHAMP REQUÊTE EST CHERCHÉ À SA PLACE, et pas n'importe où dans la ligne :
# c'est le premier champ entre guillemets, juste après la date entre crochets.
# L'agent utilisateur est du texte que l'appelant choisit, et il peut contenir
# « /i/ » ; une substitution globale l'abîmerait. nginx échappe tout guillemet
# d'une variable en `\x22`, donc un champ entre guillemets n'en contient
# jamais un vrai, et `[^"]*` est exact.
#
# CE QUI EST ENTRE LA MÉTHODE ET LE PROTOCOLE EST JETÉ EN BLOC. La ligne de
# requête est reconstruite à partir de la méthode et du protocole seuls, donc
# aucun morceau du jeton ne peut survivre à une requête mal formée — un espace
# au milieu du chemin, un protocole absent.
#
# UN FICHIER, ET PAS UNE VARIABLE. `bash` cherche la parenthèse fermante
# d'un `$( ... )` sans tenir compte des apostrophes d'un document en ligne,
# et ces commentaires-ci en portent : gardé dans une variable, le script ne
# se parserait plus. Écrit dans un fichier, il se relit tel qu'il tourne.
PROGRAMME="$travail/purge.pl"
cat > "$PROGRAMME" <<"PERL"
my $SANS_JETON = "/i/...";
my $mode = $ENV{MODE};
my $changees = 0;

sub requete_sans_jeton {
    my ($requete) = @_;
    return $requete unless $requete =~ m{^(\S+)[ ]+/i(?:[/? ]|$)};
    my $methode = $1;
    my ($protocole) = $requete =~ m{([ ]HTTP/[0-9.]+)\z};
    $protocole = "" unless defined $protocole;
    return $methode . " " . $SANS_JETON . $protocole;
}

sub referent_sans_jeton {
    my ($referent) = @_;
    return $referent unless $referent =~ m{^(https?://[^/?\#]+)/i(?:[/?]|$)};
    return $1 . $SANS_JETON;
}

while (my $ligne = <STDIN>) {
    my $avant = $ligne;
    if ($mode eq "scanner") {
        # Ce qui RESTE : un chemin d'invitation suivi de quelque chose qui
        # n'est pas les trois points. Large exprès — il vaut mieux une ligne
        # à regarder pour rien qu'un jeton qu'on ne cherche pas.
        $changees++ if $ligne =~ m{/i/(?!\.\.\.(?:[\s"]|\z))\S} || $ligne =~ m{/i\?\S};
        next;
    }
    $ligne =~ s{(\]\s")([^"]*)(")}{$1 . requete_sans_jeton($2) . $3}e;
    $ligne =~ s{("\s\d+\s\d+\s")([^"]*)(")}{$1 . referent_sans_jeton($2) . $3}e;
    $changees++ if $ligne ne $avant;
    print $ligne if $mode eq "reecrire";
}

if ($ENV{COMPTEUR}) {
    open(my $sortie, ">", $ENV{COMPTEUR}) or die "compteur: $!";
    print $sortie "$changees\n";
    close($sortie);
}
PERL

# ── Les deux listes : ce qui est réécrit, et ce qui est relu à la fin ─────
#
# La réécriture ne prend que les journaux d'accès. Le balayage final prend
# TOUT ce qu'il y a à côté, `error.log` compris : ce script n'y écrit pas, et
# c'est justement pour cela qu'il faut savoir ce qui s'y trouve.
liste="$travail/liste"
scan_liste="$travail/scan-liste"
: > "$liste"
: > "$scan_liste"
for cible in $cibles; do
  if [ -d "$cible" ]; then
    for fichier in "$cible"/access.log "$cible"/access.log.*; do
      if [ -f "$fichier" ]; then
        echo "$fichier" >> "$liste"
      fi
    done
    for fichier in "$cible"/*; do
      if [ -f "$fichier" ]; then
        echo "$fichier" >> "$scan_liste"
      fi
    done
  elif [ -f "$cible" ]; then
    echo "$cible" >> "$liste"
    echo "$cible" >> "$scan_liste"
  else
    signaler "$cible n'est ni un répertoire ni un fichier"
  fi
done

if [ ! -s "$liste" ]; then
  echo "purge: aucun journal d'accès à traiter dans :$cibles"
  exit "$echoue"
fi

# ── La garde d'ordre ──────────────────────────────────────────────────────
if [ "$DRY_RUN" = non ]; then
  if [ ! -f "$VHOST" ]; then
    signaler "le vhost $VHOST est introuvable.
  La purge ne s'exécute qu'APRÈS le déploiement du vhost sans jeton. Donnez
  son chemin dans MESSAGR_VHOST, ou mesurez d'abord avec --dry-run."
    exit 1
  fi
  if ! grep -q "$MARQUEUR" "$VHOST"; then
    signaler "le vhost $VHOST ne porte pas $MARQUEUR.
  nginx écrit donc encore les jetons dans le journal, et purger maintenant
  nettoierait un fichier qu'il continue de remplir. Déployez le vhost
  d'abord ; --dry-run mesure sans rien écrire."
    exit 1
  fi
fi

# ── Copier les attributs d'un fichier sur un autre ────────────────────────
#
# `chmod --reference` n'existe pas partout ; `stat` s'appelle différemment
# selon GNU et BSD. Les deux formes sont essayées, et la date de dernière
# écriture est recopiée par `touch -r`, qui est POSIX. Une archive qui
# changerait de date changerait ce que `logrotate` croit savoir d'elle.
copier_attributs() {
  modele=$1
  cible=$2
  mode=$(stat -c '%a' "$modele" 2>/dev/null || stat -f '%Lp' "$modele" 2>/dev/null || echo '')
  if [ -n "$mode" ]; then
    chmod "$mode" "$cible"
  fi
  proprio=$(stat -c '%u:%g' "$modele" 2>/dev/null || stat -f '%u:%g' "$modele" 2>/dev/null || echo '')
  if [ -n "$proprio" ]; then
    chown "$proprio" "$cible" 2>/dev/null || true
  fi
  touch -r "$modele" "$cible"
}

lignes_de() { wc -l < "$1" | tr -d ' '; }

total_lignes=0
total_changees=0
total_fichiers=0

while IFS= read -r fichier; do
  total_fichiers=$((total_fichiers + 1))
  base=$(basename "$fichier")
  brut="$travail/brut"
  purge="$travail/purge"
  compte="$travail/compte"
  rm -f "$brut" "$purge" "$compte"

  # Le fichier courant : nginx y écrit pendant qu'on le lit, donc on fige sa
  # taille et on ne traite que ce préfixe. Ce qui arrive après est recopié tel
  # quel — le vhost sans jeton est déployé, donc ces octets-là n'en portent
  # pas.
  courant=non
  case "$base" in
    access.log) courant=oui ;;
  esac

  case "$fichier" in
    *.gz)
      if ! gzip -dc "$fichier" > "$brut" 2>/dev/null; then
        signaler "$fichier ne se décompresse pas ; laissé intact"
        continue
      fi
      taille=''
      ;;
    *)
      if [ "$courant" = oui ]; then
        taille=$(wc -c < "$fichier" | tr -d ' ')
        head -c "$taille" "$fichier" > "$brut"
      else
        taille=''
        cat "$fichier" > "$brut"
      fi
      ;;
  esac

  avant=$(lignes_de "$brut")

  if [ "$DRY_RUN" = oui ]; then
    MODE=compter COMPTEUR="$compte" perl "$PROGRAMME" < "$brut" > /dev/null
    changees=$(cat "$compte")
    printf '  %-28s %6s ligne(s), %6s à purger\n' "$base" "$avant" "$changees"
    total_lignes=$((total_lignes + avant))
    total_changees=$((total_changees + changees))
    continue
  fi

  MODE=reecrire COMPTEUR="$compte" perl "$PROGRAMME" < "$brut" > "$purge"
  changees=$(cat "$compte")
  apres=$(lignes_de "$purge")

  if [ "$avant" != "$apres" ]; then
    signaler "$base : $avant ligne(s) lues, $apres écrites. Rien n'a été
  remplacé. Une ligne de journal de connexion se conserve douze mois, et ce
  script n'est pas autorisé à en perdre une."
    continue
  fi

  if [ "$changees" = 0 ]; then
    printf '  %-28s %6s ligne(s), aucun jeton\n' "$base" "$avant"
    total_lignes=$((total_lignes + avant))
    continue
  fi

  temporaire="$travail/sortie"
  rm -f "$temporaire"
  case "$fichier" in
    *.gz) gzip -c < "$purge" > "$temporaire" ;;
    *) cat "$purge" > "$temporaire" ;;
  esac

  if [ "$courant" = oui ]; then
    # La fin arrivée pendant le traitement, puis tout dans le MÊME inode.
    tail -c "+$((taille + 1))" "$fichier" >> "$temporaire"
    cat "$temporaire" > "$fichier"
  else
    copier_attributs "$fichier" "$temporaire"
    mv "$temporaire" "$fichier"
  fi

  printf '  %-28s %6s ligne(s), %6s purgée(s)\n' "$base" "$avant" "$changees"
  total_lignes=$((total_lignes + avant))
  total_changees=$((total_changees + changees))
done < "$liste"

echo
if [ "$DRY_RUN" = oui ]; then
  echo "purge: --dry-run : $total_fichiers fichier(s), $total_lignes ligne(s) lues, $total_changees à purger. Rien n'a été écrit."
else
  echo "purge: $total_fichiers fichier(s), $total_lignes ligne(s) relues, $total_changees purgée(s)."
fi

# ── Ce qui reste, y compris là où ce script n'écrit pas ───────────────────
#
# Le journal d'erreurs n'a pas la forme d'un journal d'accès, donc la
# réécriture ne le touche pas. En marche normale il ne porte aucune ligne de
# `/i/` — vérifié sur nginx 1.24, une requête d'invitation n'y écrit rien —
# mais « en marche normale » n'est pas une mesure. Ce balayage en est une, et
# il est volontairement large : il signale des lignes À REGARDER, pas des
# jetons certains. Un agent utilisateur qui contient « /i/quelque-chose » y
# figure, et c'est le bon compromis.
echo
echo "purge: ce qui reste à regarder"
reste=0
compte="$travail/compte"
while IFS= read -r fichier; do
  case "$fichier" in
    *.gz)
      if ! gzip -dc "$fichier" > "$travail/scan" 2>/dev/null; then
        continue
      fi
      ;;
    *) cat "$fichier" > "$travail/scan" ;;
  esac
  MODE=scanner COMPTEUR="$compte" perl "$PROGRAMME" < "$travail/scan" > /dev/null
  n=$(cat "$compte")
  if [ "$n" != 0 ]; then
    printf '  %-28s %6s ligne(s) portent un chemin /i suivi de quelque chose\n' "$(basename "$fichier")" "$n"
    reste=$((reste + n))
  fi
done < "$scan_liste"
if [ "$reste" = 0 ]; then
  echo "  rien"
fi

exit "$echoue"
