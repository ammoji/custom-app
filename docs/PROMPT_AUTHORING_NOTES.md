# Prompt Authoring + Workflow Discipline (Cowork ↔ Windsurf)

This file is the canonical reference for HOW Claude (in Cowork mode)
and Windsurf are sequenced on this repo. Read this at the start of
any fresh Cowork session, after `CLAUDE.md` and `docs/SESSION_LOG.md`.

The goal: every Windsurf token spent on something that didn't need
Windsurf is a token that's no longer available for the next real
coding task. Save the quota by knowing what *doesn't* need it.

---

## Rule W — Use Windsurf only for actual code-writing work

Sudhir locked this in 2026-06-02 after a session where the doc-trail
updates would have burned ~30% of the remaining weekly Windsurf
quota for zero coding value. Going forward:

### Model + executor split (decided 2026-06-02, updated 2026-06-09)

- **Cowork (Claude direct)** runs Opus. Orchestration / design /
  decision-framing benefits from deep reasoning.
- **Devin / Cascade (Editor mode)** is the executor of record as of
  2026-06-09. Cognition rebranded Windsurf → Devin; the in-IDE
  Cascade chat + side-by-side diff review carried over unchanged
  (which is why Sudhir kept the executor when the choice was
  Devin vs Claude Code). Recent Windsurf history is preserved
  in the Cascade panel. **The migration auto-moved `.windsurf/`
  → `.devin/`** — `code-discipline.md`, `deploy-discipline.md`,
  `test-discipline.md`, and `workflows/` all live under `.devin/`
  now. Future prompts should reference `.devin/*` paths; legacy
  prompts still reference `.windsurf/` but Cascade will figure it
  out from context.
- **Model selection inside Cascade:** Sudhir confirmed
  `claude-sonnet-4-6` is selectable via the model picker
  (Cascade panel → search "Sonnet"). Default is "Adaptive"
  routing (auto-routes simple tasks to cheaper models, complex
  tasks to capable ones). Recommended posture: keep Adaptive
  as default; pin to Sonnet 4.6 explicitly for routine PRs;
  reach for Opus 4.8 only when a prompt hits an open-ended
  debugging wall.
- **Claude Code was evaluated on DIAG-STRIP (2026-06-02)** as a
  potential executor replacement. Quality was excellent — caught
  a deploy-classification error in Sudhir's prompt that Windsurf
  might have followed blindly. Sudhir's preference was the IDE's
  side-by-side diff review for catch-rate + learning value, so
  Cascade (now under Devin branding) stays the executor of
  record. Claude Code remains available for ad-hoc CLI tasks
  where the visual diff isn't needed.
- **Devin Cloud (autonomous task mode)** is a separate offering
  in the Devin family — background long-running task agent
  rather than in-IDE chat. Not used today. Could be evaluated
  later for tasks like "audit the codebase for X" where
  background async execution is OK and visual review is less
  important.

### Autonomous execution authorization (added 2026-06-09)

Sudhir's pain point: Devin defaults to "ask before run" for every
shell command + every file edit, which means a single PR cycle
generates 20+ confirmation prompts. Each one breaks flow and adds
no safety value when the operation is obviously within scope.

The fix: every prompt I draft includes an explicit **Autonomous
execution authorization** block near the top, listing what Devin
may do without stopping to confirm, and what it must stop for.
Devin then runs through the entire spec autonomously and reports
back at the end, only interrupting for real decisions.

**Standard block to embed in every Devin/Cascade prompt:**

```markdown
## Autonomous execution authorization

You may run the following without stopping to confirm — execute,
report results in the final summary:

- All `Read`, `Grep`, `Glob`, `ls`, `git status`, `git diff` (read-only)
- `npx tsc --noEmit` (root and `functions/`)
- `npm test`, `npm run test:unit`, `npm run test:full`, `npx jest`
- `npm run lint`, `npx eslint`
- `cd functions && npm run build` (compiles TS → lib/, does NOT deploy)
- File edits to files explicitly named in the §A–§Z plan sections
- New file creation in directories explicitly named in the plan
- Re-running any of the above to verify after fixing an error

You MUST stop and ask before:

- Deploy commands: `firebase deploy …`, `eas update`, `eas build`,
  `gcloud run …`, `firebase functions:delete`
- Direct Firestore writes via callable invocation (production data)
- File deletes (`rm`, `git rm`)
- Force-push, rebase, branch ops outside the work branch
- Editing files NOT named in the plan (scope creep — ask first)
- Adding NEW dependencies (`npm install <new-package>`) not listed
  in the plan
- Schema additions / migrations not in the spec
- Anything else that's irreversible or alters production behavior

Default posture: **execute, report at end.** Don't ask for permission
between steps. Final summary should include: files changed, test
count delta, tsc clean confirmation, any decisions you made
autonomously inside the green-light zone, and any items you
deferred to a human decision.
```

