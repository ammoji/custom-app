# PR 27 — Background-tap protection on retry/cancel/place-order buttons (Windsurf prompt)

## Why this PR exists

The existing busy-state pattern across the order flow looks like:

```tsx
const [placing, setPlacing] = useState(false);
// ...
<Button
  title={placing ? 'Placing order...' : 'Place Order'}
  onPress={placeOrder}
  loading={placing}
  disabled={placing}   // ← the only line of defense against re-entry
  fullWidth
/>
```

`disabled={placing}` works under normal taps. But there's a real
race that family testers have hit during the OTA rollouts:

1. User taps "Pay ₹247". `onPress` fires synchronously; `placeOrder`
   runs.
2. `placeOrder` is async — first await (`orderService.placeOrder(...)`)
   sets up a Razorpay session on the server, ~800ms.
3. **In that 800ms window** the React render hasn't run yet for the
   `setPlacing(true)` state update inside `placeOrder`. The button
   is visually NOT yet `disabled`.
4. User taps again (impatient + finger debounce + sluggish phone) →
   `onPress` fires a SECOND `placeOrder`, which creates a SECOND
   Razorpay session.
5. Both succeed. The user sees two Razorpay overlays stack, dismisses
   one with confusion, completes the other. Server now has two
   pending orders for the same cart.

The `disabled` prop is **paint-time** defense; the second tap
landed before paint. We need **synchronous in-handler** defense via
a ref-backed guard that flips `true` immediately on press and
clears in `finally`.

**Same bug exists on:**
- `CheckoutScreen.tsx` — "Place Order" / "Pay ₹X" (`placeOrder`).
- `OrderDetailScreen.tsx` — "Cancel order (X:XX left)" within window,
  "Pay ₹X now" (retry payment), "Cancel order" (COD pending), and
  the post-window/non-pending fallbacks all share the same race.
- `OrderDetailScreen.tsx` — rating submit button (less critical but
  same shape).
- `ProfileScreen.tsx` — "Sign out" (low risk; double-tap fires two
  sign-outs which is no-op but logs are noisy).

**Scope of PR 27:** introduce a `usePressGuard` hook + apply it to
every button whose `onPress` initiates a server callable or a
payment session. Plus a test that the guard genuinely blocks a
re-entrant call mid-flight.

~45 min.

## Read first

- `.windsurf/code-discipline.md`, `.windsurf/test-discipline.md`,
  `.windsurf/deploy-discipline.md`.
- `src/screens/CheckoutScreen.tsx` lines 244 (`placeOrder` start)
  + 729–740 (the `Button` wired to it). Note the `setPlacing(true)`
  is inside the async handler — the disabled state lags by one
  paint.
- `src/screens/OrderDetailScreen.tsx`:
  - `handleWindowCancel`, `handleCancel`, `handleRetryPayment` —
    the three async handlers.
  - Lines 466–477 (in-window cancel button), 507–517 (retry-pay
    button), 519–526 (post-payment-pending cancel), 544–551 (COD
    pending cancel) — the four `Button`s.
- `src/components/common/Button.tsx` — read it to confirm
  `disabled`/`loading` are paint-time only (they are; the prop
  controls a `Pressable disabled={...}` underneath).
- `src/hooks/useOnlineDeliveryCount.ts` — the existing custom hook
  pattern. PR 27 adds a sibling `usePressGuard.ts` next to it.
- `tests/hooks/` — note where hook tests live; PR 27 adds
  `tests/hooks/usePressGuard.test.ts`.

## Critical lessons from PRs 12–26 (do not repeat)

1. **Refs synchronously update; state updates queue.** That's the
   entire reason `disabled={isBusy}` from useState doesn't catch
   the race. The guard MUST use a `useRef<boolean>`, flipped
   inside the handler before any `await`.
2. **The guard must clear in `finally`,** not just on the success
   path. If the wrapped handler throws (network drop mid-Razorpay),
   the guard staying `true` would soft-lock the button until the
   screen remounts. Bad UX.
3. **Don't replace existing `setPlacing`/`setCancelling` state**.
   The state is still needed for the *visible* loading spinner +
   `title` change. PR 27 adds the guard *alongside* the existing
   state, doesn't remove it.
