/**
 * PR-NEXT-13a — `initialsFor` pure-helper tests for
 * `src/utils/partnerInitials.ts` (the avatar-glyph derivation used
 * by `PartnerIdentityCard`).
 *
 * `@testing-library/react-native` isn't a project dependency, so the
 * component itself isn't snapshot-tested. The only non-trivial logic
 * in `PartnerIdentityCard` is the initials derivation; everything
 * else is JSX glue around theme tokens. Pinning `initialsFor` here
 * covers the avatar-glyph correctness without booting RN.
 */
import { initialsFor } from '../../src/utils/partnerInitials';

describe('initialsFor', () => {
  test('two-word name → first + last initials, upper-case', () => {
    expect(initialsFor('Sudhir Davim')).toBe('SD');
  });

  test('three-word name → first + last initials (skips middle)', () => {
    expect(initialsFor('Aman Kumar Singh')).toBe('AS');
  });

  test('single-word name → single initial', () => {
    expect(initialsFor('Aman')).toBe('A');
  });

  test('lower-case name → upper-case initials', () => {
    expect(initialsFor('aman kumar')).toBe('AK');
  });

  test('extra whitespace between words is collapsed', () => {
    expect(initialsFor('  Aman   Kumar  ')).toBe('AK');
  });

  test('empty string → fallback glyph', () => {
    expect(initialsFor('')).toBe('👤');
  });

  test('whitespace-only string → fallback glyph', () => {
    expect(initialsFor('   ')).toBe('👤');
  });

  test('undefined → fallback glyph', () => {
    expect(initialsFor(undefined)).toBe('👤');
  });

  test('null → fallback glyph', () => {
    expect(initialsFor(null)).toBe('👤');
  });
});
