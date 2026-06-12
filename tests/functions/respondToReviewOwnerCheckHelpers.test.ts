/**
 * HOTFIX-RESPOND-OWNER §B — +5 tests pinning validateShopOwnerForReview.
 * Covers the multi-shop-owner failing case from Sudhir's screenshot.
 */
import { validateShopOwnerForReview } from '../../functions/src/respondToReviewOwnerCheckHelpers';

const reader = (docs: Record<string, { ownerUid?: string | null } | null>) =>
  async (shopId: string) => docs[shopId] ?? null;

describe('validateShopOwnerForReview', () => {
  it('ok when shop exists and caller is the owner', async () => {
    const res = await validateShopOwnerForReview({
      callerUid: 'u1',
      reviewShopId: 'shopA',
      readShopDoc: reader({ shopA: { ownerUid: 'u1' } }),
    });
    expect(res).toEqual({ ok: true });
  });

  it('not_owner when shop exists but caller is not the owner', async () => {
    const res = await validateShopOwnerForReview({
      callerUid: 'u1',
      reviewShopId: 'shopA',
      readShopDoc: reader({ shopA: { ownerUid: 'someoneElse' } }),
    });
    expect(res).toEqual({
      ok: false,
      code: 'not_owner',
      message: 'Not the owner of this shop',
    });
  });

  it('shop_not_found when the shop doc does not exist', async () => {
    const res = await validateShopOwnerForReview({
      callerUid: 'u1',
      reviewShopId: 'ghost',
      readShopDoc: reader({}),
    });
    expect(res).toEqual({
      ok: false,
      code: 'shop_not_found',
      message: 'Shop not found',
    });
  });

  it('not_owner when shop has a null ownerUid (corrupted data)', async () => {
    const res = await validateShopOwnerForReview({
      callerUid: 'u1',
      reviewShopId: 'shopA',
      readShopDoc: reader({ shopA: { ownerUid: null } }),
    });
    expect(res).toEqual({
      ok: false,
      code: 'not_owner',
      message: 'Not the owner of this shop',
    });
  });

  it('multi-shop owner: not_owner when reviewShopId is a shop they do NOT own', async () => {
    // The exact failing case: u1 owns shopA + shopB, but the review is
    // for shopC (owned by u2). The old `where ownerUid == uid limit 1`
    // would resolve shopA and pass/fail arbitrarily; the direct read
    // correctly checks shopC.
    const res = await validateShopOwnerForReview({
      callerUid: 'u1',
      reviewShopId: 'shopC',
      readShopDoc: reader({
        shopA: { ownerUid: 'u1' },
        shopB: { ownerUid: 'u1' },
        shopC: { ownerUid: 'u2' },
      }),
    });
    expect(res.ok).toBe(false);

    // ...and ok when reviewShopId IS one of their shops.
    const res2 = await validateShopOwnerForReview({
      callerUid: 'u1',
      reviewShopId: 'shopB',
      readShopDoc: reader({
        shopA: { ownerUid: 'u1' },
        shopB: { ownerUid: 'u1' },
        shopC: { ownerUid: 'u2' },
      }),
    });
    expect(res2).toEqual({ ok: true });
  });
});
