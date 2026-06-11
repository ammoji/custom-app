# PR-NEXT-BUNDLE-F — Home page redesign (compact bar + shop-first)

**Source:** Sudhir's 2026-06-10 findings #9 + #10. *"Right now All our cards on home page is really big. Your active orders and Order again card is covering 50% of the home page. We need to make it look more professional… also we have search option at top, then big cards and then card based filter again. I would like you to design it more professional way."*

**Design lens — customer's mental model on home open:** they came here to browse shops. Active order info is contextual (only matters if they have one); recent shops are a shortcut (handy but secondary); the dominant element should be the **nearby shops list** — the actual reason for the visit. Current layout buries shops below 50% of fluff.

**Picks locked via Rule 6 pre-design check:**
- Layout: **Compact bar + shop-first** (food-app convention, professional)
- Active order: 60px banner ONLY when present; hidden otherwise
- Recent shops: horizontal swipe strip (4 visible)
- Search + chips: present but compact
- Nearby shops: dominant — full viewport-height list

**Visual target locked 2026-06-10 via Cowork HTML preview** — see "Visual specification" section below for exact colors, spacing, and component treatments. Implementer should match this aesthetic in React Native, not interpret freely.

**Architecture clarification (2026-06-10):** This codebase splits Home (multi-role launcher) and `ShopListScreen` (customer shop browse). The redesign distributes:

- **HomeScreen** receives the lightweight pieces: `ActiveOrderBanner` (replaces the existing big active-order card), `RecentShopsStrip` (replaces the existing big "Order again" card), compact search style refresh. Existing role tiles + greeting stay. Net effect: Home gets visually tighter; the launcher model is preserved for admins, shop owners, delivery partners who also land here.
- **ShopListScreen** receives the dominant pieces: compact header + search + category chips (if not already present) + the existing shop list (now with the new sort dropdown at the section header). This is the surface where shops are already dominant; the redesign reinforces that role.

Do NOT move the full shop list onto HomeScreen — that would restructure customer navigation and break multi-role launcher semantics. The customer enters ShopListScreen via the existing "Browse shops" / shop-list entry point on Home.

**Deploy class:** pure client OTA. No server changes, no schema changes.

## Autonomous execution authorization

You may run the following without stopping to confirm — execute, report results in the final summary:

- All `Read`, `Grep`, `Glob`, `ls`, `git status`, `git diff` (read-only)
- `npx tsc --noEmit` (root and `functions/`)
- `npm test`, `npm run test:unit`, `npm run test:full`, `npx jest`
- `npm run lint`, `npx eslint`
- File edits to files explicitly named in §A–§E below
- New file creation in directories explicitly named in the plan
- Re-running any of the above to verify after fixing an error

You MUST stop and ask before:

- Deploy commands: `firebase deploy …`, `eas update`, `eas build`
- File deletes
- Force-push, rebase, branch ops
- Editing files NOT named in §A–§E
- Adding NEW dependencies not already in package.json
- Schema additions / migrations

Default posture: **execute, report at end.**

## Schema audit-grep (Rule 5)

```
grep -rn "ActiveOrder\|active_orders\|OrderAgain\|recent_shops" src/screens
grep -rn "useMyActiveOrders\|listMyOrders\|listFavoriteShops" src functions/src
grep -rn "categoryChips\|categories" src/screens/HomeScreen.tsx
```

| Symbol | Confirmed at | Notes |
| --- | --- | --- |
| `HomeScreen.tsx` greeting / active card / categories / shop list | `src/screens/HomeScreen.tsx` | Full redesign of layout sections, but data hooks unchanged |
| Active order watcher | grep `listMyOrders` or `useActiveOrders` | Existing hook; we just render its output differently |
| Recent shops source | profile.shopHistory or favorites | Existing data; just new compact card style |
| Category chips | already on HomeScreen | Stays but slimmer |

## Visual specification (target aesthetic)

The Cowork HTML preview (2026-06-10) established this visual direction. Sudhir confirmed. Match these values; do NOT improvise different colors, weights, or sizes.

### Color tokens (HamaraSetu brand green)

