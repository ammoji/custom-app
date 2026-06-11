/**
 * PR-NEXT-PARTNER-PHOTO — unit tests for formatPartnerAvatar.
 *
 * Test plan (4 cases):
 *   1. photo present → { kind: 'photo', uri }
 *   2. photo null    → { kind: 'initials', text: 'RB' }
 *   3. photo empty string → { kind: 'initials' } (same as null)
 *   4. name null + photo null → { kind: 'initials', text: '?' }
 */
import { formatPartnerAvatar } from '../../src/utils/formatPartnerAvatar';

describe('formatPartnerAvatar', () => {
  test('photo present → kind photo with uri', () => {
    const result = formatPartnerAvatar(
      'Rahul Bhat',
      'https://storage.googleapis.com/grocery-mvp-dev/delivery-profile/uid123.jpg',
    );
    expect(result.kind).toBe('photo');
    if (result.kind === 'photo') {
      expect(result.uri).toBe(
        'https://storage.googleapis.com/grocery-mvp-dev/delivery-profile/uid123.jpg',
      );
    }
  });

  test('photo null → initials from name', () => {
    const result = formatPartnerAvatar('Rahul Bhat', null);
    expect(result.kind).toBe('initials');
    if (result.kind === 'initials') {
      expect(result.text).toBe('RB');
    }
  });

  test('photo empty string → initials from name', () => {
    const result = formatPartnerAvatar('Rahul Bhat', '');
    expect(result.kind).toBe('initials');
    if (result.kind === 'initials') {
      expect(result.text).toBe('RB');
    }
  });

  test('name null + photo null → ? fallback', () => {
    const result = formatPartnerAvatar(null, null);
    expect(result.kind).toBe('initials');
    if (result.kind === 'initials') {
      expect(result.text).toBe('?');
    }
  });
});
