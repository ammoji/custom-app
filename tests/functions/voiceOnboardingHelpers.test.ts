/**
 * PR 34 — pure tests for voiceOnboardingHelpers.
 *
 * Mirrors the structure of `menuExtractionHelpers.test.ts` (PR 32).
 * Each test pins a behaviour that the screen / callable depends on:
 *   - prompt embedding of the 7 field names
 *   - happy-path JSON parsing
 *   - markdown-fence stripping
 *   - per-field validators (phone +91 / leading-0 stripping, HH:mm,
 *     GSTIN, FSSAI)
 *   - "GST nahi hai" → null mapping (when Claude returns
 *     {"gstNumber": null} the parser MUST NOT invent the literal
 *     string "no")
 *   - top-level error path (un-parseable JSON, non-object response)
 */
import {
  VOICE_ONBOARDING_SYSTEM_PROMPT,
  parseVoiceOnboardingResponse,
} from '../../functions/src/voiceOnboardingHelpers';

describe('PR 34 — voiceOnboardingHelpers', () => {
  test('VOICE_ONBOARDING_SYSTEM_PROMPT names every one of the 7 target fields', () => {
    for (const fieldName of [
      'name',
      'address',
      'phone',
      'openTime',
      'closeTime',
      'gstNumber',
      'fssaiLicense',
    ]) {
      expect(VOICE_ONBOARDING_SYSTEM_PROMPT).toContain(fieldName);
    }
  });

  test('parses a fully populated valid Claude response', () => {
    const text = JSON.stringify({
      name: 'Sharma Kirana Store',
      address: '20 MG Road, Kanpur',
      phone: '9876543210',
      openTime: '07:00',
      closeTime: '22:00',
      gstNumber: '22AAAAA0000A1Z5',
      fssaiLicense: '12345678901234',
    });
    const r = parseVoiceOnboardingResponse(text);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.fields.name).toBe('Sharma Kirana Store');
      expect(r.fields.address).toBe('20 MG Road, Kanpur');
      expect(r.fields.phone).toBe('9876543210');
      expect(r.fields.openTime).toBe('07:00');
      expect(r.fields.closeTime).toBe('22:00');
      expect(r.fields.gstNumber).toBe('22AAAAA0000A1Z5');
      expect(r.fields.fssaiLicense).toBe('12345678901234');
    }
  });

  test('strips ```json markdown fences before parsing', () => {
    const text = '```json\n{ "name": "Sharma Kirana" }\n```';
    const r = parseVoiceOnboardingResponse(text);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.fields.name).toBe('Sharma Kirana');
      // Unmentioned fields must collapse to null, not be missing.
      expect(r.fields.phone).toBeNull();
      expect(r.fields.openTime).toBeNull();
    }
  });

  test('strips +91 country prefix from phone', () => {
    const text = JSON.stringify({ phone: '+919876543210' });
    const r = parseVoiceOnboardingResponse(text);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.fields.phone).toBe('9876543210');
  });

  test('strips leading 0 from phone (11-digit STD format)', () => {
    const text = JSON.stringify({ phone: '09876543210' });
    const r = parseVoiceOnboardingResponse(text);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.fields.phone).toBe('9876543210');
  });

  test('rejects malformed phone (too short / non-numeric / wrong length after strip)', () => {
    for (const bad of ['12345', 'not-a-phone', '12345678901', '']) {
      const r = parseVoiceOnboardingResponse(JSON.stringify({ phone: bad }));
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.fields.phone).toBeNull();
    }
  });

  test('rejects malformed HH:mm strings (returns null, does not throw)', () => {
    for (const bad of ['25:00', '12:99', '7:00', 'noon', '07-00']) {
      const r = parseVoiceOnboardingResponse(
        JSON.stringify({ openTime: bad }),
      );
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.fields.openTime).toBeNull();
    }
    // Boundary check: 00:00 and 23:59 must pass.
    const ok1 = parseVoiceOnboardingResponse(
      JSON.stringify({ openTime: '00:00' }),
    );
    expect(ok1.ok).toBe(true);
    if (ok1.ok) expect(ok1.fields.openTime).toBe('00:00');
    const ok2 = parseVoiceOnboardingResponse(
      JSON.stringify({ closeTime: '23:59' }),
    );
    expect(ok2.ok).toBe(true);
    if (ok2.ok) expect(ok2.fields.closeTime).toBe('23:59');
  });

  test('validates GSTIN against the 15-char regex', () => {
    // Valid sample.
    const okR = parseVoiceOnboardingResponse(
      JSON.stringify({ gstNumber: '22AAAAA0000A1Z5' }),
    );
    expect(okR.ok).toBe(true);
    if (okR.ok) expect(okR.fields.gstNumber).toBe('22AAAAA0000A1Z5');

    // Lowercase input: validator uppercases before regex check.
    const lowR = parseVoiceOnboardingResponse(
      JSON.stringify({ gstNumber: '22aaaaa0000a1z5' }),
    );
    expect(lowR.ok).toBe(true);
    if (lowR.ok) expect(lowR.fields.gstNumber).toBe('22AAAAA0000A1Z5');

    // Bad samples — wrong length / wrong checksum slot / missing Z.
    for (const bad of ['BADGSTIN', '22AAAAA0000A1Z', '22AAAAA0000A1X5', '']) {
      const r = parseVoiceOnboardingResponse(
        JSON.stringify({ gstNumber: bad }),
      );
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.fields.gstNumber).toBeNull();
    }
  });

  test('validates FSSAI against the 14-digit regex', () => {
    const ok = parseVoiceOnboardingResponse(
      JSON.stringify({ fssaiLicense: '12345678901234' }),
    );
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.fields.fssaiLicense).toBe('12345678901234');

    // Strips non-digits before length check (Claude sometimes
    // returns hyphenated or spaced numbers).
    const spaced = parseVoiceOnboardingResponse(
      JSON.stringify({ fssaiLicense: '1234-5678-901234' }),
    );
    expect(spaced.ok).toBe(true);
    if (spaced.ok) expect(spaced.fields.fssaiLicense).toBe('12345678901234');

    for (const bad of ['1234567890123', '123456789012345', 'no fssai', '']) {
      const r = parseVoiceOnboardingResponse(
        JSON.stringify({ fssaiLicense: bad }),
      );
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.fields.fssaiLicense).toBeNull();
    }
  });

  test('"GST nahi hai" / explicit null maps to null (does not invent literal "no")', () => {
    // Claude's prompt-following: when the shopkeeper says "GST
    // nahi hai", Claude is supposed to emit { "gstNumber": null }.
    // The parser must round-trip the JSON null to a JS null,
    // NOT to the string "null" or "no".
    const text = JSON.stringify({
      name: 'Sharma Kirana',
      gstNumber: null,
      fssaiLicense: null,
    });
    const r = parseVoiceOnboardingResponse(text);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.fields.gstNumber).toBeNull();
      expect(r.fields.fssaiLicense).toBeNull();
    }

    // Belt-and-braces: if Claude regresses and returns the literal
    // string "null", the validator still returns null (not the
    // string).
    const literalNull = parseVoiceOnboardingResponse(
      JSON.stringify({ name: 'null' }),
    );
    expect(literalNull.ok).toBe(true);
    if (literalNull.ok) expect(literalNull.fields.name).toBeNull();
  });

  test('returns { ok: false } on un-parseable JSON', () => {
    const r = parseVoiceOnboardingResponse('not json at all');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/JSON parse failed/i);
  });

  test('returns { ok: false } on non-object top-level response', () => {
    // Array at the top level — Claude sometimes wraps the object
    // in `[]` if the system prompt is ambiguous. We need to reject
    // these cleanly so the callable can fall back to transcript-only.
    const arr = parseVoiceOnboardingResponse('[]');
    expect(arr.ok).toBe(false);
    if (!arr.ok) expect(arr.reason).toMatch(/object/i);

    const num = parseVoiceOnboardingResponse('42');
    expect(num.ok).toBe(false);
    if (!num.ok) expect(num.reason).toMatch(/object/i);
  });
});
