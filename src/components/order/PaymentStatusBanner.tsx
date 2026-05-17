import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing, typography } from '../../constants/theme';
import type { PaymentStatus } from '../../types';

/**
 * PR 2 — payment hardening (Phase B). Inline banner the admin and
 * shop-owner dashboards render above each order card to surface the
 * non-happy-path payment states the new flow can produce:
 *
 *   - 'amount_mismatch'  — webhook saw a captured payment with a
 *     mismatched amount; admin must reconcile via Razorpay dashboard
 *   - 'authorized'       — payment authorized but not auto-captured;
 *     same: manual capture via Razorpay
 *   - 'refund_pending'   — Razorpay refund API call in flight
 *   - 'refunded'         — happy-path refund completed
 *   - 'refund_failed'    — Razorpay rejected the refund; offer Retry
 *
 * Returns null for any other status (including the common 'paid' /
 * 'pending' / 'not_required') so the host screen can render this
 * unconditionally.
 */
export type PaymentStatusBannerProps = {
  paymentStatus?: PaymentStatus;
  onRetryRefund?: () => void;
};

export default function PaymentStatusBanner(props: PaymentStatusBannerProps) {
  const s = props.paymentStatus;
  if (!s) return null;

  if (s === 'amount_mismatch') {
    return (
      <View style={[styles.base, styles.danger]}>
        <Text style={styles.title}>🚨 Payment amount mismatch</Text>
        <Text style={styles.body}>
          Captured amount disagrees with order total. Manual reconciliation
          required via Razorpay dashboard.
        </Text>
      </View>
    );
  }

  if (s === 'authorized') {
    return (
      <View style={[styles.base, styles.warn]}>
        <Text style={styles.title}>⚠️ Payment authorized, not captured</Text>
        <Text style={styles.body}>
          Capture or refund manually on the Razorpay dashboard.
        </Text>
      </View>
    );
  }

  if (s === 'refund_pending') {
    return (
      <View style={[styles.base, styles.warn]}>
        <Text style={styles.title}>↻ Refunding…</Text>
        <Text style={styles.body}>
          Razorpay refund initiated. Customer sees funds in 5-7 business days.
        </Text>
      </View>
    );
  }

  if (s === 'refunded') {
    return (
      <View style={[styles.base, styles.ok]}>
        <Text style={styles.title}>✅ Refunded</Text>
        <Text style={styles.body}>
          Customer was refunded the full order amount.
        </Text>
      </View>
    );
  }

  if (s === 'refund_failed') {
    return (
      <View style={[styles.base, styles.danger]}>
        <Text style={styles.title}>🚨 Refund failed</Text>
        <Text style={styles.body}>
          Razorpay rejected the refund. Manual intervention required.
        </Text>
        {props.onRetryRefund ? (
          <Pressable
            style={styles.retryBtn}
            onPress={props.onRetryRefund}
            accessibilityRole="button"
            accessibilityLabel="Retry refund"
          >
            <Text style={styles.retryText}>Retry refund</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  base: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.xs,
  },
  warn: {
    backgroundColor: '#FEF2E5',
    borderColor: colors.warning ?? '#E89A3C',
  },
  danger: {
    backgroundColor: '#FEE5E5',
    borderColor: colors.danger ?? '#C0392B',
  },
  ok: {
    backgroundColor: '#E5F6E5',
    borderColor: colors.success ?? '#2E7D32',
  },
  title: { ...typography.bodyBold },
  body: { ...typography.caption, color: colors.textSecondary },
  retryBtn: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    marginTop: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
  },
  retryText: { ...typography.bodyBold, color: colors.danger ?? '#C0392B' },
});
