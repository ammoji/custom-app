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

## 2026-05-24 — PR 38 shipped + PR 38.1 hotfix (second hit of the PR 6.1 problem)

PR 38 (admin feature-usage dashboard) shipped end-to-end:
~22 new analytics events wired across shop/delivery/admin
surfaces, parallel writes to a new `featureUsageLog/`
Firestore collection, `AdminUsageScreen` with 7d/30d breakdowns.
Code 658/658 tests passing + 92/92 rules tests, deliberate-
break confirmed, deploy clean.

Then on smoke testing: **the Feature Usage tile threw
"Missing or insufficient permissions" on tap**, and the
`featureUsageLog/` collection was completely empty in
Firestore despite users having triggered dozens of analytics
events.

**Root cause:** PR 38 used the Web SDK Firestore
(`firebase/firestore`) for both writes (analytics.ts
`writeFeatureUsageLog`) and reads (AdminUsageScreen
`getDocs`). On native, the Web SDK Firestore cannot see the
`@react-native-firebase/auth` session — `request.auth` is
null from its perspective, even though the user is signed
in. Rules require `request.auth != null`. Result: writes
silently failed (caught in the try/catch as `console.warn`,
no Sentry events), reads hard-failed with the visible
permission error.

**This was the exact same root cause as PR 6.1** (signed-PUT
URLs to fix native Storage uploads). Same SDK-auth-context
mismatch, just on a different Firebase product (Firestore
instead of Storage). I (Claude) had drafted PR 38's deploy
plan assuming direct client → Firestore writes would work —
a real prompt-writing miss for the second time.

**Diagnosis time:** ~10 minutes including reading the actual
shipped code in `analytics.ts` + the rules. The "Missing or
insufficient permissions" error on the read side was the
smoking gun — confirmed the same auth-context issue without
needing to dig through Cloud Logging.

**Fix — PR 38.1 (~1.5–2 hours of Windsurf work):**

- Two new callables in `functions/src/index.ts` lines
  6085–6211:
  - `logFeatureUsageEvent` — server-side write, auth-gated
    (silent skip for unauth), resolves uid/role from
    `request.auth.token`, validates feature name, writes
    via Admin SDK.
  - `queryFeatureUsageLog` — admin-only read, returns
    events array + truncated flag.
- `firestore.rules` line 240 tightened to
  `allow read, write: if false` (server-mediated only,
  matching `razorpayWebhookEvents`/`aiAuditLog` posture).
- `orderService.ts` got the two new web/native dispatch
  wrappers.
- `analytics.ts` `writeFeatureUsageLog` rewritten to call
  the callable; removed addDoc/collection/serverTimestamp/db
  imports + the now-unused currentRole helper.
- `AdminUsageScreen.tsx` `getDocs` replaced with
  `orderService.queryFeatureUsageLog`; firebase/firestore
  imports removed.
- Rules tests flipped posture (16 → 12 tests, all expecting
  `deny` for any direct client op). Deliberate-break
  confirmed.
- New permanent rule in `.windsurf/deploy-discipline.md`:
  **"Web SDK Firestore + RNFB auth — the silent-failure
  trap."** Includes a decision rule for prompt-writing:
  any direct Firestore op from RN client on an
  authenticated collection must go through a callable.

**Sudhir's request for navigation discipline:** during the
debugging arc, Sudhir asked me to always include explicit
navigation steps (URLs, menu paths, CLI commands) when I
ask him to check something. Committed to that as a standing
rule going forward. Every diagnostic ask from now on gets
exact navigation.

**Permanent lessons codified:**

- `.windsurf/deploy-discipline.md` now has TWO instances of
  the Web-SDK-vs-RNFB-auth pattern documented (Storage via
  PR 6.1, Firestore via PR 38.1). The new section explicitly
  flags this as a prompt-writing check.
- The mistake came from me, not Windsurf — PR 38's prompt
  said "direct from client" without applying the discipline
  doc's existing PR 6.1 lesson. Fixed in the prompt-writing
  process going forward: any prompt proposing direct
  Firestore/Storage from client gets a callable check first.

**Pilot status after PR 38 + 38.1:**

- PR 32 (AI photo-to-catalog) ✅
- PR 34 (voice + Hindi) ✅
- PR 38 + 38.1 (admin observability) ✅
- PR 36 (Customer CRM) — **the only remaining pilot-blocking
  PR**. ~1–1.5 days.

After PR 36 ships + smoke-tests:
1. Branding decisions (final app name, real app icon/splash,
   replace `[CITY TBD]` in ToS §13) — non-code, ~3–5 days
   calendar
2. Manual onboarding for first 5–10 pilot shops
3. **Pilot starts.**

Pace observation: PR 38 + 38.1 same-day shipping is a strong
example of the cross-check pattern working — Windsurf
executed the original PR with the bug, smoke testing
surfaced the bug immediately, the diagnostic was fast
because the discipline-doc lessons made the pattern
recognizable, and the fix shipped in under 2 hours of
incremental Windsurf work. Total elapsed: original PR 38
ship → bug discovered → PR 38.1 prompt drafted → PR 38.1
shipped → all on the same day. The doc trail captured the
why so the next direct-Firestore-from-client PR won't repeat.

## 2026-05-24 — Pre-pilot UX cross-check (5 observations from real testing)

Mid-session while Windsurf was developing PR 36, Sudhir
shared 5 observations from real-device testing of PR 31 +
PR 32 + PR 34 + PR 38.1, asking which should land before
pilot, which should defer, which shouldn't ship at all.
Honest evaluation:

| # | Observation | Verdict | Roadmap home |
|---|---|---|---|
| 1 | Shop-side status change 4–5s delay | Fix pre-pilot — diagnose first (likely Cloud Functions cold start, not code) | **PR 36.1 Part 1** |
| 2 | Show countdown timer alongside absolute pickup time | Ship pre-pilot — small win, ~2–3 hrs | **PR 36.1 Part 2** |
| 3 | Separate shop vs delivery ratings (currently single per-order) | Defer to Phase B post-pilot — pilot scale of ~150 ratings/month doesn't need the split yet | **PR 42.1** (new Phase B entry) |
| 4 | "Favorites only" filter on shop list (favorites already exist per PR 19; just no filter pill) | Ship pre-pilot — ~1 hr | **PR 36.1 Part 3** |
| 5 | Smart substitution: AI "best match" + real-time customer approval | Defer to Phase C — multi-day, customer-side AI per Strategic Principle 3 waits for pilot signal | **PR 53.1** (new Phase C entry) |

