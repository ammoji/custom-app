/**
 * PR-NEXT-13a — pure helpers used by the `claimDelivery` callable's
 * post-transaction denormalization + customer-push block.
 *
 * Same posture as `deliveryProofHelpers` / `codPaymentHelpers`: the
 * callable wrapper stays a thin Firestore + HttpsError shell, and
 * the few bits of pure logic are pinned via unit tests without
 * booting firebase-admin.
 */

/**
 * Pick a clean partner display name from an arbitrary `users/{uid}`
 * field. Returns the trimmed string when present and non-empty,
 * otherwise `null`.
 *
 * Defensive: the `users/{uid}` doc is shaped by client + a few
 * different callables across the codebase; `displayName` could be
 * an empty string, whitespace-only, missing, or a non-string from a
 * historical write. None of those should be denormalized onto an
 * order doc. The callable falls back to a generic copy
 * ("Your delivery partner") when this returns `null`.
 */
export function pickPartnerDisplayName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * PR-NEXT-PARTNER-CARD.2 — extract the partner's trust signals
 * (rating + delivery count + vehicle type) from their `users/{uid}`
 * doc, in a shape ready to denormalize onto the order at
 * `claimDelivery` time.
 *
 * Why denormalize (not look up `users/{deliveryPersonId}` from the
 * customer's PartnerDetailsSheet): the customer's order watcher is
 * a single-doc subscription. Adding a partner-user-doc read on
 * every sheet open would double the read cost AND leak partner
 * fields (currentLocation, fcmTokens) that the sheet doesn't need.
 * The denormalization is a one-time write at claim time. If the
 * partner later renames themselves or completes more deliveries,
 * the order keeps its claim-time snapshot — order docs are
 * historical records (same rationale as `deliveryPersonName` in
 * PR-NEXT-13a).
 *
 * All three fields are nullable so a partial / corrupted partner
 * doc still claims successfully (we just lose the trust line on
 * the sheet, which falls back to the "New partner · welcome them!"
 * copy in `formatPartnerTrust`).
 */
export type PartnerTrustDenorm = {
  rating: number | null;
  deliveriesCount: number | null;
  vehicleType: 'motorbike' | 'bicycle' | 'on_foot' | 'car' | null;
};

const ALLOWED_VEHICLE_TYPES = new Set([
  'motorbike',
  'bicycle',
  'on_foot',
  'car',
]);

export function denormalizePartnerTrust(
  partnerDoc: unknown,
): PartnerTrustDenorm {
  const data = (partnerDoc ?? {}) as {
    deliveryRatingAvg?: unknown;
    deliveryRatingCount?: unknown;
    vehicleType?: unknown;
  };
  const rating =
    typeof data.deliveryRatingAvg === 'number' &&
    Number.isFinite(data.deliveryRatingAvg)
      ? data.deliveryRatingAvg
      : null;
  const deliveriesCount =
    typeof data.deliveryRatingCount === 'number' &&
    Number.isFinite(data.deliveryRatingCount) &&
    data.deliveryRatingCount >= 0
      ? Math.floor(data.deliveryRatingCount)
      : null;
  const vehicleType =
    typeof data.vehicleType === 'string' &&
    ALLOWED_VEHICLE_TYPES.has(data.vehicleType)
      ? (data.vehicleType as PartnerTrustDenorm['vehicleType'])
      : null;
  return { rating, deliveriesCount, vehicleType };
}
