# PR-NEXT-BUNDLE-G — Reviews polish + payment receipt + partner photo audit

**Source:** Sudhir's 2026-06-10 findings #2, #2b (delivery count + tappable rating), #3 (shop count vs visible mismatch), #4 (partner photo missing surfaces), #5 (online-paid indicator on delivery side).

**Design lens — show partners what they earned, show customers a count that matches what they can see, show partners a clear "paid online" badge when there's no cash to collect.** Five small fixes that together close half the trust gaps in the post-delivery + reviews flow.

**Deploy class:** **server-first** (3 modified callables — `getMyDeliverySettings` extension, `submitOrderRating` rating-count split, `respondToReview` / `amendRating` / `acknowledgeReview` count-bump on publish; 1 new callable optional — `runReviewCountBackfill` admin script) → IAM verify → client OTA. Pairs with a one-shot backfill script for existing `users/{uid}` + `shops/{shopId}` docs.

## Schema audit-grep (Rule 5)

```
grep -rn "deliveryRatingCount\|deliveriesCompleted\|ratingCount\|publicRatingCount" functions/src src
grep -rn "submitOrderRating\|respondToReview\|amendRating\|acknowledgeReview" functions/src
grep -rn "formatPartnerAvatar\|PartnerAvatar\|deliveryPersonPhotoUrl" src --include="*.tsx"
grep -rn "paymentMethod\|paymentStatus\|paidMethod" src/screens/delivery
```

| Symbol | Confirmed at | Notes |
| --- | --- | --- |
| `users/{uid}.deliveryRatingCount` | `submitOrderRating` (functions/src/index.ts:8848) — currently counts ratings RECEIVED | Rename intent — keep field, surface as "ratings" not "deliveries" |
| `users/{uid}.deliveriesCompleted` | **NEW** schema-additive — incremented at `markDelivered` for status==='delivered' transition | One-shot backfill walks delivered orders per partner |
| `shops/{shopId}.ratingCount` | `submitOrderRating` (functions/src/index.ts:8825) — counts ALL ratings | Stays — admin sees this |
| `shops/{shopId}.publicRatingCount` | **NEW** schema-additive — incremented only when correctionState transitions to `published` | Customer-facing surfaces use this |
| `users/{uid}.publicDeliveryRatingCount` | **NEW** schema-additive — mirrors `publicRatingCount` for partner ratings | Partner profile + customer-facing partner card use this |
| `order.paymentMethod`, `order.paymentStatus`, `order.paidMethod` | denormalized at create / updated by webhooks + `confirmCodPayment` | Existing; no new fields |
| `order.deliveryPersonPhotoUrl` | denormalized at `claimDelivery` (PARTNER-CARD.2) | Already present; just unused at some surfaces |

## Autonomous execution authorization

You may run the following without stopping to confirm — execute, report results in the final summary:

- All `Read`, `Grep`, `Glob`, `ls`, `git status`, `git diff` (read-only)
- `npx tsc --noEmit` (root and `functions/`)
- `npm test`, `npm run test:unit`, `npm run test:full`, `npx jest`
- `cd functions && npm run build`
- File edits to files explicitly named in §A–§E below
- New file creation in `scripts/` (backfill), `functions/src/` (helpers), `src/components/order/`, `tests/`

You MUST stop and ask before:
- Deploy commands (`firebase deploy`, `eas update`, `gcloud …`)
- Running the backfill script in production (dry-run only without confirmation)
- File deletes
- Editing files NOT in the §-named lists
- Adding NEW dependencies
- Firestore rules / index changes outside what's spec'd here
- Schema additions BEYOND the 3 new fields listed in the audit-grep table

Default posture: **execute, report at end.**

---

## §A — Surface "deliveries completed" separately from "ratings received" (Finding #2)

**Current:** `DeliveryProfileScreen` displays `⭐ X.X · {ratingCount} deliveries`. Sudhir's account did 4 deliveries but only 2 customers left ratings — UI shows "2 deliveries" which is misleading and demoralizing.

**Fix:** Track a separate `deliveriesCompleted` counter incremented at `markDelivered` time. Surface it on the Profile screen alongside ratings.

### §A.1 — Server: increment `deliveriesCompleted` at delivered transition

In `functions/src/index.ts`, find the `markDelivered` callable. After the status transition to `delivered` succeeds, in the same transaction (or batched write):

