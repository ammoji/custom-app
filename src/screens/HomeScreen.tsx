import { useNavigation } from '@react-navigation/native';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Button from '../components/common/Button';
import { CATEGORIES } from '../constants/categories';
import { colors, radii, spacing, typography } from '../constants/theme';
import { useCartStore } from '../store/useCartStore';
import { useOrderStore } from '../store/useOrderStore';
import { formatRupees } from '../utils/format';

export default function HomeScreen() {
  const nav = useNavigation<any>();
  const itemCount = useCartStore(s => s.itemCount());
  const total = useCartStore(s => s.total());
  const orderCount = useOrderStore(s => s.orders.length);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.greeting, { paddingHorizontal: spacing.lg }]}>Hello 👋</Text>
        <Text style={[styles.location, { paddingHorizontal: spacing.lg }]}>Deliver to Green Park, New Delhi</Text>

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

        {orderCount > 0 && (
          <Pressable
            style={styles.ordersRow}
            onPress={() => nav.navigate('Orders')}
            accessibilityRole="button"
            accessibilityLabel={`My Orders, ${orderCount} order${orderCount > 1 ? 's' : ''}`}
          >
            <Text style={styles.ordersText}>📦  My Orders</Text>
            <Text style={styles.ordersChevron}>›</Text>
          </Pressable>
        )}

        <Text style={[styles.sectionTitle, { paddingHorizontal: spacing.lg }]}>How it works</Text>
        <View style={[styles.steps, { paddingHorizontal: spacing.lg }]}>
          <Step n="1" title="Pick a shop" desc="Browse nearby kirana stores" />
          <Step n="2" title="Add to cart" desc="Choose your groceries" />
          <Step n="3" title="Place order" desc="Pay on delivery, get it fast" />
        </View>
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
