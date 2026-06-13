# FEATURES.md — Kirana Mart feature catalog

**Purpose:** Single high-level inventory of every feature the app
ships today, organised by the four panels (customer, shop, delivery,
admin) plus cross-cutting/system. As the product grows this is the
map — we look here first when someone asks "do we already do X?"
before designing anything new.

**Scope:** *What* the app does, not *how*. Two-line descriptions max
per feature. PR/source references link back to the prompt that
shipped it for traceability.

**Maintenance protocol (read before editing):**

- **Every PR prompt must include explicit FEATURES.md instructions
  in its doc trail section.** This is `PROMPT_AUTHORING_NOTES.md`
  Rule 8 — mandatory. If a prompt doesn't mention FEATURES.md, the
  prompt is incomplete. Even hotfixes that don't change behaviour
  must say "FEATURES.md — no row change; verify accuracy."
- Removals are **strikethroughs**, not deletions — `~~text~~ —
  removed in PR-N` — so we keep the history of what we tried.
- Source column uses the most recent PR that materially changed
  the feature. Earlier provenance lives in SESSION_LOG.
- Status tags: **shipped** (live in app), **dev-only** (gated to
  test accounts), **flagged** (behind appConfig kill-switch),
  **deferred** (designed but waiting on a trigger).
- Last updated stamp at the bottom of each panel section is bumped
  to the deploy date of any PR that touched a row in that section.
- HTML comments like `<!-- HOTFIX-PROFILE-PHOTO 2026-06-10 -->`
  next to recently-touched rows give a lineage trail without
  cluttering the table columns.

**Companion docs:**

- `CLAUDE.md` — current in-flight work + state
- `docs/SESSION_LOG.md` — chronological session log
- `docs/ROADMAP.md` — what we plan to build next
- `PRELAUNCH_CHECKLIST.md` — pilot/launch gating checklist
- `docs/pr-*.md` — per-PR implementation prompts

---

## 1. Customer panel

### 1.1 Account & identity

| Feature | Description | Source | Status |
| --- | --- | --- | --- |
| Phone OTP sign-in | Firebase phone auth; +91 India + +1 US supported | PR 1, PR 18 | shipped |
| Anonymous browsing | Shop list + shop detail viewable without sign-in; auth required only at checkout | PR 8 | shipped |
| Profile (name + photo) | Editable display name; default to phone fallback | PR 14 | shipped |
| Multi-role on one phone | Single account can hold customer + shop + delivery + admin claims | PR 23 | shipped |
| QuickSwitch (test accounts) | Dev-only modal to swap between 9 pre-provisioned test accounts (6 IN, 3 US) | PR 23, 2026-06-02 rebuild | dev-only |
| Sign-out + push-token cleanup | Removes Expo push token on sign-out so old sessions don't get notifications | PR 24 | shipped |

### 1.2 Address book

| Feature | Description | Source | Status |
| --- | --- | --- | --- |
| Saved addresses with GPS pin | Add Home/Work/Other with reverse-geocoded address + lat/lng | PR 9, PR 19 | shipped |
| Default address | Pin one address as default; used as fallback for delivery-fee preview | PR 19 | shipped |
| Current-location address quick-save | Modal after first order asks if you want to save the GPS pin used | ADDRESS-UX.1 | shipped |
| Address dedupe on save | 25m threshold — if close to existing, toast "already in book" and skip | HOTFIX-10 | shipped |
| Edit + delete addresses | Standard CRUD with confirmation | PR 19 | shipped |

### 1.3 Home / discovery

| Feature | Description | Source | Status |
| --- | --- | --- | --- |
| Personalised greeting | "Hello, {name} 👋" with name → first-name → test-label → null fallback | 2026-06-02 polish | shipped |
| Active order banner | Compact 60px banner above fold showing in-flight order status; tap → OrderDetail | Bundle F §A | shipped |
| Recent shops strip | Horizontal scroll of recently-visited shops; tap → ShopDetail | Bundle F §B | shipped |
| Compact location bar | Current delivery location chip with change action | Bundle F §C | shipped |
| Role tiles (launcher) | Multi-role users see admin / shop / delivery tiles to enter those panels | PR 23 | shipped |
| Favorites tile | Quick access to favorited shops | PR 13 | shipped |

