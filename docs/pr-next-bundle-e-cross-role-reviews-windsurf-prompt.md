# PR-NEXT-BUNDLE-E — Cross-role review visibility (shop + admin)

**Source:** Sudhir's 2026-06-10 findings #8 + #11. Shop currently sees "Partner assigned" on order detail with no name/photo/rating/phone access. Admin can see a shop's rating count "(2)" but can't drill in to see actual comments. Both gaps undercut trust + moderation.

**Design lens — surface the right context for each role.** Shop owner about to hand food to a partner should see who that is (name, photo, rating). Customer who left a low rating should be able to recover via the existing PR-5.1 workflow. Admin moderating issues should see ALL reviews (including pre-published `flagged_low`) for any shop or partner.

**Deploy class:** **server-first** (1 modified callable — extend `listShopReviews` with admin scope; 1 new callable — `listOrderReviewThread` for admin order context) → IAM verify → client OTA.

## Autonomous execution authorization

You may run the following without stopping to confirm — execute, report results in the final summary:

- All `Read`, `Grep`, `Glob`, `ls`, `git status`, `git diff` (read-only)
- `npx tsc --noEmit` (root and `functions/`)
- `npm test`, `npm run test:unit`, `npm run test:full`, `npx jest`
- `npm run lint`, `npx eslint`
- `cd functions && npm run build`
- File edits to files explicitly named in §A–§E below
- New file creation in directories explicitly named in the plan
- Re-running any of the above to verify after fixing an error

You MUST stop and ask before:

- Deploy commands: `firebase deploy …`, `eas update`, `eas build`, `gcloud run …`
- File deletes
- Force-push, rebase, branch ops
- Editing files NOT named in §A–§E
- Adding NEW dependencies not already in package.json
- Schema additions / migrations not in the spec
- Firestore rules / index changes outside the `reviews` block

Default posture: **execute, report at end.**

## Schema audit-grep (Rule 5)

```
grep -rn "ShopOrderDetailScreen\|deliveryPersonName\|deliveryPersonPhotoUrl" src
grep -rn "listShopReviews\|listPartnerReviews" functions/src
grep -rn "ShopReviewsScreen\|PartnerReviewsScreen" src/screens
grep -rn "rating.*shopStars\|deliveryStars" functions/src src
```

| Symbol | Confirmed at | Notes |
| --- | --- | --- |
| `order.deliveryPersonName / PhotoUrl / Rating / DeliveriesCount / VehicleType` | PR-2 + PARTNER-CARD.2 denormalized at claim time | Shop reads these from order doc directly — no extra fetch |
| `getDeliveryPartnerContact` callable | PR-NEXT-PARTNER-CARD.1 | Reuse for post-pickup phone reveal on shop side |
| `listShopReviews` callable | PR-5 | Bundle extends to accept an `adminScope: true` flag for admin caller |
| `Review` schema | PR-5 §A | `correctionState`, `responseText`, `responseBy`, `shopStars`, `deliveryStars`, `comment`, `customerName` (from PR-5.1) |
| `ShopReviewsScreen` | PR-5 §F | Existing; bundle adds `mode='admin'` prop to show pre-published reviews |

## Plan

### §A — ShopOrderDetailScreen partner card (#8)

```
┌─────────────────────────────────────┐
│ ← Order details                     │
├─────────────────────────────────────┤
│ ...existing order info...           │
│                                     │
│ Delivery partner                    │
│ ┌─────────────────────────────────┐ │
│ │ ┌──────┐                        │ │
│ │ │ photo│  Rahul Bhat            │ │
│ │ └──────┘  ⭐ 4.8 · 142 ›        │ │  ← tappable rating row
│ │           🛵 On the way to you  │ │
│ │                                 │ │
│ │  [ 📞 Call Rahul ]              │ │  ← post-pickup only
│ └─────────────────────────────────┘ │
│                                     │
│ ...existing order info...           │
└─────────────────────────────────────┘
```

