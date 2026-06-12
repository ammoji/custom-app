# HOTFIX-RATING-RESPONSE — Send response button silently fails on both shop and delivery side

**Source:** Sudhir's 2026-06-10 findings #6 + #7. Customer leaves bad rating → shop owner OR delivery partner gets notification → opens response modal → types response → taps "Send response" → **nothing happens**. Button re-enables, modal stays open, text remains, no Alert, no state change. Identical symptoms on both sides.

**Deploy class:** **server-first.** One 2-character server fix + defensive client error handling. IAM verify on `respondToReview`.

## Root cause (verified by Claude before this prompt)

**This is the same Rule 5 bug class as HOTFIX-5.** Server-side auth gate reads user-doc mirror field names instead of auth-token claim names.

`functions/src/index.ts:10206-10207` (inside `respondToReview`):

```ts
const isShopOwner = claims.isShopOwner === true;   // ← WRONG — mirror field name
const isDelivery = claims.isDelivery === true;     // ← WRONG — mirror field name
if (!isShopOwner && !isDelivery) {
  throw new HttpsError('permission-denied', 'Shop owner or delivery partner required');
}
```

Auth-token claims are `shopOwner: true` / `delivery: true` (set by admin via `setCustomUserClaims`). The `is`-prefixed fields are USER DOC mirrors used for Firestore `where` filters — they don't exist on the auth token.

Result: every caller is rejected with `permission-denied`. Server throws HttpsError → client callable rejects.

Then on the client, `src/components/order/ResponseModal.tsx:39-49`:

```ts
const handleSubmit = async () => {
  const trimmed = text.trim();
  if (!trimmed) return;
  setSubmitting(true);
  try {
    await onSubmit(trimmed);
    setText('');
  } finally {
    setSubmitting(false);   // ← runs on success AND on rejection
  }
};
```

The `try/finally` has no `catch`. The rejection bubbles to the parent screen. Parent screens (`ShopOrderDetailScreen.tsx:769` and `DeliveryOrderDetailScreen.tsx:511`) wrap the callable in their own `onSubmit` — need to verify they handle rejection too. If neither catches, the rejection is unhandled → button re-enables (from the finally) → modal stays open → user sees "nothing happened".

## Autonomous execution authorization

You may run the following without stopping to confirm — execute, report results in the final summary:

- All `Read`, `Grep`, `Glob`, `ls`, `git status`, `git diff` (read-only)
- `npx tsc --noEmit` (root AND `functions/`)
- `npm test`, `npm run test:unit`, `npm run test:full`, `npx jest`
- `cd functions && npm run build`
- File edits to:
  - `functions/src/index.ts` (lines around 10206-10207 only)
  - `src/components/order/ResponseModal.tsx`
  - `src/screens/shop/ShopOrderDetailScreen.tsx` (only the `ResponseModal` `onSubmit` block)
  - `src/screens/delivery/DeliveryOrderDetailScreen.tsx` (only the `ResponseModal` `onSubmit` block)
  - Test files for the above

You MUST stop and ask before:
- Deploy commands (`firebase deploy`, `eas update`, `gcloud …`)
- Editing files NOT listed above
- Schema additions or new callables
- Touching the response modal's submission shape (callable signature stays)

Default posture: **execute, report at end.**

## Schema audit-grep (Rule 5 — and this prompt IS the example for the extension)

```
grep -rn "claims.isShopOwner\|claims.isDelivery\|claims.isCustomer\|claims.isAdmin" functions/src
grep -rn "claims.shopOwner\|claims.delivery\|claims.admin" functions/src
```

| Symbol | Where it lives | Correct usage |
| --- | --- | --- |
| Auth-token claim `shopOwner: true` | `setCustomUserClaims` calls in `scripts/set-shop-owner.ts` + `approveShopRequest` callable | Read on server as `request.auth.token.shopOwner` or `claims.shopOwner` |
| Auth-token claim `delivery: true` | `setCustomUserClaims` calls in `scripts/set-delivery.ts` + `approveDeliveryRole` callable | Read on server as `claims.delivery` |
| User-doc mirror `isShop: true` | Written to `users/{uid}` by the same callables, for Firestore `where('isShop', '==', true)` queries | NEVER appears on the auth token |
| User-doc mirror `isDelivery: true` | Same | NEVER appears on the auth token |

After this PR, every `respondTo*` / `*ResponseHandler` / any new gate MUST audit-grep both list-A and list-B above before being declared correct. This was the trapped-twice bug class (HOTFIX-5 + this one).

## Plan

### §A — Server fix (2 characters changed)

`functions/src/index.ts` lines 10206-10207:

```ts
// BEFORE
const isShopOwner = claims.isShopOwner === true;
const isDelivery = claims.isDelivery === true;

// AFTER (HOTFIX-RATING-RESPONSE — auth-token claim names)
const isShopOwner = claims.shopOwner === true;
const isDelivery = claims.delivery === true;
```

