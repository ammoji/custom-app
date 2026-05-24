import { CategoryId } from '../constants/categories';

export type Unit = 'kg' | 'g' | 'litre' | 'ml' | 'piece' | 'packet' | 'dozen';

export type GeoPoint = { lat: number; lng: number };

// Shop lifecycle (Phase 12a-v2-i):
//   pending   → just registered, awaiting admin review
//   active    → approved + customer-visible
//   rejected  → admin declined; owner sees reason and can resubmit
//   suspended → admin pulled the plug post-launch (rules support it,
//               UI ships in a later phase)
export type ShopStatus = 'pending' | 'active' | 'rejected' | 'suspended';

// PR 31 — KYC document slot kinds. Keep this list in sync with
// `VALID_DOC_KINDS` in `functions/src/kycUploadHelpers.ts` — the
// server validates against the same whitelist.
export type ShopKycDocKind =
  | 'storefront'
  | 'gstDoc'
  | 'fssaiDoc'
  | 'ownerIdDoc';

// PR 31 — Server-stamped pointer to one uploaded KYC document.
// Kept minimal: the storage path is the only durable identity; the
// admin reads it via a server-minted signed-read URL through
// `getShopKycReadUrls`. No public download URL is persisted because
// `/shop-kyc/` is read-deny for non-admins.
export type ShopKycDocRef = {
  storagePath: string; // shop-kyc/{shopId}/{kind}_<ts>_<rand>.jpg
  uploadedAt: number; // epoch ms
};

export type ShopRegistrationData = {
  phone: string;
  hours: { open: string; close: string }; // "HH:mm" 24h
  gstNumber?: string | null;
  fssaiLicense?: string | null;
  submittedAt: number; // epoch ms
  // PR 31 — KYC documents. All optional; existing shops without
  // them just show "Not uploaded" in admin review. Added in a
  // schema-additive way so previously-registered pending shops keep
  // working.
  kycDocs?: Partial<Record<ShopKycDocKind, ShopKycDocRef>>;
};

export type Shop = {
  id: string;
  name: string;
  description?: string;
  address: string;
  location: GeoPoint;
  distanceKm?: number;
  rating: number;
  isOpen: boolean;
  imageUrl: string;
  categories: CategoryId[];
  deliveryFee: number;
  minOrder: number;
  etaMinutes: number;
  // Phase 12a-v2-i. Optional so existing mocks (MOCK_SHOPS) and any
  // legacy in-memory Shop literals keep typechecking. Cloud Functions
  // (registerShop / approveShop) enforce presence on real registered
  // shops; the seed script backfills `status: 'active'` on the
  // pre-existing 8 shops so the customer flow keeps working.
  status?: ShopStatus;
  ownerUid?: string | null;
  registrationData?: ShopRegistrationData;
  approvedAt?: number;
  approvedBy?: string;
  rejectedAt?: number;
  rejectedReason?: string;
  // Phase 12a-v2-i-bis: admin can suspend an active shop. Customer
  // listings filter on status==active so suspended shops drop out
  // of the customer flow without losing their owner / history.
  suspendedAt?: number | null;
  suspendedBy?: string | null;
  suspendedReason?: string | null;
  // PR 20 — rolling rating statistics. Updated atomically inside
  // submitOrderRating's transaction every time a customer rates an
  // order from this shop. Both fields are 0 / missing for a new
  // shop with no ratings yet (rendered as "New shop" by
  // ShopRatingBadge). Distinct from the legacy `rating: number`
  // field above (a placeholder seed value, never written to by
  // any callable) — `ratingAvg` is the live, customer-driven
  // metric. Future PRs can decommission the legacy field once
  // every surface reads `ratingAvg` exclusively.
  ratingAvg?: number;
  ratingCount?: number;
};

// Returned by `listAllUsers` callable. Mirrors the subset of
// FirebaseAuth UserRecord we need on the client to render the admin
// user-management list, plus resolved role booleans (claims aren't
// queryable, so we return them already-flattened).
export type UserInfo = {
  uid: string;
  phoneNumber: string | null;
  isAnonymous: boolean;
  isAdmin: boolean;
  isShopOwner: boolean;
  shopId: string | null;
  isDelivery: boolean;
  createdAt: number | null;
  lastSignInAt: number | null;
};

export type Product = {
  id: string;
  shopId: string;
  name: string;
  brand?: string;
  category: CategoryId;
  imageUrl: string;
  packSize: { value: number; unit: Unit };
  mrp: number;
  price: number;
  inStock: boolean;
  tags?: string[];
};

