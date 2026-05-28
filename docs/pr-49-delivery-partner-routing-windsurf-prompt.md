# PR 49 — Delivery partner routing + location reporting (Windsurf prompt)

> Fourth PR of the geo/distance system (see
> `docs/GEO_DISTANCE_SYSTEM_DESIGN.md` → "PR 49" section). The
> customer + shop sides are geo-aware (PR 46–48); this PR makes the
> **delivery partner** side distance-aware: report the partner's
> location, sort available pickups nearest-first, show each pickup's
> total ride distance, and surface the locked delivery-location type.
>
> **Also bundles a one-line-class server fix** for a PR 48 regression:
> editing only the shop **Service area** fails with "At least one of
> deliveryFee, minOrder, or serviceRadiusKm is required." See
> section F. Folding it in per Sudhir's "avoid a separate migration"
> call.

## Why this PR exists

A delivery partner opening the dashboard today sees available pickups
in arbitrary (server) order, with no sense of how far each ride is.
For a two-wheeler partner deciding which pickup to claim, the two
numbers that matter are: how far is the **shop** (the pickup), and
how far is the **drop** from the shop. PR 46 already stamps the
shop→customer leg (`order.deliveryDistanceKm`) on every order. PR 49
adds the partner→shop leg and wires both into the dashboard, sorted
nearest-first.

It also lays the groundwork for PR 50 (notification radius): the
`reportDeliveryLocation` callable this PR adds writes
`users/{uid}.currentLocation`, which PR 50's order-ready push trigger
will read to filter pushes to nearby partners only.

## What this PR is NOT

- **No background location.** Partner location is captured only when
  the dashboard is open/focused (foreground). Design decision #5 —
  pilot doesn't need live tracking; background location adds battery
  drain and a scarier permission prompt. Do not add
  `expo-location` background mode or a `TaskManager` task.
- **No live partner→customer tracking / map.** Distances are
  numbers, not a moving map. Out of scope.
- **No Distance Matrix calls.** Partner-side distances are haversine
  (cheap, client-side). The Distance Matrix flag stays dormant
  (cost decision from PR 46). The partner→shop leg is straight-line
  haversine; the shop→customer leg reuses the already-stored
  `deliveryDistanceKm`.

## Read first

- `docs/GEO_DISTANCE_SYSTEM_DESIGN.md` — "PR 49" + design decisions
  #1 (locked at order time) and #5 (no background location).
- `src/screens/delivery/DeliveryDashboardScreen.tsx` — the screen.
  `available` (split into `headsUp` + `availableNow`), the
  `AvailablePickupCard` / `HeadsUpCard` / `ActiveDeliveryCard`
  components, and the `useFocusEffect` that bumps `retryNonce` on
  focus (the natural hook point for location capture).
- `src/services/orderService.ts` — `watchAvailableDeliveries`,
  `watchMyDeliveries`, `setDeliveryStatus` (the online/offline
  toggle — mirror its client shape for `reportDeliveryLocation`).
- `functions/src/index.ts`:
  - ~line 3326 — `setDeliveryStatus` callable +
    `requireDeliveryRole(request)` (mirror this for
    `reportDeliveryLocation`).
  - ~line 3350 — `sendNewPickupPushToDelivery` trigger (PR 50 will
    extend it; just confirm it reads `users` online partners — no
    change here).
  - ~line 728-793 — `placeOrder`'s order-doc object, specifically the
    PR 46 `deliveryLocation` stamping block (~765-773). `shopLocation`
    stamps right alongside it; `shop.location` is already in scope
    (the `shop` doc read at ~line 444).
  - ~line 6008-6024 — the profile-projection strip list (fields
    `getMyProfile` etc. must NOT return). `currentLocation` +
    `currentLocationUpdatedAt` get added here.
  - ~line 5306-5337 — `updateShopSettings` callable wrapper (the
    section-F bug).
- `src/types/index.ts` — `Order` (~line 412, add `shopLocation`),
  `DeliveryLocation` (~323, the `type`/`label` already there),
  `GeoPoint`.
- `src/utils/distance.ts` — `haversineKm(GeoPoint, GeoPoint)`. Reuse
  it; don't write a second haversine on the client.
- `.windsurf/deploy-discipline.md` — Cloud Run IAM verify for the new
  + modified callables.
- `.windsurf/code-discipline.md` — Rule 1 (import-strip; this screen
  has a documented history of the auto-formatter stripping its
  imports — see the comment blocks at the top of
  DeliveryDashboardScreen) and Rule 2 (hooks above early returns —
  the new location `useState` must sit with the others).

