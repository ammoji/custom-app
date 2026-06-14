/**
 * PR-NEXT-BUNDLE-M — pure publish-gate helper (SERVER copy).
 *
 * A shop is only visible to customers once it meets every
 * publish-readiness requirement: status active, menu has >= N items,
 * opening hours set, and a verified earth-coordinate location. This
 * module is the single source of truth for that decision; both the
 * `onShopMenuWrite` / `onShopUpdate` triggers and the
 * `recomputeShopPublishStatus` callable run it, and the client mirror
 * at `src/utils/shopPublishHelpers.ts` keeps the shop-owner banner
 * exactly in sync with the gate.
 *
 * Repo convention (see `geoVisibilityHelpers.ts` <->
 * `src/utils/geoVisibilityHelpers.ts`): the server owns the canonical
 * helper; the client keeps a same-shape copy because it can't import
 * from `functions/`. KEEP THE TWO FILES LOGICALLY IDENTICAL — the
 * function bodies are byte-for-byte the same; only this header comment
 * differs.
 *
 * Rule 5 fail-closed: every consumer treats a shop WITHOUT an explicit
 * `isPublishable === true` as NOT publishable. A backfill gap, a
 * partial write, or a brand-new shop reads as unpublishable, never as
 * accidentally-live.
 *
 * Pinned by `tests/functions/shopPublishHelpers.test.ts` (server) and
 * `tests/services/clientShopPublishHelpers.test.ts` (client mirror).
 */

export type PublishRequirementKey =
  | 'menu_items_below_minimum'
  | 'hours_not_set'
  | 'location_not_verified'
  | 'shop_status_not_active'
  | 'force_publish_off_and_above_active_required';

export type PublishGateInput = {
  shopStatus: 'active' | 'pending' | 'suspended' | string;
  menuItemCount: number;
  hoursOpen?: string | null;
  hoursClose?: string | null;
  location?: { lat?: number; lng?: number } | null;
  locationVerifiedAt?: number | null;
  forcePublishOverride?: boolean;
  // From appConfig/pilotConfig.minMenuItemsForPublish, default 5.
  minMenuItems: number;
};

export type PublishGateResult = {
  isPublishable: boolean;
  missing: PublishRequirementKey[];
  // For diagnostic + Sentry breadcrumb logging — not for client display.
  signal: 'force_override' | 'all_met' | 'missing_requirements';
};

/**
 * Earth-coordinate validity gate, mirroring
 * `validateShopLocationForApproval` (SHOP-LOCATION-REQUIRED Rule 14):
 * lat must be a finite number in [-90, 90], lng a finite number in
 * [-180, 180]. The range checks reject obviously-broken pins and the
 * subset of swapped lat/lng pairs where the longitude exceeds 90.
 *
 * NOTE: a same-hemisphere swap inside India (e.g. Faridabad 28.5/77.3
 * -> 77.3/28.5) lands both values back in range, so it is NOT caught
 * by coordinates alone — the `locationVerifiedAt` requirement in
 * `evaluateShopPublishStatus` is the backstop, since a quietly-swapped
 * pin was never admin-verified.
 */
function hasValidLocation(
  location: { lat?: number; lng?: number } | null | undefined,
): boolean {
  if (!location || typeof location !== 'object') return false;
  const { lat, lng } = location;
  if (typeof lat !== 'number' || !Number.isFinite(lat)) return false;
  if (lat < -90 || lat > 90) return false;
  if (typeof lng !== 'number' || !Number.isFinite(lng)) return false;
  if (lng < -180 || lng > 180) return false;
  return true;
}

function isBlank(value: string | null | undefined): boolean {
  return typeof value !== 'string' || value.trim().length === 0;
}

/**
 * Evaluate every publish gate and return the aggregate result.
 *
 * `forcePublishOverride === true` is the admin/test-shop escape hatch
 * (same pattern as PR 48 `showAllShops`): it short-circuits to
 * publishable regardless of any other failing gate.
 */
