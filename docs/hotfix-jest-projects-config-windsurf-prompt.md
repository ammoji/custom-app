# HOTFIX-JEST-PROJECTS-CONFIG — Make the full test suite actually runnable

**Source:** Across the Bundle G→J wave, "tsc clean" + "tests green" has been a partial signal because `npx jest` (all projects) fails to parse `react-native` in ~27 suites + 4 pre-existing `@react-native-firebase/app` suite-load failures. The test discipline we've been celebrating runs against the logic-test subset Devin can boot cleanly. The remaining suites either crash on parse or hide regressions silently.

**Devin's framing (2026-06-10): "the test discipline is theater until this works."** Highest-leverage fix in the process-improvement set.

**Deploy class:** **dev-only operational fix.** No runtime code changes. Pure jest configuration. Nothing ships to users.

## Root cause (verified by Claude before this prompt)

`jest.config.js` currently runs all test files through a single configuration. Pure-logic tests (`tests/utils/`, `tests/static/`, `tests/functions/` for the most part) need Node runtime with no RN. Component tests (`tests/components/`, screen tests) need the RN testing-library preset + module resolution for `@react-native-firebase/*` mocks.

Today's symptoms:
- Pure-logic tests run fine in Node; component tests crash on `react-native` parse
- `npx jest` exits non-zero on the component crashes, masking which logic tests actually passed
- CI doesn't catch regressions in unaudited surfaces because nobody runs the full suite green

**Why a projects split is the right fix:** jest's `projects` config lets one config file declare multiple test environments. Each project picks its own preset, transformer, moduleNameMapper, and `testMatch`. `npm test` runs all projects; the failing component project surfaces as failures (real signal) instead of crashes (no signal). Once both projects are runnable, every static guard + helper test runs on every CI invocation.

## Autonomous execution authorization

You may run the following without stopping to confirm — execute, report results in the final summary:

- All `Read`, `Grep`, `Glob`, `ls`, `git status`, `git diff` (read-only)
- `npx tsc --noEmit`
- `npx jest --listTests` (lists what each project would run)
- `npx jest` and `npx jest --projects <name>` for verification
- `cd functions && npm run build`
- File edits to:
  - `jest.config.js` (split into projects)
  - `package.json` (only the `scripts.test` line if needed)
  - New `jest.logic.config.js` + `jest.components.config.js` if you choose a multi-file split
  - Any `__mocks__/` directory additions for `@react-native-firebase/*` or `react-native` if needed
  - `tests/setup/*.ts` files for project-specific setup

You MUST stop and ask before:
- Deploy commands (this is a dev-only fix; no `eas update` / `firebase deploy`)
- Editing application code (`src/`, `functions/src/`)
- Adding NEW dependencies — exhaust existing ones first (`jest-expo`, `babel-jest`, `@testing-library/react-native` if already present)
- Deleting or skipping any test file — the goal is to RUN them, not silence them

## Required completion-report verification block (Rule 5 worked example #14 — strengthened)

In your final report, paste the literal output of:

```
wc -l jest.config.js jest.logic.config.js jest.components.config.js 2>/dev/null
grep -n "projects\|testMatch\|preset" jest.config.js
npx jest --listTests --projects logic 2>&1 | head -20
npx jest --listTests --projects components 2>&1 | head -20
npx jest 2>&1 | tail -30
```

This is a NEW completion-report requirement going forward — every prompt requires raw command output proving the implementation exists and runs, not just summary claims.

## Plan

### §A — Investigate current jest config + enumerate failures

Read `jest.config.js` and any related `babel.config.js` / `package.json` jest blocks. Enumerate:

1. Which test files currently parse cleanly in the existing config
2. Which test files crash on `react-native` parse
3. The 4 pre-existing `@react-native-firebase/app` suite-load failures (likely `openLegal`, `openSupport`, `openMapsForCoords`, `uploadDeliveryProof` per past Devin notes)
4. Any test files that import from BOTH `src/` and `functions/src/`

