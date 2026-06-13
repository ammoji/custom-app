/**
 * PR-NEXT-BUNDLE-K §F — BuildCatalogScreen (onboarding hub).
 *
 * Landing screen for the catalog onboarding flow. Shows:
 *   - 10 category tiles with per-category progress (% done)
 *   - Total items added badge
 *   - "Propose custom item" link → ProposeCustomItemScreen
 *   - Reads onboardingState/catalog for persistence
 *
 * Each tile navigates to the category table view (CategoryListScreen,
 * PR-NEXT-BUNDLE-K.1) with the category ID. Saving there commits drafts
 * via CatalogReviewScreen; the hub refreshes counters on focus.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { doc, onSnapshot } from 'firebase/firestore';

import BottomSheet from '../../../components/common/BottomSheet';
import Toast from '../../../components/common/Toast';
import { CATEGORIES } from '../../../constants/categories';
import { colors, radii, spacing, typography } from '../../../constants/theme';
import { db } from '../../../services/firebase';
import { orderService } from '../../../services/orderService';
import { listShopMenuMasterCatalogIds } from '../../../services/shopService';
import type { MasterProduct, OnboardingCatalogState } from '../../../types';
import type { RootStackParamList } from '../../../navigation/AppNavigator';
// HOTFIX-K1 §A — DO NOT REMOVE. Tiles show remaining-to-add counts based
// on the shop's current menu (catalog total minus already-added items).
import {
  computeRemainingByCategory,
  mapMasterProductToRow,
  type CategoryListItemRow,
} from '../../../utils/catalogBrowseHelpers';

type NavProp = NativeStackNavigationProp<RootStackParamList>;

const CATEGORY_ICONS: Record<string, string> = {
  atta_rice_dal: '🌾',
  oil_ghee: '🫙',
  dairy_eggs: '🥛',
  bakery: '🍞',
  masala_spices: '🌶️',
  snacks_biscuits: '🍪',
  beverages: '🥤',
  personal_care: '🧴',
  household: '🧹',
  fruits_vegetables: '🥦',
};

export default function BuildCatalogScreen() {
  const navigation = useNavigation<NavProp>();

  const [onboardingState, setOnboardingState] =
    useState<OnboardingCatalogState | null>(null);
  const [menuProductIds, setMenuProductIds] = useState<Set<string>>(new Set());
  // HOTFIX-K1 §A — approved master-catalog items grouped by category, used
  // (with menuProductIds) to compute the per-tile "X to add" / "All added ✓".
  const [catalogByCategory, setCatalogByCategory] = useState<
    Map<string, CategoryListItemRow[]>
  >(new Map());
  const [loading, setLoading] = useState(true);
  const [shopId, setShopId] = useState<string | null>(null);
  // PR-NEXT-BUNDLE-L §C — paper-workflow CTAs (print blank catalog +
  // scan filled pages).
  const [printSheetVisible, setPrintSheetVisible] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [pdfProgress, setPdfProgress] = useState('');
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMsg, setToastMsg] = useState('');

  // Load shopId from auth claims (available via RNFB custom claims)
  // PR-NEXT-BUNDLE-K — DO NOT REMOVE. Dynamic import avoids web breakage.
  useEffect(() => {
    let unsubAuth: (() => void) | null = null;
    import('@react-native-firebase/auth')
      .then(({ default: auth }) => {
        unsubAuth = auth().onAuthStateChanged(user => {
          if (!user) { setLoading(false); return; }
          user.getIdTokenResult().then(tokenResult => {
            const sid = tokenResult.claims.shopId as string | undefined;
            if (sid) setShopId(sid);
            else setLoading(false);
          }).catch((e: unknown) => {
            console.warn('[BuildCatalog] getIdTokenResult failed:', e);
            setLoading(false);
          });
        });
      })
      .catch(() => setLoading(false));
    return () => { unsubAuth?.(); };
  }, []);

  // Subscribe to onboarding state doc. HOTFIX-K1 §A — best-effort only: on
  // native this Web SDK listener may never fire, so the screen no longer
  // depends on it to clear `loading` (the catalog-totals effect does that).
  // `totalAdded` falls back to `menuProductIds.size` when this stays null.
  useEffect(() => {
    if (!shopId) return;
    const ref = doc(db, `shops/${shopId}/onboardingState/catalog`);
    const unsub = onSnapshot(
      ref,
      snap => {
        if (snap.exists()) {
          setOnboardingState(snap.data() as OnboardingCatalogState);
        }
        setLoading(false);
      },
      () => setLoading(false),
    );
    return unsub;
  }, [shopId]);

  // Load menu product IDs (for progress computation). HOTFIX-K1 §A —
  // routes through the shared `listShopMenuMasterCatalogIds` service so it
  // uses the native-safe callable path (raw getDocs hangs on this RN setup).
  const loadMenuIds = useCallback(async () => {
    if (!shopId) return;
    try {
      const ids = await listShopMenuMasterCatalogIds(shopId);
      setMenuProductIds(ids);
    } catch (e: unknown) {
      // Best-effort: progress tiles degrade gracefully with stale count.
      // Log so a persistent read failure is visible in Cloud Logging.
      console.warn('[BuildCatalog] loadMenuIds failed:', e);
    }
  }, [shopId]);

  useFocusEffect(
    useCallback(() => {
      void loadMenuIds();
    }, [loadMenuIds]),
  );

  // HOTFIX-K1 §A — load approved master-catalog totals (grouped by category)
  // once. Uses the `listMasterCatalogByCategory` callable per category (the
  // same native-safe path CategoryListScreen uses) instead of a raw getDocs
  // over `products`, which hangs on this RN setup. Best-effort: tile counts
  // degrade to blank on a read failure rather than blocking the hub (explicit
  // catch + warn — Rule 5 #15).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const map = new Map<string, CategoryListItemRow[]>();
        const results = await Promise.all(
          CATEGORIES.map(async cat => {
            const res = await orderService.listMasterCatalogByCategory({
              category: cat.id,
              pageSize: 200,
            });
            return { category: cat.id, items: (res.items ?? []) as MasterProduct[] };
          }),
        );
        if (cancelled) return;
        results.forEach(({ category, items }) => {
          map.set(category, items.map(mapMasterProductToRow));
        });
        setCatalogByCategory(map);
      } catch (e: unknown) {
        console.warn('[BuildCatalog] load catalog totals failed:', e);
      } finally {
        // HOTFIX-K1 §A — resolve the loading gate here (this effect uses the
        // native-safe callable path) rather than depending solely on the
        // onboardingState `onSnapshot`, whose Web SDK listener hangs on this
        // RN setup and would otherwise leave the hub stuck on a spinner.
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const totalAdded = onboardingState?.itemsAdded ?? menuProductIds.size;

  // HOTFIX-K1 §A — per-tile remaining-to-add summary.
  const remainingByCategory = computeRemainingByCategory(
    catalogByCategory,
    menuProductIds,
  );

  function handleCategoryPress(categoryId: string) {
    // PR-NEXT-BUNDLE-K.1 — table view replaces the swipe-card browse.
    navigation.navigate('CategoryList', { categoryId });
  }

  function handleProposeCustomItem() {
    navigation.navigate('ProposeCustomItem');
  }

  // PR-NEXT-BUNDLE-L §C — generate the printable catalog PDF, then
  // hand it to the OS via Linking so the owner can print/save it.
  const handleGeneratePdf = async (scope: 'all' | 'opened') => {
    setPrintSheetVisible(false);
    setGeneratingPdf(true);
    setPdfProgress('Pulling product list…');
    try {
      const categoryIds =
        scope === 'opened' ? onboardingState?.categoriesCompleted ?? [] : [];
      setPdfProgress('Rendering pages…');
      const res = await orderService.generateCatalogPdf({ categoryIds });
      setPdfProgress('Uploading…');
      if (res.url) {
        await Linking.openURL(res.url);
        setToastMsg(
          "PDF saved. When you've filled it out, tap 'Scan filled catalog' to upload.",
        );
        setToastVisible(true);
      } else {
        Alert.alert('Could not generate PDF', 'Please try again.');
      }
    } catch (e: unknown) {
      Alert.alert(
        'Could not generate PDF',
        e instanceof Error ? e.message : 'Please try again.',
      );
    } finally {
      setGeneratingPdf(false);
      setPdfProgress('');
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <>
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
    >
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Build Your Catalog</Text>
      </View>

      {/* Summary card */}
      <View style={styles.summaryCard}>
        <Text style={styles.summaryCount}>{totalAdded}</Text>
        <Text style={styles.summaryLabel}>items added so far</Text>
        <Text style={styles.summaryHint}>
          Browse each category and set your price for items you sell
        </Text>
      </View>

      {/* Category grid */}
      <Text style={styles.sectionTitle}>Browse by Category</Text>
      <View style={styles.grid}>
        {CATEGORIES.map(cat => {
          const icon = CATEGORY_ICONS[cat.id] ?? '📦';
          const info = remainingByCategory.get(cat.id);
          const countLabel = info
            ? info.allAdded
              ? 'All added ✓'
              : `${info.remaining} to add`
            : '';
          return (
            <Pressable
              key={cat.id}
              style={({ pressed }) => [
                styles.tile,
                pressed && styles.tilePressed,
              ]}
              onPress={() => handleCategoryPress(cat.id)}
            >
              <Text style={styles.tileIcon}>{icon}</Text>
              <Text style={styles.tileLabel} numberOfLines={2}>
                {cat.label}
              </Text>
              {countLabel !== '' && (
                <Text
                  style={[
                    styles.tileCount,
                    info?.allAdded && styles.tileCountAllAdded,
                  ]}
                  numberOfLines={1}
                >
                  {countLabel}
                </Text>
              )}
            </Pressable>
          );
        })}
      </View>

      {/* PR-NEXT-BUNDLE-L §C — paper workflow */}
      <View style={styles.paperSection}>
        <Text style={styles.proposeTitle}>Prefer paper?</Text>
        <Text style={styles.proposeBody}>
          Print a blank catalog, fill in your prices by hand at leisure, then
          snap a photo of each page to upload.
        </Text>
        <Pressable
          style={[styles.paperBtn, generatingPdf && styles.paperBtnBusy]}
          onPress={() => setPrintSheetVisible(true)}
          disabled={generatingPdf}
        >
          {generatingPdf ? (
            <View style={styles.paperBtnBusyRow}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={styles.paperBtnText}>
                {pdfProgress || 'Generating…'}
              </Text>
            </View>
          ) : (
            <Text style={styles.paperBtnText}>📄 Print blank catalog</Text>
          )}
        </Pressable>
        <Pressable
          style={styles.paperBtnSecondary}
          onPress={() => navigation.navigate('ScanCatalogPages')}
        >
          <Text style={styles.paperBtnSecondaryText}>📷 Scan filled catalog</Text>
        </Pressable>
      </View>

      {/* Propose custom item */}
      <View style={styles.proposeSection}>
        <Text style={styles.proposeTitle}>{'Can\u2019t find an item?'}</Text>
        <Text style={styles.proposeBody}>
          Propose a new product for the master catalog. Our team reviews it
          within 24 hours.
        </Text>
        <Pressable style={styles.proposeBtn} onPress={handleProposeCustomItem}>
          <Text style={styles.proposeBtnText}>+ Propose Custom Item</Text>
        </Pressable>
      </View>
    </ScrollView>

    {/* PR-NEXT-BUNDLE-L §C — print scope chooser */}
    <BottomSheet
      visible={printSheetVisible}
      onClose={() => setPrintSheetVisible(false)}
      keyboardAvoid={false}
    >
      <Text style={styles.sheetTitle}>Generate a printable catalog?</Text>
      <Text style={styles.sheetBody}>
        We&apos;ll build a PDF with one page per category. Print it, write your
        prices in the boxes, then scan it back in.
      </Text>
      <Pressable
        style={styles.sheetPrimaryBtn}
        onPress={() => handleGeneratePdf('all')}
      >
        <Text style={styles.sheetPrimaryBtnText}>All categories</Text>
      </Pressable>
      <Pressable
        style={[
          styles.sheetSecondaryBtn,
          (onboardingState?.categoriesCompleted?.length ?? 0) === 0 &&
            styles.sheetBtnDisabled,
        ]}
        disabled={(onboardingState?.categoriesCompleted?.length ?? 0) === 0}
        onPress={() => handleGeneratePdf('opened')}
      >
        <Text style={styles.sheetSecondaryBtnText}>
          Only categories I&apos;ve worked on
        </Text>
      </Pressable>
    </BottomSheet>

    <Toast
      visible={toastVisible}
      message={toastMsg}
      onDismiss={() => setToastVisible(false)}
      durationMs={5000}
    />
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { paddingBottom: 40 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
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
  summaryCard: {
    margin: spacing.lg,
    padding: spacing.xl,
    backgroundColor: colors.primaryLight,
    borderRadius: radii.lg,
    alignItems: 'center',
    gap: spacing.xs,
  },
  summaryCount: {
    fontSize: 48,
    fontWeight: '800',
    color: colors.primary,
    lineHeight: 56,
  },
  summaryLabel: { ...typography.bodyBold, color: colors.primary },
  summaryHint: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  sectionTitle: {
    ...typography.h3,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  tile: {
    width: '30%',
    aspectRatio: 1,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.sm,
    gap: spacing.xs,
  },
  tilePressed: { opacity: 0.75 },
  tileIcon: { fontSize: 28 },
  tileLabel: {
    ...typography.caption,
    textAlign: 'center',
    color: colors.textPrimary,
  },
  tileCount: {
    ...typography.caption,
    fontSize: 10,
    textAlign: 'center',
    color: colors.textSecondary,
  },
  tileCountAllAdded: {
    color: colors.success,
    fontWeight: '700',
  },
  proposeSection: {
    margin: spacing.lg,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  proposeTitle: { ...typography.h3 },
  proposeBody: { ...typography.body, color: colors.textSecondary },
  proposeBtn: {
    backgroundColor: colors.bg,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.primary,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    alignSelf: 'flex-start',
    marginTop: spacing.xs,
  },
  proposeBtnText: { ...typography.bodyBold, color: colors.primary },
  // PR-NEXT-BUNDLE-L §C — paper workflow CTAs.
  paperSection: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  paperBtn: {
    backgroundColor: colors.bg,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.primary,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    alignSelf: 'flex-start',
    marginTop: spacing.xs,
  },
  paperBtnBusy: { opacity: 0.7 },
  paperBtnBusyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  paperBtnText: { ...typography.bodyBold, color: colors.primary },
  paperBtnSecondary: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    alignSelf: 'flex-start',
  },
  paperBtnSecondaryText: { ...typography.bodyBold, color: colors.info },
  sheetTitle: { ...typography.h3, marginBottom: spacing.sm },
  sheetBody: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
  sheetPrimaryBtn: {
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  sheetPrimaryBtnText: { ...typography.bodyBold, color: colors.bg, fontSize: 16 },
  sheetSecondaryBtn: {
    backgroundColor: colors.bg,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  sheetSecondaryBtnText: { ...typography.bodyBold, color: colors.textPrimary },
  sheetBtnDisabled: { opacity: 0.4 },
});
