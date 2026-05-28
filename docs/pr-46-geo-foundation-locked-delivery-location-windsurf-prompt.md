# PR 46 — Geo foundation: locked delivery location + Distance Matrix (Windsurf prompt)

> Keystone PR of the geo/distance system (see
> `docs/GEO_DISTANCE_SYSTEM_DESIGN.md`). PRs 47–50 (charges,
> service radius, partner routing, notification radius) all depend
> on what this PR establishes: a **locked delivery location** on
> every order + a **server-side Distance Matrix** estimate.

## ⚠️ Cost decision — Distance Matrix is BUILT BUT DORMANT

**Sudhir's call (May 27 2026): do NOT call the paid Distance
Matrix API during pilot.** Not even against the free credit. The
code defaults to **free haversine + India proration**; Distance
Matrix is built but gated behind a Firestore flag
(`aiFeatures/distanceMatrix.enabled`, default `false`) for a
zero-code-change upgrade later. See
`docs/GEO_DISTANCE_SYSTEM_DESIGN.md` → "FUTURE TO-DO".

**Prerequisite status (already done by Sudhir):**
- ✅ Distance Matrix API + Geocoding API enabled on
  `grocery-mvp-dev`.
- ✅ API key created + restricted.
- `GOOGLE_MAPS_API_KEY` Functions secret — set it if not already:
  `firebase functions:secrets:set GOOGLE_MAPS_API_KEY`. The
  callable declares the secret so it's available when the flag
  eventually flips, but **the code path that reads it only runs
  when `distanceMatrix.enabled === true`** — which is `false` for
  pilot, so no Google call ever fires.

**India proration constants (the pilot default path):**
- Distance: `haversineKm × 1.4`
- Duration: `distanceKm / 15 (km/h) × 60` minutes

## Scope resolved (May 27 2026) — two prerequisite gaps Windsurf found

Windsurf correctly flagged that (a) `SavedAddress` has no
`lat`/`lng` today, and (b) the prompt wanted to couple ETA into
PR 43's `orderEtaDisplay`. Resolutions:

1. **SavedAddress gets OPTIONAL `lat`/`lng`** (schema). AND
   **AddressEditScreen gets a "📍 Use my current location"
   button** (`expo-location` `getCurrentPositionAsync` — already
   installed, so OTA-safe; NO map pin, NO `react-native-maps`).
   This stamps coords onto a saved address at creation time. The
   common case (customer saves "Home" while at home) gets correct
   coords.
