# PR 5 — Shop owner settings + checkout polish (Windsurf prompt)

## Why this PR exists

Three small items surfaced during family-style testing on May 17 2026:

1. **Shop owners can't edit `deliveryFee` or `minOrder` from the
   app.** Both fields are set only via the initial seed or via
   Firestore Console. Real shop owners need self-service control —
   it's basic business-parameter management. Currently the platform
   operator (admin) has to manually edit Firestore docs for every
   shop that wants to change its delivery fee. Doesn't scale past
   ~2 shops.

2. **Razorpay Checkout prompts for email** because we don't prefill
   it. Friction at the highest-conversion-stakes moment. Easy to
   fix — pass `prefill.email` if the user has one in their profile,
   else a phone-derived placeholder.

3. **Admin testing hits `minOrder` validation.** When the operator
   (admin role) is testing the customer flow, they have to manually
   lower a shop's `minOrder` in Firestore to place a small test
   order. Annoying enough that this happened tonight. Server-side
   bypass for admin role is a 5-line fix.

All three are client + small server changes. Pure JS-only OTA at
the end (plus one new callable for the shop settings update).

## Read first

- `.windsurf/test-discipline.md` and `.windsurf/deploy-discipline.md`.
- `functions/src/index.ts` — `placeOrder` is where item 3 lands.
  `addCustomMenuItem` is the closest pattern for the new shop-
  settings callable (shop-owner-only, scoped via `claims.shopId`,
  whitelisted field updates).
- `src/screens/CheckoutScreen.tsx` — item 2 is a 5-line change in
  the `prefill` object passed to `openRazorpayCheckout`. Profile
  is already loaded on this screen.
- `src/screens/shop/ShopOwnerDashboardScreen.tsx` — most natural
  host for the "Edit settings" entry point. Or add a "Settings"
  tile next to "Manage Menu".
- `src/types/index.ts` — `Shop.deliveryFee` and `Shop.minOrder`
  exist already; no type changes needed.
- `src/services/orderService.ts` — pattern for the new client
  method dispatching to RNFB native and web SDK.

## Scope (in)

### Part 1 — Shop owner self-service `deliveryFee` + `minOrder`

#### 1a. Server callable: `updateShopSettings`

New Cloud Function in `functions/src/index.ts`. Shop-owner-only,
scoped to `claims.shopId`. Whitelisted fields. Pure helper for the
validation logic.

```ts
export const updateShopSettings = onCall<{
  deliveryFee?: number;
  minOrder?: number;
}>(
  { cors: true, enforceAppCheck: false },
  async (request) => {
    // Auth: shopOwner claim required, shopId from token (not from
    // the request body — clients can't target someone else's shop).
    // Validate via helper: deliveryFee >= 0 AND <= 500 (sanity cap),
    // minOrder >= 0 AND <= 10000 (sanity cap). At least one field
    // must be present.
    // Write only the present fields plus updatedAt.
  }
);
```

Pure helper file `functions/src/shopSettingsHelpers.ts`:
```ts
export type ShopSettingsInput = {
  auth: { uid: string; token?: { shopOwner?: unknown; shopId?: unknown } } | null;
  deliveryFee?: unknown;
  minOrder?: unknown;
};

export type ShopSettingsResult =
  | { ok: true; shopId: string; updates: { deliveryFee?: number; minOrder?: number } }
  | { ok: false; code: 'unauthenticated' | 'permission-denied' | 'invalid-argument'; message: string };

export function validateShopSettings(input: ShopSettingsInput): ShopSettingsResult { ... }
```

Validation rules (enforced in helper):
- Caller must be authenticated.
- Caller's `token.shopOwner === true` AND `typeof token.shopId === 'string'`.
- At least one of `deliveryFee` / `minOrder` must be a finite
  number (other can be omitted to update just one).
- `deliveryFee` (if present): number, integer, 0 ≤ value ≤ 500.
- `minOrder` (if present): number, integer, 0 ≤ value ≤ 10000.
- Rejects negative, NaN, Infinity, strings, etc.

Pinned by `tests/functions/shopSettingsHelpers.test.ts` with ≥8
tests covering each rule.

