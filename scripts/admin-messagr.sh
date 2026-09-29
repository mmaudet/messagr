#!/usr/bin/env bash
#
# Faire agir le homeserver de messagr.eu : retirer un message, effacer la
# copie chiffrée d'un fichier, suspendre un compte, lever sa suspension, le
# fermer (#473, ADR 0015). La procédure, dans l'ordre des gestes, est dans
# deploy/messagr-eu-invitations.md, « Reports: acting within twenty-four
# hours ».
#
# Rapatrié d'old_messagr (deploy/admin-messagr.sh), avec ses gardes.
#
# # Continuwuity s'administre par des messages
#
# Le homeserver de production est Continuwuity, pas Synapse : pas de
# /_synapse/admin. Une commande d'administration est un MESSAGE, « !admin … »,
# posté dans le salon #admins:<serveur> par un compte administrateur, et le
# compte du serveur y répond par un autre message. Ce script poste la
# commande et attend la réponse, qu'il affiche sur la sortie standard.
#
# # Les gestes
#
#   scripts/admin-messagr.sh retirer '$<événement>'
#       !admin users redact-event <événement>, le retrait d'un message
#   scripts/admin-messagr.sh effacer-media mxc://<serveur>/<média>
#       !admin media delete --mxc <adresse>, la copie chiffrée d'un fichier
#   scripts/admin-messagr.sh suspendre @<compte>:<serveur>
#       !admin users lock <compte>, la suspension
#   scripts/admin-messagr.sh lever @<compte>:<serveur>
#       !admin users unlock <compte>, la levée
#   scripts/admin-messagr.sh fermer @<compte>:<serveur>
#       !admin users deactivate <compte>, la fermeture
#   scripts/admin-messagr.sh "<commande>"
#       !admin <commande>, pour tout le reste, entre guillemets
#
# L'identifiant d'un événement commence par « $ » : écrivez-le entre
# apostrophes, sinon le shell le prend pour une variable et en laisse un
# reste, souvent vide, que ce script refuse.
#
# # Les gardes
#
# - LE COMPTE D'EXPLOITATION, ET LUI SEUL. Son jeton est LU dans
#   ~/.messagr-exploitation/messagr-eu.json, jamais passé en argument : un
#   argument se lit dans `ps` par tout processus de la machine, et reste dans
#   l'historique du shell. Le fichier n'est lisible que par vous, ou le script
#   refuse. Le homeserver doit dire que le jeton est bien celui du compte que
#   le fichier nomme (whoami) : c'est à ce compte que le script reconnaît son
#   propre message, pour attendre la réponse du serveur et non la sienne.
# - LA CONFIRMATION. Rien ne part avant que le geste soit dit et sa cible
#   tapée en retour : l'événement, l'adresse ou le compte, la commande
#   entière pour une commande libre. Toute autre réponse, ou la fin de
#   l'entrée standard, ne poste rien.
# - Le compte d'exploitation ne se suspend ni ne se ferme par ce script.
# - LE REPÈRE AVANT D'ÉCRIRE : sans lui, le script relirait d'anciennes
#   réponses.
# - LA RÉPONSE DU SERVEUR, PAS LA NÔTRE, et sans réponse sous 25 secondes le
#   script dit que la commande A ÉTÉ postée : on la cherche alors dans
#   #admins plutôt que de la poster une seconde fois.
#
# # L'essai
#
#   scripts/admin-messagr.sh --self-test
#
# rejoue chaque geste et chaque garde contre un homeserver factice, local,
# avec un fichier d'identifiants factice dans un répertoire personnel
# temporaire : jamais contre le vrai. La CI le lance.
#
# Le programme passe à Python par le descripteur 3, pour que l'entrée
# standard reste celle de l'exploitant, qui tape la confirmation.
set -euo pipefail

ADMIN_MESSAGR_SCRIPT="$0" exec python3 /dev/fd/3 "$@" 3<<'PY'
import json
import os
import pathlib
import re
import stat
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

