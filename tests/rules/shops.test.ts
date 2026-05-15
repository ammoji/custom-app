/**
 * Rules tests for /shops/{shopId}.
 *
 * Read rule:
 *   resource.data.status == 'active'
 *   || isAdmin()
 *   || (isSignedIn() && resource.data.ownerUid == request.auth.uid)
 *
 * Write rule: `if false` — Cloud Functions are the only writer.
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
const STRANGER = 'uid-stranger';
const ADMIN = 'uid-admin';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await getEnv();
});

beforeEach(async () => {
  await seed(env, async (db) => {
    const shops: Array<[string, Record<string, unknown>]> = [
      ['shop-active', { ownerUid: OWNER, status: 'active', name: 'Active' }],
      ['shop-pending', { ownerUid: OWNER, status: 'pending', name: 'Pending' }],
      ['shop-suspended', { ownerUid: OWNER, status: 'suspended', name: 'Susp' }],
      ['shop-rejected', { ownerUid: OWNER, status: 'rejected', name: 'Rej' }],
      // Legacy doc with no `status` field at all — predates Phase 12a-v2-i.
      ['shop-legacy-nostatus', { ownerUid: OWNER, name: 'Legacy' }],
    ];
    for (const [id, data] of shops) {
      await setDoc(doc(db as any, 'shops', id), data);
    }
  });
});

describe('/shops/{shopId} reads — anonymous', () => {
  test('can read active shop', async () => {
    const db = ctxFor(env, { kind: 'anon' }).firestore();
    await assertSucceeds(getDoc(doc(db, 'shops', 'shop-active')));
  });

  test('cannot read pending shop', async () => {
    const db = ctxFor(env, { kind: 'anon' }).firestore();
    await assertFails(getDoc(doc(db, 'shops', 'shop-pending')));
  });

  test('cannot read suspended shop', async () => {
    const db = ctxFor(env, { kind: 'anon' }).firestore();
    await assertFails(getDoc(doc(db, 'shops', 'shop-suspended')));
  });

  test('cannot read rejected shop', async () => {
    const db = ctxFor(env, { kind: 'anon' }).firestore();
    await assertFails(getDoc(doc(db, 'shops', 'shop-rejected')));
  });

  // Edge: pre-v2-i docs have no `status` field. Confirmed behaviour:
  // the rule short-circuits to false (status != 'active'), the caller
  // is anonymous, so the doc is unreadable from a public path. The
  // backfill in `scripts/backfill-shop-menus.ts` patches `status:
  // 'active'` onto legacy docs to make them visible again. Pinning the
  // current behaviour so a future rule that adds `... || status == null`
  // breaks this test loudly.
  test('cannot read legacy shop with no status field', async () => {
    const db = ctxFor(env, { kind: 'anon' }).firestore();
    await assertFails(getDoc(doc(db, 'shops', 'shop-legacy-nostatus')));
  });
});

describe('/shops/{shopId} reads — owner', () => {
  test('owner can read their pending shop', async () => {
    const db = ctxFor(env, {
      kind: 'shopOwner',
      uid: OWNER,
      shopId: 'shop-pending',
    }).firestore();
    await assertSucceeds(getDoc(doc(db, 'shops', 'shop-pending')));
  });

  test('owner can read their suspended shop', async () => {
    const db = ctxFor(env, {
      kind: 'shopOwner',
      uid: OWNER,
      shopId: 'shop-suspended',
    }).firestore();
    await assertSucceeds(getDoc(doc(db, 'shops', 'shop-suspended')));
  });
});

describe('/shops/{shopId} reads — admin & strangers', () => {
  test('admin can read pending shop', async () => {
    const db = ctxFor(env, { kind: 'admin', uid: ADMIN }).firestore();
    await assertSucceeds(getDoc(doc(db, 'shops', 'shop-pending')));
  });

  test('admin can read suspended shop', async () => {
    const db = ctxFor(env, { kind: 'admin', uid: ADMIN }).firestore();
    await assertSucceeds(getDoc(doc(db, 'shops', 'shop-suspended')));
  });

  test('admin can read rejected shop', async () => {
    const db = ctxFor(env, { kind: 'admin', uid: ADMIN }).firestore();
    await assertSucceeds(getDoc(doc(db, 'shops', 'shop-rejected')));
  });

  test('signed-in non-owner cannot read pending shop', async () => {
    const db = ctxFor(env, { kind: 'user', uid: STRANGER }).firestore();
    await assertFails(getDoc(doc(db, 'shops', 'shop-pending')));
  });
});

describe('/shops/{shopId} writes — denied for everyone', () => {
  test('anonymous cannot create', async () => {
    const db = ctxFor(env, { kind: 'anon' }).firestore();
    await assertFails(
      setDoc(doc(db, 'shops', 'new-shop'), { ownerUid: STRANGER, status: 'active' }),
    );
  });

  test('owner cannot update their own shop directly', async () => {
    const db = ctxFor(env, {
      kind: 'shopOwner',
      uid: OWNER,
      shopId: 'shop-active',
    }).firestore();
    await assertFails(
      setDoc(doc(db, 'shops', 'shop-active'), { ownerUid: OWNER, status: 'active', name: 'Edited' }),
    );
  });

  test('admin cannot update shop directly', async () => {
    const db = ctxFor(env, { kind: 'admin', uid: ADMIN }).firestore();
    await assertFails(
      setDoc(doc(db, 'shops', 'shop-pending'), { ownerUid: OWNER, status: 'active' }),
    );
  });

  test('owner cannot delete their own shop', async () => {
    const db = ctxFor(env, {
      kind: 'shopOwner',
      uid: OWNER,
      shopId: 'shop-active',
    }).firestore();
    await assertFails(deleteDoc(doc(db, 'shops', 'shop-active')));
  });
});
