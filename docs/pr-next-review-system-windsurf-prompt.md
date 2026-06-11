# PR-NEXT-REVIEW-SYSTEM — Public reviews + low-rating customer-correction workflow

**Source:** Sudhir's 2026-06-09 e2e finding #16: *"There should be a review option for customer to see shop and delivery partner review… There should be a workflow to show review comments only after all the corrections are made if service is lower than 3 stars. So customer will have final option to correct the comments and rating if issue is resolved."* Scope locked via pre-design check: **full correction workflow with customer amend.**

**Design lens — earned public trust:** customers comparing shops should see real reviews to inform their choice. But a single bad day shouldn't tank a shop's listing if they recover — when a shop owner sees a 1-star review, contacts the customer, refunds, apologizes, and the customer agrees the issue's resolved, the rating should reflect that recovery. Low ratings are private until either (a) the shop/partner has responded AND the customer either confirms resolution or doesn't engage within N days, or (b) the customer explicitly publishes the unresolved review. Above-threshold ratings publish immediately.

**Deploy class:** **server-first** (4 new callables — respond / amend / publish / acknowledge — + extension to existing rating submission) → IAM verify → client OTA.

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
- Schema additions / migrations not in the spec
- Firestore rules changes not in the spec

Default posture: **execute, report at end.**

## Schema audit-grep (Rule 5)

```
grep -rn "OrderRating\|orderRating\|submitRating" src functions/src
grep -rn "Shop\b.*rating\|shop.ratingAvg" src functions/src
grep -rn "users/{uid}.deliveryRatingAvg" src functions/src
```

| Symbol | Confirmed at | Notes |
| --- | --- | --- |
| `OrderRating` type | `src/types/index.ts:636` | Currently has `shopStars`, `deliveryStars`, optional `comment`, `submittedAt`. Bundle adds correction-state fields. |
| `shop.ratingAvg` / `ratingCount` | rolling averages on shop doc | Already exist. Bundle adds `publicReviewCount` (subset of total ratings — only published ones surface publicly). |
| `users/{uid}.deliveryRatingAvg/Count` | partner rolling averages | Same as shops — bundle adds `publicReviewCount`. |
| `submitRating` callable | (find via grep) | Currently writes rating + updates rolling averages. Bundle adds correction-state initialization + LOW-RATING-PUSH fan-out (cross-references that PR). |

## Correction state machine

```
                       ┌─────────────────────┐
   customer submits → │     'submitted'     │
                       └──────────┬──────────┘
                                  │
                  ┌───────────────┴───────────────┐
                  │                               │
        stars > threshold              stars ≤ threshold
                  │                               │
                  ▼                               ▼
         ┌──────────────┐              ┌──────────────────┐
         │  'published'  │              │   'flagged_low'  │
         │  (immediately) │              │  (private; shop/  │
         │                │              │   partner notified│
         └──────────────┘              │   via #15 push)   │
                                       └─────────┬────────┘
                                                  │
                          ┌───────────────────────┼────────────────────┐
                          │                       │                    │
              shop/partner responds      shop/partner               7-day timeout
              (text + optional action)   doesn't respond            (cron job)
                          │                       │                    │
                          ▼                       ▼                    ▼
              ┌──────────────────┐   (stays 'flagged_low')  ┌──────────────────┐
              │   'responded'    │                          │   'published'    │
              │  (customer can   │                          │ (unresolved goes │
              │   amend or       │                          │  public anyway)  │
              │   acknowledge)   │                          └──────────────────┘
              └────────┬─────────┘
                       │
                       ├── customer amends → 'amended' → 'published' (new stars)
                       │
                       ├── customer acknowledges → 'published' (original stars + response)
                       │
                       └── customer no-op for 7d → 'published' (original stars + response)
```

## Schema additions (additive only)

`OrderRating` extension:
```ts
correctionState?: 'submitted' | 'flagged_low' | 'responded' | 'amended' | 'published' | null;
responseText?: string | null;              // shop/partner response if any
responseBy?: 'shop' | 'partner' | null;    // who responded
responseAt?: number | null;
amendedStars?: { shopStars?: number; deliveryStars?: number } | null;  // customer's amended values
amendedAt?: number | null;
publishedAt?: number | null;               // when surfaced to public
publishedReason?: 'above_threshold' | 'customer_acknowledged' | 'customer_amended' | 'timeout' | null;
```

