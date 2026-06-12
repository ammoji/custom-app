# HOTFIX-REVIEW-DENORM — Review state denormalization gap on order doc

**Source:** Sudhir's 2026-06-10 post-deploy testing. Delivery partner taps "Respond to review", types message, hits Send → server returns "Cannot respond in state 'responded'" error. **This is actually proof HOTFIX-RATING-RESPONSE worked** — the earlier test successfully transitioned the review to `responded`, and now the server correctly rejects a second response. The UX bug is that the Respond button shouldn't have rendered at all once state is `responded`.

Root cause: review state transitions update the source-of-truth review doc but DON'T cascade to the denormalized `correctionState` on the order doc that screens read.

**Same denorm gap explains the customer-side "review is read-only" observation Sudhir flagged earlier.** RatingAmendmentScreen needs `order.correctionState === 'responded'` to show Amend / Acknowledge CTAs. Stale denorm at `flagged_low` → CTAs never appear → looks read-only. **One root cause, two symptoms across roles.**

**Deploy class:** **server-first.** 4 modified callables (`respondToReview`, `amendRating`, `acknowledgeReview`, the 7-day auto-publish cron) → IAM verify → client OTA + backfill script.

## Root cause (verified by Claude before this prompt)

`submitOrderRating` (functions/src/index.ts ~8810) writes denorm correctly:

```ts
const orderPayload: Record<string, unknown> = {
  shopRating,
  correctionState: initReview.state,         // ← written at submit
  publishedReason: ...,
  publishedAt: ...,
  ratingId,
  updatedAt: FieldValue.serverTimestamp(),
};
```

`respondToReview` (functions/src/index.ts ~10295) only updates the review doc:

```ts
await db.doc(`reviews/${ratingId}`).set(
  {
    correctionState: 'responded',
    responseText: responseText.trim().slice(0, 1000),
    responseBy,
    responseAt: nowMs,
  },
  { merge: true },
);
// ← missing: db.doc(`orders/${rev.orderId}`).set({ correctionState: 'responded', responseText, responseAt, responseBy }, { merge: true })
```

Same pattern in `amendRating`, `acknowledgeReview`, and the auto-publish cron — all source-of-truth-only. None denormalize.

Client surfaces affected:
- `DeliveryOrderDetailScreen.tsx:457-503` — reads `order.correctionState`, `order.responseText`, `order.responseAt`, `order.deliveryRating`
- `ShopOrderDetailScreen.tsx:699-720` — same fields for the shop-side rating
- `RatingAmendmentScreen.tsx` (customer) — reads `order.correctionState` to gate Amend/Acknowledge CTAs

All three read stale denorm. Fixing source-of-truth alone isn't enough.

## Autonomous execution authorization

You may run the following without stopping to confirm — execute, report results in the final summary:

- All `Read`, `Grep`, `Glob`, `ls`, `git status`, `git diff` (read-only)
- `npx tsc --noEmit` (root AND `functions/`)
- `npm test`, `npm run test:unit`, `npm run test:full`, `npx jest`
- `cd functions && npm run build`
- File edits to:
  - `functions/src/index.ts` (only the `respondToReview`, `amendRating`, `acknowledgeReview`, and 7-day auto-publish cron blocks)
  - `functions/src/reviewDenormHelpers.ts` (new file — pure helper for the denorm payload shape)
  - `scripts/backfill-review-denorm.ts` (new file)
  - Test files for the above

You MUST stop and ask before:
- Deploy commands (`firebase deploy`, `eas update`, `gcloud …`)
- Running the backfill script (dry-run only without confirmation)
- File deletes
- Editing files NOT in the §-named lists
- Adding NEW Firestore fields beyond the ones listed in the audit table
- Touching `submitOrderRating` (the initial denorm is correct; do not regress)
- Touching ResponseModal or any screen file (this PR is server-only + backfill)

Default posture: **execute, report at end.**

## Schema audit-grep (Rule 5)

