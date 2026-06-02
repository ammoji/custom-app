/**
 * PR-NEXT-PARTNER-CARD.1 (Case 6 retest) — server-gate tests for
 * customer-side delivery-partner phone reveal. Pins every failure
 * branch of `getDeliveryPartnerContactPure` + the happy path, so
 * the privacy posture (no leak pre-pickup, no leak across orders)
 * stays in place across refactors.
 *
 * Mirrors the Validator-Result test patterns from
 * `tests/functions/codPaymentHelpers.test.ts`.
 */
import {
  getDeliveryPartnerContactPure,
  type AdminAuth,
  type AdminFirestore,
} from '../../functions/src/partnerContactHelpers';

// PR-NEXT-PARTNER-CARD.2 — fixtures use `customerUid` (the real
// schema field). PARTNER-CARD.1 used `customerId` here AND in the
// helper, so the tests passed against a broken comparison. Schema-
// audit grep (Rule 5) catches this kind of false-positive going
// forward.
type OrderDoc = {
  customerUid?: string;
  deliveryPersonId?: string | null;
  pickedUpAt?: number | null;
};

function makeDbWithOrder(order: OrderDoc | null): AdminFirestore {
  return {
    collection: () => ({
      doc: () => ({
        get: async () => ({
          exists: order != null,
          data: () => order ?? {},
        }),
      }),
    }),
  };
}

function makeAuthWithPhone(phone: string | null | undefined): AdminAuth {
  return {
    getUser: async () => ({ phoneNumber: phone }),
  };
}

describe('getDeliveryPartnerContactPure', () => {
  test('happy path: customer + assigned + picked up + phone on partner → returns phone', async () => {
    const result = await getDeliveryPartnerContactPure({
      orderId: 'order_1',
      callerUid: 'customer_A',
      db: makeDbWithOrder({
        customerUid: 'customer_A',
        deliveryPersonId: 'partner_X',
        pickedUpAt: 1700000000000,
      }),
      auth: makeAuthWithPhone('+919876543210'),
    });
    expect(result).toEqual({ ok: true, phone: '+919876543210' });
  });

  test('order_not_found when the doc does not exist', async () => {
    const result = await getDeliveryPartnerContactPure({
      orderId: 'missing',
      callerUid: 'customer_A',
      db: makeDbWithOrder(null),
      auth: makeAuthWithPhone('+919876543210'),
    });
    expect(result).toEqual({ ok: false, code: 'order_not_found' });
  });

  test('not_customer when caller is not the order customer', async () => {
    const result = await getDeliveryPartnerContactPure({
      orderId: 'order_1',
      callerUid: 'someone_else',
      db: makeDbWithOrder({
        customerUid: 'customer_A',
        deliveryPersonId: 'partner_X',
        pickedUpAt: 1700000000000,
      }),
      auth: makeAuthWithPhone('+919876543210'),
    });
    expect(result).toEqual({ ok: false, code: 'not_customer' });
  });

  test('no_partner when deliveryPersonId is missing', async () => {
    const result = await getDeliveryPartnerContactPure({
      orderId: 'order_1',
      callerUid: 'customer_A',
      db: makeDbWithOrder({
        customerUid: 'customer_A',
        deliveryPersonId: null,
        pickedUpAt: 1700000000000,
      }),
      auth: makeAuthWithPhone('+919876543210'),
    });
    expect(result).toEqual({ ok: false, code: 'no_partner' });
  });

  test('no_partner when deliveryPersonId is an empty string', async () => {
    // Defensive — Firestore writes can land empty strings if a
    // claimDelivery call ever forgot to skip the deletion write.
    const result = await getDeliveryPartnerContactPure({
      orderId: 'order_1',
      callerUid: 'customer_A',
      db: makeDbWithOrder({
        customerUid: 'customer_A',
        deliveryPersonId: '',
        pickedUpAt: 1700000000000,
      }),
      auth: makeAuthWithPhone('+919876543210'),
    });
    expect(result).toEqual({ ok: false, code: 'no_partner' });
  });

  test('not_picked_up when pickedUpAt is null', async () => {
    // The core privacy gate — pre-pickup reveals must fail closed.
    const result = await getDeliveryPartnerContactPure({
      orderId: 'order_1',
      callerUid: 'customer_A',
      db: makeDbWithOrder({
        customerUid: 'customer_A',
        deliveryPersonId: 'partner_X',
        pickedUpAt: null,
      }),
      auth: makeAuthWithPhone('+919876543210'),
    });
    expect(result).toEqual({ ok: false, code: 'not_picked_up' });
  });

  test('not_picked_up when pickedUpAt field is absent entirely', async () => {
    // Most common shape pre-pickup — field omitted from the doc.
    const result = await getDeliveryPartnerContactPure({
      orderId: 'order_1',
      callerUid: 'customer_A',
      db: makeDbWithOrder({
        customerUid: 'customer_A',
        deliveryPersonId: 'partner_X',
      }),
      auth: makeAuthWithPhone('+919876543210'),
    });
    expect(result).toEqual({ ok: false, code: 'not_picked_up' });
  });

  test('no_phone_on_partner when the partner has no phoneNumber', async () => {
    const result = await getDeliveryPartnerContactPure({
      orderId: 'order_1',
      callerUid: 'customer_A',
      db: makeDbWithOrder({
        customerUid: 'customer_A',
        deliveryPersonId: 'partner_X',
        pickedUpAt: 1700000000000,
      }),
      auth: makeAuthWithPhone(null),
    });
    expect(result).toEqual({ ok: false, code: 'no_phone_on_partner' });
  });

  test('no_phone_on_partner when phoneNumber is an empty string', async () => {
    const result = await getDeliveryPartnerContactPure({
      orderId: 'order_1',
      callerUid: 'customer_A',
      db: makeDbWithOrder({
        customerUid: 'customer_A',
        deliveryPersonId: 'partner_X',
        pickedUpAt: 1700000000000,
      }),
      auth: makeAuthWithPhone(''),
    });
    expect(result).toEqual({ ok: false, code: 'no_phone_on_partner' });
  });
});
