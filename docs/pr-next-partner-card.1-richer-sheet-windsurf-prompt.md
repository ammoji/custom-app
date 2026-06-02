# PR-NEXT-PARTNER-CARD.1 — Richer PartnerDetailsSheet (ride distance + ETA + order ID + phone)

**Source:** Sudhir's June 1 retest of PARTNER-CARD. *"See screen shot. No detail other than shop and close button is covered."* Screenshot showed only: avatar + name + state + "Picking up from: US Shoppers" + Close. After pickup the "Phone shared after pickup" row hides too, leaving the sheet nearly empty.

PARTNER-CARD shipped the tappable card + the sheet shell with intentional restraint (phone reveal deliberately deferred). Sudhir is right that what's left is too thin to justify the tap. This PR fills the sheet out with information already on the order doc, plus a new server-gated phone reveal.

**Deploy class:** **server-first** (new `getDeliveryPartnerContact` callable) → IAM verify → client OTA bundling sheet UI.

**Read first**

1. `CLAUDE.md`
2. `.windsurf/code-discipline.md` Rules 1, 2, 11
3. `.windsurf/deploy-discipline.md` — Cloud Run `allUsers` IAM section
4. `src/components/order/PartnerDetailsSheet.tsx` — the lean shell to enrich
5. `src/types/index.ts` lines 440–545 — `deliveryDistanceKm`, `deliveryDurationMin`, `deliveryPersonName`, `pickedUpAt`, `deliveredAt`, `id` already on the doc
6. `src/screens/OrderDetailScreen.tsx` lines 880–900 — current `<PartnerDetailsSheet />` wiring
7. `functions/src/index.ts` — find a peer callable (`getOrderEta`, `confirmCodPayment`) to mirror the structure of the new `getDeliveryPartnerContact`
8. `functions/src/codPaymentHelpers.ts` — pure helper / validator pattern (Validator-Result)

---

## What's available without any new server work

The order doc already carries:

- `id` — full doc id; surface last 8 chars as the readable handle
- `deliveryPersonName` — already shown
- `deliveryDistanceKm` — shop → drop leg in km
- `deliveryDurationMin` — estimated drive time
- `pickedUpAt` / `deliveredAt` — state markers

Everything except the partner's phone is in-hand for an enriched sheet.

---

## Plan

### §A — Add ride-distance + ETA rows to the sheet

In `src/components/order/PartnerDetailsSheet.tsx`, extend the `Props` type:

```tsx
type Props = {
  visible: boolean;
  onClose: () => void;
  partnerName?: string | null;
  pickedUpAt: number | null;
  shopName?: string | null;
  // PR-NEXT-PARTNER-CARD.1 additions:
  orderShortId?: string;                // last 8 chars of order.id
  deliveryDistanceKm?: number | null;   // order.deliveryDistanceKm
  deliveryDurationMin?: number | null;  // order.deliveryDurationMin
  partnerPhone?: string | null;         // null until reveal fetches it
  onRevealPhone?: () => void;           // tap "Show phone" → parent calls callable
  revealing?: boolean;                  // spinner gate
};
```

Add rows between the existing "Picking up from" row and the Close button:

```tsx
{typeof orderShortId === 'string' && orderShortId.length > 0 && (
  <View style={styles.row}>
    <Text style={styles.rowLabel}>Order</Text>
    <Text style={styles.rowValue} numberOfLines={1}>
      #{orderShortId}
    </Text>
  </View>
)}
{typeof deliveryDistanceKm === 'number' && deliveryDistanceKm > 0 && (
  <View style={styles.row}>
    <Text style={styles.rowLabel}>Drop distance</Text>
    <Text style={styles.rowValue}>{deliveryDistanceKm.toFixed(1)} km</Text>
  </View>
)}
{typeof deliveryDurationMin === 'number' && deliveryDurationMin > 0 && (
  <View style={styles.row}>
    <Text style={styles.rowLabel}>
      {pickedUpAt != null ? 'Arriving in' : 'Drive time'}
    </Text>
    <Text style={styles.rowValue}>~{Math.round(deliveryDurationMin)} min</Text>
  </View>
)}
```

