import { useNavigation } from '@react-navigation/native';
import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import EmptyState from '../components/common/EmptyState';
import Input from '../components/common/Input';
import Loader from '../components/common/Loader';
import ScreenHeader from '../components/common/ScreenHeader';
import ShopCard from '../components/shop/ShopCard';
import { colors, radii, spacing, typography } from '../constants/theme';
import { Analytics } from '../services/analytics';
import { shopService } from '../services/shopService';
import { useCartStore } from '../store/useCartStore';
import { useLocationStore } from '../store/useLocationStore';
import { Shop } from '../types';
import { formatRupees } from '../utils/format';

export default function ShopListScreen() {
  const nav = useNavigation<any>();
  const [shops, setShops] = useState<Shop[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');

  const itemCount = useCartStore(s => s.itemCount());
  const total = useCartStore(s => s.total());
  const location = useLocationStore(s => s.location);

  const load = useCallback(async () => {
    if (!location) return;
    const data = await shopService.getNearbyShops(location);
    setShops(data);
    Analytics.view_shop_list({ count: data.length });
  }, [location]);

  useEffect(() => {
    if (!location) return;
    (async () => {
      setLoading(true);
      await load();
      setLoading(false);
    })();
  }, [load, location]);

  const onRefresh = useCallback(async () => {
    if (!location) return;
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load, location]);

  // Phase 12a-v2-iii: customers see only `status === 'active'` shops
  // (or legacy seeded shops without a status field — see
  // `scripts/backfill-shop-menus.ts` for context). Pending /
  // suspended / rejected shops are filtered out here so a customer
  // browsing the home flow never lands on them. Admins still see
  // every state via Shop Management. The active-shop guarantee is
  // also enforced server-side in `listShopMenuPublic` so a leaked
  // shop URL can't bypass this filter.
  const filtered = shops.filter(s => {
    const status = (s as Shop & { status?: string }).status;
    const isLive = status === undefined || status === 'active';
    if (!isLive) return false;
    return s.name.toLowerCase().includes(query.trim().toLowerCase());
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
            <EmptyState
              title={query ? 'No shops match' : 'No shops near you'}
              subtitle={query ? 'Try clearing your search.' : "We're expanding fast — check back soon."}
            />
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
});
