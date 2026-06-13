/**
 * PR-NEXT-BUNDLE-K §A — Unit tests for backfill-products-status.ts
 * pure helper `needsStatusBackfill`.
 */

import { needsStatusBackfill } from '../../scripts/backfill-products-status';

describe('needsStatusBackfill', () => {
  it('returns true when status field is absent', () => {
    expect(needsStatusBackfill({ name: 'Amul Milk', mrp: 28 })).toBe(true);
  });

  it('returns false when status is already approved', () => {
    expect(needsStatusBackfill({ status: 'approved' })).toBe(false);
  });

  it('returns false when status is pending (user-proposed)', () => {
    expect(needsStatusBackfill({ status: 'pending' })).toBe(false);
  });

  it('returns true when data is undefined', () => {
    expect(needsStatusBackfill(undefined)).toBe(true);
  });

  it('returns false when status is rejected', () => {
    expect(needsStatusBackfill({ status: 'rejected' })).toBe(false);
  });
});