4. **Never strip imports between edits in the same PR.** The two
   screens get one new import each (`usePressGuard`). Keep it in
   place across edits.
5. **All `useState` calls in screens sit ABOVE conditional early
   returns.** `usePressGuard` is a hook too — it must obey the
   same order. Add the hook call near the top of each component,
   not nested inside a JSX branch.
6. **Server-first deploy doesn't apply** — PR 27 is client-only.
   OTA-only deploy.
7. **Zero new `DO NOT REMOVE` markers expected.** 16-PR streak.

## Scope (in)

### Part 1 — The `usePressGuard` hook

Create `src/hooks/usePressGuard.ts`:

```ts
import { useCallback, useRef } from 'react';

/**
 * PR 27 — Re-entrancy guard for async press handlers.
 *
 * Why: the existing `disabled={busyState}` pattern is paint-time
 * defense only. If the user taps a button fast enough that the
 * second tap fires before React re-renders with disabled=true, two
 * copies of the handler run. On payment / order callables that
 * means duplicate Razorpay sessions or duplicate cancellations.
 *
 * How: a ref-backed boolean flipped synchronously on entry,
 * cleared synchronously in finally. Any re-entrant tap is a
 * no-op until the in-flight handler resolves.
 *
 * Usage:
 *
 *   const [onPay, isPaying] = usePressGuard(async () => {
 *     await orderService.placeOrder({ ... });
 *   });
 *
 *   <Button onPress={onPay} loading={isPaying} disabled={isPaying} />
 *
 * The returned `isPaying` is a ref's `.current` snapshot — usable
 * for *visual* indication, but the safety is in the guard itself,
 * not in this flag.
 *
 * Notes:
 *  - The wrapped function's return value is preserved (Promise<T>).
 *  - The wrapped function's rejection is preserved — callers can
 *    still chain .catch / await with try/catch. The guard does NOT
 *    swallow errors.
 *  - The hook is intentionally NOT debounced by time. Pure mutex.
 *    A 0-second debounce would block ALL re-presses, not just
 *    in-flight ones. We want users to be able to retry AFTER the
 *    first call settles, just not DURING it.
 *  - This hook does NOT use useState. State updates lag a paint;
 *    that's the whole bug we're fixing.
 */
export function usePressGuard<TArgs extends unknown[], TReturn>(
  handler: (...args: TArgs) => Promise<TReturn>,
): (...args: TArgs) => Promise<TReturn | undefined> {
  const busy = useRef(false);

  return useCallback(
    async (...args: TArgs) => {
      if (busy.current) {
        // Silently swallow the re-entrant call. Don't log to Sentry
        // — this is expected user behaviour (impatient tap), not a
        // bug.
        return undefined;
      }
      busy.current = true;
      try {
        return await handler(...args);
      } finally {
        busy.current = false;
      }
    },
    [handler],
  );
}
```