**Verified during evaluation:** PR 19 favorites exist (Home
tile, FavoritesScreen) but ShopListScreen / SearchScreen
don't reference favorites at all — the filter pill genuinely
is missing. Confirmed via `grep favorite src/screens/ShopListScreen.tsx`.

**On the 4–5s delay specifically:** I checked
`useShopOrderDetail.ts` and the optimistic UI is already
implemented (line 178–181: `setState(prev => ({...prev, order:
applyOptimisticStatus(prev.order, newStatus)}))`). So the
order chip flips synchronously on tap. If the user is seeing
a 4–5s delay, it's likely the *button row* lagging, not the
chip — most plausible cause is Cloud Functions Gen 2 cold
start on `updateOrderStatus` (2–3s the first call after
~15min idle, sub-second subsequently). **Quick diagnostic
described in PR 36.1's prompt-to-be:** tap one status
transition, immediately tap another → if the second is fast,
it's cold start; mitigation is `minInstances: 1` on
`updateOrderStatus` (and on `addKhataTransaction` if/when
PR 37 comes out of deferral) at ~$5/mo per warm instance.
If both are slow, it's a render bug and we look elsewhere.

**Roadmap additions logged:**

- **PR 36.1 — pilot UX polish bundle.** Sits in the "Up
  next" list of the Snapshot, immediately after PR 36.
  Three parts: status-delay fix (after diagnosis),
  countdown timer, favorites filter. ~4–6 hrs. OTA-eligible
  (assuming `minInstances` change doesn't require redeploy
  + native build — `minInstances` is a function-config
  change that propagates via `firebase deploy --only
  functions:<name>`, no native impact).
- **PR 42.1 — separate shop + delivery ratings.** New Phase B
  entry inserted after PR 42 (shop substitution UI) since
  both touch the post-delivery feedback surface. 1 day.
  Deferred from pilot.
- **PR 53.1 — smart substitution with real-time approval.**
  New Phase C entry inserted after PR 53 (AI-assisted
  express ordering) since both are AI shopping-experience
  features. 2–3 days. Deferred — customer-side AI per
  Strategic Principle 3.

**Sudhir's rule for this session:** PR 36.1 starts only
after PR 36 is tested and pushed. Don't queue PRs
simultaneously while Windsurf is mid-flight — too much
context juggling, and PR 36.1 needs the diagnostic outcome
from #1 before its prompt can be drafted precisely.

**For next session, when PR 36 ships:** run the on-device
diagnostic for #1 (tap-then-tap-again pattern), confirm
whether it's cold start or render bug, and Claude drafts
PR 36.1 with the right fix path. Then ship PR 36.1.
After that, the development side of pilot-readiness is
done — remaining items are non-code (branding, city,
manual shop onboarding).

## 2026-05-24 — PR 36 shipped + tested; PR 36.1 drafted (cold-start fix deferred)

PR 36 shipped clean. Windsurf delivered the Customer CRM with
one notable correction: my prompt drafted helpers against
`userId` + `address`; actual order docs use `customerUid` +
`deliveryAddress`. Windsurf verified against source, fixed
throughout, added a provenance note in the helper header.
**That's the cross-check pattern catching exactly what it's
designed to catch** — Claude writes prompts with assumptions,
Windsurf verifies, mismatches surface before they ship.
Lesson for me: any prompt touching existing data structures
gets a `Grep` for actual field names first. ~2 min/prompt,
eliminates this class of correction work.

Smoke tests passed:
- Customer CRM loads with the 3 tabs × 3 periods, top
  customer matches Sudhir's mental model, tap-to-call works
- `featureUsageLog/` collection received the new
  `shop_customers_viewed` events via PR 38.1's callable
  routing — full end-to-end Strategic Principle 8 chain
  confirmed working

**Cold-start diagnostic (PR 36.1 Part 1):** Sudhir ran the
tap-then-tap-again sequence. First tap = 1 s, second tap
= 1 s. **Confirmed Cloud Functions Gen 2 cold-start** as the
cause of the original 4–5 s observation (functions go cold
after ~15 min idle; first tap triggers cold-start
provisioning).

**Sudhir's call on the fix:** declined `minInstances: 1`
config (~₹400/mo per warm function × ~5 functions = ~₹2000/mo)
per pilot-cost-conservative stance. Accept the 2–3× daily
cold-start hit during pilot (shop owner pattern is morning
rush warm → afternoon lull cold → evening rush warm).
Revisit post-pilot if it surfaces as real friction.

**PR 36.1 drafted with 2 parts only** (Part 1 dropped):
- Part 1 (was 2): Countdown timer alongside absolute pickup
  time on customer-side OrderDetailScreen. "Ready in 22
  minutes (by 7:30 PM)" two-line display, ticks every 60 s
  via `setInterval`. New pure helper
  `src/utils/formatRelativeTime.ts` with 9 unit tests.
- Part 2 (was 3): "Favorites only" filter pill on
  ShopListScreen (and SearchScreen if applicable). Reads
  from existing PR 19 `profile.favorites`. Empty state for
  "no favorites yet" with friendly CTA.
- 2 analytics events
  (`customer_pickup_countdown_viewed`,
  `customer_favorites_filter_toggled`) auto-mirroring to
  `featureUsageLog/` via PR 38.1 routing.

~3 hr Windsurf work. OTA-only deploy. No native, no Cloud
Function changes, no rules changes.

**After PR 36.1 ships clean: development side of pilot-
readiness is DONE.** Remaining items are non-code:

- Final app-name commit (MeraYara or alternative)
- Real branding artwork (icon, splash, adaptive icon)
- `[CITY TBD before launch]` replacement in ToS §13
- Manual onboarding of first 5–10 pilot shops
- Pilot launch

