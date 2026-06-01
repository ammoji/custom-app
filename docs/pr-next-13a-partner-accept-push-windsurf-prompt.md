# PR-NEXT-13a — Customer push + partner-name display when delivery partner accepts pickup

**Source:** Finding #13 follow-up from Sudhir's smoke testing: *"When delivery partner accepted the order for pickup, no notification to Customer."*

**Design decision locked (Sudhir, June 1):** Push notification PLUS partner name + initials avatar on customer's `OrderDetailScreen`. Partner identity becomes visible to the customer the moment the partner claims, not only after pickup (today's behavior). Privacy posture matches: the partner is going to the customer's door anyway; showing the name early helps the customer recognize them. **Phone number stays hidden** until pickup (matches existing behavior on `DeliveryOrderDetailScreen`).

**Deploy class:** server-first + client OTA. Three steps:

1. `firebase deploy --only "functions:claimDelivery"`
2. IAM check on `claimdelivery` (recurring Cloud Run `allUsers` gotcha — function already had the binding; re-verify after deploy in case it's been stripped).
3. `eas update --branch production`.

Schema-additive — new optional field `deliveryPersonName` on Order. No migration.

**Read first**

1. `CLAUDE.md` (full)
2. `docs/TESTING-FINDINGS-2026-05-30.md` — finding #13 entry
3. `.windsurf/code-discipline.md` (Rules 1, 2, 4, 11)
4. `.windsurf/deploy-discipline.md` — Cloud Run IAM verification section
5. `functions/src/index.ts` lines 3475–3521 — `claimDelivery` callable (the insertion point for partner-name denormalization + customer push)
6. `functions/src/index.ts` lines 3576–3610 (search for `pushToUser` near `markPickedUp`) — template for the customer push call. PR-NEXT-1 uses this pattern verbatim.
7. `src/components/AuthBootstrap.tsx` — push-type → deep-link routing. PR-NEXT-1 already routes `order_picked_up`, `order_delivered`, `order_cancelled`, `order_cod_converted`, `new_order_for_shop`, `new_pickup_for_delivery`. We add `order_partner_accepted` to the same audience-mapped table.
8. `src/screens/OrderDetailScreen.tsx` line 779 — existing `deliveryPersonId` truthy check; nearby is where the new partner-name section will render
9. `src/types/index.ts` — Order type; new optional `deliveryPersonName?: string` field

---

## Why this matters

Today the customer's order flow visibility goes:

| Event | Customer sees |
|---|---|
| Order placed | "Order placed" push, "Pending" status |
| Shop accepts | "Order accepted" push, "Accepted" status, ETA appears |
| Shop preparing | "Preparing your order" push |
| Shop ready_for_pickup | "Out for delivery" push (misleading — partner may not be assigned yet) |
| Partner claims | **(nothing)** — customer's status doesn't change, no push, no partner identity |
| Partner picks up | "Order picked up" push (PR-NEXT-1), partner identity visible (DeliveryOrderDetailScreen rendering) |
| Partner delivers | "Order delivered" push |

The gap between "ready_for_pickup" and "picked up" can be 5–30 minutes. During that window the customer is in the dark: they got the "Out for delivery" push (which today fires on the status change to `ready_for_pickup`, even before any partner has claimed), but they don't know who's coming, when, or whether anyone has even agreed to pick it up yet. #13a closes this gap.

---

## Plan

### §A — Server: denormalize partner name + fire customer push in `claimDelivery`

Files touched:

- `functions/src/index.ts` `claimDelivery` callable (lines 3475–3521) — §A.1
- `src/types/index.ts` Order type — §A.2

#### §A.1 — Extend `claimDelivery` (one transaction, then best-effort push)

The current callable runs `db.runTransaction` to atomically check `deliveryPersonId` and stamp it. After the transaction completes successfully, add:

1. Read the partner's `users/{uid}` doc to get `displayName`.
2. Update the order with `deliveryPersonName` (denormalized for the customer's view).
3. Read the customer's `users/{customerUid}` doc to get `fcmTokens`.
4. Fire `pushToUser(customerUid, title, body, data)` with the new push type.

All steps after the transaction are **best-effort**: a failed push must NOT roll back the partner's successful claim. Same posture as `markPickedUp` and `markDelivered`.

```ts
export const claimDelivery = onCall<{ orderId: string }>(
  { cors: true, enforceAppCheck: false },
  async request => {
    const { uid } = requireDeliveryRole(request);
    const orderId = request.data?.orderId;
    if (!orderId) {
      throw new HttpsError('invalid-argument', 'orderId required');
    }
    const ref = db.doc(`orders/${orderId}`);

    // Transaction: atomic first-wins. Two delivery people tapping
    // Accept simultaneously will see exactly one success — the second
    // hits the deliveryPersonId guard and throws.
    let orderShopName: string | undefined;
    let customerUid: string | undefined;
    await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      if (!snap.exists) {
        throw new HttpsError('not-found', `Order ${orderId} not found`);
      }
      const order = snap.data() as {
        status: OrderStatus;
        deliveryPersonId: string | null;
        shopName?: string;
        customerUid?: string;
      };
      if (order.status !== 'ready_for_pickup') {
        throw new HttpsError(
          'failed-precondition',
          'Order not ready for pickup',
        );
      }
      if (order.deliveryPersonId) {
        throw new HttpsError(
          'failed-precondition',
          'Already claimed by another delivery partner',
        );
      }
      tx.update(ref, {
        deliveryPersonId: uid,
        updatedAt: FieldValue.serverTimestamp(),
        statusHistory: FieldValue.arrayUnion({
          status: 'ready_for_pickup',
          at: Date.now(),
          by: `delivery:${uid}`,
          reason: 'Delivery partner claimed',
        }),
      });
      orderShopName = order.shopName;
      customerUid = order.customerUid;
    });

    // PR-NEXT-13a — denormalize partner displayName onto the order
    // for customer-side rendering. Pre-PR the customer's
    // OrderDetailScreen had `deliveryPersonId` but no way to show a
    // human-readable name without a separate user lookup. Stamping
    // here keeps the customer's view a single-doc read. If the
    // partner later changes their display name, this snapshot stays
    // — that's intentional (order documents are historical records).
    //
    // Best-effort: a failed partner-lookup or order-update must NOT
    // roll back the successful claim. The customer push below also
    // tolerates a missing name (fallback copy).
    let partnerDisplayName: string | undefined;
    try {
      const partnerSnap = await db.doc(`users/${uid}`).get();
      const partnerData = partnerSnap.data() ?? {};
      const raw = partnerData.displayName;
      if (typeof raw === 'string' && raw.trim().length > 0) {
        partnerDisplayName = raw.trim();
        await ref.update({
          deliveryPersonName: partnerDisplayName,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    } catch (e) {
      console.warn(
        '[claimDelivery] partner-name denormalization failed (non-fatal):',
        e,
      );
    }

    // PR-NEXT-13a — customer push. Pre-PR the customer learned about
    // pickup only when `markPickedUp` fired its push (PR-NEXT-1). The
    // gap between claim and pickup can be 5–30 minutes; closing it
    // is the whole point of this PR. Best-effort: a failed push
    // must NOT roll back the claim above.
    if (customerUid) {
      try {
        const customerSnap = await db.doc(`users/${customerUid}`).get();
        const tokens: string[] =
          (customerSnap.data() as { fcmTokens?: string[] } | undefined)
            ?.fcmTokens ?? [];
        if (tokens.length > 0) {
          const namePart = partnerDisplayName ?? 'Your delivery partner';
          const shopPart = orderShopName ?? 'the shop';
          await pushToUser(
            customerUid,
            'Your delivery partner is on the way',
            `${namePart} will pick up your order from ${shopPart}.`,
            {
              orderId,
              type: 'order_partner_accepted',
            },
          );
        } else {
          console.log(
            `[claimDelivery] no tokens for customer ${customerUid} — skipping push`,
          );
        }
      } catch (e) {
        console.warn(
          '[claimDelivery] customer push failed (non-fatal):',
          e,
        );
      }
    }

    return { ok: true };
  },
);
```

**Key disciplines preserved:**

- Transaction is atomic and unchanged in shape — first-wins still holds for concurrent claims.
- Partner-name denormalization happens AFTER the transaction (separate write). If two partners claim simultaneously, exactly one transaction wins; the winner's name lookup happens after, on a now-stable order.
- Push fires AFTER both the transaction AND the name denormalization. If the push fan-out fails for any reason (no FCM tokens, Expo API down, network), the claim is durable on the server and the customer eventually sees the partner via the order watcher.
- Both post-transaction blocks are wrapped in `try/catch` so a failure in one doesn't kill the other.

#### §A.2 — Schema-additive: `deliveryPersonName?: string` on Order

In `src/types/index.ts`, add the new optional field near the existing `deliveryPersonId`:

```ts
// PR-NEXT-13a — denormalized partner displayName captured at claim
// time. Set by `claimDelivery` immediately after the atomic
// transaction succeeds; null on legacy / mid-flight orders. Customer
// renders this on OrderDetailScreen as soon as the partner claims,
// not waiting for pickup.
//
// Why denormalize (not look up users/{deliveryPersonId} from the
// client): customer's order watcher is a single-doc subscription;
// adding a partner-user-doc lookup would double the read cost on
// every order render. The denormalization is a one-time write at
// claim time. If the partner later renames themselves, this snapshot
// stays — order documents are historical records.
deliveryPersonName?: string;
```

Type is `string | undefined`. Legacy orders have it absent → client renders without a name (falls back to "Your delivery partner" or hides the section, per UI choice in §B).

---

### §B — Client: render partner identity on OrderDetailScreen + push routing

Files touched:

- `src/screens/OrderDetailScreen.tsx` (modify) — §B.1
- `src/components/AuthBootstrap.tsx` (modify) — §B.2
- `src/components/order/PartnerIdentityCard.tsx` (new) — §B.3 (small reusable component for the name + initials avatar)

#### §B.1 — Render partner identity when `deliveryPersonId` is set

Currently OrderDetailScreen surfaces delivery-partner info only after `pickedUpAt`. Loosen the gate so partner identity renders as soon as `deliveryPersonId` is present.

Find the section where `deliveryPersonId` is referenced (around line 779) — that's the rating panel branch. We want a separate, earlier-firing section that renders the partner identity from `deliveryPersonId` + `deliveryPersonName`.

**New section, inserted between the existing order status block and the rating panel** (exact location: after the status/timeline UI, before any post-delivery rating panel — find the natural insertion point near where pickup time renders):

```tsx
{/* PR-NEXT-13a — partner identity surfaces once the partner claims
    the pickup, not waiting for actual pickup. Render only when
    `deliveryPersonId` is set; falls back to "Your delivery partner"
    when name is absent (legacy orders pre-PR-NEXT-13a or partners
    without a displayName on their user doc). Phone number is NOT
    shown here — that stays gated to post-pickup as it was. */}
{typeof order.deliveryPersonId === 'string' &&
  order.deliveryPersonId.length > 0 &&
  order.status !== 'cancelled' && (
    <PartnerIdentityCard
      name={order.deliveryPersonName}
      pickedUpAt={
        typeof order.pickedUpAt === 'number' ? order.pickedUpAt : null
      }
    />
  )}
```

#### §B.2 — Add `order_partner_accepted` to AuthBootstrap push-deep-link routing

In `AuthBootstrap.tsx`, find the push-type → screen-route table (search for `order_picked_up` or `order_delivered` to find the audience-mapped routing block PR-NEXT-1 set up). Add:

```tsx
// PR-NEXT-13a — partner-claim push. Customer-side notification
// fired by `claimDelivery` when a partner accepts an available
// pickup. Same audience precedence as `order_status` /
// `order_picked_up`: customer deep-links to their OrderDetailScreen;
// any shop-owner / admin / partner with the same orderId in their
// world deep-links to whichever detail screen matches their role
// (mirrors PR-NEXT-1's pattern). For most accounts this push is
// customer-only because the claim event isn't relevant to other
// roles, but the audience-precedence fall-through keeps the routing
// table consistent.
case 'order_partner_accepted':
  // customer route
  if (audience === 'customer' || (!isShopOwner && !isAdmin && !isDelivery)) {
    return { screen: 'OrderDetail', params: { orderId: data.orderId } };
  }
  // fallthrough — shop owner / admin / delivery shouldn't normally
  // get this push but the audience-mapped routing keeps the table
  // exhaustive.
  break;
```

(Use the exact local idiom from `AuthBootstrap.tsx`'s existing switch — copy whichever audience-derivation pattern PR-NEXT-1's `order_picked_up` and `order_delivered` cases use.)

#### §B.3 — `PartnerIdentityCard` component (new)

Small reusable component in `src/components/order/PartnerIdentityCard.tsx`:

```tsx
/**
 * PR-NEXT-13a — partner identity card on customer's OrderDetailScreen.
 *
 * Renders the assigned delivery partner's display name + a circular
 * initials avatar (NOT a real photo — partner profile photo flow
 * doesn't exist yet; deferred to a future PR). Falls back to "Your
 * delivery partner" when name is absent.
 *
 * Phone number is intentionally NOT rendered here. The customer's
 * partner-phone access stays gated to post-pickup (existing behavior).
 *
 * Status sub-line distinguishes "on the way to shop" (assigned but
 * not yet picked up) from "on the way to you" (picked up, in
 * transit). Both states are derived from the order's `pickedUpAt`.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing, typography } from '../../constants/theme';

function initialsFor(name: string | undefined | null): string {
  if (typeof name !== 'string' || name.trim().length === 0) return '👤';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0]!.charAt(0).toUpperCase();
  return (parts[0]!.charAt(0) + parts[parts.length - 1]!.charAt(0)).toUpperCase();
}

export default function PartnerIdentityCard({
  name,
  pickedUpAt,
}: {
  name?: string | null;
  pickedUpAt: number | null;
}) {
  const displayName =
    typeof name === 'string' && name.trim().length > 0
      ? name.trim()
      : 'Your delivery partner';
  const initials = initialsFor(name);
  const subtitle =
    pickedUpAt != null
      ? '🛵 On the way to you'
      : '📦 Heading to the shop';

  return (
    <View style={styles.card}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{initials}</Text>
      </View>
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>{displayName}</Text>
        <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>
      </View>
    </View>
  );
}

const AVATAR_SIZE = 44;

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.md,
    marginHorizontal: spacing.lg,
    marginVertical: spacing.sm,
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    ...typography.bodyBold,
    color: colors.primaryDark,
  },
  body: { flex: 1, minWidth: 0 },
  name: { ...typography.bodyBold },
  subtitle: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
});
```

**Notes on the avatar approach:**

- We deliberately use **initials in a colored circle**, NOT a real photo. Partner profile photo flow doesn't exist (the KYC selfie is PII and shouldn't be exposed to customers). Initials are common enough (Gmail / WhatsApp / similar) that customers recognize them as "this is my partner's identity." Real photo can be added later when a partner-profile flow ships.
- The circle uses the brand's `primaryLight` background + `primaryDark` text for consistency with HamaraSetu's blue-to-green palette.

---

### §C — Tests

#### §C.1 — `claimDelivery` is a transaction-heavy callable; pin via emulator test or skip in-favor-of-acceptance

Today there's likely no direct test for `claimDelivery` (it's IO-heavy: transaction + post-transaction Firestore writes). Don't add a brittle full-emulator integration test for this PR — that's a separate testing-infrastructure investment. Cover via the acceptance checklist instead.