Replace the existing `Partner assigned` text with a `PartnerCardForShop` component reading directly from order denormalized fields:
- `order.deliveryPersonName` → name
- `order.deliveryPersonPhotoUrl` → photo (initials fallback)
- `order.deliveryPersonRating` + `order.deliveryPersonDeliveriesCount` → tappable rating row → navigates to `PartnerReviewsScreen({ partnerUid: order.deliveryPersonId })` (PR-5 §D)
- `order.deliveryPersonVehicleType` → vehicle icon next to state
- Post-pickup phone reveal: reuse Bundle B's one-tap call CTA (calls `getDeliveryPartnerContact` server-side gated to caller=customer-OR-shop-owner-of-this-shop). Server gate needs extension — see §C below

`PartnerCardForShop` lives in `src/components/order/PartnerCardForShop.tsx`. Mostly presentational; reuses `formatPartnerAvatar` (PR-2) + `formatPartnerTrust` (PARTNER-CARD.2).

### §B — Customer rating display on ShopOrderDetail (#8 part 2)

When `order.correctionState === 'published'` or `'flagged_low'` or `'responded'`, show the rating section below partner card:

```
│ Customer rated this order           │
│ ┌─────────────────────────────────┐ │
│ │ Shop:  ⭐⭐⭐⭐                  │ │
│ │ Delivery: ⭐⭐⭐⭐⭐               │ │
│ │ Comment: "Fast and fresh!"       │ │
│ │                                 │ │
│ │ (Your response, if any:)        │ │
│ │ "Thanks for the kind words!"    │ │
│ └─────────────────────────────────┘ │
```

Reads `order.ratingId` (PR-5 set this at submitOrderRating time), fetches the review doc via `getReview({ ratingId })` callable. Auth gate: shop owner of this shop OR admin OR customer who wrote it.

Already present from PR-5.1's banner; this just makes it visible POST-resolution (not just during `flagged_low`/`responded`).

### §C — Server gate extension on `getDeliveryPartnerContact`

`functions/src/partnerContactHelpers.ts`:

Current gate (HOTFIX customerUid version): caller must be `order.customerUid`. Extend to allow shop owner of `order.shopId`:

```ts
const isCustomer = order.customerUid === args.callerUid;
const isShopOwner =
  args.callerClaims?.shopOwner === true &&
  args.callerClaims?.shopId === order.shopId;
if (!isCustomer && !isShopOwner) {
  return { ok: false, code: 'not_authorized' };
}
```

