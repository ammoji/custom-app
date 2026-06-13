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

// PR 47 — distance-based delivery charge tiers. One row per band;
// the resolver in `functions/src/deliveryChargeHelpers.ts` sorts by
// `maxKm` ascending and picks the first row whose `maxKm >= distance`.
// `maxKm: null` is the "everything beyond the last numbered band"
// catch-all (validator pins exactly one such row per tier table).
export type DeliveryChargeTier = {
  /**
   * Inclusive upper bound of this band, in km. `null` = the
   * catch-all for distances beyond every numbered band.
   */
  maxKm: number | null;
  /** Charge for this band, in ₹. */
  charge: number;
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
  // PR 47 — distance-based delivery charges. OPTIONAL for back-compat:
  // legacy shops (and the existing seeded shops without it) fall back
  // to the flat `deliveryFee` field above via `chargeForDistance`'s
  // legacy-fallback branch. New shops get
  // `DEFAULT_DELIVERY_CHARGE_TIERS` seeded by `approveShop` at the
  // moment of approval. Owners edit via `updateShopDeliveryTiers`
  // (Shop Settings → Delivery charges editor).
  //
  // Tier semantics: `maxKm` is INCLUSIVE upper bound; first matching
  // band wins. Exactly one entry has `maxKm: null` (catch-all for
  // "beyond the last band"). See `deliveryChargeHelpers.ts` for the
  // resolution logic + validation rules.
  deliveryChargeTiers?: DeliveryChargeTier[];
  // PR 48 — shop service radius. OPTIONAL for back-compat: legacy
  // shops (and the existing seeded shops) without it fall back to
  // `DEFAULT_SERVICE_RADIUS_KM` in the filter helper, so they keep a
  // sane 5 km reach until the owner customizes it. New shops get the
  // default seeded by `approveShop` at approval time. Owner edits via
  // Shop Settings → Service area (`updateShopSettings`). The integer-
  // only / 1-50 range is enforced server-side in `shopSettingsHelpers`.
  serviceRadiusKm?: number;
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
  // PR-NEXT-SHOP-LOCATION-REQUIRED — audit trail of admin location
  // verification at approval time. Both optional + nullable so
  // legacy approved-pre-PR shops that never ran through the new
  // `validateShopLocationForApproval` gate stay back-compat (they
  // simply lack the stamp). Set together inside the `approveShop`
  // callable's `shopRef.update` block; never set independently.
  // `locationVerifiedAt` is `Date.now()` (epoch ms) at approval
  // time; `locationVerifiedBy` is the admin's `auth.uid`.
  locationVerifiedAt?: number;
  locationVerifiedBy?: string;
  // PR-NEXT-SHOP-LOCATION-EDIT — capture source of the live pin so
  // the admin verification surface can render "Source: device GPS"
  // vs "Source: typed address" alongside the reverse-geocoded
  // address. Stamped at `registerShop` time and re-stamped when
  // `approvePendingShopLocation` promotes a pending pin to live.
  // Optional / nullable: legacy shops predate the field and the
  // admin UI shows "Source: unknown" in that case.
  locationSource?: 'gps' | 'geocoded' | null;
  // PR-NEXT-SHOP-LOCATION-EDIT — owner's proposed location change,
  // pending admin re-approval. All four fields are written together
  // by `submitPendingShopLocation` and cleared together by
  // approve / reject / cancel. Customers do NOT read these — the
  // live `location` stays authoritative until approval flips it.
  // Schema-additive: legacy active shops have no pending change and
  // simply lack the fields.
  pendingLocation?: { lat: number; lng: number } | null;
  pendingLocationSource?: 'gps' | 'geocoded' | null;
  pendingLocationSubmittedAt?: number | null;
  pendingLocationStatus?: 'pending' | null;
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
  // PR-NEXT-REVIEW-SYSTEM §A — published review cache for public listing.
  // Top-5 most-recent published reviews cached here so the shop
  // listing + ShopReviewsScreen can render without a sub-collection
  // read on every load. Cleared and rebuilt by amendRating /
  // acknowledgeReview / publishTimedOutReviews on each publish.
  publicReviewCount?: number;
  publicReviewLatest?: Array<{
    ratingId: string;
    stars: number;
    comment?: string | null;
    customerName?: string | null;
    publishedAt: number;
    responseText?: string | null;
  }>;
  // PR-NEXT-LOW-RATING-PUSH §A — per-shop notification threshold
  // override. When null/undefined, falls back to
  // appConfig/ratingAlerts.shopDefaultThreshold (default 3).
  // Schema-additive; absent on legacy shops.
  lowRatingThreshold?: number | null;
  lowRatingNotificationsEnabled?: boolean | null;
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
  // PR 42.1 — rolling delivery partner rating, populated by
  // `submitOrderRating`'s multi-write transaction when a customer
  // rates the delivery dimension of a delivered order. Only
  // meaningful for users with `isDelivery === true`; the
  // `listAllUsers` callable projects these off `users/{uid}` and
  // they remain `undefined` for non-delivery users (admins,
  // customers, shop owners).
  //
  // Undefined / 0 means "no ratings yet" — UserDetailScreen
  // suppresses the row in that case so a brand-new delivery
  // partner doesn't surface a misleading "0★" badge.
  deliveryRatingAvg?: number;
  deliveryRatingCount?: number;
  // PR-NEXT-BUNDLE-G §D — partner profile photo URL for admin display.
  profilePhotoUrl?: string | null;
  // PR-NEXT-REVIEW-SYSTEM §A — published delivery partner review cache.
  publicReviewCount?: number;
  publicReviewLatest?: Array<{
    ratingId: string;
    stars: number;
    comment?: string | null;
    customerName?: string | null;
    publishedAt: number;
    responseText?: string | null;
  }>;
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
  // PR-NEXT-4 (finding #5) — soft-delete timestamp. Written by
  // `removeMenuItem` (both custom + global items use the unified
  // soft-delete now). All menu listings (`listMyShopMenu`,
  // `listShopMenuPublic`, `searchMenuPublic`,
  // `bulkUpdateMenuAvailability`'s candidate query) filter
  // `deletedAt == null` server-side via the pure helper
  // `excludeDeleted` from `src/utils/menuListingHelpers.ts`, so a
  // deleted item effectively disappears from every read surface.
  // Order history is unaffected because `CartItem` snapshots
  // name/price/imageUrl at order-time — orders never read back from
  // the live menu doc. Optional / back-compat: legacy menu items
  // without the field are treated as not-deleted (no migration
  // needed). Same posture as `paidMethod` (PR-NEXT-3).
  deletedAt?: number | null;
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
  // PR 46 — optional GPS pin captured at address-save time via
  // expo-location ("Use my current location" button in
  // AddressEditScreen). When present, CheckoutScreen uses these
  // coords to compute the delivery distance + duration estimate.
  // When absent (legacy addresses, or saved before PR 46 shipped),
  // checkout falls back to the customer's live GPS at order time
  // and shows a "using current location for delivery" note. Both
  // paths still record the addressId on the order's locked
  // DeliveryLocation so analytics can trace which saved address
  // the customer picked, even when the coords came from live GPS.
  //
  // Draggable map pin (react-native-maps) is intentionally NOT in
  // PR 46 — that's a follow-up so this PR stays OTA-safe (no new
  // native modules). Until then, "Use my current location" is the
  // only way coords land on a saved address.
  lat?: number;
  lng?: number;
};

