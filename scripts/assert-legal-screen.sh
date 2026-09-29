#!/usr/bin/env bash
#
# The application's legal screen and the published terms must say the same
# things, in every language the application speaks.
#
# WHY THIS IS A SCRIPT AND NOT A PROMISE. The conditions published at
# messagr.eu say, in their own words, that "les trois points exigés par
# l'article 14 sont portés par l'écran « Informations légales », atteignable
# depuis les Réglages". Either that screen carries them or the page is false.
# These texts have already had to correct one false claim -- an earlier version
# announced a report "accessible depuis l'application, sur chaque message
# reçu" and, confronted with the code, nothing of the sort existed. That is the
# whole reason scripts/assert-retention.sh exists, and this is its sibling.
#
# WHAT IT CHECKS, AND WHAT IT DELIBERATELY DOES NOT. Not that the two texts
# match word for word: they are written for different readers and a check that
# demanded identical prose would be failed by every honest edit. What it checks
# is that each load-bearing FACT appears on both sides -- the contact address,
# the deadlines, that nothing forbidden is tolerated, that reporting is done
# from inside the application and receives a number, what the operator can
# and cannot read. Those are the sentences somebody could quietly drop from
# one side while leaving the other claiming it.
#
# SEVEN LANGUAGES, TWO PAGES (#466). The terms are published in French, which
# is authoritative, and in English at their own address. The screen speaks
# seven languages. So each fact is written below once per language: in French
# and in English it must appear on the published page AND on the screen; in
# German, Spanish, Italian, Dutch and Uzbek, which have no page, it must
# appear on the screen, which is the text a person in that language reads.
#
# AND WHAT MUST NO LONGER BE SAID ANYWHERE. Until #466 the terms and the
# screen said that no filter could exist, that the operator could not take a
# particular message down, and that reporting from inside the application did
# not exist yet. Honest for an operator that only ever sees ciphertext, and
# read by Apple, which refused build 27 under guideline 1.2 on 29 September
# 2026, as safeguards missing. ADR 0015 replaced all three; each is listed
# below, per language, and must appear neither on a page nor on the screen.
#
# THE SCREEN IS WHAT THE SCREEN DISPLAYS: the `legal_*` strings of each
# catalogue, not the file around them, whose comments quote the old texts on
# purpose. Until #466 this read the whole of fr.ts, comments included.
#
# THE PAGES ARE FETCHED, not read from the repository copy. What a person is
# bound by is what is served, and deploy/messagr-eu/site/ is what somebody
# intended to serve. The two can differ, and the day they do this must fail.
# `MESSAGR_TERMS_URL` and `MESSAGR_TERMS_EN_URL` default to messagr.eu, and
# deploy/messagr-eu/tests/controles-legaux.js points them at a built copy of
# the site (`file://`) to see this check pass and refuse. So does
# `MESSAGR_COPY_DIR` for the catalogues.
set -euo pipefail

TERMS="${MESSAGR_TERMS_URL:-https://messagr.eu/conditions-generales/}"
TERMS_EN="${MESSAGR_TERMS_EN_URL:-https://messagr.eu/conditions-generales/en/}"
COPY_DIR="${MESSAGR_COPY_DIR:-packages/app/src/copy}"
LANGUAGES="fr en de es it nl uz"

for lang in $LANGUAGES; do
  [ -f "$COPY_DIR/$lang.ts" ] || { echo "no copy catalogue at $COPY_DIR/$lang.ts" >&2; exit 1; }
done

# Tags stripped and whitespace collapsed before anything is looked for: the
# published page breaks sentences across <b> and <a>, so "conformite@
# messagr.eu" is three text nodes and a naive grep finds none of them.
# Apostrophes are normalised to the straight one, and that is not pedantry:
# the published page writes "n'existe pas encore" straight and the application
# writes it typographic. That is a difference of typography and this check is
# about facts, so a normalisation here is the difference between a check that
# reads meaning and one that reads punctuation.
flatten() {
  python3 -c '
import html, re, sys
text = re.sub(r"<[^>]+>", " ", sys.stdin.read())
text = html.unescape(text).replace("\u2019", "\u0027")
sys.stdout.write(re.sub(r"\s+", " ", text))
'
}

