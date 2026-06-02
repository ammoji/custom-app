# PR-NEXT-PARTNER-VIS — Show distance + delivery charge on available-pickup card

**Source:** Case 4 in Sudhir's June 1 testing pass. *"As a delivery person before accepting, it will help me if we can show the total distance 'pickup from' and 'deliver to' plus calculated delivery charges. That way it will be full visibility to delivery partner before accepting the order."*

**Deploy class:** pure client OTA. No callable, no schema.

**Read first**

1. `CLAUDE.md`
2. `.windsurf/code-discipline.md` Rules 1, 2
3. `src/screens/delivery/DeliveryDashboardScreen.tsx` lines 1113–1159 — `AvailablePickupCard` (the target render surface)
4. `src/utils/deliveryRoutingHelpers.ts` — `rideLegsForOrder` + `RideDistanceLine` already exist (PR 49). Distance lines already render on the available card at line 1151.
5. `src/types/index.ts` — `Order.deliveryFee` field (stamped at placeOrder time)

---

## Root cause

Available pickup card today shows shop name + drop address + distance (PR 49's `RideDistanceLine`) + item count + total. **The delivery partner's earnings (the `deliveryFee` charge customer paid) are NOT displayed.** Partner has to tap into detail to see what they'd earn. Pre-decision opacity = inefficient claims.

---

## Plan

### §A — Add earnings line to `AvailablePickupCard`

In `src/screens/delivery/DeliveryDashboardScreen.tsx` `AvailablePickupCard` (lines 1113–1159), add one line below `<RideDistanceLine legs={legs} />` (line 1151), above `<DeliveryLocationLabel order={order} />`:

```tsx
{/* PR-NEXT-PARTNER-VIS (Case 4) — pre-claim earnings visibility.
    `order.deliveryFee` is stamped at placeOrder time from the
    distance-based tier (PR 47). Showing it here lets the partner
    accept based on a known compensation, not a guess. */}
{typeof order.deliveryFee === 'number' && order.deliveryFee > 0 && (
  <Text style={styles.earningsLine}>
    💰 Earn {formatRupees(order.deliveryFee)}
  </Text>
)}
```

Add the style entry near the other card text styles (search for `meta:` / `address:`):

```ts
earningsLine: {
  ...typography.bodyBold,
  color: colors.primaryDark,
  marginTop: spacing.xs,
},
```

Visual emphasis: bold + brand color, so it reads as the headline incentive.

### §B — Also add to `ActiveDeliveryCard` (the post-claim card)

Same one-line addition in `ActiveDeliveryCard` (search the file for `ActiveDeliveryCard` definition). Once claimed, the partner still benefits from seeing the agreed earnings — reduces "wait, what was this?" thrash on multi-pickup days.

### §C — Distance is already there

`RideDistanceLine` from PR 49 already renders "Shop → You: X km · Drop → You: Y km · Total Z km" (or similar — verify by reading `rideLegsForOrder` + `RideDistanceLine` to confirm the format). If the format is non-obvious, add a small comment over the existing line clarifying that PR-NEXT-PARTNER-VIS relies on it for distance display.

If the existing distance display omits the "pickup from" leg (partner → shop), extend `rideLegsForOrder` to include it explicitly. Verify by reading `deliveryRoutingHelpers.ts` first; only modify if needed.

---

## Discipline checklist

1. **Rule 1** — `formatRupees` already imported.
2. **Rule 2** — N/A (no new hooks).
3. **No schema, no callable.**
4. **No new tests** — purely a one-line render addition. Manual acceptance covers it.
5. **OTA classification** — pure JS.

---

## Acceptance checklist

1. Sign in as delivery partner. Open Delivery Dashboard with the available-pickup section visible.
2. A pickup card shows: shop name, drop address, `RideDistanceLine`, **`💰 Earn ₹X`**, item count + total, "Tap to view items & accept".
3. ₹X matches the `deliveryFee` stamped on the order at placeOrder time (verifiable in Firestore Console: `orders/{orderId}.deliveryFee`).
4. After tapping Accept → in the "My Deliveries" section, the same `💰 Earn ₹X` line appears on the active card too.
5. Legacy orders without `deliveryFee` (pre-PR-47) — line hides cleanly (the `typeof === 'number' && > 0` guard).
6. `npx tsc --noEmit` clean; `npm run test:unit` unchanged (no new tests).

---

## Out of scope

- **Cumulative shift earnings widget** ("today's deliveries · ₹X total"). Separate dashboard enhancement.
- **Per-km / per-tier explanation** ("₹60 because you're in the 3-5km tier"). Not needed; the headline number is the decision input.
- **Surge / peak-hours bonus** display. Not yet implemented as a feature.

---

## Deploy

```
eas update --branch production --message "PR-NEXT-PARTNER-VIS pre-claim distance + earnings"
```

## Doc trail

- `docs/TESTING-FINDINGS-2026-05-30.md` — Case 4 → `✅ SHIPPED in PR-NEXT-PARTNER-VIS`.
- `docs/SESSION_LOG.md` — one paragraph.
- `CLAUDE.md` — bump date.