```ts
// PR-NEXT-BUNDLE-G §A — partner's lifetime delivered count.
// Mirrors the ratingCount counter pattern but counts deliveries
// completed, not ratings received. Customer-facing "X deliveries"
// label uses THIS field; "Y ratings" uses deliveryRatingCount.
if (order.deliveryPersonId) {
  tx.set(
    db.doc(`users/${order.deliveryPersonId}`),
    {
      deliveriesCompleted: FieldValue.increment(1),
    },
    { merge: true },
  );
}
```

### §A.2 — Server: extend `getMyDeliverySettings` to return the new field

In `getMyDeliverySettings` (functions/src/index.ts:4671):

```ts
return {
  ...existing fields...,
  deliveriesCompleted:
    typeof data.deliveriesCompleted === 'number'
      ? data.deliveriesCompleted
      : 0,
};
```

### §A.3 — Server: denormalize on `order.deliveryPersonDeliveriesCount` at `claimDelivery`

`claimDeliveryHelpers.ts` already denormalizes partner stats onto the order at claim time (PARTNER-CARD.2). Add the new field:

```ts
// PR-NEXT-BUNDLE-G §A — denormalize completed count alongside rating
// rollups. Customer-facing partner card uses this for "X deliveries".
deliveryPersonDeliveriesCompleted:
  typeof data.deliveriesCompleted === 'number' &&
  Number.isFinite(data.deliveriesCompleted) &&
  data.deliveriesCompleted >= 0
    ? Math.floor(data.deliveriesCompleted)
    : 0,
```

### §A.4 — Client: DeliveryProfileScreen labels + display

In `DeliveryProfileScreen.tsx`, replace the rating line block:

```jsx
{(ratingCount ?? 0) > 0 && ratingAvg != null ? (
  <Text style={styles.ratingLine}>
    ⭐ {ratingAvg.toFixed(1)} · {ratingCount} {ratingCount === 1 ? 'rating' : 'ratings'}
  </Text>
) : (
  <Text style={styles.ratingLineMuted}>New partner</Text>
)}
{(deliveriesCompleted ?? 0) > 0 ? (
  <Text style={styles.deliveriesLine}>
    {deliveriesCompleted} {deliveriesCompleted === 1 ? 'delivery' : 'deliveries'} completed
  </Text>
) : null}
```

Hydrate `deliveriesCompleted` from `getMyDeliverySettings` response. Add `[deliveriesCompleted, setDeliveriesCompleted] = useState<number | null>(null);` above conditional returns.

### §A.5 — Backfill script

Create `scripts/backfill-deliveries-completed.ts`:

- Reads all delivered orders (`status === 'delivered'`)
- Groups by `deliveryPersonId`
- For each partner, sets `users/{uid}.deliveriesCompleted = count`
- Dry-run by default (`--execute` to actually write)
- Project allowlist + admin protect (same safety pattern as `reset-keep-catalog.ts`)
- Audit log at `scripts/.cleanup-logs/`

### §A.6 — Tests

Pin **+5 tests:**
- Pure helper `computeDeliveriesCompleted(orderDocs)` returning counts per partner — handles missing field, null deliveryPersonId, non-delivered status, multi-partner aggregation, empty input.

---

## §B — Tappable rating row → own reviews (Finding #2b)

**Current:** Rating display on `DeliveryProfileScreen` is a static `Text`.

**Fix:** Wrap the rating line in a Pressable → navigates to `PartnerReviewsScreen({ partnerUid: <own uid>, partnerName: <own displayName>, mode: 'own' })`.

`PartnerReviewsScreen` (Bundle E §E added `mode: 'admin' | 'public'`) — extend with `'own'` mode that shows ALL reviews (same as admin) but with a slightly different header ("Your reviews" vs "Partner reviews").

```jsx
<Pressable
  onPress={() =>
    nav.navigate('PartnerReviews', {
      partnerUid: ownUid,
      partnerName: displayName,
      mode: 'own',
    })
  }
  disabled={(ratingCount ?? 0) === 0}
  accessibilityRole="button"
  accessibilityLabel="See your reviews"
>
  <Text style={styles.ratingLine}>
    ⭐ {ratingAvg.toFixed(1)} · {ratingCount} ratings ›
  </Text>
</Pressable>
```

