# Pre-Launch Checklist — grocery-mvp

Single source of truth for everything that must happen before real customers
touch this app. Items grouped by category. Each item annotated with the
Phase that introduced the requirement.

## 🔒 Security & Authentication

- [ ] **Re-enable `enforceAppCheck: true`** on all Cloud Functions in
      `functions/src/index.ts` (currently `false` on `placeOrder` and
      `updateOrderStatus` for iOS dev testing). [Phase 5a, 9c-prep]
- [ ] **Native App Check** wired via `@react-native-firebase/app-check`
      on iOS (DeviceCheck) + Android (Play Integrity). Required before
      flipping enforceAppCheck back on for native users. [Phase 5a-mobile]
- [ ] **Remove App Check debug token** from Firebase Console
      (App Check → Apps → Manage debug tokens). Currently active for dev. [Phase 5a]
- [ ] **Phase 9c** — native phone auth via `@react-native-firebase/auth`
      complete; reinstate unconditional checkout sign-in gate (currently
      gated to web-only on `Platform.OS === 'web'` check in CheckoutScreen). [Phase 9b/9c]
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
- [ ] **Real product images** uploaded to Firebase Storage; replace
      `picsum.photos` URLs in `src/mocks/products.ts` (or wherever
      products are seeded). [post-Phase 3]
- [ ] **Real shop data** — replace 8 mock Delhi shops with real onboarded
      kirana shop data. Update via seed script or admin tool. [post-Phase 3]
- [ ] **App icon replaced** (currently Expo default in `app.json`). [Phase 9a]
- [ ] **Splash screen replaced** (currently Expo default). [Phase 9a]
- [ ] **App display name** updated in `app.json` (currently "grocery-mvp"). [Phase 9a]

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

- [ ] **Mobile online payment** via `react-native-razorpay` (currently
      web-only via Stripe.js-style overlay). Replace native iOS payment
      flow in CheckoutScreen with native PaymentSheet. [Phase 8b-mobile]
- [ ] **FCM push notifications** Cloud Function trigger on order status
      change → push to customer's FCM token. [Phase 5d]
- [ ] **Phase 9c** — native phone auth via `@react-native-firebase/auth`
      so iOS users can sign in with phone (not web-only). [Phase 9c]
- [ ] **Android dev client** built and tested (currently iOS-only). [Phase 9a-android]
- [ ] **Production iOS build** signed with App Store distribution cert
      via `eas build --profile production --platform ios`. [Phase 9a]
- [ ] **Production Android build** as `.aab` for Play Store via
      `eas build --profile production --platform android`. [Phase 9a]
- [ ] **Test on multiple iPhones** registered via `eas device:create` —
      family test with at least 3 different iOS versions. [Phase 9a]

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
- [x] firestore.rules + firestore.indexes.json under version control
- [x] Audit script (`npm run audit`) gates code integrity after each Windsurf prompt

---

**Maintenance rule:** any time we add a temporary dev hack, env-only flag,
disabled enforcement, or "TODO before launch" in code — add it here
immediately. The checklist is the only thing that survives memory.