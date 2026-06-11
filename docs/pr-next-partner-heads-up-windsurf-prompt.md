# PR-NEXT-PARTNER-HEADS-UP — Pickup heads-up push + Coming-up dashboard section

**Source:** Sudhir's 2026-06-09 design observation: *"Our original plan was giving some time to partner ahead of time to know that this order is going to be ready in few minutes so they can plan their route accordingly or can do a head start to save overall delivery time. I feel that gap is not solved yet."* Pre-design check locked in: **fire at `accepted` with readyByEstimate in the push body** + add **separate "Coming up" section on partner dashboard**.

**Design lens — partner's question:** *"Should I head over to this shop now, or finish my current delivery first?"* The partner can only make that decision with advance information. Current system gives 0 minutes lead time because the push only fires at `ready_for_pickup` — when the food's already sitting on the counter. This PR maximizes lead time by firing the heads-up at acceptance, with the shop's own `readyByEstimate` in the push body so the partner self-allocates with full information.

**Deploy class:** **server-first** (1 new Firestore document trigger + 1 modified callable) → IAM verify → client OTA.

## Autonomous execution authorization

You may run the following without stopping to confirm — execute, report results in the final summary:

- All `Read`, `Grep`, `Glob`, `ls`, `git status`, `git diff` (read-only)
- `npx tsc --noEmit` (root and `functions/`)
- `npm test`, `npm run test:unit`, `npm run test:full`, `npx jest`
- `npm run lint`, `npx eslint`
- `cd functions && npm run build`
- File edits to files explicitly named in §A–§E below
- New file creation in directories explicitly named in the plan
- Re-running any of the above to verify after fixing an error

You MUST stop and ask before:

- Deploy commands: `firebase deploy …`, `eas update`, `eas build`, `gcloud run …`
- File deletes
- Force-push, rebase, branch ops
- Editing files NOT named in §A–§E
- Adding NEW dependencies not listed in the plan
- Schema additions / migrations not in the spec

Default posture: **execute, report at end.**

## Schema audit-grep (Rule 5)

```
grep -rn "sendNewPickupPushToDelivery" functions/src
grep -rn "filterPartnersByNotificationRadius\|notificationRadiusHelpers" functions/src
grep -rn "listAvailablePickups\|listMyAvailablePickups\|coming_up" src functions/src
grep -rn "readyByEstimate\|status.*accepted" src functions/src
grep -rn "AuthBootstrap.*push.*type\|order_partner_assigned" src
```

| Symbol | Confirmed at | Notes |
| --- | --- | --- |
| `sendNewPickupPushToDelivery` | `functions/src/index.ts:~4620` (the existing trigger for `ready_for_pickup`) | The pattern this PR mirrors. New trigger fires on `accepted` instead of `ready_for_pickup`. |
| `filterPartnersByNotificationRadius` | `functions/src/notificationRadiusHelpers.ts` (PR 50) | Reused unchanged — same fail-OPEN posture, same per-partner radius logic. |
| `Order.status` enum | `src/types/index.ts:509` includes `'accepted'`, `'preparing'`, `'ready_for_pickup'` | The trigger fires on `accepted`; dashboard section shows both `accepted` and `preparing` (in-radius). |
| `Order.readyByEstimate` | `src/types/index.ts:520` | Set when shop accepts; PR 12 enforces it's required and in the future. Push body includes this value as minutes-from-now. |
| Partner dashboard listing callable | (find via grep — likely `listAvailablePickups` or similar) | Extended to return `coming_up` orders alongside `available` orders. |
| HOTFIX-5 deep-link routing | `src/components/AuthBootstrap.tsx` (per CLAUDE.md) | Adds new push type `pickup_heads_up` → DeliveryDashboard. Same pattern as `order_partner_assigned`. |

## Plan

### §A — New Firestore trigger `sendPickupHeadsUpToDelivery`

`functions/src/index.ts` — add a new `onDocumentUpdated` trigger on `orders/{orderId}`, mirror `sendNewPickupPushToDelivery`'s structure:

```ts
export const sendPickupHeadsUpToDelivery = onDocumentUpdated(
  'orders/{orderId}',
  async event => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;
    // Fire only on the accepted transition. Idempotency-guarded by
    // headsUpSentAt below so a re-trigger (e.g. another field
    // change while status stays 'accepted') doesn't double-push.
    if (before.status !== 'pending' && before.status !== 'accepted') return;
    if (after.status !== 'accepted') return;
    if (after.headsUpSentAt) return; // already sent

    // Filter to in-radius partners — reuse PR 50 helper.
    const usersSnap = await db
      .collection('users')
      .where('isDelivery', '==', true)
      .where('isOnline', '==', true) // or whatever the existing filter is
      .get();
    const allOnline: PartnerRow[] = usersSnap.docs.map(d => {
      const data = d.data() ?? {};
      return {
        uid: d.id,
        currentLocation: data.currentLocation ?? null,
        notificationRadiusKm: data.notificationRadiusKm,
        fcmTokens: data.fcmTokens ?? [],
      };
    });
    const inRange = filterPartnersByNotificationRadius(
      allOnline,
      after.shopLocation ?? null,
    );
    if (inRange.length === 0) {
      console.log(
        `[sendPickupHeadsUpToDelivery] no in-range partners for order ${event.params.orderId}`,
      );
      return;
    }

    const tokens: string[] = [];
    inRange.forEach(p => tokens.push(...(p.fcmTokens ?? [])));
    if (!tokens.length) return;

    // Compute readyByEstimate in minutes-from-now for the push body.
    const minutesFromNow = computeMinutesFromNow(
      after.readyByEstimate,
      Date.now(),
    );

    const messages = tokens.map(token => ({
      to: token,
      sound: 'default' as const,
      title: '🍽️ Heads up — pickup coming',
      body:
        `${after.shopName ?? 'A shop'} · ready in ` +
        `~${minutesFromNow} min · ${
          Array.isArray(after.items) ? after.items.length : 0
        } items`,
      data: {
        orderId: after.id ?? event.params.orderId,
        type: 'pickup_heads_up',
      },
    }));

    try {
      const result = await sendExpoPushes(messages); // existing helper
      console.log(
        `[sendPickupHeadsUpToDelivery] sent ${messages.length} push(es) for order ${event.params.orderId}: ${JSON.stringify(result)}`,
      );
      // Stamp headsUpSentAt to prevent duplicate sends on subsequent
      // field updates while status stays 'accepted'.
      await event.data!.after.ref.update({
        headsUpSentAt: FieldValue.serverTimestamp(),
      });
    } catch (err) {
      console.error(
        `[sendPickupHeadsUpToDelivery] push fan-out failed for ${event.params.orderId}:`,
        err,
      );
    }
  },
);
```

**Pure helpers**:

`functions/src/headsUpHelpers.ts`:
```ts
/**
 * PR-NEXT-PARTNER-HEADS-UP — pure formatter for the push body's
 * "ready in ~X min" line. Centralizes the rounding + floor/ceiling
 * behavior so the body matches the dashboard "Coming up" row.
 *
 * Returns at least 1 — never "ready in ~0 min" (would imply
 * already ready, contradicting the heads-up framing). Handles
 * negative deltas (past readyByEstimate) by clamping to 1.
 */
export function computeMinutesFromNow(
  readyByEstimateMs: number | null | undefined,
  nowMs: number,
): number {
  if (typeof readyByEstimateMs !== 'number' || !Number.isFinite(readyByEstimateMs)) {
    return 1; // unknown ETA → "ready in ~1 min" as a safe default
  }
  const deltaMin = (readyByEstimateMs - nowMs) / 60_000;
  return Math.max(1, Math.round(deltaMin));
}
```

Pin with **6 test cases**: future readyByEstimate (15 min), past readyByEstimate (clamped to 1), exact now (clamped to 1), null input, undefined input, NaN input.

### §B — Schema addition

`src/types/index.ts` Order type:
```ts
// PR-NEXT-PARTNER-HEADS-UP — idempotency marker. Set by the
// sendPickupHeadsUpToDelivery trigger on first successful fan-out.
// Once set, subsequent updates to the order doc that keep status
// at 'accepted' don't re-fire the push. Cleared if the order is
// rejected back to 'pending' (rare) so a re-acceptance can re-push.
headsUpSentAt?: number | null;
```

### §C — Extend dashboard listing callable to include `coming_up`

Find the partner-side dashboard listing callable (likely `listMyAvailablePickups` or similar — grep). Currently returns orders where `status === 'ready_for_pickup'` and in-radius. Extend to also return orders where `status === 'accepted'` or `status === 'preparing'` and in-radius, tagged as `coming_up`:

```ts
return {
  available: availableOrders.map(o => ({ ...o, kind: 'available' as const })),
  coming_up: comingUpOrders.map(o => ({ ...o, kind: 'coming_up' as const })),
};
```

The client renders each in their own section. `coming_up` orders are NOT claimable — the existing `claimDelivery` callable already rejects anything that isn't `ready_for_pickup`, so the server-side guard stays in place. Client just doesn't render a "Claim" button on `coming_up` rows.

Pin with **+4 tests** on the extended callable: returns both lists, filters by radius for both, sort order (nearest first within each list), partner with no location returns empty for both.

### §D — Client: Delivery dashboard "Coming up" section

```
┌─────────────────────────────────────┐
│ ← Delivery Dashboard                │
├─────────────────────────────────────┤
│                                     │
│ ⏳ Coming up (heads up)              │ ← NEW SECTION
│ ┌─────────────────────────────────┐ │
│ │ Shop: US Shoppers               │ │
│ │ 1.2 km away · 💰 Earn ₹60       │ │
│ │ Ready in ~12 min                 │ │
│ │ (You'll claim when ready)        │ │
│ └─────────────────────────────────┘ │
│                                     │
│ 🚚 Available pickups                 │
│ ┌─────────────────────────────────┐ │
│ │ Shop: Merugu Store              │ │
│ │ 2.5 km away · 💰 Earn ₹80       │ │
│ │ Tap to view items & claim        │ │
│ └─────────────────────────────────┘ │
│                                     │
│ 🛵 My deliveries (1)                 │
│ ...                                 │
└─────────────────────────────────────┘
```