Get `ownUid` from `useAuthStore(s => s.uid)`.

For `listPartnerReviews` callable — extend the existing `adminScope` mechanism to also accept `mode: 'own'` where the caller's uid must match the requested `partnerUid`. (Bundle E §E added admin mode; this adds own-mode.)

Pin **+3 tests** on the pure auth helper for the own-mode path.

---

## §C — Match shop rating count to visible (Finding #3)

**Current:** `shops/{shopId}.ratingCount` increments at submit time for ALL ratings, including ones that immediately enter `flagged_low`. Customer ShopReviewsScreen filters to `correctionState === 'published'`. Result: `(2)` next to stars but only 1 visible review.

**Fix:** Add `publicRatingCount` field. Increment only when correctionState transitions to `published`. Customer-facing surfaces use this.

### §C.1 — Server: split count at write time

In `submitOrderRating` (functions/src/index.ts ~line 8825):

```ts
// BEFORE — increment ratingCount unconditionally
tx.set(shopRef, { ratingAvg: shopAvg, ratingCount: shopCount, ... }, { merge: true });

// AFTER — additionally only increment publicRatingCount if state is published at submit time
// (i.e. high-rated reviews that don't enter flagged_low)
const isPublishedAtSubmit = reviewDoc.correctionState === 'published';
const publicCountDelta = isPublishedAtSubmit ? 1 : 0;
tx.set(
  shopRef,
  {
    ratingAvg: shopAvg,
    ratingCount: shopCount, // total (admin sees this)
    publicRatingCount: FieldValue.increment(publicCountDelta), // public-visible (customer sees this)
    ...,
  },
  { merge: true },
);
```

Mirror the same for `users/{deliveryPersonId}` partner stats with new `publicDeliveryRatingCount`.

### §C.2 — Server: increment on state transition

In `respondToReview`, `amendRating`, `acknowledgeReview`, and the 7-day auto-publish scheduled function — wherever `correctionState` transitions INTO `'published'` — increment `publicRatingCount` on the shop and `publicDeliveryRatingCount` on the partner.

Add a pure helper `computePublicCountDelta(prevState, nextState)`:

```ts
export function computePublicCountDelta(
  prev: ReviewCorrectionState | null | undefined,
  next: ReviewCorrectionState,
): 0 | 1 {
  if (next !== 'published') return 0;
  if (prev === 'published') return 0; // idempotent
  return 1;
}
```

Use in every state-transition callable. Pin with **+4 tests** (flagged_low→published, responded→published, amended→published, published→published).

### §C.3 — Client: surfaces switch to publicRatingCount

Grep for everywhere `ratingCount` is rendered customer-facing:

```
grep -rn "ratingCount" src --include="*.tsx"
```

Surfaces likely affected: ShopCard, ShopDetailScreen, ShopListScreen sort-by-most-reviewed, PartnerCard, OrderDetailScreen partner block.

For each:
- Customer-facing → use `publicRatingCount` (or `publicDeliveryRatingCount` for partner)
- Admin-facing (Bundle E §E drill-in) → keep using `ratingCount`

Add a server-side field on the shop/partner doc surface call: include both counts in the response.

### §C.4 — Backfill script

Create `scripts/backfill-public-rating-count.ts`:

- For each shop, query `reviews where shopId == X AND correctionState == 'published'` → count → set `shops/{shopId}.publicRatingCount = count`.
- For each partner, query `reviews where deliveryPersonId == X AND correctionState == 'published'` → count → set `users/{uid}.publicDeliveryRatingCount = count`.
- Same safety pattern as §A.5.

Pin **+4 tests** on the pure helper that derives counts from a list of review docs.

---

## §D — Partner photo audit-grep + add missing surfaces (Finding #4)

