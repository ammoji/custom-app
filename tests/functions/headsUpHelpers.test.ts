/**
 * PR-NEXT-PARTNER-HEADS-UP — unit tests for computeMinutesFromNow.
 *
 * Test plan (6 cases):
 *   1. Future readyByEstimate (15 min ahead)     → 15
 *   2. Past readyByEstimate (already overdue)    → 1 (clamped)
 *   3. Exactly now (delta = 0)                   → 1 (clamped)
 *   4. null input                                → 1 (safe default)
 *   5. undefined input                           → 1 (safe default)
 *   6. NaN input                                 → 1 (safe default)
 */
import { computeMinutesFromNow } from '../../functions/src/headsUpHelpers';

describe('computeMinutesFromNow', () => {
  const NOW = 1_700_000_000_000; // fixed epoch for determinism

  test('future readyByEstimate 15 min ahead → 15', () => {
    expect(computeMinutesFromNow(NOW + 15 * 60_000, NOW)).toBe(15);
  });

  test('past readyByEstimate (overdue by 5 min) → 1 (clamped)', () => {
    expect(computeMinutesFromNow(NOW - 5 * 60_000, NOW)).toBe(1);
  });

  test('readyByEstimate exactly now (delta=0) → 1 (clamped)', () => {
    expect(computeMinutesFromNow(NOW, NOW)).toBe(1);
  });

  test('null input → 1 (safe default)', () => {
    expect(computeMinutesFromNow(null, NOW)).toBe(1);
  });

  test('undefined input → 1 (safe default)', () => {
    expect(computeMinutesFromNow(undefined, NOW)).toBe(1);
  });

  test('NaN input → 1 (safe default)', () => {
    expect(computeMinutesFromNow(NaN, NOW)).toBe(1);
  });
});
