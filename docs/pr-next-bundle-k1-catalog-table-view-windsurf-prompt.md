# PR-NEXT-BUNDLE-K.1 — Catalog table view + voice auto-advance

**Source:** Sudhir's design pivot post-Bundle-K deploy (2026-06-13). The swipe-card UX from Bundle K §C is too slow for a real kirana onboarding session — a shopkeeper handed 500 cards to swipe one-by-one will burn out at item 50. Sudhir's better design: an Excel-style scrollable table where each row is one item, prices are entered inline (type OR voice), and skipping is the default for items the shop doesn't carry. Voice mode auto-advances top-to-bottom row by row, matching how kirana already read rate lists from paper.

**Scope:** pure client UI pivot. **Zero server changes.** Server callables from Bundle K (`listMasterCatalogByCategory`, `commitShopMenuItem`, `commitShopMenuItemsBulk`, `proposeMasterCatalogItem`, `reviewPendingCatalogItem`, `listPendingCatalogItems`) all stay as-is. Schema, indexes, rules stay as-is. This PR only rebuilds the UI layer for the per-category browse.

**Deploy class:** **pure client OTA.** No `firebase deploy --only functions` step. Just `eas update`.

## Required completion-report verification block (Rule 5 worked example #14)

In your final report, paste the literal output of:

```bash
wc -l src/screens/shop/catalog/CategoryListScreen.tsx
wc -l src/screens/shop/catalog/CategoryBrowseScreen.tsx 2>/dev/null
grep -n "CategoryBrowseScreen" src/navigation/AppNavigator.tsx
grep -n "CategoryListScreen" src/navigation/AppNavigator.tsx
ls -la src/components/catalog/
wc -l src/utils/catalogBrowseHelpers.ts 2>/dev/null
npx jest tests/utils/catalogBrowseHelpers tests/components/CategoryListScreen 2>&1 | tail -15
```

Line numbers must be within file bounds (verify with `wc -l <file>`). The completion-report verification block discipline closed the Bundle I §D/§E saga; applies here too.

## Schema audit-grep (Rule 5)

```
grep -n "CategoryBrowseScreen\|CategoryListScreen" src/navigation/AppNavigator.tsx src/screens/shop/catalog/BuildCatalogScreen.tsx
grep -rn "VoicePriceCapture\|parseVoicePriceInput" src
grep -rn "commitShopMenuItem\|commitShopMenuItemsBulk" src
```

| Symbol | Confirmed at | Notes |
| --- | --- | --- |
| `BuildCatalogScreen` | `src/screens/shop/catalog/BuildCatalogScreen.tsx` (Bundle K §F) | Entry hub; stays as-is. Tap a category → opens new CategoryListScreen instead of CategoryBrowseScreen. |
| `CategoryBrowseScreen` | `src/screens/shop/catalog/CategoryBrowseScreen.tsx` (Bundle K §C) | The swipe-card screen. **DELETE in §F.** |
| `CategoryListScreen` | NEW file in this PR | The table view replacement. §A. |
| `VoicePriceCapture` | `src/components/catalog/VoicePriceCapture.tsx` (Bundle K §D) | **Rewire for inline row context.** No longer a full-screen modal — becomes a thin top bar with mic state. §C. |
| `parseVoicePriceInput` | `src/utils/voicePriceHelpers.ts` (Bundle K §D) | Pure helper. Unchanged. |
| `CatalogReviewScreen` | `src/screens/shop/catalog/CatalogReviewScreen.tsx` (Bundle K §E) | Unchanged. Final review screen still appropriate. |
| `commitShopMenuItem` / `commitShopMenuItemsBulk` | `functions/src/index.ts` (Bundle K §B) | Server-side, unchanged. |

## Autonomous execution authorization

You may run the following without stopping to confirm — execute, report results in the final summary:

- All `Read`, `Grep`, `Glob`, `ls`, `git status`, `git diff` (read-only)
- `npx tsc --noEmit` (root)
- `npm test`, `npm run test:unit`, `npx jest`
- File edits to:
  - `src/screens/shop/catalog/CategoryListScreen.tsx` (NEW)
  - `src/utils/catalogBrowseHelpers.ts` (NEW — pure helpers for row state + auto-advance)
  - `src/components/catalog/VoicePriceCapture.tsx` (rewire — see §C)
  - `src/screens/shop/catalog/BuildCatalogScreen.tsx` (one-line nav change — see §E)
  - `src/navigation/AppNavigator.tsx` (replace route)
  - Test files for the above