## Scope of changes

### A. `Order.shopLocation` — the pickup coordinate

`src/types/index.ts`, on `Order` (near the PR 46 geo fields, ~444):

```ts
// PR 49 — shop pickup coordinate, snapshotted at order time so the
// delivery partner can compute the partner→shop leg + sort pickups
// nearest-first without a shop-doc read per order. Optional /
// back-compat: omitted when the shop had no `location` (legacy
// seeded shops) or on pre-PR-49 orders. Locked at order time like
// the other geo fields (design decision #1).
shopLocation?: GeoPoint;
```

`functions/src/index.ts`, in the `placeOrder` order object, alongside
the PR 46 block (~765-773):

```ts
...(shop.location?.lat != null && shop.location?.lng != null
  ? { shopLocation: { lat: shop.location.lat, lng: shop.location.lng } }
  : {}),
```

`shop` is the already-read shop doc. No extra Firestore read.
`watchAvailableDeliveries` returns the full order doc, so
`shopLocation` flows to the client automatically — no callable change
for delivery reads.

### B. `reportDeliveryLocation` callable (for PR 50)

`functions/src/index.ts`, near `setDeliveryStatus` (~3326). Mirror its
auth + write pattern exactly:

```ts
export const reportDeliveryLocation = onCall<{ lat: number; lng: number }>(
  { cors: true, enforceAppCheck: false },
  async request => {
    const { uid } = requireDeliveryRole(request);
    const { lat, lng } = request.data ?? {};
    if (
      typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90 ||
      typeof lng !== 'number' || !Number.isFinite(lng) || lng < -180 || lng > 180
    ) {
      throw new HttpsError('invalid-argument', 'lat/lng out of range');
    }
    await db.doc(`users/${uid}`).set(
      {
        isDelivery: true,
        currentLocation: { lat, lng },
        currentLocationUpdatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return { ok: true };
  },
);
```

This write is **for PR 50** (the push-radius filter). PR 49's own
sort uses the *live* client GPS directly (section D) — it does not
round-trip through this callable. We still write it now so PR 50 has
fresh data the moment it ships.

**Profile-projection guard:** add `currentLocation` +
`currentLocationUpdatedAt` to the strip-list at ~line 6008-6024 so
`getMyProfile` (and the other four profile readers) never leak the
internal location field. Same posture as `deliveryStatus`.

### C. Client — `orderService.reportDeliveryLocation`

`src/services/orderService.ts`, mirroring `setDeliveryStatus`'s
native/web branch shape:

```ts
async reportDeliveryLocation(input: { lat: number; lng: number }): Promise<void> {
  if (isNative) {
    const fn = getNativeFunctions().httpsCallable('reportDeliveryLocation');
    await fn(input);
    return;
  }
  const fn = httpsCallable(functions, 'reportDeliveryLocation');
  await fn(input);
},
```

### D. Pure helper — `src/utils/deliveryRoutingHelpers.ts` (new, client-only)

