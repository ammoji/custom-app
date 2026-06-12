# HOTFIX-SILENT-CATCH-GUARD — Ban silent `.catch(() => {})` blocks across screens + services

**Source:** Devin's 2026-06-10 root-cause analysis of the dashboard `count = 0` symptom:

> *"Silent catches are the #1 bug-amplifier. `ShopOwnerDashboardScreen.tsx:220` and `DeliveryDashboardScreen.tsx:322` both do `.catch(() => { /* silent */ })`. This turned a hard failure (missing callable, building index, IAM ACAB) into a silent count = 0 with zero diagnostics."*

Three failure modes during this testing wave that silent catches masked:
1. Missing server callables (the Bundle I §D/§E saga — count = 0 instead of "callable not found" error)
2. Building composite indexes (queries return empty until index Enabled — no breadcrumb)
3. IAM ACAB on Cloud Run (callable hits 401 → caught silently → empty result)

**Sixth permanent static-source guard.** Companion to the existing 5: `authClaimNames`, `noStaleDeferralComments`, `transactionReadOrder`, `shopOwnerCheck`, `partnerStatus`.

**Deploy class:** **client OTA.** Static guard + screen/service migrations. No server changes.

## Root cause (verified by Claude before this prompt)

`.catch(() => { /* anything */ })` and `.catch(() => {})` patterns swallow errors entirely. The fetch / callable / promise either succeeded or didn't — the calling code has no breadcrumb on which, and no path to surface the failure to either the user or Sentry.

The pattern shows up most often in screen data-fetch lifecycles:

```ts
useEffect(() => {
  orderService.someFetch()
    .then(rows => setRows(rows))
    .catch(() => { /* silent — section stays empty on failure */ })  // ← THIS
    .finally(() => setLoading(false));
}, [retryNonce]);
```

The intent is "don't crash the screen on a fetch failure." The cost is "we have zero visibility into actual failure rates and no UX path to recover." A correct version:

```ts
useEffect(() => {
  orderService.someFetch()
    .then(rows => { setRows(rows); setError(null); })
    .catch(e => {
      Sentry.captureException(e, { tags: { area: 'SomeScreen.someFetch' } });
      setError(e?.message ?? 'Could not load. Pull to refresh.');
    })
    .finally(() => setLoading(false));
}, [retryNonce]);
```

Sentry breadcrumb + UI error state + recover path. Same crash-protection guarantee.

## Autonomous execution authorization

You may run the following without stopping to confirm — execute, report results in the final summary:

- All `Read`, `Grep`, `Glob`, `ls`, `git status`, `git diff` (read-only)
- `npx tsc --noEmit`
- `npm test` (after HOTFIX-JEST-PROJECTS-CONFIG lands; runs both projects)
- File edits to:
  - `tests/static/noSilentCatchAudit.test.ts` (new — the guard)
  - Every silent-catch site enumerated in §B (likely `src/screens/`, `src/services/`, `src/components/`)
  - Sentry import additions where needed
- New file creation only for the test file

You MUST stop and ask before:
- Deploy commands
- Editing files NOT enumerated by the audit-grep in §B
- Adding NEW Sentry features or dependencies (use the existing `Sentry` from `src/services/sentry.ts`)
- Touching server code

## Required completion-report verification block

Paste the literal output of:

```
grep -rn "catch(() => {" src --include="*.tsx" --include="*.ts" | wc -l
grep -rn "catch(() => {" src --include="*.tsx" --include="*.ts"
npm test -- tests/static/noSilentCatchAudit.test.ts
```

The first grep count BEFORE the migration should be > 0; AFTER, the count should be 0 except for allowlisted lines (annotated with `// silent-catch-audit:allow`).

## Plan

### §A — Static-source guard

Create `tests/static/noSilentCatchAudit.test.ts`:

```ts
/**
 * HOTFIX-SILENT-CATCH-GUARD — sixth permanent static-source guard.
 * Bans empty / log-only `.catch(() => {})` patterns across screens
 * and services. Each silent catch in this category hides three
 * failure modes (missing server, building index, IAM denial) and
 * blocks Sentry visibility.
 *
 * Allowlist mechanism: inline `// silent-catch-audit:allow` comment
 * on the same line or one line above. Use sparingly; document the
 * reason in the comment.
 *
 * Companion to:
 *   - authClaimNamesAudit (Bundle G)
 *   - noStaleDeferralComments (Bundle H)
 *   - transactionReadOrderAudit (HOTFIX-PUBLISH-TX-ORDER)
 *   - shopOwnerCheckAudit (HOTFIX-OWNER-CARD-AMEND)
 *   - partnerStatusAudit (HOTFIX-PARTNER-STATUS-DISPLAY)
 *   - noSilentCatchAudit (this guard) ← NEW
 */

import { readFileSync } from 'fs';
import { glob } from 'glob';

describe('silent catch audit', () => {
  it('every .catch(() => {...}) in src/ either logs to Sentry, rethrows, or sets error state', async () => {
    const files = await glob('src/**/*.{ts,tsx}', {
      ignore: ['**/*.test.*', '**/__mocks__/**'],
    });
    const violations: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      const lines = src.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Match .catch(...) opening
        const match = line.match(/\.catch\(\s*(\([^)]*\)|[a-z_])\s*=>\s*\{/);
        if (!match) continue;
        // Extract the catch body — walk forward until matching close brace
        const start = i;
        const windowText = lines.slice(start, Math.min(lines.length, start + 8)).join('\n');
        // Check for allowlist
        const allowWindow = lines.slice(Math.max(0, start - 1), start + 2).join('\n');
        if (allowWindow.includes('silent-catch-audit:allow')) continue;
        // Acceptable patterns in the body:
        //   Sentry.captureException / Sentry.captureMessage
        //   throw
        //   setError / setSomethingErrorState (regex matches set[A-Z]*Error)
        //   console.error / console.warn  (visible in logs at least)
        const isAcceptable =
          /Sentry\.captureException|Sentry\.captureMessage|throw\b|set[A-Z]\w*[Ee]rror|console\.(error|warn)/.test(
            windowText,
          );
        if (!isAcceptable) {
          violations.push(`${file}:${i + 1} ← "${line.trim()}"`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
```

Pin **+3 detection-unit tests** proving:
- The guard catches `.catch(() => {})` with empty body
- The guard catches `.catch(() => { /* comment only */ })`
- The guard ignores `.catch(e => Sentry.captureException(e))`

### §B — Audit-grep + enumerate every existing silent catch

Run:

```
grep -rn "catch(() => {" src --include="*.tsx" --include="*.ts"
grep -rn "catch((e) => {" src --include="*.tsx" --include="*.ts"
grep -rn "catch(_ => {" src --include="*.tsx" --include="*.ts"
```

Enumerate every result that doesn't already have Sentry / throw / setError. Confirmed offenders from the testing wave:
- `src/screens/delivery/DeliveryDashboardScreen.tsx:322` (the count = 0 bug)
- `src/screens/shop/ShopOwnerDashboardScreen.tsx:220` (same)
- `src/screens/AttentionQueueScreen.tsx:43-44` (same)

Expect ~10–20 additional sites — common in data-fetch lifecycles and best-effort writes (e.g., analytics, push-token cleanup).

### §C — Migrate each silent catch

For each enumerated site, choose ONE remediation:

**Remediation 1 (most common) — Sentry + UI error state:**

```ts
// BEFORE
.catch(() => { /* silent — empty on failure */ })

// AFTER
.catch(e => {
  Sentry.captureException(e, { tags: { area: '<ScreenName>.<actionName>' } });
  setError(e?.message ?? 'Could not load. Try again.');
})
```

Requires a `[error, setError]` useState in the screen (if not already present, declared above conditional returns per Rule 2). The error gets rendered as a banner / toast / inline message.

**Remediation 2 — Sentry-only (no UI surface):**

For non-blocking best-effort writes (e.g., analytics, telemetry, push-token cleanup), where the failure doesn't affect the user's flow:

```ts
.catch(e => {
  Sentry.captureException(e, { tags: { area: 'pushTokenCleanup' } });
})
```

**Remediation 3 — Explicit allowlist:**

For genuine cases where the catch must be silent (rare — typically test code or known-noisy third-party callbacks), annotate:

```ts
// silent-catch-audit:allow — Razorpay onDismiss fires extra times on Android,
// not a real failure; logging would spam Sentry.
.catch(() => {})
```

The allowlist comment must include a one-line justification. The guard skips that line.

### §D — Verify guard passes after migrations

```
npx jest tests/static/noSilentCatchAudit.test.ts
```

Expected: clean pass. All silent catches either migrated to one of the three remediations or annotated.

### §E — Sanity smoke

After migrations, verify:
1. `npx tsc --noEmit` still clean.
2. Every screen with a new `error` state still renders without crashing on the empty `error === null` initial state.
3. The new `Sentry.captureException` calls have the right `tags.area` shape — one quick grep:

```
grep -rn "Sentry.captureException" src --include="*.tsx" --include="*.ts" | wc -l
```

The post-migration count should be roughly (silent catches before) + (existing Sentry calls), confirming each migration added one.

## Discipline checklist

1. **Rule 1** — every Sentry import + new state carries "HOTFIX-SILENT-CATCH-GUARD — DO NOT REMOVE" comments.
2. **Rule 2** — every new `[error, setError]` useState sits above conditional returns.
3. **Rule 5** — schema audit-grep enumeration is §B. Required completion-report verification block enforces real grep evidence.
4. **Rule 7** — N/A.
5. **Rule 8** — FEATURES.md update in Doc trail. No new user-facing rows; lineage HTML comments on the affected screen rows noting "now Sentry-instrumented."
6. **Rule 11** — N/A (no callables).
7. **Rule 13** — N/A.
8. **Rule 14** — N/A.
9. **Schema-additive** — N/A.
10. **Test discipline:** §A static guard +1, §A detection units +3 = **+4 tests minimum.** Plus zero NEW screen tests — existing tests must continue passing post-migration.

## Acceptance checklist

1. `grep -rn "catch(() => {" src --include="*.tsx" --include="*.ts"` returns 0 matches outside allowlisted lines.
2. `npx jest tests/static/noSilentCatchAudit.test.ts` passes clean. Deliberate-break: revert one migration → guard fails with file:line pinpoint.
3. `DeliveryDashboardScreen` + `ShopOwnerDashboardScreen` + `AttentionQueueScreen` data-fetch lifecycles all surface errors via Sentry + render error UI on failure. Simulate failure by mocking `orderService.listMyAttentionReviews` to throw → screen shows "Could not load." or similar, NOT count = 0.
4. All existing static guards still pass.
5. `npx tsc --noEmit` clean.
6. **Required completion-report verification block at the top is filled in.**

## Out of scope

- Adding NEW error-recovery flows (retry buttons, exponential backoff). Each migration uses the existing patterns in the same file.
- Refactoring screens for separation of concerns. Pure migration of catch blocks only.
- Modifying tests OTHER than the new guard. Existing tests must continue working.
- Server-side silent catches in `functions/src/`. Server already uses `console.warn` + Sentry. Separate audit if needed.
- Razorpay / payment SDK callbacks. Handle on a case-by-case basis with allowlist annotations where appropriate.

## Deploy

```
npx tsc --noEmit
npm test
eas update --branch production --message "HOTFIX-SILENT-CATCH-GUARD — Sentry observability + error UI on every data fetch in screens/services"
```

Pure client OTA. No server, no IAM, no backfill.

## Doc trail (Cowork)

After ship:

- **TESTING-FINDINGS** — note: the next observability gap (e.g., "count = 0 with no error message") will now surface a Sentry breadcrumb + UI error state.
- **CLAUDE.md** In-flight strike.
- **SESSION_LOG** paragraph capturing: silent catches were the #1 bug-amplifier; static guard is the structural fix.
- **PROMPT_AUTHORING_NOTES** — add Rule 5 worked example #15 (silent catch antipattern: a fetch failure with `.catch(() => {})` is indistinguishable from success-with-empty-data — never write that shape).
- **FEATURES.md** — no new rows. Static guard inventory note: now 6 permanent guards.
