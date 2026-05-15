/**
 * Rules tests for /shops/{shopId}/menu/{menuItemId}.
 *
 * Rule:
 *   allow read: if true;
 *   allow create, update, delete: if false;
 *
 * Writes are intentionally locked even for shop owners — they go
 * through addCustomMenuItem / updateMenuItem / removeMenuItem
 * callables so the GLOBAL-item name/image invariant is enforced in
 * one place. See `functions/src/index.ts`.
 */
import {
  assertFails,
  assertSucceeds,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { ctxFor, getEnv, seed } from '../helpers';
import { useRulesTestEnv } from '../setup';

useRulesTestEnv();

const OWNER = 'uid-shop-owner';
const ADMIN = 'uid-admin';
const RANDOM = 'uid-random';
const SHOP = 'shop-1';
const ITEM = 'item-1';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await getEnv();
});

beforeEach(async () => {
  await seed(env, async (db) => {
    await setDoc(doc(db as any, 'shops', SHOP), {
      ownerUid: OWNER,
      status: 'active',
    });
    await setDoc(doc(db as any, 'shops', SHOP, 'menu', ITEM), {
      name: 'Tomato',
      price: 30,
    });
  });
});

describe('/shops/{shopId}/menu/{itemId} reads', () => {
  test('anonymous can read menu item', async () => {
    const db = ctxFor(env, { kind: 'anon' }).firestore();
    await assertSucceeds(getDoc(doc(db, 'shops', SHOP, 'menu', ITEM)));
  });

  test('signed-in non-owner can read menu item', async () => {
    const db = ctxFor(env, { kind: 'user', uid: RANDOM }).firestore();
    await assertSucceeds(getDoc(doc(db, 'shops', SHOP, 'menu', ITEM)));
  });
});

describe('/shops/{shopId}/menu/{itemId} writes — denied for everyone', () => {
  test('shop owner cannot create menu item directly', async () => {
    const db = ctxFor(env, {
      kind: 'shopOwner',
      uid: OWNER,
      shopId: SHOP,
    }).firestore();
    await assertFails(
      setDoc(doc(db, 'shops', SHOP, 'menu', 'new-item'), {
        name: 'Onion',
        price: 40,
      }),
    );
  });

  test('shop owner cannot update menu item directly', async () => {
    const db = ctxFor(env, {
      kind: 'shopOwner',
      uid: OWNER,
      shopId: SHOP,
    }).firestore();
    await assertFails(
      setDoc(doc(db, 'shops', SHOP, 'menu', ITEM), {
        name: 'Tomato',
        price: 99,
      }),
    );
  });

  test('admin cannot delete menu item directly', async () => {
    const db = ctxFor(env, { kind: 'admin', uid: ADMIN }).firestore();
    await assertFails(deleteDoc(doc(db, 'shops', SHOP, 'menu', ITEM)));
  });

  test('anonymous cannot create menu item', async () => {
    const db = ctxFor(env, { kind: 'anon' }).firestore();
    await assertFails(
      setDoc(doc(db, 'shops', SHOP, 'menu', 'rogue'), { name: 'x' }),
    );
  });
});
