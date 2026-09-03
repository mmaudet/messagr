# Megolm in V1, MLS deferred

The product specification names MLS the production target for community group
encryption. Version 1 ships Megolm, and the specification is amended to describe
MLS as a later trajectory rather than a target already chosen.

No MLS implementation is within reach. The crypto library's types are
deliberately open to it, so adding it later is an additive change rather than a
breaking one, but nothing implements it there, nothing implements it in the
previous codebase, and it is on none of the library's roadmap items before 1.0.
The previous generation's own product requirements had already reached this
conclusion and written it down; the version 2 specification regressed into a
promise the project had once known better than to make.

## Consequences

The transition states the design already carries stay as drawn: screen 30
annotates a room migrating from Megolm to MLS, and that annotation is now the
plan rather than a detail. Nothing in the product needs to change when MLS
arrives beyond the migration those states describe.
