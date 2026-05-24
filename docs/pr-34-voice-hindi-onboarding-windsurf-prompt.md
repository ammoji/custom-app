# PR 34 — Voice + Hindi onboarding assist (Windsurf prompt)

## Why this PR exists

PR 32 collapsed menu entry from 4 hours to 15 minutes for an
**English-fluent, smartphone-fluent** shopkeeper. The remaining
gap — the one that defines whether Kirana Mart works in tier-2/3
India — is the shopkeeper who can read enough to navigate the
app but cannot fluently *type* Hindi or English text. They hit
the wall at the registration form's name / address / hours
fields and never finish.

**The fix: voice in, structured fields out.**

Two access patterns ship in PR 34:

1. **Big "🎙 Speak about your shop" button at the top of
   registration.** Shopkeeper holds the button and speaks a
   paragraph in Hindi or English: "मेरी दुकान का नाम शर्मा
   किराना है, बीस MG रोड पर है, सुबह सात बजे से रात दस बजे तक
   खुलती है, GST नहीं है।" → 25 seconds of audio → Google STT
   transcribes → Claude Haiku parses → all 7 form fields
   pre-fill with what was heard. Shopkeeper reviews the fields
   (each AI-filled field is marked with ✨), edits any that are
   wrong, taps Continue.
2. **Per-field mic icons** next to each text input. Tap mic →
   speak just that field ("शर्मा किराना मार्ट" → name field
   filled). No AI parsing — just transcription. For
   shopkeepers who prefer field-by-field control.

Together, these honor **Trust Principles 2 and 4** at the same
time: AI output gets human review before commit (the ✨ markers
+ review banner), and errors are returned in the user's
language (Hindi error messages when `hi-IN` is selected).

**Mission North Star check:** time-to-first-listed-menu-item
for a non-English-fluent shopkeeper goes from "impossible / has
to find a literate helper" to "tap mic, speak, review, done"
— sub-30-minute end-to-end with field-rep assist, sub-90-minute
self-serve. Phase A2 accessibility gap closed.

**What ships:**

- Server: new `transcribeShopOnboardingAudio` callable (does
  STT + optional Claude parse) and a small extension to
  `aiHelpers.ts` (a text-only `runClaude` method that the parser
  uses; mirrors `runClaudeVision`).
- New helper: `functions/src/voiceOnboardingHelpers.ts` (pure
  prompt + parser + validator — same pattern as PR 32's
  `menuExtractionHelpers.ts`).
- New dep: `@google-cloud/speech` in `functions/`.
- One new manual GCP step: enable the Cloud Speech-to-Text API
  (same kind of one-time setup as PR 31's IAM grant).
- Client: new `expo-audio` dep, new reusable `VoiceInputButton`
  component (one mic icon → record → upload → callback), and
  extensions to `RegisterShopScreen` (language picker, big
  voice CTA, per-field mic icons, AI-filled markers + review
  banner).
- Cost guardrails: per-shop 10 transcriptions/day quota,
  kill-switch (`aiFeatures/voiceOnboarding.enabled`), audit log
  per call.

~4–5 hours Windsurf work. Server-first deploy. One new secret
*type* needed (none — STT uses the compute SA's default
permissions). One new GCP API to enable.

## Read first

- `.windsurf/code-discipline.md`, `.windsurf/test-discipline.md`,
  `.windsurf/deploy-discipline.md` (Signed-URL IAM section
  applies if STT permissions surface as `INTERNAL` —
  same diagnostic pattern).
- `docs/ROADMAP.md` — **Mission North Star + Trust Principles**
  sections at the top. PR 34 is held against both. Specifically:
  - Trust Principle 2: every AI output gets human review
    before commit — the ✨ markers + the review banner aren't
    decorative; they are the principle in action.
  - Trust Principle 4: errors in plain Hindi-friendly
    language. When the user has picked Hindi as their UI
    language, error messages render in Hindi.
- `docs/ROADMAP.md` Section 3.8 — voice-Hindi UX intent.
- `functions/src/aiHelpers.ts` (PR 32) — the substrate this
  PR extends. `runClaudeVision` is there; PR 34 adds a
  sibling `runClaude(systemPrompt, userText, maxTokens?)` for
  text-only calls. Same secret binding (`ANTHROPIC_API_KEY`),
  same model defaults, same cost estimate.
- `functions/src/menuExtractionHelpers.ts` (PR 32) — the
  template for the new `voiceOnboardingHelpers.ts`. Same
  shape: pure function for system prompt, pure function for
  parse-and-validate.
- `functions/src/index.ts` — PR 32's `extractMenuFromImage`
  callable (~line 5421) is the template for PR 34's
  `transcribeShopOnboardingAudio`. Same auth + quota +
  kill-switch + audit-log pattern.
- `src/screens/roles/RegisterShopScreen.tsx` — the screen this
  PR extends. Lines 76–90 are the state declarations for the
  7 fields the voice flow fills. Lines 99–104 are the PR 31
  wizard state. Add the new voice state above those, above the
  `isAnonymous` early return.
- `src/services/analytics.ts` — extends to record voice events
  per Strategic Principle 8.
- `package.json` — `expo-audio` is NOT yet a dep. `npx expo
  install expo-audio` adds it. **Do NOT add `expo-av`** —
  it's deprecated in SDK 54. `expo-audio` is the new
  audio-only module.
- `functions/package.json` — `@google-cloud/speech` is NOT yet
  a dep. `npm i @google-cloud/speech --prefix functions` adds it.

## Critical lessons from PRs 6.1, 24–32 (do not repeat)

1. **API key NEVER leaks.** `ANTHROPIC_API_KEY` is already a
   secret (PR 32). GCS STT does NOT need an API key — it uses
   the function's runtime service account (Application
   Default Credentials), so no new secret. The only thing to
   set up is enabling the API in the GCP console.
