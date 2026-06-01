/**
 * Unit tests for the pure state-machine slice of
 * `useOnlinePartnersNearMyShop` (PR-NEXT-7, finding #9).
 *
 * Mirrors `tests/hooks/useOnlineDeliveryCount.test.ts` — the hook
 * itself ties this slice to a React effect + 30s polling interval,
 * but RNTL / react-test-renderer aren't in the project (per
 * `.windsurf/test-discipline.md`), so we pin the failure-tolerance
 * contract via the extracted `nextNearbyPartnersState` pure helper.
 * The single shape difference vs. `useOnlineDeliveryCount` is that
 * the value is a `{count, filtered}` tuple rather than a bare
 * `number | null`; tests below pin both axes.
 */
import {
  NEARBY_PARTNERS_STALE_THRESHOLD,
  nextNearbyPartnersState,
  type NearbyPartnersState,
} from '../../src/hooks/useOnlinePartnersNearMyShop';

const INITIAL: { state: NearbyPartnersState; failures: number } = {
  state: { count: null, filtered: false },
  failures: 0,
};

describe('nextNearbyPartnersState', () => {
  test('initial state shape: count=null, filtered=false, failures=0', () => {
    // Documents the seed value the hook installs in useState. The
    // helper never sees the pre-first-call invocation directly, but
    // the contract matters for any future caller.
    expect(INITIAL.state).toEqual({ count: null, filtered: false });
    expect(INITIAL.failures).toBe(0);
  });

  test('successful poll installs new value (count + filtered) and resets failure counter', () => {
    const next = nextNearbyPartnersState(INITIAL, {
      kind: 'success',
      value: { count: 3, filtered: true },
    });
    expect(next).toEqual({
      state: { count: 3, filtered: true },
      failures: 0,
    });
  });

  test('successful poll preserves filtered=false from a fail-open shop', () => {
    // A shop without `location` returns `filtered: false`. The hook
    // must propagate that flag verbatim so the UI can render the
    // "set your shop location" hint.
    const next = nextNearbyPartnersState(INITIAL, {
      kind: 'success',
      value: { count: 5, filtered: false },
    });
    expect(next.state.filtered).toBe(false);
    expect(next.state.count).toBe(5);
  });

  test('single transient failure preserves the previous value (count + filtered)', () => {
    const seeded = {
      state: { count: 3, filtered: true } as NearbyPartnersState,
      failures: 0,
    };
    const next = nextNearbyPartnersState(seeded, { kind: 'failure' });
    expect(next).toEqual({
      state: { count: 3, filtered: true },
      failures: 1,
    });
  });

  test(`clears value to null after ${NEARBY_PARTNERS_STALE_THRESHOLD} consecutive failures`, () => {
    // Walk the counter up to the threshold from a known-good value.
    let s: { state: NearbyPartnersState; failures: number } = {
      state: { count: 3, filtered: true },
      failures: 0,
    };
    for (let i = 0; i < NEARBY_PARTNERS_STALE_THRESHOLD - 1; i++) {
      s = nextNearbyPartnersState(s, { kind: 'failure' });
      // Under threshold — value must NOT clear yet.
      expect(s.state.count).toBe(3);
      expect(s.state.filtered).toBe(true);
    }
    s = nextNearbyPartnersState(s, { kind: 'failure' });
    expect(s.state).toEqual({ count: null, filtered: false });
    expect(s.failures).toBe(NEARBY_PARTNERS_STALE_THRESHOLD);
  });

  test('recovery: success after stale-clear installs fresh value cleanly', () => {
    // Sequence: known-good → 3 fails (cleared) → success → fresh
    // value installed and failures reset.
    let s: { state: NearbyPartnersState; failures: number } = {
      state: { count: 3, filtered: true },
      failures: 0,
    };
    for (let i = 0; i < NEARBY_PARTNERS_STALE_THRESHOLD; i++) {
      s = nextNearbyPartnersState(s, { kind: 'failure' });
    }
    expect(s.state.count).toBeNull();
    s = nextNearbyPartnersState(s, {
      kind: 'success',
      value: { count: 7, filtered: true },
    });
    expect(s).toEqual({
      state: { count: 7, filtered: true },
      failures: 0,
    });
    // A single post-recovery failure must NOT re-trip the threshold.
    s = nextNearbyPartnersState(s, { kind: 'failure' });
    expect(s.state.count).toBe(7);
    expect(s.failures).toBe(1);
  });

  test('counter resets on success between transient failures', () => {
    // Two failures (below threshold) → success → another failure.
    // The post-recovery counter must start from 0, not from 2.
    let s: { state: NearbyPartnersState; failures: number } = {
      state: { count: 3, filtered: true },
      failures: 0,
    };
    s = nextNearbyPartnersState(s, { kind: 'failure' });
    s = nextNearbyPartnersState(s, { kind: 'failure' });
    expect(s.failures).toBe(2);
    s = nextNearbyPartnersState(s, {
      kind: 'success',
      value: { count: 4, filtered: true },
    });
    expect(s.failures).toBe(0);
    s = nextNearbyPartnersState(s, { kind: 'failure' });
    expect(s.failures).toBe(1);
    expect(s.state.count).toBe(4);
  });

  test('custom threshold parameter is honored', () => {
    // Lets future callers tune tolerance without re-exporting the
    // module constant.
    const s = nextNearbyPartnersState(
      { state: { count: 5, filtered: true }, failures: 0 },
      { kind: 'failure' },
      1,
    );
    expect(s.state).toEqual({ count: null, filtered: false });
    expect(s.failures).toBe(1);
  });

  test('filtered transition: success can flip filtered=true → filtered=false', () => {
    // Owner unsets shop location → next poll surfaces filtered=false
    // alongside whatever count the fail-open branch produces. Hook
    // must track the flip even when count happens to stay the same.
    let s: { state: NearbyPartnersState; failures: number } = {
      state: { count: 3, filtered: true },
      failures: 0,
    };
    s = nextNearbyPartnersState(s, {
      kind: 'success',
      value: { count: 3, filtered: false },
    });
    expect(s.state.filtered).toBe(false);
    expect(s.state.count).toBe(3);
  });
});
