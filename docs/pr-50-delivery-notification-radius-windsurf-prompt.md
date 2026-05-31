# PR 50 — Delivery partner notification radius (Windsurf prompt)

> **Last PR of the 5-PR geo/distance system** (see
> `docs/GEO_DISTANCE_SYSTEM_DESIGN.md` → "PR 50" section). PRs
> 46–49 wired the data path: every order now has `shopLocation` +
> `deliveryDistanceKm` stamped at placeOrder, every online partner
> reports their `currentLocation` to `users/{uid}` on dashboard
> focus. PR 50 finally **uses** that data to filter the
> new-pickup push fan-out so partners only get notified about
> pickups they can realistically take.
>
> Goal #6 of the geo system: server-side push filtering, per
> Sudhir's explicit "only within 2 km" requirement (translated
> to a per-partner configurable radius with a 3 km default).
>
> Pure JS/TS + Cloud Functions edit. **OTA-safe** for the client
> side; the server side ships via `firebase deploy --only
> functions:sendNewPickupPushToDelivery,functions:approveDeliveryRole,functions:updateMyDeliverySettings`.

## Why this PR exists

Today (post-PR-49), the `sendNewPickupPushToDelivery` trigger
(`functions/src/index.ts` line 3421) pushes a new-pickup
notification to **every** online delivery partner regardless of
location. For a handful of pilot partners across a city this
already produces unnecessary buzz — a partner in north Faridabad
pinged about an order in south Faridabad they'd never accept. At
~50 shops × ~20 partners the noise becomes a problem worth
solving with a geo filter (Goal #6 of the geo system, "server-
gated true push filtering").

The data is already there:
- **Shop coordinate per order:** `Order.shopLocation` was added in
  PR 49 (line 450 of `src/types/index.ts`); placeOrder stamps it
  from the shop doc with no extra read.
- **Partner coordinate per online partner:**
  `users/{uid}.currentLocation` is written by
  `reportDeliveryLocation` (PR 49, foreground-only, on Delivery
  Dashboard focus).
- **All we're missing:** a per-partner `notificationRadiusKm`
  preference + the haversine filter applied in the trigger before
  the push fans out.

## Read first

- `docs/GEO_DISTANCE_SYSTEM_DESIGN.md` → "PR 50" section + design
  decisions #5 (no background location) and #6 (server-gated true
  push filtering).
- `functions/src/index.ts` line 3421 — `sendNewPickupPushToDelivery`
  trigger. **This is the surface to extend.** Read it end-to-end
  before editing.
- `functions/src/index.ts` line 4202 — `approveDeliveryRole`
  callable. Seed the default radius here when a partner is
  first approved (mirror of how `approveShop` seeds
  `deliveryChargeTiers` + `serviceRadiusKm`).
- `functions/src/index.ts` line 3370 — `setDeliveryStatus`
  callable. Mirror the `requireDeliveryRole` auth pattern for the
  new `updateMyDeliverySettings` callable.
- `functions/src/index.ts` ~line 6106 — `PROFILE_INTERNAL_FIELDS`.
  Add `notificationRadiusKm` to the strip-list so it doesn't
  leak through `getMyProfile`. (Decision: this *is* user-
  configurable so could go either way — see decision note below.)
- `src/screens/delivery/DeliveryDashboardScreen.tsx` — where the
  online toggle lives. The notification-radius setting goes here
  too, in the same status card.
- `src/services/orderService.ts` — mirror the
  `reportDeliveryLocation` shape for the new `updateMyDeliverySettings`.
- `src/utils/distance.ts` — `haversineKm`. Reuse it; do not
  introduce a second haversine.
- `.windsurf/code-discipline.md` Rules 1, 2 (import-strip; hooks
  above conditional early returns).
- `.windsurf/deploy-discipline.md` — Cloud Run IAM verify on the
  new callable.

## Scope of changes

### A. `notificationRadiusKm` — schema + default

**Type:** `notificationRadiusKm?: number` on the `users/{uid}` doc.
Optional; absence means "use default." Not added to `UserProfile`
in `src/types/index.ts` — see decision note below.

**Default:** `DEFAULT_PARTNER_NOTIFICATION_RADIUS_KM = 3` (km),
per design doc.

**Range:** integer 1–50 km. Same posture as `serviceRadiusKm`
from PR 48.

