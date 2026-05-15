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

const POLL_MS = 30_000;

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
  const [filter, setFilter] = useState('');

  const fetchOnce = async () => {
    try {
      const list = await orderService.listAllUsers();
      // Pin self to the top so admin can find their own profile
      // quickly. Otherwise sort by createdAt desc (newest first).
      list.sort((a, b) => {
        if (a.uid === myUid) return -1;
        if (b.uid === myUid) return 1;
        return (b.createdAt ?? 0) - (a.createdAt ?? 0);
      });
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

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      u =>
        (u.phoneNumber ?? '').toLowerCase().includes(q) ||
        u.uid.toLowerCase().includes(q),
    );
  }, [users, filter]);

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
