# PR-NEXT-5.1 — Close the review-system workflow loop

**Source:** PR-5 (REVIEW-SYSTEM) shipped the infrastructure but Devin's own summary listed six functional gaps as "Notable follow-ups." Without these, the correction workflow can't actually run end-to-end: customer rates low → shop gets push → shop opens app and has NO respond button → customer never sees a response → 7-day timeout fires → review publishes unresolved. Half-shipped feature.

**Design lens — make the loop actually close.** Each gap below is a small surface, but together they're the difference between "infrastructure exists" and "the feature works."

**Deploy class:** **server-first** (1 modified callable for customerName denorm + Firestore rules update) → IAM verify → client OTA. No new callables — PR-5 already shipped `respondToReview`, `amendRating`, `acknowledgeReview`, `listShopReviews`.

## Autonomous execution authorization

You may run the following without stopping to confirm — execute, report results in the final summary:

- All `Read`, `Grep`, `Glob`, `ls`, `git status`, `git diff` (read-only)
- `npx tsc --noEmit` (root and `functions/`)
- `npm test`, `npm run test:unit`, `npm run test:full`, `npx jest`
- `npm run lint`, `npx eslint`
- `cd functions && npm run build`
- File edits to files explicitly named in §A–§G below
- New file creation in directories explicitly named in the plan
- Re-running any of the above to verify after fixing an error

You MUST stop and ask before:

- Deploy commands: `firebase deploy …`, `eas update`, `eas build`, `gcloud run …`
- File deletes
- Force-push, rebase, branch ops
- Editing files NOT named in §A–§G
- Adding NEW dependencies not listed in the plan
- Schema additions not in the spec
- Firestore rules changes outside the `reviews` collection block

Default posture: **execute, report at end.**

## Schema audit-grep (Rule 5)

```
grep -rn "respondToReview\|ResponseModal\|ShopReviewsScreen\|PartnerReviewsScreen" src
grep -rn "submitOrderRating\|reviews/" functions/src src
grep -rn "customerName\|user.displayName" functions/src
grep -rn "match /reviews\|reviews/{" firestore.rules
```

| Symbol | Confirmed at | Notes |
| --- | --- | --- |
| `respondToReview` callable | `functions/src/index.ts` (PR-5) | Already exists — client just needs UI to invoke it. Auth gate: shop owner OR partner of the rating. |
| `submitOrderRating` | `functions/src/index.ts` (PR-5 extended) | Bundle adds `customerName` denorm at write time. Single-line change. |
| `ShopReviewsScreen` | `src/screens/ShopReviewsScreen.tsx` (PR-5) | Exists. PR-5.1 adds entry point + uses `customerName` field that this PR denorms. |
| `RatingAmendmentScreen` | `src/screens/RatingAmendmentScreen.tsx` (PR-5) | Exists. No change in this PR. |
| `firestore.rules` `reviews/` block | (find via grep) | **Currently absent** — writes either fail entirely or pass without authz. Pilot-blocker. |
| `customerName` field on review doc | **NOT yet stamped at write time** — Devin listed as follow-up | Bundle adds at submitOrderRating server side. |

## Surfaces and mockups (Rule 6)

### §A — Shop owner Respond CTA on ShopOrderDetailScreen

When customer has rated low (correctionState: `flagged_low`) AND caller is shop owner of this order's shop → show Respond CTA. After response sent → state flips to `responded` and CTA shows "Edit response" until customer acts.

```
┌─────────────────────────────────────┐
│ ← Order details                     │
├─────────────────────────────────────┤
│ ...existing order info...           │
│                                     │
│ ⚠️ Customer left a 1★ rating         │  ← NEW BANNER
│                                     │
│ "Missing one item from my order"    │  ← review.comment shown
│                                     │
│ [ 📝 Respond to review ]            │  ← TRIGGERS RESPONSE MODAL
│                                     │
│ ...existing order info...           │
└─────────────────────────────────────┘
```

After response sent:

```
│ ⚠️ Customer left a 1★ rating         │
│ "Missing one item from my order"    │
│                                     │
│ Your response (sent Jun 9, 14:23):  │  ← SHOWS RESPONSE
│ "Sorry for the missing item!       │
│ We've refunded ₹80 + added a ₹50    │
│ voucher for next order."            │
│                                     │
│ Waiting on customer to acknowledge  │
│ or amend (5 days left).             │  ← TIMEOUT COUNTDOWN
```

### §B — Partner Respond CTA on DeliveryOrderDetailScreen

