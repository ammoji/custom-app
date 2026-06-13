/**
 * PR-NEXT-BUNDLE-K — Catalog browse client-side pure helpers.
 *
 * All functions are pure (no side effects) so they can be unit-tested
 * without React Native or Firebase. Screens import from here.
 */

import type { MasterProduct, PriceDraft } from '../types';

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

// ── Onboarding progress computation ──────────────────────────────────────────

export type CategoryProgress = {
  total: number;
  done: number;
  pct: number;
};

/**
 * Computes per-category onboarding progress from the set of
 * product IDs already added to the shop's menu.
 *
 * `addedProductIds` — product IDs already in the shop's menu.
 * `catalogByCategory` — all approved products keyed by category.
 */
export function computeCategoryProgress(
  addedProductIds: ReadonlySet<string>,
  catalogByCategory: Record<string, readonly MasterProduct[]>,
): Record<string, CategoryProgress> {
  const result: Record<string, CategoryProgress> = {};
  for (const [category, products] of Object.entries(catalogByCategory)) {
    const total = products.length;
    let done = 0;
    for (const p of products) {
      if (addedProductIds.has(p.id)) done++;
    }
    result[category] = {
      total,
      done,
      pct: total > 0 ? Math.round((done / total) * 100) : 0,
    };
  }
  return result;
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
