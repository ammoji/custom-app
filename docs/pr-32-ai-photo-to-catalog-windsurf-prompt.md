# PR 32 — AI photo-to-catalog (Windsurf prompt)

## Why this PR exists

PR 32 is the Phase A2 **differentiator** — the feature the
established kirana-grocery players (Blinkit, Zepto, JioMart) don't
have because they were built before LLM vision became cheap. For
Kirana Mart, it's the difference between "this shop owner spent 4
hours typing 60 SKUs into a form" and "this shop owner photographed
their rate-list at 11pm and ten minutes later their menu was live."

**The flow PR 32 ships:**

1. Approved shop owner opens `ShopMenuScreen` and taps a new
   "📸 Scan rate-list" button.
2. They photograph their printed/handwritten rate-list (or a
   shelf with prices marked).
3. The client compresses the image, sends it to a new Cloud
   Function `extractMenuFromImage`, which calls Claude Sonnet 4.6
   vision via the Anthropic API.
4. Claude returns a structured list of SKUs: name, brand,
   pack-size, MRP, sell price, category guess, confidence.
5. The shop owner reviews a scrollable list, toggles
   include/exclude per row, edits prices if needed, taps "Add 47
   items to menu."
6. A second callable `addExtractedMenuItems` batch-writes the
   approved subset using the same validation gates as the
   existing `addCustomMenuItem`.

**What ships in this PR:**

- A new `functions/src/aiHelpers.ts` wrapper around the Anthropic
  SDK. **This is the substrate that every Phase C customer-facing
  AI PR (PR 44–49) will reuse** — shopping assistant,
  auto-replenishment, recommendations, review summarization,
  support assistant, AI search. Building it correctly once here
  pays back five times later.
- Two new callables: `extractMenuFromImage` (stateless;
  base64 image in → structured JSON out) and
  `addExtractedMenuItems` (batch commit to shop menu).
- Pure helpers `functions/src/menuExtractionHelpers.ts` so the
  prompt construction + response validation is unit-testable
  without hitting the network.
- A new `ScanMenuScreen` for the photo → review → commit wizard.
- A new "📸 Scan rate-list" CTA on `ShopMenuScreen`.
- Per-shop daily quota (5 extractions/day) + per-feature
  kill-switch (`aiFeatures/menuExtraction.enabled`) per the AI
  rate-limiting policy in `docs/ROADMAP.md` Section 3.
- One new Firebase Functions secret: `ANTHROPIC_API_KEY`. Sudhir
  creates it once, same pattern as the existing Razorpay secrets
  + the `SENTRY_AUTH_TOKEN` from PR 26.

**No master-product-catalog matching in this PR.** Every extracted
SKU becomes a custom menu item on the shop's menu (same code path
as the existing `addCustomMenuItem`). PR 33 will add the master
catalog + dedup; PR 32 ships standalone so we can validate the
extraction quality on real rate-lists before investing in the
catalog infrastructure.

~4–6 hours Windsurf work. Server-first deploy. Server adds a new
secret. No native rebuild (`@anthropic-ai/sdk` lives only in
`functions/`).

## Read first

- `.windsurf/code-discipline.md`, `.windsurf/test-discipline.md`,
  `.windsurf/deploy-discipline.md` (especially the new
  "Signed-URL IAM" section added during PR 31 — applies to ALL
  Cloud Functions Gen 2 work).
- `docs/ROADMAP.md` Section 3 (AI integration strategy), in
  particular 3.6 (photo-to-catalog) — captures the architectural
  intent; PR 32 implements it.
- `functions/src/index.ts`:
  - Lines 1370–1450 — `getMenuImageUploadUrl` (PR 6.1). The
    proven signed-URL pattern, NOT used directly in PR 32 (we
    use base64-in-payload instead — see Scope notes below).
  - Lines 4498–4600 — `addCustomMenuItem`. PR 32's
    `addExtractedMenuItems` reuses its exact validation logic on
    each item. **Read both the validation and the actual
    Firestore write** so the batch version is identical
    field-by-field.
  - Lines 151–153 — existing `defineSecret` usage for Razorpay.
    PR 32 adds a sibling `ANTHROPIC_API_KEY` secret.
  - `bootstrapShopMenu` (~line 4207) — informational; no change.
- `src/screens/shop/ShopMenuScreen.tsx` — the screen that gets
  the new "Scan rate-list" CTA. Lines ~340 has the existing
  "Add Custom Item" navigation.
- `src/screens/shop/AddCustomMenuItemScreen.tsx` — read the
  existing menu-item form. PR 32 reuses the same field shape
  (name, MRP, price, pack, category) just rendered in a list
  instead of a single form. Same validation rules client-side.
- `src/constants/categories.ts` — the 10 canonical `CategoryId`
  values. Claude's `categoryGuess` output must map to one of
  these; server validates strictly.
- `src/types/index.ts`:
  - `NewMenuItemInput` (line 159) — the shape Claude must
    ultimately produce per row.
  - Add new `ExtractedMenuDraft`, `ExtractedMenuItem` types in
    this PR.
- `package.json` — `expo-image-manipulator ~14.0.8` is already a
  dep (no new client-side dep). `expo-image-picker ~17.0.11`
  also already a dep (PR 31 used it for KYC).
- `functions/package.json` — no AI deps yet. PR 32 adds
  `@anthropic-ai/sdk`. Pin to the latest stable at PR-write
  time; let Windsurf choose the version it can install.

## Critical lessons from PRs 6.1, 24–31.1 (do not repeat)

1. **API keys NEVER leak into git or the mobile bundle.**
   `ANTHROPIC_API_KEY` is a Firebase Functions secret, defined
   via `defineSecret('ANTHROPIC_API_KEY')` and bound to functions
   that need it via the `secrets: [ANTHROPIC_API_KEY]` option.
   It MUST NOT appear in `app.json`, `eas.json`, or any
   committed file. Sudhir creates it manually via PowerShell —
   see Part 9 of the deploy plan.