Discriminated-union Result already in place from PR-NEXT-PARTNER-CARD.1. Just rename `not_customer` → `not_authorized` (same precedent as Bundle B §A's getLivePartnerEta extension).

Pin with **+3 tests**: shop owner of THIS shop → ok; shop owner of OTHER shop → not_authorized; customer of this order → ok (regression).

### §D — Admin moderator view on order detail

Admin order detail (admin screens — find via grep, likely `AdminOrderDetailScreen.tsx`) gets a "Review thread" section that shows BOTH sides + response timeline:

```
│ Review thread                        │
│ ┌─────────────────────────────────┐ │
│ │ Customer rating · Jun 9 14:23   │ │
│ │ Shop: ⭐⭐  Delivery: ⭐⭐⭐⭐⭐   │ │
│ │ "Missing one item from my order"│ │
│ ├─────────────────────────────────┤ │
│ │ Shop response · Jun 9 14:50     │ │
│ │ by US Shoppers                  │ │
│ │ "Sorry for the missing item!   │ │
│ │  Refunded ₹80..."               │ │
│ ├─────────────────────────────────┤ │
│ │ Customer amended · Jun 9 15:10  │ │
│ │ Shop: ⭐⭐⭐⭐ (was ⭐⭐)         │ │
│ │ State: published                │ │
│ └─────────────────────────────────┘ │
```

New callable `getOrderReviewThread({ orderId })`:
- Auth: admin only
- Reads order.ratingId → fetches review doc → returns chronological timeline of events stamped on the doc (submittedAt + correctionState changes + responseAt + amendedAt + publishedAt + amendedStars)

Pure helper `buildReviewTimeline(review)` returns ordered events. Pin with **+5 tests** (no actions yet / responded only / amended / acknowledged / timed out).

### §E — Admin shop review drill-in (#11)

ShopReviewsScreen extended with `mode` prop:
- `mode='public'` (default, customer-facing): shows only `correctionState === 'published'` reviews
- `mode='admin'`: shows ALL reviews including `flagged_low` + `responded` (with state pill on each)

`listShopReviews` callable extension:
- Accept `adminScope?: boolean` arg
- If `adminScope === true`, validate caller has admin claim
- If admin → query `where shopId == X` (no `publishedAt != null` filter)
- If not admin → query `where shopId == X AND publishedAt != null` (existing behavior)

Pure helper `filterReviewsForCaller(reviews, callerIsAdmin)` returns the right subset. Pin with **+4 tests** (admin sees all, public sees only published, mixed state filtering, empty result).

Admin shop view (find via grep, likely `AdminShopDetailScreen.tsx` or `ShopDetailManagementScreen.tsx`) — make the existing rating display `⭐ 4.7 (2)` tappable → navigates to `ShopReviewsScreen({ shopId, mode: 'admin' })`.

Same drill-in for `AdminUserDetailScreen` (for delivery partner uid) — tap rating → `PartnerReviewsScreen({ partnerUid, mode: 'admin' })`.

---

## Discipline checklist

1. **Rule 1** — every new import / state carries "PR-NEXT-BUNDLE-E — DO NOT REMOVE" comments.
2. **Rule 2** — useStates above conditional returns.
3. **Rule 5** — schema audit-grep table in header. Reuses existing denormalized order fields; no new doc fields.
4. **Rule 7** — auth.token shape uses `delivery: true` / `shopOwner: true` / `admin: true` (Rule 5-extension verified after HOTFIX-5).
5. **Rule 11** — IAM verify on `listShopReviews` (modified), `getDeliveryPartnerContact` (modified), `getOrderReviewThread` (new). 3 services.
6. **Rule 13** — N/A.
7. **Rule 14** — all server-side gates return Result.
8. **Schema-additive** — no new fields. All data already on review + order docs.
9. **Test discipline:** +3 (contact gate) + 5 (timeline builder) + 4 (admin filter) = **+12 tests minimum.** Suite ~1448 → ~1460 (assuming Bundle D landed first).

---

## Acceptance checklist

1. As shop owner, open order detail. See partner card with photo, name, rating count (tappable → reviews), vehicle, status. Pre-pickup: phone hidden. Post-pickup: 📞 Call CTA visible, tap dials.
2. Customer rated the order. Below partner card, see "Customer rated this order" block with stars + comment + (if applicable) shop's response.
3. As shop owner of DIFFERENT shop, manually invoke `getDeliveryPartnerContact({ orderId: <other shop's order> })` → `permission-denied`.
4. As admin, open shop in admin section → see rating `⭐ 4.7 (2)` → tap → `ShopReviewsScreen` opens in admin mode showing both published + flagged_low/responded reviews with state pill.
5. As admin, open partner in admin section → tap rating → `PartnerReviewsScreen` opens in admin mode showing all reviews.
6. As admin, open an order with a review thread → see full Review thread section: customer rating → shop response → customer amended → final state.
7. Customer view of `ShopReviewsScreen` (default mode='public') still only shows published reviews; flagged_low remain hidden.
8. **Cloud Run IAM** verify on all 3 affected services.
9. `tsc` + tests clean. Suite +12.

## Out of scope

- **Multi-back-and-forth threads** (customer can't reply to shop's response). Single response from shop; customer amends or acknowledges.
- **Direct chat** between roles. Phone CTA covers urgent contact.
- **Bulk admin moderation tools** (e.g. delete review, flag for spam). Per-review modals only; bulk is post-pilot.
- **Customer rating display on customer's own OrderDetail** (they already see it via RatingAmendmentScreen). No duplication.

## Deploy

```
cd functions; npm run build; cd ..
firebase deploy --only "functions:listShopReviews,functions:getDeliveryPartnerContact,functions:getOrderReviewThread"

foreach ($svc in 'listshopreviews','getdeliverypartnercontact','getorderreviewthread') {
  gcloud run services get-iam-policy $svc --region=asia-south1 --project=grocery-mvp-dev
}

eas update --branch production --message "PR-NEXT-BUNDLE-E cross-role review visibility"
```

## Doc trail (Cowork)

After ship: TESTING-FINDINGS — close #8, #11. CLAUDE.md In-flight strike. SESSION_LOG paragraph.
