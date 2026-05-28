# CLAUDE.md — context for a fresh Claude session

**Purpose:** Claude/Cowork sessions do not persist memory between chats.
This file is the single place a new session catches up on. Read this
file first, then `docs/SESSION_LOG.md`, before doing anything else.

**When working with Sudhir on this repo:** update this file at the end
of a session if anything in "Current state" or "In-flight work" has
changed, and append a one-paragraph entry to `docs/SESSION_LOG.md`.

---

## Product

**Kirana Mart** (Expo slug `grocery-mvp`) — Indian corner-store grocery
delivery app. Customers order from neighborhood kirana shops; shop owners
fulfill; delivery partners deliver; admins moderate. Family/test phase
today, not yet public-launched.

Four user roles, all on the same app: **customer, shopkeeper, delivery,
admin.** Roles enforced via Firebase custom claims + Firestore rules.

## Stack

| Layer | Tech |
| --- | --- |
| Client | Expo SDK 54, React Native 0.81.5, React 19.1, Expo Router 6 |
| Navigation | React Navigation 7 (native-stack + bottom-tabs) |
| State | Zustand (`src/store/`) |
| Backend | Firebase: Firestore, Cloud Functions (Node 22), Auth (phone OTP), Storage |
| Payments | Razorpay (`react-native-razorpay`) — test keys only today |
| Observability | Sentry (`@sentry/react-native`) |
| OTA | EAS Update |
| Native modules | `@react-native-firebase/app`, `auth`, `functions` |

**Firebase project:** `grocery-mvp-dev` (single project for everything
right now — see "Production Firebase project setup" in
`PRELAUNCH_CHECKLIST.md` for the prod split workstream).

**EAS project:** `25064a20-cfd6-4a98-ac27-4d435095e50a`, owner `ammoji`.
Bundle IDs `com.sudhirdavim.grocerymvp` (iOS + Android).

## Repo layout

```
App.js                       Expo entry
app.json / app.config.js     Expo config (name "Kirana Mart")
eas.json                     EAS profiles (preview, production)
firebase.json                Firebase deploy config
firestore.rules              Firestore security rules
firestore.indexes.json       Composite indexes
storage.rules                Storage security rules

functions/src/               Firebase Functions
  index.ts                   Callable & trigger registry
  *Helpers.ts                Domain-grouped logic (one file per area)

src/
  screens/                   Customer screens at top level
    admin/                   Admin-only screens
    delivery/                Delivery-partner screens
    shop/                    Shopkeeper screens
    roles/                   Role-switching / role-picker
  components/                Reusable UI (cart/, common/, dev/, order/,
                             product/, shop/)
  services/                  Client-side service layer (firebase.ts,
                             authService, orderService, profileService,
                             shopService, pushService, sentry, etc.)
  store/                     Zustand stores (auth, cart, location,
                             profile, hydration)
  navigation/                AppNavigator + nested role navigators
  hooks/                     Shared React hooks
  types/                     Shared TypeScript types (Address, Order,
                             Shop, MenuItem, etc.)
  constants/, utils/, data/, mocks/

scripts/                     One-shot ops scripts (seed, set-admin,
                             set-shop-owner, set-delivery,
                             reset-test-data, audit-*, etc.)

tests/
  functions/                 Unit tests for Cloud Functions logic
  services/                  Unit tests for client services
  rules/                     Firestore rules tests (run against emulator)

docs/                        Per-PR Windsurf prompts (see "Where prior
                             context lives" below)
claude_files/                Original architecture docs (May 11 2026 —
                             frozen reference, do not edit)

.windsurf/                   Discipline docs referenced by every PR prompt
  code-discipline.md         Code editing rules (import-strip, hooks)
  test-discipline.md         Testing rules
  deploy-discipline.md       Deploy ordering rules
  workflows/                 Reusable workflow steps
```

## Conventions and discipline (read before editing code)

These are hard-learned from PRs 1–22. Violating them has shipped
regressions to TestFlight before.

1. **Never strip imports between edits in the same PR.** TypeScript
   LSP auto-removal has broken builds repeatedly. If a symbol is
   imported and any code in the PR touches it, the import stays put
   until the PR is done. See `.windsurf/code-discipline.md`.
2. **All `useState` calls in screens sit ABOVE conditional early
   returns.** React's Rules of Hooks. Multiple PRs (12 onward) have
   the lineage of fixes in comments — add to it, don't break it.
3. **Server-first deploy** for any callable change. Deploy Functions
   first, verify with `firebase functions:list`, then ship the client
   that calls the new shape. Never ship a client that calls a function
   that isn't live yet. See `.windsurf/deploy-discipline.md`.
