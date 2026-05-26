import { useNavigation } from '@react-navigation/native';
import React, { useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import EmptyState from '../components/common/EmptyState';
import Input from '../components/common/Input';
import Loader from '../components/common/Loader';
import ScreenHeader from '../components/common/ScreenHeader';
import ShopCard from '../components/shop/ShopCard';
import { colors, radii, spacing, typography } from '../constants/theme';
import { Analytics } from '../services/analytics';
import { useCartStore } from '../store/useCartStore';
import { useLocationStore } from '../store/useLocationStore';
import { useProfileStore } from '../store/useProfileStore';
import type { Shop } from '../types';
import { formatRupees } from '../utils/format';
import { useShopListData } from './ShopListScreen.useShopListData';

export default function ShopListScreen() {
  const nav = useNavigation<any>();
  const [query, setQuery] = useState('');
  // PR 36.1 — inline "Favorites only" filter. Local screen state,
  // not persisted: resets to All on each navigation here. PR 19
  // stored favorites as `Record<shopId, menuItemIds[]>` on the
  // user profile; a shop counts as favorited if its key is
  // present (server normalises empty-array entries away).
  const [favoritesOnly, setFavoritesOnly] = useState(false);

  const itemCount = useCartStore(s => s.itemCount());
  const total = useCartStore(s => s.total());
  const location = useLocationStore(s => s.location);
  const favorites = useProfileStore(s => s.profile?.favorites ?? {});

  // State machine extracted to ./ShopListScreen.useShopListData so
  // the loader-stuck-forever bug class can be unit-tested without
  // mounting React Native components. The hook's contract:
  //   - `loading` ALWAYS resets in finally
  //   - errors surface via `error`, never via thrown promises
  //   - `reload()` re-runs the same load with the same guarantee
  const { shops, loading, refreshing, error, reload } = useShopListData(
    location ?? null,
  );

  // Fire the view_shop_list analytics event on each successful load.
  // Done here rather than in the hook so the hook stays pure / testable.
  const lastLoggedRef = useRef<number>(-1);
  useEffect(() => {
    if (loading || error) return;
    if (lastLoggedRef.current === shops.length) return;
    lastLoggedRef.current = shops.length;
    Analytics.view_shop_list({ count: shops.length });
  }, [loading, error, shops.length]);

  const onRefresh = reload;

  // Phase 12a-v2-iii: customers see only `status === 'active'` shops
  // (or legacy seeded shops without a status field — see
  // `scripts/backfill-shop-menus.ts` for context). Pending /
  // suspended / rejected shops are filtered out here so a customer
  // browsing the home flow never lands on them. Admins still see
  // every state via Shop Management. The active-shop guarantee is
  // also enforced server-side in `listShopMenuPublic` so a leaked
  // shop URL can't bypass this filter.
  const filtered = shops.filter((s: Shop) => {
    const status = (s as Shop & { status?: string }).status;
    const isLive = status === undefined || status === 'active';
    if (!isLive) return false;
    if (!s.name.toLowerCase().includes(query.trim().toLowerCase())) {
      return false;
    }
    // PR 36.1 — favorites filter. Empty-array entries should not
    // exist in steady state (server prunes them), but guard
    // anyway so a transient empty array doesn't surface a shop
    // as "favorited".
    if (favoritesOnly) {
      const items = favorites[s.id];
      if (!items || items.length === 0) return false;
    }
    return true;
  });

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader
        title="Shops near you"
        onBack={() => nav.goBack()}
        right={
          <Pressable
            onPress={() => nav.navigate('Search')}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Search products"
          >
            <Text style={{ fontSize: 22 }}>🔍</Text>
          </Pressable>
        }
      />
      <View style={styles.searchWrap}>
        <Input value={query} onChangeText={setQuery} placeholder="Search shop name" />
      </View>
      {/* PR 36.1 — favorites-only filter pill. Above the list,
          mirrors the visual treatment of the HomeScreen favorites
          tile (heart emoji + pill shape). */}
      <View style={styles.filterRow}>
        <Pressable
          onPress={() => {
            const next = !favoritesOnly;
            setFavoritesOnly(next);
            Analytics.customer_favorites_filter_toggled({ enabled: next });
          }}
          style={[
            styles.filterPill,
            favoritesOnly && styles.filterPillActive,
          ]}
          accessibilityRole="button"
          accessibilityLabel={
            favoritesOnly ? 'Show all shops' : 'Show favorites only'
          }
          accessibilityState={{ selected: favoritesOnly }}
        >
          <Text
            style={
              favoritesOnly
                ? styles.filterPillTextActive
                : styles.filterPillText
            }
          >
            {favoritesOnly ? '❤️ Favorites only' : '🏪 All shops'}
          </Text>
        </Pressable>
      </View>
      {error && !loading && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable
            onPress={onRefresh}
            style={styles.retryBtn}
            accessibilityRole="button"
            accessibilityLabel="Retry loading shops"
          >
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      )}
      {loading ? (
        <Loader fullScreen />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={s => s.id}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
          renderItem={({ item }) => (
            <ShopCard
              shop={item}
              onPress={() => nav.navigate('ShopDetail', { shopId: item.id })}
            />
          )}
          ListEmptyComponent={
            favoritesOnly ? (
              // PR 36.1 — dedicated empty state when the filter is
              // on but the customer has no favorites yet. Friendlier
              // than the generic "No shops match" copy + offers a
              // one-tap escape hatch back to the full list.
              <View style={styles.favEmpty}>
                <Text style={styles.favEmptyTitle}>No favorites yet</Text>
                <Text style={styles.favEmptyHint}>
                  Tap the ❤️ on any shop's detail page to add it to
                  your favorites.
                </Text>
                <Pressable
                  onPress={() => setFavoritesOnly(false)}
                  style={styles.favEmptyCta}
                  accessibilityRole="button"
                  accessibilityLabel="Show all shops"
                >
                  <Text style={styles.favEmptyCtaText}>Show all shops</Text>
                </Pressable>
              </View>
            ) : (
              <EmptyState
                title={query ? 'No shops match' : 'No shops near you'}
                subtitle={query ? 'Try clearing your search.' : "We're expanding fast — check back soon."}
              />
            )
          }
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        />
      )}

      {itemCount > 0 && (
        <Pressable
          style={styles.cartBar}
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
  searchWrap: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  list: { paddingHorizontal: spacing.lg, paddingBottom: 120, flexGrow: 1 },
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
  errorBanner: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    padding: spacing.md,
    backgroundColor: '#FEF2F2', // light red wash
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radii.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  errorText: {
    ...typography.body,
    color: colors.danger,
    flex: 1,
    marginRight: spacing.md,
  },
  retryBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.danger,
    borderRadius: radii.sm,
  },
  retryText: { ...typography.bodyBold, color: '#fff' },
  // PR 36.1 — favorites filter pill + empty state.
  filterRow: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    flexDirection: 'row',
  },
  filterPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterPillActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  filterPillText: { ...typography.bodyBold, color: colors.textPrimary },
  filterPillTextActive: { ...typography.bodyBold, color: '#fff' },
  favEmpty: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.lg,
  },
  favEmptyTitle: { ...typography.h3, marginBottom: spacing.sm },
  favEmptyHint: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  favEmptyCta: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.primary,
  },
  favEmptyCtaText: { ...typography.bodyBold, color: '#fff' },
});
