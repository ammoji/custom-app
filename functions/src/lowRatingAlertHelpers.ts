/**
 * PR-NEXT-LOW-RATING-PUSH — pure decision helpers for the
 * low-rating fan-out. Three roles, three independent decisions.
 * Each returns a discriminated-union FanoutDecision with the
 * threshold used + the rating compared so the audit log can
 * justify the push.
 *
 * Fail-OPEN: missing / malformed config → defaults applied (3★,
 * all enabled). Same posture as all other appConfig flags.
 *
 * Pinned by tests/functions/lowRatingAlertHelpers.test.ts.
 */

export type AlertConfig = {
  shopDefaultThreshold: number;
  partnerDefaultThreshold: number;
  adminThreshold: number;
  adminNotificationsEnabled: boolean;
};

export type ShopOverride = {
  lowRatingThreshold?: number | null;
  lowRatingNotificationsEnabled?: boolean | null;
};

export type PartnerOverride = ShopOverride;

export type FanoutDecision =
  | { notify: true; threshold: number; reason: 'rating_at_or_below_threshold' }
  | { notify: false; reason: 'rating_above_threshold' | 'opted_out' };

export const ALERT_DEFAULTS: AlertConfig = {
  shopDefaultThreshold: 3,
  partnerDefaultThreshold: 3,
  adminThreshold: 3,
  adminNotificationsEnabled: true,
};

/**
 * Parse raw Firestore doc data from `appConfig/ratingAlerts` into a
 * strongly-typed AlertConfig. Missing / malformed fields → defaults.
 */
export function parseAlertConfig(raw: unknown): AlertConfig {
  if (!raw || typeof raw !== 'object') return ALERT_DEFAULTS;
  const r = raw as Record<string, unknown>;
  return {
    shopDefaultThreshold:
      typeof r.shopDefaultThreshold === 'number' &&
      Number.isFinite(r.shopDefaultThreshold)
        ? r.shopDefaultThreshold
        : ALERT_DEFAULTS.shopDefaultThreshold,
    partnerDefaultThreshold:
      typeof r.partnerDefaultThreshold === 'number' &&
      Number.isFinite(r.partnerDefaultThreshold)
        ? r.partnerDefaultThreshold
        : ALERT_DEFAULTS.partnerDefaultThreshold,
    adminThreshold:
      typeof r.adminThreshold === 'number' && Number.isFinite(r.adminThreshold)
        ? r.adminThreshold
        : ALERT_DEFAULTS.adminThreshold,
    adminNotificationsEnabled:
      r.adminNotificationsEnabled === false
        ? false
        : ALERT_DEFAULTS.adminNotificationsEnabled,
  };
}

/**
 * Decide whether the shop owner should receive a low-rating push.
 * Per-shop override wins over global default. Opt-out short-circuits.
 */
export function decideShopFanout(args: {
  shopStars: number;
  shopOverride: ShopOverride | null;
  config: AlertConfig;
}): FanoutDecision {
  // Default enabled; explicit `false` opt-out required.
  const enabled = args.shopOverride?.lowRatingNotificationsEnabled !== false;
  if (!enabled) return { notify: false, reason: 'opted_out' };
  const threshold =
    typeof args.shopOverride?.lowRatingThreshold === 'number' &&
    Number.isFinite(args.shopOverride.lowRatingThreshold)
      ? args.shopOverride.lowRatingThreshold
      : args.config.shopDefaultThreshold;
  return args.shopStars <= threshold
    ? { notify: true, threshold, reason: 'rating_at_or_below_threshold' }
    : { notify: false, reason: 'rating_above_threshold' };
}

/**
 * Decide whether the delivery partner should receive a low-rating push.
 * Mirrors decideShopFanout but uses partnerDefaultThreshold.
 */
export function decidePartnerFanout(args: {
  partnerStars: number;
  partnerOverride: PartnerOverride | null;
  config: AlertConfig;
}): FanoutDecision {
  const enabled = args.partnerOverride?.lowRatingNotificationsEnabled !== false;
  if (!enabled) return { notify: false, reason: 'opted_out' };
  const threshold =
    typeof args.partnerOverride?.lowRatingThreshold === 'number' &&
    Number.isFinite(args.partnerOverride.lowRatingThreshold)
      ? args.partnerOverride.lowRatingThreshold
      : args.config.partnerDefaultThreshold;
  return args.partnerStars <= threshold
    ? { notify: true, threshold, reason: 'rating_at_or_below_threshold' }
    : { notify: false, reason: 'rating_above_threshold' };
}

/**
 * Decide whether admins should receive a low-rating push.
 * Uses worstStars = min(shopStars, partnerStars) against a single
 * adminThreshold. A single global opt-out flag covers all admins.
 */
export function decideAdminFanout(args: {
  worstStars: number;
  config: AlertConfig;
}): FanoutDecision {
  if (!args.config.adminNotificationsEnabled) {
    return { notify: false, reason: 'opted_out' };
  }
  return args.worstStars <= args.config.adminThreshold
    ? {
        notify: true,
        threshold: args.config.adminThreshold,
        reason: 'rating_at_or_below_threshold',
      }
    : { notify: false, reason: 'rating_above_threshold' };
}
