/**
 * PR-NEXT-REVIEW-SYSTEM — unit tests for reviewWorkflowHelpers.
 *
 * Test plan (12 cases):
 *   decideInitialState (4): above threshold, low shop, low partner, low both
 *   canRespond/canAmend/canAcknowledge transitions (4): each valid and invalid state
 *   decideTimeoutPublish (4): before timeout, after timeout, non-flagged state, custom days
 */
import {
  decideInitialState,
  canRespond,
  canAmend,
  canAcknowledge,
  decideTimeoutPublish,
  type ReviewState,
} from '../../functions/src/reviewWorkflowHelpers';

const THRESHOLDS = { shopThreshold: 3, partnerThreshold: 3 };

// ─── decideInitialState ──────────────────────────────────────────────────────

describe('decideInitialState', () => {
  test('both above threshold → published immediately', () => {
    const result = decideInitialState({ shopStars: 4, deliveryStars: 5, ...THRESHOLDS });
    expect(result.state).toBe('published');
    expect(result.reason).toBe('above_threshold');
  });

  test('shopStars at threshold → flagged_low', () => {
    const result = decideInitialState({ shopStars: 3, deliveryStars: 5, ...THRESHOLDS });
    expect(result.state).toBe('flagged_low');
    expect(result.reason).toBe('low_stars');
  });

  test('deliveryStars below threshold → flagged_low', () => {
    const result = decideInitialState({ shopStars: 5, deliveryStars: 2, ...THRESHOLDS });
    expect(result.state).toBe('flagged_low');
    expect(result.reason).toBe('low_stars');
  });

  test('deliveryStars null (no partner) + shopStars above → published', () => {
    const result = decideInitialState({ shopStars: 4, deliveryStars: null, ...THRESHOLDS });
    expect(result.state).toBe('published');
  });
});

// ─── state-gate helpers ──────────────────────────────────────────────────────

describe('canRespond', () => {
  test('flagged_low → can respond', () => {
    expect(canRespond('flagged_low')).toBe(true);
  });

  test('responded → cannot respond again', () => {
    expect(canRespond('responded')).toBe(false);
  });
});

describe('canAmend', () => {
  test('responded → can amend', () => {
    expect(canAmend('responded')).toBe(true);
  });

  test('flagged_low → cannot amend (must wait for response)', () => {
    expect(canAmend('flagged_low')).toBe(false);
  });
});

describe('canAcknowledge', () => {
  test('responded → can acknowledge', () => {
    expect(canAcknowledge('responded')).toBe(true);
  });

  test('published → cannot acknowledge (already done)', () => {
    expect(canAcknowledge('published')).toBe(false);
  });
});

// ─── decideTimeoutPublish ────────────────────────────────────────────────────

describe('decideTimeoutPublish', () => {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const base = 1_000_000_000_000; // arbitrary epoch ms

  test('flagged_low + elapsed < 7 days → no publish', () => {
    expect(
      decideTimeoutPublish({
        state: 'flagged_low',
        submittedAtMs: base,
        nowMs: base + 6 * MS_PER_DAY,
      }),
    ).toBe(false);
  });

  test('flagged_low + elapsed > 7 days → publish', () => {
    expect(
      decideTimeoutPublish({
        state: 'flagged_low',
        submittedAtMs: base,
        nowMs: base + 8 * MS_PER_DAY,
      }),
    ).toBe(true);
  });

  test('responded state + elapsed > 7 days → no publish (wrong state)', () => {
    expect(
      decideTimeoutPublish({
        state: 'responded' as ReviewState,
        submittedAtMs: base,
        nowMs: base + 8 * MS_PER_DAY,
      }),
    ).toBe(false);
  });

  test('custom timeoutDays=3: elapsed > 3 days → publish', () => {
    expect(
      decideTimeoutPublish({
        state: 'flagged_low',
        submittedAtMs: base,
        nowMs: base + 4 * MS_PER_DAY,
        timeoutDays: 3,
      }),
    ).toBe(true);
  });
});