2. **Cost discipline.** Every AI call has:
   - Auth check (`request.auth` present + `shopOwner` claim).
   - Per-shop daily quota (Firestore counter at
     `aiQuotas/{uid}_{YYYY-MM-DD}.menuExtraction`, capped at 5).
   - Per-feature kill switch
     (`aiFeatures/menuExtraction.enabled === true`) checked at
     callable start; if false, throws `failed-precondition`.
   - Audit log entry per call (uid, shopId, function, input
     tokens, output tokens, timestamp, cost-estimate-INR).
3. **Server-first deploy.** Three new callables —
   `extractMenuFromImage`, `addExtractedMenuItems`, plus an admin
   helper `toggleAiFeature` if Windsurf chooses to include it
   (otherwise the kill-switch flips via Firebase Console). Deploy
   server BEFORE the client OTA that calls them. One `--only`
   target per command (deploy discipline Rule 1).
4. **Never strip imports between edits.** Files touched:
   `functions/src/aiHelpers.ts` (new), `menuExtractionHelpers.ts`
   (new), `index.ts` (3 new callables + 1 new secret + imports),
   `package.json` (functions/) (add @anthropic-ai/sdk),
   `ShopMenuScreen.tsx` (+1 navigation button),
   `ScanMenuScreen.tsx` (new), `orderService.ts` (+2 wrappers),
   `src/types/index.ts` (new types). Defensive imports stay
   pinned.
5. **All `useState` calls in screens sit ABOVE conditional early
   returns.** `ScanMenuScreen` has multiple states (picking,
   resizing, extracting, reviewing, committing) — declare them
   all at the top.
6. **Storage rules: no new rules needed.** PR 32 doesn't store
   the image — base64 stays in the callable payload, processed in
   memory, never written to a bucket. Privacy win + no storage
   cleanup needed + no IAM signBlob path (which would re-trigger
   the PR 31 IAM gotcha if we tried).
7. **One `DO NOT REMOVE` marker expected** on the
   `@anthropic-ai/sdk` import in `aiHelpers.ts` — the LSP
   sometimes strips it during refactors when other helpers
   temporarily orphan the import. Mark it.
8. **Schema-additive only.** New collections (`aiQuotas/`,
   `aiFeatures/`, `aiAuditLog/`) are net-new — won't conflict
   with any existing schema. The shop menu writes via
   `addExtractedMenuItems` use the same document shape as
   `addCustomMenuItem` (custom menu items, `productId: null`,
   `id` prefixed `custom_`).

## Scope (in)

### Part 1 — `ANTHROPIC_API_KEY` secret + `aiHelpers.ts`

Create `functions/src/aiHelpers.ts`. This is the wrapper that
every Phase C AI PR will import from — get the abstraction right
on day one.

```ts
/**
 * PR 32 — Server-side Anthropic SDK wrapper.
 *
 * Why a wrapper (not inline @anthropic-ai/sdk calls): future PRs
 * (44–49 in `docs/ROADMAP.md`) all reuse the same plumbing —
 * shopping assistant, auto-replenishment, recommendations,
 * sentiment summarization, support assistant, AI search. Putting
 * the cost/quota/audit logic here once means every later PR is
 * "just write the prompt + the typed response shape, ship."
 *
 * Auth + quota + audit logging are NOT in this file — they belong
 * at the callable layer (different auth gates per feature). This
 * file is the pure "given a prompt + image, get text back from
 * Claude" surface plus model + retry + structured-output parsing.
 *
 * PR 32 — DO NOT REMOVE. Used by `extractMenuFromImage` callable
 * and every Phase C AI callable. If you see this import stripped
 * in a later PR, restore it before committing.
 */
import Anthropic from '@anthropic-ai/sdk';
import { defineSecret } from 'firebase-functions/params';

export const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');

// Lazy-init so the SDK isn't instantiated until first use (avoids
// cold-start cost on functions that don't use AI).
let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });
  }
  return client;
}

/**
 * Default model for vision tasks. Sonnet 4.6 is the current
 * vision-capable model with structured-output reliability. If a
 * future PR wants a cheaper model (Haiku) for a non-vision task,
 * pass it explicitly via `options.model`.
 */
const DEFAULT_VISION_MODEL = 'claude-sonnet-4-6';

export type ClaudeVisionInput = {
  systemPrompt: string;
  userText: string;
  imageBase64: string; // raw base64, no data: prefix
  imageMediaType?: 'image/jpeg' | 'image/png' | 'image/webp';
  maxTokens?: number;
  model?: string;
};

export type ClaudeVisionResult = {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
};

/**
 * Call Claude with a vision input. Returns the raw text response
 * (caller is responsible for JSON-parsing if expecting structured
 * output) plus usage info for audit logging.
 *
 * Retry policy: 0 retries on the SDK call. Anthropic's SDK does
 * its own short-window retry for transient network errors;
 * adding our own retry on top would multiply cost on real
 * failures (rate-limit, bad input). Caller can re-invoke if
 * desired.
 */
export async function runClaudeVision(
  input: ClaudeVisionInput,
): Promise<ClaudeVisionResult> {
  const client = getClient();
  const model = input.model ?? DEFAULT_VISION_MODEL;
  const maxTokens = input.maxTokens ?? 2000;

  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system: input.systemPrompt,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: input.imageMediaType ?? 'image/jpeg',
              data: input.imageBase64,
            },
          },
          { type: 'text', text: input.userText },
        ],
      },
    ],
  });

  // Concatenate any text blocks; ignore non-text content.
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

/**
 * Cost estimate in INR for an audit log entry. Approximate; tracks
 * Sonnet 4.6 published pricing (Claude knowledge as of May 2026).
 * If pricing changes meaningfully, update here in one place and
 * every callable's audit log catches up automatically.
 */
export function estimateCostInr(
  inputTokens: number,
  outputTokens: number,
): number {
  // Sonnet 4.6: $3/M input, $15/M output (approx). At ₹83/USD:
  const usd = (inputTokens / 1_000_000) * 3 + (outputTokens / 1_000_000) * 15;
  return Math.round(usd * 83 * 100) / 100; // ₹ with 2 decimals
}
```