2. **CheckoutScreen delivery-point resolution:**
   - Saved address WITH coords → use them as the locked delivery
     point (correct).
   - Saved address WITHOUT coords (legacy, pre-PR-46) → fall back
     to current GPS, with a small visible note ("Using your
     current location for this address — re-save it to set its
     pin"). Acceptable degradation; rare on fresh pilot data.
   - "Deliver to current location" option → always live GPS.
3. **ETA coupling DEFERRED to PR 51+.** PR 46 stores
   `deliveryDurationMin` on the order but does NOT wire it into
   `orderEtaDisplay` yet. Keep PR 46 focused on capture.
4. **Draggable map pin = SEPARATE FUTURE PR.** Adding
   `react-native-maps` is a new native dependency → forces a
   native rebuild (not OTA). Out of scope for PR 46. The GPS
   button (item 1) covers the pilot need without it.

Why not "fall back to GPS for ALL saved addresses" (the simpler
option): that bills the wrong distance when a customer orders to
their Home address while physically elsewhere. The GPS-capture
button makes new addresses accurate so the fallback only hits
legacy/un-pinned ones.

## Why this PR exists

Today an order carries a saved `deliveryAddress` and a flat
`shop.deliveryFee`. The geo system needs two new things that
everything else builds on:

1. **A locked delivery location** — the customer chooses either a
   saved address OR their current location at checkout; the chosen
   point (lat/lng + type + display label) is snapshotted onto the
   order and never changes afterward.
2. **A real road-distance + duration estimate** — computed once at
   checkout from shop → delivery location via Google Distance
   Matrix, with a haversine × 1.4 fallback so checkout never
   hard-blocks if Google errors.

This PR also delivers the accurate-ETA goal (goal #4 from the
design) for free, since Distance Matrix returns duration
alongside distance.

## Read first

- `docs/GEO_DISTANCE_SYSTEM_DESIGN.md` — the full system design.
  This PR is the "PR 46" section + the data-model `Order`
  additions.
- `.windsurf/code-discipline.md` — all rules. Rule 10 (Firestore
  reads-before-writes) is relevant if placeOrder's transaction is
  touched.
- `.windsurf/deploy-discipline.md` — Cloud Run IAM verification
  step for the new callable; the secret-handling note.
- `functions/src/index.ts` ~line 500 — `placeOrder` callable,
  where `deliveryFee` and `total` are currently computed and the
  order doc is written (~line 547, 579). This is where
  `deliveryLocation` + the estimate get stamped.
- `src/types/index.ts` — `Order` type. Add the new fields.
- `src/screens/CheckoutScreen.tsx` — the address selection +
  place-order UI. The "deliver to current location" option lands
  here.
- `src/screens/AddressEditScreen.tsx` — existing address capture
  (has map pin + current-location helper per earlier work) — reuse
  its current-location pattern.
- `src/store/useLocationStore.ts` — `location` (GPS/fallback) +
  `source`. Source of the customer's current coordinates.
- `src/utils/distance.ts` — `haversineKm`. Used for the fallback.

## Scope of changes

### A. `Order` type — locked delivery location + estimate

`src/types/index.ts`:

```ts
export type DeliveryLocation = {
  lat: number;
  lng: number;
  type: 'saved_address' | 'current_location';
  addressId?: string;   // present when type === 'saved_address'
  label: string;        // display snapshot, LOCKED at order time
};

// On Order:
deliveryLocation?: DeliveryLocation;   // optional for back-compat with
                                       // pre-PR-46 orders that only have
                                       // deliveryAddress
deliveryDistanceKm?: number;   // shop → delivery location, road distance
deliveryDurationMin?: number;  // estimated ride time
// deliveryFee stays for back-compat reads; deliveryCharge (PR 47)
// will supersede it. PR 46 keeps deliveryFee working unchanged —
// it does NOT yet switch the charge to distance-based (that's PR 47).
```

PR 46 does NOT change how the delivery charge is computed (still
flat `shop.deliveryFee`). It only captures the location + distance
+ duration. PR 47 flips the charge to tier-based. Keeping them
separate keeps each PR small and independently testable.

### B. New pure helper — `functions/src/distanceMatrixHelpers.ts`

Pure parsing + fallback logic, testable without hitting Google.

```ts
/**
 * PR 46 — pure helpers for the Distance Matrix estimate.
 * The callable does the fetch; these parse the response and
 * provide the haversine fallback so checkout never hard-blocks
 * on Google.
 */

export const ROAD_FACTOR = 1.4; // straight-line → road inflation (India)
export const FALLBACK_SPEED_KMH = 15; // urban two-wheeler avg (India traffic)

export type DistanceEstimate = {
  distanceKm: number;
  durationMin: number;
  source: 'distance_matrix' | 'haversine_fallback';
};

/** Parse a Distance Matrix API JSON response into an estimate. */
export function parseDistanceMatrixResponse(
  json: unknown,
): DistanceEstimate | null {
  // Navigate json.rows[0].elements[0]; require status === 'OK';
  // distance.value (meters) → km; duration.value (seconds) → min.
  // Return null on any non-OK / malformed shape so the caller
  // falls back to haversine.
}

/** Haversine × ROAD_FACTOR + speed-based duration fallback. */
export function haversineFallbackEstimate(
  shop: { lat: number; lng: number },
  dest: { lat: number; lng: number },
): DistanceEstimate {
  // distanceKm = haversineKm(shop, dest) * ROAD_FACTOR
  // durationMin = (distanceKm / FALLBACK_SPEED_KMH) * 60
  // source: 'haversine_fallback'
}
```

(Import `haversineKm` logic — duplicate the formula in the
functions package or share it; functions/ can't import from src/.
There's already a haversine in index.ts ~line 4844 from
`rankShopsByDistance` — reuse/extract that.)

### C. New callable — `getDeliveryEstimate`

`functions/src/index.ts`:

```ts
export const getDeliveryEstimate = onCall<{
  shopId: string;
  dest: { lat: number; lng: number };
}>(
  { cors: true, enforceAppCheck: false, secrets: ['GOOGLE_MAPS_API_KEY'] },
  async request => {
    // 1. auth required (any signed-in user)
    // 2. load shop, get shop.location
    // 3. Read the kill-switch: aiFeatures/distanceMatrix.enabled
    //    (default false). For pilot this is FALSE.
    // 4a. If flag is FALSE (pilot default):
    //     → haversineFallbackEstimate(shop, dest). NO Google call.
    //       source: 'haversine_fallback'. This is the ONLY path
    //       that runs during pilot — zero API cost.
    // 4b. If flag is TRUE (future, at scale):
    //     → try Distance Matrix:
    //        GET https://maps.googleapis.com/maps/api/distancematrix/json
    //          ?origins=<shopLat>,<shopLng>
    //          &destinations=<destLat>,<destLng>
    //          &mode=driving&key=<GOOGLE_MAPS_API_KEY>
    //        parseDistanceMatrixResponse(json)
    //     → on null / fetch error → haversineFallbackEstimate
    // 5. return { distanceKm, durationMin, source }
  },
);
```

**The flag gate is the whole point of the cost decision.** With
`aiFeatures/distanceMatrix.enabled === false` (pilot default),
the callable NEVER touches Google — it's pure haversine ×1.4 +
15km/h duration. The Distance Matrix branch is built + tested but
unreachable until someone flips the Firestore flag at scale.
Mirror the existing kill-switch pattern from `aiFeatures/
menuExtraction.enabled` (PR 32) — same read, same default-off
posture.

Key: even when the flag is ON, **never throw on Google failure** —
fall back to haversine and return a valid estimate. The customer's
checkout always completes.

Add a test asserting that with the flag false, `fetch` is NEVER
called (no Google request fires) — that's the cost guarantee, and
it must be pinned so a future edit can't accidentally start
billing.

### D. Checkout — "deliver to current location" + lock the choice

`src/screens/CheckoutScreen.tsx`:

- The address section currently lists saved addresses. Add a
  distinct option at the top: **"📍 Deliver to my current
  location"**.
- Selecting it: read `useLocationStore.location`. If permission
  not yet granted / location null, prompt for it (reuse the
  AddressEditScreen current-location flow). Optionally reverse-
  geocode to a friendly label ("Near Sector 12, Ballabgarh") via
  Geocoding API, or just label it "Current location".
- Whichever the customer picks (saved address OR current
  location), build the `DeliveryLocation`:
  - saved → `{ lat, lng, type: 'saved_address', addressId, label: address.nickname }`
  - current → `{ lat, lng, type: 'current_location', label: '<geocoded or "Current location">' }`
- Before enabling "Place Order", call `getDeliveryEstimate({
  shopId, dest: deliveryLocation })` → show the customer the
  estimated delivery time + (PR 47 will add the charge here).
  For PR 46, show: "Estimated delivery: ~28 min" using
  `deliveryDurationMin`.
- Pass `deliveryLocation` + `deliveryDistanceKm` +
  `deliveryDurationMin` into the placeOrder call so they lock onto
  the order.

### E. placeOrder — stamp the locked fields

`functions/src/index.ts` placeOrder (~line 500–580):

- Accept `deliveryLocation`, `deliveryDistanceKm`,
  `deliveryDurationMin` in the input.
- Validate `deliveryLocation` shape (lat/lng numbers, valid type).
- Stamp them onto the order doc alongside the existing fields.
- **Re-derive the estimate server-side** (don't trust the client's
  distance/duration — recompute via getDeliveryEstimate logic so a
  tampered client can't fake a short distance to dodge charges in
  PR 47). The client's values are display-only; the server's are
  authoritative on the order.
- `deliveryFee` / `total` computation unchanged in PR 46.

### F. Surface accurate ETA (goal #4)

- OrderConfirmationScreen + OrderDetailScreen: when
  `order.deliveryDurationMin` is present and the order is past
  acceptance, the ETA can incorporate it. Coordinate with PR 43's
  `orderEtaDisplay` helper — extend it to use
  `deliveryDurationMin` for the post-acceptance estimate instead
  of (or alongside) the shop's `readyByEstimate`. Keep PR 43's
  "awaiting shop confirmation" behavior for the pending state.
  (If this coupling gets complex, PR 46 can just store the field
  and PR 51/later wires the display — flag it and keep PR 46
  focused on capture.)

## Tests

1. `tests/functions/distanceMatrixHelpers.test.ts`:
   - `parseDistanceMatrixResponse` happy path (OK status, valid
     distance/duration)
   - non-OK element status → null
   - malformed/missing rows → null
   - `haversineFallbackEstimate` → correct km × 1.4 + duration
     from 15 km/h
2. `tests/functions/getDeliveryEstimate.test.ts`:
   - mocked fetch returns valid Distance Matrix → returns parsed
     estimate, source 'distance_matrix'
   - mocked fetch throws → haversine fallback, source
     'haversine_fallback'
   - mocked fetch returns non-OK → haversine fallback
   - unauthenticated caller → throws
3. `tests/screens/CheckoutScreen.test.tsx` (if exists) — current-
   location option builds the right DeliveryLocation shape.

## Discipline checklist

- [ ] `GOOGLE_MAPS_API_KEY` only via Functions secret; never in
      client bundle, never logged, never in app.json.
- [ ] getDeliveryEstimate NEVER throws on Google failure —
      haversine fallback always returns a valid estimate.
- [ ] Server re-derives distance authoritatively in placeOrder
      (client values are display-only).
- [ ] `deliveryLocation` + estimate fields are OPTIONAL on Order
      (pre-PR-46 orders without them still render).
- [ ] Hooks above conditional returns in CheckoutScreen.
- [ ] Cloud Run IAM verification for `getDeliveryEstimate` post-
      deploy (allUsers binding).

## Deploy plan

1. **Prerequisite:** Distance Matrix API enabled +
   `GOOGLE_MAPS_API_KEY` secret set (see top).
2. `npm run test:unit` — green.
3. `firebase deploy --only functions:getDeliveryEstimate,functions:placeOrder`.
4. **Cloud Run IAM verify:**
   `gcloud run services get-iam-policy getdeliveryestimate --region=asia-south1 --project=grocery-mvp-dev`
   → confirm allUsers/run.invoker; add if missing. Same for
   placeorder if it lost its binding.
5. `eas update --branch production --message "PR 46 geo foundation: locked delivery location + Distance Matrix"`.
6. Force-quit + reopen twice.

## Smoke acceptance

1. **Saved-address order:** checkout → pick a saved address →
   "Estimated delivery ~N min" shows → place order → order doc
   has `deliveryLocation { type: 'saved_address', ... }` +
   `deliveryDistanceKm` + `deliveryDurationMin`.
2. **Current-location order:** checkout → tap "Deliver to my
   current location" → grant location if prompted → estimate
   shows → place order → order doc has
   `deliveryLocation { type: 'current_location', ... }` with the
   GPS coords locked.
3. **Distance Matrix working:** check the order's
   `deliveryDistanceKm` is a realistic road distance (slightly
   more than straight-line). Function logs show source
   'distance_matrix'.
4. **Fallback path:** (hard to trigger manually) — if Google
   errors, the estimate still appears and the order still places;
   source 'haversine_fallback' in logs.
5. **Locked:** after placing, the order's delivery location
   doesn't change even if the customer edits their saved address.

## Out of scope (later PRs)

- Distance-based **charge** (PR 47) — PR 46 keeps flat
  deliveryFee.
- Shop service radius (PR 48).
- Partner routing / sorting / total ride (PR 49).
- Partner notification radius (PR 50).
- Live traffic in the duration estimate (post-pilot).

## Definition of done

- `deliveryLocation` + estimate fields on Order, locked at
  checkout, server-authoritative.
- "Deliver to current location" option in checkout.
- `getDeliveryEstimate` callable live, Distance-Matrix-backed with
  haversine fallback, never throws on Google failure.
- `GOOGLE_MAPS_API_KEY` secret set; Distance Matrix API enabled.
- Accurate ETA surfaced (or stored for a follow-up if the PR 43
  coupling is deferred — flag which).
- Tests green (helper + callable + checkout).
- Cloud Run IAM verified for getDeliveryEstimate.
- Doc trail updated; design doc's PR 46 section marked shipped.