CREDENTIALS = pathlib.Path.home() / ".messagr-exploitation" / "messagr-eu.json"
# Combien de secondes attendre la réponse du serveur. Changé par l'essai
# seulement, pour ne pas attendre 25 secondes une réponse qui ne vient pas.
ATTENTE = float(os.environ.get("ADMIN_MESSAGR_ATTENTE", "25"))

EVENEMENT = re.compile(r"^\$[A-Za-z0-9+/=_.:\-]{8,}$")
MEDIA = re.compile(r"^mxc://[A-Za-z0-9.\-:\[\]]+/[A-Za-z0-9_\-]+$")
COMPTE = re.compile(r"^@[a-z0-9._=/+\-]+:[A-Za-z0-9.\-:\[\]]+$")

USAGE = """usage :
  scripts/admin-messagr.sh retirer '$<événement>'
  scripts/admin-messagr.sh effacer-media mxc://<serveur>/<média>
  scripts/admin-messagr.sh suspendre @<compte>:<serveur>
  scripts/admin-messagr.sh lever @<compte>:<serveur>
  scripts/admin-messagr.sh fermer @<compte>:<serveur>
  scripts/admin-messagr.sh "<commande d'administration>"
  scripts/admin-messagr.sh --self-test"""


def dire(texte):
    print(texte, file=sys.stderr, flush=True)


def refuser(pourquoi, code=1):
    dire(pourquoi)
    raise SystemExit(code)


# Chaque geste : ce qu'il poste, la forme de sa cible, ce que dit le plan.
GESTES = {
    "retirer": (
        "users redact-event",
        EVENEMENT,
        "l'identifiant d'un événement, qui commence par « $ », entre apostrophes",
        "Retirer pour tout le monde le message {cible}. Le homeserver l'expurge au nom de son\n"
        "auteur, avec la raison fixe qu'il écrit alors, et l'application montre « Retiré par\n"
        "l'exploitant » à sa place. L'auteur doit encore être membre de la conversation :\n"
        "un retrait vient avant toute fermeture.",
        "l'événement",
    ),
    "effacer-media": (
        "media delete --mxc",
        MEDIA,
        "une adresse mxc://<serveur>/<média>, celle que l'outil d'ouverture montre",
        "Effacer du serveur la copie chiffrée {cible}, le fichier d'une photo ou d'un\n"
        "document signalé : elle ne se télécharge plus, pour personne.",
        "l'adresse",
    ),
    "suspendre": (
        "users lock",
        COMPTE,
        "un compte, @<compte>:<serveur>",
        "Suspendre {cible} : le homeserver verrouille le compte (users lock). Il ne peut plus\n"
        "rien faire que se déconnecter, et garde ses appareils, ses clés et ses conversations.\n"
        "La levée le rend tel qu'il était.",
        "le compte",
    ),
    "lever": (
        "users unlock",
        COMPTE,
        "un compte, @<compte>:<serveur>",
        "Lever la suspension de {cible} (users unlock) : le compte reprend tel qu'il était.",
        "le compte",
    ),
    "fermer": (
        "users deactivate",
        COMPTE,
        "un compte, @<compte>:<serveur>",
        "Fermer {cible} (users deactivate) : le compte quitte toutes ses conversations et ne\n"
        "revient pas, et le homeserver ne libère jamais son nom. La fermeture n'expurge rien :\n"
        "chaque message signalé doit déjà être retiré, puisqu'un retrait se fait au nom de\n"
        "l'auteur, qui doit encore être membre. Ensuite, sur l'hôte :\n"
        "  docker compose run --rm invitations --record-termination {cible}",
        "le compte",
    ),
}


