/**
 * PR 34 — pure helpers for voice onboarding.
 *
 * Same shape as PR 32's `menuExtractionHelpers.ts`:
 *   1. System prompt as an exported constant so prompt regressions
 *      are diff-visible in PR review.
 *   2. `parseVoiceOnboardingResponse` validates Claude's JSON
 *      against the 7-field schema, dropping invalid fields to
 *      `null` rather than rejecting the whole response (the user
 *      may have only said 3 of the 7 fields, and we still want
 *      to pre-fill those 3).
 *
 * No SDK calls. No Firestore. No `firebase-admin` /
 * `firebase-functions` imports. The callable
 * (`transcribeShopOnboardingAudio` in `index.ts`) wires these
 * together with auth + STT + Claude.
 */

export const VOICE_ONBOARDING_SYSTEM_PROMPT = `
You are helping a kirana (Indian corner-store) shopkeeper register
their shop on a mobile app. You will receive a transcript of them
speaking in Hindi or English (or a mix). Your job: extract the
following fields from what they said, leaving any field they
didn't mention as null.

OUTPUT FORMAT (strict — no other text, no markdown fences):

{
  "name": <string or null>,
  "address": <string or null>,
  "phone": <10-digit string without country code, or null>,
  "openTime": <"HH:mm" 24-hour, or null>,
  "closeTime": <"HH:mm" 24-hour, or null>,
  "gstNumber": <15-char GSTIN if explicitly stated, else null>,
  "fssaiLicense": <14-digit FSSAI if explicitly stated, else null>
}

RULES:
- If the shopkeeper said something like "GST nahi hai" or "no
  GST", set gstNumber to null (not the literal string "no").
- Same for fssaiLicense.
- Phone: extract only the 10-digit number. Drop +91 or 0 prefix.
- Hours: convert any language to 24-hour HH:mm. "Subah saat
  baje" / "morning 7" → "07:00". "Raat das baje" / "10 PM" →
  "22:00".
- Shop name: preserve the shopkeeper's chosen name as-is, even
  if mixed Hindi-English ("Sharma Kirana Store" is fine).
- Address: capture verbatim. Don't translate landmarks or street
  names.
- Never invent fields the shopkeeper didn't mention. Null is the
  correct answer for unmentioned fields.

Return ONLY the JSON object. No surrounding prose, no \`\`\`json
fences.
`.trim();

export type ParsedShopFieldsRaw = {
  name?: unknown;
  address?: unknown;
  phone?: unknown;
  openTime?: unknown;
  closeTime?: unknown;
  gstNumber?: unknown;
  fssaiLicense?: unknown;
};

export type ParsedShopFields = {
  name: string | null;
  address: string | null;
  phone: string | null;
  openTime: string | null;
  closeTime: string | null;
  gstNumber: string | null;
  fssaiLicense: string | null;
};

export type VoiceParseResult =
  | { ok: true; fields: ParsedShopFields }
  | { ok: false; reason: string };

/**
 * Parse Claude's response text into a validated `ParsedShopFields`.
 *
 * Strategy: drop invalid per-field values to `null` rather than
 * rejecting the whole response. The shopkeeper may have only
 * mentioned 3 of the 7 fields; the other 4 should arrive as
 * null and the form should still pre-fill the 3 it heard.
 *
 * Strict on overall shape: if the JSON is unparseable or the
 * top-level value isn't an object, return `{ ok: false }` so the
 * callable can fall back to "transcript only, no fields".
 *
 * Strips leading/trailing whitespace + accidental ```json fences
 * from Claude's output before parsing — same defence as
 * `parseExtractionResponse`.
 */
export function parseVoiceOnboardingResponse(
  rawText: string,
): VoiceParseResult {
  let json = rawText.trim();
  if (json.startsWith('```')) {
    json = json.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  }
  let parsed: ParsedShopFieldsRaw;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    return {
      ok: false,
      reason: `JSON parse failed: ${(e as Error).message}`,
    };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'Response was not an object' };
  }

  const fields: ParsedShopFields = {
    name: validateString(parsed.name),
    address: validateString(parsed.address),
    phone: validatePhone(parsed.phone),
    openTime: validateHHmm(parsed.openTime),
    closeTime: validateHHmm(parsed.closeTime),
    gstNumber: validateGstin(parsed.gstNumber),
    fssaiLicense: validateFssai(parsed.fssaiLicense),
  };

  return { ok: true, fields };
}

function validateString(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  if (!trimmed) return null;
  // Defend against the model returning the literal string "null"
  // instead of the JSON null sentinel — observed in practice with
  // smaller models when the prompt's null-vs-string distinction
  // gets blurred.
  if (trimmed.toLowerCase() === 'null') return null;
  return trimmed;
}

function validatePhone(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const digits = v.replace(/\D/g, '');
  // Strip 91 country prefix or a leading 0 if present, then
  // require exactly 10 digits. Anything else is rejected — bad
  // numbers are worse than no numbers (the user can dictate per-
  // field if the multi_field path missed it).
  const ten =
    digits.length === 12 && digits.startsWith('91')
      ? digits.slice(2)
      : digits.length === 11 && digits.startsWith('0')
        ? digits.slice(1)
        : digits;
  if (!/^\d{10}$/.test(ten)) return null;
  return ten;
}

function validateHHmm(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  if (!/^\d{2}:\d{2}$/.test(v)) return null;
  const [hh, mm] = v.split(':').map(Number);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return v;
}

function validateGstin(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim().toUpperCase();
  // GSTIN format: 2 digits state + 5 letters PAN block + 4 digits
  // PAN block + 1 letter PAN block + 1 alphanumeric entity-num +
  // 'Z' fixed + 1 alphanumeric checksum. Anchor to start/end.
  if (
    !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[0-9A-Z]{1}Z[0-9A-Z]{1}$/.test(
      trimmed,
    )
  ) {
    return null;
  }
  return trimmed;
}

function validateFssai(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const digits = v.replace(/\D/g, '');
  if (!/^\d{14}$/.test(digits)) return null;
  return digits;
}
