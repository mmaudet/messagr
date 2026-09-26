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
/// else. It is hung on a transparent view in a hosting controller presented over the
/// application, which goes away with the picker. What was chosen is not read here:
/// `addressBook.ts` reads the address book again, which now holds the cards added.
///
/// **ONE ANSWER, WHATEVER CLOSED IT.** Apple calls the completion handler with the cards
/// added, and closing the picker without adding any sets `isPresented` back to false. Either
/// way the hosting controller is dismissed and JavaScript answered once: a second answer
/// would be a promise resolved twice, and no answer a transparent sheet left over the screen.
@objc(MessagrContactAccess)
final class MessagrContactAccess: NSObject {
  /// Opens the picker, and answers once it has closed. Before iOS 18 there is no partial access
  /// and so nothing to add: it answers at once.
  @objc func shareMore(
    _ resolve: @escaping (Any?) -> Void,
    reject: @escaping (String?, String?, Error?) -> Void
  ) {
    DispatchQueue.main.async {
      guard #available(iOS 18.0, *), let presenter = Self.topmost() else {
        resolve(nil)
        return
      }
      var answered = false
      var host: UIViewController?
      let closed = {
        guard !answered else { return }
        answered = true
        guard let shown = host else {
          resolve(nil)
          return
        }
        // Let go of it here: the view it hosts holds this closure, and this closure held it.
        host = nil
        shown.dismiss(animated: false) { resolve(nil) }
      }
      let controller = UIHostingController(rootView: PickerHost(closed: closed))
      controller.view.backgroundColor = .clear
      controller.modalPresentationStyle = .overFullScreen
      host = controller
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
  let closed: () -> Void
  @State private var isPresented = false

  var body: some View {
    Color.clear
      .contactAccessPicker(isPresented: $isPresented) { _ in closed() }
      .onAppear { isPresented = true }
      .onChange(of: isPresented) { _, shown in
        if !shown { closed() }
      }
  }
}
