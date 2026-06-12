# PR-NEXT-BUNDLE-J — Per-dimension review correction state

**Source:** Sudhir's 2026-06-10 testing:

> *"Shop and delivery both got 1 star rating. Shop rating got corrected to 4, it appears correctly for shop. But delivery partner review and rating section originally had 1 item there but that also got resolved even delivery partner didn't open and replied back to that. Looks like it got automatically closed with shop's review comment."*

**Structural bug.** A single review doc has ONE `correctionState` field but TWO independently-ratable dimensions (shop + delivery). When the shop responds, `correctionState` transitions `flagged_low → responded` — and the delivery partner's attention queue (which filters `correctionState === 'flagged_low'`) drops the review. The partner never had a chance to respond to their separate 1★ rating.

The symptom is asymmetric in Sudhir's test (shop responded first), but the bug is symmetric — partner responding first would have the same effect on the shop's response window.

**Deploy class:** **server-first.** 5 modified callables (submitOrderRating + respondToReview + amendRating + acknowledgeReview + publishTimedOutReviews) + helper extractions + schema-additive backfill. Client OTA + 1-2 new composite indexes.

## Design — per-dimension state with backward-compatible legacy field

**Schema-additive:** add `shopCorrectionState` and `deliveryCorrectionState` to review docs (and denormalize on order docs). Existing `correctionState` field stays for backward compatibility — computed as the "worst" of the two states (most-restrictive) so existing consumers keep working until they're migrated.

```
review.shopCorrectionState:     'flagged_low' | 'responded' | 'amended' | 'published'
review.deliveryCorrectionState: same set, OR 'n_a' when customer didn't rate delivery
review.correctionState:         legacy — computed as max(shop, delivery)
                                (max ordering: flagged_low > responded > amended > published)
```

**Independent state machines per dimension.** Each side can:
- Start at `flagged_low` if its stars ≤ threshold; else `published` immediately.
- Transition to `responded` independently when its responder (shop / partner) responds.
- Transition to `amended`→`published` when customer amends ITS stars.
- Transition to `published` via 7-day timeout independently.
- `acknowledgeReview` accepts an optional `dimension: 'shop' | 'delivery' | 'both'` arg — defaults to 'both' for back-compat with current UI.

**Attention queue queries become per-dimension:**
- Partner: `where deliveryPersonId == uid AND deliveryCorrectionState == 'flagged_low'`
- Shop: `where shopId == X AND shopCorrectionState == 'flagged_low'`

Existing `correctionState`-based filters remain functional via the legacy computed field but new queries use the per-dimension fields.

**Customer-side UX evolution** (Bundle H §A panel needs update):
- One panel surface, two response sections.
- When both pending: "Awaiting shop response · Awaiting partner response"
- When shop responded but not partner: shop response visible with Amend/Ack-shop CTAs; below it "Partner hasn't responded yet · {days left}"
- When both responded: two response sections + per-dimension Amend/Ack CTAs.
- After customer amends or acks one side: that side shows resolved state; other side still actionable.

## Autonomous execution authorization

You may run the following without stopping to confirm — execute, report results in the final summary:

- All `Read`, `Grep`, `Glob`, `ls`, `git status`, `git diff` (read-only)
- `npx tsc --noEmit` (root AND `functions/`)
- `npm test`, `npm run test:unit`, `npm run test:full`, `npx jest`
- `cd functions && npm run build`
- File edits to files explicitly named in §A–§K below
- New file creation in `functions/src/`, `src/utils/`, `src/components/`, `scripts/`, `tests/`

You MUST stop and ask before:
- Deploy commands (`firebase deploy`, `eas update`, `gcloud …`)
- Running the backfill script (dry-run only without confirmation)
- File deletes
- Editing files NOT in the §-named lists
- Adding NEW Firestore fields beyond the 4 listed in the audit table (shopCorrectionState + deliveryCorrectionState on review, same denormalized onto order)
- Migrating away from legacy `correctionState` — it stays for back-compat until a future cleanup PR

Default posture: **execute, report at end.**

## Schema audit-grep (Rule 5)

```
grep -n "correctionState\|shopCorrectionState\|deliveryCorrectionState" functions/src/index.ts
grep -rn "order\.correctionState\|review\.correctionState" src --include="*.tsx" --include="*.ts"
grep -n "decideInitialState\|canRespond\|canAmend\|canAcknowledge\|decideTimeoutPublish" functions/src
```

