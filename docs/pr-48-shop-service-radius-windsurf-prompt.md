# PR 48 — Shop service radius + customer distance visibility (Windsurf prompt)

> Third PR of the geo/distance system (see
> `docs/GEO_DISTANCE_SYSTEM_DESIGN.md` → "PR 48" section). Builds on
> the haversine foundation PR 46 shipped: the server already computes
> `distanceKm` per shop in `rankShopsByDistance`. PR 48 turns that
> distance into a **visibility gate** — a shop only shows to
> customers within its own `serviceRadiusKm` — and surfaces the
> distance on each shop card.
>
> **Also bundles two post-PR-47 Shop Settings fixes** (Sudhir, smoke
> test): (1) the tier editor's saves don't survive a reload, and
> (2) the now-redundant flat "Delivery fee" input. Folding them in so
> there's one migration + one test pass, not three. See sections I + J.

## Why this PR exists

Today every active shop shows to every customer regardless of
distance. The mechanism is a hardcoded `SHOW_ALL_SHOPS = true`
constant in `src/services/shopService.ts` (line 17), added in PR 10
so cross-city testers could see each other's shops. That's correct
for a multi-city testing phase but wrong for real customers: a
Faridabad shop must not show to a Delhi customer who can never
realistically receive delivery from it.

PR 48 replaces the blanket flag with a real **per-shop service
radius**:

> A shop sets how far it delivers (`serviceRadiusKm`). The customer
> shop list filters to shops where
> `haversine(customer, shop) <= shop.serviceRadiusKm`, and each card
> shows the actual distance ("~2.3 km").

This is goal #5 of the geo design. The distance input is already
solved (PR 46's `rankShopsByDistance` decorates every shop with
`distanceKm`); PR 48 adds the radius field, the gate, and the
owner-facing setting.

## ⚠️ The critical architectural constraint — read this before designing

**The native client cannot read Firestore directly.** This is the
whole reason `shopService.getNearbyShops` and `orderService` use the
"Plan B" callable path: the Firebase Web SDK Firestore client hangs
on this RN setup (Expo SDK 54 + RN 0.81 + static frameworks). On
native, all reads go through callables (`listShopsPublic`).

Two consequences that **must** shape this PR:

1. **The radius filter belongs SERVER-SIDE, in `listShopsPublic`** —
   not in the client `getNearbyShops`. The server is where
   `distanceKm` is computed (`rankShopsByDistance`) and where a
   config flag can actually be read. The client just renders what
   the server returns.

2. **The "show all shops" override must be a SERVER-SIDE Firestore
   flag, not `__DEV__`.** The existing code comment on line 9-16 of
   `shopService.ts` documents exactly why the old
   `FORCE_SHOW_ALL_SHOPS_IN_DEV` failed: `__DEV__` is `false` in
   TestFlight builds, so cross-city testers on TestFlight couldn't
   see each other's shops. The offshore testing team is on
   TestFlight. If PR 48 flips the gate on with only a `__DEV__`
   escape hatch, **the testing team immediately goes blind** —
   they'll only see shops within 5 km of wherever they physically
   are, across different cities. So the override is a Firestore doc
   the server reads: `appConfig/shopVisibility` →
   `{ showAllShops: boolean }`. Set it `true` for the cross-city
   testing window; flip to `false` (or delete the doc) at real
   1-shop pilot. **No rebuild, no redeploy to toggle** — exactly the
   server-configurable lever the line-16 comment wished for.

## Read first

- `docs/GEO_DISTANCE_SYSTEM_DESIGN.md` — "PR 48" section + the
  `Shop.serviceRadiusKm` data-model note.
- `src/services/shopService.ts` — `getNearbyShops`, the
  `SHOW_ALL_SHOPS`/`NEAR_KM` gate (lines 17-18, 44, 50-52). This is
  what gets gutted.
