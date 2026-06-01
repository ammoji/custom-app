# HOTFIX-1 — Delivery proof upload: Firestore Timestamp vs number type bug

**Bug source:** Sudhir's testing pass on PR-NEXT-6 (finding #13 follow-up). Every photo upload attempt fails with `failed-precondition: "Pick up the order before uploading a proof photo"` — even when the order is demonstrably picked up (the partner saw the dashboard reflect pickup, AND the photo CTA only renders when `pickedUp` is true, so client-side state is correct).

**Deploy class:** server-first, no rules / app config / client OTA. Pure functions deploy:

```
firebase deploy --only "functions:getDeliveryProofUploadUrl,functions:recordDeliveryProofUpload"
```

No IAM check needed — both functions already deployed with `allUsers` binding in PR-NEXT-6. We're updating logic, not introducing new callables.

**Read first**

1. `docs/pr-next-6-delivery-proof-photo-windsurf-prompt.md` — parent PR; explains why the validator gates on `pickedUpAt`
2. `.windsurf/code-discipline.md` Rules 1, 10
3. `functions/src/deliveryProofHelpers.ts` lines 80–98 — the bug site (`validateDeliveryProofUploadAuth`)
4. `functions/src/index.ts` lines 3552–3554 — `markPickedUp` writes `pickedUpAt: FieldValue.serverTimestamp()`
5. `tests/functions/deliveryProofHelpers.test.ts` lines 23–31 — existing `VALID_ORDER` fixture uses a number, masking the bug

---

## Root cause (confirmed end-to-end from the code)

`markPickedUp` writes the timestamp via Firestore's `FieldValue.serverTimestamp()`:

```ts
// functions/src/index.ts:3552
await ref.update({
  pickedUpAt: FieldValue.serverTimestamp(),
  ...
});
```

Firestore stores this as a `Timestamp` **object** (with `.toMillis()` / `.toDate()` methods), NOT as a millisecond `number`. When `getDeliveryProofUploadUrl` reads the order doc and hands it to the validator:

```ts
// functions/src/deliveryProofHelpers.ts:90
if (typeof order.pickedUpAt !== 'number' || order.pickedUpAt <= 0) {
  return {
    ok: false,
    code: 'failed-precondition',
    message: 'Pick up the order before uploading a proof photo',
  };
}
```

`typeof Timestamp === 'object'` ≠ `'number'` → the check fails on the first branch → returns `failed-precondition` every single time. The `<= 0` branch never even gets exercised because the first one already rejected.

**Why the tests didn't catch this:** the test fixture (`tests/functions/deliveryProofHelpers.test.ts:23-31`) uses `pickedUpAt: 1_700_000_000_000` — a plain number. The test was correct against the validator's contract but the validator's contract didn't match what production Firestore actually returns. A classic test-fixture-doesn't-match-production-shape gap.

**Why the client thinks it's picked up:** the dashboard reads `order.pickedUpAt` through the orderService watcher which serializes Firestore Timestamps to JS numbers for client consumption. The client truthy-check (`!!order.pickedUpAt`) is happy because the millis number is non-zero. Only the server-side validator sees the raw Timestamp object, and only the server-side validator does a strict `typeof === 'number'` check. Hence: button visible, upload fails.

This is exactly the bug class the existing CLAUDE.md "Rule of thumb" calls out: *"when a validator/helper gains a field, grep every caller/wrapper for that field before shipping."* PR-NEXT-6 added a new validator field (`pickedUpAt`) without auditing what the Firestore SDK actually returns for that field shape.

---

## Plan

### §A — Make `validateDeliveryProofUploadAuth` accept both shapes

Change the validator to normalize `pickedUpAt` to millis before the gate check. Accepts:

- Plain millis number (today's contract; preserves test fixture validity)
- Firestore `Timestamp`-like (anything with a `.toMillis()` method) — the actual production shape
- Anything else (null / undefined / wrong shape) → still fails as before

In `functions/src/deliveryProofHelpers.ts`, replace the existing `pickedUpAt` check (current lines 90–96) with:

```ts
// PR-NEXT-HOTFIX-1 — Firestore `serverTimestamp()` is stored as a
// `Timestamp` object on read (not millis). The original `typeof
// order.pickedUpAt !== 'number'` check always failed in production
// because the Admin SDK hands the raw Timestamp back to us. Accept
// both shapes: plain millis numbers (test fixtures + any caller
// that pre-normalizes) AND Timestamp-likes (everything from a real
// Firestore read).
const rawPickedUpAt: unknown = order.pickedUpAt;
const pickedUpAtMillis: number | null =
  typeof rawPickedUpAt === 'number'
    ? rawPickedUpAt
    : typeof (rawPickedUpAt as { toMillis?: unknown })?.toMillis === 'function'
      ? (rawPickedUpAt as { toMillis: () => number }).toMillis()
      : null;
if (
  pickedUpAtMillis === null ||
  !Number.isFinite(pickedUpAtMillis) ||
  pickedUpAtMillis <= 0
) {
  return {
    ok: false,
    code: 'failed-precondition',
    message: 'Pick up the order before uploading a proof photo',
  };
}
```

Also update the `DeliveryProofUploadAuthInput` type to reflect that `pickedUpAt` is now an opaque "timestamp-like":

```ts
order: {
  deliveryPersonId?: string | null;
  // PR-NEXT-HOTFIX-1 — accept either millis (test fixtures) or
  // Firestore Timestamp-like (production reads). The validator
  // narrows internally.
  pickedUpAt?: number | { toMillis(): number } | null;
} | null;
```

### §B — Test pins for both shapes + a Firestore-style fixture

Add three new tests to `tests/functions/deliveryProofHelpers.test.ts` inside the existing `describe('validateDeliveryProofUploadAuth', ...)` block:

```ts
test('PR-NEXT-HOTFIX-1 — accepts Firestore Timestamp-like (the actual production shape)', () => {
  // The bug this hotfix fixes: production reads pickedUpAt as a
  // Firestore `Timestamp` (object with .toMillis()), not millis.
  // Pre-hotfix the validator's `typeof !== 'number'` check rejected
  // every real upload.
  const timestampLike = { toMillis: () => 1_700_000_000_000 };
  const r = validateDeliveryProofUploadAuth({
    auth: { uid: PARTNER_UID, token: { delivery: true } },
    order: { ...VALID_ORDER, pickedUpAt: timestampLike } as any,
  });
  expect(r.ok).toBe(true);
});

test('PR-NEXT-HOTFIX-1 — Timestamp-like that returns 0 → failed-precondition', () => {
  // Defensive: if Firestore somehow returns a Timestamp at epoch 0,
  // treat it the same as a missing pickup (it can't represent a
  // real pickup event).
  const zeroTs = { toMillis: () => 0 };
  const r = validateDeliveryProofUploadAuth({
    auth: { uid: PARTNER_UID, token: { delivery: true } },
    order: { ...VALID_ORDER, pickedUpAt: zeroTs } as any,
  });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.code).toBe('failed-precondition');
});

test('PR-NEXT-HOTFIX-1 — Timestamp-like with non-finite millis → failed-precondition', () => {
  // Hostile / malformed Timestamp returning NaN or Infinity must not
  // pass the gate.
  const badTs = { toMillis: () => NaN };
  const r = validateDeliveryProofUploadAuth({
    auth: { uid: PARTNER_UID, token: { delivery: true } },
    order: { ...VALID_ORDER, pickedUpAt: badTs } as any,
  });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.code).toBe('failed-precondition');
});