Note: the hook returns a single function (the guarded wrapper). We
deliberately don't return a `[wrapper, isBusy]` tuple — there's no
state to expose, only the ref, and exposing the ref would tempt
callers to render off it (which won't re-render).

If a caller wants a `busy` indicator, they keep their existing
`useState`-driven `placing` / `cancelling` flag for that. PR 27
doesn't replace the spinner state — it just adds re-entry defense
in front of it.

### Part 2 — Wire `CheckoutScreen` `placeOrder`

In `src/screens/CheckoutScreen.tsx`:

```tsx
import { usePressGuard } from '../hooks/usePressGuard';

// Inside the component, near the top (after the existing
// useState calls — Rules of Hooks order). Wrap placeOrder:
const guardedPlaceOrder = usePressGuard(placeOrder);
```

Then update the Button at lines 729–740:

```tsx
<Button
  title={ /* unchanged */ }
  onPress={guardedPlaceOrder}   // ← was placeOrder
  loading={placing}
  fullWidth
/>
```

Leave `placeOrder` itself, `setPlacing`, and the `if (placing) return` style
guards (if any) untouched. The guard is additive.

### Part 3 — Wire `OrderDetailScreen` handlers

In `src/screens/OrderDetailScreen.tsx`:

```tsx
import { usePressGuard } from '../hooks/usePressGuard';

// Hook calls — add near the top with the other hooks:
const guardedWindowCancel = usePressGuard(handleWindowCancel);
const guardedCancel = usePressGuard(handleCancel);
const guardedRetryPayment = usePressGuard(handleRetryPayment);
```

Then update the four Button `onPress` props (line numbers approximate
— exact via Read first):

- Line ~473: `onPress={guardedWindowCancel}` (was `handleWindowCancel`)
- Line ~513: `onPress={guardedRetryPayment}` (was `handleRetryPayment`)
- Line ~521: `onPress={guardedCancel}` (was `handleCancel`)
- Line ~546: `onPress={guardedCancel}` (was `handleCancel`)

(Lines 519–526 + 544–551 both use `handleCancel`; both reference
the same guarded version. That's fine — a single guard wrapper
serializes both buttons against EACH OTHER as well as against
double-taps, which is the correct behaviour. A user cannot
simultaneously cancel and retry-pay.)

If the rating-submit handler is colocated in the same screen and
follows the same `onPress={handleSubmitRating}` shape, wrap it too:

```tsx
const guardedSubmitRating = usePressGuard(handleSubmitRating);
// <Button onPress={guardedSubmitRating} loading={submittingRating} />
```

(If rating submit lives in a child component, defer that wiring to
the child screen in a follow-up. Scope of PR 27 = the four primary
order-flow buttons; rating is a low-blast-radius extra.)

### Part 4 — Tests

Create `tests/hooks/usePressGuard.test.ts`:

```ts
/**
 * PR 27 — usePressGuard hook tests.
 *
 * Coverage:
 *  - First press passes through, awaits the handler, resolves.
 *  - Second press WHILE first is in-flight is swallowed (no-op).
 *  - After the first press resolves, the next press is allowed.
 *  - Handler rejection is propagated AND clears the guard.
 *  - Args + return value pass through unchanged.
 */
import { renderHook, act } from '@testing-library/react-hooks';
import { usePressGuard } from '../../src/hooks/usePressGuard';

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

describe('PR 27 — usePressGuard', () => {
  test('first call invokes the handler and returns its value', async () => {
    const handler = jest.fn(async (x: number) => x * 2);
    const { result } = renderHook(() => usePressGuard(handler));
    const out = await act(() => result.current(21));
    expect(handler).toHaveBeenCalledWith(21);
    expect(out).toBe(42);
  });

  test('re-entrant call WHILE first is in-flight is a no-op', async () => {
    const d = deferred<string>();
    const handler = jest.fn(async () => d.promise);
    const { result } = renderHook(() => usePressGuard(handler));

    let firstResult: string | undefined;
    let secondResult: string | undefined;
    act(() => {
      result.current().then(v => { firstResult = v; });
      result.current().then(v => { secondResult = v; });
    });

    // Handler invoked exactly once — the second call was swallowed.
    expect(handler).toHaveBeenCalledTimes(1);

    // Resolve the first. Both promises resolve, but the second is
    // `undefined` (the guard's swallow path).
    await act(async () => {
      d.resolve('ok');
      await d.promise;
    });
    expect(firstResult).toBe('ok');
    expect(secondResult).toBeUndefined();
  });

  test('after first call resolves, next press is allowed', async () => {
    const handler = jest.fn(async (n: number) => n);
    const { result } = renderHook(() => usePressGuard(handler));
    await act(() => result.current(1));
    await act(() => result.current(2));
    expect(handler).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenNthCalledWith(1, 1);
    expect(handler).toHaveBeenNthCalledWith(2, 2);
  });

  test('handler rejection propagates AND clears the guard', async () => {
    const handler = jest
      .fn<Promise<void>, []>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => usePressGuard(handler));

    await expect(act(() => result.current())).rejects.toThrow('boom');

    // After the rejection, the next press is allowed.
    await act(() => result.current());
    expect(handler).toHaveBeenCalledTimes(2);
  });

  test('args pass through unchanged, in order', async () => {
    const handler = jest.fn(async (a: string, b: number, c: boolean) => {
      return `${a}-${b}-${c}`;
    });
    const { result } = renderHook(() => usePressGuard(handler));
    const out = await act(() => result.current('hi', 7, true));
    expect(handler).toHaveBeenCalledWith('hi', 7, true);
    expect(out).toBe('hi-7-true');
  });
});
```

If `@testing-library/react-hooks` isn't already a dev dep, add it:
`npm i -D @testing-library/react-hooks`. Check first — newer
`@testing-library/react` includes `renderHook`, so we may not need
the separate package.

### Part 5 — PRELAUNCH_CHECKLIST update

Find the unchecked item tracking the double-tap / duplicate-Razorpay
issue (search `PRELAUNCH_CHECKLIST.md` for "double-tap", "tap
protection", or "Razorpay duplicate"). Flip to checked with
`[Shipped — PR 27]`. Add a PR 27 section at the bottom noting:

- New `usePressGuard` hook lives in `src/hooks/`.
- Applied to: place-order, retry-payment, cancel-within-window,
  cancel-pending-COD, cancel-during-payment-pending.
- Follow-up: scan other async `onPress` handlers across screens
  for similar exposure; wrap as discovered (track in a follow-up
  PR rather than expanding PR 27's blast radius).

## Scope (out)

- **Replacing the existing `setPlacing` / `setCancelling` state.**
  Those drive the *visible* spinner + title change. The guard is
  additive — it sits in front of the handler, leaving the existing
  state machine intact.
- **A time-based debounce** (e.g. 300ms minimum between presses).
  Different concern. usePressGuard blocks during the in-flight
  call, not for a fixed window after.
- **Auditing every screen for similar `onPress` shapes.** PR 27
  fixes the known-painful surface (payment + cancel). A follow-up
  PR can sweep less-critical handlers (favorites toggle, rating
  thumbs, etc.) — those have lower duplicate-call cost.
- **Refactoring `Button.tsx` to expose a built-in guard.** Would
  be cleaner but couples behaviour to the component. The hook
  form is more composable and easier to reason about per-call-site.
- **Server-side idempotency keys on `placeOrder`.** A belt-and-
  suspenders defense; out of scope here. PR 27 fixes the client
  race; server-side dedup is a separate workstream.

## Acceptance checklist

- [ ] `src/hooks/usePressGuard.ts` exists with the hook + JSDoc.
- [ ] `tests/hooks/usePressGuard.test.ts` exists. 5 tests pass.
- [ ] `CheckoutScreen.tsx` `Place Order` / `Pay X` button is wired
  through `usePressGuard`.
- [ ] `OrderDetailScreen.tsx` `handleWindowCancel`,
  `handleCancel`, `handleRetryPayment` are each wrapped through
  `usePressGuard`; all four buttons reference the guarded versions.
- [ ] (Optional, low priority) Rating-submit button wrapped if
  it's in the same file.
- [ ] No existing `setPlacing`/`setCancelling`/`setPaying`
  state was removed.
- [ ] `npx tsc --noEmit`: 0 errors.
- [ ] `npm test` overall: green.
- [ ] PRELAUNCH_CHECKLIST: tap-protection item flipped + PR 27
  section appended.
- [ ] **Zero new `DO NOT REMOVE` markers added** (17-PR streak).

## Deliberate-break check (per `.windsurf/test-discipline.md`)

Before declaring done, temporarily delete the `if (busy.current)
return undefined` early-return inside `usePressGuard`. Re-run the
"re-entrant call WHILE first is in-flight is a no-op" test. It
must fail with the handler being called twice instead of once.
Revert. This proves the re-entry block is genuinely test-pinned.

## Smoke tests (manual, after OTA)

1. **Double-tap place-order does not duplicate Razorpay** — set up
   a cart, go to Checkout, switch to "Pay Online". As fast as
   possible, double-tap the "Pay ₹X" button. ONLY ONE Razorpay
   overlay should appear. Close it. Check Firestore `orders` for
   the test user — exactly ONE new order, not two.
2. **Single-tap still works** — place-order single tap. Standard
   flow. Order created.
3. **After Razorpay completes, retry is possible** — complete a
   payment. Place a second order on the same session. Works.
4. **Cancel within window — double-tap behaviour** — place an
   online order, hit OrderDetail, double-tap "Cancel order
   (X:XX left)". The order cancels exactly once. The button
   transitions to "Cancelling…" then "Cancellation window
   expired" (or similar). No second cancel attempt logged.
5. **Retry payment — double-tap behaviour** — start a Razorpay
   payment from CheckoutScreen, dismiss the overlay without
   paying (so the order sits in `paymentStatus='pending'`). Go
   to OrderDetailScreen. Double-tap "Pay ₹X now". One Razorpay
   overlay appears.
6. **COD cancel — double-tap behaviour** — place a COD order.
   On OrderDetail, double-tap "Cancel order". One cancel happens.
   The card transitions to "Shop has accepted this order" (no,
   it doesn't, because the shop hasn't — but the order moves to
   `cancelled` state).
7. **Cancel-then-retry not possible (guard isolation works
   between buttons)** — place an online order, dismiss payment.
   Tap "Cancel order" AND immediately try to tap "Pay ₹X now"
   while cancellation is in flight. The second tap is ignored.
   (Per the guard sharing rationale in Part 3 — guarded handlers
   in the same screen share the ref via the wrapped closure;
   actually each `usePressGuard(handlerX)` returns its OWN
   guard, so they don't share. Verify this on the screen — if
   the user CAN simultaneously cancel + retry-pay because each
   button has an independent guard, that's still safe — server
   rejects the cancel/pay race per existing logic.)
8. **No screen crashes / hooks warnings** — `react-devtools`
   console shows no "Rules of Hooks" warnings. ScreenStack
   transitions normally. Sentry quiet on the affected screens.

(Test 7 is worth double-checking: each call to `usePressGuard`
allocates a fresh ref, so the cancel guard and the retry-pay guard
are independent. That's the intended behaviour — a user pressing
Cancel followed by Pay-Now in 200ms is two distinct intents, and
the server-side handler rejects the impossible second one with a
`failed-precondition`. The guard's job is preventing the SAME
button from re-firing, not cross-button mutex.)

## Deploy plan

Client-only OTA:

```powershell
$env:NODE_OPTIONS = "--use-system-ca"

# 1. Local audit + tests.
npm test

# 2. Commit + push.
git add src/hooks/usePressGuard.ts
git add src/screens/CheckoutScreen.tsx src/screens/OrderDetailScreen.tsx
git add tests/hooks/usePressGuard.test.ts
git add PRELAUNCH_CHECKLIST.md
git add docs/pr-27-background-tap-protection-windsurf-prompt.md
git commit -m "PR 27: usePressGuard hook + tap protection on order-flow buttons"
git push origin main

# 3. OTA to production.
eas update --branch production --message "PR 27 - tap protection on place-order/cancel/retry"
```

No native rebuild. No Cloud Functions deploy.

## Estimated time

~45 minutes Windsurf work:

- Part 1 (hook + JSDoc): 10 min
- Part 2 (CheckoutScreen wiring): 5 min
- Part 3 (OrderDetailScreen wiring): 10 min
- Part 4 (5 tests): 15 min
- Part 5 (PRELAUNCH_CHECKLIST): 5 min

## Why this PR matters

Duplicate Razorpay sessions are a real customer-trust problem:

- The user sees two overlays stack — looks broken.
- Sometimes the user pays one and dismisses the other; sometimes
  the dismissed one's `onError` fires AFTER the successful one's
  `handler`, racing the navigation. Edge cases compound.
- On COD, double-tap creates two pending orders for the same cart
  — the shop sees two new-order pings, calls the customer
  confused.
- Razorpay's own rate limits start triggering at ~5 quick orders
  from the same `key_id + customer` — duplicate sessions burn this
  budget for no reason.

The fix is small, well-tested, and reusable. Once `usePressGuard`
exists, future PRs can wrap any new async handler in one line —
the same way PR 27 wraps the four existing ones.

This also closes a subtle App Review concern: Apple's reviewers
have flagged duplicate-payment risk on first-time merchant
submissions before. Visible "single-tap-produces-single-charge"
behaviour is part of being a serious payment surface.