Mirror of §A but for partner-rated low reviews. Banner shows the partner's stars + comment; same Respond modal.

### §C — Reusable ResponseModal

```
┌─────────────────────────────────────┐
│ ━━━━                                │  ← BottomSheet handle
│                                     │
│ Respond to 1★ review                │
│                                     │
│ "Missing one item from my order"    │
│                                     │
│ Your response:                      │
│ ┌─────────────────────────────────┐ │
│ │ Sorry for the missing item!    │ │
│ │ We've refunded ₹80...           │ │
│ │ (max 280 chars)            123/280│
│ └─────────────────────────────────┘ │
│                                     │
│ Tips: be specific, apologize, offer │
│ a remedy. Customer can amend their  │
│ rating after seeing your response.  │
│                                     │
│ [ Cancel ]      [ Send response ]   │
└─────────────────────────────────────┘
```

KeyboardAvoidingView per Bundle A §D pattern.

### §D — PartnerReviewsScreen

Mirror of ShopReviewsScreen but reads partner's published reviews:

```
┌─────────────────────────────────────┐
│ ← Rahul Bhat · Reviews              │
├─────────────────────────────────────┤
│                                     │
│ ⭐ 4.6  ·  87 deliveries · 24 reviews│
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ ⭐⭐⭐⭐⭐  by Priya              │ │
│ │ "Very polite, on time"          │ │
│ │ 1 day ago                       │ │
│ └─────────────────────────────────┘ │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ ⭐⭐⭐  by Rohan                  │ │
│ │ "Bag was damaged"               │ │
│ │ Partner responded: "Sorry, my   │ │
│ │ scooter slipped..."             │ │
│ │ 3 days ago                      │ │
│ └─────────────────────────────────┘ │
└─────────────────────────────────────┘
```

Same paginated FlatList + ReviewCard pattern as ShopReviewsScreen. Reuses the existing `listShopReviews`-style callable but for partner uid (extend or add `listPartnerReviews` — grep to check if PR-5 already has a generic version).

### §E — Entry points

- **Customer ShopDetailScreen** — add a tappable row near the rating display: `⭐ 4.7 · 142 reviews ›` → tapping opens ShopReviewsScreen.
- **Customer PartnerDetailsSheet** — the trust line `⭐ 4.8 · 142 deliveries` becomes tappable → opens PartnerReviewsScreen.

---

## Plan

### §A — `ShopOrderDetailScreen` low-rating banner + Respond CTA

`src/screens/shop/ShopOrderDetailScreen.tsx`:

1. Read `order.correctionState` + `order.ratingId` (PR-5 schema fields). If `correctionState === 'flagged_low'` OR `correctionState === 'responded'` → render the banner.
2. Fetch the review doc on mount: `orderService.getReview(order.ratingId)` (PR-5 likely has this; if not, add a tiny wrapper around the existing Firestore read). Cache in state.
3. Show banner with `review.shopStars` + `review.comment`.
4. If `correctionState === 'flagged_low'` → render `[📝 Respond to review]` button → opens ResponseModal.
5. If `correctionState === 'responded'` → show the response text + timeout countdown ("Waiting on customer (5 days left)").
6. On response sent (modal `onSubmit`) → call `orderService.respondToReview({ ratingId, responseText, responseBy: 'shop' })` → refresh local state.

### §B — `DeliveryOrderDetailScreen` low-rating banner + Respond CTA

Mirror of §A using `review.deliveryStars` + `responseBy: 'partner'`. Same ResponseModal component, different `responseBy` value passed.

### §C — Reusable `ResponseModal` component

`src/components/order/ResponseModal.tsx`:

```tsx
type Props = {
  visible: boolean;
  onClose: () => void;
  onSubmit: (responseText: string) => Promise<void>;
  stars: number;
  comment: string | null;
  responseBy: 'shop' | 'partner';
};
```

Uses HOTFIX-7 `BottomSheet` chrome (Rule 13). 280-char limit on the response text. Submit button disabled when text is empty or `submitting`. KeyboardAvoidingView wraps the input (Bundle A §D pattern).

### §D — `PartnerReviewsScreen`

`src/screens/PartnerReviewsScreen.tsx` — clone of `ShopReviewsScreen` reading partner reviews. New `listPartnerReviews({ partnerUid, limit, cursor })` callable OR extend `listShopReviews` to be `listEntityReviews({ entityType: 'shop' | 'partner', entityId, ... })` — pick based on what PR-5 actually shipped (grep first).

