# Pre-Launch Checklist — grocery-mvp

Single source of truth for everything that must happen before real customers
touch this app. Items grouped by category. Each item annotated with the
Phase that introduced the requirement.

## 🔒 Security & Authentication

- [ ] **Re-enable `enforceAppCheck: true`** on all Cloud Functions in
      `functions/src/index.ts` (currently `false` on `placeOrder` and
      `updateOrderStatus` for iOS dev testing). Blocked on Phase 5d:
      requires `@react-native-firebase/app-check` so native clients can
      mint App Check tokens (DeviceCheck / Play Integrity); flipping to
      `true` without that breaks every native call. [Phase 5a, 5d]
- [ ] **Native App Check** wired via `@react-native-firebase/app-check`
      on iOS (DeviceCheck) + Android (Play Integrity). Required before
      flipping enforceAppCheck back on for native users. [Phase 5a-mobile]
- [ ] **Remove App Check debug token** from Firebase Console
      (App Check → Apps → Manage debug tokens). Currently active for dev. [Phase 5a]
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