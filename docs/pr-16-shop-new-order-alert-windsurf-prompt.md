# PR 16 — Shop owner new-order alert (Windsurf prompt)

## Why this PR exists

Shop owners running real kirana stores **don't watch their phone
screens**. They're stocking shelves, billing walk-in customers,
talking to suppliers. The current ShopOwnerDashboard polls every 10s
and silently updates the list — which is useless when the phone is
face-down on the counter. New orders sit unaccepted for several
minutes, the customer waits, the delivery partner has nothing to
claim, and the whole supply chain stalls.

Industry-standard fix: **make new orders impossible to miss**. Both
Swiggy Partner App and Zomato Restaurant App fire loud sounds + a
prominent visual alert on every new order. Sound requires a native
module (expo-av) and a rebuild, so we defer it. But three things we
can do **today, via OTA, with zero schema changes**:

1. **Visual banner** at the top of the dashboard: "🔔 N new orders
   since you last looked" — yellow background, hard to miss.
2. **Highlighted card borders** on new orders specifically. Primary
   color, 2px border. Visually pops against the standard cards.
3. **Haptic feedback** via `expo-haptics` (already a dep — confirmed
   in package.json) when the polling tick detects new orders. A
   single buzz draws attention without being intrusive.

Together they convert the dashboard from "passive log" to "active
notification surface" without any infrastructure work.

**Pure client OTA**, no schema, no server, no rollout risk.
~1.5–2 hours.

## Read first

- `.windsurf/code-discipline.md`, `.windsurf/test-discipline.md`,
  `.windsurf/deploy-discipline.md`.
- `src/screens/shop/ShopOwnerDashboardScreen.tsx` — the screen this
  PR modifies. It already has `orders` state, a polling-based
  watcher, and `RefreshControl`. New-order detection plugs into the
  state-update path.
- `src/screens/admin/AdminOrdersScreen.tsx` — has a similar polling
  + state pattern. If anything's unclear about how PR 15 layered
  derived state via `useMemo` on top of an existing watcher, that's
  another reference.
- `package.json` — confirm `expo-haptics: ~15.0.8` is present (it is,
  per recent dependency audit). No new dependency needed.
- `src/components/order/ActiveOrdersRail.tsx` (created in PR 15) —
  the visual reference for primary-tinted cards. The "new order"
  highlighted card style mirrors this aesthetic.

## Critical lessons from PRs 12 + 13 + 14 + 15 (do not repeat)

1. **All `useState` declarations sit ABOVE conditional early
   returns.** ShopOwnerDashboardScreen has early returns for the
   role-guard ("Shop owner access required") and for loading/error
   states. Any new state in this PR goes at the top with the existing
   block, with a comment block citing the PR 12 ETA-modal hotfix.
2. **Zero new `DO NOT REMOVE` markers expected.** Six PRs in a row —
   keep the streak.
3. **No new native module imports.** `expo-haptics` is already
   bundled in the existing native build — verify by grepping for
   `expo-haptics` in `src/`; if any other screen already imports it,
   adding an import here is a zero-cost JS-side change. If NOT,
   confirm the package is installed (`npm ls expo-haptics`) before
   importing.

## Scope (in)

### Part 1 — Pure helper `detectNewOrderIds`

New file `src/utils/detectNewOrderIds.ts`:

```ts
/**
 * Pure helper that returns the IDs of orders that are NEW relative
 * to a previously-seen set. Used by ShopOwnerDashboardScreen to
 * detect which orders arrived in the latest polling tick.
 *
 * "New" = id is in the current order list AND wasn't in the
 * previously-seen set. We deliberately do NOT use timestamps —
 * server clock drift + late writes mean a freshly-written order can
 * have a createdAt that falls before the previous poll's max. ID
 * set comparison is the reliable signal.
 *
 * First-tick semantics: when `previouslySeenIds` is null
 * (uninitialised), return an empty set — the first tick establishes
 * the baseline. Showing 20 "new" orders on first dashboard open
 * would be alarming and meaningless.
 *
 * Pure — no Firestore, no React, no clock. Pinned by
 * tests/utils/detectNewOrderIds.test.ts.
 */
export function detectNewOrderIds(
  currentOrderIds: string[],
  previouslySeenIds: Set<string> | null,
): Set<string> {
  if (previouslySeenIds === null) return new Set();
  const newIds = new Set<string>();
  for (const id of currentOrderIds) {
    if (!previouslySeenIds.has(id)) newIds.add(id);
  }
  return newIds;
}
```

### Part 2 — Tests for the helper