Same `ReviewCard` component as ShopReviewsScreen — already presentational. Empty state when partner has no published reviews yet.

### §E — Entry points

`src/screens/ShopDetailScreen.tsx` — find the existing rating display (probably reads `shop.ratingAvg` + `shop.ratingCount`). Wrap in a `Pressable`:

```tsx
<Pressable onPress={() => nav.navigate('ShopReviews', { shopId: shop.id })}>
  <Text>⭐ {shop.ratingAvg?.toFixed(1) ?? '—'} · {shop.publicReviewCount ?? 0} reviews ›</Text>
</Pressable>
```

`src/components/order/PartnerDetailsSheet.tsx` — wrap the trust line in a Pressable:

```tsx
<Pressable onPress={() => nav.navigate('PartnerReviews', { partnerUid: order.deliveryPersonId })}>
  <Text style={styles.trust}>{trust.trustLine} ›</Text>
</Pressable>
```

Wire both new routes in `src/navigation/AppNavigator.tsx`.

### §F — Server: `customerName` denormalization at submitOrderRating

`functions/src/index.ts` — in the existing `submitOrderRating` callable, extend the review doc write to include:

```ts
// PR-NEXT-5.1 — denormalize customer name onto review at write time.
// Otherwise the public listing shows "by ..." with no name. Pull
// from auth.token.name (Firebase Auth display name) or fall back to
// users/{uid}.displayName. Anonymous customers (rare) get 'Anonymous'.
const customerProfile = await db.doc(`users/${auth.uid}`).get();
const customerName =
  customerProfile.data()?.displayName ??
  auth.token?.name ??
  'Anonymous';

await db.collection('reviews').doc(reviewId).set({
  // ...existing fields...
  customerName,
  customerUid: auth.uid,
}, { merge: true });
```

`Review` type in `src/types/index.ts` gains `customerName: string` + `customerUid: string` (denormalized read fields).

Pin with **+3 tests** in `tests/functions/submitOrderRatingHelpers.test.ts` (or wherever existing tests live): with displayName, without displayName but auth.token.name, with neither (anonymous fallback).

### §G — Firestore rules for `reviews` collection

`firestore.rules` — add a `reviews/{ratingId}` block:

```
match /reviews/{ratingId} {
  // Reads: anyone can read PUBLISHED reviews. Pre-published reviews
  // (flagged_low, responded states) only readable by:
  //   - the customer who wrote it (customerUid)
  //   - the shop owner of the shop being rated (via order lookup)
  //   - the partner being rated (via order lookup)
  //   - admin
  allow read: if
    resource.data.publishedAt != null ||
    request.auth.uid == resource.data.customerUid ||
    request.auth.token.admin == true ||
    // Shop owner check: the order this review belongs to has shopId matching their claim
    (request.auth.token.shopOwner == true &&
     get(/databases/$(database)/documents/orders/$(resource.data.orderId)).data.shopId == request.auth.token.shopId) ||
    // Partner check: caller is the deliveryPersonId on the order
    (request.auth.token.delivery == true &&
     get(/databases/$(database)/documents/orders/$(resource.data.orderId)).data.deliveryPersonId == request.auth.uid);

  // Writes: only via Admin SDK from server callables (respondToReview,
  // amendRating, acknowledgeReview, publishTimedOutReviews). Client
  // direct writes always denied — defense in depth.
  allow write: if false;
}
```

Pin with **+5 rules tests** in `tests/rules/reviews.test.ts` (or extend existing): customer reads own pre-published, customer reads other's pre-published (denied), shop owner reads pre-published for their shop (allowed), shop owner reads pre-published for different shop (denied), anyone reads published.

---

## Discipline checklist

1. **Rule 1** — every new import + state read carries "PR-NEXT-5.1 — DO NOT REMOVE" comments.
2. **Rule 2** — useStates in modified screens sit with other top-level hooks above conditional returns.
3. **Rule 5** — schema audit-grep table in header. `customerName` + `customerUid` are NEW denormalized fields on review doc; legacy pre-PR-5.1 reviews render as "Anonymous" via fallback.
4. **Rule 7** — test fixtures use real auth.token shape (`uid`, `name`, `admin`, `shopOwner`, `shopId`, `delivery`).
5. **Rule 11** — IAM verify on `submitOrderRating` (modified). All other PR-5 callables unchanged; no re-verify needed.
6. **Rule 13** — ResponseModal uses `BottomSheet` chrome (HOTFIX-7). Audit-grep confirms no new bottom-anchored modal bypasses it.
7. **Rule 14** — N/A (no new validators; existing PR-5 helpers cover state transitions).
8. **Schema-additive only** — 2 new fields on review doc (`customerName`, `customerUid`). Legacy reviews fallback to "Anonymous" + uid lookup unavailable.
9. **Test discipline:** **+3** (customerName denorm) + **+5** (Firestore rules) = **+8 tests minimum.** Suite trajectory roughly 1410 → ~1418.