// Phase 12a-v2-ii: per-shop menu. Each shop owns a `menu` subcollection
// (`shops/{shopId}/menu/{menuItemId}`). Two flavors of menu item exist:
//   - GLOBAL  (productId set, isCustom: false): inherits name + image
//             from products/{productId} but denormalizes them so the
//             customer never has to do a second read. Shop owner can
//             override price/availability/stock only — name and image
//             are protected to keep cross-shop comparisons honest.
//   - CUSTOM  (productId null, isCustom: true): shop-defined item that
//             only exists in this shop's menu. Owner can edit every
//             field including the destructive Delete (whereas GLOBAL
//             items only soft-toggle via available=false).
//
// `stock: null` means "in stock, no count tracked" — this is the
// default for bootstrapped GLOBAL items. A numeric stock is purely
// informational in MVP; auto-decrement on order placement is tracked
// in PRELAUNCH_CHECKLIST. The customer-facing ShopDetailScreen will
// switch to reading from this collection in Phase 12a-v2-iii.
export type MenuItem = {
  id: string;
  shopId: string;
  productId: string | null;
  name: string;
  imageUrl: string;
  packLabel: string;
  category: CategoryId;
  price: number;
  mrp: number;
  available: boolean;
  stock: number | null;
  isCustom: boolean;
  createdAt: number;
  updatedAt: number;
};

// Input for addCustomMenuItem callable. imageUrl + stock are optional;
// the server fills in a placeholder image if blank and defaults stock
// to null.
export type NewMenuItemInput = {
  name: string;
  price: number;
  mrp: number;
  packLabel: string;
  category: CategoryId;
  imageUrl?: string;
  stock?: number | null;
};

// Phase 12a-v2-iii: cart lines now optionally carry a `menuItemId` and
// `priceSnapshot` so placeOrder can validate against the per-shop menu
// (price drift / availability / stock). Both fields are optional so
// AsyncStorage carts that survive across the OTA upgrade keep working
// — the server falls back to the legacy products-collection path when
// `menuItemId` is absent. `productId` always carries a unique key for
// cart-line dedup; for CUSTOM menu items (no underlying product) we
// set it to the menuItemId so increment/decrement keep working
// without an additional cart-line key field.
export type CartItem = {
  productId: string;
  name: string;
  imageUrl: string;
  packLabel: string;
  price: number;
  quantity: number;
  menuItemId?: string;
  priceSnapshot?: number;
};

export type Address = {
  name: string;
  line1: string;
  line2?: string;
  city: string;
  pincode: string;
  phone: string;
  // PR 22 — optional delivery instructions ("Ring second bell",
  // "Leave at door, dog inside", "Gate locked after 9 PM"). Stored
  // per-saved-address so the customer doesn't retype every order;
  // CheckoutScreen pre-fills from the picked address and lets the
  // customer override per-order (the override is captured on the
  // order's deliveryAddress snapshot, the saved-address book row
  // is untouched). Server caps the trimmed length at 280 chars via
  // normalizeDeliveryInstructions. Missing / empty / whitespace-only
  // input → undefined (field absent on the stored doc).
  deliveryInstructions?: string;
};

// Phase 12a-v2-iv: saved address book on /users/{uid}.
//
// SavedAddress carries the same six fields as a one-off Address used at
// checkout, plus identity (`id`), an optional human label ("Home" /
// "Office"), and timestamps. The `id` is a server-generated UUID — we
// never let the client mint it because saveAddress() needs to detect
// whether the input is an update (id present + matches a row) vs a
// brand-new entry. `label` is free text, optional, capped at 32 chars
// in the validator.
//
// Two design notes worth preserving:
//   - `name` and `phone` are recipient fields, not account holder
//     fields. They may differ from the profile's name/phone (gift
//     orders, sending to family). The UI doesn't try to enforce match.
//   - `createdAt` / `updatedAt` are epoch ms (not Firestore Timestamps)
//     so the same shape round-trips through callable JSON without
//     hand-converting. The Cloud Functions stamp `updatedAt = Date.now()`
//     on every save; createdAt is only set on the first write for a
//     given id.
export type SavedAddress = {
  id: string;
  label?: string;
  name: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  pincode: string;
  createdAt: number;
  updatedAt: number;
  // PR 22 — mirrors the field on the freestanding Address type.
  // Free-text instructions for the delivery partner; capped at
  // 280 chars server-side. See the comment on Address above for
  // semantics + override-at-checkout rules.
  deliveryInstructions?: string;
};

// User profile doc shape returned by the getMyProfile callable.
// Deliberately omits server-internal fields (fcmTokens, isAdmin,
// deliveryStatus) — those are filtered out server-side before the
// callable returns. The client never needs them on the Profile screen.
// PR 1 — security hardening. Mirror of the deliveryRequests/{uid}
// doc shape on the server. The waiting screen + admin queue both
// read this; the admin detail screen also reads it. The doc is
// created with status='pending' by requestDeliveryRole and is the
// SOLE writer until an admin transitions it to approved/rejected via
// approveDeliveryRole / rejectDeliveryRole.
export type DeliveryRequestStatus = 'pending' | 'approved' | 'rejected';