### 1.4 Shop browse

| Feature | Description | Source | Status |
| --- | --- | --- | --- |
| Shop list (browse surface) | Dominant list of in-radius shops; primary discovery screen | Bundle F §D | shipped |
| Distance-based filtering | Only shows shops within their own service radius from customer location | PR 48, SHOP-LOCATION-REQUIRED | shipped |
| Customer location preference | Default saved address → live GPS → null fallback | PR-NEXT-BUNDLE-A | shipped |
| Sort options | Nearest / Best rated / Most reviewed | Bundle F §D | shipped |
| Category chip filter | Filter shops by category (grocery / produce / dairy / etc.) | PR 16 | shipped |
| Product search across shops | Search bar surfaces matching products and the shops carrying them | PR 17 | shipped |
| Favorite a shop | Heart toggle on ShopCard; saved per-user | PR 13 | shipped |

### 1.5 Shop detail

| Feature | Description | Source | Status |
| --- | --- | --- | --- |
| Shop info + storefront photo | Name, address, hours, cover image | PR 42 | shipped |
| Distance + delivery charge preview | Tier-based fee shown before adding items | HOTFIX-6, PR 47 | shipped |
| Tappable rating row | `⭐ 4.7 (12)` → ShopReviewsScreen | PR-5, Bundle E §E | shipped |
| Menu items by category | Section list with category headers | PR 11 | shipped |
| Category chip filter (in-shop) | Filter menu items within a single shop | ENH-3 | shipped |
| Menu search | Search within a single shop's menu | PR 17 | shipped |
| Recent search history (per shop) | Last few queries surfaced as chips | ENH-3 | shipped |
| Item availability state | Out-of-stock items shown disabled with badge | PR 11 | shipped |

### 1.6 Cart & checkout

| Feature | Description | Source | Status |
| --- | --- | --- | --- |
| Single-shop cart guard | Adding from a different shop prompts to clear current cart | PR 11 | shipped |
| Item quantity controls | +/- with min/max gates | PR 11 | shipped |
| Bill details with delivery fee | Live distance-based delivery fee using snapshot of shop pin | HOTFIX-6, HOTFIX-6.1 | shipped |
| Substitution preference | Per-order: best alternative / refund if unavailable | PR 21 | shipped |
| Delivery instructions | Free-text note attached to order | PR 22 | shipped |
| Place Order race guard | Disabled while GPS is being captured for "use current location" | HOTFIX-9 | shipped |
| Place Order proper address | Reverse-geocodes live GPS so address shown matches GPS pin used | HOTFIX-8 | shipped |
| Reorder from past orders | "Reorder" CTA on past OrderDetail rebuilds cart | PR 13 | shipped |

### 1.7 Payments

| Feature | Description | Source | Status |
| --- | --- | --- | --- |
| Cash on Delivery (COD) | Default; partner collects at handoff | PR 7 | shipped |
| Razorpay online payment | Card / UPI / netbanking via Razorpay SDK | PR 15 | shipped (test keys) |
| COD → online conversion | Customer can switch to online payment mid-flow if still pending | PR-NEXT-COD-UX | shipped |
| Razorpay webhook reconciliation | Server-side payment-state truth via webhooks | PR 15 | shipped |

### 1.8 Order tracking

| Feature | Description | Source | Status |
| --- | --- | --- | --- |
| Order detail with status timeline | Pending → accepted → preparing → ready → picked → delivered | PR 12 | shipped |
| Ready-by ETA from shop | Shop's set ETA shown until status passes ready_for_pickup | PR 14, Bundle A §B | shipped |
| Live partner ETA | Server-computed live ETA + distance; 30s polling, auto-pauses | PARTNER-CARD.2 | shipped |
| Static map preview | Google Static Maps thumbnail with shop pin + drop pin | PR-3 | shipped |
| Partner card | Photo, name, rating, vehicle, ETA — tappable rating → reviews | PR-2, PARTNER-CARD.2, PR-NEXT-PARTNER-PHOTO | shipped |
| One-tap call partner | Post-pickup only; reveals number + opens dialer in same tap | Bundle B §B | shipped |
| Order status push notifications | Accepted / partner-claimed / picked-up / out-for-delivery / delivered | PR 25, NOTIFY-EXTEND, HOTFIX-4 | shipped |
| Push deep-link | Tap notification → opens specific OrderDetail | PR 25 | shipped |
| Customer cancel window | Cancel allowed only before shop accepts | PR 7 | shipped |

