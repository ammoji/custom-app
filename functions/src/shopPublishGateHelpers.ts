/**
 * PR-NEXT-BUNDLE-M — pure auth/validation deciders for the publish-gate
 * callables.
 *
 * The `recomputeShopPublishStatus` + `forceShopPublishOverride`
 * callables are thin IO wrappers over these Validator-Result helpers
 * (same posture as `validateShopLocationForApproval` /
 * `deliveryProfileHelpers`). Keeping the auth + argument decisions pure
 * means they're unit-testable without booting firebase-admin or the
 * emulator — the callable maps the returned `code` to an `HttpsError`.
 *
 * Pinned by `tests/functions/recomputeShopPublishStatus.test.ts` and
 * `tests/functions/forceShopPublishOverride.test.ts`.
 */

export type RecomputeAuthInput = {
  signedIn: boolean;
  isAdmin: boolean;
  isShopOwner: boolean;
  claimShopId?: string | null;
  requestedShopId?: string | null;
};

export type RecomputeAuthResult =
  | { ok: true; shopId: string }
  | {
      ok: false;
      code: 'unauthenticated' | 'invalid-argument' | 'permission-denied';
      message: string;
    };

/**
 * Decide whether a caller may recompute a shop's publish status, and
 * resolve which shopId they're targeting.
 *
 * Rules:
 *   - must be signed in
 *   - target shopId = explicit `requestedShopId` if non-empty, else the
 *     caller's own `claimShopId`
 *   - a shopId must resolve (else invalid-argument)
 *   - admins may target ANY shop
 *   - a shop owner may target ONLY their own shop (confused-deputy guard)
 *   - anyone else → permission-denied
 */
export function decideRecomputeAuth(
  input: RecomputeAuthInput,
): RecomputeAuthResult {
  if (!input.signedIn) {
    return { ok: false, code: 'unauthenticated', message: 'Sign in required' };
  }

  const requested =
    typeof input.requestedShopId === 'string' && input.requestedShopId.length > 0
      ? input.requestedShopId
      : typeof input.claimShopId === 'string' && input.claimShopId.length > 0
        ? input.claimShopId
        : '';
  if (!requested) {
    return { ok: false, code: 'invalid-argument', message: 'shopId is required' };
  }

  if (input.isAdmin) {
    return { ok: true, shopId: requested };
  }

  if (input.isShopOwner && input.claimShopId === requested) {
    return { ok: true, shopId: requested };
  }

  return {
    ok: false,
    code: 'permission-denied',
    message: 'You can only refresh your own shop.',
  };
}

export type ForceOverrideInput = {
  signedIn: boolean;
  isAdmin: boolean;
  shopId?: unknown;
  override?: unknown;
  reason?: unknown;
};

export type ForceOverrideResult =
  | { ok: true; shopId: string; override: boolean; reason: string }
  | {
      ok: false;
      code: 'unauthenticated' | 'permission-denied' | 'invalid-argument';
      message: string;
    };

/**
 * Validate a force-publish-override request. Admin-only. A non-empty
 * reason is mandatory when ENABLING the override (governance); removing
 * it needs no reason. Returns the normalized (trimmed) reason on
 * success.
 */
export function validateForceOverrideInput(
  input: ForceOverrideInput,
): ForceOverrideResult {
  if (!input.signedIn) {
    return { ok: false, code: 'unauthenticated', message: 'Sign in required' };
  }
  if (!input.isAdmin) {
    return { ok: false, code: 'permission-denied', message: 'Admin role required' };
  }
  if (typeof input.shopId !== 'string' || input.shopId.length === 0) {
    return { ok: false, code: 'invalid-argument', message: 'shopId is required' };
  }
  const override = input.override === true;
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (override && reason.length === 0) {
    return {
      ok: false,
      code: 'invalid-argument',
      message: 'A reason is required to force-publish a shop.',
    };
  }
  return { ok: true, shopId: input.shopId, override, reason };
}