This pre-authorizes the entire "execute the spec, run tests, verify"
loop without interrupting Sudhir, while keeping irreversible
operations gated. Add to every prompt as a top-level section right
after the audit-grep table.

### What Windsurf DOES (real code-writing — quota worth spending)

- Multi-file PRs and refactors
- Server-side callables (`functions/src/` work, schema migrations,
  Firestore rules touching real authz)
- Anything needing `tsc` verification + `jest` test runs as part of
  the work cycle
- Anything that benefits from the IDE's TypeScript LSP +
  auto-formatter feedback (the classes of bugs the Claude/Cowork
  direct-edit path has shipped before: auto-import strip on edit,
  file truncation on big multi-line replaces, hooks-order
  regressions)
- New components, new hooks, new helpers that come with tests
- New configurable validators / discriminated-union Results / pure
  helpers that need ≥4 test cases pinned

### What Cowork (Claude direct) DOES — NO Windsurf quota

- **Doc trail updates** — `CLAUDE.md`, `docs/SESSION_LOG.md`,
  `docs/TESTING-FINDINGS-*.md`, `PRELAUNCH_CHECKLIST.md`, this
  file, READMEs, anything `.md`. Pure text, never blocks coding,
  never benefits from LSP.
- **One-off operational scripts** — `scripts/reset-keep-catalog.ts`,
  `scripts/audit-shops-without-location.ts`, `scripts/delete-orders-only.ts`,
  any single-purpose script that's run a handful of times then
  archived. Tests not required (one-shot, manual smoke is enough).
- **Tiny single-file edits** — copy changes, label text, hint strings,
  greeting personalization, validator-error-message tweaks. Generally
  ≤5 lines, ≤1 file, no test churn.
- **Configuration data** — `src/constants/testAccounts.ts`,
  `src/constants/branding.ts` when it's purely string changes, any
  `data.ts` style file with no behavior.
- **Audit / research / diagnostic work** — `Grep` patterns, code
  reading, root-cause analysis, "where does X live?" investigations.
  This is where most pre-prompt thinking happens; never needs
  Windsurf.
- **PR prompt drafting** — every Windsurf prompt is a Markdown file
  written by Claude direct. Windsurf doesn't write its own prompts.
- **ASCII mockups + design discussion** — pre-prompt design
  artifacts. Decision frameworks. Trade-off tables. Pre-design
  checks via `AskUserQuestion`.
- **Deploy command sequences + operational guidance** — `firebase
  deploy …`, `gcloud run services …`, Firebase Console flips, IAM
  verifies, EAS update commands. Sudhir runs these; Claude composes
  the runbook.
- **Quick HOTFIX-style edits** that are 1–5 lines AND don't need
  test verification. Example: HOTFIX-FALLBACK-LEAK was a 4-edit
  change in one file with no test impact — Claude direct. Example:
  HOTFIX-6.1 needed cart store snapshot changes + a new test pin —
  Windsurf.

### Default when unclear

Try Claude direct first. If the work meets ANY of these triggers,
escalate to Windsurf:

- Would touch >2 files
- Would add >50 lines of code (not docs)
- Needs new tests pinned (≥3 cases)
- Touches `functions/src/` callables (server schema is too easy to
  break without the LSP catching it)
- Needs a `tsc --noEmit` confirmation that's nontrivial
- Touches React hooks or component lifecycle (Rules of Hooks
  regression risk)

### How Cowork hands work TO Windsurf

When work needs Windsurf, Claude direct does:
1. Audit grep + design check up front (Rules 5–6 below)
2. Draft a `docs/pr-next-<slug>-windsurf-prompt.md` file with the
   complete plan, audit-grep table, ASCII mockup if a UX surface,
   discipline checklist, acceptance checklist, deploy sequence
