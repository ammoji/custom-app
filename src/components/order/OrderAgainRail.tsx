/**
 * PR 14 — HomeScreen "Order again" rail.
 *
 * Horizontal-scroll rail of cards, one per frequent shop. Tapping
 * a card delegates to the parent (HomeScreen owns the reorder
 * modal state — same pattern as OrdersScreen owns its modal).
 *
 * Hidden (returns null) when there are no entries. That single
 * guard handles three cases at once:
 *   - First-time customers (no delivered orders yet).
 *   - Anonymous users (HomeScreen short-circuits the fetch and
 *     leaves entries=[]).
 *   - Non-customer-role users (admin / delivery / shop owner who
 *     never bought anything) — they have no past customer orders
 *     so the picker returns [].
 *
 * Loading state is intentionally NOT a skeleton — the rail is
 * non-critical UI and a brief blank space while listMine resolves
 * is preferable to layout shift from a skeleton popping in then
 * being replaced by real cards.
 */
import React from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors, radii, spacing, typography } from '../../constants/theme';
import type { FrequentShopEntry } from '../../utils/pickFrequentlyOrderedShops';
import ShopRatingBadge from '../shop/ShopRatingBadge';

type Props = {
  entries: FrequentShopEntry[];
  loading: boolean;
  onTap: (entry: FrequentShopEntry) => void;
};

export default function OrderAgainRail({ entries, onTap }: Props) {
  // `loading` is accepted for API symmetry / future use but unused
  // here — see the file-level comment.
  if (entries.length === 0) return null;

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Order again</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {entries.map(entry => (
          <Pressable
            key={entry.shopId}
            onPress={() => onTap(entry)}
            style={({ pressed }) => [
              styles.card,
              pressed && { opacity: 0.85 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={`Order again from ${entry.shopName}`}
          >
            <Text style={styles.shopName} numberOfLines={2}>
              {entry.shopName}
            </Text>
            {/* PR 20 — rolling rating badge. The HomeScreen caller
                hydrates ratingAvg/ratingCount when shop data is
                available; otherwise the badge gracefully shows
                "New shop" (preferable to hiding the row, since
                "New shop" is also a meaningful trust signal). */}
            <ShopRatingBadge
              ratingAvg={entry.ratingAvg}
              ratingCount={entry.ratingCount}
              size="sm"
            />
            {/* PR-NEXT-8 §B (finding #15) — action-predictive
                subtext. Pre-PR this read "{N} orders" (the
                lifetime delivered-count for this shop), which
                customers misread as "tap to see a list of past
                orders" — but the modal that opens shows the items
                of a SINGLE order (the most recent one), so the
                "3 orders" → "Add 4 items to cart" sequence broke
                the mental model on every first encounter. The new
                copy honestly describes what the tap will deliver.
                Lifetime frequency is still implicit in the rail
                ordering itself (most-frequent shop comes first;
                PR 14's sort is unchanged). `numberOfLines={1}` so
                a fixed-card-width truncation is graceful on very
                small phones. */}
            <Text style={styles.subtext} numberOfLines={1}>
              Last order ·{' '}
              {entry.lastOrderItemCount}{' '}
              {entry.lastOrderItemCount === 1 ? 'item' : 'items'}
            </Text>
            <Text style={styles.cta}>Order again →</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const CARD_WIDTH = 180;

const styles = StyleSheet.create({
  // Top margin matches the existing ordersRow / sectionTitle rhythm
  // on HomeScreen so the rail nests cleanly between the search box
  // and the category chips.
  container: { marginTop: spacing.lg },
  header: {
    ...typography.h3,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  scrollContent: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  card: {
    width: CARD_WIDTH,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    // Card height anchored so a one-line shop name and a two-line
    // shop name stay visually aligned in the rail.
    minHeight: 110,
    justifyContent: 'space-between',
  },
  shopName: { ...typography.bodyBold, marginBottom: spacing.xs },
  subtext: { ...typography.caption, color: colors.textSecondary },
  cta: {
    ...typography.bodyBold,
    color: colors.primary,
    marginTop: spacing.sm,
  },
});
