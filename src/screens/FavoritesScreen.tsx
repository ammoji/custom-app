/**
 * PR 19 — Favorites screen.
 *
 * Renders the customer's favorited menu items grouped by shop, with
 * live prices + availability + +/- cart controls. Reads the
 * favorites map from `useProfileStore`; for each shopId in the map,
 * fetches that shop's CURRENT menu via `orderService.listShopMenuPublic`
 * so the screen reflects today's prices (not whatever the customer
 * saw when they originally favorited).
 *
 * Empty / edge cases the screen handles explicitly:
 *   - Customer favorited an item, shop later removed it from menu →
 *     show a "No longer available" row with a Remove button that
 *     unfavorites the orphan.
 *   - Customer favorited items at a shop that's since been
 *     suspended (`listShopMenuPublic` 404s) → show a banner with a
 *     bulk "Remove all favorites from this shop" CTA.
 *   - Customer's profile has favorites but they all resolve to
 *     missing items / shops → still render groups with the
 *     unavailable / suspended-shop rows so the customer can clean
 *     up.
 *
 * Cart wiring: + uses `useCartStore.addMenuItem` which surfaces the
 * existing different_shop blocker via Alert (mirrors ShopDetail's
 * "Start a new cart?" pattern from PR 4 — multi-shop carts are out
 * of scope; the customer is given the same Replace-cart escape
 * hatch they already know).
 *
 * Hooks discipline: state hoisted to the top per the
 * PR 12 → PR 18 lineage. The screen has multiple early returns
 * (loading, empty, error); declaring useState below those would
 * crash on first data load.
 */
