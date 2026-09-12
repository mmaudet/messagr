#!/usr/bin/env bash
#
# Le conteneur partagé est nommé quatre fois, et une divergence ne dit rien.
#
# Une extension de partage remet son fichier à l'application par un conteneur
# d'App Group — la seule route que le système offre entre deux processus
# sandboxés (#242, et l'amendement d'ADR-0006 du 12 septembre 2026 qui
# l'autorise). L'identifiant de ce groupe est écrit dans quatre fichiers :
#
#   - les entitlements de l'application ;
#   - les entitlements de l'extension ;
#   - la source Swift de l'extension, qui demande le conteneur au système ;
#   - le module TypeScript, qui le demande de son côté pour balayer la boîte.
#
# CE QU'UNE DIVERGENCE PRODUIT, ET POURQUOI RIEN D'AUTRE NE L'ATTRAPERAIT.
# Tout compile. Tout se signe. L'application démarre, l'extension apparaît
# dans la feuille de partage, la personne choisit Messagr — et il ne se passe
# rien. L'extension écrit dans un conteneur, l'application en lit un autre,
# `containerURL` répond une adresse valide aux deux. Il n'y a ni erreur, ni
# journal, ni écran : le partage disparaît.
#
# Le job `ios-simulator` ne peut pas le voir : une build de simulateur n'est
# pas signée, donc ses entitlements ne sont pas appliquées, et aucune feuille
# de partage n'est pilotable là-bas. Le cadrage de #242 le dit en propres
# termes : « Rien ne prouvera la moitié iOS en CI. » Ceci est ce qui peut
# l'être — quatre chaînes dans quatre fichiers, lisibles sur un runner Linux.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)/.."
IOS="$ROOT/packages/app/ios"

APP_ENTITLEMENTS="$IOS/Messagr/Messagr.entitlements"
EXT_ENTITLEMENTS="$IOS/MessagrShare/MessagrShare.entitlements"
EXT_SWIFT="$IOS/MessagrShare/ShareViewController.swift"
TS_MODULE="$ROOT/packages/app/src/runtime/sharedInbox.ts"

failed=0
say_ok() { printf '  OK    %s\n' "$1"; }
say_bad() { printf '  FAIL  %s\n' "$1" >&2; failed=1; }

echo "Le groupe du conteneur partagé, nommé au même endroit quatre fois"

for f in "$APP_ENTITLEMENTS" "$EXT_ENTITLEMENTS" "$EXT_SWIFT" "$TS_MODULE"; do
  [ -f "$f" ] || { say_bad "absent : ${f#"$ROOT"/}"; }
done
[ "$failed" = "0" ] || exit 1

# Chaque fichier nomme le groupe à sa façon ; on extrait la chaîne elle-même
# plutôt que la ligne, pour qu'un commentaire qui la mentionne ne compte pas.
from_plist() {
  python3 - "$1" <<'PY'
import plistlib, sys
with open(sys.argv[1], 'rb') as handle:
    groups = plistlib.load(handle).get('com.apple.security.application-groups')
print(groups[0] if isinstance(groups, list) and groups else '')
PY
}

app="$(from_plist "$APP_ENTITLEMENTS")"
ext="$(from_plist "$EXT_ENTITLEMENTS")"
swift="$(grep -oE 'let group = "group\.[A-Za-z0-9._-]+"' "$EXT_SWIFT" | grep -oE 'group\.[A-Za-z0-9._-]+' | head -1)"
ts="$(grep -oE "SHARE_GROUP = 'group\.[A-Za-z0-9._-]+'" "$TS_MODULE" | grep -oE 'group\.[A-Za-z0-9._-]+' | head -1)"

for pair in "application:$app" "extension:$ext" "swift:$swift" "typescript:$ts"; do
  where="${pair%%:*}"
  what="${pair#*:}"
  if [ -z "$what" ]; then
    say_bad "$where ne nomme aucun groupe"
  else
    say_ok "$where → $what"
  fi
done
[ "$failed" = "0" ] || exit 1

if [ "$app" = "$ext" ] && [ "$app" = "$swift" ] && [ "$app" = "$ts" ]; then
  say_ok "les quatre s'accordent"
else
  say_bad "les quatre ne s'accordent pas, et rien d'autre ne le dirait"
  exit 1
fi

# ET LA CIBLE EXISTE VRAIMENT. Des entitlements accordées sur une extension
# que le projet ne construit pas sont quatre chaînes cohérentes et aucun
# partage.
PROJECT="$IOS/Messagr.xcodeproj/project.pbxproj"
if grep -q 'com.apple.product-type.app-extension' "$PROJECT" &&
  grep -q 'MessagrShare/MessagrShare.entitlements' "$PROJECT"; then
  say_ok "le projet porte la cible d'extension, et lui donne ces entitlements"
else
  say_bad "le projet ne construit pas l'extension : le groupe ne sert à rien"
  exit 1
fi

# ET L'APPLICATION L'EMBARQUE, ce qui est une troisième chose encore.
#
# Une cible peut se construire parfaitement et n'aller nulle part : le .appex
# se retrouve dans les produits de la construction, l'application est livrée
# sans son dossier PlugIns, et la feuille de partage n'offre rien. Rien ne
# rougit. C'est le même genre de silence que `le câblage manquant n'est le
# comportement d'aucune unité` : chaque pièce est juste, et rien ne les relie.
#
# Le `13` est `dstSubfolderSpec` pour PlugIns — la valeur qu'Xcode écrit pour
# une phase « Embed Foundation Extensions ». On vérifie qu'une phase de copie
# la porte ET qu'elle nomme le produit de l'extension.
if python3 - "$PROJECT" <<'PY'; then
import re, sys
text = open(sys.argv[1], encoding='utf-8').read()
phases = re.findall(
    r'isa = PBXCopyFilesBuildPhase;(.*?)\n\t\t\};', text, re.S)
for body in phases:
    if 'dstSubfolderSpec = 13;' not in body:
        continue
    if 'MessagrShare.appex' in body:
        sys.exit(0)
sys.exit(1)
PY
  say_ok "l'application embarque l'extension dans PlugIns"
else
  say_bad "aucune phase de copie n'embarque MessagrShare.appex dans PlugIns"
  say_bad "l'extension se construirait et n'irait nulle part, sans rien dire"
  exit 1
fi

exit 0
