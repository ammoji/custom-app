# PR-NEXT-COD-UX — Smart Delivered gating + Cash/UPI pills on detail screen

**Source:** Case 8 in Sudhir's June 1 testing pass. *"Delivery dashboard shows 'add delivery proof', cash received and UPI received options there. when I clicked on that card, it opened details about order and shows me delivered option enabled at the bottom. I clicked on delivered option and it gave error message about payment first. But why we are even giving delivered options at all if payment part is not done yet? Also giving few options at card and 1 option inside the card (at detail level) is also not good experience."*

Two distinct UX issues bundled:

1. **Delivered button is enabled for COD-unpaid orders on the detail screen** — server (PR-NEXT-3 §E `validateMarkDeliveredCodGate`) correctly rejects, but client should gate this BEFORE the user taps and gets an error.
2. **Action affordances split across surfaces** — Cash/UPI pills only on dashboard card, Delivered only on detail screen. Partner has to bounce between surfaces to complete the flow.

**Deploy class:** pure client OTA.

**Read first**

1. `CLAUDE.md`
2. `.windsurf/code-discipline.md` Rules 1, 2
3. `src/screens/delivery/DeliveryDashboardScreen.tsx` `ActiveDeliveryCard` (lines 1232+) — dashboard render with the current pills + Delivered button
4. `src/screens/delivery/DeliveryOrderDetailScreen.tsx` — detail screen render
5. `src/screens/delivery/DeliveryOrderDetailScreen.useDeliveryOrderDetail.ts` — handlers
6. `functions/src/codPaymentHelpers.ts` `validateMarkDeliveredCodGate` — server gate (already correct)

---

## Plan

### §A — Client-side COD gate for Delivered button (both surfaces)

Pure helper that mirrors the server gate. Add `src/utils/codDeliveryGate.ts`:

```ts
/**
 * PR-NEXT-COD-UX (Case 8) — client-side mirror of
 * `validateMarkDeliveredCodGate` from `functions/src/codPaymentHelpers.ts`.
 * Hides the Delivered CTA when COD is unpaid; surface stays consistent
 * across dashboard card + detail screen. Server is the gate of record;
 * this is purely cosmetic to prevent the dead-tap-then-error UX.
 *
 * Returns true → Delivered button safe to show
 * Returns false → show Cash/UPI pills instead
 */
import type { Order } from '../types';

export function canShowDeliveredButton(
  order: Pick<Order, 'paymentMethod' | 'paymentStatus'>,
): boolean {
  // Online + paid → safe to deliver (no payment dance needed)
  if (order.paymentMethod === 'online' && order.paymentStatus === 'paid') {
    return true;
  }
  // COD + already-paid (via Cash/UPI pill OR via payCodOrder conversion) → safe
  if (order.paymentMethod === 'cod' && order.paymentStatus === 'paid') {
    return true;
  }
  // Anything else (COD unpaid, online unpaid) → hide Delivered, surface
  // payment action instead.
  return false;
}
```

Test pin (~6 cases): online+paid, online+pending, cod+paid (via cash), cod+paid (via online), cod+pending, cod+failed.

### §B — Dashboard card: already correct (smart pills appear when needed)

Verify `ActiveDeliveryCard` already shows the smart pills (Cash/UPI) when COD is unpaid (per PR-NEXT-3 §H). No change there.

Add the gate to its Delivered button — pre-PR the button always renders; post-PR it only renders when `canShowDeliveredButton(order)` is true:

```tsx
{canShowDeliveredButton(order) && (
  <Button title="Delivered" onPress={onDelivered} ... />
)}
```

(Wrap whatever the current Delivered button render looks like on the active card.)

### §C — Detail screen: duplicate Cash/UPI pills + apply Delivered gate

In `DeliveryOrderDetailScreen.tsx`, find where the existing Delivered button is rendered. Add the same Cash/UPI pills that the dashboard card has, gated on the same conditions (`needsCodConfirmation`). Reuse the handler.

Find the handler in `DeliveryOrderDetailScreen.useDeliveryOrderDetail.ts`:
- If `onConfirmCodPayment` exists, hook it up to the new pills
- If not, thread the handler down from the parent or import it from `DeliveryDashboardScreen`'s level state (the handler is currently at the dashboard level — may need to lift to a shared service or duplicate the orchestration)

