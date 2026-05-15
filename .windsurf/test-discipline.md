# Test discipline for Windsurf

This document is referenced by every Windsurf prompt under `docs/`.
Read it once; the rules apply to every PR.

## Rule 1 — Tests are required, but execution is *once*

Sudhir established (post-v2-iii hotfix, after two loader-stuck bugs
slipped through manual testing) that **every PR must include
automated tests for what it changes or fixes.** No tests for new
behaviour = PR rejected at review.

But execution should happen **once, at the end of the PR, as
acceptance proof.** Not after every file edit, not after every
function change, not iteratively. Each iterative run burns Windsurf
tokens and Sudhir's quota for zero new information.

## Rule 2 — When to run tests

Run the test suite **exactly twice** during a typical PR:

1. **Once at the very end**, as the final acceptance step before
   reporting back. This is the "all green" proof.
2. **Once during the deliberate-break demo** (revert one fix,
   confirm the corresponding test fails, re-apply the fix, confirm
   all tests pass again). This proves the new tests actually test
   something.

That's it. Don't run them in the middle. Don't run them "to check
my work" between edits. If you're unsure whether a change broke
something, **read the affected test to understand what it pins**
rather than re-running the suite.

## Rule 3 — Which command to run

The repo has three test runners:

| Command | What it runs | Speed | When |
|---|---|---|---|
| `npm run audit` | File integrity check | <1s | Always (in acceptance) |
| `npm run test:unit` | Unit tests (services, hooks, Cloud Function pure helpers) — no emulator | ~15s | Always (in acceptance) |
| `npm run test:rules` | Firestore rules tests — boots emulator (needs JDK 21+) | ~45s | Only if the PR touched `firestore.rules` or `tests/rules/` |

Plus the convenience wrappers:

| Command | What it runs |
|---|---|
| `npm test` | audit + unit (the fast triple — use this for normal PRs) |
| `npm run test:full` | audit + unit + rules (use only when rules changed) |

Pick the **narrowest** runner the PR's changes warrant. A PR that
only touches `src/services/` doesn't need to boot the rules emulator.

## Rule 4 — How to report tests in the final summary

Acceptance proof must include:

- The exact command(s) run
- The output's pass/fail count line (e.g. `Tests: 24 passed, 24 total`)
- The deliberate-break demo: which file/line was reverted, which
  specific test name failed, that the revert was undone, that the
  re-run is back to green

Don't paste the full test runner output. The summary line + the
deliberate-break trace is enough to prove everything works.

## Rule 5 — Sudhir runs tests ad-hoc

Sudhir runs `npm test` whenever he wants — before commits, before
deploys, periodically while reviewing. He does **not** need
Windsurf to re-run tests for him. If he asks "did you run tests?",
answer with the result from the end-of-PR run, not by running them
again.

If a test is genuinely flaky and fails intermittently, that's a
defect to log — not a reason to re-run.

## Rule 6 — Adding new tests

Same discipline as adding fixes:

- Write the new test alongside the code it covers.
- Run the new test once when first authored to confirm it fails for
  the right reason (when there's no implementation yet) and passes
  once the implementation lands.
- Run the full suite once at end of PR.
- Don't iterate "test → run → test → run" — that's a sign the test
  isn't well-thought-out. Read the implementation, write the
  test that pins the contract, run once.

## Rule 7 — Anti-patterns that waste tokens

The following count as PR-quality issues, not just style:

- Running `npm test` after every file edit
- Running `npm test` "just to be safe" between unrelated changes
- Running `npm run test:rules` when the PR didn't touch rules
- Running individual test files (e.g. `jest tests/foo.test.ts`)
  one at a time across the PR — pick one final run of the whole
  suite
- Re-running tests after fixing a typo or comment

If you catch yourself running tests more than the prescribed two
times, stop and re-read this document.
