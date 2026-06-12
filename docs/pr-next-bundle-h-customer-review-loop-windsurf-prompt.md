# PR-NEXT-BUNDLE-H — Customer review loop + partner card finish

**Source:** Sudhir's 2026-06-10 post-HOTFIX-REVIEW-DENORM retest. Delivery partner photo + response state both work on partner/shop side. **Customer side has no equivalent surface:** no response section on OrderDetail, no Amend/Acknowledge entry point, partner card has no photo, partner card subtitle says "On the way to you" even after delivered. Push fires server-side but title says "Shop responded" when partner responds.

**Design lens — close the customer-side correction loop, finish the partner identity card.** Three of the five symptoms hang together (customer-side review post-rating gap + identity card missing photo + finalised state). The fourth is the push-copy bug. The fifth (push not delivered reliably on same-phone multi-role testing) is a testing-environment artefact + an observability gap, not a production code issue.

**Deploy class:** **server-first (1 callable: respondToReview) → IAM verify → client OTA.** No backfill needed (the schema for everything is already in place — this is pure missing-rendering / missing-prop / missing-copy work).

## Root cause (verified by Claude before this prompt)

Five symptoms, four root causes:

1. **Customer OrderDetailScreen ends at "Thanks for rating!" panel.** Lines 894-953 render the rating summary. Nothing after line 953 (the ScrollView closes at 954). The shop side (`ShopOrderDetailScreen.tsx:460-510`) and delivery side (`DeliveryOrderDetailScreen.tsx:457-503`) both have `correctionState`-gated response sections with Respond / Your-response / Waiting-on-customer blocks. Customer side never got the equivalent.

2. **RatingAmendmentScreen is only reachable via push deep-link.** AuthBootstrap.tsx:417-426 handles `type === 'review_responded'` → `safeNavigate('RatingAmendment', ...)`. No call sites in any other screen.

3. **PartnerIdentityCard authored before partner-photo PR.** Header comment (PartnerIdentityCard.tsx:1-15) explicitly says "NOT a real photo — partner profile photo flow doesn't exist yet; deferred to a future PR." Never updated after PR-2 PARTNER-PHOTO. Bundle G §D audit-grep targeted `formatPartnerAvatar` consumers; this component uses `initialsFor` directly so was missed.

4. **PartnerIdentityCard subtitle has two states only.** Line 46-49: `pickedUpAt ? "🛵 On the way to you" : "📦 Heading to the shop"`. No finalized branch. `PartnerDetailsSheet.tsx` has the correct three-state pattern (line 281) but the card divergence wasn't caught.

5. **Push title hardcoded.** `functions/src/index.ts:10389` — `'💬 Shop responded to your review'` regardless of `responseBy === 'partner'`. Should branch.

## Autonomous execution authorization

You may run the following without stopping to confirm — execute, report results in the final summary:

- All `Read`, `Grep`, `Glob`, `ls`, `git status`, `git diff` (read-only)
- `npx tsc --noEmit` (root AND `functions/`)
- `npm test`, `npm run test:unit`, `npm run test:full`, `npx jest`
- `cd functions && npm run build`
- File edits to files explicitly named in §A–§F below
- New file creation in `src/components/order/`, `src/utils/`, `tests/`