### 1.9 Ratings & reviews

| Feature | Description | Source | Status |
| --- | --- | --- | --- |
| Submit rating after delivery | Separate shop + delivery stars, optional comment, single submission | PR-5 | shipped |
| Rate Order card on OrderDetail | Inline card surfaces immediately after delivered status | PR-5, Bundle A §D | shipped |
| Shop reviews screen | Public list of published reviews for a shop | PR-5 §F | shipped |
| Partner reviews screen | Public list of published reviews for a delivery partner | PR-5 §D | shipped |
| Low-rating correction workflow | Low ratings (≤3) hidden until shop responds; customer can amend or acknowledge | PR-5, PR-5.1 | shipped |
| 7-day auto-publish | Unresolved low ratings publish automatically after 7 days | PR-5 scheduled function | shipped |

_Customer panel last updated: 2026-06-10_

---

## 2. Shop owner panel

### 2.1 Onboarding & approval

| Feature | Description | Source | Status |
| --- | --- | --- | --- |
| Shop registration | Name, category, address, contact, hours form | PR 4 | shipped |
| KYC document upload | PAN / shop license / FSSAI photos | PR 31 | shipped |
| Storefront photo upload | Cover image for the shop list + shop detail | PR 42 | shipped |
| Dual location capture | "📍 Use my GPS" OR "🔍 Find from address" (geocodeAsync) | SHOP-LOCATION-EDIT §A | shipped |
| GPS source guard | Refuses fallback/IP-derived coords; requires real GPS fix | HOTFIX-FALLBACK-LEAK | shipped |
| Admin approval flow | Pending until admin verifies and approves | PR 4, SHOP-LOCATION-REQUIRED | shipped |

### 2.2 Order management

| Feature | Description | Source | Status |
| --- | --- | --- | --- |
| Shop dashboard | Pending / preparing / ready / completed sections | PR 7 | shipped |
| Order detail | Items, substitution prefs, instructions, customer name + phone | PR 12 | shipped |
| Status transitions | Accept → preparing → ready_for_pickup → delivered | PR 7 | shipped |
| Ready-by ETA on accept | Shop sets prep ETA at accept time | Bundle A §B | shipped |
| Customer address with map | Full delivery address + optional 📍 GPS-pin banner with maps deeplink | HOTFIX-8 | shipped |
| Partner card on order detail | Photo, name, rating row (tappable → reviews), vehicle, live ETA | Bundle E §A | shipped |
| One-tap call partner | Same flow as customer; post-pickup only | Bundle E §C, Bundle B §B | shipped |
| Customer rating display | Stars + comment block on completed order detail | Bundle E §B | shipped |
| New-order push | FCM/APNs notification when customer places order; deep-links to detail | HOTFIX-5, PR 25 | shipped |
| Reject / cancel order | With reason; refund triggers automatically if pre-paid | PR 7 | shipped |

### 2.3 Menu management