def le_geste(arguments):
    """La commande à poster, ce qu'il faut taper en retour, et le plan."""
    if not arguments or arguments[0] in ("-h", "--help"):
        refuser(USAGE, 2)
    nom = arguments[0]
    if nom in GESTES:
        commande, forme, attendu, plan, quoi = GESTES[nom]
        if len(arguments) != 2:
            refuser(f"{nom} nomme une cible, et une seule : {attendu}.\n\n{USAGE}", 2)
        cible = arguments[1]
        if not forme.match(cible):
            refuser(
                f"{cible!r} n'est pas {attendu}. Rien n'a été posté.\n\n{USAGE}", 2
            )
        return (
            f"{commande} {cible}",
            cible,
            plan.format(cible=cible) + f"\nTapez {quoi} pour le faire, autre chose pour ne rien faire :",
            nom,
        )
    if len(arguments) != 1 or nom.startswith("-"):
        refuser(
            "Un geste nommé, ou une commande d'administration entière entre guillemets, en un\n"
            f"seul argument.\n\n{USAGE}",
            2,
        )
    return (
        nom,
        nom,
        "Tapez la commande entière pour la poster, autre chose pour ne rien faire :",
        None,
    )


def les_identifiants():
    """Le serveur, le compte d'exploitation et son jeton, du seul fichier qui les garde."""
    if not CREDENTIALS.is_file():
        refuser(f"introuvable : {CREDENTIALS}. Rien n'a été posté.")
    if CREDENTIALS.stat().st_mode & (stat.S_IRWXG | stat.S_IRWXO):
        refuser(
            f"{CREDENTIALS} se lit par d'autres que vous : chmod 600, puis recommencez.\n"
            "Rien n'a été posté."
        )
    try:
        lus = json.loads(CREDENTIALS.read_text())
        return lus["serveur"].rstrip("/"), lus["user_id"], lus["access_token"]
    except (ValueError, KeyError, AttributeError):
        refuser(
            f"{CREDENTIALS} ne porte pas serveur, user_id et access_token. Rien n'a été posté."
        )


def principal(arguments):
    commande, attendu, plan, nom = le_geste(arguments)
    serveur, moi, jeton = les_identifiants()
    base = serveur + "/_matrix/client/v3"
    entetes = {"Authorization": "Bearer " + jeton, "Content-Type": "application/json"}

    def appel(chemin, corps=None, methode=None):
        requete = urllib.request.Request(
            base + chemin,
            data=json.dumps(corps).encode() if corps is not None else None,
            headers=entetes,
            method=methode,
        )
        try:
            with urllib.request.urlopen(requete, timeout=30) as reponse:
                return json.load(reponse)
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf8", "replace")[:300]
            refuser(f"HTTP {e.code} sur {chemin} : {detail}")
        except urllib.error.URLError as e:
            refuser(f"le homeserver ne répond pas ({e.reason}) : rien n'a été posté.")

    # LE COMPTE D'EXPLOITATION : le jeton est-il celui du compte que le
    # fichier nomme ? Sinon le script prendrait son propre message pour la
    # réponse du serveur.
    qui = appel("/account/whoami").get("user_id")
    if qui != moi:
        refuser(
            f"le jeton de {CREDENTIALS} n'est pas celui de {moi} : le homeserver le donne à "
            f"{qui}. Rien n'a été posté."
        )
    if nom in ("suspendre", "fermer") and attendu == moi:
        refuser(f"{moi} est le compte d'exploitation : ce script ne le {nom} pas.")

    nom_du_serveur = serveur.split("://")[-1]
    salon = appel("/directory/room/" + urllib.parse.quote(f"#admins:{nom_du_serveur}"))[
        "room_id"
    ]
    q = urllib.parse.quote(salon, safe="")

    # LA CONFIRMATION : le geste dit, la cible tapée en retour.
    dire(plan.replace("Tapez", f"Poste dans #admins:{nom_du_serveur}, au nom de {moi} :\n  !admin {commande}\nTapez", 1))
    reponse = sys.stdin.readline()
    if reponse.strip() != attendu:
        refuser("Rien n'a été posté.")

    # Le repère AVANT d'écrire : sans lui, on relirait d'anciennes réponses.
    depuis = appel(
        "/sync?timeout=0&filter="
        + urllib.parse.quote(json.dumps({"room": {"timeline": {"limit": 1}}}))
    )["next_batch"]
    poste = appel(
        f"/rooms/{q}/send/m.room.message/{int(time.time() * 1000)}",
        {"msgtype": "m.text", "body": "!admin " + commande},
        methode="PUT",
    )

    # Continuwuity répond à part : on attend SA réponse, pas la nôtre.
    echeance = time.time() + ATTENTE
    while time.time() < echeance:
        lus = appel(f"/rooms/{q}/messages?dir=f&from={urllib.parse.quote(depuis)}&limit=30")
        for e in lus.get("chunk", []):
            if e.get("type") == "m.room.message" and e.get("sender") != moi:
                print(e["content"].get("body", ""), flush=True)
                raise SystemExit(0)
        time.sleep(min(1.5, ATTENTE / 4))
    refuser(
        f"Pas de réponse du serveur en {ATTENTE:g} s. La commande A ÉTÉ postée "
        f"({poste.get('event_id')}) : cherchez sa réponse dans #admins:{nom_du_serveur} "
        "avant de la poster de nouveau."
    )


