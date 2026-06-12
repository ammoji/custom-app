# HOTFIX-ATTENTION-CALLABLES-MISSING — Implement the Bundle I attention queue callables that never shipped

**Source:** Sudhir's 2026-06-10 post-Bundle-J retest. Customer rates shop 1★ + delivery 1★ → both push notifications fire → opening the order directly shows Respond button (works) → **but the "Reviews & Ratings" card on both dashboards shows count = 0.**

## Root cause (verified by Claude before this prompt)

**Bundle I §D/§E callables were reported shipped but were never actually implemented.** The helper `summarizeAttentionReviewRows` and the type `AttentionReviewRow` both exist, but the callables that would use them — `listMyAttentionReviews` and `listShopAttentionReviews` — were never written. Neither were the client wrappers in `orderService.ts`.

Audit-grep results that proved this:
- `grep "export const listMy\|export const listShop" functions/src/index.ts` — only `listMyEarnings`, `listMyDeliveries`, etc. exist. Nothing matching `listMyAttentionReviews` or `listShopAttentionReviews`.
- `grep "async listMy\|async listShop" src/services/orderService.ts` — only `listMyEarnings`, `listMyShopMenu`, `listShopReviews`, etc. Nothing matching attention.
- Client surfaces calling these methods (`DeliveryDashboardScreen:320`, `ShopOwnerDashboardScreen:218`, `AttentionQueueScreen:43-44`) all use `.catch(() => { /* silent */ })`. Calling a missing method throws `TypeError: ... is not a function` synchronously inside the Promise chain → caught silently → empty array → count = 0.

Bundle J §G said the callables would be migrated to per-dimension filters (`deliveryCorrectionState`, `shopCorrectionState`). Since they don't exist, this HOTFIX implements them **directly per Bundle J §G spec** — skipping the legacy state transition.

**Deploy class:** **server-first.** 2 new callables + client wrappers + verify/add per-dimension composite indexes → IAM verify → client OTA.

## Autonomous execution authorization

You may run the following without stopping to confirm — execute, report results in the final summary:

- All `Read`, `Grep`, `Glob`, `ls`, `git status`, `git diff` (read-only)
- `npx tsc --noEmit` (root AND `functions/`)
- `npm test`, `npm run test:unit`, `npx jest`
- `cd functions && npm run build`
- File edits to:
  - `functions/src/index.ts` (add two new exports near the existing Bundle I §D/§E import block at line ~266)
  - `src/services/orderService.ts` (add two new methods near the existing `AttentionReviewRow` type at line ~38)
  - `firestore.indexes.json` (verify, add missing per-dimension indexes)
  - `functions/src/attentionReviewHelpers.ts` (update filter to per-dimension per Bundle J §G)
  - Test files for the above

You MUST stop and ask before:
- Deploy commands (`firebase deploy`, `eas update`, `gcloud …`)
- Editing files NOT listed above
- Schema additions or new Firestore doc fields
- Touching `submitOrderRating`, `respondToReview`, `amendRating`, `_publishReview` (already correct post-Bundle-J)

Default posture: **execute, report at end.**

## Schema audit-grep (Rule 5)

```
grep -n "export const list" functions/src/index.ts | head -25
grep -n "async listMy\|async listShop" src/services/orderService.ts | head -15
grep -n "deliveryCorrectionState\|shopCorrectionState" firestore.indexes.json
grep -n "AttentionReviewRow\|summarizeAttentionReviewRows" functions/src src
```

| Symbol | Expected location | Notes |
| --- | --- | --- |
| `listMyAttentionReviews` callable | `functions/src/index.ts` — should join the `export const list*` block | NEW — implement per §A |
| `listShopAttentionReviews` callable | same | NEW — implement per §B |
| `orderService.listMyAttentionReviews()` wrapper | `src/services/orderService.ts` near the AttentionReviewRow type | NEW — §C |
| `orderService.listShopAttentionReviews()` wrapper | same | NEW — §C |
| `(deliveryPersonId, deliveryCorrectionState, updatedAt)` composite index | `firestore.indexes.json` | Verify exists — §D |
| `(shopId, shopCorrectionState, updatedAt)` composite index | `firestore.indexes.json` | Verify exists — §D |
| `summarizeAttentionReviewRows` filter | `functions/src/attentionReviewHelpers.ts:24` currently `correctionState === 'flagged_low'` | Update to per-dimension per Bundle J §G — §E |

## Plan

### §A — Implement `listMyAttentionReviews` server callable

`functions/src/index.ts` — add near the existing `listMyEarnings` callable (line ~10095) or anywhere in the `export const list*` block:

```ts
/**
 * HOTFIX-ATTENTION-CALLABLES-MISSING §A — DO NOT REMOVE.
 * Bundle I §D + Bundle J §G compliant. Lists this delivery partner's
 * orders with deliveryCorrectionState === 'flagged_low' (per-dimension
 * post-Bundle-J). Composite index required: (deliveryPersonId,
 * deliveryCorrectionState, updatedAt).
 *
 * Previously reported shipped in Bundle I but the export never
 * actually landed — client wrappers in orderService.ts also missing.
 * This HOTFIX implements the originally-spec'd shape.
 */
export const listMyAttentionReviews = onCall(
  { cors: true, enforceAppCheck: false, region: 'asia-south1' },
  async request => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in required');
    const claims = (request.auth?.token ?? {}) as Record<string, unknown>;
    if (claims.delivery !== true) {
      throw new HttpsError('permission-denied', 'Delivery partner role required');
    }

    const snap = await db
      .collection('orders')
      .where('deliveryPersonId', '==', uid)
      .where('deliveryCorrectionState', '==', 'flagged_low')
      .orderBy('updatedAt', 'desc')
      .limit(50)
      .get();

    const docs = snap.docs.map(d => ({ id: d.id, data: d.data() }));
    return { rows: summarizeAttentionReviewRows(docs) };
  },
);
```

Notes:
- Uses `claims.delivery` (auth-token shape per HOTFIX-RATING-RESPONSE — the static guard catches `claims.isDelivery`).
- Returns `{ rows: [...] }` — client wrapper unwraps to plain array. Match the pattern of other `list*` callables (most return the array directly; pick whichever matches existing convention in this codebase).

### §B — Implement `listShopAttentionReviews` server callable

Same shape, different gate:

```ts
/**
 * HOTFIX-ATTENTION-CALLABLES-MISSING §B — DO NOT REMOVE.
 * Bundle I §E + Bundle J §G compliant. Lists this shop owner's orders
 * with shopCorrectionState === 'flagged_low' (per-dimension post-Bundle-J).
 * Composite index required: (shopId, shopCorrectionState, updatedAt).
 *
 * Auth: looks up caller's shop via direct shops/{shopId} read pattern
 * (HOTFIX-RESPOND-OWNER lesson — don't use `where ownerUid == uid limit 1`).
 * Falls back to claim-based shopId resolution if present.
 */
export const listShopAttentionReviews = onCall(
  { cors: true, enforceAppCheck: false, region: 'asia-south1' },
  async request => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in required');
    const claims = (request.auth?.token ?? {}) as Record<string, unknown>;
    if (claims.shopOwner !== true) {
      throw new HttpsError('permission-denied', 'Shop owner role required');
    }

    // Resolve caller's shopId. Prefer claim if present; else find via
    // shops collection. Either resolution must verify ownership.
    let shopId: string | null = typeof claims.shopId === 'string' ? claims.shopId : null;
    if (!shopId) {
      // Fallback: find the shop where ownerUid == uid. Multi-shop owners
      // get the first match — for pilot scale a partner only owns one shop.
      // If this assumption breaks, extend the callable to accept `shopId`
      // as an input arg and validate it via validateShopOwnerForReview.
      const ownerShops = await db
        .collection('shops')
        .where('ownerUid', '==', uid)
        .limit(1)
        .get();
      if (ownerShops.empty) {
        return { rows: [] };
      }
      shopId = ownerShops.docs[0].id;
    } else {
      // Verify shopId from claim still matches an owned shop (defense-
      // in-depth; claims can be stale).
      const shopDoc = await db.doc(`shops/${shopId}`).get();
      if (!shopDoc.exists || shopDoc.data()?.ownerUid !== uid) {
        throw new HttpsError('permission-denied', 'Not the owner of this shop');
      }
    }

    const snap = await db
      .collection('orders')
      .where('shopId', '==', shopId)
      .where('shopCorrectionState', '==', 'flagged_low')
      .orderBy('updatedAt', 'desc')
      .limit(50)
      .get();

    const docs = snap.docs.map(d => ({ id: d.id, data: d.data() }));
    return { rows: summarizeAttentionReviewRows(docs) };
  },
);
```

**Note the shop-owner fallback uses `where ownerUid == uid limit 1`** — the antipattern from HOTFIX-RESPOND-OWNER. **This is the only legitimate exception** to the `shopOwnerCheckAudit` static guard, since the callable needs to discover the shop without prior knowledge of shopId. **Annotate with `// shop-owner-audit:allow` inline comment** so the guard skips this line. If the audit doesn't have an inline-allow mechanism, suppress the guard for this specific file via the existing allowlist pattern.

### §C — Add client wrappers to `orderService.ts`

`src/services/orderService.ts` — add near the existing `listShopReviews` method (line ~2045) following the same RNFB native + Web SDK branch pattern:

```ts
async listMyAttentionReviews(): Promise<AttentionReviewRow[]> {
  if (isNative) {
    const fn = getNativeFunctions().httpsCallable('listMyAttentionReviews');
    const res = await fn({});
    return (res.data as { rows?: AttentionReviewRow[] })?.rows ?? [];
  }
  const fn = httpsCallable(functions, 'listMyAttentionReviews');
  const res = await fn({});
  return ((res.data as { rows?: AttentionReviewRow[] })?.rows ?? []);
},

async listShopAttentionReviews(): Promise<AttentionReviewRow[]> {
  if (isNative) {
    const fn = getNativeFunctions().httpsCallable('listShopAttentionReviews');
    const res = await fn({});
    return (res.data as { rows?: AttentionReviewRow[] })?.rows ?? [];
  }
  const fn = httpsCallable(functions, 'listShopAttentionReviews');
  const res = await fn({});
  return ((res.data as { rows?: AttentionReviewRow[] })?.rows ?? []);
},
```

Verify the call site signatures match — the three callers (`DeliveryDashboardScreen:320`, `ShopOwnerDashboardScreen:218`, `AttentionQueueScreen:43-44`) all expect a Promise that resolves to `AttentionReviewRow[]`. The unwrap `data.rows ?? []` handles both response shapes (callable returns `{ rows }` or just an array).

### §D — Verify + add per-dimension composite indexes

`firestore.indexes.json` — check if these indexes exist:

```json
{
  "collectionGroup": "orders",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "deliveryPersonId", "order": "ASCENDING" },
    { "fieldPath": "deliveryCorrectionState", "order": "ASCENDING" },
    { "fieldPath": "updatedAt", "order": "DESCENDING" }
  ]
},
{
  "collectionGroup": "orders",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "shopId", "order": "ASCENDING" },
    { "fieldPath": "shopCorrectionState", "order": "ASCENDING" },
    { "fieldPath": "updatedAt", "order": "DESCENDING" }
  ]
}
```

