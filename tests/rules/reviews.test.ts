/**
 * PR-NEXT-5.1 §G — rules tests for /reviews/{ratingId}.
 *
 * Reads:
 *   - anyone reads a PUBLISHED review (publishedAt != null)
 *   - the writing customer reads their own pre-published review
 *   - another customer cannot read a pre-published review
 *   - shop owner reads pre-published for their shop's order
 *   - shop owner of a different shop cannot read it
 *   - assigned partner reads pre-published for their order
 *
 * Writes: always denied (every mutation flows through callables).
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

const ORDER_A = 'order-A';
const REVIEW_PUBLISHED = 'review-published';
const REVIEW_FLAGGED = 'review-flagged';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await getEnv();
});

beforeEach(async () => {
  await seed(env, async (db) => {
    // Order the reviews point back to (used by the shop-owner +
    // partner read clauses via get()).
    await setDoc(doc(db as any, 'orders', ORDER_A), {
      customerUid: CUSTOMER,
      shopId: SHOP_A,
      status: 'delivered',
      deliveryPersonId: DELIVERY_A,
    });
    // A published review — readable by anyone.
    await setDoc(doc(db as any, 'reviews', REVIEW_PUBLISHED), {
      ratingId: REVIEW_PUBLISHED,
      orderId: ORDER_A,
      shopId: SHOP_A,
      customerUid: CUSTOMER,
      customerName: 'Priya',
      shopStars: 5,
      correctionState: 'published',
      publishedAt: 1_700_000_000_000,
      deliveryPersonId: DELIVERY_A,
    });
    // A flagged_low (pre-published) review — restricted reads.
    await setDoc(doc(db as any, 'reviews', REVIEW_FLAGGED), {
      ratingId: REVIEW_FLAGGED,
      orderId: ORDER_A,
      shopId: SHOP_A,
      customerUid: CUSTOMER,
      customerName: 'Priya',
      shopStars: 1,
      correctionState: 'flagged_low',
      publishedAt: null,
      deliveryPersonId: DELIVERY_A,
    });
  });
});

describe('/reviews/{ratingId} reads', () => {
  test('anyone reads a published review', async () => {
    const db = ctxFor(env, { kind: 'anon' }).firestore();
    await assertSucceeds(getDoc(doc(db, 'reviews', REVIEW_PUBLISHED)));
  });

  test('customer reads own pre-published review', async () => {
    const db = ctxFor(env, { kind: 'user', uid: CUSTOMER }).firestore();
    await assertSucceeds(getDoc(doc(db, 'reviews', REVIEW_FLAGGED)));
  });

  test('different customer cannot read a pre-published review', async () => {
    const db = ctxFor(env, { kind: 'user', uid: OTHER_CUSTOMER }).firestore();
    await assertFails(getDoc(doc(db, 'reviews', REVIEW_FLAGGED)));
  });

  test('shop owner reads pre-published review for their shop', async () => {
    const db = ctxFor(env, {
      kind: 'shopOwner',
      uid: SHOP_OWNER_A,
      shopId: SHOP_A,
    }).firestore();
    await assertSucceeds(getDoc(doc(db, 'reviews', REVIEW_FLAGGED)));
  });

  test('shop owner of a different shop cannot read pre-published review', async () => {
    const db = ctxFor(env, {
      kind: 'shopOwner',
      uid: SHOP_OWNER_B,
      shopId: SHOP_B,
    }).firestore();
    await assertFails(getDoc(doc(db, 'reviews', REVIEW_FLAGGED)));
  });

  test('assigned partner reads pre-published review for their order', async () => {
    const db = ctxFor(env, { kind: 'delivery', uid: DELIVERY_A }).firestore();
    await assertSucceeds(getDoc(doc(db, 'reviews', REVIEW_FLAGGED)));
  });

  test('different partner cannot read pre-published review', async () => {
    const db = ctxFor(env, { kind: 'delivery', uid: DELIVERY_B }).firestore();
    await assertFails(getDoc(doc(db, 'reviews', REVIEW_FLAGGED)));
  });

  test('admin reads any pre-published review', async () => {
    const db = ctxFor(env, { kind: 'admin', uid: ADMIN }).firestore();
    await assertSucceeds(getDoc(doc(db, 'reviews', REVIEW_FLAGGED)));
  });
});

describe('/reviews/{ratingId} writes', () => {
  test('customer cannot write directly (all writes via callables)', async () => {
    const db = ctxFor(env, { kind: 'user', uid: CUSTOMER }).firestore();
    await assertFails(
      setDoc(doc(db, 'reviews', 'forged'), {
        ratingId: 'forged',
        orderId: ORDER_A,
        shopId: SHOP_A,
        customerUid: CUSTOMER,
        shopStars: 5,
        publishedAt: Date.now(),
      }),
    );
  });

  test('admin cannot write directly either', async () => {
    const db = ctxFor(env, { kind: 'admin', uid: ADMIN }).firestore();
    await assertFails(
      setDoc(doc(db, 'reviews', REVIEW_PUBLISHED), { shopStars: 1 }),
    );
  });
});
