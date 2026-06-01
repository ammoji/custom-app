# PR-NEXT-ENH-3 — Category quick-pick chips on customer ShopDetailScreen

**Source:** Finding #6 follow-up in `docs/TESTING-FINDINGS-2026-05-30.md`. PR-NEXT-9 shipped item-name search on ShopDetailScreen. Sudhir's test response: *"I see the option to search any individual item… category level search will give more choices to the customer. sometime they don't know what to search so category search will help them."*

This PR adds a horizontal chip row of category filters above the existing menu. Composes with PR-NEXT-9's search: when both are set, the customer sees `<items whose name matches query> AND <items in selected category>`.

**Deploy class:** pure client OTA. No callable change, no schema. Ships via `eas update --branch production`.

**Read first**

1. `CLAUDE.md` (full)
2. `docs/TESTING-FINDINGS-2026-05-30.md` — finding #6 entry + test result follow-up
3. `docs/pr-next-9-in-shop-search-windsurf-prompt.md` — parent PR that introduced the in-shop search bar
4. `.windsurf/code-discipline.md` (Rules 1, 2)
5. `src/screens/HomeScreen.tsx` lines 345–362 — template for the category chip row pattern (mirror the visual; NOT the navigation-to-Search action — for ShopDetailScreen the chips filter in-place)
6. `src/screens/ShopDetailScreen.tsx`:
   - Lines 67–69 — search state (insertion point for new `selectedCategory` state above the existing useMemos)
   - Lines 133–149 — `filteredMenu` + `sections` useMemos (the category-filter step inserts between these two)
   - Lines 224–286 — the `ListHeaderComponent` block (chip row inserts below the MenuSearchBar at line 266+)
   - Lines 293–315 — `ListEmptyComponent` (extend to handle category-filtered empty case)
7. `src/constants/categories.ts` — the `CATEGORIES` array + `CategoryId` type. No changes needed.

---

## Why this matters

Today's customer browse flow inside a shop:

- Open ShopDetailScreen → SectionList grouped by category, sticky section headers
- (Post PR-NEXT-9) Type a search query → filter by item name
- Either scroll through every section or rely on the customer KNOWING what they want to search for

Sudhir's framing: *"sometime they don't know what to search."* A customer browsing for ideas needs a different affordance — category chips that let them jump directly to "Dairy & Eggs" or "Snacks & Biscuits" without committing to a specific search term. The chips are a discovery affordance; the search bar is for known items.

---

## Plan

### §A — Pure helper `src/utils/filterMenuByCategory.ts` (new)

Tiny one-line helper, extracted for testability + consistency with PR-NEXT-9's `menuSearchHelpers` pattern.

```ts
/**
 * PR-NEXT-ENH-3 (finding #6 follow-up) — filter a menu list down to
 * a single category. Reference-equality return when no category is
 * selected (matches PR-NEXT-9's `filterMenuByQuery` posture so the
 * screen's useMemo doesn't churn on empty filters).
 *
 * Defensive: items with non-string `category` are dropped silently.
 * Should never happen in practice — `addCustomMenuItem` validates
 * category against the whitelist — but the cost of the check is one
 * comparison per item.
 */
import type { CategoryId } from '../constants/categories';

export function filterMenuByCategory<T extends { category: string }>(
  items: T[],
  selectedCategory: CategoryId | null,
): T[] {
  if (selectedCategory == null) return items;
  return items.filter(
    i => typeof i.category === 'string' && i.category === selectedCategory,
  );
}
```

### §B — Helper tests `tests/utils/filterMenuByCategory.test.ts` (new)

Pin reference-equality returns + filter correctness. ~6 cases:

```ts
import { filterMenuByCategory } from '../../src/utils/filterMenuByCategory';

const items = [
  { id: 'a', category: 'atta_rice_dal' },
  { id: 'b', category: 'bakery' },
  { id: 'c', category: 'atta_rice_dal' },
  { id: 'd', category: 'dairy_eggs' },
];

describe('filterMenuByCategory', () => {
  test('null category returns input array by REFERENCE', () => {
    expect(filterMenuByCategory(items, null)).toBe(items);
  });

  test('matching category returns only items in that category', () => {
    expect(filterMenuByCategory(items, 'atta_rice_dal' as any)).toEqual([
      { id: 'a', category: 'atta_rice_dal' },
      { id: 'c', category: 'atta_rice_dal' },
    ]);
  });

  test('non-matching category returns empty array', () => {
    expect(filterMenuByCategory(items, 'personal_care' as any)).toEqual([]);
  });

  test('preserves input order across multiple matches', () => {
    const result = filterMenuByCategory(items, 'atta_rice_dal' as any);
    expect(result.map(i => i.id)).toEqual(['a', 'c']);
  });

  test('drops items with non-string category silently', () => {
    const malformed = [
      { id: 'a', category: 'bakery' },
      { id: 'b', category: null as any },
      { id: 'c', category: 42 as any },
      { id: 'd', category: 'bakery' },
    ];
    expect(filterMenuByCategory(malformed, 'bakery' as any)).toEqual([
      { id: 'a', category: 'bakery' },
      { id: 'd', category: 'bakery' },
    ]);
  });

  test('empty items list returns empty array', () => {
    expect(filterMenuByCategory([], 'bakery' as any)).toEqual([]);
  });
});
```

### §C — Wire the helper + chip row into `ShopDetailScreen.tsx`

#### §C.1 — Add state

Insert near the existing search state (around line 67–69):

```tsx
// PR-NEXT-ENH-3 (finding #6 follow-up) — category quick-pick chips.
// Single-select: tap a chip to filter; tap the same chip again to
// clear. Default null = no category filter (show all categories
// grouped as today).
const [selectedCategory, setSelectedCategory] =
  useState<CategoryId | null>(null);
```

Import at top of file:

```tsx
// PR-NEXT-ENH-3 — DO NOT REMOVE.
import { CategoryId } from '../constants/categories';
import { filterMenuByCategory } from '../utils/filterMenuByCategory';
```

(`CATEGORIES` is already imported per current usage.)

#### §C.2 — Compose the filter chain (between search filter and section grouping)

The existing chain is:

```tsx
const filteredMenu = useMemo(
  () => filterMenuByQuery(menu, searchQuery),
  [menu, searchQuery],
);

const sections = useMemo(() => { /* group filteredMenu by category */ }, [filteredMenu]);
```

Insert the category-filter step in between:

```tsx
const filteredMenu = useMemo(
  () => filterMenuByQuery(menu, searchQuery),
  [menu, searchQuery],
);

// PR-NEXT-ENH-3 — category filter composes AFTER the search filter
// so the chip count (and the resulting sections list) reflects what
// the customer would actually see post-search.
const categoryFilteredMenu = useMemo(
  () => filterMenuByCategory(filteredMenu, selectedCategory),
  [filteredMenu, selectedCategory],
);

const sections = useMemo(() => {
  const groups: Record<string, MenuItem[]> = {};
  categoryFilteredMenu.forEach(m => {
    (groups[m.category] ??= []).push(m);
  });
  return CATEGORIES.filter(c => groups[c.id]?.length).map(c => ({
    title: c.label,
    data: groups[c.id]!.slice().sort((a, b) => a.name.localeCompare(b.name)),
  }));
}, [categoryFilteredMenu]);
```

The `sections` useMemo dependency flips from `[filteredMenu]` to `[categoryFilteredMenu]`. Everything else in the section-grouping logic stays unchanged.

#### §C.3 — Render the chip row in the `ListHeaderComponent`

Insert directly BELOW the existing `<MenuSearchBar ...>` block (currently around line 266–285) and ABOVE the `</View>` that closes the header block. So the visual order top-to-bottom on the screen is:

1. Shop hero / meta (image + name + rating + meta line)
2. MenuSearchBar (PR-NEXT-9)
3. **NEW:** category chip row
4. SectionList items

