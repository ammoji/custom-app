import { useNavigation } from '@react-navigation/native';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Button from '../components/common/Button';
import { CATEGORIES } from '../constants/categories';
import { colors, radii, spacing, typography } from '../constants/theme';
import { useAuthStore } from '../store/useAuthStore';
import { useCartStore } from '../store/useCartStore';
import { useLocationStore } from '../store/useLocationStore';
import { formatRupees } from '../utils/format';

export default function HomeScreen() {
  const nav = useNavigation<any>();
  const itemCount = useCartStore(s => s.itemCount());
  const total = useCartStore(s => s.total());
  const uid = useAuthStore(s => s.uid);
  const isAnonymous = useAuthStore(s => s.isAnonymous);
  const isAdmin = useAuthStore(s => s.isAdmin);
  const source = useLocationStore(s => s.source);
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

        {isAdmin && (
          <Pressable
            style={styles.adminRow}
            onPress={() => nav.navigate('AdminOrders')}
            accessibilityRole="button"
            accessibilityLabel="Shop Dashboard"
          >
            <Text style={styles.adminText}>🛠️  Shop Dashboard</Text>
            <Text style={styles.adminChevron}>›</Text>
          </Pressable>
        )}

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

        <Text style={[styles.sectionTitle, { paddingHorizontal: spacing.lg }]}>How it works</Text>
        <View style={[styles.steps, { paddingHorizontal: spacing.lg }]}>
          <Step n="1" title="Pick a shop" desc="Browse nearby kirana stores" />
          <Step n="2" title="Add to cart" desc="Choose your groceries" />
          <Step n="3" title="Place order" desc="Pay on delivery, get it fast" />
        </View>

        {__DEV__ && (
          <Text style={{ fontSize: 10, color: colors.textMuted, marginTop: spacing.xl, paddingHorizontal: spacing.lg }}>
            uid: {uid ?? 'pending'} {isAnonymous ? '[Anon]' : ''} {isAdmin ? '[Admin]' : '[Not admin]'}
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
