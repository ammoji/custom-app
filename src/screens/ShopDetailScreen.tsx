import { useNavigation, useRoute } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Alert,
    Image,
    Pressable,
    ScrollView,
    SectionList,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Badge from '../components/common/Badge';
import EmptyState from '../components/common/EmptyState';
import FavoriteHeart from '../components/common/FavoriteHeart';
import Loader from '../components/common/Loader';
import Price from '../components/common/Price';
import QuantityStepper from '../components/common/QuantityStepper';
import ScreenHeader from '../components/common/ScreenHeader';
import MenuSearchBar from '../components/menu/MenuSearchBar';
import ShopRatingBadge from '../components/shop/ShopRatingBadge';
// PR-NEXT-ENH-3 (finding #6 follow-up) — DO NOT REMOVE. `CategoryId`
// types the new `selectedCategory` state powering the quick-pick
// chip row below the search bar.
import { CATEGORIES, CategoryId } from '../constants/categories';
import { colors, radii, spacing, typography } from '../constants/theme';
import { Analytics } from '../services/analytics';
import {
  loadMenuSearchHistory,
  saveMenuSearchHistory,
} from '../services/menuSearchHistory';
import { orderService } from '../services/orderService';
import { useCartStore } from '../store/useCartStore';
import { useLocationStore } from '../store/useLocationStore';
import { MenuItem, Shop } from '../types';
import { haversineKm } from '../utils/distance';
import { formatDistance, formatRupees } from '../utils/format';
import {
  filterMenuByQuery,
  pushToSearchHistory,
} from '../utils/menuSearchHelpers';
// PR-NEXT-ENH-3 — DO NOT REMOVE. Powers the category chip filter
// composed AFTER the existing search filter on this screen.
import { filterMenuByCategory } from '../utils/filterMenuByCategory';

/**
 * Phase 12a-v2-iii: customer-facing per-shop menu. Replaces the legacy
 * `productService.getByShop` flow which read the global products
 * collection at one shared price for all shops. Now we hit
 * `orderService.listShopMenuPublic(shopId)` which:
 *   - Returns the shop doc + its filtered menu in one round-trip.
 *   - Filters out unavailable / out-of-stock items server-side.
 *   - 404s for non-active shops (pending / suspended / rejected) so
 *     leaked shop URLs can't bypass the active-only guarantee.
 *
 * We still compute `distanceKm` client-side because the public
 * callable doesn't take a location and we don't want to leak per-user
 * geo into the shop response cache.
 */
