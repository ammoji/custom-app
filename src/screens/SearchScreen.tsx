import { useNavigation, useRoute } from '@react-navigation/native';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import EmptyState from '../components/common/EmptyState';
import Loader from '../components/common/Loader';
import ShopRatingBadge from '../components/shop/ShopRatingBadge';
import { CATEGORIES } from '../constants/categories';
import { colors, radii, spacing, typography } from '../constants/theme';
import { orderService } from '../services/orderService';
import { useCartStore } from '../store/useCartStore';
import { useLocationStore } from '../store/useLocationStore';
import type { MenuItem } from '../types';
import { formatRupees } from '../utils/format';

/**
 * SearchScreen — PR 4 rewrite.
 *
 * Pre-PR-4: read every shop's products from /products (legacy
 * collection) and filtered client-side. Result: shops registered
 * after Phase 12a-v2-iii had their per-shop /menu items completely
 * invisible to search.
 *
 * Post-PR-4: single callable `searchMenuPublic` does the work
 * server-side — collection-group query on `menu`, filter by
 * candidate active shops + query/category/stock, join shop info,
 * cap at 50. The screen is now a thin layer over that callable.
 *
 * Behaviour:
 *   - On mount + on query/category change, debounce 250ms then
 *     re-fetch.
 *   - Empty query AND `all` category: show the hint, skip the
 *     fetch (avoid surfacing a 50-item omnibus on first paint).
 *   - Tapping a result navigates to ShopDetail. Inline add-to-cart
 *     is deferred (V2) — see prompt rationale.
 *   - Cart pill at the bottom links to checkout when items exist.
 */
type Result = {
  menuItem: MenuItem;
  shop: {
    id: string;
    name: string;
    address: string;
    distanceKm?: number;
    // PR 20 — rolling rating stats propagated from searchMenuPublic.
    ratingAvg?: number;
    ratingCount?: number;
  };
};

const DEBOUNCE_MS = 250;
const MIN_QUERY_LEN = 2;

