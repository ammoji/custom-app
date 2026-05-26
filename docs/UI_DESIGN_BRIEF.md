# UI Design Brief — HamaraSetu

> **App name:** HamaraSetu (हमारा सेतु — "Our Bridge")
> **Tagline:** *Shop Smart, Shop Local*
> **Parent entity:** Sara Stack Labs (contact: sarastacklabs@gmail.com)

> Self-contained brief for design tools (Figma AI, Galileo, Uizard, v0,
> ChatGPT, etc.). Paste this whole document as context, then ask for
> screen designs, component systems, or visual direction.

---

## 1. What we're building

A mobile app for **ordering groceries from neighborhood kirana shops**
(small family-run general stores) in India. Customers in a residential
mohalla / colony / society open the app, see the few kirana shops
around them, browse what each shop stocks, place an order, and get it
delivered within 30–60 minutes by a delivery partner the shop is
linked with.

This is **not** Zepto / Blinkit / Instamart. Those are dark-store
companies that own the inventory. We do the opposite: the *existing*
kirana shop in your lane is the inventory, the storefront, and the
brand. The app is the connective tissue — order capture, payment,
delivery routing, accountability — that lets a 60-year-old shop owner
serve customers who increasingly expect "two taps and it's at my
door."

**Mission North Star (drives every design decision):** *Make shop
onboarding so frictionless that a non-tech-savvy kirana shopkeeper
trusts the technology and stays.* If a customer screen is beautiful
but a shop owner abandons mid-registration, we have failed.

**Stage:** Pilot phase — first 5–10 shops in one Indian city. Public
launch later. The visual quality bar should feel like a real product
to family/test users and the first pilot shop owners, not an MVP.

## 2. Who uses the app (four roles, one app)

The same app shifts its main surface based on who's signed in.

1. **Customer** — orders groceries. The primary persona. Mix of urban
   millennials who use Swiggy/Zomato + housewives in their 40s–50s
   ordering from the same shop they've used for 20 years. Hindi /
   English / Hinglish all in play.
2. **Shopkeeper / Shop owner** — receives orders, marks items in
   stock or out of stock, prints/ships, manages their menu. Often
   45+ years old, may not be fluent in English, may have never used
   a "dashboard" before. Voice-first features exist (Hindi STT
   already shipped). Trust + simplicity > feature density.
3. **Delivery partner** — sees pending pickups, marks "picked up" /
   "delivered," handles cash-on-delivery. Usually a young man on a
   two-wheeler. Mostly Hindi.
4. **Admin** — Kirana Mart operations team. Approves new shop
   registrations (KYC), moderates listings, oversees orders, handles
   refunds and disputes. Desktop-style data density on a phone.

All four roles run in the same Expo / React Native app, gated by
Firebase custom claims.

## 3. Brand attributes / visual direction

Words we want the UI to feel like: **warm, trustworthy, neighborhood,
fast, mobile-first, Indian without being kitsch, modern without being
sterile.**

Words we want to avoid: corporate-bank, blue-tech-startup,
foreign-aid-NGO, generic-saas-dashboard, over-illustrated kid-app.

Cultural cues that matter:
- The shops are *named* family businesses ("Sharma General Store,"
  "Sunita Kirana"). The UI should celebrate the *shop's identity*,
  not flatten every shop into an interchangeable card.
- Hindi-English code-switch is normal — design must accommodate
  Devanagari script naturally next to Latin, ideally with both
  rendering nicely.
