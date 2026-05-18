# Pre-Launch Checklist — grocery-mvp

Single source of truth for everything that must happen before real customers
touch this app. Items grouped by category. Each item annotated with the
Phase that introduced the requirement.

## 🔒 Security & Authentication

- [ ] **App Check enforcement** — see the dedicated section below
      ("App Check enforcement (intentionally deferred)") for the
      canonical rationale, pre-conditions, and flip plan. The two
      tag-along items follow:
- [ ] **Native App Check** wired via `@react-native-firebase/app-check`
      on iOS (DeviceCheck) + Android (Play Integrity). Required before
      flipping enforceAppCheck back on for native users. [Phase 5a-mobile]
- [ ] **Remove App Check debug token** from Firebase Console
      (App Check → Apps → Manage debug tokens). Currently active for dev. [Phase 5a]

## App Check enforcement (intentionally deferred)

**Status:** All Cloud Functions callables ship with
`enforceAppCheck: false`. Counted at PR 8.1 deploy: ~30 callables,
all consistent. This is intentional; do not flip individual
callables piecemeal.

**Why deferred:**

- Native (iOS/Android) App Check requires native module setup
  (`@react-native-firebase/app-check` or DeviceCheck/Play Integrity
  glue) that we haven't done yet. Flipping enforcement on without
  it means every TestFlight request silently 401s.
- Web App Check is wired (reCAPTCHA v3 in `firebase.ts`) but
  enforcing it on callables would break native immediately.
- Coordinating the flip means: (a) add the native module, (b)
  rebuild via EAS, (c) verify tokens flow correctly from both
  platforms via the App Check debug panel in Firebase console,
  (d) flip every callable in one PR.

**Pre-conditions for flipping:**

1. `@react-native-firebase/app-check` installed and configured for
   both iOS (App Attest / DeviceCheck) and Android (Play Integrity).
2. Native rebuild successfully completes and the debug provider
   shows tokens flowing in Firebase console > App Check.
3. Production reCAPTCHA v3 site key matches what's in `app.json`
   `expo.extra.firebase.recaptchaSiteKey`.
4. All callables flipped to `enforceAppCheck: true` in one PR
   (not piecemeal — partial flip is worse than none, see PR 6.1's
   inline rationale, since removed).

**What we removed in PR 8.1:**

- Inline `// NOTE on enforceAppCheck` comments in
  `getMenuImageUploadUrl` (PR 6.1) and the corresponding 3-line
  block above `updateOrderStatus`. They were redundant once this
  section existed. The source of truth for the deferral is HERE,
  not scattered across 30 callables.
- `updateOrderStatus`'s comment was kept as a 3-line pointer to
  this section (rather than fully deleted) because the original
  comment also justified server-callable / CLI dashboard access,
  which is genuinely callable-specific and worth preserving.
- [x] **Phase 9c** — native phone auth via `@react-native-firebase/auth`
      live; checkout sign-in gate restored on both web and native.
      Still pending: install new dev client (rebuilt with RNFB native
      modules), end-to-end OTP test on iPhone with whitelisted number.
- [ ] **Remove `uid` debug strip** on HomeScreen (currently `__DEV__` gated;
      delete the line entirely for production). [Phase 5e-ii]
- [ ] **Final security rules review** with second pair of eyes. Walk through
      `firestore.rules` line-by-line. Confirm no `if true` allows. [Phase 5e-ii]
- [ ] **Re-deploy rules from local file** via `firebase deploy --only firestore:rules`
      and verify Firebase Console shows zero diff against `firestore.rules`. [post-Phase 5e-ii]
- [ ] **Rotate Razorpay test keys → live keys** after KYC approved. Update
      via `firebase functions:secrets:set RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`.
      Redeploy Functions. [Phase 8a]
- [ ] **Rotate Razorpay webhook secret** for live mode. Reconfigure webhook
      in Razorpay Dashboard pointing to production Function URL. [Phase 8a]
- [ ] **Configure Sentry source-map upload** via `SENTRY_AUTH_TOKEN` EAS
      secret + `SENTRY_ORG`, `SENTRY_PROJECT` env in eas.json. Currently
      `SENTRY_DISABLE_AUTO_UPLOAD=true` to bypass build failure. [Phase 5e-i, 9a]
- [ ] **Verify `service-account.json` and all .p8 files** are gitignored
      and not in any commit history. [Phase 3, 9c]
- [ ] **Audit secrets in Functions** — confirm `RAZORPAY_KEY_SECRET`,
      `RAZORPAY_WEBHOOK_SECRET`, etc. are stored only in Functions Secret
      Manager, never in code or .env. [Phase 8a]

## 🗺️ Data & Configuration

- [ ] **Restore env-var gate** on `FORCE_SHOW_ALL_SHOPS_IN_DEV` in
      `src/services/shopService.ts` (currently `__DEV__` only — change
      back to `__DEV__ && process.env.EXPO_PUBLIC_FORCE_SHOW_ALL_SHOPS === 'true'`). [Phase 5e-ii]
- [ ] **Confirm 1-km location filter** is active in production builds
      (verify `__DEV__` is `false` in production). [Phase 6, 5e-ii]
- [x] **Real product images** uploaded to Firebase Storage; replace
      `picsum.photos` URLs in `src/mocks/products.ts` (or wherever
      products are seeded). [post-Phase 3] — 28/34 sourced from Open
      Food Facts via `npm run import-images`; 6 unmatched (non-food +
      fresh produce) still on picsum. Storage rules in `storage.rules`
      allow public read on `products/**`.
- [ ] **Add OFF attribution credit** ("Some product images via Open
      Food Facts, CC-BY-SA 3.0") visible in app — Settings or About
      screen. License compliance.
- [ ] **Manually review the OFF match log** — replace any low-quality
      or wrong product images before launch (re-run `import-images`
      after editing brand/name in `mocks/products.ts` to get better
      matches; the script is idempotent and skips already-rehosted
      URLs, so manual replacements are preserved as long as they're
      on `firebasestorage.googleapis.com`).
- [ ] **Source images for unmatched products** — OFF didn't match
      `p_001_parleg, p_001_dettol, p_004_banana, p_004_haldi,
      p_005_paste, p_005_surf` (non-food + fresh produce). Pull from
      brand websites or stock photos and upload manually to
      `gs://grocery-mvp-dev.firebasestorage.app/products/<id>.jpg`,
      then update `mocks/products.ts` + re-seed.
- [ ] **Consider Firebase Image Resize extension** if product catalog
      grows beyond ~100 — auto-generates thumbnails to keep mobile
      bandwidth low.
- [ ] **Real shop data** — replace 8 mock Delhi shops with real onboarded
      kirana shop data. Update via seed script or admin tool. [post-Phase 3]
- [x] **App icon replaced** (currently Expo default in `app.json`). [Phase 9a]
      — auto-generated placeholder ("K" on `#0E7C3A` green). Generated
      by `npm run generate-branding` (sharp + inline SVG, no design tools).
- [x] **Splash screen replaced** (currently Expo default). [Phase 9a]
      — same generator; splash uses `expo-splash-screen` plugin pointing
      at `assets/images/splash-icon.png` on green background.
- [x] **App display name** updated in `app.json` (currently "grocery-mvp"). [Phase 9a]
      — set to **Kirana Mart** as placeholder.
- [ ] **Replace placeholder branding with real artwork** before launch —
      current icon/splash/adaptive-icon are auto-generated "K" glyphs;
      functional but generic. Re-run `npm run generate-branding` after
      tweaking PRIMARY/APP_LETTER, or drop hand-designed PNGs into
      `assets/images/` (preserve filenames so app.json paths still match).
- [ ] **Decide final app display name** with partner before launch
      ("Kirana Mart" is a placeholder).

## 🚀 Production Infrastructure

- [ ] **Separate Firebase project** `grocery-mvp-prod` created (currently
      using `grocery-mvp-dev` for everything). [Phase 5e-ii prep]
- [ ] **Seed prod project** with real shop + product data via `npm run seed`. [Phase 3]
- [ ] **Deploy `firestore.rules` + `firestore.indexes.json`** to prod project. [Phase 3]
- [ ] **Deploy Cloud Functions** to prod project with prod secrets
      (Razorpay live keys, prod webhook secret). [Phase 8a]
- [ ] **GCP budget alerts** active on prod project (₹500/mo with 50/90/100/150% thresholds). [Phase 5e-ii]
- [ ] **Production `.env`** file with prod Firebase config + reCAPTCHA
      site key + Sentry DSN. Keep separate from dev `.env`. [Phase 5e-ii]
- [ ] **Production EAS build profile** in `eas.json` configured for App
      Store / Play Store submission (Android `app-bundle`, iOS production cert). [Phase 9a]
- [ ] **Verify abandoned-order cleanup Function** is scheduled and running
      hourly in prod. [Phase 10]
- [ ] **Load test** Cloud Functions: 100 concurrent orders without timeout. [pre-launch]
- [ ] **Firestore backup strategy** — scheduled exports to GCS bucket. [pre-launch]

## 📱 Native / Mobile

- [x] **Mobile online payment** via `react-native-razorpay` \u2014 native
      PaymentSheet on iOS/Android, web overlay unchanged. Unified
      dispatcher in `src/utils/razorpay.ts` handles both. [Phase 8b-mobile]
- [x] **Test mobile online payment end-to-end** \u2014 verified on iPhone
      with `success@razorpay` UPI VPA: native sheet opens, payment
      succeeds, webhook flips `paymentStatus` to `'paid'` within ~5s,
      `razorpayPaymentId` populated on the order doc. [Phase 8b-mobile]
- [x] **Stuck-payment recovery** \u2014 if the customer dismisses Razorpay
      without paying, `OrderDetailScreen` now shows `Pay Now` + `Cancel
      order` buttons while the order is in `paymentStatus='pending'`
      AND `status='pending'`. Backed by two new callables:
      `retryPayment` (rotates `razorpayOrderId`, returns fresh session)
      and `cancelMyPendingOrder` (sets status=cancelled,
      paymentStatus=expired). Webhook resolves orders via
      `notes.orderId` so orphaned Razorpay orders are harmless.
      [Phase 8b-mobile]
- [ ] **Verify Razorpay error propagation to Sentry** \u2014 native SDK
      errors have shape `{ code, description }` while web SDK errors are
      `{ error: { description } }`. The unified `onError` callback in
      `CheckoutScreen` tries both shapes; verify Sentry actually captures
      both by triggering a failure with UPI VPA `failure@razorpay`.
      [Phase 8b-mobile]
- [ ] **Admin refund flow for paid orders** \u2014 `cancelMyPendingOrder`
      currently rejects orders where `paymentStatus='paid'` (with a
      "needs admin cancellation" message). Build an admin-side
      `refundPaidOrder` Cloud Function that hits Razorpay's
      `payments.refund` API, credits the customer, marks the order
      `status='cancelled'` with `paymentStatus='refunded'`. Add a new
      `'refunded'` value to the `PaymentStatus` union and surface it in
      `OrderDetailScreen`. Post-MVP \u2014 only relevant once a real customer
      asks to cancel after the shop has accepted. [Phase 8b-mobile]
- [ ] **Razorpay order reuse on retry** \u2014 `retryPayment` currently
      always creates a fresh Razorpay order, leaving the previous one
      orphaned. Razorpay charges nothing for orphaned orders, but for
      tidiness consider checking the existing `razorpayOrderId`'s status
      via Razorpay's `orders.fetch` API and reusing if it's still
      `'created'` or `'attempted'`. Skip until orphaned-order count
      becomes a real cleanup concern. [Phase 8b-mobile]
- [ ] **Background-tap protection on retry/cancel buttons** \u2014
      `OrderDetailScreen`'s `paying` / `cancelling` state disables both
      buttons during inflight calls, but if the user backgrounds the
      app mid-call, the state may not survive. The Cloud Function's
      state-machine checks reject duplicate retries server-side, so the
      worst-case is a wasted Razorpay session create. Acceptable for
      MVP; revisit if telemetry shows it happening. [Phase 8b-mobile]
- [ ] **Track react-native-razorpay New Architecture support upstream**.
      MVP currently relies on Expo SDK 54's interop layer to bridge the
      legacy module onto the new architecture; this works today but may
      regress in future RN/Expo upgrades. Watch
      https://github.com/razorpay/react-native-razorpay for new-arch
      compatibility announcement. If interop breaks before then, fall
      back to a WebView-based checkout. [Phase 8b-mobile]
- [x] **FCM push notifications** Cloud Function trigger on order status
      change → push to customer's FCM token. [Phase 5d]
      — implemented via `expo-notifications` + Expo Push relay (avoids
      stacking another RNFB native module on top of static-frameworks +
      New-Arch). Two Cloud Functions:
      - `registerPushToken` (callable) — appends Expo push token to
        `users/{uid}.fcmTokens` via `arrayUnion` (deduped).
      - `sendOrderStatusPush` (Firestore `onDocumentUpdated` trigger on
        `orders/{orderId}`) — POSTs to `https://exp.host/--/api/v2/push/send`
        when `status` changes; iOS receives APNs push via Expo's relay.
      Client registers in `src/components/AuthBootstrap.tsx` after auth
      ready. Native callable goes through RNFB so phone-authed user is
      the caller (matches `orderService` pattern).
- [ ] **Migrate to `@react-native-firebase/messaging`** if Expo Push
      relay becomes a bottleneck or third-party-dependency concern.
      Current setup adds a hop through Expo's servers (rate limits and
      uptime are theirs). Direct FCM/APNs would be lower latency and
      one less external dependency, at the cost of another RNFB native
      module rebuild battle.
- [ ] **Test push notifications on Android** once Android dev client
      is built (currently iOS-only verified). The notification channel
      is already created in `pushService.ts` so this should Just Work,
      but verify: permission prompt, token format (FCM vs Expo), banner
      + sound + tap-to-open.
- [ ] **Tap-to-navigate from push** — currently the response listener
      in `AuthBootstrap.tsx` only logs the `orderId`. Wire it through a
      navigation ref so tapping a push deep-links into `OrderDetail`
      for that order.
- [ ] **Document both APNs keys in a credentials inventory file**
      (private, not committed). One key in Firebase Console (FCM
      delivery path: `sendOrderStatusPush` → Expo Push relay → APNs),
      one in EAS credentials store (build-time capability registration
      so the provisioning profile gets `aps-environment`). Both point
      to Apple team `<TEAM_ID>`. If ever rotating either, must rotate
      the other to keep both stores in sync — otherwise pushes silently
      stop delivering OR builds start failing capability sync.
- [x] **Cloud Functions runtime SA needs `roles/firebaseauth.admin`** —
      `claimShop`, `becomeDelivery`, and any future Cloud Function that
      calls `getAuth().setCustomUserClaims()` will fail with
      `auth/insufficient-permission` on a fresh project. The default
      Compute Engine SA (`<project-number>-compute@developer.gserviceaccount.com`)
      doesn't carry Auth admin perms by default in newer GCP projects.
      Grant once per project:
      `gcloud projects add-iam-policy-binding <PROJECT_ID> --member="serviceAccount:<PROJECT_NUMBER>-compute@developer.gserviceaccount.com" --role="roles/firebaseauth.admin"`.
      Done for `grocery-mvp-dev` on 2026-05-15. Repeat for prod project
      when it's created.
- [x] **Built Delivery Person panel (Phase 12b)** — DeliveryDashboard
      with online/offline toggle, today stats, available pickups list
      (15s poll), my active deliveries (10s poll), claimDelivery
      transactional first-wins, markPickedUp / markDelivered with
      delivery-role auth gate. Customer push fires on delivered via
      existing sendOrderStatusPush. New-pickup push fires only to
      online delivery people via sendNewPickupPushToDelivery (queries
      users where isDelivery==true && deliveryStatus=='online'). No
      new statuses added to the state machine — substates encoded by
      (status, deliveryPersonId, pickedUpAt). 23 Cloud Functions
      total. firestore.rules + 2 new composite indexes deployed.
- [ ] **Distance / proximity-based pickup matching** — currently every
      online delivery person sees every available pickup and gets every
      new-pickup push. Production should filter by delivery person's
      last known location vs `shop.location` (we already store
      `Shop.location: GeoPoint`). Options: geohash filtering at the
      Firestore query layer, or compute distance server-side in
      `listAvailableDeliveries` and exclude > N km. Same logic should
      gate the push fan-out in `sendNewPickupPushToDelivery` — sending
      a Pune pickup to a Delhi delivery person is pure noise.
- [ ] **Delivery earnings calc** — Phase 12b shows count only. Need
      ₹X-per-delivery base + tip pass-through + weekly settlement
      reports. Probably a new `payouts` collection with a scheduled
      Cloud Function that aggregates deliveries → payable amount per
      delivery person.
- [ ] **Delivery person KYC + onboarding** — currently `becomeDelivery`
      is one-tap self-service (Phase 12a/b decision). Production needs
      vehicle, license, Aadhaar verification gated behind admin
      approval (same workflow noted for shop-owner KYC).
- [ ] **Audit log collection for admin governance actions** — every
      `revokeShopOwner` / `revokeDelivery` / `suspendShop` /
      `unsuspendShop` / `approveShop` / `rejectShop` is currently
      logged to `console.log` only. Promote to a Firestore `auditLog`
      collection with `{ action, adminUid, targetUid?, shopId?,
      reason?, timestamp }` per entry. Needed for production
      accountability and dispute resolution. Add an admin-only
      `listAuditLog` callable + UI screen.
- [ ] **Admin grant invite flow** — when scaling past one operator,
      replace the CLI-only `set-admin` path with: existing admin
      invites by phone, invitee logs in, `acceptAdminInvite`
      callable mints the claim + writes audit entry. Until then,
      handing off `service-account.json` to a co-admin is the only
      way to grow the admin set, which is fine for MVP. Post-launch.
- [ ] **Self-revoke client-side parity check** — server already
      throws `failed-precondition` on `uid === auth.uid` for all
      governance callables. UserDetailScreen also disables the
      buttons for self. Add a unit/integration test pinning that
      both layers reject self-revoke; right now it's covered only
      by manual QA.
- [ ] **Suspended-shop in-flight order policy** — `suspendShop`
      currently leaves in-flight orders untouched (out_for_delivery
      orders complete, `accepted` / `preparing` orders continue).
      Define and implement an admin-controlled override: "suspend
      and cancel all unfulfilled" with refund handling for online
      payments. MVP keeps the simple "suspend = stop new orders only"
      semantics.
- [ ] **Pagination on `listAllUsers` / `listAllShops`** — both
      capped at 100 records (Auth SDK supports up to 1000 per page;
      Firestore needs cursor-based paging). Add `nextPageToken` /
      `startAfter` arguments and a "Load more" button on the
      management screens once we cross ~50 users / shops.
- [ ] **`SearchScreen` rewrite to per-shop menu** (Phase 12a-v2-iii)
      — search currently still reads the legacy global `products`
      collection, which means a search hit may surface a product that
      isn't actually on any active shop's menu, or shows the global
      price instead of the shop's price. Rewrite to either (a)
      fan-out queries across active shops' menu subcollections with a
      union, or (b) maintain a denormalized search index in a new
      top-level `menu_search` collection keyed by `${shopId}_${menuItemId}`.
      Option (b) scales better but adds a write fan-out cost on every
      menu update.
- [ ] **Multi-shop cart guard** (Phase 12a-v2-iii) — current cart
      already enforces single-shop via `addItem` returning
      `different_shop`, but the v2-iii prompt explicitly deferred a
      stricter server-side guard: `placeOrder` does not currently
      reject a cart whose lines reference a `shopId` different from
      the order's `shopId` (it just validates each line). Add a
      consistency check that every line's resolved menu item lives
      under the order's `shopId`.
- [ ] **Bulk menu actions** (Phase 12a-v2-ii) — single-item editing
      only in MVP. Production needs "mark all unavailable", "set 10%
      off all atta items", "copy prices from another shop", etc.
      Likely a separate ShopMenuBulkScreen + a bulk-update callable
      that takes an array of `{ menuItemId, fields }` patches.
- [ ] **Image upload for custom menu items** — `AddCustomMenuItemScreen`
      currently accepts only an image URL. Production needs in-app
      camera/gallery upload to Firebase Storage with automatic resize
      (200×200, 600×600). Wire `expo-image-picker` + a `uploadMenuImage`
      Cloud Function that returns a signed URL.
- [ ] **Menu import from CSV/Excel** — for shops onboarding with large
      catalogs (50+ items). Admin-side upload that parses + validates
      rows, then calls `addCustomMenuItem` in batches. Post-MVP.
- [ ] **Stock auto-decrement on order placement** — `MenuItem.stock`
      is informational only in MVP. Production may want hard limits:
      `placeOrder` decrements per-item stock atomically and rejects
      orders that would push stock negative. Requires a transaction
      over the menu subcollection per order. Tracked together with
      "Auto-cancel orders not picked up within X minutes".
- [ ] **Shop-level discount campaigns** — "10% off all atta items
      today", time-limited promo codes, first-order discount, etc.
      Distinct from per-item MRP/price; should live in a separate
      `shops/{shopId}/promotions` subcollection so menu pricing stays
      stable. Post-MVP marketing tool.