- File deletion of `src/screens/shop/catalog/CategoryBrowseScreen.tsx` (§F — only after CategoryListScreen is wired in and tested)

You MUST stop and ask before:
- Deploy commands (`eas update`, `firebase deploy`, `gcloud …`)
- Editing files NOT in the above list
- Touching any server-side code (`functions/`)
- Touching schema, indexes, rules
- Editing `CatalogReviewScreen` or `ProposeCustomItemScreen` (both correct as-is for the new flow)

Default posture: **execute, report at end.**

## Design — what the table view looks like

```
┌────────────────────────────────────────────┐
│ ← Atta, Rice & Dal · 12/70 priced          │
├────────────────────────────────────────────┤
│ [🎤 Start voice]   ┊   [Save 12 items]    │ ← sticky top bar
├────────────────────────────────────────────┤
│ [📷] Aashirvaad Atta 5kg                   │
│      MRP ₹280   Price ₹[___]  [✓MRP]       │ ← row 1 (focused)
├────────────────────────────────────────────┤
│ [📷] Aashirvaad Atta 10kg                  │
│      MRP ₹540   Price ₹[___]  [✓MRP]       │ ← row 2
├────────────────────────────────────────────┤
│ [📷] Pillsbury Atta 5kg                    │
│      MRP ₹265   Price ₹[275]  [✓MRP]  ✓    │ ← row 3 (priced)
├────────────────────────────────────────────┤
│ [📷] Fortune Atta 5kg                      │
│      MRP ₹260   Price ₹[___]  [✓MRP]       │ ← row 4
├────────────────────────────────────────────┤
│ ... 66 more rows, scroll ...               │
└────────────────────────────────────────────┘
```

**Row anatomy** (target ~80px tall — 8-10 rows visible per phone screen):

- 48×48 product thumbnail on left
- Item name + pack size stacked (2 lines max, truncate with ellipsis)
- MRP shown small ("MRP ₹280")
- Price input field (right-aligned, `₹` prefix, numeric keypad)
- MRP one-tap button (checkbox or pill — taps → fills price with MRP value)
- Status indicator on right: green check ✓ when row has a price; muted otherwise

**Voice mode (Option A — auto-advance):**

1. User taps **[🎤 Start voice]** at top
2. App highlights first un-priced row (yellow/green border + auto-scroll into view)
3. App listens: shopkeeper reads item name + speaks price ("Aashirvaad atta 5 kilo, two-eighty-five rupees" / "do sau pachas")
4. `parseVoicePriceInput` extracts the number (item name is ignored — current-row context says which item)
5. Confirmation chip appears briefly ("₹285 captured") + price field fills + row turns green
6. Auto-advance to next **un-priced** row (skipping rows already priced), highlight it, listen again
7. If shopkeeper says "skip" or "next" → no commit, advance to next row
8. If shopkeeper says "stop" or taps **[🎤 Stop voice]** → exits voice mode, current row stays focused
9. If `parseVoicePriceInput` returns low confidence → confirmation chip stays visible 3 seconds with "Try again?" — no auto-commit on ambiguous input

**Type mode (always available, no toggle needed):**

- Tap any price field → keyboard opens
- Type number + tap return/done → commits price, row turns green
- Doesn't auto-advance (user is driving; tap next row themselves)

## Plan

### §A — `CategoryListScreen.tsx` (the table view)

`src/screens/shop/catalog/CategoryListScreen.tsx`:

State (all `useState` ABOVE conditional returns per Rule 2):

```ts
const [items, setItems] = useState<MasterCatalogItem[]>([]);  // from listMasterCatalogByCategory
const [loading, setLoading] = useState(true);
const [priceDrafts, setPriceDrafts] = useState<Map<string, number>>(new Map());  // productId → price
const [voiceMode, setVoiceMode] = useState(false);
const [focusedProductId, setFocusedProductId] = useState<string | null>(null);
const [voiceConfirmationChip, setVoiceConfirmationChip] = useState<{ productId: string; price: number; confidence: 'high' | 'low' } | null>(null);
```

Mount: call `orderService.listMasterCatalogByCategory({ category, pageSize: 200 })`. For pilot scale, 70-200 items per category is fine on initial load; no pagination needed in V1.

UI structure:
- `<SafeAreaView>` with sticky `ScreenHeader` ("Atta, Rice & Dal · 12/70 priced")
- Sticky top bar: `[🎤 Start voice]` button + `[Save N items]` button (only shown when at least 1 item priced)
- `<FlatList>` of rows, each item rendered via `<CategoryListRow>` subcomponent
- Bottom action bar: same Save button (duplicated for reach when scrolled deep)

