/**
 * PR-NEXT-COD-UX (Case 8) — tests for the client-side Delivered-
 * button gate. Mirrors `validateMarkDeliveredCodGate`'s server
 * contract so the two stay in lockstep (any future server change
 * needs to flow through this matrix or surface as a regression).
 */
import { canShowDeliveredButton } from '../../src/utils/codDeliveryGate';

describe('canShowDeliveredButton', () => {
  test('online + paid → safe to show Delivered', () => {
    expect(
      canShowDeliveredButton({
        paymentMethod: 'online',
        paymentStatus: 'paid',
      }),
    ).toBe(true);
  });

  test('online + pending → hide Delivered', () => {
    expect(
      canShowDeliveredButton({
        paymentMethod: 'online',
        paymentStatus: 'pending',
      }),
    ).toBe(false);
  });

  test('cod + paid (cash settlement via pill) → safe to show Delivered', () => {
    expect(
      canShowDeliveredButton({
        paymentMethod: 'cod',
        paymentStatus: 'paid',
      }),
    ).toBe(true);
  });

  test('cod + paid (online conversion via payCodOrder) → safe to show Delivered', () => {
    // Same gate decision regardless of `paidMethod` — gate keys on
    // `paymentStatus` only.
    expect(
      canShowDeliveredButton({
        paymentMethod: 'cod',
        paymentStatus: 'paid',
      }),
    ).toBe(true);
  });

  test('cod + pending → hide Delivered (show Cash/UPI pills)', () => {
    expect(
      canShowDeliveredButton({
        paymentMethod: 'cod',
        paymentStatus: 'pending',
      }),
    ).toBe(false);
  });

  test('cod + failed → hide Delivered', () => {
    expect(
      canShowDeliveredButton({
        paymentMethod: 'cod',
        paymentStatus: 'failed',
      }),
    ).toBe(false);
  });

  test('cod + missing paymentStatus → hide Delivered (defensive)', () => {
    // Legacy COD orders pre-PR-NEXT-3 may have no `paymentStatus`;
    // gate must err on the side of "show pills" rather than letting
    // the partner mash Delivered into a server rejection.
    expect(
      canShowDeliveredButton({
        paymentMethod: 'cod',
        paymentStatus: undefined,
      }),
    ).toBe(false);
  });
});