# What the legal screen displays in one language: the `legal_*` values of its
# catalogue, one after the other, flattened like the pages. Comments are taken
# out first, and a key with no value found is a failure rather than silence.
screen_of() {
  python3 - "$1" <<'PY'
import re, sys
source = open(sys.argv[1], encoding="utf-8").read()
source = re.sub(r"/\*[\s\S]*?\*/", " ", source)
source = re.sub(r"(?m)^\s*//.*$", " ", source)
values = re.findall(
    r"""(?m)^\s+'?legal_[a-z_]+'?:\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")""",
    source,
)
if not values:
    sys.exit("no legal_* string found in " + sys.argv[1])
text = " ".join(re.sub(r"\\(.)", r"\1", v[1:-1]) for v in values)
text = text.replace("\u2019", "\u0027")
sys.stdout.write(re.sub(r"\s+", " ", text))
PY
}

fetch() {
  # -L because a directory URL answers 301 towards its trailing slash, and -f
  # so a 404 stops here rather than being flattened into an empty string that
  # matches nothing and reports every fact as missing.
  local page
  page="$(curl -fsSL --max-time 30 "$1" | flatten)"
  [ -n "$page" ] || { echo "the published terms at $1 came back empty" >&2; exit 1; }
  printf '%s' "$page"
}

echo "fetching the published terms: $TERMS"
page_fr="$(fetch "$TERMS")"
echo "fetching their English translation: $TERMS_EN"
page_en="$(fetch "$TERMS_EN")"

# Each fact, as it must read, per language. Written with straight apostrophes,
# which is what `flatten` normalises the pages and the screen to. `all` is a
# fact every language carries as it is.
FACTS="
all|conformite@messagr.eu
fr|Messagr ne tolère aucun contenu interdit par ces conditions ni aucun comportement abusif
fr|vingt-quatre heures
fr|trente jours
fr|numéro de signalement
fr|Le signalement se fait depuis l'application
fr|sur ce que le signalement montre, jamais sur la seule affirmation d'un signalant
fr|cryptographiquement impossible
fr|bloqué depuis une conversation
fr|qui a bloqué qui, jamais ce qui a été dit
fr|contenus haineux
fr|images intimes
fr|démarchage
fr|quinze ans
fr|invitation nominative
fr|considérant 14
en|Messagr tolerates no content forbidden by these terms and no abusive behaviour
en|twenty-four hours
en|thirty days
en|report number
en|Reporting is done from inside the application
en|on what the report shows, never on a reporter's word alone
en|cryptographically unable
en|blocked from a conversation
en|who blocked whom, never what was said
en|hateful content
en|intimate images
en|solicitation
en|fifteen
en|named invitation
en|recital 14
de|Messagr duldet keine durch diese Bedingungen verbotenen Inhalte und kein missbräuchliches Verhalten
de|vierundzwanzig Stunden
de|dreißig Tage
de|Meldungsnummer
de|Gemeldet wird aus der App heraus
de|oder auf das, was die Meldung zeigt, nie auf die bloße Behauptung
de|kryptografisch nicht lesen
de|aus einer Unterhaltung heraus blockiert
de|wer wen blockiert hat, nie, was gesagt wurde
de|hasserfüllte Inhalte
de|intime Bilder
de|unerbetene Werbung
de|fünfzehn
de|namentliche Einladung
de|Erwägungsgrund 14
es|Messagr no tolera ningún contenido prohibido por estas condiciones ni ningún comportamiento abusivo
es|veinticuatro horas
es|treinta días
es|número de denuncia
es|La denuncia se hace desde la aplicación
es|o sobre lo que muestra la denuncia, nunca sobre la sola afirmación
es|criptográficamente imposible
es|bloquearse desde una conversación
es|quién bloqueó a quién, nunca lo que se dijo
es|contenidos de odio
es|imágenes íntimas
es|no solicitadas
es|quince años
es|invitación nominativa
es|considerando 14
it|Messagr non tollera alcun contenuto vietato da queste condizioni né alcun comportamento abusivo
it|ventiquattro ore
it|trenta giorni
it|numero di segnalazione
it|La segnalazione si fa dall'applicazione
it|o su ciò che la segnalazione mostra, mai sulla sola affermazione
it|crittograficamente impossibile
it|bloccato da una conversazione
it|chi ha bloccato chi, mai ciò che è stato detto
it|contenuti d'odio
it|immagini intime
it|non richieste
it|quindici anni
it|invito nominativo
it|considerando 14
nl|Messagr tolereert geen enkele inhoud die deze voorwaarden verbieden en geen enkel grensoverschrijdend gedrag
nl|vierentwintig uur
nl|dertig dagen
nl|meldingsnummer
nl|Melden gaat vanuit de app
nl|of op wat de melding toont, nooit op de loutere bewering
nl|cryptografisch onmogelijk
nl|vanuit een gesprek worden geblokkeerd
nl|wie wie heeft geblokkeerd, nooit wat er werd gezegd
nl|haatdragende inhoud
nl|intieme beelden
nl|ongevraagde reclame
nl|vijftien jaar
nl|op naam en op uitnodiging
nl|overweging 14
uz|ushbu shartlar taqiqlagan hech qanday mazmunga ham, hech qanday haqoratli xatti-harakatga ham yoʻl qoʻymaydi
uz|Yigirma toʻrt soat
uz|oʻttiz kun
uz|shikoyat raqami
uz|Shikoyat ilovaning oʻzidan qilinadi
uz|shikoyat koʻrsatgan narsaga asoslanadi, hech qachon faqat shikoyatchining gapiga emas
uz|kriptografik jihatdan oʻqiy olmaydigan
uz|suhbat ichidan bloklash
uz|kim kimni bloklaganini
uz|nafrat uygʻotuvchi
uz|intim tasvirlar
uz|soʻralmagan reklama
uz|oʻn besh
uz|nomli taklif
uz|14-bandi
"

