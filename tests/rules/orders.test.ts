/**
 * Rules tests for /orders/{orderId} — the most complex rule. Read
 * access is granted to the placing customer, any admin, the shop
 * owner whose shopId claim matches `resource.data.shopId`, the
 * delivery person assigned to the order, or any delivery person
 * looking at an unassigned 'ready_for_pickup' pickup. Writes are
 * `if false` — Cloud Functions are the only writer.
 *
 * Read covered here. Write coverage lives in `orders-write.test.ts`
 * to keep each file under ~200 lines.
 */
import {
  assertFails,
  assertSucceeds,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { ctxFor, getEnv, seed } from '../helpers';
import { useRulesTestEnv } from '../setup';

useRulesTestEnv();

const CUSTOMER = 'uid-customer';
const OTHER_CUSTOMER = 'uid-other-customer';
const ADMIN = 'uid-admin';
const SHOP_OWNER_A = 'uid-owner-A';
const SHOP_OWNER_B = 'uid-owner-B';
const DELIVERY_A = 'uid-delivery-A';
const DELIVERY_B = 'uid-delivery-B';

const SHOP_A = 'shop-A';
const SHOP_B = 'shop-B';

const ORDER_PLACED = 'order-placed';
const ORDER_READY = 'order-ready';
const ORDER_OFD_UNCLAIMED = 'order-ofd-unclaimed';
const ORDER_OFD_CLAIMED = 'order-ofd-claimed';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await getEnv();
});

beforeEach(async () => {
  await seed(env, async (db) => {
    // Standard placed order, no delivery assignment yet.
    await setDoc(doc(db as any, 'orders', ORDER_PLACED), {
      customerUid: CUSTOMER,
      shopId: SHOP_A,
      status: 'placed',
      deliveryPersonId: null,
    });
    // Ready but not yet out for delivery — delivery folks should NOT
    // be able to see this via the "available pickups" clause.
    await setDoc(doc(db as any, 'orders', ORDER_READY), {
      customerUid: CUSTOMER,
      shopId: SHOP_A,
      status: 'ready',
      deliveryPersonId: null,
    });
    // Out for delivery, no one has claimed yet — visible to any
    // delivery person via the unassigned-pickups clause.
    await setDoc(doc(db as any, 'orders', ORDER_OFD_UNCLAIMED), {
      customerUid: CUSTOMER,
      shopId: SHOP_A,
      status: 'ready_for_pickup',
      deliveryPersonId: null,
    });
    // Out for delivery, claimed by DELIVERY_A. DELIVERY_B should
    // not be able to read it; only A (and the usual customer/admin/
    // shop-owner readers).
    await setDoc(doc(db as any, 'orders', ORDER_OFD_CLAIMED), {
      customerUid: CUSTOMER,
      shopId: SHOP_A,
      status: 'ready_for_pickup',
      deliveryPersonId: DELIVERY_A,
    });
  });
});

describe('/orders/{orderId} reads — customer & admin', () => {
  test('placing customer can read their order', async () => {
    const db = ctxFor(env, { kind: 'user', uid: CUSTOMER }).firestore();
    await assertSucceeds(getDoc(doc(db, 'orders', ORDER_PLACED)));
  });

  test('different customer cannot read someone else\'s order', async () => {
    const db = ctxFor(env, { kind: 'user', uid: OTHER_CUSTOMER }).firestore();
    await assertFails(getDoc(doc(db, 'orders', ORDER_PLACED)));
  });

  test('admin can read any order', async () => {
    const db = ctxFor(env, { kind: 'admin', uid: ADMIN }).firestore();
    await assertSucceeds(getDoc(doc(db, 'orders', ORDER_PLACED)));
  });

  test('anonymous cannot read any order', async () => {
    const db = ctxFor(env, { kind: 'anon' }).firestore();
    await assertFails(getDoc(doc(db, 'orders', ORDER_PLACED)));
  });
});

describe('/orders/{orderId} reads — shop owner', () => {
  test('shop owner with matching shopId claim can read order', async () => {
    const db = ctxFor(env, {
      kind: 'shopOwner',
      uid: SHOP_OWNER_A,
      shopId: SHOP_A,
    }).firestore();
    await assertSucceeds(getDoc(doc(db, 'orders', ORDER_PLACED)));
  });

  test('shop owner of a different shop cannot read order', async () => {
    const db = ctxFor(env, {
      kind: 'shopOwner',
      uid: SHOP_OWNER_B,
      shopId: SHOP_B,
    }).firestore();
    await assertFails(getDoc(doc(db, 'orders', ORDER_PLACED)));
  });

  test('shop owner claim present but shopId wrong cannot read order', async () => {
    // shopOwner: true is necessary but not sufficient — the shopId
    // claim has to match the order's shopId too.
    const db = ctxFor(env, {
      kind: 'shopOwner',
      uid: SHOP_OWNER_A,
      shopId: 'totally-different-shop',
    }).firestore();
    await assertFails(getDoc(doc(db, 'orders', ORDER_PLACED)));
  });
});

describe('/orders/{orderId} reads — delivery person', () => {
  test('assigned delivery person can read their claimed order', async () => {
    const db = ctxFor(env, {
      kind: 'delivery',
      uid: DELIVERY_A,
    }).firestore();
    await assertSucceeds(getDoc(doc(db, 'orders', ORDER_OFD_CLAIMED)));
  });

  test('different delivery person cannot read a claimed order', async () => {
    const db = ctxFor(env, {
      kind: 'delivery',
      uid: DELIVERY_B,
    }).firestore();
    await assertFails(getDoc(doc(db, 'orders', ORDER_OFD_CLAIMED)));
  });

  test('delivery person can read unassigned ready_for_pickup order (available pickup)', async () => {
    const db = ctxFor(env, {
      kind: 'delivery',
      uid: DELIVERY_B,
    }).firestore();
    await assertSucceeds(getDoc(doc(db, 'orders', ORDER_OFD_UNCLAIMED)));
  });

  test('delivery person cannot read ready-but-not-out order', async () => {
    // status='ready' + deliveryPersonId=null — the rule requires
    // status=='ready_for_pickup' for the unassigned-pickups clause to
    // match. Pinning so a future "show ready orders too" change is
    // caught.
    const db = ctxFor(env, {
      kind: 'delivery',
      uid: DELIVERY_B,
    }).firestore();
    await assertFails(getDoc(doc(db, 'orders', ORDER_READY)));
  });

  test('delivery person cannot read placed order (status=placed)', async () => {
    const db = ctxFor(env, {
      kind: 'delivery',
      uid: DELIVERY_B,
    }).firestore();
    await assertFails(getDoc(doc(db, 'orders', ORDER_PLACED)));
  });
});
