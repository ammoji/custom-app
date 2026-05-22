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
