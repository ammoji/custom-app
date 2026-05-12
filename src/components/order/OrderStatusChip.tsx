import React from 'react';
import Badge from '../common/Badge';
import { Order } from '../../types';

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const TONE_BY_STATUS: Record<Order['status'], Tone> = {
  pending: 'warning',
  accepted: 'info',
  preparing: 'info',
  out_for_delivery: 'info',
  delivered: 'success',
  cancelled: 'danger',
};

const LABEL_BY_STATUS: Record<Order['status'], string> = {
  pending: 'Pending',
  accepted: 'Accepted',
  preparing: 'Preparing',
  out_for_delivery: 'Out For Delivery',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

type Props = { status: Order['status'] };

export default function OrderStatusChip({ status }: Props) {
  return <Badge label={LABEL_BY_STATUS[status]} tone={TONE_BY_STATUS[status]} />;
}
