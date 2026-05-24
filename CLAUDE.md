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

## Current state — 2026-05-24 (PR 34 native build live + tested; PR 26 source-map status TBD)

**Branch:** `main`, up to date with `origin/main`.

**Last commit:** `PR 34: voice + Hindi onboarding assist (Google
STT + Claude Haiku field parser)` (`27f22ac`, May 24). Previous:
`PR 32`, `PR 31.1`, `PR 31`, `PR 26`, `PR 27`, `PR 25`.

**Deploy state:**
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

**Unit suite:** 636/636 passing (+9 from PR 32's
`menuExtractionHelpers.test.ts`).

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
- **Pilot-blocking sequence (post-PR-34):** PR 38 (admin
  feature-usage dashboard, ~2 days, must land before pilot for
  day-1 data capture) → PR 36 (Customer CRM, ~1–1.5 days, the
  primary merchant daily-use hook for pilot) → start pilot.
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
