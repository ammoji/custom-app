# PR-NEXT-PARTNER-CARD.2 — Real partner-detail redesign: live ETA + trust signals + working phone reveal

**Source:** Sudhir's June 1 retest of PARTNER-CARD.1. Two bugs (one mine) + a meta-design request: *"are we showing meaningful information here or these are just placeholders? It should give some live tracking options, delivery partner other details that can help customer etc. So please design solution that is really meaningful and helpful."*

This PR replaces the iterative patch trajectory (PARTNER-CARD → PARTNER-CARD.1 → PARTNER-CARD.2) with the **real** sheet — designed from the customer's question, not from "fields we happen to have." Single combined PR. No follow-up expected.

**Schema audit-grep** (Rule 5, schema verification — applied because PARTNER-CARD.1's bug came from skipping this):

| Field referenced | Confirmed location | Notes |
| --- | --- | --- |
| `order.customerUid` | `functions/src/index.ts:768,786,1063,1268,1348,1604,2482,…` (10+ sites) | **NOT `customerId`** — this was PARTNER-CARD.1's bug |
| `order.deliveryPersonId` | order doc | set by `claimDelivery` |
| `order.deliveryPersonName` | order doc | denormalized at claim time (PR-NEXT-13a) |
| `order.deliveryLocation` | order doc | locked drop pin (PR 46) |
| `order.shopLocation` | order doc | locked shop pin (PR 49) |
| `order.deliveryDistanceKm` / `deliveryDurationMin` | order doc | at-order static estimate (PR 46) |
| `users/{uid}.currentLocation` + `currentLocationUpdatedAt` | written by `reportDeliveryLocation` callable (`functions/src/index.ts:4334`) | foreground-only on partner side |
| `users/{uid}.deliveryRatingAvg` / `deliveryRatingCount` | PR 42.1 | partner-side rating |
| `users/{uid}.vehicleType` | already in `deliveryRequestHelpers.ts` validator (`'motorbike' \| 'bicycle' \| 'on_foot' \| 'car'`) | NOT denormalized to order |
| `users/{uid}.displayName` | the canonical name field | already denormalized at claim time |

Out-of-scope schema additions: none. All data already exists; the PR is plumbing + presentation.

**Deploy class:** **server-first** (4 callables: 1 new, 3 modified) → IAM verify all 4 → client OTA.

**Read first**

1. `CLAUDE.md`
2. `.windsurf/code-discipline.md` Rules 1, 2, 11, 13 (BottomSheet)
3. `docs/pr-next-hotfix-7-bottom-sheet-safearea-windsurf-prompt.md` — this PR assumes HOTFIX-7's `BottomSheet` is shipped or shipping in parallel
4. `functions/src/index.ts:3654-3700` — `claimDelivery`'s existing denormalization block (the spot we extend)
5. `functions/src/index.ts:4317-4400` — `reportDeliveryLocation` for the partner-location read shape
6. `src/components/order/PartnerDetailsSheet.tsx` — the sheet to redesign (replace, don't patch)
7. `src/screens/OrderDetailScreen.tsx:880-900` — sheet wiring site
8. `src/utils/distance.ts` — `haversineKm` helper (reused)

---

## Design lens — customer's question, not data fields

When a worried customer with hot food on the way taps "Your delivery partner," they're asking five things in this order:

| # | Question | Surface in sheet |
| --- | --- | --- |
| 1 | Who's bringing my groceries? | Avatar + name + rating + delivery count |
| 2 | Where are they? | Live distance, refreshed every 30s |
| 3 | When will they get here? | Live ETA in minutes from NOW |
| 4 | How do I reach them? | Tap-to-call (post-pickup) |
| 5 | What will they look like? | Vehicle icon next to state |

Out-of-scope for pilot (each with cost rationale):

- **Live map with moving partner pin** — requires `react-native-maps` + Google Maps API + native rebuild + recurring API spend + iOS provisioning. Defer until pilot signal explicitly demands it (a customer says "I want to see the dot move").
- **Partner profile photo** — no upload flow exists; initials avatar carries the recognition load adequately.
- **In-app messaging** — `tel:` reveal covers urgent contact. SMS / in-app chat is post-pilot.
- **Live moving distance bar** — same as map; defer.

---

## Sheet layout (top to bottom)

```
┌─────────────────────────────────────┐
│              ━━━━                   │  ← handle bar (BottomSheet)
│                                     │
│   ┌─────┐                           │
│   │ RB  │  Rahul Bhat               │  ← WHO
│   └─────┘  ⭐ 4.8 · 142 deliveries   │
│                                     │
│   🛵 On the way to you              │  ← STATE (vehicle icon + status)
│ ─────────────────────────────────── │
│                                     │
│   Arriving in            ~6 min     │  ← WHEN  (live; refreshes 30s)
│   Distance               1.2 km     │  ← WHERE (live; refreshes 30s)
│   Picking up at        US Shoppers  │
│   Order               #5677-714     │
│                                     │
│ ─────────────────────────────────── │
│                                     │
│   [   📞  Call Rahul   ]            │  ← REACH (post-pickup only)
│                                     │
│   [        Close        ]           │
└─────────────────────────────────────┘
```

**Variants:**
- Pre-pickup: state line shows `"🛵 Heading to the shop"`; WHEN line shows `"Picks up in ~X min"` (live ETA from partner → shop); phone reveal hidden, replaced with muted `"Phone shared once order is picked up"` row.
- Stale partner location (`currentLocationUpdatedAt` > 2 min ago): show static fallback values from `order.deliveryDistanceKm` / `deliveryDurationMin` with a muted `"~ estimated"` suffix. No fake "live" indication.
- Partner has 0 deliveries / no rating: substitute `"⭐ New partner · welcome them!"` for the rating line. Don't show "⭐ 0.0 · 0 deliveries" (looks broken / off-putting).
- Co-located test data (Sudhir's case — distance is 0 km): WHEN line shows `"Almost there"`, distance row hidden. ETA `< 1 min` → `"Arriving now"`.

---

## Plan

### §A — Pure helper: `formatLivePartnerEta`

`src/utils/formatLivePartnerEta.ts`:

```ts
/**
 * PR-NEXT-PARTNER-CARD.2 — pure formatter for the partner sheet's
 * live distance + ETA rows. Centralizes the edge-case copy so the
 * sheet itself stays declarative. Pinned by tests/utils/
 * formatLivePartnerEta.test.ts.
 */

export type LiveEtaInput = {
  distanceKm: number | null;
  etaMin: number | null;
  stale: boolean;            // partner location > 2 min old
  isPickedUp: boolean;       // pre/post pickup affects copy
};

export type LiveEtaDisplay = {
  whenLabel: string;         // "Arriving in" / "Picks up in"
  whenValue: string;         // "~6 min" / "Almost there" / "Arriving now"
  distanceValue: string | null;  // "1.2 km" / null to hide row
  estimatedSuffix: boolean;  // true → show "~ estimated" suffix
};

export function formatLivePartnerEta(input: LiveEtaInput): LiveEtaDisplay {
  const whenLabel = input.isPickedUp ? 'Arriving in' : 'Picks up in';

  // Distance display
  let distanceValue: string | null = null;
  if (
    typeof input.distanceKm === 'number' &&
    Number.isFinite(input.distanceKm) &&
    input.distanceKm > 0.05  // < 50m → hide row; "Almost there" carries it
  ) {
    distanceValue =
      input.distanceKm < 1
        ? `${Math.round(input.distanceKm * 1000)} m`
        : `${input.distanceKm.toFixed(1)} km`;
  }

  // ETA display
  let whenValue: string;
  if (
    typeof input.etaMin !== 'number' ||
    !Number.isFinite(input.etaMin) ||
    input.etaMin < 0
  ) {
    whenValue = '—';
  } else if (input.etaMin < 1) {
    whenValue = input.isPickedUp ? 'Arriving now' : 'Almost there';
  } else if (input.etaMin < 60) {
    whenValue = `~${Math.round(input.etaMin)} min`;
  } else {
    whenValue = `~${(input.etaMin / 60).toFixed(1)} hr`;
  }

  return {
    whenLabel,
    whenValue,
    distanceValue,
    estimatedSuffix: input.stale,
  };
}
```

Pin with **8 test cases**: live + pre-pickup, live + post-pickup, stale → estimated, ETA <1 min (pre + post), distance <50m hides, distance <1km → "X m", distance ≥1km → "X.X km", ETA >60min → "X.X hr".

### §B — Pure helper: `formatPartnerTrust`

`src/utils/formatPartnerTrust.ts`:

```ts
/**
 * PR-NEXT-PARTNER-CARD.2 — formatter for the WHO line. Maps
 * (rating, count, vehicleType) → display strings + glyphs.
 * Pinned by tests/utils/formatPartnerTrust.test.ts.
 */

export type PartnerTrustInput = {
  ratingAvg: number | null;
  ratingCount: number | null;
  vehicleType: 'motorbike' | 'bicycle' | 'on_foot' | 'car' | null;
};

export type PartnerTrustDisplay = {
  trustLine: string;         // "⭐ 4.8 · 142 deliveries" / "⭐ New partner · welcome them!"
  vehicleIcon: string;       // "🛵" / "🚲" / "🚶" / "🚗" / "🛵" fallback
  vehicleLabel: string;      // "motorbike" / "bicycle" / "on foot" / "car"
};

const VEHICLE_ICON: Record<string, string> = {
  motorbike: '🛵',
  bicycle: '🚲',
  on_foot: '🚶',
  car: '🚗',
};

const VEHICLE_LABEL: Record<string, string> = {
  motorbike: 'motorbike',
  bicycle: 'bicycle',
  on_foot: 'on foot',
  car: 'car',
};

export function formatPartnerTrust(input: PartnerTrustInput): PartnerTrustDisplay {
  const vehicleIcon = input.vehicleType
    ? VEHICLE_ICON[input.vehicleType] ?? '🛵'
    : '🛵';
  const vehicleLabel = input.vehicleType
    ? VEHICLE_LABEL[input.vehicleType] ?? 'motorbike'
    : 'motorbike';

  if (
    typeof input.ratingCount !== 'number' ||
    input.ratingCount <= 0 ||
    typeof input.ratingAvg !== 'number' ||
    !Number.isFinite(input.ratingAvg)
  ) {
    return {
      trustLine: '⭐ New partner · welcome them!',
      vehicleIcon,
      vehicleLabel,
    };
  }

  const stars = input.ratingAvg.toFixed(1);
  const delivLabel = input.ratingCount === 1 ? '1 delivery' : `${input.ratingCount} deliveries`;
  return {
    trustLine: `⭐ ${stars} · ${delivLabel}`,
    vehicleIcon,
    vehicleLabel,
  };
}
```

Pin with **6 cases**: full data, missing rating, missing count, vehicle null, vehicle unknown value, singular "1 delivery."

### §C — New callable `getLivePartnerEta`

`functions/src/livePartnerEtaHelpers.ts`:

```ts
/**
 * PR-NEXT-PARTNER-CARD.2 — server gate for revealing the partner's
 * current live distance + ETA to the order's customer. Same posture
 * as getDeliveryPartnerContact: customer-only, order must have a
 * partner assigned, partner currentLocation must be present.
 *
 * Pre-pickup: distance = partner → shop. ETA = haversine / avg
 * urban speed.
 * Post-pickup: distance = partner → drop. ETA = same formula.
 *
 * "Stale" flag set when `currentLocationUpdatedAt` > 2 min old.
 * Client treats stale as estimated-only and shows the muted
 * "~ estimated" suffix.
 *
 * NO fallback to static order.deliveryDurationMin here — that's
 * the client's job (this callable returns null fields when the
 * gate fails so the client can fall back cleanly).
 */
import * as admin from 'firebase-admin';
import { haversineKm } from './geoHelpers'; // existing
import type { Result } from './validatorResult';

const AVG_URBAN_KMH = 20; // pilot constant; matches Distance Matrix
const STALE_AFTER_MS = 2 * 60 * 1000;

export type LivePartnerEtaResult = Result<{
  distanceKm: number;
  etaMin: number;
  stale: boolean;
  lastUpdatedAtMs: number;
}>;

export async function getLivePartnerEtaPure(args: {
  orderId: string;
  callerUid: string;
  db: admin.firestore.Firestore;
  nowMs?: number; // injectable for tests
}): Promise<LivePartnerEtaResult | Result<never, 'order_not_found' | 'not_customer' | 'no_partner' | 'no_partner_location' | 'no_drop_or_shop_location'>> {
  const now = args.nowMs ?? Date.now();

  const orderSnap = await args.db.collection('orders').doc(args.orderId).get();
  if (!orderSnap.exists) return { ok: false, code: 'order_not_found' };
  const order = orderSnap.data() as any;

  // SCHEMA-CONFIRMED: order.customerUid (NOT customerId — that was
  // PARTNER-CARD.1's bug). Audit-grep in prompt header.
  if (order?.customerUid !== args.callerUid) {
    return { ok: false, code: 'not_customer' };
  }
  if (typeof order?.deliveryPersonId !== 'string' || order.deliveryPersonId.length === 0) {
    return { ok: false, code: 'no_partner' };
  }

  const partnerSnap = await args.db.collection('users').doc(order.deliveryPersonId).get();
  const partner = partnerSnap.data() as any;
  const partnerLoc = partner?.currentLocation;
  if (
    !partnerLoc ||
    typeof partnerLoc.lat !== 'number' ||
    typeof partnerLoc.lng !== 'number'
  ) {
    return { ok: false, code: 'no_partner_location' };
  }
  const updatedAt = partner?.currentLocationUpdatedAt;
  const updatedMs =
    updatedAt instanceof admin.firestore.Timestamp
      ? updatedAt.toMillis()
      : typeof updatedAt === 'number'
      ? updatedAt
      : 0;
  const stale = now - updatedMs > STALE_AFTER_MS;

  // Pre/post pickup target
  const isPickedUp = order?.pickedUpAt != null;
  const target = isPickedUp ? order?.deliveryLocation : order?.shopLocation;
  if (
    !target ||
    typeof target.lat !== 'number' ||
    typeof target.lng !== 'number'
  ) {
    return { ok: false, code: 'no_drop_or_shop_location' };
  }

  const distanceKm = haversineKm(
    { lat: partnerLoc.lat, lng: partnerLoc.lng },
    { lat: target.lat, lng: target.lng },
  );
  const etaMin = (distanceKm / AVG_URBAN_KMH) * 60;

  return {
    ok: true,
    value: {
      distanceKm,
      etaMin,
      stale,
      lastUpdatedAtMs: updatedMs,
    },
  };
}
```

In `functions/src/index.ts` register the callable (same shape as `getDeliveryPartnerContact`):

```ts
export const getLivePartnerEta = onCall(
  { region: 'asia-south1' },
  async req => {
    if (!req.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Sign in required.');
    }
    const orderId = String((req.data as any)?.orderId ?? '');
    if (orderId.length === 0) {
      throw new HttpsError('invalid-argument', 'orderId required.');
    }
    const result = await getLivePartnerEtaPure({
      orderId,
      callerUid: req.auth.uid,
      db: admin.firestore(),
    });
    if (!result.ok) {
      switch (result.code) {
        case 'order_not_found':
          throw new HttpsError('not-found', 'Order not found.');
        case 'not_customer':
          throw new HttpsError('permission-denied', 'Not your order.');
        case 'no_partner':
          throw new HttpsError('failed-precondition', 'No partner assigned yet.');
        case 'no_partner_location':
        case 'no_drop_or_shop_location':
          // Client falls back to static order.deliveryDurationMin.
          throw new HttpsError('failed-precondition', 'Live tracking not available; using estimate.');
      }
    }
    return result.value;
  },
);
```

Pin with **8 negative + 1 positive = 9 tests** against the pure helper.

### §D — Denormalize partner trust signals at `claimDelivery`

In `functions/src/claimDeliveryHelpers.ts` (or the inline block in `index.ts:3654-3700`), extend the existing displayName denormalization to also stamp:

```ts
// Existing:
order.deliveryPersonName = partner.displayName;

// PR-NEXT-PARTNER-CARD.2 additions — all optional / nullable so legacy
// claimed-before-this-PR orders that already shipped without these
// fields stay back-compat (sheet falls back to "New partner" copy).
order.deliveryPersonRating =
  typeof partner.deliveryRatingAvg === 'number' ? partner.deliveryRatingAvg : null;
order.deliveryPersonDeliveriesCount =
  typeof partner.deliveryRatingCount === 'number' ? partner.deliveryRatingCount : null;
order.deliveryPersonVehicleType =
  typeof partner.vehicleType === 'string' ? partner.vehicleType : null;
```

In `src/types/index.ts` `Order` type, add three optional fields next to `deliveryPersonName`:

```ts
deliveryPersonRating?: number | null;
deliveryPersonDeliveriesCount?: number | null;
deliveryPersonVehicleType?: 'motorbike' | 'bicycle' | 'on_foot' | 'car' | null;
```

All optional + nullable so a pre-PR-claimed order renders cleanly via the `"New partner"` fallback in `formatPartnerTrust`.

Pin denormalization with **4 tests** on a `denormalizePartnerTrust(partner)` extractor.

### §E — Fix the `customerId` → `customerUid` bug in `getDeliveryPartnerContact`

In `functions/src/partnerContactHelpers.ts` (the PARTNER-CARD.1 file):

```ts
// BEFORE (broken — PARTNER-CARD.1 bug):
if (order?.customerId !== args.callerUid) {
  return { ok: false, code: 'not_customer' };
}

// AFTER:
if (order?.customerUid !== args.callerUid) {
  return { ok: false, code: 'not_customer' };
}
```

Re-run the existing `tests/functions/getDeliveryPartnerContact.test.ts` test cases — the fixture's order shape needs `customerUid`, not `customerId`. Update fixtures to reflect the real schema.

### §F — Client: polling hook `useLivePartnerEta`

`src/hooks/useLivePartnerEta.ts`:

```ts
/**
 * PR-NEXT-PARTNER-CARD.2 — 30s polling hook for the partner sheet.
 * Auto-pauses when `enabled` is false (sheet dismissed) and resumes
 * on reopen. Battery-friendly: no polling when sheet is closed.
 *
 * Fallback policy: when the callable rejects with 'failed-precondition'
 * (no partner location / no drop location), the hook returns null for
 * distanceKm + etaMin and the sheet substitutes order.deliveryDistanceKm
 * + order.deliveryDurationMin with the "~ estimated" suffix.
 */
import { useEffect, useRef, useState } from 'react';
import { orderService } from '../services/orderService';

export type LivePartnerEtaState = {
  distanceKm: number | null;
  etaMin: number | null;
  stale: boolean;
  loading: boolean;
};

const REFRESH_MS = 30 * 1000;

export function useLivePartnerEta(
  orderId: string | null,
  enabled: boolean,
): LivePartnerEtaState {
  const [state, setState] = useState<LivePartnerEtaState>({
    distanceKm: null,
    etaMin: null,
    stale: false,
    loading: false,
  });
  const cancelled = useRef(false);

  useEffect(() => {
    if (!orderId || !enabled) return;
    cancelled.current = false;

    const tick = async () => {
      try {
        setState(s => ({ ...s, loading: true }));
        const data = await orderService.getLivePartnerEta(orderId);
        if (cancelled.current) return;
        setState({
          distanceKm: data.distanceKm,
          etaMin: data.etaMin,
          stale: data.stale,
          loading: false,
        });
      } catch {
        // failed-precondition → fall back path handled by sheet
        if (!cancelled.current) {
          setState(s => ({ ...s, loading: false }));
        }
      }
    };

    tick();
    const id = setInterval(tick, REFRESH_MS);
    return () => {
      cancelled.current = true;
      clearInterval(id);
    };
  }, [orderId, enabled]);

  return state;
}
```

Add the service method in `orderService.ts` mirroring `getDeliveryPartnerContact`'s shape (both native + web Firebase paths).

### §G — Redesigned `PartnerDetailsSheet`

Replace the body of `src/components/order/PartnerDetailsSheet.tsx`. Use the `BottomSheet` from HOTFIX-7 (no more hand-rolled `Modal` / `Pressable` / `useSafeAreaInsets`). Sheet body:

```tsx
import BottomSheet from '../common/BottomSheet';
import { initialsFor } from '../../utils/partnerInitials';
import { formatLivePartnerEta } from '../../utils/formatLivePartnerEta';
import { formatPartnerTrust } from '../../utils/formatPartnerTrust';

type Props = {
  visible: boolean;
  onClose: () => void;
  order: Pick<Order,
    'id'
    | 'shopName'
    | 'pickedUpAt'
    | 'deliveryPersonName'
    | 'deliveryPersonRating'
    | 'deliveryPersonDeliveriesCount'
    | 'deliveryPersonVehicleType'
    | 'deliveryDistanceKm'
    | 'deliveryDurationMin'
  >;
  partnerPhone: string | null;
  revealing: boolean;
  onRevealPhone: () => void;
  live: LivePartnerEtaState; // from useLivePartnerEta
};

export default function PartnerDetailsSheet({
  visible, onClose, order, partnerPhone, revealing, onRevealPhone, live,
}: Props) {
  const isPickedUp = order.pickedUpAt != null;
  const displayName =
    typeof order.deliveryPersonName === 'string' && order.deliveryPersonName.trim().length > 0
      ? order.deliveryPersonName.trim()
      : 'Your delivery partner';
  const initials = initialsFor(order.deliveryPersonName);
  const trust = formatPartnerTrust({
    ratingAvg: order.deliveryPersonRating ?? null,
    ratingCount: order.deliveryPersonDeliveriesCount ?? null,
    vehicleType: order.deliveryPersonVehicleType ?? null,
  });
  // Live values with static fallback when live is null.
  const eta = formatLivePartnerEta({
    distanceKm: live.distanceKm ?? order.deliveryDistanceKm ?? null,
    etaMin: live.etaMin ?? order.deliveryDurationMin ?? null,
    stale: live.stale || (live.distanceKm == null), // static fallback = estimated
    isPickedUp,
  });
  const stateText = isPickedUp
    ? `${trust.vehicleIcon} On the way to you`
    : `${trust.vehicleIcon} Heading to the shop`;

  return (
    <BottomSheet visible={visible} onClose={onClose} keyboardAvoid={false}>
      <View style={styles.who}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.name} numberOfLines={1}>{displayName}</Text>
          <Text style={styles.trust}>{trust.trustLine}</Text>
        </View>
      </View>
      <Text style={styles.state}>{stateText}</Text>
      <View style={styles.divider} />

      <Row label={eta.whenLabel} value={eta.whenValue} estimated={eta.estimatedSuffix} />
      {eta.distanceValue && (
        <Row label="Distance" value={eta.distanceValue} estimated={eta.estimatedSuffix} />
      )}
      <Row label={isPickedUp ? 'Picked up from' : 'Picking up at'} value={order.shopName ?? 'the shop'} />
      <Row label="Order" value={`#${order.id.slice(-8).toUpperCase()}`} />

      <View style={styles.divider} />

      {!isPickedUp ? (
        <Text style={styles.phoneMuted}>📞 Phone shared once order is picked up</Text>
      ) : partnerPhone ? (
        <Pressable
          onPress={() => Linking.openURL(`tel:${partnerPhone}`)}
          style={({ pressed }) => [styles.callBtn, pressed && { opacity: 0.85 }]}
          accessibilityRole="link"
          accessibilityLabel={`Call ${displayName} at ${partnerPhone}`}
        >
          <Text style={styles.callBtnText}>📞 Call {displayName.split(' ')[0]}</Text>
        </Pressable>
      ) : (
        <Pressable
          onPress={onRevealPhone}
          disabled={revealing}
          style={({ pressed }) => [
            styles.revealBtn,
            pressed && { opacity: 0.85 },
            revealing && { opacity: 0.6 },
          ]}
        >
          <Text style={styles.revealBtnText}>
            {revealing ? 'Loading…' : `📞 Show ${displayName.split(' ')[0]}'s phone`}
          </Text>
        </Pressable>
      )}

      <Pressable
        onPress={onClose}
        style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.85 }]}
        accessibilityRole="button"
      >
        <Text style={styles.closeBtnText}>Close</Text>
      </Pressable>
    </BottomSheet>
  );
}

