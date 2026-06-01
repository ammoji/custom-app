# HOTFIX-2 — Customer cancel-paid-order: Firestore Timestamp vs number gate (paidAt)

**Bug source:** §C defensive sweep from HOTFIX-1 surfaced a second production-active validator with the same Timestamp-vs-number type-confusion class. `canCustomerCancelPaidOrder` in `functions/src/customerCancelWindowHelpers.ts:135-137` gates on `typeof order.paidAt !== 'number'`, but the production webhook writes `paidAt: FieldValue.serverTimestamp()` (admin SDK reads back a `Timestamp` object, not millis). Every customer attempting to cancel a paid online order is being mis-rejected with `"Order has no paid timestamp"`.

**Why this hasn't surfaced in smoke yet:** Razorpay is suspended, so no online prepaid orders are currently being created in production. The bug is dormant. **The moment Razorpay restores, this bug activates** — customers will tap "Cancel order" within their 2-minute self-service window, the callable will reject, and they'll have no path to cancel without contacting admin. Pilot-blocker the day Razorpay comes back.

**Deploy class:** server-only. Pure functions deploy, no client OTA, no rules / storage / app config:

```
firebase deploy --only "functions:cancelMyRecentPaidOrder"
```

No IAM check needed — function already deployed with `allUsers` binding. We're updating logic, not introducing a new callable.

**Read first**

1. `docs/pr-next-hotfix-1-photo-upload-timestamp-windsurf-prompt.md` — the parent hotfix; explains the Timestamp-vs-number bug class and the validator-widening pattern this PR mirrors exactly
2. `.windsurf/code-discipline.md` Rules 1, 10
3. `functions/src/customerCancelWindowHelpers.ts` lines 133–144 — the bug site
4. `functions/src/index.ts` around line 1714 — `cancelMyRecentPaidOrder` callable passes raw `orderSnap.data()` to the validator (no normalization upstream)
5. `functions/src/index.ts` around lines 1383, 3930 — the two production sites that write `paidAt: FieldValue.serverTimestamp()`
6. `tests/functions/customerCancelWindowHelpers.test.ts` lines 23, 133–215 — existing test fixtures use `paidAt: 1_000_000` (numeric millis), masking the bug exactly the same way HOTFIX-1's fixture did

---

## Root cause (confirmed end-to-end)

Production webhook handling Razorpay payment confirmation writes:

```ts
// functions/src/index.ts:1383 (and :3930)
await ref.update({
  paymentStatus: 'paid',
  paidAt: FieldValue.serverTimestamp(),
  ...
});
```

Firestore stores `serverTimestamp()` as a `Timestamp` **object** (with `.toMillis()` method), not as millis. When `cancelMyRecentPaidOrder` reads the order doc and hands it to the validator:

```ts
// functions/src/customerCancelWindowHelpers.ts:135-138
if (
  typeof order.paidAt !== 'number' ||
  !Number.isFinite(order.paidAt)
) {
  return {
    ok: false,
    code: 'failed-precondition',
    message: 'Order has no paid timestamp',
  };
}
```

`typeof Timestamp === 'object'` ≠ `'number'` → fails the first branch → returns `failed-precondition` for every real paid order. Customer sees: *"Order has no paid timestamp"* even when the order is demonstrably paid (their bank statement shows the charge; the order doc shows `paymentStatus: 'paid'` + a real `paidAt` Timestamp).

