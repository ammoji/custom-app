import { useFocusEffect, useNavigation } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Alert,
    FlatList,
    Image,
    Pressable,
    RefreshControl,
    StyleSheet,
    Switch,
    Text,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Button from '../../components/common/Button';
import EmptyState from '../../components/common/EmptyState';
import Loader from '../../components/common/Loader';
import ScreenHeader from '../../components/common/ScreenHeader';
import { CATEGORIES, CategoryId } from '../../constants/categories';
import { colors, radii, shadow, spacing, typography } from '../../constants/theme';
// PR 3 — concurrency cleanup. authService used to refresh claims
// when the server says permission-denied (role was revoked).
import { authService } from '../../services/authService';
import { orderService } from '../../services/orderService';
import { useAuthStore } from '../../store/useAuthStore';
import type { MenuItem } from '../../types';
import { formatRupees } from '../../utils/format';
import { handleRoleAuthError } from '../../utils/handleRoleAuthError';

type Filter = 'all' | 'available' | 'unavailable' | 'custom';

const CATEGORY_LABEL: Record<string, string> = CATEGORIES.reduce(
  (acc, c) => {
    acc[c.id] = c.label;
    return acc;
  },
  {} as Record<string, string>,
);

/**
 * Shop owner's menu management screen. Pulls listMyShopMenu on focus
 * (re-fetches every time the user navigates back from edit/add) and
 * groups items by category. Availability toggle is optimistic — the
 * UI flips first, then we call updateMenuItem; on failure we revert.
 *
 * Filter chips let the owner narrow to available-only / unavailable /
 * custom-only without leaving the screen. Tapping a card navigates
 * to the edit screen for full field editing.
 */
