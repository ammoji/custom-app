import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
// PR 6.1 — DO NOT REMOVE. Used by `getMenuImageUploadUrl` callable.
// Auto-formatter stripped this once during PR 6.1 development.
import { getStorage } from 'firebase-admin/storage';
// PR 6.1 — admin SDK Storage handle for signed-URL minting. Used
// exclusively by `getMenuImageUploadUrl` below. Admin SDK signing
// bypasses Storage rules entirely (the documented GCS pattern).
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
// PR 2 — payment hardening helpers. Listed individually because the
// auto-formatter has a habit of stripping seemingly-unused names on
// save; keeping the imports adjacent to the file's actual usage and
// commented makes the strip-and-resave failure mode louder.
import { validateCancelPaidOrder } from './cancelPaidOrderHelpers';
import { validateAllItemsInSameShop } from './cartIntegrityHelpers';
// PR 7 — DO NOT REMOVE. Auto-formatter has stripped this once during
// PR 7 development. Used by `cancelMyRecentPaidOrder` callable below.
// If tsc complains "Cannot find name 'canCustomerCancelPaidOrder'",
// re-add this line.
import { canCustomerCancelPaidOrder } from './customerCancelWindowHelpers';
// PR 12 — DO NOT REMOVE. Used by `updateOrderStatus` callable below.
import { validateOrderStatusTransition } from './orderStatusTransitionHelpers';
// PR 6.1 — DO NOT REMOVE. Used by `getMenuImageUploadUrl` callable.
// Auto-formatter stripped this once during PR 6.1 development.
import { validateGetUploadUrlInput } from './menuImageUploadHelpers';
// PR 31 — DO NOT REMOVE. Used by `getShopKycUploadUrl`,
// `recordShopKycUpload`, and `getShopKycReadUrls` callables below.
// `VALID_DOC_KINDS` is also referenced as a runtime guard inside
// `recordShopKycUpload` to defend against forged docKind payloads
// independent of the helper's own check.
import {
  validateGetKycUploadUrlInput,
  VALID_DOC_KINDS,
  type DocKind,
} from './kycUploadHelpers';
// PR 8 — DO NOT REMOVE (auto-formatter has eaten this once already
// during PR 8 development). Used by writeAuditLog wrapper +
// listRecentAuditEntries + bulkUpdateMenuAvailability callables. If
// tsc complains "Cannot find name 'buildAuditLogEntry' / 'AuditLogInput'
// / 'validateBulkMenuRequest'", re-add THESE TWO LINES below.
import { AuditLogInput, buildAuditLogEntry } from './auditLogHelpers';
import { validateBulkMenuRequest } from './bulkMenuHelpers';
// PR 32 — DO NOT REMOVE. Used by `addCustomMenuItem` (since PR 6),
// `addExtractedMenuItems`, and `extractMenuFromImage` to validate
// the `category` field against the canonical 10-value whitelist.
import {
  VALID_CATEGORIES,
  placeholderImageForCategory,
} from './categoryConstants';
// PR 32 — DO NOT REMOVE. Used by `extractMenuFromImage` callable.
// `ANTHROPIC_API_KEY` must also be passed in the callable's
// `secrets:` option for Firebase to mount the Secret Manager value
// at invocation time. Auto-formatter risk per code-discipline.
import {
  ANTHROPIC_API_KEY,
  estimateCostInr,
  runClaude,
  runClaudeVision,
} from './aiHelpers';
import {
  MENU_EXTRACTION_SYSTEM_PROMPT,
  MENU_EXTRACTION_USER_PROMPT,
  parseExtractionResponse,
} from './menuExtractionHelpers';
// PR 34 — DO NOT REMOVE. Used by `transcribeShopOnboardingAudio`
// callable for the Hindi/English voice → 7 onboarding fields
// pipeline. Auto-formatter risk per code-discipline (PR 32 +
// kycUploadHelpers + bulkMenuHelpers all had imports stripped).
import {
  VOICE_ONBOARDING_SYSTEM_PROMPT,
  parseVoiceOnboardingResponse,
} from './voiceOnboardingHelpers';
// PR 34 — DO NOT REMOVE. Cloud Speech-to-Text client. STT uses
// Application Default Credentials (the function's runtime SA),
// so there's no API key + no `defineSecret` like Anthropic.
// IMPORTANT: enabling speech.googleapis.com in the GCP project
// is a one-time manual step — see docs/pr-34-* deploy plan.
import { SpeechClient } from '@google-cloud/speech';
// PR 8 — DO NOT REMOVE. Used by writeAuditLog wrapper + the
// listRecentAuditEntries + bulkUpdateMenuAvailability callables.
// Auto-formatter has stripped helper imports in PRs 4, 5, 6, 6.1, 7;
// these blocks are the canary against the same bug.
// PR 8 — DO NOT REMOVE. Used by bulkUpdateMenuAvailability callable.
// PR 6.1 — DO NOT REMOVE. Used by the new `getMenuImageUploadUrl`
// callable below to validate shopOwner claim + mint the server-side
// storage path. If tsc complains "Cannot find name
// 'validateGetUploadUrlInput'", re-add this line.
// PR 7 — DO NOT REMOVE. Used by the new `cancelMyRecentPaidOrder`
// callable below for the customer self-service cancel window. If
// tsc complains "Cannot find name 'canCustomerCancelPaidOrder'" /
// "CUSTOMER_CANCEL_WINDOW_MS", re-add this line.
import { reconcileAbandonedOrder } from './cleanupReconciliationHelpers';
import { verifyRazorpaySignature } from './confirmPaymentHelpers';
import {
    canApproveDeliveryRequest,
    canRejectDeliveryRequest,
    requireAdminCaller,
    validateRequestDeliveryRole,
} from './deliveryRequestHelpers';
import { canReadOrder } from './getOrderAuth';
import { computeOnlineDeliveryCount } from './onlineDeliveryCountHelpers';
import {
    applyFavoriteToggle,
    validateToggleFavoriteInput,
} from './favoritesHelpers';
import {
    computeNewRollingAverage,
    validateDualRatingSubmission,
} from './ratingHelpers';
// PR 21 — DO NOT REMOVE. Auto-formatter risk per code-discipline.
// Used by placeOrder below to normalize the substitution preference.
import { normalizeSubstitutionPreference } from './substitutionHelpers';
// PR 22 — used by both placeOrder (per-order override stamping) and
// indirectly by saveAddress (via profileHelpers.validateAddressInput).
import { normalizeDeliveryInstructions } from './deliveryInstructionsHelpers';
// PR 46 — pure helpers for the delivery-distance estimate. The
// kill-switch + fallback decision logic lives in this file so the
// cost-guarantee (zero Google calls during pilot) is unit-pinned
// without touching firebase-admin or the emulator.
import {
    computeDeliveryEstimate,
    type DistanceEstimate,
} from './distanceMatrixHelpers';
// PR 47 — distance-based delivery charge tiers. Pure helpers used
// by placeOrder (server-authoritative charge computation),
// approveShop (default-tier seed), and updateShopDeliveryTiers
// (validation before persistence).
import {
    chargeForDistance,
    DEFAULT_DELIVERY_CHARGE_TIERS,
    validateDeliveryChargeTiers,
    type DeliveryChargeTier,
} from './deliveryChargeHelpers';
// PR 48 — service-radius visibility gate. `listShopsPublic` applies
// the filter; `approveShop` seeds the default. Same dual-purpose
// import pattern as `deliveryChargeHelpers`.
import {
    DEFAULT_SERVICE_RADIUS_KM,
    filterShopsByServiceRadius,
} from './geoVisibilityHelpers';
import {
    promoteDefaultAfterDelete,
    validateAddressInput,
    validateProfilePatch,
    type AddressInput,
} from './profileHelpers';
import { checkRetryPaymentGuard } from './retryPaymentHelpers';
// PR 6 — DO NOT REMOVE. Auto-formatter has stripped this import twice
// already during PR 6 development. Used by addCustomMenuItem +
// updateMenuItem to validate that imageUrl points to our Storage
// bucket (rejects external URLs like picsum.photos).
import { validateMenuImageUrl } from './imageUrlHelpers';
// PR 5 — DO NOT REMOVE. Auto-formatter has stripped both of these PR 5
// imports during development. Used by `placeOrder` (minOrder gate)
// and `updateShopSettings`. If tsc complains about either name,
// re-add the corresponding line here.
import { checkMinOrderGate } from './placeOrderGateHelpers';
import { validateShopSettings } from './shopSettingsHelpers';
// PR 4 — searchMenuPublic helpers. DO NOT REMOVE: auto-formatter has stripped helper imports in
// PRs 1, 2, 4. The names are used in
// the searchMenuPublic callable below; if tsc complains about
// CandidateShop / RawMenuItem / pickCandidateShopIds /
// filterAndJoinSearchResults, re-add this block.
import {
    filterAndJoinSearchResults,
    pickCandidateShopIds,
    type CandidateShop,
    type RawMenuItem,
} from './searchMenuPublicHelpers';
import { validateShopOrdersAccess } from './shopOrdersHelpers';
// PR 41 — DO NOT REMOVE. Used by `getPendingApprovalCounts` callable
// below. Auto-formatter risk per code-discipline; if tsc complains
// "Cannot find name 'projectPendingCounts' / 'countPendingDocs' /
// 'capPendingCount'", re-add this block.
import {
  capPendingCount,
  countPendingDocs,
  projectPendingCounts,
} from './pendingCountsHelpers';
// PR 42 — DO NOT REMOVE. Used by `approveShop` callable below to
// extract the storefront photo's storage path off the pending shop
// doc and to build a Firebase download-token URL (PR 42.0.1 hotfix:
// V4 signed URLs cap at 7 days, so we switched to the canonical
// download-token pattern that never expires).
// Auto-formatter risk; if tsc complains "Cannot find name
// 'pickStorefrontPath' / 'buildFirebaseStorageDownloadUrl'", re-add.
import {
  pickStorefrontPath,
  buildFirebaseStorageDownloadUrl,
} from './approveShopHelpers';
// PR 45 — DO NOT REMOVE. Used by registerPushToken / unregisterPushToken
// callables (input validation) and sendOrderStatusPush trigger
// (message-construction state machine). Auto-formatter risk per
// code-discipline; if tsc complains about validatePushTokenInput or
// buildOrderStatusPushPlan, re-add this block.
import {
  buildOrderStatusPushPlan,
  validatePushTokenInput,
} from './pushHelpers';
import { randomUUID } from 'crypto';
import {
    aggregateShopCustomers,
    viewShopCustomers,
    type ShopOrderRaw,
    type ShopCustomersView,
} from './customerCrmHelpers';
import {
    detectAmountMismatch,
    extractDedupKey,
    shouldIgnoreLatePaymentFailed,
} from './webhookDedupHelpers';

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
// PR 46 — Distance Matrix API key. Read EXCLUSIVELY by
// `getDeliveryEstimate`, and only on the branch where
// `aiFeatures/distanceMatrix.enabled === true`. With the
// kill-switch defaulting to false during pilot the secret
// is never accessed, so an unset secret is safe at deploy
// time. Set via `firebase functions:secrets:set GOOGLE_MAPS_API_KEY`
// before the flag is flipped at scale.
const GOOGLE_MAPS_API_KEY = defineSecret('GOOGLE_MAPS_API_KEY');

type OrderStatus =
  | 'pending'
  | 'accepted'
  | 'preparing'
  | 'ready_for_pickup'
  | 'delivered'
  | 'cancelled';

const VALID_ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ['accepted', 'cancelled'],
  accepted: ['preparing', 'cancelled'],
  preparing: ['ready_for_pickup', 'cancelled'],
  ready_for_pickup: ['delivered'],
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
  // PR 21 — optional. Old clients won't send it; server defaults
  // to 'call_me' via normalizeSubstitutionPreference. New clients
  // send one of the three string values from the checkout picker.
  substitutionPreference?: 'call_me' | 'auto' | 'refund';
  // PR 46 — optional locked delivery location. When present, the
  // server validates the shape, re-derives the distance/duration
  // estimate authoritatively (so a tampered client can't forge a
  // short distance to dodge future tier-based delivery charges in
  // PR 47), and stamps all three delivery fields onto the order
  // doc. Pre-PR-46 clients omit it and the order doc is written
  // without the new fields (back-compat).
  deliveryLocation?: {
    lat: number;
    lng: number;
    type: 'saved_address' | 'current_location';
    addressId?: string;
    label: string;
  };
};

export const placeOrder = onCall<PlaceOrderInput>(
  {
    cors: true,
    enforceAppCheck: false,
    // PR 46 — declare GOOGLE_MAPS_API_KEY too so the authoritative
    // re-derivation has access when (eventually) the kill-switch
    // flips. During pilot the disabled branch never reads it, so
    // an unset secret is safe.
    secrets: [RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, GOOGLE_MAPS_API_KEY],
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

    // PR 46 — validate the optional locked delivery location shape.
    // Coords are re-derived authoritatively below (we never trust
    // the client's distance/duration); but the {type, addressId,
    // label} are taken from the client because they record WHICH
    // source the customer picked. The lat/lng on the order doc
    // ALSO come from the client — they're the customer's intent at
    // checkout, not a server-side calculation. The server's job is
    // only to (a) validate they're plausible numbers and (b) compute
    // distance + duration from them. If a tampered client sends
    // bogus coords, the resulting distance is what gets used for
    // PR 47's tier-based charge — which is fine, because the
    // customer is the one who's going to pay extra delivery for
    // their own forged coords. The integrity-sensitive step is
    // re-DERIVING the distance, not validating the destination.
    const rawDeliveryLocation = (request.data as { deliveryLocation?: unknown })
      ?.deliveryLocation;
    let lockedDeliveryLocation: {
      lat: number;
      lng: number;
      type: 'saved_address' | 'current_location';
      addressId?: string;
      label: string;
    } | null = null;
    if (rawDeliveryLocation !== undefined && rawDeliveryLocation !== null) {
      if (typeof rawDeliveryLocation !== 'object') {
        throw new HttpsError(
          'invalid-argument',
          'deliveryLocation must be an object',
        );
      }
      const dl = rawDeliveryLocation as Record<string, unknown>;
      const dlCoordsResult = validateDestLatLng({ lat: dl.lat, lng: dl.lng });
      if (!dlCoordsResult.ok) {
        throw new HttpsError(
          'invalid-argument',
          `deliveryLocation: ${dlCoordsResult.message}`,
        );
      }
      if (dl.type !== 'saved_address' && dl.type !== 'current_location') {
        throw new HttpsError(
          'invalid-argument',
          'deliveryLocation.type must be "saved_address" or "current_location"',
        );
      }
      if (typeof dl.label !== 'string' || dl.label.trim().length === 0) {
        throw new HttpsError(
          'invalid-argument',
          'deliveryLocation.label must be a non-empty string',
        );
      }
      // Cap label length defensively — clients shouldn't be sending
      // 10kb labels, but Firestore doc size limits are real and a
      // future reverse-geocode integration could in theory return
      // very long display strings.
      const label = dl.label.trim().slice(0, 200);
      // addressId is optional on current_location; required-ish on
      // saved_address but we don't enforce — the client's analytics
      // value isn't worth a hard reject if a saved-address path
      // somehow reaches us without it.
      const addressId =
        typeof dl.addressId === 'string' && dl.addressId.length > 0
          ? dl.addressId
          : undefined;
      lockedDeliveryLocation = {
        lat: dlCoordsResult.value.lat,
        lng: dlCoordsResult.value.lng,
        type: dl.type,
        ...(addressId ? { addressId } : {}),
        label,
      };
    }

    // PR 21 — normalize the substitution preference. Undefined /
    // null (old clients) → 'call_me'. Unknown strings reject with
    // invalid-argument; we don't want typos persisted on the doc
    // since the shop UI can't render them.
    const subResult = normalizeSubstitutionPreference(
      (request.data as { substitutionPreference?: unknown })
        ?.substitutionPreference,
    );
    if (!subResult.ok) {
      throw new HttpsError(subResult.code, subResult.message);
    }
    const substitutionPreference = subResult.value;

    // PR 22 — normalize the customer's delivery instructions. The
    // existing per-field address validation above doesn't know about
    // the new optional field. Same allowlist + length rules saveAddress
    // uses (delegated to deliveryInstructionsHelpers so both callables
    // can't diverge). Missing / whitespace-only → undefined; we then
    // stamp it onto the deliveryAddress snapshot only when set, to
    // keep legacy doc shape stable.
    const instrResult = normalizeDeliveryInstructions(
      (address as { deliveryInstructions?: unknown })?.deliveryInstructions,
    );
    if (!instrResult.ok) {
      throw new HttpsError(instrResult.code, instrResult.message);
    }
    const deliveryInstructions = instrResult.value;

    const shopSnap = await db.doc(`shops/${shopId}`).get();
    if (!shopSnap.exists) throw new HttpsError('not-found', 'Shop not found');
    const shop = shopSnap.data() as {
      name: string;
      isOpen: boolean;
      minOrder: number;
      deliveryFee: number;
      etaMinutes?: number;
      // PR 46 — needed for the authoritative delivery-distance
      // re-derivation. Optional because legacy seeded shops predate
      // the geo system and may lack it; we tolerate the gap by
      // skipping the locked-fields stamp on those orders rather
      // than blocking checkout.
      location?: { lat?: unknown; lng?: unknown };
      // PR 47 — distance-based delivery charge tiers. OPTIONAL:
      // legacy shops without the field fall back to the flat
      // `deliveryFee` via `chargeForDistance`'s legacy branch.
      deliveryChargeTiers?: DeliveryChargeTier[];
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
          // PR 4 — cart integrity. Read shopId off the menu doc itself
          // (rather than just trusting the path interpolation) so the
          // collective same-shop check downstream has a concrete field
          // to validate against. menu.shopId is set by addMenuItem*
          // and addCustomMenuItem; defensive `?? shopId` covers any
          // legacy doc that might be missing it.
          const menuWithShopId = menu as typeof menu & { shopId?: string };
          return {
            // For CUSTOM items menu.productId is null — we use the
            // menuItemId as the order-line productId so the existing
            // Order schema (which requires productId) stays sound.
            productId: menu.productId ?? menu.id,
            menuItemId: menu.id,
            shopId: menuWithShopId.shopId ?? shopId,
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
          shopId: product.shopId,
          name: product.name,
          imageUrl: product.imageUrl,
          packLabel: `${product.packSize.value} ${product.packSize.unit}`,
          price: product.price,
          quantity: ci.quantity,
        };
      }),
    );

    // PR 4 — cart integrity (Phase B). Defense-in-depth collective
    // check that every resolved line belongs to the order's shop.
    // The per-line lookup above already enforces this implicitly
    // (Path 1 reads from `shops/${shopId}/menu/...`; Path 2 has its
    // own `product.shopId !== shopId` guard), but a refactor of either
    // path could drop the implicit check. The explicit helper makes
    // the invariant local and greppable for security review.
    const integrity = validateAllItemsInSameShop(
      serverItems as Array<{ menuItemId?: string; productId?: string; shopId: string }>,
      shopId,
    );
    if (!integrity.ok) {
      throw new HttpsError(
        'failed-precondition',
        `Cart item ${integrity.offendingMenuItemId} belongs to a different shop. Clear cart and try again.`,
      );
    }

    const subtotal = serverItems.reduce((sum, i) => sum + i.price * i.quantity, 0);
    // PR 5 — admin bypass for the minOrder gate. The operator
    // routinely places small test orders to exercise the customer
    // flow on real shop data; without a bypass they have to manually
    // edit `minOrder` in Firestore Console before each test.
    //
    // Decision lives in checkMinOrderGate (pure helper) so the
    // strict-equality `admin === true` rule and the error-message
    // shape are pinned by unit tests — see
    // tests/functions/placeOrderGateHelpers.test.ts. Every OTHER
    // validation (availability, stock, price drift, multi-shop
    // cart guard from PR 4) still runs for admin callers — this
    // helper is narrowly the minOrder gate.
    const gate = checkMinOrderGate({
      auth: {
        token: { admin: (auth.token as { admin?: unknown })?.admin },
      },
      subtotal,
      minOrder: shop.minOrder,
    });
    if (!gate.ok) {
      throw new HttpsError('failed-precondition', gate.message);
    }
    // PR 46 — authoritative delivery-distance re-derivation. The
    // CheckoutScreen showed the customer a preview value via
    // getDeliveryEstimate; we redo the calculation here so the
    // stamped figure on the order doc cannot be tampered with by
    // a modified client. Re-uses the shared helper so both
    // surfaces produce identical estimates from identical inputs.
    //
    // Skipped when:
    //   - the client didn't send a deliveryLocation (pre-PR-46
    //     client, or a flow that couldn't capture coords) — we
    //     just don't stamp the new fields and the order is
    //     back-compat-clean.
    //   - the shop has no `location` field (legacy seeded shops).
    //     deriveShopDeliveryEstimate returns null in that case;
    //     same back-compat-clean outcome.
    //
    // PR 47 — moved this block ABOVE the deliveryFee/total
    // computation so the tier-based charge below can read
    // `stampedDeliveryDistanceKm`. Pure reorder (no transaction
    // here, so no read-before-write concern).
    let stampedDeliveryDistanceKm: number | undefined;
    let stampedDeliveryDurationMin: number | undefined;
    if (lockedDeliveryLocation) {
      const estimate = await deriveShopDeliveryEstimate(shopId, {
        lat: lockedDeliveryLocation.lat,
        lng: lockedDeliveryLocation.lng,
      });
      if (estimate) {
        stampedDeliveryDistanceKm = estimate.distanceKm;
        stampedDeliveryDurationMin = estimate.durationMin;
      }
    }

    // PR 47 — distance-based delivery charge. The charge is
    // computed SERVER-SIDE from the just-derived
    // `stampedDeliveryDistanceKm` and the shop's stored
    // `deliveryChargeTiers` — never trusted from the client. If
    // distance is absent (pre-PR-46 client or shop without a
    // location) we pass 0, which lands in the cheapest tier; the
    // tier table fallback to the legacy flat `deliveryFee` is the
    // safety net for shops without a tier table at all (legacy
    // shops + the existing seeded shops until their owner
    // configures tiers via Shop Settings).
    //
    // We also stamp `deliveryFee` = `deliveryCharge` on the order
    // doc as a back-compat shim — every existing reader of
    // `order.deliveryFee` (admin screens, receipts, refund logic,
    // ShopOrderDetail, listMyOrders) keeps working unchanged. The
    // `deliveryCharge` field is the source of truth going forward;
    // `deliveryFee` will be deprecated once every reader migrates.
    const deliveryCharge = chargeForDistance(
      shop.deliveryChargeTiers,
      stampedDeliveryDistanceKm ?? 0,
      shop.deliveryFee ?? 0,
    );
    const deliveryFee: number = deliveryCharge;
    const total = subtotal + deliveryCharge;
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
      // PR 47 — explicit `deliveryCharge` field (mirrors
      // `deliveryFee` above for back-compat with every existing
      // reader). New surfaces should read this; the duplicate
      // `deliveryFee` write is the migration shim until every
      // reader (admin screens, receipts, refund logic) moves
      // over.
      deliveryCharge,
      total,
      // PR 22 — stamp the normalized instructions onto the snapshot.
      // We first strip the raw field from the spread (so a client-
      // sent whitespace-only string doesn't survive into the doc),
      // then re-add ONLY the trimmed value when present. Pre-PR-22
      // orders simply have no field here.
      deliveryAddress: (() => {
        const { deliveryInstructions: _drop, ...rest } =
          address as Record<string, unknown>;
        void _drop;
        return {
          ...rest,
          ...(deliveryInstructions !== undefined
            ? { deliveryInstructions }
            : {}),
        };
      })(),
      // PR 46 — locked delivery location + server-authoritative
      // distance + duration. All three fields are omitted entirely
      // when the client didn't send a deliveryLocation OR the shop
      // had no usable `location` (legacy shops). Pre-PR-46 reads of
      // the order doc round-trip unchanged when these are absent.
      ...(lockedDeliveryLocation
        ? { deliveryLocation: lockedDeliveryLocation }
        : {}),
      ...(stampedDeliveryDistanceKm !== undefined
        ? { deliveryDistanceKm: stampedDeliveryDistanceKm }
        : {}),
      ...(stampedDeliveryDurationMin !== undefined
        ? { deliveryDurationMin: stampedDeliveryDurationMin }
        : {}),
      // PR 49 — shop pickup coordinate snapshotted at order time so
      // the delivery partner can sort pickups nearest-first +
      // compute the partner→shop leg without a shop-doc read per
      // order. `shop` is the doc we already read above (no extra
      // Firestore call). Skipped entirely when `shop.location` is
      // missing (legacy seeded shops); the order doc stays
      // back-compat-clean for pre-PR-49 readers.
      ...(shop.location?.lat != null && shop.location?.lng != null
        ? {
            shopLocation: {
              lat: shop.location.lat,
              lng: shop.location.lng,
            },
          }
        : {}),
      paymentMethod,
      paymentStatus,
      ...(razorpayOrderId ? { razorpayOrderId } : {}),
      status: 'pending',
      statusHistory: [{ status: 'pending', at: now, by: 'system' }],
      // PR 21 — substitution preference captured at checkout. Always
      // present on new orders (defaults to 'call_me' for old clients
      // that omit the field); legacy orders predate this and have
      // it missing entirely. ShopOrderDetail treats missing as
      // 'call_me' to be safe.
      substitutionPreference,
      estimatedDeliveryAt: now + etaMinutes * 60_000,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      // Phase 12b delivery-flow placeholders. Setting deliveryPersonId
      // to null at create-time is REQUIRED so the
      // listAvailableDeliveries query (where deliveryPersonId == null)
      // can find this order once the shop owner moves it to
      // ready_for_pickup. Firestore equality on missing fields
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
  // PR 12 — shopkeeper-provided ETA. REQUIRED when newStatus ===
  // 'accepted'; OPTIONAL when newStatus === 'preparing' (used to
  // update the ETA mid-prep). Ignored on all other transitions.
  // Validation in `validateOrderStatusTransition` (pure helper).
  readyByEstimate?: number;
};