New file `tests/utils/detectNewOrderIds.test.ts`:

```ts
import { describe, it, expect } from '@jest/globals';
import { detectNewOrderIds } from '../../src/utils/detectNewOrderIds';

describe('detectNewOrderIds', () => {
  it('returns empty set on first tick (previouslySeen=null)', () => {
    const result = detectNewOrderIds(['o1', 'o2', 'o3'], null);
    expect(result.size).toBe(0);
  });

  it('returns empty set when no new orders since last tick', () => {
    const seen = new Set(['o1', 'o2']);
    const result = detectNewOrderIds(['o1', 'o2'], seen);
    expect(result.size).toBe(0);
  });

  it('returns the new orders since last tick', () => {
    const seen = new Set(['o1', 'o2']);
    const result = detectNewOrderIds(['o1', 'o2', 'o3', 'o4'], seen);
    expect(result.size).toBe(2);
    expect(result.has('o3')).toBe(true);
    expect(result.has('o4')).toBe(true);
  });

  it('does not include disappeared orders as new', () => {
    const seen = new Set(['o1', 'o2', 'o3']);
    const result = detectNewOrderIds(['o1', 'o2'], seen);
    // o3 vanished from current — not "new", just gone (cancelled / moved)
    expect(result.size).toBe(0);
  });

  it('handles all-new (rare but possible — empty seen set)', () => {
    const seen = new Set<string>();
    const result = detectNewOrderIds(['o1', 'o2'], seen);
    expect(result.size).toBe(2);
  });

  it('handles empty current list', () => {
    const seen = new Set(['o1']);
    const result = detectNewOrderIds([], seen);
    expect(result.size).toBe(0);
  });

  it('does not mutate inputs', () => {
    const seen = new Set(['o1']);
    const current = ['o1', 'o2'];
    detectNewOrderIds(current, seen);
    expect(current).toEqual(['o1', 'o2']);
    expect(seen.has('o1')).toBe(true);
    expect(seen.size).toBe(1);
  });
});
```

### Part 3 — Add state + detection logic to ShopOwnerDashboard

Modify `src/screens/shop/ShopOwnerDashboardScreen.tsx`.

**New state, declared at the TOP with existing state (above early
returns):**

```tsx
// PR 16 — new-order alert state. ALL state declared here at the top,
// above ANY conditional early returns, per the Rules-of-Hooks
// discipline established in PR 12 (ETA modal hotfix) and reinforced
// across PRs 13/14/15. Adding state below early returns crashes the
// screen the moment data transitions from null → loaded.
//
// seenOrderIds: ids of orders the shopkeeper has already seen
//   (or that existed at first dashboard load — see Part 1 first-
//   tick semantics).
// newOrderIds: ids of orders that arrived in the latest polling
//   tick. Highlighted with a primary border + small "New" tag.
//   Cleared when shopkeeper taps a card or scrolls.
const [seenOrderIds, setSeenOrderIds] = useState<Set<string> | null>(null);
const [newOrderIds, setNewOrderIds] = useState<Set<string>>(new Set());
```

**Detection inside the existing orders-state-update path.** When the
watcher callback fires with a new `orders` array, run:

```tsx
// In the watcher callback / setOrders handler:
const currentIds = orders.map(o => o.id);
const detected = detectNewOrderIds(currentIds, seenOrderIds);

if (detected.size > 0) {
  setNewOrderIds(prev => {
    const merged = new Set(prev);
    for (const id of detected) merged.add(id);
    return merged;
  });
  // Haptic feedback — single 'success'-style buzz. Fires once per
  // polling tick that has at least one new order, regardless of
  // how many new orders arrived. Multiple buzzes per tick would be
  // jarring.
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    .catch(() => {
      // Haptics unavailable (e.g. running on web preview) — silently
      // ignore. The visual cues still fire.
    });
}

// Always update the seen-ids snapshot so the NEXT tick has the
// correct baseline. Includes orders that just arrived — by the next
// tick, they're no longer "new" UNLESS they re-arrive (rare).
setSeenOrderIds(new Set(currentIds));
```

The `Haptics` import goes at the top:

```tsx
import * as Haptics from 'expo-haptics';
```

**Clear the "new" highlight on user interaction:**

```tsx
const clearNewHighlight = useCallback(() => {
  if (newOrderIds.size === 0) return;
  setNewOrderIds(new Set());
}, [newOrderIds.size]);
```

Wire `clearNewHighlight` to:
- Each card's `onPress` (shopkeeper opened the order — they've seen it)
- The FlatList's `onScrollBeginDrag` (shopkeeper engaged with the
  list — assume they've scanned the top)
