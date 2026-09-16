#!/usr/bin/env python3
"""LES LIMITES D'APPLE, TENUES AVANT QU'UN MOT PARTE DANS LA CONSOLE.

Le `check.py` de Play existe parce que l'API rejette un champ trop long à la
fin d'une édition, après l'avoir ouverte et appliqué les autres champs. Ici la
raison est différente et pire : **il n'y a pas d'API**. L'`issuer id` et la clé
`.p8` d'App Store Connect vivent hors du dépôt (`docs/publishing-ios.md`), donc
la fiche est recopiée à la main dans un formulaire. Un champ trop long ne
produit pas une erreur d'API, il produit une **troncature silencieuse au
collage**, ou un aller-retour dans une console. Le refus doit donc tomber au
moment où le texte est écrit, en revue, pas au moment où quelqu'un le colle.

# CE QUI SE COMPTE EN OCTETS, ET PAS EN CARACTÈRES

Une seule limite d'Apple n'est pas en caractères, et c'est celle qui compte le
plus dans une fiche française : « You can provide up to **100 bytes** of
content » pour les mots-clés. En UTF-8, chaque `é` en coûte deux. Les mots-clés
de `fr-FR.json` font 87 caractères et 93 octets : un contrôle qui compterait
les caractères les donnerait pour 13 de marge là où il en reste 7, et
laisserait passer une chaîne qu'Apple refuse. C'est exactement le genre d'écart
qui ne se voit pas à la lecture.

# CE QU'IL VÉRIFIE EN PLUS DES LONGUEURS

**Qu'une URL de la fiche soit une page que ce dépôt sert.** Apple visite l'URL
de l'assistance ; sa règle est qu'elle « must lead to actual contact
information ». Une adresse qui répond 404 est un refus en revue, et rien
ailleurs ne relie la fiche aux pages de `site/`. Le contrôle est hors ligne et
ne juge que l'existence : il lit l'arbre committé, pas le serveur.

# LE CONTRÔLEUR EST LUI-MÊME ÉPROUVÉ

`--self-test` reprend la fiche réelle, la casse d'une quinzaine de façons — une
description de 4001 caractères, des mots-clés de 104 octets qui ne font que
97 caractères, une URL vide, une URL que le dépôt ne sert pas — et exige un
refus à chaque fois, pour le bon champ. Un contrôleur qui n'a jamais refusé ne
prouve rien. Il exige aussi que la fiche réelle, elle, passe : un contrôleur
qui refuse tout n'en prouve pas davantage.

# LES SOURCES

Chaque limite porte la phrase d'Apple qui l'établit et la page où elle est
écrite, et le refus la recopie. Une limite sans sa source est une limite que
personne ne peut vérifier sans refaire la recherche, et que personne ne corrige
quand Apple la change.

    python3 check.py              # la fiche
    python3 check.py --self-test  # le contrôleur
"""
import json
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).parent
SITE = HERE.parent / "site"

# ── Les pages d'Apple, lues le 16 septembre 2026 ────────────────────────────
INFO = (
    "App Store Connect Help, Reference > App information > App information, "
    "https://developer.apple.com/help/app-store-connect/reference"
    "/app-information/app-information/"
)
VERSION = (
    "App Store Connect Help, Reference > App information > Platform version "
    "information, https://developer.apple.com/help/app-store-connect/reference"
    "/app-information/platform-version-information/"
)

# Champ -> (unité, plafond, la phrase d'Apple, la page).
#
# `octets` pour les mots-clés seuls, parce qu'Apple l'écrit ainsi et que c'est
# la seule des cinq où le français change la réponse.
LIMITES = {
    "name": (
        "caractères",
        30,
        "The name must be at least two characters and no more than 30 characters.",
        INFO,
    ),
    "subtitle": ("caractères", 30, "This can’t be longer than 30 characters.", INFO),
    "promotionalText": (
        "caractères",
        170,
        "This property can’t be longer than 170 characters.",
        VERSION,
    ),
    "description": ("caractères", 4000, "Limited to 4000 characters.", VERSION),
    "keywords": (
        "octets",
        100,
        "You can provide up to 100 bytes of content.",
        VERSION,
    ),
}

# Ce qu'Apple marque « This property is required ». `subtitle`,
# `promotionalText` et `marketingUrl` ne le sont pas : ils sont plafonnés sans
# être exigés.
OBLIGATOIRES = {
    "name": INFO,
    "description": VERSION,
    "keywords": VERSION,
    "supportUrl": VERSION,
    "copyright": VERSION,
}

URLS = ("supportUrl", "marketingUrl")
ORIGINE = "https://messagr.eu"

