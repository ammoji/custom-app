# Solo-test hotfix — Shop Dashboard INTERNAL + checkout address default + cart-shop menu mismatch

## Why this PR exists

Three bugs surfaced in Sudhir's first proper solo-testing pass after
the auth-UX PR landed. Each may be independent, or two of them may
share a Cloud Function root cause — Windsurf should diagnose before
patching.

### Bug 1 — Shop Dashboard shows "INTERNAL" error with red Retry banner

Repro: sign in as a shop owner (newly registered + admin-approved
shop), tap **🛍️ Shop Dashboard** from Home. Loader resolves into
the watcher-contract error banner with message "INTERNAL".

Likely cause: `listShopOrders` Cloud Function is throwing an
uncaught exception. The watcher contract refactor surfaces it as an
error (which is the correct behavior — pre-refactor it would have
silently spun forever). But the root cause is still in the function.

### Bug 2 — Saved addresses don't auto-fill at Checkout

Repro: sign in as a user who has saved ≥1 address via Profile →
Add new address. Add an item to cart. Open Checkout. Expected: the
saved-address picker (radio cards) appears with the default
selected. Actual: form mode renders empty.

Suspicion: `getMyProfile` callable is failing silently (`.catch`
swallows the error and falls through to `setUsingForm(true)`).
Possibly the same Cloud Function gateway issue causing Bug 1, OR a
distinct problem (auth token, profile doc missing, etc).

Also relevant: with two saved addresses (first = shop address,
second = personal), the **first** is the default per
`saveAddress` semantics — so Sudhir would see his shop address
auto-fill if loading worked correctly. The "empty" symptom means
loading didn't work, not that the wrong default was picked.

### Bug 3 — "Product p_001_atta_5kg not in this shop" at payment

Repro: sign in as customer. Browse a freshly-approved shop (one
that went through register → admin-approve, where
`bootstrapShopMenu` ran). Add an item (e.g. Aashirvaad atta) to
cart from the shop detail page. Proceed to checkout. Tap Place
Order. Server rejects with that error message.

The error message wording (`"Product ${productId} not in this
shop"`) is from the **legacy** placeOrder validation path — the
one that runs when the cart line has NO `menuItemId`. So one of
these is true:

- A. Customer flow's "Add to cart" from ShopDetailScreen is NOT
  setting `menuItemId` on the cart line. (v2-iii regression.)
- B. The menu validation path IS being taken, but the message text
  was copy-pasted from the legacy path's error.
- C. `bootstrapShopMenu` didn't actually run on this shop's
  approve, so the menu subcollection is empty AND the legacy path
  is correctly catching that.

Windsurf must read the actual placeOrder code + the customer
add-to-cart code to determine which. Then fix whichever applies.

## Read first

- **`.windsurf/test-discipline.md`** — tests run **once at end**,
  plus the deliberate-break demo. `npm test` is the runner.
- `.windsurf/deploy-discipline.md`
- `functions/src/index.ts` — `listShopOrders`, `placeOrder`,
  `getMyProfile`, `bootstrapShopMenu`
- `src/services/orderService.ts` — `watchShopOrders`,
  `getMyProfile`-related callers
- `src/screens/shop/ShopOwnerDashboardScreen.tsx` (banner + retry)
- `src/screens/CheckoutScreen.tsx` (the `useFocusEffect` that calls
  `getMyProfile` and pre-fills)
- `src/screens/ShopDetailScreen.tsx` + the add-to-cart flow
  (find the path from "tap +" on a menu item → cart store)
- `src/store/useCartStore.ts` — `addMenuItem` / `addItem`,
  particularly whether they accept and persist `menuItemId`

## Diagnostic phase (do this FIRST, before writing any fix)

