# CLAUDE_HISTORY.md — archived "Prior state" sections from CLAUDE.md

Historical snapshots of `CLAUDE.md`'s "Current state" header over
time. Moved here on 2026-06-02 to keep `CLAUDE.md` under the
40k-char threshold that affects Claude Code performance on session
start.

For active state, read `CLAUDE.md`. For session-by-session granular
detail, read `docs/SESSION_LOG.md`. This file is rarely read — it
exists so a future fresh session can recover historical context
when a specific PR's lineage needs reconstruction.

**Note on the original 2026-05-24 Prior State:** the trailing entry
about PR 26's Sentry source-map upload status was truncated mid-
sentence in the original `CLAUDE.md` ("Net effect: build 15's stack
t…"). Preserved verbatim here so the archive matches the source it
was extracted from.

---

## Prior state — 2026-05-27 (later) — Geo system PRs 46–49 shipped (4 of 5); pausing for full re-test + Android validation

**The geo/distance system is 4 of 5 PRs done** (see
`docs/GEO_DISTANCE_SYSTEM_DESIGN.md`). All Sudhir-tested on iOS +
deployed (server-first, IAM-verified) + OTA'd. Test suite 825 → 930.

- **PR 46** — geo foundation: locked delivery location on the order
  (`deliveryLocation`, `deliveryDistanceKm`, `deliveryDurationMin`),
  `getDeliveryEstimate` callable, GPS capture in AddressEditScreen +
  "deliver to current location" in CheckoutScreen. **The paid Google
  Distance Matrix API is BUILT BUT DORMANT** — `aiFeatures/
  distanceMatrix.enabled` defaults false; the disabled branch never
  calls fetch (cost-guarantee test pins this). Haversine ×1.4 during
  pilot. FUTURE TO-DO: flip the flag at ~50 shops scale.
- **PR 47** — distance-based delivery charges: per-shop
  `deliveryChargeTiers` (inclusive `maxKm` bands + null catch-all),
  `chargeForDistance` / `validateDeliveryChargeTiers` pure helpers
  (functions + `src/utils/` mirror), `updateShopDeliveryTiers`
  callable, ShopSettings tier editor, CheckoutScreen preview.
  placeOrder stamps `deliveryCharge` + `deliveryFee = deliveryCharge`
  (back-compat shim); approveShop seeds the default table.
- **PR 48** — shop service radius + customer distance visibility.
  Replaced hardcoded `SHOW_ALL_SHOPS = true` with a per-shop
  `serviceRadiusKm` gate applied **server-side** in `listShopsPublic`
  (native can't read Firestore — Plan B). The "show all" override is
  a **server-read Firestore flag** `appConfig/shopVisibility.
  showAllShops` (NOT `__DEV__` — false in TestFlight). **It is
  currently `true`** for the cross-city offshore-testing window —
  **flip to `false` (or delete) at real 1-shop pilot** so the radius
  gate goes live. Bundled the tier-save-persistence fix + removed the
  redundant flat Delivery-fee input (field kept as legacy fallback).
- **PR 49** — delivery-partner routing: `Order.shopLocation` stamped
  in placeOrder; `reportDeliveryLocation` callable writes
  `users/{uid}.currentLocation` (foreground-only, on dashboard
  focus — feeds PR 50); nearest-shop-first pickup sort; ride-distance
  breakdown; locked delivery-location label on cards.

**Two bugs fixed this session, same shape (logged as a lesson):** the
PR-47 tier-save revert and the PR-48 service-area-save failure were
both a *pure helper* gaining a field while the *callable wrapper*
feeding it didn't. Tier-save fix: normalized `updatedAt` to
`serverTimestamp()` + made `getMyShop` read `shops/{claims.shopId}`
directly when a claim exists (query fallback only for pending
owners). Service-area fix: `updateShopSettings` wrapper now forwards
`serviceRadiusKm`. **Rule of thumb: when a validator/helper gains a
field, grep every caller/wrapper for that field before shipping.**

**Windsurf weekly quota exhausted — resets 5/31 morning.** **PR 50
(notification radius — the last geo PR) is designed but NOT yet
drafted as a prompt.** Holding it until the quota resets AND the
re-test/Android pass completes.

**Next phase (Sudhir's plan):** full end-to-end re-test on iOS +
set up and validate on **Android** (build 6 unblocked May 26).
Collecting bugs / critical enhancements into a list as they surface.
The next session likely starts from a testing-findings list, not PR 50.

**Two diagnostic logs to strip later (harmless):** PR 45.1 push
probes + PR 48 §I `[getMyShop] resolved via …` logs.

---

## Prior state — 2026-05-27 (PRs 41–45.2 shipped via OTA; push notifications fixed + confirmed; pilot-ready dev side)

**Push notifications fixed + confirmed working (two-device test).**
The multi-day push outage is resolved. Root cause (found via PR
45.1 diagnostic probes): the push-registration gate latched a
session-wide boolean on the FIRST user, and Firebase's anonymous
launch session (`signInAnonymouslyIfNeeded`) won the race —
registering the device token to the throwaway anonymous user and
short-circuiting the real user who signed in moments later. The
real account's `fcmTokens` stayed empty → no order pushes. PR 45.2
made the gate identity-aware (skip anonymous users, re-register on
uid change). Confirmed delivering on two physical devices
(customer + shop owner). Lesson logged as code-discipline Rule 11.
**Push is inherently two-device — cannot be observed on one device
switching roles** (PR 24 unregisters the token on sign-out), so
solo testing always looked broken; real pilot (separate phones)
works.

**Everything PR 41 → 45.2 shipped via OTA this session** (no
native rebuild needed after build 17):
- **PR 41** — admin pending-approval badges + shop-owner dashboard
  badge + getPendingApprovalCounts callable. (Triggers dropped per
  scope decision; reused existing in-callable pushToAdmins.)
- **PR 42** — storefront photo wired from KYC → shop.imageUrl;
  storefront mandatory in RegisterShop.
- **PR 42.0.1** — regenerateShopImageUrl admin callable (manual
  refresh for already-approved shops).
- **PR 42.0.2** — switched storefront URLs from v4 signed URLs to
  Firebase download tokens (v4 has a hard 7-day expiry cap; the
  10-year expiry from PR 42's prompt threw silently). Lesson in
  deploy-discipline.md.
- **PR 42.1** — separate shop + delivery partner ratings.
- **PR 42.1.1** — Firestore reads-before-writes fix in
  submitOrderRating (dual-rating 500'd). Lesson = code-discipline
  Rule 10.
- **PR 43** — ETA hidden until shop accepts (Issue 6, Option A) +
  KYC mandatory enforcement (GST + Identity Proof hard-required).
- **PR 43.1** — keyboard-avoidance hotfix on RateOrderCard input.
- **PR 45 / 45.1 / 45.2** — push reliability, observability
  (Sentry instrumentation), + the anonymous-user fix. Push pipeline
  went from ZERO tests to comprehensive coverage (orchestrator,
  pushService, pushHelpers); suite 782 → 825.
- **Earlier OTA hotfixes** — ShopList Zustand infinite-loop
  (Rule 8), ShopCard imageUrl empty-string guard (Rule 9).

**Cloud Run `allUsers` IAM gotcha hit 4× this session**
(`listPendingDeliveryRequests`, `getPendingApprovalCounts`, etc.).
Something in the GCP project periodically strips the
`allUsers`/`roles/run.invoker` binding from callables → silent
401s. Bulk-audit one-liner + fix command in deploy-discipline.md.
Every PR touching callables now includes a post-deploy IAM
verification step.

**reset-pilot-data enhanced** — now also clears the admin's
`favorites` field (Phase D.1) so the stale-favorites-count bug
doesn't recur on the admin account after a reset.

**Two follow-ups deferred (non-blocking):**
- Strip the `PR 45.1 DIAGNOSTIC PROBE` Sentry milestones (cleanup
  OTA once comfortable — harmless but noisy).
- Migrate RNFB namespaced API (`firebase.app().functions()`,
  `httpsCallable`) → modular API before RNFB v22 forces it. Pure
  deprecation noise today.

**Queued PR prompts not yet executed:** PR 39.2 (reset-pilot-data
live-pilot guard), PR 44 (real category photos — needs Sudhir to
source 10 Pexels PNGs first), PR 42.1.2 (admin order-comment
surfacing — delivery comments are stored but not yet displayed
anywhere).

---

## Prior state — 2026-05-26 evening (build 17 live on TestFlight; Android build 6 unblocked; 4 smoke-test bugs hotfixed)

**Pilot strategy locked to 1-shop start.** Sudhir's call: settle
shop #1 to ~30-50 successful orders + 1 quiet week + 1 real
cancellation + customer NPS-positive before onboarding shop #2.
Pilot data once real money flows = immutable; `reset-pilot-data`
script must be locked before live pilot (proposed PR 39.2 if
needed). Email switch to `sarastacklabs@gmail.com` deferred
indefinitely (zero pilot benefit vs. multi-week migration risk).
Bundle IDs unchanged.

**Build 17 — iOS live on TestFlight as of May 26 evening.**
PR 39 rebrand strings + Contact Support row + PR 39.1 logo
artwork (blue-to-green gradient bag + HAMARASETU wordmark)
shipped together. Splash bg flipped from `#0E7C3A` green to
`#FFFFFF` white to match logo's own bg. `eas submit` ran;
TestFlight has build 17 installable. Hosting deploy pushed
regenerated `/privacy` + `/terms` with HamaraSetu branding +
Faridabad jurisdiction.

**Android build 6 — unblocked and successful.** Long-pending
Android build failure root-caused: `app.json` android block was
missing `googleServicesFile`, so `@react-native-firebase/app`
prebuild always failed. Sudhir created Android app in Firebase
Console with SHA-1 + SHA-256 fingerprints of the production
keystore, added `googleServicesFile: "./google-services.json"`
to `app.json`. Build (6) succeeded. Distribution path = Google
Play Closed Testing once Play Console developer account
($25 one-time) is approved (1-3 day window).

**Two hotfixes shipped via OTA in this session** — Sudhir's
smoke test surfaced bugs not caught by unit tests:

1. **ShopListScreen Zustand infinite-loop fix.** Selector
   `useProfileStore(s => s.profile?.favorites ?? {})` was
   creating a new empty object reference on every render when
   `profile.favorites` was undefined. Zustand's Object.is
   comparison saw the new ref, triggered re-render, infinite
   loop, "Maximum update depth exceeded" → ErrorBoundary →
   "Something went wrong" screen. Only manifested for accounts
   where favorites was undefined (every non-admin account
   post-reset). Fix: hoist `EMPTY_FAVORITES` to module-level
   constant for stable fallback reference. Shipped via
   `eas update --branch production`.

2. **ShopCard imageUrl empty-string guard.** Defense-in-depth.
   `<Image source={{ uri: '' }} />` throws on iOS in Expo SDK 54.
   Shop registered via PR 31 self-registration has
   `imageUrl: ""` until PR 42 wires `kycDocs.storefront → shop
   .imageUrl`. Added a placeholder block (🏪 emoji) for the
   empty case so the same crash class can't recur via a
   different path.

Both fixes logged as new permanent code-discipline rules
(`.windsurf/code-discipline.md` Rules 8 + 9).

**Cloud Run IAM gotcha logged** in `.windsurf/deploy-discipline
.md`. The `listpendingdeliveryrequests` Cloud Run service had
silently lost its `allUsers` / `roles/run.invoker` binding,
causing 401 "access token could not be verified" responses.
Sibling functions retained their binding. Fixed via
`gcloud run services add-iam-policy-binding`. New mandatory
verification step required in all PR deploy plans that touch
callables — without it, a missing binding survives multiple
deploy cycles unnoticed (Firebase reports "successful
update" even with broken IAM).

**Smoke-test score:** 9 issues surfaced, 5 fully resolved
tonight (1, 2, 3, 4, 8), 3 scoped for follow-up PRs (5
storefront photo wiring → PR 42; 6 ETA hidden-until-accepted
locked as Option A → PR 43; 7 shop dashboard badge → folded
into PR 41), 1 deferred (9 performance investigation).

**PR 41 prompt corrected.** The `pendingDeliveryRequests`
collection name (my error) corrected to actual `deliveryRequests`.
Mandatory Cloud Run IAM verification step added to deploy plan.
Shop owner dashboard badge folded into scope alongside admin
notifications.



**PR 39.1 — Logo swap.** Six asset files in `assets/images/`
replaced with HamaraSetu logo derivatives (master source:
`uploads/HamareSetuLogo.jpeg`, 1280×780 JPEG, blue-to-green
gradient shopping-bag + H symbol + HAMARASETU wordmark + "Shop
Smart. Shop Local." tagline on white bg). Derived via Python
PIL: `icon.png` (1024² symbol-only square on white, ~88%
fill), `splash-icon.png` (512² full logo with wordmark +
tagline, transparent bg), `android-icon-foreground.png` (1024²
symbol at ~70% safe-zone), `android-icon-background.png`
(1024² solid white), `android-icon-monochrome.png` (1024²
grey silhouette of symbol for themed icons mode),
`favicon.png` (48² symbol on white). Old files backed up
under `assets/images/.archive-pre-pr40/` in case of revert.
`app.json` updated: splash `backgroundColor` `#0E7C3A` →
`#FFFFFF`, splash `imageWidth` 200 → 240 (full logo with
wordmark needs more width to be readable), `dark.backgroundColor`
`#0E7C3A` → `#FFFFFF`, Android `adaptiveIcon.backgroundColor`
`#0E7C3A` → `#FFFFFF`. **Intentionally NOT touched** in this
hotfix: `theme.ts` palette, expo-notifications `color`
(`#0E7C3A` notification tint stays — PR 40 territory),
green-to-blue+green theme migration. Scope is icon/splash
artwork swap + their bg colors only.



**App name locked: HamaraSetu** (हमारा सेतु — "Our Bridge").
**Tagline locked: "Shop Smart, Shop Local."**
**Operating entity: Sara Stack Labs.**
**Legal jurisdiction: Faridabad, Haryana** (Ballabgarh is the city,
Faridabad the district HQ named in legal docs).
**Support email: `sarastacklabs@gmail.com`** (migrated from
`sudhir.davim@gmail.com` on 2026-05-31 as part of the
pre-Razorpay-resubmission cleanup). The original CLAUDE.md
decision deferred the migration to post-pilot, but the Razorpay
account being recreated from scratch was a free moment to start
the migration on the customer-facing surfaces:

- Tier 1 (app constants + pin tests + utility tests) ✅
- Tier 2 (landing page + privacy + terms + account-deletion) ✅
- Tier 3 (operational docs + smoke-test scripts) ✅
- Tier 4 (Firebase / EAS / Sentry / Anthropic team-member adds) —
  done manually, gradually, by Sudhir over the days following.
  Old email kept as a second owner on each service so nothing
  cuts over.
- Tier 5 (Apple Developer `appleId`, Play Console developer
  account, bundle IDs, Firebase project rename) — **explicitly
  NOT touched.** `appleId: "sudhir.davim@gmail.com"` in eas.json
  stays; transferring the Apple team or renaming bundle IDs
  costs reviews/ratings/install base. Deferred indefinitely.
**Bundle IDs unchanged** (`com.sudhirdavim.grocerymvp` on both
platforms) — bundle ID is invisible to users; display name change
is what matters. Bundle migration deferred to post-pilot,
pre-public-launch.

**Single source of truth for brand strings:**
`src/constants/branding.ts` — `APP_NAME`, `APP_NAME_DEVANAGARI`,
`TAGLINE`, `SUPPORT_EMAIL`, `OPERATING_ENTITY`, `OPERATING_CITY`,
`OPERATING_DISTRICT`, `OPERATING_STATE`, `LEGAL_JURISDICTION`. Pin
test at `tests/constants/branding.test.ts` fails CI on any edit
so future renames stay deliberate. Server-side strings (Cloud
Functions prompts, hosted legal docs) do NOT import this — kept
in sync by hand, with the pin test as the trip-wire.

**Branch:** `main`. PR 39 committed locally; uncommitted bundle
from earlier PRs (19–22) still pending separate triage.

**Last commit:** PR 39 — Rebrand to HamaraSetu + Contact Support
(local, awaiting build 16 + hosting deploy + push). Previous:
`PR 34: voice + Hindi onboarding assist (Google STT + Claude
Haiku field parser)` (`27f22ac`, May 24), then `PR 32`, `PR 31.1`,
`PR 31`, `PR 26`, `PR 27`, `PR 25`.

**Deploy state:**
- **PR 39** — Rebrand to HamaraSetu + Contact Support row.
  ✅ **Code-complete locally** as of May 26.
  `npx tsc --noEmit` clean; `npm test` 722/722 passing across
  72 suites; `npm run build-legal` regenerated `dist/privacy.html`
  + `dist/terms.html`. **NOT YET DEPLOYED** — three actions
  still required by Sudhir from his PowerShell:
  1. `eas build --profile production --platform all` (native
     rebuild — permission strings changed, OTA cannot apply).
     Will auto-increment build 15 → build 16. Confirm
     `SENTRY_AUTH_TOKEN` EAS secret is set first so PR 26
     source-map upload finally activates.
  2. `eas submit --profile production --platform ios --latest`
     after iOS build finishes.
  3. `firebase deploy --only hosting` to publish the
     regenerated /privacy + /terms pages with the new brand +
     `Faridabad, Haryana` jurisdiction in §13.

  **Now bundled with PR 39.1 (logo swap):** build 17 instead
  of build 16 — same `eas build` cycle, two unblocks together
  (rebrand strings + logo artwork). Permission strings (PR 39)
  + asset images (PR 39.1) both require native rebuild;
  combining them into one `eas build --profile production
  --platform all` is the cheap path.
  Smoke acceptance (10 steps) listed in
  `docs/pr-39-rebrand-hamarasetu-windsurf-prompt.md` runs after
  build 16 lands on TestFlight.
  Three Windsurf quality moves worth noting:
  (a) Added `tests/constants/**/*.test.ts` to `testMatch` in
  `tests/jest.unit.config.js` so the new `branding.test.ts`
  pin actually runs — without this the constants pin would
  have been silently invisible.
  (b) Appended a 7-completed-items + 5-follow-ups section to
  `PRELAUNCH_CHECKLIST.md:7457-7564` so PR 39 is fully traced
  in the launch checklist.
  (c) Switched the voice-helper LLM prompt example from
  "Sharma Kirana Mart" to "Sharma Kirana Store" so the AI
  doesn't keep seeing the old brand on every Hindi voice
  onboarding call. (Subtle but correct.)
- **PR 34** — voice + Hindi onboarding assist. ✅ **Live on
  iOS (build 15) as of May 24.** Native build shipped after
  the OTA-fingerprint-mismatch diagnostic; submitted via
  `eas submit --profile production --platform ios --latest`;
  installed via TestFlight; tested end-to-end (language picker,
  big 🎙 button, per-field mics all visible on Step 1 of
  RegisterShopScreen). Server callable +
  `aiFeatures/voiceOnboarding.enabled = true` kill-switch +
  10/day quota all live. Android build status pending — verify
  with `eas build:list --platform android --limit 3`; if no
  PR 34 Android build exists yet, run
  `eas build --profile production --platform android` when
  ready (not blocking iOS-side pilot).
- **PR 26** — Sentry source-map upload. Status TBD on build 15:
  `SENTRY_AUTH_TOKEN` EAS secret was NOT set before build 15
  ran (`eas secret:list | findstr SENTRY_AUTH_TOKEN` returned
  empty on May 24). The build succeeded, which means the Sentry
  plugin gracefully skipped the upload step rather than
