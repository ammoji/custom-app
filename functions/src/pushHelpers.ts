/**
 * PR 45 — Pure helpers extracted from the push-notification
 * callables / triggers in `index.ts`.
 *
 * Pre-PR-45 the push pipeline had ZERO test coverage — neither
 * client nor server side. Sudhir's directive: "I really want PR
 * for test coverage debt. My preference is to cover such issues
 * using our automated tests wherever possible." This file is the
 * server-side half of that net.
 *
 * The strategy: every meaningful decision (input validation,
 * empty-token short-circuit, message body construction) lives
 * here as a pure function. The actual callables / triggers in
 * `index.ts` just do IO (read Firestore doc → call helper →
 * write Firestore / POST to Expo Push) so the testable logic
 * is mockable without firebase-admin / firebase-functions.
 *
 * Mirrors the helper-extraction pattern from
 * `approveShopHelpers.ts`, `ratingHelpers.ts`,
 * `pendingCountsHelpers.ts`. Tests live in
 * `tests/functions/pushHelpers.test.ts`.
 */

// ────────────────────────────────────────────────────────────
// registerPushToken / unregisterPushToken — input validation.
// ────────────────────────────────────────────────────────────

export type PushTokenAuthLike = { uid: string } | null | undefined;

export type PushTokenValidationResult =
  | { ok: true; uid: string; token: string }
  | {
      ok: false;
      // Mirrors the HttpsError codes the callables throw. Keeping
      // the same vocabulary so tests can pin "throws unauthenticated"
      // without caring whether the throw happens inside the helper
      // or the callable wrapper.
      code: 'unauthenticated' | 'invalid-argument';
      message: string;
    };

/**
 * Validates inputs for both `registerPushToken` and
 * `unregisterPushToken`. Same gate logic (auth required, token
 * required, token must be a non-empty string). Centralizes the
 * rules so a future tightening (e.g. enforce
 * `ExponentPushToken[…]` shape) only needs to land in one place.
 *
 * Why "loose" string validation: the callables intentionally
 * accept any non-empty string so the same endpoint can later
 * accept raw FCM/APN tokens if we drop the Expo Push relay.
 * Strict shape enforcement would force a coordinated client +
 * server deploy when the relay change happens; the loose check
 * keeps that future change a single-side ship.
 */
export function validatePushTokenInput(
  auth: PushTokenAuthLike,
  data: { token?: unknown } | null | undefined,
): PushTokenValidationResult {
  if (!auth || typeof auth.uid !== 'string' || auth.uid.length === 0) {
    return {
      ok: false,
      code: 'unauthenticated',
      message: 'Sign in required',
    };
  }
  const token = data?.token;
  if (typeof token !== 'string' || token.length === 0) {
    return {
      ok: false,
      code: 'invalid-argument',
      message: 'token required',
    };
  }
  return { ok: true, uid: auth.uid, token };
}

// ────────────────────────────────────────────────────────────
// sendOrderStatusPush — message construction.
// ────────────────────────────────────────────────────────────

const ORDER_STATUS_LABELS: Record<string, string> = {
  pending: 'Order received',
  accepted: 'Order accepted',
  preparing: 'Preparing your order',
  ready_for_pickup: 'Out for delivery',
  delivered: 'Order delivered',
  cancelled: 'Order cancelled',
};

export type ExpoPushMessage = {
  to: string;
  sound: 'default';
  title: string;
  body: string;
  data: { orderId: string; type: 'order_status' };
};

export type OrderForPushLike = {
  id?: string;
  status?: string;
  customerUid?: string;
  shopName?: string;
  items?: unknown;
};

export type OrderStatusPushPlan =
  // Customer has fcmTokens and the status actually changed. Caller
  // POSTs `messages` to https://exp.host/--/api/v2/push/send.
  | { kind: 'send'; messages: ExpoPushMessage[] }
  // status === status (no change), missing customerUid, or no
  // fcmTokens. Caller does nothing — already logged at the
  // appropriate severity inside the trigger.
  | { kind: 'skip'; reason: SkipReason };

export type SkipReason =
  | 'no_status_change'
  | 'missing_customer_uid'
  | 'no_tokens';

/**
 * Builds the Expo Push API request body for an
 * order-status-change trigger.
 *
 * Pure — no Firestore, no fetch, no logger. The trigger reads
 * the customer doc + supplies tokens; this helper decides
 * whether to send and what to send.
 *
 * `skip` outcomes are returned (not thrown) because each skip
 * is a legitimate non-error path. The trigger logs differently
 * for each — that's an IO concern, not the helper's.
 */
export function buildOrderStatusPushPlan(opts: {
  before: OrderForPushLike | null | undefined;
  after: OrderForPushLike | null | undefined;
  tokens: string[];
  orderId: string;
}): OrderStatusPushPlan {
  const { before, after, tokens, orderId } = opts;
  // Trigger contract — onDocumentUpdated may fire with one side
  // missing in extreme edge cases (write-during-delete race). Be
  // defensive; treat any missing side as "no change".
  if (!before || !after || before.status === after.status) {
    return { kind: 'skip', reason: 'no_status_change' };
  }
  if (
    typeof after.customerUid !== 'string' ||
    after.customerUid.length === 0
  ) {
    return { kind: 'skip', reason: 'missing_customer_uid' };
  }
  if (!tokens || tokens.length === 0) {
    return { kind: 'skip', reason: 'no_tokens' };
  }

  const status = after.status ?? '';
  const title = ORDER_STATUS_LABELS[status] ?? String(status);
  const itemCount = Array.isArray(after.items) ? after.items.length : 0;
  const body = `${after.shopName ?? 'Your shop'} — ${itemCount} item${
    itemCount === 1 ? '' : 's'
  }`;

  const messages: ExpoPushMessage[] = tokens.map(token => ({
    to: token,
    sound: 'default',
    title,
    body,
    data: {
      // Prefer the order's own id field when present (matches the
      // pre-extraction behaviour) and fall back to the trigger's
      // event.params.orderId. Both should agree in practice.
      orderId: typeof after.id === 'string' ? after.id : orderId,
      type: 'order_status',
    },
  }));

  return { kind: 'send', messages };
}
