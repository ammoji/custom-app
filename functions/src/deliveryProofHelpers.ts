/**
 * PR-NEXT-6 (findings #13, #16) — pure auth + precondition helpers
 * for the three delivery-proof callables.
 *
 * Mirrors the validator-Result pattern from `codPaymentHelpers` +
 * `menuImageUploadHelpers`: each helper returns a tagged union so
 * the wrapping callable in `index.ts` is a thin Firestore +
 * HttpsError shell and the auth/precondition matrix can be pinned
 * exhaustively without booting firebase-admin.
 *
 * The three call-sites this serves:
 *   1. `validateDeliveryProofUploadAuth`  — `getDeliveryProofUploadUrl`
 *      mints a signed PUT for the assigned delivery partner of an
 *      already-picked-up order.
 *   2. `validateDeliveryProofRecordInput` — `recordDeliveryProofUpload`
 *      stamps the order doc; defends against a forged record-call
 *      carrying another order's storagePath via path-prefix check.
 *   3. `validateDeliveryProofReadAuth`    — `getDeliveryProofReadUrl`
 *      role-mixed: customer of the order, shop owner of the shop,
 *      admin, or the assigned delivery partner. None of those alone
 *      is sufficient by default — every one of them needs an
 *      independent gate.
 *
 * Photo is OPTIONAL by design: `markDelivered` does NOT require a
 * proof photo. A required-photo gate would block legitimate
 * deliveries (door-handoff requests, lighting issues, partner
 * camera-permission denied). Trust the partner; the photo is a
 * force-multiplier when present, not a guard.
 */

export type DeliveryProofUploadAuthInput = {
  auth:
    | {
        uid: string;
        token?: {
          delivery?: unknown;
        };
      }
    | null
    | undefined;
  order: {
    deliveryPersonId?: string | null;
    // PR-NEXT-HOTFIX-1 — accept either millis (test fixtures) or
    // Firestore Timestamp-like (production reads). The validator
    // narrows internally via .toMillis().
    pickedUpAt?: number | { toMillis(): number } | null;
  } | null;
};

export type DeliveryProofUploadAuthResult =
  | { ok: true }
  | {
      ok: false;
      code:
        | 'unauthenticated'
        | 'permission-denied'
        | 'failed-precondition'
        | 'not-found';
      message: string;
    };

export function validateDeliveryProofUploadAuth(
  input: DeliveryProofUploadAuthInput,
): DeliveryProofUploadAuthResult {
  const { auth, order } = input;
  if (!auth || typeof auth.uid !== 'string' || !auth.uid) {
    return {
      ok: false,
      code: 'unauthenticated',
      message: 'Sign in required',
    };
  }
  if (auth.token?.delivery !== true) {
    return {
      ok: false,
      code: 'permission-denied',
      message: 'Only delivery partners can upload proof photos',
    };
  }
  if (!order) {
    return { ok: false, code: 'not-found', message: 'Order not found' };
  }
  if (
    typeof order.deliveryPersonId !== 'string' ||
    order.deliveryPersonId !== auth.uid
  ) {
    return {
      ok: false,
      code: 'permission-denied',
      message: 'Not the assigned delivery partner',
    };
  }
  // PR-NEXT-HOTFIX-1 — Firestore `serverTimestamp()` is stored as a
  // `Timestamp` object on read (not millis). The original
  // `typeof order.pickedUpAt !== 'number'` check always failed in
  // production because the Admin SDK hands the raw Timestamp back to
  // us. Accept both shapes: plain millis numbers (test fixtures + any
  // caller that pre-normalises) AND Timestamp-likes (everything from
  // a real Firestore read). Anything else (null / undefined / wrong
  // shape / NaN / Infinity / 0) still fails the precondition.
  const rawPickedUpAt: unknown = order.pickedUpAt;
  const pickedUpAtMillis: number | null =
    typeof rawPickedUpAt === 'number'
      ? rawPickedUpAt
      : typeof (rawPickedUpAt as { toMillis?: unknown })?.toMillis ===
          'function'
        ? (rawPickedUpAt as { toMillis: () => number }).toMillis()
        : null;
  if (
    pickedUpAtMillis === null ||
    !Number.isFinite(pickedUpAtMillis) ||
    pickedUpAtMillis <= 0
  ) {
    return {
      ok: false,
      code: 'failed-precondition',
      message: 'Pick up the order before uploading a proof photo',
    };
  }
  return { ok: true };
}