Add a `// HOTFIX-RATING-RESPONSE — DO NOT REMOVE. claims.shopOwner / claims.delivery are auth-token claim names (not isShopOwner/isDelivery which are user-doc mirror fields). Same bug class as HOTFIX-5.` comment immediately above the two lines.

### §B — Add a missing `respondToReviewCanRespond` pure helper test for the role gate

Add a new pure helper `validateRespondToReviewAuth` in a new file `functions/src/respondToReviewHelpers.ts`:

```ts
export type RespondAuthResult =
  | { ok: true; responseBy: 'shop' | 'partner' }
  | { ok: false; code: 'not_authorized'; message: string };

export function validateRespondToReviewAuth(opts: {
  callerClaims: Record<string, unknown> | null | undefined;
  callerUid: string;
  review: {
    shopId?: string | null;
    deliveryPersonId?: string | null;
  };
  callerShopId?: string | null; // resolved by caller via shop ownership lookup
}): RespondAuthResult {
  const claims = opts.callerClaims ?? {};
  const isShopOwner = (claims as any).shopOwner === true;
  const isDelivery = (claims as any).delivery === true;
  if (!isShopOwner && !isDelivery) {
    return {
      ok: false,
      code: 'not_authorized',
      message: 'Shop owner or delivery partner role required',
    };
  }
  if (isShopOwner) {
    if (!opts.callerShopId || opts.callerShopId !== opts.review.shopId) {
      return {
        ok: false,
        code: 'not_authorized',
        message: 'Not the owner of this shop',
      };
    }
    return { ok: true, responseBy: 'shop' };
  }
  // isDelivery path
  if (opts.review.deliveryPersonId !== opts.callerUid) {
    return {
      ok: false,
      code: 'not_authorized',
      message: 'Not the delivery partner for this order',
    };
  }
  return { ok: true, responseBy: 'partner' };
}
```

Refactor `respondToReview` to use the helper for the role-gate branch. The shop ownership lookup stays in the callable (needs Firestore), the result is passed into the helper.

Pin with **+6 tests:**
- Shop owner of the rated shop → ok, `responseBy: 'shop'`
- Shop owner of a different shop → not_authorized
- Delivery partner who delivered the order → ok, `responseBy: 'partner'`
- Delivery partner who did NOT deliver this order → not_authorized
- No role claim at all → not_authorized
- Both shopOwner + delivery claims (multi-role test account) → shop branch wins when callerShopId matches

### §C — Defensive client error handling in ResponseModal

`src/components/order/ResponseModal.tsx:39-49`:

```ts
// BEFORE
const handleSubmit = async () => {
  const trimmed = text.trim();
  if (!trimmed) return;
  setSubmitting(true);
  try {
    await onSubmit(trimmed);
    setText('');
  } finally {
    setSubmitting(false);
  }
};

// AFTER
const handleSubmit = async () => {
  const trimmed = text.trim();
  if (!trimmed) return;
  setSubmitting(true);
  try {
    await onSubmit(trimmed);
    setText('');
  } catch (e: any) {
    // HOTFIX-RATING-RESPONSE — surface server errors instead of
    // silently re-enabling the button. Parent's onSubmit may have
    // its own Alert; this is defense-in-depth so a future parent
    // miswiring doesn't reintroduce the silent-fail symptom.
    Alert.alert(
      'Could not send response',
      e?.message || 'Please try again in a moment.',
    );
  } finally {
    setSubmitting(false);
  }
};
```

Add `Alert` to the imports from `react-native`.

### §D — Parent screens: dismiss modal on success, Alert on error

`src/screens/shop/ShopOrderDetailScreen.tsx` `onSubmit` block (around line 769):

```tsx
onSubmit={async (responseText) => {
  if (!order.ratingId) return;
  setResponseSubmitting(true);
  try {
    await orderService.respondToReview({
      ratingId: order.ratingId,
      responseText,
    });
    setRespondModalOpen(false);
    // re-fetch order so the rating block reflects 'responded' state
    await refetch(); // use whatever the existing screen calls — verify symbol
  } catch (e: any) {
    Alert.alert(
      'Could not send response',
      e?.message || 'Please try again.',
    );
  } finally {
    setResponseSubmitting(false);
  }
}}
```

Same pattern in `src/screens/delivery/DeliveryOrderDetailScreen.tsx` around line 511.

**Important:** find the existing refetch mechanism (`refetch`, `reloadOrder`, `useDeliveryOrderDetail` hook reload, etc.) by grepping the screen — don't introduce a new one.

### §E — Update the existing `respondToReview` test file to cover the role-claim shape