```tsx
{/* PR-NEXT-ENH-3 (finding #6 follow-up) — category quick-pick chip
    row. Single-select: tap a chip to filter; tap the same chip
    again to clear. Composes WITH the search query above (search
    filter applies first, then category filter — the chip's
    selection reflects what the customer would see after their
    search). Horizontal scroll on phones with <10 categories on
    screen; matches the HomeScreen chip pattern at lines 345–362. */}
<ScrollView
  horizontal
  showsHorizontalScrollIndicator={false}
  keyboardShouldPersistTaps="handled"
  contentContainerStyle={styles.categoryChipRow}
>
  {CATEGORIES.map(cat => {
    const active = selectedCategory === cat.id;
    return (
      <Pressable
        key={cat.id}
        onPress={() =>
          setSelectedCategory(active ? null : cat.id)
        }
        style={({ pressed }) => [
          styles.categoryChip,
          active && styles.categoryChipActive,
          pressed && { opacity: 0.8 },
        ]}
        accessibilityRole="button"
        accessibilityLabel={
          active
            ? `Clear ${cat.label} filter`
            : `Filter to ${cat.label}`
        }
        accessibilityState={{ selected: active }}
      >
        <Text
          style={[
            styles.categoryChipText,
            active && styles.categoryChipTextActive,
          ]}
          numberOfLines={1}
        >
          {cat.label}
        </Text>
      </Pressable>
    );
  })}
</ScrollView>
```

Styles to add to the existing StyleSheet:

```ts
categoryChipRow: {
  paddingHorizontal: spacing.lg,
  paddingBottom: spacing.sm,
  gap: spacing.xs,
},
categoryChip: {
  paddingHorizontal: spacing.md,
  paddingVertical: spacing.xs,
  borderRadius: radii.pill,
  borderWidth: 1,
  borderColor: colors.border,
  backgroundColor: colors.surface,
},
categoryChipActive: {
  backgroundColor: colors.primaryLight,
  borderColor: colors.primary,
},
categoryChipText: {
  ...typography.caption,
  color: colors.textSecondary,
  fontWeight: '600',
},
categoryChipTextActive: {
  color: colors.primaryDark,
},
```

**`keyboardShouldPersistTaps="handled"`** is essential — same reason as PR-NEXT-9's recent-search chip row: without it, a chip tap while the search input is focused fires the input's blur first and the chip tap never lands.

#### §C.4 — Update `ListEmptyComponent` to distinguish three empty cases

Current empty-state logic (around lines 293–315) handles two cases:
- Query active + zero results
- No query, no items in menu

After this PR we need three:
- Query active + zero results → "No items match …" (existing PR-NEXT-9 copy)
- No query + category selected + zero results → "No <category> items in this shop" (new)
- Query active + category selected + zero results → "No <category> items match …" (new merged case)
- Neither → "No items right now" (existing fallback)

```tsx
ListEmptyComponent={
  searchQuery.trim() && selectedCategory ? (
    <View style={styles.noResults}>
      <Text style={styles.noResultsTitle}>
        No items in {labelForCategory(selectedCategory)} match
        "{searchQuery.trim()}"
      </Text>
      <Text style={styles.noResultsSub}>
        Try clearing the search or picking a different category.
      </Text>
    </View>
  ) : searchQuery.trim() ? (
    <View style={styles.noResults}>
      <Text style={styles.noResultsTitle}>
        No items match "{searchQuery.trim()}"
      </Text>
      <Text style={styles.noResultsSub}>
        Try a shorter or different word, or clear the search.
      </Text>
    </View>
  ) : selectedCategory ? (
    <View style={styles.noResults}>
      <Text style={styles.noResultsTitle}>
        No {labelForCategory(selectedCategory)} items in this shop
      </Text>
      <Text style={styles.noResultsSub}>
        Try picking a different category or clearing the filter.
      </Text>
    </View>
  ) : (
    <View style={{ paddingTop: spacing.xl }}>
      <EmptyState
        title="No items right now"
        subtitle="This shop hasn't added anything to its menu yet. Check back soon."
      />
    </View>
  )
}
```

Add a small helper (can live inline in the file or extract):

```tsx
function labelForCategory(id: CategoryId): string {
  return CATEGORIES.find(c => c.id === id)?.label ?? id;
}
```

---

## Discipline checklist

1. **Rule 1 — Imports stay.** New `filterMenuByCategory` and `CategoryId` imports both carry "DO NOT REMOVE" comments.
2. **Rule 2 — Hooks above conditionals.** New `useState` for `selectedCategory` sits with the other useStates at lines 64–69, all above the existing early returns at lines 153–174.
3. **No schema, no callable.** Pure client UI.
4. **Composition order with search.** Search filter applies FIRST, then category filter — same order PR-NEXT-9's shop side (search then status filter) established. Comments document the order in §C.2.
5. **Test discipline.** §B adds 6 helper tests.
6. **OTA classification.** Pure JS. No `app.json`, no permission, no plugin. OTA-safe.

---

