// The second module that names `@react-native-documents/picker`, and the
// only one that names its save half. Thin for the reason `documentFile.ts`
// and `imageLibrary.ts` are: native modules, nothing here worth a unit test,
// and what it adapts to -- `DocumentPicker` and `KeepingDocument` -- is
// driven by functions in the tests.
import {
  pick,
  saveDocuments,
  errorCodes,
  isErrorWithCode,
} from '@react-native-documents/picker'

import { Platform } from 'react-native'

import { bytesOf } from './base64'
import {
  readFile,
  readDir,
  writeFile,
  unlink,
  pathForGroup,
  TemporaryDirectoryPath,
} from '@dr.pogodin/react-native-fs'
import { INBOX_NAME, SHARE_GROUP, oursToRemove } from './sharedInbox'

import type { DocumentChoice } from './pickDocument'
import { refuseDocument, refuseWhatWasRead } from './pickDocument'
import type { KeepingDocument } from './keepDocument'

/** What a file is when nothing says otherwise. */
const ASSUMED_TYPE = 'application/octet-stream'

/**
 * Choosing any file, and reading its bytes.
 *
 * # `mode: 'open'` rather than `'import'`
 *
 * `'import'` copies the file into this application's own storage before
 * handing it over, and that copy is a file this application caused to exist:
 * ADR-0006's clarification of 10 September 2026 says plainly that such a
 * directory « is this application's disk ». `'open'` reads where the file
 * already is, and the plaintext goes from there into the bridge without a
 * copy of its own.
 *
 * # Refused on the stated size, before a byte is read
 *
 * `refuseDocument` answers from what the picker says about the file, which
 * is the point of taking a stated size rather than bytes: a file too large
 * to seal is refused without ever being held.
 */
export async function pickAnyDocument(): Promise<DocumentChoice> {
  try {
    const [chosen] = await pick({ mode: 'open' })
    if (chosen === undefined) return { chose: false, because: null }

    const stated = {
      name: chosen.name ?? '',
      mimeType: chosen.type ?? ASSUMED_TYPE,
      size: chosen.size ?? null,
    }
    const refusal = refuseDocument(stated)
    if (refusal !== null) return { chose: false, because: refusal }

    const base64 = await readFile(chosen.uri, 'base64')
    const bytes = bytesOf(base64)
    // ET UNE SECONDE FOIS, sur ce qui a vraiment été lu. Un `content://` sans
    // taille déclarée est le cas ordinaire sur Android, et sans cette ligne
    // c'était un passe-droit : la borne ne protégeait que les fichiers qui
    // s'étaient annoncés.
    const read = refuseWhatWasRead(bytes)
    if (read !== null) return { chose: false, because: read }

    return {
      chose: true,
      document: {
        bytes,
        mimeType: stated.mimeType,
        name: stated.name,
      },
    }
  } catch (cause: unknown) {
    // Somebody who opens the picker and changes their mind has done a normal
    // thing, and the screen must not show them a failure for it.
    if (
      isErrorWithCode(cause) &&
      cause.code === errorCodes.OPERATION_CANCELED
    ) {
      return { chose: false, because: null }
    }
    return { chose: false, because: 'unreadable' }
  }
}

/**
 * Lit les octets d'un partage entrant, au moment où on en a besoin.
 *
 * PAS AVANT. L'adresse voyage depuis l'intention jusqu'ici sans que rien ne
 * soit lu : quelqu'un qui parcourt sa liste de conversations ne tient pas un
 * fichier en mémoire pendant qu'il choisit, et rien n'a été recopié dans le
 * stockage de cette application (ADR-0006).
 *
 * Le nom et le type viennent de ce que le système a annoncé, et non d'une
 * lecture de l'adresse : un `content://` est un identifiant opaque, et lire
 * un nom de fichier dedans est la façon d'afficher une ligne intitulée « 42 ».
 *
 * # ET SUR iOS, LE FICHIER EST RETIRÉ ICI MÊME
 *
 * Là-bas l'adresse désigne une copie que l'extension de partage a déposée
 * dans le conteneur du groupe, faute de pouvoir remettre autre chose à
 * travers une frontière de processus. L'amendement d'ADR-0006 du 12 septembre
 * 2026 l'autorise pour cette traversée et exige qu'elle se referme : le
 * retrait est donc dans un `finally`, y compris sur le chemin qui échoue, qui
 * est précisément celui qu'une implémentation heureuse laisse en clair.
 *
 * `oursToRemove` décide, et pas ce module : sur Android l'adresse désigne la
 * photo de quelqu'un dans sa propre galerie, et il n'y a rien à retirer.
 */
export async function readShared(
  uri: string,
  name: string,
  mimeType: string,
): Promise<DocumentChoice> {
  try {
    const base64 = await readFile(uri, 'base64')
    const bytes = bytesOf(base64)
    // LA SEULE BORNE QUI COMPTE ICI quand le système n'a pas dit la taille,
    // ce qu'Android fait souvent : `whatToDoWith` ne peut refuser que sur ce
    // qui a été annoncé, et une absence n'est pas un laissez-passer.
    const read = refuseWhatWasRead(bytes)
    if (read !== null) return { chose: false, because: read }

    return {
      chose: true,
      document: {
        bytes,
        mimeType: mimeType === '' ? ASSUMED_TYPE : mimeType,
        name,
      },
    }
  } catch {
    // Une adresse qui ne se lit plus est le cas ordinaire d'un partage
    // rouvert plus tard : le système retire l'autorisation avec l'activité
    // qui l'a reçue.
    return { chose: false, because: 'unreadable' }
  } finally {
    await forgetTheCrossing(uri)
  }
}

