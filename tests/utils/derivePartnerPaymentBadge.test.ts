/**
 * PR-NEXT-BUNDLE-G §E — DO NOT REMOVE. Tests for derivePartnerPaymentBadge.
 * +5 tests. Deliberate-break: swap paid_online / paid_cash return values
 * in the helper; branch tests must fail.
 */

import { derivePartnerPaymentBadge } from '../../src/utils/derivePartnerPaymentBadge';

describe('derivePartnerPaymentBadge', () => {
  it('online + paid → paid_online', () => {
    const badge = derivePartnerPaymentBadge({
      paymentMethod: 'online',
      paymentStatus: 'paid',
    });
    expect(badge.kind).toBe('paid_online');
    expect((badge as any).label).toContain('no cash to collect');
  });

  it('cod + paid + paidMethod cash → paid_cash', () => {
    const badge = derivePartnerPaymentBadge({
      paymentMethod: 'cod',
      paymentStatus: 'paid',
      paidMethod: 'cash',
    });
    expect(badge.kind).toBe('paid_cash');
    expect((badge as any).label).toContain('Cash received');
  });

  it('cod + paid + paidMethod online (COD-converted) → paid_online', () => {
    const badge = derivePartnerPaymentBadge({
      paymentMethod: 'cod',
      paymentStatus: 'paid',
      paidMethod: 'online',
    });
    expect(badge.kind).toBe('paid_online');
  });

  it('cod + unpaid → awaiting_cod', () => {
    const badge = derivePartnerPaymentBadge({
      paymentMethod: 'cod',
      paymentStatus: 'unpaid',
    });
    expect(badge.kind).toBe('awaiting_cod');
    expect((badge as any).label).toContain('COD');
  });

  it('null fields → none', () => {
    expect(derivePartnerPaymentBadge({}).kind).toBe('none');
    expect(derivePartnerPaymentBadge({ paymentMethod: null, paymentStatus: null }).kind).toBe('none');
  });
});