### §B — Phone reveal — pre-pickup unchanged, post-pickup adds a "Show phone" CTA

Replace the existing `{pickedUpAt == null && …}` phone row with a 3-branch render:

```tsx
{pickedUpAt == null ? (
  <View style={styles.row}>
    <Text style={styles.rowLabel}>Phone</Text>
    <Text style={styles.rowValueMuted}>
      Shared once the order is picked up
    </Text>
  </View>
) : partnerPhone ? (
  <View style={styles.row}>
    <Text style={styles.rowLabel}>Phone</Text>
    <Pressable
      onPress={() => Linking.openURL(`tel:${partnerPhone}`)}
      accessibilityRole="link"
      accessibilityLabel={`Call delivery partner ${partnerPhone}`}
    >
      <Text style={[styles.rowValue, styles.phoneLink]}>📞 {partnerPhone}</Text>
    </Pressable>
  </View>
) : onRevealPhone ? (
  <Pressable
    onPress={onRevealPhone}
    disabled={revealing}
    accessibilityRole="button"
    style={({ pressed }) => [
      styles.revealBtn,
      pressed && { opacity: 0.85 },
      revealing && { opacity: 0.6 },
    ]}
  >
    <Text style={styles.revealBtnText}>
      {revealing ? 'Loading…' : 'Show partner phone'}
    </Text>
  </Pressable>
) : null}
```

Add `Linking` to the imports. Add `phoneLink`, `revealBtn`, `revealBtnText` style entries (mirror the existing `closeBtn` / `closeBtnText` styling pattern).

### §C — New callable `getDeliveryPartnerContact`

In `functions/src/partnerContactHelpers.ts` (new file):

```ts
/**
 * PR-NEXT-PARTNER-CARD.1 — server gate for revealing the delivery
 * partner's phone number to the customer. Two posture decisions:
 *
 *  1. Phone is NOT denormalized onto the order doc, so a customer
 *     fetch of the order via getOrder / Firestore listener never
 *     leaks it. The reveal is an explicit pull — the customer must
 *     tap "Show partner phone" in the details sheet, which calls
 *     this callable.
 *  2. Reveal is gated to (a) caller is the order's customerId,
 *     (b) order has a deliveryPersonId, (c) order has been picked
 *     up (`pickedUpAt != null`). Pre-pickup remains opaque on the
 *     customer side, matching the long-standing privacy posture
 *     called out in PartnerIdentityCard's lead comment.
 *
 * Returns just `{ phone }` — no name, no rating, no location.
 * Audit log: function-scoped `console.info` is enough for pilot;
 * formal reveal-audit collection can come later if abuse signal
 * appears.
 */
import * as admin from 'firebase-admin';
import type { Result } from './validatorResult';

export type GetDeliveryPartnerContactResult =
  | Result<{ phone: string }>
  | Result<never, 'order_not_found' | 'not_customer' | 'no_partner' | 'not_picked_up' | 'no_phone_on_partner'>;

export async function getDeliveryPartnerContactPure(args: {
  orderId: string;
  callerUid: string;
  db: admin.firestore.Firestore;
  auth: admin.auth.Auth;
}): Promise<GetDeliveryPartnerContactResult> {
  const snap = await args.db.collection('orders').doc(args.orderId).get();
  if (!snap.exists) return { ok: false, code: 'order_not_found' };
  const order = snap.data() as any;
  if (order?.customerId !== args.callerUid) {
    return { ok: false, code: 'not_customer' };
  }
  if (typeof order?.deliveryPersonId !== 'string' || order.deliveryPersonId.length === 0) {
    return { ok: false, code: 'no_partner' };
  }
  // pickedUpAt is a Firestore Timestamp on the doc; presence is the gate.
  if (order?.pickedUpAt == null) {
    return { ok: false, code: 'not_picked_up' };
  }
  const partner = await args.auth.getUser(order.deliveryPersonId);
  const phone = partner.phoneNumber;
  if (typeof phone !== 'string' || phone.length === 0) {
    return { ok: false, code: 'no_phone_on_partner' };
  }
  return { ok: true, value: { phone } };
}
```

In `functions/src/index.ts`, register the callable next to the other order-side callables. Reuse the existing `mapResultToHttpsError` (or whichever helper turns `Result` failures into HttpsErrors — read a peer like `confirmCodPayment` to mirror the style):