export const updateOrderStatus = onCall<UpdateOrderStatusInput>(
  // App Check deferral is documented project-wide in PRELAUNCH_CHECKLIST
  // ("App Check enforcement (intentionally deferred)"). Auth + admin
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

    // PR 12 — ETA validation. Pure helper enforces:
    //   - accepted: readyByEstimate REQUIRED + future
    //   - preparing: readyByEstimate OPTIONAL + future when present
    //   - other transitions: drop whatever the client sent
    const etaCheck = validateOrderStatusTransition({
      status: newStatus,
      readyByEstimate: request.data.readyByEstimate,
      now: Date.now(),
    });
    if (!etaCheck.ok) {
      throw new HttpsError(etaCheck.code, etaCheck.message);
    }

    // PR 2 — payment hardening (item 1 part 2). Cancelling a PAID
    // order via this callable would mark the order cancelled while
    // money stays with the merchant — no Razorpay refund call, no
    // audit trail. Force the caller through the dedicated
    // cancelPaidOrder flow which initiates a Razorpay refund and
    // writes a refunds/{refundId} doc.
    const orderForRefundCheck = order as { paymentStatus?: string };
    if (
      newStatus === 'cancelled' &&
      orderForRefundCheck.paymentStatus === 'paid'
    ) {
      throw new HttpsError(
        'failed-precondition',
        'Paid orders must be cancelled via the Cancel & Refund flow (cancelPaidOrder).',
      );
    }

    const now = Date.now();
    const actorRole = isAdmin ? 'admin' : 'shopOwner';
    // PR 12 — stamp readyByEstimate on the order doc when the
    // helper validated one. We also tuck it into the
    // statusHistory entry's `reason` field for audit purposes
    // (e.g. `ETA: 6:45 PM`) when the caller didn't pass an
    // explicit reason — the timeline view surfaces this for
    // "updated from" indicators.
    const etaUpdate =
      etaCheck.readyByEstimate !== undefined
        ? { readyByEstimate: etaCheck.readyByEstimate }
        : {};
    const historyReason =
      reason ??
      (etaCheck.readyByEstimate !== undefined
        ? `ETA: ${new Date(etaCheck.readyByEstimate).toISOString()}`
        : undefined);
    await ref.update({
      status: newStatus,
      ...etaUpdate,
      updatedAt: FieldValue.serverTimestamp(),
      statusHistory: FieldValue.arrayUnion({
        status: newStatus,
        at: now,
        by: `${actorRole}:${auth.uid}`,
        ...(historyReason ? { reason: historyReason } : {}),
      }),
    });

    // PR 8 — audit log (non-fatal). Manual status overrides are the
    // operationally-riskiest action surface (admin can move an
    // order through any state); a separate audit trail lets us
    // catch policy drift quickly.
    await writeAuditLog({
      actorUid: auth.uid,
      actorRole,
      actionType: 'order.manual_status_update',
      targetType: 'order',
      targetId: orderId,
      reason,
      metadata: {
        from: currentStatus,
        to: newStatus,
        shopId: order.shopId,
      },
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

    const keyId = RAZORPAY_KEY_ID.value();
    const keySecret = RAZORPAY_KEY_SECRET.value();
    const razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });

    // PR 2 — payment hardening (item 6). Before minting a fresh
    // Razorpay order, verify the OLD razorpayOrderId has no
    // captured/authorized payment that hasn't reached us via the
    // webhook yet. Without this guard a customer who sees their
    // order as 'pending' (because the webhook is delayed) and taps
    // "Retry payment" would pay twice — once on the old order
    // (when the webhook eventually arrives) and once on the new.
    if (order.razorpayOrderId) {
      let oldPayments: any[] | null = null;
      try {
        const fetched = await razorpay.orders.fetchPayments(
          order.razorpayOrderId,
        );
        oldPayments = fetched.items ?? [];
      } catch (e) {
        console.warn(
          '[retryPayment] fetchPayments failed for',
          order.razorpayOrderId,
          e,
        );
      }
      const guard = checkRetryPaymentGuard({ payments: oldPayments });
      if (!guard.ok) {
        if (guard.code === 'unverifiable') {
          throw new HttpsError('internal', guard.message);
        }
        throw new HttpsError('failed-precondition', guard.message);
      }
    }

    // Always create a fresh Razorpay order. The old razorpayOrderId
    // is left orphaned (cheap — Razorpay only charges on capture). The
    // webhook resolves the right Firestore doc via notes.orderId so
    // either old-or-new payment lands correctly.
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
// PR 2 — payment hardening, Phase B
// ---------------------------------------------------------------------
// confirmPayment: client-driven verification of a Razorpay Checkout
// success. CheckoutScreen calls this BEFORE navigating to
// OrderConfirmation so the order shows paid immediately, instead of
// waiting up to ~30s for the asynchronous payment.captured webhook.
// HMAC verification means a malicious client can't fabricate a
// payment id and mark a free order paid — only Razorpay knows the
// key secret needed to mint a valid signature.
//
// The webhook is still the source of truth and runs idempotently
// (see razorpayWebhook → payment.captured → "already paid" branch).
// confirmPayment is purely a UX accelerator + audit trail.

export const confirmPayment = onCall<{
  orderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}>(
  {
    cors: true,
    enforceAppCheck: false,
    secrets: [RAZORPAY_KEY_SECRET],
  },
  async request => {
    const auth = request.auth;
    if (!auth) throw new HttpsError('unauthenticated', 'Sign in required');

    const { orderId, razorpayPaymentId, razorpaySignature } = request.data;
    if (!orderId || !razorpayPaymentId || !razorpaySignature) {
      throw new HttpsError(
        'invalid-argument',
        'orderId, razorpayPaymentId, razorpaySignature required',
      );
    }

    const ref = db.doc(`orders/${orderId}`);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new HttpsError('not-found', `Order ${orderId} not found`);
    }
    const order = snap.data() as any;

    if (order.customerUid !== auth.uid) {
      throw new HttpsError('permission-denied', 'Not your order');
    }
    if (!order.razorpayOrderId) {
      throw new HttpsError(
        'failed-precondition',
        'Order has no Razorpay session',
      );
    }
    // Idempotent. Webhook may have already flipped this.
    if (order.paymentStatus === 'paid') {
      return { ok: true, alreadyPaid: true };
    }

    const verify = verifyRazorpaySignature({
      razorpayOrderId: order.razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
      keySecret: RAZORPAY_KEY_SECRET.value(),
    });
    if (!verify.ok) {
      console.warn(
        '[confirmPayment] signature verification failed for order',
        orderId,
        'reason=',
        verify.reason,
      );
      throw new HttpsError(
        'permission-denied',
        `Signature verification failed: ${verify.reason}`,
      );
    }

    // Idempotent paid write. Webhook may arrive later and find
    // already-paid → skip (per the payment.captured idempotency
    // branch above).
    await ref.update({
      paymentStatus: 'paid',
      razorpayPaymentId,
      paidAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      statusHistory: FieldValue.arrayUnion({
        status: 'paid',
        at: Date.now(),
        by: `client-confirm:${auth.uid}`,
        reason: 'Confirmed via confirmPayment callable',
      }),
    });
    return { ok: true, alreadyPaid: false };
  },
);

// cancelPaidOrder: admin or shop-owner-of-this-shop initiates a full
// refund of a paid online order. Two-step:
//   1. Transactionally flip paymentStatus to 'refund_pending' and
//      create the refunds/{refundId} doc with status='pending'.
//   2. Call Razorpay's refund API. On success → flip order to
//      'refunded' + 'cancelled' and refund doc to 'processed'. On
//      failure → flip order to 'refund_failed' (NOT cancelled) so
//      retry is possible.
//
// We deliberately do NOT mark the order cancelled until the Razorpay
// API call succeeds, because cancelling-but-not-refunding is the
// failure mode this whole PR exists to close.

export const cancelPaidOrder = onCall<{
  orderId: string;
  reason: string;
}>(
  {
    cors: true,
    enforceAppCheck: false,
    secrets: [RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET],
  },
  async request => {
    const auth = request.auth;
    const { orderId, reason } = request.data ?? ({} as any);
    if (!orderId) throw new HttpsError('invalid-argument', 'orderId required');

    const orderRef = db.doc(`orders/${orderId}`);
    const orderSnap = await orderRef.get();
    const orderData = orderSnap.exists ? (orderSnap.data() as any) : null;

    const v = validateCancelPaidOrder({
      // The helper takes a plain shape; coerce the firebase-admin
      // AuthData (which carries DecodedIdToken) into it. Same posture
      // as the deliveryRequestHelpers callsites.
      auth: auth
        ? {
            uid: auth.uid,
            token: auth.token as unknown as {
              admin?: unknown;
              shopOwner?: unknown;
              shopId?: unknown;
            },
          }
        : null,
      order: orderData,
      reason,
    });
    if (!v.ok) {
      throw new HttpsError(v.code, v.message);
    }

    const refundDocId = db.collection('refunds').doc().id;
    const refundRef = db.collection('refunds').doc(refundDocId);
    const now = Date.now();

    // Step 1 — atomic state transition to refund_pending + refund doc.
    await db.runTransaction(async tx => {
      tx.update(orderRef, {
        paymentStatus: 'refund_pending',
        cancellationReason: v.reason,
        updatedAt: FieldValue.serverTimestamp(),
        statusHistory: FieldValue.arrayUnion({
          status: 'refund_pending',
          at: now,
          by: `${v.role}:${v.uid}`,
          reason: v.reason,
        }),
      });
      tx.set(refundRef, {
        id: refundDocId,
        orderId,
        paymentId: orderData.razorpayPaymentId,
        amount: orderData.total,
        reason: v.reason,
        status: 'pending',
        initiatedBy: v.uid,
        initiatedRole: v.role,
        initiatedAt: now,
      });
    });

    // Step 2 — fire the Razorpay refund. On any failure flip to
    // refund_failed so an admin can retry.
    const razorpay = new Razorpay({
      key_id: RAZORPAY_KEY_ID.value(),
      key_secret: RAZORPAY_KEY_SECRET.value(),
    });
    try {
      const refund = await razorpay.payments.refund(
        orderData.razorpayPaymentId,
        {
          // Razorpay's "normal" speed = 5-7 business days, no extra
          // fee. "optimum" is instant but charges. MVP is normal.
          speed: 'normal',
          notes: { orderId, reason: v.reason },
        } as any,
      );

      const processedAt =
        refund?.status === 'processed' ? Date.now() : null;

      await db.runTransaction(async tx => {
        tx.update(orderRef, {
          paymentStatus: 'refunded',
          status: 'cancelled',
          refundId: refund?.id ?? refundDocId,
          refundedAt: processedAt ?? Date.now(),
          updatedAt: FieldValue.serverTimestamp(),
          statusHistory: FieldValue.arrayUnion({
            status: 'cancelled',
            at: Date.now(),
            by: `${v.role}:${v.uid}`,
            reason: `Cancelled with refund — ${v.reason}`,
          }),
        });
        tx.update(refundRef, {
          status: refund?.status === 'processed' ? 'processed' : 'pending',
          razorpayRefundId: refund?.id ?? null,
          processedAt: processedAt ?? null,
          razorpayStatus: refund?.status ?? null,
        });
      });

      // Best-effort customer notification. The push trigger on
      // orders/{id} status='cancelled' will also fire — we send an
      // explicit one here too because the refund language matters
      // and the generic order-status push doesn't carry the amount.
      try {
        const customerSnap = await db
          .doc(`users/${orderData.customerUid}`)
          .get();
        const tokens: string[] =
          (customerSnap.data() as any)?.fcmTokens ?? [];
        if (tokens.length > 0) {
          await fetch('https://exp.host/--/api/v2/push/send', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify(
              tokens.map(token => ({
                to: token,
                title: 'Order cancelled & refunded',
                body: `₹${orderData.total} will be refunded to your original payment method in 5-7 business days.`,
                data: { orderId, kind: 'refund_initiated' },
              })),
            ),
          });
        }
      } catch (e) {
        console.warn('[cancelPaidOrder] customer push failed:', e);
      }

      // PR 8 — audit log (non-fatal). Refund flow is high-stakes;
      // a single durable record per cancel-paid action.
      await writeAuditLog({
        actorUid: v.uid,
        actorRole: v.role === 'shopOwner' ? 'shopOwner' : 'admin',
        actionType: 'order.cancel_paid',
        targetType: 'order',
        targetId: orderId,
        reason,
        metadata: {
          amount: orderData.total,
          refundId: refund?.id ?? refundDocId,
          shopId: orderData.shopId,
        },
      });

      return { ok: true, refundId: refund?.id ?? refundDocId };
    } catch (err: any) {
      const failureReason: string =
        err?.error?.description ?? err?.message ?? 'Razorpay refund failed';
      console.error(
        '[cancelPaidOrder] razorpay.payments.refund failed for',
        orderId,
        err,
      );
      await db.runTransaction(async tx => {
        tx.update(orderRef, {
          paymentStatus: 'refund_failed',
          updatedAt: FieldValue.serverTimestamp(),
          statusHistory: FieldValue.arrayUnion({
            status: 'refund_failed',
            at: Date.now(),
            by: `${v.role}:${v.uid}`,
            reason: failureReason,
          }),
        });
        tx.update(refundRef, {
          status: 'failed',
          failedAt: Date.now(),
          failureReason,
        });
      });
      await pushToAdmins(
        '🚨 Refund failed',
        `Order #${orderId}: ${failureReason}. Manual intervention required.`,
        { orderId, kind: 'refund_failed' },
      ).catch(e =>
        console.warn('[cancelPaidOrder] pushToAdmins failed:', e),
      );
      throw new HttpsError('internal', `Refund failed: ${failureReason}`);
    }
  },
);

// PR 7 — Customer self-service cancel window (paid online orders).
// Allows the customer to cancel their own paid order within
// CUSTOMER_CANCEL_WINDOW_MS (2 min) of payment captured. Triggers
// the same Razorpay refund flow as cancelPaidOrder, but with a
// customer-only auth path and a fixed 2-min eligibility window
// enforced by `canCustomerCancelPaidOrder`.
//
// We deliberately DO NOT extract the refund execution into a shared
// helper that cancelPaidOrder also calls — the admin flow has push
// notifications + admin-alerts on failure that the customer flow
// doesn't need, and the divergent logic ergonomics make the
// duplication net-cheaper than a leaky shared abstraction.
// Documented as a deferred follow-up in PRELAUNCH_CHECKLIST.
//
// Behavior on Razorpay failure: paymentStatus → 'refund_failed' so
// admin can retry via the existing cancelPaidOrder flow. We do NOT
// roll back to 'paid' — the customer's intent to cancel is recorded
// in the refund doc + statusHistory and shouldn't be silently
// erased.
export const cancelMyRecentPaidOrder = onCall<{
  orderId: string;
  reason?: string;
}>(
  {
    cors: true,
    enforceAppCheck: false,
    secrets: [RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET],
  },
  async request => {
    const auth = request.auth;
    const { orderId } = request.data ?? ({} as any);
    if (!orderId || typeof orderId !== 'string') {
      throw new HttpsError('invalid-argument', 'orderId required');
    }

    const orderRef = db.doc(`orders/${orderId}`);
    const orderSnap = await orderRef.get();
    const orderData = orderSnap.exists ? (orderSnap.data() as any) : null;

    // Window + auth + ownership validation. Server uses Date.now()
    // as the canonical clock — client-side countdown is UX only;
    // the server is the gate. If the client is 2-3s behind the
    // server (typical), the customer might see "expired" briefly
    // server-side after the local countdown hit zero. That's fine —
    // the UI re-fetches the order and the message updates to
    // "Cancellation window has expired".
    const validated = canCustomerCancelPaidOrder({
      auth: auth ? { uid: auth.uid } : null,
      order: orderData,
      now: Date.now(),
    });
    if (!validated.ok) {
      throw new HttpsError(validated.code, validated.message);
    }

    const reason =
      (request.data?.reason ?? '').toString().trim().slice(0, 280) ||
      'Customer cancelled within window';
    const refundDocId = db.collection('refunds').doc().id;
    const refundRef = db.collection('refunds').doc(refundDocId);
    const now = Date.now();

    // Step 1 — atomic state transition + refund-doc creation. Same
    // shape as cancelPaidOrder so admin tooling that reads the
    // refunds collection works uniformly across both initiation
    // paths.
    await db.runTransaction(async tx => {
      tx.update(orderRef, {
        paymentStatus: 'refund_pending',
        cancellationReason: reason,
        updatedAt: FieldValue.serverTimestamp(),
        statusHistory: FieldValue.arrayUnion({
          status: 'refund_pending',
          at: now,
          by: `customer:${auth!.uid}`,
          reason,
        }),
      });
      tx.set(refundRef, {
        id: refundDocId,
        orderId,
        paymentId: orderData.razorpayPaymentId,
        amount: orderData.total,
        reason,
        status: 'pending',
        // initiatedRole is the new field admin tooling can filter
        // on to distinguish customer-window cancels from
        // admin-initiated refunds. Both use the same `refunds/*`
        // collection so analytics / payouts can roll them up.
        initiatedBy: auth!.uid,
        initiatedRole: 'customer',
        initiatedAt: now,
      });
    });

    // Step 2 — Razorpay refund call. Wrapped so a transient API
    // failure flips paymentStatus to 'refund_failed' (admin retries)
    // rather than leaving the order in an inconsistent state.
    const razorpay = new Razorpay({
      key_id: RAZORPAY_KEY_ID.value(),
      key_secret: RAZORPAY_KEY_SECRET.value(),
    });
    try {
      const refund = await razorpay.payments.refund(
        orderData.razorpayPaymentId,
        {
          speed: 'normal',
          notes: { orderId, reason, role: 'customer' },
        } as any,
      );

      const processedAt =
        refund?.status === 'processed' ? Date.now() : null;

      await db.runTransaction(async tx => {
        tx.update(orderRef, {
          paymentStatus: 'refunded',
          status: 'cancelled',
          refundId: refund?.id ?? refundDocId,
          refundedAt: processedAt ?? Date.now(),
          updatedAt: FieldValue.serverTimestamp(),
          statusHistory: FieldValue.arrayUnion({
            status: 'cancelled',
            at: Date.now(),
            by: `customer:${auth!.uid}`,
            reason: `Customer cancelled within ${2}-min window — ${reason}`,
          }),
        });
        tx.update(refundRef, {
          status: refund?.status === 'processed' ? 'processed' : 'pending',
          razorpayRefundId: refund?.id ?? null,
          processedAt: processedAt ?? null,
          razorpayStatus: refund?.status ?? null,
        });
      });

      // PR 8.1 — customer-initiated cancel within the 2-min window.
      // 'customer' is a first-class audit role as of PR 8.1; the
      // previous 'system' workaround + metadata.initiatedBy carrier
      // is gone (initiatedBy was redundant with actorUid).
      await writeAuditLog({
        actorUid: auth!.uid,
        actorRole: 'customer',
        actionType: 'order.cancel_by_customer_window',
        targetType: 'order',
        targetId: orderId,
        reason: (request.data as { reason?: string } | undefined)?.reason,
        metadata: {
          refundId: refund?.id ?? refundDocId,
        },
      });

      return { ok: true, refundId: refund?.id ?? refundDocId };
    } catch (err: any) {
      const failureReason: string =
        err?.error?.description ?? err?.message ?? 'Razorpay refund failed';
      console.error(
        '[cancelMyRecentPaidOrder] razorpay.payments.refund failed for',
        orderId,
        err,
      );
      await db.runTransaction(async tx => {
        tx.update(orderRef, {
          paymentStatus: 'refund_failed',
          updatedAt: FieldValue.serverTimestamp(),
          statusHistory: FieldValue.arrayUnion({
            status: 'refund_failed',
            at: Date.now(),
            by: `customer:${auth!.uid}`,
            reason: failureReason,
          }),
        });
        tx.update(refundRef, {
          status: 'failed',
          failedAt: Date.now(),
          failureReason,
        });
      });
      // Surface to admins so they can manually reconcile via the
      // existing cancelPaidOrder retry path.
      await pushToAdmins(
        '🚨 Customer-initiated refund failed',
        `Order #${orderId}: ${failureReason}. Manual intervention required.`,
        { orderId, kind: 'refund_failed' },
      ).catch(e =>
        console.warn('[cancelMyRecentPaidOrder] pushToAdmins failed:', e),
      );
      throw new HttpsError('internal', `Refund failed: ${failureReason}`);
    }
  },
);

