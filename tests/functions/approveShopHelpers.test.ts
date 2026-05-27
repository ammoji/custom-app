/**
 * PR 42 — Tests for the pure helper behind `approveShop`'s
 * storefront-photo wiring step. Validates the path-extraction
 * contract against every shop-doc shape we expect to see in
 * the wild (legacy, mid-registration, forged, fully-uploaded).
 */
import {
  buildFirebaseStorageDownloadUrl,
  pickStorefrontPath,
  type ShopDocLike,
} from '../../functions/src/approveShopHelpers';

describe('PR 42 — pickStorefrontPath', () => {
  test('returns the storagePath when storefront is fully uploaded', () => {
    const shop: ShopDocLike = {
      registrationData: {
        kycDocs: {
          storefront: {
            storagePath: 'shop-kyc/shop_abc/storefront.jpg',
          },
        },
      },
    };
    expect(pickStorefrontPath(shop)).toBe(
      'shop-kyc/shop_abc/storefront.jpg',
    );
  });

  test('returns null for a pre-PR-31 shop with no registrationData', () => {
    expect(pickStorefrontPath({})).toBeNull();
  });

  test('returns null when registrationData exists but kycDocs is missing', () => {
    expect(pickStorefrontPath({ registrationData: {} })).toBeNull();
  });

  test('returns null when kycDocs exists but storefront was never uploaded (other docs ok)', () => {
    const shop: ShopDocLike = {
      registrationData: {
        kycDocs: {
          gstDoc: { storagePath: 'shop-kyc/shop_abc/gst.jpg' },
          fssaiDoc: { storagePath: 'shop-kyc/shop_abc/fssai.jpg' },
        },
      },
    };
    expect(pickStorefrontPath(shop)).toBeNull();
  });

  test('returns null when storefront field exists but storagePath is empty string (defensive)', () => {
    const shop: ShopDocLike = {
      registrationData: {
        kycDocs: { storefront: { storagePath: '' } },
      },
    };
    expect(pickStorefrontPath(shop)).toBeNull();
  });

  test('returns null when storefront.storagePath is not a string (forged payload)', () => {
    const shop = {
      registrationData: {
        kycDocs: { storefront: { storagePath: 123 as unknown as string } },
      },
    } as ShopDocLike;
    expect(pickStorefrontPath(shop)).toBeNull();
  });

  test('returns null when storefront ref itself is null', () => {
    const shop: ShopDocLike = {
      registrationData: {
        kycDocs: { storefront: null },
      },
    };
    expect(pickStorefrontPath(shop)).toBeNull();
  });
});

describe('PR 42.0.1 — buildFirebaseStorageDownloadUrl', () => {
  // Hotfix tests. Replaced the original STOREFRONT_SIGNED_URL_TTL_MS
  // suite because V4 signed URLs are no longer the mechanism — they
  // cap at 7 days and the 10-year TTL exploded at runtime
  // ("Max allowed expiration is seven days"). The new pattern uses
  // Firebase download-token URLs which never expire.

  test('produces a well-formed Firebase Storage download URL', () => {
    const url = buildFirebaseStorageDownloadUrl(
      'grocery-mvp-dev.appspot.com',
      'shop-kyc/shop_abc/storefront.jpg',
      '00000000-0000-0000-0000-000000000001',
    );
    expect(url).toBe(
      'https://firebasestorage.googleapis.com/v0/b/grocery-mvp-dev.appspot.com/o/shop-kyc%2Fshop_abc%2Fstorefront.jpg?alt=media&token=00000000-0000-0000-0000-000000000001',
    );
  });

  test('percent-encodes the object path so slashes survive transport', () => {
    // Firebase's REST contract wants slashes as %2F; the client
    // SDK encodes the same way. The token URL must match or
    // resolves 404.
    const url = buildFirebaseStorageDownloadUrl(
      'bkt',
      'a/b/c.jpg',
      'tok',
    );
    expect(url).toContain('/o/a%2Fb%2Fc.jpg?');
    expect(url).not.toContain('/o/a/b/c.jpg');
  });

  test('escapes special characters in the object path', () => {
    // Real filenames from `recordShopKycUpload` use `_` and `-`,
    // but a future filename change must not break URL parsing.
    // encodeURIComponent handles spaces, `?`, `#`, `&`, etc.
    const url = buildFirebaseStorageDownloadUrl(
      'bkt',
      'shop kyc/a b?c#d&e.jpg',
      'tok',
    );
    expect(url).toContain('shop%20kyc%2Fa%20b%3Fc%23d%26e.jpg');
  });

  test('preserves the token verbatim in the query string', () => {
    // The token is the auth credential. Any mangling breaks the
    // URL. crypto.randomUUID produces hex+hyphens which are URL-safe
    // so no encoding is needed.
    const token = 'aaaa-bbbb-cccc-dddd';
    const url = buildFirebaseStorageDownloadUrl('bkt', 'path.jpg', token);
    expect(url.endsWith(`?alt=media&token=${token}`)).toBe(true);
  });

  test('uses the bucket name verbatim (no gs:// stripping)', () => {
    // The caller passes `bucket.name` from the admin SDK which is
    // already the raw name. Helper does no defensive cleanup —
    // callers that pass `gs://bkt` will produce a broken URL and
    // SHOULD be fixed at the call site, not silently massaged.
    const url = buildFirebaseStorageDownloadUrl(
      'grocery-mvp-dev.appspot.com',
      'p.jpg',
      'tok',
    );
    expect(url).toContain('/b/grocery-mvp-dev.appspot.com/o/');
  });
});