| Feature | Description | Source | Status |
| --- | --- | --- | --- |
| Menu item CRUD | Add / edit / disable / delete items per shop | PR 11 | shipped |
| Bootstrap from global products | Pre-populate menu from shared SKU library | PR 11 | shipped |
| Categories + sub-categories | Group items for browse + filter | PR 11 | shipped |
| Bulk actions | Enable / disable / delete multiple items at once with smart labels | ENH-1, ENH-2 | shipped |
| Menu search | Search across own menu | PR 17 | shipped |
| Recent search history | Per-shop search history surfaces as chips | ENH-3 | shipped |
| Item photo upload | Per-item image with library/camera | PR 11 | shipped |
| Guided catalog onboarding | `BuildCatalog` hub → per-category **table view** (`CategoryList`): inline ₹ field + one-tap MRP + voice pricing → `CatalogReview` bulk commit. Catalog now **hides items already in the shop's menu** (it's a picker for new items only; existing items are edited via the Menu screen). Category tiles show "X to add" / "All added ✓" based on the shop's current menu. | Bundle K, K.1, HOTFIX-K1 §A | shipped |
| Voice price capture (table) | **Single-tap-per-category**: tap once to start, speak prices for each row in turn (focus auto-advances after each capture), say "stop"/"बंद"/"done" or tap stop to end. Continuous recorder auto-restarts between utterances; safety auto-stop after 8s of silence prevents forgotten-mic battery drain. | Bundle K.1 §C, HOTFIX-K1 §B | shipped |
| Catalog PDF + paper workflow | Shop owners tap **"Print blank catalog"** on `BuildCatalog` → `generateCatalogPdf` builds a printable PDF (one page per category, product name + brand + pack + MRP + a blank "Your price" box per row, plus a per-page QR encoding shopId/page/category/productIds). They print, fill prices by hand, then **"Scan filled catalog"** (`ScanCatalogPages`) photographs each page → `extractCatalogPagePrices` (Claude vision) reads the handwriting → extracted prices land in the existing `CatalogReview` for commit. Same convergence as voice/inline/scan-menu. Quotas: 5 PDFs/day + 30 page-scans/day per shop (`aiQuotas`). | Bundle L | shipped |

### 2.4 Shop settings

| Feature | Description | Source | Status |
| --- | --- | --- | --- |
| Edit shop profile | Name, hours, contact, categories | PR 14 | shipped |
| Location update workflow | Edit shop pin → submit for admin re-approval; old pin live until approved | SHOP-LOCATION-EDIT §B | shipped |
| Delivery charge tier | Configure km-band fee schedule (0-1km / 1-2km / 2-3km / 3km+) | PR 47 | shipped |
| Service radius | Set max delivery distance; shops outside customer's radius are hidden | PR 48 | shipped |
| Open/closed toggle | Manually mark shop closed for the day | PR 14 | shipped |
| Low-rating push threshold | Opt-in + threshold (e.g. alert on ≤2 stars) | PR-4 | shipped |

### 2.5 Reviews

| Feature | Description | Source | Status |
| --- | --- | --- | --- |
| Respond to low rating | Modal to add response text; pre-publishes the review | PR-5.1 §A, §C | shipped |
| See public reviews | Read-only list of own shop reviews | PR-5 §F | shipped |
| Low-rating push alert | Notification when threshold breached, deep-links to response modal | PR-4 | shipped |

_Shop panel last updated: 2026-06-10_

---

## 3. Delivery partner panel

### 3.1 Onboarding & approval

| Feature | Description | Source | Status |
| --- | --- | --- | --- |
| Become-partner form | Name, phone, vehicle type | PR 5 | shipped |
| Mandatory profile photo | Required upload at onboarding; signed-URL flow | PR-2 PARTNER-PHOTO | shipped |
| Vehicle type | Motorbike / bicycle / on-foot / car | PARTNER-CARD.2 | shipped |
| Admin approval | Pending until admin verifies photo + claim grant | PR 5 | shipped |

### 3.2 Navigation shell

| Feature | Description | Source | Status |
| --- | --- | --- | --- |
| 4-tab bottom nav | Home / Earnings / Profile / Settings | Bundle D §A | shipped |

### 3.3 Home / dashboard

| Feature | Description | Source | Status |
| --- | --- | --- | --- |
| Coming Up section | Orders currently in prep at shops in radius; preparing-first sort | PR-1 PARTNER-HEADS-UP, Bundle D §E | shipped |
| Available Pickups section | Ready-for-pickup orders in radius, unclaimed | PR 6 | shipped |
| My Deliveries section | Orders currently claimed by this partner | PR 6 | shipped |
| Sort/filter chips | All / Nearest / Highest pay / Newest | Bundle D §E | shipped |
| Earning amount per card | Per-delivery payout amount surfaced on every order card | Bundle D §E | shipped |
| Distance per card | Distance from current location to shop / drop pin | PR 49 | shipped |
| Heads-up push on accept | Notification fires when shop accepts; surfaces in Coming Up | PR-1 | shipped |
| New-pickup push at ready | Notification when an order goes ready_for_pickup in radius | PR 50 | shipped |
| Live location reporting | Background GPS sample posted while delivering an order | PR 49 | shipped |

