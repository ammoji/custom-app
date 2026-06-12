/**
 * HOTFIX-RESPOND-OWNER — pure auth helper for the shop-owner branch
 * of respondToReview. Replaces the broken `where ownerUid == uid
 * limit 1` indirect lookup with a direct shop-by-id check, mirroring
 * the recordShopKycUpload pattern.
 *
 * Rule 14 — discriminated-union Result.
 * Pinned by tests/functions/respondToReviewOwnerCheckHelpers.test.ts.
 */

export type ShopOwnerCheckResult =
  | { ok: true }
  | { ok: false; code: 'shop_not_found' | 'not_owner'; message: string };

export async function validateShopOwnerForReview(args: {
  callerUid: string;
  reviewShopId: string;
  readShopDoc: (shopId: string) => Promise<{ ownerUid?: string | null } | null>;
}): Promise<ShopOwnerCheckResult> {
  const shop = await args.readShopDoc(args.reviewShopId);
  if (!shop) {
    return {
      ok: false,
      code: 'shop_not_found',
      message: 'Shop not found',
    };
  }
  if (shop.ownerUid !== args.callerUid) {
    return {
      ok: false,
      code: 'not_owner',
      message: 'Not the owner of this shop',
    };
  }
  return { ok: true };
}