Why client never bypassed this: the in-app countdown UI on `OrderDetailScreen` uses the same `CUSTOMER_CANCEL_WINDOW_MS` constant, calculates `now - paidAt` client-side (where `paidAt` IS already millis because RNFB's serializer flattens Timestamps for the client). So the customer correctly sees a countdown saying "1:42 remaining" — taps Cancel — and the server rejects with "no paid timestamp." Maximally confusing.

Why the tests didn't catch this: every test fixture in `tests/functions/customerCancelWindowHelpers.test.ts` constructs `paidAt: 1_000_000` (a plain number). The validator's contract was correct against the test, but the test didn't match production shape. Same gap as HOTFIX-1.

---

## Plan

### §A — Widen `canCustomerCancelPaidOrder` to accept Timestamp-like

Apply the exact same normalize-then-narrow pattern HOTFIX-1 used on `validateDeliveryProofUploadAuth`. The validator should accept:

- Plain millis number (test fixtures, any caller that pre-normalizes)
- Firestore `Timestamp`-like (anything with `.toMillis(): number`) — the actual production shape
- Anything else (null / undefined / wrong shape / non-finite) → still fails as before

In `functions/src/customerCancelWindowHelpers.ts`, replace the existing paidAt check (current lines 133–144) with:

```ts
// PR-NEXT-HOTFIX-2 — Firestore `serverTimestamp()` is stored as a
// `Timestamp` object on read (not millis). The original `typeof
// order.paidAt !== 'number'` check always failed in production
// because the Admin SDK hands the raw Timestamp back to us (the
// webhook at functions/src/index.ts:1383 + :3930 writes paidAt via
// FieldValue.serverTimestamp()). Accept both shapes: plain millis
// numbers (test fixtures + any caller that pre-normalizes) AND
// Timestamp-likes (everything from a real Firestore read).
//
// Same pattern as HOTFIX-1 applied to validateDeliveryProofUploadAuth.
const rawPaidAt: unknown = order.paidAt;
const paidAtMillis: number | null =
  typeof rawPaidAt === 'number'
    ? rawPaidAt
    : typeof (rawPaidAt as { toMillis?: unknown })?.toMillis === 'function'
      ? (rawPaidAt as { toMillis: () => number }).toMillis()
      : null;
if (
  paidAtMillis === null ||
  !Number.isFinite(paidAtMillis) ||
  paidAtMillis <= 0
) {
  return {
    ok: false,
    code: 'failed-precondition',
    message: 'Order has no paid timestamp',
  };
}

const elapsed = now - paidAtMillis;
```

Note the `paidAtMillis <= 0` defense — HOTFIX-1 added this to reject `Timestamp({ toMillis: () => 0 })` (a Timestamp at the Unix epoch, which can't represent a real payment); same posture here.

Also update the `CancelWindowInput` type definition to reflect the widened acceptance:

```ts
// In CancelWindowInput type around line 46-57:
order:
  | {
      customerUid?: unknown;
      paymentMethod?: unknown;
      paymentStatus?: unknown;
      // PR-NEXT-HOTFIX-2 — accept either millis (test fixtures) or
      // Firestore Timestamp-like (production reads). The validator
      // narrows internally.
      paidAt?: number | { toMillis(): number } | null;
      status?: unknown;
    }
  | null
  | undefined;
```

(Cast remains `unknown` on read so the existing rejection branches for "no paidAt at all" etc. keep their defensive checks.)

Replace the existing `const elapsed = now - order.paidAt;` line (around line 146) with the new `const elapsed = now - paidAtMillis;` — the `order.paidAt` reference is now stale because we've moved to the normalized millis variable.

### §B — Test pins for both shapes + Firestore-style fixtures

Add four new test cases inside the existing `describe('canCustomerCancelPaidOrder — paidAt + window math', ...)` block in `tests/functions/customerCancelWindowHelpers.test.ts`:

```ts
test('PR-NEXT-HOTFIX-2 — accepts Firestore Timestamp-like (the actual production shape)', () => {
  // The bug this hotfix fixes: production reads paidAt as a
  // Firestore `Timestamp` (object with .toMillis()), not millis.
  // Pre-hotfix the validator's `typeof !== 'number'` check rejected
  // every real cancel attempt with "Order has no paid timestamp".
  const paidAtMillis = 1_000_000;
  const timestampLike = { toMillis: () => paidAtMillis };
  const result = canCustomerCancelPaidOrder({
    auth: { uid: CUSTOMER_UID },
    order: makeOrder({ paidAt: timestampLike } as any),
    now: paidAtMillis + 60_000, // 1 min in — well inside the window
  });
  expect(result.ok).toBe(true);
});

test('PR-NEXT-HOTFIX-2 — Timestamp-like at epoch 0 → failed-precondition', () => {
  // Defensive: a Timestamp at Unix epoch 0 cannot represent a real
  // payment event. Reject the same way a missing paidAt does.
  const zeroTs = { toMillis: () => 0 };
  const result = canCustomerCancelPaidOrder({
    auth: { uid: CUSTOMER_UID },
    order: makeOrder({ paidAt: zeroTs } as any),
    now: 60_000,
  });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.code).toBe('failed-precondition');
});