test('PR-NEXT-HOTFIX-1 — object without toMillis → failed-precondition (defensive)', () => {
  // An object that's NOT Timestamp-shaped (no .toMillis method)
  // must not silently pass. Pre-hotfix this would already have
  // failed via the typeof check; post-hotfix the narrowing falls
  // through to the null branch and still rejects.
  const r = validateDeliveryProofUploadAuth({
    auth: { uid: PARTNER_UID, token: { delivery: true } },
    order: { ...VALID_ORDER, pickedUpAt: { foo: 'bar' } } as any,
  });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.code).toBe('failed-precondition');
});
```

The existing `pickedUpAt: 1_700_000_000_000` (number) test still passes — both shapes are now accepted.

### §C — Defensive sweep for sibling bugs

The Timestamp-vs-number type confusion is a recurring foot-gun (this is at least the second time we've hit it in this codebase — see CLAUDE.md "Rule of thumb" guidance). After fixing the immediate bug, **grep for other server-side validators that compare a known-server-timestamp field with `typeof === 'number'`** and flag any matches. The pattern to look for:

```
grep -rn "typeof.*pickedUpAt\|typeof.*deliveredAt\|typeof.*createdAt\|typeof.*updatedAt\|typeof.*acceptedAt\|typeof.*cancelledAt\|typeof.*paidAt\|typeof.*deliveryProofUploadedAt" functions/src/
```

For each match:
- If the validator runs against raw Firestore reads (callable wrappers passing `snap.data()` through verbatim) → at risk; apply the same normalize-then-narrow pattern.
- If the validator runs only against client-supplied input (already-normalized millis) → safe; no change needed.

**Report findings inline in the prompt completion message.** Don't fix sibling bugs in this PR — file each as its own follow-up so we don't snowball scope. The grep + audit is the deliverable; remediation comes via individual hotfixes if needed.

---

## Discipline checklist

1. **Rule 1 — Imports stay.** No new imports; the validator uses only types and built-ins.
2. **Rule 10 — Reads before writes.** N/A (no Firestore writes touched).
3. **Server-first.** Functions deploy ships independently; no client OTA needed. The fix is invisible to the client until they retry the upload — at which point it works.
4. **Test discipline.** §B adds 4 tests. Suite count should rise by 4.
5. **No schema change, no callable contract change.** Validator return shape is identical; only the input acceptance widens.

---

## Acceptance checklist

Quick — this should be one re-test of the failing flow plus a regression sweep.

**Happy path retest:**

1. Place a test order. Shop accepts → preparing → ready_for_pickup. Partner accepts pickup → marks picked up.
2. On partner dashboard, tap `📸 Add delivery proof (optional)`. Camera opens. Take photo.
3. Spinner runs briefly. **Photo upload now succeeds** (pre-hotfix: always failed with "Pick up the order before…"). Button copy flips to `📸 Photo added — re-take?`.
4. Tap Delivered. Order completes.
5. Open the same order on shop / customer detail screens — `Delivery proof` section + thumbnail renders.

**Regression — picked-up gate still works:**

6. Manually edit a test order in Firestore Console to remove `pickedUpAt` (set to `null`). Try to upload a photo via the partner. Server should still return `failed-precondition: "Pick up the order before…"`. The gate hasn't been weakened.

**Test suite:**

7. `cd functions && npm run test:unit` — all green. Suite count +4 (the new Timestamp-like cases).
8. `npm run test:unit` (root) — unchanged.
9. `npx tsc --noEmit` clean (both root + functions/).

**Defensive sweep deliverable:**

10. Run the grep from §C. Paste the matching lines + a one-line at-risk / safe verdict for each into the prompt-completion report. Don't open follow-up PRs yourself; just surface the list.

---

## Deploy plan

Server-only:

```
cd functions
npm run build
firebase deploy --only "functions:getDeliveryProofUploadUrl,functions:recordDeliveryProofUpload"
```

Both functions deployed; no IAM check needed (bindings already in place from PR-NEXT-6).

Pull on installed partner device → re-run acceptance step 1–5.

**No client OTA required.** The client's photo-upload code path is unchanged; it just stops getting rejected by the server.

---

## Doc trail updates after ship

- `docs/TESTING-FINDINGS-2026-05-30.md` — under finding #13, add a sub-note: `Photo upload Timestamp-vs-number bug → ✅ SHIPPED in PR-NEXT-HOTFIX-1 (May 31 2026)`.
- `docs/SESSION_LOG.md` — one-paragraph entry covering the diagnosis, the validator widening, the 4 new test cases, and the defensive-sweep findings from §C.
- `CLAUDE.md` — bump date; add a one-line "Lessons" entry under existing code-discipline notes: *"Firestore `Timestamp` reads are NOT plain millis numbers. Any server-side validator that gates on a server-written timestamp MUST normalize via `toMillis()` (or accept the Timestamp-like shape directly). Adding new validator fields that compare against server timestamps requires a Firestore-shape fixture in the test suite, not just a numeric fixture."*
- `.windsurf/code-discipline.md` — consider promoting the above to a numbered Rule (Rule 12?) since this is now a recurring pattern. Leave the formal rule promotion to a follow-up if the sweep in §C uncovers more violations.
- `PRELAUNCH_CHECKLIST.md` — short note under the PR-NEXT-6 block.
