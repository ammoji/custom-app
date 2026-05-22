/**
 * PR 27 — Tests for the React-free `createPressGuard` factory that
 * underpins the `usePressGuard` hook. Same precedent as
 * `useOnlineDeliveryCount`: the guard logic is extracted into a pure
 * function so the contract can be pinned without RNTL /
 * react-test-renderer.
 *
 * Coverage:
 *   - First press passes through, awaits the handler, resolves.
 *   - Second press WHILE first is in-flight is swallowed (no-op).
 *   - After the first press resolves, the next press is allowed.
 *   - Handler rejection is propagated AND clears the guard.
 *   - Args + return value pass through unchanged.
 */
import { createPressGuard } from '../../src/hooks/usePressGuard';

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
} {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('PR 27 — createPressGuard', () => {
  test('first call invokes the handler and returns its value', async () => {
    const handler = jest.fn(async (x: number) => x * 2);
    const guarded = createPressGuard(handler);
    const out = await guarded(21);
    expect(handler).toHaveBeenCalledWith(21);
    expect(out).toBe(42);
  });

  test('re-entrant call WHILE first is in-flight is a no-op', async () => {
    const d = deferred<string>();
    const handler = jest.fn(async () => d.promise);
    const guarded = createPressGuard(handler);

    // First press — start it but don't await yet so it stays in-flight.
    const firstP = guarded();
    // Second press — fires WHILE first is still pending. Must be
    // synchronously swallowed (resolves to `undefined`).
    const secondP = guarded();

    // Handler invoked exactly once — the second call was swallowed.
    expect(handler).toHaveBeenCalledTimes(1);

    // Resolve the first; both promises now settle.
    d.resolve('ok');
    const [firstResult, secondResult] = await Promise.all([firstP, secondP]);
    expect(firstResult).toBe('ok');
    expect(secondResult).toBeUndefined();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test('after first call resolves, next press is allowed', async () => {
    const handler = jest.fn(async (n: number) => n);
    const guarded = createPressGuard(handler);
    await guarded(1);
    await guarded(2);
    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenNthCalledWith(1, 1);
    expect(handler).toHaveBeenNthCalledWith(2, 2);
  });

  test('handler rejection propagates AND clears the guard', async () => {
    const handler = jest
      .fn<Promise<void>, []>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);
    const guarded = createPressGuard(handler);

    await expect(guarded()).rejects.toThrow('boom');
    // After the rejection, the next press is allowed — the `finally`
    // path cleared the busy flag.
    await guarded();
    expect(handler).toHaveBeenCalledTimes(2);
  });

  test('args pass through unchanged, in order', async () => {
    const handler = jest.fn(
      async (a: string, b: number, c: boolean) => `${a}-${b}-${c}`,
    );
    const guarded = createPressGuard(handler);
    const out = await guarded('hi', 7, true);
    expect(handler).toHaveBeenCalledWith('hi', 7, true);
    expect(out).toBe('hi-7-true');
  });
});
