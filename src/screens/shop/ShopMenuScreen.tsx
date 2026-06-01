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
import MenuSearchBar from '../../components/menu/MenuSearchBar';
import { CATEGORIES, CategoryId } from '../../constants/categories';
import { colors, radii, shadow, spacing, typography } from '../../constants/theme';
// PR 3 — concurrency cleanup. authService used to refresh claims
// when the server says permission-denied (role was revoked).
import { authService } from '../../services/authService';
import {
  loadMenuSearchHistory,
  saveMenuSearchHistory,
} from '../../services/menuSearchHistory';
import { orderService } from '../../services/orderService';
import { useAuthStore } from '../../store/useAuthStore';
import type { MenuItem } from '../../types';
import { formatRupees } from '../../utils/format';
import { handleRoleAuthError } from '../../utils/handleRoleAuthError';
import {
  filterMenuByQuery,
  pushToSearchHistory,
} from '../../utils/menuSearchHelpers';
// PR-NEXT-ENH-1 (finding #4 follow-up) — DO NOT REMOVE. Drives the
// smart-label bulk action bar (each button shows the count of items
// it would actually flip; no-op buttons hide entirely).
import { computeBulkAvailabilityCounts } from '../../utils/bulkAvailabilityCounts';

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
  // PR 8 Part B — multi-select state. `selectMode` flips the
  // row press handler from "navigate to edit" to "toggle
  // selection". `selectedIds` is a Set for O(1) toggle. Bulk
  // action runs against `Array.from(selectedIds)`.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  // PR-NEXT-9 (finding #6) — shopkeeper-side menu search.
  // Independent history namespace from the customer surface (see
  // menuSearchHistory.ts) so the two roles don't cross-pollute.
  const [searchQuery, setSearchQuery] = useState('');
  const [searchHistory, setSearchHistory] = useState<string[]>([]);

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

  // PR-NEXT-9 — hydrate per-(role, shopId) recent-query history.
  useEffect(() => {
    if (!shopId) return;
    loadMenuSearchHistory('shopkeeper', shopId).then(setSearchHistory);
  }, [shopId]);

  // PR-NEXT-9 — substring filter on item name. Composes BEFORE the
  // status filter so the status counts reflect what's visible.
  const queryFilteredItems = useMemo(
    () => filterMenuByQuery(items, searchQuery),
    [items, searchQuery],
  );

  const visibleItems = useMemo(() => {
    switch (filter) {
      case 'available':
        return queryFilteredItems.filter(i => i.available);
      case 'unavailable':
        return queryFilteredItems.filter(i => !i.available);
      case 'custom':
        return queryFilteredItems.filter(i => i.isCustom);
      default:
        return queryFilteredItems;
    }
  }, [queryFilteredItems, filter]);

  // PR-NEXT-9 — fire-and-forget history write on blur /
  // onSubmitEditing.
  const persistHistory = useCallback(() => {
    if (!shopId || !searchQuery.trim()) return;
    setSearchHistory(prev => {
      const next = pushToSearchHistory(prev, searchQuery);
      if (next !== prev) {
        void saveMenuSearchHistory('shopkeeper', shopId, next);
      }
      return next;
    });
  }, [shopId, searchQuery]);

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

  // PR-NEXT-ENH-1 (finding #4 follow-up) — smart bulk-action labels.
  // `bulkAvailableCount` drives the "Mark N unavailable" button
  // (those items flip down); `bulkUnavailableCount` drives
  // "Mark N available" (those flip up). Buttons whose flip-count is
  // 0 are no-ops and get hidden entirely by the render below — see
  // the bulk action bar JSX. Memoised against `items` + `selectedIds`
  // so flipping selection state doesn't pay an O(N) cost on every
  // unrelated re-render.
  const {
    availableCount: bulkAvailableCount,
    unavailableCount: bulkUnavailableCount,
  } = useMemo(
    () => computeBulkAvailabilityCounts(items, selectedIds),
    [items, selectedIds],
  );

  // PR 8 Part B — toggle a single id's selection state.
  // Don't recreate the Set on every render — only on toggle.
  const toggleSelected = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const exitSelectMode = useCallback(() => {
    setSelectMode(false);
    setSelectedIds(new Set());
  }, []);

  // PR 8 Part B — bulk action handler. Server is the gate; we
  // surface skippedCount in the success toast if non-zero so the
  // owner notices stale ids.
  const handleBulkSetAvailability = async (available: boolean) => {
    // PR-NEXT-ENH-1 (finding #4 follow-up) — send only the IDs whose
    // current state DIFFERS from the target. Pre-fix the handler
    // sent every selected id and the server re-wrote already-in-
    // target-state items to the same value (wasteful, and confused
    // the "Mark N unavailable / Mark N available" labels into
    // showing N as the total selection size instead of the actual
    // flip count). Now `idsToFlip` matches the smart-label count
    // exactly, the optimistic update touches only the items that
    // flipped, and the confirmation Alert title is correct.
    //
    // Recomputing `idsToFlip` from current `items` at click time
    // (not snapshotting from the smart-label memo) means a
    // mid-flight watcher refresh that flipped some items is
    // reflected in the actual server payload — see acceptance step
    // 10 ("Server-side no-op check").
    const idsToFlip = items
      .filter(i => selectedIds.has(i.id) && i.available !== available)
      .map(i => i.id);
    if (idsToFlip.length === 0) return;
    const verb = available ? 'available' : 'unavailable';
    Alert.alert(
      `Mark ${idsToFlip.length} item${idsToFlip.length > 1 ? 's' : ''} ${verb}?`,
      'This will update all selected items at once.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          style: available ? 'default' : 'destructive',
          onPress: async () => {
            setBulkSubmitting(true);
            try {
              const r = await orderService.bulkUpdateMenuAvailability({
                menuItemIds: idsToFlip,
                available,
              });
              // Optimistically reflect locally before the refresh
              // round-trip completes so the toggles flip immediately.
              // PR-NEXT-ENH-1 — only the items that actually flipped
              // server-side change locally; already-in-target-state
              // items in the selection are deliberately untouched.
              const flippedSet = new Set(idsToFlip);
              setItems(prev =>
                prev.map(it =>
                  flippedSet.has(it.id) ? { ...it, available } : it,
                ),
              );
              exitSelectMode();
              if (r.skippedCount > 0) {
                Alert.alert(
                  'Updated with skips',
                  `${r.updatedCount} updated, ${r.skippedCount} skipped (item may no longer exist).`,
                );
              }
              // Refresh from server so any drift surfaces.
              fetchOnce();
            } catch (e: any) {
              Alert.alert(
                'Bulk update failed',
                e?.message ?? 'Please try again.',
              );
            } finally {
              setBulkSubmitting(false);
            }
          },
        },
      ],
    );
  };

  // PR-NEXT-ENH-2 (finding #5 follow-up) — bulk soft-delete handler.
  // Mirrors `handleBulkSetAvailability`'s optimistic-update +
  // confirmation Alert + `skippedCount` surfacing pattern. Sends ALL
  // selected ids (the server idempotently skips already-deleted
  // docs via the `deletedAt != null` check, so no client-side
  // flip-filter is needed here — deletion is unconditional).
  //
  // Optimistic: drop the deleted ids from local `items` immediately
  // so the UI feels instant; the watcher / `fetchOnce` reconciles
  // on the next tick.
  //
  // The destructive verb on the Confirm button + the "Past orders
  // are unaffected" subtitle on the Alert keep shopkeepers from
  // mis-firing this action. Soft-delete makes recovery possible
  // (Firestore Console → clear `deletedAt`) but the in-app UX
  // treats it as terminal.
  const handleBulkDelete = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    Alert.alert(
      `Delete ${ids.length} item${ids.length > 1 ? 's' : ''}?`,
      'Deleted items disappear from your menu and from the customer browse path. Past orders that included these items are unaffected (the order keeps a snapshot of name + price + image).',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setBulkSubmitting(true);
            try {
              const r = await orderService.bulkRemoveMenuItems({
                menuItemIds: ids,
              });
              const deletedSet = new Set(ids);
              setItems(prev => prev.filter(it => !deletedSet.has(it.id)));
              exitSelectMode();
              if (r.skippedCount > 0) {
                Alert.alert(
                  'Deleted with skips',
                  `${r.deletedCount} deleted, ${r.skippedCount} skipped (already deleted, or item may no longer exist).`,
                );
              }
              fetchOnce();
            } catch (e: any) {
              Alert.alert(
                'Bulk delete failed',
                e?.message ?? 'Please try again.',
              );
            } finally {
              setBulkSubmitting(false);
            }
          },
        },
      ],
    );
  };

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
        title={
          selectMode
            ? `${selectedIds.size} selected`
            : `Menu (${items.length})`
        }
        onBack={() =>
          selectMode ? exitSelectMode() : nav.goBack()
        }
        right={
          selectMode ? (
            <Pressable
              onPress={exitSelectMode}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Exit selection mode"
            >
              <Text style={styles.headerDone}>Done</Text>
            </Pressable>
          ) : undefined
        }
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
      {/* PR-NEXT-9 — shopkeeper menu search bar sits ABOVE the
          status-filter chips. Search-by-name is the dominant
          intent when a shop has many items; status filtering is
          the modifier (composes via queryFilteredItems above). */}
      <MenuSearchBar
        value={searchQuery}
        onChangeText={setSearchQuery}
        onSubmit={persistHistory}
        onBlur={persistHistory}
        recents={searchHistory}
        onRecentTap={q => {
          setSearchQuery(q);
          setSearchHistory(prev => {
            const next = pushToSearchHistory(prev, q);
            if (next !== prev && shopId) {
              void saveMenuSearchHistory('shopkeeper', shopId, next);
            }
            return next;
          });
        }}
      />
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
          {/* PR 32 — AI photo-to-catalog CTA. Placed above the
              "Add custom item" row so it's the first option a shop
              owner sees when bulk-adding items; the manual form
              path stays for fixups + one-offs. Disabled in selectMode
              for consistency with the other add path. */}
          <Button
            title="📸 Scan rate-list (AI)"
            onPress={() => nav.navigate('ScanMenu')}
            disabled={selectMode}
          />
          <View style={{ height: spacing.sm }} />
          {/* PR 8 Part B — Add + Select buttons share this row.
              Select toggles selectMode; in selectMode the chips above
              still work as filters but row presses toggle selection. */}
          <View style={styles.actionRow}>
            <View style={{ flex: 1 }}>
              <Button
                title="+ Add custom item"
                onPress={() => nav.navigate('AddCustomMenuItem')}
                variant="secondary"
                disabled={selectMode}
              />
            </View>
            <View style={{ width: spacing.sm }} />
            <View style={{ flex: 1 }}>
              <Button
                title={selectMode ? 'Cancel selection' : 'Select'}
                onPress={() => {
                  if (selectMode) exitSelectMode();
                  else setSelectMode(true);
                }}
                variant="secondary"
              />
            </View>
          </View>
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
          ) : searchQuery.trim() ? (
            // PR-NEXT-9 — query-driven empty takes precedence over
            // the genuine no-items-yet copy so the shopkeeper isn't
            // pushed to add a duplicate of something that already
            // exists but is hidden behind the active filter.
            <EmptyState
              title={`No items match “${searchQuery.trim()}”`}
              subtitle="Try a shorter or different word, or clear the search."
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
          const isSelected = selectedIds.has(item.id);
          return (
            <Pressable
              style={[
                styles.card,
                !item.available && styles.cardDisabled,
                selectMode && isSelected && styles.cardSelected,
              ]}
              onPress={() => {
                if (selectMode) {
                  toggleSelected(item.id);
                } else {
                  nav.navigate('ShopMenuItemEdit', { menuItemId: item.id });
                }
              }}
              accessibilityRole="button"
              accessibilityLabel={
                selectMode
                  ? `${isSelected ? 'Deselect' : 'Select'} ${item.name}`
                  : `Edit ${item.name}`
              }
            >
              {/* PR 8 Part B — leading-edge checkbox in select mode. */}
              {selectMode && (
                <View
                  style={[
                    styles.checkbox,
                    isSelected && styles.checkboxChecked,
                  ]}
                >
                  {isSelected && <Text style={styles.checkmark}>✓</Text>}
                </View>
              )}
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
              {/* PR 8 Part B — hide the per-row Switch in select
                  mode; the bulk action bar takes over. Keeps the
                  card from accidentally toggling on a tap that's
                  meant to select. */}
              {!selectMode && (
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
              )}
            </Pressable>
          );
        }}
      />
      {/* PR 8 Part B — bottom sticky action bar. Visible only in
          selectMode; both buttons loading-disabled while a bulk
          request is in flight.

          PR-NEXT-ENH-1 (finding #4 follow-up) — instead of two
          constant-count buttons that include no-op options
          (e.g. "Mark 3 available" when all 3 selected items are
          already available), each button renders only when its
          flip-count is > 0:

            bulkAvailableCount   > 0 → show "Mark N unavailable"
            bulkUnavailableCount > 0 → show "Mark N available"

          Empty selection (both counts 0) → bar collapses to nothing
          (no empty colored strip). The header's "Done" affordance
          stays available to exit select mode. Uniform selection
          shows one full-width button; mixed selection shows the
          two side-by-side flex:1 buttons with a small spacer
          (matches the pre-PR look). */}
      {selectMode && selectedIds.size > 0 && (
        <View style={styles.bulkBar}>
          {/* PR-NEXT-ENH-1 — Row 1: smart Mark buttons. Each
              renders only when its flip-count is > 0 (uniform
              selection collapses to a single full-width button;
              mixed shows both side-by-side). The whole row hides
              when neither count is > 0 — but in practice that's
              impossible while `selectedIds.size > 0` because every
              selected item is either available or unavailable. */}
          {(bulkAvailableCount > 0 || bulkUnavailableCount > 0) && (
            <View style={styles.markRow}>
              {bulkAvailableCount > 0 && (
                <View style={{ flex: 1 }}>
                  <Button
                    title={`Mark ${bulkAvailableCount} unavailable`}
                    onPress={() => handleBulkSetAvailability(false)}
                    variant="secondary"
                    disabled={bulkSubmitting}
                    loading={bulkSubmitting}
                  />
                </View>
              )}
              {bulkAvailableCount > 0 && bulkUnavailableCount > 0 && (
                <View style={{ width: spacing.sm }} />
              )}
              {bulkUnavailableCount > 0 && (
                <View style={{ flex: 1 }}>
                  <Button
                    title={`Mark ${bulkUnavailableCount} available`}
                    onPress={() => handleBulkSetAvailability(true)}
                    disabled={bulkSubmitting}
                    loading={bulkSubmitting}
                  />
                </View>
              )}
            </View>
          )}
          {/* PR-NEXT-ENH-2 (finding #5 follow-up) — Row 2: Delete.
              Always rendered while a selection is non-empty (unlike
              the smart Mark buttons, which can both hide on no-flip
              selections — though that case is currently
              unreachable). Destructive variant flags the
              irreversible action; the Alert subtitle reassures
              shopkeepers that past orders are unaffected. */}
          <Button
            title={`Delete ${selectedIds.size} item${
              selectedIds.size > 1 ? 's' : ''
            }`}
            onPress={handleBulkDelete}
            variant="destructive"
            disabled={bulkSubmitting}
            loading={bulkSubmitting}
            fullWidth
          />
        </View>
      )}
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
  // PR 8 Part B — multi-select styles.
  actionRow: { flexDirection: 'row', alignItems: 'center' },
  cardSelected: {
    borderColor: colors.primary,
    borderWidth: 2,
    backgroundColor: colors.primaryLight,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: radii.sm,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  checkboxChecked: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  checkmark: { color: '#fff', fontWeight: '700' },
  headerDone: {
    ...typography.bodyBold,
    color: colors.primary,
  },
  // PR-NEXT-ENH-2 — bar now stacks two rows (ENH-1 mark buttons +
  // the ENH-2 destructive Delete button) so flex-column with a
  // small vertical gap. Pre-PR this was a single horizontal row.
  bulkBar: {
    flexDirection: 'column',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.sm,
    ...shadow.card,
  },
  // PR-NEXT-ENH-2 — Row 1 (the ENH-1 mark buttons) keeps the
  // pre-PR side-by-side flex:1 layout. Wrapping it in its own row
  // lets the Delete button below sit on its own full-width row.
  markRow: {
    flexDirection: 'row',
  },
});
