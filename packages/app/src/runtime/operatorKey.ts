/**
 * The operator key's public half (#465, ADR 0015, the glossary's « Operator
 * key »): what every report is sealed for (`sealedReport.ts`), so that the
 * operator alone opens it, on its own machine.
 *
 * Built into the application, where neither the service nor any caller can
 * swap it: changing it takes a new build. The private half never enters this
 * repository nor the host. `scripts/cle-de-l-exploitant.mjs` draws the pair
 * on the operator's machine and prints the line below in this very form.
 *
 * Which key a build may carry here, and why: `scripts/assert-operator-key.mjs`,
 * which loads this file under Node to read it. So it imports nothing.
 */

/** X25519, 32 bytes, in standard base64. */
export const OPERATOR_KEY = 'mD3vxUbnchoghIM22hYScz6J+lmbQuZTjX22y4FoSDY='
