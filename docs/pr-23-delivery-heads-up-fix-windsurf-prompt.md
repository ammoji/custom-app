# PR 23 — Delivery "Heads up — coming soon" regression fix (Windsurf prompt)

## Why this PR exists

A delivery-partner family tester reported that tapping any card in
the dashboard's **"Heads up — coming soon"** rail opened the
delivery order detail screen with the message
**"Already taken — Another partner claimed this pickup."** No partner
had actually claimed the order. The status was `accepted` or
`preparing`; nobody had claimed anything yet. The screen was wrong.

The bug is a flag-derivation regression introduced when PR 12
shipped the heads-up rail. PR 12 changed the server's
`listAvailableDeliveries` to return the union of `{accepted,
preparing, ready_for_pickup}` orders, and wired the dashboard's
`HeadsUpCard` to navigate into `DeliveryOrderDetailScreen` on tap.
But the detail screen's flag logic (`deriveDeliveryFlags`) was never
updated to recognize the new "previewable but not yet claimable"
state. Its `isTerminalForOthers` flag was a catch-all
(`!isAssignedToMe && !isAvailableForClaim`), so any order the
viewer couldn't actively claim — including the new accepted/preparing
preview orders — got swept into "terminal" and rendered as
"Already taken".

**PR 23 narrows `isTerminalForOthers` to its original intent
(claimed-by-another-partner OR delivered-by-someone-else) and adds
a new `isComingSoon` flag for the previewable state.** The screen
gets a new yellow "⏳ Not yet ready for pickup" banner branch — so
a partner who tapped a HeadsUpCard sees a clear hint plus the order
details (so they can plan a route), without an action button (so
they can't try to claim before the shop signals ready).

Client-only. **No Cloud Functions change.** No Firestore rule change.
No schema change. ~30 min.

## Read first

- `.windsurf/code-discipline.md`,
  `.windsurf/test-discipline.md`,
  `.windsurf/deploy-discipline.md`.
- `src/screens/delivery/DeliveryOrderDetailScreen.useDeliveryOrderDetail.ts`
  — the state machine that needs the new flag. Read
  `deriveDeliveryFlags` + the `DeliveryFlags` type + `FLAGS_NULL_ORDER`.
- `src/screens/delivery/DeliveryOrderDetailScreen.tsx` — the screen
  needs a new render branch *before* the terminal-for-others checks.
  Read the existing `if (isTerminalForOthers && isDelivered)` /
  `if (isTerminalForOthers && !isDelivered)` blocks for context.
- `src/screens/delivery/DeliveryDashboardScreen.tsx` — read the
  `HeadsUpCard` component (~line 603) and the `headsUp` /
  `availableNow` `useMemo` split (~line 194). This is the rail that
  routes into the buggy screen. **No edits to this file needed**,
  but understanding it makes the test cases obvious.
- `functions/src/index.ts` — read the `listAvailableDeliveries`
  callable (~line 2500) and the `AVAILABLE_POOL_STATUSES` constant
  (~line 2494). Confirms the server returns
  `accepted | preparing | ready_for_pickup`. **No edits to this
  file needed.**
- `tests/hooks/useDeliveryOrderDetail.test.ts` — the existing test
  at "order not yet ready_for_pickup (e.g. preparing) → not
  available, terminal for others" enshrines the buggy behaviour.
  It will be flipped to assert the new correct contract.
- PR 12 prompt (`docs/pr-12-shopkeeper-eta-workflow-windsurf-prompt.md`)
  — context on why the heads-up rail exists and what `readyByEstimate`
  is. The new banner surfaces `readyByEstimate` when set.

## Critical lessons from PRs 12–22 (do not repeat)

1. **All `useState` calls in screens sit ABOVE conditional early
   returns.** `DeliveryOrderDetailScreen` already has its hooks
   correctly placed (the `useDeliveryOrderDetail` call is at the
   top of the function body). PR 23 does NOT add new state to the
   screen — the new flag comes through `useDeliveryOrderDetail`'s
   return value. Just destructure it; do not introduce a new
   `useState`. **Verify after edits** that the file's hooks order
   has not been disturbed.
2. **Never strip imports between edits in the same PR.** The screen
   already imports `formatOrderTime` from `../../utils/format` — PR
   23 reuses it for the "Ready by HH:MM" line on the banner. Do NOT
   let the auto-formatter remove this import even if a momentary
   intermediate edit state makes it look unused.
3. **Client-only PR — no server-first sequencing needed.** The
   server already returns accepted/preparing orders correctly. PR 23
   only changes how the *client* classifies them. No `firebase
   deploy --only functions` step. No `firebase functions:list`
   verification.
4. **Zero new `DO NOT REMOVE` markers expected.** 12-PR streak.

## Scope (in)

### Part 1 — Extend `DeliveryFlags` type and `FLAGS_NULL_ORDER`

In `src/screens/delivery/DeliveryOrderDetailScreen.useDeliveryOrderDetail.ts`,
add a new `isComingSoon` field and update the doc on
`isTerminalForOthers` to reflect the narrowed semantics:

```ts
export type DeliveryFlags = {
  isAssigned: boolean;
  isAvailableForClaim: boolean;
  /**
   * PR 23 — the viewer is a delivery partner previewing an order
   * that the shop has accepted or is preparing but has not yet
   * flagged ready_for_pickup. The dashboard's "Heads up — coming
   * soon" rail (PR 12) routes here on tap; the screen renders the
   * order info with an info banner and no action button.
   *
   * Before PR 23 these orders fell into `isTerminalForOthers` and
   * the screen wrongly rendered "Already taken". See the screen-
   * branch ordering comment in DeliveryOrderDetailScreen.tsx.
   */
  isComingSoon: boolean;
  isPickedUp: boolean;
  isDelivered: boolean;
  /**
   * The order is no longer actionable by the current viewer because
   * a different delivery person claimed it, OR it was already
   * delivered by someone else. Drives the "claimed by another
   * partner" / "already delivered" terminal EmptyState branches on
   * the screen.
   *
   * PR 23 narrowed this: it no longer catches orders that simply
   * aren't ready_for_pickup yet (accepted/preparing) — those are
   * `isComingSoon` instead.
   */
  isTerminalForOthers: boolean;
};

export const FLAGS_NULL_ORDER: DeliveryFlags = {
  isAssigned: false,
  isAvailableForClaim: false,
  isComingSoon: false,
  isPickedUp: false,
  isDelivered: false,
  isTerminalForOthers: false,
};
```

### Part 2 — Update `deriveDeliveryFlags` logic

Same file. Replace the body of `deriveDeliveryFlags` with the
following — net change is: add `isComingSoon` computation, replace
`isTerminalForOthers` formula with the narrowed version:

```ts
export function deriveDeliveryFlags(
  order: Order | null,
  uid: string | null | undefined,
  isDelivery: boolean,
): DeliveryFlags {
  if (!order) return FLAGS_NULL_ORDER;
  const isDelivered = order.status === 'delivered';
  const isAssignedToMe = !!uid && order.deliveryPersonId === uid;
  const isUnassigned =
    order.deliveryPersonId == null || order.deliveryPersonId === '';
  const isAvailableForClaim =
    !!isDelivery &&
    !isAssignedToMe &&
    isUnassigned &&
    order.status === 'ready_for_pickup';
  // PR 23 — "coming soon" matches the server's AVAILABLE_POOL minus
  // ready_for_pickup. The dashboard surfaces these to delivery
  // partners so they can plan routes; tapping should preview, not
  // dead-end into "Already taken".
  const isComingSoon =
    !!isDelivery &&
    !isAssignedToMe &&
    isUnassigned &&
    (order.status === 'accepted' || order.status === 'preparing');
  const isPickedUp = !!order.pickedUpAt;
  // PR 23 — narrowed semantics: claimed by another partner OR
  // already delivered (and not by me). The previous formulation
  // (`!isAssignedToMe && !isAvailableForClaim`) was a catch-all
  // that swept accepted/preparing into "terminal", which produced
  // the spurious "Already taken" message when a partner tapped a
  // heads-up card.
  const isClaimedByOther = !isUnassigned && !isAssignedToMe;
  const isTerminalForOthers =
    isClaimedByOther || (isDelivered && !isAssignedToMe);
  return {
    isAssigned: isAssignedToMe,
    isAvailableForClaim,
    isComingSoon,
    isPickedUp,
    isDelivered,
    isTerminalForOthers,
  };
}
```

Nothing else in this file needs to change. The hook function
(`useDeliveryOrderDetail`) automatically picks up the new flag because
it spreads `...flags` into its return value.

### Part 3 — Update unit tests

In `tests/hooks/useDeliveryOrderDetail.test.ts`, replace the
currently-buggy preparing test with the new contract and add three
new tests. Find the test that currently reads:

```ts
test('order not yet ready_for_pickup (e.g. preparing) → not available, terminal for others', () => {
  const flags = deriveDeliveryFlags(
    mkOrder({ status: 'preparing' }),
    'me',
    true,
  );
  expect(flags.isAvailableForClaim).toBe(false);
  expect(flags.isAssigned).toBe(false);
  expect(flags.isTerminalForOthers).toBe(true);
});
```

Replace it with the following four tests:

```ts
test('PR 23 — order in preparing → coming-soon preview, NOT terminal', () => {
  // Before PR 23 this test asserted `isTerminalForOthers: true`
  // and the screen rendered "Already taken" on tap from the
  // HeadsUpCard. That was the user-reported bug. The flag now
  // splits into isComingSoon vs isTerminalForOthers — pinning the
  // new contract.
  const flags = deriveDeliveryFlags(
    mkOrder({ status: 'preparing' }),
    'me',
    true,
  );
  expect(flags.isAvailableForClaim).toBe(false);
  expect(flags.isAssigned).toBe(false);
  expect(flags.isComingSoon).toBe(true);
  expect(flags.isTerminalForOthers).toBe(false);
});

test('PR 23 — order in accepted → coming-soon preview, NOT terminal', () => {
  // The other half of the AVAILABLE_POOL minus ready_for_pickup.
  // Server can return accepted orders to listAvailableDeliveries
  // (see functions/src/index.ts AVAILABLE_POOL_STATUSES); the
  // client must classify them as preview, not terminal.
  const flags = deriveDeliveryFlags(
    mkOrder({ status: 'accepted' }),
    'me',
    true,
  );
  expect(flags.isComingSoon).toBe(true);
  expect(flags.isAvailableForClaim).toBe(false);
  expect(flags.isTerminalForOthers).toBe(false);
});

test('PR 23 — accepted + claimed by ANOTHER partner → terminal, not coming-soon', () => {
  // Defensive: the dashboard wouldn't normally surface this
  // (server filters deliveryPersonId == null) but a deep-link
  // could land here. Claimed-by-other should still take
  // precedence over the coming-soon preview branch.
  const flags = deriveDeliveryFlags(
    mkOrder({ status: 'accepted', deliveryPersonId: 'someone_else' }),
    'me',
    true,
  );
  expect(flags.isComingSoon).toBe(false);
  expect(flags.isTerminalForOthers).toBe(true);
});

test('PR 23 — coming-soon requires the delivery role', () => {
  // Mirrors the gate on isAvailableForClaim. A non-delivery
  // viewer (e.g. a customer somehow landing here via a stale
  // link) should not see the partner-facing preview UI.
  const flags = deriveDeliveryFlags(
    mkOrder({ status: 'preparing' }),
    'me',
    false,
  );
  expect(flags.isComingSoon).toBe(false);
});
```

**Do not touch** the other 18 tests in this file. They cover paths
that PR 23 must keep green:
- `reduceWatcherUpdate` (3 tests)
- `deriveDeliveryFlags` other branches: null order, available-for-claim,
  not-delivery-person, claimed-by-other (ready_for_pickup), assigned-to-me,
  assigned-and-pickedUp, assigned-and-delivered, empty-string deliveryPersonId.
- `runClaimOnce`, `runStatusActionOnce`, `applyOptimisticPickedUp`,
  `applyOptimisticDelivered`.

After your changes, the full suite should be **22 tests** (was 19;
added 4, removed 1).

### Part 4 — Destructure `isComingSoon` in the screen

In `src/screens/delivery/DeliveryOrderDetailScreen.tsx`, find the
existing destructure of `useDeliveryOrderDetail(orderId, uid,
!!isDelivery)` and add `isComingSoon` to it:

```tsx
const {
  order,
  loading,
  error,
  isAssigned,
  isAvailableForClaim,
  isComingSoon, // PR 23 — new flag
  isPickedUp,
  isDelivered,
  isTerminalForOthers,
  pendingAction,
  handleClaim,
  handlePickedUp,
  handleDelivered,
  retry,
} = useDeliveryOrderDetail(orderId, uid, !!isDelivery);
```

### Part 5 — Update header title + add coming-soon copy

Same file. Find the line:

```tsx
const headerTitle = isAvailableForClaim ? 'Pickup details' : 'Delivery';
```

Replace with:

```tsx
const headerTitle =
  isAvailableForClaim || isComingSoon ? 'Pickup details' : 'Delivery';
// PR 23 — coming-soon banner copy. We surface the shop's state
// verbatim so the partner can read intent ("the shop just
// accepted" vs "the shop is preparing"); the ETA line below
// adds time-to-ready when the shopkeeper has set one.
const comingSoonState =
  order.status === 'preparing' ? 'preparing your order' : 'just accepted';
```

### Part 6 — Add the coming-soon banner branch in the ScrollView

Same file. Find the JSX line that opens the main content:

```tsx
<ScrollView contentContainerStyle={styles.content}>
  <View style={styles.card}>
    <Text style={styles.label}>Pickup from</Text>
```

Insert the new banner *between* `<ScrollView ...>` and the first
`<View style={styles.card}>`:

```tsx
<ScrollView contentContainerStyle={styles.content}>
  {/* PR 23 — coming-soon banner. Surfaced above every other
      card so a partner who tapped a HeadsUpCard on the
      dashboard immediately understands why there's no Accept
      button below: the shop hasn't signalled ready yet. Before
      PR 23 this state rendered as "Already taken" — see the
      useDeliveryOrderDetail hook's deriveDeliveryFlags. */}
  {isComingSoon && (
    <View style={styles.comingSoonCard}>
      <Text style={styles.comingSoonTitle}>⏳ Not yet ready for pickup</Text>
      <Text style={styles.comingSoonBody}>
        The shop is {comingSoonState}. You'll be able to accept this
        pickup as soon as the shop marks it ready.
      </Text>
      {order.readyByEstimate ? (
        <Text style={styles.comingSoonEta}>
          Ready by {formatOrderTime(order.readyByEstimate)}
        </Text>
      ) : null}
    </View>
  )}
  <View style={styles.card}>
    <Text style={styles.label}>Pickup from</Text>
```

**Note on render ordering**: this branch falls *through* to the
rest of the screen. We want the partner to see the order's items,
addresses, timeline — just not an Accept button. The
`isAvailableForClaim` button block is already correctly gated; for
coming-soon orders it won't render. No further button gating needed.

The two pre-existing terminal `EmptyState` branches earlier in the
function (`if (isTerminalForOthers && isDelivered)` and
`if (isTerminalForOthers && !isDelivered)`) are NOT entered for
coming-soon orders, because `isTerminalForOthers` is now `false`
for them. That's the whole point of the narrowing in Part 2.

### Part 7 — Add the banner styles

Same file. Find the existing `dropInstructionsCard` style block in
the `StyleSheet.create({...})` call. Insert the new
`comingSoonCard` styles immediately above it:

```ts
// PR 23 — coming-soon banner. Same yellow family as the dashboard
// HeadsUpCard / dropInstructionsCard so a partner reads the
// visual language as "informational, not actionable yet".
comingSoonCard: {
  backgroundColor: '#FEF9E7',
  borderRadius: radii.md,
  padding: spacing.lg,
  borderWidth: 1,
  borderColor: '#F4D03F',
  marginBottom: spacing.md,
},
comingSoonTitle: {
  ...typography.h3,
  color: colors.primaryDark,
  marginBottom: spacing.xs,
},
comingSoonBody: {
  ...typography.body,
  color: colors.textPrimary,
},
comingSoonEta: {
  ...typography.bodyBold,
  color: colors.primaryDark,
  marginTop: spacing.sm,
},
```

Color tokens (`#FEF9E7` background + `#F4D03F` border) match the
dashboard's `HeadsUpCard` so the visual language is consistent
across the rail card and the detail banner.

## Scope (out)

- **Server-side change.** The server already returns the right pool
  (`AVAILABLE_POOL_STATUSES = ['accepted', 'preparing',
  'ready_for_pickup']`). The bug was purely in client classification.
- **Changing what the dashboard surfaces.** PR 12's split between
  "Heads up — coming soon" and "Available now" is correct as-is.
- **Hiding the customer phone / drop-off PII for coming-soon
  orders.** Currently the screen already hides the phone (gated on
  `isAssigned`); the delivery-instructions card is shown
  unconditionally, but that's pre-existing behaviour, not introduced
  by PR 23. If we want tighter PII gating for the preview state,
  that should be its own PR.
- **Notify when status flips to ready_for_pickup while previewing.**
  The watcher already polls every 5s; the screen will re-render
  with `isAvailableForClaim = true` and the Accept button when the
  status flips. No push needed for MVP.

## Acceptance checklist

- [ ] `DeliveryFlags` type extended with `isComingSoon: boolean`.
- [ ] `FLAGS_NULL_ORDER` includes `isComingSoon: false`.
- [ ] `deriveDeliveryFlags` computes `isComingSoon` from
  `isDelivery + isUnassigned + status in {accepted, preparing}`.
- [ ] `deriveDeliveryFlags` narrows `isTerminalForOthers` to
  `isClaimedByOther || (isDelivered && !isAssignedToMe)`.
- [ ] The 4 new PR-23 tests added; the bug-locking
  "order not yet ready_for_pickup (e.g. preparing) → terminal for
  others" test is removed.
- [ ] Screen destructures `isComingSoon` from
  `useDeliveryOrderDetail` return.
- [ ] `headerTitle` extended to render "Pickup details" for
  coming-soon as well as available-for-claim.
- [ ] New `comingSoonCard` JSX block inserted at the top of the
  ScrollView, gated on `isComingSoon`.
- [ ] Four new styles (`comingSoonCard`, `comingSoonTitle`,
  `comingSoonBody`, `comingSoonEta`) added.
- [ ] No new `useState` calls added to the screen.
- [ ] No imports removed from the screen (especially `formatOrderTime`).
- [ ] `npx tsc --noEmit` (root): 0 errors.
- [ ] `npm run test:unit`:
  `tests/hooks/useDeliveryOrderDetail.test.ts` is 22 tests, all pass.
- [ ] `npm test` overall: green.
- [ ] **Zero new `DO NOT REMOVE` markers added** (13-PR streak).

## Smoke tests (manual, after OTA publish)

1. **Coming-soon banner shows for `preparing`** — Quick Switch to a
   delivery partner test account. From the customer account, place a
   COD order (or arrange one already in `preparing`). On the
   delivery dashboard, the order appears under "Heads up — coming
   soon". Tap it. Detail screen renders with the yellow
   "⏳ Not yet ready for pickup" banner at the top. **No "Already
   taken" message.**
2. **Coming-soon banner shows for `accepted`** — same dance with an
   order whose shop has accepted but not yet started preparing.
   Banner text reads "The shop is just accepted…" — slightly awkward
   English but acceptable for MVP; if you want polished, change
   "just accepted" to "looking at it" or similar in a later PR.
3. **No Accept button on coming-soon** — same screen as Test 1.
   Scroll to bottom. There is NO "Accept this pickup" button.
4. **`readyByEstimate` line renders when set** — on the same order,
   from a shop owner account, set a Ready-by ETA. Wait for the next
   client poll (~5s). The banner now shows
   "Ready by 4:35 PM" (or whatever) as a third line.
5. **No `readyByEstimate` line when not set** — coming-soon order
   without an ETA. Banner shows the title + body but no time line.
6. **Status flip mid-preview** — partner is on the preview screen.
   Shop flips the order to `ready_for_pickup`. Within ~5s the banner
   disappears and the Accept button appears. The partner can tap
   Accept and claim normally.
7. **Real "Already taken" still works** — manufacture a race: two
   delivery accounts on two devices, both viewing the same
   `ready_for_pickup` order. Partner A taps Accept first. Partner B
   refreshes (or waits for the 5s watcher tick) — Partner B's screen
   now shows the "Already taken" EmptyState. This path must still
   work; only the spurious cases (coming-soon) are removed.
8. **Real "Order already delivered" still works** — open a
   delivered order that was delivered by *someone else* (uncommon in
   solo testing, but cover via the deep-link / order-history path).
   Screen shows "Order already delivered" EmptyState.
9. **Assigned-to-me-and-delivered still shows the green card** — my
   own delivered orders open with the green "✅ Delivered" success
   card, NOT the terminal EmptyState.
10. **Customer / shop screens unaffected** — open the same coming-
    soon order from a customer / shop account. Their screens show
    the existing behaviour with no PR 23 surface. (The banner is
    delivery-only.)
11. **No screen crashes** — visit the delivery detail for orders in
    every status (pending → accepted → preparing →
    ready_for_pickup → ready_for_pickup w/ assignee → pickedUpAt set
    → delivered). No ErrorBoundary.
12. **TypeScript clean** — `npx tsc --noEmit` shows zero errors.

## Deliberate-break check (per `.windsurf/test-discipline.md`)

Before declaring done, temporarily change ONE assertion in the new
"PR 23 — order in preparing → coming-soon preview, NOT terminal"
test from `expect(flags.isComingSoon).toBe(true)` to
`expect(flags.isComingSoon).toBe(false)`. Run `npm run test:unit`.
The named test should fail with a clear message pointing at the
exact line. Revert the change. This confirms the new test actually
exercises the new flag and isn't silently passing.

## Deploy plan

**Client-only — no server-first step.** No Cloud Functions changed.
No Firestore rules / indexes changed. No native code touched.

```powershell
$env:NODE_OPTIONS = "--use-system-ca"

# 1. Local audit.
npm test

# 2. Commit + push.
git add src/screens/delivery/DeliveryOrderDetailScreen.useDeliveryOrderDetail.ts
git add src/screens/delivery/DeliveryOrderDetailScreen.tsx
git add tests/hooks/useDeliveryOrderDetail.test.ts
git commit -m "PR 23: delivery heads-up coming-soon regression fix"
git push origin main

# 3. OTA to production (where family testers live).
eas update --branch production --message "PR 23 - fix Already Taken on coming-soon orders"
```

Tell testers to force-close + reopen the app after publish (or wait
~30s for Expo Updates to download in the background and re-launch
on next foreground).

## Estimated time

~30 min Windsurf work:

- Part 1 (type + null-flags): 5 min
- Part 2 (deriveDeliveryFlags logic): 5 min
- Part 3 (tests — flip one + add three): 10 min
- Part 4–7 (screen destructure + banner JSX + styles): 5 min
- Smoke + deliberate-break: 5 min

## Why this PR matters

The bug surfaced as a soft trust break: a delivery partner taps a
card on the dashboard, sees a confident "Already taken" message,
and starts wondering whether the dashboard is showing stale data.
Repeated enough times, the partner stops tapping coming-soon cards
at all — defeating the entire point of PR 12's heads-up rail.

PR 23 closes the loop: the rail shows the order, the detail screen
shows the order plus a clear "not yet" hint, and the action becomes
available the moment the shop signals ready. No confusion, no
spurious "taken" messages, and the partner's mental model of the
dashboard matches reality.

This is a classic flag-derivation regression — one symbol's
semantics drifted as the feature surface around it grew. Pinning
the new contract with four targeted unit tests makes it harder for
the same drift to repeat the next time the available pool changes.
