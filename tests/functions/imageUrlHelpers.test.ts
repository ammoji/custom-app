/**
 * Unit tests for `validateMenuImageUrl`.
 *
 * Pins the PR 6 server-side imageUrl policy. Deliberate-break demo
 * target: weaken the helper to always return `{ ok: true, url: raw }`
 * — the "rejects external host (picsum)" test goes red, since that's
 * the canonical exploit vector the helper exists to close.
 */
import { validateMenuImageUrl } from '../../functions/src/imageUrlHelpers';

describe('validateMenuImageUrl — accepted shapes', () => {
  test('undefined → ok with url=null (treated as "no image")', () => {
    const r = validateMenuImageUrl(undefined);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.url).toBeNull();
  });

  test('null → ok with url=null', () => {
    const r = validateMenuImageUrl(null);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.url).toBeNull();
  });

  test('empty string → ok with url=null', () => {
    const r = validateMenuImageUrl('');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.url).toBeNull();
  });

  test('whitespace-only string → ok with url=null', () => {
    const r = validateMenuImageUrl('   ');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.url).toBeNull();
  });

  test('legacy firebasestorage.googleapis.com URL → ok with url=trimmed', () => {
    // Older Firebase projects use this host. The token query param
    // is part of the canonical download URL shape and must be
    // preserved.
    const url =
      'https://firebasestorage.googleapis.com/v0/b/grocery-mvp.appspot.com/o/menu%2Fshop_A%2F123.jpg?alt=media&token=abc';
    const r = validateMenuImageUrl(url);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.url).toBe(url);
  });

  test('new firebasestorage.app subdomain URL → ok with url=trimmed', () => {
    // grocery-mvp-dev uses the new per-project subdomain.
    const url =
      'https://grocery-mvp-dev.firebasestorage.app/v0/b/grocery-mvp-dev.firebasestorage.app/o/menu%2Fshop_A%2F123.jpg?alt=media&token=abc';
    const r = validateMenuImageUrl(url);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.url).toBe(url);
  });

  test('trims surrounding whitespace before validating', () => {
    const url =
      '  https://firebasestorage.googleapis.com/v0/b/x/o/menu%2Fy.jpg?alt=media  ';
    const r = validateMenuImageUrl(url);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.url).toBe(url.trim());
  });
});

describe('validateMenuImageUrl — rejected shapes', () => {
  test('rejects http (not https)', () => {
    const r = validateMenuImageUrl(
      'http://firebasestorage.googleapis.com/v0/b/x/o/menu%2Fy.jpg',
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/https/i);
  });

  test('rejects external host (picsum.photos) — canonical exploit', () => {
    // This is the deliberate-break demo target. Hot-linking external
    // imagery (copyrighted assets, malicious payloads, server-side
    // costs to fetch on every customer browse) is the primary risk
    // this helper exists to close.
    const r = validateMenuImageUrl('https://picsum.photos/400/400');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/Storage bucket/i);
  });

  test('rejects random external host (random.com)', () => {
    const r = validateMenuImageUrl(
      'https://random.com/some/path/image.jpg',
    );
    expect(r.ok).toBe(false);
  });

  test('rejects spoofed subdomain that just contains the suffix as a substring', () => {
    // "evilfirebasestorage.app.attacker.com" — the suffix appears
    // in the hostname but NOT at the end. endsWith is the right
    // check; this test pins that posture.
    const r = validateMenuImageUrl(
      'https://firebasestorage.app.attacker.com/payload.jpg',
    );
    expect(r.ok).toBe(false);
  });

  test('rejects non-string types (number)', () => {
    const r = validateMenuImageUrl(42 as unknown as string);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/string/i);
  });

  test('rejects non-string types (object)', () => {
    const r = validateMenuImageUrl({ url: 'https://...' } as unknown as string);
    expect(r.ok).toBe(false);
  });

  test('rejects malformed URL', () => {
    const r = validateMenuImageUrl('not a url at all');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/valid URL/i);
  });
});