1. **Bug 1 — pull the Cloud Function logs.**

   ```
   firebase functions:log --only listShopOrders --project grocery-mvp-dev
   ```

   Find the most recent error-level entries. Report the stack trace
   verbatim. If the trace points at a specific line in
   `functions/src/index.ts`, that's the fix target.

   If logs show no errors, the INTERNAL is happening client-side
   (RNFB SDK serialising something it shouldn't) — investigate
   `getNativeFunctions().httpsCallable('listShopOrders')` path in
   `orderService.watchShopOrders`.

2. **Bug 2 — confirm whether the failure is `getMyProfile` itself
   or the screen's handling of its result.**

   Read `CheckoutScreen`'s `useFocusEffect` block (Sudhir's session
   transcript has the file; it's the one that calls
   `profileService.getMyProfile()` and falls through to
   `setUsingForm(true)` on any error). Decide if the catch is
   masking a real bug.

   Then check the Cloud Function logs:
   ```
   firebase functions:log --only getMyProfile --project grocery-mvp-dev
   ```

3. **Bug 3 — confirm the cart line shape.**

   In a fresh dev session, sign in as a customer, browse a shop
   (any of the seeded `shop_001`-`shop_008` should work since they
   were backfilled), add an item via the ShopDetail page, then
   inspect the cart state — either via the `__DEV__` log line on
   Home, a quick `console.log(items)` in `CartScreen`, or
   `useCartStore.getState()` from a debugger.

   Look at the cart line for the item you just added. Does it have
   `menuItemId` populated? `priceSnapshot`?

   - If `menuItemId` is **absent** → ShopDetailScreen's add-to-cart
     handler isn't passing it through. Fix in the screen + cart
     store.
   - If `menuItemId` is **present** → placeOrder's menu-validation
     path is mis-keyed, or its error message text is copy-pasted
     from the legacy path. Fix in `functions/src/index.ts`.

   Then check the menu subcollection on the freshly-approved shop:
   ```
   gcloud firestore documents list \
     --collection=shops/<freshShopId>/menu \
     --project=grocery-mvp-dev
   ```
   If empty → `bootstrapShopMenu` didn't run during `approveShop`.
   Check the approve flow + bootstrap helper.

**Report what each diagnostic found before writing any fix code.**
Sudhir reviews the diagnosis, confirms the fix direction, then
Windsurf implements. This avoids a "fixed something but wrong
thing" round-trip.

## Scope (in)

Once the diagnostic phase has clarified each bug:

1. Fix Bug 1 — uncaught exception in `listShopOrders` (or wherever
   the trace points). Common candidates:
   - Reading `claims.shopId` when it's undefined (admin who isn't a
     shop owner shouldn't be able to call this, but if a stale
     claim exists, defensive null check matters)
   - Firestore query against a missing collection / wrong path
   - Timestamp serialisation issue in the response

2. Fix Bug 2 — whatever the diagnostic surfaced. Most likely
   either:
   - `getMyProfile` throws because the user's `/users/{uid}` doc
     doesn't exist AND the first-call seed logic isn't actually
     running (revisit the "create doc on first call" logic from
     the auth-UX PR)
   - CheckoutScreen's `.catch` is swallowing a real error — at
     minimum surface it in a toast so the user knows something
     went wrong; ideally fix the root cause

   Also: when `setUsingForm(true)` runs because no addresses are
   loaded yet, the form should NOT render with stale empty fields
   that LOOK like a deliberate empty state. Consider showing a
   small "Couldn't load saved addresses — enter address manually"
   note above the form when this happens, so the user understands
   why the picker didn't appear.

3. Fix Bug 3 — whichever of A/B/C the diagnostic identified.

4. **Watcher contract regression guard.** While we're in
   `ShopOwnerDashboardScreen`, verify the error banner is actually
   showing a useful message (not just "INTERNAL"). Map common
   error codes to user-friendly strings — at minimum:
   - `internal` → "Couldn't load orders. Please try again or
     contact support."
   - `unauthenticated` → "Session expired. Please sign in again."
   - `permission-denied` → "You don't have access to this shop's
     orders."
   - default → server-provided message OR "Couldn't load orders.
     Pull to refresh."

## Scope (out — explicitly defer)