test('PR-NEXT-HOTFIX-2 — Timestamp-like with non-finite millis → failed-precondition', () => {
  // Hostile / malformed Timestamp returning NaN or Infinity must
  // not pass the gate.
  const badTs = { toMillis: () => NaN };
  const result = canCustomerCancelPaidOrder({
    auth: { uid: CUSTOMER_UID },
    order: makeOrder({ paidAt: badTs } as any),
    now: 60_000,
  });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.code).toBe('failed-precondition');
});

test('PR-NEXT-HOTFIX-2 — object without toMillis → failed-precondition (defensive)', () => {
  // An object that's NOT Timestamp-shaped (no .toMillis method)
  // must not silently pass. Falls through to the null branch.
  const result = canCustomerCancelPaidOrder({
    auth: { uid: CUSTOMER_UID },
    order: makeOrder({ paidAt: { foo: 'bar' } } as any),
    now: 60_000,
  });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.code).toBe('failed-precondition');
});

test('PR-NEXT-HOTFIX-2 — Timestamp-like + window boundary still respects elapsed math', () => {
  // Compose the Timestamp-like fix with the existing window-boundary
  // tests: at exactly CUSTOMER_CANCEL_WINDOW_MS elapsed, the answer
  // is still "ok" (the boundary is inclusive — see the existing
  // boundary test).
  const paidAtMillis = 1_000_000;
  const timestampLike = { toMillis: () => paidAtMillis };
  const result = canCustomerCancelPaidOrder({
    auth: { uid: CUSTOMER_UID },
    order: makeOrder({ paidAt: timestampLike } as any),
    now: paidAtMillis + CUSTOMER_CANCEL_WINDOW_MS,
  });
  expect(result.ok).toBe(true);
});

