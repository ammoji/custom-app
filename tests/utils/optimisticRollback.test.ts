/**
 * Unit tests for src/utils/optimisticRollback.ts.
 *
 * The helper is one line — the value of these tests is encoding the
 * INVARIANT it protects so future contributors can't relax the
 * predicate without a failing test ringing the alarm. PR 3 prompt
 * names this file as the deliberate-break demo target.
 */
import { shouldRollbackOptimistic } from '../../src/utils/optimisticRollback';

describe('shouldRollbackOptimistic', () => {
  test('returns true when current still matches optimistic (no concurrent change)', () => {
    // Caller wrote 'preparing' optimistically. The watcher hasn't
    // installed anything new yet, so current is still 'preparing'.
    // Safe to rollback to the captured previous value.
    expect(shouldRollbackOptimistic('preparing', 'preparing')).toBe(true);
  });

  test('returns false when current differs (watcher installed something else; don\'t clobber)', () => {
    // Caller wrote 'preparing' optimistically; meanwhile the 10s
    // watcher tick saw the server flip to 'ready_for_pickup' and
    // installed it. Rolling back to the captured pre-optimistic
    // value would CLOBBER the authoritative state. Must return
    // false.
    expect(shouldRollbackOptimistic('ready_for_pickup', 'preparing')).toBe(
      false,
    );
  });

  test('uses strict equality (no deep comparison)', () => {
    // Two structurally-equal objects with different identities must
    // be treated as DIFFERENT. The contract is that callers pass
    // scalar status/timestamp values; if a caller accidentally
    // passes objects, fail loudly rather than silently equate them.
    const a = { status: 'preparing' };
    const b = { status: 'preparing' };
    expect(shouldRollbackOptimistic(a, b)).toBe(false);
    expect(shouldRollbackOptimistic(a, a)).toBe(true);
  });

  test('treats null and undefined as distinct', () => {
    // Common in pickedUpAt rollback: optimistic value was Date.now()
    // (a number), pre-optimistic was null. Strict-equal correctly
    // separates these.
    expect(shouldRollbackOptimistic(null, undefined)).toBe(false);
    expect(shouldRollbackOptimistic(null, null)).toBe(true);
    expect(shouldRollbackOptimistic(0, null as unknown as number)).toBe(false);
  });
});