| Field | Current | New | Notes |
| --- | --- | --- | --- |
| `review.correctionState` | source-of-truth single state | LEGACY — computed as worst of (shopCS, deliveryCS); kept for back-compat | All existing readers continue working |
| `review.shopCorrectionState` | DOES NOT EXIST | NEW — per-dimension state for shop side | flagged_low / responded / amended / published |
| `review.deliveryCorrectionState` | DOES NOT EXIST | NEW — per-dimension state for delivery side | + `'n_a'` when customer didn't rate delivery |
| `order.correctionState` | denormalized via HOTFIX-REVIEW-DENORM | LEGACY — same computed value | Existing OrderDetail / shop / partner screens still read it |
| `order.shopCorrectionState` | DOES NOT EXIST | NEW — denormalized from review | Customer Bundle H panel reads this for per-dimension UX |
| `order.deliveryCorrectionState` | DOES NOT EXIST | NEW — denormalized from review | Same |
| `review.responseBy` | 'shop' \| 'partner' — only ONE side captured | LEGACY — points to last responder; both sides may now have responded | `shopResponseText` + `partnerResponseText` added (see §B) |
| `review.shopResponseText` + `partnerResponseText` | DOES NOT EXIST | NEW — independent responses per side | Existing `responseText` stays as legacy pointer to whichever side responded last |

**8 new schema-additive fields total** (4 state + 2 response text on review + 2 denormalized state on order). All optional. Backfill recomputes them from the existing single `correctionState` on existing reviews.

## Plan

### §A — Pure helper: state-machine extension

`functions/src/reviewWorkflowHelpers.ts`:

Add per-dimension types and helpers:

```ts
export type ReviewDimension = 'shop' | 'delivery';

export type PerDimensionState =
  | 'flagged_low'
  | 'responded'
  | 'amended'
  | 'published'
  | 'n_a';  // delivery dimension only — customer didn't rate delivery

export function decideInitialPerDimension(args: {
  shopStars: number;
  deliveryStars: number | null | undefined;
  shopThreshold: number;
  partnerThreshold: number;
}): {
  shopState: Exclude<PerDimensionState, 'n_a'>;
  deliveryState: PerDimensionState;
} {
  const lowShop = args.shopStars <= args.shopThreshold;
  const shopState = lowShop ? 'flagged_low' : 'published';
  let deliveryState: PerDimensionState;
  if (args.deliveryStars == null) {
    deliveryState = 'n_a';
  } else {
    const lowPartner = args.deliveryStars <= args.partnerThreshold;
    deliveryState = lowPartner ? 'flagged_low' : 'published';
  }
  return { shopState, deliveryState };
}

/**
 * Worst-of (most-restrictive) state for the legacy `correctionState`
 * field. Order: flagged_low > responded > amended > published > n_a.
 * 'n_a' is skipped — if delivery is n_a, legacy state reflects shop only.
 */
export function computeLegacyState(
  shopState: Exclude<PerDimensionState, 'n_a'>,
  deliveryState: PerDimensionState,
): Exclude<PerDimensionState, 'n_a'> {
  const order: Record<string, number> = {
    flagged_low: 4,
    responded: 3,
    amended: 2,
    published: 1,
  };
  if (deliveryState === 'n_a') return shopState;
  const shopRank = order[shopState];
  const deliveryRank = order[deliveryState];
  return shopRank >= deliveryRank ? shopState : (deliveryState as Exclude<PerDimensionState, 'n_a'>);
}

export function canRespondPerDimension(state: PerDimensionState): boolean {
  return state === 'flagged_low';
}

export function canAmendPerDimension(state: PerDimensionState): boolean {
  return state === 'responded';
}

export function canAcknowledgePerDimension(state: PerDimensionState): boolean {
  return state === 'responded';
}
```

Keep existing helpers (`decideInitialState`, `canRespond`, etc.) for back-compat with publishTimedOutReviews and any uncovered call sites. They become thin wrappers over the per-dimension helpers.

Pin **+10 tests** on the per-dimension helpers (all-published / shop-flagged-only / delivery-flagged-only / both-flagged / n_a / legacy-state computation across all combinations).

### §B — submitOrderRating: write per-dimension states

`functions/src/index.ts` `submitOrderRating` near line 8810-8910:

