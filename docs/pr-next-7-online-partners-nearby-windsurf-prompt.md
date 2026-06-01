# PR-NEXT-7 — "Online delivery partners nearby" trust badge on Shop Owner Dashboard

**Source:** Finding #9 in `docs/TESTING-FINDINGS-2026-05-30.md`.

**Deploy class:** server-first OTA. One new callable + one new client hook + a small UI chip on the existing `ShopOwnerDashboardScreen`. Ships in two steps:

1. `firebase deploy --only functions:getOnlinePartnersNearMyShop`
   then IAM verify (Cloud Run `allUsers` binding — recurring gotcha).
2. `eas update --branch production --message "PR-NEXT-7 partners-nearby badge"`

No `app.json` change, no native module change, no permission change.

**Read first**

1. `CLAUDE.md` (full)
2. `docs/TESTING-FINDINGS-2026-05-30.md` — finding #9
3. `.windsurf/code-discipline.md` (full — especially Rules 2, 3, 4, 11)
4. `.windsurf/deploy-discipline.md` — Cloud Run IAM verification section
5. `.windsurf/test-discipline.md`
6. `functions/src/notificationRadiusHelpers.ts` — `filterPartnersByNotificationRadius` + `PartnerRow` + `DEFAULT_PARTNER_NOTIFICATION_RADIUS_KM`. The whole point of PR-NEXT-7 is reusing this helper for a count surface.
7. `functions/src/onlineDeliveryCountHelpers.ts` — the existing admin-only pattern this PR mirrors.
8. `functions/src/index.ts` lines 3960–4030 — the `sendNewPickupPushToDelivery` trigger that the count must agree with (same query, same filter, same shape).
9. `functions/src/index.ts` lines 5693–5718 — the existing `getOnlineDeliveryCount` admin callable.
10. `src/hooks/useOnlineDeliveryCount.ts` — the polling-hook pattern this PR mirrors.
11. `src/screens/shop/ShopOwnerDashboardScreen.tsx` — the dashboard the badge sits on (insertion point around the `statsCard` block at line 292).

---

## Why this PR exists

Finding #9: shop owners have no visibility into whether anyone will actually pick up the orders they're about to accept and prepare. At 1-shop pilot scale that anxiety is real ("am I going to prepare 5 dishes and watch them go cold because no rider was online?"). A simple count — "**3 delivery partners online nearby**" — is the cheapest trust signal we can ship.

The signal must agree with reality. PR 50 already wired per-partner notification radius into the push fanout (`sendNewPickupPushToDelivery` calls `filterPartnersByNotificationRadius`), so the partners who would actually *receive* a push for a new order at this shop are a haversine-filtered subset of the total online count. Showing the unfiltered total would lie: "5 partners online" when only 1 of them is within their own notification radius of the shop would set the wrong expectation. So this PR's count must reuse the exact same filter as the push fanout — anything else creates a contradiction the moment a shop owner accepts an order and sees only 1 partner get notified.

Existing surface choices we deliberately are NOT touching:

- `getOnlineDeliveryCount` (admin-only, total online count) stays exactly as-is. AdminOrdersScreen depends on it; perturbing the callable's auth or shape would break that path.
- The push fanout itself (`sendNewPickupPushToDelivery`) is unchanged. It already does the filtering correctly.

---

## Plan

### §A — Server: new callable `getOnlinePartnersNearMyShop`

Files touched:

- `functions/src/nearbyPartnersCountHelpers.ts` (new) — §A.1
- `functions/src/index.ts` (new callable export) — §A.2
- `tests/functions/nearbyPartnersCountHelpers.test.ts` (new) — §A.3

#### §A.1 — Pure helper `computeNearbyOnlinePartnerCount`

Create `functions/src/nearbyPartnersCountHelpers.ts`. Mirrors the shape of `onlineDeliveryCountHelpers.ts` (the existing admin pattern) — splits auth-gating + projection from IO so the test can pin the contract without firebase-admin.