/**
 * Storage path validator for the record-confirm callable. The
 * client passes back the `storagePath` the upload callable handed
 * it; we re-verify the path matches the expected scheme for the
 * orderId. Defends against a forged record-call from one
 * shopper's session pointing at another order's path.
 *
 * Expected format: `delivery-proofs/{orderId}.jpg` exactly. No
 * sub-paths, no extension variants. The upload callable mints
 * the same path so a legitimate flow always matches.
 */
export type DeliveryProofRecordInput = {
  orderId: unknown;
  storagePath: unknown;
};

export type DeliveryProofRecordInputResult =
  | { ok: true; orderId: string; storagePath: string }
  | {
      ok: false;
      code: 'invalid-argument';
      message: string;
    };

export function validateDeliveryProofRecordInput(
  input: DeliveryProofRecordInput,
): DeliveryProofRecordInputResult {
  const { orderId, storagePath } = input;
  if (typeof orderId !== 'string' || !orderId) {
    return {
      ok: false,
      code: 'invalid-argument',
      message: 'orderId required',
    };
  }
  if (typeof storagePath !== 'string' || !storagePath) {
    return {
      ok: false,
      code: 'invalid-argument',
      message: 'storagePath required',
    };
  }
  const expected = `delivery-proofs/${orderId}.jpg`;
  if (storagePath !== expected) {
    return {
      ok: false,
      code: 'invalid-argument',
      message:
        'storagePath does not match the expected scheme for this order',
    };
  }
  return { ok: true, orderId, storagePath: expected };
}

export type DeliveryProofReadAuthInput = {
  auth:
    | {
        uid: string;
        token?: {
          admin?: unknown;
          shopOwner?: unknown;
          shopId?: unknown;
          delivery?: unknown;
        };
      }
    | null
    | undefined;
  order: {
    customerUid?: string | null;
    shopId?: string | null;
    deliveryPersonId?: string | null;
    deliveryProofStoragePath?: string | null;
  } | null;
};

export type DeliveryProofReadAuthResult =
  | { ok: true; storagePath: string }
  | {
      ok: false;
      code: 'unauthenticated' | 'permission-denied' | 'not-found';
      message: string;
    };

export function validateDeliveryProofReadAuth(
  input: DeliveryProofReadAuthInput,
): DeliveryProofReadAuthResult {
  const { auth, order } = input;
  if (!auth || typeof auth.uid !== 'string' || !auth.uid) {
    return {
      ok: false,
      code: 'unauthenticated',
      message: 'Sign in required',
    };
  }
  if (!order) {
    return { ok: false, code: 'not-found', message: 'Order not found' };
  }
  if (
    typeof order.deliveryProofStoragePath !== 'string' ||
    !order.deliveryProofStoragePath
  ) {
    return {
      ok: false,
      code: 'not-found',
      message: 'No proof photo on this order',
    };
  }
  const isAdmin = auth.token?.admin === true;
  const isCustomerOfOrder =
    typeof order.customerUid === 'string' && order.customerUid === auth.uid;
  const isShopOwnerOfShop =
    auth.token?.shopOwner === true &&
    typeof auth.token?.shopId === 'string' &&
    typeof order.shopId === 'string' &&
    auth.token.shopId === order.shopId;
  const isAssignedPartner =
    auth.token?.delivery === true &&
    typeof order.deliveryPersonId === 'string' &&
    order.deliveryPersonId === auth.uid;
  if (
    !(isAdmin || isCustomerOfOrder || isShopOwnerOfShop || isAssignedPartner)
  ) {
    return {
      ok: false,
      code: 'permission-denied',
      message: 'Not authorised to view this proof',
    };
  }
  return { ok: true, storagePath: order.deliveryProofStoragePath };
}
