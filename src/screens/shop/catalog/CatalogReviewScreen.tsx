/**
 * PR-NEXT-BUNDLE-K §E — CatalogReviewScreen.
 *
 * Shows the owner a list of all their draft priced items
 * (accumulated across categories during the browse session).
 * The owner can:
 *   - Edit a price inline
 *   - Remove a draft
 *   - Tap "Add N items to menu" → calls commitShopMenuItemsBulk
 *
 * Uses `partitionDraftsForBulkCommit` to split ready vs missing-price
 * before submission so the server never sees a 0-price item.
 */

import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { colors, radii, spacing, typography } from '../../../constants/theme';
import { orderService } from '../../../services/orderService';
import type { PriceDraft } from '../../../types';
import type { RootStackParamList } from '../../../navigation/AppNavigator';
import { partitionDraftsForBulkCommit } from '../../../utils/catalogBrowseHelpers';

type ScreenRoute = RouteProp<RootStackParamList, 'CatalogReview'>;
type NavProp = NativeStackNavigationProp<RootStackParamList>;

export default function CatalogReviewScreen() {
  const navigation = useNavigation<NavProp>();
  const route = useRoute<ScreenRoute>();

  const [drafts, setDrafts] = useState<PriceDraft[]>(route.params.drafts ?? []);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPrice, setEditPrice] = useState('');
  const [committing, setCommitting] = useState(false);

  const { ready, missingPrice } = partitionDraftsForBulkCommit(drafts);

  function handleEdit(draft: PriceDraft) {
    setEditingId(draft.productId);
    setEditPrice(String(draft.price > 0 ? draft.price : ''));
  }

  function handleSaveEdit(productId: string) {
    const n = parseFloat(editPrice.replace(/[^\d.]/g, ''));
    if (!Number.isFinite(n) || n <= 0) {
      Alert.alert('Invalid price', 'Please enter a valid price.');
      return;
    }
    setDrafts(prev =>
      prev.map(d =>
        d.productId === productId ? { ...d, price: Math.round(n) } : d,
      ),
    );
    setEditingId(null);
  }

  function handleRemove(productId: string) {
    setDrafts(prev => prev.filter(d => d.productId !== productId));
  }

  async function handleCommit() {
    if (ready.length === 0) {
      Alert.alert(
        'No ready items',
        'Please fill in prices for all items before committing.',
      );
      return;
    }
    setCommitting(true);
    try {
      const result = await orderService.commitShopMenuItemsBulk({
        items: ready.map(d => ({ productId: d.productId, price: d.price })),
      });
      Alert.alert(
        'Done!',
        `Added ${result.written} item${result.written !== 1 ? 's' : ''} to your menu.${
          result.skipped > 0 ? ` ${result.skipped} skipped.` : ''
        }`,
        [
          {
            text: 'OK',
            onPress: () => navigation.navigate('BuildCatalog'),
          },
        ],
      );
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Could not commit items.');
    } finally {
      setCommitting(false);
    }
  }

  function renderDraft({ item: draft }: { item: PriceDraft }) {
    const isEditing = editingId === draft.productId;
    const hasPrice = draft.price > 0;

    return (
      <View style={styles.draftRow}>
        <View style={styles.draftInfo}>
          <Text style={styles.draftName} numberOfLines={1}>
            {draft.product.name}
          </Text>
          <Text style={styles.draftPack}>
            {draft.product.packSize
              ? `${draft.product.packSize.value}${draft.product.packSize.unit}`
              : ''}
            {' · MRP ₹'}
            {draft.product.mrp}
          </Text>
        </View>

        <View style={styles.draftRight}>
          {isEditing ? (
            <View style={styles.editRow}>
              <Text style={styles.rupee}>₹</Text>
              <TextInput
                style={styles.priceInput}
                value={editPrice}
                onChangeText={setEditPrice}
                keyboardType="numeric"
                autoFocus
                returnKeyType="done"
                onSubmitEditing={() => handleSaveEdit(draft.productId)}
              />
              <Pressable
                style={styles.saveBtn}
                onPress={() => handleSaveEdit(draft.productId)}
              >
                <Text style={styles.saveBtnText}>✓</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable onPress={() => handleEdit(draft)}>
              <Text
                style={[styles.priceLabel, !hasPrice && styles.priceMissing]}
              >
                {hasPrice ? `₹${draft.price}` : '₹ —'}
              </Text>
            </Pressable>
          )}
          <Pressable
            style={styles.removeBtn}
            onPress={() => handleRemove(draft.productId)}
          >
            <Text style={styles.removeBtnText}>✕</Text>
          </Pressable>
        </View>
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
        <Text style={styles.headerTitle}>Review Items</Text>
      </View>

      {/* Summary bar */}
      <View style={styles.summaryBar}>
        <Text style={styles.summaryText}>
          {ready.length} ready · {missingPrice.length} need price
        </Text>
      </View>

      <FlatList
        data={drafts}
        keyExtractor={d => d.productId}
        renderItem={renderDraft}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyText}>No items to review. Go back and add items.</Text>
          </View>
        }
      />

      {/* Footer */}
      <View style={styles.footer}>
        {missingPrice.length > 0 && (
          <Text style={styles.warningText}>
            ⚠ {missingPrice.length} item{missingPrice.length !== 1 ? 's' : ''} missing price
            (tap price to edit)
          </Text>
        )}
        <Pressable
          style={[
            styles.commitBtn,
            (committing || ready.length === 0) && styles.commitBtnDisabled,
          ]}
          onPress={handleCommit}
          disabled={committing || ready.length === 0}
        >
          {committing ? (
            <ActivityIndicator color={colors.bg} />
          ) : (
            <Text style={styles.commitBtnText}>
              Add {ready.length} item{ready.length !== 1 ? 's' : ''} to menu
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
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
  list: { paddingBottom: 120 },
  draftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  draftInfo: { flex: 1, marginRight: spacing.md },
  draftName: { ...typography.bodyBold },
  draftPack: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  draftRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  editRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  rupee: { ...typography.bodyBold, color: colors.primary },
  priceInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    ...typography.bodyBold,
    width: 70,
    textAlign: 'right',
  },
  saveBtn: {
    backgroundColor: colors.primary,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  saveBtnText: { ...typography.bodyBold, color: colors.bg },
  priceLabel: { ...typography.bodyBold, color: colors.primary },
  priceMissing: { color: colors.danger },
  removeBtn: { padding: spacing.xs },
  removeBtnText: { ...typography.body, color: colors.danger },
  emptyWrap: { padding: spacing.xl, alignItems: 'center' },
  emptyText: { ...typography.body, color: colors.textSecondary },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: spacing.lg,
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
  warningText: { ...typography.caption, color: colors.warning },
  commitBtn: {
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  commitBtnDisabled: { opacity: 0.5 },
  commitBtnText: { ...typography.bodyBold, color: colors.bg, fontSize: 16 },
});
