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
   first, verify with `firebase functions:list`, then run **`npm run
   smoke`** (read-only validator: callable deployed + IAM `allUsers`
   bound + composite index Enabled — catches the deploy-state failures
   that masquerade as "empty result / nothing happens"), then ship the
   client that calls the new shape. Never ship a client that calls a
   function that isn't live yet. See `.windsurf/deploy-discipline.md`.
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
- **`docs/FEATURES.md`** — canonical inventory of "what the app
  does today" across all four panels + cross-cutting/system. **Every
  PR prompt must include explicit FEATURES.md update instructions
  in its doc trail** per PROMPT_AUTHORING_NOTES Rule 8. Read this
  before answering "do we already do X?" or designing any new
  feature. Out-of-date answer here means re-built or mis-designed
  work — keep it current.

## Resume protocol (do this at the start of every fresh session)

1. Read this file (`CLAUDE.md`).
2. Read `docs/PROMPT_AUTHORING_NOTES.md` — workflow + discipline
   rules. Critical: Rule W on the Windsurf vs Cowork-direct quota
   split. Reading this is what stops a fresh session from burning
   Windsurf quota on text-only doc edits.
3. Read `docs/SESSION_LOG.md` (tail entries are most relevant).
4. `git status` and `git log --oneline -10` to see local vs committed
   state.
5. If there's uncommitted work, `git diff --stat` to see scope.
6. Skim the most recent PR prompt in `docs/` to understand the latest
   in-flight design.
7. Ask Sudhir what he wants to work on. Don't assume — even if context
   suggests an obvious next step, confirm before doing anything destructive.

## Current state — 2026-06-12 — Pilot-prep wave closed (Bundles G→J + 9 HOTFIXes + 4 process improvements + 6 static guards)

**Where we are:** dev-side pilot-readiness is **complete**. End-to-end retest (customer rates 1★ → both sides respond independently → customer amends per-dimension → review publishes correctly with no cross-contamination) passed all 9 acceptance steps on real devices. The structural per-dimension review state machine (Bundle J) is in production. The discoverability surface (dashboard "Reviews & Ratings" cards + AttentionQueueScreen) works end-to-end. Test suite 1458 → 1639 (+181 across the wave); `tsc --noEmit` clean on both `src/` and `functions/` throughout; full unit suite at **158 suites / 1639 tests** with `npx jest` now running both logic + components projects to completion (HOTFIX-JEST-PROJECTS-CONFIG fixed the "test discipline is theater" issue Devin called out).

**Wave summary (chronological):**