Add or confirm in `src/constants/theme.ts`:

```ts
// PR-NEXT-BUNDLE-F — brand accent for active states + banners.
// Light green fill + dark green text reads as food/freshness without
// being aggressive (vs orange/red which look like alerts).
export const brandGreen = {
  fillLight: '#EAF3DE',  // active-order banner bg, badge bg
  fillMedium: '#C0DD97', // icon-on-banner background
  textDark: '#173404',   // text on light green; primary brand text
  textMedium: '#3B6D11', // secondary text on light green
};

// PR-NEXT-BUNDLE-F — star rating color. Amber, not yellow.
// Yellow on white looks washed out; amber holds its weight in both
// light + dark modes.
export const ratingAmber = '#BA7517';
```

If `theme.ts` already defines `colors.primary` / `colors.primaryLight` close to these greens, reuse those tokens instead of duplicating. Audit-grep first.

### Component visual treatment

**Active-order banner**
- Height: 60px
- Background: `brandGreen.fillLight` (`#EAF3DE`)
- Inner circle icon: 32px circle, `brandGreen.fillMedium` bg, dark green icon
- Title text: 13px, weight 500, color `brandGreen.textDark`
- Subtitle text: 12px, weight 400, color `brandGreen.textMedium`
- Right chevron: 18px, color `brandGreen.textDark`
- Border radius: `radii.md` (8px)
- Margin: `spacing.sm` horizontal, no top/bottom margin (header above + search below provide spacing)

**Search bar**
- Height: 40px
- Background: `colors.surfaceTertiary` (or whatever the existing muted-surface is — NOT branded blue)
- Search icon: 16px, `colors.textSecondary`
- Placeholder text: 13px, `colors.textTertiary`
- Border radius: `radii.md` (8px)
- No border, no shadow

**Recent shops mini card**
- Width: 90px (fixed); height: ~110px (content-driven)
- Background: white
- Border: 0.5px `colors.border` (tertiary border, very subtle)
- Border radius: `radii.md` (8px)
- Internal padding: 8px
- Icon slot: full-width × 40px, neutral surface bg, store icon centered
- Name: 11px, weight 500, single line, ellipsize
- Distance: 10px, `colors.textSecondary`
- Gap between cards: 8px

**Category chips**
- Active chip: bg `brandGreen.textDark` (`#173404`), text white, weight 500
- Inactive chip: bg `colors.surfaceTertiary`, text `colors.textPrimary`, weight 400
- Padding: 6px vertical, 12px horizontal
- Border radius: 999px (full pill)
- Font size: 12px
- Gap: 6px between chips

**Shop card (nearby shops list)**
- Background: white
- Border: 0.5px `colors.border`
- Border radius: `radii.md` (8px)
- Padding: 12px
- Margin bottom: 8px (between cards)
- Thumbnail: 48px × 48px, neutral surface bg, rounded `radii.md`, store icon centered
- Gap thumbnail → text: 10px
- Shop name: 14px, weight 500
- Star icon: 12px, color `ratingAmber`
- Rating number: 12px, weight 400, `colors.textPrimary`
- Review count: 12px, weight 400, `colors.textSecondary`, prefixed with `·`
- Meta line: 12px, `colors.textSecondary`, format `1.2 km · 30 min · ₹25`
- Empty-rating treatment for new shops: replace rating row with `New shop · be the first to rate` in `colors.textSecondary`

**Section headers**
- "Recent shops" / "Nearby shops" labels: 14px, weight 500
- Sort dropdown at right: text 12px, `colors.textSecondary`, chevron-down 14px
- Padding: 16px horizontal

**Typography rules**
- Sentence case everywhere — no ALL CAPS, no Title Case
- Two weights only: 400 (body) and 500 (headings + bold elements)
- No 600 or 700 weights anywhere