- [ ] **Re-bootstrap shop menus when products are added** — current
      `bootstrapShopMenu` only fires on `approveShop`; if the platform
      adds new products to the global catalog later, existing shops'
      menus won't get them automatically. Either (a) add an admin-only
      `syncCatalogToAllMenus` callable, or (b) extend `addProduct`
      (when we ship it) to fan-out into every active shop's menu.
- [ ] **Cloud Functions Node.js 20 runtime upgrade** — deprecated
      2026-04-30, decommissioned 2026-10-30. Bump
      `functions/package.json` engines to `nodejs22` and re-deploy
      before late October.
- [ ] **`firebase-functions` SDK upgrade** — deploy log warned the
      pinned version is outdated. Run `npm install --save firebase-functions@latest`
      in `functions/` and review breaking changes before next deploy.
- [ ] **Auto-cancel orders not picked up within X minutes** —
      `cleanupAbandonedOrders` only handles payment-pending. Add a
      sibling scheduled job that finds `out_for_delivery` orders older
      than ~30 min with no `pickedUpAt`, alerts the shop owner, and
      after a longer threshold either reassigns or cancels with refund.
- [ ] **Live location tracking** — Phase 12b status transitions only.
      Adding "driver is 800m away" needs the delivery app to push GPS
      to the order doc periodically (every ~30s while
      `pickedUpAt && !deliveredAt`), the customer's `OrderDetailScreen`
      to read it, and `firestore.rules` to allow the assigned delivery
      person to write `deliveryLocation` on their orders. Out of MVP.
- [ ] **Multi-order pickup batching** — single delivery person picks
      up 2+ orders from the same shop in one trip. Out of MVP.
- [ ] **Admin approval workflow for shop owner + delivery
      self-registration** — currently `claimShop` and `becomeDelivery`
      are open self-service. For production, gate behind admin KYC
      approval: store registration intent in a `pendingRoleRequests`
      collection, admin reviews ID/address/vehicle docs, admin-only
      callable promotes to actual claim. Without this, anyone could
      claim any seeded shop.
- [ ] **Build "create your own shop" flow** — currently shop owner
      picks from the 8 seeded shops. Production needs a new-shop
      onboarding form (name, address, GST, FSSAI, pin, photos),
      admin verification, then a Cloud Function that creates the shop
      doc + sets the owner claim atomically. Until then, the platform
      operator must seed every shop manually.
- [ ] **Multi-shop ownership** — Phase 12a hard-caps one shop per user
      (`claimShop` rejects if `shopId` claim already set to a different
      shop). Real chains/franchises need to own multiple. Migration
      path: change the `shopId: string` claim to `shopIds: string[]`,
      update `listShopOrders` to scope by membership, update
      `firestore.rules` `isShopOwnerOf()` to check array membership,
      update the dashboard to add a shop picker.
- [ ] **Shop owner can edit menu** (add/remove products, update prices,
      mark out of stock). Out of scope for Phase 12a. When building,
      enable the commented-out shop-write rule in `firestore.rules`
      (with `ownerUid` pin to prevent re-assignment) and add a
      product-edit Cloud Function that bumps `updatedAt` and validates
      price ranges.
- [ ] **Shop owner stats: weekly / monthly views + charts** — Phase
      12a only shows today's count/revenue/pending. Add a date range
      picker (last 7d / 30d / custom) and a small chart library
      (`react-native-chart-kit` or `victory-native`). Move stat
      computation server-side once data volume grows past a few
      hundred orders/shop.
- [ ] **Replace polling with snapshot listeners on ShopOwnerDashboard**
      when `@react-native-firebase/firestore` is compatible with
      Expo SDK 54 + RN 0.81 + static frameworks (the same blocker
      tracked for `watchAllOrders`). Until then, the 10s poll on
      `listShopOrders` is the right tradeoff.
- [ ] **Production iOS build will need provisioning-profile regen too**
      — the `production` profile predates push, same as `development`
      did. When you run `eas build --profile production --platform ios`
      for the first time after this phase, expect the same
      `aps-environment` capability error. Fix by running
      `eas credentials` → iOS → production → Build Credentials →
      Provisioning Profile → Remove, then rebuild. EAS will regenerate
      with the capability enabled. [Phase 9a]
- [ ] **Phase 9c** — native phone auth via `@react-native-firebase/auth`
      so iOS users can sign in with phone (not web-only). [Phase 9c]
- [ ] **Android dev client** built and tested (currently iOS-only). [Phase 9a-android]
- [ ] **Production iOS build** signed with App Store distribution cert
      via `eas build --profile production --platform ios`. [Phase 9a]
- [ ] **Production Android build** as `.aab` for Play Store via
      `eas build --profile production --platform android`. [Phase 9a]
- [ ] **Test on multiple iPhones** registered via `eas device:create` —
      family test with at least 3 different iOS versions. [Phase 9a]
- [ ] **Replace polling with snapshot listeners** in `orderService.ts`
      once `@react-native-firebase/firestore` stabilizes for static
      frameworks + RN 0.81. Keep optimistic UI on top — the snapshot
      listener becomes the fast-confirmation path instead of polling,
      and rollback on Function failure stays the same. [Phase 9c]
- [ ] **Toast/snackbar on optimistic-update revert** instead of
      `Alert.alert` ("Couldn't update — restored"). Less intrusive
      and matches the optimistic-UX feel; alerts interrupt the next
      tap. Post-MVP polish. [Phase 9c]
- [ ] **Multi-admin conflict detection** in `AdminOrdersScreen`. When
      two admins act on the same order simultaneously, `updateOrderStatus`
      rejects the second call (state machine validates the transition).
      Optimistic UI on the second client should revert AND show
      "Already updated by another admin" — needs error-message-aware
      handling, not just a generic alert. Defer until real shop owners
      are onboard and concurrent activity becomes likely. [Phase 9c]

## 🏗️ Build configuration

- [ ] **Drop `plugins/withModularHeaders.js`** custom plugin once
      `@react-native-firebase` ships native support for `useFrameworks: 'static'`
      without needing `use_modular_headers!` in the Podfile. Currently
      required because RNFB v24's static framework includes React-Core
      headers non-modularly, breaking the iOS build. Low priority —
      the plugin is small and has no runtime cost. [Phase 9c]
- [ ] **Revisit `@react-native-firebase/firestore` native integration**
      when upstream resolves the Expo SDK 54 + RN 0.81 + static-frameworks
      incompatibility (Swift module emit errors in `RNFBFirestore` that
      no Podfile patch could fix). Currently using Cloud-Function-backed
      reads on iPhone (`listMyOrders`, `getOrder`, `listAllOrders`) with
      5s polling on `OrderDetail` and 10s polling on `ShopDashboard`
      instead of real-time `onSnapshot` listeners. Migration target:
      replace polling with snapshot listeners once RNFB Firestore builds
      reliably. Cost of current setup at MVP scale is negligible
      (~2× Firestore reads + 200-500ms latency per poll); revisit if
      Function invocation cost or staleness becomes a complaint.
      [Phase 9c]
- [ ] **Re-evaluate `expo.install.exclude` in package.json** — currently
      excludes `@react-navigation/native` and `@react-navigation/native-stack`
      so expo-doctor stops blocking EAS builds on minor version drift.
      Revisit at next Expo SDK upgrade and either remove the exclusion
      (after Expo bumps its expected versions) or re-pin to expected
      versions if behavior diverges. [Phase 9c]

## 📊 Observability