export default function ShopDetailScreen() {
  const route = useRoute<any>();
  const nav = useNavigation<any>();
  // PR-NEXT-2 (finding #1) — Android safe-area inset for the
  // floating cart bar. See HomeScreen for the full root-cause
  // note.
  const insets = useSafeAreaInsets();
  const shopId: string = route.params.shopId;

  const [shop, setShop] = useState<Shop | null>(null);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // PR-NEXT-9 (finding #6) — in-shop menu search.
  const [searchQuery, setSearchQuery] = useState('');
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  // PR-NEXT-ENH-3 (finding #6 follow-up) — category quick-pick chips.
  // Single-select: tap a chip to filter; tap the same chip again to
  // clear. `null` = no category filter (all 10 sections render as
  // today). Composes WITH `searchQuery` (search applies first, then
  // category filter; see useMemo chain below).
  const [selectedCategory, setSelectedCategory] =
    useState<CategoryId | null>(null);

  const cartShopId = useCartStore(s => s.shopId);
  const cartShopName = useCartStore(s => s.shopName);
  const items = useCartStore(s => s.items);
  const addMenuItem = useCartStore(s => s.addMenuItem);
  const forceAddMenuItem = useCartStore(s => s.forceAddMenuItem);
  const increment = useCartStore(s => s.increment);
  const decrement = useCartStore(s => s.decrement);
  const itemCount = useCartStore(s => s.itemCount());
  const subtotal = useCartStore(s => s.subtotal());
  const location = useLocationStore(s => s.location);

  const cartHasThisShop = cartShopId === shopId;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErrorMsg(null);
      try {
        const { shop: rawShop, items: rawMenu } =
          await orderService.listShopMenuPublic(shopId);
        if (cancelled) return;
        // Compute distance client-side (the public callable doesn't
        // know the user's location).
        const distanceKm = location
          ? haversineKm(location, rawShop.location)
          : rawShop.distanceKm;
        const shopWithDistance = { ...rawShop, distanceKm } as Shop;
        setShop(shopWithDistance);
        setMenu(rawMenu);
        Analytics.view_shop_detail({
          shop_id: rawShop.id,
          shop_name: rawShop.name,
        });
      } catch (e: any) {
        if (cancelled) return;
        // listShopMenuPublic throws not-found for non-active shops; we
        // surface that as a generic "shop not found" so a leaked
        // pending-shop URL can't be used to confirm the shop's state.
        const msg =
          e?.code === 'functions/not-found' || e?.message?.includes('not found')
            ? 'Shop not found'
            : e?.message || 'Could not load shop';
        setErrorMsg(msg);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shopId, location]);

  // PR-NEXT-9 — hydrate per-(role, shopId) recent-query history
  // from AsyncStorage on mount + shopId change.
  useEffect(() => {
    if (!shopId) return;
    loadMenuSearchHistory('customer', shopId).then(setSearchHistory);
  }, [shopId]);

  // PR-NEXT-9 — substring filter on item name, applied BEFORE the
  // category grouping so empty categories disappear cleanly.
  const filteredMenu = useMemo(
    () => filterMenuByQuery(menu, searchQuery),
    [menu, searchQuery],
  );

  // PR-NEXT-ENH-3 (finding #6 follow-up) — category filter composes
  // AFTER the search filter so the resulting sections list reflects
  // what the customer would actually see post-search. When
  // `selectedCategory == null` the helper returns the input array by
  // reference, so the next useMemo doesn't churn for callers that
  // never touch a chip.
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
      // Sort within a category by name so the customer view is
      // stable even when shop owners add custom items mid-session.
      data: groups[c.id]!.slice().sort((a, b) => a.name.localeCompare(b.name)),
    }));
  }, [categoryFilteredMenu]);

  // PR-NEXT-9 — fire-and-forget history write on blur /
  // onSubmitEditing (first wins). Failures swallowed by the wrapper
  // so a storage hiccup never breaks the search input.
  const persistHistory = useCallback(() => {
    if (!shopId || !searchQuery.trim()) return;
    setSearchHistory(prev => {
      const next = pushToSearchHistory(prev, searchQuery);
      if (next !== prev) {
        void saveMenuSearchHistory('customer', shopId, next);
      }
      return next;
    });
  }, [shopId, searchQuery]);

  const onAdd = (item: MenuItem) => {
    if (!shop) return;
    const result = addMenuItem(item, shop);
    if (!result.ok && result.reason === 'different_shop') {
      Alert.alert(
        'Start a new cart?',
        `Your cart has items from ${cartShopName}. Clear it to add from ${shop.name}?`,
        [
          { text: 'Keep cart', style: 'cancel' },
          {
            text: 'Clear & add',
            style: 'destructive',
            onPress: () => forceAddMenuItem(item, shop),
          },
        ],
      );
    }
  };

  // Cart-line key matches the v2-iii convention in useCartStore:
  // GLOBAL items use `productId` (which equals the menuItemId by
  // bootstrap convention), CUSTOM items fall back to the menuItemId.
  const qtyInCart = (item: MenuItem) => {
    if (!cartHasThisShop) return 0;
    const key = item.productId ?? item.id;
    return items.find(i => i.productId === key)?.quantity ?? 0;
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="Loading..." onBack={() => nav.goBack()} />
        <Loader fullScreen />
      </SafeAreaView>
    );
  }
  if (errorMsg || !shop) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader
          title="Shop"
          onBack={() => nav.goBack()}
        />
        <EmptyState
          title={errorMsg ?? 'Shop not found'}
          subtitle="This shop is not currently available."
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title={shop.name} onBack={() => nav.goBack()} />
      <SectionList
        sections={sections}
        keyExtractor={m => m.id}
        stickySectionHeadersEnabled
        contentContainerStyle={{ paddingBottom: 120 + insets.bottom, flexGrow: 1 }}
        ListHeaderComponent={
          <View>
            <Image source={{ uri: shop.imageUrl }} style={styles.hero} />
            {/* hero/meta block first; search bar slots in BELOW the
                meta so the shop identity reads as the page-header
                anchor, search reads as a tool you reach for after
                you've landed. Bar is intentionally non-sticky:
                scrolls out of view with the rest of the header. */}
            <View style={styles.heroBody}>
              <View style={styles.titleRow}>
                <Text
                  style={[typography.h1, { flex: 1 }]}
                  numberOfLines={1}
                >
                  {shop.name}
                </Text>
                <Badge
                  label={shop.isOpen ? 'OPEN' : 'CLOSED'}
                  tone={shop.isOpen ? 'success' : 'danger'}
                />
              </View>
              <Text style={styles.address}>{shop.address}</Text>
              {/* PR 20 — prominent rolling-rating badge on the
                  shop's own page (size="md"). Sits above the
                  meta line so it reads as a primary trust signal
                  rather than mixed in with delivery / ETA / fee. */}
              <View style={styles.ratingRow}>
                <ShopRatingBadge
                  ratingAvg={shop.ratingAvg}
                  ratingCount={shop.ratingCount}
                  size="md"
                />
              </View>
              <Text style={styles.meta}>
                {formatDistance(shop.distanceKm)} · {shop.etaMinutes} min ·{' '}
                {formatRupees(shop.deliveryFee)} delivery · Min{' '}
                {formatRupees(shop.minOrder)}
              </Text>
            </View>
            {/* PR-NEXT-9 — in-shop search bar. Filters the menu by
                name, case-insensitive substring. Recent-query chips
                appear on focus while empty. */}
            <MenuSearchBar
              value={searchQuery}
              onChangeText={setSearchQuery}
              onSubmit={persistHistory}
              onBlur={persistHistory}
              recents={searchHistory}
              onRecentTap={q => {
                setSearchQuery(q);
                // Re-tapping a chip promotes it to position 0 via
                // the dedup-then-move-to-front semantics in
                // pushToSearchHistory.
                setSearchHistory(prev => {
                  const next = pushToSearchHistory(prev, q);
                  if (next !== prev && shopId) {
                    void saveMenuSearchHistory('customer', shopId, next);
                  }
                  return next;
                });
              }}
            />
            {/* PR-NEXT-ENH-3 (finding #6 follow-up) — category
                quick-pick chip row. Single-select: tap a chip to
                filter; tap the same chip again to clear. Composes
                WITH the search query above (search applies first,
                then category filter — the chip's effective result
                set reflects what the customer would see after
                their search). Horizontal scroll for the 10
                categories; matches the HomeScreen chip pattern.
                `keyboardShouldPersistTaps="handled"` is essential
                — without it, a chip tap while the search input is
                focused fires the input's blur first and the chip
                tap never lands. */}
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
          </View>
        }
        renderSectionHeader={({ section: { title } }) => (
          <View style={styles.sectionHeader}>
            <Text style={typography.h3}>{title}</Text>
          </View>
        )}
        ListEmptyComponent={
          // PR-NEXT-9 + PR-NEXT-ENH-3 — four-branch empty state.
          // Search-AND-category takes precedence so the customer
          // sees the most specific reason their list is empty.
          searchQuery.trim() && selectedCategory ? (
            <View style={styles.noResults}>
              <Text style={styles.noResultsTitle}>
                No items in {labelForCategory(selectedCategory)} match “
                {searchQuery.trim()}”
              </Text>
              <Text style={styles.noResultsSub}>
                Try clearing the search or picking a different category.
              </Text>
            </View>
          ) : searchQuery.trim() ? (
            <View style={styles.noResults}>
              <Text style={styles.noResultsTitle}>
                No items match “{searchQuery.trim()}”
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
        renderItem={({ item }) => (
          <View style={styles.productRow}>
            <MenuItemCard
              item={item}
              shopId={shop.id}
              onAdd={() => onAdd(item)}
              quantityInCart={qtyInCart(item)}
              onIncrement={() => increment(item.productId ?? item.id)}
              onDecrement={() => decrement(item.productId ?? item.id)}
              disabled={!shop.isOpen}
            />
          </View>
        )}
      />

      {cartHasThisShop && items.length > 0 && (
        <Pressable
          style={[styles.cartBar, { bottom: insets.bottom + spacing.sm }]}
          onPress={() => nav.navigate('Cart')}
          accessibilityRole="button"
          accessibilityLabel={`View cart, ${itemCount} items, ${formatRupees(subtotal)}`}
        >
          <Text style={styles.cartText}>
            {itemCount} items · {formatRupees(subtotal)}
          </Text>
          <Text style={styles.cartCta}>View Cart ›</Text>
        </Pressable>
      )}
    </SafeAreaView>
  );
}