// PR 6.1 — Mint a v4 signed PUT URL for a menu image upload.
//
// Why this exists: PR 6 uploaded via the Firebase Web SDK on native,
// which can't see the @react-native-firebase auth session — every
// upload failed with storage/unauthorized. Instead of plumbing a
// second auth SDK or mirroring tokens, we sidestep Storage rules
// entirely: the admin SDK signs an URL that GCS honours without
// rules evaluation. Storage rule for /menu/ is now write-deny
// (storage.rules) and the only path to write a menu image is via
// this callable. See docs/pr-6.1-signed-upload-url-hotfix-windsurf-prompt.md.
//
// Returns: { uploadUrl, downloadUrl, storagePath, expiresAt }.
// Client PUTs the resized JPEG bytes to uploadUrl with header
// Content-Type: image/jpeg (v4 signatures bind contentType, so the
// header MUST match exactly), then saves downloadUrl on the
// menu item doc.
//
// 15-min validity is enough wall-clock for resize + upload on slow
// networks; short enough that a leaked URL goes stale before it can
// be abused at scale.
//
export const getMenuImageUploadUrl = onCall(
  { cors: true, enforceAppCheck: false },
  async request => {
    const auth = request.auth;
    const check = validateGetUploadUrlInput(
      {
        auth: auth
          ? {
              uid: auth.uid,
              token: auth.token as unknown as {
                shopOwner?: unknown;
                shopId?: unknown;
              },
            }
          : null,
      },
      Date.now(),
      () => Math.random().toString(36).slice(2, 8),
    );
    if (!check.ok) {
      throw new HttpsError(check.code, check.message);
    }
    const { storagePath } = check;

    const bucket = getStorage().bucket();
    const file = bucket.file(storagePath);
    const expiresAt = Date.now() + 15 * 60 * 1000; // 15 min

    const [uploadUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: expiresAt,
      // contentType is bound into the signature in v4; the client
      // MUST send `Content-Type: image/jpeg` on the PUT or GCS
      // rejects with a signature mismatch. Resized output from
      // expo-image-manipulator is always JPEG, so this holds.
      contentType: 'image/jpeg',
    });

    // Public download URL — Storage rule for /menu/ is `read: if true`,
    // so this URL works without an auth token. Format matches Firebase
    // Storage's standard public URL pattern, served by the same CDN as
    // images uploaded via the Web SDK.
    const downloadUrl =
      `https://firebasestorage.googleapis.com/v0/b/${bucket.name}` +
      `/o/${encodeURIComponent(storagePath)}?alt=media`;

    return {
      uploadUrl,
      downloadUrl,
      storagePath,
      expiresAt,
    };
  },
);

// ---------------------------------------------------------------------
// PR 31 — Shop KYC document upload (signed PUT URL + record + admin read)
// ---------------------------------------------------------------------
//
// Three callables, mirroring the menu-image-upload split but with a
// stricter auth model:
//   - `getShopKycUploadUrl`: caller must own a *pending* shop. Mints
//     a v4 signed PUT URL targeting `shop-kyc/{shopId}/...`. Storage
//     rule for `/shop-kyc/` is write-deny — the signed URL bypasses
//     rules at signing time, same posture as `/menu/`.
//   - `recordShopKycUpload`: caller confirms a successful PUT and
//     the server stamps `registrationData.kycDocs.{kind}` onto the
//     shop doc. Re-verifies ownership + pending-state + path-prefix
//     to defend against a forged record-call carrying another
//     shop's storagePath.
//   - `getShopKycReadUrls`: admin-only. Returns server-minted v4
//     signed-read URLs for each uploaded doc on a given shop, for
//     use by `ShopRegistrationDetailScreen`. Bucket reads are
//     admin-only at the rule level (PII), so the admin client
//     cannot read directly via the Web SDK either.
//
// The signed-PUT URL has a 15-minute validity (matches menu-image
// upload) — long enough for resize+upload on slow networks, short
// enough that a leaked URL goes stale before it can be abused.
//
// Helper validation is in `kycUploadHelpers.ts` (pure, fully tested).

export const getShopKycUploadUrl = onCall<{
  shopId: string;
  docKind: string;
}>(
  { cors: true, enforceAppCheck: false },
  async request => {
    const auth = request.auth;
    const shopId = request.data?.shopId;
    const docKind = request.data?.docKind;

    // Look up the shop ONCE here so the helper stays pure (no
    // Firestore handles). The helper sees `shop: null` for missing
    // shops and returns `not-found`.
    let shop:
      | { ownerUid?: string; status?: string }
      | null = null;
    if (shopId && typeof shopId === 'string') {
      const snap = await db.doc(`shops/${shopId}`).get();
      shop = snap.exists ? (snap.data() as { ownerUid?: string; status?: string }) : null;
    }

    const result = validateGetKycUploadUrlInput(
      {
        auth: auth ? { uid: auth.uid } : null,
        shopId,
        docKind,
        shop,
      },
      Date.now(),
      () => Math.random().toString(36).slice(2, 8),
    );
    if (!result.ok) {
      throw new HttpsError(result.code, result.message);
    }

    const bucket = getStorage().bucket();
    const file = bucket.file(result.storagePath);
    const expiresAt = Date.now() + 15 * 60 * 1000;
    const [uploadUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: expiresAt,
      // v4 binds contentType into the signature — client MUST send
      // `Content-Type: image/jpeg` exactly. expo-image-picker on
      // both iOS and Android delivers a JPEG-encoded local URI for
      // images by default, and we re-fetch as a Blob client-side
      // so the upload bytes are JPEG.
      contentType: 'image/jpeg',
    });

    return {
      ok: true,
      uploadUrl,
      storagePath: result.storagePath,
      docKind: result.docKind,
      expiresAt,
    };
  },
);

export const recordShopKycUpload = onCall<{
  shopId: string;
  docKind: string;
  storagePath: string;
}>(
  { cors: true, enforceAppCheck: false },
  async request => {
    const auth = request.auth;
    if (!auth) {
      throw new HttpsError('unauthenticated', 'Sign in required');
    }

    const { shopId, docKind, storagePath } = request.data ?? {};
    if (
      !shopId ||
      typeof shopId !== 'string' ||
      !docKind ||
      typeof docKind !== 'string' ||
      !storagePath ||
      typeof storagePath !== 'string'
    ) {
      throw new HttpsError(
        'invalid-argument',
        'shopId, docKind, storagePath required',
      );
    }
    if (!VALID_DOC_KINDS.includes(docKind as DocKind)) {
      throw new HttpsError(
        'invalid-argument',
        `docKind must be one of: ${VALID_DOC_KINDS.join(', ')}`,
      );
    }

    // Defense-in-depth: the storagePath MUST be under the shop's
    // own folder. A forged call carrying `storagePath:
    // "shop-kyc/<other-shop>/foo.jpg"` would otherwise let an
    // owner stamp another shop's path onto their own doc — not
    // dangerous (admin only sees their own doc's pointers) but
    // confusing and worth blocking.
    const expectedPrefix = `shop-kyc/${shopId}/`;
    if (!storagePath.startsWith(expectedPrefix)) {
      throw new HttpsError(
        'permission-denied',
        'storagePath does not match the shop',
      );
    }

    const shopRef = db.doc(`shops/${shopId}`);
    const snap = await shopRef.get();
    if (!snap.exists) {
      throw new HttpsError('not-found', 'Shop not found');
    }
    const shop = snap.data() as { ownerUid?: string; status?: string };
    if (shop.ownerUid !== auth.uid) {
      throw new HttpsError(
        'permission-denied',
        'You are not the owner of this shop',
      );
    }
    if (shop.status !== 'pending') {
      throw new HttpsError(
        'failed-precondition',
        `KYC docs are frozen once the shop leaves pending state (status is '${shop.status}')`,
      );
    }

    await shopRef.update({
      [`registrationData.kycDocs.${docKind}`]: {
        storagePath,
        uploadedAt: Date.now(),
      },
      updatedAt: FieldValue.serverTimestamp(),
    });

    return { ok: true };
  },
);

export const getShopKycReadUrls = onCall<{ shopId: string }>(
  { cors: true, enforceAppCheck: false },
  async request => {
    const auth = request.auth;
    if (!auth) {
      throw new HttpsError('unauthenticated', 'Sign in required');
    }
    if (auth.token?.admin !== true) {
      throw new HttpsError('permission-denied', 'Admin role required');
    }

    const shopId = request.data?.shopId;
    if (!shopId || typeof shopId !== 'string') {
      throw new HttpsError('invalid-argument', 'shopId required');
    }

    const snap = await db.doc(`shops/${shopId}`).get();
    if (!snap.exists) {
      throw new HttpsError('not-found', 'Shop not found');
    }
    const shop = snap.data() as {
      registrationData?: {
        kycDocs?: Partial<
          Record<DocKind, { storagePath: string; uploadedAt: number }>
        >;
      };
    };
    const docs = shop?.registrationData?.kycDocs;
    if (!docs) return { ok: true, urls: {} };

    const bucket = getStorage().bucket();
    const out: Record<string, string> = {};
    const expires = Date.now() + 60 * 60 * 1000; // 1 hour
    for (const [kind, ref] of Object.entries(docs)) {
      if (!ref || !ref.storagePath) continue;
      const file = bucket.file(ref.storagePath);
      const [url] = await file.getSignedUrl({
        version: 'v4',
        action: 'read',
        expires,
      });
      out[kind] = url;
    }
    return { ok: true, urls: out };
  },
);

// ---------------------------------------------------------------------
// PR 8 Part A — Admin audit log
// ---------------------------------------------------------------------
// Writes are intentionally non-fatal. A Firestore outage during the
// audit-log write should NOT break the user-visible action that
// triggered it — worst case is a gap in audit history, which is
// acceptable for MVP (revisit if compliance requires hard guarantees).
// All admin callables `await writeAuditLog(...)` at the end of their
// success path; the catch block here swallows errors.
//
// actionType strings are part of the audit's stable contract — treat
// like an API. New action types are fine; do not rename existing ones
// or historical search breaks.
async function writeAuditLog(input: AuditLogInput): Promise<void> {
  try {
    const { id, doc } = buildAuditLogEntry(input);
    await db.collection('auditLog').doc(id).set(doc);
  } catch (e) {
    console.warn('[auditLog] write failed (non-fatal):', e);
  }
}

// PR 8 Part A — admin-only paginated audit-log reader.
//
// Cursor pagination via `before` (millisecond timestamp). The query
// is `orderBy timestamp desc, where timestamp < before, limit`.
// Single-field index on `timestamp` is auto-created by Firestore;
// no firestore.indexes.json entry needed.
//
// Note: this list endpoint MAY return metadata containing
// user-identifying info (phone numbers, addresses) if a wiring site
// stuffs it into the metadata blob. Future contributors: keep the
// audit log itself complete, but if any field becomes sensitive,
// add a redacted-summary projection here. For PR 8 nothing in
// metadata is especially sensitive; revisit when wiring something
// like KYC documents.
export const listRecentAuditEntries = onCall<{
  limit?: number;
  before?: number;
}>(
  { cors: true, enforceAppCheck: false },
  async request => {
    const auth = request.auth;
    if (!auth) {
      throw new HttpsError('unauthenticated', 'Sign in required');
    }
    if ((auth.token as { admin?: unknown })?.admin !== true) {
      throw new HttpsError('permission-denied', 'Admin role required');
    }
    const limitRaw = request.data?.limit;
    const limit =
      typeof limitRaw === 'number' && limitRaw > 0 && limitRaw <= 100
        ? Math.floor(limitRaw)
        : 50;
    const before = request.data?.before;

    let q = db
      .collection('auditLog')
      .orderBy('timestamp', 'desc')
      .limit(limit);
    if (typeof before === 'number' && Number.isFinite(before)) {
      q = q.where('timestamp', '<', before).orderBy('timestamp', 'desc').limit(limit);
    }
    const snap = await q.get();
    return {
      entries: snap.docs.map(d => d.data()),
      hasMore: snap.docs.length === limit,
    };
  },
);