### Part 2 — Pure helpers in `functions/src/menuExtractionHelpers.ts`

Two things to test pure (without hitting the API or Firestore):

1. **System prompt construction.** The prompt that tells Claude
   the schema + the category enum + the "use null for illegible
   fields" instruction. Building it as a pure function lets us
   add eval/regression tests later.
2. **Response validation.** Claude returns text; we parse it as
   JSON; we validate each item against the schema. Pure
   validation, unit-testable.

```ts
/**
 * PR 32 — pure helpers for menu extraction. No SDK calls, no
 * Firestore. Tested in isolation; the callable wires them
 * together.
 */
import { VALID_CATEGORIES } from './bulkMenuHelpers'; // or wherever
// the existing canonical CategoryId set lives in functions/

export const MENU_EXTRACTION_SYSTEM_PROMPT = `
You are an expert at reading Indian kirana (corner-store) grocery
rate-lists. You will be shown a single photograph of a printed
rate card, a handwritten price list, or a shelf with items priced.

Your job: extract EVERY visible product into a structured JSON
list. Be exhaustive — missing items costs the shop owner more
than over-extracting (they can easily un-tick items they don't
want, but they can't add items you missed without scanning again).

OUTPUT FORMAT (strict — no other text, no markdown fences):

{
  "items": [
    {
      "name": "<short product name in English, e.g. 'Aashirvaad Atta'>",
      "brand": "<brand name if visible, else null>",
      "packSize": "<numeric quantity with unit, e.g. '5 kg' or '500 ml' or '12 pieces'>",
      "mrp": <number in INR or null if illegible>,
      "sellPrice": <number in INR or null if illegible>,
      "category": "<one of: ${[...VALID_CATEGORIES].join(', ')}>",
      "confidence": "high" | "medium" | "low"
    }
  ]
}

RULES:
- If only one price is shown for an item, treat it as both MRP and
  sellPrice (the shop sells at MRP).
- If MRP is crossed out / struck through and a lower price is
  shown, MRP is the struck-through value and sellPrice is the
  lower one.
- "category" MUST be one of the listed enum values. If unsure,
  pick the closest. Never invent new categories.
- "confidence" = "low" if the handwriting / print is hard to read,
  if the price is ambiguous, or if you're guessing the brand.
  "high" only when name + price + pack are all clearly legible.
- Translate Hindi/regional names to their common English
  equivalent (e.g. "हल्दी" → "Haldi (Turmeric)") so the shop owner
  can recognize it; they will edit if they prefer the original.
- DO NOT extract non-product items: discount banners, store name,
  contact info, etc.

Return ONLY the JSON object. No surrounding prose, no
\`\`\`json fences.
`.trim();

export type ExtractedItemRaw = {
  name?: unknown;
  brand?: unknown;
  packSize?: unknown;
  mrp?: unknown;
  sellPrice?: unknown;
  category?: unknown;
  confidence?: unknown;
};

export type ExtractedItem = {
  name: string;
  brand: string | null;
  packSize: string;
  mrp: number | null;
  sellPrice: number | null;
  category: string;
  confidence: 'high' | 'medium' | 'low';
};

export type ExtractionParseResult =
  | { ok: true; items: ExtractedItem[]; droppedCount: number }
  | { ok: false; reason: string };

/**
 * Parse Claude's response text into validated ExtractedItem[].
 * Returns droppedCount for items that failed validation — these
 * are logged but not returned to the client (avoids surfacing
 * malformed rows the user can't action).
 *
 * Strict on the shape but permissive on minor issues:
 *  - mrp < sellPrice → keep, the client review step lets the user
 *    swap them (common Claude mistake when prices are unclear).
 *  - confidence missing → default to 'medium'.
 *  - category not in enum → drop the item (worth dropping rather
 *    than miscategorising, which corrupts the shop's menu).
 */
export function parseExtractionResponse(
  rawText: string,
): ExtractionParseResult {
  // Tolerate leading/trailing whitespace + accidental fences.
  let json = rawText.trim();
  if (json.startsWith('```')) {
    json = json.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  }
  let parsed: { items?: ExtractedItemRaw[] };
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    return { ok: false, reason: `JSON parse failed: ${(e as Error).message}` };
  }
  if (!parsed || !Array.isArray(parsed.items)) {
    return { ok: false, reason: 'Response missing items[] array' };
  }

  const items: ExtractedItem[] = [];
  let droppedCount = 0;
  for (const raw of parsed.items) {
    const validated = validateExtractedItem(raw);
    if (validated) items.push(validated);
    else droppedCount += 1;
  }

  return { ok: true, items, droppedCount };
}

function validateExtractedItem(
  raw: ExtractedItemRaw,
): ExtractedItem | null {
  if (typeof raw.name !== 'string' || !raw.name.trim()) return null;
  if (typeof raw.packSize !== 'string' || !raw.packSize.trim()) return null;
  if (typeof raw.category !== 'string' || !VALID_CATEGORIES.has(raw.category)) {
    return null;
  }
  const mrp =
    raw.mrp === null || raw.mrp === undefined
      ? null
      : typeof raw.mrp === 'number' && Number.isFinite(raw.mrp) && raw.mrp > 0
      ? raw.mrp
      : null;
  const sellPrice =
    raw.sellPrice === null || raw.sellPrice === undefined
      ? null
      : typeof raw.sellPrice === 'number' &&
        Number.isFinite(raw.sellPrice) &&
        raw.sellPrice > 0
      ? raw.sellPrice
      : null;
  const confidence: ExtractedItem['confidence'] =
    raw.confidence === 'high' || raw.confidence === 'medium' || raw.confidence === 'low'
      ? raw.confidence
      : 'medium';
  const brand = typeof raw.brand === 'string' && raw.brand.trim() ? raw.brand.trim() : null;
  return {
    name: raw.name.trim(),
    brand,
    packSize: raw.packSize.trim(),
    mrp,
    sellPrice,
    category: raw.category,
    confidence,
  };
}

