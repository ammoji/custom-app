import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';
import { setGlobalOptions } from 'firebase-functions/v2';
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as crypto from 'node:crypto';
import Razorpay from 'razorpay';

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
type ClientItem = { productId: string; quantity: number };
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
    enforceAppCheck: true,
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

    const productDocs = await Promise.all(
      clientItems.map(ci => db.doc(`products/${ci.productId}`).get()),
    );

    const serverItems = clientItems.map((ci, idx) => {
      const snap = productDocs[idx];
      if (!snap.exists) {
        throw new HttpsError('not-found', `Product ${ci.productId} not found`);
      }
      const product = snap.data() as {
        id: string;
        name: string;
        imageUrl: string;
        packSize: { value: number; unit: string };
        price: number;
        shopId: string;
        inStock: boolean;
      };
      if (product.shopId !== shopId) {
        throw new HttpsError('invalid-argument', `Product ${ci.productId} not in this shop`);
      }
      if (!product.inStock) {
        throw new HttpsError('failed-precondition', `${product.name} is out of stock`);
      }
      if (!Number.isInteger(ci.quantity) || ci.quantity < 1 || ci.quantity > 99) {
        throw new HttpsError('invalid-argument', `Invalid quantity for ${ci.productId}`);
      }
      return {
        productId: product.id,
        name: product.name,
        imageUrl: product.imageUrl,
        packLabel: `${product.packSize.value} ${product.packSize.unit}`,
        price: product.price,
        quantity: ci.quantity,
      };
    });

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
    if (auth.token?.admin !== true) {
      throw new HttpsError('permission-denied', 'Admin role required');
    }

    const { orderId, newStatus, reason } = request.data;
    if (!orderId || !newStatus) {
      throw new HttpsError('invalid-argument', 'orderId and newStatus required');
    }
    if (!(newStatus in VALID_ORDER_TRANSITIONS)) {
      throw new HttpsError('invalid-argument', `Unknown status: ${newStatus}`);
    }

    const ref = db.doc(`orders/${orderId}`);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', `Order ${orderId} not found`);

    const order = snap.data() as { status: OrderStatus };
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
    await ref.update({
      status: newStatus,
      updatedAt: FieldValue.serverTimestamp(),
      statusHistory: FieldValue.arrayUnion({
        status: newStatus,
        at: now,
        by: `admin:${auth.uid}`,
        ...(reason ? { reason } : {}),
      }),
    });

    return { orderId, status: newStatus, changed: true };
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