**Decision note — should this field be in `UserProfile` (returned
by `getMyProfile`)?**

Arguments for: it's user-configurable, the partner needs to read
their current value to populate the dashboard setting.

Arguments against: `UserProfile` is the customer-side projection;
delivery-specific fields like `deliveryStatus` are NOT in it
(stripped server-side). Keeping `notificationRadiusKm` out
maintains the separation.

**Recommended:** keep it out of `UserProfile`. Instead, expose a
dedicated read via a new callable `getMyDeliverySettings()` that
returns `{ notificationRadiusKm, deliveryStatus }` — delivery-role
only. This mirrors how the existing setDeliveryStatus path
already keeps delivery-internal fields server-side. The Delivery
Dashboard calls this on mount to populate the setting.

(This also incidentally addresses **finding #8 from
TESTING-FINDINGS-2026-05-30.md** — "online toggle doesn't persist
across screen navigations" — by giving the dashboard a way to
read its own server state on mount. Free fix; flag it in the
shipping note.)

### B. Pure helper — `functions/src/notificationRadiusHelpers.ts` (new)

The filter logic, fully testable without firebase-admin (same
pattern as `deliveryChargeHelpers`, `geoVisibilityHelpers`,
`distanceMatrixHelpers`).

```ts
/**
 * PR 50 — Delivery partner notification radius filter.
 *
 * Decides which online delivery partners receive a push for a new
 * pickup, based on each partner's distance from the shop and their
 * per-partner notification-radius preference. Pure decision logic;
 * lives outside the trigger so it's unit-testable without
 * firebase-admin.
 */

import { haversineKm } from './distanceMatrixHelpers';

export const DEFAULT_PARTNER_NOTIFICATION_RADIUS_KM = 3;

type LatLng = { lat: number; lng: number };

export type PartnerRow = {
  uid: string;
  currentLocation?: LatLng | null;
  notificationRadiusKm?: number;
  fcmTokens?: string[];
};

/**
 * Filter the set of online partners down to those within their
 * notification radius of the given shop.
 *
 * Fail-OPEN rules (never silently exclude a partner from work
 * because of missing data):
 *   - shopLocation absent           → keep ALL partners (legacy
 *     order without PR 49's shopLocation stamp; better to push
 *     than to silently miss the work)
 *   - partner.currentLocation absent → keep partner (they haven't
 *     opened the dashboard with location grant yet; fall through
 *     to current "all online partners get pushed" behavior)
 *   - partner.notificationRadiusKm absent / invalid → use
 *     DEFAULT_PARTNER_NOTIFICATION_RADIUS_KM
 *
 * Boundary is INCLUSIVE (distance === radius → kept), matching
 * the boundary convention from PR 47 + PR 48.
 *
 * Does NOT mutate the input array.
 */
export function filterPartnersByNotificationRadius(
  partners: PartnerRow[],
  shopLocation: LatLng | undefined | null,
): PartnerRow[] {
  if (
    !shopLocation ||
    typeof shopLocation.lat !== 'number' ||
    typeof shopLocation.lng !== 'number'
  ) {
    return partners.slice(); // fail-open: no way to measure
  }
  return partners.filter(p => {
    const loc = p.currentLocation;
    if (
      !loc ||
      typeof loc.lat !== 'number' ||
      typeof loc.lng !== 'number'
    ) {
      return true; // fail-open: partner hasn't reported location
    }
    const radius =
      typeof p.notificationRadiusKm === 'number' &&
      Number.isFinite(p.notificationRadiusKm) &&
      p.notificationRadiusKm > 0
        ? p.notificationRadiusKm
        : DEFAULT_PARTNER_NOTIFICATION_RADIUS_KM;
    const distanceKm = haversineKm(loc, shopLocation);
    return distanceKm <= radius;
  });
}
```

⚠️ **No client mirror needed.** Unlike `geoVisibilityHelpers` (PR
48) and `deliveryChargeHelpers` (PR 47), this helper is **server-
only** — the filter runs inside the trigger and partners never see
the decision logic. Matches `deliveryRoutingHelpers` (PR 49,
which IS client-only for the inverse reason — partner sort is
local).

### C. Extend `sendNewPickupPushToDelivery` trigger

`functions/src/index.ts` line 3421. After the existing
`users where isDelivery && deliveryStatus==online` query
(line 3442-3446), apply the filter and collect tokens only from
the filtered set:

```ts
// Existing query (unchanged)
const usersSnap = await db
  .collection('users')
  .where('isDelivery', '==', true)
  .where('deliveryStatus', '==', 'online')
  .get();

// NEW — PR 50 radius filter.
//
// Pilot scale (handful of partners) → read-all-then-filter in
// memory is fine. At hundreds of partners we'd want geohashing
// (precompute geohash prefixes on shopLocation, range-query
// partners by overlapping prefix). Migration path documented in
// docs/GEO_DISTANCE_SYSTEM_DESIGN.md.
const allOnline = usersSnap.docs.map(d => ({
  uid: d.id,
  ...d.data(),
})) as Array<PartnerRow & { id: string }>;

const inRange = filterPartnersByNotificationRadius(
  allOnline,
  after.shopLocation, // PR 49 stamps this on every new order
);
if (inRange.length === 0) {
  console.log(
    `[sendNewPickupPushToDelivery] no in-range delivery people for order ${event.params.orderId}`,
  );
  return;
}

// Then collect tokens from the FILTERED list, not allOnline.
const tokens: string[] = [];
inRange.forEach(p => {
  const userTokens: string[] = p.fcmTokens ?? [];
  tokens.push(...userTokens);
});
```

The existing "no tokens" branch (line 3459) stays; just rename the
log message to reflect the filter (e.g.,
`"…in-range partners have no push tokens"`).

**Important — preserve the existing safety branches:**
- Skip if `after.deliveryPersonId` is set (already-claimed) — keep
- Skip if no online partners — keep (returns early)
- The new "no in-range partners" branch returns early too

### D. `approveDeliveryRole` — seed the default

`functions/src/index.ts` line 4235. The merge currently writes
`{ isDelivery: true }`. Extend to also seed the default radius
**only when absent** (idempotent on re-approval):

```ts
const existing = await db.doc(`users/${result.targetUid}`).get();
const existingRadius = existing.data()?.notificationRadiusKm;
const seedRadius =
  typeof existingRadius === 'number' && existingRadius > 0
    ? null
    : DEFAULT_PARTNER_NOTIFICATION_RADIUS_KM;

await db.doc(`users/${result.targetUid}`).set(
  {
    isDelivery: true,
    ...(seedRadius != null ? { notificationRadiusKm: seedRadius } : {}),
  },
  { merge: true },
);
```

Import `DEFAULT_PARTNER_NOTIFICATION_RADIUS_KM` from
`notificationRadiusHelpers`.

### E. New callable — `updateMyDeliverySettings`

`functions/src/index.ts`, near `setDeliveryStatus` (line ~3370).
Mirror its auth + write pattern exactly:

```ts
export const updateMyDeliverySettings = onCall<{
  notificationRadiusKm?: number;
}>(
  { cors: true, enforceAppCheck: false },
  async request => {
    const { uid } = requireDeliveryRole(request);
    const radius = request.data?.notificationRadiusKm;
    if (radius === undefined) {
      throw new HttpsError(
        'invalid-argument',
        'notificationRadiusKm is required',
      );
    }
    if (
      typeof radius !== 'number' ||
      !Number.isInteger(radius) ||
      radius < 1 ||
      radius > 50
    ) {
      throw new HttpsError(
        'invalid-argument',
        'notificationRadiusKm must be an integer in [1, 50]',
      );
    }
    await db.doc(`users/${uid}`).set(
      {
        isDelivery: true,
        notificationRadiusKm: radius,
      },
      { merge: true },
    );
    return { ok: true, notificationRadiusKm: radius };
  },
);
```

### F. New callable — `getMyDeliverySettings`

For the dashboard to read its own state on mount. Auth: delivery
role.

```ts
export const getMyDeliverySettings = onCall(
  { cors: true, enforceAppCheck: false },
  async request => {
    const { uid } = requireDeliveryRole(request);
    const snap = await db.doc(`users/${uid}`).get();
    const data = snap.data() ?? {};
    return {
      deliveryStatus: data.deliveryStatus ?? 'offline',
      notificationRadiusKm:
        typeof data.notificationRadiusKm === 'number'
          ? data.notificationRadiusKm
          : DEFAULT_PARTNER_NOTIFICATION_RADIUS_KM,
    };
  },
);
```

This **also fixes finding #8** (online toggle persistence across
screen navigations) since the dashboard can now read its own
authoritative state on mount.