## Acceptance checklist

Need one customer account + a shop with items across at least 3 categories (or use the pilot shop's actual menu if diverse enough).

**Category filter alone:**

1. Open the shop's ShopDetailScreen. Chip row visible below the search bar with all 10 categories from `CATEGORIES`. Horizontal scroll works.
2. Tap "Bakery" chip. Chip turns active (primary-color background, dark-text). The menu list filters to only Bakery items, grouped under the Bakery section.
3. Tap "Bakery" chip again. Chip turns inactive. Menu returns to all categories.
4. Tap "Dairy & Eggs." Chip turns active; the menu now shows only dairy items. Previous "Bakery" chip is NOT active (single-select semantics — tapping a different chip swaps the filter, doesn't add).

**Composes with search:**

5. With "Dairy & Eggs" still active, type "milk" in the search bar. List shows only dairy items whose name contains "milk."
6. Clear the search. List shows all dairy items again. Category filter persists.
7. Tap the active "Dairy & Eggs" chip to clear. Type "milk" in search. List shows all items containing "milk" across all categories.

**Empty states:**

8. Tap a category that has zero items in this shop (or use a small test shop). Empty state reads `"No <Category> items in this shop"` + the subtitle prompt to clear.
9. With a category active, type a search that has zero matches in that category. Empty state reads `"No items in <Category> match \"<query>\""` + the subtitle.
10. With no category and no search, but the shop is empty (test by clearing menu via shop owner side), the existing `"No items right now"` EmptyState renders.

**Keyboard interaction:**

11. Focus the search input (keyboard up). Tap a category chip. Chip activates without dismissing the keyboard (`keyboardShouldPersistTaps="handled"`).
12. Tap the search input again, type, then tap a chip. Chip activation persists; search state persists.

**Scroll + sticky section header:**

13. With a category filter active that produces multiple sub-categories of items (unlikely since chip = category, but if multiple sections render due to some edge case), the existing `stickySectionHeadersEnabled` still works.

**Regression:**

14. PR-NEXT-9's recent-query chips on the search bar still appear when search is focused + empty. They sit visually distinct from the new category chip row (different bar, different colors, different position).
15. Cart-bar flow still works — adding a filtered item to the cart goes through the existing `onAdd` path; the floating cart bar at the bottom renders with the safe-area inset.
16. `npx tsc --noEmit` clean
17. `npm run test:unit` clean; suite count +6 (the new helper tests)

---

## Out of scope (explicit deferrals)

- **Multi-select categories.** Single-select is the simpler v1 contract. If pilot feedback wants multi-select ("show me dairy + bakery"), reach for a `Set<CategoryId>` in state and adjust the filter — small follow-up.
- **Item counts per category chip** (e.g. "Bakery (3)"). Adds visual clutter; the empty-state messaging handles the zero case already.
- **Shopkeeper-side category chips on `ShopMenuScreen`.** Different screen, different intent (management vs. discovery). PR-NEXT-9 already added the per-status filter chips there; layering categories on top is a separate enhancement if shopkeepers ask.
- **Persisting the selected category across screen mounts.** Today the chip resets when the customer leaves and returns to the shop. AsyncStorage persistence (like PR-NEXT-9's search history) would be over-engineering for a discovery affordance.
- **Hierarchical categories / sub-categories.** Out of scope; the existing 10-category model is the source of truth.

---

## Deploy plan

Pure client OTA:

```
npx tsc --noEmit            # clean
npm run test:unit           # all green; suite count +6
git commit -m "PR-NEXT-ENH-3: category chips on customer ShopDetailScreen (finding #6 follow-up)"
eas update --branch production --message "PR-NEXT-ENH-3 category chips on ShopDetail"
```

Pull on customer device → run the 17-step acceptance checklist.

---

## Doc trail updates after ship

- `docs/TESTING-FINDINGS-2026-05-30.md` — under finding #6, add a sub-note: `Category quick-pick chips on customer ShopDetailScreen → ✅ SHIPPED in PR-NEXT-ENH-3 (June 1 2026)`.
- `docs/SESSION_LOG.md` — one-paragraph entry covering the pure-helper extraction, the filter composition order (search → category), the four-branch empty-state UX.
- `CLAUDE.md` — bump date.
- `PRELAUNCH_CHECKLIST.md` — short note under the PR-NEXT-9 block.
