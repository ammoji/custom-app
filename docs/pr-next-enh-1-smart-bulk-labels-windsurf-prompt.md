# PR-NEXT-ENH-1 — Smart bulk-action labels on shopkeeper menu

**Source:** Finding #4 follow-up in `docs/TESTING-FINDINGS-2026-05-30.md`. The original #4 bug ("Mark N unavailable" reported "0 updated, N skipped") was fixed in PR-NEXT-4. While testing the fix Sudhir surfaced a secondary issue: the bulk action bar always shows BOTH "Mark N unavailable" + "Mark N available" with the same N, regardless of what's selected. So selecting 3 already-available items still shows "Mark 3 available" as an option — a no-op button. Sudhir's words: *"It vise versa, I selected 3 unavailable items and it still shows mark 3 unavailable… I think it should show the count of existing unavailable so shopkeeper will know how many actually going to be available while doing in bulk."*

**Deploy class:** pure client OTA. No callable change (`bulkUpdateMenuAvailability` already handles arbitrary id lists). No schema, no rules, no `app.json`. Ships via `eas update --branch production`.

**Read first**

1. `CLAUDE.md` (full)
2. `docs/TESTING-FINDINGS-2026-05-30.md` — finding #4 entry + test result follow-up
3. `.windsurf/code-discipline.md` (Rules 1, 2, 8)
4. `src/screens/shop/ShopMenuScreen.tsx`:
   - Lines 215–262 — `handleBulkSetAvailability` handler (modified to send only items that actually flip)
   - Lines 567–591 — the bulk action bar (modified to show smart labels + hide no-op buttons)
5. `docs/pr-next-4-menu-management-windsurf-prompt.md` — context on the parent PR that fixed the underlying server bug

---

## Why this matters

After PR-NEXT-4's server fix, the buttons no longer error out — but the UX is still misleading:

- **Selection of 3 already-available items:** today shows "Mark 3 unavailable" (useful) AND "Mark 3 available" (no-op — would write the same value back). Shopkeeper has to mentally translate "wait, the second button does nothing here."
- **Mixed selection (2 available + 1 unavailable):** today shows "Mark 3 unavailable" + "Mark 3 available", with both counts being wrong — neither button affects all 3 items in the way the label implies. A shopkeeper tapping "Mark 3 unavailable" actually flips 2 and re-writes 1 to the same value (wasteful but harmless).

The fix: compute, per-selection, **how many items would actually flip per button**, show only the buttons whose flip-count is > 0, and use that count in the label.

---

## Plan

### §A — Pure helper `src/utils/bulkAvailabilityCounts.ts` (new)

Tiny pure function — pin via unit tests without rendering the screen.

```ts
/**
 * PR-NEXT-ENH-1 (finding #4 follow-up) — count selected items that
 * are currently available vs unavailable. Drives the smart-label
 * decision on `ShopMenuScreen`'s bulk action bar:
 *
 *   availableCount   → how many selected items ARE available now →
 *                      "Mark N unavailable" would flip exactly this many
 *   unavailableCount → how many selected items ARE unavailable now →
 *                      "Mark N available" would flip exactly this many
 *
 * Items not present in the source list are silently ignored (selection
 * state can transiently include ids from a previous fetch). Items
 * with `available` of an unexpected type are treated as unavailable
 * (defensive against legacy / malformed docs — same posture as the
 * `available === false` checks in `buildReorderPlan` / menu listing
 * helpers).
 */
import type { MenuItem } from '../types';

export type BulkAvailabilityCounts = {
  availableCount: number;
  unavailableCount: number;
};

export function computeBulkAvailabilityCounts(
  items: readonly MenuItem[],
  selectedIds: ReadonlySet<string>,
): BulkAvailabilityCounts {
  let availableCount = 0;
  let unavailableCount = 0;
  for (const item of items) {
    if (!selectedIds.has(item.id)) continue;
    if (item.available === true) availableCount += 1;
    else unavailableCount += 1;
  }
  return { availableCount, unavailableCount };
}
```

### §B — Helper tests `tests/utils/bulkAvailabilityCounts.test.ts` (new)

Pin every branch. Target ~10 cases:

```ts
import { computeBulkAvailabilityCounts } from '../../src/utils/bulkAvailabilityCounts';
import type { MenuItem } from '../../src/types';

const make = (
  id: string,
  available: boolean,
): MenuItem =>
  ({
    id,
    available,
    // Other MenuItem fields are not read by the helper; cast through.
  } as MenuItem);

describe('computeBulkAvailabilityCounts', () => {
  test('empty selection → both counts 0', () => {
    const items = [make('a', true), make('b', false)];
    const result = computeBulkAvailabilityCounts(items, new Set());
    expect(result).toEqual({ availableCount: 0, unavailableCount: 0 });
  });

  test('all selected available → availableCount = N, unavailableCount = 0', () => {
    const items = [make('a', true), make('b', true), make('c', true)];
    const selected = new Set(['a', 'b', 'c']);
    expect(computeBulkAvailabilityCounts(items, selected)).toEqual({
      availableCount: 3,
      unavailableCount: 0,
    });
  });

  test('all selected unavailable → availableCount = 0, unavailableCount = N', () => {
    const items = [make('a', false), make('b', false), make('c', false)];
    const selected = new Set(['a', 'b', 'c']);
    expect(computeBulkAvailabilityCounts(items, selected)).toEqual({
      availableCount: 0,
      unavailableCount: 3,
    });
  });

  test('mixed selection counts each bucket correctly', () => {
    const items = [
      make('a', true),
      make('b', true),
      make('c', false),
    ];
    const selected = new Set(['a', 'b', 'c']);
    expect(computeBulkAvailabilityCounts(items, selected)).toEqual({
      availableCount: 2,
      unavailableCount: 1,
    });
  });

  test('selected id not present in items list → silently ignored', () => {
    const items = [make('a', true)];
    const selected = new Set(['a', 'phantom']);
    expect(computeBulkAvailabilityCounts(items, selected)).toEqual({
      availableCount: 1,
      unavailableCount: 0,
    });
  });

  test('items present but not in selection → not counted', () => {
    const items = [make('a', true), make('b', false), make('c', true)];
    const selected = new Set(['b']);
    expect(computeBulkAvailabilityCounts(items, selected)).toEqual({
      availableCount: 0,
      unavailableCount: 1,
    });
  });

  test('available is not exactly true (undefined / null / 0) → counts as unavailable (defensive)', () => {
    const items = [
      { id: 'a', available: undefined } as unknown as MenuItem,
      { id: 'b', available: null } as unknown as MenuItem,
      { id: 'c', available: 0 } as unknown as MenuItem,
    ];
    const selected = new Set(['a', 'b', 'c']);
    expect(computeBulkAvailabilityCounts(items, selected)).toEqual({
      availableCount: 0,
      unavailableCount: 3,
    });
  });

  test('empty items list → both counts 0', () => {
    const result = computeBulkAvailabilityCounts(
      [],
      new Set(['phantom']),
    );
    expect(result).toEqual({ availableCount: 0, unavailableCount: 0 });
  });

  test('order of items does not affect counts', () => {
    const a = [make('a', true), make('b', false)];
    const b = [make('b', false), make('a', true)];
    const selected = new Set(['a', 'b']);
    expect(computeBulkAvailabilityCounts(a, selected)).toEqual(
      computeBulkAvailabilityCounts(b, selected),
    );
  });

  test('returns plain numbers (no NaN / Infinity leaks)', () => {
    const items = [make('a', true), make('b', false)];
    const selected = new Set(['a', 'b']);
    const result = computeBulkAvailabilityCounts(items, selected);
    expect(Number.isFinite(result.availableCount)).toBe(true);
    expect(Number.isFinite(result.unavailableCount)).toBe(true);
  });
});
```

### §C — Wire the helper into `ShopMenuScreen.tsx`

#### §C.1 — Compute counts via `useMemo` (insert near existing useMemos around lines 140–155)

```tsx
// PR-NEXT-ENH-1 (finding #4 follow-up) — smart bulk-action labels.
// availableCount drives the "Mark N unavailable" button (those items
// flip down); unavailableCount drives "Mark N available" (those flip
// up). Buttons whose flip-count is 0 are no-ops and get hidden by
// the render below.
const { availableCount: bulkAvailableCount, unavailableCount: bulkUnavailableCount } =
  useMemo(
    () => computeBulkAvailabilityCounts(items, selectedIds),
    [items, selectedIds],
  );
```

Import at top of file:

```tsx
// PR-NEXT-ENH-1 — DO NOT REMOVE.
import { computeBulkAvailabilityCounts } from '../../utils/bulkAvailabilityCounts';
```

#### §C.2 — Update `handleBulkSetAvailability` to send only items that flip

Find the existing handler (lines 215–262). Replace the `const ids = Array.from(selectedIds);` block at the top with a filter that selects only items whose current state differs from the target. Keep the rest of the function (server call, optimistic update, error handling) unchanged in shape.

