import React from 'react';
import Badge from '../common/Badge';
import { Order } from '../../types';
import {
  displayOrderStatus,
  type DisplayedState,
} from '../../utils/orderStatusDisplay';

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

// Tone is purely visual — keyed on the *displayed* state (which
// includes the synthetic 'picked_up') so the chip's color tracks
// what the label says. picked_up reads as in-transit positive
// progress, hence 'info' (matches ready_for_pickup intentionally
// — both are mid-flight states).
const TONE_BY_STATE: Record<DisplayedState, Tone> = {
  pending: 'warning',
  accepted: 'info',
  preparing: 'info',
  ready_for_pickup: 'info',
  picked_up: 'info',
  delivered: 'success',
  cancelled: 'danger',
};

type Props = {
  // Back-compat: existing callers pass just `status`. PR-NEXT-1
  // adds optional `pickedUpAt` so the helper can resolve the
  // synthetic 'picked_up' state. Without it the chip falls back
  // to the pre-PR behavior (treats `ready_for_pickup` as a single
  // state — which on the customer audience used to read "Out for
  // delivery" unconditionally and was the root cause of finding
  // #10's contradictory labels). Customer screens MUST pass
  // `pickedUpAt`; internal/admin screens benefit too.
  status: Order['status'];
  pickedUpAt?: number | null;
  deliveredAt?: number | null;
  // Defaults to 'admin' (admin / shop / delivery views resolve
  // through the audience-keyed label table). Customer screens
  // pass 'customer'. Old callers passing 'internal' map to
  // 'admin' for back-compat (the label tables for admin /
  // shopkeeper / delivery diverge slightly post-PR-NEXT-1; if
  // you see a chip rendering the wrong shop-side text, swap to
  // the appropriate audience explicitly).
  audience?: 'customer' | 'shopkeeper' | 'delivery' | 'admin' | 'internal';
};

export default function OrderStatusChip({
  status,
  pickedUpAt,
  deliveredAt,
  audience = 'admin',
}: Props) {
  const resolvedAudience = audience === 'internal' ? 'admin' : audience;
  const display = displayOrderStatus(
    { status, pickedUpAt, deliveredAt },
    resolvedAudience,
  );
  return <Badge label={display.label} tone={TONE_BY_STATE[display.state]} />;
}
