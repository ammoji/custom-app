/**
 * PR-NEXT-BUNDLE-I §B — top-of-dashboard 2-column card grid.
 *
 * Mounts above existing FlatList sections via ListHeaderComponent.
 * Each card is a large tappable target (~88px height) showing icon +
 * count + label. The 'urgent' variant tints the card border red so
 * partners and shop owners can spot the attention queue at a glance.
 *
 * Last card spans full width when the total count is odd (keeps the
 * grid visually balanced).
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing, typography } from '../../constants/theme';
import type { DashboardCard } from '../../utils/deliveryDashboardViewModel';

const URGENT_RED = '#E53935';
const URGENT_BG = '#FFF5F5';

type Props = {
  cards: DashboardCard[];
  onCardPress: (cardId: DashboardCard['id']) => void;
};

export default function DashboardCardGrid({ cards, onCardPress }: Props) {
  return (
    <View style={styles.grid}>
      {cards.map((card, index) => {
        const isLastOdd = index === cards.length - 1 && cards.length % 2 !== 0;
        const isUrgent = card.variant === 'urgent';
        return (
          <Pressable
            key={card.id}
            onPress={() => onCardPress(card.id)}
            accessibilityRole="button"
            accessibilityLabel={`${card.label}: ${card.count}`}
            style={({ pressed }) => [
              styles.card,
              isLastOdd && styles.cardFull,
              isUrgent && styles.cardUrgent,
              pressed && { opacity: 0.82 },
            ]}
          >
            <Text style={styles.cardIcon}>{card.icon}</Text>
            <Text style={[styles.cardCount, isUrgent && styles.cardCountUrgent]}>
              {card.count}
            </Text>
            <Text
              style={[styles.cardLabel, isUrgent && styles.cardLabelUrgent]}
              numberOfLines={2}
            >
              {card.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.md,
  },
  card: {
    // Two columns: (screen - 2*lg - 1*gap) / 2
    flex: 1,
    minWidth: '45%',
    height: 88,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  cardFull: {
    minWidth: '100%',
  },
  cardUrgent: {
    borderColor: URGENT_RED,
    backgroundColor: URGENT_BG,
  },
  cardIcon: {
    fontSize: 20,
    lineHeight: 24,
    marginBottom: 2,
  },
  cardCount: {
    ...typography.h3,
    lineHeight: 22,
  },
  cardLabel: {
    ...typography.caption,
    textAlign: 'center',
    color: colors.textSecondary,
    marginTop: 1,
  },
  cardCountUrgent: {
    color: URGENT_RED,
  },
  cardLabelUrgent: {
    color: URGENT_RED,
  },
});