- `functions/src/index.ts` ~line 5577 — `rankShopsByDistance`
  (pure helper, already decorates `distanceKm` + sorts) and
  ~line 5600 — `listShopsPublic` (the callable). The radius filter
  lands here.
- `functions/src/index.ts` ~line 3736-3760 — `approveShop`'s
  default-seeding block (PR 47 seeds `deliveryChargeTiers` here).
  The default `serviceRadiusKm` seeds alongside, same pattern.
- `functions/src/index.ts` ~line 3909 — `getMyShop` callable (the
  reload-read path behind the tier-save bug, section I).
- `functions/src/index.ts` ~line 5309-5362 — `updateShopDeliveryTiers`
  callable (writes `updatedAt: Date.now()` — the type-mismatch bug,
  section I).
- `functions/src/shopSettingsHelpers.ts` — `validateShopSettings`,
  the whitelisted-numeric-field validator for `updateShopSettings`.
  `serviceRadiusKm` rides here as a third whitelisted field.
- `functions/src/index.ts` — the `updateShopSettings` callable
  wrapper that calls `validateShopSettings`.
- `src/screens/shop/ShopSettingsScreen.tsx` — where the owner edits
  `deliveryFee` / `minOrder` (and, from PR 47, the delivery-charge
  tiers). The service-radius field lands in the same settings form.
- `src/components/shop/ShopCard.tsx` — line 53 already renders
  `formatDistance(shop.distanceKm)`. Confirm it shows; no change
  expected, but verify the empty/undefined-distance case.
- `src/screens/ShopListScreen.tsx` — line 193 already has a "No
  shops near you" empty state; it becomes reachable for the first
  time once the gate is real.
- `.windsurf/deploy-discipline.md` — Cloud Run IAM verification for
  the modified `listShopsPublic` + `updateShopSettings` callables.
- `.windsurf/code-discipline.md` — Rule 8 (stable Zustand/selector
  refs) if any selector is touched; not expected here.

## Scope of changes

### A. `Shop` type — service radius

`src/types/index.ts`, on the `Shop` type (near the PR 47
`deliveryChargeTiers` field, ~line 86):

```ts
// PR 48 — shop service radius. OPTIONAL for back-compat: legacy
// shops (and the existing seeded shops) without it fall back to
// DEFAULT_SERVICE_RADIUS_KM in the filter helper, so they keep a
// sane 5 km reach until the owner customizes it. New shops get the
// default seeded by approveShop at approval time. Owner edits via
// Shop Settings → Service area (updateShopSettings).
serviceRadiusKm?: number;
```

OPTIONAL. Do not make it required — that would break MOCK_SHOPS and
every legacy `Shop` literal.

### B. Pure helper — `functions/src/geoVisibilityHelpers.ts` (new)

The filter logic, fully testable without firebase-admin (same
posture as `deliveryChargeHelpers`, `shopSettingsHelpers`,
`distanceMatrixHelpers`).

```ts
/**
 * PR 48 — shop service-radius visibility gate.
 *
 * Pure decision logic for which active shops a customer at a given
 * location should see. Lives outside index.ts so it's unit-testable
 * without firebase-admin or the emulator.
 *
 * Inputs are already-ranked shops (rankShopsByDistance has stamped
 * distanceKm + sorted). This helper ONLY decides inclusion.
 */

export const DEFAULT_SERVICE_RADIUS_KM = 5;

type RadiusFilterable = {
  distanceKm?: number;
  serviceRadiusKm?: number;
};

/**
 * Keep a shop iff it's within its own service radius of the customer.
 *
 * Fail-OPEN rules (never strand a customer with an empty list because
 * of missing data):
 *   - showAll === true        → keep every shop (testing override).
 *   - distanceKm is undefined → keep (no customer location, or shop
 *     has no location → we can't filter, so we don't hide).
 *   - serviceRadiusKm missing → use DEFAULT_SERVICE_RADIUS_KM.
 *
 * Boundary is INCLUSIVE (exactly at the radius → visible), matching
 * the tier-boundary convention from PR 47.
 */
export function filterShopsByServiceRadius<T extends RadiusFilterable>(
  shops: T[],
  opts: { showAll: boolean },
): T[] {
  if (opts.showAll) return shops.slice();
  return shops.filter(s => {
    if (typeof s.distanceKm !== 'number' || !Number.isFinite(s.distanceKm)) {
      return true; // fail-open: can't measure → don't hide
    }
    const radius =
      typeof s.serviceRadiusKm === 'number' &&
      Number.isFinite(s.serviceRadiusKm) &&
      s.serviceRadiusKm > 0
        ? s.serviceRadiusKm
        : DEFAULT_SERVICE_RADIUS_KM;
    return s.distanceKm <= radius;
  });
}
```

