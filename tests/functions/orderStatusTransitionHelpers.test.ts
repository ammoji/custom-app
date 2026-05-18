/**
 * PR 12 — Tests for the pure ETA validation helper.
 *
 * Pins the rules in `orderStatusTransitionHelpers.ts`:
 *   - accepted: ETA required, must be future
 *   - preparing: ETA optional, must be future when present
 *   - other transitions: ETA ignored (forwards-compatible)
 */
import {
  validateOrderStatusTransition,
} from '../../functions/src/orderStatusTransitionHelpers';

const NOW = 1_700_000_000_000;
const FUTURE = NOW + 20 * 60_000; // 20 min in the future
const PAST = NOW - 60_000; // 1 min in the past

describe('validateOrderStatusTransition — accepted', () => {
  test('rejects accept without readyByEstimate', () => {
    const r = validateOrderStatusTransition({ status: 'accepted', now: NOW });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('invalid-argument');
    expect(r.field).toBe('readyByEstimate');
    expect(r.message).toMatch(/required/);
  });

  test('rejects accept with explicit null readyByEstimate', () => {
    const r = validateOrderStatusTransition({
      status: 'accepted',
      readyByEstimate: null,
      now: NOW,
    });
    expect(r.ok).toBe(false);
  });

  test('rejects accept with past timestamp', () => {
    const r = validateOrderStatusTransition({
      status: 'accepted',
      readyByEstimate: PAST,
      now: NOW,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toMatch(/future/);
  });

  test('rejects accept with non-numeric readyByEstimate (string)', () => {
    const r = validateOrderStatusTransition({
      status: 'accepted',
      readyByEstimate: '20 minutes' as unknown as number,
      now: NOW,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toMatch(/finite number/);
  });

  test('rejects accept with NaN / Infinity', () => {
    expect(
      validateOrderStatusTransition({
        status: 'accepted',
        readyByEstimate: NaN,
        now: NOW,
      }).ok,
    ).toBe(false);
    expect(
      validateOrderStatusTransition({
        status: 'accepted',
        readyByEstimate: Infinity,
        now: NOW,
      }).ok,
    ).toBe(false);
  });

  test('accepts a future timestamp', () => {
    const r = validateOrderStatusTransition({
      status: 'accepted',
      readyByEstimate: FUTURE,
      now: NOW,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.readyByEstimate).toBe(FUTURE);
  });

  test('accepts readyByEstimate exactly equal to now (boundary)', () => {
    // The check is `< now` so an ETA matching wall-clock ticks the
    // same ms is allowed. Defensive — in practice the server adds
    // a non-zero minute count so this is rarely exercised.
    const r = validateOrderStatusTransition({
      status: 'accepted',
      readyByEstimate: NOW,
      now: NOW,
    });
    expect(r.ok).toBe(true);
  });
});

describe('validateOrderStatusTransition — preparing', () => {
  test('preparing without readyByEstimate is legal', () => {
    const r = validateOrderStatusTransition({
      status: 'preparing',
      now: NOW,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.readyByEstimate).toBeUndefined();
  });

  test('preparing with future readyByEstimate is allowed (mid-prep update)', () => {
    const r = validateOrderStatusTransition({
      status: 'preparing',
      readyByEstimate: FUTURE,
      now: NOW,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.readyByEstimate).toBe(FUTURE);
  });

  test('preparing with past readyByEstimate is rejected', () => {
    const r = validateOrderStatusTransition({
      status: 'preparing',
      readyByEstimate: PAST,
      now: NOW,
    });
    expect(r.ok).toBe(false);
  });
});

describe('validateOrderStatusTransition — other transitions ignore ETA', () => {
  // Forwards-compatibility: a v(N+1) client may send readyByEstimate
  // on a transition we don't validate yet. We must NOT reject; just
  // drop the value and let the callable persist nothing.
  test.each(['ready_for_pickup', 'delivered', 'cancelled', 'pending'] as const)(
    '%s with readyByEstimate present → ok, value dropped',
    status => {
      const r = validateOrderStatusTransition({
        status,
        readyByEstimate: FUTURE,
        now: NOW,
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.readyByEstimate).toBeUndefined();
    },
  );

  test('ready_for_pickup with NO readyByEstimate → ok', () => {
    const r = validateOrderStatusTransition({
      status: 'ready_for_pickup',
      now: NOW,
    });
    expect(r.ok).toBe(true);
  });
});