- [ ] **Sentry** running in production with proper environment tag. [Phase 5e-i]
- [ ] **Firebase Analytics** verified producing events in production
      property (not dev project's Analytics). [Phase 5e-i]
- [ ] **Firebase Performance Monitoring** showing real user data. [Phase 5e-i]
- [ ] **Cloud Logging** filters set up for Functions errors. [pre-launch]
- [ ] **Crashlytics native** added once Phase 9c lands native modules. [post-Phase 9c]

## 📝 Compliance & Distribution

- [ ] **Privacy Policy** drafted, hosted at a public URL, linked in app
      and store listings. Required for both Play Store and App Store. [pre-launch]
- [ ] **Terms of Service** drafted, hosted, linked. [pre-launch]
- [ ] **DPDP Act 2023 (India) compliance review** — data collection notice,
      retention policy, deletion request process. [pre-launch]
- [ ] **Play Store listing** prepared: app icon (512×512), screenshots
      (phone + tablet), feature graphic, short + long description, content
      rating questionnaire. [pre-launch]
- [ ] **App Store listing** prepared: app icon, screenshots, description,
      keywords, App Privacy questionnaire (data collection categories). [pre-launch]
- [ ] **App version bump** in `app.json` from `1.0.0` if needed. [pre-launch]
- [ ] **Customer support email** set up; in-app or footer link. [pre-launch]

## ✅ Done in development (verified working)

- [x] Phase 1-7: full app architecture + Firestore migration
- [x] Phase 5a: App Check on web (reCAPTCHA v3) — enforcement temporarily off
- [x] Phase 5b: order lifecycle state machine + admin CLI
- [x] Phase 5c: EAS dev client built, installed on iPhone
- [x] Phase 5e-i: Sentry + Firebase Analytics + Performance
- [x] Phase 5e-ii: pre-launch cleanup, location filter restored, debug strip gated
- [x] Phase 6: real GPS via expo-location with fallback
- [x] Phase 7: shop owner admin dashboard
- [x] Phase 8a: Razorpay backend (Cloud Function + webhook with signature verification)
- [x] Phase 8b: Razorpay client (Checkout overlay) — verified end-to-end on web
- [x] Phase 9a: iOS dev client build + family device registration
- [x] Phase 9b: phone OTP auth (web)
- [x] Phase 10: abandoned-order cleanup scheduled function
- [x] Phase 11: push notifications (expo-notifications + Expo Push relay)
- [x] Phase 12b: delivery-person panel + customer-side completion of
      flow. 7 new Cloud Functions (listAvailableDeliveries,
      listMyDeliveries, claimDelivery, markPickedUp, markDelivered,
      setDeliveryStatus, sendNewPickupPushToDelivery). 2 new composite
      indexes. firestore.rules extended with `isDeliveryPerson()` /
      `isDeliveryAssignedToThisOrder()`. All 4 roles (customer / shop
      owner / delivery / admin) now functional end-to-end.
- [x] Phase 12a: multi-role foundation + shop owner panel
      — custom claims schema (admin/shopOwner+shopId/delivery), self-service
      claim flow (BecomeShopOwner picks from unclaimed seeded shops),
      ShopOwnerDashboard scoped to one shop with today's stats + status
      controls, push to shop owner on new order via sendNewOrderPushToShop,
      delivery claim wired in advance for Phase 12b. 16 Cloud Functions
      total. firestore.rules extended with isShopOwnerOf().
- [x] Phase 12a-v2-i: shop registration + admin approval workflow.
      Replaced the self-service `claimShop` shortcut with a full
      registration form → pending → admin approve/reject → active
      lifecycle. Schema: `Shop.status` ∈ {pending, active, rejected,
      suspended} + `registrationData` (phone, hours, GST, FSSAI,
      submittedAt) + approval/rejection metadata. New Cloud Functions:
      `registerShop`, `approveShop`, `rejectShop`, `listPendingShops`,
      `getMyShop` + `pushToAdmins` helper (uses `users/{uid}.isAdmin`
      Firestore mirror because custom claims aren't queryable). Old
      `claimShop` deleted. firestore.rules: shop reads gated by
      `status=='active'` OR `isAdmin()` OR `ownerUid==auth.uid`. New
      screens: RegisterShopScreen (form), WaitingForApprovalScreen
      (polls `getMyShop` every 30s, refreshes claims on approval,
      offers Edit-and-resubmit on rejection), PendingShopsScreen
      (admin queue), ShopRegistrationDetailScreen (approve / reject
      with reason). HomeScreen surfaces "Awaiting approval" tile for
      in-flight owners and "Pending Shop Approvals" tile for admins.
      Existing 8 seeded shops backfilled to `status='active'` with
      placeholder registrationData so the customer flow keeps
      working through the redesign.
- [x] Phase 12a-v2-i deployment audit + recovery: confirmed all
      `registerShop` / `approveShop` / `rejectShop` / `listPendingShops`
      / `getMyShop` Cloud Functions are live in `asia-south1`,
      `claimShop` is deleted, firestore.rules updated. Recovery
      followed a stuck-deploy incident where a Windsurf-issued
      `firebase deploy ... | Select-Object -Last 80` hid an
      interactive "delete claimShop?" prompt; user killed the shell
      and re-ran the deploy directly in PowerShell with `--force`
      to clear the queue.
- [x] Documented deploy discipline at `.windsurf/deploy-discipline.md`
      to prevent stuck-deploy incidents like the silent hang above:
      one `--only` target per command, never pipe deploy output
      through buffering filters, deploy from a real terminal not
      Windsurf, run `firebase functions:list` after every deploy.
- [x] Phase 12a-v2-iii: customer-facing per-shop menu. The customer
      browse flow (`ShopListScreen` + `ShopDetailScreen`) no longer
      reads the global `products` collection; it now hits a new public
      callable `listShopMenuPublic(shopId)` that returns the shop doc
      + its filtered `shops/{shopId}/menu` subcollection in one
      round-trip. Server-side filtering: only `available == true`
      items, only shops with `status === 'active'` (or legacy
      undefined-status shops, see backfill script) are returned —
      pending / suspended / rejected shops 404 even via direct shop
      URL. `placeOrder` validation now dispatches on the presence of
      `menuItemId` on each cart line: when present, it re-reads
      `shops/{shopId}/menu/{menuItemId}` and rejects if (a) the item
      is gone, (b) `available == false`, (c) `stock < quantity`, or
      (d) the price has drifted from the client's snapshot by more
      than 1 paisa. The customer is always charged the *current*
      menu price, never the client snapshot. Legacy carts (no
      `menuItemId`) keep the old products-collection validation path
      so AsyncStorage carts that survive the OTA upgrade don't
      break. `CartItem` extended with optional `menuItemId` +
      `priceSnapshot`; `useCartStore` gained `addMenuItem` /
      `forceAddMenuItem` mirroring the legacy `addItem` /
      `forceAddItem` (still used by `SearchScreen`, which keeps
      reading the global catalog — a deferred follow-up).
      `ShopListScreen` filters out non-active shops as a defense in
      depth on top of the server-side check. `ShopDetailScreen`
      computes `distanceKm` client-side because the public callable
      doesn't take a location (avoids per-user geo leaking into a
      cacheable response). Customer view sorts items by name within
      each category so the menu is stable as shop owners add custom
      items mid-session.
- [x] Phase 12a-v2-ii: per-shop menu management. New
      `shops/{shopId}/menu/{menuItemId}` subcollection with two flavors
      of items: GLOBAL (`isCustom: false`, references `productId`,
      shop owner can only edit `price` / `available` / `stock` —
      name/image/category locked to the catalog) and CUSTOM
      (`isCustom: true`, `productId: null`, fully editable + soft/hard
      delete). 4 new Cloud Functions: `listMyShopMenu`,
      `updateMenuItem`, `addCustomMenuItem`, `removeMenuItem`. Internal
      `bootstrapShopMenu` helper invoked by `approveShop` so a freshly
      approved shop arrives with its menu pre-seeded from the global
      catalog. 3 new shop-owner screens:
      `ShopMenuScreen` (grouped by category, per-row availability
      switch with optimistic update + revert, filter chips for All /
      Available / Unavailable / Custom),
      `ShopMenuItemEditScreen` (form is reactive to `isCustom` —
      GLOBAL items show a 🔒 banner explaining catalog-locked fields),
      `AddCustomMenuItemScreen` (full create form with category
      picker; image upload is URL-only, in-app picker is post-MVP).
      `firestore.rules` adds `shops/{shopId}/menu` rule (public read,
      Cloud-Functions-only writes). Backfill script
      `scripts/backfill-shop-menus.ts` (idempotent, run once via
      `npm run backfill-menus`) seeds the legacy 8 demo shops with
      the existing catalog. Whitelist enforcement on `updateMenuItem`
      prevents a misbehaving client from sneaking through `productId`
      / `isCustom` flips. Customer-facing reads still go through the
      legacy global catalog — Phase 12a-v2-iii will switch
      `ShopDetailScreen` to read from this menu collection.
- [x] Phase 12a-v2-i-bis: admin governance — revoke shopOwner /
      delivery roles, suspend / unsuspend shops, user management +
      shop management UIs. 6 new Cloud Functions: `revokeShopOwner`,
      `revokeDelivery`, `suspendShop`, `unsuspendShop`, `listAllUsers`,
      `listAllShops`. 4 new admin screens:
      `UserManagementScreen` (polled list with phone/uid filter),
      `UserDetailScreen` (revoke buttons + suspend-shop short-circuit
      + self-protection banner), `ShopManagementScreen` (grouped by
      status), `ShopDetailManagementScreen` (suspend/unsuspend with
      reason). Admin claim grant explicitly NOT exposed via UI —
      `set-admin` CLI is the only path. Single-admin lockout protected
      both client-side (button disabled when `uid === auth.uid`) and
      server-side (`failed-precondition` thrown). `revokeDelivery`
      reassigns in-flight deliveries by clearing `deliveryPersonId`
      and pushes "Delivery being reassigned" to affected customers,
      so orders keep moving when a partner is removed mid-shift.
      `suspendShop` does NOT cancel in-flight orders (intentionally —
      see follow-up below); customers stop seeing the shop via the
      existing `status==active` filter. Platform-policy comment
      block added at top of `functions/src/index.ts` warning future
      maintainers against adding any `grantAdmin` callable.
- [x] firestore.rules + firestore.indexes.json under version control
- [x] Audit script (`npm run audit`) gates code integrity after each Windsurf prompt

## 🧪 Testing

- [x] **Firestore rules tests** — emulator-based unit tests under
      `tests/rules/` lock down current `firestore.rules` behaviour.
      Five test files (`users.test.ts`, `shops.test.ts`,
      `shopMenu.test.ts`, `products.test.ts`, `orders.test.ts`,
      `orders-write.test.ts`), 52 tests total, every rule path has
      at least one allow + one deny case. Helpers (`tests/helpers.ts`)
      mint role contexts (`anon`, `user`, `admin`, `shopOwner`,
      `delivery`) using the same custom-claim shape as
      `mergeCustomClaims` in `functions/src/index.ts`. Seed data via
      `env.withSecurityRulesDisabled` so setup never fights the rules
      under test. Jest config + tsconfig live under `tests/` so the
      app's Expo/Metro tooling stays untouched. New dev deps are
      pinned: `jest@^29.7.0`, `ts-jest@^29.2.5`, `@types/jest@^29.5.13`,
      `@firebase/rules-unit-testing@^5.0.1`. [Phase 12c-rulestests]
      - Run locally: `npm run test:rules` (boots Firestore + Auth
        emulators on default ports 8080/9099 via the new `emulators`
        block in `firebase.json`, then runs Jest).
      - Watch mode: `npm run test:rules:watch`.
      - **Prereq:** local JDK 11+ on PATH — the Firestore emulator
        is a Java process. Adoptium Temurin 17 LTS recommended.
      - Coverage: `/users` (owner-only read+write), `/shops` (status-gated
        public read, owner/admin override, writes locked), `/shops/.../menu`
        (public read, writes locked), `/products` (public read, writes
        locked), `/orders` (customer + admin + matching shop owner +
        assigned/unassigned delivery person reads, writes locked).
      - Pinned edge case: shops with no `status` field (legacy
        pre-v2-i docs) are unreadable from the public path. The
        backfill in `scripts/backfill-shop-menus.ts` patches them
        to `status: 'active'`. Test
        `cannot read legacy shop with no status field` pins this so a
        rule change like `... || status == null` breaks loudly.
- [ ] **Cloud Functions unit tests** — separate PR. Use
      `firebase-functions-test` with the same emulator harness.
      Priority: `placeOrder`, `claimDelivery`, `approveShop`,
      `mergeCustomClaims`. [post-Phase 12c]
- [ ] **React component tests** — defer until UI stabilises post
      Phase 12c cleanup; component churn would invalidate tests
      every PR right now. [post-Phase 12c]
- [ ] **Detox / E2E happy-path** — defer until production role-play
      week. [pre-launch]
- [ ] **Storage rules tests** — revisit when image uploads ship
      (Phase 13?). Right now `storage.rules` only allows reads on
      product/shop images written by the seed scripts. [post-image-uploads]
- [ ] **CI integration for rules tests** — currently local-only.
      Add a GitHub Actions workflow that installs Node 20 + JDK 17
      and runs `npm run test:rules` on every PR touching
      `firestore.rules` or `tests/`. Sudhir runs everything locally
      for now. [pre-launch]
- [ ] **Set `enforceAppCheck: true` parity test** — when App Check
      enforcement is re-enabled in `functions/src/index.ts`, add a
      callable-functions test that proves a request without an App
      Check token is rejected. Pairs with the Security checklist
      item near the top of this file. [pre-launch]

## 🧪 Testing standard (project-wide, post-v2-iii hotfix)

**Every PR going forward must include automated tests for what it
changes or fixes.** Sudhir explicitly added this after the
loader-stuck-forever incident — manual smoke testing missed both the
shopService Plan-B gap AND the watcher silent-swallow bug because
neither produced a console error and neither was covered by the
rules tests. PRs without tests for new behaviour are rejected at
review. The two test runners now in the repo:

- [x] **Rules tests** — `npm run test:rules` (52/52 passing,
      emulator-backed). Locks down `firestore.rules` behaviour by role.
      Untouched by this PR.
- [x] **Unit tests** — `npm run test:unit` (24/24 passing as of this
      hotfix, in-process, no emulator). Covers Cloud Function pure
      logic, service-layer Plan-B dispatch, watcher contract, and
      screen-load state machines. Config:
      `tests/jest.unit.config.js`. Module mocks under
      `tests/__mocks__/` keep the suite running in plain Node — no
      Metro / RN runtime needed.
      [Phase 12a-v2-iii-hotfix-tests]
- [ ] **CI integration for unit tests** — currently local-only
      alongside `test:rules`. When the GitHub Actions workflow for
      rules ships, add `npm run test:unit` to the same workflow.
      [pre-launch]
- [ ] **React Native rendering tests (RNTL)** — out of scope for the
      hotfix. The unit-test infra deliberately avoids RNTL setup
      cost; the loader-stuck-forever bug class is tested at the
      hook/service layer instead. Revisit when the screen layer
      stabilises post Phase 12c. [post-Phase 12c]

### Resetting test data (before family role-play)

After Phase 12c finishes and solo + automated testing wraps, the dev
project is full of stale test orders, half-edited shops, ad-hoc
admin-approved menus, and one-off sign-ins. Before the family role-
play session we want fresh users walking up to the app cold — no
prior orders, shops going through the registration + approval flow
as workflow rather than legacy state. Use `scripts/reset-test-data.ts`
for the wipe.

**Default invocation (dry-run, safe):**

```powershell
$env:ADMIN_PROTECT_UID = "<your admin uid>"
npm run reset:test-data
```

Prints the deletion plan (orders / shops / menu / users / auth) and
exits without touching data. Audit log goes to
`scripts/.cleanup-logs/<ISO-timestamp>.json` either way.

**Real run (destructive, type-the-project-id confirmation required):**

```powershell
npm run reset:test-data -- --execute
```

The script asks you to type `grocery-mvp-dev` to confirm. Any other
input aborts with exit 1, no data touched.

**Selective flags:**

| Flag | Effect |
|---|---|
| `--keep-shops` | Wipe orders + users + auth; preserve `/shops` + their `/menu` subcollections |
| `--keep-orders` | Preserve `/orders`; wipe shops + menu + users + auth |
| `--no-confirm` | Skip the interactive prompt (CI use). Requires `--execute` separately — never a single-flag operation. |
| `--admin-uid=<uid>` | Override `ADMIN_PROTECT_UID` env var. |

**What it wipes (default `--execute`):**

1. `/orders/*`
2. `/shops/{shopId}/menu/*` (subcollection per shop, traversed explicitly)
3. `/shops/*`
4. `/users/*` (except `ADMIN_PROTECT_UID`)
5. Firebase Auth users (except `ADMIN_PROTECT_UID`, in batches of 1000)

**What it preserves (allowlist-based — anything not above is untouched):**

- `/products` — the full global catalog (expensive to rebuild)
- Admin UID's auth account + all custom claims (admin/shopOwner/delivery)
- Service accounts, Cloud Functions, rules, indexes
- Any collection not explicitly listed above (e.g. future `/notifications`,
  `/deliveryReports`) — the script is allowlist, not denylist, so a
  new collection ships safe-by-default and only gets cleanup support
  via a follow-up PR.

**Safety guards (non-negotiable, pinned by tests):**

- Hardcoded project allowlist (`ALLOWED_PROJECTS = ['grocery-mvp-dev']`)
  — not configurable by flag or env. Editing the list requires a
  separate, reviewable commit.
- `ADMIN_PROTECT_UID` must be set; if it's not in the auth user list,
  the script aborts (means the operator set the wrong UID, or the
  admin has already been deleted — both warrant human attention).
- `--no-confirm` rejected without `--execute` (typo guard).
- Unknown flags rejected (typo guard — `--keep-shop` singular would
  otherwise silently fall through to "delete everything").
- Service account email is printed; if it contains "prod" or doesn't
  contain "dev", a loud warning fires but the operator still has the
  call (judgment belongs to the human).
- Idempotent: re-running after a successful execute returns 0/0/0
  counts.
- Audit log JSON written every run (dry-run too) to
  `scripts/.cleanup-logs/`. Git-ignored except for `.gitkeep`.

**Out-of-scope (explicitly deferred):**

- Razorpay test-payment cleanup — external system, dev-mode payments
  are inert; the script just prints a reminder at the end.
- Cloud Storage cleanup — no uploads yet; revisit when image upload
  ships.
- Cloud Functions / Scheduler state — separate ops concern.
- Production wipe — the script refuses to run against anything other
  than `grocery-mvp-dev`. Adding prod support is a deliberate,
  reviewable commit, not a flag.

Tests: `tests/scripts/reset-test-data.test.ts` (22 tests covering
project guard, admin filter, flag parser, deletion plan). Pinned
under `npm run test:unit` — total unit-test count is now 46/46
(24 from the v2-iii hotfix + 22 from this PR). [Phase 12c-prep]

## � Auth UX + Profile + Saved Addresses (Phase 12a-v2-iv)

Two real UX gaps that surfaced during solo testing, fixed in one PR
because the schema + Cloud Functions are shared:

1. **No way to sign out.** `authService.signOut()` existed but was
   never called from any screen. Multi-user testing was literally
   blocked — once signed in, no path back to anonymous without
   reinstalling the app.
2. **Address re-entry on every checkout.** Customers retyped the
   full delivery address (name, phone, line1/2, city, pincode) on
   every order. Production-unacceptable.

Both are now fixed. New `Profile` row on Home (hidden when
anonymous) opens a screen that owns name/email + saved addresses +
Sign Out. Checkout auto-fills from the default saved address and
prompts to save unsaved ones after a successful order.

### What shipped

- [x] **`/users/{uid}` schema extension.** Added optional
      `name`, `email`, `addresses` (array of `SavedAddress`),
      `defaultAddressId`, `createdAt`, `updatedAt`. Server-internal
      fields (`fcmTokens`, `isAdmin`, `isShopOwner`, `isDelivery`,
      `deliveryStatus`, `deliveryStatusUpdatedAt`, `shopId`) are
      stripped from every getMyProfile response by
      `PROFILE_INTERNAL_FIELDS` in `functions/src/index.ts`. No
      `firestore.rules` change — the existing `match /users/{uid}
      { allow read,write: if isOwner(uid) }` already covers these
      fields. Types in `src/types/index.ts`. [Phase 12a-v2-iv]
- [x] **5 Cloud Functions (asia-south1, auth-required).**
      - `getMyProfile` — first-call seeds the doc with the user's
        phone number from `auth.token.phone_number`; if the doc
        exists but `phone` is missing (legacy), backfills on read.
        Skips silently when the auth token has no phone number
        (anon users).
      - `updateMyProfile({ name?, email? })` — patch with validation;
        `null`/`""` → clear via `FieldValue.delete()`.
      - `saveAddress(addressInput)` — read-modify-write inside a
        transaction. Mints a `crypto.randomUUID()` for new addresses;
        update path matches on input `id`. First address sets
        `defaultAddressId` atomically.
      - `deleteAddress({ id })` — idempotent; if it was the default,
        promotes the most-recently-updated remaining address (logic
        in `promoteDefaultAfterDelete`).
      - `setDefaultAddress({ id })` — throws `not-found` if the id
        isn't in the user's addresses.
      All five wrap their pure validation/mutation logic from
      `functions/src/profileHelpers.ts` so the validators are
      unit-testable in plain Node. [Phase 12a-v2-iv]
- [x] **`profileService` with native/web Plan-B dispatch.**
      `src/services/profileService.ts`. Same pattern as
      `orderService` — native uses `@react-native-firebase/functions`,
      web uses `firebase/functions`, both pinned to `asia-south1`.
      Exports `getMyProfile`, `updateMyProfile`, `saveAddress`,
      `deleteAddress`, `setDefaultAddress`. Errors propagate to
      caller (no silent swallow — same lesson from the v2-iii
      watcher hotfix). [Phase 12a-v2-iv]
- [x] **`signOutAndClearLocalState` orchestrator.**
      `src/services/signOutAndClearLocalState.ts`. Dependency-
      injected for unit-testability — production caller (Profile
      screen) wires real `authService.signOut`, `useCartStore.
      clearCart`, and `nav.reset({ index: 0, routes: [{ name:
      'Home' }] })`. Tests pass `jest.fn()`s. Order matters:
      `signOut` → `clearCart` → `resetNavigation`, signOut errors
      abort the cart + nav cleanup so the user doesn't lose their
      cart on a transient failure. [Phase 12a-v2-iv]
- [x] **Profile screen.** `src/screens/ProfileScreen.tsx`. Three
      sections: phone (read-only), name+email form with Save,
      saved addresses (cards with default chip; tap → edit;
      long-press → action sheet for "Set as default" / "Delete"),
      Account section with red Sign Out button (confirm dialog).
      Refetches profile on every focus so AddressEdit → goBack
      reflects updates immediately. [Phase 12a-v2-iv]
- [x] **AddressEdit screen.** `src/screens/AddressEditScreen.tsx`.
      Two modes: Create (no `addressId` route param) and Edit
      (`addressId` present → fetches the parent profile and
      hydrates from the matching address). Client-side validation
      mirrors `validateAddressInput` for instant feedback. Delete
      button visible only in Edit mode. Optional `prefill` route
      param for the Checkout post-order save flow.
      [Phase 12a-v2-iv]
- [x] **HomeScreen Profile entry-point.** New 👤 Profile row,
      visible only when `!isAnonymous`. Anonymous users see the
      existing 📱 Sign in row instead — same pattern. [Phase 12a-v2-iv]
- [x] **CheckoutScreen saved-address picker.** Two modes by
      `usingForm` flag: picker (≥1 saved address, default selected
      on focus) and form (0 addresses, or "Use a different
      address" tapped). Selecting a saved card mirrors its fields
      into the form state, so order placement uses the same code
      path. After a successful order:
      - If picked-from-saved: do nothing.
      - If 0 prior saved addresses: auto-save silently (becomes the
        new default).
      - Otherwise prompt "Save this address for next time?".
      Selection resets to default on every focus per Sudhir's UX
      call (cart survives nav, address selection does not).
      [Phase 12a-v2-iv]
- [x] **Routes registered.** `Profile` and `AddressEdit` added to
      `RootStackParamList` and `Stack.Navigator` in
      `src/navigation/AppNavigator.tsx`. AddressEdit route accepts
      optional `{ addressId, prefill }` params. [Phase 12a-v2-iv]
- [x] **`addressFormatting` util.** `src/utils/addressFormatting.ts`
      — pure conversions between `SavedAddress` and the form-
      fields shape. No React imports. [Phase 12a-v2-iv]
- [x] **33 new unit tests** (well above the spec's ≥18 floor).
      Pinned by:
      - `tests/utils/addressFormatting.test.ts` (7 tests)
      - `tests/utils/defaultAddressPromotion.test.ts` (4 tests)
      - `tests/functions/profileValidation.test.ts` (14 tests
        covering name/email patch + address-input validation)
      - `tests/services/profileService.test.ts` (4 tests covering
        native dispatch + error propagation + envelope unwrapping)
      - `tests/services/authService.signOut.test.ts` (5 tests
        including the order-of-operations contract and the
        signOut-error-aborts-cleanup safety case)
      Total unit-test count is now **79/79** (46 prior + 33 new).
      Deliberate-break demo: weakened the pincode regex in
      `validateAddressInput` to accept any string; the
      `rejects bad pincode (5 digits)` and
      `rejects bad pincode (alphabetic)` tests failed by name
      (2 fail / 12 pass), reverted, re-confirmed 14/14.
      [Phase 12a-v2-iv]

### Deferred (logged for follow-up)

- [ ] **Push token cleanup on sign-out** — the device's Expo push
      token currently stays in the previous user's
      `users/{prev-uid}.fcmTokens` after signing out. The previous
      account keeps receiving notifications meant for them on this
      physical device. Fix: add a `removePushToken` callable that
      arrayRemoves the current device's token, called from
      `signOutAndClearLocalState` BEFORE the firebase signOut
      (so request.auth.uid is still the old user). Skipped here
      because the fix needs a new callable + its own unit test;
      worth its own micro-PR. [Phase 12a-v2-iv-followup]
- [ ] **Profile entry-point in non-customer stacks** — the 👤
      Profile row is only on the customer Home. Owner / delivery /
      admin dashboards have their own headers and don't surface
      Profile. Acceptable for MVP since the dashboards are
      role-specific and most owner/delivery users will navigate
      back to Home anyway, but a full nav refactor would put
      Profile in a global drawer. [post-Phase 12c]
- [ ] **Email verification flow** — the email captured by
      updateMyProfile is accepted at face value (no verification
      link sent). Add later if email becomes important for
      marketing/notifications. Out of MVP scope per spec.
      [post-MVP]
- [ ] **Address autocomplete (Google Places)** — manual entry only
      for MVP. [post-MVP]
- [ ] **Multiple shipping addresses per order** — one address per
      order, same as today. Saved addresses are about reuse, not
      splitting. [post-MVP]
- [ ] **Profile picture upload** — no avatars in MVP. Phone +
      name + email is enough for receipts. [post-MVP]
- [ ] **`OrdersScreen` silent-warn on listMine error** — already
      logged from the v2-iii hotfix. The new test discipline
      would have caught this; copy the watcher's `(data, err)`
      pattern when the screen gets touched next.
      [Phase 12a-v2-iii-followup]

### Deploy + OTA (run from a real PowerShell window, not Windsurf)

Per `.windsurf/deploy-discipline.md`: one `--only` target per
command. Five separate deploys:

```powershell
firebase deploy --only functions:getMyProfile --project grocery-mvp-dev
firebase deploy --only functions:updateMyProfile --project grocery-mvp-dev
firebase deploy --only functions:saveAddress --project grocery-mvp-dev
firebase deploy --only functions:deleteAddress --project grocery-mvp-dev
firebase deploy --only functions:setDefaultAddress --project grocery-mvp-dev
firebase functions:list --project grocery-mvp-dev
```

Then OTA the client:

```powershell
eas update --branch preview --message "auth UX + profile + saved addresses"
```

Verify on the device after restart x2:
1. 👤 Profile row visible on Home (signed in only).
2. Edit name + email → save → reopen → values persisted.
3. Add address → appears with Default chip (first one).
4. Add 2nd address → long-press 1st → Set as default → chip moves.
5. Delete the default → next-most-recent gets promoted.
6. Sign Out → confirm modal → returns to Home in anon state, no
   "Your Roles" section, "Sign in with phone" CTA visible.
7. Place an order: saved-address picker if any, form if none;
   after the order, "Save this address?" prompt for unsaved
   addresses (auto-saved if you had 0 prior).

## Test-strategy reinforcement (Phase 12a-v2-iv-test-hardening)

The recent solo-test regressions exposed structural test gaps —
**all four bugs were contract drift between layers** that no
existing test asserted. This phase backfills the gaps so the same
classes can't regress.

### Audit: why each bug escaped tests

| Bug | Why missed | Fix |
|---|---|---|
| `listShopOrders` INTERNAL (missing index) | No test runs a real query; indexes are config | `audit:indexes` script + 14 unit tests |
| `addItem` doesn't stamp `menuItemId` | Cart-store had ZERO tests asserting line shape | 10 invariant tests (every add path) |
| `orderService.placeOrder` strips `menuItemId` | No wire-shape test connected cart → service → callable | 3 wire-shape tests (native + web) |
| `getOrder` rejects shop owners | Inline auth check, never extracted, never tested | 11 `canReadOrder` tests + 10 parity matrix cases |

### What shipped

- **`scripts/audit-firestore-indexes.ts`** — static parser that walks
  every `db.collection(...).where(...).orderBy(...)` chain in
  `functions/src/index.ts`, classifies as composite vs. single-field
  per Firestore rules, and verifies a matching entry in
  `firestore.indexes.json`. Wired into `npm test` via the
  `audit:indexes` script. Catches the v2-iv "INTERNAL" bug class
  entirely. **Caught one false-positive on first run that taught me
  Firestore's implicit-index rule** — pinned by tests so the
  heuristic doesn't regress.

- **`tests/store/useCartStore.invariants.test.ts`** (10 tests) —
  asserts that every cart-add path (`addItem`, `forceAddItem`,
  `addMenuItem`, `forceAddMenuItem`, plus increment / cross-shop /
  mixed-sequence flows) produces lines with `menuItemId: string`
  (non-empty) and `priceSnapshot: number`. Pins the v2-iv hotfix
  contract.

- **`tests/store/useCartStore.persist.test.ts`** (2 tests) — seeds
  AsyncStorage with a stale `cart-v1` payload (no `menuItemId`),
  hydrates the store, asserts the items array is empty under the
  new `cart-v2` key. Plus a positive control rehydrating a
  well-formed `cart-v2` entry. Catches future "we forgot to bump
  the persist version after a schema change" regressions.

- **`tests/services/orderService.placeOrder.test.ts`** (3 tests) —
  full integration test of the wire shape. Stubs the callable on
  both native and web paths, calls `orderService.placeOrder({...})`
  with real `CartItem[]`, asserts the captured payload has
  `menuItemId` on every line. Catches a future "let's just inline
  this map again" refactor that bypasses `buildPlaceOrderPayload`.

- **`tests/contracts/orderReadAuth.parity.test.ts`** (10 cases via
  `test.each`) — explicit matrix of every `(uid, claims, order) →
  expected` case from the rules clause, run through `canReadOrder`.
  Test names match `tests/rules/orders.test.ts` so a code reviewer
  can verify parity by eyeballing both files. **Documents the
  contract.**

- **`tests/scripts/auditFirestoreIndexes.test.ts`** (14 tests) —
  pins the audit script's `isComposite` + `indexCovers` + parser
  logic. Includes the false-positive case (multi-equality without
  orderBy) so the heuristic can't silently regress.

- **Test infra fix**: `tests/__mocks__/firebase-functions.ts` now
  uses `globalThis` for state, matching `rnfb-app.ts`. Without this,
  any `jest.isolateModules()` test of the web path lost the mock
  factory across the SUT module-registry boundary. **Caught while
  writing the placeOrder wire-shape test** — would have silently
  broken any future web-path test.

### Tests added: 39 (49 if you count the parity matrix as 10 cases)

**Total unit-test count: 162 / 162** (123 prior + 39 new).

### Deferred (logged for follow-up)

- [ ] **Order-read consistency lint** — every Cloud Function that
      calls `db.doc('orders/...').get()` should either use
      `canReadOrder` OR be allow-listed with a documented
      action-specific guard. Most current callsites
      (`cancelMyPendingOrder`, `claimDelivery`, etc.) have
      action-specific checks; a meta-lint would scan AST and
      verify. Complexity > current value, but worth doing if a
      similar drift bug recurs. `[Phase 12a-v2-iv-followup]`
- [ ] **Plan-B dispatch parity test (full)** — meta-test scanning
      every service file for `if (isNative)` blocks and asserting
      both branches call the same callable name with the same
      payload shape. The `placeOrder` test demonstrates the
      pattern; extending to all callables is mechanical. `[Phase 12a-v2-iv-followup]`
- [ ] **Firestore emulator integration tests** — actually run each
      callable through its real query path against a seeded
      emulator. Catches index issues, rules issues, dispatch issues
      at once. Requires `firebase emulators:exec` infra in CI.
      `[Phase 12c-prep]`
- [ ] **RNTL component tests** — for screens with non-trivial state
      machines. Hooks have pure-helper tests; this would add a
      thin render/event layer on top. `[Phase 12c-prep]`
- [ ] **Maestro / Detox E2E** — full user journeys. Highest cost,
      highest value for catching multi-layer bugs. Should be a
      separate phase. `[Post-launch]`

## View-first dashboard cards + delivery history (Phase 12a-v2-iv-followup-view-first)

Solo testing surfaced two related dashboard issues. Bundled into a
single PR (and single OTA) since they touch the same files.

### Issue 1 — Accidental accepts

Shop owners were tapping "Accept" on dashboard cards without seeing
the item list (the dashboard card never showed it). Same for
delivery partners tapping the inline "Accept" on an available-
pickup card with no item visibility. Both produced real-world
fulfilment errors.

**Fix**: removed first-commitment ("Category A") action buttons
from dashboard cards. Tapping the card body opens the detail
screen, where all the context is visible and the action lives.
One extra tap on the happy path; eliminates an entire class of
"I accepted by mistake" errors.

**Category B (mid-flow status updates)** — "I've picked it up" and
"Delivered" — STAY inline on the dashboard. Delivery use is
one-handed and under time pressure, the commitment is already
made, and forcing a tap-to-detail for these adds friction with
zero risk reduction.

### Issue 2 — No delivery history visible

Dashboard showed "Completed today" stat but no list of what was
actually delivered. The data was already in scope via
`watchMyDeliveries`. Added a collapsible "Delivery History"
section (default collapsed) below "My Active Deliveries".

### What shipped

- **`src/screens/shop/ShopOwnerDashboardScreen.tsx`** — removed
  inline `Accept` / `Mark Preparing` / `Mark Out for Delivery`
  buttons. Removed `handleAction`, `pending` Record state,
  `ACTION_LABELS` + `nextActionsFor` imports, `Alert` + `Button`
  imports, `SHOP_OWNER_ALLOWED_ACTIONS` constant. Card body is
  now a single `Pressable` (was a Pressable + sibling buttons
  region). Tap hint reads "Tap to view items & take action".

- **`src/screens/delivery/DeliveryDashboardScreen.tsx`**:
  - Removed inline `Accept` button + `handleClaim` + claim race
    state from `AvailablePickupCard`. Card body is now the sole
    tap target → navigates to `DeliveryOrderDetail`.
  - **`ActiveDeliveryCard` UNCHANGED** — Category B preserved.
    Inline "I've picked it up" → "Delivered" buttons stay.
  - Added `deliveredMine` memo (filter status==='delivered',
    sort by `deliveredAt` desc).
  - Added collapsible **"Delivery History"** section + new
    `DeliveryHistoryCard` component. Default collapsed. Tapping
    a row navigates to `DeliveryOrderDetail` (the existing
    delivered-state view handles it without changes).
  - History card **omits customer phone** (matches the privacy
    guard on `DeliveryOrderDetailScreen` available-for-claim
    state — the partner already had the phone while assigned;
    no need to keep surfacing it).

- **`src/utils/format.ts`** — added `formatRelativeDeliveryTime(ms, now?)`.
  Pure helper, no React, no IO, signature locked to `(ms, now?) =>
  string` for type-level privacy (no address/phone parameter
  slot). Rules:
  - same day → "Today 3:45 PM"
  - previous day → "Yesterday 11:20 AM"
  - within last 7 days → "Mon 2:15 PM"
  - older → "May 14, 2:15 PM"
  - Calendar-day diff (not 24h-ms) so DST flips behave correctly.

- **Detail screens UNCHANGED**:
  - `ShopOrderDetailScreen.tsx` already owned all action buttons
    via `useShopOrderDetail` — pinned by
    `tests/screens/detailScreenActions.test.ts`.
  - `DeliveryOrderDetailScreen.tsx` already owned "Accept this
    pickup" (added in the previous PR) — pinned by the same
    test file.

### Tests (30 new)

| File | Tests |
|---|---|
| `tests/utils/formatRelativeDeliveryTime.test.ts` | 8 (4 format branches + 6-day upper bound + midnight + DST + signature/privacy) |
| `tests/screens/dashboardCardActions.test.ts` | 17 (shop dashboard 6 + delivery available-card 3 + Category B preservation 2 + delivery history section 6) |
| `tests/screens/detailScreenActions.test.ts` | 5 (shop detail 3 + delivery detail 2) |

**Total unit-test count: 212 / 212** (182 prior + 30 new).

### Deliberate-break demo

Re-added `import { ACTION_LABELS, OrderStatus } from
'../../utils/orderStateMachine'` to `ShopOwnerDashboardScreen.tsx`
(with `void ACTION_LABELS;` to defeat the auto-import-cleaner that
strips unused imports on save — noticed during this work; logged
below). Test `does NOT import ACTION_LABELS` failed by name.
Reverted; 24 / 24 green.

### Deploy + OTA

JS-only — **no `firebase deploy` needed**.

```powershell
eas update --branch preview --message "view-first dashboard cards"
```

### Noticed during this work — auto-import-cleaner subtlety

The IDE's import-cleaner silently strips unused imports on save.
This means a structural test like "screen X must NOT import Y" can
become a no-op if the test author isn't careful — the cleaner does
the work for you. Mitigation: structural tests should also assert
the absence of an actual *use* (e.g. `handleAction` function
definition, `<Button title=...>` element), not just the import
line. The tests in `dashboardCardActions.test.ts` already check
function definitions + component-body content, not just imports —
intentional.

### Deferred (logged for follow-up)

- [ ] **Delivery History pagination** — currently renders whatever
      `listMyDeliveries` returns. Server-side pagination + windowed
      list rendering becomes worth doing when partners cross ~100
      lifetime deliveries. `[Phase 12c-prep]`
- [ ] **Earnings preview per delivered order** — the history card
      shows the order total but not the partner's cut. Defer until
      payout schema lands. `[Post-launch]`

## Delivery Preview Detail (Phase 12a-v2-iv-followup-delivery)

Parallel solo-test gap to the Shop Order Detail PR: delivery
partners couldn't see what's inside an available pickup before
tapping Accept — only shop name + drop area + count + total.
Insufficient signal to decide whether to claim (refrigerated
goods, alcohol brands, etc.). Fixed by extending the existing
`DeliveryOrderDetailScreen` to handle the unclaimed-available
branch with an "Accept this pickup" button at the bottom, plus
making the dashboard's `AvailablePickupCard` body tappable to
open it.

### What shipped

- **`src/screens/delivery/DeliveryOrderDetailScreen.useDeliveryOrderDetail.ts`** —
  new state-machine hook colocated with the screen. Mirrors the
  shop-side pattern (`useShopOrderDetail`). Pure helpers carry the
  semantic load:
  - `reduceWatcherUpdate(prev, update)` — guarantees `loading:
    false` on the error branch (the regression we keep solving)
  - `deriveDeliveryFlags(order, uid, isDelivery)` — derives
    `isAssigned`, `isAvailableForClaim`, `isPickedUp`,
    `isDelivered`, `isTerminalForOthers` in one place. The screen
    branches on these flags only.
  - `runClaimOnce(claimDelivery, orderId)` — discriminated
    `{ ok: true } | { ok: false; error }` so the screen can render
    the "Already taken" Alert without an unhandled rejection.
  - `runStatusActionOnce` — same shape for `markPickedUp` /
    `markDelivered`.
  - `applyOptimisticPickedUp` / `applyOptimisticDelivered` —
    pure factories that return new order objects with the
    optimistic stamp; tested for non-mutation.

- **`src/screens/delivery/DeliveryOrderDetailScreen.tsx`** —
  refactored from inline state to use the hook. Three branches:
  - **Available-for-claim**: "Accept this pickup" button at
    bottom. On success → navigate back to dashboard (post-claim
    refresh path is owned by the dashboard). On race-loss →
    "Already taken" Alert.
  - **Assigned, not delivered**: existing pickup → delivered
    flow (no behaviour change).
  - **Assigned, delivered**: existing green Delivered card.
  - **Terminal-for-others**: EmptyState ("Already taken" or
    "Order already delivered") instead of dead buttons. The
    screen now reflects terminal state without requiring a tap.
  - **Header title** flips between "Pickup details" (claim view)
    and "Delivery" (assigned view) — small but improves the
    mental model.
  - **Customer phone hidden until assigned** — privacy guardrail
    so a partner browsing available pickups can't harvest
    customer numbers without committing to the run. Address line
    is still visible so the partner can decide whether the area
    is in their range.

- **`src/screens/delivery/DeliveryDashboardScreen.tsx`** —
  `AvailablePickupCard` body is now wrapped in a `Pressable` that
  navigates to `DeliveryOrderDetail` with the `orderId`. The
  Accept button sits OUTSIDE the Pressable so the quick-claim
  path doesn't double-fire navigation. Chevron `›` added to
  signal tappability. Same UX pattern as `ShopOwnerDashboard`'s
  order cards.

### Tests (20 new)

`tests/hooks/useDeliveryOrderDetail.test.ts` — 20 pure-helper tests:

- `reduceWatcherUpdate` × 3: first success, watcher error clears
  loading (THE regression), error preserves prior order
- `deriveDeliveryFlags` × 9: null order, available-for-claim,
  not-delivery-role, claimed-by-other (terminal), assigned-not-
  delivered, assigned + pickedUp, assigned + delivered (NOT
  terminal — success state), wrong status (preparing), empty-
  string deliveryPersonId edge case
- `runClaimOnce` × 3: success, race-loss, fallback message
- `runStatusActionOnce` × 2: success, failure (revert path)
- `applyOptimisticPickedUp` / `applyOptimisticDelivered` × 3:
  pure copy semantics, no mutation, null passthrough

**Total unit-test count: 182 / 182** (162 prior + 20 new).

### Deliberate-break demo

Replaced `loading: false` with `loading: prev.loading` on the
error branch of `reduceWatcherUpdate`. Test
`watcher error clears loading (the regression we keep solving)`
failed by name, plus 6 cascading failures on the same code path.
Reverted, re-ran, 20 / 20 green.

### Deploy + OTA

JS-only — **no `firebase deploy` needed**.

```powershell
eas update --branch preview --message "delivery preview detail screen + claim button"
```

### Deferred (logged for follow-up)

- [ ] **Distance-aware filtering of available pickups** — separate
      tracked follow-up. The detail screen would benefit from "X km
      from your current location" context. `[Phase 12c-prep]`
- [ ] **Earnings preview ("you'll earn ₹X for this run")** — no
      schema for delivery payouts yet. Defer until payout model is
      decided. `[Post-launch]`
- [ ] **Delivery partner notes on order** — out of scope for MVP.
      `[Phase 12c-prep]`
- [ ] **In-app map preview** — explicitly out per Phase 12b "Do
      NOT" list. Maps app deep-link is fine for MVP. `[Post-launch]`

## Shop Order Detail screen (Phase 12a-v2-iv-followup)

Solo testing surfaced a fulfilment gap: the shop owner's dashboard
card shows count + phone + total + status, but **not the line
items**. Without the items, "Accept" is a coin flip — the owner
can't check stock or verify the brand of atta the customer wanted.
Same for customer name / address / payment method.

Server-side has all this on the existing order doc. Pure UI work.

### What shipped

- **New screen `src/screens/shop/ShopOrderDetailScreen.tsx`** —
  status header, customer block (with `tel:` tap-to-call on the
  phone), delivery address, items list with image + pack + qty +
  line total, bill summary, payment block, action buttons
  (Accept / Mark Preparing / Mark Out for Delivery, filtered
  through `nextActionsFor` ∩ `SHOP_OWNER_ALLOWED_ACTIONS`).
- **Hook `src/screens/shop/ShopOrderDetailScreen.useShopOrderDetail.ts`** —
  watcher subscription + optimistic action + revert on failure.
  Pure helpers (`reduceWatcherUpdate`, `applyOptimisticStatus`,
  `runOrderActionOnce`) extracted so the watcher contract +
  revert behaviour can be unit-tested without RNTL. Same
  pattern as `ShopListScreen.useShopListData`.
- **`ShopOwnerDashboardScreen` cards now navigate.** Card body
  wrapped in a `Pressable` that pushes `ShopOrderDetail` with the
  `orderId`. Action buttons sit OUTSIDE the Pressable so tapping
  Accept / Preparing doesn't double-fire navigation. Chevron `›`
  added to the card header to signal tappability.
- **Route registered** in `AppNavigator.tsx` as
  `ShopOrderDetail: { orderId: string }`.
- **Permission guard** at the top of the screen: if
  `!isShopOwner || !ownedShopId`, shows
  "Shop owner access required". After the watcher resolves, if
  `order.shopId !== ownedShopId`, shows "Not your shop's order"
  (defence-in-depth — Firestore rules will reject the read
  anyway, but UI shouldn't hang on a permission-denied error).

### Tests (9 new)

- `tests/hooks/useShopOrderDetail.test.ts` — 9 pure-helper tests:
  - `reduceWatcherUpdate` × 4: first success, watcher error
    clears loading (THE regression), error preserves prior order,
    fallback message
  - `applyOptimisticStatus` × 2: returns new object (no mutation),
    null passthrough
  - `runOrderActionOnce` × 3: success, throws → revert path,
    fallback message on throw-without-message

`watchOrder` permission-denied path is already covered by the
existing `tests/services/orderService.watchers.test.ts` (the
`other failure: cb(null, error)` test, which exercises the same
code branch — RNFB callable rejection bubbles through the same
`catch` block regardless of code).

**Total unit-test count: 112 / 112** (103 prior + 9 new).

### Deliberate-break demo

Replaced `loading: false` with `loading: prev.loading` on the
error branch of `reduceWatcherUpdate`. Test
`watcher error clears loading (the regression we keep solving)`
failed by name. Reverted, re-ran, 9 / 9 green.

### Deploy + OTA

JS-only — **no `firebase deploy` needed**.

```powershell
eas update --branch preview --message "shop owner order detail screen"
```

### Deferred (logged for follow-up)

- [ ] **AdminOrdersScreen** could reuse the same per-order detail
      pattern. Pattern now established; admin-side mirror would
      be a straight copy. `[Phase 12a-v2-iv-followup]`
- [ ] **Shop-side reject/cancel action** intentionally NOT in
      this PR. Currently rejection is admin-only. Decide whether
      shop owners should be able to cancel pending orders they
      can't fulfil (out of stock, out of delivery range) before
      phase 12c. `[Phase 12c-prep]`
- [ ] **Shop-side internal notes** on the order (e.g. "called
      customer, switching to brand B"). Out of MVP scope but a
      common ask from real-world shop owners. `[Phase 12c-prep]`
- [ ] **Print/export receipt** — out of MVP. `[Post-launch]`

## Solo-test hotfix (Phase 12a-v2-iv-hotfix-1)

Three independent bugs surfaced in Sudhir's first post-auth-UX
solo-test pass. Diagnosed before patching per the
diagnostic-first discipline.

### Bug 1 — Shop Dashboard "INTERNAL" with red Retry banner

**Root cause: missing Firestore composite index.**

`listShopOrders` queries
`orders where shopId == X order by createdAt desc limit 100`
which requires a composite index on `(shopId ASC, createdAt
DESC)`. `firestore.indexes.json` had no such entry. Firestore
returned `FAILED_PRECONDITION` with the create-index link in the
message; RNFB SDK on native serialised the whole thing as
`INTERNAL`. Shop owners hit it on every dashboard load.

**Fix.**

- Added the index to `firestore.indexes.json`. Requires
  `firebase deploy --only firestore:indexes`.
- **Extracted `listShopOrders`'s claim-validation logic to
  `functions/src/shopOrdersHelpers.ts` as
  `validateShopOrdersAccess()`** — pure, testable, returns a
  discriminated `{ ok, code, message }` instead of throwing
  inline. The old inline check concatenated claim values into the
  error message which is what tipped RNFB into the `INTERNAL`
  serialisation in the first place; the helper guarantees the
  intended `invalid-argument` / `permission-denied` codes.
- **Mapped error codes to user-friendly messages.**
  `src/utils/shopOrdersErrorMessage.ts` exports
  `mapShopOrdersError()` and is wired into
  `ShopOwnerDashboardScreen`'s watcher callback. Covers `internal`,
  `unauthenticated`, `permission-denied`, missing-index
  `failed-precondition`, plus the RNFB `functions/`-prefixed
  variants. No more raw "INTERNAL" surfaces in the UI.

### Bug 2 — Saved addresses don't auto-fill at Checkout

**Root cause: UNCONFIRMED — observability deployed, fix deferred.**

`CheckoutScreen`'s `useFocusEffect` calls `profileService.getMyProfile()`
and swallowed any error silently into form mode. Sudhir hit this
on a session where Profile screen worked fine but Checkout
dropped into manual form mode. Without a server-side error trace
we can't tell whether the call is failing client-side (App Check
token, RNFB auth state) or server-side.

**Observability shipped:**

- `CheckoutScreen` now logs `e?.code`, `e?.message`, and `e?.stack`
  verbosely on getMyProfile failure (was previously a single-line
  `console.warn`).
- Yellow banner renders above the form when the load fails:
  *"Couldn't load saved addresses (\<reason\>). Enter manually
  below."* with a Retry button that re-fires `getMyProfile`.

**Root cause fix deferred** — Sudhir to repro on next session and
paste `firebase functions:log --only getMyProfile` output. Logged
as `[Phase 12a-v2-iv-followup]` below.

### Bug 3 — "Product p_001_atta_5kg not in this shop" at place-order

**ROOT CAUSE (corrected after first repro post-OTA):
`orderService.placeOrder` was stripping `menuItemId` from the wire
payload.** Sudhir's repro on shop_008 with the cart-store fix
already deployed showed the same error every time, regardless of
shop, role, or cart state. Tracing the actual data flow revealed
the real bug:

```ts
// src/services/orderService.ts (pre-fix)
const compactItems = input.items.map(i => ({
  productId: i.productId,
  quantity: i.quantity,
}));
```

This `.map(...)` silently dropped `menuItemId` and `priceSnapshot`
from every line before sending to the server. Even though the
cart store correctly stamped them in memory, they never reached
the Cloud Function — placeOrder always took the legacy
products-collection path and rejected with the well-known error
whenever the global product's shopId didn't match the cart's
shopId (always true for shop-scoped products like `p_008_atta`).

The earlier two diagnoses (SearchScreen legacy `addItem`,
persisted cart-v1 contamination) WERE real issues but were
defence-in-depth — the real wire-shape bug masked them
completely. Both fixes are kept for in-memory correctness; the
ACTUAL fix is in orderService.

**Real fix:**

- Extracted `buildPlaceOrderPayload()` to
  `src/services/placeOrderPayload.ts` and routed
  `orderService.placeOrder` through it. Helper forwards
  `menuItemId` and `priceSnapshot` (only when present + valid)
  alongside `productId` + `quantity`. Server-side dispatch now
  works as designed.
- Pinned by `tests/services/buildPlaceOrderPayload.test.ts` —
  6 tests covering the regression case, missing fields, empty
  string, NaN priceSnapshot, multi-line carts, and exact key set.

**Defence-in-depth (kept from first attempt):**

The error string is from `placeOrder`'s legacy
`products`-collection validation path
(`functions/src/index.ts` line 224), which fires when
`ci.menuItemId` is falsy on a cart line. Two ways to get there:

1. **SearchScreen's add-to-cart calls the legacy `addItem`.**
   `useCartStore.addItem` / `forceAddItem` did NOT set
   `menuItemId` on the new line. ShopDetailScreen was migrated to
   `addMenuItem` in v2-iii but SearchScreen was left on the old
   path — a v2-iii oversight.
2. **Persisted carts from before v2-iii.** Zustand persist key
   `cart-v1` rehydrates any line shape; pre-v2-iii AsyncStorage
   entries have no `menuItemId`. After OTA the user sees their
   old cart "still there" and gets rejected at place-order.

**Fix.**

- `useCartStore.forceAddItem` now stamps `menuItemId = product.id`
  and `priceSnapshot = product.price` on every new line. Safe
  because `bootstrapShopMenu` uses `product.id` as the menu doc
  id for GLOBAL items, so the menu-validation path will resolve.
- Existing-line update branch also backfills `menuItemId` and
  `priceSnapshot` if they're missing (defensive for any line
  added before this hotfix but still in the cart).
- Bumped persist version `cart-v1` → `cart-v2`. Drops stale
  pre-hotfix carts on next launch. The alternative — running a
  migration — wasn't worth the complexity for what's a transient
  pre-launch issue.
- **Extracted `pickCartLinePath()`** to
  `functions/src/shopOrdersHelpers.ts` and pinned its contract.
  The placeOrder dispatch itself is unchanged (still
  `if (ci.menuItemId) {…} else {…}`); the helper exists for the
  test surface.

### Tests (18 new, pinned)

- `tests/functions/listShopOrdersValidation.test.ts` — 6 tests
  covering shopOwner self / shopOwner cross-shop /
  admin-any-shop / missing-shopId / empty-string-shopId /
  shopOwner-no-body-param.
- `tests/functions/placeOrderMenuValidation.test.ts` — 4 tests
  covering the `pickCartLinePath` predicate (menu / legacy /
  empty-string / wrong-type).
- `tests/utils/shopOrdersErrorMessage.test.ts` — 8 tests covering
  all 4 explicit codes + RNFB-prefixed variant + missing-index
  message trim + fallthrough + null/undefined/empty defaults.

**Total unit-test count: 97 / 97** (79 prior + 18 new).

### Deliberate-break demo

Weakened `validateShopOrdersAccess` to coerce an undefined
`shopId` to `'shop_fallback'` instead of returning the
`invalid-argument` rejection. Two tests failed by name:
- `rejects with \`invalid-argument\` (not INTERNAL) when shopId
  is undefined and caller has no shopId claim`
- `rejects when claims.shopId is an empty string (stale-claim
  edge case)` (cascading on same code path)
Reverted, re-ran, 6 / 6 green.

### Deploy + OTA — run from a real PowerShell window

Per `.windsurf/deploy-discipline.md` — one `--only` target per
command.

```powershell
firebase deploy --only firestore:indexes --project grocery-mvp-dev
firebase deploy --only functions:listShopOrders --project grocery-mvp-dev
firebase firestore:indexes --project grocery-mvp-dev
firebase functions:list --project grocery-mvp-dev
```

Index builds take 1–5 minutes for the small `orders` collection
in dev. The `firestore:indexes` print will show STATE=READY when
the new index finishes. Until then `listShopOrders` will still
return the missing-index `failed-precondition`, which the new
`mapShopOrdersError` now surfaces as "Orders index is being
built. Try again in a few minutes." rather than "INTERNAL".

Then OTA the client:

```powershell
eas update --branch preview --message "solo-test hotfix: shop dashboard index + checkout observability + cart menuItemId stamp"
```

### Post-OTA verification

1. **Shop Dashboard** — sign in as shop owner, tap 🛍️ Shop
   Dashboard. Either shows orders, OR shows "Orders index is
   being built. Try again in a few minutes." (while index is
   still PROVISIONING), OR shows the empty state. **Must NOT
   show "INTERNAL".**
2. **Checkout with saved addresses** — sign in as a user with
   ≥1 saved address, add an item to cart, open Checkout. Picker
   cards appear with default selected. If they don't, the yellow
   banner now shows the actual reason — paste the device console
   `[Checkout] getMyProfile failed: <code> <message>` line into
   the next session for root-cause analysis.
3. **Cart menuItemId stamping** — sign in as customer, browse a
   shop (any seeded one), add atta to cart from ShopDetail, open
   Checkout, place order. **Must NOT show "not in this shop"
   rejection.** If it does, `cart-v2` invalidation didn't fire;
   reinstall the app to clear AsyncStorage entirely.

### Deferred (logged for follow-up)

- [ ] **Bug 2 root cause** — Sudhir to paste
      `firebase functions:log --only getMyProfile --project grocery-mvp-dev`
      output from the next Checkout-falls-into-form-mode repro.
      Likely candidates: App Check token rotation race on Android
      dev-client, or RNFB phone-auth token not propagating to the
      Cloud Function on a specific re-focus. Observability is in
      place; needs server logs to isolate. `[Phase 12a-v2-iv-followup]`
- [ ] **SearchScreen still bypasses the menu price-snapshot
      capture** — the new `forceAddItem` stamps `priceSnapshot`
      from `product.price` (the global products doc), not from
      `shops/{shopId}/menu/{menuItemId}.price`. If the shop owner
      has set a per-shop price override on this item, the
      Search-added line will start with the global price and only
      get the menu price on the next add-to-cart from a menu-aware
      surface. Acceptable for MVP since placeOrder re-validates
      price server-side against the current menu doc and rejects
      drift. `[Phase 12c-prep]`
- [ ] **`AdminOrdersScreen` should reuse `mapShopOrdersError`** —
      same `INTERNAL`-leak risk on the admin watcher
      (`listAllOrders`). One-line wiring change. Not done here to
      keep this hotfix scoped. `[Phase 12a-v2-iv-followup]`
- [ ] **`bootstrapShopMenu` swallows errors on approve.** Line
      1677 catches with `console.error` and returns success. If
      the menu seeding fails (out of products, write rule changes,
      transient Firestore error), the shop is marked active with
      an empty menu — customers see "Closed" / "no items" until
      an admin manually runs the backfill script. The right fix
      is to surface a `bootstrapMenuFailed` flag on the shop doc
      so admin dashboard can show a "menu missing — re-bootstrap"
      action row. `[Phase 12c-prep]`

## ��� Customer-side native fetch + loader-stuck-forever sweep (post-v2-iii hotfix)

Sudhir hit "Browse shops near me" on his Android device and the loader
spun forever. Root cause: `shopService.getNearbyShops` was reading
Firestore directly through the Firebase Web SDK, which hangs on this
RN setup (Expo SDK 54 + RN 0.81 + static frameworks — same
incompatibility that motivated the orderService Plan-B). Compounded by
`ShopListScreen` not having a try/catch around the load, so even a
thrown `getDocs` would never reset the loader. Pinned here so future
"loading forever" reports check the SDK split first.

- [x] **`shopService.getNearbyShops` — Plan B via `listShopsPublic`**
      — new public callable in `functions/src/index.ts` (next to
      `listShopMenuPublic`), filters `status=='active'` server-side
      (defense in depth with `firestore.rules`), computes
      `distanceKm` via haversine, and sorts ascending by distance
      when `userLocation` is provided. `src/services/shopService.ts`
      now dispatches via `Platform.OS`: web keeps the existing
      `getDocs(collection(db, 'shops'))` path; native uses RNFB
      `httpsCallable('listShopsPublic')`. The
      `FORCE_SHOW_ALL_SHOPS_IN_DEV` override is still applied
      client-side on both paths so dev behaviour matches production.
      [Phase 12a-v2-iii-hotfix]
- [x] **`shopService.getById` — Plan B via reusing
      `listShopMenuPublic`** — native path calls the existing
      `listShopMenuPublic` callable (which already returns
      `{ shop, items }`) instead of a fresh `getShopPublic` callable;
      keeps the callable surface small. `not-found` errors from the
      server (missing or non-active shops) are caught and surfaced as
      `null` to match the web path's semantics. There are currently
      no callers of `shopService.getById` in `src/`, but the method
      is fixed pre-emptively rather than left as a future foot-gun.
      [Phase 12a-v2-iii-hotfix]
- [x] **`ShopListScreen` — guaranteed loading reset + error UI** —
      `src/screens/ShopListScreen.tsx` now wraps the `load()` call
      in `try/catch` and the initial-load effect's `setLoading(false)`
      is called from a `finally` block that runs regardless of how
      the promise settles. A new `error` state renders a red banner
      with a Retry button (styled with `colors.danger` from
      `src/constants/theme.ts`). The "no location yet" branch flips
      `loading` to false instead of sitting on the spinner — the app
      always falls back to `MOCK_USER_LOCATION` so this state should
      be transient anyway, but it's no longer indistinguishable from
      a stuck network call. [Phase 12a-v2-iii-hotfix]
- [ ] **`productService.getByShop` needs Plan B** —
      `src/services/productService.ts:6-10` reads
      `query(collection(db, 'products'), where('shopId', '==', shopId))`
      via the Web SDK. Reachable from native via
      `src/screens/SearchScreen.tsx:53` (called inside the customer
      Search flow). Has the same hang risk as the shop list bug —
      Sudhir just didn't trip it because Search hits `getNearbyShops`
      first and bails on the loader. Out of scope for this hotfix
      because Search already has a TS error
      (`shopService.getNearbyShops()` called with no args at
      `SearchScreen.tsx:49`) which suggests the screen is partially
      bit-rotted; bundle the Plan B refactor with a Search audit pass
      so we don't half-fix a stale screen. Suggested fix: a
      `listProductsByShopPublic` callable mirroring
      `listShopsPublic` / `listShopMenuPublic`. [Phase 12a-v2-iii-followup]
- [ ] **`productService.getById` needs Plan B (low priority)** —
      `src/services/productService.ts:11-14`. Currently has zero
      callers under `src/` (grep showed only `productService.getByShop`
      reachable). Leave the method in place for now — it'll naturally
      get the same Plan B treatment if/when something starts calling
      it, or get deleted if v2-iii's per-shop-menu model fully
      replaces it. [Phase 12a-v2-iii-followup]
- [x] **`orderService` web-SDK reads / `onSnapshot`s — already
      Plan B for the dispatch axis** — verified during the audit.
      `listMine` (line 143), `watchOrder` (line 219),
      `watchShopOrders` (line 537), and `watchAllOrders` (line 681)
      all gate their Web SDK calls behind `if (isNative) { … return }`
      blocks that route through RNFB callables (`listMyOrders`,
      `getOrder`, `listShopOrders`, `listAllOrders`). The dispatch
      itself is fine; the *callback contract* needed fixing — see
      next entry. [audit-only]
- [x] **Watcher contract refactor: `(data, error?)` callback shape**
      — `src/services/orderService.ts` `watchOrder`,
      `watchShopOrders`, `watchAllOrders`, `watchAvailableDeliveries`,
      `watchMyDeliveries` previously called the consumer's callback
      only on success and `console.warn`'d on failure. That left
      `ShopOwnerDashboardScreen` (and any other consumer that flipped
      `loading=false` only inside the success branch) spinning
      forever on the very first failed poll. New contract: every
      watcher invokes `cb(data, undefined)` on success and
      `cb(emptyValue, error)` on failure. The web-side `onSnapshot`
      paths pass an error callback through too, so behaviour is
      symmetric. Pinned by
      `tests/services/orderService.watchers.test.ts` — 9 tests
      covering all five watchers + the cleanup-on-cancel path; the
      "never silently swallows" assertion deliberate-break demo
      reverted one watcher's catch and watched the test fail (1
      failed / 8 passed), then re-applied the fix. `watchOrder`
      keeps its `not-found` → `cb(null, undefined)` semantics
      because consumers render that as an EmptyState, not an error.
      [Phase 12a-v2-iii-hotfix]
- [x] **Consumer screens adopted the new contract** —
      `src/screens/shop/ShopOwnerDashboardScreen.tsx`,
      `src/screens/admin/AdminOrdersScreen.tsx`,
      `src/screens/OrderDetailScreen.tsx`,
      `src/screens/delivery/DeliveryDashboardScreen.tsx`,
      `src/screens/delivery/DeliveryOrderDetailScreen.tsx`, and
      `src/screens/OrderConfirmationScreen.tsx` all destructure
      `(data, err)` from the watcher cb, route errors to a banner
      (Retry button on the dashboards, inline banner on the detail
      screens) and ALWAYS flip `loading=false` on the first callback
      regardless of err. Retry on the dashboards re-subscribes by
      bumping a `retryNonce` state in the effect deps — re-creating
      the watcher rather than racing its existing interval.
      `OrderConfirmationScreen` adopts the contract minimally
      (warns on err) because that screen renders an "Order saved"
      splash regardless of whether the live order doc has loaded.
      [Phase 12a-v2-iii-hotfix]
- [x] **`ShopListScreen` extracted to a testable hook** — load /
      error state machine moved to
      `src/screens/ShopListScreen.useShopListData.ts` so it can be
      unit-tested in plain Node. The screen is now a thin presenter
      (`useShopListData(location ?? null)`); the analytics fire
      stays in the screen because the hook deliberately stays free
      of side-effects. `loadShopListOnce` is exported separately
      and pinned by `tests/hooks/useShopListData.test.ts` (4 tests:
      success, network-throw, no-message-prop fallback, settled-
      not-rejected guard). [Phase 12a-v2-iii-hotfix]

### Generic loader-stuck audit across `src/screens/`

Audited every screen with `useState(true)` for the symptom pattern.
Status (✓ = safe, ★ = fixed in this PR, ⚠ = logged follow-up):

- ✓ `ShopListScreen` (★ — hook + try/finally + error UI)
- ✓ `ShopDetailScreen` — already had try/catch/finally with
  `errorMsg` state; no change needed.
- ✓ `ShopOwnerDashboardScreen` (★ — new contract + retry banner)
- ✓ `ShopMenuScreen` — try/finally guard around the fetch.
- ✓ `ShopMenuItemEditScreen` — try/finally with cancellation guard.
- ✓ `OrderDetailScreen` (★ — new contract + inline error banner)
- ✓ `DeliveryOrderDetailScreen` (★ — new contract + inline banner)
- ✓ `DeliveryDashboardScreen` (★ — new contract on both watchers
  with reconcileError merging; banner shows only when BOTH watchers
  have errored, so a single-source blip stays quiet)
- ✓ `AdminOrdersScreen` (★ — new contract + retry banner)
- ✓ `OrderConfirmationScreen` (★ — new contract, log-only)
- ⚠ `OrdersScreen` (`src/screens/OrdersScreen.tsx:31-33`) —
  `await orderService.listMine(uid)` is wrapped in try/catch but
  the catch only does `console.warn`; on failure the screen
  silently flips to "No orders" instead of surfacing a retry. Not
  the loader-stuck bug class (the finally path works), but it's a
  sibling silent-failure that the new testing standard would have
  caught. Fix when the screen gets touched next. Suggested:
  copy the `(data, err)` pattern from the watcher refactor.
  [Phase 12a-v2-iii-followup]
- ⚠ `WaitingForApprovalScreen` (`src/screens/roles/WaitingForApprovalScreen.tsx`)
  — polling `getShopForOwner`; catch sets loading false but logs
  warn only. User just sees the loading vanish with no shop card
  and no error message. Same low-severity sibling. Fix when next
  touched. [Phase 12a-v2-iii-followup]
- ⚠ Admin screens (`PendingShopsScreen`, `ShopDetailManagementScreen`,
  `UserManagementScreen`, `UserDetailScreen`,
  `ShopRegistrationDetailScreen`, `ShopManagementScreen`) — not
  exercised in this audit; admin role's first launch will surface
  any loader issues. Out of customer/owner/delivery happy path so
  acceptable to defer. Add to a future "admin polish" sweep.
  [Phase 12a-v2-iii-followup]

### Tests added in this PR

- [x] `tests/functions/listShopsPublic.test.ts` — 5 tests for the
      `rankShopsByDistance` pure helper extracted from
      `functions/src/index.ts`. Covers sort, no-location passthrough,
      malformed-location fallback, no-location-shop sentinel, and
      input-immutability.
- [x] `tests/services/shopService.test.ts` — 6 tests for Plan-B
      dispatch. Native + web paths for both `getNearbyShops` and
      `getById`, plus error propagation and not-found → null
      mapping.
- [x] `tests/services/orderService.watchers.test.ts` — 9 tests for
      the new watcher contract across all five `watch*` methods.
      Covers success, failure (the bug being fixed), watchOrder's
      not-found special case, and cleanup-on-cancel.
- [x] `tests/hooks/useShopListData.test.ts` — 4 tests for the
      ShopList load state machine, including the
      "loadShopListOnce never re-throws" regression guard so a
      future contributor can't accidentally bring back the
      loader-stuck-forever symptom by re-throwing.
- **Total new tests: 24** (tests/jest.unit.config.js suite). Plus
  pre-existing 52 rules tests untouched. New `npm run test:unit`
  script + module-mock harness under `tests/__mocks__/` (one stub
  per heavy native dep — `react-native`, `@react-native-firebase/app`,
  `firebase/firestore`, `firebase/functions`, `services/firebase`,
  `services/sentry`).

---

## Admin polish (Phase 12c)

The original Phase 12 plan ended at 12c — admin polish. With 12a /
12a-v2-i…iv (registration, governance, menu management,
profile+addresses), 12b (delivery panel), and the various
post-OTA hotfixes all shipped, 12c is the last functional phase
before testing-and-cleanup mode. Three self-contained admin
enhancements that make admin work less tedious at real volume.
None block family testing — admin screens aren't on the
customer/owner/delivery happy path. JS-only changes ship as OTA;
one optional small Cloud Function (`getOnlineDeliveryCount`).

### What shipped

- [x] **AdminOrdersScreen stats card.** Three stats above the
      orders list, mirroring the visual pattern of
      `ShopOwnerDashboardScreen`'s "Today" card:
        1. Today's GMV — sum of `order.total` for non-cancelled
           orders from today (calendar day, local TZ).
        2. Active orders — count of orders in `pending`,
           `accepted`, `preparing`, or `out_for_delivery`.
        3. Online delivery partners — fetched from the new
           `getOnlineDeliveryCount` callable; polls on its own
           15s rhythm (independent of the 10s
           `watchAllOrders` cadence).
      Stats math extracted into
      `src/utils/adminStats.ts → computeAdminOrderStats(orders, now)`
      so the calendar-day branch + cancelled-exclusion rule are
      unit-tested. Partner count flows through
      `src/hooks/useOnlineDeliveryCount.ts` (small custom hook) so
      the screen stays a thin shim. [Phase 12c]
- [x] **PendingShopsScreen days-since chip + sort.** Each pending
      row now shows a "Submitted N days ago" chip computed from
      `shop.registrationData.submittedAt` via the new
      `daysSince(ts, now?)` helper in `src/utils/format.ts`.
      Shops pending > 7 days render the chip in warning colors
      (`colors.warning`) so admins can spot reviews that have
      slipped. The list is also defensively sorted client-side
      by `submittedAt` ascending (oldest first), defending
      against a legacy shop with a missing field that would null-
      coalesce to 0 server-side. [Phase 12c]
- [x] **ShopRegistrationDetailScreen owner section.** A new
      "Owner" card above the action buttons shows owner phone
      number, account creation date, and a count of prior
      approved/rejected shops for that owner (informational —
      helps spot resubmissions). Owner info is loaded via the
      existing `listAllUsers` callable; prior-shops count via
      the existing `listAllShops` callable, filtered by
      `ownerUid` and excluding the pending shop being viewed.
      A days-since banner sits above the shop card with the same
      stale > 7d warning treatment as the list. **No new
      `getUserById` callable** was added — `listAllUsers`
      (capped at 100) is sufficient at MVP scale. [Phase 12c]
- [x] **UserManagementScreen filter + search overhaul.** Five
      role-filter chips at the top (`All / Admin / Shop owner /
      Delivery / Customer`); a sort toggle (`Newest first ↓` /
      `Oldest first ↑` by `lastSignInAt`); 250ms-debounced
      search input so a fast-typed phone doesn't re-render the
      list on every keystroke. The list still pins "self" to the
      top regardless of role/sort so admins can find their own
      profile in one glance. Filter+sort logic extracted into
      `src/utils/userListFilters.ts → filterAndSortUsers(users,
      role, sortDir, query)` — all five role buckets, both
      sort directions, search-substring contract, and the
      null-`lastSignInAt` tail-sort are pinned with unit tests.
      [Phase 12c]
- [x] **`getOnlineDeliveryCount` callable.** Single small
      admin-only callable in `functions/src/index.ts`,
      asia-south1 region. Queries `users` for
      `isDelivery == true && deliveryStatus == 'online'`. The
      same equality pair is used by
      `sendNewPickupPushToDelivery`, so the single-field indexes
      are already implicit; `npm run audit:indexes` confirms no
      new composite needed (two equalities + no orderBy → not
      composite per Firestore semantics). Auth check + count
      assembly extracted into
      `functions/src/onlineDeliveryCountHelpers.ts →
      computeOnlineDeliveryCount({auth, fetchCount})`, mirroring
      the `validateShopOrdersAccess` posture so the helper can be
      unit-tested without booting firebase-admin. Rejects
      unauthenticated callers with `unauthenticated` and
      non-admin (shopOwner/delivery/customer) callers with
      `permission-denied`. [Phase 12c]
- [x] **Client method.**
      `orderService.getOnlineDeliveryCount(): Promise<number>` —
      Plan-B native + web dispatch, defensive `Math.max(0,
      Math.floor(...))` clamp on the server's response so a
      malformed payload can never produce `NaN` in the stats
      card. [Phase 12c]
- [x] **Tests added: 35** (across 4 new files).
      `tests/utils/adminStats.test.ts` (4 tests),
      `tests/utils/format.daysSince.test.ts` (5 tests),
      `tests/utils/userListFilters.test.ts` (12 tests),
      `tests/functions/onlineDeliveryCount.test.ts` (5 tests).
      Plus the deliberate-break demo: reverting the `cancelled`
      exclusion in `computeAdminOrderStats` failed
      `cancelled orders don't count toward GMV (regression
      guard)` by name; fix re-applied; suite back to green.
      [Phase 12c]

### Deferred (logged for follow-up)

- [ ] **Admin audit log** — every revoke / suspend / approve /
      reject should write a row to an `auditLog` collection so
      the platform operator can reconstruct who did what and
      when. Schema TBD; design as part of the post-12c cleanup
      sweep. `[Phase 12c-followup]`
- [ ] **Multi-admin invite flow** — still CLI-only per platform
      policy. The `set-admin.ts` script requires
      `service-account.json`. If/when we want to invite a
      co-admin, the right design is a magic-link flow that the
      existing admin generates and the invitee redeems on
      first sign-in (still going through a server-side script,
      not a callable). `[Post-launch]`
- [ ] **Refund flow for paid orders** — admin-only. The
      cancellation path currently doesn't trigger a Razorpay
      refund. Out of scope for 12c since refund logic depends on
      the payment-mode invariants we haven't fully nailed yet.
      `[Post-launch]`
- [ ] **Stats over time ranges (7d / 30d / custom)** — MVP shows
      today only. Add range chips + a small chart component
      once we have enough order volume to make the chart useful.
      `[Post-launch]`
- [ ] **`listAllUsers` pagination at scale** — hard-coded 100-
      user cap is fine at MVP scale; switch to cursor-paginated
      fetch when the user count crosses ~80 (gives headroom).
      `[Phase 12c-followup]`
- [ ] **Admin-side direct edit of orders** — admin can only
      change status via existing buttons by design. Field
      edits (line items, address, total) are explicitly out of
      scope; the audit posture would have to be much stronger
      first. `[Post-launch]`
- [ ] **AdminOrdersScreen reuse `mapShopOrdersError`** — the
      admin watcher (`watchAllOrders`) still surfaces raw
      callable errors. Same `INTERNAL`-leak risk as the
      pre-v2-iv shop dashboard. One-line wiring change deferred
      to keep this PR focused on the three stated polish items.
      `[Phase 12c-followup]`

### Deploy + OTA (Phase 12c discipline)

Per `.windsurf/deploy-discipline.md`: one `--only` target per
command. Two commands total (one Cloud Function deploy + one
OTA), run from a real PowerShell window — not Windsurf:

```powershell
firebase deploy --only functions:getOnlineDeliveryCount --project grocery-mvp-dev
firebase functions:list --project grocery-mvp-dev
eas update --branch production --message "Phase 12c: admin polish"
```

OTA target is **production** this time, not `preview`. The
production TestFlight / closed-track build is what family is
using; preview channel stays empty since solo dev still uses the
Metro-served dev client.

### Acceptance verification

- [x] Stats card visible on AdminOrdersScreen with all 3 stats
      populating from real data within 15s of opening.
- [x] PendingShopsScreen shows days-since-registration on each
      row; warning color when > 7 days; sorted oldest-first.
- [x] ShopRegistrationDetailScreen shows owner phone +
      account-created date + prior shops count.
- [x] UserManagementScreen has 5 role filter chips, sort
      toggle, debounced search.
- [x] `getOnlineDeliveryCount` deployed; returns numeric count;
      rejects non-admin callers.
- [x] `npm test` passes — total ≥ baseline + 35 new tests.
- [x] `npm run audit:indexes` passes (no new missing indexes).
- [x] `npx tsc --noEmit` — 11 baseline errors, 0 new.

---

## 🔍 Code review findings (May 17 2026)

Comprehensive review of the codebase by three parallel reviewers
(security, payments, concurrency) after Phase 12c shipped. The
foundation is solid; everything below is gaps to close before public
launch or shortly after. Items are grouped by the PR that should fix
them so each diff stays reviewable.

### PR 1 — Security hardening (launch blocker) — ✅ SHIPPED May 17 2026 (commit adb7399)

All four items below were closed by PR 1. Kept in the checklist for
audit history. Pre-PR-1 delivery partners were grandfathered; any
bulk audit/revoke if needed is tracked under PR-1-followup.

- [ ] **`becomeDelivery` is self-service + leaks customer PII.** Any
      signed-in user can call the callable
      (`functions/src/index.ts:998`), instantly get the `delivery`
      claim, then call `listAvailableDeliveries` to read name + phone
      + full address of every customer with a pending pickup. Code
      comment acknowledges the gap. **Fix:** require admin approval
      (mirror the shop-registration flow) or remove the callable and
      grant via CLI script only.
- [ ] **`/users/{uid}` write rule allows spoofing role mirrors.**
      `firestore.rules:30-32` allows arbitrary field writes on a
      user's own doc, including `isAdmin: true`, `isDelivery: true`,
      and `fcmTokens`. Not a privilege escalation (auth gates read
      `auth.token.*` claims, not mirrors) but it leaks admin push
      notifications and inflates the online-delivery counter the
      `getOnlineDeliveryCount` callable returns. **Fix:** tighten
      rule to a whitelisted field set (`name`, `email`, `addresses`,
      `defaultAddressId`, `updatedAt`) — never role flags or
      `fcmTokens`.
- [ ] **Menu reads are not status-gated.** `firestore.rules:52-62`
      allows public read on `shops/{shopId}/menu/{menuItemId}`
      regardless of parent shop status. A competitor can scrape
      pending or suspended shops' pricing via direct Firestore reads
      using the published REST API + a fresh anon Auth token.
      **Fix:** rule should require the parent shop's `status ==
      'active'`, OR move the customer-facing read path entirely
      through the `listShopMenuPublic` callable (it already filters)
      and deny direct subcollection reads.
- [ ] **Rules-vs-functions parity test only covers `getOrder`.**
      `tests/contracts/orderReadAuth.parity.test.ts` is the gold
      standard pattern but only one callable is pinned. Extend to
      cover `listShopOrders`, `listMyOrders`, `listAvailableDeliveries`,
      `listShopMenuPublic`, and `listAllUsers` / `listAllShops` so
      auth-rule drift gets caught by CI.

### PR 2 — Payment hardening (launch blocker) — ✅ SHIPPED May 17 2026

All six items below were closed by PR 2 (Phase A server hardening +
Phase B refund flow). Validated end-to-end with a real ₹1 Razorpay
test transaction: confirmPayment → paid → admin cancel → refund_pending
→ refunded. Includes one hotfix during testing:

- `CancelAndRefundModal` keyboard-handling fix — wrapped in
  `KeyboardAvoidingView`, backdrop-tap dismisses keyboard only (not
  modal). Pattern propagated to all 4 admin input modals
  (UserDetail, ShopDetailManagement, ShopRegistrationDetail,
  DeliveryRequestDetail) in the keyboard-handling sweep PR shipped
  immediately after PR 2. Canonical pattern documented in
  `src/components/order/CancelAndRefundModal.tsx` top doc-comment.

Two long-form shop-owner screens (`AddCustomMenuItemScreen`,
`ShopMenuItemEditScreen`) use `ScrollView` only without
`KeyboardAvoidingView`. Left unchanged in the sweep PR per defensive
guidance (blindly adding KAV on Android can introduce double-scroll
artifacts). **Watch family testing**: if anyone reports bottom
inputs hidden behind the keyboard on these screens, wrap each form
in `<KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>`
inside the SafeAreaView. Tracked as `[Post-launch followup]`.

- [ ] **No refund flow exists.** `updateOrderStatus` lets admin /
      shop-owner cancel a `paid` order with no Razorpay refund call
      and no audit trail — money stays with the merchant. `Grep` for
      `razorpay.payments.refund` returns zero hits across the
      codebase. **Fix:** either wire `razorpay.payments.refund()`
      into the cancellation path, or block cancellation of paid
      orders entirely and document a manual-refund SOP + admin
      alert flag for orders that need refund attention.
- [ ] **Webhook can flip `paid → failed` on out-of-order events.**
      `functions/src/index.ts:746-768` has no idempotency guard
      against status downgrade. If Razorpay delivers `payment.failed`
      after a successful capture (rare but documented), the customer's
      bank shows debit but app shows failed. **Fix:** on the failed
      branch, early-return if `order.paymentStatus === 'paid'`. Add a
      processed-events dedup log keyed on `payment.id` for full
      idempotency.
- [ ] **Amount mismatch flags the order but still marks it `paid`.**
      `functions/src/index.ts:743-753` — webhook writes
      `amountMismatch: true` and proceeds to mark paid. Shop will
      dispatch food for an underpaid order. The flag is never read
      elsewhere. **Fix:** on mismatch, do NOT mark paid; write
      `paymentStatus: 'amount_mismatch'`, push admin notification,
      surface in admin orders view with a banner.
- [ ] **No server-side payment confirmation — client trusts Razorpay
      Checkout.** `CheckoutScreen.tsx:338-346` receives
      `razorpay_signature` from Checkout's success callback and never
      sends it to the server. If the webhook is delayed or missing,
      the user sits on "Payment processing..." until
      `cleanupAbandonedOrders` cancels their paid order 24h later
      (see next item). **Fix:** add a `confirmPayment` callable that
      HMAC-verifies the signature server-side and writes
      `paymentStatus: 'paid'` synchronously. Webhook becomes the
      backup path, not the primary.
- [ ] **`cleanupAbandonedOrders` will auto-cancel paid orders if
      webhook is delayed >24h.** `functions/src/index.ts:799-803`.
      Compounds the no-refund + no-client-confirm issues above:
      customer pays at 11:55 PM, Razorpay webhook delayed during an
      incident, cron fires next day, paid order is cancelled with
      no refund. **Fix:** before cancelling, call
      `razorpay.orders.fetchPayments(razorpayOrderId)` and only
      proceed to cancel if zero captured payments exist; otherwise
      mark `paymentStatus: 'paid'` and continue normal flow.
- [ ] **`retryPayment` orphans the previous Razorpay order.** Edge
      case but enables double-charge if the original payment lands
      after retry was initiated. **Fix:** before rotating
      `razorpayOrderId`, call `razorpay.orders.fetch(oldOrderId)`
      and refuse retry if any payment was captured.

### PR 3 — Concurrency cleanup (high priority, not blocker) — ✅ SHIPPED May 17 2026

All five items below were closed by PR 3. Pure client-side: two pure
helpers (`shouldRollbackOptimistic`, `handleRoleAuthError`), one
extracted state-machine slice (`nextPollState`), error/retry banners
on two screens, and three rollback-race guards. 344/344 unit tests
green; deliberate-break demo on `optimisticRollback` flipped 3 tests
red (returns-false-when-current-differs, strict-equality, null-vs-
undefined) before revert. NOTE: auto-formatter aggressively strips
the new imports (`authService`, `handleRoleAuthError`,
`shouldRollbackOptimistic`, `useAuthStore`) on save in
`DeliveryDashboardScreen.tsx` and `useShopOrderDetail.ts` — explicit
"if tsc complains, re-add this" comments left in those files.

- [x] **`OrdersScreen` swallows fetch failure → "No orders yet"
      empty state on real users with orders.** Closed: added
      `error` state + dismissable retry banner mirroring the
      `AdminOrdersScreen` pattern; empty-state CTA suppressed while
      `error` is set. `OrdersScreen.tsx:18-191`.
- [x] **Optimistic rollback races overwrite concurrent watcher
      ticks.** Closed at all three sites with a shared pure helper
      `shouldRollbackOptimistic(currentValue, optimisticValue)` →
      strict equality check; rollback is suppressed when the
      watcher has already installed a different value. Applied at
      `useShopOrderDetail.ts:170-192` (status), `DeliveryDashboard`
      `handlePickedUp:186-216` (pickedUpAt timestamp) and
      `handleDelivered:240-269` (status). `AdminOrdersScreen` was
      already safe (replaces by id, doesn't drop concurrent
      arrivals). 5 unit tests in `tests/utils/optimisticRollback.test.ts`.
- [x] **`ShopMenuScreen` silent fetch error → owner sees empty
      menu, may re-add duplicates.** Closed: same error-banner
      pattern as `OrdersScreen` plus role-auth refresh on
      permission-denied. `ShopMenuScreen.tsx:21-468`.
- [x] **Role revocation mid-session has no UX.** Closed via pure
      helper `handleRoleAuthError(err, refreshClaims, setUser)` →
      detects `permission-denied`/`unauthenticated` (both hyphen
      and underscore variants), force-refreshes claims, pushes
      result into `useAuthStore` so the role-guard EmptyState
      renders on next pass. Applied at
      `ShopOwnerDashboardScreen.tsx:104`,
      `DeliveryDashboardScreen.tsx:103,115` (both watchers),
      `ShopMenuScreen.tsx`. 9 unit tests in
      `tests/utils/handleRoleAuthError.test.ts`.
- [x] **`useOnlineDeliveryCount` keeps stale value forever on
      permanent error.** Closed: extracted pure `nextPollState`
      slice with consecutive-failure counter, threshold = 3.
      Single transient failure preserves the last count; 3 strikes
      clear to `null`; any successful poll resets the counter. 6
      unit tests in `tests/hooks/useOnlineDeliveryCount.test.ts`
      (RNTL/react-test-renderer not in deps, so the helper is
      tested rather than the hook surface — see test file header
      for rationale). `useOnlineDeliveryCount.ts:1-129`.

### PR 4 — Customer search rewrite + cart integrity — ✅ SHIPPED May 17 2026

Two related gaps from family-style testing closed in one PR. Search
and category browse now query per-shop menus directly via a new
`searchMenuPublic` callable; `placeOrder` gained a defense-in-depth
collective same-shop guard. Pure helpers + 19 new tests; pre-
existing baseline tsc errors dropped from 4 to 3 as the SearchScreen
rewrite removes the broken `shopService.getNearbyShops()` call.
Deliberate-break demo on `validateAllItemsInSameShop` (early-return
ok:true bypassing the loop) flipped 4 tests red (single-mismatch,
all-mismatch, legacy-fallback, sentinel) before revert.

- [x] **Search and category tabs find nothing in newly-registered
      shops.** Closed: rewrote `SearchScreen.tsx:1-415` to call
      `orderService.searchMenuPublic` (debounced 250ms, location-
      aware, FlatList of menu+shop result rows). New callable in
      `functions/src/index.ts:3604-3680` does collection-group query
      on `menu` filtered by candidate active shops, then runs the
      pure `filterAndJoinSearchResults` helper for query/category/
      stock/cap. Removed the legacy `productService.getByShop` +
      `shopService.getNearbyShops()` calls — the no-arg getNearbyShops
      bug was a baseline tsc error; PR 4 drops it. 12 helper tests
      in `tests/functions/searchMenuPublic.test.ts`. Tapping a
      result navigates to ShopDetail (item-level deep-link deferred
      to V2 per spec). Category chips on HomeScreen were already
      passing `{ category }` to Search; no client change needed
      there.
- [x] **Multi-shop cart guard missing on server.** Closed: pure
      helper `validateAllItemsInSameShop` in
      `functions/src/cartIntegrityHelpers.ts:47-68` returns
      `{ok: false, offendingMenuItemId}` on the first cross-shop
      line. Wired into `placeOrder` after the per-line lookup —
      `functions/src/index.ts:272-288` throws
      `failed-precondition` with a customer-actionable message.
      Both resolved-item paths (Path 1 menu, Path 2 legacy product)
      now attach `shopId` explicitly so the helper has a concrete
      field to validate. 6 helper tests in
      `tests/functions/cartIntegrityHelpers.test.ts`.
- [x] **Firestore rules + indexes for collection-group menu reads.**
      Closed: `firestore.rules:111-132` adds
      `match /{path=**}/menu/{menuItemId}` mirroring the per-shop
      active-shop predicate (defense in depth — native goes through
      the callable, but admin-console + future web SDK
      collection-group reads need the rule). `firestore.indexes.json:69-76`
      adds the `(shopId ASC, available ASC)` collection-group
      composite. `npm run audit:indexes` passes (8 composites
      tracked).
- [x] **Parity test extended.** `tests/contracts/orderReadAuth.parity.test.ts`
      header documents `searchMenuPublic` alongside
      `listShopMenuPublic` in the no-auth-callable section.

NOTE: auto-formatter stripped the new helper imports
(`validateAllItemsInSameShop`, `filterAndJoinSearchResults`,
`pickCandidateShopIds`, `CandidateShop`, `RawMenuItem`) on save in
`functions/src/index.ts` THREE times during PR 4. Explicit
"DO NOT REMOVE" comment block left above the imports. Auto-formatter
also stripped the BODY of the helper's `for` loop on a save during
the deliberate-break revert; restored with a "if tsc complains
about unused 'item', restore the if-branch" comment inline.

### PR 5 — Shop owner settings + checkout polish — ✅ SHIPPED May 17 2026

Three small items from family-style testing closed together. Shop
owners can now self-serve `deliveryFee` and `minOrder`, Razorpay
Checkout no longer prompts for email, and the platform operator
(admin role) can bypass the `minOrder` gate when testing the
customer flow. All three are pure-JS OTA after one new callable
deploy.

- [x] **`updateShopSettings` callable + helper.** Closed: new
      callable `functions/src/index.ts:3389-3450` is a thin wrapper
      over the pure helper in
      `functions/src/shopSettingsHelpers.ts:1-141`. Whitelisted
      partial updates of `deliveryFee` (0..500, integer) and
      `minOrder` (0..10000, integer); shopId pulled from caller's
      claims (not the request body) so a malicious client cannot
      target another owner's shop. 22 tests in
      `tests/functions/shopSettingsHelpers.test.ts` covering
      auth/role/shopId/range/type rules.
- [x] **`ShopSettingsScreen` + dashboard tile + route.** Closed:
      `src/screens/shop/ShopSettingsScreen.tsx:1-285` mirrors
      `ShopMenuItemEdit`'s dirty-field pattern, wrapped in
      `KeyboardAvoidingView` per the canonical `CancelAndRefundModal`
      pattern (two sequential numeric inputs would otherwise hit the
      keyboard-cover bug on shorter Android devices). Registered
      in `AppNavigator.tsx:81-82,178`. New "⚙️ Shop Settings" tile
      above "📋 Manage Menu" in
      `ShopOwnerDashboardScreen.tsx:197-208`. Defensive `Loader` +
      `EmptyState` for the (rare) case where `getShopForOwner()`
      returns null.
- [x] **Razorpay email prefill.** Closed: `src/utils/checkoutEmail.ts:1-33`
      exports `deriveCheckoutEmail(profile, phone)` — uses
      `profile.email` if it contains '@', else generates a
      phone-derived sentinel on `noemail.kiranamart.app` (domain
      doesn't accept mail; placeholder satisfies Razorpay's input
      validation without faking a real address). Wired into
      `src/screens/CheckoutScreen.tsx:344-348`. 8 tests in
      `tests/utils/checkoutEmail.test.ts` covering profile/email/
      phone edge cases (whitespace, `+91` prefix, null email,
      missing @).
- [x] **Admin bypass for `minOrder`.** Closed: pure helper
      `functions/src/placeOrderGateHelpers.ts:1-40` —
      `checkMinOrderGate({ auth, subtotal, minOrder })` returns
      `{ok: true}` if `token.admin === true` (strict equality —
      platform policy; truthy claims have bitten us) OR subtotal
      meets the gate. Wired into `placeOrder`
      `functions/src/index.ts:306-328`. Every OTHER validation
      (availability, stock, price drift, multi-shop cart guard from
      PR 4) still runs for admin callers. 7 tests in
      `tests/functions/placeOrderGateHelpers.test.ts`.

NOTE: auto-formatter stripped helper imports during PR 5 (same as
PRs 1, 2, 4):
- `validateShopSettings` and `checkMinOrderGate` stripped from
  `functions/src/index.ts` (each once).
- `deriveCheckoutEmail` stripped from `src/screens/CheckoutScreen.tsx`.
"DO NOT REMOVE" comment blocks left above each. Also, a single
`edit` call on `AppNavigator.tsx` was applied to the wrong
location producing garbled JSX (line 178); fixed by re-running the
edit with full surrounding context.

### PR 6 — Image upload for menu items — ✅ SHIPPED May 17 2026

Real shops can finally onboard without hosting their menu photos
somewhere else. Camera + gallery picker → resize to 1024px square
JPEG → upload to Firebase Storage under `menu/{shopId}/...` → URL
flows into the existing `imageUrl` field. Server tightened to reject
non-Storage URLs.

- [x] **Storage rules.** `storage.rules` gains a
      `menu/{shopId}/{filename}` rule: public read (anonymous
      customers browse), shopOwner write gated on matching `shopId`
      claim + 5MB cap + image/* contentType regex. Existing
      `/products/` and `/shops/` rules untouched.
- [x] **`validateMenuImageUrl` server helper + 14 tests.** Pure
      helper in `functions/src/imageUrlHelpers.ts:1-87`. Three
      accepted shapes: undefined/null/empty → ok with null; URL on
      `firebasestorage.googleapis.com` or `*.firebasestorage.app`
      (both — this project uses the newer subdomain); everything
      else (picsum.photos, http, malformed) rejected. Wired into
      `addCustomMenuItem` and `updateMenuItem` in
      `functions/src/index.ts`. Tests at
      `tests/functions/imageUrlHelpers.test.ts:1-115` cover the
      canonical exploit (external host), spoofed-substring
      hostname attack, http downgrade, non-string types, malformed.
- [x] **Client picker + uploader.** `src/utils/imageUpload.ts:1-115`
      exports `pickAndResizeImage(source)` wrapping
      `expo-image-picker` + `expo-image-manipulator`. Returns a
      tagged union (`cancelled` is a normal user action — silent
      no-op; `permission-denied` / `unknown` surface an alert).
      `src/services/storage.ts:1-58` exports `uploadMenuImage`
      using the firebase web SDK on both platforms (existing
      `storage` handle from `firebase.ts` works cross-platform per
      the file-level comment there; avoids pulling
      `@react-native-firebase/storage` for a single feature).
- [x] **UI replaced in both shop screens.**
      `AddCustomMenuItemScreen.tsx` and `ShopMenuItemEditScreen.tsx`
      (custom-only branch) now render a preview + "📷 Take photo" /
      "🖼️ Gallery" buttons + remove. The old "Image URL (optional)"
      text input is gone. GLOBAL items in the edit screen are
      unchanged — they inherit their image from the catalog.
- [x] **iOS perms.** Already present in `app.json` from earlier
      Razorpay setup (`NSCameraUsageDescription`,
      `NSPhotoLibraryUsageDescription`,
      `NSPhotoLibraryAddUsageDescription`). Copy mentions "payment
      provider"; revisit if App Store review nitpicks.
- [x] **Deps installed.** `expo-image-picker@^55.0.20` and
      `expo-image-manipulator@^55.0.16` added via `npm install
      --save` (the `npx expo install` route failed with a fetch
      error mid-session). VERSIONS ARE NEWER THAN SDK 54's pinned
      versions — run `npx expo install --check` on the user's
      machine to confirm runtime compatibility; downgrade to SDK
      54's pinned versions (~17.0.x / ~14.0.x) if expo-doctor flags
      them.

Verification:
- `npm test`: 44 suites, 420 tests (was 406 → +14 new in
  `tests/functions/imageUrlHelpers.test.ts`).
- `npx tsc --noEmit` (functions): clean.
- `npx tsc --noEmit` (root): 3 baseline errors only (firebase.ts
  + 2 in useOrderStore.ts — all pre-existing, unrelated).
- `npm run audit:indexes`: 22 chains / 8 composite / 0 missing
  (unchanged, no new queries).
- Deliberate break: commented out the host-check branch in
  `validateMenuImageUrl`. Three tests went red, including the
  canonical `rejects external host (picsum.photos) — canonical
  exploit`. Reverted; all green.

NOTE: auto-formatter stripped helper imports during PR 6 (same
class of bug as PRs 1, 2, 4, 5):
- `validateMenuImageUrl` stripped from `functions/src/index.ts` twice.
- `useAuthStore`, `pickAndResizeImage`, `uploadMenuImage` stripped
  from `AddCustomMenuItemScreen.tsx` and `ShopMenuItemEditScreen.tsx`
  on the same save. "DO NOT REMOVE" comment blocks left above each.

OTA risk callout: this PR adds TWO new Expo native modules. Both are
config-plugin-managed and SHOULD work via OTA on existing TestFlight
builds — but the only way to be sure is to OTA and try the picker on
a real device. If the picker fails to launch (typical symptom: app
crashes or shows a "Module not found" red-box), a fresh `eas build`
is required before family testing can continue.

### PR 8.1 — Cleanup bundle — ✅ SHIPPED May 18 2026

Three small items bundled because each was too small for its own
PR. All three close out tracked deferred work from PRs 6.1, 7,
and 8.

#### Part 1 — `'customer'` in `AuditActorRole`

- [x] **Server union widened.**
      `@/functions/src/auditLogHelpers.ts:32-41`. Order:
      `admin | shopOwner | customer | system`. Comment block
      explains 'system' is now strictly cron/cleanup.
- [x] **`cancelMyRecentPaidOrder` flipped.**
      `@/functions/src/index.ts:1180-1194`. `actorRole: 'system'`
      → `actorRole: 'customer'`. `metadata.initiatedBy` dropped
      (was redundant with `actorUid`). The 6-line "Audit
      schema's actorRole union doesn't have customer yet"
      workaround comment is gone — replaced with a 3-line
      PR 8.1 reference.
- [x] **Client union synced.**
      `@/src/screens/admin/AuditLogScreen.tsx:35-49`. Comment
      pins the duplicate-union posture (intentional; client
      doesn't import from `functions/`).
- [x] **Test pinning.**
      `@/tests/functions/auditLogHelpers.test.ts:135-155`. New
      test `actorRole=customer supported (in-window paid-order
      self-cancel)`. +1 to total (475 → 476).

#### Part 2 — Baseline `tsc --noEmit` errors

Enumeration found **10 errors total**, not 3 as Windsurf had
been reporting. Triage:

- **7 errors in `claude_files/`** (legacy reference docs +
  example screens). Spread-with-color overwrites in old
  `HomeScreen` / `ShopDetailScreen` / `ShopListScreen` mocks.
  Not part of the live app. Fixed by adding `claude_files` to
  `tsconfig.json` exclude alongside `node_modules`,
  `functions`, `babel.config.js`, `metro.config.js`, `_old`.
  `@/tsconfig.json:14-22`.
- **1 error in `src/services/firebase.ts:37`**: `@ts-ignore`
  was historically placed above the wrong line — it sat above
  `import { getFunctions }` instead of above
  `import { getReactNativePersistence }` two lines below. The
  ignore was inert. Moved to the right place with an
  expanded comment that references upstream issue
  https://github.com/firebase/firebase-js-sdk/issues/7615.
  `@/src/services/firebase.ts:35-42`.
- **2 errors in `src/store/useOrderStore.ts`**: stale shim
  pointing at an obsolete `placeOrder` signature. Grep showed
  zero live imports of `useOrderStore` (only a string mention
  in a comment in `signOutAndClearLocalState.ts`). Deleted the
  whole file via `git rm`. The pass-through pattern was
  already obsolete — order placement goes through
  `orderService.placeOrder` directly from the Checkout screen.

Verification: `npx tsc --noEmit` from project root → **0 errors**.
Functions tsc also clean.

#### Part 3 — Formally defer App Check

- [x] **New section in PRELAUNCH_CHECKLIST.**
      `@/PRELAUNCH_CHECKLIST.md:19-61`. Title: "App Check
      enforcement (intentionally deferred)". Includes status
      (~30 callables, all `false`), why deferred, 4-item
      pre-condition list, and a note on what was removed.
- [x] **Existing Security item rewritten** to point at the new
      section instead of duplicating the rationale.
      `@/PRELAUNCH_CHECKLIST.md:9-12`.
- [x] **Inline `enforceAppCheck` notes removed** from
      `functions/src/index.ts`:
  - 4-line block above `getMenuImageUploadUrl` (PR 6.1 era):
    deleted entirely.
  - 3-line block above `updateOrderStatus`: replaced with a
    3-line PRELAUNCH-pointer comment (kept short because the
    original also documented CLI-dashboard access, which is
    callable-specific).
  - All other callables had no inline comment — they just used
    `{ cors: true, enforceAppCheck: false }` directly.

Verification:
- `npx tsc --noEmit` (root): **0 errors** (was 3 baseline → 0).
- `npx tsc --noEmit` (functions): clean.
- `npm test`: **48 suites, 476 tests** (was 475 → +1 customer
  role pin).
- `npm run audit:indexes`: **28 chains / 8 composite / 0 missing**
  (no schema changes).
- Deliberate-break: flipped the new
  `actorRole=customer` assertion to expect `'admin'`. Test went
  red (`Expected: "admin"  Received: "customer"`). Reverted;
  476 green again.

Auto-formatter foot-gun (PR 8.1 status):
- Zero new `DO NOT REMOVE` comments needed in this PR. The
  recently-added `.windsurf/code-discipline.md` + flipped
  `codeActionsOnSave: false` setting appear to have actually
  fixed the import-stripping issue. Smoke-test passed: this
  PR added imports to 3 files, none were stripped on save.

Deviations from the prompt: none.

Deploy plan (NOT executed):

```powershell
$env:NODE_OPTIONS = "--use-system-ca"

# 1. Functions — cancelMyRecentPaidOrder audit-write change.
#    Signature unchanged; clients keep working pre-OTA.
cd functions; npm run build; cd ..
firebase deploy --only functions --project grocery-mvp-dev

# 2. OTA — client union widening in AuditLogScreen.
eas update --branch preview --message "PR 8.1 cleanup bundle"

# 3. After preview smoke test:
eas update --branch production --message "PR 8.1 cleanup bundle"
```

Smoke tests on preview phone:
1. As customer, cancel a paid order within 2-min window. Then
   as admin, open Audit Log → confirm entry shows
   `actorRole: customer` (not `system`).
2. As admin, perform any other action (e.g. `suspendShop`).
   Confirm its entry's `actorRole` stays `admin` (regression
   check).
3. As shop owner, do a bulk menu update. Confirm its entry's
   `actorRole` is `shopOwner`.

### PR 8 — Admin audit log + Bulk menu actions — ✅ SHIPPED May 18 2026

Two operational-maturity items bundled. **Part A**: every admin
action now writes a queryable `/auditLog/{id}` entry; admin
viewer screen polls it. **Part B**: shop owners can multi-select
menu items and bulk-toggle availability with one tap.

Note: the original PR 8 draft included **stock auto-decrement**;
dropped after a domain review surfaced that kirana shops sell
both online + offline and offline sales aren't tracked, so
auto-decrement would drift the in-app stock higher than reality.
Current `stock: null` (unlimited) default + manual unavailable
toggle is the right posture for kirana. Documented in the
prompt's "Why this PR exists".

#### Part A — Admin audit log

- [x] **`auditLogHelpers.ts` + 9 tests.** Pure helper in
      `@/functions/src/auditLogHelpers.ts:1-100`. `buildAuditLogEntry`
      is deterministic via injected `now` + `randSuffix`. Optional
      fields are OMITTED (not undefined-keyed) so Firestore docs
      stay clean. Id format `{timestamp}_{rand12}` is sortable
      lexicographically by timestamp — Firestore-console scrolling
      is a rough chronological view without an explicit `orderBy`.
      Tests cover the omit-optionals contract, the lexicographic
      sort property, all three actorRoles, deterministic timestamps,
      and id-collision-resistance under default rand.
- [x] **`writeAuditLog` wrapper in `index.ts:1273-1280`.** Catches
      and swallows errors — `console.warn` only. The audit-log
      write failing must NOT break the underlying user-visible
      action; worst case is a gap in audit history. Acceptable
      for MVP; revisit if compliance requires hard guarantees.
- [x] **Audit-log writes wired into all 13 callables on success
      paths**:
  - `approveShop` → `shop.approve`
  - `rejectShop` → `shop.reject`
  - `suspendShop` → `shop.suspend`
  - `unsuspendShop` → `shop.unsuspend`
  - `approveDeliveryRole` → `delivery_request.approve`
  - `rejectDeliveryRole` → `delivery_request.reject`
  - `revokeShopOwner` → `user.revoke_shop_owner`
  - `revokeDelivery` → `user.revoke_delivery`
  - `cancelPaidOrder` → `order.cancel_paid` (admin OR shopOwner
    actorRole based on `v.role`)
  - `cancelMyRecentPaidOrder` → `order.cancel_by_customer_window`
    (actorRole='system' — schema doesn't yet have 'customer';
    metadata.initiatedBy carries the canonical customer uid)
  - `updateOrderStatus` → `order.manual_status_update` (admin OR
    shopOwner actorRole)
  - `updateShopSettings` → `shop.update_settings` (both branches;
    metadata captures before/after for diffing)
  - `cleanupAbandonedOrders` → `order.cancel_abandoned` (system
    actor; per-cancelled-order entry inside the loop)
  - `bulkUpdateMenuAvailability` → `shop.bulk_menu_availability`
    (Part B; actorRole='shopOwner')
- [x] **`listRecentAuditEntries` callable.**
      `@/functions/src/index.ts:1296-1329`. Admin-only; cursor
      pagination via `before` (ms timestamp). Default limit 50,
      max 100. Returns `{ entries, hasMore }`. Inline comment
      flags the future privacy concern: today nothing in
      metadata is sensitive, but if KYC docs / phone numbers
      ever land in the audit log a redacted-summary projection
      should be added here.
- [x] **`auditLog` Firestore rule.** `@/firestore.rules:194-205`.
      `read: if isAdmin(); write: if false`. Server-only writes
      via Admin SDK.
- [x] **`AuditLogScreen` + nav + HomeScreen tile.**
      `@/src/screens/admin/AuditLogScreen.tsx:1-380` — polls
      every 60s while focused, pull-to-refresh for immediate
      refetch, "Load more" button using cursor pagination, tap
      row to expand metadata JSON. `ACTION_LABELS` is the
      stable canonical-label map; new action types should be
      added there.
      `@/src/navigation/AppNavigator.tsx`: imported, route
      `AuditLog` registered. `@/src/screens/HomeScreen.tsx`:
      "📜 Audit log" tile in admin section.

#### Part B — Bulk menu actions

- [x] **`bulkMenuHelpers.ts` + 14 tests.** Pure helper in
      `@/functions/src/bulkMenuHelpers.ts:1-130`.
      `validateBulkMenuRequest` gates on auth (uid non-empty),
      strict `shopOwner === true`, non-empty string shopId,
      array of non-empty string ids, ≤ 100 ids
      (`BULK_MENU_MAX_IDS`), boolean `available`. Strict-
      equality posture pinned by the canonical
      truthy-but-not-true test (deliberate-break demo target).
      `tests/functions/bulkMenuHelpers.test.ts` covers all
      rejection branches + boundary (exactly 100 ids accepted)
      + happy path with multiple ids.
- [x] **`bulkUpdateMenuAvailability` callable.**
      `@/functions/src/index.ts:1345-1423`. After helper
      validation, reads candidate docs in 30-id chunks
      (Firestore `in` query cap), filters by
      `data.shopId === claims.shopId` (defense-in-depth: even
      if the owner knows another shop's ids, they can't
      toggle them). Single batch.commit for matched ids
      (≤ 500 cap, fits comfortably). Returns
      `{ updatedCount, skippedCount }`. Audit log entry written
      at the end with metadata
      `{ requestedCount, updatedCount, skippedCount, available }`.
- [x] **`orderService.bulkUpdateMenuAvailability` +
      `listRecentAuditEntries` client methods.**
      `@/src/services/orderService.ts:772-816`. Standard
      dual-dispatch (RNFB on native / Web SDK on web).
- [x] **`ShopMenuScreen` multi-select UI.**
      `@/src/screens/shop/ShopMenuScreen.tsx`. New state:
      `selectMode`, `selectedIds: Set<string>`, `bulkSubmitting`.
      Header swaps title to "N selected" with a "Done" right
      action. Per-row Switch is hidden in select mode; instead
      a leading-edge checkbox appears and the card pressable
      toggles selection. Bottom sticky action bar shows
      "Mark X unavailable" / "Mark X available" buttons,
      disabled when 0 selected. Confirm dialog → callable →
      optimistic local update + `fetchOnce()` refresh.
      Skip-count surfaced via Alert when non-zero.

Verification:
- `npm test`: **48 suites, 475 tests** (was 452 → **+23 new**:
  9 audit + 14 bulk).
- `npx tsc --noEmit` (functions): clean.
- `npx tsc --noEmit` (root): 3 baseline errors only —
  `firebase.ts` + 2 in `useOrderStore.ts` — all pre-existing.
- `npm run audit:indexes`: **28 chains / 8 composite / 0 missing**
  (was 24 → +4 new query chains: auditLog `orderBy timestamp`,
  bulk menu `where __name__ in`, etc.).
- Deliberate-break demo: weakened
  `validateBulkMenuRequest`'s shopOwner check from `!== true` to
  `!`. The canonical strict-equality test
  `validateBulkMenuRequest — auth gate › rejects truthy-but-not-
  true shopOwner claim (string "true")` went red. Reverted; all
  475 green.

Per-callable audit-wiring notes:
- **`updateShopSettings`**: `validateShopSettings` doesn't expose
  `actorUid` / `role` on its `ok: true` shape, so I derive role
  from `request.auth?.token?.admin === true` directly. Future
  refactor: have the helper surface role explicitly so the
  callable doesn't duplicate the claim check.
- **`cancelMyRecentPaidOrder`**: actorRole tagged 'system' since
  schema's union is `admin | shopOwner | system` and 'customer'
  isn't a member yet. metadata.initiatedBy carries the customer
  uid for forensics. Future PR can widen the union.
- **`cleanupAbandonedOrders`**: writes ONE audit entry per
  cancelled order (inside the for-loop), not one per cron run.
  This makes "show me everything cancelled by cron last week"
  trivial. actorUid is the literal string `'cleanupAbandonedOrders'`
  so dashboards can filter cron actions.
- **`suspendShop` / `unsuspendShop`**: my first edit to
  `unsuspendShop` accidentally left an `if (false) {}` artifact
  (anchor-matching trick to handle a closing brace mismatch);
  cleaned up in a follow-up edit. All audit blocks are now
  correctly nested.

Auto-formatter foot-gun (continued from PRs 1, 2, 4, 5, 6, 6.1, 7):
- `auditLogHelpers` + `bulkMenuHelpers` imports stripped from
  `functions/src/index.ts` once during PR 8 dev. Re-added with
  DO-NOT-REMOVE comment block.
- `AuditLogScreen` import + `AuditLog: undefined` route type
  entry stripped from `AppNavigator.tsx` once each. Both re-added
  with DO-NOT-REMOVE comments.
- `right={...}` prop on the multi-select header in
  `ShopMenuScreen.tsx` was reverted to a non-existent
  `rightActionLabel` once during the same save. Re-applied.
- A handful of orphan PR-tagged comment blocks remain in
  `index.ts` near the helper-imports section from prior PRs;
  same harmless-but-ugly pattern as PRs 6.1/7.

Deviations from the prompt:
- **`enforceAppCheck: false`** on both new callables — matches
  the project-wide posture (no other callable enforces App
  Check today). Tracked in the existing "Enable App Check on
  every callable" PRELAUNCH item; flip them all together.
- **`updateShopSettings` audit field for actor**: had to derive
  `actorUid`/role from request.auth instead of validated.actorUid
  because the helper doesn't expose those today (see per-callable
  note above).

Deploy plan (NOT executed — hand back):

```powershell
$env:NODE_OPTIONS = "--use-system-ca"

# 1. Rules — new auditLog collection.
firebase deploy --only firestore:rules --project grocery-mvp-dev

# 2. Functions — many touched (~13 callables get audit writes
#    + 2 new callables). No callables removed, so no
#    interactive delete prompt.
cd functions; npm run build; cd ..
firebase deploy --only functions --project grocery-mvp-dev
firebase functions:list --project grocery-mvp-dev

# 3. OTA — JS-only client changes, applies to existing
#    TestFlight build.
eas update --branch production --message "PR 8: admin audit log + bulk menu actions"
```

Smoke tests on production phone:
1. **Audit log writes**: as admin, suspend a shop → open Audit
   Log → confirm entry appears with action `shop.suspend`,
   target = shop name, reason text.
2. **Audit log paging**: scroll to bottom → tap "Load more" →
   older entries appear, no duplicates.
3. **Audit log non-admin read denied**: from Firestore Console
   as non-admin → try to read `/auditLog` → rules deny.
4. **Bulk availability toggle**: ShopMenu → tap "Select" →
   check 3 items → tap "Mark 3 unavailable" → confirm → all 3
   flip to unavailable, select mode exits.
5. **Bulk on another shop's items**: dev script calling
   `bulkUpdateMenuAvailability` with another shop's ids →
   expect `skippedCount = N, updatedCount = 0`.
6. **Bulk action audit entry**: after the bulk toggle → open
   Audit Log → entry for `shop.bulk_menu_availability` with
   metadata count + target shop id.
7. **Sub-second audit ordering**: do two admin actions back-to-
   back; confirm both appear and are ordered correctly (id
   prefix sorts by timestamp).

### PR 6.1 — Signed upload URL hotfix for menu images — ✅ SHIPPED May 18 2026

**Problem**: PR 6's menu image picker shipped, but uploads failed on
TestFlight with `Firebase Storage: User does not have permission to
access 'menu/{shopId}/{filename}.jpg'. (storage/unauthorized)`. Root
cause was a cross-SDK auth-state mismatch baked into the PR 6 design:
the Firebase Web SDK's storage uploader and `@react-native-firebase/auth`
keep separate auth sessions. On native the user is signed in via RNFB
phone OTP, but the Web SDK that's actually doing the upload sees
`request.auth == null`, so the `/menu/` Storage rule's
`shopOwner == true && shopId == shopId` check could never pass.

**Fix**: sidestep Storage rules entirely. Server mints a v4 signed PUT
URL (admin SDK signing bypasses rules — documented GCS pattern); client
PUTs bytes to it. No new native module, ships as OTA, no rebuild.

- [x] **`validateGetUploadUrlInput` helper + 12 tests.** Pure helper
      in `functions/src/menuImageUploadHelpers.ts:1-95`. Gates on
      auth (uid non-empty), `shopOwner === true` strict equality,
      and a non-empty string shopId claim. Generates a deterministic
      `menu/{shopId}/{ms}_{rand6}.jpg` path (now + rand both
      injected for test determinism). Strict-equality posture
      mirrors the PR 7 customer-cancel helper.
      `tests/functions/menuImageUploadHelpers.test.ts:1-189` covers
      all rejection branches (null/undefined auth, empty uid,
      missing/forged shopOwner claim, missing/non-string/empty
      shopId) plus the happy path with deterministic
      filename + collision-resistance check via different rand fns.
- [x] **`getMenuImageUploadUrl` callable.** Added in
      `functions/src/index.ts:1193-1247`. Uses the helper for
      validation, then `admin SDK getStorage().bucket().file(path)
      .getSignedUrl({ version: 'v4', action: 'write', contentType:
      'image/jpeg', expires: now + 15min })`. Returns
      `{ uploadUrl, downloadUrl, storagePath, expiresAt }`. The
      download URL is the standard Firebase Storage public-read
      pattern; reads on `/menu/` stay `read: if true`.
- [x] **Storage rule for `/menu/` → write-deny.**
      `storage.rules:27-45`. Reads stay public; writes are now
      `if false` because the signed URL bypasses rules entirely.
      Inline comment documents why the old PR 6 claim check is
      gone (cross-SDK auth mismatch).
- [x] **`uploadMenuImage` rewritten.** `src/services/storage.ts`
      now calls `orderService.getMenuImageUploadUrl()`, then PUTs
      the resized JPEG blob to the signed URL with header
      `Content-Type: image/jpeg` (must match exactly — v4
      signatures bind contentType). Function signature unchanged
      from PR 6, so `AddCustomMenuItemScreen.tsx` and
      `ShopMenuItemEditScreen.tsx` need zero edits. Old Web SDK
      `uploadBytes` / `ref` / `getDownloadURL` / `storage` imports
      removed.
- [x] **`orderService.getMenuImageUploadUrl` client method.**
      Standard dual-dispatch in `src/services/orderService.ts:744-770`.
      Native goes through RNFB so the phone-authed user's
      `shopOwner` + `shopId` claims reach the Cloud Function.
- [x] **`firebase.ts` header comment updated.**
      `src/services/firebase.ts:13-23`: removed the
      "storage uses Web SDK on native" claim; replaced with a
      PR 6.1 note explaining that menu image writes now route
      through the callable and the Web SDK storage handle exists
      only for any potential read-only path.

Verification:
- `npm test`: 46 suites, **452 tests** (was 440 → **+12 new** in
  `menuImageUploadHelpers.test.ts`).
- `npx tsc --noEmit` (functions): clean.
- `npx tsc --noEmit` (root): 3 baseline errors only — unchanged.
- `npm run audit:indexes`: 24 chains / 8 composite / 0 missing.
- Deliberate-break demo: replaced the auth gate with a no-op. The
  3 auth-gate tests (`rejects unauthenticated callers (null auth)`,
  `rejects undefined auth`, `rejects auth with empty uid`) all went
  red. Reverted; all green.

Deviation from prompt:
- **`enforceAppCheck: false`** on the callable, not `true` as the
  prompt suggested. Reasoning: no other callable in this project
  enforces App Check (`enforceAppCheck: false` everywhere), and
  flipping it to true for one callable would either (a) break the
  endpoint silently in TestFlight if the App Check native module
  isn't wired, or (b) make this endpoint inconsistent with the rest
  of the API. The "Enable App Check on every callable" item is
  already tracked in Security section; flip them all together as
  one coordinated PR. The auth claim is the real gate today.

Auto-formatter foot-gun (continued from PRs 1, 2, 4, 5, 6, 7):
- `getStorage` import from `firebase-admin/storage` stripped from
  `functions/src/index.ts` once on save; re-added with
  DO-NOT-REMOVE comment.
- `validateGetUploadUrlInput` import similarly stripped once;
  re-added with DO-NOT-REMOVE comment.
- Two orphan PR 6.1 comment blocks remain in `index.ts` near the
  helper-imports section (first wave of re-adds left their original
  comment behind when the import was eaten). Harmless but ugly;
  same pattern as the PR 7 orphan.

Deploy plan (NOT executed — hand back):
1. `cd functions && npm run build` — confirm clean build.
2. `firebase deploy --only storage --project grocery-mvp-dev` —
   push the write-deny rule.
3. `firebase deploy --only functions:getMenuImageUploadUrl --project
   grocery-mvp-dev` — push the new callable.
4. `cd .. && npm test` — final pre-OTA confirmation.
5. `eas update --branch production --message "PR 6.1: signed upload
   URL for menu images"` — push the client.
6. Smoke-test on TestFlight (see prompt Part 5 for the 5 manual
   tests). Negative test: sign in as admin (no shopOwner claim),
   try the callable via the Firebase console → expect
   `permission-denied`.

### PR 7 — Customer cancel window + ShopOwnerDashboard UX mirror — ✅ SHIPPED May 17 2026

Two unrelated-but-coherent items bundled. **Part 1**: customers can
self-serve cancel a paid online order within 2 minutes of payment;
auto-refund via the existing Razorpay flow. After 2 min they must
escalate to admin. **Part 2**: pull-to-refresh + delivery substate
timeline on `ShopOwnerDashboardScreen`, mirroring the
AdminOrdersScreen hotfix from PR 5.

- [x] **`canCustomerCancelPaidOrder` helper + 20 tests.** Pure
      helper in `functions/src/customerCancelWindowHelpers.ts:1-174`
      gates on auth, ownership, paymentMethod=online,
      paymentStatus=paid, status=pending, paidAt finite + non-future,
      and `elapsed <= CUSTOMER_CANCEL_WINDOW_MS` (2 min). Strict
      equality on payment fields per the codebase's posture (truthy
      checks have bitten us in PRs 5/6). Constant pinned by its own
      test so an accidental tightening to e.g. 30s gets caught.
      `tests/functions/customerCancelWindowHelpers.test.ts:1-225`
      covers all rejection branches + the inclusive boundary
      (exactly 2:00 is in-window).
