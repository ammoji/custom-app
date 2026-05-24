import { logEvent as fbLogEvent } from 'firebase/analytics';
// PR 38 — DO NOT REMOVE. `useAuthStore` is read inside `track()` to
// short-circuit the parallel-write for anonymous sessions before the
// callable round-trip. Stripping this import (auto-formatter risk
// per code-discipline) defeats that gate and would push every anon
// event through the network.
import { useAuthStore } from '../store/useAuthStore';
import { analytics } from './firebase';
// PR 38.1 — DO NOT REMOVE. featureUsageLog writes now route through
// `orderService.logFeatureUsageEvent` (a Cloud Function callable)
// instead of the Web SDK's `addDoc`. The Web SDK Firestore client
// cannot see RNFB's auth on native (same root cause as PR 6.1's
// signed-upload-URL fix), so direct writes silently failed and the
// collection never accumulated data.
import { orderService } from './orderService';

type EventParams = Record<string, string | number | boolean | undefined>;

/**
 * PR 38 — every analytics event fires through `track()` twice:
 *
 *   1. Firebase Analytics (unchanged from PR 32/34) — feeds
 *      DebugView and BigQuery export. 24–48hr latency, sampling,
 *      no per-user/per-shop queries.
 *   2. Firestore `featureUsageLog/` parallel write — exact, low-
 *      latency, queryable by uid/shopId/role/date for the new
 *      admin dashboard. Fire-and-forget — failure (offline,
 *      rules reject, network blip) is non-fatal and silent
 *      because observability writes must never block UX.
 *
 * The Firestore write is gated by `useAuthStore.uid` — anonymous
 * sessions skip the log (rules require uid match anyway). The
 * `analytics` SDK is web-only and may be null on native; the
 * Firestore write fires on both platforms because `db` always
 * resolves.
 */
function track(name: string, params: EventParams) {
  // Firebase Analytics (web-only — `analytics` is null on native).
  if (analytics) {
    // Strip undefined values — Firebase Analytics rejects them.
    const clean = Object.fromEntries(
      Object.entries(params).filter(([, v]) => v !== undefined),
    ) as Record<string, string | number | boolean>;
    fbLogEvent(analytics, name, clean as Record<string, string | number>);
  }
  // PR 38 — Firestore parallel write. Fire-and-forget.
  void writeFeatureUsageLog(name, params);
}

async function writeFeatureUsageLog(
  name: string,
  params: EventParams,
): Promise<void> {
  try {
    // Anonymous + unauthenticated callers skip the write entirely.
    // The callable would also short-circuit (returns
    // `{ ok:false, reason:'unauthenticated' }`), but skipping client-
    // side avoids a wasted callable round-trip per anon event.
    const uid = useAuthStore.getState().uid;
    if (!uid) return;
    // PR 38.1 — server resolves uid + role + date from `request.auth`
    // and serverTimestamp; the client only forwards the feature name
    // and an optional shopId pulled from the event params.
    const shopId =
      typeof params.shop_id === 'string' ? params.shop_id : undefined;
    await orderService.logFeatureUsageEvent({
      feature: name,
      ...(shopId ? { shopId } : {}),
    });
  } catch (e) {
    // Silent — observability writes never block UX. console.warn
    // (not Sentry-capture) so the noise stays local and offline
    // sessions don't spam the error pipeline.
    // eslint-disable-next-line no-console
    console.warn('[analytics] featureUsageLog write failed:', e);
  }
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

  // ───────────────────────────────────────────────────────────
  // PR 38 — Shop owner core actions.
  // ───────────────────────────────────────────────────────────
  //
  // The events that determine whether a shop owner is using the
  // platform on a typical non-AI day. Mission North Star
  // Strategic Principle 7's "merchant weekly active" pilot metric
  // is computed from these firing or not firing — distinct
  // shopIds with at least one shop_* event in the last 7 days.
  //
  // Time-to-first-menu-item (another Principle 7 metric) is the
  // delta between `shop_signed_in` and the first
  // `shop_menu_item_added` per shop. Both events MUST fire at
  // the natural success moment of the underlying action — log
  // AFTER the server callable returns ok, never before, so
  // failed attempts don't pollute the funnel.
  shop_menu_item_added: (params: {
    shop_id: string;
    source: 'custom' | 'extracted' | 'bootstrap';
  }) => track('shop_menu_item_added', params),
  shop_menu_item_edited: (params: {
    shop_id: string;
    field_changed:
      | 'price'
      | 'mrp'
      | 'stock'
      | 'available'
      | 'name'
      | 'image'
      | 'other';
  }) => track('shop_menu_item_edited', params),
  shop_menu_item_disabled: (params: { shop_id: string }) =>
    track('shop_menu_item_disabled', params),
  shop_menu_bulk_toggle: (params: {
    shop_id: string;
    count: number;
    action: 'enable' | 'disable';
  }) => track('shop_menu_bulk_toggle', params),
  shop_order_accepted: (params: {
    shop_id: string;
    order_id: string;
    minutes_to_accept: number;
  }) => track('shop_order_accepted', params),
  shop_order_status_changed: (params: {
    shop_id: string;
    order_id: string;
    from_status: string;
    to_status: string;
  }) => track('shop_order_status_changed', params),
  shop_eta_set: (params: {
    shop_id: string;
    order_id: string;
    eta_minutes: number;
  }) => track('shop_eta_set', params),
  shop_settings_updated: (params: {
    shop_id: string;
    field:
      | 'delivery_fee'
      | 'min_order'
      | 'hours'
      | 'description'
      | 'image'
      | 'other';
  }) => track('shop_settings_updated', params),
  shop_signed_in: (params: { shop_id: string }) =>
    track('shop_signed_in', params),

  // ───────────────────────────────────────────────────────────
  // PR 38 — Delivery partner actions.
  // ───────────────────────────────────────────────────────────
  delivery_online_toggled: (params: { is_online: boolean }) =>
    track('delivery_online_toggled', params),
  delivery_pickup_accepted: (params: {
    order_id: string;
    shop_id: string;
  }) => track('delivery_pickup_accepted', params),
  delivery_picked_up: (params: { order_id: string }) =>
    track('delivery_picked_up', params),
  delivery_delivered: (params: {
    order_id: string;
    minutes_since_pickup: number;
  }) => track('delivery_delivered', params),
  delivery_signed_in: () => track('delivery_signed_in', {}),

  // ───────────────────────────────────────────────────────────
  // PR 38 — Admin actions.
  // ───────────────────────────────────────────────────────────
  admin_shop_approved: (params: { shop_id: string }) =>
    track('admin_shop_approved', params),
  admin_shop_rejected: (params: { shop_id: string; reason_length: number }) =>
    track('admin_shop_rejected', params),
  admin_shop_suspended: (params: { shop_id: string }) =>
    track('admin_shop_suspended', params),
  admin_shop_unsuspended: (params: { shop_id: string }) =>
    track('admin_shop_unsuspended', params),
  admin_delivery_approved: (params: { uid: string }) =>
    track('admin_delivery_approved', params),
  admin_delivery_rejected: (params: { uid: string }) =>
    track('admin_delivery_rejected', params),
  admin_user_role_set: (params: {
    uid: string;
    role: 'admin' | 'shop_owner' | 'delivery';
  }) => track('admin_user_role_set', params),
  admin_signed_in: () => track('admin_signed_in', {}),
};