If you want a defensive unit test, extract the partner-name fallback logic into a tiny pure helper:

```ts
// functions/src/claimDeliveryHelpers.ts (new)
export function pickPartnerDisplayName(
  raw: unknown,
): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}
```

And pin with 4 cases: valid name, empty string, whitespace-only, non-string. This isolates one trivial bit of correctness; the rest is integration territory.

#### §C.2 — `PartnerIdentityCard` snapshot test

Pin the two render branches: name present, name absent. And the two pickup states: `pickedUpAt = null` (heading to shop) vs `pickedUpAt = <number>` (on the way to you). 4 small cases.

---

## Discipline checklist

1. **Rule 1 — Imports stay.** New imports: `PartnerIdentityCard` in OrderDetailScreen; nothing else.
2. **Rule 2 — Hooks above conditionals.** N/A — no new hooks; render-only changes.
3. **Rule 3 — Server-first deploy.** Functions deploy first (`claimDelivery` only), then client OTA. Mid-deploy a customer without OTA but with the new server: order doc gets `deliveryPersonName` denormalized + customer gets push but no in-app card yet (push deep-link lands on OrderDetailScreen which doesn't render the new card without OTA — acceptable degradation).
4. **Rule 4 — Schema additive only.** `deliveryPersonName?: string` is optional. Legacy orders have it absent → fallback copy. No migration.
5. **Rule 11 — Identity-aware gating.** Push fan-out reads tokens from the order's `customerUid`, not from the partner's session. Server-derived audience.
6. **Cloud Run IAM verification (recurring gotcha).** After `firebase deploy --only "functions:claimDelivery"`, verify the `allUsers` binding is intact on the `claimdelivery` Cloud Run service. Function already had the binding; re-verify to defend against the periodic strip pattern documented in `.windsurf/deploy-discipline.md`.
7. **OTA classification.** Pure JS client. No `app.json` change, no permission (we already have notification permission from prior PRs), no plugin. OTA-safe.

---

## Acceptance checklist

Need 3 accounts: customer + delivery partner + (optional) shop owner. Two physical devices minimum (customer + partner) — push is inherently two-device.

**Happy path — push fires on claim:**

1. Customer places an order. Shop accepts → preparing → ready_for_pickup.
2. **Customer device:** clear notifications. Watch for incoming push.
3. **Partner device:** open Delivery Dashboard → see the available pickup → tap "Accept pickup" (or whatever the claim CTA is).
4. **Customer device:** within ~5 seconds, push arrives:
   - Title: "Your delivery partner is on the way"
   - Body: "<partner displayName> will pick up your order from <shopName>."
5. Tap the push → app opens to the customer's OrderDetailScreen for that order (deep-link routing via AuthBootstrap's new `order_partner_accepted` case).
6. On OrderDetailScreen, the new `PartnerIdentityCard` renders:
   - Initials avatar (e.g. "SD" for "Sudhir Davim") in the brand-color circle
   - Display name on the top line
   - "📦 Heading to the shop" subtitle (because `pickedUpAt` is still null)

