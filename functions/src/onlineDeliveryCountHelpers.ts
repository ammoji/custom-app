/**
 * Pure helper extracted from `getOnlineDeliveryCount` (Phase 12c)
 * so the auth check + count assembly can be unit-tested without
 * booting firebase-admin / firebase-functions.
 *
 * The Cloud Function callable does the Firestore query and passes
 * the resulting count as a number into this helper, which validates
 * the auth claims and shapes the response. Splitting it this way
 * lets the test inject a fake `fetchCount` and assert behaviour
 * for both authorized + unauthorized callers without an emulator.
 *
 * Mirrors the contract of validateShopOrdersAccess in
 * shopOrdersHelpers.ts — return a typed Result rather than throwing,
 * so the call-site decides which HttpsError code to throw.
 */

export type AdminClaims = {
  admin?: boolean;
} & Record<string, unknown>;

export type OnlineDeliveryCountResult =
  | { ok: true; count: number }
  | { ok: false; code: 'unauthenticated' | 'permission-denied'; message: string };

export async function computeOnlineDeliveryCount(input: {
  auth: { token: AdminClaims } | null | undefined;
  fetchCount: () => Promise<number>;
}): Promise<OnlineDeliveryCountResult> {
  const { auth, fetchCount } = input;
  if (!auth) {
    return {
      ok: false,
      code: 'unauthenticated',
      message: 'Sign in required',
    };
  }
  if (auth.token?.admin !== true) {
    return {
      ok: false,
      code: 'permission-denied',
      message: 'Admin only',
    };
  }
  const count = await fetchCount();
  return { ok: true, count: Math.max(0, Math.floor(count)) };
}