- **Bundle G** — Reviews polish + payment receipt + partner photo audit. Three new schema-additive fields (deliveriesCompleted, publicRatingCount, publicDeliveryRatingCount) + two backfill scripts + payment status badge derived from per-order paymentMethod/paymentStatus/paidMethod. **Bonus catch by Devin:** found two more callables of the `claims.is*` auth-bug class (updateShopRatingAlertSettings + updateAdminRatingAlertConfig) + added the **1st permanent static guard** `authClaimNamesAudit` scanning `/claims\.is[A-Z]/` across src. +24 tests exactly.
- **HOTFIX-PROFILE-PHOTO (4 layers)** — Delivery partner profile photo not visible after upload. Peeled four root causes: (1) `encodeURIComponent(storagePath)` encoded `/` as `%2F`; (2) storage.rules had no rule for `/delivery-profile/`; (3) bucket hardcoded as old `.appspot.com` (Firebase changed default naming April 2024); (4) wrong URL scheme entirely — GCS direct `storage.googleapis.com/...` bypasses Firebase Storage Rules. Final fix: Firebase Storage REST URL with embedded `firebaseStorageDownloadTokens` metadata token via `extensionHeaders` on signed PUT URL.
- **HOTFIX-RATING-RESPONSE** — Same Rule 5 class as HOTFIX-5. Server `respondToReview` checked `claims.isShopOwner` / `claims.isDelivery` instead of auth-token `claims.shopOwner` / `claims.delivery`. ResponseModal had `try/finally` with no `catch` → silent failure. Auth-claim static guard added. +7 tests.
- **HOTFIX-REVIEW-DENORM** — `respondToReview` / `amendRating` / `acknowledgeReview` / 7-day auto-publish cron all updated the source-of-truth review doc but NOT the denormalized `correctionState` on the order. Customer/shop/partner OrderDetail screens read stale denorm. Fix: cascade transitions into order doc inside the same transaction via `_publishReview`. +11 tests.
- **Bundle H — Customer review loop + Partner card finish** — Closed 5 dots: customer OrderDetailScreen had no review-response section at all (RatingAmendmentScreen reachable only via push deep-link); PartnerIdentityCard had no photo prop + two-state subtitle; push title hardcoded "Shop responded" regardless of responseBy. Bundle G §D audit-grep missed PartnerIdentityCard because it used `initialsFor` directly (not `formatPartnerAvatar`). **2nd static guard** `noStaleDeferralComments` added. +22 tests.
- **HOTFIX-PUBLISH-TX-ORDER** — Customer taps amend or acknowledge → INTERNAL error. Firestore transaction "reads must precede writes" rule violated by `tx.get(partnerRef)` sitting after three `tx.set` calls inside `_publishReview`. Latent across Bundle G + HOTFIX-REVIEW-DENORM + Bundle H (each added a write but no read). Fix: strict READ → COMPUTE → WRITE phase structure. **3rd static guard** `transactionReadOrderAudit` with string/comment/template-literal-aware brace tokenizer. +3 tests (emulator infra not available; static guard + detection units sufficient).
- **Bundle I — Attention queue + dashboard cards** — 5-card grid at top of delivery + shop dashboards (Active / Available / Coming Up / History / Reviews & Ratings) with counts + urgent variant for non-zero attention items + new AttentionQueueScreen. +18 tests.
- **HOTFIX-OWNER-CARD-AMEND** — Three-bug bundle. (1) `respondToReview` shop ownership check used `where(ownerUid).limit(1)` taking arbitrary first shop → fails for multi-shop owners; **4th static guard** `shopOwnerCheckAudit` bans the antipattern with line-scoped allowlist. (2) Card tap was no-op (state already true); fix: navigate to dedicated AttentionQueueScreen. (3) `amendRating` had redundant `amendedStars` subfield + outside-tx shop ratingAvg recompute (race with `_publishReview`) + no partner deliveryRatingAvg recompute; fix: consolidate inside the transaction. +20 tests.
- **HOTFIX-PARTNER-STATUS-DISPLAY** — Shop's order detail partner section + customer's PartnerDetailsSheet header both showed stale "On the way to..." after delivered. Bundle H §C's `derivePartnerCardSubtitle` audit missed these two surfaces. **5th static guard** `partnerStatusAudit` enumerates every literal "On the way" / "Heading to" usage and verifies a delivered/cancelled branch exists in the surrounding window. +3 tests.
- **Bundle J — Per-dimension review correction state** — Structural fix. Single `correctionState` per review covered BOTH shop + delivery dimensions; one side responding terminated the other side's response window. Split into `shopCorrectionState` + `deliveryCorrectionState` with independent state machines; legacy `correctionState` kept as computed worst-of for back-compat. 5 callables migrated + 4 composite indexes + backfill script + customer panel rewrite + ShopOrderDetailScreen + DeliveryOrderDetailScreen + RatingAmendmentScreen all dimension-aware. Three new Firestore fields denormalized on order (shop/deliveryCorrectionState + shopResponseText/partnerResponseText). +46 tests.
- **HOTFIX-ATTENTION-CALLABLES-MISSING** — Bundle I §D/§E callables (`listMyAttentionReviews` / `listShopAttentionReviews`) + client wrappers in orderService.ts had been reported shipped twice (Bundle I + Bundle J §G) but were never actually implemented — only the type + helper landed. Devin's confabulated line numbers in cross-check reports drove **strengthened Rule 5 worked example #14** (PR completion verification requires grep for export, not just typecheck pass). Required completion-report verification block now in every prompt forces raw command output in reports.
- **HOTFIX-JEST-PROJECTS-CONFIG** — Split into logic project (Node, pure helpers + static guards + functions/) and components project (RN env, screens). 27 RN-dependent suites that crashed on parse now report pass/fail. The "full suite green" signal becomes real.
- **HOTFIX-SILENT-CATCH-GUARD** — Devin's observation: `.catch(() => {})` blocks were the #1 bug-amplifier across the wave (count = 0 with no Sentry, no UI error state). **6th static guard** `noSilentCatchAudit` bans empty catch bodies in `src/` outside of explicit allowlist (`// silent-catch-audit:allow` inline comments with one-line justification). Detector scans contiguous comment block above each `.catch`. Migrated DeliveryDashboardScreen, ShopOwnerDashboardScreen, AttentionQueueScreen + AuthBootstrap + OrderDetailScreen + ShopOrderDetailScreen + admin ShopDetailManagementScreen. Every remaining bare catch is allowlisted with a one-line reason.
- **HOTFIX-POST-DEPLOY-SMOKE-SCRIPT** — `scripts/post-deploy-smoke.ts` + `parsesmokeOutput.ts` (pure parsers, +9 tests). Read-only validator: callable existence via `gcloud functions describe` + IAM allUsers binding via `gcloud run services get-iam-policy` (catches ACAB) + composite index Enabled state via `firebase firestore:indexes` (catches Building). `npm run smoke` + `smoke:indexes` + `smoke:iam` script entries. Project allowlist (grocery-mvp-dev only). Script ran live read-only against grocery-mvp-dev — passed.
- **Bundle K — Shop catalog onboarding** — Server-first deploy with 6 new callables (`listMasterCatalogByCategory`, `commitShopMenuItem`, `commitShopMenuItemsBulk`, `proposeMasterCatalogItem`, `reviewPendingCatalogItem`, `listPendingCatalogItems`) + 2 composite indexes on `products/` (status+category+name, status+proposedAt). New `status: 'approved'|'pending'|'rejected'` field on master catalog products (schema-additive; `backfill-products-status.ts` backfills 'approved' on legacy docs, seed script writes it on new). Firestore rule on `products/` now gates public reads to `status == 'approved'` (admin sees all); new `shops/{shopId}/onboardingState/catalog` progress doc. Shop-owner UI: `BuildCatalogScreen` hub (10 category tiles) → `CategoryBrowseScreen` (swipe-or-tap add/skip with `react-native-gesture-handler` + inline numeric price + `VoicePriceCapture` modal reusing PR-34 voice infra) → `CatalogReviewScreen` (bulk commit). Custom-item flow `ProposeCustomItemScreen` → admin `PendingCatalogQueueScreen`. Pure helpers: `functions/src/catalogHelpers.ts`, `src/utils/voicePriceHelpers.ts` (Hindi+English spoken-number parser), `src/utils/catalogBrowseHelpers.ts`. `cleanup-master-catalog-price-field.ts` removes legacy `price` field (per-shop pricing is authoritative). +62 tests.