function Row({ label, value, estimated }: { label: string; value: string; estimated?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1}>
        {value}{estimated ? <Text style={styles.estimatedSuffix}>  ~ estimated</Text> : null}
      </Text>
    </View>
  );
}
```

Style entries (mirror PARTNER-CARD.1's vocabulary; add `phoneMuted`, `callBtn`/`callBtnText`, `estimatedSuffix`).

### §H — Wire OrderDetailScreen

In `OrderDetailScreen.tsx`:

```tsx
const [partnerSheetOpen, setPartnerSheetOpen] = useState(false);
const [partnerPhone, setPartnerPhone] = useState<string | null>(null);
const [revealingPhone, setRevealingPhone] = useState(false);
const live = useLivePartnerEta(order.id, partnerSheetOpen);

// reset phone when order id changes
useEffect(() => { setPartnerPhone(null); }, [order.id]);

const revealPhone = useCallback(async () => {
  setRevealingPhone(true);
  try {
    const { phone } = await orderService.getDeliveryPartnerContact(order.id);
    setPartnerPhone(phone);
  } catch (e: any) {
    Alert.alert('Could not load phone', e?.message ?? 'Please try again.');
  } finally {
    setRevealingPhone(false);
  }
}, [order.id]);

// …

<PartnerDetailsSheet
  visible={partnerSheetOpen}
  onClose={() => setPartnerSheetOpen(false)}
  order={order}
  partnerPhone={partnerPhone}
  revealing={revealingPhone}
  onRevealPhone={revealPhone}
  live={live}
