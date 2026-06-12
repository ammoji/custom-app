/**
 * PR-NEXT-BUNDLE-I §A — +10 tests for the dashboard card view-model
 * helpers (deriveDeliveryDashboardCards + deriveShopDashboardCards).
 *
 * Deliberate-break demo:
 *   Change the attention card's `variant` line to always return
 *   'default' → the "urgent for non-zero count" test fails.
 *   Restore. Tests pass.
 */
import {
  deriveDeliveryDashboardCards,
  deriveShopDashboardCards,
} from '../../src/utils/deliveryDashboardViewModel';

describe('deriveDeliveryDashboardCards', () => {
  it('all-zero → 5 cards, all default variant, all null scrollToSection', () => {
    const cards = deriveDeliveryDashboardCards({
      activeCount: 0,
      availableCount: 0,
      comingUpCount: 0,
      historyCount: 0,
      attentionCount: 0,
    });
    expect(cards).toHaveLength(5);
    expect(cards.every(c => c.variant === 'default')).toBe(true);
    expect(cards.every(c => c.scrollToSection === null)).toBe(true);
  });

  it('mixed counts → counts mapped, scrollToSection set for non-zero', () => {
    const cards = deriveDeliveryDashboardCards({
      activeCount: 2,
      availableCount: 0,
      comingUpCount: 3,
      historyCount: 5,
      attentionCount: 1,
    });
    const byId = Object.fromEntries(cards.map(c => [c.id, c]));
    expect(byId.active.count).toBe(2);
    expect(byId.active.scrollToSection).toBe('my-active');
    expect(byId.available.scrollToSection).toBe(null);
    expect(byId.coming.count).toBe(3);
    expect(byId.history.count).toBe(5);
  });

  it('attention non-zero → urgent variant + attention scrollToSection', () => {
    const cards = deriveDeliveryDashboardCards({
      activeCount: 0,
      availableCount: 0,
      comingUpCount: 0,
      historyCount: 0,
      attentionCount: 4,
    });
    const attention = cards.find(c => c.id === 'attention')!;
    expect(attention.variant).toBe('urgent');
    expect(attention.count).toBe(4);
    expect(attention.scrollToSection).toBe('attention');
  });

  it('attention zero → default variant (not urgent)', () => {
    const cards = deriveDeliveryDashboardCards({
      activeCount: 1,
      availableCount: 1,
      comingUpCount: 1,
      historyCount: 1,
      attentionCount: 0,
    });
    const attention = cards.find(c => c.id === 'attention')!;
    expect(attention.variant).toBe('default');
  });

  it('card order is stable: active, available, coming, history, attention', () => {
    const cards = deriveDeliveryDashboardCards({
      activeCount: 1,
      availableCount: 1,
      comingUpCount: 1,
      historyCount: 1,
      attentionCount: 1,
    });
    expect(cards.map(c => c.id)).toEqual([
      'active',
      'available',
      'coming',
      'history',
      'attention',
    ]);
  });
});

describe('deriveShopDashboardCards', () => {
  it('all-zero → 5 cards, all default variant', () => {
    const cards = deriveShopDashboardCards({
      pendingCount: 0,
      preparingCount: 0,
      readyCount: 0,
      deliveredTodayCount: 0,
      attentionCount: 0,
    });
    expect(cards).toHaveLength(5);
    expect(cards.every(c => c.variant === 'default')).toBe(true);
  });

  it('mixed counts mapped correctly', () => {
    const cards = deriveShopDashboardCards({
      pendingCount: 3,
      preparingCount: 2,
      readyCount: 1,
      deliveredTodayCount: 7,
      attentionCount: 0,
    });
    const byId = Object.fromEntries(cards.map(c => [c.id, c]));
    expect(byId.pending.count).toBe(3);
    expect(byId.preparing.count).toBe(2);
    expect(byId.ready.count).toBe(1);
    expect(byId.delivered.count).toBe(7);
  });

  it('attention non-zero → urgent variant', () => {
    const cards = deriveShopDashboardCards({
      pendingCount: 0,
      preparingCount: 0,
      readyCount: 0,
      deliveredTodayCount: 0,
      attentionCount: 2,
    });
    expect(cards.find(c => c.id === 'attention')!.variant).toBe('urgent');
  });

  it('shop card order is stable', () => {
    const cards = deriveShopDashboardCards({
      pendingCount: 1,
      preparingCount: 1,
      readyCount: 1,
      deliveredTodayCount: 1,
      attentionCount: 1,
    });
    expect(cards.map(c => c.id)).toEqual([
      'pending',
      'preparing',
      'ready',
      'delivered',
      'attention',
    ]);
  });

  it('deliveredToday scrollToSection points to history when non-zero', () => {
    const cards = deriveShopDashboardCards({
      pendingCount: 0,
      preparingCount: 0,
      readyCount: 0,
      deliveredTodayCount: 3,
      attentionCount: 0,
    });
    expect(cards.find(c => c.id === 'delivered')!.scrollToSection).toBe('history');
  });
});