**Border + shadow rules**
- All borders 0.5px (use `StyleSheet.hairlineWidth` if 0.5 won't render in RN; check first)
- No drop shadows on cards
- No elevation > 0
- The visual hierarchy comes from spacing and color contrast, NOT depth

### Reference mockup

Sudhir saw both states (with active order + without) rendered as an HTML preview in Cowork on 2026-06-10. The implementer should replicate the layout, color, spacing, and component treatment exactly. If any ambiguity arises (e.g. "where does this padding go"), default to MORE whitespace, not less. The goal is a calm, professional feel — empty space is part of the design.

## Design mockups (Rule 6)

### State A — Customer with NO active order, NO recent shops

```
┌─────────────────────────────────────┐
│ Hello, Sudhir 👋                    │ ← compact greeting (existing)
│ 📍 Ballwin                           │ ← location label
├─────────────────────────────────────┤
│ 🔍 Search products                  │ ← compact search bar
├─────────────────────────────────────┤
│ [All] [Atta] [Dal] [Rice] [Oil] ›   │ ← compact chip row
├─────────────────────────────────────┤
│                                     │
│ Nearby shops                        │
│ ┌─────────────────────────────────┐ │
│ │ 🏪  US Shoppers                 │ │
│ │     1.2 km · 30 min · ₹25       │ │
│ │     ⭐ 4.7 · 142 reviews         │ │
│ └─────────────────────────────────┘ │
│ ┌─────────────────────────────────┐ │
│ │ 🏪  Merugu Store                │ │
│ │     2.5 km · 25 min · ₹40       │ │
│ │     ⭐ 4.5 · 87 reviews          │ │
│ └─────────────────────────────────┘ │
│ ┌─────────────────────────────────┐ │
│ │ 🏪  Sharma Kirana               │ │
│ │     3.8 km · 35 min · ₹60       │ │
│ │     ⭐ New shop                  │ │
│ └─────────────────────────────────┘ │
│ ... (paginated, scroll for more)    │
└─────────────────────────────────────┘
```

### State B — Customer with active order + recent shops

```
┌─────────────────────────────────────┐
│ Hello, Sudhir 👋                    │
│ 📍 Ballwin                           │
├─────────────────────────────────────┤
│ 📦 Order on the way • ETA 8 min  ›  │ ← active-order banner (60px, full width, tap → OrderDetail)
├─────────────────────────────────────┤
│ 🔍 Search products                  │
├─────────────────────────────────────┤
│ Recent shops                        │
│ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ →  │ ← horizontal scroll
│ │US Sh│ │Merug│ │Sharm│ │+ more│   │
│ │1.2km│ │2.5km│ │3.8km│ │ ... │   │
│ └─────┘ └─────┘ └─────┘ └─────┘   │
├─────────────────────────────────────┤
│ [All] [Atta] [Dal] [Rice] [Oil] ›   │
├─────────────────────────────────────┤
│ Nearby shops                        │
│ ┌─────────────────────────────────┐ │
│ │ 🏪  US Shoppers                 │ │
│ │     1.2 km · 30 min · ₹25       │ │
│ └─────────────────────────────────┘ │
│ ... (list, scroll for more)         │
└─────────────────────────────────────┘
```

### State C — Customer with multiple active orders

Active-order banner becomes a stacked indicator:

```
│ 📦 2 orders on the way · tap to view ›
```

Tapping opens OrdersScreen (existing) instead of single OrderDetail.

## Plan

### §A — Compact greeting + location header

Already exists per HomeScreen `Hello, <name> 👋` greeting. Trim padding to minimum, ensure single line (not 2 lines of text + space). Move `locationLabel` (`📍 Ballwin`) directly under greeting on its own line; tap to open location picker (if not already wired).

### §B — Active order banner (replaces big card)

Match the visual specification above precisely. The banner is **60px high**, **light green** (`#EAF3DE`), with a **circle-icon** on the left, two-line text in the middle (`Out for delivery` / `Arriving in 8 min`), and chevron-right at the end.

`src/components/home/ActiveOrderBanner.tsx`:

```tsx
type Props = {
  orders: Order[]; // active order list from existing hook
  onPress: (orderId: string) => void;
};

export default function ActiveOrderBanner({ orders, onPress }: Props) {
  if (orders.length === 0) return null;
  if (orders.length === 1) {
    const o = orders[0]!;
    const label = statusToLabel(o.status); // "Order accepted", "Out for delivery", etc
    const etaText = computeEtaText(o); // "ETA 8 min" or "Arriving soon"
    return (
      <Pressable
        style={styles.banner}
        onPress={() => onPress(o.id)}
        accessibilityRole="button"
      >
        <Text style={styles.text}>📦 {label} · {etaText}</Text>
        <Text style={styles.chevron}>›</Text>
      </Pressable>
    );
  }
  // Multiple orders
  return (
    <Pressable style={styles.banner} onPress={() => nav.navigate('Orders')}>
      <Text style={styles.text}>📦 {orders.length} orders on the way · tap to view</Text>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    height: 60,
    backgroundColor: colors.primaryLight,
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  text: { ...typography.bodyBold, color: colors.primaryDark },
  chevron: { ...typography.h2, color: colors.primaryDark },
});
```

Pure helper `statusToLabel(status)` returns customer-friendly string per status. Pin with **+5 tests** (each customer-facing status string).

Render conditionally at the top of HomeScreen (hides entirely when no active orders).

### §C — Recent shops horizontal strip

`src/components/home/RecentShopsStrip.tsx`:

```tsx
<ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.strip}>
  {recentShops.slice(0, 6).map(shop => (
    <Pressable
      key={shop.id}
      style={styles.miniCard}
      onPress={() => nav.navigate('ShopDetail', { shopId: shop.id })}
    >
      <Text style={styles.miniName} numberOfLines={1}>{shop.name}</Text>
      <Text style={styles.miniMeta}>{shop.distanceKm?.toFixed(1) ?? '—'} km</Text>
    </Pressable>
  ))}
</ScrollView>
```

Mini cards 100x80 px each. 4 visible at a time on typical phone width. Hidden entirely when `recentShops.length === 0`.

Data source: `profile.shopHistory` (or whatever existing pattern surfaces "shops customer has ordered from"). If no such hook exists, grep `Order again` to find current data source and reuse.

### §D — Compact search + chips

Reduce search bar height from current `~56px` to `~44px`. Reduce padding around chip row. Chip row scrolls horizontally if more chips exist. Same data, less visual weight.

### §E — Dominant nearby shops list (on ShopListScreen, not HomeScreen)

**Surface: `src/screens/ShopListScreen.tsx`** (NOT HomeScreen — see Architecture clarification at top of prompt).

Existing shop list stays — but ensure it begins immediately after chips (no extra padding above). Use existing `ShopCard` rendering. List fills remaining viewport.

Default sort: nearest first (existing). Add a small sort indicator at section header:

```
│ Nearby shops                  Sort: Nearest ▾ │
```

Tap dropdown → Nearest / Best rated / Most reviewed. Pin sort helper with **+3 tests**.

### §F — HomeScreen + ShopListScreen layout assembly

**Two surfaces, split per the Architecture clarification at the top:**

**HomeScreen** body becomes (lightweight pieces only, keeps existing tiles):

```tsx
return (
  <SafeAreaView edges={['top']}>
    <View style={styles.header}>
      <Text style={styles.greeting}>Hello, {firstName} 👋</Text>
      <Pressable onPress={openLocationPicker}>
        <Text style={styles.location}>📍 {locationLabel}</Text>
      </Pressable>
    </View>

    <ActiveOrderBanner orders={activeOrders} onPress={openOrderDetail} />

    <View style={styles.searchWrap}>
      <SearchBar />
    </View>

    {recentShops.length > 0 && (
      <View style={styles.sectionPad}>
        <Text style={styles.sectionHeader}>Recent shops</Text>
        <RecentShopsStrip shops={recentShops} />
      </View>
    )}

    <View style={styles.chipsWrap}>
      <CategoryChips selected={category} onChange={setCategory} />
    </View>

    <View style={styles.shopListHeader}>
      <Text style={styles.sectionHeader}>Nearby shops</Text>
      <SortDropdown value={sort} onChange={setSort} />
    </View>

    {/* Existing role tiles (admin entry, profile, orders, etc.) stay below. */}
    <ExistingRoleTiles />
  </SafeAreaView>
);
```

The existing big "Active orders" card is REPLACED by the new `ActiveOrderBanner`. The existing "Order again" big card is REPLACED by the new `RecentShopsStrip`. Net: Home gets tighter, role tiles remain, multi-role users keep their launcher.

**ShopListScreen** body becomes (the dominant-list surface):

```tsx
return (
  <SafeAreaView edges={['top']}>
    <View style={styles.compactHeader}>
      <Text style={styles.greeting}>Hello, {firstName}</Text>
      <Pressable onPress={openLocationPicker}>
        <Text style={styles.location}>{locationLabel}</Text>
      </Pressable>
    </View>

    <View style={styles.searchWrap}>
      <SearchBar />
    </View>

    <View style={styles.chipsWrap}>
      <CategoryChips selected={category} onChange={setCategory} />
    </View>

    <View style={styles.shopListHeader}>
      <Text style={styles.sectionHeader}>Nearby shops</Text>
      <SortDropdown value={sort} onChange={setSort} />
    </View>

    <ShopList sort={sort} category={category} />
  </SafeAreaView>
);
```

ShopList is the only scrollable element — everything above stays fixed-height. Customer scrolls only the shop list, which is what they came here for.

---

## Discipline checklist

1. **Rule 1** — every new component import carries "PR-NEXT-BUNDLE-F — DO NOT REMOVE" comments.
2. **Rule 2** — useStates for `category`, `sort` sit with other hooks above conditional returns.
3. **Rule 5** — schema audit-grep table in header. No new doc fields; reuses existing.
4. **Rule 7** — N/A (no fixtures change).
5. **Rule 11** — N/A (no callable changes).
6. **Rule 13** — N/A (no new modals).
7. **Schema-additive** — none.
8. **Test discipline:** +5 (statusToLabel) + 3 (shop sort helper) = **+8 tests minimum.** Suite ~1460 → ~1468 (assuming Bundles D + E landed).

---

## Acceptance checklist

1. Customer opens app with NO active order → home shows greeting, search, chips, nearby shops list (dominant). No active-order banner, no recent-shops strip if empty.
2. Customer places an order → home now shows the 60px active-order banner above search ("📦 Order accepted · ETA 12 min ›"). Tap → opens OrderDetail.
3. Order progresses to "Out for delivery" → banner text updates to "📦 Out for delivery · ETA 5 min ›".
4. Customer places SECOND order → banner now reads "📦 2 orders on the way · tap to view ›". Tap → opens OrdersScreen (existing).
5. After at least one delivered order, recent-shops strip appears below banner with mini cards.
6. Sort dropdown on Nearby shops works: Nearest / Best rated / Most reviewed.
7. **Visual scrolling test**: with no active order + no recent shops, only the shop list scrolls. Header (greeting + search + chips) stays fixed.
8. **Visual scrolling test**: with active order + recent shops, only the shop list scrolls. Everything above is fixed.
9. **Regression — favorites tile**: if existing HomeScreen had a "Your favorites" tile (PR 19), it disappears in this redesign. Document explicitly in PR commit. (Customer accesses favorites via Profile / Orders → favorites for now; we can revisit if Sudhir wants it back as a 4-card strip alongside recent shops.)
10. `tsc --noEmit` clean. Tests +8.

## Out of scope

- **Animated transitions** between banner show/hide. Just conditional render.
- **Pull-to-refresh on shop list** (might already exist; if so, preserve).
- **Banner variants for shop owner / delivery partner home screens.** Those use their own role-specific home (Bundle D's DeliveryTabNavigator). This PR only touches the customer Home.
- **Web/responsive layout.** Pilot is mobile.

## Deploy

```
npx tsc --noEmit
npm run test:unit
eas update --branch production --message "PR-NEXT-BUNDLE-F home redesign: compact bar + shop-first"
```

## Doc trail (Cowork)

After ship: TESTING-FINDINGS — close #9, #10. CLAUDE.md In-flight strike. SESSION_LOG paragraph.
