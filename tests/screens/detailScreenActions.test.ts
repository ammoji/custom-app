/**
 * Counterpart to dashboardCardActions.test.ts. The Category A
 * actions migrated FROM the dashboards TO these detail screens.
 * Pin the destination so the migration can't accidentally lose
 * data: a future contributor cleaning up "unused" imports must
 * not break the detail screen's action buttons.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const SHOP_DETAIL = fs.readFileSync(
  path.resolve(
    __dirname,
    '../../src/screens/shop/ShopOrderDetailScreen.tsx',
  ),
  'utf8',
);
const DELIVERY_DETAIL = fs.readFileSync(
  path.resolve(
    __dirname,
    '../../src/screens/delivery/DeliveryOrderDetailScreen.tsx',
  ),
  'utf8',
);

describe('ShopOrderDetailScreen — Category A actions live here', () => {
  test('imports ACTION_LABELS from the state-machine module', () => {
    expect(SHOP_DETAIL).toMatch(/ACTION_LABELS/);
  });

  test('imports nextActionsFor from the state-machine module', () => {
    expect(SHOP_DETAIL).toMatch(/nextActionsFor/);
  });

  test('renders a Button element (the action button shape)', () => {
    expect(SHOP_DETAIL).toMatch(/<Button[\s\S]*?ACTION_LABELS\[next\]/);
  });
});

describe('DeliveryOrderDetailScreen — Accept this pickup lives here', () => {
  test('renders an "Accept this pickup" button title', () => {
    expect(DELIVERY_DETAIL).toMatch(/Accept this pickup/);
  });

  test('wires the button to the hook\'s handleClaim flow', () => {
    expect(DELIVERY_DETAIL).toMatch(/handleClaim/);
  });
});
