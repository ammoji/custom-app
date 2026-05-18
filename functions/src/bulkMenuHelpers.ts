/**
 * PR 8 Part B — pure helper for bulkUpdateMenuAvailability callable.
 *
 * Validates the request shape + auth. Does NOT touch Firestore;
 * the callable wrapper does the actual menu writes after this
 * helper passes. Same posture as menuImageUploadHelpers /
 * customerCancelWindowHelpers.
 *
 * Why a 100-id cap: Firestore transactions are limited to 500 doc
 * writes; a shop owner with > 100 items toggling all of them at
 * once is rare enough that batching client-side is acceptable. The
 * cap also makes worst-case latency predictable (≤100 reads + 100
 * writes per call).
 *
 * Strict equality on `shopOwner === true` follows the project
 * convention (PRs 5/6/7 hotfixes were all about truthy-vs-strict-
 * equal claim checks).
 *
 * Pinned by tests/functions/bulkMenuHelpers.test.ts.
 */

export const BULK_MENU_MAX_IDS = 100;

export type BulkMenuInput = {
  auth:
    | {
        uid: string;
        token?: { shopOwner?: unknown; shopId?: unknown };
      }
    | null
    | undefined;
  menuItemIds: unknown;
  available: unknown;
};

export type BulkMenuResult =
  | {
      ok: true;
      shopId: string;
      validIds: string[];
      available: boolean;
    }
  | {
      ok: false;
      code: 'unauthenticated' | 'permission-denied' | 'invalid-argument';
      message: string;
    };

export function validateBulkMenuRequest(
  input: BulkMenuInput,
): BulkMenuResult {
  const { auth } = input;
  if (!auth || typeof auth.uid !== 'string' || auth.uid.length === 0) {
    return {
      ok: false,
      code: 'unauthenticated',
      message: 'Sign in required',
    };
  }
  // Strict-equality. A forged token might smuggle a string 'true' or
  // numeric 1; reject anything but boolean true.
  if (auth.token?.shopOwner !== true) {
    return {
      ok: false,
      code: 'permission-denied',
      message: 'Only shop owners can bulk-update menu items',
    };
  }
  const shopId = auth.token?.shopId;
  if (typeof shopId !== 'string' || shopId.length === 0) {
    return {
      ok: false,
      code: 'permission-denied',
      message: 'Shop owner claim is missing shopId',
    };
  }
  if (!Array.isArray(input.menuItemIds)) {
    return {
      ok: false,
      code: 'invalid-argument',
      message: 'menuItemIds must be a non-empty array',
    };
  }
  if (input.menuItemIds.length === 0) {
    return {
      ok: false,
      code: 'invalid-argument',
      message: 'menuItemIds must be a non-empty array',
    };
  }
  if (input.menuItemIds.length > BULK_MENU_MAX_IDS) {
    return {
      ok: false,
      code: 'invalid-argument',
      message: `Too many ids — max ${BULK_MENU_MAX_IDS} per call`,
    };
  }
  // Reject any non-string entry so the caller can't smuggle in
  // numbers / null / objects that would later fail with confusing
  // Firestore errors. Also reject empty strings.
  const validIds: string[] = [];
  for (const raw of input.menuItemIds) {
    if (typeof raw !== 'string' || raw.length === 0) {
      return {
        ok: false,
        code: 'invalid-argument',
        message: 'All menuItemIds must be non-empty strings',
      };
    }
    validIds.push(raw);
  }
  if (typeof input.available !== 'boolean') {
    return {
      ok: false,
      code: 'invalid-argument',
      message: 'available must be a boolean',
    };
  }
  return {
    ok: true,
    shopId,
    validIds,
    available: input.available,
  };
}
