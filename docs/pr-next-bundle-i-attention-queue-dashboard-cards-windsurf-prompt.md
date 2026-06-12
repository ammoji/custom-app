# PR-NEXT-BUNDLE-I — Attention queue + dashboard card redesign

**Source:** Sudhir's 2026-06-10 post-Bundle-H request:

> *"Should we have another section for the orders that has low ratings and needs delivery partner and shop attention? right now it is really hard for them to find such orders and take next action. […] I would like to have some type of card for my active deliveries, delivery history, coming soon, available now and new category to handle review and ratings. along with count. that way it will be easy for delivery partner to click and check. right now it is really a small text and hard to click on that particular section."*

Two coupled UX improvements:
1. **Surface review-attention queue.** Low-rated orders awaiting shop/partner response are invisible today — they're nested inside the regular order list with no badge or count. Sudhir manually navigates to the right order to find the Respond button.
2. **Dashboard card redesign.** Section headers are dense text; partner can't scan counts at a glance or tap a clean target. A card grid at the top with counts + tap-to-section is the discoverability fix.

**Deploy class:** **server-first** (1 new callable per role: `listMyAttentionReviews` for delivery partner, `listShopAttentionReviews` for shop owner; both extend the existing `listShopReviews`/`listPartnerReviews` infra) → IAM verify → client OTA. No backfill.

## Design lens

Two principles:
- **Counts are the entry point.** Every dashboard card shows a count; tapping scrolls to or navigates to that section. The count itself is the affordance — partner sees "5 ⚠️ Reviews" and immediately knows to act.
- **Attention queue is a first-class section, not a filter.** Hiding flagged_low orders behind a tab makes them easy to miss. A pinned attention queue at the top of the dashboard guarantees the partner sees it on every app open.

## Schema audit-grep (Rule 5)

```
grep -n "correctionState.*flagged_low\|correctionState === 'flagged_low'" functions/src src
grep -n "listMyDeliveries\|listAvailableDeliveries\|watchMyDeliveries" src/services/orderService.ts
grep -rn "DeliveryDashboardScreen\|ShopOwnerDashboardScreen" src/screens
grep -rn "FlatList.*ListHeaderComponent" src/screens/delivery src/screens/shop | head -5
```

| Symbol | Where | Notes |
| --- | --- | --- |
| `order.correctionState === 'flagged_low'` | Server denorm at submitOrderRating + cascade from HOTFIX-REVIEW-DENORM | Reliable filter for "needs response" |
| `order.deliveryPersonId` | Order doc | Filter "my orders" on partner side |
| `shops/{id}.ownerUid` | Shop doc | Resolve shop owner's shopId to filter orders on shop side |
| Existing `listShopReviews` / `listPartnerReviews` (Bundle E §E) | Already paginated, role-gated | Reuse infra for attention queue |
| `DeliveryDashboardScreen` FlatList | Single FlatList with ListHeaderComponent for non-list sections | Card grid goes in ListHeaderComponent |

No new schema fields. Pure rendering + query addition.

## Autonomous execution authorization

You may run the following without stopping to confirm — execute, report results in the final summary:

- All `Read`, `Grep`, `Glob`, `ls`, `git status`, `git diff` (read-only)
- `npx tsc --noEmit` (root AND `functions/`)
- `npm test`, `npm run test:unit`, `npm run test:full`, `npx jest`
- `cd functions && npm run build`
- File edits to files explicitly named in §A–§F below
- New file creation in `src/components/dashboard/`, `src/utils/`, `functions/src/`, `tests/`

