/**
 * PR-NEXT-6 (findings #13, #16) — pure-helper tests for the three
 * delivery-proof validators in
 * `functions/src/deliveryProofHelpers.ts`.
 *
 * Auth / precondition matrix is exhaustive — every branch the three
 * callables (`getDeliveryProofUploadUrl`, `recordDeliveryProofUpload`,
 * `getDeliveryProofReadUrl`) lean on is pinned here so the wrapping
 * callables in `index.ts` stay thin Firestore + HttpsError shells.
 */
import {
  validateDeliveryProofRecordInput,
  validateDeliveryProofReadAuth,
  validateDeliveryProofUploadAuth,
} from '../../functions/src/deliveryProofHelpers';

const PARTNER_UID = 'partner_1';
const OTHER_PARTNER_UID = 'partner_2';
const CUSTOMER_UID = 'cust_1';
const OTHER_CUSTOMER_UID = 'cust_2';
const SHOP_ID = 'shop_1';
const OTHER_SHOP_ID = 'shop_2';
const ORDER_ID = 'ord_abc';

const VALID_ORDER = {
  customerUid: CUSTOMER_UID,
  shopId: SHOP_ID,
  deliveryPersonId: PARTNER_UID,
  pickedUpAt: 1_700_000_000_000,
  deliveryProofStoragePath: `delivery-proofs/${ORDER_ID}.jpg`,
};

