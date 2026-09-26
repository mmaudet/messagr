import UIKit

/// Apple's own push token, asked for and held, with nothing of Google's in between.
///
/// **WHY THIS EXISTS.** Firebase was in this build for two lines: it asked Apple for the APNs
/// token and it handed the answer back. Everything else it did was unwanted -- handing
/// `FIRMessaging` an APNs token makes its token manager ask Google for an installation
/// identifier and then for an FCM token carrying that APNs token, from
/// `setAPNSToken:withUserInfo:`, which consults no setting this repository can write. #334
/// took the twelve pods out of the iOS target, and this is the two lines, written here.
///
/// **THE FORMAT IS THE WHOLE CONTRACT.** `%02.2hhX` -- upper-case hexadecimal, no separator,
/// two characters per byte -- is what `RNFBMessagingSerializer.m` produced, and nothing
/// downstream normalises what comes out: `pusher.ts` registers this exact string as the
/// `pushkey`, and sygnal forwards it as it stands (`convert_device_token_to_hex: false`).
/// A lower-case answer would be a different `pushkey` for the same telephone -- a second
/// pusher on the account, a ghost this device could not recognise as its own, and a form
/// nobody here has established Apple accepts. That is #325, which cost every iOS push for
/// months with both environments perfectly paired. The format below is that one and no other,
/// and `applePushToken.spec.ts` refuses anything else on the way through.
///
/// **THE TOKEN IS HELD, RATHER THAN WAITED FOR.** Apple answers the application delegate, on
/// its own schedule, and that answer regularly arrives before JavaScript has finished starting.
/// `FIRMessaging` kept it in memory for exactly this reason, which is why `getAPNSToken` could
/// be a re-read. A replacement that did not hold it would have `pushDevice.ts` read `null` ten
/// times and report an honest-looking "Apple has not answered yet" on every launch -- the most
/// likely way to get this wrong, and one that only shows on a fast launch.
///
/// **NOTHING IS PERSISTED.** The token lives for the life of the process and is asked for again
/// on the next launch, because Apple may issue a different one and a stale token is a pusher
/// that fires into nothing. `App.tsx` remembers the last `pushkey` it registered, which is a
/// different thing and belongs there.
@objc(MessagrApplePush)
final class MessagrApplePush: NSObject {
  /// The delegate callbacks run on the main queue and the module's methods on its own queue,
  /// so the two words below are read and written from two threads.
  private static let held = NSLock()
  private static var token: String?
  private static var refused = false

  /// Apple answered. Called by `AppDelegate`, which is the only object iOS will tell.
  @objc static func appleAnswered(_ deviceToken: Data) {
    let hexadecimal = deviceToken.map { String(format: "%02.2hhX", $0) }.joined()
    held.lock()
    defer { held.unlock() }
    token = hexadecimal
    // A registration that succeeded clears an earlier refusal: a device whose entitlement was
    // wrong on one launch and right on the next must not go on reporting the first one.
    refused = false
  }

  /// Apple refused. The error is not kept: what JavaScript does with it is name the refusal,
  /// and an error message is the one thing on this path that could carry more than that.
  @objc static func appleRefused() {
    held.lock()
    defer { held.unlock() }
    refused = true
  }

  /// Asks UIKit to register. Answers once the ask has been made, which is not once Apple has.
  ///
  /// On the main queue, because `registerForRemoteNotifications` is UIKit and this runs on the
  /// module's own queue. Two things used to make this call -- the react-native-firebase
  /// notification observer at launch, and `registerDeviceForRemoteMessages` from JavaScript --
  /// and both left with the pods. If nobody calls it, Apple is never asked, no token ever
  /// arrives, and it reads exactly like a device that is being slow.
  @objc func askApple(
    _ resolve: @escaping (Any?) -> Void,
    reject: @escaping (String?, String?, Error?) -> Void
  ) {
    DispatchQueue.main.async {
      UIApplication.shared.registerForRemoteNotifications()
      resolve(nil)
    }
  }

  /// What Apple has answered so far. `token` is absent rather than null when there is none:
  /// JavaScript reads anything that is not a string as "not yet" (`applePushToken.ts`).
  @objc func readApple(
    _ resolve: @escaping (Any?) -> Void,
    reject: @escaping (String?, String?, Error?) -> Void
  ) {
    MessagrApplePush.held.lock()
    let answered = MessagrApplePush.token
    let wasRefused = MessagrApplePush.refused
    MessagrApplePush.held.unlock()

    var answer: [String: Any] = ["refused": wasRefused]
    if let answered = answered {
      answer["token"] = answered
    }
    resolve(answer)
  }
}