4. **Schema-additive changes only** unless explicitly migrating. New
   optional fields on existing types; no required-field additions
   without a migration plan.
5. **Test discipline** — every PR adds tests. Rules changes require
   `npm run test:rules`. Service logic requires `npm run test:unit`.
   `npm test` runs audits + unit tests; `npm run test:full` adds
   rules tests against the emulator.

## How PRs are organized

Each PR has a prompt at `docs/pr-N-<slug>-windsurf-prompt.md`. The
prompt is the source of truth for what that PR does, what to read
first, the discipline checklist, and the test plan.

**Authoring split (Claude + Windsurf cross-check pattern):**

- **Claude writes the prompt.** Sudhir asks Claude to design a PR,
  diagnose a bug, or propose a change. Claude writes the full
  windsurf-prompt.md — root-cause analysis, exact code transforms,
  test plan, deploy plan. Claude does NOT edit source files
  directly for non-trivial changes. (Quick one-line clarifications
  and doc-only edits can stay direct.)
- **Windsurf executes the prompt** inside Sudhir's IDE with full
  TypeScript + auto-formatter feedback. This catches a class of
  bugs (auto-import strip, file truncation on big multi-line
  replaces, hooks order regressions) that direct file edits via
  Claude have shipped before.
- **Sudhir reviews the diff** Windsurf produced against the
  prompt's acceptance checklist before committing.
- **Claude can review post-implementation** too — the durable
  prompt + the resulting diff give a clean audit trail.

This split is intentional. One agent grading its own work is weak
review; two agents with different blind spots is real review.

PRs land on `main` as merge commits with messages like
`PR 7: customer cancel window + shop dashboard UX`. The PR number in
the commit corresponds to the prompt filename.

**Naming for new PRs:** next number after the highest existing prompt
file (currently PR 23 is the most recent), `docs/pr-N-<slug>-windsurf-prompt.md`.

## Where prior context lives in this repo

- **`PRELAUNCH_CHECKLIST.md`** — 290KB, the single source of truth for
  everything that must happen before public launch. Grouped by category.
  Each PR appends a section here documenting what shipped and any open
  items. Read the section headers (`grep '^## ' PRELAUNCH_CHECKLIST.md`)
  to navigate.
- **`docs/pr-*-windsurf-prompt.md`** — chronological per-PR design and
  implementation prompts. PR 1 is the earliest; PR 22 is the most
  recent.
- **`docs/phase-*` and `docs/*-windsurf-prompt.md`** (non-numbered) —
  earlier phase work and one-off prompts (auth UX, cleanup script,
  hotfixes, keyboard sweep, etc.).
- **`claude_files/`** — original architecture docs from May 11 2026:
  `MVP_ARCHITECTURE.md`, `BACKEND_FIREBASE_DESIGN.md`,
  `SHOP_PRODUCT_CART_DESIGN.md`, `UI_SCREENS_DESIGN.md`,
  `IMPLEMENTATION_PLAN.md`. **Frozen reference** — do not edit; current
  state has diverged in many places.
- **`docs/SESSION_LOG.md`** — append-only log of Cowork/Claude
  sessions on this repo. New entry per session.
- **`docs/ROADMAP.md`** — strategic multi-month view: audit of
  shipped features vs. industry baseline, phased roadmap A→E, AI
  integration strategy, decisions deferred / out of scope. Read this
  when picking the next PR or evaluating a new feature request.
  Updated when the roadmap shifts, not every session.

## Resume protocol (do this at the start of every fresh session)

1. Read this file (`CLAUDE.md`).
2. Read `docs/SESSION_LOG.md` (tail entries are most relevant).
3. `git status` and `git log --oneline -10` to see local vs committed
   state.
4. If there's uncommitted work, `git diff --stat` to see scope.
5. Skim the most recent PR prompt in `docs/` to understand the latest
   in-flight design.
6. Ask Sudhir what he wants to work on. Don't assume — even if context
   suggests an obvious next step, confirm before doing anything destructive.

## Current state — 2026-05-27 (later) — Geo system PRs 46–49 shipped (4 of 5); pausing for full re-test + Android validation

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
**Support email (kept as personal during pilot):**
`sudhir.davim@gmail.com`. Switching to `sarastacklabs@gmail.com`
deferred to post-pilot — touching Apple Developer / Firebase /
EAS / Sentry / Razorpay ownership during pilot is too risky
relative to the zero pilot benefit.
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
  failing the build. Net effect: build 15's stack traces in
  Sentry will remain minified. **Action for next build:**
  set the secret first via
  `eas secret:create --scope project --name SENTRY_AUTH_TOKEN
  --value <token> --type string --visibility secret
  --environment production`, then any subsequent `eas build`
  will activate PR 26 properly. Until then, prod crash
  diagnostics on build 15 remain limited.
