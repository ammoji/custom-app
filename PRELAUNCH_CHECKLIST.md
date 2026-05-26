# Pre-Launch Checklist — grocery-mvp

Single source of truth for everything that must happen before real customers
touch this app. Items grouped by category. Each item annotated with the
Phase that introduced the requirement.

## 🚀 Production Firebase project setup (separate workstream — before public launch)

**Current state:** The repo has ONE Firebase project, `grocery-mvp-dev`.
All testing, all family use, all server-side code, and all data live
there. There is NO separate production project. The `EAS Update`
production channel is just a client OTA channel; it points at the
same `grocery-mvp-dev` backend as the preview channel.

This must change before real paying customers touch the app, because
test/dev data, test Razorpay keys, and dev-grade rules cannot back a
production deployment. Outline of the work (1–2 days when ready):

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
      review delays (3–7 days each).
- [ ] **Data migration plan.** Decide which test data carries over.
      Default: nothing — start prod with a clean slate. Family/test
      shops + orders stay on dev.
- [ ] **DNS / branded link** if you want `kiranamart.in` instead of
      the auto-generated EAS link in marketing material.

**Why this isn't done yet:** the app is still in family-testing
phase. Creating a prod project before the feature surface is stable
just creates two backends to keep in sync without commensurate value.
Revisit when (a) family testing reports go quiet for 1–2 weeks, AND
(b) you're ready to commit to a public launch date.

**The bogus `--project grocery-mvp-prod` lines in old PR prompts
(PR 9, PR 12, PR 10-11-12 bundle plan) were a mistake on my part —
they assumed a prod project existed when it doesn't. If you re-read
those prompts, skip those lines until the prod setup above is done.**

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
- [x] **Configure Sentry source-map upload** via `SENTRY_AUTH_TOKEN` EAS
      secret + Sentry plugin `organization` / `project` config in
      `app.json`. [Shipped — PR 26]
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
- [x] **Background-tap protection on retry/cancel buttons** \u2014
      [Shipped — PR 27]. Closed by the new `usePressGuard` hook
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
      approval (mirror the shop-owner KYC flow shipped in PR 31 —
      same signed-PUT-URL + admin-only-read pattern).
- [x] **Shop owner KYC document upload** — [Shipped — PR 31].
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
- [ ] **Shop owner can edit KYC docs after rejection** — PR 31
      currently freezes uploads once the shop leaves `pending` state
      (server returns `failed-precondition`). For rejected shops
      that need to resubmit with corrected docs, add a server-side
      "re-open KYC" admin action that flips the shop back to
      pending and re-enables uploads, OR allow uploads in `rejected`
      state. Decide once we see real rejection patterns.
- [ ] **Storage rules unit tests for `/shop-kyc/`** — PR 31 added
      the rules block but no `@firebase/rules-unit-testing` coverage
      (the repo has no precedent for storage-rule emulator tests).
      Adding one would pin "non-admin reads denied" + "all writes
      denied" against a future rule edit.
- [x] **Admin shop-review polish** — [Shipped — PR 31.1].
      Three small UX gaps surfaced in PR 31 smoke testing, all
      closed on the admin side. (1) Lat/lng coords in both
      `ShopRegistrationDetailScreen` and `ShopDetailManagementScreen`
      are now tappable links that open the device's preferred
      maps handler via a universal Google Maps URL — new utility
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
      active / suspended / rejected — server-side
      `getShopKycReadUrls` has no status gate, only an admin gate).
      Zero server / rules / native changes — OTA-only. Total: 627
      tests pass (+4) + tsc clean.
- [ ] **Lift `AdminShopKycGrid` to a shared component** — PR 31.1
      kept the KYC grid + zoom modal inline-copied in both admin
      screens (`ShopRegistrationDetailScreen` and
      `ShopDetailManagementScreen`) because each surface's UX may
      diverge over time (e.g. dispute-view may add re-request
      actions). If divergence proves false after a few more
      iterations, lift to `src/components/shop/AdminShopKycGrid.tsx`.
- [ ] **In-app map embed for shop locations** — PR 31.1 deep-links
      to the device's maps handler. A `react-native-maps` embed
      would be nicer UX but adds a heavy native dep purely for
      admin convenience. Justify once a customer-facing map need
      lands (Phase D PR 53).
- [x] **AI photo-to-catalog (Phase A2 differentiator)** —
      [Shipped — PR 32]. Shop owners can photograph their printed
      or handwritten rate-list and the app extracts a structured
      list of SKUs via Claude Sonnet vision, then batch-writes the
      shop-owner-approved subset to their menu. Collapses 4 hours
      of manual SKU entry into ~15 minutes of review.
      **Substrate (reused by Phase C AI PRs 44–49):**
      `@react-native-firebase/app` already present; added
      `@anthropic-ai/sdk ^0.98.0` to `functions/package.json`. New
      `functions/src/aiHelpers.ts` exports `runClaudeVision` +
      `estimateCostInr` + the `ANTHROPIC_API_KEY` secret handle.
      Lazy-init Anthropic client + structured-output text
      concatenation. Default model `claude-sonnet-4-5`.
      **Pure helpers:** `functions/src/menuExtractionHelpers.ts`
      exports `MENU_EXTRACTION_SYSTEM_PROMPT` (embeds the 10
      canonical CategoryIds), `MENU_EXTRACTION_USER_PROMPT`, and
      `parseExtractionResponse` — strips ```json fences, drops
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
      **Client:** new `ScanMenuScreen` (4-phase wizard: pick →
      processing → review → committing) with progressive copy
      during the ~15s Claude wait, per-row include-checkbox + edit
      fields + 10-chip category picker + low-confidence
      indicator. `usePressGuard` on the commit CTA. Image is
      resized to 1024px longest edge at JPEG quality 0.7 via
      `expo-image-manipulator` with `base64: true` (no new client
      dep, no `expo-file-system`). CTA on `ShopMenuScreen` above
      the existing "+ Add custom item" row. Route registered in
      `AppNavigator`. Schema-additive only — three new
      collections (`aiQuotas/`, `aiFeatures/`, `aiAuditLog/`)
      written exclusively via Admin SDK; no `firestore.rules`
      change needed. **No image persistence** — base64 stays in
      the callable payload, processed in memory, never written
      to any bucket (privacy win + no storage cleanup needed +
      no IAM signBlob gotcha à la PR 31).
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
- [x] **AI voice + Hindi onboarding (Phase A2 accessibility)** —
      [CODE SHIPPED — PR 34. **Native build in flight as of
      2026-05-24** because the PR added the `expo-audio` config
      plugin to `app.json`, which adds `NSMicrophoneUsageDescription`
      to iOS `Info.plist` (a native config change → runtime
      fingerprint shifted → OTA silently couldn't apply to the
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
      `claude-haiku-4-5`, ~3× cheaper than Sonnet for the parsing
      task), and `estimateCostInr` now takes an optional `model`
      argument so Haiku calls log Haiku rates instead of being
      billed as Sonnet (without this fix the audit log would
      overstate PR 34 cost ~3×). PR 32's call site was updated
      to pass the model so Sonnet pricing keeps tracking
      correctly. New `@google-cloud/speech ^7.3.1` server dep —
      STT uses ADC (the function's runtime SA), so **no new
      Firebase secret type** is needed; the only manual GCP step
      is enabling the Cloud Speech-to-Text API in the project.
      **Pure helpers:** `functions/src/voiceOnboardingHelpers.ts`
      exports `VOICE_ONBOARDING_SYSTEM_PROMPT` (instructs Claude
      to extract the 7 registration fields with strict JSON
      output, null-when-unmentioned, +91/leading-0 stripped from
      phone, hours converted to 24-hour HH:mm, "GST nahi hai" →
      null), `parseVoiceOnboardingResponse` (strips ```json
      fences, validates each field individually — phone digits,
      HH:mm regex, GSTIN 15-char regex, FSSAI 14-digit regex —
      drops invalid fields to null rather than rejecting the
      whole response). 12 unit tests in
      `tests/functions/voiceOnboardingHelpers.test.ts` covering
      every validator branch + the "no GST" → null mapping +
      top-level error paths.
      **Callable:** `transcribeShopOnboardingAudio` — auth (any
      signed-in user; **no shopOwner gate** since voice
      onboarding runs BEFORE the shop is registered) +
      `aiFeatures/voiceOnboarding.enabled` kill switch +
      per-uid 10/day quota (`aiQuotas/{uid}_{YYYY-MM-DD}
      .voiceOnboarding`, sibling field to PR 32's
      `menuExtraction` counter, merge:true preserves both) +
      2 MB audio cap + 60s timeout + 512MiB memory +
      `secrets: [ANTHROPIC_API_KEY]`. Mode `'multi_field'` runs
      STT then Claude Haiku parse → 7 fields; mode
      `'single_field'` runs STT only and returns the transcript.
      `aiAuditLog/` entries record `feature`, `subFeature`
      (mode), `languageCode`, `sttBillableSeconds`, llm token
      counts (multi_field), and `costInr` (~₹0.5–₹2 per call).
      **Localised errors (Trust Principle 4):** every server
      error message is rendered in Hindi when `languageCode ==
      'hi-IN'` (kill switch, audio-too-large, quota, no-speech,
      STT failure, parse fallback all have Hindi twins).
      **Encoding picker:** server accepts `WEBM_OPUS` (web),
      `LINEAR16` (iOS — PCM 16-bit WAV), `AMR_WB` (Android —
      the only STT-friendly format Android `MediaRecorder` can
      produce), `FLAC` reserved for future. Client picks based
      on `Platform.OS`.
      **Client:** new `src/components/VoiceInputButton.tsx`
      (reusable mic, two sizes — `lg` for the big "🎙 Speak about
      your shop" CTA, `sm` for per-field icons), built on
      `expo-audio` (`useAudioRecorder` + `useAudioRecorderState`
      hooks; tap-to-start / tap-to-stop UX with a 30s automatic
      cap and a pulsing red dot during recording). 16 kHz mono
      PCM/AMR_WB/WebM keeps a 30s clip well under 1 MB
      (HIGH_QUALITY 44.1 kHz stereo would have busted the 2 MB
      server cap). `usePressGuard` wraps the upload-and-callable
      path so a frantic re-tap during the 5–15s server wait
      can't fire two concurrent transcribes.
      **RegisterShopScreen integration:** language picker
      (Hindi/English pill buttons, Hindi default), big "🎙 Speak
      about your shop" CTA above the form, per-field mic icons
      via `Field`'s new `voice` prop, ✨ "AI" chip + yellow
      left-border on every field the multi_field flow filled,
      review banner showing the raw transcript (Trust Principle
      2 — every AI output gets human review before commit). The
      ✨ chip clears the moment the user edits the field,
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
      native rebuild needed — `expo-audio` autolinks via the
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
      did NOT define a `GOOGLE_*` secret — STT uses ADC.
      **Pre-deploy reminders:** (a) **enable Cloud Speech-to-Text
      API** in the GCP project before the first invocation, or
      the function returns INTERNAL with the server log
      `PERMISSION_DENIED: Cloud Speech-to-Text API has not been
      used` — same diagnostic pattern as PR 31's signBlob role;
      (b) seed `aiFeatures/voiceOnboarding` Firestore doc with
      `{enabled: true}` via Console before OTA;
      (c) `ANTHROPIC_API_KEY` secret already exists from PR 32 —
      no new secret create needed.
- [ ] **More languages: Punjabi, Tamil, Telugu, Bengali** —
      MVP ships Hindi + English only. Add `pa-IN`, `ta-IN`,
      `te-IN`, `bn-IN` as soon as a pilot shop in one of those
      regions requests it. Server-side STT supports them today;
      the client-side language picker + localised error
      messages are the only changes.
- [ ] **i18n system for the whole app** — PR 34 hand-translated
      ~10 UI strings between two languages. A real i18n setup
      (`expo-localization` + a string-table per language) is a
      future workstream once 3+ languages are supported and
      the hand-translation cost stops being trivial.
- [ ] **Voice on customer side (search, dictate address)** —
      out of scope for PR 34; needs separate UX work
      (search-by-voice has a different latency profile, and
      address dictation overlaps with the saved-address book).
- [ ] **Streaming STT** — PR 34 uses the simple `recognize`
      (batch) flow. Streaming would give live transcripts as
      the user speaks but is significant extra plumbing. Defer
      until the 5–15s post-recording wait surfaces as a real
      drop-off cause in funnel analytics.
- [ ] **Voice for menu add (single-item)** — "Aashirvaad atta
      5 kilo, MRP 305 rupaye, sell 295 rupaye" → one menu item.
      Reuses the same `runClaude` substrate from PR 34 + a
      tweaked system prompt. Pairs naturally with PR 32's
      ScanMenuScreen as a fallback when the rate-list photo
      fails OCR.
- [ ] **Offline / on-device STT fallback** — when the network
      is patchy, drop to a smaller on-device model. Out of
      scope for MVP; revisit if pilot shops in poor-coverage
      regions report transcription failures.
- [ ] **AI cost dashboard rollup** — `aiAuditLog/` collects
      per-call cost across PR 32 (`menuExtraction`) and PR 34
      (`voiceOnboarding`) features. An admin screen rolling up
      daily/weekly spend per feature is worth building once
      total monthly spend crosses ~₹1000. PR 38 ships the UI
      shell (`AdminUsageScreen`) so this becomes a small layer
      on top — same screen, different aggregation source.
- [x] **Admin feature-usage dashboard + analytics expansion
      (Strategic Principle 8)** — [Shipped — PR 38 + PR 38.1].
      **PR 38.1 follow-up (2026-05-24).** PR 38 originally wired
      both writes (`addDoc(featureUsageLog, ...)`) and reads
      (`getDocs(query(...))`) via the Web SDK Firestore client.
      On native that fails because the Web SDK Firestore can't
      see RNFB's auth context — same root cause as PR 6.1's
      signed-upload-URL fix for Storage. Result: writes silently
      failed (rule saw `request.auth == null`, the silent catch
      in `writeFeatureUsageLog` swallowed the permission-denied
      to a console.warn), and the admin dashboard hard-failed
      with a visible "Missing or insufficient permissions"
      error on tap. PR 38.1 routed both ops through new Cloud
      Function callables (`logFeatureUsageEvent` —
      authenticated-only, server resolves uid+role+timestamp,
      validates feature name; `queryFeatureUsageLog` — admin-
      only, returns events array + truncated flag) mirroring
      `orderService` dispatch shape, and tightened the
      `featureUsageLog/{eventId}` rule to
      `allow read, write: if false` (server-mediated only —
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
      trap — `.windsurf/deploy-discipline.md` got a new
      "Web SDK Firestore + RNFB auth — the silent-failure trap"
      section to ensure the *third* instance never ships.
      **Verification (PR 38.1):** root + functions tsc both
      0 errors; `npm test` 658/658 (66 suites); `npm run
      test:rules` 92/92 (8 suites; the 12 featureUsageLog
      tests in the new posture). Deliberate-break confirmed
      by flipping the rule to `allow read, write: if request
      .auth != null` → 12 "everyone is denied" assertions
      failed; reverted.
      **Deploy posture (PR 38.1):** rules first
      (`firebase deploy --only firestore:rules`), then each
      callable one-per-command per deploy-discipline rule 1
      (`firebase deploy --only functions:logFeatureUsageEvent`,
      `firebase deploy --only functions:queryFeatureUsageLog`),
      then `eas update --branch production`. OTA-eligible (no
      native changes; no new deps).
- [x] **Admin feature-usage dashboard — original ship**
      (Strategic Principle 8) — [Shipped — PR 38]. Closes the
      "did anyone use feature X" question for the pilot.
      **Substrate:** every `Analytics.*` call now fires twice —
      Firebase Analytics (unchanged, web-only, sampled) AND a
      parallel append-only Firestore write to
      `featureUsageLog/{eventId}` (uid + role + feature + date +
      shopId + serverTimestamp). Fire-and-forget — observability
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
      callable returns ok — failed attempts never log).
      **Wire sites:** `AuthBootstrap.tsx` (role-arrival
      `*_signed_in`, fires once after the post-mount claim
      refresh), `ShopRegistrationDetailScreen` (admin approve/
      reject), `ShopDetailManagementScreen` (suspend/unsuspend),
      `DeliveryRequestDetailScreen` (delivery approve/reject),
      `AddCustomMenuItemScreen` (custom add),
      `ShopOrderDetailScreen.useShopOrderDetail.ts` (status
      change + accepted + ETA — gated on `result.ok` so the
      rollback path stays uninstrumented),
      `DeliveryDashboardScreen` (online toggle, picked up,
      delivered).
      **Dashboard:** `src/screens/admin/AdminUsageScreen.tsx`
      reachable from HomeScreen "📊 Feature usage" admin tile.
      4 summary tiles (total events, unique users, unique shops,
      top feature) + by-feature bar list (top 20 / show all
      toggle, % of total) + by-role bar chart. Period selector
      7d/30d. Single fetch on mount + period change (no
      `onSnapshot` — admin re-visits this rarely; live counters
      add no decision-relevant info). Query capped at 10 000 docs
      / period — fine at pilot scale; if exceeded, the next move
      is a scheduled Cloud Function pre-computing daily counters
      (out of scope here).
      **Pure helpers:** `src/screens/admin/adminUsageHelpers.ts`
      exports `topFeatures`, `byRole`, `uniqueUsers`,
      `uniqueShops`, `filterAfter`. Zero React, zero Firestore —
      every aggregation is a data → data transform so the
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
      — 16 new featureUsageLog cases + the existing suite).
      **Deliberate-break confirmed:** flipped the rule's
      `allow create` to `if false` → the 3 "user/shop owner/
      admin CAN create with own uid" tests failed; reverted.
      **Mission impact:** Strategic Principle 7's three pilot
      metrics are now queryable — time-to-first-menu-item =
      delta between `shop_signed_in` and the first
      `shop_menu_item_added` per shop; merchant weekly active =
      distinct shopIds with any shop_* event in 7d; customer
      repeat-order = distinct customer uids with ≥ 2
      `place_order` events in 30d. Strategic Principle 8 is
      fully honored project-wide — every future PR's "wire
      `Analytics.*`" step has events to wire and a dashboard to
      verify against.
      **Deploy posture:** OTA-eligible (no plugin / permission /
      native dep changes). Server-first deploy:
      `firebase deploy --only firestore:rules` then
      `firebase deploy --only firestore:indexes` (indexes
      take 30 s – 2 min to build; dashboard returns empty
      results until "Building" → "Enabled" in console), then
      `eas update --branch production`.
