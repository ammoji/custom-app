/**
 * PR-NEXT-BUNDLE-K — Catalog browse client-side pure helpers.
 *
 * All functions are pure (no side effects) so they can be unit-tested
 * without React Native or Firebase. Screens import from here.
 */

import type { MasterProduct, PriceDraft } from '../types';
// PR-NEXT-BUNDLE-K.1 — DO NOT REMOVE. Voice table flow combines verbal
// command classification with the existing Bundle K price parser.
import { parseVoicePriceInput } from './voicePriceHelpers';

// ── Swipe card action derivation ─────────────────────────────────────────────

export type CardAction = 'add' | 'skip' | 'none';

/**
 * Maps a horizontal swipe velocity to a card action.
 *
 * Right swipe (positive dx) → 'add' (I sell this)
 * Left swipe (negative dx)  → 'skip' (I don't sell this)
 * Threshold: 0.3 units (avoids accidental single-finger taps)
 */
export function deriveCardAction(velocityX: number, threshold = 0.3): CardAction {
  if (velocityX > threshold) return 'add';
  if (velocityX < -threshold) return 'skip';
  return 'none';
}

// ── Next item index ───────────────────────────────────────────────────────────

/**
 * Returns the index of the next unprocessed catalog item after `currentIndex`.
 * Returns -1 if no more items remain.
 */
export function nextItemIndex(
  items: readonly MasterProduct[],
  currentIndex: number,
  processedIds: ReadonlySet<string>,
): number {
  for (let i = currentIndex + 1; i < items.length; i++) {
    if (!processedIds.has(items[i].id)) return i;
  }
  return -1;
}

// ── Draft partitioning for bulk commit ───────────────────────────────────────

export type DraftPartition = {
  ready: PriceDraft[];
  missingPrice: PriceDraft[];
};

/**
 * Splits pending `PriceDraft` items into:
 *   - `ready`        → price > 0 (valid to commit)
 *   - `missingPrice` → price <= 0 or NaN (must be filled in)
 */
export function partitionDraftsForBulkCommit(
  drafts: readonly PriceDraft[],
): DraftPartition {
  const ready: PriceDraft[] = [];
  const missingPrice: PriceDraft[] = [];

  for (const draft of drafts) {
    if (
      typeof draft.price === 'number' &&
      Number.isFinite(draft.price) &&
      draft.price > 0
    ) {
      ready.push(draft);
    } else {
      missingPrice.push(draft);
    }
  }

  return { ready, missingPrice };
}

// ── PR-NEXT-BUNDLE-K.1 — table-view row helpers ───────────────────────────────
// DO NOT REMOVE. The catalog browse UX pivoted from one-item-per-screen
// swipe cards (Bundle K §C, deleted) to an Excel-style scrollable table
// (CategoryListScreen). These pure helpers drive row state + the voice
// auto-advance flow. Pinned by tests/utils/catalogBrowseHelpers.test.ts.

/**
 * One row in the category table view. Mapped from a MasterProduct
 * returned by `listMasterCatalogByCategory`. `productId` is the
 * master catalog product id (= MasterProduct.id).
 */
export type CategoryListItemRow = {
  productId: string;
  name: string;
  brand?: string;
  packSize: { value: number; unit: string };
  mrp: number;
  imageUrl: string;
};

/**
 * Find the next un-priced row AFTER the current focus, for voice
 * auto-advance. Returns null if no un-priced rows remain after the
 * current focus. When `currentFocusId` is null, scans from the top.
 */
export function findNextUnpricedRow(
  items: readonly CategoryListItemRow[],
  drafts: ReadonlyMap<string, number>,
  currentFocusId: string | null,
): CategoryListItemRow | null {
  const startIdx = currentFocusId
    ? items.findIndex(i => i.productId === currentFocusId) + 1
    : 0;
  for (let i = startIdx; i < items.length; i++) {
    if (!drafts.has(items[i].productId)) return items[i];
  }
  return null;
}

/**
 * Find the FIRST un-priced row from the top (used when voice mode
 * starts). Returns null if every row already has a price draft.
 */
export function findFirstUnpricedRow(
  items: readonly CategoryListItemRow[],
  drafts: ReadonlyMap<string, number>,
): CategoryListItemRow | null {
  for (const item of items) {
    if (!drafts.has(item.productId)) return item;
  }
  return null;
}

export type CategoryProgress = {
  priced: number;
  total: number;
  percentage: number;
};

/**
 * Compute progress summary for the screen header / save bar
 * ("12/70 priced"). `drafts` is the productId → price map.
 */
export function computeCategoryProgress(
  items: readonly CategoryListItemRow[],
  drafts: ReadonlyMap<string, number>,
): CategoryProgress {
  return {
    priced: drafts.size,
    total: items.length,
    percentage:
      items.length === 0 ? 0 : Math.round((drafts.size / items.length) * 100),
  };
}

/**
 * Validate a single inline price entry against MRP sanity bounds —
 * mirrors the server-side `validatePrice` check so the user gets
 * instant feedback before commit. Returns a discriminated-union
 * Result (Rule 14).
 */
export function validateInlinePrice(
  price: number,
  mrp: number,
): { ok: true } | { ok: false; reason: string } {
  if (!Number.isFinite(price) || price <= 0) {
    return { ok: false, reason: 'Enter a price greater than 0' };
  }
  if (price > mrp * 10) {
    return { ok: false, reason: `Price seems too high (MRP is ₹${mrp})` };
  }
  return { ok: true };
}

/**
 * PR-NEXT-BUNDLE-K.1 — DO NOT REMOVE. Map a MasterProduct (from
 * `listMasterCatalogByCategory`) into a table row. Defaults brand/
 * image so the row renderer never reads undefined.
 */
