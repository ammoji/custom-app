# PR-NEXT-9 — In-shop menu search bar + per-role recent-query history

**Source:** Finding **#6** in `docs/TESTING-FINDINGS-2026-05-30.md`.

**Naming note:** This PR closes finding **#6** but it is the **9th** PR in the PR-NEXT-N series. PR numbering is sequential by drafting order, not by finding number. Do not conflate.

**Deploy class:** **pure client OTA.** No callable, no Firestore rule, no Storage rule, no `app.json`, no permission, no plugin, no `runtimeVersion`. Ships via `eas update --branch production` alone.

**Read first**

1. `CLAUDE.md` (full)
2. `docs/TESTING-FINDINGS-2026-05-30.md` — finding #6
3. `.windsurf/code-discipline.md` (full — especially Rules 1, 2, 4, 8)
4. `.windsurf/test-discipline.md`
5. `src/screens/ShopDetailScreen.tsx` (customer surface — `sections` useMemo at line 112; insertion point for filter)
6. `src/screens/shop/ShopMenuScreen.tsx` (shopkeeper surface — `visibleItems` useMemo at line 118, `rows` useMemo at 134; insertion point for filter)
7. `src/store/useCartStore.ts` lines 1–20 — existing `@react-native-async-storage/async-storage` import + use pattern (you'll mirror it)
8. `src/services/firebase.ts` (other AsyncStorage caller — reference for shape of import + simple `setItem`/`getItem` calls)

---

## Why this PR exists

Customers entering a shop with even 50+ items scroll endlessly to find "atta" or "milk." Shopkeepers managing their menu scroll the same list to find an item they want to mark unavailable or re-price. Today's only navigation is category collapse + scroll.

Finding #6's severity is **Medium today** at pilot scale (1 shop, sensible menu size) but **High** as menus grow toward 1000 items. Sudhir picked this PR over the operator-hygiene bundle because it's the most user-visible remaining feature and Android testers will hit the absence the moment menus grow past one screen.

### Scope decisions locked upfront

- **Two surfaces, not three.** Finding #6 mentions "the admin shop view" as a third surface but `src/screens/admin/ShopDetailManagementScreen.tsx` does NOT show menu items — it shows shop metadata + KYC. There is no admin-side menu list to search today. Defer admin coverage to a future PR (or when admins ask for it). v1 covers customer (`ShopDetailScreen`) + shopkeeper (`ShopMenuScreen`).
- **Match field: item NAME only.** Substring match on `item.name`, case-insensitive. Not `packLabel`, not `category`, not `description`. Single source of truth keeps the mental model tight; if pilot feedback wants pack-label search, add later behind a flag.
- **Client-side filter, no callable.** Menu lists today are read in full via `listShopMenuPublic` / `listMyShopMenu`. We already have every item in memory. Filtering on the client is sub-millisecond at any plausible pilot scale (<1000 items). When/if a shop's menu reaches 1000+ items, a server-side `searchShopMenu` callable can replace the client filter without changing the UI surface — the helper boundary makes that swap trivial. Don't pre-optimise.
- **History scope: per `(role, shopId)`.** A customer's history at Shop A is irrelevant at Shop B; a shopkeeper's history is implicitly per-shop because they only manage one. Single `(role, shopId)` namespace works for both.
- **History cap: 5 entries.** Matches finding #6's spec. More clutters the chip row.
- **Dedup-then-move-to-front semantics on history write.** Re-searching an existing term promotes it to position 0 rather than adding a second copy.
- **History write fires on blur OR `onSubmitEditing` (first wins).** Typing then tapping a menu item dismisses the keyboard, which fires blur. Captures the realistic flow without aggressive debounce timers.
- **No analytics event for v1.** This is a UX feature; data on search query distributions can wait for post-pilot. Don't ship the analytics overhead now.

---

## Plan

### §A — Pure helpers `src/utils/menuSearchHelpers.ts` (new)

Three small pure helpers, ts-jest-pinnable without rendering anything.

```ts
/**
 * PR-NEXT-9 (finding #6) — pure helpers for in-shop menu search +
 * recent-query history. Lives outside the screen components so the
 * substring-match, normalise, and history-update contracts can be
 * unit-tested without booting React or AsyncStorage.
 *
 * Mirrors the validator-Result + pure-state-machine pattern from
 * `pollFailureGate` (PR-NEXT-5), `reorderModalDismissals` (PR-NEXT-8),
 * and the COD-payment helpers (PR-NEXT-3).
 */

/**
 * Normalise a raw text-input query for both filtering AND history
 * storage. Trim ends, collapse internal whitespace to single spaces,
 * lowercase. Returns '' for the empty case so callers can branch
 * cleanly on truthiness.
 *
 * Why collapse whitespace before storage: `"atta "` and `"atta"` and
 * `"  atta"` are the same intent; storing them as distinct history
 * entries clutters the chips.
 *
 * Hindi / Devanagari note: `toLowerCase()` is a no-op for Devanagari
 * codepoints (no upper/lower case in the script), so this normaliser
 * works for mixed-script names without special handling.
 */
export function normalizeSearchQuery(raw: string | null | undefined): string {
  if (typeof raw !== 'string') return '';
  return raw.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Case-insensitive substring filter on item `name`. Returns the
 * input array verbatim (same reference, not a copy) when the query
 * normalises to empty — saves a useless re-render at the screen
 * level and signals "no filter applied" to the caller.
 *
 * Defensive: items with non-string names are dropped silently.
 * Should never happen in practice (MenuItem.name is required), but
 * the cost of the typeof check is one comparison per item and the
 * upside is a malformed doc can't crash the menu screen.
 */
export function filterMenuByQuery<T extends { name: string }>(
  items: T[],
  rawQuery: string | null | undefined,
): T[] {
  const q = normalizeSearchQuery(rawQuery);
  if (!q) return items;
  return items.filter(
    i => typeof i.name === 'string' && i.name.toLowerCase().includes(q),
  );
}

/**
 * Dedup-then-move-to-front history update. `max` caps the result.
 *
 *  - Empty / whitespace-only query → return input unchanged (don't
 *    pollute history with empty submits).
 *  - Query already present at any index → move to position 0,
 *    preserve the rest in original order, drop the old slot.
 *  - Query not present → unshift, then truncate to max.
 *  - Returns the same array reference iff nothing changed (saves a
 *    useless AsyncStorage write at the call site).
 */
export const DEFAULT_HISTORY_MAX = 5;

export function pushToSearchHistory(
  history: readonly string[],
  rawQuery: string | null | undefined,
  max: number = DEFAULT_HISTORY_MAX,
): string[] {
  const q = normalizeSearchQuery(rawQuery);
  if (!q) return history as string[];
  if (history.length > 0 && history[0] === q) {
    // Idempotent: re-saving the most-recent query is a no-op. Keeps
    // `onBlur` + `onSubmitEditing` firing back-to-back from doubling
    // up.
    return history as string[];
  }
  const next = [q, ...history.filter(h => h !== q)];
  if (next.length > max) next.length = max;
  return next;
}
```

#### §A tests `tests/utils/menuSearchHelpers.test.ts` (new)

Pin every branch — target ~20 cases. Highlights:

- **`normalizeSearchQuery`:** empty / null / undefined / non-string → ''. Leading + trailing whitespace trimmed. Internal whitespace collapsed (`"a  b   c"` → `"a b c"`). Uppercase → lowercase. Devanagari unchanged. Mixed `"Atta WHEAT आटा"` → `"atta wheat आटा"`.
- **`filterMenuByQuery`:** empty query → returns input array by REFERENCE (use `toBe`, not `toEqual`). Case-insensitive substring (`"AT"` matches `"Atta whole wheat"`). Multiple matches preserved in input order. No matches → empty array. Non-string name dropped silently without crashing. Devanagari substring works.
- **`pushToSearchHistory`:** empty query → input unchanged by REFERENCE. Same query already at index 0 → input unchanged by REFERENCE. New query → unshift. Duplicate from middle → moves to front, original slot removed. Over-capacity → truncated to `max`. Custom `max` honoured. Pre-normalised match (e.g. history has `"atta"`, save `"  ATTA  "`) dedups correctly.

---

### §B — AsyncStorage wrapper `src/services/menuSearchHistory.ts` (new)

Thin async I/O around AsyncStorage. Not pure (touches storage), but tiny enough that the pure helper above carries the real correctness load. Mirror the import shape from `src/store/useCartStore.ts:1`.

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * PR-NEXT-9 (finding #6) — AsyncStorage I/O for the recent-query
 * chip row that appears below the in-shop search bar.
 *
 * Keyspace: `search-history:menu:{role}:{shopId}` — explicit
 * `search-history:menu:` prefix so future search surfaces (e.g.
 * cross-shop search history, support ticket history) don't collide.
 * `role` ∈ `'customer' | 'shopkeeper'`. The two surfaces (customer
 * ShopDetailScreen + shopkeeper ShopMenuScreen) maintain independent
 * histories per shopId so a customer's "atta" search at Shop A
 * doesn't appear on the shopkeeper's chip row at Shop A — different
 * intents.
 *
 * All methods are best-effort: AsyncStorage failures return [] /
 * silently no-op. The chip row is a nicety, not a critical path; we
 * NEVER want a storage failure to break the search input itself.
 */

const MAX_ENTRIES = 5;

export type MenuSearchRole = 'customer' | 'shopkeeper';

function storageKey(role: MenuSearchRole, shopId: string): string {
  return `search-history:menu:${role}:${shopId}`;
}

export async function loadMenuSearchHistory(
  role: MenuSearchRole,
  shopId: string,
): Promise<string[]> {
  if (!shopId) return [];
  try {
    const raw = await AsyncStorage.getItem(storageKey(role, shopId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Defensive: cap on read in case a future version increased the
    // cap and then rolled back. Drop non-strings silently.
    return parsed
      .filter((s): s is string => typeof s === 'string')
      .slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

export async function saveMenuSearchHistory(
  role: MenuSearchRole,
  shopId: string,
  history: string[],
): Promise<void> {
  if (!shopId) return;
  try {
    await AsyncStorage.setItem(
      storageKey(role, shopId),
      JSON.stringify(history.slice(0, MAX_ENTRIES)),
    );
  } catch {
    // Best-effort. UI keeps the in-memory history regardless.
  }
}

export async function clearMenuSearchHistory(
  role: MenuSearchRole,
  shopId: string,
): Promise<void> {
  if (!shopId) return;
  try {
    await AsyncStorage.removeItem(storageKey(role, shopId));
  } catch {
    /* best-effort */
  }
}
```

No unit tests for this module — it's pure AsyncStorage I/O with a `try/catch` swallow. The pure helper in §A is what carries the testable logic. (If you feel strongly about coverage, a single round-trip integration test against the in-memory AsyncStorage mock in `jest.setup.ts` is fine — keep it to one happy-path test, don't reproduce the §A matrix.)

---

### §C — Reusable component `src/components/menu/MenuSearchBar.tsx` (new)

Uncontrolled wrapper around `TextInput` + recent-query chips. Caller owns the query state; the bar surfaces `onChangeText`, `onSubmit`, and the chip-tap callback. Keeps the component dumb and the screens in charge of what to do with the query.

```tsx
/**
 * PR-NEXT-9 (finding #6) — search input for the in-shop menu list.
 *
 * Uncontrolled by design: parent owns the `value` + drives
 * `onChangeText`. We expose `recents` as a chip row that renders
 * only while the input is focused AND the value is empty — once the
 * user starts typing, the chips collapse to give the filtered list
 * room. Chips tap → `onRecentTap` (parent typically calls
 * `onChangeText(picked)` + dismisses keyboard + writes history).
 *
 * No debouncing. The client-side filter in §D is sub-millisecond at
 * pilot scale; debouncing would add latency without saving anything.
 * History writes happen on blur / onSubmitEditing in the parent.
 */
import React from 'react';
import {
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { colors, radii, spacing, typography } from '../../constants/theme';

type Props = {
  value: string;
  onChangeText: (next: string) => void;
  onSubmit?: () => void;
  onBlur?: () => void;
  placeholder?: string;
  /** Most-recent queries, position 0 = most recent. Capped upstream. */
  recents: string[];
  onRecentTap?: (query: string) => void;
};

export default function MenuSearchBar({
  value,
  onChangeText,
  onSubmit,
  onBlur,
  placeholder = 'Search this menu',
  recents,
  onRecentTap,
}: Props) {
  const [focused, setFocused] = React.useState(false);
  const showChips = focused && value.length === 0 && recents.length > 0;

  return (
    <View style={styles.container}>
      <View style={styles.inputRow}>
        <Text style={styles.icon}>🔍</Text>
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={onChangeText}
          onSubmitEditing={() => {
            Keyboard.dismiss();
            onSubmit?.();
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            onBlur?.();
          }}
          placeholder={placeholder}
          placeholderTextColor={colors.textSecondary}
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Search this shop's menu"
        />
        {value.length > 0 && (
          <Pressable
            onPress={() => onChangeText('')}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
          >
            <Text style={styles.clear}>✕</Text>
          </Pressable>
        )}
      </View>
      {showChips && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.chipRow}
        >
          {recents.map(q => (
            <Pressable
              key={q}
              onPress={() => {
                onRecentTap?.(q);
              }}
              style={({ pressed }) => [
                styles.chip,
                pressed && { opacity: 0.7 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={`Search again for ${q}`}
            >
              <Text style={styles.chipText} numberOfLines={1}>{q}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
    backgroundColor: colors.bg,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  icon: { fontSize: 14 },
  input: { ...typography.body, color: colors.textPrimary, flex: 1, padding: 0 },
  clear: { ...typography.body, color: colors.textSecondary, paddingHorizontal: spacing.xs },
  chipRow: { gap: spacing.xs, paddingTop: spacing.sm },
  chip: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    maxWidth: 200,
  },
  chipText: { ...typography.caption, color: colors.textPrimary },
});
```

**`keyboardShouldPersistTaps="handled"`** on the chip ScrollView is essential — without it, a chip tap fires the input's blur first and the tap never lands.

---

### §D — Customer wiring `src/screens/ShopDetailScreen.tsx`

Insert state + hook + filter step + bar render. All NEW hooks sit above the existing early-return guards (lines 153–174) — code-discipline Rule 2.

**State (add near the existing `useState` block, ~line 54–57):**

```tsx
// PR-NEXT-9 (finding #6) — in-shop menu search.
const [searchQuery, setSearchQuery] = useState('');
const [searchHistory, setSearchHistory] = useState<string[]>([]);
```

**Hydrate history on mount + shopId change (add as a new useEffect):**

```tsx
useEffect(() => {
  if (!shopId) return;
  loadMenuSearchHistory('customer', shopId).then(setSearchHistory);
}, [shopId]);
```

**Filter the menu BEFORE the sections useMemo (replace the current `sections` block at line 112):**

```tsx
const filteredMenu = useMemo(
  () => filterMenuByQuery(menu, searchQuery),
  [menu, searchQuery],
);

const sections = useMemo(() => {
  const groups: Record<string, MenuItem[]> = {};
  filteredMenu.forEach(m => {
    (groups[m.category] ??= []).push(m);
  });
  return CATEGORIES.filter(c => groups[c.id]?.length).map(c => ({
    title: c.label,
    data: groups[c.id]!.slice().sort((a, b) => a.name.localeCompare(b.name)),
  }));
}, [filteredMenu]);
```

**History-write callback:**

```tsx
const persistHistory = useCallback(() => {
  if (!shopId || !searchQuery.trim()) return;
  setSearchHistory(prev => {
    const next = pushToSearchHistory(prev, searchQuery);
    if (next !== prev) {
      // Fire-and-forget; UI doesn't wait. Failure swallowed by the
      // wrapper (see menuSearchHistory.ts) so a storage hiccup never
      // breaks the search input.
      void saveMenuSearchHistory('customer', shopId, next);
    }
    return next;
  });
}, [shopId, searchQuery]);
```

**Bar placement in the JSX:**

The `MenuSearchBar` sits in the `SectionList`'s `ListHeaderComponent` — specifically AFTER the shop hero/meta block (after the `</View>` closing the `heroBody` block around line 240ish, BEFORE the category list begins). Sticky-header behavior is already on the section headers; the search bar deliberately is NOT sticky so it scrolls out of view when the customer scrolls deep (matches the search-then-browse mental model — once you've narrowed, you don't need the input on screen).

```tsx
<MenuSearchBar
  value={searchQuery}
  onChangeText={setSearchQuery}
  onSubmit={persistHistory}
  onBlur={persistHistory}
  recents={searchHistory}
  onRecentTap={q => {
    setSearchQuery(q);
    // Persist immediately — re-tapping promotes to front via the
    // dedup-then-move-to-front semantics in pushToSearchHistory.
    setSearchHistory(prev => {
      const next = pushToSearchHistory(prev, q);
      if (next !== prev && shopId) void saveMenuSearchHistory('customer', shopId, next);
      return next;
    });
  }}
/>
```

**Empty-results state:**

When `searchQuery` is non-empty and `sections.length === 0`, render an inline EmptyState below the bar (NOT the screen-level EmptyState — that's for the loaded-but-no-menu case). Wire via `ListEmptyComponent` on the SectionList; the existing SectionList may not have one — add it:

```tsx
ListEmptyComponent={
  searchQuery.trim() ? (
    <View style={styles.noResults}>
      <Text style={styles.noResultsTitle}>No items match "{searchQuery}"</Text>
      <Text style={styles.noResultsSub}>
        Try a shorter or different word, or clear the search.
      </Text>
    </View>
  ) : null
}
```

Don't preempt the normal empty-menu render path (`menu.length === 0` flows through whatever the screen does today; query-driven empty is a new branch).

---

### §E — Shopkeeper wiring `src/screens/shop/ShopMenuScreen.tsx`

Same pattern, but the screen already has a `visibleItems` useMemo (line 118) that filters by `available/unavailable/custom` status. Search filtering composes ON TOP — apply search first, then the status filter, then group into `rows`.

**State + history hydrate:**

```tsx
// PR-NEXT-9 (finding #6) — shopkeeper-side menu search.
const [searchQuery, setSearchQuery] = useState('');
const [searchHistory, setSearchHistory] = useState<string[]>([]);

useEffect(() => {
  if (!shopId) return;
  loadMenuSearchHistory('shopkeeper', shopId).then(setSearchHistory);
}, [shopId]);
```

**Insert the filter step. The existing `visibleItems` becomes downstream of search:**

```tsx
const queryFilteredItems = useMemo(
  () => filterMenuByQuery(items, searchQuery),
  [items, searchQuery],
);

const visibleItems = useMemo(() => {
  switch (filter) {
    case 'available':
      return queryFilteredItems.filter(i => i.available);
    case 'unavailable':
      return queryFilteredItems.filter(i => !i.available);
    case 'custom':
      return queryFilteredItems.filter(i => i.isCustom);
    default:
      return queryFilteredItems;
  }
}, [queryFilteredItems, filter]);
```

The `rows` useMemo at line 134 is unchanged — it consumes `visibleItems` and that variable just now reflects both filters.

**Persist + bar placement:**

Same `persistHistory` pattern as §D. The `MenuSearchBar` sits in the `FlatList`'s `ListHeaderComponent`, BELOW any existing status-filter chip row + ABOVE the items list. Order top-to-bottom: section-level intro/buttons → search bar → status filter chips → category-grouped items. (Verify the exact ordering against the actual current `ListHeaderComponent` content; the search bar comes ABOVE the status chips because narrowing by name is the dominant intent and status filtering is the modifier.)

**Empty-results state:**

When `searchQuery.trim()` is non-empty AND `rows.length === 0`, render the same shape of inline "No items match …" block via `ListEmptyComponent`.

---

### §F — Tests `tests/utils/menuSearchHelpers.test.ts` (new)

See §A for the contract under test. Target ~20 cases organised into three describe blocks (`normalizeSearchQuery`, `filterMenuByQuery`, `pushToSearchHistory`). Lean on `toBe` for reference-equality assertions (the empty-query return-by-reference and the same-front-element no-op return-by-reference cases are the meaningful pins).

No unit tests for `menuSearchHistory.ts` (per §B) — pure AsyncStorage I/O with `try/catch` swallow; correctness is structurally trivial.

No component test for `MenuSearchBar` — `@testing-library/react-native` isn't in the project (per `.windsurf/test-discipline.md`), and the bar is dumb glue around a `TextInput`. The §F helper pin + the §G acceptance checklist together cover the behaviour.

---

## Discipline checklist

1. **Rule 1 — Imports stay.** New imports (`MenuSearchBar`, `filterMenuByQuery`, `pushToSearchHistory`, `loadMenuSearchHistory`, `saveMenuSearchHistory`) must persist through the edit. Don't let the auto-formatter strip them between edits.
2. **Rule 2 — Hooks above conditionals.** `useState` + `useEffect` for search live above the existing `if (loading) return …` / `if (errorMsg || !shop) return …` early-returns in `ShopDetailScreen` and the analogous guards in `ShopMenuScreen`.
3. **Rule 4 — Schema additive only.** N/A. No Firestore field, no callable contract, no schema change.
4. **Rule 8 — Stable references in Zustand selectors.** N/A — no Zustand involvement.
5. **Test discipline.** §F adds tests; suite count should rise by ~20.
6. **OTA classification.** Pure JS. No `app.json` change, no permission, no plugin. OTA-safe.

---

## Acceptance checklist

Run on iOS first, then Android. Need a customer account + a shop owner account, plus a shop with at least ~8 menu items spanning at least 2 categories (use the pilot shop's actual menu if it has enough variety; otherwise add a few custom items first).

**Customer surface:**

1. Customer opens `ShopDetailScreen` for the test shop. New search bar visible at the top of the menu, below the shop hero/meta block.
2. Type `"at"` (or any partial match against a known item name). The list collapses to only items whose names contain `"at"` (case-insensitive). Categories with no matches disappear entirely.
3. Type a query with NO matches (`"zzz"`). Inline `"No items match \"zzz\""` block renders. The bar stays visible; the categories all collapse.
4. Tap the ✕ clear button. List restores to full menu.
5. Type `"atta"`, tap Search/Done on the keyboard. Bar blurs. Open the bar again (tap input). Type empty → recent-query chips appear with `atta` at position 0.
6. Search for `"milk"`. Search for `"atta"` again. Open the chip row → `atta` should be at position 0 (moved to front), `milk` at position 1.
7. Tap a recent-query chip. Input populates with that query and the list filters immediately.
8. Force-quit the app, reopen, return to the same shop. Recent-query chips are still there (AsyncStorage persistence).
9. Open a DIFFERENT shop. Recent-query chips for that shop are independent (empty if you've never searched there; per-shop scoping).

**Shopkeeper surface:**

10. Shop owner opens `ShopMenuScreen`. Search bar visible above the status-filter chips.
11. Search composes with status filter: set filter to `unavailable`, then type `"atta"`. Only unavailable items whose name contains `"atta"` show.
12. Clear search (✕). Status filter still applied; full unavailable list returns.
13. Shop owner's recent-query history is separate from the customer's history at the same shop (verify on whatever device by checking the chips — searching `"chai"` on shopkeeper side should NOT appear in customer-side chips on the same device, and vice versa).

**Cross-cutting:**

14. Keyboard dismisses cleanly on chip tap (per `keyboardShouldPersistTaps="handled"`).
15. Bar input handles `autoCapitalize="none"` + `autoCorrect={false}` — typing `"atta"` doesn't autocorrect to `"Atta"` or `"otto"`.
16. Search persists during scroll on the customer side (the bar scrolls out of view as the user scrolls into the filtered list — intentional, not a sticky header).
17. `npx tsc --noEmit` clean.
18. `npm run test:unit` clean; suite count up by §F additions (~20).

**Regression checks:**

19. With the search empty, the customer menu renders identically to pre-PR (full categories, sort order unchanged).
20. With the search empty, the shopkeeper menu's existing filter chips (`all / available / unavailable / custom`) still behave exactly as before.
21. The cart flow (add item → cart bar) is unaffected by an active search query — adding from the filtered set still routes through the existing `onAdd` / `addMenuItem` path.

---

## Out of scope (explicit deferrals)

- **Admin-side menu search.** No admin menu list exists today. Add when the admin surface itself ships.
- **Server-side `searchShopMenu` callable.** Client filter is fast at pilot scale; this is a future scale concern.
- **Cross-shop / global search** (e.g. "find any shop selling atta"). Different feature entirely; existing `searchMenuPublic` covers part of this.
- **Pack-label / description / category search.** Name-only for v1. If pilot feedback wants pack-label, add a single boolean to expand the match field.
- **Fuzzy / typo-tolerant matching.** Exact substring only. Hindi/English mixed names don't have a great Levenshtein-distance story without per-script tuning; punt.
- **Search-history clear button** (a "Clear recent" pill). Not in finding #6; can add to chip row v2 if requested.
- **Search analytics.** No `Analytics.searchSubmitted` events for v1.
- **Sticky search bar on scroll.** Bar scrolls out of view with the rest of the header. Stickying it would consume vertical space on every screen of scroll without a clear UX win.

---

## Deploy plan

Pure client OTA. No Firebase deploy needed.

```
npx tsc --noEmit            # clean
npm run test:unit           # all green; record suite count delta in commit
git commit -m "PR-NEXT-9: in-shop menu search + per-role recent-query history"
eas update --branch production --message "PR-NEXT-9 in-shop search + history"
```

Pull on installed iOS + Android devices; run the 21-step acceptance checklist on both.

---

## Doc trail updates after ship

- `docs/TESTING-FINDINGS-2026-05-30.md` — flip finding **#6** to `✅ SHIPPED in PR-NEXT-9 (May 31 2026)` with a one-paragraph summary covering the two surfaces (customer + shopkeeper), per-`(role, shopId)` history scope, client-side filter rationale, and the admin-surface deferral.
- `docs/SESSION_LOG.md` — append the standard one-paragraph entry covering the helper module + AsyncStorage wrapper + reusable bar + the two screen wirings + suite delta + OTA-only classification.
- `CLAUDE.md` — bump the "Current state" date and add PR-NEXT-9 as the final entry in the testing-findings cleanup wave.
- `PRELAUNCH_CHECKLIST.md` — add a section under the existing "Testing findings cleanup wave" block noting #6 closed.