export const MENU_EXTRACTION_USER_PROMPT = `Extract every visible product from this rate-list/shelf photo into the specified JSON format. Be exhaustive.`;
```

Note: if `VALID_CATEGORIES` doesn't currently live in a sibling
helpers file in `functions/`, look for the existing canonical
set (the `addCustomMenuItem` callable references it) — same
import. Don't duplicate the enum.

### Part 3 — Callable `extractMenuFromImage`

In `functions/src/index.ts`, add the callable. Wires the auth
gate + quota + kill-switch in front of `runClaudeVision` +
`parseExtractionResponse`.

```ts
import {
  runClaudeVision,
  estimateCostInr,
  ANTHROPIC_API_KEY,
} from './aiHelpers';
import {
  MENU_EXTRACTION_SYSTEM_PROMPT,
  MENU_EXTRACTION_USER_PROMPT,
  parseExtractionResponse,
} from './menuExtractionHelpers';

// PR 32 — Constants. Tunable here without redeploy of all functions.
const MENU_EXTRACTION_DAILY_QUOTA = 5;
const MAX_IMAGE_BYTES = 2_000_000; // ~2 MB base64 → ~1.5 MB raw

export const extractMenuFromImage = onCall<{
  imageBase64: string;
  imageMediaType?: 'image/jpeg' | 'image/png' | 'image/webp';
}>(
  {
    cors: true,
    enforceAppCheck: false,
    secrets: [ANTHROPIC_API_KEY],
    timeoutSeconds: 120, // Claude vision calls can take 10–30s
    memory: '512MiB', // base64 + Claude SDK both want headroom
  },
  async request => {
    const auth = request.auth;
    if (!auth) throw new HttpsError('unauthenticated', 'Sign in required');
    if (auth.token?.shopOwner !== true) {
      throw new HttpsError('permission-denied', 'Shop owner role required');
    }
    const shopId = auth.token.shopId as string | undefined;
    if (!shopId) {
      throw new HttpsError('failed-precondition', 'No shopId on your account');
    }

    // Kill-switch check.
    const killSwitchSnap = await db.doc('aiFeatures/menuExtraction').get();
    const enabled =
      killSwitchSnap.exists ? killSwitchSnap.data()?.enabled !== false : true;
    if (!enabled) {
      throw new HttpsError(
        'failed-precondition',
        'Menu extraction is temporarily disabled. Try again later.',
      );
    }

    // Validate image payload.
    const { imageBase64, imageMediaType } = request.data ?? ({} as any);
    if (typeof imageBase64 !== 'string' || imageBase64.length === 0) {
      throw new HttpsError('invalid-argument', 'imageBase64 required');
    }
    if (imageBase64.length > MAX_IMAGE_BYTES) {
      throw new HttpsError(
        'invalid-argument',
        `Image too large (${Math.round(imageBase64.length / 1024)}KB). Try a smaller photo or crop tighter.`,
      );
    }

    // Per-shop daily quota.
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const quotaRef = db.doc(`aiQuotas/${auth.uid}_${today}`);
    const usedToday = await db.runTransaction(async tx => {
      const snap = await tx.get(quotaRef);
      const current = (snap.data()?.menuExtraction as number | undefined) ?? 0;
      if (current >= MENU_EXTRACTION_DAILY_QUOTA) {
        return -1; // Sentinel: quota exhausted
      }
      tx.set(
        quotaRef,
        {
          menuExtraction: current + 1,
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
        `Daily limit reached (${MENU_EXTRACTION_DAILY_QUOTA} scans). Try again tomorrow.`,
      );
    }

    // Call Claude.
    let claudeResult;
    try {
      claudeResult = await runClaudeVision({
        systemPrompt: MENU_EXTRACTION_SYSTEM_PROMPT,
        userText: MENU_EXTRACTION_USER_PROMPT,
        imageBase64,
        imageMediaType: imageMediaType ?? 'image/jpeg',
        maxTokens: 4000, // 50–80 SKUs needs room
      });
    } catch (e: any) {
      console.error('[extractMenuFromImage] Claude call failed:', e?.message ?? e);
      // Don't refund the quota — calls that hit Claude still cost
      // something on the Anthropic side. If we see this become a
      // common failure mode we can revisit.
      throw new HttpsError(
        'internal',
        'Could not read the image. Try retaking with better lighting or angle.',
      );
    }

    // Parse + validate.
    const parsed = parseExtractionResponse(claudeResult.text);
    if (!parsed.ok) {
      console.warn(
        `[extractMenuFromImage] parse failed for shop ${shopId}: ${parsed.reason}`,
      );
      throw new HttpsError(
        'internal',
        'Claude returned an unexpected response. Try again or retake the photo.',
      );
    }

    // Audit log (non-fatal).
    const costInr = estimateCostInr(claudeResult.inputTokens, claudeResult.outputTokens);
    db.collection('aiAuditLog')
      .add({
        uid: auth.uid,
        shopId,
        feature: 'menuExtraction',
        model: claudeResult.model,
        inputTokens: claudeResult.inputTokens,
        outputTokens: claudeResult.outputTokens,
        costInr,
        itemsExtracted: parsed.items.length,
        droppedCount: parsed.droppedCount,
        timestamp: FieldValue.serverTimestamp(),
      })
      .catch(e => console.warn('[extractMenuFromImage] audit log failed:', e));

    return {
      ok: true,
      items: parsed.items,
      droppedCount: parsed.droppedCount,
      usedTodayCount: usedToday,
      dailyQuota: MENU_EXTRACTION_DAILY_QUOTA,
    };
  },
);
```

### Part 4 — Callable `addExtractedMenuItems`

Batch write. Reuses the validation rules of `addCustomMenuItem`
exactly. Returns counts so the client can show "Added 47 items;
3 skipped (price out of range)."

```ts
export const addExtractedMenuItems = onCall<{
  items: Array<{
    name: string;
    price: number;
    mrp: number;
    packLabel: string;
    category: string;
  }>;
}>(
  { cors: true, enforceAppCheck: false },
  async request => {
    const auth = request.auth;
    if (!auth) throw new HttpsError('unauthenticated', 'Sign in required');
    if (auth.token?.shopOwner !== true) {
      throw new HttpsError('permission-denied', 'Shop owner role required');
    }
    const shopId = auth.token.shopId as string | undefined;
    if (!shopId) {
      throw new HttpsError('failed-precondition', 'No shopId on your account');
    }

    const items = request.data?.items;
    if (!Array.isArray(items) || items.length === 0) {
      throw new HttpsError('invalid-argument', 'items array required');
    }
    if (items.length > 100) {
      throw new HttpsError(
        'invalid-argument',
        `Too many items (max 100 per batch). Got ${items.length}.`,
      );
    }

    const batch = db.batch();
    const added: string[] = [];
    const skipped: Array<{ index: number; reason: string }> = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const trimmedName =
        typeof item.name === 'string' ? item.name.trim() : '';
      if (!trimmedName) {
        skipped.push({ index: i, reason: 'name required' });
        continue;
      }
      if (
        typeof item.price !== 'number' ||
        !Number.isFinite(item.price) ||
        item.price <= 0
      ) {
        skipped.push({ index: i, reason: 'price must be a positive number' });
        continue;
      }
      if (
        typeof item.mrp !== 'number' ||
        !Number.isFinite(item.mrp) ||
        item.mrp < item.price
      ) {
        skipped.push({ index: i, reason: 'mrp must be >= price' });
        continue;
      }
      if (typeof item.packLabel !== 'string' || !item.packLabel.trim()) {
        skipped.push({ index: i, reason: 'packLabel required' });
        continue;
      }
      if (typeof item.category !== 'string' || !VALID_CATEGORIES.has(item.category)) {
        skipped.push({ index: i, reason: `unknown category: ${item.category}` });
        continue;
      }

      const now = Date.now();
      const rand = Math.random().toString(36).slice(2, 8);
      const menuItemId = `custom_${now}_${rand}_${i}`;
      // Same placeholder image as addCustomMenuItem.
      const fallbackImage =
        'https://placehold.co/400x400/e2e8f0/64748b?text=Custom+Item';

      batch.set(db.doc(`shops/${shopId}/menu/${menuItemId}`), {
        id: menuItemId,
        shopId,
        productId: null,
        name: trimmedName,
        imageUrl: fallbackImage,
        packLabel: item.packLabel.trim(),
        category: item.category,
        price: item.price,
        mrp: item.mrp,
        available: true,
        stock: null,
        addedVia: 'menuExtraction', // tag for analytics
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      added.push(menuItemId);
    }

    if (added.length === 0) {
      throw new HttpsError(
        'invalid-argument',
        `All ${items.length} items failed validation. First error: ${skipped[0]?.reason}`,
      );
    }

    await batch.commit();

    return { ok: true, added: added.length, skipped, menuItemIds: added };
  },
);
```

### Part 5 — Client wrappers in `orderService`

In `src/services/orderService.ts`, add two methods mirroring the
existing wrapper pattern (web + native dispatch):

```ts
async extractMenuFromImage(args: {
  imageBase64: string;
  imageMediaType?: 'image/jpeg' | 'image/png' | 'image/webp';
}): Promise<{
  ok: true;
  items: ExtractedMenuItem[];
  droppedCount: number;
  usedTodayCount: number;
  dailyQuota: number;
}> { /* same web/native dispatch pattern as existing methods */ }

async addExtractedMenuItems(args: {
  items: Array<{
    name: string;
    price: number;
    mrp: number;
    packLabel: string;
    category: string;
  }>;
}): Promise<{
  ok: true;
  added: number;
  skipped: Array<{ index: number; reason: string }>;
  menuItemIds: string[];
}> { /* same dispatch */ }
```

### Part 6 — Types in `src/types/index.ts`

```ts
// PR 32 — AI menu extraction.
export type ExtractedMenuItem = {
  name: string;
  brand: string | null;
  packSize: string;
  mrp: number | null;
  sellPrice: number | null;
  category: CategoryId;
  confidence: 'high' | 'medium' | 'low';
};

// Client-side, editable wrapper around the extracted item. The
// review screen mutates these locally; only the approved ones get
// translated into NewMenuItemInput[] for the addExtractedMenuItems
// call.
export type ExtractedMenuDraft = ExtractedMenuItem & {
  tempId: string; // local-only key; never sent to server
  selected: boolean;
  editedName: string;
  editedPackLabel: string;
  editedMrp: number;
  editedSellPrice: number;
  editedCategory: CategoryId;
};
```

### Part 7 — `ScanMenuScreen` (the wizard)

New file `src/screens/shop/ScanMenuScreen.tsx`. Implements a
4-phase wizard:

1. **`pick`** — initial state. Two CTAs: "Take photo" (camera)
   and "Choose from gallery". Plus a short blurb explaining what
   the screen does ("Photograph your rate-list or shelf —
   Kirana Mart's AI will read it and pre-fill your menu.").
2. **`processing`** — after the user picks. Resizes the image
   client-side via `expo-image-manipulator` to 1024px on the
   longest edge, JPEG quality 0.7. Base64-encodes it. Then calls
   `extractMenuFromImage`. Shows a loader with progressive copy:
   "Compressing photo..." → "Reading your rate list..." → "Almost
   done...". A real Claude vision call is ~10–20s; pad the copy
   so it doesn't feel stuck.
3. **`review`** — got items back. Render a scrollable list of
   editable cards. Each card:
   - Checkbox: include in batch (default on).
   - Editable name (TextInput, pre-filled).
   - Editable pack label.
   - Two numeric inputs: MRP, sell price.
   - Category picker (10 options).
   - Confidence chip ("⚠ Low confidence" in muted red if
     `confidence === 'low'`).
   - Image preview optional — defer; keep cards tight.
   Header strip: "AI found N items. Review and tap 'Add to menu'
   when ready." Plus "Used X/5 scans today."
   Bottom CTA: "Add N items to menu" — disabled when zero
   checked. On tap, transition to `committing`.
4. **`committing`** — show a spinner. Map approved drafts to the
   `addExtractedMenuItems` payload shape (drop `brand`,
   `packSize`, `confidence`, `selected`, `tempId`; keep edited
   values), call the callable. On success: navigate back to
   `ShopMenuScreen` with a success toast ("✓ Added 47 items.
   3 skipped.") and the menu refetches on focus.

**Important client-side rules:**

- All `useState` calls at the top (Rules of Hooks).
- Use `usePressGuard` (PR 27) on the "Add N items to menu" CTA —
  prevents double-tap → duplicate batch writes.
- Sensible defaults when AI returned `null` for prices: pre-fill
  with `0`. User must edit before submit (validator enforces
  price > 0; UI also disables the include-checkbox if price is
  invalid).
- Confidence chip is purely informational. No behavior gate.

```tsx
// rough scaffold — Windsurf fills in styles + final polish:
export default function ScanMenuScreen() {
  const [phase, setPhase] = useState<'pick' | 'processing' | 'review' | 'committing'>('pick');
  const [drafts, setDrafts] = useState<ExtractedMenuDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [usageToday, setUsageToday] = useState<{ used: number; quota: number } | null>(null);
  // ... handlers and JSX
}
```

### Part 8 — Wire "Scan rate-list" CTA into `ShopMenuScreen`

In `src/screens/shop/ShopMenuScreen.tsx`, near the existing "Add
Custom Item" navigation (~line 340), add a second CTA above or
alongside it:

```tsx
<Button
  title="📸 Scan rate-list (AI)"
  variant="primary"
  onPress={() => nav.navigate('ScanMenu')}
  fullWidth
/>
```

Plus register `ScanMenu` in `src/navigation/AppNavigator.tsx`
alongside the other shop-owner screens.

### Part 9 — Tests

`tests/functions/menuExtractionHelpers.test.ts` — pure helper tests:

```ts
import {
  parseExtractionResponse,
  MENU_EXTRACTION_SYSTEM_PROMPT,
} from '../../functions/src/menuExtractionHelpers';

describe('PR 32 — menuExtractionHelpers', () => {
  test('MENU_EXTRACTION_SYSTEM_PROMPT contains the 10 canonical CategoryIds', () => {
    for (const cat of ['atta_rice_dal', 'oil_ghee', 'dairy_eggs',
      'bakery', 'masala_spices', 'snacks_biscuits', 'beverages',
      'personal_care', 'household', 'fruits_vegetables']) {
      expect(MENU_EXTRACTION_SYSTEM_PROMPT).toContain(cat);
    }
  });

  test('parses valid Claude response', () => {
    const text = JSON.stringify({
      items: [
        {
          name: 'Aashirvaad Atta',
          brand: 'Aashirvaad',
          packSize: '5 kg',
          mrp: 305,
          sellPrice: 295,
          category: 'atta_rice_dal',
          confidence: 'high',
        },
      ],
    });
    const r = parseExtractionResponse(text);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.items).toHaveLength(1);
      expect(r.items[0].name).toBe('Aashirvaad Atta');
      expect(r.droppedCount).toBe(0);
    }
  });

  test('strips markdown fences before parsing', () => {
    const text = '```json\n{ "items": [] }\n```';
    const r = parseExtractionResponse(text);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.items).toHaveLength(0);
  });

  test('drops items with invalid category', () => {
    const text = JSON.stringify({
      items: [
        { name: 'X', packSize: '1 kg', category: 'made_up_category', confidence: 'high' },
        { name: 'Y', packSize: '1 kg', category: 'oil_ghee', confidence: 'high' },
      ],
    });
    const r = parseExtractionResponse(text);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.items).toHaveLength(1);
      expect(r.items[0].name).toBe('Y');
      expect(r.droppedCount).toBe(1);
    }
  });

  test('drops items with missing name or packSize', () => { /* ... */ });

  test('coerces null mrp/sellPrice when not numbers', () => { /* ... */ });

  test('defaults confidence to "medium" when missing', () => { /* ... */ });

  test('returns { ok: false } on un-parseable JSON', () => {
    const r = parseExtractionResponse('not json at all');
    expect(r.ok).toBe(false);
  });
});
```

Aim for 8 tests covering prompt construction, parse-happy-path,
each validation drop reason, and the error path. Mirror the style
of `kycUploadHelpers.test.ts` (PR 31).

**Don't unit-test the Claude API call itself** — it would either
hit the real API (expensive + flaky) or require a heavy mock. The
helper boundary is exactly where the testable surface ends.

### Part 10 — PRELAUNCH_CHECKLIST update

In `PRELAUNCH_CHECKLIST.md`:

- Append a PR 32 section at the bottom documenting:
  - New `aiHelpers.ts` substrate + the `ANTHROPIC_API_KEY` secret
    pattern.
  - The two new callables.
  - The new collections: `aiQuotas/`, `aiFeatures/`,
    `aiAuditLog/`.
  - The new `ScanMenuScreen` + the CTA on `ShopMenuScreen`.
  - Cost guardrails: per-shop daily quota = 5, per-feature kill
    switch via `aiFeatures/menuExtraction.enabled`.
  - Follow-ups to track:
    - **PR 33** will add master-catalog matching + admin curation
      of unmatched SKUs.
    - **Bulk image upload** — multi-photo extraction (combine
      multiple shelf shots into one draft) is deferred. Single
      photo per call works for the typical rate-list.
    - **PDF rate-list** — out of scope; images only. If a shop
      has a PDF, they can take a photo of it on screen.
    - **Anthropic auth-token rotation** — when the key is
      rotated, run `eas secret:create` again with `--force` to
      overwrite. Document the rotation cadence (e.g. quarterly)
      separately.
    - **Cost tracking dashboard** — `aiAuditLog/` is the source.
      An admin reports screen showing daily/weekly AI cost is
      worth building once spend matters; out of scope here.

## Scope (out)

- **Master product catalog matching.** PR 33's territory. PR 32
  treats every extracted SKU as a custom menu item.
- **PDF rate-list ingestion.** Images only. Vision-API-supported
  formats are JPEG/PNG/WebP/GIF; PDFs would need conversion to
  images server-side, which adds complexity. Photo-of-PDF works.
- **Multi-photo combine into one draft.** Single photo per call.
  Shop owners with very long rate-lists do multiple scans
  (counts against the 5/day quota).
- **Streaming progress (Server-Sent Events).** Claude messages
  API supports streaming, but the callable layer doesn't — adding
  streaming would require an HTTP function. Out of scope; the
  ~15-second wait with progressive copy is the right v1 UX.
- **Anthropic key rotation tooling.** Manual `eas secret:create`
  with `--force` is fine for v1.
- **Cost dashboard / admin AI spend report.** `aiAuditLog/` is
  the substrate; an admin screen rendering it is a follow-up.
- **Multi-language UI in `ScanMenuScreen`.** The wizard is English
  for v1. PR 34 (voice + Hindi onboarding) is a different
  workstream.
- **AI extraction for menu UPDATES** (i.e. "scan again and update
  prices"). Add-only in v1. Future PR: a "Reconcile against
  existing menu" flow that updates prices instead of duplicating.
- **Per-image preview thumbnails for each extracted row.** Claude
  doesn't return crop coords. Adding a preview would need
  client-side cropping inference, which is heavy. Defer.

## Acceptance checklist

- [ ] `functions/package.json` — `@anthropic-ai/sdk` added as a
  dep. `functions/package-lock.json` regenerated.
- [ ] `functions/src/aiHelpers.ts` — `ANTHROPIC_API_KEY` secret
  defined, `runClaudeVision` exported, `estimateCostInr` exported,
  `DO NOT REMOVE` marker on the SDK import.
- [ ] `functions/src/menuExtractionHelpers.ts` — pure functions
  for prompt + parse + validate. No imports from `firebase-admin`
  or `firebase-functions`.
- [ ] `extractMenuFromImage` callable — auth + role + kill-switch
  + per-shop daily quota + image size cap + Claude call + parse +
  audit log. `secrets: [ANTHROPIC_API_KEY]` in the callable options.
  `timeoutSeconds: 120`, `memory: '512MiB'`.
- [ ] `addExtractedMenuItems` callable — same auth/role gate as
  `addCustomMenuItem`. Validates each item. Batch-writes. Returns
  `{added, skipped, menuItemIds}`. `addedVia: 'menuExtraction'`
  tag on each doc.
- [ ] `aiFeatures/menuExtraction` doc created manually with
  `{enabled: true}` (Firestore console) OR a small admin callable
  added to toggle it. Either is acceptable; document choice.
- [ ] `src/services/orderService.ts` — two new wrappers (native +
  web dispatch).
- [ ] `src/types/index.ts` — `ExtractedMenuItem` and
  `ExtractedMenuDraft` types added.
- [ ] `src/screens/shop/ScanMenuScreen.tsx` — 4-phase wizard,
  all `useState` above any conditional return, `usePressGuard`
  on the commit CTA.
- [ ] `src/screens/shop/ShopMenuScreen.tsx` — "📸 Scan rate-list
  (AI)" button added near the Custom Item CTA.
- [ ] `src/navigation/AppNavigator.tsx` — `ScanMenu` route
  registered under the shop-owner stack.
- [ ] `tests/functions/menuExtractionHelpers.test.ts` — 8 tests,
  all pass.
- [ ] `npx tsc --noEmit` (root + functions): 0 errors.
- [ ] `npm test`: green (+8 from new helper tests).
- [ ] PRELAUNCH_CHECKLIST: PR 32 section appended.
- [ ] **`ANTHROPIC_API_KEY` does NOT appear in any committed
  file.** Grep for it before commit: `git grep ANTHROPIC_API_KEY`
  should only match `defineSecret('ANTHROPIC_API_KEY')` and
  documentation.

## Deliberate-break check (per `.windsurf/test-discipline.md`)

Before declaring done, temporarily change
`menuExtractionHelpers.ts` so `validateExtractedItem` returns the
raw item even when the category is invalid (instead of dropping
it). Run
`npm test -- --testPathPattern="menuExtractionHelpers"`. The
"drops items with invalid category" test must fail with the
expected items.length being 1 but actually 2. Revert.

## Smoke tests (after server-first deploy + OTA)

1. **Secret + kill-switch correctly gate the call** — before
   creating the Anthropic secret OR if `aiFeatures/menuExtraction`
   has `enabled: false`, tap "Scan rate-list" → after picking a
   photo, the call should reject with a friendly message. Set
   `enabled: true`, retry: the call goes through.
2. **End-to-end happy path** — shop owner taps "📸 Scan rate-list"
   → picks a clear photo of a typed rate-list (test with one of
   your family-tester shops' actual lists if possible, otherwise
   any printed Indian grocery price list) → review screen shows
   30–80 items. Confidence chips render where applicable. Toggle
   a few off, edit a couple of prices, tap "Add N items to menu".
   Toast: "✓ Added N items." Navigate back; ShopMenuScreen
   refetches and shows the new items.
3. **Per-shop daily quota** — run extraction 5 times in one day
   on the same shop. The 6th attempt rejects with
   "Daily limit reached (5 scans). Try again tomorrow." Don't
   actually do this 5 times in normal testing — manually set
   `aiQuotas/{uid}_{today}.menuExtraction = 5` in Firestore
   console and test the 6th attempt.
4. **Audit log entries land** — after each successful extraction,
   check `aiAuditLog/` in Firestore. Each entry has uid, shopId,
   feature: 'menuExtraction', inputTokens, outputTokens,
   costInr, itemsExtracted, droppedCount, timestamp.
5. **Image too large rejection** — try a 3 MB+ photo. Client
   should resize via `expo-image-manipulator` and succeed, but
   if you bypass the resize (e.g. uploading a hi-res photo
   directly), the server's `MAX_IMAGE_BYTES` cap rejects with a
   clear message.
6. **Bad input handling** — scan a photo of something that
   ISN'T a rate-list (e.g. a person's face). Claude should return
   an empty `items: []` array or a list of zero items. The
   review screen handles "AI found 0 items — try a clearer photo
   of your rate-list" gracefully (don't crash).
7. **No Sentry events on the happy path.** Failed Claude calls
   log to function logs but should NOT capture in Sentry —
   they're expected user-facing errors, not bugs.
8. **No `ANTHROPIC_API_KEY` leakage.** Confirm the key is NOT in
   the mobile bundle by grepping `npx expo export` output (or
   the Sentry release artifacts) for `sk-ant-` /
   `ANTHROPIC_API_KEY`. Should be zero matches.
9. **Cost sanity** — after Test 2's extraction, `aiAuditLog/`
   shows `costInr` around ₹0.3–₹0.5 per scan for a typical
   rate-list (5–80 SKUs). If you see ₹5+ per scan, something is
   wrong (probably the wrong model or runaway token output).
10. **TypeScript clean** — `npx tsc --noEmit` shows zero errors
    across `root` and `functions`.

## Deploy plan

Server-first with one new secret to create manually.

```powershell
$env:NODE_OPTIONS = "--use-system-ca"

