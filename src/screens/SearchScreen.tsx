import { useNavigation, useRoute } from '@react-navigation/native';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import EmptyState from '../components/common/EmptyState';
import Loader from '../components/common/Loader';
import ProductCard from '../components/product/ProductCard';
import { CATEGORIES } from '../constants/categories';
import { colors, radii, spacing, typography } from '../constants/theme';
import { productService } from '../services/productService';
import { shopService } from '../services/shopService';
import { useCartStore } from '../store/useCartStore';
import type { Product, Shop } from '../types';
import { formatRupees } from '../utils/format';

type ShopGroup = { shop: Shop; products: Product[] };

export default function SearchScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<any>();
  const inputRef = useRef<TextInput>(null);

  const [query, setQuery] = useState<string>(route.params?.query ?? '');
  const [selectedCategory, setSelectedCategory] = useState<string>(
    route.params?.category ?? 'all'
  );
  const [allData, setAllData] = useState<ShopGroup[]>([]);
  const [loading, setLoading] = useState(true);

  const cart = useCartStore();
  const itemCount = useCartStore(s => s.itemCount());
  const total = useCartStore(s => s.total());

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const shops = await shopService.getNearbyShops();
        const groups = await Promise.all(
          shops.map(async (shop: Shop) => ({
            shop,
            products: await productService.getByShop(shop.id),
          }))
        );
        setAllData(groups);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const results = useMemo(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2 && selectedCategory === 'all') return [];
    return allData
      .map(({ shop, products }) => ({
        shop,
        products: products.filter(p => {
          const matchesQuery =
            trimmed.length < 2 ||
            p.name.toLowerCase().includes(trimmed.toLowerCase()) ||
            (p.brand ?? '').toLowerCase().includes(trimmed.toLowerCase());
          const matchesCat =
            selectedCategory === 'all' || p.category === selectedCategory;
          return matchesQuery && matchesCat;
        }),
      }))
      .filter(g => g.products.length > 0);
  }, [query, selectedCategory, allData]);

  const qtyInCart = (productId: string, shopId: string) =>
    cart.shopId === shopId
      ? (cart.items.find(i => i.productId === productId)?.quantity ?? 0)
      : 0;

  const isEmptyQuery = !loading && query.trim().length < 2 && selectedCategory === 'all';
  const hasNoResults = !loading && !isEmptyQuery && results.length === 0;

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
            style={[styles.chip, selectedCategory === item.id && styles.chipActive]}
            onPress={() => setSelectedCategory(item.id)}
            accessibilityRole="button"
            accessibilityLabel={`Filter by ${item.label}`}
            accessibilityState={{ selected: selectedCategory === item.id }}
          >
            <Text
              numberOfLines={1}
              style={[styles.chipText, selectedCategory === item.id && styles.chipTextActive]}
            >
              {item.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Body */}
      {loading ? (
        <Loader fullScreen />
      ) : isEmptyQuery ? (
        <View style={styles.hint}>
          <Text style={styles.hintText}>Try ‘atta’, ‘milk’, ‘soap’</Text>
        </View>
      ) : hasNoResults ? (
        <EmptyState
          title={`No matches for ‘${query.trim()}’ near you`}
          subtitle="Try a different name or clear the category filter."
        />
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {results.map(({ shop, products }) => (
            <View key={shop.id} style={styles.group}>
              {/* Group header */}
              <View style={styles.groupHeader}>
                <View>
                  <Text style={styles.shopName}>{shop.name}</Text>
                  <Text style={styles.shopMeta}>
                    {shop.distanceKm != null
                      ? `${shop.distanceKm.toFixed(1)} km`
                      : shop.address}
                  </Text>
                </View>
                <Pressable
                  onPress={() => nav.navigate('ShopDetail', { shopId: shop.id })}
                  accessibilityRole="button"
                  accessibilityLabel={`See all products from ${shop.name}`}
                >
                  <Text style={styles.seeAll}>See all ›</Text>
                </Pressable>
              </View>

              {/* Horizontal product scroll */}
              <FlatList
                data={products}
                keyExtractor={p => p.id}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.productRow}
                ItemSeparatorComponent={() => <View style={{ width: spacing.md }} />}
                renderItem={({ item }) => (
                  <View style={styles.productCardWrap}>
                    <ProductCard
                      product={item}
                      quantityInCart={qtyInCart(item.id, shop.id)}
                      onAdd={() => cart.addItem(item, shop)}
                      onIncrement={() => cart.increment(item.id)}
                      onDecrement={() => cart.decrement(item.id)}
                      disabled={!shop.isOpen}
                    />
                  </View>
                )}
              />
            </View>
          ))}
        </ScrollView>
      )}

      {/* Sticky cart bar */}
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

  hint: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  hintText: { ...typography.body, color: colors.textMuted },

  scrollContent: { paddingBottom: 120 },
  group: { marginTop: spacing.xl },
  groupHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  shopName: { ...typography.h3, color: colors.textPrimary },
  shopMeta: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  seeAll: { ...typography.bodyBold, color: colors.primary },

  productRow: { paddingHorizontal: spacing.lg },
  productCardWrap: { width: 200 },

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