`<CategoryListRow>`:
- Takes `{ item, draftPrice, isFocused, onPriceChange, onMrpAccept, onTapRow }`
- Renders the row anatomy from the design above
- TextInput with numeric keypad for inline typing
- "MRP" pill that taps to set `draftPrice = item.mrp`
- Border color changes based on state (focused / priced / default)

Photo: use existing `formatPartnerAvatar` pattern — `<Image>` with `onError` fallback to a styled letter box (first letter of item name).

Tap-row interaction:
- Tap anywhere in the row body (not on price input) → sets `focusedProductId = item.productId`, scrolls into view
- This sets up the row for voice when voice mode is active

Save button:
- Disabled until `priceDrafts.size > 0`
- Tap → navigate to `CatalogReviewScreen` (existing) with drafts in route params, OR direct-commit via `commitShopMenuItemsBulk` if drafts.size ≤ 50; show progress toast

### §B — Pure helpers in `src/utils/catalogBrowseHelpers.ts`

```ts
/**
 * PR-NEXT-BUNDLE-K.1 — pure helpers for the catalog table view.
 * Pinned by tests/utils/catalogBrowseHelpers.test.ts.
 */

export type CategoryListItemRow = {
  productId: string;
  name: string;
  brand?: string;
  packSize: { value: number; unit: string };
  mrp: number;
  imageUrl: string;
};

/**
 * Find the next un-priced row after the current focus, for voice auto-advance.
 * Returns null if no un-priced rows remain after current focus.
 */
export function findNextUnpricedRow(
  items: CategoryListItemRow[],
  drafts: Map<string, number>,
  currentFocusId: string | null,
): CategoryListItemRow | null {
  const startIdx = currentFocusId
    ? items.findIndex(i => i.productId === currentFocusId) + 1
    : 0;
  for (let i = startIdx; i < items.length; i++) {
    if (!drafts.has(items[i].productId)) return items[i];
  }
  return null;
}

/**
 * Find the FIRST un-priced row from the top (used when voice mode starts).
 */
export function findFirstUnpricedRow(
  items: CategoryListItemRow[],
  drafts: Map<string, number>,
): CategoryListItemRow | null {
  for (const item of items) {
    if (!drafts.has(item.productId)) return item;
  }
  return null;
}

/**
 * Compute progress summary for the screen header / bar.
 */
export function computeCategoryProgress(
  items: CategoryListItemRow[],
  drafts: Map<string, number>,
): { priced: number; total: number; percentage: number } {
  return {
    priced: drafts.size,
    total: items.length,
    percentage: items.length === 0 ? 0 : Math.round((drafts.size / items.length) * 100),
  };
}

/**
 * Validate a single price entry against MRP sanity bounds — same rules as
 * server-side commitShopMenuItem. Client-side check gives instant feedback.
 */
export function validateInlinePrice(
  price: number,
  mrp: number,
): { ok: true } | { ok: false; reason: string } {
  if (!Number.isFinite(price) || price <= 0) {
    return { ok: false, reason: 'Enter a price greater than 0' };
  }
  if (price > mrp * 10) {
    return { ok: false, reason: `Price seems too high (MRP is ₹${mrp})` };
  }
  return { ok: true };
}
```

Pin **+8 tests** on these helpers (find next from start of list, find next after focused row, find next when at end (returns null), all rows priced (returns null), empty items (returns null), first unpriced when none priced (returns first), validate price too high, validate price zero/negative).

### §C — Rewire `VoicePriceCapture.tsx`

Bundle K §D's component was a full-screen modal. For the table view it becomes a **persistent top bar element** (the `[🎤 Start voice]` button) and a small floating confirmation chip.

New component shape:

```ts
type Props = {
  active: boolean;                                          // voice mode on/off
  onActiveChange: (active: boolean) => void;                // toggle
  focusedItem: CategoryListItemRow | null;                  // current row being prompted
  onPriceCaptured: (productId: string, price: number) => void;  // commit
  onSkipRow: () => void;                                    // user said "skip" → parent advances
};
```

