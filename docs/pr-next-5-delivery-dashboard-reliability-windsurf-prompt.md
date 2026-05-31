# PR-NEXT-5 — Delivery dashboard error-banner dampening (Windsurf prompt)

> Finding #7 in `docs/TESTING-FINDINGS-2026-05-30.md`. Finding #8 is
> already closed (shipped in PR 50 via `getMyDeliverySettings` on
> dashboard focus); this PR is just the dampening fix for #7.
>
> Symptom: the delivery partner's dashboard repeatedly flashes
> "The network connection was lost. Retry." for a few seconds, then
> the banner disappears, then it reappears. The dashboard's two
> watchers (`watchAvailableDeliveries`, `watchMyDeliveries`) poll
> the server every 10–15s, and the existing reconciler shows the
> banner the *instant* both watchers happen to be in error state on
> the same tick. A single shared network blip (Cloud Run cold start,
> iOS TCP idle reap, etc.) triggers it; next successful poll
> dismisses it; another blip brings it back. **The partner loses
> confidence in the system long before they have any actual problem
> to act on.**
>
> Pure JS/TS, single-screen change + one new pure helper.
> **OTA-safe** — no server change, no native module, no permission,
> no `app.json` change. Ships via `eas update --branch production`.
> Estimated Windsurf effort: ~25–40 min.

## Why this PR exists

