#!/usr/bin/env bash
#
# The bundle must not carry @matrix-org/matrix-sdk-crypto-wasm.
#
# matrix-js-sdk declares it as a hard dependency and Metro resolves it even
# though initRustCrypto is never called. metro.config.js stubs it out, and
# this asserts the stub still works: ADR-0001 allows exactly one crypto
# implementation in the binary, and without this check a Metro upgrade could
# reinstate the second one silently.
set -euo pipefail

# No -t and no template: GNU mktemp requires a trailing XXXXXX there and BSD
# does not, so a template that works on a developer's macOS fails on a Linux
# runner. Bare mktemp is portable.
BUNDLE=$(mktemp)
ASSETS=$(mktemp -d)
trap 'rm -rf "$BUNDLE" "$ASSETS"' EXIT

ROOT=$(cd "$(dirname "$0")/.." && pwd)
(cd "$ROOT/packages/app" && npx --no-install react-native bundle \
  --platform ios --dev false --entry-file index.js \
  --bundle-output "$BUNDLE" --assets-dest "$ASSETS") >/dev/null

# The transport itself must still be there: a bundle that dropped
# matrix-js-sdk would pass a check that only looked for an absence.
if ! grep -q "MatrixClient" "$BUNDLE"; then
  echo "FAIL: matrix-js-sdk is missing from the bundle" >&2
  exit 1
fi

COUNT=$(grep -c "matrix-sdk-crypto-wasm" "$BUNDLE" || true)
if [ "$COUNT" -ne 0 ]; then
  echo "FAIL: the crypto WebAssembly module is in the bundle ($COUNT references)" >&2
  echo "      Check the resolveRequest stub in packages/app/metro.config.js" >&2
  exit 1
fi

echo "OK: bundle carries matrix-js-sdk and no crypto WebAssembly module"
