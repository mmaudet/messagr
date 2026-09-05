//go:build goolm

package main

// The independence claim, made checkable.
//
// `mautrix-go` selects its Olm implementation by build tag: with `goolm` it
// uses a reimplementation of libolm in pure Go, and without it, cgo bindings
// against libolm itself. Both are independent of `matrix-sdk-crypto`, so a
// run built the wrong way would still pass and would still prove something
// -- just less than this counterparty's own documentation says it proves.
//
// A claim nothing checks is a claim that goes stale the first time somebody
// builds without the tag, which is the easy mistake since it is the default.
// So the binary refuses rather than quietly proving the weaker thing.
const cryptoBackend = "goolm, a reimplementation of libolm in pure Go"

const builtIndependently = true
