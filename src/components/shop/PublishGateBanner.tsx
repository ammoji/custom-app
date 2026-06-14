/**
 * PR-NEXT-BUNDLE-M §E — shop-owner publish-readiness banner.
 *
 * Self-fetching, drop-in component rendered at the top of
 * `ShopOwnerDashboardScreen` and `BuildCatalogScreen`. It reads the
 * owner's shop via `getMyShop` (the same doc the gate denormalizes
 * onto) and renders one of:
 *
 *   - nothing — shop not loaded yet, or already published + success
 *     chip already seen.
 *   - "Almost ready" banner — when `!isShopPublishable(shop)`, listing
 *     exactly what's missing (via the pure `formatPublishMissingForBanner`)
 *     with a one-tap CTA to the first fixable requirement + a manual
 *     "Refresh" that calls `recomputeShopPublishStatus`.
 *   - success chip — once, on the first dashboard load AFTER the shop
 *     flips publishable (AsyncStorage-gated so it doesn't re-show).
 *
 * The component NEVER recomputes publishability locally — `isPublishable`
 * is server-authoritative. It only reads the denormalized result and
 * renders the matching copy.
 */

import { useFocusEffect, useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radii, spacing, typography } from '../../constants/theme';
import { orderService } from '../../services/orderService';
import type { Shop } from '../../types';
import {
  formatPublishMissingForBanner,
  isShopPublishable,
} from '../../utils/shopPublishHelpers';

// Client default mirrors the server's
// `DEFAULT_MIN_MENU_ITEMS_FOR_PUBLISH`. The gate decision itself is
// server-authoritative; this only feeds the "Add N more items" copy,
// which is cosmetic if an admin has customized the threshold.
const DEFAULT_MIN_MENU_ITEMS = 5;
const PUBLISHED_TOAST_KEY = 'shopPublishedToastSeen';

export default function PublishGateBanner() {
  const nav = useNavigation<any>();
  const [shop, setShop] = useState<Shop | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => {
    let cancelled = false;
    orderService
      .getShopForOwner()
      .then(async s => {
        if (cancelled || !s) return;
        setShop(s);
        if (isShopPublishable(s)) {
          // Show the "you're live" chip exactly once per shop.
          const key = `${PUBLISHED_TOAST_KEY}:${s.id}`;
          const seen = await AsyncStorage.getItem(key);
          if (!seen) {
            setShowSuccess(true);
            await AsyncStorage.setItem(key, '1');
          }
        }
      })
      // silent-catch-audit:allow — the banner is a non-critical nudge.
      // A failed shop fetch simply renders nothing this pass; the gate
      // itself is server-authoritative and unaffected. Surfacing an
      // error here would be noise on a best-effort affordance.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      const cleanup = load();
      return cleanup;
    }, [load]),
  );

  // Auto-dismiss the success chip after 3s.
  useEffect(() => {
    if (!showSuccess) return;
    const t = setTimeout(() => setShowSuccess(false), 3000);
    return () => clearTimeout(t);
  }, [showSuccess]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await orderService.recomputeShopPublishStatus();
      const s = await orderService.getShopForOwner();
      if (s) setShop(s);
    } catch {
      // Non-fatal.
    } finally {
      setRefreshing(false);
    }
  }, []);

  if (!shop) return null;

  if (isShopPublishable(shop)) {
    if (!showSuccess) return null;
    return (
      <View style={styles.successChip} accessibilityRole="text">
        <Text style={styles.successText}>
          ✓ Your shop is live! Customers can see and order from you now.
        </Text>
      </View>
    );
  }

  const content = formatPublishMissingForBanner(
    shop.publishGateState?.missing ?? [],
    shop.publishGateState?.menuItemCount ?? 0,
    DEFAULT_MIN_MENU_ITEMS,
  );

  // Defensive: if the gate says unpublishable but produced no copy
  // (shouldn't happen), don't render an empty banner.
  if (content.lines.length === 0) return null;

  const onCtaPress = () => {
    const cta = content.primaryCta;
    if (!cta) return;
    if (cta.route === 'ShopSettings') {
      const section = cta.label === 'Set hours' ? 'hours' : 'location';
      nav.navigate('ShopSettings', { section });
    } else {
      nav.navigate('BuildCatalog');
    }
  };

  return (
    <View style={styles.banner} accessibilityRole="summary">
      <Text style={styles.title}>📋 Almost ready to go live</Text>
      <Text style={styles.subtitle}>
        Customers can&apos;t see your shop yet. To publish:
      </Text>
      <View style={styles.lines}>
        {content.lines.map(line => (
          <Text key={line} style={styles.line}>
            {'\u2022'} {line}
          </Text>
        ))}
      </View>
      <View style={styles.actions}>
        {content.primaryCta && (
          <Pressable
            style={styles.cta}
            onPress={onCtaPress}
            accessibilityRole="button"
            accessibilityLabel={content.primaryCta.label}
          >
            <Text style={styles.ctaText}>{content.primaryCta.label}</Text>
          </Pressable>
        )}
        <Pressable
          style={styles.refreshBtn}
          onPress={onRefresh}
          disabled={refreshing}
          accessibilityRole="button"
          accessibilityLabel="Refresh publish status"
        >
          {refreshing ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Text style={styles.refreshText}>Refresh</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: '#FFF7E6',
    borderColor: '#F0C36D',
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    margin: spacing.md,
  },
  title: {
    ...typography.bodyBold,
    color: '#8A5A00',
    marginBottom: spacing.xs,
  },
  subtitle: {
    ...typography.caption,
    color: '#8A5A00',
    marginBottom: spacing.sm,
  },
  lines: {
    marginBottom: spacing.sm,
  },
  line: {
    ...typography.body,
    color: '#5C4A1A',
    marginBottom: 2,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  cta: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.sm,
  },
  ctaText: {
    ...typography.bodyBold,
    color: '#FFFFFF',
  },
  refreshBtn: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: '#F0C36D',
    minWidth: 72,
    alignItems: 'center',
  },
  refreshText: {
    ...typography.bodyBold,
    color: '#8A5A00',
  },
  successChip: {
    backgroundColor: '#E6F7EC',
    borderColor: '#7BC99A',
    borderWidth: 1,
    borderRadius: radii.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    margin: spacing.md,
  },
  successText: {
    ...typography.bodyBold,
    color: '#1B7A43',
  },
});
