# HOTFIX-PUBLISH-TX-ORDER — Firestore transaction reads-must-precede-writes violation in _publishReview

**Source:** Sudhir's 2026-06-10 post-Bundle-H retest. Customer taps "Amend my rating" or "Acknowledge" on RatingAmendmentScreen → server returns `INTERNAL` → Alert: "Could not update — INTERNAL". Blocks the entire customer-side correction loop Bundle H just shipped.

**Deploy class:** **server-first.** 3 modified callables (`amendRating`, `acknowledgeReview`, `publishTimedOutReviews`) all route through the same `_publishReview` helper at `functions/src/index.ts:10190`. One fix covers all three.

## Root cause (verified by Claude before this prompt)

Firestore transaction rule: **all reads must come before all writes** inside a `runTransaction` body. Violation throws and surfaces as `INTERNAL` to the client.

`_publishReview` currently structures its transaction as:

```ts
await db.runTransaction(async tx => {
  tx.set(reviewRef, reviewPatch, { merge: true });   // WRITE 1
  tx.set(orderRef, denormPayload, { merge: true });  // WRITE 2 — HOTFIX-REVIEW-DENORM added this
  tx.set(shopRef, shopPatch, { merge: true });       // WRITE 3
  
  if (deliveryPersonId && finalDeliveryStars !== null) {
    const partnerSnap = await tx.get(db.doc(`users/${deliveryPersonId}`));  // READ AFTER WRITE — VIOLATION
    // ...
    tx.set(partnerRef, partnerPatch, { merge: true });
  }
});
```

The shop doc is read OUTSIDE the transaction (line ~10220, `const shopSnap = await db.doc(\`shops/${shopId}\`).get()`) — that read is correct but provides no transactional consistency guarantee for the shop write.

**Why it slipped past tests:** Devin's HOTFIX-REVIEW-DENORM tests mocked the Firestore transaction wrapper without enforcing the read/write ordering invariant. The bug was latent before that PR too (partner read was already after the review write), but Bundle G + REVIEW-DENORM each added a tx.set BEFORE the partner read, making the dependency stack worse.

**Why it only surfaces now:** The `tx.get(partnerRef)` is gated on `deliveryPersonId && finalDeliveryStars !== null`. For an amend/acknowledge on a review that included a delivery rating with an assigned partner — like Sudhir's test order — the branch fires. Reviews with no delivery rating skip this branch and don't trip the violation.

## Autonomous execution authorization

You may run the following without stopping to confirm — execute, report results in the final summary:

- All `Read`, `Grep`, `Glob`, `ls`, `git status`, `git diff` (read-only)
- `npx tsc --noEmit` (root AND `functions/`)
- `npm test`, `npm run test:unit`, `npm run test:full`, `npx jest`
- `cd functions && npm run build`
- File edits to:
  - `functions/src/index.ts` (only the `_publishReview` function, lines ~10190 to ~10260)
  - `tests/functions/reviewWorkflow.test.ts` (or wherever the existing amendRating/acknowledgeReview tests live — grep for it)
  - One new emulator-class test file if the existing ones don't run against the Firestore emulator

You MUST stop and ask before:
- Deploy commands (`firebase deploy`, `eas update`, `gcloud …`)
- Editing files NOT listed above
- Changing the callable signatures or shape returned by `amendRating`/`acknowledgeReview`/`publishTimedOutReviews`
- Schema additions

Default posture: **execute, report at end.**

## Schema audit-grep (Rule 5)

```
grep -n "_publishReview\|tx.get\|tx.set\|runTransaction" functions/src/index.ts
grep -rn "reads must precede writes\|readsBeforeWrites\|Read after write" functions/src tests
```

| Symbol | Current location | Notes |
| --- | --- | --- |
| `_publishReview` | functions/src/index.ts:10190 | Single entry point for all three publish paths; one fix covers all |
| Shop doc read | line ~10220, OUTSIDE transaction | Should move INTO transaction for proper conflict detection |
| Partner doc `tx.get` | line ~10262, INSIDE transaction AFTER 3 writes | Must move to top of transaction |
| Review doc read | already happens earlier as `db.doc('reviews/X').get()` outside transaction | Pure read — keep as-is for now (separate concern) |

## Plan

### §A — Restructure `_publishReview` transaction body

The transaction must follow strict three-phase shape: **read phase → compute phase → write phase.** No reads after writes, no interleaving.

