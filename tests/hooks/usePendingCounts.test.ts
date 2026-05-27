/**
 * PR 41 — Tests for the pure state-machine slice of usePendingCounts.
 *
 * Same posture as `useOnlineDeliveryCount.nextPollState` tests: we
 * unit-test the failure-tolerance state machine without booting a
 * React renderer (react-test-renderer + RNTL are out of scope per
 * `.windsurf/test-discipline.md`). The hook itself is a thin shim
 * over this function plus setInterval / setState wiring.
 */
import {
  nextPendingCountsState,
  PENDING_COUNTS_STALE_THRESHOLD,
  type PendingCounts,
} from '../../src/hooks/usePendingCounts';

const ZERO: PendingCounts = {
  shopCount: 0,
  deliveryCount: 0,
  pendingOrderCount: 0,
};

const VALUE_A: PendingCounts = {
  shopCount: 2,
  deliveryCount: 1,
  pendingOrderCount: 0,
};

const VALUE_B: PendingCounts = {
  shopCount: 5,
  deliveryCount: 3,
  pendingOrderCount: 7,
};

describe('PR 41 — nextPendingCountsState', () => {
  test('success installs the new counts and resets the failure counter', () => {
    const next = nextPendingCountsState(
      { counts: VALUE_A, failures: 2 },
      { kind: 'success', value: VALUE_B },
    );
    expect(next).toEqual({ counts: VALUE_B, failures: 0 });
  });

  test('first failure preserves the previous counts and bumps the counter', () => {
    const next = nextPendingCountsState(
      { counts: VALUE_A, failures: 0 },
      { kind: 'failure' },
    );
    expect(next).toEqual({ counts: VALUE_A, failures: 1 });
  });

  test('second failure still preserves the previous counts (threshold=3)', () => {
    const next = nextPendingCountsState(
      { counts: VALUE_A, failures: 1 },
      { kind: 'failure' },
    );
    expect(next).toEqual({ counts: VALUE_A, failures: 2 });
  });

  test(`third failure (>= threshold=${PENDING_COUNTS_STALE_THRESHOLD}) clears to ZERO`, () => {
    const next = nextPendingCountsState(
      { counts: VALUE_A, failures: PENDING_COUNTS_STALE_THRESHOLD - 1 },
      { kind: 'failure' },
    );
    expect(next).toEqual({
      counts: ZERO,
      failures: PENDING_COUNTS_STALE_THRESHOLD,
    });
  });

  test('a single success after a near-failure burst resets the counter', () => {
    // simulate a 2-strike burst then recovery
    let state = { counts: VALUE_A, failures: 0 };
    state = nextPendingCountsState(state, { kind: 'failure' });
    state = nextPendingCountsState(state, { kind: 'failure' });
    expect(state.failures).toBe(2);
    state = nextPendingCountsState(state, { kind: 'success', value: VALUE_B });
    expect(state).toEqual({ counts: VALUE_B, failures: 0 });
  });

  test('custom threshold can be passed in (knob for tests / future tuning)', () => {
    // threshold=1 → first failure should already clear
    const next = nextPendingCountsState(
      { counts: VALUE_A, failures: 0 },
      { kind: 'failure' },
      1,
    );
    expect(next).toEqual({ counts: ZERO, failures: 1 });
  });
});