```ts
export const getDeliveryPartnerContact = onCall(
  { region: 'asia-south1' },
  async req => {
    if (!req.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Sign in required.');
    }
    const orderId = String((req.data as any)?.orderId ?? '');
    if (orderId.length === 0) {
      throw new HttpsError('invalid-argument', 'orderId required.');
    }
    const result = await getDeliveryPartnerContactPure({
      orderId,
      callerUid: req.auth.uid,
      db: admin.firestore(),
      auth: admin.auth(),
    });
    if (!result.ok) {
      switch (result.code) {
        case 'order_not_found':
          throw new HttpsError('not-found', 'Order not found.');
        case 'not_customer':
          throw new HttpsError('permission-denied', 'Not your order.');
        case 'no_partner':
        case 'not_picked_up':
          throw new HttpsError('failed-precondition', 'Partner phone is shared after pickup.');
        case 'no_phone_on_partner':
          throw new HttpsError('not-found', 'Partner has no phone on file.');
      }
    }
    return result.value;
  },
);
```

### §D — Client service

In `src/services/orderService.ts`, add:

```ts
async getDeliveryPartnerContact(orderId: string): Promise<{ phone: string }> {
  if (isNative) {
    const fn = getNativeFunctions().httpsCallable('getDeliveryPartnerContact');
    const result = await fn({ orderId });
    return result.data as { phone: string };
  }
  const fn = httpsCallable<{ orderId: string }, { phone: string }>(
    functions,
    'getDeliveryPartnerContact',
  );
  const result = await fn({ orderId });
  return result.data;
},
```

### §E — Wire up OrderDetailScreen

In `src/screens/OrderDetailScreen.tsx`, add local state + handler:

```tsx
const [partnerPhone, setPartnerPhone] = useState<string | null>(null);
const [revealingPhone, setRevealingPhone] = useState(false);

const revealPhone = useCallback(async () => {
  setRevealingPhone(true);
  try {
    const { phone } = await orderService.getDeliveryPartnerContact(order.id);
    setPartnerPhone(phone);
  } catch (e: any) {
    Alert.alert(
      'Could not load phone',
      e?.message ?? 'Please try again in a moment.',
    );
  } finally {
    setRevealingPhone(false);
  }
}, [order.id]);
```

Then thread the new props into the sheet:

```tsx
<PartnerDetailsSheet
  visible={partnerSheetOpen}
  onClose={() => setPartnerSheetOpen(false)}
  partnerName={order.deliveryPersonName}
  pickedUpAt={typeof order.pickedUpAt === 'number' ? order.pickedUpAt : null}
  shopName={order.shopName}
  orderShortId={order.id.slice(-8).toUpperCase()}
  deliveryDistanceKm={order.deliveryDistanceKm ?? null}
  deliveryDurationMin={order.deliveryDurationMin ?? null}
  partnerPhone={partnerPhone}
  revealing={revealingPhone}
  onRevealPhone={revealPhone}
/>
```

Reset `partnerPhone` to `null` when the order id changes (different order opened) — useEffect on `order.id`.

### §F — Tests