```
grep -rn "correctionState\|responseText\|responseAt\|responseBy\|publishedAt\|publishedReason" functions/src
grep -rn "order\.correctionState\|order\.responseText\|order\.responseAt\|order\.responseBy\|order\.publishedAt" src --include="*.tsx"
grep -n "respondToReview\|amendRating\|acknowledgeReview\|autoPublishStaleReviews\|publishStaleReview" functions/src/index.ts
```

| Field | Review doc | Order denorm (current) | Order denorm (target) |
| --- | --- | --- | --- |
| `correctionState` | ✅ written by all transitions | ✅ written at submit only — **STALE** after transitions | ✅ written by every transition (this PR) |
| `responseText` | ✅ written by respondToReview | ❌ never written to order | ✅ written by respondToReview |
| `responseAt` | ✅ written by respondToReview | ❌ never written to order | ✅ written by respondToReview |
| `responseBy` | ✅ written by respondToReview | ❌ never written to order | ✅ written by respondToReview |
| `publishedAt` | ✅ written when state → published | ✅ written at submit (if initial state was published) | ✅ updated on transition → published |
| `publishedReason` | ✅ written by all transitions to published | ✅ written at submit only — **STALE** | ✅ updated on transition → published |
| `shopRating` / `deliveryRating` | ✅ source of truth | ✅ written at submit | ✅ updated by amendRating when stars change |

No NEW fields are added — every field listed above already exists in the schema. This PR closes denormalization gaps in EXISTING fields only.

## Plan

### §A — Pure helper for the denorm payload

Create `functions/src/reviewDenormHelpers.ts`:

```ts
/**
 * HOTFIX-REVIEW-DENORM — pure helper that produces the per-order
 * denormalization payload from a review-doc state transition.
 *
 * Why a helper: the same denorm logic must run from 4 different
 * callables (respondToReview, amendRating, acknowledgeReview, the
 * 7-day auto-publish cron) and the previous "let each callable
 * roll its own object" pattern is exactly how submitOrderRating's
 * correct denorm got mirrored only there.
 *
 * Rule 14 — discriminated-union Result so the caller can branch on
 * shape rather than checking field presence.
 *
 * Pinned by tests/functions/reviewDenormHelpers.test.ts.
 */
import { FieldValue } from 'firebase-admin/firestore';

export type ReviewCorrectionState =
  | 'submitted'
  | 'flagged_low'
  | 'responded'
  | 'amended'
  | 'published';

export type ReviewDenormInput = {
  nextState: ReviewCorrectionState;
  nowMs: number;
  // Optional fields populated by specific transitions.
  responseText?: string;
  responseBy?: 'shop' | 'partner';
  responseAt?: number;
  newShopStars?: number;
  newDeliveryStars?: number;
  publishedReason?: 'above_threshold' | 'shop_responded' | 'customer_amended' | 'customer_acknowledged' | 'timeout' | null;
};

export type ReviewDenormPayload = Record<string, unknown>;

/**
 * Build the Firestore merge payload to write onto orders/{orderId}
 * mirroring the new review state. Caller invokes:
 *
 *   await db.doc(`orders/${orderId}`).set(
 *     buildOrderReviewDenormPayload(input),
 *     { merge: true },
 *   );
 *
 * Always includes `correctionState` and `updatedAt`. Conditionally
 * includes response fields, stars, published metadata.
 */
export function buildOrderReviewDenormPayload(
  input: ReviewDenormInput,
): ReviewDenormPayload {
  const payload: ReviewDenormPayload = {
    correctionState: input.nextState,
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (input.responseText !== undefined) payload.responseText = input.responseText;
  if (input.responseBy !== undefined) payload.responseBy = input.responseBy;
  if (input.responseAt !== undefined) payload.responseAt = input.responseAt;
  if (input.newShopStars !== undefined) payload.shopRating = input.newShopStars;
  if (input.newDeliveryStars !== undefined) payload.deliveryRating = input.newDeliveryStars;
  if (input.nextState === 'published') {
    payload.publishedAt = input.nowMs;
    payload.publishedReason = input.publishedReason ?? null;
  }
  return payload;
}
```

