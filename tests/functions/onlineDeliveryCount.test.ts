/**
 * Pure-helper tests for `computeOnlineDeliveryCount` in
 * functions/src/onlineDeliveryCountHelpers.ts (Phase 12c).
 *
 * Same posture as validateShopOrdersAccess — extract the auth check
 * + count assembly into a pure helper so the wrapping callable in
 * functions/src/index.ts is a one-liner over Firestore + a thrown
 * HttpsError. Tests inject a fake `fetchCount` so the suite runs in
 * plain Node without an emulator.
 */
import { computeOnlineDeliveryCount } from '../../functions/src/onlineDeliveryCountHelpers';

describe('computeOnlineDeliveryCount', () => {
  test('admin caller: returns count of users matching isDelivery + online', async () => {
    const result = await computeOnlineDeliveryCount({
      auth: { token: { admin: true } },
      fetchCount: async () => 5,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.count).toBe(5);
  });

  test('admin caller: count of zero comes through cleanly', async () => {
    const result = await computeOnlineDeliveryCount({
      auth: { token: { admin: true } },
      fetchCount: async () => 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.count).toBe(0);
  });

  test('non-admin signed-in caller: rejects with permission-denied', async () => {
    const result = await computeOnlineDeliveryCount({
      auth: { token: { admin: false } },
      fetchCount: async () => {
        throw new Error('fetchCount must NOT run for non-admin');
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('permission-denied');
  });

  test('shopOwner / delivery callers: still rejected (admin-only)', async () => {
    const r1 = await computeOnlineDeliveryCount({
      auth: { token: { shopOwner: true } },
      fetchCount: async () => 99,
    });
    const r2 = await computeOnlineDeliveryCount({
      auth: { token: { delivery: true } },
      fetchCount: async () => 99,
    });
    expect(r1.ok).toBe(false);
    expect(r2.ok).toBe(false);
    if (!r1.ok) expect(r1.code).toBe('permission-denied');
    if (!r2.ok) expect(r2.code).toBe('permission-denied');
  });

  test('unauthenticated caller: rejects with unauthenticated', async () => {
    const result = await computeOnlineDeliveryCount({
      auth: null,
      fetchCount: async () => {
        throw new Error('fetchCount must NOT run for unauthenticated');
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('unauthenticated');
  });
});
