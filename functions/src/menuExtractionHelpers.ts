/**
 * PR 32 — pure helpers for menu extraction.
 *
 * Two responsibilities, both pure:
 *   1. Build the Claude system prompt with the 10 canonical
 *      CategoryIds embedded as the enum the model must pick from.
 *      Built as a constant export so prompt regressions are
 *      diff-visible in PR review.
 *   2. Parse Claude's response text into validated
 *      `ExtractedItem[]`. Drops items that fail schema validation
 *      (unknown category, missing name/packSize, etc.) and returns
 *      a `droppedCount` so the callable can log it without
 *      surfacing un-actionable rows to the shop owner.
 *
 * No SDK calls. No Firestore. No `firebase-admin` / `firebase-
 * functions` imports. Unit-tested in isolation; the callable
 * (`extractMenuFromImage` in `index.ts`) wires these together with
 * the auth gate + quota + Claude call.
 */
import { VALID_CATEGORIES } from './categoryConstants';

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

export const MENU_EXTRACTION_USER_PROMPT =
  'Extract every visible product from this rate-list/shelf photo into the specified JSON format. Be exhaustive.';

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
 * Parse Claude's response text into validated `ExtractedItem[]`.
 *
 * Returns `droppedCount` for items that failed validation — these
 * are logged but not returned to the client (avoids surfacing
 * malformed rows the user can't action).
 *
 * Strict on shape but permissive on minor issues:
 *   - mrp < sellPrice → keep, the client review step lets the user
 *     swap them (common Claude mistake when prices are unclear).
 *   - confidence missing → default to 'medium'.
 *   - category not in enum → drop the item (worth dropping rather
 *     than miscategorising, which corrupts the shop's menu).
 *   - leading/trailing whitespace + accidental ```json fences are
 *     stripped before JSON.parse.
 */
export function parseExtractionResponse(
  rawText: string,
): ExtractionParseResult {
  let json = rawText.trim();
  if (json.startsWith('```')) {
    json = json.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  }
  let parsed: { items?: ExtractedItemRaw[] };
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    return {
      ok: false,
      reason: `JSON parse failed: ${(e as Error).message}`,
    };
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
  if (typeof raw.packSize !== 'string' || !raw.packSize.trim()) {
    return null;
  }
  if (
    typeof raw.category !== 'string' ||
    !VALID_CATEGORIES.has(raw.category)
  ) {
    return null;
  }
  const mrp = coerceOptionalPositiveNumber(raw.mrp);
  const sellPrice = coerceOptionalPositiveNumber(raw.sellPrice);
  const confidence: ExtractedItem['confidence'] =
    raw.confidence === 'high' ||
    raw.confidence === 'medium' ||
    raw.confidence === 'low'
      ? raw.confidence
      : 'medium';
  const brand =
    typeof raw.brand === 'string' && raw.brand.trim()
      ? raw.brand.trim()
      : null;
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

function coerceOptionalPositiveNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'number') return null;
  if (!Number.isFinite(v)) return null;
  if (v <= 0) return null;
  return v;
}