If either is missing, **add it.** Bundle J §G said 4 new indexes would land — verify all 4 are present (the other 2 are for the timeout cron's per-dimension query). If any are missing, surface in the final report.

### §E — Update `attentionReviewHelpers.ts` filter to per-dimension

`functions/src/attentionReviewHelpers.ts:24` currently:

```ts
.filter(d => d.data.correctionState === 'flagged_low')
```

This worked when the callable queried on legacy `correctionState`. With per-dimension callable filters (§A + §B), the secondary filter in the helper should align. **But the helper is shared across both callables** — they have different dimension semantics. Options:

**Option A (recommended):** Make the helper dimension-aware via a parameter:

```ts
export function summarizeAttentionReviewRows(
  docs: Array<{ id: string; data: Record<string, any> }>,
  dimension: 'shop' | 'delivery',
): AttentionReviewRow[] {
  const stateField = dimension === 'shop' ? 'shopCorrectionState' : 'deliveryCorrectionState';
  return docs
    .filter(d => d.data[stateField] === 'flagged_low')
    // ... rest unchanged ...
}
```

§A and §B callables pass their dimension. Existing tests need updating to pass the new arg.

**Option B:** Drop the secondary filter (server query already filters; helper just maps + sorts). Simpler but less defensive.

Pick A — defensive against future query bugs and self-documenting.

### §F — Tests

Pin **+8 tests minimum:**

- **§A + §B callable smoke tests** (+4) — exercise via a mock Firestore. Both callables: missing claim → permission-denied. Right claim, no flagged orders → empty rows. Right claim, 1 flagged → 1 row. Right claim, 3 flagged + 2 published → 3 rows.
- **§E helper with dimension param** (+2) — `dimension: 'shop'` reads `shopCorrectionState`; `dimension: 'delivery'` reads `deliveryCorrectionState`.
- **§C client wrapper unwrap** (+2) — Both wrappers correctly unwrap `{ rows }` payload. Mock the Firebase functions SDK.

Plus update existing `attentionReviewHelpers.test.ts` to pass the new `dimension` arg (or skip via Option B).

## Discipline checklist

1. **Rule 1** — every new import / state carries "HOTFIX-ATTENTION-CALLABLES-MISSING — DO NOT REMOVE" comments.
2. **Rule 2** — N/A.
3. **Rule 5** — schema audit-grep in header. **Worked example #14 for the discipline notes:** *"When a PR report claims a multi-file change is shipped, the verification step must include `grep "<symbol>" <expected-file>` for each named export and method, not just `tsc --noEmit clean`. Type-only references to a missing implementation still typecheck if the type is defined separately. Bundle I §D/§E's missing callables are the worked example."*
4. **Rule 7** — auth.token shape verified (`claims.delivery`, `claims.shopOwner`, `claims.shopId` per HOTFIX-RATING-RESPONSE precedent).
5. **Rule 8** — FEATURES.md update in Doc trail. No NEW rows; just lineage HTML comments confirming Bundle I §D/§E finally shipped.
6. **Rule 11** — IAM verify on both new callables. 2 services.
7. **Rule 13** — N/A.
8. **Rule 14** — N/A.
9. **Schema-additive** — N/A (no new fields).
10. **Test discipline:** **+8 tests minimum.** Suite ~current → +8.

## Acceptance checklist

1. **§A** Customer rates shop 1★ + delivery 1★ → as delivery partner, open dashboard → "Reviews & Ratings" card shows count = 1 (the flagged order). Tap card → AttentionQueueScreen opens with the order listed. Tap row → DeliveryOrderDetail opens with Respond button visible.
2. **§B** Same flow on shop side. Card shows count = 1, tap → AttentionQueueScreen, tap row → ShopOrderDetail.
3. **§A** Customer rates shop 5★ + delivery 1★ → only delivery side flagged. Partner sees count = 1. Shop sees count = 0 (because shopCorrectionState = 'published', not 'flagged_low').
4. **§A** After partner responds to their 1★ → review.deliveryCorrectionState = 'responded' → partner's count drops to 0. Card disables (no longer urgent variant).
5. **§B** Same after shop responds — shop's count drops to 0 (when their dimension is responded).
6. **§A+§B** Manually invoke `listMyAttentionReviews` as a shop owner (no delivery claim) → `permission-denied`. Same vice versa.
7. **§D** Firebase Console → Firestore → Indexes shows both new per-dimension composite indexes as Enabled.
8. **Cloud Run IAM** verify on `listMyAttentionReviews` AND `listShopAttentionReviews`. Re-bind `allUsers` if `etag: ACAB`.
9. `tsc` + tests clean. Suite +8 minimum.
10. **Deliberate-break demo:** revert §A's `where('deliveryCorrectionState', '==', 'flagged_low')` back to `where('correctionState', '==', 'flagged_low')`. The smoke test asserting "Customer rates shop 5★ + delivery 1★ → partner sees count = 1, shop sees count = 0" must FAIL (shop would also see count 1 because legacy correctionState is the worst-of). Restore. Tests pass.

## Out of scope

- **Backfilling old orders** without per-dimension fields — covered by Bundle J's existing backfill script.
- **Real-time watch** on the attention queue — still pull-to-refresh + useFocusEffect. Bundle I §D/§E spec out-of-scope item.
- **Pagination** beyond 50 rows — pilot scale.

## Deploy

```
cd functions; npm run build; cd ..

# Deploy indexes first if any were missing
firebase deploy --only firestore:indexes
# Wait for any newly-added indexes to show Enabled in Firebase Console.

# Deploy the 2 new callables
firebase deploy --only "functions:listMyAttentionReviews,functions:listShopAttentionReviews"

# IAM verify
foreach ($svc in 'listmyattentionreviews','listshopattentionreviews') {
  gcloud run services get-iam-policy $svc --region=asia-south1 --project=grocery-mvp-dev
}
# Re-bind any returning etag: ACAB:
# gcloud run services add-iam-policy-binding <svc> --region=asia-south1 --member=allUsers --role=roles/run.invoker --project=grocery-mvp-dev

# Client OTA
npx tsc --noEmit
npm run test:unit
eas update --branch production --message "HOTFIX-ATTENTION-CALLABLES-MISSING — implement Bundle I §D/§E callables + per-dimension filter"
```

## Doc trail (Cowork)

After ship:

- **TESTING-FINDINGS** — close Sudhir's attention count = 0 observation.
- **CLAUDE.md** In-flight strike. Note that Bundle I §D/§E was reported but not actually shipped until now.
- **SESSION_LOG** paragraph capturing: PR reports vs grep-verification. The `tsc --noEmit clean` signal is not sufficient when the type can be declared independently of the implementation.
- **PROMPT_AUTHORING_NOTES** — add **Rule 5 worked example #14** (PR completion verification — grep for the named export, not just typecheck pass).
- **FEATURES.md** (per Rule 8):
  - **Delivery panel §3.3 Home / dashboard** — lineage HTML comment on the "Reviews & Ratings section" row: `<!-- HOTFIX-ATTENTION-CALLABLES-MISSING 2026-06-10 — server callables finally shipped -->`. No description change.
  - **Shop panel §2.2 Order management** — same lineage on the equivalent row.
  - **Last updated** stamps on Delivery §3.3, Shop §2.2 → 2026-06-10.
