/**
 * PR-NEXT-6 (finding #16d) — pin the payment-method copy across
 * every settlement variant the order-detail screens render. The
 * helper is consumed by ShopOrderDetail / OrderDetail / (eventually)
 * admin order detail.
 */
import { formatPaymentMethod } from '../../src/utils/formatPaymentMethod';

describe('formatPaymentMethod', () => {
  test('online checkout, paid up front', () => {
    expect(
      formatPaymentMethod({
        paymentMethod: 'online',
        paidMethod: 'online',
        paymentStatus: 'paid',
      }),
    ).toBe('Online (paid up front)');
  });

  test('COD that customer converted mid-flow via payCodOrder → online', () => {
    expect(
      formatPaymentMethod({
        paymentMethod: 'cod',
        paidMethod: 'online',
        paymentStatus: 'paid',
      }),
    ).toBe('Cash on delivery — paid online (converted)');
  });

  test('COD settled as cash by the partner at the doorstep', () => {
    expect(
      formatPaymentMethod({
        paymentMethod: 'cod',
        paidMethod: 'cash',
        paymentStatus: 'paid',
      }),
    ).toBe('Cash on delivery — paid in cash');
  });

  test('legacy COD paid without paidMethod stamp (pre-PR-NEXT-3)', () => {
    // Don't guess at the settlement method — name the choice + the
    // paid status truthfully.
    expect(
      formatPaymentMethod({
        paymentMethod: 'cod',
        paidMethod: null,
        paymentStatus: 'paid',
      }),
    ).toBe('Cash on delivery — paid');
  });

  test('any non-paid status → "Not yet paid" regardless of method', () => {
    // Critical UX gate: a "pending" online order must not display
    // "Online (paid up front)" — that would lie to the shop and
    // customer about an outstanding balance.
    for (const status of ['pending', 'failed', 'expired', undefined, null]) {
      expect(
        formatPaymentMethod({
          paymentMethod: 'online',
          paidMethod: 'online',
          paymentStatus: status as any,
        }),
      ).toBe('Not yet paid');
      expect(
        formatPaymentMethod({
          paymentMethod: 'cod',
          paidMethod: 'cash',
          paymentStatus: status as any,
        }),
      ).toBe('Not yet paid');
    }
  });

  test('paid but unknown paymentMethod → generic "Paid" (defensive, no mislabel)', () => {
    expect(
      formatPaymentMethod({
        paymentMethod: undefined,
        paidMethod: 'online',
        paymentStatus: 'paid',
      }),
    ).toBe('Paid');
  });
});