```ts
async function _publishReview(args: {
  ratingId: string;
  newShopStars?: number;
  newDeliveryStars?: number;
  reason: 'customer_amended' | 'customer_acknowledged' | 'timeout';
  nowMs: number;
}): Promise<void> {
  const reviewSnap = await db.doc(`reviews/${args.ratingId}`).get();
  if (!reviewSnap.exists) {
    throw new HttpsError('not-found', 'Review not found');
  }
  const rev = reviewSnap.data() as Record<string, any>;
  const shopId: string = rev.shopId;
  const deliveryPersonId: string | null = rev.deliveryPersonId ?? null;
  const finalShopStars: number = args.newShopStars ?? rev.shopStars;
  const finalDeliveryStars: number | null =
    args.newDeliveryStars ?? rev.deliveryStars ?? null;
  const publishedAt = args.nowMs;

  // HOTFIX-PUBLISH-TX-ORDER — DO NOT REMOVE. Firestore transactions
  // require ALL reads before ANY writes. Previously the shop doc was
  // read outside the transaction (no conflict detection) and the
  // partner doc was tx.get'd AFTER three tx.set calls (INTERNAL error).
  // Both reads now happen inside the transaction prelude.
  await db.runTransaction(async tx => {
    // ─── READ PHASE ─────────────────────────────────────────────
    const shopRef = db.doc(`shops/${shopId}`);
    const partnerRef = deliveryPersonId
      ? db.doc(`users/${deliveryPersonId}`)
      : null;

    const shopSnap = await tx.get(shopRef);
    const partnerSnap =
      partnerRef && finalDeliveryStars !== null
        ? await tx.get(partnerRef)
        : null;

    // ─── COMPUTE PHASE ─────────────────────────────────────────
    const shopData = shopSnap.exists ? (shopSnap.data() as Record<string, any>) : {};
    const partnerData =
      partnerSnap?.exists ? (partnerSnap.data() as Record<string, any>) : {};

    const reviewPatch: Record<string, unknown> = {
      correctionState: 'published',
      publishedAt,
      publishedReason: args.reason,
    };
    if (args.newShopStars !== undefined) reviewPatch.shopStars = args.newShopStars;
    if (args.newDeliveryStars !== undefined) reviewPatch.deliveryStars = args.newDeliveryStars;

    const shopCacheEntry = {
      ratingId: args.ratingId,
      stars: finalShopStars,
      comment: rev.shopComment ?? null,
      customerName: rev.customerName ?? null,
      publishedAt,
      responseText: rev.responseText ?? null,
    };

    const existingLatest: any[] = Array.isArray(shopData.publicReviewLatest)
      ? shopData.publicReviewLatest
      : [];
    const newLatest = [
      shopCacheEntry,
      ...existingLatest.filter((r: any) => r.ratingId !== args.ratingId),
    ]
      .sort((a: any, b: any) => b.publishedAt - a.publishedAt)
      .slice(0, 5);

    const shopPublicDelta = computePublicCountDelta(
      rev.correctionState as any,
      'published',
    );

    let partnerNewLatest: any[] | null = null;
    let partnerPublicDelta = 0;
    if (partnerRef && finalDeliveryStars !== null) {
      const partnerCacheEntry = {
        ...shopCacheEntry,
        stars: finalDeliveryStars,
        comment: rev.deliveryComment ?? null,
      };
      const partnerLatest: any[] = Array.isArray(partnerData.publicReviewLatest)
        ? partnerData.publicReviewLatest
        : [];
      partnerNewLatest = [
        partnerCacheEntry,
        ...partnerLatest.filter((r: any) => r.ratingId !== args.ratingId),
      ]
        .sort((a: any, b: any) => b.publishedAt - a.publishedAt)
        .slice(0, 5);
      partnerPublicDelta = computePublicCountDelta(
        rev.correctionState as any,
        'published',
      );
    }

    // ─── WRITE PHASE ─────────────────────────────────────────
    tx.set(db.doc(`reviews/${args.ratingId}`), reviewPatch, { merge: true });

    tx.set(
      db.doc(`orders/${rev.orderId}`),
      buildOrderReviewDenormPayload({
        nextState: 'published',
        nowMs: publishedAt,
        publishedReason: args.reason,
        ...(args.newShopStars !== undefined ? { newShopStars: args.newShopStars } : {}),
        ...(args.newDeliveryStars !== undefined ? { newDeliveryStars: args.newDeliveryStars } : {}),
      }),
      { merge: true },
    );

    tx.set(
      shopRef,
      {
        publicReviewCount: FieldValue.increment(1),
        publicReviewLatest: newLatest,
        ...(shopPublicDelta > 0
          ? { publicRatingCount: FieldValue.increment(shopPublicDelta) }
          : {}),
      },
      { merge: true },
    );

    if (partnerRef && partnerNewLatest !== null) {
      tx.set(
        partnerRef,
        {
          publicReviewCount: FieldValue.increment(1),
          publicReviewLatest: partnerNewLatest,
          ...(partnerPublicDelta > 0
            ? { publicDeliveryRatingCount: FieldValue.increment(partnerPublicDelta) }
            : {}),
        },
        { merge: true },
      );
    }
  });
}
```