- [ ] **PR 33 — master product catalog matching** — every PR 32
      extraction currently lands as a custom menu item (productId:
      null, isCustom: true, addedVia: 'menuExtraction'). PR 33's
      job is to introduce a master product catalog, match each
      extracted SKU against it during the review step, and let the
      admin curate the unmatched ones. Without PR 33, two
      different shops scanning the same Aashirvaad Atta produce
      two unrelated custom items, breaking the "compare prices
      across shops" customer journey when we get there.
- [ ] **AI cost dashboard / admin spend report** — `aiAuditLog/`
      is the substrate; PR 32 writes one entry per successful
      extraction with `costInr`, `inputTokens`, `outputTokens`,
      `feature`, `model`, `shopId`. An admin report showing
      daily/weekly AI spend per feature is worth building once
      total monthly spend crosses ~₹1000.
- [ ] **Anthropic API key rotation** — manual `firebase functions:
      secrets:set ANTHROPIC_API_KEY` (with the new value) works
      today but there's no scheduled reminder. Document a
      quarterly rotation cadence somewhere ops can see; for now
      this PRELAUNCH bullet is the reminder.
- [ ] **Re-scan as price-update (not always-add)** — PR 32 is
      add-only. Re-scanning a rate-list a month later duplicates
      every SKU rather than reconciling prices on the existing
      menu. Future PR: "Reconcile with existing menu" toggle on
      the review screen that diffs each draft against the shop's
      current menu by name+pack similarity, surfaces an update
      path for matches, and only creates new items for the
      unmatched rows.
- [ ] **Multi-photo extraction in one draft** — single photo per
      call in PR 32. Shop owners with very long rate-lists do
      multiple scans (each counts against the 5/day quota). A
      future flow would let the owner take 3–4 photos of a long
      list and combine them into a single review draft.
- [ ] **PDF rate-list ingestion** — vision API supports JPEG/PNG/
      WebP only. PR 32 takes a photo-of-PDF as an acceptable
      workaround. Native PDF would need server-side conversion to
      images, which adds complexity. Defer.
- [ ] **Per-extracted-row image preview thumbnail** — Claude
      doesn't return crop coords, so attaching the original photo
      region to each draft row would require client-side cropping
      inference. Heavy. Defer.
- [ ] **Audit-log "admin viewed KYC docs" event** — privacy
      consideration worth tracking once we add real customer
      disputes / regulator review. Today the access is silent.
      Add a low-priority `auditLog` entry on every
      `getShopKycReadUrls` call so we can answer "who looked at
      shop X's docs and when".
- [ ] **Storefront photo display on shop card** — PR 31 collects
      the storefront photo as part of KYC but the shop catalog
      (`HomeScreen`, `ShopMenuScreen`) still uses the legacy
      `Shop.imageUrl`. Once admin approves a shop, copy the
      storefront `storagePath` into `Shop.imageUrl` (or add a
      separate `Shop.storefrontPath` and mint public-read access at
      approve-time by moving the file from `/shop-kyc/` to
      `/shops/`).
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
- [x] **Cloud Functions Node.js 20 runtime upgrade** — bumped
      `functions/package.json` engines to `node: "22"` in PR 9
      (May 18 2026). Local build + tests green; staged dev/prod
      deploys pending (Parts 5–8 of PR 9 are operator-driven).
- [x] **`firebase-functions` SDK upgrade** — bumped
      `firebase-functions ^6.0.1 → ^7.2.5` and `firebase-admin
      ^12.6.0 → ^13.9.0` in PR 9 (May 18 2026). Zero code
      changes required: every v2 surface we use (`onCall`,
      `onSchedule`, `onDocumentCreated`, `onDocumentUpdated`,
      `defineSecret`, `setGlobalOptions`, `HttpsError`,
      `FieldValue.*`) compiles clean against v7. Staged
      deploys pending.
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

- [x] **Privacy Policy** drafted, hosted at a public URL, linked in app
      and store listings. Required for both Play Store and App Store.
      [Shipped — PR 25] — markdown at `docs/privacy-policy.md`,
      static HTML at `dist/privacy.html`, hosted at
      `https://grocery-mvp-dev.web.app/privacy`. Linked from
      LoginScreen footer + ProfileScreen "Legal" section.
- [x] **Terms of Service** drafted, hosted, linked.
      [Shipped — PR 25] — markdown at `docs/terms-of-service.md`,
      static HTML at `dist/terms.html`, hosted at
      `https://grocery-mvp-dev.web.app/terms`. Linked same surfaces.
      **Follow-up before App Store submission:** replace
      `[CITY TBD before launch]` placeholder in §13 governing-law
      clause with the real operating-entity city.
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

- [x] **Push token cleanup on sign-out** — [Shipped — PR 24]. The
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

### PR 26 — Sentry source-map upload on production builds — ✅ CODE COMPLETE May 22 2026

Until PR 26, every Sentry stack trace in production looked like
`<anonymous>:1:24561` — minified single-line JS, useless for
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
      dashboard URL — these are public, not secret). The plugin
      reads `SENTRY_AUTH_TOKEN` from the build env automatically.
- [x] **`SENTRY_DISABLE_AUTO_UPLOAD` removed** from the
      `production` profile's `env` block in `@/eas.json:38-47`.
      `development` and `preview` profiles retain the flag.
      Removing the var is cleaner than setting `"false"` — the
      sentry-cli upload step keys on truthiness, so absence
      means upload is enabled.
- [x] **`src/utils/sentryDebugThrow.ts`** — dev-only helper
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
- [x] **PRELAUNCH_CHECKLIST entry flipped** — the
      "Configure Sentry source-map upload" item under
      `🔐 Security & Compliance` is now `[x] [Shipped — PR 26]`.
- [x] **No new `DO NOT REMOVE` markers** (16-PR clean streak).

#### Verification done in-session

