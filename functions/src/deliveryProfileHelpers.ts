/**
 * PR-NEXT-BUNDLE-D §F — pure validation for the delivery partner
 * self-service profile edit (`updateMyDeliveryProfile`).
 *
 * Builds a sanitized `users/{uid}` patch from the request input.
 * Returns a discriminated-union Result (Rule 14): `ok: false` with
 * an `invalid-argument` message, or `ok: true` with the patch (which
 * may be empty — the caller treats an empty patch as a no-op).
 *
 * Pure — no Firestore, no admin SDK. Pinned by
 * `tests/functions/deliveryProfileHelpers.test.ts`.
 */

export type DeliveryProfileInput = {
  displayName?: unknown;
  vehicleType?: unknown;
  profilePhotoUrl?: unknown;
};

export type DeliveryProfileResult =
  | { ok: true; patch: Record<string, unknown> }
  | { ok: false; message: string };

const VALID_VEHICLES = ['motorbike', 'bicycle', 'on_foot', 'car'];
const MAX_NAME_LEN = 60;

export function validateDeliveryProfilePatch(
  input: DeliveryProfileInput,
): DeliveryProfileResult {
  const { displayName, vehicleType, profilePhotoUrl } = input ?? {};

  if (vehicleType !== undefined && !VALID_VEHICLES.includes(vehicleType as string)) {
    return { ok: false, message: 'Invalid vehicleType' };
  }
  if (profilePhotoUrl !== undefined && typeof profilePhotoUrl !== 'string') {
    return { ok: false, message: 'Invalid profilePhotoUrl' };
  }
  if (displayName !== undefined && typeof displayName !== 'string') {
    return { ok: false, message: 'Invalid displayName' };
  }

  const patch: Record<string, unknown> = {};
  if (typeof displayName === 'string') {
    const trimmed = displayName.trim().slice(0, MAX_NAME_LEN);
    if (trimmed.length > 0) patch.displayName = trimmed;
  }
  if (vehicleType !== undefined) patch.vehicleType = vehicleType;
  if (profilePhotoUrl !== undefined) patch.profilePhotoUrl = profilePhotoUrl;

  return { ok: true, patch };
}