The existing reconciler at
`src/screens/delivery/DeliveryDashboardScreen.tsx` lines 123–137
already has *one* defense: it requires **both** watchers to be in
error state before showing the banner (so a single watcher hiccup
doesn't surface). What it lacks is a *temporal* defense: if both
watchers happen to fail on the same tick — which absolutely happens
during a Cloud Run cold start or a brief network gap — the banner
shows immediately, then disappears 10–15s later when the next poll
succeeds. From the partner's perspective: flicker, flicker, flicker.

PR-NEXT-5 adds a second gate: a per-watcher consecutive-failure
counter. The banner only shows when **both** watchers have failed
**N=3 times in a row**. A single successful poll on either watcher
resets that watcher's counter. With the existing 10s / 15s poll
intervals, N=3 means a real outage of ~30–45 seconds before the
partner sees the banner. Anything shorter than that is just
"network jitter" and they don't need to know.

We also add a Sentry `captureMessage` once per outage *event* (the
transition into "showing" state) so we get diagnostic signal
without flooding Sentry, plus a breadcrumb on every failed poll
so any captured event has a useful trail.

## Read first

- `docs/TESTING-FINDINGS-2026-05-30.md` → finding #7. (Finding #8
  already shipped in PR 50, ignore the "remnants of #8" framing
  from older queue planning — it's done.)
- `src/screens/delivery/DeliveryDashboardScreen.tsx`:
  - **~lines 117–175** — the existing watcher subscription
    `useEffect`. The reconciler + the two `cb` handlers are where
    the new gate logic lives.
  - **~line 75** — `setError` state. Unchanged in shape.
- `src/services/orderService.ts`:
  - **`watchAvailableDeliveries`** (~line 1577) — already has the
    contract "cb(data, undefined) on success, cb([], err) on
    failure." **Do not change.** The dampening lives on the screen,
    not in the watcher, so we don't disturb other consumers
    (`watchMyDeliveries`, `watchShopOrders`, `watchAllOrders`,
    `watchOrder`) or change the contract.
- `src/services/sentry.ts` (or wherever the Sentry wrapper lives —
  PR 26 + PR 45.1 added the pattern). Mirror the
  `addBreadcrumb` / `captureMessage` calls used elsewhere
  (`AuthBootstrap` line 131-139 is a good reference).
- `.windsurf/code-discipline.md`:
  - Rule 2 (hooks above conditional early returns). The new state
    + ref additions in DeliveryDashboardScreen go ABOVE the
    `if (!isDelivery) return …` / `if (loading) return …` early
    returns.
  - Rule 1 (import-strip). Adding `Sentry` import on the screen
    if not already present.

## Locked design decisions

- **Threshold N = 3 consecutive failures per watcher** before its
  counter is considered "tripped." At the existing poll cadences
  (10s for `mine`, 15s for `available`) this means the banner
  shows only after the slower watcher has had **~45 seconds of
  uninterrupted failure** — well past any reasonable transient.
- **Counter is per-watcher.** A watcher that's failing while the
  other is succeeding doesn't trip the banner — same as the
  existing "both must error" rule, just elevated to "both must be
  *persistently* erroring."
- **Reset to 0 on any success for that watcher.** Single successful
  poll clears that watcher's counter.
- **Banner shows iff BOTH watchers' counters >= N.** Preserves
  the existing "both must error" gate's spirit at a temporal level.
- **Sentry signal:** `captureMessage('Delivery dashboard outage:
  both watchers failed N+ times', 'warning')` fired ONCE per outage
  event (when the banner first appears after being hidden). Don't
  re-fire on every subsequent failed poll while the banner is
  showing — that'd spam Sentry during an actual outage. Reset the
  "did we capture this outage" flag when the banner goes back to
  hidden (any successful poll on either watcher).
- **Breadcrumb on every failed poll** with the error message + HTTP
  code (when available) + the current consecutive-failure count.
  Breadcrumbs are local to a captured event — no Sentry spam — but
  give us a trail of "what was happening just before the outage."
- **Pure helper** for the counter logic so it's unit-testable.
  Mirrors the convention established by `deliveryRoutingHelpers`,
  `displayOrderStatus`, `notificationRadiusHelpers`, `codPaymentHelpers`.
- **Out of scope deliberately:** changing the watcher contract,
  applying the same dampening to other screens (`AdminOrdersScreen`,
  `ShopOwnerDashboardScreen`, `OrderDetailScreen` — if they exhibit
  the same problem they get their own follow-up PR with shared use
  of the new helper), increasing Cloud Functions `minInstances`
  (recurring cost; out of scope per CLAUDE.md), backoff polling.

## Scope of changes

### A. New pure helper — `src/utils/pollFailureGate.ts`

Centralizes the consecutive-failure-counter decision so it's testable
without rendering React.

```ts
/**
 * PR-NEXT-5 — temporal dampening for polling-watcher error banners.
 *
 * The Delivery Dashboard polls two callables every 10–15s and shows
 * a "Network connection lost" banner when both happen to be in
 * error state. A single transient blip (Cloud Run cold start, iOS
 * idle-connection reap, …) makes the banner flicker, which the
 * partner reads as "the system is broken." This helper tracks
 * consecutive failures per watcher and only flips a watcher's
 * `tripped` flag once N failures stack up uninterrupted.
 *
 * Pure / no React / no Firebase. The screen owns the counter
 * state (in refs or as a closure variable inside useEffect); this
 * helper just decides what to do with each new outcome.
 */

/** Default before flipping `tripped`. ~45s at the slower 15s cadence. */
export const POLL_FAILURE_THRESHOLD = 3;

export type PollOutcomeKind = 'success' | 'failure';

export type PollGateUpdate = {
  /** New consecutive-failure count. Always 0 after a 'success'. */
  nextCount: number;
  /** True once `nextCount >= threshold`. */
  tripped: boolean;
  /**
   * Distinguishes the moment we cross from below-threshold to at-or-
   * above-threshold. Useful for "captureMessage once per outage,
   * not on every subsequent failed poll" semantics. Always false
   * on `success` outcomes.
   */
  justTripped: boolean;
};

/**
 * Apply a new poll outcome to the current consecutive-failure count
 * and decide what the new state + signals are.
 *
 *   success → nextCount=0, tripped=false, justTripped=false
 *   failure → nextCount=currentCount+1, tripped=(nextCount >= threshold),
 *             justTripped=(was below before this call)
 */
export function applyPollOutcome(opts: {
  currentCount: number;
  outcome: PollOutcomeKind;
  threshold?: number;
}): PollGateUpdate {
  const threshold = opts.threshold ?? POLL_FAILURE_THRESHOLD;
  if (opts.outcome === 'success') {
    return { nextCount: 0, tripped: false, justTripped: false };
  }
  const nextCount = Math.max(0, opts.currentCount) + 1;
  const wasTripped = opts.currentCount >= threshold;
  const tripped = nextCount >= threshold;
  return {
    nextCount,
    tripped,
    justTripped: tripped && !wasTripped,
  };
}
```

### B. Wire the gate into `DeliveryDashboardScreen.tsx`

`src/screens/delivery/DeliveryDashboardScreen.tsx`. Two changes
inside the existing watcher `useEffect` (~line 117–175):

**1. Track per-watcher failure counts.** Replace the simple
`availableErr` / `mineErr` `Error | null` variables (lines 123-124)
with counter-bearing state:

```ts
let availableCount = 0;
let mineCount = 0;
let outageCaptured = false;     // suppress repeated captureMessage
                                // while banner is showing
let latestErrorMessage: string | null = null;  // for the banner copy
                                               // (most recent err wins)

const reconcileError = () => {
  const availableTripped = availableCount >= POLL_FAILURE_THRESHOLD;
  const mineTripped = mineCount >= POLL_FAILURE_THRESHOLD;
  if (availableTripped && mineTripped) {
    setError(
      latestErrorMessage ||
      'Network connection lost. Tap Retry.',
    );
  } else {
    setError(null);
    // Reset the outage-captured flag so the NEXT outage fires its
    // own captureMessage.
    outageCaptured = false;
  }
};
```

**2. Apply the gate inside each watcher callback.** Each callback
calls `applyPollOutcome` and updates its counter, then runs
`reconcileError()`. The error-message-storage moves to a single
shared variable so the banner shows the latest reason:

```ts
const off1 = orderService.watchAvailableDeliveries((list, err) => {
  if (err) {
    const update = applyPollOutcome({
      currentCount: availableCount,
      outcome: 'failure',
    });
    availableCount = update.nextCount;
    latestErrorMessage = err.message || latestErrorMessage;
    setAvailable([]);
    void handleRoleAuthError(err, authService.refreshClaims, setUser);

    // PR-NEXT-5 — breadcrumb on every failed poll. Gives Sentry a
    // trail leading up to any captured event.
    Sentry.addBreadcrumb({
      category: 'delivery-dashboard',
      message: 'watchAvailableDeliveries poll failed',
      level: 'warning',
      data: {
        consecutiveFailures: availableCount,
        errorMessage: err.message?.slice(0, 200) ?? null,
        // Try to surface the HTTP code if firebase-functions wraps
        // it on the error; safe-cast fallback to null.
        functionsCode:
          typeof (err as any)?.code === 'string'
            ? (err as any).code
            : null,
      },
    });
  } else {
    const update = applyPollOutcome({
      currentCount: availableCount,
      outcome: 'success',
    });
    availableCount = update.nextCount;
    setAvailable(list);
  }
  reconcileError();
  markLoaded();
  maybeCaptureOutage();
});

const off2 = orderService.watchMyDeliveries((list, err) => {
  // Mirror image of off1: same counter logic, same breadcrumb shape,
  // updates `mineCount` + `setMine` instead.
  // ...
});
```

**3. Capture the outage once per event.**

```ts
const maybeCaptureOutage = () => {
  const availableTripped = availableCount >= POLL_FAILURE_THRESHOLD;
  const mineTripped = mineCount >= POLL_FAILURE_THRESHOLD;
  if (availableTripped && mineTripped && !outageCaptured) {
    outageCaptured = true;
    Sentry.captureMessage(
      'Delivery dashboard outage: both watchers failed ' +
        `${POLL_FAILURE_THRESHOLD}+ times consecutively`,
      'warning',
    );
  }
};
```

**Hooks discipline (Rule 2):** all of the above lives inside the
existing `useEffect`. No new `useState` or refs are needed — the
counters are closure variables inside the effect, just like the
existing `availableErr` / `mineErr` were. Cleanup on unmount is
unchanged (the closure goes with the effect's lifetime).

**4. Import `Sentry`** at the top of the screen if not already
present (PR 45.2 might have added it elsewhere — grep first):

```ts
import { Sentry } from '../../services/sentry';
import {
  applyPollOutcome,
  POLL_FAILURE_THRESHOLD,
} from '../../utils/pollFailureGate';
```

⚠️ **Import-strip discipline (Rule 1):** confirm both imports stick
after the edit; the auto-formatter has stripped the
`handleRoleAuthError` / `authService` / `shouldRollbackOptimistic`
block from this file twice already (see the comment block at line
19-23). If the new imports vanish after a save, re-add them.

### C. Retry-button still works

The existing "Retry" pill at the top of the banner (lines 574-582 in
the screen) bumps `retryNonce`, which re-fires the watcher effect.
The new design means: tapping Retry tears down and re-subscribes,
which resets `availableCount` / `mineCount` to 0 by closure
restart, and gives the partner an immediate manual recovery path
that doesn't have to wait for the next 10/15s poll. **No change to
the button — it already does the right thing under the new design.**

## Tests

**New: `tests/utils/pollFailureGate.test.ts`** — pin the small
matrix:

- Success → count resets to 0, tripped=false, justTripped=false (whether
  current was 0, mid-stream, or already past threshold).
- First failure → count=1, tripped=false (assuming threshold=3).
- Failure that takes count from threshold-1 → threshold: tripped=true,
  justTripped=true.
- Failure already at-or-past threshold: tripped=true, justTripped=false
  (so captureMessage doesn't re-fire mid-outage).
- Recovery sequence: 3 fails (tripped) → success (reset) → 2 fails
  (not tripped) → 1 more fail (justTripped=true again, second outage).
- Custom threshold override (passed in via `opts.threshold`).
- Defensive: negative `currentCount` clamps to 0 (math.max guard).

`npm test` must stay green. Suite count expected to grow by ~7–10
cases.

## Deploy plan

**Client-only — no server change, no Firestore, no Cloud Run.**

```
eas update --branch production --message "PR-NEXT-5 delivery dashboard error-banner dampening"
```

That's it. No `firebase deploy`, no IAM verify, no Razorpay secret.

## Smoke acceptance

These need ~5 minutes of observation on the delivery partner role:

1. **Steady-state silence:** sign in as delivery partner, leave the
   dashboard open for ~2 minutes on a stable network. The banner
   should NEVER appear. (Pre-fix: it would appear and disappear at
   least once during that window for most testers.)
2. **Single-tick blip absorbed:** with Wi-Fi on, briefly toggle
   Airplane Mode on and off (be quick — <10 seconds). One or both
   watchers will hit a transient failure but recover on the next
   tick. **Banner must not appear.** Pre-fix: it would appear for
   ~10-15s.
3. **Real outage shows correctly:** turn Airplane Mode on and leave
   it on. After ~30-45 seconds (three consecutive failures on both
   watchers), the banner appears with "Network connection lost." Tap
   Retry → instantly shows it's trying again (then fails) — that's
   fine. Turn Wi-Fi back on. Next successful poll on either watcher
   clears the banner.
4. **Sentry captureMessage fires once per outage:** check the
   Sentry dashboard after step 3 — there should be exactly **one**
   "Delivery dashboard outage" warning event, not three or seven.
   Click into it and confirm the breadcrumb trail shows the lead-up
   failed polls with their `consecutiveFailures` counts.
5. **Recovery captures a new outage cleanly:** repeat step 3 (a
   second airplane-mode outage). A second distinct "Delivery
   dashboard outage" event should appear in Sentry — separate event,
   not appended to the first.

## Out of scope (do not pull in)

- Applying the same dampening to other polling watchers
  (`AdminOrdersScreen`, `ShopOwnerDashboardScreen`,
  `OrderDetailScreen`). The new `pollFailureGate` helper is
  general-purpose and can be reused in follow-ups if those screens
  exhibit the same problem — but this PR's scope is the one screen
  finding #7 was raised against. Don't expand without a real
  reported issue.
- Changing the watcher contract in `orderService.ts`. The
  dampening lives at the screen layer where the user-facing banner
  decision actually happens.
- Increasing Cloud Functions `minInstances` to eliminate cold
  starts. Per CLAUDE.md ("PR 36.1 cold-start fix was deferred per
  Sudhir's cost-conservative call"), this stays off during pilot.
  Recurring cost; out of scope for a UX fix.
- Adaptive polling (backing off interval on consecutive failures).
  Not needed at pilot scale; adds a state machine; over-engineered
  for the actual UX symptom.
- Bumping the poll intervals (10s/15s). Snappy for the working
  case; the new dampening covers the failure case.
- Showing an in-banner countdown ("retrying in Xs"). Not needed —
  the Retry button is right there.

## Update doc trail after shipping

1. Mark finding #7 SHIPPED in
   `docs/TESTING-FINDINGS-2026-05-30.md`.
2. Bump test suite count in `CLAUDE.md` Current state.
3. (Optional) Append a SESSION_LOG entry noting the
   `pollFailureGate` helper pattern + the "fire captureMessage once
   per outage event, not per failed poll" Sentry-hygiene rule —
   worth folding into `.windsurf/code-discipline.md` if it surfaces
   in future polling-watcher code reviews.