test('PR-NEXT-HOTFIX-2 — Timestamp-like past the window expires the same as numeric', () => {
  const paidAtMillis = 1_000_000;
  const timestampLike = { toMillis: () => paidAtMillis };
  const result = canCustomerCancelPaidOrder({
    auth: { uid: CUSTOMER_UID },
    order: makeOrder({ paidAt: timestampLike } as any),
    now: paidAtMillis + CUSTOMER_CANCEL_WINDOW_MS + 1_000,
  });
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.code).toBe('failed-precondition');
});
```

The existing `paidAt: 1_000_000` numeric tests stay passing — both shapes are now accepted.

### §C — No new defensive sweep needed

HOTFIX-1's §C sweep already covered the codebase for sibling Timestamp-vs-number bugs. The findings were:

| File / line | Status | Action |
|---|---|---|
| `customerCancelWindowHelpers.ts:136` (this PR's target) | 🔴 At risk | **Fixed in HOTFIX-2** |
| `index.ts:7055-7056` (getMyProfile createdAt/updatedAt coercion) | 🟡 Data-quality (not gate) | Logged for follow-up |
| Others | 🟢 Safe | No action |

Don't re-run the sweep. Surface in the prompt-completion message if the test suite reveals anything else surprising.

---

## Discipline checklist

1. **Rule 1 — Imports stay.** No new imports needed; the validator works with built-in types only.
2. **Rule 10 — Reads before writes.** N/A (no Firestore writes touched).
3. **Server-first.** Functions deploy ships independently; no client OTA needed. The fix is invisible to the client until the next cancel attempt — at which point it works.
4. **Test discipline.** §B adds 6 tests (more coverage than HOTFIX-1's 4 because cancel-window has more boundary interactions). Suite count should rise by 6.
5. **No schema change, no callable contract change.** Validator return shape is identical; only the input acceptance widens.

---

## Acceptance checklist

Quick — this is the same shape of fix as HOTFIX-1, no production smoke possible until Razorpay restores. Test discipline carries the correctness load here.

**Test suite:**

1. `cd functions && npm run build` — clean
2. `cd functions && npm run test:unit` — all green; suite count +6
3. `npm run test:unit` (root) — unchanged (this is a server-side fix only)
4. `npx tsc --noEmit` clean

**Manual smoke (deferred until Razorpay live):**

5. Once Razorpay is restored: place an online prepaid test order. Within 2 minutes, tap "Cancel order" on `OrderDetailScreen`. Pre-hotfix this returned `failed-precondition: "Order has no paid timestamp"`. Post-hotfix, the order should cancel successfully and trigger the existing refund flow.

6. Boundary regression: tap Cancel at exactly the 2-minute mark — should succeed (inclusive boundary). Tap Cancel at 2:01 — should fail with `"Cancellation window has expired"` (the original message, NOT the Timestamp error).

**Regression — the existing rejection paths still work:**

7. Order without `paidAt` at all (legacy / malformed) → still rejects with `"Order has no paid timestamp"`.
8. Order with `paidAt` numeric and in the future → still rejects with `"Order timestamps invalid"` (clock-skew defense).
9. COD order → still rejects with `"Only paid online orders can be cancelled in-window"`.
10. Order with `status !== 'pending'` → still rejects with the "already X" message.

---

## Deploy plan

Server-only, single function:

```
cd functions
npm run build
firebase deploy --only "functions:cancelMyRecentPaidOrder"
```

Function already has `allUsers` binding (deployed in PR 7). No IAM check needed.

No client OTA required. The client's cancel-order code path is unchanged; it just stops getting rejected by the server.

---

## Doc trail updates after ship

- `docs/TESTING-FINDINGS-2026-05-30.md` — add a sub-note under the §C defensive-sweep section (or wherever HOTFIX-1's mention lives): `paidAt Timestamp-vs-number bug in customerCancelWindowHelpers → ✅ SHIPPED in PR-NEXT-HOTFIX-2 (June 1 2026)`.
- `docs/SESSION_LOG.md` — one-paragraph entry covering the bug-class repetition + the validator widening + the 6 new test cases + the explicit "no new sweep needed" note.
- `CLAUDE.md` — bump date; expand the existing "Lessons" / code-discipline note from HOTFIX-1 to call out that the Timestamp-vs-number pattern has now hit TWICE in the same codebase. Recommend promoting to a numbered code-discipline Rule.
- `.windsurf/code-discipline.md` — **promote this to a real numbered Rule (Rule 12?).** Twice in two days is no longer a "rule of thumb." Suggested text:

  > **Rule 12 — Firestore `Timestamp` reads are NOT plain millis numbers.** Any server-side validator that gates on a server-written timestamp field (`paidAt`, `pickedUpAt`, `deliveredAt`, `createdAt`, `updatedAt`, etc.) MUST normalize via `.toMillis()` (or accept both shapes via the `toMillis()`-narrowing pattern) before the gate check. New validator fields comparing against server timestamps require a Firestore-shape fixture in the test suite, not just a numeric fixture. HOTFIX-1 and HOTFIX-2 both shipped against this bug class; any future validator that does `typeof someTimestampField !== 'number'` is suspect on review.
