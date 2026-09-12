import UIKit
import UniformTypeIdentifiers

/// Ce que Messagr fait apparaître dans la feuille de partage d'iOS.
///
/// # ELLE NE DESSINE RIEN, ET C'EST VOULU
///
/// Pas de `SLComposeServiceViewController`, pas de champ, pas d'aperçu. Une
/// extension de partage tourne sous un plafond mémoire serré et le système la
/// tue sans prévenir ; tout ce qu'elle dessine est du temps pendant lequel
/// elle peut mourir en tenant le fichier de quelqu'un. Elle prend, elle pose,
/// elle rend la main.
///
/// Le choix de la conversation se fait dans l'application, là où la liste
/// existe déjà — et où les clés existent. #242 le dit en propres termes :
/// « l'extension remet et rend la main ».
///
/// # POURQUOI ELLE NE CHIFFRE PAS ELLE-MÊME
///
/// Il faudrait le magasin de chiffrement, donc deux processus sur un seul
/// magasin Megolm. Une session Megolm perdue ou dupliquée rend un salon
/// illisible **pour toujours**, pour tout le monde. L'amendement d'ADR-0006
/// du 12 septembre 2026 refuse cette forme nommément, et ce commentaire est
/// là pour que le prochain qui trouve l'idée élégante lise d'abord pourquoi
/// elle ne l'est pas.
///
/// # CE QU'ELLE LAISSE DERRIÈRE ELLE
///
/// Une copie en clair dans le conteneur du groupe, le temps d'une traversée.
/// C'est l'exception que l'amendement autorise, et elle se referme de trois
/// façons : l'application retire le fichier dès que ses octets sont en
/// mémoire, elle le retire aussi quand elle refuse, et elle balaie le dossier
/// à chaque lancement pour l'orphelin qu'un processus tué laisse.
final class ShareViewController: UIViewController {

  /// Le même nom que dans les entitlements des deux côtés. Une divergence
  /// d'un caractère donne un conteneur que chacun croit partager et que
  /// personne ne partage : l'extension écrit, l'application regarde ailleurs.
  private static let group = "group.eu.messagr"
  private static let inbox = "Incoming"

  override func viewDidLoad() {
    super.viewDidLoad()
    handOver()
  }

  private func handOver() {
    guard
      let item = extensionContext?.inputItems.first as? NSExtensionItem,
      let provider = item.attachments?.first
    else {
      return finish()
    }

    // UN SEUL ÉLÉMENT, comme sur Android. Un lot est une décision produit
    // distincte, et personne ne l'a demandée (#242, hors périmètre).
    provider.loadFileRepresentation(forTypeIdentifier: UTType.item.identifier) {
      [weak self] url, _ in
      guard let self else { return }
      guard let url else { return self.finish() }

      // COPIÉ ICI ET PAS PLUS TARD. Ce que le système prête est valable le
      // temps de ce bloc et pas une ligne de plus : l'URL est retirée dès le
      // retour, et la lire après donnerait un fichier absent.
      let handed = self.putItDown(url, suggested: provider.suggestedName)
      guard let handed else { return self.finish() }

      self.wakeTheApplication(with: handed)
      self.finish()
    }
  }

  /// Pose le fichier dans la boîte et répond l'adresse qui le désigne.
  private func putItDown(_ source: URL, suggested: String?) -> URL? {
    let manager = FileManager.default
    guard
      let container = manager.containerURL(
        forSecurityApplicationGroupIdentifier: Self.group)
    else { return nil }

    let box = container.appendingPathComponent(Self.inbox, isDirectory: true)
    do {
      try manager.createDirectory(at: box, withIntermediateDirectories: true)

      // HORS DE LA SAUVEGARDE DE L'APPAREIL, et l'amendement le demande
      // nommément : sans cette ligne, un fichier qui vit quelques secondes
      // peut être recopié dans iCloud et y survivre des années, dans un
      // dossier dont personne ne pense qu'il tient les documents de quelqu'un.
      var boxed = box
      var keepOut = URLResourceValues()
      keepOut.isExcludedFromBackup = true
      try? boxed.setResourceValues(keepOut)

      // UN NOM QUI NE PEUT PAS SORTIR DU DOSSIER. Le nom suggéré vient de
      // l'application qui partage, donc d'ailleurs, et `keepDocument.ts` a
      // déjà montré dans ce dépôt qu'un nom venu d'ailleurs se promène.
      // `lastPathComponent` d'un nom nu le réduit à un nom nu.
      let wanted = (suggested ?? source.lastPathComponent) as NSString
      let safe = (wanted.lastPathComponent as NSString).length > 0
        ? wanted.lastPathComponent : "partage"

      // Unique, parce que deux partages dans la même seconde écriraient le
      // même chemin et le premier retrait emporterait les octets du second.
      let unique = "\(UInt64(Date().timeIntervalSince1970 * 1000))-\(UInt32.random(in: 0...UInt32.max))"
      let destination = box.appendingPathComponent("\(unique)-\(safe)")

      try manager.copyItem(at: source, to: destination)
      return destination
    } catch {
      return nil
    }
  }