export function evaluateShopPublishStatus(
  input: PublishGateInput,
): PublishGateResult {
  if (input.forcePublishOverride === true) {
    return { isPublishable: true, missing: [], signal: 'force_override' };
  }

  const missing: PublishRequirementKey[] = [];

  if (input.shopStatus !== 'active') {
    missing.push('shop_status_not_active');
  }
  if (
    typeof input.menuItemCount !== 'number' ||
    input.menuItemCount < input.minMenuItems
  ) {
    missing.push('menu_items_below_minimum');
  }
  if (isBlank(input.hoursOpen) || isBlank(input.hoursClose)) {
    missing.push('hours_not_set');
  }
  if (
    !hasValidLocation(input.location) ||
    typeof input.locationVerifiedAt !== 'number' ||
    !Number.isFinite(input.locationVerifiedAt)
  ) {
    missing.push('location_not_verified');
  }

  const isPublishable = missing.length === 0;
  return {
    isPublishable,
    missing,
    signal: isPublishable ? 'all_met' : 'missing_requirements',
  };
}

/**
 * Rule 5 fail-closed read of the denormalized gate result. `undefined`
 * / `null` / anything-but-true reads as NOT publishable. UI + the
 * `listShopsPublic` filter both go through this so the default posture
 * is uniform.
 */
export function isShopPublishable(shop: {
  isPublishable?: boolean | null;
}): boolean {
  return shop.isPublishable === true;
}

/**
 * Customer-visibility filter. Drops every shop that is not explicitly
 * publishable (Rule 5 fail-closed: `isPublishable !== true` — including
 * `undefined`/`null` — is hidden). When `showUnpublished` is true (the
 * `appConfig/pilotConfig.showUnpublishedShops` family-testing bypass),
 * the list passes through untouched. Pure; does not mutate the input.
 */
export function filterPublishableShops<T extends { isPublishable?: boolean | null }>(
  shops: T[],
  showUnpublished: boolean,
): T[] {
  if (showUnpublished) return shops.slice();
  return shops.filter(s => s.isPublishable === true);
}

export type PublishBannerCta = {
  label: string;
  route: 'BuildCatalog' | 'ShopSettings';
};

export type PublishBannerContent = {
  lines: string[];
  primaryCta: PublishBannerCta | null;
};

/**
 * Turn a `missing[]` list into shop-owner-facing banner copy + the
 * single most-relevant call-to-action. Pure + unit-tested so the
 * banner component is a thin render over it.
 *
 * Line order matches the gate order (status -> menu -> hours ->
 * location). The primary CTA is the FIRST actionable requirement the
 * owner can fix themselves (menu -> hours -> location);
 * `shop_status_not_active` is "wait for admin" and yields no CTA.
 */
export function formatPublishMissingForBanner(
  missing: PublishRequirementKey[],
  menuItemCount: number,
  minMenuItems: number,
): PublishBannerContent {
  const lines: string[] = [];
  let primaryCta: PublishBannerCta | null = null;

  for (const key of missing) {
    switch (key) {
      case 'shop_status_not_active':
        lines.push('Awaiting admin approval');
        break;
      case 'menu_items_below_minimum': {
        const remaining = Math.max(0, minMenuItems - menuItemCount);
        const noun = remaining === 1 ? 'item' : 'items';
        lines.push(`Add ${remaining} more ${noun} to your menu`);
        if (!primaryCta) {
          primaryCta = { label: 'Add items', route: 'BuildCatalog' };
        }
        break;
      }
      case 'hours_not_set':
        lines.push('Set your opening hours');
        if (!primaryCta) {
          primaryCta = { label: 'Set hours', route: 'ShopSettings' };
        }
        break;
      case 'location_not_verified':
        lines.push('Verify your shop location');
        if (!primaryCta) {
          primaryCta = { label: 'Verify location', route: 'ShopSettings' };
        }
        break;
      default:
        break;
    }
  }

  return { lines, primaryCta };
}