/**
 * Retire la copie qu'une extension a déposée, si c'en est une.
 *
 * # TROIS SORTIES, ET LA TRAVERSÉE SE REFERME SUR LES TROIS
 *
 * Le `finally` d'au-dessus couvre la lecture, qu'elle aboutisse ou non. Mais
 * un partage a deux autres fins, et elles ne passent jamais par là :
 *
 * - **refusé** — trop lourd, ou sans nom : `whatToDoWith` tranche sur ce que
 *   le système a annoncé, donc avant toute lecture ;
 * - **annulé** — la personne referme le sélecteur de conversation.
 *
 * Dans les deux cas le fichier est déjà dans la boîte et personne ne le lira
 * jamais. Sans cet export il y resterait jusqu'au prochain lancement, ce qui
 * est plus long qu'« une traversée » et ce que l'amendement d'ADR-0006 ne
 * couvre pas. `App.tsx` l'appelle sur ces deux chemins.
 *
 * Ne jette jamais : un retrait qui échoue ne doit pas transformer un envoi
 * réussi en panne, et le balayage au lancement ramassera ce qui est resté.
 */
export async function forgetTheCrossing(uri: string): Promise<void> {
  try {
    const inbox = await theInbox()
    if (!oursToRemove(uri, inbox)) return
    await unlink(uri.startsWith('file://') ? uri.slice('file://'.length) : uri)
  } catch {
    // Rien. Voir ci-dessus.
  }
}

/**
 * Le dossier du conteneur partagé, ou `null` là où il n'y en a pas.
 *
 * Résolu une fois : le chemin ne change pas pendant qu'une application
 * tourne, et `pathForGroup` traverse le pont.
 */
let inboxOnce: Promise<string | null> | null = null

export function theInbox(): Promise<string | null> {
  inboxOnce ??= (async () => {
    // ANDROID N'A PAS DE CONTENEUR, et n'en a pas besoin : là-bas rien n'est
    // recopié. Demander quand même ferait rejeter le pont à chaque partage.
    if (Platform.OS !== 'ios') return null
    try {
      const container = await pathForGroup(SHARE_GROUP)
      return `${container.replace(/\/+$/, '')}/${INBOX_NAME}`
    } catch {
      // UN GROUPE ABSENT N'EST PAS UNE PANNE ICI. Une build dont les
      // entitlements ne portent pas le groupe -- une build de simulateur non
      // signée, par exemple -- répond une erreur. Le partage ne marchera pas
      // sur cette build, et le reste de l'application doit marcher quand même.
      return null
    }
  })()
  return inboxOnce
}

/**
 * Vide la boîte, et répond combien de fichiers y traînaient.
 *
 * APPELÉ AU LANCEMENT, ET C'EST L'AMENDEMENT QUI LE DEMANDE. Une extension
 * peut être tuée entre l'écriture et la remise -- le système lui accorde peu
 * de mémoire et peu de temps -- et le fichier qu'elle a écrit n'a alors
 * personne pour le retirer. C'est l'orphelin pour lequel cette règle existe.
 *
 * Le compte est rendu pour être journalisé : un balayage qui trouve quelque
 * chose à chaque lancement dirait que le `finally` de `readShared` ne ferme
 * pas, ce qui est une information et non un détail.
 */
export async function sweepTheInbox(): Promise<number> {
  const inbox = await theInbox()
  if (inbox === null) return 0
  try {
    const left = await readDir(inbox)
    let swept = 0
    for (const entry of left) {
      if (!oursToRemove(entry.path, inbox)) continue
      try {
        await unlink(entry.path)
        swept += 1
      } catch {
        // Un fichier verrouillé se retrouvera au lancement suivant.
      }
    }
    return swept
  } catch {
    // Le dossier n'existe pas encore : personne n'a jamais partagé.
    return 0
  }
}

/**
 * What `keepDocument` needs from the platform.
 *
 * `saveDocuments` is the system's own « save as »: the person chooses the
 * destination, so nothing lands anywhere they did not pick. What this module
 * provides is the temporary file it copies FROM, and the `unlink` that
 * removes it -- `keepDocument.ts` owns the order and the `finally`.
 */
export function documentPlatform(): KeepingDocument {
  return {
    temporary: TemporaryDirectoryPath,
    write: async (path, base64) => {
      await writeFile(path, base64, 'base64')
    },
    save: async (path, name) => {
      try {
        await saveDocuments({
          sourceUris: [`file://${path}`],
          copy: true,
          fileName: name,
        })
        return 'saved'
      } catch (cause: unknown) {
        // Refermer la fenêtre est un geste ordinaire, et la bibliothèque le
        // signale par un code plutôt que par un message. Tout le reste
        // remonte comme une vraie panne.
        if (
          isErrorWithCode(cause) &&
          cause.code === errorCodes.OPERATION_CANCELED
        ) {
          return 'cancelled'
        }
        throw cause
      }
    },
    forget: async path => {
      await unlink(path)
    },
    // The temporary file's name has to differ per call: two saves in the same
    // second would otherwise write the same path, and the first `unlink`
    // would take the second one's bytes.
    name: () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
  }
}