### G. Client — `orderService` wrappers

`src/services/orderService.ts`. Mirror the existing
`setDeliveryStatus` shape for both new callables:

```ts
async updateMyDeliverySettings(input: {
  notificationRadiusKm: number;
}): Promise<{ ok: true; notificationRadiusKm: number }> {
  // native + web branches mirroring setDeliveryStatus
},

async getMyDeliverySettings(): Promise<{
  deliveryStatus: 'online' | 'offline';
  notificationRadiusKm: number;
}> {
  // native + web branches mirroring setDeliveryStatus
},
```

### H. Delivery Dashboard — settings UI + state-on-mount

`src/screens/delivery/DeliveryDashboardScreen.tsx`.

**1. Initialize `online` + `notificationRadiusKm` from server on
mount.** Use `getMyDeliverySettings` inside the existing
`useFocusEffect` (alongside `locationService.getCurrentLocation`,
already there from PR 49). Both calls are best-effort — failure
leaves the local state at its default. **This fixes finding #8.**

```ts
// Inside useFocusEffect, alongside the PR 49 location capture:
void (async () => {
  try {
    const settings = await orderService.getMyDeliverySettings();
    if (cancelled) return;
    setOnline(settings.deliveryStatus === 'online');
    setNotificationRadiusKm(settings.notificationRadiusKm);
  } catch {
    // best-effort — leave local defaults in place
  }
})();
```

**2. Add the notification-radius setting card.** Below the existing
status card (the online toggle), add a small card:

```tsx
<View style={styles.settingsCard}>
  <Text style={styles.settingsLabel}>Notify me about pickups within</Text>
  <View style={styles.radiusRow}>
    <TextInput
      value={String(notificationRadiusKm ?? DEFAULT_PARTNER_NOTIFICATION_RADIUS_KM)}
      onChangeText={setRadiusInput}
      keyboardType="number-pad"
      style={styles.radiusInput}
    />
    <Text style={styles.radiusUnit}>km</Text>
    <Pressable
      onPress={handleSaveRadius}
      disabled={savingRadius || !radiusDirty}
      style={[styles.radiusSaveBtn, radiusDirty && styles.radiusSaveBtnActive]}
    >
      <Text style={styles.radiusSaveText}>{savingRadius ? 'Saving…' : 'Save'}</Text>
    </Pressable>
  </View>
  <Text style={styles.settingsHelp}>
    Pickups farther than this won't push you. Range 1–50 km.
  </Text>
</View>
```

`handleSaveRadius` calls `orderService.updateMyDeliverySettings({
notificationRadiusKm })`, validates 1–50 integer client-side,
shows inline error on out-of-range (server re-validates).

**3. State hooks above conditional early returns** (Rule 2 — the
new state lives with `partnerLoc`, `online`, etc. at the top of
the component).

**4. The new constant import:**
`DEFAULT_PARTNER_NOTIFICATION_RADIUS_KM` from a client-side
mirror — OR just hardcode `3` in the screen with a comment
pointing at the server-side constant. **Don't** import from
`functions/` (repo convention).

Recommended: hardcode `3` with a comment
`// keep in sync with DEFAULT_PARTNER_NOTIFICATION_RADIUS_KM in functions/`.

## Tests

**New: `tests/functions/notificationRadiusHelpers.test.ts`** —
exhaustive matrix for `filterPartnersByNotificationRadius`:

- Within radius → kept; beyond radius → dropped.
- Exactly at radius boundary (distance === radius) → kept
  (INCLUSIVE).
- Partner missing `currentLocation` → kept (fail-open).
- Shop `shopLocation` missing → all partners kept (fail-open).
- Partner with `notificationRadiusKm` absent → falls back to
  `DEFAULT_PARTNER_NOTIFICATION_RADIUS_KM` (3 km).
- Partner with `notificationRadiusKm: 0 / negative / NaN` →
  treated as missing → default.
- Mixed list (some partners with location, some without) →
  partners with location filtered by radius, partners without
  kept unconditionally.
- Empty input → empty output.
- Does NOT mutate input.
- Pin `DEFAULT_PARTNER_NOTIFICATION_RADIUS_KM === 3`.

**Extend existing tests** for `approveDeliveryRole` to assert the
default seeding (only on first approve, not on re-approve).