Report the enumeration in your final summary so we know the split target.

### §B — Split into two jest projects

Create the projects structure. Two main options:

**Option 1 — single `jest.config.js` with `projects` array:**

```js
module.exports = {
  projects: [
    {
      displayName: 'logic',
      testEnvironment: 'node',
      testMatch: [
        '<rootDir>/tests/utils/**/*.test.{ts,tsx}',
        '<rootDir>/tests/static/**/*.test.ts',
        '<rootDir>/tests/functions/**/*.test.{ts,tsx}',
        '<rootDir>/tests/services/**/*.test.{ts,tsx}',
      ],
      transform: { '^.+\\.(ts|tsx)$': 'babel-jest' },
      moduleNameMapper: {
        // Stub RN-dependent imports for logic project — if a logic test
        // accidentally imports from src/components, fail loud rather
        // than mock silently.
      },
    },
    {
      displayName: 'components',
      preset: 'jest-expo',  // or react-native preset
      testMatch: [
        '<rootDir>/tests/components/**/*.test.{ts,tsx}',
        '<rootDir>/tests/screens/**/*.test.{ts,tsx}',
      ],
      transformIgnorePatterns: [
        'node_modules/(?!(jest-)?@?(react-native|@react-native|expo|@expo|@react-native-firebase|firebase|@react-navigation|...)/)',
      ],
      moduleNameMapper: {
        '^@react-native-firebase/(.*)$': '<rootDir>/tests/__mocks__/@react-native-firebase/$1.ts',
      },
      setupFiles: ['<rootDir>/tests/setup/components.ts'],
    },
  ],
};
```

**Option 2 — separate `jest.logic.config.js` + `jest.components.config.js`** with `package.json` scripts:

```json
"test": "jest --projects ./jest.logic.config.js ./jest.components.config.js",
"test:logic": "jest --config ./jest.logic.config.js",
"test:components": "jest --config ./jest.components.config.js"
```

Pick whichever is cleanest for this codebase. Probably Option 1 unless the file gets unwieldy.

### §C — Fix the 4 pre-existing `@react-native-firebase/app` parse failures

Each of `openLegal`, `openSupport`, `openMapsForCoords`, `uploadDeliveryProof` imports something that ultimately pulls `@react-native-firebase/app` into the logic project's parse path. Two ways to fix:

1. **Move these to the components project** if they're integration tests that genuinely need the RN environment.
2. **Add a mock for `@react-native-firebase/app`** at `tests/__mocks__/@react-native-firebase/app.ts` returning a minimal stub.

Pick whichever matches what the test is actually exercising. If it's pure URL-building logic, mock the FB import; if it's lifecycle integration, move to components.

### §D — `__mocks__/` directory if needed

Add module-level mocks for:
- `@react-native-firebase/app` — return `{ firebase: {} }` stub
- `@react-native-firebase/auth` — same
- `@react-native-firebase/functions` — `httpsCallable: () => () => Promise.resolve({ data: {} })`
- `@react-native-firebase/firestore` — same shape
- `react-native` — minimal stub for any logic test that accidentally imports from a screen

Mocks live in `tests/__mocks__/` (or wherever your existing mocks are — verify first).

### §E — Test setup files per project

`tests/setup/logic.ts` — empty or minimal (Node env, no globals needed).

`tests/setup/components.ts` — RN testing-library setup, `jest.useFakeTimers()`, etc.

### §F — Update `npm test` script

`package.json`:

```json
"scripts": {
  "test": "jest",
  "test:logic": "jest --selectProjects logic",
  "test:components": "jest --selectProjects components",
  "test:unit": "jest --selectProjects logic",  // alias for the existing pattern
  "test:full": "jest && npm run test:rules"   // existing pattern, now includes both projects
}
```

Match existing script names where possible — don't break CI or developer muscle memory.

### §G — Verify both projects run to completion

```
npx jest --selectProjects logic --passWithNoTests
npx jest --selectProjects components --passWithNoTests
npx jest  # both
```

