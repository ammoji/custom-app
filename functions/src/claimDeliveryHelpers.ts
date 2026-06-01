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
