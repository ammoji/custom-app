/**
 * PR-NEXT-ENH-2 (finding #5 follow-up) — pure validator for the
 * `bulkRemoveMenuItems` callable. Mirrors `validateBulkMenuRequest`
 * from `bulkMenuHelpers.ts` exactly, minus the `available` field
 * (the soft-delete write is unconditional — `deletedAt` +
 * `available: false`).
 *
 * Same 100-id cap, same shopOwner + shopId claim posture, same
 * non-empty-string check on every id. Strict equality on
 * `shopOwner === true` follows project convention (PRs 5/6/7
 * hotfixes were all about truthy-vs-strict-equal claim checks).
 *
 * Pinned by tests/functions/bulkRemoveMenuHelpers.test.ts.
 */

export const BULK_REMOVE_MAX_IDS = 100;

export type BulkRemoveInput = {
  auth:
    | {
        uid: string;
        token?: { shopOwner?: unknown; shopId?: unknown };
      }
    | null
    | undefined;
  menuItemIds: unknown;
};

export type BulkRemoveResult =
  | {
      ok: true;
      shopId: string;
      validIds: string[];
    }
  | {
      ok: false;
      code: 'unauthenticated' | 'permission-denied' | 'invalid-argument';
      message: string;
    };

export function validateBulkRemoveRequest(
  input: BulkRemoveInput,
): BulkRemoveResult {
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
      message: 'Only shop owners can bulk-delete menu items',
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
  if (input.menuItemIds.length > BULK_REMOVE_MAX_IDS) {
    return {
      ok: false,
      code: 'invalid-argument',
      message: `Too many ids — max ${BULK_REMOVE_MAX_IDS} per call`,
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
  return { ok: true, shopId, validIds };
}
