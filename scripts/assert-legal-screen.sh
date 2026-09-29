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
# EVERY LANGUAGE OF THE SCREEN, TWO PAGES (#466). The terms are published in
# French, which is authoritative, and in English at their own address. The
# screen speaks every language `languages.ts` declares, seven today. So each
# fact is written below once per language: in French and in English it must
# appear on the published page AND on the screen; in the others, which have
# no page, it must appear on the screen, which is the text a person in that
# language reads. A language declared with no facts written here fails.
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

# THE LANGUAGES ARE THE APPLICATION'S, read where it declares them
# (`languages.ts`), and not listed here: an eighth catalogue is checked, or
# refused for want of facts written below, rather than skipped in silence.
LANGUAGES="$(python3 -c '
import re, sys
declared = open(sys.argv[1], encoding="utf-8").read()
print(" ".join(re.findall(r"code: \x27([a-z]{2})\x27", declared)))
' "$COPY_DIR/languages.ts")"
[ -n "$LANGUAGES" ] || { echo "no language declared in $COPY_DIR/languages.ts" >&2; exit 1; }
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
#
# THE COMMITMENTS THEMSELVES, NOT THEIR KEYWORDS (#466). « vingt-quatre heures »
# alone would stay true of a screen that dropped the takedown and kept a
# stray mention of the delay. So the zero tolerance, the takedown and
# suspension within twenty-four hours, the reasoned decision within thirty
# days, the termination it can confirm, the report number and the block are
# each checked as the sentence that commits to them.
FACTS="
all|conformite@messagr.eu
fr|L'exploitant ne tolère aucun contenu interdit par ces conditions ni aucun comportement abusif : il retire le contenu, suspend le compte de son auteur, puis le ferme si la décision le confirme
fr|Dans les vingt-quatre heures qui suivent sa réception, l'exploitant ouvre le signalement et, si ce qu'il montre enfreint ces conditions, retire les messages signalés, puis suspend le compte de leur auteur
fr|Une décision motivée suit, au plus tard trente jours après la réception du signalement
fr|elle confirme la suspension, le compte est fermé
fr|Chaque signalement reçoit un numéro de signalement
fr|compte peut être bloqué depuis une conversation : plus rien de ce qu'il envoie ne vous parvient, ce qu'il a déjà écrit disparaît de vos écrans, et il ne peut plus vous inviter dans Messagr
fr|Le signalement se fait depuis l'application
fr|L'exploitant ne lit que ce qu'un signalement porte
fr|sur ce que le signalement montre, jamais sur la seule affirmation d'un signalant
fr|qui a bloqué qui, jamais ce qui a été dit
fr|cryptographiquement impossible
fr|contenus haineux
fr|images intimes
fr|démarchage
fr|quinze ans
fr|invitation nominative
fr|considérant 14
en|The operator tolerates no content forbidden by these terms and no abusive behaviour: it takes the content down, suspends its author's account, then terminates it if the decision confirms it
en|Within twenty-four hours of its receipt, the operator opens the report and, if what it shows breaks these terms, takes the reported messages down, then suspends their author's account
en|A reasoned decision follows, within thirty days of the report's receipt at the latest
en|it confirms the suspension, the account is terminated
en|Each report receives a report number
en|account can be blocked from a conversation: nothing it sends reaches you any more, what it has already written leaves your screens, and it can no longer invite you in Messagr
en|Reporting is done from inside the application
en|The operator reads only what a report carries
en|on what the report shows, never on a reporter's word alone
en|who blocked whom, never what was said
en|cryptographically unable
en|hateful content
en|intimate images
en|solicitation
en|fifteen
en|named invitation
en|recital 14
de|Der Betreiber duldet keine durch diese Bedingungen verbotenen Inhalte und kein missbräuchliches Verhalten: Er entfernt den Inhalt, sperrt das Konto, von dem er stammt, und schließt es, wenn die Entscheidung dies bestätigt
de|Innerhalb von vierundzwanzig Stunden öffnet der Betreiber die Meldung und entfernt, wenn das, was sie zeigt, gegen diese Bedingungen verstößt, die gemeldeten Nachrichten und sperrt danach das Konto, von dem sie stammen
de|Spätestens dreißig Tage nach Eingang der Meldung folgt eine begründete Entscheidung
de|bestätigt sie die Sperre, wird das Konto geschlossen
de|Jede Meldung erhält eine Meldungsnummer
de|Jedes Konto kann aus einer Unterhaltung heraus blockiert werden: Nichts, was es sendet, erreicht Sie mehr; was es bereits geschrieben hat, verschwindet von Ihren Bildschirmen; und es kann Sie in Messagr nicht mehr einladen
de|Gemeldet wird aus der App heraus
de|Der Betreiber liest nur, was eine Meldung enthält
de|oder auf das, was die Meldung zeigt, nie auf die bloße Behauptung einer meldenden Person
de|wer wen blockiert hat, nie, was gesagt wurde
de|kryptografisch nicht lesen
de|hasserfüllte Inhalte
de|intime Bilder
de|unerbetene Werbung und Anwerbung, ob kommerziell oder nicht
de|fünfzehn
de|namentliche Einladung
de|Erwägungsgrund 14
es|Quien explota el servicio no tolera ningún contenido prohibido por estas condiciones ni ningún comportamiento abusivo: retira el contenido, suspende la cuenta de su autor y después la cierra si la decisión lo confirma
es|En un plazo de veinticuatro horas, quien explota el servicio abre la denuncia y, si lo que muestra infringe estas condiciones, retira los mensajes denunciados y después suspende la cuenta de su autor
es|A más tardar treinta días después de la recepción de la denuncia llega una decisión motivada
es|si confirma la suspensión, la cuenta se cierra
es|Cada denuncia recibe un número de denuncia
es|Cualquier cuenta puede bloquearse desde una conversación: nada de lo que envía le llega, lo que ya escribió desaparece de sus pantallas y no puede volver a invitarle en Messagr
es|La denuncia se hace desde la aplicación
es|Quien explota el servicio solo lee lo que lleva una denuncia
es|o sobre lo que muestra la denuncia, nunca sobre la sola afirmación de quien denuncia
es|quién bloqueó a quién, nunca lo que se dijo
es|criptográficamente imposible
es|contenidos de odio
es|imágenes íntimas
es|la captación y la publicidad no solicitadas
es|quince años
es|invitación nominativa
es|considerando 14
it|Chi gestisce il servizio non tollera alcun contenuto vietato da queste condizioni né alcun comportamento abusivo: rimuove il contenuto, sospende l'account del suo autore, poi lo chiude se la decisione lo conferma
it|Entro ventiquattro ore, chi gestisce il servizio apre la segnalazione e, se ciò che mostra viola queste condizioni, rimuove i messaggi segnalati, poi sospende l'account del loro autore
it|Al più tardi trenta giorni dopo il ricevimento della segnalazione arriva una decisione motivata
it|se conferma la sospensione, l'account viene chiuso
it|Ogni segnalazione riceve un numero di segnalazione
it|Qualsiasi account può essere bloccato da una conversazione: nulla di ciò che invia le arriva più, ciò che ha già scritto scompare dai suoi schermi, e non può più invitarla in Messagr
it|La segnalazione si fa dall'applicazione
it|Chi gestisce il servizio legge solo ciò che una segnalazione porta
it|o su ciò che la segnalazione mostra, mai sulla sola affermazione di chi segnala
it|chi ha bloccato chi, mai ciò che è stato detto
it|crittograficamente impossibile
it|contenuti d'odio
it|immagini intime
it|le sollecitazioni commerciali o di altro tipo non richieste
it|quindici anni
it|invito nominativo
it|considerando 14
nl|De exploitant tolereert geen enkele inhoud die deze voorwaarden verbieden en geen enkel grensoverschrijdend gedrag: hij verwijdert de inhoud, schort het account van de afzender op en sluit het als de beslissing dat bevestigt
nl|Binnen vierentwintig uur opent de exploitant de melding en, als wat die toont deze voorwaarden schendt, verwijdert hij de gemelde berichten en schort hij daarna het account van de afzender op
nl|Uiterlijk dertig dagen na ontvangst van de melding volgt een met redenen omklede beslissing
nl|bevestigt die de opschorting, dan wordt het account gesloten
nl|Elke melding krijgt een meldingsnummer
nl|Elk account kan vanuit een gesprek worden geblokkeerd: niets van wat het verstuurt bereikt u nog, wat het al schreef verdwijnt van uw schermen, en het kan u in Messagr niet meer uitnodigen
nl|Melden gaat vanuit de app
nl|De exploitant leest alleen wat een melding bevat
nl|of op wat de melding toont, nooit op de loutere bewering van wie meldt
nl|wie wie heeft geblokkeerd, nooit wat er werd gezegd
nl|cryptografisch onmogelijk
nl|haatdragende inhoud
nl|intieme beelden
nl|ongevraagde reclame en werving
nl|vijftien jaar
nl|op naam en op uitnodiging
nl|overweging 14
uz|Operator ushbu shartlar taqiqlagan hech qanday mazmunga ham, hech qanday suiisteʼmolga ham yoʻl qoʻymaydi: u mazmunni olib tashlaydi, muallifining hisobini toʻxtatib turadi, soʻng qaror buni tasdiqlasa, hisobni yopadi
uz|Yigirma toʻrt soat ichida operator shikoyatni ochadi va u koʻrsatgan narsa ushbu shartlarni buzsa, shikoyat qilingan xabarlarni olib tashlaydi, soʻng ularning muallifi hisobini toʻxtatib turadi
uz|Shikoyat kelib tushganidan boshlab koʻpi bilan oʻttiz kun ichida asoslangan qaror chiqariladi
uz|u toʻxtatib turishni tasdiqlasa, hisob yopiladi
uz|Har bir shikoyatga shikoyat raqami beriladi
uz|Har qanday hisobni suhbat ichidan bloklash mumkin: u yuboradigan hech narsa sizga endi yetib kelmaydi, u allaqachon yozgan narsalar ekranlaringizdan yoʻqoladi va u sizni Messagrda boshqa taklif qila olmaydi
uz|Shikoyat ilovaning oʻzidan qilinadi
uz|Operator faqat shikoyatda bor narsani oʻqiydi
uz|shikoyat koʻrsatgan narsaga asoslanadi, hech qachon faqat shikoyatchining gapiga emas
uz|kim kimni bloklaganini
uz|kriptografik jihatdan oʻqiy olmaydigan
uz|nafrat uygʻotuvchi
uz|intim tasvirlar
uz|soʻralmagan reklama va targʻibot
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

# Every language the application offers has facts and retired sentences
# written here, and no other language has any. Matched with `case` rather
# than a pipe into `grep -q`, which `pipefail` reads as a failure the moment
# grep stops reading.
newline='
'
for lang in $LANGUAGES; do
  case "$FACTS" in *"$newline$lang|"*) ;; *)
    echo "no fact is written here for $lang, a language the application offers: its legal screen would be checked for nothing" >&2
    exit 1 ;;
  esac
  case "$RETIRED" in *"$newline$lang|"*) ;; *)
    echo "no retired sentence is written here for $lang, a language the application offers" >&2
    exit 1 ;;
  esac
done
for who in $(printf '%s\n%s\n' "$FACTS" "$RETIRED" | cut -d'|' -f1 | sort -u); do
  [ "$who" = all ] && continue
  case " $LANGUAGES " in *" $who "*) ;; *)
    echo "facts are written here for $who, a language the application does not declare" >&2
    exit 1 ;;
  esac
done

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

count="$(printf '%s' "$LANGUAGES" | wc -w | tr -d ' ')"
echo "PASS: the legal screen and the published terms agree on $checked facts, in $count languages, and none says what ADR 0015 retired"