2. **Cost guardrails on every AI call.** Same template as
   PR 32: auth + role check + kill-switch + per-shop daily
   quota (10/day for transcribe, more lenient than 5/day for
   image extract since each call is shorter + cheaper) +
   audit log entry per call. The quota counter at
   `aiQuotas/{uid}_{YYYY-MM-DD}.voiceOnboarding`.
3. **Server-first deploy.** New callable. Deploy server
   first, then OTA. Per deploy-discipline Rule 1: one
   `--only` target per command.
4. **Never strip imports between edits.** Files touched:
   `aiHelpers.ts` (one new method added), `voiceOnboardingHelpers.ts`
   (new), `index.ts` (one new callable + import), `package.json`
   (functions/) (add @google-cloud/speech), `analytics.ts`
   (3 new events), `orderService.ts` (one new wrapper),
   `RegisterShopScreen.tsx` (significant additive change),
   `VoiceInputButton.tsx` (new), `package.json` (root —
   add expo-audio).
5. **All `useState` calls in screens sit ABOVE conditional
   early returns.** RegisterShopScreen already enforces this
   per PR 12 lineage. The new voice state declarations stack
   on top of the existing 12+ state hooks. Verify hooks
   order after edits.
6. **Schema-additive only.** New collection: `aiQuotas/`
   already exists (PR 32); just write a new field
   (`voiceOnboarding` counter) alongside the existing
   `menuExtraction` field. `aiFeatures/voiceOnboarding`
   is a new doc but a new doc, not a schema change.
7. **One `DO NOT REMOVE` marker expected** on the
   `@google-cloud/speech` import in the callable. Mark it
   with the same convention as PR 32's `@anthropic-ai/sdk`
   marker.
8. **The first call may fail with permission-denied on
   `speech.googleapis.com`.** Same pattern as the PR 31
   signBlob IAM gotcha. If `transcribeShopOnboardingAudio`
   returns `INTERNAL` and the server log shows
   `PermissionDenied: 7 PERMISSION_DENIED: Cloud Speech-to-Text
   API has not been used in project ... before or it is
   disabled`, the fix is: enable the API in the GCP console.
   This is the documented manual step in the deploy plan.

## Scope (in)

### Part 1 — Extend `aiHelpers.ts` with a text-only Claude method

In `functions/src/aiHelpers.ts`, add a sibling to
`runClaudeVision`:

```ts
export type ClaudeTextInput = {
  systemPrompt: string;
  userText: string;
  maxTokens?: number;
  model?: string;
};

const DEFAULT_TEXT_MODEL = 'claude-haiku-4-5'; // cheap + fast for text-only

/**
 * Text-only Claude call. For tasks that don't need vision —
 * parsing transcripts, summarizing reviews, etc.
 *
 * Returns the raw text + usage info (same shape as
 * runClaudeVision so callers can pass the result straight to
 * estimateCostInr).
 */
export async function runClaude(
  input: ClaudeTextInput,
): Promise<ClaudeVisionResult> {
  const client = getClient();
  const model = input.model ?? DEFAULT_TEXT_MODEL;
  const maxTokens = input.maxTokens ?? 1000;

  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system: input.systemPrompt,
    messages: [{ role: 'user', content: [{ type: 'text', text: input.userText }] }],
  });

  let text = '';
  for (const block of response.content) {
    if (block.type === 'text') text += block.text;
  }

  return {
    text,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    model,
  };
}
```

**Important: update `estimateCostInr` to handle Haiku pricing.**
Currently it's pegged to Sonnet ($3/M input + $15/M output).
Make it accept an optional `model` parameter and route to the
right per-million rates:

- Sonnet 4.6: $3/M in, $15/M out
- Haiku 4.5: $1/M in, $5/M out (approximate; check current
  Anthropic pricing when implementing)

Without this, audit logs will overstate PR 34's cost ~3x.

### Part 2 — Pure helpers in `functions/src/voiceOnboardingHelpers.ts`

```ts
/**
 * PR 34 — pure helpers for voice onboarding. No SDK calls, no
 * Firestore. Tested in isolation; the callable wires them
 * together.
 *
 * Two responsibilities:
 *   1. System prompt construction for Claude (given the field
 *      schema, build a prompt that asks for typed JSON output).
 *   2. Parsing and validating Claude's response against the
 *      onboarding field schema.
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
- Shop name: preserve the shopkeeper's chosen name as-is,
  even if mixed Hindi-English ("Sharma Kirana Mart" is fine).
- Address: capture verbatim. Don't translate landmarks or
  street names.
- Never invent fields the shopkeeper didn't mention. Null is
  the correct answer for unmentioned fields.

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

export function parseVoiceOnboardingResponse(rawText: string): VoiceParseResult {
  let json = rawText.trim();
  if (json.startsWith('```')) {
    json = json.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  }
  let parsed: ParsedShopFieldsRaw;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    return { ok: false, reason: `JSON parse failed: ${(e as Error).message}` };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, reason: 'Response was not an object' };
  }

  // Validate each field; drop anything that doesn't match its shape.
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
  if (!trimmed || trimmed.toLowerCase() === 'null') return null;
  return trimmed;
}

