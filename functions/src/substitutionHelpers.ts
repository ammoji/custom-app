/**
 * PR 21 — pure helpers for substitution preference validation.
 *
 * Used by placeOrder to normalize the incoming preference. Old
 * clients won't send the field at all; new clients send one of the
 * three string values. Anything else is rejected.
 *
 * Pure — no Firestore, no React, no clock. Pinned by
 * `tests/functions/substitutionHelpers.test.ts`. Same architectural
 * posture as `ratingHelpers` / `favoritesHelpers` / `auditLogHelpers`.
 */

const VALID_PREFERENCES = ['call_me', 'auto', 'refund'] as const;
type ValidPreference = typeof VALID_PREFERENCES[number];

export type NormalizeResult =
  | { ok: true; value: ValidPreference }
  | { ok: false; code: 'invalid-argument'; message: string };

/**
 * Normalize an incoming substitutionPreference from request data.
 *
 *   - undefined / null  → 'call_me' (safe default; absorbs old
 *                         clients that never send the field).
 *   - non-string        → invalid-argument.
 *   - unknown string    → invalid-argument (strict allowlist; if
 *                         we accepted unknown strings we'd risk
 *                         storing typos that the shop UI can't
 *                         render).
 *   - allowlist string  → echoed back verbatim.
 *
 * Empty string is intentionally NOT coerced to the default — a
 * client sending '' is signalling intent (probably a UI bug) and
 * we should surface it loudly rather than silently swallowing it.
 */
export function normalizeSubstitutionPreference(
  raw: unknown,
): NormalizeResult {
  if (raw === undefined || raw === null) {
    return { ok: true, value: 'call_me' };
  }
  if (typeof raw !== 'string') {
    return {
      ok: false,
      code: 'invalid-argument',
      message: 'substitutionPreference must be a string',
    };
  }
  if (!(VALID_PREFERENCES as readonly string[]).includes(raw)) {
    return {
      ok: false,
      code: 'invalid-argument',
      message: `substitutionPreference must be one of: ${VALID_PREFERENCES.join(', ')}`,
    };
  }
  return { ok: true, value: raw as ValidPreference };
}

export { VALID_PREFERENCES };
