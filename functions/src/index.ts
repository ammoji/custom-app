import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';
import { setGlobalOptions } from 'firebase-functions/v2';
import {
    onDocumentCreated,
    onDocumentUpdated,
} from 'firebase-functions/v2/firestore';
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as crypto from 'node:crypto';
import Razorpay from 'razorpay';

/**
 * PLATFORM POLICY — DO NOT VIOLATE
 *
 * Admin claim must NEVER be grantable via callable Cloud Function.
 * The only path to admin role is scripts/set-admin.ts which requires
 * service-account.json (held only by platform operator).
 *
 * If you find yourself writing a `grantAdmin()` callable, STOP and
 * reconsider the design. Most legitimate use cases (inviting another
 * admin, role hand-off) should go through the CLI script run by the
 * existing admin.
 *
 * Corollary: governance callables (revokeShopOwner, revokeDelivery,
 * suspendShop, etc.) MUST refuse to operate on the caller's own uid.
 * That keeps single-admin lockout impossible — the platform owner
 * has to grant admin to a successor via CLI before stepping down.
 */

initializeApp();
setGlobalOptions({ region: 'asia-south1' });
const db = getFirestore();

// Secrets — set via `firebase functions:secrets:set <NAME>`.
// RAZORPAY_WEBHOOK_SECRET is only read by razorpayWebhook; the other two
// are only read by placeOrder when paymentMethod === 'online'.
const RAZORPAY_KEY_ID = defineSecret('RAZORPAY_KEY_ID');
const RAZORPAY_KEY_SECRET = defineSecret('RAZORPAY_KEY_SECRET');
const RAZORPAY_WEBHOOK_SECRET = defineSecret('RAZORPAY_WEBHOOK_SECRET');

type OrderStatus =
  | 'pending'
  | 'accepted'
  | 'preparing'
  | 'out_for_delivery'
  | 'delivered'
  | 'cancelled';

const VALID_ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ['accepted', 'cancelled'],
  accepted: ['preparing', 'cancelled'],
  preparing: ['out_for_delivery', 'cancelled'],
  out_for_delivery: ['delivered'],
  delivered: [],
  cancelled: [],
};

type PaymentMethod = 'cod' | 'online';
// Phase 12a-v2-iii: cart lines can now carry a `menuItemId` referencing
// a doc in `shops/{shopId}/menu`. When present, placeOrder validates
// against the per-shop menu (price match within ±1 paisa, available,
// stock); when absent, it falls back to the legacy products-collection
// validation so older AsyncStorage carts on already-installed clients
// keep working through the rollout. `priceSnapshot` is the price the
// client believed it was charging when the user added the item; we
// reject if the menu doc has drifted since then so a stale tab can't
// place an order at yesterday's discounted price.
type ClientItem = {
  productId: string;
  quantity: number;
  menuItemId?: string;
  priceSnapshot?: number;
};
type PlaceOrderInput = {
  shopId: string;
  items: ClientItem[];
  address: {
    name: string;
    line1: string;
    line2?: string;
    city: string;
    pincode: string;
    phone: string;
  };
  paymentMethod: PaymentMethod;
};