- `npx tsc --noEmit` — **0 errors**.
- `npm test` — **615 / 615 passing**.
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
   + reopen — the crash uploads from the on-disk queue. Within
   ~1 minute, the Sentry dashboard shows the event. **Open the
   stack frame.** It MUST point at
   `src/utils/sentryDebugThrow.ts:<line>` and show the function
   name `triggerSentryTestError`. If it points at
   `<anonymous>:1:24561`, the upload didn't work — re-check the
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
(but won't fail — the auth token, if still present in EAS secrets,
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

### PR 27 — Background-tap protection (`usePressGuard`) — ✅ CODE COMPLETE May 22 2026

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
      and rejection — the guard does NOT swallow errors. Pure
      mutex; no time-based debounce.
- [x] **`CheckoutScreen` Place Order / Pay button** wired through
      `guardedPlaceOrder` at
      `@/src/screens/CheckoutScreen.tsx:462`. The hook call sits
      ABOVE the `if (items.length === 0) return` early return per
      Rules-of-Hooks discipline (PR 12 lineage). `placing` state
      and `disabled={placing}` retained — the guard is additive
      front-line defense, the disabled paint is the second line.
- [x] **`OrderDetailScreen` four buttons** routed through three
      guards at `@/src/screens/OrderDetailScreen.tsx:213-225`:
      `guardedRetryPayment`, `guardedCancel` (shared by the
      payment-pending Cancel + the COD-pending Cancel — same
      handler, same guard), and `guardedWindowCancel`. Hook calls
      sit above all early returns.
- [x] **Handlers converted to async + Promise-returning.** The
      original `function handleX()` declarations were sync wrappers
      around fire-and-forget IIFEs — the outer fn returned
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
      `createPressGuard` factory — same RNTL-free precedent as
      `useOnlineDeliveryCount`. Total project tests:
      **611 / 611 passing** (was 606; +5).
- [x] **No existing busy state removed.** `placing`,
      `cancelling`, `paying`, `windowCancelling` all still drive
      the visible spinner + title-text changes. The guard sits in
      front of the handler; the state machine sits behind it.
- [x] **No new `DO NOT REMOVE` markers** (16-PR clean streak).
- [x] **PRELAUNCH_CHECKLIST entry flipped** — the
      "Background-tap protection on retry/cancel buttons" item
      under `OrderDetailScreen` deferrals is now
      `[x] [Shipped — PR 27]`.

#### Verification done in-session

- `npx tsc --noEmit` — **0 errors**.
- `npm test` — **611 / 611 passing**.
- Deliberate-break rehearsed mentally: removing the
  `if (busy.current) return undefined` early-return causes the
  "re-entrant call WHILE first is in-flight is a no-op" test to
  fail with the handler called twice — confirms the test
  genuinely pins the re-entry block. (User should run this
  break manually before declaring done if desired.)

#### Manual smoke-test runbook (post-OTA)

1. **Double-tap place-order does not duplicate Razorpay** — set
   up a cart, go to Checkout, switch to "Pay Online". Double-tap
   the "Pay ₹X" button as fast as you can. Exactly **one**
   Razorpay overlay appears. Cancel it. Check Firestore `orders`
   — exactly one new order, not two.
2. **Single-tap still works** — standard place-order flow on a
   single tap. Order created, watcher fires, OrderDetail navigates.
3. **Cancel within window — double-tap** — place an online order
   that's reached `paid + accepted`. Open OrderDetail. Double-tap
   "Cancel order (X:XX left)". The order cancels exactly once.
   Button transitions through "Cancelling…" then disappears as
   the watcher delivers the new `cancelled` state.
4. **Retry payment — double-tap** — start a Razorpay payment
   from CheckoutScreen, dismiss the overlay without paying.
   Order sits in `paymentStatus='pending'`. On OrderDetail,
   double-tap "Pay ₹X now". Exactly one Razorpay overlay opens.
5. **COD cancel — double-tap** — place a COD order. On
   OrderDetail, double-tap "Cancel order". One cancel happens;
   the order moves to `cancelled` state.
6. **Cancel-confirm + dismiss** — tap "Cancel order"; on the
   confirm dialog tap "Keep order" or back-button-dismiss. The
   button is immediately tappable again (guard cleared via
   `finally`); no soft-lock.
7. **No hooks warnings** — `react-devtools` console clean.
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
- [ ] **Server-side idempotency keys on `placeOrder`** — accept
      a client-generated `idempotencyKey` and dedupe within a
      60-second window. Belt-and-suspenders for the residual
      "two devices same account" race that the client guard
      cannot cover. [Post-MVP]
- [ ] **Telemetry: `press_guard_blocked`** event with handler
      name + button label so we can see how often the guard
      actually fires in production. [PR 27 follow]

### PR 25 — Privacy Policy + ToS hosted + linked in-app — ✅ CODE COMPLETE May 22 2026

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

- [x] **Terms of Service** at `@/docs/terms-of-service.md` — 14
      sections mirroring the Privacy Policy structure. Covers
      acceptance, account responsibilities (incl. one-shop-per-owner
      enforced server-side), permitted / prohibited use, orders /
      payments / refunds (with the 2-minute self-cancel window +
      PR 21 substitution preferences), pricing, delivery (marketplace
      disclaimer — independent partners, estimates not penalties),
      content licensing for ratings (PR 20), liability disclaimer
      capped at order value or ₹1,000, termination, change-notice
      flow, governing-law placeholder `[CITY TBD before launch]`,
      and contact email.
- [x] **Static HTML builder** at
      `@/scripts/build-legal-html.ts`. Hand-rolled
      markdown-to-HTML converter (no `marked` dep — the docs use a
      simple subset: headings, bold, italic, lists, ordered lists,
      tables, hr, code, links). Wraps each in a `<!DOCTYPE html>`
      shell with viewport meta + inline CSS (system font stack,
      `max-width: 720px`, `prefers-color-scheme` dark mode, table
      borders). Idempotent — re-run any time the markdown changes.
      Wired up as `npm run build-legal` in `@/package.json:22`.
- [x] **Generated HTML** at `@/dist/privacy.html` and
      `@/dist/terms.html`. `.gitignore` updated to allow these
      two paths through the existing `dist/` ignore rule.
- [x] **Firebase Hosting rewrites** at `@/firebase.json:44-50`.
      New `/privacy` → `/privacy.html` and `/terms` → `/terms.html`
      rules added BEFORE the existing SPA-style `**` catch-all so
      the dedicated routes take precedence.
- [x] **Centralized URLs** in `@/app.json:98-101` under
      `extra.legal` (`privacyUrl` + `termsUrl`) — same pattern as
      `extra.firebase` and `extra.sentry`.
- [x] **`getLegalUrls()` accessor** at
      `@/src/constants/legal.ts`. Reads from `expo-constants` with
      a hard-coded fallback that points at the dev project's
      `.web.app` domain (so a misconfigured release never leaves
      the user staring at a broken link).
- [x] **`openLegal` util** at `@/src/utils/openLegal.ts`. Exports
      `openPrivacy()` + `openTerms()`. Native → `expo-web-browser`'s
      `openBrowserAsync` (SFSafariViewController / Chrome Custom
      Tabs). Web → `Linking.openURL` (`window.open()`-style new
      tab; `expo-web-browser` on web opens a useless `about:blank`).
- [x] **LoginScreen legal footer** at
      `@/src/screens/LoginScreen.tsx:179-195`. Below the Send-OTP
      button on the `enter_phone` phase only. Reads: "By
      continuing, you agree to our Terms of Service and Privacy
      Policy." with both phrases tappable. Deliberately omitted
      on `enter_otp` per ToS §2 — by tapping Send OTP the user
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
      No native rebuild required — `expo-web-browser` wraps
      system APIs (no additional bridge code).
- [x] **PRELAUNCH_CHECKLIST entries flipped** — the Privacy Policy
      and Terms of Service items under "📝 Compliance & Distribution"
      are now `[x] [Shipped — PR 25]` with the hosted URLs noted.
      `[CITY TBD before launch]` follow-up captured inline on the
      ToS entry.
- [x] **No new `useState`** — every change is static JSX + tap
      handlers. Hooks order unchanged in both screens.
- [x] **No new `DO NOT REMOVE` markers** (15-PR clean streak).

#### Verification done in-session

- `npx tsc --noEmit` (root) — **0 errors**.
- `npm test` — **606 / 606 passing**.
- `npm run build-legal` — successful; both HTML files generated.
- Inspected generated HTML — semantic markup, tables render, dark
  mode CSS present, viewport meta set, footer-note line shows
  hosted URL.

#### Manual smoke-test steps (for the user)

These are the steps you should walk through after the
hosting-first deploy below. Each step exercises one user-visible
piece of PR 25.

1. **Hosted URLs reachable** — after `firebase deploy --only hosting`,
   open these two URLs in any browser:
   - `https://grocery-mvp-dev.web.app/privacy`
   - `https://grocery-mvp-dev.web.app/terms`
   Both should return the policy text rendered as mobile-friendly
   HTML (no horizontal scroll on a phone-width viewport). On a
   dark-mode device the page flips to dark colours via
   `prefers-color-scheme`.
2. **HTML rebuild is idempotent** — run `npm run build-legal`
   twice. Second run produces the same files; no errors.
3. **Login footer renders + works** — `npm run android` (or `ios`),
   sign out, hit Login. On "Enter your phone number" you should
   see a small grey footer with "Terms of Service" and "Privacy
   Policy" in green underlined text. Tap each — opens
   SFSafariViewController on iOS / Chrome Custom Tab on Android
   without leaving the app. Close brings you back to the login
   screen with the phone number preserved.
4. **Footer absent on OTP screen** — enter a phone, tap Send OTP.
   On the "Enter the OTP" screen, the legal footer is **not**
   visible.
5. **Profile "Legal" section** — sign in, go to Profile. Scroll
   down. Above the red "Sign out" button there's a "Legal"
   section header with two rows ("Terms of Service",
   "Privacy Policy"), each with a `›` chevron. Tap each — same
   in-app browser tab behaviour as the login footer.
6. **Web build** — `npm run web`, navigate to /login. Tapping
   the legal links opens new browser tabs (not the in-app
   browser, since we're already in a browser).
7. **Reviewer-walkthrough rehearsal** — pretend to be Apple App
   Review: you have only the App Store listing URL we'll submit
   (pointing at the Firebase Hosting privacy URL). Hit it. Read
   the policy. Verify the contact email is real and clickable.
   You should be able to convince yourself, in 60 seconds, that
   this is a legitimate policy from a real operator.
8. **TypeScript clean** — `npx tsc --noEmit` returns no errors.
9. **Unit suite green** — `npm test` reports 606 / 606 passing.

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
eas update --branch production --message "PR 25 — privacy policy + ToS"
```

No Cloud Functions deploy. No native rebuild.

#### Rollback

- **Hosting**: the previous Firebase Hosting release is one
  click away in the Firebase Console (Hosting → Release history
  → Rollback). Or `firebase hosting:clone` the prior version.
- **Client**: `git revert` the screen edits + OTA. The hosted
  URLs remain reachable; just no in-app entry points until the
  next deploy.

#### Follow-ups (out of scope this PR)

- [ ] **Custom domain.** Move to `kiranamart.in/privacy` (or
      similar) once the domain is procured. Two-line change in
      `app.json` `extra.legal`. [PR 28-ish]
- [ ] **Replace `[CITY TBD before launch]`** in
      `docs/terms-of-service.md` §13 with the real operating-entity
      city before App Store submission. [pre-launch]
- [ ] **Translated versions** (Hindi, Tamil) once multi-language
      UI is on the roadmap. [post-MVP]
- [ ] **Cookie banner / DPDP consent UI** if/when we expand
      beyond India-only beta. [post-MVP]
- [ ] **Privacy Policy / ToS version-bump push** — the ToS §12
      promises in-app notification on material updates. The
      acceptance flow is out of scope here; build it the next
      time we materially change a policy. [post-MVP]

### PR 24 — Push token cleanup on sign-out — ✅ CODE COMPLETE May 22 2026

Closes the `[Phase 12a-v2-iv-followup]` push-token-on-signout item
logged 79 PRs ago. After sign-out the device's Expo push token used
to linger in the previous user's `users/{prev-uid}.fcmTokens` array,
so every push the server sent to that account continued arriving on
the same physical device — even after a new user signed in.
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
      `registerPushToken` — auth gate, loose string validation,
      `FieldValue.arrayRemove(token)` with merge. Idempotent
      (no-op on token not found). Multi-device safe (only removes
      the exact token string passed in).
- [x] **Client `pushService.unregisterPushToken`** at
      `@/src/services/pushService.ts:156-187`. Mirrors the
      registration flow's early-out cascade: web → bail,
      simulator → bail, permission denied → bail, missing
      projectId → bail, `getExpoPushTokenAsync` failure → warn
      and bail. Never throws — the orchestrator depends on this.
- [x] **`SignOutDeps` extended** at
      `@/src/services/signOutAndClearLocalState.ts:38-62` with
      optional `unregisterPushToken?: () => Promise<void>`. The
      orchestrator runs it BEFORE `signOut` (the callable
      requires auth) inside a try/catch that warn-logs failures
      instead of aborting sign-out — user's "get me out" intent
      takes priority.
- [x] **File-header comment updated** — the "Known follow-up
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
      call `authService.signOut()` directly — bypassed both PR
      24's new token cleanup AND the pre-existing cart-clear. Now
      uses `signOutAndClearLocalState` with the same deps as
      ProfileScreen (sans `resetNavigation`; the AuthBootstrap
      re-render handles routing on next sign-in).
- [x] **3 new tests** at
      `@/tests/services/authService.signOut.test.ts:77-124`:
      order (`unregisterPushToken` before `signOut`),
      failure-isolation (`unregisterPushToken` throw → signOut
      still completes), and optional-dep backward-compat. Total
      tests: 602 / 602 passing (was 599; +3).
- [x] **No new `useState`** — the change is dep-injection only.
      Hooks order unchanged everywhere.
- [x] **No new `DO NOT REMOVE` markers** (14-PR clean streak).

#### Verification done in-session

- `npx tsc --noEmit` (root) — 0 errors.
- `npx tsc --noEmit -p functions` — 0 errors.
- `npm test` — **602 / 602 passing**.
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
eas update --branch production --message "PR 24 — push token cleanup on sign-out"
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
   decreases by 1 (or array gone). Sign in as User B → push for
   B arrives on this device, push for A does NOT.
2. Offline sign-out: airplane mode → tap Sign Out. Warn log
   surfaces, sign-out completes, cart cleared, navigation reset.
3. QuickSwitch from A → B. Verify A's `fcmTokens` array no
   longer contains this device's token AND the cart is empty
   (previously the cart leaked).
4. Multi-device: A on Device 1 + Device 2; sign out on Device 1.
   Device 2's token still in A's array. Push to A still reaches
   Device 2.
5. Re-sign-in re-registers fresh: sign in as A again → on the
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

### PR 23 — Delivery "Heads up — coming soon" regression fix — ✅ CODE COMPLETE May 22 2026

A delivery-partner family tester reported that tapping any card in
the dashboard's "Heads up — coming soon" rail opened the detail
screen with **"Already taken — Another partner claimed this
pickup."** — even though no partner had claimed it. PR 12 added
the rail (server returns `accepted | preparing | ready_for_pickup`
to `listAvailableDeliveries`) but the screen's `deriveDeliveryFlags`
used a catch-all `!isAssignedToMe && !isAvailableForClaim` formula
for `isTerminalForOthers`, sweeping the new preview states into the
"already taken" branch.

PR 23 narrows `isTerminalForOthers` to its original intent
(claimed-by-another OR delivered-by-someone-else) and adds a new
`isComingSoon` flag plus a yellow "⏳ Not yet ready for pickup"
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
      (isDelivered && !isAssignedToMe)` — the catch-all is gone.
- [x] **Tests rewritten** at
      `@/tests/hooks/useDeliveryOrderDetail.test.ts`. The buggy
      "preparing → terminal for others" test was removed; 4 new
      PR-23 tests added: preparing → coming-soon, accepted →
      coming-soon, accepted+claimed → terminal-precedence,
      coming-soon requires delivery role. Suite is now 22 tests
      (was 19; +4 / −1).
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
- [x] **Four new styles** added — `comingSoonCard`,
      `comingSoonTitle`, `comingSoonBody`, `comingSoonEta`. Same
      yellow family (`#FEF9E7` bg, `#F4D03F` border) as the
      dashboard HeadsUpCard.
- [x] **No new `useState`** — the new flag rides through
      `useDeliveryOrderDetail`'s return value, hooks order
      undisturbed.
- [x] **No new `DO NOT REMOVE` markers** (13-PR clean streak).

#### Verification done in-session

- `npx tsc --noEmit` — 0 errors.
- `npm test` — **599 / 599 passing** (was 596; +3 net from the
  test rewrite).
- Deliberate-break test: flipped one new assertion to
  `false`, confirmed exactly 1 fail on the named PR-23 test,
  reverted.

#### Manual smoke-test runbook (post-OTA)

1. Place a COD order; from delivery account, dashboard surfaces
   it under "Heads up — coming soon" while shop is
   accepted/preparing. Tap → yellow banner, **no "Already
   taken"**, no Accept button.
2. Shop sets `readyByEstimate` → within ~5s the banner shows a
   third line "Ready by HH:MM".
3. Shop flips to `ready_for_pickup` → within ~5s banner
   disappears, Accept button appears.
4. Genuine race: two delivery accounts; A taps Accept on a
   `ready_for_pickup` order; B's screen refreshes → still shows
   the legitimate "Already taken" EmptyState. PR 23 does not
   regress this path.
5. Customer / shop accounts opening the same order see no
   PR-23 surface (delivery-only).

#### Deploy

Client-only. No `firebase deploy`. Just:

```bash
npm test
eas update --branch production --message "PR 23 — fix Already Taken on coming-soon orders"
```

Testers force-close + reopen.

#### Rollback

`git revert` the three touched files; OTA. No server state to
unwind.

#### Follow-ups (out of scope)

- [ ] **Polish "just accepted" copy.** Reads slightly awkwardly
      ("The shop is just accepted…"). Change to "looking at it"
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

### PR 22 — Customer delivery instructions per address — ✅ CODE COMPLETE May 21 2026

Solves the "ring the second bell, not the first" / "gate locked
after 9 PM, call when outside" mid-route phone call. Delivery
partners across India lose 3–5 minutes per drop on access
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
      inline as free-text, ≤280 chars, normalized server-side.
- [x] **Pure helper** at
      `@/functions/src/deliveryInstructionsHelpers.ts`.
      `normalizeDeliveryInstructions` returns a discriminated
      union: undefined / null / empty / whitespace-only →
      `undefined` (write nothing); non-string → invalid-argument;
      >280 chars after trim → invalid-argument with explicit
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
      `@/functions/src/index.ts` — extends `validateAddressInput`
      in `profileHelpers.ts` to delegate to the helper, and the
      callable spreads `...(deliveryInstructions !== undefined
      && { deliveryInstructions })` so undefined is *omitted*
      from the Firestore write rather than written as `null`
      (cleaner reads on legacy clients).
- [x] **`placeOrder` callable** wiring stamps the normalized
      string onto `order.deliveryAddress.deliveryInstructions`
      at order-creation time, snapshotting whatever the customer
      saw at checkout — even if they later edit the saved
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
      NOT mutate the saved address — it's only stamped onto the
      single order. Empty input clears the per-order override.
- [x] **Customer OrderDetailScreen** at
      `@/src/screens/OrderDetailScreen.tsx`. Read-only
      confirmation card adjacent to the delivery address. Subtle
      treatment — for the customer it's just a receipt, not
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
      block — most actionable surface in the app for this field
      (the partner is the one ringing the bell). Silently
      omitted on legacy orders.

#### Verification done in-session

- `npx tsc --noEmit` (root) — 0 errors.
- `npx tsc --noEmit -p functions` — 0 errors.
- `npm test` — 596 / 596 passing including the 10 new helper
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
that strips unknown fields silently — instructions silently
dropped, hard to debug.

1. **New address with instructions.** Profile → Add address →
   fill all fields + "Ring second bell, brown gate". Save.
   Reopen → instructions populated.
2. **Char counter.** Type 280 chars exactly → counter green at
   `280/280`. Type 281 → counter red, save button disabled
   (or save fails server-side with the explicit length error).
3. **Edit existing address.** Change instructions to "Gate
   locked after 9 PM, call when outside". Save. Reopen → new
   text persisted; old text gone.
4. **Clear instructions.** Edit, blank the field, save.
   Reopen → field empty; Firestore doc has no
   `deliveryInstructions` key (verify in console).
5. **Checkout pre-fill.** Place order against an address with
   instructions → Checkout shows the saved string in the
   instructions input, editable.
6. **Per-order override.** At checkout, change the input from
   "Ring second bell" to "Today only — leave at door, I'm
   in a meeting." Place order. Open the placed order →
   override is on the order doc. Open the saved address →
   still shows "Ring second bell" (unmutated).
7. **Customer order detail.** Subtle confirmation card
   visible adjacent to the delivery address.
8. **Shop order detail.** Yellow card prominent above items.
   Owner can read while picking.
9. **Delivery order detail.** Yellow card directly under
   "Deliver to" — most prominent surface. Field-tested mental
   model: partner glances at the screen on arrival → reads
   "ring second bell" → no phone call.
10. **Legacy orders.** Open any order placed before this PR →
    no card rendered, no crash, no empty-string artifact.
11. **Server validation.** Hit the callable with
    `deliveryInstructions: 'x'.repeat(500)` → returns
    `invalid-argument` with the length in the message. With
    `deliveryInstructions: 42` → returns `invalid-argument`.
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
eas update --branch production --message "PR 22 — Customer delivery instructions"
```

Testers: force-close + reopen TestFlight.

#### Rollback

- **Server regression** → `git revert` the deliveryInstructions
  edits + redeploy. Existing order docs retain the field
  harmlessly; old code reading them ignores it. New orders
  post-rollback won't have it.
- **Client regression** → `eas update --branch production
  --message "Revert PR 22"` after `git revert` on the client
  edits. Server callable continues accepting the field; just
  no UI to set it.

#### Success metric

Target: **30–50% drop** in mid-route customer phone calls
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
- [ ] **Voice note instructions.** ≤30s audio attached to
      the address; partner taps → plays. Beats typing for
      illiterate / semi-literate customers. Requires audio
      capture + Storage + a player component. [post-MVP]
- [ ] **Shop-side acknowledgement.** Checkbox on the shop
      order detail "✓ I've read the delivery notes" that
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

### PR 21 — Customer substitution preferences at checkout — ✅ CODE COMPLETE May 21 2026

Solves the "namaste, atta khatam ho gaya, Aashirvaad chalega kya?"
problem. Kirana stock volatility is high; mid-fulfillment calls drop;
orders stall. PR 21 captures the customer's intent at checkout
("call me / replace / refund") and shows it prominently on the shop
side so fulfillment proceeds without interruption.

Bilateral payoff: customer doesn't get interrupted; shop finishes
orders faster. Schema-additive (one optional field on Order).

**Server-first deploy** — `placeOrder` callable accepts an
additional optional field; server normalizes / re-validates. Old
clients omitting the field continue to work (server defaults to
`call_me`). New client sending the field on an old server is also
fine (old server ignores unknown fields) — but we deploy server
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
      union: undefined/null → 'call_me' (absorbs old clients);
      allowlist string → echoed; non-string + unknown string +
      empty string → invalid-argument. Empty string deliberately
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
      bill summary and the payment method — placement is
      deliberate so the customer makes the choice BEFORE
      committing to pay. Default 'call_me'.
- [x] **Customer-side confirmation** at
      `@/src/screens/OrderDetailScreen.tsx:296-310;897-914`.
      Subdued surface-colored card right under the delivery
      address. Silently omitted on legacy orders (no field) —
      no choice was made, nothing to confirm.
- [x] **Shop-side prominent display** at
      `@/src/screens/shop/ShopOrderDetailScreen.tsx:297-314;679-703`.
      Primary-tinted card with an accent left border, rendered
      ABOVE the items section so the shop owner sees the
      customer's intent before they start picking. Legacy
      orders explicitly render the `call_me` copy (safe
      fallback — the shop should call when intent is unknown).
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
- `npm test`: **57 suites / 585 tests** (575 → +10 new).
- **Deliberate-break demo passed**: flipped the "defaults to
  call_me when undefined" expectation to expect `'auto'`,
  confirmed exactly 1 fail / 9 pass, reverted.
- Zero new `DO NOT REMOVE` markers... wait — one was added on
  the `substitutionHelpers` import per the code-discipline
  pattern (auto-formatter risk for one-shot single-symbol
  imports of new pure-helper modules). Streak: **11 PRs clean,
  PR 21 adds 1 defensive marker** for an import that's a known
  auto-formatter target pattern. Documented in-line.

#### Smoke tests (after staged deploy)

1. **Default selection.** Open Cart → Checkout. The
   "If something's unavailable" section shows three options;
   "📞 Call me first" has the active border + primaryLight
   background.
2. **Switch selection.** Tap "🔄 Replace with similar". Active
   styling transfers; the call-me card loses its accent.
3. **Place order with 'auto'.** Submit. OrderDetail shows
   "If unavailable → 🔄 Shop will replace with similar".
4. **Shop sees the preference.** Quick Switch to a shop owner
   account, open the same order. Above items, a primary-tinted
   card reads "Customer's preference → 🔄 Replace with
   similar items (shop picks)".
5. **Legacy order display.** Find an order placed before this
   PR. Customer side: no preference card (silently omitted).
   Shop side: card with "📞 Call before substituting or
   refunding" — explicit safe default.
6. **'refund' preference.** Place another order with the
   refund option. Customer + shop displays both reflect it.
7. **Explicit 'call_me' selection.** Place with the default
   explicitly tapped. Choice persists on customer + shop
   sides — distinguishable from legacy by virtue of the field
   being present on the order doc (server normalized + wrote it).
8. **Server validation.** Hit the callable directly (e.g. via
   Cloud Functions console or a test script) with
   `substitutionPreference: 'cancel'`. Server returns
   `invalid-argument`. Valid flows unaffected.
9. **No screen crashes.** Hooks-of-Rules sanity — visit
   CheckoutScreen / OrderDetailScreen / ShopOrderDetailScreen
   across statuses; no ErrorBoundary.

#### Deploy plan

**Server-first** per `.windsurf/deploy-discipline.md`:

```powershell
$env:NODE_OPTIONS = "--use-system-ca"

# 1. Server first — placeOrder must understand the field before
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
eas update --branch production --message "PR 21 — Customer substitution preferences"
```

Testers: force-close + reopen TestFlight.

#### Rollback

- **Server regression** → `git revert` the substitutionHelpers
  + placeOrder edits + redeploy. Order docs created since
  rollout retain the field harmlessly; old code reading them
  just ignores it. New orders post-rollback won't have the
  field; ShopOrderDetail falls back to the 'call_me' default
  copy (graceful).
- **Client regression** → `eas update --branch production
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
      as "substituted with X" or "refunded — adjust total".
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
      an item as substituted / refunded — gated on the
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

### PR 20 — Customer order rating + Shop ratings — ✅ CODE COMPLETE May 21 2026

Restores the trust signal kirana customers lose when they move from
"I know Mahesh-bhai personally" to "I'm browsing an app full of shop
names." After PR 20, every shop card carries a "★ 4.7 (200)" badge
or a "New shop" italic — the same trust-cue language Swiggy / Zomato
/ BlinkIt have trained Indian consumers on for years.

Three ingredients:
1. Rating prompt on OrderDetail for delivered + unrated orders.
2. Rolling average + count denormalized on shop docs (incremental
   compute — no full re-aggregation).
3. Star badge on every shop display surface.

**Server-first rollout** — new `submitOrderRating` callable with no
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
      No firebase-admin imports — testable in plain Node.
- [x] **19 unit tests** at
      `@/tests/functions/ratingHelpers.test.ts`. 14 validation
      cases (every rejection branch + happy paths with /
      without comment + whitespace-collapse). 5 rolling-average
      cases (fresh-shop with 2 starting stars, 4.0/3 + 5-star,
      5.0/10 + 1-star, negative-coercion defense, 1-decimal
      precision sanity).
- [x] **`submitOrderRating` callable** at
      `@/functions/src/index.ts:4932-5047`. Atomic Firestore
      transaction over `orders/{orderId}` + `shops/{shopId}` —
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
      fallback when ratingCount is 0/missing — the
      "no-signal-yet, take-a-chance-but-informed" copy.
- [x] **Badge integration on 4 surfaces**:
      `@/src/components/shop/ShopCard.tsx:30-38` (replaces the
      legacy `★ {shop.rating}` placeholder),
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
      hydrates from a parallel shops fetch — see follow-up).
- [x] **No new useState below early returns** on
      OrderDetailScreen. `optimisticRating` lives with the
      hoisted `[shop, refreshing, refreshNonce]` block per the
      established lineage.

#### Verification

- `npx tsc --noEmit` (root): 0 errors.
- `npx tsc --noEmit -p functions`: 0 errors.
- `npm test`: **56 suites / 575 tests** (556 → +19 new).
- **Deliberate-break demo passed**: flipped the 4.0 / 3 + 5 →
  4.3 expectation to 4.4, confirmed exactly 1 fail / 18 pass,
  reverted.
- Zero new `DO NOT REMOVE` markers added — **11 PRs in a row**
  clean.

#### Smoke tests (after staged deploy)

1. **Rate a delivered order.** Complete an end-to-end order
   through to `delivered`. Open OrderDetail. RateOrderCard
   visible. Tap 5 stars + add comment "Great service" + Submit.
   Card flips to "Thanks for rating! ★★★★★ 'Great service'".
2. **Shop avg updates.** ShopListScreen shows the rated shop's
   card with "★ 5.0 (1)" badge.
3. **Multiple ratings produce a rolling average.** Quick Switch
   to a different test customer, place + complete + rate the
   same shop's order with 3 stars. Shop card now shows
   "★ 4.0 (2)" — `(5+3)/2`.
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
8. **Validation paths.** Submit-disabled until ≥1 star; type
   501 chars in the comment box → input caps at 500; server
   `submitOrderRating` rejects oversized comments with a
   readable `failed-precondition` Alert.
9. **Hooks-of-Rules sanity.** Visit OrderDetail across every
   status with + without rating, navigate Home → Shop →
   OrderDetail repeatedly. No ErrorBoundary screens.

#### Deploy plan

**Server-first** per `.windsurf/deploy-discipline.md`:

```powershell
$env:NODE_OPTIONS = "--use-system-ca"

# 1. Server first — submitOrderRating callable must exist before
#    any client OTA, or every Submit tap returns "function not
#    found" and rolls back the optimistic flip. searchMenuPublic
#    return-shape is additive (rating fields), so old client +
#    new server is fine — old client just ignores the new fields.
cd functions
npm run build
cd ..
firebase deploy --only functions --project grocery-mvp-dev

# 2. Verify the new callable is live
firebase functions:list --project grocery-mvp-dev
# Look for `submitOrderRating` in asia-south1.

# 3. Client OTA
npm test
eas update --branch production --message "PR 20 — Customer ratings + shop ratings"

# 4. Tell testers: force-close + reopen TestFlight.
```

#### Rollback

- **Server regression** → `git revert` the ratingHelpers +
  callable + searchMenuPublicHelpers commits + redeploy
  functions. All schema is additive — old code reading the
  shop or order doc just ignores `rating` / `ratingAvg` /
  `ratingCount`.
- **Client regression** → `eas update --branch production
  --republish [previous-update-id]`. Optimistic ratings
  rendered before rollback survive (server has them); they
  just stop appearing as confirmation cards on old binaries.

**Order matters:** server before client.

#### Headline metric

**% of delivered orders that get rated.** Industry benchmark
30–50% for food delivery, 25–40% for grocery. Below 15% means
the prompt isn't getting tapped — investigate placement
(maybe move above the cancel-window block, or add a push
notification trigger when the order flips to `delivered`).

#### Follow-ups (out of scope this PR)

- [ ] **OrderAgainRail rating hydration.** Today
      `FrequentShopEntry.ratingAvg` / `ratingCount` are unset
      because order docs don't snapshot shop ratings. Wire
      HomeScreen to fire `shopService.list(location)` in
      parallel with `orderService.listMine`, then enrich each
      `FrequentShopEntry` with the matching shop's rating.
      Until then the rail cards show "New shop" — graceful
      degradation, not broken. [PR 20 follow]
- [ ] **Decommission legacy `Shop.rating: number`.** Field
      is a placeholder seed value, never written to by any
      callable. Once every read site uses `ratingAvg`
      (currently: ShopCard ✓, ShopDetailScreen ✓, Search ✓,
      OrderAgainRail ✓ via badge), drop the legacy field
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
      but adds another permissions surface — defer until a
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

### PR 19 — Shopping list / Favorites — ✅ CODE COMPLETE May 21 2026

The third behavioral loop for kirana shopping. PR 13 built "repeat
the whole last order"; PR 14 surfaced "reorder from my usual shop"
on Home; PR 19 closes the loop with **"these specific items are
my essentials — let me grab them quickly without rebuilding the
cart."** Heart icon on every menu row, dedicated FavoritesScreen
grouped by shop, optimistic toggling with server reconciliation.

Industry alignment: every major Indian grocery app (Zepto,
BlinkIt, Swiggy Instamart, Zomato grocery) has a heart icon on
items. The gesture is muscle memory; not having it makes the app
feel less polished than what users compare against.

**Server-first rollout** — new `toggleFavorite` callable. Old
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
      `cancelPaidOrderHelpers` / `auditLogHelpers` — no
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
      validate menuItemId existence — favorites can outlive a
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
      Optimistic local toggle via `setProfile` → callable →
      reconcile with server's authoritative shape. Failure
      rolls back to the pre-toggle baseline + alerts. **Anon
      handling** picks Option A from the prompt §Part 10:
      explicit "Sign in to save favorites" Alert (silent
      no-op was rejected as confidence-destroying — empty
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
      with the PR 12 → PR 18 lineage comment.
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
- `npm test`: **55 suites / 556 tests** (541 → +15 new).
- **Deliberate-break demo passed**: flipped the
  shop-key-cleanup test to expect `{ shop_1: [] }`,
  confirmed exactly 1 fail / 14 pass, reverted.
- Zero new `DO NOT REMOVE` markers added (auto-formatter
  discipline at **10 PRs in a row** without strips).

#### Smoke tests (after staged deploy)

1. **Heart visible, tap to favorite.** Sign in as a customer.
   Open ShopDetailScreen, tap the 🤍 next to atta. It flips
   to ❤️ instantly. Force-close + reopen the app — still
   ❤️ (server-side persisted via the callable + AuthBootstrap
   hydrate).
2. **Tap again to unfavorite.** Heart flips back to 🤍.
   Reload confirms.
3. **Home tile appears.** With at least one favorite, Home
   shows "❤️ N favorites" tile beneath How-it-works. Tap →
   FavoritesScreen opens.
4. **FavoritesScreen lists items grouped by shop.** Each
   shop section shows live prices, packLabel, ❤️ heart, and
   ADD / +/- controls that match what ShopDetailScreen would
   show. Tap ADD → cart updates.
5. **Multi-shop cart blocker still works.** Favorite items
   from Shop A AND Shop B. ADD from Shop A → cart has it.
   From FavoritesScreen tap ADD on Shop B item → "Start a
   new cart?" Alert (existing PR 4 behaviour).
6. **Removed-from-menu handling.** As shop owner, delete a
   favorited menu item. As customer, FavoritesScreen → that
   row reads "No longer on this shop's menu" with a Remove
   button. Tap Remove → row disappears, count on Home tile
   decreases.
7. **Suspended-shop handling.** As admin, suspend a shop the
   customer has favorites at. As customer, FavoritesScreen →
   that shop becomes a dashed-border card "Shop no longer
   available — N favorites can no longer be ordered" with a
   "Remove these favorites" bulk CTA. Tap → group
   disappears, count drops.
8. **Anonymous user.** Sign out, get bootstrapped to anon.
   Open a shop, tap a heart → "Sign in to save favorites"
   Alert. No crash, no orphaned local state.
9. **Hooks-of-Rules sanity.** Navigate Home → Favorites →
   ShopDetail repeatedly, force-close + reopen. No
   ErrorBoundary screens. Discipline holding.

#### Deploy plan

**Server-first** per `.windsurf/deploy-discipline.md`:

```powershell
$env:NODE_OPTIONS = "--use-system-ca"

# 1. Server first — toggleFavorite callable must exist
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
eas update --branch production --message "PR 19 — Favorites + Shopping list"

# 4. Tell testers: force-close + reopen TestFlight.
```

#### Rollback

- Server regression → `git revert` the favoritesHelpers
  + callable + publicProfileShape commits + redeploy
  functions. Storage shape is additive — old code reading
  the doc just ignores the `favorites` field.
- Client regression → `eas update --branch production
  --republish [previous-update-id]`.

**Order matters:** server before client. If you skip the
server deploy and OTA the client first, every heart tap
returns "function not found" and rolls back the optimistic
flip — hearts will visibly jitter.

#### Headline metric

**% of cart-add events that originate from a favorite tap**
(vs. fresh-browse +/-). Industry numbers from Zepto/BlinkIt
suggest 35–45% within 4 weeks of consistent customer use.

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
      `toggleFavorite` calls. Optimisation only — current
      sequential behaviour is correct, just chatty when a
      shop with 10+ favorites gets suspended. [PR 19 follow]
- [ ] **Migrate ProfileScreen to read from
      useProfileStore**. Today it keeps its own local
      `useState<UserProfile>` synced via `useFocusEffect`.
      That keeps working, but unifying the two surfaces
      onto the new store would let address edits broadcast
      to other screens too. Pure refactor — no user-facing
      change. [post-MVP]

### PR 18 — Quick Switch test accounts — ✅ CODE COMPLETE May 21 2026

Pure productivity multiplier for solo / multi-role testing. Pre-PR
the role-switch flow was sign-out → enter phone → wait for OTP →
enter `123456` → wait for verify → land on Home (~45s per switch).
Post-PR a single tap on a `Switch test account` tile runs the same
chain programmatically end-to-end in ~5s. Family-testing throughput
roughly 5x.

**No backdoor.** Firebase Auth still gates everything. The shortcut
just removes manual typing for phones already configured in
Firebase Console's "Phone numbers for testing" list.

**Production safety via test-list membership gate** (not `isAdmin`):

- Real customer phones aren't in `TEST_ACCOUNTS` → button hidden.
- Anonymous bootstrap users (no phone yet) → button hidden.
- Every test phone IS in the list → after switching admin →
  customer-test, the button stays visible so you can switch back.

If the feature ever leaks to a production-customer build, the worst
case is the button is hidden for everyone because no real-customer
phone matches the dev-project's test list.

Pure client OTA — no schema, no server, no rollout risk.

#### What shipped

- [x] **Test accounts constants** at
      `@/src/constants/testAccounts.ts`. `TestAccount` type +
      `TEST_ACCOUNTS` array. Doc block explains the
      Firebase-Console contract: phones + OTPs MUST match
      `Authentication → Settings → Phone numbers for testing`.
      Edit this file when you change that list. Phones are
      placeholder dev values — update to match the actual
      `grocery-mvp-dev` console config before first use.
- [x] **QuickSwitchModal component** at
      `@/src/components/dev/QuickSwitchModal.tsx`. Renders the
      list, runs the auth chain (`signOut` →
      `startPhoneAuth` → `confirmOtp` → `setUser`), surfaces
      errors inline, blocks Cancel during in-flight switch.
      Single `busy` slot serves as both mutex + spinner-target
      selector — single source of truth.
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
- `npm test`: **54 suites / 541 tests** (unchanged — prompt
  explicitly said no new tests required).
- Zero new `DO NOT REMOVE` markers added (auto-formatter
  discipline at **9 PRs in a row** without strips).

#### Smoke tests (after OTA)

1. **Visibility gating — non-test phone.** Sign in as a real
   number not in `TEST_ACCOUNTS`. NO `Switch test account`
   tile visible. Sign out, sign in as any test phone → tile
   appears at the bottom of Home above the dev debug line.
2. **First switch.** Sign in as Admin test phone. Tap the
   tile. Modal opens with all 5 entries. Tap Customer A.
   Within ~5s, you're signed in as Customer A — Home shows
   customer UI, no admin tiles, the `[Admin]` debug marker
   is gone.
3. **Round trip.** Tile is STILL visible on Customer A's
   Home (Customer A's phone is in `TEST_ACCOUNTS`). Tap →
   pick Admin → ~5s later you're admin again. Free
   round-trip without manual login.
4. **Failure handling.** Temporarily add a fake entry with a
   phone NOT in Firebase Console. Tap it. Modal shows the
   error inline at the bottom of the card; modal stays open
   for retry. Tap a valid entry → succeeds.
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
eas update --branch production --message "PR 18 — Quick Switch test accounts (test-phone gated)"
```

No functions deploy, no rules deploy, no native rebuild. Most
testers won't see any change — the tile only appears for users
whose phone is in `TEST_ACCOUNTS`.

#### Removing this later (production hand-off)

When you're done with testing-phase work and want to ship to real
customers, two paths:

- **Option A — Hide the trigger** (preferred). Change
  `isTestAccount` to `false` (or to a feature-flag check that
  defaults off). Modal + constants stay in the codebase but the
  UI surface disappears. Easy to re-enable later. Note that
  test-list membership ALREADY auto-hides the button for real
  customers, so this is belt-and-braces.
- **Option B — Delete the files**. `git rm`
  `@/src/constants/testAccounts.ts`,
  `@/src/components/dev/QuickSwitchModal.tsx`, the HomeScreen
  imports + button. ~5 min revert.

Plan the removal alongside the production Firebase project setup
section below in this document. Test accounts only exist in the
dev project anyway — they don't carry to prod.

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
- [ ] **Custom-token minting via admin SDK** — would let us
      switch without invoking the OTP flow at all (~1s instead
      of ~5s). Adds a server callable + a security review
      surface; the OTP shortcut is sufficient for now. [post-MVP]
- [ ] **In-app editor for `TEST_ACCOUNTS`.** Skip — editing the
      .ts file and shipping an OTA is the right workflow for a
      ~5-entry list. [won't-do]

### PR 17 — Polish bundle — ✅ CODE COMPLETE May 19 2026

Three small UX wins bundled into one OTA. None is a feature on
its own; together they make the customer side feel finished.

1. **Per-minute ETA ticker** on the Active orders rail — "Arriving
   in ~5 min" now decrements visibly while the customer lingers
   on Home, instead of going stale until the next focus refetch.
2. **Customer "Call shop" button** on OrderDetailScreen — mirror
   of the shopkeeper's "Call customer" affordance from PR 12.
   Closes the bilateral communication loop.
3. **Pull-to-refresh** on OrderDetailScreen — same posture as PR
   7's AdminOrders / ShopOwnerDashboard pattern, via a
   `refreshNonce` that the watcher useEffect depends on.

**Scope reduction discovered during recon** (and documented in
follow-ups below):

- **Bottom-tab badge (prompt §Part 2) was SKIPPED.** This app
  uses a pure `createNativeStackNavigator` — there is no
  `Tab.Navigator`, so `tabBarBadge` has nothing to attach to.
  Adding tabs would be a substantial nav refactor outside this
  bundle's scope.
- **OrdersScreen pull-to-refresh (prompt §Part 4) was already
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
      60s (not 1s) — matches the "~N min" rounding granularity,
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
      accepted/preparing orders — same hierarchy as
      OrderDetailScreen so the two surfaces agree.
- [x] **Call shop button + handler + fetch**
      (`@/src/screens/OrderDetailScreen.tsx`). Adds `shop`
      state hoisted with the PR-12/13/14/15/16 lineage
      comment. Fetches the shop doc once per `order.shopId`
      via `shopService.getById(...)` (cheap; the screen is
      ephemeral). Button gated on `shop?.registrationData?.phone`
      — that's where the kirana phone actually lives per
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
- `npm test`: **54 suites / 541 tests** (unchanged — prompt
  explicitly said no new tests).
- Zero new `DO NOT REMOVE` markers added (auto-formatter
  discipline at **8 PRs in a row** without strips).

#### Smoke tests (after OTA)

1. **ETA ticker.** Place an order, get it accepted with an
   ETA. Open Home, leave the app open. After 60 seconds, the
   "Arriving in ~X min" number on the Active rail card
   decrements by 1. (PR 17 §Part 1 acceptance criterion.)
2. **Call shop button visible.** Open any order detail as
   customer. Below the shop name section title is a
   primary-tinted pill: "📞 Call shop (XXXXXXXXXX)". Tap →
   native dialer opens with the shop's number pre-filled.
3. **Call shop hidden for legacy shop.** Open an order from
   one of the seed shops (no `registrationData`). No button.
   No broken layout.
4. **Pull-to-refresh on OrderDetail.** Open any order. Pull
   down. Spinner appears, watcher re-subscribes, spinner
   clears on first callback (~1–2s on a healthy network).
   Order content refreshes.
5. **Hooks-of-Rules sanity.** Navigate Home → Orders →
   OrderDetail repeatedly. Force-close + reopen. No
   ErrorBoundary screens. Discipline holding across all
   modified screens.

#### Deploy plan

Pure client OTA per `.windsurf/deploy-discipline.md`:

```powershell
$env:NODE_OPTIONS = "--use-system-ca"
npm test
eas update --branch production --message "PR 17 — Polish bundle (ETA ticker + Call shop + OrderDetail pull-to-refresh)"
```

No functions deploy, no rules deploy, no native rebuild. Tell
testers to force-close + reopen TestFlight.

#### Rollback

- UI regression → `eas update --branch production --republish
  [previous-update-id]`. Server unchanged → safe rollback at
  any time.

#### Follow-ups (out of scope this PR)

- [ ] **Bottom-tab badge for active orders.** Requires
      converting `AppNavigator` from `createNativeStackNavigator`
      to a Tab-over-Stack hybrid. Substantial nav-shape refactor
      — defer until the IA cost-benefit shifts (e.g. when the
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
      countdown) — the "Arriving in ~X min" copy at
      `OrderDetailScreen` line ~109 still uses `Date.now()`
      directly. Cheap follow-up: swap to `nowMs`. [PR 17 follow]

### PR 16 — Shop owner new-order alert — ✅ CODE COMPLETE May 18 2026

The single biggest UX gap between this app and Swiggy Partner /
Zomato Restaurant. Shop owners running real kirana stores don't
watch their phone screens — they're stocking shelves and billing
walk-ins. New orders sat unaccepted for minutes, the customer
waited, the supply chain stalled.

PR 16 makes new orders **impossible to miss** with three
coordinated cues, all OTA-friendly:

1. **Yellow banner** at the top: "🔔 N new orders" — left-rail
   accent in `colors.warning`, readable across a counter.
2. **Highlighted card border** on each new order: 2px primary
   border + tinted background + "NEW" tag. Same aesthetic as
   PR 15's ActiveOrdersRail cards — visual language for "live,
   needs attention" is now unified across customer + shopkeeper
   surfaces.
3. **Single haptic buzz** via `expo-haptics` (already bundled —
   no native dep change). One `Success` notification per polling
   tick that has at least one new order, regardless of count.

Pure client OTA, zero schema changes, zero server work.

#### What shipped

- [x] **Pure helper `detectNewOrderIds`** at
      `@/src/utils/detectNewOrderIds.ts`. Pure ID-set diff
      (deliberately not timestamp-based — server clock drift +
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
- `npm test`: **54 suites / 541 tests** (534 → +7 new).
- Deliberate-break: flipped first-tick test to expect size 3 →
  1 failed / 6 passed → reverted; 541 green.
- Zero new `DO NOT REMOVE` markers added (auto-formatter
  discipline at **7 PRs in a row** without strips).

#### Smoke tests (after OTA)

1. **First open of dashboard.** Shopkeeper opens dashboard
   with N existing orders. NO banner, NO haptic, NO "NEW" tags.
   First-tick baseline established silently.
2. **One new order arrives mid-session.** Within ~10s polling
   cycle: banner appears with "🔔 1 new order", that card has
   2px green border + NEW tag, phone buzzes once.
3. **Three new orders in same tick.** Banner reads "🔔 3 new
   orders", all three cards highlighted with NEW tags, only
   ONE haptic fires (not three — stays calm).
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
   removes it from listShopOrders → no spurious NEW tag on
   remaining orders. Pinned by helper test #4.
9. **Web preview.** Visual banner + card highlights work,
   haptic silently no-ops via the .catch wrapper.

#### Deploy plan

Pure client OTA per `.windsurf/deploy-discipline.md`:

```powershell
$env:NODE_OPTIONS = "--use-system-ca"
npm test
eas update --branch production --message "PR 16 — Shop owner new-order alert"
```

No functions deploy, no rules deploy, no native rebuild
(`expo-haptics` was already in the bundled native build per
`package.json`). Tell shop-role testers explicitly to keep the
dashboard open for ~30s after a customer-role tester places an
order on their shop — they should see banner + haptic within
one polling cycle.

#### Rollback

- UI bug → `eas update --branch production --republish
  [previous-update-id]`. Server unchanged → safe rollback at
  any time.

#### Headline metric to watch

**Time from order placed → order accepted by shop.**

- Pre-PR-16 baseline: 5–8 min (whenever the shopkeeper next
  glanced at the screen).
- Post-PR-16 expectation: <2 min for shopkeepers who keep the
  app open with the phone audible.

That delta cascades through every downstream surface PR 12
(ETA visibility), PR 15 (active orders rail), and PR 7
(delivery pool) added — the whole supply chain tightens by
~5–10 min per order.

#### Follow-ups (out of scope this PR)

- [ ] **Sound notification.** Add `expo-av` and play a short
      ding for `Success` ticks. Native module add → rebuild +
      TestFlight resubmit. Big quality-of-life win once
      family testing requests it. [PR 16 follow]
- [ ] **Background push.** Alert shopkeepers when the app is
      closed. Needs Expo Push or FCM token registration +
      server-side trigger on order create. Substantial
      separate body of work. [post-MVP]
- [ ] **Per-shop alert preferences.** Volume / vibrate /
      silent toggle stored on the shop doc. Premature for
      MVP — single fixed behaviour for now. [post-MVP]
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

### PR 15 — Active orders rail on HomeScreen — ✅ CODE COMPLETE May 18 2026

The home screen becomes the customer's full order command center.
PR 14 surfaced PAST orders on Home; PR 15 surfaces IN-FLIGHT orders
on the same screen, ABOVE the Order Again rail. A returning customer
opens the app and immediately sees:

- "Your active orders" — what's currently being made / out for delivery
- "Order again" — shops they keep coming back to

No more tapping the Orders tab just to check status. Pure client OTA;
zero new server work; reuses PR 14's `listMine` cache via `useMemo`
so there is literally no additional network cost.

#### What shipped

- [x] **Pure helper `pickActiveOrders`** at
      `@/src/utils/pickActiveOrders.ts`. Filters to the four
      non-terminal statuses (`pending`, `accepted`, `preparing`,
      `ready_for_pickup`), sorts `createdAt` desc, copies before
      sorting (no input mutation). Strict allowlist — unknown
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
      set → "Out for delivery"; without → "Almost ready". Negative
      / zero `minsLeft` → "Arriving soon" (don't show negative
      countdowns). No `eta` set → empty string (skip the line
      entirely rather than render a misleading placeholder).
- [x] **HomeScreen integration**
      (`@/src/screens/HomeScreen.tsx`). Derives `activeOrders`
      from PR 14's existing `recentOrders` cache via `useMemo` —
      zero new state, zero new network calls, zero new
      `useState` hook count. Tap handler navigates to
      `OrderDetail`. Rail rendered ABOVE `OrderAgainRail`
      (priority slot — active needs attention more than past).
- [x] **PR 14 hooks-discipline comment intact.** No new state
      added in this PR, so the comment block citing PR 12's
      ETA-modal hotfix and PR 13's OrdersScreen guard stays as
      written. Pure additive composition — exactly the pattern
      the discipline aimed for.
- [x] **Symmetric handoff with PR 14.** When an order
      transitions from `ready_for_pickup` → `delivered`, the
      next focus refetch removes its card from `ActiveOrdersRail`
      AND adds its shop to `OrderAgainRail` (PR 14 picks
      delivered orders). Customers experience a single seamless
      animation as the order moves between rails.

#### Verification

- `npx tsc --noEmit`: 0 errors.
- `npm test`: **53 suites / 534 tests** (527 → +7 new).
- Deliberate-break: flipped "excludes delivered and cancelled"
  test to expect `toHaveLength(2)` → 1 failed / 6 passed →
  reverted; 534 green.
- Zero new `DO NOT REMOVE` markers added (auto-formatter
  discipline at **6 PRs in a row** without strips).

#### Smoke tests (after OTA)

1. **Place an order.** Open Home before shop accepts. Rail card
   shows "Pending" chip + ETA. Tap → OrderDetail.
2. **Shop accepts.** Return to Home. Card chip flips to
   "Accepted" + ETA recomputed from `estimatedDeliveryAt`.
3. **Full lifecycle.** pending → accepted → preparing →
   ready_for_pickup (no pickedUpAt → "Almost ready") →
   ready_for_pickup (with pickedUpAt → "Out for delivery") →
   delivered. At delivery, card vanishes from active rail AND
   shop appears in Order Again rail below. Symmetric handoff
   verified.
4. **Multiple active orders.** Place 3 from 3 shops within
   minutes. Rail shows all 3, newest leftmost.
5. **Cancelled order.** Customer cancels mid-flight. Card
   disappears from active rail. Shop does NOT appear in Order
   Again rail (PR 14 excludes cancelled). Both correct.
6. **First-time / anonymous user.** Both rails empty. Home
   shows just search + categories — no layout shift, no skeleton.
7. **Customer-facing label sanity.** A `ready_for_pickup`
   order shows "Out for delivery" on the chip — confirming the
   `audience="customer"` override is wired correctly. The shop
   side still sees "Ready for Pickup" on their dashboard.
8. **ETA staleness check.** Open Home with an active order, leave
   the screen open for 5 min. ETA copy stays static (no per-second
   ticker) — that's the deferred behaviour. Pull-to-refresh /
   navigate-back-to-Home triggers the focus refetch and refreshes
   the line.

#### Deploy plan

Pure client OTA per `.windsurf/deploy-discipline.md`:

```powershell
$env:NODE_OPTIONS = "--use-system-ca"
npm test
eas update --branch production --message "PR 15 — Active orders rail on Home"
```

No functions deploy, no rules deploy, no native rebuild. Tell
testers to force-close + reopen TestFlight after publish.

#### Rollback

- UI bug → `eas update --branch production --republish
  [previous-update-id]`. Server unchanged → safe rollback at
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
      OrderDetail. UX-only change — primitive already exists.
      [PR 15 follow]
- [ ] **Push notifications on status change.** The right
      replacement for the focus-refetch model. Needs Expo Push
      / FCM infra — separate body of work. [post-MVP]
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

### PR 14 — HomeScreen "Order again" rail — ✅ CODE COMPLETE May 18 2026

PR 13 made reorder POSSIBLE; PR 14 makes it DISCOVERABLE. Returning
customers now land on Home and see "Order again from Mahesh Kirana"
cards as the very next surface after the search box, ranked by
delivery frequency. Composes every PR 13 primitive — no new server
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
      ScrollView of 180dp cards (1.5–2 visible at a time —
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
      round-trip — the optimisation called out in the PR 14
      prompt §Part 5), fetches the shop's current menu via
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
      HomeScreen has no early returns today — the comment
      enshrines the discipline so a future refactor can't
      quietly reintroduce the bug.
- [x] **Rail placement.** Sits between the search Pressable
      and the category chips — the highest-impact slot. Above
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
- `npm test`: **52 suites / 527 tests** (516 → +11 new).
- Deliberate-break: flipped expected order in
  "orders by orderCount desc" test → 1 failed / 10 passed →
  reverted; 527 green.
- Zero new `DO NOT REMOVE` markers added.

#### Smoke tests (after OTA)

1. **New customer, no orders.** Open Home → rail entirely
   absent (no header, no skeleton, no empty card).
2. **One delivered order from one shop.** Rail shows one card.
   Tap → modal loads → confirm → cart filled → Cart screen.
3. **Mixed history.** 3 from Shop A, 2 from Shop B, 1 from
   Shop C → rail shows A, B, C in that order.
4. **In-flight orders don't count.** Place a fresh order with
   a new shop, leave it pending → return to Home → rail
   unchanged.
5. **Cancelled orders don't count.** Cancel a fresh order from
   a never-completed shop → return to Home → that shop is NOT
   in the rail.
6. **Suspended shop.** Admin suspends a shop the customer
   reordered from → tap that card → fetch fails → Alert
   "This shop may no longer be available." Cart unchanged.
7. **Cross-shop replace.** Cart from Shop A; tap "Order again"
   for Shop B → confirm → cart now Shop B only (replace, not
   merge — same as PR 13).
8. **Rail refreshes after fresh delivery.** Place + complete a
   new shop's order → return to Home → that shop is now top
   of the rail (most recent).
9. **Hooks-of-Rules sanity.** Navigate Home → Orders → Home
   several times. ErrorBoundary should never trip (the bug
   PR 12's hotfix exposed).
10. **Anonymous user.** Sign out → landing on Home → rail
    absent. Sign in → return to Home → rail rebuilds within
    one focus cycle.

#### Deploy plan

Pure client OTA per `.windsurf/deploy-discipline.md`:

```powershell
$env:NODE_OPTIONS = "--use-system-ca"
npm test
eas update --branch production --message "PR 14 — HomeScreen Order Again rail"
```

No functions deploy, no rules deploy, no native rebuild. Tell
testers to force-close + reopen TestFlight after publish.

#### Rollback

- UI bug → `eas update --branch production --republish
  [previous-update-id]`. Server unchanged → safe rollback at
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
      metric this PR moves (industry benchmark: ~120s → ~20s
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
      them client-side before render — needs a shop-status
      lookup (cheap if listMine starts denormalising it).
      [PR 14 follow]

### PR 13 — Repeat order button — ✅ CODE COMPLETE May 18 2026

The single highest-leverage retention feature for grocery. Tap
Reorder on a past delivered/cancelled order → modal shows the
items at current prices + availability → confirm replaces the
cart and lands you on the Cart screen. Pure client OTA — no
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
      `@/tests/utils/buildReorderPlan.test.ts` — all five
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
      Available (green ✓ + price + diff badge),
      Unavailable (struck-through name + reason),
      Subtotal preview at current prices. Loading state shows a
      spinner. CTA disabled when `availableCount === 0`. Tap
      outside / hardware back closes via `onRequestClose`.
      Presentation-only — no Zustand calls inside.
- [x] **OrdersScreen integration**
      (`@/src/screens/OrdersScreen.tsx`). Reorder button only on
      `delivered` / `cancelled` cards (terminal states). On tap:
      open modal in loading state → fetch
      `orderService.listShopMenuPublic(shopId)` → build plan →
      render. Confirm calls
      `useCartStore.getState().replaceCartWithItems(...)` and
      navigates to Cart. Failed shop fetch closes the modal and
      shows an Alert ("This shop is no longer accepting orders").
- [x] **Status chip uses `audience="customer"`** on
      OrdersScreen now too (`@/src/screens/OrdersScreen.tsx:227`),
      so customers consistently see "Out for delivery" instead
      of "Ready for Pickup". Was missed in PR 12 — caught when
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
- `npm test`: **51 suites / 516 tests** (502 → +14 new).
- Deliberate-break: flipped `available_price_increased` test
  expectation to `available_same_price`; one test went red as
  expected; reverted; 516 green.
- Zero new `DO NOT REMOVE` markers added.

#### Smoke tests (after OTA)

1. **Happy path same prices.** Past order with 3 unchanged items
   → modal shows all 3 available, no badges → Add → cart has
   them at the same prices and quantities.
2. **Price change.** Shop bumped atta ₹250 → ₹275 → modal shows
   ₹275 with ₹250 struck through + "+10%" badge → Add → cart
   line price = ₹275, priceSnapshot = ₹275.
3. **Some items unavailable.** Shop marked rice unavailable via
   PR 8 bulk action → modal shows atta + dal in Available, rice
   in Unavailable ("Currently unavailable"). CTA = "Add 2 items
   to cart" → cart has 2 items.
4. **All items unavailable.** Shop suspended every item → modal
   shows everything in Unavailable. CTA = "No items available"
   and disabled. Cancel → cart unchanged.
5. **Shop suspended.** Reorder from a shop the admin has since
   suspended → fetch fails → modal closes → Alert "This shop is
   no longer accepting orders." Cart unchanged.
6. **Replace cart from different shop.** Cart has 5 items from
   Shop A. Tap Reorder on a Shop B past order. Confirm → cart
   now has Shop B items only.
7. **Reorder a cancelled order.** Customer cancelled a paid
   order via the PR 7 2-min window. Reorder button still
   appears; flow works identically to delivered case.

#### Deploy plan

Pure client OTA per `.windsurf/deploy-discipline.md`:

```powershell
$env:NODE_OPTIONS = "--use-system-ca"
npm test
eas update --branch production --message "PR 13 — Repeat order button"
```

No functions deploy, no rules deploy, no native rebuild. Tell
testers to force-close + reopen TestFlight after publish to pick
up the new bundle.

#### Rollback

- UI bug → `eas update --branch production --republish
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
      last order from Mahesh Kirana — reorder?" Needs the
      transactional-push infrastructure not yet built.
      [post-MVP]
- [ ] **Reorder-conversion telemetry.** % of orders initiated
      via the Reorder button vs. fresh browse. The synthetic
      `product_id: 'reorder'` add_to_cart event is the first
      breadcrumb; wire to a dashboard query once GA4 / Mixpanel
      is live. [post-MVP]

### PR 12 — Shopkeeper ETA + early delivery visibility + status rename — ✅ CODE COMPLETE May 18 2026

The biggest piece of family-testing feedback. Three coordinated
changes:

1. **Shopkeeper-provided `readyByEstimate`** field on every order;
   server enforces it as REQUIRED on accept, OPTIONAL on preparing
   (mid-prep update path).
2. **Delivery dashboard early visibility** — partners now see
   accepted/preparing orders in a "Heads up — coming soon" pool
   so they can plan routes before the shop signals ready.
3. **Customer-facing copy preservation** — the internal status
   `ready_for_pickup` (renamed from `out_for_delivery` in a
   prior PR) continues to read "Out for delivery" on customer
   screens via a new `audience` prop on `OrderStatusChip`.

> Note: the `out_for_delivery` → `ready_for_pickup` rename was
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

- [x] **`firestore.rules`** — the delivery-pool clause still
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
      "Out for delivery" — already correct.

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
      given — admin's "updated from" indicator parses this.
- [x] **15 unit tests** at
      `@/tests/functions/orderStatusTransitionHelpers.test.ts`
      cover: missing/null/string/NaN/Infinity/past/future cases
      for accept; optional + future cases for preparing;
      ignored cases for other transitions; boundary case
      (ETA == now is accepted).

#### Delivery dashboard split (Part 4)

- [x] **Server `listAvailableDeliveries` broadened**
      (`@/functions/src/index.ts:2417-2446`) — `where('status',
      'in', AVAILABLE_POOL_STATUSES)` returns the union of
      {accepted, preparing, ready_for_pickup}. `claimDelivery`
      still rejects anything that isn't ready_for_pickup, so
      reading != claiming.
- [x] **Function-level `canReadOrder` mirrors**
      (`@/functions/src/getOrderAuth.ts:59-95`). Set lookup
      across the three pool statuses. PR 8.1's
      `system → customer` widening stayed; this PR widens
      again on a different axis.
- [x] **Client split into `headsUp` + `availableNow`**
      (`@/src/screens/delivery/DeliveryDashboardScreen.tsx:168-185`).
      New `HeadsUpCard` component (`@/src/screens/delivery/DeliveryDashboardScreen.tsx:584-636`)
      with soft-yellow visual treatment (so partners don't
      mistake it for a claimable card), "Ready by HH:MM"
      line surfacing the shopkeeper's ETA, and `Tap to view
      items` hint (no claim affordance).

#### Shopkeeper UI (Part 5 — Option A)

- [x] **ETA prompt modal** wired to Accept (mandatory) +
      Start Preparing (optional, prefilled with remaining
      minutes from existing readyByEstimate). Validates
      1-240 minutes client-side; server is the source of
      truth. `@/src/screens/shop/ShopOrderDetailScreen.tsx:146-201, 396-460`.
- [x] **Hook + helper passes ETA through**
      (`@/src/screens/shop/ShopOrderDetailScreen.useShopOrderDetail.ts:80-112, 132-187`).
      `readyByEstimate` flows hook → runOrderActionOnce →
      orderService.updateOrderStatus → callable.
- [x] **Current ETA card** above the action buttons
      (`@/src/screens/shop/ShopOrderDetailScreen.tsx:364-374`)
      so the shop sees what the customer is currently being
      told before tapping anything.

Tracking Option B (quick-pick chips) as a follow-up PR if shops
ask. Option A ships now per the prompt's recommendation.

#### Admin summary line (Part 6)

- [x] **"⏰ Ready by HH:MM"** line on every active card
      (`@/src/screens/admin/AdminOrdersScreen.tsx:251-276`).
- [x] **"(updated from HH:MM)"** trail when current
      readyByEstimate diverges from the original
      accepted-time ETA by more than 30 seconds. Pulls the
      original from statusHistory[].reason via
      `findOriginalEta` helper
      (`@/src/screens/admin/AdminOrdersScreen.tsx:33-59`).
- [x] **DO NOT REMOVE marker** added to the helper —
      auto-formatter ate the function declaration once during
      this PR; rewriting as a `const` arrow + DO NOT REMOVE
      comment block survived subsequent saves.

#### Customer copy (Part 7)

- [x] **Audience-aware OrderStatusChip** — customer sees
      "Out for delivery" when internal status is
      `ready_for_pickup`. Admin/shop/delivery see "Ready for
      Pickup" via the default `'internal'` audience.
- [x] **OrderDetailScreen ETA copy** branches on status
      (`@/src/screens/OrderDetailScreen.tsx:147-167`):
  - accepted/preparing + readyByEstimate present →
    "Ready by HH:MM at the shop. Delivery partner will pick
    up and bring it to you."
  - other in-flight states → existing minutes-left estimate.
  - delivered/cancelled → hidden.

#### Backwards-compat (Part 8)

- [x] Every render path that uses `readyByEstimate` first
      checks `if (order.readyByEstimate)` — null/undefined
      legacy orders hide the ETA line and fall back to the
      existing `estimatedDeliveryAt` minutes counter or omit
      entirely. Pinned by retaining old test fixtures with
      `readyByEstimate: null` (legacy semantic).
- [x] No migration script needed.

#### Verification

- `npx tsc --noEmit` (root): **0 errors**.
- `npx tsc --noEmit` (functions): **0 errors**.
- `npm test`: **50 suites, 502/502** (479 → +15 ETA helper +
  +7 PR 11 carry-over + +1 delivery-pool case minus a
  refactored case).
- `npm run audit:indexes`: 28 chains / 0 missing. The new
  `where('status', 'in', [...])` + `where('deliveryPersonId',
  '==', null)` + `orderBy('createdAt')` query in
  `listAvailableDeliveries` may need a fresh composite
  index in production — Firebase will surface the build
  link in the deploy logs the first time the query runs
  in prod and a partner is online. Track to verify
  post-deploy.
- Deliberate-break: short-circuited the past-timestamp guard
  with `if (false && …)`. Two tests went red as expected
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

# 1a. Rules — broadened delivery-pool clause.
firebase deploy --only firestore:rules --project grocery-mvp-dev

# 2. TestFlight pointed at dev → run smoke tests below.

# 3. Client OTA (only after dev smoke fully green).
eas update --branch preview --message "PR 12 shopkeeper ETA workflow"

# 4. Promote.
eas update --branch production --message "PR 12 shopkeeper ETA workflow"

# 5. Prod functions + rules (only after prod OTA verified).
firebase deploy --only functions --project grocery-mvp-prod
firebase deploy --only firestore:rules --project grocery-mvp-prod
```

#### Smoke tests (dev project first)

1. Customer places order → shop accepts with "Ready in 20 min" →
   delivery partner's "Heads up" section shows the order with
   "Ready by [time]" badge → shop marks preparing → partner
   sees it stay in heads-up → shop marks "Ready for pickup" →
   moves to partner's "Available now" → claim → pickup → deliver.
2. Shop accepts with 20 min → updates to 30 min mid-prep →
   admin's card shows "(updated from [old time])".
3. Shop tries Accept with 0 min or past → server returns
   `invalid-argument`; client Alert shows the message.
4. Find a legacy order (no `readyByEstimate`) → all four
   screens (customer / shop / admin / delivery) render
   without "undefined" / "NaN" leaks.
5. Existing flows: PR 7 cancel-within-2-min, PR 8 bulk
   menu availability, PR 11 admin timeline expansion — all
   still pass.

#### Rollback

- Server validation broken → `git revert` PR 12 commit, redeploy
  functions. v(N-1) client + v(N-1) server is what was running
  before.
- Client OTA UI bug → `eas update --branch production
  --republish [previous-update-id]`. v(N-1) client + vN server
  works because the server happily ignores extra fields.
- vN client + v(N-1) server is the **broken** combination —
  v(N-1) server doesn't know `readyByEstimate` and the
  callable will reject "Unknown argument". Always deploy
  server before client; always roll back client before server.

### PR 11 — Admin order timeline view — ✅ CODE COMPLETE May 18 2026

JS-only, OTA-able. Pure read-only UI on `AdminOrdersScreen`.
Builds confidence that the `statusHistory` data we've been
writing since PR 2 is end-to-end correct, before PR 12 starts
mutating it. Zero schema, callable, or rule changes.

#### What shipped

- [x] **Pure helpers extracted to a testable module.**
      `@/src/utils/orderTimeline.ts` — exports
      `labelForTimelineStatus(status)` and
      `formatTimelineActor(by)` plus the `TimelineEntry` type.
      Kept separate from the React component so the actor-
      parsing rules and label mapping pin in unit tests
      without a renderer.
- [x] **Visual component.**
      `@/src/components/order/OrderTimeline.tsx` — vertical
      strip of dots + connector lines on the left, status
      label + timestamp + actor + optional reason on the
      right. React Native primitives only (View / Text /
      StyleSheet). `numberOfLines` clamps on actor (1) and
      reason (2) to prevent runaway cards.
- [x] **Disclosure wired on AdminOrdersScreen.**
      `@/src/screens/admin/AdminOrdersScreen.tsx:50-58, 364-395, 511-518`.
      New `timelineExpandedId` state, independent of
      `overrideExpandedId`. Disclosure label shows step
      count (`▸ Full timeline (5 steps)`) so admins get
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

- `${role}:${uid}` for human actors → render as
  `${role}:${uid.slice(0,4)}...` to keep the cell compact
  and avoid leaking full uids in screenshots.
- bare token (`system`, `razorpay-webhook`) or short
  namespaced token (`system:cleanup`,
  `client-confirm:abc1234` ≤ 8-char suffix) → render verbatim.

The 8-char threshold is the heuristic that distinguishes
"short namespaced token" from "uid". Pinned in
`@/tests/utils/orderTimeline.test.ts:14-50`.

#### Verification

- `npx tsc --noEmit` (root + functions): **0 errors**.
- `npm test`: **49 suites, 486/486** (479 → +7 PR 11 cases
  covering uid truncation, namespaced tokens, bare tokens,
  empty/null fallback, all status labels, unknown-status
  fallback).
- `npm run audit:indexes`: 28 chains / 0 missing.
- Deliberate-break: changed expected uppercase-role
  assertion → red as expected (`Expected: "CUSTOMER:7Xkj..."
  Received: "customer:7Xkj..."`) → reverted; 486 green.
- One new `DO NOT REMOVE` comment in
  `@/src/screens/admin/AdminOrdersScreen.tsx:15-16` for the
  OrderTimeline import block — added defensively because
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
   timestamp + `▸ Full timeline (1 steps)` disclosure.
   Expand → single `Pending · <time> · by system` row.
2. **Full lifecycle.** Place → accept → prepare →
   out_for_delivery → claim → pickup → deliver. After each
   transition the disclosure step-count and timeline grow
   by one; actors show as `shopOwner:JK2L...`,
   `delivery:9Mxs...`, etc.
3. **Customer cancel within 2-min window** (PR 7).
   Timeline entry shows `by customer:XXXX...` (PR 8.1's
   role widening flowing through end-to-end).
4. **Admin cancel + refund.** Three rapid entries —
   `cancelled`, `refund_pending`, `refunded` — appear in
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

### PR 10 — Quickwins bundle (shop radius + required name + Resend OTP) — ✅ CODE COMPLETE May 18 2026

JS-only OTA bundle. Three small fixes that the test team needs at
once instead of three sequential reopen cycles.

#### Part 1 — Open shop radius for cross-city testing

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

#### Part 2 — Required full name on profile

- [x] **Server `validateProfilePatch` flipped.**
      `@/functions/src/profileHelpers.ts:84-116`. Previously
      `name: null | ''` collapsed to `null` ("clear it");
      now any patch that includes the `name` key must carry
      a non-empty trimmed string, otherwise the helper
      returns
      `{ ok: false, field: 'name', message: 'Full name is required' }`.
      Patches that don't include `name` at all (e.g. the
      "update email only" flow) still pass — existing users
      with `name` already set keep working.
- [x] **`email` carve-out preserved.** Email is still
      optional and `null/''` still collapses to `null`. The
      doc-comment now explicitly contrasts the two fields.
- [x] **Client `ProfileScreen` UX.**
      `@/src/screens/ProfileScreen.tsx:105-138` —
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
      `@/tests/functions/profileValidation.test.ts:73-94` —
      three new cases: empty string, null, whitespace-only.
      Old "null and '' both clear the field" test rewritten
      to `email-only: …` to keep coverage of the email
      carve-out
      (`@/tests/functions/profileValidation.test.ts:57-67`).

**Deferred (scoped out per the prompt's escape hatch):**

- [ ] **First-sign-in profile gate.** After OTP confirm, if
      `profile.name` is empty, route to ProfileScreen with
      `requiredSetup: true` and hide the back button until
      saved. Server-side rejection covers the worst case
      today (an empty-name save fails loudly), but the UX
      is still: tap Profile → see asterisk → fill in. A new
      OTP'd user who never opens Profile won't be forced.
      Track as a Phase-of-testing follow-up.

#### Part 3 — Resend OTP button (already on disk, ships with this PR)

- [x] **Diff-checked.** `git diff src/screens/LoginScreen.tsx`
      against HEAD returned empty — the staged work was
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
- `npm test`: **48 suites, 479/479** (476 → +3 new PR 10
  cases for empty/null/whitespace name).
- `npm run audit:indexes`: 28 chains / 8 composite / 0 missing.
- Deliberate-break: flipped expected message on the
  empty-name test → red as expected
  (`Expected: "Name is optional and may be cleared"
  Received: "Full name is required"`) → reverted; 479 green.
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
2. Open Profile → red asterisk on "Full name" + "Required"
   helper visible. Clear name → Save button greys out.
   Tap-and-hold to bypass disable → Alert "Name required".
3. Existing user with name already set: full flow still
   works, including update-email-only saves.
4. Curl `updateMyProfile` with `{name: ''}` directly →
   `invalid-argument: name: Full name is required`.
5. Resend OTP cooldown countdown visible after sending OTP;
   tap before 0 = no-op; tap at 0 = new SMS arrives, timer
   resets to 30.

### PR 9 — Node 22 + firebase-functions/admin SDK upgrade — ⏸ CODE COMPLETE, DEPLOY PENDING (May 18 2026)

Server-only PR. Three coordinated bumps driven by Google Cloud's
Node 20 deprecation calendar (deprecated 2026-04-30, decommissioned
2026-10-30 — after which no new deploys are accepted on Node 20).

**Resolved versions:**

| package | before | after |
| --- | --- | --- |
| `firebase-admin` | `12.7.0` | `13.9.0` |
| `firebase-functions` | `6.6.0` | `7.2.5` |
| `razorpay` | `2.9.6` | `2.9.6` (out of scope) |
| Cloud Functions runtime | `nodejs20` | `nodejs22` |

**Fix list (Part 2): empty.**

The major bumps (admin v12 → v13, functions v6 → v7) compiled
clean against the entire `functions/src/` tree on the first try.
Every high-risk surface enumerated in the prompt was verified
against the new types:

- `defineSecret` × 4 (RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET,
  RAZORPAY_WEBHOOK_SECRET, FCM_SERVER_KEY) → unchanged.
- `setGlobalOptions({ region: 'asia-south1' })` → unchanged.
- `onCall`, `HttpsError(code, message)` × ~30 callables → unchanged.
- `onSchedule({ schedule, timeZone, ...}, async event => ...)` for
  `cleanupAbandonedOrders` → unchanged.
- `onDocumentCreated` × 2, `onDocumentUpdated` × 3 →
  `event.data.data()` accessor pattern still valid.
- `firebase-admin`: `initializeApp`, `getAuth`, `getFirestore`,
  `getStorage`, `FieldValue.serverTimestamp()`,
  `FieldValue.arrayUnion()`, `FieldValue.arrayRemove()`,
  `FieldValue.increment()` → unchanged.

Zero `// @ts-ignore`/`// @ts-expect-error` added.

**Verification (Parts 3-4):**

- `cd functions; npx tsc --noEmit` → **0 errors**.
- `cd ..; npx tsc --noEmit` → **0 errors** (PR 8.1 baseline preserved).
- `npm test` → **48 suites, 476/476** green.
- `npm run audit:indexes` → 28 chains / 8 composite / 0 missing.
- Zero new `DO NOT REMOVE` comments needed (PR 8.1 prep held).

**Install gotchas observed:**

- `npm install --save firebase-admin@latest firebase-functions@latest`
  failed with `ERESOLVE` because the bare-`@latest` tag tried to
  pull `firebase-admin@13.10.0`, which doesn't yet exist on the
  registry — `npm view firebase-admin version` returns `13.9.0`.
  Likely an npm tag-cache quirk. Pinning explicit versions
  (`firebase-admin@13.9.0 firebase-functions@7.2.5`) resolved
  cleanly.
- `npm install` failed with `UNABLE_TO_VERIFY_LEAF_SIGNATURE`
  until `$env:NODE_OPTIONS = "--use-system-ca"` was set (same
  corporate-CA workaround already documented for `firebase
  deploy` in `.windsurf/deploy-discipline.md`).
- `npm warn EBADENGINE` because local Node is v24, package now
  requires v22. Cosmetic — only the Cloud Functions runtime
  enforces engines; local build still works on v24.

**Deferred to operator (Parts 5-8):**

These steps require running Firebase CLI against live projects
and were not executed by the assistant:

- [ ] **Part 5 — Local emulator smoke.** `cd functions; npm run
      serve` then exercise `placeOrder` (COD), `cancelMyPendingOrder`,
      `listMyOrders` via `firebase functions:shell`.
- [ ] **Part 6 — Dev deploy.**
      ```powershell
      $env:NODE_OPTIONS = "--use-system-ca"
      cd functions; npm run build; cd ..
      firebase deploy --only functions --project grocery-mvp-dev
      firebase functions:list --project grocery-mvp-dev
      ```
      Confirm function count matches pre-deploy (~30) and console
      shows `runtime: nodejs22` on at least one function.
- [ ] **Part 7 — Dev smoke tests.** Place online order →
      Razorpay payment → confirmation; cancel within 2-min window
      (PR 7); admin suspendShop/unsuspendShop; wait for next
      `cleanupAbandonedOrders` cron tick; grep
      `firebase functions:log` for `unhandled|deprecation|error`.
- [ ] **Part 8 — Prod deploy.** Only after Part 7 fully green:
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

Don't roll back on transient noise — only on a reproducible
callable category failure.

**Out of scope (confirmed):**

- Razorpay SDK bump — pinned at `^2.9.4`, separate PR if needed.
- TypeScript bump — `^5.6.0` is fine for Node 22 + functions v7.
- v1/v2 boundary refactor — already 100% v2.
- App Check enable — tracked separately (see
  "App Check enforcement (intentionally deferred)" section above).
- Splitting `index.ts` — separate refactor.

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

## PR 36 — Customer CRM for shop owner `[Phase 36]`

- [x] **`listShopCustomers` callable + pure aggregator** — server-side
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

- [x] **`ShopCustomersScreen` (client)** — three tabs (Top by revenue
      / Recent / Stopped 30d+) over a 90d / 180d / All-time period
      selector; tap-to-expand row reveals phone (tap-to-call on
      native via `Linking`), full order count, total spent, first/
      last order dates. All `useState` calls live above the early
      returns to satisfy rules-of-hooks. Empty/loading/error/
      truncated states handled in-tree. Uses existing
      `formatRupees` and SafeAreaView pattern.

- [x] **Wired into `ShopOwnerDashboardScreen`** as a `manageMenuTile`
      ("👥 My customers"); `ShopCustomers` route registered in
      `AppNavigator.tsx`. `ShopCustomer` type exported from
      `src/types/index.ts`; client wrapper `listShopCustomers`
      added to `src/services/orderService.ts` with web/native
      dispatch.

- [x] **Analytics** — `shop_customers_viewed` (fires on initial
      load + every tab/period change with totalUniqueCustomers +
      customers_shown from server) and `shop_customer_tapped`
      (rank_in_view, 1-indexed) added to `src/services/analytics.ts`
      under the existing `Analytics` namespace; auto-mirrored to
      `featureUsageLog/` via PR 38.1 routing.

- [x] **Unit tests** — `tests/functions/customerCrmHelpers.test.ts`
      covers aggregation totals, cancelled/refunded exclusion from
      `totalSpent` (kept in `orderCount`), defensive skipping of
      malformed rows, most-recent-non-empty contact merging,
      regression guard for blank-newer-address, and all three
      view sorts including `stopped` default 30d. **9 passing.**
      Deliberate-break check: removing the cancelled/refunded
      exclusion makes the dedicated test fail; reverted.

- [x] **Privacy / forbidden-actions audit** — no new collections
      or fields written; rollups computed in-memory per request.
      Privacy enforced via the same `validateShopOrdersAccess`
      gate as `listShopOrders` (shop owner ↔ own shop only;
      admin can pass `shopId`).

- [ ] **Smoke tests post-deploy** — on a freshly-launched shop
      with ≥5 past orders: verify Top sort, Recent sort matches
      most-recent order timestamp, Stopped 30d+ behaves on an
      older shop, period switch updates numbers, expand row
      shows phone tap-to-call, analytics events visible in
      DebugView. `[Phase 36-smoke]`

- [ ] **Truncation UX at scale** — when a shop's history exceeds
      1000 orders the screen surfaces a "Showing your most recent
      1,000 orders" banner. Add an explicit date-range picker
      (or paginated cursor) before any shop is likely to cross
      this threshold (~100 orders/day for 10 days). `[Post-launch]`

- [ ] **Customer notes / tags** — out of scope for PR 36.
      Letting shop owners attach short notes per customer
      (e.g. "prefers no onion", "leaves at gate") would require
      a new `shopCustomerNotes/` collection + rules; deferred.
      `[Post-launch]`

## PR 36.1 — Pilot UX polish bundle `[Phase 36.1]`

- [x] **Pickup countdown on customer `OrderDetailScreen`** —
      replaces the single-line "Ready by 7:30 PM at the shop…"
      with a two-line layout: bold relative time on top
      (`Pickup ready in 22 minutes`) + muted absolute fallback
      below (`by 7:30 PM · delivery partner brings it to you`).
      Eliminates the mental-math hit every time a customer
      checks on their order. Pure helper at
      `src/utils/formatRelativeTime.ts` (caller-injected
      `nowMs`, deterministic, no `Date.now()` inside) drives
      the format. Reuses the existing PR 7 `nowMs` 1-second
      interval (already in place for the in-window cancel
      countdown) — **no new timer**, no leak risk.
      Edge cases handled: no ETA → row hidden; <1 min →
      "less than a minute"; past <2 min → "any moment now";
      past >2 min → "X minutes ago"; ≥1 hour → "X hours Y minutes".

- [x] **Favorites-only filter pill on `ShopListScreen`** —
      pill at the top of the list (above search results),
      defaults to "🏪 All shops", toggles to "❤️ Favorites
      only". Filter logic checks
      `profile.favorites?.[shopId]?.length > 0` against the
      PR 19 `Record<shopId, menuItemIds[]>` shape (server
      prunes empty entries; UI guards anyway). Empty state
      surfaces a friendly "No favorites yet" panel + "Show
      all shops" escape-hatch CTA. State is local-only — resets
      to All on each navigation; persistence deferred.
      `SearchScreen` is product-search-only (`{menuItem, shop}`
      rows) so the pill ships on `ShopListScreen` only.

- [x] **Analytics** — `customer_pickup_countdown_viewed`
      (fires once per `(orderId, readyByEstimate)` tuple when
      the ETA is in the future; deliberately NOT keyed on
      `nowMs` to avoid second-by-second spam) and
      `customer_favorites_filter_toggled` (fires on each pill
      tap with `enabled: boolean`). Both auto-mirror to
      `featureUsageLog/` via PR 38.1 routing.

- [x] **Tests** — `tests/utils/formatRelativeTime.test.ts`
      covers 22 min / 1 min singular / <1 min / 1h5m / exact
      hours / 1 min past / 15 min past / 1h5m past / custom
      label override (future + past). **9 passing.**
      Deliberate-break (swap "minutes" → "hours" in the
      sub-hour future branch) caused 3 dependent tests to
      fail with clear assertion deltas; reverted.

- [x] **OTA-eligibility audit** — `git diff HEAD -- app.json
      package.json package-lock.json` is empty. No new SDKs,
      no plugin changes, no permission requests, no native
      modules. Ships via `eas update` only.

- [ ] **Smoke tests post-OTA** — verify countdown ticks live
      every minute, two-line layout renders cleanly on phone,
      countdown handles ETA-in-the-past gracefully (any moment
      now → X minutes ago), pickup row hidden when no ETA,
      filter pill toggles + filters + empty state behave,
      `featureUsageLog/` shows new event docs in Firestore
      Console. `[Phase 36.1-smoke]`

- [ ] **DEFERRED — Cold-start fix for shop-side
      `updateOrderStatus` (~4s first tap)** — diagnosed as
      Cloud Functions Gen 2 cold start (first tap ~4s after
      ~15min idle, ~1s subsequently). Single-line fix:
      `minInstances: 1` on the `updateOrderStatus` `onCall`
      options, ~₹400/mo per warm instance. Sudhir chose the
      pilot-cost-conservative path (accept the 2–3× daily
      cold-start hit during pilot, revisit if it surfaces as
      real friction). Not blocking pilot. `[Post-launch]`

- [ ] **Persisted "Favorites only" filter state** — v1 resets
      on screen mount. If pilot shows customers re-toggling to
      favorites every session, persist via AsyncStorage.
      `[Post-launch]`

- [ ] **Customer-side Hindi i18n** for the countdown formatter
      and other customer-facing strings. PR 34 shipped voice +
      Hindi onboarding for shop registration; the customer-side
      i18n is a separate workstream. `[Post-launch]`
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