# Une URL dans de la prose s'arrête sur une ponctuation de phrase : la
# description écrit « est sur https://messagr.eu. », et le point final
# n'appartient pas à l'adresse.
ADRESSE = re.compile(r"https?://[^\s<>\"»]+")
FIN_DE_PHRASE = ".,;:!?)»"


def mesure(unite, valeur):
    return len(valeur) if unite == "caractères" else len(valeur.encode("utf-8"))


def page_servie(url):
    """Le fichier de `site/` que cette adresse de messagr.eu désigne, ou None."""
    chemin = url[len(ORIGINE) :].split("?")[0].split("#")[0].strip("/")
    if not chemin:
        return SITE / "index.html"
    candidats = (SITE / chemin / "index.html", SITE / chemin)
    for candidat in candidats:
        if candidat.is_file():
            return candidat
    return None


def verifier(nom, fiche):
    """Les refus que cette fiche mérite, en clair. Vide si elle passe."""
    refus = []

    def refuser(champ, dit, phrase, page):
        refus.append(f"{nom}: {champ} {dit}\n     Apple : « {phrase} »\n     {page}")

    for champ, page in OBLIGATOIRES.items():
        if not str(fiche.get(champ, "")).strip():
            refuser(champ, "est vide", "This property is required.", page)

    for champ, (unite, plafond, phrase, page) in LIMITES.items():
        valeur = str(fiche.get(champ, ""))
        if not valeur:
            continue
        combien = mesure(unite, valeur)
        if combien > plafond:
            refuser(
                champ,
                f"fait {combien} {unite}, et Apple en autorise {plafond}",
                phrase,
                page,
            )

    # ── Les mots-clés, au-delà de leur longueur ────────────────────────────
    mots = [m for m in str(fiche.get("keywords", "")).split(",") if m != ""]
    for mot in mots:
        if mot != mot.strip():
            refuser(
                "keywords",
                f"écrit « {mot} » avec une espace contre une virgule, et cette "
                "espace est un octet dépensé pour rien",
                "You can provide up to 100 bytes of content.",
                VERSION,
            )
        elif len(mot) <= 2:
            refuser(
                "keywords",
                f"porte « {mot} », qui fait deux caractères ou moins",
                "One or more keywords (each greater than two characters) "
                "describing your app.",
                VERSION,
            )
        elif mot.casefold() == str(fiche.get("name", "")).casefold():
            refuser(
                "keywords",
                f"répète « {mot} », qui est déjà le nom de l'application",
                "Your app is searchable by app name and company name, so you "
                "shouldn’t duplicate these values in the keyword list.",
                VERSION,
            )

    # ── Les adresses ───────────────────────────────────────────────────────
    for champ in URLS:
        valeur = str(fiche.get(champ, "")).strip()
        if valeur and not valeur.startswith(("http://", "https://")):
            refuser(
                champ,
                f"vaut « {valeur} », qui ne porte pas son protocole",
                "Specify the entire URL, including the protocol (for example, "
                "http://support.example.com).",
                VERSION,
            )

    partout = " ".join(str(fiche.get(c, "")) for c in list(URLS) + ["description"])
    for brute in ADRESSE.findall(partout):
        url = brute.rstrip(FIN_DE_PHRASE)
        if not url.startswith(ORIGINE):
            continue
        if page_servie(url) is None:
            refuser(
                "adresse",
                f"« {url} » ne correspond à aucune page de "
                "deploy/messagr-eu/site/, donc Apple y trouverait un 404",
                "This URL must lead to actual contact information (legal "
                "address, email address, telephone number).",
                VERSION,
            )

    # ── Le copyright ───────────────────────────────────────────────────────
    droit = str(fiche.get("copyright", "")).strip()
    if droit:
        phrase = (
            "The name of the person or entity that owns the exclusive rights to "
            "the app, preceded by the year the rights were obtained (for "
            "example, 2014 Example, Inc.). The copyright symbol is added "
            "automatically."
        )
        if not re.match(r"^(19|20)\d{2}\s+\S", droit):
            refuser(
                "copyright",
                f"vaut « {droit} », qui ne commence pas par l'année suivie du nom",
                phrase,
                VERSION,
            )
        if "©" in droit:
            refuser("copyright", "porte le signe ©, qu'Apple ajoute lui-même", phrase, VERSION)

    return refus


def raconter(nom, fiche, refus):
    for ligne in refus:
        print(f"FAIL {ligne}", file=sys.stderr)
    if refus:
        return
    for champ, (unite, plafond, _, _) in LIMITES.items():
        valeur = str(fiche.get(champ, ""))
        if valeur:
            print(f"OK   {nom}: {champ} {mesure(unite, valeur)}/{plafond} {unite}")
        else:
            print(f"OK   {nom}: {champ} non fourni, et Apple ne l'exige pas")
    for champ in URLS + ("copyright",):
        valeur = str(fiche.get(champ, "")).strip()
        if valeur:
            print(f"OK   {nom}: {champ} « {valeur} »")