```ts
/**
 * PR-NEXT-7 (finding #9) — pure helper for `getOnlinePartnersNearMyShop`.
 *
 * Surfaces the count of online delivery partners who would actually
 * receive a push for a new order at the caller's shop. Reuses the
 * exact same eligibility filter (`filterPartnersByNotificationRadius`)
 * that `sendNewPickupPushToDelivery` applies on push-fanout, so the
 * badge can never disagree with reality (e.g. "5 partners online" →
 * shop accepts the order → only 1 partner pings: the contradiction
 * that finding #9 is trying to prevent at its core).
 *
 * Auth + projection happen here. The Cloud Function callable does
 * the Firestore reads (shop doc + online-partners query) and passes
 * the raw inputs in. That split lets the test inject fakes for both
 * fetches without spinning up the emulator. Same posture as
 * `computeOnlineDeliveryCount` (Phase 12c) and `projectPendingCounts`
 * (PR 41).
 */

import {
  filterPartnersByNotificationRadius,
  type PartnerRow,
} from './notificationRadiusHelpers';
import type { LatLng } from './distanceMatrixHelpers';

export type ShopOwnerClaims = {
  shopOwner?: boolean;
  shopId?: string;
} & Record<string, unknown>;

export type NearbyOnlinePartnerCountResult =
  | {
      ok: true;
      /** Capped at HARD_CAP. Always a non-negative integer. */
      count: number;
      /**
       * `true` when the haversine filter actually ran. `false` when
       * the shop has no `location` set — in that case the count is
       * the unfiltered online total (mirrors the push fanout's
       * fail-open posture for legacy shops without a location), and
       * the UI can choose to render a hint nudging the owner to set
       * a location for a more accurate number.
       */
      filtered: boolean;
    }
  | {
      ok: false;
      code: 'unauthenticated' | 'permission-denied' | 'not-found';
      message: string;
    };

/** Defensive ceiling. Pilot will never approach this — a 999 cap
 *  exists to bound payload size against a misbehaving caller and to
 *  keep the badge UI from rendering "1247" if something has gone
 *  wrong upstream. */
export const NEARBY_PARTNER_HARD_CAP = 999;

export async function computeNearbyOnlinePartnerCount(input: {
  auth: { token: ShopOwnerClaims } | null | undefined;
  /** Reads `shops/{claims.shopId}` and returns `{ location }` or null
   *  if the shop doc doesn't exist. */
  fetchShop: (
    shopId: string,
  ) => Promise<{ location?: LatLng | null } | null>;
  /** Reads all `users` where isDelivery && deliveryStatus==='online'
   *  and returns the rows in the PartnerRow shape the filter expects. */
  fetchOnlinePartners: () => Promise<PartnerRow[]>;
}): Promise<NearbyOnlinePartnerCountResult> {
  const { auth, fetchShop, fetchOnlinePartners } = input;

  if (!auth) {
    return {
      ok: false,
      code: 'unauthenticated',
      message: 'Sign in required',
    };
  }
  // Shop-owner-only. Admins do NOT get this surface — they have the
  // admin `getOnlineDeliveryCount` (total online count) on
  // AdminOrdersScreen. Mixing the two surfaces in one callable would
  // confuse the auth boundary; keep them separate.
  if (auth.token?.shopOwner !== true) {
    return {
      ok: false,
      code: 'permission-denied',
      message: 'Shop owner only',
    };
  }
  const shopId = auth.token.shopId;
  if (typeof shopId !== 'string' || !shopId) {
    return {
      ok: false,
      code: 'permission-denied',
      message: 'Shop owner without a shopId claim',
    };
  }

  const [shop, online] = await Promise.all([
    fetchShop(shopId),
    fetchOnlinePartners(),
  ]);

  if (!shop) {
    return {
      ok: false,
      code: 'not-found',
      message: 'Your shop is not yet registered',
    };
  }

  const shopLoc = shop.location ?? null;
  const inRange = filterPartnersByNotificationRadius(online, shopLoc);
  const filtered =
    shopLoc !== null &&
    typeof shopLoc.lat === 'number' &&
    Number.isFinite(shopLoc.lat) &&
    typeof shopLoc.lng === 'number' &&
    Number.isFinite(shopLoc.lng);

  const raw = inRange.length;
  const count = Math.min(NEARBY_PARTNER_HARD_CAP, Math.max(0, Math.floor(raw)));
  return { ok: true, count, filtered };
}
```

Notes:

- **Auth boundary deliberately tight.** Admins do not get this callable. They already have `getOnlineDeliveryCount` (admin-only total count) on AdminOrdersScreen. The two surfaces answer different questions and live in different screens; merging them invites confusion.
- **Privacy: count only.** No partner UIDs, names, FCM tokens, or locations leak through this callable. The pure helper enforces that the only field returned to the caller is `count` (+ the `filtered` boolean).
- **`filtered` boolean is metadata, not a count.** UI uses it to display an optional "set your shop location for an accurate count" hint when the shop has no `location` — the count is meaningful but unfiltered in that legacy case (same fail-open behavior as the push fanout).
- **Reuses `filterPartnersByNotificationRadius` verbatim.** This is the key contract guarantee: count cannot disagree with push fanout because they call the same function on the same row shape with the same shop location.

#### §A.2 — Callable export in `index.ts`

Add near the existing `getOnlineDeliveryCount` (around line 5719) so future readers find both count callables side-by-side:

```ts
import { computeNearbyOnlinePartnerCount } from './nearbyPartnersCountHelpers';

// ... (existing getOnlineDeliveryCount stays unchanged) ...

/**
 * PR-NEXT-7 (finding #9) — per-shop count of online delivery
 * partners who would actually receive a push for a new order at the
 * caller's shop. Powers the "N partners online nearby" trust badge
 * on ShopOwnerDashboard. Auth: shop owner only (claims.shopOwner +
 * claims.shopId). Reuses `filterPartnersByNotificationRadius` so the
 * surfaced count cannot disagree with the push fanout.
 *
 * Query shape: same two-equality filter as
 * `sendNewPickupPushToDelivery` and `getOnlineDeliveryCount`
 * (`isDelivery==true && deliveryStatus=='online'`). No composite
 * index needed — Firestore intersects single-field indexes; both
 * fields are already indexed by ambient defaults.
 *
 * Cost: 1 shop doc read + N online-partner doc reads per call. At
 * pilot scale (handful of partners) N is tiny. Polled every 30s by
 * the dashboard hook → ~2 reads/min/owner.
 */
export const getOnlinePartnersNearMyShop = onCall(
  { cors: true, enforceAppCheck: false },
  async request => {
    const result = await computeNearbyOnlinePartnerCount({
      auth: request.auth,
      fetchShop: async (shopId) => {
        const snap = await db.collection('shops').doc(shopId).get();
        if (!snap.exists) return null;
        const data = snap.data() ?? {};
        const loc = data.location;
        // Shop docs store location as a Firestore GeoPoint; normalise
        // to the plain {lat,lng} shape the helper + push fanout use.
        const latLng =
          loc &&
          typeof loc.latitude === 'number' &&
          typeof loc.longitude === 'number'
            ? { lat: loc.latitude, lng: loc.longitude }
            : loc &&
                typeof loc.lat === 'number' &&
                typeof loc.lng === 'number'
              ? { lat: loc.lat, lng: loc.lng }
              : null;
        return { location: latLng };
      },
      fetchOnlinePartners: async () => {
        const snap = await db
          .collection('users')
          .where('isDelivery', '==', true)
          .where('deliveryStatus', '==', 'online')
          .get();
        return snap.docs.map(d => {
          const data = d.data() ?? {};
          return {
            uid: d.id,
            currentLocation: data.currentLocation ?? null,
            notificationRadiusKm: data.notificationRadiusKm,
            fcmTokens: data.fcmTokens ?? [],
          };
        });
      },
    });
    if (!result.ok) {
      throw new HttpsError(result.code, result.message);
    }
    return { count: result.count, filtered: result.filtered };
  },
);
```

The `GeoPoint → LatLng` normalisation block is intentional: the rest of the codebase reads shop locations through different paths (some places treat it as already-normalised, others read the raw GeoPoint). Centralising the normalisation here keeps the pure helper agnostic to the source of truth — if a future migration flips the storage format, only this read site changes.

#### §A.3 — Tests `tests/functions/nearbyPartnersCountHelpers.test.ts`

Pin the contract exhaustively:

```ts
import {
  computeNearbyOnlinePartnerCount,
  NEARBY_PARTNER_HARD_CAP,
} from '../../functions/src/nearbyPartnersCountHelpers';
import type { PartnerRow } from '../../functions/src/notificationRadiusHelpers';

const SHOP_LOC = { lat: 28.330, lng: 77.318 }; // Ballabgarh-ish
const NEAR_PARTNER: PartnerRow = {
  uid: 'p_near',
  currentLocation: { lat: 28.331, lng: 77.319 }, // ~150m away
  notificationRadiusKm: 3,
};
const FAR_PARTNER: PartnerRow = {
  uid: 'p_far',
  currentLocation: { lat: 28.450, lng: 77.500 }, // ~25km+ away
  notificationRadiusKm: 3,
};
const NO_LOC_PARTNER: PartnerRow = {
  uid: 'p_noloc',
  // No currentLocation — fail-open per PR 50 contract.
};

describe('computeNearbyOnlinePartnerCount', () => {
  test('unauthenticated → unauthenticated error', async () => {
    const result = await computeNearbyOnlinePartnerCount({
      auth: null,
      fetchShop: async () => ({ location: SHOP_LOC }),
      fetchOnlinePartners: async () => [],
    });
    expect(result).toEqual({
      ok: false,
      code: 'unauthenticated',
      message: 'Sign in required',
    });
  });

  test('caller without shopOwner claim → permission-denied', async () => {
    const result = await computeNearbyOnlinePartnerCount({
      auth: { token: { admin: true } },
      fetchShop: async () => ({ location: SHOP_LOC }),
      fetchOnlinePartners: async () => [NEAR_PARTNER],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('permission-denied');
  });

  test('shopOwner without shopId → permission-denied', async () => {
    const result = await computeNearbyOnlinePartnerCount({
      auth: { token: { shopOwner: true } },
      fetchShop: async () => ({ location: SHOP_LOC }),
      fetchOnlinePartners: async () => [NEAR_PARTNER],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('permission-denied');
  });

  test('shop doc missing → not-found', async () => {
    const result = await computeNearbyOnlinePartnerCount({
      auth: { token: { shopOwner: true, shopId: 'shop_1' } },
      fetchShop: async () => null,
      fetchOnlinePartners: async () => [NEAR_PARTNER],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('not-found');
  });

  test('happy path with mixed near/far partners → count = near only', async () => {
    const result = await computeNearbyOnlinePartnerCount({
      auth: { token: { shopOwner: true, shopId: 'shop_1' } },
      fetchShop: async () => ({ location: SHOP_LOC }),
      fetchOnlinePartners: async () => [NEAR_PARTNER, FAR_PARTNER],
    });
    expect(result).toEqual({ ok: true, count: 1, filtered: true });
  });

  test('no online partners → count 0, filtered true (shop has loc)', async () => {
    const result = await computeNearbyOnlinePartnerCount({
      auth: { token: { shopOwner: true, shopId: 'shop_1' } },
      fetchShop: async () => ({ location: SHOP_LOC }),
      fetchOnlinePartners: async () => [],
    });
    expect(result).toEqual({ ok: true, count: 0, filtered: true });
  });

  test('shop has no location → fail-open total online count, filtered=false', async () => {
    // Legacy shop without location: matches push fanout's fail-open
    // posture (all online partners would be pushed). Count reflects
    // that reality + the UI surfaces the `filtered: false` hint.
    const result = await computeNearbyOnlinePartnerCount({
      auth: { token: { shopOwner: true, shopId: 'shop_1' } },
      fetchShop: async () => ({ location: null }),
      fetchOnlinePartners: async () => [NEAR_PARTNER, FAR_PARTNER, NO_LOC_PARTNER],
    });
    expect(result).toEqual({ ok: true, count: 3, filtered: false });
  });

  test('partner without currentLocation is fail-open kept (matches push fanout)', async () => {
    // Partner who hasn't reported a location yet is included so the
    // count never silently drops them — same contract the push
    // fanout enforces (otherwise a partner would think they're
    // online but the count would say "0 nearby").
    const result = await computeNearbyOnlinePartnerCount({
      auth: { token: { shopOwner: true, shopId: 'shop_1' } },
      fetchShop: async () => ({ location: SHOP_LOC }),
      fetchOnlinePartners: async () => [NO_LOC_PARTNER],
    });
    expect(result).toEqual({ ok: true, count: 1, filtered: true });
  });

  test('hard cap clamps absurd counts', async () => {
    const many: PartnerRow[] = Array.from(
      { length: NEARBY_PARTNER_HARD_CAP + 50 },
      (_, i) => ({ uid: `p${i}`, currentLocation: SHOP_LOC, notificationRadiusKm: 3 }),
    );
    const result = await computeNearbyOnlinePartnerCount({
      auth: { token: { shopOwner: true, shopId: 'shop_1' } },
      fetchShop: async () => ({ location: SHOP_LOC }),
      fetchOnlinePartners: async () => many,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.count).toBe(NEARBY_PARTNER_HARD_CAP);
  });

  test('caller may be both shopOwner AND admin — shopOwner path wins (still scoped to claims.shopId)', async () => {
    // Sudhir's pilot account holds both claims. Make sure the
    // shopOwner branch fires and the call is scoped to the shopId
    // claim — not a cross-shop admin view.
    const result = await computeNearbyOnlinePartnerCount({
      auth: { token: { shopOwner: true, admin: true, shopId: 'shop_1' } },
      fetchShop: async () => ({ location: SHOP_LOC }),
      fetchOnlinePartners: async () => [NEAR_PARTNER],
    });
    expect(result).toEqual({ ok: true, count: 1, filtered: true });
  });
});
```

