# PR 8.1 — Cleanup bundle (Windsurf prompt)

## Why this PR exists

Three small items that have been accruing as deferred work across
the last few PRs. Bundling because each is too small for its own PR,
and shipping them together lets us cleanly close a few tracked items
in PRELAUNCH_CHECKLIST.

Also doubles as a smoke test for the new auto-formatter setup
(`.vscode/settings.json` codeActionsOnSave flipped to `false`,
`.windsurf/code-discipline.md` discipline doc, and the extended
`scripts/audit-integrity.js` tripwire). A clean PR that needs zero
`DO NOT REMOVE` markers would be the strongest signal that the
import-stripping issue is actually fixed.

**Part 1** — Extend `AuditActorRole` to include `'customer'`. Currently
`cancelMyRecentPaidOrder` (the PR 7 customer-window cancel) writes
its audit entry as `actorRole: 'system'` with a `metadata.initiatedBy`
field carrying the customer uid, because the schema's union doesn't
include `'customer'` yet. That's misleading — `system` should mean
cron/cleanup, not user-driven. Widening the union + flipping the
call site is a 10-minute fix.

**Part 2** — Fix the 3 remaining baseline `tsc --noEmit` errors. The
baseline started at 11, dropped to 10 after PR 4 (SearchScreen
fix), and is now reported as 3 by Windsurf in recent PR sign-offs.
We don't have the exact errors documented anywhere; Step 1 of this
PR is to enumerate them, then triage.

**Part 3** — Formally defer App Check enforcement with a tracking
note in PRELAUNCH_CHECKLIST. Currently every callable has
`enforceAppCheck: false` and PR 6.1 + PR 8 + earlier PRs all
documented inline reasons for keeping it false. We need ONE
authoritative place that says "App Check is intentionally off
across all callables until we coordinate the flip; here are the
pre-conditions for flipping" — so future PRs stop re-justifying it
ad hoc.

## Read first

- `.windsurf/test-discipline.md`, `.windsurf/deploy-discipline.md`,
  and the new `.windsurf/code-discipline.md`.
- `functions/src/auditLogHelpers.ts` — `AuditActorRole` union lives
  here. Single source of truth for Part 1.
- `functions/src/index.ts` around line 1180–1200 — the customer
  cancel callable's audit write that needs to flip `'system'` →
  `'customer'`. Note the inline comment that justifies the current
  workaround; that comment goes away in this PR.
- `src/screens/admin/AuditLogScreen.tsx` around line 39 — the
  client-side type redefinition of the audit doc shape. Must stay
  in sync with the server's union. The screen renders
  `{item.actorRole}` as raw text, so no label mapping update needed
  — `'customer'` just shows up as "customer" verbatim.
- `tests/functions/auditLogHelpers.test.ts` — add cases that
  exercise the new union member.
- `PRELAUNCH_CHECKLIST.md` — locate the App Check tracking section
  (search for "App Check" or "enforceAppCheck"). Part 3 updates
  this.

## Scope (in)

### Part 1 — `'customer'` in `AuditActorRole`

#### 1a. Extend the server union

`functions/src/auditLogHelpers.ts`:

```ts
// Before
export type AuditActorRole = 'admin' | 'shopOwner' | 'system';

// After
export type AuditActorRole = 'admin' | 'shopOwner' | 'customer' | 'system';
```

That's the only structural change. `buildAuditLogEntry` already
passes `actorRole` through unchanged; no body change needed.

#### 1b. Update `cancelMyRecentPaidOrder`'s audit write

`functions/src/index.ts` around line 1180. Replace the entire
"Audit schema's actorRole union is admin|shopOwner|system…" comment
block + the `actorRole: 'system'` line with:

```ts
// PR 8.1 — customer-initiated cancel within the 2-min window.
// 'customer' is a first-class audit role as of PR 8.1; the previous
// 'system' workaround + metadata.initiatedBy carrier is gone.
await writeAuditLog({
  actorUid: auth!.uid,
  actorRole: 'customer',
  actionType: 'order.cancel_by_customer_window',
  targetType: 'order',
  targetId: orderId,
  reason,
  metadata: {
    refundId: refund?.id ?? refundDocId,
    // Drop metadata.initiatedBy — it was a workaround for the
    // missing 'customer' role and is now redundant with actorUid.
  },
});
```