- **PR 32** — first shipping AI feature. Two new callables
  deployed + client OTA pushed. Smoke-tested end-to-end on
  phone: scanning a real rate-list returns structured menu
  items in ~15s. **Mission North Star metric moved materially:
  time-to-first-menu-item is now ~15 min vs. 4 hours.**
  `ANTHROPIC_API_KEY` Firebase Functions secret;
  `aiFeatures/menuExtraction.enabled = true` kill-switch.
  Collections: `aiQuotas/` (5/day per-shop cap), `aiAuditLog/`
  (cost + token + items tracking).
- **PR 31.1** — admin shop-review polish (tappable lat/lng,
  rejection reason card, KYC docs post-approval). Live.
- **PR 31** — shop KYC upload. Live. IAM fix unblocked PR 6.1
  menu image upload as a side effect.
- **PR 27 + PR 25** — live on production OTA channel.
- **PR 26** — code committed; activates on next native build
  (which is now in flight to also deliver PR 34 — same build,
  two unblocks at once).

**Unit suite:** 722/722 passing across 72 suites as of PR 39
(was 636 at PR 32 baseline; growth across PRs 32.1, 32.2, 34,
36, 36.1, 36.2, 38, 38.1, 39 added the rest).

**AI substrate now in place** (`functions/src/aiHelpers.ts`):
every Phase C customer-side AI PR (PR 47–53) reuses the same
`runClaudeVision` wrapper + `estimateCostInr` audit helper +
`ANTHROPIC_API_KEY` secret + cost-guardrail pattern (quota +
kill-switch + audit log). Built right once; cost of every
later AI PR is now just "write the prompt + the typed response
shape."

**IAM fix logged (one-time, never repeat):** Firebase Cloud
Functions Gen 2's runtime service account
(`333323701016-compute@developer.gserviceaccount.com`) needed the
`Service Account Token Creator` role granted on itself before any
`getSignedUrl` call could succeed. Failure mode was `SigningError:
Permission 'iam.serviceAccounts.signBlob' denied`. Surfaced as
`INTERNAL` on the client. Fix is documented in
`.windsurf/deploy-discipline.md` under the new "Signed-URL IAM"
section so future Gen 2 + signed-URL PRs don't re-discover it.

**OTA-vs-eas-build rule logged (PR 34 hard lesson):** Adding any
`expo-*` library WITH a config plugin in `app.json` (e.g.
`expo-audio`, `expo-camera`, `expo-notifications`), OR adding /
changing permissions in `ios.infoPlist` / `android.permissions`,
OR touching the `plugins` array, OR changing `runtimeVersion` —
all require a fresh `eas build`. OTAs silently won't apply because
the runtime fingerprint changes. PR 34 incorrectly claimed
"OTA-only" and consumed ~1 hour of debugging before the fingerprint
mismatch was diagnosed. Full decision table + diagnostic pattern
in `.windsurf/deploy-discipline.md` under the new "OTA vs
`eas build`" section. **Every future PR's deploy plan must
classify against the table before claiming OTA-only.**

**Uncommitted local changes — large bundle, 28 files, ~4200 insertions:**
- `PRELAUNCH_CHECKLIST.md` (+1857 lines — new sections appended)
- `functions/src/index.ts` + helpers for profile, search-menu
- `src/screens/AddressEditScreen.tsx`, `CheckoutScreen.tsx`,
  `OrderDetailScreen.tsx`, `OrdersScreen.tsx`, `HomeScreen.tsx`,
  `ShopDetailScreen.tsx`, `SearchScreen.tsx`
- `src/screens/shop/ShopOrderDetailScreen.tsx`,
  `ShopOwnerDashboardScreen.tsx`
- `src/screens/delivery/DeliveryDashboardScreen.tsx`,
  `DeliveryOrderDetailScreen.tsx`
- `src/screens/admin/ShopDetailManagementScreen.tsx`
- `src/services/authService.ts`, `firebase.ts`, `orderService.ts`,
  `profileService.ts`, `shopService.ts`
- `src/components/AuthBootstrap.tsx`, `shop/ShopCard.tsx`
- `src/navigation/AppNavigator.tsx`
- `src/store/useCartStore.ts`
- `src/types/index.ts`
- a couple of tests

This bundle appears to cover **PRs 19 through 22** (favorites,
ratings, substitution preferences, delivery instructions) which have
prompts in `docs/` but no corresponding merge commits on `main`. Open
question for the next session: are these meant to be committed as
separate PRs, squashed into one, or were some already merged on a
different branch?