---

### §B — Client: new hook `useOnlinePartnersNearMyShop`

Files touched:

- `src/services/orderService.ts` (new method) — §B.1
- `src/hooks/useOnlinePartnersNearMyShop.ts` (new) — §B.2
- `tests/hooks/useOnlinePartnersNearMyShop.test.ts` (new) — §B.3

#### §B.1 — Service method

Add to `orderService` near the existing `getOnlineDeliveryCount`:

```ts
async getOnlinePartnersNearMyShop(): Promise<{ count: number; filtered: boolean }> {
  const fn = httpsCallable(getFunctions(), 'getOnlinePartnersNearMyShop');
  const res: any = await fn({});
  const data = res?.data ?? {};
  return {
    count: typeof data.count === 'number' ? data.count : 0,
    filtered: data.filtered === true,
  };
},
```

(Match the exact callable wrapper style already in use in `orderService.ts` — the file uses `@react-native-firebase/functions` callable wrappers; copy whichever shape the existing `getOnlineDeliveryCount` method uses, NOT the snippet above verbatim. The above is illustrative only.)

#### §B.2 — Hook

Create `src/hooks/useOnlinePartnersNearMyShop.ts`. Mirrors `useOnlineDeliveryCount` exactly — same `nextPollState` semantics, same 15s cadence, same stale threshold of 3, same `null`-on-permanent-failure posture. The single difference is the additional `filtered: boolean` field surfaced alongside the count.

```ts
import { useEffect, useRef, useState } from 'react';
import { orderService } from '../services/orderService';

/**
 * PR-NEXT-7 (finding #9) — count of delivery partners who would
 * actually receive a push for a new order at the shop owner's shop.
 * Powers the "N partners online nearby" trust badge on
 * ShopOwnerDashboard.
 *
 * Mirrors `useOnlineDeliveryCount` (Phase 12c) — same polling
 * cadence, same stale-threshold semantics, same null-on-permanent-
 * failure posture. The single difference is the additional
 * `filtered` boolean returned alongside the count so the UI can
 * render an optional "set shop location" hint for the fail-open
 * unfiltered case.
 *
 * IMPORTANT — hooks rules (code-discipline Rule 2): callers in
 * ShopOwnerDashboardScreen MUST invoke this hook ABOVE any
 * conditional early-return. The hook only fetches when `enabled`
 * is true; callers should pass `isShopOwner && !!shopId` rather
 * than gating the hook call itself.
 */
const POLL_MS = 30_000;
export const NEARBY_PARTNERS_STALE_THRESHOLD = 3;

export type NearbyPartnersState = {
  count: number | null;
  filtered: boolean;
};

export function nextNearbyPartnersState(
  prev: { state: NearbyPartnersState; failures: number },
  outcome:
    | { kind: 'success'; value: NearbyPartnersState }
    | { kind: 'failure' },
  threshold: number = NEARBY_PARTNERS_STALE_THRESHOLD,
): { state: NearbyPartnersState; failures: number } {
  if (outcome.kind === 'success') {
    return { state: outcome.value, failures: 0 };
  }
  const failures = prev.failures + 1;
  if (failures >= threshold) {
    return { state: { count: null, filtered: false }, failures };
  }
  return { state: prev.state, failures };
}

export function useOnlinePartnersNearMyShop(enabled: boolean): NearbyPartnersState {
  // Implementation mirror of useOnlineDeliveryCount.useOnlineDeliveryCount —
  // refs for failures+last value (no re-render on every failed poll),
  // setState only when the displayed value would actually change.
  // ... (see full implementation pattern in useOnlineDeliveryCount.ts;
  //      adapt the value type from `number | null` to `NearbyPartnersState`)
}
```

