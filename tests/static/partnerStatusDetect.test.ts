/**
 * HOTFIX-PARTNER-STATUS-DISPLAY §C — +2 detection-unit tests proving
 * the partner-status detector catches a known two-state violation and
 * ignores a known-good (finalized-guarded) usage. Plus an allowlist test.
 */
import { findUnguardedInflightStrings } from './partnerStatusDetect';

const BAD = `
const pickedUp = order.pickedUpAt != null;
const statusLabel = pickedUp
  ? 'On the way to the customer'
  : 'Heading to your shop';
`;

const GOOD = `
const isDelivered = orderStatus === 'delivered';
const isCancelled = orderStatus === 'cancelled';
const isFinalized = isDelivered || isCancelled;
const stateText = isFinalized
  ? isDelivered ? '✅ Delivered' : '❌ Order cancelled'
  : isPickedUp
    ? 'On the way to you'
    : 'Heading to the shop';
`;

const ALLOWLISTED = `
// partner-status-audit:allow — copy reused in a non-order context
const tagline = 'On the way to something great';
`;

describe('partnerStatus detector', () => {
  it('flags a two-state in-flight subtitle with no finalized guard', () => {
    expect(findUnguardedInflightStrings(BAD).length).toBeGreaterThan(0);
  });

  it('ignores in-flight strings guarded by a finalized branch', () => {
    expect(findUnguardedInflightStrings(GOOD)).toEqual([]);
  });

  it('ignores a line-allowlisted usage', () => {
    expect(findUnguardedInflightStrings(ALLOWLISTED)).toEqual([]);
  });
});