## Acceptance checklist

**§A Shop respond:**

1. Customer rates 1★ shop. Within 30s, shop owner gets LOW-RATING push (PR-4). Taps push → lands on ShopOrderDetail.
2. **Banner visible at top** showing `⚠️ Customer left a 1★ rating` + comment.
3. `[📝 Respond to review]` button visible. Tap → ResponseModal opens via BottomSheet chrome.
4. Type response (max 280 chars). Char counter updates. Tap "Send response."
5. Modal closes. Banner now shows shop's response text + `Waiting on customer (7 days left)`.
6. **Customer side:** customer gets push within 30s → opens RatingAmendmentScreen (PR-5). Sees the response. Customer keeps original OR amends.
7. After customer acts → state → `published`. Banner on shop side updates to `Review published with your response`.

**§B Partner respond:**

8. Customer rates 1★ partner. Partner taps LOW-RATING push → lands on DeliveryOrderDetail. Banner visible. Respond CTA opens same ResponseModal with `responseBy: 'partner'`. Same flow as §A.

**§D PartnerReviewsScreen:**

9. Open Customer's PartnerDetailsSheet for an active order. Trust line `⭐ 4.6 · 87 deliveries ›` is now tappable. Tap → PartnerReviewsScreen opens. Shows partner's published reviews paginated.

**§E Entry points:**

10. Customer ShopDetailScreen — rating line `⭐ 4.7 · 142 reviews ›` is tappable. Tap → ShopReviewsScreen opens.

**§F customerName denorm:**

11. Submit a new rating. Inspect the review doc in Firestore — `customerName` field present, equal to the submitter's displayName.
12. **Legacy fallback** — manually delete `displayName` on a customer user doc, submit rating. Review doc has `customerName: 'Anonymous'`.
13. **Existing legacy reviews** — created pre-PR-5.1 (no customerName field). ShopReviewsScreen renders "Anonymous" gracefully.

**§G Firestore rules:**

14. **Customer reads own pre-published review** — succeeds.
15. **Customer reads another customer's pre-published review** — permission-denied.
16. **Shop owner reads pre-published review for their shop's order** — succeeds.
17. **Shop owner reads pre-published review for another shop's order** — permission-denied.
18. **Anyone reads a published review** — succeeds (publishedAt != null branch).
19. **Anyone tries direct write to /reviews/{x}** — permission-denied (all writes via callables).

**Test suite:**

20. `npx tsc --noEmit` clean (root + functions). `npm run test:unit` clean. `npm run test:full` clean. Suite +8 minimum.

## Out of scope

- **Editing or deleting a submitted response.** Shop/partner gets one shot. If wrong, admin override.
- **Customer thread reply** to the response. Single response from each side; customer's amend or acknowledge closes the loop.
- **Notification when review publishes** (after timeout or customer action). Already fires via existing push pattern; no new push types needed.
- **Aggregated review stats** (e.g., "responded to X% of low ratings") shown publicly on shop card. Could be Phase B+ trust signal.

## Deploy

```
# Server first — submitOrderRating modified for customerName denorm
cd functions; npm run build; cd ..
firebase deploy --only "functions:submitOrderRating"

# IAM verify (Rule 11)
gcloud run services get-iam-policy submitorderrating --region=asia-south1 --project=grocery-mvp-dev

# Firestore rules — adds reviews/{ratingId} block
firebase deploy --only firestore:rules

# Client OTA — bundles all 5 client surfaces (§A-§E)
npx tsc --noEmit
npm run test:unit
eas update --branch production --message "PR-NEXT-5.1 review system loop close: respond CTAs + entry points + rules + customerName denorm"
```

## Doc trail (Cowork, post-ship)

- Append to `docs/TESTING-FINDINGS-2026-05-30.md` — mark #16 as `✅ FULLY CLOSED in PR-NEXT-5.1` (previously partial after PR-5)
- Update `CLAUDE.md` In-flight work
- Append `docs/SESSION_LOG.md` paragraph
- Note in PRELAUNCH_CHECKLIST that the review system is now end-to-end functional