- The banner's own dismiss tap (optional X button)

### Part 4 — Render the banner

Just above the FlatList:

```tsx
{newOrderIds.size > 0 && (
  <Pressable
    onPress={clearNewHighlight}
    style={styles.newOrderBanner}
    accessibilityRole="button"
    accessibilityLabel={`${newOrderIds.size} new orders. Tap to dismiss.`}
  >
    <Text style={styles.newOrderBannerText}>
      🔔 {newOrderIds.size}{' '}
      {newOrderIds.size === 1 ? 'new order' : 'new orders'}
    </Text>
    <Text style={styles.newOrderBannerHint}>Tap to dismiss</Text>
  </Pressable>
)}
```

Styles:

```ts
newOrderBanner: {
  backgroundColor: '#FEF3C7',           // light yellow — attention color
  borderLeftWidth: 4,
  borderLeftColor: colors.warning,
  paddingHorizontal: spacing.lg,
  paddingVertical: spacing.md,
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginHorizontal: spacing.lg,
  marginTop: spacing.md,
  borderRadius: radii.md,
},
newOrderBannerText: {
  ...typography.bodyBold,
  color: colors.textPrimary,
},
newOrderBannerHint: {
  ...typography.caption,
  color: colors.textSecondary,
},
```

### Part 5 — Highlight new cards

Add a conditional style to each order card. In the
`renderItem` / card render path:

```tsx
const isNew = newOrderIds.has(item.id);
// ...
<Pressable
  onPress={() => {
    clearNewHighlight();
    nav.navigate('ShopOrderDetail', { orderId: item.id });
  }}
  style={[styles.card, isNew && styles.cardNew]}
>
  {/* existing card content */}
  {isNew && (
    <View style={styles.newTag}>
      <Text style={styles.newTagText}>NEW</Text>
    </View>
  )}
</Pressable>
```

Styles:

```ts
cardNew: {
  borderWidth: 2,
  borderColor: colors.primary,
  // Optional: a subtle tinted background to reinforce
  backgroundColor: colors.primaryLight,
},
newTag: {
  position: 'absolute',
  top: spacing.sm,
  right: spacing.sm,
  backgroundColor: colors.primary,
  paddingHorizontal: spacing.sm,
  paddingVertical: 2,
  borderRadius: radii.sm,
},
newTagText: {
  ...typography.caption,
  fontWeight: '700',
  color: '#fff',
  letterSpacing: 0.5,
},
```

### Part 6 — Wire `clearNewHighlight` to the FlatList scroll

```tsx
<FlatList
  // ... existing props
  onScrollBeginDrag={clearNewHighlight}
/>
```

The scroll handler is intentionally `onScrollBeginDrag` (fires once
when the user starts dragging) rather than `onScroll` (fires
continuously). Avoids redundant state updates.

## Scope (out)

- **Sound notification** (e.g. ding when a new order arrives).
  Requires `expo-av` which isn't currently a dependency — that's a
  native module add + rebuild + TestFlight resubmit cycle. Track as a
  follow-up; valuable but not for tonight's window.
- **Background push notifications** to alert shopkeepers when the
  app isn't open. Needs Expo Push or FCM infrastructure + token
  registration. Bigger lift, separate PR.
- **Customizable alert volume / per-shop notification preferences.**
  Premature for MVP. Single fixed alert behaviour for now.
- **"Snooze new orders for 5 min" button.** Not needed at MVP scale;
  add when one real shop reports being overwhelmed.
- **Sound on web preview.** Web haptics is a no-op (catch silently
  per Part 3). Web users would benefit from the visual banner alone.

## Acceptance checklist

- [ ] `src/utils/detectNewOrderIds.ts` created with the exported
  helper.
- [ ] `tests/utils/detectNewOrderIds.test.ts` covers ≥7 cases; all
  pass.
- [ ] `src/screens/shop/ShopOwnerDashboardScreen.tsx`:
  - [ ] `expo-haptics` imported at top.
  - [ ] Two new `useState` calls (`seenOrderIds`, `newOrderIds`)
    declared at the top, above any conditional early returns.
    Comment block citing PR 12 + PR 13 + PR 14 + PR 15 lineage.
  - [ ] `detectNewOrderIds` called on each watcher tick's new
    orders array.
  - [ ] `Haptics.notificationAsync` fires when new orders detected,
    wrapped in `.catch(() => {})` for web-preview safety.
  - [ ] Banner renders above FlatList when `newOrderIds.size > 0`.
  - [ ] Each new-flagged order card has the `cardNew` border style
    and a "NEW" tag.
  - [ ] `clearNewHighlight` wired to card `onPress`, banner
    `onPress`, and FlatList `onScrollBeginDrag`.
  - [ ] First-tick semantics work: on first dashboard load, no
    banner, no haptic, no "NEW" tags (baseline is set silently).