**Verify** the rest of the call site still compiles after this
change. The `metadata` object had `initiatedBy: auth!.uid` in PR 8;
that field is now dropped. If any test in
`tests/functions/auditLogHelpers.test.ts` asserted on the presence
of `metadata.initiatedBy`, update it.

#### 1c. Sync the client union

`src/screens/admin/AuditLogScreen.tsx` around line 39:

```ts
// Before
actorRole: 'admin' | 'shopOwner' | 'system';

// After
actorRole: 'admin' | 'shopOwner' | 'customer' | 'system';
```

This local redefinition duplicates the server type — that's an
existing posture (the client doesn't import from `functions/src/`).
Don't refactor it in this PR; just keep the two unions in sync.

#### 1d. Add a test case

`tests/functions/auditLogHelpers.test.ts`:

```ts
it('accepts customer actorRole and surfaces it in the doc', () => {
  const result = buildAuditLogEntry(
    {
      actorUid: 'customer_uid_42',
      actorRole: 'customer',
      actionType: 'order.cancel_by_customer_window',
      targetType: 'order',
      targetId: 'order_99',
      reason: 'changed mind',
    },
    FROZEN_NOW,
    FROZEN_RAND,
  );
  expect(result.doc.actorRole).toBe('customer');
  expect(result.doc.actorUid).toBe('customer_uid_42');
});
```

### Part 2 — Fix the 3 baseline `tsc --noEmit` errors

**Step 1 — Enumerate.** Run from the project root:

```powershell
npx tsc --noEmit
```

Paste the full output back into your scratchpad. You should see
exactly 3 errors. They are historically in:

- `src/services/firebase.ts` (1 error, probably `getReactNativePersistence`
  not in public types — the file has a `@ts-ignore` somewhere that may
  be stale).
- `src/store/useOrderStore.ts` (2 errors, exact lines unknown).

**Step 2 — Triage each error and fix or document.** For each:

1. If it's a genuine type mismatch that's safe to fix without
   behaviour change → fix it.
2. If it's a known upstream issue (e.g.
   `getReactNativePersistence` not exported from public types in
   the Firebase SDK version pinned in `package.json`) → keep the
   `@ts-ignore`, but update the comment above it to explain WHY
   and reference the upstream issue. If the comment is already
   there and accurate, leave it.
3. If it's in a file we no longer care about (e.g. dead-code in a
   `_old` folder), delete the file in this PR with a checklist
   note.

Do NOT add `// @ts-expect-error` or `// @ts-ignore` to make errors
go away unless option 2 applies. The point of fixing them is to
shrink the baseline so a future regression is louder.

**Step 3 — Verify.** Re-run `npx tsc --noEmit`. Goal: 0 errors. If
any errors remain, document each in PRELAUNCH_CHECKLIST's baseline
section with file path + error code + reason it stays.

### Part 3 — Formally defer App Check

Add a section to PRELAUNCH_CHECKLIST (or update the existing one if
present) titled something like "App Check enforcement (intentionally
deferred)". Content:

```markdown
## App Check enforcement (intentionally deferred)

**Status:** All Cloud Functions callables ship with
`enforceAppCheck: false`. Counted at PR 8.1 deploy: ~10
callables, all consistent.

**Why deferred:**

- Native (iOS/Android) App Check requires native module setup
  (`@react-native-firebase/app-check` or DeviceCheck/Play Integrity
  glue) that we haven't done yet. Flipping enforcement on without
  it means every TestFlight request silently 401s.
- Web App Check is wired (reCAPTCHA v3 in `firebase.ts`) but
  enforcing it on callables would break native immediately.
- Coordinating the flip means: (a) add the native module, (b)
  rebuild via EAS, (c) verify tokens flow correctly from both
  platforms via the App Check debug panel in Firebase console,
  (d) flip every callable in one PR.

**Pre-conditions for flipping:**

1. `@react-native-firebase/app-check` installed and configured for
   both iOS (App Attest / DeviceCheck) and Android (Play Integrity).
2. Native rebuild successfully completes and the debug provider
   shows tokens flowing in Firebase console > App Check.
3. Production reCAPTCHA v3 site key matches what's in `app.json`
   `expo.extra.firebase.recaptchaSiteKey`.
4. All callables flipped to `enforceAppCheck: true` in one PR
   (not piecemeal — partial flip is worse than none, see PR 6.1's
   inline rationale).

**What we removed in PR 8.1:**

- Inline `// NOTE on enforceAppCheck` comments in individual
  callables. They were redundant once this section existed. The
  source of truth for the deferral is HERE, not scattered.