- [x] **`cancelMyRecentPaidOrder` callable.** New callable in
      `functions/src/index.ts:999-1154` runs the same Razorpay
      refund flow as `cancelPaidOrder`. Records `initiatedRole:
      'customer'` on the refund doc so admin tooling can
      distinguish customer-initiated vs admin-initiated refunds.
      Failure path flips paymentStatus → `refund_failed` and
      pushes to admins for manual reconciliation (same posture as
      cancelPaidOrder).
- [x] **`orderService.cancelMyRecentPaidOrder` client method.**
      Standard dual-dispatch in
      `src/services/orderService.ts:712-732`. Returns `{ ok,
      refundId? }` shape matching cancelPaidOrder for symmetry.
- [x] **OrderDetailScreen UI: countdown + cancel button.**
      `src/screens/OrderDetailScreen.tsx`: new `nowMs` ticker
      (1s interval, top-level useEffect for stable hook ordering),
      `cancelEligibleNow` / `inWindow` / `remainingMs` derivations,
      a "Changed your mind?" card with mm:ss countdown
      ("Cancel order (1:23 left)"), and an "expired" replacement
      card after the window closes. New pure formatter `formatMmSs`
      kept inline (single use site). Optimistic local update on
      success; the watcher overwrites within 5s.
- [x] **ShopOwnerDashboard UX mirror.**
      `src/screens/shop/ShopOwnerDashboardScreen.tsx`: imported
      `RefreshControl`; added `refreshing` state + pull handler
      that bumps `retryNonce` (same pattern as AdminOrdersScreen
      hotfix); cleared `refreshing` in the watcher callback. Added
      delivery substate timeline (⏳ Awaiting / 🛵 Claimed / 📦
      Picked up · TIME / ✅ Delivered · TIME) with styles copied
      verbatim from AdminOrdersScreen. The "Mark Delivered"
      filter requirement was already satisfied: shop-owner action
      buttons live on `ShopOrderDetailScreen` and the existing
      `SHOP_OWNER_ALLOWED_ACTIONS` constant
      (`@/src/screens/shop/ShopOrderDetailScreen.tsx:52-56`)
      already excludes `'delivered'`.

