import { httpsCallable } from '@firebase/functions';
import { firebase as nativeFirebase } from '@react-native-firebase/app';
import '@react-native-firebase/functions';
import {
    collection,
    doc,
    getDocs,
    limit,
    onSnapshot,
    orderBy,
    query,
    Timestamp,
    where,
} from 'firebase/firestore';
import { trace } from 'firebase/performance';
import { Platform } from 'react-native';
import type {
    Address,
    CartItem,
    DeliveryChargeTier,
    DeliveryLocation,
    DeliveryRequest,
    ExtractedMenuItem,
    MenuItem,
    NewMenuItemInput,
    Order,
    ParsedShopFields,
    PaymentMethod,
    Shop,
    ShopCustomer,
    SubstitutionPreference,
    UserInfo,
} from '../types';
import type { OrderStatus } from '../utils/orderStateMachine';
import { db, functions, perf } from './firebase';
import { buildPlaceOrderPayload } from './placeOrderPayload';
import { Sentry } from './sentry';

const isNative = Platform.OS !== 'web';

// Cloud Functions are deployed in asia-south1 (see firebase.ts).
// RNFB defaults to us-central1, so we must request the regional instance
// explicitly. Lazy-initialized on first use to avoid touching RNFB on web.
function getNativeFunctions() {
  return nativeFirebase.app().functions('asia-south1');
}

type PlaceOrderInput = {
  shopId: string;
  items: CartItem[];
  address: Address;
  paymentMethod: PaymentMethod;
  // PR 21 — optional. CheckoutScreen always sets it (defaults to
  // 'call_me' on mount); legacy callers that omit it round-trip
  // unchanged because the server normalizes missing → 'call_me'.
  substitutionPreference?: SubstitutionPreference;
  // PR 46 — optional locked delivery location. CheckoutScreen
  // (post-PR-46) always sends this; the server validates the
  // shape, re-derives the distance/duration estimate
  // authoritatively (so a tampered client can't forge a short
  // distance to dodge PR 47 charges), and stamps all three
  // delivery fields onto the order doc. Pre-PR-46 clients (or
  // clients that fail to capture coords) omit the field; the
  // server skips the stamp and the order has no
  // deliveryLocation/deliveryDistanceKm/deliveryDurationMin
  // — the doc shape stays back-compat-clean.
  deliveryLocation?: DeliveryLocation;
};

// PR 46 — input/output shape of the `getDeliveryEstimate` callable.
// Used by CheckoutScreen to show the customer "Estimated delivery:
// ~N min" before they place the order. The server's identical logic
// runs again inside placeOrder for the authoritative stamp; this
// callable is purely the display preview.
export type DeliveryEstimateInput = {
  shopId: string;
  dest: { lat: number; lng: number };
};
export type DeliveryEstimateResult = {
  distanceKm: number;
  durationMin: number;
  source: 'distance_matrix' | 'haversine_fallback';
};

type PlaceOrderResult = {
  orderId: string;
  total: number;
  etaMinutes: number;
  shopName: string;
  razorpayOrderId: string | null;
  razorpayKeyId: string | null;
};

// Firestore stores createdAt/updatedAt as Timestamps (FieldValue.serverTimestamp).
// statusHistory[].at is written as epoch ms. Normalize everything to numbers
// so screens can treat Order as a pure JS shape.
function tsToMillis(value: unknown): number {
  if (value instanceof Timestamp) return value.toMillis();
  if (typeof value === 'number') return value;
  if (value && typeof (value as any).toMillis === 'function') {
    return (value as any).toMillis();
  }
  return 0;
}

function toOrder(raw: any): Order {
  return {
    ...raw,
    createdAt: tsToMillis(raw.createdAt),
    estimatedDeliveryAt: tsToMillis(raw.estimatedDeliveryAt),
    // Delivery-flow timestamps (Phase 12b). Server may store these as
    // Firestore Timestamps OR keep them null on freshly placed orders;
    // tsToMillis returns 0 for null, so coerce back to null afterward
    // to preserve the "not yet happened" semantics on the client.
    pickedUpAt: raw.pickedUpAt ? tsToMillis(raw.pickedUpAt) : null,
    deliveredAt: raw.deliveredAt ? tsToMillis(raw.deliveredAt) : null,
    deliveryPersonId: raw.deliveryPersonId ?? null,
    // PR 12 — readyByEstimate is a plain epoch ms in Firestore (the
    // server writes Date.now() + minutes*60_000), but legacy orders
    // placed before PR 12 don't have the field. Coerce missing →
    // null so render code can `if (order.readyByEstimate)` safely.
    readyByEstimate: raw.readyByEstimate ?? null,
    statusHistory: Array.isArray(raw.statusHistory)
      ? raw.statusHistory.map((h: any) => ({ ...h, at: tsToMillis(h.at) }))
      : raw.statusHistory,
  } as Order;
}

