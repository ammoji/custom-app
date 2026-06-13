/**
 * PR-NEXT-BUNDLE-K — Catalog onboarding server-side pure helpers.
 *
 * All functions here are pure (no Firestore reads) so they can be
 * unit-tested without the Firebase emulator. The callable shells in
 * index.ts own the Firestore I/O; these helpers own the business
 * logic + validation.
 */

// PR-NEXT-BUNDLE-K — DO NOT REMOVE. CategoryId is inlined here rather
// than imported from `../../src/constants/categories` because cross-
// boundary imports widen tsc rootDir → compiled output lands at
// lib/functions/src/index.js instead of lib/index.js, which Firebase
// can't find. The two definitions must be kept in sync manually until
// a shared types package exists; if categories change in src/constants,
// update this list too. Source: src/constants/categories.ts.
type CategoryId =
  | 'atta_rice_dal'
  | 'oil_ghee'
  | 'dairy_eggs'
  | 'bakery'
  | 'masala_spices'
  | 'snacks_biscuits'
  | 'beverages'
  | 'personal_care'
  | 'household'
  | 'fruits_vegetables';

// ── Shared types ────────────────────────────────────────────────────────────

export type ProductStatus = 'approved' | 'pending' | 'rejected';

export type MasterProductDoc = {
  id: string;
  name: string;
  brand?: string | null;
  category: CategoryId;
  packSize: { value: number; unit: string };
  mrp: number;
  imageUrl?: string | null;
  status: ProductStatus;
  proposedBy?: string | null;
  proposedAt?: number | null;
  reviewedAt?: number | null;
  reviewedBy?: string | null;
  rejectionReason?: string | null;
};

export type ShopMenuItemDoc = {
  productId: string | null;
  name: string;
  imageUrl: string;
  packLabel: string;
  category: CategoryId;
  price: number;
  mrp: number;
  available: boolean;
  stock: number | null;
  isCustom: boolean;
  shopId: string;
  createdAt: number;
  updatedAt: number;
  deletedAt: null;
};

export type CommitItemInput = {
  productId: string;
  price: number;
};

// ── Validation constants ─────────────────────────────────────────────────────

const MIN_PRICE = 1;
const MAX_PRICE = 99999;
const MAX_BULK_ITEMS = 100;
const MAX_PROPOSAL_NAME_LEN = 120;
const MAX_PROPOSAL_BRAND_LEN = 60;

// ── Price validation ─────────────────────────────────────────────────────────

export type PriceValidationResult =
  | { ok: true }
  | { ok: false; code: 'below_min' | 'above_max' | 'not_finite' | 'not_positive' };

export function validatePrice(price: unknown): PriceValidationResult {
  if (typeof price !== 'number' || !Number.isFinite(price)) {
    return { ok: false, code: 'not_finite' };
  }
  if (price <= 0) return { ok: false, code: 'not_positive' };
  if (price < MIN_PRICE) return { ok: false, code: 'below_min' };
  if (price > MAX_PRICE) return { ok: false, code: 'above_max' };
  return { ok: true };
}

// ── Bulk commit partitioning ─────────────────────────────────────────────────

export type BulkCommitPartition = {
  valid: CommitItemInput[];
  skipped: Array<CommitItemInput & { reason: string }>;
  tooLarge: boolean;
};

export function partitionBulkCommitItems(
  items: unknown[],
): BulkCommitPartition {
  if (!Array.isArray(items)) {
    return { valid: [], skipped: [], tooLarge: false };
  }
  const tooLarge = items.length > MAX_BULK_ITEMS;
  const slice = tooLarge ? items.slice(0, MAX_BULK_ITEMS) : items;
  const valid: CommitItemInput[] = [];
  const skipped: Array<CommitItemInput & { reason: string }> = [];

  for (const item of slice) {
    const raw = item as Record<string, unknown>;
    const productId =
      typeof raw?.productId === 'string' ? raw.productId.trim() : '';
    const price = raw?.price;

    if (!productId) {
      skipped.push({ productId, price: 0, reason: 'missing_product_id' });
      continue;
    }
    const priceResult = validatePrice(price);
    if (!priceResult.ok) {
      skipped.push({
        productId,
        price: typeof price === 'number' ? price : 0,
        reason: priceResult.code,
      });
      continue;
    }
    valid.push({ productId, price: price as number });
  }
  return { valid, skipped, tooLarge };
}

// ── Catalog proposal validation ──────────────────────────────────────────────

export type ProposalValidationResult =
  | { ok: true }
  | {
      ok: false;
      code:
        | 'name_required'
        | 'name_too_long'
        | 'brand_too_long'
        | 'category_invalid'
        | 'mrp_invalid'
        | 'pack_size_invalid';
    };

const VALID_CATEGORIES: ReadonlySet<string> = new Set([
  'atta_rice_dal',
  'oil_ghee',
  'dairy_eggs',
  'bakery',
  'masala_spices',
  'snacks_biscuits',
  'beverages',
  'personal_care',
  'household',
  'fruits_vegetables',
]);