**Schedule-to-pilot estimate:** ~3 hr Windsurf for PR 36.1 +
~3–5 days calendar for branding + city + onboarding =
**pilot-ready in ~1 week from now.**

## 2026-05-26 — PR 39 rebrand to HamaraSetu + Contact Support row

Pilot data was wiped clean via PR 36.2's `reset-pilot-data`
script. First-run hit the "admin not auto-detected" failure
mode — `users/{uid}.isAdmin: true` mirror field wasn't on
Sudhir's admin doc (his admin account predated `set-admin.ts`
writing that mirror). Solved two ways: pass
`--admin-uid=<uid>` once now (Sudhir's UID from Firebase
Console → Authentication → Users), and re-run
`scripts/set-admin.ts <uid>` so the Firestore mirror is in
place and future resets auto-detect with no flag. Logged
because the same trap will hit any new admin set up before
PR 31.1's mirror-write landed.

Also verified the shop-location filter question Sudhir
raised: `src/services/shopService.ts:17` already has
`SHOW_ALL_SHOPS = true` (set in PR 10 specifically for
multi-city test phase). Server `listShopsPublic` only
filters `status == 'active'` — no distance filter on the
backend either. `rankShopsByDistance` sorts but doesn't
exclude. Confirmed: every customer sees every active shop
during pilot. Flip-back point documented in
`PRELAUNCH_CHECKLIST` for real-customer launch when shops
are dense enough in one city.

