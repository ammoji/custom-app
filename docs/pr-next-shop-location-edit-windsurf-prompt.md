# PR-NEXT-SHOP-LOCATION-EDIT — Dual-mode shop location capture + edit + admin re-approval

**Source:** Sudhir's June 2 testing. A US friend registered a shop with Ballwin MO address; admin saw a Faridabad pin (silent `MOCK_USER_LOCATION` fallback). Friend had no path to update the pin post-submit. SHOP-LOCATION-REQUIRED enforced "location present + valid" but missed (1) `source === 'fallback'` filtering, (2) no edit path, (3) no remote-registration path (typed address → pin).

Immediate HOTFIX-FALLBACK-LEAK shipped (2026-06-02, direct edit) blocks new bad-pin registrations. This PR delivers the real solution.

**Decisions locked (pre-design check):**
- Address-text + `Location.geocodeAsync` — free, no API key, OTA-only ship
- Edit post-approval requires admin re-approval (`pendingLocation` two-step)
- Admin sees owner-typed address + reverse-geocoded pin resolution side-by-side

**Out of scope (explicitly):**
- `react-native-maps` / interactive map / draggable pin — `eas build` required, recurring API cost. Defer until pilot signal demands sub-10m pin precision.
- Automated address-mismatch detection — admin's eye + side-by-side display is enough for pilot.

**Deploy class:** server-first (3 new + 1 modified callable) → IAM verify 4 services → client OTA.

**Schema audit-grep (Rule 5):**

```
grep -n "Shop\b\|location\?:" src/types/index.ts
grep -n "registerShop\|approveShop\|locationVerified" functions/src/index.ts
grep -n "useLocationStore\|locationService" src/screens/roles/RegisterShopScreen.tsx
grep -n "reverseGeocodeLabel" src/utils/
```

| Symbol | Confirmed at | Notes |
| --- | --- | --- |
| `Shop.location` | `src/types/index.ts:107-116` | `{ lat, lng }` optional |
| `Shop.locationVerifiedAt/By` | added in SHOP-LOCATION-REQUIRED | optional, audit-trail |
| `registerShop` callable | `functions/src/index.ts` | accepts optional `location` |
| `approveShop` callable | `functions/src/index.ts:4884-4980` | rejects no-location, stamps verified |
| `useLocationStore.source` | `src/store/useLocationStore.ts:7` | `'gps' \| 'fallback' \| null` |
| `Location.geocodeAsync` | `expo-location` | free, no API key, returns `[{ latitude, longitude }]` |
| `reverseGeocodeLabel` | `src/utils/reverseGeocodeLabel.ts` (ADDRESS-UX.1) | reuse for resolved-address display |

---

## Design lens — shop owner's question

**Registering:** *"How do I tell the app where my shop is?"*
- If physically at the shop with GPS available → use GPS
- If remote (registering for a relative, testing, GPS unreliable) → type address, let app resolve

**Post-approval edit:** *"I noticed the pin is slightly off / I moved the shop / I want to fix it."*
- Same dual-mode capture
- But edits land in a `pendingLocation` queue; live `location` doesn't change until admin re-approves
- Customers keep seeing the verified pin during review

**Admin question:** *"Is this pin actually where the shop is?"*
- Side-by-side: owner-typed address vs reverse-geocoded pin resolution
- Visual mismatch (Ballwin MO typed; pin resolves to Faridabad) catches the bug instantly
- Same verify-on-map deeplink as today

## RegisterShop layout (§A)