# 1. Audit + tests (unit only — no rules changed).
npm test

# 2. Create the Anthropic API key Firebase Functions secret.
#    (Manual step — Sudhir runs once.)
#    Generate the key at https://console.anthropic.com/settings/keys
#    Then:
firebase functions:secrets:set ANTHROPIC_API_KEY
#    Prompts for the value; paste the sk-ant-... token. The CLI
#    writes it to Google Secret Manager scoped to the project.
#    Verify with: firebase functions:secrets:access ANTHROPIC_API_KEY
#    (should print the token; don't paste this command's output).

# 3. Create the kill-switch doc.
#    In Firebase Console → Firestore → start a new document at
#    aiFeatures/menuExtraction with field `enabled: true (boolean)`.
#    Or via gcloud:
#    (Skip if Windsurf added a one-shot script to create it.)

# 4. Build functions.
cd functions
npm run build
cd ..

# 5. Deploy the two new functions, one per command (deploy
#    discipline Rule 1).
firebase deploy --only functions:extractMenuFromImage
firebase deploy --only functions:addExtractedMenuItems
firebase functions:list | Select-String -Pattern "(extractMenuFromImage|addExtractedMenuItems)"
# Both should appear.

# 6. Commit + push.
git add functions/package.json functions/package-lock.json
git add functions/src/aiHelpers.ts
git add functions/src/menuExtractionHelpers.ts
git add functions/src/index.ts
git add src/services/orderService.ts
git add src/types/index.ts
git add src/screens/shop/ScanMenuScreen.tsx
git add src/screens/shop/ShopMenuScreen.tsx
git add src/navigation/AppNavigator.tsx
git add tests/functions/menuExtractionHelpers.test.ts
git add PRELAUNCH_CHECKLIST.md
git add docs/pr-32-ai-photo-to-catalog-windsurf-prompt.md
git commit -m "PR 32: AI photo-to-catalog (Claude Sonnet vision extraction of shop rate-lists)"
git push origin main

