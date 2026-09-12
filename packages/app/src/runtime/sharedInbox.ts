/**
 * La boîte où l'extension de partage iOS dépose un fichier, et la règle qui
 * dit ce qu'on a le droit d'en retirer.
 *
 * # POURQUOI CETTE BOÎTE EXISTE, ET POURQUOI ELLE N'EXISTE QUE SUR iOS
 *
 * Android n'a besoin de rien : une intention de partage remet une adresse
 * `content://`, l'application la lit au moment d'envoyer, et **rien n'est
 * recopié nulle part**. C'est la forme juste, et elle n'a demandé aucune
 * exception à ADR-0006.
 *
 * iOS ne peut pas faire ça. Une extension de partage est un processus séparé
 * avec son propre bac à sable : le fichier qu'elle reçoit se lit chez elle et
 * nulle part ailleurs, et l'adresse ne vaut rien de l'autre côté. La seule
 * route que le système offre est un conteneur d'App Group -- donc, au sens de
 * la clarification d'ADR-0006 du 10 septembre 2026, **le disque de cette
 * application**. L'amendement du 12 septembre l'autorise pour une traversée,
 * et cette boîte est cette traversée.
 *
 * # LA RÈGLE, ÉCRITE ICI PARCE QU'ELLE PEUT DÉTRUIRE QUELQUE CHOSE
 *
 * L'amendement exige que le fichier soit retiré dès que ses octets sont en
 * mémoire. Retirer est la seule opération de ce fichier qui soit
 * irréversible, et `imageLibrary.ts` s'est déjà fait la peur qu'il faut :
 *
 * > a module that removes whatever path it is handed is one bad answer away
 * > from deleting a photograph out of somebody's gallery.
 *
 * Sur Android, l'adresse qui arrive ici DÉSIGNE la photo de quelqu'un, dans
 * sa propre galerie. Alors la règle n'est pas « efface ce qu'on te donne »,
 * c'est « efface ce qui est dans ta boîte », et `oursToRemove` est cette
 * phrase, seule et testable.
 */

/**
 * Le nom du groupe, qui est le même des deux côtés de la frontière.
 *
 * L'extension l'écrit dans ses entitlements, l'application dans les siennes,
 * et une divergence d'un caractère produit un conteneur que chacun croit
 * partager et que personne ne partage : l'extension écrit, l'application
 * regarde ailleurs, et le partage disparaît sans un mot.
 */
export const SHARE_GROUP = 'group.eu.messagr'

/** Le dossier, sous le conteneur. Une seule chose y vit : ce qui traverse. */
export const INBOX_NAME = 'Incoming'

/**
 * Si ce chemin est dans notre boîte, et donc à nous de le retirer.
 *
 * Prend la boîte en argument plutôt que de la lire : c'est ce qui rend la
 * règle vérifiable sans plateforme, et ce qui rend impossible d'appeler la
 * fonction sans savoir de quelle boîte on parle.
 *
 * `null` pour la boîte est la réponse d'Android, où il n'y a pas de
 * conteneur ; tout est alors refusé, ce qui est juste, puisque rien n'y a été
 * recopié.
 */
export function oursToRemove(path: string, inbox: string | null): boolean {
  if (inbox === null || inbox === '') return false

  // `file://` est ce que l'URI porte ; le comparer tel quel refuserait tout.
  const plain = path.startsWith('file://') ? path.slice('file://'.length) : path

  // Une adresse d'un autre genre n'est pas un chemin, et ne peut pas être
  // dans un dossier. Le `content://` d'Android passe par là.
  if (plain.includes('://')) return false

  // LE SÉPARATEUR EST DANS LA COMPARAISON, et c'est le défaut qu'il évite :
  // `startsWith(inbox)` dit oui à « …/Incoming-old/x », qui est un autre
  // dossier. La boîte elle-même est refusée par la même ligne, puisqu'elle
  // ne se préfixe pas d'elle-même suivie d'une barre.
  const under = `${inbox.replace(/\/+$/, '')}/`
  if (!plain.startsWith(under)) return false

  // ET RIEN QUI REMONTE. Un nom de fichier vient du système, pas de nous,
  // mais `keepDocument.ts` a déjà montré qu'un nom venu d'ailleurs se
  // promène : « ../../x.pdf » sortirait de la boîte tout en commençant par
  // elle. Le reste doit être un nom, pas un chemin.
  const rest = plain.slice(under.length)
  if (rest === '') return false
  return !rest.split('/').includes('..')
}
