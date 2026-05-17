/**
 * Structural pins for the view-first dashboard cards pass.
 *
 * Category A (first-commitment) actions must NOT live on the
 * dashboards. They migrated to the detail screens so the user has
 * seen items + customer + address + payment before committing.
 *
 * Category B (mid-flow status updates: "I've picked it up",
 * "Delivered") MUST stay inline on the dashboard — real-world
 * delivery use is one-handed and under time pressure. Forcing a
 * tap-to-detail for these creates friction with zero risk reduction
 * (the commitment was already made when the partner claimed the
 * order).
 *
 * RNTL is still out of scope, so these are coarse string-search
 * tests. They pin design intent. If a future contributor tries to
 * "re-add a quick Accept button to the dashboard for convenience"
 * or "remove the history section because nobody uses it", the
 * conversation happens at PR review instead of after a real-world
 * accidental-Accept repro.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const SHOP_DASH = fs.readFileSync(
  path.resolve(
    __dirname,
    '../../src/screens/shop/ShopOwnerDashboardScreen.tsx',
  ),
  'utf8',
);
const DELIVERY_DASH = fs.readFileSync(
  path.resolve(
    __dirname,
    '../../src/screens/delivery/DeliveryDashboardScreen.tsx',
  ),
  'utf8',
);

describe('ShopOwnerDashboardScreen — Category A actions removed', () => {
  test('does NOT import ACTION_LABELS', () => {
    // The detail screen still owns this import; the dashboard must
    // not. If you see this test fail, you probably re-added an
    // inline action button — move it to ShopOrderDetailScreen.
    expect(SHOP_DASH).not.toMatch(/ACTION_LABELS/);
  });

  test('does NOT import nextActionsFor', () => {
    expect(SHOP_DASH).not.toMatch(/nextActionsFor/);
  });

  test('does NOT define a handleAction function', () => {
    expect(SHOP_DASH).not.toMatch(/handleAction\s*=/);
  });

  test('does NOT import the Button component (only the detail screen uses it now)', () => {
    // Coarse but effective: removing every action button removes
    // the dashboard's last need for the Button primitive. If a
    // future edit reintroduces it, this test catches the regression.
    expect(SHOP_DASH).not.toMatch(/from '\.\.\/\.\.\/components\/common\/Button'/);
  });

  test('does NOT keep the unused `pending: Record` state slot', () => {
    expect(SHOP_DASH).not.toMatch(/Record<string,\s*OrderStatus/);
  });

  test('card body still navigates to ShopOrderDetail (view-first navigation preserved)', () => {
    expect(SHOP_DASH).toMatch(
      /nav\.navigate\(\s*['"]ShopOrderDetail['"]/,
    );
  });
});

describe('DeliveryDashboardScreen — AvailablePickupCard Accept removed', () => {
  test('AvailablePickupCard component definition does NOT contain an Accept Button', () => {
    // Scope the search to the AvailablePickupCard body so an
    // accidental match against ActiveDeliveryCard (Category B,
    // which legitimately has buttons) can't false-pass.
    const match = DELIVERY_DASH.match(
      /function\s+AvailablePickupCard[\s\S]*?\n\}\n/,
    );
    expect(match).toBeTruthy();
    const body = match![0];
    expect(body).not.toMatch(/<Button/);
    expect(body).not.toMatch(/title=['"]Accept['"]/);
    expect(body).not.toMatch(/onAccept/);
  });

  test('handleClaim handler and pendingClaim state are gone', () => {
    expect(DELIVERY_DASH).not.toMatch(/const\s+handleClaim\s*=/);
    expect(DELIVERY_DASH).not.toMatch(/pendingClaim/);
  });

  test('available card body still navigates to DeliveryOrderDetail', () => {
    expect(DELIVERY_DASH).toMatch(
      /nav\.navigate\(\s*['"]DeliveryOrderDetail['"]/,
    );
  });
});

describe('DeliveryDashboardScreen — Category B (mid-flow) preserved', () => {
  test('ActiveDeliveryCard component still defines onPickedUp and onDelivered props', () => {
    // Pinning the Category B inline buttons. If a future PR
    // overreaches and removes these too, this test fails and the
    // reviewer can point to the Category B / Category A split.
    const match = DELIVERY_DASH.match(
      /function\s+ActiveDeliveryCard[\s\S]*?\n\}\n/,
    );
    expect(match).toBeTruthy();
    const body = match![0];
    expect(body).toMatch(/onPickedUp/);
    expect(body).toMatch(/onDelivered/);
    expect(body).toMatch(/<Button/);
  });

  test('handlePickedUp and handleDelivered handlers still present on dashboard', () => {
    expect(DELIVERY_DASH).toMatch(/const\s+handlePickedUp\s*=/);
    expect(DELIVERY_DASH).toMatch(/const\s+handleDelivered\s*=/);
  });
});

describe('DeliveryDashboardScreen — Delivery History section added', () => {
  test('defines a DeliveryHistoryCard component', () => {
    expect(DELIVERY_DASH).toMatch(/function\s+DeliveryHistoryCard/);
  });

  test('derives a deliveredMine memo from the mine array', () => {
    expect(DELIVERY_DASH).toMatch(/deliveredMine/);
    expect(DELIVERY_DASH).toMatch(/status === ['"]delivered['"]/);
    expect(DELIVERY_DASH).toMatch(/deliveredAt/);
  });

  test('renders a "Delivery History" section header (the user-visible label)', () => {
    expect(DELIVERY_DASH).toMatch(/Delivery History/);
  });

  test('history card does NOT show customer phone (privacy parity with available pickups)', () => {
    const match = DELIVERY_DASH.match(
      /function\s+DeliveryHistoryCard[\s\S]*?\n\}\n/,
    );
    expect(match).toBeTruthy();
    const body = match![0];
    // The dashboard exposes deliveryAddress.phone in ActiveDeliveryCard
    // (Category B — partner has already committed). The history
    // card explicitly omits it. This pins the omission.
    expect(body).not.toMatch(/deliveryAddress\.phone/);
    expect(body).not.toMatch(/callPhone/);
  });

  test('history card uses formatRelativeDeliveryTime (not raw timestamp)', () => {
    expect(DELIVERY_DASH).toMatch(/formatRelativeDeliveryTime/);
  });

  test('history rows navigate to DeliveryOrderDetail (the existing delivered-state view handles them)', () => {
    const match = DELIVERY_DASH.match(
      /function\s+DeliveryHistoryCard[\s\S]*?\n\}\n/,
    );
    expect(match).toBeTruthy();
    // Navigation is wired at the call-site, not inside the
    // component body, so check both the call-site renderItem and
    // the prop name on the component.
    expect(match![0]).toMatch(/onPress/);
    expect(DELIVERY_DASH).toMatch(
      /DeliveryHistoryCard[\s\S]{0,200}DeliveryOrderDetail/,
    );
  });
});