- Trust signals (verified shop, KYC done, "served 500 customers
  this month") matter more than discount banners. Indian customers
  trust shopkeepers they know personally; the app has to bridge
  that trust, not replace it.
- Money / price displays follow Indian conventions (₹ symbol, no
  decimal except for grams, lakh/crore for large totals).

Current implementation palette (can be refreshed but is the
starting point):
- Primary green `#0E7C3A` (kirana/trust association)
- Primary dark `#0A5E2C`
- Primary light tint `#E6F4EC`
- Neutral grays for surfaces / borders / text
- Status: success `#16A34A`, warning `#F59E0B`, danger `#DC2626`,
  info `#2563EB`

Open design questions we'd love ideas on:
- A warm accent (saffron / mustard / terracotta) to pair with the
  green primary, so the palette feels Indian instead of generic
  fintech-green.
- A logo / wordmark that works as the app icon AND as a small
  header mark.
- A typography pairing that handles both Latin and Devanagari
  gracefully (system font today; Noto Sans + Noto Sans Devanagari
  on the shortlist).
- Empty-state illustrations with an Indian neighborhood vibe (kirana
  shutter, sack of rice, scooter delivery) — but tasteful, not
  cartoonish.

## 4. Information architecture (navigation map)

The app uses a bottom tab bar that *changes* based on role.

**Customer tabs (bottom nav, 4 tabs):**
1. Home
2. Search
3. Orders
4. Profile

**Shop owner tabs:**
1. Dashboard (orders)
2. Menu
3. Customers (CRM)
4. Settings

**Delivery partner tabs:**
1. Dashboard (pending pickups)
2. (single role — no other tabs needed today)

**Admin tabs:**
1. Pending Shops
2. Shops
3. Orders
4. Users
5. (plus drill-in screens)

Any role can also open the role-switching menu if they have multiple
roles (e.g., admin who is also a customer).

## 5. Screen-by-screen inventory

Each screen below: one-line purpose + the main visual elements + the
key actions the user can take. Use this as the page list a designer
needs to mock up.

### 5.1 Auth & onboarding (shared)

**LoginScreen**
- Purpose: sign in with phone OTP (only auth method).
- Elements: phone number field with +91 prefix, "Send OTP" button,
  6-digit OTP entry with auto-fill, resend OTP timer, brand mark
  at top.
- Actions: enter phone → receive OTP → enter OTP → land on
  Home (customer flow by default).

### 5.2 Customer screens

**HomeScreen**
- Purpose: the first thing a customer sees. Today shows
  active-orders banner (if any) + nearby shops list + role-switch
  shortcut + (for shop owners) a "View shop dashboard" entry +
  (for admins) admin tools entry.
- Elements: location pill at top (current address, tappable to
  change), search bar shortcut, "Active order" banner (sticky
  near top when there's an in-flight order), shop cards (image,
  name, distance, rating, "open/closed" status), CTA to "List
  your shop" for non-shop-owners.
- Actions: tap shop → ShopDetail, tap search bar → Search,
  change location, view active order, switch role.

**SearchScreen**
- Purpose: search by item name across all shops, or browse by
  category.
- Elements: search field with debounce, category chip row
  (Atta & Rice, Oil & Ghee, Snacks, Dairy, Fruits & Veg, etc.),
  result list (item card with shop name + price), empty state
  for "no results."
- Actions: type query, tap category chip, tap result → ShopDetail
  scrolled to that item.

**ShopListScreen**
- Purpose: full list of nearby active shops with sort / filter.
- Elements: shop cards (same as Home), filter chips (Open now,
  Favorites — added in PR 36.1, Distance), sort selector.
- Actions: tap shop → ShopDetail, toggle favorite filter.

**ShopDetailScreen**
- Purpose: the shop's storefront. Browse menu, add items to cart.
- Elements: shop hero (banner image, name, owner name, rating,
  distance, "open/closed," delivery time estimate), category
  navigation rail, menu items list (image, name, MRP, offer
  price, "+" / quantity stepper), sticky bottom cart bar when
  cart has items.
- Actions: add to cart, change quantity, view cart, view shop
  info (address, phone, hours).

**CartScreen**
- Purpose: review the items selected from one shop before
  checkout.
- Elements: item rows with quantity steppers, subtotal,
  delivery fee, total, "Add more items" link, primary CTA
  "Proceed to Checkout."
- Actions: change quantity, remove item, proceed to checkout.

**CheckoutScreen**
- Purpose: confirm address, payment, place order.
- Elements: delivery address card (with "change" link),
  payment method selector (UPI, Card, Cash on Delivery — via
  Razorpay test keys today), substitution preference toggle,
  delivery instructions text field, order summary, primary
  CTA "Place Order ₹XXX."
- Actions: change address, change payment, set substitution
  pref, set delivery note, place order.

**OrderConfirmationScreen**
- Purpose: the "yay, it's placed" moment + immediate next
  steps.
- Elements: success icon / animation, order ID, ETA, "Track
  Order" CTA, "Continue Shopping" secondary action.
- Actions: track order (→ OrderDetail), return home.

**OrdersScreen**
- Purpose: list of all my past + active orders.
- Elements: tabs (Active / Past), order card (shop name,
  date, status pill, total), pull-to-refresh.
- Actions: tap → OrderDetail.

**OrderDetailScreen**
- Purpose: full state of one order — timeline, items, total,
  actions appropriate to the current status.
- Elements: status timeline (placed → accepted → packed →
  picked up → delivered), countdown timer for cancellation
  window (PR 36.1), items list, address, payment summary,
  contextual buttons (Cancel during window / Rate after
  delivery / Re-order).
- Actions: cancel order (within window), rate order, repeat
  order.

**FavoritesScreen**
- Purpose: shops the customer has favorited.
- Elements: favorited shop cards, empty state ("Tap the heart
  on a shop to save it here").
- Actions: tap → ShopDetail, unfavorite.

**ProfileScreen**
- Purpose: account hub — addresses, settings, role-switch,
  legal links, logout.
- Elements: name + phone header, saved addresses list,
  "Become a shop owner" CTA, "Become a delivery partner" CTA,
  links (privacy policy, terms of service, support), version
  number footer, logout.
- Actions: edit address, add address, navigate to role
  registration, sign out.

**AddressEditScreen**
- Purpose: add or edit a saved delivery address.
- Elements: nickname (Home / Office / Other), full address
  fields, pin code, landmark, map preview with draggable pin,
  "use current location" button, save CTA.
- Actions: type address, drag pin, save.

### 5.3 Shop owner screens

**ShopOwnerDashboardScreen**
- Purpose: the shop owner's "kitchen" — orders to act on,
  grouped by state.
- Elements: tabs (New / Preparing / Ready / Past), order card
  (customer name, item count, total, ETA timer), prominent
  alert sound + visual when a new order arrives (PR 16),
  empty-state for each tab.
- Actions: tap order → ShopOrderDetail, accept order, mark
  packed, mark ready.

**ShopOrderDetailScreen**
- Purpose: handle one inbound order.
- Elements: customer name + masked phone, address, items
  list with "in stock / out of stock" toggles per item,
  substitution suggestions, total, primary CTA depending on
  status (Accept → Mark Packed → Mark Ready).
- Actions: accept / reject, mark items unavailable, propose
  substitution, mark packed, set ETA, mark ready for pickup.

**ShopMenuScreen**
- Purpose: manage everything the shop sells.
- Elements: category-grouped item list (image, name, MRP,
  offer price, in-stock toggle), search within menu, FAB
  with two entry points: "Scan menu image" (AI photo-to-
  catalog from PR 32) and "Add item manually."
- Actions: edit item, toggle stock, add item, scan menu.

**ScanMenuScreen**
- Purpose: 4-phase AI wizard — take photo → AI extracts items
  → owner reviews/edits → bulk-add to menu. (PR 32 shipping
  feature.)
- Elements: camera viewfinder, "retake" / "use this photo,"
  AI extraction progress, editable list of extracted items
  (name, price, category) with checkboxes, "Add N items"
  primary CTA.
- Actions: take photo, edit extracted items, confirm add.

**AddCustomMenuItemScreen**
- Purpose: manually add a single item.
- Elements: photo upload, name, MRP, offer price, category
  picker, in-stock toggle, save CTA.
- Actions: upload photo, fill fields, save.

**ShopMenuItemEditScreen**
- Purpose: edit one existing menu item.
- Elements: same as Add, prefilled, plus a "Delete item"
  destructive action.
- Actions: edit, save, delete.

**ShopCustomersScreen**
- Purpose: lightweight CRM — who's ordered from this shop.
  (PR 36.)
- Elements: 3 tabs (All / Repeat / Lapsed) × 3 time periods
  (7d / 30d / 90d), customer rows (name, last order, total
  spent, order count), empty state per filter.
- Actions: tap customer → see their order history with this
  shop.

**ShopSettingsScreen**
- Purpose: shop profile, hours, status, KYC docs.
- Elements: shop name, owner name, photo, address, phone,
  open/closed toggle, hours editor (per-day), KYC document
  thumbnails (Aadhaar, shop photo, GST), "Accepting orders"
  master toggle.
- Actions: edit any field, toggle open/closed, upload/replace
  KYC doc, save.

### 5.4 Delivery partner screens

**DeliveryDashboardScreen**
- Purpose: list of pending pickups + active deliveries.
- Elements: tabs (Available / My Active / Completed), pickup
  cards (shop name + address, customer address, distance,
  payout), claim/accept CTA on available rows.
- Actions: claim a delivery, tap → DeliveryOrderDetail.

**DeliveryOrderDetailScreen**
- Purpose: navigate to shop, pick up, deliver.
- Elements: shop address (tap to open in Maps), items list
  (for verification at pickup), customer address (tap to
  open in Maps), customer phone (tap to call), COD amount
  if applicable, status-driven primary CTA (Arrived at shop
  → Picked up → Delivered → Cash collected).
- Actions: call customer, navigate, mark each milestone,
  collect cash.

### 5.5 Role-onboarding screens

**RegisterShopScreen**
- Purpose: shop owner self-registration. Multi-step form
  with voice + Hindi assist (PR 34).
- Elements: step indicator (1 of 5), big mic button at top
  (speak whole form), language picker (Hindi / English),
  per-field text inputs with per-field mics, fields:
  shop name, owner name, GST (optional), phone, address
  with map pin, opening hours, KYC document uploads.
  Primary CTA per step.
- Actions: speak / type / upload, navigate steps, submit.

**WaitingForApprovalScreen**
- Purpose: shopkeeper has submitted KYC, waiting for admin
  review.
- Elements: status illustration, "We'll review within 24
  hours" message, support contact, rejection reason card
  (if rejected, with reapply CTA — PR 31.1).
- Actions: tap support, reapply if rejected.

**BecomeDeliveryPartnerScreen**
- Purpose: apply to be a delivery partner.
- Elements: form (name, phone, vehicle type, license number,
  area), submit.
- Actions: fill, submit.

**DeliveryApprovalWaitingScreen**
- Purpose: delivery applicant waiting for admin review.
- Elements: same shape as WaitingForApproval — status copy
  + support contact.
- Actions: contact support.

### 5.6 Admin screens

(All admin screens are data-dense list/detail pairs.)

**AdminOrdersScreen** — all orders across all shops, filterable
by status / shop / date. Drill in → OrderDetail (admin view).

**PendingShopsScreen** — shops awaiting KYC review. Cards with
shop name, owner, submitted date. Drill in →
ShopRegistrationDetailScreen.

**ShopRegistrationDetailScreen** — KYC review surface. All
submitted fields, document image previews (tappable to
full-screen), tappable lat/lng (opens Maps — PR 31.1),
approve / reject (with reason) CTAs.

**ShopManagementScreen** — list of all approved shops with
search / status filter. Drill in → ShopDetailManagementScreen.

**ShopDetailManagementScreen** — admin view of one shop. Same
data as ShopSettings but with admin-only actions: suspend,
re-review, change owner, view KYC docs even after approval
(PR 31.1).

**UserManagementScreen** — list of all users, role badges,
search. Drill in → UserDetailScreen.

**UserDetailScreen** — one user's profile, roles, order
history, action menu (set admin, set shop owner, set
delivery, revoke).

**PendingDeliveryRequestsScreen** — delivery partner
applicants. Drill in → DeliveryRequestDetailScreen.

**DeliveryRequestDetailScreen** — review one applicant.
Approve / reject.

**AuditLogScreen** — system-wide audit trail of admin
actions.

**AdminUsageScreen** — feature-usage analytics dashboard
(PR 38). Charts and counts of which features users are
hitting over selectable time ranges. Most "dashboard-y"
screen in the app.

## 6. Key end-to-end flows (the 6 journeys to design well)

If you only mock 6 flows, mock these:

1. **Customer first order.** Open app → land on Home → see
   shops → tap one → browse menu → add 4 items → checkout →
   place order → see confirmation → track on OrderDetail.
2. **Shop owner first registration.** Tap "List your shop" →
   RegisterShop (5 steps with voice + Hindi) → submit →
   WaitingForApproval → (admin approves) → land on
   ShopOwnerDashboard.
3. **Shop owner first menu build via photo.** From empty Menu
   screen → tap "Scan menu image" → take photo of a printed
   rate-list → review extracted items → tap "Add 27 items"
   → menu is live. *Hero flow for our Mission North Star.*
4. **Shop owner handles an order.** Dashboard → new order
   alert → tap → ShopOrderDetail → mark 1 item out of
   stock → propose substitution → accept → mark packed →
   mark ready.
5. **Delivery partner picks up and delivers.** Dashboard →
   claim a job → navigate to shop → mark picked up →
   navigate to customer → call customer → mark delivered
   → collect cash.
6. **Admin approves a shop.** Notification of new pending
   shop → PendingShops → tap → ShopRegistrationDetail →
   review docs → check lat/lng on Maps → approve.

## 7. Components likely worth designing as a system

A starter component list (good first task for any design
system pass):

- App icon + splash + monochrome icon (Android adaptive).
- Brand mark / wordmark / monogram (3 sizes).
- Color tokens (primary, primary-dark, primary-light,
  accent — needs deciding, surface, border, text-primary,
  text-secondary, text-muted, success, warning, danger,
  info).
- Typography pair (Latin + Devanagari) + scale (h1, h2, h3,
  body, body-bold, caption, price).
- Button system (primary, secondary, ghost, destructive;
  sizes sm/md/lg; loading state; disabled state).
- Input system (text, phone, OTP, password-style, multi-line,
  with error states + helper text).
- Card patterns (shop card, menu item card, order card,
  customer card, applicant card).
- Status pill (active, pending, packed, ready, picked-up,
  delivered, cancelled, refunded).
- Empty-state illustration pack (no shops, empty cart,
  no orders, no favorites, no search results, no customers
  yet for a shop, no menu items yet for a shop).
- Skeleton loader patterns (shop card skeleton, item row
  skeleton, order timeline skeleton).
- Toast / snackbar.
- Bottom-sheet (for filters, sort, address picker).
- Tab bar (with the role-switch variants).
- Mic button + voice-recording state visual (used in
  RegisterShop, possibly extends to search later).
- Photo / KYC document upload tile (with progress, error
  retry).
- Price display (MRP strikethrough + offer price + discount
  badge in one canonical pattern).

## 8. Constraints + things to keep in mind

- Mobile first; designs only need to look great at standard
  phone sizes (375–430 dp wide). Tablet is out of scope.
- Both light and dark mode are nice but light mode is the
  must-have for v1.
- All screens must work one-handed on a 6"+ screen — primary
  CTAs at the bottom 1/3, never at the top.
- Phone numbers, prices, and addresses appear constantly.
  Strong opinions on how they're typeset will help.
- Accessibility: minimum tap target 44dp, minimum body text
  16dp, sufficient contrast for outdoor use (delivery
  partners use this in the sun).
- Photography for shop hero and menu items is sparse today —
  many shops will only have one or two real photos. Designs
  need to look good with placeholder / category-derived
  imagery as fallback.

## 9. What we want from a design pass

In rough priority order:

1. A locked visual identity: app name, logo / wordmark,
   icon set, splash, color tokens, type pair.
2. A reusable component library for the items in section 7.
3. Visual polish of the 6 hero flows in section 6.
4. Empty-state illustration set.
5. Optional: a marketing landing page mockup for the website
   that hosts privacy policy + terms today.

Name is **locked: HamaraSetu** (हमारा सेतु, "Our Bridge"). Tagline
is **locked: "Shop Smart, Shop Local."** Logo and identity work
should lean into the *setu* (bridge) metaphor — the app connects
neighborhood shops to neighborhood customers. Bilingual treatment
of the wordmark (Devanagari + Latin) is encouraged.