Shop / user (partner) doc extension:
```ts
publicReviewCount?: number;  // count of published reviews; pilot scale recomputes on each publish
publicReviewLatest?: { ratingId, stars, comment, customerName, publishedAt }[];  // top-5 cache
```

## Pure helpers

`functions/src/reviewWorkflowHelpers.ts`:

```ts
export type ReviewState = 'submitted' | 'flagged_low' | 'responded' | 'amended' | 'published';

export function decideInitialState(args: {
  shopStars: number;
  deliveryStars: number;
  shopThreshold: number;
  partnerThreshold: number;
}): { state: ReviewState; reason: string } {
  const lowShop = args.shopStars <= args.shopThreshold;
  const lowPartner = args.deliveryStars <= args.partnerThreshold;
  if (lowShop || lowPartner) return { state: 'flagged_low', reason: 'low_stars' };
  return { state: 'published', reason: 'above_threshold' };
}

export function canRespond(state: ReviewState): boolean {
  return state === 'flagged_low';
}

export function canAmend(state: ReviewState): boolean {
  return state === 'responded';
}

export function canAcknowledge(state: ReviewState): boolean {
  return state === 'responded';
}

export function decideTimeoutPublish(args: {
  state: ReviewState;
  submittedAtMs: number;
  nowMs: number;
  timeoutDays?: number;
}): boolean {
  const days = args.timeoutDays ?? 7;
  const elapsed = args.nowMs - args.submittedAtMs;
  return args.state === 'flagged_low' && elapsed > days * 24 * 60 * 60 * 1000;
}
```

Pin with **+12 tests** (3 each for decideInitialState, canRespond/Amend/Acknowledge transitions, decideTimeoutPublish boundary cases).

## Server callables

1. `respondToReview({ ratingId, responseText })` — auth: shop owner OR partner of the rating. Transitions `flagged_low` → `responded`. Notifies customer via push.
2. `amendRating({ ratingId, newShopStars?, newDeliveryStars? })` — auth: customer. Transitions `responded` → `amended` → `published`. Recomputes rolling averages.
3. `acknowledgeReview({ ratingId })` — auth: customer. Transitions `responded` → `published` (original stars + response).
4. `publishTimedOutReviews` (scheduled function, runs daily) — finds `flagged_low` reviews older than 7 days, transitions to `published`.

Each with discriminated-union Result + auth gate. Pin with **+12 tests** (3 per callable: success / wrong-role / wrong-state).

## Client surfaces

### §F — Customer-facing ShopReviewsScreen

```
┌─────────────────────────────────────┐
│ ← US Shoppers · Reviews             │
├─────────────────────────────────────┤
│                                     │
│ ⭐ 4.7  ·  142 reviews               │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ ⭐⭐⭐⭐⭐  by Priya              │ │
│ │ "Fast and fresh!"                │ │
│ │ 2 days ago                       │ │
│ └─────────────────────────────────┘ │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ ⭐⭐⭐⭐  by Rohan                │ │
│ │ "Good, but missing one item"     │ │
│ │ Shop responded: "Thanks for ..."│ │
│ │ 5 days ago                       │ │
│ └─────────────────────────────────┘ │
│                                     │
│ ...                                 │
└─────────────────────────────────────┘
```

Reads `shop.publicReviewLatest` (top-5 cached) + paginates older via a `listShopReviews({ shopId, limit, cursor })` callable.

Same pattern for `PartnerReviewsScreen` from a customer's order detail (tap partner card → "View partner reviews").

### §G — Customer correction screen (RatingAmendmentScreen)

When shop/partner has responded to a low-rated review, customer sees a push and opens this screen.

```
┌─────────────────────────────────────┐
│ ← Update your rating?               │
├─────────────────────────────────────┤
│                                     │
│ You rated US Shoppers 2★ on Jun 9.  │
│                                     │
│ Their response:                     │
│ ┌─────────────────────────────────┐ │
│ │ "Sorry for the missing item!    │ │
│ │ We've refunded ₹80 + added a    │ │
│ │ ₹50 voucher for next order."    │ │
│ └─────────────────────────────────┘ │
│                                     │
│ How do you feel now?                │
│ ⭐⭐⭐⭐⭐ (tap to amend)              │
│                                     │
│ [ Keep my original 2★ ]             │
│ [ Update to <new stars> ]           │
│                                     │
│ Either way, your review will go     │
│ public after this. You can leave    │
│ it amended OR keep your original    │
│ rating + their response.            │
└─────────────────────────────────────┘
```