`tests/functions/getDeliveryPartnerContact.test.ts` — pin all five failure codes + the happy path against the pure helper (Validator-Result pattern, mirrors `validateMarkDeliveredCodGate`'s tests).

No client unit test for the sheet — purely presentational. Acceptance covers it.

---

## Discipline checklist

1. **Rule 1** — `Linking` + `PartnerDetailsSheet` import + new state useState + new callable import carry "DO NOT REMOVE" comments.
2. **Rule 2** — `partnerPhone` + `revealingPhone` useState sit with the other top-level useStates above any conditional return.
3. **Rule 11** — IAM verification step REQUIRED after deploying `getDeliveryPartnerContact`. Cloud Run `allUsers` strip is a known repeat hazard.
4. **Schema-additive on the wire** — `getDeliveryPartnerContact` is a new callable, returns the minimum shape `{ phone }`. No order-doc schema change.
5. **Test discipline** — 5 negative + 1 positive = 6 new function tests pinning the gate.

---

## Acceptance checklist

**Pre-pickup**

1. Customer places COD order, shopkeeper accepts, partner claims (but doesn't pick up). Customer opens OrderDetail, taps the partner card.
2. Sheet now shows: avatar, name, state ("📦 Heading to the shop"), Order #ABCD1234, Drop distance ~X.X km, Drive time ~Y min, "Phone: Shared once the order is picked up". Close button at the bottom.
3. Tap the muted phone row — nothing happens (it's not a button). Tap backdrop or Close → dismisses smoothly.

**Post-pickup phone reveal**

4. Partner marks "I've picked it up". Sheet state flips to "🛵 On the way to you"; the duration row label flips to "Arriving in ~Y min". Phone row replaced with a "Show partner phone" button.
5. Tap "Show partner phone". Spinner shows briefly. Phone number appears as `📞 +91 …`.
6. Tap the phone number → opens the native dialer with the number pre-filled. (iOS dialer prompt; Android phone app launches.)
7. Close the sheet, reopen — phone is still cached in component state (no re-fetch until the order id changes).

**Gate enforcement**

8. **Negative — pre-pickup callable**: directly invoke `getDeliveryPartnerContact` (via React DevTools or a temporary test button) on an order with `pickedUpAt == null`. Server returns `failed-precondition` with the expected message; client renders the Alert.
9. **Negative — not your order**: simulate by editing `customerId` in Firestore Console on a test order and call the function. Returns `permission-denied`.
10. **Cloud Run IAM** — after deploy run:

    ```
    gcloud run services describe getdeliverypartnercontact --region asia-south1 --format="value(spec.template.spec.serviceAccountName,iamPolicy)" 2>$null
    gcloud run services get-iam-policy getdeliverypartnercontact --region asia-south1
    ```

    Verify `allUsers` has `roles/run.invoker`. If missing:

    ```
    gcloud run services add-iam-policy-binding getdeliverypartnercontact `
      --region asia-south1 `
      --member=allUsers `
      --role=roles/run.invoker
    ```

**Visual / regression**

11. Open OrderDetail before partner claims — partner card doesn't render at all (existing gate). Sheet isn't reachable. Verified by reading the existing render guard at OrderDetailScreen line 427.
12. Open an order that delivered before this PR was deployed (no `deliveryDistanceKm` field). Rows for distance + ETA hide cleanly; sheet shows just name / state / shop / order id / phone reveal. No red box.

**Test suite**

13. `npx tsc --noEmit` clean; `npm run test:unit` clean; `npm run test:full` clean; suite +6.

---

## Out of scope

- **Partner rating display in the sheet.** Could surface partner's rolling delivery rating later if pilot signal asks for it; not needed for the "tell me who's coming" job.
- **Live partner location / ETA polling.** PR 49 reports the partner's current location to `users/{uid}.currentLocation` for the partner side; surfacing a moving ETA to the customer is a Phase B feature.
- **Profile photo.** No upload flow exists; initials avatar stays.
- **Generic partner-contact reveal for admin / shop owner.** This PR is customer-side only. Shop already has phone via their own surfaces.

---

## Deploy

**Step 1 — server first**

```
cd functions
npm run build
firebase deploy --only "functions:getDeliveryPartnerContact"
firebase functions:list | findstr getDeliveryPartnerContact
```

**Step 2 — IAM verify** (mandatory; Rule 11)

```
gcloud run services get-iam-policy getdeliverypartnercontact --region asia-south1
```

If `allUsers / roles/run.invoker` is missing:

```
gcloud run services add-iam-policy-binding getdeliverypartnercontact `
  --region asia-south1 --member=allUsers --role=roles/run.invoker
```

**Step 3 — client OTA**

```
npx tsc --noEmit
npm run test:unit
eas update --branch production --message "PR-NEXT-PARTNER-CARD.1 richer sheet + phone reveal"
```

## Doc trail

- `docs/TESTING-FINDINGS-2026-05-30.md` — Case 6 (PARTNER-CARD reopened) → `⚠️ PARTIAL — completed in PR-NEXT-PARTNER-CARD.1`.
- `docs/SESSION_LOG.md` — one paragraph.
- `CLAUDE.md` — bump date.
