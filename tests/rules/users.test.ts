/**
 * Rules tests for /users/{uid}.
 *
 * Rule: `allow read, write: if isOwner(uid)`.
 * Only the user themselves can read or write their own doc. Admin
 * console access goes through Cloud Functions (listAllUsers), not
 * direct Firestore reads.
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

const ALICE = 'uid-alice';
const BOB = 'uid-bob';
const ADMIN = 'uid-admin';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await getEnv();
});

beforeEach(async () => {
  await seed(env, async (db) => {
    await setDoc(doc(db as any, 'users', ALICE), { name: 'Alice' });
    await setDoc(doc(db as any, 'users', BOB), { name: 'Bob' });
  });
});

describe('/users/{uid} reads', () => {
  test('owner can read own doc', async () => {
    const db = ctxFor(env, { kind: 'user', uid: ALICE }).firestore();
    await assertSucceeds(getDoc(doc(db, 'users', ALICE)));
  });

  test('different signed-in user cannot read another user', async () => {
    const db = ctxFor(env, { kind: 'user', uid: BOB }).firestore();
    await assertFails(getDoc(doc(db, 'users', ALICE)));
  });

  test('unauthenticated caller cannot read any user doc', async () => {
    const db = ctxFor(env, { kind: 'anon' }).firestore();
    await assertFails(getDoc(doc(db, 'users', ALICE)));
  });

  test('admin cannot read user docs directly (must use Cloud Functions)', async () => {
    const db = ctxFor(env, { kind: 'admin', uid: ADMIN }).firestore();
    await assertFails(getDoc(doc(db, 'users', ALICE)));
  });
});

describe('/users/{uid} writes', () => {
  test('owner can write own doc', async () => {
    const db = ctxFor(env, { kind: 'user', uid: ALICE }).firestore();
    await assertSucceeds(
      setDoc(doc(db, 'users', ALICE), { name: 'Alice v2' }),
    );
  });

  test('different signed-in user cannot write another user', async () => {
    const db = ctxFor(env, { kind: 'user', uid: BOB }).firestore();
    await assertFails(
      setDoc(doc(db, 'users', ALICE), { name: 'hacked' }),
    );
  });

  test('unauthenticated caller cannot write user doc', async () => {
    const db = ctxFor(env, { kind: 'anon' }).firestore();
    await assertFails(
      setDoc(doc(db, 'users', ALICE), { name: 'anon' }),
    );
  });

  test('admin cannot write user docs directly', async () => {
    const db = ctxFor(env, { kind: 'admin', uid: ADMIN }).firestore();
    await assertFails(
      setDoc(doc(db, 'users', ALICE), { name: 'admin-edit' }),
    );
  });
});