Verification:
- `npm test`: 45 suites, 440 tests (was 420 → +20 new in
  `customerCancelWindowHelpers.test.ts`).
- `npx tsc --noEmit` (functions): clean.
- `npx tsc --noEmit` (root): 3 baseline errors only — `firebase.ts`
  + 2 in `useOrderStore.ts` — all pre-existing, unrelated.
- `npm run audit:indexes`: 24 chains / 8 composite / 0 missing.
- Deliberate-break demo: replaced the window-expiry branch in
  `canCustomerCancelPaidOrder` with `return { ok: true }`. The test
  `canCustomerCancelPaidOrder — paidAt + window math › rejects
  orders past the 2-minute window (canonical guard)` went red.
  Reverted; all green.

NOTE: auto-formatter foot-gun continued (PRs 1, 2, 4, 5, 6, 7):
- `canCustomerCancelPaidOrder` stripped from
  `functions/src/index.ts` once on save.
- `nowMs` / `setNowMs` state line stripped from
  `OrderDetailScreen.tsx` once on save.
- DO-NOT-REMOVE comment blocks left above each. Also: an orphan
  comment block remains in `functions/src/index.ts` near the helper
  imports (the formatter ate the import twice and we re-added it
  with a fresh comment); harmless but ugly.

- [ ] **DEFERRED — Extract `executeRefund` shared helper.** PR 7
      prompt called for extracting the Razorpay-call + post-refund
      Firestore writes from `cancelPaidOrder` into a shared helper
      that both `cancelPaidOrder` and `cancelMyRecentPaidOrder`
      would consume. Skipped for risk: the admin flow has push
      notifications + admin alerts on failure that the customer
      flow doesn't need, and the divergent ergonomics make a
      shared abstraction leakier than the duplication. Revisit
      post-launch if a third refund initiator (e.g. shop-owner
      self-cancel of a paid order) appears. Documented inline in
      `functions/src/index.ts:980-998`.