# What neither side may say any more: the three sentences ADR 0015 retired,
# as each language wrote them.
RETIRED="
fr|n'existe pas encore
fr|il ne peut pas en exister
fr|retirer un message précis
en|does not exist yet
en|there cannot be
en|take down a particular message
de|gibt es noch nicht
de|es kann sie nicht geben
de|eine bestimmte Nachricht entfernen
es|todavía no existe
es|y no puede existir
es|retirar un mensaje concreto
it|non esiste ancora
it|e non può esistere
it|rimuovere un messaggio preciso
nl|bestaat nog niet
nl|die kan er ook niet zijn
nl|een bepaald bericht verwijderen
uz|hali yoʻq
uz|boʻlishi ham mumkin emas
uz|muayyan bir xabarni oʻchirish
"

page_in() {
  case "$1" in
    fr) printf '%s' "$page_fr" ;;
    en) printf '%s' "$page_en" ;;
    *) printf '' ;;
  esac
}

missing=0
said=0
checked=0
for lang in $LANGUAGES; do
  screen="$(screen_of "$COPY_DIR/$lang.ts")"
  page="$(page_in "$lang")"

  while IFS='|' read -r who fact; do
    [ -n "$who" ] || continue
    [ "$who" = "$lang" ] || [ "$who" = all ] || continue
    checked=$((checked + 1))
    in_screen=no
    case "$screen" in *"$fact"*) in_screen=yes ;; esac
    in_page=yes
    if [ -n "$page" ]; then
      in_page=no
      case "$page" in *"$fact"*) in_page=yes ;; esac
    fi
    if [ "$in_page" = yes ] && [ "$in_screen" = yes ]; then
      printf '  both    [%s] %s\n' "$lang" "$fact"
    else
      printf '  MISSING [%s] from %s: %s\n' "$lang" \
        "$( [ "$in_page" = no ] && printf 'the published page' || printf 'the application' )" \
        "$fact"
      missing=$((missing + 1))
    fi
  done <<EOF
$FACTS
EOF

  while IFS='|' read -r who sentence; do
    [ "$who" = "$lang" ] || continue
    for side in screen page; do
      text="$screen"
      [ "$side" = page ] && text="$page"
      [ -n "$text" ] || continue
      case "$text" in
        *"$sentence"*)
          printf '  RETIRED [%s] still said by %s: %s\n' "$lang" \
            "$( [ "$side" = page ] && printf 'the published page' || printf 'the application' )" \
            "$sentence"
          said=$((said + 1))
          ;;
      esac
    done
  done <<EOF
$RETIRED
EOF
done

if [ "$missing" -ne 0 ] || [ "$said" -ne 0 ]; then
  cat >&2 <<'WHY'

FAIL: the application's legal screen and the published terms disagree.

      One of the two has been edited without the other, or one of them still
      says what ADR 0015 retired. Which one is wrong depends on which is true
      -- do not "fix" this by copying a sentence across until you know. A
      page that claims something the application does not do is the failure
      this check exists to catch.
WHY
  exit 1
fi

echo "PASS: the legal screen and the published terms agree on $checked facts, in seven languages, and none says what ADR 0015 retired"
