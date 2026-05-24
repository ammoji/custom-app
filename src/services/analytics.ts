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
  // PR 34 — Voice + Hindi onboarding funnel.
  //   - `voice_onboarding_started` — shopkeeper tapped a mic
  //     (either the big "Speak about your shop" CTA or a per-field
  //     mic). Tells us which mode + which language is actually
  //     used in production; if `single_field` dominates, the next
  //     UX iteration leans on per-field; if `multi_field`
  //     dominates, lean on the big CTA.
  //   - `voice_onboarding_filled` — server returned at least
  //     one field (multi_field) or a transcript (single_field).
  //     `fields_filled` is the count of non-null values from the
  //     7 target fields; for single_field we set it to 1 so
  //     funnel analyses can blend modes. `transcript_length`
  //     gives us a rough proxy for "how long the shopkeeper
  //     actually spoke" without having to PII-scrape the
  //     aiAuditLog.
  //   - `voice_onboarding_error` — any failure path: permission
  //     denial, no-speech, quota, kill-switch, parse fallback.
  //     `error_code` is one of a small whitelist so funnel
  //     dropoff per cause is groupable.
  // Per Strategic Principle 8 in docs/ROADMAP.md — instrument
  // the funnel at ship time so we don't have to retrofit
  // observability before PR 38.
  voice_onboarding_started: (params: {
    language: 'hi-IN' | 'en-IN';
    mode: 'single_field' | 'multi_field';
  }) => track('voice_onboarding_started', params),
  voice_onboarding_filled: (params: {
    language: 'hi-IN' | 'en-IN';
    mode: 'single_field' | 'multi_field';
    fields_filled: number;
    transcript_length: number;
  }) => track('voice_onboarding_filled', params),
  voice_onboarding_error: (params: {
    language: 'hi-IN' | 'en-IN';
    mode: 'single_field' | 'multi_field';
    error_code: string;
  }) => track('voice_onboarding_error', params),
};