3. Hand the file path to Sudhir; Sudhir sends to Windsurf when ready
4. Review Windsurf's reply against the prompt's acceptance checklist
5. Handle the doc trail post-ship (per Rule W — text, not code)

### How Cowork validates work Windsurf finished

- Read the test-count delta against forecast. If exact or within
  ±10%, design was right. If much higher, Windsurf went beyond
  scope (often good — flag in next session for "next prompt
  scope this similarly"). If much lower, possibly missed cases.
- Spot-check 1–2 file references Windsurf cited. Does the line
  number actually point at what they claim shipped?
- Don't re-read every file. Trust the test suite + tsc clean as
  the structural signal; spot-check semantics.

---

## Discipline Rules (accumulated)

These are prompt-authoring + work-orchestration commitments locked
in over the May–June 2026 wave. They sit alongside the
`.windsurf/code-discipline.md` rules (which govern Windsurf's own
edits) and apply to anything Claude-direct or Claude-via-prompt
produces.

### Rule 1 — Impact-audit grep up front

For any "fix display of X" or "render Y differently" prompt, the
header includes the actual `Grep` results showing every read-site
of X / Y, with an explicit in-scope / out-of-scope split BEFORE
the Plan section.

**Example:** HOTFIX-6 patched ShopCard + ShopDetail but missed
CartScreen because no audit-grep ran on `deliveryFee` consumers.
HOTFIX-6.1 fixed it, but the failure was preventable.

### Rule 2 — Lean-or-rich check on disclosure surfaces

Sheets, modals, detail cards, info panels — anytime the PR's job
is "show stuff to the user," ask via `AskUserQuestion` whether the
intent is intentional minimalism or richer disclosure BEFORE
writing the prompt. One round-trip is cheaper than a follow-up PR.

**Example:** PARTNER-CARD shipped lean (intentionally restrained);
PARTNER-CARD.1 shipped richer (still data-driven, not
customer-question-driven); PARTNER-CARD.2 was the "real" sheet that
should have been written first. Two PRs of rework saved by asking
once.

### Rule 3 — Scope cuts surface in chat, not silently in the diff

For multi-section prompts (§A, §B, §C, §D), if any section feels
over-engineered, flag in chat BEFORE Windsurf executes:

> "**§C as written would do X. I'd cut it because Y. Cut or keep?**"

Forces a yes/no instead of a soft "confirm?". Sudhir overrides
or accepts; the prompt reflects the final scope. Never let
Windsurf cut scope unilaterally then surface it in their reply —
that's the ADDRESS-UX pattern that re-opened.

### Rule 4 — Android gesture-nav clearance (operationalised via Rule 13 in code-discipline)

Any new bottom-anchored modal MUST use `BottomSheet` from
`src/components/common/`. Acceptance checklist for that PR
includes "verified bottom CTA fully tappable on Android tall-pill
device." See `.windsurf/code-discipline.md` Rule 13 for the
audit-grep + exception list.

### Rule 5 — Schema verification before referencing doc fields (+ call-site behavior check)

Any prompt referencing `order.X` / `user.Y` / `shop.Z` includes
the grep result confirming the field exists at that name in
production schema. PLUS — and this was added 2026-06-02 — the
audit-grep must also cover behavior at call sites when the field
is missing / null / nonconforming.

**Examples of what this catches:**
- The `customerUid` vs `customerId` bug in PARTNER-CARD.1 (field
  name was wrong in the prompt; my prompt's test fixture used the
  same wrong name; test passed silently)
- The `MOCK_USER_LOCATION` leak (`source` field existed in the
  type but no call site read it; SHOP-LOCATION-REQUIRED's
  validator silently accepted the degraded fallback value)

**Worked examples accumulated (2026-06-10 → 2026-06-12 pilot-prep wave):**

- **#10 Auth direction bugs (HOTFIX-OWNER-CARD-AMEND).** Auth
  pattern bugs come in TWO classes: shape bugs (wrong field name —
  caught by `authClaimNamesAudit`) AND direction bugs (asking
  "does user own SOME matching shop?" instead of "does THIS shop
  have user as owner?"). The direction bug requires its own audit
  pattern — `shopOwnerCheckAudit` bans `where(ownerUid).limit(1)`.
- **#11 Denormalization recompute in the same transaction
  (HOTFIX-OWNER-CARD-AMEND §H).** When state transitions cascade
  to N denormalized fields, all updates belong inside ONE
  transaction. `amendRating`'s outside-tx ratingAvg recompute
  raced `_publishReview`'s in-tx writes; consolidated by moving
  the recompute INSIDE `_publishReview`. Same lesson as
  HOTFIX-REVIEW-DENORM at a deeper level — not just "cascade the
  field" but "cascade the recompute too."
- **#12 Audit-grep enumeration for missing-feature-across-surfaces
  (HOTFIX-PARTNER-STATUS-DISPLAY).** Bundle H §C added a
  three-state subtitle to PartnerIdentityCard; the audit-grep
  targeted `formatPartnerAvatar` consumers but missed two more
  surfaces (ShopOrderDetailScreen + PartnerDetailsSheet header)
  that hit the literal string "On the way" via different code
  paths. Static guard `partnerStatusAudit` enumerates every literal
  usage, not just helper consumers.
- **#13 Per-party state machine split (Bundle J).** When a single
  field models a state machine for N independently-actionable
  parties (shop + delivery), split into N per-party fields. Keep
  the legacy field as computed worst-of for back-compat until
  consumers migrate. Same pattern applies to any future
  same-entity multi-party state — escalation responses, multi-
  approver workflows, etc.
- **#14 PR completion verification (HOTFIX-ATTENTION-CALLABLES-
  MISSING).** `tsc --noEmit clean` does NOT verify implementation
  existence when the type is declared separately. Bundle I §D/§E
  callables were reported shipped THREE TIMES (Bundle I report,
  Bundle J §G report, cross-check report with confabulated
  specific line numbers like `index.ts:10921` that exceeded the
  file's actual 10494 lines). PR completion verification must
  include `grep "export const <name>"` output in the completion
  report, NOT just a typecheck-pass claim. **Required completion-
  report verification block is now standard at the top of every
  prompt** (see "Required completion-report verification block"
  section below).
- **#15 Silent catch antipattern (HOTFIX-SILENT-CATCH-GUARD).**
  `.catch(() => {})` is indistinguishable from success-with-empty-
  data. Every screen / service data-fetch catch must EITHER
  `Sentry.captureException(e)` OR rethrow OR set an error state
  that surfaces to UI. Static guard `noSilentCatchAudit` enforces
  with `// silent-catch-audit:allow` inline-comment allowlist for
  legitimate fire-and-forgets.
- **#16 Deploy state ≠ code state (HOTFIX-POST-DEPLOY-SMOKE-
  SCRIPT).** Three structurally-different post-deploy failures
  share the same symptom (empty result): callable not deployed,
  composite index still Building, IAM allUsers stripped (ACAB).
  None visible in deploy-command exit codes. `npm run smoke`
  catches all three in seconds via `gcloud functions describe` +
  `firebase firestore:indexes` + `gcloud run services get-iam-
  policy`. Run after every server deploy.

---

### Required completion-report verification block (added 2026-06-12)

Every prompt that creates new files / exports / callables MUST
include a block near the top demanding raw command-output evidence
in Devin's completion report. Sample:

> **Required completion-report verification block.** In your final
> report, paste the literal output of:
> ```
> wc -l <expected-new-file>
> grep -n "export const <expected-symbol>" <expected-file>
> grep -n "<expected-helper>" <expected-consumer-file>
> npx jest <expected-test-file> 2>&1 | tail -10
> ```
> Numeric line numbers must be within file bounds (verify with
> `wc -l <file>`). If a line number you cite exceeds the file
> length, the export does not exist.

Adapt the exact commands per prompt's scope. The point is raw CLI
output — not "tsc clean," not "tests pass," not a summary claim.
Line counts + grep hits are the verification primitive Devin can't
hallucinate around without their own report contradicting them.

This rule emerged from three sequential confabulated reports on
the Bundle I §D/§E attention-queue callables across Bundle I →
Bundle J §G → cross-check. Each report added more confidence
(specific line numbers, specific function names) without any
actual code existing in the file. The verification block makes
the hallucination structurally impossible — Devin's own `wc -l`
output in their report contradicts an out-of-bounds line number
before Sudhir or Claude sees the report.

### Rule 6 — ASCII mockup + design lens for new UX surfaces

Before drafting a prompt for any new/redesigned UX surface:
1. State the customer's question this surface answers
2. List the 3–5 fields that answer it best
3. Note what's intentionally NOT shown + cost rationale
4. Sketch an ASCII mockup (with realistic placeholder data, not
   "[Field A]") for each major state variant
5. Show 2–3 mockups when there's a real layout tradeoff; let
   Sudhir pick
6. Embed the agreed mockup(s) in the prompt's Design Lens section
   so Windsurf matches the layout, not interprets it

Triggers: new screen, modal, sheet, card, significant redesign of
existing surface. Does NOT trigger: one-line additions, pure
logic / helper / callable changes with no visible surface.

### Rule 7 — Test fixtures match production schema, not in-flight code

The same audit-grep that proves field names in prompt headers
(Rule 5) re-runs against the test fixture file. If the callable
references `order.X`, the fixture builds documents with `X` —
verified against the actual production shape. Eliminates the
"self-confirming test passes a wrong-field bug" class that
PARTNER-CARD.1 shipped.

### Rule 8 — FEATURES.md update is part of every PR (added 2026-06-10)

**Every PR prompt MUST include an explicit FEATURES.md instruction
in its doc trail section.** This is mandatory whether the PR is a
new feature, a UX change, a hotfix, a deprecation, or a rename.

`docs/FEATURES.md` is the canonical inventory of "what the app
does today" across all four panels (customer / shop / delivery /
admin) + cross-cutting/system. It is useless if it drifts. Every
shipped change is a chance for it to drift, so the prompt is the
mechanism that forces the update at the right moment.

