# AGENTS.md — standing rules for every coding agent session

This is the second-generation Messagr codebase. Its predecessor lives at
`mmaudet/old_messagr`; that repository's `AGENTS.md` carries the full rule set
and is not ported here automatically.

Product reference: `docs/product-spec.md` (v2, consolidated). It is the canonical
owner of the product architecture, the entity model, the permission matrix, the
trust and safety UX model, the deployment topology, and the glossary.

Matrix end-to-end encryption comes from `react-native-matrix-crypto` (Linagora).
It is a crypto bridge only: no homeserver, no login, no sync, no timeline.

## Agent skills

### Issue tracker

Issues live as GitHub issues in this repo, driven by the `gh` CLI.
See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, each label string equal to its name.
See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at the repo root.
See `docs/agents/domain.md`.