export const placeOrder = onCall<PlaceOrderInput>(
  {
    cors: true,
    enforceAppCheck: false,
    secrets: [RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET],
  },
  async request => {
    const auth = request.auth;
    if (!auth) throw new HttpsError('unauthenticated', 'Sign in required');

    const { shopId, items: clientItems, address, paymentMethod } = request.data;

    if (!shopId || !Array.isArray(clientItems) || clientItems.length === 0) {
      throw new HttpsError('invalid-argument', 'Missing shopId or items');
    }
    if (!address?.line1 || !/^\d{6}$/.test(address.pincode) || !address.phone) {
      throw new HttpsError('invalid-argument', 'Incomplete or invalid address');
    }
    if (paymentMethod !== 'cod' && paymentMethod !== 'online') {
      throw new HttpsError('invalid-argument', 'Invalid paymentMethod');
    }

    const shopSnap = await db.doc(`shops/${shopId}`).get();
    if (!shopSnap.exists) throw new HttpsError('not-found', 'Shop not found');
    const shop = shopSnap.data() as {
      name: string;
      isOpen: boolean;
      minOrder: number;
      deliveryFee: number;
      etaMinutes?: number;
    };
    if (!shop.isOpen) throw new HttpsError('failed-precondition', 'Shop is closed');

    // Phase 12a-v2-iii: per-line validation now dispatches on the
    // presence of `menuItemId`. New carts (post-OTA) carry it; older
    // carts persisted in AsyncStorage from before this rollout do
    // not, and fall through to the legacy products-collection path
    // unchanged. Two key invariants enforced server-side:
    //   1. The price the customer is charged is the CURRENT menu
    //      price, not the client-supplied snapshot. The snapshot is
    //      used only for drift detection (>1 paisa rejects).
    //   2. `available == false` or `stock < quantity` rejects with
    //      `failed-precondition` so the client can tell the user
    //      something on their cart changed since add-to-cart.
    const serverItems = await Promise.all(
      clientItems.map(async ci => {
        if (!Number.isInteger(ci.quantity) || ci.quantity < 1 || ci.quantity > 99) {
          throw new HttpsError(
            'invalid-argument',
            `Invalid quantity for ${ci.menuItemId ?? ci.productId}`,
          );
        }

        // ── Path 1: per-shop menu (v2-iii) ──────────────────────
        if (ci.menuItemId) {
          const menuRef = db.doc(`shops/${shopId}/menu/${ci.menuItemId}`);
          const menuSnap = await menuRef.get();
          if (!menuSnap.exists) {
            throw new HttpsError(
              'failed-precondition',
              `Item ${ci.menuItemId} is no longer on this shop's menu`,
            );
          }
          const menu = menuSnap.data() as {
            id: string;
            productId: string | null;
            name: string;
            imageUrl: string;
            packLabel: string;
            price: number;
            available: boolean;
            stock: number | null;
          };
          if (!menu.available) {
            throw new HttpsError(
              'failed-precondition',
              `${menu.name} is currently unavailable`,
            );
          }
          if (menu.stock !== null && menu.stock < ci.quantity) {
            throw new HttpsError(
              'failed-precondition',
              `${menu.name} only has ${menu.stock} in stock`,
            );
          }
          if (
            typeof ci.priceSnapshot === 'number' &&
            Math.abs(menu.price - ci.priceSnapshot) > 0.01
          ) {
            throw new HttpsError(
              'failed-precondition',
              `${menu.name} price changed. Please refresh and try again.`,
            );
          }
          return {
            // For CUSTOM items menu.productId is null — we use the
            // menuItemId as the order-line productId so the existing
            // Order schema (which requires productId) stays sound.
            productId: menu.productId ?? menu.id,
            menuItemId: menu.id,
            name: menu.name,
            imageUrl: menu.imageUrl,
            packLabel: menu.packLabel,
            // Always trust the server's current menu price — never
            // the client-supplied snapshot.
            price: menu.price,
            quantity: ci.quantity,
          };
        }

        // ── Path 2: legacy global product (pre-v2-iii carts) ────
        const productSnap = await db.doc(`products/${ci.productId}`).get();
        if (!productSnap.exists) {
          throw new HttpsError('not-found', `Product ${ci.productId} not found`);
        }
        const product = productSnap.data() as {
          id: string;
          name: string;
          imageUrl: string;
          packSize: { value: number; unit: string };
          price: number;
          shopId: string;
          inStock: boolean;
        };
        if (product.shopId !== shopId) {
          throw new HttpsError(
            'invalid-argument',
            `Product ${ci.productId} not in this shop`,
          );
        }
        if (!product.inStock) {
          throw new HttpsError('failed-precondition', `${product.name} is out of stock`);
        }
        return {
          productId: product.id,
          name: product.name,
          imageUrl: product.imageUrl,
          packLabel: `${product.packSize.value} ${product.packSize.unit}`,
          price: product.price,
          quantity: ci.quantity,
        };
      }),
    );

    const subtotal = serverItems.reduce((sum, i) => sum + i.price * i.quantity, 0);
    if (subtotal < shop.minOrder) {
      throw new HttpsError('failed-precondition', `Minimum order is ₹${shop.minOrder}`);
    }
    const deliveryFee: number = shop.deliveryFee;
    const total = subtotal + deliveryFee;
    const etaMinutes: number = shop.etaMinutes ?? 30;

    const orderId = `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const now = Date.now();

    // For 'online', create a Razorpay order up-front so the client can
    // open Checkout immediately after placeOrder returns.
    let razorpayOrderId: string | null = null;
    let razorpayKeyId: string | null = null;
    let paymentStatus: 'pending' | 'not_required' = 'not_required';

    if (paymentMethod === 'online') {
      const keyId = RAZORPAY_KEY_ID.value();
      const keySecret = RAZORPAY_KEY_SECRET.value();
      const razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });
      try {
        const rzpOrder = await razorpay.orders.create({
          amount: Math.round(total * 100), // paise
          currency: 'INR',
          receipt: orderId,
          notes: {
            orderId,
            customerUid: auth.uid,
            shopId,
          },
        });
        razorpayOrderId = rzpOrder.id;
        razorpayKeyId = keyId;
        paymentStatus = 'pending';
      } catch (err: any) {
        console.error('[placeOrder] razorpay.orders.create failed', err);
        throw new HttpsError(
          'internal',
          `Could not create payment session: ${err?.error?.description ?? err?.message ?? 'unknown'}`,
        );
      }
    }

    const order = {
      id: orderId,
      customerUid: auth.uid,
      shopId,
      shopName: shop.name,
      items: serverItems,
      subtotal,
      deliveryFee,
      total,
      deliveryAddress: address,
      paymentMethod,
      paymentStatus,
      ...(razorpayOrderId ? { razorpayOrderId } : {}),
      status: 'pending',
      statusHistory: [{ status: 'pending', at: now, by: 'system' }],
      estimatedDeliveryAt: now + etaMinutes * 60_000,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      // Phase 12b delivery-flow placeholders. Setting deliveryPersonId
      // to null at create-time is REQUIRED so the
      // listAvailableDeliveries query (where deliveryPersonId == null)
      // can find this order once the shop owner moves it to
      // out_for_delivery. Firestore equality on missing fields
      // doesn't work, hence the explicit null.
      deliveryPersonId: null,
      pickedUpAt: null,
      deliveredAt: null,
    };

    await db.doc(`orders/${orderId}`).set(order);

    return {
      orderId,
      total,
      etaMinutes,
      shopName: shop.name,
      razorpayOrderId,
      razorpayKeyId,
    };
  },
);

type UpdateOrderStatusInput = {
  orderId: string;
  newStatus: OrderStatus;
  reason?: string;
};

export const updateOrderStatus = onCall<UpdateOrderStatusInput>(
  // App Check disabled here so admin SDK / server callers (CLI dashboards)
  // can invoke without holding a browser App Check token. Auth + admin
  // claim is the actual gate.
  { cors: true, enforceAppCheck: false },
  async request => {
    const auth = request.auth;
    if (!auth) throw new HttpsError('unauthenticated', 'Sign in required');

    const { orderId, newStatus, reason } = request.data;
    if (!orderId || !newStatus) {
      throw new HttpsError('invalid-argument', 'orderId and newStatus required');
    }
    if (!(newStatus in VALID_ORDER_TRANSITIONS)) {
      throw new HttpsError('invalid-argument', `Unknown status: ${newStatus}`);
    }

    // Fetch the order BEFORE authorizing — we need shopId to evaluate
    // the shop-owner branch below.
    const ref = db.doc(`orders/${orderId}`);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', `Order ${orderId} not found`);

    const order = snap.data() as { status: OrderStatus; shopId: string };

    // Authorization: admin OR shop owner of this order's shop.
    // Phase 12a: shop owners get the same status transitions as admins
    // (the orderStateMachine governs which transitions are valid per
    // current status — both roles share that machine for now). If we
    // later want shop-owner-only restrictions (e.g. shop owners can't
    // mark `delivered`, only delivery partners can — Phase 12b), that
    // policy goes here.
    const isAdmin = auth.token?.admin === true;
    const isShopOwnerOfThisOrder =
      auth.token?.shopOwner === true &&
      auth.token?.shopId === order.shopId;
    if (!isAdmin && !isShopOwnerOfThisOrder) {
      throw new HttpsError(
        'permission-denied',
        'Admin or shop owner of this shop required',
      );
    }

    const currentStatus = order.status;
    if (currentStatus === newStatus) {
      return { orderId, status: newStatus, changed: false };
    }
    if (!VALID_ORDER_TRANSITIONS[currentStatus].includes(newStatus)) {
      throw new HttpsError(
        'failed-precondition',
        `Cannot transition from ${currentStatus} to ${newStatus}`,
      );
    }

    const now = Date.now();
    const actorRole = isAdmin ? 'admin' : 'shopOwner';
    await ref.update({
      status: newStatus,
      updatedAt: FieldValue.serverTimestamp(),
      statusHistory: FieldValue.arrayUnion({
        status: newStatus,
        at: now,
        by: `${actorRole}:${auth.uid}`,
        ...(reason ? { reason } : {}),
      }),
    });

    return { orderId, status: newStatus, changed: true };
  },
);

// ---------------------------------------------------------------------
// Customer-driven recovery for stuck online orders
// ---------------------------------------------------------------------
// When a customer dismisses the Razorpay sheet without paying, the order
// sits in paymentStatus='pending' until cleanupAbandonedOrders picks it
// up (~24h). These two callables let the customer recover sooner:
//   - retryPayment       creates a fresh Razorpay order tied to the same
//                        Firestore order doc, returns it to the client
//                        which re-opens Checkout.
//   - cancelMyPendingOrder lets the customer abandon the order
//                        immediately if they've changed their mind.
// Both are auth-gated to the order's customerUid; admins should use the
// existing updateOrderStatus path.

export const retryPayment = onCall<{ orderId: string }>(
  {
    cors: true,
    enforceAppCheck: false,
    secrets: [RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET],
  },
  async request => {
    const auth = request.auth;
    if (!auth) throw new HttpsError('unauthenticated', 'Sign in required');

    const { orderId } = request.data;
    if (!orderId) throw new HttpsError('invalid-argument', 'orderId required');

    const ref = db.doc(`orders/${orderId}`);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new HttpsError('not-found', `Order ${orderId} not found`);
    }

    const order = snap.data() as any;
    if (order.customerUid !== auth.uid) {
      throw new HttpsError('permission-denied', 'Not your order');
    }
    if (order.paymentMethod !== 'online') {
      throw new HttpsError('failed-precondition', 'Order is not an online payment');
    }
    if (order.paymentStatus !== 'pending') {
      throw new HttpsError(
        'failed-precondition',
        `Cannot retry — payment already ${order.paymentStatus}`,
      );
    }
    if (order.status === 'cancelled') {
      throw new HttpsError('failed-precondition', 'Order is cancelled');
    }

    // Always create a fresh Razorpay order. The old razorpayOrderId
    // is left orphaned (cheap — Razorpay only charges on capture). The
    // webhook resolves the right Firestore doc via notes.orderId so
    // either old-or-new payment lands correctly.
    const keyId = RAZORPAY_KEY_ID.value();
    const keySecret = RAZORPAY_KEY_SECRET.value();
    const razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });
    let rzpOrder;
    try {
      rzpOrder = await razorpay.orders.create({
        amount: Math.round(order.total * 100),
        currency: 'INR',
        receipt: orderId,
        notes: {
          orderId,
          customerUid: auth.uid,
          shopId: order.shopId,
          retry: 'true',
        },
      });
    } catch (err: any) {
      console.error('[retryPayment] razorpay.orders.create failed', err);
      throw new HttpsError(
        'internal',
        `Could not create payment session: ${err?.error?.description ?? err?.message ?? 'unknown'}`,
      );
    }

    await ref.update({
      razorpayOrderId: rzpOrder.id,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return {
      orderId,
      total: order.total,
      razorpayOrderId: rzpOrder.id,
      razorpayKeyId: keyId,
    };
  },
);

export const cancelMyPendingOrder = onCall<{ orderId: string }>(
  { cors: true, enforceAppCheck: false },
  async request => {
    const auth = request.auth;
    if (!auth) throw new HttpsError('unauthenticated', 'Sign in required');

    const { orderId } = request.data;
    if (!orderId) throw new HttpsError('invalid-argument', 'orderId required');

    const ref = db.doc(`orders/${orderId}`);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new HttpsError('not-found', `Order ${orderId} not found`);
    }

    const order = snap.data() as any;
    if (order.customerUid !== auth.uid) {
      throw new HttpsError('permission-denied', 'Not your order');
    }
    // Only allow customer self-cancel while the shop hasn't started
    // working on it. Once accepted, cancellation needs admin / refund.
    if (order.status !== 'pending') {
      throw new HttpsError(
        'failed-precondition',
        `Cannot cancel — order is ${order.status}`,
      );
    }
    if (order.paymentStatus === 'paid') {
      throw new HttpsError(
        'failed-precondition',
        'Paid orders need admin cancellation (refund flow)',
      );
    }

    const now = Date.now();
    await ref.update({
      status: 'cancelled',
      paymentStatus:
        order.paymentMethod === 'online' ? 'expired' : 'not_required',
      updatedAt: FieldValue.serverTimestamp(),
      statusHistory: FieldValue.arrayUnion({
        status: 'cancelled',
        at: now,
        by: `customer:${auth.uid}`,
        reason: 'Customer cancelled before shop accepted',
      }),
    });

    return { orderId, status: 'cancelled' as const };
  },
);

// ---------------------------------------------------------------------
// Order reads for native clients
// ---------------------------------------------------------------------
// @react-native-firebase/firestore is incompatible with Expo SDK 54 +
// RN 0.81 + static frameworks (see PRELAUNCH_CHECKLIST.md). The iPhone
// app can't talk to Firestore directly with the phone-authed user, so
// these Cloud Functions provide auth-gated reads instead. Web continues
// to use the firebase web SDK Firestore directly (no Function hop).
//
// All three return Timestamps converted to epoch ms so the client's
// existing toOrder() helper stays a no-op on the response.

function tsToMs(value: any): any {
  return value?.toMillis?.() ?? value ?? null;
}

function normalizeOrder(data: any): any {
  return {
    ...data,
    createdAt: tsToMs(data.createdAt),
    estimatedDeliveryAt: tsToMs(data.estimatedDeliveryAt),
    paidAt: tsToMs(data.paidAt),
    updatedAt: tsToMs(data.updatedAt),
    // Phase 12b: only convert if a Timestamp was actually written —
    // null stays null so the client can branch on "has happened yet?"
    pickedUpAt: data.pickedUpAt ? tsToMs(data.pickedUpAt) : null,
    deliveredAt: data.deliveredAt ? tsToMs(data.deliveredAt) : null,
  };
}

export const listMyOrders = onCall(
  { cors: true, enforceAppCheck: false },
  async request => {
    const auth = request.auth;
    if (!auth) throw new HttpsError('unauthenticated', 'Sign in required');

    const snap = await db
      .collection('orders')
      .where('customerUid', '==', auth.uid)
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();

    return snap.docs.map(d => normalizeOrder(d.data()));
  },
);

export const getOrder = onCall<{ orderId: string }>(
  { cors: true, enforceAppCheck: false },
  async request => {
    const auth = request.auth;
    if (!auth) throw new HttpsError('unauthenticated', 'Sign in required');

    const { orderId } = request.data;
    if (!orderId) {
      throw new HttpsError('invalid-argument', 'orderId required');
    }

    const snap = await db.doc(`orders/${orderId}`).get();
    if (!snap.exists) {
      throw new HttpsError('not-found', `Order ${orderId} not found`);
    }

    const data = snap.data() as any;
    const isOwner = data.customerUid === auth.uid;
    const isAdmin = auth.token?.admin === true;
    if (!isOwner && !isAdmin) {
      throw new HttpsError('permission-denied', 'Not your order');
    }

    return normalizeOrder(data);
  },
);

export const listAllOrders = onCall(
  { cors: true, enforceAppCheck: false },
  async request => {
    const auth = request.auth;
    if (!auth) throw new HttpsError('unauthenticated', 'Sign in required');
    if (auth.token?.admin !== true) {
      throw new HttpsError('permission-denied', 'Admin role required');
    }

    const snap = await db
      .collection('orders')
      .orderBy('createdAt', 'desc')
      .limit(100)
      .get();

    return snap.docs.map(d => normalizeOrder(d.data()));
  },
);

// Razorpay webhook — HTTPS trigger (NOT callable). Razorpay POSTs JSON
// with an x-razorpay-signature header = HMAC-SHA256(body, webhookSecret).
// We verify against req.rawBody (byte-exact body Firebase hands us).
export const razorpayWebhook = onRequest(
  {
    region: 'asia-south1',
    cors: false,
    secrets: [RAZORPAY_WEBHOOK_SECRET],
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const signature = req.header('x-razorpay-signature');
    if (!signature) {
      res.status(400).send('Missing signature');
      return;
    }

    const secret = RAZORPAY_WEBHOOK_SECRET.value();
    if (!secret) {
      console.error('[razorpayWebhook] RAZORPAY_WEBHOOK_SECRET not set');
      res.status(500).send('Webhook not configured');
      return;
    }

    const rawBody = req.rawBody ? req.rawBody.toString('utf8') : '';
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

    // timingSafeEqual needs equal-length buffers; guard it.
    const sigBuf = Buffer.from(signature, 'utf8');
    const expBuf = Buffer.from(expected, 'utf8');
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      console.warn('[razorpayWebhook] invalid signature');
      res.status(401).send('Invalid signature');
      return;
    }

    let event: any;
    try {
      event = JSON.parse(rawBody);
    } catch {
      res.status(400).send('Invalid JSON');
      return;
    }

    const eventType: string = event?.event ?? '';
    const payment = event?.payload?.payment?.entity;
    if (!payment) {
      // Not a payment event — acknowledge and ignore (e.g. refund.* etc.).
      res.status(200).send('ignored');
      return;
    }

    // Razorpay order receipt was set to our orderId in placeOrder.
    const receipt: string | undefined = payment.notes?.orderId ?? undefined;
    const razorpayOrderId: string = payment.order_id;

    // Resolve the order doc — prefer receipt/notes.orderId, fall back to
    // a query on razorpayOrderId for safety.
    let orderRef = receipt ? db.doc(`orders/${receipt}`) : null;
    if (orderRef) {
      const snap = await orderRef.get();
      if (!snap.exists) orderRef = null;
    }
    if (!orderRef) {
      const q = await db
        .collection('orders')
        .where('razorpayOrderId', '==', razorpayOrderId)
        .limit(1)
        .get();
      if (q.empty) {
        console.warn('[razorpayWebhook] no order for razorpayOrderId=' + razorpayOrderId);
        // Ack anyway so Razorpay doesn't retry forever.
        res.status(200).send('no-order');
        return;
      }
      orderRef = q.docs[0].ref;
    }

    const orderSnap = await orderRef.get();
    const order = orderSnap.data() as { total?: number } | undefined;
    const expectedPaise = order?.total != null ? Math.round(order.total * 100) : null;
    const amountMismatch =
      expectedPaise != null && typeof payment.amount === 'number' && expectedPaise !== payment.amount;

    if (eventType === 'payment.captured') {
      await orderRef.update({
        paymentStatus: 'paid',
        razorpayPaymentId: payment.id,
        paidAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        ...(amountMismatch ? { amountMismatch: true } : {}),
      });
      res.status(200).send('ok');
      return;
    }

    if (eventType === 'payment.failed') {
      await orderRef.update({
        paymentStatus: 'failed',
        razorpayPaymentId: payment.id,
        paymentFailureMessage:
          payment?.error_description ?? payment?.error_reason ?? 'Payment failed',
        updatedAt: FieldValue.serverTimestamp(),
      });
      res.status(200).send('ok');
      return;
    }

    // Other event types (authorized, pending, etc.) — ack without mutating.
    res.status(200).send('ignored');
  },
);

// Scheduled cleanup of abandoned online orders. Razorpay overlay closed
// without payment, webhook never arrived, etc. leaves orders stuck in
// paymentStatus='pending' forever. We auto-cancel them after 24h so the
// orders collection doesn't fill up with zombies.
//
// COD orders are unaffected: their paymentStatus is 'not_required', so
// the where('paymentStatus','==','pending') filter excludes them.
const ABANDONED_THRESHOLD_HOURS = 24;
const CLEANUP_BATCH_LIMIT = 100; // safety cap per run

export const cleanupAbandonedOrders = onSchedule(
  {
    schedule: 'every 60 minutes',
    region: 'asia-south1',
    timeZone: 'Asia/Kolkata',
  },
  async () => {
    const cutoffMs = Date.now() - ABANDONED_THRESHOLD_HOURS * 60 * 60 * 1000;
    const cutoff = new Date(cutoffMs);

    console.log(
      `[cleanupAbandonedOrders] scanning for orders with paymentStatus='pending' before ${cutoff.toISOString()}`,
    );

    const snap = await db
      .collection('orders')
      .where('paymentStatus', '==', 'pending')
      .where('createdAt', '<', cutoff)
      .limit(CLEANUP_BATCH_LIMIT)
      .get();

    if (snap.empty) {
      console.log('[cleanupAbandonedOrders] nothing to clean');
      return;
    }

    console.log(`[cleanupAbandonedOrders] cancelling ${snap.size} abandoned orders`);

    const batch = db.batch();
    const now = Date.now();
    for (const doc of snap.docs) {
      const order = doc.data();
      batch.update(doc.ref, {
        paymentStatus: 'expired',
        status: 'cancelled',
        updatedAt: FieldValue.serverTimestamp(),
        statusHistory: FieldValue.arrayUnion({
          status: 'cancelled',
          at: now,
          by: 'system:cleanup',
          reason: `Payment not completed within ${ABANDONED_THRESHOLD_HOURS}h`,
        }),
      });
      const createdMs =
        order.createdAt?.toMillis?.() ?? order.createdAt ?? Date.now();
      console.log(
        `  → cancelling ${doc.id} (created ${new Date(createdMs).toISOString()})`,
      );
    }
    await batch.commit();
    console.log(`[cleanupAbandonedOrders] done — cancelled ${snap.size} orders`);
  },
);

// ────────────────────────────────────────────────────────────
// Push notifications
// ────────────────────────────────────────────────────────────
//
// Two pieces:
//   1. registerPushToken — callable. Client sends an Expo push token
//      after the user grants permission; we append it (deduped) to
//      users/{uid}.fcmTokens.
//   2. sendOrderStatusPush — Firestore trigger on orders/{orderId}.
//      When `status` changes, looks up the customer's tokens and posts
//      to Expo's push relay (which fans out to APNs + FCM).
//
// We deliberately use Expo Push (not @react-native-firebase/messaging)
// to avoid stacking another RNFB native module on top of the static-
// frameworks + New-Arch setup we already have working.

export const registerPushToken = onCall<{ token: string }>(
  { cors: true, enforceAppCheck: false },
  async request => {
    const auth = request.auth;
    if (!auth) {
      throw new HttpsError('unauthenticated', 'Sign in required');
    }
    const { token } = request.data ?? ({} as { token?: string });
    if (!token || typeof token !== 'string') {
      throw new HttpsError('invalid-argument', 'token required');
    }
    // Loose validation — Expo tokens look like ExponentPushToken[…] or
    // ExpoPushToken[…]. We don't enforce strictly so the same endpoint
    // can accept raw FCM/APNs tokens later if we migrate.
    await db.doc(`users/${auth.uid}`).set(
      {
        fcmTokens: FieldValue.arrayUnion(token),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return { ok: true };
  },
);

const ORDER_STATUS_LABELS: Record<string, string> = {
  pending: 'Order received',
  accepted: 'Order accepted',
  preparing: 'Preparing your order',
  out_for_delivery: 'Out for delivery',
  delivered: 'Order delivered',
  cancelled: 'Order cancelled',
};

export const sendOrderStatusPush = onDocumentUpdated(
  { document: 'orders/{orderId}', region: 'asia-south1' },
  async event => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;
    if (before.status === after.status) return;

    const customerUid = after.customerUid as string | undefined;
    if (!customerUid) {
      console.warn(
        `[sendOrderStatusPush] order ${event.params.orderId} missing customerUid`,
      );
      return;
    }

    const userSnap = await db.doc(`users/${customerUid}`).get();
    if (!userSnap.exists) {
      console.log(
        `[sendOrderStatusPush] no user doc for ${customerUid} — nothing to notify`,
      );
      return;
    }
    const tokens: string[] = userSnap.data()?.fcmTokens ?? [];
    if (!tokens.length) {
      console.log(
        `[sendOrderStatusPush] no tokens for ${customerUid} — skipping`,
      );
      return;
    }

    const title =
      ORDER_STATUS_LABELS[after.status as string] ?? String(after.status);
    const itemCount = Array.isArray(after.items) ? after.items.length : 0;
    const body = `${after.shopName ?? 'Your shop'} — ${itemCount} item${
      itemCount === 1 ? '' : 's'
    }`;

    const messages = tokens.map(token => ({
      to: token,
      sound: 'default' as const,
      title,
      body,
      data: { orderId: after.id ?? event.params.orderId, type: 'order_status' },
    }));

    try {
      const res = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(messages),
      });
      const data = await res.json();
      console.log(
        `[sendOrderStatusPush] sent ${tokens.length} push(es) for ${event.params.orderId} ` +
          `(${before.status} → ${after.status}):`,
        JSON.stringify(data),
      );
    } catch (e) {
      console.error('[sendOrderStatusPush] error:', e);
    }
  },
);

// ────────────────────────────────────────────────────────────
// Multi-role: shop owner + delivery partner (Phase 12a)
// ────────────────────────────────────────────────────────────
//
// Custom claims schema:
//   - admin     : true       (admin-controlled, set ONLY via the offline
//                             scripts/set-admin.ts CLI script which uses
//                             the Admin SDK directly. There is NO
//                             callable that grants this claim — by
//                             design — so a compromised client can
//                             never escalate. If you ever feel
//                             tempted to add a `grantAdmin` callable,
//                             don't: route the request through a
//                             ticket and run set-admin manually.)
//   - shopOwner : true       (set by approveShop after admin review of
//                             a registerShop submission; Phase 12a-v2-i
//                             deleted the old self-service claimShop)
//   - shopId    : <string>   (the shop they own — set together with shopOwner)
//   - delivery  : true       (self-registered via becomeDelivery, Phase 12b
//                             builds the actual delivery UI/flow)
//
// Customer is implicit — every authenticated user can place orders.
// Phase 12a constraint: one shop per user (no multi-shop ownership).

// Merges new claims onto a user's existing custom claims so we never
// drop an unrelated role (e.g. don't lose `admin` when granting
// `shopOwner`). Apple Auth Admin SDK overwrites the whole claims
// object on setCustomUserClaims, so callers must always merge.
async function mergeCustomClaims(
  uid: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const userRecord = await getAuth().getUser(uid);
  const existing = userRecord.customClaims ?? {};
  await getAuth().setCustomUserClaims(uid, { ...existing, ...patch });
}

// Phase 12a-v2-i deleted the claim-pre-seeded-shop shortcut. Shop
// ownership now flows through registerShop → admin approveShop (see
// below). The mergeCustomClaims helper above is still used by
// becomeDelivery and approveShop.

export const becomeDelivery = onCall(
  { cors: true, enforceAppCheck: false },
  async request => {
    const auth = request.auth;
    if (!auth) throw new HttpsError('unauthenticated', 'Sign in required');
    // No additional KYC gate yet — production needs admin approval (see
    // PRELAUNCH_CHECKLIST). For Phase 12a this just sets the claim so
    // the user is ready when Phase 12b ships the delivery dashboard.
    await mergeCustomClaims(auth.uid, { delivery: true });
    return { ok: true };
  },
);

export const listAvailableShops = onCall(
  { cors: true, enforceAppCheck: false },
  async request => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in required');
    }
    // Treat both `ownerUid == null` and "field absent" as unclaimed.
    // We can't express the union in a single Firestore query, so we
    // fetch all shops and filter server-side. The shop catalog is small
    // (8 shops MVP, low hundreds at scale) — acceptable.
    const snap = await db.collection('shops').get();
    return snap.docs
      .map(d => d.data() as { id: string; name: string; address: string; ownerUid?: string | null })
      .filter(s => !s.ownerUid)
      .map(s => ({ id: s.id, name: s.name, address: s.address }));
  },
);

export const listShopOrders = onCall<{ shopId?: string }>(
  { cors: true, enforceAppCheck: false },
  async request => {
    const auth = request.auth;
    if (!auth) throw new HttpsError('unauthenticated', 'Sign in required');

    const claims = auth.token ?? {};
    const isAdmin = claims.admin === true;
    const isShopOwner = claims.shopOwner === true;
    const ownedShopId =
      typeof claims.shopId === 'string' ? claims.shopId : undefined;

    const targetShopId = request.data?.shopId ?? ownedShopId;
    if (!targetShopId) {
      throw new HttpsError('invalid-argument', 'shopId required');
    }
    if (!isAdmin && !(isShopOwner && targetShopId === ownedShopId)) {
      throw new HttpsError(
        'permission-denied',
        'Not authorized for this shop',
      );
    }

    const snap = await db
      .collection('orders')
      .where('shopId', '==', targetShopId)
      .orderBy('createdAt', 'desc')
      .limit(100)
      .get();

    return snap.docs.map(d => {
      const data = d.data() as Record<string, any>;
      return {
        ...data,
        // Convert all server timestamps to epoch ms so the client
        // can treat the result as plain JSON (matches listAllOrders).
        createdAt: data.createdAt?.toMillis?.() ?? data.createdAt ?? null,
        updatedAt: data.updatedAt?.toMillis?.() ?? data.updatedAt ?? null,
        estimatedDeliveryAt:
          data.estimatedDeliveryAt?.toMillis?.() ??
          data.estimatedDeliveryAt ??
          null,
        paidAt: data.paidAt?.toMillis?.() ?? data.paidAt ?? null,
      };
    });
  },
);

export const sendNewOrderPushToShop = onDocumentCreated(
  { document: 'orders/{orderId}', region: 'asia-south1' },
  async event => {
    const order = event.data?.data();
    if (!order) return;

    const shopSnap = await db.doc(`shops/${order.shopId}`).get();
    if (!shopSnap.exists) return;
    const shop = shopSnap.data() ?? {};
    const ownerUid = shop.ownerUid as string | undefined;
    // Unclaimed shop → no one to notify. Order still flows to the
    // admin dashboard so the platform team can step in.
    if (!ownerUid) {
      console.log(
        `[sendNewOrderPushToShop] shop ${order.shopId} has no owner — skipping`,
      );
      return;
    }

    const userSnap = await db.doc(`users/${ownerUid}`).get();
    if (!userSnap.exists) return;
    const tokens: string[] = userSnap.data()?.fcmTokens ?? [];
    if (!tokens.length) {
      console.log(
        `[sendNewOrderPushToShop] owner ${ownerUid} has no push tokens — skipping`,
      );
      return;
    }

    const itemCount = Array.isArray(order.items) ? order.items.length : 0;
    const totalRupees = Math.round(Number(order.total ?? 0));
    const messages = tokens.map(token => ({
      to: token,
      sound: 'default' as const,
      title: '🛒 New order received',
      body: `${itemCount} item${itemCount === 1 ? '' : 's'} · ₹${totalRupees}`,
      data: {
        orderId: order.id ?? event.params.orderId,
        type: 'new_order_for_shop',
      },
    }));

    try {
      const res = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(messages),
      });
      const data = await res.json();
      console.log(
        `[sendNewOrderPushToShop] sent ${tokens.length} push(es) to owner ${ownerUid} for shop ${order.shopId}:`,
        JSON.stringify(data),
      );
    } catch (e) {
      console.error('[sendNewOrderPushToShop] error:', e);
    }
  },
);

// ────────────────────────────────────────────────────────────
// Delivery flow (Phase 12b)
// ────────────────────────────────────────────────────────────
//
// State encoding (no new statuses; existing state machine is unchanged):
//   out_for_delivery + deliveryPersonId=null              → available pickup
//   out_for_delivery + deliveryPersonId=X + pickedUpAt=null → claimed
//   out_for_delivery + deliveryPersonId=X + pickedUpAt=ts  → en route
//   delivered                                              → done
//
// Online presence: users/{uid}.deliveryStatus ('online' | 'offline')
// is the source of truth. We can't query Auth claims directly, so
// the dashboard pushes presence into the user doc via setDeliveryStatus
// and the new-pickup trigger filters that collection by status.

function requireDeliveryRole(
  request: { auth?: { uid: string; token?: any } | null },
): { uid: string } {
  const auth = request.auth;
  if (!auth) throw new HttpsError('unauthenticated', 'Sign in required');
  if (auth.token?.delivery !== true) {
    throw new HttpsError('permission-denied', 'Delivery role required');
  }
  return { uid: auth.uid };
}

export const listAvailableDeliveries = onCall(
  { cors: true, enforceAppCheck: false },
  async request => {
    requireDeliveryRole(request);
    const snap = await db
      .collection('orders')
      .where('status', '==', 'out_for_delivery')
      .where('deliveryPersonId', '==', null)
      .orderBy('createdAt', 'asc') // oldest first — fairer for shops
      .limit(50)
      .get();
    return snap.docs.map(d => normalizeOrder(d.data()));
  },
);

export const listMyDeliveries = onCall(
  { cors: true, enforceAppCheck: false },
  async request => {
    const { uid } = requireDeliveryRole(request);
    // We fetch all orders assigned to this delivery person and let
    // the client filter "active vs history" by inspecting status +
    // deliveredAt. A single composite index (deliveryPersonId asc +
    // createdAt desc) covers this query.
    const snap = await db
      .collection('orders')
      .where('deliveryPersonId', '==', uid)
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();
    return snap.docs.map(d => normalizeOrder(d.data()));
  },
);

export const claimDelivery = onCall<{ orderId: string }>(
  { cors: true, enforceAppCheck: false },
  async request => {
    const { uid } = requireDeliveryRole(request);
    const orderId = request.data?.orderId;
    if (!orderId) {
      throw new HttpsError('invalid-argument', 'orderId required');
    }
    const ref = db.doc(`orders/${orderId}`);
    // Transaction: atomic first-wins. Two delivery people tapping
    // Accept simultaneously will see exactly one success — the second
    // hits the deliveryPersonId guard and throws.
    await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      if (!snap.exists) {
        throw new HttpsError('not-found', `Order ${orderId} not found`);
      }
      const order = snap.data() as {
        status: OrderStatus;
        deliveryPersonId: string | null;
      };
      if (order.status !== 'out_for_delivery') {
        throw new HttpsError(
          'failed-precondition',
          'Order not ready for pickup',
        );
      }
      if (order.deliveryPersonId) {
        throw new HttpsError(
          'failed-precondition',
          'Already claimed by another delivery partner',
        );
      }
      tx.update(ref, {
        deliveryPersonId: uid,
        updatedAt: FieldValue.serverTimestamp(),
        statusHistory: FieldValue.arrayUnion({
          status: 'out_for_delivery',
          at: Date.now(),
          by: `delivery:${uid}`,
          reason: 'Delivery partner claimed',
        }),
      });
    });
    return { ok: true };
  },
);

export const markPickedUp = onCall<{ orderId: string }>(
  { cors: true, enforceAppCheck: false },
  async request => {
    const { uid } = requireDeliveryRole(request);
    const orderId = request.data?.orderId;
    if (!orderId) {
      throw new HttpsError('invalid-argument', 'orderId required');
    }
    const ref = db.doc(`orders/${orderId}`);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new HttpsError('not-found', `Order ${orderId} not found`);
    }
    const order = snap.data() as {
      deliveryPersonId: string | null;
      pickedUpAt: unknown;
    };
    if (order.deliveryPersonId !== uid) {
      throw new HttpsError(
        'permission-denied',
        'Not the assigned delivery partner',
      );
    }
    if (order.pickedUpAt) {
      // Idempotent: already marked picked up. Don't fail the UI, just
      // no-op so a stale tap doesn't pop a scary alert.
      return { ok: true, alreadySet: true };
    }
    const now = Date.now();
    await ref.update({
      pickedUpAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      statusHistory: FieldValue.arrayUnion({
        status: 'out_for_delivery',
        at: now,
        by: `delivery:${uid}`,
        reason: 'Picked up from shop',
      }),
    });
    return { ok: true };
  },
);

export const markDelivered = onCall<{ orderId: string }>(
  { cors: true, enforceAppCheck: false },
  async request => {
    const { uid } = requireDeliveryRole(request);
    const orderId = request.data?.orderId;
    if (!orderId) {
      throw new HttpsError('invalid-argument', 'orderId required');
    }
    const ref = db.doc(`orders/${orderId}`);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new HttpsError('not-found', `Order ${orderId} not found`);
    }
    const order = snap.data() as {
      deliveryPersonId: string | null;
      status: OrderStatus;
    };
    if (order.deliveryPersonId !== uid) {
      throw new HttpsError(
        'permission-denied',
        'Not the assigned delivery partner',
      );
    }
    if (order.status === 'delivered') {
      return { ok: true, alreadySet: true };
    }
    if (order.status !== 'out_for_delivery') {
      throw new HttpsError(
        'failed-precondition',
        `Cannot deliver from status ${order.status}`,
      );
    }
    const now = Date.now();
    await ref.update({
      status: 'delivered',
      deliveredAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      statusHistory: FieldValue.arrayUnion({
        status: 'delivered',
        at: now,
        by: `delivery:${uid}`,
      }),
    });
    // The existing sendOrderStatusPush trigger fires on this update
    // and pushes to the customer ("Order delivered. Enjoy!"). No
    // explicit push here.
    return { ok: true };
  },
);

export const setDeliveryStatus = onCall<{ status: 'online' | 'offline' }>(
  { cors: true, enforceAppCheck: false },
  async request => {
    const { uid } = requireDeliveryRole(request);
    const status = request.data?.status;
    if (status !== 'online' && status !== 'offline') {
      throw new HttpsError('invalid-argument', 'status must be online|offline');
    }
    // Mirror onto users/{uid} so the new-pickup trigger can query by
    // it (Firestore can't filter by custom claims). isDelivery is
    // also stored — redundant with the claim, but lets the trigger
    // do a single composite query (isDelivery==true && status==online).
    await db.doc(`users/${uid}`).set(
      {
        isDelivery: true,
        deliveryStatus: status,
        deliveryStatusUpdatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return { ok: true };
  },
);

export const sendNewPickupPushToDelivery = onDocumentUpdated(
  { document: 'orders/{orderId}', region: 'asia-south1' },
  async event => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;
    // Fire only on the transition INTO out_for_delivery, not on
    // subsequent updates (pickup / delivery) of the same order.
    if (
      before.status === 'out_for_delivery' ||
      after.status !== 'out_for_delivery'
    ) {
      return;
    }
    // If the order is already claimed at the moment it transitions,
    // skip — no point notifying the world that a claimed pickup is
    // available.
    if (after.deliveryPersonId) return;

    // Find online delivery people. Equality on two fields → no order
    // → no composite index needed.
    const usersSnap = await db
      .collection('users')
      .where('isDelivery', '==', true)
      .where('deliveryStatus', '==', 'online')
      .get();
    if (usersSnap.empty) {
      console.log(
        `[sendNewPickupPushToDelivery] no online delivery people for order ${event.params.orderId}`,
      );
      return;
    }

    const tokens: string[] = [];
    usersSnap.forEach(u => {
      const userTokens: string[] = u.data()?.fcmTokens ?? [];
      tokens.push(...userTokens);
    });
    if (!tokens.length) {
      console.log(
        `[sendNewPickupPushToDelivery] online delivery people have no push tokens for order ${event.params.orderId}`,
      );
      return;
    }

    const itemCount = Array.isArray(after.items) ? after.items.length : 0;
    const totalRupees = Math.round(Number(after.total ?? 0));
    const messages = tokens.map(token => ({
      to: token,
      sound: 'default' as const,
      title: '🚚 New pickup available',
      body: `${after.shopName ?? 'A shop'} · ${itemCount} item${itemCount === 1 ? '' : 's'} · ₹${totalRupees}`,
      data: {
        orderId: after.id ?? event.params.orderId,
        type: 'new_pickup_for_delivery',
      },
    }));

    try {
      const res = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(messages),
      });
      const data = await res.json();
      console.log(
        `[sendNewPickupPushToDelivery] sent ${tokens.length} push(es) for order ${event.params.orderId}:`,
        JSON.stringify(data),
      );
    } catch (e) {
      console.error('[sendNewPickupPushToDelivery] error:', e);
    }
  },
);

// ────────────────────────────────────────────────────────────
// Shop registration + admin approval (Phase 12a-v2-i)
// ────────────────────────────────────────────────────────────
//
// Lifecycle: registerShop → status=pending → admin approveShop →
// status=active + shopOwner claim set. Or admin rejectShop →
// status=rejected (owner can resubmit).
//
// The set-admin / set-shop-owner / set-delivery scripts mirror their
// claim onto users/{uid} (e.g. users/{uid}.isAdmin = true) so the
// "push to all admins" / "find online delivery people" queries work
// against Firestore — claims aren't queryable.

type ShopRegistrationInput = {
  name?: string;
  address?: string;
  location?: { lat: number; lng: number };
  phone?: string;
  hours?: { open: string; close: string };
  gstNumber?: string;
  fssaiLicense?: string;
};

async function pushToAdmins(
  title: string,
  body: string,
  data: Record<string, string>,
): Promise<void> {
  // Find admin users by the mirrored isAdmin flag in their user doc.
  // The claim itself is the source of truth for authorization; this
  // mirror only exists to make admins findable for fan-out pushes.
  const snap = await db
    .collection('users')
    .where('isAdmin', '==', true)
    .get();
  if (snap.empty) {
    console.warn(
      `[pushToAdmins] no admins with isAdmin mirror — re-run set-admin to backfill`,
    );
    return;
  }
  const tokens: string[] = [];
  snap.forEach(u => {
    const t: string[] = u.data()?.fcmTokens ?? [];
    tokens.push(...t);
  });
  if (!tokens.length) {
    console.log('[pushToAdmins] no admin push tokens');
    return;
  }
  const messages = tokens.map(token => ({
    to: token,
    sound: 'default' as const,
    title,
    body,
    data,
  }));
  try {
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messages),
    });
    const responseData = await res.json();
    console.log(
      `[pushToAdmins] sent ${tokens.length} push(es):`,
      JSON.stringify(responseData),
    );
  } catch (e) {
    console.error('[pushToAdmins] error:', e);
  }
}

async function pushToOwner(
  ownerUid: string,
  title: string,
  body: string,
  data: Record<string, string>,
): Promise<void> {
  const snap = await db.doc(`users/${ownerUid}`).get();
  if (!snap.exists) return;
  const tokens: string[] = snap.data()?.fcmTokens ?? [];
  if (!tokens.length) return;
  const messages = tokens.map(token => ({
    to: token,
    sound: 'default' as const,
    title,
    body,
    data,
  }));
  try {
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messages),
    });
    const responseData = await res.json();
    console.log(
      `[pushToOwner] sent ${tokens.length} push(es) to ${ownerUid}:`,
      JSON.stringify(responseData),
    );
  } catch (e) {
    console.error('[pushToOwner] error:', e);
  }
}

export const registerShop = onCall<ShopRegistrationInput>(
  { cors: true, enforceAppCheck: false },
  async request => {
    const auth = request.auth;
    if (!auth) throw new HttpsError('unauthenticated', 'Sign in required');

    // One-shop-per-user enforcement. Existing pending OR active shops
    // owned by this user block a new registration. Rejected/suspended
    // shops do NOT block — owner can resubmit.
    const existingSnap = await db
      .collection('shops')
      .where('ownerUid', '==', auth.uid)
      .where('status', 'in', ['pending', 'active'])
      .limit(1)
      .get();
    if (!existingSnap.empty) {
      throw new HttpsError(
        'failed-precondition',
        'You already have a shop registered. Multi-shop ownership is not yet supported.',
      );
    }

    const {
      name,
      address,
      location,
      phone,
      hours,
      gstNumber,
      fssaiLicense,
    } = request.data ?? {};
    if (!name?.trim() || !address?.trim() || !phone?.trim()) {
      throw new HttpsError(
        'invalid-argument',
        'Name, address, and phone are required',
      );
    }

    const shopId = `shop_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const now = Date.now();

    const shopDoc = {
      id: shopId,
      name: name.trim(),
      description: '',
      address: address.trim(),
      // App passes user's GPS when available; 0,0 is the explicit
      // "unknown" sentinel until v2-iii makes location mandatory.
      location: location ?? { lat: 0, lng: 0 },
      categories: [], // populated in v2-ii via menu bootstrap
      deliveryFee: 25,
      minOrder: 99,
      etaMinutes: 30,
      rating: 0,
      isOpen: true,
      imageUrl: '',
      ownerUid: auth.uid,
      status: 'pending',
      registrationData: {
        phone: phone.trim(),
        hours: hours ?? { open: '09:00', close: '21:00' },
        gstNumber: gstNumber?.trim() || null,
        fssaiLicense: fssaiLicense?.trim() || null,
        submittedAt: now,
      },
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    await db.doc(`shops/${shopId}`).set(shopDoc);

    // Admin notification — best-effort, don't fail the registration if
    // push delivery hiccups.
    pushToAdmins(
      '🛍️ New shop registration',
      `${shopDoc.name} requires approval`,
      { shopId, type: 'shop_pending_approval' },
    ).catch(e => console.warn('[registerShop] pushToAdmins failed:', e));

    return { ok: true, shopId };
  },
);

export const approveShop = onCall<{ shopId: string }>(
  { cors: true, enforceAppCheck: false },
  async request => {
    const auth = request.auth;
    if (!auth) throw new HttpsError('unauthenticated', 'Sign in required');
    if (auth.token?.admin !== true) {
      throw new HttpsError('permission-denied', 'Admin role required');
    }

    const shopId = request.data?.shopId;
    if (!shopId) throw new HttpsError('invalid-argument', 'shopId required');

    const shopRef = db.doc(`shops/${shopId}`);
    const shopSnap = await shopRef.get();
    if (!shopSnap.exists) {
      throw new HttpsError('not-found', 'Shop not found');
    }
    const shop = shopSnap.data() as {
      status: string;
      ownerUid: string;
      name: string;
    };
    if (shop.status !== 'pending') {
      throw new HttpsError(
        'failed-precondition',
        `Shop is ${shop.status}, not pending`,
      );
    }

    const now = Date.now();
    await shopRef.update({
      status: 'active',
      approvedAt: now,
      approvedBy: auth.uid,
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Grant the shop-owner claim. Mirror onto users/{uid} so future
    // queries / push fan-out can find shop owners without scanning
    // Auth — same pattern as set-admin / set-delivery.
    await mergeCustomClaims(shop.ownerUid, {
      shopOwner: true,
      shopId,
    });
    await db.doc(`users/${shop.ownerUid}`).set(
      { isShopOwner: true, shopId },
      { merge: true },
    );

    // Phase 12a-v2-ii: seed the shop's menu with all global products
    // at default prices. Done synchronously so a shop owner who
    // navigates to ShopMenuScreen immediately after approval sees
    // their menu populated rather than an empty state. With the
    // current ~33-product catalog one batch.commit() is well under
    // the 500-write limit; if the catalog ever grows past ~450 we'll
    // need to chunk this.
    try {
      await bootstrapShopMenu(shopId);
    } catch (e) {
      console.error('[approveShop] bootstrapShopMenu failed:', e);
      // Don't fail the approval — admin can run the backfill script.
    }

    pushToOwner(
      shop.ownerUid,
      '✅ Your shop is approved!',
      `${shop.name} is now live. Set up your menu to start receiving orders.`,
      { shopId, type: 'shop_approved' },
    ).catch(e => console.warn('[approveShop] pushToOwner failed:', e));

    return { ok: true };
  },
);

export const rejectShop = onCall<{ shopId: string; reason: string }>(
  { cors: true, enforceAppCheck: false },
  async request => {
    const auth = request.auth;
    if (!auth) throw new HttpsError('unauthenticated', 'Sign in required');
    if (auth.token?.admin !== true) {
      throw new HttpsError('permission-denied', 'Admin role required');
    }

    const shopId = request.data?.shopId;
    const reason = request.data?.reason?.trim();
    if (!shopId) throw new HttpsError('invalid-argument', 'shopId required');
    if (!reason) {
      throw new HttpsError('invalid-argument', 'reason required');
    }

    const shopRef = db.doc(`shops/${shopId}`);
    const shopSnap = await shopRef.get();
    if (!shopSnap.exists) {
      throw new HttpsError('not-found', 'Shop not found');
    }
    const shop = shopSnap.data() as {
      status: string;
      ownerUid: string;
      name: string;
    };
    if (shop.status !== 'pending') {
      throw new HttpsError(
        'failed-precondition',
        `Shop is ${shop.status}, not pending`,
      );
    }

    const now = Date.now();
    await shopRef.update({
      status: 'rejected',
      rejectedAt: now,
      rejectedReason: reason,
      // Track the admin uid via approvedBy slot — there's no separate
      // rejectedBy field on the type, but we can repurpose updatedBy
      // semantics. Keeping it simple: don't store; reason is the
      // primary audit trail.
      updatedAt: FieldValue.serverTimestamp(),
    });

    pushToOwner(
      shop.ownerUid,
      '❌ Shop registration rejected',
      `${shop.name}: ${reason}`,
      { shopId, type: 'shop_rejected' },
    ).catch(e => console.warn('[rejectShop] pushToOwner failed:', e));

    return { ok: true };
  },
);

export const listPendingShops = onCall(
  { cors: true, enforceAppCheck: false },
  async request => {
    const auth = request.auth;
    if (!auth) throw new HttpsError('unauthenticated', 'Sign in required');
    if (auth.token?.admin !== true) {
      throw new HttpsError('permission-denied', 'Admin role required');
    }
    const snap = await db
      .collection('shops')
      .where('status', '==', 'pending')
      .orderBy('registrationData.submittedAt', 'asc')
      .limit(50)
      .get();
    return snap.docs.map(d => {
      const data = d.data() as Record<string, any>;
      // Convert Firestore Timestamps to epoch ms for client
      // consistency. Mirrors normalizeOrder's pattern.
      return {
        ...data,
        createdAt: data.createdAt?.toMillis?.() ?? data.createdAt ?? null,
        updatedAt: data.updatedAt?.toMillis?.() ?? data.updatedAt ?? null,
      };
    });
  },
);

// Returns the caller's most-recent owned shop (any non-suspended
// status). The WaitingForApproval screen uses this to detect when
// admin flips status from pending to active/rejected without needing
// direct Firestore read access.
export const getMyShop = onCall(
  { cors: true, enforceAppCheck: false },
  async request => {
    const auth = request.auth;
    if (!auth) throw new HttpsError('unauthenticated', 'Sign in required');
    const snap = await db
      .collection('shops')
      .where('ownerUid', '==', auth.uid)
      .where('status', 'in', ['pending', 'active', 'rejected'])
      .orderBy('updatedAt', 'desc')
      .limit(1)
      .get();
    if (snap.empty) return null;
    const data = snap.docs[0].data() as Record<string, any>;
    return {
      ...data,
      createdAt: data.createdAt?.toMillis?.() ?? data.createdAt ?? null,
      updatedAt: data.updatedAt?.toMillis?.() ?? data.updatedAt ?? null,
    };
  },
);

// ────────────────────────────────────────────────────────────
// Admin governance (Phase 12a-v2-i-bis)
// ────────────────────────────────────────────────────────────
//
// These callables let an admin revoke shopOwner / delivery roles and
// suspend / unsuspend shops. Every governance op must:
//   1. Refuse if caller isn't admin.
//   2. Refuse if `uid === auth.uid` (no self-revocation — see policy
//      block at top of file).
//   3. Mirror claim changes onto users/{uid} so push fan-out queries
//      keep working.
//   4. Notify the affected user via push (best-effort).
//
// Audit trail is currently console.log only; promoting that to a
// Firestore `auditLog` collection is tracked in PRELAUNCH_CHECKLIST.

// Helper: send a push to one user by uid. Mirrors pushToOwner above
// but the name reflects that the recipient may not be a shop owner
// (e.g. revokeDelivery sends to a delivery person, reassign-pings
// send to customers). The implementation is identical — both look up
// users/{uid}.fcmTokens.
async function pushToUser(
  uid: string,
  title: string,
  body: string,
  data: Record<string, string>,
): Promise<void> {
  const snap = await db.doc(`users/${uid}`).get();
  if (!snap.exists) return;
  const tokens: string[] = snap.data()?.fcmTokens ?? [];
  if (!tokens.length) return;
  const messages = tokens.map(token => ({
    to: token,
    sound: 'default' as const,
    title,
    body,
    data,
  }));
  try {
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messages),
    });
    const responseData = await res.json();
    console.log(
      `[pushToUser] sent ${tokens.length} push(es) to ${uid}:`,
      JSON.stringify(responseData),
    );
  } catch (e) {
    console.error('[pushToUser] error:', e);
  }
}