export type DeliveryRequest = {
  uid: string;
  phone: string;
  name?: string;
  vehicleType?: string;
  city?: string;
  submittedAt: number; // epoch ms
  status: DeliveryRequestStatus;
  approvedAt?: number;
  approvedBy?: string; // admin uid
  rejectedAt?: number;
  rejectedBy?: string; // admin uid
  rejectedReason?: string;
};

export type UserProfile = {
  uid: string;
  phone: string | null;
  name: string | null;
  email: string | null;
  addresses: SavedAddress[];
  defaultAddressId: string | null;
  createdAt: number | null;
  updatedAt: number | null;
  // PR 19 — Per-shop favorites. Map of shopId → array of menuItemIds
  // the customer has favorited at that shop. Missing key means "no
  // favorites at that shop"; the server's applyFavoriteToggle helper
  // also DELETES the key entirely when its array drops to empty, so
  // an empty inner array should never appear in steady state.
  //
  // Per-shop scoping (rather than a flat list of menuItemIds) is
  // intentional: a customer might favorite "Tata Sampann atta 5kg"
  // at Mahesh Kirana. If Mahesh stops carrying it, the favorite
  // is gone. But the customer's separate favorite for "Aashirvaad
  // atta 5kg" at Test Kirana 2 keeps working independently.
  favorites?: Record<string, string[]>;
};

export type PaymentMethod = 'cod' | 'online';
// PR 2 — payment hardening. Expanded union:
//   - 'authorized' — Razorpay reports a payment.authorized event but
//     no payment.captured (rare; happens if auto-capture is off in
//     dashboard config). Shop should NOT dispatch; admin reviews.
//   - 'amount_mismatch' — webhook saw a captured payment with a
//     mismatched amount vs order.total. Order intentionally NOT
//     marked paid; admin reconciles via the Razorpay dashboard.
//   - 'refund_pending' / 'refunded' / 'refund_failed' — drive the
//     Cancel & Refund flow in AdminOrdersScreen.
export type PaymentStatus =
  | 'pending'
  | 'paid'
  | 'failed'
  | 'expired'
  | 'not_required'
  | 'authorized'
  | 'amount_mismatch'
  | 'refunded'
  | 'refund_pending'
  | 'refund_failed';

export type Order = {
  id: string;
  shopId: string;
  shopName: string;
  items: CartItem[];
  subtotal: number;
  deliveryFee: number;
  total: number;
  deliveryAddress: Address;
  paymentMethod: PaymentMethod;
  // Present for online orders; COD orders may omit these entirely.
  paymentStatus?: PaymentStatus;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  paidAt?: number;
  // PR 2 — payment hardening. Set by the webhook when a captured
  // payment's amount disagrees with order.total (in rupees). Admin
  // uses both fields to reconcile manually.
  amountReceived?: number;
  amountExpected?: number;
  // PR 2 — payment hardening. Set by the payment.authorized handler
  // when Razorpay authorizes but doesn't auto-capture. paidAt is
  // NOT set on this branch.
  authorizedAt?: number;
  // PR 2 — payment hardening. Refund flow. refundId points at
  // refunds/{refundId} once cancelPaidOrder fires Razorpay's API.
  refundId?: string;
  refundedAt?: number;
  // Free-form admin reason captured at the time of paid-cancel.
  cancellationReason?: string;
  // PR 12 — status `out_for_delivery` was renamed to
  // `ready_for_pickup`. The semantic is "shop is done; awaiting
  // delivery partner pickup". Customer-facing copy still reads
  // "Out for delivery" (familiar phrasing) — only the internal
  // value + admin/shop/delivery UI labels changed.
  status: 'pending' | 'accepted' | 'preparing' | 'ready_for_pickup' | 'delivered' | 'cancelled';
  createdAt: number;
  estimatedDeliveryAt: number;
  // PR 12 — shopkeeper-provided ETA for when the order will be
  // ready for pickup. Set when the shopkeeper accepts (mandatory
  // server-side validation; see
  // `functions/src/orderStatusTransitionHelpers.ts`). May be
  // updated during the preparing phase if the shop is running
  // late. Null only on legacy orders placed before PR 12 — every
  // render path checks for that and falls back to
  // `estimatedDeliveryAt` or omits the line entirely.
  readyByEstimate: number | null;
  // Delivery-flow fields (Phase 12b). All three are null on a freshly
  // placed order. We don't add new statuses to the state machine; the
  // combination of (status, deliveryPersonId, pickedUpAt) encodes the
  // substate:
  //   ready_for_pickup + deliveryPersonId=null              → available pickup
  //   ready_for_pickup + deliveryPersonId=X + pickedUpAt=null → claimed, en route to shop
  //   ready_for_pickup + deliveryPersonId=X + pickedUpAt=ts  → picked up, on the way to customer
  //   delivered        + deliveredAt=ts                     → done
  deliveryPersonId: string | null;
  pickedUpAt: number | null;
  deliveredAt: number | null;
  // Audit trail of every status change. Server (Cloud Functions) is
  // the only writer; toOrder() normalizes `.at` to epoch ms. Optional
  // because legacy orders predate this field.
  statusHistory?: Array<{
    status: string;
    at: number;
    by: string;
    reason?: string;
  }>;
  // PR 20 — customer-submitted rating. Set ONCE when the customer
  // rates a delivered order. Updates are NOT allowed in MVP (would
  // require recomputing the shop's rolling average from scratch).
  // Missing field means "not yet rated"; OrderDetailScreen renders
  // the prompt card while this is undefined and flips to a
  // "Thanks for rating!" card once present.
  rating?: OrderRating;
  // PR 21 — customer's substitution preference. Captured ONCE at
  // checkout. Tells the shop how to handle an item that turns out
  // to be unavailable mid-fulfillment without a call interrupting
  // the customer:
  //   'call_me' (default) — shop MUST call before substituting or
  //                         refunding. Safe choice; assumed on any
  //                         order placed before this PR shipped.
  //   'auto'              — shop picks an equivalent item.
  //   'refund'            — shop drops the item + adjusts total.
  // Missing field on legacy orders → ShopOrderDetail renders the
  // call_me copy explicitly (safe), customer OrderDetail silently
  // omits the section (no choice was made; nothing to confirm).
  substitutionPreference?: SubstitutionPreference;
};