**State transition — partner picks up, customer subtitle flips:**

7. Partner taps "I've picked it up" on their dashboard.
8. **Customer device:** the existing PR-NEXT-1 picked-up push fires ("Order picked up"). On OrderDetailScreen, the `PartnerIdentityCard` subtitle flips to "🛵 On the way to you" (driven by `pickedUpAt` now being a number).

**Defensive — partner without displayName:**

9. As a Windsurf-side smoke if you have a test partner whose `users/{uid}.displayName` is unset/empty: have them claim a pickup. Push body falls back to "Your delivery partner will pick up your order from <shopName>." Card avatar renders the 👤 fallback emoji; name reads "Your delivery partner."

**Concurrent claim — atomicity preserved:**

10. (Hard to test manually; if you have two test partner devices, attempt simultaneous claim on the same order.) Exactly one push should fire to the customer (the winning partner's). The losing partner sees `failed-precondition: "Already claimed by another delivery partner"`. The order doc has the winner's `deliveryPersonId` + `deliveryPersonName`.

**Privacy boundary — phone stays hidden:**

11. On the customer's OrderDetailScreen, the `PartnerIdentityCard` shows name but NOT phone. Verify by scrolling the whole screen — no phone number for the partner appears until `pickedUpAt` is set. Phone field was already gated pre-PR; this PR doesn't change that.

**Legacy orders — no regression:**

12. Open a delivered order that pre-dates this PR (no `deliveryPersonName` denormalized). OrderDetailScreen still renders correctly — the card renders with "Your delivery partner" fallback OR hides depending on whether `deliveryPersonId` was set on the legacy order. Confirm no crash, no missing-field warnings.

**Regression checks:**

13. `markPickedUp` still fires its own push (PR-NEXT-1) and doesn't double-fire with this new one — the two pushes are at different events.
14. `markDelivered` still fires its own pushes (PR-NEXT-1).
15. Customer OrderDetailScreen still renders the rating panel post-delivery (PR 42.1 territory; PR-NEXT-13a doesn't touch that branch).
16. `npx tsc --noEmit` clean (root + functions/).
17. `npm run test:unit` clean. Suite count up by §C.1 (4 helper tests) + §C.2 (4 snapshot tests) = ~8.
18. **Cloud Run IAM check:** `gcloud run services get-iam-policy claimdelivery --region asia-south1` — confirm `allUsers` / `roles/run.invoker`.

---

## Out of scope (explicit deferrals)

- **Partner profile photo upload flow.** Sudhir asked for "name/photo" but partner profile photos don't exist as a feature. Initials avatar is the v1 stand-in; real photo flow is a separate PR (would need partner-profile screen + storage rules + read-auth callable pattern, mirroring shop storefront + KYC).
- **Phone number disclosure on partner-accepted state.** Phone stays gated to post-pickup (existing behavior). If customer-side pilot feedback wants earlier phone access, file as a follow-up — privacy posture decision.
- **Push to shop owner / admin when partner claims.** Today shop owners track active orders on their dashboard via watcher; admin sees the same via `AdminOrdersScreen`. Neither needs a push for the claim event. If they ever want one, add fan-out branches inside `claimDelivery`'s post-transaction block.
- **Distance / ETA estimate in the push body.** Out of scope for v1. PR 50's geo plumbing could feed an "arriving at shop in ~X min" string in a future PR.
- **Customer-side "call partner" affordance on PartnerIdentityCard.** Today phone access flows through the existing post-pickup UI; not adding a new call surface here.
- **Animated transition from avatar-circle to a real photo when one becomes available.** Future polish.

---

## Deploy plan

**Step 1 — Server-first:**

```
cd functions
npm run build
firebase deploy --only "functions:claimDelivery"
```

Wait for green. Verify Cloud Run IAM:

```
gcloud run services get-iam-policy claimdelivery --region asia-south1
```

If `allUsers` binding missing, add:

```
gcloud run services add-iam-policy-binding claimdelivery \
  --region asia-south1 \
  --member=allUsers \
  --role=roles/run.invoker
```

**Step 2 — Client OTA:**

```
npx tsc --noEmit            # clean
npm run test:unit           # all green; record suite count delta
git commit -m "PR-NEXT-13a: partner-accept push + partner identity card"
eas update --branch production --message "PR-NEXT-13a partner-accept push"
```

Pull on installed devices → run the 18-step acceptance checklist.

---

## Doc trail updates after ship

- `docs/TESTING-FINDINGS-2026-05-30.md` — under finding #13, flip sub-(a) to `✅ SHIPPED in PR-NEXT-13a (June 1 2026)` with a one-paragraph note: customer push + denormalized partner name on order doc + PartnerIdentityCard with initials avatar.
- `docs/SESSION_LOG.md` — one-paragraph entry covering the design choice (initials avatar not real photo, phone stays gated), server denormalization rationale (single-doc read on the customer side), the new push type + AuthBootstrap routing addition.
- `CLAUDE.md` — bump date; brief note that the customer-visible delivery flow now has an explicit "partner accepted" state between ready_for_pickup and picked_up.
- `PRELAUNCH_CHECKLIST.md` — short note under PR-NEXT-1's push fan-out block.