export function validateMasterCatalogProposal(input: {
  name?: unknown;
  brand?: unknown;
  category?: unknown;
  mrp?: unknown;
  packSizeValue?: unknown;
  packSizeUnit?: unknown;
}): ProposalValidationResult {
  const { name, brand, category, mrp, packSizeValue, packSizeUnit } = input;

  if (typeof name !== 'string' || name.trim().length === 0) {
    return { ok: false, code: 'name_required' };
  }
  if (name.trim().length > MAX_PROPOSAL_NAME_LEN) {
    return { ok: false, code: 'name_too_long' };
  }
  if (brand !== undefined && brand !== null) {
    if (typeof brand !== 'string' || brand.trim().length > MAX_PROPOSAL_BRAND_LEN) {
      return { ok: false, code: 'brand_too_long' };
    }
  }
  if (typeof category !== 'string' || !VALID_CATEGORIES.has(category)) {
    return { ok: false, code: 'category_invalid' };
  }
  if (typeof mrp !== 'number' || !Number.isFinite(mrp) || mrp <= 0 || mrp > MAX_PRICE) {
    return { ok: false, code: 'mrp_invalid' };
  }
  if (
    typeof packSizeValue !== 'number' ||
    !Number.isFinite(packSizeValue) ||
    packSizeValue <= 0
  ) {
    return { ok: false, code: 'pack_size_invalid' };
  }
  if (typeof packSizeUnit !== 'string' || packSizeUnit.trim().length === 0) {
    return { ok: false, code: 'pack_size_invalid' };
  }
  return { ok: true };
}

// ── Admin review validation ───────────────────────────────────────────────────

export type ReviewAction = 'approved' | 'rejected';

export type ReviewValidationResult =
  | { ok: true }
  | {
      ok: false;
      code: 'product_id_required' | 'invalid_action' | 'rejection_reason_required';
    };

export function validateCatalogReviewAction(input: {
  productId?: unknown;
  action?: unknown;
  rejectionReason?: unknown;
}): ReviewValidationResult {
  const { productId, action, rejectionReason } = input;
  if (typeof productId !== 'string' || productId.trim().length === 0) {
    return { ok: false, code: 'product_id_required' };
  }
  if (action !== 'approved' && action !== 'rejected') {
    return { ok: false, code: 'invalid_action' };
  }
  if (action === 'rejected') {
    if (typeof rejectionReason !== 'string' || rejectionReason.trim().length === 0) {
      return { ok: false, code: 'rejection_reason_required' };
    }
  }
  return { ok: true };
}

// ── Category page builder ────────────────────────────────────────────────────

export type CatalogPage = {
  items: MasterProductDoc[];
  hasMore: boolean;
  cursor: string | null;
};

export function buildCatalogPage(
  docs: MasterProductDoc[],
  pageSize: number,
): CatalogPage {
  const hasMore = docs.length > pageSize;
  const items = hasMore ? docs.slice(0, pageSize) : docs;
  const cursor =
    items.length > 0 ? items[items.length - 1].id : null;
  return { items, hasMore, cursor };
}

// ── Pending queue summary ────────────────────────────────────────────────────

export type PendingSummary = {
  total: number;
  byCategory: Record<string, number>;
  oldestProposedAt: number | null;
};

export function summarizePendingItems(docs: MasterProductDoc[]): PendingSummary {
  const byCategory: Record<string, number> = {};
  let oldestProposedAt: number | null = null;
  for (const doc of docs) {
    const cat = doc.category ?? 'unknown';
    byCategory[cat] = (byCategory[cat] ?? 0) + 1;
    if (
      typeof doc.proposedAt === 'number' &&
      (oldestProposedAt === null || doc.proposedAt < oldestProposedAt)
    ) {
      oldestProposedAt = doc.proposedAt;
    }
  }
  return { total: docs.length, byCategory, oldestProposedAt };
}

// ── Customer-side visibility predicate (§I) ──────────────────────────────────

/**
 * PR-NEXT-BUNDLE-K §I — mirrors the Firestore rule predicate for
 * public reads of `products/`: only `status === 'approved'` docs are
 * customer-visible. Server callables that build customer-facing
 * catalog projections filter through this so a pending/rejected
 * proposal can never leak into a customer browse surface even if a
 * query accidentally widens.
 */
export function isCustomerVisibleProduct(
  doc: Pick<MasterProductDoc, 'status'> | undefined | null,
): boolean {
  if (!doc) return false;
  return doc.status === 'approved';
}

/**
 * Filters a list of master products down to the customer-visible
 * (approved) subset, preserving order.
 */
export function filterCustomerVisibleProducts(
  docs: readonly MasterProductDoc[],
): MasterProductDoc[] {
  return docs.filter(d => isCustomerVisibleProduct(d));
}

// ── Menu item builder (from master product + price) ──────────────────────────

export function buildShopMenuItemFromMasterProduct(
  product: MasterProductDoc,
  shopId: string,
  price: number,
  nowMs: number,
): ShopMenuItemDoc {
  const packLabel =
    product.packSize
      ? `${product.packSize.value}${product.packSize.unit}`
      : '';
  return {
    productId: product.id,
    name: product.name,
    imageUrl: product.imageUrl ?? '',
    packLabel,
    category: product.category,
    price,
    mrp: product.mrp,
    available: true,
    stock: null,
    isCustom: false,
    shopId,
    createdAt: nowMs,
    updatedAt: nowMs,
    deletedAt: null,
  };
}
