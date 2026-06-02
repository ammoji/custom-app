# PR-NEXT-NOTIFY-EXTEND — Shopkeeper + admin pushes on partner-claim and pickup

**Source:** Cases 5 and 7 in Sudhir's June 1 testing pass. The current code only emits CUSTOMER pushes from `claimDelivery` (PR-NEXT-13a) and `markPickedUp` (PR-NEXT-1). Sudhir wants shopkeeper + admin to also be notified so they have full visibility into order progress.

**Note:** Customer-side pushes are FCM-blocked on Android right now (separate issue being debugged). This PR adds emissions for shopkeeper + admin audiences who are on iOS in your pilot setup — those WILL work immediately.

**Deploy class:** server-first + client OTA.

1. `firebase deploy --only "functions:claimDelivery,functions:markPickedUp"`
2. IAM verify on both (recurring `allUsers` gotcha — both functions already deployed but re-check after this change since Cloud Run revisions sometimes drop the binding)
3. `eas update --branch production`

**Read first**

1. `CLAUDE.md`
2. `.windsurf/code-discipline.md` Rules 3, 4, 11
3. `functions/src/index.ts` lines 3580–3700 — `claimDelivery` (PR-NEXT-13a's post-transaction block is the template; extend it)
4. `functions/src/index.ts` lines 3703–3805 — `markPickedUp` (similar template — PR-NEXT-1's post-write push block)
5. `functions/src/index.ts` lines 3677–3705 — `markDelivered`'s `pushToOwner` + `pushToAdmins` pattern. **THIS is the exact template** for what we add to `claimDelivery` and `markPickedUp`.
6. `src/components/AuthBootstrap.tsx` lines 299–377 — push-type routing table. Adds two new type cases + audience routing.

---

## Plan

### §A — Extend `claimDelivery` with shop owner + admin pushes (Case 5)

Inside the existing post-transaction block in `claimDelivery` (after the existing `pushToUser(customerUid, ...)` block ending at line ~3697, before `return { ok: true };`):

```ts
// PR-NEXT-NOTIFY-EXTEND (Case 5) — shopkeeper notification on partner
// claim. Pre-PR the shop owner only learned a partner had accepted
// the pickup when watching their dashboard. Now we fire an explicit
// push mirroring `markDelivered`'s shopkeeper pattern. Best-effort
// (.catch) — failure must NOT roll back the claim above.
//
// `orderShopId` captured inside the transaction (same as customerUid
// + orderShopName). Add a third capture if it's not already there.
if (orderShopId) {
  const shopSnap = await db.doc(`shops/${orderShopId}`).get();
  const ownerUid = shopSnap.data()?.ownerUid as string | undefined;
  if (ownerUid) {
    const namePart = partnerDisplayName ?? 'A delivery partner';
    pushToOwner(
      ownerUid,
      '🛵 Pickup partner assigned',
      `${namePart} will pick up order #${orderId.slice(0, 6)}`,
      {
        orderId,
        shopId: orderShopId,
        // Type name pinned: server emit here + AuthBootstrap routing
        // + this acceptance doc.
        type: 'order_partner_assigned',
      },
    ).catch(e =>
      console.warn('[claimDelivery] pushToOwner failed (non-fatal):', e),
    );
  }
}

// PR-NEXT-NOTIFY-EXTEND (Case 5) — admin notification. Same posture
// as shopkeeper; admin sees the assignment for cross-pilot oversight.
pushToAdmins(
  '🛵 Pickup partner assigned',
  `Order #${orderId.slice(0, 6)} claimed by ${partnerDisplayName ?? 'a partner'}`,
  {
    orderId,
    shopId: orderShopId ?? '',
    type: 'order_partner_assigned',
  },
).catch(e =>
  console.warn('[claimDelivery] pushToAdmins failed (non-fatal):', e),
);
```

**Capture `orderShopId` inside the transaction** — add this line in the `tx.get(ref)` block where `customerUid` + `orderShopName` are already being captured (around line 3636):

```ts
let orderShopId: string | undefined;
// ... inside the transaction's snap.data() handling:
orderShopId =
  typeof order.shopId === 'string' ? order.shopId : undefined;