Expected output: each project either reports passes/failures or has zero matching tests. **No crashes, no parse errors.** A failing component test is real signal; a crashing parse is not.

## Discipline checklist

1. **Rule 1** — every new mock / setup file carries "HOTFIX-JEST-PROJECTS-CONFIG — DO NOT REMOVE" comments.
2. **Rule 2** — N/A.
3. **Rule 5** — schema audit-grep N/A (config change, not code change). **Worked example #14 enforcement enabled** via the required completion-report verification block above.
4. **Rule 7** — N/A.
5. **Rule 8** — FEATURES.md update in Doc trail: nothing user-facing changes. Document in cross-cutting §5.9 Operational scripts that the test suite is now properly partitioned.
6. **Rule 11** — N/A (no callables).
7. **Rule 13** — N/A.
8. **Rule 14** — N/A.
9. **Schema-additive** — N/A.
10. **Test discipline:** **0 new test files added.** The point of this PR is that EXISTING tests now actually run. Report the test count delta — before this PR, X tests ran cleanly; after, Y tests run (where Y > X — the previously-crashing component tests now report results).

## Acceptance checklist

1. `npx jest` exits with a clear pass/fail summary. No "SyntaxError: Cannot use import statement outside a module" crashes from RN parse.
2. `npx jest --selectProjects logic` runs all pure-logic tests in Node environment in under 30 seconds (matches current behavior of the partial suite).
3. `npx jest --selectProjects components` runs all component / screen tests in the RN environment. Failures are reported as failures, not crashes.
4. The 4 pre-existing failures (`openLegal`, `openSupport`, `openMapsForCoords`, `uploadDeliveryProof`) either pass (if movable to components project) or are explicitly mocked at the logic project's `__mocks__/`. None crash at parse time.
5. `npm test` invokes both projects via the same command.
6. `npm run test:unit` continues to work as a logic-only alias for backward compatibility with existing CI / developer workflows.
7. **All 5 existing static guards still run and pass:** `authClaimNames`, `noStaleDeferralComments`, `transactionReadOrder`, `shopOwnerCheck`, `partnerStatus`. Verified by `npx jest tests/static/ --selectProjects logic`.
8. `npx tsc --noEmit` (root) still clean.
9. **Required completion-report verification block at the top of this prompt is filled in with raw command output.**

## Out of scope

- Adding NEW tests. This PR is about making the existing suite runnable.
- Migrating tests between projects beyond what's needed for §C.
- Fixing any test that's failing for non-config reasons. Surface them in the report; fix in a follow-up PR.
- Touching `firestore.rules` tests or emulator-based tests (`npm run test:rules`). Out of scope.
- Replacing `jest-expo` with `react-native` preset or vice versa unless the existing preset is materially broken.

## Deploy

**None — dev-only configuration change.** No `firebase deploy`, no `eas update`, no IAM, no backfill.

Verify locally and commit:
```
git add jest.config.js jest.logic.config.js jest.components.config.js package.json tests/__mocks__ tests/setup
git diff --cached --stat
npx jest  # final sanity
```

## Doc trail (Cowork)

After ship:

- **TESTING-FINDINGS** — note the test suite is now properly partitioned and runnable end-to-end.
- **CLAUDE.md** — Resume protocol step 1 should mention `npm test` runs both projects now.
- **SESSION_LOG** paragraph capturing: the test discipline was theater until this fix; previously regressions could hide in component tests that crashed at parse time.
- **PROMPT_AUTHORING_NOTES** — Rule 5 worked example #14 is now ENFORCED via the required completion-report verification block. Every future prompt should include this block adapted to its scope.
- **FEATURES.md** §5.7 Deploy & build — add row: `Jest projects partition | Two-project split (logic in Node + components in RN env); both run on every `npm test` | HOTFIX-JEST-PROJECTS-CONFIG | shipped`. Lineage HTML comment.
- **Last updated** stamp on Cross-cutting §5.7 → 2026-06-10.
