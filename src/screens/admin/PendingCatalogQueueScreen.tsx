/**
 * PR-NEXT-BUNDLE-K §G — PendingCatalogQueueScreen.
 *
 * Admin screen listing proposed catalog items awaiting review.
 * For each item the admin taps Approve or Reject (with reason).
 * Calls `reviewPendingCatalogItem` then refreshes the list.
 *
 * Auth: admin claim required — gated by the callable itself
 * (server enforces; this screen is only reachable from the admin
 * section of HomeScreen / ShopManagement tiles).
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { colors, radii, spacing, typography } from '../../constants/theme';
import { orderService } from '../../services/orderService';
import type { MasterProduct } from '../../types';
import type { RootStackParamList } from '../../navigation/AppNavigator';

type NavProp = NativeStackNavigationProp<RootStackParamList>;

type ReviewState =
  | { mode: 'idle' }
  | { mode: 'rejecting'; productId: string; reason: string };

export default function PendingCatalogQueueScreen() {
  const navigation = useNavigation<NavProp>();

  const [items, setItems] = useState<MasterProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [reviewState, setReviewState] = useState<ReviewState>({ mode: 'idle' });
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadItems = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const result = await orderService.listPendingCatalogItems({ limit: 50 });
      setItems(result.items as MasterProduct[]);
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Could not load items');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  async function handleApprove(productId: string) {
    setActionLoading(productId);
    try {
      await orderService.reviewPendingCatalogItem({ productId, action: 'approved' });
      setItems(prev => prev.filter(i => i.id !== productId));
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Could not approve');
    } finally {
      setActionLoading(null);
    }
  }

  function handleStartReject(productId: string) {
    setReviewState({ mode: 'rejecting', productId, reason: '' });
  }

  async function handleConfirmReject() {
    if (reviewState.mode !== 'rejecting') return;
    const { productId, reason } = reviewState;
    if (!reason.trim()) {
      Alert.alert('Reason required', 'Please enter a rejection reason.');
      return;
    }
    setActionLoading(productId);
    setReviewState({ mode: 'idle' });
    try {
      await orderService.reviewPendingCatalogItem({
        productId,
        action: 'rejected',
        rejectionReason: reason.trim(),
      });
      setItems(prev => prev.filter(i => i.id !== productId));
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Could not reject');
    } finally {
      setActionLoading(null);
    }
  }

  function formatDate(ms: number | null | undefined): string {
    if (!ms) return '—';
    return new Date(ms).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }

  function renderItem({ item }: { item: MasterProduct }) {
    const busy = actionLoading === item.id;
    return (
      <View style={styles.card}>
        <View style={styles.cardBody}>
          <Text style={styles.itemName}>{item.name}</Text>
          {item.brand ? (
            <Text style={styles.itemBrand}>{item.brand}</Text>
          ) : null}
          <View style={styles.metaRow}>
            <Text style={styles.metaText}>
              {item.category.replace(/_/g, ' ')} ·{' '}
              {item.packSize
                ? `${item.packSize.value}${item.packSize.unit}`
                : '—'}{' '}
              · MRP ₹{item.mrp}
            </Text>
          </View>
          <Text style={styles.proposedText}>
            Proposed {formatDate(item.proposedAt)}
          </Text>
        </View>

        <View style={styles.cardActions}>
          {busy ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <>
              <Pressable
                style={[styles.actionBtn, styles.approveBtn]}
                onPress={() => handleApprove(item.id)}
              >
                <Text style={styles.approveBtnText}>✓ Approve</Text>
              </Pressable>
              <Pressable
                style={[styles.actionBtn, styles.rejectBtn]}
                onPress={() => handleStartReject(item.id)}
              >
                <Text style={styles.rejectBtnText}>✗ Reject</Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Loading queue…</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Pending Catalog Items</Text>
      </View>

      {/* Summary */}
      {items.length > 0 && (
        <View style={styles.summaryBar}>
          <Text style={styles.summaryText}>
            {items.length} item{items.length !== 1 ? 's' : ''} awaiting review
          </Text>
        </View>
      )}

      <FlatList
        data={items}
        keyExtractor={i => i.id}
        renderItem={renderItem}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadItems(true)}
            tintColor={colors.primary}
          />
        }
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyIcon}>✅</Text>
            <Text style={styles.emptyText}>No pending items</Text>
          </View>
        }
      />

      {/* Reject reason modal */}
      {reviewState.mode === 'rejecting' && (
        <View style={styles.rejectOverlay}>
          <View style={styles.rejectCard}>
            <Text style={styles.rejectTitle}>Rejection Reason</Text>
            <TextInput
              style={styles.rejectInput}
              value={reviewState.reason}
              onChangeText={r =>
                setReviewState({ mode: 'rejecting', productId: reviewState.productId, reason: r })
              }
              placeholder="e.g. Duplicate item, incorrect category…"
              multiline
              autoFocus
            />
            <View style={styles.rejectActions}>
              <Pressable
                style={[styles.actionBtn, styles.cancelBtn]}
                onPress={() => setReviewState({ mode: 'idle' })}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.actionBtn, styles.rejectBtn]}
                onPress={handleConfirmReject}
              >
                <Text style={styles.rejectBtnText}>Confirm Reject</Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  loadingText: { ...typography.body, color: colors.textSecondary },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: 50,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: { padding: spacing.sm },
  backText: { ...typography.body, color: colors.info },
  headerTitle: { ...typography.h2, flex: 1, textAlign: 'center' },
  summaryBar: {
    backgroundColor: colors.surface,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  summaryText: { ...typography.caption, color: colors.textSecondary },
  list: { paddingBottom: 40 },
  card: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  cardBody: { marginBottom: spacing.sm },
  itemName: { ...typography.bodyBold },
  itemBrand: { ...typography.caption, color: colors.textSecondary },
  metaRow: { marginTop: 2 },
  metaText: { ...typography.caption, color: colors.textMuted },
  proposedText: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  cardActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actionBtn: {
    flex: 1,
    borderRadius: radii.sm,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  approveBtn: { backgroundColor: colors.primary },
  approveBtnText: { ...typography.caption, color: colors.bg, fontWeight: '700' },
  rejectBtn: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  rejectBtnText: { ...typography.caption, color: colors.danger, fontWeight: '700' },
  cancelBtn: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  cancelBtnText: { ...typography.caption, color: colors.textPrimary },
  emptyWrap: { padding: spacing.xxl, alignItems: 'center', gap: spacing.md },
  emptyIcon: { fontSize: 48 },
  emptyText: { ...typography.body, color: colors.textSecondary },
  rejectOverlay: {
    position: 'absolute',
    inset: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  rejectCard: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    padding: spacing.xl,
    gap: spacing.md,
  },
  rejectTitle: { ...typography.h2 },
  rejectInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    padding: spacing.md,
    ...typography.body,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  rejectActions: { flexDirection: 'row', gap: spacing.md },
});
