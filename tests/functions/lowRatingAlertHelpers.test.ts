/**
 * PR-NEXT-LOW-RATING-PUSH — unit tests for lowRatingAlertHelpers.
 *
 * Test plan (15 cases):
 *   parseAlertConfig (5): null, empty object, partial, full, malformed types
 *   decideShopFanout (4): above threshold, below threshold, at threshold, opted out
 *   decidePartnerFanout (3): below threshold, above threshold, opted out
 *   decideAdminFanout (3): below threshold, above threshold, admin notifications disabled
 */
import {
  parseAlertConfig,
  decideShopFanout,
  decidePartnerFanout,
  decideAdminFanout,
  ALERT_DEFAULTS,
  type AlertConfig,
} from '../../functions/src/lowRatingAlertHelpers';

const FULL_CONFIG: AlertConfig = {
  shopDefaultThreshold: 3,
  partnerDefaultThreshold: 3,
  adminThreshold: 3,
  adminNotificationsEnabled: true,
};

// ─── parseAlertConfig ────────────────────────────────────────────────────────

describe('parseAlertConfig', () => {
  test('null → all defaults', () => {
    expect(parseAlertConfig(null)).toEqual(ALERT_DEFAULTS);
  });

  test('empty object → all defaults', () => {
    expect(parseAlertConfig({})).toEqual(ALERT_DEFAULTS);
  });

  test('partial object → supplied fields used, rest default', () => {
    const result = parseAlertConfig({ shopDefaultThreshold: 2 });
    expect(result.shopDefaultThreshold).toBe(2);
    expect(result.partnerDefaultThreshold).toBe(ALERT_DEFAULTS.partnerDefaultThreshold);
    expect(result.adminThreshold).toBe(ALERT_DEFAULTS.adminThreshold);
    expect(result.adminNotificationsEnabled).toBe(true);
  });

  test('full valid object → exact values returned', () => {
    const raw = {
      shopDefaultThreshold: 4,
      partnerDefaultThreshold: 2,
      adminThreshold: 5,
      adminNotificationsEnabled: false,
    };
    expect(parseAlertConfig(raw)).toEqual({
      shopDefaultThreshold: 4,
      partnerDefaultThreshold: 2,
      adminThreshold: 5,
      adminNotificationsEnabled: false,
    });
  });

  test('malformed types (NaN, strings) → defaults for those fields', () => {
    const result = parseAlertConfig({
      shopDefaultThreshold: NaN,
      partnerDefaultThreshold: 'three',
      adminThreshold: Infinity,
      adminNotificationsEnabled: null,
    });
    expect(result.shopDefaultThreshold).toBe(ALERT_DEFAULTS.shopDefaultThreshold);
    expect(result.partnerDefaultThreshold).toBe(ALERT_DEFAULTS.partnerDefaultThreshold);
    expect(result.adminThreshold).toBe(ALERT_DEFAULTS.adminThreshold);
    // null is not === false, so default (true) applies
    expect(result.adminNotificationsEnabled).toBe(true);
  });
});

// ─── decideShopFanout ────────────────────────────────────────────────────────

describe('decideShopFanout', () => {
  test('rating above threshold → no notify', () => {
    const result = decideShopFanout({ shopStars: 4, shopOverride: null, config: FULL_CONFIG });
    expect(result.notify).toBe(false);
    if (!result.notify) expect(result.reason).toBe('rating_above_threshold');
  });

  test('rating below threshold → notify with correct threshold', () => {
    const result = decideShopFanout({ shopStars: 2, shopOverride: null, config: FULL_CONFIG });
    expect(result.notify).toBe(true);
    if (result.notify) {
      expect(result.threshold).toBe(3);
      expect(result.reason).toBe('rating_at_or_below_threshold');
    }
  });

  test('rating at threshold (= threshold) → notify', () => {
    const result = decideShopFanout({ shopStars: 3, shopOverride: null, config: FULL_CONFIG });
    expect(result.notify).toBe(true);
  });

  test('opted out via override → no notify regardless of rating', () => {
    const result = decideShopFanout({
      shopStars: 1,
      shopOverride: { lowRatingNotificationsEnabled: false },
      config: FULL_CONFIG,
    });
    expect(result.notify).toBe(false);
    if (!result.notify) expect(result.reason).toBe('opted_out');
  });

  test('per-shop override threshold wins over global', () => {
    const result = decideShopFanout({
      shopStars: 4,
      shopOverride: { lowRatingThreshold: 4 },
      config: FULL_CONFIG,
    });
    expect(result.notify).toBe(true); // 4 <= 4
  });
});

// ─── decidePartnerFanout ─────────────────────────────────────────────────────

describe('decidePartnerFanout', () => {
  test('rating below threshold → notify', () => {
    const result = decidePartnerFanout({ partnerStars: 2, partnerOverride: null, config: FULL_CONFIG });
    expect(result.notify).toBe(true);
    if (result.notify) expect(result.threshold).toBe(3);
  });

  test('rating above threshold → no notify', () => {
    const result = decidePartnerFanout({ partnerStars: 5, partnerOverride: null, config: FULL_CONFIG });
    expect(result.notify).toBe(false);
  });

  test('opted out → no notify regardless of rating', () => {
    const result = decidePartnerFanout({
      partnerStars: 1,
      partnerOverride: { lowRatingNotificationsEnabled: false },
      config: FULL_CONFIG,
    });
    expect(result.notify).toBe(false);
    if (!result.notify) expect(result.reason).toBe('opted_out');
  });
});

// ─── decideAdminFanout ───────────────────────────────────────────────────────

describe('decideAdminFanout', () => {
  test('worstStars below threshold → notify', () => {
    const result = decideAdminFanout({ worstStars: 2, config: FULL_CONFIG });
    expect(result.notify).toBe(true);
    if (result.notify) expect(result.threshold).toBe(3);
  });

  test('worstStars above threshold → no notify', () => {
    const result = decideAdminFanout({ worstStars: 4, config: FULL_CONFIG });
    expect(result.notify).toBe(false);
    if (!result.notify) expect(result.reason).toBe('rating_above_threshold');
  });

  test('adminNotificationsEnabled false → opted_out regardless of stars', () => {
    const config: AlertConfig = { ...FULL_CONFIG, adminNotificationsEnabled: false };
    const result = decideAdminFanout({ worstStars: 1, config });
    expect(result.notify).toBe(false);
    if (!result.notify) expect(result.reason).toBe('opted_out');
  });
});
