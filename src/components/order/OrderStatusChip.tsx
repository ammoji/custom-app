import React from 'react';
import Badge from '../common/Badge';
import { Order } from '../../types';

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const TONE_BY_STATUS: Record<Order['status'], Tone> = {
  pending: 'warning',
  accepted: 'info',
  preparing: 'info',
  ready_for_pickup: 'info',
  delivered: 'success',
  cancelled: 'danger',
};

const LABEL_BY_STATUS: Record<Order['status'], string> = {
  pending: 'Pending',
  accepted: 'Accepted',
  preparing: 'Preparing',
  // PR 12 — internal/admin label. Customer audience overrides
  // this to "Out for delivery" via the `audience` prop below.
  ready_for_pickup: 'Ready for Pickup',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

// PR 12 — customer-facing overrides. Customers continue to see
// the familiar "Out for delivery" copy because that's what every
// other delivery app calls this state. Only the internal status
// value + admin/shop/delivery-partner UIs got renamed.
const CUSTOMER_LABEL_OVERRIDES: Partial<Record<Order['status'], string>> = {
  ready_for_pickup: 'Out for delivery',
};

type Props = {
  status: Order['status'];
  // Defaults to 'internal' (admin / shop / delivery views).
  // Customer screens pass 'customer' so the chip reads
  // "Out for delivery" instead of "Ready for Pickup".
  audience?: 'internal' | 'customer';
};

export default function OrderStatusChip({ status, audience = 'internal' }: Props) {
  const label =
    audience === 'customer'
      ? CUSTOMER_LABEL_OVERRIDES[status] ?? LABEL_BY_STATUS[status]
      : LABEL_BY_STATUS[status];
  return <Badge label={label} tone={TONE_BY_STATUS[status]} />;
}