// PR-NEXT-ENH-3 (finding #6 follow-up) — small lookup so the
// empty-state copy uses the human-readable category label
// ("Dairy & Eggs") instead of the canonical id ("dairy_eggs").
// Falls back to the id if the lookup ever fails — defensive
// against a stale `selectedCategory` value after a categories
// list change.
function labelForCategory(id: CategoryId): string {
  return CATEGORIES.find(c => c.id === id)?.label ?? id;
}

// Inline card for menu items. Mirrors the visual treatment of the
// legacy ProductCard but reads MenuItem fields directly so we don't
// have to synthesize a Product shape per render.
function MenuItemCard({
  item,
  shopId,
  onAdd,
  quantityInCart,
  onIncrement,
  onDecrement,
  disabled,
}: {
  item: MenuItem;
  shopId: string;
  onAdd: () => void;
  quantityInCart: number;
  onIncrement: () => void;
  onDecrement: () => void;
  disabled?: boolean;
}) {
  // The server already filters out unavailable / out-of-stock items
  // before this screen renders, so `disabled` here only reflects the
  // shop being closed.
  return (
    <View style={[styles.card, disabled && styles.cardDisabled]}>
      <Image source={{ uri: item.imageUrl }} style={styles.cardImage} />
      <View style={styles.cardBody}>
        <View style={styles.cardTitleRow}>
          <Text style={styles.cardName} numberOfLines={2}>
            {item.name}
          </Text>
          {/* PR 19 — favorite heart sits in the title row so it
              doesn't displace the +/- controls below. Visible
              regardless of cart state; tapping while signed-out
              shows the "Sign in to save favorites" Alert. */}
          <FavoriteHeart shopId={shopId} menuItemId={item.id} size={20} />
        </View>
        <Text style={styles.cardPack}>{item.packLabel}</Text>
        <View style={styles.cardBottomRow}>
          <Price value={item.price} mrp={item.mrp} size="sm" />
          {disabled ? (
            <Text style={styles.outOfStock}>Closed</Text>
          ) : quantityInCart === 0 ? (
            <Pressable
              onPress={onAdd}
              style={styles.addBtn}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Add ${item.name} to cart`}
            >
              <Text style={styles.addBtnText}>ADD</Text>
            </Pressable>
          ) : (
            <QuantityStepper
              value={quantityInCart}
              onIncrement={onIncrement}
              onDecrement={onDecrement}
            />
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  hero: { width: '100%', height: 180, backgroundColor: colors.surface },
  heroBody: { padding: spacing.lg },
  // PR-NEXT-9 — inline empty-state for query-driven no-results.
  noResults: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    alignItems: 'center',
  },
  noResultsTitle: {
    ...typography.bodyBold,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  noResultsSub: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  // PR-NEXT-ENH-3 (finding #6 follow-up) — category chip row sits
  // directly below the search bar inside the SectionList header.
  // `gap` works on RN 0.71+; this codebase already uses it
  // elsewhere (e.g. ShopMenuScreen bulk bar).
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
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  address: { ...typography.body, color: colors.textSecondary, marginTop: spacing.xs },
  meta: { ...typography.caption, marginTop: spacing.sm },
  // PR 20 — spacer for the size="md" rating badge on the shop
  // header. flex-row so the inline badge layout doesn't get
  // stretched to row width.
  ratingRow: { marginTop: spacing.sm, flexDirection: 'row' },
  sectionHeader: {
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  productRow: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  cartBar: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.lg,
    backgroundColor: colors.primary,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cartText: { ...typography.bodyBold, color: '#fff' },
  cartCta: { ...typography.bodyBold, color: '#fff' },
  card: {
    flexDirection: 'row',
    backgroundColor: colors.bg,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    gap: spacing.md,
  },
  cardDisabled: { opacity: 0.55 },
  cardImage: {
    width: 72,
    height: 72,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
  },
  cardBody: { flex: 1, justifyContent: 'space-between' },
  // PR 19 — title row holds name + favorite heart on one line so
  // the +/- controls below stay visually anchored.
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  cardName: { ...typography.body, fontWeight: '600', flex: 1 },
  cardPack: { ...typography.caption, marginTop: 2 },
  cardBottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  outOfStock: { ...typography.caption, color: colors.danger, fontWeight: '600' },
  addBtn: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    minHeight: 32,
    justifyContent: 'center',
  },
  addBtnText: {
    ...typography.bodyBold,
    color: colors.primary,
    fontSize: 13,
    letterSpacing: 0.5,
  },
});
