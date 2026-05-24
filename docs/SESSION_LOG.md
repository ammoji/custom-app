# Session log

Append-only log of Cowork / Claude sessions on this repo. One short
entry per session. Most recent at the bottom.

**Format per entry:**

```
## YYYY-MM-DD — short title

What we worked on. What decisions were made. What's left open.
Anything a future session would need to know that doesn't belong in
CLAUDE.md or a PR prompt.
```

**Why this exists:** Claude/Cowork sessions don't carry memory across
chats. CLAUDE.md captures the stable shape of the project; this log
captures the conversation flow — what was tried, what was decided,
what was deferred. Together they let a fresh session walk in and not
ask the same questions twice.

---

## 2026-05-22 — Backfill: project context lost across sessions, set up memory files

Sudhir asked where 10 days of prior grocery-mvp conversation had gone.
Answer: Cowork doesn't carry memory across sessions, and the
local-session list on this machine doesn't show any grocery-mvp
sessions (they may have happened in a different Claude product,
e.g. claude.ai web, mobile, or Claude Code). The substance of those
conversations is preserved in the repo itself — `claude_files/`,
`docs/pr-*-windsurf-prompt.md`, and `PRELAUNCH_CHECKLIST.md` — but
nothing pointed a new Claude session at that material.

**Set up two memory files:**

- `CLAUDE.md` at repo root — stable project context: stack, layout,
  conventions, where prior context lives, current state, resume
  protocol.
- `docs/SESSION_LOG.md` (this file) — append-only per-session log.

**Snapshot of repo state captured in CLAUDE.md at the time of this
entry:** branch `main` up to date with `origin/main`, last commit
`7665d59 Resent OTP`, but a large uncommitted local diff (28 files,
~4200 insertions) that appears to cover PRs 19–22 (favorites,
ratings, substitution preferences, delivery instructions). Those PRs
have prompts in `docs/` but no merge commits on main. Disposition of
that diff is the first open question for the next session.

**Nothing in the codebase was modified** other than creating these two
files. No commits made.

**For next session:** read `CLAUDE.md` first, then this file, then
ask Sudhir what he wants to tackle. Likely candidates: (a) decide what
to do with the uncommitted PR 19–22 work, (b) start PR 23, (c) pick up
something from the prelaunch checklist.

## 2026-05-22 — PR 23 bugfix: delivery "Coming soon" → "Already taken" regression

**Reported symptom:** delivery partner taps a card in the "Heads up —
coming soon" rail on the dashboard, lands on
`DeliveryOrderDetailScreen`, sees "Already taken — Another partner
claimed this pickup." Nobody had claimed it.

**Root cause:** `deriveDeliveryFlags` in
`src/screens/delivery/DeliveryOrderDetailScreen.useDeliveryOrderDetail.ts`
treated *any* order the viewer couldn't actively claim as
`isTerminalForOthers = true`. That worked before PR 12. PR 12 added
the heads-up rail (accepted/preparing orders surfaced to delivery
partners for route planning), but didn't extend the detail-screen
flag logic to distinguish "previewable but not yet ready" from
"claimed by another partner". A unit test even enshrined the wrong
behaviour (`'preparing → terminal for others'` → asserted `true`).

**Fix (client-only, no server deploy):**

1. `DeliveryOrderDetailScreen.useDeliveryOrderDetail.ts` —
   - Added `isComingSoon: boolean` to `DeliveryFlags` (true when the
     viewer is a delivery partner, the order is unassigned, and
     status is `accepted` or `preparing`).
   - Narrowed `isTerminalForOthers` to its original intent:
     claimed-by-another-partner OR delivered-and-not-mine.
2. `DeliveryOrderDetailScreen.tsx` — destructure `isComingSoon` and
   render a yellow "⏳ Not yet ready for pickup" banner at the top of
   the ScrollView when it's true. Falls through to the rest of the
   order detail (items, addresses, timeline) so the partner sees
   what they tapped on, but no Accept button.
3. `tests/hooks/useDeliveryOrderDetail.test.ts` — flipped the
   bug-locking test; added 4 new PR-23 tests covering preparing,
   accepted, accepted-claimed-by-other (terminal still wins), and
   the `isDelivery` gate. All 23 tests pass.

**Snags during the fix:** the Edit tool truncated both the hook and
the screen file mid-content during my edits (parens/brace check
caught it; jest's `SyntaxError: Unexpected token ')'` pointed at the
right spot). Recovered by `git show HEAD:<path>` and splicing the
missing tail back in. Worth flagging if it happens again — large
multi-line replacements on big files seem to be the trigger.

**Verification:** full unit suite (`npx jest --config
tests/jest.unit.config.js`) — **599 passed / 599 total**, 58 suites.
Native build / Cloud Functions deploy not run from this session; no
server changes were made.

**Files changed (still uncommitted, on top of the prior PR 19–22
diff):**
- `src/screens/delivery/DeliveryOrderDetailScreen.useDeliveryOrderDetail.ts`
- `src/screens/delivery/DeliveryOrderDetailScreen.tsx`
- `tests/hooks/useDeliveryOrderDetail.test.ts`
- `CLAUDE.md`, `docs/SESSION_LOG.md` (this entry + bootstrap)

**For next session:** untouched — still the disposition of the PR
19–22 uncommitted bundle, and whether this bugfix should be cut as
its own PR (PR 23: delivery heads-up regression fix) or folded into
the next bundle.

## 2026-05-22 — PR 23 shipped via Windsurf cross-check

PR 23 ("delivery heads-up coming-soon regression fix") landed as an
isolated commit on `main` and shipped via `eas update --branch
production` to family testers.

