/**
 * PR 45 — Tests for the server-side push pipeline helpers.
 *
 * Covers:
 *   - `validatePushTokenInput` — gates for both registerPushToken
 *     and unregisterPushToken callables. The same helper backs
 *     both, so a single test list pins both contracts.
 *   - `buildOrderStatusPushPlan` — the state machine behind the
 *     sendOrderStatusPush trigger. Pure (no Firestore / fetch /
 *     logger), so we can pin every skip reason + the message
 *     shape without spinning up firebase-admin.
 *
 * Pre-PR-45 this entire pipeline had zero tests. The build-17
 * silent push failure shipped past CI for exactly this reason —
 * Sudhir's directive: "I really want PR for test coverage debt."
 */
import {
  buildOrderStatusPushPlan,
  validatePushTokenInput,
} from '../../functions/src/pushHelpers';

describe('PR 45 — validatePushTokenInput', () => {
  test('accepts an authed caller with a non-empty token', () => {
    const r = validatePushTokenInput(
      { uid: 'user_123' },
      { token: 'ExponentPushToken[abc]' },
    );
    expect(r).toEqual({
      ok: true,
      uid: 'user_123',
      token: 'ExponentPushToken[abc]',
    });
  });

  test('rejects unauthenticated caller (auth = null)', () => {
    const r = validatePushTokenInput(null, { token: 'tok' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('unauthenticated');
      expect(r.message).toBe('Sign in required');
    }
  });

  test('rejects unauthenticated caller (auth = undefined)', () => {
    // request.auth is `undefined` (not null) when the callable is
    // invoked without an ID token. Same gate either way.
    const r = validatePushTokenInput(undefined, { token: 'tok' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('unauthenticated');
  });

  test('rejects when auth.uid is empty string', () => {
    // Defensive — a malformed auth context with uid = "" must
    // not be treated as a valid user (could collide with the
    // root user doc under the empty-string path).
    const r = validatePushTokenInput({ uid: '' }, { token: 'tok' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('unauthenticated');
  });

  test('rejects missing data', () => {
    const r = validatePushTokenInput({ uid: 'u' }, null);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('invalid-argument');
      expect(r.message).toBe('token required');
    }
  });

  test('rejects when token is missing', () => {
    const r = validatePushTokenInput({ uid: 'u' }, {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-argument');
  });

  test('rejects when token is empty string', () => {
    const r = validatePushTokenInput({ uid: 'u' }, { token: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('invalid-argument');
  });

  test('rejects when token is a non-string (number, object)', () => {
    // Loose-string validation, but still typed — a number or
    // object would crash the Firestore write or worse.
    expect(
      validatePushTokenInput({ uid: 'u' }, { token: 42 as any }).ok,
    ).toBe(false);
    expect(
      validatePushTokenInput({ uid: 'u' }, { token: {} as any }).ok,
    ).toBe(false);
  });

  test('accepts non-Expo token shapes (forward-compat)', () => {
    // Per the helper's contract — we may carry raw FCM/APN tokens
    // in the future if we drop the Expo Push relay. The validator
    // must not pre-emptively reject those.
    const r = validatePushTokenInput(
      { uid: 'u' },
      { token: 'fF8h-some-raw-fcm-style-token' },
    );
    expect(r.ok).toBe(true);
  });
});

describe('PR 45 — buildOrderStatusPushPlan', () => {
  const tokens = ['ExponentPushToken[a]', 'ExponentPushToken[b]'];

  test('happy path — emits one message per token with the right title/body', () => {
    const plan = buildOrderStatusPushPlan({
      before: { status: 'pending' },
      after: {
        status: 'accepted',
        customerUid: 'cust_1',
        shopName: 'Sharma Kirana',
        items: [{ id: 'i1' }, { id: 'i2' }, { id: 'i3' }],
        id: 'order_xyz',
      },
      tokens,
      orderId: 'order_xyz',
    });
    expect(plan.kind).toBe('send');
    if (plan.kind !== 'send') return;
    expect(plan.messages).toHaveLength(2);
    expect(plan.messages[0]).toEqual({
      to: 'ExponentPushToken[a]',
      sound: 'default',
      title: 'Order accepted',
      body: 'Sharma Kirana — 3 items',
      data: { orderId: 'order_xyz', type: 'order_status' },
    });
    expect(plan.messages[1].to).toBe('ExponentPushToken[b]');
  });

  test('singular item count uses "1 item" not "1 items"', () => {
    // Tiny copy detail, but pre-extraction it was inline ternary
    // and easy to flip. Pin it.
    const plan = buildOrderStatusPushPlan({
      before: { status: 'pending' },
      after: {
        status: 'accepted',
        customerUid: 'c',
        shopName: 'X',
        items: [{}],
      },
      tokens: ['t'],
      orderId: 'o',
    });
    if (plan.kind !== 'send') throw new Error('expected send');
    expect(plan.messages[0].body).toBe('X — 1 item');
  });

  test('zero items still produces a non-crashing body', () => {
    // Defensive — placeOrder enforces items.length >= 1 at insert
    // time but an admin manual update could in theory empty it.
    const plan = buildOrderStatusPushPlan({
      before: { status: 'pending' },
      after: { status: 'accepted', customerUid: 'c', items: [] },
      tokens: ['t'],
      orderId: 'o',
    });
    if (plan.kind !== 'send') throw new Error('expected send');
    expect(plan.messages[0].body).toBe('Your shop — 0 items');
  });

  test('missing shopName falls back to "Your shop"', () => {
    const plan = buildOrderStatusPushPlan({
      before: { status: 'pending' },
      after: { status: 'accepted', customerUid: 'c', items: [{}] },
      tokens: ['t'],
      orderId: 'o',
    });
    if (plan.kind !== 'send') throw new Error('expected send');
    expect(plan.messages[0].body).toContain('Your shop');
  });

  test('falls back to event orderId when order.id is missing', () => {
    // The trigger passes event.params.orderId as a backup; this
    // pin ensures the helper actually uses it.
    const plan = buildOrderStatusPushPlan({
      before: { status: 'pending' },
      after: { status: 'accepted', customerUid: 'c', items: [{}] },
      tokens: ['t'],
      orderId: 'param_orderid',
    });
    if (plan.kind !== 'send') throw new Error('expected send');
    expect(plan.messages[0].data.orderId).toBe('param_orderid');
  });

  test('unknown status falls back to the raw status string as title', () => {
    // Defensive — if a new status is added to the order schema
    // without updating ORDER_STATUS_LABELS, the customer still
    // gets SOMETHING in the title (better than blank).
    const plan = buildOrderStatusPushPlan({
      before: { status: 'pending' },
      after: { status: 'mystery_new_status', customerUid: 'c', items: [{}] },
      tokens: ['t'],
      orderId: 'o',
    });
    if (plan.kind !== 'send') throw new Error('expected send');
    expect(plan.messages[0].title).toBe('mystery_new_status');
  });

  test('skips with no_status_change when before.status === after.status', () => {
    const plan = buildOrderStatusPushPlan({
      before: { status: 'accepted' },
      after: { status: 'accepted', customerUid: 'c' },
      tokens,
      orderId: 'o',
    });
    expect(plan).toEqual({ kind: 'skip', reason: 'no_status_change' });
  });

  test('skips with no_status_change when before is missing', () => {
    // onDocumentUpdated can technically fire with one side null on
    // a write-during-delete race. Treat as no-op rather than
    // crashing.
    const plan = buildOrderStatusPushPlan({
      before: null,
      after: { status: 'accepted', customerUid: 'c' },
      tokens,
      orderId: 'o',
    });
    expect(plan.kind).toBe('skip');
  });

  test('skips with missing_customer_uid', () => {
    const plan = buildOrderStatusPushPlan({
      before: { status: 'pending' },
      after: { status: 'accepted' /* no customerUid */ },
      tokens,
      orderId: 'o',
    });
    expect(plan).toEqual({ kind: 'skip', reason: 'missing_customer_uid' });
  });

  test('skips with no_tokens when customer has empty fcmTokens', () => {
    const plan = buildOrderStatusPushPlan({
      before: { status: 'pending' },
      after: { status: 'accepted', customerUid: 'c' },
      tokens: [],
      orderId: 'o',
    });
    expect(plan).toEqual({ kind: 'skip', reason: 'no_tokens' });
  });
});
