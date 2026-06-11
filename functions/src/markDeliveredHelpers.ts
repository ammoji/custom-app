/**
 * PR-NEXT-BUNDLE-B §C (Finding #13) — proof-photo gate for
 * `markDelivered`. Extracted as a pure helper so it can be
 * unit-tested without booting firebase-admin, following the same
 * split pattern as `codPaymentHelpers.ts` and
 * `livePartnerEtaHelpers.ts`.
 *
 * Design decision: whitespace-only strings are treated the same as
 * empty / missing (upload can't produce a space-only path; if it
 * somehow exists, the photo is un-viewable). Rule 14 — discriminated-
 * union Result so the callable maps the `not-ok` branch to a
 * specific HttpsError without string-matching.
 *
 * Pinned by `tests/functions/markDeliveredHelpers.test.ts`.
 */

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export type ProofGateResult =
  | { ok: true }
  | { ok: false; code: 'no_proof'; message: string };

// PR-NEXT-BUNDLE-B §C — The Firestore field stamped by
// `recordDeliveryProofUpload` is `deliveryProofStoragePath`, not
// `proofPhotoUrl`. The client `Order` type mirrors this name.
export type ProofOrderLike = {
  deliveryProofStoragePath?: string | null | undefined;
};

// ─────────────────────────────────────────────────────────────────
// validateMarkDeliveredProofGate
// ─────────────────────────────────────────────────────────────────

/**
 * Returns `ok: false` with code `'no_proof'` if the order has no
 * usable delivery proof photo. A proof is considered "present" when
 * `deliveryProofStoragePath` is a non-empty, non-whitespace string.
 *
 * Pre-PR-NEXT-BUNDLE-B orders without the field are treated the
 * same as `null` — partner uploads first, then Delivered enables.
 */
export function validateMarkDeliveredProofGate(
  order: ProofOrderLike,
): ProofGateResult {
  const url = order.deliveryProofStoragePath;
  if (typeof url === 'string' && url.trim().length > 0) {
    return { ok: true };
  }
  return {
    ok: false,
    code: 'no_proof',
    message: 'Upload a delivery proof photo before marking delivered.',
  };
}