  /// Réveille l'application avec l'adresse, par le canal des liens.
  ///
  /// LE MÊME CANAL QUE L'INVITATION, et c'est l'argument d'`incomingShare.ts` :
  /// ce chemin a déjà appris le cas froid et le cas chaud, cette paire qu'un
  /// module neuf aurait à réapprendre.
  private func wakeTheApplication(with file: URL) {
    var parts = URLComponents()
    parts.scheme = "messagr"
    parts.host = "share"
    parts.queryItems = [
      // `path` ET PAS `absoluteString`, et l'écart n'est pas cosmétique.
      // `absoluteString` percent-encode le chemin, puis `URLQueryItem`
      // l'encode une seconde fois ; le JavaScript ne décode qu'une fois, et
      // « Relevé de compte.pdf » arrive en « Relev%C3%A9%20de%20compte.pdf ».
      // La lecture prend alors ce nom au pied de la lettre et ne trouve rien
      // — un partage qui échoue en disant « fichier illisible » alors que le
      // fichier est là, sous un autre nom que celui qu'on cherche.
      //
      // Ce champ porte « une adresse que la plateforme comprend » : un
      // chemin ici, un `content://` sur Android. `oursToRemove` accepte les
      // deux formes et n'en efface qu'une.
      URLQueryItem(name: "uri", value: file.path),
      URLQueryItem(name: "name", value: displayName(of: file)),
      URLQueryItem(name: "type", value: mimeType(of: file)),
      URLQueryItem(name: "size", value: sizeOf(file)),
    ]
    guard let url = parts.url else { return }

    // LA REMONTÉE DE LA CHAÎNE DES RÉPONDEURS, et il faut dire pourquoi.
    // `NSExtensionContext.open` est documenté pour les extensions Today et
    // répond `false` depuis une extension de partage sur plusieurs versions
    // d'iOS. La chaîne des répondeurs est le chemin que toute la profession
    // emprunte ici. Il est tenté EN SECOND : le jour où Apple fait marcher
    // l'appel documenté, c'est lui qui gagne, sans rien changer ici.
    extensionContext?.open(url) { opened in
      if opened { return }
      var responder: UIResponder? = self
      while let current = responder {
        if let application = current as? UIApplication {
          let selector = NSSelectorFromString("openURL:")
          if application.responds(to: selector) {
            _ = application.perform(selector, with: url)
          }
          return
        }
        responder = current.next
      }
    }
  }

  // Le nom, lui, est bien celui que la personne reconnaît : il voyage dans
  // son propre champ et `URLSearchParams` le rend tel quel.
  private func displayName(of file: URL) -> String {
    // Le préfixe d'unicité est à nous ; ce que la personne reconnaît est ce
    // qui suit. Une ligne intitulée « 1757681234567-42-facture.pdf » serait
    // exacte et illisible.
    let whole = file.lastPathComponent
    guard let cut = whole.range(of: "-", options: .backwards) else {
      return whole
    }
    let tail = String(whole[cut.upperBound...])
    return tail.isEmpty ? whole : tail
  }

  private func mimeType(of file: URL) -> String {
    // VIDE PLUTÔT QUE DEVINÉ QUAND ON NE SAIT PAS. `sharedIn.ts` lit un type
    // vide comme un fichier, ce qui est la bonne réponse ; inventer
    // « application/pdf » sur une extension serait une affirmation sur des
    // octets que personne n'a lus.
    guard
      let type = UTType(filenameExtension: file.pathExtension),
      let mime = type.preferredMIMEType
    else { return "" }
    return mime
  }

  private func sizeOf(_ file: URL) -> String {
    let values = try? file.resourceValues(forKeys: [.fileSizeKey])
    guard let size = values?.fileSize else { return "" }
    return String(size)
  }

  private func finish() {
    extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
  }
}