**Current:** Photo present on customer OrderDetail, ShopOrderDetail, BecomeDeliveryPartner. **Missing on:**
1. `PartnerReviewsScreen` — header has no photo of the partner being reviewed
2. `AdminUserDetailScreen` (`src/screens/admin/UserDetailScreen.tsx:214`) — partner section likely no photo
3. `RatingAmendmentScreen` (`src/screens/customer/RatingAmendmentScreen.tsx`) — customer sees partner response but not partner photo
4. `ResponseModal` is shop/partner-facing (customer doesn't see it) — out of scope
5. `PartnerDetailsSheet.tsx` already has photo logic — verify it's actually rendering

### §D.1 — Audit-grep

```
grep -rn "deliveryPersonName\|partnerName" src --include="*.tsx" | grep -v "Photo\|photoUrl\|formatPartnerAvatar"
```

Walk every remaining hit. For each, decide: (a) does this surface show partner identity to a human? (b) is it the kind of surface where seeing a face matters?

### §D.2 — Add photo to surfaces 1, 2, 3 above

For each surface:
- Use `formatPartnerAvatar(name, photoUrl)` → if `kind === 'photo'`, render Image; else render initials block.
- Include `onError` → initials fallback (the HOTFIX-PROFILE-PHOTO §E pattern).
- Size: 40×40 for inline / 64×64 for headers.

For `PartnerReviewsScreen`, fetch the partner's `profilePhotoUrl` via a small server-side extension on `listPartnerReviews` (return `{ partnerName, partnerPhotoUrl, partnerRatingAvg, publicRatingCount, reviews }` instead of just `reviews`).

For `RatingAmendmentScreen`, the order doc already has `deliveryPersonPhotoUrl` denormalized — just render it.

For `AdminUserDetailScreen`, the user doc has `profilePhotoUrl` — render it in the partner-role block.

Pin **+3 tests** on a small `partnerHeaderViewModel` helper that combines name + photo + rating + count into one render-ready object.

---

## §E — Online payment "no cash needed" indicator (Finding #5)

**Current:** `DeliveryDashboardScreen.tsx:1426` gates the Cash/UPI confirmation pill on `paymentMethod === 'cod' && paymentStatus !== 'paid'`. CORRECT for the gating. BUT: for online-paid orders, there's no positive indicator that payment is already received.

**Fix:** Render a "💳 Paid online · no cash to collect" badge whenever `paymentMethod === 'online'` OR (`paymentMethod === 'cod' && paymentStatus === 'paid'` AND `paidMethod === 'online'` — the COD-converted case).

### §E.1 — Pure helper

Create `src/utils/derivePartnerPaymentBadge.ts`:

```ts
export type PartnerPaymentBadge =
  | { kind: 'paid_online'; label: string }
  | { kind: 'paid_cash'; label: string }
  | { kind: 'awaiting_cod'; label: string }
  | { kind: 'none' };

export function derivePartnerPaymentBadge(order: {
  paymentMethod?: 'cod' | 'online' | null;
  paymentStatus?: 'paid' | 'unpaid' | 'not_required' | null;
  paidMethod?: 'cash' | 'online' | null;
}): PartnerPaymentBadge {
  if (order.paymentMethod === 'online' && order.paymentStatus === 'paid') {
    return { kind: 'paid_online', label: '💳 Paid online · no cash to collect' };
  }
  if (order.paymentMethod === 'cod' && order.paymentStatus === 'paid') {
    if (order.paidMethod === 'online' || order.paidMethod === 'cash') {
      const isCash = order.paidMethod === 'cash';
      return isCash
        ? { kind: 'paid_cash', label: '💵 Cash received' }
        : { kind: 'paid_online', label: '💳 Paid online · no cash to collect' };
    }
    return { kind: 'paid_online', label: '💳 Payment received' };
  }
  if (order.paymentMethod === 'cod' && order.paymentStatus !== 'paid') {
    return { kind: 'awaiting_cod', label: 'COD — confirm cash or UPI received' };
  }
  return { kind: 'none' };
}
```

Pin **+5 tests** covering each branch + edge (null fields, unknown method).

### §E.2 — Render in DeliveryOrderDetailScreen + DeliveryDashboardScreen cards

Replace ad-hoc payment-state UI with a single `<PaymentBadge order={order} />` component reading from the helper. Always render a positive indicator when paid (online or cash). Only render Cash/UPI pills for the `awaiting_cod` branch.

This means the dashboard card for an online-paid order now shows "💳 Paid online" rather than nothing, and the COD-converted-online order also shows the same green badge.

---

## Discipline checklist

1. **Rule 1** — every new import / state carries "PR-NEXT-BUNDLE-G — DO NOT REMOVE" comments.
2. **Rule 2** — `deliveriesCompleted` useState above all conditional returns in DeliveryProfileScreen.
3. **Rule 5** — schema audit-grep table in header. **Three new schema-additive fields:** `deliveriesCompleted` on user doc, `publicRatingCount` on shop doc, `publicDeliveryRatingCount` on user doc. Each backfilled by a one-shot script.
4. **Rule 7** — auth.token shape verified (post-HOTFIX-RATING-RESPONSE Rule 5 worked example #2 — `claims.delivery` not `claims.isDelivery`).
5. **Rule 8** — FEATURES.md update list is in the Doc trail section below. **This is a 5-section PR — every section touches FEATURES.md rows.** Cascade must NOT skip the FEATURES.md edits; they are first-class deliverables alongside code + tests. Verification step: after applying all FEATURES.md edits, grep `Bundle G` in `docs/FEATURES.md` and confirm count matches the expected 9 row-touches enumerated in Doc trail.
6. **Rule 11** — IAM verify on EVERY modified callable: `getMyDeliverySettings`, `submitOrderRating`, `respondToReview`, `amendRating`, `acknowledgeReview`, `listPartnerReviews`, `markDelivered`, `claimDelivery`. 8 services.
7. **Rule 13** — N/A.
8. **Rule 14** — all server-side new helpers return Result.
9. **Schema-additive** — 3 new optional fields only. No required-field additions.
10. **Test discipline:** §A +5, §B +3, §C +4 (state delta) + +4 (backfill helper), §D +3, §E +5 = **+24 tests minimum.** Suite ~1458 → ~1482.

## Acceptance checklist

1. **§A** As a delivery partner with 4 deliveries and 2 ratings, open Profile. See `⭐ 5.0 · 2 ratings` AND below it `4 deliveries completed`. Numbers are accurate.
2. **§B** Tap the rating row → PartnerReviewsScreen opens showing your own reviews (own mode — sees flagged_low too).
3. **§C** As a customer, open a shop with 1 published review + 1 flagged_low. Header shows `⭐ X.X (1 review)`. ShopReviewsScreen shows 1 review. **Counts match.**
4. **§C** As admin, drill into the same shop. See `⭐ X.X (2)` total — admin mode header keeps using `ratingCount`. Drill-in shows both reviews with state pills (existing Bundle E §E behavior).
5. **§D** As a customer, open PartnerReviewsScreen for a partner → see partner photo + name at top.
6. **§D** As admin, open UserDetailScreen for a delivery partner → see photo prominently displayed in the delivery-role section.
7. **§D** As a customer who left a low rating that the partner responded to, open RatingAmendmentScreen → see partner's photo + name + their response text.
8. **§E** As a delivery partner, claim a fully-online-paid order → dashboard card shows "💳 Paid online · no cash to collect" badge from the moment of claim. No cash/UPI confirmation pills.
9. **§E** Claim a COD order → "COD — confirm cash or UPI received" badge + the pills. Tap Cash → badge flips to "💵 Cash received" + pills disappear. Mark Delivered enables.
10. **§E** As a customer on a COD order, mid-flow tap "Pay online now" → payment succeeds → partner's dashboard now shows "💳 Paid online" badge (the COD-converted-online case).
11. **Cloud Run IAM** verify on all 8 affected services.
12. `tsc` + tests clean. Suite +24 minimum.
13. **Deliberate-break demo:** revert §C's `publicRatingCount` increment to also fire on flagged_low submission. Run tests. The `computePublicCountDelta` test for `flagged_low → published` transition must still pass, but the integration test that pins customer-vs-admin count divergence must fail. Restore. Tests pass.

## Out of scope (deferred to Phase B or later)

- Pagination of own-mode `PartnerReviewsScreen` beyond what `listPartnerReviews` already supports.
- Notifying partner when COD is converted to online (PR-NEXT-COD-UX already does this — verify still fires post-PR).
- Aggregated earnings dashboard tying paid-online vs paid-cash totals separately (out of scope; Bundle D §D already shows total earnings without payment-method split).
- Reverse direction: shop's "ratings" count vs "orders fulfilled" count parallel to §A (Sudhir didn't ask; skip unless requested).

## Deploy

```
cd functions; npm run build; cd ..

firebase deploy --only "functions:getMyDeliverySettings,functions:submitOrderRating,functions:respondToReview,functions:amendRating,functions:acknowledgeReview,functions:listPartnerReviews,functions:markDelivered,functions:claimDelivery"

foreach ($svc in 'getmydeliverysettings','submitorderrating','respondtoreview','amendrating','acknowledgereview','listpartnerreviews','markdelivered','claimdelivery') {
  gcloud run services get-iam-policy $svc --region=asia-south1 --project=grocery-mvp-dev
}
# Re-bind any that return etag: ACAB.

# Backfill (dry-run first, then --execute when comfortable)
npx tsx scripts/backfill-deliveries-completed.ts
npx tsx scripts/backfill-deliveries-completed.ts --execute --admin-uid=<sudhir-admin-uid>

npx tsx scripts/backfill-public-rating-count.ts
npx tsx scripts/backfill-public-rating-count.ts --execute --admin-uid=<sudhir-admin-uid>

eas update --branch production --message "Bundle G — reviews polish + payment receipt + partner photo audit"
```

## Doc trail (Cowork)

After ship:

- **TESTING-FINDINGS** — close #2, #2b, #3, #4, #5.
- **CLAUDE.md** In-flight strike.
- **SESSION_LOG** paragraph.
- **PRELAUNCH_CHECKLIST** — append Bundle G section.
- **FEATURES.md** (per PROMPT_AUTHORING_NOTES Rule 8 — mandatory, this is a 5-section PR so multiple row touches):

  **§A — Deliveries completed tracking:**
  - **Delivery panel §3.5 Profile** — edit "Rating + delivery count" row: description changes from `"Read-only display of own rating + lifetime deliveries"` to `"Read-only display of own rating count + lifetime deliveries completed (separate counters)"`. Source column → `Bundle G §A`.
  - **Cross-cutting §5.9 Operational scripts** — ADD new row: `backfill-deliveries-completed | One-shot — sets users/{uid}.deliveriesCompleted from delivered-orders count | Bundle G §A | shipped`.

  **§B — Tappable rating row → own reviews:**
  - **Delivery panel §3.8 Reviews** — edit "See public reviews" row: description changes to `"Tap own rating row in Profile → read-only list of own delivery reviews (own mode shows pre-published too)"`. Source column → `Bundle G §B`.

  **§C — publicRatingCount split:**
  - **Customer panel §1.5 Shop detail** — edit "Tappable rating row" row: source column updated to `Bundle G §C` (count now matches what's visible). No description change.
  - **Customer panel §1.9 Ratings & reviews** — edit "Shop reviews screen" row: append to description `"; count next to stars matches visible review list (publicRatingCount field)"`. Source column → `Bundle G §C`.
  - **Admin panel §4.2 Shop moderation** — edit "Drill-in to shop reviews" row: append to description `"; admin sees total ratingCount, customer sees publicRatingCount — divergence is by design"`. Source column → `Bundle G §C`.
  - **Cross-cutting §5.9 Operational scripts** — ADD new row: `backfill-public-rating-count | One-shot — sets shops/{shopId}.publicRatingCount + users/{uid}.publicDeliveryRatingCount from published-only review counts | Bundle G §C | shipped`.

  **§D — Partner photo audit:**
  - **Customer panel §1.9 Ratings & reviews** — edit "Partner reviews screen" row: append to description `"; partner photo + name + rating in header"`. Source column → `Bundle G §D`.
  - **Customer panel §1.9 Ratings & reviews** — edit "Low-rating correction workflow" row: append to description `"; partner photo shown on customer's RatingAmendmentScreen alongside response"`. Source column → `Bundle G §D`.
  - **Admin panel §4.3 Delivery partner moderation** — edit "Partner detail (admin)" row: append to description `"; profile photo prominently displayed`. Source column → `Bundle G §D`.

  **§E — Online payment badge:**
  - **Delivery panel §3.7 Active delivery flow** — ADD new row: `Payment status badge | "Paid online · no cash to collect" / "Cash received" / "Awaiting COD" badge based on derivePartnerPaymentBadge helper | Bundle G §E | shipped`.
  - **Delivery panel §3.7 Active delivery flow** — edit "COD cash confirmation" row: append `"; only rendered for COD-unpaid orders (badge replaces it otherwise)"`. Source column → `Bundle G §E`.

  **Last updated** stamps on every section touched above → 2026-06-10.

- **PROMPT_AUTHORING_NOTES.md** — note that schema-additive fields with public-vs-total semantics are now a known pattern (`publicRatingCount` + `ratingCount` split is the worked example). Add as Rule 5 corollary or new sub-rule.
