/**
 * PR-NEXT-5 — pin the consecutive-failure-counter contract used by
 * the Delivery Dashboard's error-banner dampening (finding #7).
 *
 * The screen-side wiring assumes specific semantics from
 * `applyPollOutcome` — most importantly the `justTripped` flag,
 * which gates the "captureMessage once per outage" Sentry call.
 * If a future refactor changes those semantics, this test matrix
 * is the regression net.
 */

import {
  applyPollOutcome,
  POLL_FAILURE_THRESHOLD,
} from '../../src/utils/pollFailureGate';

describe('PR-NEXT-5 — applyPollOutcome (success branch)', () => {
  test('success from count=0 → resets, not tripped', () => {
    expect(
      applyPollOutcome({ currentCount: 0, outcome: 'success' }),
    ).toEqual({ nextCount: 0, tripped: false, justTripped: false });
  });

  test('success from mid-stream count → resets to 0', () => {
    expect(
      applyPollOutcome({ currentCount: 2, outcome: 'success' }),
    ).toEqual({ nextCount: 0, tripped: false, justTripped: false });
  });

  test('success from already-tripped state → resets to 0 (recovery)', () => {
    expect(
      applyPollOutcome({ currentCount: 5, outcome: 'success' }),
    ).toEqual({ nextCount: 0, tripped: false, justTripped: false });
  });

  test('success ignores threshold override (always full reset)', () => {
    expect(
      applyPollOutcome({
        currentCount: 100,
        outcome: 'success',
        threshold: 1,
      }),
    ).toEqual({ nextCount: 0, tripped: false, justTripped: false });
  });
});

describe('PR-NEXT-5 — applyPollOutcome (failure branch, default threshold=3)', () => {
  test('first failure → count=1, not tripped', () => {
    expect(
      applyPollOutcome({ currentCount: 0, outcome: 'failure' }),
    ).toEqual({ nextCount: 1, tripped: false, justTripped: false });
  });

  test('second failure → count=2, not tripped', () => {
    expect(
      applyPollOutcome({ currentCount: 1, outcome: 'failure' }),
    ).toEqual({ nextCount: 2, tripped: false, justTripped: false });
  });

  test('third failure → count=3, tripped + justTripped (threshold crossing)', () => {
    expect(
      applyPollOutcome({ currentCount: 2, outcome: 'failure' }),
    ).toEqual({ nextCount: 3, tripped: true, justTripped: true });
  });

  test('failure already past threshold → tripped, NOT justTripped (mid-outage)', () => {
    // This is the key contract for "captureMessage once per outage,
    // not per failed poll" — justTripped must be false here so the
    // screen suppresses the second Sentry capture.
    expect(
      applyPollOutcome({ currentCount: 3, outcome: 'failure' }),
    ).toEqual({ nextCount: 4, tripped: true, justTripped: false });
  });

  test('failure deep into outage → tripped, NOT justTripped (still mid-outage)', () => {
    expect(
      applyPollOutcome({ currentCount: 47, outcome: 'failure' }),
    ).toEqual({ nextCount: 48, tripped: true, justTripped: false });
  });
});

describe('PR-NEXT-5 — applyPollOutcome custom threshold', () => {
  test('threshold=1 trips on the first failure', () => {
    expect(
      applyPollOutcome({
        currentCount: 0,
        outcome: 'failure',
        threshold: 1,
      }),
    ).toEqual({ nextCount: 1, tripped: true, justTripped: true });
  });

  test('threshold=5 does not trip until the 5th consecutive failure', () => {
    const fourth = applyPollOutcome({
      currentCount: 3,
      outcome: 'failure',
      threshold: 5,
    });
    expect(fourth).toEqual({
      nextCount: 4,
      tripped: false,
      justTripped: false,
    });
    const fifth = applyPollOutcome({
      currentCount: 4,
      outcome: 'failure',
      threshold: 5,
    });
    expect(fifth).toEqual({
      nextCount: 5,
      tripped: true,
      justTripped: true,
    });
  });
});

describe('PR-NEXT-5 — applyPollOutcome defensive clamps', () => {
  test('negative currentCount clamps to 0 before increment', () => {
    expect(
      applyPollOutcome({ currentCount: -7, outcome: 'failure' }),
    ).toEqual({ nextCount: 1, tripped: false, justTripped: false });
  });

  test('NaN currentCount clamps to 0 before increment', () => {
    expect(
      applyPollOutcome({ currentCount: NaN, outcome: 'failure' }),
    ).toEqual({ nextCount: 1, tripped: false, justTripped: false });
  });

  test('Infinity currentCount clamps to 0 before increment (avoid stuck-at-Infinity)', () => {
    expect(
      applyPollOutcome({
        currentCount: Number.POSITIVE_INFINITY,
        outcome: 'failure',
      }),
    ).toEqual({ nextCount: 1, tripped: false, justTripped: false });
  });

  test('fractional currentCount floors before increment', () => {
    expect(
      applyPollOutcome({ currentCount: 2.7, outcome: 'failure' }),
    ).toEqual({ nextCount: 3, tripped: true, justTripped: true });
  });
});

describe('PR-NEXT-5 — applyPollOutcome end-to-end recovery sequence', () => {
  test('outage → recovery → second outage fires justTripped twice', () => {
    // Walk a representative session through the helper and confirm
    // the "two distinct outage events should produce two distinct
    // captureMessage signals" contract holds.
    let count = 0;

    // 3 failures → first outage
    let r = applyPollOutcome({ currentCount: count, outcome: 'failure' });
    count = r.nextCount;
    expect(r).toEqual({ nextCount: 1, tripped: false, justTripped: false });
    r = applyPollOutcome({ currentCount: count, outcome: 'failure' });
    count = r.nextCount;
    expect(r).toEqual({ nextCount: 2, tripped: false, justTripped: false });
    r = applyPollOutcome({ currentCount: count, outcome: 'failure' });
    count = r.nextCount;
    expect(r).toEqual({ nextCount: 3, tripped: true, justTripped: true });

    // Continued failure mid-outage — must NOT re-trip
    r = applyPollOutcome({ currentCount: count, outcome: 'failure' });
    count = r.nextCount;
    expect(r.justTripped).toBe(false);
    expect(r.tripped).toBe(true);

    // Recovery — single success resets
    r = applyPollOutcome({ currentCount: count, outcome: 'success' });
    count = r.nextCount;
    expect(r).toEqual({ nextCount: 0, tripped: false, justTripped: false });

    // 2 fails — not yet tripped
    r = applyPollOutcome({ currentCount: count, outcome: 'failure' });
    count = r.nextCount;
    r = applyPollOutcome({ currentCount: count, outcome: 'failure' });
    count = r.nextCount;
    expect(r.tripped).toBe(false);

    // 3rd fail — second outage, justTripped fires again
    r = applyPollOutcome({ currentCount: count, outcome: 'failure' });
    count = r.nextCount;
    expect(r).toEqual({ nextCount: 3, tripped: true, justTripped: true });
  });
});

describe('PR-NEXT-5 — POLL_FAILURE_THRESHOLD constant', () => {
  test('default threshold is 3 (pinned for ~45s dampening at 15s cadence)', () => {
    expect(POLL_FAILURE_THRESHOLD).toBe(3);
  });
});
