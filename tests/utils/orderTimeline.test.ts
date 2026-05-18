/**
 * PR 11 — Pure helper tests for the admin order timeline.
 *
 * These pin the actor-parsing and status-label-mapping behaviour so
 * the rendered timeline UI stays correct as new server-side
 * statusHistory shapes appear (e.g. PR 8.1 widening actorRole to
 * include 'customer'; future namespaced system tokens).
 */
import {
  formatTimelineActor,
  labelForTimelineStatus,
} from '../../src/utils/orderTimeline';

describe('formatTimelineActor', () => {
  test('truncates a long uid suffix to 4 chars + ellipsis', () => {
    expect(formatTimelineActor('customer:7XkjabcdEFG')).toBe('customer:7Xkj...');
    expect(formatTimelineActor('shopOwner:JK2LmnopQ12')).toBe(
      'shopOwner:JK2L...',
    );
    expect(formatTimelineActor('admin:abc12345xyz')).toBe('admin:abc1...');
    expect(formatTimelineActor('delivery:9MxsabcDEF')).toBe(
      'delivery:9Mxs...',
    );
    // PR 8.1 widening: customer is now a first-class actor role
    // (previously cancelMyRecentPaidOrder wrote `system`). Pin it.
    expect(formatTimelineActor('customer:abcdefghij')).toBe(
      'customer:abcd...',
    );
  });

  test('preserves namespaced system tokens with short suffixes', () => {
    expect(formatTimelineActor('system:cleanup')).toBe('system:cleanup');
    expect(formatTimelineActor('system:cleanup-reconciliation')).toBe(
      'system:clea...',
    );
    expect(formatTimelineActor('client-confirm:abc1234')).toBe(
      'client-confirm:abc1234',
    );
  });

  test('returns bare tokens unchanged when there is no ":"', () => {
    expect(formatTimelineActor('system')).toBe('system');
    expect(formatTimelineActor('razorpay-webhook')).toBe('razorpay-webhook');
  });

  test('renders "unknown" for empty / null / undefined', () => {
    expect(formatTimelineActor('')).toBe('unknown');
    expect(formatTimelineActor(null)).toBe('unknown');
    expect(formatTimelineActor(undefined)).toBe('unknown');
  });
});

describe('labelForTimelineStatus', () => {
  test('maps the canonical Order status union to display labels', () => {
    expect(labelForTimelineStatus('pending')).toBe('Pending');
    expect(labelForTimelineStatus('accepted')).toBe('Accepted');
    expect(labelForTimelineStatus('preparing')).toBe('Preparing');
    // PR 12 — admin-context label. Customer-facing override
    // ("Out for delivery") is in OrderStatusChip, not in this map.
    expect(labelForTimelineStatus('ready_for_pickup')).toBe('Ready for Pickup');
    expect(labelForTimelineStatus('delivered')).toBe('Delivered');
    expect(labelForTimelineStatus('cancelled')).toBe('Cancelled');
  });

  test('maps payment + refund sub-states that appear in statusHistory', () => {
    // These statuses are written by the Razorpay webhook + refund
    // flows but are NOT part of Order['status']. The timeline UI
    // must render them too.
    expect(labelForTimelineStatus('paid')).toBe('Paid');
    expect(labelForTimelineStatus('authorized')).toBe('Payment authorized');
    expect(labelForTimelineStatus('amount_mismatch')).toBe('Amount mismatch');
    expect(labelForTimelineStatus('refund_pending')).toBe('Refund pending');
    expect(labelForTimelineStatus('refund_failed')).toBe('Refund failed');
    expect(labelForTimelineStatus('refunded')).toBe('Refunded');
  });

  test('falls back to the raw token for unknown statuses (no silent drops)', () => {
    // If the server adds a new statusHistory token before the client
    // knows about it, render the raw value rather than a blank cell.
    expect(labelForTimelineStatus('newly_invented_state')).toBe(
      'newly_invented_state',
    );
  });
});