### §B — `respondToReview` denorm cascade

`functions/src/index.ts` `respondToReview` callable (~line 10295). Immediately after the review-doc write succeeds:

```ts
await db.doc(`reviews/${ratingId}`).set(
  {
    correctionState: 'responded',
    responseText: responseText.trim().slice(0, 1000),
    responseBy,
    responseAt: nowMs,
  },
  { merge: true },
);

// HOTFIX-REVIEW-DENORM — cascade to order denorm so client screens
// reading order.correctionState transition correctly. Without this,
// the Respond button stays rendered on delivery/shop OrderDetail
// after a successful response, and the customer's Amend/Acknowledge
// CTAs never appear on RatingAmendmentScreen.
await db.doc(`orders/${rev.orderId}`).set(
  buildOrderReviewDenormPayload({
    nextState: 'responded',
    nowMs,
    responseText: responseText.trim().slice(0, 1000),
    responseBy,
    responseAt: nowMs,
  }),
  { merge: true },
);
```

Import the helper at top of file (with the DO-NOT-REMOVE comment).

### §C — `amendRating` denorm cascade

`functions/src/index.ts` `amendRating` callable (~line 10350). After the review doc write that transitions state to `amended` then to `published`:

```ts
await db.doc(`orders/${rev.orderId}`).set(
  buildOrderReviewDenormPayload({
    nextState: 'published',  // amend always ends in published
    nowMs,
    newShopStars,
    newDeliveryStars,
    publishedReason: 'customer_amended',
  }),
  { merge: true },
);
```

The shop / partner rolling averages also need to recompute since stars changed — that's existing logic; don't touch it. Only ADD the order denorm write.

### §D — `acknowledgeReview` denorm cascade

`functions/src/index.ts` `acknowledgeReview` callable (~line 10420). After the review doc transitions to `published`:

```ts
await db.doc(`orders/${rev.orderId}`).set(
  buildOrderReviewDenormPayload({
    nextState: 'published',
    nowMs,
    publishedReason: 'customer_acknowledged',
  }),
  { merge: true },
);
```

### §E — 7-day auto-publish cron denorm cascade

`functions/src/index.ts` find the scheduled function or trigger that publishes stale reviews (`grep -n "autoPublishStaleReviews\|publishStale\|timeoutPublish\|decideTimeoutPublish" functions/src/index.ts`). Inside the loop that flips each stale review to `published`, also write the order denorm:

```ts
await db.doc(`orders/${rev.orderId}`).set(
  buildOrderReviewDenormPayload({
    nextState: 'published',
    nowMs: Date.now(),
    publishedReason: 'timeout',
  }),
  { merge: true },
);
```

### §F — Backfill script for already-stale orders

Create `scripts/backfill-review-denorm.ts`:

```ts
/**
 * HOTFIX-REVIEW-DENORM — one-shot backfill that re-syncs every
 * order's denormalized review fields from the source-of-truth
 * review doc. Idempotent (set merge:true). Same safety scaffold
 * as scripts/reset-keep-catalog.ts:
 *   - service-account.json credential init
 *   - project allowlist (grocery-mvp-dev only)
 *   - dry-run default; --execute to write
 *   - --admin-uid=<uid> required
 *
 * Walks reviews, joins to orders by orderId, writes denorm payload
 * derived from review doc state via buildOrderReviewDenormPayload.
 */
```

Mirror the credential init + safety pattern from `scripts/reset-keep-catalog.ts` (Sudhir already verified this pattern works). Logic:

1. For each review doc:
   - Read `correctionState`, `responseText`, `responseBy`, `responseAt`, `shopStars`, `deliveryStars`, `publishedAt`, `publishedReason`
   - Build denorm payload (use `buildOrderReviewDenormPayload`)
   - `set merge:true` onto `orders/{review.orderId}`