// PR 8 Part B — Bulk menu availability toggle for shop owners.
//
// Auth: shopOwner with matching shopId claim. Server re-derives shopId
// from claims (client-supplied shopId would be a confused-deputy hole).
// Per-id we additionally verify `shopId == claims.shopId` to prevent
// owner from toggling another shop's items even if they know the ids.
//
// Returns { updatedCount, skippedCount } where skipped = ids that
// didn't exist OR didn't belong to the caller's shop. UX surfaces
// the skip count when non-zero so the owner notices stale ids.
//
// Audit log entry is written at the end (actorRole=shopOwner,
// actionType=shop.bulk_menu_availability) so "did the shop accidentally
// mark everything unavailable at 3am?" is answerable.
export const bulkUpdateMenuAvailability = onCall<{
  menuItemIds: string[];
  available: boolean;
}>(
  { cors: true, enforceAppCheck: false },
  async request => {
    const auth = request.auth;
    const check = validateBulkMenuRequest({
      auth: auth
        ? {
            uid: auth.uid,
            token: auth.token as unknown as {
              shopOwner?: unknown;
              shopId?: unknown;
            },
          }
        : null,
      menuItemIds: request.data?.menuItemIds,
      available: request.data?.available,
    });
    if (!check.ok) {
      throw new HttpsError(check.code, check.message);
    }
    const { shopId, validIds, available } = check;

    // Read all candidate docs first; filter by shopId + existence;
    // batch-write only those that match. Firestore `in` query is
    // limited to 30 ids per batch in v9+, so we chunk if needed —
    // BULK_MENU_MAX_IDS = 100 ⇒ at most 4 chunks.
    const CHUNK = 30;
    const matchedIds: string[] = [];
    for (let i = 0; i < validIds.length; i += CHUNK) {
      const chunk = validIds.slice(i, i + CHUNK);
      const snap = await db
        .collection('menuItems')
        .where('__name__', 'in', chunk)
        .get();
      for (const doc of snap.docs) {
        const data = doc.data() as { shopId?: unknown };
        if (data.shopId === shopId) {
          matchedIds.push(doc.id);
        }
      }
    }

    // Batch write. Firestore batches are capped at 500 ops; 100 ids
    // fits comfortably in a single batch.
    if (matchedIds.length > 0) {
      const batch = db.batch();
      for (const id of matchedIds) {
        batch.update(db.collection('menuItems').doc(id), {
          available,
          updatedAt: Date.now(),
        });
      }
      await batch.commit();
    }

    const updatedCount = matchedIds.length;
    const skippedCount = validIds.length - matchedIds.length;

    // Best-effort audit log; non-fatal.
    await writeAuditLog({
      actorUid: auth!.uid,
      actorRole: 'shopOwner',
      actionType: 'shop.bulk_menu_availability',
      targetType: 'shop',
      targetId: shopId,
      metadata: {
        requestedCount: validIds.length,
        updatedCount,
        skippedCount,
        available,
      },
    });

    return { updatedCount, skippedCount };
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
    // Mirror firestore.rules `match /orders/{orderId}.allow read`.
    // Callable invocations bypass Firestore rules, so this check
    // exists in two places by necessity. Extracted to
    // ./getOrderAuth.ts (canReadOrder) so the rule + function
    // contracts can be pinned to a single test surface and the
    // "shop owner sees rejection on native but not on web" class
    // can't regress. Sudhir hit that exact bug in v2-iv-followup
    // when the original 2-line check here only allowed customer +
    // admin, even though the rules allowed shop-owner + delivery
    // reads via the web SDK.
    if (
      !canReadOrder({
        uid: auth.uid,
        claims: auth.token ?? {},
        order: data,
      })
    ) {
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

    // PR 2 — payment hardening (item 2). Idempotency dedup. Razorpay
    // retries on non-2xx and sometimes duplicates events under network
    // partition; without dedup a `payment.captured` followed minutes
    // later by a delayed `payment.failed` could downgrade a paid
    // order. We persist a doc per processed event and short-circuit
    // on retry. shouldIgnoreLatePaymentFailed below is the belt; this
    // is the suspenders.
    const dedupKey = extractDedupKey({
      headers: req.headers as any,
      body: event,
    });
    if (dedupKey) {
      const dedupRef = db.doc(`razorpayWebhookEvents/${dedupKey}`);
      const dedupSnap = await dedupRef.get();
      if (dedupSnap.exists) {
        console.log(
          '[razorpayWebhook] already processed event',
          dedupKey,
          '— acking 200',
        );
        res.status(200).send('OK (already processed)');
        return;
      }
      // Note: we WRITE the dedup doc at the end of each branch (after
      // the order update succeeds) to keep the dedup-write + order-
      // write semantically paired. A failure mid-handler will retry
      // and reprocess, which is safe because every order write below
      // is itself idempotent.
    } else {
      console.warn(
        '[razorpayWebhook] could not derive dedup key from event — proceeding without dedup',
        eventType,
      );
    }

    // Helper to write the dedup doc once a branch succeeds. No-op if
    // dedupKey is null (we already logged that above).
    const persistDedup = async (orderId?: string) => {
      if (!dedupKey) return;
      try {
        await db.doc(`razorpayWebhookEvents/${dedupKey}`).set({
          id: dedupKey,
          type: eventType,
          paymentId: payment.id ?? null,
          orderId: orderId ?? null,
          razorpayOrderId: payment.order_id ?? null,
          processedAt: Date.now(),
        });
      } catch (e) {
        console.error('[razorpayWebhook] failed to persist dedup doc', e);
      }
    };

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
    const orderId = orderRef.id;
    const order = orderSnap.data() as
      | { total?: number; paymentStatus?: string }
      | undefined;
    const amountMismatch = detectAmountMismatch({
      expectedRupees: order?.total,
      receivedPaise: payment.amount,
    });

    if (eventType === 'payment.authorized') {
      // PR 2 — payment hardening (item 7). Razorpay can authorize
      // without auto-capturing if the merchant has manual-capture on
      // OR if a 3DS/2FA edge case prevents auto-capture. Without a
      // handler the order would sit pending forever (until cleanup
      // sees the authorization and skips it). We surface the state
      // and alert admin.
      if (order?.paymentStatus === 'paid') {
        // Already captured by a later event we processed first.
        await persistDedup(orderId);
        res.status(200).send('OK (already paid)');
        return;
      }
      await orderRef.update({
        paymentStatus: 'authorized',
        razorpayPaymentId: payment.id,
        authorizedAt:
          typeof payment.created_at === 'number'
            ? payment.created_at * 1000
            : Date.now(),
        updatedAt: FieldValue.serverTimestamp(),
        statusHistory: FieldValue.arrayUnion({
          status: 'authorized',
          at: Date.now(),
          by: 'razorpay-webhook',
          reason: 'Payment authorized but not yet captured',
        }),
      });
      await pushToAdmins(
        '⚠️ Payment authorized, not captured',
        `Order #${orderId} payment authorized. Manual capture or refund required (Razorpay dashboard).`,
        { orderId, kind: 'payment_authorized_uncaptured' },
      ).catch(e =>
        console.warn('[razorpayWebhook] pushToAdmins failed:', e),
      );
      await persistDedup(orderId);
      res.status(200).send('OK (authorized, pending capture)');
      return;
    }

    if (eventType === 'payment.captured') {
      // PR 2 — payment hardening (item 3). Amount mismatch must NOT
      // mark the order paid. Previously the code wrote paid=true with
      // an `amountMismatch: true` flag; the shop dashboard happily
      // dispatched and the discrepancy was only visible in raw
      // Firestore. Now we write a separate status the UI banners and
      // alert admin for manual reconciliation.
      if (amountMismatch) {
        const expectedRupees = order?.total ?? 0;
        const receivedRupees = (payment.amount ?? 0) / 100;
        await orderRef.update({
          paymentStatus: 'amount_mismatch',
          razorpayPaymentId: payment.id,
          paidAt:
            typeof payment.created_at === 'number'
              ? payment.created_at * 1000
              : FieldValue.serverTimestamp(),
          amountReceived: receivedRupees,
          amountExpected: expectedRupees,
          updatedAt: FieldValue.serverTimestamp(),
          statusHistory: FieldValue.arrayUnion({
            status: 'amount_mismatch',
            at: Date.now(),
            by: 'razorpay-webhook',
            reason: `Received ₹${receivedRupees}, expected ₹${expectedRupees}`,
          }),
        });
        await pushToAdmins(
          '🚨 Payment amount mismatch',
          `Order #${orderId}: received ₹${receivedRupees}, expected ₹${expectedRupees}. Review required.`,
          { orderId, kind: 'payment_amount_mismatch' },
        ).catch(e =>
          console.warn('[razorpayWebhook] pushToAdmins failed:', e),
        );
        await persistDedup(orderId);
        res.status(200).send('OK (amount mismatch flagged)');
        return;
      }

      // Idempotent: if a confirmPayment call already marked this
      // paid we don't need to re-write anything. The dedup doc still
      // gets persisted so a retry of the same event short-circuits
      // up top.
      if (order?.paymentStatus === 'paid') {
        await persistDedup(orderId);
        res.status(200).send('OK (already paid)');
        return;
      }
      await orderRef.update({
        paymentStatus: 'paid',
        razorpayPaymentId: payment.id,
        paidAt:
          typeof payment.created_at === 'number'
            ? payment.created_at * 1000
            : FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        statusHistory: FieldValue.arrayUnion({
          status: 'paid',
          at: Date.now(),
          by: 'razorpay-webhook',
          reason: 'payment.captured event',
        }),
      });
      await persistDedup(orderId);
      res.status(200).send('ok');
      return;
    }

    if (eventType === 'payment.failed') {
      // PR 2 — payment hardening (item 2 part 2). NEVER downgrade a
      // paid (or otherwise terminal) order to failed on a late
      // failed event. The dedup at the top of the handler closes
      // the duplicate-event path; this guard closes the
      // out-of-order path (rare, but Razorpay's event ordering is
      // best-effort under network partition).
      if (
        shouldIgnoreLatePaymentFailed({
          currentPaymentStatus: order?.paymentStatus,
        })
      ) {
        console.warn(
          '[razorpayWebhook] ignoring payment.failed for order',
          orderId,
          'paymentStatus=',
          order?.paymentStatus,
        );
        await persistDedup(orderId);
        res
          .status(200)
          .send('OK (already terminal, ignoring late failed event)');
        return;
      }
      await orderRef.update({
        paymentStatus: 'failed',
        razorpayPaymentId: payment.id,
        paymentFailureMessage:
          payment?.error_description ?? payment?.error_reason ?? 'Payment failed',
        updatedAt: FieldValue.serverTimestamp(),
      });
      await persistDedup(orderId);
      res.status(200).send('ok');
      return;
    }

    // Other event types — ack without mutating but still record so
    // a Razorpay retry of the same event short-circuits.
    await persistDedup(orderId);
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
    // PR 2 — payment hardening (item 5): the per-order
    // reconciliation step calls razorpay.orders.fetchPayments,
    // which needs the same secrets retryPayment / placeOrder use.
    secrets: [RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET],
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

    console.log(
      `[cleanupAbandonedOrders] inspecting ${snap.size} abandoned orders`,
    );

    // PR 2 — payment hardening (item 5). Each order is reconciled
    // against Razorpay BEFORE we cancel. Without this, a paid order
    // whose webhook was delayed >24h would be silently cancelled and
    // money would stay with the merchant.
    //
    // We deliberately do NOT batch the writes anymore — different
    // verdicts produce different writes (mark_paid vs cancel vs
    // skip) and the per-order Razorpay round-trip serializes
    // naturally. At CLEANUP_BATCH_LIMIT=100 and ~150ms per
    // fetchPayments call this is ~15s worst case which is fine for
    // a 60-minute scheduled run.
    const razorpay = new Razorpay({
      key_id: RAZORPAY_KEY_ID.value(),
      key_secret: RAZORPAY_KEY_SECRET.value(),
    });
    const now = Date.now();
    let cancelled = 0;
    let reconciledPaid = 0;
    let deferredAuthorized = 0;
    let deferredUnverifiable = 0;

    for (const doc of snap.docs) {
      const order = doc.data();
      const createdMs =
        order.createdAt?.toMillis?.() ?? order.createdAt ?? Date.now();

      if (order.paymentMethod === 'online' && order.razorpayOrderId) {
        let payments: any[] | null = null;
        try {
          const fetched = await razorpay.orders.fetchPayments(
            order.razorpayOrderId,
          );
          payments = fetched.items ?? [];
        } catch (e) {
          console.error(
            '[cleanupAbandonedOrders] fetchPayments failed for',
            doc.id,
            e,
          );
        }
        const verdict = reconcileAbandonedOrder({ payments });

        if (verdict.kind === 'mark_paid') {
          await doc.ref.update({
            paymentStatus: 'paid',
            razorpayPaymentId: verdict.paymentId,
            paidAt:
              verdict.createdAt != null
                ? verdict.createdAt * 1000
                : FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            statusHistory: FieldValue.arrayUnion({
              status: 'paid',
              at: now,
              by: 'system:cleanup-reconciliation',
              reason:
                'Captured payment found during abandonment sweep — webhook was delayed',
            }),
          });
          reconciledPaid += 1;
          console.log(
            `  ↻ reconciled ${doc.id} — captured payment ${verdict.paymentId}; skipping cancel`,
          );
          continue;
        }

        if (verdict.kind === 'authorized_review') {
          // Don't cancel; flag for admin manual review.
          deferredAuthorized += 1;
          await pushToAdmins(
            '⚠️ Order with stuck authorization',
            `Order #${doc.id} has an authorized but uncaptured Razorpay payment. Manual review required.`,
            { orderId: doc.id, kind: 'stuck_authorization' },
          ).catch(e =>
            console.warn('[cleanupAbandonedOrders] pushToAdmins failed:', e),
          );
          console.warn(
            `  ⚠ ${doc.id} has authorized payment ${verdict.paymentId}; skipping cancel for admin review`,
          );
          continue;
        }

        if (verdict.kind === 'defer_unverifiable') {
          deferredUnverifiable += 1;
          console.warn(
            `  ⚠ ${doc.id} could not verify Razorpay state; deferring to next sweep`,
          );
          continue;
        }
        // verdict.kind === 'cancel_ok' falls through to the cancel
        // branch below — no captured/authorized payments exist.
      }

      await doc.ref.update({
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
      cancelled += 1;
      console.log(
        `  → cancelling ${doc.id} (created ${new Date(createdMs).toISOString()})`,
      );

      // PR 8 — audit log per-cancel (non-fatal). actorRole=system,
      // actorUid is the canonical job name so dashboards can filter
      // "what did the cleanup job do today?".
      await writeAuditLog({
        actorUid: 'cleanupAbandonedOrders',
        actorRole: 'system',
        actionType: 'order.cancel_abandoned',
        targetType: 'order',
        targetId: doc.id,
        reason: `Payment not completed within ${ABANDONED_THRESHOLD_HOURS}h`,
        metadata: {
          createdAt: createdMs,
          shopId: (doc.data() as { shopId?: string }).shopId,
        },
      });
    }

    console.log(
      `[cleanupAbandonedOrders] done — cancelled=${cancelled} reconciledPaid=${reconciledPaid} deferredAuthorized=${deferredAuthorized} deferredUnverifiable=${deferredUnverifiable}`,
    );
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
    // PR 45 — input validation extracted to `validatePushTokenInput`
    // so the auth + token-shape gates are exercised by
    // `tests/functions/pushHelpers.test.ts` without spinning up
    // firebase-admin. Loose validation kept (any non-empty string
    // accepted) so this endpoint can later carry raw FCM/APN tokens
    // if we drop the Expo Push relay.
    const v = validatePushTokenInput(request.auth, request.data);
    if (!v.ok) {
      throw new HttpsError(v.code, v.message);
    }
    await db.doc(`users/${v.uid}`).set(
      {
        fcmTokens: FieldValue.arrayUnion(v.token),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return { ok: true };
  },
);

// PR 24 — Inverse of registerPushToken. Removes THIS device's Expo
// push token from the caller's users/{uid}.fcmTokens array so the
// account no longer receives notifications on this device.
//
// Called by the client's signOutAndClearLocalState flow BEFORE
// firebase.auth().signOut() — once Firebase signs out, request.auth
// is null and the call would be rejected as unauthenticated.
//
// arrayRemove is idempotent: if the token isn't in the array (never
// registered, already removed, or different device), the operation
// is a no-op. The callable never throws for "token not found".
//
// Multi-device safety: arrayRemove only touches the exact token
// string passed in. Other devices the user has registered (phone +
// tablet, etc.) keep their tokens — they continue to receive push.
// Only the device that signed out is detached.
export const unregisterPushToken = onCall<{ token: string }>(
  { cors: true, enforceAppCheck: false },
  async request => {
    // PR 45 — shares `validatePushTokenInput` with registerPushToken;
    // the gate rules are identical and centralising the check keeps
    // any future tightening (e.g. enforcing `ExponentPushToken[…]`
    // shape) a single-file edit.
    const v = validatePushTokenInput(request.auth, request.data);
    if (!v.ok) {
      throw new HttpsError(v.code, v.message);
    }
    await db.doc(`users/${v.uid}`).set(
      {
        fcmTokens: FieldValue.arrayRemove(v.token),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return { ok: true };
  },
);

// PR 45 — ORDER_STATUS_LABELS moved into `pushHelpers.ts` so the
// title-mapping is exercised by buildOrderStatusPushPlan tests.

export const sendOrderStatusPush = onDocumentUpdated(
  { document: 'orders/{orderId}', region: 'asia-south1' },
  async event => {
    // PR 45 — IO + helper split. The trigger reads Firestore, the
    // helper decides what to send. Each skip reason maps to a
    // distinct log line so production debugging stays as good as
    // pre-refactor.
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!before || !after) return;
    if (before.status === after.status) return;

    // Need the customerUid early to know WHICH user doc to read.
    // The helper re-checks this in `missing_customer_uid` to keep
    // its contract self-contained, but we short-circuit here to
    // avoid an unnecessary `users/undefined` doc read.
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

    const plan = buildOrderStatusPushPlan({
      before,
      after,
      tokens,
      orderId: event.params.orderId,
    });
    if (plan.kind === 'skip') {
      // Each skip reason gets its own log line — preserves the
      // pre-refactor debug visibility.
      if (plan.reason === 'no_tokens') {
        console.log(
          `[sendOrderStatusPush] no tokens for ${customerUid} — skipping`,
        );
      } else {
        console.log(
          `[sendOrderStatusPush] skipped order ${event.params.orderId} reason=${plan.reason}`,
        );
      }
      return;
    }

    try {
      const res = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(plan.messages),
      });
      const data = await res.json();
      console.log(
        `[sendOrderStatusPush] sent ${plan.messages.length} push(es) for ${event.params.orderId} ` +
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
// ownership flows through registerShop → admin approveShop. PR 1
// (security hardening) deleted the self-service becomeDelivery callable
// for the same reason: any signed-in user could grant themselves the
// `delivery` claim and then read every pending pickup's customer
// PII (name + phone + address) via listAvailableDeliveries. The
// replacement is requestDeliveryRole → admin approveDeliveryRole,
// mirroring the shop-registration flow exactly. Helpers are in
// ./deliveryRequestHelpers.ts; pure-helper tests live in
// tests/functions/deliveryRequestHelpers.test.ts.
//
// IMPORTANT: this deploy does NOT strip the `delivery` claim from
// users who were granted it by the old becomeDelivery. The new
// restriction only applies to people requesting the role AFTER this
// deploy. Bulk audit / revoke is tracked separately if we later
// decide pre-PR-1 delivery partners need re-verification.

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

    // Validation extracted to ./shopOrdersHelpers.ts so the access
    // logic can be unit-tested without firebase-functions. Returns a
    // discriminated result; we wrap in HttpsError here. (The inline
    // check this replaced was the source of the v2-iv INTERNAL bug:
    // it concatenated claim values into the error message and the
    // RNFB SDK surfaced the whole thing as `INTERNAL` instead of the
    // intended `invalid-argument` / `permission-denied`.)
    const result = validateShopOrdersAccess({
      claims: auth.token ?? {},
      requestedShopId: request.data?.shopId,
    });
    if (!result.ok) {
      throw new HttpsError(result.code, result.message);
    }
    const { targetShopId } = result;

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

// PR 36 — Customer CRM for shop owners.
//
// Aggregates the shop's recent orders (capped at 1000 most-recent
// to bound read cost / latency) into per-customer rollups so the
// shop owner can see their top customers, recent orders, and
// lapsed customers ("stopped 30d+"). Uses the same
// validateShopOrdersAccess gate as listShopOrders so privacy is
// enforced consistently — shop owners only see their OWN shop's
// customers; admins can pass an explicit `shopId`.
//
// All sorting / filtering happens in the pure helper
// (`customerCrmHelpers.ts`) so it's unit-tested without booting
// firebase-functions. The callable here is the thin Firestore-
// query wrapper.
export const listShopCustomers = onCall<{
    shopId?: string;
    sortBy?: 'top_revenue' | 'recent' | 'stopped';
    period?: '90d' | '180d' | 'all';
    limit?: number;
    minDaysSinceLastOrder?: number;
}>(
    { cors: true, enforceAppCheck: false },
    async request => {
        const auth = request.auth;
        if (!auth) throw new HttpsError('unauthenticated', 'Sign in required');

        const result = validateShopOrdersAccess({
            claims: auth.token ?? {},
            requestedShopId: request.data?.shopId,
        });
        if (!result.ok) {
            throw new HttpsError(result.code, result.message);
        }
        const { targetShopId } = result;

        const sortBy = request.data?.sortBy ?? 'top_revenue';
        const period = request.data?.period ?? '90d';
        const limit = Math.min(Math.max(request.data?.limit ?? 50, 1), 200);
        const minDaysSinceLastOrder = Math.max(
            request.data?.minDaysSinceLastOrder ?? 30,
            1,
        );

        // Cap the working set at 1000 most-recent orders. At launch
        // scale (8 shops, low-hundreds orders/shop) every shop's
        // entire history fits; at scale we surface a `truncated`
        // flag so the UI can prompt for date filtering. Same shape
        // listAllOrders uses.
        const HARD_CAP = 1000;
        const snap = await db
            .collection('orders')
            .where('shopId', '==', targetShopId)
            .orderBy('createdAt', 'desc')
            .limit(HARD_CAP)
            .get();

        const allRows: ShopOrderRaw[] = snap.docs.map(d => {
            const data = d.data() as Record<string, any>;
            return {
                id: d.id,
                customerUid: data.customerUid,
                total: typeof data.total === 'number' ? data.total : undefined,
                status: typeof data.status === 'string' ? data.status : undefined,
                createdAt:
                    data.createdAt?.toMillis?.() ??
                    (typeof data.createdAt === 'number' ? data.createdAt : undefined),
                deliveryAddress: data.deliveryAddress
                    ? {
                          name: data.deliveryAddress.name,
                          phone: data.deliveryAddress.phone,
                      }
                    : undefined,
            };
        });

        const now = Date.now();
        const periodCutoff =
            period === '90d'
                ? now - 90 * 86_400_000
                : period === '180d'
                  ? now - 180 * 86_400_000
                  : 0;
        const inPeriod = allRows.filter(
            r => (r.createdAt ?? 0) >= periodCutoff,
        );

        const aggregated = aggregateShopCustomers(inPeriod);

        const view: ShopCustomersView =
            sortBy === 'stopped'
                ? { sortBy: 'stopped', minDaysSinceLastOrder, limit }
                : { sortBy, limit };
        const customers = viewShopCustomers(aggregated, view, now);

        return {
            customers,
            summary: {
                totalUniqueCustomers: aggregated.length,
                totalRevenue: aggregated.reduce(
                    (sum, c) => sum + c.totalSpent,
                    0,
                ),
                ordersScanned: allRows.length,
                ordersInPeriod: inPeriod.length,
                truncated: allRows.length >= HARD_CAP,
            },
        };
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
//   ready_for_pickup + deliveryPersonId=null              → available pickup
//   ready_for_pickup + deliveryPersonId=X + pickedUpAt=null → claimed
//   ready_for_pickup + deliveryPersonId=X + pickedUpAt=ts  → en route
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

// PR 12 — broaden the "available pool" to include `accepted` and
// `preparing` orders that don't yet have a delivery partner. The
// client splits the result into:
//   - "Heads up" (accepted | preparing) → not claimable yet, but
//     visible with the readyByEstimate badge so partners can plan
//     routes / batches.
//   - "Available now" (ready_for_pickup) → tapping claims.
// claimDelivery still rejects anything that isn't ready_for_pickup,
// so a malicious / racing client can't claim an order before the
// shop signals it's done.
const AVAILABLE_POOL_STATUSES = [
  'accepted',
  'preparing',
  'ready_for_pickup',
] as const;

export const listAvailableDeliveries = onCall(
  { cors: true, enforceAppCheck: false },
  async request => {
    requireDeliveryRole(request);
    const snap = await db
      .collection('orders')
      .where('status', 'in', AVAILABLE_POOL_STATUSES as unknown as string[])
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
      if (order.status !== 'ready_for_pickup') {
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
          status: 'ready_for_pickup',
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
        status: 'ready_for_pickup',
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
    if (order.status !== 'ready_for_pickup') {
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

// ────────────────────────────────────────────────────────────────────
// PR 49 — Delivery partner foreground-only location report.
//
// Auth: delivery role only (mirrors `setDeliveryStatus`).
//
// Writes `users/{uid}.currentLocation` + `currentLocationUpdatedAt`
// so PR 50's order-ready push trigger can filter pushes to nearby
// partners. PR 49 itself does NOT round-trip the dashboard sort
// through this callable — the sort uses the live client GPS
// directly. We still write here on every focus capture so PR 50 has
// fresh data the moment it ships.
//
// Strict lat/lng range checks (-90..90 / -180..180) catch a forged
// or wildly wrong client payload before it pollutes Firestore.
// Numbers must be FINITE — `Number.isFinite(NaN | Infinity) === false`
// — to prevent NaN-poisoned haversine math downstream.
//
// `currentLocation` + `currentLocationUpdatedAt` are added to the
// profile-projection strip-list (see `PROFILE_INTERNAL_FIELDS`
// below) so `getMyProfile` and the other profile readers never
// leak the partner's location to the customer-side surface area.
// ────────────────────────────────────────────────────────────────────
export const reportDeliveryLocation = onCall<{ lat: number; lng: number }>(
  { cors: true, enforceAppCheck: false },
  async request => {
    const { uid } = requireDeliveryRole(request);
    const lat = request.data?.lat;
    const lng = request.data?.lng;
    if (
      typeof lat !== 'number' ||
      !Number.isFinite(lat) ||
      lat < -90 ||
      lat > 90 ||
      typeof lng !== 'number' ||
      !Number.isFinite(lng) ||
      lng < -180 ||
      lng > 180
    ) {
      throw new HttpsError('invalid-argument', 'lat/lng out of range');
    }
    await db.doc(`users/${uid}`).set(
      {
        // Mirror `isDelivery` like `setDeliveryStatus` does so the
        // PR 50 push-fanout query (`isDelivery==true`) keeps working
        // even if the partner reports location before they toggle
        // online. Cheap and idempotent.
        isDelivery: true,
        currentLocation: { lat, lng },
        currentLocationUpdatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
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
    // Fire only on the transition INTO ready_for_pickup, not on
    // subsequent updates (pickup / delivery) of the same order.
    if (
      before.status === 'ready_for_pickup' ||
      after.status !== 'ready_for_pickup'
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
    // PR 41 — route to the dedicated Android channel so admins can
    // mute admin alerts independently of order alerts. iOS ignores
    // channelId; web push uses its own routing. Channel is created
    // client-side in pushService.registerForPushNotifications.
    channelId: 'admin-alerts' as const,
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
      registrationData?: {
        kycDocs?: {
          storefront?: { storagePath?: unknown } | null;
          [k: string]: unknown;
        };
      };
      // PR 47 — present on shops re-approved after a previous
      // suspend cycle (the owner may have already configured tiers
      // before suspension); we preserve them rather than re-seeding
      // the default and silently overwriting their pricing.
      deliveryChargeTiers?: DeliveryChargeTier[];
      // PR 48 — preserve a previously-customized service radius
      // across a re-approval (same posture as `deliveryChargeTiers`).
      serviceRadiusKm?: number;
    };
    if (shop.status !== 'pending') {
      throw new HttpsError(
        'failed-precondition',
        `Shop is ${shop.status}, not pending`,
      );
    }

    // PR 42 — Wire the storefront photo from the KYC upload into the
    // customer-facing `shop.imageUrl`. The storage path was captured
    // during RegisterShop step 2 (PR 31, via `recordShopKycUpload`)
    // and lives at `registrationData.kycDocs.storefront.storagePath`
    // (NOT a separate `pendingData` collection — see comment in
    // `approveShopHelpers.ts`). Pre-PR-42 the URL never landed on
    // the doc and customers saw the 🏪 placeholder for every
    // newly-registered shop (PR 41 hotfix).
    //
    // Long-expiry signed URL (10y) — non-sensitive shop branding
    // displayed on every shop list render, no benefit from per-call
    // rotation. Same `getStorage().bucket().file().getSignedUrl()`
    // pattern as `getShopKycReadUrls` and `getMenuImageUploadUrl`.
    //
    // Non-fatal — if the storefront path is missing (legacy shop,
    // RegisterShop client predating PR 42's mandatory gate) or the
    // signing call rejects, we leave `imageUrl` empty and the
    // approval still succeeds. The customer card falls back to the
    // 🏪 placeholder; the shop owner can re-upload via
    // WaitingForApproval and an admin can re-approve to refresh
    // the URL.
    let storefrontImageUrl: string | undefined;
    const storefrontPath = pickStorefrontPath(shop);
    if (storefrontPath) {
      try {
        // PR 42.0.1 — Firebase download-token URL pattern. Set a
        // fresh `firebaseStorageDownloadTokens` metadata value on
        // the file, then construct the permanent token URL. No
        // expiry (unlike V4 signed URLs which cap at 7 days and
        // broke the original PR 42 implementation).
        const bucket = getStorage().bucket();
        const file = bucket.file(storefrontPath);
        const token = randomUUID();
        await file.setMetadata({
          metadata: { firebaseStorageDownloadTokens: token },
        });
        storefrontImageUrl = buildFirebaseStorageDownloadUrl(
          bucket.name,
          storefrontPath,
          token,
        );
      } catch (e) {
        // PR 42 followup (May 26 2026): the original PR 42 catch
        // used `console.warn` with just the error, which was
        // unsearchable in Cloud Logging when a real signing failure
        // happened during the first pilot smoke test. Upgrade to
        // `console.error` + structured fields so a log query like
        // `severity=ERROR jsonPayload.event="approveShop.signing-failed"`
        // surfaces the failure immediately. Still non-fatal —
        // approval proceeds and the shop card falls back to 🏪.
        console.error('[approveShop] storefront signed URL failed', {
          event: 'approveShop.signing-failed',
          shopId,
          storefrontPath,
          ownerUid: shop.ownerUid,
          err: e instanceof Error ? e.message : String(e),
          stack: e instanceof Error ? e.stack : undefined,
        });
        // Leave undefined → falls through to empty imageUrl below.
        // The admin can recover via the `regenerateShopImageUrl`
        // callable (PR 42 followup) which throws on signing failure
        // rather than swallowing — that's the diagnostic path.
      }
    } else {
      // PR 42 followup — make this branch visible too. If a shop
      // gets approved with no storefront path we want to see WHY
      // (legacy pre-PR-42 shop? client bypassed the mandatory
      // gate?) rather than silently shipping with imageUrl: ''.
      console.warn('[approveShop] storefront path missing on doc', {
        event: 'approveShop.no-storefront-path',
        shopId,
        ownerUid: shop.ownerUid,
      });
    }

    const now = Date.now();
    // PR 47 — seed the default delivery-charge tier table on
    // approve. Skipped when the doc already has tiers (re-approval
    // after a suspend cycle, or a manually-edited shop) so we
    // never silently overwrite an owner's pricing. New shops get
    // working tiers immediately; the owner can customize via Shop
    // Settings → Delivery charges.
    const seedTiers =
      Array.isArray(shop.deliveryChargeTiers) &&
      shop.deliveryChargeTiers.length > 0
        ? null
        : DEFAULT_DELIVERY_CHARGE_TIERS;
    // PR 48 — seed the default service radius alongside the tier
    // table. Same "only seed when absent" posture so a re-approval
    // after a suspend cycle never overwrites a previously-customized
    // radius. The seed constant lives in `geoVisibilityHelpers` so
    // it can never drift from the filter's fallback default.
    const seedRadius =
      typeof shop.serviceRadiusKm === 'number' && shop.serviceRadiusKm > 0
        ? null
        : DEFAULT_SERVICE_RADIUS_KM;

    await shopRef.update({
      status: 'active',
      approvedAt: now,
      approvedBy: auth.uid,
      // PR 42 — only stamp imageUrl when we actually minted one.
      // FieldValue.delete() would be wrong (it'd erase a re-approval's
      // older URL on signing failure); skipping the field on failure
      // preserves whatever was there before.
      ...(storefrontImageUrl ? { imageUrl: storefrontImageUrl } : {}),
      ...(seedTiers ? { deliveryChargeTiers: seedTiers } : {}),
      ...(seedRadius != null ? { serviceRadiusKm: seedRadius } : {}),
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

    // PR 8 — audit log (non-fatal).
    await writeAuditLog({
      actorUid: auth.uid,
      actorRole: 'admin',
      actionType: 'shop.approve',
      targetType: 'shop',
      targetId: shopId,
      targetSummary: shop.name,
      metadata: { ownerUid: shop.ownerUid },
    });

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

    // PR 8 — audit log (non-fatal).
    await writeAuditLog({
      actorUid: auth.uid,
      actorRole: 'admin',
      actionType: 'shop.reject',
      targetType: 'shop',
      targetId: shopId,
      targetSummary: shop.name,
      reason,
      metadata: { ownerUid: shop.ownerUid },
    });

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

    // PR 48 §I — claim-authoritative read path.
    //
    // Symptom this fixes: owner edits delivery-charge tiers → save
    // succeeds → re-opens the screen → tier values revert to the
    // admin-default seed.
    //
    // Root cause: the previous ownerUid-query + orderBy(updatedAt)
    // path could resolve to a DIFFERENT doc than the writer used
    // (`updateShopDeliveryTiers` and `updateShopSettings` both key
    // by `shops/{claims.shopId}`). Combined with the now-fixed
    // mixed-type `updatedAt` (Date.now number vs serverTimestamp
    // Timestamp), the ordering returned a stale sibling for owners
    // with more than one shop doc.
    //
    // Fix: when the caller has a `shopId` custom claim (the only way
    // an OWNER reaches an approved-shop screen), read that exact doc
    // directly. The ownerUid-query fallback is preserved ONLY for
    // pending owners (pre-approval, no claim yet — the
    // `WaitingForApproval` screen relies on it).
    const claimShopId =
      typeof auth.token?.shopId === 'string' && auth.token.shopId.length > 0
        ? (auth.token.shopId as string)
        : null;

    if (claimShopId) {
      const direct = await db.doc(`shops/${claimShopId}`).get();
      if (!direct.exists) {
        // Claim points at a missing doc — fall through to the query
        // path rather than return null, so a freshly-suspended /
        // re-pending shop still appears on WaitingForApproval.
        console.warn('[getMyShop] claim.shopId points at missing doc', {
          uid: auth.uid,
          claimShopId,
        });
      } else {
        const data = direct.data() as Record<string, any>;
        // PR 48 §I diag — TEMPORARY. Remove in the same PR once
        // Sudhir confirms the tier-save repro now sticks. The log
        // lets us verify on live data which path resolved the read.
        console.info('[getMyShop] resolved via claim.shopId', {
          uid: auth.uid,
          shopId: claimShopId,
          hasTiers: Array.isArray(data.deliveryChargeTiers),
          tierCount: Array.isArray(data.deliveryChargeTiers)
            ? data.deliveryChargeTiers.length
            : 0,
          updatedAtType: typeof data.updatedAt,
        });
        return {
          ...data,
          createdAt:
            data.createdAt?.toMillis?.() ?? data.createdAt ?? null,
          updatedAt:
            data.updatedAt?.toMillis?.() ?? data.updatedAt ?? null,
        };
      }
    }

    // Fallback: pending / no-claim owner. Same query as before but
    // we log multiplicity so we can confirm post-fix that no claimed
    // owner is hitting this path.
    const snap = await db
      .collection('shops')
      .where('ownerUid', '==', auth.uid)
      .where('status', 'in', ['pending', 'active', 'rejected'])
      .orderBy('updatedAt', 'desc')
      .limit(1)
      .get();
    if (snap.empty) return null;
    const data = snap.docs[0].data() as Record<string, any>;
    // PR 48 §I diag — TEMPORARY (remove with the block above once
    // verified). Captures the multi-doc / mixed-updatedAt-type
    // pattern that originally surfaced the bug.
    console.info('[getMyShop] resolved via ownerUid fallback', {
      uid: auth.uid,
      hadClaimShopId: !!claimShopId,
      docId: snap.docs[0].id,
      hasTiers: Array.isArray(data.deliveryChargeTiers),
      updatedAtType: typeof data.updatedAt,
    });
    return {
      ...data,
      createdAt: data.createdAt?.toMillis?.() ?? data.createdAt ?? null,
      updatedAt: data.updatedAt?.toMillis?.() ?? data.updatedAt ?? null,
    };
  },
);

// ────────────────────────────────────────────────────────────
// Delivery-partner approval flow (PR 1 — security hardening)
// ────────────────────────────────────────────────────────────
//
// Replaces the self-service becomeDelivery callable (deleted, see
// comment block above mergeCustomClaims). Mirrors the shop-
// registration approval flow:
//   user submits form → requestDeliveryRole writes
//   deliveryRequests/{uid} with status pending → admin reviews via
//   listPendingDeliveryRequests → admin calls approveDeliveryRole
//   (sets `delivery` custom claim + mirrors to users/{uid}) or
//   rejectDeliveryRole (writes reason; user can resubmit).
//
// The user-side polling callable is getMyDeliveryRequest, which
// returns the caller's own request doc or null. Matches the
// getMyShop / WaitingForApprovalScreen posture.

type DeliveryRequestDoc = {
  uid: string;
  phone: string;
  name?: string;
  vehicleType?: string;
  city?: string;
  submittedAt: number;
  status: 'pending' | 'approved' | 'rejected';
  approvedAt?: number;
  approvedBy?: string;
  rejectedAt?: number;
  rejectedBy?: string;
  rejectedReason?: string;
};

export const requestDeliveryRole = onCall<{
  name?: string;
  vehicleType?: string;
  city?: string;
}>(
  { cors: true, enforceAppCheck: false },
  async request => {
    // First-pass auth + claim check (cheap). Firestore lookup
    // for an existing pending doc happens AFTER we know the caller
    // is signed in and isn't already a delivery partner.
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in required');
    }
    if (request.auth.token?.delivery === true) {
      throw new HttpsError(
        'failed-precondition',
        'You are already a delivery partner.',
      );
    }

    const uid = request.auth.uid;
    const reqRef = db.doc(`deliveryRequests/${uid}`);
    const existing = await reqRef.get();
    const hasExistingPendingRequest =
      existing.exists && existing.data()?.status === 'pending';

    const result = validateRequestDeliveryRole({
      auth: request.auth,
      name: request.data?.name,
      vehicleType: request.data?.vehicleType,
      city: request.data?.city,
      hasExistingPendingRequest,
    });
    if (!result.ok) {
      throw new HttpsError(result.code, result.message);
    }

    const now = Date.now();
    const phone =
      typeof request.auth.token?.phone_number === 'string'
        ? request.auth.token.phone_number
        : '';

    const doc: DeliveryRequestDoc = {
      uid,
      phone,
      submittedAt: now,
      status: 'pending',
      ...(result.form.name !== undefined && { name: result.form.name }),
      ...(result.form.vehicleType !== undefined && {
        vehicleType: result.form.vehicleType,
      }),
      ...(result.form.city !== undefined && { city: result.form.city }),
    };

    // Overwrite any prior rejected/approved doc — the user is
    // resubmitting after rejection (legitimate flow) or re-applying
    // after their claim was revoked admin-side (rare). The
    // helper's "already approved" guard relies on the claim check
    // above, not the doc state, so an approved-but-revoked user
    // CAN resubmit and that's the intended behaviour.
    await reqRef.set(doc);

    // Best-effort admin notification — non-fatal if push fails.
    pushToAdmins(
      '🛵 New delivery partner request',
      `${result.form.name ?? phone ?? uid} wants to deliver`,
      { uid, type: 'delivery_request_pending' },
    ).catch(e =>
      console.warn('[requestDeliveryRole] pushToAdmins failed:', e),
    );

    return { ok: true };
  },
);

export const approveDeliveryRole = onCall<{ uid: string }>(
  { cors: true, enforceAppCheck: false },
  async request => {
    const targetUid = request.data?.uid;
    const reqRef =
      typeof targetUid === 'string' && targetUid.length > 0
        ? db.doc(`deliveryRequests/${targetUid}`)
        : null;
    const snap = reqRef ? await reqRef.get() : null;
    const currentStatus = (snap?.exists
      ? (snap.data() as DeliveryRequestDoc).status
      : null) as 'pending' | 'approved' | 'rejected' | null;

    const result = canApproveDeliveryRequest({
      auth: request.auth,
      targetUid,
      currentRequestStatus: currentStatus,
    });
    if (!result.ok) {
      throw new HttpsError(result.code as any, result.message);
    }

    const now = Date.now();
    await reqRef!.update({
      status: 'approved',
      approvedAt: now,
      approvedBy: result.adminUid,
    });

    // Grant the delivery claim. Mirror onto users/{uid} so future
    // queries (online-count, push fan-out) can find delivery
    // partners without scanning Auth.
    await mergeCustomClaims(result.targetUid, { delivery: true });
    await db.doc(`users/${result.targetUid}`).set(
      { isDelivery: true },
      { merge: true },
    );

    pushToUser(
      result.targetUid,
      '✅ You are approved as a delivery partner',
      'Open the app and head to the Delivery Dashboard to start picking up orders.',
      { type: 'delivery_request_approved' },
    ).catch(e =>
      console.warn('[approveDeliveryRole] pushToUser failed:', e),
    );

    // PR 8 — audit log (non-fatal).
    await writeAuditLog({
      actorUid: result.adminUid,
      actorRole: 'admin',
      actionType: 'delivery_request.approve',
      targetType: 'delivery_request',
      targetId: result.targetUid,
    });

    return { ok: true };
  },
);

export const rejectDeliveryRole = onCall<{ uid: string; reason: string }>(
  { cors: true, enforceAppCheck: false },
  async request => {
    const targetUid = request.data?.uid;
    const reqRef =
      typeof targetUid === 'string' && targetUid.length > 0
        ? db.doc(`deliveryRequests/${targetUid}`)
        : null;
    const snap = reqRef ? await reqRef.get() : null;
    const currentStatus = (snap?.exists
      ? (snap.data() as DeliveryRequestDoc).status
      : null) as 'pending' | 'approved' | 'rejected' | null;

    const result = canRejectDeliveryRequest({
      auth: request.auth,
      targetUid,
      currentRequestStatus: currentStatus,
      reason: request.data?.reason,
    });
    if (!result.ok) {
      throw new HttpsError(result.code as any, result.message);
    }

    const now = Date.now();
    await reqRef!.update({
      status: 'rejected',
      rejectedAt: now,
      rejectedBy: result.adminUid,
      rejectedReason: result.reason,
    });

    pushToUser(
      result.targetUid,
      '❌ Delivery partner request not approved',
      result.reason,
      { type: 'delivery_request_rejected' },
    ).catch(e =>
      console.warn('[rejectDeliveryRole] pushToUser failed:', e),
    );

    // PR 8 — audit log (non-fatal).
    await writeAuditLog({
      actorUid: result.adminUid,
      actorRole: 'admin',
      actionType: 'delivery_request.reject',
      targetType: 'delivery_request',
      targetId: result.targetUid,
      reason: result.reason,
    });

    return { ok: true };
  },
);

export const listPendingDeliveryRequests = onCall(
  { cors: true, enforceAppCheck: false },
  async request => {
    const auth = requireAdminCaller({ auth: request.auth });
    if (!auth.ok) {
      throw new HttpsError(auth.code, auth.message);
    }
    // Composite index: status asc + submittedAt asc (FIFO). Pinned
    // in firestore.indexes.json so the deploy fails closed if missing.
    const snap = await db
      .collection('deliveryRequests')
      .where('status', '==', 'pending')
      .orderBy('submittedAt', 'asc')
      .limit(50)
      .get();
    return snap.docs.map(d => d.data() as DeliveryRequestDoc);
  },
);

// Caller's own request doc, or null. No admin check — every signed-in
// user can read their own. Mirrors getMyShop's contract.
export const getMyDeliveryRequest = onCall(
  { cors: true, enforceAppCheck: false },
  async request => {
    const auth = request.auth;
    if (!auth) throw new HttpsError('unauthenticated', 'Sign in required');
    const snap = await db.doc(`deliveryRequests/${auth.uid}`).get();
    if (!snap.exists) return null;
    return snap.data() as DeliveryRequestDoc;
  },
);

// ────────────────────────────────────────────────────────────
// PR 41 — Pending-approval counts for HomeScreen badges
// ────────────────────────────────────────────────────────────
//
// Single callable that serves three different consumers in one round
// trip, projecting onto whatever the caller's role/claims authorise:
//   - Admin → `{ shopCount, deliveryCount }` (badges next to the
//     "Pending Shop Approvals" + "Delivery requests" rows + screen
//     headers).
//   - Shop owner → `{ pendingOrderCount }` (badge next to "Shop
//     Dashboard" row — "N orders need your attention").
//   - Anyone else → all zeros. We deliberately do NOT throw
//     permission-denied for plain customers because the badge UI
//     polls this on every HomeScreen mount; a 403 in Sentry on
//     every customer launch would be pure noise.
//
// Pure helpers (`projectPendingCounts`, `countPendingDocs`,
// `capPendingCount`) live in `./pendingCountsHelpers.ts` so the
// counting + projection logic is unit-testable without firebase-admin.
// This file owns the Firestore IO.
//
// Cost shape: at most three Firestore queries per call (admin shop
// queue + admin delivery queue + this-shop-owner pending orders),
// each capped at 200 docs to bound read cost in pathological cases
// (a runaway test fixture, a forgotten admin shift). The badge UI
// caps display at "99+" anyway, so the hard cap is generous.
export const getPendingApprovalCounts = onCall(
  { cors: true, enforceAppCheck: false },
  async request => {
    const auth = request.auth;
    if (!auth) {
      // Unauthenticated callers are the only ones we 401 — every
      // signed-in user can poll, even if every count comes back zero.
      throw new HttpsError('unauthenticated', 'Sign in required');
    }
    const claims = (auth.token ?? {}) as {
      admin?: unknown;
      shopOwner?: unknown;
      shopId?: unknown;
    };
    const isAdmin = claims.admin === true;
    const isShopOwner = claims.shopOwner === true;
    const shopId =
      typeof claims.shopId === 'string' && claims.shopId.length > 0
        ? (claims.shopId as string)
        : undefined;

    // Defaults — non-authorised buckets stay zero. `projectPendingCounts`
    // belt-and-braces this projection at the end too, but skipping the
    // Firestore query when we know the bucket will be zeroed saves a
    // network round trip + a small amount of read quota.
    let shopCount = 0;
    let deliveryCount = 0;
    let pendingOrderCount = 0;

    if (isAdmin) {
      try {
        const [shopSnap, deliverySnap] = await Promise.all([
          // Pending shop registrations live in the `shops` collection
          // with `status === 'pending'` — same source `listPendingShops`
          // reads from. No separate `pendingShopRequests` collection
          // (PR 41 prompt was wrong on the name; mirrors the
          // `deliveryRequests` correction baked into the prompt's own
          // "Important corrections" section).
          db
            .collection('shops')
            .where('status', '==', 'pending')
            .limit(200)
            .get(),
          db
            .collection('deliveryRequests')
            .where('status', '==', 'pending')
            .limit(200)
            .get(),
        ]);
        shopCount = countPendingDocs(shopSnap.docs);
        deliveryCount = countPendingDocs(deliverySnap.docs);
      } catch (e) {
        // Logged but not surfaced. A partial response is better than
        // a hard failure that hides the OTHER bucket too.
        console.warn('[getPendingApprovalCounts] admin queue read failed:', e);
      }
    }

    if (isShopOwner && shopId) {
      try {
        // Filter shape — pinned to match ShopOwnerDashboardScreen's
        // existing "Pending" stat card (computed client-side at
        // `src/screens/shop/ShopOwnerDashboardScreen.tsx:195` as
        // `o.status === 'pending'`). The OrderStatus state machine
        // is `pending → accepted → preparing → ready_for_pickup →
        // delivered` (`cancelled` terminal); only the `pending`
        // state means "shop owner has not yet decided
        // accept/reject" so it's the right "needs your initial
        // attention" semantics for the badge. If a future PR
        // broadens the badge to mean "needs ANY shop owner action"
        // (e.g. include `accepted` so the badge prompts the move to
        // `preparing`), this filter AND the dashboard stat MUST
        // change together — otherwise the badge count would
        // diverge from what the owner sees on tap-through.
        //
        // Single-shop scoping — Phase 12a constraint
        // ("one shop per user", see the policy block at
        // `mergeCustomClaims` upstream): `claims.shopId` is a
        // single string, not an array. If a future PR opens up
        // multi-shop ownership, the claim shape will change
        // (probably `shopIds: string[]`) and this query needs to
        // become a `where('shopId', 'in', shopIds)` plus per-shop
        // count breakdown in the response. The hook + badge UI on
        // HomeScreen would then aggregate or surface per-shop.
        const orderSnap = await db
          .collection('orders')
          .where('shopId', '==', shopId)
          .where('status', '==', 'pending')
          .limit(200)
          .get();
        pendingOrderCount = countPendingDocs(orderSnap.docs);
      } catch (e) {
        console.warn(
          '[getPendingApprovalCounts] shop-owner pending orders read failed:',
          e,
        );
      }
    }

    const projected = projectPendingCounts(
      { isAdmin, isShopOwner, shopId },
      { shopCount, deliveryCount, pendingOrderCount },
    );

    return {
      shopCount: capPendingCount(projected.shopCount),
      deliveryCount: capPendingCount(projected.deliveryCount),
      pendingOrderCount: capPendingCount(projected.pendingOrderCount),
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

    // PR 8 — audit log (non-fatal). Promotes the console.log
    // statusHistory to a queryable Firestore collection.
    await writeAuditLog({
      actorUid: auth.uid,
      actorRole: 'admin',
      actionType: 'user.revoke_shop_owner',
      targetType: 'user',
      targetId: uid,
      reason,
      metadata: { shopIdAffected: shopId ?? null },
    });

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
    // already paid. The status stays ready_for_pickup; the
    // listAvailableDeliveries query treats deliveryPersonId==null as
    // "available" so this re-enters the pickup pool.
    const inflightSnap = await db
      .collection('orders')
      .where('deliveryPersonId', '==', uid)
      .where('status', '==', 'ready_for_pickup')
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

    // PR 8 — audit log (non-fatal).
    await writeAuditLog({
      actorUid: auth.uid,
      actorRole: 'admin',
      actionType: 'user.revoke_delivery',
      targetType: 'user',
      targetId: uid,
      reason,
      metadata: { reassignedOrders: reassignedOrderIds.length },
    });

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

    // PR 8 — audit log (non-fatal).
    await writeAuditLog({
      actorUid: auth.uid,
      actorRole: 'admin',
      actionType: 'shop.suspend',
      targetType: 'shop',
      targetId: shopId,
      targetSummary: shop.name,
      reason,
      metadata: { ownerUid: shop.ownerUid ?? null },
    });

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

    // PR 8 — audit log (non-fatal).
    await writeAuditLog({
      actorUid: auth.uid,
      actorRole: 'admin',
      actionType: 'shop.unsuspend',
      targetType: 'shop',
      targetId: shopId,
      targetSummary: shop.name,
      metadata: { ownerUid: shop.ownerUid ?? null },
    });

    return { ok: true };
  },
);

// PR 42 followup (May 26 2026): `approveShop` swallows storefront
// signing failures behind a try/catch so that a transient signing
// outage doesn't block shop approval — admin can still mark the
// shop active and customers see the 🏪 placeholder until recovery.
// But the original PR 42 had no recovery path: once a shop was
// approved with `imageUrl: ''`, `approveShop` refused to re-run
// (failed-precondition: shop is active, not pending). This
// callable IS that recovery path.
//
// Re-runs the storefront → signed URL → imageUrl write on an
// active shop. Admin-only. Unlike `approveShop`'s silent catch,
// THIS callable throws `internal` with the underlying error
// message so the admin sees the actual cause (typically missing
// `iam.serviceAccounts.signBlob` self-binding on the compute
// service account — the classic Cloud Functions signing gotcha).
//
// Also useful when the storefront photo is re-uploaded
// post-approval (a future flow): admin taps "Regenerate image"
// to mint a fresh URL against the new path.
export const regenerateShopImageUrl = onCall<{ shopId: string }>(
  { cors: true, enforceAppCheck: false },
  async request => {
    const auth = request.auth;
    if (!auth) throw new HttpsError('unauthenticated', 'Sign in required');
    if (auth.token?.admin !== true) {
      throw new HttpsError('permission-denied', 'Admin role required');
    }

    const shopId = request.data?.shopId;
    if (typeof shopId !== 'string' || shopId.length === 0) {
      throw new HttpsError('invalid-argument', 'shopId required');
    }

    const shopRef = db.doc(`shops/${shopId}`);
    const shopSnap = await shopRef.get();
    if (!shopSnap.exists) {
      throw new HttpsError('not-found', 'Shop not found');
    }
    const shop = shopSnap.data() as {
      status?: string;
      ownerUid?: string;
      name?: string;
      imageUrl?: string;
      registrationData?: {
        kycDocs?: {
          storefront?: { storagePath?: unknown } | null;
          [k: string]: unknown;
        };
      };
    };

    // Same path-extraction helper `approveShop` uses — guarantees
    // both callables agree on what "the storefront photo" means.
    const storefrontPath = pickStorefrontPath(shop);
    if (!storefrontPath) {
      throw new HttpsError(
        'failed-precondition',
        'Shop has no storefront photo uploaded. The owner must upload one via RegisterShop step 2 first.',
      );
    }

    let storefrontImageUrl: string;
    try {
      // Same Firebase download-token pattern as approveShop. Each
      // call mints a FRESH token, which invalidates any prior URL
      // for the same file — useful as a kill-switch if a stale
      // URL leaked. The new token is the only one returned in
      // the metadata, so the old URL stops resolving once this
      // setMetadata write lands.
      const bucket = getStorage().bucket();
      const file = bucket.file(storefrontPath);
      const token = randomUUID();
      await file.setMetadata({
        metadata: { firebaseStorageDownloadTokens: token },
      });
      storefrontImageUrl = buildFirebaseStorageDownloadUrl(
        bucket.name,
        storefrontPath,
        token,
      );
    } catch (e) {
      // Surface the actual signing error to the admin caller —
      // opposite posture from approveShop, which swallows. The
      // admin needs to SEE the IAM / quota / bucket issue so it
      // can be fixed at the platform layer.
      const message =
        e instanceof Error ? e.message : 'Unknown signing error';
      console.error('[regenerateShopImageUrl] signing failed', {
        event: 'regenerateShopImageUrl.signing-failed',
        shopId,
        storefrontPath,
        err: message,
        stack: e instanceof Error ? e.stack : undefined,
      });
      throw new HttpsError(
        'internal',
        `Failed to mint signed URL for storefront: ${message}. Check Cloud Run service account has iam.serviceAccounts.signBlob on itself.`,
      );
    }

    await shopRef.update({
      imageUrl: storefrontImageUrl,
      updatedAt: FieldValue.serverTimestamp(),
    });

    // PR 8 — audit log (non-fatal). Captures whether this was a
    // first-time fix or a re-mint of an already-populated URL.
    await writeAuditLog({
      actorUid: auth.uid,
      actorRole: 'admin',
      actionType: 'shop.regenerate-image-url',
      targetType: 'shop',
      targetId: shopId,
      targetSummary: shop.name,
      metadata: {
        ownerUid: shop.ownerUid ?? null,
        priorImageUrlEmpty: !shop.imageUrl,
        storefrontPath,
      },
    }).catch(e =>
      console.warn('[regenerateShopImageUrl] writeAuditLog failed:', e),
    );

    return { ok: true, imageUrl: storefrontImageUrl };
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

    // PR 42.1 — augment delivery users with rolling-rating stats
    // from the `users/{uid}` Firestore mirror. Auth alone doesn't
    // carry the rating (it lives on the Firestore doc, written by
    // `submitOrderRating`'s multi-write transaction). We only
    // fetch docs for users who actually have the delivery claim —
    // saves up to ~95 reads per call at MVP scale (100 users, ~5
    // delivery partners). Reads run in parallel.
    const deliveryUsers = result.users.filter(
      u =>
        ((u.customClaims ?? {}) as Record<string, unknown>).delivery ===
        true,
    );
    const ratingByUid = new Map<
      string,
      { deliveryRatingAvg?: number; deliveryRatingCount?: number }
    >();
    if (deliveryUsers.length > 0) {
      const snaps = await Promise.all(
        deliveryUsers.map(u => db.doc(`users/${u.uid}`).get()),
      );
      for (let i = 0; i < deliveryUsers.length; i++) {
        const snap = snaps[i];
        if (!snap.exists) continue;
        const data = snap.data() as any;
        ratingByUid.set(deliveryUsers[i].uid, {
          deliveryRatingAvg:
            typeof data?.deliveryRatingAvg === 'number'
              ? data.deliveryRatingAvg
              : undefined,
          deliveryRatingCount:
            typeof data?.deliveryRatingCount === 'number'
              ? data.deliveryRatingCount
              : undefined,
        });
      }
    }

    return result.users.map(u => {
      const claims = (u.customClaims ?? {}) as Record<string, unknown>;
      const rating = ratingByUid.get(u.uid);
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
        // PR 42.1 — undefined for non-delivery users; undefined or
        // populated for delivery users depending on whether the
        // Firestore mirror has rating fields yet.
        deliveryRatingAvg: rating?.deliveryRatingAvg,
        deliveryRatingCount: rating?.deliveryRatingCount,
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

// Phase 12c: count of delivery partners currently marked online,
// used by the AdminOrdersScreen stats card. Admin-only. The query
// is two equality filters with no orderBy → no composite index is
// required (Firestore intersects single-field indexes). The same
// pair is also used by sendNewPickupPushToDelivery, so the field
// is already indexed by ambient single-field defaults.
export const getOnlineDeliveryCount = onCall(
  { cors: true, enforceAppCheck: false },
  async request => {
    const result = await computeOnlineDeliveryCount({
      auth: request.auth,
      fetchCount: async () => {
        const snap = await db
          .collection('users')
          .where('isDelivery', '==', true)
          .where('deliveryStatus', '==', 'online')
          .get();
        return snap.size;
      },
    });
    if (!result.ok) {
      throw new HttpsError(result.code, result.message);
    }
    return { count: result.count };
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

// PR 32 — VALID_CATEGORIES moved to a dedicated module
// (`categoryConstants.ts`) so menuExtractionHelpers + the new
// extraction callables can import the same whitelist instead of
// duplicating the literal. The behavior is unchanged from the
// original local Set; `addCustomMenuItem` below validates against
// this same import.

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
      } else if (k === 'name' || k === 'packLabel') {
        if (typeof v !== 'string' || (k === 'name' && !v.trim())) {
          throw new HttpsError('invalid-argument', `${k} must be a non-empty string`);
        }
      } else if (k === 'imageUrl') {
        // PR 6 — tighten imageUrl: must be empty (clears the field —
        // server falls back to the placeholder in addCustomMenuItem
        // semantics) or a Storage CDN URL. Rejects external URLs.
        const valid = validateMenuImageUrl(v);
        if (!valid.ok) {
          throw new HttpsError('invalid-argument', valid.reason);
        }
        // Normalize: empty/null collapses to a placeholder string so
        // the on-disk doc field stays a non-empty string (existing
        // schema). Concrete URL passes through trimmed.
        update[k] =
          valid.url ?? 'https://placehold.co/400x400/e2e8f0/64748b?text=Custom+Item';
        continue;
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

// ────────────────────────────────────────────────────────────────────
// PR 5 — Shop owner self-service settings.
//
// Two business parameters (deliveryFee, minOrder) can now be edited
// in-app by shop owners. Previously they were set only via the
// initial seed or by the platform operator editing Firestore Console
// docs — didn't scale past ~2 shops.
//
// Auth + validation rules live in shopSettingsHelpers.ts so they're
// unit-testable without firebase-admin. This wrapper is a thin
// throw-or-write layer over the helper's tagged-union result.
//
// Out of scope (deliberately): hours, GST, FSSAI, address — those
// flow through `registerShop` and need a separate edit-registration
// surface. See PR 5 prompt "Scope (out)".
// ────────────────────────────────────────────────────────────────────
export const updateShopSettings = onCall<{
  // Optional. REQUIRED for admin callers (their claim has no shopId);
  // IGNORED for shopOwner callers (their claim is the source of truth).
  // The helper enforces this branching so a malicious shop owner
  // client can't target another shop's settings even if they pass a
  // shopId.
  shopId?: string;
  deliveryFee?: number;
  minOrder?: number;
  // PR 49 §F — bundled fix for a PR 48 regression. The validator
  // (`shopSettingsHelpers`) was updated for `serviceRadiusKm` but
  // this wrapper's request type wasn't, so a radius-only payload
  // arrived at the validator with all three fields undefined and
  // tripped the "at least one of …" guard. Adding it here + below.
  serviceRadiusKm?: number;
}>(
  { cors: true, enforceAppCheck: false },
  async request => {
    // Cast: firebase-functions' AuthData has a `DecodedIdToken` shape
    // for `token`; the helper only inspects admin/shopOwner/shopId and
    // declares the narrow shape for testability without pulling
    // firebase-functions into the unit-test surface. The runtime
    // shape matches.
    const validated = validateShopSettings({
      auth: request.auth
        ? ({
            uid: request.auth.uid,
            token: request.auth.token as unknown as {
              admin?: unknown;
              shopOwner?: unknown;
              shopId?: unknown;
            },
          })
        : null,
      shopId: request.data?.shopId,
      deliveryFee: request.data?.deliveryFee,
      minOrder: request.data?.minOrder,
      // PR 49 §F — see note on the onCall generic above.
      serviceRadiusKm: request.data?.serviceRadiusKm,
    });
    if (!validated.ok) {
      throw new HttpsError(validated.code, validated.message);
    }
    const { shopId, updates } = validated;
    // shopId comes from validated.shopId — for shopOwner callers this
    // is the claim's shopId (request body shopId is ignored), for
    // admin callers it's the validated request body shopId. The helper
    // enforces both branches; this wrapper trusts the validated result.
    // Read the BEFORE state so the audit log can record what
    // changed. This is one extra read per call which is fine —
    // settings updates are rare. If this gets noisy, batch with
    // the update via runTransaction.
    const beforeSnap = await db.doc(`shops/${shopId}`).get();
    const beforeData = beforeSnap.data() as
      | {
          deliveryFee?: number;
          minOrder?: number;
          // PR 49 §F — include in the snapshot so a radius change
          // shows a clean before/after diff in the audit log.
          serviceRadiusKm?: number;
          name?: string;
        }
      | undefined;
    const before = {
      deliveryFee: beforeData?.deliveryFee,
      minOrder: beforeData?.minOrder,
      serviceRadiusKm: beforeData?.serviceRadiusKm,
    };

    await db.doc(`shops/${shopId}`).update({
      ...updates,
      // PR 48 — type-consistent timestamp. Previously `Date.now()`
      // (a number); every other shop write uses
      // `FieldValue.serverTimestamp()` (a Timestamp). Firestore
      // orders mixed-type fields by type first, so a `Date.now()`
      // value on `updatedAt` sorted BELOW any sibling Timestamp,
      // which made `getMyShop`'s `.orderBy('updatedAt', 'desc')`
      // return a stale tier-less doc after a save. See PR 48
      // section I.
      updatedAt: FieldValue.serverTimestamp(),
    });

    // PR 8 — audit log (non-fatal). Both admin and shopOwner
    // branches write. validateShopSettings doesn't expose role on
    // its `ok: true` shape, so we derive it from the same claim
    // check used by the helper. (Future refactor: have the helper
    // surface role explicitly.)
    const isAdmin = request.auth?.token?.admin === true;
    await writeAuditLog({
      actorUid: request.auth!.uid,
      actorRole: isAdmin ? 'admin' : 'shopOwner',
      actionType: 'shop.update_settings',
      targetType: 'shop',
      targetId: shopId,
      targetSummary: beforeData?.name,
      metadata: { before, after: updates },
    });

    return { ok: true, shopId, updates };
  },
);

// ────────────────────────────────────────────────────────────────────
// PR 47 — Shop owner edits their distance-based delivery charge tiers.
//
// Separate callable from `updateShopSettings` (which already handles
// flat `deliveryFee` + `minOrder`) because the validation surface
// is meaningfully different — a tier table requires structural
// checks (catch-all presence, ascending bands) rather than per-field
// range clamps. Keeping the callables separate also keeps the
// audit-log diff readable: a tier change shows the before/after
// tier arrays cleanly rather than mingled with unrelated numeric
// edits.
//
// Auth: shop owner only. Mirrors the `addCustomMenuItem` pattern —
// the target shop is `claims.shopId` (a malicious owner cannot
// target another shop by passing a different shopId because we
// don't read shopId from the request body).
// ────────────────────────────────────────────────────────────────────
export const updateShopDeliveryTiers = onCall<{
  tiers: DeliveryChargeTier[];
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
      throw new HttpsError(
        'failed-precondition',
        'Shop owner claim missing shopId',
      );
    }

    // Pure validation — same helper the client uses for inline
    // friendly errors. Server runs it again so a malicious or
    // out-of-date client can't bypass.
    const validated = validateDeliveryChargeTiers(request.data?.tiers);
    if (!validated.ok) {
      throw new HttpsError('invalid-argument', validated.message);
    }

    // Read BEFORE for the audit log diff (rare write — one extra
    // read is fine; same pattern as updateShopSettings).
    const beforeSnap = await db.doc(`shops/${shopId}`).get();
    const beforeData = beforeSnap.data() as
      | { deliveryChargeTiers?: DeliveryChargeTier[]; name?: string }
      | undefined;

    await db.doc(`shops/${shopId}`).update({
      deliveryChargeTiers: validated.tiers,
      // PR 48 — see note in `updateShopSettings`. Match every other
      // shop write's `updatedAt` type so the `getMyShop` orderBy
      // can't return a stale doc.
      updatedAt: FieldValue.serverTimestamp(),
    });

    await writeAuditLog({
      actorUid: auth.uid,
      actorRole: 'shopOwner',
      actionType: 'shop.update_delivery_tiers',
      targetType: 'shop',
      targetId: shopId,
      targetSummary: beforeData?.name,
      metadata: {
        before: beforeData?.deliveryChargeTiers ?? null,
        after: validated.tiers,
      },
    });

    return { ok: true, shopId, tiers: validated.tiers };
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

    // PR 6 — validate imageUrl through the shared helper. Accepts
    // undefined / empty / Storage CDN URL; rejects external hosts so
    // shop owners can't hot-link copyrighted imagery or bypass the
    // in-app upload flow. Empty / null collapses to the placeholder
    // below.
    const imageValidation = validateMenuImageUrl(imageUrl);
    if (!imageValidation.ok) {
      throw new HttpsError('invalid-argument', imageValidation.reason);
    }

    const now = Date.now();
    const rand = Math.random().toString(36).slice(2, 8);
    const menuItemId = `custom_${now}_${rand}`;
    // PR 32.1 — category-themed placeholder if no image was
    // uploaded. Keeps card layout stable AND visually differentiates
    // categories so a 60-SKU menu doesn't look uniformly grey.
    // `category` is already validated against `VALID_CATEGORIES`
    // above, so the lookup always hits the per-category map; the
    // helper's generic fallback is just defence-in-depth for
    // future schema drift.
    await db.doc(`shops/${shopId}/menu/${menuItemId}`).set({
      id: menuItemId,
      shopId,
      productId: null,
      name: trimmedName,
      imageUrl:
        imageValidation.url ?? placeholderImageForCategory(category),
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

/**
 * PR 48 — shop-visibility override. When
 * `appConfig/shopVisibility.showAllShops === true`, `listShopsPublic`
 * returns every active shop regardless of `serviceRadiusKm` (the
 * cross-city offshore-testing escape hatch documented in the old
 * `SHOW_ALL_SHOPS = true` comment block in `shopService.ts`).
 *
 * Default FALSE — a missing doc means the radius gate is ACTIVE.
 * This is the secure / production-correct default: a fresh project
 * without the doc filters out distant shops rather than accidentally
 * showing a Faridabad shop to a Delhi customer.
 *
 * The doc is at `appConfig/shopVisibility`, parallel to
 * `aiFeatures/distanceMatrix` (PR 46) — both are server-readable
 * config knobs, no rebuild required to toggle.
 *
 * Resilient: any read error (network, IAM, schema mismatch) falls
 * back to FALSE so a flag-fetch hiccup can never inadvertently
 * reveal distant shops; the worst outcome is the testing team
 * temporarily sees a filtered list, which is recoverable by
 * re-touching the doc.
 */
async function readShowAllShopsFlag(): Promise<boolean> {
  try {
    const snap = await db.doc('appConfig/shopVisibility').get();
    if (!snap.exists) return false;
    const data = snap.data() as { showAllShops?: unknown } | undefined;
    return data?.showAllShops === true;
  } catch (err) {
    console.warn('[shopVisibility] flag read failed; defaulting to false', {
      err: (err as Error)?.message,
    });
    return false;
  }
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
    // PR 48 — apply the per-shop service-radius visibility gate.
    // `rankShopsByDistance` decorated `distanceKm`; each shop doc
    // carries its own `serviceRadiusKm` (or falls back to the helper's
    // default). The flag is the cross-city testing override.
    const showAll = await readShowAllShopsFlag();
    const visible = filterShopsByServiceRadius(shops, { showAll });
    return { shops: visible };
  },
);

// ────────────────────────────────────────────────────────────────────
// PR 46 — getDeliveryEstimate.
//
// Computes the road distance + estimated drive time from a shop to
// a delivery destination. Returns
// `{ distanceKm, durationMin, source }`. Pure decision logic lives
// in `distanceMatrixHelpers.ts` so the kill-switch + fallback
// branches are unit-testable without firebase-admin.
//
// COST DECISION (Sudhir, May 27 2026): the paid Google Distance
// Matrix API is BUILT BUT DORMANT during pilot. The kill-switch
// `aiFeatures/distanceMatrix.enabled` defaults to `false` (missing
// doc OR explicit false → disabled), and the disabled branch
// NEVER calls fetch — pinned by
// `tests/functions/distanceMatrixHelpers.test.ts`. The secret is
// declared on the callable so the cost path is one Firestore
// flag-flip away from being live, but no Google call fires until
// then.
//
// Never throws on Google failure: `computeDeliveryEstimate` always
// returns a valid haversine fallback if anything goes wrong, so
// CheckoutScreen can render the result unconditionally.
// ────────────────────────────────────────────────────────────────────

type DeliveryEstimateInputServer = {
  shopId: string;
  dest: { lat: number; lng: number };
};

/**
 * Read the Distance Matrix kill-switch.
 *
 * Default-FALSE posture (the inverse of `aiFeatures/menuExtraction`,
 * which defaults to TRUE). The cost-decision rationale: a paid
 * Google API needs an explicit, intentional opt-in to start
 * billing; a missing flag doc must NEVER cause accidental spend.
 */
async function readDistanceMatrixFlag(): Promise<boolean> {
  const snap = await db.doc('aiFeatures/distanceMatrix').get();
  if (!snap.exists) return false;
  const data = snap.data() as { enabled?: unknown } | undefined;
  return data?.enabled === true;
}

/**
 * Validate the destination passed to getDeliveryEstimate / placeOrder.
 * Mirrors the SavedAddress lat/lng range checks from
 * profileHelpers.validateAddressInput so server-side rejection is
 * uniform regardless of which surface sent the coords.
 */
function validateDestLatLng(
  dest: unknown,
): { ok: true; value: { lat: number; lng: number } } | { ok: false; message: string } {
  if (!dest || typeof dest !== 'object') {
    return { ok: false, message: 'dest must be an object with lat and lng' };
  }
  const { lat, lng } = dest as { lat?: unknown; lng?: unknown };
  if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) {
    return { ok: false, message: 'dest.lat must be a finite number in [-90, 90]' };
  }
  if (typeof lng !== 'number' || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    return { ok: false, message: 'dest.lng must be a finite number in [-180, 180]' };
  }
  return { ok: true, value: { lat, lng } };
}

/**
 * Server-side helper that loads a shop, validates its `location`,
 * reads the kill-switch, and runs `computeDeliveryEstimate`. Shared
 * between the standalone `getDeliveryEstimate` callable AND
 * placeOrder's authoritative re-derivation step so the two surfaces
 * produce identical estimates from the same inputs.
 *
 * Returns null when the shop has no usable `location` (legacy
 * pre-geo shops). Caller decides whether that's a hard error
 * (getDeliveryEstimate → throws) or a graceful skip (placeOrder
 * → omits the locked fields rather than blocking checkout).
 */
async function deriveShopDeliveryEstimate(
  shopId: string,
  dest: { lat: number; lng: number },
): Promise<DistanceEstimate | null> {
  const shopSnap = await db.doc(`shops/${shopId}`).get();
  if (!shopSnap.exists) {
    throw new HttpsError('not-found', 'Shop not found');
  }
  const shop = shopSnap.data() as { location?: { lat?: unknown; lng?: unknown } };
  const loc = shop.location;
  if (
    !loc ||
    typeof loc.lat !== 'number' ||
    !Number.isFinite(loc.lat) ||
    typeof loc.lng !== 'number' ||
    !Number.isFinite(loc.lng)
  ) {
    return null;
  }

  const flagEnabled = await readDistanceMatrixFlag();
  // The secret-read can throw when the secret hasn't been set;
  // catch and treat as null so the disabled-branch fallback path
  // is reached and pilot stays free regardless of secret state.
  let apiKey: string | null = null;
  if (flagEnabled) {
    try {
      apiKey = GOOGLE_MAPS_API_KEY.value() || null;
    } catch {
      apiKey = null;
    }
  }

  return computeDeliveryEstimate({
    shop: { lat: loc.lat, lng: loc.lng },
    dest,
    flagEnabled,
    apiKey,
  });
}

export const getDeliveryEstimate = onCall<DeliveryEstimateInputServer>(
  {
    cors: true,
    enforceAppCheck: false,
    region: 'asia-south1',
    secrets: [GOOGLE_MAPS_API_KEY],
  },
  async request => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in required');
    }
    const { shopId, dest } = request.data ?? ({} as DeliveryEstimateInputServer);
    if (typeof shopId !== 'string' || shopId.length === 0) {
      throw new HttpsError('invalid-argument', 'shopId is required');
    }
    const destResult = validateDestLatLng(dest);
    if (!destResult.ok) {
      throw new HttpsError('invalid-argument', destResult.message);
    }

    const estimate = await deriveShopDeliveryEstimate(shopId, destResult.value);
    if (!estimate) {
      // Legacy shop without a `location` field. CheckoutScreen
      // catches this and falls back to "delivery time unknown" UX
      // rather than blocking the order — placeOrder also tolerates
      // it (skips the stamp).
      throw new HttpsError(
        'failed-precondition',
        'Shop has no geo location; cannot estimate delivery distance',
      );
    }
    return {
      distanceKm: estimate.distanceKm,
      durationMin: estimate.durationMin,
      source: estimate.source,
    };
  },
);

// ────────────────────────────────────────────────────────────────────
// PR 4 — Customer search rewrite.
//
// The legacy SearchScreen read from the global /products collection,
// which exists but is no longer the source of truth for any shop
// registered post-v2-iii (those have only a per-shop /menu
// subcollection — see listShopMenuPublic). The result: search and
// category browse found nothing for newly-registered shops, even
// though their menus had matching items. This callable fixes that
// by querying menus directly via collection-group + filtering by
// active candidate shops.
//
// Public (no auth) to mirror listShopMenuPublic / listShopsPublic.
// Filter logic is in searchMenuPublicHelpers.ts so the substring /
// category / stock rules can be unit-tested without firebase-admin.
//
// Returns up to 50 items, each joined with shop info (name, address,
// distance). Client decides display order; we don't add an orderBy
// clause to avoid forcing a per-filter-combination composite index.
// ────────────────────────────────────────────────────────────────────
export const searchMenuPublic = onCall<{
  query?: string;
  category?: string;
  location?: LatLng;
}>(
  { cors: true, enforceAppCheck: false },
  async request => {
    const { query, category, location } = request.data ?? {};

    // 1. Candidate shop set. Same status filter as listShopsPublic;
    //    distance ranking ensures the closest 30 win when location
    //    is provided. The 30-cap maps directly to Firestore's `in`
    //    query limit on the menu collection-group query below.
    const shopSnap = await db
      .collection('shops')
      .where('status', '==', 'active')
      .get();
    const allCandidateShops = rankShopsByDistance(
      shopSnap.docs.map(
        d => ({ id: d.id, ...d.data() }) as Record<string, any>,
      ),
      location,
    ) as CandidateShop[];

    const candidateIds = pickCandidateShopIds(allCandidateShops, 30);
    if (candidateIds.length === 0) {
      return { items: [] };
    }

    // 2. Collection-group query. `in` with `==` requires a composite
    //    index — see firestore.indexes.json (collectionGroup: menu,
    //    fields: shopId + available). Query auto-fails with
    //    FAILED_PRECONDITION if the index isn't deployed.
    const menuSnap = await db
      .collectionGroup('menu')
      .where('shopId', 'in', candidateIds)
      .where('available', '==', true)
      .get();

    const rawItems = menuSnap.docs.map(
      d => ({ id: d.id, ...d.data() }) as RawMenuItem,
    );

    // 3. Pure filter + join. Keeps the substring/category/stock/cap
    //    rules testable without firebase-admin.
    const result = filterAndJoinSearchResults({
      rawItems,
      candidateShops: allCandidateShops.filter(s =>
        candidateIds.includes(s.id),
      ),
      query,
      category,
    });

    return result;
  },
);

// ────────────────────────────────────────────────────────────────────
// Phase 12a-v2-iv: Profile + saved address book.
//
// Five callables (all auth-required, no anon access) that own the
// /users/{uid} document's profile-shaped fields. Validation logic is
// extracted to functions/src/profileHelpers.ts so the rules can be
// unit-tested without booting firebase-functions; this file is just
// the auth-gate + Firestore wiring.
//
// All five never return fcmTokens / isAdmin / deliveryStatus /
// currentLocation — those stay server-internal. The Profile screen
// has no business reading them; admin auditing reads through
// getUserDetail (admin-only).
// (Validation helpers imported at the top of the file from
// ./profileHelpers — kept testable in plain Node.)
// ────────────────────────────────────────────────────────────────────

// Server-internal fields stripped from every getMyProfile response.
// Adding new fields to /users/{uid} that should be hidden from the
// client? Add them here.
const PROFILE_INTERNAL_FIELDS = new Set([
  'fcmTokens',
  'isAdmin',
  'isShopOwner',
  'isDelivery',
  'deliveryStatus',
  'deliveryStatusUpdatedAt',
  // PR 49 — partner foreground location (set by reportDeliveryLocation;
  // consumed by PR 50's push-fanout). Server-internal: customers
  // shouldn't see partner coords on a profile read, and partners
  // shouldn't see their own raw GPS round-tripped on every profile
  // fetch (the dashboard already has the live coords).
  'currentLocation',
  'currentLocationUpdatedAt',
  'shopId',
]);

type StoredAddress = {
  id: string;
  label: string | null;
  name: string;
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  pincode: string;
  createdAt: number;
  updatedAt: number;
  // PR 22 — optional, omitted from the stored doc when absent
  // (we don't write the key at all if null) so old reads round-trip
  // unchanged. saveAddress strips null below before write.
  deliveryInstructions?: string;
  // PR 46 — optional GPS pin captured by AddressEditScreen via
  // expo-location. Same write semantics as deliveryInstructions:
  // both fields omitted entirely when absent so legacy address
  // doc shape stays clean. Either both keys present or neither —
  // validateAddressInput rejects half-set pairs.
  lat?: number;
  lng?: number;
};

type StoredProfile = {
  uid?: string;
  phone?: string | null;
  name?: string | null;
  email?: string | null;
  addresses?: StoredAddress[];
  defaultAddressId?: string | null;
  createdAt?: number | null;
  updatedAt?: number | null;
  // PR 19 — per-shop favorites map. See `src/types/index.ts` for
  // the full doc block; the wire shape is identical client + server.
  favorites?: Record<string, string[]>;
} & Record<string, unknown>;

function publicProfileShape(uid: string, data: StoredProfile) {
  // Strip internal fields and normalise nulls/defaults so the client
  // gets the same shape on first-call (doc-just-created) and steady
  // state (doc has been edited many times).
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (!PROFILE_INTERNAL_FIELDS.has(k)) out[k] = v;
  }
  // PR 19 — favorites round-trip the profile shape. We only emit
  // the field when the underlying doc has a non-empty map so legacy
  // profiles without favorites stay at the same wire size.
  const rawFavorites = out.favorites;
  const favorites: Record<string, string[]> | undefined =
    rawFavorites && typeof rawFavorites === 'object'
      ? (rawFavorites as Record<string, string[]>)
      : undefined;

  return {
    uid,
    phone: (out.phone as string) ?? null,
    name: (out.name as string) ?? null,
    email: (out.email as string) ?? null,
    addresses: Array.isArray(out.addresses) ? (out.addresses as StoredAddress[]) : [],
    defaultAddressId: (out.defaultAddressId as string) ?? null,
    createdAt: typeof out.createdAt === 'number' ? out.createdAt : null,
    updatedAt: typeof out.updatedAt === 'number' ? out.updatedAt : null,
    favorites,
  };
}

export const getMyProfile = onCall(
  { cors: true, enforceAppCheck: false, region: 'asia-south1' },
  async request => {
    const auth = request.auth;
    if (!auth) throw new HttpsError('unauthenticated', 'Sign in required');

    const uid = auth.uid;
    const ref = db.doc(`users/${uid}`);
    const snap = await ref.get();
    const tokenPhone =
      typeof auth.token?.phone_number === 'string'
        ? auth.token.phone_number
        : null;
    const now = Date.now();

    if (!snap.exists) {
      // First-call seeding. We `set({merge:true})` rather than create()
      // because registerPushToken / becomeDelivery / approveShop may
      // race with this call — merge keeps any concurrently-written
      // tokens / claims-mirror fields intact. Phone is only seeded if
      // the auth token actually carries one (anon users won't); if it
      // doesn't, we skip silently and let a later call backfill.
      const seed: Record<string, unknown> = {
        uid,
        addresses: [],
        defaultAddressId: null,
        createdAt: now,
        updatedAt: now,
      };
      if (tokenPhone) seed.phone = tokenPhone;
      await ref.set(seed, { merge: true });
      const fresh = await ref.get();
      return publicProfileShape(uid, (fresh.data() ?? {}) as StoredProfile);
    }

    // Existing doc — backfill phone if the auth token has one and the
    // doc doesn't. This is idempotent: once `phone` is set we never
    // overwrite it (multiple linked phone numbers across the user's
    // history would otherwise clobber each other).
    const data = snap.data() as StoredProfile;
    if (tokenPhone && !data.phone) {
      await ref.set({ phone: tokenPhone, updatedAt: now }, { merge: true });
      data.phone = tokenPhone;
      data.updatedAt = now;
    }
    return publicProfileShape(uid, data);
  },
);

export const updateMyProfile = onCall<{
  name?: string | null;
  email?: string | null;
}>(
  { cors: true, enforceAppCheck: false, region: 'asia-south1' },
  async request => {
    const auth = request.auth;
    if (!auth) throw new HttpsError('unauthenticated', 'Sign in required');

    const result = validateProfilePatch(request.data ?? {});
    if (!result.ok) {
      throw new HttpsError(
        'invalid-argument',
        `${result.field}: ${result.message}`,
      );
    }
    const patch = result.value;

    // Build the Firestore update. `null` means "clear" → use
    // FieldValue.delete() so the field doesn't linger as an explicit
    // null in the doc (cleaner for downstream consumers that
    // distinguish "never set" from "set to null").
    const update: Record<string, unknown> = {
      updatedAt: Date.now(),
    };
    if ('name' in patch) {
      update.name = patch.name === null ? FieldValue.delete() : patch.name;
    }
    if ('email' in patch) {
      update.email = patch.email === null ? FieldValue.delete() : patch.email;
    }

    const ref = db.doc(`users/${auth.uid}`);
    await ref.set(update, { merge: true });

    const snap = await ref.get();
    return publicProfileShape(auth.uid, (snap.data() ?? {}) as StoredProfile);
  },
);

export const saveAddress = onCall<AddressInput>(
  { cors: true, enforceAppCheck: false, region: 'asia-south1' },
  async request => {
    const auth = request.auth;
    if (!auth) throw new HttpsError('unauthenticated', 'Sign in required');

    const result = validateAddressInput(request.data ?? {});
    if (!result.ok) {
      throw new HttpsError(
        'invalid-argument',
        `${result.field}: ${result.message}`,
      );
    }

    const ref = db.doc(`users/${auth.uid}`);
    const now = Date.now();

    // Transaction so concurrent saveAddress / deleteAddress calls
    // don't clobber each other's array writes. Using arrayUnion on an
    // object array is unsafe (Firestore matches on full equality
    // including timestamps), so we do read-modify-write inside a tx.
    const newId = await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      const data: StoredProfile = snap.exists
        ? (snap.data() as StoredProfile)
        : {};
      const existing: StoredAddress[] = Array.isArray(data.addresses)
        ? [...data.addresses]
        : [];

      // Update path: input id matches an existing row.
      const inputId = typeof request.data?.id === 'string' ? request.data.id : null;
      let targetIdx = inputId
        ? existing.findIndex(a => a.id === inputId)
        : -1;

      let id: string;
      let createdAt: number;
      if (targetIdx >= 0) {
        id = existing[targetIdx].id;
        createdAt = existing[targetIdx].createdAt;
      } else {
        // Create path — mint a UUID. crypto.randomUUID() is available
        // in Node 18+ (the Functions runtime).
        id = crypto.randomUUID();
        createdAt = now;
        targetIdx = existing.length;
      }

      const next: StoredAddress = {
        id,
        label: result.value.label,
        name: result.value.name,
        phone: result.value.phone,
        line1: result.value.line1,
        line2: result.value.line2,
        city: result.value.city,
        pincode: result.value.pincode,
        createdAt,
        updatedAt: now,
        // PR 22 — only include the key when the validator returned
        // a non-null trimmed string. Avoids storing explicit nulls
        // on Firestore (legacy doc shape compatibility).
        ...(result.value.deliveryInstructions !== null
          ? { deliveryInstructions: result.value.deliveryInstructions }
          : {}),
        // PR 46 — same write-when-present pattern. Validator pins
        // both-or-neither so we don't need to handle the half-set
        // case here.
        ...(result.value.lat !== null && result.value.lng !== null
          ? { lat: result.value.lat, lng: result.value.lng }
          : {}),
      };
      existing[targetIdx] = next;

      // First address ever → also set defaultAddressId.
      const update: Record<string, unknown> = {
        addresses: existing,
        updatedAt: now,
      };
      const currentDefault =
        typeof data.defaultAddressId === 'string' ? data.defaultAddressId : null;
      if (!currentDefault) {
        update.defaultAddressId = id;
      }
      // Doc may not exist yet (registerPushToken hasn't run, etc.).
      // set+merge is safe in both cases.
      tx.set(ref, update, { merge: true });
      return id;
    });

    const finalSnap = await ref.get();
    return {
      id: newId,
      profile: publicProfileShape(
        auth.uid,
        (finalSnap.data() ?? {}) as StoredProfile,
      ),
    };
  },
);

export const deleteAddress = onCall<{ id: string }>(
  { cors: true, enforceAppCheck: false, region: 'asia-south1' },
  async request => {
    const auth = request.auth;
    if (!auth) throw new HttpsError('unauthenticated', 'Sign in required');

    const id =
      typeof request.data?.id === 'string' ? request.data.id.trim() : '';
    if (!id) throw new HttpsError('invalid-argument', 'id is required');

    const ref = db.doc(`users/${auth.uid}`);
    const now = Date.now();

    await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      if (!snap.exists) {
        // Idempotent — nothing to delete is success, not an error.
        return;
      }
      const data = snap.data() as StoredProfile;
      const existing: StoredAddress[] = Array.isArray(data.addresses)
        ? data.addresses
        : [];
      const remaining = existing.filter(a => a.id !== id);
      if (remaining.length === existing.length) {
        // Already gone — same idempotency story.
        return;
      }
      const nextDefault = promoteDefaultAfterDelete(
        remaining,
        id,
        data.defaultAddressId ?? null,
      );
      tx.set(
        ref,
        {
          addresses: remaining,
          defaultAddressId: nextDefault,
          updatedAt: now,
        },
        { merge: true },
      );
    });

    const finalSnap = await ref.get();
    return {
      profile: publicProfileShape(
        auth.uid,
        (finalSnap.data() ?? {}) as StoredProfile,
      ),
    };
  },
);

export const setDefaultAddress = onCall<{ id: string }>(
  { cors: true, enforceAppCheck: false, region: 'asia-south1' },
  async request => {
    const auth = request.auth;
    if (!auth) throw new HttpsError('unauthenticated', 'Sign in required');

    const id =
      typeof request.data?.id === 'string' ? request.data.id.trim() : '';
    if (!id) throw new HttpsError('invalid-argument', 'id is required');

    const ref = db.doc(`users/${auth.uid}`);
    await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      if (!snap.exists) {
        throw new HttpsError('not-found', `Address ${id} not found`);
      }
      const data = snap.data() as StoredProfile;
      const existing: StoredAddress[] = Array.isArray(data.addresses)
        ? data.addresses
        : [];
      if (!existing.some(a => a.id === id)) {
        throw new HttpsError('not-found', `Address ${id} not found`);
      }
      tx.set(
        ref,
        { defaultAddressId: id, updatedAt: Date.now() },
        { merge: true },
      );
    });

    const finalSnap = await ref.get();
    return {
      profile: publicProfileShape(
        auth.uid,
        (finalSnap.data() ?? {}) as StoredProfile,
      ),
    };
  },
);

// PR 19 — toggle a per-shop menu-item favorite on the caller's
// profile. Pure helpers in `favoritesHelpers.ts` own the validation
// + state machine; this callable is the firebase-admin glue.
//
// Note: we DO NOT validate that menuItemId actually exists in the
// shop's current menu. That's deliberate. If a shop removes an
// item, the customer's favorite for it should silently become
// "unavailable" on FavoritesScreen (handled client-side via the
// per-shop menu fetch), not throw at toggle time. Cheaper, simpler,
// more forgiving UX — and matches the "favorites can outlive a
// shop's menu" rationale documented on the type in
// `src/types/index.ts`.
export const toggleFavorite = onCall<{
  shopId: string;
  menuItemId: string;
}>(
  { cors: true, enforceAppCheck: false, region: 'asia-south1' },
  async request => {
    const auth = request.auth;
    const check = validateToggleFavoriteInput(
      auth ? { uid: auth.uid } : null,
      (request.data ?? {}) as { shopId: unknown; menuItemId: unknown },
    );
    if (!check.ok) {
      throw new HttpsError(check.code, check.message);
    }
    const { shopId, menuItemId } = check;
    const uid = auth!.uid;

    const ref = db.doc(`users/${uid}`);

    // Transaction so a rapid double-tap (mobile users LOVE
    // double-tapping hearts) doesn't race-condition the array. The
    // pure helper is read-modify-write; without the tx, two
    // parallel toggles could both read the same baseline and
    // overwrite each other.
    const { isFavorite } = await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      const data: StoredProfile = snap.exists
        ? (snap.data() as StoredProfile)
        : {};
      const result = applyFavoriteToggle(
        data.favorites,
        shopId,
        menuItemId,
      );
      tx.set(
        ref,
        {
          favorites: result.favorites,
          updatedAt: Date.now(),
        },
        { merge: true },
      );
      return result;
    });

    const finalSnap = await ref.get();
    return {
      profile: publicProfileShape(
        uid,
        (finalSnap.data() ?? {}) as StoredProfile,
      ),
      isFavorite,
    };
  },
);

// PR 20 — submit a 1-5 star rating + optional comment for a
// delivered order. Atomic: writes the rating onto the order doc
// AND bumps the shop's rolling avg + count in a single
// transaction. If either fails, both roll back — no half-rated
// orders, no double-counted shops.
//
// Re-reads inside the transaction guard the double-tap race
// (customer hits Submit twice quickly): the second tx sees the
// just-written rating and throws `failed-precondition`. Helpers
// in `ratingHelpers.ts` own validation + the rolling-avg math;
// this callable is the firebase-admin glue + audit-log emitter.
export const submitOrderRating = onCall<{
  orderId: string;
  // Legacy single-rating shape (PR 20). Still accepted during the
  // OTA propagation window — a not-yet-updated client will send
  // these. The server coerces them to a shop-only dual rating and
  // writes the new schema (`shopRating` / `shopComment`).
  stars?: number;
  comment?: string;
  // PR 42.1 dual-rating shape. `shopRating` is required for the
  // new path; `deliveryRating` is optional (customer skipped) and
  // also auto-dropped if the order has no `deliveryPersonId`.
  shopRating?: number;
  shopComment?: string;
  deliveryRating?: number;
  deliveryComment?: string;
}>(
  { cors: true, enforceAppCheck: false, region: 'asia-south1' },
  async request => {
    const auth = request.auth;
    const data = (request.data ?? {}) as {
      orderId?: string;
      stars?: number;
      comment?: string;
      shopRating?: number;
      shopComment?: string;
      deliveryRating?: number;
      deliveryComment?: string;
    };
    const { orderId } = data;
    if (typeof orderId !== 'string' || orderId.length === 0) {
      throw new HttpsError('invalid-argument', 'orderId required');
    }

    const orderRef = db.doc(`orders/${orderId}`);
    const orderSnap = await orderRef.get();
    const orderData = orderSnap.exists ? (orderSnap.data() as any) : null;

    const check = validateDualRatingSubmission({
      auth: auth ? { uid: auth.uid } : null,
      order: orderData,
      stars: data.stars,
      comment: data.comment,
      shopRating: data.shopRating,
      shopComment: data.shopComment,
      deliveryRating: data.deliveryRating,
      deliveryComment: data.deliveryComment,
    });
    if (!check.ok) {
      throw new HttpsError(check.code, check.message);
    }
    const {
      shopId,
      shopRating,
      shopComment,
      deliveryRating,
      deliveryComment,
      deliveryPersonId,
      deliveryDropped,
    } = check;

    if (deliveryDropped === 'no-partner') {
      // The customer rated delivery but the order never got picked
      // up by a partner (rare edge — could happen if a future flow
      // delivers without a deliveryPersonId stamped). Shop rating
      // still persists; delivery dimension silently dropped. Ops
      // visibility via warn log + audit metadata below.
      console.warn(
        '[submitOrderRating] delivery rating dropped (no-partner) for order',
        orderId,
      );
    }

    const shopRef = db.doc(`shops/${shopId}`);
    const userRef = deliveryPersonId
      ? db.doc(`users/${deliveryPersonId}`)
      : null;

    await db.runTransaction(async tx => {
      // Re-read inside the transaction so a rapid double-submit
      // hits the prior-rating check on the second invocation
      // rather than racing with the first write. Submit-once span
      // mirrors the helper — either the legacy `rating` object OR
      // the new `shopRating` field blocks re-submission.
      const orderInTx = await tx.get(orderRef);
      if (!orderInTx.exists) {
        throw new HttpsError('not-found', 'Order vanished mid-rating');
      }
      const orderTxData = orderInTx.data() as any;
      if (orderTxData.rating || orderTxData.shopRating) {
        throw new HttpsError(
          'failed-precondition',
          'This order has already been rated',
        );
      }
      const shopInTx = await tx.get(shopRef);
      const shopTxData = shopInTx.exists ? (shopInTx.data() as any) : {};

      // PR 42.1.1 hotfix — Firestore transactions require ALL
      // reads to precede ALL writes. The original PR 42.1 read
      // the user doc AFTER `tx.update(orderRef)` + `tx.set(shopRef)`,
      // which threw "Firestore transactions require all reads to
      // be executed before all writes" the first time a customer
      // submitted a dual rating with delivery on a delivered
      // order. Fix: hoist the user read up here, alongside the
      // order + shop reads, and gate it on the same
      // (deliveryRating && userRef) condition the write uses.
      let userTxData: any = null;
      if (deliveryRating && userRef) {
        const userInTx = await tx.get(userRef);
        userTxData = userInTx.exists ? userInTx.data() : {};
      }

      const { newAvg: shopAvg, newCount: shopCount } =
        computeNewRollingAverage(
          shopTxData.ratingAvg,
          shopTxData.ratingCount,
          shopRating,
        );

      // PR 42.1 multi-write: order doc + shop doc + (optional)
      // user doc. The new flat schema replaces PR 20's nested
      // `rating: { stars, comment, ratedAt }` — write only the
      // fields that have values (Firestore rejects explicit
      // `undefined` in update payloads). We do NOT write the
      // legacy `rating` field at all on new submissions; the
      // historical legacy field remains untouched on pre-PR-42.1
      // orders and is read-only.
      const orderPayload: Record<string, unknown> = {
        shopRating,
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (shopComment) orderPayload.shopComment = shopComment;
      if (deliveryRating) orderPayload.deliveryRating = deliveryRating;
      if (deliveryComment) orderPayload.deliveryComment = deliveryComment;

      tx.update(orderRef, orderPayload);
      tx.set(
        shopRef,
        {
          ratingAvg: shopAvg,
          ratingCount: shopCount,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      // Delivery partner rolling average — only if the helper
      // produced both a delivery rating AND a deliveryPersonId.
      // The user doc is created via `merge: true` so a brand-new
      // delivery partner (no prior `users/{uid}` doc, or one
      // without delivery rating fields) gets initialized
      // correctly without overwriting other fields the doc may
      // hold (isDelivery mirror, fcmTokens, etc.).
      if (deliveryRating && userRef) {
        const { newAvg: dAvg, newCount: dCount } = computeNewRollingAverage(
          userTxData?.deliveryRatingAvg,
          userTxData?.deliveryRatingCount,
          deliveryRating,
        );
        tx.set(
          userRef,
          {
            deliveryRatingAvg: dAvg,
            deliveryRatingCount: dCount,
          },
          { merge: true },
        );
      }
    });

    // Audit log (non-fatal — PR 8 wrapper pattern). `hasShopComment`
    // / `hasDeliveryComment` let ops query "ratings with comments"
    // per dimension without exposing the comment text.
    // `deliveryDropped` captures the no-partner edge for diagnosis.
    await writeAuditLog({
      actorUid: auth!.uid,
      actorRole: 'customer',
      actionType: 'order.rate',
      targetType: 'order',
      targetId: orderId,
      metadata: {
        shopId,
        shopRating,
        hasShopComment: !!shopComment,
        deliveryRating: deliveryRating ?? null,
        hasDeliveryComment: !!deliveryComment,
        deliveryPersonId: deliveryPersonId ?? null,
        deliveryDropped: deliveryDropped ?? null,
      },
    }).catch(e =>
      console.warn('[submitOrderRating] writeAuditLog failed:', e),
    );

    return {
      ok: true,
      shopRating,
      shopComment,
      deliveryRating: deliveryRating ?? null,
      deliveryComment: deliveryComment ?? null,
    };
  },
);

// ────────────────────────────────────────────────────────────
// PR 32 — AI photo-to-catalog (menu extraction)
// ────────────────────────────────────────────────────────────
//
// `extractMenuFromImage` — accepts a base64-encoded photo of a
// rate-list / shelf, calls Claude vision, returns the parsed list of
// items for the shop owner to review on-device.
// `addExtractedMenuItems` — second leg: after the owner reviews +
// edits, this batch-writes the approved subset using the same
// validation gates as `addCustomMenuItem`.
//
// Cost guardrails (per docs/ROADMAP.md Section 3 AI policy):
//   - Auth check: shopOwner claim + shopId.
//   - Per-shop daily quota: 5 extractions, tracked in
//     aiQuotas/{uid}_{YYYY-MM-DD}.menuExtraction. Counter ticks
//     INSIDE the transaction that checks the limit, so two
//     concurrent calls cannot both pass the gate.
//   - Per-feature kill switch: `aiFeatures/menuExtraction.enabled`
//     (missing or true → enabled; explicit false → reject).
//   - Audit log entry per call to `aiAuditLog/` — uid, shopId,
//     feature, model, token counts, costInr estimate, item counts.
//
// No image is persisted: base64 stays in the callable payload,
// processed in memory, never written to a bucket. Privacy win +
// no storage cleanup + no IAM signBlob path (which would re-
// trigger the PR 31 IAM gotcha if we tried). Image cap of 2 MB
// base64 (~1.5 MB raw) at the server protects against runaway
// uploads bypassing the client-side resize.
const MENU_EXTRACTION_DAILY_QUOTA = 5;
const MAX_IMAGE_BYTES = 2_000_000;

export const extractMenuFromImage = onCall<{
  imageBase64: string;
  imageMediaType?: 'image/jpeg' | 'image/png' | 'image/webp';
}>(
  {
    cors: true,
    enforceAppCheck: false,
    secrets: [ANTHROPIC_API_KEY],
    // Claude vision calls routinely take 10–30s on a real
    // rate-list; 120s leaves headroom for network jitter + image
    // decode without crowding the platform max.
    timeoutSeconds: 120,
    // base64 + Claude SDK both want headroom; 512MiB is the safe
    // minimum for a 1.5 MB image + 4k token response buffer.
    memory: '512MiB',
  },
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

    // Kill-switch check. Missing doc OR enabled:true → enabled.
    // Explicit enabled:false → reject. Lets ops disable the
    // feature in one click via Firebase Console without redeploying.
    const killSwitchSnap = await db.doc('aiFeatures/menuExtraction').get();
    const enabled = killSwitchSnap.exists
      ? killSwitchSnap.data()?.enabled !== false
      : true;
    if (!enabled) {
      throw new HttpsError(
        'failed-precondition',
        'Menu extraction is temporarily disabled. Try again later.',
      );
    }

    // Validate image payload.
    const data = request.data ?? ({} as Record<string, unknown>);
    const imageBase64 = data.imageBase64;
    const imageMediaType = data.imageMediaType as
      | 'image/jpeg'
      | 'image/png'
      | 'image/webp'
      | undefined;
    if (typeof imageBase64 !== 'string' || imageBase64.length === 0) {
      throw new HttpsError('invalid-argument', 'imageBase64 required');
    }
    if (imageBase64.length > MAX_IMAGE_BYTES) {
      throw new HttpsError(
        'invalid-argument',
        `Image too large (${Math.round(imageBase64.length / 1024)}KB). Try a smaller photo or crop tighter.`,
      );
    }

    // Per-shop daily quota — atomic increment in a transaction so
    // two concurrent calls cannot both pass the gate.
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const quotaRef = db.doc(`aiQuotas/${auth.uid}_${today}`);
    const usedToday = await db.runTransaction(async tx => {
      const snap = await tx.get(quotaRef);
      const current =
        (snap.data()?.menuExtraction as number | undefined) ?? 0;
      if (current >= MENU_EXTRACTION_DAILY_QUOTA) {
        return -1; // sentinel: quota exhausted
      }
      tx.set(
        quotaRef,
        {
          menuExtraction: current + 1,
          updatedAt: FieldValue.serverTimestamp(),
          uid: auth.uid,
        },
        { merge: true },
      );
      return current + 1;
    });
    if (usedToday < 0) {
      throw new HttpsError(
        'resource-exhausted',
        `Daily limit reached (${MENU_EXTRACTION_DAILY_QUOTA} scans). Try again tomorrow.`,
      );
    }

    // Call Claude.
    let claudeResult;
    try {
      claudeResult = await runClaudeVision({
        systemPrompt: MENU_EXTRACTION_SYSTEM_PROMPT,
        userText: MENU_EXTRACTION_USER_PROMPT,
        imageBase64,
        imageMediaType: imageMediaType ?? 'image/jpeg',
        // 4k tokens fits a long rate-list (60–100 SKUs) with
        // headroom for the per-item JSON envelope.
        maxTokens: 4000,
      });
    } catch (e) {
      const message =
        e instanceof Error ? e.message : String(e);
      console.error(
        '[extractMenuFromImage] Claude call failed:',
        message,
      );
      // Don't refund the quota — calls that hit Claude still cost
      // something on the Anthropic side. If we see this become a
      // common failure mode we can revisit.
      throw new HttpsError(
        'internal',
        'Could not read the image. Try retaking with better lighting or angle.',
      );
    }

    // Parse + validate.
    const parsed = parseExtractionResponse(claudeResult.text);
    if (!parsed.ok) {
      console.warn(
        `[extractMenuFromImage] parse failed for shop ${shopId}: ${parsed.reason}`,
      );
      throw new HttpsError(
        'internal',
        'AI returned an unexpected response. Try again or retake the photo.',
      );
    }

    // Audit log (non-fatal — a failed audit write must not break
    // the user-visible action, same pattern as the PR 8
    // writeAuditLog wrapper). Fire-and-forget; if it fails, log
    // to function logs and move on.
    const costInr = estimateCostInr(
      claudeResult.inputTokens,
      claudeResult.outputTokens,
      claudeResult.model,
    );
    db.collection('aiAuditLog')
      .add({
        uid: auth.uid,
        shopId,
        feature: 'menuExtraction',
        model: claudeResult.model,
        inputTokens: claudeResult.inputTokens,
        outputTokens: claudeResult.outputTokens,
        costInr,
        itemsExtracted: parsed.items.length,
        droppedCount: parsed.droppedCount,
        timestamp: FieldValue.serverTimestamp(),
      })
      .catch(e =>
        console.warn('[extractMenuFromImage] audit log failed:', e),
      );

    return {
      ok: true as const,
      items: parsed.items,
      droppedCount: parsed.droppedCount,
      usedTodayCount: usedToday,
      dailyQuota: MENU_EXTRACTION_DAILY_QUOTA,
    };
  },
);

// Batch-write the shop-owner-approved subset of an extraction.
// Mirrors `addCustomMenuItem` validation field-for-field; each
// row produces a `custom_<ts>_<rand>_<idx>` menu item doc tagged
// with `addedVia: 'menuExtraction'` so we can later compute the
// "% of menu added via AI" analytic from Firestore alone.
//
// Returns counts so the UI can show "Added 47 items; 3 skipped
// (mrp must be >= price)." Per-item skip reasons are returned so
// the owner can fix the bad rows on the review screen and retry.
//
// Hard cap of 100 items per batch — Firestore batched writes
// allow 500 ops, so a 100-item cap leaves room without bumping
// the limit. Extraction passes that exceed this would have hit
// Claude's `maxTokens` limit first, so 100 is generous.
const ADD_EXTRACTED_BATCH_CAP = 100;

export const addExtractedMenuItems = onCall<{
  items: Array<{
    name: string;
    price: number;
    mrp: number;
    packLabel: string;
    category: string;
  }>;
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

    const items = request.data?.items;
    if (!Array.isArray(items) || items.length === 0) {
      throw new HttpsError('invalid-argument', 'items array required');
    }
    if (items.length > ADD_EXTRACTED_BATCH_CAP) {
      throw new HttpsError(
        'invalid-argument',
        `Too many items (max ${ADD_EXTRACTED_BATCH_CAP} per batch). Got ${items.length}.`,
      );
    }

    const batch = db.batch();
    const added: string[] = [];
    const skipped: Array<{ index: number; reason: string }> = [];
    const now = Date.now();
    // PR 32.1 — per-category placeholder selection happens inside
    // the loop below (each item carries its own validated category).
    // The single fallbackImage constant from PR 32 is gone; the
    // shared `placeholderImageForCategory` helper is the source of
    // truth for both this callable and `addCustomMenuItem`.

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const trimmedName =
        typeof item?.name === 'string' ? item.name.trim() : '';
      if (!trimmedName) {
        skipped.push({ index: i, reason: 'name required' });
        continue;
      }
      if (
        typeof item.price !== 'number' ||
        !Number.isFinite(item.price) ||
        item.price <= 0
      ) {
        skipped.push({ index: i, reason: 'price must be a positive number' });
        continue;
      }
      if (
        typeof item.mrp !== 'number' ||
        !Number.isFinite(item.mrp) ||
        item.mrp < item.price
      ) {
        skipped.push({ index: i, reason: 'mrp must be >= price' });
        continue;
      }
      if (typeof item.packLabel !== 'string' || !item.packLabel.trim()) {
        skipped.push({ index: i, reason: 'packLabel required' });
        continue;
      }
      if (
        typeof item.category !== 'string' ||
        !VALID_CATEGORIES.has(item.category)
      ) {
        skipped.push({
          index: i,
          reason: `unknown category: ${String(item.category)}`,
        });
        continue;
      }

      const rand = Math.random().toString(36).slice(2, 8);
      const menuItemId = `custom_${now}_${rand}_${i}`;

      batch.set(db.doc(`shops/${shopId}/menu/${menuItemId}`), {
        id: menuItemId,
        shopId,
        productId: null,
        name: trimmedName,
        imageUrl: placeholderImageForCategory(item.category),
        packLabel: item.packLabel.trim(),
        category: item.category,
        price: item.price,
        mrp: item.mrp,
        available: true,
        stock: null,
        // Match `addCustomMenuItem`'s schema — `isCustom: true`
        // marks the row as shop-authored (no productId link).
        // `addedVia` is the PR 32 analytics tag for "how did this
        // SKU enter the catalog?"; older custom items predate this
        // field, which the menu-render path treats as undefined.
        isCustom: true,
        addedVia: 'menuExtraction',
        createdAt: now,
        updatedAt: now,
      });
      added.push(menuItemId);
    }

    if (added.length === 0) {
      throw new HttpsError(
        'invalid-argument',
        `All ${items.length} items failed validation. First error: ${skipped[0]?.reason}`,
      );
    }

    await batch.commit();

    return {
      ok: true as const,
      added: added.length,
      skipped,
      menuItemIds: added,
    };
  },
);

// ────────────────────────────────────────────────────────────
// PR 34 — Voice + Hindi onboarding assist
// ────────────────────────────────────────────────────────────
//
// Lets a non-English-fluent kirana shopkeeper register their shop
// by speaking instead of typing. Two flows share one callable:
//
//   - mode='multi_field' — shopkeeper holds the big "🎙 Speak
//     about your shop" button and speaks a paragraph. STT
//     transcribes; Claude Haiku parses the transcript into the
//     7 registration fields. Client pre-fills, marks each filled
//     field with a ✨ chip, shows a transcript review banner, and
//     forces human review (Trust Principle 2) before commit.
//
//   - mode='single_field' — per-field mic icon. STT only, no
//     Claude. Shopkeeper dictates the value of one field at a
//     time; client confirms before assigning.
//
// Cost guardrails (Trust Principle 3 / docs/ROADMAP.md):
//   - Auth: any signed-in user. NO shopOwner claim — voice
//     onboarding runs BEFORE the shop is registered.
//   - Per-uid daily quota: 10 calls/day at
//     aiQuotas/{uid}_{YYYY-MM-DD}.voiceOnboarding (PR 32 already
//     uses this collection for the menuExtraction counter; this
//     just adds a second field to the same per-day doc).
//   - Kill switch: aiFeatures/voiceOnboarding.enabled
//     (missing or true → enabled; explicit false → reject).
//   - Audio cap: 2 MB base64.
//   - Audit log: aiAuditLog/ entry per call with feature,
//     subFeature (mode), languageCode, sttBillableSeconds,
//     llmModel + token counts (multi_field only), costInr.
//
// Trust Principle 4 — every error message that surfaces to the
// shopkeeper is rendered in the language they picked at the
// language switcher (hi-IN or en-IN). The callable receives the
// language and returns Hindi messages when languageCode='hi-IN'.
//
// No persistence: audio bytes stay in the callable payload,
// processed in memory, never written to a bucket. Same privacy
// posture as PR 32's image flow + zero storage cleanup needed.

const VOICE_ONBOARDING_DAILY_QUOTA = 10;
const MAX_AUDIO_BYTES = 2_000_000; // ~2 MB base64

// Lazy-init the STT client so cold-starting unrelated functions
// doesn't pay this cost. Reused across warm invocations.
let speechClient: SpeechClient | null = null;
function getSpeechClient(): SpeechClient {
  if (!speechClient) speechClient = new SpeechClient();
  return speechClient;
}

export const transcribeShopOnboardingAudio = onCall<{
  audioBase64: string;
  // PR 34 — three encodings cover the platforms expo-audio
  // supports out of the box: WEBM_OPUS for web (default web
  // preset), LINEAR16 (PCM 16-bit in WAV) for iOS, AMR_WB for
  // Android (the only STT-friendly format Android MediaRecorder
  // can produce without a native module). FLAC stays accepted
  // for future use / debugging — no client path emits it today.
  encoding: 'WEBM_OPUS' | 'LINEAR16' | 'FLAC' | 'AMR_WB';
  sampleRateHertz?: number;
  languageCode: 'hi-IN' | 'en-IN';
  mode: 'single_field' | 'multi_field';
}>(
  {
    cors: true,
    enforceAppCheck: false,
    // ANTHROPIC_API_KEY only used in multi_field mode. Listed
    // unconditionally because Firebase only mounts the secret
    // when it's declared at deploy time; switching modes
    // mid-flight is a runtime concern.
    secrets: [ANTHROPIC_API_KEY],
    // STT (~3–8s) + optional Haiku call (~1–2s) + payload up/down
    // fits in 60s with comfortable headroom.
    timeoutSeconds: 60,
    memory: '512MiB',
  },
  async request => {
    const auth = request.auth;
    if (!auth) {
      throw new HttpsError('unauthenticated', 'Sign in required');
    }
    // No shopOwner gate — voice onboarding runs BEFORE the shop
    // is registered. Any authenticated user can call this.

    const data = request.data ?? ({} as Record<string, unknown>);
    const audioBase64 = data.audioBase64;
    const encoding = data.encoding as
      | 'WEBM_OPUS'
      | 'LINEAR16'
      | 'FLAC'
      | undefined;
    const sampleRateHertz = data.sampleRateHertz as number | undefined;
    const languageCode = data.languageCode as 'hi-IN' | 'en-IN' | undefined;
    const mode = data.mode as 'single_field' | 'multi_field' | undefined;

    // Validate the language up front so we can use it for the
    // localised error messages below.
    if (languageCode !== 'hi-IN' && languageCode !== 'en-IN') {
      throw new HttpsError(
        'invalid-argument',
        'languageCode must be hi-IN or en-IN',
      );
    }
    const isHi = languageCode === 'hi-IN';

    // Kill switch.
    const killSwitchSnap = await db
      .doc('aiFeatures/voiceOnboarding')
      .get();
    const enabled = killSwitchSnap.exists
      ? killSwitchSnap.data()?.enabled !== false
      : true;
    if (!enabled) {
      throw new HttpsError(
        'failed-precondition',
        isHi
          ? 'आवाज़ से रजिस्ट्रेशन अभी बंद है। कृपया लिखकर भरें।'
          : 'Voice onboarding is temporarily disabled. Please type your shop details instead.',
      );
    }

    // Validate audio + mode.
    if (typeof audioBase64 !== 'string' || !audioBase64) {
      throw new HttpsError('invalid-argument', 'audioBase64 required');
    }
    if (audioBase64.length > MAX_AUDIO_BYTES) {
      throw new HttpsError(
        'invalid-argument',
        isHi
          ? 'रिकॉर्डिंग बहुत लंबी है। 30 सेकंड से छोटी रिकॉर्ड करें।'
          : 'Audio file too large. Please record a shorter clip (under 30 seconds).',
      );
    }
    if (
      encoding !== 'WEBM_OPUS' &&
      encoding !== 'LINEAR16' &&
      encoding !== 'FLAC' &&
      encoding !== 'AMR_WB'
    ) {
      throw new HttpsError('invalid-argument', 'Unsupported audio encoding');
    }
    if (mode !== 'single_field' && mode !== 'multi_field') {
      throw new HttpsError(
        'invalid-argument',
        'mode must be single_field or multi_field',
      );
    }

    // Per-uid daily quota — atomic increment in a transaction so
    // two concurrent calls cannot both pass the gate. Reuses the
    // PR 32 `aiQuotas/{uid}_{YYYY-MM-DD}` doc with a sibling
    // `voiceOnboarding` field; merge:true keeps the existing
    // `menuExtraction` field intact.
    const today = new Date().toISOString().slice(0, 10);
    const quotaRef = db.doc(`aiQuotas/${auth.uid}_${today}`);
    const usedToday = await db.runTransaction(async tx => {
      const snap = await tx.get(quotaRef);
      const current =
        (snap.data()?.voiceOnboarding as number | undefined) ?? 0;
      if (current >= VOICE_ONBOARDING_DAILY_QUOTA) return -1;
      tx.set(
        quotaRef,
        {
          voiceOnboarding: current + 1,
          updatedAt: FieldValue.serverTimestamp(),
          uid: auth.uid,
        },
        { merge: true },
      );
      return current + 1;
    });
    if (usedToday < 0) {
      throw new HttpsError(
        'resource-exhausted',
        isHi
          ? `आज की ${VOICE_ONBOARDING_DAILY_QUOTA} कोशिशें खत्म हो गईं। कल फिर कोशिश करें।`
          : `Daily limit reached (${VOICE_ONBOARDING_DAILY_QUOTA} attempts). Try again tomorrow.`,
      );
    }

    // Run STT.
    let transcript: string;
    let sttBillableSeconds = 0;
    try {
      const stt = getSpeechClient();
      const [response] = await stt.recognize({
        audio: { content: audioBase64 },
        config: {
          encoding,
          // Default 16 kHz matches expo-audio's PCM/WAV preset
          // and the OPUS sample rate. Caller can override if
          // they record at a different rate.
          sampleRateHertz: sampleRateHertz ?? 16000,
          languageCode,
          enableAutomaticPunctuation: true,
          // `latest_short` is tuned for clips ≤ 60s — perfect
          // for our 30s cap. `latest_long` would handle longer
          // audio but is slower + more expensive per second.
          model: 'latest_short',
        },
      });
      transcript = (response.results ?? [])
        .map(r => r.alternatives?.[0]?.transcript ?? '')
        .filter(Boolean)
        .join(' ')
        .trim();
      // Approximate billable seconds via base64 length.
      // OPUS at 16 kHz ≈ 16 KB/sec. Used purely for the audit
      // log's cost estimate; STT bills in 15s increments anyway.
      sttBillableSeconds = Math.ceil(audioBase64.length / 16_000);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(
        '[transcribeShopOnboardingAudio] STT failed:',
        message,
      );
      // The first deploy after enabling the API can still see
      // PERMISSION_DENIED until IAM propagates (~1 min). Same
      // diagnostic pattern as PR 31's signBlob role grant —
      // surface a friendly message; the server log shows the
      // root cause.
      throw new HttpsError(
        'internal',
        isHi
          ? 'आपकी आवाज़ साफ़ नहीं आई। फिर से कोशिश करें।'
          : 'Could not understand the audio. Please try again with less background noise.',
      );
    }
    if (!transcript) {
      throw new HttpsError(
        'internal',
        isHi
          ? 'कुछ भी सुनाई नहीं दिया। माइक के पास बोलें।'
          : 'No speech detected. Please speak closer to the microphone.',
      );
    }

    // single_field: STT-only — return the transcript and let the
    // client decide which field to assign it to.
    if (mode === 'single_field') {
      const sttCostInr =
        Math.round(sttBillableSeconds * 0.033 * 100) / 100;
      db.collection('aiAuditLog')
        .add({
          uid: auth.uid,
          feature: 'voiceOnboarding',
          subFeature: 'single_field',
          languageCode,
          sttBillableSeconds,
          costInr: sttCostInr,
          timestamp: FieldValue.serverTimestamp(),
        })
        .catch(e =>
          console.warn(
            '[transcribeShopOnboardingAudio] audit log failed:',
            e,
          ),
        );

      return {
        ok: true as const,
        transcript,
        fields: null,
        usedTodayCount: usedToday,
        dailyQuota: VOICE_ONBOARDING_DAILY_QUOTA,
      };
    }

    // multi_field: STT + Claude Haiku parse → 7 fields.
    let claudeResult;
    try {
      claudeResult = await runClaude({
        systemPrompt: VOICE_ONBOARDING_SYSTEM_PROMPT,
        userText: transcript,
        // 500 tokens is plenty for 7-field JSON; cheaper than the
        // 1000-token default at Haiku rates.
        maxTokens: 500,
      });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(
        '[transcribeShopOnboardingAudio] Claude parse failed:',
        message,
      );
      // Don't fail the whole call — the transcript is still
      // useful (the client shows it in the review banner so the
      // shopkeeper can copy parts into individual fields).
      return {
        ok: true as const,
        transcript,
        fields: null,
        parseError: isHi
          ? 'अभी फ़ील्ड्स नहीं भरी जा सकीं। ऊपर लिखे शब्दों से हर फ़ील्ड पर माइक दबाकर बोलें।'
          : 'Could not parse fields from transcript. The text is above; please tap each field mic to dictate individually.',
        usedTodayCount: usedToday,
        dailyQuota: VOICE_ONBOARDING_DAILY_QUOTA,
      };
    }

    const parsed = parseVoiceOnboardingResponse(claudeResult.text);
    const fields = parsed.ok ? parsed.fields : null;

    // Audit log (non-fatal, fire-and-forget).
    const sttCostInr =
      Math.round(sttBillableSeconds * 0.033 * 100) / 100;
    const llmCostInr = estimateCostInr(
      claudeResult.inputTokens,
      claudeResult.outputTokens,
      claudeResult.model,
    );
    db.collection('aiAuditLog')
      .add({
        uid: auth.uid,
        feature: 'voiceOnboarding',
        subFeature: 'multi_field',
        languageCode,
        sttBillableSeconds,
        sttCostInr,
        llmModel: claudeResult.model,
        llmInputTokens: claudeResult.inputTokens,
        llmOutputTokens: claudeResult.outputTokens,
        llmCostInr,
        costInr:
          Math.round((sttCostInr + llmCostInr) * 100) / 100,
        timestamp: FieldValue.serverTimestamp(),
      })
      .catch(e =>
        console.warn(
          '[transcribeShopOnboardingAudio] audit log failed:',
          e,
        ),
      );

    return {
      ok: true as const,
      transcript,
      fields,
      usedTodayCount: usedToday,
      dailyQuota: VOICE_ONBOARDING_DAILY_QUOTA,
    };
  },
);

// ─────────────────────────────────────────────────────────────────────
// PR 38.1 — featureUsageLog callables.
//
// Background: PR 38 shipped client-side direct-Firestore reads + writes
// against `featureUsageLog/`. On native that fails because the Web SDK
// Firestore (`firebase/firestore`) doesn't share auth context with
// `@react-native-firebase/auth`. Same root cause as PR 6.1's signed-
// upload-URL fix for Storage. Same fix shape: route through callables,
// which carry auth via the HTTPS header and work cross-SDK.
//
// Both callables here use the Admin SDK to read/write the collection,
// so the rule for `featureUsageLog/{eventId}` is now
// `allow read, write: if false` (server-mediated only — same posture
// as `aiAuditLog/` and `auditLog/`).
// ─────────────────────────────────────────────────────────────────────

export const logFeatureUsageEvent = onCall<{
  feature: string;
  shopId?: string;
}>(
  { cors: true, enforceAppCheck: false },
  async request => {
    const auth = request.auth;
    if (!auth) {
      // Silent — anonymous events don't write. Mirrors the client-side
      // `writeFeatureUsageLog` short-circuit. Returning ok:false instead
      // of throwing keeps fire-and-forget callers quiet (no Sentry
      // noise from the swallow-and-log path).
      return { ok: false as const, reason: 'unauthenticated' as const };
    }

    const data = request.data ?? ({} as { feature?: unknown; shopId?: unknown });
    const feature = typeof data.feature === 'string' ? data.feature : '';
    if (!feature) {
      // Guard against schema-drift / debug-tool noise. The client
      // wrapper always sets feature; missing == garbage call, drop it.
      return { ok: false as const, reason: 'invalid-feature' as const };
    }

    // Resolve role from custom claims. Mirrors the priority order
    // in the client's `currentRole()` helper (admin > shop_owner >
    // delivery > customer). Anonymous would have been short-circuited
    // above, so 'anonymous' is unreachable here — collapse to
    // 'customer' if no role flag is set.
    let role: 'admin' | 'shop_owner' | 'delivery' | 'customer' = 'customer';
    if (auth.token?.admin === true) role = 'admin';
    else if (auth.token?.shopOwner === true) role = 'shop_owner';
    else if (auth.token?.delivery === true) role = 'delivery';

    const date = new Date().toISOString().slice(0, 10);
    const doc: Record<string, unknown> = {
      uid: auth.uid,
      role,
      feature,
      date,
      timestamp: FieldValue.serverTimestamp(),
    };
    const shopId = typeof data.shopId === 'string' ? data.shopId : '';
    if (shopId) {
      doc.shopId = shopId;
    }

    await db.collection('featureUsageLog').add(doc);
    return { ok: true as const };
  },
);

export const queryFeatureUsageLog = onCall<{
  period: '7d' | '30d';
}>(
  { cors: true, enforceAppCheck: false },
  async request => {
    const auth = request.auth;
    if (!auth) throw new HttpsError('unauthenticated', 'Sign in required');
    if (auth.token?.admin !== true) {
      throw new HttpsError('permission-denied', 'Admin role required');
    }

    const period = request.data?.period;
    if (period !== '7d' && period !== '30d') {
      throw new HttpsError(
        'invalid-argument',
        "period must be '7d' or '30d'",
      );
    }

    const days = period === '7d' ? 7 : 30;
    const startDate = new Date(Date.now() - days * 86_400_000)
      .toISOString()
      .slice(0, 10);

    // Same query AdminUsageScreen previously ran client-side. Limit
    // 10_000 mirrors the PR 38 cap; if pilot scale exceeds it, the
    // follow-up is a scheduled-function daily rollup (already noted
    // in PR 38's PRELAUNCH follow-ups).
    const snap = await db
      .collection('featureUsageLog')
      .where('date', '>=', startDate)
      .orderBy('date', 'desc')
      .limit(10_000)
      .get();

    // Normalize Timestamp → epoch-ms so the client can render dates
    // without pulling in firebase-admin types. The client doesn't
    // currently use `timestamp` (the date string drives the chart),
    // but exposing it lets future drilldown UI sort by exact moment.
    const events = snap.docs.map(d => {
      const raw = d.data() as Record<string, unknown>;
      const ts = raw.timestamp as { toMillis?: () => number } | undefined;
      return {
        ...raw,
        timestamp:
          typeof ts?.toMillis === 'function'
            ? ts.toMillis()
            : typeof raw.timestamp === 'number'
              ? raw.timestamp
              : null,
      };
    });

    return {
      ok: true as const,
      events,
      truncated: snap.size === 10_000,
    };
  },
);