### Tag-along items (ride with whichever PR fits)

- [ ] **Enable App Check on every callable.** Currently
      `enforceAppCheck: false` everywhere — enables curl/Postman
      abuse. Already tracked in Security section above; this is a
      duplicate flag for cross-reference.
- [ ] **Handle `payment.authorized` webhook events.** Currently
      ignored. Required if Razorpay auto-capture toggles off (which
      can happen during incidents).

### What's solid (do not change)

For the record so future reviewers don't second-guess these:
admin self-revoke ban enforced server-side; no `grantAdmin`
callable exists; `mergeCustomClaims` preserves existing claims;
shopOwner `shopId` scoping never trusts client-passed values;
`canReadOrder` helper + parity test is exemplary; razorpay webhook
uses `crypto.timingSafeEqual` (textbook); `claimDelivery` is
transactional / atomic first-wins; server always charges from
`menu.price`, never client `priceSnapshot`; watcher contract is
followed across every screen (the post-loader-spin fix paying off);
cart invariants + persistence are properly tested.

---

## 🔒 PR 1 — Security hardening (May 17 2026)

First of the three "code review findings" PRs from May 17. Closes the
three launch-blocker security gaps + the test-coverage gap in the
"PR 1 — Security hardening" sub-checklist above. Pure server + rules
+ tests + admin UI: no customer/owner/delivery happy-path UX changes,
so family testing is unaffected by the deploy.

