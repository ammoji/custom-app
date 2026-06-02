import React, { useState } from 'react';
import {
    Alert,
    Keyboard,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import { colors, radii, spacing, typography } from '../../constants/theme';
import { orderService } from '../../services/orderService';
import { formatRupees } from '../../utils/format';
// PR-NEXT-HOTFIX-7 — DO NOT REMOVE. Shared bottom-sheet chrome
// (Modal + backdrop + safe-area-aware paddingBottom). `onBackdropPress`
// is overridden to dismiss only the keyboard — the half-typed-reason
// preservation posture documented in the migration comment below.
import BottomSheet from '../common/BottomSheet';
import Button from '../common/Button';

/**
 * PR 2 — payment hardening (Phase B, item 1). Modal admin and shop-
 * owner dashboards open when cancelling a PAID order. Captures a
 * required reason, calls cancelPaidOrder, surfaces success / failure
 * via Alert. The host screen passes the order's id + total; success
 * fires onDone so the host can refresh / pop.
 *
 * The modal disables its own inputs while the refund is in flight to
 * prevent double-submit. Razorpay's refund call typically takes
 * 1-3s; we don't add a timeout here because retrying mid-flight is
 * worse than waiting.
 *
 * Keyboard handling pattern reference: the
 *   KeyboardAvoidingView + backdropTapZone + dismiss-keyboard-only-on-
 *   backdrop-tap
 * structure in this file is the CANONICAL pattern mirrored across all
 * other input modals in the app:
 *   - src/screens/admin/UserDetailScreen.tsx
 *   - src/screens/admin/ShopDetailManagementScreen.tsx
 *   - src/screens/admin/ShopRegistrationDetailScreen.tsx
 *   - src/screens/admin/DeliveryRequestDetailScreen.tsx
 * If you fix a keyboard or tap-dismiss bug here, propagate to those.
 * Conversely, if you find a new input modal that breaks family
 * testing, port this pattern to it rather than inventing another.
 */
export type CancelAndRefundModalProps = {
  visible: boolean;
  orderId: string;
  orderTotal: number;
  onClose: () => void;
  onDone: () => void;
};

export default function CancelAndRefundModal(props: CancelAndRefundModalProps) {
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);

  const handleConfirm = async () => {
    const trimmed = reason.trim();
    if (!trimmed) {
      Alert.alert('Reason required', 'Please enter a reason for the refund.');
      return;
    }
    setPending(true);
    try {
      await orderService.cancelPaidOrder({
        orderId: props.orderId,
        reason: trimmed,
      });
      Alert.alert(
        'Refund initiated',
        `${formatRupees(props.orderTotal)} will be returned to the customer's payment method in 5-7 business days.`,
        [
          {
            text: 'OK',
            onPress: () => {
              setReason('');
              props.onDone();
            },
          },
        ],
      );
    } catch (e: any) {
      Alert.alert(
        'Refund failed',
        e?.message ||
          'Razorpay rejected the refund. The order is now in refund_failed state — you can retry from the order banner.',
      );
    } finally {
      setPending(false);
    }
  };

  return (
    // PR-NEXT-HOTFIX-7 — chrome migrated to `BottomSheet`.
    // `onBackdropPress` overrides the default "tap-backdrop-to-
    // close" behaviour to dismiss the KEYBOARD only. Closing while
    // the user has typed a reason would wipe their input with no
    // warning — same posture as pre-PR. Hardware-back still fires
    // `onClose` via `Modal.onRequestClose`, gated on `!pending` so
    // an in-flight refund can't be interrupted by accident.
    // `showHandle={false}` because the explicit "Keep order"
    // button at the bottom is the canonical dismissal affordance
    // for this sheet — the drag-handle would imply swipe-down
    // dismissal which we deliberately don't want here.
    <BottomSheet
      visible={props.visible}
      onClose={() => {
        if (!pending) props.onClose();
      }}
      onBackdropPress={() => Keyboard.dismiss()}
      showHandle={false}
    >
      <Text style={styles.title}>
        Cancel and refund {formatRupees(props.orderTotal)}?
      </Text>
      <Text style={styles.body}>
        The customer will be refunded via Razorpay (5-7 business days).
        This cannot be undone.
      </Text>
      <Text style={styles.label}>Reason for cancellation</Text>
      <TextInput
        value={reason}
        onChangeText={setReason}
        placeholder="e.g. Out of stock, customer requested"
        placeholderTextColor={colors.textSecondary}
        style={styles.input}
        multiline
        numberOfLines={3}
        editable={!pending}
        maxLength={280}
      />
      <View style={{ height: spacing.md }} />
      <Button
        title={pending ? 'Refunding…' : 'Cancel and refund'}
        onPress={handleConfirm}
        loading={pending}
        disabled={pending}
        // Button only has primary/secondary/ghost; we tint via
        // an inline override so the destructive intent is clear
        // without forking the design-system Button.
        variant="primary"
        size="lg"
        style={{ backgroundColor: colors.danger }}
      />
      <View style={{ height: spacing.sm }} />
      <Button
        title="Keep order"
        variant="ghost"
        onPress={() => {
          if (!pending) props.onClose();
        }}
        disabled={pending}
      />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  // PR-NEXT-HOTFIX-7 — `kavRoot` / `backdropTapZone` / `card` styles
  // removed; shared `BottomSheet` owns Modal + backdrop + card
  // chrome (with safe-area-aware `paddingBottom` from
  // `useSafeAreaInsets`). Keyboard-dismiss-on-backdrop semantics
  // are preserved via the `onBackdropPress` prop override above.
  title: { ...typography.h2, marginBottom: spacing.xs },
  body: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  label: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    minHeight: 80,
    textAlignVertical: 'top',
    ...typography.body,
    color: colors.textPrimary,
  },
});
