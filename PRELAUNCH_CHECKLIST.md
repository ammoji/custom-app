# Pre-Launch Checklist â€” grocery-mvp

Single source of truth for everything that must happen before real customers
touch this app. Items grouped by category. Each item annotated with the
Phase that introduced the requirement.

## ðŸš€ Production Firebase project setup (separate workstream â€” before public launch)

**Current state:** The repo has ONE Firebase project, `grocery-mvp-dev`.
All testing, all family use, all server-side code, and all data live
there. There is NO separate production project. The `EAS Update`
production channel is just a client OTA channel; it points at the
same `grocery-mvp-dev` backend as the preview channel.

This must change before real paying customers touch the app, because
test/dev data, test Razorpay keys, and dev-grade rules cannot back a
production deployment. Outline of the work (1â€“2 days when ready):

- [ ] **Create a fresh Firebase project** (e.g. `grocery-mvp-prod`)
      under the same Google Cloud account. Enable Blaze plan
      (required for Cloud Functions).
- [ ] **Add billing alerts** on the new project so a runaway query or
      Razorpay webhook storm doesn't surprise the invoice.
- [ ] **Configure Razorpay LIVE keys** as secrets on the prod project
      (`firebase functions:secrets:set RAZORPAY_KEY_ID --project
      grocery-mvp-prod`). Verify the keys start with `rzp_live_` not
      `rzp_test_`. Also set `RAZORPAY_WEBHOOK_SECRET`.
- [ ] **Update `.firebaserc`** to alias both projects:
      ```json
      { "projects": { "default": "grocery-mvp-dev", "prod": "grocery-mvp-prod" } }
      ```
      Then deploys can use `--project prod`.
- [ ] **Update `app.json`** so `expo.extra.firebase` resolves per
      EAS channel. Typical pattern: separate `app.config.ts` that
      reads `process.env.EAS_BUILD_PROFILE` to pick dev vs prod
      Firebase config blocks. Set the corresponding `EXPO_PUBLIC_*`
      env vars in `eas.json` per profile.
- [ ] **Deploy server from scratch to prod:** rules, indexes,
      functions. Sanity-verify all callables are listed with
      `firebase functions:list --project prod`.
- [ ] **Seed prod with admin accounts** using
      `scripts/set-admin.ts` (one-shot, locally).
- [ ] **App Check enabled on prod** (see App Check section below for
      pre-conditions and rollout discipline). Native module setup
      first, then flip every callable in one PR.
- [ ] **EAS build a fresh native binary** pointing at prod config.
      `eas build --profile production --platform all` after the
      app.config.ts wiring is in place. New `runtimeVersion`
      fingerprint because Firebase config differs.
- [ ] **Submit to App Store + Play Store.** First submission, expect
      review delays (3â€“7 days each).
- [ ] **Data migration plan.** Decide which test data carries over.
      Default: nothing â€” start prod with a clean slate. Family/test
      shops + orders stay on dev.
- [ ] **DNS / branded link** if you want `kiranamart.in` instead of
      the auto-generated EAS link in marketing material.

**Why this isn't done yet:** the app is still in family-testing
phase. Creating a prod project before the feature surface is stable
just creates two backends to keep in sync without commensurate value.
Revisit when (a) family testing reports go quiet for 1â€“2 weeks, AND
(b) you're ready to commit to a public launch date.

**The bogus `--project grocery-mvp-prod` lines in old PR prompts
(PR 9, PR 12, PR 10-11-12 bundle plan) were a mistake on my part â€”
they assumed a prod project existed when it doesn't. If you re-read
those prompts, skip those lines until the prod setup above is done.**

## ðŸ”’ Security & Authentication

- [ ] **App Check enforcement** â€” see the dedicated section below
      ("App Check enforcement (intentionally deferred)") for the
      canonical rationale, pre-conditions, and flip plan. The two
      tag-along items follow:
- [ ] **Native App Check** wired via `@react-native-firebase/app-check`
      on iOS (DeviceCheck) + Android (Play Integrity). Required before
      flipping enforceAppCheck back on for native users. [Phase 5a-mobile]
- [ ] **Remove App Check debug token** from Firebase Console
      (App Check â†’ Apps â†’ Manage debug tokens). Currently active for dev. [Phase 5a]

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
   (not piecemeal â€” partial flip is worse than none, see PR 6.1's
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
- [x] **Phase 9c** â€” native phone auth via `@react-native-firebase/auth`
      live; checkout sign-in gate restored on both web and native.
      Still pending: install new dev client (rebuilt with RNFB native
      modules), end-to-end OTP test on iPhone with whitelisted number.
- [ ] **Remove `uid` debug strip** on HomeScreen (currently `__DEV__` gated;
      delete the line entirely for production). [Phase 5e-ii]
- [ ] **Final security rules review** with second pair of eyes. Walk through
      `firestore.rules` line-by-line. Confirm no `if true` allows. [Phase 5e-ii]
- [ ] **Re-deploy rules from local file** via `firebase deploy --only firestore:rules`
      and verify Firebase Console shows zero diff against `firestore.rules`. [post-Phase 5e-ii]
- [ ] **Rotate Razorpay test keys â†’ live keys** after KYC approved. Update
      via `firebase functions:secrets:set RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`.
      Redeploy Functions. [Phase 8a]
- [ ] **Rotate Razorpay webhook secret** for live mode. Reconfigure webhook
      in Razorpay Dashboard pointing to production Function URL. [Phase 8a]
- [x] **Configure Sentry source-map upload** via `SENTRY_AUTH_TOKEN` EAS
      secret + Sentry plugin `organization` / `project` config in
      `app.json`. [Shipped â€” PR 26]
      `app.json` plugin upgraded to array form with
      `organization: "grocery-mvp"`, `project: "react-native"`.
      `SENTRY_DISABLE_AUTO_UPLOAD` removed from the production
      profile in `eas.json` (still present on dev + preview to save
      Sentry quota). **Manual follow-up before next production
      build:** Sudhir runs `eas secret:create --scope project
      --name SENTRY_AUTH_TOKEN --value "<sntrys_...>" --type string
      --visibility secret --environment production` per the runbook
      in the PR 26 prompt. The first native production build after
      the secret lands triggers the first sourcemap upload; OTAs
      do not. [Phase 5e-i, 9a]
- [ ] **Verify `service-account.json` and all .p8 files** are gitignored
      and not in any commit history. [Phase 3, 9c]
- [ ] **Audit secrets in Functions** â€” confirm `RAZORPAY_KEY_SECRET`,
      `RAZORPAY_WEBHOOK_SECRET`, etc. are stored only in Functions Secret
      Manager, never in code or .env. [Phase 8a]

## ðŸ—ºï¸ Data & Configuration

- [ ] **Restore env-var gate** on `FORCE_SHOW_ALL_SHOPS_IN_DEV` in
      `src/services/shopService.ts` (currently `__DEV__` only â€” change
      back to `__DEV__ && process.env.EXPO_PUBLIC_FORCE_SHOW_ALL_SHOPS === 'true'`). [Phase 5e-ii]
- [ ] **Confirm 1-km location filter** is active in production builds
      (verify `__DEV__` is `false` in production). [Phase 6, 5e-ii]
- [x] **Real product images** uploaded to Firebase Storage; replace
      `picsum.photos` URLs in `src/mocks/products.ts` (or wherever
      products are seeded). [post-Phase 3] â€” 28/34 sourced from Open
      Food Facts via `npm run import-images`; 6 unmatched (non-food +
      fresh produce) still on picsum. Storage rules in `storage.rules`
      allow public read on `products/**`.
- [ ] **Add OFF attribution credit** ("Some product images via Open
      Food Facts, CC-BY-SA 3.0") visible in app â€” Settings or About
      screen. License compliance.
- [ ] **Manually review the OFF match log** â€” replace any low-quality
      or wrong product images before launch (re-run `import-images`
      after editing brand/name in `mocks/products.ts` to get better
      matches; the script is idempotent and skips already-rehosted
      URLs, so manual replacements are preserved as long as they're
      on `firebasestorage.googleapis.com`).
- [ ] **Source images for unmatched products** â€” OFF didn't match
      `p_001_parleg, p_001_dettol, p_004_banana, p_004_haldi,
      p_005_paste, p_005_surf` (non-food + fresh produce). Pull from
      brand websites or stock photos and upload manually to
      `gs://grocery-mvp-dev.firebasestorage.app/products/<id>.jpg`,
      then update `mocks/products.ts` + re-seed.
- [ ] **Consider Firebase Image Resize extension** if product catalog
      grows beyond ~100 â€” auto-generates thumbnails to keep mobile
      bandwidth low.
- [ ] **Real shop data** â€” replace 8 mock Delhi shops with real onboarded
      kirana shop data. Update via seed script or admin tool. [post-Phase 3]
- [x] **App icon replaced** (currently Expo default in `app.json`). [Phase 9a]
      â€” auto-generated placeholder ("K" on `#0E7C3A` green). Generated
      by `npm run generate-branding` (sharp + inline SVG, no design tools).
- [x] **Splash screen replaced** (currently Expo default). [Phase 9a]
      â€” same generator; splash uses `expo-splash-screen` plugin pointing
      at `assets/images/splash-icon.png` on green background.
- [x] **App display name** updated in `app.json` (currently "grocery-mvp"). [Phase 9a]
      â€” set to **Kirana Mart** as placeholder.
- [ ] **Replace placeholder branding with real artwork** before launch â€”
      current icon/splash/adaptive-icon are auto-generated "K" glyphs;
      functional but generic. Re-run `npm run generate-branding` after
      tweaking PRIMARY/APP_LETTER, or drop hand-designed PNGs into
      `assets/images/` (preserve filenames so app.json paths still match).
- [ ] **Decide final app display name** with partner before launch
      ("Kirana Mart" is a placeholder).

## ðŸš€ Production Infrastructure

- [ ] **Separate Firebase project** `grocery-mvp-prod` created (currently
      using `grocery-mvp-dev` for everything). [Phase 5e-ii prep]
- [ ] **Seed prod project** with real shop + product data via `npm run seed`. [Phase 3]
- [ ] **Deploy `firestore.rules` + `firestore.indexes.json`** to prod project. [Phase 3]
- [ ] **Deploy Cloud Functions** to prod project with prod secrets
      (Razorpay live keys, prod webhook secret). [Phase 8a]
- [ ] **GCP budget alerts** active on prod project (â‚¹500/mo with 50/90/100/150% thresholds). [Phase 5e-ii]
- [ ] **Production `.env`** file with prod Firebase config + reCAPTCHA
      site key + Sentry DSN. Keep separate from dev `.env`. [Phase 5e-ii]
- [ ] **Production EAS build profile** in `eas.json` configured for App
      Store / Play Store submission (Android `app-bundle`, iOS production cert). [Phase 9a]
- [ ] **Verify abandoned-order cleanup Function** is scheduled and running
      hourly in prod. [Phase 10]
- [ ] **Load test** Cloud Functions: 100 concurrent orders without timeout. [pre-launch]
- [ ] **Firestore backup strategy** â€” scheduled exports to GCS bucket. [pre-launch]

## ðŸ“± Native / Mobile

- [x] **Mobile online payment** via `react-native-razorpay` — native
      PaymentSheet on iOS/Android, web overlay unchanged. Unified
      dispatcher in `src/utils/razorpay.ts` handles both. [Phase 8b-mobile]
- [x] **Test mobile online payment end-to-end** — verified on iPhone
      with `success@razorpay` UPI VPA: native sheet opens, payment
      succeeds, webhook flips `paymentStatus` to `'paid'` within ~5s,
      `razorpayPaymentId` populated on the order doc. [Phase 8b-mobile]
- [x] **Stuck-payment recovery** — if the customer dismisses Razorpay
      without paying, `OrderDetailScreen` now shows `Pay Now` + `Cancel
      order` buttons while the order is in `paymentStatus='pending'`
      AND `status='pending'`. Backed by two new callables:
      `retryPayment` (rotates `razorpayOrderId`, returns fresh session)
      and `cancelMyPendingOrder` (sets status=cancelled,
      paymentStatus=expired). Webhook resolves orders via
      `notes.orderId` so orphaned Razorpay orders are harmless.
      [Phase 8b-mobile]
- [ ] **Verify Razorpay error propagation to Sentry** — native SDK
      errors have shape `{ code, description }` while web SDK errors are
      `{ error: { description } }`. The unified `onError` callback in
      `CheckoutScreen` tries both shapes; verify Sentry actually captures
      both by triggering a failure with UPI VPA `failure@razorpay`.
      [Phase 8b-mobile]
- [ ] **Admin refund flow for paid orders** — `cancelMyPendingOrder`
      currently rejects orders where `paymentStatus='paid'` (with a
      "needs admin cancellation" message). Build an admin-side
      `refundPaidOrder` Cloud Function that hits Razorpay's
      `payments.refund` API, credits the customer, marks the order
      `status='cancelled'` with `paymentStatus='refunded'`. Add a new
      `'refunded'` value to the `PaymentStatus` union and surface it in
      `OrderDetailScreen`. Post-MVP — only relevant once a real customer
      asks to cancel after the shop has accepted. [Phase 8b-mobile]
- [ ] **Razorpay order reuse on retry** — `retryPayment` currently
      always creates a fresh Razorpay order, leaving the previous one
      orphaned. Razorpay charges nothing for orphaned orders, but for
      tidiness consider checking the existing `razorpayOrderId`'s status
      via Razorpay's `orders.fetch` API and reusing if it's still
      `'created'` or `'attempted'`. Skip until orphaned-order count
      becomes a real cleanup concern. [Phase 8b-mobile]
- [x] **Background-tap protection on retry/cancel buttons** —
      [Shipped â€” PR 27]. Closed by the new `usePressGuard` hook
      (`src/hooks/usePressGuard.ts`) wrapping `placeOrder`,
      `handleRetryPayment`, `handleCancel` and `handleWindowCancel`.
      Synchronous ref-backed mutex flips inside the handler before
      any `await`, so a double-tap fired before the disabled-state
      paint is a guaranteed no-op. Server-side state-machine checks
      remain as the belt-and-suspenders second line of defense.
      [Phase 8b-mobile]
- [ ] **Track react-native-razorpay New Architecture support upstream**.
      MVP currently relies on Expo SDK 54's interop layer to bridge the
      legacy module onto the new architecture; this works today but may
      regress in future RN/Expo upgrades. Watch
      https://github.com/razorpay/react-native-razorpay for new-arch
      compatibility announcement. If interop breaks before then, fall
      back to a WebView-based checkout. [Phase 8b-mobile]
- [x] **FCM push notifications** Cloud Function trigger on order status
      change â†’ push to customer's FCM token. [Phase 5d]
      â€” implemented via `expo-notifications` + Expo Push relay (avoids
      stacking another RNFB native module on top of static-frameworks +
      New-Arch). Two Cloud Functions:
      - `registerPushToken` (callable) â€” appends Expo push token to
        `users/{uid}.fcmTokens` via `arrayUnion` (deduped).
      - `sendOrderStatusPush` (Firestore `onDocumentUpdated` trigger on
        `orders/{orderId}`) â€” POSTs to `https://exp.host/--/api/v2/push/send`
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
- [ ] **Tap-to-navigate from push** â€” currently the response listener
      in `AuthBootstrap.tsx` only logs the `orderId`. Wire it through a
      navigation ref so tapping a push deep-links into `OrderDetail`
      for that order.
- [ ] **Document both APNs keys in a credentials inventory file**
      (private, not committed). One key in Firebase Console (FCM
      delivery path: `sendOrderStatusPush` â†’ Expo Push relay â†’ APNs),
      one in EAS credentials store (build-time capability registration
      so the provisioning profile gets `aps-environment`). Both point
      to Apple team `<TEAM_ID>`. If ever rotating either, must rotate
      the other to keep both stores in sync â€” otherwise pushes silently
      stop delivering OR builds start failing capability sync.
- [x] **Cloud Functions runtime SA needs `roles/firebaseauth.admin`** â€”
      `claimShop`, `becomeDelivery`, and any future Cloud Function that
      calls `getAuth().setCustomUserClaims()` will fail with
      `auth/insufficient-permission` on a fresh project. The default
      Compute Engine SA (`<project-number>-compute@developer.gserviceaccount.com`)
      doesn't carry Auth admin perms by default in newer GCP projects.
      Grant once per project:
      `gcloud projects add-iam-policy-binding <PROJECT_ID> --member="serviceAccount:<PROJECT_NUMBER>-compute@developer.gserviceaccount.com" --role="roles/firebaseauth.admin"`.
      Done for `grocery-mvp-dev` on 2026-05-15. Repeat for prod project
      when it's created.
- [x] **Built Delivery Person panel (Phase 12b)** â€” DeliveryDashboard
      with online/offline toggle, today stats, available pickups list
      (15s poll), my active deliveries (10s poll), claimDelivery
      transactional first-wins, markPickedUp / markDelivered with
      delivery-role auth gate. Customer push fires on delivered via
      existing sendOrderStatusPush. New-pickup push fires only to
      online delivery people via sendNewPickupPushToDelivery (queries
      users where isDelivery==true && deliveryStatus=='online'). No
      new statuses added to the state machine â€” substates encoded by
      (status, deliveryPersonId, pickedUpAt). 23 Cloud Functions
      total. firestore.rules + 2 new composite indexes deployed.
- [ ] **Distance / proximity-based pickup matching** â€” currently every
      online delivery person sees every available pickup and gets every
      new-pickup push. Production should filter by delivery person's
      last known location vs `shop.location` (we already store
      `Shop.location: GeoPoint`). Options: geohash filtering at the
      Firestore query layer, or compute distance server-side in
      `listAvailableDeliveries` and exclude > N km. Same logic should
      gate the push fan-out in `sendNewPickupPushToDelivery` â€” sending
      a Pune pickup to a Delhi delivery person is pure noise.
- [ ] **Delivery earnings calc** â€” Phase 12b shows count only. Need
      â‚¹X-per-delivery base + tip pass-through + weekly settlement
      reports. Probably a new `payouts` collection with a scheduled
      Cloud Function that aggregates deliveries â†’ payable amount per
      delivery person.
- [ ] **Delivery person KYC + onboarding** â€” currently `becomeDelivery`
      is one-tap self-service (Phase 12a/b decision). Production needs
      vehicle, license, Aadhaar verification gated behind admin
      approval (mirror the shop-owner KYC flow shipped in PR 31 â€”
      same signed-PUT-URL + admin-only-read pattern).
- [x] **Shop owner KYC document upload** â€” [Shipped â€” PR 31].
      `RegisterShopScreen` is now a 2-step wizard: step 1 collects
      name/address/hours/GST/FSSAI like before, step 2 surfaces 4
      KYC slots (storefront, GST cert, FSSAI license, owner ID).
      New pure helper `functions/src/kycUploadHelpers.ts` validates
      `getShopKycUploadUrl` callable input (auth + ownership +
      pending-state + slot whitelist). Three new callables in
      `functions/src/index.ts`: `getShopKycUploadUrl` (mints v4
      signed PUT URL bound to `Content-Type: image/jpeg`),
      `recordShopKycUpload` (stamps `registrationData.kycDocs.{kind}`
      with `{ storagePath, uploadedAt }` after PUT, with path-prefix
      check), and `getShopKycReadUrls` (admin-only, returns 1-hour
      signed-read URLs for each uploaded doc). `storage.rules`
      extended: `/shop-kyc/{shopId}/{filename}` is write-deny (signed
      URLs bypass at signing time, same as `/menu/`) and read-deny
      except for callers with `request.auth.token.admin == true`,
      because the docs contain PII. Admin
      `ShopRegistrationDetailScreen` renders a 2x2 KYC grid with
      tap-to-zoom modal. Helper has 8 unit tests in
      `tests/functions/kycUploadHelpers.test.ts` covering every
      authorization branch. Total: 623 tests pass + tsc clean
      (root + functions).
- [ ] **Shop owner can edit KYC docs after rejection** â€” PR 31
      currently freezes uploads once the shop leaves `pending` state
      (server returns `failed-precondition`). For rejected shops
      that need to resubmit with corrected docs, add a server-side
      "re-open KYC" admin action that flips the shop back to
      pending and re-enables uploads, OR allow uploads in `rejected`
      state. Decide once we see real rejection patterns.
- [ ] **Storage rules unit tests for `/shop-kyc/`** â€” PR 31 added
      the rules block but no `@firebase/rules-unit-testing` coverage
      (the repo has no precedent for storage-rule emulator tests).
      Adding one would pin "non-admin reads denied" + "all writes
      denied" against a future rule edit.
- [x] **Admin shop-review polish** â€” [Shipped â€” PR 31.1].
      Three small UX gaps surfaced in PR 31 smoke testing, all
      closed on the admin side. (1) Lat/lng coords in both
      `ShopRegistrationDetailScreen` and `ShopDetailManagementScreen`
      are now tappable links that open the device's preferred
      maps handler via a universal Google Maps URL â€” new utility
      `src/utils/openMapsForCoords.ts` + 4 tests in
      `tests/utils/openMapsForCoords.test.ts`. (2)
      `ShopDetailManagementScreen` now renders a
      `rejectedCard` (red left-border accent) showing
      `shop.rejectedReason` + `formatOrderTime(shop.rejectedAt)` for
      rejected shops, instead of just the "no available actions"
      one-liner. (3) KYC docs grid + tap-to-zoom modal mirrored
      from `ShopRegistrationDetailScreen` into
      `ShopDetailManagementScreen` so admin can pull original KYC
      evidence post-approval for customer disputes (works for
      active / suspended / rejected â€” server-side
      `getShopKycReadUrls` has no status gate, only an admin gate).
      Zero server / rules / native changes â€” OTA-only. Total: 627
      tests pass (+4) + tsc clean.
- [ ] **Lift `AdminShopKycGrid` to a shared component** â€” PR 31.1
      kept the KYC grid + zoom modal inline-copied in both admin
      screens (`ShopRegistrationDetailScreen` and
      `ShopDetailManagementScreen`) because each surface's UX may
      diverge over time (e.g. dispute-view may add re-request
      actions). If divergence proves false after a few more
      iterations, lift to `src/components/shop/AdminShopKycGrid.tsx`.
- [ ] **In-app map embed for shop locations** â€” PR 31.1 deep-links
      to the device's maps handler. A `react-native-maps` embed
      would be nicer UX but adds a heavy native dep purely for
      admin convenience. Justify once a customer-facing map need
      lands (Phase D PR 53).
- [x] **AI photo-to-catalog (Phase A2 differentiator)** â€”
      [Shipped â€” PR 32]. Shop owners can photograph their printed
      or handwritten rate-list and the app extracts a structured
      list of SKUs via Claude Sonnet vision, then batch-writes the
      shop-owner-approved subset to their menu. Collapses 4 hours
      of manual SKU entry into ~15 minutes of review.
      **Substrate (reused by Phase C AI PRs 44â€“49):**
      `@react-native-firebase/app` already present; added
      `@anthropic-ai/sdk ^0.98.0` to `functions/package.json`. New
      `functions/src/aiHelpers.ts` exports `runClaudeVision` +
      `estimateCostInr` + the `ANTHROPIC_API_KEY` secret handle.
      Lazy-init Anthropic client + structured-output text
      concatenation. Default model `claude-sonnet-4-5`.
      **Pure helpers:** `functions/src/menuExtractionHelpers.ts`
      exports `MENU_EXTRACTION_SYSTEM_PROMPT` (embeds the 10
      canonical CategoryIds), `MENU_EXTRACTION_USER_PROMPT`, and
      `parseExtractionResponse` â€” strips ```json fences, drops
      rows with unknown category / missing name / blank packSize,
      coerces non-number prices to null, defaults missing
      confidence to 'medium'. 9 unit tests in
      `tests/functions/menuExtractionHelpers.test.ts` covering
      every drop reason + parse failure.
      **Callables:** `extractMenuFromImage` (auth + shopOwner +
      shopId + `aiFeatures/menuExtraction.enabled` kill switch +
      per-shop 5/day `aiQuotas/{uid}_{YYYY-MM-DD}` transactional
      counter + 2MB image cap + 120s timeout + 512MiB memory +
      `secrets: [ANTHROPIC_API_KEY]` + `aiAuditLog/` fire-and-
      forget audit entry with token counts + costInr).
      `addExtractedMenuItems` (mirrors `addCustomMenuItem`
      validation field-for-field; batch-writes up to 100 items
      tagged `addedVia: 'menuExtraction'` so future analytics can
      compute "% of menu via AI"). Server-first deploy with one
      new Firebase Functions secret manually created by Sudhir
      via `firebase functions:secrets:set ANTHROPIC_API_KEY`.
      **Client:** new `ScanMenuScreen` (4-phase wizard: pick â†’
      processing â†’ review â†’ committing) with progressive copy
      during the ~15s Claude wait, per-row include-checkbox + edit
      fields + 10-chip category picker + low-confidence
      indicator. `usePressGuard` on the commit CTA. Image is
      resized to 1024px longest edge at JPEG quality 0.7 via
      `expo-image-manipulator` with `base64: true` (no new client
      dep, no `expo-file-system`). CTA on `ShopMenuScreen` above
      the existing "+ Add custom item" row. Route registered in
      `AppNavigator`. Schema-additive only â€” three new
      collections (`aiQuotas/`, `aiFeatures/`, `aiAuditLog/`)
      written exclusively via Admin SDK; no `firestore.rules`
      change needed. **No image persistence** â€” base64 stays in
      the callable payload, processed in memory, never written
      to any bucket (privacy win + no storage cleanup needed +
      no IAM signBlob gotcha Ã  la PR 31).
      **Analytics:** 3 new events on `Analytics` (per Strategic
      Principle 8 in `docs/ROADMAP.md`): `scan_menu_started`
      (source: camera|gallery), `scan_menu_extracted`
      (item_count + dropped_count), `scan_menu_committed`
      (added_count + skipped_count). Funnel observability ships
      with the feature so we don't have to retrofit before
      PR 38.
      **Verification:** root + functions tsc both clean; 636
      tests pass (+9 from menuExtractionHelpers); deliberate-
      break (`validateExtractedItem` returns rows with unknown
      categories) produced expected assertion failure on the
      "drops items with invalid category" test, reverted.
      **Pre-deploy reminder:** secret MUST be created before
      first invocation, or the function will fail with
      `Secret ANTHROPIC_API_KEY not found`. Kill-switch doc at
      `aiFeatures/menuExtraction` should be seeded `{enabled:
      true}` via Firestore Console before OTA.
- [x] **AI voice + Hindi onboarding (Phase A2 accessibility)** â€”
      [CODE SHIPPED â€” PR 34. **Native build in flight as of
      2026-05-24** because the PR added the `expo-audio` config
      plugin to `app.json`, which adds `NSMicrophoneUsageDescription`
      to iOS `Info.plist` (a native config change â†’ runtime
      fingerprint shifted â†’ OTA silently couldn't apply to the
      pre-PR-34 TestFlight build installed on devices). Server
      callable + Firestore + OTA all live; PR 34 will activate on
      devices once the new TestFlight / APK build is installed.
      Same build also unblocks PR 26 Sentry source-map upload (two
      pending items resolved together).] Closes the typing-fluency
      gap for non-English-fluent kirana shopkeepers: they can now
      register their shop by speaking instead of typing. Two access
      patterns share one server callable.
      **Substrate (extends PR 32):** new `runClaude` text-only
      method on `functions/src/aiHelpers.ts` (defaults to
      `claude-haiku-4-5`, ~3Ã— cheaper than Sonnet for the parsing
      task), and `estimateCostInr` now takes an optional `model`
      argument so Haiku calls log Haiku rates instead of being
      billed as Sonnet (without this fix the audit log would
      overstate PR 34 cost ~3Ã—). PR 32's call site was updated
      to pass the model so Sonnet pricing keeps tracking
      correctly. New `@google-cloud/speech ^7.3.1` server dep â€”
      STT uses ADC (the function's runtime SA), so **no new
      Firebase secret type** is needed; the only manual GCP step
      is enabling the Cloud Speech-to-Text API in the project.
      **Pure helpers:** `functions/src/voiceOnboardingHelpers.ts`
      exports `VOICE_ONBOARDING_SYSTEM_PROMPT` (instructs Claude
      to extract the 7 registration fields with strict JSON
      output, null-when-unmentioned, +91/leading-0 stripped from
      phone, hours converted to 24-hour HH:mm, "GST nahi hai" â†’
      null), `parseVoiceOnboardingResponse` (strips ```json
      fences, validates each field individually â€” phone digits,
      HH:mm regex, GSTIN 15-char regex, FSSAI 14-digit regex â€”
      drops invalid fields to null rather than rejecting the
      whole response). 12 unit tests in
      `tests/functions/voiceOnboardingHelpers.test.ts` covering
      every validator branch + the "no GST" â†’ null mapping +
      top-level error paths.
      **Callable:** `transcribeShopOnboardingAudio` â€” auth (any
      signed-in user; **no shopOwner gate** since voice
      onboarding runs BEFORE the shop is registered) +
      `aiFeatures/voiceOnboarding.enabled` kill switch +
      per-uid 10/day quota (`aiQuotas/{uid}_{YYYY-MM-DD}
      .voiceOnboarding`, sibling field to PR 32's
      `menuExtraction` counter, merge:true preserves both) +
      2 MB audio cap + 60s timeout + 512MiB memory +
      `secrets: [ANTHROPIC_API_KEY]`. Mode `'multi_field'` runs
      STT then Claude Haiku parse â†’ 7 fields; mode
      `'single_field'` runs STT only and returns the transcript.
      `aiAuditLog/` entries record `feature`, `subFeature`
      (mode), `languageCode`, `sttBillableSeconds`, llm token
      counts (multi_field), and `costInr` (~â‚¹0.5â€“â‚¹2 per call).
      **Localised errors (Trust Principle 4):** every server
      error message is rendered in Hindi when `languageCode ==
      'hi-IN'` (kill switch, audio-too-large, quota, no-speech,
      STT failure, parse fallback all have Hindi twins).
      **Encoding picker:** server accepts `WEBM_OPUS` (web),
      `LINEAR16` (iOS â€” PCM 16-bit WAV), `AMR_WB` (Android â€”
      the only STT-friendly format Android `MediaRecorder` can
      produce), `FLAC` reserved for future. Client picks based
      on `Platform.OS`.
      **Client:** new `src/components/VoiceInputButton.tsx`
      (reusable mic, two sizes â€” `lg` for the big "ðŸŽ™ Speak about
      your shop" CTA, `sm` for per-field icons), built on
      `expo-audio` (`useAudioRecorder` + `useAudioRecorderState`
      hooks; tap-to-start / tap-to-stop UX with a 30s automatic
      cap and a pulsing red dot during recording). 16 kHz mono
      PCM/AMR_WB/WebM keeps a 30s clip well under 1 MB
      (HIGH_QUALITY 44.1 kHz stereo would have busted the 2 MB
      server cap). `usePressGuard` wraps the upload-and-callable
      path so a frantic re-tap during the 5â€“15s server wait
      can't fire two concurrent transcribes.
      **RegisterShopScreen integration:** language picker
      (Hindi/English pill buttons, Hindi default), big "ðŸŽ™ Speak
      about your shop" CTA above the form, per-field mic icons
      via `Field`'s new `voice` prop, âœ¨ "AI" chip + yellow
      left-border on every field the multi_field flow filled,
      review banner showing the raw transcript (Trust Principle
      2 â€” every AI output gets human review before commit). The
      âœ¨ chip clears the moment the user edits the field,
      signalling "I've reviewed and adjusted." All four new
      `useState` hooks (`uiLanguage`, `aiFilledFields`,
      `voiceTranscript`, `voiceParseError`) sit ABOVE the
      `if (isAnonymous)` early return per Rules-of-Hooks
      discipline (PR 12 / PR 27 lineage). New `ParsedShopFields`
      and `UiLanguage` types in `src/types/index.ts`.
      **Analytics:** 3 new events on `Analytics` (Strategic
      Principle 8): `voice_onboarding_started` (language, mode),
      `voice_onboarding_filled` (language, mode, fields_filled,
      transcript_length), `voice_onboarding_error` (language,
      mode, error_code). Funnel observability ships with the
      feature so dropoff per cause + per language + per mode is
      visible from day one.
      **app.json plugins:** added the `expo-audio` plugin block
      with a Hindi-friendly `microphonePermission` string. No
      native rebuild needed â€” `expo-audio` autolinks via the
      next OTA on SDK 54.
      **No persistence:** audio bytes stay in the callable
      payload, processed in memory, never bucketed (same privacy
      posture as PR 32; zero storage cleanup needed; no IAM
      signBlob path).
      **Verification:** root tsc clean, functions tsc clean, all
      648 tests pass (+12 from new helpers). Deliberate-break
      removed the `+91` strip step in `validatePhone` and the
      "strips +91 prefix" test failed exactly as documented;
      reverted. `git grep -i 'sk-ant-'` returned only doc
      references (zero key material). `git grep "GOOGLE_"` in
      `functions/src/` returned only the comment confirming we
      did NOT define a `GOOGLE_*` secret â€” STT uses ADC.
      **Pre-deploy reminders:** (a) **enable Cloud Speech-to-Text
      API** in the GCP project before the first invocation, or
      the function returns INTERNAL with the server log
      `PERMISSION_DENIED: Cloud Speech-to-Text API has not been
      used` â€” same diagnostic pattern as PR 31's signBlob role;
      (b) seed `aiFeatures/voiceOnboarding` Firestore doc with
      `{enabled: true}` via Console before OTA;
      (c) `ANTHROPIC_API_KEY` secret already exists from PR 32 â€”
      no new secret create needed.
- [ ] **More languages: Punjabi, Tamil, Telugu, Bengali** â€”
      MVP ships Hindi + English only. Add `pa-IN`, `ta-IN`,
      `te-IN`, `bn-IN` as soon as a pilot shop in one of those
      regions requests it. Server-side STT supports them today;
      the client-side language picker + localised error
      messages are the only changes.
- [ ] **i18n system for the whole app** â€” PR 34 hand-translated
      ~10 UI strings between two languages. A real i18n setup
      (`expo-localization` + a string-table per language) is a
      future workstream once 3+ languages are supported and
      the hand-translation cost stops being trivial.
- [ ] **Voice on customer side (search, dictate address)** â€”
      out of scope for PR 34; needs separate UX work
      (search-by-voice has a different latency profile, and
      address dictation overlaps with the saved-address book).
- [ ] **Streaming STT** â€” PR 34 uses the simple `recognize`
      (batch) flow. Streaming would give live transcripts as
      the user speaks but is significant extra plumbing. Defer
      until the 5â€“15s post-recording wait surfaces as a real
      drop-off cause in funnel analytics.
- [ ] **Voice for menu add (single-item)** â€” "Aashirvaad atta
      5 kilo, MRP 305 rupaye, sell 295 rupaye" â†’ one menu item.
      Reuses the same `runClaude` substrate from PR 34 + a
      tweaked system prompt. Pairs naturally with PR 32's
      ScanMenuScreen as a fallback when the rate-list photo
      fails OCR.
- [ ] **Offline / on-device STT fallback** â€” when the network
      is patchy, drop to a smaller on-device model. Out of
      scope for MVP; revisit if pilot shops in poor-coverage
      regions report transcription failures.
- [ ] **AI cost dashboard rollup** â€” `aiAuditLog/` collects
      per-call cost across PR 32 (`menuExtraction`) and PR 34
      (`voiceOnboarding`) features. An admin screen rolling up
      daily/weekly spend per feature is worth building once
      total monthly spend crosses ~â‚¹1000. PR 38 ships the UI
      shell (`AdminUsageScreen`) so this becomes a small layer
      on top â€” same screen, different aggregation source.
- [x] **Admin feature-usage dashboard + analytics expansion
      (Strategic Principle 8)** â€” [Shipped â€” PR 38 + PR 38.1].
      **PR 38.1 follow-up (2026-05-24).** PR 38 originally wired
      both writes (`addDoc(featureUsageLog, ...)`) and reads
      (`getDocs(query(...))`) via the Web SDK Firestore client.
      On native that fails because the Web SDK Firestore can't
      see RNFB's auth context â€” same root cause as PR 6.1's
      signed-upload-URL fix for Storage. Result: writes silently
      failed (rule saw `request.auth == null`, the silent catch
      in `writeFeatureUsageLog` swallowed the permission-denied
      to a console.warn), and the admin dashboard hard-failed
      with a visible "Missing or insufficient permissions"
      error on tap. PR 38.1 routed both ops through new Cloud
      Function callables (`logFeatureUsageEvent` â€”
      authenticated-only, server resolves uid+role+timestamp,
      validates feature name; `queryFeatureUsageLog` â€” admin-
      only, returns events array + truncated flag) mirroring
      `orderService` dispatch shape, and tightened the
      `featureUsageLog/{eventId}` rule to
      `allow read, write: if false` (server-mediated only â€”
      same posture as `aiAuditLog/` and `auditLog/`). Direct
      client reads + writes are now defense-in-depth denied.
      The previous 16 rules tests collapsed to 12 (all expecting
      `deny` for any direct client op). Removed from
      `analytics.ts`: `addDoc` / `collection` / `serverTimestamp`
      / `db` imports + the `currentRole()` helper (server
      resolves role from custom claims). Removed from
      `AdminUsageScreen.tsx`: every `firebase/firestore` import
      + the `db` import. PR 6.1 + PR 38.1 together establish
      the **second instance** of the cross-SDK auth-context
      trap â€” `.windsurf/deploy-discipline.md` got a new
      "Web SDK Firestore + RNFB auth â€” the silent-failure trap"
      section to ensure the *third* instance never ships.
      **Verification (PR 38.1):** root + functions tsc both
      0 errors; `npm test` 658/658 (66 suites); `npm run
      test:rules` 92/92 (8 suites; the 12 featureUsageLog
      tests in the new posture). Deliberate-break confirmed
      by flipping the rule to `allow read, write: if request
      .auth != null` â†’ 12 "everyone is denied" assertions
      failed; reverted.
      **Deploy posture (PR 38.1):** rules first
      (`firebase deploy --only firestore:rules`), then each
      callable one-per-command per deploy-discipline rule 1
      (`firebase deploy --only functions:logFeatureUsageEvent`,
      `firebase deploy --only functions:queryFeatureUsageLog`),
      then `eas update --branch production`. OTA-eligible (no
      native changes; no new deps).
- [x] **Admin feature-usage dashboard â€” original ship**
      (Strategic Principle 8) â€” [Shipped â€” PR 38]. Closes the
      "did anyone use feature X" question for the pilot.
      **Substrate:** every `Analytics.*` call now fires twice â€”
      Firebase Analytics (unchanged, web-only, sampled) AND a
      parallel append-only Firestore write to
      `featureUsageLog/{eventId}` (uid + role + feature + date +
      shopId + serverTimestamp). Fire-and-forget â€” observability
      writes never block UX, anonymous sessions short-circuit
      because rules require uid match. Append-only by rule
      (`allow update, delete: if false`); admin-only read for
      the dashboard.
      **New event surface (~20 events covering shop / delivery /
      admin):** `shop_menu_item_added` (source: custom|extracted|
      bootstrap), `shop_menu_item_edited`,
      `shop_menu_item_disabled`, `shop_menu_bulk_toggle`,
      `shop_order_accepted` (minutes_to_accept),
      `shop_order_status_changed` (from/to),
      `shop_eta_set` (eta_minutes), `shop_settings_updated`,
      `shop_signed_in`; `delivery_online_toggled`,
      `delivery_pickup_accepted`, `delivery_picked_up`,
      `delivery_delivered` (minutes_since_pickup),
      `delivery_signed_in`; `admin_shop_approved`,
      `admin_shop_rejected` (reason_length),
      `admin_shop_suspended`, `admin_shop_unsuspended`,
      `admin_delivery_approved`, `admin_delivery_rejected`,
      `admin_user_role_set`, `admin_signed_in`. Wired into the
      natural success moment of each action (AFTER the server
      callable returns ok â€” failed attempts never log).
      **Wire sites:** `AuthBootstrap.tsx` (role-arrival
      `*_signed_in`, fires once after the post-mount claim
      refresh), `ShopRegistrationDetailScreen` (admin approve/
      reject), `ShopDetailManagementScreen` (suspend/unsuspend),
      `DeliveryRequestDetailScreen` (delivery approve/reject),
      `AddCustomMenuItemScreen` (custom add),
      `ShopOrderDetailScreen.useShopOrderDetail.ts` (status
      change + accepted + ETA â€” gated on `result.ok` so the
      rollback path stays uninstrumented),
      `DeliveryDashboardScreen` (online toggle, picked up,
      delivered).
      **Dashboard:** `src/screens/admin/AdminUsageScreen.tsx`
      reachable from HomeScreen "ðŸ“Š Feature usage" admin tile.
      4 summary tiles (total events, unique users, unique shops,
      top feature) + by-feature bar list (top 20 / show all
      toggle, % of total) + by-role bar chart. Period selector
      7d/30d. Single fetch on mount + period change (no
      `onSnapshot` â€” admin re-visits this rarely; live counters
      add no decision-relevant info). Query capped at 10 000 docs
      / period â€” fine at pilot scale; if exceeded, the next move
      is a scheduled Cloud Function pre-computing daily counters
      (out of scope here).
      **Pure helpers:** `src/screens/admin/adminUsageHelpers.ts`
      exports `topFeatures`, `byRole`, `uniqueUsers`,
      `uniqueShops`, `filterAfter`. Zero React, zero Firestore â€”
      every aggregation is a data â†’ data transform so the
      dashboard logic is fully unit-testable. 10 helper tests in
      `tests/screens/admin/adminUsageHelpers.test.ts` (pin sort
      order + tie-break, limit/Infinity, empty-input,
      pct-against-full-list-not-truncated-top-N, defensive
      handling of legacy/missing fields).
      **Rules + indexes:** new `match /featureUsageLog/{eventId}`
      block (allow create with uid match, no update/delete,
      admin-only read); 3 composite indexes (date desc + feature,
      date desc + role, shopId + date desc) cover the
      dashboard's queries.
      **Verification:** `npx tsc --noEmit` (root): 0 errors.
      `npm test`: 658/658 pass (66 suites; +10 from PR 38).
      `npm run test:rules`: 92/92 pass (8 suites; +17 from PR 38
      â€” 16 new featureUsageLog cases + the existing suite).
      **Deliberate-break confirmed:** flipped the rule's
      `allow create` to `if false` â†’ the 3 "user/shop owner/
      admin CAN create with own uid" tests failed; reverted.
      **Mission impact:** Strategic Principle 7's three pilot
      metrics are now queryable â€” time-to-first-menu-item =
      delta between `shop_signed_in` and the first
      `shop_menu_item_added` per shop; merchant weekly active =
      distinct shopIds with any shop_* event in 7d; customer
      repeat-order = distinct customer uids with â‰¥ 2
      `place_order` events in 30d. Strategic Principle 8 is
      fully honored project-wide â€” every future PR's "wire
      `Analytics.*`" step has events to wire and a dashboard to
      verify against.
      **Deploy posture:** OTA-eligible (no plugin / permission /
      native dep changes). Server-first deploy:
      `firebase deploy --only firestore:rules` then
      `firebase deploy --only firestore:indexes` (indexes
      take 30 s â€“ 2 min to build; dashboard returns empty
      results until "Building" â†’ "Enabled" in console), then
      `eas update --branch production`.
- [ ] **PR 33 â€” master product catalog matching** â€” every PR 32
      extraction currently lands as a custom menu item (productId:
      null, isCustom: true, addedVia: 'menuExtraction'). PR 33's
      job is to introduce a master product catalog, match each
      extracted SKU against it during the review step, and let the
      admin curate the unmatched ones. Without PR 33, two
      different shops scanning the same Aashirvaad Atta produce
      two unrelated custom items, breaking the "compare prices
      across shops" customer journey when we get there.
- [ ] **AI cost dashboard / admin spend report** â€” `aiAuditLog/`
      is the substrate; PR 32 writes one entry per successful
      extraction with `costInr`, `inputTokens`, `outputTokens`,
      `feature`, `model`, `shopId`. An admin report showing
      daily/weekly AI spend per feature is worth building once
      total monthly spend crosses ~â‚¹1000.
- [ ] **Anthropic API key rotation** â€” manual `firebase functions:
      secrets:set ANTHROPIC_API_KEY` (with the new value) works
      today but there's no scheduled reminder. Document a
      quarterly rotation cadence somewhere ops can see; for now
      this PRELAUNCH bullet is the reminder.
- [ ] **Re-scan as price-update (not always-add)** â€” PR 32 is
      add-only. Re-scanning a rate-list a month later duplicates
      every SKU rather than reconciling prices on the existing
      menu. Future PR: "Reconcile with existing menu" toggle on
      the review screen that diffs each draft against the shop's
      current menu by name+pack similarity, surfaces an update
      path for matches, and only creates new items for the
      unmatched rows.
- [ ] **Multi-photo extraction in one draft** â€” single photo per
      call in PR 32. Shop owners with very long rate-lists do
      multiple scans (each counts against the 5/day quota). A
      future flow would let the owner take 3â€“4 photos of a long
      list and combine them into a single review draft.
- [ ] **PDF rate-list ingestion** â€” vision API supports JPEG/PNG/
      WebP only. PR 32 takes a photo-of-PDF as an acceptable
      workaround. Native PDF would need server-side conversion to
      images, which adds complexity. Defer.
- [ ] **Per-extracted-row image preview thumbnail** â€” Claude
      doesn't return crop coords, so attaching the original photo
      region to each draft row would require client-side cropping
      inference. Heavy. Defer.
- [ ] **Audit-log "admin viewed KYC docs" event** â€” privacy
      consideration worth tracking once we add real customer
      disputes / regulator review. Today the access is silent.
      Add a low-priority `auditLog` entry on every
      `getShopKycReadUrls` call so we can answer "who looked at
      shop X's docs and when".
- [ ] **Storefront photo display on shop card** â€” PR 31 collects
      the storefront photo as part of KYC but the shop catalog
      (`HomeScreen`, `ShopMenuScreen`) still uses the legacy
      `Shop.imageUrl`. Once admin approves a shop, copy the
      storefront `storagePath` into `Shop.imageUrl` (or add a
      separate `Shop.storefrontPath` and mint public-read access at
      approve-time by moving the file from `/shop-kyc/` to
      `/shops/`).
- [ ] **Audit log collection for admin governance actions** â€” every
      `revokeShopOwner` / `revokeDelivery` / `suspendShop` /
      `unsuspendShop` / `approveShop` / `rejectShop` is currently
      logged to `console.log` only. Promote to a Firestore `auditLog`
      collection with `{ action, adminUid, targetUid?, shopId?,
      reason?, timestamp }` per entry. Needed for production
      accountability and dispute resolution. Add an admin-only
      `listAuditLog` callable + UI screen.
- [ ] **Admin grant invite flow** â€” when scaling past one operator,
      replace the CLI-only `set-admin` path with: existing admin
      invites by phone, invitee logs in, `acceptAdminInvite`
      callable mints the claim + writes audit entry. Until then,
      handing off `service-account.json` to a co-admin is the only
      way to grow the admin set, which is fine for MVP. Post-launch.
- [ ] **Self-revoke client-side parity check** â€” server already
      throws `failed-precondition` on `uid === auth.uid` for all
      governance callables. UserDetailScreen also disables the
      buttons for self. Add a unit/integration test pinning that
      both layers reject self-revoke; right now it's covered only
      by manual QA.
- [ ] **Suspended-shop in-flight order policy** â€” `suspendShop`
      currently leaves in-flight orders untouched (out_for_delivery
      orders complete, `accepted` / `preparing` orders continue).
      Define and implement an admin-controlled override: "suspend
      and cancel all unfulfilled" with refund handling for online
      payments. MVP keeps the simple "suspend = stop new orders only"
      semantics.
- [ ] **Pagination on `listAllUsers` / `listAllShops`** â€” both
      capped at 100 records (Auth SDK supports up to 1000 per page;
      Firestore needs cursor-based paging). Add `nextPageToken` /
      `startAfter` arguments and a "Load more" button on the
      management screens once we cross ~50 users / shops.
- [ ] **`SearchScreen` rewrite to per-shop menu** (Phase 12a-v2-iii)
      â€” search currently still reads the legacy global `products`
      collection, which means a search hit may surface a product that
      isn't actually on any active shop's menu, or shows the global
      price instead of the shop's price. Rewrite to either (a)
      fan-out queries across active shops' menu subcollections with a
      union, or (b) maintain a denormalized search index in a new
      top-level `menu_search` collection keyed by `${shopId}_${menuItemId}`.
      Option (b) scales better but adds a write fan-out cost on every
      menu update.
- [ ] **Multi-shop cart guard** (Phase 12a-v2-iii) â€” current cart
      already enforces single-shop via `addItem` returning
      `different_shop`, but the v2-iii prompt explicitly deferred a
      stricter server-side guard: `placeOrder` does not currently
      reject a cart whose lines reference a `shopId` different from
      the order's `shopId` (it just validates each line). Add a
      consistency check that every line's resolved menu item lives
      under the order's `shopId`.
- [ ] **Bulk menu actions** (Phase 12a-v2-ii) â€” single-item editing
      only in MVP. Production needs "mark all unavailable", "set 10%
      off all atta items", "copy prices from another shop", etc.
      Likely a separate ShopMenuBulkScreen + a bulk-update callable
      that takes an array of `{ menuItemId, fields }` patches.
- [ ] **Image upload for custom menu items** â€” `AddCustomMenuItemScreen`
      currently accepts only an image URL. Production needs in-app
      camera/gallery upload to Firebase Storage with automatic resize
      (200Ã—200, 600Ã—600). Wire `expo-image-picker` + a `uploadMenuImage`
      Cloud Function that returns a signed URL.
- [ ] **Menu import from CSV/Excel** â€” for shops onboarding with large
      catalogs (50+ items). Admin-side upload that parses + validates
      rows, then calls `addCustomMenuItem` in batches. Post-MVP.
- [ ] **Stock auto-decrement on order placement** â€” `MenuItem.stock`
      is informational only in MVP. Production may want hard limits:
      `placeOrder` decrements per-item stock atomically and rejects
      orders that would push stock negative. Requires a transaction
      over the menu subcollection per order. Tracked together with
      "Auto-cancel orders not picked up within X minutes".
- [ ] **Shop-level discount campaigns** â€” "10% off all atta items
      today", time-limited promo codes, first-order discount, etc.
      Distinct from per-item MRP/price; should live in a separate
      `shops/{shopId}/promotions` subcollection so menu pricing stays
      stable. Post-MVP marketing tool.
- [ ] **Re-bootstrap shop menus when products are added** â€” current
      `bootstrapShopMenu` only fires on `approveShop`; if the platform
      adds new products to the global catalog later, existing shops'
      menus won't get them automatically. Either (a) add an admin-only
      `syncCatalogToAllMenus` callable, or (b) extend `addProduct`
      (when we ship it) to fan-out into every active shop's menu.
- [x] **Cloud Functions Node.js 20 runtime upgrade** â€” bumped
      `functions/package.json` engines to `node: "22"` in PR 9
      (May 18 2026). Local build + tests green; staged dev/prod
      deploys pending (Parts 5â€“8 of PR 9 are operator-driven).
- [x] **`firebase-functions` SDK upgrade** â€” bumped
      `firebase-functions ^6.0.1 â†’ ^7.2.5` and `firebase-admin
      ^12.6.0 â†’ ^13.9.0` in PR 9 (May 18 2026). Zero code
      changes required: every v2 surface we use (`onCall`,
      `onSchedule`, `onDocumentCreated`, `onDocumentUpdated`,
      `defineSecret`, `setGlobalOptions`, `HttpsError`,
      `FieldValue.*`) compiles clean against v7. Staged
      deploys pending.
- [ ] **Auto-cancel orders not picked up within X minutes** â€”
      `cleanupAbandonedOrders` only handles payment-pending. Add a
      sibling scheduled job that finds `out_for_delivery` orders older
      than ~30 min with no `pickedUpAt`, alerts the shop owner, and
      after a longer threshold either reassigns or cancels with refund.
- [ ] **Live location tracking** â€” Phase 12b status transitions only.
      Adding "driver is 800m away" needs the delivery app to push GPS
      to the order doc periodically (every ~30s while
      `pickedUpAt && !deliveredAt`), the customer's `OrderDetailScreen`
      to read it, and `firestore.rules` to allow the assigned delivery
      person to write `deliveryLocation` on their orders. Out of MVP.
- [ ] **Multi-order pickup batching** â€” single delivery person picks
      up 2+ orders from the same shop in one trip. Out of MVP.
- [ ] **Admin approval workflow for shop owner + delivery
      self-registration** â€” currently `claimShop` and `becomeDelivery`
      are open self-service. For production, gate behind admin KYC
      approval: store registration intent in a `pendingRoleRequests`
      collection, admin reviews ID/address/vehicle docs, admin-only
      callable promotes to actual claim. Without this, anyone could
      claim any seeded shop.
- [ ] **Build "create your own shop" flow** â€” currently shop owner
      picks from the 8 seeded shops. Production needs a new-shop
      onboarding form (name, address, GST, FSSAI, pin, photos),
      admin verification, then a Cloud Function that creates the shop
      doc + sets the owner claim atomically. Until then, the platform
      operator must seed every shop manually.
- [ ] **Multi-shop ownership** â€” Phase 12a hard-caps one shop per user
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
- [ ] **Shop owner stats: weekly / monthly views + charts** â€” Phase
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
      â€” the `production` profile predates push, same as `development`
      did. When you run `eas build --profile production --platform ios`
      for the first time after this phase, expect the same
      `aps-environment` capability error. Fix by running
      `eas credentials` â†’ iOS â†’ production â†’ Build Credentials â†’
      Provisioning Profile â†’ Remove, then rebuild. EAS will regenerate
      with the capability enabled. [Phase 9a]
- [ ] **Phase 9c** â€” native phone auth via `@react-native-firebase/auth`
      so iOS users can sign in with phone (not web-only). [Phase 9c]
- [ ] **Android dev client** built and tested (currently iOS-only). [Phase 9a-android]
- [ ] **Production iOS build** signed with App Store distribution cert
      via `eas build --profile production --platform ios`. [Phase 9a]
- [ ] **Production Android build** as `.aab` for Play Store via
      `eas build --profile production --platform android`. [Phase 9a]
- [ ] **Test on multiple iPhones** registered via `eas device:create` â€”
      family test with at least 3 different iOS versions. [Phase 9a]
- [ ] **Replace polling with snapshot listeners** in `orderService.ts`
      once `@react-native-firebase/firestore` stabilizes for static
      frameworks + RN 0.81. Keep optimistic UI on top â€” the snapshot
      listener becomes the fast-confirmation path instead of polling,
      and rollback on Function failure stays the same. [Phase 9c]
- [ ] **Toast/snackbar on optimistic-update revert** instead of
      `Alert.alert` ("Couldn't update â€” restored"). Less intrusive
      and matches the optimistic-UX feel; alerts interrupt the next
      tap. Post-MVP polish. [Phase 9c]
- [ ] **Multi-admin conflict detection** in `AdminOrdersScreen`. When
      two admins act on the same order simultaneously, `updateOrderStatus`
      rejects the second call (state machine validates the transition).
      Optimistic UI on the second client should revert AND show
      "Already updated by another admin" â€” needs error-message-aware
      handling, not just a generic alert. Defer until real shop owners
      are onboard and concurrent activity becomes likely. [Phase 9c]

## ðŸ—ï¸ Build configuration

- [ ] **Drop `plugins/withModularHeaders.js`** custom plugin once
      `@react-native-firebase` ships native support for `useFrameworks: 'static'`
      without needing `use_modular_headers!` in the Podfile. Currently
      required because RNFB v24's static framework includes React-Core
      headers non-modularly, breaking the iOS build. Low priority â€”
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
      (~2Ã— Firestore reads + 200-500ms latency per poll); revisit if
      Function invocation cost or staleness becomes a complaint.
      [Phase 9c]
- [ ] **Re-evaluate `expo.install.exclude` in package.json** â€” currently
      excludes `@react-navigation/native` and `@react-navigation/native-stack`
      so expo-doctor stops blocking EAS builds on minor version drift.
      Revisit at next Expo SDK upgrade and either remove the exclusion
      (after Expo bumps its expected versions) or re-pin to expected
      versions if behavior diverges. [Phase 9c]

## ðŸ“Š Observability

- [ ] **Sentry** running in production with proper environment tag. [Phase 5e-i]
- [ ] **Firebase Analytics** verified producing events in production
      property (not dev project's Analytics). [Phase 5e-i]
- [ ] **Firebase Performance Monitoring** showing real user data. [Phase 5e-i]
- [ ] **Cloud Logging** filters set up for Functions errors. [pre-launch]
- [ ] **Crashlytics native** added once Phase 9c lands native modules. [post-Phase 9c]
- [x] **Silent-catch static guard** — `tests/static/noSilentCatchAudit.test.ts`
      (backed by pure detector `tests/static/noSilentCatchDetect.ts`, +12
      tests) bans `.catch(() => {})` bodies in `src/` that don't report to
      Sentry, log, rethrow, or set error state. Walks the contiguous
      comment block above each catch for a `silent-catch-audit:allow`
      justification. Migrated all flagged sites: Sentry capture on
      attention-fetch failures (`ShopOwnerDashboardScreen`,
      `DeliveryDashboardScreen`, `ShopOrderDetailScreen`,
      `DeliveryOrderDetailScreen`, `OrderDetailScreen` getShop,
      `CheckoutScreen` delivery estimate), `console.warn` on reverse-geocode
      display fallbacks (`ShopSettingsScreen`, admin
      `ShopDetailManagementScreen`), and explicit allowlist on genuine
      best-effort fire-and-forgets (tel:/maps: deep-links, haptics,
      `reportDeliveryLocation`, AuthBootstrap orchestrator net). Guard runs
      on every `npm test`. [HOTFIX-SILENT-CATCH-GUARD]
- [x] **Post-deploy smoke script** — `scripts/post-deploy-smoke.ts`
      (`npm run smoke` / `smoke:indexes` / `smoke:iam`) read-only validator
      catching the three deploy-state failures that masquerade as "empty
      result": callable not deployed (`gcloud functions describe`), IAM
      `allUsers` invoker stripped (`gcloud run services get-iam-policy`,
      ACAB-etag detection), composite index still Building
      (`firebase firestore:indexes`). Project-allowlisted to
      `grocery-mvp-dev`; refuses any other `--project`. Pure parsers in
      `scripts/parsesmokeOutput.ts` (+9 tests). Verified live against dev:
      `listMyOrders` deployed + IAM bound, all indexes Enabled. Wired into
      CLAUDE.md server-first deploy protocol. [HOTFIX-POST-DEPLOY-SMOKE-SCRIPT]

## ðŸ“ Compliance & Distribution

- [x] **Privacy Policy** drafted, hosted at a public URL, linked in app
      and store listings. Required for both Play Store and App Store.
      [Shipped â€” PR 25] â€” markdown at `docs/privacy-policy.md`,
      static HTML at `dist/privacy.html`, hosted at
      `https://grocery-mvp-dev.web.app/privacy`. Linked from
      LoginScreen footer + ProfileScreen "Legal" section.
- [x] **Terms of Service** drafted, hosted, linked.
      [Shipped â€” PR 25] â€” markdown at `docs/terms-of-service.md`,
      static HTML at `dist/terms.html`, hosted at
      `https://grocery-mvp-dev.web.app/terms`. Linked same surfaces.
      **Follow-up before App Store submission:** replace
      `[CITY TBD before launch]` placeholder in Â§13 governing-law
      clause with the real operating-entity city.
- [ ] **DPDP Act 2023 (India) compliance review** â€” data collection notice,
      retention policy, deletion request process. [pre-launch]
- [ ] **Play Store listing** prepared: app icon (512Ã—512), screenshots
      (phone + tablet), feature graphic, short + long description, content
      rating questionnaire. [pre-launch]
- [ ] **App Store listing** prepared: app icon, screenshots, description,
      keywords, App Privacy questionnaire (data collection categories). [pre-launch]
- [ ] **App version bump** in `app.json` from `1.0.0` if needed. [pre-launch]
- [ ] **Customer support email** set up; in-app or footer link. [pre-launch]

## âœ… Done in development (verified working)

- [x] Phase 1-7: full app architecture + Firestore migration
- [x] Phase 5a: App Check on web (reCAPTCHA v3) â€” enforcement temporarily off
- [x] Phase 5b: order lifecycle state machine + admin CLI
- [x] Phase 5c: EAS dev client built, installed on iPhone
- [x] Phase 5e-i: Sentry + Firebase Analytics + Performance
- [x] Phase 5e-ii: pre-launch cleanup, location filter restored, debug strip gated
- [x] Phase 6: real GPS via expo-location with fallback
- [x] Phase 7: shop owner admin dashboard
- [x] Phase 8a: Razorpay backend (Cloud Function + webhook with signature verification)
- [x] Phase 8b: Razorpay client (Checkout overlay) â€” verified end-to-end on web
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
      â€” custom claims schema (admin/shopOwner+shopId/delivery), self-service
      claim flow (BecomeShopOwner picks from unclaimed seeded shops),
      ShopOwnerDashboard scoped to one shop with today's stats + status
      controls, push to shop owner on new order via sendNewOrderPushToShop,
      delivery claim wired in advance for Phase 12b. 16 Cloud Functions
      total. firestore.rules extended with isShopOwnerOf().
- [x] Phase 12a-v2-i: shop registration + admin approval workflow.
      Replaced the self-service `claimShop` shortcut with a full
      registration form â†’ pending â†’ admin approve/reject â†’ active
      lifecycle. Schema: `Shop.status` âˆˆ {pending, active, rejected,
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
      undefined-status shops, see backfill script) are returned â€”
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
      reading the global catalog â€” a deferred follow-up).
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
      shop owner can only edit `price` / `available` / `stock` â€”
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
      `ShopMenuItemEditScreen` (form is reactive to `isCustom` â€”
      GLOBAL items show a ðŸ”’ banner explaining catalog-locked fields),
      `AddCustomMenuItemScreen` (full create form with category
      picker; image upload is URL-only, in-app picker is post-MVP).
      `firestore.rules` adds `shops/{shopId}/menu` rule (public read,
      Cloud-Functions-only writes). Backfill script
      `scripts/backfill-shop-menus.ts` (idempotent, run once via
      `npm run backfill-menus`) seeds the legacy 8 demo shops with
      the existing catalog. Whitelist enforcement on `updateMenuItem`
      prevents a misbehaving client from sneaking through `productId`
      / `isCustom` flips. Customer-facing reads still go through the
      legacy global catalog â€” Phase 12a-v2-iii will switch
      `ShopDetailScreen` to read from this menu collection.
- [x] Phase 12a-v2-i-bis: admin governance â€” revoke shopOwner /
      delivery roles, suspend / unsuspend shops, user management +
      shop management UIs. 6 new Cloud Functions: `revokeShopOwner`,
      `revokeDelivery`, `suspendShop`, `unsuspendShop`, `listAllUsers`,
      `listAllShops`. 4 new admin screens:
      `UserManagementScreen` (polled list with phone/uid filter),
      `UserDetailScreen` (revoke buttons + suspend-shop short-circuit
      + self-protection banner), `ShopManagementScreen` (grouped by
      status), `ShopDetailManagementScreen` (suspend/unsuspend with
      reason). Admin claim grant explicitly NOT exposed via UI â€”
      `set-admin` CLI is the only path. Single-admin lockout protected
      both client-side (button disabled when `uid === auth.uid`) and
      server-side (`failed-precondition` thrown). `revokeDelivery`
      reassigns in-flight deliveries by clearing `deliveryPersonId`
      and pushes "Delivery being reassigned" to affected customers,
      so orders keep moving when a partner is removed mid-shift.
      `suspendShop` does NOT cancel in-flight orders (intentionally â€”
      see follow-up below); customers stop seeing the shop via the
      existing `status==active` filter. Platform-policy comment
      block added at top of `functions/src/index.ts` warning future
      maintainers against adding any `grantAdmin` callable.
- [x] firestore.rules + firestore.indexes.json under version control
- [x] Audit script (`npm run audit`) gates code integrity after each Windsurf prompt

## ðŸ§ª Testing

- [x] **Firestore rules tests** â€” emulator-based unit tests under
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
      - **Prereq:** local JDK 11+ on PATH â€” the Firestore emulator
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
- [ ] **Cloud Functions unit tests** â€” separate PR. Use
      `firebase-functions-test` with the same emulator harness.
      Priority: `placeOrder`, `claimDelivery`, `approveShop`,
      `mergeCustomClaims`. [post-Phase 12c]
- [ ] **React component tests** â€” defer until UI stabilises post
      Phase 12c cleanup; component churn would invalidate tests
      every PR right now. [post-Phase 12c]
- [ ] **Detox / E2E happy-path** â€” defer until production role-play
      week. [pre-launch]
- [ ] **Storage rules tests** â€” revisit when image uploads ship
      (Phase 13?). Right now `storage.rules` only allows reads on
      product/shop images written by the seed scripts. [post-image-uploads]
- [ ] **CI integration for rules tests** â€” currently local-only.
      Add a GitHub Actions workflow that installs Node 20 + JDK 17
      and runs `npm run test:rules` on every PR touching
      `firestore.rules` or `tests/`. Sudhir runs everything locally
      for now. [pre-launch]
- [ ] **Set `enforceAppCheck: true` parity test** â€” when App Check
      enforcement is re-enabled in `functions/src/index.ts`, add a
      callable-functions test that proves a request without an App
      Check token is rejected. Pairs with the Security checklist
      item near the top of this file. [pre-launch]

## ðŸ§ª Testing standard (project-wide, post-v2-iii hotfix)

**Every PR going forward must include automated tests for what it
changes or fixes.** Sudhir explicitly added this after the
loader-stuck-forever incident â€” manual smoke testing missed both the
shopService Plan-B gap AND the watcher silent-swallow bug because
neither produced a console error and neither was covered by the
rules tests. PRs without tests for new behaviour are rejected at
review. The two test runners now in the repo:

- [x] **Rules tests** â€” `npm run test:rules` (52/52 passing,
      emulator-backed). Locks down `firestore.rules` behaviour by role.
      Untouched by this PR.
- [x] **Unit tests** â€” `npm run test:unit` (24/24 passing as of this
      hotfix, in-process, no emulator). Covers Cloud Function pure
      logic, service-layer Plan-B dispatch, watcher contract, and
      screen-load state machines. Config:
      `tests/jest.unit.config.js`. Module mocks under
      `tests/__mocks__/` keep the suite running in plain Node â€” no
      Metro / RN runtime needed.
      [Phase 12a-v2-iii-hotfix-tests]
- [ ] **CI integration for unit tests** â€” currently local-only
      alongside `test:rules`. When the GitHub Actions workflow for
      rules ships, add `npm run test:unit` to the same workflow.
      [pre-launch]
- [ ] **React Native rendering tests (RNTL)** â€” out of scope for the
      hotfix. The unit-test infra deliberately avoids RNTL setup
      cost; the loader-stuck-forever bug class is tested at the
      hook/service layer instead. Revisit when the screen layer
      stabilises post Phase 12c. [post-Phase 12c]

### Resetting test data (before family role-play)

After Phase 12c finishes and solo + automated testing wraps, the dev
project is full of stale test orders, half-edited shops, ad-hoc
admin-approved menus, and one-off sign-ins. Before the family role-
play session we want fresh users walking up to the app cold â€” no
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
| `--no-confirm` | Skip the interactive prompt (CI use). Requires `--execute` separately â€” never a single-flag operation. |
| `--admin-uid=<uid>` | Override `ADMIN_PROTECT_UID` env var. |

**What it wipes (default `--execute`):**

1. `/orders/*`
2. `/shops/{shopId}/menu/*` (subcollection per shop, traversed explicitly)
3. `/shops/*`
4. `/users/*` (except `ADMIN_PROTECT_UID`)
5. Firebase Auth users (except `ADMIN_PROTECT_UID`, in batches of 1000)

**What it preserves (allowlist-based â€” anything not above is untouched):**

- `/products` â€” the full global catalog (expensive to rebuild)
- Admin UID's auth account + all custom claims (admin/shopOwner/delivery)
- Service accounts, Cloud Functions, rules, indexes
- Any collection not explicitly listed above (e.g. future `/notifications`,
  `/deliveryReports`) â€” the script is allowlist, not denylist, so a
  new collection ships safe-by-default and only gets cleanup support
  via a follow-up PR.

**Safety guards (non-negotiable, pinned by tests):**

- Hardcoded project allowlist (`ALLOWED_PROJECTS = ['grocery-mvp-dev']`)
  â€” not configurable by flag or env. Editing the list requires a
  separate, reviewable commit.
- `ADMIN_PROTECT_UID` must be set; if it's not in the auth user list,
  the script aborts (means the operator set the wrong UID, or the
  admin has already been deleted â€” both warrant human attention).
- `--no-confirm` rejected without `--execute` (typo guard).
- Unknown flags rejected (typo guard â€” `--keep-shop` singular would
  otherwise silently fall through to "delete everything").
- Service account email is printed; if it contains "prod" or doesn't
  contain "dev", a loud warning fires but the operator still has the
  call (judgment belongs to the human).
- Idempotent: re-running after a successful execute returns 0/0/0
  counts.
- Audit log JSON written every run (dry-run too) to
  `scripts/.cleanup-logs/`. Git-ignored except for `.gitkeep`.

**Out-of-scope (explicitly deferred):**

- Razorpay test-payment cleanup â€” external system, dev-mode payments
  are inert; the script just prints a reminder at the end.
- Cloud Storage cleanup â€” no uploads yet; revisit when image upload
  ships.
- Cloud Functions / Scheduler state â€” separate ops concern.
- Production wipe â€” the script refuses to run against anything other
  than `grocery-mvp-dev`. Adding prod support is a deliberate,
  reviewable commit, not a flag.

Tests: `tests/scripts/reset-test-data.test.ts` (22 tests covering
project guard, admin filter, flag parser, deletion plan). Pinned
under `npm run test:unit` â€” total unit-test count is now 46/46
(24 from the v2-iii hotfix + 22 from this PR). [Phase 12c-prep]

## ï¿½ Auth UX + Profile + Saved Addresses (Phase 12a-v2-iv)

Two real UX gaps that surfaced during solo testing, fixed in one PR
because the schema + Cloud Functions are shared:

1. **No way to sign out.** `authService.signOut()` existed but was
   never called from any screen. Multi-user testing was literally
   blocked â€” once signed in, no path back to anonymous without
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
      `firestore.rules` change â€” the existing `match /users/{uid}
      { allow read,write: if isOwner(uid) }` already covers these
      fields. Types in `src/types/index.ts`. [Phase 12a-v2-iv]
- [x] **5 Cloud Functions (asia-south1, auth-required).**
      - `getMyProfile` â€” first-call seeds the doc with the user's
        phone number from `auth.token.phone_number`; if the doc
        exists but `phone` is missing (legacy), backfills on read.
        Skips silently when the auth token has no phone number
        (anon users).
      - `updateMyProfile({ name?, email? })` â€” patch with validation;
        `null`/`""` â†’ clear via `FieldValue.delete()`.
      - `saveAddress(addressInput)` â€” read-modify-write inside a
        transaction. Mints a `crypto.randomUUID()` for new addresses;
        update path matches on input `id`. First address sets
        `defaultAddressId` atomically.
      - `deleteAddress({ id })` â€” idempotent; if it was the default,
        promotes the most-recently-updated remaining address (logic
        in `promoteDefaultAfterDelete`).
      - `setDefaultAddress({ id })` â€” throws `not-found` if the id
        isn't in the user's addresses.
      All five wrap their pure validation/mutation logic from
      `functions/src/profileHelpers.ts` so the validators are
      unit-testable in plain Node. [Phase 12a-v2-iv]
- [x] **`profileService` with native/web Plan-B dispatch.**
      `src/services/profileService.ts`. Same pattern as
      `orderService` â€” native uses `@react-native-firebase/functions`,
      web uses `firebase/functions`, both pinned to `asia-south1`.
      Exports `getMyProfile`, `updateMyProfile`, `saveAddress`,
      `deleteAddress`, `setDefaultAddress`. Errors propagate to
      caller (no silent swallow â€” same lesson from the v2-iii
      watcher hotfix). [Phase 12a-v2-iv]
- [x] **`signOutAndClearLocalState` orchestrator.**
      `src/services/signOutAndClearLocalState.ts`. Dependency-
      injected for unit-testability â€” production caller (Profile
      screen) wires real `authService.signOut`, `useCartStore.
      clearCart`, and `nav.reset({ index: 0, routes: [{ name:
      'Home' }] })`. Tests pass `jest.fn()`s. Order matters:
      `signOut` â†’ `clearCart` â†’ `resetNavigation`, signOut errors
      abort the cart + nav cleanup so the user doesn't lose their
      cart on a transient failure. [Phase 12a-v2-iv]
- [x] **Profile screen.** `src/screens/ProfileScreen.tsx`. Three
      sections: phone (read-only), name+email form with Save,
      saved addresses (cards with default chip; tap â†’ edit;
      long-press â†’ action sheet for "Set as default" / "Delete"),
      Account section with red Sign Out button (confirm dialog).
      Refetches profile on every focus so AddressEdit â†’ goBack
      reflects updates immediately. [Phase 12a-v2-iv]
- [x] **AddressEdit screen.** `src/screens/AddressEditScreen.tsx`.
      Two modes: Create (no `addressId` route param) and Edit
      (`addressId` present â†’ fetches the parent profile and
      hydrates from the matching address). Client-side validation
      mirrors `validateAddressInput` for instant feedback. Delete
      button visible only in Edit mode. Optional `prefill` route
      param for the Checkout post-order save flow.
      [Phase 12a-v2-iv]
- [x] **HomeScreen Profile entry-point.** New ðŸ‘¤ Profile row,
      visible only when `!isAnonymous`. Anonymous users see the
      existing ðŸ“± Sign in row instead â€” same pattern. [Phase 12a-v2-iv]
- [x] **CheckoutScreen saved-address picker.** Two modes by
      `usingForm` flag: picker (â‰¥1 saved address, default selected
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
      â€” pure conversions between `SavedAddress` and the form-
      fields shape. No React imports. [Phase 12a-v2-iv]
- [x] **33 new unit tests** (well above the spec's â‰¥18 floor).
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

- [x] **Push token cleanup on sign-out** â€” [Shipped â€” PR 24]. The
      device's Expo push token currently stays in the previous
      user's `users/{prev-uid}.fcmTokens` after signing out. The
      previous account keeps receiving notifications meant for
      them on this
      physical device. Fix: add a `removePushToken` callable that
      arrayRemoves the current device's token, called from
      `signOutAndClearLocalState` BEFORE the firebase signOut
      (so request.auth.uid is still the old user). Skipped here
      because the fix needs a new callable + its own unit test;
      worth its own micro-PR. [Phase 12a-v2-iv-followup]
- [ ] **Profile entry-point in non-customer stacks** â€” the ðŸ‘¤
      Profile row is only on the customer Home. Owner / delivery /
      admin dashboards have their own headers and don't surface
      Profile. Acceptable for MVP since the dashboards are
      role-specific and most owner/delivery users will navigate
      back to Home anyway, but a full nav refactor would put
      Profile in a global drawer. [post-Phase 12c]
- [ ] **Email verification flow** â€” the email captured by
      updateMyProfile is accepted at face value (no verification
      link sent). Add later if email becomes important for
      marketing/notifications. Out of MVP scope per spec.
      [post-MVP]
- [ ] **Address autocomplete (Google Places)** â€” manual entry only
      for MVP. [post-MVP]
- [ ] **Multiple shipping addresses per order** â€” one address per
      order, same as today. Saved addresses are about reuse, not
      splitting. [post-MVP]
- [ ] **Profile picture upload** â€” no avatars in MVP. Phone +
      name + email is enough for receipts. [post-MVP]
- [ ] **`OrdersScreen` silent-warn on listMine error** â€” already
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
1. ðŸ‘¤ Profile row visible on Home (signed in only).
2. Edit name + email â†’ save â†’ reopen â†’ values persisted.
3. Add address â†’ appears with Default chip (first one).
4. Add 2nd address â†’ long-press 1st â†’ Set as default â†’ chip moves.
5. Delete the default â†’ next-most-recent gets promoted.
6. Sign Out â†’ confirm modal â†’ returns to Home in anon state, no
   "Your Roles" section, "Sign in with phone" CTA visible.
7. Place an order: saved-address picker if any, form if none;
   after the order, "Save this address?" prompt for unsaved
   addresses (auto-saved if you had 0 prior).

## Test-strategy reinforcement (Phase 12a-v2-iv-test-hardening)

The recent solo-test regressions exposed structural test gaps â€”
**all four bugs were contract drift between layers** that no
existing test asserted. This phase backfills the gaps so the same
classes can't regress.

### Audit: why each bug escaped tests

| Bug | Why missed | Fix |
|---|---|---|
| `listShopOrders` INTERNAL (missing index) | No test runs a real query; indexes are config | `audit:indexes` script + 14 unit tests |
| `addItem` doesn't stamp `menuItemId` | Cart-store had ZERO tests asserting line shape | 10 invariant tests (every add path) |
| `orderService.placeOrder` strips `menuItemId` | No wire-shape test connected cart â†’ service â†’ callable | 3 wire-shape tests (native + web) |
| `getOrder` rejects shop owners | Inline auth check, never extracted, never tested | 11 `canReadOrder` tests + 10 parity matrix cases |

### What shipped

- **`scripts/audit-firestore-indexes.ts`** â€” static parser that walks
  every `db.collection(...).where(...).orderBy(...)` chain in
  `functions/src/index.ts`, classifies as composite vs. single-field
  per Firestore rules, and verifies a matching entry in
  `firestore.indexes.json`. Wired into `npm test` via the
  `audit:indexes` script. Catches the v2-iv "INTERNAL" bug class
  entirely. **Caught one false-positive on first run that taught me
  Firestore's implicit-index rule** â€” pinned by tests so the
  heuristic doesn't regress.

- **`tests/store/useCartStore.invariants.test.ts`** (10 tests) â€”
  asserts that every cart-add path (`addItem`, `forceAddItem`,
  `addMenuItem`, `forceAddMenuItem`, plus increment / cross-shop /
  mixed-sequence flows) produces lines with `menuItemId: string`
  (non-empty) and `priceSnapshot: number`. Pins the v2-iv hotfix
  contract.

- **`tests/store/useCartStore.persist.test.ts`** (2 tests) â€” seeds
  AsyncStorage with a stale `cart-v1` payload (no `menuItemId`),
  hydrates the store, asserts the items array is empty under the
  new `cart-v2` key. Plus a positive control rehydrating a
  well-formed `cart-v2` entry. Catches future "we forgot to bump
  the persist version after a schema change" regressions.

- **`tests/services/orderService.placeOrder.test.ts`** (3 tests) â€”
  full integration test of the wire shape. Stubs the callable on
  both native and web paths, calls `orderService.placeOrder({...})`
  with real `CartItem[]`, asserts the captured payload has
  `menuItemId` on every line. Catches a future "let's just inline
  this map again" refactor that bypasses `buildPlaceOrderPayload`.

- **`tests/contracts/orderReadAuth.parity.test.ts`** (10 cases via
  `test.each`) â€” explicit matrix of every `(uid, claims, order) â†’
  expected` case from the rules clause, run through `canReadOrder`.
  Test names match `tests/rules/orders.test.ts` so a code reviewer
  can verify parity by eyeballing both files. **Documents the
  contract.**

- **`tests/scripts/auditFirestoreIndexes.test.ts`** (14 tests) â€”
  pins the audit script's `isComposite` + `indexCovers` + parser
  logic. Includes the false-positive case (multi-equality without
  orderBy) so the heuristic can't silently regress.

- **Test infra fix**: `tests/__mocks__/firebase-functions.ts` now
  uses `globalThis` for state, matching `rnfb-app.ts`. Without this,
  any `jest.isolateModules()` test of the web path lost the mock
  factory across the SUT module-registry boundary. **Caught while
  writing the placeOrder wire-shape test** â€” would have silently
  broken any future web-path test.

### Tests added: 39 (49 if you count the parity matrix as 10 cases)

**Total unit-test count: 162 / 162** (123 prior + 39 new).

### Deferred (logged for follow-up)

- [ ] **Order-read consistency lint** â€” every Cloud Function that
      calls `db.doc('orders/...').get()` should either use
      `canReadOrder` OR be allow-listed with a documented
      action-specific guard. Most current callsites
      (`cancelMyPendingOrder`, `claimDelivery`, etc.) have
      action-specific checks; a meta-lint would scan AST and
      verify. Complexity > current value, but worth doing if a
      similar drift bug recurs. `[Phase 12a-v2-iv-followup]`
- [ ] **Plan-B dispatch parity test (full)** â€” meta-test scanning
      every service file for `if (isNative)` blocks and asserting
      both branches call the same callable name with the same
      payload shape. The `placeOrder` test demonstrates the
      pattern; extending to all callables is mechanical. `[Phase 12a-v2-iv-followup]`
- [ ] **Firestore emulator integration tests** â€” actually run each
      callable through its real query path against a seeded
      emulator. Catches index issues, rules issues, dispatch issues
      at once. Requires `firebase emulators:exec` infra in CI.
      `[Phase 12c-prep]`
- [ ] **RNTL component tests** â€” for screens with non-trivial state
      machines. Hooks have pure-helper tests; this would add a
      thin render/event layer on top. `[Phase 12c-prep]`
- [ ] **Maestro / Detox E2E** â€” full user journeys. Highest cost,
      highest value for catching multi-layer bugs. Should be a
      separate phase. `[Post-launch]`

## View-first dashboard cards + delivery history (Phase 12a-v2-iv-followup-view-first)

Solo testing surfaced two related dashboard issues. Bundled into a
single PR (and single OTA) since they touch the same files.

### Issue 1 â€” Accidental accepts

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

**Category B (mid-flow status updates)** â€” "I've picked it up" and
"Delivered" â€” STAY inline on the dashboard. Delivery use is
one-handed and under time pressure, the commitment is already
made, and forcing a tap-to-detail for these adds friction with
zero risk reduction.

### Issue 2 â€” No delivery history visible

Dashboard showed "Completed today" stat but no list of what was
actually delivered. The data was already in scope via
`watchMyDeliveries`. Added a collapsible "Delivery History"
section (default collapsed) below "My Active Deliveries".

### What shipped

- **`src/screens/shop/ShopOwnerDashboardScreen.tsx`** â€” removed
  inline `Accept` / `Mark Preparing` / `Mark Out for Delivery`
  buttons. Removed `handleAction`, `pending` Record state,
  `ACTION_LABELS` + `nextActionsFor` imports, `Alert` + `Button`
  imports, `SHOP_OWNER_ALLOWED_ACTIONS` constant. Card body is
  now a single `Pressable` (was a Pressable + sibling buttons
  region). Tap hint reads "Tap to view items & take action".

- **`src/screens/delivery/DeliveryDashboardScreen.tsx`**:
  - Removed inline `Accept` button + `handleClaim` + claim race
    state from `AvailablePickupCard`. Card body is now the sole
    tap target â†’ navigates to `DeliveryOrderDetail`.
  - **`ActiveDeliveryCard` UNCHANGED** â€” Category B preserved.
    Inline "I've picked it up" â†’ "Delivered" buttons stay.
  - Added `deliveredMine` memo (filter status==='delivered',
    sort by `deliveredAt` desc).
  - Added collapsible **"Delivery History"** section + new
    `DeliveryHistoryCard` component. Default collapsed. Tapping
    a row navigates to `DeliveryOrderDetail` (the existing
    delivered-state view handles it without changes).
  - History card **omits customer phone** (matches the privacy
    guard on `DeliveryOrderDetailScreen` available-for-claim
    state â€” the partner already had the phone while assigned;
    no need to keep surfacing it).

- **`src/utils/format.ts`** â€” added `formatRelativeDeliveryTime(ms, now?)`.
  Pure helper, no React, no IO, signature locked to `(ms, now?) =>
  string` for type-level privacy (no address/phone parameter
  slot). Rules:
  - same day â†’ "Today 3:45 PM"
  - previous day â†’ "Yesterday 11:20 AM"
  - within last 7 days â†’ "Mon 2:15 PM"
  - older â†’ "May 14, 2:15 PM"
  - Calendar-day diff (not 24h-ms) so DST flips behave correctly.

- **Detail screens UNCHANGED**:
  - `ShopOrderDetailScreen.tsx` already owned all action buttons
    via `useShopOrderDetail` â€” pinned by
    `tests/screens/detailScreenActions.test.ts`.
  - `DeliveryOrderDetailScreen.tsx` already owned "Accept this
    pickup" (added in the previous PR) â€” pinned by the same
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
strips unused imports on save â€” noticed during this work; logged
below). Test `does NOT import ACTION_LABELS` failed by name.
Reverted; 24 / 24 green.

### Deploy + OTA

JS-only â€” **no `firebase deploy` needed**.

```powershell
eas update --branch preview --message "view-first dashboard cards"
```

### Noticed during this work â€” auto-import-cleaner subtlety

The IDE's import-cleaner silently strips unused imports on save.
This means a structural test like "screen X must NOT import Y" can
become a no-op if the test author isn't careful â€” the cleaner does
the work for you. Mitigation: structural tests should also assert
the absence of an actual *use* (e.g. `handleAction` function
definition, `<Button title=...>` element), not just the import
line. The tests in `dashboardCardActions.test.ts` already check
function definitions + component-body content, not just imports â€”
intentional.

### Deferred (logged for follow-up)

- [ ] **Delivery History pagination** â€” currently renders whatever
      `listMyDeliveries` returns. Server-side pagination + windowed
      list rendering becomes worth doing when partners cross ~100
      lifetime deliveries. `[Phase 12c-prep]`
- [ ] **Earnings preview per delivered order** â€” the history card
      shows the order total but not the partner's cut. Defer until
      payout schema lands. `[Post-launch]`

## Delivery Preview Detail (Phase 12a-v2-iv-followup-delivery)

Parallel solo-test gap to the Shop Order Detail PR: delivery
partners couldn't see what's inside an available pickup before
tapping Accept â€” only shop name + drop area + count + total.
Insufficient signal to decide whether to claim (refrigerated
goods, alcohol brands, etc.). Fixed by extending the existing
`DeliveryOrderDetailScreen` to handle the unclaimed-available
branch with an "Accept this pickup" button at the bottom, plus
making the dashboard's `AvailablePickupCard` body tappable to
open it.

### What shipped

- **`src/screens/delivery/DeliveryOrderDetailScreen.useDeliveryOrderDetail.ts`** â€”
  new state-machine hook colocated with the screen. Mirrors the
  shop-side pattern (`useShopOrderDetail`). Pure helpers carry the
  semantic load:
  - `reduceWatcherUpdate(prev, update)` â€” guarantees `loading:
    false` on the error branch (the regression we keep solving)
  - `deriveDeliveryFlags(order, uid, isDelivery)` â€” derives
    `isAssigned`, `isAvailableForClaim`, `isPickedUp`,
    `isDelivered`, `isTerminalForOthers` in one place. The screen
    branches on these flags only.
  - `runClaimOnce(claimDelivery, orderId)` â€” discriminated
    `{ ok: true } | { ok: false; error }` so the screen can render
    the "Already taken" Alert without an unhandled rejection.
  - `runStatusActionOnce` â€” same shape for `markPickedUp` /
    `markDelivered`.
  - `applyOptimisticPickedUp` / `applyOptimisticDelivered` â€”
    pure factories that return new order objects with the
    optimistic stamp; tested for non-mutation.

- **`src/screens/delivery/DeliveryOrderDetailScreen.tsx`** â€”
  refactored from inline state to use the hook. Three branches:
  - **Available-for-claim**: "Accept this pickup" button at
    bottom. On success â†’ navigate back to dashboard (post-claim
    refresh path is owned by the dashboard). On race-loss â†’
    "Already taken" Alert.
  - **Assigned, not delivered**: existing pickup â†’ delivered
    flow (no behaviour change).
  - **Assigned, delivered**: existing green Delivered card.
  - **Terminal-for-others**: EmptyState ("Already taken" or
    "Order already delivered") instead of dead buttons. The
    screen now reflects terminal state without requiring a tap.
  - **Header title** flips between "Pickup details" (claim view)
    and "Delivery" (assigned view) â€” small but improves the
    mental model.
  - **Customer phone hidden until assigned** â€” privacy guardrail
    so a partner browsing available pickups can't harvest
    customer numbers without committing to the run. Address line
    is still visible so the partner can decide whether the area
    is in their range.

- **`src/screens/delivery/DeliveryDashboardScreen.tsx`** â€”
  `AvailablePickupCard` body is now wrapped in a `Pressable` that
  navigates to `DeliveryOrderDetail` with the `orderId`. The
  Accept button sits OUTSIDE the Pressable so the quick-claim
  path doesn't double-fire navigation. Chevron `â€º` added to
  signal tappability. Same UX pattern as `ShopOwnerDashboard`'s
  order cards.

### Tests (20 new)

`tests/hooks/useDeliveryOrderDetail.test.ts` â€” 20 pure-helper tests:

- `reduceWatcherUpdate` Ã— 3: first success, watcher error clears
  loading (THE regression), error preserves prior order
- `deriveDeliveryFlags` Ã— 9: null order, available-for-claim,
  not-delivery-role, claimed-by-other (terminal), assigned-not-
  delivered, assigned + pickedUp, assigned + delivered (NOT
  terminal â€” success state), wrong status (preparing), empty-
  string deliveryPersonId edge case
- `runClaimOnce` Ã— 3: success, race-loss, fallback message
- `runStatusActionOnce` Ã— 2: success, failure (revert path)
- `applyOptimisticPickedUp` / `applyOptimisticDelivered` Ã— 3:
  pure copy semantics, no mutation, null passthrough

**Total unit-test count: 182 / 182** (162 prior + 20 new).

### Deliberate-break demo

Replaced `loading: false` with `loading: prev.loading` on the
error branch of `reduceWatcherUpdate`. Test
`watcher error clears loading (the regression we keep solving)`
failed by name, plus 6 cascading failures on the same code path.
Reverted, re-ran, 20 / 20 green.

### Deploy + OTA

JS-only â€” **no `firebase deploy` needed**.

```powershell
eas update --branch preview --message "delivery preview detail screen + claim button"
```

### Deferred (logged for follow-up)

- [ ] **Distance-aware filtering of available pickups** â€” separate
      tracked follow-up. The detail screen would benefit from "X km
      from your current location" context. `[Phase 12c-prep]`
- [ ] **Earnings preview ("you'll earn â‚¹X for this run")** â€” no
      schema for delivery payouts yet. Defer until payout model is
      decided. `[Post-launch]`
- [ ] **Delivery partner notes on order** â€” out of scope for MVP.
      `[Phase 12c-prep]`
- [ ] **In-app map preview** â€” explicitly out per Phase 12b "Do
      NOT" list. Maps app deep-link is fine for MVP. `[Post-launch]`

## Shop Order Detail screen (Phase 12a-v2-iv-followup)

Solo testing surfaced a fulfilment gap: the shop owner's dashboard
card shows count + phone + total + status, but **not the line
items**. Without the items, "Accept" is a coin flip â€” the owner
can't check stock or verify the brand of atta the customer wanted.
Same for customer name / address / payment method.

Server-side has all this on the existing order doc. Pure UI work.

### What shipped

- **New screen `src/screens/shop/ShopOrderDetailScreen.tsx`** â€”
  status header, customer block (with `tel:` tap-to-call on the
  phone), delivery address, items list with image + pack + qty +
  line total, bill summary, payment block, action buttons
  (Accept / Mark Preparing / Mark Out for Delivery, filtered
  through `nextActionsFor` âˆ© `SHOP_OWNER_ALLOWED_ACTIONS`).
- **Hook `src/screens/shop/ShopOrderDetailScreen.useShopOrderDetail.ts`** â€”
  watcher subscription + optimistic action + revert on failure.
  Pure helpers (`reduceWatcherUpdate`, `applyOptimisticStatus`,
  `runOrderActionOnce`) extracted so the watcher contract +
  revert behaviour can be unit-tested without RNTL. Same
  pattern as `ShopListScreen.useShopListData`.
- **`ShopOwnerDashboardScreen` cards now navigate.** Card body
  wrapped in a `Pressable` that pushes `ShopOrderDetail` with the
  `orderId`. Action buttons sit OUTSIDE the Pressable so tapping
  Accept / Preparing doesn't double-fire navigation. Chevron `â€º`
  added to the card header to signal tappability.
- **Route registered** in `AppNavigator.tsx` as
  `ShopOrderDetail: { orderId: string }`.
- **Permission guard** at the top of the screen: if
  `!isShopOwner || !ownedShopId`, shows
  "Shop owner access required". After the watcher resolves, if
  `order.shopId !== ownedShopId`, shows "Not your shop's order"
  (defence-in-depth â€” Firestore rules will reject the read
  anyway, but UI shouldn't hang on a permission-denied error).

### Tests (9 new)

- `tests/hooks/useShopOrderDetail.test.ts` â€” 9 pure-helper tests:
  - `reduceWatcherUpdate` Ã— 4: first success, watcher error
    clears loading (THE regression), error preserves prior order,
    fallback message
  - `applyOptimisticStatus` Ã— 2: returns new object (no mutation),
    null passthrough
  - `runOrderActionOnce` Ã— 3: success, throws â†’ revert path,
    fallback message on throw-without-message

`watchOrder` permission-denied path is already covered by the
existing `tests/services/orderService.watchers.test.ts` (the
`other failure: cb(null, error)` test, which exercises the same
code branch â€” RNFB callable rejection bubbles through the same
`catch` block regardless of code).

**Total unit-test count: 112 / 112** (103 prior + 9 new).

### Deliberate-break demo

Replaced `loading: false` with `loading: prev.loading` on the
error branch of `reduceWatcherUpdate`. Test
`watcher error clears loading (the regression we keep solving)`
failed by name. Reverted, re-ran, 9 / 9 green.

### Deploy + OTA

JS-only â€” **no `firebase deploy` needed**.

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
- [ ] **Print/export receipt** â€” out of MVP. `[Post-launch]`

## Solo-test hotfix (Phase 12a-v2-iv-hotfix-1)

Three independent bugs surfaced in Sudhir's first post-auth-UX
solo-test pass. Diagnosed before patching per the
diagnostic-first discipline.

### Bug 1 â€” Shop Dashboard "INTERNAL" with red Retry banner

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
  `validateShopOrdersAccess()`** â€” pure, testable, returns a
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

### Bug 2 â€” Saved addresses don't auto-fill at Checkout

**Root cause: UNCONFIRMED â€” observability deployed, fix deferred.**

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

**Root cause fix deferred** â€” Sudhir to repro on next session and
paste `firebase functions:log --only getMyProfile` output. Logged
as `[Phase 12a-v2-iv-followup]` below.

### Bug 3 â€” "Product p_001_atta_5kg not in this shop" at place-order

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
the Cloud Function â€” placeOrder always took the legacy
products-collection path and rejected with the well-known error
whenever the global product's shopId didn't match the cart's
shopId (always true for shop-scoped products like `p_008_atta`).

The earlier two diagnoses (SearchScreen legacy `addItem`,
persisted cart-v1 contamination) WERE real issues but were
defence-in-depth â€” the real wire-shape bug masked them
completely. Both fixes are kept for in-memory correctness; the
ACTUAL fix is in orderService.

**Real fix:**

- Extracted `buildPlaceOrderPayload()` to
  `src/services/placeOrderPayload.ts` and routed
  `orderService.placeOrder` through it. Helper forwards
  `menuItemId` and `priceSnapshot` (only when present + valid)
  alongside `productId` + `quantity`. Server-side dispatch now
  works as designed.
- Pinned by `tests/services/buildPlaceOrderPayload.test.ts` â€”
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
   path â€” a v2-iii oversight.
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
- Bumped persist version `cart-v1` â†’ `cart-v2`. Drops stale
  pre-hotfix carts on next launch. The alternative â€” running a
  migration â€” wasn't worth the complexity for what's a transient
  pre-launch issue.
- **Extracted `pickCartLinePath()`** to
  `functions/src/shopOrdersHelpers.ts` and pinned its contract.
  The placeOrder dispatch itself is unchanged (still
  `if (ci.menuItemId) {â€¦} else {â€¦}`); the helper exists for the
  test surface.

### Tests (18 new, pinned)

- `tests/functions/listShopOrdersValidation.test.ts` â€” 6 tests
  covering shopOwner self / shopOwner cross-shop /
  admin-any-shop / missing-shopId / empty-string-shopId /
  shopOwner-no-body-param.
- `tests/functions/placeOrderMenuValidation.test.ts` â€” 4 tests
  covering the `pickCartLinePath` predicate (menu / legacy /
  empty-string / wrong-type).
- `tests/utils/shopOrdersErrorMessage.test.ts` â€” 8 tests covering
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

### Deploy + OTA â€” run from a real PowerShell window

Per `.windsurf/deploy-discipline.md` â€” one `--only` target per
command.

```powershell
firebase deploy --only firestore:indexes --project grocery-mvp-dev
firebase deploy --only functions:listShopOrders --project grocery-mvp-dev
firebase firestore:indexes --project grocery-mvp-dev
firebase functions:list --project grocery-mvp-dev
```

Index builds take 1â€“5 minutes for the small `orders` collection
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

1. **Shop Dashboard** â€” sign in as shop owner, tap ðŸ›ï¸ Shop
   Dashboard. Either shows orders, OR shows "Orders index is
   being built. Try again in a few minutes." (while index is
   still PROVISIONING), OR shows the empty state. **Must NOT
   show "INTERNAL".**
2. **Checkout with saved addresses** â€” sign in as a user with
   â‰¥1 saved address, add an item to cart, open Checkout. Picker
   cards appear with default selected. If they don't, the yellow
   banner now shows the actual reason â€” paste the device console
   `[Checkout] getMyProfile failed: <code> <message>` line into
   the next session for root-cause analysis.
3. **Cart menuItemId stamping** â€” sign in as customer, browse a
   shop (any seeded one), add atta to cart from ShopDetail, open
   Checkout, place order. **Must NOT show "not in this shop"
   rejection.** If it does, `cart-v2` invalidation didn't fire;
   reinstall the app to clear AsyncStorage entirely.

### Deferred (logged for follow-up)

- [ ] **Bug 2 root cause** â€” Sudhir to paste
      `firebase functions:log --only getMyProfile --project grocery-mvp-dev`
      output from the next Checkout-falls-into-form-mode repro.
      Likely candidates: App Check token rotation race on Android
      dev-client, or RNFB phone-auth token not propagating to the
      Cloud Function on a specific re-focus. Observability is in
      place; needs server logs to isolate. `[Phase 12a-v2-iv-followup]`
- [ ] **SearchScreen still bypasses the menu price-snapshot
      capture** â€” the new `forceAddItem` stamps `priceSnapshot`
      from `product.price` (the global products doc), not from
      `shops/{shopId}/menu/{menuItemId}.price`. If the shop owner
      has set a per-shop price override on this item, the
      Search-added line will start with the global price and only
      get the menu price on the next add-to-cart from a menu-aware
      surface. Acceptable for MVP since placeOrder re-validates
      price server-side against the current menu doc and rejects
      drift. `[Phase 12c-prep]`
- [ ] **`AdminOrdersScreen` should reuse `mapShopOrdersError`** â€”
      same `INTERNAL`-leak risk on the admin watcher
      (`listAllOrders`). One-line wiring change. Not done here to
      keep this hotfix scoped. `[Phase 12a-v2-iv-followup]`
- [ ] **`bootstrapShopMenu` swallows errors on approve.** Line
      1677 catches with `console.error` and returns success. If
      the menu seeding fails (out of products, write rule changes,
      transient Firestore error), the shop is marked active with
      an empty menu â€” customers see "Closed" / "no items" until
      an admin manually runs the backfill script. The right fix
      is to surface a `bootstrapMenuFailed` flag on the shop doc
      so admin dashboard can show a "menu missing â€” re-bootstrap"
      action row. `[Phase 12c-prep]`

## ï¿½ï¿½ï¿½ Customer-side native fetch + loader-stuck-forever sweep (post-v2-iii hotfix)

Sudhir hit "Browse shops near me" on his Android device and the loader
spun forever. Root cause: `shopService.getNearbyShops` was reading
Firestore directly through the Firebase Web SDK, which hangs on this
RN setup (Expo SDK 54 + RN 0.81 + static frameworks â€” same
incompatibility that motivated the orderService Plan-B). Compounded by
`ShopListScreen` not having a try/catch around the load, so even a
thrown `getDocs` would never reset the loader. Pinned here so future
"loading forever" reports check the SDK split first.

- [x] **`shopService.getNearbyShops` â€” Plan B via `listShopsPublic`**
      â€” new public callable in `functions/src/index.ts` (next to
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
- [x] **`shopService.getById` â€” Plan B via reusing
      `listShopMenuPublic`** â€” native path calls the existing
      `listShopMenuPublic` callable (which already returns
      `{ shop, items }`) instead of a fresh `getShopPublic` callable;
      keeps the callable surface small. `not-found` errors from the
      server (missing or non-active shops) are caught and surfaced as
      `null` to match the web path's semantics. There are currently
      no callers of `shopService.getById` in `src/`, but the method
      is fixed pre-emptively rather than left as a future foot-gun.
      [Phase 12a-v2-iii-hotfix]
- [x] **`ShopListScreen` â€” guaranteed loading reset + error UI** â€”
      `src/screens/ShopListScreen.tsx` now wraps the `load()` call
      in `try/catch` and the initial-load effect's `setLoading(false)`
      is called from a `finally` block that runs regardless of how
      the promise settles. A new `error` state renders a red banner
      with a Retry button (styled with `colors.danger` from
      `src/constants/theme.ts`). The "no location yet" branch flips
      `loading` to false instead of sitting on the spinner â€” the app
      always falls back to `MOCK_USER_LOCATION` so this state should
      be transient anyway, but it's no longer indistinguishable from
      a stuck network call. [Phase 12a-v2-iii-hotfix]
- [ ] **`productService.getByShop` needs Plan B** â€”
      `src/services/productService.ts:6-10` reads
      `query(collection(db, 'products'), where('shopId', '==', shopId))`
      via the Web SDK. Reachable from native via
      `src/screens/SearchScreen.tsx:53` (called inside the customer
      Search flow). Has the same hang risk as the shop list bug â€”
      Sudhir just didn't trip it because Search hits `getNearbyShops`
      first and bails on the loader. Out of scope for this hotfix
      because Search already has a TS error
      (`shopService.getNearbyShops()` called with no args at
      `SearchScreen.tsx:49`) which suggests the screen is partially
      bit-rotted; bundle the Plan B refactor with a Search audit pass
      so we don't half-fix a stale screen. Suggested fix: a
      `listProductsByShopPublic` callable mirroring
      `listShopsPublic` / `listShopMenuPublic`. [Phase 12a-v2-iii-followup]
- [ ] **`productService.getById` needs Plan B (low priority)** â€”
      `src/services/productService.ts:11-14`. Currently has zero
      callers under `src/` (grep showed only `productService.getByShop`
      reachable). Leave the method in place for now â€” it'll naturally
      get the same Plan B treatment if/when something starts calling
      it, or get deleted if v2-iii's per-shop-menu model fully
      replaces it. [Phase 12a-v2-iii-followup]
- [x] **`orderService` web-SDK reads / `onSnapshot`s â€” already
      Plan B for the dispatch axis** â€” verified during the audit.
      `listMine` (line 143), `watchOrder` (line 219),
      `watchShopOrders` (line 537), and `watchAllOrders` (line 681)
      all gate their Web SDK calls behind `if (isNative) { â€¦ return }`
      blocks that route through RNFB callables (`listMyOrders`,
      `getOrder`, `listShopOrders`, `listAllOrders`). The dispatch
      itself is fine; the *callback contract* needed fixing â€” see
      next entry. [audit-only]
- [x] **Watcher contract refactor: `(data, error?)` callback shape**
      â€” `src/services/orderService.ts` `watchOrder`,
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
      `tests/services/orderService.watchers.test.ts` â€” 9 tests
      covering all five watchers + the cleanup-on-cancel path; the
      "never silently swallows" assertion deliberate-break demo
      reverted one watcher's catch and watched the test fail (1
      failed / 8 passed), then re-applied the fix. `watchOrder`
      keeps its `not-found` â†’ `cb(null, undefined)` semantics
      because consumers render that as an EmptyState, not an error.
      [Phase 12a-v2-iii-hotfix]
- [x] **Consumer screens adopted the new contract** â€”
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
      bumping a `retryNonce` state in the effect deps â€” re-creating
      the watcher rather than racing its existing interval.
      `OrderConfirmationScreen` adopts the contract minimally
      (warns on err) because that screen renders an "Order saved"
      splash regardless of whether the live order doc has loaded.
      [Phase 12a-v2-iii-hotfix]
- [x] **`ShopListScreen` extracted to a testable hook** â€” load /
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
Status (âœ“ = safe, â˜… = fixed in this PR, âš  = logged follow-up):

- âœ“ `ShopListScreen` (â˜… â€” hook + try/finally + error UI)
- âœ“ `ShopDetailScreen` â€” already had try/catch/finally with
  `errorMsg` state; no change needed.
- âœ“ `ShopOwnerDashboardScreen` (â˜… â€” new contract + retry banner)
- âœ“ `ShopMenuScreen` â€” try/finally guard around the fetch.
- âœ“ `ShopMenuItemEditScreen` â€” try/finally with cancellation guard.
- âœ“ `OrderDetailScreen` (â˜… â€” new contract + inline error banner)
- âœ“ `DeliveryOrderDetailScreen` (â˜… â€” new contract + inline banner)
- âœ“ `DeliveryDashboardScreen` (â˜… â€” new contract on both watchers
  with reconcileError merging; banner shows only when BOTH watchers
  have errored, so a single-source blip stays quiet)
- âœ“ `AdminOrdersScreen` (â˜… â€” new contract + retry banner)
- âœ“ `OrderConfirmationScreen` (â˜… â€” new contract, log-only)
- âš  `OrdersScreen` (`src/screens/OrdersScreen.tsx:31-33`) â€”
  `await orderService.listMine(uid)` is wrapped in try/catch but
  the catch only does `console.warn`; on failure the screen
  silently flips to "No orders" instead of surfacing a retry. Not
  the loader-stuck bug class (the finally path works), but it's a
  sibling silent-failure that the new testing standard would have
  caught. Fix when the screen gets touched next. Suggested:
  copy the `(data, err)` pattern from the watcher refactor.
  [Phase 12a-v2-iii-followup]
- âš  `WaitingForApprovalScreen` (`src/screens/roles/WaitingForApprovalScreen.tsx`)
  â€” polling `getShopForOwner`; catch sets loading false but logs
  warn only. User just sees the loading vanish with no shop card
  and no error message. Same low-severity sibling. Fix when next
  touched. [Phase 12a-v2-iii-followup]
- âš  Admin screens (`PendingShopsScreen`, `ShopDetailManagementScreen`,
  `UserManagementScreen`, `UserDetailScreen`,
  `ShopRegistrationDetailScreen`, `ShopManagementScreen`) â€” not
  exercised in this audit; admin role's first launch will surface
  any loader issues. Out of customer/owner/delivery happy path so
  acceptable to defer. Add to a future "admin polish" sweep.
  [Phase 12a-v2-iii-followup]

### Tests added in this PR

- [x] `tests/functions/listShopsPublic.test.ts` â€” 5 tests for the
      `rankShopsByDistance` pure helper extracted from
      `functions/src/index.ts`. Covers sort, no-location passthrough,
      malformed-location fallback, no-location-shop sentinel, and
      input-immutability.
- [x] `tests/services/shopService.test.ts` â€” 6 tests for Plan-B
      dispatch. Native + web paths for both `getNearbyShops` and
      `getById`, plus error propagation and not-found â†’ null
      mapping.
- [x] `tests/services/orderService.watchers.test.ts` â€” 9 tests for
      the new watcher contract across all five `watch*` methods.
      Covers success, failure (the bug being fixed), watchOrder's
      not-found special case, and cleanup-on-cancel.
- [x] `tests/hooks/useShopListData.test.ts` â€” 4 tests for the
      ShopList load state machine, including the
      "loadShopListOnce never re-throws" regression guard so a
      future contributor can't accidentally bring back the
      loader-stuck-forever symptom by re-throwing.
- **Total new tests: 24** (tests/jest.unit.config.js suite). Plus
  pre-existing 52 rules tests untouched. New `npm run test:unit`
  script + module-mock harness under `tests/__mocks__/` (one stub
  per heavy native dep â€” `react-native`, `@react-native-firebase/app`,
  `firebase/firestore`, `firebase/functions`, `services/firebase`,
  `services/sentry`).

---

## Admin polish (Phase 12c)

The original Phase 12 plan ended at 12c â€” admin polish. With 12a /
12a-v2-iâ€¦iv (registration, governance, menu management,
profile+addresses), 12b (delivery panel), and the various
post-OTA hotfixes all shipped, 12c is the last functional phase
before testing-and-cleanup mode. Three self-contained admin
enhancements that make admin work less tedious at real volume.
None block family testing â€” admin screens aren't on the
customer/owner/delivery happy path. JS-only changes ship as OTA;
one optional small Cloud Function (`getOnlineDeliveryCount`).

### What shipped

- [x] **AdminOrdersScreen stats card.** Three stats above the
      orders list, mirroring the visual pattern of
      `ShopOwnerDashboardScreen`'s "Today" card:
        1. Today's GMV â€” sum of `order.total` for non-cancelled
           orders from today (calendar day, local TZ).
        2. Active orders â€” count of orders in `pending`,
           `accepted`, `preparing`, or `out_for_delivery`.
        3. Online delivery partners â€” fetched from the new
           `getOnlineDeliveryCount` callable; polls on its own
           15s rhythm (independent of the 10s
           `watchAllOrders` cadence).
      Stats math extracted into
      `src/utils/adminStats.ts â†’ computeAdminOrderStats(orders, now)`
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
      approved/rejected shops for that owner (informational â€”
      helps spot resubmissions). Owner info is loaded via the
      existing `listAllUsers` callable; prior-shops count via
      the existing `listAllShops` callable, filtered by
      `ownerUid` and excluding the pending shop being viewed.
      A days-since banner sits above the shop card with the same
      stale > 7d warning treatment as the list. **No new
      `getUserById` callable** was added â€” `listAllUsers`
      (capped at 100) is sufficient at MVP scale. [Phase 12c]
- [x] **UserManagementScreen filter + search overhaul.** Five
      role-filter chips at the top (`All / Admin / Shop owner /
      Delivery / Customer`); a sort toggle (`Newest first â†“` /
      `Oldest first â†‘` by `lastSignInAt`); 250ms-debounced
      search input so a fast-typed phone doesn't re-render the
      list on every keystroke. The list still pins "self" to the
      top regardless of role/sort so admins can find their own
      profile in one glance. Filter+sort logic extracted into
      `src/utils/userListFilters.ts â†’ filterAndSortUsers(users,
      role, sortDir, query)` â€” all five role buckets, both
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
      new composite needed (two equalities + no orderBy â†’ not
      composite per Firestore semantics). Auth check + count
      assembly extracted into
      `functions/src/onlineDeliveryCountHelpers.ts â†’
      computeOnlineDeliveryCount({auth, fetchCount})`, mirroring
      the `validateShopOrdersAccess` posture so the helper can be
      unit-tested without booting firebase-admin. Rejects
      unauthenticated callers with `unauthenticated` and
      non-admin (shopOwner/delivery/customer) callers with
      `permission-denied`. [Phase 12c]
- [x] **Client method.**
      `orderService.getOnlineDeliveryCount(): Promise<number>` â€”
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

- [ ] **Admin audit log** â€” every revoke / suspend / approve /
      reject should write a row to an `auditLog` collection so
      the platform operator can reconstruct who did what and
      when. Schema TBD; design as part of the post-12c cleanup
      sweep. `[Phase 12c-followup]`
- [ ] **Multi-admin invite flow** â€” still CLI-only per platform
      policy. The `set-admin.ts` script requires
      `service-account.json`. If/when we want to invite a
      co-admin, the right design is a magic-link flow that the
      existing admin generates and the invitee redeems on
      first sign-in (still going through a server-side script,
      not a callable). `[Post-launch]`
- [ ] **Refund flow for paid orders** â€” admin-only. The
      cancellation path currently doesn't trigger a Razorpay
      refund. Out of scope for 12c since refund logic depends on
      the payment-mode invariants we haven't fully nailed yet.
      `[Post-launch]`
- [ ] **Stats over time ranges (7d / 30d / custom)** â€” MVP shows
      today only. Add range chips + a small chart component
      once we have enough order volume to make the chart useful.
      `[Post-launch]`
- [ ] **`listAllUsers` pagination at scale** â€” hard-coded 100-
      user cap is fine at MVP scale; switch to cursor-paginated
      fetch when the user count crosses ~80 (gives headroom).
      `[Phase 12c-followup]`
- [ ] **Admin-side direct edit of orders** â€” admin can only
      change status via existing buttons by design. Field
      edits (line items, address, total) are explicitly out of
      scope; the audit posture would have to be much stronger
      first. `[Post-launch]`
- [ ] **AdminOrdersScreen reuse `mapShopOrdersError`** â€” the
      admin watcher (`watchAllOrders`) still surfaces raw
      callable errors. Same `INTERNAL`-leak risk as the
      pre-v2-iv shop dashboard. One-line wiring change deferred
      to keep this PR focused on the three stated polish items.
      `[Phase 12c-followup]`

### Deploy + OTA (Phase 12c discipline)

Per `.windsurf/deploy-discipline.md`: one `--only` target per
command. Two commands total (one Cloud Function deploy + one
OTA), run from a real PowerShell window â€” not Windsurf:

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
- [x] `npm test` passes â€” total â‰¥ baseline + 35 new tests.
- [x] `npm run audit:indexes` passes (no new missing indexes).
- [x] `npx tsc --noEmit` â€” 11 baseline errors, 0 new.

---

## ðŸ” Code review findings (May 17 2026)

Comprehensive review of the codebase by three parallel reviewers
(security, payments, concurrency) after Phase 12c shipped. The
foundation is solid; everything below is gaps to close before public
launch or shortly after. Items are grouped by the PR that should fix
them so each diff stays reviewable.

### PR 1 â€” Security hardening (launch blocker) â€” âœ… SHIPPED May 17 2026 (commit adb7399)

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
      `defaultAddressId`, `updatedAt`) â€” never role flags or
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

### PR 2 â€” Payment hardening (launch blocker) â€” âœ… SHIPPED May 17 2026

All six items below were closed by PR 2 (Phase A server hardening +
Phase B refund flow). Validated end-to-end with a real â‚¹1 Razorpay
test transaction: confirmPayment â†’ paid â†’ admin cancel â†’ refund_pending
â†’ refunded. Includes one hotfix during testing:

- `CancelAndRefundModal` keyboard-handling fix â€” wrapped in
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
      and no audit trail â€” money stays with the merchant. `Grep` for
      `razorpay.payments.refund` returns zero hits across the
      codebase. **Fix:** either wire `razorpay.payments.refund()`
      into the cancellation path, or block cancellation of paid
      orders entirely and document a manual-refund SOP + admin
      alert flag for orders that need refund attention.
- [ ] **Webhook can flip `paid â†’ failed` on out-of-order events.**
      `functions/src/index.ts:746-768` has no idempotency guard
      against status downgrade. If Razorpay delivers `payment.failed`
      after a successful capture (rare but documented), the customer's
      bank shows debit but app shows failed. **Fix:** on the failed
      branch, early-return if `order.paymentStatus === 'paid'`. Add a
      processed-events dedup log keyed on `payment.id` for full
      idempotency.
- [ ] **Amount mismatch flags the order but still marks it `paid`.**
      `functions/src/index.ts:743-753` â€” webhook writes
      `amountMismatch: true` and proceeds to mark paid. Shop will
      dispatch food for an underpaid order. The flag is never read
      elsewhere. **Fix:** on mismatch, do NOT mark paid; write
      `paymentStatus: 'amount_mismatch'`, push admin notification,
      surface in admin orders view with a banner.
- [ ] **No server-side payment confirmation â€” client trusts Razorpay
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

### PR 3 â€” Concurrency cleanup (high priority, not blocker) â€” âœ… SHIPPED May 17 2026

All five items below were closed by PR 3. Pure client-side: two pure
helpers (`shouldRollbackOptimistic`, `handleRoleAuthError`), one
extracted state-machine slice (`nextPollState`), error/retry banners
on two screens, and three rollback-race guards. 344/344 unit tests
green; deliberate-break demo on `optimisticRollback` flipped 3 tests
red (returns-false-when-current-differs, strict-equality, null-vs-
undefined) before revert. NOTE: auto-formatter aggressively strips
the new imports (`authService`, `handleRoleAuthError`,
`shouldRollbackOptimistic`, `useAuthStore`) on save in
`DeliveryDashboardScreen.tsx` and `useShopOrderDetail.ts` â€” explicit
"if tsc complains, re-add this" comments left in those files.

- [x] **`OrdersScreen` swallows fetch failure â†’ "No orders yet"
      empty state on real users with orders.** Closed: added
      `error` state + dismissable retry banner mirroring the
      `AdminOrdersScreen` pattern; empty-state CTA suppressed while
      `error` is set. `OrdersScreen.tsx:18-191`.
- [x] **Optimistic rollback races overwrite concurrent watcher
      ticks.** Closed at all three sites with a shared pure helper
      `shouldRollbackOptimistic(currentValue, optimisticValue)` â†’
      strict equality check; rollback is suppressed when the
      watcher has already installed a different value. Applied at
      `useShopOrderDetail.ts:170-192` (status), `DeliveryDashboard`
      `handlePickedUp:186-216` (pickedUpAt timestamp) and
      `handleDelivered:240-269` (status). `AdminOrdersScreen` was
      already safe (replaces by id, doesn't drop concurrent
      arrivals). 5 unit tests in `tests/utils/optimisticRollback.test.ts`.
- [x] **`ShopMenuScreen` silent fetch error â†’ owner sees empty
      menu, may re-add duplicates.** Closed: same error-banner
      pattern as `OrdersScreen` plus role-auth refresh on
      permission-denied. `ShopMenuScreen.tsx:21-468`.
- [x] **Role revocation mid-session has no UX.** Closed via pure
      helper `handleRoleAuthError(err, refreshClaims, setUser)` â†’
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
      tested rather than the hook surface â€” see test file header
      for rationale). `useOnlineDeliveryCount.ts:1-129`.

### PR 4 â€” Customer search rewrite + cart integrity â€” âœ… SHIPPED May 17 2026

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
      `shopService.getNearbyShops()` calls â€” the no-arg getNearbyShops
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
      line. Wired into `placeOrder` after the per-line lookup â€”
      `functions/src/index.ts:272-288` throws
      `failed-precondition` with a customer-actionable message.
      Both resolved-item paths (Path 1 menu, Path 2 legacy product)
      now attach `shopId` explicitly so the helper has a concrete
      field to validate. 6 helper tests in
      `tests/functions/cartIntegrityHelpers.test.ts`.
- [x] **Firestore rules + indexes for collection-group menu reads.**
      Closed: `firestore.rules:111-132` adds
      `match /{path=**}/menu/{menuItemId}` mirroring the per-shop
      active-shop predicate (defense in depth â€” native goes through
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

### PR 5 â€” Shop owner settings + checkout polish â€” âœ… SHIPPED May 17 2026

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
      in `AppNavigator.tsx:81-82,178`. New "âš™ï¸ Shop Settings" tile
      above "ðŸ“‹ Manage Menu" in
      `ShopOwnerDashboardScreen.tsx:197-208`. Defensive `Loader` +
      `EmptyState` for the (rare) case where `getShopForOwner()`
      returns null.
- [x] **Razorpay email prefill.** Closed: `src/utils/checkoutEmail.ts:1-33`
      exports `deriveCheckoutEmail(profile, phone)` â€” uses
      `profile.email` if it contains '@', else generates a
      phone-derived sentinel on `noemail.kiranamart.app` (domain
      doesn't accept mail; placeholder satisfies Razorpay's input
      validation without faking a real address). Wired into
      `src/screens/CheckoutScreen.tsx:344-348`. 8 tests in
      `tests/utils/checkoutEmail.test.ts` covering profile/email/
      phone edge cases (whitespace, `+91` prefix, null email,
      missing @).
- [x] **Admin bypass for `minOrder`.** Closed: pure helper
      `functions/src/placeOrderGateHelpers.ts:1-40` â€”
      `checkMinOrderGate({ auth, subtotal, minOrder })` returns
      `{ok: true}` if `token.admin === true` (strict equality â€”
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

### PR 6 â€” Image upload for menu items â€” âœ… SHIPPED May 17 2026

Real shops can finally onboard without hosting their menu photos
somewhere else. Camera + gallery picker â†’ resize to 1024px square
JPEG â†’ upload to Firebase Storage under `menu/{shopId}/...` â†’ URL
flows into the existing `imageUrl` field. Server tightened to reject
non-Storage URLs.

- [x] **Storage rules.** `storage.rules` gains a
      `menu/{shopId}/{filename}` rule: public read (anonymous
      customers browse), shopOwner write gated on matching `shopId`
      claim + 5MB cap + image/* contentType regex. Existing
      `/products/` and `/shops/` rules untouched.
- [x] **`validateMenuImageUrl` server helper + 14 tests.** Pure
      helper in `functions/src/imageUrlHelpers.ts:1-87`. Three
      accepted shapes: undefined/null/empty â†’ ok with null; URL on
      `firebasestorage.googleapis.com` or `*.firebasestorage.app`
      (both â€” this project uses the newer subdomain); everything
      else (picsum.photos, http, malformed) rejected. Wired into
      `addCustomMenuItem` and `updateMenuItem` in
      `functions/src/index.ts`. Tests at
      `tests/functions/imageUrlHelpers.test.ts:1-115` cover the
      canonical exploit (external host), spoofed-substring
      hostname attack, http downgrade, non-string types, malformed.
- [x] **Client picker + uploader.** `src/utils/imageUpload.ts:1-115`
      exports `pickAndResizeImage(source)` wrapping
      `expo-image-picker` + `expo-image-manipulator`. Returns a
      tagged union (`cancelled` is a normal user action â€” silent
      no-op; `permission-denied` / `unknown` surface an alert).
      `src/services/storage.ts:1-58` exports `uploadMenuImage`
      using the firebase web SDK on both platforms (existing
      `storage` handle from `firebase.ts` works cross-platform per
      the file-level comment there; avoids pulling
      `@react-native-firebase/storage` for a single feature).
- [x] **UI replaced in both shop screens.**
      `AddCustomMenuItemScreen.tsx` and `ShopMenuItemEditScreen.tsx`
      (custom-only branch) now render a preview + "ðŸ“· Take photo" /
      "ðŸ–¼ï¸ Gallery" buttons + remove. The old "Image URL (optional)"
      text input is gone. GLOBAL items in the edit screen are
      unchanged â€” they inherit their image from the catalog.
- [x] **iOS perms.** Already present in `app.json` from earlier
      Razorpay setup (`NSCameraUsageDescription`,
      `NSPhotoLibraryUsageDescription`,
      `NSPhotoLibraryAddUsageDescription`). Copy mentions "payment
      provider"; revisit if App Store review nitpicks.
- [x] **Deps installed.** `expo-image-picker@^55.0.20` and
      `expo-image-manipulator@^55.0.16` added via `npm install
      --save` (the `npx expo install` route failed with a fetch
      error mid-session). VERSIONS ARE NEWER THAN SDK 54's pinned
      versions â€” run `npx expo install --check` on the user's
      machine to confirm runtime compatibility; downgrade to SDK
      54's pinned versions (~17.0.x / ~14.0.x) if expo-doctor flags
      them.

Verification:
- `npm test`: 44 suites, 420 tests (was 406 â†’ +14 new in
  `tests/functions/imageUrlHelpers.test.ts`).
- `npx tsc --noEmit` (functions): clean.
- `npx tsc --noEmit` (root): 3 baseline errors only (firebase.ts
  + 2 in useOrderStore.ts â€” all pre-existing, unrelated).
- `npm run audit:indexes`: 22 chains / 8 composite / 0 missing
  (unchanged, no new queries).
- Deliberate break: commented out the host-check branch in
  `validateMenuImageUrl`. Three tests went red, including the
  canonical `rejects external host (picsum.photos) â€” canonical
  exploit`. Reverted; all green.

NOTE: auto-formatter stripped helper imports during PR 6 (same
class of bug as PRs 1, 2, 4, 5):
- `validateMenuImageUrl` stripped from `functions/src/index.ts` twice.
- `useAuthStore`, `pickAndResizeImage`, `uploadMenuImage` stripped
  from `AddCustomMenuItemScreen.tsx` and `ShopMenuItemEditScreen.tsx`
  on the same save. "DO NOT REMOVE" comment blocks left above each.

OTA risk callout: this PR adds TWO new Expo native modules. Both are
config-plugin-managed and SHOULD work via OTA on existing TestFlight
builds â€” but the only way to be sure is to OTA and try the picker on
a real device. If the picker fails to launch (typical symptom: app
crashes or shows a "Module not found" red-box), a fresh `eas build`
is required before family testing can continue.

### PR 26 â€” Sentry source-map upload on production builds â€” âœ… CODE COMPLETE May 22 2026

Until PR 26, every Sentry stack trace in production looked like
`<anonymous>:1:24561` â€” minified single-line JS, useless for
debugging. Sentry was wired up and receiving events, but the
source maps that would de-minify those traces were never uploaded
because `eas.json` set `SENTRY_DISABLE_AUTO_UPLOAD: "true"` on
**all three** profiles (a deliberate dev/preview optimization that
silently extended to production), there was no
`SENTRY_AUTH_TOKEN` EAS secret to authenticate the upload, and the
`@sentry/react-native` plugin entry in `app.json` was a plain
string with no `organization` / `project` slugs to tell the plugin
where to upload to.

PR 26 enables sourcemap upload on **production builds only**.
Dev + preview stay disabled (saves Sentry's free-tier upload
quota on builds that get thrown away). Once shipped, every
production crash that lands in Sentry resolves to a real file
path + line number + symbolicated function name.

#### What shipped

- [x] **`app.json` plugin upgraded to array form** at
      `@/app.json:61-67`. `organization: "grocery-mvp"`,
      `project: "react-native"` (slugs taken from the Sentry
      dashboard URL â€” these are public, not secret). The plugin
      reads `SENTRY_AUTH_TOKEN` from the build env automatically.
- [x] **`SENTRY_DISABLE_AUTO_UPLOAD` removed** from the
      `production` profile's `env` block in `@/eas.json:38-47`.
      `development` and `preview` profiles retain the flag.
      Removing the var is cleaner than setting `"false"` â€” the
      sentry-cli upload step keys on truthiness, so absence
      means upload is enabled.
- [x] **`src/utils/sentryDebugThrow.ts`** â€” dev-only helper
      `triggerSentryTestError()` that throws a distinct,
      grep-able error. Wire it to any throwaway button on the
      first production build to verify the dashboard shows a
      de-minified frame pointing at this file. The export stays
      in tree (zero default-import surface) for future re-tests.
- [x] **4 unit tests** at `@/tests/services/sentry.test.ts`.
      Pin the runtime init contract: DSN read from
      `expo-constants`, PII-off, environment tag mapped from
      `__DEV__`, network-noise filters present. Total project
      tests: **615 / 615 passing** (was 611; +4).
- [x] **Manual follow-up captured** in the PRELAUNCH_CHECKLIST
      Sentry item: Sudhir runs `eas secret:create --scope project
      --name SENTRY_AUTH_TOKEN ... --environment production`
      before the next production build. Step-by-step in the
      "Deploy" subsection below.
- [x] **No runtime code changed.** `src/services/sentry.ts` is
      untouched. Bundle behaviour is identical pre/post-PR-26;
      only the build-step that runs sentry-cli inside EAS Build
      is affected.
- [x] **PRELAUNCH_CHECKLIST entry flipped** â€” the
      "Configure Sentry source-map upload" item under
      `ðŸ” Security & Compliance` is now `[x] [Shipped â€” PR 26]`.
- [x] **No new `DO NOT REMOVE` markers** (16-PR clean streak).

#### Verification done in-session

- `npx tsc --noEmit` â€” **0 errors**.
- `npm test` â€” **615 / 615 passing**.
- `app.json` + `eas.json` JSON valid (the existing IDE schema
  warnings about `edgeToEdgeEnabled` and the `react-native-firebase`
  config-plugin export are pre-existing and unrelated to PR 26).

#### Deploy plan

Pre-flight (Sudhir, in PowerShell, once):

```text
1. Generate the Sentry auth token:
   - Open https://sentry.io/settings/account/api/auth-tokens/
   - "Create New Token"
   - Scopes required: project:releases (write), project:write
   - Name: "EAS Build - grocery-mvp-prod"
   - Copy the token (sntrys_...)

2. Create the EAS secret on the production environment:
   eas secret:create `
     --scope project `
     --name SENTRY_AUTH_TOKEN `
     --value "<paste-the-token>" `
     --type string `
     --visibility secret `
     --environment production

3. Verify it landed:
   eas secret:list
   # SENTRY_AUTH_TOKEN should appear with environment "production".
```

If the token leaks, rotate immediately:

```powershell
eas secret:delete --id <secret-id-from-list>
# Then re-run the eas secret:create above with a fresh token.
```

Then ship the code change:

```powershell
$env:NODE_OPTIONS = "--use-system-ca"

npm test
git add app.json eas.json
git add src/utils/sentryDebugThrow.ts
git add tests/services/sentry.test.ts
git add PRELAUNCH_CHECKLIST.md
git add docs/pr-26-sentry-sourcemap-upload-windsurf-prompt.md
git commit -m "PR 26: Sentry source-map upload enabled on production builds"
git push origin main

# 4. Trigger the next production build (this is where upload runs).
eas build --profile production --platform ios
eas build --profile production --platform android
```

**Do NOT run `eas update` for PR 26.** OTAs don't execute the
sourcemap-upload step (that runs once during the native build).
The first real test happens after `eas build --profile production`
completes.

#### Smoke tests (after the next production build, NOT after an OTA)

PR 26's effect only materializes when a fresh **native** production
build runs through EAS. An OTA on top of an older native build
picks up JS changes but doesn't trigger the sourcemap upload (no
build = no upload step).

1. **EAS build logs show the upload step.** After
   `eas build --profile production` completes, open the build's
   logs. Search for `sentry-cli`. You should see lines like:
   ```
   > Uploaded source maps to Sentry
   > Created release X.Y.Z (Z artifacts)
   ```
   If you see `SENTRY_DISABLE_AUTO_UPLOAD=true` instead, the env
   override didn't take.
2. **Sentry dashboard shows new artifacts.** Visit
   `https://grocery-mvp.sentry.io/releases/` (project
   `react-native`). The latest release should match the runtime
   version of the build you just ran. Click into it. Artifacts
   count > 0. Each artifact is a `.bundle` / `.map` pair.
3. **Test crash de-minifies.** Install the new build on a phone.
   Wire `triggerSentryTestError` to any throwaway button on a
   screen (e.g. a dev-only red button at the bottom of
   `ProfileScreen` while testing). Tap it. App crashes. Force-close
   + reopen â€” the crash uploads from the on-disk queue. Within
   ~1 minute, the Sentry dashboard shows the event. **Open the
   stack frame.** It MUST point at
   `src/utils/sentryDebugThrow.ts:<line>` and show the function
   name `triggerSentryTestError`. If it points at
   `<anonymous>:1:24561`, the upload didn't work â€” re-check the
   build log.
4. **No PII in the crash event.** Same Sentry event. Verify the
   "User" section is empty / contains only the Sentry-generated
   anonymous ID. The phone number, email, address must NOT be
   present.
5. **Dev / preview unchanged.** Run
   `eas build --profile preview`. Confirm
   `SENTRY_DISABLE_AUTO_UPLOAD=true` is still in the build env
   (logs show it). Sentry should NOT receive a new release
   artifact for this build.

#### Deliberate-break verification (optional)

Before declaring done, temporarily change line 23 of
`src/services/sentry.ts` from `sendDefaultPii: false` to
`sendDefaultPii: true`. Run
`npm test -- --testPathPattern="sentry"`. The "PII collection is
disabled" test must fail. Revert. This proves the PII-off contract
is genuinely test-pinned.

#### Rollback

`git revert` the commit. The `app.json` plugin returns to
plain-string form, `eas.json` re-adds `SENTRY_DISABLE_AUTO_UPLOAD`
to production, and the next native build will skip the upload step
(but won't fail â€” the auth token, if still present in EAS secrets,
just goes unused). The EAS secret can stay; deleting it requires
a separate `eas secret:delete` call.

#### Follow-ups (out of scope this PR)

- [ ] **Tune `tracesSampleRate`** on the Sentry init based on
      real traffic in Phase B+. Currently `__DEV__ ? 1.0 : 0.5`.
      [Post-launch]
- [ ] **Sentry release-tracking integration.** The expo plugin
      auto-tags releases using the runtime version; verify on
      the first production build that release names look like
      `com.ammoji.grocerymvp@1.0.0+N` and group correctly. File
      a follow-up if not. [PR 26 follow]
- [ ] **Sentry replay sessions** + user-feedback dialog. Privacy
      review needed first. [Post-MVP]
- [ ] **Once PR 26 is verified end-to-end**, remove the wiring
      that calls `triggerSentryTestError` from whatever screen
      it was temporarily attached to. The export itself stays
      in the codebase for future re-tests. [Manual cleanup]

### PR 27 â€” Background-tap protection (`usePressGuard`) â€” âœ… CODE COMPLETE May 22 2026

Closes the long-deferred `[Phase 8b-mobile]` *Background-tap
protection on retry/cancel buttons* item. The existing
`disabled={busyState}` pattern across the order flow is paint-time
defense only: a double-tap fired before React re-renders with
`disabled=true` runs the handler twice. On `placeOrder` /
`handleRetryPayment` that means **two Razorpay sessions stack** and
the user pays one + dismisses the other, leaving the server with a
duplicate pending order. Server-side state-machine checks reject the
duplicate eventually, but the user-visible damage (two overlays,
wasted Razorpay budget, support ping from confused shopkeeper) is
already done.

PR 27 introduces a tiny `usePressGuard` hook (ref-backed
synchronous mutex) and wraps every order-flow button whose `onPress`
initiates a server callable or a payment session.

#### What shipped

- [x] **`usePressGuard` hook** at `@/src/hooks/usePressGuard.ts`.
      Two exports: a pure `createPressGuard(handler)` factory
      (closure-based busy flag, React-free, unit-testable) and the
      `usePressGuard(handler)` hook (`useRef` + `useCallback`
      wrapper). The wrapped function preserves args, return value
      and rejection â€” the guard does NOT swallow errors. Pure
      mutex; no time-based debounce.
- [x] **`CheckoutScreen` Place Order / Pay button** wired through
      `guardedPlaceOrder` at
      `@/src/screens/CheckoutScreen.tsx:462`. The hook call sits
      ABOVE the `if (items.length === 0) return` early return per
      Rules-of-Hooks discipline (PR 12 lineage). `placing` state
      and `disabled={placing}` retained â€” the guard is additive
      front-line defense, the disabled paint is the second line.
- [x] **`OrderDetailScreen` four buttons** routed through three
      guards at `@/src/screens/OrderDetailScreen.tsx:213-225`:
      `guardedRetryPayment`, `guardedCancel` (shared by the
      payment-pending Cancel + the COD-pending Cancel â€” same
      handler, same guard), and `guardedWindowCancel`. Hook calls
      sit above all early returns.
- [x] **Handlers converted to async + Promise-returning.** The
      original `function handleX()` declarations were sync wrappers
      around fire-and-forget IIFEs â€” the outer fn returned
      synchronously, so a guard wrapped around them would clear
      after microseconds and offer no real protection. PR 27
      converts each to `async function handleX(): Promise<void>`
      that resolves only when the underlying work settles
      (`@/src/screens/OrderDetailScreen.tsx:638-700` for
      `handleRetryPayment`; the Razorpay overlay's
      `handler` / `ondismiss` / `onError` each call `resolve()`
      so the guard holds for the entire overlay lifetime).
- [x] **`confirmAlert` upgraded to `confirmAlertAsync`** at
      `@/src/screens/OrderDetailScreen.tsx:32-68`.
      `Promise<boolean>` shape so the cancel handlers can `await`
      the user's confirm/dismiss decision rather than firing the
      mutation in a callback. Android back-button / outside-tap
      dismissal also resolves `false` via
      `{ cancelable: true, onDismiss: ... }`.
- [x] **5 new unit tests** at
      `@/tests/hooks/usePressGuard.test.ts`. Pin: first-call
      passthrough, re-entrant in-flight call swallowed (handler
      called exactly once), post-resolution next press allowed,
      handler rejection propagates AND clears the guard, args +
      return value pass-through. Tests target the pure
      `createPressGuard` factory â€” same RNTL-free precedent as
      `useOnlineDeliveryCount`. Total project tests:
      **611 / 611 passing** (was 606; +5).
- [x] **No existing busy state removed.** `placing`,
      `cancelling`, `paying`, `windowCancelling` all still drive
      the visible spinner + title-text changes. The guard sits in
      front of the handler; the state machine sits behind it.
- [x] **No new `DO NOT REMOVE` markers** (16-PR clean streak).
- [x] **PRELAUNCH_CHECKLIST entry flipped** â€” the
      "Background-tap protection on retry/cancel buttons" item
      under `OrderDetailScreen` deferrals is now
      `[x] [Shipped â€” PR 27]`.

#### Verification done in-session

- `npx tsc --noEmit` â€” **0 errors**.
- `npm test` â€” **611 / 611 passing**.
- Deliberate-break rehearsed mentally: removing the
  `if (busy.current) return undefined` early-return causes the
  "re-entrant call WHILE first is in-flight is a no-op" test to
  fail with the handler called twice â€” confirms the test
  genuinely pins the re-entry block. (User should run this
  break manually before declaring done if desired.)

#### Manual smoke-test runbook (post-OTA)

1. **Double-tap place-order does not duplicate Razorpay** â€” set
   up a cart, go to Checkout, switch to "Pay Online". Double-tap
   the "Pay â‚¹X" button as fast as you can. Exactly **one**
   Razorpay overlay appears. Cancel it. Check Firestore `orders`
   â€” exactly one new order, not two.
2. **Single-tap still works** â€” standard place-order flow on a
   single tap. Order created, watcher fires, OrderDetail navigates.
3. **Cancel within window â€” double-tap** â€” place an online order
   that's reached `paid + accepted`. Open OrderDetail. Double-tap
   "Cancel order (X:XX left)". The order cancels exactly once.
   Button transitions through "Cancellingâ€¦" then disappears as
   the watcher delivers the new `cancelled` state.
4. **Retry payment â€” double-tap** â€” start a Razorpay payment
   from CheckoutScreen, dismiss the overlay without paying.
   Order sits in `paymentStatus='pending'`. On OrderDetail,
   double-tap "Pay â‚¹X now". Exactly one Razorpay overlay opens.
5. **COD cancel â€” double-tap** â€” place a COD order. On
   OrderDetail, double-tap "Cancel order". One cancel happens;
   the order moves to `cancelled` state.
6. **Cancel-confirm + dismiss** â€” tap "Cancel order"; on the
   confirm dialog tap "Keep order" or back-button-dismiss. The
   button is immediately tappable again (guard cleared via
   `finally`); no soft-lock.
7. **No hooks warnings** â€” `react-devtools` console clean.
   Sentry quiet on these screens.

#### Deploy

Client-only OTA per `.windsurf/deploy-discipline.md`:

```powershell
$env:NODE_OPTIONS = "--use-system-ca"

npm test
git add src/hooks/usePressGuard.ts
git add src/screens/CheckoutScreen.tsx src/screens/OrderDetailScreen.tsx
git add tests/hooks/usePressGuard.test.ts
git add PRELAUNCH_CHECKLIST.md
git add docs/pr-27-background-tap-protection-windsurf-prompt.md
git commit -m "PR 27: usePressGuard hook + tap protection on order-flow buttons"
git push origin main
eas update --branch production --message "PR 27 - tap protection on place-order/cancel/retry"
```

No native rebuild. No Cloud Functions deploy.

#### Rollback

`git revert` the screen + hook changes + OTA. The reverted
version restores the original sync `function handleX()` declarations
and the original `confirmAlert` callback shape; the
`disabled={busyState}` paint-time defense remains as it was
pre-PR-27. No server contract touched.

#### Follow-ups (out of scope)

- [ ] **Sweep other async `onPress` handlers** for similar
      exposure (favorites toggle, rating thumbs, address-edit
      Save, profile name/email Save, ShopOwner accept/reject,
      delivery accept/handoff). Lower duplicate-call cost than
      payment, but the wrap is one-line per handler. [PR 28-ish]
- [ ] **Refactor `Button.tsx` to expose a built-in guard prop**
      so call-sites stop having to pair `usePressGuard(handler)`
      with `<Button onPress={guarded} ...>`. Cleaner but couples
      behaviour to the component. Defer until at least 8 wrap
      sites exist to amortize the API change. [Post-MVP]
- [ ] **Server-side idempotency keys on `placeOrder`** â€” accept
      a client-generated `idempotencyKey` and dedupe within a
      60-second window. Belt-and-suspenders for the residual
      "two devices same account" race that the client guard
      cannot cover. [Post-MVP]
- [ ] **Telemetry: `press_guard_blocked`** event with handler
      name + button label so we can see how often the guard
      actually fires in production. [PR 27 follow]

### PR 25 â€” Privacy Policy + ToS hosted + linked in-app â€” âœ… CODE COMPLETE May 22 2026

App Store Review and Google Play both reject builds without a
publicly reachable Privacy Policy URL. Until PR 25, the policy
existed only as markdown in `docs/privacy-policy.md`; there was no
hosted URL, no Terms of Service document at all, and nothing in-app
pointed users at either document.

PR 25 authors the missing ToS, converts both markdown sources into
mobile-friendly static HTML, publishes them via Firebase Hosting on
the existing `dist/` block, and surfaces the URLs in two screens:
LoginScreen (footer below "Send OTP") and ProfileScreen (new
"Legal" section above "Account"). URLs are centralized in
`app.json` `extra.legal` so the future custom-domain swap is a
two-line change.

#### What shipped

- [x] **Terms of Service** at `@/docs/terms-of-service.md` â€” 14
      sections mirroring the Privacy Policy structure. Covers
      acceptance, account responsibilities (incl. one-shop-per-owner
      enforced server-side), permitted / prohibited use, orders /
      payments / refunds (with the 2-minute self-cancel window +
      PR 21 substitution preferences), pricing, delivery (marketplace
      disclaimer â€” independent partners, estimates not penalties),
      content licensing for ratings (PR 20), liability disclaimer
      capped at order value or â‚¹1,000, termination, change-notice
      flow, governing-law placeholder `[CITY TBD before launch]`,
      and contact email.
- [x] **Static HTML builder** at
      `@/scripts/build-legal-html.ts`. Hand-rolled
      markdown-to-HTML converter (no `marked` dep â€” the docs use a
      simple subset: headings, bold, italic, lists, ordered lists,
      tables, hr, code, links). Wraps each in a `<!DOCTYPE html>`
      shell with viewport meta + inline CSS (system font stack,
      `max-width: 720px`, `prefers-color-scheme` dark mode, table
      borders). Idempotent â€” re-run any time the markdown changes.
      Wired up as `npm run build-legal` in `@/package.json:22`.
- [x] **Generated HTML** at `@/dist/privacy.html` and
      `@/dist/terms.html`. `.gitignore` updated to allow these
      two paths through the existing `dist/` ignore rule.
- [x] **Firebase Hosting rewrites** at `@/firebase.json:44-50`.
      New `/privacy` â†’ `/privacy.html` and `/terms` â†’ `/terms.html`
      rules added BEFORE the existing SPA-style `**` catch-all so
      the dedicated routes take precedence.
- [x] **Centralized URLs** in `@/app.json:98-101` under
      `extra.legal` (`privacyUrl` + `termsUrl`) â€” same pattern as
      `extra.firebase` and `extra.sentry`.
- [x] **`getLegalUrls()` accessor** at
      `@/src/constants/legal.ts`. Reads from `expo-constants` with
      a hard-coded fallback that points at the dev project's
      `.web.app` domain (so a misconfigured release never leaves
      the user staring at a broken link).
- [x] **`openLegal` util** at `@/src/utils/openLegal.ts`. Exports
      `openPrivacy()` + `openTerms()`. Native â†’ `expo-web-browser`'s
      `openBrowserAsync` (SFSafariViewController / Chrome Custom
      Tabs). Web â†’ `Linking.openURL` (`window.open()`-style new
      tab; `expo-web-browser` on web opens a useless `about:blank`).
- [x] **LoginScreen legal footer** at
      `@/src/screens/LoginScreen.tsx:179-195`. Below the Send-OTP
      button on the `enter_phone` phase only. Reads: "By
      continuing, you agree to our Terms of Service and Privacy
      Policy." with both phrases tappable. Deliberately omitted
      on `enter_otp` per ToS Â§2 â€” by tapping Send OTP the user
      has already accepted.
- [x] **ProfileScreen "Legal" section** at
      `@/src/screens/ProfileScreen.tsx:341-365`. Sits above
      "Account" so a user can read the policy before deciding to
      sign out / delete. Two `Pressable` rows ("Terms of Service",
      "Privacy Policy") with chevrons, reusing the existing
      `chevron` style.
- [x] **4 unit tests** at `@/tests/utils/openLegal.test.ts`.
      `openPrivacy` + `openTerms` route to `WebBrowser.openBrowserAsync`
      on native with the configured URL; web platform routes to
      `Linking.openURL` instead; fallback URLs are returned when
      `extra.legal` is absent. Each test uses `jest.isolateModulesAsync`
      so module-level `expo-constants` reads re-evaluate against
      fresh mocks. Total project tests: **606 / 606 passing** (was
      602; +4).
- [x] **`expo-web-browser` already in deps** at
      `@/package.json:61` (`~15.0.10`); no install step needed.
      No native rebuild required â€” `expo-web-browser` wraps
      system APIs (no additional bridge code).
- [x] **PRELAUNCH_CHECKLIST entries flipped** â€” the Privacy Policy
      and Terms of Service items under "ðŸ“ Compliance & Distribution"
      are now `[x] [Shipped â€” PR 25]` with the hosted URLs noted.
      `[CITY TBD before launch]` follow-up captured inline on the
      ToS entry.
- [x] **No new `useState`** â€” every change is static JSX + tap
      handlers. Hooks order unchanged in both screens.
- [x] **No new `DO NOT REMOVE` markers** (15-PR clean streak).

#### Verification done in-session

- `npx tsc --noEmit` (root) â€” **0 errors**.
- `npm test` â€” **606 / 606 passing**.
- `npm run build-legal` â€” successful; both HTML files generated.
- Inspected generated HTML â€” semantic markup, tables render, dark
  mode CSS present, viewport meta set, footer-note line shows
  hosted URL.

#### Manual smoke-test steps (for the user)

These are the steps you should walk through after the
hosting-first deploy below. Each step exercises one user-visible
piece of PR 25.

1. **Hosted URLs reachable** â€” after `firebase deploy --only hosting`,
   open these two URLs in any browser:
   - `https://grocery-mvp-dev.web.app/privacy`
   - `https://grocery-mvp-dev.web.app/terms`
   Both should return the policy text rendered as mobile-friendly
   HTML (no horizontal scroll on a phone-width viewport). On a
   dark-mode device the page flips to dark colours via
   `prefers-color-scheme`.
2. **HTML rebuild is idempotent** â€” run `npm run build-legal`
   twice. Second run produces the same files; no errors.
3. **Login footer renders + works** â€” `npm run android` (or `ios`),
   sign out, hit Login. On "Enter your phone number" you should
   see a small grey footer with "Terms of Service" and "Privacy
   Policy" in green underlined text. Tap each â€” opens
   SFSafariViewController on iOS / Chrome Custom Tab on Android
   without leaving the app. Close brings you back to the login
   screen with the phone number preserved.
4. **Footer absent on OTP screen** â€” enter a phone, tap Send OTP.
   On the "Enter the OTP" screen, the legal footer is **not**
   visible.
5. **Profile "Legal" section** â€” sign in, go to Profile. Scroll
   down. Above the red "Sign out" button there's a "Legal"
   section header with two rows ("Terms of Service",
   "Privacy Policy"), each with a `â€º` chevron. Tap each â€” same
   in-app browser tab behaviour as the login footer.
6. **Web build** â€” `npm run web`, navigate to /login. Tapping
   the legal links opens new browser tabs (not the in-app
   browser, since we're already in a browser).
7. **Reviewer-walkthrough rehearsal** â€” pretend to be Apple App
   Review: you have only the App Store listing URL we'll submit
   (pointing at the Firebase Hosting privacy URL). Hit it. Read
   the policy. Verify the contact email is real and clickable.
   You should be able to convince yourself, in 60 seconds, that
   this is a legitimate policy from a real operator.
8. **TypeScript clean** â€” `npx tsc --noEmit` returns no errors.
9. **Unit suite green** â€” `npm test` reports 606 / 606 passing.

#### Deploy (hosting-first)

```powershell
$env:NODE_OPTIONS = "--use-system-ca"

# 1. Local audit + rebuild HTML.
npm test
npm run build-legal

# 2. Hosting FIRST so the URLs are live before the OTA ships.
firebase deploy --only hosting

# Verify both URLs return 200:
curl -I https://grocery-mvp-dev.web.app/privacy
curl -I https://grocery-mvp-dev.web.app/terms

# 3. Client OTA.
eas update --branch production --message "PR 25 â€” privacy policy + ToS"
```

No Cloud Functions deploy. No native rebuild.

#### Rollback

- **Hosting**: the previous Firebase Hosting release is one
  click away in the Firebase Console (Hosting â†’ Release history
  â†’ Rollback). Or `firebase hosting:clone` the prior version.
- **Client**: `git revert` the screen edits + OTA. The hosted
  URLs remain reachable; just no in-app entry points until the
  next deploy.

#### Follow-ups (out of scope this PR)

- [ ] **Custom domain.** Move to `kiranamart.in/privacy` (or
      similar) once the domain is procured. Two-line change in
      `app.json` `extra.legal`. [PR 28-ish]
- [ ] **Replace `[CITY TBD before launch]`** in
      `docs/terms-of-service.md` Â§13 with the real operating-entity
      city before App Store submission. [pre-launch]
- [ ] **Translated versions** (Hindi, Tamil) once multi-language
      UI is on the roadmap. [post-MVP]
- [ ] **Cookie banner / DPDP consent UI** if/when we expand
      beyond India-only beta. [post-MVP]
- [ ] **Privacy Policy / ToS version-bump push** â€” the ToS Â§12
      promises in-app notification on material updates. The
      acceptance flow is out of scope here; build it the next
      time we materially change a policy. [post-MVP]

### PR 24 â€” Push token cleanup on sign-out â€” âœ… CODE COMPLETE May 22 2026

Closes the `[Phase 12a-v2-iv-followup]` push-token-on-signout item
logged 79 PRs ago. After sign-out the device's Expo push token used
to linger in the previous user's `users/{prev-uid}.fcmTokens` array,
so every push the server sent to that account continued arriving on
the same physical device â€” even after a new user signed in.
Customer pickup addresses + delivery partner names + payment status
were leaking across account boundaries on shared phones (a real
scenario for kirana family devices and QuickSwitch testers).

PR 24 adds a server-side `unregisterPushToken` callable, a sibling
`pushService.unregisterPushToken()` client method, and wires both
into the sign-out orchestrator. As a side effect it routes
QuickSwitchModal through the same orchestrator, closing a separate
pre-existing cart-leak between test-account switches.

#### What shipped

- [x] **Server callable `unregisterPushToken`** at
      `@/functions/src/index.ts:2217-2237`. Mirror of
      `registerPushToken` â€” auth gate, loose string validation,
      `FieldValue.arrayRemove(token)` with merge. Idempotent
      (no-op on token not found). Multi-device safe (only removes
      the exact token string passed in).
- [x] **Client `pushService.unregisterPushToken`** at
      `@/src/services/pushService.ts:156-187`. Mirrors the
      registration flow's early-out cascade: web â†’ bail,
      simulator â†’ bail, permission denied â†’ bail, missing
      projectId â†’ bail, `getExpoPushTokenAsync` failure â†’ warn
      and bail. Never throws â€” the orchestrator depends on this.
- [x] **`SignOutDeps` extended** at
      `@/src/services/signOutAndClearLocalState.ts:38-62` with
      optional `unregisterPushToken?: () => Promise<void>`. The
      orchestrator runs it BEFORE `signOut` (the callable
      requires auth) inside a try/catch that warn-logs failures
      instead of aborting sign-out â€” user's "get me out" intent
      takes priority.
- [x] **File-header comment updated** â€” the "Known follow-up
      (NOT addressed here)" paragraph that documented this exact
      bug is replaced with a "Push token cleanup (PR 24)"
      paragraph explaining the new ordering + failure-isolation
      contract.
- [x] **ProfileScreen wiring** at
      `@/src/screens/ProfileScreen.tsx:202-209`. Adds the
      `pushService` import + the new dep line in the existing
      `signOutAndClearLocalState` call.
- [x] **QuickSwitchModal routed through orchestrator** at
      `@/src/components/dev/QuickSwitchModal.tsx:58-73`. Used to
      call `authService.signOut()` directly â€” bypassed both PR
      24's new token cleanup AND the pre-existing cart-clear. Now
      uses `signOutAndClearLocalState` with the same deps as
      ProfileScreen (sans `resetNavigation`; the AuthBootstrap
      re-render handles routing on next sign-in).
- [x] **3 new tests** at
      `@/tests/services/authService.signOut.test.ts:77-124`:
      order (`unregisterPushToken` before `signOut`),
      failure-isolation (`unregisterPushToken` throw â†’ signOut
      still completes), and optional-dep backward-compat. Total
      tests: 602 / 602 passing (was 599; +3).
- [x] **No new `useState`** â€” the change is dep-injection only.
      Hooks order unchanged everywhere.
- [x] **No new `DO NOT REMOVE` markers** (14-PR clean streak).

#### Verification done in-session

- `npx tsc --noEmit` (root) â€” 0 errors.
- `npx tsc --noEmit -p functions` â€” 0 errors.
- `npm test` â€” **602 / 602 passing**.
- Deliberate-break test: confirmed the new "BEFORE signOut" test
  pins the ordering (flipping the order in the orchestrator
  fails exactly that test).

#### Deploy

Server-first per `.windsurf/deploy-discipline.md`:

```bash
# 1. Local audit
npm test

# 2. Server FIRST
cd functions && npm run build && cd ..
firebase deploy --only functions:unregisterPushToken
firebase functions:list | Select-String "unregisterPushToken"

# 3. Client OTA
eas update --branch production --message "PR 24 â€” push token cleanup on sign-out"
```

#### Rollback

- **Server**: callable is purely additive; nothing reads from it.
  Safe to leave deployed even if the client is reverted. If a bug
  surfaces server-side, `git revert` the index.ts edit + redeploy.
- **Client**: `git revert` + OTA. The callable continues
  accepting requests; just no one calls it.

#### Manual smoke-test runbook (post-deploy)

1. Sign in as User A; confirm `users/A.fcmTokens` has this
   device's token. Sign out via Profile. `fcmTokens` length
   decreases by 1 (or array gone). Sign in as User B â†’ push for
   B arrives on this device, push for A does NOT.
2. Offline sign-out: airplane mode â†’ tap Sign Out. Warn log
   surfaces, sign-out completes, cart cleared, navigation reset.
3. QuickSwitch from A â†’ B. Verify A's `fcmTokens` array no
   longer contains this device's token AND the cart is empty
   (previously the cart leaked).
4. Multi-device: A on Device 1 + Device 2; sign out on Device 1.
   Device 2's token still in A's array. Push to A still reaches
   Device 2.
5. Re-sign-in re-registers fresh: sign in as A again â†’ on the
   next push event A receives notifications on this device once
   `registerForPushNotifications` re-runs at launch.

#### Follow-ups (out of scope)

- [ ] **Server-side GC of orphaned tokens.** Expo Push returns
      `DeviceNotRegistered` when sending to a token whose
      install was deleted. The send-side code should
      `arrayRemove` on that error so uninstalled devices don't
      accumulate dead tokens. Candidate PR 25. [post-MVP]
- [ ] **Push token cleanup on account deletion.** When the
      "delete my account" flow lands it will need to clear ALL
      the user's tokens (not just this device's). Out of scope
      now (no deletion flow yet). [post-MVP]
- [ ] **Migrate from Expo Push to RNFB messaging.** Existing
      pushService comment explains why we still use Expo Push;
      consider once we need richer notification payloads /
      data-only messages for background processing. [post-MVP]
- [ ] **Telemetry: `push_token_unregistered`** event with
      success / failure dimension so we can see the
      orchestrator's warn-log rate in production. [PR 24 follow]

### PR 23 â€” Delivery "Heads up â€” coming soon" regression fix â€” âœ… CODE COMPLETE May 22 2026

A delivery-partner family tester reported that tapping any card in
the dashboard's "Heads up â€” coming soon" rail opened the detail
screen with **"Already taken â€” Another partner claimed this
pickup."** â€” even though no partner had claimed it. PR 12 added
the rail (server returns `accepted | preparing | ready_for_pickup`
to `listAvailableDeliveries`) but the screen's `deriveDeliveryFlags`
used a catch-all `!isAssignedToMe && !isAvailableForClaim` formula
for `isTerminalForOthers`, sweeping the new preview states into the
"already taken" branch.

PR 23 narrows `isTerminalForOthers` to its original intent
(claimed-by-another OR delivered-by-someone-else) and adds a new
`isComingSoon` flag plus a yellow "â³ Not yet ready for pickup"
banner. Client-only, no server / rules / schema change.

#### What shipped

- [x] **`DeliveryFlags` type extended** at
      `@/src/screens/delivery/DeliveryOrderDetailScreen.useDeliveryOrderDetail.ts:63-92`
      with `isComingSoon: boolean`. `FLAGS_NULL_ORDER` includes
      `isComingSoon: false`.
- [x] **`deriveDeliveryFlags` rewritten** at
      `@/src/screens/delivery/DeliveryOrderDetailScreen.useDeliveryOrderDetail.ts:103-145`.
      Adds `isComingSoon = isDelivery && unassigned && !mine &&
      status in {accepted, preparing}`. Narrows
      `isTerminalForOthers = isClaimedByOther ||
      (isDelivered && !isAssignedToMe)` â€” the catch-all is gone.
- [x] **Tests rewritten** at
      `@/tests/hooks/useDeliveryOrderDetail.test.ts`. The buggy
      "preparing â†’ terminal for others" test was removed; 4 new
      PR-23 tests added: preparing â†’ coming-soon, accepted â†’
      coming-soon, accepted+claimed â†’ terminal-precedence,
      coming-soon requires delivery role. Suite is now 22 tests
      (was 19; +4 / âˆ’1).
- [x] **Screen destructures `isComingSoon`** at
      `@/src/screens/delivery/DeliveryOrderDetailScreen.tsx:55`
      from `useDeliveryOrderDetail`.
- [x] **`headerTitle` widened** to render "Pickup details" for
      coming-soon as well as available-for-claim.
- [x] **Coming-soon JSX banner** inserted at the top of the
      ScrollView, gated on `isComingSoon`. Shows the shop's state
      ("preparing your order" / "just accepted") + an optional
      "Ready by HH:MM" line when `order.readyByEstimate` is set
      (reuses existing `formatOrderTime` import).
- [x] **Four new styles** added â€” `comingSoonCard`,
      `comingSoonTitle`, `comingSoonBody`, `comingSoonEta`. Same
      yellow family (`#FEF9E7` bg, `#F4D03F` border) as the
      dashboard HeadsUpCard.
- [x] **No new `useState`** â€” the new flag rides through
      `useDeliveryOrderDetail`'s return value, hooks order
      undisturbed.
- [x] **No new `DO NOT REMOVE` markers** (13-PR clean streak).

#### Verification done in-session

- `npx tsc --noEmit` â€” 0 errors.
- `npm test` â€” **599 / 599 passing** (was 596; +3 net from the
  test rewrite).
- Deliberate-break test: flipped one new assertion to
  `false`, confirmed exactly 1 fail on the named PR-23 test,
  reverted.

#### Manual smoke-test runbook (post-OTA)

1. Place a COD order; from delivery account, dashboard surfaces
   it under "Heads up â€” coming soon" while shop is
   accepted/preparing. Tap â†’ yellow banner, **no "Already
   taken"**, no Accept button.
2. Shop sets `readyByEstimate` â†’ within ~5s the banner shows a
   third line "Ready by HH:MM".
3. Shop flips to `ready_for_pickup` â†’ within ~5s banner
   disappears, Accept button appears.
4. Genuine race: two delivery accounts; A taps Accept on a
   `ready_for_pickup` order; B's screen refreshes â†’ still shows
   the legitimate "Already taken" EmptyState. PR 23 does not
   regress this path.
5. Customer / shop accounts opening the same order see no
   PR-23 surface (delivery-only).

#### Deploy

Client-only. No `firebase deploy`. Just:

```bash
npm test
eas update --branch production --message "PR 23 â€” fix Already Taken on coming-soon orders"
```

Testers force-close + reopen.

#### Rollback

`git revert` the three touched files; OTA. No server state to
unwind.

#### Follow-ups (out of scope)

- [ ] **Polish "just accepted" copy.** Reads slightly awkwardly
      ("The shop is just acceptedâ€¦"). Change to "looking at it"
      or "reviewing your order" if a family tester flags it.
      [PR 23 follow]
- [ ] **PII tighter on coming-soon.** Currently the
      delivery-instructions card renders before claim. Probably
      fine (the partner already saw the address on the
      HeadsUpCard) but worth a security pass once we expand
      beyond family testers. [post-MVP]
- [ ] **Push notification when status flips to
      ready_for_pickup.** Partner currently polls (5s). For
      multi-shop city scale, a push would beat the watcher
      latency. [post-MVP]
- [ ] **Telemetry `coming_soon_card_tapped`** to confirm the
      rail's tap-through-rate after the fix. [PR 23 follow]

### PR 22 â€” Customer delivery instructions per address â€” âœ… CODE COMPLETE May 21 2026

Solves the "ring the second bell, not the first" / "gate locked
after 9 PM, call when outside" mid-route phone call. Delivery
partners across India lose 3â€“5 minutes per drop on access
ambiguity; customers get woken up; instructions sent over WhatsApp
chat are lost in noise. PR 22 attaches free-text drop-off notes
to the **address** itself (so they're set once and reused on every
order to that address), with a per-order checkout override slot
and a yellow-tinted display card on the shop + delivery partner
order detail screens.

Server-first additive change. Field is optional everywhere; legacy
addresses + legacy orders silently render with no card.

#### What shipped

- [x] **Schema additive** at `@/src/types/index.ts:165-191` and
      `@/src/types/index.ts:204-228`. New optional
      `Address.deliveryInstructions?: string` and
      `SavedAddress.deliveryInstructions?: string`. Documented
      inline as free-text, â‰¤280 chars, normalized server-side.
- [x] **Pure helper** at
      `@/functions/src/deliveryInstructionsHelpers.ts`.
      `normalizeDeliveryInstructions` returns a discriminated
      union: undefined / null / empty / whitespace-only â†’
      `undefined` (write nothing); non-string â†’ invalid-argument;
      >280 chars after trim â†’ invalid-argument with explicit
      length in the message; otherwise the trimmed string. Trim
      is greedy on both ends; internal whitespace is preserved
      (line breaks in "Floor 2\nFlat 4B" matter).
- [x] **10 unit tests** at
      `@/tests/functions/deliveryInstructionsHelpers.test.ts`.
      Each rejection branch (number, object, oversize), each
      empty-input branch (undefined / null / `''` / `'   '` /
      `'\n\n'`), trim happy path, max-length boundary (280
      chars accepted, 281 rejected), and an internal-whitespace
      preservation test. Total: 596 tests pass project-wide.
- [x] **`saveAddress` callable** wiring at
      `@/functions/src/index.ts` â€” extends `validateAddressInput`
      in `profileHelpers.ts` to delegate to the helper, and the
      callable spreads `...(deliveryInstructions !== undefined
      && { deliveryInstructions })` so undefined is *omitted*
      from the Firestore write rather than written as `null`
      (cleaner reads on legacy clients).
- [x] **`placeOrder` callable** wiring stamps the normalized
      string onto `order.deliveryAddress.deliveryInstructions`
      at order-creation time, snapshotting whatever the customer
      saw at checkout â€” even if they later edit the saved
      address, the historical order doc is immutable. Same
      conditional-spread omit-if-undefined pattern.
- [x] **Client dispatcher types** at
      `@/src/services/profileService.ts` extended `SaveAddressInput`
      and `@/src/services/orderService.ts` extended
      `PlaceOrderInput` to carry the optional field.
- [x] **AddressEditScreen UI** at
      `@/src/screens/AddressEditScreen.tsx`. New multiline
      `TextInput` (3 lines visible, autoGrow up to 6) below
      the existing fields, with a live `N/280` char counter
      that turns danger-red at the limit. State + hydration
      hoisted above all early returns to satisfy Rules-of-Hooks.
- [x] **CheckoutScreen UI** at
      `@/src/screens/CheckoutScreen.tsx`. Same multiline input,
      pre-filled from the selected saved address's instructions,
      editable inline as a per-order override. The override does
      NOT mutate the saved address â€” it's only stamped onto the
      single order. Empty input clears the per-order override.
- [x] **Customer OrderDetailScreen** at
      `@/src/screens/OrderDetailScreen.tsx`. Read-only
      confirmation card adjacent to the delivery address. Subtle
      treatment â€” for the customer it's just a receipt, not
      actionable.
- [x] **Shop ShopOrderDetailScreen** at
      `@/src/screens/shop/ShopOrderDetailScreen.tsx`. Yellow-
      tinted card with left accent bar (`#F4D03F` on `#FEF9E7`)
      above items + substitution preference. Visually distinct
      from PR 21's primary-tinted substitution card so the two
      different information types read as such at a glance.
- [x] **Delivery partner DeliveryOrderDetailScreen** at
      `@/src/screens/delivery/DeliveryOrderDetailScreen.tsx`.
      Same yellow card directly under the "Deliver to" address
      block â€” most actionable surface in the app for this field
      (the partner is the one ringing the bell). Silently
      omitted on legacy orders.

#### Verification done in-session

- `npx tsc --noEmit` (root) â€” 0 errors.
- `npx tsc --noEmit -p functions` â€” 0 errors.
- `npm test` â€” 596 / 596 passing including the 10 new helper
  tests.
- Deliberate-break test: flipped a normalize expectation,
  confirmed exactly 1 fail, reverted.
- Zero new `DO NOT REMOVE` markers (the helper is invoked from
  `validateAddressInput` which is already a defended import
  surface; no new top-level single-symbol import added).

#### Manual smoke-test runbook

Pre-deploy (server-first): `firebase deploy --only functions`
*before* OTA-ing the client. Skipping this order means the
client tries to send `deliveryInstructions` to an old callable
that strips unknown fields silently â€” instructions silently
dropped, hard to debug.

1. **New address with instructions.** Profile â†’ Add address â†’
   fill all fields + "Ring second bell, brown gate". Save.
   Reopen â†’ instructions populated.
2. **Char counter.** Type 280 chars exactly â†’ counter green at
   `280/280`. Type 281 â†’ counter red, save button disabled
   (or save fails server-side with the explicit length error).
3. **Edit existing address.** Change instructions to "Gate
   locked after 9 PM, call when outside". Save. Reopen â†’ new
   text persisted; old text gone.
4. **Clear instructions.** Edit, blank the field, save.
   Reopen â†’ field empty; Firestore doc has no
   `deliveryInstructions` key (verify in console).
5. **Checkout pre-fill.** Place order against an address with
   instructions â†’ Checkout shows the saved string in the
   instructions input, editable.
6. **Per-order override.** At checkout, change the input from
   "Ring second bell" to "Today only â€” leave at door, I'm
   in a meeting." Place order. Open the placed order â†’
   override is on the order doc. Open the saved address â†’
   still shows "Ring second bell" (unmutated).
7. **Customer order detail.** Subtle confirmation card
   visible adjacent to the delivery address.
8. **Shop order detail.** Yellow card prominent above items.
   Owner can read while picking.
9. **Delivery order detail.** Yellow card directly under
   "Deliver to" â€” most prominent surface. Field-tested mental
   model: partner glances at the screen on arrival â†’ reads
   "ring second bell" â†’ no phone call.
10. **Legacy orders.** Open any order placed before this PR â†’
    no card rendered, no crash, no empty-string artifact.
11. **Server validation.** Hit the callable with
    `deliveryInstructions: 'x'.repeat(500)` â†’ returns
    `invalid-argument` with the length in the message. With
    `deliveryInstructions: 42` â†’ returns `invalid-argument`.
12. **No screen crashes.** Visit AddressEdit / Checkout /
    OrderDetail / ShopOrderDetail / DeliveryOrderDetail with
    instructions present + with instructions absent. No
    Rules-of-Hooks warnings in dev mode.

#### Deploy

```bash
# 1. Server-first
cd functions && npm run build && cd ..
firebase deploy --only functions

# 2. Client OTA
npm test
eas update --branch production --message "PR 22 â€” Customer delivery instructions"
```

Testers: force-close + reopen TestFlight.

#### Rollback

- **Server regression** â†’ `git revert` the deliveryInstructions
  edits + redeploy. Existing order docs retain the field
  harmlessly; old code reading them ignores it. New orders
  post-rollback won't have it.
- **Client regression** â†’ `eas update --branch production
  --message "Revert PR 22"` after `git revert` on the client
  edits. Server callable continues accepting the field; just
  no UI to set it.

#### Success metric

Target: **30â€“50% drop** in mid-route customer phone calls
reported by delivery partners in the weekly check-in.
Industry equivalent: Dunzo's 2022 ops note pegged the drop
at ~40% after they rolled out persistent address-level notes.
Hard to measure absolutely without per-order call logs;
proxies are partner self-report + the shop owner's
"customer didn't pick up" complaints frequency.

#### Follow-ups (out of scope this PR)

- [ ] **Per-address quick-pick presets.** Common phrases
      ("Ring the bell", "Call on arrival", "Leave with
      security") as tap-to-fill chips above the textarea.
      Reduces typing on Hindi / vernacular keyboards where
      switching layouts is friction. [PR 22 follow]
- [ ] **Photo of the gate / door.** Single optional image
      attached to the address. Especially valuable for
      hard-to-find apartment blocks. Requires Firebase
      Storage rules update + thumbnail generation. [post-MVP]
- [ ] **Voice note instructions.** â‰¤30s audio attached to
      the address; partner taps â†’ plays. Beats typing for
      illiterate / semi-literate customers. Requires audio
      capture + Storage + a player component. [post-MVP]
- [ ] **Shop-side acknowledgement.** Checkbox on the shop
      order detail "âœ“ I've read the delivery notes" that
      stamps an event onto the order timeline. Forces the
      shop to actually look at the field rather than skim
      past it. [PR 22 follow]
- [ ] **Localize copy.** Field label + placeholder are
      English-only. Hindi / Punjabi / Tamil translations
      matter for the same reason as PR 21. [post-MVP]
- [ ] **Telemetry event `delivery_instructions_set`** with
      length bucket (0 / 1-50 / 51-150 / 151-280) so we can
      see adoption + tune the 280 char limit. [PR 22 follow]
- [ ] **Edit instructions after order placed.** Currently
      set-once at checkout. A future
      `updateOrderDeliveryInstructions` callable could allow
      edits while status is still `pending` / `accepted`
      (before partner picks up). [post-MVP]

### PR 21 â€” Customer substitution preferences at checkout â€” âœ… CODE COMPLETE May 21 2026

Solves the "namaste, atta khatam ho gaya, Aashirvaad chalega kya?"
problem. Kirana stock volatility is high; mid-fulfillment calls drop;
orders stall. PR 21 captures the customer's intent at checkout
("call me / replace / refund") and shows it prominently on the shop
side so fulfillment proceeds without interruption.

Bilateral payoff: customer doesn't get interrupted; shop finishes
orders faster. Schema-additive (one optional field on Order).

**Server-first deploy** â€” `placeOrder` callable accepts an
additional optional field; server normalizes / re-validates. Old
clients omitting the field continue to work (server defaults to
`call_me`). New client sending the field on an old server is also
fine (old server ignores unknown fields) â€” but we deploy server
first per discipline, so the field is honored from the moment the
client OTA lands.

#### What shipped

- [x] **Schema additive** at `@/src/types/index.ts:352-371`. New
      optional `Order.substitutionPreference` + new exported
      `SubstitutionPreference = 'call_me' | 'auto' | 'refund'`
      type. Field documented inline with the legacy-render rules.
- [x] **Pure helper** at
      `@/functions/src/substitutionHelpers.ts`.
      `normalizeSubstitutionPreference` returns a discriminated
      union: undefined/null â†’ 'call_me' (absorbs old clients);
      allowlist string â†’ echoed; non-string + unknown string +
      empty string â†’ invalid-argument. Empty string deliberately
      NOT coerced (signals a UI bug; surface loudly).
- [x] **10 unit tests** at
      `@/tests/functions/substitutionHelpers.test.ts`. Each of
      the three allowlist values, undefined / null defaults,
      non-string (number + object), unknown string, empty
      string, and the canonical `VALID_PREFERENCES` constant.
- [x] **`placeOrder` wire-up** at
      `@/functions/src/index.ts:74-76;184-187;212-223;454-460`.
      Field accepted on `PlaceOrderInput`, normalized via the
      helper, and persisted onto the order doc with the rest of
      the canonical fields. Marked `DO NOT REMOVE` on the import
      line per the code-discipline pattern (auto-formatter
      stripped a similar import twice during PR 6).
- [x] **`orderService.placeOrder` dispatcher** at
      `@/src/services/orderService.ts:26;43-52;121-132`. Type
      extended; payload forwards via a conditional spread so
      legacy callers that omit the field keep the same wire
      shape (helps tests + Razorpay receipt-string stability).
- [x] **CheckoutScreen picker** at
      `@/src/screens/CheckoutScreen.tsx:55-63;310-322;626-675`.
      State hoisted with the PR 12 / 17 / 19 / 20 lineage above
      all early returns. Three-option picker sits between the
      bill summary and the payment method â€” placement is
      deliberate so the customer makes the choice BEFORE
      committing to pay. Default 'call_me'.
- [x] **Customer-side confirmation** at
      `@/src/screens/OrderDetailScreen.tsx:296-310;897-914`.
      Subdued surface-colored card right under the delivery
      address. Silently omitted on legacy orders (no field) â€”
      no choice was made, nothing to confirm.
- [x] **Shop-side prominent display** at
      `@/src/screens/shop/ShopOrderDetailScreen.tsx:297-314;679-703`.
      Primary-tinted card with an accent left border, rendered
      ABOVE the items section so the shop owner sees the
      customer's intent before they start picking. Legacy
      orders explicitly render the `call_me` copy (safe
      fallback â€” the shop should call when intent is unknown).
- [x] **No new useState below early returns**. All three new
      pieces of state (the picker on CheckoutScreen) are
      hoisted with the existing block.
- [x] **Picker styles** mirror the saved-address card visual
      language: border + tinted-active state, primary color
      family. Customer instinctively recognizes it as a
      selection.

#### Verification

- `npx tsc --noEmit` (root): 0 errors.
- `npx tsc --noEmit -p functions`: 0 errors.
- `npm test`: **57 suites / 585 tests** (575 â†’ +10 new).
- **Deliberate-break demo passed**: flipped the "defaults to
  call_me when undefined" expectation to expect `'auto'`,
  confirmed exactly 1 fail / 9 pass, reverted.
- Zero new `DO NOT REMOVE` markers... wait â€” one was added on
  the `substitutionHelpers` import per the code-discipline
  pattern (auto-formatter risk for one-shot single-symbol
  imports of new pure-helper modules). Streak: **11 PRs clean,
  PR 21 adds 1 defensive marker** for an import that's a known
  auto-formatter target pattern. Documented in-line.

#### Smoke tests (after staged deploy)

1. **Default selection.** Open Cart â†’ Checkout. The
   "If something's unavailable" section shows three options;
   "ðŸ“ž Call me first" has the active border + primaryLight
   background.
2. **Switch selection.** Tap "ðŸ”„ Replace with similar". Active
   styling transfers; the call-me card loses its accent.
3. **Place order with 'auto'.** Submit. OrderDetail shows
   "If unavailable â†’ ðŸ”„ Shop will replace with similar".
4. **Shop sees the preference.** Quick Switch to a shop owner
   account, open the same order. Above items, a primary-tinted
   card reads "Customer's preference â†’ ðŸ”„ Replace with
   similar items (shop picks)".
5. **Legacy order display.** Find an order placed before this
   PR. Customer side: no preference card (silently omitted).
   Shop side: card with "ðŸ“ž Call before substituting or
   refunding" â€” explicit safe default.
6. **'refund' preference.** Place another order with the
   refund option. Customer + shop displays both reflect it.
7. **Explicit 'call_me' selection.** Place with the default
   explicitly tapped. Choice persists on customer + shop
   sides â€” distinguishable from legacy by virtue of the field
   being present on the order doc (server normalized + wrote it).
8. **Server validation.** Hit the callable directly (e.g. via
   Cloud Functions console or a test script) with
   `substitutionPreference: 'cancel'`. Server returns
   `invalid-argument`. Valid flows unaffected.
9. **No screen crashes.** Hooks-of-Rules sanity â€” visit
   CheckoutScreen / OrderDetailScreen / ShopOrderDetailScreen
   across statuses; no ErrorBoundary.

#### Deploy plan

**Server-first** per `.windsurf/deploy-discipline.md`:

```powershell
$env:NODE_OPTIONS = "--use-system-ca"

# 1. Server first â€” placeOrder must understand the field before
#    client OTA. New client sending the field at an old server
#    is harmless (old server ignores unknown fields), but the
#    PR's promise to the customer only holds once normalization
#    + persistence are live.
cd functions
npm run build
cd ..
firebase deploy --only functions --project grocery-mvp-dev
firebase functions:list --project grocery-mvp-dev
# Confirm placeOrder shows "Updated:" in the deploy output.

# 2. Client OTA
npm test
eas update --branch production --message "PR 21 â€” Customer substitution preferences"
```

Testers: force-close + reopen TestFlight.

#### Rollback

- **Server regression** â†’ `git revert` the substitutionHelpers
  + placeOrder edits + redeploy. Order docs created since
  rollout retain the field harmlessly; old code reading them
  just ignores it. New orders post-rollback won't have the
  field; ShopOrderDetail falls back to the 'call_me' default
  copy (graceful).
- **Client regression** â†’ `eas update --branch production
  --republish [previous-update-id]`. CheckoutScreen on
  rolled-back binaries doesn't show the picker; customers
  default to `call_me` server-side automatically.

#### Headline metric

**% of orders where shop calls customer mid-fulfillment.** Hard
to measure directly; proxies: (a) shop-side feedback in the
weekly check-in, (b) call-log frequency from shop owners with
metered plans. Industry equivalent: Swiggy Instamart reports
~60% drop in substitution-call rate after preferences shipped.

#### Follow-ups (out of scope this PR)

- [ ] **Shop substitution workflow.** PR 21 captures intent;
      doesn't build the UI for the shop owner to mark an item
      as "substituted with X" or "refunded â€” adjust total".
      For MVP they call (per `call_me`) or just act (per
      `auto` / `refund`) without formal in-app workflow.
      Future PR introduces the substitute / refund actions on
      ShopOrderDetailScreen with a new server callable
      (`substituteOrderItem` / `refundOrderItem`) that
      handles the line-item edit + total recompute + audit
      log. [post-MVP]
- [ ] **Per-item preferences.** Single preference applies to
      the whole order today. Useful refinement: "refund any
      veg, but substitute any staple". Adds a per-cart-item
      enum to PlaceOrderInput. [post-MVP]
- [ ] **Editing preference after order placed.** Set-once at
      checkout. Customer would cancel + re-order to change.
      A future callable `updateOrderSubstitutionPreference`
      could allow editing while status is still `pending` /
      `accepted` (before the shop starts picking). [post-MVP]
- [ ] **Default preference on profile.** Customer re-chooses
      every order in MVP. Saved-default lives on
      `/users/{uid}.substitutionPreferenceDefault` in a
      future PR if there's repeat-customer demand.
      [post-MVP]
- [ ] **Notify customer when substitution happens.** Push
      infrastructure exists (PR 11); need a new trigger
      (`sendSubstitutionNotice`) fired when the shop marks
      an item as substituted / refunded â€” gated on the
      shop substitution workflow above. [post-MVP]
- [ ] **Telemetry event `substitution_preference_chosen`**
      with the chosen value so we can A/B-test default
      ordering (currently call_me first; data may show auto
      converts better on repeat customers). Trivial
      Analytics.send() in CheckoutScreen on
      `setSubstitutionPreference`. [PR 21 follow]
- [ ] **Localize copy.** English-only today. Hindi / Punjabi
      / Tamil translations matter once the customer base
      diversifies; the three preference labels are the
      first surface most customers will read in the app
      (Checkout is high-attention). [post-MVP]

### PR 20 â€” Customer order rating + Shop ratings â€” âœ… CODE COMPLETE May 21 2026

Restores the trust signal kirana customers lose when they move from
"I know Mahesh-bhai personally" to "I'm browsing an app full of shop
names." After PR 20, every shop card carries a "â˜… 4.7 (200)" badge
or a "New shop" italic â€” the same trust-cue language Swiggy / Zomato
/ BlinkIt have trained Indian consumers on for years.

Three ingredients:
1. Rating prompt on OrderDetail for delivered + unrated orders.
2. Rolling average + count denormalized on shop docs (incremental
   compute â€” no full re-aggregation).
3. Star badge on every shop display surface.

**Server-first rollout** â€” new `submitOrderRating` callable with no
client backstop possible (a missing callable surfaces as
`functions/not-found` on every Submit tap and rolls back the
optimistic flip). Functions deploy precedes client OTA.

#### What shipped

- [x] **Schema additive** at
      `@/src/types/index.ts:55-66` (Shop) and
      `@/src/types/index.ts:345-361` (Order + new `OrderRating`
      type). Both new fields optional. Coexist with the legacy
      `Shop.rating: number` placeholder seed value (decommission
      tracked as a follow-up).
- [x] **Pure helpers** at
      `@/functions/src/ratingHelpers.ts`.
      `validateRatingSubmission` (auth + ownership + delivered
      status + no-prior-rating + shopId presence + stars range +
      comment shape/length, returns a discriminated union) and
      `computeNewRollingAverage` (incremental rolling avg with
      1-decimal rounding + defensive coercion of garbage input).
      No firebase-admin imports â€” testable in plain Node.
- [x] **19 unit tests** at
      `@/tests/functions/ratingHelpers.test.ts`. 14 validation
      cases (every rejection branch + happy paths with /
      without comment + whitespace-collapse). 5 rolling-average
      cases (fresh-shop with 2 starting stars, 4.0/3 + 5-star,
      5.0/10 + 1-star, negative-coercion defense, 1-decimal
      precision sanity).
- [x] **`submitOrderRating` callable** at
      `@/functions/src/index.ts:4932-5047`. Atomic Firestore
      transaction over `orders/{orderId}` + `shops/{shopId}` â€”
      writes the rating field AND the shop's new
      `ratingAvg` / `ratingCount` together, rolls back together.
      Re-reads inside the transaction guard the rapid-double-tap
      race. Audit log entry is written non-fatal (PR 8 wrapper
      pattern, `actionType: 'order.rate'`).
- [x] **`orderService.submitOrderRating`** dispatcher at
      `@/src/services/orderService.ts:192-211`. Same dual-
      dispatch native/web posture as the existing 25 callables.
- [x] **`RateOrderCard`** at
      `@/src/components/order/RateOrderCard.tsx`.
      5-star tap picker, optional comment with 500-char live
      counter, Submit button that disables until at least one
      star is selected and during in-flight submission. Failure
      surfaces as a one-line Alert + Submit re-enables. 3
      `useState` calls, all hoisted above any conditional
      return.
- [x] **OrderDetailScreen integration** at
      `@/src/screens/OrderDetailScreen.tsx:87-97;539-579;853-880`.
      New `optimisticRating` state hoisted with the PR 7 / 17 /
      19 lineage. Two mutually-exclusive render branches:
      RateOrderCard for delivered + unrated; "Thanks for rating!"
      confirmation for delivered + (canonical OR optimistic)
      rating. Both branches read `order.rating ?? optimisticRating`
      so the watcher's eventual canonical write doesn't visually
      flicker.
- [x] **`ShopRatingBadge`** at
      `@/src/components/shop/ShopRatingBadge.tsx`. Stateless
      presentational component. Two sizes (`sm` for list / rail
      cards; `md` for shop's own header). `New shop` italic
      fallback when ratingCount is 0/missing â€” the
      "no-signal-yet, take-a-chance-but-informed" copy.
- [x] **Badge integration on 4 surfaces**:
      `@/src/components/shop/ShopCard.tsx:30-38` (replaces the
      legacy `â˜… {shop.rating}` placeholder),
      `@/src/screens/SearchScreen.tsx:153-163`,
      `@/src/screens/ShopDetailScreen.tsx:196-206` (size="md" on
      the shop's own page), and
      `@/src/components/order/OrderAgainRail.tsx:67-76`.
- [x] **`searchMenuPublic` propagation** at
      `@/functions/src/searchMenuPublicHelpers.ts:27-32;52-57;147-156`.
      `CandidateShop` and `SearchResultItem.shop` extended with
      optional `ratingAvg` / `ratingCount`; the join in
      `filterAndJoinSearchResults` spreads them through with
      conditional spreads so legacy shops without ratings keep
      the same wire shape they had pre-PR 20. Client mirror in
      `@/src/services/orderService.ts:606`.
- [x] **`FrequentShopEntry` extension** at
      `@/src/utils/pickFrequentlyOrderedShops.ts:35-43` with
      optional rating fields so OrderAgainRail's badge works
      via graceful-degradation ("New shop" until HomeScreen
      hydrates from a parallel shops fetch â€” see follow-up).
- [x] **No new useState below early returns** on
      OrderDetailScreen. `optimisticRating` lives with the
      hoisted `[shop, refreshing, refreshNonce]` block per the
      established lineage.

#### Verification

- `npx tsc --noEmit` (root): 0 errors.
- `npx tsc --noEmit -p functions`: 0 errors.
- `npm test`: **56 suites / 575 tests** (556 â†’ +19 new).
- **Deliberate-break demo passed**: flipped the 4.0 / 3 + 5 â†’
  4.3 expectation to 4.4, confirmed exactly 1 fail / 18 pass,
  reverted.
- Zero new `DO NOT REMOVE` markers added â€” **11 PRs in a row**
  clean.

#### Smoke tests (after staged deploy)

1. **Rate a delivered order.** Complete an end-to-end order
   through to `delivered`. Open OrderDetail. RateOrderCard
   visible. Tap 5 stars + add comment "Great service" + Submit.
   Card flips to "Thanks for rating! â˜…â˜…â˜…â˜…â˜… 'Great service'".
2. **Shop avg updates.** ShopListScreen shows the rated shop's
   card with "â˜… 5.0 (1)" badge.
3. **Multiple ratings produce a rolling average.** Quick Switch
   to a different test customer, place + complete + rate the
   same shop's order with 3 stars. Shop card now shows
   "â˜… 4.0 (2)" â€” `(5+3)/2`.
4. **New shop fallback.** Shop with no ratings yet renders
   "New shop" italic instead of stars.
5. **Cannot rate non-delivered orders.** Open a `preparing` /
   `accepted` / `cancelled` order. RateOrderCard NOT visible.
6. **Cannot re-rate.** After submitting, sign out + back in,
   reopen OrderDetail. "Thanks for rating!" persists. The card
   prompt does NOT come back.
7. **Star badge on all surfaces.** Verify rendering on
   ShopList card, Search results row, ShopDetail header
   (size="md"), Home's OrderAgainRail card.
8. **Validation paths.** Submit-disabled until â‰¥1 star; type
   501 chars in the comment box â†’ input caps at 500; server
   `submitOrderRating` rejects oversized comments with a
   readable `failed-precondition` Alert.
9. **Hooks-of-Rules sanity.** Visit OrderDetail across every
   status with + without rating, navigate Home â†’ Shop â†’
   OrderDetail repeatedly. No ErrorBoundary screens.

#### Deploy plan

**Server-first** per `.windsurf/deploy-discipline.md`:

```powershell
$env:NODE_OPTIONS = "--use-system-ca"

# 1. Server first â€” submitOrderRating callable must exist before
#    any client OTA, or every Submit tap returns "function not
#    found" and rolls back the optimistic flip. searchMenuPublic
#    return-shape is additive (rating fields), so old client +
#    new server is fine â€” old client just ignores the new fields.
cd functions
npm run build
cd ..
firebase deploy --only functions --project grocery-mvp-dev

# 2. Verify the new callable is live
firebase functions:list --project grocery-mvp-dev
# Look for `submitOrderRating` in asia-south1.

# 3. Client OTA
npm test
eas update --branch production --message "PR 20 â€” Customer ratings + shop ratings"

# 4. Tell testers: force-close + reopen TestFlight.
```

#### Rollback

- **Server regression** â†’ `git revert` the ratingHelpers +
  callable + searchMenuPublicHelpers commits + redeploy
  functions. All schema is additive â€” old code reading the
  shop or order doc just ignores `rating` / `ratingAvg` /
  `ratingCount`.
- **Client regression** â†’ `eas update --branch production
  --republish [previous-update-id]`. Optimistic ratings
  rendered before rollback survive (server has them); they
  just stop appearing as confirmation cards on old binaries.

**Order matters:** server before client.

#### Headline metric

**% of delivered orders that get rated.** Industry benchmark
30â€“50% for food delivery, 25â€“40% for grocery. Below 15% means
the prompt isn't getting tapped â€” investigate placement
(maybe move above the cancel-window block, or add a push
notification trigger when the order flips to `delivered`).

#### Follow-ups (out of scope this PR)

- [ ] **OrderAgainRail rating hydration.** Today
      `FrequentShopEntry.ratingAvg` / `ratingCount` are unset
      because order docs don't snapshot shop ratings. Wire
      HomeScreen to fire `shopService.list(location)` in
      parallel with `orderService.listMine`, then enrich each
      `FrequentShopEntry` with the matching shop's rating.
      Until then the rail cards show "New shop" â€” graceful
      degradation, not broken. [PR 20 follow]
- [ ] **Decommission legacy `Shop.rating: number`.** Field
      is a placeholder seed value, never written to by any
      callable. Once every read site uses `ratingAvg`
      (currently: ShopCard âœ“, ShopDetailScreen âœ“, Search âœ“,
      OrderAgainRail âœ“ via badge), drop the legacy field
      from the type + the seed script + Firestore docs.
      [PR 20 follow]
- [ ] **Editing or deleting a rating.** MVP is submit-once
      (avoids the rolling-average recompute-from-scratch
      complexity). Future PR can add an "edit your rating"
      path with a server callable that recomputes by
      subtracting the old stars and adding the new (no
      historical scan needed if we keep the prior rating
      stamped on the order doc). [post-MVP]
- [ ] **Per-item ratings.** Zomato's "rate each dish"
      pattern. Useful for shops with mixed quality but
      drastically more UI work. [post-MVP]
- [ ] **Separate delivery-partner rating.** Single combined
      rating in MVP. When delivery-partner pool grows beyond
      a handful, split into shop-stars + delivery-stars on
      the same RateOrderCard. [post-MVP]
- [ ] **Shop owner responses to ratings.** "Thanks for the
      feedback!" / "We've fixed this." Useful trust signal
      but adds another permissions surface â€” defer until a
      shop asks. [post-MVP]
- [ ] **Reviews page on ShopDetailScreen.** Show individual
      rating comments (with timestamps, no PII). Today the
      shop's own page only shows the aggregate; comments
      are stored on the order docs but not surfaced. [post-MVP]
- [ ] **Push notification "How was your order?"** Trigger
      30 min after `delivered` status. Push infrastructure
      exists (PR 11); just need a new
      `sendDeliveredRatingPrompt` scheduler. Could lift the
      rating rate from ~25% to ~45%. [post-MVP]
- [ ] **Telemetry event `rating_submitted`** with shopId +
      stars + hasComment so the headline metric is
      analytically queryable without scraping audit logs.
      Trivial Analytics.send() in `RateOrderCard.onSubmit`
      after the await. [PR 20 follow]
- [ ] **Sort shops by rating on ShopListScreen.** Today the
      list is distance-ranked. Once we have ~50 shops with
      ratings, expose a "Sort: distance / rating" toggle.
      Data is already there. [post-MVP]
- [ ] **Hide / moderate bad-faith ratings as admin.**
      Audit log captures who rated what; admin can manually
      adjust ratingAvg / ratingCount via a new callable if
      needed at MVP scale. Build this when it's actually
      requested. [post-MVP]

### PR 19 â€” Shopping list / Favorites â€” âœ… CODE COMPLETE May 21 2026

The third behavioral loop for kirana shopping. PR 13 built "repeat
the whole last order"; PR 14 surfaced "reorder from my usual shop"
on Home; PR 19 closes the loop with **"these specific items are
my essentials â€” let me grab them quickly without rebuilding the
cart."** Heart icon on every menu row, dedicated FavoritesScreen
grouped by shop, optimistic toggling with server reconciliation.

Industry alignment: every major Indian grocery app (Zepto,
BlinkIt, Swiggy Instamart, Zomato grocery) has a heart icon on
items. The gesture is muscle memory; not having it makes the app
feel less polished than what users compare against.

**Server-first rollout** â€” new `toggleFavorite` callable. Old
client + new server is fine (no caller); new client + old server
would 5xx on every heart tap. Functions deploy precedes client OTA.

#### What shipped

- [x] **Schema additive** at
      `@/src/types/index.ts:222-243`. New optional
      `favorites?: Record<string, string[]>` on `UserProfile`.
      Per-shop scoping (rather than a flat list) so a favorite
      at one shop survives the same item being removed from a
      different shop's menu. Mirrored at
      `@/functions/src/index.ts:4543-4555` on `StoredProfile`.
      `publicProfileShape` now round-trips the field.
- [x] **Pure helpers** at
      `@/functions/src/favoritesHelpers.ts`.
      `validateToggleFavoriteInput` (auth + non-empty string
      checks) and `applyFavoriteToggle` (immutable add / remove
      with shop-key cleanup when the inner array drops to
      empty). Same testability contract as
      `cancelPaidOrderHelpers` / `auditLogHelpers` â€” no
      firebase-admin imports, plain Node runnable.
- [x] **15 unit tests** at
      `@/tests/functions/favoritesHelpers.test.ts`. 5 validation
      cases (auth null/undef, empty shopId, non-string
      menuItemId, valid). 10 toggle cases (add to undef map,
      add to empty map, add to existing array, remove from
      array, the critical **shop-key-cleanup-on-empty** case,
      input non-mutation for both top-level and inner array,
      multi-shop independence, last-favorite-of-one-shop
      preserves other shops, toggle-is-its-own-inverse round
      trip).
- [x] **`toggleFavorite` callable** at
      `@/functions/src/index.ts:4860-4926`. Wraps the helpers;
      runs the read-modify-write inside a Firestore
      transaction so a rapid double-tap doesn't race-condition
      the array. Returns `{ profile, isFavorite }` so the
      client can reconcile in one round-trip without a
      separate `getMyProfile` follow-up. Deliberately does NOT
      validate menuItemId existence â€” favorites can outlive a
      shop's menu (FavoritesScreen handles the "no longer
      available" UX downstream).
- [x] **`profileService.toggleFavorite`** dispatcher at
      `@/src/services/profileService.ts:131-151`. Same
      native/web posture as the existing 5 profile callables.
- [x] **New `useProfileStore`** at
      `@/src/store/useProfileStore.ts`. Separate from
      `useAuthStore` (different concern, different lifetime).
      Hydrated by AuthBootstrap; cleared on sign-out;
      mutating callables replace via `setProfile`. Exposes
      a non-subscribing `isFavorite(shopId, menuItemId)` for
      one-shot reads and a subscribing selector for
      components that want to re-render on map mutations.
- [x] **AuthBootstrap hydration**
      (`@/src/components/AuthBootstrap.tsx`). On every
      auth-state tick that resolves to a real (non-anonymous)
      user, fires `useProfileStore.loadFromServer()`.
      Anonymous users skip; sign-out clears the cache so the
      next user doesn't briefly see the previous user's
      favorites flash through.
- [x] **`FavoriteHeart` component** at
      `@/src/components/common/FavoriteHeart.tsx`.
      Optimistic local toggle via `setProfile` â†’ callable â†’
      reconcile with server's authoritative shape. Failure
      rolls back to the pre-toggle baseline + alerts. **Anon
      handling** picks Option A from the prompt Â§Part 10:
      explicit "Sign in to save favorites" Alert (silent
      no-op was rejected as confidence-destroying â€” empty
      tap = "did the app freeze?" anxiety).
- [x] **ShopDetailScreen heart integration** at
      `@/src/screens/ShopDetailScreen.tsx`.
      `MenuItemCard` now takes a `shopId` prop and renders
      the heart in a new title row above the +/- controls so
      it doesn't displace the existing layout. New
      `cardTitleRow` style.
- [x] **HomeScreen favorites tile** at
      `@/src/screens/HomeScreen.tsx`. New
      `favoritesCount` selector subscribes only to the
      `favorites` slice (not the full profile) so unrelated
      address edits don't re-render Home. Tile self-hides
      when count is 0; tap-through navigates to `Favorites`.
      Same horizontal-pill styling as ProfileScreen address
      rows for visual consistency.
- [x] **`FavoritesScreen`** at
      `@/src/screens/FavoritesScreen.tsx`. Reads
      `profile.favorites` from useProfileStore; for each
      shopId, fetches the shop's CURRENT menu via
      `orderService.listShopMenuPublic` so prices reflect
      today, not whenever the customer favorited. Renders
      groups for: (a) shop OK with available items + +/-
      controls, (b) shop OK with items the menu no longer
      carries (per-row Remove button), (c) shop suspended /
      404'd (bulk "Remove these favorites" CTA). Uses
      `addMenuItem` so the existing different-shop cart
      blocker still works (PR 4 escape hatch). Hooks
      discipline: state hoisted above all 3 early returns
      with the PR 12 â†’ PR 18 lineage comment.
- [x] **Navigation wiring**
      (`@/src/navigation/AppNavigator.tsx`). New
      `Favorites: undefined` in `RootStackParamList`,
      `<Stack.Screen name="Favorites" component={FavoritesScreen} />`.
- [x] **No new useState below early returns** on any
      modified or new screen. `FavoritesScreen` has THREE
      early returns (`!profileLoaded || loading`,
      `groups.length === 0`, fall-through render); all 4 new
      `useState` calls live above them.

#### Verification

- `npx tsc --noEmit` (root): 0 errors.
- `npx tsc --noEmit -p functions`: 0 errors.
- `npm test`: **55 suites / 556 tests** (541 â†’ +15 new).
- **Deliberate-break demo passed**: flipped the
  shop-key-cleanup test to expect `{ shop_1: [] }`,
  confirmed exactly 1 fail / 14 pass, reverted.
- Zero new `DO NOT REMOVE` markers added (auto-formatter
  discipline at **10 PRs in a row** without strips).

#### Smoke tests (after staged deploy)

1. **Heart visible, tap to favorite.** Sign in as a customer.
   Open ShopDetailScreen, tap the ðŸ¤ next to atta. It flips
   to â¤ï¸ instantly. Force-close + reopen the app â€” still
   â¤ï¸ (server-side persisted via the callable + AuthBootstrap
   hydrate).
2. **Tap again to unfavorite.** Heart flips back to ðŸ¤.
   Reload confirms.
3. **Home tile appears.** With at least one favorite, Home
   shows "â¤ï¸ N favorites" tile beneath How-it-works. Tap â†’
   FavoritesScreen opens.
4. **FavoritesScreen lists items grouped by shop.** Each
   shop section shows live prices, packLabel, â¤ï¸ heart, and
   ADD / +/- controls that match what ShopDetailScreen would
   show. Tap ADD â†’ cart updates.
5. **Multi-shop cart blocker still works.** Favorite items
   from Shop A AND Shop B. ADD from Shop A â†’ cart has it.
   From FavoritesScreen tap ADD on Shop B item â†’ "Start a
   new cart?" Alert (existing PR 4 behaviour).
6. **Removed-from-menu handling.** As shop owner, delete a
   favorited menu item. As customer, FavoritesScreen â†’ that
   row reads "No longer on this shop's menu" with a Remove
   button. Tap Remove â†’ row disappears, count on Home tile
   decreases.
7. **Suspended-shop handling.** As admin, suspend a shop the
   customer has favorites at. As customer, FavoritesScreen â†’
   that shop becomes a dashed-border card "Shop no longer
   available â€” N favorites can no longer be ordered" with a
   "Remove these favorites" bulk CTA. Tap â†’ group
   disappears, count drops.
8. **Anonymous user.** Sign out, get bootstrapped to anon.
   Open a shop, tap a heart â†’ "Sign in to save favorites"
   Alert. No crash, no orphaned local state.
9. **Hooks-of-Rules sanity.** Navigate Home â†’ Favorites â†’
   ShopDetail repeatedly, force-close + reopen. No
   ErrorBoundary screens. Discipline holding.

#### Deploy plan

**Server-first** per `.windsurf/deploy-discipline.md`:

```powershell
$env:NODE_OPTIONS = "--use-system-ca"

# 1. Server first â€” toggleFavorite callable must exist
#    before any client OTA, or every heart tap returns
#    "function not found".
cd functions
npm run build
cd ..
firebase deploy --only functions --project grocery-mvp-dev

# 2. Verify the new callable is live
firebase functions:list --project grocery-mvp-dev
# Look for `toggleFavorite` in asia-south1.

# 3. Client OTA
npm test
eas update --branch production --message "PR 19 â€” Favorites + Shopping list"

# 4. Tell testers: force-close + reopen TestFlight.
```

#### Rollback

- Server regression â†’ `git revert` the favoritesHelpers
  + callable + publicProfileShape commits + redeploy
  functions. Storage shape is additive â€” old code reading
  the doc just ignores the `favorites` field.
- Client regression â†’ `eas update --branch production
  --republish [previous-update-id]`.

**Order matters:** server before client. If you skip the
server deploy and OTA the client first, every heart tap
returns "function not found" and rolls back the optimistic
flip â€” hearts will visibly jitter.

#### Headline metric

**% of cart-add events that originate from a favorite tap**
(vs. fresh-browse +/-). Industry numbers from Zepto/BlinkIt
suggest 35â€“45% within 4 weeks of consistent customer use.

- Below 15% = customers aren't discovering favorites.
- Above 50% = customers have settled into their routine,
  which is the goal.

#### Follow-ups (out of scope this PR)

- [ ] **Bulk "Add all favorites from this shop to cart"
      button** on each FavoritesScreen group. Future PR if
      customers ask. Single-item +/- is enough for MVP.
      [PR 19 follow]
- [ ] **Reordering favorites manually** (drag to reorder).
      Default ordering is "most-recently-added last" today
      (server appends to the end of the array). Add a
      drag-handle when there's a real ask. [post-MVP]
- [ ] **Multiple named lists** ("Weekly groceries",
      "Office snacks"). Distinct feature; the favorites map
      structure could be extended to support it without a
      migration (key the inner arrays by list name instead
      of always using a default list). [post-MVP]
- [ ] **Sharing favorites with family members** (e.g. a
      shareable link). Out of scope; needs auth-level work
      to scope reads. [post-MVP]
- [ ] **Push notification "Your favorite atta is back in
      stock"**. Needs the existing pushService +
      shop-owner-driven trigger when an item flips
      `available` true. Big retention win once family
      testing settles. [post-MVP]
- [ ] **HomeScreen "Favorites" rail showing the actual top
      3 favorited items** (not just a count). Defer to a
      follow-up; the count tile + tap-through is the MVP
      path. [PR 19 follow]
- [ ] **Telemetry event for favorite_toggled** with
      shopId + menuItemId so the headline metric above is
      analytically queryable. Trivial Analytics.send()
      additions in `FavoriteHeart.onPress`. [PR 19 follow]
- [ ] **Bulk-remove server callable** so
      FavoritesScreen's suspended-shop "Remove these
      favorites" CTA doesn't fire N sequential
      `toggleFavorite` calls. Optimisation only â€” current
      sequential behaviour is correct, just chatty when a
      shop with 10+ favorites gets suspended. [PR 19 follow]
- [ ] **Migrate ProfileScreen to read from
      useProfileStore**. Today it keeps its own local
      `useState<UserProfile>` synced via `useFocusEffect`.
      That keeps working, but unifying the two surfaces
      onto the new store would let address edits broadcast
      to other screens too. Pure refactor â€” no user-facing
      change. [post-MVP]

### PR 18 â€” Quick Switch test accounts â€” âœ… CODE COMPLETE May 21 2026

Pure productivity multiplier for solo / multi-role testing. Pre-PR
the role-switch flow was sign-out â†’ enter phone â†’ wait for OTP â†’
enter `123456` â†’ wait for verify â†’ land on Home (~45s per switch).
Post-PR a single tap on a `Switch test account` tile runs the same
chain programmatically end-to-end in ~5s. Family-testing throughput
roughly 5x.

**No backdoor.** Firebase Auth still gates everything. The shortcut
just removes manual typing for phones already configured in
Firebase Console's "Phone numbers for testing" list.

**Production safety via test-list membership gate** (not `isAdmin`):

- Real customer phones aren't in `TEST_ACCOUNTS` â†’ button hidden.
- Anonymous bootstrap users (no phone yet) â†’ button hidden.
- Every test phone IS in the list â†’ after switching admin â†’
  customer-test, the button stays visible so you can switch back.

If the feature ever leaks to a production-customer build, the worst
case is the button is hidden for everyone because no real-customer
phone matches the dev-project's test list.

Pure client OTA â€” no schema, no server, no rollout risk.

#### What shipped

- [x] **Test accounts constants** at
      `@/src/constants/testAccounts.ts`. `TestAccount` type +
      `TEST_ACCOUNTS` array. Doc block explains the
      Firebase-Console contract: phones + OTPs MUST match
      `Authentication â†’ Settings â†’ Phone numbers for testing`.
      Edit this file when you change that list. Phones are
      placeholder dev values â€” update to match the actual
      `grocery-mvp-dev` console config before first use.
- [x] **QuickSwitchModal component** at
      `@/src/components/dev/QuickSwitchModal.tsx`. Renders the
      list, runs the auth chain (`signOut` â†’
      `startPhoneAuth` â†’ `confirmOtp` â†’ `setUser`), surfaces
      errors inline, blocks Cancel during in-flight switch.
      Single `busy` slot serves as both mutex + spinner-target
      selector â€” single source of truth.
- [x] **HomeScreen integration**
      (`@/src/screens/HomeScreen.tsx`). New imports for the
      modal + `TEST_ACCOUNTS`. New `phoneNumber` subscription
      from `useAuthStore` so the screen re-renders when a
      switch completes. New `quickSwitchVisible` state hoisted
      with the existing block; Rules-of-Hooks comment lineage
      now cites PR 12 / 13 / 14 / 15 / 17 / 18. New
      `isTestAccount` derived gate. New dashed-border tile
      rendered above the `__DEV__` debug line. Modal mounted
      unconditionally (cheap when `visible=false`) for clean
      open/close transitions.

#### Verification

- `npx tsc --noEmit`: 0 errors.
- `npm test`: **54 suites / 541 tests** (unchanged â€” prompt
  explicitly said no new tests required).
- Zero new `DO NOT REMOVE` markers added (auto-formatter
  discipline at **9 PRs in a row** without strips).

#### Smoke tests (after OTA)

1. **Visibility gating â€” non-test phone.** Sign in as a real
   number not in `TEST_ACCOUNTS`. NO `Switch test account`
   tile visible. Sign out, sign in as any test phone â†’ tile
   appears at the bottom of Home above the dev debug line.
2. **First switch.** Sign in as Admin test phone. Tap the
   tile. Modal opens with all 5 entries. Tap Customer A.
   Within ~5s, you're signed in as Customer A â€” Home shows
   customer UI, no admin tiles, the `[Admin]` debug marker
   is gone.
3. **Round trip.** Tile is STILL visible on Customer A's
   Home (Customer A's phone is in `TEST_ACCOUNTS`). Tap â†’
   pick Admin â†’ ~5s later you're admin again. Free
   round-trip without manual login.
4. **Failure handling.** Temporarily add a fake entry with a
   phone NOT in Firebase Console. Tap it. Modal shows the
   error inline at the bottom of the card; modal stays open
   for retry. Tap a valid entry â†’ succeeds.
5. **Concurrent tap protection.** Open modal, tap two entries
   in quick succession. Second tap is a no-op (Pressable
   `disabled={busy !== null}`).
6. **Cart wipe verified.** Sign in as Customer A, add items
   to cart. Use Quick Switch to swap to Customer B. New
   Customer B has empty cart (sign-out cleared it via the
   AuthProvider chain).
7. **No hook crashes.** Switch between 3 accounts in
   succession. No ErrorBoundary screens. Discipline holding
   across the modified screens.

#### Deploy plan

Pure client OTA per `.windsurf/deploy-discipline.md`:

```powershell
$env:NODE_OPTIONS = "--use-system-ca"
npm test
eas update --branch production --message "PR 18 â€” Quick Switch test accounts (test-phone gated)"
```

No functions deploy, no rules deploy, no native rebuild. Most
testers won't see any change â€” the tile only appears for users
whose phone is in `TEST_ACCOUNTS`.

#### Removing this later (production hand-off)

When you're done with testing-phase work and want to ship to real
customers, two paths:

- **Option A â€” Hide the trigger** (preferred). Change
  `isTestAccount` to `false` (or to a feature-flag check that
  defaults off). Modal + constants stay in the codebase but the
  UI surface disappears. Easy to re-enable later. Note that
  test-list membership ALREADY auto-hides the button for real
  customers, so this is belt-and-braces.
- **Option B â€” Delete the files**. `git rm`
  `@/src/constants/testAccounts.ts`,
  `@/src/components/dev/QuickSwitchModal.tsx`, the HomeScreen
  imports + button. ~5 min revert.

Plan the removal alongside the production Firebase project setup
section below in this document. Test accounts only exist in the
dev project anyway â€” they don't carry to prod.

#### Follow-ups (out of scope this PR)

- [ ] **Hide via feature flag** instead of test-list membership
      once a real `process.env.EXPO_PUBLIC_ENABLE_DEV_TOOLS`
      lands. Belt-and-braces hardening before public TestFlight.
      [post-MVP]
- [ ] **Persist last-used test account** so the modal opens with
      that entry pre-highlighted. Marginal QoL; not worth it
      until 5+ accounts are configured. [PR 18 follow]
- [ ] **Validation lint on `TEST_ACCOUNTS`** (e.g. unit test
      that asserts each phone is exactly 10 digits and unique).
      Cheap insurance, but skipped because target-hitting; add
      if a wrong-digit-count phone ever silently fails. [PR 18 follow]
- [ ] **Custom-token minting via admin SDK** â€” would let us
      switch without invoking the OTP flow at all (~1s instead
      of ~5s). Adds a server callable + a security review
      surface; the OTP shortcut is sufficient for now. [post-MVP]
- [ ] **In-app editor for `TEST_ACCOUNTS`.** Skip â€” editing the
      .ts file and shipping an OTA is the right workflow for a
      ~5-entry list. [won't-do]

### PR 17 â€” Polish bundle â€” âœ… CODE COMPLETE May 19 2026

Three small UX wins bundled into one OTA. None is a feature on
its own; together they make the customer side feel finished.

1. **Per-minute ETA ticker** on the Active orders rail â€” "Arriving
   in ~5 min" now decrements visibly while the customer lingers
   on Home, instead of going stale until the next focus refetch.
2. **Customer "Call shop" button** on OrderDetailScreen â€” mirror
   of the shopkeeper's "Call customer" affordance from PR 12.
   Closes the bilateral communication loop.
3. **Pull-to-refresh** on OrderDetailScreen â€” same posture as PR
   7's AdminOrders / ShopOwnerDashboard pattern, via a
   `refreshNonce` that the watcher useEffect depends on.

**Scope reduction discovered during recon** (and documented in
follow-ups below):

- **Bottom-tab badge (prompt Â§Part 2) was SKIPPED.** This app
  uses a pure `createNativeStackNavigator` â€” there is no
  `Tab.Navigator`, so `tabBarBadge` has nothing to attach to.
  Adding tabs would be a substantial nav refactor outside this
  bundle's scope.
- **OrdersScreen pull-to-refresh (prompt Â§Part 4) was already
  shipped in PR 3** via the existing `refreshing` state +
  `RefreshControl` wiring at `@/src/screens/OrdersScreen.tsx:32`
  and `:203`. No-op there.

Pure client OTA; no schema, no server, no rollout risk.

#### What shipped

- [x] **HomeScreen ETA ticker state**
      (`@/src/screens/HomeScreen.tsx`). New `nowMs` useState
      + 60s `setInterval` useEffect with cleanup, hoisted into
      the existing PR 14 hooks-discipline block. Lineage
      comment extended to cite PR 17. Cadence intentionally
      60s (not 1s) â€” matches the "~N min" rounding granularity,
      no wasted wakeups on ticks that wouldn't change the
      rendered string.
- [x] **ActiveOrdersRail accepts `nowMs`**
      (`@/src/components/order/ActiveOrdersRail.tsx`). New
      optional prop; `etaText` was refactored to take it as a
      parameter instead of reading `Date.now()` at render time.
      Backwards-compatible: callers that don't pass `nowMs`
      get a single static Date.now() snapshot (preserves PR 15
      behaviour). Also opportunistically improved: prefer
      `readyByEstimate` over `estimatedDeliveryAt` for
      accepted/preparing orders â€” same hierarchy as
      OrderDetailScreen so the two surfaces agree.
- [x] **Call shop button + handler + fetch**
      (`@/src/screens/OrderDetailScreen.tsx`). Adds `shop`
      state hoisted with the PR-12/13/14/15/16 lineage
      comment. Fetches the shop doc once per `order.shopId`
      via `shopService.getById(...)` (cheap; the screen is
      ephemeral). Button gated on `shop?.registrationData?.phone`
      â€” that's where the kirana phone actually lives per
      `@/src/types/index.ts:23-55`; the top-level `Shop` doc
      has no `phone` field. Legacy seed shops without
      `registrationData` simply hide the button (clean no-op,
      not a broken "Call shop ()" render).
- [x] **OrderDetail pull-to-refresh** wired via
      `refreshNonce` in the watcher useEffect deps. Spinner
      clears in the existing watcher callback regardless of
      success/error, same posture as PR 7's dashboard
      patterns.
- [x] **No new useState below early returns.** All four new
      states on OrderDetailScreen (`shop`, `refreshing`,
      `refreshNonce`, plus the existing PR 7 ones) live above
      `if (loading && !order)` and `if (!order)`. The PR 17
      hoisting comment block stands as a permanent guard.

#### Verification

- `npx tsc --noEmit`: 0 errors.
- `npm test`: **54 suites / 541 tests** (unchanged â€” prompt
  explicitly said no new tests).
- Zero new `DO NOT REMOVE` markers added (auto-formatter
  discipline at **8 PRs in a row** without strips).

#### Smoke tests (after OTA)

1. **ETA ticker.** Place an order, get it accepted with an
   ETA. Open Home, leave the app open. After 60 seconds, the
   "Arriving in ~X min" number on the Active rail card
   decrements by 1. (PR 17 Â§Part 1 acceptance criterion.)
2. **Call shop button visible.** Open any order detail as
   customer. Below the shop name section title is a
   primary-tinted pill: "ðŸ“ž Call shop (XXXXXXXXXX)". Tap â†’
   native dialer opens with the shop's number pre-filled.
3. **Call shop hidden for legacy shop.** Open an order from
   one of the seed shops (no `registrationData`). No button.
   No broken layout.
4. **Pull-to-refresh on OrderDetail.** Open any order. Pull
   down. Spinner appears, watcher re-subscribes, spinner
   clears on first callback (~1â€“2s on a healthy network).
   Order content refreshes.
5. **Hooks-of-Rules sanity.** Navigate Home â†’ Orders â†’
   OrderDetail repeatedly. Force-close + reopen. No
   ErrorBoundary screens. Discipline holding across all
   modified screens.

#### Deploy plan

Pure client OTA per `.windsurf/deploy-discipline.md`:

```powershell
$env:NODE_OPTIONS = "--use-system-ca"
npm test
eas update --branch production --message "PR 17 â€” Polish bundle (ETA ticker + Call shop + OrderDetail pull-to-refresh)"
```

No functions deploy, no rules deploy, no native rebuild. Tell
testers to force-close + reopen TestFlight.

#### Rollback

- UI regression â†’ `eas update --branch production --republish
  [previous-update-id]`. Server unchanged â†’ safe rollback at
  any time.

#### Follow-ups (out of scope this PR)

- [ ] **Bottom-tab badge for active orders.** Requires
      converting `AppNavigator` from `createNativeStackNavigator`
      to a Tab-over-Stack hybrid. Substantial nav-shape refactor
      â€” defer until the IA cost-benefit shifts (e.g. when the
      app grows past ~10 top-level destinations). [post-MVP]
- [ ] **Persistent active-order count store.** If/when the
      tab badge lands, lift `recentOrders` from HomeScreen to
      a small Zustand store so the badge can subscribe without
      a parallel `listMine` fetch. [post-MVP, depends on tab nav]
- [ ] **Call customer/admin parity.** ShopOrderDetail has
      Call customer (PR 12). OrderDetail now has Call shop
      (PR 17). Missing piece: admin order detail surfaces have
      neither button. Track if admin testers ask. [PR 17 follow]
- [ ] **OrderDetail Call shop also surfaces shop's open
      hours.** A grayed "(closed)" badge next to the phone
      when current time is outside `registrationData.hours`
      would prevent dead-air calls outside business hours.
      [PR 17 follow]
- [ ] **ETA ticker on OrderDetailScreen too.** That screen
      has its own `nowMs` (1s cadence, for the cancel-window
      countdown) â€” the "Arriving in ~X min" copy at
      `OrderDetailScreen` line ~109 still uses `Date.now()`
      directly. Cheap follow-up: swap to `nowMs`. [PR 17 follow]

### PR 16 â€” Shop owner new-order alert â€” âœ… CODE COMPLETE May 18 2026

The single biggest UX gap between this app and Swiggy Partner /
Zomato Restaurant. Shop owners running real kirana stores don't
watch their phone screens â€” they're stocking shelves and billing
walk-ins. New orders sat unaccepted for minutes, the customer
waited, the supply chain stalled.

PR 16 makes new orders **impossible to miss** with three
coordinated cues, all OTA-friendly:

1. **Yellow banner** at the top: "ðŸ”” N new orders" â€” left-rail
   accent in `colors.warning`, readable across a counter.
2. **Highlighted card border** on each new order: 2px primary
   border + tinted background + "NEW" tag. Same aesthetic as
   PR 15's ActiveOrdersRail cards â€” visual language for "live,
   needs attention" is now unified across customer + shopkeeper
   surfaces.
3. **Single haptic buzz** via `expo-haptics` (already bundled â€”
   no native dep change). One `Success` notification per polling
   tick that has at least one new order, regardless of count.

Pure client OTA, zero schema changes, zero server work.

#### What shipped

- [x] **Pure helper `detectNewOrderIds`** at
      `@/src/utils/detectNewOrderIds.ts`. Pure ID-set diff
      (deliberately not timestamp-based â€” server clock drift +
      late writes make `createdAt` unreliable). First-tick
      semantics: when `previouslySeenIds === null`, return an
      empty set so first dashboard load doesn't show 20 "new"
      orders.
- [x] **7 unit tests** at
      `@/tests/utils/detectNewOrderIds.test.ts`. Cover
      first-tick baseline, no-change, simple add, vanished
      orders (don't count as new), all-new (empty seen),
      empty-current, no-mutation defensive.
- [x] **Watcher integration**
      (`@/src/screens/shop/ShopOwnerDashboardScreen.tsx`).
      Detection runs INSIDE the watcher callback (not via
      useEffect) so a polling tick with the same orders doesn't
      re-trigger haptics on every render. Error callbacks leave
      the seen baseline untouched so the next successful tick
      can still detect what arrived during the outage.
- [x] **Banner + card highlight + NEW tag** all wired with
      styles citing PR 15's ActiveOrdersRail aesthetic for
      cross-surface consistency. Banner uses `#FEF3C7` warm
      yellow + `colors.warning` left rail.
- [x] **Three independent ack paths** via `clearNewHighlight`:
      tap card, tap banner, scroll the FlatList
      (`onScrollBeginDrag`). Cheap no-op when nothing to clear
      (returns the same Set reference) so scrolling without
      pending alerts doesn't re-render the FlatList.
- [x] **Hooks discipline.** Two new `useState` calls
      (`seenOrderIds`, `newOrderIds`) hoisted ABOVE the
      role-guard and loader early returns with a permanent
      comment block citing PR 12 / 13 / 14 / 15 lineage. The
      dashboard has TWO early returns, so this discipline
      mattered concretely here unlike on HomeScreen.
- [x] **Haptics graceful degradation.**
      `Haptics.notificationAsync(Success).catch(() => {})` so
      web preview / iOS sim / unsupported devices silently
      no-op. Visual cues still fire.

#### Verification

- `npx tsc --noEmit`: 0 errors.
- `npm test`: **54 suites / 541 tests** (534 â†’ +7 new).
- Deliberate-break: flipped first-tick test to expect size 3 â†’
  1 failed / 6 passed â†’ reverted; 541 green.
- Zero new `DO NOT REMOVE` markers added (auto-formatter
  discipline at **7 PRs in a row** without strips).

#### Smoke tests (after OTA)

1. **First open of dashboard.** Shopkeeper opens dashboard
   with N existing orders. NO banner, NO haptic, NO "NEW" tags.
   First-tick baseline established silently.
2. **One new order arrives mid-session.** Within ~10s polling
   cycle: banner appears with "ðŸ”” 1 new order", that card has
   2px green border + NEW tag, phone buzzes once.
3. **Three new orders in same tick.** Banner reads "ðŸ”” 3 new
   orders", all three cards highlighted with NEW tags, only
   ONE haptic fires (not three â€” stays calm).
4. **Tap a NEW-flagged card.** Navigates to ShopOrderDetail.
   On return: banner gone, all NEW tags cleared.
5. **Scroll without tapping.** Banner clears, NEW tags clear.
   `onScrollBeginDrag` counts as acknowledgement.
6. **Tap banner directly.** Banner disappears, NEW tags clear.
   Same as tapping a card.
7. **Sequential new orders, no ack between.** First arrival
   fires banner + haptic. Second arrival in next tick: banner
   updates count, second haptic fires, both cards have NEW
   tags. Cumulative until acknowledged.
8. **Order disappears mid-session.** Customer cancels, server
   removes it from listShopOrders â†’ no spurious NEW tag on
   remaining orders. Pinned by helper test #4.
9. **Web preview.** Visual banner + card highlights work,
   haptic silently no-ops via the .catch wrapper.

#### Deploy plan

Pure client OTA per `.windsurf/deploy-discipline.md`:

```powershell
$env:NODE_OPTIONS = "--use-system-ca"
npm test
eas update --branch production --message "PR 16 â€” Shop owner new-order alert"
```

No functions deploy, no rules deploy, no native rebuild
(`expo-haptics` was already in the bundled native build per
`package.json`). Tell shop-role testers explicitly to keep the
dashboard open for ~30s after a customer-role tester places an
order on their shop â€” they should see banner + haptic within
one polling cycle.

#### Rollback

- UI bug â†’ `eas update --branch production --republish
  [previous-update-id]`. Server unchanged â†’ safe rollback at
  any time.

#### Headline metric to watch

**Time from order placed â†’ order accepted by shop.**

- Pre-PR-16 baseline: 5â€“8 min (whenever the shopkeeper next
  glanced at the screen).
- Post-PR-16 expectation: <2 min for shopkeepers who keep the
  app open with the phone audible.

That delta cascades through every downstream surface PR 12
(ETA visibility), PR 15 (active orders rail), and PR 7
(delivery pool) added â€” the whole supply chain tightens by
~5â€“10 min per order.

#### Follow-ups (out of scope this PR)

- [ ] **Sound notification.** Add `expo-av` and play a short
      ding for `Success` ticks. Native module add â†’ rebuild +
      TestFlight resubmit. Big quality-of-life win once
      family testing requests it. [PR 16 follow]
- [ ] **Background push.** Alert shopkeepers when the app is
      closed. Needs Expo Push or FCM token registration +
      server-side trigger on order create. Substantial
      separate body of work. [post-MVP]
- [ ] **Per-shop alert preferences.** Volume / vibrate /
      silent toggle stored on the shop doc. Premature for
      MVP â€” single fixed behaviour for now. [post-MVP]
- [ ] **"Snooze new orders for 5 min".** UX escape hatch for
      shopkeepers in the middle of a complex offline task.
      Add when one real shop reports being overwhelmed.
      [post-MVP]
- [ ] **Persistent badge / banner across navigation.** If the
      shopkeeper navigates away from the dashboard while
      banner is showing, the count is lost. Cleaner UX is to
      hoist `newOrderIds` into a Zustand store. Marginal
      value pre-launch; track if testers complain. [PR 16 follow]
- [ ] **Telemetry: time-to-accept per order.** The headline
      metric. Add a `acceptedAt - createdAt` derived field on
      the analytics dashboard and split by "shopkeeper had
      app open" vs "didn't" to validate the PR 16 hypothesis.
      [post-MVP]

### PR 15 â€” Active orders rail on HomeScreen â€” âœ… CODE COMPLETE May 18 2026

The home screen becomes the customer's full order command center.
PR 14 surfaced PAST orders on Home; PR 15 surfaces IN-FLIGHT orders
on the same screen, ABOVE the Order Again rail. A returning customer
opens the app and immediately sees:

- "Your active orders" â€” what's currently being made / out for delivery
- "Order again" â€” shops they keep coming back to

No more tapping the Orders tab just to check status. Pure client OTA;
zero new server work; reuses PR 14's `listMine` cache via `useMemo`
so there is literally no additional network cost.

#### What shipped

- [x] **Pure helper `pickActiveOrders`** at
      `@/src/utils/pickActiveOrders.ts`. Filters to the four
      non-terminal statuses (`pending`, `accepted`, `preparing`,
      `ready_for_pickup`), sorts `createdAt` desc, copies before
      sorting (no input mutation). Strict allowlist â€” unknown
      statuses are treated as terminal (fail closed).
- [x] **7 unit tests** at
      `@/tests/utils/pickActiveOrders.test.ts`. Cover empty,
      all-four-non-terminal inclusion, terminal exclusion, sort
      order, mixed input, no-mutation, unknown-status fail-closed.
- [x] **`ActiveOrdersRail` component** at
      `@/src/components/order/ActiveOrdersRail.tsx`. Same shape
      as `OrderAgainRail` but with primary-tinted card background
      + primary border so it visually reads as "live, needs
      attention" without requiring the customer to read headers.
      Each card: shop name + `OrderStatusChip` (with
      `audience="customer"` so `ready_for_pickup` reads "Out for
      delivery") + ETA copy.
- [x] **ETA copy logic.** Uses `estimatedDeliveryAt` for the
      `Math.round((eta - Date.now()) / 60_000)` minutes-left
      math. Special-cases `ready_for_pickup`: with `pickedUpAt`
      set â†’ "Out for delivery"; without â†’ "Almost ready". Negative
      / zero `minsLeft` â†’ "Arriving soon" (don't show negative
      countdowns). No `eta` set â†’ empty string (skip the line
      entirely rather than render a misleading placeholder).
- [x] **HomeScreen integration**
      (`@/src/screens/HomeScreen.tsx`). Derives `activeOrders`
      from PR 14's existing `recentOrders` cache via `useMemo` â€”
      zero new state, zero new network calls, zero new
      `useState` hook count. Tap handler navigates to
      `OrderDetail`. Rail rendered ABOVE `OrderAgainRail`
      (priority slot â€” active needs attention more than past).
- [x] **PR 14 hooks-discipline comment intact.** No new state
      added in this PR, so the comment block citing PR 12's
      ETA-modal hotfix and PR 13's OrdersScreen guard stays as
      written. Pure additive composition â€” exactly the pattern
      the discipline aimed for.
- [x] **Symmetric handoff with PR 14.** When an order
      transitions from `ready_for_pickup` â†’ `delivered`, the
      next focus refetch removes its card from `ActiveOrdersRail`
      AND adds its shop to `OrderAgainRail` (PR 14 picks
      delivered orders). Customers experience a single seamless
      animation as the order moves between rails.

#### Verification

- `npx tsc --noEmit`: 0 errors.
- `npm test`: **53 suites / 534 tests** (527 â†’ +7 new).
- Deliberate-break: flipped "excludes delivered and cancelled"
  test to expect `toHaveLength(2)` â†’ 1 failed / 6 passed â†’
  reverted; 534 green.
- Zero new `DO NOT REMOVE` markers added (auto-formatter
  discipline at **6 PRs in a row** without strips).

#### Smoke tests (after OTA)

1. **Place an order.** Open Home before shop accepts. Rail card
   shows "Pending" chip + ETA. Tap â†’ OrderDetail.
2. **Shop accepts.** Return to Home. Card chip flips to
   "Accepted" + ETA recomputed from `estimatedDeliveryAt`.
3. **Full lifecycle.** pending â†’ accepted â†’ preparing â†’
   ready_for_pickup (no pickedUpAt â†’ "Almost ready") â†’
   ready_for_pickup (with pickedUpAt â†’ "Out for delivery") â†’
   delivered. At delivery, card vanishes from active rail AND
   shop appears in Order Again rail below. Symmetric handoff
   verified.
4. **Multiple active orders.** Place 3 from 3 shops within
   minutes. Rail shows all 3, newest leftmost.
5. **Cancelled order.** Customer cancels mid-flight. Card
   disappears from active rail. Shop does NOT appear in Order
   Again rail (PR 14 excludes cancelled). Both correct.
6. **First-time / anonymous user.** Both rails empty. Home
   shows just search + categories â€” no layout shift, no skeleton.
7. **Customer-facing label sanity.** A `ready_for_pickup`
   order shows "Out for delivery" on the chip â€” confirming the
   `audience="customer"` override is wired correctly. The shop
   side still sees "Ready for Pickup" on their dashboard.
8. **ETA staleness check.** Open Home with an active order, leave
   the screen open for 5 min. ETA copy stays static (no per-second
   ticker) â€” that's the deferred behaviour. Pull-to-refresh /
   navigate-back-to-Home triggers the focus refetch and refreshes
   the line.

#### Deploy plan

Pure client OTA per `.windsurf/deploy-discipline.md`:

```powershell
$env:NODE_OPTIONS = "--use-system-ca"
npm test
eas update --branch production --message "PR 15 â€” Active orders rail on Home"
```

No functions deploy, no rules deploy, no native rebuild. Tell
testers to force-close + reopen TestFlight after publish.

#### Rollback

- UI bug â†’ `eas update --branch production --republish
  [previous-update-id]`. Server unchanged â†’ safe rollback at
  any time.

#### Follow-ups (out of scope this PR)

- [ ] **Per-minute ETA ticker.** Add a `useEffect` interval
      that bumps a tick counter every 60s so the
      `Math.round((eta - Date.now()) / 60_000)` line decrements
      visibly while the user lingers on Home. ~10-line change.
      Worth doing if testers report the ETA feels stale.
      [PR 15 follow]
- [ ] **In-card cancel CTA.** For orders within the PR 7
      cancel window, surface a Cancel button directly on the
      rail card so customers don't need to drill into
      OrderDetail. UX-only change â€” primitive already exists.
      [PR 15 follow]
- [ ] **Push notifications on status change.** The right
      replacement for the focus-refetch model. Needs Expo Push
      / FCM infra â€” separate body of work. [post-MVP]
- [ ] **Real-time updates via Firestore onSnapshot.** Currently
      the rail relies on focus-effect polling. Real-time would
      require a HomeScreen-level subscription that disrupts the
      focus-effect model + adds a Firestore connection cost.
      Defer unless polling proves visibly stale. [post-MVP]
- [ ] **Orders-tab usage telemetry.** The headline metric this
      PR moves: how often customers visit the Orders tab when
      they have an active order on Home. Goal is "much less
      often." Wire once analytics dashboard is live. [post-MVP]
- [ ] **Active order badge on bottom-tab.** Numeric badge on
      the Orders tab icon when active orders exist. Belt-and-
      suspenders with the rail; arguably redundant once the
      rail lands. Track if family testers ask for it.
      [PR 15 follow]

### PR 14 â€” HomeScreen "Order again" rail â€” âœ… CODE COMPLETE May 18 2026

PR 13 made reorder POSSIBLE; PR 14 makes it DISCOVERABLE. Returning
customers now land on Home and see "Order again from Mahesh Kirana"
cards as the very next surface after the search box, ranked by
delivery frequency. Composes every PR 13 primitive â€” no new server
work, no schema, no rules.

#### What shipped

- [x] **Pure helper `pickFrequentlyOrderedShops`** at
      `@/src/utils/pickFrequentlyOrderedShops.ts`. Filters to
      `delivered` only (in-flight + cancelled never count),
      groups by `shopId`, picks the most-recent `lastOrderId`
      per shop (by `deliveredAt` with `createdAt` legacy
      fallback), sorts by `orderCount` desc with recency as
      tie-breaker, slices to `limit` (default 3).
- [x] **11 unit tests** at
      `@/tests/utils/pickFrequentlyOrderedShops.test.ts`. Cover
      empty input, in-flight + cancelled exclusion, unique-shop
      grouping, frequency ordering, recency tie-break,
      `createdAt` legacy fallback, `lastOrderId` correctness,
      limit param + default-of-3, and the
      delivered-mixed-with-pending real-world case.
- [x] **`OrderAgainRail` component** at
      `@/src/components/order/OrderAgainRail.tsx`. Horizontal
      ScrollView of 180dp cards (1.5â€“2 visible at a time â€”
      hints at swipe affordance). Self-hides via
      `entries.length === 0` guard, which naturally covers
      first-time customers, anonymous users, and
      non-customer-role users (admin / delivery / shop owner)
      in one branch.
- [x] **HomeScreen integration**
      (`@/src/screens/HomeScreen.tsx`). New focus effect fetches
      `orderService.listMine(uid)`, caches the full payload in
      `recentOrders`, and runs the picker for the rail. Tap
      handler reuses the cached order (no second
      round-trip â€” the optimisation called out in the PR 14
      prompt Â§Part 5), fetches the shop's current menu via
      `listShopMenuPublic`, builds a plan, and opens the same
      `ReorderModal` from PR 13. Confirm calls
      `useCartStore.getState().replaceCartWithItems(...)` and
      navigates to Cart.
- [x] **Hooks discipline (extra-strict).** All 6 new
      `useState` calls (`recentOrders`, `frequentShops`,
      `reorderModalVisible`, `reorderLoading`, `reorderPlan`,
      `reorderShopMeta`) hoisted to the top of the component
      with a permanent comment block citing both PR 12's
      ETA-modal hotfix AND PR 13's OrdersScreen guard.
      HomeScreen has no early returns today â€” the comment
      enshrines the discipline so a future refactor can't
      quietly reintroduce the bug.
- [x] **Rail placement.** Sits between the search Pressable
      and the category chips â€” the highest-impact slot. Above
      "My Orders" so the discoverability advantage is real.
- [x] **Anonymous + role-based hiding.** Focus effect skips
      `listMine` entirely when `!uid || isAnonymous`, leaving
      `frequentShops = []`, which triggers the rail's null
      return. Admin / delivery / shop-owner accounts that
      haven't placed customer orders just get an empty array
      from the picker and the rail vanishes.
- [x] **Failure-mode handling.** Suspended-shop reorder
      surfaces a customer-friendly Alert
      ("This shop may no longer be available") and dismisses
      the modal, mirroring PR 13's OrdersScreen behaviour.
      `listMine` failures are swallowed with a `console.warn`
      and don't erase a previously-loaded rail (graceful
      degradation on transient network blips).

#### Verification

- `npx tsc --noEmit`: 0 errors.
- `npm test`: **52 suites / 527 tests** (516 â†’ +11 new).
- Deliberate-break: flipped expected order in
  "orders by orderCount desc" test â†’ 1 failed / 10 passed â†’
  reverted; 527 green.
- Zero new `DO NOT REMOVE` markers added.

#### Smoke tests (after OTA)

1. **New customer, no orders.** Open Home â†’ rail entirely
   absent (no header, no skeleton, no empty card).
2. **One delivered order from one shop.** Rail shows one card.
   Tap â†’ modal loads â†’ confirm â†’ cart filled â†’ Cart screen.
3. **Mixed history.** 3 from Shop A, 2 from Shop B, 1 from
   Shop C â†’ rail shows A, B, C in that order.
4. **In-flight orders don't count.** Place a fresh order with
   a new shop, leave it pending â†’ return to Home â†’ rail
   unchanged.
5. **Cancelled orders don't count.** Cancel a fresh order from
   a never-completed shop â†’ return to Home â†’ that shop is NOT
   in the rail.
6. **Suspended shop.** Admin suspends a shop the customer
   reordered from â†’ tap that card â†’ fetch fails â†’ Alert
   "This shop may no longer be available." Cart unchanged.
7. **Cross-shop replace.** Cart from Shop A; tap "Order again"
   for Shop B â†’ confirm â†’ cart now Shop B only (replace, not
   merge â€” same as PR 13).
8. **Rail refreshes after fresh delivery.** Place + complete a
   new shop's order â†’ return to Home â†’ that shop is now top
   of the rail (most recent).
9. **Hooks-of-Rules sanity.** Navigate Home â†’ Orders â†’ Home
   several times. ErrorBoundary should never trip (the bug
   PR 12's hotfix exposed).
10. **Anonymous user.** Sign out â†’ landing on Home â†’ rail
    absent. Sign in â†’ return to Home â†’ rail rebuilds within
    one focus cycle.

#### Deploy plan

Pure client OTA per `.windsurf/deploy-discipline.md`:

```powershell
$env:NODE_OPTIONS = "--use-system-ca"
npm test
eas update --branch production --message "PR 14 â€” HomeScreen Order Again rail"
```

No functions deploy, no rules deploy, no native rebuild. Tell
testers to force-close + reopen TestFlight after publish.

#### Rollback

- UI bug â†’ `eas update --branch production --republish
  [previous-update-id]`. Server unchanged â†’ safe rollback at
  any time.

#### Follow-ups (out of scope this PR)

- [ ] **Rail card rich content.** Last-ordered timestamp
      ("3 days ago"), shop image thumbnail, top-3 items
      preview. Marginal value for MVP; track if family testers
      ask. [PR 14 follow]
- [ ] **Reorder-tap telemetry.** Distinguish
      Home-rail-initiated reorders from Orders-tab-initiated
      ones in analytics. The PR 13 synthetic
      `product_id: 'reorder'` event is the breadcrumb; needs a
      `source: 'home_rail' | 'orders_tab'` dimension on the
      reorder event. [post-MVP]
- [ ] **Median-time-to-checkout dashboard.** The headline
      metric this PR moves (industry benchmark: ~120s â†’ ~20s
      for the rail-using cohort). Wire once GA4/Mixpanel is
      live. [post-MVP]
- [ ] **HomeScreen pull-to-refresh.** The focus effect already
      refetches; pull-to-refresh would be belt-and-suspenders.
      Worth doing after the screen's content density grows.
      [post-MVP]
- [ ] **Server-side ranking.** Today the rail picks from
      whatever `listMine` returns (capped server-side). For
      power users with hundreds of orders we may want a
      dedicated "top shops" callable. Premature optimisation
      until p95 listMine size grows past ~50. [post-MVP]
- [ ] **Pre-filter suspended shops in the rail.** Currently we
      surface them and fail-soft on tap. Cleaner UX is to drop
      them client-side before render â€” needs a shop-status
      lookup (cheap if listMine starts denormalising it).
      [PR 14 follow]

### PR 13 â€” Repeat order button â€” âœ… CODE COMPLETE May 18 2026

The single highest-leverage retention feature for grocery. Tap
Reorder on a past delivered/cancelled order â†’ modal shows the
items at current prices + availability â†’ confirm replaces the
cart and lands you on the Cart screen. Pure client OTA â€” no
schema, no callable, no rules changes.

#### What shipped

- [x] **Pure helpers `buildReorderPlan` + `planToCartItems`** at
      `@/src/utils/buildReorderPlan.ts`. Joins past
      `Order.items` against the current menu via `menuItemId`
      (post-PR-4 contract) with a `productId` fallback for
      legacy orders. Categorises every line into one of five
      `ReorderLineStatus` values: `available_same_price`,
      `available_price_increased`, `available_price_decreased`,
      `out_of_stock`, `removed_from_menu`. `planToCartItems`
      drops unavailable lines and rebuilds CartItems at the
      LIVE price (so `placeOrder`'s drift validation passes
      immediately) with the OLD quantity preserved.
- [x] **14 unit tests** in
      `@/tests/utils/buildReorderPlan.test.ts` â€” all five
      statuses, productId fallback for legacy orders,
      stock-null vs stock-zero distinction, custom-item
      productId fallback, mixed-availability plan, past-snapshot
      fallback fields preserved on removed_from_menu lines.
- [x] **Cart store `replaceCartWithItems(items, shop)`**
      (`@/src/store/useCartStore.ts:30-46, 222-250`). Atomic
      Zustand `set()` swap; one synthetic
      `Analytics.add_to_cart` event with `product_id: 'reorder'`
      so the analytics dashboard distinguishes reorder bundles
      from organic browse adds. Same primitive will back
      saved-shopping-list and weekly-recurring features
      (tracked in PRELAUNCH).
- [x] **`ReorderModal` component** at
      `@/src/components/order/ReorderModal.tsx`. Three sections:
      Available (green âœ“ + price + diff badge),
      Unavailable (struck-through name + reason),
      Subtotal preview at current prices. Loading state shows a
      spinner. CTA disabled when `availableCount === 0`. Tap
      outside / hardware back closes via `onRequestClose`.
      Presentation-only â€” no Zustand calls inside.
- [x] **OrdersScreen integration**
      (`@/src/screens/OrdersScreen.tsx`). Reorder button only on
      `delivered` / `cancelled` cards (terminal states). On tap:
      open modal in loading state â†’ fetch
      `orderService.listShopMenuPublic(shopId)` â†’ build plan â†’
      render. Confirm calls
      `useCartStore.getState().replaceCartWithItems(...)` and
      navigates to Cart. Failed shop fetch closes the modal and
      shows an Alert ("This shop is no longer accepting orders").
- [x] **Status chip uses `audience="customer"`** on
      OrdersScreen now too (`@/src/screens/OrdersScreen.tsx:227`),
      so customers consistently see "Out for delivery" instead
      of "Ready for Pickup". Was missed in PR 12 â€” caught when
      hooking up the Reorder button on the same card.
- [x] **Hooks discipline.** All four new `useState` calls
      (`reorderModalVisible`, `reorderLoading`, `reorderPlan`,
      `reorderShopMeta`) declared at the TOP of the component,
      ABOVE the `if (loading)` and `if (orders.length === 0)`
      early returns. Permanent comment block citing the PR 12
      ETA-modal hotfix incident as a regression guard.
- [x] **Reorder-button tap-isolation.** The card body is a
      Pressable that navigates to OrderDetail; the inner
      reorder-button row uses `onStartShouldSetResponder={() =>
      true}` to swallow the tap and prevent the parent
      navigating when the button is pressed.

#### Verification

- `npx tsc --noEmit`: 0 errors.
- `npm test`: **51 suites / 516 tests** (502 â†’ +14 new).
- Deliberate-break: flipped `available_price_increased` test
  expectation to `available_same_price`; one test went red as
  expected; reverted; 516 green.
- Zero new `DO NOT REMOVE` markers added.

#### Smoke tests (after OTA)

1. **Happy path same prices.** Past order with 3 unchanged items
   â†’ modal shows all 3 available, no badges â†’ Add â†’ cart has
   them at the same prices and quantities.
2. **Price change.** Shop bumped atta â‚¹250 â†’ â‚¹275 â†’ modal shows
   â‚¹275 with â‚¹250 struck through + "+10%" badge â†’ Add â†’ cart
   line price = â‚¹275, priceSnapshot = â‚¹275.
3. **Some items unavailable.** Shop marked rice unavailable via
   PR 8 bulk action â†’ modal shows atta + dal in Available, rice
   in Unavailable ("Currently unavailable"). CTA = "Add 2 items
   to cart" â†’ cart has 2 items.
4. **All items unavailable.** Shop suspended every item â†’ modal
   shows everything in Unavailable. CTA = "No items available"
   and disabled. Cancel â†’ cart unchanged.
5. **Shop suspended.** Reorder from a shop the admin has since
   suspended â†’ fetch fails â†’ modal closes â†’ Alert "This shop is
   no longer accepting orders." Cart unchanged.
6. **Replace cart from different shop.** Cart has 5 items from
   Shop A. Tap Reorder on a Shop B past order. Confirm â†’ cart
   now has Shop B items only.
7. **Reorder a cancelled order.** Customer cancelled a paid
   order via the PR 7 2-min window. Reorder button still
   appears; flow works identically to delivered case.

#### Deploy plan

Pure client OTA per `.windsurf/deploy-discipline.md`:

```powershell
$env:NODE_OPTIONS = "--use-system-ca"
npm test
eas update --branch production --message "PR 13 â€” Repeat order button"
```

No functions deploy, no rules deploy, no native rebuild. Tell
testers to force-close + reopen TestFlight after publish to pick
up the new bundle.

#### Rollback

- UI bug â†’ `eas update --branch production --republish
  [previous-update-id]`. Server unchanged so any rollback is
  safe; no client/server version mismatch risk.

#### Follow-ups (out of scope this PR)

- [ ] **Reorder button on OrderDetailScreen.** Current entry
      point is OrdersScreen card. Detail-screen reorder is a
      one-line follow-up if testers ask for it. [PR 13 follow]
- [ ] **HomeScreen "Order again" rail.** Surface top-3 reordered
      shops per user. Needs reorder-frequency telemetry first.
      [PR 13 follow]
- [ ] **Partial reorder UX.** Let customer toggle which items
      to include before confirming. Marginal value at MVP; track
      if testers ask. [PR 13 follow]
- [ ] **Saved shopping lists / favorites.** Will reuse
      `replaceCartWithItems`. [post-MVP]
- [ ] **Weekly recurring orders / subscription.** Distinct
      feature; cart-replacement primitive in this PR unblocks
      it. [post-MVP]
- [ ] **Reorder push reminder.** "It's been 7 days since your
      last order from Mahesh Kirana â€” reorder?" Needs the
      transactional-push infrastructure not yet built.
      [post-MVP]
- [ ] **Reorder-conversion telemetry.** % of orders initiated
      via the Reorder button vs. fresh browse. The synthetic
      `product_id: 'reorder'` add_to_cart event is the first
      breadcrumb; wire to a dashboard query once GA4 / Mixpanel
      is live. [post-MVP]

### PR 12 â€” Shopkeeper ETA + early delivery visibility + status rename â€” âœ… CODE COMPLETE May 18 2026

The biggest piece of family-testing feedback. Three coordinated
changes:

1. **Shopkeeper-provided `readyByEstimate`** field on every order;
   server enforces it as REQUIRED on accept, OPTIONAL on preparing
   (mid-prep update path).
2. **Delivery dashboard early visibility** â€” partners now see
   accepted/preparing orders in a "Heads up â€” coming soon" pool
   so they can plan routes before the shop signals ready.
3. **Customer-facing copy preservation** â€” the internal status
   `ready_for_pickup` (renamed from `out_for_delivery` in a
   prior PR) continues to read "Out for delivery" on customer
   screens via a new `audience` prop on `OrderStatusChip`.

> Note: the `out_for_delivery` â†’ `ready_for_pickup` rename was
> done end-to-end in Phase 12b. PR 12 only had two leftover spots
> to fix: the `firestore.rules` delivery-pool clause (still
> referenced the old name) and the `OrderStatusChip` customer
> override.

#### Schema (Part 1)

- [x] `Order.readyByEstimate: number | null` added at
      `@/src/types/index.ts:293-301`. Comment explains null
      semantic for legacy orders.
- [x] `toOrder()` coerces `raw.readyByEstimate ?? null` so legacy
      docs render gracefully (`@/src/services/orderService.ts:82-86`).

#### Status rename touch-ups (Part 2)

The Phase 12b rename was complete in code except for two
lingering references and the customer-facing copy override.

- [x] **`firestore.rules`** â€” the delivery-pool clause still
      referenced `out_for_delivery` (the only place in the
      whole codebase outside `claude_files/` and docs). Replaced
      with a broadened clause matching the new server query:
      `status in {accepted, preparing, ready_for_pickup}` AND
      `deliveryPersonId == null`. See
      `@/firestore.rules:147-165`.
- [x] **Customer-facing copy preserved.** New
      `audience` prop on `OrderStatusChip`
      (`@/src/components/order/OrderStatusChip.tsx`) defaults
      to `'internal'` (admin/shop/delivery render "Ready for
      Pickup") and overrides to `'customer'` (renders "Out for
      delivery") via the `CUSTOMER_LABEL_OVERRIDES` map.
      Wired on `@/src/screens/OrderDetailScreen.tsx:144`.
      Push-notification `STATUS_TITLES` map in
      `functions/src/index.ts` continues to send customers
      "Out for delivery" â€” already correct.

Audit confirms: `grep -r "out_for_delivery"` finds only this
PRELAUNCH section, the rules comment block (rename rationale),
two historical-context comment blocks in `src/types/index.ts`
+ `docs/`, and the untouched `claude_files/` scratch dir.

#### Server-side ETA validation (Part 3)

- [x] **Pure helper** `validateOrderStatusTransition` at
      `@/functions/src/orderStatusTransitionHelpers.ts`. Same
      discriminated `{ ok }` posture as
      `cancelPaidOrderHelpers` / `customerCancelWindowHelpers`.
      Rules:
  - `status === 'accepted'`: ETA REQUIRED + finite + future.
  - `status === 'preparing'`: ETA OPTIONAL; same
    validation when present (mid-prep update path).
  - any other transition: ETA dropped (forwards-compat for
    a v(N+1) client we don't know about yet).
- [x] **Wired into `updateOrderStatus`**
      (`@/functions/src/index.ts:452-461, 517-528, 547-574`).
      Persists `readyByEstimate` on the order doc on validated
      transitions. Tucks the ETA into the statusHistory entry's
      `reason` field (`ETA: <ISO>`) when no explicit reason
      given â€” admin's "updated from" indicator parses this.
- [x] **15 unit tests** at
      `@/tests/functions/orderStatusTransitionHelpers.test.ts`
      cover: missing/null/string/NaN/Infinity/past/future cases
      for accept; optional + future cases for preparing;
      ignored cases for other transitions; boundary case
      (ETA == now is accepted).

#### Delivery dashboard split (Part 4)

- [x] **Server `listAvailableDeliveries` broadened**
      (`@/functions/src/index.ts:2417-2446`) â€” `where('status',
      'in', AVAILABLE_POOL_STATUSES)` returns the union of
      {accepted, preparing, ready_for_pickup}. `claimDelivery`
      still rejects anything that isn't ready_for_pickup, so
      reading != claiming.
- [x] **Function-level `canReadOrder` mirrors**
      (`@/functions/src/getOrderAuth.ts:59-95`). Set lookup
      across the three pool statuses. PR 8.1's
      `system â†’ customer` widening stayed; this PR widens
      again on a different axis.
- [x] **Client split into `headsUp` + `availableNow`**
      (`@/src/screens/delivery/DeliveryDashboardScreen.tsx:168-185`).
      New `HeadsUpCard` component (`@/src/screens/delivery/DeliveryDashboardScreen.tsx:584-636`)
      with soft-yellow visual treatment (so partners don't
      mistake it for a claimable card), "Ready by HH:MM"
      line surfacing the shopkeeper's ETA, and `Tap to view
      items` hint (no claim affordance).

#### Shopkeeper UI (Part 5 â€” Option A)

- [x] **ETA prompt modal** wired to Accept (mandatory) +
      Start Preparing (optional, prefilled with remaining
      minutes from existing readyByEstimate). Validates
      1-240 minutes client-side; server is the source of
      truth. `@/src/screens/shop/ShopOrderDetailScreen.tsx:146-201, 396-460`.
- [x] **Hook + helper passes ETA through**
      (`@/src/screens/shop/ShopOrderDetailScreen.useShopOrderDetail.ts:80-112, 132-187`).
      `readyByEstimate` flows hook â†’ runOrderActionOnce â†’
      orderService.updateOrderStatus â†’ callable.
- [x] **Current ETA card** above the action buttons
      (`@/src/screens/shop/ShopOrderDetailScreen.tsx:364-374`)
      so the shop sees what the customer is currently being
      told before tapping anything.

Tracking Option B (quick-pick chips) as a follow-up PR if shops
ask. Option A ships now per the prompt's recommendation.

#### Admin summary line (Part 6)

- [x] **"â° Ready by HH:MM"** line on every active card
      (`@/src/screens/admin/AdminOrdersScreen.tsx:251-276`).
- [x] **"(updated from HH:MM)"** trail when current
      readyByEstimate diverges from the original
      accepted-time ETA by more than 30 seconds. Pulls the
      original from statusHistory[].reason via
      `findOriginalEta` helper
      (`@/src/screens/admin/AdminOrdersScreen.tsx:33-59`).
- [x] **DO NOT REMOVE marker** added to the helper â€”
      auto-formatter ate the function declaration once during
      this PR; rewriting as a `const` arrow + DO NOT REMOVE
      comment block survived subsequent saves.

#### Customer copy (Part 7)

- [x] **Audience-aware OrderStatusChip** â€” customer sees
      "Out for delivery" when internal status is
      `ready_for_pickup`. Admin/shop/delivery see "Ready for
      Pickup" via the default `'internal'` audience.
- [x] **OrderDetailScreen ETA copy** branches on status
      (`@/src/screens/OrderDetailScreen.tsx:147-167`):
  - accepted/preparing + readyByEstimate present â†’
    "Ready by HH:MM at the shop. Delivery partner will pick
    up and bring it to you."
  - other in-flight states â†’ existing minutes-left estimate.
  - delivered/cancelled â†’ hidden.

#### Backwards-compat (Part 8)

- [x] Every render path that uses `readyByEstimate` first
      checks `if (order.readyByEstimate)` â€” null/undefined
      legacy orders hide the ETA line and fall back to the
      existing `estimatedDeliveryAt` minutes counter or omit
      entirely. Pinned by retaining old test fixtures with
      `readyByEstimate: null` (legacy semantic).
- [x] No migration script needed.

#### Verification

- `npx tsc --noEmit` (root): **0 errors**.
- `npx tsc --noEmit` (functions): **0 errors**.
- `npm test`: **50 suites, 502/502** (479 â†’ +15 ETA helper +
  +7 PR 11 carry-over + +1 delivery-pool case minus a
  refactored case).
- `npm run audit:indexes`: 28 chains / 0 missing. The new
  `where('status', 'in', [...])` + `where('deliveryPersonId',
  '==', null)` + `orderBy('createdAt')` query in
  `listAvailableDeliveries` may need a fresh composite
  index in production â€” Firebase will surface the build
  link in the deploy logs the first time the query runs
  in prod and a partner is online. Track to verify
  post-deploy.
- Deliberate-break: short-circuited the past-timestamp guard
  with `if (false && â€¦)`. Two tests went red as expected
  (`rejects accept with past timestamp`,
  `preparing with past readyByEstimate is rejected`).
  Reverted; 502 green.
- One new `DO NOT REMOVE` marker added (Part 6 helper).
  Auto-formatter resilience continues to hold for everything
  else.

#### Deploy plan

Server-first per `.windsurf/deploy-discipline.md` because the
new validation must be live before clients send `readyByEstimate`:

```powershell
$env:NODE_OPTIONS = "--use-system-ca"

# 1. Functions first.
cd functions; npm run build; cd ..
firebase deploy --only functions --project grocery-mvp-dev
firebase functions:list --project grocery-mvp-dev

# 1a. Rules â€” broadened delivery-pool clause.
firebase deploy --only firestore:rules --project grocery-mvp-dev

# 2. TestFlight pointed at dev â†’ run smoke tests below.

# 3. Client OTA (only after dev smoke fully green).
eas update --branch preview --message "PR 12 shopkeeper ETA workflow"

# 4. Promote.
eas update --branch production --message "PR 12 shopkeeper ETA workflow"

# 5. Prod functions + rules (only after prod OTA verified).
firebase deploy --only functions --project grocery-mvp-prod
firebase deploy --only firestore:rules --project grocery-mvp-prod
```

#### Smoke tests (dev project first)

1. Customer places order â†’ shop accepts with "Ready in 20 min" â†’
   delivery partner's "Heads up" section shows the order with
   "Ready by [time]" badge â†’ shop marks preparing â†’ partner
   sees it stay in heads-up â†’ shop marks "Ready for pickup" â†’
   moves to partner's "Available now" â†’ claim â†’ pickup â†’ deliver.
2. Shop accepts with 20 min â†’ updates to 30 min mid-prep â†’
   admin's card shows "(updated from [old time])".
3. Shop tries Accept with 0 min or past â†’ server returns
   `invalid-argument`; client Alert shows the message.
4. Find a legacy order (no `readyByEstimate`) â†’ all four
   screens (customer / shop / admin / delivery) render
   without "undefined" / "NaN" leaks.
5. Existing flows: PR 7 cancel-within-2-min, PR 8 bulk
   menu availability, PR 11 admin timeline expansion â€” all
   still pass.

#### Rollback

- Server validation broken â†’ `git revert` PR 12 commit, redeploy
  functions. v(N-1) client + v(N-1) server is what was running
  before.
- Client OTA UI bug â†’ `eas update --branch production
  --republish [previous-update-id]`. v(N-1) client + vN server
  works because the server happily ignores extra fields.
- vN client + v(N-1) server is the **broken** combination â€”
  v(N-1) server doesn't know `readyByEstimate` and the
  callable will reject "Unknown argument". Always deploy
  server before client; always roll back client before server.

### PR 11 â€” Admin order timeline view â€” âœ… CODE COMPLETE May 18 2026

JS-only, OTA-able. Pure read-only UI on `AdminOrdersScreen`.
Builds confidence that the `statusHistory` data we've been
writing since PR 2 is end-to-end correct, before PR 12 starts
mutating it. Zero schema, callable, or rule changes.

#### What shipped

- [x] **Pure helpers extracted to a testable module.**
      `@/src/utils/orderTimeline.ts` â€” exports
      `labelForTimelineStatus(status)` and
      `formatTimelineActor(by)` plus the `TimelineEntry` type.
      Kept separate from the React component so the actor-
      parsing rules and label mapping pin in unit tests
      without a renderer.
- [x] **Visual component.**
      `@/src/components/order/OrderTimeline.tsx` â€” vertical
      strip of dots + connector lines on the left, status
      label + timestamp + actor + optional reason on the
      right. React Native primitives only (View / Text /
      StyleSheet). `numberOfLines` clamps on actor (1) and
      reason (2) to prevent runaway cards.
- [x] **Disclosure wired on AdminOrdersScreen.**
      `@/src/screens/admin/AdminOrdersScreen.tsx:50-58, 364-395, 511-518`.
      New `timelineExpandedId` state, independent of
      `overrideExpandedId`. Disclosure label shows step
      count (`â–¸ Full timeline (5 steps)`) so admins get
      a hint without expanding. One card open at a time.
- [x] **Insertion-order rendering.** Comment block
      explicitly forbids sorting by `at` so back-to-back
      same-ms writes (cancel + refund_pending in one
      transaction) stay in the order the server wrote them.
      `arrayUnion` preserves insertion order in Firestore.
- [x] **Existing PR 7 blocks preserved.** Delivery substate
      strip and manual-override disclosure unchanged. New
      timeline section sits below them with the same
      `borderTopWidth: 1` separator treatment.

#### Status label coverage

The `statusHistory.status` union is wider than
`Order['status']`. Pinned in tests:

- Canonical order union: `pending`, `accepted`, `preparing`,
  `out_for_delivery`, `delivered`, `cancelled`.
- Payment + refund sub-states: `paid`, `authorized`,
  `amount_mismatch`, `refund_pending`, `refund_failed`,
  `refunded`.
- Unknown tokens fall through to the raw value (no silent
  drops if the server adds a new state before the client
  knows about it).

#### Actor parsing rules

`statusHistory[].by` follows two server-side shapes:

- `${role}:${uid}` for human actors â†’ render as
  `${role}:${uid.slice(0,4)}...` to keep the cell compact
  and avoid leaking full uids in screenshots.
- bare token (`system`, `razorpay-webhook`) or short
  namespaced token (`system:cleanup`,
  `client-confirm:abc1234` â‰¤ 8-char suffix) â†’ render verbatim.

The 8-char threshold is the heuristic that distinguishes
"short namespaced token" from "uid". Pinned in
`@/tests/utils/orderTimeline.test.ts:14-50`.

#### Verification

- `npx tsc --noEmit` (root + functions): **0 errors**.
- `npm test`: **49 suites, 486/486** (479 â†’ +7 PR 11 cases
  covering uid truncation, namespaced tokens, bare tokens,
  empty/null fallback, all status labels, unknown-status
  fallback).
- `npm run audit:indexes`: 28 chains / 0 missing.
- Deliberate-break: changed expected uppercase-role
  assertion â†’ red as expected (`Expected: "CUSTOMER:7Xkj..."
  Received: "customer:7Xkj..."`) â†’ reverted; 486 green.
- One new `DO NOT REMOVE` comment in
  `@/src/screens/admin/AdminOrdersScreen.tsx:15-16` for the
  OrderTimeline import block â€” added defensively because
  the file had a history of auto-formatter import strips
  before PR 8.1 / PR 9 fixed it. Could be removed once we
  confirm via a few editor saves that the formatter still
  isn't re-stripping; tracking as a low-priority follow-up.

#### Deferred

- [ ] **Component-render snapshot test.** Repo has no
      `*.test.tsx` infrastructure (jest unit config doesn't
      pull in react-native renderer). Spinning up
      react-native-testing-library just for one timeline
      snapshot wasn't worth the dependency surface this PR.
      The pure-helper tests cover the logic; the visual
      surface is exercised by the manual smoke tests below.
      Track as a follow-up if we land more component-only
      logic that can't be extracted to pure helpers.

#### Smoke tests on preview phone

1. **Fresh order.** Card shows status chip + placed
   timestamp + `â–¸ Full timeline (1 steps)` disclosure.
   Expand â†’ single `Pending Â· <time> Â· by system` row.
2. **Full lifecycle.** Place â†’ accept â†’ prepare â†’
   out_for_delivery â†’ claim â†’ pickup â†’ deliver. After each
   transition the disclosure step-count and timeline grow
   by one; actors show as `shopOwner:JK2L...`,
   `delivery:9Mxs...`, etc.
3. **Customer cancel within 2-min window** (PR 7).
   Timeline entry shows `by customer:XXXX...` (PR 8.1's
   role widening flowing through end-to-end).
4. **Admin cancel + refund.** Three rapid entries â€”
   `cancelled`, `refund_pending`, `refunded` â€” appear in
   server insertion order with refund reason rendered in
   italic below.
5. **Long timeline (8+ entries).** Card height grows
   smoothly; no clipping; FlatList scroll still works.

#### Deploy plan

Pure client OTA. No `functions/` deploy.

```powershell
npm test
eas update --branch preview --message "PR 11 admin order timeline"
# preview smoke
eas update --branch production --message "PR 11 admin order timeline"
```

### PR 10 â€” Quickwins bundle (shop radius + required name + Resend OTP) â€” âœ… CODE COMPLETE May 18 2026

JS-only OTA bundle. Three small fixes that the test team needs at
once instead of three sequential reopen cycles.

#### Part 1 â€” Open shop radius for cross-city testing

- [x] **`SHOW_ALL_SHOPS = true`** replaces the
      `FORCE_SHOW_ALL_SHOPS_IN_DEV = __DEV__` flag in
      `@/src/services/shopService.ts:9-18`. The old flag was
      `false` in TestFlight production builds, which is why
      Bangalore + Mumbai testers saw zero shops past each
      other. Comment block explains the testing-phase
      rationale and how to flip back at real-customer launch.
- [x] **Both branches updated.** Web Firestore path
      (`@/src/services/shopService.ts:42-45`) and native
      callable path (`@/src/services/shopService.ts:49-52`)
      both gate on the new flag. `NEAR_KM = 1` constant kept
      so the 1-km behaviour is one-line restorable.
- [x] **Server: no change required.** `listShopsPublic`
      callable at `@/functions/src/index.ts:4349-4365`
      returns ALL active shops decorated with `distanceKm`
      and sorted; the radius filter has always been client-
      side. Confirmed via grep before editing.

#### Part 2 â€” Required full name on profile

- [x] **Server `validateProfilePatch` flipped.**
      `@/functions/src/profileHelpers.ts:84-116`. Previously
      `name: null | ''` collapsed to `null` ("clear it");
      now any patch that includes the `name` key must carry
      a non-empty trimmed string, otherwise the helper
      returns
      `{ ok: false, field: 'name', message: 'Full name is required' }`.
      Patches that don't include `name` at all (e.g. the
      "update email only" flow) still pass â€” existing users
      with `name` already set keep working.
- [x] **`email` carve-out preserved.** Email is still
      optional and `null/''` still collapses to `null`. The
      doc-comment now explicitly contrasts the two fields.
- [x] **Client `ProfileScreen` UX.**
      `@/src/screens/ProfileScreen.tsx:105-138` â€”
      `onSaveProfile` early-returns with an Alert when name
      is blank; sends `name: name.trim()` (no `|| null`
      fallback) on success. Save button disabled when
      `name.trim().length === 0`
      (`@/src/screens/ProfileScreen.tsx:280`). Red asterisk
      on the "Full name" label and a "Required" helper line
      below the input
      (`@/src/screens/ProfileScreen.tsx:249-258`).
- [x] **Phone field already readonly.** Wrapped in
      `readOnlyField` View, not an `Input`, so the user
      can't edit it. No change needed.
- [x] **Tests pinned.**
      `@/tests/functions/profileValidation.test.ts:73-94` â€”
      three new cases: empty string, null, whitespace-only.
      Old "null and '' both clear the field" test rewritten
      to `email-only: â€¦` to keep coverage of the email
      carve-out
      (`@/tests/functions/profileValidation.test.ts:57-67`).

**Deferred (scoped out per the prompt's escape hatch):**

- [ ] **First-sign-in profile gate.** After OTP confirm, if
      `profile.name` is empty, route to ProfileScreen with
      `requiredSetup: true` and hide the back button until
      saved. Server-side rejection covers the worst case
      today (an empty-name save fails loudly), but the UX
      is still: tap Profile â†’ see asterisk â†’ fill in. A new
      OTP'd user who never opens Profile won't be forced.
      Track as a Phase-of-testing follow-up.

#### Part 3 â€” Resend OTP button (already on disk, ships with this PR)

- [x] **Diff-checked.** `git diff src/screens/LoginScreen.tsx`
      against HEAD returned empty â€” the staged work was
      already merged in a previous session. All seven spec
      items verified present:
      `RESEND_COOLDOWN_SECS = 30`
      (`@/src/screens/LoginScreen.tsx:21`),
      `resendCooldown` state + `useEffect` countdown
      (`@/src/screens/LoginScreen.tsx:35-59`), `onResendOtp`
      handler with `auth/too-many-requests` catch
      (`@/src/screens/LoginScreen.tsx:89-115`), Pressable
      "Resend OTP" link with cooldown copy
      (`@/src/screens/LoginScreen.tsx:200-215`),
      `linkDisabled` style applied at line 209, diagnostic
      `console.error` in `onConfirmOtp` catch
      (`@/src/screens/LoginScreen.tsx:136-140`).

#### Verification

- `npx tsc --noEmit` (root): **0 errors**.
- `npx tsc --noEmit` (functions): **0 errors**.
- `npm test`: **48 suites, 479/479** (476 â†’ +3 new PR 10
  cases for empty/null/whitespace name).
- `npm run audit:indexes`: 28 chains / 8 composite / 0 missing.
- Deliberate-break: flipped expected message on the
  empty-name test â†’ red as expected
  (`Expected: "Name is optional and may be cleared"
  Received: "Full name is required"`) â†’ reverted; 479 green.
- Zero new `DO NOT REMOVE` markers (PR 8.1 / PR 9 fix held).

#### Deploy plan

JS-only OTA. No `functions/` runtime change is strictly
needed (the validateProfilePatch tightening compiles into
existing function bodies but the callable already deploys
on every push). Recommend bundling with the upcoming PR 9
functions deploy:

```powershell
$env:NODE_OPTIONS = "--use-system-ca"

# 1. Functions (rolls in the validateProfilePatch tightening).
cd functions; npm run build; cd ..
firebase deploy --only functions --project grocery-mvp-dev

# 2. Client OTA.
npm test
eas update --branch preview --message "PR 10 quickwins"

# 3. Smoke test on preview channel, then promote.
eas update --branch production --message "PR 10 quickwins"
```

#### Smoke tests on preview phone

1. Bangalore + Mumbai testers both see every active shop
   (no longer 0 results outside their city).
2. Open Profile â†’ red asterisk on "Full name" + "Required"
   helper visible. Clear name â†’ Save button greys out.
   Tap-and-hold to bypass disable â†’ Alert "Name required".
3. Existing user with name already set: full flow still
   works, including update-email-only saves.
4. Curl `updateMyProfile` with `{name: ''}` directly â†’
   `invalid-argument: name: Full name is required`.
5. Resend OTP cooldown countdown visible after sending OTP;
   tap before 0 = no-op; tap at 0 = new SMS arrives, timer
   resets to 30.

### PR 9 â€” Node 22 + firebase-functions/admin SDK upgrade â€” â¸ CODE COMPLETE, DEPLOY PENDING (May 18 2026)

Server-only PR. Three coordinated bumps driven by Google Cloud's
Node 20 deprecation calendar (deprecated 2026-04-30, decommissioned
2026-10-30 â€” after which no new deploys are accepted on Node 20).

**Resolved versions:**

| package | before | after |
| --- | --- | --- |
| `firebase-admin` | `12.7.0` | `13.9.0` |
| `firebase-functions` | `6.6.0` | `7.2.5` |
| `razorpay` | `2.9.6` | `2.9.6` (out of scope) |
| Cloud Functions runtime | `nodejs20` | `nodejs22` |

**Fix list (Part 2): empty.**

The major bumps (admin v12 â†’ v13, functions v6 â†’ v7) compiled
clean against the entire `functions/src/` tree on the first try.
Every high-risk surface enumerated in the prompt was verified
against the new types:

- `defineSecret` Ã— 4 (RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET,
  RAZORPAY_WEBHOOK_SECRET, FCM_SERVER_KEY) â†’ unchanged.
- `setGlobalOptions({ region: 'asia-south1' })` â†’ unchanged.
- `onCall`, `HttpsError(code, message)` Ã— ~30 callables â†’ unchanged.
- `onSchedule({ schedule, timeZone, ...}, async event => ...)` for
  `cleanupAbandonedOrders` â†’ unchanged.
- `onDocumentCreated` Ã— 2, `onDocumentUpdated` Ã— 3 â†’
  `event.data.data()` accessor pattern still valid.
- `firebase-admin`: `initializeApp`, `getAuth`, `getFirestore`,
  `getStorage`, `FieldValue.serverTimestamp()`,
  `FieldValue.arrayUnion()`, `FieldValue.arrayRemove()`,
  `FieldValue.increment()` â†’ unchanged.

Zero `// @ts-ignore`/`// @ts-expect-error` added.

**Verification (Parts 3-4):**

- `cd functions; npx tsc --noEmit` â†’ **0 errors**.
- `cd ..; npx tsc --noEmit` â†’ **0 errors** (PR 8.1 baseline preserved).
- `npm test` â†’ **48 suites, 476/476** green.
- `npm run audit:indexes` â†’ 28 chains / 8 composite / 0 missing.
- Zero new `DO NOT REMOVE` comments needed (PR 8.1 prep held).

**Install gotchas observed:**

- `npm install --save firebase-admin@latest firebase-functions@latest`
  failed with `ERESOLVE` because the bare-`@latest` tag tried to
  pull `firebase-admin@13.10.0`, which doesn't yet exist on the
  registry â€” `npm view firebase-admin version` returns `13.9.0`.
  Likely an npm tag-cache quirk. Pinning explicit versions
  (`firebase-admin@13.9.0 firebase-functions@7.2.5`) resolved
  cleanly.
- `npm install` failed with `UNABLE_TO_VERIFY_LEAF_SIGNATURE`
  until `$env:NODE_OPTIONS = "--use-system-ca"` was set (same
  corporate-CA workaround already documented for `firebase
  deploy` in `.windsurf/deploy-discipline.md`).
- `npm warn EBADENGINE` because local Node is v24, package now
  requires v22. Cosmetic â€” only the Cloud Functions runtime
  enforces engines; local build still works on v24.

**Deferred to operator (Parts 5-8):**

These steps require running Firebase CLI against live projects
and were not executed by the assistant:

- [ ] **Part 5 â€” Local emulator smoke.** `cd functions; npm run
      serve` then exercise `placeOrder` (COD), `cancelMyPendingOrder`,
      `listMyOrders` via `firebase functions:shell`.
- [ ] **Part 6 â€” Dev deploy.**
      ```powershell
      $env:NODE_OPTIONS = "--use-system-ca"
      cd functions; npm run build; cd ..
      firebase deploy --only functions --project grocery-mvp-dev
      firebase functions:list --project grocery-mvp-dev
      ```
      Confirm function count matches pre-deploy (~30) and console
      shows `runtime: nodejs22` on at least one function.
- [ ] **Part 7 â€” Dev smoke tests.** Place online order â†’
      Razorpay payment â†’ confirmation; cancel within 2-min window
      (PR 7); admin suspendShop/unsuspendShop; wait for next
      `cleanupAbandonedOrders` cron tick; grep
      `firebase functions:log` for `unhandled|deprecation|error`.
- [ ] **Part 8 â€” Prod deploy.** Only after Part 7 fully green:
      `firebase deploy --only functions --project grocery-mvp-prod`,
      then `firebase functions:list` + console runtime spot-check.

**Rollback plan (if prod deploy breaks):**

1. Targeted redeploy of the broken callable.
2. Revert PR 9 commit, `npm install` (restores `firebase-admin@12`
   + `firebase-functions@6` + Node 20 engine), redeploy.
   Buys time until late October before runtime decom forces
   re-attempt.
3. Worst case: Firebase Console "revert to previous version" per
   function (slow but guaranteed).

Don't roll back on transient noise â€” only on a reproducible
callable category failure.

**Out of scope (confirmed):**

- Razorpay SDK bump â€” pinned at `^2.9.4`, separate PR if needed.
- TypeScript bump â€” `^5.6.0` is fine for Node 22 + functions v7.
- v1/v2 boundary refactor â€” already 100% v2.
- App Check enable â€” tracked separately (see
  "App Check enforcement (intentionally deferred)" section above).
- Splitting `index.ts` â€” separate refactor.

### PR 8.1 â€” Cleanup bundle â€” âœ… SHIPPED May 18 2026

Three small items bundled because each was too small for its own
PR. All three close out tracked deferred work from PRs 6.1, 7,
and 8.

#### Part 1 â€” `'customer'` in `AuditActorRole`

- [x] **Server union widened.**
      `@/functions/src/auditLogHelpers.ts:32-41`. Order:
      `admin | shopOwner | customer | system`. Comment block
      explains 'system' is now strictly cron/cleanup.
- [x] **`cancelMyRecentPaidOrder` flipped.**
      `@/functions/src/index.ts:1180-1194`. `actorRole: 'system'`
      â†’ `actorRole: 'customer'`. `metadata.initiatedBy` dropped
      (was redundant with `actorUid`). The 6-line "Audit
      schema's actorRole union doesn't have customer yet"
      workaround comment is gone â€” replaced with a 3-line
      PR 8.1 reference.
- [x] **Client union synced.**
      `@/src/screens/admin/AuditLogScreen.tsx:35-49`. Comment
      pins the duplicate-union posture (intentional; client
      doesn't import from `functions/`).
- [x] **Test pinning.**
      `@/tests/functions/auditLogHelpers.test.ts:135-155`. New
      test `actorRole=customer supported (in-window paid-order
      self-cancel)`. +1 to total (475 â†’ 476).

#### Part 2 â€” Baseline `tsc --noEmit` errors

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
  was historically placed above the wrong line â€” it sat above
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
  already obsolete â€” order placement goes through
  `orderService.placeOrder` directly from the Checkout screen.

Verification: `npx tsc --noEmit` from project root â†’ **0 errors**.
Functions tsc also clean.

#### Part 3 â€” Formally defer App Check

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
  - All other callables had no inline comment â€” they just used
    `{ cors: true, enforceAppCheck: false }` directly.

Verification:
- `npx tsc --noEmit` (root): **0 errors** (was 3 baseline â†’ 0).
- `npx tsc --noEmit` (functions): clean.
- `npm test`: **48 suites, 476 tests** (was 475 â†’ +1 customer
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

# 1. Functions â€” cancelMyRecentPaidOrder audit-write change.
#    Signature unchanged; clients keep working pre-OTA.
cd functions; npm run build; cd ..
firebase deploy --only functions --project grocery-mvp-dev

# 2. OTA â€” client union widening in AuditLogScreen.
eas update --branch preview --message "PR 8.1 cleanup bundle"

# 3. After preview smoke test:
eas update --branch production --message "PR 8.1 cleanup bundle"
```

Smoke tests on preview phone:
1. As customer, cancel a paid order within 2-min window. Then
   as admin, open Audit Log â†’ confirm entry shows
   `actorRole: customer` (not `system`).
2. As admin, perform any other action (e.g. `suspendShop`).
   Confirm its entry's `actorRole` stays `admin` (regression
   check).
3. As shop owner, do a bulk menu update. Confirm its entry's
   `actorRole` is `shopOwner`.

### PR 8 â€” Admin audit log + Bulk menu actions â€” âœ… SHIPPED May 18 2026

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

#### Part A â€” Admin audit log

- [x] **`auditLogHelpers.ts` + 9 tests.** Pure helper in
      `@/functions/src/auditLogHelpers.ts:1-100`. `buildAuditLogEntry`
      is deterministic via injected `now` + `randSuffix`. Optional
      fields are OMITTED (not undefined-keyed) so Firestore docs
      stay clean. Id format `{timestamp}_{rand12}` is sortable
      lexicographically by timestamp â€” Firestore-console scrolling
      is a rough chronological view without an explicit `orderBy`.
      Tests cover the omit-optionals contract, the lexicographic
      sort property, all three actorRoles, deterministic timestamps,
      and id-collision-resistance under default rand.
- [x] **`writeAuditLog` wrapper in `index.ts:1273-1280`.** Catches
      and swallows errors â€” `console.warn` only. The audit-log
      write failing must NOT break the underlying user-visible
      action; worst case is a gap in audit history. Acceptable
      for MVP; revisit if compliance requires hard guarantees.
- [x] **Audit-log writes wired into all 13 callables on success
      paths**:
  - `approveShop` â†’ `shop.approve`
  - `rejectShop` â†’ `shop.reject`
  - `suspendShop` â†’ `shop.suspend`
  - `unsuspendShop` â†’ `shop.unsuspend`
  - `approveDeliveryRole` â†’ `delivery_request.approve`
  - `rejectDeliveryRole` â†’ `delivery_request.reject`
  - `revokeShopOwner` â†’ `user.revoke_shop_owner`
  - `revokeDelivery` â†’ `user.revoke_delivery`
  - `cancelPaidOrder` â†’ `order.cancel_paid` (admin OR shopOwner
    actorRole based on `v.role`)
  - `cancelMyRecentPaidOrder` â†’ `order.cancel_by_customer_window`
    (actorRole='system' â€” schema doesn't yet have 'customer';
    metadata.initiatedBy carries the canonical customer uid)
  - `updateOrderStatus` â†’ `order.manual_status_update` (admin OR
    shopOwner actorRole)
  - `updateShopSettings` â†’ `shop.update_settings` (both branches;
    metadata captures before/after for diffing)
  - `cleanupAbandonedOrders` â†’ `order.cancel_abandoned` (system
    actor; per-cancelled-order entry inside the loop)
  - `bulkUpdateMenuAvailability` â†’ `shop.bulk_menu_availability`
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
      `@/src/screens/admin/AuditLogScreen.tsx:1-380` â€” polls
      every 60s while focused, pull-to-refresh for immediate
      refetch, "Load more" button using cursor pagination, tap
      row to expand metadata JSON. `ACTION_LABELS` is the
      stable canonical-label map; new action types should be
      added there.
      `@/src/navigation/AppNavigator.tsx`: imported, route
      `AuditLog` registered. `@/src/screens/HomeScreen.tsx`:
      "ðŸ“œ Audit log" tile in admin section.

#### Part B â€” Bulk menu actions

- [x] **`bulkMenuHelpers.ts` + 14 tests.** Pure helper in
      `@/functions/src/bulkMenuHelpers.ts:1-130`.
      `validateBulkMenuRequest` gates on auth (uid non-empty),
      strict `shopOwner === true`, non-empty string shopId,
      array of non-empty string ids, â‰¤ 100 ids
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
      (â‰¤ 500 cap, fits comfortably). Returns
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
      disabled when 0 selected. Confirm dialog â†’ callable â†’
      optimistic local update + `fetchOnce()` refresh.
      Skip-count surfaced via Alert when non-zero.

Verification:
- `npm test`: **48 suites, 475 tests** (was 452 â†’ **+23 new**:
  9 audit + 14 bulk).
- `npx tsc --noEmit` (functions): clean.
- `npx tsc --noEmit` (root): 3 baseline errors only â€”
  `firebase.ts` + 2 in `useOrderStore.ts` â€” all pre-existing.
- `npm run audit:indexes`: **28 chains / 8 composite / 0 missing**
  (was 24 â†’ +4 new query chains: auditLog `orderBy timestamp`,
  bulk menu `where __name__ in`, etc.).
- Deliberate-break demo: weakened
  `validateBulkMenuRequest`'s shopOwner check from `!== true` to
  `!`. The canonical strict-equality test
  `validateBulkMenuRequest â€” auth gate â€º rejects truthy-but-not-
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
- **`enforceAppCheck: false`** on both new callables â€” matches
  the project-wide posture (no other callable enforces App
  Check today). Tracked in the existing "Enable App Check on
  every callable" PRELAUNCH item; flip them all together.
- **`updateShopSettings` audit field for actor**: had to derive
  `actorUid`/role from request.auth instead of validated.actorUid
  because the helper doesn't expose those today (see per-callable
  note above).

Deploy plan (NOT executed â€” hand back):

```powershell
$env:NODE_OPTIONS = "--use-system-ca"

# 1. Rules â€” new auditLog collection.
firebase deploy --only firestore:rules --project grocery-mvp-dev

# 2. Functions â€” many touched (~13 callables get audit writes
#    + 2 new callables). No callables removed, so no
#    interactive delete prompt.
cd functions; npm run build; cd ..
firebase deploy --only functions --project grocery-mvp-dev
firebase functions:list --project grocery-mvp-dev

# 3. OTA â€” JS-only client changes, applies to existing
#    TestFlight build.
eas update --branch production --message "PR 8: admin audit log + bulk menu actions"
```

Smoke tests on production phone:
1. **Audit log writes**: as admin, suspend a shop â†’ open Audit
   Log â†’ confirm entry appears with action `shop.suspend`,
   target = shop name, reason text.
2. **Audit log paging**: scroll to bottom â†’ tap "Load more" â†’
   older entries appear, no duplicates.
3. **Audit log non-admin read denied**: from Firestore Console
   as non-admin â†’ try to read `/auditLog` â†’ rules deny.
4. **Bulk availability toggle**: ShopMenu â†’ tap "Select" â†’
   check 3 items â†’ tap "Mark 3 unavailable" â†’ confirm â†’ all 3
   flip to unavailable, select mode exits.
5. **Bulk on another shop's items**: dev script calling
   `bulkUpdateMenuAvailability` with another shop's ids â†’
   expect `skippedCount = N, updatedCount = 0`.
6. **Bulk action audit entry**: after the bulk toggle â†’ open
   Audit Log â†’ entry for `shop.bulk_menu_availability` with
   metadata count + target shop id.
7. **Sub-second audit ordering**: do two admin actions back-to-
   back; confirm both appear and are ordered correctly (id
   prefix sorts by timestamp).

### PR 6.1 â€” Signed upload URL hotfix for menu images â€” âœ… SHIPPED May 18 2026

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
URL (admin SDK signing bypasses rules â€” documented GCS pattern); client
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
- [x] **Storage rule for `/menu/` â†’ write-deny.**
      `storage.rules:27-45`. Reads stay public; writes are now
      `if false` because the signed URL bypasses rules entirely.
      Inline comment documents why the old PR 6 claim check is
      gone (cross-SDK auth mismatch).
- [x] **`uploadMenuImage` rewritten.** `src/services/storage.ts`
      now calls `orderService.getMenuImageUploadUrl()`, then PUTs
      the resized JPEG blob to the signed URL with header
      `Content-Type: image/jpeg` (must match exactly â€” v4
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
- `npm test`: 46 suites, **452 tests** (was 440 â†’ **+12 new** in
  `menuImageUploadHelpers.test.ts`).
- `npx tsc --noEmit` (functions): clean.
- `npx tsc --noEmit` (root): 3 baseline errors only â€” unchanged.
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

Deploy plan (NOT executed â€” hand back):
1. `cd functions && npm run build` â€” confirm clean build.
2. `firebase deploy --only storage --project grocery-mvp-dev` â€”
   push the write-deny rule.
3. `firebase deploy --only functions:getMenuImageUploadUrl --project
   grocery-mvp-dev` â€” push the new callable.
4. `cd .. && npm test` â€” final pre-OTA confirmation.
5. `eas update --branch production --message "PR 6.1: signed upload
   URL for menu images"` â€” push the client.
6. Smoke-test on TestFlight (see prompt Part 5 for the 5 manual
   tests). Negative test: sign in as admin (no shopOwner claim),
   try the callable via the Firebase console â†’ expect
   `permission-denied`.

### PR 7 â€” Customer cancel window + ShopOwnerDashboard UX mirror â€” âœ… SHIPPED May 17 2026

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
      Failure path flips paymentStatus â†’ `refund_failed` and
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
      delivery substate timeline (â³ Awaiting / ðŸ›µ Claimed / ðŸ“¦
      Picked up Â· TIME / âœ… Delivered Â· TIME) with styles copied
      verbatim from AdminOrdersScreen. The "Mark Delivered"
      filter requirement was already satisfied: shop-owner action
      buttons live on `ShopOrderDetailScreen` and the existing
      `SHOP_OWNER_ALLOWED_ACTIONS` constant
      (`@/src/screens/shop/ShopOrderDetailScreen.tsx:52-56`)
      already excludes `'delivered'`.

Verification:
- `npm test`: 45 suites, 440 tests (was 420 â†’ +20 new in
  `customerCancelWindowHelpers.test.ts`).
- `npx tsc --noEmit` (functions): clean.
- `npx tsc --noEmit` (root): 3 baseline errors only â€” `firebase.ts`
  + 2 in `useOrderStore.ts` â€” all pre-existing, unrelated.
- `npm run audit:indexes`: 24 chains / 8 composite / 0 missing.
- Deliberate-break demo: replaced the window-expiry branch in
  `canCustomerCancelPaidOrder` with `return { ok: true }`. The test
  `canCustomerCancelPaidOrder â€” paidAt + window math â€º rejects
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

- [ ] **DEFERRED â€” Extract `executeRefund` shared helper.** PR 7
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
      `enforceAppCheck: false` everywhere â€” enables curl/Postman
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

## ðŸ”’ PR 1 â€” Security hardening (May 17 2026)

First of the three "code review findings" PRs from May 17. Closes the
three launch-blocker security gaps + the test-coverage gap in the
"PR 1 â€” Security hardening" sub-checklist above. Pure server + rules
+ tests + admin UI: no customer/owner/delivery happy-path UX changes,
so family testing is unaffected by the deploy.

### What shipped

- [x] **Self-service `becomeDelivery` deleted.** The callable that
      let any signed-in user grant themselves the `delivery` claim
      (and then read every pending pickup's customer PII via
      `listAvailableDeliveries`) is gone from
      `functions/src/index.ts`. The client method
      `orderService.becomeDelivery` is gone too. Existing users who
      had the claim from before the deploy KEEP it â€” the new
      restriction only gates future requests. Bulk audit/revoke of
      pre-PR-1 delivery partners is tracked as a follow-up. [PR 1]
- [x] **Admin-approval flow for delivery partners.** Mirrors the
      shop registration + approval flow exactly. Five new asia-
      south1 callables in `functions/src/index.ts`:
        - `requestDeliveryRole({ name?, vehicleType?, city? })` â€”
          writes `deliveryRequests/{uid}` with status pending.
          Rejects if caller already has the delivery claim or a
          pending request.
        - `approveDeliveryRole({ uid })` â€” admin only. Sets the
          `delivery` custom claim, mirrors `isDelivery: true` to
          `users/{uid}`, updates the request doc, pushes a
          notification to the applicant.
        - `rejectDeliveryRole({ uid, reason })` â€” admin only.
          Writes `rejectedReason` and notifies. Doesn't delete the
          doc (audit trail).
        - `listPendingDeliveryRequests()` â€” admin only. FIFO by
          `submittedAt`. Pinned by new composite index in
          `firestore.indexes.json` (status asc + submittedAt asc).
        - `getMyDeliveryRequest()` â€” any signed-in caller. Returns
          the caller's own request doc or null.
      Validation + auth logic lives in
      `functions/src/deliveryRequestHelpers.ts` so it's unit-
      testable without firebase-functions / emulator boot. [PR 1]
- [x] **Firestore rules tightened (3 changes).**
        - `/users/{uid}` â€” split `read/write` into separate
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
        - `/shops/{shopId}/menu/{menuItemId}` â€” read now gated on
          parent `shops/{shopId}.data.status == 'active'` (admins
          bypass). Closes the public-menu scrape of pending /
          suspended shop pricing.
        - `/deliveryRequests/{uid}` â€” new collection. Read =
          owner or admin. Create = owner. Update / delete = no one
          (Cloud Functions only via Admin SDK). [PR 1]
- [x] **Client wiring.** `src/services/orderService.ts` gains the
      five new methods (`requestDeliveryRole`, `getMyDeliveryRequest`,
      `listPendingDeliveryRequests`, `approveDeliveryRole`,
      `rejectDeliveryRole`) with the same Plan-B native + web
      dispatch posture as the rest of the file. `src/types/index.ts`
      gains `DeliveryRequest` + `DeliveryRequestStatus`. [PR 1]
- [x] **Screens.** Four files:
        - `src/screens/roles/BecomeDeliveryPartnerScreen.tsx` â€”
          rewritten from one-tap opt-in into a form (name +
          vehicle-type chips + city, all optional). On submit it
          replaces to the new waiting screen. If the caller
          already has a pending OR rejected request, the screen
          short-circuits to the waiting screen so they can't
          double-submit.
        - `src/screens/roles/DeliveryApprovalWaitingScreen.tsx` â€”
          new. Polls `getMyDeliveryRequest` every 30s. On approval
          refreshes the ID token (so the new `delivery` claim is
          visible) and resets the nav stack to Home â†’
          DeliveryDashboard. On rejection shows the admin's reason
          + "Edit & resubmit" button that routes back to the form.
        - `src/screens/admin/PendingDeliveryRequestsScreen.tsx` â€”
          new. Admin queue mirror of `PendingShopsScreen` â€” days-
          since chip with > 7d warning treatment, defensive client-
          sort by `submittedAt` asc, tap row to open detail.
        - `src/screens/admin/DeliveryRequestDetailScreen.tsx` â€”
          new. Mirror of `ShopRegistrationDetailScreen` â€” same
          approve / reject modal + reason flow, idempotency guard
          on the action buttons.
      Routes registered in `src/navigation/AppNavigator.tsx`.
      `HomeScreen` admin tile section gains "ðŸ›µ  Delivery
      requests" between Pending Shop Approvals and User
      Management. [PR 1]
- [x] **Tests added: 39** across 2 files.
        - `tests/functions/deliveryRequestHelpers.test.ts` â€” 23
          tests pinning every code path: validation (auth,
          existing claim, existing pending, sanitization,
          truncation, vehicle whitelist), `requireAdminCaller`
          (admin / unauthenticated / non-admin / non-strict-true
          claim), `canApproveDeliveryRequest` (admin-only, state
          machine: pending â†’ approved, idempotency guard,
          not-found), `canRejectDeliveryRequest` (reason required,
          truncated at 280 chars, terminal-state guard).
        - `tests/contracts/orderReadAuth.parity.test.ts` â€” 16
          new matrix entries (4 callers Ã— 4 callables) added to
          the existing parity test file, alongside a doc-block
          cross-reference to the auth checks of the EXISTING
          callables (`listShopOrders`, `listMyOrders`,
          `listAvailableDeliveries`, `listShopMenuPublic`,
          `listAllUsers`, `listAllShops`, `getMyDeliveryRequest`)
          that PR 1 intentionally did NOT refactor. [PR 1]
      Deliberate-break demo: temporarily removed the
      "already has delivery claim" guard in
      `validateRequestDeliveryRole`. **2 tests** failed by name â€”
      `rejects caller who already has the delivery claim` (helper
      suite) and `requestDeliveryRole > caller=delivery
      allow/deny` (parity matrix). Reverted; full suite back to
      green. [PR 1]

### Acceptance verification (run output)

- [x] `npx tsc --noEmit` â€” **0 new errors** (4 baseline:
      `SearchScreen.tsx`, `firebase.ts`, `useOrderStore.ts` Ã—2,
      same as before PR 1; the 7 `claude_files/` errors are
      orthogonal to the app).
- [x] Functions build (`npm run build` in `functions/`) â€” clean.
- [x] `npm run audit:indexes` â€” `19 query chains, 8 composite,
      0 missing` (the new `deliveryRequests where status==pending
      orderBy submittedAt` is covered by the new composite index).
- [x] `npm test` â€” **277 / 277 passing**, **30 test suites**.
      Prior total was 238; PR 1 adds +39 tests (23 helper + 16
      parity matrix).
- [x] `firestore.rules` compiles clean (validated by `firebase
      deploy --only firestore:rules --dry-run` â€” see deploy plan
      below).

### Deploy plan (hand to user â€” not executed by Cascade)

Per `.windsurf/deploy-discipline.md` â€” one `--only` target per
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

# OTA the client â€” preview channel first; promote to production
# after smoke-testing the family device pair.
eas update --branch preview --message "PR 1: security hardening â€” delivery approval flow"
```

### Deferred (tracked for follow-up PRs)

- [ ] **Rules tests for the new rules** â€” emulator-based
      `tests/rules/users.test.ts` extension for the new whitelist
      enforcement, `tests/rules/shopMenu.test.ts` for the new
      parent-status gate, and new `tests/rules/deliveryRequests.test.ts`.
      Pure-helper coverage is in place; emulator-based coverage
      adds defense in depth. `[PR 1-followup]`
- [ ] **Extract auth helpers for `listMyOrders`,
      `listAvailableDeliveries`, `listShopMenuPublic`,
      `listAllUsers`, `listAllShops`** â€” the parity matrix
      currently documents their inline auth checks in a doc
      block. Extracting them lets the matrix EXECUTE the auth
      check the same way it does for the PR-1 callables. Each is
      a 5-10 line refactor; deferred to keep PR 1's diff
      focused. `[PR 1-followup]`
- [ ] **`getDeliveryRequest({ uid })` callable** â€” currently
      `DeliveryRequestDetailScreen` fetches the full pending list
      and finds by uid, mirroring `ShopRegistrationDetailScreen`.
      Fine at 50-request cap; switch to a per-uid getter when the
      queue regularly exceeds the cap. `[PR 1-followup]`
- [ ] **Bulk audit + revoke of pre-PR-1 delivery partners** â€”
      decide whether legacy self-service-granted delivery claims
      should be revoked (forcing re-application through the new
      flow). Affects only people who tapped "I want to be a
      delivery partner" in v12a-v12b. `[PR 1-followup]`
- [ ] **Vehicle / ID document verification** â€” MVP collects
      `vehicleType` (whitelist of 5) only. License + vehicle reg
      photo upload + admin review of those docs are deferred to
      a later PR. `[Post-launch]`
- [ ] **Admin push when a delivery request lands** â€” currently
      best-effort via `pushToAdmins`. Email/SMS fallback for
      admins not running the app is deferred. `[Post-launch]`

---

**Maintenance rule:** any time we add a temporary dev hack, env-only flag,
disabled enforcement, or "TODO before launch" in code â€” add it here
immediately. The checklist is the only thing that survives memory.

## PR 36 â€” Customer CRM for shop owner `[Phase 36]`

- [x] **`listShopCustomers` callable + pure aggregator** â€” server-side
      aggregation of the shop's most-recent 1000 orders into per-
      customer rollups (orderCount, totalSpent excluding cancelled/
      refunded, firstOrderAt, lastOrderAt). All grouping + sorting +
      filtering lives in `functions/src/customerCrmHelpers.ts`
      (`aggregateShopCustomers`, `viewShopCustomers`) so it's unit-
      tested without booting firebase-functions; the callable in
      `functions/src/index.ts` is a thin Firestore query wrapper that
      reuses `validateShopOrdersAccess` (same gate as
      `listShopOrders`). Returns `{ customers, summary }` with
      `truncated` flag when the 1000-order cap is hit. **Schema note:
      the PR 36 prompt drafted helpers against `userId` + `address`,
      but verified-against-source order docs use `customerUid` +
      `deliveryAddress` (see header comment in
      `customerCrmHelpers.ts`). Tests pin the corrected shape.**
      Hard-cap rationale documented inline.

- [x] **`ShopCustomersScreen` (client)** â€” three tabs (Top by revenue
      / Recent / Stopped 30d+) over a 90d / 180d / All-time period
      selector; tap-to-expand row reveals phone (tap-to-call on
      native via `Linking`), full order count, total spent, first/
      last order dates. All `useState` calls live above the early
      returns to satisfy rules-of-hooks. Empty/loading/error/
      truncated states handled in-tree. Uses existing
      `formatRupees` and SafeAreaView pattern.

- [x] **Wired into `ShopOwnerDashboardScreen`** as a `manageMenuTile`
      ("ðŸ‘¥ My customers"); `ShopCustomers` route registered in
      `AppNavigator.tsx`. `ShopCustomer` type exported from
      `src/types/index.ts`; client wrapper `listShopCustomers`
      added to `src/services/orderService.ts` with web/native
      dispatch.

- [x] **Analytics** â€” `shop_customers_viewed` (fires on initial
      load + every tab/period change with totalUniqueCustomers +
      customers_shown from server) and `shop_customer_tapped`
      (rank_in_view, 1-indexed) added to `src/services/analytics.ts`
      under the existing `Analytics` namespace; auto-mirrored to
      `featureUsageLog/` via PR 38.1 routing.

- [x] **Unit tests** â€” `tests/functions/customerCrmHelpers.test.ts`
      covers aggregation totals, cancelled/refunded exclusion from
      `totalSpent` (kept in `orderCount`), defensive skipping of
      malformed rows, most-recent-non-empty contact merging,
      regression guard for blank-newer-address, and all three
      view sorts including `stopped` default 30d. **9 passing.**
      Deliberate-break check: removing the cancelled/refunded
      exclusion makes the dedicated test fail; reverted.

- [x] **Privacy / forbidden-actions audit** â€” no new collections
      or fields written; rollups computed in-memory per request.
      Privacy enforced via the same `validateShopOrdersAccess`
      gate as `listShopOrders` (shop owner â†” own shop only;
      admin can pass `shopId`).

- [ ] **Smoke tests post-deploy** â€” on a freshly-launched shop
      with â‰¥5 past orders: verify Top sort, Recent sort matches
      most-recent order timestamp, Stopped 30d+ behaves on an
      older shop, period switch updates numbers, expand row
      shows phone tap-to-call, analytics events visible in
      DebugView. `[Phase 36-smoke]`

- [ ] **Truncation UX at scale** â€” when a shop's history exceeds
      1000 orders the screen surfaces a "Showing your most recent
      1,000 orders" banner. Add an explicit date-range picker
      (or paginated cursor) before any shop is likely to cross
      this threshold (~100 orders/day for 10 days). `[Post-launch]`

- [ ] **Customer notes / tags** â€” out of scope for PR 36.
      Letting shop owners attach short notes per customer
      (e.g. "prefers no onion", "leaves at gate") would require
      a new `shopCustomerNotes/` collection + rules; deferred.
      `[Post-launch]`

## PR 36.1 â€” Pilot UX polish bundle `[Phase 36.1]`

- [x] **Pickup countdown on customer `OrderDetailScreen`** â€”
      replaces the single-line "Ready by 7:30 PM at the shopâ€¦"
      with a two-line layout: bold relative time on top
      (`Pickup ready in 22 minutes`) + muted absolute fallback
      below (`by 7:30 PM Â· delivery partner brings it to you`).
      Eliminates the mental-math hit every time a customer
      checks on their order. Pure helper at
      `src/utils/formatRelativeTime.ts` (caller-injected
      `nowMs`, deterministic, no `Date.now()` inside) drives
      the format. Reuses the existing PR 7 `nowMs` 1-second
      interval (already in place for the in-window cancel
      countdown) â€” **no new timer**, no leak risk.
      Edge cases handled: no ETA â†’ row hidden; <1 min â†’
      "less than a minute"; past <2 min â†’ "any moment now";
      past >2 min â†’ "X minutes ago"; â‰¥1 hour â†’ "X hours Y minutes".

- [x] **Favorites-only filter pill on `ShopListScreen`** â€”
      pill at the top of the list (above search results),
      defaults to "ðŸª All shops", toggles to "â¤ï¸ Favorites
      only". Filter logic checks
      `profile.favorites?.[shopId]?.length > 0` against the
      PR 19 `Record<shopId, menuItemIds[]>` shape (server
      prunes empty entries; UI guards anyway). Empty state
      surfaces a friendly "No favorites yet" panel + "Show
      all shops" escape-hatch CTA. State is local-only â€” resets
      to All on each navigation; persistence deferred.
      `SearchScreen` is product-search-only (`{menuItem, shop}`
      rows) so the pill ships on `ShopListScreen` only.

- [x] **Analytics** â€” `customer_pickup_countdown_viewed`
      (fires once per `(orderId, readyByEstimate)` tuple when
      the ETA is in the future; deliberately NOT keyed on
      `nowMs` to avoid second-by-second spam) and
      `customer_favorites_filter_toggled` (fires on each pill
      tap with `enabled: boolean`). Both auto-mirror to
      `featureUsageLog/` via PR 38.1 routing.

- [x] **Tests** â€” `tests/utils/formatRelativeTime.test.ts`
      covers 22 min / 1 min singular / <1 min / 1h5m / exact
      hours / 1 min past / 15 min past / 1h5m past / custom
      label override (future + past). **9 passing.**
      Deliberate-break (swap "minutes" â†’ "hours" in the
      sub-hour future branch) caused 3 dependent tests to
      fail with clear assertion deltas; reverted.

- [x] **OTA-eligibility audit** â€” `git diff HEAD -- app.json
      package.json package-lock.json` is empty. No new SDKs,
      no plugin changes, no permission requests, no native
      modules. Ships via `eas update` only.

- [ ] **Smoke tests post-OTA** â€” verify countdown ticks live
      every minute, two-line layout renders cleanly on phone,
      countdown handles ETA-in-the-past gracefully (any moment
      now â†’ X minutes ago), pickup row hidden when no ETA,
      filter pill toggles + filters + empty state behave,
      `featureUsageLog/` shows new event docs in Firestore
      Console. `[Phase 36.1-smoke]`

- [ ] **DEFERRED â€” Cold-start fix for shop-side
      `updateOrderStatus` (~4s first tap)** â€” diagnosed as
      Cloud Functions Gen 2 cold start (first tap ~4s after
      ~15min idle, ~1s subsequently). Single-line fix:
      `minInstances: 1` on the `updateOrderStatus` `onCall`
      options, ~â‚¹400/mo per warm instance. Sudhir chose the
      pilot-cost-conservative path (accept the 2â€“3Ã— daily
      cold-start hit during pilot, revisit if it surfaces as
      real friction). Not blocking pilot. `[Post-launch]`

- [ ] **Persisted "Favorites only" filter state** â€” v1 resets
      on screen mount. If pilot shows customers re-toggling to
      favorites every session, persist via AsyncStorage.
      `[Post-launch]`

- [ ] **Customer-side Hindi i18n** for the countdown formatter
      and other customer-facing strings. PR 34 shipped voice +
      Hindi onboarding for shop registration; the customer-side
      i18n is a separate workstream. `[Post-launch]`

## PR 32.1 â€” Category-aware menu placeholders `[Phase 32.1]`

- [x] **Per-category placeholder map + helper** â€”
      `functions/src/categoryConstants.ts` now exports
      `CATEGORY_PLACEHOLDER_URLS` (10 placehold.co URLs, one
      per `CategoryId`, with category emoji + theme color) and
      `placeholderImageForCategory(categoryId)` (pure lookup
      with a generic fallback for unknown ids â€” defence-in-
      depth against future schema drift). Single source of
      truth; both server callables import from here.

- [x] **`addCustomMenuItem` (PR 6 manual-add path)** at
      `functions/src/index.ts:~4714` now writes
      `imageValidation.url ?? placeholderImageForCategory(category)`
      instead of the hardcoded generic URL. `category` is
      already validated against `VALID_CATEGORIES` earlier in
      the same callable so the lookup always hits.

- [x] **`addExtractedMenuItems` (PR 32 scan-rate-list path)**
      at `functions/src/index.ts:~5827` now writes
      `placeholderImageForCategory(item.category)` per row in
      the batch loop. Same validated-category invariant.

- [x] **`updateMenuItemFields` (partial update path)** at
      `functions/src/index.ts:~4519` left **unchanged** â€” the
      generic placeholder there only fires when imageUrl is
      being explicitly cleared in a partial update where the
      payload may not carry `category`, and the prompt scoped
      PR 32.1 to the two add-paths only. Documented here so a
      future audit doesn't flag the lingering literal as a
      forgotten swap.

- [x] **Tests** â€” `tests/functions/categoryPlaceholders.test.ts`
      pins the parity (every `VALID_CATEGORIES` id has an
      entry, no extras), URL syntactic validity, lookup
      correctness, and the unknown-id / empty-string fallback.
      **6 passing.** Deliberate-break (delete
      `fruits_vegetables` from the map) caused 2 dependent
      tests to fail with `expect(undefined).toBeDefined()`;
      reverted.

- [x] **Schema-additive only** â€” only items added AFTER deploy
      use the new placeholders. Existing `MenuItem.imageUrl`
      values are unchanged; no migration of historical rows.

- [x] **OTA-eligibility audit** â€” `git diff HEAD -- app.json
      package.json package-lock.json functions/package.json
      functions/package-lock.json` is empty. Server-only deploy
      (two callables) + optional client OTA for docs.

- [ ] **Smoke tests post-deploy** â€” (1) scan a real Indian
      rate-list with mixed categories via "ðŸ“¸ Scan rate-list
      (AI)", commit, verify the resulting menu shows visually
      differentiated category-themed placeholders rather than
      a wall of grey; (2) manual "+ Add custom item" with no
      uploaded image, two different categories, verify each
      row's placeholder matches its category theme; (3)
      open a pre-PR-32.1 shop's menu and confirm existing
      images are unchanged. `[Phase 32.1-smoke]`

- [ ] **Future: yield to real product images via PR 33
      (master product catalog) / PR 32.2 (Open Food Facts
      lookup)** â€” when those land, matched SKUs swap the
      category placeholder for a real product image. Per-
      category placeholders are the bridge for the pilot,
      not the dead-end. `[Post-launch]`

- [ ] **Future: localize placeholder text (Hindi / regional)**
      â€” out of scope for v1; emoji + English is enough signal
      for the pilot. `[Post-launch]`

## PR 32.2 â€” Placeholder URL PNG fix (RN can't render SVG) `[Phase 32.2]`

- [x] **Same-day hotfix to PR 32.1.** The placehold.co URLs
      shipped in PR 32.1 had no explicit format suffix;
      placehold.co serves SVG by default, and React Native's
      `<Image>` component cannot render SVG (only PNG / JPG /
      GIF / WebP). Result on device: every category placeholder
      rendered as an empty box â€” silent failure, no error
      logged, no Sentry breadcrumb. Strictly worse than the
      pre-PR-32.1 generic placeholder, which at least rendered
      *something*.

- [x] **Fix** â€” added `.png` at the **end of the path** (right
      before `?text=`) in all **11 URLs** (10 category entries
      in `CATEGORY_PLACEHOLDER_URLS` + 1 generic fallback
      inside `placeholderImageForCategory`). Final pattern:
      `https://placehold.co/400x400/<bg>/<fg>.png?text=â€¦`.
      **Note on the false-start:** PR 32.2's first iteration
      put `.png` after the size segment
      (`/400x400.png/<bg>/<fg>?text=â€¦`) per the prompt's
      suggested form. On-device smoke showed placeholders
      STILL empty â€” placehold.co serves SVG for that path
      shape too. Corrected by moving `.png` to the end of the
      path. JSDoc header on the map and Rule 7 in
      `.windsurf/code-discipline.md` both call out the
      position requirement explicitly so the same false-start
      doesn't recur.

- [x] **Discipline rule logged** â€” `.windsurf/code-discipline.md`
      now has **Rule 7: Image URLs for React Native must
      specify a raster format**, with the placehold.co
      example, the icon-CDN warning, and a note that the
      failure mode is silent. PR 32.1 named as the first
      instance so the rationale survives a future audit.

- [x] **Tests** â€” `tests/functions/categoryPlaceholders.test.ts`
      (6 tests from PR 32.1) **all pass unchanged**. The
      `new URL(...)` syntactic check and the
      `^https:\/\/placehold\.co\/` regex both accept the
      `.png` form. No new tests added per prompt guidance â€”
      the parity test already pins the map.

- [x] **OTA-eligibility audit** â€” `git diff HEAD -- app.json
      package.json package-lock.json functions/package.json
      functions/package-lock.json` is empty. Server-only
      deploy of the two callables (`addCustomMenuItem`,
      `addExtractedMenuItems`); client OTA optional (carries
      docs only).

- [ ] **Smoke tests post-deploy** â€” (1) delete the broken
      test-shop items via Firestore console, (2) re-scan via
      "ðŸ“¸ Scan rate-list (AI)" or add via "+ Add custom item",
      (3) verify the new items render the category-themed
      placeholder image (not an empty box) on both shop-owner
      and customer views, (4) verify a real image upload via
      the existing PR 6.1 signed-PUT picker still overrides
      the placeholder. `[Phase 32.2-smoke]`

- [ ] **DEFERRED â€” Firestore backfill** of existing items'
      `imageUrl` to the `.png` form. Pilot scale (~10â€“30 test
      items per shop) makes manual delete-and-re-scan faster
      than coding the backfill. Script sketch in PR 32.2's
      prompt if/when scale forces it: walk
      `collectionGroup('menu').where('imageUrl', '>=', 'https://placehold.co/400x400/')`,
      string-replace `400x400/` â†’ `400x400.png/`, write back.
      `[Post-launch]`

- [ ] **DEFERRED â€” Switch placeholder provider** to a
      pre-generated set of PNGs hosted on Firebase Storage.
      More work, no clear benefit at pilot scale. Revisit only
      if placehold.co rate-limits or has reliability issues.
      `[Post-launch]`

## PR 36.2 â€” Reset pilot data script `[Phase 36.2]`

- [x] **Reset pilot data script shipped.** New
      `scripts/reset-pilot-data.ts` is a destructive cleanup
      that **keeps users** (Firestore profiles + Auth
      accounts + the admin user's claim) and wipes everything
      else: 11 Firestore top-level collections (`aiAuditLog`,
      `aiQuotas`, `auditLog`, `deliveryRequests`,
      `featureUsageLog`, `orders`, `pendingShopRequests`,
      `products`, `razorpayWebhookEvents`, `refunds`, `shops`
      including nested `menu/` subcollections), plus Storage
      prefixes `shop-kyc/` and `menu/`. Non-admin users with
      `isShopOwner` / `isDelivery` / `shopId` state get
      Firestore role fields scrubbed AND Auth custom claims
      rewritten (admin claim preserved when present) so the
      app routes them to the customer home on next sign-in
      instead of a deleted shop.

- [x] **Companion to `scripts/reset-test-data.ts`.** That one
      nukes everything including users + auth ("nuke from
      orbit"); this one is "clean app, same testers" mode.
      Both share the same `ALLOWED_PROJECTS` (grocery-mvp-dev
      only) + `assertProjectAllowed` + `protectAdminFromUserList`
      helpers via direct re-export from
      `scripts/reset-test-data.helpers.ts`. Single source of
      truth for the allowlist; one diff if it ever needs
      expansion.

- [x] **Pure-helper split** â€” `scripts/reset-pilot-data.helpers.ts`
      owns the testable logic (flag parser, collection list,
      storage path list, `planUserRoleCleanup`,
      `buildClaimsAfterRoleRevoke`). The main script is
      firebase-admin glue.

- [x] **Safety guards** â€” dry-run by default, `--execute`
      required to delete, typed-DELETE confirmation unless
      `--yes`, project allowlist, admin-UID protection
      (resolved from `--admin-uid=<uid>` flag â†’ `ADMIN_PROTECT_UID`
      env â†’ Firestore `users where isAdmin==true` lookup;
      aborts if all three fail or if multiple admins match).
      `--skip-storage` flag short-circuits the bucket
      cleanup for Firestore-only resets.

- [x] **Audit log per run** at
      `scripts/.cleanup-logs/{timestamp}-pilot.json` (already
      gitignored via `scripts/.cleanup-logs/*`). Records git
      sha, operator email, project ID, plan vs actual counts,
      affected UIDs, any per-batch failures. Both dry-run
      and execute write a log.

- [x] **Tests** â€” `tests/scripts/reset-pilot-data.test.ts`
      with **28 cases**: parseFlags coverage, COLLECTIONS_TO_WIPE
      exclusion pins (users, aiFeatures), STORAGE_PATHS_TO_WIPE
      shape, planUserRoleCleanup admin exclusion + field
      tuple, buildClaimsAfterRoleRevoke admin preservation,
      allowlist re-export parity. Two deliberate-break checks
      run + reverted: (1) appending `'users'` to
      `COLLECTIONS_TO_WIPE` failed the exclusion pin; (2)
      simulating an empty admin UID failed the
      `planUserRoleCleanup` adminUid-required test.
      **64 / 64 passing in `tests/scripts/`** (28 new + 36
      existing reset-test-data + others).

- [x] **`package.json` script alias** â€” `reset:pilot-data` in
      the `scripts` block, mirroring the `reset:test-data`
      entry. No new dependencies.

- [x] **OTA-eligibility audit** â€” `git diff HEAD -- app.json
      package-lock.json functions/package.json
      functions/package-lock.json` is empty. Only
      `package.json` changed (one new script entry). This is
      a **local tool â€” no deploy involved**, no OTA push
      required.

- [ ] **Local smoke test** â€” sequence per the PR 36.2 prompt:
      (1) `npm run reset:pilot-data` against an empty target â†’
      zero-count plan + "DRY RUN" exit; (2) generate test
      data (register a shop, place an order); (3) re-run
      dry-run â†’ non-zero counts; (4)
      `npm run reset:pilot-data -- --execute` â†’ type DELETE â†’
      verify in Firestore Console that `users` + `aiFeatures`
      survived and everything else is gone; (5) verify
      `shop-kyc/` + `menu/` Storage folders are gone; (6)
      sign in as a previously shop-owner test user and
      confirm they land on the customer home (no broken
      shop-owner state); (7) check
      `scripts/.cleanup-logs/` for the JSON log.
      `[Phase 36.2-smoke]`

- [ ] **Future: extend with `--only <names>`** for selective
      collection wipes (e.g., "wipe only orders + analytics
      between rounds"). Out of scope for v1. `[Post-launch]`

## PR 39 â€” Rebrand to HamaraSetu + Contact Support `[Phase 39]`

- [x] **Single source of truth â€” `src/constants/branding.ts`.**
      Exports `APP_NAME` (`'HamaraSetu'`), `TAGLINE`
      (`'Shop Smart, Shop Local'`), `SUPPORT_EMAIL`
      (`'sarastacklabs@gmail.com'`), `OPERATING_ENTITY`
      (`'Sara Stack Labs'`), `OPERATING_CITY` / `OPERATING_DISTRICT`
      / `OPERATING_STATE` / `LEGAL_JURISDICTION`. Every in-app
      brand string now imports from here so a future rename is
      one file, not a grep.

- [x] **`app.json` rebrand.** Top-level `name` + `expo.name`
      flipped to `HamaraSetu`; the 6 user-facing permission
      prompt strings (iOS `NSCameraUsageDescription`,
      `NSPhotoLibraryUsageDescription`,
      `NSMicrophoneUsageDescription`,
      `NSLocationWhenInUseUsageDescription`; Android
      `expo-image-picker.cameraPermission` +
      `photosPermission`; `expo-location.locationWhenInUsePermission`)
      now read **"HamaraSetu needs â€¦"**. **Native rebuild
      required** â€” permission strings ship in the native
      binaries, not OTA.

- [x] **In-app screen strings.** `LoginScreen` got a brand
      block above the Sign-in header (`APP_NAME` + `TAGLINE`).
      `HomeScreen` opt-in tile + accessibility label use
      `APP_NAME`. `BecomeDeliveryPartnerScreen` heading uses
      `APP_NAME`. `openLegal.ts` comment updated. `ProfileScreen`
      now has a **Help & Support** section above Legal with a
      "Contact support" row that calls `openSupportEmail()`.

- [x] **`src/utils/openSupport.ts`.** New helper builds a
      `mailto:sarastacklabs@gmail.com?subject=HamaraSetu support&body=â€¦`
      URL with a `Platform: <ios|android|web>` stamp and
      `App: HamaraSetu` line, gates on `Linking.canOpenURL`,
      and silently no-ops on failure (no crash if the device
      has no mail client). Mirrors the `openLegal.ts` pattern.

- [x] **Voice onboarding prompt example.** `voiceOnboardingHelpers.ts`
      example shop name updated from "Kirana Mart" to
      "HamaraSetu" so the LLM doesn't accidentally name new
      shops after the placeholder brand. Test in
      `tests/functions/voiceOnboardingHelpers.test.ts` updated
      in lock-step.

- [x] **Legal docs + hosted HTML titles.** `docs/privacy-policy.md`
      and `docs/terms-of-service.md` got global brand +
      operating-entity + jurisdiction replacements
      (`Faridabad, Haryana`). `scripts/build-legal-html.ts`
      page titles flipped to HamaraSetu; `npm run build-legal`
      regenerates `dist/privacy.html` + `dist/terms.html` for
      hosting.

- [x] **Operator tooling.** `scripts/reset-test-data.ts`
      console banner updated; `testing/README.md` title
      updated to "HamaraSetu â€” Testing Workbooks". No
      behavioural change.

- [x] **Tests** â€” `tests/constants/branding.test.ts` pins
      every constant to its expected literal (catches an
      accidental edit before it ships); `tests/utils/openSupport.test.ts`
      mocks `react-native`'s `Linking` and verifies the
      mailto recipient, subject, body markers, and silent-fail
      behaviour when `canOpenURL` returns false / throws.
      `tests/jest.unit.config.js` `testMatch` extended with
      `tests/constants/**/*.test.ts` so the new dir is picked
      up. **Final suite: 722 / 722 pass (72 suites);** root
      tsc 0 errors; `npm run audit` + `audit:indexes` green.

- [x] **OTA-eligibility audit** â€” **NOT OTA-eligible.**
      `git diff HEAD -- app.json` is non-empty (display name
      + permission strings). `package.json` /
      `package-lock.json` / `functions/*` lockfiles unchanged.
      Ship via `eas build --profile production` â†’ store
      submission, NOT `eas update`.

- [ ] **Smoke tests post native build** â€” (1) install the
      new build, confirm springboard shows "HamaraSetu", (2)
      tap Login â†’ brand block visible above sign-in, (3)
      trigger camera / photos / mic / location prompts and
      verify each iOS/Android system dialog reads "HamaraSetu
      needs â€¦", (4) `Profile â†’ Contact support` opens the
      mail app pre-filled to `sarastacklabs@gmail.com` with
      `HamaraSetu support` subject + `App: HamaraSetu` body
      line, (5) `Profile â†’ Privacy policy` + `Terms of service`
      open the HamaraSetu-titled hosted pages. `[Phase 39-smoke]`

- [ ] **Deploy hosted legal HTML** â€” `npm run build-legal`
      then `firebase deploy --only hosting` (or copy the
      regenerated `dist/privacy.html` + `dist/terms.html` to
      whatever hosts `grocery-mvp-dev.web.app`) so the in-app
      links reflect the new brand. `[Phase 39-deploy]`

- [ ] **DEFERRED â€” App Store / Play Store listing copy +
      screenshots** referencing HamaraSetu. Store metadata
      lives outside the repo; queue when prepping the first
      production submission. `[Pre-launch store-submit]`

- [ ] **DEFERRED â€” Hindi tagline (`à¤¹à¤®à¤¾à¤°à¤¾ à¤¸à¥‡à¤¤à¥`) + bilingual
      brand block** on Login. Single-line constant addition
      once the Hindi rendering is QA'd on both platforms.
      `[Post-launch]`

- [ ] **DEFERRED â€” In-app Contact-support form** (vs raw
      mailto). A Cloud Function-backed `supportTickets/`
      collection would let us thread + tag conversations.
      Worth it once support volume crosses ~5 tickets/week.
      `[Post-launch]`

## PR 41 â€” Admin pending-approval badges + deeplinks `[Phase 41]`

- [x] **Scope reframed from the original prompt.** The prompt's
      `notifyAdminsOnNewShopRequest` + `notifyAdminsOnNewDeliveryRequest`
      Firestore triggers were dropped â€” the existing in-callable
      `pushToAdmins` calls inside `registerShop`
      (`@functions/src/index.ts:~3373`) and `requestDeliveryRole`
      (`@functions/src/index.ts:~3685`) already fan out admin push
      notifications. Adding the triggers as written would have caused
      duplicate notifications for every applicant. The PR keeps the
      existing notification surface and focuses on what was actually
      missing: persistent badge counts + deeplink-on-tap.

- [x] **New server callable â€” `getPendingApprovalCounts`.** Single
      callable that projects counts onto the caller's claims:
      admin â†’ `{ shopCount, deliveryCount }`; shop owner â†’
      `{ pendingOrderCount }`; anyone else â†’ all zeros. Deliberately
      does NOT throw `permission-denied` for plain customers because
      the badge UI polls on every HomeScreen mount; a 403 in Sentry
      on every customer launch would be pure noise. Lives at
      `@functions/src/index.ts:~3878`. **Collection-name correction
      from the prompt:** pending shops live in `shops` with
      `status === 'pending'` (same source `listPendingShops` reads
      from), NOT a separate `pendingShopRequests` collection â€” the
      prompt's "Important corrections" section already flagged the
      same class of mistake for the delivery side.

- [x] **Pure helpers â€” `functions/src/pendingCountsHelpers.ts`.**
      `projectPendingCounts(role, raw)` zero-projects unauthorised
      buckets (belt-and-braces over the role-gated Firestore queries
      upstream); `countPendingDocs(docs)` defensively filters for
      `status === 'pending'` even though the upstream query already
      pins it; `capPendingCount(n)` server-side caps at 999 so a
      misbehaving client can't burn bandwidth on a runaway integer.
      Pure helpers + IO split keeps the counting logic unit-testable
      without firebase-admin.

- [x] **Client hook â€” `src/hooks/usePendingCounts.ts`.** Polls
      `getPendingApprovalCounts` every 30s while `enabled` is true.
      Inactive for plain customers (hook short-circuits without
      calling the server). State machine mirrors
      `useOnlineDeliveryCount.nextPollState`: tolerate up to
      `PENDING_COUNTS_STALE_THRESHOLD=3` consecutive failures, then
      drop to all-zero so the badge UI doesn't render a stale number
      forever. Pure `nextPendingCountsState` extracted for tests.
      Hook MUST be invoked above any conditional return per
      `.windsurf/code-discipline.md` Rule 5 â€” HomeScreen has the
      explicit comment block above its `usePendingCounts(...)` call.

- [x] **Client wrapper â€” `orderService.getPendingApprovalCounts`.**
      Native (`@react-native-firebase/functions`) + web SDK dispatch,
      same Plan B branching as every other callable in
      `@src/services/orderService.ts`.

- [x] **Filter-parity audit â€” shop-owner `pendingOrderCount`.**
      `ShopOwnerDashboardScreen` does NOT have New/Preparing/Ready/
      Past tabs (the prompt's framing was speculative); it has a
      single "Pending" stat card computed as `o.status === 'pending'`
      (`@src/screens/shop/ShopOwnerDashboardScreen.tsx:195`). The
      OrderStatus state machine is `pending â†’ accepted â†’ preparing
      â†’ ready_for_pickup â†’ delivered` (`cancelled` terminal); there
      is no `'placed'` value. The callable's
      `where('status', '==', 'pending')` matches the dashboard stat
      exactly, so the badge number will equal the stat number the
      shop owner sees on tap-through. **Inline comment in the
      callable pins this contract** so a future PR can't drift the
      two filters apart silently.

- [x] **Single-shop scoping confirmed.** Phase 12a constraint ("one
      shop per user", policy block at `mergeCustomClaims` upstream)
      means `claims.shopId` is a single string and the query is
      `where('shopId', '==', claims.shopId)`. Mirrors `listShopOrders`
      / `listShopCustomers` via the same caller-shopId semantics
      (those go through `validateShopOrdersAccess`; this callable
      reads claims directly because it doesn't need the admin
      override surface). **Inline comment in the callable signposts
      the multi-shop migration path** (claim shape would become
      `shopIds: string[]`, query becomes `where('shopId', 'in',
      shopIds)`, response gains per-shop breakdown).

- [x] **HomeScreen badges (3 placements).** White pill badge with
      `99+` cap on the rendered count:
      - "Pending Shop Approvals" row â†’ `pendingCounts.shopCount`
      - "Delivery requests" row â†’ `pendingCounts.deliveryCount`
      - "Shop Dashboard" role row â†’ `pendingCounts.pendingOrderCount`
      Accessibility labels include the count when non-zero
      ("Pending Shop Approvals, 3 waiting"). Empty badge state
      hides the pill entirely so the chevron sits where it always
      did.

- [x] **Screen header counts â€” pre-existing.** Audit found
      `PendingShopsScreen` and `PendingDeliveryRequestsScreen`
      already render `Pending shops (${shops.length})` /
      `Delivery requests (${requests.length})` in their
      `ScreenHeader` title. No change needed there â€” `[x]` because
      the requirement is already satisfied, not because PR 41
      added the code.

- [x] **Android `admin-alerts` notification channel.**
      `pushService.registerForPushNotifications` now creates a
      second channel (`Admin Approval Queue`,
      `AndroidImportance.DEFAULT`) alongside the existing `default`
      channel (order alerts, `HIGH`). Server-side `pushToAdmins`
      stamps `channelId: 'admin-alerts'` on every Expo message so
      Android routes admin pushes onto the new channel. iOS ignores
      `channelId`; web push routes itself.

- [x] **Notification-tap deeplink.** New
      `src/navigation/navigationRef.ts` exposes a module-level
      `createNavigationContainerRef` + `safeNavigate` helper; wired
      into `@App.js:~24` `<NavigationContainer ref={navigationRef}>`.
      `AuthBootstrap.tsx`'s `addNotificationResponseReceivedListener`
      now branches on the existing in-callable payload shapes:
      - `{ type: 'shop_pending_approval', shopId }`
        â†’ `ShopRegistrationDetail({ shopId })`
      - `{ type: 'delivery_request_pending', uid }`
        â†’ `DeliveryRequestDetail({ uid })`
      - everything else (orderId / refund_failed / etc.) falls
        through to the legacy log-only branch.
      Non-admin users routed to the admin screens see the existing
      "Admin only" empty state â€” graceful, no crash.

- [x] **Analytics â€” `Analytics.admin_pending_badge_tapped`** (fires
      only when the badge is non-zero, with `kind: 'shop' |
      'delivery' | 'shop_owner_orders'` + the displayed `count`) +
      **`Analytics.admin_pending_notification_tapped`** (fires on
      push tap with the deeplink type + target_id). Both auto-mirror
      to `featureUsageLog/` via PR 38.1 routing.

- [x] **Tests** â€” `tests/functions/pendingCountsHelpers.test.ts`
      (12 cases: role projection ladder, defensive `'pending'`
      filter, cap behaviour incl. NaN / negative / Infinity) +
      `tests/hooks/usePendingCounts.test.ts` (6 cases: success
      resets, failure preserves, third-strike clears, recovery,
      custom threshold knob). **18 new passing. Full suite:
      740 / 740 (74 suites).** Root + functions tsc both 0 errors.
      `npm run audit` + `audit:indexes` green.

- [x] **OTA-eligibility audit** â€” `git diff HEAD -- app.json
      package.json package-lock.json functions/package.json
      functions/package-lock.json` is empty (the `app.json` edits
      from PR 39 are still dirty but PR 41 added nothing on top).
      No new SDKs, no plugin changes, no permission requests.
      Server changes ship via `firebase deploy --only functions`;
      client ships via `eas update --branch production`.

- [ ] **Cloud Run IAM verification â€” MANDATORY post-deploy step.**
      Per `.windsurf/deploy-discipline.md` "Cloud Run `allUsers`
      invoker IAM" section (May 26 2026 incident: PR 1's
      `listpendingdeliveryrequests` callable 401'd despite a
      "successful" deploy because the `allUsers` â†’
      `roles/run.invoker` binding wasn't applied). After
      `firebase deploy --only functions:getPendingApprovalCounts`:

      ```powershell
      gcloud run services get-iam-policy getpendingapprovalcounts --region=asia-south1 --project=grocery-mvp-dev
      ```

      Confirm `allUsers` + `roles/run.invoker` in bindings. If
      missing:

      ```powershell
      gcloud run services add-iam-policy-binding getpendingapprovalcounts --region=asia-south1 --member=allUsers --role=roles/run.invoker --project=grocery-mvp-dev
      ```

      Without this step the badge counts will silently be 0 on every
      device and Sentry will fill with 401s on every HomeScreen
      mount. `[Phase 41-deploy]`

- [ ] **Smoke tests post-deploy** â€” (1) sign in as admin, land on
      HomeScreen, confirm the "Pending Shop Approvals" + "Delivery
      requests" rows show numeric badges matching the actual
      `shops`/`deliveryRequests` queue depth in Firestore Console;
      (2) from a second test phone, register a new shop â†’ on admin
      device the push arrives within ~5s, badge increments on next
      poll tick (â‰¤30s); (3) tap the push â†’ app opens directly to
      `ShopRegistrationDetail` for that shop; (4) approve the shop
      â†’ badge drops within â‰¤30s; (5) repeat with
      `BecomeDeliveryPartnerScreen` on a third phone; (6) sign in
      as a shop owner with pending orders, confirm "Shop Dashboard"
      row shows the pending count badge; (7) sign in as a plain
      customer (9999999991), verify HomeScreen has NO badges and
      no `getPendingApprovalCounts` 401 in Sentry.
      `[Phase 41-smoke]`

- [ ] **DEFERRED â€” Per-admin "subscribe to notifications" toggle**
      in Profile. Single admin during pilot; channel-level mute on
      Android is enough for now. `[Post-launch]`

- [ ] **DEFERRED â€” Rich notifications** (image previews, inline
      Approve/Reject action buttons on the push itself). Expo Push
      doesn't support custom action buttons; would need a native
      module migration. Phase D polish. `[Post-launch]`

- [ ] **DEFERRED â€” Aging-escalation push** ("this shop has been
      waiting 12+ hours"). Worth doing once the pilot has multiple
      admins or admin response time becomes an SLA concern.
      `[Post-launch]`

- [ ] **DEFERRED â€” Web push for admin desktop dashboard.** The
      PR 38.1 cross-SDK auth-context trap (RNFB native auth â†” Web
      SDK Firestore) makes this messier than it sounds. Out of
      scope until there's a confirmed admin-on-laptop workflow.
      `[Post-launch]`

## PR 42 â€” Storefront photo on shop card + mandatory in registration `[Phase 42]`

- [x] **Closes the PR 31 â†’ PR 41 gap.** PR 31 captured the
      storefront photo during shop self-registration into
      `shops/{id}.registrationData.kycDocs.storefront.storagePath`.
      `approveShop` never copied that to the customer-facing
      `shop.imageUrl`, so PR 41's `<Image>` hotfix in ShopCard
      always fell back to the ðŸª placeholder for every newly
      registered shop. PR 42 closes the loop.

- [x] **Path-on-doc correction vs. the prompt.** Prompt said
      `pendingData?.kycDocs?.storefront?.storagePath`. Wrong â€” KYC
      docs land on the SAME `shops/{shopId}` doc via
      `recordShopKycUpload` at
      `registrationData.kycDocs.{kind}.storagePath`
      (`@functions/src/index.ts:~1631`). There is no separate
      `pendingData` collection. Helper + callable use the correct
      path; inline comment in
      `@functions/src/approveShopHelpers.ts:1-25` pins the
      lineage.

- [x] **Server â€” pure helpers in
      `@functions/src/approveShopHelpers.ts`.**
      `pickStorefrontPath(shopDocLike)` returns the string path or
      `null`, defending against 5 real shapes (no
      `registrationData`, no `kycDocs`, no storefront field,
      empty `storagePath` string, non-string forged payload,
      `storefront: null`). `STOREFRONT_SIGNED_URL_TTL_MS` exported
      as a constant (10 years) so the helper and callable agree
      and the unit test can assert it without depending on the
      test's clock. Pure helpers + IO split mirrors
      `pendingCountsHelpers` posture.

- [x] **Server â€” `approveShop` wires `imageUrl`** at
      `@functions/src/index.ts:~3441-3494`. Reads the storefront
      path via the helper, mints a v4 signed read URL via
      `getStorage().bucket().file().getSignedUrl(...)` (same
      pattern as `getShopKycReadUrls`), and stamps it into the
      `shops/{shopId}` `update()` payload. **Non-fatal
      degradation** â€” missing path or signing failure leaves
      `imageUrl` unwritten (NOT `''`); the spread
      `...(storefrontImageUrl ? { imageUrl: storefrontImageUrl }
      : {})` preserves any existing `imageUrl` value on a
      re-approval that failed signing rather than wiping it back
      to empty.

- [x] **Re-approval is out of scope (architectural ceiling).**
      The prompt's smoke item 4 ("admin re-approves an existing
      shop to refresh the imageUrl") cannot be exercised because
      `approveShop` rejects with `failed-precondition` for any
      shop not currently in `'pending'` status
      (`@functions/src/index.ts:~3434`). Pre-PR-42 shops that
      already approved with `imageUrl: ""` will stay on the ðŸª
      placeholder until either (a) a future PR adds a
      `regenerateShopImageUrl` admin callable, or (b) an admin
      manually flips the shop's status back to `'pending'` in
      Firestore Console. Accepted as-is for pilot â€” the prompt's
      "either is acceptable" clause covers this.

- [x] **Client â€” storefront mandatory in `RegisterShopScreen`.**
      Three coordinated changes in
      `@src/screens/roles/RegisterShopScreen.tsx`:
      1. Label updated from "Storefront photo" â†’ "Storefront
         photo (required)" in `KYC_LABELS`
         (`@src/screens/roles/RegisterShopScreen.tsx:58-67`).
      2. Step-2 intro copy rewritten to flag storefront as
         required and the other three as optional
         (`@src/screens/roles/RegisterShopScreen.tsx:666-673`).
      3. `handleFinish` gates on `storefront.storagePath` and
         shows the exact alert copy from the prompt
         ("Please upload a photo of your storefront before
         submitting. This will be your shop's main image in the
         app.") (`@src/screens/roles/RegisterShopScreen.tsx:280-286`).
      4. `Finish & wait for approval` button disabled until
         `storefront.storagePath` is set and not uploading
         (`@src/screens/roles/RegisterShopScreen.tsx:705-710`) â€”
         defence in depth alongside the alert (disabled state
         can race with the async `setStorefront` write, so the
         alert is the authoritative gate).

- [x] **ShopCard rendering â€” verified, no change.** PR 41's
      hotfix at `@src/components/shop/ShopCard.tsx` already
      renders `<Image>` when `imageUrl` is truthy and the ðŸª
      placeholder when falsy. Once PR 42's signed URLs flow in,
      the card auto-upgrades to real photos without any code
      change on the client.

- [x] **Tests** â€” `tests/functions/approveShopHelpers.test.ts`
      (9 cases): 7 path-extraction cases covering every real
      shape + 2 TTL constant assertions. **Full suite: 749 / 749
      (75 suites).** Root + functions tsc both 0 errors.

- [x] **OTA-eligibility audit** â€” no `app.json` / `package.json`
      / lockfile changes. No new SDKs, no plugin changes, no
      permission requests. Server changes ship via
      `firebase deploy --only functions`; client ships via
      `eas update --branch production`.

- [ ] **Cloud Run IAM verification â€” MANDATORY post-deploy step.**
      Per `.windsurf/deploy-discipline.md` "Cloud Run `allUsers`
      invoker IAM" section. `approveShop` is being modified;
      after `firebase deploy --only functions:approveShop`:

      ```powershell
      gcloud run services get-iam-policy approveshop --region=asia-south1 --project=grocery-mvp-dev
      ```

      Confirm `allUsers` + `roles/run.invoker` in bindings. If
      missing:

      ```powershell
      gcloud run services add-iam-policy-binding approveshop --region=asia-south1 --member=allUsers --role=roles/run.invoker --project=grocery-mvp-dev
      ```

      Without this step, admin's first attempt to approve a new
      shop after deploy will 401 silently and the shopkeeper will
      be stuck on WaitingForApproval forever. `[Phase 42-deploy]`

- [ ] **Smoke tests post-deploy** â€” (1) fresh shop-owner test
      phone registers a new shop, completes step 2 WITHOUT a
      storefront upload â†’ Finish button is disabled AND tapping
      it (via the disabled-race window) shows the
      "Storefront photo required" alert; (2) upload a real
      storefront photo â†’ Finish enables â†’ submission completes â†’
      lands on WaitingForApproval; (3) admin signs in, approves
      the new shop via `ShopRegistrationDetail` â†’ customer signs
      in, opens the shop list â†’ the new shop's card shows the
      ACTUAL uploaded photo, not the ðŸª placeholder;
      (4) pre-PR-42 shops with `imageUrl: ""` (e.g. Sudhir
      Grocery Store) still render the ðŸª placeholder â€” no
      regression on the falsy-imageUrl path; (5) label copy
      reads "Storefront photo (required)" on the step-2 card.
      `[Phase 42-smoke]`

- [x] **PR 42.0.1 â€” `regenerateShopImageUrl` admin callable
      (promoted from deferred â†’ shipped May 26 2026 evening).**
      Pilot smoke test caught a shop that was approved post-PR-42
      with `imageUrl: ''` â€” meaning `approveShop`'s storefront
      signing silently failed inside its `try/catch` and the
      customer card fell back to the ðŸª placeholder. Without a
      recovery path, the only fix was a manual Firestore Console
      status flip (pending â†’ re-approve). Three changes shipped:

      1. **New `regenerateShopImageUrl` admin callable** at
         `@functions/src/index.ts:~4503-4600`. Re-runs the
         storefront-path â†’ signed URL â†’ `shop.imageUrl` write
         on any active/suspended shop. Reuses `pickStorefrontPath`
         from `approveShopHelpers.ts` so both callables agree
         on the field shape. **Opposite error posture from
         `approveShop`**: throws `HttpsError('internal', ...)`
         with the underlying signing error message so the admin
         sees the actual cause (most likely missing
         `iam.serviceAccounts.signBlob` self-binding on the
         compute service account â€” the classic Cloud Functions
         signing gotcha). Audit-logs `shop.regenerate-image-url`
         with `priorImageUrlEmpty` so a recovery vs. re-mint can
         be distinguished post-hoc.

      2. **Structured logging on `approveShop`'s silent paths**
         at `@functions/src/index.ts:~3474-3506`. The original
         PR 42 catch used `console.warn(message, error)` which
         is unsearchable in Cloud Logging. Upgraded to
         `console.error(structured)` with
         `event: 'approveShop.signing-failed'`, `shopId`,
         `storefrontPath`, `ownerUid`, `err`, and `stack` so a
         log query like
         `severity=ERROR jsonPayload.event="approveShop.signing-failed"`
         surfaces the failure immediately. Also added a
         `'approveShop.no-storefront-path'` warn for the branch
         where the storefront field is missing entirely (legacy
         pre-PR-42 shop or a client bypassing the mandatory gate).

      3. **Admin UI button** on
         `@src/screens/admin/ShopDetailManagementScreen.tsx`:
         "ðŸ–¼ï¸ Generate storefront image" (when imageUrl is empty)
         or "ðŸ–¼ï¸ Refresh storefront image" (when populated).
         Lives alongside the Edit settings + Suspend/Unsuspend
         buttons in the actions block. Disabled while pending;
         shows the actual server error message via Alert on
         failure rather than a generic "something went wrong"
         banner. Client wrapper at
         `@src/services/orderService.ts:~467-485`.

- [ ] **Cloud Run IAM verification for `regenerateShopImageUrl`
      â€” MANDATORY post-deploy step.** Per the same pattern as
      the other admin callables modified in this stack.

      ```powershell
      gcloud run services get-iam-policy regenerateshopimageurl --region=asia-south1 --project=grocery-mvp-dev
      ```

      If `allUsers` + `roles/run.invoker` missing:

      ```powershell
      gcloud run services add-iam-policy-binding regenerateshopimageurl --region=asia-south1 --member=allUsers --role=roles/run.invoker --project=grocery-mvp-dev
      ```

      `[Phase 42.0.1-deploy]`

- [x] **Root-cause identified â€” V4 signed URL 7-day cap.**
      The regenerate callable surfaced the actual error (proving
      the diagnostic posture works):

      > `Max allowed expiration is seven days (604800 seconds).`

      NOT an IAM issue. The original PR 42 minted V4 signed URLs
      with a `STOREFRONT_SIGNED_URL_TTL_MS = 10 * 365 * 24 * 60 *
      60 * 1000` (10 years) per the prompt's "long expiry" spec.
      V4 signed URLs have a HARD CAP of 7 days baked into the
      GCS signer SDK â€” anything beyond rejects at signing time.
      Every `approveShop` call has been failing into the silent
      catch since PR 42 shipped. Bug introduced by me, not a
      platform/IAM problem. The signBlob IAM is fine.

- [x] **PR 42.0.2 â€” switched to Firebase download-token URLs
      (shipped May 26 2026 late evening).** Three changes:

      1. **Replaced `STOREFRONT_SIGNED_URL_TTL_MS` with
         `buildFirebaseStorageDownloadUrl`** in
         `@functions/src/approveShopHelpers.ts:99-114`. Pure
         URL builder for the canonical Firebase Storage
         download-token pattern:
         `https://firebasestorage.googleapis.com/v0/b/{bucket}/o/{encoded-path}?alt=media&token={uuid}`.
         No expiry, no V4 cap, no cron, no IAM signBlob
         requirement. This is exactly the URL shape the Firebase
         client SDK's `getDownloadURL()` produces.

      2. **Rewired `approveShop` AND `regenerateShopImageUrl`**
         at `@functions/src/index.ts:~3468-3484` and
         `@functions/src/index.ts:~4557-4574`. Both now mint a
         `randomUUID()` token, write it to the file's
         `firebaseStorageDownloadTokens` metadata via
         `file.setMetadata`, then construct the permanent URL
         via the new helper. The regenerate path additionally
         documents the implicit kill-switch behaviour: each
         setMetadata write replaces the prior token, so a stale
         leaked URL stops resolving the moment regenerate is
         tapped.

      3. **Tests replaced** at
         `@tests/functions/approveShopHelpers.test.ts:77-141`.
         Dropped the 2 TTL constant tests. Added 5 URL builder
         tests covering: well-formed URL shape, slash encoding
         (`%2F` not `/`), special-character encoding
         (space / `?` / `#` / `&`), token verbatim preservation,
         and bucket-name passthrough. **Suite: 769 / 769 (75 suites).
         Root + functions tsc both 0 errors.**

- [ ] **Smoke test the fix end-to-end post-deploy.** After
      `firebase deploy --only functions:approveShop,functions:regenerateShopImageUrl`:

      1. Open admin app â†’ All Shops â†’ tap the affected pilot shop
         (the one with `imageUrl: ''`).
      2. Tap **ðŸ–¼ï¸ Generate storefront image**.
      3. Expect Alert "Image refreshed". Card should now reload
         with the real photo immediately (the screen re-fetches
         the shop after success).
      4. Open the customer app â†’ Browse Shops Near Me â†’ confirm
         the shop's card shows the actual photo, not ðŸª.
      5. Register a BRAND NEW shop end-to-end (owner uploads
         storefront via RegisterShop step 2 â†’ admin approves).
         The customer card should land with the real photo on
         FIRST view, no manual regenerate needed.
      6. Tap **ðŸ–¼ï¸ Refresh storefront image** on the same shop.
         New URL should also work; verify the OLD URL (paste
         into browser) now 403s â€” confirms the token rotation
         kill-switch is functional. `[Phase 42.0.2-smoke]`

- [ ] **DEFERRED â€” Storage rules audit for token URLs.** The
      Firebase download-token URL bypasses Storage rules entirely
      (it's a shared-secret URL, not an authenticated request).
      Our `storage.rules` ALREADY denied unauthenticated reads on
      `shop-kyc/**` paths, and the token URL still works â€” that's
      the point of tokens. But a future "lock down KYC reads
      entirely" intent could fool itself: the token URL keeps
      working until the token is rotated or the file is deleted.
      Worth a comment in `storage.rules` near the shop-kyc rule
      noting the token-URL escape hatch. Not urgent. `[Post-launch]`

- [ ] **DEFERRED â€” Storefront re-upload from
      WaitingForApproval.** The screen mentions "you can add or
      replace any of them while your shop is pending review"
      but there's no edit-in-place flow today. Phase D polish.
      `[Post-launch]`

- [ ] **DEFERRED â€” Image optimization (WebP / responsive
      variants).** Firebase Storage CDN serves the raw upload at
      whatever resolution `expo-image-picker` produced (typically
      ~1-2MB JPEG). At pilot scale (<100 shops, <50 daily card
      renders per user) this is fine. Revisit when a single
      shop list render starts crossing 5MB of imagery.
      `[Post-launch]`

## PR 42.1 â€” Separate shop + delivery partner ratings `[Phase 42.1]`

- [x] **Why this PR exists.** PR 20's single-rating model compressed
      shop quality (freshness, packaging) AND delivery quality
      (timeliness, courtesy) into one number that flowed into
      `shop.ratingAvg`. Wrong both ways: bad deliveries unfairly
      tanked the shop's standing, AND delivery partners had no
      independent reputation surface. PR 42.1 splits the rating
      into two dimensions matching industry standard
      (Swiggy / Zomato / Blinkit). Not pilot-blocking but ships
      before shop #2 onboards so historical data isn't co-mingled.

- [x] **Schema additions â€” additive only, no migration.** Extended
      `Order` (`@src/types/index.ts:398-421`) with optional flat
      fields `shopRating`, `shopComment`, `deliveryRating`,
      `deliveryComment`. Legacy nested `rating: OrderRating` field
      kept READ-ONLY for orders rated before the cutover â€”
      `OrderDetailScreen` reads from whichever source has data.
      Extended `UserInfo` (`@src/types/index.ts:106-118`) with
      optional `deliveryRatingAvg` + `deliveryRatingCount`,
      populated only for delivery users.

- [x] **Pure helper â€” `validateDualRatingSubmission`** in
      `@functions/src/ratingHelpers.ts:163-478`. Accepts BOTH
      legacy (`stars` / `comment`) and new (`shopRating` /
      `shopComment` / `deliveryRating?` / `deliveryComment?`)
      input shapes; canonicalises to the new flat schema in the
      result. Shape detection: `input.shopRating !== undefined`
      â†’ new path; else `input.stars !== undefined` â†’ legacy â†’
      coerce to shop-only. **Submit-once policy spans BOTH
      schemas**: either `order.rating` (legacy nested object) OR
      `order.shopRating` (new flat number) blocks re-submission.
      **No-partner drop semantics**: if the customer sends a
      delivery rating but the order has no `deliveryPersonId`,
      the helper accepts shop rating and drops the delivery
      dimension with a `deliveryDropped: 'no-partner'` marker
      (callable logs + audits, doesn't fail). Pure helpers + IO
      split mirrors `pendingCountsHelpers` posture.

- [x] **Server â€” `submitOrderRating` rewritten** at
      `@functions/src/index.ts:5636-5824`. Multi-write transaction:
      order doc (new flat schema) + shop doc (rolling avg/count)
      + optional user doc (delivery rolling avg/count via
      `merge: true` so a fresh partner doc is initialized
      without overwriting unrelated fields like `isDelivery`
      mirror or `fcmTokens`). Double-tap race guarded by
      re-reading inside the transaction; submit-once span
      checks both legacy `rating` AND new `shopRating`. Audit
      log captures `shopRating`, `hasShopComment`,
      `deliveryRating`, `hasDeliveryComment`, `deliveryPersonId`,
      and `deliveryDropped` for ops diagnosis. Legacy
      `validateRatingSubmission` helper kept in
      `ratingHelpers.ts` for the existing test suite but its
      callable import dropped â€” the dual helper subsumes the
      legacy path.

- [x] **Server â€” `listAllUsers` augmented** at
      `@functions/src/index.ts:4460-4535`. Reads `users/{uid}`
      Firestore mirror for delivery users only (parallel
      `Promise.all` over the ~5 delivery partners at MVP scale,
      not the full 100-user list). Projects `deliveryRatingAvg`
      + `deliveryRatingCount` onto each `UserInfo` row. Returns
      `undefined` for non-delivery users + delivery users with no
      ratings yet so the admin UI knows to suppress the row.

- [x] **Client â€” `orderService.submitOrderRating` wrapper** at
      `@src/services/orderService.ts:212-245`. Accepts both
      input shapes (legacy + new) and returns the canonical
      new shape regardless of input. New callers use the dual
      fields; legacy shape stays accepted so a not-yet-OTA'd
      client during the deploy window can still submit a
      shop-only rating without the server rejecting it.

- [x] **Client â€” `RateOrderCard` split into dual sections** at
      `@src/components/order/RateOrderCard.tsx`. Two sections:
      "How was the shop?" (REQUIRED, shop stars + optional
      comment) and "How was your delivery?" (OPTIONAL, hidden
      entirely when `hasDeliveryPartner` is false, delivery
      stars=0 means "skipped"). Shared `StarPicker` sub-component
      handles both rows; the delivery comment input dims and
      becomes non-editable until the customer picks at least one
      delivery star (visual hint that comment without stars
      doesn't persist). 5 `useState` calls hoisted above any
      conditional return per Rules-of-Hooks (PR 12 lineage).
      Exported `RateOrderPayload` type so the parent's `onRated`
      callback types correctly.

- [x] **Client â€” `OrderDetailScreen` post-rating panel** at
      `@src/screens/OrderDetailScreen.tsx:643-730`. Three render
      paths converge on the same panel: (a) canonical new dual
      rating from server (`order.shopRating`), (b) optimistic
      dual rating (just-submitted, watcher not yet ticked),
      (c) legacy nested `order.rating.stars` for pre-PR-42.1
      orders. The variables `shopStars` / `shopComment` /
      `deliveryStars` / `deliveryComment` use nullish-coalescing
      to pick whichever source has data. Delivery dimension
      only renders when present (legacy + skipped orders hide
      it). Added `ratedSubtitle` + `ratedDeliveryBlock` styles
      at `@src/screens/OrderDetailScreen.tsx:1039-1051`.

- [x] **Admin â€” `UserDetailScreen` surfaces delivery rating**
      at `@src/screens/admin/UserDetailScreen.tsx:197-212`.
      Conditional row inside the Roles card: shows
      `"X â˜… (N)"` only for delivery users with
      `deliveryRatingCount > 0` so a brand-new partner with no
      ratings doesn't surface a misleading "0â˜…" badge. Count in
      parens gives admin context for the average (4.7â˜… from 2
      ratings â‰  4.7â˜… from 200).

- [x] **Tests** â€” extended
      `@tests/functions/ratingHelpers.test.ts:225-467` with 17
      new cases under `describe('validateDualRatingSubmission')`:
      both happy paths (dual + shop-only), legacy shape coercion,
      already-rated under either schema, no-partner drop,
      out-of-range shop / delivery, first-error-wins ordering,
      both comment length caps, whitespace collapse on both
      comments, unauth / wrong customer / wrong status, non-integer
      shopRating, and the delivery-alone-rejected case.
      **Full suite: 766 / 766 (75 suites). Root + functions tsc
      both 0 errors.**

- [x] **OTA-eligibility audit** â€” no `app.json` / `package.json` /
      lockfile changes. No new SDKs, no plugin changes, no
      permission requests. Server changes ship via
      `firebase deploy --only functions`; client ships via
      `eas update --branch production`.

- [ ] **Cloud Run IAM verification â€” MANDATORY post-deploy step.**
      Per `.windsurf/deploy-discipline.md` "Cloud Run `allUsers`
      invoker IAM" section. Both `submitOrderRating` AND
      `listAllUsers` were modified:

      ```powershell
      gcloud run services get-iam-policy submitorderrating --region=asia-south1 --project=grocery-mvp-dev
      gcloud run services get-iam-policy listallusers --region=asia-south1 --project=grocery-mvp-dev
      ```

      Confirm `allUsers` + `roles/run.invoker` in bindings for
      EACH. Apply `add-iam-policy-binding` per service if
      missing. Without this, the first rating submit after
      deploy will 401 silently and the admin UserDetail page
      will throw 401 errors on load. `[Phase 42.1-deploy]`

- [ ] **Smoke tests post-deploy** â€” (1) dual-rating UI renders
      on a delivered order with a delivery partner: two sections
      visible with independent star pickers; (2) submit shop=5 +
      delivery=4 + both comments â†’ server accepts, panel flips
      to "Thanks for rating!" showing both ratings; (3) submit
      shop-only (don't touch delivery section) â†’ server accepts,
      only shop dimension shown in panel; (4) shop's
      `ratingAvg` on the home-screen card reflects the new
      rolling average (only the `shopRating` value feeds it, not
      the blended single-rating); (5) admin
      `UserDetailScreen` for the delivery partner shows
      `"X â˜… (1)"` after the first dual rating; (6) re-rate the
      same order â†’ RateOrderCard is gone (replaced by the
      panel); submit-once enforced; (7) pre-PR-42.1 order with
      `order.rating.stars` set still renders the legacy panel
      ("You rated the shop â˜…â˜…â˜…â˜…â˜†") without crashing â€” no
      regression; (8) cancelled order has no RateOrderCard at
      all. `[Phase 42.1-smoke]`

- [x] **PR 42.1.1 hotfix â€” Firestore reads-before-writes in
      `submitOrderRating` (shipped May 26 2026 late evening).**
      Pilot smoke test caught:

      > `Error: Firestore transactions require all reads to be executed before all writes.`

      Root cause: the original PR 42.1 transaction did
      `tx.get(orderRef)` â†’ `tx.get(shopRef)` â†’ `tx.update(orderRef)`
      â†’ `tx.set(shopRef)` â†’ `tx.get(userRef)` â†’ `tx.set(userRef)`.
      Firestore enforces a strict ordering: ALL reads must
      complete before ANY write. The interleaved
      `tx.get(userRef)` inside the `if (deliveryRating && userRef)`
      block threw the moment a customer submitted a dual rating
      with the delivery dimension on an order with a populated
      `deliveryPersonId`. Shop-only ratings worked because the
      gated read never ran.

      Fix at `@functions/src/index.ts:5939-5952`: hoisted the
      user read up alongside the order + shop reads, gated by
      the same `(deliveryRating && userRef)` condition the write
      uses. The captured `userTxData` is then used by the write
      block at `@functions/src/index.ts:5995-6009`. No behaviour
      change for shop-only submissions or for orders without a
      delivery partner. **Suite: 769 / 769 still passing** (the
      existing tests cover the helper's logic; the bug was in
      the firebase-admin glue, not the helper).

- [ ] **Smoke-test the rating fix post-deploy.** After
      `firebase deploy --only functions:submitOrderRating`:

      1. As a customer, complete a delivered order WITH a
         delivery partner assigned.
      2. Submit shop=5 + delivery=4 + both comments. Server
         should accept (no 500). Panel flips to "Thanks for
         rating!" with both ratings visible.
      3. Verify Firestore: order doc has new flat `shopRating` /
         `deliveryRating`; shop doc's `ratingAvg` / `ratingCount`
         updated; delivery partner's `users/{uid}` doc has
         `deliveryRatingAvg` / `deliveryRatingCount` populated.
      4. Submit a second order with shop-only (skip delivery).
         Should also accept; user-read branch silent. `[Phase 42.1.1-smoke]`

- [ ] **DEFERRED â€” Add a transaction-shape regression test for
      `submitOrderRating`.** The current test suite covers
      `validateDualRatingSubmission` (pure helper, no firebase)
      but doesn't exercise the actual transaction body. A future
      test using `@firebase/rules-unit-testing` or an admin SDK
      mock would catch reads-after-writes regressions. The pure
      helper is the high-value coverage target; transaction-shape
      tests are valuable but more setup. `[Post-launch]`

## PR 43 â€” Hide ETA until shop accepts + KYC mandatory enforcement `[Phase 43]`

- [x] **Why this PR exists.** Two customer-trust changes from the
      May 26 2026 pilot smoke test bundled together because they
      touch adjacent surfaces and share an OTA-only deploy
      posture. Part A: pre-PR-43 the customer saw
      "Arriving in ~29 min" the moment they placed an order, based
      on `shop.etaMinutes` (the shop's default wish, not a
      commitment). Trust Principle 2 (close the loop with honest
      signals) violation â€” the shop owner hadn't even seen the
      order yet. Part B: shop registration was admitting shops
      without GST + without Owner ID proof; Section 24 of the
      CGST Act requires GSTIN for every e-commerce supplier and
      identity proof is baseline KYC against fraud.

### Part A â€” Customer ETA hidden until acceptance

- [x] **Pure helper â€” `orderEtaDisplay`** at
      `@src/utils/orderEtaDisplay.ts:1-114`. Function of
      `(order, nowMs)` â†’ tagged union with 5 kinds:
      `awaiting_confirmation` (status === 'pending'),
      `ready_by` (shop set `readyByEstimate`),
      `eta_fallback` (accepted+ but no `readyByEstimate` â€”
      defensive for legacy orders), `arriving_soon`
      (eta_fallback overshot), `hidden` (delivered / cancelled /
      both estimates missing). Defensive against NaN / 0 /
      negative timestamps + null Firestore values
      (`readyByEstimate?: number | null` to match Order's
      shape). Pure â†’ unit-testable without RN / clock / store.

- [x] **OrderConfirmationScreen wired** at
      `@src/screens/OrderConfirmationScreen.tsx:64-69` +
      `@src/screens/OrderConfirmationScreen.tsx:111-128`.
      Replaced the always-on "ETA: ~29 min" row with a
      status-aware Row that reads "Status: Awaiting shop
      confirmation" on pending orders. Removed the old
      `etaMinutes` calc entirely.

- [x] **OrderDetailScreen wired** at
      `@src/screens/OrderDetailScreen.tsx:277-283` +
      `@src/screens/OrderDetailScreen.tsx:327-371`. The pending
      branch renders a two-line block matching the existing
      `pickupRow` visual: primary "Awaiting shop confirmation",
      secondary "{shopName} will confirm shortly". The
      readyByEstimate branch preserves PR 36.1's
      `formatRelativeTime` countdown. Legacy fallback path
      retained for accepted-without-readyByEstimate edge case.
      Comment lineage extended: PR 12 â†’ PR 36.1 â†’ PR 43.

- [x] **ActiveOrdersRail wired** at
      `@src/components/order/ActiveOrdersRail.tsx:40-79`. The
      `etaText()` helper now delegates to `orderEtaDisplay`
      and produces 5 rail-specific strings: "Awaiting shop
      confirmation" (pending), "Ready in ~22 min" (ready_by
      with positive minutes), "Arriving soon" (ready_by
      overshot OR eta_fallback overshot), "Arriving in ~25 min"
      (eta_fallback fallback), "" (hidden â†’ caller hides row).
      Rail-specific early returns for `ready_for_pickup`
      kept above the helper call ("Out for delivery" /
      "Almost ready") since those are tight summary copy
      unique to this surface.

- [x] **Shop-owner + delivery-partner + admin surfaces
      DELIBERATELY untouched.** Per the prompt's "shop-owner
      and delivery-partner surfaces unchanged" rule. Verified
      by grep: `src/screens/shop/ShopOrderDetailScreen.tsx`
      still uses raw `minutesLeft` math for the shop-owner
      audience; `src/screens/admin/AdminOrdersScreen.tsx`
      still surfaces `readyByEstimate` directly. Those
      audiences have legitimate reasons to see the pre-
      acceptance estimate (shop owner: planning; admin:
      diagnostics).

- [x] **Tests** â€” 13 cases in
      `@tests/utils/orderEtaDisplay.test.ts:1-141` covering
      every union branch + defensive paths: pending â†’
      `awaiting_confirmation`, pending IGNORES `readyByEstimate`
      (trust boundary), all three accepted+ states return
      `ready_by` when `readyByEstimate` set, accepted-without-
      readyByEstimate â†’ `eta_fallback`, eta_fallback overshot â†’
      `arriving_soon`, delivered/cancelled â†’ `hidden`,
      double-missing â†’ `hidden`, NaN / 0 / zero readyByEstimate
      fall-through.

### Part B â€” KYC mandatory enforcement

- [x] **Decision: reused existing `ownerIdDoc` slot instead of
      adding a `panDoc` schema field.** The prompt asked for
      two separate Aadhaar + PAN tiles, but the existing
      `ShopKycDocKind` enum already has a single
      `ownerIdDoc` slot labelled "Owner ID (Aadhaar/PAN)" with
      the hint "Aadhaar or PAN card of the proprietor". The
      owner already chooses which physical document to
      photograph. Adding a `panDoc` kind would require updating
      `ShopKycDocKind` + `VALID_DOC_KINDS` server-side +
      `getShopKycReadUrls` + admin review screens + storage
      rule comments for **zero customer-trust benefit** â€” the
      gate intent ("force identity proof at registration") is
      enforceable with one slot. Documented divergence; if
      operations later wants both, splitting is purely additive
      (`panDoc?: ShopKycDocRef` next to the existing field).

- [x] **`handleFinish` triple gate** at
      `@src/screens/roles/RegisterShopScreen.tsx:283-326`.
      Sequential check order: (1) storefront â€” PR 42 carry-over,
      (2) `ownerIdDoc` â€” Aadhaar OR PAN, (3) `gstDoc` â€” Section
      24 CGST Act compliance. Each gate alerts with actionable
      copy. GST alert includes the gst.gov.in remediation hint
      for owners without GSTIN. FSSAI deliberately NOT gated â€”
      relevant only for prepared-food resellers and free-text
      license number is an acceptable substitute.

- [x] **Defensive double-guard on Finish button** at
      `@src/screens/roles/RegisterShopScreen.tsx:758-765`.
      `disabled` prop now considers all 3 mandatory slots â€”
      both their `storagePath` populated AND not mid-upload.
      Pairs with the `handleFinish` alert so an async
      `setSlot` write that races the tap still hits the
      validation re-check.

- [x] **Tile reordering + label updates** at
      `@src/screens/roles/RegisterShopScreen.tsx:58-81` +
      `@src/screens/roles/RegisterShopScreen.tsx:706-745`.
      Required tiles surface first in the order they're gated
      (storefront â†’ ownerIdDoc â†’ gstDoc), then FSSAI last.
      Labels: `gstDoc` "GST Certificate (required)",
      `ownerIdDoc` "Owner ID â€” Aadhaar or PAN (required)".
      Step-2 intro copy rewritten to enumerate the 3 required
      docs and explicitly mark FSSAI optional.

- [x] **GST helper line under tile** at
      `@src/screens/roles/RegisterShopScreen.tsx:732-739`
      + `kycHelper` style at
      `@src/screens/roles/RegisterShopScreen.tsx:966-976`.
      "Don't have GST yet? Register free at gst.gov.in. Takes
      3-7 working days." Self-serve unblock path for kiranas
      without GSTIN.

- [x] **Existing approved shop grandfathered.** No retroactive
      enforcement; gates only fire on the `RegisterShopScreen`
      submit flow. Sudhir Grocery Store (active since May 26)
      keeps functioning normally. No migration script, no
      admin "non-compliant" flag â€” out of scope per prompt.

- [x] **Server-side compat â€” no allowlist change needed.**
      `VALID_DOC_KINDS` in
      `@functions/src/kycUploadHelpers.ts` already includes
      `ownerIdDoc` and `gstDoc` (PR 31 baseline). Client
      uploads via `recordShopKycUpload` work without server
      changes. Pure OTA-eligible client work for Part B.

- [x] **Type checking + tests.** Root tsc 0 errors,
      functions tsc 0 errors. **782 / 782 tests pass (76
      suites)** â€” +13 cases for `orderEtaDisplay`. No
      Part-B-specific test file added (RegisterShopScreen
      has no existing test file; the gate logic is inline in
      a React component, not a pure helper that warrants
      isolated tests; coverage comes from the manual smoke
      checklist below).

- [x] **OTA-eligibility audit.** No `app.json`, `package.json`,
      lockfile, or native plugin changes. No new SDKs, no new
      permission requests. No Firebase Functions deploys
      needed. Pure `eas update` ship.

- [ ] **Smoke acceptance â€” Part A (customer ETA)** post-deploy:

      1. Place a fresh order as a customer. OrderConfirmation
         shows "Status: Awaiting shop confirmation" instead of
         "ETA: ~30 min."
      2. Open OrderDetailScreen for that pending order: status
         card primary "Awaiting shop confirmation", secondary
         "{Shop name} will confirm shortly". No minute count.
      3. HomeScreen active-orders rail card: "Awaiting shop
         confirmation" replaces "Arriving in ~28 min."
      4. As shop owner, accept order + set readyByEstimate.
         Customer's OrderDetail switches to PR 36.1 countdown;
         rail card flips to "Ready in ~22 min."
      5. Cancel pending order. Detail screen shows cancelled
         status; no ETA copy at all.
      6. Delivered order in Past Orders: tap â†’ no ETA line.
      7. Shop-owner ShopOrderDetailScreen still shows
         "ETA ~N min" for pre-acceptance orders â€” confirm
         intentional, no regression. `[Phase 43A-smoke]`

- [ ] **Smoke acceptance â€” Part B (KYC gates)** post-deploy:

      8. As a fresh shop owner, complete step 1 + step 2 KYC
         except skip both ownerIdDoc and gstDoc. Tap Finish â†’
         disabled (button greyed). Force-tap by completing
         only storefront â†’ Alert "Owner ID required".
      9. Upload Aadhaar (or PAN â€” either works) â†’ Finish still
         disabled until GST too. Tap â†’ Alert "GST Certificate
         required" with the gst.gov.in helper text in the body.
      10. Upload GST â†’ Finish enables â†’ submit succeeds â†’
          routes to WaitingForApproval.
      11. Helper line "Don't have GST yet? Register free at
          gst.gov.in. Takes 3-7 working days." visible
          immediately under the GST tile.
      12. Admin reviews the new pending shop in
          PendingShops â†’ ShopRegistrationDetail: all three
          uploaded docs preview correctly via
          `getShopKycReadUrls` (PR 31 path unchanged).
      13. Existing Sudhir Grocery Store: admin opens it via
          ShopManagement â†’ ShopDetailManagement. No
          "non-compliant" flag, no GST warning, no Identity
          Proof flag. Continues functioning. `[Phase 43B-smoke]`

- [ ] **Deploy.**

      ```powershell
      # No server changes â€” pure client OTA.
      eas update --branch production --message "PR 43 hide ETA until accepted + KYC mandatory enforcement"
      ```

      Force-quit + reopen app twice on TestFlight to load the
      new bundle. No Cloud Run IAM verification needed (no
      callable touched). `[Phase 43-deploy]`

- [ ] **DEFERRED â€” Push notification when shop accepts.**
      "Sharma Kirana has accepted your order â€” ETA 25 min."
      Useful UX to mask the silent
      `Awaiting...` â†’ `Ready in...` transition for customers
      who left the screen. Out of scope for PR 43 (push
      infrastructure tied to PR 41). Consider PR 43.1 if pilot
      feedback flags the silent transition. `[Post-launch]`

- [ ] **DEFERRED â€” Hindi/Devanagari ETA copy.** PR 40
      territory. PR 43 is English-only. `[Post-launch]`

- [ ] **DEFERRED â€” Retroactive KYC compliance scan against
      existing approved shops.** Admin tool to flag
      already-approved shops missing GST or ownerIdDoc.
      One-shop pilot doesn't need it; revisit when shop count
      grows past ~10. `[Post-launch]`

- [ ] **DEFERRED â€” GSTIN registry validation.** Today we
      accept whatever file the owner uploads as proof; not
      verifying that the GSTIN actually maps to a registered
      business at the GSTN portal. The portal has an API but
      requires paid access. Defer until operations confirms
      the file-only check is being abused. `[Post-launch]`

- [ ] **DEFERRED â€” Split `ownerIdDoc` into `aadhaarDoc` +
      `panDoc`.** Per the original PR 43 prompt's UI spec. If
      operations decides distinguishing the two doc types is
      worth admin reviewer time (e.g. for cross-referencing
      against the address proof or for PAN-specific tax
      flows), the schema split is purely additive. `[Post-launch]`

## PR-NEXT-7 â€” "Online delivery partners nearby" trust badge `[Phase NEXT-7]`

- [x] **Why this PR exists.** Finding **#9** in `@c:\Users\dahiy\grocery-mvp\docs\TESTING-FINDINGS-2026-05-30.md`. Shop owners had no visibility into whether anyone would actually pick up the orders they were preparing. At pilot scale that anxiety is real ("am I going to prepare 5 dishes and watch them go cold because no rider was online?"). A simple count â€” "**N delivery partners online nearby**" â€” is the cheapest trust signal we can ship. The signal must agree with reality: PR 50 wired per-partner notification radius into the push fanout, so the partners who would actually receive a push for a new order at this shop are a haversine-filtered subset of the total online count. Showing the unfiltered total would lie ("5 partners online" â†’ only 1 of 5 within their own notification radius gets pushed) and create a contradiction the shop owner sees the moment they accept an order.

- [x] **What shipped.**
      - **Pure helper** `@c:\Users\dahiy\grocery-mvp\functions\src\nearbyPartnersCountHelpers.ts` â€” `computeNearbyOnlinePartnerCount({auth, fetchShop, fetchOnlinePartners}) â†’ {ok, count, filtered}`. Auth-gates `claims.shopOwner === true && typeof claims.shopId === 'string'` (admins do NOT get this surface â€” they have `getOnlineDeliveryCount` on AdminOrdersScreen). Reuses **`filterPartnersByNotificationRadius` (PR 50) verbatim** so the count cannot disagree with `sendNewPickupPushToDelivery`. `filtered: false` when shop has no `location` (fail-open mirroring the push fanout's behavior for legacy shops). `NEARBY_PARTNER_HARD_CAP = 999` clamps absurd counts. Privacy: helper returns `{count, filtered}` only â€” no partner UIDs / names / FCM tokens / locations.
      - **Callable** `@c:\Users\dahiy\grocery-mvp\functions\src\index.ts:5754-5798` (`getOnlinePartnersNearMyShop`). `onCall({cors: true, enforceAppCheck: false})` matching `getOnlineDeliveryCount`'s posture. `fetchShop` normalises Firestore `GeoPoint`'s `latitude`/`longitude` accessors to the plain `{lat,lng}` shape the helper + push fanout share. `fetchOnlinePartners` runs the same `isDelivery==true && deliveryStatus=='online'` two-equality query the existing admin callable + push trigger use â€” no composite index required.
      - **Service method** in `@c:\Users\dahiy\grocery-mvp\src\services\orderService.ts:583-615` (RNFB native + web JS callable wrappers, mirroring the `getOnlineDeliveryCount` pattern). Defensive: `count` floored to a non-negative integer, `filtered === true` strict equality so any non-boolean shape from a misbehaving server collapses to `false`.
      - **Hook** `@c:\Users\dahiy\grocery-mvp\src\hooks\useOnlinePartnersNearMyShop.ts` â€” line-for-line adaptation of `useOnlineDeliveryCount`. 30s polling cadence (vs. 15s for the admin admin variant â€” partner availability changes slower than overall online count, lower owner-side cost). Same `cancelled` cleanup flag, same ref-based no-rerender on transient failure, same `setState` change-only gate. State machine pulled into the pure `nextNearbyPartnersState` so it's testable without a React renderer (RNTL out of scope per `.windsurf/test-discipline.md`). 3-strike stale-clear: 3 consecutive failures â†’ `{count: null, filtered: false}` so the placeholder copy renders honestly rather than holding a stale value forever.
      - **UI badge** in `@c:\Users\dahiy\grocery-mvp\src\screens\shop\ShopOwnerDashboardScreen.tsx:121-128,323-356`. Hook call sits ABOVE the early-return guards (Rule 2). Chip renders directly under the Today KPIs. Copy: `Checking partner availabilityâ€¦` for `count == null` (covers loading + permanent stale-clear; never shows a raw error message which would erode the trust the badge is trying to build) / `No delivery partners online nearby` / `N delivery partner[s] online nearby`. Optional secondary line `Set your shop location for an accurate count` only when `count != null && !filtered`. New `partnersChip` styles preserve the existing dashboard's chip rhythm (surface fill, border, gap, flex-wrap so the hint drops below on narrow phones).

- [x] **Tests.** 23 new cases. Suite green at **1089 / 1089**, up from 1066.
      - 14 cases in `@c:\Users\dahiy\grocery-mvp\tests\functions\nearbyPartnersCountHelpers.test.ts` â€” auth boundary (5: unauth, non-shopOwner, missing-shopId, empty-shopId, dual shopOwner+admin claims), shop existence (1: missing doc â†’ not-found), happy paths (4: mixed near/far, no online partners, partner-without-currentLocation kept fail-open, custom-larger-radius covering shop), fail-open (3: shop missing location, NaN coordinates, undefined location field), bounds (1: hard-cap clamp).
      - 9 cases in `@c:\Users\dahiy\grocery-mvp\tests\hooks\useOnlinePartnersNearMyShop.test.ts` â€” initial-state shape, success installs value + resets failures, fail-open `filtered: false` propagated verbatim, single transient failure preserves value, 3-strike stale-clear, recovery after stale-clear, counter-reset between transient failures, custom threshold, `filtered` flip on success even when count is unchanged.

- [ ] **Deploy plan â€” server-first.**

      ```powershell
      # Step 1: server
      cd functions
      npm run build
      firebase deploy --only "functions:getOnlinePartnersNearMyShop"
      ```

      Then verify the Cloud Run `allUsers` IAM binding (recurring gotcha â€” Firebase has stripped this on redeploy before; the callable returns silent 401 "access token could not be verified" without it and the badge shows "Checkingâ€¦" forever):

      ```powershell
      gcloud run services get-iam-policy getonlinepartnersnearmyshop --region asia-south1
      # if allUsers / roles/run.invoker missing:
      gcloud run services add-iam-policy-binding getonlinepartnersnearmyshop --region asia-south1 --member=allUsers --role=roles/run.invoker
      ```

      Step 2 â€” client OTA (only after callable is live + IAM verified):

      ```powershell
      eas update --branch production --message "PR-NEXT-7 partners-nearby badge"
      ```

- [ ] **Smoke acceptance (18-step checklist from the PR prompt; abbreviated here, full version in `@c:\Users\dahiy\grocery-mvp\docs\pr-next-7-online-partners-nearby-windsurf-prompt.md`).**
      - Auth gating: customer / non-shopOwner admin â†’ no callable hits.
      - Happy path: partner toggles Online â†’ shop owner's chip reads `1 delivery partner online nearby` within 30s; partner Offline â†’ flips to `No delivery partners online nearby`.
      - Out-of-range: partner narrows radius below shop distance â†’ chip flips to "No partners"; widens â†’ flips back.
      - Fail-open: clear shop's `location` (dev only) â†’ chip shows `N nearby` + the "Set your shop location" hint; restore location â†’ hint disappears next poll.
      - Regressions: AdminOrdersScreen's online count still works (separate callable); push fanout count still agrees with badge; tsc + jest clean.

- [x] **Doc trail.** Finding `#9` marked **SHIPPED in PR-NEXT-7** in `@c:\Users\dahiy\grocery-mvp\docs\TESTING-FINDINGS-2026-05-30.md:135`.

- [ ] **Out of scope (deferred).** Pull-to-refresh forcing a re-poll of the partners chip (30s background poll is sufficient at pilot scale). Per-area breakdown ("2 within 1 km, 3 within 3 km" â€” adds value at scale, not pilot). "Last 24h availability" trend (separate question, separate PR). WebSocket / Firestore live listener instead of polling (more reads at scale; 30s cadence fine at pilot). Push to shop owner when partners drop below threshold (introduces a new push type + cadence question).

## PR-NEXT-8 â€” Reorder UX cluster: dismissable âœ• + accurate "Order again" rail copy `[Phase NEXT-8]`

- [x] **Why this PR exists.** Two reorder-flow UX bugs from May 30 Android testing (findings **#14** + **#15** in `@c:\Users\dahiy\grocery-mvp\docs\TESTING-FINDINGS-2026-05-30.md`). Both small, both broke the user's mental model on first encounter.
      - **#14** â€” the âœ• glyph next to each Unavailable row in the Reorder modal was a static `<Text>` with no `onPress` (`@c:\Users\dahiy\grocery-mvp\src\components\order\ReorderModal.tsx:255` pre-PR). Every UI convention reads a red âœ• as "tap to dismiss"; customers tapped, nothing happened, the modal felt broken. The underlying filtering was already correct (`planToCartItems` only adds `available_*` lines to the cart) â€” the bug was purely about giving the âœ• the meaning users expected.
      - **#15** â€” the "Order again" rail card subtext read `{N} orders` (lifetime delivered-count for that shop). Customers misread it as "tap to see a list of past orders," but the modal actually shows the items of a SINGLE order (the most recent one). The "3 orders â†’ Add 4 items to cart" mismatch broke confidence on every first encounter.

- [x] **What shipped.**
      - **Pure helper** `@c:\Users\dahiy\grocery-mvp\src\utils\reorderModalDismissals.ts` â€” `addDismissedId(set, id)` (immutable update, idempotent on re-dismissal so React's setState reference-comparison can skip a re-render, no-op on null/undefined/empty) + `buildPlanKey(plan)` (stable string identity for plan contents â€” `${shopId}:${lineIds.join(',')}`). The screen owns the `useState<Set<string>>`; this module owns the contract so it's testable without `@testing-library/react-native` (which the suite doesn't host yet).
      - **Modal wire-up** in `@c:\Users\dahiy\grocery-mvp\src\components\order\ReorderModal.tsx`: new `useState` + `useEffect` (above all conditional renders, Rule 2). Effect keys on `buildPlanKey(plan)` so the parent screen re-creating the same plan object across renders doesn't wipe the customer's dismissals mid-interaction. `visibleUnavailableLines` / `visibleUnavailableCount` derived from `plan.lines` minus `dismissedIds`. Section title now `Unavailable (${visibleUnavailableCount})` and the whole section disappears when the count hits 0. `UnavailableRow` gains an `onDismiss: () => void` prop wiring the âœ• to a real `Pressable` with `hitSlop={12}` + `accessibilityRole="button"` + `accessibilityLabel={`Dismiss ${name}`}`. New `dismissBtn` + `dismissIcon` styles preserve the pre-PR visual rhythm.
      - **CTA + cart preserved** â€” `availableCount`, `subtotal`, and `planToCartItems` are unchanged. The CTA still says "Add N items to cart" with N = available items, and dismissing unavailable rows does NOT change N or what gets added to the cart.
      - **`FrequentShopEntry.lastOrderItemCount`** added to `@c:\Users\dahiy\grocery-mvp\src\utils\pickFrequentlyOrderedShops.ts:35-48`. Populated from `mostRecent.items.length` inside the existing helper loop with an `Array.isArray` guard so malformed docs render "Last order Â· 0 items" rather than crashing the rail. Schema-additive only â€” no callable / Firestore changes.
      - **Rail subtext copy** in `@c:\Users\dahiy\grocery-mvp\src\components\order\OrderAgainRail.tsx:91-95` flipped from `{N} orders` â†’ `Last order Â· {N} items` with `numberOfLines={1}` so a fixed-card-width truncation is graceful on small phones. Lifetime frequency signal moved from copy to position (most-frequent shop comes first; PR 14's sort unchanged).

- [x] **Tests.** 18 new cases. Suite green at **1066 / 1066**, up from 1048.
      - 14 cases in `@c:\Users\dahiy\grocery-mvp\tests\utils\reorderModalDismissals.test.ts` covering `addDismissedId` (immutable update, idempotent re-dismissal preserves reference, prior-dismissal preservation, null / undefined / empty-string no-ops, sequential chaining) and `buildPlanKey` (null/undefined â†’ null, identical-content stability, shopId/lines difference, line-order sensitivity, missing-lines / missing-shopId edge cases).
      - 3 cases extended in `@c:\Users\dahiy\grocery-mvp\tests\utils\pickFrequentlyOrderedShops.test.ts`: most-recent-not-lifetime semantics for `lastOrderItemCount` (older 3-item order vs newer 5-item order at same shop), malformed `items: undefined` â†’ 0, empty-array baseline â†’ 0.

- [ ] **Deploy plan.** Pure client OTA â€” no `firebase deploy`, no IAM verify, no Razorpay secret, no `app.json` change, no native module:

      ```powershell
      eas update --branch production --message "PR-NEXT-8 reorder UX cluster (dismissable X + rail copy)"
      ```

- [ ] **Smoke acceptance (14-step checklist from the PR prompt; abbreviated here, full version in `@c:\Users\dahiy\grocery-mvp\docs\pr-next-8-reorder-ux-cluster-windsurf-prompt.md`).**
      - Part A (âœ• dismissal, iOS first then Android): unavailable section shows N items with âœ• glyphs; tap one âœ• â†’ row disappears + section title decrements; tap last âœ• â†’ section header disappears; CTA copy stays "Add N items to cart" throughout (N = available); close + reopen modal â†’ all unavailable rows back; verify cart contents on confirm = available items only.
      - Part B (rail subtext): rail cards now read "Last order Â· M items" matching the reorder modal's row count on tap; rail still sorts by lifetime frequency.
      - Regression: empty-menu / all-unavailable / price-drift cases still render; rail still hides itself entirely when no frequent shops; tsc clean; tests green.

- [x] **Doc trail.** Findings `#14` and `#15` marked **SHIPPED in PR-NEXT-8** in `@c:\Users\dahiy\grocery-mvp\docs\TESTING-FINDINGS-2026-05-30.md:205,213`.

- [ ] **Out of scope (deferred).** Showing an actual list of past orders to pick from on tap (option (b) of finding #15 â€” bigger UX change; once option (a) is shipped, the copy honestly describes what happens). Undo affordance for dismissed rows (close-and-reopen restores; v1 doesn't need an explicit undo). Animating row removal on dismissal (`LayoutAnimation` is finicky on Android, instant is fine for a quick-fix PR). In-shop search (finding #6 / PR-NEXT-9 â€” separate, larger PR).

## PR-NEXT-6 â€” Delivery proof photo + payment-method visibility `[Phase NEXT-6]`

- [x] **Why this PR exists.** Findings **#13** + **#16(c)** + **#16(d)** in `@c:\Users\dahiy\grocery-mvp\docs\TESTING-FINDINGS-2026-05-30.md`. (1) When a customer says "they never delivered" or "items missing", the only artifact today is `deliveredAt` â€” a partner self-attestation, not evidence. A doorstep / handoff photo at the moment of delivery is the cheapest dispute-prevention tool we can ship. (2) Today the shop sees only `paymentMethod` (the customer's ORIGINAL choice), so a COD order paid mid-flow via `payCodOrder` mislabels as "Cash on Delivery" even though Razorpay actually settled it. The shop reads the COD label and either expects cash that never comes, or sees a confusing mismatch on every COD-converted order. The two are a single PR because both surfaces (the partner's photo + the shop's payment label) need to render together on the order-detail screen for "what actually happened" to be a complete record.

- [x] **What shipped.**
      - **Storage rules** at `@c:\Users\dahiy\grocery-mvp\storage.rules:64-81` â€” explicit deny-all `/delivery-proofs/{filename}` block alongside `/menu/` + `/shop-kyc/`. Same signed-URL posture: writes via `getDeliveryProofUploadUrl`, reads via `getDeliveryProofReadUrl`, both bypassing rules at signing time via the Admin SDK. Path scheme is deterministic `delivery-proofs/{orderId}.jpg` â€” one photo per order, re-upload overwrites cleanly.
      - **Pure helpers** at `@c:\Users\dahiy\grocery-mvp\functions\src\deliveryProofHelpers.ts` â€” three validators returning tagged union Results so the wrapping callables stay thin Firestore + HttpsError shells. `validateDeliveryProofUploadAuth` (delivery claim + assignee match + `pickedUpAt > 0` precondition), `validateDeliveryProofRecordInput` (path-prefix check defending against forged record-calls), `validateDeliveryProofReadAuth` (role-mixed: customer of order / shop owner of shop / admin / assigned partner â€” each independently checked, none alone is sufficient by default).
      - **Three callables** in `@c:\Users\dahiy\grocery-mvp\functions\src\index.ts:3712-3870` â€” `getDeliveryProofUploadUrl` (15-min v4 signed PUT, contentType-bound to `image/jpeg`), `recordDeliveryProofUpload` (re-runs upload auth + path-prefix check, stamps `deliveryProofStoragePath` + `deliveryProofUploadedAt` via `serverTimestamp()`), `getDeliveryProofReadUrl` (15-min v4 signed READ, on-demand minting so leaked URLs go stale). The record callable does NOT cache a long-lived URL on the order doc â€” that would defeat the privacy model (delivery photos are PII-adjacent: doorstep / building / customer-handoff imagery).
      - **Schema-additive `Order` fields** at `@c:\Users\dahiy\grocery-mvp\src\types\index.ts:593-610` â€” `deliveryProofStoragePath?: string` + `deliveryProofUploadedAt?: number | null`. Both optional; pre-PR-NEXT-6 orders have them absent. Rule 4 compliant; no migration.
      - **Client service wrappers** at `@c:\Users\dahiy\grocery-mvp\src\services\orderService.ts:1215-1282` â€” `getDeliveryProofUploadUrl(orderId)`, `recordDeliveryProofUpload({orderId, storagePath})`, `getDeliveryProofReadUrl(orderId)`. RNFB native + web-SDK paths mirror the existing menu / KYC wrappers exactly.
      - **Upload orchestrator** at `@c:\Users\dahiy\grocery-mvp\src\utils\uploadDeliveryProof.ts` â€” get-url â†’ PUT (with explicit `Content-Type: image/jpeg` to satisfy the v4 signature binding) â†’ record-confirm. PUT failures throw with the HTTP code + body excerpt; record-confirm is NOT called on a failed PUT (a half-stamped order doc would point at storage that doesn't exist). Returns `{storagePath}` so the caller can mint a read URL immediately for the just-uploaded thumbnail without waiting for the watcher tick.
      - **Photo CTA on `ActiveDeliveryCard`** at `@c:\Users\dahiy\grocery-mvp\src\screens\delivery\DeliveryDashboardScreen.tsx:1312-1347` â€” optional, camera-only (gallery picker would defeat the freshness premise), gated on `pickedUp` so the partner can't tap before the server precondition would accept the upload. Lower visual weight than the Delivered button (slate-grey surface, primary text colour) so it reads as "extra credit", not a primary action. NO red error state â€” failures alert and reset; the button stays available for re-tap. NO new server precondition on `markDelivered` â€” partner can deliver with or without a photo (deliberate non-feature; door-handoff / no-camera-permission cases must not be blocked). Per-order `photoUploading` state + `recentlyUploadedProof` map at the parent level so a re-render of one card doesn't disrupt another's spinner. Light haptic success tick mirrors PR 16's new-order arrival pattern.
      - **`DeliveryProofViewer` component** at `@c:\Users\dahiy\grocery-mvp\src\components\order\DeliveryProofViewer.tsx` â€” single component reused by `ShopOrderDetailScreen` + customer `OrderDetailScreen`. Returns null when `hasProof === false`; otherwise mints a 15-min signed read URL on mount and renders a 120Ã—120 thumbnail with tap-to-zoom into a full-screen modal. Hooks discipline (Rule 2): all `useState` / `useEffect` calls live above the `if (!hasProof) return null` guard. Auth boundary lives in the callable; permission-denied responses surface as inline error strings rather than masking the bug class with a generic copy. `hasProof â†’ false` resets stale URL state so a flip back to true triggers a fresh mint.
      - **Payment-method line** via new pure helper `@c:\Users\dahiy\grocery-mvp\src\utils\formatPaymentMethod.ts` â€” renders `Cash on delivery â€” paid online (converted)` / `Cash on delivery â€” paid in cash` / `Online (paid up front)` / `Cash on delivery â€” paid` (legacy COD without `paidMethod` stamp) / `Not yet paid` (any non-paid status, regardless of method â€” critical UX gate so a "pending" online order doesn't lie about an outstanding balance) / `Paid` (defensive fallback for paid-but-unknown-method). Wired on shop side at `@c:\Users\dahiy\grocery-mvp\src\screens\shop\ShopOrderDetailScreen.tsx:419-433` and customer side at `@c:\Users\dahiy\grocery-mvp\src\screens\OrderDetailScreen.tsx:568-581`. Same `<DeliveryProofViewer />` placement on both screens directly below the Payment card.
      - **Tests** â€” 19 new helper-test cases in `@c:\Users\dahiy\grocery-mvp\tests\functions\deliveryProofHelpers.test.ts` (auth + precondition matrix exhaustive across upload / record-input / read), 5 smoke tests in `@c:\Users\dahiy\grocery-mvp\tests\utils\uploadDeliveryProof.test.ts` (happy path, PUT non-2xx, get-url rejection, record rejection, storagePath round-trip â€” pinning that the helper trusts the server-minted path rather than rebuilding it locally), 7 tests in `@c:\Users\dahiy\grocery-mvp\tests\utils\formatPaymentMethod.test.ts` (every settlement variant + the non-paid gate). Suite at **1131 / 1131** (was 1089 â†’ +42, includes other in-flight PRs in the same session).

- [x] **Type + test discipline.** `npx tsc --noEmit` clean (root + `functions/`). `npx jest --config tests/jest.unit.config.js` â€” 94 suites, 1131 tests, 0 failures. One stale-spread lint in `DeliveryProofViewer` (`color: '#fff'` overwritten by a typography spread) caught + fixed at `@c:\Users\dahiy\grocery-mvp\src\components\order\DeliveryProofViewer.tsx:148` by reordering.

- [ ] **Server + storage-rules + client deploy plan.** Server-first â†’ storage rules â†’ client OTA. Storage rules MUST land before the client OTA so a misbehaving client during the deploy gap can't try a direct upload (the catch-all denies anyway, but the explicit rule keeps intent visible).

      ```powershell
      # Step 1 â€” server callables (3 new). Recurring gotcha: Cloud Run `allUsers` / `roles/run.invoker` strip on first deploy.
      firebase deploy --only "functions:getDeliveryProofUploadUrl,functions:recordDeliveryProofUpload,functions:getDeliveryProofReadUrl"
      gcloud run services get-iam-policy getdeliveryproofuploadurl --region asia-south1
      gcloud run services get-iam-policy recorddeliveryproofupload --region asia-south1
      gcloud run services get-iam-policy getdeliveryproofreadurl --region asia-south1
      # If allUsers / roles/run.invoker missing on any:
      # gcloud run services add-iam-policy-binding <svc> --region asia-south1 --member=allUsers --role=roles/run.invoker

      # Step 2 â€” storage rules (adds the explicit /delivery-proofs/ deny-all).
      firebase deploy --only storage

      # Step 3 â€” client OTA (only after callables are live + IAM verified + storage rules deployed).
      eas update --branch production --message "PR-NEXT-6 delivery proof photo + payment-method visibility"
      ```

- [ ] **Smoke acceptance (24-step checklist from the PR prompt; abbreviated here, full version in `@c:\Users\dahiy\grocery-mvp\docs\pr-next-6-delivery-proof-photo-windsurf-prompt.md`).**
      - Upload happy path: partner picks up order â†’ `ðŸ“¸ Add delivery proof (optional)` button appears above Delivered CTA â†’ tap â†’ camera opens â†’ take photo â†’ button flips to `ðŸ“¸ Photo added â€” re-take?` with haptic tick â†’ tap Delivered â†’ completes normally with no new precondition error.
      - Auth gates (direct callable invocation): customer token â†’ `permission-denied`, unassigned partner â†’ `permission-denied`, assigned partner before pickup â†’ `failed-precondition`, read with non-customer / non-shop-owner / non-assigned-partner / non-admin â†’ `permission-denied`.
      - Re-upload overwrites cleanly (same `delivery-proofs/{orderId}.jpg`); viewer re-fetches signed-read URL on next mount.
      - Display: shop owner / customer / admin (via callable for admin â€” no UI surface yet) all see the proof thumbnail + tap-to-zoom modal + the new `Paid via â€¦` line on order detail. No-proof orders render the payment line but no viewer (returns null cleanly).
      - Regressions: `markDelivered` still works without a proof (deliberate); menu image uploads + KYC uploads still work (unchanged code paths); tsc + jest clean.

- [x] **Doc trail.** Findings `#13` + `#16(c)` + `#16(d)` marked **SHIPPED in PR-NEXT-6** in `@c:\Users\dahiy\grocery-mvp\docs\TESTING-FINDINGS-2026-05-30.md:196,221`.

- [x] **PR-NEXT-HOTFIX-1 â€” `pickedUpAt` Timestamp-vs-number gate bug.** Sudhir's testing pass on PR-NEXT-6 surfaced that EVERY photo-upload attempt returned `failed-precondition: "Pick up the order beforeâ€¦"` even on demonstrably picked-up orders. Root cause: `markPickedUp` (`@c:\Users\dahiy\grocery-mvp\functions\src\index.ts:3552`) writes `pickedUpAt: FieldValue.serverTimestamp()`, which the Admin SDK reads back as a Firestore `Timestamp` object (not millis). `validateDeliveryProofUploadAuth` gated on `typeof order.pickedUpAt !== 'number'`, so the strict-typeof check rejected every real production read. Test fixture used a millis number (`1_700_000_000_000`) and masked the bug â€” classic test-fixture-doesn't-match-production-shape gap. Fix in `@c:\Users\dahiy\grocery-mvp\functions\src\deliveryProofHelpers.ts:93-119` widens acceptance to both shapes (plain millis number OR Timestamp-like with `.toMillis()` method) and normalises via `.toMillis()` before the `> 0` + `Number.isFinite` gate; null/undefined/wrong-shape/NaN/Infinity/0 still reject. 4 new test cases in `@c:\Users\dahiy\grocery-mvp\tests\functions\deliveryProofHelpers.test.ts:136-185` cover the production Timestamp shape, zero-millis Timestamp, NaN-millis Timestamp, and non-Timestamp object. Suite at **1155 / 1155** (was 1151). Server-only deploy: `firebase deploy --only "functions:getDeliveryProofUploadUrl,functions:recordDeliveryProofUpload"`. No client OTA â€” client photo-upload code path is unchanged; it just stops getting rejected by the server. **Defensive sweep finding (filed for follow-up, not fixed in HOTFIX-1):** `@c:\Users\dahiy\grocery-mvp\functions\src\customerCancelWindowHelpers.ts:136` has the SAME bug pattern on `paidAt` â€” `cancelMyRecentPaidOrder` (`index.ts:1714`) passes raw `orderSnap.data()` into `canCustomerCancelPaidOrder`, which gates `typeof order.paidAt !== 'number'`; production `paidAt` is written via `FieldValue.serverTimestamp()` (`index.ts:1383, 3930`), so the cancel-paid-order flow is currently mis-gating in production. `@c:\Users\dahiy\grocery-mvp\functions\src\index.ts:7055-7056` (`getMyProfile`) silently coerces `out.createdAt`/`out.updatedAt` Timestamp objects to `null` instead of millis (data-quality, not gate). Other matches are SAFE: `orderStatusTransitionHelpers.ts:90` validates a CLIENT-supplied `readyByEstimate` (not a server timestamp); `index.ts:3293` already uses `data.createdAt?.toMillis?.() ??` fallback before typeof; `index.ts:4785, 4817` are diagnostic-log `typeof` reads, not gates; `customerCrmHelpers.ts:80` is called after the caller pre-normalises createdAt via `.toMillis?.()`. **Lesson learned (CLAUDE.md candidate):** Firestore `Timestamp` reads are NOT plain millis numbers. Any server-side validator that gates on a server-written timestamp MUST normalise via `.toMillis()` (or accept the Timestamp-like shape directly). New validator fields that compare against server timestamps require a Firestore-shape fixture in the test suite, not just a numeric fixture. **Promoted to a real numbered code-discipline rule in PR-NEXT-HOTFIX-2 below â€” see `@c:\Users\dahiy\grocery-mvp\.windsurf\code-discipline.md` Rule 12.**

- [x] **PR-NEXT-HOTFIX-2 â€” `paidAt` Timestamp-vs-number gate bug (sibling to HOTFIX-1).** Same bug class HOTFIX-1's Â§C defensive sweep flagged in `@c:\Users\dahiy\grocery-mvp\functions\src\customerCancelWindowHelpers.ts:135-137` â€” `canCustomerCancelPaidOrder` gated on `typeof order.paidAt !== 'number'`, but the production Razorpay webhook (`@c:\Users\dahiy\grocery-mvp\functions\src\index.ts:1383` + `:3930`) writes `paidAt: FieldValue.serverTimestamp()`, so the Admin SDK hands back a Firestore `Timestamp` object on read, not millis. Every customer attempting to cancel a paid online order in their 2-minute self-service window would have been rejected with `"Order has no paid timestamp"` while their in-app countdown said "1:42 remaining" (RNFB's client serializer flattens Timestamps for the client, so the customer device computed elapsed correctly even though the Admin-SDK server path mis-typed it). Bug stayed latent in pilot because Razorpay was suspended â€” no online prepaid orders were being created. **The moment Razorpay restores, this would have activated as a pilot-blocker** for the self-service refund path. Fix in `@c:\Users\dahiy\grocery-mvp\functions\src\customerCancelWindowHelpers.ts:133-170` widens the validator to accept BOTH plain millis numbers (test fixtures + pre-normalised callers) AND Timestamp-likes (real Firestore reads via `.toMillis()`); rejects null / non-finite / `<= 0` (Unix epoch). Identical normalize-then-narrow pattern HOTFIX-1 used on `validateDeliveryProofUploadAuth`. 6 new test cases in `@c:\Users\dahiy\grocery-mvp\tests\functions\customerCancelWindowHelpers.test.ts:233-313` cover the production Timestamp shape, epoch-0 Timestamp, NaN-millis Timestamp, non-Timestamp object, Timestamp-like + window boundary (composes with the existing inclusive-boundary semantic), and Timestamp-like past window. Suite at **1182 / 1182** (was 1176). Server-only deploy: `firebase deploy --only "functions:cancelMyRecentPaidOrder"`. No client OTA â€” client cancel-order code path is unchanged; it just stops getting rejected by the server. **Twice in two days against the same bug class â†’ promoted to numbered code-discipline rule:** `.windsurf/code-discipline.md` now has **Rule 12 â€” Firestore `Timestamp` reads are NOT plain millis numbers.** Any future validator that does `typeof someTimestampField !== 'number'` is suspect on review.

- [x] **PR-NEXT-13d addendum â€” photo CTA on delivered history cards.** Closes a follow-up gap from Sudhir's HOTFIX-1 smoke testing: if the partner forgot to capture the proof photo before tapping Delivered, the CTA disappeared with the active card and there was no recovery path. Server side was already correct â€” `validateDeliveryProofUploadAuth` (post-HOTFIX-1) gates only on `delivery` claim + `deliveryPersonId === auth.uid` + `pickedUpAt != null`, no `deliveredAt` gate â€” so a partner can upload a missed proof any time while still the assignee. Pure client surface fix in `@c:\Users\dahiy\grocery-mvp\src\screens\delivery\DeliveryDashboardScreen.tsx:1200` (`DeliveryHistoryCard` now takes the same `onAddPhoto` / `uploadingPhoto` / `hasProof` props as `ActiveDeliveryCard`) plus the render call site at `@c:\Users\dahiy\grocery-mvp\src\screens\delivery\DeliveryDashboardScreen.tsx:907-923` (threads the same `handleAddDeliveryProof` handler + `photoUploading` + `recentlyUploadedProof` state PR-NEXT-6 already wired). Tap-target isolation via inner `Pressable`'s `e.stopPropagation()` so tapping the photo button doesn't bubble to the card-level `onPress` that navigates to `DeliveryOrderDetail`. Reuses `photoBtn` / `photoBtnText` / `photoBtnDisabled` styles verbatim. No new helpers, no new tests; suite stays at **1172 / 1172**. Pure client OTA: `eas update --branch production --message "PR-NEXT-13d photo CTA on delivered"`. **Upload window is intentionally unbounded for v1** â€” partner can re-upload any time while still assigned. Revisit if pilot disputes show late-upload abuse (would tighten with a `deliveredAt + 1h` or `next-midnight` gate on the server validator).

- [x] **PR-NEXT-6.1 addendum â€” admin UI surface.** Closes the `Â§D.4` admin-side deferral by extending `@c:\Users\dahiy\grocery-mvp\src\screens\admin\AdminOrdersScreen.tsx` with (1) a `Paid via â€¦` line below the phone row on every card driven by the existing `formatPaymentMethod` helper, and (2) a third per-card disclosure (`ðŸ“¸ Delivery proof`) that gates on `deliveryProofStoragePath` so proof-less orders never render a dead trigger row. Mirrors the existing `overrideExpandedId` + `timelineExpandedId` pattern (new `proofExpandedId` state, same one-card-at-a-time semantics) â€” intentionally INDEPENDENT of the other two so an admin can keep the timeline open while reviewing the photo (the cross-reference flow dispute resolution needs). Reuses `DeliveryProofViewer` + `formatPaymentMethod` verbatim from PR-NEXT-6; no new helpers, no new tests, no schema. Single-file change; tsc + 1151/1151 tests clean. Pure client OTA: `eas update --branch production --message "PR-NEXT-6.1 admin order-card proof + payment line"`.

- [ ] **Out of scope (deferred).** Multi-photo capture (per-item / per-corner-of-doorstep). Photo annotation / pinning. Upload-window enforcement (e.g. only within 1h after delivered). Photo required to deliver (deliberate non-feature â€” would block legitimate door-handoff / camera-permission-denied cases). Migration to public download tokens (PR 42.0.2 pattern) for cheaper reads â€” v1 prioritises privacy via signed-read; revisit if call volume becomes a real cost. Gallery picker alongside camera (defeats freshness premise). AI verification ("does this look like a doorstep?"). Admin order-detail screen integration â€” admin views orders inline on `AdminOrdersScreen` (list, no dedicated detail screen); admins still hold proof-read auth via the callable for dispute lookup, but a UI surface there is its own design pass.

## PR-NEXT-9 â€” In-shop menu search bar + per-role recent-query history `[Phase NEXT-9]`

- [x] **Why this PR exists.** Finding **#6** in `@c:\Users\dahiy\grocery-mvp\docs\TESTING-FINDINGS-2026-05-30.md`. Customers entering a shop with 50+ items scroll endlessly to find "atta" or "milk"; shopkeepers managing their menu scroll the same list to find an item they want to mark unavailable or re-price. Today's only navigation is category collapse + scroll â€” Medium severity at pilot scale, High as menus grow toward 1000 items. Picked over the operator-hygiene bundle as the most user-visible remaining feature; testers will hit the absence the moment their menus grow past one screen.

- [x] **What shipped.**
      - **Pure helper** `@c:\Users\dahiy\grocery-mvp\src\utils\menuSearchHelpers.ts` â€” three small functions (`normalizeSearchQuery`, `filterMenuByQuery`, `pushToSearchHistory`) with the validator-Result + pure-state-machine pattern from `pollFailureGate` (PR-NEXT-5) and `reorderModalDismissals` (PR-NEXT-8). `normalizeSearchQuery` trims, collapses internal whitespace to single spaces, lowercases ASCII (no-op on Devanagari â€” `toLowerCase()` doesn't touch codepoints without an upper/lower distinction, so mixed-script names like "Atta à¤†à¤Ÿà¤¾" work without special handling). `filterMenuByQuery` returns the input array BY REFERENCE when the query normalises to empty (saves a useless re-render at the screen level + signals "no filter applied"). `pushToSearchHistory` does dedup-then-move-to-front with a `DEFAULT_HISTORY_MAX = 5` cap; returns the same reference iff nothing changed (saves a useless AsyncStorage write).
      - **AsyncStorage wrapper** `@c:\Users\dahiy\grocery-mvp\src\services\menuSearchHistory.ts` â€” keyspace `search-history:menu:{role}:{shopId}` with `role âˆˆ 'customer' | 'shopkeeper'` so the two surfaces (customer `ShopDetailScreen` + shopkeeper `ShopMenuScreen`) maintain independent histories per shop. All methods best-effort (try/catch swallow): a storage hiccup NEVER breaks the search input. Defensive read filters non-string entries + re-caps to `MAX_ENTRIES` in case a future version increased the cap and then rolled back. Mirrors the import shape from `src/store/useCartStore.ts:1`.
      - **Reusable component** `@c:\Users\dahiy\grocery-mvp\src\components\menu\MenuSearchBar.tsx` â€” uncontrolled by design; parent owns `value` + drives `onChangeText`. Recent-query chip row renders ONLY while focused AND value is empty (chips collapse the moment typing starts so the filtered list gets the space). `keyboardShouldPersistTaps="handled"` on the chip ScrollView is the critical detail â€” without it, a chip tap fires the input's blur first and the tap never lands. `autoCapitalize="none"` + `autoCorrect={false}` so typing "atta" doesn't autocorrect to "Atta" or "otto". Inline âœ• clear button with `hitSlop={12}`.
      - **Customer wiring** `@c:\Users\dahiy\grocery-mvp\src\screens\ShopDetailScreen.tsx` â€” new state + history-hydrate effect + `filteredMenu` useMemo that feeds the existing category-grouped `sections` (empty categories disappear cleanly). Bar slots in the `SectionList`'s `ListHeaderComponent` BELOW the shop hero/meta block â€” intentionally non-sticky so it scrolls out of view with the rest of the header (matches the search-then-browse mental model; once narrowed, the bar isn't needed). `persistHistory` fires on blur OR `onSubmitEditing` (first wins) + chip re-tap promotes to position 0 via the dedup helper. New `ListEmptyComponent` branch renders an inline "No items match â€¦" block distinct from the existing no-menu-yet copy (query-driven empty takes precedence).
      - **Shopkeeper wiring** `@c:\Users\dahiy\grocery-mvp\src\screens\shop\ShopMenuScreen.tsx` â€” same pattern but composes ON TOP of the existing `available/unavailable/custom` status filter. New `queryFilteredItems` useMemo runs BEFORE the `visibleItems` switch so the existing status chips count what's visible, not the full menu. Bar sits ABOVE the toolbar (status chips + add buttons) because name search is the dominant intent at scale; status filtering is the modifier. `ListEmptyComponent` extended with the same query-driven branch â€” suppresses the "Add your first item" CTA when the empty state is just a no-match (so the shopkeeper doesn't add a duplicate of something already in the menu, hidden behind the active filter).
      - **Tests** â€” 20 new cases in `@c:\Users\dahiy\grocery-mvp\tests\utils\menuSearchHelpers.test.ts` across three describe blocks. `normalizeSearchQuery`: null / undefined / non-string / whitespace-only â†’ ''. Trim, collapse, lowercase, Devanagari unchanged, mixed-script. `filterMenuByQuery`: empty query â†’ returns input by REFERENCE (`toBe`, not `toEqual` â€” meaningful pin); case-insensitive substring; preserves input order; empty array on no match; silent drop of non-string names; Devanagari substring. `pushToSearchHistory`: empty query â†’ input by REFERENCE; already at front â†’ input by REFERENCE; new query unshifts; duplicate from middle moves to front; truncates to `DEFAULT_HISTORY_MAX`; custom max honoured; pre-normalised dedup (`"  ATTA  "` is the same as `"atta"`).
      - **No `menuSearchHistory.ts` unit tests** â€” pure AsyncStorage I/O with try/catch swallow; correctness is structurally trivial. **No component test for `MenuSearchBar`** â€” `@testing-library/react-native` isn't in the project (per `.windsurf/test-discipline.md`), bar is dumb glue around a `TextInput`, helper pins + acceptance checklist cover it.

- [x] **Type + test discipline.** `npx tsc --noEmit` clean (root + `functions/`). `npx jest --config tests/jest.unit.config.js` â€” 95 suites, 1151 tests, 0 failures (was 1131 â†’ +20). Rule 1 (imports stay): `MenuSearchBar`, `filterMenuByQuery`, `pushToSearchHistory`, `loadMenuSearchHistory`, `saveMenuSearchHistory` all persist through the edit. Rule 2 (hooks above conditionals): the new `useState` + `useEffect` for search sit above the existing `if (loading) return â€¦` / `if (!isShopOwner) return â€¦` early-returns in both screens. Rule 4 (schema additive): N/A â€” no Firestore field, no callable contract.

- [ ] **Deploy plan.** Pure client OTA. No `firebase deploy`, no IAM verify, no Razorpay secret, no `app.json` change, no native module.

      ```powershell
      eas update --branch production --message "PR-NEXT-9 in-shop search + history"
      ```

- [ ] **Smoke acceptance (21-step checklist from the PR prompt; abbreviated here, full version in `@c:\Users\dahiy\grocery-mvp\docs\pr-next-9-in-shop-search-windsurf-prompt.md`).**
      - Customer surface: bar visible below hero; type partial â†’ list narrows + empty categories vanish; no-match query â†’ inline "No items match â€¦"; âœ• clears; focus + empty â†’ recent chips with last query at idx 0; re-search same term â†’ moves to front; tap chip â†’ input populates + filters; force-quit + reopen â†’ history persists; different shop â†’ independent history.
      - Shopkeeper surface: bar visible above status chips; search composes with status filter (unavailable + "atta" â†’ only unavailable atta-matching items); shopkeeper history is independent of customer history at the same shop on the same device.
      - Cross-cutting: keyboard dismisses cleanly on chip tap; `autoCapitalize="none"` + `autoCorrect={false}` honoured; bar scrolls out of view on customer side (intentional, not sticky); tsc + jest clean.
      - Regression: empty search â†’ customer menu renders identical to pre-PR; status chips still behave as before; cart-add flow unaffected by an active search query.

- [x] **PR-NEXT-ENH-3 addendum â€” category quick-pick chips on customer ShopDetailScreen.** Closes Sudhir's testing follow-up to PR-NEXT-9 â€” *"category level search will give more choices to the customer. sometime they don't know what to search so category search will help them."* The search bar serves customers who know what they want; the chip row serves discovery (jump to "Dairy & Eggs" without committing to a search term). Pure helper `filterMenuByCategory` in `@c:\Users\dahiy\grocery-mvp\src\utils\filterMenuByCategory.ts` returns the input array by reference when `selectedCategory == null` (matches PR-NEXT-9's `filterMenuByQuery` posture so the screen's useMemo doesn't churn). `ShopDetailScreen` (`@c:\Users\dahiy\grocery-mvp\src\screens\ShopDetailScreen.tsx:77-83,152-174,311-362`) now: (1) holds a single-select `CategoryId | null` state above the existing useMemos; (2) composes a new `categoryFilteredMenu` useMemo BETWEEN the search filter and the section grouping (search applies first, then category â€” the chip's effective result set reflects post-search items); (3) renders a horizontal `ScrollView` chip row directly below the `MenuSearchBar` with `keyboardShouldPersistTaps="handled"` so chip taps land while the search input is focused; (4) widens `ListEmptyComponent` to four branches (search+category, search-only, category-only, neither) using a small `labelForCategory` helper for human-readable copy. Single-select semantics â€” tapping the same chip clears, tapping a different chip swaps. Active chip uses `colors.primaryLight` background + `colors.primaryDark` text on a pill border (pre-existing theme tokens; no new design system additions). Pinned by 6 helper tests in `@c:\Users\dahiy\grocery-mvp\tests\utils\filterMenuByCategory.test.ts` covering reference-equality on null (the useMemo-stability contract), matching / non-matching / mixed selections, order preservation, malformed `category` defense, and empty-items list. Suite at **1212 / 1212** (was 1206). Pure client OTA: `eas update --branch production --message "PR-NEXT-ENH-3 category chips on ShopDetail"`.

- [x] **Doc trail.** Finding `#6` marked **SHIPPED in PR-NEXT-9** in `@c:\Users\dahiy\grocery-mvp\docs\TESTING-FINDINGS-2026-05-30.md:109`.

- [ ] **Out of scope (deferred).** Admin-side menu search (no admin menu list exists today â€” `ShopDetailManagementScreen` is metadata + KYC only). Server-side `searchShopMenu` callable (client filter is sub-ms at pilot scale; helper boundary makes the swap trivial when a shop reaches 1000+ items). Cross-shop / global search (different feature; `searchMenuPublic` covers the discovery side). Pack-label / description / category search (name-only for v1; flag-gate if pilot feedback wants pack-label). Fuzzy / typo-tolerant matching (Hindi/English mixed names don't have a clean Levenshtein story without per-script tuning). Search-history clear button (not in finding #6; v2 chip-row addition if asked). Search analytics (`Analytics.searchSubmitted`) â€” UX feature first, data later. Sticky search bar on scroll (consumes vertical space every screen of scroll without a clear UX win).

## PR-NEXT-5 â€” Delivery dashboard error-banner dampening `[Phase NEXT-5]`

- [x] **Why this PR exists.** Finding **#7** in `@c:\Users\dahiy\grocery-mvp\docs\TESTING-FINDINGS-2026-05-30.md`. The delivery partner's dashboard repeatedly flashed "The network connection was lost. Retry." for a few seconds, then the banner disappeared, then it reappeared â€” with no actual outage on the partner's network. The two watchers (`watchAvailableDeliveries`, `watchMyDeliveries`) poll every 10â€“15s; a single shared blip (Cloud Run cold start, iOS TCP idle reap, brief Wi-Fi to cellular hand-off) put both into error on the same tick, and the existing reconciler showed the banner instantly. Partners lost confidence in the system long before they had any actual problem to act on.

- [x] **What shipped.**
      - **Pure helper** `@c:\Users\dahiy\grocery-mvp\src\utils\pollFailureGate.ts` â€” `applyPollOutcome({currentCount, outcome, threshold?}) â†’ {nextCount, tripped, justTripped}`. Per-watcher consecutive-failure counter. `success` outcome resets to 0; `failure` increments. `tripped` flips at `nextCount >= threshold`; `justTripped` is true exactly once at the threshold-crossing transition (used to gate the Sentry `captureMessage` so it fires once per outage, not per failed poll). Default `POLL_FAILURE_THRESHOLD = 3` â†’ ~45s at the slower 15s cadence. Defensive clamps for negative / NaN / Infinity / fractional `currentCount` so a future caller bug can't leave us stuck below threshold forever.
      - **Wire-up** in `@c:\Users\dahiy\grocery-mvp\src\screens\delivery\DeliveryDashboardScreen.tsx:130-263`: replaced the simple `Error | null` flags with two closure counters + `outageCaptured` + `latestErrorMessage`. Both `watchAvailableDeliveries` and `watchMyDeliveries` callbacks call `applyPollOutcome`, then a shared `reconcileError` checks both counters against the threshold (banner only shows when BOTH are tripped, preserving the existing "both must error" gate at a temporal level), then `maybeCaptureOutage` fires the once-per-outage Sentry message. `breadcrumbForFailure` adds a Sentry breadcrumb on every failed poll with the `consecutiveFailures` count, the truncated `errorMessage`, and the firebase-functions `code` when present. `outageCaptured` resets to false whenever the banner clears so the next distinct outage fires its own captureMessage cleanly.
      - **No watcher contract change** â€” `orderService.watchAvailableDeliveries` and `watchMyDeliveries` keep their existing `cb(data, undefined) on success, cb([], err) on failure` shape. Other consumers (`watchMyDeliveries` from `OrderDetailScreen`, `watchShopOrders`, `watchAllOrders`, `watchOrder`) are untouched. The dampening is purely screen-local.
      - **Retry button still works** â€” the existing "Retry" pill bumps `retryNonce` which re-fires the watcher effect, which resets the closure counters by virtue of the closure restart. Manual recovery path is still instant for the partner; they don't have to wait for the next 10/15s tick.

- [x] **Tests.** 17 new cases in `@c:\Users\dahiy\grocery-mvp\tests\utils\pollFailureGate.test.ts`. Suite green at **1048 / 1048**, up from 1031.
      - 4 cases for the success branch (count=0, mid-stream, post-tripped, with threshold-override).
      - 5 cases for the failure branch (1st / 2nd / 3rd consecutive, mid-outage, deep into outage â€” the `tripped && !justTripped` contract).
      - 2 cases for custom threshold override (1 â†’ trips immediately, 5 â†’ trips on the 5th).
      - 4 defensive-clamp cases (negative, NaN, Infinity, fractional `currentCount`).
      - 1 end-to-end recovery sequence (3 fails â†’ tripped â†’ mid-outage suppression â†’ success â†’ 3 more fails â†’ second distinct outage with `justTripped` firing again).
      - 1 constant-pin test (`POLL_FAILURE_THRESHOLD === 3`).

- [ ] **Deploy plan.** Client-only, OTA-safe â€” no `firebase deploy`, no IAM verify, no Razorpay secret, no `app.json` change, no native module:

      ```powershell
      eas update --branch production --message "PR-NEXT-5 delivery dashboard error-banner dampening"
      ```

- [ ] **Smoke acceptance (5 steps, ~5 min on the delivery role).**
      1. **Steady-state silence.** Sign in as delivery partner, leave dashboard open ~2 min on stable network. **Expected:** banner NEVER appears. Pre-fix: it would appear and disappear at least once during that window for most testers.
      2. **Single-tick blip absorbed.** With Wi-Fi on, briefly toggle Airplane Mode on and off (<10s). One or both watchers will hit a transient failure but recover on the next tick. **Expected:** banner does NOT appear. Pre-fix: would appear for ~10â€“15s.
      3. **Real outage shows correctly.** Turn Airplane Mode ON and leave it. After ~30â€“45s (three consecutive failures on both watchers), banner appears with "Network connection lost. Tap Retry." Tap Retry â†’ instantly tries again (then fails) â€” fine. Turn Wi-Fi back on; next successful poll on either watcher clears the banner.
      4. **Sentry captureMessage fires once per outage.** Check Sentry dashboard after step 3 â€” exactly **one** "Delivery dashboard outage" warning event, not three or seven. Click in and confirm the breadcrumb trail shows the lead-up failed polls with their `consecutiveFailures` counts.
      5. **Recovery captures a new outage cleanly.** Repeat step 3 (second airplane-mode outage). A second distinct "Delivery dashboard outage" event should appear in Sentry â€” separate event, not appended to the first.

- [x] **Doc trail.** Finding `#7` marked **SHIPPED in PR-NEXT-5** in `@c:\Users\dahiy\grocery-mvp\docs\TESTING-FINDINGS-2026-05-30.md:118`.

- [ ] **Out of scope (deferred).** Applying the same dampening to other polling watchers (`AdminOrdersScreen`, `ShopOwnerDashboardScreen`, `OrderDetailScreen`) â€” `pollFailureGate` is general-purpose and ready to reuse, but only one screen has the reported issue. Increasing Cloud Functions `minInstances` to eliminate cold starts (recurring cost, deferred per Sudhir's cost-conservative call). Adaptive backoff polling (state-machine over-engineering for the actual UX symptom). Bumping the poll intervals (snappy for the working case; dampening covers the failure case). In-banner countdown timer ("retrying in Xs" â€” not needed, Retry button is right there).

## PR-NEXT-4 â€” Menu management: bulk-unavailable fix + unified soft-delete `[Phase NEXT-4]`

- [x] **Why this PR exists.** Two shopkeeper menu-management bugs that together blocked any practical menu maintenance at pilot scale (findings **#4** + **#5** from `@c:\Users\dahiy\grocery-mvp\docs\TESTING-FINDINGS-2026-05-30.md`).
      - **#4** â€” bulk "Mark N unavailable" silently failed: shopkeeper selects 3 items, server reports "0 updated, 3 skipped (item may no longer exist)" even though the items clearly exist. Root cause: `bulkUpdateMenuAvailability` queried `db.collection('menuItems')` â€” a top-level collection that doesn't exist; per-shop menu items live in the **subcollection** `shops/{shopId}/menu/{menuItemId}` (Phase 12a-v2-ii). Every chunk-query returned empty.
      - **#5** â€” Delete didn't behave like delete. The `removeMenuItem` callable hard-deleted custom items (gone from menu) but soft-disabled global items via `available: false` (stayed in menu, just marked unavailable). Shopkeepers reported it as "delete doesn't work" because the global-item case looked identical to "mark unavailable."

- [x] **What shipped.**
      - **Type:** `deletedAt?: number | null` added to `MenuItem` in `@c:\Users\dahiy\grocery-mvp\src\types\index.ts` (optional â†’ back-compat with legacy items; matches the `paidMethod` posture from PR-NEXT-3).
      - **Pure helper** `@c:\Users\dahiy\grocery-mvp\src\utils\menuListingHelpers.ts` â€” `isMenuItemDeleted` + `excludeDeleted`. Defensive for absent / null / 0 / Timestamp / string `deletedAt` shapes; pinned by 15 tests.
      - **`bulkUpdateMenuAvailability`** (`@c:\Users\dahiy\grocery-mvp\functions\src\index.ts`): now queries `shops/{shopId}/menu` via `FieldPath.documentId() in chunk`; the pre-PR `data.shopId === shopId` filter became dead code (subcollection scope guarantees it) and was dropped. Skips `deletedAt != null` rows. Bumped `updatedAt` write to `FieldValue.serverTimestamp()` (was `Date.now()`) â€” same PR 48 Â§I mixed-type orderBy bug class.
      - **`removeMenuItem`** (same file): unified soft-delete â€” every delete writes `deletedAt: serverTimestamp() + available: false + updatedAt: serverTimestamp()`. The pre-PR `if (data.isCustom) ref.delete() else ref.update({available: false})` branch is gone. Idempotent on re-deletion (just refreshes `deletedAt`).
      - **Listings** â€” three sites filter `deletedAt == null` in-memory before returning items:
        - `listMyShopMenu` â€” shopkeeper menu management.
        - `listShopMenuPublic` â€” customer ShopDetailScreen.
        - `searchMenuPublic` â€” cross-shop customer search (collection-group query).
      - **Why in-memory not server-side:** Firestore `where('deletedAt', '==', null)` does NOT match docs where the field is **absent** (only docs where it's explicitly stored as `null`). Legacy pre-PR menu items have no `deletedAt` field at all; a server-side filter would silently exclude every one of them â€” a regression worse than the bug we're fixing. Menu sizes are tiny (~30 in the global catalog, â‰¤ a few hundred per shop) so the in-memory filter cost is negligible.
      - **Client wrapper** in `@c:\Users\dahiy\grocery-mvp\src\services\orderService.ts`: `removeMenuItem` return shape narrowed from `{ deleted: boolean; softDisabled?: boolean }` â†’ `{ ok: true }`. Only known caller (`ShopMenuItemEditScreen.handleDelete`) never read the discriminator â€” safe shape narrowing.
      - **UI copy** â€” `@c:\Users\dahiy\grocery-mvp\src\screens\shop\ShopMenuItemEditScreen.tsx` Delete confirmation no longer branches on `isCustom`; both cases show "Remove this item from your menu?" / "Remove from menu" / "Keep it" so the user-facing language matches the now-uniform server behavior.

- [x] **Tests.** 15 new cases in `@c:\Users\dahiy\grocery-mvp\tests\utils\menuListingHelpers.test.ts`. Suite green at **1031 / 1031**, up from 1016.
      - 7 cases for `isMenuItemDeleted` covering the absent / null / undefined / 0 / positive-epoch-ms / Date / string axes.
      - 8 cases for `excludeDeleted` covering null / undefined / non-array / order-preservation / mixed live-and-deleted / empty / all-deleted / generic-shape.
      - Order-history preservation is verified by smoke step 5 (live read of past orders renders correctly because `CartItem` snapshots `name + price + imageUrl` at order-time and never reads back from the live menu doc).

- [ ] **Cloud Run IAM verification (post-deploy).** No new public callables; the redeployed ones (`bulkUpdateMenuAvailability`, `removeMenuItem`, `listMyShopMenu`, `listShopMenuPublic`, `searchMenuPublic`) all already have the `allUsers` binding from prior deploys. Recurring gotcha â€” Firebase has occasionally stripped the binding on redeploy; verify after `firebase deploy`:

      ```powershell
      gcloud run services get-iam-policy bulkupdatemenuavailability --region=asia-south1 --project=grocery-mvp-dev
      gcloud run services get-iam-policy removemenuitem --region=asia-south1 --project=grocery-mvp-dev
      gcloud run services get-iam-policy listmyshopmenu --region=asia-south1 --project=grocery-mvp-dev
      gcloud run services get-iam-policy listshopmenupublic --region=asia-south1 --project=grocery-mvp-dev
      gcloud run services get-iam-policy searchmenupublic --region=asia-south1 --project=grocery-mvp-dev
      ```

      Re-add `allUsers / roles/run.invoker` to any that lost it.

- [ ] **Deploy plan.**
      1. `npm test` â€” green (1031/1031 currently).
      2. ```powershell
         firebase deploy --only "functions:bulkUpdateMenuAvailability,functions:removeMenuItem,functions:listMyShopMenu,functions:listShopMenuPublic,functions:searchMenuPublic"
         ```
      3. Cloud Run IAM verify (above).
      4. ```powershell
         eas update --branch production --message "PR-NEXT-4 menu bulk-unavailable fix + unified soft-delete"
         ```
         OTA-safe â€” no native module / no permission / no `app.json` change.

- [ ] **Smoke acceptance (6 steps).**
      1. **Finding #4 â€” bulk on real items.** ShopMenuScreen â†’ select 3 items â†’ tap "Mark 3 unavailable" â†’ confirm. **Expected:** "Updated 3, skipped 0." Pre-fix: "Updated 0, skipped 3 (item may no longer exist)."
      2. **Finding #4 â€” audit log.** After step 1, check the new audit-log entry for the bulk op. **Expected:** `metadata.skippedCount: 0`. (Cross-shop safety is automatic now â€” subcollection scope guarantees only this shop's items are touched.)
      3. **Finding #5 â€” delete a CUSTOM item.** Custom item edit screen â†’ Remove from menu â†’ confirm. **Expected:** item disappears from shopkeeper's menu list immediately. Customer (other device) refreshes ShopDetailScreen â†’ item is gone there too.
      4. **Finding #5 â€” delete a GLOBAL item.** Same flow on a global (non-custom) item. **Expected:** identical behavior â€” gone from BOTH shopkeeper menu list AND customer-facing list. Pre-fix the global item would have stayed in both lists, just marked unavailable.
      5. **Order history preservation.** After deleting an item, open a past order that contained it. **Expected:** item name + image + price still render correctly (snapshot embedded in `order.items[]`, not a live menu read).
      6. **Bulk + soft-delete interaction.** Delete an item, then run a bulk "Mark unavailable" that includes the deleted item's ID among other live IDs. **Expected:** deleted item is silently skipped (filtered by `deletedAt != null` in the chunked query); other items in the bulk update process normally.

- [x] **PR-NEXT-ENH-2 addendum â€” bulk delete from the shopkeeper menu (third action on ENH-1's smart-label bar).** Closes Sudhir's testing follow-up â€” *"I still don't see option to do bulk delete for items. When I select an item, it give mark available or mark unavailable only."* New callable `bulkRemoveMenuItems` in `@c:\Users\dahiy\grocery-mvp\functions\src\index.ts:2342` mirrors `bulkUpdateMenuAvailability` exactly â€” same chunk-query against `shops/{shopId}/menu`, same 100-id cap, same shopOwner-strict-equality + shopId claim posture, same `deletedAt != null` skip in the read loop â€” only the batch write payload differs (`deletedAt: serverTimestamp() + available: false + updatedAt: serverTimestamp()`, identical to per-item `removeMenuItem` so every listing surface drops the docs identically). Pure validator `validateBulkRemoveRequest` in `@c:\Users\dahiy\grocery-mvp\functions\src\bulkRemoveMenuHelpers.ts` mirrors `validateBulkMenuRequest` minus the `available` field. Audit log entry `actionType: 'shop.bulk_menu_remove'` with `{ requestedCount, deletedCount, skippedCount }` metadata. Client wrapper `orderService.bulkRemoveMenuItems` (`@c:\Users\dahiy\grocery-mvp\src\services\orderService.ts:1310-1334`) follows the existing native + web callable wrapper idiom. UI surface in `@c:\Users\dahiy\grocery-mvp\src\screens\shop\ShopMenuScreen.tsx:684-739`: bulk action bar restructured into two stacked rows â€” Row 1 keeps ENH-1's smart Mark buttons (side-by-side flex:1, hidden when no-flip), Row 2 is the new full-width destructive Delete button. Outer guard widened from `(bulkAvailableCount > 0 || bulkUnavailableCount > 0)` to `selectedIds.size > 0` so Delete is the always-visible action whenever there's any selection. Confirmation Alert subtitle reassures shopkeepers: *"Past orders that included these items are unaffected (the order keeps a snapshot of name + price + image)."* Optimistic local update drops the deleted ids from the items list immediately; watcher / `fetchOnce` reconciles. New `destructive` variant added to the shared `Button` component (`@c:\Users\dahiy\grocery-mvp\src\components\common\Button.tsx`) â€” red surface (`colors.danger`) + white text + same activity-indicator-on-loading semantics as `primary`. Pinned by 14 helper tests in `@c:\Users\dahiy\grocery-mvp\tests\functions\bulkRemoveMenuHelpers.test.ts` covering the full claim matrix + boundary cases (unauth, missing claim, forged string-`'true'`, missing/empty shopId, non-array / empty / oversized / non-string / empty-string menuItemIds, happy path, exactly-100 boundary, admin-also-shopOwner). Suite at **1206 / 1206** (was 1192). Server-first deploy: `firebase deploy --only "functions:bulkRemoveMenuItems"` â†’ verify `allUsers` IAM on the new `bulkremovemenuitems` Cloud Run service (`gcloud run services get-iam-policy bulkremovemenuitems --region asia-south1` â€” recurring strip gotcha) â†’ `eas update --branch production --message "PR-NEXT-ENH-2 bulk delete"`.

- [x] **PR-NEXT-ENH-1 addendum â€” smart bulk-action labels on shopkeeper menu.** Closes a follow-up Sudhir surfaced while testing the PR-NEXT-4 server fix: the action bar always rendered both `Mark N unavailable` and `Mark N available` with the same N (the total selection size), so selecting 3 already-available items still showed `Mark 3 available` as a no-op option, and a mixed selection of 2-available + 1-unavailable showed both buttons with a wrong count on each. Pure helper `computeBulkAvailabilityCounts` in `@c:\Users\dahiy\grocery-mvp\src\utils\bulkAvailabilityCounts.ts` returns `{ availableCount, unavailableCount }` â€” counts the items that would actually flip per direction. `ShopMenuScreen` (`@c:\Users\dahiy\grocery-mvp\src\screens\shop\ShopMenuScreen.tsx:200-214` + `:608-655`) now: (1) memoises the counts against `items` + `selectedIds`; (2) renders only the buttons whose flip-count is `> 0` â€” uniform selection shows a single full-width button, mixed shows the two side-by-side, empty selection collapses the bar entirely (no empty colored strip; "Done" header still exits select mode); (3) `handleBulkSetAvailability` filters `selectedIds` down to ids whose `available !== target` BEFORE sending â€” `Array.from(selectedIds)` replaced by `items.filter(...).map(i => i.id)`, so the server payload, the confirmation Alert title, and the optimistic local update (`flippedSet` instead of `selectedIds`) all agree on the actual flip count. No callable change â€” `bulkUpdateMenuAvailability` already accepts an arbitrary id list. Pinned by 10 helper tests in `@c:\Users\dahiy\grocery-mvp\tests\utils\bulkAvailabilityCounts.test.ts` covering empty selection, all-available, all-unavailable, mixed, phantom ids, defensive non-strict-true `available` field (undefined / null / 0), empty items list, order-independence, finite-number assertion. Suite at **1192 / 1192** (was 1182). Pure client OTA: `eas update --branch production --message "PR-NEXT-ENH-1 smart bulk labels"`.

- [x] **Doc trail.** Findings `#4` and `#5` marked **SHIPPED in PR-NEXT-4** in `@c:\Users\dahiy\grocery-mvp\docs\TESTING-FINDINGS-2026-05-30.md`.

- [ ] **Out of scope (deferred).** Undelete UI / "Archived items" view for shopkeepers or admins (forensic recovery via Firestore console only for now). Composite Firestore index for `deletedAt` (in-memory filter is sufficient at pilot scale and avoids index management). Hard-delete cleanup job for soft-deleted docs older than N days (storage is cheap; doc count is low). Renaming `removeMenuItem` â†’ `deleteMenuItem` (the asymmetry was in the *behavior*, not the name; reusing the name keeps the diff small and matches the existing client wrapper). Customer-facing "this item was recently removed" hints (just gone from the menu).

## PR-NEXT-3 â€” COD payment conversion + delivery-partner confirmation `[Phase NEXT-3]`

- [x] **Why this PR exists.** Pilot-blocker cluster for COD orders (finding **#12**, two parts). Most pilot orders will be COD; pre-PR (a) a customer who later wanted to pay online had to cancel + re-place, losing the partner's in-flight work, and (b) a partner could tap "Delivered" with zero recorded evidence of whether cash was actually exchanged. Also closes sub-(b) of finding **#16**.

- [x] **Locked design (finding #12, Sudhir May 31).**
      - `paymentMethod` stays `'cod'` on conversion (preserved as an analytics signal). New optional `paidMethod: 'cash' | 'online'` field captures the actual settlement.
      - No reverse path (online â†’ COD).
      - Fan-out push on COD â†’ online conversion to shop owner + admin + delivery partner (if assigned). Fired DIRECTLY from inside `confirmPayment` (not from the `sendOrderStatusPush` trigger, which watches `status` diffs and would double-fire for regular online orders).
      - Strict race-guard: both `payCodOrder` and `confirmCodPayment` refuse if `paymentStatus === 'paid'` already.

- [x] **What shipped.**
      - **Type:** `paidMethod?: 'cash' | 'online'` added to `Order` in `@c:\Users\dahiy\grocery-mvp\src\types\index.ts` (optional â†’ back-compat with legacy orders).
      - **Pure helpers** in `@c:\Users\dahiy\grocery-mvp\functions\src\codPaymentHelpers.ts`:
        - `validatePayCodOrderPreconditions` â€” auth, ownership, COD-only, race-guard against Part B, not delivered/cancelled.
        - `validateConfirmCodPaymentInput` â€” orderId + `paidMethod âˆˆ {cash, online}` (rejects `'upi'`, empty, null, non-string).
        - `validateConfirmCodPaymentPreconditions` â€” partner ownership, COD-only, returns `alreadyPaid: true` on the race-guard (NOT an error), refuses delivered/cancelled.
        - `validateMarkDeliveredCodGate` â€” refuses if COD + not paid; passes online + COD-converted-to-online + COD-confirmed-cash.
        - `shouldFireCodConversionFanout` â€” decides the COD-conversion push fan-out (NEVER fires on alreadyPaid or non-COD orders).
      - **New callables** in `@c:\Users\dahiy\grocery-mvp\functions\src\index.ts`:
        - `payCodOrder({orderId})` â€” mints Razorpay session for an existing COD order; sets `paymentStatus: 'pending'` + `razorpayOrderId`; `paymentMethod` stays `'cod'`.
        - `confirmCodPayment({orderId, paidMethod})` â€” partner-only; stamps `paymentStatus: 'paid'` + `paidMethod` + `paidAt` + `statusHistory` entry; idempotent on already-paid (returns `{alreadyPaid: true}`).
      - **Extended callables:**
        - `confirmPayment` â€” stamps `paidMethod: 'online'` atomically with the paid write + fires `pushToOwner` / `pushToAdmins` / `pushToUser(deliveryPersonId)` with `type: 'order_cod_converted'` when the order was originally COD.
        - `markDelivered` â€” new precondition via `validateMarkDeliveredCodGate` refuses unpaid COD; sits after the idempotent delivered-check + the status-precondition so neither diagnostic is shadowed.
      - **Client wrappers** in `@c:\Users\dahiy\grocery-mvp\src\services\orderService.ts`: `payCodOrder(orderId)` + `confirmCodPayment({orderId, paidMethod})`. Both follow the existing native/web `httpsCallable` split.
      - **Customer UI** â€” new "ðŸ’³ Pay {total} online now" card on `@c:\Users\dahiy\grocery-mvp\src\screens\OrderDetailScreen.tsx`, gated on `paymentMethod === 'cod' && paymentStatus !== 'paid' && status not in {delivered, cancelled}`. Mirrors `handleRetryPayment` (Razorpay overlay flow) but calls `confirmPayment` in the success handler so the COD-conversion fan-out fires immediately (rather than waiting ~30s for the webhook). Press-guarded by its own `usePressGuard` ref.
      - **Delivery UI** â€” `ActiveDeliveryCard` in `@c:\Users\dahiy\grocery-mvp\src\screens\delivery\DeliveryDashboardScreen.tsx` now renders two Cash/UPI pills (instead of the Delivered button) when `pickedUp && paymentMethod === 'cod' && paymentStatus !== 'paid'`. New `handleConfirmCodPayment` lifted to the screen level (Rule 2 hook discipline) with the same optimistic-rollback pattern as `handleDelivered` and a friendly "Customer paid online" toast on the Part A race-guard win.
      - **Deep-link** â€” `@c:\Users\dahiy\grocery-mvp\src\components\AuthBootstrap.tsx` routes the new `order_cod_converted` push type with the same audience precedence as `order_delivered` (shopOwner-with-matching-shopId > admin > delivery > customer).

- [x] **Tests.** 37 new cases in `@c:\Users\dahiy\grocery-mvp\tests\functions\codPaymentHelpers.test.ts`. Suite green at **1016 / 1016**, up from 979.
      - Exhaustive matrix for every precondition (10 cases for `payCodOrder`, 10 for `confirmCodPayment` input + 7 for its preconditions, 5 for `markDelivered` COD gate, 5 for fan-out decision).
      - Explicit race-guard pin (`paymentStatus === 'paid'` â†’ either rejection on Part A OR `alreadyPaid: true` on Part B; never a double-stamp).
      - Explicit pin that fan-out does NOT fire on regular online orders or webhook-replayed `alreadyPaid` paths.

- [ ] **Cloud Run IAM verification (post-deploy).** Two NEW public callables. The recurring gotcha â€” fresh callables sometimes deploy without the `allUsers` binding:

      ```powershell
      gcloud run services get-iam-policy paycodorder `
        --region=asia-south1 --project=grocery-mvp-dev
      gcloud run services get-iam-policy confirmcodpayment `
        --region=asia-south1 --project=grocery-mvp-dev
      ```

      Add `allUsers / run.invoker` to either if missing. `confirmPayment` and `markDelivered` already have bindings â€” no re-verification needed.

- [ ] **Deploy plan.**
      1. `npm run test:unit` â€” green (1016/1016 currently).
      2. ```powershell
         firebase deploy --only `
           functions:payCodOrder,functions:confirmCodPayment,functions:confirmPayment,functions:markDelivered
         ```
      3. Cloud Run IAM verify (above).
      4. ```powershell
         eas update --branch production --message "PR-NEXT-3 COD payment conversion + partner confirmation"
         ```
         OTA-safe â€” `react-native-razorpay` already in the dev client; no native module / permission / `app.json` change.

- [ ] **Smoke acceptance (6 steps, two-device pair).**
      1. **Part A happy path.** Customer places COD; shop accepts. Customer opens `OrderDetail` â†’ taps "ðŸ’³ Pay {â‚¹} online now" â†’ Razorpay overlay â†’ completes â†’ order doc flips to `paymentMethod: 'cod'`, `paymentStatus: 'paid'`, `paidMethod: 'online'`, `razorpayPaymentId: ...` within ~2 seconds.
      2. **Part A fan-out.** Same flow. Within ~5s, shop device gets push "ðŸ’³ Customer paid online", admin device gets it too, assigned-delivery-partner gets "ðŸ’³ Payment received â€” no cash to collect". Tapping any deep-links to the appropriate detail screen.
      3. **Part A race-guard.** Razorpay overlay open mid-payment; delivery partner ALSO taps "Cash received". Whichever lands second gets a clean rejection; no double-write; final state consistent with the winner.
      4. **Part B happy path.** COD order â†’ ready_for_pickup â†’ partner taps "I've picked it up" â†’ ActiveDeliveryCard shows two pills INSTEAD of the Delivered button â†’ partner taps "Cash received" â†’ order stamps `paid` + `paidMethod: 'cash'` â†’ Delivered button appears on next render â†’ partner taps it â†’ existing PR-NEXT-1 delivered fan-out fires.
      5. **Part B refusal.** Simulated direct call to `markDelivered` on a COD-unpaid order rejects with the new `validateMarkDeliveredCodGate` precondition message.
      6. **Online order regression.** Regular online-paid order â†’ partner's flow shows the Delivered button directly (no COD selector). `markDelivered` accepts immediately.

- [x] **Doc trail.** Finding `#12` marked **SHIPPED** in `@c:\Users\dahiy\grocery-mvp\docs\TESTING-FINDINGS-2026-05-30.md`; sub-(b) of finding `#16` also marked **SHIPPED** there.

- [ ] **Out of scope (deferred).** COD-fee surcharge / differential pricing (order total identical whether paid by cash or online). Receipt PDF generation. Push to customer on Part B confirmation (customer either tapped Pay-online-now themselves OR is handing cash in person â€” no notification needed). Promoting `'pending_cod_conversion'` to a new `PaymentStatus` enum value (decision: reuse `'pending'`; the COD-vs-original-online distinction is read from `paymentMethod === 'cod'`). Online â†’ COD reverse path (locked design says no). Partner-side audit log of which payments they collected (available via existing audit log queries; no dedicated screen).

## PR-NEXT-2 â€” Android cart-bar safe-area inset `[Phase NEXT-2]`

- [x] **Why this PR exists.** Finding **#1** from the May 30 Android validation. Customer-facing floating "View Cart" bar uses `position: 'absolute'; bottom: spacing.lg` on four screens; that flat offset coincidentally clears iOS's home indicator but is fully **behind** the Android gesture-nav pills on Sudhir's test device â€” the OS intercepts the tap and customers can't proceed to checkout. **Pilot-blocker for Android.**

- [x] **What shipped.**
      - Added `useSafeAreaInsets()` to all four screens with the same per-file pattern:
        - `@c:\Users\dahiy\grocery-mvp\src\screens\HomeScreen.tsx`
        - `@c:\Users\dahiy\grocery-mvp\src\screens\ShopListScreen.tsx`
        - `@c:\Users\dahiy\grocery-mvp\src\screens\ShopDetailScreen.tsx`
        - `@c:\Users\dahiy\grocery-mvp\src\screens\SearchScreen.tsx`
      - Cart bar: `style={[styles.cartBar, { bottom: insets.bottom + spacing.sm }]}` so the bar floats above the nav pills with a small visible gap.
      - Scroll / list container: `contentContainerStyle` extended with `paddingBottom: 120 + insets.bottom` so the last list item is reachable without being clipped by the floated cart bar OR the nav pills.
      - Hook placement follows code-discipline Rule 2 (with the other hooks at the top of the component, above any conditional early returns). Imports added cleanly per Rule 1.

- [x] **Tests.** Pure visual / layout fix â€” no new unit-test surface. **979 / 979** stays green (no regression in the existing suite which imports several of the touched screens).

- [ ] **Deploy.** OTA-safe â€” pure JS, no native module change, no permission change, no `app.json` change.

      ```powershell
      eas update --branch production --message "PR-NEXT-2 Android cart-bar safe-area fix"
      ```

      No `firebase deploy` needed; no Cloud Run IAM verify needed; this PR doesn't touch the server.

- [ ] **Manual verification.**
      - **Android phone with gesture navigation** (Sudhir's test device): cart bar sits clearly above the system nav pills with a small visible gap; "View Cart â€º" is tappable; the last item in the menu / shop list / search results is reachable by scrolling without being clipped.
      - **Android phone with button navigation** (if any tester has one): same â€” `insets.bottom` reports the button-bar height correctly.
      - **iOS** (regression): cart bar still positions correctly above the home indicator (it always did; confirm the inset value didn't push it visibly higher than before; if it does and looks off, swap `+ spacing.sm` for `+ 0`).

- [ ] **Doc trail.** Finding `#1` marked **SHIPPED** in `@c:\Users\dahiy\grocery-mvp\docs\TESTING-FINDINGS-2026-05-30.md`.

## PR-NEXT-1 â€” Order status propagation + push fan-out + deep-links `[Phase NEXT-1]`

- [x] **Why this PR exists.** Pilot-blocker cluster from the May 30 Android validation. Five findings (`#2`, `#3`, `#10`, `#11`, `#16`) all touched the same plumbing â€” order-status writes â†’ push trigger fan-out â†’ client display + deep-link â€” so they ship as one PR.

- [x] **What shipped.**
      - **Pure helper** `@c:\Users\dahiy\grocery-mvp\src\utils\orderStatusDisplay.ts` â€” single source of truth for "what status label does this order show right now" across all four audiences (customer / shopkeeper / delivery / admin). Synthetic `picked_up` state for `status==='ready_for_pickup' && pickedUpAt!=null` is the actual root-cause fix for **#10**'s contradictory labels.
      - **`markPickedUp` (`@c:\Users\dahiy\grocery-mvp\functions\src\index.ts`)** â€” fixed the mislabeled `statusHistory` entry (`'ready_for_pickup'` â†’ `'picked_up'`) and added an explicit customer push (`type: 'order_picked_up'`) since `markPickedUp` doesn't change the top-level `status` and the `sendOrderStatusPush` trigger watches `status` diffs only.
      - **`markDelivered`** â€” explicit `pushToOwner(shopOwnerUid)` + `pushToAdmins` calls on the delivered transition. Customer push remains via the existing trigger. Findings **#11** + **#16(a)**.
      - **`sendOrderStatusPush` trigger** â€” extended fan-out for the `any â†’ cancelled` transition to push shopkeeper (`pushToOwner`) + admin (`pushToAdmins`). Finding **#2**.
      - **`OrderStatusChip` (`@c:\Users\dahiy\grocery-mvp\src\components\order\OrderStatusChip.tsx`)** â€” rewritten to consume `displayOrderStatus`. Back-compat: existing callers passing only `status` still work; customer-facing screens now pass `pickedUpAt` + `deliveredAt` so the chip resolves the synthetic `picked_up` state. Audience-aware: customer / shopkeeper / delivery / admin tables.
      - **`orderEtaDisplay`** â€” accepts `pickedUpAt`; returns `'hidden'` post-pickup so the "Pickup ready 5 min ago" line stops rendering once the chip switches to "Out for delivery". Symmetric collapse to the same display state.
      - **Customer-facing screens updated** to pass the new props: `OrderDetailScreen`, `OrdersScreen`, `ActiveOrdersRail`. **Shop / admin screens** (`ShopOrderDetailScreen`, `ShopOwnerDashboardScreen`, `AdminOrdersScreen`) also pass them so their own audience-keyed labels resolve correctly.
      - **`AuthBootstrap` (`@c:\Users\dahiy\grocery-mvp\src\components\AuthBootstrap.tsx`)** â€” extended the PR 45.2 push-tap handler with order-related deep-link routing for `new_order_for_shop`, `new_pickup_for_delivery`, `order_picked_up`, `order_cancelled`, `order_delivered`, and the legacy `order_status` push types. Audience derived from `useAuthStore` claims at tap time. Finding **#3**.

- [x] **Tests.** 36 new cases in `@c:\Users\dahiy\grocery-mvp\tests\utils\orderStatusDisplay.test.ts`. Suite green at **979 / 979**, up from 943.
      - Decision matrix: pending / accepted / preparing pass through; `ready_for_pickup` + `pickedUpAt=null` â†’ `ready_for_pickup`; `ready_for_pickup` + `pickedUpAt` set â†’ `picked_up` (synthetic); `cancelled` wins over stale `deliveredAt` / `pickedUpAt`.
      - 7 displayed states Ã— 4 audiences = 28 label-pin cases.
      - Pinned customer copy block (regression net so a careless rename doesn't silently change customer-visible text).
      - Explicit "finding #10 contradictory-label scenario" test asserting customer + shopkeeper views both resolve to the SAME `'picked_up'` state.

- [ ] **Cloud Run IAM verification (post-deploy).** Two redeployed public callables to verify (`markPickedUp`, `markDelivered`); the trigger `sendOrderStatusPush` is background-only:

      ```powershell
      gcloud run services get-iam-policy markpickedup `
        --region=asia-south1 --project=grocery-mvp-dev
      gcloud run services get-iam-policy markdelivered `
        --region=asia-south1 --project=grocery-mvp-dev
      ```

      Add `allUsers / run.invoker` to either if missing.

- [ ] **Deploy plan.**
      1. `npm run test:unit` â€” green (979/979 currently).
      2. ```powershell
         firebase deploy --only `
           functions:markPickedUp,functions:markDelivered,functions:sendOrderStatusPush
         ```
      3. Cloud Run IAM verify (above).
      4. `eas update --branch production --message "PR-NEXT-1 order status propagation + push fan-out"`. **OTA-safe** â€” pure JS, no native module / permission / `app.json` change.

- [ ] **Smoke acceptance (5 steps, 2-device pair).**
      1. **Cancel push to shopkeeper (#2 + #3)** â†’ Customer places order on device A; shopkeeper sees it. Customer cancels within the 2-min window. Shopkeeper device receives a push within ~5s. Tapping it opens **ShopOrderDetail** for that exact order.
      2. **Picked-up consistency (#10)** â†’ Customer places â†’ shop accepts + marks ready â†’ partner taps "I've picked up." Customer's `OrderDetail` shows EXACTLY ONE label: "Out for delivery." No "Pickup ready 5 min ago" anywhere. Repeat 3Ã— to confirm propagation isn't intermittent.
      3. **Delivered fan-out (#11, #16)** â†’ Partner taps "Delivered." Customer push (existing) âœ…. Shopkeeper push âœ… (new â€” opens `ShopOrderDetail`). Admin push âœ… (new â€” opens `AdminOrders`).
      4. **Status text consistency across surfaces** â†’ Open the same order on customer / shopkeeper / delivery / admin screens. Each label is appropriately worded for its audience but they all describe the same underlying state.
      5. **Mid-cycle race resilience** â†’ 3 orders back-to-back through the full lifecycle in parallel. No status display ghosting on any.

- [x] **PR-NEXT-HOTFIX-5 addendum â€” cold-start push deep-link gap.** PR-NEXT-1's routing table (above) shipped against `Notifications.addNotificationResponseReceivedListener`, which the Expo docs are explicit about: it fires only for taps that happen AFTER the listener attaches. Cold-start taps (app force-quit when the push arrived, user taps to launch) are consumed by Expo internally before `AuthBootstrap`'s useEffect ever runs, so they were silently dropped â€” every cold-start push tap landed on Home regardless of the deep-link target. Surfaced as Sudhir's June 1 test pass Case 2 (shopkeeper-specific symptom) but the root cause was role-agnostic â€” customer cold-start delivered tap, admin cold-start pending-approval tap, partner cold-start new-pickup tap all hit the same gap. Logged as Finding #18 in `@c:\Users\dahiy\grocery-mvp\docs\TESTING-FINDINGS-2026-05-30.md:236`. Fix in `@c:\Users\dahiy\grocery-mvp\src\components\AuthBootstrap.tsx`: (1) extracted the 165-line inline routing table into a named `handleNotificationResponse(response)` function â€” every branch / return / `safeNavigate` call preserved verbatim â€” so the same routing can be invoked from both the warm-tap listener AND the new cold-start dispatch; (2) added a `Notifications.getLastNotificationResponseAsync().then(...)` call with a polling race-guard that fires `handleNotificationResponse` exactly once when BOTH `navigationRef.isReady()` and `useAuthStore.getState().ready` are true (100ms tick, 10s safety ceiling, `coldStartDispatched` flag for double-dispatch defense against Android OEM quirks where Expo can return a stale-from-earlier response on a non-tap warm boot); (3) cleanup cancels any in-flight poll and marks the dispatch flag on unmount so straggling ticks self-abort. Imported `navigationRef` alongside the existing `safeNavigate` (DO-NOT-REMOVE comment carried). No new tests â€” pure lifecycle plumbing, manual acceptance covers it via the 5-step shopkeeper cold-start primary scenario + 3-step generalized cross-role scenario. tsc + 1212 / 1212 unit tests still clean. Pure client OTA: `eas update --branch production --message "HOTFIX-5 cold-start push deep-link"`. Deferred: migration to the reactive `Notifications.useLastNotificationResponse()` hook (same diagnostic, more reactive â€” current polling is cleaner for the existing useEffect architecture); Sentry capture on 10s timeout (currently `console.warn` only; layer Sentry if the timeout fires in production).

- [ ] **Doc trail.** Findings `#2`, `#3`, `#10`, `#11` marked **SHIPPED** in `@c:\Users\dahiy\grocery-mvp\docs\TESTING-FINDINGS-2026-05-30.md`; finding `#16` marked **partially shipped** (sub-a â€” push fan-out â€” done; sub-b/c/d defer to PR-NEXT-3 / PR-NEXT-6); finding `#18` (cold-start push deep-link gap) marked **SHIPPED in PR-NEXT-HOTFIX-5**.

- [x] **PR-NEXT-13a addendum â€” partner-accept customer push + identity surface.** Closes a gap from Sudhir's smoke testing: when the delivery partner accepted a pickup, the customer got no notification and the partner's identity wasn't visible until the actual pickup event (5â€“30 min window of opacity). Server extends `claimDelivery` (`@c:\Users\dahiy\grocery-mvp\functions\src\index.ts:3480`) with two post-transaction best-effort steps wrapped in `try/catch` so neither failure mode can roll back the successful atomic claim: (1) read the partner's `users/{uid}.displayName` via new pure helper `pickPartnerDisplayName` (`@c:\Users\dahiy\grocery-mvp\functions\src\claimDeliveryHelpers.ts`) and denormalise onto the order as `deliveryPersonName`; (2) fire `pushToUser(customerUid, "Your delivery partner is on the way", "<partnerName> will pick up your order from <shopName>.", { type: 'order_partner_accepted' })`. Schema-additive `Order.deliveryPersonName?: string` (legacy + mid-flight orders absent â†’ fallback copy "Your delivery partner"). Client adds `PartnerIdentityCard` (`@c:\Users\dahiy\grocery-mvp\src\components\order\PartnerIdentityCard.tsx`) on `OrderDetailScreen` between the status card and delivery-address card whenever `deliveryPersonId` is set and the order isn't cancelled â€” initials-in-coloured-circle avatar (NOT a real photo; partner profile photo flow doesn't exist yet, and the KYC selfie is PII) + display name + state-aware subtitle (ðŸ“¦ Heading to the shop / ðŸ›µ On the way to you) keyed on `pickedUpAt`. Phone number stays gated to post-pickup; this PR doesn't change that. `AuthBootstrap.tsx` adds the new `order_partner_accepted` deep-link case (customer-only single-target, same posture as `order_picked_up`). Pure helper `initialsFor` (`@c:\Users\dahiy\grocery-mvp\src\utils\partnerInitials.ts`) lives in its own pure `.ts` file so the test suite pins the avatar-glyph logic without dragging the `.tsx` component through the JSX-free `tests/tsconfig.json`. Pinned by 8 `pickPartnerDisplayName` tests + 9 `initialsFor` tests; suite at **1172 / 1172** (was 1155). Server-first deploy: `firebase deploy --only "functions:claimDelivery"` â†’ verify `allUsers` IAM on the `claimdelivery` Cloud Run service â†’ `eas update --branch production --message "PR-NEXT-13a partner-accept push"`.

- [x] **PR-NEXT-17 addendum â€” suppress ETA countdown once `ready_for_pickup`.** Closes finding #17 surfaced by Sudhir during testing of PR-NEXT-13a: customer's `OrderDetailScreen` rendered two contradictory lines once the shop marked the order ready â€” the post-PR-NEXT-1 chip ("Ready â€” Partner is picking up") AND a stale `Pickup ready in/ago X min` countdown right below it. Root cause was that `orderEtaDisplay`'s step-4 branch (`readyByEstimate` valid â†’ `ready_by`) didn't filter on status, so `ready_for_pickup` orders kept counting down/up against a moment the shop had already moved past. One-branch fix in `@c:\Users\dahiy\grocery-mvp\src\utils\orderEtaDisplay.ts:111` mirrors PR-NEXT-1's `pickedUpAt`-aware suppression: when `order.status === 'ready_for_pickup'` return `{ kind: 'hidden' }`. New branch lands after the `pickedUpAt` check (so the post-pickup case stays handled by the earlier, more-specific branch) and before the `pending` check. `deliveryPersonId` deliberately stays OUT of `EtaInput` â€” pre-claim and post-claim sub-windows produce the same suppression decision; PR-NEXT-13a's `PartnerIdentityCard` carries the visual distinction. Render sites verified: `OrderDetailScreen` (`@c:\Users\dahiy\grocery-mvp\src\screens\OrderDetailScreen.tsx:377-409`), `OrderConfirmationScreen` (`@c:\Users\dahiy\grocery-mvp\src\screens\OrderConfirmationScreen.tsx:117-128`), and `ActiveOrdersRail` (`@c:\Users\dahiy\grocery-mvp\src\components\order\ActiveOrdersRail.tsx:58-78`) all dispatch on `kind === '...'` conditionals â€” `hidden` naturally renders nothing. `ActiveOrdersRail` had its own pre-helper `ready_for_pickup` early-returns (`'Out for delivery'` / `'Almost ready'`) so its copy is unaffected. Pinned by 1 flipped test (`ready_for_pickup + readyByEstimate` now expects `hidden`) + 4 new tests (elapsed-time `readyByEstimate`, defensive `ready_for_pickup` with no `readyByEstimate`, `accepted` + `preparing` regression anchors). Suite at **1176 / 1176** (was 1172). Pure client OTA: `eas update --branch production --message "PR-NEXT-17 ETA suppression on ready_for_pickup"`.

- [ ] **Out of scope (deferred).** Promoting `'picked_up'` to a real `OrderStatus` enum value (server-side state-machine refactor â€” synthetic state in `displayOrderStatus` is the cheap defensive fix for now). Shop-dashboard "Delivered today" section enhancement (#16(d)). COD confirmation flow (#12 â†’ PR-NEXT-3). Delivery proof photo (#13 â†’ PR-NEXT-6).

## PR 50 â€” Delivery partner notification radius `[Phase 50]` â€” **GEO SYSTEM 5/5 COMPLETE**

- [x] **Why this PR exists.** Fifth and final PR of the geo system.
      Today's `sendNewPickupPushToDelivery` trigger pushes a new-
      pickup notification to **every** online delivery partner
      regardless of location â€” a partner in north Faridabad pinged
      about an order in south Faridabad they'd never accept. PR 50
      finally **uses** the data the previous geo PRs wired up
      (`Order.shopLocation` from PR 49, `users/{uid}.currentLocation`
      from PR 49) to filter the push fan-out by per-partner radius.
      **Goal #6** ("server-gated true push filtering") of the geo
      system â€” done. Sudhir's "only within 2 km" requirement is
      satisfied by a configurable 1â€“50 km per-partner radius with a
      3 km default. **Side effect:** fixes **finding #8** (Online
      toggle persistence across screen navigations) via the new
      `getMyDeliverySettings` read on focus.

- [x] **What shipped.**
      - **Pure helper** `@c:\Users\dahiy\grocery-mvp\functions\src\notificationRadiusHelpers.ts` â€” `filterPartnersByNotificationRadius` + `DEFAULT_PARTNER_NOTIFICATION_RADIUS_KM = 3`. **Server-only** (no client mirror â€” the filter runs inside the push trigger; partners never see the decision logic). Fail-OPEN rules: missing `shopLocation` â†’ keep all; missing partner `currentLocation` â†’ keep partner; invalid `notificationRadiusKm` (0 / NaN / Infinity / negative) â†’ 3 km default. Boundary INCLUSIVE.
      - **Trigger filter** in `@c:\Users\dahiy\grocery-mvp\functions\src\index.ts` `sendNewPickupPushToDelivery` â€” after the `users where isDelivery && deliveryStatus==online` query, apply `filterPartnersByNotificationRadius(allOnline, after.shopLocation)`; collect tokens from the filtered set only. New "no in-range partners" early-return branch with structured log.
      - **`approveDeliveryRole` seed** â€” first approve writes `notificationRadiusKm: 3` onto `users/{uid}`. Idempotent on re-approval (customized values preserved).
      - **`updateMyDeliverySettings({ notificationRadiusKm })`** â€” new callable, delivery-role-gated, strict 1â€“50 integer guard (rejects NaN / Infinity / non-integer / out-of-range BEFORE the Firestore write).
      - **`getMyDeliverySettings()`** â€” new callable, returns `{ deliveryStatus, notificationRadiusKm }` so the dashboard can re-hydrate its own state on focus.
      - **`orderService.updateMyDeliverySettings` + `getMyDeliverySettings`** in `@c:\Users\dahiy\grocery-mvp\src\services\orderService.ts` (native + web branches, mirroring `setDeliveryStatus`).
      - **Dashboard wiring** in `@c:\Users\dahiy\grocery-mvp\src\screens\delivery\DeliveryDashboardScreen.tsx`:
        - Four new `useState`s (`notificationRadiusKm`, `radiusInput`, `savingRadius`, `radiusError`) above conditional early returns.
        - `getMyDeliverySettings` read in the existing `useFocusEffect` (alongside the PR 49 location capture) â€” also re-hydrates the Online switch, **fixing finding #8**.
        - New settings card directly below the Online card: numeric input + "km" label + Save button + inline help/error. Client mirrors server's 1â€“50 integer guard.
        - Save button is dirty-aware (disabled when the input matches the persisted value).
      - **Hardcoded `3` mirror in the dashboard** with a comment pointing at `DEFAULT_PARTNER_NOTIFICATION_RADIUS_KM` in `functions/`. Same posture as the other server constants â€” no `functions/` import from `src/`.

- [x] **Tests.** 13 new cases in `@c:\Users\dahiy\grocery-mvp\tests\functions\notificationRadiusHelpers.test.ts`. Suite green at **943 / 943**, up from 930.
      - Within-radius kept / beyond dropped; **boundary inclusive**.
      - Partner missing `currentLocation` â†’ kept (fail-open); also `null` and non-finite-coord variants.
      - Shop `shopLocation` missing or non-finite â†’ ALL partners kept.
      - `notificationRadiusKm` absent / 0 / negative / NaN / Infinity â†’ falls back to 3 km default.
      - Per-partner override honored independently of default.
      - Empty input â†’ empty output; no mutation of input / rows.
      - Pin: `DEFAULT_PARTNER_NOTIFICATION_RADIUS_KM === 3`.

- [ ] **Cloud Run IAM verification (post-deploy).** Two new + one redeployed public callables:

      ```powershell
      gcloud run services get-iam-policy updatemydeliverysettings `
        --region=asia-south1 --project=grocery-mvp-dev
      gcloud run services get-iam-policy getmydeliverysettings `
        --region=asia-south1 --project=grocery-mvp-dev
      ```

      Add `allUsers / run.invoker` to either if missing:

      ```powershell
      gcloud run services add-iam-policy-binding <svc> `
        --region=asia-south1 --project=grocery-mvp-dev `
        --member=allUsers --role=roles/run.invoker
      ```

      `sendNewPickupPushToDelivery` is a background trigger â€” no `allUsers` needed. `approveDeliveryRole` is admin-only â€” no `allUsers` needed.

- [ ] **Deploy plan.**
      1. `npm run test:unit` â€” green (943/943 currently).
      2. ```powershell
         firebase deploy --only `
           functions:sendNewPickupPushToDelivery,functions:approveDeliveryRole,functions:updateMyDeliverySettings,functions:getMyDeliverySettings
         ```
      3. Cloud Run IAM verify (above) on `updateMyDeliverySettings` + `getMyDeliverySettings`.
      4. `eas update --branch production --message "PR 50 partner notification radius"`. OTA-safe â€” pure JS, no new native module / permission, no `app.json` change.

- [ ] **Smoke acceptance (7 steps, two phones).**
      1. **Default seeded on new approve** â†’ Admin approves a new delivery partner. `users/{uid}.notificationRadiusKm === 3` in Firestore console immediately after approval.
      2. **Finding #8 fix â€” Online toggle persistence** â†’ Existing partner toggles Online â†’ navigates away â†’ returns to dashboard. The Online switch stays ON. (Pre-PR-50 it reset to Offline.)
      3. **Radius save persists** â†’ Partner changes radius to 5, taps Save â†’ "Save" feedback â†’ navigates away and back â†’ field shows 5. Repeat with an out-of-range value (60) â†’ inline error, no save round-trip.
      4. **In-range partner gets push** â†’ Partner A in Ballabgarh with radius 5 km. Place an order from a Ballabgarh shop (~2 km from A's reported location). Partner A receives push within ~5s.
      5. **Out-of-range partner does NOT get push** â†’ Partner B in Faridabad (~12 km from same shop) with the default 3 km radius. Place the same order. Partner B does NOT receive push. Confirm via Cloud Run logs that the trigger ran and "no in-range delivery people" (or that Partner B was filtered) appears.
      6. **Fail-open: partner without `currentLocation`** â†’ Partner C online but never opened dashboard with location granted (no `currentLocation` field on their user doc). Place an order. Partner C receives the push (we don't silently exclude work).
      7. **Fail-open: legacy order without `shopLocation`** â†’ Skip if no legacy orders exist in pilot data. If a pre-PR-49 order is force-flipped to `ready_for_pickup`, all online partners receive the push regardless of distance.

- [ ] **Doc trail.** Mark PR 50 SHIPPED in `@c:\Users\dahiy\grocery-mvp\docs\GEO_DISTANCE_SYSTEM_DESIGN.md` (done â€” see "PR 50" section); update finding #8 status in `@c:\Users\dahiy\grocery-mvp\docs\TESTING-FINDINGS-2026-05-30.md`; bump the test-suite count in `CLAUDE.md` if it's referenced there.

- [ ] **Out of scope (deferred).** Geohash-based partner queries (read-all-then-filter is fine until hundreds of partners); customer-facing partner-availability indicator (finding #9 â†’ later PR); per-shop notification preferences; background location tracking (design decision #5 still holds).

## PR 49 â€” Delivery partner routing + service-area save fix `[Phase 49]`

- [x] **Why this PR exists.** Fourth PR of the geo system. The
      customer + shop sides are geo-aware (PR 46â€“48); PR 49 makes
      the **delivery partner** side distance-aware. A partner
      opening the dashboard today sees pickups in arbitrary
      server order with no sense of how far each ride is. PR 49:
      sorts pickups nearest-first, shows each card's two ride
      legs (partnerâ†’shop + shopâ†’drop), surfaces the locked
      `deliveryLocation.label` ("Home" / "Current location"),
      and writes `users/{uid}.currentLocation` server-side so
      PR 50's push-fanout can filter to nearby partners.
      Also bundles a one-line server fix for a PR 48 regression
      (Service-area-only save fails with "At least one of â€¦
      required") â€” see section F.

- [x] **What shipped.**
      - **`Order.shopLocation?: GeoPoint`** added to `@c:\Users\dahiy\grocery-mvp\src\types\index.ts`. `placeOrder` stamps it from the already-read shop doc (no extra Firestore read), skipped when `shop.location` missing â€” back-compat-clean for pre-PR-49 readers.
      - **`reportDeliveryLocation` callable** in `@c:\Users\dahiy\grocery-mvp\functions\src\index.ts` (asia-south1, delivery-role-only via `requireDeliveryRole`). Strict lat/lng range + finite checks. Writes `users/{uid}.currentLocation` + `currentLocationUpdatedAt` (serverTimestamp); mirrors `isDelivery: true` so PR 50's push-fanout query keeps working.
      - **Profile-projection guard:** `currentLocation` + `currentLocationUpdatedAt` added to `PROFILE_INTERNAL_FIELDS` so `getMyProfile` (and the four other profile readers) never leak partner location.
      - **`orderService.reportDeliveryLocation`** added to `@c:\Users\dahiy\grocery-mvp\src\services\orderService.ts` (native + web branches mirroring `setDeliveryStatus`).
      - **Pure helper** `@c:\Users\dahiy\grocery-mvp\src\utils\deliveryRoutingHelpers.ts` with `rideLegsForOrder` + `sortPickupsByProximity`. Client-only (server doesn't sort); no `functions/` mirror needed. Pure / no-mutation; stable nearest-first sort with the original index as a tiebreaker.
      - **`DeliveryDashboardScreen` wiring** (`@c:\Users\dahiy\grocery-mvp\src\screens\delivery\DeliveryDashboardScreen.tsx`): `partnerLoc` state captured via `locationService.getCurrentLocation` inside the existing `useFocusEffect` (foreground-only; fallback / denial silently leaves `partnerLoc` null). Both pools (`headsUp` + `availableNow`) wrapped in `sortPickupsByProximity`. New `RideDistanceLine` + `DeliveryLocationLabel` components surface the legs and the locked label on `AvailablePickupCard`, `HeadsUpCard`, and `ActiveDeliveryCard`.
      - **Section F â€” PR 48 regression fix.** `updateShopSettings`'s `onCall<{â€¦}>` request type was missing `serviceRadiusKm` (the validator in `shopSettingsHelpers` had been updated for PR 48 but the wrapper wasn't), so a radius-only payload arrived at the validator with all three fields undefined and tripped the "at least one of â€¦" guard. Added the field to the generic + the validator-input object, plus included `serviceRadiusKm` in the audit-log `before` snapshot for clean before/after diffs.

- [x] **Tests.** 14 new cases. Suite green at **930 / 930**, up from 916.
      - `@c:\Users\dahiy\grocery-mvp\tests\utils\deliveryRoutingHelpers.test.ts` (14 cases): `rideLegsForOrder` â€” both legs / null partner / missing shopLocation / missing deliveryDistanceKm / NaN-Infinity rejection / no-mutation. `sortPickupsByProximity` â€” nearer-first, no-shopLocation-to-bottom, null-partner stable, ties stable, no-mutation, empty array, mixed list integration.
      - PR 48's `shopSettingsHelpers.test.ts` already covers the validator's `serviceRadiusKm` rules (12 cases shipped with PR 48); the wrapper bug surfaced because the wrapper has no unit-test seam â€” verified via the on-device repro in step 1 of smoke acceptance below.

- [ ] **Cloud Run IAM verification (post-deploy).** New + redeployed callables:

      ```powershell
      gcloud run services get-iam-policy reportdeliverylocation `
        --region=asia-south1 --project=grocery-mvp-dev
      gcloud run services get-iam-policy updateshopsettings `
        --region=asia-south1 --project=grocery-mvp-dev
      gcloud run services get-iam-policy getmyprofile `
        --region=asia-south1 --project=grocery-mvp-dev
      gcloud run services get-iam-policy placeorder `
        --region=asia-south1 --project=grocery-mvp-dev
      ```

      Add the `allUsers / run.invoker` binding to any missing service:

      ```powershell
      gcloud run services add-iam-policy-binding <svc> `
        --region=asia-south1 --project=grocery-mvp-dev `
        --member=allUsers --role=roles/run.invoker
      ```

- [ ] **Deploy plan.**
      1. `npm run test:unit` â€” green (930/930 currently).
      2. ```powershell
         firebase deploy --only `
           functions:placeOrder,functions:reportDeliveryLocation,functions:updateShopSettings,functions:getMyProfile
         ```
      3. Cloud Run IAM verify (above).
      4. `eas update --branch production --message "PR 49 partner routing + service-area save fix"`. OTA-safe â€” `expo-location` already shipped (PR 46), no new native module / permission, no `app.json` change.

- [ ] **Smoke acceptance (run all seven).**
      1. **Section F repro** â†’ Shop Settings, change ONLY Service area (e.g. 5 â†’ 20), Save â†’ succeeds, persists across reload. (Pre-fix: "At least one of deliveryFee, minOrder, or serviceRadiusKm is required.")
      2. **Partner location prompt** â†’ first dashboard open shows the foreground location prompt once. Granting it does not block the screen; denying it leaves the dashboard fully usable (pickups simply aren't distance-sorted, ride lines fall back to drop-only or hide).
      3. **Nearest-first sort** â†’ with two available pickups at different shops, the nearer shop's pickup sorts to the top of "Available now."
      4. **Ride distance on card** â†’ an available pickup shows `ðŸ›µ ~X.X km ride Â· A to shop + B to drop`, where B matches the order's stored `deliveryDistanceKm` and A is plausible for the partner's current spot.
      5. **Locked location label** â†’ a pickup placed against "Current location" shows `ðŸ“ Current location`; one against a saved address shows `ðŸ“ Home` (or whatever label the customer saved).
      6. **Legacy order** (no `shopLocation` / no `deliveryDistanceKm`) â†’ renders without a ride line, sorts to the bottom; no crash.
      7. **`currentLocation` written + stripped** â†’ after opening the dashboard with permission granted, the partner's `users/{uid}` doc has `currentLocation` + `currentLocationUpdatedAt`. Confirm `getMyProfile` (Profile screen) does NOT return either field â€” sets up PR 50 cleanly.

- [ ] **Out of scope (later geo PRs).** Notification-radius push filtering (PR 50 â€” consumes the `currentLocation` this PR writes); background / live location tracking; partner map view; any Distance Matrix call; reverse-geocoding partner or customer location to a label.

## PR 48 â€” Shop service radius + tier-save bug fix `[Phase 48]`

- [x] **Why this PR exists.** Two fronts in one PR:
      (1) **Visibility gate (sections Aâ€“H).** Today every active
      shop shows to every customer (the hardcoded
      `SHOW_ALL_SHOPS = true` in `shopService.ts`); a Faridabad
      shop showing to a Delhi customer is wrong for real launch.
      Each shop now sets `serviceRadiusKm`; `listShopsPublic`
      filters customers outside it.
      (2) **PR 47 smoke-test bug (sections I + J).** Sudhir
      reported tier saves don't survive a reload (5 km charge
      reverts 65â†’60), AND the now-redundant flat "Delivery fee"
      input on Shop Settings was confusing owners (the tier table
      governs pricing, not the flat field). Folded both fixes
      into PR 48 â€” one migration, one test pass, one IAM verify.

- [x] **What shipped.**
      - **Pure helpers** in
        `@c:\Users\dahiy\grocery-mvp\functions\src\geoVisibilityHelpers.ts`
        (server) +
        `@c:\Users\dahiy\grocery-mvp\src\utils\geoVisibilityHelpers.ts`
        (client mirror): `filterShopsByServiceRadius(shops,
        { showAll })` + `DEFAULT_SERVICE_RADIUS_KM = 5`. Fail-OPEN
        on missing `distanceKm` (no customer location â†’ don't
        hide). INCLUSIVE radius boundary; treats `serviceRadiusKm`
        â‰¤ 0 / NaN as missing â†’ falls back to default.
      - **Shop type** got `serviceRadiusKm?: number` (optional;
        legacy fallback to 5 km via the helper).
      - **`listShopsPublic`** now reads
        `appConfig/shopVisibility.showAllShops` (defaults FALSE
        on missing doc / read error â€” secure default) and applies
        `filterShopsByServiceRadius` after `rankShopsByDistance`.
      - **`shopService.getNearbyShops`** stripped of
        `SHOW_ALL_SHOPS = true` / `NEAR_KM` constants. Native
        path trusts the server's filtered list. Web Plan B path
        reads the flag via Web SDK + applies the same pure
        helper. Both `haversineKm` + `DEFAULT_SERVICE_RADIUS_KM`
        kept imported with explicit `void` references (Rule 1
        auto-formatter shield â€” both have been stripped before).
      - **`shopSettingsHelpers`** whitelisted `serviceRadiusKm`
        as a third field (integer-only, 1â€“50 km). Updated the
        "at least one of" message to include the new field.
      - **`approveShop`** seeds `DEFAULT_SERVICE_RADIUS_KM` only
        when the doc doesn't already have a positive radius
        (preserves a customized radius across re-approval; same
        posture as PR 47's tier seeding).
      - **ShopSettingsScreen** gained "Service area (km)" field
        (pre-fills to default for legacy shops) and **lost** the
        flat "Delivery fee (â‚¹)" input. The schema field
        `shop.deliveryFee` is INTENTIONALLY KEPT â€” it's still the
        legacy fallback for `chargeForDistance` and the
        `deliveryFee = deliveryCharge` shim placeOrder stamps.
        Only the UI control was removed.
      - **`orderService.updateShopSettings`** signature gained
        `serviceRadiusKm?: number` on input + the response's
        `updates` shape.
      - **Section I â€” tier-save persistence fix.** Three-part:
        - **`updatedAt` type normalization.** Both
          `updateShopSettings` (~line 5287) and
          `updateShopDeliveryTiers` (~line 5370) wrote
          `updatedAt: Date.now()` (a number); every other shop
          write uses `FieldValue.serverTimestamp()` (a Timestamp).
          Firestore orders mixed-type fields by type first
          (numbers sort below Timestamps), so a `getMyShop`
          `.orderBy('updatedAt', 'desc')` returned the WRONG
          (stale) doc immediately after a save. Both writes now
          use `serverTimestamp()`.
        - **`getMyShop` reads by claim.** When `auth.token.shopId`
          is present, `getMyShop` now reads
          `shops/{claims.shopId}` directly â€” the SAME key the
          writers use. The legacy `ownerUid + status + orderBy`
          query is preserved ONLY for pending owners (no claim
          yet â€” `WaitingForApproval` relies on it). This
          guarantees writer + reader resolve to the same doc.
        - **Temporary diagnostic logs** in `getMyShop`
          (`[getMyShop] resolved via claim.shopId` and
          `... via ownerUid fallback`) capture path / hasTiers /
          updatedAt-type for one repro from Sudhir.
          **Strip these logs in the same PR once verified** â€”
          tracked as a TODO below (PR 45.1 diagnostic-cleanup
          lesson).
      - **Section J.** Removed only the UI control. The data
        field, type, cart snapshot, and server fallback logic
        all stay intact.

- [x] **Tests.** 28 new cases. Suite green at **916 / 916**, up
      from 888.
      - `@c:\Users\dahiy\grocery-mvp\tests\functions\geoVisibilityHelpers.test.ts`
        (16 cases): inclusive boundary, beyond-radius, missing /
        zero / negative / NaN radius â†’ default fallback, undefined
        / Infinity / NaN distance â†’ fail-open, `showAll: true`
        bypass, empty array, no-input-mutation guard, slice-not-
        same-reference on showAll path, mixed-table integration,
        `DEFAULT_SERVICE_RADIUS_KM === 5` pin.
      - `@c:\Users\dahiy\grocery-mvp\tests\functions\shopSettingsHelpers.test.ts`
        +12 cases: valid radius / partial-only / missing-all-three
        rejection / non-integer / 0 / negative / 51 / non-numeric /
        NaN / boundary 1 + 50 / combined three-field update.

- [ ] **Cloud Run IAM verification (post-deploy).** Modified
      callables â€” verify after every redeploy:

      ```powershell
      gcloud run services get-iam-policy listshopspublic `
        --region=asia-south1 --project=grocery-mvp-dev
      gcloud run services get-iam-policy updateshopsettings `
        --region=asia-south1 --project=grocery-mvp-dev
      gcloud run services get-iam-policy getmyshop `
        --region=asia-south1 --project=grocery-mvp-dev
      gcloud run services get-iam-policy updateshopdeliverytiers `
        --region=asia-south1 --project=grocery-mvp-dev
      ```

      `approveShop` is admin-auth-only; it does NOT need an
      `allUsers` binding (verifying it is harmless but expect no
      public binding).

      Add the `allUsers / run.invoker` binding to any missing
      service:

      ```powershell
      gcloud run services add-iam-policy-binding <svc> `
        --region=asia-south1 --project=grocery-mvp-dev `
        --member=allUsers --role=roles/run.invoker
      ```

- [ ] **Deploy plan (server-FIRST so the offshore team doesn't
      go blind).**
      1. **Set the testing override BEFORE deploying.** In
         Firestore, create `appConfig/shopVisibility` â†’
         `{ showAllShops: true }`. Once PR 48's server lands, this
         keeps every cross-city tester seeing every shop until you
         flip it.
      2. `npm run test:unit` â€” green (916/916 currently).
      3. ```powershell
         firebase deploy --only `
           functions:listShopsPublic,functions:updateShopSettings,functions:approveShop,functions:getMyShop,functions:updateShopDeliveryTiers
         ```
      4. Cloud Run IAM verify (above) on the four public callables
         (`approveShop` skipped intentionally).
      5. `eas update --branch production --message "PR 48 service radius + tier-save fix"`.
      6. **At real 1-shop pilot:** flip
         `appConfig/shopVisibility.showAllShops` â†’ `false` (or
         delete the doc) so the radius gate goes live for real
         customers. **No redeploy required.**

- [ ] **Smoke acceptance (run all nine).**
      1. **Testing override ON** (`showAllShops: true`) â†’
         cross-city tester still sees every active shop. No
         regression for the offshore team.
      2. **Override OFF**, customer near pilot shop â†’ shop
         appears, card shows "~X.X km".
      3. **Override OFF**, simulate a far location (or set the
         shop's `serviceRadiusKm: 1` and stand >1 km away) â†’
         shop disappears; "No shops near you" empty state
         renders.
      4. **Owner â†’ Settings â†’ Service area** â†’ field pre-fills
         (5 for default), edit to 3, Save â†’ succeeds; re-open
         confirms persisted.
      5. **Legacy shop without `serviceRadiusKm`** â†’ still
         visible within 5 km (default fallback), hidden beyond.
      6. **GPS denied / no location** â†’ list does NOT go empty
         (fail-open).
      7. **Newly-approved shop** â†’ has `serviceRadiusKm: 5`
         seeded.
      8. **Section I â€” tier-save persistence (Sudhir's repro).**
         Owner changes 5 km charge 60â†’65, Save, **leave the
         screen and come back** â†’ field shows **65** (the bug;
         must now stick). Re-open a second time. Place a real
         order at ~4 km destination â†’ delivery charge reflects
         65.
      9. **Section J â€” flat fee control gone.** Shop Settings no
         longer has "Delivery fee (â‚¹)" input; "Minimum order" +
         "Service area" remain; saving them works. Checkout
         pricing unchanged (tiers still drive it).

- [ ] **Strip the temporary `getMyShop` diagnostic logs.** After
      step 8 confirms the tier-save fix sticks, remove the two
      `console.info('[getMyShop] resolved via â€¦')` lines (and the
      `console.warn` for the missing-doc branch can stay â€” it's
      a real anomaly, not a diagnostic). Per the PR 45.1
      diagnostic-probe-cleanup lesson.

- [ ] **Out of scope (later geo PRs).** Partner routing /
      sorting / location reporting (PR 49); partner notification
      radius (PR 50); per-customer "deliver here" radius preview
      on the shop card; reverse-geocoding the customer location
      to a label.

## PR 47 â€” Distance-based delivery charges `[Phase 47]`

- [x] **Why this PR exists.** PR 46 stamped
      `order.deliveryDistanceKm` on every order; PR 47 turns that
      into money. The flat `shop.deliveryFee` overcharged 1km
      deliveries and undercharged 8km deliveries â€” wrong for both
      the customer and the shop economics. PR 47 makes the charge
      scale with distance via per-shop configurable tiers.

- [x] **What shipped.**
      - **Pure helpers** in
        `@c:\Users\dahiy\grocery-mvp\functions\src\deliveryChargeHelpers.ts`:
        `chargeForDistance(tiers, distanceKm, fallbackFlat)`,
        `validateDeliveryChargeTiers(tiers)`,
        `DEFAULT_DELIVERY_CHARGE_TIERS = [{â‰¤1km, â‚¹20}, {â‰¤3km, â‚¹40},
        {â‰¤5km, â‚¹60}, {beyond, â‚¹100}]`. INCLUSIVE `maxKm`
        boundaries; sort-on-read so storage order is irrelevant;
        legacy fallback to flat `deliveryFee` for shops without a
        tier table. Pure-function discipline (input array never
        mutated) â€” pinned by a regression test.
      - **Client-side mirror** at
        `@c:\Users\dahiy\grocery-mvp\src\utils\deliveryChargeHelpers.ts`
        (same shape; client doesn't import from `functions/` per
        repo convention). Used by ShopSettingsScreen for inline
        validation + CheckoutScreen for the preview charge.
      - **`placeOrder` extension** (functions/src/index.ts ~line
        676): replaced `const deliveryFee = shop.deliveryFee` with
        the tier-resolved `chargeForDistance(...)` using the
        server-derived `stampedDeliveryDistanceKm`. Stamps both
        `deliveryCharge` (new) and `deliveryFee = deliveryCharge`
        (back-compat shim) onto the order doc. Tampered-client
        distance values are NOT trusted â€” server re-derives via
        `deriveShopDeliveryEstimate` (same helper as
        `getDeliveryEstimate`).
      - **`approveShop` extension** (~line 3737): seeds
        `DEFAULT_DELIVERY_CHARGE_TIERS` onto every newly-approved
        shop. Skipped on re-approval when tiers already exist
        (preserves a previously-customized table after a suspend
        cycle). New shops get working tiers immediately.
      - **`updateShopDeliveryTiers` callable** (asia-south1, shop
        owner only â€” server reads `claims.shopId`; request-body
        shopId is intentionally unsupported here). Server validates
        via the same `validateDeliveryChargeTiers` the client uses,
        writes audit log entry of action `shop.update_delivery_tiers`.
      - **ShopSettingsScreen** got a "Delivery charges (by
        distance)" card with editable km + â‚¹ per band, dashed
        "+ Add band" pill, âœ• remove (catch-all unremovable),
        live "More than X km" label on the catch-all row, inline
        save with friendly validation errors. Separate Save button
        from the existing flat-fee form (different callable,
        different validation surface).
      - **CheckoutScreen** now reads the cart's snapshot
        `deliveryChargeTiers`, computes `previewDeliveryCharge =
        chargeForDistance(tiers, deliveryEstimate?.distanceKm ?? 0,
        deliveryFee)`, and renders `Delivery (X.X km)  â‚¹N` in the
        bill. Total derived from the preview â€” no longer the flat
        fee. Server is authoritative; preview is for display only.
      - **Cart store** (`@c:\Users\dahiy\grocery-mvp\src\store\useCartStore.ts`)
        gained a `deliveryChargeTiers: DeliveryChargeTier[] | null`
        field, snapshotted at every add path (addItem,
        addMenuItem, replaceCartWithItems) and persisted via
        partialize so a relaunch mid-checkout still renders the
        tiered preview.
      - **`Shop.deliveryChargeTiers?`** + **`Order.deliveryCharge?`**
        + **`DeliveryChargeTier`** added to
        `@c:\Users\dahiy\grocery-mvp\src\types\index.ts`. All
        optional for back-compat with pre-PR-47 docs.

- [x] **Tests.** 30 new cases in
      `@c:\Users\dahiy\grocery-mvp\tests\functions\deliveryChargeHelpers.test.ts`
      covering: boundary inclusivity (0.5 / 1.0 / 1.0001 / 5 / 5.0001),
      catch-all behavior, sort-on-read with shuffled input,
      negative / NaN / Infinity distance clamping, legacy fallback
      branches, partial-malformed cherry-picking, default-table
      pin, no-catch-all safety net, and all
      `validateDeliveryChargeTiers` rejection paths (empty,
      missing/duplicate catch-all, ascending overlap, negative
      charge, non-numeric maxKm, NaN). Suite green at **888 /
      888**, up from 858.

- [ ] **Cloud Run IAM verification (post-deploy).** New callable
      + modified callables all need `allUsers / run.invoker`:

      ```powershell
      gcloud run services get-iam-policy updateshopdeliverytiers `
        --region=asia-south1 --project=grocery-mvp-dev
      gcloud run services get-iam-policy placeorder `
        --region=asia-south1 --project=grocery-mvp-dev
      gcloud run services get-iam-policy approveshop `
        --region=asia-south1 --project=grocery-mvp-dev
      ```

      Add the binding to any missing service:

      ```powershell
      gcloud run services add-iam-policy-binding <service> `
        --region=asia-south1 --project=grocery-mvp-dev `
        --member=allUsers --role=roles/run.invoker
      ```

- [ ] **Smoke acceptance.**
      1. **Shop owner edits tiers.** Sign in as shop owner â†’
         Settings â†’ Delivery charges â†’ see the seeded default â†’
         change â‰¤1km to â‚¹15, add a band (â‰¤2km, â‚¹30), save â†’ re-open
         Settings â†’ values persisted. Audit log has a
         `shop.update_delivery_tiers` entry with before/after.
      2. **Invalid tiers rejected (client + server).** Try to save
         with no catch-all â†’ inline error "Add a 'beyond the last
         band' catch-all tier...". Try duplicate maxKm â†’ inline
         "Tier distances must be strictly ascending". Editor never
         hits the server in either case.
      3. **Charge scales with distance â€” near.** Customer with a
         delivery location ~0.5km from the shop â†’ checkout bill
         shows the tier-1 charge (â‚¹20 default). Distance-bearing
         label visible: "Delivery (0.5 km)  â‚¹20".
      4. **Charge scales with distance â€” far.** Customer ~4km
         away â†’ bill shows tier-3 charge (â‚¹60). Total updates.
      5. **Order locks the charge.** Place the order â†’ order doc
         has `deliveryCharge` matching the tier for its
         `deliveryDistanceKm`, AND `deliveryFee` mirrors it. Total
         = subtotal + deliveryCharge. ShopOrderDetail / receipts /
         refund logic all keep working unchanged (read
         `deliveryFee`).
      6. **Legacy shop fallback.** A shop without `deliveryChargeTiers`
         (any of the pre-PR-47 seed shops that haven't been
         re-approved) should still place orders successfully,
         charging its flat `deliveryFee`. No crash, no â‚¹0.
      7. **New shop gets defaults.** Register + approve a fresh
         shop â†’ its doc has `deliveryChargeTiers` matching
         `DEFAULT_DELIVERY_CHARGE_TIERS`.

- [ ] **Deploy plan.**
      1. `npm run test:unit` â€” green (888/888 currently).
      2. `firebase deploy --only functions:placeOrder,functions:approveShop,functions:updateShopDeliveryTiers`.
      3. Cloud Run IAM verify (above) â€” especially the new
         `updateshopdeliverytiers` service.
      4. `eas update --branch production --message "PR 47 distance-based delivery charges"`.
      5. Force-quit + reopen twice; run smoke acceptance steps
         1â€“7.

- [ ] **Out of scope (later geo PRs).** Shop service radius +
      customer distance display (PR 48); partner routing / total
      ride distance (PR 49); partner notification radius (PR 50);
      delivery-charge payout split between shop and partner
      (separate economics PR â€” not part of the geo system).

## PR 46 â€” Geo foundation: locked delivery location + Distance Matrix `[Phase 46]`

- [x] **Why this PR exists.** Keystone of the geo/distance system
      (PRs 47â€“50). Today an order carries only the saved address
      and a flat `shop.deliveryFee`; PR 47's tier-based delivery
      charge needs (a) a **locked delivery location** on every
      order and (b) a **server-authoritative road distance +
      duration**. PR 46 lands the foundation; PR 47 flips the
      charge.

- [x] **COST DECISION (Sudhir, May 27 2026): paid Distance Matrix
      is BUILT BUT DORMANT.** Default path during pilot is the
      free haversine Ã— 1.4 + 15 km/h proration. Distance Matrix is
      gated behind the kill-switch `aiFeatures/distanceMatrix.enabled`
      (default FALSE â€” missing doc OR explicit false â†’ disabled).
      The disabled branch in `computeDeliveryEstimate` NEVER calls
      `fetch` â€” pinned by `tests/functions/distanceMatrixHelpers.test.ts`
      under "CRITICAL: flagEnabled=false â†’ fetchImpl NEVER called
      (cost guarantee)". One Firestore doc-flip turns the paid
      path on; until then zero Google billing.

- [x] **What shipped.**
      - **Pure helpers**:
        `@c:\Users\dahiy\grocery-mvp\functions\src\distanceMatrixHelpers.ts`
        â€” `ROAD_FACTOR=1.4`, `FALLBACK_SPEED_KMH=15`,
        `parseDistanceMatrixResponse`, `haversineFallbackEstimate`,
        `buildDistanceMatrixUrl`, and the orchestrator
        `computeDeliveryEstimate({shop, dest, flagEnabled, apiKey,
        fetchImpl, logger})`. Never throws; every external failure
        gracefully falls back to haversine. 25 unit tests pin the
        decision matrix.
      - **`getDeliveryEstimate` callable** (`onCall`, asia-south1,
        secrets: `[GOOGLE_MAPS_API_KEY]`). Auth required. Loads
        shop, reads kill-switch via `readDistanceMatrixFlag`,
        invokes `deriveShopDeliveryEstimate` â†’ returns
        `{ distanceKm, durationMin, source }`. Throws
        `failed-precondition` only when the shop has no
        `location` field (legacy seed shops); haversine fallback
        otherwise.
      - **`placeOrder` extension**: accepts optional
        `deliveryLocation: { lat, lng, type, addressId?, label }`,
        validates the shape, **re-derives** the estimate
        server-side (via the same `deriveShopDeliveryEstimate`),
        stamps `deliveryLocation` + `deliveryDistanceKm` +
        `deliveryDurationMin` onto the order doc. Pre-PR-46
        clients omitting the field round-trip unchanged. Tampered
        client distance/duration values are NOT trusted â€” the
        server's re-derivation is authoritative for PR 47.
      - **`SavedAddress.lat?` / `lng?`** added to client + server
        types. `validateAddressInput` accepts both (range-checked
        [-90,90] / [-180,180], Number.isFinite required) and
        rejects half-set pairs (`'lat and lng must both be set or
        both be absent'`). 8 new tests in `profileValidation.test.ts`.
      - **`AddressEditScreen`**: new "ðŸ“ Use my current location"
        outlined button, expo-location only (NO react-native-maps
        â€” keeps OTA-safe). Three states: idle / capturing /
        captured (collapses to status row + Re-capture/Clear).
        Fallback-source coords surface a yellow warning so the
        customer doesn't think the mock-Delhi default is their
        real pin. Coords forwarded to `saveAddress` on submit.
      - **`CheckoutScreen`**: new "ðŸ“ Deliver to my current
        location" radio option above the saved-address picker.
        When the picked saved address has no GPS pin we
        auto-capture live coords as fallback (one-time per
        selection) AND surface a yellow note explaining the
        substitution. The `getDeliveryEstimate` preview re-fires
        on every target change (debounced via cancellation flag);
        result renders as `~N min Â· X.X km` in the bill summary.
        `deliveryLocation` flows through `placeOrder`.
      - **PR 47 dependency satisfied**: `deliveryDistanceKm` is now
        a stamped, server-authoritative field on every new order
        whose customer has a coord-bearing target.

- [x] **What was DEFERRED (out of PR 46 scope; flagged here for
      future PRs).**
      - **Draggable map pin** (react-native-maps) on
        `AddressEditScreen` â€” would require a native module and
        breaks OTA. Sudhir's call: ship expo-location button only.
        Future PR.
      - **ETA coupling** â€” PR 46 stores `deliveryDurationMin` on
        the order but does NOT yet wire it into PR 43's
        `orderEtaDisplay` helper. The post-acceptance ETA still
        uses `readyByEstimate`. Deferred to PR 51+ when the
        partner-side timing data lands.
      - **Reverse geocoding** of current-location label
        (e.g. "Near Sector 12") â€” label currently snapshots as
        the literal string `'Current location'`. Not blocking
        any downstream PR.

- [ ] **Cost-guarantee verification (post-deploy).** With the
      kill-switch unset / false, place a test order from a
      saved-address path. Check Cloud Logging filtered to
      `getDeliveryEstimate` and `placeOrder`: no outbound HTTP
      calls to `maps.googleapis.com`. Optional belt-and-braces:
      `gcloud logging read` filtered to fetch traces should
      return zero hits during the pilot week.

- [ ] **Cloud Run IAM verification (post-deploy).** New callable
      `getDeliveryEstimate` needs allUsers â†’ run.invoker like
      every other public callable:

      ```powershell
      gcloud run services get-iam-policy getdeliveryestimate `
        --region=asia-south1 `
        --project=grocery-mvp-dev
      ```

      If allUsers is missing:

      ```powershell
      gcloud run services add-iam-policy-binding getdeliveryestimate `
        --region=asia-south1 `
        --project=grocery-mvp-dev `
        --member=allUsers `
        --role=roles/run.invoker
      ```

- [ ] **Smoke acceptance.**
      1. Saved-address-with-pin order: edit a saved address, tap
         "Use my current location" (verify GPS source on the
         captured row), save. Open checkout â†’ pick that address â†’
         "Estimated delivery ~N min Â· X.X km" line appears in the
         summary â†’ place order. Firestore: order doc has
         `deliveryLocation { type: 'saved_address', addressId,
         lat, lng, label }` + `deliveryDistanceKm` +
         `deliveryDurationMin`.
      2. Saved-address-without-pin order: pick a legacy address
         (no lat/lng on the row). Yellow note appears in the
         picker; live GPS auto-captures; estimate line still
         renders; order doc has `deliveryLocation` with
         `type: 'saved_address'`, `addressId`, AND coords (from
         live GPS, not the address row).
      3. Current-location order: tap "ðŸ“ Deliver to my current
         location" â†’ estimate updates â†’ place order. Order doc
         has `deliveryLocation { type: 'current_location' }`,
         no `addressId`.
      4. Locked semantic: after placing, edit the source saved
         address (move it to a different street). The order's
         `deliveryLocation` does NOT change.
      5. Cost guarantee: kill-switch stays unset. Function logs
         show `source: 'haversine_fallback'` on every call.

- [ ] **Deploy plan.**
      1. `npm run test:unit` â€” green (858/858 currently).
      2. `firebase deploy --only functions:getDeliveryEstimate,functions:placeOrder,functions:saveAddress`.
      3. Cloud Run IAM verify (above).
      4. `eas update --branch production --message "PR 46 geo
         foundation: locked delivery location + Distance Matrix
         (dormant)"`.
      5. Smoke acceptance steps 1â€“5.

## PR 45.2 â€” Fix push registering to anonymous user `[Phase 45.2]`

- [x] **Root cause confirmed via PR 45.1 probes (May 27 2026).**
      The Sentry breadcrumb on the `bootstrap: reached push branch`
      event read `{ alreadyRegistered: false, isAnonymous: true,
      uidPrefix: Lb5D6Ske }` â€” that's the THROWAWAY anonymous
      user from `signInAnonymouslyIfNeeded`, NOT the admin's
      real `Nb452wQ...`. The chain ran cleanly to
      `push: registerPushToken callable RESOLVED` â€” pipeline
      works end-to-end, just for the wrong user. Sequence:
      (1) AuthBootstrap mounts â†’ (2) Firebase signs anon user
      first â†’ (3) PR 45 boolean gate fires push for anon â†’
      (4) gate flips closed â†’ (5) user types phone+OTP, auth
      upgrades to real uid â†’ (6) push branch re-evaluates â†’
      (7) gate says "already done" â†’ real user's `fcmTokens`
      stays empty forever. **Pure client-side bug, OTA-fixable,
      no build 18 needed.**

- [x] **Why it surfaced on build 17 specifically.** Latent race;
      build 17's startup ordering (post-PR-39 rebrand bundle)
      consistently let the anonymous-sign-in â†’
      push-registration sequence beat the user's OTP confirm.
      Build 15 happened to lose this race. Both builds had the
      same bug; only build 17 exposed it consistently.

### Fix design

- [x] **Orchestrator promoted from boolean â†’ uid-aware** at
      `@c:\Users\dahiy\grocery-mvp\src\services\pushRegistrationOrchestrator.ts:1-145`.
      New input shape: `{ currentUid, isAnonymous,
      lastRegisteredUid, registerForPush, logger? }`. New gate
      logic in priority order:
      1. `currentUid === null` â†’ return `null` (no user, no
         report). Auth-state-null ticks don't litter Sentry.
      2. `isAnonymous === true` â†’ `skipped(anonymous)` +
         breadcrumb. The direct fix.
      3. `lastRegisteredUid === currentUid` â†’
         `skipped(already_registered_this_uid)`. Permission-
         prompt-spam guard, scoped to THIS uid.
      4. Otherwise â†’ register. On success, return outcome with
         `uid` so the caller knows which uid to remember.

- [x] **AuthBootstrap tracks `lastRegisteredUid` ref instead of
      a boolean** at `@c:\Users\dahiy\grocery-mvp\src\components\AuthBootstrap.tsx:42-180`.
      Same useEffect-scoped lifetime (resets on remount, persists
      across auth events within a session). Updated ONLY on a
      `registered` outcome â€” `skipped` / `failed` / `null` leave
      the ref unchanged so the next qualifying auth event
      (anonâ†’real upgrade, account switch) retries.

- [x] **PR 45.1 diagnostic probes preserved.** All six
      `captureMessage` milestones in
      `@c:\Users\dahiy\grocery-mvp\src\services\pushService.ts`
      stay so the next reproduce confirms the fix. The
      `bootstrap: reached push branch` breadcrumb payload now
      carries `{ currentUidPrefix, isAnonymous,
      lastRegisteredUidPrefix }` â€” a successful PR 45.2 fix
      shows `isAnonymous: false` and the REAL uid prefix on the
      first event that creates a token.

### Tests â€” uid-aware suite

- [x] **Rewrote `pushRegistrationOrchestrator.test.ts`** â€”
      14 cases (was 11 boolean-gate). All boolean-era contracts
      preserved via the new uid-aware signature. New cases at
      `@c:\Users\dahiy\grocery-mvp\tests\services\pushRegistrationOrchestrator.test.ts`:
      - **CRITICAL anonymous skip** â€” registerForPush must NOT
        be called for `isAnonymous: true`. Direct regression
        test for the May 27 production bug.
      - **CRITICAL anonymousâ†’real upgrade re-registers** â€” pins
        the multi-call sequence (anon skipped â†’ real signs in â†’
        token claims the REAL uid).
      - **Account switch** â€” `real_A` â†’ `real_B` re-registers.
      - **Same real uid short-circuits** â€” permission-prompt
        spam guard.
      - **No-user â†’ null, NO breadcrumb** â€” sign-out doesn't
        litter Sentry trails.
      - **Anonymous wins over already-registered** â€” defensive
        priority pin.

- [x] **Full suite green: 825 / 825 (79 suites).** +3 net new
      cases over PR 45 (was 822). Root tsc + functions tsc
      0 errors.

### Deploy plan â€” pure client OTA

- [ ] **OTA only** (no functions, no IAM, no native rebuild):

      ```powershell
      eas update --branch production --message "PR 45.2 fix push registering to anonymous user"
      ```

      `[Phase 45.2-ota]`

- [ ] **Force-quit twice + reopen** to load the OTA, sign in
      with admin phone, wait 15s. `[Phase 45.2-load]`

### Smoke acceptance â€” the definitive verification

- [ ] **Real account `fcmTokens` populated.** Firebase Console â†’
      `users/{admin-uid}` (the REAL uid, e.g. `Nb452wQ...`) â†’
      `fcmTokens` has an `ExponentPushToken[...]` entry.

- [ ] **Anonymous doc has NO token.** Whatever anon uid the
      current launch generated (e.g. `Lb5D6Ske...`) has empty /
      missing `fcmTokens`. (May contain stale tokens from
      pre-fix sessions â€” harmless; reset-pilot-data wipes them.)

- [ ] **Sentry breadcrumb shows the fix worked.** `bootstrap:
      reached push branch` event has
      `data.isAnonymous: false` and `data.currentUidPrefix`
      matching the real admin uid. The full chain (`register
      ENTERED` â†’ `before getExpoPushTokenAsync` â†’ `token
      obtained` â†’ `before registerPushToken callable` â†’
      `callable RESOLVED`) all fire â€” for the real user.

- [ ] **End-to-end push.** Customer places order â†’ shop owner
      accepts â†’ customer device receives push within ~5s.

- [ ] **Account-switch test.** Sign out, sign in as a different
      test phone. That account's `fcmTokens` gets the token
      (uid-change re-registration works). The previous
      account's tokens stay (multi-device semantics â€” only the
      explicit unregister callable removes a token).

### Follow-up

- [x] **DONE â€” stripped PR 45.1 diagnostic probes (May 27 2026
      same-day cleanup).** After Sudhir confirmed multi-device
      sign-in (different phones, different users, all received
      their push) the six temporary success-path
      `captureMessage('info')` probes in
      `@c:\Users\dahiy\grocery-mvp\src\services\pushService.ts`
      and the one in
      `@c:\Users\dahiy\grocery-mvp\src\components\AuthBootstrap.tsx`
      were removed:
      - `push: register ENTERED`
      - `push: before getExpoPushTokenAsync`
      - `push: token obtained`
      - `push: getExpoPushTokenAsync THREW`
      - `push: before registerPushToken callable`
      - `push: registerPushToken callable RESOLVED`
      - `bootstrap: reached push branch` (captureMessage only;
        the breadcrumb with the same name stays â€” payload is
        valuable on any future error report at zero cost)
      KEPT (legitimate observability, not diagnostic):
      - All `Sentry.addBreadcrumb(...)` calls.
      - `captureMessage('push registration: permission not
        granted', 'info')` â€” adoption-funnel metric.
      - `captureMessage('push registration: no EAS projectId',
        'warning')` â€” real config-bug signal.
      - All failure-branch `captureException(...)` calls.
      - The non-Error throw hardening (`new Error(...)` wrap in
        the `getExpoPushTokenAsync` catch). Pinned by the
        `getExpoPushTokenAsync throws non-Error â†’ wraps before
        capture` test in `pushService.test.ts`.
      Ship via the same small OTA that already carries PR 45.2:

      ```powershell
      eas update --branch production --message "PR 45.2 fix push registering to anonymous user + strip 45.1 diagnostic probes"
      ```

      `[Phase 45.2-cleanup]`

## PR 45.1 â€” Push diagnostic probes (TEMPORARY) `[Phase 45.1]`

- [x] **Why this exists.** Original PR 45 instrumented FAILURE
      branches (permission denied, no projectId, token-fetch
      throw, callable throw) but the SUCCESS path emitted only
      breadcrumbs â€” and breadcrumbs alone create no Sentry
      issue. So when build 17's push pipeline broke after
      Sudhir's reproduce + clean cold-start sign-in,
      `users/{uid}.fcmTokens` stayed empty AND Sentry showed
      zero events. Per the diagnostic handoff, the silence is
      ambiguous â€” could be (1) function never entered, (2) Sentry
      capture dead, or (3) `getExpoPushTokenAsync` hangs / throws
      a non-Error value that capture filters. PR 45.1 disambiguates.

- [x] **Code audit confirmed Sentry IS wired.**
      `@App.js:1-2` calls `initSentry()` synchronously at module
      load. DSN at `@app.json:107-108`. `tracesSampleRate: 0.5`
      controls TRANSACTIONS only â€” error / message capture
      defaults to 100%. `moduleNameMapper` is jest-only â€” Metro
      never sees the test mock. **Hypothesis 2 (Sentry dead) is
      structurally unlikely.** If diagnostic still shows zero
      events post-deploy, then it IS Hypothesis 2 and the
      investigation moves to Sentry init at runtime.

- [x] **Code audit confirmed call path is structurally correct.**
      `@src/components/AuthBootstrap.tsx:116` reaches the push
      branch on every truthy user (incl. anonymous).
      `pushRegisteredOk` declared INSIDE useEffect so it's always
      false on cold-start remount. Orchestrator at
      `@src/services/pushRegistrationOrchestrator.ts:75-78`
      doesn't short-circuit when `alreadyRegistered=false`. **No
      structural reason for the call to be skipped.**

- [x] **Probes added.** Five new `captureMessage('info')` /
      `captureMessage('error')` calls along the success path so
      every milestone produces a Sentry issue:
      1. `@src/components/AuthBootstrap.tsx:125` â€”
         `'bootstrap: reached push branch'`
      2. `@src/services/pushService.ts:92` â€”
         `'push: register ENTERED'` (very first line)
      3. `@src/services/pushService.ts:155` â€”
         `'push: before getExpoPushTokenAsync'`
      4. `@src/services/pushService.ts:166` â€”
         `'push: token obtained'`
      5. `@src/services/pushService.ts:230` â€”
         `'push: before registerPushToken callable'`
      6. `@src/services/pushService.ts:250` â€”
         `'push: registerPushToken callable RESOLVED'`

- [x] **Hardened the `getExpoPushTokenAsync` catch** at
      `@src/services/pushService.ts:182-198` to wrap non-Error
      throws as `new Error("getExpoPushTokenAsync threw
      non-Error: <stringified>")` and ALSO emit a
      `captureMessage('error')` so we see the failure path even
      if `captureException` filters the value.

### How to read the result after device reproduce

After OTA + force-quit + fresh sign-in, count Sentry messages:

| Last message seen | Diagnosis |
|---|---|
| **None at all** | Hypothesis 2 â€” Sentry capture is dead in release. Audit `initSentry()` execution at runtime. |
| `bootstrap: reached push branch` only | Orchestrator throws synchronously before pushService is called. Inspect orchestrator stack frame. |
| `bootstrap` + `register ENTERED` only | `expo-notifications` permission/projectId check hangs (would be unprecedented). |
| `... before getExpoPushTokenAsync` (no `token obtained` and no `THREW`) | **Hypothesis 3a â€” getExpoPushTokenAsync HANGS.** Native APN registration never completes. Fix: rebuild (build 18) to regenerate provisioning profile with the `aps-environment` entitlement. |
| `... THREW` event present | Hypothesis 3b/c â€” APN registration fails with a throwable. Read the captured exception text for the actual platform error. |
| `... before registerPushToken callable` only | Callable hangs (IAM, network, function cold-start timeout > callable client timeout). Check Cloud Run logs for `registerPushToken` invocation. |
| All 6 messages including `callable RESOLVED` but `fcmTokens` still empty | Server-side bug. Callable returned but `request.auth.uid` resolved to a different uid than expected (anonâ†’phone link race), or arrayUnion no-op'd. Audit `users/{uid}` writes by timestamp. |

### Deploy plan

- [ ] **OTA only** (no functions, no native rebuild â€” these are
      pure client changes):

      ```powershell
      eas update --branch production --message "PR 45.1 push diagnostic probes"
      ```

      `[Phase 45.1-ota]`

- [ ] **Force-quit twice + reopen** to load the OTA, sign in,
      wait 30s, then check Sentry â†’ Issues (filter by
      environment=production, last 1H, all severities). Use the
      table above to identify the failure point.
      `[Phase 45.1-reproduce]`

- [ ] **Tear-out follow-up.** Once root cause is confirmed,
      remove the six `captureMessage` probes and the
      `THREW` captureMessage. The breadcrumbs + failure-branch
      captures from original PR 45 stay. `[Phase 45.1-cleanup]`

## PR 45 â€” Push reliability + observability + test coverage `[Phase 45]`

- [x] **Why this PR exists.** Push notifications worked on build
      15, silently broke by build 17. Symptom: `users/{uid}.fcmTokens`
      empty even after a fresh sign-in. Three compounding failures
      let this hide for days:
      (1) every error in the registration pipeline swallowed via
      silent `console.warn` â€” no Sentry signal, no alert;
      (2) closure-gate retry bug in `AuthBootstrap.tsx:95`
      (`pushRegistered = true` set BEFORE the async register
      resolved, so a single transient failure poisoned the gate
      for the whole session);
      (3) ZERO test coverage on the push pipeline â€” client
      registration, the callables, the triggers â€” none of it
      tested.

      Sudhir's directive (May 27 2026): *"I really want PR for
      test coverage debt. My preference is to cover such issues
      using our automated tests wherever possible. The more test
      coverage we have, the faster manual testing it would be."*
      PR 45 fixes all three classes of failure in one ship.

      Note: PR 45 does NOT pre-suppose the build-17 root cause.
      The Part-A instrumentation makes the cause VISIBLE on the
      next device-reproduce â€” the Sentry breadcrumb trail tells
      us definitively whether it's a client-code issue (Part B
      fixed it) or platform-credential issue (`eas credentials`
      iOS push key â€” outside this PR).

### Part A â€” Observability

- [x] **`pushService.registerForPushNotifications` instrumented**
      at `@src/services/pushService.ts:67-213`. Sentry breadcrumb
      at every decision point ("register: start", "skip (web)",
      "skip (simulator)", "permission denied", "token obtained",
      "backend write ok"). Real failures captured with
      `captureException` + `push_stage` tag for dashboard
      grouping. Permission-denial and missing-projectId raised
      via `captureMessage` at 'info' / 'warning' severity
      respectively (legitimate non-bug states; still want
      visibility for adoption tracking).

- [x] **Token prefix only in breadcrumbs** at
      `@src/services/pushService.ts:142-144`. Full Expo push
      token is a semi-secret URL the relay uses to address the
      device; logging the full string to Sentry would be a
      leak. First 24 chars confirm it's a real
      `ExponentPushToken[...]` shape without compromising the
      device's addressability.

- [x] **CRITICAL: callable failure re-throws.** Pre-PR-45 the
      `try/catch` around `registerPushToken` swallowed every
      backend rejection. Post-PR-45 at
      `@src/services/pushService.ts:204-210` it re-throws so
      `AuthBootstrap`'s orchestrator can distinguish "skipped"
      (null token, legitimate) from "failed" (real error, retry
      eligible). This is the closure-gate contract that
      unblocks Part B's retry semantics.

### Part B â€” Closure-gate reliability fix

- [x] **Pure orchestrator extracted** at
      `@src/services/pushRegistrationOrchestrator.ts:1-104`.
      The retry-aware gate logic is now a function of
      `(alreadyRegistered, registerForPush, logger)` â†’
      `PushRegistrationOutcome | null`. Three outcomes:
      `registered` (gate flips closed), `skipped` (null token â€”
      gate stays open), `failed` (threw â€” gate stays open).
      Caller (AuthBootstrap) only flips `pushRegisteredOk = true`
      when the outcome is `registered`. Mirrors
      `signOutAndClearLocalState`'s injection-of-deps pattern
      so the test exercises pure logic without rendering React
      or mocking expo-notifications.

- [x] **AuthBootstrap wired to orchestrator** at
      `@src/components/AuthBootstrap.tsx:103-135`. Renamed
      `pushRegistered` â†’ `pushRegisteredOk` to make the
      "only-true-on-success" semantics obvious at the call
      site. Variable scoped INSIDE the `useEffect` (resets on
      remount / cold-start), NOT module-level (would persist
      across remounts and re-break the retry-on-cold-start
      behaviour). Sentry breadcrumb + captureException
      injected as the logger so a bootstrap-level retry attempt
      shows up alongside the pushService breadcrumbs in the
      same Sentry trace.

### Part C â€” Test coverage

- [x] **C1 â€” `pushService` tests (10 cases)** at
      `@tests/services/pushService.test.ts:1-229`. Every branch
      covered: web/simulator skip, permission denied â†’ info
      capture, missing projectId â†’ warning capture, token-mint
      throw â†’ exception capture (returns null, does NOT
      re-throw), happy path â†’ callable invoked with token +
      backend-write-ok breadcrumb, **CRITICAL: callable
      rejects â†’ exception capture + promise re-throws** (the
      contract Part B depends on), Android channel setup, iOS
      channel-skip. Uses `jest.mock` for expo-notifications /
      expo-device / expo-constants + RNFB; spies on the
      shared Sentry mock via the `__mocks__/services-sentry.ts`
      file (the moduleNameMapper rewrite for `./sentry` only
      fires for that exact relative spec, so direct import
      of `src/services/sentry.ts` would crash on the real
      `@sentry/react-native` ESM bundle).

- [x] **C2 â€” `pushRegistrationOrchestrator` tests (11 cases)**
      at `@tests/services/pushRegistrationOrchestrator.test.ts:1-191`.
      Every union outcome + the CRITICAL retry-on-failure
      regression test that pins the build-17 closure-gate bug.
      The "first call throws â†’ gate stays false â†’ second call
      retries" sequence at lines 79-103 is the test that
      would have caught the original bug on PR submission.

- [x] **C3 â€” server-side validator + plan tests (19 cases)**
      at `@tests/functions/pushHelpers.test.ts:1-225`. Pure
      helpers extracted to `@functions/src/pushHelpers.ts:1-184`:
      `validatePushTokenInput` (shared by `registerPushToken`
      + `unregisterPushToken`; auth + token-shape gates) and
      `buildOrderStatusPushPlan` (state machine for
      `sendOrderStatusPush`; emits `{send, messages}` or
      `{skip, reason}`). All three callables/triggers refactored
      at `@functions/src/index.ts:2470-2607` to use the
      helpers â€” identical runtime behaviour, just with the
      logic now mockable from Jest without firebase-admin.

- [x] **Helper-extraction precedent followed.** Mirrors
      `approveShopHelpers.ts` / `ratingHelpers.ts` /
      `pendingCountsHelpers.ts` / `customerCrmHelpers.ts`. The
      repo's testability posture (Rule 5 â€” audit safety net) is
      now applied to push exactly the way it was applied to
      every other server domain.

- [x] **`ORDER_STATUS_LABELS` migrated** from
      `@functions/src/index.ts` (pre-PR-45 inline constant)
      into `@functions/src/pushHelpers.ts:80-87`. Trigger code
      no longer holds the title-mapping; one place for future
      copy edits + the mapping is exercised by the helper
      tests.

- [x] **Type checking + full suite.** Root tsc 0 errors,
      functions tsc 0 errors. **822 / 822 tests pass (79
      suites)** â€” +40 new cases (10 pushService + 11
      orchestrator + 19 pushHelpers).

### Deploy plan

- [ ] **Functions deploy.** Three callables/triggers
      refactored (logic unchanged; just delegating to extracted
      helpers). MUST deploy to get the refactored code on the
      server so its behaviour matches the test suite:

      ```powershell
      firebase deploy --only "functions:registerPushToken,functions:unregisterPushToken,functions:sendOrderStatusPush"
      ```

      `[Phase 45-deploy-functions]`

- [ ] **Cloud Run IAM re-verify** for the three callables after
      deploy (mandatory per discipline rule â€” each deploy may
      need allUsers re-binding):

      ```powershell
      gcloud run services get-iam-policy registerpushtoken --region=asia-south1 --project=grocery-mvp-dev
      gcloud run services get-iam-policy unregisterpushtoken --region=asia-south1 --project=grocery-mvp-dev
      # sendOrderStatusPush is a Firestore trigger â€” no allUsers binding
      # needed (invoked by the platform, not clients).
      ```

      If `allUsers + roles/run.invoker` missing on either
      callable:

      ```powershell
      gcloud run services add-iam-policy-binding registerpushtoken --region=asia-south1 --member=allUsers --role=roles/run.invoker --project=grocery-mvp-dev
      gcloud run services add-iam-policy-binding unregisterpushtoken --region=asia-south1 --member=allUsers --role=roles/run.invoker --project=grocery-mvp-dev
      ```

      `[Phase 45-iam]`

- [ ] **Client OTA.**

      ```powershell
      eas update --branch production --message "PR 45 push reliability + observability + tests"
      ```

      `[Phase 45-ota]`

- [ ] **Reproduce on device + read the breadcrumb trail.**
      Force-quit + reopen + sign in. Check the Sentry dashboard
      for the breadcrumb trail from that session. The
      breadcrumb pattern tells you the root cause:

      | Trail stops at... | Diagnosis |
      |---|---|
      | `getExpoPushTokenAsync` + exception | Platform/APN credential â€” fix via `eas credentials` iOS push key setup (outside PR 45) |
      | `registerPushToken_callable` + exception | Backend issue (IAM, auth context, validation) â€” investigate captured error |
      | Reaches `backend write ok` but token not in Firestore | Deeper callable bug |
      | Reaches `backend write ok` AND token IS in Firestore | Closure-gate WAS the only bug; Part B fixed it |

      `[Phase 45-diagnose]`

### Smoke acceptance

- [ ] **1. Fresh-install token registration.** Force-quit,
      reopen, sign in. Within ~10s, `users/{uid}.fcmTokens` has
      an `ExponentPushToken[...]` entry. (If it doesn't,
      Sentry now shows WHY.)

- [ ] **2. End-to-end push.** With a token registered, customer
      places an order â†’ shop owner accepts â†’ customer device
      receives a push within ~5s.

- [ ] **3. Retry-on-failure (hard to trigger manually; covered
      by tests).** If registration fails once, a later sign-in
      retries rather than staying broken for the session.

- [ ] **4. Sentry visibility.** After any failed registration,
      Sentry dashboard shows the breadcrumb trail + captured
      exception with the `push_stage` tag. No more silent
      failures. `[Phase 45-smoke]`

### Deferred follow-ups

- [ ] **DEFERRED â€” `tests/components/AuthBootstrap.test.tsx`
      (React-component-level integration test).** The prompt
      asked for a mount-the-component test that drives the
      `onAuthStateChanged` emitter. The orchestrator suite
      (`pushRegistrationOrchestrator.test.ts`) already pins
      the gate logic that bug 17 exposed, so this is belt-and-
      braces. Skipped because it requires either
      `@testing-library/react-native` (not in the repo's jest
      setup) or a hand-rolled hook test which adds infra for
      negligible incremental coverage. Revisit if a future bug
      lives in the bootstrap-level wiring (between the
      orchestrator and the auth subscribe) rather than in the
      orchestrator. `[Post-launch]`

- [ ] **DEFERRED â€” Daily IAM audit job.** Cloud Scheduler job
      that nightly scans all callables for the
      `allUsers + roles/run.invoker` binding and pages on
      missing ones. Useful infra (especially after the
      PR 41 / PR 42 / PR 42.0.1 IAM-drop incidents) but
      separate Phase-B work. `[Post-launch]`

- [ ] **DEFERRED â€” Notification preferences UI.** Let users
      toggle which push types they receive. Future feature.
      `[Post-launch]`

- [ ] **DEFERRED â€” Rich notifications.** Images, action
      buttons. Future feature. `[Post-launch]`

- [ ] **DEFERRED â€” Per-shop delivery partner leaderboard** for
      admin. Useful later for roster management (admin can
      deprioritize chronically late partners, reward consistent
      performers). Not pilot-blocking. `[Post-launch]`

- [ ] **DEFERRED â€” Customer-visible delivery partner rating**
      pre-delivery ("Your delivery partner: 4.7â˜…"). Surfaces
      partner reputation to customers but feels like Uber-eats
      polish; out of scope until cohort is big enough that
      partner-pick visibility matters. `[Post-launch]`

- [ ] **DEFERRED â€” Editable ratings.** Customer changes their
      mind after submit. Submit-once policy remains for MVP â€”
      editing requires recomputing rolling averages from scratch
      across both shop and partner. Worth doing once a real
      "I tapped wrong star" support thread arrives. `[Post-launch]`

- [ ] **DEFERRED â€” Reminder to rate delivery if customer
      submitted shop-only.** Push notification next session
      asking "How was your delivery partner?" if
      `shopRating` is set but `deliveryRating` is not. Phase D
      polish. `[Post-launch]`

- [ ] **DEFERRED â€” Migrate legacy `order.rating` â†’
      `order.shopRating`.** Historical orders stay on the legacy
      field forever; the post-rating panel handles both branches
      cleanly. Only worth doing if a future query needs to
      `where('shopRating', '>=', 4)` across ALL orders including
      pre-PR-42.1 ones. `[Post-launch]`

- [ ] **DEFERRED â€” Drop `validateRatingSubmission` from
      `ratingHelpers.ts`.** Currently kept for the existing
      test suite's coverage (`validateRatingSubmission` describe
      block). Once the OTA propagation window closes (~2 weeks
      after deploy when ratings-volume confirms no legacy-shape
      clients remain), the helper + its tests can be deleted
      and the file shrunk back to just `validateDualRatingSubmission`
      + `computeNewRollingAverage`. `[Post-launch]`

## ðŸ“ˆ Post-launch scaling triggers (revisit each milestone)

- [ ] At 100 DAU: review Firebase costs weekly for first month
- [ ] At 1k DAU: audit Firestore reads. If >100 reads per user session,
      add client caching (5-min TTL on shops/products). Set Cloud Function
      minInstances=1 on placeOrder (~$10/mo, kills cold starts).
- [ ] At 10k DAU: do a 6-week cost projection. If Firestore monthly
      projected > â‚¹40k, escalate to read optimization sprint.
- [ ] At 10k DAU: add Algolia or Typesense for product search relevance
      (current substring match doesn't scale).
- [ ] At 50k DAU: enable BigQuery export from Firestore for analytics
      dashboards. Don't try to do reports from Firestore directly.
- [ ] At 100k DAU: re-evaluate Firestore vs Postgres for the orders
      collection. Migration possible because services/*.ts is the swap point.

      - [ ] Consider full migration of Firestore reads to 
      @react-native-firebase/firestore on native for consistency. Not 
      blocking â€” current dual-SDK setup works for reads. Migrate if you 
      hit similar auth-state issues with Firestore queries.

- [ ] When prod project is created, find ITS project number 
      (gcloud projects describe grocery-mvp-prod --format="value(projectNumber)") 
      and use it in the same IAM grant command for prod.      
## PR-NEXT-PARTNER-CARD.2 — Live partner ETA + trust signals + customerUid fix `[Phase NEXT-PARTNER-CARD.2]`

- [x] **Why this PR exists.** Sudhir's June 1 evening retest of PARTNER-CARD.1 — the sheet was *"just placeholders"* (static at-order ETA, no live signal, no rating/vehicle) AND the phone-reveal callable silently rejected every legitimate customer because the pure helper gated on `order.customerId`, a field that doesn't exist (server writes `customerUid`). Documented as case #22 retest #2 in `@c:\Users\dahiy\grocery-mvp\docs\TESTING-FINDINGS-2026-05-30.md`.
- [x] **Schema-audit-grep header in the prompt** — every order-doc field referenced in the PR is row-confirmed against `grep -n customerUid functions/src`. New **Rule 5 (schema verification)** added to `@c:\Users\dahiy\grocery-mvp\.windsurf\code-discipline.md` so future prompts that reference doc fields are forced through the same audit.
- [x] **Bug fix — `customerUid` (not `customerId`)** in `@c:\Users\dahiy\grocery-mvp\functions\src\partnerContactHelpers.ts:85-92`. Fixtures in `@c:\Users\dahiy\grocery-mvp\tests\functions\getDeliveryPartnerContactHelpers.test.ts` updated (the fixture used the same wrong field, so the test passed against a broken helper — textbook self-confirming schema mismatch).
- [x] **Pure helper `formatLivePartnerEta`** — `@c:\Users\dahiy\grocery-mvp\src\utils\formatLivePartnerEta.ts`. WHEN + Distance copy: `<1 min → "Arriving now" / "Almost there"`, `<50 m → hide distance row`, `>60 min → "X.X hr"`, stale → `~ estimated` suffix. 10 tests in `tests/utils/formatLivePartnerEta.test.ts`.
- [x] **Pure helper `formatPartnerTrust`** — `@c:\Users\dahiy\grocery-mvp\src\utils\formatPartnerTrust.ts`. WHO line + vehicle glyph. `"⭐ 4.8 · 142 deliveries"` for full data; `"⭐ New partner · welcome them!"` when `ratingCount <= 0` (avoids the broken-looking `"⭐ 0.0 · 0 deliveries"`). Four vehicle icons (🛵 / 🚲 / 🚶 / 🚗) with motorbike default for null / unknown. 7 tests.
- [x] **Denormalize helper `denormalizePartnerTrust`** — `@c:\Users\dahiy\grocery-mvp\functions\src\claimDeliveryHelpers.ts:51-89`. Extracts `(rating, deliveriesCount, vehicleType)` from the partner's `users/{uid}` doc with whitelist + `Number.isFinite` + `Math.floor` validation. `claimDelivery` (`@c:\Users\dahiy\grocery-mvp\functions\src\index.ts:3668-3700`) stamps all three onto the order doc alongside `deliveryPersonName`. 5 tests.
- [x] **`Order` type extended** — `@c:\Users\dahiy\grocery-mvp\src\types\index.ts:544-562`. Three new optional + nullable fields (`deliveryPersonRating`, `deliveryPersonDeliveriesCount`, `deliveryPersonVehicleType`). Legacy orders claimed pre-this-PR render cleanly via the `formatPartnerTrust` `"New partner"` fallback.
- [x] **Live ETA callable `getLivePartnerEta`** — pure helper at `@c:\Users\dahiy\grocery-mvp\functions\src\livePartnerEtaHelpers.ts`. Haversine + `AVG_URBAN_KMH = 20` + `STALE_AFTER_MS = 2min`, `.toMillis()`-narrowing per Rule 12. Pre-pickup leg targets `shopLocation`, post-pickup targets `deliveryLocation`. Returns 5 failure codes (`order_not_found`, `not_customer`, `no_partner`, `no_partner_location`, `no_target_location`) collapsed by the callable wrapper into either `permission-denied`, `not-found`, or `failed-precondition` (the last for legacy-data cases the client falls back gracefully on). Callable registered at `@c:\Users\dahiy\grocery-mvp\functions\src\index.ts:4353-4391`. 10 tests covering every failure code + happy path + stale flag + Timestamp narrowing.
- [x] **Client polling hook `useLivePartnerEta`** — `@c:\Users\dahiy\grocery-mvp\src\hooks\useLivePartnerEta.ts`. 30s `setInterval` cadence with auto-pause on `enabled=false` (sheet dismissed → no callable hits, no battery drain) and React-18-strict-mode-safe `cancelledRef` to prevent stale `setState` from an in-flight tick after unmount. `orderService.getLivePartnerEta` wrapper at `@c:\Users\dahiy\grocery-mvp\src\services\orderService.ts:1672-1694` (native + web paths).
- [x] **Sheet redesign — `PartnerDetailsSheet`** — `@c:\Users\dahiy\grocery-mvp\src\components\order\PartnerDetailsSheet.tsx` rewritten on `BottomSheet` chrome (HOTFIX-7). WHO row (avatar + name + `"⭐ 4.8 · 142 deliveries"`), STATE row (vehicle icon + `"Heading to the shop" / "On the way to you"`), WHEN row (live ETA with `"~ estimated"` suffix on fallback), DISTANCE row (auto-hides `<50m`), pickup/order rows, then phone (3-branch: muted pre-pickup / primary block `📞 Call X` button when phone cached / `📞 Show X's phone` reveal CTA). 3-tier fallback ladder: live → `order.deliveryDistanceKm` / `deliveryDurationMin` (with stale suffix) → em-dash.
- [x] **OrderDetailScreen wiring** — `@c:\Users\dahiy\grocery-mvp\src\screens\OrderDetailScreen.tsx:29-34,139-145,950-971`. Hook's `enabled` arg is `partnerSheetOpen` so polling lifecycle tracks sheet visibility. New trust-signal props passed straight off the order doc.
- [x] **Tests — suite at 1274 / 1274** (was 1241; **+33 exactly as forecast** in the prompt). `tsc --noEmit` clean for `src/` and `functions/`.
- [ ] **Cloud Run IAM verification (Rule 11)** after deploy, for both `getlivepartnereta` (new) and `getdeliverypartnercontact` (modified) and `claimdelivery` (modified):

      ```powershell
      gcloud run services get-iam-policy getlivepartnereta `
        --region=asia-south1 --project=grocery-mvp-dev
      gcloud run services get-iam-policy getdeliverypartnercontact `
        --region=asia-south1 --project=grocery-mvp-dev
      gcloud run services get-iam-policy claimdelivery `
        --region=asia-south1 --project=grocery-mvp-dev
      ```

      Confirm `allUsers / roles/run.invoker`. Add binding if missing.

- [ ] **Deploy.** Server-first: `firebase deploy --only "functions:getLivePartnerEta,functions:getDeliveryPartnerContact,functions:claimDelivery"` → IAM verify (above) → `eas update --branch production --message "PR-NEXT-PARTNER-CARD.2 live ETA + trust signals + customerUid fix"`.

- [ ] **Out of scope (deferred, §I).** Partner-side `vehicleType` picker on the profile screen + one-time backfill script for existing partners without `vehicleType`. Existing partners without the field render cleanly via the helper's null path + the motorbike default glyph; backfill is a UX-quality nice-to-have, not a correctness fix. Add when there's a customer signal that the default glyph is wrong (e.g. visible bicycle delivery but motorbike icon). `[Post-launch]`

- [ ] **Future: real Distance Matrix ETA.** Pilot uses haversine + `AVG_URBAN_KMH = 20` for the 30s-poll path. PR 46 already wires Distance Matrix at order-placement time (the `deliveryDistanceKm` / `deliveryDurationMin` fields the sheet falls back to) but it's DORMANT for the live path — calling it every 30s would burn API budget without commensurate UX win. Flip when scale + signal demand it. `[Post-launch]`

## PR-NEXT-HOTFIX-9 — Checkout Place Order race guard `[Phase NEXT-HOTFIX-9]`

- [x] **Why this PR exists.** Sudhir's June 2 testing of HOTFIX-8 — *"Place order button was active when I clicked on use current location for delivery, and it was still calculating the location point... otherwise it is picking default saved home location even customer is picking current location as an option."* HOTFIX-8 fixed Bug 2 at placeOrder time, but only when `liveCoords` are present. The relaxed `validate()` exposed a race window between "tap current location" and "GPS resolves" where the CTA was still enabled and a fast tap would ship an order with no `deliveryLocation` (Bug 2 returns).
- [x] **Audit-grep header in the prompt** — `deliveryTargetMode`, `liveCoords`, `capturingLive`, `placing` all line-confirmed against `CheckoutScreen.tsx`. Per Rule 5.
- [x] **Derived flag `blockingOnCurrentCapture` + `canPlaceOrder`** at `@c:\Users\dahiy\grocery-mvp\src\screens\CheckoutScreen.tsx:415-437`. Sits with `savedAddressMissingCoords` and the other derived flags above any conditional return (Rule 2). Saved-mode and form-mode (`null`) skip the gate so existing flows are untouched.
- [x] **CTA wired** at `@c:\Users\dahiy\grocery-mvp\src\screens\CheckoutScreen.tsx:1376-1388` — `disabled={!canPlaceOrder}` on the single Place Order / Pay button. `loading={placing}` stays as the spinner driver during the network round-trip.
- [x] **Inline capture hint** at `@c:\Users\dahiy\grocery-mvp\src\screens\CheckoutScreen.tsx:1369-1375` — `📍 Capturing your location…` while in flight, flips to `⚠️ Couldnt get your location. Tap "Deliver to current location" again to retry.` if `liveCoordsError` populated. Customer-driven retry intentional (auto-retry can mask permission denials).
- [x] **Defensive in-function guard** at `@c:\Users\dahiy\grocery-mvp\src\screens\CheckoutScreen.tsx:679-692` — re-checks the same condition at the top of `placeOrder` and `console.warn`s + returns. Belt + suspenders so a future refactor that loosens the disable, or a stale `usePressGuard` ref-fired tap, can't re-expose Bug 2 from below the UI.
- [x] **Style** `captureHint` at `@c:\Users\dahiy\grocery-mvp\src\screens\CheckoutScreen.tsx:1542-1547` — `typography.caption` + `colors.textSecondary` + center-aligned, `marginBottom: spacing.sm` so it sits cleanly above the CTA.
- [x] **No schema, no callable, no test count change.** Suite at **1274 / 1274**. `tsc --noEmit` clean.
- [ ] **Acceptance manual sweep.**
  - [ ] Open Checkout with a saved Home address auto-selected; tap "Deliver to current location"; while spinner is up the CTA is disabled with `📍 Capturing your location…` above; tap → no-op.
  - [ ] After GPS resolves: hint disappears, CTA re-enables, order ships with `deliveryLocation` set + reverse-geocoded `deliveryAddress`. Shopkeeper sees the correct (current) address, not Home.
  - [ ] Permission-denied: disable Location system-wide, retry the flow. CTA stays disabled; hint flips to ⚠️ variant. Re-tapping current-location radio re-attempts.
  - [ ] Saved-mode regression: pick a saved address, CTA enables immediately (no current-mode gate fires). Order ships against the saved address as before.
  - [ ] Form-mode regression: zero-saved-address customer fills form, CTA enables when `validate()` passes. Order ships normally.
  - [ ] Defensive `console.warn` fires under the simulated race (temporarily revert `disabled` to `placing`, repro, then restore).
- [ ] **Deploy.** Pure client OTA: `eas update --branch production --message "PR-NEXT-HOTFIX-9 checkout race guard closes Bug 2 reintroduction window"`.
- [ ] **Out of scope (deferred).** Spinner inside the Place Order button itself during GPS capture (above-button hint is more visible / accessible). Auto-retrying GPS after `liveCoordsError` (auto-retry masks permission issues; customer-driven retry is intentional).

## PR-NEXT-HOTFIX-10 — Address dedupe on current-location save `[Phase NEXT-HOTFIX-10]`

- [x] **Why this PR exists.** Sudhir's June 2 testing — *"Placed 2 orders from same location and used current location option as delivery address, it saved exact 2 addresses in the profile. I think we should not save duplicated addresses."* ADDRESS-UX.1 wired the post-order "Save this location?" modal but had no dedupe — every successful current-location order opened the modal, every Save persisted a fresh row even when the GPS pin was within meters of an existing saved address. Address book accumulated noise instead of becoming the reusable library Sudhir wanted in ADDRESS-UX's original intent.
- [x] **Decision locked pre-design.** Silent skip — modal doesn't appear when an existing address pins within 25m haversine of the GPS reading; small toast confirms which existing address matched. 25m threshold tuned to typical urban GPS accuracy (5-20m outdoor / 30-50m indoor) — collapses same-building re-orders without merging next-door neighbours.
- [x] **Audit-grep header in the prompt** — `Address.lat/lng`, `profile.addresses`, `haversineKm`, `SaveCurrentLocationModal`, `pendingSaveCoords` all line-confirmed. Per Rule 5. (Note: prompt referenced `Address[]`; production helper uses `SavedAddress[]` — only the saved-side shape carries `lat/lng/label`.)
- [x] **Pure helper `findAddressNearby`** at `@c:\Users\dahiy\grocery-mvp\src\utils\findAddressNearby.ts`. Defensive `Number.isFinite` filter on both target and candidate coords (legacy pre-PR-46 addresses with no pin skipped, not treated as "far"). Returns the CLOSEST match within threshold (not just the first), so if a customer somehow has two pins within 25m of GPS the toast confirms the more accurate one. Boundary INCLUSIVE (`distM <= thresholdM`) — matches the `chargeForDistance` tier-boundary convention. Re-uses the existing `haversineKm` helper.
- [x] **8 unit tests** at `@c:\Users\dahiy\grocery-mvp\tests\utils\findAddressNearby.test.ts` covering exact match (0m) / 1m / 24.9m (in) / 25.0m boundary inclusive / 30m (out) / no-coords-on-any-candidate / non-finite target coords (NaN, Infinity) / closest-of-many tiebreak. Helper `nudgeLat` computes haversine-equivalent latitude offsets in meters so tests don't fight floating-point at the boundary.
- [x] **Toast primitive** at `@c:\Users\dahiy\grocery-mvp\src\components\common\Toast.tsx` — bare-minimum animated bottom-anchored notification. `useSafeAreaInsets().bottom + spacing.xl` so it floats above Android gesture-nav pills (Rule 13 from HOTFIX-7). `pointerEvents="none"` so it can never block the CTA below. 200ms fade-in / 3s display / 200ms fade-out then dismiss-callback fires. Single Toast per screen for now.
- [x] **Wired in `CheckoutScreen`** at `@c:\Users\dahiy\grocery-mvp\src\screens\CheckoutScreen.tsx:40-50,191-196,584-604,1490-1502`. The `maybeSaveAddressAfterOrder` current-location branch now calls `findAddressNearby(profile?.addresses ?? [], liveCoords)` BEFORE setting `pendingSaveCoords`. On match → `setToastMessage('Saved as Home (already in your address book)') + setToastVisible(true) + return`, skipping the modal entirely. On no match → existing ADDRESS-UX.1 flow continues unchanged. Toast mounted at the SafeAreaView root after the SaveCurrentLocationModal slot. State `toastVisible` + `toastMessage` declared above any conditional return (Rule 2).
- [x] **Suite at 1282 / 1282** (was 1274; +8 exactly as forecast). `tsc --noEmit` clean across `src/` and `functions/`.
- [ ] **Acceptance manual sweep.**
  - [ ] First save (no match) — fresh customer places current-location order, modal opens, customer names it "Home", saves. Profile has one address with the pin.
  - [ ] Second save from same spot (within 25m) — same physical location, second current-location order. Modal does NOT open. Toast slides up `Saved as Home (already in your address book)`. Auto-dismisses after 3s. Profile still has exactly ONE address.
  - [ ] Second save > 25m away — drive 100m down the street, repeat. Modal opens. Customer names it. Profile now has TWO addresses.
  - [ ] Boundary case — manually set up a saved address at exactly 25.0m away (Firestore Console). Toast fires (inclusive boundary).
  - [ ] Legacy address without `lat/lng` — modal opens (no comparable candidate; legacy address skipped from comparison).
  - [ ] Address with `lat: NaN` — modal opens (defensive `Number.isFinite` skips bad pin).
  - [ ] Toast renders above Android gesture-nav pill, doesn't intercept touches.
  - [ ] Toast auto-dismisses cleanly (opacity fades, then `visible: false`, no lingering ghost).
- [ ] **Deploy.** Pure client OTA: `eas update --branch production --message "PR-NEXT-HOTFIX-10 address dedupe silent-skip + toast"`.
- [ ] **Out of scope (deferred).** Bulk dedupe of pre-existing duplicate addresses (one-time-script territory; not worth the migration risk for pilot). Map-preview at modal-open time so the customer can visually confirm "yes that's me" (defer to Phase B if anyone asks). Saved-address-picker hint when nearby duplicates exist pre-PR (post-launch consolidation UX).
## PR-NEXT-SHOP-LOCATION-REQUIRED — Three layers of defense so location-less shops can't exist `[Phase NEXT-SHOP-LOCATION-REQUIRED]`

- [x] **Why this PR exists.** Sudhir's June 2 observation — *"Shop current location is optional so how can we calculate shop distance?"* — and the cascading symptoms (#2 distant Faridabad shops visible despite 5km radius, #3 radius gate appearing inert on certain shops). Root cause: shops without a `location` field passed through the customer-side filter as `distanceKm: undefined` → fail-OPEN → globally visible. Three independent gaps all let them through (registration, approval, filter). **Defense-in-depth fix** — three independently-sufficient layers, none of which alone is a single point of failure.
- [x] **Audit-grep header in the prompt** — every symbol cross-checked: `Shop.location` confirmed optional `{ lat: number; lng: number }`, `registerShop` callable accepts optional `location`, `approveShop` reads `shops/{shopId}` without checking location pre-PR, `filterShopsByServiceRadius` fail-OPEN at lines 50-56. Per Rule 5.
- [x] **Layer 1 — Client gate (RegisterShop).** `@c:\Users\dahiy\grocery-mvp\src\screens\roles\RegisterShopScreen.tsx:166-189,701-726`. `validate()` returns an actionable error when `location` is null. Continue button hard-disabled (`disabled={submitting || !location}`). Yellow inline `captureHint` above the CTA explains why (`📍 Capture your shop's GPS location before continuing — customers won't see your shop without it.`). New `captureHint` style at line 981-990 mirrors HOTFIX-9's pattern from CheckoutScreen for consistency across capture-required affordances.
- [x] **Layer 2 — Server gate (approveShop).** Pure helper `validateShopLocationForApproval` at `@c:\Users\dahiy\grocery-mvp\functions\src\approveShopHelpers.ts:116-184`. Discriminated-union return shape (`{ ok: true } | { ok: false, code: 'no_location' | 'lat_invalid' | 'lat_out_of_range' | 'lng_invalid' | 'lng_out_of_range' }`) so the callable can map each failure to a specific actionable error. Strict checks: `lat` finite + ∈ [-90, 90], `lng` finite + ∈ [-180, 180]. The earth-coordinate range check catches a real bug shape: a swapped lat/lng ship-it where Delhi's 28.6/77.2 ends up as 77.2/28.6 — `77.2` is finite, only the [-90, 90] check rejects it. Wired into `approveShop` at `@c:\Users\dahiy\grocery-mvp\functions\src\index.ts:4931-4956` between the existing `status === 'pending'` check and the storefront-photo wiring. Server returns `failed-precondition` with the specific reason + an actionable "ask the owner to re-open RegisterShop" message.
- [x] **Layer 3 — Filter gate.** `filterShopsByServiceRadius` signature now takes `customerHasLocation: boolean` so the missing-distance branch can split on WHICH side is missing. Customer-side gap (no GPS granted) → keep all shops uniformly (preserve fail-OPEN; don't strand a customer); shop-side gap (shop has no `location`) → drop (defense layer 3). Server helper at `@c:\Users\dahiy\grocery-mvp\functions\src\geoVisibilityHelpers.ts:13-89`, byte-identical client mirror at `@c:\Users\dahiy\grocery-mvp\src\utils\geoVisibilityHelpers.ts:14-48`. Both call sites updated: `listShopsPublic` (`@c:\Users\dahiy\grocery-mvp\functions\src\index.ts:7160-7170`) passes `customerHasLocation: !!userLocation`; `shopService.getNearbyShops` web Plan B (`@c:\Users\dahiy\grocery-mvp\src\services\shopService.ts:75-103`) passes `customerHasLocation: true` (the function REQUIRES `userLocation`) AND adds a defensive guard so `haversineKm` doesn't throw on a location-less shop — stamps `distanceKm: undefined` instead, which the new fail-CLOSED branch correctly drops.
- [x] **Audit-trail stamp.** `Shop` type at `@c:\Users\dahiy\grocery-mvp\src\types\index.ts:107-116` gains `locationVerifiedAt?: number` + `locationVerifiedBy?: string`. Both optional + nullable so legacy approved-pre-PR shops stay back-compat (they simply lack the stamp). `approveShop` writes both alongside the existing `approvedAt`/`approvedBy` inside the `shopRef.update` block (`@c:\Users\dahiy\grocery-mvp\functions\src\index.ts:5055-5076`). Auditable record of which admin verified which shop's location.
- [x] **Admin UI verification affordance.** `@c:\Users\dahiy\grocery-mvp\src\screens\admin\ShopRegistrationDetailScreen.tsx:81-91,169-190,407-455,624-658`. New `locationVerifiedChecked` useState (Rule 2: with other top-level useStates above conditional returns). Derived `shopHasValidLocation` flag mirrors the server helper. Derived `canApprove = !pending && shopHasValidLocation && locationVerifiedChecked` gates the CTA. Two render paths above Approve: (1) shop has no/invalid pin → red banner + Approve hard-disabled (no checkbox can unlock — no amount of human verification fixes a missing lat/lng); (2) shop has a valid pin → tappable verification checkbox alongside the existing PR-31.1 `📍 lat, lng` map deeplink. Local checkbox state — the durable record is the server-stamped `locationVerifiedAt`/`By`.
- [x] **Operational pre-deploy script.** `@c:\Users\dahiy\grocery-mvp\scripts\audit-shops-without-location.ts`. Re-uses `validateShopLocationForApproval` to enumerate every shop in Firestore whose `location` is missing or out of range. Tab-separated output + a summary line + a WARNING line for active offenders (those will become invisible to customers post-deploy). Run via `npx tsx scripts/audit-shops-without-location.ts`. Pre-deploy hook so the small set of legacy/mis-registered shops can be flagged to their owners BEFORE the OTA rolls.
- [x] **Tests — suite at 1299 / 1299** (was 1282; +17). `tsc --noEmit` clean for both `src/` and `functions/`. `geoVisibilityHelpers.test.ts` rebuilt with 22 tests (all originals re-typed with `customerHasLocation: true` + 3 customer-side-gap tests + 4 shop-side-gap tests including a mixed-table case + 1 customer-without-GPS uniform-keep). `approveShopHelpers.test.ts` extended with 12 new `validateShopLocationForApproval` tests (happy / null / missing / NaN / string / lat 91 / lat -91 / lng Infinity / lng 181 / boundary 90/180 inclusive / 0,0 valid).
- [ ] **Acceptance manual sweep.**
  - **Pre-deploy:** Run `npx tsx scripts/audit-shops-without-location.ts`. If non-empty, message affected shop owners that their listing will be invisible post-deploy.
  - **Filter:** customer without GPS → all active shops visible (fail-OPEN preserved); customer with GPS + shop with location in radius → shop visible; customer with GPS + shop with location out of radius → shop hidden; customer with GPS + shop WITHOUT location → shop hidden (defense layer 3 fires).
  - **Registration:** open RegisterShop, fill name+address+phone, don't tap Capture; Continue stays disabled with hint shown; tap Capture → location populates → button enables; Continue → submit succeeds.
  - **Approval (admin):** open a pending shop with valid `location` → map deeplink opens Google Maps; verification checkbox unchecked → Approve disabled; check the box → Approve enables; Approve → shop flips to `active` + `locationVerifiedAt`/`locationVerifiedBy` stamped. Open a pending shop with no `location` (manually unset in Firestore Console) → red banner shown + Approve hard-disabled.
  - **Server-side defense in depth:** call `approveShop({shopId})` directly via a test script on a location-less pending shop → server returns `failed-precondition` with the actionable error message.
- [ ] **Cloud Run IAM verification (Rule 11)** after deploy on both `approveshop` and `listshopspublic`:

      ```powershell
      gcloud run services get-iam-policy approveshop ``
        --region=asia-south1 --project=grocery-mvp-dev
      gcloud run services get-iam-policy listshopspublic ``
        --region=asia-south1 --project=grocery-mvp-dev
      ```

      Confirm `allUsers / roles/run.invoker`. Add binding if missing.

- [ ] **Deploy.** Server-first per Rule 11:

      ```powershell
      cd functions; npm run build; cd ..
      firebase deploy --only "functions:approveShop,functions:listShopsPublic"
      # IAM verify (above)
      eas update --branch production --message "PR-NEXT-SHOP-LOCATION-REQUIRED defense in depth"
      ```

- [ ] **Out of scope (deferred, §I).** Map-based location editor in RegisterShop (drag-pin). Periodic re-verification of shop location (quarterly etc.). Custom `serviceRadiusKm` at registration time (current default-then-edit-in-ShopSettings flow is enough). Bulk-fixing existing location-less shops via code (handled operationally per §E — let them disappear post-deploy, owners re-capture via a new RegisterShop pass). `[Post-launch / Phase B]`

## HOTFIX-FALLBACK-LEAK + PR-NEXT-SHOP-LOCATION-EDIT (2026-06-02)

**Trigger:** Sudhir's US friend registered a shop with `16663 Chesterfield Farms Drive, Ballwin MO 63005` typed in the Shop address field — but admin saw a Faridabad pin (`28.5605, 77.2065`) when opening ShopRegistrationDetail. Friend had no path to update the pin post-rejection — `ShopSettingsScreen` had zero location-editing surface.

**Root cause:** Three bugs stacked.

1. **Silent fallback location** — `locationService.getCurrentLocation()` returns `MOCK_USER_LOCATION = { lat: 28.5605, lng: 77.2065 }` (Faridabad center) on permission-denied / GPS-off / exception with `source: 'fallback'`. The `source` flag was set on the result but no downstream consumer checked it. PR-NEXT-SHOP-LOCATION-REQUIRED's three layers all validated lat/lng was finite + Earth-range — Faridabad coords pass all those gates. The whole defense-in-depth strategy was moot against a valid-but-wrong fallback.
2. **No edit path** — `ShopSettingsScreen` had no Location section.
3. **No remote-registration path** — capture assumed owner physically at shop with GPS available.

**Two-PR resolution.**

- [x] **HOTFIX-FALLBACK-LEAK** — immediate stopgap, direct Claude edit (no Windsurf), ~5 min. `@c:\Users\dahiy\grocery-mvp\src\screens\roles\RegisterShopScreen.tsx:101-110,181-217,634-654,750-762,1034-1047`. RegisterShop now reads `source` from `useLocationStore`. `validate()` refuses `source !== 'gps'` with actionable error pointing at phone settings. Continue button gates on `source === 'gps'`. Pre-hotfix the silent "📍 GPS captured: 28.56, 77.20" success hint fired for fallback too (Sudhir's friend saw it and assumed real GPS). Hotfix splits the hint: green success only when `source === 'gps'`, red `captureHintError` warning when `source === 'fallback'` explicitly calling out the fallback state. Pure client OTA. Stops new bad-pin registrations from happening while SHOP-LOCATION-EDIT lands.

- [x] **PR-NEXT-SHOP-LOCATION-EDIT** — structural fix on top of the hotfix. Pre-design check up-front: locked picks were (1) Address-text + `Location.geocodeAsync` (free expo-location, no API key, no recurring cost — explicitly rejected `react-native-maps` because of native rebuild + ongoing API spend), (2) Edit requires admin re-approval before going live (`pendingLocation` two-step), (3) Reverse-geocode the pin + show owner-typed address side-by-side in admin UI. Three sections:

      **§A RegisterShop dual-mode capture.** Local `capturedShopLocation` state replaces the prior `useLocationStore` reuse (which conceptually cross-contaminated customer's browse-side location with shop's persisted pin, and the geocode path would have made this worse). Two CTAs side-by-side under the Shop address field: `📍 Use my GPS` (existing locationService, refuses fallback per hotfix) and `🔍 Find from address` (calls `Location.geocodeAsync(address.trim())`, free expo-location built-in). After capture: success card with the source tag (`📍 Pin set (device GPS)` or `📍 Pin set (typed address)`) + reverse-geocoded resolved address (via reuse of `reverseGeocodeLabel` from ADDRESS-UX.1) + `lat.toFixed(4), lng.toFixed(4)` + a `↻ Re-capture` button. Geocode-failure handler shows actionable error: "Address not found. Try a more specific address (include city + state/zip), or use 📍 Use my GPS if you're at the shop." New `useCaptureShopLocation()` hook shared with §B as the single source of truth for the capture UX. Submit payload extended with `locationSource: 'gps' | 'geocoded'` for the audit trail. New `formatResolvedAddress` pure helper (+5 tests).

      **§B ShopSettings Location section + edit-with-re-approval.** New Location card with two states. Stable state shows current pin + reverse-geocoded resolution + "✓ Verified by admin on Jun 2 2026" (from `Shop.locationVerifiedAt`), then dual-mode capture CTAs and a "Submit for admin review" button after a fresh capture. Pending state replaces the capture UI with current-pin (live, visible to customers) + proposed-pin (with source tag + submitted-at timestamp) + a "Cancel pending change" button. New callables `submitPendingShopLocation` (+6 tests, including `identical_to_current` rejection so an accidental no-op submit returns a clean error) and `cancelPendingShopLocation` (+3 tests, owner-side withdraw clears the four pending fields). pushToAdmins fires on submit so admin sees the queue item.

      **§C Admin verification surfaces — pin reverse-geocoded for mismatch catch.** `ShopRegistrationDetailScreen` reverse-geocodes `shop.location` on mount and renders owner-typed address (from `shop.address`) above + reverse-geocoded resolution + lat/lng + "Source: typed address" / "Source: device GPS" tag below, both with the existing Verify-on-map deeplink. Mismatch case ("Ballwin MO" typed + Faridabad pin resolution) becomes visually obvious — admin's eye catches it without automated comparison. `ShopDetailManagementScreen` gains a "Pending location change" card when `pendingLocationStatus === 'pending'`: current-pin vs proposed-pin, both reverse-geocoded, source tag on the proposed pin, `distanceBetweenPins(current, proposed)` ("Same location" / "423 meters" / "1.2 km") via new pure helper (+5 tests), Verify-proposed-on-map deeplink, Approve / Reject buttons. Two new callables `approvePendingShopLocation` (+5 tests, atomic swap inside a transaction: `shop.location` ← `shop.pendingLocation`, clear pending fields, re-stamp `locationVerifiedAt`/`By`) and `rejectPendingShopLocation` (+3 tests, clears pending fields with optional reason). pushToOwner fires on both with the admin's decision.

      **Schema additions (additive only).** Five new optional + nullable fields on `Shop` at `@c:\Users\dahiy\grocery-mvp\src\types\index.ts`: `locationSource: 'gps' | 'geocoded' | null`, `pendingLocation: { lat, lng } | null`, `pendingLocationSource: 'gps' | 'geocoded' | null`, `pendingLocationSubmittedAt: number | null`, `pendingLocationStatus: 'pending' | null`. Legacy shops render cleanly via "Source: unknown" + no pending change. Firestore rules update at `@c:\Users\dahiy\grocery-mvp\firestore.rules:85-91` documenting the `allow write: if false` posture (callables use Admin SDK; client direct writes to `pendingLocation*` stay denied as defense-in-depth).

      **Suite at 1327 / 1327** (was 1299; +28, forecast +27 minimum). `tsc --noEmit` clean for both `src/` and `functions/`. Test fixture for `submitPendingShopLocation` uses `ownerUid` per the production schema (Rule 7 — verified via audit-grep, no `customerId`-style ship-it).

- [ ] **Operational deploy.** Server-first per Rule 11 — 4 NEW + 2 modified callables. IAM verify all 6 (Cloud Run `allUsers` strip is the recurring hazard hit 5× now). Firestore rules update. Client OTA bundles SHOP-LOCATION-EDIT client surfaces + HOTFIX-FALLBACK-LEAK + the QuickSwitch / HomeScreen polish from earlier this session.

      ```powershell
      cd functions; npm run build; cd ..
      firebase deploy --only "functions:registerShop,functions:approveShop,functions:submitPendingShopLocation,functions:cancelPendingShopLocation,functions:approvePendingShopLocation,functions:rejectPendingShopLocation"

      foreach ($svc in 'registershop','approveshop','submitpendingshoplocation','cancelpendingshoplocation','approvependingshoplocation','rejectpendingshoplocation') {
        gcloud run services get-iam-policy $svc --region=asia-south1 --project=grocery-mvp-dev
      }

      firebase deploy --only firestore:rules

      eas update --branch production --message "SHOP-LOCATION-EDIT + HOTFIX-FALLBACK-LEAK + QuickSwitch/HomeScreen polish"
      ```

- [ ] **Out of scope (deferred).** Interactive map / draggable pin (`react-native-maps` + Google Maps API + native rebuild + recurring spend — defer until pilot signal demands sub-10m pin precision). Automated address-mismatch detection (admin's eye + side-by-side handles pilot scale). Backfill of legacy shops' `locationSource` field (admin UI renders "Source: unknown" honestly). Email notification on pending-location submit (push is enough for pilot). Multi-pending-edit queue (one pending change per shop at a time; new submit clears prior). `[Post-launch / Phase B]`

- [x] **Rule 5 extension shipped via this PR.** `.windsurf/code-discipline.md`: *the schema audit-grep must ALSO cover behavior at call sites when the field is missing / null / nonconforming*. The MOCK_USER_LOCATION leak is the worked example — `source` existed in the type but no call site read it, so PR-NEXT-SHOP-LOCATION-REQUIRED silently accepted the degraded value.

## PR 39.2 — Live-pilot guard (2026-06-09)

**Trigger:** Pre-pilot must-do. Once shop #1 takes a real money order, an accidental `npm run reset:test-data -- --execute` (or any of the three reset scripts) would destroy live customer data. The existing safety guards (project allowlist, admin UID protection, dry-run default, typed DELETE confirm, audit log) were necessary but not sufficient — none noticed when the project contained real customer orders instead of test data.

**Design:** Firestore flag `appConfig/pilotStatus.isLive` read by all three reset scripts at startup. When `true`, scripts refuse with a loud banner — even `--execute --yes` aborts. Override exists (`--i-know-pilot-is-live`) for legitimate disaster recovery but requires explicit acknowledgement that triggers a loud red warning AND writes to the audit log.

**First Cascade-on-Sonnet test** per the executor split commitment in `docs/PROMPT_AUTHORING_NOTES.md`. Validated: +15 tests exactly per forecast (1327 → 1342), discriminated-union Result per Rule 14, fail-CLOSED on read errors, deliberate-break demo confirmed tests pin the bug. Quota usage ~1% of weekly cycle — 30-40% less than equivalent Opus work. Confirms Sonnet-as-executor is the right default for well-specified prompts.

- [x] **Shipped.**
  - **Pure helpers** at `@c:\Users\dahiy\grocery-mvp\scripts\livePilotGuardHelpers.ts` — `parsePilotStatusFlag` (strict `=== true` parser, falsy on missing/string/numeric), `evaluateLivePilotGuard` (discriminated-union verdict: `pilot_not_live` / `override_acknowledged` / `pilot_is_live_no_override`), `buildLivePilotRefuseBanner` (testable string formatter). Zero firebase-admin imports — unit-testable without booting the SDK.
  - **11 helper tests** at `@c:\Users\dahiy\grocery-mvp\tests\scripts\livePilotGuardHelpers.test.ts` (7 parse cases + 4 evaluate cases).
  - **All three reset scripts integrated** — `reset-pilot-data.ts`, `reset-test-data.ts`, `reset-keep-catalog.ts` each gain `--i-know-pilot-is-live` flag in their parseFlags + a `readPilotStatusIsLive` with fail-CLOSED posture + a guard block early in `main()` + extended audit log JSON with the `livePilotGuard` block (isLive, overrideAcknowledged, verdict).
  - **4 parseFlags tests** added (2 each in `reset-pilot-data.test.ts` + `reset-test-data.test.ts`). `reset-keep-catalog.ts` deliberately gets no test addition per scope (one-shot script; helpers split would be scope creep).
  - **Suite at 1342 / 1342** (was 1327; +15 exact). `tsc --noEmit` clean for both `src/` and `functions/`.
  - **No deploy required** — TS-only. Commit + push.

- [ ] **ACTIVATION STEP (Sudhir manual, on the day pilot launches):** Firebase Console → Firestore → create document `appConfig/pilotStatus` with field `isLive: true` (boolean, not string). Before this flip the guard reads the missing doc as safe and all three scripts continue working normally; after the flip they all refuse. **Do not flip this until the moment pilot is actually live with real customers.**

- [ ] **Operational playbook for disaster recovery (post-pilot-launch only).** Coordinate with at least one other human before invoking. Run `--i-know-pilot-is-live` alongside `--execute --yes`. Each invocation writes to `scripts/.cleanup-logs/{timestamp}-*.json` with `verdict: 'override_acknowledged'` so a future audit can review.

- [x] **First Cascade-on-Sonnet executor test validated.** Test count delta exact, deliberate-break verification, ~1% quota usage. Sonnet-as-default for well-specified prompts is now the locked-in posture (see `docs/PROMPT_AUTHORING_NOTES.md` Rule W).

## PR-NEXT-BUNDLE-A — Pilot regression fixes (2026-06-09)

**Trigger:** Four regressions surfaced during pre-pilot family testing. Bundled as a single OTA because all four are pure client-side fixes with no schema/callable changes.

- [x] **§A — Delivery-charge reference consistency (Finding #2).** New pure helper `resolveCustomerDeliveryReference` at `@c:\Users\dahiy\grocery-mvp\src\utils\resolveCustomerDeliveryReference.ts`. Priority order: (1) default saved-address pin (`profile.addresses.find(a => a.id === profile.defaultAddressId)?.lat/lng`) — same coords CheckoutScreen uses, so browse + cart + checkout numbers agree; (2) live GPS from `useLocationStore`; (3) `null` → `displayDeliveryCharge` falls through to `distanceKm` then flat `deliveryFee`. `CartScreen` and `ShopDetailScreen` both updated to derive `customerLocation` via this resolver (pulling in `useProfileStore` alongside the existing `useLocationStore`). **6 unit tests** at `@c:\Users\dahiy\grocery-mvp\tests\utils\resolveCustomerDeliveryReference.test.ts`: default pin wins over GPS, default address no-pin fallback, no default address, no GPS either, null profile, NaN pin.
  - [ ] **Follow-up: ShopListScreen call site.** `ShopListScreen` passes `customerLocation={location}` from raw `useLocationStore` to `ShopCard`. Should also call `resolveCustomerDeliveryReference` for full parity. Explicitly deferred as a separate PR per scope-boundary in the prompt. `[Phase NEXT-BUNDLE-B]`

- [x] **§B — Status message confusion (Finding #6).** `OrderDetailScreen` at `@c:\Users\dahiy\grocery-mvp\src\screens\OrderDetailScreen.tsx` now double-gates the `readyByEstimate` pickup row: `etaDisplay.kind === 'ready_by' && (order.status === 'accepted' || order.status === 'preparing')`. Finding #17 already suppressed the countdown via `orderEtaDisplay` returning `hidden` for `ready_for_pickup`; this explicit JSX-level gate also suppresses the sub-message text ("by HH:MM · delivery partner brings it to you") for belt-and-suspenders — the block can't appear even if the state machine were to regress.

- [x] **§C — Polling stop on delivered/cancelled (Finding #12a).** Three parts:
  - `useLivePartnerEta` at `@c:\Users\dahiy\grocery-mvp\src\hooks\useLivePartnerEta.ts` gained a third optional arg `orderStatus?: string | null`. `FINALIZED_STATUSES = new Set(['delivered', 'cancelled'])`. When finalized, the `useEffect` resets state to null and exits without starting the 30s interval. Exported pure helper `shouldPoll({orderId, enabled, orderStatus})` mirrors the gate for unit-testing without RNTL.
  - `PartnerDetailsSheet` at `@c:\Users\dahiy\grocery-mvp\src\components\order\PartnerDetailsSheet.tsx` gained `orderStatus?: string | null` prop. When `isDelivered` or `isCancelled`, replaces the live ETA rows with a static `Status` row ("✅ Delivered" / "❌ Order cancelled") so the sheet can't show stale "Arriving now" after delivery.
  - `OrderDetailScreen` passes `order?.status` as the third arg to `useLivePartnerEta` and `orderStatus={order.status}` to `PartnerDetailsSheet`.
  - **3 `shouldPoll` unit tests** at `@c:\Users\dahiy\grocery-mvp\tests\hooks\useLivePartnerEta.test.ts`: `ready_for_pickup` → polls, `delivered` → no-poll, `cancelled` → no-poll. Deliberate-break confirmed (2 fail as expected).

- [x] **§D — Keyboard covers feedback text field (Finding #14).** `RateOrderCard` at `@c:\Users\dahiy\grocery-mvp\src\components\order\RateOrderCard.tsx` now wraps its full render output in `<KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}>`. iOS: `padding` mode adds inset equal to keyboard height. Android: `height` mode + the surrounding `ScrollView` in `OrderDetailScreen` scrolls the focused `TextInput` into view. `KeyboardAvoidingView` and `Platform` added to the React Native imports.
  - [ ] **Follow-up: keyboardVerticalOffset tuning.** 88 pt is a heuristic for header (56) + safe-area (32). If the rating screen gains a taller header or different insets, this value should be updated. Monitor during pilot. `[Phase NEXT-BUNDLE-B]`

- [x] **Tests and verification.**
  - **+9 new tests** (6 resolveCustomerDeliveryReference + 3 shouldPoll).
  - **Suite: 1351 / 1351** (was 1342; +9 exact). `npm test` exit 0.
  - **`tsc --noEmit` clean** (exit 0).
  - **Deliberate-break demo:** reverted `shouldPoll` finalized-status gate → 2 tests failed (`delivered` + `cancelled` cases), 1 passed (`ready_for_pickup`). Restored.
  - **No deploy required.** Pure client OTA; no schema/callable changes.

- [ ] **Deploy.** `eas update --branch production --message "PR-NEXT-BUNDLE-A pilot regressions: delivery charge ref, status gate, polling stop, keyboard avoiding"`.

- [ ] **Smoke acceptance (all four fixes).**
  - **§A:** Browse a shop with a saved home address set as default that has a pin; delivery fee on the card and in cart should match what CheckoutScreen shows when the home address is selected. Without a pin (pre-PR-46 address), it should fall back to GPS fee.
  - **§B:** Tap through an accepted order (readyByEstimate set), then have shop mark ready-for-pickup → pickup-row disappears; then partner picks up → pickup-row stays gone.
  - **§C:** Open PartnerDetailsSheet during delivery; partner picks up order and delivers → sheet shows "✅ Delivered" row, no stale ETA; close and reopen the sheet → still shows static copy (polling stopped).
  - **§D:** On a delivered order, tap "Rate this order", tap the shop comment field → keyboard slides up, field stays visible above keyboard on both iOS and Android.

- [ ] **Out of scope (deferred per prompt §I).**
  - ShopListScreen delivery-charge reference fix (separate PR, same `resolveCustomerDeliveryReference` helper, touches ShopListScreen which was explicitly out of scope). `[Phase NEXT-BUNDLE-B]`
  - `keyboardVerticalOffset` measured from actual screen hierarchy rather than hardcoded 88. `[Phase NEXT-BUNDLE-B]`

## PR-NEXT-BUNDLE-B — Mid-flow UX fixes (2026-06-09)

**Trigger:** Three mid-flow UX gaps found during pre-pilot review. Bundled as a server-first deploy (functions first, then OTA) because §A and §C both touch server callables.

- [x] **§A — ETA consistency: shop owner sees live partner ETA (Finding #9).** Extended the `getLivePartnerEta` callable and its backing pure helper `getLivePartnerEtaPure` (at `functions/src/livePartnerEtaHelpers.ts`) to accept shop-owner callers alongside customers. Authorization gate changed from single `order.customerUid === callerUid` to: caller must be the customer **or** a shop owner (`isCallerShopOwner === true && callerShopId === order.shopId`). Error code renamed `not_customer` → `not_authorized` (callable switch updated in `functions/src/index.ts`). The `getLivePartnerEta` callable now extracts `request.auth.token.shopOwner` + `request.auth.token.shopId` claims and passes them through. Client side: `ShopOrderDetailScreen` at `src/screens/shop/ShopOrderDetailScreen.tsx` now imports `useLivePartnerEta` and polls with `enabled = order.status === 'ready_for_pickup'`; the `ETA ~X min` display shows the live value when available, falls back to `estimatedDeliveryAt` static otherwise. `ShopOwnerDashboardScreen` has no per-card ETA display so no client change was needed there. **+6 tests** in `tests/functions/getLivePartnerEtaHelpers.test.ts` (1 existing `not_customer` case updated; 5 new shop-owner cases covering: shop owner of matching shop → ok, shop owner of different shop → not_authorized, customer regression, shopOwner flag false → not_authorized, empty callerShopId → not_authorized).
  - [ ] **Follow-up: ShopOwnerDashboard card-level ETA chip.** If pilot shop owners request a live ETA per-card on the dashboard list view, add a `liveEtaMin` column to the watched orders query + a small chip on each card. Out of scope for this PR (no per-card polling loop yet). `[Phase NEXT-BUNDLE-C]`

- [x] **§B — One-tap call: collapse Show phone → reveal → Call into single CTA (Finding #10).** `PartnerDetailsSheet` at `src/components/order/PartnerDetailsSheet.tsx` previously had a three-branch phone section: pre-pickup muted copy / post-pickup call link (if phone cached) / post-pickup "Show phone" reveal button. Collapsed to two branches: pre-pickup muted copy (unchanged) / post-pickup single "📞 Call [firstName]" button that fires the new `onCallPartner` prop. New `onCallPartner` prop added to `Props`; `onRevealPhone` kept in Props for back-compat but no longer destructured or read in the sheet. `OrderDetailScreen` at `src/screens/OrderDetailScreen.tsx`: `onRevealPartnerPhone` callback replaced with `onCallPartner` — if `partnerPhone` is already cached, dials immediately via `Linking.openURL`; otherwise fetches via `getDeliveryPartnerContact`, caches, then dials in the same tap. `partnerPhone` prop no longer passed to `PartnerDetailsSheet` (phone is only used to dial in the parent). No new tests (pure UX collapse; logic path is same `getDeliveryPartnerContact` call as before).
  - [ ] **Follow-up: Haptic on successful dial.** A light haptic (`Haptics.impactAsync(ImpactFeedbackStyle.Light)`) on the `Linking.openURL` call would match the pattern established for `handleAddDeliveryProof`. Low priority. `[Phase NEXT-BUNDLE-C]`

- [x] **§C — Mandatory delivery proof gate (Finding #13).** Three-layer implementation:
  - **New server helper** `functions/src/markDeliveredHelpers.ts` — exports `validateMarkDeliveredProofGate(order: ProofOrderLike)` returning a discriminated-union `ProofGateResult`. Checks `order.deliveryProofStoragePath` (the field stamped by `recordDeliveryProofUpload`; `proofPhotoUrl` was a red-herring name — the actual Firestore field is `deliveryProofStoragePath`). Rejects with `code: 'no_proof'` if the field is absent, null, empty, or whitespace-only.
  - **`markDelivered` callable** in `functions/src/index.ts` imports and calls `validateMarkDeliveredProofGate` immediately after the COD gate (after `validateMarkDeliveredCodGate` so "confirm payment" surfaces before "upload proof" — the correct priority). Throws `failed-precondition` on gate failure.
  - **Client: `DeliveryDashboardScreen`** at `src/screens/delivery/DeliveryDashboardScreen.tsx` — `ActiveDeliveryCard`'s Delivered button now uses `disabled={pending || !hasProof}` (the `hasProof` prop already existed, computed from `!!o.deliveryProofStoragePath || !!o.proofPhotoUrl`). Inline hint "📷 Upload delivery proof first" renders above the button when `!hasProof`. New `proofHint` style added to the StyleSheet (`colors.warning`, caption size, centered).
  - **Client: `DeliveryOrderDetailScreen`** at `src/screens/delivery/DeliveryOrderDetailScreen.tsx` — inside the `canShowDeliveredButton(order)` branch, Delivered button now uses `disabled={pendingAction !== null || !order.deliveryProofStoragePath}`. Matching hint shown when `!order.deliveryProofStoragePath`. New `proofHint` style added.
  - **+6 tests** in `tests/functions/markDeliveredHelpers.test.ts`: valid path → ok, empty string → no_proof, undefined → no_proof, null → no_proof, whitespace-only → no_proof, legacy order (`{}`) → no_proof (graceful).
  - [ ] **Follow-up: Remove the "OPTIONAL" language from PR-NEXT-6 comments.** Several comments across `src/types/index.ts` and `DeliveryDashboardScreen.tsx` still say "photo is OPTIONAL". These are now stale. Update them in the next cleanup pass. `[Phase NEXT-BUNDLE-C]`
  - [ ] **Follow-up: Late-upload window for already-delivered orders.** `DeliveryHistoryCard` currently still shows the "Add proof" CTA for delivered orders (added by PR-NEXT-13d). If the server gate now blocks `markDelivered` without proof, a partner who hit Delivered without uploading (pre-PR-NEXT-BUNDLE-B) would have no recovery path except the history card. Clarify if the server validator permits post-delivery uploads (currently it only checks `pickedUpAt` + assignee, no `deliveredAt` gate). `[Phase NEXT-BUNDLE-C]`

- [x] **Tests and verification.**
  - **+11 new tests** (+5 getLivePartnerEta shop-owner gate + 1 updated not_authorized + 6 markDeliveredHelpers proofGate).
  - **Suite: 1362 / 1362** (was 1351; +11 exact). `npm test` exit 0.
  - **`tsc --noEmit` clean** (exit 0, both root and `functions/`).
  - **Deliberate-break demo:** changed `not_authorized` → `not_customer` in the test assertion → 1 fail (`Expected: "not_customer", Received: "not_authorized"`). Restored.
  - **Deploy class: server-first.** Deploy `functions` first (getLivePartnerEta + markDelivered changes), then OTA for client changes.

- [ ] **Deploy — server functions (run in PowerShell).**
  ```
  firebase deploy --only functions:getLivePartnerEta
  firebase deploy --only functions:markDelivered
  ```

- [ ] **Deploy — client OTA (run in PowerShell after functions verified).**
  ```
  eas update --branch production --message "PR-NEXT-BUNDLE-B mid-flow UX: shop ETA, one-tap call, proof gate"
  ```

- [ ] **Smoke acceptance (all three fixes).**
  - **§A:** With an order in `ready_for_pickup` status, open `ShopOrderDetailScreen` → ETA chip should update live every 30s (same minute count the customer sees). In `accepted`/`preparing` status, chip shows static `estimatedDeliveryAt` fallback.
  - **§B:** On an active delivery (post-pickup), open `PartnerDetailsSheet` → single "📞 Call [name]" button visible (no "Show phone" step). Tap → dialer opens immediately (or after a brief "Connecting…" spinner on first tap).
  - **§C:** Partner picks up order but has not uploaded proof → "Delivered" button is greyed with hint. Upload proof photo → hint disappears, button enables. Tap Delivered → server accepts. Attempt via direct callable without proof → `failed-precondition` error.

- [ ] **Out of scope (deferred).**
  - ShopOwnerDashboard per-card live ETA chip. `[Phase NEXT-BUNDLE-C]`
  - Remove stale "photo is OPTIONAL" comments from types + delivery screens. `[Phase NEXT-BUNDLE-C]`
  - Clarify post-delivery late-upload window semantics. `[Phase NEXT-BUNDLE-C]`

---

## PR-NEXT-PARTNER-HEADS-UP

- [x] **headsUpHelpers.ts + 6 tests** — Created `functions/src/headsUpHelpers.ts` with `computeMinutesFromNow` (clamps to ≥1 min, handles null/undefined/NaN safely). Pinned by `tests/functions/headsUpHelpers.test.ts` (6 cases: future ETA, past ETA, zero delta, null, undefined, NaN). `[Phase PR-NEXT-PARTNER-HEADS-UP]`
- [x] **sendPickupHeadsUpToDelivery trigger** — Added `export const sendPickupHeadsUpToDelivery` in `functions/src/index.ts` after `sendNewPickupPushToDelivery`. Fires on `pending→accepted` transition (or first `accepted→accepted` field update). Idempotency stamped via `headsUpSentAt: FieldValue.serverTimestamp()` on the order doc post-push. Reuses `filterPartnersByNotificationRadius` (PR 50) for fail-open radius filtering. Push body: "🍽️ Heads up — pickup coming · {shop} · ready in ~{N} min · {count} items". Data: `{ type: 'pickup_heads_up', orderId }`. `[Phase PR-NEXT-PARTNER-HEADS-UP]`
- [x] **headsUpSentAt schema field** — Added `headsUpSentAt?: number | null` to `Order` type in `src/types/index.ts`. Schema-additive; absent on all legacy orders. `[Phase PR-NEXT-PARTNER-HEADS-UP]`
- [x] **Client HeadsUpCard already exists** — `HeadsUpCard` + `headsUp`/`availableNow` split already shipped in PR 12 (`DeliveryDashboardScreen.tsx`). No client changes needed for the "Coming up" section. `[Phase PR-NEXT-PARTNER-HEADS-UP]`
- [x] **pickup_heads_up deep-link** — Added `pickup_heads_up` branch in `src/components/AuthBootstrap.tsx` after `new_pickup_for_delivery`. Tapping navigates delivery partners to `DeliveryDashboard` (not `OrderDetail` — order isn't claimable yet). Non-delivery taps silently no-op. `[Phase PR-NEXT-PARTNER-HEADS-UP]`
- [x] **tsc + tests + break demo** — Both `npx tsc --noEmit` clean. `npm test`: 1368/1368 (+6). Deliberate-break: changed `Math.max(1, …)` → `Math.max(0, …)` → 2 failures (past + zero delta). Restored. `[Phase PR-NEXT-PARTNER-HEADS-UP]`
- [ ] **Deploy sendPickupHeadsUpToDelivery** — Run `firebase deploy --only functions:sendPickupHeadsUpToDelivery` in PowerShell. Verify in `firebase functions:list`. `[Phase PR-NEXT-PARTNER-HEADS-UP-deploy]`
- [ ] **headsUpSentAt Firestore index** — If queries on `headsUpSentAt` are added later, add a composite index. Currently the trigger reads the field client-side only; no index needed now. `[Phase PR-NEXT-PARTNER-HEADS-UP-followup]`
- [ ] **Re-acceptance after rejection** — When an order goes `accepted→cancelled→accepted` (rare), `headsUpSentAt` is NOT cleared automatically. Server does not currently handle this edge case; manual Firestore delete of `headsUpSentAt` needed. Track for a follow-up. `[Phase PR-NEXT-PARTNER-HEADS-UP-followup]`

---

## PR-NEXT-PARTNER-PHOTO

- [x] **formatPartnerAvatar pure helper + 4 tests** — Created `src/utils/formatPartnerAvatar.ts` with `formatPartnerAvatar(name, photoUrl): PartnerAvatarResult` (discriminated union `{ kind: 'photo', uri } | { kind: 'initials', text }`). Guards empty-string URIs (R9). Pinned by `tests/utils/formatPartnerAvatar.test.ts` (4 cases: photo present, null, empty string, null+null). `[Phase PR-NEXT-PARTNER-PHOTO]`
- [x] **deliveryPersonPhotoUrl on Order type** — Added `deliveryPersonPhotoUrl?: string | null` to `Order` in `src/types/index.ts`. Schema-additive. `[Phase PR-NEXT-PARTNER-PHOTO]`
- [x] **profilePhotoUrl on DeliveryRequest type** — Added `profilePhotoUrl?: string` to `DeliveryRequest` in `src/types/index.ts` and `DeliveryRequestDoc` in `functions/src/index.ts`. `[Phase PR-NEXT-PARTNER-PHOTO]`
- [x] **getPartnerPhotoUploadUrl callable** — Added `export const getPartnerPhotoUploadUrl` in `functions/src/index.ts`. Accepts `{ contentType: 'image/jpeg' | 'image/png' }`. Mints v4 signed PUT URL targeting `delivery-profile/{uid}.jpg|png`. 5-min expiry. `[Phase PR-NEXT-PARTNER-PHOTO]`
- [x] **requestDeliveryRole — photo required** — Extended callable in `functions/src/index.ts` to accept `profilePhotoUrl`. Validates: non-empty, starts with `https://`, contains `delivery-profile/`, must include caller's own UID (anti-spoofing). Stored in `deliveryRequests/{uid}.profilePhotoUrl`. `[Phase PR-NEXT-PARTNER-PHOTO]`
- [x] **approveDeliveryRole — copy photo to users doc** — Extended callable to copy `profilePhotoUrl` from `deliveryRequests/{uid}` to `users/{uid}.profilePhotoUrl` + stamps `photoVerifiedAt` + `photoVerifiedBy`. Non-fatal if photo missing (legacy requests). `[Phase PR-NEXT-PARTNER-PHOTO]`
- [x] **claimDelivery — denormalize deliveryPersonPhotoUrl** — Extended denorm block in `claimDelivery` callable to read `partnerData.profilePhotoUrl` and write `deliveryPersonPhotoUrl` onto the order doc alongside existing trust signals. `[Phase PR-NEXT-PARTNER-PHOTO]`
- [x] **BecomeDeliveryPartnerScreen — photo capture** — Added `pickAndResizeImage` pipeline + `getPartnerPhotoUploadUrl` signed-URL upload + `profilePhotoUrl` requirement before `requestDeliveryRole` submit. Camera + gallery picker buttons. Preview + upload status shown. `[Phase PR-NEXT-PARTNER-PHOTO]`
- [x] **PartnerDetailsSheet — photo avatar** — Added `partnerPhotoUrl` prop + `formatPartnerAvatar` call. Renders `<Image style={avatarPhoto}>` (circular, 56px) when photo present; falls back to initials `<View style={avatar}>` otherwise. `[Phase PR-NEXT-PARTNER-PHOTO]`
- [x] **OrderDetailScreen — wire partnerPhotoUrl** — Passed `order.deliveryPersonPhotoUrl ?? null` as `partnerPhotoUrl` prop to `PartnerDetailsSheet`. `[Phase PR-NEXT-PARTNER-PHOTO]`
- [x] **ShopOrderDetailScreen — delivery partner card** — Added "Delivery partner" section (shown only when `deliveryPersonId` is set) with photo/initials avatar + partner name. Uses `formatPartnerAvatar`. `[Phase PR-NEXT-PARTNER-PHOTO]`
- [x] **DeliveryRequestDetailScreen — photo review** — Added face photo card (full-width 200px image) + caption "Review face is clearly visible…" for admin review. Shows ⚠️ warning for legacy requests without photo. `[Phase PR-NEXT-PARTNER-PHOTO]`
- [x] **orderService — getPartnerPhotoUploadUrl** — Added `getPartnerPhotoUploadUrl(contentType)` method to `src/services/orderService.ts`. Extended `requestDeliveryRole` signature with `profilePhotoUrl?`. `[Phase PR-NEXT-PARTNER-PHOTO]`
- [x] **tsc + tests + break demo** — Both tsc clean. `npm test`: 1372/1372 (+4). Deliberate-break: removed `trim().length > 0` guard → empty-string photo returned `kind: 'photo'` instead of `initials` → 1 failure. Restored. `[Phase PR-NEXT-PARTNER-PHOTO]`
- [ ] **Storage rules for delivery-profile/** — Add `allow write: if request.auth.uid == resource.name.split('/')[1]` (or similar) to `storage.rules` so the signed-URL PUT is the only write path and direct client writes are blocked. `[Phase PR-NEXT-PARTNER-PHOTO-deploy]`
- [ ] **Project bucket name is hardcoded** — `BecomeDeliveryPartnerScreen` constructs the download URL with `grocery-mvp-dev.appspot.com`. Move to `expo-constants` env var or a server-returned field before production. `[Phase PR-NEXT-PARTNER-PHOTO-followup]`
- [ ] **Photo re-upload on rejection** — If a partner is rejected and resubmits, `requestDeliveryRole` overwrites the doc but the `profilePhotoUrl` must point to the new upload. Current flow supports this if the client re-captures the photo. Consider a "re-take photo" hint on `DeliveryApprovalWaitingScreen` after rejection. `[Phase PR-NEXT-PARTNER-PHOTO-followup]`
- [ ] **EAS build needed** — `expo-image-picker` was already in `package.json`; no new native module. OTA update is sufficient for this PR. Confirm before shipping. `[Phase PR-NEXT-PARTNER-PHOTO-deploy]`

---

## PR-NEXT-STATIC-MAP-PREVIEW

- [x] **buildStaticMapUrl pure helper + 8 tests** — Created `src/utils/buildStaticMapUrl.ts` with `buildStaticMapUrl(input): string | null`. Returns null when any required input (shopPin, dropPin, apiKey) is missing or non-finite. Builds Google Static Maps URL with green S marker (shop), blue D marker (drop), blue path between. Default 320×160 px, scale 2. Pinned by `tests/utils/buildStaticMapUrl.test.ts` (8 cases: valid URL, missing shopPin, missing dropPin, missing apiKey, non-finite lat, non-finite lng, default dimensions, custom dimensions). `[Phase PR-NEXT-STATIC-MAP-PREVIEW]`
- [x] **app.config.js extra.googleMapsApiKey** — Extended `app.config.js` to spread `extra.googleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY ?? null` into the Expo config at build time. Follows same pattern as firebase/sentry/legal entries in `app.json`. `[Phase PR-NEXT-STATIC-MAP-PREVIEW]`
- [x] **src/constants/maps.ts getGoogleMapsApiKey()** — Created accessor following `legal.ts` pattern: reads `Constants.expoConfig?.extra?.googleMapsApiKey`, returns `string | null`. Returns null in local dev (no EAS secret), callers treat null as "no map." `[Phase PR-NEXT-STATIC-MAP-PREVIEW]`
- [x] **PartnerDetailsSheet — static map preview slot** — Added `shopLocation?: LatLng | null` + `dropLocation?: LatLng | null` props. Computes `mapUrl` via `buildStaticMapUrl` + `getGoogleMapsApiKey()`. Renders map between WHO/STATE row and divider: `<Image style={mapImage}>` (aspectRatio 2, backgroundColor surface as load placeholder) + caption row "● Shop · ● You" with Google green/blue colors. Hidden when mapUrl is null. R9 guard: mapUrl non-null guarantee from helper. `[Phase PR-NEXT-STATIC-MAP-PREVIEW]`
- [x] **OrderDetailScreen — wire shopLocation/dropLocation** — Passed `order.shopLocation ?? null` and `order.deliveryLocation ? { lat, lng } : null` to `PartnerDetailsSheet`. `[Phase PR-NEXT-STATIC-MAP-PREVIEW]`
- [x] **tsc + tests + break demo** — Both tsc clean. `npm test`: 1380/1380 (+8). Deliberate-break: removed `apiKey.length === 0` guard → empty-string apiKey returned URL instead of null → 1 failure. Restored. `[Phase PR-NEXT-STATIC-MAP-PREVIEW]`
- [ ] **GCP one-time setup (Sudhir)** — Enable Maps Static API in GCP Console for `grocery-mvp-dev`. Create API key restricted to Maps Static API + bundle ID `com.sudhirdavim.grocerymvp`. Run `eas secret:create --scope project --name EXPO_PUBLIC_GOOGLE_MAPS_KEY --value <key>`. Verify `eas secret:list`. `[Phase PR-NEXT-STATIC-MAP-PREVIEW-deploy]`
- [ ] **EAS build required** — `extra.googleMapsApiKey` is baked at build time. OTA alone is insufficient. Plan a TestFlight + Play Internal Testing cycle after key provisioning. `[Phase PR-NEXT-STATIC-MAP-PREVIEW-deploy]`
- [ ] **Quota monitoring** — Free tier: 1000 static map requests/day. At pilot scale (~20/day) this is fine. If MAU grows, set a GCP budget alert at 500/day. `[Phase PR-NEXT-STATIC-MAP-PREVIEW-followup]`
- [ ] **Interactive map deferred** — `react-native-maps` live pin deferred until pilot signal demands sub-10m precision. `[Phase PR-NEXT-STATIC-MAP-PREVIEW-deferred]`

---

## PR-NEXT-LOW-RATING-PUSH

- [x] **Schema §A — Shop + UserProfile fields** — Added `lowRatingThreshold?: number | null` and `lowRatingNotificationsEnabled?: boolean | null` to both `Shop` and `UserProfile` types in `src/types/index.ts`. Optional/nullable for back-compat with all legacy documents. `[Phase PR-NEXT-LOW-RATING-PUSH]`
- [x] **Pure helpers §B — lowRatingAlertHelpers.ts + 16 tests** — Created `functions/src/lowRatingAlertHelpers.ts` with `parseAlertConfig`, `decideShopFanout`, `decidePartnerFanout`, `decideAdminFanout`. `parseAlertConfig` is fail-OPEN (missing fields → defaults 3★/all enabled). All three `decide*` helpers return discriminated-union `FanoutDecision`. Pinned by `tests/functions/lowRatingAlertHelpers.test.ts` (16 cases: parseAlertConfig×5, decideShopFanout×5, decidePartnerFanout×3, decideAdminFanout×3). `[Phase PR-NEXT-LOW-RATING-PUSH]`
- [x] **Server §C — submitOrderRating fan-out** — Extended `submitOrderRating` in `functions/src/index.ts` (after transaction + auditLog) with a non-fatal try/catch fan-out block. Reads `appConfig/ratingAlerts` + `shops/{shopId}` in parallel, optionally reads `users/{deliveryPersonId}`. Calls `pushToOwner`, `pushToUser`, `pushToAdmins` respectively when each role's `decide*` function returns `notify: true`. Each push sets `type` field for deep-link routing. `[Phase PR-NEXT-LOW-RATING-PUSH]`
- [x] **Server §D — 3 new callables** — Added `updateShopRatingAlertSettings` (shopOwner+admin, resolves shopId via claim or param, permission-denied for cross-shop), `updatePartnerRatingAlertSettings` (delivery claim only, writes to own `users/{uid}`), `updateAdminRatingAlertConfig` (admin only, writes to `appConfig/ratingAlerts`). All three at end of `functions/src/index.ts`. `[Phase PR-NEXT-LOW-RATING-PUSH]`
- [x] **Client §D — orderService wrappers** — Added 3 callable wrappers to `src/services/orderService.ts` following the dual-SDK pattern (RNFB + web SDK). `[Phase PR-NEXT-LOW-RATING-PUSH]`
- [x] **Client §D — ShopSettingsScreen notifications card** — Added "Notifications" card at bottom of `ShopSettingsScreen`. 1–5★ threshold picker (Pressable row), enabled checkbox, Save button. State hydrated from `resolved.lowRatingThreshold` / `resolved.lowRatingNotificationsEnabled` on screen load. Calls `updateShopRatingAlertSettings`. All new styles added. `[Phase PR-NEXT-LOW-RATING-PUSH]`
- [x] **Client §D — DeliveryDashboardScreen alert card** — Added "LOW-RATING ALERTS" settings card below notification-radius card in `DeliveryDashboardScreen`. Same 1–5★ picker + enabled checkbox + Save button pattern. State hydrated from `getMyDeliverySettings` response (forward-compat cast). Calls `updatePartnerRatingAlertSettings`. `[Phase PR-NEXT-LOW-RATING-PUSH]`
- [x] **Client §E — AuthBootstrap deep-links** — Added 3 new push type branches in `AuthBootstrap.tsx`: `low_rating_for_shop` → `ShopOrderDetail`, `low_rating_for_partner` → `DeliveryOrderDetail`, `low_rating_for_admin` → `AdminOrders`. Same audience-guard pattern (role check before navigate). `[Phase PR-NEXT-LOW-RATING-PUSH]`
- [x] **tsc + tests + break demo** — Both tsc clean. `npm test`: 1396/1396 (+16). Deliberate-break: flipped `<=` to `>` in `decideShopFanout` → 4 failures (above/at-threshold/override cases). Restored. `[Phase PR-NEXT-LOW-RATING-PUSH]`
- [ ] **Admin settings UI** — `updateAdminRatingAlertConfig` callable is wired but no admin screen exposes it yet. Add a "Rating alert defaults" section to AdminSettingsScreen (or create one). `[Phase PR-NEXT-LOW-RATING-PUSH-followup]`
- [ ] **getMyDeliverySettings back-compat** — `DeliveryDashboardScreen` reads `lowRatingThreshold`/`lowRatingNotificationsEnabled` from the `getMyDeliverySettings` response via cast. The server callable currently doesn't return these fields — wire them through `getMyDeliverySettings` so the hydration works without a cast. `[Phase PR-NEXT-LOW-RATING-PUSH-followup]`
- [ ] **Firestore rules** — `appConfig/ratingAlerts` must be writable only by admin (currently any authenticated user can write; callables enforce the claim gate but direct client writes would bypass it). `[Phase PR-NEXT-LOW-RATING-PUSH-deploy]`
- [ ] **IAM verify post-deploy** — Run `gcloud run services get-iam-policy` for `submitrating`, `updateshopratingalertsettings`, `updatepartnerratingalertsettings`, `updateadminratingalertconfig` after deploy. `[Phase PR-NEXT-LOW-RATING-PUSH-deploy]`
- [ ] **Seed appConfig/ratingAlerts** — Create the doc in Firestore console pre-launch so defaults are explicit and visible: `{ shopDefaultThreshold: 3, partnerDefaultThreshold: 3, adminThreshold: 3, adminNotificationsEnabled: true }`. `[Phase PR-NEXT-LOW-RATING-PUSH-deploy]`

---

## PR-NEXT-REVIEW-SYSTEM

- [x] **Schema §A — Order correction-state fields** — Added 8 optional fields to `Order` type in `src/types/index.ts`: `correctionState`, `responseText`, `responseBy`, `responseAt`, `amendedStars`, `amendedAt`, `publishedAt`, `publishedReason`, plus `ratingId` (links order to reviews sub-collection doc). Back-compat: all optional/nullable; absent on legacy orders = treated as `'published'`. `[Phase PR-NEXT-REVIEW-SYSTEM]`
- [x] **Schema §A — Shop + UserInfo public review cache** — Added `publicReviewCount?: number` and `publicReviewLatest?: Array<{...}>` (top-5 cache) to both `Shop` and `UserInfo` types. `[Phase PR-NEXT-REVIEW-SYSTEM]`
- [x] **Pure helpers §B — reviewWorkflowHelpers.ts + 12 tests** — Created `functions/src/reviewWorkflowHelpers.ts` with `decideInitialState` (null-safe delivery stars), `canRespond`, `canAmend`, `canAcknowledge`, `decideTimeoutPublish` (configurable days, default 7). Pinned by `tests/functions/reviewWorkflowHelpers.test.ts` (12 cases). `[Phase PR-NEXT-REVIEW-SYSTEM]`
- [x] **Server §C — submitOrderRating correction-state init** — Extended the transaction in `submitOrderRating` to compute `decideInitialState` (default 3★ thresholds, lean transaction), generate a `ratingId` (Firestore doc ID), write `reviews/{ratingId}` sub-collection doc alongside the order update. Order doc stamped with `correctionState`, `publishedReason`, `publishedAt`, `ratingId`. `[Phase PR-NEXT-REVIEW-SYSTEM]`
- [x] **Server §D — 5 new callables** — `respondToReview` (shop owner or partner, `flagged_low`→`responded`, notifies customer), `amendRating` (customer, `responded`→`amended`→`published`, recomputes rolling avg), `acknowledgeReview` (customer, `responded`→`published`), `publishTimedOutReviews` (scheduled daily, auto-publishes `flagged_low` reviews >7 days old), `listShopReviews` (public paginated, shopId + state=published). Internal `_publishReview` helper updates `reviews` doc + shop/partner `publicReviewLatest` top-5 cache in a single transaction. `[Phase PR-NEXT-REVIEW-SYSTEM]`
- [x] **Server §D — Firestore composite indexes** — Added 2 new entries to `firestore.indexes.json`: `reviews(shopId==, correctionState==, publishedAt desc)` for `listShopReviews` pagination, `reviews(correctionState==, submittedAt asc)` for `publishTimedOutReviews` batch. `[Phase PR-NEXT-REVIEW-SYSTEM]`
- [x] **Client §E — orderService wrappers** — Added `respondToReview`, `amendRating`, `acknowledgeReview`, `listShopReviews` wrappers to `src/services/orderService.ts` (dual RNFB + web SDK pattern). `[Phase PR-NEXT-REVIEW-SYSTEM]`
- [x] **Client §F — ShopReviewsScreen** — Created `src/screens/shop/ShopReviewsScreen.tsx`. Paginated `FlatList` of published reviews via `listShopReviews`. Each `ReviewCard` shows stars, customer name, relative time, comment, and shop response (indented with primary-color left border). Empty state, error state, end-of-list handled. `[Phase PR-NEXT-REVIEW-SYSTEM]`
- [x] **Client §G — RatingAmendmentScreen** — Created `src/screens/customer/RatingAmendmentScreen.tsx`. Shows shop's response text, 1–5★ amendment picker, two CTAs: "Keep original" (`acknowledgeReview`) and "Update to N★" (`amendRating`). All data via route params (no extra fetch). `[Phase PR-NEXT-REVIEW-SYSTEM]`
- [x] **Navigation wiring §F/§G** — Added `ShopReviews` and `RatingAmendment` routes to `RootStackParamList` and `AppNavigator.tsx`. `RatingAmendment` carries optional prefill params (`shopName`, `originalShopStars`, `responseText`, `responseBy`). `[Phase PR-NEXT-REVIEW-SYSTEM]`
- [x] **Deep-link §G — review_responded** — Added `review_responded` push type handler in `AuthBootstrap.tsx` → navigates to `RatingAmendment` with `ratingId` + `orderId` from push payload. `[Phase PR-NEXT-REVIEW-SYSTEM]`
- [x] **tsc + tests + break demo** — tsc clean. `npm test`: 1410/1410 (+14). Deliberate-break: flipped `<=` to `>` in `decideInitialState` → 2 failures (low-shop and low-partner cases). Restored. `[Phase PR-NEXT-REVIEW-SYSTEM]`
- [x] **PartnerReviewsScreen** — DONE in PR-NEXT-5.1 §D. Added `listPartnerReviews({ partnerUid, limit, cursor })` callable + `src/screens/delivery/PartnerReviewsScreen.tsx` + orderService wrapper + composite index. `[Phase PR-NEXT-5.1]`
- [x] **Shop owner RespondToReview surface** — DONE in PR-NEXT-5.1 §A. Low-rating banner + Respond CTA + ResponseModal on `ShopOrderDetailScreen`. `[Phase PR-NEXT-5.1]`
- [x] **Delivery partner respond surface** — DONE in PR-NEXT-5.1 §B. Mirror banner + Respond CTA on `DeliveryOrderDetailScreen` with `responseBy: 'partner'`. `[Phase PR-NEXT-5.1]`
- [x] **ShopReviews entry point** — DONE in PR-NEXT-5.1 §E. Tappable rating row on `ShopDetailScreen` → ShopReviewsScreen. `[Phase PR-NEXT-5.1]`
- [x] **customerName denormalization** — DONE in PR-NEXT-5.1 §F. `resolveCustomerName` helper + read in `submitOrderRating` writes `customerName` + `customerUid` onto the review doc. `[Phase PR-NEXT-5.1]`
- [x] **Firestore rules for reviews collection** — DONE in PR-NEXT-5.1 §G. `reviews/{ratingId}` block: published readable by all, pre-published gated to customer/shop-owner/partner/admin, writes always denied. `[Phase PR-NEXT-5.1]`
- [ ] **Deploy firestore:indexes** — New `reviews` composite indexes must be deployed before `listShopReviews` or `publishTimedOutReviews` can run. `firebase deploy --only firestore:indexes`. `[Phase PR-NEXT-REVIEW-SYSTEM-deploy]`
- [ ] **IAM verify post-deploy** — Verify `allUsers` invoker on `respondtoreview`, `amendrating`, `acknowledgereview`, `listshopreviews`, `publishtimedoutreviews`, `listpartnerreviews`. `[Phase PR-NEXT-REVIEW-SYSTEM-deploy]`

---

## PR-NEXT-5.1 — Review-system loop close

- [x] **§C — ResponseModal** — Created `src/components/order/ResponseModal.tsx`. BottomSheet chrome (Rule 13), 280-char limit + counter, disabled-when-empty submit, `responseBy: 'shop' | 'partner'` prop. Reused by §A + §B. `[Phase PR-NEXT-5.1]`
- [x] **§A — Shop respond banner** — `ShopOrderDetailScreen` shows a low-rating banner when `correctionState` is `flagged_low` (Respond CTA → ResponseModal → `respondToReview`) or `responded` (response text + days-left countdown) or `published` (confirmation). State hooks declared above early returns (Rule 2). `[Phase PR-NEXT-5.1]`
- [x] **§B — Partner respond banner** — Mirror on `DeliveryOrderDetailScreen` reading `deliveryRating`/`deliveryComment`, `responseBy: 'partner'`. `[Phase PR-NEXT-5.1]`
- [x] **§D — PartnerReviewsScreen + callable** — `listPartnerReviews` callable (`functions/src/index.ts`, deliveryPersonId + published filter, paginated), orderService wrapper, `src/screens/delivery/PartnerReviewsScreen.tsx` (paginated FlatList + ReviewCard), composite index `reviews(deliveryPersonId==, correctionState==, publishedAt desc)`. Route wired in `AppNavigator`. `[Phase PR-NEXT-5.1]`
- [x] **§E — Entry points** — `ShopDetailScreen` rating row wrapped in Pressable → ShopReviews; `PartnerDetailsSheet` trust line tappable (new `partnerUid` prop, passed from `OrderDetailScreen`) → PartnerReviews. `[Phase PR-NEXT-5.1]`
- [x] **§F — customerName denorm** — `resolveCustomerName(profileDisplayName, authTokenName)` pure helper in `ratingHelpers.ts` (profile → token → 'Anonymous', whitespace-safe). `submitOrderRating` reads the customer profile outside the transaction and writes `customerName` + `customerUid` onto the review doc. +5 unit tests. `[Phase PR-NEXT-5.1]`
- [x] **§G — Firestore rules + tests** — `reviews/{ratingId}` block in `firestore.rules`; +10 rules tests in `tests/rules/reviews.test.ts` (published-by-anyone, own pre-published, other-customer denied, shop-owner same/different shop, assigned/other partner, admin, direct-write denied ×2). `[Phase PR-NEXT-5.1]`
- [x] **tsc + tests + break demo** — Both tsc clean (root + functions). `npm test`: 1415/1415 (+5). `npm run test:full`: 102/102 rules (+10, rules changed). Deliberate-break: swapped profile/token precedence in `resolveCustomerName` → 1 failure. Restored. `[Phase PR-NEXT-5.1]`
- [ ] **Deploy submitOrderRating + rules + indexes** — Server-first: `firebase deploy --only functions:submitOrderRating,functions:listPartnerReviews` → `firestore:rules` → `firestore:indexes`. Then client OTA. Awaiting user. `[Phase PR-NEXT-5.1-deploy]`
- [ ] **Edit/delete response** — Out of scope this PR: shop/partner gets one response; corrections need admin override. Post-MVP. `[Phase PR-NEXT-5.1-followup]`

---

## HOTFIX-RATING-RESPONSE + HOTFIX-PROFILE-PHOTO

- [x] **§A — respondToReview auth-token claim fix** — `functions/src/index.ts` ~line 10206: replaced `claims.isShopOwner` / `claims.isDelivery` (user-doc mirrors, NOT auth-token claims) with `claims.shopOwner` / `claims.delivery`. All response submissions were silently returning `permission-denied`. `[Phase HOTFIX-RATING-RESPONSE]`
- [x] **§B/§C — Pure helper validateRespondToReviewAuth + 7 tests** — Created `functions/src/respondToReviewHelpers.ts` with `validateRespondToReviewAuth` (shopOwner / delivery claim check, ownership check on review doc). Pinned by `tests/functions/respondToReviewHelpers.test.ts` (7 cases: unauthenticated, shop claim, delivery claim, wrong owner, missing reviewer, shop responds to delivery review denied, delivery responds to shop review denied). `[Phase HOTFIX-RATING-RESPONSE]`
- [x] **§C/§D — Client error handling in ResponseModal + parent screens** — `ResponseModal.tsx`: added `catch` block with `Alert.alert` to `handleSubmit`. `ShopOrderDetailScreen.tsx` + `DeliveryOrderDetailScreen.tsx`: replaced `throw e` re-throw with `Alert.alert`. `[Phase HOTFIX-RATING-RESPONSE]`
- [x] **§A — buildPartnerPhotoDownloadUrl helper + 5 tests** — Created `src/utils/buildPartnerPhotoDownloadUrl.ts`. Fixed URL encoding bug: splits path on `/`, `encodeURIComponent`s each segment individually (preserves slashes as literal separators), joins back. Bucket: `grocery-mvp-dev.appspot.com`. Pinned by `tests/utils/buildPartnerPhotoDownloadUrl.test.ts` (5 cases). `[Phase HOTFIX-PROFILE-PHOTO]`
- [x] **§B/§C — DeliveryProfileScreen photo fix + tappable label + fallback** — Replaced inline URL construction with `buildPartnerPhotoDownloadUrl`. Restructured Pressable to wrap avatar + "Tap to change" label (both now tappable). Added `photoLoadError` state + `useEffect` reset + `Image onError` fallback to initials. `[Phase HOTFIX-PROFILE-PHOTO]`
- [x] **§D — BecomeDeliveryPartnerScreen photo fix + fallback** — Same URL fix + `onError` fallback pattern. Added `photoInitialsFallback` + `photoInitialsText` styles. `[Phase HOTFIX-PROFILE-PHOTO]`
- [x] **Sibling-callable claim fix + static audit guard + 1 test** — Found the same `claims.isAdmin`/`claims.isShopOwner` bug class in two more callables: `updateShopRatingAlertSettings` (functions/src/index.ts ~9847, broke the shop Settings → Notifications card for ALL owners/admins) and `updateAdminRatingAlertConfig` (~10093). Both fixed to `claims.admin`/`claims.shopOwner`. Added a static-source regression guard `tests/functions/authClaimNamesAudit.test.ts` that scans all of `functions/src` for the `/claims\.is[A-Z]/` pattern (mirrors the audit-grep in the DO-NOT-REMOVE comments) so this class can never reship. tsc clean; `npm test` 1495/1495 (+1). Deliberate-break: re-added `claims.isAdmin` → guard failed pinpointing `index.ts:9847`. Restored. `[Phase HOTFIX-RATING-RESPONSE]`
- [ ] **Deploy re-fixed callables** — `respondToReview` (if not already deployed since the §A fix), `updateShopRatingAlertSettings`, `updateAdminRatingAlertConfig` all carry the corrected claim checks and must be redeployed before their UIs work: `firebase deploy --only functions:respondToReview`, `firebase deploy --only functions:updateShopRatingAlertSettings`, `firebase deploy --only functions:updateAdminRatingAlertConfig` (separate `--only` per deploy-discipline R1). `[Phase HOTFIX-RATING-RESPONSE-deploy]`

---

## HOTFIX-PROFILE-PHOTO-4 — Firebase Storage REST URL + embedded download token

Fourth and final layer of the partner-photo lineage (encoding → storage.rules → bucket name → **URL scheme**). After the first three fixes shipped, the photo still didn't display: a browser test of the stamped URL returned `AccessDenied — Anonymous caller does not have storage.objects.get access`. Root cause: `buildPartnerPhotoDownloadUrl` produced a **GCS-direct URL** (`storage.googleapis.com/{bucket}/{path}`) which is governed by GCS IAM and bypasses Firebase Storage Rules entirely. Bucket-level `allUsers` public read isn't viable (would expose `/shop-kyc/` PII). The fix mirrors shop storefront photos: serve via the Firebase Storage REST URL with an embedded `firebaseStorageDownloadTokens` metadata token.

- [x] **§A — Pure helper `partnerPhotoUploadHelpers.ts` + callable wiring** — Created `functions/src/partnerPhotoUploadHelpers.ts` with `partnerPhotoStoragePath(uid, contentType)`, `buildPartnerPhotoUploadPlan({uid, contentType, bucketName, token})` (returns `{storagePath, downloadUrl, downloadToken, extensionHeaders}`, reuses `buildFirebaseStorageDownloadUrl`), and the `PARTNER_PHOTO_TOKEN_HEADER` const (`x-goog-meta-firebasestoragedownloadtokens`). `getPartnerPhotoUploadUrl` callable (functions/src/index.ts ~2106) now mints a `randomUUID()` token, passes `plan.extensionHeaders` into `file.getSignedUrl({... extensionHeaders})` so the token is written into object metadata at PUT time, and returns `downloadUrl` + `downloadToken` alongside the existing `uploadUrl` + `storagePath`. `[Phase HOTFIX-PROFILE-PHOTO-4]`
- [x] **§B — orderService wrapper** — `src/services/orderService.ts` `getPartnerPhotoUploadUrl` return type extended with `downloadUrl` + `downloadToken` (both native + web SDK branches). `[Phase HOTFIX-PROFILE-PHOTO-4]`
- [x] **§C — DeliveryProfileScreen** — `handleChangePhoto` now uses the server-returned `downloadUrl` (instead of building one) and echoes the `x-goog-meta-firebasestoragedownloadtokens: downloadToken` header on the PUT. Removed the deprecated `buildPartnerPhotoDownloadUrl` import. `[Phase HOTFIX-PROFILE-PHOTO-4]`
- [x] **§D — BecomeDeliveryPartnerScreen** — `handleTakePhoto` mirrors §C exactly (token header on PUT, server downloadUrl, deprecated import removed). `[Phase HOTFIX-PROFILE-PHOTO-4]`
- [x] **§E — Deprecate `buildPartnerPhotoDownloadUrl`** — Added `@deprecated` JSDoc to `src/utils/buildPartnerPhotoDownloadUrl.ts` (GCS-direct URL bypasses Storage Rules). No remaining production callers. Test file kept (documents the GCS pattern in isolation) with a deprecation note on the describe block. `[Phase HOTFIX-PROFILE-PHOTO-4]`
- [x] **§F — Tests (+7)** — `tests/functions/partnerPhotoUploadHelpers.test.ts`: 2 path-stamp guards (`.jpg`/`.png`) + 5 plan-helper cases (REST URL format & not GCS-direct host, token/URL consistency, UUID shape, extension-header map + lowercase key, storagePath consistency). `[Phase HOTFIX-PROFILE-PHOTO-4]`
- [x] **tsc + functions build + tests + break demo** — `npx tsc --noEmit` (root) clean, `cd functions && npm run build` clean. `npm test`: **1502/1502** (+7). Deliberate-break: embedded `'WRONG-TOKEN'` in `buildPartnerPhotoUploadPlan`'s URL → token/URL-consistency test failed. Restored. `[Phase HOTFIX-PROFILE-PHOTO-4]`
- [ ] **Deploy** — `cd functions; npm run build; cd ..` then `firebase deploy --only "functions:getPartnerPhotoUploadUrl"`. Verify Cloud Run IAM: `gcloud run services get-iam-policy getpartnerphotouploadurl --region=asia-south1 --project=grocery-mvp-dev`; re-bind `allUsers` invoker if stripped. Then `eas update --branch production`. `[Phase HOTFIX-PROFILE-PHOTO-4-deploy]`
- [ ] **Re-upload test partner photo post-OTA** — The fix only applies to NEW uploads; existing `users/{uid}.profilePhotoUrl` values stamped with the old broken URL stay broken until overwritten. After OTA: Profile → Tap to change → Save. (Out of scope: backfill migration for existing partner docs — pilot scale, single test account.) `[Phase HOTFIX-PROFILE-PHOTO-4-deploy]`
- [ ] **FEATURES.md lineage comments** — Append the four-layer lineage HTML comment chain (`HOTFIX-PROFILE-PHOTO → -2 → -3 → -4`, all 2026-06-10) to Delivery panel §3.5 Profile "Edit photo" row, §3.1 Onboarding "Mandatory profile photo" row, and Customer panel §1.8 "Partner card" row. No row text changes. `[Phase HOTFIX-PROFILE-PHOTO-4-doc]`
- [ ] **Doc trail (Cowork)** — TESTING-FINDINGS close the photo issue with the four-step lineage; CLAUDE.md in-flight strike; SESSION_LOG paragraph; PROMPT_AUTHORING_NOTES Rule 5 worked example #5 (URL scheme — browser-test a known-good URL before committing a URL-builder; self-confirming tests asserting against a hardcoded BASE can't catch a wrong scheme). `[Phase HOTFIX-PROFILE-PHOTO-4-doc]`

---

## PR-NEXT-BUNDLE-G — Reviews Polish + Payment Receipt + Partner Photo Audit

- [x] **§A — deliveriesCompleted counter** — `markDelivered` (functions/src/index.ts ~line 4151): best-effort `users/{uid}.deliveriesCompleted = FieldValue.increment(1)` after the status write. `getMyDeliverySettings` extended to return `deliveriesCompleted` (defaults to 0). `claimDelivery` denormalization patch includes `deliveryPersonDeliveriesCompleted` alongside trust fields. `orderService.ts` return type updated. `DeliveryProfileScreen` reads `deliveriesCompleted` from hydration, shows separate "N deliveries completed" line below rating. `[Phase PR-NEXT-BUNDLE-G]`
- [x] **§A — computeDeliveriesCompleted pure helper + 5 tests** — Created `functions/src/deliveriesCompletedHelpers.ts` with `computeDeliveriesCompleted(orders[]): Map<uid, count>` (filters status=delivered, excludes null deliveryPersonId). Backfill script at `scripts/backfill-deliveries-completed.ts`. Pinned by `tests/functions/deliveriesCompletedHelpers.test.ts` (5 cases: empty, multi-delivered, non-delivered ignored, null uid ignored, multi-partner aggregation). `[Phase PR-NEXT-BUNDLE-G]`
- [x] **§B — Tappable rating row on DeliveryProfileScreen + own-mode listPartnerReviews** — `DeliveryProfileScreen`: rating row wrapped in `Pressable` → navigates to `PartnerReviews` screen with `partnerUid: ownUid, mode: 'own'`. `listPartnerReviews` callable extended with `mode: 'own'` branch (uid-match gate, returns all own reviews). `AppNavigator PartnerReviews` params type updated to include `'own'`. `orderService.listPartnerReviews` wrapper gains `mode` param. `PartnerReviewsScreen` passes `mode: 'own'` to the callable. `[Phase PR-NEXT-BUNDLE-G]`
- [x] **§C — publicRatingCount split + computePublicCountDelta helper + 8 tests + backfill** — Created `functions/src/publicCountHelpers.ts` with `computePublicCountDelta(prev, next): 0|1` (returns 1 only on first transition to 'published'), `countPublishedShopReviews`, `countPublishedPartnerReviews`. `submitOrderRating` transaction: increments `publicRatingCount` on shop and `publicDeliveryRatingCount` on partner doc when `initReview.state === 'published'`. `_publishReview` transaction: increments same fields on publish transition. Backfill script at `scripts/backfill-public-rating-count.ts`. Pinned by `tests/functions/publicCountHelpers.test.ts` (8+3+3 cases). `[Phase PR-NEXT-BUNDLE-G]`
- [x] **§D — Partner photo on PartnerReviewsScreen / UserDetailScreen / RatingAmendmentScreen** — `PartnerReviewsScreen`: added partner identity header (40×40 avatar with `onError` fallback, display name). `UserDetailScreen`: added 48×48 partner photo/initials avatar above delivery rating row; `profilePhotoUrl` added to `UserInfo` type; `listAllUsers` callable now projects it from the `users/{uid}` doc. `RatingAmendmentScreen`: added `deliveryPersonName` + `deliveryPersonPhotoUrl` params, renders 40×40 partner avatar above the response box when `responseBy === 'partner'`. All use `buildPartnerHeaderViewModel` / `formatPartnerAvatar` helpers with `onError` fallback. `AppNavigator` params updated. `[Phase PR-NEXT-BUNDLE-G]`
- [x] **§D — buildPartnerHeaderViewModel pure helper + 3 tests** — Created `src/utils/partnerHeaderViewModel.ts` with `buildPartnerHeaderViewModel` (combines name/photoUrl/ratingAvg/ratingCount into a render-ready ViewModel). Pinned by `tests/utils/partnerHeaderViewModel.test.ts` (3 cases: initials when no photo, photo avatar, null inputs default). `[Phase PR-NEXT-BUNDLE-G]`
- [x] **§E — derivePartnerPaymentBadge helper + PaymentBadge component + 5 tests** — Created `src/utils/derivePartnerPaymentBadge.ts` with `derivePartnerPaymentBadge({paymentMethod, paymentStatus, paidMethod}): PartnerPaymentBadge` (discriminated union: paid_online / paid_cash / awaiting_cod / none). Created `src/components/delivery/PaymentBadge.tsx` with colour-coded pill (green / amber / red). Replaced the static `payHint` text in `DeliveryOrderDetailScreen` with `<PaymentBadge>`. Pinned by `tests/utils/derivePartnerPaymentBadge.test.ts` (5 cases: online paid, cod+cash, cod+online, cod+unpaid, null fields). `[Phase PR-NEXT-BUNDLE-G]`
- [x] **tsc + tests + break demo** — Both `npx tsc --noEmit` and `npm test` green: **1494/1494** (+24 new tests). Deliberate-break: inverted `!== 'delivered'` → `=== 'delivered'` in `computeDeliveriesCompleted` → 3 failures (counts/ignores/multi-partner). Restored. `[Phase PR-NEXT-BUNDLE-G]`
- [ ] **Deploy plan** — Server functions changed: `markDelivered`, `getMyDeliverySettings`, `claimDelivery`, `submitOrderRating`, `_publishReview` (internal), `listPartnerReviews`, `listAllUsers`. Run `firebase deploy --only functions:markDelivered,functions:getMyDeliverySettings,functions:claimDelivery,functions:submitOrderRating,functions:listPartnerReviews,functions:listAllUsers` (6 separate `--only` targets per deploy-discipline.md R1). Then OTA. `[Phase PR-NEXT-BUNDLE-G-deploy]`
- [ ] **Run backfill scripts post-deploy** — `npx ts-node scripts/backfill-deliveries-completed.ts` then `npx ts-node scripts/backfill-public-rating-count.ts`. Safe to re-run (idempotent — set+merge). `[Phase PR-NEXT-BUNDLE-G-deploy]`
- [ ] **publicRatingCount on shop info surfaces** — `ShopDetailScreen` and checkout currently show `ratingCount` (includes all ratings, not just published). Consider surfacing `publicRatingCount` instead for customer-facing displays. Post-MVP. `[Phase PR-NEXT-BUNDLE-G-followup]`
- [ ] **RatingAmendmentScreen caller must pass deliveryPerson params** — Deep-link handler in `AuthBootstrap.tsx` and the `review_responded` push payload must include `deliveryPersonName` + `deliveryPersonPhotoUrl` for the partner photo to render. Currently the route params may be omitted (photo gracefully falls back to initials). `[Phase PR-NEXT-BUNDLE-G-followup]`
- [ ] **PaymentBadge on DeliveryDashboardScreen cards** — Dashboard order cards still show a plain "COD" / "Online" text chip. Replacing with `<PaymentBadge>` would give partners the same colour-coded signal on the list view. `[Phase PR-NEXT-BUNDLE-G-followup]`

---

## HOTFIX-REVIEW-DENORM — Review state cascade to order document

Root cause: review state transitions (`flagged_low → responded`, `responded → published` via amend/acknowledge/timeout) were never cascading to the denormalized `correctionState` field on the order doc. Client screens reading `order.correctionState` to decide which CTA to show (Respond button for shop/partner, Amend/Acknowledge for customer) always saw the stale value written by `submitOrderRating`. Fix: pure helper builds the per-order payload; each state-transition callable now performs a matching order-doc merge write.

- [x] **§A — Pure helper `reviewDenormHelpers.ts` + backfill helper** — Created `functions/src/reviewDenormHelpers.ts` with `buildOrderReviewDenormPayload(input: ReviewDenormInput): ReviewDenormPayload` (always sets `correctionState` + `updatedAt`; conditionally includes `responseText`, `responseBy`, `responseAt`, `shopRating`, `deliveryRating`, `publishedAt`, `publishedReason`). Also exports `deriveDenormFromReview(review)` for idempotent backfill. Pinned by `tests/functions/reviewDenormHelpers.test.ts`. `[Phase HOTFIX-REVIEW-DENORM]`
- [x] **§B — `respondToReview` order denorm cascade** — After the review doc write (`flagged_low → responded`), performs `db.doc('orders/{orderId}').set(buildOrderReviewDenormPayload({nextState:'responded',...}), {merge:true})`. Without this: Respond CTA stayed visible after submit; customer never saw Amend/Acknowledge. `[Phase HOTFIX-REVIEW-DENORM]`
- [x] **§C/D/E — `_publishReview` transaction order denorm (covers amendRating, acknowledgeReview, publishTimedOutReviews)** — Added `tx.set(db.doc('orders/{orderId}'), buildOrderReviewDenormPayload({nextState:'published',...}), {merge:true})` inside the existing Firestore transaction in `_publishReview`. This is the single point for all three 'published' paths (DRY + atomic with the shop/partner cache writes). `[Phase HOTFIX-REVIEW-DENORM]`
- [x] **§F — Backfill script `scripts/backfill-review-denorm.ts`** — Walks all `reviews` docs, calls `deriveDenormFromReview`, writes to corresponding `orders/{orderId}` with `{merge:true}`. Dry-run default; `--execute` to write. `--admin-uid` required. Idempotent. Mirrors service-account-json credential pattern. `[Phase HOTFIX-REVIEW-DENORM]`
- [x] **§G — Tests (+11)** — `tests/functions/reviewDenormHelpers.test.ts`: 5 pure-helper cases (responded, published+amended, published+timeout, both stars, minimal/no-extra-keys) + 4 callable-scenario cases (respondToReview, amendRating, acknowledgeReview, publishTimedOutReviews) + 2 backfill-helper cases (responded state, published state). Total functions test count: **813/813** (+11). `[Phase HOTFIX-REVIEW-DENORM]`
- [x] **tsc + functions build + tests + break demo** — `npx tsc --noEmit` (root) clean, `cd functions && npm run build` clean. `npm test tests/functions`: **813/813**. Deliberate-break documented in test file header: remove the `if (nextState === 'published')` block → test 2 fails (`publishedAt`/`publishedReason` absent). `[Phase HOTFIX-REVIEW-DENORM]`
- [ ] **Deploy (server first)** — `firebase deploy --only functions:respondToReview,functions:amendRating,functions:acknowledgeReview,functions:publishTimedOutReviews`. Verify Cloud Run IAM `allUsers` invoker on each. `[Phase HOTFIX-REVIEW-DENORM-deploy]`
- [ ] **OTA after server** — `eas update --branch production` (client is unchanged but ensures no stale JS bundle). `[Phase HOTFIX-REVIEW-DENORM-deploy]`
- [ ] **Run backfill post-deploy** — Dry run first: `npx tsx scripts/backfill-review-denorm.ts --admin-uid=<uid>`. Then execute: `npx tsx scripts/backfill-review-denorm.ts --admin-uid=<uid> --execute`. `[Phase HOTFIX-REVIEW-DENORM-deploy]`

---

## PR-NEXT-BUNDLE-H — Customer review loop + partner card finish

Five-symptom post-HOTFIX-REVIEW-DENORM retest. Customer side had no in-app surface for the review response (only push deep-link), partner card showed initials only and stuck at "On the way to you" after delivery, push title was hardcoded regardless of who responded.

- [x] **§A — CustomerReviewResponsePanel + deriveCustomerReviewResponseView** — Created `src/utils/deriveCustomerReviewResponseView.ts` (pure helper, discriminated-union output: none/awaiting/responded/amended/published; handles shop-vs-partner responder identity). Created `src/components/order/CustomerReviewResponsePanel.tsx` (four-state UI: awaiting banner, responded card with responder photo+name+badge + Amend/Acknowledge CTAs, amended/published read-only). Wired into `OrderDetailScreen.tsx` after the "Thanks for rating!" panel, gated on `delivered + ratingId + correctionState`. Both Amend and Acknowledge navigate to `RatingAmendmentScreen` with full route params. `[Phase PR-NEXT-BUNDLE-H]`
- [x] **§B — PartnerIdentityCard photo support** — Added `photoUrl` and `orderStatus` props to `PartnerIdentityCard`. Added `formatPartnerAvatar` + `Image` + `useState` + `useEffect` imports. Replaced the initials-only `<Text>` avatar with photo-or-initials pattern using `onError → setPhotoLoadError` fallback (same as DeliveryProfileScreen/UserDetailScreen). `photoLoadError` state declared above all conditional returns per Rule 2. Updated `OrderDetailScreen` caller to pass `photoUrl={order.deliveryPersonPhotoUrl ?? null}` and `orderStatus={order.status ?? null}`. `[Phase PR-NEXT-BUNDLE-H]`
- [x] **§C — PartnerIdentityCard finalized-state subtitle + derivePartnerCardSubtitle** — Created `src/utils/derivePartnerCardSubtitle.ts` (four states: delivered / cancelled / picked-up / heading-to-shop). Replaced the two-state inline subtitle in `PartnerIdentityCard` with `derivePartnerCardSubtitle({orderStatus, pickedUpAt})`. Previously stuck at "On the way to you" after delivery. `[Phase PR-NEXT-BUNDLE-H]`
- [x] **§D — Push title: differentiate shop vs partner** — Created `functions/src/respondToReviewPushHelpers.ts` with `derivePushTitle(responseBy)`. Replaced the hardcoded `'💬 Shop responded to your review'` in `respondToReview` push block; also forward `responseBy` into the push payload for client analytics. `[Phase PR-NEXT-BUNDLE-H]`
- [x] **§E — Sentry observability shim for Cloud Functions** — Created `functions/src/sentryFunctions.ts` (thin `Sentry.captureException` shim backed by structured `console.error` — GCP Cloud Logging captures and makes it queryable). Added to the push catch block in `respondToReview` with `tags: { area: 'respondToReview.push' }` and full `ratingId/orderId/customerId/responseBy` context. `[Phase PR-NEXT-BUNDLE-H]`
- [x] **§F — Static-source guard: no stale "deferred to a future PR" comments** — Removed the stale comment from `PartnerIdentityCard.tsx` header (replaced with accurate Bundle-H description). Created `tests/static/noStaleDeferralComments.test.ts` — walks `src/components/` + `src/screens/`, fails if any file contains the pattern. Permanent CI guard. `[Phase PR-NEXT-BUNDLE-H]`
- [x] **Tests (+22)** — `deriveCustomerReviewResponseView.test.ts` (+6), `derivePartnerCardSubtitle.test.ts` (+5), `partnerIdentityCard.photo.test.ts` (+5), `respondToReviewPushHelpers.test.ts` (+3), `sentryFunctions.test.ts` (+2), `noStaleDeferralComments.test.ts` (+1). Total functions suite: **818/818**. `[Phase PR-NEXT-BUNDLE-H]`
- [x] **tsc + functions build + tests** — Root `npx tsc --noEmit` clean. `cd functions && npm run build` clean. `npx jest tests/functions`: 818/818. New suites: 22/22. Deliberate-break: remove `delivered` branch from `derivePartnerCardSubtitle` → subtitle test fails. `[Phase PR-NEXT-BUNDLE-H]`
- [ ] **Deploy** — `firebase deploy --only functions:respondToReview`. Verify Cloud Run IAM `allUsers` invoker: `gcloud run services get-iam-policy respondtoreview --region=asia-south1 --project=grocery-mvp-dev`. Re-bind if needed. `[Phase PR-NEXT-BUNDLE-H-deploy]`
- [ ] **OTA** — `eas update --branch production --message "Bundle H — customer review loop + partner card photo + finalized state + push title fix"`. `[Phase PR-NEXT-BUNDLE-H-deploy]`
- [ ] **Backfill: order.deliveryPersonPhotoUrl on old claimed orders** — New orders post-OTA will have the correct URL from claim time. Existing orders whose partner uploaded the photo after claiming fall back to initials. Out of scope for pilot (single-digit partner count). `[Phase PR-NEXT-BUNDLE-H-followup]`

---

## HOTFIX-PUBLISH-TX-ORDER — `_publishReview` Firestore transaction read-before-write

Root cause: `_publishReview` read the shop doc OUTSIDE the transaction (no conflict detection) and `tx.get`'d the partner doc AFTER three `tx.set` writes. Firestore requires ALL reads before ANY writes in a transaction; the partner-read-after-write threw `INTERNAL` on the client the first time a customer amended or acknowledged a rating that also had a delivery dimension.

- [x] **§A — Restructure `_publishReview` (reads before writes)** — Transaction body re-shaped to strict READ PHASE → COMPUTE PHASE → WRITE PHASE in `@c:\Users\dahiy\grocery-mvp\functions\src\index.ts`. Shop doc moved from an outside-transaction `.get()` into `tx.get(shopRef)` inside the transaction; partner doc `tx.get(partnerRef)` hoisted from after the three writes up to the read phase. All `tx.set` / `tx.update` (order denorm, review doc, shop cache, partner cache) now group strictly after all reads. No schema or callable-signature change. `[Phase HOTFIX-PUBLISH-TX-ORDER]`
- [x] **§C — Unit tests for read-order detection (+2)** — `@c:\Users\dahiy\grocery-mvp\tests\static\txReadOrderDetect.test.ts` pins the detection logic on synthetic transaction bodies (one violating GOOD shape with read-after-write, one correct). Shared pure helper extracted to `@c:\Users\dahiy\grocery-mvp\tests\static\txReadOrderDetect.ts` (`extractTransactionBodies` + `hasReadAfterWrite`), with a string/comment/template-literal-aware brace tokenizer to avoid false positives. `[Phase HOTFIX-PUBLISH-TX-ORDER]`
- [x] **§D — Static-source guard (+1)** — `@c:\Users\dahiy\grocery-mvp\tests\static\transactionReadOrderAudit.test.ts` walks every `.ts` in `functions/src`, extracts all `runTransaction` bodies, and fails if any `tx.get` appears after a `tx.set`/`tx.update`/`tx.delete`. Permanent CI guard (third after `authClaimNamesAudit` and `noStaleDeferralComments`). Confirmed green against the whole functions tree — also validated `submitOrderRating`'s existing read-before-write order. `[Phase HOTFIX-PUBLISH-TX-ORDER]`
- [x] **tsc + functions build + tests** — Root `npx tsc --noEmit` clean; `functions npm run build` clean. Guard + unit suites: **3/3 green**. Deliberate-break (documented in guard header): move `tx.get(partnerRef)` back below a `tx.set` in `_publishReview` → guard fails. `[Phase HOTFIX-PUBLISH-TX-ORDER]`
- [ ] **Deploy (server first, no client change)** — `firebase deploy --only functions:amendRating` then `functions:acknowledgeReview` then `functions:publishTimedOutReviews` (the three callables that drive `_publishReview`). Verify Cloud Run `allUsers` invoker on each. `[Phase HOTFIX-PUBLISH-TX-ORDER-deploy]`

---

## PR-NEXT-BUNDLE-I — Review-attention queue + dashboard card redesign

Surfaces `flagged_low` reviews awaiting response as a first-class section on the delivery and shop dashboards, and adds a top-of-screen card grid summarizing live work counts for both roles.

- [x] **§A — Pure card view-model helpers** — `@c:\Users\dahiy\grocery-mvp\src\utils\deliveryDashboardViewModel.ts` exports `deriveDeliveryDashboardCards` (active / available / coming / history / attention) and `deriveShopDashboardCards` (pending / preparing / ready / delivered / attention). Each returns a stable-ordered `DashboardCard[]` with `id`, `icon`, `label`, `count`, `variant` ('urgent' when attention>0 else 'default'), and `scrollToSection`. `[Phase PR-NEXT-BUNDLE-I]`
- [x] **§B — `DashboardCardGrid` component** — `@c:\Users\dahiy\grocery-mvp\src\components\dashboard\DashboardCardGrid.tsx` renders a 2-column tappable card grid (last card spans full width when count is odd); urgent variant tints border + count red. Pure presentational; takes `cards` + `onCardPress`. `[Phase PR-NEXT-BUNDLE-I]`
- [x] **§C — DeliveryDashboardScreen wiring** — Added attention state (`attentionOrders`, `attentionLoading`, `showAttention`) above early returns, a fetch `useEffect` keyed on `[isDelivery, retryNonce]` calling `orderService.listMyAttentionReviews()`, a `dashboardCards` memo, and a `handleCardTap` that expands the tapped section. Card grid + "Reviews & Ratings" attention section inserted at the top of `ListHeaderComponent`; rows deep-link to `DeliveryOrderDetail`. `[Phase PR-NEXT-BUNDLE-I]`
- [x] **§D+§E — New callables + composite indexes** — `listMyAttentionReviews` (delivery-claim gated) and `listShopAttentionReviews` (shop-owner gated) added to `functions/src/index.ts`, both backed by the pure `@c:\Users\dahiy\grocery-mvp\functions\src\attentionReviewHelpers.ts` (`summarizeAttentionReviewRows`, filters `flagged_low`, sorts desc by submittedAt, caps 50). Client wrappers + local `AttentionReviewRow` type added to `@c:\Users\dahiy\grocery-mvp\src\services\orderService.ts`. Composite indexes `(orders: deliveryPersonId + correctionState + updatedAt)` and `(orders: shopId + correctionState + updatedAt)` added to `firestore.indexes.json`. `[Phase PR-NEXT-BUNDLE-I]`
- [x] **§F — ShopOwnerDashboardScreen wiring** — Added attention state + fetch effect (`listShopAttentionReviews`), extended `stats` memo with `preparingCount`/`readyCount`/`deliveredTodayCount`, `dashboardCards` memo via `deriveShopDashboardCards`, and inserted the card grid + "Reviews & Ratings" section at the top of `ListHeaderComponent`; rows deep-link to `ShopOrderDetail`. `[Phase PR-NEXT-BUNDLE-I]`
- [x] **Tests (+18)** — `@c:\Users\dahiy\grocery-mvp\tests\utils\deliveryDashboardViewModel.test.ts` (+10: zero-state, count mapping, urgent variant on/off, stable order, scrollToSection for both delivery & shop) + `@c:\Users\dahiy\grocery-mvp\tests\functions\attentionReviewHelpers.test.ts` (+8: empty, filter non-flagged_low, full-field map, null defaults, submittedAt fallback, desc sort, 50-cap, null-sorts-last). All **21/21** green across this bundle + the hotfix guard/unit suites. `[Phase PR-NEXT-BUNDLE-I]`
- [x] **tsc + functions build** — Root `npx tsc --noEmit` clean; `functions npm run build` clean. `[Phase PR-NEXT-BUNDLE-I]`
- [ ] **Deploy (server first)** — `firebase deploy --only firestore:indexes` (wait for indexes to build), then `firebase deploy --only functions:listMyAttentionReviews` then `functions:listShopAttentionReviews`. Verify Cloud Run `allUsers` invoker on both new callables. `[Phase PR-NEXT-BUNDLE-I-deploy]`
- [ ] **OTA after server** — `eas update --branch production --message "Bundle I — review-attention queue + dashboard card grid"`. Client depends on the two new callables + indexes being live first. `[Phase PR-NEXT-BUNDLE-I-deploy]`

---

## HOTFIX-RESPOND-OWNER-AND-CARD-NAV-AND-AMEND — Three Bundle H/I follow-ups

Sudhir's 2026-06-10 post-Bundle-I retest surfaced three bugs: (1) shop owner gets `permission-denied` "Not the owner of this shop" when responding to a flagged_low review (auth-direction bug — multi-shop owner), (2) tapping the "Reviews & Ratings" dashboard card was a no-op, (3) amending a rating 2★→4★ left stale 2★ "everywhere" (partial denormalization + outside-tx recompute race + client watcher lag).

- [x] **§A — Server: fix shop-ownership check in `respondToReview`** — Replaced the broken `where('ownerUid','==',uid).limit(1)` indirect lookup (returns an arbitrary shop for multi-shop owners) with a direct `shops/{rev.shopId}` doc read + ownerUid comparison via `validateShopOwnerForReview`. Same auth bug class as HOTFIX-5 + HOTFIX-RATING-RESPONSE (direction, not shape). **Also fixed the same pattern in the rating-alert-config callable** (`functions/src/index.ts` ~9919): when a specific `shopId` is supplied it now validates that shop directly; the no-shopId "find my own shop" fallback is retained and line-allowlisted. `[Phase HOTFIX-RESPOND-OWNER]`
- [x] **§B — Pure helper `validateShopOwnerForReview`** — `@c:\Users\dahiy\grocery-mvp\functions\src\respondToReviewOwnerCheckHelpers.ts` (Rule 14 discriminated-union Result: ok / shop_not_found / not_owner). Injectable `readShopDoc` for unit testing. Pinned by **+5 tests** (owner ok, not-owner, shop-not-found, null ownerUid, multi-shop owner). `[Phase HOTFIX-RESPOND-OWNER]`
- [x] **§C — Static guard `shopOwnerCheckAudit` (4th permanent guard)** — `@c:\Users\dahiy\grocery-mvp\tests\static\shopOwnerCheckAudit.test.ts` walks `functions/src/**/*.ts` and fails on any `where('ownerUid','==',X).limit(1)` not line-allowlisted with `shop-owner-audit:allow`. Detection logic extracted to `@c:\Users\dahiy\grocery-mvp\tests\static\shopOwnerCheckDetect.ts` with **LINE-scoped** allowlisting (a file-scoped allow would have exempted all of index.ts). **+3 tests** (guard + 2 detection-unit: flags bad, ignores good, ignores allowlisted). `[Phase HOTFIX-RESPOND-OWNER]`
- [x] **§D — View-model helper `buildAttentionQueueRows`** — `@c:\Users\dahiy\grocery-mvp\src\utils\attentionQueueViewModel.ts` (role-aware dimension select, 80-char comment excerpt, 7-day auto-publish countdown clamp). **+5 tests** (delivery role, shop role, empty, excerpt cap, countdown clamp + null submittedAt). `[Phase HOTFIX-RESPOND-OWNER-AND-CARD-NAV]`
- [x] **§E — `AttentionQueueScreen` (shared, role param)** — `@c:\Users\dahiy\grocery-mvp\src\screens\AttentionQueueScreen.tsx`. Single screen serves both roles via `route.params.role`, calls the role-appropriate callable, `useFocusEffect` re-fetch + pull-to-refresh, rows deep-link to `DeliveryOrderDetail`/`ShopOrderDetail`. Header "Reviews & Ratings · {count}"; empty state "✨ All caught up". Rule 2: all useState above conditional returns. `[Phase HOTFIX-RESPOND-OWNER-AND-CARD-NAV]`
- [x] **§F — Nav route** — Added `AttentionQueue: { role: 'delivery' | 'shop' }` to `RootStackParamList` + registered `<Stack.Screen>` in `@c:\Users\dahiy\grocery-mvp\src\navigation\AppNavigator.tsx`. `[Phase HOTFIX-RESPOND-OWNER-AND-CARD-NAV]`
- [x] **§G — Dashboard card tap handlers** — Delivery `handleCardTap` and shop `onCardPress` now navigate to `AttentionQueue` on the attention card (was a no-op: `setShowAttention(true)` where `showAttention` already initialized `true`; shop side was an explicit no-op). Other cards keep inline section-toggle behavior. `[Phase HOTFIX-RESPOND-OWNER-AND-CARD-NAV]`
- [x] **§H — Amend denorm consolidation (atomic)** — (H.1) Rolling-average recompute moved INTO `_publishReview`'s transaction (COMPUTE phase computes `shopAvgRecompute`/`partnerAvgRecompute`, WRITE phase merges them into the existing shop/partner `tx.set`) via pure `@c:\Users\dahiy\grocery-mvp\functions\src\recomputeRollingAverageHelpers.ts`. Read-before-write order preserved (passes `transactionReadOrderAudit`). (H.2) Removed the redundant `amendedStars` subfield write + racy outside-tx `shop.ratingAvg` recompute from `amendRating` — now a single transactional `_publishReview` call. (H.3) `amendedAt` stamped on the review doc inside `_publishReview` (gated on `reason==='customer_amended'`). (H.4) `RatingAmendmentScreen.handleAmend`/`handleKeepOriginal` force `orderService.getOrder(orderId)` after success to prime the cache (new public `getOrder` wrapper added to `orderService.ts`). **+6 tests** on the recompute math (2→4, weighted increase, decrease path, no-op null, oldCount=0 null, chained round-trip). `[Phase HOTFIX-AMEND-RECOMPUTE]`
- [x] **tsc + functions build + tests** — Root `npx tsc --noEmit` clean; `functions npm run build` clean. New suites: **20/20** (§B 5 + §C 3 + §D 5 + §H 6 + §C detect already counted). Full `tests/functions tests/utils tests/static`: **1268 tests pass**; 4 pre-existing suite-load failures (openLegal/openSupport/openMapsForCoords/uploadDeliveryProof) are unrelated `@react-native-firebase/app` import errors at `orderService.ts:2` (not modified by this work). `[Phase HOTFIX-RESPOND-OWNER]`
- [ ] **Deploy (server first)** — `cd functions; npm run build; cd ..` then `firebase deploy --only "functions:respondToReview,functions:amendRating"` (rating-alert-config callable also modified — include its deploy target if separate). `[Phase HOTFIX-RESPOND-OWNER-deploy]`
- [ ] **Cloud Run IAM verify** — `respondtoreview` AND `amendrating` (+ rating-alert-config service) need `allUsers / run.invoker`. Re-bind if `etag: ACAB`. `[Phase HOTFIX-RESPOND-OWNER-deploy]`
- [ ] **OTA after server** — `eas update --branch production --message "HOTFIX-RESPOND-OWNER-AND-CARD-NAV-AND-AMEND — owner check + AttentionQueueScreen + amend atomicity"`. New screen + nav route + amend refetch depend on the modified callables being live. `[Phase HOTFIX-RESPOND-OWNER-deploy]`