`src/screens/delivery/DeliveryDashboardScreen.tsx`:
1. New `ComingUpPickupCard` sub-component — mirrors `AvailablePickupCard` styling but with a muted color, no Claim affordance, and the "Ready in ~X min" line front-and-center
2. Reads the existing `RideDistanceLine` (PR 49) for distance display
3. Reads `order.deliveryFee` for the earnings line (PARTNER-VIS pattern)
4. Uses `computeMinutesFromNow(order.readyByEstimate, Date.now())` for the ETA — refreshes every 60s via the existing tick interval (HomeScreen's pattern at `:143`)
5. Section header `"⏳ Coming up (heads up)"`; empty state hidden (no point showing "no upcoming orders" — just collapse the section)
6. Pressable opens a read-only view of the order (existing OrderDetailScreen, but without the Claim button since server would reject anyway)

### §E — Deep-link routing for `pickup_heads_up` push type

`src/components/AuthBootstrap.tsx` push handler — add new branch:

```ts
case 'pickup_heads_up':
  // Tapped from background → open Delivery Dashboard. The order will
  // be in the "Coming up" section. We don't navigate to OrderDetail
  // directly because the partner can't act on it yet (not claimable);
  // dashboard context is more useful.
  if (isDelivery) {
    safeNavigate('DeliveryDashboard', { highlightOrderId: orderId });
  }
  break;
```

`DeliveryDashboardScreen` reads the optional `highlightOrderId` route param and scrolls to / briefly highlights that row in the Coming up section. Highlight fade clears after 3s.

### §F — Pre-pickup-claim guard reminder

`claimDelivery` already rejects anything that isn't `ready_for_pickup` (server-side). No change needed. Document in the §D card's UI copy: `"(You'll claim when ready)"` makes the expectation explicit; reduces partner frustration if they tap and get a soft-error.

---

## Discipline checklist

1. **Rule 1** — every new import + state read carries "PR-NEXT-PARTNER-HEADS-UP — DO NOT REMOVE" comments.
2. **Rule 2** — `ComingUpPickupCard` is presentational; the parent screen's data hooks sit above conditional returns.
3. **Rule 5** — schema audit-grep table in header. New optional field `Order.headsUpSentAt` only. Legacy orders without it never fire the heads-up retroactively (trigger only fires on the transition itself).
4. **Rule 7** — test fixtures use realistic shop / partner / location values.
5. **Rule 11** — IAM verify on the extended `listMyAvailablePickups` (or whatever its actual name is). The new trigger isn't user-invoked so no Cloud Run `allUsers` concern for it.
6. **Rule 13** — N/A (no new modals; section renders inside the existing dashboard layout).
7. **Rule 14** — N/A (no new validators).
8. **Schema-additive only** — 1 new optional field on Order.
9. **Test discipline:** **+6** (computeMinutesFromNow) + **+4** (listMyAvailablePickups extended) = **+10 tests minimum.** Suite trajectory roughly 1362 (post-Bundle B) + previous Phase B ships + this PR's +10.

## Acceptance checklist

1. Customer places order. Shop opens it on iPhone, taps Accept, enters `readyByEstimate: now + 15 min`. Within 5s, partner on a separate iPhone (signed in as delivery, in-radius of shop, online) gets a push: `"🍽️ Heads up — pickup coming · US Shoppers · ready in ~15 min · 3 items"`.
2. Partner taps push → app opens to Delivery Dashboard with the order in the "⏳ Coming up" section, briefly highlighted.
3. Coming up card shows: shop name, distance (RideDistanceLine), `💰 Earn ₹X`, `Ready in ~15 min`, `(You'll claim when ready)`. No Claim button.
4. After 1 minute, the dashboard's tick interval recomputes "Ready in ~14 min".
5. Shop marks order `ready_for_pickup`. Push fires via the existing `sendNewPickupPushToDelivery` trigger. The coming-up card disappears from the "Coming up" section; an Available-pickup card appears in the "🚚 Available pickups" section (existing flow).
6. **Idempotency check:** trigger order re-acceptance scenarios (rare but possible — admin edits the order via the console, shop accepts again after a brief cancel). The `headsUpSentAt` field prevents double-push. Verify via function logs.
7. **Out-of-radius partner.** Sign in as Partner B who's >15 km from the shop. They do NOT get the heads-up push. They do NOT see the order in their "Coming up" section.
8. **Negative — partner tries to claim a coming_up order.** Manually invoke `claimDelivery({ orderId })` while status is still `accepted`. Server returns `failed-precondition` (existing guard). Client doesn't expose a Claim button so this is defense in depth.
9. **Legacy order without readyByEstimate** (pre-PR 12). Trigger fires, push body shows "ready in ~1 min" (computeMinutesFromNow's safe default). Dashboard card hides the ETA line.
10. **Cold-start push deeplink (regression of HOTFIX-5).** Fully close app. Push arrives. Tap → app launches → lands on DeliveryDashboard with highlight. Same behavior as warm path.
11. **Cloud Run IAM** — verify on the modified `listMyAvailablePickups` callable post-deploy.
12. `npx tsc --noEmit` clean (root + functions). `npm run test:unit` clean. Suite +10 minimum.

## Out of scope

- **Partner "reservation" of an upcoming order** — first-come-first-claim at ready_for_pickup is the pilot model. Reservation adds complexity (timeout, abandonment, multi-claim).
- **Scheduled push at `readyByEstimate - 5 min`** — Option C from the pre-design considered. More precise but requires Cloud Scheduler / Tasks. Defer until pilot signal demands tighter timing.
- **Multi-shop "tour" optimization** — partner could be heading to Shop A while Shop B's heads-up arrives. No "what's my optimal route?" planning. Partner self-allocates.
- **Quiet hours** — push fires at any time of day. Partner can mute via OS-level notification settings. Per-partner heads-up opt-out (separate from radius) deferred.
- **Live update of `readyByEstimate`** — if shop revises the estimate (extends prep time), the heads-up isn't re-pushed. Partner sees the updated value next dashboard refresh.

## Deploy

```
# Server first — new trigger + modified callable
cd functions; npm run build; cd ..
firebase deploy --only "functions:sendPickupHeadsUpToDelivery,functions:listMyAvailablePickups"
firebase functions:list | findstr -i "sendpickupheadsuptodelivery listmyavailablepickups"

# IAM verify the callable (trigger isn't user-invoked; no allUsers concern)
gcloud run services get-iam-policy listmyavailablepickups --region=asia-south1 --project=grocery-mvp-dev

# Client OTA
npx tsc --noEmit
npm run test:unit
eas update --branch production --message "PR-NEXT-PARTNER-HEADS-UP early pickup notification + coming-up dashboard"
```

## Doc trail (Cowork)

After ship, Claude in Cowork will:
- Append the heads-up design rationale to `docs/TESTING-FINDINGS-2026-05-30.md` (treat as a finding/observation closure, not a bug)
- Update `CLAUDE.md` In-flight work
- Append `docs/SESSION_LOG.md` paragraph
- Cross-reference PR 50 (notification radius filter) — same fan-out helper, different trigger
- Note that this materially improves the partner-experience time-to-pickup metric (KPI to track post-pilot)