// PR 21 — substitution preference. Set ONCE at checkout. Tells the
// shop how to handle an unavailable item without needing to call
// the customer mid-fulfillment. See the field comment on Order
// above for the full semantics + legacy-order rendering rules.
export type SubstitutionPreference = 'call_me' | 'auto' | 'refund';

// PR 20 — order rating. Stars are 1-5 inclusive integers; comment
// is trimmed + capped at 500 chars by the server validator. ratedAt
// is set server-side at submission (Date.now()).
export type OrderRating = {
  stars: 1 | 2 | 3 | 4 | 5;
  comment?: string;
  ratedAt: number;
};

// PR 32 — AI menu extraction.
//
// `ExtractedMenuItem` mirrors the server's `ExtractedItem` shape
// from `functions/src/menuExtractionHelpers.ts`. The server has
// already validated `category` against the canonical 10-value
// whitelist, so this is typed as `CategoryId` on the client.
// `mrp` and `sellPrice` are nullable because Claude returns null
// for illegible prices; the review screen forces the shop owner
// to fill them in before committing.
export type ExtractedMenuItem = {
  name: string;
  brand: string | null;
  packSize: string;
  mrp: number | null;
  sellPrice: number | null;
  category: CategoryId;
  confidence: 'high' | 'medium' | 'low';
};

// PR 34 — Voice + Hindi onboarding.
//
// `ParsedShopFields` mirrors the server's same-named shape from
// `functions/src/voiceOnboardingHelpers.ts`. The server has
// already validated each field individually (phone digits, HH:mm
// format, GSTIN regex, FSSAI digits) so any non-null value is
// safe to drop straight into the matching form input. Null means
// "the shopkeeper didn't say this field, OR Claude couldn't
// extract it confidently" — the form input stays at its default.
export type ParsedShopFields = {
  name: string | null;
  address: string | null;
  phone: string | null;
  openTime: string | null;
  closeTime: string | null;
  gstNumber: string | null;
  fssaiLicense: string | null;
};

// PR 34 — UI language for the registration form. Two values in
// MVP (Hindi + English); add `pa-IN` / `ta-IN` / `te-IN` /
// `bn-IN` as pilot shops surface in those regions.
export type UiLanguage = 'hi-IN' | 'en-IN';

// `ExtractedMenuDraft` is the client-side, editable wrapper around
// `ExtractedMenuItem`. The review screen renders a list of these
// and mutates `selected` + `edited*` in place. Only the approved
// rows (selected=true and price/mrp valid) are translated into the
// `addExtractedMenuItems` payload at commit time.
//
// `tempId` is a local-only React key; never sent to the server.
export type ExtractedMenuDraft = ExtractedMenuItem & {
  tempId: string;
  selected: boolean;
  editedName: string;
  editedPackLabel: string;
  editedMrp: number;
  editedSellPrice: number;
  editedCategory: CategoryId;
};