**Discipline locked in (PROMPT_AUTHORING_NOTES Rule 5 worked examples #10–#16, required completion-report verification block as standard):**

- #10 Auth direction bugs (shape vs direction — separate audits)
- #11 Denormalization recompute belongs in the state-change transaction
- #12 Audit-grep enumeration for missing-feature-across-surfaces (static guard)
- #13 Per-party state machine split when single field models N parties
- #14 PR completion verification requires `grep "export const NAME"` not just `tsc clean`
- #15 Silent catch antipattern — `.catch(() => {})` is indistinguishable from success-with-empty-data
- #16 Deploy state ≠ code state — `npm run smoke` after every server deploy

**Static guard inventory — 6 permanent CI guards:**

1. `authClaimNamesAudit` — bans `claims.is[A-Z]*` reads on auth tokens (Bundle G bonus)
2. `noStaleDeferralComments` — bans "deferred to a future PR" comments in src/ (Bundle H §F)
3. `transactionReadOrderAudit` — bans tx.get after tx.set in Firestore transactions (HOTFIX-PUBLISH-TX-ORDER §C)
4. `shopOwnerCheckAudit` — bans `where(ownerUid).limit(1)` direction-bug pattern (HOTFIX-OWNER-CARD-AMEND §C)
5. `partnerStatusAudit` — bans "On the way" / "Heading to" strings without finalized branch in scope (HOTFIX-PARTNER-STATUS-DISPLAY §C)
6. `noSilentCatchAudit` — bans empty `.catch(() => {})` in src/ outside allowlist (HOTFIX-SILENT-CATCH-GUARD §A)

**No pending Sudhir deploy.** All wave PRs deployed + retested. The IAM deliberate-break demo for `post-deploy-smoke` acceptance #5 remains for Sudhir to run at convenience (1-minute PowerShell sequence — see HOTFIX-POST-DEPLOY-SMOKE-SCRIPT prompt or my prior chat message).

**Next priorities (post-pilot-prep):**

1. **Real shop onboarding for pilot.** Dev side is unblocked. Operational tasks: Razorpay LIVE keys, Production Firebase project decision, App Check enforcement, PR 39.2 flag flip on pilot launch day.
2. **HOTFIX-4 Android FCM** — operational (clear data + reinstall). Not Devin work.
3. **Phase B features deferred from prior waves** — admin order-comment surfacing (PR 42.1.2), partner vehicleType picker UI, PR 44 category photos (blocked on Pexels assets), STATIC-MAP-PREVIEW (#12b), LOW-RATING-PUSH (#15 already shipped — verify), REVIEW-SYSTEM (#16 superseded by Bundle H + J).
4. **4 admin BottomSheet migrations** (Rule 13 audit-grep — next admin-touching PR).

---

## Prior state — 2026-06-02 — Major testing-findings wave + multi-region test fleet rebuilt + SHOP-LOCATION-EDIT shipped (archived)

**Where we are:** dev-side pilot-readiness is one PR-39.2 lock + one Android FCM reinstall away from complete. The June 2 testing-findings wave (10 observations from Sudhir's end-to-end retest) is fully closed via four Windsurf PRs (HOTFIX-9 / HOTFIX-10 / SHOP-LOCATION-REQUIRED / SHOP-LOCATION-EDIT) + two direct Claude edits (HOTFIX-FALLBACK-LEAK + the QuickSwitch / HomeScreen polish) + one operational flip (`appConfig/shopVisibility.showAllShops` → false; IAM verify on `listShopsPublic`). Test suite trajectory across the wave: 1241 → 1282 → 1299 → 1327 (+86). `tsc --noEmit` clean on both `src/` and `functions/` throughout.

**Recent wave (chronological):**

- **HOTFIX-6.1** — CartScreen Bill Details delivery fee. Cart was still showing flat `deliveryFee` even after HOTFIX-6 patched ShopCard + ShopDetail. Snapshotted `shop.location` into the cart store + switched CartScreen to `displayDeliveryCharge(snapshot, customerLocation)`. Pure client OTA. +2 tests.
- **HOTFIX-7** — Structural fix for Android gesture-nav clipping. New reusable `BottomSheet` component in `src/components/common/BottomSheet.tsx` using `useSafeAreaInsets().bottom + spacing.lg`. Migrated `SaveCurrentLocationModal`, `PartnerDetailsSheet`, `CancelAndRefundModal`. Rule 13 added to `.windsurf/code-discipline.md` with audit-grep + exception list (4 admin screens deferred to next admin-touching PR).
- **HOTFIX-8** — Current-location order address truth. CheckoutScreen.placeOrder now reverse-geocodes live coords + builds the `deliveryAddress` from geocoded values (with sentinels `—` / `000000` + `📍 lat,lng` line2 fallback when geocode returns nothing). Plus a shop-side GPS-pin banner with maps deeplink on `ShopOrderDetailScreen` for defense-in-depth — even legacy pre-HOTFIX-8 orders display correctly.
- **PARTNER-CARD.2** — Live ETA + trust signals + the `customerId` → `customerUid` fix from PARTNER-CARD.1 (self-confirming test fixture trapped the bug pre-this-PR). New `getLivePartnerEta` callable (30s polling on client, auto-pauses when sheet closes), `claimDelivery` now denormalizes `deliveryPersonRating` / `deliveryPersonDeliveriesCount` / `deliveryPersonVehicleType`. New `formatLivePartnerEta` + `formatPartnerTrust` pure helpers. Redesigned PartnerDetailsSheet on BottomSheet chrome with 3-tier fallback ladder (live → static → em-dash). Server-first deploy, IAM-verified all 3 callables. +33 tests, hit forecast exactly.
- **HOTFIX-9** — Checkout race guard. Place Order disabled when `deliveryTargetMode === 'current' && (capturingLive || !liveCoords)` with inline "📍 Capturing your location…" hint. Plus a defensive in-`placeOrder` re-check (belt + suspenders) so a future loosening can't re-expose Bug 2.
- **HOTFIX-10** — Address dedupe. `findAddressNearby(addresses, target, thresholdM = 25)` pure helper (+8 tests). New minimal `Toast` primitive (respects `useSafeAreaInsets` per Rule 13). Modal intercept in `maybeSaveAddressAfterOrder` — on match → toast "Saved as 'Home' (already in your address book)" + skip the save modal entirely. Schema-fix note from Windsurf: they corrected my `Address[]` type to `SavedAddress[]` via audit-grep — exactly the Rule 5 catch the discipline is for.
- **Operational radius fix** — Firebase Console flip `appConfig/shopVisibility.showAllShops: true → false`. IAM verify on `listShopsPublic` per Rule 11. Resolved observations #2/#3/#4/#7 with zero code.
- **SHOP-LOCATION-REQUIRED** — Defense in depth, 3 layers. (1) RegisterShop submit gated on `location` present; (2) `approveShop` rejects location-less or invalid lat/lng (range check catches swapped lat/lng); (3) `filterShopsByServiceRadius` gains `customerHasLocation` opt → fail-OPEN for customer-side gap, fail-CLOSED for shop-side gap. Plus `locationVerifiedAt/By` audit-trail on Shop. New `scripts/audit-shops-without-location.ts` pre-deploy diagnostic. +17 tests (forecast +10 minimum).
- **Multi-region test setup** — Sudhir full reset (`reset-test-data` with admin protect). Rebuilt fleet: 6 India accounts (+91 8888888881–86, 2 customers / 2 shops / 2 delivery), 3 US accounts (+1 9999999991–93, 1 each role), admin preserved. Migrated `src/constants/testAccounts.ts` from "10-digit-no-prefix + hardcoded `+91`" to full E.164 strings — `phone: '+918888888881'`. Added `formatTestAccountPhone()` for picker display. QuickSwitchModal + HomeScreen visibility gate updated to drop the `+91` hardcoding. HomeScreen greeting now reads "Hello, {name} 👋" with `profile.name` → first-name → test-account label → null fallback ladder. All direct Claude edits, no Windsurf burn.
- **New `scripts/reset-keep-catalog.ts`** — third reset mode (keeps shops + menus + products + users; wipes orders, deliveryRequests, pendingShopRequests, aiAuditLog/aiQuotas/auditLog/featureUsageLog/razorpayWebhookEvents/refunds; clears per-user addresses/favorites/currentLocation/deliveryRating, clears per-shop ratingAvg/ratingCount). Same safety pattern as `reset-pilot-data`: project allowlist, admin UID protect, dry-run default, typed DELETE confirm, audit log at `scripts/.cleanup-logs/`.
- **HOTFIX-FALLBACK-LEAK** (direct Claude edit, no Windsurf) — Sudhir's US friend registered a shop with Ballwin MO address but admin saw Faridabad pin. Root cause: `locationService.getCurrentLocation()` falls back to `MOCK_USER_LOCATION = { lat: 28.5605, lng: 77.2065 }` on permission-denied / GPS-off / exception with `source: 'fallback'`, but no downstream consumer checked `source`. RegisterShop's `validate()` only checked location was non-null. Hotfix: read `source` from `useLocationStore`, refuse `source !== 'gps'` with red `captureHintError` warning + Continue hard-disabled. Pure client OTA, ~5 min edit.
- **SHOP-LOCATION-EDIT** — Structural fix on top of HOTFIX-FALLBACK-LEAK. §A RegisterShop dual capture (📍 Use my GPS or 🔍 Find from address using `Location.geocodeAsync` — free, no API key, no recurring cost). §B ShopSettings Location section + `pendingLocation` two-step approval. §C Admin sees owner-typed address vs reverse-geocoded pin resolution side-by-side. New `useCaptureShopLocation` hook, `formatResolvedAddress` + `distanceBetweenPins` pure helpers. 4 new server callables (submitPending / cancelPending / approvePending / rejectPending). Schema-additive only (5 new optional fields on Shop). +28 tests. Rule 5 extension formalized: audit-grep must cover behavior at call sites when field is missing / null / nonconforming.

**Pending Sudhir deploy:**

```powershell
# Server first — 6 new + modified callables
cd functions; npm run build; cd ..
firebase deploy --only "functions:registerShop,functions:approveShop,functions:submitPendingShopLocation,functions:cancelPendingShopLocation,functions:approvePendingShopLocation,functions:rejectPendingShopLocation"

# IAM verify all 6 (Rule 11 — recurring strip)
foreach ($svc in 'registershop','approveshop','submitpendingshoplocation','cancelpendingshoplocation','approvependingshoplocation','rejectpendingshoplocation') {
  gcloud run services get-iam-policy $svc --region=asia-south1 --project=grocery-mvp-dev
}

# Firestore rules update
firebase deploy --only firestore:rules

# Client OTA bundling SHOP-LOCATION-EDIT + HOTFIX-FALLBACK-LEAK + QuickSwitch/HomeScreen polish
eas update --branch production --message "SHOP-LOCATION-EDIT + HOTFIX-FALLBACK-LEAK + QuickSwitch/HomeScreen polish"
```

**Next priorities (no Windsurf needed today, save quota):**

1. Deploy the bundled OTA + run end-to-end retest (multi-region accounts now exist; test the distance system properly).
2. **PR 39.2 live-pilot guard** — pre-pilot must-do. Becomes critical the day shop #1 takes a real money order. Drafts can wait until pilot launch is imminent.
3. **Diag log strips** (PR 45.1 push probes + PR 48 `[getMyShop] resolved via`) — 5-min OTA, can do without Windsurf.
4. **HOTFIX-4 Android FCM** — operational (clear data + reinstall, rebuild if needed). Not Windsurf work.

**Locked-in discipline rules (`.windsurf/code-discipline.md`):**

- Rule 5 (schema audit-grep + call-site behavior check) — Mock_USER_LOCATION leak is the worked example
- Rule 11 (Cloud Run `allUsers` IAM verify after every callable deploy)
- Rule 13 (BottomSheet for any bottom-anchored modal — fail-fast via audit-grep)
- Rule 14 (server-side validators return discriminated-union Results, not throws)


## Prior state — archived

Earlier "Current state" snapshots (2026-05-24 → 2026-05-27 wave: PRs
26, 32, 34, 39, 39.1, 41–45.2, 46–49) have been moved to
`docs/CLAUDE_HISTORY.md` to keep this file under the Claude Code
40k-char performance threshold. For granular per-session detail,
`docs/SESSION_LOG.md` remains the source of truth. Read
`CLAUDE_HISTORY.md` only when reconstructing a specific PR's
lineage that the active state above doesn't already cover.

## In-flight work / open questions

- **Pending Sudhir deploy:** SHOP-LOCATION-EDIT server-first (6
  callables) + IAM verify all 6 + Firestore rules + client OTA
  bundling SHOP-LOCATION-EDIT + HOTFIX-FALLBACK-LEAK + QuickSwitch
  / HomeScreen polish. Exact commands in the Current state section
  above.
- **DIAG-STRIP (2026-06-02)** — first Claude Code execution test.
  Batch 1 already done in a prior cleanup; Batch 2 is the two
  `[getMyShop] resolved via …` `console.info` blocks in
  `functions/src/index.ts:5630-5680`. Server-side Functions deploy
  + IAM verify on `getMyShop`, NOT a client OTA (my original prompt
  misclassified it; Claude Code caught the error before applying).
- ~~**PR 39.2 live-pilot guard**~~ — ✅ **SHIPPED 2026-06-09 via
  Cascade-on-Sonnet** (first executor test under the new Devin
  branding). +15 tests exactly per forecast (1327 → 1342);
  deliberate-break demo confirmed tests pin the bug; ~1% quota
  usage. Sonnet-as-default validated. **OPERATOR REMINDER:**
  on the day shop #1 takes a real money order, flip
  `appConfig/pilotStatus.isLive: true` in Firebase Console.
  Before that flip the guard reads missing doc as safe; after,
  all three reset scripts refuse without `--i-know-pilot-is-live`
  override. See PRELAUNCH_CHECKLIST.md PR 39.2 section.
- ~~**PR-NEXT-BUNDLE-A — Pilot regressions**~~ — ✅ **SHIPPED
  2026-06-09 via Cascade-on-Sonnet, autonomous block applied.**
  +9 tests exactly per forecast (1342 → 1351). New
  `resolveCustomerDeliveryReference` pure helper (priority: default
  saved address pin → live GPS → null); CartScreen + ShopDetail
  use it so cart/shop/checkout numbers stay in lockstep. §B JSX
  gate on `readyByEstimate` sub-message in OrderDetail (hides on
  `ready_for_pickup`+); §C `useLivePartnerEta` gets `orderStatus`
  arg + `FINALIZED_STATUSES` const + exported `shouldPoll` helper
  for unit testing; sheet shows static "Delivered"/"Cancelled"
  row when applicable. §D `RateOrderCard` wrapped in
  `KeyboardAvoidingView`. Deliberate-break demo confirmed tests
  pin the bug. Pure client OTA — no server changes.
- ~~**PR-NEXT-BUNDLE-B — Mid-flow UX**~~ — ✅ **SHIPPED 2026-06-09
  via Cascade-on-Sonnet, autonomous block applied.** +11 tests
  exactly per forecast (1351 → 1362). §A `getLivePartnerEta` gate
  extended to allow shop owner of the order's shop (callable input
  now extracts `shopOwner` + `shopId` claims; pure helper takes
  `isCallerShopOwner` + `callerShopId`; error code renamed
  `not_customer` → `not_authorized`). ShopOrderDetailScreen uses
  `useLivePartnerEta` for live ETA matching customer's sheet. §B
  one-tap call collapse — `onCallPartner` handler fetches phone
  if not cached + opens dialer in same tap; `PartnerDetailsSheet`
  exposes single "📞 Call partner" CTA. §C new pure helper
  `validateMarkDeliveredProofGate` (discriminated-union Result);
  server gate on `proofPhotoUrl` present; partner dashboards
  disable Delivered button with hint until proof uploaded.
  Deliberate-break demo confirmed (corrupted `not_customer` →
  `not_authorized` swap; 1 test failed; restored). Pending deploy:
  server-first (2 callables) + IAM verify both + client OTA
  bundling Bundle A + B together.
- ~~**PR-NEXT-PARTNER-PHOTO (Phase B, #11)**~~ — ✅ **SHIPPED across
  HOTFIX-PROFILE-PHOTO 1→4 wave** (encoding → storage.rules →
  bucket name → URL scheme). Partner photo flow works end-to-end.
- ~~**Phase B drafts deferred**~~ — LOW-RATING-PUSH (#15) shipped
  in Bundle G era. REVIEW-SYSTEM (#16) superseded by Bundle H +
  Bundle J (per-dimension review correction state). STATIC-MAP-
  PREVIEW (#12b) still deferred; not pilot-blocking.
- **HOTFIX-4 Android FCM** — operational fix (clear data +
  reinstall, rebuild Android via `eas build --profile production
  --platform android` if reinstall doesn't refresh the token). Not
  Devin work.
- **Deferred to post-pilot:** 4 admin-screen BottomSheet
  migrations (Rule 13 audit-grep catches them on next admin-
  touching PR), PR 42.1.2 admin order-comment surfacing, partner
  `vehicleType` picker UI, PR 44 category photos (blocked on
  Sudhir sourcing Pexels assets).
- **Production Firebase project (`grocery-mvp-prod`)** not yet
  created. Trigger: pilot stability signal + commit to launch date.
- **App Check enforcement** intentionally deferred. Debug token
  active for dev.
- **Razorpay LIVE keys** not yet configured — test keys only.
- **PR 39.2 flag flip** — operational reminder. On the day shop #1
  takes a real money order, flip `appConfig/pilotStatus.isLive:
  true` in Firebase Console. After flip, all three reset scripts
  refuse without `--i-know-pilot-is-live`. See
  PRELAUNCH_CHECKLIST.md PR 39.2 section.
- **IAM deliberate-break demo for `npm run smoke`** acceptance
  item 5 — 1-minute PowerShell sequence using `listMyEarnings`
  (strip → smoke fails → re-bind → smoke passes). Closes
  HOTFIX-POST-DEPLOY-SMOKE-SCRIPT's last acceptance item. Not
  pilot-blocking.
- **Test-suite pre-existing failures** — 4 `@react-native-firebase
  /app` suite-load failures (openLegal, openSupport, openMapsForCoords,
  uploadDeliveryProof) and ~27 RN-dependent suites that crashed on
  parse pre-HOTFIX-JEST-PROJECTS-CONFIG. Post-projects-split, they
  either run cleanly in the components project or are pinned with
  explicit mocks. Surface, don't hide.

## How to update this file

At end of any session where Current state or In-flight changed:

- Update **Current state** with the latest commits + ships + state
  changes. Demote the prior Current state to a one-paragraph
  "Prior state" entry pointing at SESSION_LOG.md, OR move it to
  CLAUDE_HISTORY.md if it's older than ~7 days.
- Update **In-flight work** — strike resolved items, add new ones.
- Bump the date stamp on the Current state heading.
- Don't bloat. This file is a map, not history. History goes in
  `docs/SESSION_LOG.md` and `PRELAUNCH_CHECKLIST.md`.
- Keep total length **well under 40k chars** so Claude Code doesn't
  warn on session start. Archive aggressively.