### 3.4 Earnings (new tab)

| Feature | Description | Source | Status |
| --- | --- | --- | --- |
| Today summary | Total earnings + deliveries today | Bundle D §D | shipped |
| This week summary | Total earnings + deliveries this calendar week | Bundle D §D | shipped |
| Recent deliveries list | Paginated history with per-delivery amount + time + shop name | Bundle D §D | shipped |

### 3.5 Profile (new tab)

| Feature | Description | Source | Status |
| --- | --- | --- | --- |
| Edit photo | Re-upload partner photo (camera or library) | Bundle D §B | shipped |
| Edit display name | Change name shown to customer + shop | Bundle D §B | shipped |
| Edit vehicle type | Change vehicle icon shown on partner card | Bundle D §B | shipped |
| Rating + delivery count | Read-only display of own rating + lifetime deliveries | Bundle D §B | shipped |

### 3.6 Settings (new tab)

| Feature | Description | Source | Status |
| --- | --- | --- | --- |
| Low-rating alert opt-in | Toggle + threshold for own low-rating notifications | Bundle D §C, PR-4 | shipped |
| Sign out | With push-token cleanup | Bundle D §C, PR 24 | shipped |

### 3.7 Active delivery flow

| Feature | Description | Source | Status |
| --- | --- | --- | --- |
| Claim pickup | Atomically claims an available order; updates status to claimed | PR 6 | shipped |
| Mark Picked Up | Transitions order to out_for_delivery | PR 6 | shipped |
| Mark Delivered | Gated on proof photo present | Bundle B §C | shipped |
| Delivery proof photo | Camera upload before Delivered button enables | PR-NEXT-COD-UX, Bundle B §C | shipped |
| COD cash confirmation | Per-payment-mode confirmation flow before Delivered enables | PR-NEXT-COD-UX | shipped |
| Smart Delivered gating | Discriminated-union Result hints what's missing (proof / cash / UPI) | Bundle B §C | shipped |

### 3.8 Reviews

| Feature | Description | Source | Status |
| --- | --- | --- | --- |
| Respond to low rating | Modal to add response; pre-publishes the review | PR-5.1 §B, §C | shipped |
| See public reviews | Read-only list of own delivery reviews | PR-5 §D | shipped |

_Delivery panel last updated: 2026-06-10_

---

## 4. Admin panel

### 4.1 Order management

| Feature | Description | Source | Status |
| --- | --- | --- | --- |
| All orders list | Paginated list of every order across all shops | PR 8 | shipped |
| Order detail | Full order info including denormalized partner + customer info | PR 12 | shipped |
| Manual cancel + refund | Admin override on any order; triggers Razorpay refund if pre-paid | PR 7, PR 15 | shipped |
| Review thread on order | Chronological timeline: rating → response → amendment → final state | Bundle E §D | shipped |
| Order comment thread | ~~Customer/shop/partner comment surfacing on admin order detail~~ | _deferred to PR 42.1.2_ | deferred |

### 4.2 Shop moderation

| Feature | Description | Source | Status |
| --- | --- | --- | --- |
| Pending shop queue | List of shops awaiting first-time approval | PR 4 | shipped |
| Pending location-change queue | Shops with `pendingLocation` set awaiting re-approval | SHOP-LOCATION-EDIT §C | shipped |
| Approve/reject shop | Verification checkbox gate + map deeplink to inspect pin | SHOP-LOCATION-REQUIRED §D | shipped |
| Side-by-side location check | Owner-typed address vs reverse-geocoded pin shown side-by-side | SHOP-LOCATION-EDIT §C | shipped |
| Shop detail (admin) | Full shop record + KYC + location + rating rollup | PR 4, PR 31 | shipped |
| Drill-in to shop reviews | Tap `⭐ 4.7 (2)` → ShopReviewsScreen in admin mode (sees flagged_low too) | Bundle E §E | shipped |