Find `tests/functions/respondToReviewHelpers.test.ts` or similar. If none exists, create it covering §B's helper. Plus extend the integration-style test (if one exists) for the callable to use the auth-token claim shape `{ shopOwner: true }` / `{ delivery: true }` — NOT the mirror field shape — so a regression to the old check would fail.

## Discipline checklist

1. **Rule 1** — every new import / helper carries "HOTFIX-RATING-RESPONSE — DO NOT REMOVE" comments.
2. **Rule 2** — N/A (no new screens / hooks).
3. **Rule 5** — schema audit-grep table in header. Auth-token claims vs user-doc mirror fields are now formally documented. Add an entry to `.windsurf/code-discipline.md` Rule 5 extension as the worked example.
4. **Rule 7** — auth.token shape (already added at HOTFIX-5 time).
5. **Rule 8** — FEATURES.md update list is in the Doc trail section below. Three rows touched (Shop §2.5, Delivery §3.8, Customer §1.9) — no description changes, lineage HTML comments + section date stamps required.
6. **Rule 11** — IAM verify on `respondToReview` (modified). 1 service.
7. **Rule 14** — server-side gate returns Result via the new helper.
8. **Schema-additive** — no new fields.
9. **Test discipline:** **+6 minimum** for §B's helper. Plus the existing-test extension in §E may add 1-2 more. Forecast: **+7 tests** to suite.

## Acceptance checklist

1. As customer, leave a 1-star or 2-star rating on a delivered order (low enough to flag).
2. As shop owner of that shop, open OrderDetail → "Respond" → type a message → Send response. Modal dismisses. Order detail refreshes. Rating block now shows shop's response. No silent failure.
3. As delivery partner who delivered that order, repeat step 2 via your own OrderDetail. Same successful path.
4. As shop owner of a DIFFERENT shop, manually invoke `respondToReview({ ratingId, responseText })` against the same review → `permission-denied`. (Regression guard.)
5. As delivery partner who did NOT deliver that order, same manual invocation → `permission-denied`.
6. Send response on an already-responded review → server rejects with `failed-precondition` → Alert appears: "Could not send response — Cannot respond in state 'responded'". Modal stays open.
7. **Cloud Run IAM** verify on `respondToReview`. Re-add `allUsers` if stripped.
8. `tsc` + tests clean. Suite +7 minimum.
9. **Deliberate-break demo:** revert §A's claim names to `isShopOwner` / `isDelivery`. Run `npm run test:unit`. The auth-token-shape test from §E must fail. Restore §A. Tests pass.

## Out of scope

- Customer-side amend / acknowledge handlers (those are separate callables; this is response-only).
- Shop-side OR delivery-side responding to a DIFFERENT shop's / partner's review (per-role scope already correct in §B helper).
- Multi-back-and-forth threads (single response model unchanged).
- Push notification reliability of the customer's "review_responded" push (separate observation if it bubbles up later).

## Deploy

```
cd functions; npm run build; cd ..
firebase deploy --only "functions:respondToReview"

gcloud run services get-iam-policy respondtoreview --region=asia-south1 --project=grocery-mvp-dev
# If etag: ACAB (empty policy), re-bind:
# gcloud run services add-iam-policy-binding respondtoreview --region=asia-south1 --member=allUsers --role=roles/run.invoker --project=grocery-mvp-dev

eas update --branch production --message "HOTFIX-RATING-RESPONSE — server auth claim fix + client defensive error handling"
```

## Doc trail (Cowork)

After ship:

- **TESTING-FINDINGS** — close #6 + #7.
- **CLAUDE.md** In-flight strike.
- **SESSION_LOG** paragraph.
- **PROMPT_AUTHORING_NOTES** — extend Rule 5 with worked-example list:
  - #1 HOTFIX-5 (delivery role gate — `isDelivery` vs `delivery`)
  - #2 HOTFIX-RATING-RESPONSE (response gate — `isShopOwner` / `isDelivery` vs `shopOwner` / `delivery`)
  - Standing audit-grep for ALL future PRs touching server auth: `grep -rn "claims\.is[A-Z]" functions/src` — must return zero hits other than legitimate mirror-field reads (which should be against Firestore docs, not `claims`).
- **FEATURES.md** (per PROMPT_AUTHORING_NOTES Rule 8 — mandatory):
  - **Shop panel §2.5 Reviews** — "Respond to low rating" row: **no row change** (feature works correctly now). Verify description "Modal to add response text; pre-publishes the review" still accurate.
  - **Delivery panel §3.8 Reviews** — "Respond to low rating" row: same. No row change.
  - **Customer panel §1.9 Ratings & reviews** — "Low-rating correction workflow" row: verify still accurate after server fix; no description change.
  - Add a `<!-- HOTFIX-RATING-RESPONSE 2026-06-10 — server auth claim fix -->` HTML comment next to each of the three rows above for lineage.
  - **Last updated** stamps on Shop §2.5, Delivery §3.8, Customer §1.9 → 2026-06-10.
