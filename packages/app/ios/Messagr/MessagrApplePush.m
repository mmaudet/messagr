//
// What React Native is told about MessagrApplePush.swift, and nothing else.
//
// WHY A SECOND FILE FOR TWO METHODS. React Native discovers a native module by asking the
// Objective-C runtime, and a Swift class is invisible to it until something registers the class
// and declares its selectors. `RCT_EXTERN_MODULE` does exactly that: it registers the class at
// load time and records the two method signatures, which `RCTTurboModuleManager` then reads.
// Without this file the Swift half compiles, ships, and is never found -- and
// `applePushToken.ts` answers `noModule`, which is precisely the silence it exists to name.
//
// A LEGACY MODULE UNDER THE NEW ARCHITECTURE, WHICH IS NOT AN OVERSIGHT. This application is
// bridgeless (`RCTNewArchEnabled`, and `newArchEnabled=true` on Android). A module registered
// this way is still resolved: `RCTTurboModuleManager` looks the class up among those
// `RCTRegisterModule` was given and wraps it in `ObjCInteropTurboModule`, promise methods
// included. A codegen'd TurboModule would need a `codegenConfig` block this package does not
// have, a specification file and generated sources, for two methods that cross the bridge twice
// per launch. `TurboModuleRegistry.get` on the JavaScript side answers under either
// architecture, which is the half of this that #353 already paid for.
//
#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(MessagrApplePush, NSObject)

// Nothing here touches UIKit at construction -- `askApple` hops to the main queue itself -- so
// there is no reason to hold up the launch to build it.
+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

RCT_EXTERN_METHOD(askApple:(RCTPromiseResolveBlock)resolve
                   reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(readApple:(RCTPromiseResolveBlock)resolve
                    reject:(RCTPromiseRejectBlock)reject)

@end