### 4.3 Delivery partner moderation

| Feature | Description | Source | Status |
| --- | --- | --- | --- |
| Pending partners queue | Awaiting approval | PR 5 | shipped |
| Approve/reject partner | Photo review + verification gate before claim grant | PR-2 PARTNER-PHOTO | shipped |
| Partner detail (admin) | Lifetime deliveries + rating + recent orders | PR 5 | shipped |
| Drill-in to partner reviews | Tap rating → PartnerReviewsScreen in admin mode | Bundle E §E | shipped |

### 4.4 User management

| Feature | Description | Source | Status |
| --- | --- | --- | --- |
| All users list | Paginated; filter by role | PR 23 | shipped |
| Set/revoke role claims | Admin can grant or revoke customer/shop/delivery/admin roles | PR 23, scripts | shipped |
| User detail | Profile, addresses, role list, recent orders | PR 23 | shipped |

### 4.5 Configuration

| Feature | Description | Source | Status |
| --- | --- | --- | --- |
| `appConfig/shopVisibility.showAllShops` | Master switch to bypass distance filtering (debug) | PR 48 | flagged |
| `appConfig/distanceMatrix.enabled` | Kill-switch for Google Distance Matrix API usage | PR 46 | flagged (off) |
| `appConfig/pilotStatus.isLive` | Locks all reset scripts; flip when first real money order lands | PR 39.2 | flagged (off) |
| `appConfig/ratingAlerts.*` | Per-role thresholds + cooldown configuration | PR-4 | flagged |
| AI feature kill-switches | Per-feature toggles for any AI integration | PR 34 | flagged |

_Admin panel last updated: 2026-06-10_

---

## 5. Cross-cutting / system

### 5.1 Auth & identity

| Feature | Description | Source | Status |
| --- | --- | --- | --- |
| Firebase Auth (phone OTP) | Native Firebase SDK with reCAPTCHA disabled (dev) | PR 1 | shipped |
| Custom claims | `customer` / `shopOwner` / `delivery` / `admin` on auth token | PR 23 | shipped |
| Firestore mirror flags | `isCustomer` / `isShop` / `isDelivery` / `isAdmin` on user doc for query-side gates | PR 23, HOTFIX-5 | shipped |
| Phone-number normalisation | E.164 throughout; multi-region (+91, +1) | 2026-06-02 multi-region | shipped |

### 5.2 Push notifications

| Feature | Description | Source | Status |
| --- | --- | --- | --- |
| Expo Push pipeline | Push tokens registered per device per role | PR 25 | shipped |
| FCM (Android) | Firebase Cloud Messaging for Android delivery | PR 25 | shipped |
| APNs (iOS) | Apple Push for iOS delivery | PR 25 | shipped |
| Push deep-link | Tap → opens the specific screen referenced by `data.route` | PR 25 | shipped |
| Token cleanup on sign-out | Removes the token from user doc so old sessions stop receiving | PR 24 | shipped |
| Per-role topic routing | Notifications fan out only to the relevant role | NOTIFY-EXTEND | shipped |

### 5.3 Maps & geocoding

| Feature | Description | Source | Status |
| --- | --- | --- | --- |
| Reverse-geocoding | `Location.reverseGeocodeAsync` — free, no API key, on-device | PR 19, HOTFIX-8 | shipped |
| Forward geocoding | `Location.geocodeAsync` for "Find from address" shop pin capture | SHOP-LOCATION-EDIT §A | shipped |
| Google Static Maps | Server-rendered static map thumbnail (signed key) | PR-3 | shipped |
| Distance Matrix API | ~~Live driving distance / ETA~~ | PR 46 (dormant) | flagged (off) |
| Haversine distance | Pure helper for client-side and server-side straight-line distance | PR 48 | shipped |

### 5.4 Payments

| Feature | Description | Source | Status |
| --- | --- | --- | --- |
| Razorpay SDK | Native `react-native-razorpay` integration | PR 15 | shipped (test keys) |
| Razorpay webhook | Server-side payment-status truth | PR 15 | shipped |
| Refund automation | Auto-refund on cancellation or admin override | PR 7, PR 15 | shipped |

### 5.5 Observability

