/**
 * HOTFIX-RESPOND-OWNER §C — +2 detection-unit tests proving the
 * shopOwnerCheck detector flags the banned indirect lookup and ignores
 * the correct direct-doc-read pattern (and line-allowlisted lookups).
 */
import { findBannedOwnerLookups } from './shopOwnerCheckDetect';

const BAD = `
if (isShopOwner) {
  const shopSnap = await db.collection('shops').where('ownerUid', '==', uid).limit(1).get();
  if (shopSnap.empty || shopSnap.docs[0].id !== rev.shopId) {
    throw new HttpsError('permission-denied', 'Not the owner of this shop');
  }
}
`;

const GOOD = `
const snap = await db.doc(\`shops/\${rev.shopId}\`).get();
const shop = snap.data();
if (shop.ownerUid !== uid) {
  throw new HttpsError('permission-denied', 'Not the owner of this shop');
}
`;

const ALLOWLISTED = `
// No specific shop requested — resolve the caller's own shop.
// shop-owner-audit:allow
const ownerSnap = await db.collection('shops').where('ownerUid', '==', uid).limit(1).get();
`;

describe('shopOwnerCheck detector', () => {
  it('flags the banned where(ownerUid == X).limit(1) lookup', () => {
    expect(findBannedOwnerLookups(BAD)).toHaveLength(1);
  });

  it('ignores the correct direct-doc-read pattern', () => {
    expect(findBannedOwnerLookups(GOOD)).toEqual([]);
  });

  it('ignores a line-allowlisted find-my-shop query', () => {
    expect(findBannedOwnerLookups(ALLOWLISTED)).toEqual([]);
  });
});
