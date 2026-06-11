/**
 * PR-NEXT-BUNDLE-A §C (Finding #12a) — 3 unit tests for the
 * `shouldPoll` pure helper exported from `useLivePartnerEta`.
 *
 * The hook itself is a React hook that requires RNTL/renderHook to
 * exercise directly; this project does not have that dependency
 * (per test-discipline.md). Instead we pin the polling-gate
 * decision via the extracted `shouldPoll` pure function, following
 * the same pattern as `useOnlineDeliveryCount`'s `nextPollState`.
 *
 * Three cases per the spec:
 *   1. enabled=true, status='ready_for_pickup' → polls (not finalized)
 *   2. enabled=true, status='delivered'        → does NOT poll
 *   3. enabled=true, status='cancelled'        → does NOT poll
 */
import { shouldPoll } from '../../src/hooks/useLivePartnerEta';

const ORDER_ID = 'order_abc123';

describe('useLivePartnerEta — shouldPoll gate', () => {
  test('enabled=true, status=ready_for_pickup → should poll (not a finalized status)', () => {
    expect(
      shouldPoll({
        orderId: ORDER_ID,
        enabled: true,
        orderStatus: 'ready_for_pickup',
      }),
    ).toBe(true);
  });

  test('enabled=true, status=delivered → should NOT poll; state would be cleared', () => {
    expect(
      shouldPoll({
        orderId: ORDER_ID,
        enabled: true,
        orderStatus: 'delivered',
      }),
    ).toBe(false);
  });

  test('enabled=true, status=cancelled → should NOT poll; state would be cleared', () => {
    expect(
      shouldPoll({
        orderId: ORDER_ID,
        enabled: true,
        orderStatus: 'cancelled',
      }),
    ).toBe(false);
  });
});
