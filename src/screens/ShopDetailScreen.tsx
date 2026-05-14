import { useNavigation, useRoute } from '@react-navigation/native';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Image, Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Badge from '../components/common/Badge';
import Loader from '../components/common/Loader';
import ScreenHeader from '../components/common/ScreenHeader';
import ProductCard from '../components/product/ProductCard';
import { CATEGORIES } from '../constants/categories';
import { colors, radii, spacing, typography } from '../constants/theme';
import { Analytics } from '../services/analytics';
import { productService } from '../services/productService';
import { shopService } from '../services/shopService';
import { useCartStore } from '../store/useCartStore';
import { useLocationStore } from '../store/useLocationStore';
import { Product, Shop } from '../types';
import { formatDistance, formatRupees } from '../utils/format';

export default function ShopDetailScreen() {
  const route = useRoute<any>();
  const nav = useNavigation<any>();
  const shopId: string = route.params.shopId;

  const [shop, setShop] = useState<Shop | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  const cartShopId = useCartStore(s => s.shopId);
  const cartShopName = useCartStore(s => s.shopName);
  const items = useCartStore(s => s.items);
  const addItem = useCartStore(s => s.addItem);
  const forceAddItem = useCartStore(s => s.forceAddItem);
  const increment = useCartStore(s => s.increment);
  const decrement = useCartStore(s => s.decrement);
  const itemCount = useCartStore(s => s.itemCount());
  const subtotal = useCartStore(s => s.subtotal());
  const location = useLocationStore(s => s.location);

  const cartHasThisShop = cartShopId === shopId;

  useEffect(() => {
    if (!location) return;
    (async () => {
      setLoading(true);
      const [s, p] = await Promise.all([
        shopService.getById(shopId, location),
        productService.getByShop(shopId),
      ]);
      setShop(s);
      setProducts(p);
      setLoading(false);
      if (s) Analytics.view_shop_detail({ shop_id: s.id, shop_name: s.name });
    })();
  }, [shopId, location]);

  const sections = useMemo(() => {
    const groups: Record<string, Product[]> = {};
    products.forEach(p => {
      (groups[p.category] ??= []).push(p);
    });
    return CATEGORIES
      .filter(c => groups[c.id]?.length)
      .map(c => ({ title: c.label, data: groups[c.id]! }));
  }, [products]);

  const onAdd = (p: Product) => {
    if (!shop) return;
    const result = addItem(p, shop);
    if (!result.ok && result.reason === 'different_shop') {
      Alert.alert(
        'Start a new cart?',
        `Your cart has items from ${cartShopName}. Clear it to add from ${shop.name}?`,
        [
          { text: 'Keep cart', style: 'cancel' },
          {
            text: 'Clear & add',
            style: 'destructive',
            onPress: () => forceAddItem(p, shop),
          },
        ]
      );
    }
  };

  const qtyInCart = (productId: string) =>
    cartHasThisShop ? (items.find(i => i.productId === productId)?.quantity ?? 0) : 0;

  if (loading || !shop) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="Loading..." onBack={() => nav.goBack()} />
        <Loader fullScreen />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title={shop.name} onBack={() => nav.goBack()} />
      <SectionList
        sections={sections}
        keyExtractor={p => p.id}
        stickySectionHeadersEnabled
        contentContainerStyle={{ paddingBottom: 120 }}
        ListHeaderComponent={
          <View>
            <Image source={{ uri: shop.imageUrl }} style={styles.hero} />
            <View style={styles.heroBody}>
              <View style={styles.titleRow}>
                <Text style={[typography.h1, { flex: 1 }]} numberOfLines={1}>{shop.name}</Text>
                <Badge
                  label={shop.isOpen ? 'OPEN' : 'CLOSED'}
                  tone={shop.isOpen ? 'success' : 'danger'}
                />
              </View>
              <Text style={styles.address}>{shop.address}</Text>
              <Text style={styles.meta}>
                ★ {shop.rating} · {formatDistance(shop.distanceKm)} · {shop.etaMinutes} min · {formatRupees(shop.deliveryFee)} delivery · Min {formatRupees(shop.minOrder)}
              </Text>
            </View>
          </View>
        }
        renderSectionHeader={({ section: { title } }) => (
          <View style={styles.sectionHeader}>
            <Text style={typography.h3}>{title}</Text>
          </View>
        )}
        renderItem={({ item }) => (
          <View style={styles.productRow}>
            <ProductCard
              product={item}
              onAdd={() => onAdd(item)}
              quantityInCart={qtyInCart(item.id)}
              onIncrement={() => increment(item.id)}
              onDecrement={() => decrement(item.id)}
              disabled={!shop.isOpen}
            />
          </View>
        )}
      />

      {cartHasThisShop && items.length > 0 && (
        <Pressable
          style={styles.cartBar}
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  hero: { width: '100%', height: 180, backgroundColor: colors.surface },
  heroBody: { padding: spacing.lg },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  address: { ...typography.body, color: colors.textSecondary, marginTop: spacing.xs },
  meta: { ...typography.caption, marginTop: spacing.sm },
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
});