- Shop-curation redesign (Bug 5 from Sudhir's list) — separate
  pre-launch PR
- Profile / shop photo upload — feature, parked
- Tax + tip — feature, parked
- "Hi {Name}" greeting — feature, parked
- Bulk add-from-catalog UX for shop owners — separate PR

## Tests (mandatory)

Per `.windsurf/test-discipline.md`. Aim for ≥6 new tests covering
the fix surface.

Suggested split (adapt based on what the diagnostic finds):

1. `tests/functions/listShopOrdersValidation.test.ts` (≥2 tests) —
   extract the input/claims validation from `listShopOrders` into a
   pure helper and pin: a) accepts valid shopOwner claim with
   matching shopId; b) rejects when `claims.shopId` is undefined
   with a descriptive HttpsError (not INTERNAL).

2. `tests/functions/placeOrderMenuValidation.test.ts` (≥2 tests)
   — extract the cart-line validation switch (menuItemId present
   vs absent) into a testable helper. Pin: a) line with valid
   menuItemId checks against menu subcollection; b) line without
   menuItemId falls back to legacy path (with the existing error
   message, OR an updated one — whichever fix the diagnostic
   chose).

3. `tests/screens/CheckoutScreen.profileLoad.test.ts` OR a hook
   extraction following the `useShopListData` pattern. (≥2 tests)
   — pin: a) when `getMyProfile` succeeds with ≥1 address, picker
   mode renders selectable cards; b) when `getMyProfile` throws,
   form mode renders + a "couldn't load saved addresses" notice
   is set in state.

   If extracting a hook is too invasive for the hotfix, write the
   tests against a small extracted state-machine function like the
   v2-iii pattern.

4. **Error message mapping** test (≥1 test) — if you add the
   error-code-to-user-message mapping in section 3 of the fix
   spec, pin it with a test that runs through the common codes
   and asserts the mapped strings.

**Deliberate-break demo** required as usual: revert one of the new
tests' subject behavior (e.g. weaken the `listShopOrders` claims
guard to accept undefined shopId), confirm the corresponding test
fails by name, revert, confirm green.

## Deploy + OTA

Per deploy discipline, one `--only` target per command. Which
functions need to redeploy depends on what the diagnostic finds.
At minimum likely:

```
firebase deploy --only functions:listShopOrders --project grocery-mvp-dev
firebase deploy --only functions:placeOrder --project grocery-mvp-dev
firebase deploy --only functions:getMyProfile --project grocery-mvp-dev
firebase functions:list --project grocery-mvp-dev
```

Then OTA:

```
eas update --branch preview --message "solo-test hotfix: shop dashboard INTERNAL + checkout address default + cart menu mismatch"
```

## Acceptance checklist

- [ ] Diagnostic phase findings documented in the report (for each
      of the 3 bugs)
- [ ] Cloud Function logs for `listShopOrders`, `getMyProfile`,
      `placeOrder` pasted in the report (last error or last 10
      lines)
- [ ] `npm test` passes — total count ≥ 79 (current baseline) + N
      new
- [ ] `npx tsc --noEmit` — 11 baseline errors, 0 new
- [ ] Deliberate-break demo executed and reverted; failing test
      name captured
- [ ] Functions redeployed; `functions:list` excerpt shows fresh
      updateTimes
- [ ] OTA published with group ID + iOS + Android IDs
- [ ] On Sudhir's phone (he'll verify post-OTA):
   - Shop Dashboard loads orders or shows empty state — never
     INTERNAL
   - Checkout shows saved-address picker when ≥1 address exists
   - Adding atta from a shop's menu → checkout → place order
     succeeds (no "not in this shop" rejection)

## Reporting back

- Diagnostic findings for each bug (what the logs showed, what
  code was actually broken)
- Each fix's diff summary
- Total new test count from `npm test`
- Deliberate-break demo output
- Deploy outputs (raw, not piped)
- OTA group + platform IDs
- Anything found in the diagnostics that's a separate bug — log
  to PRELAUNCH_CHECKLIST, don't silently fix

## Important — do not

- Do not skip the diagnostic phase. Don't guess at the fix —
  pull the logs first.
- Do not change the shop-curation behavior (Bug 5 is deferred)
- Do not add features (greeting, photo upload, tax/tip) — they're
  parked
- Do not modify `firestore.rules`
- Do not fix the 11 baseline TS errors
- Do not auto-format outside the diff
- Do not chain `--only` deploys
- Do not commit anything — staged for review
- Do not run tests iteratively — exactly twice (deliberate-break +
  final), per the discipline doc
