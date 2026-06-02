/**
 * PR-NEXT-SHOP-LOCATION-EDIT — pure helpers for the
 * `submitPendingShopLocation` / `cancelPendingShopLocation` /
 * `approvePendingShopLocation` / `rejectPendingShopLocation`
 * callables.
 *
 * Each helper returns a discriminated-union Result so the
 * callable can map the failure code to a specific HttpsError
 * code/message at the IO boundary. Mirrors the posture
 * `validateShopLocationForApproval` established in
 * `approveShopHelpers.ts`.
 *
 * Pinned by `tests/functions/pendingShopLocationHelpers.test.ts`.
 */
import { validateShopLocationForApproval } from './approveShopHelpers';

export type PendingLocationSource = 'gps' | 'geocoded';

export type ShopForPendingGate = {
  ownerUid?: string | null;
  status?: string;
  location?: { lat?: unknown; lng?: unknown } | null;
  pendingLocation?: { lat?: unknown; lng?: unknown } | null;
  pendingLocationStatus?: 'pending' | null;
};

// ─── submit pending ────────────────────────────────────────────────
export type SubmitPendingValidation =
  | { ok: true }
  | {
      ok: false;
      code:
        | 'shop_not_found'
        | 'not_owner'
        | 'shop_not_active'
        | 'invalid_coords'
        | 'identical_to_current';
      // Carry through the underlying location-validation code when
      // the failure was a coord-shape rejection — useful for the
      // callable's user-facing message + audit-log metadata.
      detail?: string;
    };

export function validateSubmitPendingShopLocation(args: {
  shop: ShopForPendingGate | null | undefined;
  callerUid: string;
  newLocation: { lat: unknown; lng: unknown };
}): SubmitPendingValidation {
  const { shop, callerUid, newLocation } = args;
  if (!shop) return { ok: false, code: 'shop_not_found' };
  if (!shop.ownerUid || shop.ownerUid !== callerUid) {
    return { ok: false, code: 'not_owner' };
  }
  // Edits only make sense on an `active` shop. A `pending` shop is
  // still in the initial-approval queue — the owner should resubmit
  // through `registerShop` (or in the rejected case re-register).
  // `suspended` shops shouldn't be silently editable either.
  if (shop.status !== 'active') {
    return { ok: false, code: 'shop_not_active' };
  }
  // Reuse the SHOP-LOCATION-REQUIRED earth-coordinate gate so the
  // pending pin has the same strictness as the initial-approval pin.
  // Wrap the unknown lat/lng in a shape the helper accepts.
  const v = validateShopLocationForApproval({
    location: { lat: newLocation.lat, lng: newLocation.lng },
  });
  if (!v.ok) {
    return { ok: false, code: 'invalid_coords', detail: v.code };
  }
  // Reject if the proposed pin is byte-identical to the current pin.
  // Nothing to approve, no point creating a queue entry. Float-equal
  // is fine here — the client either re-uses the exact stored value
  // (no edit) or produces a fresh GPS reading (always at least sub-
  // meter different in the last few decimal places).
  const cur = shop.location;
  if (
    cur &&
    typeof cur.lat === 'number' &&
    typeof cur.lng === 'number' &&
    cur.lat === newLocation.lat &&
    cur.lng === newLocation.lng
  ) {
    return { ok: false, code: 'identical_to_current' };
  }
  return { ok: true };
}

// ─── cancel pending ────────────────────────────────────────────────
export type CancelPendingValidation =
  | { ok: true }
  | {
      ok: false;
      code: 'shop_not_found' | 'not_owner' | 'no_pending_change';
    };

export function validateCancelPendingShopLocation(args: {
  shop: ShopForPendingGate | null | undefined;
  callerUid: string;
}): CancelPendingValidation {
  const { shop, callerUid } = args;
  if (!shop) return { ok: false, code: 'shop_not_found' };
  if (!shop.ownerUid || shop.ownerUid !== callerUid) {
    return { ok: false, code: 'not_owner' };
  }
  if (shop.pendingLocationStatus !== 'pending') {
    return { ok: false, code: 'no_pending_change' };
  }
  return { ok: true };
}

// ─── approve pending (admin) ───────────────────────────────────────
export type ApprovePendingValidation =
  | {
      ok: true;
      newLocation: { lat: number; lng: number };
    }
  | {
      ok: false;
      code:
        | 'shop_not_found'
        | 'no_pending_change'
        | 'pending_invalid_coords';
      detail?: string;
    };

export function validateApprovePendingShopLocation(args: {
  shop: ShopForPendingGate | null | undefined;
}): ApprovePendingValidation {
  const { shop } = args;
  if (!shop) return { ok: false, code: 'shop_not_found' };
  if (shop.pendingLocationStatus !== 'pending') {
    return { ok: false, code: 'no_pending_change' };
  }
  // Re-validate the pending pin before promoting it. Defends against
  // a pending doc that was somehow stamped with bad coords (admin
  // hand-edit, future schema drift, etc.) — same earth-coordinate
  // gate the initial-approval flow uses.
  const v = validateShopLocationForApproval({
    location: shop.pendingLocation ?? null,
  });
  if (!v.ok) {
    return { ok: false, code: 'pending_invalid_coords', detail: v.code };
  }
  // Helper passed → narrow the unknown-shaped `pendingLocation` to
  // the `{ lat: number; lng: number }` the caller can write back to
  // `shop.location`. The `validateShopLocationForApproval` happy
  // path already guarantees both fields are finite numbers.
  const pending = shop.pendingLocation as { lat: number; lng: number };
  return {
    ok: true,
    newLocation: { lat: pending.lat, lng: pending.lng },
  };
}

// ─── reject pending (admin) ────────────────────────────────────────
export type RejectPendingValidation =
  | { ok: true }
  | { ok: false; code: 'shop_not_found' | 'no_pending_change' };

export function validateRejectPendingShopLocation(args: {
  shop: ShopForPendingGate | null | undefined;
}): RejectPendingValidation {
  const { shop } = args;
  if (!shop) return { ok: false, code: 'shop_not_found' };
  if (shop.pendingLocationStatus !== 'pending') {
    return { ok: false, code: 'no_pending_change' };
  }
  return { ok: true };
}