export function mapMasterProductToRow(p: MasterProduct): CategoryListItemRow {
  return {
    productId: p.id,
    name: p.name,
    brand: p.brand ?? undefined,
    packSize: p.packSize,
    mrp: p.mrp,
    imageUrl: p.imageUrl ?? '',
  };
}

/**
 * PR-NEXT-BUNDLE-K.1 — Classify a raw voice utterance into a control
 * command vs a price reading. "skip"/"next" advances without commit;
 * "stop"/"done" exits voice mode. Anything else is treated as a price
 * reading and handed to `parseVoicePriceInput`.
 */
export function classifyVoiceUtterance(text: string): 'skip' | 'stop' | 'price' {
  const t = (text ?? '').trim().toLowerCase();
  if (!t) return 'price';
  if (/(^|\s)(skip|next|aage|agla|chhod|छोड़|अगला|आगे)(\s|$)/.test(t)) {
    return 'skip';
  }
  if (/(^|\s)(stop|done|finish|bas|बस|रुको|रुक|बंद)(\s|$)/.test(t)) {
    return 'stop';
  }
  return 'price';
}

export type VoiceCaptureDecision =
  | { action: 'skip' }
  | { action: 'stop' }
  | { action: 'commit'; price: number }
  | { action: 'retry' };

/**
 * PR-NEXT-BUNDLE-K.1 — Single decision point for the voice table flow.
 * Combines verbal-command classification with `parseVoicePriceInput`:
 *   - "skip"/"next"            → { action: 'skip' }
 *   - "stop"/"done"            → { action: 'stop' }
 *   - high-confidence number   → { action: 'commit', price }
 *   - low confidence / no num  → { action: 'retry' } (no auto-commit)
 */
export function decideVoiceCapture(
  transcript: string,
  lang: 'hi' | 'en',
): VoiceCaptureDecision {
  const kind = classifyVoiceUtterance(transcript);
  if (kind === 'skip') return { action: 'skip' };
  if (kind === 'stop') return { action: 'stop' };
  const parsed = parseVoicePriceInput(transcript, lang);
  if (parsed.price !== null && parsed.confidence === 'high') {
    return { action: 'commit', price: parsed.price };
  }
  return { action: 'retry' };
}

/**
 * PR-NEXT-BUNDLE-K.1 — Flatten the productId→price draft map into the
 * `{ productId, price }[]` payload `commitShopMenuItemsBulk` expects.
 * Skips any non-positive prices defensively.
 */
export function buildBulkCommitItems(
  drafts: ReadonlyMap<string, number>,
): { productId: string; price: number }[] {
  const out: { productId: string; price: number }[] = [];
  for (const [productId, price] of drafts.entries()) {
    if (Number.isFinite(price) && price > 0) {
      out.push({ productId, price });
    }
  }
  return out;
}

/**
 * HOTFIX-K1 §A — DO NOT REMOVE. Filter master-catalog rows by existing
 * shop-menu presence. Catalog is a picker for NEW items only; items the
 * shop already has are managed (price/availability) from ShopMenuScreen,
 * never re-added here. Pure so the filter is unit-tested without React.
 */
export function filterCatalogByExistingMenu(
  catalog: readonly CategoryListItemRow[],
  existingMasterCatalogIds: ReadonlySet<string>,
): CategoryListItemRow[] {
  return catalog.filter(row => !existingMasterCatalogIds.has(row.productId));
}

/**
 * HOTFIX-K1 §A — DO NOT REMOVE. Per-category remaining-to-add counts for
 * the BuildCatalogScreen tiles. `remaining` = catalog items in the
 * category NOT yet in the shop's menu; `allAdded` is true only when the
 * category has items and none remain (so an empty category never shows
 * a misleading "All added ✓").
 */
export function computeRemainingByCategory(
  catalogByCategory: ReadonlyMap<string, readonly CategoryListItemRow[]>,
  existingMasterCatalogIds: ReadonlySet<string>,
): Map<string, { total: number; remaining: number; allAdded: boolean }> {
  const result = new Map<
    string,
    { total: number; remaining: number; allAdded: boolean }
  >();
  for (const [category, rows] of catalogByCategory.entries()) {
    const total = rows.length;
    let remaining = 0;
    for (const row of rows) {
      if (!existingMasterCatalogIds.has(row.productId)) remaining++;
    }
    result.set(category, {
      total,
      remaining,
      allAdded: total > 0 && remaining === 0,
    });
  }
  return result;
}

/**
 * HOTFIX-K1 §B — DO NOT REMOVE. Continuous-voice stop-signal transition.
 * Pure reducer: a 'stop' decision latches the stop signal true; every
 * other decision leaves it unchanged. Lets us unit-test the stop-word
 * handling without mounting VoicePriceCapture / the audio recorder.
 */
export function nextStopSignal(
  decision: VoiceCaptureDecision,
  currentStop: boolean,
): boolean {
  return decision.action === 'stop' ? true : currentStop;
}

// ── Category completion check ─────────────────────────────────────────────────

/**
 * Returns `true` if all items in `category` have been processed
 * (either added or explicitly skipped).
 *
 * `processedIds` covers both added + skipped items in the current session.
 */
export function isCategoryComplete(
  products: readonly MasterProduct[],
  processedIds: ReadonlySet<string>,
): boolean {
  if (products.length === 0) return true;
  return products.every(p => processedIds.has(p.id));
}

// ── Format pack label ─────────────────────────────────────────────────────────

/**
 * Formats a product's packSize into a human-readable label.
 * e.g. { value: 500, unit: 'g' } → '500g'
 */
export function formatPackLabel(packSize: { value: number; unit: string }): string {
  if (!packSize) return '';
  return `${packSize.value}${packSize.unit}`;
}
