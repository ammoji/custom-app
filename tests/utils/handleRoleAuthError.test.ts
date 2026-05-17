/**
 * Unit tests for src/utils/handleRoleAuthError.ts. Covers both the
 * pure predicate (isRoleRevocationError) and the async refresh-
 * orchestration wrapper (handleRoleAuthError).
 */
import {
  handleRoleAuthError,
  isRoleRevocationError,
} from '../../src/utils/handleRoleAuthError';
import type { AuthUser } from '../../src/services/authService';

describe('isRoleRevocationError', () => {
  test('recognizes functions/permission-denied (callable shape)', () => {
    expect(
      isRoleRevocationError({ code: 'functions/permission-denied' }),
    ).toBe(true);
  });

  test('recognizes permission-denied (no prefix, raw Firestore)', () => {
    expect(isRoleRevocationError({ code: 'permission-denied' })).toBe(true);
  });

  test('recognizes unauthenticated', () => {
    expect(isRoleRevocationError({ code: 'unauthenticated' })).toBe(true);
    expect(
      isRoleRevocationError({ code: 'functions/unauthenticated' }),
    ).toBe(true);
  });

  test('falls back to message substring match when code is missing', () => {
    expect(
      isRoleRevocationError({
        message: 'PERMISSION_DENIED: Missing or insufficient permissions',
      }),
    ).toBe(true);
  });

  test('ignores unrelated errors', () => {
    expect(isRoleRevocationError({ code: 'not-found' })).toBe(false);
    expect(isRoleRevocationError({ code: 'unavailable' })).toBe(false);
    expect(
      isRoleRevocationError({ message: 'network request failed' }),
    ).toBe(false);
    expect(isRoleRevocationError(null)).toBe(false);
    expect(isRoleRevocationError(undefined)).toBe(false);
  });
});

describe('handleRoleAuthError', () => {
  const fakeUser: AuthUser = {
    uid: 'u1',
    isAnonymous: false,
    phoneNumber: '+91',
    isAdmin: false,
    isShopOwner: false,
    shopId: null,
    isDelivery: false,
  };

  test('returns false and does not call setUser for unrelated errors', async () => {
    const refresh = jest.fn();
    const setUser = jest.fn();
    const handled = await handleRoleAuthError(
      { code: 'not-found' },
      refresh as any,
      setUser,
    );
    expect(handled).toBe(false);
    expect(refresh).not.toHaveBeenCalled();
    expect(setUser).not.toHaveBeenCalled();
  });

  test('calls setUser with refreshed user when claim refresh succeeds', async () => {
    const refresh = jest.fn().mockResolvedValue(fakeUser);
    const setUser = jest.fn();
    const handled = await handleRoleAuthError(
      { code: 'permission-denied' },
      refresh as any,
      setUser,
    );
    expect(handled).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(setUser).toHaveBeenCalledWith(fakeUser);
  });

  test('still returns true if refreshClaims rejects (best-effort, no throw)', async () => {
    const refresh = jest.fn().mockRejectedValue(new Error('network down'));
    const setUser = jest.fn();
    // Suppress the internal console.warn during this test.
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const handled = await handleRoleAuthError(
      { code: 'unauthenticated' },
      refresh as any,
      setUser,
    );
    expect(handled).toBe(true);
    expect(setUser).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  test('passes null through to setUser when refresh returns null (signed out)', async () => {
    const refresh = jest.fn().mockResolvedValue(null);
    const setUser = jest.fn();
    const handled = await handleRoleAuthError(
      { code: 'permission-denied' },
      refresh as any,
      setUser,
    );
    expect(handled).toBe(true);
    expect(setUser).toHaveBeenCalledWith(null);
  });
});
