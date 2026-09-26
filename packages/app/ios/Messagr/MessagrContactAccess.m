//
// What React Native is told about MessagrContactAccess.swift, and nothing else: one method, for
// the reason MessagrApplePush.m gives for its own file.
//
#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(MessagrContactAccess, NSObject)

// Nothing here touches UIKit at construction -- `shareMore` hops to the main queue itself.
+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

RCT_EXTERN_METHOD(shareMore:(RCTPromiseResolveBlock)resolve
                   reject:(RCTPromiseRejectBlock)reject)

@end