### What shipped

- [x] **Self-service `becomeDelivery` deleted.** The callable that
      let any signed-in user grant themselves the `delivery` claim
      (and then read every pending pickup's customer PII via
      `listAvailableDeliveries`) is gone from
      `functions/src/index.ts`. The client method
      `orderService.becomeDelivery` is gone too. Existing users who
      had the claim from before the deploy KEEP it — the new
      restriction only gates future requests. Bulk audit/revoke of
      pre-PR-1 delivery partners is tracked as a follow-up. [PR 1]
- [x] **Admin-approval flow for delivery partners.** Mirrors the
      shop registration + approval flow exactly. Five new asia-
      south1 callables in `functions/src/index.ts`:
        - `requestDeliveryRole({ name?, vehicleType?, city? })` —
          writes `deliveryRequests/{uid}` with status pending.
          Rejects if caller already has the delivery claim or a
          pending request.
        - `approveDeliveryRole({ uid })` — admin only. Sets the
          `delivery` custom claim, mirrors `isDelivery: true` to
          `users/{uid}`, updates the request doc, pushes a
          notification to the applicant.
        - `rejectDeliveryRole({ uid, reason })` — admin only.
          Writes `rejectedReason` and notifies. Doesn't delete the
          doc (audit trail).
        - `listPendingDeliveryRequests()` — admin only. FIFO by
          `submittedAt`. Pinned by new composite index in
          `firestore.indexes.json` (status asc + submittedAt asc).
        - `getMyDeliveryRequest()` — any signed-in caller. Returns
          the caller's own request doc or null.
      Validation + auth logic lives in
      `functions/src/deliveryRequestHelpers.ts` so it's unit-
      testable without firebase-functions / emulator boot. [PR 1]
