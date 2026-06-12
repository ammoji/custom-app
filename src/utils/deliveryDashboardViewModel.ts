/**
 * PR-NEXT-BUNDLE-I §A — pure helpers that derive the top-of-screen
 * card grid view model from the dashboard's existing data sources.
 *
 * Two helpers: one per role (delivery / shop). Both return the same
 * DashboardCard shape so DashboardCardGrid is role-agnostic.
 *
 * Pinned by tests/utils/deliveryDashboardViewModel.test.ts.
 */

export type DashboardCard = {
  id: 'active' | 'available' | 'coming' | 'history' | 'attention' | 'pending' | 'preparing' | 'ready' | 'delivered';
  label: string;
  count: number;
  icon: string;
  /** urgent → red-tint border for attention items with non-zero count */
  variant: 'default' | 'urgent';
  /** null = tap is a no-op (empty section) */
  scrollToSection: string | null;
};

export function deriveDeliveryDashboardCards(input: {
  activeCount: number;
  availableCount: number;
  comingUpCount: number;
  historyCount: number;
  attentionCount: number;
}): DashboardCard[] {
  return [
    {
      id: 'active',
      label: 'Active Deliveries',
      count: input.activeCount,
      icon: '🛵',
      variant: 'default',
      scrollToSection: input.activeCount > 0 ? 'my-active' : null,
    },
    {
      id: 'available',
      label: 'Available Now',
      count: input.availableCount,
      icon: '📦',
      variant: 'default',
      scrollToSection: input.availableCount > 0 ? 'available' : null,
    },
    {
      id: 'coming',
      label: 'Coming Up',
      count: input.comingUpCount,
      icon: '⏳',
      variant: 'default',
      scrollToSection: input.comingUpCount > 0 ? 'coming-up' : null,
    },
    {
      id: 'history',
      label: 'Delivery History',
      count: input.historyCount,
      icon: '📋',
      variant: 'default',
      scrollToSection: input.historyCount > 0 ? 'history' : null,
    },
    {
      id: 'attention',
      label: 'Reviews & Ratings',
      count: input.attentionCount,
      icon: '⚠️',
      variant: input.attentionCount > 0 ? 'urgent' : 'default',
      scrollToSection: input.attentionCount > 0 ? 'attention' : null,
    },
  ];
}

export function deriveShopDashboardCards(input: {
  pendingCount: number;
  preparingCount: number;
  readyCount: number;
  deliveredTodayCount: number;
  attentionCount: number;
}): DashboardCard[] {
  return [
    {
      id: 'pending',
      label: 'Pending',
      count: input.pendingCount,
      icon: '🔔',
      variant: 'default',
      scrollToSection: input.pendingCount > 0 ? 'pending' : null,
    },
    {
      id: 'preparing',
      label: 'Preparing',
      count: input.preparingCount,
      icon: '🍳',
      variant: 'default',
      scrollToSection: input.preparingCount > 0 ? 'preparing' : null,
    },
    {
      id: 'ready',
      label: 'Ready',
      count: input.readyCount,
      icon: '✅',
      variant: 'default',
      scrollToSection: input.readyCount > 0 ? 'ready' : null,
    },
    {
      id: 'delivered',
      label: 'Delivered Today',
      count: input.deliveredTodayCount,
      icon: '🏁',
      variant: 'default',
      scrollToSection: input.deliveredTodayCount > 0 ? 'history' : null,
    },
    {
      id: 'attention',
      label: 'Reviews & Ratings',
      count: input.attentionCount,
      icon: '⚠️',
      variant: input.attentionCount > 0 ? 'urgent' : 'default',
      scrollToSection: input.attentionCount > 0 ? 'attention' : null,
    },
  ];
}