**Standard FEATURES.md instruction block to include in every
prompt's `Doc trail (Cowork)` section** (copy-paste, customise per
PR):

```
- FEATURES.md — concrete update list:
  - [Panel/Section] — add/edit/strike: <row text>
  - Source column: <this PR id>
  - Status column: shipped / dev-only / flagged / deferred
  - "Last updated" stamp on the affected section(s) → today's date
```

**Update categories — what kind of update each PR triggers:**

| PR kind | FEATURES.md action |
| --- | --- |
| New feature | Add a row in the appropriate section; bump section date |
| UX change to existing feature | Edit the description column + bump source PR id + bump section date |
| Hotfix (no behavior change, just fixes a broken feature) | No new row; verify existing row description still accurate; bump source PR id if behavior nuance changed |
| Removal / deprecation | Strikethrough the row (`~~text~~ — removed in PR-N`), do NOT delete |
| Schema-additive change with no user-visible surface | Mention in PR's commit message, NOT in FEATURES.md (FEATURES.md is user-facing only) |
| Operational config flip (e.g. `appConfig/pilotStatus.isLive: true`) | Update the Status column of the affected row in §4.5 Configuration |

**If a prompt doesn't touch user-facing behavior at all** (pure
refactor, dependency bump, test-only change) — still mention
"FEATURES.md — no row change; pure internal" in the doc trail
section so reviewers know it was considered.

**Why this rule exists:** Without it, FEATURES.md drifts. When
FEATURES.md drifts, a future session asking "do we already do X?"
gets the wrong answer and either re-builds something we have or
designs around a capability we shipped. Both are expensive in
their own ways.

---

## How CLAUDE.md should reference this file

`CLAUDE.md` resume protocol should include:

> 1.5. Read `docs/PROMPT_AUTHORING_NOTES.md` (workflow + discipline
>      rules — read AFTER CLAUDE.md but BEFORE doing any work).

So a fresh session in 3 weeks doesn't drift back to "Windsurf does
everything" and burn quota on a typo fix.

---

## Update protocol

Edit this file directly (no Windsurf) when:
- A new discipline rule emerges from a failure mode worth locking in
- The Windsurf vs Cowork split needs adjusting (e.g., if Cowork
  picks up the test-runner reliably, lighter-weight PRs could
  move to Cowork direct)
- A rule turns out to be wrong in practice

Keep entries terse. This file is a working agreement, not
documentation of how-to-do-X.