Behavior:
- When `active === false`: renders just the **[🎤 Start voice]** button. Tap → toggles to active.
- When `active === true`:
  - Renders **[🎤 Stop voice]** button + a status line ("Listening for ${focusedItem.name}…")
  - Internally calls the existing voice STT subscription
  - On each utterance:
    - Pass to `parseVoicePriceInput(text, lang)` from `voicePriceHelpers.ts`
    - If `confidence: 'high'` AND `price` valid → call `onPriceCaptured(focusedItem.productId, price)`, show chip "₹X captured" for 1.5s
    - If `confidence: 'low'` → show chip "Try again — say the price clearly" for 3s; do NOT auto-commit
    - If utterance contains "skip" / "next" → call `onSkipRow()`
    - If utterance contains "stop" / "done" → call `onActiveChange(false)`

The confirmation chip is a small absolute-positioned overlay above the sticky top bar — non-blocking, auto-dismisses.

### §D — Wire it together in CategoryListScreen

The voice flow in CategoryListScreen orchestrates:

```ts
const handleVoiceToggle = (active: boolean) => {
  setVoiceMode(active);
  if (active) {
    // Find first un-priced row, set as focus, scroll into view
    const first = findFirstUnpricedRow(items, priceDrafts);
    if (first) {
      setFocusedProductId(first.productId);
      flatListRef.current?.scrollToItem({ item: first, animated: true });
    }
  }
};

const handlePriceCaptured = (productId: string, price: number) => {
  // Commit to drafts
  setPriceDrafts(prev => new Map(prev).set(productId, price));
  // Auto-advance to next un-priced row
  const next = findNextUnpricedRow(items, priceDrafts, productId);
  if (next) {
    setFocusedProductId(next.productId);
    flatListRef.current?.scrollToItem({ item: next, animated: true });
  } else {
    // All rows priced — exit voice mode and prompt to save
    setVoiceMode(false);
    // toast: "All rows priced. Tap Save when ready."
  }
};

const handleSkipRow = () => {
  if (!focusedProductId) return;
  const next = findNextUnpricedRow(items, priceDrafts, focusedProductId);
  if (next) {
    setFocusedProductId(next.productId);
    flatListRef.current?.scrollToItem({ item: next, animated: true });
  } else {
    setVoiceMode(false);
  }
};
```

The FlatList ref (`flatListRef`) drives auto-scroll. `scrollToItem` from React Native FlatList is the standard call.

### §E — Update navigation routing

`src/navigation/AppNavigator.tsx`:

```ts
// BEFORE
import CategoryBrowseScreen from '../screens/shop/catalog/CategoryBrowseScreen';
// ...
<Stack.Screen name="CategoryBrowse" component={CategoryBrowseScreen} options={...} />
```

```ts
// AFTER
// PR-NEXT-BUNDLE-K.1 — DO NOT REMOVE. Replaces swipe-card flow with table view.
import CategoryListScreen from '../screens/shop/catalog/CategoryListScreen';
// ...
<Stack.Screen name="CategoryList" component={CategoryListScreen} options={...} />
```

Route param shape stays the same (`{ category: CategoryId }`).

`src/screens/shop/catalog/BuildCatalogScreen.tsx`: one-line change — replace `nav.navigate('CategoryBrowse', ...)` with `nav.navigate('CategoryList', ...)`.

### §F — Delete the swipe-card screen

After §A–§E pass tests + `tsc --noEmit` clean:

```bash
rm src/screens/shop/catalog/CategoryBrowseScreen.tsx
```

Also remove any unused imports left behind in BuildCatalogScreen or AppNavigator after the rewire.

Run final `tsc --noEmit` to confirm nothing else references the removed file.

### §G — Tests

| Section | Tests | Notes |
| --- | --- | --- |
| §B `catalogBrowseHelpers` | +8 | Pure helpers — table coverage |
| §C `VoicePriceCapture` (rewired) | +5 | Active toggle, high/low confidence path, skip/stop verbal commands |
| §A `CategoryListScreen` component | +5 | Row rendering, MRP one-tap, type-then-commit, voice auto-advance, save button gating |
| §D auto-advance integration | +3 | First row focus, next-row computation, end-of-list exit |
| §F regression — no stale CategoryBrowseScreen references | +1 | Static guard: `grep -rn "CategoryBrowseScreen" src --include="*.tsx" --include="*.ts"` must return zero |
| **Total** | **+22 minimum** | Suite ~1639 → ~1661 |

## Discipline checklist

