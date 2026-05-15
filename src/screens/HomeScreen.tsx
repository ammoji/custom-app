import { useFocusEffect, useNavigation } from '@react-navigation/native';
import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Button from '../components/common/Button';
import { CATEGORIES } from '../constants/categories';
import { colors, radii, spacing, typography } from '../constants/theme';
import { orderService } from '../services/orderService';
import { useAuthStore } from '../store/useAuthStore';
import { useCartStore } from '../store/useCartStore';
import { useLocationStore } from '../store/useLocationStore';
import type { Shop } from '../types';
import { formatRupees } from '../utils/format';

export default function HomeScreen() {
  const nav = useNavigation<any>();
  const itemCount = useCartStore(s => s.itemCount());
  const total = useCartStore(s => s.total());
  const uid = useAuthStore(s => s.uid);
  const isAnonymous = useAuthStore(s => s.isAnonymous);
  const isAdmin = useAuthStore(s => s.isAdmin);
  const isShopOwner = useAuthStore(s => s.isShopOwner);
  const isDelivery = useAuthStore(s => s.isDelivery);
  const source = useLocationStore(s => s.source);

  // Phase 12a-v2-i. If the user has a shop in flight (registered but
  // not yet approved, or rejected), surface a "Awaiting approval"
  // tile so they can re-open the WaitingForApproval screen without
  // hunting through nav. We refetch on focus so a freshly-rejected
  // shop appears as soon as the user returns to Home.
  const [pendingShop, setPendingShop] = useState<Shop | null>(null);
  useFocusEffect(
    useCallback(() => {
      if (isAnonymous || isShopOwner) {
        setPendingShop(null);
        return;
      }
      let cancelled = false;
      orderService
        .getShopForOwner()
        .then(shop => {
          if (cancelled) return;
          // Active is handled by the isShopOwner branch (claim is set
          // by approveShop). We only show this tile for in-flight or
          // rejected registrations.
          if (shop && shop.status !== 'active') {
            setPendingShop(shop);
          } else {
            setPendingShop(null);
          }
        })
        .catch(err => {
          // Best-effort — failing to fetch shouldn't block Home.
          console.warn('[Home] getShopForOwner failed:', err);
        });
      return () => {
        cancelled = true;
      };
    }, [isAnonymous, isShopOwner]),
  );

  // A user has a "non-customer role" when they wear at least one extra
  // hat. We use this to decide whether to render the "Your Roles"
  // section header.
  const hasAnyExtraRole = isAdmin || isShopOwner || isDelivery;
  const locationLabel =
    source === 'gps'
      ? 'Deliver to your location'
      : 'Deliver to Green Park, Delhi (default)';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.greeting, { paddingHorizontal: spacing.lg }]}>Hello 👋</Text>
        <Text style={[styles.location, { paddingHorizontal: spacing.lg }]}>{locationLabel}</Text>
        {source === 'fallback' && (
          <View style={styles.fallbackBanner}>
            <Text style={styles.fallbackText}>
              📍 Using default location. Enable location to find shops near you.
            </Text>
          </View>
        )}

        <Pressable
          onPress={() => nav.navigate('Search')}
          style={[styles.searchBox, { marginHorizontal: spacing.lg }]}
          accessibilityRole="button"
          accessibilityLabel="Search for products"
        >
          <Text style={styles.searchPlaceholder}>🔍  Search for atta, milk, soap...</Text>
        </Pressable>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipsScroll}
          contentContainerStyle={styles.chipsContent}
        >
          {CATEGORIES.map(cat => (
            <Pressable
              key={cat.id}
              style={styles.chip}
              onPress={() => nav.navigate('Search', { category: cat.id })}
              accessibilityRole="button"
              accessibilityLabel={`Search in ${cat.label}`}
            >
              <Text style={styles.chipText}>{cat.label}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <View style={styles.heroCard}>
          <Text style={styles.heroTitle}>Fresh kirana groceries</Text>
          <Text style={styles.heroSubtitle}>From local shops within 1 km of you</Text>
          <View style={{ marginTop: spacing.md }}>
            <Button title="Browse shops near me" onPress={() => nav.navigate('ShopList')} />
          </View>
        </View>

        <Pressable
          style={styles.ordersRow}
          onPress={() => nav.navigate('Orders')}
          accessibilityRole="button"
          accessibilityLabel="My Orders"
        >
          <Text style={styles.ordersText}>📦  My Orders</Text>
          <Text style={styles.ordersChevron}>›</Text>
        </Pressable>

        {isAnonymous && (
          <Pressable
            style={styles.signInRow}
            onPress={() => nav.navigate('Login')}
            accessibilityRole="button"
            accessibilityLabel="Sign in with phone"
          >
            <Text style={styles.signInText}>📱  Sign in with phone</Text>
            <Text style={styles.signInChevron}>›</Text>
          </Pressable>
        )}

        {hasAnyExtraRole && (
          <>
            <Text style={[styles.sectionTitle, { paddingHorizontal: spacing.lg }]}>
              Your Roles
            </Text>
            {isShopOwner && (
              <Pressable
                style={styles.roleRow}
                onPress={() => nav.navigate('ShopOwnerDashboard')}
                accessibilityRole="button"
                accessibilityLabel="Shop Dashboard"
              >
                <Text style={styles.roleText}>🛍️  Shop Dashboard</Text>
                <Text style={styles.roleChevron}>›</Text>
              </Pressable>
            )}
            {isDelivery && (
              <Pressable
                style={styles.roleRow}
                onPress={() => nav.navigate('DeliveryDashboard')}
                accessibilityRole="button"
                accessibilityLabel="Delivery Dashboard"
              >
                <Text style={styles.roleText}>🚚  Delivery Dashboard</Text>
                <Text style={styles.roleChevron}>›</Text>
              </Pressable>
            )}
            {isAdmin && (
              <Pressable
                style={styles.adminRow}
                onPress={() => nav.navigate('AdminOrders')}
                accessibilityRole="button"
                accessibilityLabel="Admin Dashboard"
              >
                <Text style={styles.adminText}>🛠️  Admin Dashboard</Text>
                <Text style={styles.adminChevron}>›</Text>
              </Pressable>
            )}
            {isAdmin && (
              <Pressable
                style={styles.adminRow}
                onPress={() => nav.navigate('PendingShops')}
                accessibilityRole="button"
                accessibilityLabel="Pending Shop Approvals"
              >
                <Text style={styles.adminText}>📋  Pending Shop Approvals</Text>
                <Text style={styles.adminChevron}>›</Text>
              </Pressable>
            )}
            {isAdmin && (
              <Pressable
                style={styles.adminRow}
                onPress={() => nav.navigate('UserManagement')}
                accessibilityRole="button"
                accessibilityLabel="User Management"
              >
                <Text style={styles.adminText}>👥  User Management</Text>
                <Text style={styles.adminChevron}>›</Text>
              </Pressable>
            )}
            {isAdmin && (
              <Pressable
                style={styles.adminRow}
                onPress={() => nav.navigate('ShopManagement')}
                accessibilityRole="button"
                accessibilityLabel="All Shops"
              >
                <Text style={styles.adminText}>🏪  All Shops</Text>
                <Text style={styles.adminChevron}>›</Text>
              </Pressable>
            )}
          </>
        )}

        {pendingShop && (
          <Pressable
            style={styles.pendingRow}
            onPress={() =>
              nav.navigate('WaitingForApproval', { shopId: pendingShop.id })
            }
            accessibilityRole="button"
            accessibilityLabel={`Awaiting approval for ${pendingShop.name}`}
          >
            <Text style={styles.pendingText}>
              {pendingShop.status === 'rejected' ? '❌' : '📋'}{'  '}
              {pendingShop.status === 'rejected'
                ? `Rejected: ${pendingShop.name}`
                : `Awaiting approval for ${pendingShop.name}`}
            </Text>
            <Text style={styles.pendingChevron}>›</Text>
          </Pressable>
        )}

        {/* Opt-in section. Hide rows the user has already taken. The
            section header itself is hidden when there's nothing to
            opt into (i.e. user holds both roles already). Anonymous
            users can still see the section — claimShop / becomeDelivery
            require auth, and the BecomeShopOwner / BecomeDeliveryPartner
            screens render a "sign in first" empty state. That flow
            beats hiding the rows entirely (anon users wouldn't know
            these features exist). */}
        {(!isShopOwner || !isDelivery) && (
          <>
            <Text style={[styles.sectionTitle, { paddingHorizontal: spacing.lg }]}>
              Become more
            </Text>
            {/* Hide the "Open a shop" CTA when the user already has a
                registration in flight — the pendingShop tile above
                covers that case. Once the shop is approved the
                isShopOwner branch above takes over instead. */}
            {!isShopOwner && !pendingShop && (
              <Pressable
                style={styles.optInRow}
                onPress={() => nav.navigate('RegisterShop')}
                accessibilityRole="button"
                accessibilityLabel="Open a shop on Kirana Mart"
              >
                <Text style={styles.optInText}>🏪  Open a shop on Kirana Mart</Text>
                <Text style={styles.optInChevron}>›</Text>
              </Pressable>
            )}
            {!isDelivery && (
              <Pressable
                style={styles.optInRow}
                onPress={() => nav.navigate('BecomeDeliveryPartner')}
                accessibilityRole="button"
                accessibilityLabel="Become a delivery partner"
              >
                <Text style={styles.optInText}>🚲  Become a delivery partner</Text>
                <Text style={styles.optInChevron}>›</Text>
              </Pressable>
            )}
          </>
        )}

        <Text style={[styles.sectionTitle, { paddingHorizontal: spacing.lg }]}>How it works</Text>
        <View style={[styles.steps, { paddingHorizontal: spacing.lg }]}>
          <Step n="1" title="Pick a shop" desc="Browse nearby kirana stores" />
          <Step n="2" title="Add to cart" desc="Choose your groceries" />
          <Step n="3" title="Place order" desc="Pay on delivery, get it fast" />
        </View>

        {__DEV__ && (
          <Text style={{ fontSize: 10, color: colors.textMuted, marginTop: spacing.xl, paddingHorizontal: spacing.lg }}>
            uid: {uid ?? 'pending'} {isAnonymous ? '[Anon]' : ''}{' '}
            {isAdmin ? '[Admin]' : ''}
            {isShopOwner ? '[ShopOwner]' : ''}
            {isDelivery ? '[Delivery]' : ''}
          </Text>
        )}
      </ScrollView>

      {itemCount > 0 && (
        <Pressable
          style={styles.cartBar}
          onPress={() => nav.navigate('Cart')}
          accessibilityRole="button"
          accessibilityLabel={`View cart, ${itemCount} item${itemCount > 1 ? 's' : ''}, total ${formatRupees(total)}`}
        >
          <Text style={styles.cartText}>
            🛒 {itemCount} item{itemCount > 1 ? 's' : ''} · {formatRupees(total)}
          </Text>
          <Text style={styles.cartCta}>View Cart ›</Text>
        </Pressable>
      )}
    </SafeAreaView>
  );
}

function Step({ n, title, desc }: { n: string; title: string; desc: string }) {
  return (
    <View style={styles.step}>
      <View style={styles.stepNum}>
        <Text style={styles.stepNumText}>{n}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.stepTitle}>{title}</Text>
        <Text style={styles.stepDesc}>{desc}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { paddingVertical: spacing.lg, paddingBottom: 120 },
  greeting: { ...typography.h1 },
  location: { ...typography.body, color: colors.textSecondary, marginTop: spacing.xs },
  fallbackBanner: {
    marginTop: spacing.md,
    marginHorizontal: spacing.lg,
    backgroundColor: colors.primaryLight,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  fallbackText: { ...typography.caption, color: colors.primaryDark },
  searchBox: {
    marginTop: spacing.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 48,
    justifyContent: 'center',
  },
  searchPlaceholder: { ...typography.body, color: colors.textMuted },
  chipsScroll: { marginTop: spacing.md },
  chipsContent: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  chip: {
    backgroundColor: colors.primaryLight,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  chipText: { ...typography.caption, color: colors.primary, fontWeight: '600' },
  heroCard: {
    marginTop: spacing.lg,
    marginHorizontal: spacing.lg,
    backgroundColor: colors.primaryLight,
    padding: spacing.lg,
    borderRadius: radii.lg,
  },
  ordersRow: {
    marginTop: spacing.md,
    marginHorizontal: spacing.lg,
    backgroundColor: colors.bg,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  ordersText: { ...typography.bodyBold },
  ordersChevron: { ...typography.h2, color: colors.textSecondary },
  adminRow: {
    marginTop: spacing.md,
    marginHorizontal: spacing.lg,
    backgroundColor: colors.primaryDark,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  adminText: { ...typography.bodyBold, color: '#fff' },
  adminChevron: { ...typography.h2, color: '#fff' },
  signInRow: {
    marginTop: spacing.sm,
    marginHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  signInText: { ...typography.body, color: colors.textPrimary },
  signInChevron: { ...typography.h2, color: colors.textSecondary },
  // "Your Roles" — solid green for the active shop owner dashboard
  // entry (mirrors the previous adminRow look). The disabled variant
  // grays it out to signal "claimed but not yet usable".
  roleRow: {
    marginTop: spacing.md,
    marginHorizontal: spacing.lg,
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  roleRowDisabled: { backgroundColor: colors.border, opacity: 0.7 },
  roleText: { ...typography.bodyBold, color: '#fff' },
  roleTextDisabled: { color: colors.textSecondary },
  roleChevron: { ...typography.h2, color: '#fff' },
  // "Become more" — outlined cards that draw the eye but don't compete
  // with active role tiles.
  optInRow: {
    marginTop: spacing.md,
    marginHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.primaryLight,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  optInText: { ...typography.bodyBold, color: colors.primary },
  optInChevron: { ...typography.h2, color: colors.primary },
  // "Awaiting approval" tile — same layout as adminRow but warm-toned
  // so it reads as informational status, not a destructive admin
  // action. Color comes from theme.warning.
  pendingRow: {
    marginTop: spacing.md,
    marginHorizontal: spacing.lg,
    backgroundColor: colors.warning,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pendingText: { ...typography.bodyBold, color: '#fff', flex: 1 },
  pendingChevron: { ...typography.h2, color: '#fff' },
  heroTitle: { ...typography.h2, color: colors.primaryDark },
  heroSubtitle: { ...typography.body, color: colors.primaryDark, marginTop: spacing.xs },
  sectionTitle: { ...typography.h3, marginTop: spacing.xl, marginBottom: spacing.md },
  steps: { gap: spacing.md },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.bg,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  stepNum: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumText: { ...typography.bodyBold, color: '#fff' },
  stepTitle: { ...typography.bodyBold },
  stepDesc: { ...typography.caption, marginTop: 2 },
  cartBar: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.lg,
    backgroundColor: colors.primary,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cartText: { ...typography.bodyBold, color: '#fff' },
  cartCta: { ...typography.bodyBold, color: '#fff' },
});
