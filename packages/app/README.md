# @messagr/app

The Messagr mobile client. React Native 0.87 with the New Architecture, which
is a requirement rather than a preference: the crypto bridge is a JSI turbo
module and does not load on the legacy architecture.

Run every command from the workspace root, not from here. Yarn hoists this
package's dependencies upward, and the scripts below assume that layout.

```sh
yarn install          # from the workspace root
yarn lint             # eslint, whole workspace, one flat config
yarn format           # prettier, check only
yarn typecheck        # tsc --noEmit
yarn test             # vitest
```

To run it on a device:

```sh
yarn workspace @messagr/app start          # Metro
yarn workspace @messagr/app ios            # iOS simulator
yarn workspace @messagr/app android        # Android emulator
```

If port 8081 is taken by another project's Metro, start this one elsewhere and
build the Android app against that port, because on an emulator React Native
reaches the host at `10.0.2.2:8081` rather than through `adb reverse`:

```sh
yarn workspace @messagr/app start --port 8082
(cd packages/app/android && ./gradlew assembleDebug -PreactNativeDevServerPort=8082)
```

## What this screen is for

The single screen reports two runtime facts and nothing else: whether the New
Architecture is really running, read from the markers React Native itself uses,
and whether the crypto bridge's native module loads and answers across the JSI
boundary. Both are also written to the log as `MESSAGR_RUNTIME`, because the
Android emulator's `screencap` returns a blank frame whatever is on screen.

## Known gap

`./gradlew assembleRelease` fails to locate hermesc. Debug builds are
unaffected. Tracked as issue #16.
