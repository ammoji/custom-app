/**
 * Rules tests for /orders/{orderId} writes.
 *
 * Rule: `allow create, update, delete: if false`.
 * Cloud Functions (placeOrder / updateOrderStatus / etc.) are the
 * sole writers. Even admin must go through callables.
 */
import {
  assertFails,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, deleteDoc, updateDoc } from 'firebase/firestore';
import { ctxFor, getEnv, seed } from '../helpers';
import { useRulesTestEnv } from '../setup';

useRulesTestEnv();

const CUSTOMER = 'uid-customer';
const ADMIN = 'uid-admin';
const SHOP_OWNER = 'uid-owner';
const DELIVERY = 'uid-delivery';
const SHOP = 'shop-A';
const ORDER = 'order-1';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await getEnv();
});

beforeEach(async () => {
  await seed(env, async (db) => {
    await setDoc(doc(db as any, 'orders', ORDER), {
      customerUid: CUSTOMER,
      shopId: SHOP,
      status: 'placed',
      deliveryPersonId: null,
    });
  });
});

describe('/orders/{orderId} writes — denied for everyone', () => {
  test('anonymous cannot create order', async () => {
    const db = ctxFor(env, { kind: 'anon' }).firestore();
    await assertFails(
      setDoc(doc(db, 'orders', 'new-order'), {
        customerUid: 'anon',
        shopId: SHOP,
        status: 'placed',
      }),
    );
  });

  test('customer cannot create their own order directly', async () => {
    const db = ctxFor(env, { kind: 'user', uid: CUSTOMER }).firestore();
    await assertFails(
      setDoc(doc(db, 'orders', 'new-order'), {
        customerUid: CUSTOMER,
        shopId: SHOP,
        status: 'placed',
      }),
    );
  });

  test('admin cannot update order directly', async () => {
    const db = ctxFor(env, { kind: 'admin', uid: ADMIN }).firestore();
    await assertFails(
      updateDoc(doc(db, 'orders', ORDER), { status: 'cancelled' }),
    );
  });

  test('shop owner cannot update order directly', async () => {
    const db = ctxFor(env, {
      kind: 'shopOwner',
      uid: SHOP_OWNER,
      shopId: SHOP,
    }).firestore();
    await assertFails(
      updateDoc(doc(db, 'orders', ORDER), { status: 'ready' }),
    );
  });

  test('delivery person cannot claim order via direct update', async () => {
    // The real claim path is the `claimDelivery` callable. A direct
    // write to set deliveryPersonId would bypass the assignment
    // bookkeeping in Cloud Functions, so the rule denies it.
    const db = ctxFor(env, { kind: 'delivery', uid: DELIVERY }).firestore();
    await assertFails(
      updateDoc(doc(db, 'orders', ORDER), { deliveryPersonId: DELIVERY }),
    );
  });

  test('admin cannot delete order directly', async () => {
    const db = ctxFor(env, { kind: 'admin', uid: ADMIN }).firestore();
    await assertFails(deleteDoc(doc(db, 'orders', ORDER)));
  });
});
