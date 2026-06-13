/**
 * PR-NEXT-BUNDLE-K.1 §A — CategoryListScreen (table view).
 *
 * Replaces Bundle K §C's one-item-per-screen swipe deck with an
 * Excel-style scrollable table: one row per master-catalog item in
 * the category. The shop owner sets a price per row by:
 *   - typing into the inline ₹ field (numeric keypad), or
 *   - tapping the "MRP" one-tap pill (fills price = MRP), or
 *   - voice mode: tap [🎙 Start voice], read prices row by row; the
 *     focus auto-advances to the next un-priced row after each commit.
 *
 * Skipping is the default — un-priced rows simply aren't committed.
 * Save → navigates to CatalogReviewScreen (existing) with the drafts.
 *
 * All pure row/voice logic lives in src/utils/catalogBrowseHelpers.ts
 * so it is unit-tested without RN render.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { CATEGORIES } from '../../../constants/categories';
import { colors, radii, spacing, typography } from '../../../constants/theme';
import { orderService } from '../../../services/orderService';
// HOTFIX-K1 §A — DO NOT REMOVE. Catalog hides items already in the shop's
// menu; reads the menu's masterCatalogIds on mount.
import { listShopMenuMasterCatalogIds } from '../../../services/shopService';
import { useAuthStore } from '../../../store/useAuthStore';
import type { MasterProduct, PriceDraft } from '../../../types';
import type { RootStackParamList } from '../../../navigation/AppNavigator';
import VoicePriceCapture from '../../../components/catalog/VoicePriceCapture';
import {
  computeCategoryProgress,
  filterCatalogByExistingMenu,
  findFirstUnpricedRow,
  findNextUnpricedRow,
  formatPackLabel,
  mapMasterProductToRow,
  validateInlinePrice,
  type CategoryListItemRow,
} from '../../../utils/catalogBrowseHelpers';

type ScreenRoute = RouteProp<RootStackParamList, 'CategoryList'>;
type NavProp = NativeStackNavigationProp<RootStackParamList>;

const ROW_HEIGHT = 84;

export default function CategoryListScreen() {
  const navigation = useNavigation<NavProp>();
  const route = useRoute<ScreenRoute>();
  const { categoryId } = route.params;

  const categoryLabel =
    CATEGORIES.find(c => c.id === categoryId)?.label ?? categoryId;

  const shopId = useAuthStore(s => s.shopId);

  // ── State (ALL useState above conditional returns — Rule 2) ─────────────────
  const [rawItems, setRawItems] = useState<MasterProduct[]>([]);
  const [items, setItems] = useState<CategoryListItemRow[]>([]);
  // HOTFIX-K1 §A — total approved catalog items in this category BEFORE the
  // already-in-menu filter. Lets the empty state distinguish "you've added
  // everything" (catalogTotal > 0, items empty) from "category is empty".
  const [catalogTotal, setCatalogTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [priceDrafts, setPriceDrafts] = useState<Map<string, number>>(new Map());
  const [inputs, setInputs] = useState<Map<string, string>>(new Map());
  const [voiceMode, setVoiceMode] = useState(false);
  const [focusedProductId, setFocusedProductId] = useState<string | null>(null);

  const flatListRef = useRef<FlatList<CategoryListItemRow>>(null);

  // ── Load the category page once on mount ────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await orderService.listMasterCatalogByCategory({
          category: categoryId,
          pageSize: 200,
        });
        if (cancelled) return;
        const products = (result.items ?? []) as MasterProduct[];
        const allRows = products.map(mapMasterProductToRow);

        // HOTFIX-K1 §A — hide items the shop already has in its menu. The
        // catalog is a picker for NEW items only; existing items are edited
        // from ShopMenuScreen. A menu-read failure must NOT block onboarding,
        // so we fall back to showing the full catalog (explicit catch, no
        // silent swallow — Rule 5 #15).
        let existingIds = new Set<string>();
        if (shopId) {
          try {
            existingIds = await listShopMenuMasterCatalogIds(shopId);
          } catch (menuErr: unknown) {
            console.warn(
              '[CategoryList] listShopMenuMasterCatalogIds failed; showing full catalog:',
              menuErr,
            );
          }
        }
        if (cancelled) return;

        const visible = filterCatalogByExistingMenu(allRows, existingIds);
        setRawItems(products);
        setCatalogTotal(allRows.length);
        setItems(visible);
      } catch (e: unknown) {
        if (!cancelled) {
          Alert.alert(
            'Error',
            e instanceof Error ? e.message : 'Could not load catalog',
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [categoryId, shopId]);

  // ── Price commit (shared by type + MRP + voice paths) ──────────────────────
  const commitPrice = useCallback(
    (productId: string, price: number) => {
      const row = items.find(i => i.productId === productId);
      const mrp = row?.mrp ?? Number.MAX_SAFE_INTEGER;
      const check = validateInlinePrice(price, mrp);
      if (!check.ok) {
        Alert.alert('Invalid price', check.reason);
        return false;
      }
      setPriceDrafts(prev => {
        const next = new Map(prev);
        next.set(productId, Math.round(price));
        return next;
      });
      setInputs(prev => {
        const next = new Map(prev);
        next.set(productId, String(Math.round(price)));
        return next;
      });
      return true;
    },
    [items],
  );

  const handleInputChange = useCallback((productId: string, text: string) => {
    setInputs(prev => {
      const next = new Map(prev);
      next.set(productId, text);
      return next;
    });
  }, []);

  const handleInputSubmit = useCallback(
    (productId: string) => {
      const raw = inputs.get(productId) ?? '';
      const n = parseFloat(raw.replace(/[^\d.]/g, ''));
      if (!Number.isFinite(n)) {
        // Empty / cleared → remove any existing draft (treat as skip).
        setPriceDrafts(prev => {
          const next = new Map(prev);
          next.delete(productId);
          return next;
        });
        return;
      }
      commitPrice(productId, n);
    },
    [inputs, commitPrice],
  );

  const handleMrpAccept = useCallback(
    (row: CategoryListItemRow) => {
      commitPrice(row.productId, row.mrp);
    },
    [commitPrice],
  );

  const handleTapRow = useCallback((productId: string) => {
    setFocusedProductId(productId);
  }, []);

  // ── Voice orchestration (uses pure helpers) ─────────────────────────────────
  const scrollToRow = useCallback(
    (row: CategoryListItemRow) => {
      const idx = items.findIndex(i => i.productId === row.productId);
      if (idx >= 0) {
        flatListRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.3 });
      }
    },
    [items],
  );

  const handleVoiceToggle = useCallback(
    (active: boolean) => {
      setVoiceMode(active);
      if (active) {
        const first = findFirstUnpricedRow(items, priceDrafts);
        if (first) {
          setFocusedProductId(first.productId);
          scrollToRow(first);
        }
      }
    },
    [items, priceDrafts, scrollToRow],
  );

  const handlePriceCaptured = useCallback(
    (productId: string, price: number) => {
      const ok = commitPrice(productId, price);
      if (!ok) return;
      // Auto-advance to the next un-priced row (skip the one just priced).
      const next = findNextUnpricedRow(items, priceDrafts, productId);
      if (next) {
        setFocusedProductId(next.productId);
        scrollToRow(next);
      } else {
        setVoiceMode(false);
        setFocusedProductId(null);
      }
    },
    [items, priceDrafts, commitPrice, scrollToRow],
  );

  const handleSkipRow = useCallback(() => {
    if (!focusedProductId) return;
    const next = findNextUnpricedRow(items, priceDrafts, focusedProductId);
    if (next) {
      setFocusedProductId(next.productId);
      scrollToRow(next);
    } else {
      setVoiceMode(false);
      setFocusedProductId(null);
    }
  }, [focusedProductId, items, priceDrafts, scrollToRow]);

  // ── Save ─────────────────────────────────────────────────────────────────────
  const handleSave = useCallback(() => {
    if (priceDrafts.size === 0) return;
    const rawById = new Map(rawItems.map(p => [p.id, p]));
    const drafts: PriceDraft[] = [];
    for (const [productId, price] of priceDrafts.entries()) {
      const product = rawById.get(productId);
      if (product) drafts.push({ productId, price, product });
    }
    navigation.navigate('CatalogReview', { drafts });
  }, [priceDrafts, rawItems, navigation]);

  const focusedItem =
    items.find(i => i.productId === focusedProductId) ?? null;
  const progress = computeCategoryProgress(items, priceDrafts);

  // ── Render ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Loading catalog…</Text>
      </View>
    );
  }

  const saveLabel = `Save ${progress.priced} item${progress.priced !== 1 ? 's' : ''}`;

  // HOTFIX-K1 §A — nothing left to price. Either the shop already has every
  // item in this category (catalogTotal > 0 → "all added", with a Go to Menu
  // CTA) or the category is genuinely empty.
  if (items.length === 0) {
    const allAdded = catalogTotal > 0;
    return (
      <View style={styles.root}>
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Text style={styles.backText}>← Back</Text>
          </Pressable>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {categoryLabel}
          </Text>
        </View>
        <View style={styles.emptyWrap}>
          {allAdded ? (
            <>
              <Text style={styles.emptyTitle}>
                {'✓ You\u2019ve already added every item in this category to your shop.'}
              </Text>
              <Text style={styles.emptyText}>
                {'To change prices on items you already have, go to your Menu.'}
              </Text>
              <Pressable
                style={styles.goMenuBtn}
                onPress={() => navigation.navigate('ShopMenu')}
              >
                <Text style={styles.goMenuBtnText}>Go to Menu</Text>
              </Pressable>
            </>
          ) : (
            <Text style={styles.emptyText}>
              {'No items in this category yet.'}
            </Text>
          )}
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
        <Text style={styles.headerTitle} numberOfLines={1}>
          {categoryLabel} · {progress.priced}/{progress.total} priced
        </Text>
      </View>

      {/* Sticky top bar: voice + save */}
      <View style={styles.topBar}>
        <View style={styles.topBarVoice}>
          <VoicePriceCapture
            active={voiceMode}
            onActiveChange={handleVoiceToggle}
            focusedItem={focusedItem}
            onPriceCaptured={handlePriceCaptured}
            onSkipRow={handleSkipRow}
            languageCode="hi-IN"
          />
        </View>
        {progress.priced > 0 && (
          <Pressable style={styles.saveBtnTop} onPress={handleSave}>
            <Text style={styles.saveBtnTopText}>{saveLabel}</Text>
          </Pressable>
        )}
      </View>

      {/* Table */}
      <FlatList
        ref={flatListRef}
        data={items}
        keyExtractor={i => i.productId}
        getItemLayout={(_, index) => ({
          length: ROW_HEIGHT,
          offset: ROW_HEIGHT * index,
          index,
        })}
        renderItem={({ item }) => (
          <CategoryListRow
            item={item}
            draftPrice={priceDrafts.get(item.productId) ?? null}
            inputValue={inputs.get(item.productId) ?? ''}
            isFocused={focusedProductId === item.productId}
            onChangeText={handleInputChange}
            onSubmit={handleInputSubmit}
            onMrpAccept={handleMrpAccept}
            onTapRow={handleTapRow}
          />
        )}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyText}>No items in this category yet.</Text>
          </View>
        }
      />

      {/* Bottom save bar (reach when scrolled deep) */}
      {progress.priced > 0 && (
        <View style={styles.bottomBar}>
          <Pressable style={styles.saveBtnBottom} onPress={handleSave}>
            <Text style={styles.saveBtnBottomText}>{saveLabel}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

// ── Row subcomponent ───────────────────────────────────────────────────────────

type RowProps = {
  item: CategoryListItemRow;
  draftPrice: number | null;
  inputValue: string;
  isFocused: boolean;
  onChangeText: (productId: string, text: string) => void;
  onSubmit: (productId: string) => void;
  onMrpAccept: (row: CategoryListItemRow) => void;
  onTapRow: (productId: string) => void;
};

function CategoryListRow({
  item,
  draftPrice,
  inputValue,
  isFocused,
  onChangeText,
  onSubmit,
  onMrpAccept,
  onTapRow,
}: RowProps) {
  const isPriced = draftPrice !== null && draftPrice > 0;
  const [imageFailed, setImageFailed] = useState(false);

  return (
    <Pressable
      style={[
        styles.row,
        isFocused && styles.rowFocused,
        isPriced && styles.rowPriced,
      ]}
      onPress={() => onTapRow(item.productId)}
    >
      {/* Thumbnail */}
      {item.imageUrl && !imageFailed ? (
        <Image
          source={{ uri: item.imageUrl }}
          style={styles.thumb}
          onError={() => setImageFailed(true)}
        />
      ) : (
        <View style={[styles.thumb, styles.thumbFallback]}>
          <Text style={styles.thumbLetter}>
            {(item.name?.[0] ?? '?').toUpperCase()}
          </Text>
        </View>
      )}

      {/* Name + pack + MRP */}
      <View style={styles.rowInfo}>
        <Text style={styles.rowName} numberOfLines={2}>
          {item.name}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {formatPackLabel(item.packSize)} · MRP ₹{item.mrp}
        </Text>
      </View>

      {/* Price input + MRP one-tap */}
      <View style={styles.rowPriceCol}>
        <View style={styles.priceInputWrap}>
          <Text style={styles.rupee}>₹</Text>
          <TextInput
            style={styles.priceInput}
            value={inputValue}
            onChangeText={t => onChangeText(item.productId, t)}
            onSubmitEditing={() => onSubmit(item.productId)}
            onEndEditing={() => onSubmit(item.productId)}
            keyboardType="numeric"
            placeholder="—"
            placeholderTextColor={colors.textMuted}
            returnKeyType="done"
            accessibilityLabel={`Price for ${item.name}`}
          />
        </View>
        <Pressable
          style={styles.mrpPill}
          onPress={() => onMrpAccept(item)}
          accessibilityRole="button"
          accessibilityLabel={`Set price to MRP ₹${item.mrp}`}
        >
          <Text style={styles.mrpPillText}>✓ MRP</Text>
        </Pressable>
      </View>

      {/* Status check */}
      <Text style={[styles.statusCheck, isPriced && styles.statusCheckOn]}>
        {isPriced ? '✓' : ''}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
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
  headerTitle: {
    ...typography.bodyBold,
    flex: 1,
    marginHorizontal: spacing.sm,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  topBarVoice: { flex: 1 },
  saveBtnTop: {
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  saveBtnTopText: { ...typography.caption, color: colors.bg, fontWeight: '700' },
  listContent: { paddingBottom: 100 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    height: ROW_HEIGHT,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    borderLeftWidth: 3,
    borderLeftColor: 'transparent',
    gap: spacing.sm,
  },
  rowFocused: {
    borderLeftColor: colors.warning,
    backgroundColor: colors.warning + '11',
  },
  rowPriced: { borderLeftColor: colors.success },
  thumb: { width: 48, height: 48, borderRadius: radii.sm },
  thumbFallback: {
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbLetter: { ...typography.h2, color: colors.primary },
  rowInfo: { flex: 1, justifyContent: 'center' },
  rowName: { ...typography.bodyBold, fontSize: 14 },
  rowMeta: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  rowPriceCol: { alignItems: 'flex-end', gap: 4 },
  priceInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.xs,
    backgroundColor: colors.bg,
  },
  rupee: { ...typography.bodyBold, color: colors.primary },
  priceInput: {
    ...typography.bodyBold,
    width: 56,
    paddingVertical: 4,
    textAlign: 'right',
  },
  mrpPill: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 1,
  },
  mrpPillText: { ...typography.caption, color: colors.primary, fontSize: 11 },
  statusCheck: { width: 18, ...typography.bodyBold, color: 'transparent' },
  statusCheckOn: { color: colors.success },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: spacing.md,
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  saveBtnBottom: {
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  saveBtnBottomText: { ...typography.bodyBold, color: colors.bg, fontSize: 16 },
  emptyWrap: { padding: spacing.xxl, alignItems: 'center', gap: spacing.md },
  emptyTitle: {
    ...typography.h3,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  emptyText: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  goMenuBtn: {
    marginTop: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
  },
  goMenuBtnText: { ...typography.bodyBold, color: colors.bg },
});