**Extend** `tests/functions/index.test.ts` (or wherever the
trigger has integration coverage) — if there's a seam, pin that
the filtered partner list (not the raw list) is used for token
collection.

`npm test` target: green. Suite count expected to grow by ~12–18
tests.

## Deploy plan (server-first — deploy-discipline)

1. Deploy the changed/new functions:
   ```
   firebase deploy --only functions:sendNewPickupPushToDelivery,functions:approveDeliveryRole,functions:updateMyDeliverySettings,functions:getMyDeliverySettings
   ```

2. **Verify Cloud Run IAM** on the two new public callables (the
   recurring gotcha):
   ```
   gcloud run services get-iam-policy updatemydeliverysettings --region=asia-south1
   gcloud run services get-iam-policy getmydeliverysettings --region=asia-south1
   ```
   Add `allUsers` / `roles/run.invoker` to either if missing:
   ```
   gcloud run services add-iam-policy-binding <svc> --region=asia-south1 --member=allUsers --role=roles/run.invoker
   ```
   `sendNewPickupPushToDelivery` is a background trigger — does
   NOT need `allUsers`. `approveDeliveryRole` is admin-only — same.

3. Ship the client:
   ```
   eas update --branch production --message "PR 50 partner notification radius"
   ```
   OTA-safe — pure JS, no native module / no permission change.

## Smoke acceptance (do these in order, with two phones)

1. **Default seeded on new approve:** Admin approves a new
   delivery partner. The partner's `users/{uid}` doc has
   `notificationRadiusKm: 3` immediately. (Confirm in Firestore
   console.)

2. **Dashboard reads state on mount (#8 fix):** Existing partner
   toggles Online → navigates away → returns to dashboard. **The
   Online toggle stays ON.** Previously it reset to Offline; this
   should now persist.

3. **Radius save persists:** Partner changes radius to 5, taps
   Save → "Saved" feedback → navigates away and back → field
   shows 5. Repeat for an out-of-range value (60) — inline error,
   no save.

4. **Filter applies — in-range partner gets push:** Partner A is
   in Ballabgarh with radius 5 km. Place an order from a
   Ballabgarh shop (~2 km from A's reported location). Partner A
   receives push within ~5s.

5. **Filter applies — out-of-range partner does NOT get push:**
   Partner B is in Faridabad (~12 km from the same shop) with
   default 3 km radius. Place the same order. Partner B does
   NOT receive the push. Confirm via Sentry / log inspection that
   the trigger ran and Partner B was correctly excluded.

6. **Fail-open: partner without `currentLocation` still gets
   push.** Partner C is online but has never opened the dashboard
   with location granted (no `currentLocation` doc field). Place
   an order. Partner C receives the push (correct — we don't
   silently exclude work from partners who haven't enabled
   location).

7. **Fail-open: legacy order without `shopLocation`.** Skip if
   no legacy orders exist in your pilot data — the seed shops
   created post-PR-49 all have shopLocation. If you do have a
   pre-PR-49 order, place a new ready_for_pickup transition on
   it (or fake one) — all online partners receive the push
   regardless of distance.

## Out of scope (do not pull in)

- Customer-facing partner-availability indicator (#9 from
  testing-findings) → folded into a later PR (PR-NEXT-7).
- Geohash-based partner queries (the read-all-then-filter is
  fine until ~100s of partners; document the migration path in a
  trigger comment).
- Adding `notificationRadiusKm` to `UserProfile` — kept out
  deliberately (see decision note in §A).
- Per-shop notification preferences (partner picks specific
  shops to receive pushes from) — future feature, not pilot.
- Background location tracking — design decision #5 holds; the
  partner's `currentLocation` updates on dashboard focus only.

## Update doc trail after shipping

1. Mark **PR 50 SHIPPED** in `docs/GEO_DISTANCE_SYSTEM_DESIGN.md`
   ("Goal #6: server-side push filtering" — completed). **The
   geo system is now 5/5 done.**
2. Mark finding **#8 (online toggle persistence)** as **Shipped**
   in `docs/TESTING-FINDINGS-2026-05-30.md` (this PR fixes it as
   a side effect via `getMyDeliverySettings`).
3. Append SESSION_LOG entry covering the geo system completion,
   the fail-open filter pattern, and the read-all-then-filter
   scale note.
4. Bump test suite count in `CLAUDE.md` Current state.