describe('validateDeliveryProofUploadAuth', () => {
  test('null auth → unauthenticated', () => {
    const r = validateDeliveryProofUploadAuth({
      auth: null,
      order: VALID_ORDER,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('unauthenticated');
  });

  test('auth without uid → unauthenticated', () => {
    const r = validateDeliveryProofUploadAuth({
      auth: { uid: '', token: { delivery: true } },
      order: VALID_ORDER,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('unauthenticated');
  });

  test('caller without delivery claim → permission-denied (customer or shop owner attempting upload)', () => {
    // Customer tries to upload a proof photo on their own order:
    // rejected. Only the assigned delivery partner has write access.
    const r = validateDeliveryProofUploadAuth({
      auth: { uid: CUSTOMER_UID, token: {} },
      order: VALID_ORDER,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('permission-denied');
  });

  test('admin without delivery claim → permission-denied (admins do NOT upload partner-side artifacts)', () => {
    const r = validateDeliveryProofUploadAuth({
      auth: { uid: 'admin_1', token: { admin: true } as any },
      order: VALID_ORDER,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('permission-denied');
  });

  test('order doc missing → not-found', () => {
    const r = validateDeliveryProofUploadAuth({
      auth: { uid: PARTNER_UID, token: { delivery: true } },
      order: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('not-found');
  });

  test('different partner assigned to the order → permission-denied', () => {
    const r = validateDeliveryProofUploadAuth({
      auth: { uid: OTHER_PARTNER_UID, token: { delivery: true } },
      order: VALID_ORDER,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('permission-denied');
  });

  test('order has no deliveryPersonId yet (unclaimed) → permission-denied', () => {
    const r = validateDeliveryProofUploadAuth({
      auth: { uid: PARTNER_UID, token: { delivery: true } },
      order: { ...VALID_ORDER, deliveryPersonId: null },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('permission-denied');
  });

  test('pickedUpAt missing/null → failed-precondition', () => {
    // The whole point of the photo is that it's a delivery
    // artifact. Uploading before pickup is meaningless.
    const r = validateDeliveryProofUploadAuth({
      auth: { uid: PARTNER_UID, token: { delivery: true } },
      order: { ...VALID_ORDER, pickedUpAt: null },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('failed-precondition');
  });

  test('pickedUpAt 0 → failed-precondition (defensive against int defaults)', () => {
    const r = validateDeliveryProofUploadAuth({
      auth: { uid: PARTNER_UID, token: { delivery: true } },
      order: { ...VALID_ORDER, pickedUpAt: 0 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('failed-precondition');
  });

  test('pickedUpAt negative → failed-precondition', () => {
    const r = validateDeliveryProofUploadAuth({
      auth: { uid: PARTNER_UID, token: { delivery: true } },
      order: { ...VALID_ORDER, pickedUpAt: -1 },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('failed-precondition');
  });

  test('happy path: assigned partner, picked-up order → ok', () => {
    const r = validateDeliveryProofUploadAuth({
      auth: { uid: PARTNER_UID, token: { delivery: true } },
      order: VALID_ORDER,
    });
    expect(r.ok).toBe(true);
  });

  test('PR-NEXT-HOTFIX-1 — accepts Firestore Timestamp-like (the actual production shape)', () => {
    // The bug this hotfix fixes: production reads pickedUpAt as a
    // Firestore `Timestamp` (object with .toMillis()), not millis.
    // Pre-hotfix the validator's `typeof !== 'number'` check rejected
    // every real upload.
    const timestampLike = { toMillis: () => 1_700_000_000_000 };
    const r = validateDeliveryProofUploadAuth({
      auth: { uid: PARTNER_UID, token: { delivery: true } },
      order: { ...VALID_ORDER, pickedUpAt: timestampLike } as any,
    });
    expect(r.ok).toBe(true);
  });

  test('PR-NEXT-HOTFIX-1 — Timestamp-like that returns 0 → failed-precondition', () => {
    // Defensive: if Firestore somehow returns a Timestamp at epoch 0,
    // treat it the same as a missing pickup (it can't represent a
    // real pickup event).
    const zeroTs = { toMillis: () => 0 };
    const r = validateDeliveryProofUploadAuth({
      auth: { uid: PARTNER_UID, token: { delivery: true } },
      order: { ...VALID_ORDER, pickedUpAt: zeroTs } as any,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('failed-precondition');
  });

  test('PR-NEXT-HOTFIX-1 — Timestamp-like with non-finite millis → failed-precondition', () => {
    // Hostile / malformed Timestamp returning NaN or Infinity must not
    // pass the gate.
    const badTs = { toMillis: () => NaN };
    const r = validateDeliveryProofUploadAuth({
      auth: { uid: PARTNER_UID, token: { delivery: true } },
      order: { ...VALID_ORDER, pickedUpAt: badTs } as any,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('failed-precondition');
  });

  test('PR-NEXT-HOTFIX-1 — object without toMillis → failed-precondition (defensive)', () => {
    // An object that's NOT Timestamp-shaped (no .toMillis method)
    // must not silently pass. Pre-hotfix this would already have
    // failed via the typeof check; post-hotfix the narrowing falls
    // through to the null branch and still rejects.
    const r = validateDeliveryProofUploadAuth({
      auth: { uid: PARTNER_UID, token: { delivery: true } },
      order: { ...VALID_ORDER, pickedUpAt: { foo: 'bar' } } as any,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('failed-precondition');
  });
});

describe('validateDeliveryProofRecordInput', () => {
  test('missing orderId → invalid-argument', () => {
    const r = validateDeliveryProofRecordInput({
      orderId: undefined,
      storagePath: `delivery-proofs/${ORDER_ID}.jpg`,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-argument');
  });

  test('empty orderId → invalid-argument', () => {
    const r = validateDeliveryProofRecordInput({
      orderId: '',
      storagePath: `delivery-proofs/${ORDER_ID}.jpg`,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-argument');
  });

  test('non-string orderId → invalid-argument', () => {
    const r = validateDeliveryProofRecordInput({
      orderId: 12345 as any,
      storagePath: `delivery-proofs/${ORDER_ID}.jpg`,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-argument');
  });

  test('missing storagePath → invalid-argument', () => {
    const r = validateDeliveryProofRecordInput({
      orderId: ORDER_ID,
      storagePath: undefined,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-argument');
  });

  test('storagePath with sub-paths → invalid-argument (defends against forged paths)', () => {
    const r = validateDeliveryProofRecordInput({
      orderId: ORDER_ID,
      storagePath: `delivery-proofs/${ORDER_ID}/extra/file.jpg`,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-argument');
  });

  test('storagePath for a different orderId → invalid-argument', () => {
    // Forged record-call: client says "I uploaded for order A" but
    // path points at order B's slot. Reject — record-confirm must
    // never stamp the wrong order.
    const r = validateDeliveryProofRecordInput({
      orderId: ORDER_ID,
      storagePath: 'delivery-proofs/different_order.jpg',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-argument');
  });

  test('storagePath wrong extension → invalid-argument', () => {
    const r = validateDeliveryProofRecordInput({
      orderId: ORDER_ID,
      storagePath: `delivery-proofs/${ORDER_ID}.png`,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-argument');
  });

  test('happy path → ok with normalised path', () => {
    const r = validateDeliveryProofRecordInput({
      orderId: ORDER_ID,
      storagePath: `delivery-proofs/${ORDER_ID}.jpg`,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.orderId).toBe(ORDER_ID);
      expect(r.storagePath).toBe(`delivery-proofs/${ORDER_ID}.jpg`);
    }
  });
});

describe('validateDeliveryProofReadAuth', () => {
  test('null auth → unauthenticated', () => {
    const r = validateDeliveryProofReadAuth({
      auth: null,
      order: VALID_ORDER,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('unauthenticated');
  });

  test('order doc missing → not-found', () => {
    const r = validateDeliveryProofReadAuth({
      auth: { uid: 'admin_1', token: { admin: true } as any },
      order: null,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('not-found');
  });

  test('order without proof yet → not-found', () => {
    // Distinct branch from missing-doc: the order exists but the
    // partner hasn't uploaded a photo yet. UI hides the viewer; the
    // callable signals "no proof" rather than "no permission" so a
    // typo in the call site is debuggable.
    const r = validateDeliveryProofReadAuth({
      auth: { uid: CUSTOMER_UID, token: {} },
      order: { ...VALID_ORDER, deliveryProofStoragePath: null },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('not-found');
  });

  test('admin without any other claim → ok', () => {
    const r = validateDeliveryProofReadAuth({
      auth: { uid: 'admin_1', token: { admin: true } as any },
      order: VALID_ORDER,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.storagePath).toBe(VALID_ORDER.deliveryProofStoragePath);
  });

  test('customer of the order → ok', () => {
    const r = validateDeliveryProofReadAuth({
      auth: { uid: CUSTOMER_UID, token: {} },
      order: VALID_ORDER,
    });
    expect(r.ok).toBe(true);
  });

  test('customer of a different order → permission-denied', () => {
    const r = validateDeliveryProofReadAuth({
      auth: { uid: OTHER_CUSTOMER_UID, token: {} },
      order: VALID_ORDER,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('permission-denied');
  });

  test('shop owner of the shop → ok', () => {
    const r = validateDeliveryProofReadAuth({
      auth: {
        uid: 'owner_1',
        token: { shopOwner: true, shopId: SHOP_ID } as any,
      },
      order: VALID_ORDER,
    });
    expect(r.ok).toBe(true);
  });

  test('shop owner of a different shop → permission-denied', () => {
    const r = validateDeliveryProofReadAuth({
      auth: {
        uid: 'owner_2',
        token: { shopOwner: true, shopId: OTHER_SHOP_ID } as any,
      },
      order: VALID_ORDER,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('permission-denied');
  });

  test('shopOwner claim true but missing shopId claim → permission-denied (defensive)', () => {
    const r = validateDeliveryProofReadAuth({
      auth: { uid: 'owner_3', token: { shopOwner: true } as any },
      order: VALID_ORDER,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('permission-denied');
  });

  test('assigned delivery partner → ok', () => {
    const r = validateDeliveryProofReadAuth({
      auth: { uid: PARTNER_UID, token: { delivery: true } as any },
      order: VALID_ORDER,
    });
    expect(r.ok).toBe(true);
  });

  test('different delivery partner (not assigned) → permission-denied', () => {
    const r = validateDeliveryProofReadAuth({
      auth: { uid: OTHER_PARTNER_UID, token: { delivery: true } as any },
      order: VALID_ORDER,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('permission-denied');
  });

  test('random signed-in user with no relevant relationship → permission-denied', () => {
    const r = validateDeliveryProofReadAuth({
      auth: { uid: 'rando_uid', token: {} },
      order: VALID_ORDER,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('permission-denied');
  });
});