function validatePhone(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const digits = v.replace(/\D/g, '');
  // Strip 91 prefix or leading 0 if present.
  const ten = digits.length === 12 && digits.startsWith('91')
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
  const trimmed = v.trim();
  // GSTIN format: 2 digits + 5 alphanumeric + 4 digits + 1 alphanumeric + Z + 1 alphanumeric
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[0-9A-Z]{1}Z[0-9A-Z]{1}$/.test(trimmed)) {
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
```

### Part 3 — Callable `transcribeShopOnboardingAudio`

In `functions/src/index.ts`, near the PR 32 callables:

```ts
import { SpeechClient } from '@google-cloud/speech'; // PR 34 — DO NOT REMOVE
import {
  runClaude,
  estimateCostInr,
  ANTHROPIC_API_KEY,
} from './aiHelpers';
import {
  VOICE_ONBOARDING_SYSTEM_PROMPT,
  parseVoiceOnboardingResponse,
} from './voiceOnboardingHelpers';

// PR 34 — Lazy-init STT client; created once per warm instance.
let speechClient: SpeechClient | null = null;
function getSpeechClient(): SpeechClient {
  if (!speechClient) speechClient = new SpeechClient();
  return speechClient;
}

const VOICE_ONBOARDING_DAILY_QUOTA = 10;
const MAX_AUDIO_BYTES = 2_000_000; // ~2 MB base64

export const transcribeShopOnboardingAudio = onCall<{
  audioBase64: string;
  encoding: 'WEBM_OPUS' | 'LINEAR16' | 'FLAC';
  sampleRateHertz?: number;
  languageCode: 'hi-IN' | 'en-IN';
  mode: 'single_field' | 'multi_field';
}>(
  {
    cors: true,
    enforceAppCheck: false,
    secrets: [ANTHROPIC_API_KEY],
    timeoutSeconds: 60,
    memory: '512MiB',
  },
  async request => {
    const auth = request.auth;
    if (!auth) throw new HttpsError('unauthenticated', 'Sign in required');
    // No shopOwner gate here — voice onboarding runs BEFORE the
    // shop is registered. Any authenticated user can call this.

    // Kill switch.
    const killSwitchSnap = await db.doc('aiFeatures/voiceOnboarding').get();
    const enabled = killSwitchSnap.exists ? killSwitchSnap.data()?.enabled !== false : true;
    if (!enabled) {
      throw new HttpsError(
        'failed-precondition',
        'Voice onboarding is temporarily disabled. Please type your shop details instead.',
      );
    }

    const { audioBase64, encoding, sampleRateHertz, languageCode, mode } =
      request.data ?? ({} as any);

    if (typeof audioBase64 !== 'string' || !audioBase64) {
      throw new HttpsError('invalid-argument', 'audioBase64 required');
    }
    if (audioBase64.length > MAX_AUDIO_BYTES) {
      throw new HttpsError(
        'invalid-argument',
        'Audio file too large. Please record a shorter clip (under 30 seconds).',
      );
    }
    if (!['WEBM_OPUS', 'LINEAR16', 'FLAC'].includes(encoding)) {
      throw new HttpsError('invalid-argument', 'Unsupported audio encoding');
    }
    if (!['hi-IN', 'en-IN'].includes(languageCode)) {
      throw new HttpsError('invalid-argument', 'Unsupported language');
    }
    if (!['single_field', 'multi_field'].includes(mode)) {
      throw new HttpsError('invalid-argument', 'Mode must be single_field or multi_field');
    }

    // Per-uid daily quota.
    const today = new Date().toISOString().slice(0, 10);
    const quotaRef = db.doc(`aiQuotas/${auth.uid}_${today}`);
    const usedToday = await db.runTransaction(async tx => {
      const snap = await tx.get(quotaRef);
      const current = (snap.data()?.voiceOnboarding as number | undefined) ?? 0;
      if (current >= VOICE_ONBOARDING_DAILY_QUOTA) return -1;
      tx.set(
        quotaRef,
        {
          voiceOnboarding: current + 1,
          updatedAt: FieldValue.serverTimestamp(),
          uid: auth.uid,
        },
        { merge: true },
      );
      return current + 1;
    });
    if (usedToday < 0) {
      throw new HttpsError(
        'resource-exhausted',
        languageCode === 'hi-IN'
          ? 'आज की 10 कोशिशें खत्म हो गईं। कल फिर कोशिश करें।'
          : `Daily limit reached (${VOICE_ONBOARDING_DAILY_QUOTA} attempts). Try again tomorrow.`,
      );
    }

    // Run STT.
    let transcript: string;
    let sttBillableSeconds = 0;
    try {
      const stt = getSpeechClient();
      const [response] = await stt.recognize({
        audio: { content: audioBase64 },
        config: {
          encoding,
          sampleRateHertz: sampleRateHertz ?? 16000,
          languageCode,
          enableAutomaticPunctuation: true,
          model: 'latest_short',
        },
      });
      transcript = (response.results ?? [])
        .map(r => r.alternatives?.[0]?.transcript ?? '')
        .filter(Boolean)
        .join(' ')
        .trim();
      // Approximate billable seconds: count vowel-syllable density;
      // safer is to use audioBase64 length as a proxy. ~16 kB / sec
      // for OPUS 16 kHz.
      sttBillableSeconds = Math.ceil(audioBase64.length / 16_000);
    } catch (e: any) {
      console.error('[transcribeShopOnboardingAudio] STT failed:', e?.message ?? e);
      throw new HttpsError(
        'internal',
        languageCode === 'hi-IN'
          ? 'आपकी आवाज़ साफ़ नहीं आई। फिर से कोशिश करें।'
          : 'Could not understand the audio. Please try again with less background noise.',
      );
    }
    if (!transcript) {
      throw new HttpsError(
        'internal',
        languageCode === 'hi-IN'
          ? 'कुछ भी सुनाई नहीं दिया। माइक के पास बोलें।'
          : 'No speech detected. Please speak closer to the microphone.',
      );
    }

    // For single-field mode, we're done — return the transcript.
    if (mode === 'single_field') {
      const sttCostInr = Math.round(sttBillableSeconds * 0.033 * 100) / 100; // ~₹2/min
      db.collection('aiAuditLog').add({
        uid: auth.uid,
        feature: 'voiceOnboarding',
        subFeature: 'single_field',
        languageCode,
        sttBillableSeconds,
        costInr: sttCostInr,
        timestamp: FieldValue.serverTimestamp(),
      }).catch(e => console.warn('[transcribeShopOnboardingAudio] audit log failed:', e));

      return {
        ok: true,
        transcript,
        fields: null,
        usedTodayCount: usedToday,
        dailyQuota: VOICE_ONBOARDING_DAILY_QUOTA,
      };
    }

    // Multi-field mode — run Claude to parse transcript → fields.
    let claudeResult;
    try {
      claudeResult = await runClaude({
        systemPrompt: VOICE_ONBOARDING_SYSTEM_PROMPT,
        userText: transcript,
        maxTokens: 500,
      });
    } catch (e: any) {
      console.error('[transcribeShopOnboardingAudio] Claude parse failed:', e?.message ?? e);
      // Don't fail the whole call — return transcript so the user
      // can copy-paste into fields manually.
      return {
        ok: true,
        transcript,
        fields: null,
        parseError: 'Could not parse fields from transcript. The text is above; please tap each field to dictate individually.',
        usedTodayCount: usedToday,
        dailyQuota: VOICE_ONBOARDING_DAILY_QUOTA,
      };
    }

    const parsed = parseVoiceOnboardingResponse(claudeResult.text);
    const fields = parsed.ok ? parsed.fields : null;

    // Audit log (non-fatal).
    const sttCostInr = Math.round(sttBillableSeconds * 0.033 * 100) / 100;
    const llmCostInr = estimateCostInr(
      claudeResult.inputTokens,
      claudeResult.outputTokens,
      claudeResult.model,
    );
    db.collection('aiAuditLog').add({
      uid: auth.uid,
      feature: 'voiceOnboarding',
      subFeature: 'multi_field',
      languageCode,
      sttBillableSeconds,
      sttCostInr,
      llmModel: claudeResult.model,
      llmInputTokens: claudeResult.inputTokens,
      llmOutputTokens: claudeResult.outputTokens,
      llmCostInr,
      costInr: Math.round((sttCostInr + llmCostInr) * 100) / 100,
      timestamp: FieldValue.serverTimestamp(),
    }).catch(e => console.warn('[transcribeShopOnboardingAudio] audit log failed:', e));

    return {
      ok: true,
      transcript,
      fields,
      usedTodayCount: usedToday,
      dailyQuota: VOICE_ONBOARDING_DAILY_QUOTA,
    };
  },
);
```

### Part 4 — Client wrapper in `orderService.ts`

```ts
async transcribeShopOnboardingAudio(args: {
  audioBase64: string;
  encoding: 'WEBM_OPUS' | 'LINEAR16' | 'FLAC';
  sampleRateHertz?: number;
  languageCode: 'hi-IN' | 'en-IN';
  mode: 'single_field' | 'multi_field';
}): Promise<{
  ok: true;
  transcript: string;
  fields: ParsedShopFields | null;
  parseError?: string;
  usedTodayCount: number;
  dailyQuota: number;
}> { /* same web/native dispatch as PR 32's wrappers */ },
```

Plus add `ParsedShopFields` to `src/types/index.ts`.

### Part 5 — `VoiceInputButton` reusable component

`src/components/VoiceInputButton.tsx` — a self-contained recording
control. Single mic icon, holds-to-record (default 30s cap),
visual feedback (pulsing red + timer), upload-on-release.
Receives:

```ts
type Props = {
  languageCode: 'hi-IN' | 'en-IN';
  mode: 'single_field' | 'multi_field';
  onResult: (result: {
    transcript: string;
    fields?: ParsedShopFields | null;
  }) => void;
  onError?: (message: string) => void;
  disabled?: boolean;
  size?: 'sm' | 'lg'; // sm for per-field, lg for "Speak about your shop"
};
```

Internally:
- Uses `expo-audio` (`new AudioModule.Recording()` or the SDK 54+
  `Audio.Recording` shape — Windsurf picks based on the current
  expo-audio API surface).
- On press: request mic permission (if not granted), start
  recording, show timer + animated red dot.
- On release (or 30s timeout): stop, get the audio file URI.
- Read file as base64, build the callable payload with the right
  encoding (`WEBM_OPUS` on Android by default; `LINEAR16` on iOS
  in a WAV container — let Windsurf choose what `expo-audio`
  produces natively without extra conversion).
- Call `orderService.transcribeShopOnboardingAudio`.
- Call `onResult` with the parsed shape; or `onError` with the
  friendly message.

Wrap the call site in `usePressGuard` (PR 27) — defends against
re-tap while a transcription is in flight.

### Part 6 — Wire into `RegisterShopScreen`

Step 1 of the wizard (basic info) gets four additions:

1. **Language picker at the top.** Two pill buttons: "हिंदी" /
   "English". Default to Hindi (the audience that benefits most).
   Stores `uiLanguage: 'hi-IN' | 'en-IN'` in state.
2. **Big "🎙 Speak about your shop" button** above the form
   fields. Single-line description below in the selected
   language: "अपनी दुकान के बारे में बोलें — नाम, पता, खुलने का
   समय" / "Tell us about your shop — name, address, opening
   hours."
3. **Per-field mic icons** — small mic icon to the right of each
   text input. Tap → opens a small modal with the
   `VoiceInputButton` in `single_field` mode + a confirm step
   ("क्या यह सही है: 'शर्मा किराना मार्ट'? ✓ हाँ / ✗ फिर से बोलें").
4. **AI-filled markers** — when the big "Speak" flow returns
   fields, the populated fields get a subtle yellow left-border
   + a "✨ AI" chip next to the field label. The chip stays
   until the user edits that field, at which point it
   disappears (signaling the user has reviewed + adjusted).
5. **Review banner** — after the big "Speak" flow returns, a
   yellow banner above the form: "मैंने सुना: '[transcript here]'
   — जो भी गलत हो उसे ठीक करें" / "I heard: '[transcript here]'
   — please correct anything wrong before continuing."

Both the language picker and the AI-filled markers are
required for Trust Principle 2 (human review before commit).
Don't ship a "voice fills the form and continues automatically"
version even if it would feel slicker — it would violate the
principle.

### Part 7 — Strategic Principle 8 — Analytics events

Add to `src/services/analytics.ts`:

```ts
voice_onboarding_started: (params: {
  language: 'hi-IN' | 'en-IN';
  mode: 'single_field' | 'multi_field';
}) => track('voice_onboarding_started', params),

voice_onboarding_filled: (params: {
  language: 'hi-IN' | 'en-IN';
  mode: 'single_field' | 'multi_field';
  // For multi_field: how many fields actually filled.
  fields_filled: number;
  transcript_length: number;
}) => track('voice_onboarding_filled', params),

voice_onboarding_error: (params: {
  language: 'hi-IN' | 'en-IN';
  mode: 'single_field' | 'multi_field';
  error_code: string;
}) => track('voice_onboarding_error', params),
```

Wire all three at the appropriate funnel points.

### Part 8 — Tests

Create `tests/functions/voiceOnboardingHelpers.test.ts`. Mirror
the structure of `menuExtractionHelpers.test.ts` (PR 32's
9-test pattern). Cover at minimum:

- System prompt contains all 7 field names
- Parses valid JSON response
- Strips markdown fences before parsing
- Drops invalid phone formats (returns null, doesn't throw)
- Drops invalid HH:mm formats
- Validates GSTIN against the 15-char regex
- Validates FSSAI against the 14-digit regex
- "no GST" / "GST nahi hai" type responses correctly map to null
  (this is tested through `parseVoiceOnboardingResponse` with a
  pre-constructed Claude response that says `"gstNumber": null`)
- Handles +91 prefix stripping on phone
- Handles leading-0 stripping on phone
- Returns `{ ok: false }` on un-parseable JSON

10–12 tests. Each pinned by a deliberate-break run.

### Part 9 — PRELAUNCH_CHECKLIST update

Append a PR 34 section:

- New callable `transcribeShopOnboardingAudio` (one of two
  modes: single_field for per-field mic, multi_field for the
  big "speak about your shop" button).
- New deps: `@google-cloud/speech` (functions), `expo-audio`
  (client).
- Cost guardrails: 10 transcriptions/day per uid (more
  permissive than PR 32's 5/day since each transcribe is
  shorter + cheaper).
- Cost per call: ~₹0.5–₹2 (STT ~₹0.5 for a 15-second clip +
  Claude Haiku parse ~₹0.05).
- One-time GCP setup: enable Cloud Speech-to-Text API.

Follow-ups to log:

- More languages: Punjabi (`pa-IN`), Tamil (`ta-IN`), Telugu
  (`te-IN`), Bengali (`bn-IN`). Add as demand surfaces.
- Voice for customer side (search by voice, dictate delivery
  address). Future PR — needs separate UX work.
- Offline / on-device STT fallback. When network is patchy,
  drop to a smaller on-device model. Not in MVP.
- "Speech-to-fields" pattern reusable on the menu add screen
  (dictate a single menu item: "Aashirvaad atta 5 kilo, MRP
  305 rupaye, sell 295 rupaye").
- Per-language UI translation (`i18n` system). PR 34's UI
  strings are currently hand-translated in 2 places; a real
  i18n setup is a future workstream.

## Scope (out)

- **More than 2 languages in MVP.** Hindi + English covers the
  largest portion of the target. Add Punjabi / Tamil / Telugu /
  Bengali as soon as a pilot shop in one of those regions
  requests it.
- **Long-form speech (>30s).** Cap at 30 seconds per recording.
  Longer audio needs the `latest_long` STT model + different
  payload handling — defer.
- **Streaming transcription.** GCS supports it but we're using
  the simple `recognize` (batch) flow for v1. Streaming would
  give live transcripts as the user speaks but is significant
  extra plumbing.
- **Voice on every screen.** PR 34 ships voice on
  `RegisterShopScreen` only. Menu screens, customer screens,
  etc. get a separate workstream.
- **Voice command interface** ("delete that item", "add 5
  packets"). That's a different product surface; out of scope.
- **PDF / handwriting OCR.** PR 32's territory, not PR 34.
- **Custom acoustic model training.** Google's `latest_short`
  on `hi-IN` is the right default; don't fine-tune in MVP.
- **Voice biometric / speaker verification.** Out of scope;
  not relevant to onboarding.

## Acceptance checklist

- [ ] `functions/package.json` — `@google-cloud/speech` added
  as a dep. `functions/package-lock.json` regenerated.
- [ ] `functions/src/aiHelpers.ts` — new `runClaude` text-only
  method + `estimateCostInr` updated to handle Haiku pricing.
  `DO NOT REMOVE` marker on the `@anthropic-ai/sdk` import
  still in place (was added by PR 32).
- [ ] `functions/src/voiceOnboardingHelpers.ts` — pure
  functions for prompt + parse + validate.
- [ ] `transcribeShopOnboardingAudio` callable in `index.ts`
  — auth + kill-switch + 10/day quota + STT + optional Claude
  parse + audit log. `secrets: [ANTHROPIC_API_KEY]`.
  `timeoutSeconds: 60`, `memory: '512MiB'`.
- [ ] `aiFeatures/voiceOnboarding` Firestore doc created
  manually with `{enabled: true}` (or via a small admin
  callable; either acceptable).
- [ ] `package.json` (root) — `expo-audio` added.
- [ ] `src/components/VoiceInputButton.tsx` — reusable mic
  button with recording UI, `usePressGuard` on the
  upload-and-callable call, language-aware error messages.
- [ ] `src/services/orderService.ts` — new wrapper for
  `transcribeShopOnboardingAudio` (web + native dispatch).
- [ ] `src/types/index.ts` — `ParsedShopFields` type added.
- [ ] `src/screens/roles/RegisterShopScreen.tsx`:
  - Language picker (Hindi default).
  - Big "🎙 Speak about your shop" button above the fields.
  - Per-field mic icons next to each TextInput.
  - AI-filled marker (✨ chip + yellow left-border) per field.
  - Review banner after multi_field flow.
  - All new useState above the existing early return.
- [ ] `src/services/analytics.ts` — 3 new events wired into
  `RegisterShopScreen` at the right funnel points
  (Strategic Principle 8).
- [ ] `tests/functions/voiceOnboardingHelpers.test.ts` — 10+
  tests, all pass.
- [ ] `npx tsc --noEmit` (root + functions): 0 errors.
- [ ] `npm test`: green (+10 from new tests).
- [ ] PRELAUNCH_CHECKLIST: PR 34 section appended.
- [ ] `git grep -i 'sk-ant-'` — zero matches (smoke test for
  Anthropic key leak; carried over from PR 32).
- [ ] `git grep ANTHROPIC_API_KEY` — only the same safe
  references PR 32 established (`defineSecret`, `secrets:`,
  comments, docs).
- [ ] **No new secret types.** STT auth uses ADC (the function's
  runtime SA) — confirm no `defineSecret('GOOGLE_*')` calls
  appear anywhere in the diff.

## Deliberate-break check (per `.windsurf/test-discipline.md`)

Before declaring done, temporarily change the `validatePhone`
function so it skips the `91` prefix-strip step. Run
`npm test -- --testPathPattern="voiceOnboardingHelpers"`. The
"strips +91 prefix" test must fail with a phone value of `+91...`
instead of the 10-digit canonical. Revert.

## Smoke tests (after server-first deploy + OTA)

1. **Hindi happy path (multi_field)** — sign in as a non-admin
   tester, navigate to "Register a shop", switch language to
   हिंदी, tap "🎙 Speak about your shop", hold and speak:
   "मेरी दुकान का नाम शर्मा किराना है, बीस MG रोड पर है,
   सुबह सात बजे से रात दस बजे तक खुलती है"
   → expected: 5 fields fill (name, address, openTime,
   closeTime; phone may or may not). Review banner shows
   the transcript. Each AI-filled field has the ✨ chip.
2. **English happy path (multi_field)** — same as Test 1 but
   in English. Same result, English banner.
3. **Per-field mic (single_field)** — clear all fields, tap
   the mic icon next to "Name", speak "Sharma Kirana Mart",
   confirm dialog appears, tap ✓. Field fills with the
   transcript. No banner; no ✨ chip (single_field doesn't
   set those because the user explicitly directed each field).
4. **Bad audio handling** — tap "🎙 Speak" → say nothing → wait
   for the 30s cap. Should reject with a friendly
   language-appropriate message ("कुछ भी सुनाई नहीं दिया" /
   "No speech detected").
5. **Daily quota** — set
   `aiQuotas/{uid}_{today}.voiceOnboarding = 10` in Firestore
   console, retry. Should reject with the Hindi message in
   Hindi mode, English in English mode.
6. **Kill switch** — set `aiFeatures/voiceOnboarding.enabled
   = false`, retry. Should reject with friendly message in the
   selected language.
7. **Audit log entries** — after Tests 1, 2, 3, check
   `aiAuditLog/` for entries with `feature:
   'voiceOnboarding'`. Verify `subFeature`, `languageCode`,
   `costInr` populate correctly.
8. **Permissions: mic denied** — deny the mic permission, tap
   "🎙 Speak". Should prompt to enable in OS settings, NOT
   crash. Friendly message.
9. **Web build** — `npm run web`, open Register screen. Voice
   buttons should either work via browser audio APIs (if
   `expo-audio` supports web) OR show a "voice not supported
   on web — please type" hint. Either is acceptable; don't
   crash.
10. **No sk-ant- in shipped bundle** — same defensive check as
    PR 32. Run `npx expo export` (or pull the latest OTA bundle),
    grep for `sk-ant-` and any GCS service-account-key shape.
    Zero matches expected.
11. **TypeScript clean** — `npx tsc --noEmit` shows zero errors.

## Deploy plan

Server-first with one new manual GCP step.

```powershell
$env:NODE_OPTIONS = "--use-system-ca"

# 1. ENABLE THE CLOUD SPEECH-TO-TEXT API (Sudhir, one-time).
#    Browser:
#      https://console.cloud.google.com/apis/library/speech.googleapis.com?project=grocery-mvp-dev
#    Click "Enable". Wait ~30 seconds. The compute service account
#    automatically gets the necessary client role since it's part of
#    the project — no IAM grant needed for STT itself (unlike the
#    signBlob role from PR 31).
#
#    Verify by running, from any shell with gcloud:
#      gcloud services list --enabled --project=grocery-mvp-dev | findstr speech
#    Should show speech.googleapis.com.

# 2. Audit + tests.
npm test

# 3. Create kill-switch Firestore doc (one-time).
#    Firebase Console → Firestore → start a new document at
#    aiFeatures/voiceOnboarding with field `enabled: true (boolean)`.

# 4. Build + deploy functions.
cd functions; npm run build; cd ..
firebase deploy --only functions:transcribeShopOnboardingAudio
firebase functions:list | Select-String -Pattern "transcribeShopOnboardingAudio"

# 5. Commit + push.
git add functions/package.json functions/package-lock.json
git add functions/src/aiHelpers.ts
git add functions/src/voiceOnboardingHelpers.ts
git add functions/src/index.ts
git add package.json package-lock.json
git add src/components/VoiceInputButton.tsx
git add src/services/orderService.ts
git add src/services/analytics.ts
git add src/types/index.ts
git add src/screens/roles/RegisterShopScreen.tsx
git add tests/functions/voiceOnboardingHelpers.test.ts
git add PRELAUNCH_CHECKLIST.md
git add docs/pr-34-voice-hindi-onboarding-windsurf-prompt.md
git commit -m "PR 34: voice + Hindi onboarding assist (Google STT + Claude Haiku field parser)"
git push origin main

# 6. Client OTA.
eas update --branch production --message "PR 34 - voice + Hindi onboarding"
```

**No native rebuild.** `expo-audio` is JS-pure on autolinking
in SDK 54+; the next OTA picks it up.

**The Cloud Speech API enablement (step 1) MUST happen before
the deploy.** Otherwise the first call returns `INTERNAL` and
the server log shows `PermissionDenied: Cloud Speech-to-Text
API has not been used in project ... before or it is disabled`
— same diagnostic pattern as PR 31's signBlob.

## Estimated time

~4–5 hours Windsurf work:

- Part 1 (extend `aiHelpers.ts`): 20 min
- Part 2 (`voiceOnboardingHelpers.ts`): 40 min
- Part 3 (`transcribeShopOnboardingAudio` callable): 1 hr
- Part 4 (orderService wrapper): 15 min
- Part 5 (`VoiceInputButton` component): 45 min
- Part 6 (RegisterShopScreen integration): 1 hr
- Part 7 (analytics events): 10 min
- Part 8 (tests, 10+ cases): 30 min
- Part 9 (PRELAUNCH_CHECKLIST): 10 min
- Deliberate-break + final test run: 15 min

Plus ~5 min for Sudhir's GCP API enablement + ~30s for the
Firestore kill-switch doc.

## Why this PR matters

PR 32 collapsed the menu-typing problem. PR 34 collapses the
*signup* typing problem. Together, they cover the two
moments in the funnel where a non-English-fluent kirana
owner is most likely to abandon: filling out the registration
form (PR 34) and entering their menu (PR 32).

This is the explicit closeout of the Phase A2
onboarding-accessibility gap. After PR 34, the answer to "can
a Hindi-only shopkeeper from a tier-2 town in UP onboard
themselves?" goes from "probably not without help" to "yes,
in under 30 minutes."

It's also the proof that the `aiHelpers.ts` substrate from PR
32 was worth building. PR 34 adds one new file
(`voiceOnboardingHelpers.ts`), one new method on the wrapper
(`runClaude` for text-only), and inherits everything else —
secret binding, model selection, cost estimation, audit log
shape. The next AI PR (PR 35's field-rep mode optionally uses
AI for shopkeeper handoff prep, or PR 47 customer-side
shopping assistant) will be even cheaper to write.

And it's the moment where the Mission North Star starts to
have empirical numbers. Once PR 34 ships and pilot shops start
arriving, `aiAuditLog/` shows real per-shop onboarding cost
(₹3–₹25 total across PR 32 + PR 34 calls) — orders of
magnitude less than the field-rep alternative. The unit
economics of "AI-assisted onboarding" stop being a thesis and
start being a measurable fact.
