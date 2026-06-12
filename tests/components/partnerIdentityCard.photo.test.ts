/**
 * PR-NEXT-BUNDLE-H §B — +5 tests for PartnerIdentityCard avatar logic.
 *
 * Tests the `formatPartnerAvatar` helper wired into PartnerIdentityCard
 * (component itself is JSX and can't run in the pure-Node test env).
 * Mirrors the test isolation pattern of partnerIdentityCard.initials.test.ts.
 */
import { formatPartnerAvatar } from '../../src/utils/formatPartnerAvatar';

describe('PartnerIdentityCard avatar — §B photo support', () => {
  it('null name + null photoUrl → initials kind (no crash)', () => {
    const av = formatPartnerAvatar(null, null);
    expect(av.kind).toBe('initials');
  });

  it('name + valid photoUrl → photo kind with uri', () => {
    const av = formatPartnerAvatar('Rahul Kumar', 'https://example.com/photo.jpg');
    expect(av.kind).toBe('photo');
    if (av.kind !== 'photo') return;
    expect(av.uri).toBe('https://example.com/photo.jpg');
  });

  it('name + empty photoUrl → initials kind (empty string treated as absent)', () => {
    const av = formatPartnerAvatar('Rahul Kumar', '');
    expect(av.kind).toBe('initials');
  });

  it('name + undefined photoUrl → initials kind', () => {
    const av = formatPartnerAvatar('Priya Singh', undefined);
    expect(av.kind).toBe('initials');
    if (av.kind !== 'initials') return;
    expect(av.text).toBe('PS');
  });

  it('photo kind → uri matches provided photoUrl exactly', () => {
    const url = 'https://firebasestorage.googleapis.com/v0/b/bucket/o/photo.jpg?alt=media&token=abc';
    const av = formatPartnerAvatar('Test User', url);
    expect(av.kind).toBe('photo');
    if (av.kind !== 'photo') return;
    expect(av.uri).toBe(url);
  });
});
