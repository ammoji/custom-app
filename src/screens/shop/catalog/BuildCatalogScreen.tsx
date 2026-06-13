/**
 * PR-NEXT-BUNDLE-K §F — BuildCatalogScreen (onboarding hub).
 *
 * Landing screen for the catalog onboarding flow. Shows:
 *   - 10 category tiles with per-category progress (% done)
 *   - Total items added badge
 *   - "Propose custom item" link → ProposeCustomItemScreen
 *   - Reads onboardingState/catalog for persistence
 *
 * Each tile navigates to CategoryBrowseScreen with the category ID.
 * After browse the draft list is passed back via `onDraftsUpdated`
 * callback (stored in route params so the hub can refresh counters).
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  where,
  query,
} from 'firebase/firestore';

import { CATEGORIES } from '../../../constants/categories';
import { colors, radii, spacing, typography } from '../../../constants/theme';
import { db } from '../../../services/firebase';
import type { OnboardingCatalogState } from '../../../types';
import type { RootStackParamList } from '../../../navigation/AppNavigator';

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
  const [loading, setLoading] = useState(true);
  const [shopId, setShopId] = useState<string | null>(null);

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

  // Subscribe to onboarding state doc
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

  // Load menu product IDs (for progress computation)
  const loadMenuIds = useCallback(async () => {
    if (!shopId) return;
    try {
      const snap = await getDocs(
        query(
          collection(db, `shops/${shopId}/menu`),
          where('deletedAt', '==', null),
        ),
      );
      const ids = new Set<string>();
      snap.docs.forEach(d => {
        const pid = d.data().productId as string | null;
        if (pid) ids.add(pid);
      });
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

  const totalAdded = onboardingState?.itemsAdded ?? menuProductIds.size;

  function handleCategoryPress(categoryId: string) {
    navigation.navigate('CategoryBrowse', {
      categoryId,
      existingDrafts: [],
    });
  }

  function handleProposeCustomItem() {
    navigation.navigate('ProposeCustomItem');
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
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
            </Pressable>
          );
        })}
      </View>

      {/* Propose custom item */}
      <View style={styles.proposeSection}>
        <Text style={styles.proposeTitle}>Can't find an item?</Text>
        <Text style={styles.proposeBody}>
          Propose a new product for the master catalog. Our team reviews it
          within 24 hours.
        </Text>
        <Pressable style={styles.proposeBtn} onPress={handleProposeCustomItem}>
          <Text style={styles.proposeBtnText}>+ Propose Custom Item</Text>
        </Pressable>
      </View>
    </ScrollView>
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
});