def essai():
    """Chaque geste et chaque garde, contre un homeserver factice, local."""
    import http.server
    import subprocess
    import tempfile
    import threading

    script = os.environ["ADMIN_MESSAGR_SCRIPT"]
    moi = "@exploitation:example.org"
    jeton = "jeton-factice"
    etat = {"whoami": moi, "repond": True, "postes": [], "appels": []}

    class Faux(http.server.BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def repondre(self, code, corps):
            donnees = json.dumps(corps).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(donnees)))
            self.end_headers()
            self.wfile.write(donnees)

        def traiter(self):
            chemin = urllib.parse.urlparse(self.path).path
            etat["appels"].append(chemin)
            if self.headers.get("Authorization") != "Bearer " + jeton:
                return self.repondre(401, {"errcode": "M_UNKNOWN_TOKEN"})
            longueur = int(self.headers.get("Content-Length") or 0)
            corps = json.loads(self.rfile.read(longueur) or b"{}") if longueur else {}
            if chemin.endswith("/account/whoami"):
                return self.repondre(200, {"user_id": etat["whoami"]})
            if "/directory/room/" in chemin:
                return self.repondre(200, {"room_id": "!admins:example.org"})
            if chemin.endswith("/sync"):
                return self.repondre(200, {"next_batch": "repere"})
            if "/send/m.room.message/" in chemin:
                etat["postes"].append(corps.get("body"))
                return self.repondre(200, {"event_id": "$poste"})
            if chemin.endswith("/messages"):
                fil = [
                    {"type": "m.room.message", "sender": moi, "content": {"body": b}}
                    for b in etat["postes"]
                ]
                if etat["repond"]:
                    fil += [
                        {
                            "type": "m.room.message",
                            "sender": "@conduit:example.org",
                            "content": {"body": "fait : " + b},
                        }
                        for b in etat["postes"]
                    ]
                return self.repondre(200, {"chunk": fil})
            return self.repondre(404, {"errcode": "M_UNRECOGNIZED"})

        do_GET = traiter
        do_PUT = traiter

    serveur = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Faux)
    threading.Thread(target=serveur.serve_forever, daemon=True).start()
    maison = tempfile.mkdtemp(prefix="admin-messagr-essai-")
    dossier = pathlib.Path(maison) / ".messagr-exploitation"
    dossier.mkdir()
    fichier = dossier / "messagr-eu.json"

    def identifiants(droits=0o600):
        fichier.write_text(
            json.dumps(
                {
                    "serveur": f"http://127.0.0.1:{serveur.server_port}",
                    "user_id": moi,
                    "access_token": jeton,
                }
            )
        )
        fichier.chmod(droits)

    def lancer(arguments, entree, attente="5"):
        env = dict(os.environ, HOME=maison, ADMIN_MESSAGR_ATTENTE=attente)
        return subprocess.run(
            ["bash", script] + arguments,
            input=entree,
            capture_output=True,
            text=True,
            env=env,
            timeout=60,
        )

    echecs = []

    def cas(titre, arguments, entree, reussit, postes, appels=None, attente="5", dit=None):
        etat["postes"].clear()
        etat["appels"].clear()
        fait = lancer(arguments, entree, attente)
        vu = []
        if (fait.returncode == 0) != reussit:
            vu.append(f"code {fait.returncode}")
        if etat["postes"] != postes:
            vu.append(f"posté {etat['postes']}")
        if appels is not None and etat["appels"] != appels:
            vu.append(f"appels {etat['appels']}")
        if dit is not None and dit not in fait.stderr + fait.stdout:
            vu.append(f"ne dit pas {dit!r}")
        if jeton in fait.stdout + fait.stderr:
            vu.append("le jeton s'affiche")
        if vu:
            echecs.append(titre)
            print(f"  ÉCHEC  {titre} : {'; '.join(vu)}\n{fait.stderr}")
        else:
            print(f"  ok     {titre}")

    bob = "@bob:example.org"
    identifiants()
    cas("suspendre, le compte tapé en retour", ["suspendre", bob], bob + "\n", True,
        ["!admin users lock " + bob], dit="fait : !admin users lock " + bob)
    cas("lever", ["lever", bob], bob + "\n", True, ["!admin users unlock " + bob])
    cas("fermer", ["fermer", bob], bob + "\n", True, ["!admin users deactivate " + bob],
        dit="--record-termination " + bob)
    evenement = "$Fb1pKzAq8VnGcX3wYd0mS7tLr5uJe2hNi4oQv6kZyM9"
    cas("retirer, l'événement tapé en retour", ["retirer", evenement], evenement + "\n",
        True, ["!admin users redact-event " + evenement])
    media = "mxc://example.org/AbCdEfGhIjKlMnOp"
    cas("effacer le média", ["effacer-media", media], media + "\n", True,
        ["!admin media delete --mxc " + media])
    cas("une commande libre, tapée en retour", ["server version"], "server version\n",
        True, ["!admin server version"])
    for reponse in ["oui\n", "", "@Bob:example.org\n", "@bob:example.org, oui\n"]:
        cas(f"rien sans la cible tapée en retour ({reponse.strip()!r})", ["suspendre", bob],
            reponse, False, [])
    cas("une commande libre non tapée en retour", ["server version"], "oui\n", False, [])
    for cible in ["", "Fb1pKzAq8VnGcX3wYd0mS7tLr5uJe2hNi4oQv6kZyM9", "$court"]:
        cas(f"un événement que le shell a mangé ({cible!r}), refusé avant tout appel",
            ["retirer", cible], cible + "\n", False, [], appels=[])
    for cible in ["bob", "@bob", "bob:example.org", "@bob:example.org @carol:example.org"]:
        cas(f"un compte mal formé ({cible!r})", ["suspendre", cible], cible + "\n",
            False, [], appels=[])
    cas("deux cibles", ["fermer", bob, "@carol:example.org"], bob + "\n", False, [],
        appels=[])
    cas("une commande libre en deux arguments", ["server", "version"], "server version\n",
        False, [], appels=[])
    cas("le compte d'exploitation ne se ferme pas", ["fermer", moi], moi + "\n", False, [])
    cas("le compte d'exploitation ne se suspend pas", ["suspendre", moi], moi + "\n",
        False, [])
    etat["whoami"] = "@quelquun:example.org"
    cas("un jeton d'un autre compte", ["suspendre", bob], bob + "\n", False, [],
        dit="n'est pas celui de")
    etat["whoami"] = moi
    identifiants(0o644)
    cas("des identifiants lisibles par d'autres", ["suspendre", bob], bob + "\n", False,
        [], appels=[], dit="chmod 600")
    fichier.unlink()
    cas("pas d'identifiants", ["suspendre", bob], bob + "\n", False, [], appels=[])
    identifiants()
    etat["repond"] = False
    cas("sans réponse, la commande a été postée, et le script le dit", ["lever", bob],
        bob + "\n", False, ["!admin users unlock " + bob], attente="1", dit="A ÉTÉ postée")
    serveur.shutdown()
    if echecs:
        print(f"{len(echecs)} échec(s)")
        raise SystemExit(1)
    print("le script garde ses gardes")


if __name__ == "__main__":
    if sys.argv[1:] == ["--self-test"]:
        essai()
    else:
        principal(sys.argv[1:])
PY
