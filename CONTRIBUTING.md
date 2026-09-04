# Contributing

## Before your first commit

```
git config core.hooksPath .githooks
```

This runs the formatter, the design-token check and the linter before each
commit. They are the two
checks that cost seconds locally and a full continuous-integration round trip
remotely, and running them was previously something to remember rather than
something that happened. Skip the hook once with `git commit --no-verify`.

## Design tokens

`design/tokens.json` is authoritative and `packages/app/src/design/tokens.ts`
is generated from it. Edit the JSON, then run `yarn tokens`; never edit the
generated module. The hook and continuous integration both run
`yarn tokens:check`, so a stale copy fails rather than drifting quietly away
from the design it claims to carry.

Two things enforce the tokens, and they enforce different things. Generation
checks the **floors** — the minimum body size, the minimum mono size, the
line-height ratios — against the token set itself, because that is the moment
a violation could enter. The lint refuses any colour, spacing, radius,
elevation or type value written in place, because provenance is what makes
those floors binding on the application. A literal that happens to equal a
token is still refused: the token can move and the literal cannot follow it.

Nothing slower lives in the hook. The unit tests and the typechecker belong to
whoever is working, run when they choose; a hook slow enough to be resented is
a hook people disable.

## What runs remotely

Two workflows, split by what a change can affect.

**CI** runs on everything: format, lint, typecheck, unit tests, and the
assertion that the bundle carries exactly one crypto implementation. About a
minute.

**Device** builds an APK and boots an emulator, so it runs only when something
could change what a device does. Prose, design sources and the spike fixture
are excluded. About seventeen minutes, which is why the exclusion exists — a
Markdown-only change once booted an emulator three times.

The exclusion is a denylist rather than an allowlist, deliberately: a new
directory keeps the device suite running until somebody decides otherwise,
because the alternative is silently stopping to test something nobody
remembered to list.
