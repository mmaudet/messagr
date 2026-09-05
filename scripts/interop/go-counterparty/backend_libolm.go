//go:build !goolm

package main

// Built without `-tags goolm`, so this binary is bound to libolm through cgo.
// See backend_goolm.go for why that is refused rather than accepted with a
// smaller claim.
const cryptoBackend = "libolm, through cgo"

const builtIndependently = false
