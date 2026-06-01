/**
 * PR-NEXT-13a — pure-helper tests for `pickPartnerDisplayName` from
 * `functions/src/claimDeliveryHelpers.ts`. The callable wrapper
 * (`claimDelivery`) is integration-territory (transaction +
 * post-transaction reads); this helper is the only bit of logic
 * that's worth pinning in isolation.
 */
import { pickPartnerDisplayName } from '../../functions/src/claimDeliveryHelpers';

describe('pickPartnerDisplayName', () => {
  test('valid name → trimmed string', () => {
    expect(pickPartnerDisplayName('Sudhir Davim')).toBe('Sudhir Davim');
  });

  test('name with surrounding whitespace → trimmed', () => {
    expect(pickPartnerDisplayName('  Aman  ')).toBe('Aman');
  });

  test('empty string → null', () => {
    expect(pickPartnerDisplayName('')).toBeNull();
  });

  test('whitespace-only string → null', () => {
    expect(pickPartnerDisplayName('   ')).toBeNull();
  });

  test('undefined → null', () => {
    expect(pickPartnerDisplayName(undefined)).toBeNull();
  });

  test('null → null', () => {
    expect(pickPartnerDisplayName(null)).toBeNull();
  });

  test('non-string (number) → null (defensive against historical writes)', () => {
    expect(pickPartnerDisplayName(42)).toBeNull();
  });

  test('non-string (object) → null', () => {
    expect(pickPartnerDisplayName({ first: 'X' })).toBeNull();
  });
});