export default function SearchScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  // PR-NEXT-2 (finding #1) — Android safe-area inset for the
  // floating cart bar. See HomeScreen for the full root-cause
  // note.
  const insets = useSafeAreaInsets();
  const inputRef = useRef<TextInput>(null);

  const [query, setQuery] = useState<string>(route.params?.query ?? '');
  const [selectedCategory, setSelectedCategory] = useState<string>(
    route.params?.category ?? 'all',
  );
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const itemCount = useCartStore(s => s.itemCount());
  const total = useCartStore(s => s.total());
  const location = useLocationStore(s => s.location);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const trimmedQuery = query.trim();
  const hasFilter =
    trimmedQuery.length >= MIN_QUERY_LEN || selectedCategory !== 'all';

  // Debounced search. Cancels in-flight fetch if user keeps typing
  // — the `cancelled` flag prevents stale results from clobbering
  // newer ones (same race-guard pattern as PR 3 watcher rollback).
  useEffect(() => {
    if (!hasFilter) {
      setResults([]);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const timer = setTimeout(async () => {
      try {
        const r = await orderService.searchMenuPublic({
          query: trimmedQuery.length >= MIN_QUERY_LEN ? trimmedQuery : undefined,
          category: selectedCategory !== 'all' ? selectedCategory : undefined,
          location: location
            ? { lat: location.lat, lng: location.lng }
            : undefined,
        });
        if (cancelled) return;
        setResults(r.items as Result[]);
      } catch (e: any) {
        if (cancelled) return;
        // Map the raw callable error to something a customer can act
        // on. The most common cause in the wild: missing index (we
        // ship one, but a forgotten deploy after schema change would
        // surface FAILED_PRECONDITION here).
        console.warn('[Search] searchMenuPublic failed:', e);
        setError(
          'Could not load search results. Please check your connection and try again.',
        );
        setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmedQuery, selectedCategory, hasFilter, location]);

  const isEmptyQuery = !hasFilter;
  const hasNoResults =
    !loading && !error && hasFilter && results.length === 0;

  const renderRow = useMemo(
    () =>
      ({ item }: { item: Result }) => (
        <Pressable
          style={styles.row}
          onPress={() =>
            nav.navigate('ShopDetail', { shopId: item.shop.id })
          }
          accessibilityRole="button"
          accessibilityLabel={`${item.menuItem.name} from ${item.shop.name}, ${formatRupees(item.menuItem.price)}`}
        >
          <Image
            source={{ uri: item.menuItem.imageUrl }}
            style={styles.thumb}
          />
          <View style={styles.rowBody}>
            <Text style={styles.itemName} numberOfLines={1}>
              {item.menuItem.name}
            </Text>
            <Text style={styles.shopLine} numberOfLines={1}>
              {item.shop.name}
              {typeof item.shop.distanceKm === 'number'
                ? ` · ${item.shop.distanceKm.toFixed(1)} km`
                : ''}
            </Text>
            {/* PR 20 — shop rolling rating badge sits beneath the
                shop-name line so the customer sees the trust signal
                without it competing with item name + price for the
                top spot in the row. */}
            <View style={styles.ratingRow}>
              <ShopRatingBadge
                ratingAvg={item.shop.ratingAvg}
                ratingCount={item.shop.ratingCount}
                size="sm"
              />
            </View>
            <Text style={styles.packLine} numberOfLines={1}>
              {item.menuItem.packLabel}
            </Text>
          </View>
          <View style={styles.rowRight}>
            <Text style={styles.price}>
              {formatRupees(item.menuItem.price)}
            </Text>
            <Text style={styles.openShop}>Open shop ›</Text>
          </View>
        </Pressable>
      ),
    [nav],
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Search bar */}
      <View style={styles.searchRow}>
        <Pressable
          onPress={() => nav.goBack()}
          style={styles.backBtn}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Text style={styles.backArrow}>←</Text>
        </Pressable>
        <TextInput
          ref={inputRef}
          style={styles.input}
          value={query}
          onChangeText={setQuery}
          placeholder="Search for atta, milk, soap…"
          placeholderTextColor={colors.textMuted}
          returnKeyType="search"
          autoCorrect={false}
          accessibilityLabel="Search products"
        />
        {query.length > 0 && (
          <Pressable
            onPress={() => setQuery('')}
            style={styles.clearBtn}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
          >
            <Text style={styles.clearText}>✕</Text>
          </Pressable>
        )}
      </View>

      {/* Category chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipsScroll}
        contentContainerStyle={styles.chips}
      >
        {[{ id: 'all', label: 'All' }, ...CATEGORIES].map(item => (
          <Pressable
            key={item.id}
            style={[
              styles.chip,
              selectedCategory === item.id && styles.chipActive,
            ]}
            onPress={() => setSelectedCategory(item.id)}
            accessibilityRole="button"
            accessibilityLabel={`Filter by ${item.label}`}
            accessibilityState={{ selected: selectedCategory === item.id }}
          >
            <Text
              numberOfLines={1}
              style={[
                styles.chipText,
                selectedCategory === item.id && styles.chipTextActive,
              ]}
            >
              {item.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Body */}
      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable
            // Re-trigger the effect by toggling state through a
            // no-op trim. Cheaper than a separate retry nonce; the
            // dependency-tracking setQuery same-value short-circuit
            // means we have to mutate something — we re-set the
            // category to its current value, which is harmless.
            onPress={() => setSelectedCategory(c => c)}
            accessibilityRole="button"
            accessibilityLabel="Retry search"
          >
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : null}

      {loading ? (
        <Loader fullScreen />
      ) : isEmptyQuery ? (
        <View style={styles.hint}>
          <Text style={styles.hintText}>Try ‘atta’, ‘milk’, ‘soap’</Text>
        </View>
      ) : hasNoResults ? (
        <EmptyState
          title={
            trimmedQuery.length >= MIN_QUERY_LEN
              ? `No matches for ‘${trimmedQuery}’`
              : 'No items in this category nearby'
          }
          subtitle={
            selectedCategory !== 'all'
              ? `Try a different category or clear the filter.`
              : 'Try a different name.'
          }
        />
      ) : (
        <FlatList
          data={results}
          keyExtractor={r => `${r.shop.id}_${r.menuItem.id}`}
          renderItem={renderRow}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: 120 + insets.bottom },
          ]}
          keyboardShouldPersistTaps="handled"
        />
      )}

      {/* Sticky cart bar */}
      {itemCount > 0 && (
        <Pressable
          style={[styles.cartBar, { bottom: insets.bottom + spacing.sm }]}
          onPress={() => nav.navigate('Cart')}
          accessibilityRole="button"
          accessibilityLabel={`View cart, ${itemCount} item${itemCount > 1 ? 's' : ''}, total ${formatRupees(total)}`}
        >
          <Text style={styles.cartText}>
            🛒 {itemCount} item{itemCount > 1 ? 's' : ''} · {formatRupees(total)}
          </Text>
          <Text style={styles.cartCta}>View Cart ›</Text>
        </Pressable>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },

  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  backBtn: { padding: spacing.xs },
  backArrow: { fontSize: 20, color: colors.textPrimary },
  input: {
    flex: 1,
    height: 40,
    backgroundColor: colors.surface,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    ...typography.body,
    color: colors.textPrimary,
  },
  clearBtn: { padding: spacing.xs },
  clearText: { fontSize: 14, color: colors.textSecondary },

  chipsScroll: { flexGrow: 0, flexShrink: 0 },
  chips: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
    alignItems: 'center',
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    alignSelf: 'flex-start',
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...typography.caption, color: colors.textSecondary },
  chipTextActive: { color: '#fff', fontWeight: '600' },

  hint: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  hintText: { ...typography.body, color: colors.textMuted },

  errorBanner: {
    margin: spacing.lg,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.danger,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
  },
  errorText: {
    ...typography.body,
    color: colors.textPrimary,
    flex: 1,
  },
  retryText: { ...typography.bodyBold, color: colors.primary },

  listContent: { paddingBottom: 120 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  thumb: {
    width: 56,
    height: 56,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
  },
  rowBody: { flex: 1 },
  itemName: { ...typography.bodyBold, color: colors.textPrimary },
  shopLine: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  // PR 20 — slim wrap so the badge has visible margin from
  // shopLine and packLine without overlapping either.
  ratingRow: { marginTop: 2, flexDirection: 'row' },
  packLine: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
  },
  rowRight: { alignItems: 'flex-end' },
  price: { ...typography.bodyBold, color: colors.textPrimary },
  openShop: {
    ...typography.caption,
    color: colors.primary,
    marginTop: 2,
  },
  separator: {
    height: 1,
    backgroundColor: colors.border,
    marginLeft: spacing.lg + 56 + spacing.md,
  },

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
});
