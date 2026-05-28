# Geo / Distance System — Design Doc

> Designed May 27 2026 from the testing-team enhancement request.
> Decisions locked by Sudhir: **hybrid distance** (haversine for
> filtering + tiers, Google Distance Matrix for per-order
> time/ride), **per-shop custom charge tiers** (+ admin default),
> **build the whole system before pilot**.
>
> This doc is the architecture. The per-PR Windsurf prompts
> (PR 46–50) are written separately, after this design is
> approved.

## The problem (from the testing team + Sudhir)

Today delivery is a flat per-shop constant (`shop.deliveryFee`),
ETA is a shop-entered constant, every shop shows to every
customer (pilot's `SHOW_ALL_SHOPS = true`), and delivery partners
see an unsorted list of pickups with no distance info. The
request, restated as goals:

1. **Delivery charge scales with distance** — shop-configurable
   tiers (≤1km = X, 1–3km = Y, 3–5km = Z, else A).
2. **Customer can deliver to current location** — not just saved
   addresses. The chosen point is locked on the order.
3. **Delivery partner sees distance** — orders sorted nearest-
   first; total ride = (partner → shop) + (shop → customer);
   so they can make smart pickup decisions.
4. **Accurate delivery time** — computed from real distance, not
   a shop constant.
5. **Shop service radius** — a Faridabad shop shouldn't show to a
   Delhi customer. Shop sets a serve-radius; customers see actual
   distance.
6. **Delivery partner notification radius** — a partner sets
   "notify me only within 2km of my location"; no point spamming
   every partner for every shop.

Goal in one line: **full visibility + control over the area
shops and partners serve, and honest timing/distance/charges for
the customer.**

## Architecture — one geo foundation, many reads

Everything above is a different read off **three points**:

```
   [Delivery partner location]
            │  (partner → shop)
            ▼
   [Shop location] ──(shop → customer)──▶ [Customer delivery location]
```

- **Shop location** — already on `shop.location` (lat/lng).
- **Customer delivery location** — TODAY only a saved
  `deliveryAddress`. We add "current location" as an option and
  **lock** the chosen point (lat/lng + type) onto the order. This
  is the keystone — charges, partner routing, and ETA all read
  from this locked point.
- **Delivery partner location** — from the device GPS, reported
  to the server on app foreground / dashboard open (so the
  notify trigger + sorting can use it).

Once those three points are reliably captured, every feature is a
distance computation between two of them.

## ⚠️ Cost decision (updated May 27 2026)

Sudhir's call: **do NOT call the paid Distance Matrix API during
pilot** — not even against the $200/month free credit. Reasons:
maximally cost-conservative, and a 1-shop pilot in one
neighborhood doesn't need road-accurate distance. The APIs are
*enabled* and the key is *set* (ready for later), but the code
defaults to **free haversine + India proration**.

Distance Matrix is **built but dormant behind a Firestore flag**
(`aiFeatures/distanceMatrix.enabled`, default `false`). When you
hit real scale (~50 shops / 100s of customers), flip the flag —
no code change, no redeploy — and the system upgrades to
road-accurate distance/duration instantly. Tracked as a future
to-do in ROADMAP + this doc's deferred section.

**India proration (the free default):**
- Distance: `haversineKm × 1.4` (Indian roads wind more than a
  US grid → higher straight-line→road inflation than the usual
  1.3).
- Duration: `distanceKm / 15 km/h × 60` (urban two-wheeler in
  Indian traffic; conservative so the customer's ETA isn't
  optimistic).

Both constants are tunable. Accuracy is "good enough" — off by
maybe 15–25% — which is fine for coarse charge bands and a
ballpark ETA at pilot scale.

## Distance strategy (free now, Distance-Matrix-ready later)

Two methods. **For pilot, the haversine+proration column is used
everywhere** (the flag keeps Distance Matrix off). The
Distance-Matrix column is what each operation upgrades to when
the flag flips.

| Operation | Pilot (flag OFF) | Upgrade (flag ON) |
|---|---|---|
| Shop-list filtering (service radius) | Haversine | Haversine (stays — coarse, high-volume, never needs Matrix) |
| Customer "distance to shop" on card | Haversine "~X km" | Haversine (stays) |
| Delivery charge tier band | **Haversine × 1.4** | Distance Matrix road km |
| Customer delivery ETA | **Haversine × 1.4 ÷ 15 km/h** | Distance Matrix duration (+ optional traffic) |
| Partner total ride distance | **Haversine × 1.4** | Distance Matrix |
| Partner notification radius gate | Haversine | Haversine (stays) |

**Rule of thumb:** filtering / sorting / "~X km" labels stay on
haversine forever (coarse + high-volume — Matrix would be
wasteful). Only the per-order numbers (charge, ETA, ride) upgrade
to Distance Matrix when the flag flips — and even those have the
haversine path as a permanent fallback if Google ever errors.

### Google Maps Platform — the one infra prerequisite

The hybrid needs a Google Maps Platform API key with **Distance
Matrix API** enabled, stored as a Firebase Functions secret
(`GOOGLE_MAPS_API_KEY`). All Distance Matrix calls happen
**server-side** (in callables / triggers) so the key is never
shipped in the client bundle.

**Cost:** Distance Matrix is ~$5 per 1,000 elements (1 element =
1 origin→destination pair). Per order ≈ 1–3 elements (shop→
customer for charge+ETA, optionally partner→shop→customer for
ride). Google gives **$200/month free credit** on Maps Platform
(~40,000 elements). Pilot volume (~50–500 orders/month) is
**comfortably inside the free tier — effectively ₹0**. This
de-risks the "paid API" concern entirely for pilot scale; the
paid tier only matters at thousands of orders/month.

## Data model additions (all additive, schema-safe)

### `Order`

```ts
// Replaces the implicit "deliveryAddress only" model.
deliveryLocation: {
  lat: number;
  lng: number;
  type: 'saved_address' | 'current_location';
  addressId?: string;       // present when type === 'saved_address'
  label: string;            // snapshot for display, LOCKED at order time
};
// Computed once at checkout via Distance Matrix (haversine fallback):
deliveryDistanceKm: number;   // shop → delivery location, ROAD distance
deliveryDurationMin: number;  // shop → delivery location, estimated ride time
deliveryCharge: number;       // from the shop's tier table for deliveryDistanceKm
// `deliveryFee` (flat) is deprecated; deliveryCharge supersedes it.
```

The point is **locked** — once the order is placed, the
delivery location, distance, charge, and ETA don't change even
if the customer later moves or edits the address. (Matches
Sudhir's "that will be locked.")

### `Shop`

```ts
// Per-shop custom tiers. Ordered ascending by maxKm; the final
// entry uses maxKm: null = "everything beyond the last band".
deliveryChargeTiers: Array<{ maxKm: number | null; charge: number }>;
// e.g. [
//   { maxKm: 1,    charge: 20 },
//   { maxKm: 3,    charge: 40 },
//   { maxKm: 5,    charge: 60 },
//   { maxKm: null, charge: 100 },   // > 5km
// ]
serviceRadiusKm: number;   // shop hidden from customers beyond this
```

New shops get an **admin-configured default** tier table +
service radius at approval time (so a shop owner who skips
config still has sane values). Shop owner edits both in Shop
Settings.

### `User` (delivery partner)

```ts
notificationRadiusKm: number;     // partner notified only for shops within this
currentLocation?: {               // last-known, for sort + notification gate
  lat: number;
  lng: number;
  updatedAt: number;
};
```

`currentLocation` is reported by the partner's app on foreground
+ when the delivery dashboard opens. No background location
tracking (battery + permission cost not worth it for pilot).

## PR breakdown (build order — all before pilot)

### PR 46 — Geo foundation: locked delivery location + Distance Matrix ✅ SHIPPED (May 27 2026)

**Status:** Code-complete. 858/858 tests passing, tsc clean. Awaiting deploy + smoke acceptance (see PRELAUNCH_CHECKLIST.md → "PR 46" section).

**Sub-scope decisions actually shipped:**
- Distance Matrix is **DORMANT** during pilot (`aiFeatures/distanceMatrix.enabled` defaults FALSE; cost-guarantee pinned by `tests/functions/distanceMatrixHelpers.test.ts → "CRITICAL: flagEnabled=false → fetchImpl NEVER called"`).
- Constants: `ROAD_FACTOR=1.4`, `FALLBACK_SPEED_KMH=15`.
- `SavedAddress` got optional `lat?` / `lng?` (validator rejects half-set pairs); `AddressEditScreen` gained "📍 Use my current location" via expo-location only.
- **Draggable map pin (react-native-maps) was DEFERRED** — not in PR 46 to keep this OTA-safe. Future PR.
- **ETA coupling DEFERRED to PR 51+** — `deliveryDurationMin` is stored on the order doc but not yet wired into `orderEtaDisplay`.
- **Reverse geocoding DEFERRED** — current-location label is the literal string `'Current location'`.

The keystone. Everything else depends on it.

- Add `deliveryLocation` to the `Order` type + the placeOrder
  callable.
- **Checkout UX:** "Deliver to my current location" option
  alongside saved addresses. Capturing current GPS, reverse-
  geocoding to a display label (Distance Matrix's sibling
  Geocoding API, or just show "Current location" + coords).
  Lock the chosen point on the order.
- **Server:** `getDeliveryEstimate` callable — given shop +
  delivery location, calls Distance Matrix, returns
  `{ distanceKm, durationMin }` (haversine × 1.3 fallback if the
  API errors, so checkout never hard-blocks on Google).
- `GOOGLE_MAPS_API_KEY` Functions secret + Distance Matrix API
  enabled in the GCP project.
- Surfaces the accurate ETA on OrderConfirmation + OrderDetail
  (folds in goal #4 since duration comes free with the call).

### PR 47 — Distance-based delivery charges ✅ SHIPPED (May 27 2026)

**Status:** Code-complete. 888/888 tests passing (30 new helper cases), tsc clean both client + functions. Awaiting deploy + smoke acceptance (see PRELAUNCH_CHECKLIST.md → "PR 47" section).

**Sub-scope decisions actually shipped:**
- Pure helpers `chargeForDistance` + `validateDeliveryChargeTiers` + `DEFAULT_DELIVERY_CHARGE_TIERS = [{≤1km, ₹20}, {≤3km, ₹40}, {≤5km, ₹60}, {beyond, ₹100}]` live in `functions/src/deliveryChargeHelpers.ts` with a same-shape client mirror at `src/utils/deliveryChargeHelpers.ts` (repo convention — client doesn't import from `functions/`).
- INCLUSIVE `maxKm` boundaries; sort-on-read; legacy fallback to flat `deliveryFee` for shops without a tier table.
- `placeOrder` uses **server-derived** `stampedDeliveryDistanceKm` (PR 46 stamp) to compute the charge; client preview is for display only. Order doc gets BOTH `deliveryCharge` (new source of truth) AND `deliveryFee = deliveryCharge` (back-compat shim for every existing reader). Mirroring approach was chosen over a one-shot rename to avoid touching ShopOrderDetail / receipts / refund logic in this PR — those readers can migrate independently.
- New callable `updateShopDeliveryTiers` (asia-south1, shop-owner-only — server reads `claims.shopId`, request-body shopId is intentionally unsupported here unlike `updateShopSettings`).
- `approveShop` seeds `DEFAULT_DELIVERY_CHARGE_TIERS` only when the shop doc doesn't already have tiers (preserves a previously-customized table on re-approval after a suspend cycle).
- Cart store gained a `deliveryChargeTiers` snapshot (parallel to the existing `deliveryFee` snapshot) so CheckoutScreen can render the tiered preview without re-fetching the shop. Persisted via partialize.
- Charge label on the bill: "Delivery (X.X km)  ₹N" — distance-bearing so customers see WHY the charge is what it is.

**Deferred / out of scope:**
- Payout split (delivery charge → shop vs partner) is a separate economics design, not part of the geo system.
- Migration of every existing reader from `deliveryFee` → `deliveryCharge` — staged migration after PR 47, the back-compat shim makes this a non-blocker.

- `deliveryChargeTiers` on `Shop` + Shop Settings editor (add/
  remove bands, set km + ₹).
- Admin default tier table for new shops (set at approve time).
- Checkout computes `deliveryCharge` from the tier matching
  `deliveryDistanceKm` (the road distance from PR 46).
- Replaces flat `deliveryFee` in the order total.
- Pure helper `chargeForDistance(tiers, km)` — fully unit-tested
  (band edges, the `null` catch-all, empty/malformed tiers).

### PR 48 — Shop service radius + customer distance visibility ✅ SHIPPED (May 27 2026)

**Status:** Code-complete. 916/916 tests passing (28 new cases), tsc clean both client + functions. Awaiting deploy + smoke acceptance (see PRELAUNCH_CHECKLIST.md → "PR 48" section).

**Sub-scope decisions actually shipped:**
- Visibility filter lives **server-side** in `listShopsPublic` (the architectural constraint: native client can't read Firestore directly; the radius gate must run where `distanceKm` is computed). Client `getNearbyShops` trusts the server's filtered list on native; the web Plan B path mirrors with the same pure helper.
- "Show all shops" testing override is a **Firestore doc** `appConfig/shopVisibility.showAllShops` — NOT a `__DEV__` flag (that approach broke on TestFlight in PR 10). Toggleable without rebuild/redeploy. Defaults to FALSE on missing doc / read error (secure default).
- `DEFAULT_SERVICE_RADIUS_KM = 5`. INCLUSIVE radius boundary (matches PR 47's tier-boundary convention). Helper fail-OPEN on missing `distanceKm` (no GPS / no shop location → keep) — the alternative would silently strand customers.
- Server-side validation: integer-only, 1–50 km. The 1-km floor matches the cheapest `chargeForDistance` band so an owner can't set a radius hiding them from EVERY customer.
- `approveShop` seeds the default only when the doc lacks one (preserves customized radius across re-approval after suspend, same posture as PR 47's tier seed).

**Bonus fixes folded in (PR 47 smoke-test bug, sections I + J):**
- **Tier-save persistence (Sudhir).** Two independent defects: (1) `updateShopSettings` + `updateShopDeliveryTiers` wrote `updatedAt: Date.now()` (number) while every other shop write used `FieldValue.serverTimestamp()` (Timestamp) — Firestore orders mixed-type fields by type first, so `getMyShop`'s `.orderBy('updatedAt', 'desc')` returned a stale tier-less doc immediately after a save. (2) Writer keyed by `shops/{claims.shopId}` while `getMyShop` ran an `ownerUid` query, which can resolve to different docs for owners with multi-doc histories. Fix: normalize both writes to `serverTimestamp()` AND make `getMyShop` read by `claims.shopId` directly (the same key the writers use). The `ownerUid` query is preserved ONLY for pending/no-claim owners (`WaitingForApproval` relies on it). Temporary diagnostic logs in `getMyShop` capture which path resolved + `hasTiers` + `updatedAt` type — strip after Sudhir confirms the fix.
- **Removed flat "Delivery fee" input** from Shop Settings (UI only). Since PR 47, the tier table governs pricing; the flat field was confusing owners. The `shop.deliveryFee` data field, type, cart-store snapshot, and `chargeForDistance` legacy fallback ALL stay intact — only the editable control was removed.

**Deferred / out of scope:**
- Partner routing / sorting / location reporting (PR 49).
- Partner notification radius (PR 50).
- Per-customer "deliver here" radius preview on the shop card.
- Reverse-geocoding the customer location to a label (PR 46 deferred).

- `serviceRadiusKm` on `Shop` + Shop Settings field.
- Customer shop list filters to shops where
  `haversine(customer, shop) <= shop.serviceRadiusKm`.
- Each shop card shows the actual distance ("~2.3 km").
- **Replaces `SHOW_ALL_SHOPS = true`** — flip to the real radius
  gate. (Keep a `__DEV__`-only override for cross-city testing.)
- Admin default radius for new shops.

### PR 49 — Delivery partner routing + sorting + location reporting ✅ SHIPPED (May 27 2026)

**Status:** Code-complete. 930/930 tests passing (14 new cases), tsc clean both client + functions. Awaiting deploy + smoke acceptance (see PRELAUNCH_CHECKLIST.md → "PR 49" section).

**Sub-scope decisions actually shipped:**
- **Foreground-only location capture.** Wrapped in PR 46's `locationService.getCurrentLocation` so the permission UX matches the customer-side. Captured inside the existing `useFocusEffect` (no separate timer/poll). Permission denial / GPS timeout silently leaves `partnerLoc` null; the `sortPickupsByProximity` helper degrades gracefully (every distance becomes Infinity → stable original order).
- **Pure helper is client-only.** Unlike PR 47's `deliveryChargeHelpers` and PR 48's `geoVisibilityHelpers` (both have `functions/` + `src/utils/` mirrors because the server consumes them), PR 49's `deliveryRoutingHelpers` lives only under `src/utils/` — the server doesn't sort pickups, since each partner sorts by their own live GPS.
- **`reportDeliveryLocation` writes server-side now even though PR 49's own sort doesn't read it.** This way PR 50 has fresh `currentLocation` data the moment it ships — no waiting for a backfill window.
- **`currentLocation` is server-internal.** Added to `PROFILE_INTERNAL_FIELDS` so `getMyProfile` and the four other profile readers never leak partner coords to the customer-side surface area.
- **Stable nearest-first sort with original-index tiebreaker.** Equal-distance pickups (or the all-Infinity null-partner case) preserve their original order — no jitter on every focus.
- **Tri-state ride-distance line.** Both legs known → `🛵 ~X.X km ride · A to shop + B to drop`. Only drop known (no partner GPS yet, but PR 46 stamped the shop→customer leg) → `Drop ~B km from shop`. Neither known (legacy order) → render nothing — no regression vs pre-PR-49 layout.

**Bonus fix folded in (section F — PR 48 regression):**
- `updateShopSettings`'s `onCall<{…}>` request type was missing `serviceRadiusKm` (the validator was updated for PR 48, the wrapper wasn't). Radius-only payloads arrived at the validator with all three fields undefined and tripped the "at least one of …" guard. Two-line wrapper fix; audit-log `before` snapshot also extended to include `serviceRadiusKm` for clean diffs.

**Deferred / out of scope:**
- Notification-radius push filtering (PR 50 — consumes the `currentLocation` this PR writes).
- Background / live location tracking; partner map view.
- Any Distance Matrix call (flag stays dormant).
- Reverse-geocoding partner or customer location to a label.

- Partner app reports `currentLocation` on foreground / dashboard
  open.
- Available pickups sorted nearest-first (partner → shop
  haversine for the list; exact on tap).
- Each pickup shows total ride distance: (partner → shop) +
  (shop → customer). Uses the order's stored `deliveryDistanceKm`
  for the second leg (no extra API call) + computes the first leg.
- Partner sees the locked delivery location type ("Home" vs
  "Current location").

### PR 50 — Delivery partner notification radius

- `notificationRadiusKm` on `User` + a setting in the delivery
  partner's profile.
- The order-ready notify trigger reads online delivery partners,
  computes `haversine(partner.currentLocation, shop.location)`,
  and pushes ONLY to partners within their own radius.
- For pilot scale (handful of partners) a read-all-then-filter in
  the trigger is fine — no geohashing needed until hundreds of
  partners. (Note in code: geohash migration path for scale.)

## Key design decisions baked in

1. **Locked at order time.** Delivery location, distance, charge,
   ETA snapshot onto the order and never recompute. Customer
   moving after ordering doesn't change their charge.
2. **Haversine fallback everywhere Distance Matrix is used.** If
   Google errors / rate-limits, checkout still completes with an
   approximate (haversine × 1.3) number. Never hard-block a sale
   on a third-party API.
3. **Server-side only for the Maps key.** No API key in the
   client bundle. All Distance Matrix calls go through callables /
   triggers.
4. **Per-shop tiers with admin defaults.** Shop owners get
   flexibility; new shops get sane defaults so config is optional.
5. **No background location.** Partner location reported on
   foreground/dashboard-open only. Pilot doesn't need live
   tracking; it adds battery drain + a scarier permission prompt.
6. **Notification radius is server-gated** (true push filtering),
   per Sudhir's explicit "only within 2km" requirement — not just
   a client-side display filter.

## Config defaults to confirm (for new shops / partners)

These need a value to ship; suggested starting points:

- **Default shop delivery tiers:** ≤1km ₹20, 1–3km ₹40, 3–5km
  ₹60, >5km ₹100 (Sudhir's example values — confirm or adjust).
- **Default shop service radius:** 5 km (urban kirana realistic
  delivery range).
- **Default partner notification radius:** 3 km.
- **Haversine→road fallback multiplier:** 1.3 (typical urban
  India straight-line→road inflation).
- **Ride-time speed assumption** (if Distance Matrix duration
  unavailable): 18 km/h average urban two-wheeler.

## 🔮 FUTURE TO-DO — enable Distance Matrix at scale (don't miss this)

**Trigger:** when HamaraSetu reaches ~50 shops / hundreds of
customers, or whenever pilot feedback shows the haversine
proration is too inaccurate (customers complaining ETA is off,
or charges feeling wrong for winding routes).

**Action:** flip `aiFeatures/distanceMatrix.enabled` to `true` in
Firestore. That's it — no code change, no redeploy. The
`getDeliveryEstimate` callable already has the Distance Matrix
path built (PR 46) and falls back to haversine on any error.

**Before flipping:** confirm Maps Platform billing is set up and
review expected cost vs the $200/month free credit at your
then-current volume. At thousands of orders/month you'll start
paying (~$5 / 1,000 elements). Add an alert on Maps Platform
spend.

**Also enabled APIs (ready, currently unused):** Distance Matrix
API + Geocoding API on `grocery-mvp-dev`, key in
`GOOGLE_MAPS_API_KEY` Functions secret. These were set up May 27
2026 but the code doesn't call them until the flag flips.

## Out of scope (explicitly deferred)

- **Live traffic in ETA** — Distance Matrix supports
  `departure_time` for traffic-aware duration, but it costs more
  and needs the "duration_in_traffic" field. Pilot uses
  free-flow duration; traffic-aware is a post-pilot upgrade.
- **Real-time partner GPS tracking on the customer's map** ("see
  your delivery partner approaching"). Big feature, needs live
  location streaming. Phase C / post-pilot.
- **Multi-stop route optimization** for partners carrying
  multiple orders. Not relevant at pilot volume.
- **Geohashing** for the notification-radius query. Only needed
  at hundreds-of-partners scale; read-all-and-filter is fine now.

## Open question for Sudhir before PR 46

The only thing I'd confirm before writing the PR prompts: are the
default tier values above (₹20/40/60/100) and the default radii
(5km service, 3km notification) right as starting points? They're
all per-shop / per-partner configurable, so these are just the
"new account" defaults — easy to change later, but the PRs need a
number to ship with.