```ts
// BEFORE
const initReview = decideInitialState({...});
// writes correctionState only

// AFTER
const initPerDim = decideInitialPerDimension({
  shopStars: shopRating,
  deliveryStars: deliveryRating ?? null,
  shopThreshold: 3,
  partnerThreshold: 3,
});
const legacyState = computeLegacyState(initPerDim.shopState, initPerDim.deliveryState);

// Review doc payload extended:
const reviewDoc = {
  ...existing fields...,
  correctionState: legacyState,           // legacy — back-compat
  shopCorrectionState: initPerDim.shopState,
  deliveryCorrectionState: initPerDim.deliveryState,
  publishedAt: legacyState === 'published' ? nowMs : null,
  publishedReason: legacyState === 'published' ? 'above_threshold' : null,
  // ... etc ...
};

// Order denorm extended:
const orderPayload = {
  ...existing fields...,
  correctionState: legacyState,           // legacy — back-compat
  shopCorrectionState: initPerDim.shopState,
  deliveryCorrectionState: initPerDim.deliveryState,
  // ...
};
```

Both writes inside the existing transaction. No new transaction needed.

### §C — respondToReview: update only the responder's dimension

`functions/src/index.ts:10481-10487` `respondToReview`:

```ts
// BEFORE
await db.doc(`reviews/${ratingId}`).set(
  {
    correctionState: 'responded',
    responseText: trimmedResponse,
    responseBy,
    responseAt: nowMs,
  },
  { merge: true },
);

// AFTER
const reviewPatch: Record<string, unknown> = {
  responseAt: nowMs,  // legacy + new: stamp last-response time
  responseBy,         // legacy: points to last responder
  responseText: trimmedResponse,  // legacy: points to last response
};
if (responseBy === 'shop') {
  reviewPatch.shopCorrectionState = 'responded';
  reviewPatch.shopResponseText = trimmedResponse;
  reviewPatch.shopRespondedAt = nowMs;
} else {
  reviewPatch.deliveryCorrectionState = 'responded';
  reviewPatch.partnerResponseText = trimmedResponse;
  reviewPatch.partnerRespondedAt = nowMs;
}

// Recompute legacy correctionState from the new per-dimension values
const updatedShopCS = responseBy === 'shop' ? 'responded' : rev.shopCorrectionState;
const updatedDeliveryCS = responseBy === 'partner' ? 'responded' : (rev.deliveryCorrectionState ?? 'n_a');
reviewPatch.correctionState = computeLegacyState(updatedShopCS, updatedDeliveryCS);

await db.doc(`reviews/${ratingId}`).set(reviewPatch, { merge: true });

// Cascade to order denorm — same shape, write per-dimension fields
await db.doc(`orders/${rev.orderId}`).set({
  correctionState: reviewPatch.correctionState,
  shopCorrectionState: updatedShopCS,
  deliveryCorrectionState: updatedDeliveryCS,
  responseText: trimmedResponse,
  responseBy,
  responseAt: nowMs,
  ...(responseBy === 'shop'
    ? { shopResponseText: trimmedResponse, shopRespondedAt: nowMs }
    : { partnerResponseText: trimmedResponse, partnerRespondedAt: nowMs }),
  updatedAt: FieldValue.serverTimestamp(),
}, { merge: true });
```

Auth gate update: `canRespond` check now reads `canRespondPerDimension(responseBy === 'shop' ? rev.shopCorrectionState : rev.deliveryCorrectionState)`. If the responder's own dimension has already been responded to (e.g. shop trying to respond a second time), reject with `failed-precondition`.

### §D — amendRating: per-dimension amend transitions

`functions/src/index.ts` `amendRating` callable:

Now that amendRating accepts both `newShopStars` and `newDeliveryStars` independently, each one transitions only its own dimension to `amended → published`. Pass through to `_publishReview` with separate dimension hints:

```ts
await _publishReview({
  ratingId,
  reason: 'customer_amended',
  newShopStars,
  newDeliveryStars,
  amendDimensions: {
    shop: newShopStars !== undefined && newShopStars !== rev.shopStars,
    delivery: newDeliveryStars !== undefined && newDeliveryStars !== rev.deliveryStars,
  },
  nowMs,
});
```

`_publishReview` updates each dimension's state only if `amendDimensions.X === true`. The other dimension stays at whatever state it was.

`canAmend` becomes per-dimension. Amending shop stars requires `rev.shopCorrectionState === 'responded'`; amending delivery stars requires `rev.deliveryCorrectionState === 'responded'`. If the dimension isn't responded yet, reject with `failed-precondition`.

### §E — acknowledgeReview: per-dimension acknowledgement

`functions/src/index.ts` `acknowledgeReview` callable:

Extend input signature: `{ ratingId: string; dimension?: 'shop' | 'delivery' | 'both' }`. Default `'both'` for back-compat with existing client (which doesn't pass dimension).

For each dimension specified, transition its state `responded → published`. Per-dimension `canAcknowledge` gate.

### §F — `_publishReview`: per-dimension write phase

`functions/src/index.ts` `_publishReview` helper:

The transaction structure (READ → COMPUTE → WRITE phases per HOTFIX-PUBLISH-TX-ORDER) stays intact. Inside the WRITE phase, the review patch becomes dimension-aware:

```ts
const reviewPatch: Record<string, unknown> = {
  publishedAt,
  publishedReason: args.reason,
};
// Per-dimension transitions
if (args.amendDimensions?.shop || args.reason === 'customer_acknowledged' && args.acknowledgeDimensions?.shop || args.reason === 'timeout') {
  reviewPatch.shopCorrectionState = 'published';
  if (args.newShopStars !== undefined) reviewPatch.shopStars = args.newShopStars;
}
// Same for delivery
if (args.amendDimensions?.delivery || ...) {
  reviewPatch.deliveryCorrectionState = 'published';
  if (args.newDeliveryStars !== undefined) reviewPatch.deliveryStars = args.newDeliveryStars;
}
// Recompute legacy state from updated per-dimension
const finalShopCS = reviewPatch.shopCorrectionState ?? rev.shopCorrectionState ?? 'published';
const finalDeliveryCS = reviewPatch.deliveryCorrectionState ?? rev.deliveryCorrectionState ?? 'n_a';
reviewPatch.correctionState = computeLegacyState(finalShopCS, finalDeliveryCS);
```

Order denorm same shape. Cache updates (shop.publicReviewLatest + partner.publicReviewLatest) only fire when their respective dimension transitions to `published`.

`publicRatingCount` / `publicReviewCount` increments also become per-dimension — increment shop's counters only when shopCorrectionState transitions INTO 'published', partner's only when deliveryCorrectionState transitions INTO 'published'.

Pin **+8 tests** on _publishReview per-dimension scenarios (amend shop only / amend delivery only / amend both / ack shop only / ack both / timeout shop only / timeout both / mixed states).

### §G — Attention queue callables: per-dimension filter

`functions/src/index.ts` `listMyAttentionReviews`:

```ts
// BEFORE
.where('correctionState', '==', 'flagged_low')

// AFTER
.where('deliveryCorrectionState', '==', 'flagged_low')
```

`listShopAttentionReviews`:

```ts
.where('shopCorrectionState', '==', 'flagged_low')
```

Two new composite indexes required in `firestore.indexes.json`:
- `(deliveryPersonId, deliveryCorrectionState, updatedAt)` for partner queue
- `(shopId, shopCorrectionState, updatedAt)` for shop queue

Build time ~1-3 min on small data.

### §H — Bundle H §A customer panel update

`src/components/order/CustomerReviewResponsePanel.tsx` + `src/utils/deriveCustomerReviewResponseView.ts`:

The view model now returns per-dimension states. The panel renders ONE or TWO response sections depending on which dimensions responded.

Discriminated-union output:

```ts
export type CustomerReviewResponseView =
  | { kind: 'none' }
  | {
      kind: 'mixed';
      shop: DimensionView;
      delivery: DimensionView;
      // Each DimensionView is one of:
      //   { state: 'awaiting' }
      //   { state: 'responded'; responseText; responseAt; responder: {...} }
      //   { state: 'published' | 'amended' }
      //   { state: 'n_a' }  // delivery only
    };
```

Panel iterates over the two dimensions, renders each section if state !== 'n_a'. Amend/Ack CTAs are per-dimension.

Customer's RatingAmendmentScreen extended to accept a `dimension` param. Currently amends shop stars only; needs to amend delivery stars too. Two sliders or a single picker with a "Which would you like to amend?" prompt at the top. Cleanest: a single screen that shows the responded dimension(s) and lets customer pick which to amend.

### §I — 7-day cron: per-dimension timeout

`functions/src/index.ts` `publishTimedOutReviews`:

Query for reviews where EITHER `shopCorrectionState === 'flagged_low'` OR `deliveryCorrectionState === 'flagged_low'` AND submittedAt > 7 days ago. For each found review, call `_publishReview` with `acknowledgeDimensions` for whichever side(s) are still flagged.

### §J — Backfill script for existing reviews

Create `scripts/backfill-per-dimension-review-state.ts`:

For every review doc:
- Read existing `correctionState` (single)
- Compute `shopCorrectionState` and `deliveryCorrectionState`:
  - If `correctionState === 'published'`: both → 'published' (or 'n_a' for delivery if no deliveryStars)
  - If `correctionState === 'flagged_low'`: assume both were flagged (conservative — both sides can still respond)
  - If `correctionState === 'responded'` and `responseBy === 'shop'`: shopCS='responded', deliveryCS='flagged_low' if deliveryStars low else 'published'
  - Same for partner side
  - If `correctionState === 'amended'`: assume both amended (rare/no test data)
- Same backfill for order docs

Same safety scaffolding as previous backfills (project allowlist, admin-uid required, dry-run default).

Pin **+5 tests** on the backfill computation helper.

### §L — Migrate ALL existing screen consumers to per-dimension fields

**Cross-checked against Sudhir's observation (2026-06-10):** *"shop put a comment to customer, that comment is visible under delivery partner also. When that comment sorted out from customer and shop side, it got closed delivery side."*

Five consumer surfaces currently read the **legacy** `order.responseText` + `order.correctionState`. After §B–§F write per-dimension fields, those legacy consumers will still see the LAST-response text regardless of which dimension responded — meaning the delivery partner sees the shop's response text in the "Your response:" block. Every consumer below must migrate to dimension-specific fields.

#### §L.1 — DeliveryOrderDetailScreen.tsx

`src/screens/delivery/DeliveryOrderDetailScreen.tsx:457-500`. Replace `order.correctionState` reads with `order.deliveryCorrectionState`, and `order.responseText` reads with `order.partnerResponseText`:

```ts
// BEFORE (lines 457-500 — abbreviated)
{(order.correctionState === 'flagged_low' || order.correctionState === 'responded') && (
  // ... shows partner banner with order.responseText ...
)}
{order.correctionState === 'responded' && (
  <Text>{order.responseText}</Text>
  <Text>{order.responseAt ? ...days left... : ''}</Text>
)}
{order.correctionState === 'published' && !!order.deliveryRating && (
  // ... published summary ...
)}
```

```ts
// AFTER — read per-dimension fields the partner owns
const partnerState = order.deliveryCorrectionState ?? order.correctionState; // fallback for legacy orders pre-Bundle-J
{(partnerState === 'flagged_low' || partnerState === 'responded') && (
  // ... shows partner banner with order.partnerResponseText ...
)}
{partnerState === 'responded' && (
  <Text>{order.partnerResponseText ?? order.responseText /* legacy fallback */}</Text>
  <Text>{order.partnerRespondedAt ?? order.responseAt ? ...days left... : ''}</Text>
)}
{partnerState === 'published' && !!order.deliveryRating && (
  // ... ✅ Delivery review published — N★ with your response ...
)}
```

Fallback to legacy fields (`order.responseText`, `order.correctionState`) for any order doc that hasn't been backfilled yet — the backfill is one-shot, but defense-in-depth.

#### §L.2 — ShopOrderDetailScreen.tsx (two blocks)

`src/screens/shop/ShopOrderDetailScreen.tsx:460-479` — customer rating display block (shop sees the customer's rating + shop's own previous response).

`src/screens/shop/ShopOrderDetailScreen.tsx:688-723` — shop-side response banner.

Both blocks: replace `order.correctionState` → `order.shopCorrectionState` and `order.responseText` → `order.shopResponseText`. Same fallback pattern as §L.1.

```ts
const shopState = order.shopCorrectionState ?? order.correctionState; // legacy fallback
// ... use shopState in gates, order.shopResponseText in display ...
```

#### §L.3 — CustomerReviewResponsePanel + deriveCustomerReviewResponseView (Bundle H §A code — full rewrite)

`src/utils/deriveCustomerReviewResponseView.ts`: rewrite the view-model derivation. Was single-state discriminated union; becomes two-dimensional:

```ts
export type DimensionResponseView =
  | { state: 'awaiting' }
  | { state: 'responded'; responseText: string; responseAt: number | null; responder: ResponderIdentity }
  | { state: 'amended' | 'published' }
  | { state: 'n_a' };  // delivery only — customer didn't rate this dimension

export type CustomerReviewResponseView =
  | { kind: 'none' }
  | {
      kind: 'mixed';
      shop: DimensionResponseView;
      delivery: DimensionResponseView;
      ratingId: string;
      orderId: string;
      shopName: string | null;
      shopRating: number;
      shopStarsAmended: boolean;  // true if customer already amended shop side
      deliveryRating: number | null;
      deliveryStarsAmended: boolean;
      deliveryPersonName: string | null;
      deliveryPersonPhotoUrl: string | null;
    };

export function deriveCustomerReviewResponseView(order: {
  shopCorrectionState?: string | null;
  deliveryCorrectionState?: string | null;
  correctionState?: string | null;  // legacy fallback
  shopResponseText?: string | null;
  partnerResponseText?: string | null;
  responseText?: string | null;     // legacy fallback
  shopRespondedAt?: number | null;
  partnerRespondedAt?: number | null;
  responseAt?: number | null;       // legacy fallback
  shopRating?: number | null;
  deliveryRating?: number | null;
  // ... other fields ...
}): CustomerReviewResponseView {
  // ... derive shopDimension + deliveryDimension separately ...
  // ... return { kind: 'mixed', shop, delivery, ...metadata } ...
}
```

`src/components/order/CustomerReviewResponsePanel.tsx`: rewrite to render BOTH sections when both are actionable / informational:

```tsx
return (
  <View style={styles.container}>
    <Text style={styles.sectionTitle}>Response to your review</Text>
    {view.shop.state !== 'n_a' && (
      <ResponseDimensionCard
        dimension="shop"
        view={view.shop}
        responderName={view.shopName ?? 'the shop'}
        responderPhotoUrl={null}  // shop badge uses 🏪 icon
        onAmend={() => onAmendPress('shop')}
        onAcknowledge={() => onAcknowledgePress('shop')}
      />
    )}
    {view.delivery.state !== 'n_a' && (
      <ResponseDimensionCard
        dimension="delivery"
        view={view.delivery}
        responderName={view.deliveryPersonName ?? 'Delivery partner'}
        responderPhotoUrl={view.deliveryPersonPhotoUrl ?? null}
        onAmend={() => onAmendPress('delivery')}
        onAcknowledge={() => onAcknowledgePress('delivery')}
      />
    )}
  </View>
);
```

`ResponseDimensionCard` is a new inline subcomponent rendering ONE dimension's state — awaiting / responded with CTAs / resolved.

#### §L.4 — RatingAmendmentScreen.tsx — dimension param + UI split

`src/screens/customer/RatingAmendmentScreen.tsx`: extend route params with `dimension: 'shop' | 'delivery'`. Currently only amends shop stars; needs to handle either dimension based on the param.

```ts
// route.params now includes `dimension`
const { ratingId, dimension, originalStars, responseText, responseBy, ... } = route.params;

// handleAmend calls amendRating with the right field:
const payload = dimension === 'shop'
  ? { ratingId, newShopStars: newStars }
  : { ratingId, newDeliveryStars: newStars };
await orderService.amendRating(payload);
```

Same change in `handleKeepOriginal` → `acknowledgeReview({ ratingId, dimension })`.

Screen header changes from "Update your rating?" to "Update your shop rating?" / "Update your delivery rating?" based on dimension.

`OrderDetailScreen.tsx` (where it navigates to RatingAmendmentScreen via Bundle H §A panel) — the new `onAmendPress(dimension)` / `onAcknowledgePress(dimension)` handlers in §L.3 navigate with the appropriate dimension param.

#### §L.5 — attentionReviewHelpers.ts (server helper)

`functions/src/attentionReviewHelpers.ts:24`: the per-dimension filter probably needs updating. Verify by reading the file:

```
grep -n "correctionState\|flagged_low" functions/src/attentionReviewHelpers.ts
```

If the filter passes through a `correctionState === 'flagged_low'` check, replace with the per-dimension field — `deliveryCorrectionState` for partner-side helper, `shopCorrectionState` for shop-side helper. Likely already covered by §G's callable update if the helpers are pure transformations on the snapshot returned by the callable. Verify either way.

#### §L.6 — Tests for consumer migration

Pin **+8 tests** total across §L:
- DeliveryOrderDetailScreen: legacy fallback works on pre-Bundle-J orders; new field read on post-Bundle-J orders (+2)
- ShopOrderDetailScreen: same (+2)
- deriveCustomerReviewResponseView: mixed states (both flagged / shop responded only / delivery responded only / both responded / amended-shop-only / published / null fields) (+4)

### §K — Per-dimension push notifications

Update `respondToReview` push to include `dimension: 'shop' | 'partner'` in the push payload data. Customer's AuthBootstrap deep-link handler reads `dimension` to potentially navigate to RatingAmendmentScreen pre-scoped to that dimension. Bundle H §D already added `responseBy` to the data payload — extend with `dimension` (same value, more semantic name) and update the title:

```ts
const pushTitle = derivePushTitle({ responseBy, dimension: responseBy === 'shop' ? 'shop' : 'delivery' });
```

Minor — pin **+2 tests** for the extended title helper.

## Discipline checklist

1. **Rule 1** — every new field / helper carries "PR-NEXT-BUNDLE-J — DO NOT REMOVE" comments.
2. **Rule 2** — N/A (no new React hooks).
3. **Rule 5** — schema audit-grep in header. **Worked example #13 for the discipline notes:** *"When a single field models a state machine for N independently-actionable parties (shop + delivery in this case), split into N per-party fields. The legacy field stays as a computed worst-of for back-compat until consumers are migrated. Same pattern as separating per-dimension audit-grep into per-dimension static guards."*
4. **Rule 7** — auth.token shape unchanged.
5. **Rule 8** — FEATURES.md update in Doc trail. Many rows touched.
6. **Rule 11** — IAM verify on 5 modified callables (submitOrderRating + respondToReview + amendRating + acknowledgeReview + listMyAttentionReviews + listShopAttentionReviews); publishTimedOutReviews is scheduled.
7. **Rule 13** — N/A.
8. **Rule 14** — server-side per-dimension helpers return Result.
9. **Schema-additive** — 8 new optional fields. No required-field additions. Backfill recomputes from legacy single state.
10. **Test discipline:** §A +10, §B +5, §C +5, §D +5, §E +3, §F +8, §G +2, §H +6, §I +3, §J +5, §K +2, §L +8 = **+62 tests minimum.** Suite ~1578 → ~1640. This is a large PR.

## Acceptance checklist

1. **§B** Customer rates shop 1★ AND delivery 1★ → both review.shopCorrectionState AND review.deliveryCorrectionState set to 'flagged_low'. Legacy review.correctionState = 'flagged_low'.
2. **§B** Customer rates shop 5★ AND delivery 1★ → shopCS = 'published', deliveryCS = 'flagged_low'. Legacy = 'flagged_low'.
3. **§B** Customer rates shop 5★ and skips delivery → shopCS = 'published', deliveryCS = 'n_a'. Legacy = 'published'.
4. **§C** From step 1, shop responds → review.shopCorrectionState = 'responded', deliveryCorrectionState STAYS 'flagged_low'. Legacy = 'responded' (worst). Delivery partner's AttentionQueueScreen STILL shows this review.
5. **§C** Delivery partner responds (from step 4) → review.deliveryCorrectionState = 'responded', shopCorrectionState still 'responded'. Legacy = 'responded'.
6. **§D** Customer amends shop stars 1→4 (with both sides responded from step 5) → review.shopCorrectionState = 'published', shopStars = 4. Delivery still 'responded'. Legacy = 'responded' (delivery wins worst-of).
7. **§D** Customer amends delivery stars 1→4 (now from step 6) → review.deliveryCorrectionState = 'published', deliveryStars = 4. Both now published. Legacy = 'published'. shop.ratingAvg and partner.deliveryRatingAvg both updated.
8. **§G** Partner's AttentionQueueScreen filters via deliveryCorrectionState — orders where shop already responded are STILL visible if delivery side is flagged_low.
9. **§G** Shop's AttentionQueueScreen filters via shopCorrectionState — same independent logic.
10. **§H** Customer OrderDetail shows both response sections side-by-side (if both responded) or one + "Awaiting..." (if only one).
11. **§I** 7-day cron expires shop side only → shopCorrectionState = 'published' (timeout), deliveryCorrectionState stays. Partner side can still respond if still flagged.
12. **§J** Backfill against existing reviews from before this PR — recomputes per-dimension states from legacy single state without losing any data. Idempotent.
13. **§K** Push notifications differentiate "Shop responded to your shop rating" vs "Delivery partner responded to your delivery rating."
14. **§L.1** (cross-check against Sudhir's 2026-06-10 observation #4) **Delivery partner does NOT see shop's response text** in their OrderDetail. When shop has responded but partner hasn't, partner sees their own "Awaiting response" / "Tap to respond" surface — NOT the shop's response copy. Verified by reading `order.partnerResponseText` not `order.responseText`.
15. **§L.2** (mirror cross-check) **Shop does NOT see partner's response text** in shop OrderDetail. Reads `order.shopResponseText` only.
16. **§L.3** Customer OrderDetail panel shows TWO response sections when both shop and partner responded. Amend/Acknowledge CTAs gate per-dimension — amending shop side does NOT close delivery side (and vice versa).
17. **§L.4** RatingAmendmentScreen launched with `dimension: 'delivery'` amends only `newDeliveryStars`. Server gate accepts. Other dimension stays untouched.
18. **Cross-check Sudhir's observation #4 end-to-end:** Customer rates shop 1★ + delivery 1★ → shop responds → partner sees no response text on their side (only the customer comment + "Tap to respond" CTA) → partner responds independently → customer sees BOTH responses on OrderDetail panel → customer amends shop 1★→4★ → shop dimension publishes → delivery side STILL shows partner's response + "Acknowledge" CTA waiting on customer. **The two flows are completely independent end-to-end.**
19. **Cloud Run IAM** verify on all 5 modified callables.
20. **Composite indexes** built — Firebase Console shows both new indexes as Enabled (not Building).
21. `tsc` + tests clean. Suite +62 minimum.
22. **Deliberate-break demo:** revert §C's per-dimension state update back to writing single `correctionState: 'responded'`. Integration test for "shop responds → partner queue still shows review" must fail AND `deriveCustomerReviewResponseView` test for "shop responded but delivery still awaiting" must fail. Restore. Tests pass.
23. **Deliberate-break demo (§L):** revert §L.1's `DeliveryOrderDetailScreen` consumer back to reading `order.responseText`. Component-level test must fail asserting partner sees `order.partnerResponseText`, not the legacy field. Restore. Tests pass.

## Out of scope

- **Eliminating the legacy `correctionState` field.** Stays as computed worst-of for back-compat. A future cleanup PR can migrate all readers to per-dimension and then delete the legacy field.
- **Removing legacy `responseBy` / `responseText` fields.** Same — they continue pointing at the last-response side for any consumer that needs a single value.
- **Customer-side UI for partial-amend** (customer amends shop but not delivery, then is reminded later). For pilot, the amend flow lets customer specify which dimension or both; if they only amend one, the other stays in 'responded' state and the 7-day cron eventually publishes it.
- **Per-dimension cache caching strategies** (publicReviewLatest split). Pilot scale — one cache per role-shop pair is fine.
- **Admin UI for per-dimension state inspection.** Admin's drill-in already shows full review docs; per-dimension fields appear naturally.

## Deploy

```
# 1. Composite indexes first
firebase deploy --only firestore:indexes
# Wait for both indexes to show Enabled in Firebase Console.

# 2. Functions
cd functions; npm run build; cd ..
firebase deploy --only "functions:submitOrderRating,functions:respondToReview,functions:amendRating,functions:acknowledgeReview,functions:listMyAttentionReviews,functions:listShopAttentionReviews,functions:publishTimedOutReviews"

foreach ($svc in 'submitorderrating','respondtoreview','amendrating','acknowledgereview','listmyattentionreviews','listshopattentionreviews') {
  gcloud run services get-iam-policy $svc --region=asia-south1 --project=grocery-mvp-dev
}
# publishTimedOutReviews is scheduled — no Cloud Run service.

# 3. Backfill — dry run first
npx tsx scripts/backfill-per-dimension-review-state.ts --admin-uid=<your-admin-uid>
# Review the planned writes. When happy:
npx tsx scripts/backfill-per-dimension-review-state.ts --admin-uid=<your-admin-uid> --execute

# 4. Client OTA
npx tsc --noEmit
npm run test:unit
eas update --branch production --message "Bundle J — per-dimension review correction state (shop + delivery independent)"
```

## Doc trail (Cowork)

After ship:

- **TESTING-FINDINGS** — close Sudhir's 2026-06-10 delivery-side review auto-resolved bug.
- **CLAUDE.md** In-flight strike. Update Current state with the structural review-state redesign.
- **SESSION_LOG** paragraph capturing: single state field for two independent parties was the structural bug; per-dimension split with legacy field preserved for back-compat is the discipline pattern.
- **PRELAUNCH_CHECKLIST** — append Bundle J section.
- **PROMPT_AUTHORING_NOTES** — add **Rule 5 worked example #13** (per-party state machine split when a single field models multiple parties' independent actions). Note that the same audit-grep discipline that found this bug (manual inspection while writing HOTFIX-OWNER-CARD-AMEND) is now retroactively justified — when fixing one bug, audit adjacent state machines for the same antipattern.
- **FEATURES.md** (per Rule 8 — mandatory):
  - **Customer panel §1.9 Ratings & reviews** — edit "Low-rating correction workflow" row: append `"; per-dimension state machine — shop and delivery sides can be in independent states (flagged_low / responded / amended / published / n_a)"`. Lineage HTML comment.
  - **Shop panel §2.5 Reviews** — edit "Respond to low rating" row: append `"; respond only affects shop dimension — delivery side remains independently actionable"`. Lineage HTML comment.
  - **Delivery panel §3.8 Reviews** — same as shop.
  - **Cross-cutting §5.9 Operational scripts** — ADD new row: `backfill-per-dimension-review-state | One-shot — computes shopCorrectionState + deliveryCorrectionState from legacy single state | Bundle J §J | shipped`.
  - **Customer panel §1.8 Order tracking** — no row change (HOTFIX-PARTNER-STATUS-DISPLAY handled the partner card).
  - **Last updated** stamps on Customer §1.9, Shop §2.5, Delivery §3.8, Cross-cutting §5.9 → 2026-06-10.