// PR 46 — locked delivery location stamped onto an Order at
// checkout time. Server is authoritative for `lat`/`lng` (placeOrder
// re-derives them from the chosen source so a tampered client can't
// fake a short distance to dodge future tier-based delivery
// charges in PR 47). The combination of `type` + `addressId` records
// WHICH source the customer picked — useful for analytics ("how
// often do customers override their saved address with live GPS at
// checkout?") even when the coords ultimately came from GPS.
//
// `label` is the human-readable display string snapshotted at order
// time. It does NOT live-track changes the customer makes to their
// saved address book afterwards (the whole point of "locked").
export type DeliveryLocation = {
  lat: number;
  lng: number;
  type: 'saved_address' | 'current_location';
  // Present when `type === 'saved_address'`. Allows tracing back to
  // the source SavedAddress row even though the row's coords may
  // drift afterwards (or may have been absent at checkout time and
  // backfilled from live GPS).
  addressId?: string;
  // Display snapshot — locked at order time. Examples:
  //   - "Home" (saved-address label)
  //   - "Current location" (current_location with no reverse-geocode)
  //   - "Near Sector 12, Ballabgarh" (current_location with future
  //     reverse-geocode wired in)
  label: string;
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
  // PR-NEXT-PARTNER-PHOTO §C — mandatory face photo URL submitted at
  // onboarding. Optional here for back-compat with legacy requests.
  profilePhotoUrl?: string;
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
  // PR-NEXT-LOW-RATING-PUSH §A — per-partner threshold override.
  // Customer users may have these set too but they have no effect
  // (no fan-out targets a customer). Schema-additive.
  lowRatingThreshold?: number | null;
  lowRatingNotificationsEnabled?: boolean | null;
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
  // PR 47 — server-computed tiered delivery charge. New orders get
  // this stamped alongside `deliveryFee` (which mirrors it for
  // back-compat — every existing reader of `order.deliveryFee` keeps
  // working unchanged). Pre-PR-47 orders predate this; readers that
  // need the explicit field should fall back to `deliveryFee`.
  deliveryCharge?: number;
  total: number;
  deliveryAddress: Address;
  // PR 46 — locked delivery location. Optional for back-compat
  // with pre-PR-46 orders (which only carry `deliveryAddress`).
  // Stamped server-side at placeOrder time and never mutated
  // afterwards — even if the customer edits the source saved
  // address, the order keeps the snapshot it was placed against.
  // PR 47 will read `deliveryDistanceKm` to compute the
  // distance-based delivery charge; until then the charge is
  // still flat `shop.deliveryFee` and these three fields are
  // observability/data-capture only.
  deliveryLocation?: DeliveryLocation;
  // Road distance (shop → delivery location), in km. Server-
  // authoritative — re-derived in placeOrder via
  // computeDeliveryEstimate, never trusted from the client.
  // Source partition (Distance Matrix vs haversine fallback) is
  // logged on the server-side audit, not stamped on the order
  // doc itself (kept the wire shape minimal). Missing on
  // pre-PR-46 orders.
  deliveryDistanceKm?: number;
  // Estimated drive time (shop → delivery location), in minutes.
  // PR 51+ will surface this in the post-acceptance ETA
  // computation; PR 46 captures the field but does not yet wire
  // it into the orderEtaDisplay helper.
  deliveryDurationMin?: number;
  // PR 49 — shop pickup coordinate, snapshotted at order time so the
  // delivery partner can compute the partner→shop leg + sort pickups
  // nearest-first without a shop-doc read per order. OPTIONAL /
  // back-compat: omitted when the shop had no `location` (legacy
  // seeded shops) or on pre-PR-49 orders. Locked at order time, like
  // every other geo field on this doc (design decision #1 in
  // GEO_DISTANCE_SYSTEM_DESIGN.md).
  shopLocation?: GeoPoint;
  paymentMethod: PaymentMethod;
  // Present for online orders; COD orders may omit these entirely.
  paymentStatus?: PaymentStatus;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  paidAt?: number;
  // PR-NEXT-3 — actual settlement method, set when paymentStatus
  // flips to 'paid'. For COD orders the customer converts to online
  // mid-flow via `payCodOrder` → `'online'`. For COD orders the
  // delivery partner confirms cash for via `confirmCodPayment` →
  // `'cash'` (or `'online'` if partner accepts UPI directly outside
  // the app). For regular online-from-checkout orders → `'online'`
  // (stamped by `confirmPayment` post-write). MISSING for legacy
  // orders predating this PR. `paymentMethod` stays the customer's
  // ORIGINAL choice (preserved as an analytics signal per finding
  // #12 locked design); `paidMethod` is the actual settlement.
  paidMethod?: 'cash' | 'online';
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
  // PR-NEXT-13a — denormalized partner displayName captured at claim
  // time. Set by `claimDelivery` immediately after the atomic
  // transaction succeeds; absent on legacy / mid-flight orders or on
  // partners whose user doc doesn't have a `displayName`. Customer
  // renders this on `OrderDetailScreen` via `PartnerIdentityCard` as
  // soon as the partner claims, not waiting for pickup.
  //
  // Why denormalize (not look up `users/{deliveryPersonId}` from the
  // client): the customer's order watcher is a single-doc subscription;
  // adding a partner-user-doc lookup would double the read cost on
  // every order render. The denormalization is a one-time write at
  // claim time. If the partner later renames themselves, this snapshot
  // stays — order documents are historical records.
  deliveryPersonName?: string;
  // PR-NEXT-PARTNER-CARD.2 — partner trust signals, denormalized
  // alongside `deliveryPersonName` at claim time. Drive the WHO line
  // ("⭐ 4.8 · 142 deliveries") and vehicle glyph (🛵 / 🚲 / 🚶 / 🚗)
  // in `PartnerDetailsSheet` without a per-open `users/{partnerUid}`
  // lookup. All three are optional (legacy orders claimed pre-this-PR
  // omit them) AND nullable (a partial partner doc — no rating yet,
  // no vehicleType set — still claims successfully and the sheet
  // falls back to the "New partner · welcome them!" / 🛵 default
  // copy via `formatPartnerTrust`). Numbers are server-validated by
  // `denormalizePartnerTrust` so the client can trust the types
  // without re-checking `Number.isFinite`.
  deliveryPersonRating?: number | null;
  deliveryPersonDeliveriesCount?: number | null;
  deliveryPersonVehicleType?:
    | 'motorbike'
    | 'bicycle'
    | 'on_foot'
    | 'car'
    | null;
  // PR-NEXT-PARTNER-PHOTO §E — partner face photo URL, denormalized
  // at claim time alongside the other trust signals. Nullable /
  // optional: legacy orders (pre-this-PR) and partners who skipped
  // onboarding before the photo was mandatory omit this field. Caller
  // must fall back to the initials avatar via `formatPartnerAvatar`.
  deliveryPersonPhotoUrl?: string | null;
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
  //
  // PR 42.1 — this legacy nested object is now READ-ONLY historical
  // for orders rated before PR 42.1 shipped. New ratings write
  // exclusively to the flat `shopRating` / `deliveryRating` fields
  // below (single source of truth: server `submitOrderRating`
  // always writes the new schema regardless of input shape). The
  // server's already-rated check spans BOTH `rating` (legacy) and
  // `shopRating` (new) so submit-once works across the cutover.
  rating?: OrderRating;

  // PR 42.1 — separate shop + delivery partner ratings. Flat
  // fields rather than nested objects (intentional break with the
  // PR 20 `rating: OrderRating` nesting): the dual-rating UI sets
  // them independently and the Firestore writes target each field
  // individually inside the multi-write transaction, so the flat
  // shape removes one level of indirection. `ratedAt` becomes
  // `updatedAt` on the order doc (already maintained) — we don't
  // duplicate the timestamp per dimension.
  //
  // `shopRating` is REQUIRED for any new rating submission; the
  // server rejects a submission that has only `deliveryRating`.
  shopRating?: 1 | 2 | 3 | 4 | 5;
  shopComment?: string;

  // `deliveryRating` is optional even on dual-submit — if the
  // customer didn't see the delivery partner (gate-handoff, e.g.)
  // they may legitimately skip this dimension. Also auto-dropped
  // server-side if the order has no `deliveryPersonId` (the
  // shop rating still goes through; we log a warning rather than
  // failing the whole submission).
  deliveryRating?: 1 | 2 | 3 | 4 | 5;
  deliveryComment?: string;
  // PR-NEXT-REVIEW-SYSTEM §A — correction state machine for low-rating
  // reviews. Fields are absent on legacy orders (treated as
  // 'published' by inference). All optional + nullable for
  // back-compat. correctionState is the authoritative signal;
  // the remaining fields are populated as the state advances.
  correctionState?: 'submitted' | 'flagged_low' | 'responded' | 'amended' | 'published' | null;
  responseText?: string | null;
  responseBy?: 'shop' | 'partner' | null;
  responseAt?: number | null;
  // PR-NEXT-BUNDLE-J §L — DO NOT REMOVE. Per-dimension correction state +
  // response. The legacy fields above are the worst-of / last-responder
  // pointers kept for un-migrated readers; these are the per-side truth so
  // the shop never sees the partner's response (and vice-versa) and one
  // side resolving never closes the other (Sudhir 2026-06-10).
  shopCorrectionState?: 'flagged_low' | 'responded' | 'amended' | 'published' | 'n_a' | null;
  deliveryCorrectionState?: 'flagged_low' | 'responded' | 'amended' | 'published' | 'n_a' | null;
  shopResponseText?: string | null;
  partnerResponseText?: string | null;
  shopRespondedAt?: number | null;
  partnerRespondedAt?: number | null;
  amendedStars?: { shopStars?: number; deliveryStars?: number } | null;
  amendedAt?: number | null;
  publishedAt?: number | null;
  publishedReason?: 'above_threshold' | 'customer_acknowledged' | 'customer_amended' | 'timeout' | null;
  // PR-NEXT-REVIEW-SYSTEM §A — ratingId for the reviews sub-collection
  // document written by submitOrderRating. Stored on the order doc
  // so callables can look up the review without an extra query.
  ratingId?: string | null;
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

  // PR-NEXT-6 (findings #13, #16) — delivery proof photo. Storage
  // path only; read URLs are minted on demand by
  // `getDeliveryProofReadUrl` so leaked URLs go stale (15-min
  // expiry). Path scheme is `delivery-proofs/{orderId}.jpg` — one
  // photo per order, re-upload overwrites cleanly. Optional /
  // schema-additive (Rule 4): photo is OPTIONAL by design — the
  // partner can deliver without one, and `markDelivered` does NOT
  // require this field. Pre-PR-NEXT-6 orders have it absent.
  //
  // DO NOT add a long-lived `deliveryProofUrl` field here — storing
  // a permanent URL would defeat the signed-read-URL security
  // model (delivery photos are PII-adjacent: doorstep / building
  // / customer-handoff imagery).
  deliveryProofStoragePath?: string;
  // Timestamp of the most recent upload (millis since epoch). Set
  // by `recordDeliveryProofUpload` via serverTimestamp(). Bumps on
  // re-upload (overwrite at the same storagePath).
  deliveryProofUploadedAt?: number | null;

  // PR-NEXT-PARTNER-HEADS-UP — idempotency marker. Set by the
  // `sendPickupHeadsUpToDelivery` trigger on first successful fan-out.
  // Once set, subsequent updates to the order doc that keep status
  // at 'accepted' don't re-fire the push. Cleared if the order is
  // rejected back to 'pending' (rare) so a re-acceptance can re-push.
  // Optional / schema-additive: absent on legacy orders and on orders
  // accepted before this PR ships.
  headsUpSentAt?: number | null;
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

// PR 36 — Customer CRM rollup row, returned by the
// `listShopCustomers` callable. One row per customerUid for ONE
// shop. Mirrors the server-side type in
// `functions/src/customerCrmHelpers.ts`; kept here so client
// screens don't reach into the functions package.
export type ShopCustomer = {
  uid: string;
  phone: string | null;
  displayName: string | null;
  orderCount: number;
  totalSpent: number; // rupees
  firstOrderAt: number; // epoch ms
  lastOrderAt: number; // epoch ms
};

// PR-NEXT-BUNDLE-K — DO NOT REMOVE. Master catalog product shape.
// Lives in `products/{productId}` (global, not per-shop).
// `status` defaults to 'approved' for admin-seeded items and is
// 'pending' for shop-proposed items awaiting admin review.
// `proposedBy` / `proposedAt` are only set for pending items.
export type ProductStatus = 'approved' | 'pending' | 'rejected';

export type MasterProduct = {
  id: string;
  name: string;
  brand?: string | null;
  category: CategoryId;
  packSize: { value: number; unit: string };
  mrp: number;
  imageUrl?: string | null;
  // PR-NEXT-BUNDLE-K §A — status field (schema-additive; seeded
  // items default to 'approved' via backfill-products-status.ts).
  status: ProductStatus;
  // PR-NEXT-BUNDLE-K §B.4 — only set when status == 'pending'.
  proposedBy?: string | null;
  proposedAt?: number | null;
  reviewedAt?: number | null;
  reviewedBy?: string | null;
  rejectionReason?: string | null;
};

// PR-NEXT-BUNDLE-K — DO NOT REMOVE. Per-shop onboarding progress
// doc at `shops/{shopId}/onboardingState/catalog`.
export type OnboardingCatalogState = {
  categoriesCompleted: string[];
  lastCategoryViewed: string | null;
  lastItemViewedInCategory: string | null;
  itemsAdded: number;
  startedAt: number;
  updatedAt: number;
};

// PR-NEXT-BUNDLE-K — DO NOT REMOVE. Price draft for in-memory
// catalog browse (flushed to Firestore via commitShopMenuItemsBulk
// on the review screen).
export type PriceDraft = {
  productId: string;
  price: number;
  product: MasterProduct;
};