Sort + ride-distance logic lives in a pure, unit-testable module
(the routing math is client-only — the server doesn't sort pickups).

```ts
import { haversineKm } from './distance';
import type { GeoPoint, Order } from '../types';

export type RideLegs = {
  toShopKm: number | null;   // partner → shop (null if either coord missing)
  toCustomerKm: number | null; // shop → customer (order.deliveryDistanceKm)
  totalKm: number | null;    // sum when both legs known, else null
};

/** Compute the two ride legs for one pickup. Pure. */
export function rideLegsForOrder(
  order: Pick<Order, 'shopLocation' | 'deliveryDistanceKm'>,
  partner: GeoPoint | null,
): RideLegs {
  const toShopKm =
    partner && order.shopLocation
      ? haversineKm(partner, order.shopLocation)
      : null;
  const toCustomerKm =
    typeof order.deliveryDistanceKm === 'number'
      ? order.deliveryDistanceKm
      : null;
  const totalKm =
    toShopKm != null && toCustomerKm != null ? toShopKm + toCustomerKm : null;
  return { toShopKm, toCustomerKm, totalKm };
}

/**
 * Stable nearest-shop-first sort. Orders whose partner→shop distance
 * is unknown (no partner GPS yet, or no shopLocation on a legacy
 * order) sort to the BOTTOM, preserving their original relative
 * order (stable). Does NOT mutate the input.
 */
export function sortPickupsByProximity<
  T extends Pick<Order, 'shopLocation'>,
>(orders: T[], partner: GeoPoint | null): T[] {
  return orders
    .map((o, i) => ({
      o,
      i,
      d:
        partner && o.shopLocation
          ? haversineKm(partner, o.shopLocation)
          : Number.POSITIVE_INFINITY,
    }))
    .sort((a, b) => (a.d - b.d) || (a.i - b.i))
    .map(x => x.o);
}
```

### E. Dashboard wiring — `DeliveryDashboardScreen.tsx`

1. **Capture location on focus.** Add `partnerLoc` state
   (`const [partnerLoc, setPartnerLoc] = useState<GeoPoint | null>(null);`)
   **above** the existing early returns (Rule 2 — sit it with the
   other `useState`s near the top). In the existing `useFocusEffect`
   (the one that bumps `retryNonce`), also request foreground
   location and report it:

   ```ts
   useFocusEffect(
     useCallback(() => {
       setRetryNonce(n => n + 1);
       // PR 49 — foreground-only location capture. Best-effort:
       // permission denial or a GPS timeout must NOT break the
       // dashboard (sort just falls back to time order).
       let cancelled = false;
       (async () => {
         try {
           const { status } = await Location.requestForegroundPermissionsAsync();
           if (status !== 'granted' || cancelled) return;
           const pos = await Location.getCurrentPositionAsync({
             accuracy: Location.Accuracy.Balanced,
           });
           if (cancelled) return;
           const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
           setPartnerLoc(loc);
           void orderService.reportDeliveryLocation(loc).catch(() => {});
         } catch {
           // swallow — location is an enhancement, not a requirement
         }
       })();
       return () => { cancelled = true; };
     }, []),
   );
   ```

   Import `* as Location from 'expo-location'` (already a dependency,
   `~19.0.8` — no native rebuild). Match however PR 46's
   AddressEditScreen / CheckoutScreen import + call expo-location so
   the permission UX is consistent.

2. **Sort the lists.** Apply `sortPickupsByProximity(..., partnerLoc)`
   to both `availableNow` and `headsUp` in their `useMemo`s (add
   `partnerLoc` to the dep arrays). Nearest shop first; unknown-
   distance pickups fall to the bottom (stable).

3. **Show ride distance on the cards.** In `AvailablePickupCard` and
   `HeadsUpCard`, compute `rideLegsForOrder(order, partnerLoc)` and
   render a line when `totalKm != null`, e.g.:
   `🛵 ~{totalKm.toFixed(1)} km ride · {toShopKm.toFixed(1)} to shop + {toCustomerKm.toFixed(1)} to drop`.
   When `toShopKm` is null (no GPS yet) but `toCustomerKm` is known,
   show just the drop leg: `Drop ~{toCustomerKm.toFixed(1)} km from shop`.
   When both null, render nothing (legacy order, no regression).
   Pass `partnerLoc` into the card components as a prop.

4. **Show the locked delivery-location type.** On the cards (and in
   `ActiveDeliveryCard`), surface `order.deliveryLocation?.label`
   when present, e.g. a small line `📍 {label}` ("Home" /
   "Current location"). Falls back to nothing when absent (pre-PR-46
   orders). This tells the partner whether they're delivering to a
   saved address or a live pin.

### F. Bundled fix — Service-area save (PR 48 regression)

**Symptom:** editing only the Service area in Shop Settings →
"Could not save: At least one of deliveryFee, minOrder, or
serviceRadiusKm is required."

**Root cause:** PR 48 taught the *pure helper*
(`validateShopSettings`) about `serviceRadiusKm`, but the
`updateShopSettings` **callable wrapper** in `functions/src/index.ts`
(~line 5306-5337) was never updated — its `onCall<{…}>` request type
omits `serviceRadiusKm`, and it forwards only `shopId`, `deliveryFee`,
`minOrder` into the validator. So a `{serviceRadiusKm: N}`-only
payload arrives at the validator as all-undefined → the "at least
one field" guard fires. The client and the validator are both already
correct; only the wrapper drops the field.

**Fix (two edits in the wrapper):**

1. Add `serviceRadiusKm?: number;` to the `onCall<{…}>` generic
   (after `minOrder?: number;`).
2. Add `serviceRadiusKm: request.data?.serviceRadiusKm,` to the
   `validateShopSettings({...})` input object (after the `minOrder`
   line).

Optional polish (do it — keeps the audit log honest): the wrapper's
`before` audit snapshot (~5350-5357) reads only
`deliveryFee`/`minOrder`; add `serviceRadiusKm` to the `beforeData`
type + `before` object so a radius change shows a clean diff.

No client change needed (the client already sends `serviceRadiusKm`,
verified in `orderService.updateShopSettings`).

## Tests

New: `tests/{functions or unit}/deliveryRoutingHelpers.test.ts` —
match wherever the client-helper tests live (e.g. the
`deliveryChargeHelpers`/`geoVisibilityHelpers` client-mirror tests):

- `rideLegsForOrder`:
  - both coords present → `toShopKm` ≈ expected haversine,
    `toCustomerKm` = `deliveryDistanceKm`, `totalKm` = sum.
  - `partner` null → `toShopKm` null, `totalKm` null,
    `toCustomerKm` still returned.
  - `shopLocation` missing → `toShopKm` null, `totalKm` null.
  - `deliveryDistanceKm` missing → `toCustomerKm` null, `totalKm`
    null even if `toShopKm` known.
- `sortPickupsByProximity`:
  - nearer shop sorts before farther.
  - orders without `shopLocation` sort to the bottom.
  - `partner` null → original order preserved (all infinite → stable).
  - stable for equal distances (original index breaks ties).
  - does NOT mutate the input array.

Extend `tests/functions/shopSettingsHelpers.test.ts` only if a gap
exists — the validator itself already handles `serviceRadiusKm`
(PR 48); section F is a wrapper bug, so if there's no
callable-wrapper unit seam, the on-device smoke step (below) is the
verification. Don't build an emulator harness just for the wrapper.

`npm test` must stay green (was 916/916 after PR 48). Report the new
count.

## Deploy plan (server-first — deploy-discipline)

1. Deploy the changed/new functions:
   ```
   firebase deploy --only functions:placeOrder,functions:reportDeliveryLocation,functions:updateShopSettings,functions:getMyProfile
   ```
   (`placeOrder` → `shopLocation` stamp; `reportDeliveryLocation` →
   new; `updateShopSettings` → section-F fix; `getMyProfile` → the
   strip-list addition. If the strip list is shared by multiple
   profile callables, deploy all readers that import it — list them
   explicitly so none is left returning the field.)

2. **Verify Cloud Run IAM** on the new + redeployed **public**
   callables (the recurring gotcha):
   ```
   gcloud run services get-iam-policy reportdeliverylocation --region=asia-south1
   gcloud run services get-iam-policy updateshopsettings --region=asia-south1
   gcloud run services get-iam-policy getmyprofile --region=asia-south1
   ```
   `placeOrder` is auth-gated but public-invoke like the others —
   verify it too. Add `allUsers` / `roles/run.invoker` to any missing:
   ```
   gcloud run services add-iam-policy-binding <svc> --region=asia-south1 --member=allUsers --role=roles/run.invoker
   ```

3. Ship the client:
   ```
   eas update --branch production --message "PR 49 partner routing + service-area save fix"
   ```
   OTA-safe — `expo-location` already shipped (PR 46), no new native
   module or permission, no `app.json` change.

## Smoke acceptance

1. **Service-area save (section F)** → Shop Settings, change only
   Service area 5→20, Save → succeeds, persists across reload (no
   "at least one required" error). This is the bug repro.
2. **Partner location prompt** → delivery partner opens the
   dashboard for the first time → foreground location permission
   prompt appears once; granting it doesn't block the screen, and
   denying it leaves the dashboard fully usable (pickups just aren't
   distance-sorted).
3. **Nearest-first sort** → with two available pickups at different
   shops, the nearer shop's pickup sorts to the top of "Available
   now."
4. **Ride distance on card** → an available pickup shows
   `🛵 ~X.X km ride · A to shop + B to drop`, where B matches the
   order's stored `deliveryDistanceKm` and A is plausible for the
   partner's current spot.
5. **Locked location label** → a pickup placed against "Current
   location" shows `📍 Current location`; one against a saved address
   shows `📍 Home` (or the saved label).
6. **Legacy order** (no `shopLocation` / no `deliveryDistanceKm`) →
   renders with no ride line and sorts to the bottom; no crash.
7. **`currentLocation` written** → after opening the dashboard with
   permission granted, the partner's `users/{uid}` doc has
   `currentLocation` + `currentLocationUpdatedAt` (sets up PR 50).
   Confirm `getMyProfile` does NOT return these fields.

## Out of scope (do not pull in)

- Notification-radius push filtering → PR 50 (consumes the
  `currentLocation` this PR writes).
- Background / live location tracking, partner map view.
- Any Distance Matrix call (flag stays dormant).
- Reverse-geocoding the partner or customer location to a label.
