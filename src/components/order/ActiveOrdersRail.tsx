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

// Customer-facing ETA copy. When called with a ticking `nowMs`,
// the surrounding component re-renders every minute and this
// string updates in lockstep. See PR 17 §Part 1 for the ticker
// design; the change here is mechanical — the helper now takes
// `nowMs` as a parameter instead of reading the clock itself.
function etaText(order: Order, nowMs: number): string {
  // ready_for_pickup with pickedUpAt set → partner has the order
  // and is en route to the customer. Show that explicitly.
  if (order.status === 'ready_for_pickup' && order.pickedUpAt) {
    return 'Out for delivery';
  }
  if (order.status === 'ready_for_pickup') {
    return 'Almost ready';
  }
  // PR 17 — prefer the shopkeeper-committed `readyByEstimate`
  // when the order is in an accepted/preparing state (it's the
  // tighter, more honest signal). Fall through to the customer's
  // original estimated-delivery time for other states or when
  // the shop didn't commit one.
  const eta =
    (order.status === 'accepted' || order.status === 'preparing') &&
    typeof order.readyByEstimate === 'number'
      ? order.readyByEstimate
      : order.estimatedDeliveryAt;
  if (typeof eta !== 'number' || eta <= 0) return '';
  const minsLeft = Math.round((eta - nowMs) / 60_000);
  if (minsLeft <= 0) return 'Arriving soon';
  return `Arriving in ~${minsLeft} min`;
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
