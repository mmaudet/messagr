/**
 * The operator key's public half (#465, ADR 0015, the glossary's « Operator
 * key »): what a report is sealed for (`sealedReport.ts`), so that the
 * operator alone opens it, on its own machine.
 *
 * Built into the application, where the service cannot swap it: changing it
 * takes a new build. The private half never enters this repository nor the
 * host. It is drawn on the operator's machine by `scripts/cle-de-l-exploitant.mjs`,
 * which keeps it in `~/.messagr-exploitation/` with one encrypted offline copy
 * and prints the line below in this very form.
 *
 * Imports nothing: the store-build guard loads this file under Node to read the
 * key the application carries (`scripts/assert-operator-key.mjs`).
 *
 * # FOR NOW, THE TEST KEY
 *
 * Its private half is in this repository, in
 * `scripts/fixtures/cle-de-test-de-l-exploitant.json`, so anyone opens what is
 * sealed for it: it serves the tests and development only. A store build
 * refuses it (`scripts/publish-ios.sh`, `scripts/build.sh ios` and the Publish
 * workflow call the guard). #470 replaces the line below with the production
 * key, and this paragraph with it.
 */

/** X25519, 32 bytes, in standard base64. */
export const OPERATOR_KEY = 'mD3vxUbnchoghIM22hYScz6J+lmbQuZTjX22y4FoSDY='
