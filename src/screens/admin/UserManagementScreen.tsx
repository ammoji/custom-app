import { useNavigation } from '@react-navigation/native';
import React, { useEffect, useMemo, useState } from 'react';
import {
    FlatList,
    Pressable,
    RefreshControl,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import EmptyState from '../../components/common/EmptyState';
import Loader from '../../components/common/Loader';
import ScreenHeader from '../../components/common/ScreenHeader';
import { colors, radii, shadow, spacing, typography } from '../../constants/theme';
import { orderService } from '../../services/orderService';
import { useAuthStore } from '../../store/useAuthStore';
import type { UserInfo } from '../../types';
import {
    filterAndSortUsers,
    type RoleFilter,
} from '../../utils/userListFilters';

// Inlined here (instead of imported from userListFilters) because
// VSCode's "organize imports" on save strips type-only imports
// whose only usage is inside the function body — even when those
// usages are valid (useState's generic arg, callback param). The
// shape matches `SortDir` in src/utils/userListFilters.ts exactly;
// `filterAndSortUsers` accepts this string union by structural
// type compatibility.
type SortDir = 'newest' | 'oldest';

const POLL_MS = 30_000;
const SEARCH_DEBOUNCE_MS = 250;

const ROLE_CHIPS: { label: string; value: RoleFilter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Admin', value: 'admin' },
  { label: 'Shop owner', value: 'shopOwner' },
  { label: 'Delivery', value: 'delivery' },
  { label: 'Customer', value: 'customer' },
];

/**
 * Admin user list. Polls listAllUsers every 30s. Tap a row to open
 * UserDetailScreen with revoke/suspend actions. Filter by phone is
 * client-side because we cap at 100 users; pagination + server-side
 * search are tracked in the prelaunch checklist.
 */
export default function UserManagementScreen() {
  const nav = useNavigation<any>();
  const isAdmin = useAuthStore(s => s.isAdmin);
  const myUid = useAuthStore(s => s.uid);

  const [users, setUsers] = useState<UserInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Phase 12c additions:
  //   - filter: raw input string (re-renders on every keystroke)
  //   - debouncedFilter: lagged copy that drives the actual list
  //     filter, so a fast-typed phone doesn't re-render the list
  //     on every character (250ms debounce per spec).
  //   - role: chip selection (admin/shopOwner/delivery/customer/all)
  //   - sortDir: 'newest' | 'oldest' by lastSignInAt (recency)
  const [filter, setFilter] = useState('');
  const [debouncedFilter, setDebouncedFilter] = useState('');
  const [role, setRole] = useState<RoleFilter>('all');
  const [sortDir, setSortDir] = useState<SortDir>('newest');

  // Trailing-edge debounce: latest value wins after 250ms of
  // inactivity. Resets the timer on each keystroke.
  useEffect(() => {
    const handle = setTimeout(
      () => setDebouncedFilter(filter),
      SEARCH_DEBOUNCE_MS,
    );
    return () => clearTimeout(handle);
  }, [filter]);

  const fetchOnce = async () => {
    try {
      const list = await orderService.listAllUsers();
      setUsers(list);
    } catch (e) {
      console.warn('[UserManagement] fetch failed:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    fetchOnce();
    const interval = setInterval(fetchOnce, POLL_MS);
    return () => clearInterval(interval);
  }, [isAdmin]);

  // filterAndSortUsers is the pinned pure helper. After it runs, we
  // re-pin "self" to the top regardless of role/sort — admins should
  // always be able to find their own profile in one glance.
  const visible = useMemo(() => {
    const sorted = filterAndSortUsers(users, role, sortDir, debouncedFilter);
    if (!myUid) return sorted;
    const selfIdx = sorted.findIndex(u => u.uid === myUid);
    if (selfIdx <= 0) return sorted;
    const self = sorted[selfIdx];
    return [self, ...sorted.slice(0, selfIdx), ...sorted.slice(selfIdx + 1)];
  }, [users, role, sortDir, debouncedFilter, myUid]);

  if (!isAdmin) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="User management" onBack={() => nav.goBack()} />
        <EmptyState
          title="Admin only"
          subtitle="You don't have permission to view all users."
        />
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="User management" onBack={() => nav.goBack()} />
        <Loader fullScreen />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader
        title={`Users (${users.length})`}
        onBack={() => nav.goBack()}
      />
      <View style={styles.searchWrap}>
        <TextInput
          value={filter}
          onChangeText={setFilter}
          placeholder="Search by phone or uid"
          placeholderTextColor={colors.textSecondary}
          style={styles.search}
          autoCorrect={false}
          autoCapitalize="none"
        />
      </View>
      <View style={styles.roleRow}>
        {ROLE_CHIPS.map(c => {
          const active = role === c.value;
          return (
            <Pressable
              key={c.value}
              onPress={() => setRole(c.value)}
              style={[styles.roleChip, active && styles.roleChipActive]}
              accessibilityRole="button"
              accessibilityLabel={`Filter by ${c.label}`}
            >
              <Text
                style={[
                  styles.roleChipText,
                  active && styles.roleChipTextActive,
                ]}
              >
                {c.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.sortRow}>
        <Text style={styles.sortLabel}>Sort by recency</Text>
        <Pressable
          onPress={() =>
            setSortDir((d: SortDir) => (d === 'newest' ? 'oldest' : 'newest'))
          }
          accessibilityRole="button"
          accessibilityLabel={`Toggle sort, currently ${sortDir} first`}
        >
          <Text style={styles.sortLink}>
            {sortDir === 'newest' ? 'Newest first ↓' : 'Oldest first ↑'}
          </Text>
        </Pressable>
      </View>
      <FlatList
        data={visible}
        keyExtractor={u => u.uid}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        ListEmptyComponent={
          <EmptyState
            title="No users match"
            subtitle={
              filter
                ? `Nothing matched "${filter}"`
                : 'No users yet.'
            }
          />
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              fetchOnce();
            }}
          />
        }
        renderItem={({ item }) => {
          const isSelf = item.uid === myUid;
          return (
            <Pressable
              style={[styles.row, isSelf && styles.rowSelf]}
              onPress={() => nav.navigate('UserDetail', { uid: item.uid })}
              accessibilityRole="button"
              accessibilityLabel={`Open user ${item.phoneNumber ?? item.uid}`}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.phone}>
                  {item.phoneNumber ?? '(no phone)'}
                  {isSelf ? '  · You' : ''}
                </Text>
                <Text style={styles.uid} numberOfLines={1}>
                  {item.uid}
                </Text>
                <View style={styles.chips}>
                  {item.isAdmin && <Chip label="Admin" tone="admin" />}
                  {item.isShopOwner && (
                    <Chip label="Shop owner" tone="owner" />
                  )}
                  {item.isDelivery && (
                    <Chip label="Delivery" tone="delivery" />
                  )}
                  {!item.isAdmin &&
                    !item.isShopOwner &&
                    !item.isDelivery && (
                      <Chip label="Customer" tone="customer" />
                    )}
                  {item.isAnonymous && (
                    <Chip label="Anonymous" tone="muted" />
                  )}
                </View>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          );
        }}
      />
    </SafeAreaView>
  );
}

function Chip({
  label,
  tone,
}: {
  label: string;
  tone: 'admin' | 'owner' | 'delivery' | 'customer' | 'muted';
}) {
  return (
    <View style={[styles.chip, styles[`chip_${tone}`]]}>
      <Text style={[styles.chipText, styles[`chipText_${tone}`]]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  searchWrap: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  search: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 40,
    ...typography.body,
    color: colors.textPrimary,
  },
  roleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  roleChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  roleChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  roleChipText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  roleChipTextActive: { color: '#fff' },
  sortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  sortLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '700',
  },
  sortLink: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '700',
  },
  list: { padding: spacing.lg, paddingTop: 0, paddingBottom: spacing.xxl, flexGrow: 1 },
  row: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    ...shadow.card,
  },
  rowSelf: { borderColor: colors.primary, borderWidth: 2 },
  phone: { ...typography.bodyBold },
  uid: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  chip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.sm,
  },
  chipText: { ...typography.caption, fontWeight: '700' },
  chip_admin: { backgroundColor: colors.primaryDark },
  chipText_admin: { color: '#fff' },
  chip_owner: { backgroundColor: colors.primaryLight },
  chipText_owner: { color: colors.primaryDark },
  chip_delivery: { backgroundColor: colors.info + '22' },
  chipText_delivery: { color: colors.info },
  chip_customer: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border },
  chipText_customer: { color: colors.textSecondary },
  chip_muted: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border },
  chipText_muted: { color: colors.textSecondary, fontStyle: 'italic' },
  chevron: { ...typography.h2, color: colors.textSecondary },
});