**Pilot launch direction — branding decisions.** Sudhir
locked the app name **HamaraSetu** (हमारा सेतु — "Our
Bridge"). Domains booked. Operating entity locked as
**Sara Stack Labs** (Ballabgarh, Faridabad district,
Haryana). Legal jurisdiction in privacy/terms §13 = "courts
at Faridabad, Haryana." Tagline iterated four times in one
session:
1. "Bringing Local Online" — mission/company voice
2. "Everything You Need, Instantly" — Zepto-style, rejected
   (over-promises speed kirana ops can't always hit)
3. "Your Local Market, Online" — Claude's recommendation,
   accepted briefly
4. **"Shop Smart, Shop Local"** — final lock. Imperative
   structure, parallel form, mission-aligned via "local"
   without making a delivery-time promise.

**Email switch held back.** Original plan was to flip
contact email + Apple Developer + Firebase / EAS / Razorpay
/ Sentry ownership to professional `sarastacklabs@gmail.com`.
Sudhir killed that scope: switching account ownership during
pilot is multi-week migration risk for zero pilot benefit.
`sarastacklabs@gmail.com` stays as the support address,
Apple Dev account, etc. through pilot. Bundle IDs also
stay (`com.sudhirdavim.grocerymvp`) — bundle ID is invisible
to users; display name is what they see. Both migrations
deferred to post-pilot, pre-public-launch.

**PR 39 drafted + shipped same day.** Single source of
truth at `src/constants/branding.ts` (9 exports including
`APP_NAME_DEVANAGARI` for future bilingual treatment).
Touched: app.json (display name + 7 permission strings),
3 client screens (HomeScreen, BecomeDeliveryPartnerScreen,
LoginScreen — new brand block above the Sign in header
with `APP_NAME` + `TAGLINE`), new utility
`src/utils/openSupport.ts` (mailto with platform diagnostic
in body), ProfileScreen got a new "Help & Support" section
above the existing "Legal" section, legal docs
(privacy-policy + terms-of-service) rebrand + Sara Stack
Labs + §13 jurisdiction fill-in, `build-legal-html.ts`
titles, voice helper LLM example switched from "Sharma
Kirana Mart" → "Sharma Kirana Store" so the AI doesn't see
the old brand on every Hindi onboarding call. **Did NOT
touch:** eas.json appleId, bundle IDs, Expo slug, Sentry
org/project, Firebase project, asset images
(icon/splash/adaptive — those are PR 40 visual identity
work), theme colors.

**Verification on ship:** `npx tsc --noEmit` clean, full
`npm test` 722/722 across 72 suites, `npm run build-legal`
regenerated `dist/privacy.html` + `dist/terms.html`,
`branding.ts` confirms `TAGLINE = 'Shop Smart, Shop Local'`
and `LEGAL_JURISDICTION = 'Faridabad, Haryana'`, zero
"Kirana Mart" references remain in `src/`.

**Three Windsurf quality moves worth flagging** (a
recurring pattern — Windsurf catches things Claude's
prompt missed):
1. Added `tests/constants/**/*.test.ts` to `testMatch` in
   `tests/jest.unit.config.js`. Without this the new
   `branding.test.ts` pin would have been silently
   undiscovered and the constants could drift without
   tripping CI.
2. Appended PRELAUNCH_CHECKLIST section 7457–7564 with 7
   completed items + 5 follow-ups (smoke tests, hosting
   deploy, store metadata, Hindi tagline, in-app support
   form).
3. Made the voice helper LLM-prompt example fully consistent
   with the rebrand — small touch but it means the Claude
   call running on every Hindi voice onboarding session
   stops seeing "Kirana Mart" in its system prompt.

**Deploy state at end of session — three actions still
required by Sudhir:**
1. `eas build --profile production --platform all` —
   native rebuild required (permission strings = runtime
   fingerprint change; OTA cannot apply per the rule logged
   from PR 34). Will auto-increment 15 → 16. Confirm
   `SENTRY_AUTH_TOKEN` EAS secret is set first so PR 26
   source-map upload finally activates this time.
2. `eas submit --profile production --platform ios --latest`
   after iOS build finishes.
3. `firebase deploy --only hosting` to publish the
   regenerated `/privacy` + `/terms` pages with HamaraSetu +
   Faridabad jurisdiction.

After build 16 lands on TestFlight, run the 10-step smoke
acceptance from `docs/pr-39-rebrand-hamarasetu-windsurf-prompt.md`.

**Adjacent: created `docs/UI_DESIGN_BRIEF.md`.** Self-
contained brief for design tools (Figma AI, Galileo, Uizard,
v0) — 9 sections covering pitch, personas, brand attributes,
information architecture, 37-screen inventory grouped by
role, 6 hero flows, component-system starter list, design
constraints. Updated through the session as name and tagline
locked. Pasteable into any design tool for visual-identity
exploration ahead of PR 40.

**Pilot-readiness state after PR 39 deploy lands:**
- Dev side: PR 36.1 (last pilot-blocking dev PR) is live
  from earlier; PR 39 is final brand-lock.
- Visual identity: PR 40 (logo / icon / splash / warm accent
  / Devanagari font) is the next pilot-prep PR. Not strictly
  blocking but materially affects first-impression quality.
- Non-code remaining: real branding artwork (PR 40 will need
  this), manual onboarding of first 5–10 pilot shops.

## 2026-05-26 — PR 39.1 logo swap (same session as PR 39)

Logo finalized late evening (Sudhir's time). Uploaded master at
`uploads/HamareSetuLogo.jpeg` — 1280×780 JPEG, blue-to-green
gradient shopping-bag with H symbol that doubles as a cart, wrapped
in a circular arc (the *setu* / bridge motif), with HAMARASETU
wordmark in blue-green split + "Shop Smart. Shop Local." tagline,
all on white bg.

Decisions locked via AskUserQuestion: splash bg follows logo's
own bg (white), logo is symbol + wordmark together (single file),
piggyback as fresh build 17 (cancel/skip the build 16 cycle —
rolls PR 39 strings + logo artwork into one native rebuild).

Generation done in the Cowork sandbox via Python PIL. First pass
had a sizing bug (`thumbnail` won't upscale a 482px source into
1024px canvas, so the icon looked small on white). Fixed with
`resize` (proper bilinear up-scale). Second pass: clean.

Six variants generated and installed to `assets/images/`:
- `icon.png` (1024², symbol-only square crop on white, ~88% fill —
  Apple HIG margin-friendly)
- `splash-icon.png` (512², full logo with wordmark + tagline,
  transparent bg)
- `android-icon-foreground.png` (1024², symbol at ~70% safe zone,
  transparent bg — Android's circular mask doesn't clip the mark)
- `android-icon-background.png` (1024², solid white)
- `android-icon-monochrome.png` (1024², grey silhouette of symbol
  in transparent canvas — for Android themed icons mode)
- `favicon.png` (48², symbol on white)

Old files preserved at `assets/images/.archive-pre-pr40/` in case
of revert.

`app.json` updated: splash `backgroundColor` and `dark.backgroundColor`
both `#0E7C3A` → `#FFFFFF`; splash `imageWidth` 200 → 240 so the
full logo with wordmark stays readable; Android `adaptiveIcon
.backgroundColor` `#0E7C3A` → `#FFFFFF`. **Did NOT** change:
expo-notifications `color` (`#0E7C3A` stays — that's notification
tint, theme.ts territory for PR 40), the green primary in
`src/constants/theme.ts`, any in-app screen styling. Scope of this
hotfix is artwork + their immediate bg colors only.

PR 39 commit was local-only and not yet deployed (build 16 wasn't
fired). Combining PR 39 + PR 39.1 into one build 17 cycle: one
`eas build --profile production --platform all`, one submit, one
TestFlight push. Cleanest.

**Sudhir's plan from his side:**
1. Confirm `SENTRY_AUTH_TOKEN` EAS secret is set
2. `eas build --profile production --platform all` (build 17 —
   rebrand strings + logo + permission strings all in one)
3. `eas submit --profile production --platform ios --latest`
4. `firebase deploy --only hosting` for the regenerated /privacy +
   /terms pages
5. Install on TestFlight overnight; India team runs the testing
   walkthrough at `docs/TESTING_TEAM_SMOKE_TEST.md` tomorrow
   morning IST

**Note for next session:** PR 40 (broader visual identity) still
applies — the blue+green palette from the new logo doesn't yet
flow into `theme.ts` (still on `#0E7C3A` kirana green). PR 40
scope reduced: just palette refresh + Devanagari font bundling +
empty-state component pack. Logo + splash + adaptive icons are
already done.

## 2026-05-26 evening — Build 17 deploy + Android unblock + smoke-test triage

iOS build 17 (PR 39 rebrand strings + PR 39.1 logo artwork)
built clean, submitted to TestFlight, installed. Hosting deploy
pushed regenerated /privacy + /terms with HamaraSetu branding +
Faridabad jurisdiction. Brand-block + Contact Support row both
verified live. Icon shows as "K" (old artwork) → expected;
artwork swap deferred until logo design landed mid-session.

**Mid-session logo arrival.** Sudhir confirmed HamaraSetu logo
finalized (blue-to-green gradient shopping bag + H/cart symbol
+ HAMARASETU wordmark + "Shop Smart. Shop Local." tagline on
white bg, 1280×780 JPEG). Generated 6 asset variants in the
Cowork sandbox via Python PIL — icon (square symbol-only crop),
splash (full logo with wordmark), Android adaptive fg/bg/mono,
favicon. First gen had a sizing bug (`thumbnail` won't upscale,
left small icon on white square); fixed with `resize`. Installed
to `assets/images/` (old files preserved at
`.archive-pre-pr40/`). `app.json` splash + adaptive bg colors
flipped from `#0E7C3A` green to `#FFFFFF` white to match logo's
own bg; splash `imageWidth` 200 → 240. Treated as PR 39.1.

**Android build unblocked.** Long-pending Android build failure
finally diagnosed: `app.json` android block was missing
`googleServicesFile`, so `@react-native-firebase/app` prebuild
trip would always fail. Sudhir created Android app in Firebase
Console, registered SHA-1 + SHA-256 fingerprints of the
production keystore (extracted via `eas credentials`),
downloaded `google-services.json` to project root, added the
config line to `app.json`. Build (6) succeeded. Distribution
path will be Google Play Closed Testing (deferred while Play
Console developer account approval is pending).

**Strategic pivot to 1-shop pilot.** Sudhir decided against the
5-10-shop pilot framing. Reasoning logged: one shop = fully
observable, isolated bug surface, reputation protection,
real-partner relationship. Definition of "settled" for shop #1
locked: 30-50 orders end-to-end, one full quiet week, at least
one cancellation with real Razorpay refund, one weird-case
handled, customer NPS-equivalent positive. Pilot data once
real money is involved = permanent; reset-pilot-data script
must be locked before going live (proposed as PR 39.2 if
needed, currently allowlisted to grocery-mvp-dev which is the
same project as live pilot will run on). Email switch from
`sarastacklabs@gmail.com` to `sarastacklabs@gmail.com` deferred
indefinitely (zero pilot benefit, multi-week migration risk).

**Smoke test round 1 — 9 issues surfaced**, triaged into:

- **Issue 8** — Admin couldn't see pending delivery requests
  despite Firestore having the doc with status:'pending'.
  Cloud Function logs showed 401 "access token could not be
  verified" — a **Cloud Run IAM gotcha**. The
  `listpendingdeliveryrequests` Cloud Run service had lost
  its `allUsers` / `roles/run.invoker` binding (etag: ACAB
  with empty bindings). Identical sibling `listpendingshops`
  retained binding and worked. Fix: one
  `gcloud run services add-iam-policy-binding` command.
  Verified working. Bulk audit found 4 services flagged
  missing allUsers but all 4 were correctly-locked background
  triggers (false positives in the audit). Logged permanently
  in `.windsurf/deploy-discipline.md` as the second IAM
  gotcha alongside PR 31's signBlob. All future PRs touching
  callables must verify Cloud Run IAM post-deploy.

- **Issues 1, 2, 3** — Shop visibility looked like it varied
  per account. Multiple false hypotheses (race condition,
  location store cleared on signOut, Cloud Run IAM). Real
  root cause: ShopListScreen had `useProfileStore(s =>
  s.profile?.favorites ?? {})` which creates a new `{}` ref
  on every render when favorites is undefined. Zustand's
  `Object.is` comparison sees the new ref, triggers
  re-render, creates another new ref, infinite loop. React
  trips "Maximum update depth exceeded" → ErrorBoundary
  catches → "Something went wrong" screen. Only manifested
  for accounts where `profile.favorites` was undefined —
  which after `reset-pilot-data` was ~every non-admin
  account. `9999999991` happened to have favorites set
  from earlier testing → stable ref → no loop → shop
  visible. Fix: hoist `EMPTY_FAVORITES` to module-level
  constant for stable fallback reference. Plus ShopCard
  defense-in-depth: guard `<Image source={{ uri }} />` for
  empty-string `imageUrl` (which iOS treats specially and
  throws on). Both fixes shipped via OTA, no native rebuild.
  Logged as **two new code-discipline rules** (Rule 8
  Zustand stable refs, Rule 9 Image URI empty-string guard)
  in `.windsurf/code-discipline.md`.

- **Issue 4** — Item icons show placeholder text with a
  question mark instead of emoji. Root cause: stale function
  deploy (categoryConstants.ts URL fix from PR 32.2 wasn't
  deployed). Fixed by `firebase deploy --only functions:
  addCustomMenuItem,addExtractedMenuItems`. New items get
  the correct `.png`-suffixed placehold.co URL. **But emoji
  doesn't render** in placehold.co output (server font
  doesn't support 🫒 etc., shows "?" instead). Decision:
  emoji-strip patch deferred; bigger fix is PR 42's real
  category images (10 hosted PNGs on Firebase Hosting).

- **Issue 5** — Storefront photo uploaded to KYC during
  registration but never copied to `shop.imageUrl` for the
  customer-facing shop card. Confirmed via Firestore screenshot
  (`kycDocs.storefront.storagePath` populated, `imageUrl: ""`).
  Bug is in `approveShop` callable. Deferred to PR 42 (own
  scope — needs server-side signed URL generation + client
  rendering + RegisterShop mandatory validation).

- **Issue 6** — Default ETA shows ~29 min before shop accepts.
  Decision locked: **Option A**, hide ETA entirely until shop
  has accepted; show "Awaiting shop confirmation" instead.
  Deferred to PR 43 (small UX PR).

- **Issue 7** — Shop owner dashboard needs highlight when
  orders are waiting. Folded into PR 41 as same architectural
  pattern as the admin badge.

- **Issue 9** — Slow page transitions. Deferred to performance
  investigation PR; cold-start hit was accepted earlier per
  cost-conservative pilot stance.

**PR 41 prompt updated** to reflect: correct `deliveryRequests`
collection name (was incorrectly `pendingDeliveryRequests`),
mandatory Cloud Run IAM verification step in the deploy plan,
shop owner dashboard badge as part of the same architectural
family.

**Doc trail updated:**
- `.windsurf/deploy-discipline.md` — new "Cloud Run `allUsers`
  invoker IAM" section with diagnostic + bulk audit + fix +
  prevention rule + false-positive guidance.
- `.windsurf/code-discipline.md` — Rule 8 (Zustand stable
  refs) and Rule 9 (Image URI empty-string guard) added with
  before/after code samples and grep audits.
- `CLAUDE.md` will be updated next session with build 17 live
  + hotfixes shipped + the four resolved bug classes.

**Remaining for next session:**
- Re-test the OTA hotfix (Sudhir doing now)
- If ShopDetail crashes for the same reason, second hotfix
- PR 42 scope: storefront photo wiring + real category images
- PR 43 scope: ETA hidden-until-accepted UX
- Decision on emoji-strip patch tonight vs roll into PR 42
- Play Console developer account approval status

**Score:** out of 9 smoke issues, 5 fully resolved tonight
(Issue 1, 2, 3, 4, 8), 3 scoped for next PRs (5, 6, 7), 1
deferred (9). Build 17 + Android build (6) both live. Net for
the night = significant pilot-readiness progress, also a
strong reminder that smoke testing one shop with real testers
catches real bugs that unit tests don't.

## 2026-05-27 — PRs 41–45.2 shipped; push notification root-cause-and-fix; pilot-ready dev side

Marathon continuation of the May 26 session. Offshore testing
team smoke-tested build 17; this session worked through their
findings + a multi-day push-notification outage.

**PRs shipped via OTA (no native rebuild after build 17):**
- PR 41 — admin pending-approval badges + shop-owner dashboard
  badge. Windsurf pushed back on my prompt's extra triggers
  (kept existing in-callable pushToAdmins, dropped the new
  triggers) — cleaner. Also caught a 4th schema-name error in my
  prompt (pending shops live in `shops` with status==='pending',
  not a separate collection).
- PR 42 — storefront photo wiring (KYC → shop.imageUrl) +
  mandatory storefront in RegisterShop. Windsurf corrected the
  doc path (registrationData.kycDocs.storefront.storagePath).
- PR 42.0.1 — regenerateShopImageUrl admin callable.
- PR 42.0.2 — storefront URLs switched v4-signed → Firebase
  download tokens. Root cause of the storefront-photo-never-shows
  bug: v4 signed URLs cap at 7 days; PR 42's 10-year expiry threw
  silently in approveShop's non-fatal catch. Lesson →
  deploy-discipline.md "GCS v4 signed-URL 7-day expiry cap."
- PR 42.1 — separate shop + delivery ratings.
- PR 42.1.1 — Firestore reads-before-writes fix (dual-rating
  500'd because a gated tx.get ran after writes). Lesson →
  code-discipline Rule 10.
- PR 43 — ETA hidden until shop accepts (Option A) + KYC
  mandatory (GST hard-required per CGST Section 24, Identity
  Proof = Aadhaar OR PAN via existing single ownerIdDoc slot —
  Windsurf kept the single slot rather than schema-expanding).
- PR 43.1 — keyboard-avoidance hotfix on RateOrderCard.
- PR 45 / 45.1 / 45.2 — push reliability + observability + the
  anonymous-user root cause (below).

**The push notification saga (the headline of this session):**
Push silently broke between build 15 and 17. Multi-step
diagnosis ruled out, from the outside: APN key (present), App ID
push capability (enabled), iOS permission (granted), Cloud Run
IAM (present), the closure-gate retry bug (clean force-quit
still empty). PR 45 added instrumentation but had a blind spot —
captures only on FAILURE branches; the success path emitted only
breadcrumbs (which don't create Sentry issues). So the actual
failure mode produced zero Sentry signal. PR 45.1 added
success-path captureMessage milestones. The probes immediately
revealed the root cause: `bootstrap: reached push branch
{ isAnonymous: true, uidPrefix: Lb5D6Ske }` — the token was
registering for Firebase's anonymous launch session, the
session-wide boolean gate latched, and the real user (signing in
moments later) was short-circuited. PR 45.2 made the gate
identity-aware: skip anonymous users, re-register when the uid
changes, track lastRegisteredUid instead of a boolean.
Confirmed working on two physical devices (customer + shop owner,
separate phones). Lesson → code-discipline Rule 11.

**Key testing-methodology insight:** push is inherently
two-device. On a single device switching accounts, PR 24's
unregisterPushToken removes the token on sign-out, so the
customer (who placed the order) has no live token when the shop
accepts — the push has nowhere to land. Solo testing always
looks broken; the real pilot (customer + shopkeeper on separate
phones) works. Confirmed.

**Push pipeline test coverage:** went from ZERO (only
authService.signOut.test.ts mocking pushService) to
comprehensive — pushService branches, the pure
pushRegistrationOrchestrator (incl. the anonymous-skip + uid-
change regression tests that pin this exact bug), and server
pushHelpers (validatePushTokenInput + buildOrderStatusPushPlan).
Suite 782 → 825. This directly serves Sudhir's stated directive:
"more test coverage = faster, more reliable manual testing."

**Cloud Run allUsers IAM gotcha — now hit 4× total.** Recurring:
something in the GCP project strips the allUsers/run.invoker
binding from callables, causing silent 401s. The bulk-audit
PowerShell one-liner finds all affected callables; the fix is one
add-iam-policy-binding per service. Every callable-touching PR now
carries a mandatory post-deploy IAM verification step.

**Doc trail (this entry's batch):**
- code-discipline.md — Rule 10 (Firestore reads-before-writes),
  Rule 11 (register-once gates keyed to identity not a boolean).
- deploy-discipline.md — GCS v4 signed-URL 7-day cap + the
  download-token alternative.
- CLAUDE.md — current state rewritten for the PR 41–45.2 batch +
  push fix + the two deferred follow-ups.

**Deferred / queued (non-blocking):**
- Strip PR 45.1 diagnostic probes (cleanup OTA, no rush).
- RNFB namespaced → modular API migration (deprecation noise,
  before RNFB v22).
- PR 39.2 (reset-pilot-data live-pilot guard) — prompt drafted,
  not executed.
- PR 44 (real category photos) — needs 10 Pexels PNGs sourced.
- PR 42.1.2 (admin order-comment surfacing — delivery comments
  stored but not displayed).

**Pilot-readiness:** dev side is effectively done. HamaraSetu
brand + logo live, Android build unblocked, push working,
storefront photos working, ratings split, KYC enforced, ETA
honest. Remaining is non-code: source category photos, onboard
the first real shop in person, print QR posters, run the
PILOT_LAUNCH_CHECKLIST (not yet drafted — next session candidate).

---

## 2026-05-27 — Geo/distance system: PRs 46–49 shipped (4 of 5); pausing for full re-test + Android validation

Built the bulk of the geo/distance system this session
(`docs/GEO_DISTANCE_SYSTEM_DESIGN.md`). Cadence held throughout:
Claude drafts the prompt → Windsurf executes → Sudhir deploys +
on-device smoke-tests → Claude verifies the diff → next PR.

**Shipped (all code-complete + Sudhir-tested on iOS):**
- **PR 46** — geo foundation. Locked delivery location on the
  order (`deliveryLocation` + `deliveryDistanceKm` +
  `deliveryDurationMin`), `getDeliveryEstimate` callable, GPS
  capture in AddressEditScreen + "deliver to current location" in
  CheckoutScreen. **Cost decision (Sudhir):** the paid Google
  Distance Matrix API is BUILT BUT DORMANT — `aiFeatures/
  distanceMatrix.enabled` defaults false, the disabled branch
  never calls fetch (pinned by a cost-guarantee test). Haversine
  ×1.4 during pilot; flip the flag at ~50 shops scale (logged as
  a FUTURE TO-DO in the design doc so it isn't missed).
- **PR 47** — distance-based delivery charges. Per-shop tier table
  (`deliveryChargeTiers`, inclusive `maxKm` bands + null catch-all),
  `chargeForDistance` + `validateDeliveryChargeTiers` pure helpers
  (functions + `src/utils/` client mirror), `updateShopDeliveryTiers`
  callable, ShopSettings tier editor, CheckoutScreen tiered preview.
  placeOrder computes the charge server-side from the re-derived
  distance and stamps `deliveryCharge` + `deliveryFee = deliveryCharge`
  (back-compat shim). approveShop seeds the default table.
- **PR 48** — shop service radius + customer distance visibility.
  Replaced the hardcoded `SHOW_ALL_SHOPS = true` with a real
  per-shop `serviceRadiusKm` gate. **Key architectural point:** the
  gate had to live SERVER-SIDE in `listShopsPublic` (native can't
  read Firestore — the Plan B reason) and the "show all" override
  had to be a server-read Firestore flag, `appConfig/shopVisibility
  .showAllShops`, NOT `__DEV__` (which is false in TestFlight and
  blinded the old flag — the documented bug). Sudhir created the
  flag doc set to `true` for the cross-city offshore-testing window;
  flip to false at real 1-shop pilot. Bundled two PR-47 follow-up
  fixes: the tier-save-doesn't-persist bug + removal of the now-
  redundant flat Delivery-fee input.
- **PR 49** — delivery-partner routing. `Order.shopLocation`
  stamped in placeOrder (the pickup coord, no extra read);
  `reportDeliveryLocation` callable writing `users/{uid}.
  currentLocation` (foreground-only, on dashboard focus — sets up
  PR 50); nearest-shop-first sort of available pickups; ride-distance
  breakdown (partner→shop haversine + shop→customer via stored
  `deliveryDistanceKm`); locked delivery-location label on cards.
  Bundled the PR-48 service-area-save regression fix.

**Two bugs found-and-fixed this session, both the same shape:**
the PR-47 tier-save revert and the PR-48 service-area-save failure
were both cases where a *pure helper* learned a new field but the
thin *callable wrapper* feeding it didn't.
- Tier save (PR 48 §I): `getMyShop`'s `orderBy('updatedAt')` query
  returned a stale sibling doc because `updateShopDeliveryTiers`
  wrote `updatedAt: Date.now()` (number) while everything else
  writes a Timestamp — Firestore sorts mixed types by type first.
  Fixed by normalizing to `serverTimestamp()` AND making `getMyShop`
  read `shops/{claims.shopId}` directly when the owner has a claim
  (query fallback preserved only for pending pre-approval owners).
- Service-area save (PR 49 §F): `updateShopSettings`'s onCall type
  omitted `serviceRadiusKm` and didn't forward it to the validator,
  so a radius-only payload tripped the "at least one field" guard.
  Two-line wrapper fix.

**Recurring lesson reinforced:** when a validator/helper gains a
field, grep every caller/wrapper for the field name before calling
it done. (Pairs with the existing "verify exact field names before
implementing" note from my prompt-error history.)

**Process note — Windsurf weekly quota exhausted; resets 5/31
morning.** PR 50 (notification radius — the last geo PR) is
designed in the doc but NOT yet drafted as a prompt; holding it
until the quota resets AND the re-test/Android pass surfaces
whatever it surfaces.

**Next phase (Sudhir's plan):** full end-to-end re-test of
everything on iOS, PLUS set up and validate on Android (build 6
was unblocked May 26). Collect any bugs / critical enhancements
into a list as they come up. So the next session likely starts
from a testing-findings list rather than PR 50.

**Deploy state:** PRs 46–49 each deployed by Sudhir
(server-first, IAM-verified) + OTA'd. Geo callables live:
`getDeliveryEstimate`, `updateShopDeliveryTiers`,
`updateShopSettings` (now radius-aware), `reportDeliveryLocation`,
`listShopsPublic` (radius gate), `getMyShop` (claim-read).
Test suite 825 → 930 across the four PRs.

**Still queued / deferred (unchanged):** PR 50 (notification
radius), PR 44 (category photos — needs Pexels PNGs), PR 39.2
(reset-pilot-data live-pilot guard), PR 42.1.2 (admin order-comment
surfacing), strip the PR 45.1 + PR 48 §I diagnostic logs, RNFB
modular-API migration, PILOT_LAUNCH_CHECKLIST (not yet drafted).

---

## 2026-05-31 (late evening) — Email migration Tier 1+2+3 + static landing page

**Context.** Razorpay account was suspended for the second time;
Sudhir is recreating fresh. New account asks for web / iOS / Android
links — none of which validated. Diagnosis:

1. **Web URL** `https://grocery-mvp-dev.web.app` was returning a
   blank page because the deployed `dist/index.html` was the
   half-broken Expo Web shell (`<div id="root">` + a stale
   `/_expo/static/js/web/App-{hash}.js` script tag whose bundle
   wasn't deployed alongside it). Console showed
   `Uncaught Error: [firebase] Missing required config in app.json`.
2. **iOS** TestFlight URL: rejected by Razorpay regex —
   `apps.apple.com/...` production-only.
3. **Android** Closed Testing opt-in URL: same regex pattern
   rejection — `play.google.com/store/apps/details?id=...`
   production-only.

**Two parallel work streams shipped:**

**A — Static landing page.** Replaced the broken Expo Web shell
with a hand-authored static landing page generated by
`scripts/build-legal-html.ts`. New `buildLandingPage()` function +
`LANDING_BODY` HTML block + landing-only CSS (hero gradient
matching the PR 39.1 logo blue-to-green palette, content cards,
mailto CTA). Lives in the same `npm run build-legal` →
`firebase deploy --only hosting` pipeline as the privacy / terms /
account-deletion pages so re-running the build regenerates
everything coherently. Also wrote `dist/index.html` directly with
the rendered output so the deploy could be done immediately
without rerunning the build script. Both paths converge.

**B — Sara Stack Labs email migration (Tier 1 + 2 + 3).** The
original CLAUDE.md decision deferred the migration to post-pilot
("multi-week risk for zero pilot benefit"). The Razorpay account
being recreated from scratch was a free moment to do it on the
customer-facing surfaces without touching root accounts:

- **Tier 1 — app code.** `SUPPORT_EMAIL` in
  `src/constants/branding.ts` flipped from `sudhir.davim@gmail.com`
  to `sarastacklabs@gmail.com`. Pin test
  (`tests/constants/branding.test.ts`) updated. Smoke test for
  `openSupportEmail` utility (`tests/utils/openSupport.test.ts`)
  updated. All three carry migration-context comments so the
  breadcrumb survives.
- **Tier 2 — public web.** Landing page + privacy + terms +
  account-deletion docs all updated. The hosting deploy after this
  regenerates dist/* with the new email.
- **Tier 3 — operational docs.** `CLAUDE.md` "Support email"
  paragraph rewritten to reflect the migration (replaced the
  "deferred to post-pilot" decision with a tiered breakdown of
  what's done vs. what's left). `PRELAUNCH_CHECKLIST.md`,
  `docs/PLAY-CONSOLE-PREFILL-PACK.md`, `docs/PILOT_SMOKE_TEST_PLAN.md`,
  `docs/TESTING_TEAM_SMOKE_TEST.md` — bulk replaced. Historical
  PR prompt files (`docs/pr-39-*`, `docs/pr-25-*`) deliberately
  NOT touched; they're frozen reference.

**What stayed on the personal account (Tier 5 — explicitly
deferred indefinitely):**

- `eas.json` `appleId: "sudhir.davim@gmail.com"` — Apple Developer
  team is multi-week to transfer; bundle IDs already say
  `com.sudhirdavim.grocerymvp`. Renaming costs all reviews /
  ratings / install base.
- Google Play Console developer account.
- Firebase project ID `grocery-mvp-dev` — can't be renamed in
  Firebase, would require a new-project migration of all
  production data.
- All bundle IDs.

**What Sudhir will do manually (Tier 4 — gradually, this week):**

Add `sarastacklabs@gmail.com` as a second member alongside the
existing personal address on:

- Firebase Console (Project Settings → Users and permissions → Add
  member, role: Owner)
- EAS / Expo (Team → invite member)
- Anthropic Console (Settings → Members)
- Sentry (Settings → Members)
- Razorpay (new account, register fresh with the new email)
- Domain registrar (whenever a custom domain is purchased)

Once each service has the new email working, the old can be
removed in a batch later.

**Razorpay status after the migration:** web URL still on
`grocery-mvp-dev.web.app` (now serving a real landing page), but
Razorpay may still flag it as a non-business subdomain. Custom
domain is the next defensive move if it does. iOS + Android URLs
require production App Store / Play Store listings; closed-track
URLs are rejected by Razorpay's regex regardless of content.
Fastest path forward: Play Store production submission (no Apple
review window). Plan B if Razorpay keeps rejecting: a more
pre-launch-friendly gateway (Cashfree / PayU / Paytm Payment
Gateway).

**Deploy required next:**

```
npm test                            # confirm pin tests green
npm run build-legal                 # regenerate dist/*.html
firebase deploy --only hosting      # push landing + legal pages
eas update --branch production      # OTA for the SUPPORT_EMAIL
                                    # flip on the app side
```

No EAS rebuild needed — the constant change is pure JS.

## 2026-06-02 — Testing-findings wave + reset-keep-catalog script + multi-region test setup + SHOP-LOCATION-EDIT

Long session covering five distinct workstreams. End-to-end testing surfaced ten new findings (radius / current-location / partner-detail / address dedupe / Place Order race). Triaged into HOTFIX-9 (checkout race guard), HOTFIX-10 (address dedupe + silent skip + toast), SHOP-LOCATION-REQUIRED (defense-in-depth filter + approval + RegisterShop gate), and SHOP-LOCATION-EDIT (dual-mode capture + edit + admin re-approval). All four shipped via Windsurf; test suite went 1241 → 1282 → 1299 → 1327. Operational radius cluster (#2/#3/#4/#7 from the testing list) was a Firebase Console flip (`appConfig/shopVisibility.showAllShops` → false) + IAM verify on `listShopsPublic` — no code, resolved without Windsurf burn. New `scripts/reset-keep-catalog.ts` written for a third reset mode (keep shops + menus + products + users; wipe transactional + state-derived). Then a full reset (`reset-test-data` with admin protect) and rebuild of the test-account fleet for 2 regions (India + US) with new phone numbers, OTPs in Firebase Console, role claims granted. Migrated `src/constants/testAccounts.ts` from "10-digit Indian phone, no prefix" to full E.164 strings so US (+1) and India (+91) coexist; QuickSwitchModal + HomeScreen visibility gate updated to drop the hardcoded `+91`. Added `Hello, <name> 👋` greeting on HomeScreen with profile.name → test-account label → null fallback ladder. HOTFIX-FALLBACK-LEAK shipped directly (no Windsurf) after Sudhir's US friend hit the silent MOCK_USER_LOCATION leak — RegisterShop now refuses `source !== 'gps'` with red error hint + Continue hard-disabled. SHOP-LOCATION-EDIT is the structural fix on top of that hotfix: §A RegisterShop dual capture (📍 Use my GPS / 🔍 Find from address using `Location.geocodeAsync` — free, no API key), §B ShopSettings Location section with `pendingLocation` two-step approval, §C admin verification with reverse-geocoded pin resolution shown side-by-side with owner-typed address. New `useCaptureShopLocation` hook, `formatResolvedAddress` + `distanceBetweenPins` pure helpers, 4 new server callables (submitPending / cancelPending / approvePending / rejectPending). Schema-additive only — 5 new optional fields on Shop. Doc trail updated by Claude directly (not Windsurf) to save quota. Rule 5 extension formalized in `.windsurf/code-discipline.md`: audit-grep must cover behavior at call sites when field is missing / null / nonconforming (MOCK_USER_LOCATION leak was the trigger). Pending Sudhir deploy: server-first (6 callables), IAM verify all 6, Firestore rules update, client OTA bundling all the SHOP-LOCATION-EDIT client surfaces + HOTFIX-FALLBACK-LEAK + the QuickSwitch / HomeScreen polish.