You MUST stop and ask before:
- Deploy commands (`firebase deploy`, `eas update`, `gcloud …`)
- Editing files NOT in the §-named lists (especially: don't touch _publishReview, respondToReview, or any Bundle G/H code unless §-named)
- Schema additions
- New dependencies
- New Firestore composite indexes UNLESS the audit-grep below proves no existing index covers the new query

Default posture: **execute, report at end.**

## Required composite index check (Rule 11 corollary)

The new attention queue query is `where deliveryPersonId == X AND correctionState == 'flagged_low'` (or `where shopId == X AND correctionState == 'flagged_low'` for shop side). Check `firestore.indexes.json` — if no composite index for `(deliveryPersonId ASC, correctionState ASC)` or `(shopId ASC, correctionState ASC)` exists, add one to the indexes file. Server deploy will need `firebase deploy --only firestore:indexes` in addition to functions.

```
grep -A 3 "deliveryPersonId\|correctionState" firestore.indexes.json
```

If new indexes are needed, build time is ~minutes per index for empty/small collections.

## Plan

### §A — Pure helper: dashboard view model

`src/utils/deliveryDashboardViewModel.ts`:

```ts
/**
 * PR-NEXT-BUNDLE-I §A — pure helper that derives the top-of-screen
 * card grid view model from the dashboard's existing data sources.
 *
 * Pinned by tests/utils/deliveryDashboardViewModel.test.ts.
 */

export type DashboardCard = {
  id: 'active' | 'available' | 'coming' | 'history' | 'attention';
  label: string;
  count: number;
  icon: string;
  variant: 'default' | 'urgent';  // urgent → red tint for attention items
  scrollToSection: string | null;  // null = no-op (e.g. empty)
};

export function deriveDeliveryDashboardCards(input: {
  activeCount: number;
  availableCount: number;
  comingUpCount: number;
  historyCount: number;
  attentionCount: number;
}): DashboardCard[] {
  return [
    {
      id: 'active',
      label: 'Active Deliveries',
      count: input.activeCount,
      icon: '🛵',
      variant: 'default',
      scrollToSection: input.activeCount > 0 ? 'my-active' : null,
    },
    {
      id: 'available',
      label: 'Available Now',
      count: input.availableCount,
      icon: '📦',
      variant: 'default',
      scrollToSection: input.availableCount > 0 ? 'available' : null,
    },
    {
      id: 'coming',
      label: 'Coming Up',
      count: input.comingUpCount,
      icon: '⏳',
      variant: 'default',
      scrollToSection: input.comingUpCount > 0 ? 'coming-up' : null,
    },
    {
      id: 'history',
      label: 'Delivery History',
      count: input.historyCount,
      icon: '📋',
      variant: 'default',
      scrollToSection: input.historyCount > 0 ? 'history' : null,
    },
    {
      id: 'attention',
      label: 'Reviews & Ratings',
      count: input.attentionCount,
      icon: '⚠️',
      variant: input.attentionCount > 0 ? 'urgent' : 'default',
      scrollToSection: input.attentionCount > 0 ? 'attention' : null,
    },
  ];
}
```

Pin **+5 tests** (all-zero / mixed / urgent-only / null-defensive on inputs / order stability).

A parallel `deriveShopDashboardCards` helper (Pending / Preparing / Ready / Delivered / Attention) for §C. Same shape, different labels. **+5 tests.**

### §B — DashboardCardGrid component

`src/components/dashboard/DashboardCardGrid.tsx`:

```ts
/**
 * PR-NEXT-BUNDLE-I §B — top-of-dashboard 2-column card grid.
 * Mounts above the existing FlatList sections via ListHeaderComponent.
 * Each card is a large touchable target (height ~88px) showing icon +
 * count + label. Urgent variant tints the card border red.
 */
```

Design:
- 2-column grid, gap spacing.md, marginHorizontal spacing.lg
- Each card 88px height, centered icon + count + label
- Urgent variant: red border, slight red tint background
- Cards with count === 0 stay visible (so partner sees "0 Active") but are tappable as no-op
- Last card "Reviews & Ratings" spans full width if odd count, otherwise 1-col

Use existing `colors`, `radii`, `spacing`, `typography` tokens.

### §C — Delivery dashboard wiring

`src/screens/delivery/DeliveryDashboardScreen.tsx`:

1. Compute counts from existing state (`available.length`, `myActive.length`, etc.) + the new attention count from §D's callable
2. Pass to `deriveDeliveryDashboardCards` helper
3. Render `<DashboardCardGrid cards={cards} onCardPress={handleCardTap} />` at the top of the existing `ListHeaderComponent`
4. Add a new section ABOVE the existing sections: **"Reviews & Ratings"** — collapsible, shows list of orders with flagged_low reviews where the partner can tap to navigate to `DeliveryOrderDetail({orderId})` and respond

Implement `handleCardTap(cardId)` to scroll the FlatList to the corresponding section ref (use FlatList's `scrollToIndex` or section refs). If FlatList scrolling is fiddly, fall back to toggling the section's collapsed state via `setShowX(true)`.

### §D — Server callable: `listMyAttentionReviews` (delivery partner)

`functions/src/index.ts`:

```ts
/**
 * PR-NEXT-BUNDLE-I §D — list this delivery partner's orders that have
 * a flagged_low review awaiting response. Powers the attention queue
 * card + section on DeliveryDashboardScreen.
 *
 * Auth: delivery role required. Composite index needed on
 * orders.deliveryPersonId + orders.correctionState (verify
 * firestore.indexes.json).
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
      .where('correctionState', '==', 'flagged_low')
      .orderBy('updatedAt', 'desc')
      .limit(50)
      .get();
    return {
      orders: snap.docs.map(d => {
        const data = d.data() as Record<string, any>;
        return {
          orderId: d.id,
          shopName: data.shopName ?? null,
          deliveryRating: data.deliveryRating ?? null,
          deliveryComment: data.deliveryComment ?? null,
          deliveredAt: data.deliveredAt ?? null,
          submittedAt: data.publishedAt ?? data.updatedAt ?? null,
        };
      }),
    };
  },
);
```

Pin **+5 tests** on a pure helper `summarizeAttentionReviewRows(orderDocs)` (handles empty / mixed states / missing fields / sort by recency / cap at 50).

### §E — Server callable: `listShopAttentionReviews` (shop owner)

`functions/src/index.ts` — same shape, different gate. Resolves caller's shopId from claims (or via shop lookup if claims.shopId missing) then queries `where shopId == X AND correctionState == 'flagged_low'`. Reuses §D's summarize helper.

Pin **+3 tests** on the auth-resolver helper (claims.shopId / claims missing → resolve via shop doc / non-shop-owner → permission-denied).

### §F — Shop dashboard wiring

`src/screens/shop/ShopOwnerDashboardScreen.tsx`:

Same pattern as §C:
1. Compute counts including attention from §E's callable
2. Render `<DashboardCardGrid cards={cards} />` at top
3. Add "Reviews & Ratings" section showing flagged_low orders; tap navigates to `ShopOrderDetail({orderId})` for the shop's response flow

Shop dashboard cards: Pending / Preparing / Ready / Delivered Today / Reviews & Ratings.

## Discipline checklist

1. **Rule 1** — every new import / state carries "PR-NEXT-BUNDLE-I — DO NOT REMOVE" comments.
2. **Rule 2** — N/A.
3. **Rule 5** — schema audit-grep in header. **Worked example #9 for the discipline notes:** *"Compound `where(field A) AND where(field B) ORDER BY field C` queries require composite indexes. Audit firestore.indexes.json before deploying any new callable that introduces a new combination. Missing index = INTERNAL error on first call."*
4. **Rule 7** — auth.token shape verified (post-HOTFIX-5 / HOTFIX-RATING-RESPONSE: `claims.delivery` not `claims.isDelivery`).
5. **Rule 8** — FEATURES.md update in Doc trail. Multiple rows touched.
6. **Rule 11** — IAM verify on `listMyAttentionReviews`, `listShopAttentionReviews` (2 new services).
7. **Rule 13** — N/A.
8. **Rule 14** — server-side helpers return Result-style payloads where applicable.
9. **Schema-additive** — zero new fields. Pure rendering + query addition. Possibly 1-2 new composite indexes (audit in §-required check above).
10. **Test discipline:** §A +5+5 +§D +5 +§E +3 = **+18 tests minimum.** Suite ~1541 → ~1559.

## Acceptance checklist

1. **§B, §C** Delivery partner opens dashboard → sees 5-card grid at top: Active Deliveries / Available Now / Coming Up / Delivery History / Reviews & Ratings. Each shows count.
2. **§A** When partner has 1 flagged_low order → "Reviews & Ratings" card shows count 1 with red border (urgent variant).
3. **§C** Tap "Reviews & Ratings" card → scrolls (or toggles) to the new Reviews & Ratings section below.
4. **§C** Reviews & Ratings section lists the flagged_low orders with shop name + delivery stars + comment preview. Tap a row → opens `DeliveryOrderDetail` for that order. Partner can respond from there (existing Bundle H flow).
5. **§F** Shop owner sees 5-card grid: Pending / Preparing / Ready / Delivered Today / Reviews & Ratings. Same behavior.
6. **§D, §E** Manually invoke `listMyAttentionReviews` as a non-delivery role → `permission-denied`. Same for `listShopAttentionReviews` with non-shop-owner.
7. **Cloud Run IAM** verify on the 2 new callables. Re-bind `allUsers` if `etag: ACAB`.
8. **Composite index** built (if needed) — Firebase Console shows `idx_orders_deliveryPersonId_correctionState_updatedAt` as ready, not building.
9. `tsc` + tests clean. Suite +18 minimum.
10. **Deliberate-break demo:** revert §A's `attentionCount > 0` urgent-variant logic. The view-model test that asserts `variant: 'urgent'` for non-zero count must fail. Restore. Tests pass.

## Out of scope

- **Customer-side dashboard equivalent.** Customer doesn't have a dashboard; OrderDetail (post-Bundle H) is the surface. Not needed for this PR.
- **Admin-side attention queue.** Admin already has `AdminOrdersScreen` + Bundle E §E review drill-in; no separate attention card needed for pilot scale.
- **Pagination** beyond the 50-order limit. Pilot has at most a handful of flagged_low orders; pagination is a post-pilot concern.
- **Push notification when a new flagged_low order arrives.** Bundle H's push-on-response is the customer→shop/partner direction; the customer→partner-low-rating push fires from `submitOrderRating` (PR-NEXT-LOW-RATING-PUSH) — already shipped. This Bundle adds the in-app discoverability, not new pushes.
- **Real-time watch on the attention queue.** Callable + pull-to-refresh is fine for pilot; partner opens the app and sees current state. Optional future enhancement: convert to `watch*` pattern matching `watchMyDeliveries`.
- **Notifications badge / tab bar count** on the dashboard tab. Nice-to-have but out of scope; cards on the dashboard itself are the primary discoverability fix.

## Deploy

```
# Composite indexes first (if added)
firebase deploy --only firestore:indexes
# Wait for indexes to finish building before deploying functions that use them.

cd functions; npm run build; cd ..
firebase deploy --only "functions:listMyAttentionReviews,functions:listShopAttentionReviews"

foreach ($svc in 'listmyattentionreviews','listshopattentionreviews') {
  gcloud run services get-iam-policy $svc --region=asia-south1 --project=grocery-mvp-dev
}

eas update --branch production --message "Bundle I — attention queue + dashboard card grid (delivery + shop)"
```

## Doc trail (Cowork)

After ship:

- **TESTING-FINDINGS** — close Sudhir's discoverability requests #2 and #3 from 2026-06-10.
- **CLAUDE.md** In-flight strike.
- **SESSION_LOG** paragraph covering the dashboard redesign + the attention queue surfacing.
- **PRELAUNCH_CHECKLIST** — append Bundle I section.
- **PROMPT_AUTHORING_NOTES** — add **Rule 5 worked example #9** (composite index audit before new compound query callables).
- **FEATURES.md** (per Rule 8 — mandatory):
  - **Delivery panel §3.3 Home / dashboard** — ADD new row: `Dashboard card grid | 5-card grid at top: Active / Available / Coming Up / History / Reviews & Ratings — each tappable with count, urgent variant for non-zero attention items | Bundle I §A+§B+§C | shipped`.
  - **Delivery panel §3.3 Home / dashboard** — ADD new row: `Reviews & Ratings section | Lists flagged_low orders awaiting partner response; tap → DeliveryOrderDetail for response flow | Bundle I §C+§D | shipped`.
  - **Shop panel §2.2 Order management** — ADD new row: `Dashboard card grid | 5-card grid at top: Pending / Preparing / Ready / Delivered Today / Reviews & Ratings | Bundle I §A+§F | shipped`.
  - **Shop panel §2.5 Reviews** — ADD new row: `Reviews & Ratings section on dashboard | Lists flagged_low orders awaiting shop response; tap → ShopOrderDetail for response flow | Bundle I §E+§F | shipped`.
  - **Last updated** stamps on affected sections → 2026-06-10.
