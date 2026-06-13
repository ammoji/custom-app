/**
 * PR-NEXT-BUNDLE-L §F — pure helper for merging the per-page price
 * results returned by the `extractCatalogPagePrices` callable into a
 * single deduplicated list, ready to build `PriceDraft[]` for the
 * CatalogReviewScreen.
 *
 * Why dedup: the multi-photo flow lets a shopkeeper accidentally
 * photograph the same page twice (very common — they re-snap a
 * blurry page without removing the first). Without dedup the same
 * product would appear twice in review. We keep the HIGHER-confidence
 * reading; on a tie the FIRST occurrence wins (stable, so re-running
 * the same scan is deterministic).
 *
 * Pure — no React, no network. Unit-tested in isolation.
 */

export type ScanConfidence = 'high' | 'medium' | 'low';

export type ScannedPriceRow = {
  productId: string;
  sellPrice: number;
  confidence: ScanConfidence;
};

export type ScannedPage = {
  prices: ScannedPriceRow[];
  droppedCount: number;
};

export type MergedScanResult = {
  merged: { productId: string; sellPrice: number }[];
  totalDropped: number;
  duplicates: number;
};

const CONFIDENCE_RANK: Record<ScanConfidence, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

/**
 * Merge per-page scan results. Later/lower-confidence readings of a
 * productId already seen are dropped (counted in `duplicates`); a
 * strictly-higher-confidence later reading REPLACES the earlier one
 * (still counted as a duplicate, since two readings collapsed to one).
 */
export function mergeScannedPrices(
  pages: readonly ScannedPage[],
): MergedScanResult {
  const byId = new Map<string, ScannedPriceRow>();
  let totalDropped = 0;
  let duplicates = 0;

  for (const page of pages) {
    totalDropped += page.droppedCount ?? 0;
    for (const row of page.prices ?? []) {
      const existing = byId.get(row.productId);
      if (!existing) {
        byId.set(row.productId, row);
        continue;
      }
      // Seen before → it's a duplicate regardless of which we keep.
      duplicates += 1;
      if (CONFIDENCE_RANK[row.confidence] > CONFIDENCE_RANK[existing.confidence]) {
        byId.set(row.productId, row);
      }
    }
  }

  const merged = [...byId.values()].map(r => ({
    productId: r.productId,
    sellPrice: r.sellPrice,
  }));

  return { merged, totalDropped, duplicates };
}