```tsx
const handleBulkSetAvailability = async (available: boolean) => {
  // PR-NEXT-ENH-1 (finding #4 follow-up) — send only the IDs whose
  // current state differs from the target. For uniform selections
  // (all already in target state) this returns early without a
  // server round-trip. For mixed selections we send exactly the
  // items the user expects to flip — matches the smart-label count.
  const idsToFlip = items
    .filter(i => selectedIds.has(i.id) && i.available !== available)
    .map(i => i.id);
  if (idsToFlip.length === 0) return;

  const verb = available ? 'available' : 'unavailable';
  Alert.alert(
    `Mark ${idsToFlip.length} item${idsToFlip.length > 1 ? 's' : ''} ${verb}?`,
    'This will update all selected items at once.',
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Confirm',
        style: available ? 'default' : 'destructive',
        onPress: async () => {
          setBulkSubmitting(true);
          try {
            const r = await orderService.bulkUpdateMenuAvailability({
              menuItemIds: idsToFlip,
              available,
            });
            // Optimistically reflect locally before the refresh
            // round-trip completes so the toggles flip immediately.
            // PR-NEXT-ENH-1 — only flip items that actually changed
            // server-side; keep already-in-target-state items as-is
            // (they weren't touched).
            const flippedSet = new Set(idsToFlip);
            setItems(prev =>
              prev.map(it =>
                flippedSet.has(it.id) ? { ...it, available } : it,
              ),
            );
            exitSelectMode();
            if (r.skippedCount > 0) {
              Alert.alert(
                'Updated with skips',
                `${r.updatedCount} updated, ${r.skippedCount} skipped (item may no longer exist).`,
              );
            }
            // Refresh from server so any drift surfaces.
            fetchOnce();
          } catch (e: any) {
            Alert.alert(
              'Bulk update failed',
              e?.message ?? 'Please try again.',
            );
          } finally {
            setBulkSubmitting(false);
          }
        },
      },
    ],
  );
};
```

Key changes:

- `idsToFlip = items.filter(i => selectedIds.has(i.id) && i.available !== available).map(i => i.id)` — replaces `Array.from(selectedIds)`.
- Confirmation Alert uses `idsToFlip.length` instead of `selectedIds.size` — title matches the smart-label count.
- Optimistic update uses a `flippedSet` instead of `selectedIds` — items that weren't in `idsToFlip` are deliberately untouched.

#### §C.3 — Smart-label render in the bulk action bar

Replace the current bulk bar block (lines 567–591) with:

```tsx
{/* PR 8 Part B — bottom sticky action bar. Visible only in
    selectMode; the two action buttons render conditionally based
    on PR-NEXT-ENH-1's smart-label counts.
    
    PR-NEXT-ENH-1 (finding #4 follow-up) — instead of two
    constant-count buttons that include no-op options, each
    button renders only when its flip-count is > 0:
    
      bulkAvailableCount   > 0 → show "Mark N unavailable"
      bulkUnavailableCount > 0 → show "Mark N available"
    
    Empty selection (both counts 0) → bar collapses to empty (no
    actionable button rendered). The "Done" header affordance
    stays available to exit select mode. */}
{selectMode && (bulkAvailableCount > 0 || bulkUnavailableCount > 0) && (
  <View style={styles.bulkBar}>
    {bulkAvailableCount > 0 && (
      <View style={{ flex: 1 }}>
        <Button
          title={`Mark ${bulkAvailableCount} unavailable`}
          onPress={() => handleBulkSetAvailability(false)}
          variant="secondary"
          disabled={bulkSubmitting}
          loading={bulkSubmitting}
        />
      </View>
    )}
    {bulkAvailableCount > 0 && bulkUnavailableCount > 0 && (
      <View style={{ width: spacing.sm }} />
    )}
    {bulkUnavailableCount > 0 && (
      <View style={{ flex: 1 }}>
        <Button
          title={`Mark ${bulkUnavailableCount} available`}
          onPress={() => handleBulkSetAvailability(true)}
          disabled={bulkSubmitting}
          loading={bulkSubmitting}
        />
      </View>
    )}
  </View>
)}
```

Notes on the render:

- **Both counts 0 (empty selection):** the outer `&&` short-circuits and the bar disappears entirely. Shopkeeper can keep selecting items; the bar reappears the moment any selected item is flippable.
- **Only one button visible (uniform selection):** that button takes full width via `flex: 1` with no sibling. Clean, no awkward gap.
- **Both buttons visible (mixed selection):** spacer + flex layout matches the pre-PR look.

### §D — No callable change

`orderService.bulkUpdateMenuAvailability` already accepts an arbitrary list of menu item IDs and writes the requested `available` value. The server doesn't care whether we send all selected IDs or just the ones that will flip — the new call site just sends fewer (the right ones).

---

## Discipline checklist