Note: `DEFAULT_SERVICE_RADIUS_KM` is the single source of truth for
the default; `approveShop` imports the same constant for seeding so
the seed value and the filter fallback can never drift.

### C. Server — read the flag + apply the filter in `listShopsPublic`

`functions/src/index.ts`.

1. Add a flag reader, mirroring `readDistanceMatrixFlag`
   (~line 5655) but defaulting to **false** (radius gate ON when the
   doc is absent — the secure/production-correct default; the
   testing override is the explicit opt-in):

```ts
/**
 * PR 48 — shop-visibility override. When
 * appConfig/shopVisibility.showAllShops === true, listShopsPublic
 * returns every active shop regardless of service radius (cross-city
 * testing). Default FALSE (missing doc → radius gate active) so
 * production never accidentally shows distant shops.
 */
async function readShowAllShopsFlag(): Promise<boolean> {
  const snap = await db.doc('appConfig/shopVisibility').get();
  if (!snap.exists) return false;
  const data = snap.data() as { showAllShops?: unknown } | undefined;
  return data?.showAllShops === true;
}
```

2. In `listShopsPublic`, after `rankShopsByDistance`, read the flag
   and filter:

```ts
const shops = rankShopsByDistance(rows, userLocation);
const showAll = await readShowAllShopsFlag();
const visible = filterShopsByServiceRadius(shops, { showAll });
return { shops: visible };
```

`rankShopsByDistance` already returns shops decorated with
`distanceKm` and carrying the full shop doc (so `serviceRadiusKm`
flows through untouched). No change to `rankShopsByDistance`.

### D. Client — gut the `SHOW_ALL_SHOPS` gate in `shopService.ts`

The server now owns filtering. The native path just trusts the
server list. The web path (Plan B — dev/secondary only; `getDocs`
works there) mirrors the server using the **same** pure helper so
behaviour matches.

- **Delete** `SHOW_ALL_SHOPS` and `NEAR_KM` constants (and the line
  9-16 comment block — replace it with a short note pointing at the
  server-side `appConfig/shopVisibility` flag).
- **Native branch:** drop the
  `.filter(s => SHOW_ALL_SHOPS || …)` — return
  `(result.data as any)?.shops ?? []` directly. Server already
  filtered.
- **Web branch:** import `filterShopsByServiceRadius` +
  `DEFAULT_SERVICE_RADIUS_KM`. Web reads the flag via the Web SDK
  (`getDoc(doc(db, 'appConfig', 'shopVisibility'))`, defaulting to
  `showAll: false` if missing/errored), then applies the helper.
  Keep it resilient: if the flag read throws, default to
  `showAll: false` (radius gate) — never crash the list.

⚠️ **Import-strip discipline (code-discipline Rule 1):** `haversineKm`
stays imported in `shopService.ts` — the web branch still uses it to
compute `distanceKm` before filtering. Do not let the LSP auto-remove
it when `SHOW_ALL_SHOPS` goes.