Cleanest: extract `handleConfirmCodPayment` from `DeliveryDashboardScreen` into a reusable hook (`src/hooks/useConfirmCodPayment.ts`) that both surfaces can call. Optimistic update + server call + error handling stays identical.

```ts
// src/hooks/useConfirmCodPayment.ts (new)
import { useState } from 'react';
import { Alert } from 'react-native';
import { orderService } from '../services/orderService';
import type { Order } from '../types';

export function useConfirmCodPayment(opts: {
  onSuccess?: (order: Order, paidMethod: 'cash' | 'online') => void;
}) {
  const [submitting, setSubmitting] = useState(false);

  const confirm = async (order: Order, paidMethod: 'cash' | 'online') => {
    setSubmitting(true);
    try {
      const result = await orderService.confirmCodPayment({
        orderId: order.id,
        paidMethod,
      });
      if (result.alreadyPaid) {
        Alert.alert(
          'Customer paid online',
          'No cash to collect — the customer paid online while you were on the way.',
        );
      }
      opts.onSuccess?.(order, paidMethod);
    } catch (e: any) {
      Alert.alert(
        'Payment confirmation failed',
        e?.message ?? 'Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return { confirm, submitting };
}
```

Wire both `DeliveryDashboardScreen`'s ActiveDeliveryCard and `DeliveryOrderDetailScreen` to use this hook. The optimistic local state update (`setMine(prev => prev.map(...))`) stays where it lives (different parent state on each surface).

Add Cash/UPI pills to `DeliveryOrderDetailScreen`'s render at the same logical place as the Delivered button (probably near the bottom action area). Apply the same `needsCodConfirmation` condition.

### §D — Pure helper test

`tests/utils/codDeliveryGate.test.ts` — 6 cases per §A.

---

## Discipline checklist

1. **Rule 1** — All new imports carry "DO NOT REMOVE" comments.
2. **Rule 2** — Hooks above conditionals on both screens.
3. **No schema, no callable.**
4. **Test discipline** — +6 helper tests.
5. **OTA classification** — pure JS.

---

## Acceptance checklist

Place a fresh COD order; walk it to ready_for_pickup.

**Dashboard card flow (regression):**

1. Partner accepts, marks picked up. Active card shows Cash / UPI pills. Delivered button is HIDDEN (post-PR-NEXT-COD-UX gate).
2. Tap Cash. Server stamps `paymentStatus: 'paid' + paidMethod: 'cash'`. Pills disappear, Delivered button NOW appears.
3. Tap Delivered. Order completes.

**Detail screen flow (new):**

4. Place another COD order; partner picks it up.
5. Tap the active card to open detail screen.
6. Detail screen now shows the SAME Cash / UPI pills (new). Delivered button is HIDDEN.
7. Tap UPI on the detail screen. Same backend flow as the dashboard pill. Pills disappear; Delivered button appears.
8. Tap Delivered without bouncing back to dashboard. Order completes.

**Online order regression:**

9. Place an online prepaid order (or simulate by manually setting `paymentStatus: 'paid'` + `paymentMethod: 'online'` in Firestore Console). Partner picks up.
10. Dashboard card AND detail screen both show ONLY the Delivered button — no Cash/UPI pills. Tap Delivered → completes immediately.

**Sync between surfaces:**

11. Open detail screen. Confirm Cash on the detail screen. Go back to dashboard. Active card now shows Delivered button (no pills).

**Test suite:**

12. `npx tsc --noEmit` clean; `npm run test:unit` clean; suite +6.

---

## Out of scope

- **Refactoring the `ActiveDeliveryCard` and detail screen into a shared layout.** Different surfaces, different needs (card is summary, detail is full).
- **Receipt generation** at COD payment time. Punt.

---

## Deploy

```
npx tsc --noEmit
npm run test:unit
eas update --branch production --message "PR-NEXT-COD-UX smart Delivered gating + detail pills"
```

## Doc trail

- `docs/TESTING-FINDINGS-2026-05-30.md` — Case 8 → `✅ SHIPPED in PR-NEXT-COD-UX`.
- `docs/SESSION_LOG.md` — one paragraph.
- `CLAUDE.md` — bump date.
