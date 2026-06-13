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

// ──────────────────────────────────────────────────────────────
// PR-NEXT-BUNDLE-L §B/§F — catalog page (paper workflow) extraction
// ──────────────────────────────────────────────────────────────
//
// Unlike `MENU_EXTRACTION_SYSTEM_PROMPT` (freeform rate-list →
// ExtractedItem[]), this prompt reads a HamaraSetu-generated catalog
// page where the products are PRE-PRINTED with known names + a
// machine-readable "Item ID". The model's only job is to read the
// handwritten "Your price" box per row and pair it with that row's
// printed Item ID. Output is `{productId, sellPrice}` pairs, NOT
// freeform items — so we never re-create products, only price them.

export const CATALOG_PAGE_EXTRACTION_SYSTEM_PROMPT = `
You are reading a single photographed page of a pre-printed product
catalog for an Indian kirana (corner-store). The page was generated
by the HamaraSetu app. Every row has:

  - a row number
  - a pre-printed product name (brand · pack)
  - a pre-printed MRP (reference only, prefixed "Rs.")
  - a BLANK box labelled "Your price" where the shopkeeper has
    handwritten the price they sell that item for (or left it blank)
  - a small grey line "Item ID (do not edit): <ID>" beneath the name

Your job: for EACH row where the shopkeeper has written a price in
the "Your price" box, output the row's Item ID and the handwritten
price. The product names are already known — DO NOT re-read or
re-transcribe them. Read ONLY the handwritten price and the printed
Item ID.

OUTPUT FORMAT (strict — no other text, no markdown fences):

{
  "prices": [
    { "productId": "<the Item ID exactly as printed>", "sellPrice": <number in INR>, "confidence": "high" | "medium" | "low" }
  ]
}

RULES:
- If the "Your price" box is BLANK / empty for a row, OMIT that row
  entirely. A blank box means "I don't sell this item" — never
  guess or fall back to the printed MRP.
- "sellPrice" is the handwritten number only. Convert Devanagari
  numerals (०-९) to Western digits.
- "productId" MUST be copied exactly from that row's "Item ID" line.
  Never invent an ID. If the Item ID is illegible, omit the row.
- "confidence" = "low" if the handwriting is hard to read or the
  digits are ambiguous; "high" only when the price is clearly legible.
- Ignore the printed MRP, the row numbers, the page header, the
  footer note, and the QR code. They are not prices to extract.

Return ONLY the JSON object. No surrounding prose, no \`\`\`json fences.
`.trim();

export const CATALOG_PAGE_EXTRACTION_USER_PROMPT =
  'Read the handwritten "Your price" box for each row on this catalog page and pair it with that row\'s printed Item ID. Omit rows with a blank price box. Return the specified JSON.';

export type ParsedPrice = {
  productId: string;
  sellPrice: number;
  confidence: 'high' | 'medium' | 'low';
};

export type CatalogPriceParseResult =
  | { ok: true; prices: ParsedPrice[]; droppedCount: number }
  | { ok: false; reason: string };

// Upper bound on a plausible kirana sell price. A row OCR'd above
// this is almost certainly a misread (e.g. "550" → "550000" when a
// stray mark joins digits), so we drop it rather than commit a
// nonsense price to the shop's menu.
const MAX_PLAUSIBLE_SELL_PRICE = 100_000;

/**
 * Normalise Devanagari digits (०-९ / U+0966–U+096F) to Western
 * digits so "५२५" parses as 525. Leaves all other characters
 * untouched. Pure.
 */
export function normalizeDevanagariDigits(input: string): string {
  let out = '';
  for (const ch of input) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x0966 && code <= 0x096f) {
      out += String(code - 0x0966);
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * Parse Claude's catalog-page response into validated
 * `{productId, sellPrice}` pairs.
 *
 * Validation (each failing row increments `droppedCount`, never
 * throws — a single bad row must not sink the whole page):
 *   - productId must be a non-empty string AND present in
 *     `allowedProductIds` (the QR payload's product list, or all
 *     approved products when no QR). Drops a model-hallucinated or
 *     wrong-page ID — it can never write to a product the page
 *     didn't actually contain.
 *   - sellPrice is coerced through Devanagari-digit normalisation;
 *     dropped if non-numeric, ≤ 0, or > MAX_PLAUSIBLE_SELL_PRICE.
 *   - confidence defaults to 'medium' when missing/garbage.
 *   - duplicate productIds keep the FIRST occurrence (stable).
 *
 * Returns `{ ok:false }` only when the envelope itself is malformed
 * (not JSON, or missing `prices[]`).
 */
export function parseCatalogPagePrices(
  rawText: string,
  allowedProductIds: ReadonlyArray<string>,
): CatalogPriceParseResult {
  let json = rawText.trim();
  if (json.startsWith('```')) {
    json = json.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  }
  let parsed: { prices?: unknown };
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    return { ok: false, reason: `JSON parse failed: ${(e as Error).message}` };
  }
  if (!parsed || !Array.isArray((parsed as { prices?: unknown }).prices)) {
    return { ok: false, reason: 'Response missing prices[] array' };
  }

  const allowed = new Set(allowedProductIds);
  const seen = new Set<string>();
  const prices: ParsedPrice[] = [];
  let droppedCount = 0;

  for (const raw of (parsed as { prices: unknown[] }).prices) {
    const row = raw as { productId?: unknown; sellPrice?: unknown; confidence?: unknown };
    const productId =
      typeof row.productId === 'string' ? row.productId.trim() : '';
    if (!productId || !allowed.has(productId) || seen.has(productId)) {
      droppedCount += 1;
      continue;
    }
    const sellPrice = coerceSellPrice(row.sellPrice);
    if (sellPrice === null) {
      droppedCount += 1;
      continue;
    }
    const confidence: ParsedPrice['confidence'] =
      row.confidence === 'high' ||
      row.confidence === 'medium' ||
      row.confidence === 'low'
        ? row.confidence
        : 'medium';
    seen.add(productId);
    prices.push({ productId, sellPrice, confidence });
  }

  return { ok: true, prices, droppedCount };
}

function coerceSellPrice(v: unknown): number | null {
  let n: number;
  if (typeof v === 'number') {
    n = v;
  } else if (typeof v === 'string') {
    const normalized = normalizeDevanagariDigits(v).replace(/[^\d.]/g, '');
    if (!normalized) return null;
    n = parseFloat(normalized);
  } else {
    return null;
  }
  if (!Number.isFinite(n) || n <= 0 || n > MAX_PLAUSIBLE_SELL_PRICE) {
    return null;
  }
  return Math.round(n);
}
