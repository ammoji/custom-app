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
};