> Shared-helper note: the client imports from `functions/` are
> forbidden (repo convention — see PR 47's `src/utils/` mirror of
> `deliveryChargeHelpers`). So **mirror** `filterShopsByServiceRadius`
> + `DEFAULT_SERVICE_RADIUS_KM` into `src/utils/geoVisibilityHelpers.ts`
> (identical logic) and have the web branch import the client mirror.
> The server imports the `functions/src` copy. Same dual-copy pattern
> PR 47 used.

### E. `updateShopSettings` — whitelist `serviceRadiusKm`

`functions/src/shopSettingsHelpers.ts`. Add `serviceRadiusKm` as a
third optional whitelisted field on `ShopSettingsInput` +
`ShopSettingsResult.updates`, with a sanity cap. Match the existing
`deliveryFee`/`minOrder` integer-only pattern:

```ts
const SERVICE_RADIUS_MAX_KM = 50;   // urban kirana realistic ceiling

// in validateShopSettings, after the minOrder block:
const hasRadius = serviceRadiusKm !== undefined;
// ...fold hasRadius into the "at least one field" check...
if (hasRadius) {
  if (!isFiniteInteger(serviceRadiusKm)) {
    return { ok: false, code: 'invalid-argument',
      message: 'serviceRadiusKm must be a finite integer' };
  }
  if (serviceRadiusKm < 1 || serviceRadiusKm > SERVICE_RADIUS_MAX_KM) {
    return { ok: false, code: 'invalid-argument',
      message: `serviceRadiusKm must be between 1 and ${SERVICE_RADIUS_MAX_KM}` };
  }
  updates.serviceRadiusKm = serviceRadiusKm;
}
```

Integer-only (1–50 km) — matches the existing validator and keeps the
field coarse; sub-km service areas aren't meaningful for kirana
delivery. Update the "at least one of deliveryFee or minOrder is
required" message to include serviceRadiusKm. The `updateShopSettings`
callable wrapper already spreads `result.updates` into the Firestore
`update()`, so no wrapper change is needed beyond confirming it
passes `serviceRadiusKm` through from `request.data`.

### F. `approveShop` — seed the default radius

`functions/src/index.ts` ~line 3743-3758, alongside the PR 47
`seedTiers` logic. Same "only seed when absent" posture so a
re-approval after suspend doesn't clobber a customized radius:

```ts
const seedRadius =
  typeof shop.serviceRadiusKm === 'number' && shop.serviceRadiusKm > 0
    ? null
    : DEFAULT_SERVICE_RADIUS_KM;

await shopRef.update({
  status: 'active',
  // ...existing fields...
  ...(seedTiers ? { deliveryChargeTiers: seedTiers } : {}),
  ...(seedRadius != null ? { serviceRadiusKm: seedRadius } : {}),
  updatedAt: FieldValue.serverTimestamp(),
});
```

Import `DEFAULT_SERVICE_RADIUS_KM` from `geoVisibilityHelpers` in
index.ts (same as `DEFAULT_DELIVERY_CHARGE_TIERS` is imported from
`deliveryChargeHelpers`).

### G. Shop Settings UI — "Service area" field

`src/screens/shop/ShopSettingsScreen.tsx`. Add a numeric field
"Service area (km)" next to the existing delivery-fee / min-order
inputs (NOT inside the PR 47 tier-editor card — this is a single
scalar). String-typed draft state + a dirty flag, same pattern as
the existing fields. On Save, include `serviceRadiusKm` in the
`updateShopSettings` payload only when dirty (partial-update
contract the callable already supports).

- Pre-fill from `shop.serviceRadiusKm ?? DEFAULT_SERVICE_RADIUS_KM`
  so the field is never blank for an approved shop.
- Helper copy under the field: "Customers farther than this won't
  see your shop." Keep it short.
- Validate client-side (1–50 integer) for a friendly inline error
  before the callable round-trips; the server re-validates.
- **Hooks discipline (code-discipline Rule 2):** any new `useState`
  for the radius draft sits ABOVE the screen's conditional early
  returns, with the existing settings state.