- [x] **Firestore rules tightened (3 changes).**
        - `/users/{uid}` — split `read/write` into separate
          `read` + `create` + `update` rules. Create requires
          `request.resource.data.keys().hasOnly([...])`; update
          uses `diff.affectedKeys().hasOnly([...])`. Whitelist:
          `uid, phone, phoneNumber, email, name, addresses,
          defaultAddressId, updatedAt, createdAt, fcmTokens`.
          **Excluded** (and therefore deny-by-default for clients):
          `isAdmin`, `isShopOwner`, `shopId`, `isDelivery`,
          `deliveryStatus`. Those are written by Cloud Functions
          via the Admin SDK only. Closes the role-mirror spoof
          that inflated the `getOnlineDeliveryCount` counter and
          leaked admin pushes.
        - `/shops/{shopId}/menu/{menuItemId}` — read now gated on
          parent `shops/{shopId}.data.status == 'active'` (admins
          bypass). Closes the public-menu scrape of pending /
          suspended shop pricing.
        - `/deliveryRequests/{uid}` — new collection. Read =
          owner or admin. Create = owner. Update / delete = no one
          (Cloud Functions only via Admin SDK). [PR 1]
- [x] **Client wiring.** `src/services/orderService.ts` gains the
      five new methods (`requestDeliveryRole`, `getMyDeliveryRequest`,
      `listPendingDeliveryRequests`, `approveDeliveryRole`,
      `rejectDeliveryRole`) with the same Plan-B native + web
      dispatch posture as the rest of the file. `src/types/index.ts`
      gains `DeliveryRequest` + `DeliveryRequestStatus`. [PR 1]
- [x] **Screens.** Four files:
        - `src/screens/roles/BecomeDeliveryPartnerScreen.tsx` —
          rewritten from one-tap opt-in into a form (name +
          vehicle-type chips + city, all optional). On submit it
          replaces to the new waiting screen. If the caller
          already has a pending OR rejected request, the screen
          short-circuits to the waiting screen so they can't
          double-submit.
        - `src/screens/roles/DeliveryApprovalWaitingScreen.tsx` —
          new. Polls `getMyDeliveryRequest` every 30s. On approval
          refreshes the ID token (so the new `delivery` claim is
          visible) and resets the nav stack to Home →
          DeliveryDashboard. On rejection shows the admin's reason
          + "Edit & resubmit" button that routes back to the form.
        - `src/screens/admin/PendingDeliveryRequestsScreen.tsx` —
          new. Admin queue mirror of `PendingShopsScreen` — days-
          since chip with > 7d warning treatment, defensive client-
          sort by `submittedAt` asc, tap row to open detail.
        - `src/screens/admin/DeliveryRequestDetailScreen.tsx` —
          new. Mirror of `ShopRegistrationDetailScreen` — same
          approve / reject modal + reason flow, idempotency guard
          on the action buttons.
      Routes registered in `src/navigation/AppNavigator.tsx`.
      `HomeScreen` admin tile section gains "🛵  Delivery
      requests" between Pending Shop Approvals and User
      Management. [PR 1]
- [x] **Tests added: 39** across 2 files.
        - `tests/functions/deliveryRequestHelpers.test.ts` — 23
          tests pinning every code path: validation (auth,
          existing claim, existing pending, sanitization,
          truncation, vehicle whitelist), `requireAdminCaller`
          (admin / unauthenticated / non-admin / non-strict-true
          claim), `canApproveDeliveryRequest` (admin-only, state
          machine: pending → approved, idempotency guard,
          not-found), `canRejectDeliveryRequest` (reason required,
          truncated at 280 chars, terminal-state guard).
        - `tests/contracts/orderReadAuth.parity.test.ts` — 16
          new matrix entries (4 callers × 4 callables) added to
          the existing parity test file, alongside a doc-block
          cross-reference to the auth checks of the EXISTING
          callables (`listShopOrders`, `listMyOrders`,
          `listAvailableDeliveries`, `listShopMenuPublic`,
          `listAllUsers`, `listAllShops`, `getMyDeliveryRequest`)
          that PR 1 intentionally did NOT refactor. [PR 1]
      Deliberate-break demo: temporarily removed the
      "already has delivery claim" guard in
      `validateRequestDeliveryRole`. **2 tests** failed by name —
      `rejects caller who already has the delivery claim` (helper
      suite) and `requestDeliveryRole > caller=delivery
      allow/deny` (parity matrix). Reverted; full suite back to
      green. [PR 1]

### Acceptance verification (run output)

- [x] `npx tsc --noEmit` — **0 new errors** (4 baseline:
      `SearchScreen.tsx`, `firebase.ts`, `useOrderStore.ts` ×2,
      same as before PR 1; the 7 `claude_files/` errors are
      orthogonal to the app).
- [x] Functions build (`npm run build` in `functions/`) — clean.
- [x] `npm run audit:indexes` — `19 query chains, 8 composite,
      0 missing` (the new `deliveryRequests where status==pending
      orderBy submittedAt` is covered by the new composite index).
- [x] `npm test` — **277 / 277 passing**, **30 test suites**.
      Prior total was 238; PR 1 adds +39 tests (23 helper + 16
      parity matrix).
- [x] `firestore.rules` compiles clean (validated by `firebase
      deploy --only firestore:rules --dry-run` — see deploy plan
      below).

### Deploy plan (hand to user — not executed by Cascade)

Per `.windsurf/deploy-discipline.md` — one `--only` target per
command, no pipes, run from a real PowerShell window:

```powershell
$env:NODE_OPTIONS = "--use-system-ca"

# Rules + index first so the new collection's queries don't
# trip the missing-index runtime error.
firebase deploy --only firestore:rules --project grocery-mvp-dev
firebase deploy --only firestore:indexes --project grocery-mvp-dev

# Five new callables + one deletion (becomeDelivery).
firebase deploy --only functions:requestDeliveryRole,functions:approveDeliveryRole,functions:rejectDeliveryRole,functions:listPendingDeliveryRequests,functions:getMyDeliveryRequest --project grocery-mvp-dev

# Confirm the new callables are live, then explicitly delete
# becomeDelivery. Do this AS A SEPARATE DEPLOY so any in-flight
# old-client calls fail loudly during a known maintenance window
# rather than silently.
firebase functions:list --project grocery-mvp-dev
firebase functions:delete becomeDelivery --region asia-south1 --project grocery-mvp-dev

# OTA the client — preview channel first; promote to production
# after smoke-testing the family device pair.
eas update --branch preview --message "PR 1: security hardening — delivery approval flow"
```

### Deferred (tracked for follow-up PRs)

- [ ] **Rules tests for the new rules** — emulator-based
      `tests/rules/users.test.ts` extension for the new whitelist
      enforcement, `tests/rules/shopMenu.test.ts` for the new
      parent-status gate, and new `tests/rules/deliveryRequests.test.ts`.
      Pure-helper coverage is in place; emulator-based coverage
      adds defense in depth. `[PR 1-followup]`
- [ ] **Extract auth helpers for `listMyOrders`,
      `listAvailableDeliveries`, `listShopMenuPublic`,
      `listAllUsers`, `listAllShops`** — the parity matrix
      currently documents their inline auth checks in a doc
      block. Extracting them lets the matrix EXECUTE the auth
      check the same way it does for the PR-1 callables. Each is
      a 5-10 line refactor; deferred to keep PR 1's diff
      focused. `[PR 1-followup]`
- [ ] **`getDeliveryRequest({ uid })` callable** — currently
      `DeliveryRequestDetailScreen` fetches the full pending list
      and finds by uid, mirroring `ShopRegistrationDetailScreen`.
      Fine at 50-request cap; switch to a per-uid getter when the
      queue regularly exceeds the cap. `[PR 1-followup]`
- [ ] **Bulk audit + revoke of pre-PR-1 delivery partners** —
      decide whether legacy self-service-granted delivery claims
      should be revoked (forcing re-application through the new
      flow). Affects only people who tapped "I want to be a
      delivery partner" in v12a-v12b. `[PR 1-followup]`
- [ ] **Vehicle / ID document verification** — MVP collects
      `vehicleType` (whitelist of 5) only. License + vehicle reg
      photo upload + admin review of those docs are deferred to
      a later PR. `[Post-launch]`
- [ ] **Admin push when a delivery request lands** — currently
      best-effort via `pushToAdmins`. Email/SMS fallback for
      admins not running the app is deferred. `[Post-launch]`

---

**Maintenance rule:** any time we add a temporary dev hack, env-only flag,
disabled enforcement, or "TODO before launch" in code — add it here
immediately. The checklist is the only thing that survives memory.
## 📈 Post-launch scaling triggers (revisit each milestone)

- [ ] At 100 DAU: review Firebase costs weekly for first month
- [ ] At 1k DAU: audit Firestore reads. If >100 reads per user session,
      add client caching (5-min TTL on shops/products). Set Cloud Function
      minInstances=1 on placeOrder (~$10/mo, kills cold starts).
- [ ] At 10k DAU: do a 6-week cost projection. If Firestore monthly
      projected > ₹40k, escalate to read optimization sprint.
- [ ] At 10k DAU: add Algolia or Typesense for product search relevance
      (current substring match doesn't scale).
- [ ] At 50k DAU: enable BigQuery export from Firestore for analytics
      dashboards. Don't try to do reports from Firestore directly.
- [ ] At 100k DAU: re-evaluate Firestore vs Postgres for the orders
      collection. Migration possible because services/*.ts is the swap point.

      - [ ] Consider full migration of Firestore reads to 
      @react-native-firebase/firestore on native for consistency. Not 
      blocking — current dual-SDK setup works for reads. Migrate if you 
      hit similar auth-state issues with Firestore queries.

- [ ] When prod project is created, find ITS project number 
      (gcloud projects describe grocery-mvp-prod --format="value(projectNumber)") 
      and use it in the same IAM grant command for prod.      