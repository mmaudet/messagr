/**
 * Base64 vers octets, à un seul endroit.
 *
 * # Pourquoi c'est ici
 *
 * Ce décodeur existait deux fois, mot pour mot, dans `imageLibrary.ts` et
 * dans `documentPlatform.ts` : deux adaptateurs natifs qui n'ont rien à se
 * dire et qui décodaient pourtant la même chose de la même façon. Une erreur
 * ici est silencieuse -- un octet mal lu donne un fichier que personne
 * n'ouvrira et que rien ne signale -- donc elle mérite un seul endroit et des
 * cas à elle.
 *
 * # Et pourquoi l'encodeur n'est PAS ici
 *
 * `base64Of` reste dans `receiveImage.ts`, écrit à la main plutôt qu'avec
 * `btoa`, et son commentaire dit pourquoi : `btoa` prend une chaîne, la
 * conversion mange tout octet au-dessus de 127, et une photographie n'est
 * que ça. Le rapatrier ici demanderait de le réécrire, et le réécrire est
 * exactement la façon de réintroduire ce qu'il évite. Il bougera le jour où
 * quelqu'un aura une raison meilleure que la symétrie.
 */

/**
 * `atob` rend une chaîne dont chaque caractère porte la valeur d'un octet,
 * de 0 à 255 : `charCodeAt` la rend telle quelle, y compris au-dessus de
 * 127, ce qui est le seul endroit où ce décodage peut se tromper.
 */
export function bytesOf(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let at = 0; at < binary.length; at += 1) {
    bytes[at] = binary.charCodeAt(at)
  }
  return bytes
}