#### 1b. Client method + Settings screen

`orderService.updateShopSettings({ deliveryFee?, minOrder? })` —
standard RNFB/web SDK dispatch.

New screen `src/screens/shop/ShopSettingsScreen.tsx`:
- Reads current `Shop` via `orderService.getShopForOwner()` on
  mount.
- Two numeric inputs: "Delivery fee (₹)" and "Minimum order (₹)".
- Inline help text under each: "Customers must order at least this
  amount" and "Charged on every order. Set to 0 to offer free
  delivery."
- Save button calls `updateShopSettings` with only the changed
  fields (mirrors `ShopMenuItemEditScreen`'s dirty-field pattern).
- Wrap in `KeyboardAvoidingView` per the canonical pattern from
  `CancelAndRefundModal` — short form, but two numeric inputs in
  sequence will hit the keyboard-cover bug otherwise.

Register the route in `src/navigation/AppNavigator.tsx` as
`ShopSettings: undefined;`.

Entry point: add a "⚙️ Shop Settings" tile to
`ShopOwnerDashboardScreen.tsx` right above the existing "📋
Manage Menu" tile. Same visual treatment.

### Part 2 — Razorpay email prefill

In `src/screens/CheckoutScreen.tsx`, change the `prefill` object
passed to `openRazorpayCheckout`:

```ts
// Before:
prefill: { name: address.name, contact: address.phone },

// After:
prefill: {
  name: address.name,
  contact: address.phone,
  email: deriveCheckoutEmail(profile, address.phone),
},
```

New small helper in `src/utils/checkoutEmail.ts`:
```ts
/**
 * Razorpay Checkout requires email by default (RBI compliance for
 * receipt delivery). Use the user's saved profile email if present,
 * otherwise generate a phone-derived placeholder that satisfies
 * Razorpay's input validation without creating a fake real email.
 *
 * The `noemail.kiranamart.app` domain doesn't accept mail; this is
 * a sentinel placeholder, not a delivery target. Real receipts go
 * to profile.email when that's filled in.
 */
export function deriveCheckoutEmail(
  profile: { email?: string | null } | null,
  phone: string,
): string {
  const cleaned = profile?.email?.trim();
  if (cleaned && cleaned.includes('@')) return cleaned;
  const phoneDigits = phone.replace(/\D/g, '');
  return `${phoneDigits || 'guest'}@noemail.kiranamart.app`;
}
```

Pinned by `tests/utils/checkoutEmail.test.ts` (≥4 tests):
- Uses profile.email when present + non-empty.
- Falls back to phone-derived placeholder when profile is null.
- Falls back when profile.email is empty / whitespace.
- Handles phones with `+91` prefix and other non-digit characters.

### Part 3 — Admin bypass for `minOrder` in `placeOrder`

Server-side change in `functions/src/index.ts`'s `placeOrder`.
After computing `subtotal`:

```ts
const isAdminCaller = request.auth?.token?.admin === true;
if (!isAdminCaller && subtotal < shop.minOrder) {
  throw new HttpsError(
    'failed-precondition',
    `Minimum order is ₹${shop.minOrder}. Cart total is ₹${subtotal}.`,
  );
}
// Existing flow continues; admin orders bypass the minOrder gate.
```

Subtle but important: this ONLY bypasses `minOrder`. All other
validations (item availability, price drift, stock checks,
multi-shop cart guard from PR 4) still apply to admin orders. The
admin bypass is specifically for the operator-testing case, not a
general "admin can do anything" backdoor.

Pinned by extending `tests/functions/placeOrderMenuValidation.test.ts`
(or adding a small new test file) with two tests:
- Non-admin caller below `minOrder` → rejected.
- Admin caller below `minOrder` → accepted (other validation still
  runs).

## Scope (out — explicitly defer)

- **Other shop business parameters** beyond deliveryFee + minOrder
  (e.g. hours, GST number, FSSAI license). Those flow through
  `registerShop` and would need a separate "Edit registration"
  flow. Track separately.
- **Razorpay Checkout `notes` field** for richer transaction
  metadata. Useful for reconciliation but not blocking.
- **Profile email entry UI** if the user wants to set their email
  for real receipts. The Profile screen already supports email; if
  not, add to a small follow-up PR. Don't bundle here.
- **Admin bypass on other validations** (availability, stock,
  price drift). Those exist for real reasons and admin shouldn't
  bypass them even when testing. The `minOrder` bypass is narrowly
  scoped because admin-testing-small-orders is a frequent operator
  need.
- **Per-customer first-time-discount-bypass on minOrder**. That's a
  promotion-engine feature, not MVP.

## Acceptance checklist

- [ ] `updateShopSettings` callable deployed in asia-south1.
- [ ] `shopSettingsHelpers.ts` pure helper with ≥8 tests covering
      all validation rules.
- [ ] `ShopSettingsScreen` created, routed, accessible from
      ShopOwnerDashboard's new "⚙️ Shop Settings" tile.
- [ ] Settings screen wraps inputs in `KeyboardAvoidingView` per
      canonical pattern.
- [ ] `deriveCheckoutEmail` helper exists + tested (≥4 tests);
      CheckoutScreen's Razorpay prefill uses it.
- [ ] `placeOrder` bypasses `minOrder` for admin callers; helper
      test extended to cover this branch.
- [ ] `npm test` passes — total ≥ baseline + ~14 new tests.
- [ ] Deliberate-break demo: weaken `validateShopSettings` so the
      "shopOwner claim required" check returns ok for any caller.
      Confirm a specific test fails by name. Revert.
- [ ] `npx tsc --noEmit` — 0 new errors.
- [ ] `npm run audit:indexes` passes (no new queries; expect no
      change).

## Deploy plan (hand to user — NOT executed)

```powershell
$env:NODE_OPTIONS = "--use-system-ca"

# Functions: the new callable + updated placeOrder
firebase deploy --only functions:updateShopSettings --project grocery-mvp-dev
firebase deploy --only functions:placeOrder --project grocery-mvp-dev

# Verify
firebase functions:list --project grocery-mvp-dev

# OTA preview
eas update --branch preview --message "PR 5: shop settings + checkout polish + admin minOrder bypass"
```

Smoke tests on preview:
1. **Shop settings**: open Shop Dashboard → Shop Settings → change
   deliveryFee from 25 to 30 → save → reload → confirm change
   persists. Try a customer order from that shop; new delivery fee
   shows in checkout summary.
2. **Razorpay email prefill**: place a paid order → Razorpay
   popup → email field is prefilled (with profile email if set,
   else `<phone>@noemail.kiranamart.app`). No friction at the
   email step.
3. **Admin minOrder bypass**: as admin, set a shop's `minOrder` to
   500 via the new settings screen. Place a customer order with
   subtotal < 500 → as a non-admin customer, server rejects with
   "Minimum order is ₹500." As the admin (same shop), order
   succeeds.

If all clean: `eas update --branch production --message "PR 5..."`.

## Reporting back

- Output of `npm test`.
- Output of `npx tsc --noEmit`.
- Deliberate-break demo: which test fell, what you weakened,
  confirmation of revert.
- Files added: list with line counts.
- The deploy commands handed back to me.

## Design notes for Windsurf

- The settings screen is intentionally minimal — two fields, save
  button. Resist adding hours / GST / FSSAI to it; those flow
  through registration and editing them is a separate (bigger)
  decision.
- The admin bypass needs to use `request.auth?.token?.admin === true`
  (strict equality). Don't use truthy checks; admin claim has bitten
  us before with truthy-but-not-true tokens.
- The `deriveCheckoutEmail` helper goes in `src/utils/` so it's
  test-friendly without React. Don't inline it in CheckoutScreen.
- Auto-formatter import-stripping: same warning as PRs 1, 2, 12c.
  Verify `validateShopSettings`, `deriveCheckoutEmail` imports
  survived after each save.
- The `ShopSettingsScreen` will need a `Loader` + `EmptyState` for
  the case where `getShopForOwner()` returns null (rare — owner has
  no shop, which shouldn't happen if they hit this screen via the
  ShopOwnerDashboard tile, but defensive).