The full hook body should be a near-line-for-line adaptation of `useOnlineDeliveryCount` — that file's been battle-tested across PR 3 + Phase 12c, and the failure-mode discipline (cancel flag, ref-based no-rerender on failure, success-only re-render gate) should carry over identically.

Add at the top of the hook file an explicit reminder: **do NOT widen the hook to accept a `shopId` parameter.** The callable derives the shop from the caller's claims — passing it through the client would invite cross-shop snooping attempts. Server-side `claims.shopId` is the single source of truth.

#### §B.3 — Hook tests

Pin `nextNearbyPartnersState` the same way `useOnlineDeliveryCount.test.ts` pins `nextPollState`:

1. Success → counter resets to 0, new value installed (including the `filtered` flag).
2. Single failure under threshold → counter +1, previous value preserved (including `filtered`).
3. Three consecutive failures → counter at 3, value cleared to `{ count: null, filtered: false }`.
4. Success after stale-clear → counter resets, fresh value installed cleanly.
5. Custom threshold parameter respected.

---

### §C — UI: badge on `ShopOwnerDashboardScreen`

Files touched:

- `src/screens/shop/ShopOwnerDashboardScreen.tsx` — §C.1

#### §C.1 — Badge placement + render

Add the hook call ABOVE the early `if (!isShopOwner)` return (code-discipline Rule 2 — already enforced for the existing `useState` block). Pass `isShopOwner && !!shopId`:

```ts
// PR-NEXT-7 (finding #9) — trust badge: how many online partners
// would actually receive a push for a new order at this shop. Hook
// is gated by the role+shopId predicate so unsigned-in / wrong-role
// callers don't trigger the callable + permission-denied noise in
// Sentry. Hook lives ABOVE the role-guard returns per Rule 2.
const nearbyPartners = useOnlinePartnersNearMyShop(
  !!isShopOwner && !!shopId,
);
```

Render directly under the existing `statsCard` (line 292–306). New small chip-style row — keeps it visually distinct from the "Today" KPIs (which are historical) since this number is a live current-state signal:

```tsx
<View style={styles.partnersChip}>
  <Text style={styles.partnersChipIcon}>📦</Text>
  <Text style={styles.partnersChipText}>
    {nearbyPartners.count == null
      ? 'Checking partner availability…'
      : nearbyPartners.count === 0
        ? 'No delivery partners online nearby'
        : `${nearbyPartners.count} delivery partner${
            nearbyPartners.count === 1 ? '' : 's'
          } online nearby`}
  </Text>
  {nearbyPartners.count != null && !nearbyPartners.filtered && (
    <Text style={styles.partnersChipHint}>
      Set your shop location for an accurate count
    </Text>
  )}
</View>
```

