# Runtime gaps and the polyfill layer

matrix-js-sdk was written for browsers and Node. React Native is neither, and
what it lacks is not what its documentation is usually assumed to lack. This
records what is missing, measured rather than assumed, and what each entry in
the polyfill layer closes.

## What was measured

`src/runtime/runtimeGaps.ts` exercises each facility against a value whose
correct answer is known, and treats one that throws as absent. It is named for
gaps rather than capabilities because in this product a capability is a scoped
permission held by a participant; see CONTEXT.md. It
tests behaviour rather than presence, because React Native ships a `URL` that
is a regular-expression shim: `typeof URL === 'function'` is true while the
object it builds may be wrong.

Measured on React Native 0.87.1, on an iOS simulator, an Android emulator and
a Pixel 10 Pro Fold running Android 17. All three returned the same answer,
including the phone two API levels above the emulator.

| Facility                 | State                          | Polyfill                               | Needed by                                           |
| ------------------------ | ------------------------------ | -------------------------------------- | --------------------------------------------------- |
| `crypto.getRandomValues` | absent                         | `react-native-get-random-values`       | `createClient`, before any request is made          |
| `TextDecoder`            | absent                         | `text-encoding-polyfill`, decoder only | reading the UTF-8 bodies of the responses it parses |
| `Promise.withResolvers`  | works                          | none                                   | the send scheduler                                  |
| `TextEncoder`            | works                          | none                                   | request bodies                                      |
| `URL`                    | works, including query parsing | none                                   | every endpoint it builds                            |
| `URLSearchParams`        | works                          | none                                   | filter and pagination parameters                    |

Three facilities that were expected to need polyfilling do not. Hermes on
0.87.1 supplies `Promise.withResolvers`, and the `URL` shim answers
`new URL('https://example.org/a/b?x=1&y=2').searchParams.get('y')` correctly.
Nothing is installed for them: replacing a working implementation adds a risk
without closing a gap.

Only the decoder is taken from `text-encoding-polyfill`. The package also
exports a `TextEncoder`, and assigning it would replace one that passes.

## How the layer runs

`src/runtime/polyfills.ts` probes first and installs only what failed, through
`require` rather than a top-level import: a side-effecting import patches the
global before anything can ask whether it needed patching. It then probes
again and reports what it installed, what was already there, and what still
fails. Anything in `stillMissing` is a defect, not a state.

`index.js` imports the bootstrap before the application, because
`createClient` reaches for `crypto.getRandomValues` while it is being
constructed. The ordering is load-bearing, which is why `App` is reached
through `require`: written as an ES import it would be hoisted above the
bootstrap.

## What else React Native needed

Two problems that are not polyfills, found the same way.

**Babel.** matrix-js-sdk's entry point uses `export * as ns from '...'`, which
the React Native preset does not transform. Without
`@babel/plugin-transform-export-namespace-from` the bundle does not build.

**The crypto WebAssembly module.** matrix-js-sdk declares
`@matrix-org/matrix-sdk-crypto-wasm` as a hard dependency and Metro resolves
it even though `initRustCrypto` is never called, leaving the bundle carrying a
second crypto backend and an `import.meta.url` that Hermes cannot evaluate.
`metro.config.js` stubs it out, and `scripts/assert-no-crypto-wasm.sh` holds
that stub in place. Removing the stub was watched failing the check.

## Re-measuring

The gaps are reported on screen and in the log on every launch, as
`MESSAGR_RUNTIME`. A React Native upgrade that closes one of the two, or opens
a new one, shows up there without anyone having to remember to look.
