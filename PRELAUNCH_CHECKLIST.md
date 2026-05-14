# Prelaunch Checklist

Single source of truth for what's left before real customers touch this app.
Update items as they complete. Do **not** delete items — strike them through
or mark `[x]` so we have a history of what shipped when.

## Payments

- [ ] Razorpay test transaction successfully completes end-to-end
      (test card → webhook fires → `paymentStatus: 'paid'` in Firestore)
- [ ] Razorpay live mode keys (post-KYC) configured in prod Functions secrets
      (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`)
- [ ] Mobile online payment via `react-native-razorpay` (web SDK won't work
      inside an APK; needs native module + dev-client rebuild)
- [x] Abandoned-order cleanup Cloud Function (orders stuck in
      `paymentStatus: 'pending'` > 24h auto-cancel) — `cleanupAbandonedOrders`
      runs hourly, sets `paymentStatus: 'expired'` + `status: 'cancelled'`

## Branding & store assets

- [ ] App icon replaced (currently Expo default)
- [ ] Splash screen replaced (currently Expo default)
- [ ] Real product images uploaded to Firebase Storage (or CDN);
      update `src/mocks/products.ts` to reference real URLs
- [ ] Play Store listing prepared (screenshots, description, content rating)

## Production Firebase project

- [ ] Separate Firebase project `grocery-mvp-prod` created
- [ ] Seed prod project with real shop + product data
- [ ] Production `firestore.rules` + indexes deployed to prod project
- [ ] App Check enforcement enabled on prod project (no debug tokens)
- [ ] Production Razorpay webhook URL registered in Razorpay Dashboard

## Security rules version control

- [x] Pulled active dev-project rules into `firestore.rules` at repo root
- [x] `firebase.json` references `firestore.rules` so deploys include them
- [ ] Re-deploy rules from local file (`firebase deploy --only firestore:rules`)
      and verify Console diff is zero before launch

## Auth & identity

- [ ] Phone number auth (replace anonymous-only for return customers)
- [ ] FCM push notifications wired up (`messaging` API + per-user tokens)

## Compliance & policy

- [ ] Privacy policy + terms of service published, linked in app
- [ ] DPDP Act compliance review (data retention, deletion requests)
- [ ] Final security rules review with someone not on this project

## Reliability

- [ ] Load test: 100 concurrent orders without Cloud Function timeout
- [ ] Sentry alert routing configured (Slack / email on new prod errors)
- [ ] Firebase budget + billing alerts set