export const revokeShopOwner = onCall<{ uid: string; reason?: string }>(
  { cors: true, enforceAppCheck: false },
  async request => {
    const auth = request.auth;
    if (!auth) throw new HttpsError('unauthenticated', 'Sign in required');
    if (auth.token?.admin !== true) {
      throw new HttpsError('permission-denied', 'Admin role required');
    }

    const { uid, reason } = request.data;
    if (!uid) throw new HttpsError('invalid-argument', 'uid required');
    // Single-admin lockout protection (see policy block).
    if (uid === auth.uid) {
      throw new HttpsError(
        'failed-precondition',
        'Cannot revoke yourself',
      );
    }

    const userRecord = await getAuth().getUser(uid);
    const claims = (userRecord.customClaims ?? {}) as Record<string, unknown>;
    if (claims.shopOwner !== true) {
      throw new HttpsError(
        'failed-precondition',
        'User is not a shop owner',
      );
    }
    const shopId = claims.shopId as string | undefined;

    // Strip shopOwner + shopId, keep all other claims (including
    // delivery and admin if present). Object destructuring avoids the
    // Admin SDK's whole-claims-object overwrite trap.
    const {
      shopOwner: _so,
      shopId: _sid,
      ...remaining
    } = claims;
    void _so;
    void _sid;
    await getAuth().setCustomUserClaims(uid, remaining);

    await db.doc(`users/${uid}`).set(
      {
        isShopOwner: false,
        shopId: null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    // Suspend (don't delete) the owned shop. Historical orders stay
    // attached via shopId so refund / dispute resolution still works.
    if (shopId) {
      await db.doc(`shops/${shopId}`).update({
        status: 'suspended',
        ownerUid: null,
        suspendedAt: Date.now(),
        suspendedBy: auth.uid,
        suspendedReason: reason ?? 'Owner revoked by admin',
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    console.log(
      `[revokeShopOwner] admin=${auth.uid} target=${uid} shopId=${shopId ?? 'none'} reason=${reason ?? '(none)'}`,
    );

    pushToUser(
      uid,
      'Shop owner role revoked',
      reason ?? 'Contact support for details.',
      { type: 'role_revoked', role: 'shopOwner' },
    ).catch(e => console.warn('[revokeShopOwner] pushToUser failed:', e));

    return { ok: true };
  },
);

export const revokeDelivery = onCall<{ uid: string; reason?: string }>(
  { cors: true, enforceAppCheck: false },
  async request => {
    const auth = request.auth;
    if (!auth) throw new HttpsError('unauthenticated', 'Sign in required');
    if (auth.token?.admin !== true) {
      throw new HttpsError('permission-denied', 'Admin role required');
    }

    const { uid, reason } = request.data;
    if (!uid) throw new HttpsError('invalid-argument', 'uid required');
    if (uid === auth.uid) {
      throw new HttpsError(
        'failed-precondition',
        'Cannot revoke yourself',
      );
    }

    const userRecord = await getAuth().getUser(uid);
    const claims = (userRecord.customClaims ?? {}) as Record<string, unknown>;
    if (claims.delivery !== true) {
      throw new HttpsError(
        'failed-precondition',
        'User is not a delivery partner',
      );
    }

    const { delivery: _d, ...remaining } = claims;
    void _d;
    await getAuth().setCustomUserClaims(uid, remaining);

    await db.doc(`users/${uid}`).set(
      {
        isDelivery: false,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    // Reassign in-flight deliveries by clearing deliveryPersonId.
    // Other delivery partners can then claim via claimDelivery. We
    // DON'T cancel the orders — too disruptive for the customer who
    // already paid. The status stays out_for_delivery; the
    // listAvailableDeliveries query treats deliveryPersonId==null as
    // "available" so this re-enters the pickup pool.
    const inflightSnap = await db
      .collection('orders')
      .where('deliveryPersonId', '==', uid)
      .where('status', '==', 'out_for_delivery')
      .get();
    const reassignedOrderIds: string[] = [];
    if (!inflightSnap.empty) {
      const batch = db.batch();
      inflightSnap.forEach(doc => {
        batch.update(doc.ref, {
          deliveryPersonId: null,
          updatedAt: FieldValue.serverTimestamp(),
        });
        reassignedOrderIds.push(doc.id);
      });
      await batch.commit();

      // Notify each affected customer. Fire-and-forget — the
      // reassignment is the critical part; pushes are best-effort.
      inflightSnap.docs.forEach(doc => {
        const data = doc.data() as { userId?: string };
        if (data.userId) {
          pushToUser(
            data.userId,
            'Delivery being reassigned',
            'A new delivery partner will pick up your order shortly.',
            { type: 'delivery_reassigned', orderId: doc.id },
          ).catch(e =>
            console.warn('[revokeDelivery] customer push failed:', e),
          );
        }
      });
    }

    console.log(
      `[revokeDelivery] admin=${auth.uid} target=${uid} reassignedOrders=${reassignedOrderIds.length} reason=${reason ?? '(none)'}`,
    );

    pushToUser(
      uid,
      'Delivery partner role revoked',
      reason ?? 'Contact support for details.',
      { type: 'role_revoked', role: 'delivery' },
    ).catch(e => console.warn('[revokeDelivery] pushToUser failed:', e));

    return { ok: true, reassignedOrders: reassignedOrderIds.length };
  },
);

export const suspendShop = onCall<{ shopId: string; reason: string }>(
  { cors: true, enforceAppCheck: false },
  async request => {
    const auth = request.auth;
    if (!auth) throw new HttpsError('unauthenticated', 'Sign in required');
    if (auth.token?.admin !== true) {
      throw new HttpsError('permission-denied', 'Admin role required');
    }

    const shopId = request.data?.shopId;
    const reason = request.data?.reason?.trim();
    if (!shopId) throw new HttpsError('invalid-argument', 'shopId required');
    if (!reason) {
      throw new HttpsError('invalid-argument', 'reason required');
    }

    const shopRef = db.doc(`shops/${shopId}`);
    const shopSnap = await shopRef.get();
    if (!shopSnap.exists) {
      throw new HttpsError('not-found', 'Shop not found');
    }
    const shop = shopSnap.data() as {
      status: string;
      ownerUid?: string | null;
      name: string;
    };
    if (shop.status === 'suspended') {
      throw new HttpsError('failed-precondition', 'Shop is already suspended');
    }
    if (shop.status !== 'active') {
      // Pending shops should be rejected (rejectShop), not suspended.
      // Rejected shops have no live presence to suspend.
      throw new HttpsError(
        'failed-precondition',
        `Cannot suspend a ${shop.status} shop`,
      );
    }

    await shopRef.update({
      status: 'suspended',
      suspendedAt: Date.now(),
      suspendedBy: auth.uid,
      suspendedReason: reason,
      updatedAt: FieldValue.serverTimestamp(),
    });

    console.log(
      `[suspendShop] admin=${auth.uid} shopId=${shopId} reason=${reason}`,
    );

    // In-flight orders intentionally NOT cancelled — too disruptive.
    // Customer-facing block on new orders happens via the listing
    // filter on the customer side (status==active). Defining a
    // mid-fulfillment cancellation policy is tracked in
    // PRELAUNCH_CHECKLIST.
    if (shop.ownerUid) {
      pushToUser(
        shop.ownerUid,
        '⚠️ Your shop has been suspended',
        `${shop.name}: ${reason}`,
        { type: 'shop_suspended', shopId },
      ).catch(e => console.warn('[suspendShop] pushToUser failed:', e));
    }

    return { ok: true };
  },
);

export const unsuspendShop = onCall<{ shopId: string }>(
  { cors: true, enforceAppCheck: false },
  async request => {
    const auth = request.auth;
    if (!auth) throw new HttpsError('unauthenticated', 'Sign in required');
    if (auth.token?.admin !== true) {
      throw new HttpsError('permission-denied', 'Admin role required');
    }

    const shopId = request.data?.shopId;
    if (!shopId) throw new HttpsError('invalid-argument', 'shopId required');

    const shopRef = db.doc(`shops/${shopId}`);
    const shopSnap = await shopRef.get();
    if (!shopSnap.exists) {
      throw new HttpsError('not-found', 'Shop not found');
    }
    const shop = shopSnap.data() as {
      status: string;
      ownerUid?: string | null;
      name: string;
    };
    if (shop.status !== 'suspended') {
      throw new HttpsError(
        'failed-precondition',
        `Shop is ${shop.status}, not suspended`,
      );
    }

    // Clear suspension fields by setting them to null. We don't
    // FieldValue.delete() — keeping the historical timestamps in
    // the document is fine and may help future audit queries; we
    // just want them ignored. The subsequent unsuspendShop call
    // will overwrite or null them again.
    await shopRef.update({
      status: 'active',
      suspendedAt: null,
      suspendedBy: null,
      suspendedReason: null,
      updatedAt: FieldValue.serverTimestamp(),
    });

    console.log(
      `[unsuspendShop] admin=${auth.uid} shopId=${shopId}`,
    );

    if (shop.ownerUid) {
      pushToUser(
        shop.ownerUid,
        '✅ Your shop is active again',
        `${shop.name} is back online and accepting orders.`,
        { type: 'shop_unsuspended', shopId },
      ).catch(e => console.warn('[unsuspendShop] pushToUser failed:', e));
    }

    return { ok: true };
  },
);

// MVP: hard-coded 100-user cap; pagination tracked in checklist.
export const listAllUsers = onCall(
  { cors: true, enforceAppCheck: false },
  async request => {
    const auth = request.auth;
    if (!auth) throw new HttpsError('unauthenticated', 'Sign in required');
    if (auth.token?.admin !== true) {
      throw new HttpsError('permission-denied', 'Admin role required');
    }

    const result = await getAuth().listUsers(100);
    return result.users.map(u => {
      const claims = (u.customClaims ?? {}) as Record<string, unknown>;
      return {
        uid: u.uid,
        phoneNumber: u.phoneNumber ?? null,
        // Anonymous users have no providerData entries — easy way to
        // tell them apart from phone-verified accounts.
        isAnonymous: u.providerData.length === 0,
        isAdmin: claims.admin === true,
        isShopOwner: claims.shopOwner === true,
        shopId: (claims.shopId as string | undefined) ?? null,
        isDelivery: claims.delivery === true,
        createdAt: u.metadata.creationTime
          ? new Date(u.metadata.creationTime).getTime()
          : null,
        lastSignInAt: u.metadata.lastSignInTime
          ? new Date(u.metadata.lastSignInTime).getTime()
          : null,
      };
    });
  },
);

export const listAllShops = onCall(
  { cors: true, enforceAppCheck: false },
  async request => {
    const auth = request.auth;
    if (!auth) throw new HttpsError('unauthenticated', 'Sign in required');
    if (auth.token?.admin !== true) {
      throw new HttpsError('permission-denied', 'Admin role required');
    }
    // No status filter — admin sees everything. We can't add an
    // orderBy without forcing an index, so sort client-side. 100
    // shops is well within MVP scale.
    const snap = await db.collection('shops').limit(100).get();
    return snap.docs.map(d => {
      const data = d.data() as Record<string, any>;
      return {
        ...data,
        createdAt: data.createdAt?.toMillis?.() ?? data.createdAt ?? null,
        updatedAt: data.updatedAt?.toMillis?.() ?? data.updatedAt ?? null,
      };
    });
  },
);

// ────────────────────────────────────────────────────────────
// Per-shop menu management (Phase 12a-v2-ii)
// ────────────────────────────────────────────────────────────
//
// Schema: shops/{shopId}/menu/{menuItemId}
// Two flavors of items: GLOBAL (productId set, isCustom: false) and
// CUSTOM (productId null, isCustom: true). See src/types/index.ts
// for the full MenuItem type contract.
//
// All writes funnel through callables here so we can enforce the
// "GLOBAL items: only price/available/stock editable" invariant in
// one place. firestore.rules denies direct client writes.

const VALID_CATEGORIES = new Set<string>([
  'atta_rice_dal',
  'oil_ghee',
  'dairy_eggs',
  'bakery',
  'masala_spices',
  'snacks_biscuits',
  'beverages',
  'personal_care',
  'household',
  'fruits_vegetables',
]);

// Internal helper — NOT exported as a callable. Used by approveShop
// and by scripts/backfill-shop-menus.ts (which re-implements the
// same logic against the Admin SDK directly to avoid the
// Functions-region cold start).
async function bootstrapShopMenu(shopId: string): Promise<number> {
  const productsSnap = await db.collection('products').get();
  if (productsSnap.empty) {
    console.warn(
      `[bootstrapShopMenu] no products to seed for ${shopId}`,
    );
    return 0;
  }
  const batch = db.batch();
  const now = Date.now();
  productsSnap.docs.forEach(productDoc => {
    const product = productDoc.data() as {
      id: string;
      name: string;
      imageUrl: string;
      packSize: { value: number; unit: string };
      category: string;
      price: number;
      mrp: number;
    };
    const menuItemRef = db.doc(`shops/${shopId}/menu/${product.id}`);
    batch.set(menuItemRef, {
      id: product.id,
      shopId,
      productId: product.id,
      name: product.name,
      imageUrl: product.imageUrl,
      packLabel: `${product.packSize.value} ${product.packSize.unit}`,
      category: product.category,
      price: product.price,
      mrp: product.mrp,
      available: true,
      stock: null,
      isCustom: false,
      createdAt: now,
      updatedAt: now,
    });
  });
  await batch.commit();
  console.log(
    `[bootstrapShopMenu] seeded ${productsSnap.size} items for ${shopId}`,
  );
  return productsSnap.size;
}

// Lists every menu item for the caller's owned shop, sorted by
// category then name. Cap at the legacy ~500-doc list size — if a
// shop ever has more we'll need to paginate, but the global catalog
// is ~33 items so this is comfortable headroom.
export const listMyShopMenu = onCall(
  { cors: true, enforceAppCheck: false },
  async request => {
    const auth = request.auth;
    if (!auth) throw new HttpsError('unauthenticated', 'Sign in required');
    if (auth.token?.shopOwner !== true) {
      throw new HttpsError('permission-denied', 'Shop owner role required');
    }
    const shopId = auth.token.shopId as string | undefined;
    if (!shopId) {
      throw new HttpsError(
        'failed-precondition',
        'Your account has no shopId — contact support',
      );
    }
    const snap = await db.collection(`shops/${shopId}/menu`).get();
    const items = snap.docs.map(d => d.data() as Record<string, any>);
    // Sort client-of-Function-side to avoid a composite index just
    // for this list. The catalog is small.
    items.sort((a, b) => {
      const catCmp = String(a.category).localeCompare(String(b.category));
      if (catCmp !== 0) return catCmp;
      return String(a.name).localeCompare(String(b.name));
    });
    return items;
  },
);

// Updates an existing menu item. For GLOBAL items only price /
// available / stock are editable; attempting any other field returns
// invalid-argument. CUSTOM items have the full edit surface.
export const updateMenuItem = onCall<{
  menuItemId: string;
  fields: Record<string, unknown>;
}>(
  { cors: true, enforceAppCheck: false },
  async request => {
    const auth = request.auth;
    if (!auth) throw new HttpsError('unauthenticated', 'Sign in required');
    if (auth.token?.shopOwner !== true) {
      throw new HttpsError('permission-denied', 'Shop owner role required');
    }
    const shopId = auth.token.shopId as string | undefined;
    if (!shopId) {
      throw new HttpsError('failed-precondition', 'No shopId on your account');
    }

    const { menuItemId, fields } = request.data ?? {};
    if (!menuItemId) {
      throw new HttpsError('invalid-argument', 'menuItemId required');
    }
    if (!fields || typeof fields !== 'object') {
      throw new HttpsError('invalid-argument', 'fields object required');
    }

    const ref = db.doc(`shops/${shopId}/menu/${menuItemId}`);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new HttpsError('not-found', 'Menu item not found');
    }
    const existing = snap.data() as { isCustom?: boolean; mrp?: number };

    // Whitelist fields per item type. Anything outside the allowed
    // set is rejected so a misbehaving client can't sneak through
    // e.g. productId or isCustom.
    const ALLOWED_GLOBAL = new Set(['price', 'available', 'stock']);
    const ALLOWED_CUSTOM = new Set([
      'price',
      'available',
      'stock',
      'name',
      'imageUrl',
      'packLabel',
      'category',
      'mrp',
    ]);
    const allowed = existing.isCustom ? ALLOWED_CUSTOM : ALLOWED_GLOBAL;

    const update: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) {
      if (!allowed.has(k)) {
        throw new HttpsError(
          'invalid-argument',
          `Field "${k}" is not editable on a ${existing.isCustom ? 'custom' : 'global'} menu item`,
        );
      }
      // Per-field validation. Numbers must be non-negative; price/mrp
      // also have to satisfy mrp >= price when both are touched.
      if (k === 'price' || k === 'mrp') {
        if (typeof v !== 'number' || v < 0 || !Number.isFinite(v)) {
          throw new HttpsError('invalid-argument', `${k} must be a non-negative number`);
        }
      } else if (k === 'stock') {
        if (v !== null && (typeof v !== 'number' || v < 0 || !Number.isFinite(v))) {
          throw new HttpsError('invalid-argument', 'stock must be a non-negative number or null');
        }
      } else if (k === 'available') {
        if (typeof v !== 'boolean') {
          throw new HttpsError('invalid-argument', 'available must be a boolean');
        }
      } else if (k === 'category') {
        if (typeof v !== 'string' || !VALID_CATEGORIES.has(v)) {
          throw new HttpsError('invalid-argument', 'category is not a known CategoryId');
        }
      } else if (k === 'name' || k === 'imageUrl' || k === 'packLabel') {
        if (typeof v !== 'string' || (k === 'name' && !v.trim())) {
          throw new HttpsError('invalid-argument', `${k} must be a non-empty string`);
        }
      }
      update[k] = v;
    }

    // Cross-field check: if either price or mrp is being updated, the
    // resulting pair must satisfy mrp >= price.
    const nextPrice =
      'price' in update ? (update.price as number) : (snap.data()?.price as number);
    const nextMrp =
      'mrp' in update ? (update.mrp as number) : (existing.mrp as number) ?? 0;
    if (nextMrp < nextPrice) {
      throw new HttpsError(
        'invalid-argument',
        `mrp (${nextMrp}) must be >= price (${nextPrice})`,
      );
    }

    update.updatedAt = Date.now();
    await ref.update(update);
    return { ok: true };
  },
);

// Creates a new CUSTOM menu item. ID format `custom_<timestamp>_<rand>`
// makes it visually distinct from GLOBAL ids (which mirror productId)
// and gives us a stable sort by creation time without an extra field.
export const addCustomMenuItem = onCall<{
  name: string;
  price: number;
  mrp: number;
  packLabel: string;
  category: string;
  imageUrl?: string;
  stock?: number | null;
}>(
  { cors: true, enforceAppCheck: false },
  async request => {
    const auth = request.auth;
    if (!auth) throw new HttpsError('unauthenticated', 'Sign in required');
    if (auth.token?.shopOwner !== true) {
      throw new HttpsError('permission-denied', 'Shop owner role required');
    }
    const shopId = auth.token.shopId as string | undefined;
    if (!shopId) {
      throw new HttpsError('failed-precondition', 'No shopId on your account');
    }

    const { name, price, mrp, packLabel, category, imageUrl, stock } =
      request.data ?? ({} as any);
    const trimmedName = typeof name === 'string' ? name.trim() : '';
    if (!trimmedName) {
      throw new HttpsError('invalid-argument', 'name required');
    }
    if (typeof price !== 'number' || price <= 0 || !Number.isFinite(price)) {
      throw new HttpsError('invalid-argument', 'price must be a positive number');
    }
    if (typeof mrp !== 'number' || mrp < price || !Number.isFinite(mrp)) {
      throw new HttpsError('invalid-argument', 'mrp must be a number >= price');
    }
    if (typeof packLabel !== 'string' || !packLabel.trim()) {
      throw new HttpsError('invalid-argument', 'packLabel required');
    }
    if (typeof category !== 'string' || !VALID_CATEGORIES.has(category)) {
      throw new HttpsError('invalid-argument', 'category is not a known CategoryId');
    }
    if (
      stock !== undefined &&
      stock !== null &&
      (typeof stock !== 'number' || stock < 0 || !Number.isFinite(stock))
    ) {
      throw new HttpsError(
        'invalid-argument',
        'stock must be a non-negative number or null',
      );
    }

    const now = Date.now();
    const rand = Math.random().toString(36).slice(2, 8);
    const menuItemId = `custom_${now}_${rand}`;
    // 1×1 transparent placeholder if no image — keeps card layout
    // stable, customer-side will fall back to a category icon later.
    const fallbackImage =
      'https://placehold.co/400x400/e2e8f0/64748b?text=Custom+Item';

    await db.doc(`shops/${shopId}/menu/${menuItemId}`).set({
      id: menuItemId,
      shopId,
      productId: null,
      name: trimmedName,
      imageUrl:
        typeof imageUrl === 'string' && imageUrl.trim()
          ? imageUrl.trim()
          : fallbackImage,
      packLabel: packLabel.trim(),
      category,
      price,
      mrp,
      available: true,
      stock: stock ?? null,
      isCustom: true,
      createdAt: now,
      updatedAt: now,
    });

    return { ok: true, menuItemId };
  },
);

// Removes a menu item. Semantics differ by item type:
//   - CUSTOM: hard delete (no upstream reference, safe to drop).
//   - GLOBAL: soft-disable via available=false; we keep the row so
//             the owner's price/stock customizations aren't lost the
//             next time they re-enable it.
export const removeMenuItem = onCall<{ menuItemId: string }>(
  { cors: true, enforceAppCheck: false },
  async request => {
    const auth = request.auth;
    if (!auth) throw new HttpsError('unauthenticated', 'Sign in required');
    if (auth.token?.shopOwner !== true) {
      throw new HttpsError('permission-denied', 'Shop owner role required');
    }
    const shopId = auth.token.shopId as string | undefined;
    if (!shopId) {
      throw new HttpsError('failed-precondition', 'No shopId on your account');
    }

    const menuItemId = request.data?.menuItemId;
    if (!menuItemId) {
      throw new HttpsError('invalid-argument', 'menuItemId required');
    }

    const ref = db.doc(`shops/${shopId}/menu/${menuItemId}`);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new HttpsError('not-found', 'Menu item not found');
    }
    const data = snap.data() as { isCustom?: boolean };

    if (data.isCustom) {
      await ref.delete();
      return { ok: true, deleted: true };
    }
    await ref.update({ available: false, updatedAt: Date.now() });
    return { ok: true, deleted: false, softDisabled: true };
  },
);

// Phase 12a-v2-iii: public read of a shop's menu for the customer
// flow. No auth required — anonymous Auth users browsing the home
// screen call this to populate ShopDetailScreen. Customers can only
// see active shops; pending / suspended / rejected 404 here so a
// shop URL leaked from an admin tool can't be used to peek at a
// non-active shop's catalogue. The client receives both the shop
// doc and the filtered menu in one round-trip.
export const listShopMenuPublic = onCall<{ shopId: string }>(
  { cors: true, enforceAppCheck: false },
  async request => {
    const shopId = String(request.data?.shopId ?? '').trim();
    if (!shopId) {
      throw new HttpsError('invalid-argument', 'shopId required');
    }
    const shopSnap = await db.doc(`shops/${shopId}`).get();
    if (!shopSnap.exists) {
      throw new HttpsError('not-found', 'Shop not found');
    }
    const shop = shopSnap.data() as { status?: string };
    // Legacy seeded shops (shop_001..shop_008) predate v2-i and may
    // have no `status` field. Treat undefined as active so the
    // pre-existing demo flow keeps working; explicit non-active
    // statuses (pending / suspended / rejected) 404.
    const isLive = shop.status === undefined || shop.status === 'active';
    if (!isLive) {
      throw new HttpsError('not-found', 'Shop not found');
    }

    // Filter `available == true` server-side so the client can render
    // straight from the response. Stock filtering is done in-memory
    // because Firestore can't combine `available == true` with
    // `(stock == null OR stock > 0)` in a single query.
    const menuSnap = await db
      .collection(`shops/${shopId}/menu`)
      .where('available', '==', true)
      .get();
    const items = menuSnap.docs
      .map(d => ({ id: d.id, ...d.data() }) as Record<string, any>)
      .filter(i => i.stock === null || (typeof i.stock === 'number' && i.stock > 0));

    return {
      shop: { id: shopSnap.id, ...shop },
      items,
    };
  },
);

// Hotfix (post-v2-iii): the customer-facing shop list previously hit
// Firestore directly through the Firebase Web SDK from native, which
// hangs on RN here (same incompatibility that motivated the
// listMyOrders / getOrder Plan-B in orderService). This callable
// gives native a Plan-B route — read shops server-side, optionally
// compute distance + sort by it, return a plain JSON payload.
//
// Public callable (no auth) to mirror listShopMenuPublic. Filter
// `status == 'active'` matches firestore.rules and the client-side
// filter — defense in depth. Legacy shops without a `status` field
// are excluded; the fix for those is scripts/backfill-shop-menus.ts,
// not loosening this filter.
export type LatLng = { lat: number; lng: number };

export function haversineKm(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Exported as a pure helper so tests can verify the rank/filter logic
// without spinning up firebase-admin or the emulator. The Firestore
// query (status == 'active') already excludes legacy no-status shops
// and pending/suspended/rejected ones; this function just decorates
// the surviving rows with distanceKm and sorts them.
export function rankShopsByDistance<T extends { location?: LatLng }>(
  shops: T[],
  userLocation: LatLng | undefined,
): (T & { distanceKm?: number })[] {
  const out = shops.map(s => ({ ...s }) as T & { distanceKm?: number });
  if (
    !userLocation ||
    typeof userLocation.lat !== 'number' ||
    typeof userLocation.lng !== 'number'
  ) {
    return out;
  }
  for (const s of out) {
    if (s.location?.lat != null && s.location?.lng != null) {
      s.distanceKm = haversineKm(userLocation, s.location);
    }
  }
  out.sort(
    (a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity),
  );
  return out;
}

export const listShopsPublic = onCall<{ userLocation?: LatLng }>(
  { cors: true, enforceAppCheck: false },
  async request => {
    const userLocation = request.data?.userLocation;

    const snap = await db
      .collection('shops')
      .where('status', '==', 'active')
      .get();

    const rows = snap.docs.map(
      d => ({ id: d.id, ...d.data() }) as Record<string, any>,
    );
    const shops = rankShopsByDistance(rows, userLocation);
    return { shops };
  },
);