2. Counts: orders touched, orders skipped (no review found — already correct from submit), orders mismatched (review state differs from order state — these are the bugs being closed).
3. Dry-run prints the planned writes; `--execute` actually performs them.

### §G — Tests

Pin **+10 tests** total:
- **+5 on the helper** — `buildOrderReviewDenormPayload`:
  - State `responded` with response fields → payload includes them
  - State `published` with `publishedReason: 'customer_amended'` → publishedAt + publishedReason set
  - State `published` with `publishedReason: 'timeout'` → same shape, different reason
  - Amend with `newShopStars` → payload includes shopRating
  - Empty input (only `nextState` + `nowMs`) → only correctionState + updatedAt
- **+4 integration-style on the callables** (extend existing test files where possible):
  - After `respondToReview` succeeds, mock order doc gets `correctionState: 'responded'` write
  - After `amendRating` succeeds, mock order doc gets `correctionState: 'published'` + new stars
  - After `acknowledgeReview` succeeds, mock order doc gets `correctionState: 'published'`
  - Auto-publish cron updates mock order doc for each stale review processed
- **+1 backfill helper** — `deriveDenormFromReview(review)` returns the same payload as if the review had been freshly transitioned. Used by §F.

## Discipline checklist

1. **Rule 1** — every new import / call carries "HOTFIX-REVIEW-DENORM — DO NOT REMOVE" comments.
2. **Rule 2** — N/A (no new screens / hooks).
3. **Rule 5** — schema audit-grep table in header. **New worked example #6 for the discipline notes:** *"When source-of-truth state transitions, every denormalized copy on related docs must be updated in the same transaction (or at minimum the same callable). The `submitOrderRating` denorm at submit was correct but became a one-shot rather than a pattern — every state-transition callable downstream needs the same discipline. Audit-grep `correctionState\|publishedAt` should match write locations across ALL callables that transition the review."*
4. **Rule 7** — auth.token shape unchanged.
5. **Rule 8** — FEATURES.md update in Doc trail. Lineage on Customer §1.9, Shop §2.5, Delivery §3.8 review rows.
6. **Rule 11** — IAM verify on `respondToReview`, `amendRating`, `acknowledgeReview` (3 modified callables). The auto-publish cron is a scheduled function (no Cloud Run service unless it's wrapped — verify and only IAM-verify if applicable).
7. **Rule 13** — N/A.
8. **Rule 14** — server-side helper returns Result-shaped payload.
9. **Schema-additive** — zero new fields. This PR closes denormalization gaps in existing fields only.
10. **Test discipline:** **+10 tests minimum.** Suite ~1502 → ~1512.

## Acceptance checklist

1. As delivery partner, view OrderDetail for an order in `flagged_low` state → see Respond button → tap → type → Send → modal dismisses → screen immediately re-renders showing "Your response: …" + "Waiting on customer · 7 days left". No second Respond button.
2. As shop owner, same flow for shop-rating responses → same successful transition.
3. As customer, after partner/shop has responded, open RatingAmendmentScreen → **Amend** and **Acknowledge** CTAs are visible. Tap Amend → update stars → save → see "Review published — N★ with their response" on next OrderDetail open.
4. As customer, after response, tap Acknowledge → review publishes → OrderDetail shows "✅ Review published — N★ with their response".
5. 7-day auto-publish cron runs against a fixture review still in `flagged_low` after 8 days → both review doc AND order doc transition to `published` with `publishedReason: 'timeout'`.
6. **Backfill verification:** before running, find one order with stale denorm (review = `responded`, order = `flagged_low`). After dry-run, confirm it's listed as a planned write. After `--execute`, confirm order doc now matches review doc. Idempotent — running twice produces no second write.
7. As delivery partner who already responded successfully, view same OrderDetail again → NO Respond button. Shows "Your response: …" block. Tapping anywhere doesn't open the modal.
8. **Cloud Run IAM** verify on the 3 modified callables. Re-bind `allUsers` if any return `etag: ACAB`.
9. `tsc` + tests clean. Suite +10 minimum.
10. **Deliberate-break demo:** remove the `respondToReview` order denorm write from §B. Re-run integration tests for §G. The "after respondToReview, order doc gets correctionState: 'responded' write" test must fail. Restore. Tests pass.

## Out of scope

- Migrating away from denormalization to live-fetch from the review doc on screen mount. Denorm is the correct pattern for read scale; this PR fixes the cascade discipline, not the architecture.
- Customer-side "show partner's photo on the response" — already covered by Bundle G §D; verify it still works after this PR but no new work needed.
- Adding a "Modify response" affordance for shop/partner after already responding. Single-response design is intentional (PR-5.1 §C); customer's Amend/Acknowledge is the next-step flow.
- Multi-back-and-forth threading (already declared out of scope in Bundle E).

## Deploy

```
cd functions; npm run build; cd ..
firebase deploy --only "functions:respondToReview,functions:amendRating,functions:acknowledgeReview,functions:autoPublishStaleReviews"
# (Substitute the correct exported name for the auto-publish cron if it differs — verify via grep.)

foreach ($svc in 'respondtoreview','amendrating','acknowledgereview') {
  gcloud run services get-iam-policy $svc --region=asia-south1 --project=grocery-mvp-dev
}
# Auto-publish cron is a scheduled function — no Cloud Run service to verify.

# Backfill — dry run first, then execute
npx tsx scripts/backfill-review-denorm.ts
npx tsx scripts/backfill-review-denorm.ts --execute --admin-uid=<sudhir-admin-uid>

eas update --branch production --message "HOTFIX-REVIEW-DENORM — cascade review state transitions to order denorm"
```

## Doc trail (Cowork)

After ship:

- **TESTING-FINDINGS** — close the delivery-partner "Cannot respond in state 'responded'" error AND the customer-side review read-only observation (both root-caused to this denorm gap).
- **CLAUDE.md** In-flight strike. Note the four-layer photo saga (HOTFIX-PROFILE-PHOTO 1-4) and the review-denorm cascade as the two big closes from this testing wave.
- **SESSION_LOG** paragraph capturing: HOTFIX-RATING-RESPONSE worked (server gate correct) BUT exposed a downstream denorm gap that masked the success — fix is HOTFIX-REVIEW-DENORM. One root cause closed two role-side symptoms.
- **PROMPT_AUTHORING_NOTES** — add **Rule 5 worked example #6 (denormalization cascade):** *"When source-of-truth state transitions, every denormalized copy on related docs must be updated in the same callable. Audit-grep should match write locations across all callables that transition the source — not just the one that initialised the denorm."* Pair this with worked example #3 (static-source guard) — denorm cascade is the next institutional guard candidate (a CI test that asserts every review-state callable writes to BOTH review AND order docs).
- **FEATURES.md** (per Rule 8 — mandatory):
  - **Customer panel §1.9 Ratings & reviews** — "Low-rating correction workflow" row: lineage HTML comment `<!-- HOTFIX-REVIEW-DENORM 2026-06-10 -->`. No description change (feature now works end-to-end).
  - **Shop panel §2.5 Reviews** — "Respond to low rating" row: same lineage comment.
  - **Delivery panel §3.8 Reviews** — "Respond to low rating" row: same lineage comment.
  - **Cross-cutting §5.9 Operational scripts** — ADD new row: `backfill-review-denorm | One-shot — re-syncs orders/{orderId} denorm fields from source-of-truth reviews/{ratingId} | HOTFIX-REVIEW-DENORM | shipped`.
  - **Last updated** stamps on Customer §1.9, Shop §2.5, Delivery §3.8, Cross-cutting §5.9 → 2026-06-10.
