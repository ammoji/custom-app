/**
 * Pure validation + auth helpers for the delivery-approval flow
 * (PR 1 — security hardening, replaces self-service `becomeDelivery`).
 *
 * Mirrors the posture of shopOrdersHelpers.ts and profileHelpers.ts:
 * each helper returns a discriminated `{ ok }` union so the Cloud
 * Function call-site decides which HttpsError code to throw. Keeping
 * these out of firebase-functions land means the suite can run in
 * plain Node without emulator boot.
 *
 * Pinned by tests/functions/deliveryRequestHelpers.test.ts.
 */

// ────────────────────────────────────────────────────────────
// Shared types
// ────────────────────────────────────────────────────────────

// Compatible with firebase-admin's DecodedIdToken — claims carry
// arbitrary keys. The helper looks at `admin` + `delivery` only.
export type DeliveryClaims = {
  admin?: unknown;
  delivery?: unknown;
  [key: string]: unknown;
};

export type ErrorCode =
  | 'unauthenticated'
  | 'permission-denied'
  | 'failed-precondition'
  | 'invalid-argument';

export type DeliveryRequestStatus = 'pending' | 'approved' | 'rejected';

// ────────────────────────────────────────────────────────────
// requestDeliveryRole — submission validation
// ────────────────────────────────────────────────────────────
//
// Submitted by an end-user. Auth required. Caller must NOT already
// hold the `delivery` claim, and must NOT have a pending request on
// file. Sucessful submission writes one doc at deliveryRequests/{uid}.

export type RequestDeliveryRoleInput = {
  auth: { uid: string; token?: DeliveryClaims } | null | undefined;
  // Free-text fields from the form. Length limits enforced here so the
  // Cloud Function never persists oversized strings into Firestore.
  name?: unknown;
  vehicleType?: unknown;
  city?: unknown;
  // Caller-side check: does the user already have a pending request?
  // Injected so the helper stays pure (no Firestore reads inside).
  hasExistingPendingRequest: boolean;
};

export type SanitizedDeliveryRequestForm = {
  name?: string;
  vehicleType?: string;
  city?: string;
};

export type RequestDeliveryRoleResult =
  | { ok: true; uid: string; form: SanitizedDeliveryRequestForm }
  | { ok: false; code: ErrorCode; message: string };

// Soft caps. Long enough for real names ("Krishnamurthy Subramanian"
// is 25 chars), short enough that a malicious client can't spam giant
// strings into the request doc.
const NAME_MAX = 80;
const VEHICLE_MAX = 32;
const CITY_MAX = 60;

const VEHICLE_WHITELIST: ReadonlySet<string> = new Set([
  'bike',
  'scooter',
  'cycle',
  'car',
  'on_foot',
]);

function sanitizeOptionalString(
  v: unknown,
  maxLen: number,
): string | undefined {
  if (typeof v !== 'string') return undefined;
  const trimmed = v.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLen);
}

export function validateRequestDeliveryRole(
  input: RequestDeliveryRoleInput,
): RequestDeliveryRoleResult {
  const { auth } = input;
  if (!auth) {
    return {
      ok: false,
      code: 'unauthenticated',
      message: 'Sign in required',
    };
  }
  const claims = auth.token ?? {};
  if (claims.delivery === true) {
    return {
      ok: false,
      code: 'failed-precondition',
      message: 'You are already a delivery partner.',
    };
  }
  if (input.hasExistingPendingRequest) {
    return {
      ok: false,
      code: 'failed-precondition',
      message:
        'You already have a pending delivery request. Wait for the admin review.',
    };
  }
  // Vehicle type is whitelisted to avoid free-form trash in the
  // admin-facing detail screen (and to keep future-analytics clean).
  // Unknown values become undefined rather than an error — the form
  // is optional, so silently dropping the bad value is friendlier
  // than rejecting the whole submission.
  const vehicleRaw = sanitizeOptionalString(input.vehicleType, VEHICLE_MAX);
  const vehicleType =
    vehicleRaw && VEHICLE_WHITELIST.has(vehicleRaw) ? vehicleRaw : undefined;
  return {
    ok: true,
    uid: auth.uid,
    form: {
      name: sanitizeOptionalString(input.name, NAME_MAX),
      vehicleType,
      city: sanitizeOptionalString(input.city, CITY_MAX),
    },
  };
}

// ────────────────────────────────────────────────────────────
// Admin auth checks (approve / reject / list pending)
// ────────────────────────────────────────────────────────────

export type AdminAuthInput = {
  auth: { uid: string; token?: DeliveryClaims } | null | undefined;
};

export type AdminAuthResult =
  | { ok: true; adminUid: string }
  | { ok: false; code: 'unauthenticated' | 'permission-denied'; message: string };

export function requireAdminCaller(input: AdminAuthInput): AdminAuthResult {
  const { auth } = input;
  if (!auth) {
    return {
      ok: false,
      code: 'unauthenticated',
      message: 'Sign in required',
    };
  }
  if (auth.token?.admin !== true) {
    return {
      ok: false,
      code: 'permission-denied',
      message: 'Admin role required',
    };
  }
  return { ok: true, adminUid: auth.uid };
}

// ────────────────────────────────────────────────────────────
// approveDeliveryRequest / rejectDeliveryRequest — pre-transition
// validation against the current request doc state
// ────────────────────────────────────────────────────────────

export type RequestDocStatus = DeliveryRequestStatus | null;

export type CanApproveDeliveryRequestInput = {
  auth: { uid: string; token?: DeliveryClaims } | null | undefined;
  targetUid: unknown;
  currentRequestStatus: RequestDocStatus;
};

export type CanApproveDeliveryRequestResult =
  | { ok: true; adminUid: string; targetUid: string }
  | { ok: false; code: ErrorCode | 'not-found'; message: string };

export function canApproveDeliveryRequest(
  input: CanApproveDeliveryRequestInput,
): CanApproveDeliveryRequestResult {
  const adminCheck = requireAdminCaller({ auth: input.auth });
  if (!adminCheck.ok) return adminCheck;
  if (typeof input.targetUid !== 'string' || !input.targetUid.trim()) {
    return {
      ok: false,
      code: 'invalid-argument',
      message: 'uid required',
    };
  }
  if (input.currentRequestStatus === null) {
    return {
      ok: false,
      code: 'not-found',
      message: 'Delivery request not found',
    };
  }
  if (input.currentRequestStatus !== 'pending') {
    return {
      ok: false,
      code: 'failed-precondition',
      message: `Request is ${input.currentRequestStatus}, not pending`,
    };
  }
  return { ok: true, adminUid: adminCheck.adminUid, targetUid: input.targetUid };
}

export type CanRejectDeliveryRequestInput = CanApproveDeliveryRequestInput & {
  reason: unknown;
};

export type CanRejectDeliveryRequestResult =
  | { ok: true; adminUid: string; targetUid: string; reason: string }
  | { ok: false; code: ErrorCode | 'not-found'; message: string };

const REASON_MAX = 280;

export function canRejectDeliveryRequest(
  input: CanRejectDeliveryRequestInput,
): CanRejectDeliveryRequestResult {
  const base = canApproveDeliveryRequest(input);
  if (!base.ok) return base;
  if (typeof input.reason !== 'string' || !input.reason.trim()) {
    return {
      ok: false,
      code: 'invalid-argument',
      message: 'reason required',
    };
  }
  return {
    ok: true,
    adminUid: base.adminUid,
    targetUid: base.targetUid,
    reason: input.reason.trim().slice(0, REASON_MAX),
  };
}
