import ContactsUI
import SwiftUI
import UIKit

/// The system's choice of the cards Messagr may read, for a person who shared only some (#403).
///
/// **WHY THIS EXISTS.** Since iOS 18, a person can let an application read some cards of the
/// address book rather than all of them. Looking for one's contacts then covers those cards
/// only, and the screen offers to share more: that is Apple's own picker, presented by the
/// application, and `react-native-contacts` has no way to open it. It reads what the person
/// shared, and this file opens the choice.
///
/// **A SWIFTUI MODIFIER, HOSTED.** Apple offers the picker as a SwiftUI modifier and nothing
/// else. It is hung on a transparent view in a hosting controller, presented over the
/// application by the controller on top, and that controller dismisses what it presented when
/// the choice is over: the host and, if it is still up, the picker over it. Dismissing the
/// host itself would close only the picker when the picker is still shown, and leave a
/// transparent screen over the application that swallows every touch.
///
/// **ONE ANSWER: HOW MANY CARDS WERE ADDED.** Apple calls the completion handler with the cards
/// chosen, and closing the picker sets `isPresented` back to false; either may come first. The
/// answer to the closing waits one turn of the main queue, so that a completion carrying cards
/// is the one JavaScript hears, and a flag keeps it to one answer. JavaScript looks again only
/// when cards were added. What was chosen is not read here: `addressBook.ts` reads the address
/// book again, which now holds them.
@objc(MessagrContactAccess)
final class MessagrContactAccess: NSObject {
  /// Opens the picker, and answers with the number of cards added once it has closed. Before
  /// iOS 18 there is no partial access and so nothing to add: it answers 0 at once.
  @objc func shareMore(
    _ resolve: @escaping (Any?) -> Void,
    reject: @escaping (String?, String?, Error?) -> Void
  ) {
    DispatchQueue.main.async {
      guard #available(iOS 18.0, *), let presenter = Self.topmost() else {
        resolve(0)
        return
      }
      var answered = false
      let answer = { (added: Int) in
        guard !answered else { return }
        answered = true
        guard presenter.presentedViewController != nil else {
          resolve(added)
          return
        }
        presenter.dismiss(animated: false) { resolve(added) }
      }
      let host = PickerHost(
        chosen: { answer($0.count) },
        closed: { DispatchQueue.main.async { answer(0) } }
      )
      let controller = UIHostingController(rootView: host)
      controller.view.backgroundColor = .clear
      controller.modalPresentationStyle = .overFullScreen
      presenter.present(controller, animated: false)
    }
  }

  /// The controller on top of the application, which is the one that may present.
  private static func topmost() -> UIViewController? {
    let windows = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap { $0.windows }
    var top = windows.first(where: { $0.isKeyWindow })?.rootViewController
    while let presented = top?.presentedViewController {
      top = presented
    }
    return top
  }
}

/// A transparent view whose only content is Apple's picker, shown as soon as it appears.
@available(iOS 18.0, *)
private struct PickerHost: View {
  let chosen: ([String]) -> Void
  let closed: () -> Void
  @State private var isPresented = false

  var body: some View {
    Color.clear
      .contactAccessPicker(isPresented: $isPresented) { chosen($0) }
      .onAppear { isPresented = true }
      .onChange(of: isPresented) { _, shown in
        if !shown { closed() }
      }
  }
}