**PR prompts that exist but aren't reflected in git log on main:**
PR 9 (node22 + firebase SDK upgrade), PR 10 (quickwins), PR 11 (admin
order timeline), PR 12 (shopkeeper ETA workflow), PR 13 (repeat order),
PR 14 (home order-again rail), PR 15 (home active-orders rail), PR 16
(shop new-order alert), PR 17 (polish bundle), PR 18 (quick-switch
test accounts), PR 19 (favorites), PR 20 (ratings), PR 21 (substitution
preferences), PR 22 (delivery instructions).

**Latest commit on main is `PR 8 and 8.1 changes` (49c7bc2) + the
Resend OTP follow-ups.** Either the PR 9–22 work landed on a branch
that hasn't been merged, or it lives in the uncommitted diff above.
Worth clarifying with Sudhir before touching this code.

## In-flight work / open questions

- **Three PR 25 follow-ups documented in the Windsurf hand-off:**
  - Replace `[CITY TBD before launch]` in `docs/terms-of-service.md`
    §13 with the operating-entity city, then re-run
    `npm run build-legal` + `firebase deploy --only hosting` before
    the App Store submission.
  - When the prod Firebase project lands (PR 28), bump the URLs in
    `app.json` `extra.legal` to the prod hosting domain — single
    place to change since `src/constants/legal.ts` is the only
    reader.
  - Consider custom domain (e.g. `kiranamart.in/{privacy,terms}`)
    once the brand is finalized — out of scope for Phase A.
- **PR 26 build + EAS secret pending.** Code is committed but
  inert until two manual steps Sudhir runs in his own PowerShell:
  (a) generate Sentry auth token + `eas secret:create --scope
  project --name SENTRY_AUTH_TOKEN ... --environment production`,
  (b) trigger the next `eas build --profile production` (whenever
  that's needed for any reason — App Store prep, native module
  change, etc.). The build will fail loudly if the secret isn't set
  first, so there's no risk of silent skip. Smoke tests 1–4 from
  `docs/pr-26-sentry-sourcemap-upload-windsurf-prompt.md` run after
  the build completes.
- **Pilot-blocking sequence (post-PR-36):** PR 36 ✅ shipped +
  tested May 24. PR 36.1 (pilot UX polish — 2 parts: countdown
  timer on customer OrderDetailScreen + Favorites filter on
  ShopListScreen) is the last pilot-blocking dev work. ~3 hrs
  Windsurf. Cold-start fix on `updateOrderStatus` was the
  original Part 1; **deferred per Sudhir's cost-conservative
  call** — diagnosed as Cloud Functions Gen 2 cold start
  (first-tap-of-the-day ~4 s, subsequent ~1 s); `minInstances:
  1` would eliminate it at ~₹400/mo per function but he chose
  to accept the hit during pilot rather than add recurring
  cost. Revisit post-pilot if it surfaces as real friction.
  After PR 36.1 ships + smoke-tests, dev side of pilot-readiness
  is done — remaining items are branding + city + manual shop
  onboarding (non-code).
- **Deferred to post-pilot Phase B / C** (logged in ROADMAP
  so they don't drift): PR 42.1 separate shop+delivery
  ratings, PR 53.1 smart substitution with AI + real-time
  approval. Both real product wants, neither pilot-blocking.
- **PR 37 + PR 37.1 (Digital Udhaar / Khata) deferred from
  pilot** (Sudhir's call May 24). Build on demand if pilot
  shop owners request credit-tracking. Prompts preserved at
  `docs/pr-37-digital-udhaar-khata-ledger-windsurf-prompt.md`
  for fast pickup. See ROADMAP.md Section 4 deferral table.
- **PR 35 (field-rep assisted onboarding) + PR 33 (master
  catalog) deferred** — both Phase A2 nice-to-haves, not
  pilot-blocking. PR 35 is the Trust Principle 5 escape hatch;
  PR 33 is master-catalog dedup. Defer until pilot signal
  demands them.
- **Production Firebase project** (`grocery-mvp-prod`) not yet created.
  Documented workstream in `PRELAUNCH_CHECKLIST.md`. Trigger: family
  testing reports quiet for 1–2 weeks + ready to commit to launch date.
- **App Check enforcement** intentionally deferred. Dedicated section
  in `PRELAUNCH_CHECKLIST.md`. Debug token currently active for dev.
- **Razorpay LIVE keys** not yet configured — still on test keys.

## How to update this file

At the end of a session where anything material changed:

- Update **Current state** with the new last commit, any new local
  changes, anything that just shipped.
- Update **In-flight work / open questions** — strike out resolved
  items, add new ones.
- Bump the date stamp on the "Current state" heading.
- Don't bloat: this file is a map, not a history. The history goes in
  `docs/SESSION_LOG.md` and `PRELAUNCH_CHECKLIST.md`.