- [ ] `npx tsc --noEmit`: 0 errors (root + functions).
- [ ] `npm test`: existing 534+ tests still pass plus the 7+ new ones.
- [ ] `npm run audit` passes.
- [ ] Deliberate-break demo: change the "returns empty on first
  tick" test to expect size 3, confirm red, revert.
- [ ] **Zero new `DO NOT REMOVE` markers added** (auto-formatter
  discipline at 6 PRs and counting — keep the streak).

## Smoke tests (manual, after OTA)

1. **First open of dashboard** — shop owner opens dashboard with
   pre-existing orders. NO banner, NO haptic, NO "NEW" tags. The
   first tick establishes the baseline silently.
2. **A new order arrives while shopkeeper is viewing the dashboard**
   — within ~10s of polling cycle, banner appears with "🔔 1 new
   order", the new order card gets a green border + "NEW" tag, and
   the phone buzzes once.
3. **Three new orders arrive in the same polling tick** — banner
   shows "🔔 3 new orders", all three cards get NEW tags, only ONE
   haptic fires (not three).
4. **Shopkeeper taps a new-flagged order card** — navigates to
   detail. On return to dashboard, banner is gone, no cards have
   "NEW" tags. (`clearNewHighlight` fired on tap.)
5. **Shopkeeper scrolls the list without tapping** — banner clears,
   "NEW" tags gone. Scrolling counts as acknowledgement.
6. **Shopkeeper taps the banner directly** — banner disappears,
   "NEW" tags clear. Same as tapping a card.
7. **A new order arrives, shopkeeper sees banner, doesn't react, then
   ANOTHER new order arrives in next tick** — banner updates to
   show new total count, another haptic fires, both cards have
   NEW tags.
8. **Old order disappears (e.g. customer cancelled it)** — no
   spurious "NEW" tag on remaining orders. The detect helper handles
   this correctly via Part 1 test 4.
9. **Run on web preview** (if you do web testing) — visual banner
   + card highlights work, haptic silently no-ops.

## Deploy plan

Pure client OTA, no server changes:

```powershell
$env:NODE_OPTIONS = "--use-system-ca"
npm test
eas update --branch production --message "PR 16 — Shop owner new-order alert"
```

Rollback is `eas update --branch production --republish --group <prev-group-id>`.

Tell team to force-close + reopen TestFlight. Specifically tell the
**shop-role testers** to keep the dashboard open for ~30s after
someone else (customer-role tester) places an order on their shop —
they should see the banner appear within one polling cycle.

## Estimated time

~1.5–2 hours Windsurf work:

- Part 1 (pure helper): 10 min
- Part 2 (tests): 25 min — 7 cases, all simple
- Part 3 (state + detection in dashboard): 30 min — careful state
  hoisting + handler wiring; the watcher integration is the bulk
- Part 4 (banner render + styles): 25 min — visual polish
- Part 5 (card highlight + NEW tag + styles): 20 min
- Part 6 (clear-on-scroll wiring): 10 min
- Smoke + deliberate-break: 20 min

Should ship as another clean PR. No new native modules (expo-haptics
already bundled), no schema changes, no server work, no rollout
risk. The discipline keeps compounding.

## Why this PR matters

Tomorrow morning when your testers wake up and your customer-role
testers start placing orders, the shop-role testers will see the
banner the moment a new order lands. They won't have to refresh, they
won't have to watch the screen, they won't have to ask "did
anything new come in?" — the dashboard tells them. That's the
single biggest UX gap between this app and Swiggy/Zomato today, and
it closes in 2 hours.

Bilateral knock-on: faster shopkeeper awareness → faster Accept
(with ETA, per PR 12) → faster customer visibility on Home (per
PR 15's active orders rail) → faster delivery partner pickup. The
whole supply chain tightens by ~5–10 minutes per order on average.
That's the real metric to watch from family testing tomorrow:
**time from order placed to order accepted by shop**. Pre-PR-16
will baseline around 5–8 min (whenever the shopkeeper next looks
at the screen). Post-PR-16 should drop to under 2 min for
shopkeepers who keep the app open with their phone audible.
