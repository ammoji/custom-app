/**
 * PR-NEXT-PARTNER-CARD.1 (Case 6 retest) — server gate for revealing
 * the delivery partner's phone number to the customer.
 *
 * Two posture decisions worth keeping explicit:
 *
 *  1. Phone is NOT denormalized onto the order doc, so any customer
 *     fetch of the order via `getOrder` / Firestore listener never
 *     leaks it. The reveal is an explicit pull — the customer must
 *     tap "Show partner phone" in `PartnerDetailsSheet`, which fires
 *     this callable. Keeps privacy posture aligned with the long-
 *     standing customer-side phone gate called out in
 *     `PartnerIdentityCard`'s lead comment.
 *
 *  2. Reveal is gated to ALL of:
 *       (a) caller is the order's `customerUid` (PR-NEXT-PARTNER-CARD.2
 *           bug-fix: PARTNER-CARD.1 shipped this comparing against a
 *           non-existent `customerId` field, so EVERY customer-side
 *           reveal failed with `not_customer`. The order doc has
 *           always been `customerUid` server-side — see the
 *           `customerUid: auth.uid` write in `placeOrder` at
 *           `functions/src/index.ts:786` and the 10+ other read
 *           sites enumerated in the PARTNER-CARD.2 prompt header),
 *       (b) order has a `deliveryPersonId` set, and
 *       (c) order has been picked up (`pickedUpAt != null`).
 *     Pre-pickup remains opaque on the customer side. Post-delivery
 *     (delivered) the gate stays open — once the order is past
 *     pickup the customer has an ongoing legitimate need (post-
 *     delivery support contact).
 *
 * Returns just `{ phone }` — no name, no rating, no location, no
 * partner uid. Caller already knows `deliveryPersonName` from the
 * order doc; everything else is out-of-band.
 *
 * Pinned by `tests/functions/getDeliveryPartnerContactHelpers.test.ts`.
 */
import type { firestore as adminFirestore, auth as adminAuth } from 'firebase-admin';

export type GetDeliveryPartnerContactResult =
  | { ok: true; phone: string }
  | {
      ok: false;
      code:
        | 'order_not_found'
        | 'not_customer'
        | 'no_partner'
        | 'not_picked_up'
        | 'no_phone_on_partner';
    };

// Narrow adapter shapes so unit tests can stub `db` and `auth`
// without dragging in a real Firebase Admin instance. The prod
// caller passes `getFirestore()` and `getAuth()` directly, which
// structurally satisfy these.
export type FirestoreLike = {
  collection(path: string): {
    doc(id: string): {
      get(): Promise<{
        exists: boolean;
        data(): unknown;
      }>;
    };
  };
};
export type AuthLike = {
  getUser(uid: string): Promise<{ phoneNumber?: string | null | undefined }>;
};

// PR-NEXT-PARTNER-CARD.1 — exported for test stubbing convenience.
// Re-aliased here so future callers don't have to import from
// `firebase-admin` directly when they want the structural shapes.
export type AdminFirestore = adminFirestore.Firestore | FirestoreLike;
export type AdminAuth = adminAuth.Auth | AuthLike;

export async function getDeliveryPartnerContactPure(args: {
  orderId: string;
  callerUid: string;
  db: AdminFirestore;
  auth: AdminAuth;
}): Promise<GetDeliveryPartnerContactResult> {
  const snap = await args.db.collection('orders').doc(args.orderId).get();
  if (!snap.exists) {
    return { ok: false, code: 'order_not_found' };
  }
  const order = (snap.data() ?? {}) as {
    customerUid?: unknown;
    deliveryPersonId?: unknown;
    pickedUpAt?: unknown;
  };
  if (order.customerUid !== args.callerUid) {
    return { ok: false, code: 'not_customer' };
  }
  if (
    typeof order.deliveryPersonId !== 'string' ||
    order.deliveryPersonId.length === 0
  ) {
    return { ok: false, code: 'no_partner' };
  }
  // `pickedUpAt` is stamped as a Firestore Timestamp (server) or a
  // numeric ms epoch (test fixtures). Either way "is set / not null"
  // is the gate — we don't compare its value.
  if (order.pickedUpAt == null) {
    return { ok: false, code: 'not_picked_up' };
  }
  const partner = await args.auth.getUser(order.deliveryPersonId);
  const phone = partner.phoneNumber;
  if (typeof phone !== 'string' || phone.length === 0) {
    return { ok: false, code: 'no_phone_on_partner' };
  }
  return { ok: true, phone };
}
