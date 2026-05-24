import { logEvent as fbLogEvent } from 'firebase/analytics';
import { analytics } from './firebase';

type EventParams = Record<string, string | number | boolean | undefined>;

function track(name: string, params: EventParams) {
  if (!analytics) return;
  // Strip undefined values — Firebase Analytics rejects them.
  const clean = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined),
  ) as Record<string, string | number | boolean>;
  fbLogEvent(analytics, name, clean as Record<string, string | number>);
}

export const Analytics = {
  view_shop_list: (params: { count: number }) => track('view_shop_list', params),
  view_shop_detail: (params: { shop_id: string; shop_name: string }) =>
    track('view_shop_detail', params),
  add_to_cart: (params: {
    product_id: string;
    shop_id: string;
    price: number;
    quantity: number;
  }) => track('add_to_cart', params),
  remove_from_cart: (params: { product_id: string }) =>
    track('remove_from_cart', params),
  begin_checkout: (params: { value: number; item_count: number }) =>
    track('begin_checkout', params),
  place_order: (params: { order_id: string; value: number; payment_method: string }) =>
    track('place_order', params),
  payment_success: (params: { order_id: string; value: number }) =>
    track('payment_success', params),
  payment_failed: (params: { order_id: string; reason: string }) =>
    track('payment_failed', params),
  view_order: (params: { order_id: string; status: string }) =>
    track('view_order', params),
  // PR 32 — AI photo-to-catalog funnel. The three events span the
  // funnel:
  //   - `scan_menu_started` — owner taps the camera/gallery CTA in
  //     ScanMenuScreen. Fires once per attempt. `source` tells us
  //     which surface (camera vs gallery) gets used in production;
  //     useful for deciding which to default to.
  //   - `scan_menu_extracted` — server returned a parsed item set.
  //     `itemCount` is what made it to the review screen,
  //     `droppedCount` is what Claude returned but the server
  //     filtered (unknown category / blank name). High drop rates
  //     are a prompt-quality signal.
  //   - `scan_menu_committed` — owner tapped "Add N to menu" and the
  //     batch write succeeded. `addedCount` + `skippedCount` mirror
  //     the server response so funnel charts can show extraction →
  //     review → commit dropoff per shop.
  // Per Strategic Principle 8 in docs/ROADMAP.md: instrument the
  // funnel at ship time so we don't have to retrofit observability
  // before PR 38.
  scan_menu_started: (params: { source: 'camera' | 'gallery' }) =>
    track('scan_menu_started', params),
  scan_menu_extracted: (params: {
    item_count: number;
    dropped_count: number;
  }) => track('scan_menu_extracted', params),
  scan_menu_committed: (params: {
    added_count: number;
    skipped_count: number;
  }) => track('scan_menu_committed', params),
};