def fiches():
    for chemin in sorted(HERE.glob("*.json")):
        yield chemin.name, json.loads(chemin.read_text(encoding="utf-8"))


def controler():
    echoue = False
    for nom, fiche in fiches():
        refus = verifier(nom, fiche)
        raconter(nom, fiche, refus)
        echoue = echoue or bool(refus)
    return 1 if echoue else 0


# ── Le contrôleur, éprouvé contre des fiches fausses ───────────────────────
#
# Les mutations partent de la fiche réelle : une fiche de laboratoire écrite
# ici dériverait de celle qu'on publie, et le contrôleur serait éprouvé contre
# une forme que plus personne n'utilise.
def casser(fiche, champ, valeur):
    copie = dict(fiche)
    copie[champ] = valeur
    return copie


def self_test():
    nom, vraie = next(iter(fiches()))
    echoue = False

    def attendre(quoi, cassee, champ):
        nonlocal echoue
        refus = verifier("mutant.json", cassee)
        vise = [r for r in refus if r.startswith(f"mutant.json: {champ} ")]
        if vise:
            print(f"OK   refusé : {quoi}")
        else:
            print(f"FAIL non refusé : {quoi} (refus obtenus : {refus})", file=sys.stderr)
            echoue = True

    # SOUS la limite si on compte les caractères, AU-DESSUS si on compte comme
    # Apple : la chaîne réelle avec « tchat » remplacé par un mot accentué.
    # C'est le cas qu'un contrôle écrit en caractères laisserait passer, et
    # qu'Apple refuserait.
    lourds = vraie["keywords"].replace("tchat", "visioconférence")
    assert len(lourds) < 100 < len(lourds.encode("utf-8")), (
        len(lourds),
        len(lourds.encode("utf-8")),
    )

    # (ce qu'on casse, le champ cassé, la valeur, le champ que le refus doit
    # nommer — « adresse » quand c'est la page visée qui manque, et non la
    # forme du champ).
    cas = [
        ("une description de 4001 caractères", "description", "a" * 4001, "description"),
        ("des mots-clés de 101 caractères", "keywords", "a" * 101, "keywords"),
        (
            f"des mots-clés de {len(lourds)} caractères et "
            f"{len(lourds.encode('utf-8'))} octets",
            "keywords",
            lourds,
            "keywords",
        ),
        ("un mot-clé de deux caractères", "keywords", "vie,ok,privée", "keywords"),
        ("une espace contre une virgule", "keywords", "vie, privée", "keywords"),
        ("un mot-clé qui répète le nom", "keywords", "vie,Messagr", "keywords"),
        ("une URL d'assistance vide", "supportUrl", "", "supportUrl"),
        (
            "une URL d'assistance sans protocole",
            "supportUrl",
            "messagr.eu/aide",
            "supportUrl",
        ),
        (
            "une URL d'assistance que ce dépôt ne sert pas",
            "supportUrl",
            "https://messagr.eu/aide",
            "adresse",
        ),
        (
            "une description qui renvoie à une page retirée",
            "description",
            "Tout est expliqué sur https://messagr.eu/telechargement-direct.",
            "adresse",
        ),
        ("un nom de 31 caractères", "name", "a" * 31, "name"),
        ("un sous-titre de 31 caractères", "subtitle", "a" * 31, "subtitle"),
        (
            "un texte promotionnel de 171 caractères",
            "promotionalText",
            "a" * 171,
            "promotionalText",
        ),
        ("un copyright vide", "copyright", "", "copyright"),
        ("un copyright sans son année", "copyright", "RV Myriagone Holding", "copyright"),
        (
            "un copyright qui écrit le ©",
            "copyright",
            "2026 © RV Myriagone Holding",
            "copyright",
        ),
    ]
    for quoi, champ, valeur, attendu in cas:
        attendre(quoi, casser(vraie, champ, valeur), attendu)

    # Et le contrôle qui vaut autant : la fiche réelle passe.
    refus = verifier(nom, vraie)
    if refus:
        print(f"FAIL la fiche réelle est refusée : {refus}", file=sys.stderr)
        echoue = True
    else:
        print(f"OK   accepté : {nom}, tel qu'il est écrit")

    return 1 if echoue else 0


if __name__ == "__main__":
    sys.exit(self_test() if "--self-test" in sys.argv[1:] else controler())