Key changes vs current code:
1. Both `shopSnap` and `partnerSnap` read at the **top** of the transaction body via `tx.get`
2. All computes happen between reads and writes
3. All `tx.set` calls happen last, grouped together
4. Shop doc read is removed from outside the transaction (was line ~10220)

### §B — Pure helper extraction (optional but recommended)

The compute phase is heavy — extract `buildPublishReviewWrites(opts)` as a pure helper in `functions/src/publishReviewWritesHelpers.ts` returning `{ reviewPatch, orderPayload, shopWrite, partnerWrite? }`. Lets us unit-test the math without booting firebase-admin.

If extraction adds friction without immediate test value, skip §B and keep the logic inline. Discretion.

### §C — Emulator integration test

The unit tests on the existing helper pin the math but missed the transaction shape. Add an integration test that runs against the Firestore emulator:

`tests/functions/_publishReview.emulator.test.ts`:

```ts
/**
 * HOTFIX-PUBLISH-TX-ORDER — emulator-class test that catches the
 * Firestore "reads must precede writes" violation. Mocked unit tests
 * don't enforce this invariant; only a real (or emulated) Firestore
 * does. Without this test the bug class can reship.
 */

describe('_publishReview emulator', () => {
  beforeAll(async () => {
    // Connect to running Firestore emulator on default port.
  });

  it('publishes a review WITH a delivery partner without throwing INTERNAL', async () => {
    // Setup: seed review in flagged_low + responded state, with deliveryPersonId
    // Act: invoke _publishReview via amendRating callable
    // Assert: review doc shows correctionState === 'published', order doc denorm updated,
    //         shop doc has publicReviewCount incremented, partner doc has same
    //         No transaction error thrown.
  });

  it('publishes a review WITHOUT a delivery partner', async () => {
    // Setup: review with deliveryPersonId === null
    // Act + Assert: same as above minus partner side
  });

  it('amendRating + acknowledgeReview + publishTimedOutReviews all route through cleanly', async () => {
    // Three orders, three different paths, all publish without error.
  });
});
```

Pin **+3 emulator tests minimum.**

Also extend the existing unit tests to assert read ordering inside the transaction body using a mock tx with read-tracking. **+2 unit tests** for the ordering invariant.

### §D — Static-source guard for transaction shape

Add `tests/static/transactionReadOrderAudit.test.ts`:

```ts
/**
 * HOTFIX-PUBLISH-TX-ORDER — static guard that any function containing
 * `runTransaction` does NOT have a `tx.get` after a `tx.set` in the
 * same function body. Regex-based; checks structural ordering, not
 * exhaustive semantic validity.
 *
 * Companion to authClaimNamesAudit.test.ts from Bundle G.
 */

import { readFileSync } from 'fs';
import { glob } from 'glob';

describe('Firestore transaction read-order audit', () => {
  it('all runTransaction bodies have reads before writes', async () => {
    const files = await glob('functions/src/**/*.ts');
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      // For each runTransaction body, extract and check ordering.
      // Implementation: regex match `runTransaction\s*\(\s*async\s+tx\s*=>\s*\{([\s\S]*?)\}\s*\)`,
      // then within each body, check that no `tx\.get\(` appears after a `tx\.set\(`
      // or `tx\.update\(` or `tx\.delete\(`.
      // ... assertion ...
    }
  });
});
```

Pin **+1 static-source guard test.** Third permanent guard after `authClaimNamesAudit` (Bundle G) and `noStaleDeferralComments` (Bundle H).

## Discipline checklist

1. **Rule 1** — every restructure carries "HOTFIX-PUBLISH-TX-ORDER — DO NOT REMOVE" comments.
2. **Rule 2** — N/A (no new hooks).
3. **Rule 5** — schema audit-grep in header. **Worked example #8 for the discipline notes:** *"Firestore transactions have a hard structural rule (reads before writes). Mocked unit tests can't enforce it; only emulator-class integration tests or static-source guards can. This bug was latent through 3 prior PRs (Bundle G, HOTFIX-REVIEW-DENORM, Bundle H) — each added a write but no read — making it worse with every iteration."*
4. **Rule 7** — auth.token shape unchanged.
5. **Rule 8** — FEATURES.md update in Doc trail. No row change; lineage HTML comment.
6. **Rule 11** — IAM verify on `amendRating`, `acknowledgeReview`. 2 services. `publishTimedOutReviews` is scheduled — no Cloud Run service.
7. **Rule 13** — N/A.
8. **Rule 14** — N/A.
9. **Schema-additive** — zero schema changes.
10. **Test discipline:** §C +3 emulator + +2 unit + §D +1 static = **+6 tests minimum.** Suite ~1535 → ~1541.

## Acceptance checklist

1. As customer, view OrderDetail in `responded` state → tap "Amend my rating" → RatingAmendmentScreen opens → select new stars → tap "Update to N★" → **success.** Review publishes. No INTERNAL error.
2. Same flow with "Acknowledge" CTA → review publishes with original stars + response. No INTERNAL error.
3. Repeat both flows on a review that has **delivery partner rating** (the failing case from Sudhir's screenshot). Both succeed.
4. Repeat both flows on a review WITHOUT a delivery partner. Both succeed.
5. 7-day auto-publish cron — invoke against a fixture review still in `flagged_low` after 8 days → both review AND order doc transition cleanly. No errors.
6. After amend: confirm shop's `publicRatingCount` incremented by 1, `publicReviewLatest` updated. Same for partner doc when delivery rating was amended.
7. **Cloud Run IAM** verify on `amendRating`, `acknowledgeReview`. Re-bind `allUsers` if `etag: ACAB`.
8. `tsc` + tests clean. Suite +6 minimum.
9. **Deliberate-break demo:** move `tx.get(partnerRef)` back below the `tx.set(reviewRef)`. Emulator integration test must fail with the Firestore "reads precede writes" error. Static guard from §D must also fail. Restore both. Tests pass.

## Out of scope

- **Backfilling reviews that failed amend/ack during the broken window.** None exist — Sudhir's tap returned INTERNAL without persisting state, so no half-applied data.
- **Refactor `_publishReview` into smaller functions** beyond §B's optional helper extraction. Scope creep.
- **Adding emulator infrastructure if it doesn't already exist** in this repo. If `npm run test:full` already boots an emulator (per CLAUDE.md "test:full adds rules tests against the emulator"), reuse it. If not, the emulator test in §C becomes a stretch goal — the unit tests with read-tracking in §C alternative form + the static guard in §D are sufficient minimum.

## Deploy

```
cd functions; npm run build; cd ..
firebase deploy --only "functions:amendRating,functions:acknowledgeReview,functions:publishTimedOutReviews"

foreach ($svc in 'amendrating','acknowledgereview') {
  gcloud run services get-iam-policy $svc --region=asia-south1 --project=grocery-mvp-dev
}
# publishTimedOutReviews is scheduled — no Cloud Run service.

eas update --branch production --message "HOTFIX-PUBLISH-TX-ORDER — Firestore reads-precede-writes fix in _publishReview"
```

No client changes — the callable signatures and response shapes are unchanged. Existing client code works unmodified.

## Doc trail (Cowork)

After ship:

- **TESTING-FINDINGS** — close the Bundle H amend/ack INTERNAL error.
- **CLAUDE.md** In-flight strike.
- **SESSION_LOG** paragraph capturing: Firestore transaction structural rule violation latent across 3 PRs, exposed by Bundle H finally surfacing the customer-side correction loop. Lesson: mocked unit tests can't enforce transaction structural rules; static guards + emulator tests are the right institutional fix.
- **PROMPT_AUTHORING_NOTES** — add **Rule 5 worked example #8** (Firestore transaction structural rule + emulator-class testing). Static-source guard list is now four entries: authClaimNames + noStaleDeferralComments + transactionReadOrder + (anticipated future ones).
- **FEATURES.md** (per Rule 8 — mandatory):
  - **Customer panel §1.9 Ratings & reviews** — lineage HTML comment `<!-- HOTFIX-PUBLISH-TX-ORDER 2026-06-10 -->` on the "Low-rating correction workflow" row. No description change.
  - **Last updated** stamp on §1.9 → 2026-06-10.
