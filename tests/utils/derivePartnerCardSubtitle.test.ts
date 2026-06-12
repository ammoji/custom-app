/**
 * PR-NEXT-BUNDLE-H §C — +5 tests for derivePartnerCardSubtitle.
 *
 * Deliberate-break demo:
 *   Remove the `orderStatus === 'delivered'` branch → delivered test fails.
 *   Restore. Tests pass.
 */
import { derivePartnerCardSubtitle } from '../../src/utils/derivePartnerCardSubtitle';

describe('derivePartnerCardSubtitle', () => {
  it('delivered → "✅ Delivered"', () => {
    expect(
      derivePartnerCardSubtitle({ orderStatus: 'delivered', pickedUpAt: 1700000 }),
    ).toBe('✅ Delivered');
  });

  it('cancelled → "❌ Order cancelled"', () => {
    expect(
      derivePartnerCardSubtitle({ orderStatus: 'cancelled', pickedUpAt: null }),
    ).toBe('❌ Order cancelled');
  });

  it('picked up (not delivered) → "🛵 On the way to you"', () => {
    expect(
      derivePartnerCardSubtitle({ orderStatus: 'in_transit', pickedUpAt: 1700000 }),
    ).toBe('🛵 On the way to you');
  });

  it('not picked up → "📦 Heading to the shop"', () => {
    expect(
      derivePartnerCardSubtitle({ orderStatus: 'ready_for_pickup', pickedUpAt: null }),
    ).toBe('📦 Heading to the shop');
  });

  it('null/undefined inputs → "📦 Heading to the shop" (safe default)', () => {
    expect(
      derivePartnerCardSubtitle({ orderStatus: null, pickedUpAt: undefined }),
    ).toBe('📦 Heading to the shop');
  });
});