# 7. Client OTA.
eas update --branch production --message "PR 32 - AI photo-to-catalog"
```

**No native rebuild.** All AI lives in `functions/`. The client
just calls callables.

**Pre-flight reminder for Sudhir:** the `ANTHROPIC_API_KEY` secret
MUST be created before step 5 (or the first `extractMenuFromImage`
invocation will fail with `Secret ANTHROPIC_API_KEY not found`).
Loud failure on first call — easy to diagnose if it slips through.

## Estimated time

~4–6 hours Windsurf work:

- Part 1 (`aiHelpers.ts`): 30 min
- Part 2 (`menuExtractionHelpers.ts` + system prompt): 45 min
- Part 3 (`extractMenuFromImage` callable): 45 min
- Part 4 (`addExtractedMenuItems` callable): 30 min
- Part 5 (`orderService.ts` wrappers): 15 min
- Part 6 (types): 10 min
- Part 7 (`ScanMenuScreen` wizard — biggest piece): 1.5–2 hr
- Part 8 (wire button + navigator): 15 min
- Part 9 (tests, 8 cases): 30 min
- Part 10 (PRELAUNCH_CHECKLIST): 10 min
- Deliberate-break + final test run: 15 min

Plus ~15 min of Sudhir's terminal time for the Anthropic secret +
the kill-switch doc.

## Why this PR matters

Phase A2 exists because **getting shops onto the platform is the
single biggest predictor of whether Kirana Mart works.** A
beautiful app with no shops is a museum. The bottleneck in shop
onboarding isn't legal paperwork or admin approval — it's the
4-hour evening when a shop owner has to type 60 SKUs into a form
while their kid does homework.

PR 32 collapses that 4 hours into 15 minutes of review. At
~₹0.5 per scan, the unit economics are nonsense in our favor —
shop acquisition cost dominated by everything except the AI cost.

PR 32 is also the **architectural commitment to AI as a Kirana
Mart capability**, not a one-off feature. Every Phase C PR
(44–49) — customer shopping assistant, auto-replenishment,
recommendations, review summarization, support assistant, AI
search — imports from the same `aiHelpers.ts` substrate. The
audit log, kill switch, cost estimator, retry policy are all
established here once. The cost of every later AI PR drops to
"write the prompt + the typed response shape."

PR 33 builds on this with the master product catalog. PR 34 adds
voice. By the end of Phase A2, Kirana Mart has the most
shop-friendly onboarding flow in Indian grocery — by a wide
margin, because the players who got there first don't have LLM
vision baked in and retrofitting it is harder than building with
it.

This is the PR where the "we're building this with AI from day
one" claim becomes real.