export const orderService = {
  async placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult> {
    const t = perf ? trace(perf, 'orderService.placeOrder') : null;
    t?.start();
    Sentry.addBreadcrumb({
      category: 'order',
      message: `placing order: ${input.items.length} items, ${input.paymentMethod}`,
      level: 'info',
    });
    try {
      // Phase 12a-v2-iv-hotfix-1 ROOT-CAUSE FIX: forward menuItemId
      // and priceSnapshot to the server via buildPlaceOrderPayload.
      // The previous inline `.map({ productId, quantity })` silently
      // stripped the v2-iii fields the server uses to dispatch to
      // the per-shop menu validation path. Without them, placeOrder
      // always took the legacy products-collection path and rejected
      // with "Product X not in this shop" whenever the global
      // product's shopId didn't match the cart's shopId — which is
      // always, for shop-scoped products like p_008_atta. The
      // useCartStore changes shipped earlier in this hotfix are
      // defence-in-depth but were rendered moot by THIS map.
      // Pinned by tests/services/buildPlaceOrderPayload.test.ts.
      const compactItems = buildPlaceOrderPayload(input.items);
      const payload = {
        shopId: input.shopId,
        items: compactItems,
        address: input.address,
        paymentMethod: input.paymentMethod,
        // PR 21 — forward the substitution preference. Server
        // re-validates via normalizeSubstitutionPreference; missing
        // here is safe (server treats undefined as 'call_me').
        ...(input.substitutionPreference
          ? { substitutionPreference: input.substitutionPreference }
          : {}),
        // PR 46 — forward the locked delivery location. Server
        // re-validates the shape (lat/lng numbers, valid type)
        // and, more importantly, RE-DERIVES the distance + duration
        // estimate authoritatively rather than trusting any
        // client-supplied values. Omitting the field on legacy /
        // tests / failed-GPS paths is safe; the server skips the
        // delivery-location stamp entirely in that case.
        ...(input.deliveryLocation
          ? { deliveryLocation: input.deliveryLocation }
          : {}),
      };
      let data: PlaceOrderResult;
      if (isNative) {
        // Use RNFB so the Cloud Function sees the phone-authed user
        // (firebase web SDK auth state doesn't reach native callables).
        const fn = getNativeFunctions().httpsCallable('placeOrder');
        const result = await fn(payload);
        data = result.data as PlaceOrderResult;
      } else {
        const fn = httpsCallable<unknown, PlaceOrderResult>(
          functions,
          'placeOrder',
        );
        const result = await fn(payload);
        data = result.data;
      }
      t?.putAttribute('paymentMethod', input.paymentMethod);
      return data;
    } finally {
      t?.stop();
    }
  },

  async listMine(customerUid: string): Promise<Order[]> {
    const t = perf ? trace(perf, 'orderService.listMine') : null;
    t?.start();
    try {
      if (isNative) {
        // Native path goes through a Cloud Function because
        // @react-native-firebase/firestore is incompatible with
        // Expo SDK 54 + RN 0.81 + static frameworks (see PRELAUNCH).
        // The Function uses request.auth.uid; customerUid is ignored.
        const fn = getNativeFunctions().httpsCallable('listMyOrders');
        const result = await fn();
        // Function returns timestamps already converted to epoch ms;
        // toOrder is idempotent on numbers, so this is safe.
        return (result.data as any[]).map(toOrder);
      }
      const q = query(
        collection(db, 'orders'),
        where('customerUid', '==', customerUid),
        orderBy('createdAt', 'desc'),
        limit(50),
      );
      const snap = await getDocs(q);
      return snap.docs.map(d => toOrder(d.data()));
    } finally {
      t?.stop();
    }
  },

  // PR 46 — pre-checkout distance/duration preview. CheckoutScreen
  // calls this once after the customer picks (or changes) the
  // delivery target so the "Estimated delivery: ~N min" line
  // updates before "Place Order" is tapped. The server runs the
  // SAME `computeDeliveryEstimate` again inside placeOrder and
  // stamps the authoritative result onto the order doc; the
  // values returned here are display-only and may differ from the
  // stamped values by ~seconds (independent calls; both go through
  // the kill-switch + haversine fallback).
  //
  // Never throws on Google failure — the server's haversine
  // fallback always returns a valid estimate so the UI doesn't
  // need a try/catch around this in steady state.
  async getDeliveryEstimate(
    input: DeliveryEstimateInput,
  ): Promise<DeliveryEstimateResult> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable('getDeliveryEstimate');
      const result = await fn(input);
      return result.data as DeliveryEstimateResult;
    }
    const fn = httpsCallable<DeliveryEstimateInput, DeliveryEstimateResult>(
      functions,
      'getDeliveryEstimate',
    );
    const result = await fn(input);
    return result.data;
  },

  // Creates a fresh Razorpay session for an order whose payment was
  // dismissed. Returns the new session so the caller can re-open
  // Razorpay Checkout. The Firestore order doc keeps the same id;
  // only razorpayOrderId is rotated server-side.
  async retryPayment(orderId: string): Promise<{
    orderId: string;
    total: number;
    razorpayOrderId: string;
    razorpayKeyId: string;
  }> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable('retryPayment');
      const result = await fn({ orderId });
      return result.data as any;
    }
    const fn = httpsCallable(functions, 'retryPayment');
    const result = await fn({ orderId });
    return result.data as any;
  },

  // PR 20 — submit a 1-5 star rating (and optional comment) for a
  // delivered order. Server validates auth + order ownership +
  // delivered-status + no-prior-rating, then atomically writes
  // the order's rating field and bumps the shop's rolling avg /
  // count. Returns the canonical { stars, comment } so the caller
  // can render its "Thanks for rating!" confirmation immediately.
  // PR 42.1 — accepts both the legacy single-rating shape
  // (`stars` / `comment`) and the new dual-rating shape
  // (`shopRating` / `shopComment` / `deliveryRating?` /
  // `deliveryComment?`). New callers use the dual shape; the
  // legacy shape stays accepted for safety during the OTA window
  // (a not-yet-OTA'd client still sends it; the server treats
  // it as shop-only). Server response is the canonical new shape
  // regardless of input.
  async submitOrderRating(input: {
    orderId: string;
    // Legacy
    stars?: 1 | 2 | 3 | 4 | 5;
    comment?: string;
    // New
    shopRating?: 1 | 2 | 3 | 4 | 5;
    shopComment?: string;
    deliveryRating?: 1 | 2 | 3 | 4 | 5;
    deliveryComment?: string;
  }): Promise<{
    ok: true;
    shopRating: number;
    shopComment?: string;
    deliveryRating: number | null;
    deliveryComment: string | null;
  }> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable('submitOrderRating');
      const result = await fn(input);
      return result.data as any;
    }
    const fn = httpsCallable(functions, 'submitOrderRating');
    const result = await fn(input);
    return result.data as any;
  },

  // Customer-initiated cancellation. Server enforces that the order is
  // still pending and not paid. Fails for accepted/preparing/etc orders
  // (those need admin-side cancellation + refund flow).
  async cancelMyPendingOrder(orderId: string): Promise<void> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable('cancelMyPendingOrder');
      await fn({ orderId });
      return;
    }
    const fn = httpsCallable(functions, 'cancelMyPendingOrder');
    await fn({ orderId });
  },

  // Watcher contract (post-loader-spin hotfix): every cb is called as
  // cb(data, undefined) on success and cb(emptyValue, error) on
  // failure. Screens MUST set their loading state from the callback —
  // never from the success branch alone — so a transient network blip
  // can't leave the loader spinning forever.
  watchOrder(
    orderId: string,
    cb: (order: Order | null, error?: Error) => void,
  ): () => void {
    if (isNative) {
      // Polling fallback for native (no RNFB Firestore = no snapshot
      // listeners). 5s cadence balances freshness vs Function-invocation
      // cost. Calls return a cleanup that stops the loop.
      let cancelled = false;
      const poll = async () => {
        if (cancelled) return;
        try {
          const fn = getNativeFunctions().httpsCallable('getOrder');
          const result = await fn({ orderId });
          if (!cancelled) cb(toOrder(result.data), undefined);
        } catch (e) {
          // not-found surfaces as null (success branch) so the UI can
          // render a missing state instead of getting stuck on stale
          // data. Anything else is a real error and goes through the
          // error path.
          const code = (e as any)?.code;
          if (code === 'functions/not-found' || code === 'not-found') {
            if (!cancelled) cb(null, undefined);
          } else {
            console.warn('[watchOrder] poll failed:', e);
            if (!cancelled) {
              cb(null, e instanceof Error ? e : new Error(String(e)));
            }
          }
        }
      };
      poll();
      const interval = setInterval(poll, 5000);
      return () => {
        cancelled = true;
        clearInterval(interval);
      };
    }
    return onSnapshot(
      doc(db, 'orders', orderId),
      snap => cb(snap.exists() ? toOrder(snap.data()) : null, undefined),
      err => {
        console.warn('[watchOrder] snapshot failed:', err);
        cb(null, err instanceof Error ? err : new Error(String(err)));
      },
    );
  },

  async updateOrderStatus(input: {
    orderId: string;
    newStatus: OrderStatus;
    reason?: string;
    // PR 12 — shopkeeper-provided ETA (epoch ms). REQUIRED on
    // accept transitions, OPTIONAL on preparing transitions, ignored
    // otherwise. Server-side validation is the source of truth; this
    // signature just lets call sites pass the value through.
    readyByEstimate?: number;
  }): Promise<void> {
    if (isNative) {
      // Use RNFB so the admin custom-claim on the phone-authed user is
      // read by the Cloud Function. Web SDK's auth doesn't propagate to
      // native callables.
      const fn = getNativeFunctions().httpsCallable('updateOrderStatus');
      await fn(input);
      return;
    }
    const fn = httpsCallable(functions, 'updateOrderStatus');
    await fn(input);
  },

  // ──────────────────────────────────────────────────────────
  // Multi-role: shop owner + delivery partner (Phase 12a)
  // ──────────────────────────────────────────────────────────

  // ──────────────────────────────────────────────────────────
  // Shop registration + admin approval (Phase 12a-v2-i)
  // ──────────────────────────────────────────────────────────

  async registerShop(input: {
    name: string;
    address: string;
    location?: { lat: number; lng: number };
    // PR-NEXT-SHOP-LOCATION-EDIT — capture source of the registration
    // pin. RegisterShop's dual-mode capture (`useCaptureShopLocation`
    // hook) returns `'gps' | 'geocoded'`; the screen passes it
    // through here so the server can stamp it onto the pending shop
    // doc and the admin verification surface can render it. Optional
    // for back-compat with any caller predating the dual-mode flow.
    locationSource?: 'gps' | 'geocoded';
    phone: string;
    hours?: { open: string; close: string };
    gstNumber?: string;
    fssaiLicense?: string;
  }): Promise<{ shopId: string }> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable('registerShop');
      const result = await fn(input);
      return result.data as any;
    }
    const fn = httpsCallable(functions, 'registerShop');
    const result = await fn(input);
    return result.data as any;
  },

  async approveShop(input: { shopId: string }): Promise<void> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable('approveShop');
      await fn(input);
      return;
    }
    const fn = httpsCallable(functions, 'approveShop');
    await fn(input);
  },

  async rejectShop(input: {
    shopId: string;
    reason: string;
  }): Promise<void> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable('rejectShop');
      await fn(input);
      return;
    }
    const fn = httpsCallable(functions, 'rejectShop');
    await fn(input);
  },

  // ──────────────────────────────────────────────────────────
  // PR-NEXT-SHOP-LOCATION-EDIT — pending-location-change flow
  // ──────────────────────────────────────────────────────────
  // Owner-side: submit / cancel a pending pin. Admin-side: approve
  // / reject. Server-side helpers in
  // `functions/src/pendingShopLocationHelpers.ts` enforce the
  // gates; these wrappers stay thin pass-throughs.

  async submitPendingShopLocation(input: {
    shopId: string;
    newLocation: { lat: number; lng: number };
    newLocationSource: 'gps' | 'geocoded';
  }): Promise<void> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable(
        'submitPendingShopLocation',
      );
      await fn(input);
      return;
    }
    const fn = httpsCallable(functions, 'submitPendingShopLocation');
    await fn(input);
  },

  async cancelPendingShopLocation(input: { shopId: string }): Promise<void> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable(
        'cancelPendingShopLocation',
      );
      await fn(input);
      return;
    }
    const fn = httpsCallable(functions, 'cancelPendingShopLocation');
    await fn(input);
  },

  async approvePendingShopLocation(input: { shopId: string }): Promise<void> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable(
        'approvePendingShopLocation',
      );
      await fn(input);
      return;
    }
    const fn = httpsCallable(functions, 'approvePendingShopLocation');
    await fn(input);
  },

  async rejectPendingShopLocation(input: {
    shopId: string;
    reason?: string;
  }): Promise<void> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable(
        'rejectPendingShopLocation',
      );
      await fn(input);
      return;
    }
    const fn = httpsCallable(functions, 'rejectPendingShopLocation');
    await fn(input);
  },

  async listPendingShops(): Promise<Shop[]> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable('listPendingShops');
      const result = await fn();
      return ((result.data as any[]) ?? []) as Shop[];
    }
    const fn = httpsCallable(functions, 'listPendingShops');
    const result = await fn();
    return ((result.data as any[]) ?? []) as Shop[];
  },

  // Returns the caller's most-recent owned shop (pending/active/rejected),
  // or null if they don't own one. Used by WaitingForApprovalScreen to
  // detect status flips without direct Firestore access.
  async getShopForOwner(): Promise<Shop | null> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable('getMyShop');
      const result = await fn();
      return (result.data as Shop) ?? null;
    }
    const fn = httpsCallable(functions, 'getMyShop');
    const result = await fn();
    return (result.data as Shop) ?? null;
  },

  // ──────────────────────────────────────────────────────────
  // Admin governance (Phase 12a-v2-i-bis)
  // ──────────────────────────────────────────────────────────
  // All callables below require the admin custom claim. The server
  // refuses uid==auth.uid for revoke* calls (single-admin lockout
  // protection) — clients should also disable the buttons for self,
  // but the server is the source of truth.

  async revokeShopOwner(input: {
    uid: string;
    reason?: string;
  }): Promise<void> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable('revokeShopOwner');
      await fn(input);
      return;
    }
    const fn = httpsCallable(functions, 'revokeShopOwner');
    await fn(input);
  },

  async revokeDelivery(input: {
    uid: string;
    reason?: string;
  }): Promise<void> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable('revokeDelivery');
      await fn(input);
      return;
    }
    const fn = httpsCallable(functions, 'revokeDelivery');
    await fn(input);
  },

  async suspendShop(input: {
    shopId: string;
    reason: string;
  }): Promise<void> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable('suspendShop');
      await fn(input);
      return;
    }
    const fn = httpsCallable(functions, 'suspendShop');
    await fn(input);
  },

  async unsuspendShop(input: { shopId: string }): Promise<void> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable('unsuspendShop');
      await fn(input);
      return;
    }
    const fn = httpsCallable(functions, 'unsuspendShop');
    await fn(input);
  },

  // PR 42 followup — admin recovery callable for shops approved
  // with `imageUrl: ''` (storefront signing failed silently inside
  // approveShop). Unlike approveShop's swallow-and-warn posture,
  // this callable throws on signing failure so the admin sees the
  // actual error (typically IAM signBlob misconfig). Also doubles
  // as a "re-mint" path for future flows that let the owner
  // re-upload the storefront photo post-approval.
  async regenerateShopImageUrl(input: {
    shopId: string;
  }): Promise<{ ok: true; imageUrl: string }> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable('regenerateShopImageUrl');
      const result = await fn(input);
      return result.data as any;
    }
    const fn = httpsCallable(functions, 'regenerateShopImageUrl');
    const result = await fn(input);
    return result.data as any;
  },

  async listAllUsers(): Promise<UserInfo[]> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable('listAllUsers');
      const result = await fn();
      return ((result.data as UserInfo[]) ?? []);
    }
    const fn = httpsCallable(functions, 'listAllUsers');
    const result = await fn();
    return ((result.data as UserInfo[]) ?? []);
  },

  // Phase 12c: count of delivery partners currently marked online.
  // Admin-only (server enforces). Used by useOnlineDeliveryCount hook
  // on the AdminOrdersScreen stats card.
  async getOnlineDeliveryCount(): Promise<number> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable(
        'getOnlineDeliveryCount',
      );
      const result = await fn();
      const data = result.data as { count?: number } | undefined;
      return Math.max(0, Math.floor(data?.count ?? 0));
    }
    const fn = httpsCallable(functions, 'getOnlineDeliveryCount');
    const result = await fn();
    const data = result.data as { count?: number } | undefined;
    return Math.max(0, Math.floor(data?.count ?? 0));
  },

  // PR-NEXT-7 (finding #9): shop-owner-scoped count of online
  // delivery partners who would actually receive a push for a new
  // order at the caller's shop. Auth + shopId are derived from
  // claims server-side — DO NOT add a shopId parameter here, that
  // would invite cross-shop snooping attempts. Used by the
  // `useOnlinePartnersNearMyShop` hook on ShopOwnerDashboard.
  async getOnlinePartnersNearMyShop(): Promise<{
    count: number;
    filtered: boolean;
  }> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable(
        'getOnlinePartnersNearMyShop',
      );
      const result = await fn();
      const data = result.data as
        | { count?: number; filtered?: boolean }
        | undefined;
      return {
        count: Math.max(0, Math.floor(data?.count ?? 0)),
        filtered: data?.filtered === true,
      };
    }
    const fn = httpsCallable(functions, 'getOnlinePartnersNearMyShop');
    const result = await fn();
    const data = result.data as
      | { count?: number; filtered?: boolean }
      | undefined;
    return {
      count: Math.max(0, Math.floor(data?.count ?? 0)),
      filtered: data?.filtered === true,
    };
  },

  async listAllShops(): Promise<Shop[]> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable('listAllShops');
      const result = await fn();
      return ((result.data as Shop[]) ?? []);
    }
    const fn = httpsCallable(functions, 'listAllShops');
    const result = await fn();
    return ((result.data as Shop[]) ?? []);
  },

  // ──────────────────────────────────────────────────────────
  // Per-shop menu management (Phase 12a-v2-ii)
  // ──────────────────────────────────────────────────────────
  // All four callables require the shopOwner claim and are
  // automatically scoped to `claims.shopId` server-side — clients
  // can't pass a shopId to target someone else's menu.

  async listMyShopMenu(): Promise<MenuItem[]> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable('listMyShopMenu');
      const result = await fn();
      return ((result.data as MenuItem[]) ?? []);
    }
    const fn = httpsCallable(functions, 'listMyShopMenu');
    const result = await fn();
    return ((result.data as MenuItem[]) ?? []);
  },

  // PR 5 — shop owner self-service settings + PR 5 hotfix admin path.
  // Only updates the fields present in `input` (mirrors
  // ShopMenuItemEdit's dirty-field pattern). Server validates ranges
  // + auth via shopSettingsHelpers.
  //   - ShopOwner callers: omit `shopId` (server uses their claim's
  //     shopId; any passed shopId is ignored so a malicious owner
  //     client cannot target someone else's shop).
  //   - Admin callers: REQUIRED to pass `shopId` (their claim has no
  //     shopId — server can't infer the target shop).
  // PR 47 — persist the shop owner's distance-based delivery charge
  // tier table. Server-side `validateDeliveryChargeTiers` enforces
  // catch-all presence + ascending bands + range checks; the client
  // pre-validates with the same helper for inline friendly errors
  // before incurring the round-trip. Shop owner only — server reads
  // `claims.shopId` (request body shopId is NOT supported here on
  // purpose; admins editing another shop's tiers should use the
  // admin tooling, not this callable).
  async updateShopDeliveryTiers(input: {
    tiers: DeliveryChargeTier[];
  }): Promise<{
    ok: boolean;
    shopId: string;
    tiers: DeliveryChargeTier[];
  }> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable('updateShopDeliveryTiers');
      const result = await fn(input);
      return result.data as {
        ok: boolean;
        shopId: string;
        tiers: DeliveryChargeTier[];
      };
    }
    const fn = httpsCallable(functions, 'updateShopDeliveryTiers');
    const result = await fn(input);
    return result.data as {
      ok: boolean;
      shopId: string;
      tiers: DeliveryChargeTier[];
    };
  },

  async updateShopSettings(input: {
    shopId?: string;
    deliveryFee?: number;
    minOrder?: number;
    // PR 48 — service radius (km). Third whitelisted partial-update
    // field. Server caps to 1–50 km / integer-only.
    serviceRadiusKm?: number;
  }): Promise<{
    ok: boolean;
    shopId: string;
    updates: {
      deliveryFee?: number;
      minOrder?: number;
      serviceRadiusKm?: number;
    };
  }> {
    type UpdateShape = {
      deliveryFee?: number;
      minOrder?: number;
      serviceRadiusKm?: number;
    };
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable('updateShopSettings');
      const result = await fn(input);
      return result.data as {
        ok: boolean;
        shopId: string;
        updates: UpdateShape;
      };
    }
    const fn = httpsCallable(functions, 'updateShopSettings');
    const result = await fn(input);
    return result.data as {
      ok: boolean;
      shopId: string;
      updates: UpdateShape;
    };
  },

  async updateMenuItem(input: {
    menuItemId: string;
    fields: Partial<{
      price: number;
      available: boolean;
      stock: number | null;
      name: string;
      imageUrl: string;
      packLabel: string;
      category: string;
      mrp: number;
    }>;
  }): Promise<void> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable('updateMenuItem');
      await fn(input);
      return;
    }
    const fn = httpsCallable(functions, 'updateMenuItem');
    await fn(input);
  },

  async addCustomMenuItem(
    input: NewMenuItemInput,
  ): Promise<{ menuItemId: string }> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable('addCustomMenuItem');
      const result = await fn(input);
      return result.data as { menuItemId: string };
    }
    const fn = httpsCallable(functions, 'addCustomMenuItem');
    const result = await fn(input);
    return result.data as { menuItemId: string };
  },

  // PR 32 — AI menu extraction (leg 1 of 2). Sends a base64-encoded
  // photo of a rate-list / shelf, receives a parsed item list for
  // the shop owner to review. Server enforces auth + per-shop daily
  // quota (5/day) + feature kill-switch + 2MB image cap. Errors
  // surface as `code/message` from the callable for the screen to
  // render verbatim — they're already shop-owner-friendly.
  async extractMenuFromImage(input: {
    imageBase64: string;
    imageMediaType?: 'image/jpeg' | 'image/png' | 'image/webp';
  }): Promise<{
    ok: true;
    items: ExtractedMenuItem[];
    droppedCount: number;
    usedTodayCount: number;
    dailyQuota: number;
  }> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable('extractMenuFromImage');
      const result = await fn(input);
      return result.data as {
        ok: true;
        items: ExtractedMenuItem[];
        droppedCount: number;
        usedTodayCount: number;
        dailyQuota: number;
      };
    }
    const fn = httpsCallable(functions, 'extractMenuFromImage');
    const result = await fn(input);
    return result.data as {
      ok: true;
      items: ExtractedMenuItem[];
      droppedCount: number;
      usedTodayCount: number;
      dailyQuota: number;
    };
  },

  // PR 32 — AI menu extraction (leg 2 of 2). After the shop owner
  // reviews + edits, this batch-writes the approved subset. Server
  // mirrors `addCustomMenuItem` validation per item; rows that fail
  // come back in `skipped` with a human-readable reason so the
  // screen can show "Added 47; skipped 3 (mrp must be >= price)."
  async addExtractedMenuItems(input: {
    items: Array<{
      name: string;
      price: number;
      mrp: number;
      packLabel: string;
      category: string;
    }>;
  }): Promise<{
    ok: true;
    added: number;
    skipped: Array<{ index: number; reason: string }>;
    menuItemIds: string[];
  }> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable('addExtractedMenuItems');
      const result = await fn(input);
      return result.data as {
        ok: true;
        added: number;
        skipped: Array<{ index: number; reason: string }>;
        menuItemIds: string[];
      };
    }
    const fn = httpsCallable(functions, 'addExtractedMenuItems');
    const result = await fn(input);
    return result.data as {
      ok: true;
      added: number;
      skipped: Array<{ index: number; reason: string }>;
      menuItemIds: string[];
    };
  },

  // PR 34 — voice + Hindi onboarding. Sends a base64-encoded audio
  // clip (≤ 30s, ≤ 2 MB base64) plus the recording's encoding +
  // sample rate + the user's selected UI language + the mode:
  //   - 'multi_field' — server runs STT + Claude Haiku parse, returns
  //     7 form fields ready to pre-fill (with ✨ markers + transcript
  //     review banner on the client).
  //   - 'single_field' — server runs STT only and returns the
  //     transcript; the screen confirms with the user before
  //     assigning to a single field.
  // Errors arrive as `code/message` from the callable in the
  // user-selected language (Hindi if languageCode === 'hi-IN').
  async transcribeShopOnboardingAudio(input: {
    audioBase64: string;
    encoding: 'WEBM_OPUS' | 'LINEAR16' | 'FLAC' | 'AMR_WB';
    sampleRateHertz?: number;
    languageCode: 'hi-IN' | 'en-IN';
    mode: 'single_field' | 'multi_field';
  }): Promise<{
    ok: true;
    transcript: string;
    fields: ParsedShopFields | null;
    parseError?: string;
    usedTodayCount: number;
    dailyQuota: number;
  }> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable(
        'transcribeShopOnboardingAudio',
      );
      const result = await fn(input);
      return result.data as {
        ok: true;
        transcript: string;
        fields: ParsedShopFields | null;
        parseError?: string;
        usedTodayCount: number;
        dailyQuota: number;
      };
    }
    const fn = httpsCallable(functions, 'transcribeShopOnboardingAudio');
    const result = await fn(input);
    return result.data as {
      ok: true;
      transcript: string;
      fields: ParsedShopFields | null;
      parseError?: string;
      usedTodayCount: number;
      dailyQuota: number;
    };
  },

  // PR-NEXT-4 §E (finding #5) — return shape simplified from
  // `{ deleted: boolean; softDisabled?: boolean }` to `{ ok: true }`.
  // Every delete now removes the item from listings uniformly
  // (custom + global); the discriminator is gone because there's
  // nothing to discriminate. The only known caller —
  // `ShopMenuItemEditScreen.handleDelete` — never read the old
  // `.deleted` / `.softDisabled` flags, so this is a safe shape
  // narrowing rather than a breaking change.
  async removeMenuItem(input: {
    menuItemId: string;
  }): Promise<{ ok: true }> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable('removeMenuItem');
      const result = await fn(input);
      return result.data as { ok: true };
    }
    const fn = httpsCallable(functions, 'removeMenuItem');
    const result = await fn(input);
    return result.data as { ok: true };
  },

  // Phase 12a-v2-iii: public read of a shop's available menu for the
  // customer flow. No auth required (anonymous Auth users hit it from
  // ShopDetailScreen). The server filters out non-active shops and
  // unavailable / out-of-stock items, so the client renders the
  // payload directly without re-filtering.
  async listShopMenuPublic(
    shopId: string,
  ): Promise<{ shop: Shop; items: MenuItem[] }> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable('listShopMenuPublic');
      const result = await fn({ shopId });
      return result.data as { shop: Shop; items: MenuItem[] };
    }
    const fn = httpsCallable(functions, 'listShopMenuPublic');
    const result = await fn({ shopId });
    return result.data as { shop: Shop; items: MenuItem[] };
  },

  // PR 4 — customer search rewrite. Replaces the legacy SearchScreen
  // path (which read from /products and missed every shop registered
  // post-v2-iii). Server queries the `menu` collection-group across
  // active candidate shops, filters by query/category/stock, joins
  // shop info, and caps at 50. No auth required (anon customer
  // browsing). Same dual-dispatch posture as listShopMenuPublic.
  async searchMenuPublic(input: {
    query?: string;
    category?: string;
    location?: { lat: number; lng: number };
  }): Promise<{
    items: Array<{
      menuItem: MenuItem;
      shop: { id: string; name: string; address: string; distanceKm?: number; ratingAvg?: number; ratingCount?: number };
    }>;
  }> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable('searchMenuPublic');
      const result = await fn(input);
      return result.data as {
        items: Array<{
          menuItem: MenuItem;
          shop: { id: string; name: string; address: string; distanceKm?: number; ratingAvg?: number; ratingCount?: number };
        }>;
      };
    }
    const fn = httpsCallable(functions, 'searchMenuPublic');
    const result = await fn(input);
    return result.data as {
      items: Array<{
        menuItem: MenuItem;
        shop: { id: string; name: string; address: string; distanceKm?: number; ratingAvg?: number; ratingCount?: number };
      }>;
    };
  },

  // PR 1 — security hardening. Replaces the self-service becomeDelivery
  // with an admin-approval flow mirroring shop registration. The five
  // callables: requestDeliveryRole (user submits form),
  // getMyDeliveryRequest (waiting-room poll), listPendingDeliveryRequests
  // (admin queue), approveDeliveryRole / rejectDeliveryRole (admin
  // actions). No direct Firestore reads on deliveryRequests/* from the
  // client — callables only.
  async requestDeliveryRole(form: {
    name?: string;
    vehicleType?: string;
    city?: string;
  }): Promise<{ ok: boolean }> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable('requestDeliveryRole');
      const result = await fn(form);
      return result.data as { ok: boolean };
    }
    const fn = httpsCallable(functions, 'requestDeliveryRole');
    const result = await fn(form);
    return result.data as { ok: boolean };
  },

  async getMyDeliveryRequest(): Promise<DeliveryRequest | null> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable('getMyDeliveryRequest');
      const result = await fn();
      return (result.data ?? null) as DeliveryRequest | null;
    }
    const fn = httpsCallable(functions, 'getMyDeliveryRequest');
    const result = await fn();
    return (result.data ?? null) as DeliveryRequest | null;
  },

  async listPendingDeliveryRequests(): Promise<DeliveryRequest[]> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable(
        'listPendingDeliveryRequests',
      );
      const result = await fn();
      return (result.data ?? []) as DeliveryRequest[];
    }
    const fn = httpsCallable(functions, 'listPendingDeliveryRequests');
    const result = await fn();
    return (result.data ?? []) as DeliveryRequest[];
  },

  async approveDeliveryRole(uid: string): Promise<{ ok: boolean }> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable('approveDeliveryRole');
      const result = await fn({ uid });
      return result.data as { ok: boolean };
    }
    const fn = httpsCallable(functions, 'approveDeliveryRole');
    const result = await fn({ uid });
    return result.data as { ok: boolean };
  },

  async rejectDeliveryRole(args: {
    uid: string;
    reason: string;
  }): Promise<{ ok: boolean }> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable('rejectDeliveryRole');
      const result = await fn(args);
      return result.data as { ok: boolean };
    }
    const fn = httpsCallable(functions, 'rejectDeliveryRole');
    const result = await fn(args);
    return result.data as { ok: boolean };
  },

  // PR 2 — payment hardening, Phase B. confirmPayment closes the gap
  // between Razorpay Checkout's success callback and the asynchronous
  // payment.captured webhook. The client posts the three fields
  // Razorpay returns; the server HMAC-verifies them with the key
  // secret and flips the order to paid synchronously.
  //
  // The callable is idempotent: a webhook arriving later finds
  // already-paid and skips. Failure path: the client should still
  // navigate to OrderConfirmation; the webhook is the backup and
  // will mark the order paid when it eventually arrives (~30s).
  async confirmPayment(args: {
    orderId: string;
    razorpayPaymentId: string;
    razorpaySignature: string;
  }): Promise<{ ok: boolean; alreadyPaid?: boolean }> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable('confirmPayment');
      const result = await fn(args);
      return result.data as { ok: boolean; alreadyPaid?: boolean };
    }
    const fn = httpsCallable(functions, 'confirmPayment');
    const result = await fn(args);
    return result.data as { ok: boolean; alreadyPaid?: boolean };
  },

  // PR 2 — payment hardening, Phase B. Admin or shop-owner-of-this-shop
  // initiates a full Razorpay refund of a paid online order. Server
  // transactionally writes refund_pending, calls Razorpay's API, then
  // flips to refunded + cancelled (or refund_failed for retry).
  async cancelPaidOrder(args: {
    orderId: string;
    reason: string;
  }): Promise<{ ok: boolean; refundId?: string }> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable('cancelPaidOrder');
      const result = await fn(args);
      return result.data as { ok: boolean; refundId?: string };
    }
    const fn = httpsCallable(functions, 'cancelPaidOrder');
    const result = await fn(args);
    return result.data as { ok: boolean; refundId?: string };
  },

  // PR 7 — Customer self-service cancel-window callable. Triggers the
  // same Razorpay refund flow as cancelPaidOrder but with a customer
  // auth path and a 2-min eligibility window enforced server-side via
  // canCustomerCancelPaidOrder. UI shows a live countdown (see
  // OrderDetailScreen) but the server is the source of truth — calls
  // arriving past the window get a `failed-precondition` error.
  async cancelMyRecentPaidOrder(args: {
    orderId: string;
    reason?: string;
  }): Promise<{ ok: boolean; refundId?: string }> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable(
        'cancelMyRecentPaidOrder',
      );
      const result = await fn(args);
      return result.data as { ok: boolean; refundId?: string };
    }
    const fn = httpsCallable(functions, 'cancelMyRecentPaidOrder');
    const result = await fn(args);
    return result.data as { ok: boolean; refundId?: string };
  },

  // PR 6.1 — Mint a signed PUT URL for a menu image upload. Server
  // derives shopId from the caller's auth claims and chooses the
  // storage path; client just blindly PUTs bytes to uploadUrl with
  // header Content-Type: image/jpeg (must match exactly — v4
  // signatures bind contentType), then saves downloadUrl on the
  // menu item doc.
  //
  // Native dispatch goes through RNFB so the phone-authed user's
  // custom claims (shopOwner, shopId) reach the Cloud Function. The
  // Web SDK path is for web only.
  async getMenuImageUploadUrl(): Promise<{
    uploadUrl: string;
    downloadUrl: string;
    storagePath: string;
    expiresAt: number;
  }> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable(
        'getMenuImageUploadUrl',
      );
      const result = await fn({});
      return result.data as {
        uploadUrl: string;
        downloadUrl: string;
        storagePath: string;
        expiresAt: number;
      };
    }
    const fn = httpsCallable(functions, 'getMenuImageUploadUrl');
    const result = await fn({});
    return result.data as {
      uploadUrl: string;
      downloadUrl: string;
      storagePath: string;
      expiresAt: number;
    };
  },

  // PR 31 — Mint a v4 signed PUT URL for a shop KYC document
  // upload (storefront photo, GST cert, FSSAI license, owner ID).
  // Server validates the caller owns the target pending shop and
  // chooses the storage path; client blindly PUTs JPEG bytes to
  // `uploadUrl` with header `Content-Type: image/jpeg` (must match
  // exactly — v4 signatures bind contentType), then calls
  // `recordShopKycUpload` to stamp the path onto the shop doc.
  //
  // Rejects with `failed-precondition` if the shop has left the
  // `pending` state — KYC docs are frozen post-approval. Native
  // dispatch goes through RNFB so the phone-authed user reaches
  // the Cloud Function with a valid uid.
  async getShopKycUploadUrl(args: {
    shopId: string;
    docKind: 'storefront' | 'gstDoc' | 'fssaiDoc' | 'ownerIdDoc';
  }): Promise<{
    uploadUrl: string;
    storagePath: string;
    docKind: string;
    expiresAt: number;
  }> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable('getShopKycUploadUrl');
      const result = await fn(args);
      return result.data as {
        uploadUrl: string;
        storagePath: string;
        docKind: string;
        expiresAt: number;
      };
    }
    const fn = httpsCallable(functions, 'getShopKycUploadUrl');
    const result = await fn(args);
    return result.data as {
      uploadUrl: string;
      storagePath: string;
      docKind: string;
      expiresAt: number;
    };
  },

  // PR 31 — Confirm a successful PUT to the signed URL by stamping
  // `registrationData.kycDocs.{docKind}` onto the shop doc. Server
  // re-verifies the caller owns the pending shop AND the
  // storagePath is under that shop's KYC folder.
  async recordShopKycUpload(args: {
    shopId: string;
    docKind: 'storefront' | 'gstDoc' | 'fssaiDoc' | 'ownerIdDoc';
    storagePath: string;
  }): Promise<void> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable('recordShopKycUpload');
      await fn(args);
      return;
    }
    const fn = httpsCallable(functions, 'recordShopKycUpload');
    await fn(args);
  },

  // PR 31 — Admin-only. Returns a `{ docKind: signedReadUrl }` map
  // for every uploaded KYC doc on the given shop. Used by
  // `ShopRegistrationDetailScreen` to render thumbnails. URLs are
  // valid for 1 hour; the screen re-fetches on focus if needed.
  async getShopKycReadUrls(args: {
    shopId: string;
  }): Promise<{ urls: Record<string, string> }> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable('getShopKycReadUrls');
      const result = await fn(args);
      return result.data as { urls: Record<string, string> };
    }
    const fn = httpsCallable(functions, 'getShopKycReadUrls');
    const result = await fn(args);
    return result.data as { urls: Record<string, string> };
  },

  // PR-NEXT-6 (findings #13, #16) — delivery proof photo upload
  // pipeline (3 callables). Mirrors the KYC + menu-image pattern:
  //   1. getDeliveryProofUploadUrl  → mint v4 signed PUT
  //   2. <client PUTs JPEG bytes>
  //   3. recordDeliveryProofUpload  → stamp the order doc
  //   4. getDeliveryProofReadUrl    → on-demand signed READ for
  //                                   any consumer screen render
  //
  // Auth is server-validated (assigned partner only for upload +
  // record; role-mixed for read — customer / shop owner / admin /
  // assigned partner). DO NOT add an `auth.uid` parameter to any of
  // these — claims drive the gate server-side.
  async getDeliveryProofUploadUrl(orderId: string): Promise<{
    uploadUrl: string;
    storagePath: string;
    expiresAt: number;
  }> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable(
        'getDeliveryProofUploadUrl',
      );
      const result = await fn({ orderId });
      return result.data as {
        uploadUrl: string;
        storagePath: string;
        expiresAt: number;
      };
    }
    const fn = httpsCallable(functions, 'getDeliveryProofUploadUrl');
    const result = await fn({ orderId });
    return result.data as {
      uploadUrl: string;
      storagePath: string;
      expiresAt: number;
    };
  },

  async recordDeliveryProofUpload(args: {
    orderId: string;
    storagePath: string;
  }): Promise<{ ok: true }> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable(
        'recordDeliveryProofUpload',
      );
      const result = await fn(args);
      return result.data as { ok: true };
    }
    const fn = httpsCallable(functions, 'recordDeliveryProofUpload');
    const result = await fn(args);
    return result.data as { ok: true };
  },

  async getDeliveryProofReadUrl(orderId: string): Promise<{
    readUrl: string;
    expiresAt: number;
  }> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable(
        'getDeliveryProofReadUrl',
      );
      const result = await fn({ orderId });
      return result.data as { readUrl: string; expiresAt: number };
    }
    const fn = httpsCallable(functions, 'getDeliveryProofReadUrl');
    const result = await fn({ orderId });
    return result.data as { readUrl: string; expiresAt: number };
  },

  // PR 8 Part B — Bulk-toggle availability on multiple menu items
  // owned by the caller's shop. Server validates shopOwner claim +
  // per-id ownership; ids that don't match the caller's shop are
  // silently dropped (returned as `skippedCount`).
  async bulkUpdateMenuAvailability(args: {
    menuItemIds: string[];
    available: boolean;
  }): Promise<{ updatedCount: number; skippedCount: number }> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable(
        'bulkUpdateMenuAvailability',
      );
      const result = await fn(args);
      return result.data as {
        updatedCount: number;
        skippedCount: number;
      };
    }
    const fn = httpsCallable(functions, 'bulkUpdateMenuAvailability');
    const result = await fn(args);
    return result.data as {
      updatedCount: number;
      skippedCount: number;
    };
  },

  // PR-NEXT-ENH-2 (finding #5 follow-up) — Bulk soft-delete menu
  // items owned by the caller's shop. Server validates shopOwner
  // claim + scopes the query to the shop's own subcollection;
  // already-deleted ids and ids that don't match the caller's shop
  // are silently dropped (returned as `skippedCount`). Mirror of
  // `bulkUpdateMenuAvailability` above — same callable wrapper
  // shape on both native + web paths.
  async bulkRemoveMenuItems(args: {
    menuItemIds: string[];
  }): Promise<{ deletedCount: number; skippedCount: number }> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable('bulkRemoveMenuItems');
      const result = await fn(args);
      return result.data as {
        deletedCount: number;
        skippedCount: number;
      };
    }
    const fn = httpsCallable(functions, 'bulkRemoveMenuItems');
    const result = await fn(args);
    return result.data as {
      deletedCount: number;
      skippedCount: number;
    };
  },

  // PR 8 Part A — Admin-only paginated audit-log reader. Cursor
  // pagination via `before` (ms timestamp). Returns up to `limit`
  // entries (default 50, max 100) ordered by timestamp desc, plus
  // a `hasMore` flag for the "Load more" button.
  async listRecentAuditEntries(args?: {
    limit?: number;
    before?: number;
  }): Promise<{ entries: any[]; hasMore: boolean }> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable(
        'listRecentAuditEntries',
      );
      const result = await fn(args ?? {});
      return result.data as { entries: any[]; hasMore: boolean };
    }
    const fn = httpsCallable(functions, 'listRecentAuditEntries');
    const result = await fn(args ?? {});
    return result.data as { entries: any[]; hasMore: boolean };
  },

  // PR 38.1 — featureUsageLog callables. The Web SDK Firestore
  // client cannot see RNFB's auth on native (same root cause as
  // PR 6.1's signed-upload-URL fix), so direct addDoc / getDocs
  // against `featureUsageLog/` silently failed (writes) or hard-
  // failed (reads) on the phone. These wrappers route both
  // operations through the standard cross-SDK callable dispatch.
  async logFeatureUsageEvent(args: {
    feature: string;
    shopId?: string;
  }): Promise<void> {
    // Fire-and-forget on the caller side — analytics writes never
    // block UX. The callable returns `{ ok: false }` silently for
    // unauthenticated / invalid input; we don't surface either.
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable('logFeatureUsageEvent');
      await fn(args);
      return;
    }
    const fn = httpsCallable(functions, 'logFeatureUsageEvent');
    await fn(args);
  },

  async queryFeatureUsageLog(args: { period: '7d' | '30d' }): Promise<{
    ok: true;
    events: Array<{
      uid: string;
      role: string;
      feature: string;
      date: string;
      timestamp: number | null;
      shopId?: string;
    }>;
    truncated: boolean;
  }> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable('queryFeatureUsageLog');
      const result = await fn(args);
      return result.data as any;
    }
    const fn = httpsCallable(functions, 'queryFeatureUsageLog');
    const result = await fn(args);
    return result.data as any;
  },

  // Returns shops with no current owner (ownerUid null/missing).
  // Powers the BecomeShopOwner picker.
  async listAvailableShops(): Promise<
    Array<{ id: string; name: string; address: string }>
  > {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable('listAvailableShops');
      const result = await fn();
      return (result.data as any[]) ?? [];
    }
    const fn = httpsCallable(functions, 'listAvailableShops');
    const result = await fn();
    return ((result.data as any[]) ?? []);
  },

  // Polling-based shop dashboard (10s cadence, mirrors watchAllOrders).
  // Server enforces that the caller is the shop owner of `shopId`
  // (or admin) — see listShopOrders in functions/src/index.ts.
  watchShopOrders(
    shopId: string,
    cb: (orders: Order[], error?: Error) => void,
  ): () => void {
    if (isNative) {
      let cancelled = false;
      const poll = async () => {
        if (cancelled) return;
        try {
          const fn = getNativeFunctions().httpsCallable('listShopOrders');
          const result = await fn({ shopId });
          if (!cancelled) cb((result.data as any[]).map(toOrder), undefined);
        } catch (e) {
          // Surface the error so the screen can flip its loader off
          // and render a retry banner. Previously this branch only
          // console.warn'd, which left ShopOwnerDashboardScreen
          // spinning forever on the very first failed poll.
          console.warn('[watchShopOrders] poll failed:', e);
          if (!cancelled) {
            cb([], e instanceof Error ? e : new Error(String(e)));
          }
        }
      };
      poll();
      const interval = setInterval(poll, 10000);
      return () => {
        cancelled = true;
        clearInterval(interval);
      };
    }
    // Web: callable also works fine, but a snapshot listener gives
    // realtime updates with no extra Function invocations. We mirror
    // watchAllOrders' web path for consistency.
    const q = query(
      collection(db, 'orders'),
      where('shopId', '==', shopId),
      orderBy('createdAt', 'desc'),
      limit(100),
    );
    return onSnapshot(
      q,
      snap => cb(snap.docs.map(d => toOrder(d.data())), undefined),
      err => {
        console.warn('[watchShopOrders] snapshot failed:', err);
        cb([], err instanceof Error ? err : new Error(String(err)));
      },
    );
  },

  // PR 36 — Customer CRM rollup. Server enforces the same access
  // gate as listShopOrders: shop owners only see their own shop;
  // admins can pass an explicit shopId. Returns server-computed
  // rollups + summary; nothing is persisted.
  async listShopCustomers(input: {
    shopId?: string;
    sortBy?: 'top_revenue' | 'recent' | 'stopped';
    period?: '90d' | '180d' | 'all';
    limit?: number;
    minDaysSinceLastOrder?: number;
  }): Promise<{
    customers: ShopCustomer[];
    summary: {
      totalUniqueCustomers: number;
      totalRevenue: number;
      ordersScanned: number;
      ordersInPeriod: number;
      truncated: boolean;
    };
  }> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable('listShopCustomers');
      const result = await fn(input);
      return result.data as any;
    }
    const fn = httpsCallable(functions, 'listShopCustomers');
    const result = await fn(input);
    return result.data as any;
  },

  // PR 41 — Pending-approval counts for HomeScreen badges. Server
  // projects onto the caller's role: admin sees shopCount +
  // deliveryCount, shop owner sees pendingOrderCount, anyone else
  // gets all zeros. Never throws permission-denied for signed-in
  // callers (it would spam Sentry on every customer launch); only
  // throws for unauthenticated requests, which the hook gates on
  // anyway.
  async getPendingApprovalCounts(): Promise<{
    shopCount: number;
    deliveryCount: number;
    pendingOrderCount: number;
  }> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable(
        'getPendingApprovalCounts',
      );
      const result = await fn();
      return (result.data ?? {
        shopCount: 0,
        deliveryCount: 0,
        pendingOrderCount: 0,
      }) as any;
    }
    const fn = httpsCallable(functions, 'getPendingApprovalCounts');
    const result = await fn();
    return (result.data ?? {
      shopCount: 0,
      deliveryCount: 0,
      pendingOrderCount: 0,
    }) as any;
  },

  // ──────────────────────────────────────────────────────────
  // Delivery flow (Phase 12b)
  // ──────────────────────────────────────────────────────────

  async listAvailableDeliveries(): Promise<Order[]> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable('listAvailableDeliveries');
      const result = await fn();
      return ((result.data as any[]) ?? []).map(toOrder);
    }
    const fn = httpsCallable(functions, 'listAvailableDeliveries');
    const result = await fn();
    return ((result.data as any[]) ?? []).map(toOrder);
  },

  async listMyDeliveries(): Promise<Order[]> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable('listMyDeliveries');
      const result = await fn();
      return ((result.data as any[]) ?? []).map(toOrder);
    }
    const fn = httpsCallable(functions, 'listMyDeliveries');
    const result = await fn();
    return ((result.data as any[]) ?? []).map(toOrder);
  },

  async claimDelivery(input: { orderId: string }): Promise<void> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable('claimDelivery');
      await fn(input);
      return;
    }
    const fn = httpsCallable(functions, 'claimDelivery');
    await fn(input);
  },

  async markPickedUp(input: { orderId: string }): Promise<void> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable('markPickedUp');
      await fn(input);
      return;
    }
    const fn = httpsCallable(functions, 'markPickedUp');
    await fn(input);
  },

  async markDelivered(input: { orderId: string }): Promise<void> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable('markDelivered');
      await fn(input);
      return;
    }
    const fn = httpsCallable(functions, 'markDelivered');
    await fn(input);
  },

  // PR-NEXT-3 §F — Part A client wrapper. Mints a fresh Razorpay
  // session for an existing COD order so the customer can convert
  // to online mid-flow. Mirrors `retryPayment`'s return shape —
  // OrderDetailScreen drops the result straight into the same
  // `openRazorpayCheckout` flow. On Razorpay success the screen
  // calls `confirmPayment` (which now stamps `paidMethod: 'online'`
  // and fans out the COD-conversion push). Server-side race-guard
  // refuses if the partner already confirmed cash (Part B).
  async payCodOrder(orderId: string): Promise<{
    orderId: string;
    total: number;
    razorpayOrderId: string;
    razorpayKeyId: string;
  }> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable('payCodOrder');
      const result = await fn({ orderId });
      return result.data as any;
    }
    const fn = httpsCallable(functions, 'payCodOrder');
    const result = await fn({ orderId });
    return result.data as any;
  },

  // PR-NEXT-3 §F — Part B client wrapper. Delivery partner stamps
  // cash settlement so `markDelivered` can proceed. Server returns
  // `{ alreadyPaid: true }` if the customer concurrently paid
  // online via Part A — the dashboard should treat that as success
  // (show a friendly toast, fall through to the Delivered button
  // on the next watcher tick).
  async confirmCodPayment(input: {
    orderId: string;
    paidMethod: 'cash' | 'online';
  }): Promise<{ ok: true; alreadyPaid: boolean }> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable('confirmCodPayment');
      const result = await fn(input);
      return result.data as { ok: true; alreadyPaid: boolean };
    }
    const fn = httpsCallable(functions, 'confirmCodPayment');
    const result = await fn(input);
    return result.data as { ok: true; alreadyPaid: boolean };
  },

  // PR-NEXT-PARTNER-CARD.1 (Case 6 retest) — customer-side phone
  // reveal for the assigned delivery partner. Gated server-side by
  // `getDeliveryPartnerContactPure`: caller MUST be the order's
  // `customerId`, order MUST have a `deliveryPersonId`, and
  // `pickedUpAt` MUST be set. Pre-pickup callers see
  // `failed-precondition` ("Partner phone is shared once the order
  // is picked up.") — `PartnerDetailsSheet` surfaces that as an
  // Alert via its `revealPhone` handler. No phone is ever
  // denormalized onto the order doc; the only way to obtain it is
  // through this explicit pull.
  //
  // PR-NEXT-PARTNER-CARD.2 — the server-side gate now checks the
  // order's `customerUid` (not `customerId`, which never existed
  // as an order field). Pre-fix, every customer's reveal failed
  // silently with `not_customer`.
  async getDeliveryPartnerContact(orderId: string): Promise<{ phone: string }> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable('getDeliveryPartnerContact');
      const result = await fn({ orderId });
      return result.data as { phone: string };
    }
    const fn = httpsCallable<{ orderId: string }, { phone: string }>(
      functions,
      'getDeliveryPartnerContact',
    );
    const result = await fn({ orderId });
    return result.data;
  },

  // PR-NEXT-PARTNER-CARD.2 — live partner ETA reveal. Polled at 30s
  // intervals by `useLivePartnerEta` while the sheet is open; auto-
  // pauses on dismissal (the hook's effect cleanup clears the
  // interval). Server gate mirrors `getDeliveryPartnerContact`:
  // caller MUST be the order's `customerUid`, order MUST have a
  // `deliveryPersonId`, AND the relevant target leg (shop pre-pickup,
  // drop post-pickup) MUST have a `lat/lng`.
  //
  // Failure modes that the client maps to "static fallback":
  //   - `no_partner_location` (partner hasn't reported GPS yet)
  //   - `no_target_location` (legacy pre-PR-46/49 orders)
  // Both surface as `failed-precondition` and the hook treats them
  // as "use order.deliveryDistanceKm / deliveryDurationMin with the
  // ~ estimated suffix" rather than alerting the customer.
  async getLivePartnerEta(orderId: string): Promise<{
    distanceKm: number;
    etaMin: number;
    stale: boolean;
    lastUpdatedAtMs: number;
  }> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable('getLivePartnerEta');
      const result = await fn({ orderId });
      return result.data as {
        distanceKm: number;
        etaMin: number;
        stale: boolean;
        lastUpdatedAtMs: number;
      };
    }
    const fn = httpsCallable<
      { orderId: string },
      { distanceKm: number; etaMin: number; stale: boolean; lastUpdatedAtMs: number }
    >(functions, 'getLivePartnerEta');
    const result = await fn({ orderId });
    return result.data;
  },

  async setDeliveryStatus(input: {
    status: 'online' | 'offline';
  }): Promise<void> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable('setDeliveryStatus');
      await fn(input);
      return;
    }
    const fn = httpsCallable(functions, 'setDeliveryStatus');
    await fn(input);
  },

  // PR 49 — write the partner's foreground GPS pin to
  // `users/{uid}.currentLocation`. Best-effort from the dashboard:
  // callers should `.catch(() => {})` so a transient network /
  // permission failure never blocks the screen. The dashboard's
  // nearest-first sort uses the LIVE client GPS directly, not a
  // round-trip through this callable; the persisted value exists
  // for PR 50's push-fanout filter.
  async reportDeliveryLocation(input: {
    lat: number;
    lng: number;
  }): Promise<void> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable(
        'reportDeliveryLocation',
      );
      await fn(input);
      return;
    }
    const fn = httpsCallable(functions, 'reportDeliveryLocation');
    await fn(input);
  },

  // PR 50 — partner notification-radius write. Server validates
  // 1–50 integer; callers should `try/catch` and surface inline
  // errors. Returns the persisted value so the dashboard can pin
  // its local state to the server's normalized result (currently
  // identical, but defensive).
  async updateMyDeliverySettings(input: {
    notificationRadiusKm: number;
  }): Promise<{ ok: true; notificationRadiusKm: number }> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable(
        'updateMyDeliverySettings',
      );
      const res = await fn(input);
      return res.data as { ok: true; notificationRadiusKm: number };
    }
    const fn = httpsCallable(functions, 'updateMyDeliverySettings');
    const res = await fn(input);
    return res.data as { ok: true; notificationRadiusKm: number };
  },

  // PR 50 — partner settings read. Dashboard calls this in its
  // `useFocusEffect` to populate the Online switch + radius input
  // from authoritative server state on every focus (also
  // incidentally fixes finding #8 — Online toggle persistence
  // across screen navigations).
  async getMyDeliverySettings(): Promise<{
    deliveryStatus: 'online' | 'offline';
    notificationRadiusKm: number;
  }> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable(
        'getMyDeliverySettings',
      );
      const res = await fn({});
      return res.data as {
        deliveryStatus: 'online' | 'offline';
        notificationRadiusKm: number;
      };
    }
    const fn = httpsCallable(functions, 'getMyDeliverySettings');
    const res = await fn({});
    return res.data as {
      deliveryStatus: 'online' | 'offline';
      notificationRadiusKm: number;
    };
  },

  // Polling helpers — same shape as watchShopOrders / watchAllOrders.
  // Available pickups churn fast (multiple delivery people racing), so
  // 15s is the upper bound the spec calls for. My-deliveries needs to
  // be snappier because the user is actively tapping buttons → 10s.
  watchAvailableDeliveries(
    cb: (orders: Order[], error?: Error) => void,
  ): () => void {
    let cancelled = false;
    const poll = async () => {
      if (cancelled) return;
      try {
        const list = await this.listAvailableDeliveries();
        if (!cancelled) cb(list, undefined);
      } catch (e) {
        console.warn('[watchAvailableDeliveries] poll failed:', e);
        if (!cancelled) {
          cb([], e instanceof Error ? e : new Error(String(e)));
        }
      }
    };
    poll();
    const interval = setInterval(poll, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  },

  watchMyDeliveries(
    cb: (orders: Order[], error?: Error) => void,
  ): () => void {
    let cancelled = false;
    const poll = async () => {
      if (cancelled) return;
      try {
        const list = await this.listMyDeliveries();
        if (!cancelled) cb(list, undefined);
      } catch (e) {
        console.warn('[watchMyDeliveries] poll failed:', e);
        if (!cancelled) {
          cb([], e instanceof Error ? e : new Error(String(e)));
        }
      }
    };
    poll();
    const interval = setInterval(poll, 10000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  },

  watchAllOrders(
    cb: (orders: Order[], error?: Error) => void,
  ): () => void {
    if (isNative) {
      // Admin dashboard polling. 10s cadence — admins typically have
      // the screen open longer; halving function invocations is worth
      // the slightly staler UI.
      let cancelled = false;
      const poll = async () => {
        if (cancelled) return;
        try {
          const fn = getNativeFunctions().httpsCallable('listAllOrders');
          const result = await fn();
          if (!cancelled) cb((result.data as any[]).map(toOrder), undefined);
        } catch (e) {
          console.warn('[watchAllOrders] poll failed:', e);
          if (!cancelled) {
            cb([], e instanceof Error ? e : new Error(String(e)));
          }
        }
      };
      poll();
      const interval = setInterval(poll, 10000);
      return () => {
        cancelled = true;
        clearInterval(interval);
      };
    }
    const q = query(
      collection(db, 'orders'),
      orderBy('createdAt', 'desc'),
      limit(100),
    );
    return onSnapshot(
      q,
      snap => cb(snap.docs.map(d => toOrder(d.data())), undefined),
      err => {
        console.warn('[watchAllOrders] snapshot failed:', err);
        cb([], err instanceof Error ? err : new Error(String(err)));
      },
    );
  },
};