| Feature | Description | Source | Status |
| --- | --- | --- | --- |
| Sentry crash reporting | `@sentry/react-native` on client; logging on server | PR 30 | shipped |
| Audit log | Server-side audit trail for sensitive ops (cancel, refund, role grants) | PR 23 | shipped |
| AI audit log | Separate trail for any AI-mediated decision | PR 34 | shipped |

### 5.6 Internationalisation

| Feature | Description | Source | Status |
| --- | --- | --- | --- |
| Hindi + English UI | Toggleable language; persisted per user | PR 34 | shipped |
| Voice onboarding assist | Voice-guided onboarding for low-literacy users | PR 34 | shipped |

### 5.7 Deploy & build

| Feature | Description | Source | Status |
| --- | --- | --- | --- |
| EAS Build (iOS + Android) | Native builds via EAS profiles `preview` / `production` | PR 1 | shipped |
| EAS Update (OTA) | JS-only updates via `eas update --branch production` | PR 1 | shipped |
| EAS Submit (Android) | Service-account driven Play Console upload to internal track | 2026-06-09 eas.json | shipped |
| Server-first deploy ordering | Functions ship before any client that calls the new shape | discipline rule | shipped |

### 5.8 Security

| Feature | Description | Source | Status |
| --- | --- | --- | --- |
| Firestore security rules | Per-collection role gates; mirror flags for query filters | PR 23 | shipped |
| Storage rules | Per-path role + ownership gates for KYC / photos / proof | PR 31 | shipped |
| Cloud Run `allUsers` invoker | All public callables explicitly allUsers-bound (recurring strip hazard) | Rule 11 | shipped |
| App Check | ~~reCAPTCHA / DeviceCheck enforcement~~ | _deferred to post-pilot_ | deferred |

### 5.9 Operational scripts

| Feature | Description | Source | Status |
| --- | --- | --- | --- |
| `reset-test-data` | Full project wipe — users, auth, everything | PR 6 era | shipped |
| `reset-pilot-data` | Wipes orders/requests but keeps shops + users | PR-pilot | shipped |
| `reset-keep-catalog` | Keeps shops + menus + products + users; wipes transactional | 2026-06-02 | shipped |
| `delete-orders-only` | Surgical — orders only | older | shipped |
| `set-admin` / `set-shop-owner` / `set-delivery` | One-shot role-claim grants | scripts/ | shipped |
| `audit-shops-without-location` | Pre-deploy diagnostic for SHOP-LOCATION-REQUIRED | SHOP-LOCATION-REQUIRED | shipped |
| Live-pilot guard | All reset scripts refuse without `--i-know-pilot-is-live` once flag flipped | PR 39.2 | shipped |
| `backfill-deliveries-completed` | One-shot — sets `users/{uid}.deliveriesCompleted` from delivered-orders count | Bundle G §A | shipped |
| `backfill-public-rating-count` | One-shot — sets `shops/{shopId}.publicRatingCount` + `users/{uid}.publicDeliveryRatingCount` from published-only review counts | Bundle G §C | shipped |
| `backfill-review-denorm` | One-shot — re-syncs `orders/{orderId}` denorm fields from source-of-truth `reviews/{ratingId}` | HOTFIX-REVIEW-DENORM | shipped |
| `backfill-review-per-dimension` | One-shot — computes `shopCorrectionState` + `deliveryCorrectionState` from legacy single `correctionState` | Bundle J §J | shipped | <!-- Bundle J 2026-06-12 -->
| `post-deploy-smoke` | Read-only validator: callable existence + IAM allUsers binding + index Enabled status | HOTFIX-POST-DEPLOY-SMOKE-SCRIPT | shipped | <!-- HOTFIX-POST-DEPLOY-SMOKE-SCRIPT 2026-06-12 -->
| `backfill-products-status` | One-shot — sets `status: 'approved'` on every `products/` doc missing the field (idempotent) | Bundle K §A | shipped | <!-- Bundle K 2026-06-13 -->
| `cleanup-master-catalog-price-field` | One-shot — removes legacy `price` field from `products/` docs (per-shop pricing is authoritative in `shops/{shopId}/menu/`) | Bundle K §J | shipped | <!-- Bundle K 2026-06-13 -->

