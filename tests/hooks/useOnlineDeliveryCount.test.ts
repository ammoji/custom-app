/**
 * Unit tests for the pure state-machine slice of
 * `useOnlineDeliveryCount`.
 *
 * The hook itself ties this slice to a React effect + 15s polling
 * interval; we don't have RNTL or react-test-renderer in the
 * project (per .windsurf/test-discipline.md), so the failure-
 * tolerance contract is pinned via the extracted `nextPollState`
 * pure helper. Every UI-visible behaviour the PR 3 prompt names
 * maps directly to a transition tested below.
 */
import {
  STALE_THRESHOLD,
  nextPollState,
} from '../../src/hooks/useOnlineDeliveryCount';

describe('nextPollState', () => {
  test('starts conceptually with count = null (initial state shape)', () => {
    // The hook seeds useState with null; nextPollState never sees a
    // "before-first-call" call directly, but its initial-state
    // contract is documented here so future readers don't wonder.
    const initial = { count: null, failures: 0 };
    expect(initial.count).toBeNull();
    expect(initial.failures).toBe(0);
  });

  test('updates count on successful poll and resets failure counter', () => {
    const next = nextPollState(
      { count: null, failures: 0 },
      { kind: 'success', value: 7 },
    );
    expect(next).toEqual({ count: 7, failures: 0 });
  });

  test('keeps last-known count on a single transient failure', () => {
    // We had a successful poll (count=7); one failure shouldn't
    // wipe the value — the network blip recoverable case.
    const next = nextPollState(
      { count: 7, failures: 0 },
      { kind: 'failure' },
    );
    expect(next).toEqual({ count: 7, failures: 1 });
  });

  test(`clears count to null after ${STALE_THRESHOLD} consecutive failures`, () => {
    // Walk the counter up to the threshold from a known-good count.
    let state: { count: number | null; failures: number } = {
      count: 7,
      failures: 0,
    };
    for (let i = 0; i < STALE_THRESHOLD - 1; i++) {
      state = nextPollState(state, { kind: 'failure' });
      // Still under the threshold — count must NOT clear yet.
      expect(state.count).toBe(7);
    }
    state = nextPollState(state, { kind: 'failure' });
    expect(state.count).toBeNull();
    expect(state.failures).toBe(STALE_THRESHOLD);
  });

  test('resets failure counter on next successful poll (recovery)', () => {
    // Two failures (below threshold) then a success → count bounces
    // back to the new value AND failures resets. The followup
    // failure run starts from 0 again (proven indirectly: a single
    // post-recovery failure must NOT trip the threshold).
    let state = nextPollState(
      { count: 7, failures: 0 },
      { kind: 'failure' },
    );
    state = nextPollState(state, { kind: 'failure' });
    expect(state.failures).toBe(2);
    state = nextPollState(state, { kind: 'success', value: 11 });
    expect(state).toEqual({ count: 11, failures: 0 });
    state = nextPollState(state, { kind: 'failure' });
    // Single failure post-recovery: well under threshold, count
    // must still equal the recovered value.
    expect(state.count).toBe(11);
    expect(state.failures).toBe(1);
  });

  test('threshold parameter is honored when overridden', () => {
    // Belt-and-suspenders: explicit threshold wins over the module
    // default. Lets future callers tune the tolerance without
    // touching the module export.
    const state = nextPollState(
      { count: 5, failures: 0 },
      { kind: 'failure' },
      1,
    );
    expect(state.count).toBeNull();
    expect(state.failures).toBe(1);
  });
});
