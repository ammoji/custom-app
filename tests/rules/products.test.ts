/**
 * Rules tests for /products/{productId}.
 *
 * Rule:
 *   allow read: if true;
 *   allow write: if false;
 *
 * The catalog is world-readable but writes go through the seed script
 * (admin SDK, bypasses rules) and the `addCustomMenuItem` callable.
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

const ADMIN = 'uid-admin';
const PRODUCT = 'product-1';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await getEnv();
});

beforeEach(async () => {
  await seed(env, async (db) => {
    await setDoc(doc(db as any, 'products', PRODUCT), {
      name: 'Onion',
      price: 25,
    });
  });
});

describe('/products/{productId}', () => {
  test('anonymous can read product', async () => {
    const db = ctxFor(env, { kind: 'anon' }).firestore();
    await assertSucceeds(getDoc(doc(db, 'products', PRODUCT)));
  });

  test('admin can read product', async () => {
    const db = ctxFor(env, { kind: 'admin', uid: ADMIN }).firestore();
    await assertSucceeds(getDoc(doc(db, 'products', PRODUCT)));
  });

  test('anonymous cannot write product', async () => {
    const db = ctxFor(env, { kind: 'anon' }).firestore();
    await assertFails(
      setDoc(doc(db, 'products', 'rogue'), { name: 'rogue' }),
    );
  });

  test('admin cannot write product directly', async () => {
    const db = ctxFor(env, { kind: 'admin', uid: ADMIN }).firestore();
    await assertFails(
      setDoc(doc(db, 'products', PRODUCT), { name: 'edited' }),
    );
  });

  test('admin cannot delete product directly', async () => {
    const db = ctxFor(env, { kind: 'admin', uid: ADMIN }).firestore();
    await assertFails(deleteDoc(doc(db, 'products', PRODUCT)));
  });
});