```

After adding this section to PRELAUNCH_CHECKLIST, grep for the
inline notes in `functions/src/index.ts` and remove them:

```powershell
# Look at what we'll be removing first
Select-String -Path "functions\src\index.ts" -Pattern "NOTE on enforceAppCheck" -Context 3
```

Then delete just the multi-line comment blocks, leaving the
`enforceAppCheck: false` line itself intact (don't change behaviour,
just drop the ad-hoc explanation).

## Scope (out)

- **Actually enabling App Check.** Documented as a pre-condition list,
  not done. Tracked in PRELAUNCH_CHECKLIST going forward.
- **Refactoring the client-side audit doc type** in `AuditLogScreen.tsx`
  to import from `functions/src/`. Existing posture is duplicate-the-
  union; we stay there.
- **Reducing tsc errors below 0** by enabling stricter compiler
  options (e.g. `noUncheckedIndexedAccess`). Out of scope.

## Acceptance checklist

- [ ] `AuditActorRole` union in `functions/src/auditLogHelpers.ts`
  includes `'customer'`.
- [ ] `cancelMyRecentPaidOrder` writes `actorRole: 'customer'`
  (not `'system'`), drops `metadata.initiatedBy`. Inline workaround
  comment removed.
- [ ] Client-side union in `src/screens/admin/AuditLogScreen.tsx`
  matches the server (`admin | shopOwner | customer | system`).
- [ ] New test in `tests/functions/auditLogHelpers.test.ts` covers
  the `'customer'` role. All existing tests still pass.
- [ ] `npx tsc --noEmit` from project root reports 0 errors (or
  the remaining errors are each documented in PRELAUNCH_CHECKLIST
  with a reason for staying).
- [ ] PRELAUNCH_CHECKLIST has the new "App Check enforcement
  (intentionally deferred)" section as specified.
- [ ] Inline `enforceAppCheck` notes in `functions/src/index.ts`
  are removed; the `enforceAppCheck: false` config lines stay.
- [ ] `npm test` all green (475+ tests, including the new one).
- [ ] `npm run audit` passes — and ideally this PR adds **zero**
  new `DO NOT REMOVE` markers (the auto-formatter fix should have
  made them unnecessary).
- [ ] Deliberate-break demo: change the new `'customer'` test to
  expect a different role, confirm it fails, then revert.

## Smoke tests (manual, after deploy)

This PR is OTA-only — no native module changes, no Storage rule
changes, no Firestore rule changes. Functions redeploy is the only
non-OTA piece.

1. **As customer, cancel a paid order within the 2-min window**
   (same flow as PR 7). Then as admin, open `AuditLog` → confirm
   the entry shows `actorRole: customer` (not `system`).
2. **As admin, perform any other action** (suspendShop, etc.).
   Confirm its audit entry's `actorRole` is still `admin` —
   regression check that we didn't break the existing flow.
3. **As shop owner, perform a bulk menu update** (PR 8 Part B).
   Confirm its audit entry's `actorRole` is `shopOwner`.

## Deploy plan

Follow `.windsurf/deploy-discipline.md`: one `--only` target per
command, no pipes.

1. `cd functions && npm run build` — confirm clean build.
2. `npm test` — final pre-deploy run.
3. `firebase deploy --only functions` — pushes the updated
   `cancelMyRecentPaidOrder` (callable signature unchanged; clients
   keep working without OTA).
4. `eas update --branch preview` — pushes the client (extended
   union in `AuditLogScreen.tsx`).
5. Smoke test on preview channel.
6. `eas update --branch production` — promote.

**Order matters less here** than in past PRs because the changes
are mostly internal: the union widening is type-only, and the
new audit role is forward-compatible (an old admin client reading
a doc with `actorRole: 'customer'` just renders the string as-is).

## Estimated time

~45–60 min Windsurf work:

- Part 1: 10 min (union + 2 file edits + 1 test).
- Part 2: 20–40 min depending on what the 3 errors actually are.
  If they're all upstream `@ts-ignore` cases the time is closer to
  the low end; if any need real fixes it's closer to the high end.
- Part 3: 5–10 min (PRELAUNCH section + inline comment removal).

All JS — no EAS rebuild needed.