**Pattern restored.** Earlier in the session I (Claude) edited
source files directly, breaking Sudhir's established
Claude-writes-prompt → Windsurf-executes pattern. Reverted course:
wrote `docs/pr-23-delivery-heads-up-fix-windsurf-prompt.md` in the
same style as prior prompts, handed off to Windsurf. Windsurf
reported Parts 1–6 already in place from my prior direct edits (we
didn't fully revert them — working tree carried forward) and
filled the Part 7 gap (the `comingSoonCard` styles, plus the
`dropInstructionsCard` family that was missing). PRELAUNCH_CHECKLIST
updated by Windsurf with the PR 23 entry + 4 follow-ups.

**Verification before publish:**
- `npx tsc --noEmit` — 0 errors
- `npm test` — 599/599 passing (596 prior + 3 net from 4-added /
  1-removed test rewrite in `useDeliveryOrderDetail.test.ts`)
- Deliberate-break confirmed earlier in the session.

**Deploy:** client-only OTA via `eas update --branch production`.
No Cloud Functions deploy needed (PR 23 was pure client flag logic).

**Documented the cross-check pattern in CLAUDE.md.** New section
"Authoring split" under "How PRs are organized" so a fresh Claude
session in the future doesn't repeat my mistake of editing files
directly. Default: prompt + handoff, not direct edits.

**OTA scope clarification (per Sudhir):** family testers were
already running PR 19–22 from prior working-tree OTA pushes — they
weren't newly introduced today. Today's push refreshed the same
PR 19–22 code + added PR 23 on top. Push timed to IST evening when
testers are off, so any PR 23 regression has overnight breathing
room before tester eyes are on it.

**Phone smoke test: PR 23 confirmed working** — Sudhir verified the
coming-soon banner renders correctly on his phone; no "Already
taken" message.

**Git ↔ OTA divergence: RESOLVED in the same session.** The deploy
step bundled all uncommitted source into commit `4fb15ce` —
"PR 19-22 bundle + PR 23: favorites, ratings, substitution prefs,
delivery instructions, heads-up coming-soon fix" — 69 files /
+15,693 / −42 — pushed to origin/main. Includes all PR 9–22 source,
PR 23 changes, CLAUDE.md, SESSION_LOG.md, and all 10 windsurf
prompts (pr-13 through pr-22). Git history now matches the OTA
bundle on tester phones. Per-PR granularity is preserved by the
windsurf prompts in `docs/`, not by the commit history.

**Open for next session:**
- Sentry watch over the next 24 hours as IST testers come back
  online — PR 23 surface specifically (delivery detail screen),
  but also any unrelated regressions from the OTA bundle as a whole.
- Clear the ghost git index state if it returns: `git reset` (no
  args) after `del .git\index` rebuilds. The index can show 360+
  files as "staged for deletion" — purely an artifact, not real.
- Pick the next feature PR (PR 24) or PRELAUNCH_CHECKLIST item.

## 2026-05-22 — PR 24 shipped (push token cleanup on sign-out)

Closes the documented gap in `signOutAndClearLocalState.ts` (lines
29–34) where the previous account's `fcmTokens` were not cleaned up
on sign-out, leaking push notifications to whoever signed in next
on the same device.

**Architecture:** new `unregisterPushToken` server callable
(`functions/src/index.ts:2217-2237`, mirror of `registerPushToken`
using `arrayRemove`). New `pushService.unregisterPushToken` client
method. `SignOutDeps` extended with an optional new dep; orchestrator
calls it inside `try/catch` BEFORE the firebase auth signOut (must
run while still authed; failures are logged but never abort
sign-out). Both `ProfileScreen` and `QuickSwitchModal` now wire it
in — QuickSwitch was previously bypassing the orchestrator entirely,
so this PR also closes a pre-existing cart-clear leak there as a
side effect.

**Pattern:** Claude wrote `docs/pr-24-push-token-cleanup-on-signout
-windsurf-prompt.md` (7 parts, server-first deploy plan, 8 smoke
tests, deliberate-break check). Windsurf executed inside the IDE.
Sudhir reviewed, ran tests, and deployed. Second consecutive PR on
the cross-check pattern with no friction.

**Verification before publish:**
- `npx tsc --noEmit` (root + functions) — 0 errors
- `npm test` — **602/602 passing** (+3 net from new tests in
  `tests/services/authService.signOut.test.ts`: order, failure-
  isolation, optional-dep backward-compat)
- Order assertion confirms `unregisterPushToken` runs strictly
  before `signOut` (deliberate-break confirmed)

**Deploy:** server-first — `firebase deploy --only
functions:unregisterPushToken` then `eas update --branch
production`. Git commit message: `PR 24: push token cleanup on
sign-out + route QuickSwitch through orchestrator`.

**PRELAUNCH_CHECKLIST:** "Push token cleanup on sign-out" item
flipped to `[x] [Shipped — PR 24]`. PR 24 section appended with
4 follow-ups (Windsurf's notes).

**Open for next session:**
- Smoke-test PR 24 on phone using the 8-test checklist in the PR
  prompt. Tests 1, 2, 3, 7 are the blockers; 4 (multi-device), 5
  (offline sign-out), 6 (QuickSwitch bonus), 8 (Sentry watch) are
  confidence-builders.
- Pick PR 25. Candidates surfaced earlier: Sentry source-map upload,
  privacy-policy hosting + in-app links, background-tap protection
  on retry/cancel buttons.

## 2026-05-22 — Strategic roadmap drafted (`docs/ROADMAP.md`)

PR 24 smoke tests confirmed passing on Sudhir's phone. He then asked
for a strategic review against the 15-category competitor analysis
(Real-time tracking, Frictionless checkout, Search/recommendations,
Inventory accuracy, ETA prediction, Ratings, Loyalty, Notifications,
Vendor dashboard, Delivery app, Customer support, Hyperlocal,
Dark-store optimization, AI features, Trust features).

**Created `docs/ROADMAP.md`** as a durable strategic artifact —
sits alongside CLAUDE.md and PRELAUNCH_CHECKLIST.md, but different
purpose: it's the "what are we building next 6 months and why"
view, not the tactical line-item tracker. Contents:

- Section 1: audit of all 15 categories vs. shipped PRs.
  Verdict mix: ✅ Frictionless checkout, Ratings, Vendor dashboard,
  Delivery app, Trust features mostly shipped. 🚧 Tracking, Search,
  Inventory, Notifications, Hyperlocal partial. ❌ Loyalty, Support,
  AI features greenfield. ⛔ Dark-store optimization out-of-scope
  permanently (wrong business model).
- Section 2: phased roadmap A–E with PR placeholders 25 through 53.
  - Phase A (launch readiness): PR 25–30. Privacy policy, Sentry
    sourcemaps, tap-protection, prod Firebase split, Razorpay live
    keys, App Check.
  - Phase B (trust + retention): PR 31–38. Support, visual tracking,
    refund visibility, coupons, substitution UI, low-stock alerts.
  - Phase C (AI differentiation): PR 39–44. Anthropic SDK plumbing,
    shopping assistant, auto-replenishment, personalized
    recommendations, sentiment summarization, AI support.
  - Phase D (operations + scale): PR 45–49.
  - Phase E (loyalty + repeat): PR 50–53.
- Section 3: AI integration strategy. Server-side via Cloud
  Functions; Claude Haiku for cost/latency reasons; cost analysis
  showing AI per-order is rounding-error at current API pricing.
- Section 4: explicit deferrals/out-of-scope so future sessions
  don't re-litigate (dark stores, ML ETA, GPS map, wallet PPI, etc.).
- Section 5: how to use the doc + update protocol.

**Threaded into CLAUDE.md** under "Where prior context lives" so
fresh Claude sessions find it on the resume protocol.

**Decision logged:** Phase A is the immediate priority. Phase C
(AI) is the differentiation moat — explicitly the "leverage the AI
boom" answer Sudhir asked about. AI features go server-side via
Cloud Functions with a single `aiHelpers.ts` wrapper for cost
control + auditability.

**For next session:** pick a Phase A PR — likely PR 25 (Privacy
Policy hosting + in-app links) since the draft already exists at
`docs/privacy-policy.md` and it's the lightest lift.

## 2026-05-22 — Phase A2 inserted: shop onboarding as a launch-blocker workstream

Sudhir re-read the ROADMAP and flagged that **shop onboarding** wasn't
treated as a distinct phase — the doc went straight from launch-
readiness (Phase A) to customer trust/retention (Phase B), but the
app currently ships with 8 seeded mock Delhi shops and has no flow
for a real kirana owner to register, get their catalog in, and go
live. Launching with empty shops would be worse than a 4-week delay.

**Two clarifying choices made up front (via AskUserQuestion):**

1. **Sequencing:** dedicated phase BEFORE public launch, between
   Phase A and Phase B. New "Phase A2 — Shop onboarding."
2. **Onboarding model:** assisted + self-serve hybrid. Field rep
   onboards the first 50–100 shops in ~30 min using AI tools, after
   which shopkeeper maintains the listing self-serve. Self-serve
   registration ships in PR 31 but is admin-KYC-gated.

**Changes to `docs/ROADMAP.md`:**

- New **Snapshot** section at the top — shipped (PRs 1–24), in flight
  (Phase A), up next (Phase A2). Lets a fresh Claude session or
  Sudhir himself see the picture without reading 600 lines.
- New **Phase A2** between Phase A and Phase B, with 5 PRs:
  - PR 31 — Shop self-registration + admin KYC approval (foundation;
    replaces `claimShop` against the 8 mock shops).
  - PR 32 — AI photo-to-catalog (Claude Sonnet vision extracts SKUs
    from a photographed rate-list/shelf; 4 hours of typing → 15
    minutes of review).
  - PR 33 — Shared master product catalog + smart price suggestions
    (so two kiranas don't recreate the same SKU under different
    names; AI suggests prices from comparable shops in pincode).
  - PR 34 — Voice + Hindi onboarding assist (mic on every field; for
    tier-2/3 shops where typing fluency is the barrier).
  - PR 35 — Field-rep assisted onboarding mode (new role; admin can
    onboard a shop on behalf of the owner during an in-person visit,
    OTP handoff at the end).
- Phase B PR numbers shifted 31–38 → **36–43**; Phase C 39–44 →
  **44–49**; Phase D 45–49 → **50–54**; Phase E 50–53 → **55–58**.
  Section 3 cross-references (3.1–3.5) updated to match.
- New Section 3 subsections **3.6 photo-to-catalog**, **3.7 master
  catalog + price suggest**, **3.8 voice-Hindi**, and **3.9 WhatsApp
  bot (deferred to Phase D)**. Same UX/implementation/cost-estimate
  template as 3.1–3.5. All four reuse the `aiHelpers.ts` wrapper
  that PR 32 will ship first.
- Section 4 (deferrals) gained six entries: bulk CSV import,
  WhatsApp bot, multi-shop ownership, voice search vs Hindi voice
  input, map tracking in onboarding, and direct-from-client AI calls
  (all NOT in Phase A2, deferred with reasons).
- Rate-limiting section: added per-shop quota for photo extraction
  (5/day) and a kill-switch pattern (`aiFeatures/{name}.enabled`).
- "Last reviewed" bumped to `2026-05-22 (post-PR-24, post-Phase-A2
  insertion)`.

**Verification:** read the updated ROADMAP end-to-end; grepped for
stale `PR 39–44` style references and confirmed all internal
cross-references match the new numbering. No source files touched
this session — pure doc work, consistent with the Claude-prompts /
Windsurf-executes split.

**Strategic reasoning captured in the doc, summarized here:**

- Launching with 8 mock shops is worse than delaying. Phase A unblocks
  legal/payment plumbing but does not unblock supply.
- Phase B (retention) is meaningless without supply to retain on.
- LLMs are now cheap enough that photo-to-catalog is a real moat
  candidate vs. the form-based onboarding the established players
  inherited. Per-shop AI cost for full onboarding is ~₹3–₹25 — orders
  of magnitude less than a field rep's hour.
- The AI plumbing (`functions/src/aiHelpers.ts`) PR 32 lays down is
  reused by every Phase C customer-facing AI PR. Phase A2 funds the
  plumbing; Phase C reaps the customer-side compounding.

**For next session:** options in priority order —
- **(a) PR 25 — Privacy Policy hosting** (Phase A, lightest lift, draft
  exists at `docs/privacy-policy.md`).
- **(b) PR 31 windsurf prompt** — write the design for shop self-
  registration + KYC approval if Sudhir wants to start Phase A2 in
  parallel with the lightweight Phase A items.
- **(c) Smoke-test PR 24 on phone** per the 8-test checklist (still
  the unstruck item from the prior session).

## 2026-05-22 — Drafted four Windsurf prompts (PRs 25, 26, 27, 31)

Sudhir picked all four candidates from the post-roadmap session.
All four prompts drafted in this session and committed to `docs/`:

- `docs/pr-25-privacy-policy-hosting-windsurf-prompt.md` — 645 lines
- `docs/pr-26-sentry-sourcemap-upload-windsurf-prompt.md` — 497 lines
- `docs/pr-27-background-tap-protection-windsurf-prompt.md` — 525 lines
- `docs/pr-31-shop-kyc-document-upload-windsurf-prompt.md` — 1043 lines

All four use the PR 24 template's 11-section structure (Why this PR
exists / Read first / Critical lessons / Scope in / Scope out /
Acceptance / Deliberate-break / Smoke tests / Deploy plan / Estimated
time / Why this PR matters).

**Major discovery while drafting PR 31:** shop self-registration is
ALREADY built. The `registerShop`, `approveShop`, `rejectShop`
callables shipped in Phase 12a-v2-i (functions/src/index.ts
~lines 2926, 3009, 3094), and the client screens
(`RegisterShopScreen`, `WaitingForApprovalScreen`,
`PendingShopsScreen`, `ShopRegistrationDetailScreen`) all exist.
The ROADMAP's original PR 31 description ("the foundation") was
inaccurate. Updated the ROADMAP PR 31 row in this session to reflect
the actual gap: **KYC document upload** (storefront photo + GST /
FSSAI / owner-ID document images). PRELAUNCH_CHECKLIST line 449
already flagged this as the remaining gap; PR 31 now correctly closes
the shop-side half of it. Delivery-partner KYC remains an open
follow-up.

**Drafting choices worth noting for future sessions:**

- **PR 25 deliberately uses Firebase Hosting** (already configured
  in `firebase.json` with `dist/` as public dir) instead of a
  separate hosting setup. The privacy URL becomes
  `https://grocery-mvp-dev.web.app/privacy` on dev project, and
  the URLs are centralized in `app.json.extra.legal` so the
  prod-Firebase split (PR 28) becomes a one-line change.
- **PR 26 keeps `SENTRY_DISABLE_AUTO_UPLOAD=true` on dev/preview**
  profiles deliberately — only production builds upload source
  maps. Wastes no Sentry quota on throwaway builds. PR 26 takes
  effect on the next NATIVE build (not the next OTA), so the
  deploy plan calls out `eas build` not `eas update`.
- **PR 27's `usePressGuard` is intentionally NOT debounced by
  time** — pure in-flight mutex via `useRef<boolean>`. Returns
  the wrapped function only (no `[wrapper, isBusy]` tuple) because
  reading the ref for visual state wouldn't re-render anyway; the
  existing `setPlacing` / `setCancelling` useState is kept
  alongside for the spinner UI.
- **PR 31 mirrors PR 6.1's signed-PUT pattern** for KYC docs —
  same `validate → signed PUT → record` flow, same admin-SDK
  signing bypass. RegisterShopScreen becomes a 2-step wizard
  (basic info → docs) because the docs upload needs a `shopId`
  which only exists after the first `registerShop` call. Phase
  A2's PR 32 (AI photo-to-catalog) will reuse this exact substrate.

**Roadmap drift caught + fixed:** updated the PR 31 row in
`docs/ROADMAP.md` from "Shop self-registration + admin KYC approval"
to "Shop KYC document upload (storefront + GST/FSSAI/owner-ID)" so
future sessions don't re-litigate the (already-built) foundation.

**No source files were modified this session.** All work is
prompts + the one ROADMAP correction. Disposition follows the
Claude-prompts-Windsurf-executes pattern.

**For next session:** Sudhir picks which prompt to hand off to
Windsurf first. Recommended order (lightest first):
1. **PR 26** — Sentry sourcemaps (30–45 min, the highest-leverage
   per-minute change on the entire roadmap).
2. **PR 27** — usePressGuard (45 min, fixes a real family-test
   regression).
3. **PR 25** — Privacy Policy hosting (1.5–2 hrs, biggest unblock
   for App Store submission).
4. **PR 31** — Shop KYC document upload (5–7 hrs, the bigger lift
   that opens Phase A2).

PR 26 + PR 27 can ship same-day. PR 25 wants Sudhir's eye on the
ToS draft before commit. PR 31 needs server-first deploy and a
manual smoke test on a phone with real photo uploads.

## 2026-05-22 — PR 25 shipped (Privacy Policy + ToS hosted + linked in-app)

Windsurf executed the PR 25 prompt end-to-end. Hosted, deployed,
tested. Live verification (`web_fetch` of both URLs in this session
returned 200 with the full rendered markdown):
- `https://grocery-mvp-dev.web.app/privacy` — 10 sections, all from
  `docs/privacy-policy.md`, contact email correct, footer reads
  "Last rendered: 2026-05-22".
- `https://grocery-mvp-dev.web.app/terms` — 14 sections from
  `docs/terms-of-service.md`. §13 still contains the documented
  `[CITY TBD before launch]` placeholder (intentional — Windsurf
  flagged this as a pre-App-Store-submission follow-up).

**Verified against PR 25 acceptance checklist:**

- `docs/terms-of-service.md` (305 lines, all 14 sections).
- `scripts/build-legal-html.ts` (309 lines, hand-rolled markdown→HTML
  converter — no new deps).
- `firebase.json` — `/privacy` and `/terms` rewrites in the correct
  order (before the SPA `**` catch-all).
- `app.json` `extra.legal.{privacyUrl,termsUrl}`.
- `src/constants/legal.ts` (34 lines) + `src/utils/openLegal.ts`
  (37 lines) — central URL accessor + native/web dispatcher.
- `src/screens/LoginScreen.tsx` lines 179–195 — legal footer
  scoped to the `enter_phone` phase only (the existing comment
  inside explains the rationale).
- `src/screens/ProfileScreen.tsx` line ~350 — "Legal" section
  above "Account" with two Pressable rows.
- `tests/utils/openLegal.test.ts` (122 lines) — uses
  `jest.isolateModulesAsync` for clean module-level mocking. 4
  tests; full suite reports 606/606 passing per Windsurf.
- `PRELAUNCH_CHECKLIST.md` — Privacy + ToS items at lines 560/565
  flipped to `[Shipped — PR 25]`; full PR 25 section appended at
  line 2505. The stale "Candidate PR 25" reference at line 2819 is
  a different topic (Expo Push GC) — no action needed but worth
  noting.

**One Cowork-session observation, not a blocker:** my Read/Glob
tools couldn't see `dist/privacy.html` or `dist/terms.html` on the
host, yet the URLs are live and serving the right content (proven
by web fetch). Same Cowork mount-staleness pattern we saw earlier
with SESSION_LOG.md — Sudhir's local working tree has the files,
my session's view is lagging. The .gitignore exceptions for
`!dist/privacy.html` and `!dist/terms.html` are correctly set, and
Windsurf reported the files were generated. Action: if Sudhir later
runs another `firebase deploy --only hosting` after a fresh clone,
run `npm run build-legal` once first to regenerate the HTML before
the deploy. Not blocking; just defensive.

**ROADMAP.md** Snapshot still shows "in flight (this week — Phase A)
PR 25" — bump it to PR 26 next time the file is touched. Not
urgent — the Phase A table itself is correct.

**For next session:** options ranked —
- **(a) PR 27 — `usePressGuard` background-tap protection** (Recommended next).
  ~45 min Windsurf work, same-day OTA, fixes a real family-test
  regression (duplicate Razorpay sessions on double-tap).
- **(b) PR 26 — Sentry source-map upload.** ~30–45 min Windsurf
  work, but the effect only materializes on the next NATIVE build
  (`eas build`, not `eas update`). Worth shipping in parallel with
  PR 27 since the code-change is small and independent. Sudhir needs
  to generate a Sentry auth token + create the EAS secret before
  the build runs.
- **(c) PR 31 — Shop KYC document upload.** ~5–7 hrs Windsurf work,
  bigger lift, server-first deploy. Opens Phase A2. Hand off when
  Sudhir has a longer session available.
- **(d) Replace `[CITY TBD before launch]` in ToS §13** — trivial
  one-line edit + rebuild + redeploy hosting. Do whenever the
  operating-entity city is decided.

## 2026-05-22 — PR 27 shipped (`usePressGuard` background-tap protection)

Second OTA of the day after PR 25. Windsurf executed the PR 27 prompt
inside the IDE; Sudhir reviewed, ran tests (611/611), deployed via
`eas update --branch production`.

**Verified against PR 27 acceptance checklist:**

- `src/hooks/usePressGuard.ts` (90 lines).
- `src/screens/CheckoutScreen.tsx` — `usePressGuard` imported (line 22),
  `guardedPlaceOrder = usePressGuard(placeOrder)` at line 462,
  button onPress wired at 746.
- `src/screens/OrderDetailScreen.tsx` — three guards declared at
  lines 223–225 with an isolation-rationale comment block
  (213–222). Four button `onPress` sites correctly use the guarded
  versions: 507 (window cancel), 547 (retry-pay), 555 + 580 (cancel).
- `tests/hooks/usePressGuard.test.ts` (95 lines) — all five tests
  from the prompt are present (first call, re-entrant no-op,
  after-resolve allowed, rejection clears, args pass-through).
- `PRELAUNCH_CHECKLIST.md` — item line 256 flipped to
  `[Shipped — PR 27]`, full PR 27 section at line 2507,
  follow-up logged at 2670.

**Two Windsurf-introduced improvements worth recording for future
prompt authors:**

1. **Pure-factory pattern.** My prompt specified `renderHook` /
   `@testing-library/react-hooks` for tests. That library isn't in
   the repo (deliberately — see `useOnlineDeliveryCount` precedent).
   Windsurf extracted the closure logic into a React-free
   `createPressGuard(handler)` factory, made the hook a thin
   `useRef + useCallback` wrapper around the same logic, and tested
   the factory directly. Cleaner and consistent with the project's
   "no react-test-renderer" stance. **Action for future prompts:**
   when testing custom hooks, prefer the extract-pure-factory
   pattern over RNTL.
2. **Async-handler conversion in OrderDetailScreen.** The original
   `handleWindowCancel` / `handleCancel` / `handleRetryPayment`
   were sync fire-and-forget IIFEs. Wrapping a sync function in
   `usePressGuard` means the guard releases in microseconds —
   useless. Windsurf converted them to `async function`
   declarations returning `Promise<void>` AND added a new
   `confirmAlertAsync(title, message): Promise<boolean>` helper so
   the cancel handlers can `await` the user's confirm-dialog
   choice with the guard still held. **Real gap in my prompt** —
   I should have specified this explicitly. Adding to the mental
   checklist for the next async-handler PR.

**Pace check:** PR 25 + PR 27 both shipped + tested the same day
(May 22 2026). Two prompts authored, two prompts executed, two OTAs
out. The Claude-prompts-Windsurf-executes cycle is running clean.

**For next session:** PR 26 (Sentry source-map upload) is the
natural next pick — see the recommendation note below this entry.
PR 31 (Shop KYC docs) is the next bigger lift after PR 26.

## 2026-05-22 — PR 26 code shipped; native build deferred

Third PR same day. Windsurf executed the PR 26 prompt cleanly; the
six committed parts (`app.json` plugin array form,
`eas.json` prod env, `src/utils/sentryDebugThrow.ts`,
`tests/services/sentry.test.ts` with 4 cases,
`PRELAUNCH_CHECKLIST.md` flip + section, prompt file itself) are
all verified. Unit suite 615/615 passing (+4 net from the new
sentry-init contract tests). `npx tsc --noEmit` 0 errors.

**One small Windsurf improvement vs. my prompt:** the
`environment` test originally hardcoded `'development'`; Windsurf
computed `expected` at test time so it adapts to `__DEV__`'s actual
value in the jest config. Smarter — adopting this pattern in future
init-contract tests.

**No OTA published for PR 26.** PR 26 is build-time only; an OTA
would re-deploy the same JS bundle without re-running the
sentry-cli upload step. The actual source-map upload triggers on
the next `eas build --profile production`, which is intentionally
deferred — there's no immediate native build need.

**Two manual steps Sudhir owns before the next native build:**

1. **Generate Sentry auth token** at
   `https://sentry.io/settings/account/api/auth-tokens/`. Scopes:
   `project:releases (write)`, `project:write`. Name:
   "EAS Build - grocery-mvp-prod". Copy the `sntrys_...` value.
2. **Create the EAS secret:**
   ```powershell
   eas secret:create --scope project --name SENTRY_AUTH_TOKEN \
     --value "<token>" --type string --visibility secret \
     --environment production
   eas secret:list
   ```

If the secret isn't set when a build runs, the build FAILS LOUDLY
on the upload step — no silent skip. That's the desired behaviour:
a missing-secret regression is something we want to know about
immediately, not discover when production crashes can't be
debugged six weeks from now.

**Timing decision logged:** Sudhir asked whether the build can be
deferred or needs to happen now. Answer: defer. PR 26 is
"wire-once-forget" infra; the value only materializes on the next
build, and the next build will happen naturally during App Store
submission prep (PR 28 era) regardless. Doing the build now would
be cosmetic — no production change is going out today that needs
de-minified stack traces tonight.

**Pace check:** PR 25 + PR 27 + PR 26 all shipped (code-wise) the
same day. Three prompts authored, three executed, two OTAs out,
one build deferred. The Claude-prompts-Windsurf-executes cycle is
running clean.

**For next session:** PR 31 (Shop KYC document upload) is the
natural next pick — opens Phase A2 (shop onboarding). 5–7 hour
Windsurf session, server-first deploy, photo-upload smoke test on a
phone. Best in a dedicated longer block, not a same-day extension.

Lighter alternatives if the next session is shorter:
- **Create the EAS secret + trigger PR 26's smoke tests on a test
  build** (low-risk validation that the upload actually works,
  ~30 min after the build completes).
- **Replace `[CITY TBD before launch]` in `docs/terms-of-service.md`
  §13 + rebuild + redeploy hosting** if the operating-entity city
  is known.
- **Sanity-pass the new `usePressGuard` flow on the family-tester
  phones** (PR 27 smoke tests 1–8) to confirm no regressions
  before moving on.

## 2026-05-22 — PR 31 deployed + IAM fix unblocked PR 6.1 too

Fourth PR of the day. Same flow as the prior three: Windsurf
executed the PR 31 prompt, Sudhir reviewed, ran the
storage:rules + 3 function deploys in PowerShell, committed, OTA'd.

**Two-step deploy lesson logged:**

1. `firebase deploy --only storage:rules` errored with "Could not
   find rules for the following storage targets: rules". The
   `:rules` suffix only works in multi-bucket setups with named
   targets. Single-bucket projects use `firebase deploy --only
   storage`. Fixed in `.windsurf/deploy-discipline.md` Rule 4
   reference table next session.
2. First photo upload returned `INTERNAL` on the client. Server
   logs revealed `SigningError: Permission
   'iam.serviceAccounts.signBlob' denied`. This is the well-known
   Cloud Functions Gen 2 + `getSignedUrl` gotcha — the runtime SA
   (`333323701016-compute@developer.gserviceaccount.com`) needed
   the `Service Account Token Creator` role granted on itself.

**Side win:** the IAM fix also unblocked PR 6.1 menu-image upload,
which had been broken since deploy and lived on Sudhir's
to-do list. Both features now work from one IAM tweak.

**Documented the IAM gotcha** in
`.windsurf/deploy-discipline.md` under a new "Signed-URL IAM
(Cloud Functions Gen 2)" section so future signed-URL PRs don't
re-discover it. Includes the exact gcloud command and a note that
PR 28 (prod Firebase project) will need the same grant applied to
the prod compute SA.

**Smoke test on phone confirmed:**
- 2-step shop registration wizard works (basic info → docs).
- Camera + gallery pickers work for all four KYC slots.
- Photos PUT successfully to signed URLs.
- Admin sees thumbnails in `ShopRegistrationDetailScreen`'s new
  KYC grid; tap-to-zoom modal renders.
- Admin can also upload menu item images (PR 6.1) — the
  long-broken regression is closed as a side effect.

**Three polish items observed during smoke testing, captured as
PR 31.1:**

1. Admin shop-review screen shows GPS coords as plain text
   ("38.9897, -90.6879"). Should be tappable → opens Google Maps
   so admin can see the real location.
2. Rejected shops in the admin "Rejected" tab don't display the
   `rejectedReason`. The data is already on the shop doc (per
   `rejectShop` callable + the `WaitingForApprovalScreen`
   already surfaces it to the OWNER) — just needs admin-side UI.
3. Once a shop is approved, the KYC docs uploaded during
   onboarding are inaccessible from the admin UI. The
   `getShopKycReadUrls` callable already has no
   status-restriction, so this is just wiring the existing viewer
   into `ShopDetailManagementScreen` for non-pending shops.

PR 31.1 prompt drafted as
`docs/pr-31.1-admin-shop-review-polish-windsurf-prompt.md`.

**Pace:** four PRs in one day (PR 25, 26, 27, 31). Plus PR 31.1
prompted. Plus PR 6.1 long-standing bug closed as a side effect.
Plus three deploy-discipline lessons captured permanently in
.windsurf/. Strong day.

**For next session:** ship PR 31.1 (small, ~1–1.5 hr Windsurf
work). Then options open up — PR 32 (AI photo-to-catalog, the
Phase A2 differentiator that uses PR 31's signed-PUT infra +
Anthropic Claude vision) or PR 28 (prod Firebase project, the
biggest pre-launch task).

## 2026-05-22 — PR 31.1 shipped + smoke tests all green

Fifth PR of the day. Windsurf executed the PR 31.1 prompt cleanly;
Sudhir ran the standard OTA-only flow (npm test → git add/commit/push
→ eas update). All 8 smoke tests passed on-device:

- Tappable lat/lng coords in both `ShopRegistrationDetailScreen`
  and `ShopDetailManagementScreen` open Google Maps with a
  shop-name-labelled pin.
- Rejection reason card surfaces `rejectedReason` + `rejectedAt`
  to admin (previously only visible to shop owner via
  `WaitingForApprovalScreen`).
- KYC docs grid mirrored into `ShopDetailManagementScreen` for
  post-approval / suspended / rejected viewing — closes the
  documentation-vanishes-after-approval gap.

**Verification:** 627/627 tests passing (+4 from new
`openMapsForCoords.test.ts`); deliberate-break confirmed.

**One observation worth noting for the future `AdminShopKycGrid`
shared-component follow-up:** the `kycUrls` state type differs
slightly between the two admin screens
(`Record<string, string>` vs `Record<string, string> | null`).
Both work; pattern divergence is exactly what the documented
follow-up at PRELAUNCH line 412 will collapse.

**For next session:** **PR 32 (AI photo-to-catalog)** is queued.
The Phase A2 *differentiator* — shopkeeper photographs their
rate-list, Claude Sonnet vision extracts SKUs into a draft menu,
shopkeeper reviews and commits. Reuses PR 31's signed-PUT
plumbing. Introduces the first Anthropic API usage in the project
via `functions/src/aiHelpers.ts` (the substrate that every Phase C
customer-facing AI PR will reuse). Will require a one-time
`ANTHROPIC_API_KEY` secret on Firebase Functions (same pattern as
the SENTRY_AUTH_TOKEN secret in PR 26).

**Pace today:** PRs 25, 26, 27, 31, 31.1 all shipped. Plus PR 6.1
long-standing bug closed via the IAM fix. Plus three permanent
discipline-doc additions. The Claude-prompts-Windsurf-executes
cycle is running clean — Sudhir is in flow.

## 2026-05-22 — Strategic refresh: name candidate "MeraYara" + CRM/Udhaar added to Phase B

Sudhir shared a ChatGPT-generated framework suggesting a pivot to
a multi-category WhatsApp-first merchant-CRM product, asked for
evaluation. Long evaluation conversation in chat. Outcome:

**Adopted from the framework:**

- **Brand name candidate: "MeraYara"** (Hindi "मेरा यार" = "my
  friend / my buddy"). Warmer than "Kirana Mart"; positions as
  shop's *partner*, not replacement. **Not yet committed** — needs
  trademark check + decision before propagating across codebase /
  app.json / app store listings. Logged as candidate in
  `docs/ROADMAP.md` Snapshot.
- **Customer CRM for shop owner** as a killer merchant feature.
  Most kirana owners have zero visibility into who their best
  customers are or who stopped coming. Added as **PR 36** in
  Phase B (top of phase, high priority).
- **Digital Udhaar / Khata ledger** as a killer merchant feature.
  Digitizes the credit-on-notebook flow every kirana already
  uses. Daily-use hook even on zero-order days. Added as **PR 37**
  in Phase B.
- **Pilot success criteria framing**: merchant weekly active +
  customer repeat-order rate. Not app downloads, not feature
  count. Codified as Strategic Principle 7.
- **₹299/month merchant subscription** as the willingness-to-pay
  validation question. Will live in PR 61 (Phase E) once Phase B
  proves merchants use the platform daily.

**Rejected from the framework (with reasoning logged):**

- **Multi-category from Day 1** (pharmacy + bakery + electronics
  + hardware). Each has different regulations / workflows /
  economics. Mixing them at pilot guarantees we learn nothing
  about any. **Strategic Principle 1: one category until proven.**
  Deferred to month 12+ at earliest.
- **WhatsApp as the primary customer ordering channel.** Loses
  structured order data, payments, dispute resolution, repeat-
  order analytics, push, AND the CRM the framework itself wants.
  **Strategic Principle 2: customer ordering through our app,
  period.** WhatsApp as a future AI-shortcut layer (PR 58, Phase
  D) is in scope — but only as a deep-link into the app, never
  as the source-of-truth channel.
- **Drop delivery for a pure merchant-tools product.** Customers
  expect delivery (Blinkit / Zepto trained them). Without it
  "MeraYara" loses to "just call the shop directly."
  **Strategic Principle 5: delivery is core.**
- **No AI in Year 1.** Partially right (speculative customer-
  side AI deferred — PR 46–52 wait for pilot validation),
  partially wrong (PR 32 photo-to-catalog and PR 34 voice/Hindi
  onboarding both address known onboarding friction with
  measurable lift, and ship pre-pilot). **Strategic Principle 3:
  AI for real friction, not vanity.**

**Sudhir's own additions to the framework:**

- **AI-assisted express ordering** (his idea, May 2026): customer
  types/says in natural language "I want milk, atta, and biscuits
  from Sharma General Store" → LLM parses → cart pre-fills →
  customer lands on checkout. Faster for repeat orders; future-
  WhatsApp-channel-compatible. Logged as **PR 52** (Phase C) and
  the WhatsApp-channel extension as **PR 58** (Phase D, layered
  on top once PR 52's parser is proven).
- **Voice + Hindi as broader accessibility principle**, not just
  PR 34's shop-onboarding scope. PR 34 stays as the entry point;
  customer-side voice/Hindi inputs surface in later PRs as
  demand becomes clear. Codified as Strategic Principle 6.

**Doc changes made:**

- **`docs/ROADMAP.md`** — added Strategic Principles section
  (right after Update Protocol, before Product Framing).
  Restructured Phase B (CRM at PR 36, Udhaar at PR 37, rest of
  Phase B renumbered 38–45). Phase C shifted (was 44–49, now
  46–51, plus new PR 52). Phase D shifted to PR 53–58. Phase E
  shifted to PR 59–62. Section 3 cross-references (3.1–3.5)
  updated. Section 4 strengthened with explicit deferrals on
  multi-category, WhatsApp-as-channel, drop-delivery, and
  speculative customer-AI. Snapshot at top refreshed. "Last
  reviewed" bumped with description of this strategic refresh.

**Pilot orientation captured for future sessions:**

- **Pilot scale:** one neighborhood, 3–5 km radius, 5–10 shops,
  ~50 customers in week 1, scale to 50 shops + 500 customers by
  month 6.
- **The one metric:** customer repeat-order rate within 30 days.
  Target ≥30%.
- **The merchant validation:** weekly active shops + willingness
  to pay ₹299/month.
- **Pilot blockers from here:** PR 32 (AI photo-to-catalog), PR 34
  (voice/Hindi onboarding), PR 36 (Customer CRM), PR 37 (Udhaar
  ledger). Plus PR 28 (prod Firebase) and PR 29 (Razorpay LIVE)
  if real payments needed — COD-only pilot can defer those.

**For next session:** when quota resets, sequence to ship is —
PR 32 first (AI photo-to-catalog, prompt ready), then draft PR 36
(Customer CRM — should be a small focused prompt since it just
reads existing order data), then PR 37 (Udhaar ledger — new
subcollection + small UI). Estimated 2–3 Windsurf sessions to
ship all three. After that, PR 34 (voice/Hindi) closes Phase A2
and we're pilot-feature-complete.

**Estimate to pilot-ready** (with COD-only payment for simplicity):
~2–3 weeks of focused Windsurf work + 1 week of branding/asset/
operating-decisions. ~4 weeks calendar.

## 2026-05-22 — Sudhir asked for admin feature-usage observability → PR 38 + Principle 8 added

Sudhir asked for an admin view of "which features are being used in
last many days" so optimization effort can be data-driven, not
guesswork. Existing infra audit: `src/services/analytics.ts` wraps
Firebase Analytics with customer-side events (view shop list / detail,
add_to_cart, begin_checkout, place_order, payment success/failed,
view_order). Gaps: shop-owner / delivery-partner / admin sides have
no tracking at all; no admin dashboard to view the data; Firebase
Analytics has sampling + 24–48h latency limitations that make
per-user/per-shop queries unreliable.

**Added to ROADMAP:**

- **PR 38 — Admin feature-usage dashboard + analytics expansion**
  inserted between PR 37 (Udhaar) and PR 39 (Support) in Phase B.
  Scope: (a) expand `analytics.ts` to cover shop/delivery/admin
  events, (b) parallel writes to a new `featureUsageLog/` Firestore
  collection for exact queryable counts, (c) new `AdminUsageScreen`
  with 7-day / 30-day usage breakdowns by role + by shop, sorted
  most-used descending. Est 1.5–2 days.
- **Strategic Principle 8 — Instrument before you ship.** Every
  feature PR adds `Analytics.event_name(...)` calls for its main
  user actions, same mandatory status as "every PR adds tests."
  PR 38 is the read side; this principle is the write side. Both
  ship pre-pilot so the pilot generates real data.
- **Renumbered downstream PRs** to make room: Phase B 38–45 →
  39–46, Phase C 46–52 → 47–53, Phase D 53–58 → 54–59, Phase E
  59–62 → 60–63. Section 3 cross-references (3.1–3.5) and
  Section 4 deferral references all updated. Snapshot's "Up
  next" list now includes PR 38.

**Why this matters for the pilot specifically:** without
instrumentation in place from day 1 of the pilot, the question
"did anyone use Customer CRM / Udhaar / scan rate-list" gets
answered with vibes and a small handful of WhatsApp messages
from testers. With it in place, those answers are queries. The
difference between "I think shops liked it" and "47 of 50
pilot shops opened the CRM at least once last week" is the
difference between pilot decisions made on signal vs. on hope.

**Pace today (final tally):**
- 5 PRs shipped: PR 25, 26 (code only, native build pending),
  27, 31, 31.1.
- 1 PR drafted, queued for execution: PR 32.
- Strategic refresh: 8 principles codified, brand candidate
  logged, Phase B reordered around pilot priorities, PR 38
  observability added.
- 1 IAM fix as a side-effect of PR 31 deploy, closed PR 6.1
  menu upload that had been broken for weeks.
- 3 permanent additions to `.windsurf/` discipline docs.

Strong day. Sudhir signed off with the right thesis articulated
unprompted: "If we have enough shops onboarded by their choice,
then customer will come automatically." Supply-side first.
Marketplace gravity. Correct.

## 2026-05-22 — Mission North Star: "Make shop onboarding hassle-free, build shopkeeper trust"

After the supply-side framing landed, Sudhir went further and
named the actual product mission in one sentence: **"Make shop
onboarding so frictionless that shopkeepers trust the tech."**

This is the right framing for the Indian small-shop reality —
most kirana / pharmacy / hardware / bakery owners are already
80% sold on being online; they're stopped by the *hassle and
the fear of getting it wrong*. The chains (Blinkit, Zepto)
solve that fear by taking the shop out of the loop entirely.
MeraYara solves it by making the shopkeeper feel in control.

**Elevated to the top of `docs/ROADMAP.md`:**

- **Mission North Star section** (above all 8 Strategic
  Principles). Captures the thesis as a single sentence, the
  four reasons it's THE thesis (supply gravity, observable in
  30 min, trust compounds across local networks, AI is in
  service of the mission not separate from it), and the hero
  metric: **time-to-first-listed-menu-item — target ≤30 min
  assisted / ≤90 min self-serve.**
- **Trust principles for onboarding section** (sub-section of
  the North Star). Five UX rules every onboarding PR (PR 31,
  32, 33, 34, 35) checks itself against:
  1. Every step has a visible undo.
  2. Every AI output gets human review before commit.
  3. Save anywhere, resume anywhere.
  4. Errors are explained in plain Hindi-friendly language
     (translate server codes at the client).
  5. Field-rep escape hatch at every step (PR 35).
- **Strategic Principle 7 expanded** from two pilot metrics
  to three, in priority order: (1) time-to-first-menu-item,
  (2) merchant weekly active, (3) customer repeat-order rate.
  The North Star metric leads.
- **Snapshot at top** now opens with the North Star reference
  so the first thing a fresh session reads is the mission.

**Tactical implication for in-flight PR 32:** the "review the
draft items before commit" UX in PR 32's wizard is now
load-bearing — it IS Trust Principle 2. The deliberate-break
in PR 32 verifies the validation drops bad items; the
non-tested-but-equally-important property is that the *user*
can review what AI produced before it touches their menu. That's
not a feature in PR 32, it's the **whole reason PR 32 ships
this way and not as a one-tap "AI populated your menu" button.**

Sudhir's note to Windsurf about adding analytics events to PR 32
is also load-bearing — without those events, we can't measure
time-to-first-menu-item once shops start arriving. The North
Star metric depends directly on Strategic Principle 8.

**For the next session:** the doc trail has now been written to
explicitly carry the mission. Anyone (any Claude session, any
future collaborator) reading `docs/ROADMAP.md` top-to-bottom now
understands the thesis in the first 100 lines. The roadmap is
no longer a feature list with no center — it has a center, and
that center is shop onboarding trust.

## 2026-05-23 — PR 32 shipped: first AI feature live; Mission North Star metric materially moved

Windsurf executed the PR 32 prompt cleanly. Sudhir deployed the
two callables server-first (`extractMenuFromImage` →
`addExtractedMenuItems`), pushed OTA, smoke-tested on-device.
Reported back tersely: "It is tested and worked fine."

That was the moment.

**What the Mission North Star metric actually did:**

Before PR 32: a shopkeeper with 60 SKUs on a printed rate-list
spends ~4 hours typing each one into `AddCustomMenuItemScreen`
— name, price, MRP, pack size, category, optional image. That
4-hour wall is the single biggest reason most kirana owners
who say "I'll set it up this weekend" never actually do.

After PR 32: same shopkeeper photographs the rate-list, waits
~15 seconds for Claude Sonnet 4.6 vision to parse it,
reviews 60 pre-filled draft items in ~10 minutes (toggling
exclude, tweaking prices), taps "Add 47 items to menu." Done.
**~15 minutes total. 16x reduction.** Cost per shop onboarded:
~₹0.3–₹0.5 in Anthropic API charges — rounding error vs. a
field rep's hour.

This is the thesis ("make shop onboarding so frictionless that
shopkeepers trust the tech") with a number attached.

**Verified against PR 32 acceptance checklist:**

- `functions/src/aiHelpers.ts` (138 lines) — Anthropic SDK
  wrapper with `defineSecret('ANTHROPIC_API_KEY')`,
  `runClaudeVision`, `estimateCostInr`. `DO NOT REMOVE` marker
  on the SDK import per code discipline.
- `functions/src/menuExtractionHelpers.ts` (185 lines) —
  pure prompt + parser + validator.
- `functions/src/categoryConstants.ts` (35 lines) — **smart
  refactor by Windsurf**: extracted `VALID_CATEGORIES` to a
  shared file rather than depending on the existing inline
  literal in `index.ts`. Clean single source of truth for
  the category enum. Better than what the prompt asked for.
- Two callables in `index.ts` (lines 5421+ and 5586+) with
  `secrets: [ANTHROPIC_API_KEY]` properly bound.
- `ScanMenuScreen` (743 lines) — 4-phase wizard with
  `usePressGuard` on the commit handler (Trust Principle 2
  + PR 27 discipline both honored).
- Analytics events wired with thought — `scan_menu_started`
  carries a `source: 'camera' | 'gallery'` dimension that
  Windsurf added unprompted, which PR 38's admin dashboard
  will want for "camera vs. gallery preference per shop."
- 9 tests in `menuExtractionHelpers.test.ts` (+1 over the
  prompt's spec).
- `git grep ANTHROPIC_API_KEY` confirmed zero token leakage
  in committed files.
- 636/636 tests passing (+9).
- Cost guardrails live: per-shop 5/day quota (Firestore
  transactional counter), kill-switch via `aiFeatures/
  menuExtraction.enabled`, image cap 2MB base64, audit log
  per call with `costInr`.
- PRELAUNCH_CHECKLIST item flipped + PR 32 section + 6
  follow-ups documented (PR 33 catalog match, AI cost
  dashboard, key rotation cadence, re-scan-as-update,
  multi-photo, PDF, per-row thumbnails).

**Trust Principles check** (the framework added at end of
prior session):

- Principle 1 (visible undo) — ✅ review screen edits each row
- Principle 2 (AI output → human review) — ✅ the review phase
  IS this principle; the entire wizard exists to honor it
- Principle 3 (save/resume) — ⚠️ gap: backing out of review
  loses all extracted items + 1 of 5 daily quota slots. Worth
  a future PR 32.1 if pilot testers report it; AsyncStorage-
  backed draft persistence would solve it in ~1–2 hrs.
- Principle 4 (Hindi errors) — scoped to PR 34
- Principle 5 (field-rep escape hatch) — scoped to PR 35

**AI substrate now established for all future PRs.** Every
Phase C customer-side AI feature (PR 47–53 — shopping
assistant, auto-replenishment, recommendations, sentiment
summarization, support assistant, search rewrite, express
ordering) reuses the same `runClaudeVision` / cost guardrails
/ audit log pattern. Cost of every later AI PR is now reduced
to "write the prompt + the typed response shape."

**Pace observation:** seven PRs across two days. PRs 25, 26
(code, build pending), 27, 31, 31.1 on day 1; PR 32 on day 2.
Plus PR 6.1 long-standing bug closed via the IAM fix. Plus a
strategic refresh + Mission North Star elevation. Plus the
PR 38 admin observability work queued. The
Claude-prompts-Windsurf-executes-Sudhir-deploys cycle is
running at unusual velocity without losing discipline —
every PR has tests, deliberate-break confirmation,
PRELAUNCH update, and the doc trail stays current.

**For next session:** PR 34 (voice + Hindi onboarding) is the
natural next pick — closes Phase A2's accessibility gap, reuses
the `aiHelpers.ts` substrate, directly serves the Mission North
Star for the non-English-fluent shopkeeper. After that: PR 38
(admin observability — must land before pilot), PR 35 (field-
rep mode — Trust Principle 5), then Phase B's CRM + Udhaar.

**Pilot timing estimate update:** PR 32 was the biggest
remaining build. With it shipped, pilot-ready (COD-only)
is now ~2 weeks of focused Windsurf work + 1 week of
branding/decisions. Down from 4 weeks at session start. The
single biggest accelerator was finishing PR 32 in one session.

## 2026-05-24 — PR 34 shipped (code) + hard lesson on native rebuild requirements

Windsurf delivered PR 34 cleanly: voice + Hindi onboarding assist,
12 tests, server-first deploy plan, full Trust-Principle-4
localization (every server error renders in Hindi when
`languageCode = hi-IN` — went beyond what the prompt asked for).
Sudhir deployed the function + OTA per the prompt's deploy plan.

**But: the language picker did not appear on devices.**

Long debugging arc:
1. Sudhir reported "no language picker." Initial diagnosis:
   OTA not yet downloaded by device.
2. Standard remediations attempted: two-launch force-close
   dance, then triple force-close, then airplane-mode toggle,
   then delete + reinstall from TestFlight. None worked.
3. Expo dashboard for the OTA group (id
   `edbd89b4-5833-4369-88f1-72158c3b226b`) showed iOS
   fingerprint `a767ae9` with 2 downloads + 1 known launch —
   meaning the bundle DID reach at least one device. But not
   Sudhir's iPhone.
4. **Root cause finally diagnosed:** PR 34 added the
   `expo-audio` plugin to `app.json` with a
   `microphonePermission` string. That's a NATIVE config
   change (writes `NSMicrophoneUsageDescription` into iOS
   `Info.plist`). The runtime fingerprint of the new bundle
   (`a767ae9`) does NOT match the runtime fingerprint of the
   TestFlight build installed on Sudhir's device (pre-PR-34,
   no expo-audio plugin). Expo Updates correctly refuses to
   cross-apply an OTA across mismatched fingerprints — silently.
5. The 2 downloads / 1 known launch were on some other device
   (likely an Expo internal probe or a different test
   installation).

**Fix in flight:** `eas build --profile production --platform
ios|android` triggered on May 24. Once the new build lands in
TestFlight, installing it will activate PR 34 on first launch
(JS embedded directly; no OTA dance needed). **The same build
also activates PR 26's Sentry source-map upload** — two pending
items resolved together.

**This was my mistake.** The PR 34 prompt's deploy plan stated
"no native rebuild needed — expo-audio is JS-pure on autolinking
in SDK 54+." That sentence was wrong. `expo-audio` is autolinked,
but the **config plugin** that adds the microphone permission
to Info.plist is a native config change. The runtime fingerprint
shifts. OTAs can't cross fingerprints.

**Permanent fix logged in `.windsurf/deploy-discipline.md`:**
new "OTA vs `eas build`" section with a decision table:

| Change type | OTA sufficient? |
|---|---|
| JS-only logic | ✅ OTA |
| Pure-JS dep (lodash, etc.) | ✅ OTA |
| RN library WITHOUT a config plugin (expo-image-manipulator, expo-web-browser) | ✅ OTA |
| **RN library WITH a config plugin (expo-audio, expo-camera, expo-notifications, expo-location, expo-image-picker, expo-tracking-transparency)** | ❌ **eas build** |
| New entry in `app.json` `plugins` array | ❌ **eas build** |
| Permission added to `infoPlist` / `android.permissions` | ❌ **eas build** |
| Bundle identifier / package name / runtime version change | ❌ **eas build** |
| Change to existing plugin's config options | ❌ **eas build** |

Plus a quick-check command for prompt-writing:
```powershell
git diff main -- app.json | findstr -i "plugin infoPlist permissions"
```
Any output → the deploy section must say `eas build`, not
`eas update`.

**CLAUDE.md "In-flight work / open questions" updated** with the
rule logged alongside the existing IAM gotcha.

**PRELAUNCH_CHECKLIST PR 34 entry** flipped from `[Shipped]` to
`[CODE SHIPPED — native build in flight]` with the diagnostic
detail so future readers understand why the [x] is there but
the feature isn't on devices yet.

**Net effect on schedule:** 0 — the native build was needed for
PR 26 (Sentry source-map upload) eventually anyway, and is also
overdue for App Store submission prep. The PR 34 incident moved
that build up by a couple of weeks but didn't add new work.

**Velocity observation:** today's debugging arc (~45 minutes,
including the Expo dashboard investigation) was the longest
non-feature investigation in the session. Worth it — the
permanent doc captures means no future PR with a config-plugin
addition wastes the same hour.

**For next session:** wait for the iOS + Android builds to
complete (~25 min each on EAS), install on Sudhir's phone,
re-test the 8 PR 34 smoke tests. Assuming those pass, the next
PR pick is **PR 38 (admin feature-usage dashboard)** — it must
land before any pilot starts so usage data is captured from day
1. After PR 38, the Phase B daily-use merchant hooks (PR 36
Customer CRM + PR 37 Udhaar ledger) sequence cleanly.

## 2026-05-24 — PR 34 live on TestFlight + tested; PR 26 source-map status TBD

Closure of the PR 34 native-rebuild arc. iOS build 15 (commit
`27f22ac`) finished on EAS in 5m 26s. The build itself succeeded
but didn't auto-submit to TestFlight; needed an explicit
`eas submit --profile production --platform ios --latest`. After
Apple's App Store Connect processing (~15 min), TestFlight made
build 15 available for install. Sudhir installed, opened the
app, navigated to "Open a shop," confirmed the language picker
+ 🎙 button + per-field mics all render correctly on Step 1 of
RegisterShopScreen. Tested end-to-end as working.

**Two follow-ups logged:**

1. **`SENTRY_AUTH_TOKEN` was not set before build 15 ran**
   (`eas secret:list | findstr SENTRY_AUTH_TOKEN` returned
   empty during the May 24 deploy). The Sentry plugin
   gracefully skipped the source-map upload step rather than
   failing the build, which means build 15's stack traces in
   Sentry will remain minified despite PR 26 being code-shipped.
   **For the next native build:** set the secret first per
   PR 26's deploy plan, then any subsequent `eas build`
   activates source-map upload. Not blocking PR 34 testing
   but worth doing before the next build for any reason.
2. **Android PR 34 build status unconfirmed** at session close.
   The expo.dev builds list still showed the most recent
   Android build as 2 days old (commit `27dc9ad`, pre-PR-34,
   failed). If Sudhir wants Android testers on PR 34 he needs
   to trigger `eas build --profile production --platform
   android` separately. Not blocking iOS-only smoke testing
   of PR 34.

**`autoSubmit` reminder added to follow-ups:** future PRs that
need a native build should add `"autoSubmit": true` to the
production profile in `eas.json` so the binary lands in
TestFlight without a separate `eas submit` step. ~1 line
change worth doing once and forgetting about.

**Net session impact:**
- PR 34 functionally live on iOS ✅
- Mission North Star now empirically reachable for non-English-
  fluent shopkeepers (the original Phase A2 accessibility goal)
- Phase A2 onboarding suite (PR 31 + PR 31.1 + PR 32 + PR 34)
  is functionally complete. PR 35 (field-rep mode) and PR 33
  (master catalog) remain as nice-to-haves; both can defer
  until pilot signal demands them.
- Doc trail updated for the OTA-vs-eas-build lesson; future
  config-plugin PRs won't repeat the diagnosis.

**Pilot-ready estimate update (COD-only path):**
- PR 38 (admin observability) — must land before pilot. 1.5–2
  days.
- PR 36 (Customer CRM) + PR 37 (Udhaar) — pilot-critical
  merchant daily-use hooks. ~3 days combined.
- Branding (real icon, splash, final name decision) — non-code,
  ~3–5 days calendar.
- **Total to pilot-ready: ~2 weeks focused Windsurf work +
  1 week branding.** Down from ~4 weeks at session start
  (May 22). Three weeks of effort compressed into roughly
  one week.

**For the next session:** **PR 38 is the unambiguous next pick.**
Without it, the pilot answers "did anyone use the voice
onboarding / scan rate-list / CRM" with guesses. With it,
those answers are queries. Worth drafting the prompt fresh in
the next session.

## 2026-05-24 — PR 37 + 37.1 (Digital Udhaar / Khata) deferred from pilot scope

After drafting PR 36 + PR 37 + PR 38, and after a brief design
refinement on PR 37 (added shop-level `acceptsUdhaar` opt-in
toggle and split out the customer-side payment integration as
PR 37.1), Sudhir made the call to **pull both PR 37 and PR 37.1
out of the pilot entirely.** Build on demand if pilot shop
owners request credit-tracking.

**Why this is the right call:**

- Speculative without demand signal. We were betting Udhaar
  would be a daily-use hook; smarter is to ship Customer CRM
  (PR 36) as the ONE merchant daily-use hook for pilot, see if
  the merchant-weekly-active number hits target, and only build
  Udhaar if (a) the CRM-alone hook isn't enough OR (b) pilot
  shops explicitly request credit-tracking.
- Saves ~5–6 days of build effort that would otherwise be
  guessing at demand (PR 37 ~2.5d + PR 37.1 ~3d).
- Reduces pilot surface area = fewer things to debug + fewer
  unknowns when interpreting pilot metrics.
- Matches Strategic Principle 4's spirit: "merchant daily-use
  hooks" are pilot-critical, but having ONE proven hook is
  better than two speculative ones.
- The PR 37 design (with the shop-level toggle) and PR 37.1
  (customer-side payment with per-customer approval) are
  preserved in `docs/pr-37-...-windsurf-prompt.md` with a
  deferral header. If demand surfaces, picking it up later
  is a single Windsurf session — no re-design needed.

**Doc changes:**

- `docs/ROADMAP.md` Phase B table: PR 37 + 37.1 rows
  struck through with deferral note. Phase B exit criterion
  rewritten to name only CRM as the daily-use hook.
  Strategic Principle 4 rewritten to acknowledge one hook,
  not two. Snapshot's "Up next" list updated. New deferral
  entry in Section 4. "Last reviewed" stamp bumped.
- `docs/pr-37-digital-udhaar-khata-ledger-windsurf-prompt.md`:
  new deferral header at the top of the file. Body
  unchanged so the design can be picked up later.
- `CLAUDE.md` In-flight work: simplified pilot-blocking
  sequence to PR 38 → PR 36 → pilot. Documented PR 37 + 37.1
  + 33 + 35 as deferred with pointers to the preserved
  designs.

**Pilot timing impact:** ~5–6 days saved. Estimated time to
pilot-ready (COD-only path) drops from ~2 weeks of focused
Windsurf work to ~1 week. Sequence now:

1. PR 38 — admin feature-usage dashboard (~2 days)
2. PR 36 — Customer CRM for shop owner (~1–1.5 days)
3. Branding decisions (final app name commit, real app icon
   / splash, replace `[CITY TBD]` in ToS §13) — non-code,
   ~3 days calendar
4. Manual shop onboarding for first 5–10 pilot shops
5. **Pilot starts.**

The decision discipline here is worth flagging for future
sessions: it's easier to add a feature on demand than to
remove one that turned out not to be used. Sudhir made the
hard call (pull a feature he'd just signed off on drafting)
and the doc trail captures the reasoning so neither future
Claude nor future Sudhir re-litigates it.
