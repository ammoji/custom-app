/**
 * Unit tests for `checkMinOrderGate` — PR 5 admin-bypass policy.
 *
 * Mirrors the two acceptance-criteria test cases from the PR 5
 * prompt:
 *   - Non-admin caller below minOrder → rejected.
 *   - Admin caller below minOrder → accepted (other validation still
 *     runs upstream; this helper only owns the minOrder decision).
 * Plus the truthy-but-not-true guard, since that's the failure mode
 * the platform-policy comment in the helper specifically calls out.
 */
import {
  checkMinOrderGate,
  MinOrderGateInput,
} from '../../functions/src/placeOrderGateHelpers';

const customer = (overrides: Partial<MinOrderGateInput> = {}): MinOrderGateInput => ({
  auth: { token: {} },
  subtotal: 100,
  minOrder: 200,
  ...overrides,
});

describe('checkMinOrderGate', () => {
  test('non-admin caller below minOrder → rejected', () => {
    const r = checkMinOrderGate(customer({ subtotal: 100, minOrder: 200 }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toContain('200');
      expect(r.message).toContain('100');
    }
  });

  test('non-admin caller at exactly minOrder → accepted', () => {
    const r = checkMinOrderGate(customer({ subtotal: 200, minOrder: 200 }));
    expect(r.ok).toBe(true);
  });

  test('non-admin caller above minOrder → accepted', () => {
    const r = checkMinOrderGate(customer({ subtotal: 500, minOrder: 200 }));
    expect(r.ok).toBe(true);
  });

  test('admin caller below minOrder → accepted (bypass)', () => {
    const r = checkMinOrderGate({
      auth: { token: { admin: true } },
      subtotal: 50,
      minOrder: 500,
    });
    expect(r.ok).toBe(true);
  });

  test('admin caller with subtotal 0 still accepted', () => {
    // Edge case: operator testing the "empty cart" failure mode
    // upstream — this helper shouldn't artificially block them.
    // (The "must have ≥1 item" rule is enforced earlier in placeOrder
    // anyway, before this gate runs.)
    const r = checkMinOrderGate({
      auth: { token: { admin: true } },
      subtotal: 0,
      minOrder: 500,
    });
    expect(r.ok).toBe(true);
  });

  test('rejects truthy-but-not-true admin claim (strict equality)', () => {
    // Platform policy: malformed tokens carrying `admin: 1` or
    // `admin: 'yes'` must NOT bypass the gate. Otherwise a JWT
    // mis-issue could silently turn into a free-shipping exploit.
    const r = checkMinOrderGate({
      auth: { token: { admin: 1 as unknown as boolean } },
      subtotal: 50,
      minOrder: 500,
    });
    expect(r.ok).toBe(false);
  });

  test('null auth (anonymous) below minOrder → rejected', () => {
    const r = checkMinOrderGate({
      auth: null,
      subtotal: 50,
      minOrder: 500,
    });
    expect(r.ok).toBe(false);
  });
});