### H. ShopCard distance — verify, don't rebuild

`ShopCard.tsx` line 53 already renders
`formatDistance(shop.distanceKm)`. Confirm:
- It shows when `distanceKm` is present (it will be — server stamps
  it).
- `formatDistance(undefined)` degrades gracefully (no "undefined
  km"). If it doesn't already, harden it. No new distance UI is in
  scope — the card already has the slot.

### I. Fix — tier edits don't persist across a reload (smoke-test bug)

**Symptom (Sudhir):** owner changes the 5 km charge 60→65, taps Save,
sees "Saved", leaves the screen, returns → the field shows **60**
again. Reproduces every time.

**Root cause.** 60 is not a coincidence — it's the `5 km` charge in
`DEFAULT_DELIVERY_CHARGE_TIERS`. `ShopSettingsScreen` falls back to
that default table whenever the shop it loads has no
`deliveryChargeTiers` field (lines 113-129). So on reload, the
`getMyShop` callable is returning a shop doc **without** the tiers the
save just wrote. Two independent defects make the write and the
reload-read resolve to different / mis-ordered docs:

1. **Mixed `updatedAt` type.** `updateShopDeliveryTiers`
   (`functions/src/index.ts` ~line 5344) writes
   `updatedAt: Date.now()` — a **number**. Every other shop write
   (e.g. `approveShop`, `updateShopSettings`) uses
   `FieldValue.serverTimestamp()` — a **Timestamp**. `getMyShop`
   (~line 3918) orders with `.orderBy('updatedAt', 'desc')`. Firestore
   orders mixed-type fields by **type first** (numbers sort before
   Timestamps), so a doc whose `updatedAt` just became a number sorts
   *below* any sibling doc still holding a Timestamp. If the owner has
   more than one shop doc matching
   `ownerUid == uid && status in ['pending','active','rejected']`,
   `getMyShop` returns the *wrong* (stale, tier-less) doc.

2. **Writer and reader key the shop differently.**
   `updateShopDeliveryTiers` is authoritative on `shops/{claims.shopId}`.
   `getMyShop` runs an `ownerUid` query instead. These can resolve to
   different docs.

**Fix (do all three):**

- **Normalize the timestamp.** In `updateShopDeliveryTiers`, change
  `updatedAt: Date.now()` → `updatedAt: FieldValue.serverTimestamp()`
  so the field type is consistent with every other shop write. (Check
  `updateShopSettings` too — if it also writes a numeric `updatedAt`,
  fix it the same way for consistency.)

- **Make `getMyShop` read the authoritative doc when a claim exists.**
  When `auth.token?.shopId` is a non-empty string, read
  `shops/{claims.shopId}` directly (`db.doc(...).get()`) — the *same*
  key the writer uses — and return it (with the existing
  `createdAt`/`updatedAt` `.toMillis()` normalization). Only when
  there is **no** `shopId` claim (a pending owner pre-approval, which
  `WaitingForApprovalScreen` relies on) fall back to the existing
  `ownerUid + status + orderBy(updatedAt) limit 1` query. This keeps
  pending-detection working while guaranteeing approved owners read
  exactly the doc their edits write to. Preserve the `null`-on-missing
  contract.

- **Diagnostic first (don't guess on live data).** Before changing
  `getMyShop`, add a temporary `logger.info` in `getMyShop` dumping,
  for the calling owner: how many shop docs match the query, each
  doc's `id`, `status`, `typeof updatedAt`, and whether
  `deliveryChargeTiers` is present. Sudhir runs the tier-save repro
  once; the log confirms whether it's the multi-doc/type-order path,
  the key-mismatch path, or both. **Strip the diagnostic log in the
  same PR once confirmed** (don't leave it in, per the PR 45.1
  diagnostic-probe cleanup lesson).

> Note: the in-session re-hydrate after save is already correct — the
> screen sets `loadedTiers`/`tierDrafts` from the callable's
> `result.tiers`. This fix is purely about the *reload* read path, so
> no `ShopSettingsScreen` change is needed for bug I beyond what
> section J removes.

### J. Remove the redundant flat "Delivery fee" input

Since PR 47, the **delivery-charge tier table** governs what the
customer actually pays (`chargeForDistance`). The flat
`Delivery fee (₹)` input in Shop Settings (lines 397-418) is now
confusing — an owner edits it expecting it to change delivery pricing,
but it doesn't (tiers win at checkout). Remove the **input control**.

Important — remove the UI, **keep the data field**:

- `shop.deliveryFee` **stays on the data model** and keeps its role as
  the legacy fallback (`chargeForDistance(..., fallbackFlat=deliveryFee)`
  for tier-less shops) and the `deliveryFee = deliveryCharge`
  back-compat shim placeOrder stamps. Do **not** delete the field,
  the type, the cart-store snapshot, or the server fallback logic.
- In `ShopSettingsScreen.tsx`: delete the "Delivery fee (₹)"
  `<View style={styles.field}>` block, the `deliveryFeeStr` state +
  its hydration (line 106), its branch in the `dirty`/`payload`
  `useMemo`, its branch in `validateClient`, its `errors.deliveryFee`
  entry, and the refetch line that re-sets it (line 337). The first
  settings card then holds **Minimum order** + (new, section G)
  **Service area** only.
- The flat-fee Save button (`handleSave`) still exists for minOrder +
  serviceRadiusKm — keep it; just drop deliveryFee from its payload.
- **Import-strip discipline (Rule 1):** removing `deliveryFeeStr`
  touches several mutually-referencing spots; do it as one deliberate
  edit and re-run `tsc` rather than letting the LSP cascade-remove.

> Why keep the field but hide the control: ripping `deliveryFee` out
> of the data model would be a non-additive schema change touching
> placeOrder, the cart store, and every legacy shop's fallback — out
> of scope and risky pre-pilot. Hiding the now-meaningless control is
> the right-sized fix.

## Tests

New: `tests/functions/geoVisibilityHelpers.test.ts` —
`filterShopsByServiceRadius`:

- within radius → kept; beyond radius → dropped.
- exactly at radius (distanceKm === serviceRadiusKm) → kept
  (INCLUSIVE boundary).
- `serviceRadiusKm` missing → falls back to
  `DEFAULT_SERVICE_RADIUS_KM` (shop at 4 km kept, at 6 km dropped).
- `serviceRadiusKm` zero / negative / NaN → treated as missing →
  default.
- `distanceKm` undefined / non-finite → kept (fail-open).
- `showAll: true` → every shop kept regardless of distance/radius
  (incl. shops that would otherwise be dropped).
- empty array → empty array.
- does NOT mutate input (returns a new array; `slice()` on the
  showAll path).
- pin `DEFAULT_SERVICE_RADIUS_KM === 5`.

Extend `tests/functions/shopSettingsHelpers.test.ts` —
`serviceRadiusKm`:

- valid radius (e.g. 3) → ok, in `updates`.
- non-integer (2.5) → reject.
- below 1 (0) → reject; above 50 (51) → reject.
- partial update with ONLY serviceRadiusKm (no deliveryFee/minOrder)
  → ok (satisfies the "at least one field" rule).
- none of the three fields present → reject with the updated message.

If there's an existing client-helper test dir, add a mirror test for
`src/utils/geoVisibilityHelpers.ts` (or assert the two copies are
byte-identical via a shared fixture, matching however PR 47 handled
the `deliveryChargeHelpers` dual copy).

For section I (tier-save bug), if `getMyShop` has a pure resolver
seam, add a unit test that "claim present → reads by claims.shopId"
and "no claim → falls back to the ownerUid query". If `getMyShop` is
not unit-testable without the emulator, the diagnostic-log +
on-device repro in the deploy/smoke plan is the verification instead —
don't bolt on an emulator harness just for this.

`npm test` must stay green (was 888/888 after PR 47). Report the new
count.

## Deploy plan (server-first — deploy-discipline)

1. **Set the testing override BEFORE deploying** so the offshore team
   doesn't lose shop visibility the instant the gate goes live:
   in Firestore, create `appConfig/shopVisibility` →
   `{ showAllShops: true }`. (Do this first; the new server code reads
   it on the very next call.)

2. Deploy the changed functions (now also `getMyShop` +
   `updateShopDeliveryTiers` for the section-I fix):
   ```
   firebase deploy --only functions:listShopsPublic,functions:updateShopSettings,functions:approveShop,functions:getMyShop,functions:updateShopDeliveryTiers
   ```

3. **Verify Cloud Run IAM** on the redeployed public callables (the
   gotcha that's bitten us repeatedly — redeploy can silently drop the
   `allUsers` binding):
   ```
   gcloud run services get-iam-policy listshopspublic --region=asia-south1
   gcloud run services get-iam-policy updateshopsettings --region=asia-south1
   gcloud run services get-iam-policy getmyshop --region=asia-south1
   gcloud run services get-iam-policy updateshopdeliverytiers --region=asia-south1
   ```
   If `allUsers` / `roles/run.invoker` is missing on any:
   ```
   gcloud run services add-iam-policy-binding <svc> --region=asia-south1 --member=allUsers --role=roles/run.invoker
   ```
   (`approveShop` is admin-auth, not public — it does NOT get
   `allUsers`; verifying it is harmless but expect no public binding.)

4. Ship the client:
   ```
   eas update --branch production --message "PR 48: shop service radius + distance visibility"
   ```
   This is OTA-safe — pure JS/TS, no native module or permission
   change.

5. **At real 1-shop pilot:** flip
   `appConfig/shopVisibility.showAllShops` to `false` (or delete the
   doc) so the radius gate becomes live for real customers. No
   redeploy.

## Smoke acceptance

1. **Testing override ON** (`showAllShops: true`) → a cross-city
   tester still sees all active shops (no regression for the testing
   team).
2. **Override OFF** (`false`/deleted), customer location near the
   pilot shop → shop appears, card shows "~X.X km".
3. **Override OFF**, simulate a far location (or temporarily set the
   shop's `serviceRadiusKm` to 1 and stand >1 km away) → shop
   disappears; "No shops near you" empty state renders.
4. **Shop owner → Shop Settings → Service area** → field pre-fills
   (5 for a default shop), edit to 3, Save → succeeds; re-open
   confirms persisted; audit-log entry written (if settings changes
   are audited).
5. **Legacy shop** with no `serviceRadiusKm` → still visible within
   5 km (default fallback), hidden beyond.
6. **GPS denied / no location** → list does NOT go empty (fail-open):
   shops still show (can't measure distance → don't hide).
7. **Newly approved shop** → has `serviceRadiusKm: 5` seeded on its
   doc.
8. **Tier-save persistence (section I)** → owner changes the 5 km
   charge 60→65, Save, **leave the screen and come back** → field
   shows **65** (the bug repro from Sudhir; must now stick). Re-open a
   second time to be sure. Also confirm the placed-order delivery
   charge for a ~4 km destination reflects 65.
9. **Delivery-fee control gone (section J)** → Shop Settings no longer
   shows a "Delivery fee (₹)" input; "Minimum order" + "Service area"
   remain; saving them still works. Confirm checkout pricing is
   unchanged (tiers still drive it).

## Out of scope (do not pull in)

- Partner routing / sorting / location reporting → PR 49.
- Partner notification radius → PR 50.
- Per-customer "deliver here" radius preview on the shop card — the
  card shows distance; the gate is enough for PR 48.
- Moving the web Plan B path onto callables — orthogonal; web stays
  Web-SDK + shared helper.
- Reverse-geocoding the customer location to a label — PR 46
  deferred this; still deferred.
```
