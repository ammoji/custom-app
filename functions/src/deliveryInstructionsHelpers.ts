/**
 * PR 22 — pure helpers for delivery-instructions validation.
 *
 * Used by both `saveAddress` (saved-address book write) and
 * `placeOrder` (per-order override stamped onto deliveryAddress)
 * to normalize the incoming `deliveryInstructions` field on an
 * Address payload.
 *
 * Semantics:
 *   - undefined / null / '' / whitespace-only → undefined (field
 *     omitted from the stored doc; no whitespace artifacts).
 *   - non-string → invalid-argument (caller-side bug; surface loudly).
 *   - over MAX_INSTRUCTIONS_LEN chars → invalid-argument (UI's own
 *     input clamp should prevent this, so a server reject here
 *     means the call bypassed the app — worth failing).
 *   - valid string → trimmed value echoed back.
 *
 * Pure — no Firestore, no React, no clock. Pinned by
 * `tests/functions/deliveryInstructionsHelpers.test.ts`. Same
 * architectural posture as ratingHelpers / substitutionHelpers /
 * favoritesHelpers.
 */

// Twitter-classic 280. Small enough to render in a single card on
// shop / delivery order detail without truncation; large enough for
// the realistic instruction patterns ("Ring second bell, leave at
// door if no answer, dog inside but friendly" comfortably fits).
export const MAX_INSTRUCTIONS_LEN = 280;

export type NormalizeResult =
  | { ok: true; value: string | undefined }
  | { ok: false; code: 'invalid-argument'; message: string };

export function normalizeDeliveryInstructions(
  raw: unknown,
): NormalizeResult {
  if (raw === undefined || raw === null) {
    return { ok: true, value: undefined };
  }
  if (typeof raw !== 'string') {
    return {
      ok: false,
      code: 'invalid-argument',
      message: 'deliveryInstructions must be a string',
    };
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: true, value: undefined };
  }
  if (trimmed.length > MAX_INSTRUCTIONS_LEN) {
    return {
      ok: false,
      code: 'invalid-argument',
      message: `deliveryInstructions too long (max ${MAX_INSTRUCTIONS_LEN} chars)`,
    };
  }
  return { ok: true, value: trimmed };
}