```
┌───────────────────────────────────────────┐
│ Shop address *                            │
│ ┌───────────────────────────────────────┐ │
│ │ 16663 Chesterfield Farms Drive        │ │
│ │ Ballwin MO 63005                      │ │
│ └───────────────────────────────────────┘ │
│                                           │
│ Capture shop GPS location *               │
│ ┌──────────────┐  ┌─────────────────────┐ │
│ │ 📍 Use my GPS │  │ 🔍 Find from address │ │
│ └──────────────┘  └─────────────────────┘ │
│                                           │
│ ┌───────────────────────────────────────┐ │
│ │ ✅ Pin set (typed address)            │ │
│ │ Resolves to: 16663 Chesterfield Farms │ │
│ │ Drive, Ballwin, 63005                 │ │
│ │ 38.6018, -90.5460                     │ │
│ │                                       │ │
│ │ [ ↻ Re-capture ]                      │ │
│ └───────────────────────────────────────┘ │
└───────────────────────────────────────────┘
```

**Variants:**
- **No location captured yet** → CTA buttons visible, no card; submit disabled
- **Fallback hit (HOTFIX-FALLBACK-LEAK already shipped)** → red error message + submit disabled
- **GPS captured** → success card with `Source: device GPS` + the resolved address (reverse-geocoded for verification)
- **Geocoded** → success card with `Source: typed address` + resolved address
- **Geocode failed** → "Address not found — try a more specific address (include city + state/zip), or use 📍 Use my GPS"

## ShopSettings Location section layout (§B)

**Stable state (no pending change):**
```
┌───────────────────────────────────────────┐
│ Shop location                             │
│                                           │
│ Current pin                               │
│ 📍 38.6018, -90.5460                      │
│ Verified by admin on Jun 2, 2026          │
│ Resolves to: 16663 Chesterfield Farms…    │
│                                           │
│ ─────────────────────────────────────     │
│                                           │
│ Update location                           │
│ ┌──────────────┐  ┌─────────────────────┐ │
│ │ 📍 Use my GPS │  │ 🔍 Find from address │ │
│ └──────────────┘  └─────────────────────┘ │
│                                           │
│ ⓘ Location changes need admin approval    │
│   before going live. Customers keep       │
│   seeing your current pin until then.     │
└───────────────────────────────────────────┘
```

**Pending state (after owner submits a change):**
```
┌───────────────────────────────────────────┐
│ Shop location                             │
│                                           │
│ Current pin (visible to customers)        │
│ 📍 38.6018, -90.5460                      │
│ Verified Jun 2, 2026                      │
│                                           │
│ ─────────────────────────────────────     │
│                                           │
│ ⏳ Pending admin approval                  │
│ Proposed pin: 38.6019, -90.5461           │
│ Resolves to: 16663 Chesterfield Farms…    │
│ Submitted Jun 3, 14:23                    │
│                                           │
│ [ Cancel pending change ]                 │
└───────────────────────────────────────────┘
```

## Admin verify-shop layout (§C)

**Initial approval (registration flow — extends SHOP-LOCATION-REQUIRED §D):**
```
┌───────────────────────────────────────────┐
│ Shop location verification                │
│                                           │
│ Owner typed (Shop address field)          │
│ 16663 Chesterfield Farms Drive,           │
│ Ballwin MO 63005                          │
│                                           │
│ Pin resolves to (reverse-geocoded)        │
│ 16663 Chesterfield Farms Drive,           │
│ Ballwin, 63005                            │
│ 📍 38.6018, -90.5460                      │
│ Source: typed address                     │
│ [ Verify on map ↗ ]                       │
│                                           │
│ ☐ I verified this shop's location         │
│                                           │
│ [ Reject ]      [ Approve shop ]          │
└───────────────────────────────────────────┘
```

**Mismatch case (visual catch — same screen layout, different content):**
```
│ Owner typed                                │
│ 16663 Chesterfield Farms Drive,           │
│ Ballwin MO 63005                          │
│                                           │
│ Pin resolves to                           │
│ Sector 12, Faridabad, Haryana             │
│ 📍 28.5605, 77.2065                       │
│ Source: device GPS                        │
│ [ Verify on map ↗ ]                       │
│                                           │
│ ⚠️ Typed address and pin resolve to       │
│   different cities. Likely fallback-      │
│   location bug — reject and ask owner     │
│   to re-capture using 'Find from address'.│
```

