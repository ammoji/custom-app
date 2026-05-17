/**
 * Pure-helper tests for the delivery-approval flow (PR 1).
 *
 * Same posture as profileHelpers.test.ts and listShopOrdersValidation.test.ts.
 * The Cloud Function wraps these helpers in HttpsError; these tests
 * lock the auth + validation rules so a future contributor can't
 * weaken them by accident.
 */
import {
  canApproveDeliveryRequest,
  canRejectDeliveryRequest,
  requireAdminCaller,
  validateRequestDeliveryRole,
} from '../../functions/src/deliveryRequestHelpers';

// ────────────────────────────────────────────────────────────
// validateRequestDeliveryRole
// ────────────────────────────────────────────────────────────

describe('validateRequestDeliveryRole', () => {
  test('rejects unauthenticated caller', () => {
    const r = validateRequestDeliveryRole({
      auth: null,
      hasExistingPendingRequest: false,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('unauthenticated');
  });

  test('rejects caller who already has the delivery claim', () => {
    const r = validateRequestDeliveryRole({
      auth: { uid: 'u1', token: { delivery: true } },
      hasExistingPendingRequest: false,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('failed-precondition');
    expect(r.message).toMatch(/already a delivery partner/i);
  });

  test('rejects caller with an existing pending request (one-per-user)', () => {
    const r = validateRequestDeliveryRole({
      auth: { uid: 'u1', token: {} },
      hasExistingPendingRequest: true,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('failed-precondition');
    expect(r.message).toMatch(/pending delivery request/i);
  });

  test('accepts caller with trimmed/truncated form fields', () => {
    const r = validateRequestDeliveryRole({
      auth: { uid: 'u1', token: {} },
      hasExistingPendingRequest: false,
      name: '  Krishnamurthy Subramanian  ',
      vehicleType: 'bike',
      city: '  Bengaluru  ',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.uid).toBe('u1');
    expect(r.form.name).toBe('Krishnamurthy Subramanian');
    expect(r.form.vehicleType).toBe('bike');
    expect(r.form.city).toBe('Bengaluru');
  });

  test('drops vehicle type not on the whitelist (no error)', () => {
    const r = validateRequestDeliveryRole({
      auth: { uid: 'u1', token: {} },
      hasExistingPendingRequest: false,
      vehicleType: 'helicopter',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.form.vehicleType).toBeUndefined();
  });

  test('omits missing/empty/non-string optional fields', () => {
    const r = validateRequestDeliveryRole({
      auth: { uid: 'u1', token: {} },
      hasExistingPendingRequest: false,
      name: '   ',
      vehicleType: 42 as any,
      city: undefined,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.form.name).toBeUndefined();
    expect(r.form.vehicleType).toBeUndefined();
    expect(r.form.city).toBeUndefined();
  });

  test('truncates oversized strings (defensive against payload spam)', () => {
    const longName = 'A'.repeat(500);
    const r = validateRequestDeliveryRole({
      auth: { uid: 'u1', token: {} },
      hasExistingPendingRequest: false,
      name: longName,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 80 char cap (NAME_MAX in the helper).
    expect(r.form.name?.length).toBe(80);
  });
});

// ────────────────────────────────────────────────────────────
// requireAdminCaller
// ────────────────────────────────────────────────────────────

describe('requireAdminCaller', () => {
  test('admin caller passes through', () => {
    const r = requireAdminCaller({
      auth: { uid: 'admin1', token: { admin: true } },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.adminUid).toBe('admin1');
  });

  test('unauthenticated caller rejected', () => {
    const r = requireAdminCaller({ auth: null });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('unauthenticated');
  });

  test('signed-in non-admin caller rejected (shopOwner is not admin)', () => {
    const r = requireAdminCaller({
      auth: { uid: 'so1', token: { shopOwner: true } },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('permission-denied');
  });

  test('admin claim that is not literal true is rejected', () => {
    const r = requireAdminCaller({
      // truthy but not strict-equal `true` — guards against
      // accidental string "true" tokens slipping through.
      auth: { uid: 'u1', token: { admin: 'true' } },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('permission-denied');
  });
});

// ────────────────────────────────────────────────────────────
// canApproveDeliveryRequest
// ────────────────────────────────────────────────────────────

describe('canApproveDeliveryRequest', () => {
  const adminAuth = { uid: 'admin1', token: { admin: true } } as const;

  test('admin can approve a pending request', () => {
    const r = canApproveDeliveryRequest({
      auth: adminAuth,
      targetUid: 'u1',
      currentRequestStatus: 'pending',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.adminUid).toBe('admin1');
    expect(r.targetUid).toBe('u1');
  });

  test('non-admin caller rejected (delivery role cannot self-approve)', () => {
    const r = canApproveDeliveryRequest({
      auth: { uid: 'u1', token: { delivery: true } },
      targetUid: 'u1',
      currentRequestStatus: 'pending',
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('permission-denied');
  });

  test('missing target uid rejected with invalid-argument', () => {
    const r = canApproveDeliveryRequest({
      auth: adminAuth,
      targetUid: '',
      currentRequestStatus: 'pending',
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('invalid-argument');
  });

  test('missing request doc rejected with not-found', () => {
    const r = canApproveDeliveryRequest({
      auth: adminAuth,
      targetUid: 'u1',
      currentRequestStatus: null,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('not-found');
  });

  test('approved request cannot be approved again (idempotency guard)', () => {
    const r = canApproveDeliveryRequest({
      auth: adminAuth,
      targetUid: 'u1',
      currentRequestStatus: 'approved',
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('failed-precondition');
  });

  test('rejected request cannot be approved without a new submission', () => {
    const r = canApproveDeliveryRequest({
      auth: adminAuth,
      targetUid: 'u1',
      currentRequestStatus: 'rejected',
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('failed-precondition');
  });
});

// ────────────────────────────────────────────────────────────
// canRejectDeliveryRequest
// ────────────────────────────────────────────────────────────

describe('canRejectDeliveryRequest', () => {
  const adminAuth = { uid: 'admin1', token: { admin: true } } as const;

  test('admin can reject a pending request with a reason', () => {
    const r = canRejectDeliveryRequest({
      auth: adminAuth,
      targetUid: 'u1',
      currentRequestStatus: 'pending',
      reason: '  No ID provided  ',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.reason).toBe('No ID provided');
  });

  test('missing reason rejected with invalid-argument', () => {
    const r = canRejectDeliveryRequest({
      auth: adminAuth,
      targetUid: 'u1',
      currentRequestStatus: 'pending',
      reason: '',
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('invalid-argument');
  });

  test('whitespace-only reason rejected', () => {
    const r = canRejectDeliveryRequest({
      auth: adminAuth,
      targetUid: 'u1',
      currentRequestStatus: 'pending',
      reason: '   ',
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('invalid-argument');
  });

  test('reason is truncated at 280 chars (defensive)', () => {
    const r = canRejectDeliveryRequest({
      auth: adminAuth,
      targetUid: 'u1',
      currentRequestStatus: 'pending',
      reason: 'X'.repeat(1000),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.reason.length).toBe(280);
  });

  test('non-admin caller rejected even with a valid reason', () => {
    const r = canRejectDeliveryRequest({
      auth: { uid: 'u1', token: {} },
      targetUid: 'u2',
      currentRequestStatus: 'pending',
      reason: 'I do not approve',
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('permission-denied');
  });

  test('already-approved request cannot be rejected (terminal state)', () => {
    const r = canRejectDeliveryRequest({
      auth: adminAuth,
      targetUid: 'u1',
      currentRequestStatus: 'approved',
      reason: 'change of heart',
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('failed-precondition');
  });
});
