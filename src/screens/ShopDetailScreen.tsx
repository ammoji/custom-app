import { useNavigation, useRoute } from '@react-navigation/native';
import React, { useEffect, useMemo, useState } from 'react';
import {
    Alert,
    Image,
    Pressable,
    SectionList,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Badge from '../components/common/Badge';
import EmptyState from '../components/common/EmptyState';
import Loader from '../components/common/Loader';
import Price from '../components/common/Price';
import QuantityStepper from '../components/common/QuantityStepper';
import ScreenHeader from '../components/common/ScreenHeader';
import { CATEGORIES } from '../constants/categories';
import { colors, radii, spacing, typography } from '../constants/theme';
import { Analytics } from '../services/analytics';
import { orderService } from '../services/orderService';
import { useCartStore } from '../store/useCartStore';
import { useLocationStore } from '../store/useLocationStore';
import { MenuItem, Shop } from '../types';
import { haversineKm } from '../utils/distance';
import { formatDistance, formatRupees } from '../utils/format';

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
  const shopId: string = route.params.shopId;

  const [shop, setShop] = useState<Shop | null>(null);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

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

  const sections = useMemo(() => {
    const groups: Record<string, MenuItem[]> = {};
    menu.forEach(m => {
      (groups[m.category] ??= []).push(m);
    });
    return CATEGORIES.filter(c => groups[c.id]?.length).map(c => ({
      title: c.label,
      // Sort within a category by name so the customer view is
      // stable even when shop owners add custom items mid-session.
      data: groups[c.id]!.slice().sort((a, b) => a.name.localeCompare(b.name)),
    }));
  }, [menu]);

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
        contentContainerStyle={{ paddingBottom: 120, flexGrow: 1 }}
        ListHeaderComponent={
          <View>
            <Image source={{ uri: shop.imageUrl }} style={styles.hero} />
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
              <Text style={styles.meta}>
                ★ {shop.rating} · {formatDistance(shop.distanceKm)} ·{' '}
                {shop.etaMinutes} min · {formatRupees(shop.deliveryFee)}{' '}
                delivery · Min {formatRupees(shop.minOrder)}
              </Text>
            </View>
          </View>
        }
        renderSectionHeader={({ section: { title } }) => (
          <View style={styles.sectionHeader}>
            <Text style={typography.h3}>{title}</Text>
          </View>
        )}
        ListEmptyComponent={
          <View style={{ paddingTop: spacing.xl }}>
            <EmptyState
              title="No items right now"
              subtitle="This shop hasn't added anything to its menu yet. Check back soon."
            />
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.productRow}>
            <MenuItemCard
              item={item}
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

// Inline card for menu items. Mirrors the visual treatment of the
// legacy ProductCard but reads MenuItem fields directly so we don't
// have to synthesize a Product shape per render.
function MenuItemCard({
  item,
  onAdd,
  quantityInCart,
  onIncrement,
  onDecrement,
  disabled,
}: {
  item: MenuItem;
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
        <Text style={styles.cardName} numberOfLines={2}>
          {item.name}
        </Text>
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
  cardName: { ...typography.body, fontWeight: '600' },
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