**Pending-change approval (new screen entry — extends ShopDetailManagementScreen):**
```
┌───────────────────────────────────────────┐
│ Pending location change                   │
│                                           │
│ Current pin (live)                        │
│ 📍 38.6018, -90.5460                      │
│ Resolves to: Ballwin, 63005               │
│ Verified Jun 2 by admin@...               │
│                                           │
│ Proposed pin                              │
│ 📍 38.6019, -90.5461                      │
│ Resolves to: Ballwin, 63005               │
│ Source: device GPS                        │
│ Submitted Jun 3, 14:23 by owner           │
│                                           │
│ Distance between pins: 12 meters          │
│ [ Verify proposed on map ↗ ]              │
│                                           │
│ [ Reject change ]   [ Approve change ]    │
└───────────────────────────────────────────┘
```

---

## Plan

### §A.1 — Local state in RegisterShop (replace `useLocationStore` for shop pin)

`useLocationStore` is conceptually the customer's location for browse/checkout. RegisterShop was reusing it for the shop's location — which works only when owner = at-shop + GPS-on. The address-geocode path makes this conflation worse (a geocode would overwrite the customer's browse-side location).

**Replace** `const location = useLocationStore(s => s.location)` + `const locationSource = useLocationStore(s => s.source)` with a local state:

```tsx
type CapturedShopLocation = {
  lat: number;
  lng: number;
  source: 'gps' | 'geocoded';
  resolvedAddress: string; // reverse-geocoded for the success card
};

const [capturedShopLocation, setCapturedShopLocation] =
  useState<CapturedShopLocation | null>(null);
const [capturing, setCapturing] = useState(false);
const [captureError, setCaptureError] = useState<string | null>(null);
```

Submit reads from `capturedShopLocation`, not the store.

### §A.2 — Two capture handlers

```tsx
const handleUseMyGPS = async () => {
  setCapturing(true);
  setCaptureError(null);
  try {
    const result = await locationService.getCurrentLocation();
    if (result.source === 'fallback') {
      setCaptureError(
        'Your phone returned a default location — location ' +
          'permission is OFF or GPS is disabled. Open Settings to grant ' +
          'location permission and try again, OR use "Find from address".',
      );
      return;
    }
    const resolved = await reverseGeocodeLabel({
      lat: result.location.lat,
      lng: result.location.lng,
    });
    setCapturedShopLocation({
      lat: result.location.lat,
      lng: result.location.lng,
      source: 'gps',
      resolvedAddress: formatResolvedAddress(resolved),
    });
  } catch (e: any) {
    setCaptureError(e?.message ?? 'Could not capture location. Try again.');
  } finally {
    setCapturing(false);
  }
};

const handleFindFromAddress = async () => {
  if (!address.trim()) {
    setCaptureError('Type your shop address first, then tap "Find from address".');
    return;
  }
  setCapturing(true);
  setCaptureError(null);
  try {
    const results = await Location.geocodeAsync(address.trim());
    if (results.length === 0) {
      setCaptureError(
        'Address not found. Try a more specific address (include ' +
          'city + state/zip), or use "📍 Use my GPS" if you\'re at the shop.',
      );
      return;
    }
    const r = results[0];
    const resolved = await reverseGeocodeLabel({
      lat: r.latitude,
      lng: r.longitude,
    });
    setCapturedShopLocation({
      lat: r.latitude,
      lng: r.longitude,
      source: 'geocoded',
      resolvedAddress: formatResolvedAddress(resolved),
    });
  } catch (e: any) {
    setCaptureError(e?.message ?? 'Geocode failed. Try again.');
  } finally {
    setCapturing(false);
  }
};
```

### §A.3 — Pure helper: `formatResolvedAddress`

`src/utils/formatResolvedAddress.ts`:

```ts
/**
 * PR-NEXT-SHOP-LOCATION-EDIT — pretty-print a `GeocodeSuggestion`
 * (from `reverseGeocodeLabel`) into a single human-readable line
 * suitable for the RegisterShop / ShopSettings success card and
 * the admin "Pin resolves to" comparison.
 *
 * Empty / missing parts are skipped cleanly. Returns "Unknown
 * location" when nothing meaningful resolves (rural rural pin,
 * Pacific Ocean, etc.).
 *
 * Pinned by tests/utils/formatResolvedAddress.test.ts.
 */
import type { GeocodeSuggestion } from './reverseGeocodeLabel';

export function formatResolvedAddress(g: GeocodeSuggestion): string {
  const parts = [g.line1, g.city, g.pincode].filter(
    p => typeof p === 'string' && p.trim().length > 0,
  );
  return parts.length > 0 ? parts.join(', ') : 'Unknown location';
}
```

Pin with **5 test cases**: full address, only city, only pincode, all empty → "Unknown location", whitespace-only parts skipped.

### §A.4 — Submit payload

`handleContinue` sends:

```ts
location: capturedShopLocation
  ? { lat: capturedShopLocation.lat, lng: capturedShopLocation.lng }
  : undefined,
locationSource: capturedShopLocation?.source, // 'gps' | 'geocoded'
```

`registerShop` server-side accepts the new optional `locationSource`. If present, stamp `shop.locationSource` on the pending doc. If missing on a back-compat caller, default to `'gps'`.

### §B.1 — ShopSettings Location section

Add a new section to `src/screens/shop/ShopSettingsScreen.tsx` between the existing settings cards. Component layout per the §B mockup above. Uses the same two handler functions as RegisterShop §A.2 — extract them into a shared hook `useCaptureShopLocation()`:

`src/hooks/useCaptureShopLocation.ts`:

```ts
/**
 * PR-NEXT-SHOP-LOCATION-EDIT — shared capture-shop-location hook
 * reused by RegisterShop + ShopSettings. Encapsulates the GPS +
 * geocode + reverse-geocode flow into a single state object so the
 * two surfaces stay in lockstep (single source of truth for the
 * success-card UX).
 */
import { useState, useCallback } from 'react';
import * as Location from 'expo-location';
import { locationService } from '../services/locationService';
import { reverseGeocodeLabel } from '../utils/reverseGeocodeLabel';
import { formatResolvedAddress } from '../utils/formatResolvedAddress';

export type CapturedShopLocation = {
  lat: number;
  lng: number;
  source: 'gps' | 'geocoded';
  resolvedAddress: string;
};

export type CaptureState = {
  captured: CapturedShopLocation | null;
  capturing: boolean;
  error: string | null;
};

export function useCaptureShopLocation() {
  const [state, setState] = useState<CaptureState>({
    captured: null,
    capturing: false,
    error: null,
  });

  const captureGps = useCallback(async () => { /* §A.2 GPS handler */ }, []);
  const captureFromAddress = useCallback(async (address: string) => {
    /* §A.2 geocode handler */
  }, []);
  const reset = useCallback(() => {
    setState({ captured: null, capturing: false, error: null });
  }, []);

  return { ...state, captureGps, captureFromAddress, reset };
}
```

### §B.2 — Submit pending location change

New callable `submitPendingShopLocation`:

```ts
// functions/src/pendingShopLocationHelpers.ts
export async function submitPendingShopLocationPure(args: {
  shopId: string;
  callerUid: string;
  newLocation: { lat: number; lng: number };
  newLocationSource: 'gps' | 'geocoded';
  db: admin.firestore.Firestore;
}): Promise<Result<{ ok: true }, 'shop_not_found' | 'not_owner' | 'invalid_coords' | 'identical_to_current'>> {
  // 1. Read shops/{shopId}
  // 2. Verify ownerUid === callerUid
  // 3. Validate lat/lng (range checks — reuse validateShopLocationForApproval)
  // 4. Reject if newLocation is byte-identical to current location (nothing to approve)
  // 5. Write pendingLocation + pendingLocationSource + pendingLocationSubmittedAt + pendingLocationStatus: 'pending'
  // 6. Notify admins via pushToAdmins('Shop location change requested', shopId)
}
```

Pin with **6 tests** including validateShopLocationForApproval reuse for invalid coords.

Register the callable, IAM-verify post-deploy.

### §B.3 — Cancel pending change

New callable `cancelPendingShopLocation`:

```ts
// Owner-side cancel before admin acts. Clears the pendingLocation fields.
// Auth: must be ownerUid. Doesn't notify admin (they'll just see the
// queue item disappear).
```

Pin with **3 tests**.

### §C.1 — Admin verify-shop screen — reverse-geocode the pin

In `src/screens/admin/ShopRegistrationDetailScreen.tsx`:

1. On mount, if `shop.location` is present, kick off `reverseGeocodeLabel({lat, lng})` and cache the result in local state.
2. Render the §C mockup layout — owner-typed address (from `shop.address`) above, reverse-geocoded resolution below.
3. Show "Source: typed address" / "Source: device GPS" / "Source: pending review" based on `shop.locationSource`.

No automated mismatch detection — admin's eye catches it via the side-by-side layout. Comment block explains why we didn't add automated comparison.

### §C.2 — Pending-location approval surface

New screen entry — extend `ShopDetailManagementScreen.tsx` with a "Pending location change" section that renders when `shop.pendingLocationStatus === 'pending'`. Layout per §C "Pending-change" mockup. Two new callables:

- `approvePendingShopLocation` — admin-only. Atomic: shop.location ← shop.pendingLocation, clear pending fields, stamp `locationVerifiedAt` + `locationVerifiedBy`. Notify owner via push. (5 tests)
- `rejectPendingShopLocation` — admin-only. Clears pending fields with optional reason. Notify owner via push. (3 tests)

`distanceBetweenPins` pure helper for the admin display:

```ts
// src/utils/distanceBetweenPins.ts
import { haversineKm } from './distance';
export function distanceBetweenPins(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): { meters: number; label: string } {
  const km = haversineKm(a, b);
  const m = km * 1000;
  if (m < 1) return { meters: m, label: 'Same location' };
  if (m < 1000) return { meters: m, label: `${Math.round(m)} meters` };
  return { meters: m, label: `${km.toFixed(1)} km` };
}
```

Pin with **5 tests** including sub-meter sentinel.

### §D — Schema additions

`src/types/index.ts` Shop:

```ts
// PR-NEXT-SHOP-LOCATION-EDIT — capture source of the live pin.
// Stamped at registerShop / approvePendingShopLocation time.
// Optional / back-compat: legacy shops predate this field; admin UI
// shows "Source: unknown" in that case.
locationSource?: 'gps' | 'geocoded' | null;
// Owner's proposed location change, pending admin re-approval.
// All four fields written together via submitPendingShopLocation
// and cleared together via approve/reject/cancel. Customers do
// NOT read these — the live `location` stays authoritative until
// approval flips it.
pendingLocation?: { lat: number; lng: number } | null;
pendingLocationSource?: 'gps' | 'geocoded' | null;
pendingLocationSubmittedAt?: number | null;
pendingLocationStatus?: 'pending' | null;
```

All optional / nullable. Firestore rules need a small update: pending-location fields writable by `request.auth.uid === resource.data.ownerUid` (in addition to admin) so the owner can submit / cancel.

### §E — Reuse HOTFIX-FALLBACK-LEAK's posture in ShopSettings

The ShopSettings edit flow uses the same `useCaptureShopLocation` hook, which embeds the fallback check. No additional hardening needed — the hook is the single source of truth for "did we get a real capture or a mock?"

---

## Discipline checklist

1. **Rule 1** — every new import + state + handler carries "PR-NEXT-SHOP-LOCATION-EDIT — DO NOT REMOVE" comments.
2. **Rule 2** — useStates + the new hook's state sit with other top-level hooks above any conditional return.
3. **Rule 5** — schema audit-grep table in header; `locationSource` / `pendingLocation*` fields are net-new additions with explicit type signatures + Firestore rules updated.
4. **Rule 7** — test fixtures for `submitPendingShopLocation` + approval callables use `ownerUid` (matches actual production schema; check via grep before fixture write).
5. **Rule 11** — IAM verify on all 4 affected services: `registerShop`, `approveShop`, `submitPendingShopLocation`, `approvePendingShopLocation`, `rejectPendingShopLocation`, `cancelPendingShopLocation` (6 total). Cloud Run `allUsers` strip recurring hazard.
6. **Rule 13** — no new bottom-anchored modals; ShopSettings edit surface is an in-page section, not a sheet.
7. **Rule 14** (Validator-Result for server-side gates — was added post-SHOP-LOCATION-REQUIRED) — all new pure helpers return discriminated-union Results.
8. **Schema-additive only** — 5 new optional / nullable fields on Shop. Legacy shops render cleanly via "Source: unknown" + no pending change.
9. **Test discipline** — 5 (formatResolvedAddress) + 6 (submitPendingShopLocation gate) + 3 (cancelPendingShopLocation gate) + 5 (approvePendingShopLocation gate) + 3 (rejectPendingShopLocation gate) + 5 (distanceBetweenPins) = **+27 tests minimum**. Suite trajectory roughly 1299 → 1326.

---

## Acceptance checklist

**RegisterShop — GPS path (§A):**

1. Open RegisterShop on a device with location permission granted. Type address. Tap "📍 Use my GPS". Success card appears: ✅ Pin set (device GPS) + reverse-geocoded resolution + lat/lng.
2. Tap "↻ Re-capture". Card disappears. Re-tap "📍 Use my GPS" — re-captures cleanly.
3. Toggle location permission to denied via system Settings. Tap "📍 Use my GPS". Error message: "Your phone returned a default location… use 'Find from address'." No card. Submit stays disabled (HOTFIX-FALLBACK-LEAK posture preserved).

**RegisterShop — geocode path (§A):**

4. Tap "🔍 Find from address" with empty address field. Error: "Type your shop address first."
5. Type "16663 Chesterfield Farms Drive, Ballwin MO 63005". Tap "🔍 Find from address". Success card: ✅ Pin set (typed address) + resolved address + lat/lng matching Ballwin.
6. Type a garbage address "asdfqwerty". Tap geocode. Error: "Address not found. Try a more specific address…" No card.
7. Submit → registration goes through with `locationSource: 'geocoded'` stamped on the pending shop doc.

**ShopSettings — edit + pending (§B):**

8. Sign in as shop owner of an active shop. Open ShopSettings → Location section. Shows current pin + reverse-geocoded resolution + "Verified by admin on …".
9. Tap "🔍 Find from address" with a slightly different address. Pin updates locally. Tap Save. Server returns success. Pending state appears: ⏳ Pending admin approval + proposed pin + resolved address + "Submitted …".
10. Live pin (visible to customers via ShopList) is UNCHANGED. Verify by signing in as a customer in another session — see the original pin.
11. Tap "Cancel pending change". Pending state clears immediately. Stable state returns.
12. **Negative — submit identical pin** — submit the same lat/lng currently stamped. Server returns `identical_to_current`. Owner sees clean error.

**Admin — initial registration approval (§C):**

13. Sign in as admin. Open a pending shop with location. Side-by-side: Owner typed address + Pin resolves to (reverse-geocoded) + lat/lng + "Source: typed address" tag + Verify on map link.
14. Tap "Verify on map" → opens Google Maps to the pin.
15. Check "I verified this shop's location" → Approve button enables. Approve → shop status flips to active. `locationVerifiedAt` + `locationVerifiedBy` stamped.
16. **Mismatch case** — manually edit a pending shop's `address` to "16663 Chesterfield Farms Drive, Ballwin MO" but the `location` to Faridabad coords. Open ShopRegistrationDetail. The visual side-by-side immediately shows mismatch (Ballwin in typed address row, Faridabad in pin resolves row). Reject → owner re-submits via the new flow.

**Admin — pending-location approval (§C):**

17. After test #9 above, sign in as admin. Open the shop's management screen. New "Pending location change" section visible. Shows current + proposed pins, both resolved addresses, distance between, Verify proposed on map link.
18. Tap Approve change → server atomic move: `shop.location` ← `shop.pendingLocation`, pending fields cleared, `locationVerifiedAt`/`By` re-stamped. Owner gets push notification.
19. Tap Reject change → pending fields cleared with optional reason. Owner gets push notification with the reason.

**Cloud Run IAM (Rule 11):**

20. After deploy, on all 6 services:

```
foreach ($svc in 'registershop','approveshop','submitpendingshoplocation','approvependingshoplocation','rejectpendingshoplocation','cancelpendingshoplocation') {
  gcloud run services get-iam-policy $svc --region asia-south1 --project=grocery-mvp-dev
}
```

Verify `allUsers / roles/run.invoker` on each. Add binding if missing.

**Test suite:**

21. `npx tsc --noEmit` clean (root + functions). `npm run test:unit` clean. `npm run test:full` clean. Suite +27 minimum.

---

## Out of scope (recap)

- Interactive map / draggable pin (`react-native-maps`).
- Automated address-mismatch detection (visual side-by-side handles it for pilot).
- Backfill of legacy shops' `locationSource` field (left as `null` — admin UI shows "Source: unknown" which is honest).
- Email notification to admin on pending-location submit (push is enough for pilot).
- Multi-pending-edit queue (only one pending change per shop at a time; submitting a second clears the first).

---

## Deploy

**Step 1 — server first**

```
cd functions
npm run build
firebase deploy --only "functions:registerShop,functions:approveShop,functions:submitPendingShopLocation,functions:cancelPendingShopLocation,functions:approvePendingShopLocation,functions:rejectPendingShopLocation"
firebase functions:list | findstr -i "registershop approveshop submitpendingshoplocation cancelpendingshoplocation approvependingshoplocation rejectpendingshoplocation"
```

**Step 2 — IAM verify** (mandatory; Rule 11) per acceptance step 20.

**Step 3 — Firestore rules update** (small):

```
// In firestore.rules, allow owner to write pending-location fields
// on their own shop. Existing admin write rule stays.
match /shops/{shopId} {
  allow update: if isOwnerOfShop(shopId) &&
                    onlyChangesAllowedPendingLocationFields(request);
}
```

Deploy: `firebase deploy --only firestore:rules`.

**Step 4 — client OTA**

```
npx tsc --noEmit
npm run test:unit
eas update --branch production --message "PR-NEXT-SHOP-LOCATION-EDIT dual-mode capture + edit + admin re-approval"
```

## Doc trail

- `docs/TESTING-FINDINGS-2026-05-30.md` — append June 2 observation (US friend's shop, Faridabad pin) → `✅ SHIPPED in PR-NEXT-SHOP-LOCATION-EDIT`. Cross-reference HOTFIX-FALLBACK-LEAK (the immediate stopgap).
- `.windsurf/code-discipline.md` — Rule 5 extension: "schema audit-grep must also cover behavior at call sites when the field is missing / null / nonconforming". The MOCK_USER_LOCATION leak is the worked example.
- `docs/SESSION_LOG.md` — one paragraph.
- `CLAUDE.md` — bump date.