### 5.10 CI / Static-source guards

Permanent static guards that run on every `npm test`. Each catches a specific bug-class at compile time, before deploy.

| Guard | Bans | Source |
| --- | --- | --- |
| `authClaimNamesAudit` | `claims.is[A-Z]*` reads on auth tokens (use claim names, not user-doc mirror names) | Bundle G bonus |
| `noStaleDeferralComments` | "deferred to a future PR" comments in `src/` (shipped or remove the deferral) | Bundle H §F |
| `transactionReadOrderAudit` | `tx.get` after `tx.set` inside Firestore `runTransaction` (reads must precede writes) | HOTFIX-PUBLISH-TX-ORDER §C |
| `shopOwnerCheckAudit` | `where('ownerUid', '==', uid).limit(1)` antipattern (auth direction bug class — use direct shopId lookup) | HOTFIX-OWNER-CARD-AMEND §C |
| `partnerStatusAudit` | "On the way" / "Heading to" literal subtitle strings without finalized/delivered branch in scope | HOTFIX-PARTNER-STATUS-DISPLAY §C |
| `noSilentCatchAudit` | empty `.catch(() => {})` in `src/` outside `// silent-catch-audit:allow` lines | HOTFIX-SILENT-CATCH-GUARD §A |

### 5.11 Test infrastructure

| Feature | Description | Source | Status |
| --- | --- | --- | --- |
| Jest projects partition | Two-project split: `logic` (Node, pure helpers + static guards + functions/) and `components` (RN env, screens). `npm test` runs both; previously component tests crashed on parse | HOTFIX-JEST-PROJECTS-CONFIG | shipped |

_Cross-cutting last updated: 2026-06-12_

---

## 6. Deliberately deferred / out of scope

These have been designed-and-shelved or explicitly rejected. Listed
here so a future session doesn't accidentally re-litigate them.

| Feature | Reason / when to revisit |
| --- | --- |
| Multi-back-and-forth review threads | Single response from shop + customer amend/ack covers known issues — re-evaluate after 100 reviews |
| Direct in-app chat (customer ↔ partner / shop) | One-tap call CTA covers urgent contact — re-evaluate post-pilot |
| Bulk admin review moderation | Per-review modals only for now — re-evaluate when moderation queue exceeds 10/day |
| Push deep-link for admin role | Admin uses notification-less dashboard — re-evaluate if needed |
| Production Firebase project (`grocery-mvp-prod`) | Single project today; split triggers on first real-money order + launch-date commit |
| App Check enforcement | Debug token only in dev — flip pre-public-launch |
| Razorpay LIVE keys | Test keys today — flip pre-pilot |
| Admin BottomSheet migrations (4 screens) | Rule 13 audit-grep catches on next admin-touching PR |
| Partner `vehicleType` picker UI | Server-side data correct; UI picker shipped in Bundle D §B |
| PR 44 category photos | Blocked on Sudhir sourcing Pexels assets |

---

## 7. Maintenance checklist for future sessions

When closing a PR that touched user-facing behavior, before
committing:

1. **Add / edit / strike the feature row.** Use the table format of
   the section. Source column gets the new PR id.
2. **Update the panel's "last updated" stamp** at the end of the
   section.
3. **Cross-check against the PR's acceptance checklist** — anything
   in the checklist that doesn't have a corresponding row here means
   either the row is missing or the checklist item is non-user-facing.
4. **Removal goes to strikethrough**, not deletion. We want to know
   what we tried.
5. **Keep entries terse.** Two lines max per row. Detail lives in
   the PR prompt.
6. **One git commit can include the FEATURES.md update alongside
   the PR's other doc-trail edits** (CLAUDE.md, SESSION_LOG,
   PRELAUNCH_CHECKLIST).

If FEATURES.md ever drifts more than a couple of PRs out of date,
run a reconciliation pass: `git log --oneline --since="last entry
date" | head -30`, walk each PR, patch the relevant rows.

---

_Document last updated: 2026-06-10 — first cut covering everything
shipped through Bundle D / E / F + 11-of-11 findings closure._