import { useNavigation } from '@react-navigation/native';
import React, { useCallback, useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import EmptyState from '../components/common/EmptyState';
import FavoriteHeart from '../components/common/FavoriteHeart';
import Price from '../components/common/Price';
import QuantityStepper from '../components/common/QuantityStepper';
import ScreenHeader from '../components/common/ScreenHeader';
import { colors, radii, spacing, typography } from '../constants/theme';
import { orderService } from '../services/orderService';
import { profileService } from '../services/profileService';
import { useCartStore } from '../store/useCartStore';
import { useProfileStore } from '../store/useProfileStore';
import type { MenuItem, Shop } from '../types';

// One resolved row in the per-shop list. We keep both "available"
// and "missing" rows in the same array so the render order matches
// the customer's original favorite order.
type ResolvedRow =
  | { kind: 'available'; menuItem: MenuItem }
  | { kind: 'missing'; menuItemId: string };

type ResolvedShopGroup =
  | {
      kind: 'ok';
      shop: Shop;
      rows: ResolvedRow[];
    }
  | {
      kind: 'unavailable';
      shopId: string;
      // Best-effort label — we don't have the shop doc here, so the
      // header just reads "Shop no longer available". A future
      // enhancement could cache last-known shop names client-side.
      menuItemIds: string[];
    };

export default function FavoritesScreen() {
  const nav = useNavigation<any>();

  // PR 19 — hoisted state, above the early returns. See lineage on
  // HomeScreen / OrderDetailScreen (PR 12 / 13 / 14 / 15 / 17 / 18).
  const favoritesMap = useProfileStore(s => s.profile?.favorites);
  const profileLoaded = useProfileStore(s => s.loaded);
  const setProfile = useProfileStore(s => s.setProfile);

  const cartShopId = useCartStore(s => s.shopId);
  const cartShopName = useCartStore(s => s.shopName);
  const cartItems = useCartStore(s => s.items);
  const addMenuItem = useCartStore(s => s.addMenuItem);
  const forceAddMenuItem = useCartStore(s => s.forceAddMenuItem);
  const increment = useCartStore(s => s.increment);
  const decrement = useCartStore(s => s.decrement);

  const [groups, setGroups] = useState<ResolvedShopGroup[]>([]);
  const [loading, setLoading] = useState(true);

  // Derive a stable serialised key for the favorites map so the
  // useEffect can re-run only when the actual contents change. Using
  // the map reference directly would re-fetch on every setProfile
  // (e.g. unrelated address edits).
  const favoritesKey = favoritesMap
    ? Object.entries(favoritesMap)
        .map(([shopId, ids]) => `${shopId}:${ids.join(',')}`)
        .sort()
        .join('|')
    : '';

  useEffect(() => {
    if (!profileLoaded) return;
    if (!favoritesMap || Object.keys(favoritesMap).length === 0) {
      setGroups([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    // Fetch each shop's current menu in parallel. Any shop that 404s
    // (suspended / rejected) downgrades to a "kind: unavailable"
    // group with a bulk-remove CTA.
    Promise.all(
      Object.entries(favoritesMap).map(async ([shopId, ids]) => {
        try {
          const { shop, items } = await orderService.listShopMenuPublic(
            shopId,
          );
          const byId = new Map(items.map(i => [i.id, i] as const));
          const rows: ResolvedRow[] = ids.map(menuItemId => {
            const found = byId.get(menuItemId);
            return found
              ? { kind: 'available', menuItem: found }
              : { kind: 'missing', menuItemId };
          });
          return { kind: 'ok', shop, rows } satisfies ResolvedShopGroup;
        } catch (err) {
          console.warn(
            '[Favorites] listShopMenuPublic failed for',
            shopId,
            err,
          );
          return {
            kind: 'unavailable',
            shopId,
            menuItemIds: ids,
          } satisfies ResolvedShopGroup;
        }
      }),
    ).then(resolved => {
      if (cancelled) return;
      setGroups(resolved);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [favoritesKey, profileLoaded]);

  // Cart-line lookup mirrors ShopDetailScreen's logic so qty
  // displayed here matches what the customer would see there.
  const qtyInCart = useCallback(
    (item: MenuItem): number => {
      if (cartShopId !== item.shopId) return 0;
      const key = item.productId ?? item.id;
      return cartItems.find(i => i.productId === key)?.quantity ?? 0;
    },
    [cartShopId, cartItems],
  );

  const onAdd = useCallback(
    (item: MenuItem, shop: Shop) => {
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
    },
    [addMenuItem, cartShopName, forceAddMenuItem],
  );

  // Bulk-unfavorite all items from an unavailable shop. Sequential
  // calls (rather than a server-side bulk endpoint) — this is rare
  // and the customer's already paid the latency cost of opening
  // FavoritesScreen. Optimistic clearing of the local map upfront
  // so the section disappears immediately; failures roll back.
  const onRemoveShopFavorites = useCallback(
    async (shopId: string, menuItemIds: string[]) => {
      const baseline = useProfileStore.getState().profile;
      if (!baseline) return;
      const optimistic = { ...(baseline.favorites ?? {}) };
      delete optimistic[shopId];
      setProfile({ ...baseline, favorites: optimistic });
      try {
        // Fire calls in series so a partial-failure leaves a clean
        // intermediate state (some removed, some not) rather than
        // hammering the callable.
        for (const menuItemId of menuItemIds) {
          await profileService.toggleFavorite({ shopId, menuItemId });
        }
        // Final reconcile from server — last call returns fresh
        // profile but we re-read store to keep this callable async-
        // boundary safe.
      } catch (err) {
        console.warn('[Favorites] bulk remove failed:', err);
        setProfile(baseline);
        Alert.alert(
          'Could not remove favorites',
          'Check your connection and try again.',
        );
      }
    },
    [setProfile],
  );

  if (!profileLoaded || loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="Favorites" onBack={() => nav.goBack()} />
        <View style={styles.loaderWrap}>
          <ActivityIndicator />
        </View>
      </SafeAreaView>
    );
  }

  if (groups.length === 0) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="Favorites" onBack={() => nav.goBack()} />
        <EmptyState
          title="No favorites yet"
          subtitle="Tap the 🤍 next to any item to save it for quick reordering."
          ctaLabel="Browse shops"
          onCtaPress={() => nav.navigate('ShopList')}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="Favorites" onBack={() => nav.goBack()} />
      <ScrollView contentContainerStyle={styles.content}>
        {groups.map(group => {
          if (group.kind === 'unavailable') {
            return (
              <View
                key={group.shopId}
                style={[styles.shopCard, styles.shopCardUnavailable]}
              >
                <Text style={styles.shopHeaderUnavailable}>
                  Shop no longer available
                </Text>
                <Text style={styles.shopHeaderSub}>
                  {group.menuItemIds.length} favorite
                  {group.menuItemIds.length === 1 ? '' : 's'} from this
                  shop can no longer be ordered.
                </Text>
                <View style={{ height: spacing.sm }} />
                <Pressable
                  style={styles.removeAllBtn}
                  onPress={() =>
                    onRemoveShopFavorites(
                      group.shopId,
                      group.menuItemIds,
                    )
                  }
                  accessibilityRole="button"
                  accessibilityLabel="Remove all favorites from this shop"
                >
                  <Text style={styles.removeAllText}>
                    Remove these favorites
                  </Text>
                </Pressable>
              </View>
            );
          }

          const { shop, rows } = group;
          return (
            <View key={shop.id} style={styles.shopCard}>
              <Pressable
                onPress={() =>
                  nav.navigate('ShopDetail', { shopId: shop.id })
                }
                accessibilityRole="button"
                accessibilityLabel={`Open ${shop.name}`}
              >
                <Text style={styles.shopHeader}>{shop.name}</Text>
              </Pressable>
              {rows.map((row, idx) => {
                if (row.kind === 'missing') {
                  return (
                    <View
                      key={`missing-${row.menuItemId}-${idx}`}
                      style={[styles.itemRow, styles.itemRowMissing]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.itemNameMissing}>
                          No longer on this shop's menu
                        </Text>
                        <Text style={styles.itemMetaMissing}>
                          Item id: {row.menuItemId.slice(0, 8)}…
                        </Text>
                      </View>
                      <Pressable
                        style={styles.removeRowBtn}
                        onPress={() =>
                          onRemoveShopFavorites(shop.id, [row.menuItemId])
                        }
                        accessibilityRole="button"
                        accessibilityLabel="Remove this favorite"
                      >
                        <Text style={styles.removeRowText}>Remove</Text>
                      </Pressable>
                    </View>
                  );
                }

                const item = row.menuItem;
                const qty = qtyInCart(item);
                return (
                  <View key={item.id} style={styles.itemRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.itemName} numberOfLines={2}>
                        {item.name}
                      </Text>
                      <Text style={styles.itemPack}>{item.packLabel}</Text>
                      <View style={{ marginTop: 4 }}>
                        <Price value={item.price} mrp={item.mrp} size="sm" />
                      </View>
                    </View>
                    <View style={styles.itemControls}>
                      <FavoriteHeart
                        shopId={shop.id}
                        menuItemId={item.id}
                        size={20}
                      />
                      {!shop.isOpen ? (
                        <Text style={styles.outOfStock}>Closed</Text>
                      ) : qty === 0 ? (
                        <Pressable
                          onPress={() => onAdd(item, shop)}
                          style={styles.addBtn}
                          accessibilityRole="button"
                          accessibilityLabel={`Add ${item.name} to cart`}
                        >
                          <Text style={styles.addBtnText}>ADD</Text>
                        </Pressable>
                      ) : (
                        <QuantityStepper
                          value={qty}
                          onIncrement={() =>
                            increment(item.productId ?? item.id)
                          }
                          onDecrement={() =>
                            decrement(item.productId ?? item.id)
                          }
                        />
                      )}
                    </View>
                  </View>
                );
              })}
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  loaderWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  shopCard: {
    backgroundColor: colors.bg,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  shopCardUnavailable: {
    backgroundColor: colors.surface,
    borderStyle: 'dashed',
  },
  shopHeader: { ...typography.h3, marginBottom: spacing.sm },
  shopHeaderUnavailable: {
    ...typography.h3,
    color: colors.textSecondary,
  },
  shopHeaderSub: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.md,
  },
  itemRowMissing: { opacity: 0.7 },
  itemName: { ...typography.body, fontWeight: '600' },
  itemNameMissing: {
    ...typography.body,
    color: colors.textSecondary,
    fontStyle: 'italic',
  },
  itemPack: { ...typography.caption, marginTop: 2 },
  itemMetaMissing: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
  },
  itemControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  outOfStock: {
    ...typography.caption,
    color: colors.danger,
    fontWeight: '600',
  },
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
  removeAllBtn: {
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radii.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    alignSelf: 'flex-start',
  },
  removeAllText: {
    ...typography.bodyBold,
    color: colors.danger,
  },
  removeRowBtn: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  removeRowText: {
    ...typography.caption,
    color: colors.danger,
    fontWeight: '600',
  },
});
