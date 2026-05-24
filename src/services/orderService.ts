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
    DeliveryRequest,
    ExtractedMenuItem,
    MenuItem,
    NewMenuItemInput,
    Order,
    ParsedShopFields,
    PaymentMethod,
    Shop,
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
  async submitOrderRating(input: {
    orderId: string;
    stars: 1 | 2 | 3 | 4 | 5;
    comment?: string;
  }): Promise<{ ok: true; stars: number; comment?: string }> {
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
  async updateShopSettings(input: {
    shopId?: string;
    deliveryFee?: number;
    minOrder?: number;
  }): Promise<{
    ok: boolean;
    shopId: string;
    updates: { deliveryFee?: number; minOrder?: number };
  }> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable('updateShopSettings');
      const result = await fn(input);
      return result.data as {
        ok: boolean;
        shopId: string;
        updates: { deliveryFee?: number; minOrder?: number };
      };
    }
    const fn = httpsCallable(functions, 'updateShopSettings');
    const result = await fn(input);
    return result.data as {
      ok: boolean;
      shopId: string;
      updates: { deliveryFee?: number; minOrder?: number };
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

  async removeMenuItem(input: {
    menuItemId: string;
  }): Promise<{ deleted: boolean; softDisabled?: boolean }> {
    if (isNative) {
      const fn = getNativeFunctions().httpsCallable('removeMenuItem');
      const result = await fn(input);
      return result.data as { deleted: boolean; softDisabled?: boolean };
    }
    const fn = httpsCallable(functions, 'removeMenuItem');
    const result = await fn(input);
    return result.data as { deleted: boolean; softDisabled?: boolean };
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
