/**
 * Pure unit tests for promoteDefaultAfterDelete extracted from the
 * deleteAddress Cloud Function. The function returns the new
 * `defaultAddressId` for the user's profile after one row is removed.
 *
 * Filed under tests/utils/ rather than tests/functions/ because the
 * helper is reusable and the spec asked for it here. (The source
 * still lives in functions/src/profileHelpers.ts where the Cloud
 * Function imports it.)
 */
import { promoteDefaultAfterDelete } from '../../functions/src/profileHelpers';

describe('promoteDefaultAfterDelete', () => {
  test('returns null when no addresses remain after the delete', () => {
    expect(promoteDefaultAfterDelete([], 'addr-1', 'addr-1')).toBeNull();
  });

  test('promotes the most-recently-updated address when default was deleted', () => {
    // Three remaining addresses, addr-2 has the highest updatedAt.
    const remaining = [
      { id: 'addr-2', updatedAt: 3000 },
      { id: 'addr-3', updatedAt: 2000 },
      { id: 'addr-4', updatedAt: 1000 },
    ];
    const next = promoteDefaultAfterDelete(remaining, 'addr-1', 'addr-1');
    expect(next).toBe('addr-2');
  });

  test('preserves current default when a non-default address was deleted', () => {
    const remaining = [
      { id: 'addr-1', updatedAt: 1000 },
      { id: 'addr-3', updatedAt: 9999 },
    ];
    // Deleted addr-2 (not the default); current default addr-1 must
    // remain untouched even though addr-3 has a more recent updatedAt.
    const next = promoteDefaultAfterDelete(remaining, 'addr-2', 'addr-1');
    expect(next).toBe('addr-1');
  });

  test('handles undefined currentDefaultId by promoting most-recent', () => {
    // Legacy users predating defaultAddressId will pass undefined.
    // Treated like "the current default just got deleted" → promote.
    const remaining = [
      { id: 'addr-2', updatedAt: 5000 },
      { id: 'addr-3', updatedAt: 1000 },
    ];
    const next = promoteDefaultAfterDelete(remaining, 'addr-1', undefined);
    expect(next).toBe('addr-2');
  });
});
