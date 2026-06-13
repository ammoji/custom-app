/**
 * PR-NEXT-BUNDLE-K §C — CategoryBrowseScreen.
 *
 * Shop owner browses approved master catalog items one at a time
 * (per category). For each item they either:
 *   - Swipe right / tap ✓  → sets a price (via VoicePriceCapture or
 *                             inline numeric input) and adds a draft
 *   - Swipe left  / tap ✗  → skips the item for this session
 *
 * Drafts are held in parent state (BuildCatalogScreen via route
 * params callback) until the owner taps "Review & Add" which
 * navigates to CatalogReviewScreen.
 *
 * Gesture: react-native-gesture-handler PanGestureHandler tracks
 * horizontal swipe; threshold ±80px triggers action.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  GestureHandlerRootView,
  PanGestureHandler,
  type PanGestureHandlerGestureEvent,
} from 'react-native-gesture-handler';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { CATEGORIES } from '../../../constants/categories';
import { colors, radii, spacing, typography } from '../../../constants/theme';
import { orderService } from '../../../services/orderService';
import type { MasterProduct, PriceDraft } from '../../../types';
import type { RootStackParamList } from '../../../navigation/AppNavigator';
import VoicePriceCapture from '../../../components/catalog/VoicePriceCapture';
import { deriveCardAction, formatPackLabel } from '../../../utils/catalogBrowseHelpers';

type ScreenRoute = RouteProp<RootStackParamList, 'CategoryBrowse'>;
type NavProp = NativeStackNavigationProp<RootStackParamList>;

const SWIPE_THRESHOLD = 80;

export default function CategoryBrowseScreen() {
  const navigation = useNavigation<NavProp>();
  const route = useRoute<ScreenRoute>();
  const { categoryId, existingDrafts, onDraftsUpdated } = route.params;

  const categoryLabel =
    CATEGORIES.find(c => c.id === categoryId)?.label ?? categoryId;

  // ── State ──────────────────────────────────────────────────────────────────
  const [items, setItems] = useState<MasterProduct[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [processedIds] = useState<Set<string>>(() => new Set());
  const [drafts, setDrafts] = useState<PriceDraft[]>(existingDrafts ?? []);
  const [voiceVisible, setVoiceVisible] = useState(false);
  const [inlinePrice, setInlinePrice] = useState('');
  const [priceInputVisible, setPriceInputVisible] = useState(false);

  // ── Swipe animation ────────────────────────────────────────────────────────
  const translateX = useRef(new Animated.Value(0)).current;
  const cardOpacity = useRef(new Animated.Value(1)).current;

  // ── Load initial page ──────────────────────────────────────────────────────
  useEffect(() => {
    void loadPage(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryId]);

  const loadPage = useCallback(async (cur: string | null) => {
    try {
      const result = await orderService.listMasterCatalogByCategory({
        category: categoryId,
        cursor: cur,
        pageSize: 50,
      });
      if (cur === null) {
        setItems(result.items as MasterProduct[]);
        setCurrentIdx(0);
      } else {
        setItems(prev => [...prev, ...(result.items as MasterProduct[])]);
      }
      setHasMore(result.hasMore);
      setCursor(result.cursor);
    } catch (e: unknown) {
      Alert.alert(
        'Error',
        e instanceof Error ? e.message : 'Could not load catalog',
      );
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [categoryId]);

  const currentItem: MasterProduct | null = items[currentIdx] ?? null;

  // ── Advance to next unprocessed item ──────────────────────────────────────
  function advanceCard() {
    Animated.parallel([
      Animated.timing(translateX, { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.timing(cardOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();

    let next = currentIdx + 1;
    while (next < items.length && processedIds.has(items[next].id)) next++;

    if (next < items.length) {
      setCurrentIdx(next);
    } else if (hasMore && !loadingMore) {
      setLoadingMore(true);
      void loadPage(cursor);
      setCurrentIdx(next);
    } else {
      // Done with this category
      onDraftsUpdated?.(drafts);
      navigation.goBack();
    }
  }

  // ── Swipe handler ──────────────────────────────────────────────────────────
  const onGestureEvent = Animated.event<PanGestureHandlerGestureEvent>(
    [{ nativeEvent: { translationX: translateX } }],
    { useNativeDriver: true },
  );

  function onHandlerStateChange({ nativeEvent }: PanGestureHandlerGestureEvent) {
    const { state, translationX } = nativeEvent as any;
    const STATE_END = 5;
    if (state !== STATE_END) return;

    const action = deriveCardAction(translationX, SWIPE_THRESHOLD);
    if (action === 'add') {
      handleAddItem();
    } else if (action === 'skip') {
      handleSkipItem();
    } else {
      // Snap back
      Animated.spring(translateX, {
        toValue: 0,
        useNativeDriver: true,
      }).start();
    }
  }

  // ── Add item (shows price picker) ─────────────────────────────────────────
  function handleAddItem() {
    if (!currentItem) return;
    setInlinePrice('');
    setPriceInputVisible(true);
  }

  function handleSkipItem() {
    if (!currentItem) return;
    processedIds.add(currentItem.id);
    advanceCard();
  }

  function confirmPrice(price: number) {
    if (!currentItem) return;
    const draft: PriceDraft = { productId: currentItem.id, price, product: currentItem };
    const updated = [...drafts.filter(d => d.productId !== currentItem.id), draft];
    setDrafts(updated);
    processedIds.add(currentItem.id);
    setPriceInputVisible(false);
    setVoiceVisible(false);
    advanceCard();
  }

  function handleInlinePriceConfirm() {
    const n = parseFloat(inlinePrice.replace(/[^\d.]/g, ''));
    if (!Number.isFinite(n) || n <= 0) {
      Alert.alert('Invalid price', 'Please enter a valid price (e.g. 45).');
      return;
    }
    confirmPrice(Math.round(n));
  }

  // ── Review button ──────────────────────────────────────────────────────────
  function handleReview() {
    if (drafts.length === 0) {
      Alert.alert('No items added', 'Swipe right on items to add them first.');
      return;
    }
    onDraftsUpdated?.(drafts);
    navigation.navigate('CatalogReview', { drafts });
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Loading catalog…</Text>
      </View>
    );
  }

  const remaining = items.length - currentIdx;

  return (
    <GestureHandlerRootView style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </Pressable>
        <Text style={styles.headerTitle}>{categoryLabel}</Text>
        {drafts.length > 0 && (
          <Pressable onPress={handleReview} style={styles.reviewBtn}>
            <Text style={styles.reviewBtnText}>Review ({drafts.length})</Text>
          </Pressable>
        )}
      </View>

      {/* Progress bar */}
      <View style={styles.progressWrap}>
        <View
          style={[
            styles.progressBar,
            { width: `${items.length > 0 ? ((currentIdx / items.length) * 100) : 0}%` },
          ]}
        />
      </View>

      {/* Card stack */}
      {currentItem ? (
        <PanGestureHandler
          onGestureEvent={onGestureEvent}
          onHandlerStateChange={onHandlerStateChange}
        >
          <Animated.View
            style={[
              styles.card,
              {
                transform: [{ translateX }],
                opacity: cardOpacity,
              },
            ]}
          >
            <Text style={styles.itemName}>{currentItem.name}</Text>
            {currentItem.brand ? (
              <Text style={styles.itemBrand}>{currentItem.brand}</Text>
            ) : null}
            <Text style={styles.itemPack}>
              {formatPackLabel(currentItem.packSize)}
            </Text>
            <Text style={styles.itemMrp}>MRP ₹{currentItem.mrp}</Text>

            <View style={styles.swipeHints}>
              <Text style={styles.swipeLeft}>← Skip</Text>
              <Text style={styles.swipeRight}>Add →</Text>
            </View>
          </Animated.View>
        </PanGestureHandler>
      ) : (
        <View style={styles.centered}>
          {loadingMore ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <Text style={styles.doneText}>All items reviewed!</Text>
          )}
        </View>
      )}

      {/* Action buttons */}
      {currentItem && !priceInputVisible && (
        <View style={styles.actionRow}>
          <Pressable
            style={[styles.actionBtn, styles.skipBtn]}
            onPress={handleSkipItem}
          >
            <Text style={styles.skipBtnText}>✗ Skip</Text>
          </Pressable>
          <Pressable
            style={[styles.actionBtn, styles.addBtn]}
            onPress={handleAddItem}
          >
            <Text style={styles.addBtnText}>✓ Add</Text>
          </Pressable>
        </View>
      )}

      {/* Inline price entry */}
      {priceInputVisible && currentItem && (
        <View style={styles.priceInputPanel}>
          <Text style={styles.pricePrompt}>Your price for {currentItem.name}:</Text>
          <View style={styles.priceRow}>
            <Text style={styles.rupeeSign}>₹</Text>
            <TextInput
              style={styles.priceField}
              value={inlinePrice}
              onChangeText={setInlinePrice}
              keyboardType="numeric"
              placeholder="e.g. 45"
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleInlinePriceConfirm}
            />
            <Pressable style={styles.voiceMicBtn} onPress={() => setVoiceVisible(true)}>
              <Text>🎙</Text>
            </Pressable>
          </View>
          <View style={styles.priceActions}>
            <Pressable
              style={[styles.actionBtn, styles.skipBtn]}
              onPress={() => setPriceInputVisible(false)}
            >
              <Text style={styles.skipBtnText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.actionBtn, styles.addBtn]}
              onPress={handleInlinePriceConfirm}
            >
              <Text style={styles.addBtnText}>Confirm</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* Remaining count */}
      {currentItem && (
        <Text style={styles.remainingText}>{remaining} items remaining</Text>
      )}

      {/* Voice price capture modal */}
      {currentItem && (
        <VoicePriceCapture
          visible={voiceVisible}
          productName={currentItem.name}
          languageCode="hi-IN"
          onConfirm={confirmPrice}
          onTypeInstead={() => {
            setVoiceVisible(false);
            setPriceInputVisible(true);
          }}
          onDismiss={() => setVoiceVisible(false)}
        />
      )}
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
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
  headerTitle: {
    ...typography.h2,
    flex: 1,
    textAlign: 'center',
    marginHorizontal: spacing.sm,
  },
  reviewBtn: {
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  reviewBtnText: { ...typography.caption, color: colors.bg, fontWeight: '700' },
  progressWrap: {
    height: 4,
    backgroundColor: colors.border,
  },
  progressBar: {
    height: 4,
    backgroundColor: colors.primary,
  },
  card: {
    margin: spacing.xl,
    padding: spacing.xl,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 200,
    justifyContent: 'center',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  itemName: { ...typography.h2, marginBottom: spacing.xs },
  itemBrand: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.xs },
  itemPack: { ...typography.bodyBold, marginBottom: spacing.xs },
  itemMrp: { ...typography.caption, color: colors.textMuted },
  swipeHints: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.xl,
  },
  swipeLeft: { ...typography.caption, color: colors.danger },
  swipeRight: { ...typography.caption, color: colors.success },
  actionRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  actionBtn: {
    flex: 1,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  skipBtn: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.danger },
  skipBtnText: { ...typography.bodyBold, color: colors.danger },
  addBtn: { backgroundColor: colors.primary },
  addBtnText: { ...typography.bodyBold, color: colors.bg },
  priceInputPanel: {
    marginHorizontal: spacing.xl,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
  },
  pricePrompt: { ...typography.bodyBold },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rupeeSign: { ...typography.h2, color: colors.primary },
  priceField: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...typography.h2,
  },
  voiceMicBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  priceActions: { flexDirection: 'row', gap: spacing.md },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  loadingText: { ...typography.body, color: colors.textSecondary },
  doneText: { ...typography.h2, color: colors.success },
  remainingText: {
    ...typography.caption,
    textAlign: 'center',
    color: colors.textMuted,
    paddingBottom: spacing.md,
  },
});