Two CTAs:
- Keep original → calls `acknowledgeReview(ratingId)` → state becomes `published` with original stars + response visible.
- Update → calls `amendRating(ratingId, newStars)` → state becomes `amended` then `published` with new stars + response visible.

If customer ignores the push for 7 days, the scheduled `publishTimedOutReviews` job publishes the unresolved review (original stars + the response, no amendment).

---

## Discipline checklist

1. **Rule 1, 2, 5, 7, 11, 13, 14** — all apply per established convention.
2. **Schema-additive only** — `OrderRating` gains 8 new optional fields. Shop/user gain 2 new fields each. Legacy reviews render as `state: 'published'` by inference (no correction state means it was always public).
3. **Test discipline:** **+12 helpers + +12 callables = +24 tests minimum.** Suite trajectory 1400 → ~1424 (assuming LOW-RATING-PUSH landed first).

## Acceptance checklist

1. Customer submits 4-star rating on shop, 5-star on partner. State = `published` immediately. Visible in ShopReviewsScreen within 30s.
2. Customer submits 1-star shop, 5-star partner. State = `flagged_low`. NOT visible on ShopReviewsScreen. LOW-RATING-PUSH fires to shop owner + admin.
3. Shop owner taps push, responds via new screen. State → `responded`. Customer gets push.
4. Customer opens RatingAmendmentScreen, taps "Keep original" → state → `published` with original 1-star + shop's response. Visible in ShopReviewsScreen.
5. Alternate flow: customer taps "Update to 4-star" → state → `amended` → `published`. Rolling averages recomputed.
6. Alternate flow: customer ignores push for 7 days. Scheduled `publishTimedOutReviews` runs nightly, transitions stale `flagged_low` to `published` with original stars + response (or no response if shop didn't respond either).
7. **Negative — non-shop-owner tries to respond.** Returns permission-denied.
8. **Negative — customer tries to respond to their own review.** Returns permission-denied (only shop/partner can respond).
9. **Negative — customer tries to amend a `published` review.** Returns failed-precondition.
10. Shop's public listing shows `4.7 ⭐ · 142 reviews`. Sort by recent. Tap a review to expand response.
11. IAM verify on all 4 new callables + `submitRating` (modified) + the scheduled function.
12. `npx tsc --noEmit` clean. `npm run test:unit` clean. Suite +24 minimum.

## Out of scope

- **Customer-side review report/flag** (report inappropriate response). Admin moderation tools deferred to post-pilot.
- **Image attachments** in reviews. Text-only for v1.
- **Response thread** (multiple back-and-forth). Single response per rating side; customer amends once.
- **Rich text** in responses. Plain text only.
- **Reviewer reputation** / weighting. All reviews counted equally.
- **AI sentiment analysis** on review text. Trust the stars.

## Deploy

```
# Server first — 4 new + 1 modified callable + 1 scheduled function
cd functions; npm run build; cd ..
firebase deploy --only "functions:submitRating,functions:respondToReview,functions:amendRating,functions:acknowledgeReview,functions:listShopReviews,functions:publishTimedOutReviews"

# IAM verify all (Rule 11)
foreach ($svc in 'submitrating','respondtoreview','amendrating','acknowledgereview','listshopreviews','publishtimedoutreviews') {
  gcloud run services get-iam-policy $svc --region=asia-south1 --project=grocery-mvp-dev
}

# Firestore rules
firebase deploy --only firestore:rules

# Client OTA
eas update --branch production --message "PR-NEXT-REVIEW-SYSTEM public reviews + correction workflow"
```

## Doc trail (Cowork)

Append #16 to TESTING-FINDINGS. Update CLAUDE.md + SESSION_LOG. Note PR 39.2 + LOW-RATING-PUSH cross-references for the correction-state machine + push fan-out interactions.