export default function ShopMenuScreen() {
  const nav = useNavigation<any>();
  const isShopOwner = useAuthStore(s => s.isShopOwner);
  const shopId = useAuthStore(s => s.shopId);

  // PR 3 — concurrency cleanup (item 2). Surface fetch errors so a
  // shop owner doesn't see an empty menu list and start re-adding
  // duplicates of items they think disappeared. Banner mirrors the
  // AdminOrders / Customer Orders shape.
  const setUser = useAuthStore(s => s.setUser);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchOnce = useCallback(async () => {
    try {
      const list = await orderService.listMyShopMenu();
      setItems(list);
      setError(null);
    } catch (e: any) {
      console.warn('[ShopMenu] fetch failed:', e);
      // PR 3 — if the failure looks like a revoked claim, refresh
      // auth so the role-guard EmptyState above takes over on the
      // next render. Otherwise surface a banner + Retry.
      const wasRevocation = await handleRoleAuthError(
        e,
        authService.refreshClaims,
        setUser,
      );
      if (!wasRevocation) {
        // Don't collapse `items` to [] — keep stale-but-correct
        // data on screen so a transient blip doesn't make the
        // owner think their menu is empty.
        setError(e?.message || "Couldn't load menu. Tap Retry.");
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [setUser]);

  // Refetch on every focus so edits made elsewhere show up.
  useFocusEffect(
    useCallback(() => {
      if (!isShopOwner || !shopId) return;
      fetchOnce();
    }, [isShopOwner, shopId, fetchOnce]),
  );

  // Initial load if focus didn't fire (web SDK quirks).
  useEffect(() => {
    if (!isShopOwner || !shopId) {
      setLoading(false);
      return;
    }
    fetchOnce();
  }, [isShopOwner, shopId, fetchOnce]);

  const visibleItems = useMemo(() => {
    switch (filter) {
      case 'available':
        return items.filter(i => i.available);
      case 'unavailable':
        return items.filter(i => !i.available);
      case 'custom':
        return items.filter(i => i.isCustom);
      default:
        return items;
    }
  }, [items, filter]);

  // Build a flat list with category headers as inert rows so a
  // single FlatList can render section titles without sectioning
  // (avoiding SectionList's stickyHeader perf cost).
  const rows = useMemo(() => {
    const grouped: Record<string, MenuItem[]> = {};
    visibleItems.forEach(i => {
      (grouped[i.category] ??= []).push(i);
    });
    const out: Array<{ kind: 'header'; category: CategoryId } | { kind: 'item'; item: MenuItem }> = [];
    CATEGORIES.forEach(c => {
      const list = grouped[c.id];
      if (!list || list.length === 0) return;
      out.push({ kind: 'header', category: c.id });
      list.forEach(item => out.push({ kind: 'item', item }));
    });
    // Items with an unknown category fall here — defensive, shouldn't
    // happen in practice because addCustomMenuItem validates category.
    Object.entries(grouped).forEach(([cat, list]) => {
      if (CATEGORY_LABEL[cat]) return;
      out.push({ kind: 'header', category: cat as CategoryId });
      list.forEach(item => out.push({ kind: 'item', item }));
    });
    return out;
  }, [visibleItems]);

  const handleToggleAvailable = async (item: MenuItem) => {
    const next = !item.available;
    // Optimistic flip.
    setItems(prev =>
      prev.map(i => (i.id === item.id ? { ...i, available: next } : i)),
    );
    setTogglingId(item.id);
    try {
      await orderService.updateMenuItem({
        menuItemId: item.id,
        fields: { available: next },
      });
    } catch (e: any) {
      // Revert on failure.
      setItems(prev =>
        prev.map(i =>
          i.id === item.id ? { ...i, available: item.available } : i,
        ),
      );
      Alert.alert(
        'Update failed',
        e?.message || 'Could not update availability. Try again.',
      );
    } finally {
      setTogglingId(null);
    }
  };

  if (!isShopOwner || !shopId) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="Menu" onBack={() => nav.goBack()} />
        <EmptyState
          title="Shop owner access required"
          subtitle="Open a shop to manage its menu."
        />
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="Menu" onBack={() => nav.goBack()} />
        <Loader fullScreen />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader
        title={`Menu (${items.length})`}
        onBack={() => nav.goBack()}
      />
      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable
            onPress={() => {
              setLoading(true);
              fetchOnce();
            }}
            style={styles.retryBtn}
            accessibilityRole="button"
            accessibilityLabel="Retry loading menu"
          >
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      )}
      <View style={styles.toolbar}>
        <View style={styles.filterRow}>
          {(['all', 'available', 'unavailable', 'custom'] as Filter[]).map(f => (
            <FilterChip
              key={f}
              label={
                f === 'all'
                  ? 'All'
                  : f === 'available'
                    ? 'Available'
                    : f === 'unavailable'
                      ? 'Unavailable'
                      : 'Custom'
              }
              active={filter === f}
              onPress={() => setFilter(f)}
            />
          ))}
        </View>
        <View style={styles.addBtn}>
          <Button
            title="+ Add custom item"
            onPress={() => nav.navigate('AddCustomMenuItem')}
            variant="secondary"
          />
        </View>
      </View>

      <FlatList
        data={rows}
        keyExtractor={(row, i) =>
          row.kind === 'header' ? `h-${row.category}-${i}` : `i-${row.item.id}`
        }
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              fetchOnce();
            }}
          />
        }
        ListEmptyComponent={
          // Suppress the "Add your first item" CTA when an error is
          // visible — the banner already tells the owner what's
          // wrong; we don't want to push them to add duplicates.
          error ? (
            <EmptyState
              title="Couldn't load menu"
              subtitle="Tap Retry above when your connection is back."
            />
          ) : (
            <EmptyState
              title={
                filter === 'all'
                  ? 'No menu items yet'
                  : `No ${filter} items`
              }
              subtitle={
                filter === 'all'
                  ? "Tap 'Add custom item' to add your first product."
                  : 'Try a different filter.'
              }
            />
          )
        }
        renderItem={({ item: row }) => {
          if (row.kind === 'header') {
            return (
              <Text style={styles.sectionHeader}>
                {CATEGORY_LABEL[row.category] ?? row.category}
              </Text>
            );
          }
          const item = row.item;
          return (
            <Pressable
              style={[styles.card, !item.available && styles.cardDisabled]}
              onPress={() =>
                nav.navigate('ShopMenuItemEdit', { menuItemId: item.id })
              }
              accessibilityRole="button"
              accessibilityLabel={`Edit ${item.name}`}
            >
              <Image source={{ uri: item.imageUrl }} style={styles.image} />
              <View style={{ flex: 1 }}>
                <View style={styles.headerRow}>
                  <Text style={styles.name} numberOfLines={2}>
                    {item.name}
                  </Text>
                  {item.isCustom && (
                    <View style={styles.customBadge}>
                      <Text style={styles.customBadgeText}>Custom</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.pack}>{item.packLabel}</Text>
                <View style={styles.priceRow}>
                  <Text style={styles.price}>{formatRupees(item.price)}</Text>
                  {item.mrp > item.price && (
                    <Text style={styles.mrp}>{formatRupees(item.mrp)}</Text>
                  )}
                </View>
                <Text style={styles.stock}>
                  {item.stock === null
                    ? 'Stock: unlimited'
                    : `Stock: ${item.stock}`}
                </Text>
              </View>
              <View style={styles.toggleColumn}>
                <Switch
                  value={item.available}
                  onValueChange={() => handleToggleAvailable(item)}
                  disabled={togglingId === item.id}
                />
                <Text style={styles.toggleLabel}>
                  {item.available ? 'On' : 'Off'}
                </Text>
              </View>
            </Pressable>
          );
        }}
      />
    </SafeAreaView>
  );
}

function FilterChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, active && styles.chipActive]}
      accessibilityRole="button"
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  toolbar: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  filterRow: { flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  chipActive: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  chipText: { ...typography.caption, color: colors.textSecondary, fontWeight: '600' },
  chipTextActive: { color: colors.primaryDark },
  addBtn: {},
  list: { padding: spacing.lg, paddingBottom: spacing.xxl },
  sectionHeader: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  card: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
    marginBottom: spacing.sm,
    ...shadow.card,
  },
  cardDisabled: { opacity: 0.55 },
  image: {
    width: 64,
    height: 64,
    borderRadius: radii.sm,
    backgroundColor: colors.bg,
  },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
  name: { ...typography.bodyBold, flex: 1 },
  customBadge: {
    backgroundColor: colors.primaryLight,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: radii.sm,
  },
  customBadgeText: { ...typography.caption, color: colors.primaryDark, fontWeight: '700' },
  pack: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, marginTop: spacing.xs },
  price: { ...typography.bodyBold },
  mrp: {
    ...typography.caption,
    color: colors.mrpStrike,
    textDecorationLine: 'line-through',
  },
  stock: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  toggleColumn: { alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
  toggleLabel: { ...typography.caption, color: colors.textSecondary },
  // PR 3 — error banner. Same shape across all dashboards.
  errorBanner: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    padding: spacing.md,
    backgroundColor: '#FEF2F2',
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
});