1. **Rule 1 — Imports stay.** New `computeBulkAvailabilityCounts` import in `ShopMenuScreen.tsx` carries explicit "DO NOT REMOVE" comment matching local discipline.
2. **Rule 2 — Hooks above conditionals.** New `useMemo` for the counts sits with the other useMemos at the top of the component, above any early returns or conditional renders.
3. **Rule 8 — Stable references in Zustand selectors.** N/A — no Zustand involvement; this is local component state.
4. **No schema, no callable.** Pure client-side fix.
5. **Test discipline.** §B adds ~10 helper tests. Suite count +10.
6. **OTA classification.** Pure JS. No `app.json`, no permission, no plugin. OTA-safe.

---

## Acceptance checklist

Need one shop owner account with a menu containing both available and unavailable items (use the pilot shop or set up via Firestore Console).

**Smart labels — uniform selection:**

1. Open Shop Menu screen. Tap "Select" to enter select mode.
2. Select 3 items that are all **available**. Bulk bar should show **only** "Mark 3 unavailable" (the secondary-styled button, full-width). The "Mark 3 available" button is NOT rendered.
3. Select 3 items that are all **unavailable** (clear selection first or pick from the Unavailable filter). Bulk bar should show **only** "Mark 3 available" (the primary-styled button, full-width). The "Mark 3 unavailable" button is NOT rendered.

**Smart labels — mixed selection:**

4. Select 2 available + 1 unavailable. Bulk bar shows **both** buttons:
   - "Mark 2 unavailable" (the 2 available items)
   - "Mark 1 available" (the 1 unavailable item)
   - Layout matches pre-PR look (two side-by-side flex:1 buttons with a small spacer).
5. Tap "Mark 2 unavailable." Confirmation Alert title reads `"Mark 2 items unavailable?"` (the count matches the smart label, NOT the total selection of 3).
6. Confirm. Server receives only the 2 already-available IDs. Optimistic update flips those 2 to unavailable. The 1 already-unavailable item stays unavailable (untouched). Watcher refresh confirms.

**Smart labels — empty selection:**

7. Tap an item to deselect it; reach 0 selected. The bulk bar **disappears entirely** (no empty colored strip). "Done" header still works to exit select mode.

**Mark available path:**

8. Select 2 unavailable items. Bulk bar shows "Mark 2 available." Tap it. Confirmation Alert: `"Mark 2 items available?"`. Confirm. Server flips both. UI updates.

**Mixed Mark-available:**

9. Select 1 available + 2 unavailable. Bulk bar shows "Mark 1 unavailable" + "Mark 2 available." Tap "Mark 2 available." Confirmation Alert: `"Mark 2 items available?"`. Confirm. Server receives only the 2 unavailable IDs. The 1 already-available item is unchanged.

**Server-side no-op check (rare):**

10. Edge case: select an item, but before tapping the bulk button, another tab/process changes the item's state. The smart-label count might be stale. Tap the button anyway — `idsToFlip` is recomputed at click time from current `items` state. If the watcher has already reflected the change, the click sends the correct subset (possibly empty → no-op short-circuit returns early). No server-side ill effect.

**Regression — existing fix unaffected:**

11. The PR-NEXT-4 bulk-availability server fix is unchanged. Confirm by running a normal bulk action with no failures (no "Updated with skips, 0 updated, N skipped" error).

**Test suite:**

12. `npx tsc --noEmit` clean
13. `npm run test:unit` clean; suite count +10

---

## Out of scope (explicit deferrals)

- **Bulk delete from this screen.** That's ENH-2 (finding #5 follow-up) — separate PR.
- **Multi-shop or admin-side bulk actions.** Only shopkeeper's own menu (`ShopMenuScreen`).
- **Per-item "what would change" preview.** Could show inline marks next to each selected item (e.g. ⬇ for "will flip down"). Out of scope for v1; the smart-label counts in the action bar carry enough info.
- **Animating the button appearance/disappearance** when selection composition changes. Vanilla React Native re-render is fine; layout shift is acceptable for an action bar.

---

## Deploy plan

Pure client OTA:

```
npx tsc --noEmit            # clean
npm run test:unit           # all green; suite count +10
git commit -m "PR-NEXT-ENH-1: smart bulk-action labels on shopkeeper menu (finding #4 follow-up)"
eas update --branch production --message "PR-NEXT-ENH-1 smart bulk labels"
```

Pull on shop owner device → run the 13-step acceptance checklist.

---

## Doc trail updates after ship

- `docs/TESTING-FINDINGS-2026-05-30.md` — under finding #4, add a sub-note: `Smart bulk-action labels (flip-count, no-op buttons hidden) → ✅ SHIPPED in PR-NEXT-ENH-1 (June 1 2026)`.
- `docs/SESSION_LOG.md` — one-paragraph entry covering the helper extraction, the handler change to send only flip-targets, the smart-label JSX.
- `CLAUDE.md` — bump date.
- `PRELAUNCH_CHECKLIST.md` — short note under the PR-NEXT-4 block.
