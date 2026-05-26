# Code editing discipline for Windsurf

This document is referenced by every Windsurf prompt under `docs/`.
Read it once; the rules apply to every PR.

## Why this doc exists

Across PRs 1, 2, 4, 5, 6, 6.1, 7, and 8 — every single PR — Windsurf
has stripped imports between its own multi-edit passes. The pattern
is always the same: the agent removes one call site of a helper as
part of a refactor, the import becomes momentarily unused before the
next edit chunk re-adds the call site, and the agent's TypeScript
LSP fires `source.removeUnusedImports` to "clean up" the now-orphan
import. The next chunk then fails to compile, the agent re-adds the
import, and we ship — but in PR 6 the strip persisted into the
final commit and shipped a regression to TestFlight (image picker UI
replaced by the old URL text input).

This is a real maintenance hazard. These rules exist to make it
impossible to repeat.

## Rule 1 — Never strip imports between edits in the same PR

If a function, type, or value is imported at the top of a file and
later referenced in code that this PR is editing, **the import stays
until the PR is complete.** Even if a momentary intermediate state
makes the import look unused, do not remove it. The next edit chunk
almost always re-introduces the usage; removing and re-adding burns
tokens and risks shipping the strip.

If the import is **genuinely** dead at the end of the PR (no
reference anywhere in the final file), it can be removed in a
separate, explicit "cleanup" pass at the end — never as a side
effect of an unrelated edit.

## Rule 2 — Defensive imports are sacred

When a PR adds an import that the agent's own tooling has stripped
before, mark it explicitly:

```ts
// PR N — DO NOT REMOVE. Auto-formatter stripped this once during
// PR M development. Used by <callable/function name> below. If
// tsc complains "Cannot find name 'X'", re-add this line.
import { X } from './someHelpers';
```

The marker comment is not decorative. It is read by
`scripts/audit-integrity.js` as part of `npm run audit`, which fails
the build if the marker exists without a following import statement
within the next 10 lines.

**Never delete a DO-NOT-REMOVE marker without also removing the
import it protects.** And never remove a protected import without
also removing the marker. They travel together.

## Rule 3 — Read before write, always

Before editing any file, read its current state in full. Do not
issue a `replace` or `multi_edit` based on a stale snapshot of the
file from earlier in the session. The agent's own previous edit may
have changed line numbers, added imports, or modified the very
section you're about to touch.

A read costs a tool call. A bad write costs the user's trust and
sometimes a deploy roll-back.

## Rule 4 — After multi-edits, re-read the file

After issuing a `multi_edit` or several sequential `replace`s on the
same file, **read the file back** before reporting the change as
done. This is the cheapest way to catch:

- An import the agent's LSP stripped during the edit
- A `replace` that landed at the wrong location because the snapshot
  was stale
- A JSX block that got truncated mid-statement
- A trailing comma or brace the agent forgot to add

If anything looks wrong, fix it BEFORE the deliberate-break demo and
the final test run. Discovering a corrupted file during deploy is
five orders of magnitude more expensive than discovering it during
edit.

## Rule 5 — `npm run audit` is the safety net, not a substitute

`npm run audit` runs `scripts/audit-integrity.js`, which (a) checks
every source file ends cleanly (not truncated mid-statement) and
(b) verifies every `DO NOT REMOVE` marker has a following import
within 10 lines. It is the **last** line of defense, not the first.

If audit catches a stripped import, that means rules 1, 2, 3, and 4
all failed in sequence. Don't celebrate the catch — investigate why
it slipped through the earlier layers.

## Rule 6 — IDE settings are layered defense, not the cure

`.vscode/settings.json` in this repo disables
`source.organizeImports` and `source.removeUnusedImports` on save.
That covers the case of a human (or the agent) accidentally
triggering Format on Save in the IDE.

It does NOT cover the agent's internal multi-edit pipeline, which
runs outside of save events. Rules 1–4 are still the primary
defense. The IDE settings are the safety net for the safety net.

## Rule 7 — Image URLs for React Native must specify a raster format

React Native's `<Image>` component renders PNG, JPG, GIF, and WebP.
**It does NOT render SVG.** Any external URL that might serve SVG
(placehold.co, some CDNs that do content negotiation, SVG icon
sets) must specify a raster format explicitly:

- `placehold.co`: add `.png` at the **END of the path** (right
  before `?text=`), e.g.
  `https://placehold.co/400x400/F5E6D3/8B4513.png?text=...`.
  **Position matters** — placing `.png` after the size segment
  (`/400x400.png/<bg>/<fg>?text=...`) still serves SVG. Verified
  on-device in PR 32.2.
- Other placeholder services: check their docs for the format
  query param or path segment
- Icon CDNs: prefer `.png` exports over the SVG default

When writing or reviewing any PR that adds external image URLs,
verify the format is explicit. **The failure mode is silent** —
RN's `<Image>` renders nothing, logs nothing, captures nothing
in Sentry. The bug only surfaces on visual inspection of the
device.

**First instance:** PR 32.1 shipped category placeholders with
SVG-flavor placehold.co URLs; every placeholder rendered as an
empty box on device. PR 32.2 fixed it by adding `.png` to each
URL. This rule exists so future placeholder/icon work doesn't
recur the same class of bug.

## Quick reference

| Layer | What it does | When it fires |
|---|---|---|
| Rules 1–4 | Discipline on the agent | During edits |
| Rule 7 | RN image URLs specify raster format | During edits / review |
| `.vscode/settings.json` | Disables organize-imports on save | On IDE save |
| `npm run audit` | Grep for stripped DO-NOT-REMOVE imports | Before deploy |
| `tsc --noEmit` | Compile check | Before deploy |

All must pass before a PR ships.