```

### §B — Extend `markPickedUp` with shop owner + admin pushes (Case 7)

Inside `markPickedUp`, after the existing `pushToUser(customerUid, ...)` block at line ~3771–3790 and before `return { ok: true };`:

```ts
// PR-NEXT-NOTIFY-EXTEND (Case 7) — shopkeeper + admin notifications
// on pickup. Pre-PR only the customer learned about pickup. Now we
// also notify the shop (so they can mark inventory off / close the
// loop in their head) and admin (for cross-pilot oversight). Same
// best-effort posture as PR-NEXT-1's customer push above.
//
// Capture `shopId` from the read at the top of the function — it's
// already available in `snap.data()`.
const shopId =
  typeof (snap.data() as { shopId?: unknown }).shopId === 'string'
    ? ((snap.data() as { shopId: string }).shopId)
    : null;
if (shopId) {
  const shopSnap = await db.doc(`shops/${shopId}`).get();
  const ownerUid = shopSnap.data()?.ownerUid as string | undefined;
  if (ownerUid) {
    pushToOwner(
      ownerUid,
      '📦 Order picked up',
      `Order #${orderId.slice(0, 6)} is on the way to the customer`,
      {
        orderId,
        shopId,
        type: 'order_picked_up',  // existing type — shop is now a valid audience
      },
    ).catch(e =>
      console.warn('[markPickedUp] pushToOwner failed (non-fatal):', e),
    );
  }
}
pushToAdmins(
  '📦 Order picked up',
  `Order #${orderId.slice(0, 6)} picked up by partner`,
  {
    orderId,
    shopId: shopId ?? '',
    type: 'order_picked_up',
  },
).catch(e =>
  console.warn('[markPickedUp] pushToAdmins failed (non-fatal):', e),
);
```

`order_picked_up` is the EXISTING push type (PR-NEXT-1 used it for the customer push). Now the audience expands — shopkeeper and admin can also receive it. AuthBootstrap's existing routing for `order_picked_up` sends to `OrderDetail` (customer). We need to update it to audience-aware (§C).

### §C — Update AuthBootstrap routing for the new type + extend existing type

In `src/components/AuthBootstrap.tsx`, inside the extracted `handleNotificationResponse` (post-HOTFIX-5):

**Add NEW case for `order_partner_assigned`:**

```ts
// PR-NEXT-NOTIFY-EXTEND (Case 5) — partner-assigned push. Audience
// is shop owner or admin (claim-dispatched). Customer doesn't
// receive this type (their parallel push is `order_partner_accepted`
// from PR-NEXT-13a).
if (type === 'order_partner_assigned') {
  if (auth.isShopOwner && pushShopId && pushShopId === auth.shopId) {
    safeNavigate('ShopOrderDetail', { orderId });
    return;
  }
  if (auth.isAdmin) {
    safeNavigate('AdminOrders');
    return;
  }
  // Defensive fall-through — shouldn't normally happen.
  return;
}
```

**Extend EXISTING `order_picked_up` case** (currently customer-only at line 309–314) to handle shop owner + admin audiences:

```ts
if (type === 'order_picked_up') {
  // PR-NEXT-1 emitted only to customer. PR-NEXT-NOTIFY-EXTEND also
  // emits to shop owner + admin. Audience precedence: shopOwner-of-
  // this-shop > admin > customer.
  if (auth.isShopOwner && pushShopId && pushShopId === auth.shopId) {
    safeNavigate('ShopOrderDetail', { orderId });
    return;
  }
  if (auth.isAdmin) {
    safeNavigate('AdminOrders');
    return;
  }
  safeNavigate('OrderDetail', { orderId });
  return;
}
```

### §D — Pure helpers (none needed)

The fan-out logic mirrors `markDelivered`'s pattern exactly. No new pure helper extraction — the changes are inside the callable wrappers.

### §E — Tests

No new pure-helper tests (no pure helpers added). Existing `claimDeliveryHelpers.test.ts` and any push-helper tests stay green. Manual acceptance covers the new audiences.

---

## Discipline checklist

1. **Rule 1** — No new imports needed (`pushToOwner` / `pushToAdmins` already imported in `index.ts`).
2. **Rule 3 — Server-first deploy.** Functions deploy + IAM verify, then client OTA.
3. **Rule 4 — Schema-additive only.** No order doc fields changed.
4. **Rule 11 — Identity-aware gating.** All audience routing reads claims at tap time.
5. **Cloud Run IAM** — re-verify on both `claimdelivery` and `markpickedup` after deploy.

---

## Acceptance checklist

Need 3 accounts: customer (Android, FCM-blocked — skip customer-side checks here), shopkeeper (iOS, APNs works), admin (iOS).

**Case 5 — partner claim notifies shopkeeper + admin:**

1. Shopkeeper opens app, sends to background. Admin same.
2. Customer places order; shop accepts → preparing → ready_for_pickup.
3. Delivery partner taps Accept on the available pickup.
4. **Shopkeeper iOS device receives push:** "🛵 Pickup partner assigned — [partner name] will pick up order #abc123". Tap → routes to `ShopOrderDetail`.
5. **Admin iOS device receives push:** "🛵 Pickup partner assigned — Order #abc123 claimed by [partner name]". Tap → routes to `AdminOrders`.

**Case 7 — pickup notifies shopkeeper + admin:**

6. Partner taps "I've picked it up."
7. **Shopkeeper iOS device receives push:** "📦 Order picked up — Order #abc123 is on the way to the customer". Tap → routes to `ShopOrderDetail`.
8. **Admin iOS device receives push:** "📦 Order picked up — Order #abc123 picked up by partner". Tap → routes to `AdminOrders`.

**Regression — customer push still emitted (works on iOS customers; Android customer FCM-blocked):**

9. If you have an iOS customer test device, confirm customer still gets the `order_partner_accepted` and `order_picked_up` pushes that PR-NEXT-13a / PR-NEXT-1 set up.

**Regression — markDelivered's shop + admin still work:**

10. Partner taps Delivered. Shopkeeper iOS receives "Order delivered" push (existing PR-NEXT-1 path). Admin too.

**Atomic claim race preserved:**

11. (Optional) Two delivery test accounts try to claim the same order simultaneously. Exactly one wins; only the winner's shop + admin push fires.

**Test suite:**

12. `cd functions && npm run build && npm run test:unit` clean
13. `npm run test:unit` (root) clean

**IAM:**

14. `gcloud run services get-iam-policy claimdelivery --region asia-south1` — `allUsers` confirmed.
15. `gcloud run services get-iam-policy markpickedup --region asia-south1` — `allUsers` confirmed.

---

## Out of scope

- **Delivery partner pushes on shop accepted/preparing transitions** (Sudhir's Case 3 partial — partner wanting earlier visibility). Deferred — needs design on whether to push to ALL online partners or just radius-filtered, plus a new push channel (partners aren't currently in the sendOrderStatusPush trigger fan-out).
- **Notification preferences** (let users disable specific types). Punt to post-pilot.
- **Notification grouping** (multiple events for the same order collapsing). Punt.

---

## Deploy plan

```
cd functions
npm run build
firebase deploy --only "functions:claimDelivery,functions:markPickedUp"

gcloud run services get-iam-policy claimdelivery --region asia-south1
gcloud run services get-iam-policy markpickedup --region asia-south1

# Then client OTA
eas update --branch production --message "PR-NEXT-NOTIFY-EXTEND shop+admin on claim+pickup"
```

## Doc trail

- `docs/TESTING-FINDINGS-2026-05-30.md` — Cases 5 + 7 partials → `✅ SHIPPED in PR-NEXT-NOTIFY-EXTEND`. Note customer-side picked-up push is FCM-blocked separately.
- `docs/SESSION_LOG.md` — one paragraph.
- `CLAUDE.md` — bump date.
