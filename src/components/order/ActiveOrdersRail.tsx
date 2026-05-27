/**
 * PR 15 — HomeScreen "Active orders" rail.
 *
 * Symmetric twin of `OrderAgainRail` (PR 14) but for IN-FLIGHT
 * orders. Sits ABOVE the Order Again rail on Home so a customer
 * with in-flight orders sees them first.
 *
 * Visual differentiation: this rail uses a primary-tinted card
 * background (vs OrderAgainRail's neutral surface). That signals
 * "live, needs attention" without requiring the customer to read
 * the section header.
 *
 * Hidden (returns null) when `orders.length === 0` — first-time
 * customers, anonymous users, and anyone with only terminal-state
 * orders see nothing here.
 *
 * Tap delegates to the parent (HomeScreen owns navigation).
 */
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing, typography } from '../../constants/theme';
import { orderEtaDisplay } from '../../utils/orderEtaDisplay';
import OrderStatusChip from './OrderStatusChip';
import type { Order } from '../../types';

type Props = {
  orders: Order[];
  onTap: (order: Order) => void;
  // PR 17 — ETA ticker. HomeScreen passes a `nowMs` that bumps
  // once per minute via a setInterval. The minutes-left math uses
  // it instead of `Date.now()` at render time, so the copy
  // ("Arriving in ~5 min") decrements visibly while the user
  // lingers on Home. Optional for backwards-compat: any caller
  // that doesn't pass `nowMs` gets a single Date.now() snapshot
  // (the PR 15 behaviour) and the copy stays static until next
  // focus refetch.
  nowMs?: number;
};

// Customer-facing ETA copy. Re-renders every minute via the parent's
// ticking `nowMs` (PR 17 §Part 1). PR 43 — delegates the state
// machine to `orderEtaDisplay` so this rail, OrderDetailScreen,
// and OrderConfirmationScreen all read off one contract. The
// rail-specific copy variations (e.g. "Ready in" vs "Arriving in")
// stay here since they only apply to this surface's tight summary
// format.
function etaText(order: Order, nowMs: number): string {
  // Out-for-delivery is rail-specific copy — shown only here, not
  // in the helper (the detail screen has a richer status card for
  // ready_for_pickup that includes the dispatch chip + partner
  // info). Keep the early returns above the helper call.
  if (order.status === 'ready_for_pickup' && order.pickedUpAt) {
    return 'Out for delivery';
  }
  if (order.status === 'ready_for_pickup') {
    return 'Almost ready';
  }
  const eta = orderEtaDisplay(order, nowMs);
  switch (eta.kind) {
    case 'awaiting_confirmation':
      // PR 43 — pre-acceptance copy. No minute count anchored on
      // shop.etaMinutes; the shop hasn't committed yet.
      return 'Awaiting shop confirmation';
    case 'ready_by': {
      const minsLeft = Math.round((eta.readyByEstimate - nowMs) / 60_000);
      if (minsLeft <= 0) return 'Arriving soon';
      return `Ready in ~${minsLeft} min`;
    }
    case 'eta_fallback':
      return `Arriving in ~${eta.minutesLeft} min`;
    case 'arriving_soon':
      return 'Arriving soon';
    case 'hidden':
      // Caller checks `eta.length > 0` and skips rendering the
      // row when blank, so terminal-state orders silently fall
      // out without a "" placeholder showing up in the UI.
      return '';
  }
}

export default function ActiveOrdersRail({ orders, onTap, nowMs }: Props) {
  // Snapshot the clock if the parent didn't supply a ticking one.
  // Local `const`, not state — the parent's ticker drives re-renders
  // when it's used; the static fallback never updates by design.
  const tickMs = typeof nowMs === 'number' ? nowMs : Date.now();
  if (orders.length === 0) return null;
  return (
    <View style={styles.container}>
      <Text style={styles.header}>Your active orders</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {orders.map(order => {
          const eta = etaText(order, tickMs);
          return (
            <Pressable
              key={order.id}
              onPress={() => onTap(order)}
              style={({ pressed }) => [
                styles.card,
                pressed && { opacity: 0.85 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={`Open order from ${order.shopName}, status ${order.status}`}
            >
              <Text style={styles.shopName} numberOfLines={2}>
                {order.shopName}
              </Text>
              <View style={styles.chipRow}>
                <OrderStatusChip
                  status={order.status}
                  audience="customer"
                />
              </View>
              {eta.length > 0 && <Text style={styles.eta}>{eta}</Text>}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const CARD_WIDTH = 180;

const styles = StyleSheet.create({
  // Top margin matches the OrderAgainRail container so the two
  // rails read as a unified module on the home screen.
  container: { marginTop: spacing.lg },
  header: {
    ...typography.h3,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  scrollContent: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  card: {
    width: CARD_WIDTH,
    backgroundColor: colors.primaryLight,
    borderRadius: radii.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.primary,
    minHeight: 110,
    justifyContent: 'space-between',
  },
  shopName: { ...typography.bodyBold, marginBottom: spacing.sm },
  chipRow: { marginBottom: spacing.sm, flexDirection: 'row' },
  eta: { ...typography.caption, color: colors.primaryDark },
});