You MUST stop and ask before:
- Deploy commands (`firebase deploy`, `eas update`, `gcloud …`)
- Editing files NOT named in §A-§F (especially: don't touch `respondToReview` auth gate — already correct post HOTFIX-RATING-RESPONSE)
- Schema additions or new callables
- New dependencies
- Touching the ShopOrderDetailScreen or DeliveryOrderDetailScreen response sections (already correct; customer side is being brought to parity)

Default posture: **execute, report at end.**

## Schema audit-grep (Rule 5)

```
grep -rn "PartnerIdentityCard\|initialsFor\|formatPartnerAvatar" src --include="*.tsx" --include="*.ts"
grep -n "correctionState\|responseText\|responseBy\|responseAt\|ratingId" src/screens/OrderDetailScreen.tsx
grep -rn "review_responded\|Shop responded\|Partner responded\|responseBy" functions/src
grep -rn "RatingAmend\|navigate.*RatingAmend" src --include="*.tsx" --include="*.ts"
```

| Symbol | Confirmed at | Notes |
| --- | --- | --- |
| `order.correctionState` | denormalized by HOTFIX-REVIEW-DENORM | Now cascades to order doc on every state transition — Customer side can finally trust it |
| `order.responseText / responseBy / responseAt` | denormalized by HOTFIX-REVIEW-DENORM | Customer-side render now has the data it needs |
| `order.deliveryPersonPhotoUrl` | denormalized at claim time by PARTNER-CARD.2 / PARTNER-PHOTO | Available for `PartnerIdentityCard` — currently unused on customer side |
| `order.status === 'delivered' / 'cancelled'` | always denormalized | Drives the finalized-state subtitle |
| `RatingAmendmentScreen` route params | `RootStackParamList.RatingAmendment` (AppNavigator.tsx:152) | Already accepts ratingId, orderId, shopName, originalShopStars, responseText, responseBy, deliveryPersonName, deliveryPersonPhotoUrl |
| `responseBy: 'shop' \| 'partner'` | written by respondToReview | Server already stores it; just not used in push title |

**No new schema fields.** Every value needed is already denormalized on the order doc.

## Plan

### §A — Customer OrderDetailScreen: review-response section

After the existing "Thanks for rating!" panel (around `src/screens/OrderDetailScreen.tsx:953`), insert a new block that mirrors the shop / delivery layout but with customer-facing copy and CTAs.

State machine on the customer side:

```
correctionState === 'flagged_low'   → "Awaiting response from {responseBy or 'the shop / partner'}"
                                      Static info; no CTAs. (7-day timeout note optional.)

correctionState === 'responded'     → Banner with response text + responseBy badge
                                      Photo + name of responder (use partner photo if responseBy === 'partner',
                                      otherwise shopName)
                                      [Amend my rating] + [Acknowledge response] CTAs
                                      Both navigate to RatingAmendmentScreen with the right route params

correctionState === 'amended'       → "You amended this review · published" (read-only)
correctionState === 'published'     → "✅ Review published" (read-only summary)
```

**JSX structure** (after line 953, before the ScrollView closes):

```jsx
{/* PR-NEXT-BUNDLE-H §A — customer-side review correction loop.
    Mirror of the shop / delivery response sections; closes the
    UX loop where customer had no in-app surface for the response. */}
{order.status === 'delivered' &&
  order.ratingId &&
  order.correctionState && (
    <CustomerReviewResponsePanel
      order={order}
      onAmendPress={() =>
        nav.navigate('RatingAmendment', {
          ratingId: order.ratingId!,
          orderId: order.id,
          shopName: order.shopName,
          originalShopStars: order.shopRating ?? 0,
          responseText: order.responseText ?? null,
          responseBy: order.responseBy ?? null,
          deliveryPersonName: order.deliveryPersonName ?? null,
          deliveryPersonPhotoUrl: order.deliveryPersonPhotoUrl ?? null,
        })
      }
      onAcknowledgePress={() =>
        nav.navigate('RatingAmendment', {
          // Same params — RatingAmendmentScreen handles both
          // amend and acknowledge actions internally.
          ...
        })
      }
    />
  )}
```

**New component** `src/components/order/CustomerReviewResponsePanel.tsx`:

- Receives `order` (subset of OrderDetail's `order`) + handlers
- Renders the four-state UI above
- Uses a small pure helper `deriveCustomerReviewResponseView(order)` returning a discriminated union (one shape per state)
- For the `responded` state, renders the responder's photo + name using a small ResponderIdentityRow inline subcomponent — IF `responseBy === 'partner'` use `order.deliveryPersonName / PhotoUrl`, else use `order.shopName` + shop's cover image URL if available else a generic shop icon

Photo render uses the same `onError → initials fallback` pattern as HOTFIX-PROFILE-PHOTO §C — local `photoLoadError` state, useEffect resets on URL change.

Pin **+6 tests** on `deriveCustomerReviewResponseView`:
- `flagged_low` → returns `{ kind: 'awaiting', ... }`
- `responded` with `responseBy: 'shop'` → returns `{ kind: 'responded', responder: { kind: 'shop', name, photoUrl } }`
- `responded` with `responseBy: 'partner'` → returns `{ kind: 'responded', responder: { kind: 'partner', name, photoUrl } }`
- `amended` → returns `{ kind: 'amended', ... }`
- `published` → returns `{ kind: 'published', ... }`
- missing fields → returns `{ kind: 'none' }` (safe no-render)

### §B — PartnerIdentityCard: photo support

`src/components/order/PartnerIdentityCard.tsx`:

Extend props:

```ts
export default function PartnerIdentityCard({
  name,
  photoUrl,        // NEW
  pickedUpAt,
  orderStatus,     // NEW
  onPress,
}: {
  name?: string | null;
  photoUrl?: string | null;
  pickedUpAt: number | null;
  orderStatus?: string | null;
  onPress?: () => void;
}) {
  // ...
}
```

Replace the initials-only avatar with the photo-or-initials pattern:

```jsx
const avatar = formatPartnerAvatar(name, photoUrl);
const [photoLoadError, setPhotoLoadError] = useState(false);
useEffect(() => { setPhotoLoadError(false); }, [photoUrl]);

<View style={styles.avatar}>
  {avatar.kind === 'photo' && !photoLoadError ? (
    <Image
      source={{ uri: avatar.uri }}
      style={styles.avatarImg}
      onError={() => setPhotoLoadError(true)}
    />
  ) : (
    <Text style={styles.avatarText}>
      {avatar.kind === 'initials' ? avatar.text : initialsFor(name)}
    </Text>
  )}
</View>
```

Header comment update — remove the "NOT a real photo — deferred to a future PR" line; replace with a note that photo lands via PR-NEXT-BUNDLE-H + falls back to initials on broken URL / no photo / load failure.

Caller in `src/screens/OrderDetailScreen.tsx:506`:

```jsx
<PartnerIdentityCard
  name={order.deliveryPersonName}
  photoUrl={order.deliveryPersonPhotoUrl ?? null}   // NEW
  pickedUpAt={typeof order.pickedUpAt === 'number' ? order.pickedUpAt : null}
  orderStatus={order.status ?? null}                // NEW
  onPress={() => setPartnerSheetOpen(true)}
/>
```

### §C — PartnerIdentityCard: finalized-state subtitle

Same component — replace the two-state subtitle:

```ts
// BEFORE
const subtitle =
  pickedUpAt != null
    ? '🛵 On the way to you'
    : '📦 Heading to the shop';

// AFTER
const subtitle = derivePartnerCardSubtitle({
  orderStatus,
  pickedUpAt,
});
```

New pure helper `src/utils/derivePartnerCardSubtitle.ts`:

```ts
/**
 * PR-NEXT-BUNDLE-H §C — three-state subtitle for the customer's
 * partner identity card. Was previously two-state (pre-pickup vs
 * post-pickup), staying at "On the way to you" forever even after
 * delivered. Mirrors PartnerDetailsSheet's isFinalized pattern.
 */
export function derivePartnerCardSubtitle(input: {
  orderStatus: string | null | undefined;
  pickedUpAt: number | null | undefined;
}): string {
  if (input.orderStatus === 'delivered') return '✅ Delivered';
  if (input.orderStatus === 'cancelled') return '❌ Order cancelled';
  if (input.pickedUpAt != null) return '🛵 On the way to you';
  return '📦 Heading to the shop';
}
```

Pin **+5 tests** (delivered / cancelled / picked-up / heading-to-shop / null-defensive).

### §D — Push title: differentiate shop vs partner

`functions/src/index.ts:10387-10392` `respondToReview` push block:

```ts
// BEFORE
pushToUser(
  customerId,
  '💬 Shop responded to your review',
  'Tap to read the response and update your rating.',
  { ratingId, orderId: rev.orderId, type: 'review_responded' },
).catch(e => console.warn('[respondToReview] push failed:', e));

// AFTER
const pushTitle = derivePushTitle(responseBy);
const pushBody = 'Tap to read the response and update your rating.';
pushToUser(customerId, pushTitle, pushBody, {
  ratingId,
  orderId: rev.orderId,
  type: 'review_responded',
  responseBy,  // forward to client deep-link handler for analytics
}).catch(e => {
  // PR-NEXT-BUNDLE-H §E — Sentry observability so silent push
  // failures don't mask the "no notification received" testing
  // signal. Server still doesn't fail the response itself.
  console.warn('[respondToReview] push failed:', e);
  Sentry.captureException(e, {
    tags: { area: 'respondToReview.push' },
    extra: { ratingId, orderId: rev.orderId, customerId, responseBy },
  });
});
```

Pure helper `functions/src/respondToReviewPushHelpers.ts`:

```ts
export function derivePushTitle(responseBy: 'shop' | 'partner' | string | undefined | null): string {
  if (responseBy === 'partner') return '💬 Delivery partner responded to your review';
  return '💬 Shop responded to your review';
}
```

Pin **+3 tests** (shop / partner / unknown/null default).

### §E — Sentry observability around the push

Already baked into §D's catch handler. Verify `Sentry` is imported at the top of `functions/src/index.ts`; the import comment (per Rule 1) should mention HOTFIX-RATING-RESPONSE lineage.

Additional pin **+1 test** — assert the catch block invokes Sentry.captureException with the expected tags shape. Mock the Sentry SDK.

### §F — Static-source guard: no "deferred to a future PR" left

After this PR, scan the codebase for component header comments that say things are "deferred to a future PR" and verify each is either:
- Now actually implemented (PR-NEXT-13a's photo comment is now stale and is being removed in §B)
- Or still a legitimate deferral that should be tracked in `docs/ROADMAP.md` instead

```
grep -rn "deferred to a future PR\|deferred to a future" src --include="*.tsx" --include="*.ts"
```

For each remaining hit: either remove the deferral language (if shipped) or open a roadmap-tracked deferral note. Pin **+1 static-source guard test** — `tests/static/noStaleDeferralComments.test.ts` that asserts the grep returns zero matches in `src/components/` and `src/screens/` (allow under `claude_files/` since that's frozen reference).

This is the same institutional-guard pattern as `authClaimNamesAudit.test.ts` from Bundle G. Permanent.

## Discipline checklist

1. **Rule 1** — every new import / state carries "PR-NEXT-BUNDLE-H — DO NOT REMOVE" comments.
2. **Rule 2** — `photoLoadError` useState above any conditional returns in PartnerIdentityCard.
3. **Rule 5** — schema audit-grep in header. **Worked example #7 for the discipline notes:** *"When auditing for a missing-feature class (photo on every partner surface), grep the helper name AND the bare component name pattern. Bundle G §D's audit on `formatPartnerAvatar` missed PartnerIdentityCard which uses `initialsFor` directly. The static-source guard in §F closes the institutional gap."*
4. **Rule 7** — auth.token shape unchanged.
5. **Rule 8** — FEATURES.md update in Doc trail. Six rows touched.
6. **Rule 11** — IAM verify on `respondToReview` (modified). 1 service.
7. **Rule 13** — N/A (no new modals).
8. **Schema-additive** — zero new fields. Pure rendering + push-copy work on existing denormalized data.
9. **Test discipline:** §A +6, §B +5 (avatar branches), §C +5, §D +3, §E +1, §F +1 = **+21 tests minimum.** Suite ~1513 → ~1534.

## Acceptance checklist

1. **§A** As customer, view delivered+rated order where partner responded → see the partner's response text below your stars, with partner photo + name + "Delivery partner" badge. Two CTAs visible: **[Amend my rating]** and **[Acknowledge response]**. Tap Amend → RatingAmendmentScreen opens with photo + name + response text pre-populated.
2. **§A** Same flow when SHOP responded instead → shop name + shop badge + Amend/Ack CTAs. (No shop cover image required for the badge — shop name + 🏪 icon is fine.)
3. **§A** After tapping Acknowledge → review publishes → next OrderDetail open shows "✅ Review published" banner (read-only). Amend/Ack CTAs no longer visible.
4. **§A** When state is `flagged_low` (customer rated low, no response yet) → see "Awaiting response · N days left" static info. No CTAs.
5. **§B** OrderDetail partner card shows the partner's actual photo (assuming partner uploaded post-HOTFIX-PROFILE-PHOTO-4). Broken/missing URL → initials fallback, no invisible-circle state.
6. **§C** OrderDetail partner card subtitle reads "✅ Delivered" after delivery, not "🛵 On the way to you".
7. **§D** When delivery partner responds → push title reads "💬 Delivery partner responded to your review". When shop responds → "💬 Shop responded to your review".
8. **§E** Force a push failure (e.g. by passing an invalid customerId in test). Verify Sentry catches it with tags `area: respondToReview.push` + the order/rating/customer/responseBy extras.
9. **§F** Run `grep -rn "deferred to a future PR" src` → zero hits in `src/components/` and `src/screens/`. CI test pins this.
10. **Cloud Run IAM** verify on `respondToReview`. Re-bind `allUsers` if `etag: ACAB`.
11. `tsc` + tests clean. Suite +21 minimum.
12. **Deliberate-break demo:** revert §C's three-state derivation to the old two-state inline. The `derivePartnerCardSubtitle` test for the `delivered` state must fail. Restore. Tests pass.

## Out of scope

- **Backfilling `order.deliveryPersonPhotoUrl` on already-claimed orders** whose partners' user-doc photoUrl was malformed pre-HOTFIX-PROFILE-PHOTO-4. New orders post-OTA will have the correct URL from claim time. Old orders fall back to initials via §B's onError handler. Backfill script can be added later if more partners onboard before pilot.
- **Live re-fetch of partner data on OrderDetail render** to bypass denormalized stale state. Denormalization is the correct read-scale pattern (validated by HOTFIX-REVIEW-DENORM); the right fix is to update denorm cascades, not bypass them.
- **Multi-back-and-forth threading** between customer and shop/partner. Single-response + amend/ack stays unchanged.
- **Shop cover image on responder badge for §A's shop case.** Just shop name + 🏪 icon is enough for pilot. A future bundle can add the cover image lookup if needed.
- **Same-phone multi-role push delivery reliability.** This is a testing-environment artefact of PR 24's push-token cleanup on sign-out. The production pipeline IS firing correctly (server logs prove it); the on-device delivery flakiness only affects solo-test workflows. §E's Sentry hook makes this diagnosable going forward without code changes.

## Deploy

```
cd functions; npm run build; cd ..
firebase deploy --only "functions:respondToReview"

gcloud run services get-iam-policy respondtoreview --region=asia-south1 --project=grocery-mvp-dev
# If etag: ACAB, re-bind:
# gcloud run services add-iam-policy-binding respondtoreview --region=asia-south1 --member=allUsers --role=roles/run.invoker --project=grocery-mvp-dev

npx tsc --noEmit
npm run test:unit
eas update --branch production --message "Bundle H — customer review loop + partner card photo + finalized state + push title fix"
```

## Doc trail (Cowork)

After ship:

- **TESTING-FINDINGS** — close all 5 dots from the 2026-06-10 customer-side observation.
- **CLAUDE.md** In-flight strike.
- **SESSION_LOG** paragraph capturing the customer-side post-rating gap discovery + the missed-audit lesson (formatPartnerAvatar vs initialsFor).
- **PRELAUNCH_CHECKLIST** — append Bundle H section.
- **PROMPT_AUTHORING_NOTES** — add **Rule 5 worked example #7** (audit pattern when looking for missing feature across surfaces — grep helper AND component name AND known fallback path; the formatPartnerAvatar→initialsFor divergence is the lesson). Also note that **static-source guards for stale "deferred to a future PR" comments** are now CI-enforced — third institutional guard after authClaimNamesAudit + review denorm cascade.
- **FEATURES.md** (per Rule 8 — mandatory):
  - **Customer panel §1.8 Order tracking** — edit "Partner card" row: source column → `Bundle H §B+§C`. Description append `"; photo + 'Delivered' status when finalized"`.
  - **Customer panel §1.9 Ratings & reviews** — edit "Low-rating correction workflow" row: description changes from current to include `"; customer sees response inline on OrderDetail with Amend / Acknowledge CTAs (was previously only reachable via push deep-link)"`. Source column → `Bundle H §A`.
  - **Customer panel §1.9 Ratings & reviews** — ADD new row: `Review response surface on OrderDetail | Partner/shop response text + photo + badge + Amend/Acknowledge CTAs (gated on correctionState) | Bundle H §A | shipped`.
  - **Cross-cutting §5.2 Push notifications** — edit "Token cleanup on sign-out" row: lineage HTML comment about same-phone testing flakiness being a known testing-environment limitation, captured via Sentry per Bundle H §E.
  - **Cross-cutting §5.5 Observability** — edit "Sentry crash reporting" row: append `"; respondToReview push failures captured with order/rating/customer/responseBy context"`. Source column → `Bundle H §E`.
  - **Last updated** stamps on Customer §1.8, §1.9, Cross-cutting §5.2, §5.5 → 2026-06-10.