1. **Rule 1** — every new import / state carries "PR-NEXT-BUNDLE-K.1 — DO NOT REMOVE" comments.
2. **Rule 2** — all `useState` in CategoryListScreen sit ABOVE conditional returns.
3. **Rule 5** — schema audit-grep in header. Pure client UI; no field reads outside what Bundle K already covers.
4. **Rule 7** — N/A (no server auth).
5. **Rule 8** — FEATURES.md update in Doc trail. Shop panel §2.3 row updated to reflect table view.
6. **Rule 11** — N/A (no new callables).
7. **Rule 13** — N/A.
8. **Rule 14** — pure helpers in §B return discriminated-union Result where applicable.
9. **All 6 existing static guards** must pass post-PR.
10. **Test discipline:** **+22 tests minimum.**

## Acceptance checklist

1. **§A** Open shop catalog wizard → tap a category → CategoryListScreen opens with all items in that category visible as a scrollable list. Photo + name + pack + MRP visible per row. Rows are ~80px tall; 8-10 visible per phone screen.
2. **§A** Tap a price field → numeric keypad opens → type "275" → tap done/return → row turns green with ✓ indicator. Save button enables.
3. **§A** Tap MRP one-tap button on a row → price field instantly fills with the MRP value, row turns green.
4. **§C/§D** Tap **[🎤 Start voice]** → first un-priced row gets focused (highlighted + scrolled into view). Status line says "Listening for {item name}…"
5. **§C/§D** Speak "two hundred fifty" → confirmation chip "₹250 captured" briefly appears → price field fills → row turns green → next un-priced row auto-focused.
6. **§C/§D** Speak "skip" → no commit, advance to next un-priced row.
7. **§C/§D** Speak ambiguous input (e.g., mumbled number) → `parseVoicePriceInput` returns low confidence → chip "Try again — say the price clearly" stays 3 sec, no commit, row stays focused.
8. **§C/§D** Tap **[🎤 Stop voice]** or say "stop" → exits voice mode, row stays at last focused position.
9. **§A** After pricing 30 rows in a category, tap **Save 30 items** → calls `commitShopMenuItemsBulk` → toast confirms → returns to BuildCatalogScreen with updated category status ("30/70 items").
10. **§A** Open same category again → previously priced rows show their saved prices and green ✓; un-priced rows are blank.
11. **§E** Navigation: BuildCatalogScreen → tap category → CategoryListScreen. NOT CategoryBrowseScreen (deleted).
12. **§F** `grep -rn "CategoryBrowseScreen" src` returns zero results.
13. `tsc --noEmit` clean. Test suite +22.
14. **Deliberate-break demo (§B):** revert `findNextUnpricedRow` to return `items[0]` always. The "voice auto-advance from end of list returns null" test must fail. Restore. Test passes.
15. **Deliberate-break demo (§D auto-advance):** corrupt the auto-scroll call so it stays on the same row. Integration test for "after price captured, next row gets focus" must fail. Restore. Test passes.

## Out of scope

- **Real product photo sourcing.** Cowork task in parallel; doesn't block this PR.
- **Server-side changes.** Bundle K server is correct; this is UI-only.
- **CatalogReviewScreen redesign.** Still correct as the final review pre-commit. Reachable via Save button.
- **Customer-side display.** Already correct from Bundle K §I; no changes needed.
- **PDF download / paper workflow.** Bundle L, separate PR.

## Deploy

```
npx tsc --noEmit
npm test
eas update --branch production --message "Bundle K.1 — catalog table view + voice auto-advance row by row"
```

No server deploy. No backfill. Pure client OTA.

## Doc trail (Cowork)

After ship:

- **CLAUDE.md** — strike Bundle K.1 from in-flight. Note that Bundle K's swipe-card UX was pivoted to table view based on Sudhir's UX read.
- **SESSION_LOG** — paragraph capturing: design pivot from one-item-per-screen swipe to many-items-per-screen table; matches kirana rate-list mental model; voice auto-advance replaces voice-modal.
- **PROMPT_AUTHORING_NOTES** — add Rule 6 corollary: *"When a UX design is more 'app-native' than 'industry-native,' default to the industry-native pattern. Kirana shopkeepers read rate lists from paper — a scrollable table matches that mental model. Swipe cards are app-native pretty but slow for bulk entry."*
- **FEATURES.md** (per Rule 8 — mandatory):
  - **Shop panel §2.3 Menu management** — edit the "Catalog onboarding wizard" row: description changes from `"Browse 500-item master catalog by category, set price via swipe (MRP) / voice (Hindi+English) / type"` to `"Browse 500-item master catalog by category as a scrollable table; set price inline via type, MRP one-tap, or voice (auto-advances row-by-row in Hindi+English)"`. Source column → `Bundle K + K.1`. Lineage HTML comment.
  - **Last updated** stamp on Shop §2.3 → 2026-06-13.