Suggested styles (match the existing dashboard's chip/card visual rhythm — sample, tune to fit):

```ts
partnersChip: {
  flexDirection: 'row',
  alignItems: 'center',
  flexWrap: 'wrap',
  paddingHorizontal: spacing.md,
  paddingVertical: spacing.sm,
  marginHorizontal: spacing.lg,
  marginBottom: spacing.md,
  borderRadius: radii.sm,
  backgroundColor: colors.surface,
  borderWidth: 1,
  borderColor: colors.border,
  gap: spacing.xs,
},
partnersChipIcon: { fontSize: 16 },
partnersChipText: { ...typography.body, color: colors.textPrimary, flexShrink: 1 },
partnersChipHint: {
  ...typography.caption,
  color: colors.textSecondary,
  width: '100%',
  marginTop: 2,
},
```

**State copy mapping (be exact — these strings are the trust signal):**

| Hook state | Copy |
| --- | --- |
| `count === null` (loading / permanent failure) | `Checking partner availability…` |
| `count === 0, filtered === true` | `No delivery partners online nearby` |
| `count >= 1, filtered === true` | `N delivery partner[s] online nearby` |
| `filtered === false` (shop has no location) | (same N copy as above) + small hint `Set your shop location for an accurate count` |

The `count === null` state is intentionally NOT distinguishable from "loading" in the copy. A permanent-failure state showing "Network error" would erode the trust the badge is trying to build; a benign "checking" is honest enough and clears on the next successful poll. The actual error context already goes to Sentry via the hook's failure log.

**Pull-to-refresh integration:** the existing `setRetryNonce` mechanism doesn't currently force a re-poll of this hook. That's OK for v1 — the badge ticks on its own 30s cadence regardless of pull-to-refresh. If smoke surfaces a complaint, add a refresh prop to the hook in a follow-up.

---

## Discipline checklist

1. **Rule 2 — Hooks above conditionals.** New `useOnlinePartnersNearMyShop` call sits ABOVE the `if (!isShopOwner)` early return in `ShopOwnerDashboardScreen`. Confirm by reading lines 68–115 of the existing file — every `useState` is already above the guards; your new hook joins that cluster.
2. **Rule 3 — Server-first deploy.** Callable deploys first, client OTA second. Never ship the OTA before the callable is live; the hook would fire `NOT_FOUND` errors into Sentry on every poll.
3. **Rule 4 — Schema additive.** No `users` / `shops` / `orders` document field added. Pure read of existing fields.
4. **Rule 11 — Identity-aware gating.** The hook is gated by `isShopOwner && !!shopId` at the call site; the callable enforces the same on the server. Belt + braces — neither alone is sufficient.
5. **Test discipline.** §A.3 + §B.3 add tests; aim for suite count +14 (~10 helper + ~5 hook).
6. **Cloud Run IAM verification (recurring gotcha).** After `firebase deploy --only functions:getOnlinePartnersNearMyShop`, verify the runtime got the `allUsers` / `roles/run.invoker` binding. Without it, every poll returns silent 401 "access token could not be verified" and the badge shows "Checking…" forever. Sample command in `.windsurf/deploy-discipline.md` under "Cloud Run IAM". Bake this into the deploy plan — do not skip.
7. **OTA classification.** Pure JS client + new callable. No `app.json`, no permissions, no plugins, no `runtimeVersion` change → OTA. Verify by reading the OTA-vs-`eas build` decision table in `.windsurf/deploy-discipline.md` and confirming none of the rebuild triggers apply.

---

## Acceptance checklist

Run on iOS first, then Android. Two test devices needed (one shop owner, one delivery partner) since the count depends on a partner being online.

**Auth gating:**

1. Sign in as plain customer → load HomeScreen. Open Sentry; confirm NO `getOnlinePartnersNearMyShop` calls fire. (The hook is gated on `isShopOwner`; the customer should not trigger the callable.)
2. Sign in as admin (no shopOwner claim) → navigate to ShopOwnerDashboard route directly via deep-link or bottom tab. The role-guard renders an EmptyState; the hook is `enabled=false`; no callable hits.

**Happy path (1 partner online, in range):**

3. Delivery partner: sign in, open Delivery Dashboard, toggle Online. Wait 2s for `setDeliveryStatus` to write.
4. Shop owner: open Shop Owner Dashboard. Within 30s the chip reads `1 delivery partner online nearby`. (First-mount fetch should fire immediately; you may see it in <5s.)
5. Delivery partner: toggle Offline. Wait one poll cycle (≤30s) on the shop owner's dashboard. Chip should flip to `No delivery partners online nearby`.

**Out-of-range case:**

6. Delivery partner: while online, set `notificationRadiusKm` to 1 km via the Delivery Dashboard's radius input. Confirm the partner's `currentLocation` is >1 km from the shop (use the test setup or manually verify via Firestore Console).
7. Shop owner's chip should poll-update to `No delivery partners online nearby` within 30s.
8. Partner: bump radius back to 10 km. Shop owner's chip should poll-update to `1 ...nearby` within 30s.

**Shop without location (fail-open):**

9. Via Firestore Console, temporarily clear `shops/{pilotShopId}.location`. (Do this on the dev project, never prod.) Force a re-fetch by killing/restarting the shop owner's app.
10. Chip should read `N ... nearby` + the hint `Set your shop location for an accurate count` should appear directly below.
11. Restore `shops/{pilotShopId}.location`. Hint disappears on the next poll.

**Pull-to-refresh + dashboard polling agnostic:**

12. Pull to refresh on the dashboard. Orders list refetches; the partners chip is unchanged (it polls independently on a 30s cadence). Acceptable for v1.

**Regression checks:**

13. AdminOrdersScreen still shows the existing admin online-partner total (count from `getOnlineDeliveryCount`) — confirm by mounting it as admin. The new callable did NOT touch this code path.
14. `sendNewPickupPushToDelivery` push fanout: place a new order in the same shop, confirm the in-range partner still receives the push. Count and fanout must agree.
15. `npx tsc --noEmit` clean (both root + functions/).
16. `npm run test:unit` clean; suite count up by §A.3 + §B.3 additions.
17. Sentry: zero `permission-denied` noise from non-shop-owner accounts.
18. **Cloud Run IAM check** (post-deploy, per discipline rule 6): `gcloud run services describe getonlinepartnersnearmyshop --region asia-south1 --format='value(spec.template.spec.containers[0].env)'` and verify `allUsers` is in the IAM policy:
    ```
    gcloud run services get-iam-policy getonlinepartnersnearmyshop --region asia-south1
    ```
    If missing, add it: `gcloud run services add-iam-policy-binding getonlinepartnersnearmyshop --region asia-south1 --member=allUsers --role=roles/run.invoker`.

---

## Out of scope (explicit deferrals)

- **Pull-to-refresh forces a re-poll.** Out of scope for v1; the 30s background poll is sufficient. Add a `refresh()` callback to the hook in a follow-up if smoke complaints surface.
- **Per-area breakdown** ("2 within 1 km, 3 within 3 km"). Adds value at scale but not at 1-shop pilot. Defer.
- **"Last 24h availability" trend.** Different question, separate PR.
- **WebSocket / Firestore live listener** instead of polling. Would cost more reads at scale and the 30s cadence is fine at pilot scale.
- **Push notification to shop owner when partners drop below threshold.** Could be useful ("⚠ no delivery partners are online right now") but introduces a new push type + cadence question. Defer.

---

## Deploy plan

**Step 1 — Server-first (`functions/`):**

```
cd functions
npm run build
firebase deploy --only "functions:getOnlinePartnersNearMyShop"
```

Wait for green deploy. Then verify IAM (recurring gotcha):

```
gcloud run services get-iam-policy getonlinepartnersnearmyshop --region asia-south1
```

If `allUsers` / `roles/run.invoker` binding is missing:

```
gcloud run services add-iam-policy-binding getonlinepartnersnearmyshop \
  --region asia-south1 \
  --member=allUsers \
  --role=roles/run.invoker
```

Test the callable directly via Firebase Console → Functions → Logs (place a manual call from a shop-owner test account or use the dashboard once OTA lands).

**Step 2 — Client OTA:**

```
npx tsc --noEmit              # clean (root)
npm run test:unit             # all green; record suite count delta in commit
git commit -m "PR-NEXT-7: online partners nearby badge (finding #9)"
eas update --branch production --message "PR-NEXT-7 partners-nearby badge"
```

Pull on the installed shop-owner app; run the 18-step acceptance checklist.

If acceptance fails on iOS but not Android (or vice versa), hotfix on top via the same OTA channel — do not rebuild natively.

---

## Doc trail updates after ship

- `docs/TESTING-FINDINGS-2026-05-30.md` — flip finding #9 to `✅ SHIPPED in PR-NEXT-7 (May 31 2026)` with a one-paragraph summary covering the callable + hook + chip + fail-open behavior.
- `docs/SESSION_LOG.md` — append the standard one-paragraph entry covering callable + hook + chip, the suite-count delta, and the server-first deploy classification (+ IAM-verified note).
- `CLAUDE.md` — bump the "Current state" date and add PR-NEXT-7 to the rolled-up list of shipped PRs in this testing-findings cleanup wave.
- `PRELAUNCH_CHECKLIST.md` — add a short section under the existing "Testing findings cleanup wave" block noting finding #9 closed.