/>
```

`useLivePartnerEta(order.id, partnerSheetOpen)` is the auto-pause trick: polling only fires while sheet is open.

### §I — Vehicle type — already supported, just needs a UI surface

`vehicleType` already exists in `deliveryRequestHelpers.ts` validator. Confirm `DeliveryProfileScreen` (or whatever surface the partner uses to edit their profile post-onboarding) has an edit row for it. If not, add a simple picker (`'motorbike' | 'bicycle' | 'on_foot' | 'car'`). Default existing partners to `'motorbike'` via a one-time backfill — only if `users/{uid}.vehicleType` is unset AND `users/{uid}` has `isDelivery: true`. Document the backfill script (`scripts/backfill-partner-vehicle-type.ts`) — it's idempotent and skips already-set rows.

### §J — Cancel polling on order cancellation / delivery

`useLivePartnerEta` polls indefinitely while the sheet is open. The sheet itself dismisses on order completion if the customer closes it — but defensively: when `order.status` is `'cancelled'` or `'delivered'`, the parent shouldn't allow the sheet to open at all. The existing render guard in OrderDetailScreen already gates `PartnerIdentityCard` on `order.status !== 'cancelled'` — extend to also hide on `delivered`. Document in a comment.

---

## Discipline checklist

1. **Rule 1** — every new import in the redesigned sheet carries "PR-NEXT-PARTNER-CARD.2 — DO NOT REMOVE" comments.
2. **Rule 2** — `partnerSheetOpen`, `partnerPhone`, `revealingPhone`, `live` all sit with other top-level useStates above any conditional return.
3. **Rule 5** (new — schema verification) — schema audit-grep table in this prompt header proves field-name correctness for every doc field referenced. No `customerId` anywhere.
4. **Rule 11** — IAM verification after deploy on **all 4** callables: `getLivePartnerEta` (new), `getDeliveryPartnerContact` (modified), `claimDelivery` (modified), `saveDeliveryProfile` (if vehicleType edit added).
5. **Rule 13** — sheet uses `BottomSheet` (HOTFIX-7). No hand-rolled `Modal` + `paddingBottom` math.
6. **Schema-additive only** — 3 new optional/nullable fields on Order (`deliveryPersonRating`, `deliveryPersonDeliveriesCount`, `deliveryPersonVehicleType`). Legacy orders render cleanly via `"New partner"` fallback.
7. **Test discipline** — 8 (formatLivePartnerEta) + 6 (formatPartnerTrust) + 9 (getLivePartnerEta gate) + 4 (denormalizePartnerTrust) + 6 (fixed getDeliveryPartnerContact with customerUid) = **+33 tests**. Suite trajectory roughly 1241 → 1274.

---

## Acceptance checklist

**Identity (WHO):**

1. Place order, partner claims. Open OrderDetail → tap partner card. Sheet opens via `BottomSheet` (HOTFIX-7), bottom CTAs fully tappable on Android gesture-nav.
2. Sheet shows avatar with initials, name, "⭐ 4.8 · 142 deliveries" (or "⭐ New partner · welcome them!" if rating fields are null on the order).
3. State line shows vehicle icon matching `order.deliveryPersonVehicleType` (🛵 motorbike default).

**Where + when (LIVE):**

4. Partner opens their dashboard (triggers `reportDeliveryLocation` foreground write). Within ~30s the sheet auto-refreshes — "Arriving in" + "Distance" update to live values.
5. Co-located test (Sudhir's case) — distance is ~0 km. Sheet shows `"Almost there"` and hides the distance row. No `"0.0 km"` / `"~0 min"` visible.
6. Partner backgrounds their app for > 2 min. Sheet next refresh shows live values with `~ estimated` muted suffix (because `currentLocationUpdatedAt` is stale).
7. Pre-pickup: state line reads `"🛵 Heading to the shop"`, WHEN line label is `"Picks up in"`. Phone reveal hidden.
8. Post-pickup: state line reads `"🛵 On the way to you"`, WHEN line label is `"Arriving in"`. Phone reveal row visible.

**Reach (CONTACT):**

9. Post-pickup, tap `"📞 Show Rahul's phone"`. Spinner briefly. Returns `+91 XXX XXX XXXX` and CTA flips to `"📞 Call Rahul"`. Tap → native dialer opens.
10. **Regression of PARTNER-CARD.1 bug**: this used to fail with `"Not your order"` on every customer's own order. Now succeeds. (Triggered by §E `customerId` → `customerUid` fix.)
11. Close sheet, reopen — phone stays cached in component state. Only re-fetches when order id changes.

**Polling lifecycle:**

12. Open sheet → polling starts immediately, fetches once + every 30s.
13. Close sheet → polling stops (`useEffect` cleanup). Verify with Sentry/console — no callable hits past dismissal.
14. Reopen sheet → polling resumes with a fresh fetch.

**Legacy compatibility:**

15. Order claimed BEFORE this PR ships (no denormalized fields). Sheet shows `"⭐ New partner · welcome them!"` for trust line. `🛵` default vehicle. Static fallback ETA from `order.deliveryDurationMin` with `~ estimated` suffix. No red box, no error.

**Cloud Run IAM (Rule 11):**

16. After deploy, for each of the 4 callable surfaces (`getlivepartnereta`, `getdeliverypartnercontact`, `claimdelivery`, `savedeliveryprofile`):

    ```
    gcloud run services get-iam-policy <name> --region asia-south1
    ```

    Confirm `allUsers / roles/run.invoker`. Add binding if missing.

**Tests:**

17. `npx tsc --noEmit` clean (root + functions). `npm run test:unit` clean. `npm run test:full` clean (rules + emulator). Suite +33 from baseline.

---

## Out of scope

- **Live map with moving partner pin.** Defer until pilot signal explicitly demands it.
- **Partner profile photo upload.** No upload flow exists; initials avatar handles recognition.
- **In-app messaging.** `tel:` covers urgent contact.
- **Partner rating trend / review list.** Single rating average + count is enough trust signal for pilot.
- **Real driving-route ETA via Distance Matrix API.** AVG_URBAN_KMH constant + haversine is the pilot pragma — Distance Matrix is already built but DORMANT (PR 46 cost-guarantee). Flip when scale demands.
- **Partner shift-load awareness.** Don't show "Rahul is currently doing 3 deliveries."

---

## Deploy

**Step 1 — server first**

```
cd functions
npm run build
firebase deploy --only "functions:getLivePartnerEta,functions:getDeliveryPartnerContact,functions:claimDelivery,functions:saveDeliveryProfile"
firebase functions:list | findstr -i "getlivepartnereta getdeliverypartnercontact claimdelivery savedeliveryprofile"
```

**Step 2 — IAM verify (mandatory; Rule 11)** — per acceptance step 16, on all 4.

**Step 3 — one-time backfill (if vehicleType wasn't set on existing partners)**

```
node scripts/backfill-partner-vehicle-type.ts --dry-run
node scripts/backfill-partner-vehicle-type.ts
```

**Step 4 — client OTA**

```
npx tsc --noEmit
npm run test:unit
eas update --branch production --message "PR-NEXT-PARTNER-CARD.2 live ETA + trust signals + customerUid fix"
```

## Doc trail

- `docs/TESTING-FINDINGS-2026-05-30.md` — Case 6 sequence (PARTNER-CARD → PARTNER-CARD.1 → PARTNER-CARD.2) → close out with `✅ COMPLETE in PR-NEXT-PARTNER-CARD.2`, noting the customerUid bug fix from PARTNER-CARD.1.
- `.windsurf/code-discipline.md` — add Rule 5: schema verification (every prompt that references doc fields includes audit-grep in header).
- `docs/PROMPT_AUTHORING_NOTES.md` — add discipline tweaks 5 + 6 (schema-grep, pre-design check for UX surfaces).
- `docs/SESSION_LOG.md` — one paragraph.
- `CLAUDE.md` — bump date.
