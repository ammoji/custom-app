/**
 * PR 38 + PR 38.1 — Rules tests for /featureUsageLog/{eventId}.
 *
 * Posture (matches the rule block in firestore.rules):
 *   - allow read, write: if false
 *
 * After PR 38.1, the collection is server-mediated only (mirrors
 * `aiAuditLog/` and `auditLog/`). Both writes and reads go through
 * callables (`logFeatureUsageEvent` / `queryFeatureUsageLog`),
 * which use the Admin SDK and validate auth via the callable's
 * HTTPS header (works cross-SDK — Web SDK Firestore on native
 * can't see RNFB auth, the bug PR 38.1 was filed to fix).
 *
 * Every direct client operation is denied here regardless of
 * role / uid match — defense-in-depth against a forged-event
 * debug client.
 */
import {
  assertFails,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { ctxFor, getEnv, seed } from '../helpers';
import { useRulesTestEnv } from '../setup';

useRulesTestEnv();

const ALICE = 'uid-alice';
const BOB = 'uid-bob';
const ADMIN = 'uid-admin';

let env: RulesTestEnvironment;

function eventDoc(uid: string, overrides: Record<string, unknown> = {}) {
  return {
    uid,
    role: 'customer',
    feature: 'view_shop_list',
    date: '2026-05-24',
    timestamp: serverTimestamp(),
    ...overrides,
  };
}

beforeAll(async () => {
  env = await getEnv();
});

describe('/featureUsageLog/{eventId} — PR 38.1 server-mediated only', () => {
  describe('create', () => {
    test('unauthenticated caller CANNOT create', async () => {
      const db = ctxFor(env, { kind: 'anon' }).firestore();
      await assertFails(
        addDoc(collection(db, 'featureUsageLog'), eventDoc(ALICE)),
      );
    });

    test('signed-in customer CANNOT create directly (even with own uid)', async () => {
      const db = ctxFor(env, { kind: 'user', uid: ALICE }).firestore();
      await assertFails(
        addDoc(collection(db, 'featureUsageLog'), eventDoc(ALICE)),
      );
    });

    test('signed-in user CANNOT forge events as another user', async () => {
      const db = ctxFor(env, { kind: 'user', uid: BOB }).firestore();
      await assertFails(
        addDoc(collection(db, 'featureUsageLog'), eventDoc(ALICE)),
      );
    });

    test('shop owner CANNOT create directly', async () => {
      const db = ctxFor(env, {
        kind: 'shopOwner',
        uid: ALICE,
        shopId: 'shop_1',
      }).firestore();
      await assertFails(
        addDoc(
          collection(db, 'featureUsageLog'),
          eventDoc(ALICE, { role: 'shop_owner', shopId: 'shop_1' }),
        ),
      );
    });

    test('admin CANNOT create directly (must go through callable)', async () => {
      const db = ctxFor(env, { kind: 'admin', uid: ADMIN }).firestore();
      await assertFails(
        addDoc(
          collection(db, 'featureUsageLog'),
          eventDoc(ADMIN, { role: 'admin' }),
        ),
      );
    });
  });

  describe('update / delete', () => {
    beforeEach(async () => {
      await seed(env, async db => {
        await setDoc(
          doc(db as any, 'featureUsageLog', 'evt-1'),
          eventDoc(ALICE),
        );
      });
    });

    test('original-uid user CANNOT update', async () => {
      const db = ctxFor(env, { kind: 'user', uid: ALICE }).firestore();
      await assertFails(
        updateDoc(doc(db, 'featureUsageLog', 'evt-1'), {
          feature: 'tampered',
        }),
      );
    });

    test('original-uid user CANNOT delete', async () => {
      const db = ctxFor(env, { kind: 'user', uid: ALICE }).firestore();
      await assertFails(deleteDoc(doc(db, 'featureUsageLog', 'evt-1')));
    });

    test('admin CANNOT update or delete (immutable for everyone)', async () => {
      const db = ctxFor(env, { kind: 'admin', uid: ADMIN }).firestore();
      await assertFails(
        updateDoc(doc(db, 'featureUsageLog', 'evt-1'), { feature: 'x' }),
      );
      await assertFails(deleteDoc(doc(db, 'featureUsageLog', 'evt-1')));
    });
  });

  describe('read', () => {
    beforeEach(async () => {
      await seed(env, async db => {
        await setDoc(
          doc(db as any, 'featureUsageLog', 'evt-1'),
          eventDoc(ALICE),
        );
      });
    });

    test('admin CANNOT read directly (must go through queryFeatureUsageLog callable)', async () => {
      // PR 38.1 flip: admin reads were allowed in PR 38 but now go
      // through the callable, so direct client reads are denied
      // even for admins — defense-in-depth + matches the
      // documented posture (`allow read, write: if false`).
      const db = ctxFor(env, { kind: 'admin', uid: ADMIN }).firestore();
      await assertFails(getDoc(doc(db, 'featureUsageLog', 'evt-1')));
    });

    test('admin CANNOT list the collection directly', async () => {
      const db = ctxFor(env, { kind: 'admin', uid: ADMIN }).firestore();
      await assertFails(getDocs(collection(db, 'featureUsageLog')));
    });

    test('event owner CANNOT read their own event', async () => {
      const db = ctxFor(env, { kind: 'user', uid: ALICE }).firestore();
      await assertFails(getDoc(doc(db, 'featureUsageLog', 'evt-1')));
    });

    test('non-admin signed-in user CANNOT read another event', async () => {
      const db = ctxFor(env, { kind: 'user', uid: BOB }).firestore();
      await assertFails(getDoc(doc(db, 'featureUsageLog', 'evt-1')));
    });

    test('shop owner CANNOT read events', async () => {
      const db = ctxFor(env, {
        kind: 'shopOwner',
        uid: ALICE,
        shopId: 'shop_1',
      }).firestore();
      await assertFails(getDoc(doc(db, 'featureUsageLog', 'evt-1')));
    });

    test('unauthenticated caller CANNOT read', async () => {
      const db = ctxFor(env, { kind: 'anon' }).firestore();
      await assertFails(getDoc(doc(db, 'featureUsageLog', 'evt-1')));
    });
  });
});
