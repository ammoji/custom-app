# Kirana Mart — Strategic Roadmap

**Purpose:** Strategic, multi-month view of where Kirana Mart is going.
Different from `PRELAUNCH_CHECKLIST.md` (tactical line items) and from
the per-PR `docs/pr-N-*-windsurf-prompt.md` files (implementation
details). This is the "what are we building next and why" document.

**Read this when:** starting a fresh planning session, picking the
next PR, evaluating a new feature request against the existing plan,
or onboarding a new collaborator (human or AI) to the product
direction.

**Update protocol:** at the end of any session where the roadmap
shifts — feature shipped, priority reordered, scope cut or added —
update the relevant phase, bump the date stamp at the bottom, and
log the change in `docs/SESSION_LOG.md`. This doc is curated; don't
let it bloat into a wishlist.

---

## Snapshot — where we are today

**Shipped (PRs 1–24):** security hardening, payment hardening,
concurrency cleanup, search + cart integrity, shop settings, image
upload, customer self-cancel, stock bulk audit, Node 22 + Firebase
SDK upgrade, quick wins, admin order timeline, shopkeeper ETA
workflow, repeat order, order-again rail, active-orders rail, shop
new-order alert, polish bundle, quick-switch test accounts,
favorites, ratings, substitution preferences, delivery instructions,
delivery heads-up coming-soon fix, push token cleanup on sign-out.
Latest commit on `main`: PR 24 (May 22 2026).

**In flight (this week — Phase A + first Phase A2 PR shipped):**
PRs 25, 26, 27, 31, 31.1 all shipped on May 22 2026. PR 26's
Sentry source-map upload activates on the next native build
(post-EAS secret). PR 31's shop KYC document upload is live; the
IAM fix it required also unblocked the long-broken PR 6.1
menu-image upload. PR 32 (AI photo-to-catalog) prompt drafted,
queued for the next Windsurf session after quota reset.

**Mission North Star (added 2026-05-22, end-of-session):** the
entire roadmap is in service of one sentence — *make shop
onboarding so frictionless that shopkeepers trust the tech.*
Hero metric: time-to-first-listed-menu-item ≤30 min assisted /
≤90 min self-serve. See the Mission North Star + Trust
Principles sections at the top of this doc; they override
anything below them if there's a conflict.

**Strategic refresh (2026-05-22):** New "Strategic principles"
section captures the discipline boundaries — one category until
proven, app-first customer ordering (WhatsApp only as future
AI-shortcut layer), AI for real friction not vanity. Phase B
reordered to put **PR 36 Customer CRM** and **PR 37 Digital
Udhaar Ledger** at the top — these are the daily-use merchant
hooks the pilot needs. Brand name candidate: **MeraYara**
(Hindi "मेरा यार" = "my friend") — still under consideration,
not yet propagated to the codebase.

**Up next (pilot-blocking sequence):**
- ~~PR 32 — AI photo-to-catalog~~ ✅ shipped May 23
- ~~PR 34 — Voice + Hindi onboarding~~ ✅ shipped May 24
  (iOS build 15, tested live)
- ~~PR 38 — Admin feature-usage dashboard~~ ✅ shipped May 24
  (PR 38) + PR 38.1 hotfix to route reads/writes through
  callables (Web-SDK/RNFB auth mismatch — same root cause as
  PR 6.1; second occurrence; permanent rule added to deploy-
  discipline.md so it's the last)
- **PR 35 — Field-rep assisted onboarding** (Phase A2;
  Trust Principle 5 escape hatch)
- **PR 33 — Master product catalog** (Phase A2; can be
  deferred if PR 32's "every SKU is custom" works well in
  practice — revisit after pilot data)
- ~~PR 36 — Customer CRM for shop owner~~ ✅ shipped May 24
  2026; tested end-to-end including `featureUsageLog/` flow
  confirming PR 38.1's callable routing works for the new
  events.
- **PR 36.1 — Pilot UX polish bundle (2 parts)** ← next.
  Countdown timer on customer OrderDetailScreen +
  "Favorites only" filter pill on ShopListScreen. Cold-start
  fix DEFERRED — Sudhir confirmed it's a 1-line `minInstances:
  1` config change worth ~₹400/mo per function, but chose
  pilot-cost-conservative path (accept 2–3× daily cold-start
  hit of ~4 s per shop owner). Revisit post-pilot if it
  surfaces as friction.
- ~~PR 37 — Digital Udhaar / Khata ledger~~ ⛔ **Deferred from
  pilot (Sudhir's call May 24).** Build on demand if pilot
  shops request credit-tracking. Prompt preserved at
  `docs/pr-37-digital-udhaar-khata-ledger-windsurf-prompt.md`
  for fast pickup.
- ~~PR 37.1 — Customer-side udhaar payment~~ ⛔ **Deferred
  from pilot** (depends on PR 37).
- **PR 28 — Prod Firebase project** (Phase A; required only if
  pilot goes Razorpay-live; COD-only pilot can defer)

**Up next (Phase A2 — shop onboarding):** the critical gap before
public launch. Today the app ships with 8 seeded mock Delhi shops
and there is no self-serve flow for a real kirana owner to register,
get their catalog in, and go live. Phase A2 (PRs 31–35) builds that
flow with AI-assisted catalog ingestion (photo of rate-list →
catalog), shared master catalog + smart price suggestions, and a
field-rep assisted mode for the first 50 shops. Sequenced AFTER
Phase A (so prod Firebase and live Razorpay are in place) and BEFORE
the customer-trust Phase B (so we have something to retain customers
*on*).

**Then:** Phase B trust/retention (PRs 36–43), Phase C AI
differentiation (PRs 44–49), Phase D ops/scale (PRs 50–54), Phase E
loyalty/repeat (PRs 55–58).

---

## Mission North Star — read this first

**Make shop onboarding so frictionless that shopkeepers trust the
tech.**

That's the entire thesis. Every PR, every design decision, every
ranked priority gets evaluated against this single sentence. Most
kirana / pharmacy / hardware / bakery shopkeepers in India are
50–80% of the way to wanting an online presence — what's stopping
them is the *hassle and the fear of getting it wrong*. The chains
(Blinkit, Zepto, JioMart) take that fear away by taking the shop
out of the equation entirely. We take it away by making the
shopkeeper feel in control at every step.

**Why this is the North Star, not just a goal:**

1. **Supply gravity is the only marketplace lever we control
   pre-launch.** Customer demand follows supply density; supply
   density follows onboarding velocity; onboarding velocity
   follows trust. There is no shortcut.
2. **Hassle-free onboarding is observable in 30 minutes.** A
   shopkeeper who completes setup unaided in 30 minutes will
   stay. One who hits any blocker requiring our help will
   either churn or become a high-touch support burden. Onboarding
   experience predicts retention more than any other variable
   we can measure at this stage.
3. **Trust compounds across the local network.** A kirana owner
   who tells the shop owner two doors down "MeraYara is okay,
   they didn't break anything" is worth 100x our best
   advertisement. Lose that trust once in a neighborhood and
   acquisition cost in that neighborhood doubles for months.
4. **AI is in service of this mission, not separate from it.**
   Photo-to-catalog (PR 32), voice/Hindi onboarding (PR 34),
   field-rep mode (PR 35), master catalog matching (PR 33) —
   these aren't AI features. They are onboarding-friction
   removers that happen to use AI. The framing matters: if an
   AI feature doesn't measurably reduce onboarding hassle, it
   doesn't ship pre-pilot.

**The hero metric: time-to-first-listed-menu-item.** From the
moment a shopkeeper opens the registration screen to the moment
they have ≥1 menu item listed on their approved shop. Target:
**< 30 minutes** (with field-rep assist), **< 90 minutes**
(fully self-serve). If a roadmap item doesn't move this number
down, it isn't pilot-blocking. Period.

---

## Trust principles for onboarding

These are UX rules — not feature rules. They govern *how* every
onboarding screen behaves so the shopkeeper never feels trapped,
surprised, or unsure. Every onboarding-flow PR (PR 31, 32, 33,
34, 35) checks itself against these five before it ships.

1. **Every step has a visible undo.** Photo wrong? "Retake." Item
   miscategorized by AI? "Edit." Whole shop set up under wrong
   address? "Edit shop." No dead-ends. No "contact support to fix
   this." A shopkeeper who feels they can't undo a mistake stops
   trusting the next step before it begins.
2. **Every AI output gets human review before commit.** Photo-to-
   catalog draft is editable row-by-row before "Add to menu."
   Voice transcription confirms the parsed fields before saving.
   The AI's confidence chip is informational; the shopkeeper has
   final approval. We never write to their shop's data based on
   AI output alone.
3. **Save anywhere, resume anywhere.** A shopkeeper who has to
   step away mid-onboarding (customer walks in, kid needs help,
   phone battery dies) can come back hours later and pick up
   where they left off. No "session expired." No "please start
   over." Storage state survives the gap.
4. **Errors are explained in plain Hindi-friendly language.** Not
   "INTERNAL" — "Could not read your image, please try again
   with better lighting." Not "failed-precondition" — "This shop
   is already approved; you can't change the basic info here."
   Server error codes are translation tasks for the client; the
   shopkeeper sees a sentence they understand.
5. **Field-rep escape hatch at every step.** Per PR 35, a field
   rep can take over the device with a single OTP and complete
   any step on the shopkeeper's behalf, then hand back. The
   shopkeeper is never the last line of defense against a
   confusing screen. Knowing this exists *before* they hit a
   problem is half the trust signal.

---

## Strategic principles (capture these before picking any PR)

These are the discipline rules that override any specific roadmap
item. If a proposed PR conflicts with one of these, the principle
wins.

**Reviewed: 2026-05-22 in conversation with Sudhir after a
ChatGPT-suggested pivot to a multi-category WhatsApp-first
merchant-CRM product. Outcome: keep the existing aggregator-with-
delivery direction, ADD the genuinely high-value merchant features
(CRM + Udhaar), reject the pivot.**

1. **One category until proven.** Stay on kirana grocery until
   the pilot validates the model. Multi-category (pharmacy,
   bakery, electronics, hardware) is **explicitly out of scope**
   until month 12 at the earliest. Each category has different
   regulations, workflows, and unit economics; mixing them in
   pilot guarantees you learn nothing useful about any of them.
2. **Customer ordering goes through our app, period.** No
   WhatsApp-as-primary-channel. The structured order data is the
   foundation everything else (CRM, repeat-order analytics,
   delivery tracking, refunds, ratings) is built on. You cannot
   analyze "who's a regular vs. who stopped" from unstructured
   WhatsApp messages.
3. **AI is for solving real friction, not for vanity features.**
   AI gets built only when it materially reduces user effort on
   a known pain point. Photo-to-catalog (PR 32) qualifies — it
   collapses 4 hours of shop-owner typing into 15 minutes. Voice
   + Hindi onboarding (PR 34) qualifies — it gives less-fluent
   users a way in. AI shopping assistant for "what do I need
   for paneer butter masala" (PR 46/Phase C) does NOT qualify
   pre-launch and is deferred until the core flow proves itself.
4. **Merchant daily-use hooks are pilot-critical.** A shop owner
   who opens the app only when an order arrives forgets about
   us. The pilot's primary daily-use hook is **Customer CRM**
   (who's my best customer, who stopped coming). **Digital
   Udhaar / Khata ledger** was originally planned as a second
   hook but was deferred (Sudhir's call May 24) — to be built
   on demand if pilot shop owners request credit-tracking.
   PR 37 + 37.1 designs preserved in `docs/` for fast pickup.
   For now, the principle stands but with one hook, not two.
5. **Delivery is core, not optional.** Customers expect it
   because Blinkit / Zepto trained them to. A "MeraYara without
   delivery" loses to "just call the shop directly."
6. **Voice + Hindi is an accessibility principle, not just an
   onboarding feature.** PR 34's scope is shop-owner registration
   today; the same principle (mic on any field, regional-language
   text accepted) extends to customer-side flows as accessibility
   demands surface. Tier-2/3 reach is where the unaddressed
   market lives.
7. **Pilot success = three metrics, in this priority order:**
   (1) **Time-to-first-listed-menu-item** ≤30 min assisted /
   ≤90 min self-serve (the North Star metric — measures
   onboarding hassle directly); (2) **merchant weekly active**
   — how many shops open the app weekly two months in (measures
   whether the platform stays useful post-onboarding);
   (3) **customer repeat-order rate within 30 days** ≥30%
   (measures whether the customer side has demand to retain).
   App downloads, total shops signed up, total customers — all
   vanity. Every PR is justified against these three metrics, in
   order. If a PR doesn't move metric 1 down or metric 2 up or
   metric 3 up, it isn't pilot-blocking.
8. **Instrument before you ship.** Every feature PR adds
   `Analytics.event_name(...)` calls for its main user actions —
   same mandatory status as "every PR adds tests" in
   `.windsurf/test-discipline.md`. Otherwise the question
   "which features are people actually using" has no answer
   until months after the features ship. The admin
   feature-usage dashboard (PR 38) is the read side; the
   instrumentation discipline is the write side. Both ship
   pre-pilot so the pilot generates real data, not guesses.

---

## Product framing

**Kirana Mart** is a **neighborhood corner-store grocery
marketplace**, not a quick-commerce dark-store operation. The
operational model:

- Customer orders from a known local kirana shop (10–30 minute drive
  radius, not 10-minute promised delivery).
- Shop owner fulfills from their existing inventory; we don't run
  warehouses.
- Independent delivery partners claim and deliver.
- We don't hold stock, we don't operate fulfillment centers, we
  don't promise sub-30-minute SLAs.

This framing matters because **most of what Blinkit/Zepto win on —
dark-store density, route batching, predictive inventory placement —
is not our game.** Our moat candidates are: trust in the local-shop
relationship, fairness to small kirana owners, AI-assisted shopping
experience (since LLMs are now cheap), and rural/tier-2 reach where
the quick-commerce model doesn't economically work.

---

## Section 1 — Audit of the 15 competitor-feature categories

Cross-referenced against PRs 1–24, Phase 12 work, and the
PRELAUNCH_CHECKLIST. Status legend:

- ✅ **Shipped** — built and in production OTA bundle.
- 🚧 **Partial** — core piece exists, gaps remain.
- ❌ **Not built** — placeholder for future PR.
- ⛔ **Out of scope** — deliberately not pursuing (with reason).

### 1. Real-Time Order Tracking — 🚧 Partial

**Shipped:**
- Order status machine: `pending → accepted → preparing →
  ready_for_pickup → picked_up → delivered` (Phase 12, PR 7, PR 12).
- Status timeline visible on customer + shop + delivery order
  detail screens (Phase 12a-v2-iv-followup).
- Push notifications on every status transition (PR 12 era).
- Shop-set ready-by ETA visible to customer and delivery partner
  (PR 12).
- PR 16 — shop new-order alert.

**Gaps:**
- No live delivery-partner GPS on a map for the customer.
- No proactive delay alerts (e.g., "your order is taking longer
  than expected — here's why").
- Status-history widget is text-only, not visual.

**Recommendation:** the live-map piece is a moderate engineering
lift (requires partner-app GPS streaming + customer-side map
component) and may not be the right next investment for a
neighborhood-shop model where deliveries are short and trust is
local. **Defer live-map** to Phase D. Ship a **visual status timeline
+ proactive delay banner** in Phase B instead — much cheaper, similar
trust payoff.

### 2. Fast & Frictionless Checkout — ✅ Shipped (with minor gaps)

**Shipped:**
- Saved addresses (Phase 12a-v2-iv).
- COD + Razorpay online payment (Phase 5 + PR 2 hardening).
- Delivery fee + min-order visible pre-payment (PR 5).
- PR 21 — substitution preference at checkout.
- PR 22 — delivery instructions at checkout.
- PR 7 — customer self-service cancellation within window.
- One-tap reorder (PR 13) — "Repeat Order" from past orders.

**Gaps:**
- No coupon / promo code entry (intentional — see Phase B).
- No saved card management UI (Razorpay handles this via their
  Checkout SDK; saving cards on their side requires Razorpay
  Customer ID flow — moderate work, low priority).
- No "delivery ETA before payment" — we show min-order and delivery
  fee, but not estimated delivery time. Address in Phase B.

### 3. Smart Search + Recommendations — 🚧 Partial

**Shipped:**
- PR 4 — customer search rewrite (Firestore-backed,
  collection-group query).
- PR 14 — home order-again rail.
- PR 19 — favorites.
- PR 15 — home active-orders rail.

**Gaps (these are the AI opportunities):**
- No typo tolerance (Firestore doesn't natively support fuzzy
  matching).
- No "trending items" or "popular near you."
- No personalized recommendations.
- No voice search.

**Recommendation:** typo tolerance + personalized recommendations
are perfect Claude-API use cases — see Section 3 (AI strategy). High
differentiation potential.

### 4. Inventory Accuracy — 🚧 Partial

**Shipped:**
- Real-time stock per menu item: `available` flag + optional `stock`
  count (Phase 12a-v2-ii).
- Out-of-stock items filtered from customer-facing menu
  (`listShopMenuPublic` server-side filter).
- PR 8 — bulk-toggle availability on multiple menu items.
- PR 21 — customer's substitution preference captured at checkout.

**Gaps:**
- No low-stock alert to the shop owner (would help them restock or
  hide items before they're ordered).
- No actual substitution UI for the shop owner — PR 21 captured the
  *preference* but the shop owner has no flow today to actually
  swap an item and notify the customer of the swap. **This is a
  high-value gap** — it closes the loop on PR 21's promise.

### 5. Delivery ETA Prediction Engine — ❌ Not built (intentionally simple)

**Shipped:** PR 12 — shopkeeper sets a manual `readyByEstimate` when
accepting/preparing.

**Gaps:** no automated ETA prediction. Currently the shop owner
guesses; we don't factor in distance, traffic, partner availability,
historical prep time, weather, etc.

**Recommendation:** **defer the ML-prediction version indefinitely.**
For a neighborhood-kirana model, the manual shop-owner ETA is
honest and accurate. The shop owner knows their kitchen / packing
time better than any model trained on sparse data. Revisit only when
we have enough historical data to train *and* the shop owners stop
reliably entering ETAs. **Out of scope for the next 6 months.**

### 6. Ratings & Review System — ✅ Shipped (with future room)

**Shipped:**
- PR 20 — 1-5 star rating + optional comment per delivered order,
  rolls into shop's rating average and count.
- Visible on shop card (ShopRatingBadge).

**Gaps:**
- No separate sub-ratings (product quality / packaging / delivery
  experience).
- No AI sentiment analysis on review text — clear Phase C / AI item.

### 7. Offers, Wallet & Loyalty System — ❌ Not built

**Shipped:** nothing in this category.

**Recommendation:** the **biggest single retention lever** still
available. Phase B should contain at minimum:
- Basic coupon system (admin-defined codes, percentage / flat
  discount, expiry, per-user limit).
- Free-delivery threshold pricing (already partially supported via
  `minOrder` / `deliveryFee`).

Wallet + subscription + referral are Phase E. Wallet specifically
has heavy compliance overhead in India (RBI regulations on PPI —
prepaid payment instruments) — be cautious about scope creep.

### 8. Notifications Engine — 🚧 Partial

**Shipped:**
- Order-status pushes (Phase 12+).
- PR 16 — shop new-order alert.
- PR 24 — push token cleanup on sign-out (today!).

**Gaps:**
- No engagement notifications (lunchtime nudge, restock alert,
  price drop, dormant-user reactivation).
- No notification preferences screen (user can't opt out of types).
- No A/B testing or send-time optimization.

**Recommendation:** Phase C — proactive notifications powered by AI
(time-of-day patterns, frequency, content personalization).

### 9. Vendor/Store Dashboard — ✅ Mostly shipped

**Shipped:**
- Shop owner dashboard with orders by status (PR 7, PR 16).
- Menu management screen: add, edit, remove items, set price /
  stock / availability (Phase 12a-v2-ii).
- Image upload for menu items (PR 6 + PR 6.1).
- Shop settings: delivery fee, min order (PR 5).
- ETA workflow (PR 12).
- Bulk operations (PR 8).

**Gaps:**
- No analytics dashboard for the shop owner (today's revenue, weekly
  trends, top items, customer counts). Phase D candidate.
- No promotion/offer creation by shop owners (would tie into Phase B
  coupon work).

### 10. Delivery Partner App — ✅ Mostly shipped

**Shipped:**
- Dashboard with Available pickups + Heads-up coming-soon + My
  active deliveries + History (Phase 12b, PR 12, PR 23).
- Order detail screen with addresses, items, deliver-to phone (PR 23).
- Map links (deep-link to Google Maps).
- Pickup + Delivered transitions (Phase 12b).
- Online/offline status toggle.
- Push notifications for new pickups (Phase 12b).
- PR 22 — delivery instructions visible.

**Gaps:**
- No earnings dashboard / pay history.
- No route optimization for partners juggling multiple deliveries
  (rare on this model, but possible if we ever batch).
- No in-app partner-to-shop / partner-to-customer chat.
- No proof-of-delivery photo capture.

### 11. Customer Support System — ❌ Not built

**Shipped:** PR 7 customer cancel within window (self-service for
the most common support case) and the in-app Sentry-error
acknowledgement is the closest thing.

**Gaps:**
- No FAQ screen.
- No "contact support" button → ticket / email / WhatsApp.
- No refund-status visibility (the order shows "cancelled" but no
  explicit "₹X refunded to your card on date Y" line).
- No human-in-the-loop chat.
- No AI support assistant (clear Phase C item).

**Recommendation:** Phase B should include a **minimum viable
support flow**: FAQ + a "contact us" button that opens WhatsApp /
email pre-filled with order context. The AI support assistant
itself is Phase C.

### 12. Hyperlocal Intelligence — 🚧 Partial

**Shipped:**
- 1-km / pincode-based shop filtering (Phase 12a-v2-iii).
- COD-by-default for tier-2-friendly trust.

**Gaps:**
- No catalog variation by area (would need shop-tagged regional
  inventory).
- No festival / weather demand modeling.
- No tier-2-specific UX (e.g., simpler onboarding for less
  smartphone-fluent users).

**Recommendation:** Phase D / E item. Premature optimization right
now. Revisit once we have 100+ active shops across 3+ neighborhoods.

### 13. Dark Store / Warehouse Optimization — ⛔ Out of scope

**Reason:** Kirana Mart's operating model is a marketplace over
existing kirana shops, not a dark-store quick-commerce network. We
don't operate warehouses; we don't need dark-store selection, batch
routing, or predictive inventory placement. **Permanently out of
scope** unless the business model fundamentally pivots.

### 14. AI Features — ❌ Not built; high opportunity

See Section 3 below — full AI strategy.

### 15. Trust Features — ✅ Mostly shipped

**Shipped:**
- COD payment option (default for tier-2).
- Razorpay refund flow (PR 2) + customer self-service cancel (PR 7).
- Visible delivery fee + min order pre-payment (PR 5).
- Ratings + reviews (PR 20).
- Privacy: phone hidden from delivery partner until claim (PR 23 era).

**Gaps:**
- Privacy Policy + Terms of Service not yet hosted at a public URL
  or linked in-app — legal must-have before public launch.
- No visible refund-status timeline (Phase B item alongside support).
- Genuine-reviews proof (currently any rating counts; could add
  "verified purchase" badge — easy, since we already gate on
  delivered orders).

---

## Section 2 — Phased roadmap

Each phase has a theme, goal, and 3–6 PRs of work. PRs are
intentionally chunky enough to ship value and small enough to fit a
windsurf-prompt + 1–2 hour execution. PR numbers are sequential
starting from 25; the actual number when we write each prompt may
shift if we insert hotfixes.

### Phase A — Launch readiness (weeks)

**Goal:** unblock public launch. Everything family-test phase has
been deferring becomes mandatory before real users touch the app.

**PRs:**

| # | Theme | Why | Est |
|---|---|---|---|
| ~~PR 25~~ | ~~Privacy Policy + ToS hosted + linked in-app~~ | ~~Legal must-have. Draft already exists at `docs/privacy-policy.md`.~~ ✅ Shipped May 22 2026. | ~~1–2 hrs~~ |
| PR 26* | Sentry source-map upload via EAS secret | Currently stack traces are minified and useless. High debugging payoff. *Code committed May 22 2026; actual upload activates on the next `eas build --profile production` (deferred to App-Store-prep). | 30–45 min |
| ~~PR 27~~ | ~~Background-tap protection on retry/cancel buttons~~ | ~~Real UX bug — testers can double-tap and cause duplicate Razorpay sessions.~~ ✅ Shipped May 22 2026. | ~~45 min~~ |
| PR 28 | Production Firebase project (`grocery-mvp-prod`) setup | Single biggest pre-launch task. Documented in PRELAUNCH_CHECKLIST. | 1–2 days |
| PR 29 | Razorpay LIVE keys + webhook secret rotation | Currently on test keys; can't accept real payments. Tied to PR 28. | 1–2 hrs after PR 28 |
| PR 30 | App Check enforcement on all callables | Documented intentional defer; flip after native modules are wired. | 1 day |

**Exit criterion for Phase A:** the app can be published to TestFlight
internal testing on a brand-new build with the production Firebase
project, live Razorpay keys, App Check enforced. Public launch ready
(distinct from public launch executed).

### Phase A2 — Shop onboarding (the launch blocker we keep underestimating)

**Goal:** turn Kirana Mart from "tech demo with 8 seeded shops" into
"a platform a real kirana owner can sign up to, get their catalog in,
and start taking orders." This is the hardest phase strategically —
not because the code is hard, but because the *human* on the other
side is a 45-year-old shop owner who has never used a vendor app and
has 800 SKUs scribbled in a notebook.

**Why it sits between A and B:** Phase A unblocks the legal/payment
plumbing for launch, but launching with 8 mock Delhi shops would be a
worse outcome than a 4-week delay. Phase B (retention features) is
pointless if there are no shops to retain customers on.

**Operating model:** assisted + self-serve hybrid. You (or a field
rep) visit the first 50–100 shops with a phone, use the AI-assisted
tools to set them up in ~30 minutes, then hand the shop owner a
simpler self-serve flow for day-to-day updates. Self-serve registration
ships in PR 31 but is gated behind admin KYC approval, so we control
quality without bottlenecking on manual data entry.

**The AI bet:** the established players' onboarding flows are forms.
We can leapfrog them because the shop owner can photograph their
existing rate-list, speak in Hindi, and have the catalog materialize.
This is one of the highest-ROI uses of LLMs in this app — it converts
"4 hours of typing" into "30 minutes of conversation," which is the
difference between shops actually signing up and not.

**PRs:**

| # | Theme | Why | Est |
|---|---|---|---|
| ~~PR 31~~ | ~~Shop KYC document upload (storefront + GST/FSSAI/owner-ID)~~ | ✅ Shipped May 22 2026. IAM fix (Service Account Token Creator on the Gen 2 runtime SA) also unblocked PR 6.1 menu-image upload as a side effect. Documented in `.windsurf/deploy-discipline.md`. | ~~1 day~~ |
| ~~PR 31.1~~ | ~~Admin shop-review polish (3 small items)~~ | ✅ Shipped May 22 2026 — tappable lat/lng, rejection reason card, KYC docs post-approval. 627/627 tests. | ~~1–1.5 hrs~~ |
| ~~PR 32~~ | ~~AI photo-to-catalog ingestion~~ | ✅ **Shipped May 23 2026.** First AI feature live. `functions/src/aiHelpers.ts` substrate established for all Phase C reuse. `aiAuditLog/` confirms cost per scan ~₹0.3–0.5. Mission North Star hero metric (time-to-first-menu-item) moved from 4 hours → ~15 minutes. | ~~4–6 hrs~~ |
| PR 33 | Shared master product catalog + smart price suggestions | New `products/{productId}` master collection (Aashirvaad atta 5kg, Amul milk 500ml, ...) so two kiranas don't re-create the same SKU with different names. Shop catalog references master products + adds shop-specific price/stock. AI suggests prices based on comparable shops in same pincode. Tied to PRELAUNCH line 418 (`syncCatalogToAllMenus`). | 1 day |
| ~~PR 34~~ | ~~Voice + Hindi-language onboarding assist~~ | ✅ **Shipped May 24 2026.** iOS native build 15 live on TestFlight. Tested: language picker, multi_field big-CTA, per-field mics all functional. Mission North Star metric for non-English-fluent shopkeepers now empirically reachable. | ~~4–5 hrs~~ |
| PR 35 | Field-rep assisted onboarding mode | A "Field Rep" role (separate from admin) that can onboard a shop on the owner's behalf during an in-person visit: capture documents, photograph the shelf, walk through the catalog. The shop owner takes over at the end with a single OTP. Lets us scale the first 100 shops with 1–2 field reps. | 3–4 hrs |

**Exit criterion for Phase A2:** A real shop owner Sudhir has never
met can be onboarded end-to-end in under 45 minutes (with a field
rep) or under 90 minutes (fully self-serve), and their catalog is
80%+ correct after AI ingestion + their 10-minute review. We have
5–10 real shops live before any public-launch marketing.

**Out of Phase A2, deferred to Phase D:**
- Bulk CSV/Excel import (PRELAUNCH line 404) — only matters once a
  shop has 100+ SKUs *and* an existing digital inventory. The first
  100 shops will not.
- WhatsApp-bot onboarding — interesting, but Phase A2's in-app +
  field-rep flow covers the first 100 shops. Revisit at scale.
- Multi-shop ownership (PRELAUNCH line 462) — single-shop per owner
  is fine until we onboard our first chain.

### Phase B — Merchant retention + customer trust (the pilot phase)

**Goal:** ship the features that make merchants open the app on
zero-order days (CRM + Udhaar) AND the features that make customers
come back (visual tracking + refund visibility + support). After
this phase + Phase A2, the pilot is genuinely ready.

**Strategic principle 4 in action:** PR 36 and PR 37 are pilot-
critical. They are the daily-use hooks that determine whether the
"will merchants pay ₹299/month" validation goes yes or no.

**PRs:**

| # | Theme | Why | Est |
|---|---|---|---|
| ~~PR 36~~ | ~~Customer CRM screen for shop owner~~ | ✅ **Shipped May 24 2026.** Top / Recent / Stopped 30d+ tabs; period selector; tap-to-call; analytics auto-flow to `featureUsageLog/` via PR 38.1 routing. Schema correction Windsurf caught: `customerUid` + `deliveryAddress` (not `userId` + `address` as my prompt drafted) — cross-check pattern working as designed. | 1–1.5 days |
| PR 36.1 | **Pilot UX polish bundle (2 parts; cold-start fix deferred)** | (a) Countdown timer alongside absolute pickup time ("Ready in 22 minutes (by 7:30 PM)") on customer-side `OrderDetailScreen`. (b) "Favorites only" filter pill on `ShopListScreen` / `SearchScreen` (favorites already exist via PR 19; just missing this filter). **Originally also included a cold-start fix for the 4–5 s shop-side status-change delay; Sudhir confirmed cold-start diagnosis (first tap 1 s after deploy, second tap 1 s — fully warm; original 4–5 s was cold) and chose to defer the `minInstances: 1` fix per cost-conservative pilot stance.** Shop owners experience the cold-start hit 2–3× per day; subsequent taps are fast. | 3 hrs |
| ~~PR 37~~ | ~~Digital Udhaar / Khata ledger~~ | ⛔ **Deferred from pilot (Sudhir's call May 24)** — build on demand if pilot shop owners request credit-tracking. Speculative without demand signal; rather not bloat pilot scope. Full design preserved in `docs/pr-37-digital-udhaar-khata-ledger-windsurf-prompt.md` for fast pickup if/when demand surfaces. | ~~2–2.5 days~~ |
| ~~PR 37.1~~ | ~~Customer-initiated udhaar payment + per-customer approval~~ | ⛔ **Deferred from pilot (Sudhir's call May 24)** — depends on PR 37 which is itself deferred. Design captured as the largest follow-up under PR 37's PRELAUNCH entry. | ~~~3 days~~ |
| ~~PR 38~~ | ~~Admin feature-usage dashboard + analytics expansion~~ | ✅ **Shipped May 24 2026** (PR 38 + PR 38.1 hotfix). PR 38 added ~22 new shop/delivery/admin analytics events + the `featureUsageLog/` collection + the AdminUsageScreen dashboard. PR 38.1 routed reads/writes through callables (`logFeatureUsageEvent`, `queryFeatureUsageLog`) after a same-day diagnostic that direct Web-SDK Firestore calls silently failed on native — same root cause as PR 6.1. Permanent discipline-doc rule added so future Firestore-from-client PRs prevent this at prompt-writing time. Strategic Principle 7's three pilot metrics are now queryable from day 1 of pilot. | 1.5–2 days (PR 38) + 1.5–2 hrs (PR 38.1) |
| PR 39 | Minimum viable customer support | FAQ screen + "Contact us" → WhatsApp deep link with pre-filled order context. | 2–3 hrs |
| PR 40 | Visual order-status timeline + delay banner | Most-requested UX from quick-commerce comparison; doesn't need live map. | 3–4 hrs |
| PR 41 | Refund status visibility | "₹X refunded to your card on date Y." Tied to existing Razorpay refund flow. | 2 hrs |
| PR 42 | Shop substitution UI (closes PR 21 loop) | Shop owner can swap an item and customer is notified per their preference. | 4–5 hrs |
| PR 42.1 | **Separate shop + delivery ratings** (Sudhir's May 24 observation) | Extends PR 20's single per-order rating into two distinct stars: **shop quality** (product, packaging, freshness) and **delivery experience** (timeliness, partner conduct). New `deliveryRating` aggregate on the delivery-partner user doc (mirror of `ratingAvg` + `ratingCount` on shop). Customer UI: two star pickers in the rating sheet. Admin UI: surfaces delivery partner rating on UserDetailScreen. Deferred from pilot (single rating is enough for ~150 ratings/month pilot scale); ships in Phase B post-pilot polish. | 1 day |
| PR 43 | Low-stock alerts to shop owner | Defensive: prevents the "ordered but unavailable" trust break. | 2–3 hrs |
| PR 44 | "Delivery ETA before payment" on checkout | Last frictionless-checkout gap from competitor list. Manual ETA, no ML. | 2 hrs |
| PR 45 | Basic coupon system | Admin-defined codes, percentage / flat off, expiry, per-user limit. Defers from previous slot — coupons are a growth lever after pilot, not a pilot blocker. | 4–6 hrs |
| PR 46 | Notification preferences screen | Customer can mute marketing vs transactional. Compliance + UX. | 2–3 hrs |

**Exit criterion for Phase B:** A pilot shop owner uses the app
≥3 days a week even when no new orders arrive (Customer CRM is
the primary daily-use hook; Udhaar deferred until shops request
it — Sudhir's call May 24). A pilot customer places a 2nd order
within 30 days at ≥30% rate (visual tracking + refund visibility
close the trust loop). If the merchant-weekly-active number
isn't hit with just CRM, that's the signal to revisit PR 37
(Udhaar) on demand. Otherwise, do NOT progress to Phase C —
re-work Phase B until the numbers hit.

### Phase C — AI differentiation (the moat)

**Goal:** ship 3–4 AI-powered features that established players don't
have because they were built before LLMs were cheap. This is where
Kirana Mart competes against Zepto/Blinkit not on speed but on
intelligence.

See Section 3 for the architectural details. The Phase A2 AI work
(photo-to-catalog, voice-Hindi, smart price suggest) already lays
down `functions/src/aiHelpers.ts`, so the customer-facing PRs reuse
the same plumbing.

**Strategic principle 3 in action:** every PR in Phase C must
solve a real friction point with measurable lift, not be a vanity
"we have AI" feature. The customer-facing AI items below (PR 46
shopping assistant, PR 47 auto-replenishment, etc.) are deferred
until the pilot's repeat-order metric is healthy; if customers
aren't coming back without AI, adding AI doesn't fix that. Phase A2
AI (PR 32 + PR 34) ships first because those address shop-side
onboarding friction directly.

| # | Theme | Why | Est |
|---|---|---|---|
| PR 47 | AI shopping assistant ("what do I need for X") | Customer types/speaks a recipe or event; LLM returns a categorized list mapped to the current shop's menu. **Deferred until pilot validates repeat order**; not a pilot feature. | 4–6 hrs |
| PR 48 | Auto-replenishment recommendations | "You usually buy milk every 3 days — running low?" Scheduled job + push. **Phase C item — needs ≥30 days of order history per customer to be meaningful.** | 4–5 hrs |
| PR 49 | Personalized "you might also like" on shop screen | Server-side LLM-generated suggestions based on order history + current cart. | 4 hrs |
| PR 50 | Review sentiment + summarization | Shop rating now includes "Customers mention: fast delivery, fresh atta, sometimes late on weekends." | 3 hrs |
| PR 51 | AI support assistant | Triages support tickets, drafts refund-eligibility answer, escalates to human only when needed. | 5–7 hrs |
| PR 52 | AI typo-tolerant search rewrite | LLM expands "haldi powder" → "turmeric / haldi / haldi powder / besan haldi" against the master catalog. Closes the typo-tolerance gap from category 3. | 3–4 hrs |
| PR 53 | **AI-assisted express ordering** (Sudhir's idea — May 2026) | Customer says/types in WhatsApp-style natural language ("I want milk, atta, and 2 packs of biscuits from Sharma General Store") → LLM parses → app maps to actual menu items → drops the user directly on the checkout screen with the cart pre-filled. Faster than browse-and-tap for repeat orders. Reuses `aiHelpers.ts` substrate. Future-WhatsApp-channel-compatible. | 5–7 hrs |
| PR 53.1 | **Smart substitution with real-time approval** (Sudhir's May 24 observation) | Layers on top of PR 21 (preference captured) + PR 42 (shop substitution UI). Two new pieces: (a) **AI "best match" recommendation** — when shop owner needs to substitute, the `aiHelpers.runClaude` substrate suggests the closest in-stock alternative ranked by category + price + brand similarity; shop owner picks from the ranked list with one tap. (b) **Real-time customer approval flow** — instead of falling back to the pre-set preference, push to the customer with the proposed substitute side-by-side with the original; customer taps Accept / Reject within 5 min; on timeout, fall back to the preference. Multi-day. Phase C — wait until customer-side AI is justified by pilot signal. | 2–3 days |

**Exit criterion for Phase C:** Kirana Mart has a clear AI-assist
chip on the home screen. Each AI feature has a measurable lift over
non-AI baseline (recommendation CTR, basket size, support deflection
rate).

### Phase D — Operations + scale

**Goal:** the dashboards and tooling that let the business grow past
10 active shops without breaking. Less customer-facing, more
operator-facing.

| # | Theme | Why | Est |
|---|---|---|---|
| PR 54 | Shop owner analytics dashboard | Revenue, top items, customer count, rating trend. Layered on top of PR 36's Customer CRM. (Distinct from PR 38's admin-side feature-usage dashboard — this one is the SHOP owner's view of their own business.) | 4–5 hrs |
| PR 55 | Delivery partner earnings dashboard | Pay history, per-week summary, ratings. | 3 hrs |
| PR 56 | Admin reports + exports | CSV exports of orders, payouts, refunds. | 3 hrs |
| PR 57 | Visual order tracking with map (long-deferred Phase 1 item) | Only if testers actually ask for it; otherwise skip. | 1–2 days |
| PR 58 | Hyperlocal catalog variation | Shop-tagged regional / festival inventory. Phase only if we hit 100+ shops. | 1 day |
| PR 58a | Bulk CSV/Excel catalog import for shops | Deferred from Phase A2. Only matters once shops have 100+ SKUs in an existing system; first 100 shops don't. | 3 hrs |
| PR 59 | **WhatsApp-channel express ordering** (extension of PR 53) | Customer messages a WhatsApp business number with the same natural-language order; the same `aiHelpers` parser drops them to a checkout deep-link in the app. Adds Twilio / Meta WhatsApp Business API plumbing. Only worth building once PR 53's in-app version proves the parser works reliably. | 1 day |

### Phase E — Loyalty + repeat (later)

**Goal:** the membership / wallet / referral mechanics that drive
20%+ order-frequency lift. Heavy compliance overhead; only worth it
once the unit economics support it.

| # | Theme | Why | Est |
|---|---|---|---|
| PR 60 | Referral rewards | Customer invites → cash credit on both sides. Simple, no wallet needed. | 2–3 hrs |
| PR 61 | Wallet / store credit (no RBI PPI complications) | Internal credit, not externally redeemable. Lighter compliance. | 4–5 hrs |
| PR 62 | Subscription tier ("MeraYara+" or similar) | Free delivery + small discount; psychological lock-in. **Also: the merchant-side ₹299/month subscription validation lives here** — separate billing surface for shops once Phase B's CRM + Udhaar prove they actually use the platform daily. | 1 week |
| PR 63 | Streak / gamification rewards | "5 orders this month — ₹50 off next." | 2 hrs |

---

## Section 3 — AI integration strategy

LLM API costs have collapsed in the last 12 months. Claude Haiku is
~$0.25 per million input tokens, $1.25 per million output. A typical
in-app AI assistant interaction is < 2k tokens total. **At
₹10/order in unit economics, AI cost per order is effectively a
rounding error.** This is the window of advantage — the established
players' apps were built before LLM cost dropped this far, and
retrofitting AI is harder than building with it from day one.

### Architecture choice: server-side via Cloud Functions

**Decision:** all AI calls go through Cloud Functions, not from the
client. Reasoning:
- API key stays out of the mobile bundle (never expose it).
- One place to rate-limit per user (defend against abuse).
- Easier to swap models (Haiku → Sonnet → next-gen) without app
  updates.
- Can cache common responses server-side.
- Plays nicely with the existing function deployment + monitoring.

**New file:** `functions/src/aiHelpers.ts` — wraps the Anthropic SDK,
adds rate-limit + auth + audit logging, exposes a typed `runClaude`
helper that domain-specific helpers (recommend, summarize, support)
import.

**Secret management:** `firebase functions:secrets:set
ANTHROPIC_API_KEY --project grocery-mvp-prod`. Per PRELAUNCH_CHECKLIST
patterns, store separately from Razorpay keys.

### Feature-by-feature

#### 3.1 AI Shopping Assistant (PR 47)

**User experience:** chip on Home or Shop screen labeled "Ask AI" or
"What do I need for ___?" Customer types a recipe / event ("paneer
butter masala for 4 people", "kids' lunchbox for the week", "diwali
sweets prep"). AI responds with a categorized shopping list, then
offers a one-tap "Add all to cart" button that maps the suggestions
to actual items in the nearest open shops.

**Implementation:**
- Cloud Function `getAiShoppingList` takes the user's prompt + their
  current shop's menu (or top-3 nearby shops' menus).
- Claude Haiku gets system prompt: "You are a kirana shopping
  assistant for an Indian household. Given the menu items below and
  the user's request, return a JSON list of items with quantities."
- Server validates the JSON, joins back against actual menu items
  (semantic match — exact name match first, fuzzy fallback), returns
  to the client.
- Client renders as a card with checkmarks per item, "Add all" CTA.

**Cost estimate:** ~500–1000 input tokens (menu) + ~300 output
(suggestions). With Haiku, that's < ₹0.10 per assistant call. Even
if every customer used it twice per visit, daily AI cost across 1000
DAU is ~₹200.

#### 3.2 Auto-replenishment (PR 48)

**User experience:** scheduled task runs daily at 9 AM. For each
active customer, the system looks at their order history — items
they buy at predictable cadence (milk weekly, atta monthly, oil
fortnightly). When a cadence-based reorder is due, send a gentle
push: "Your milk is probably running out — reorder?" with a one-tap
add-to-cart button.

**Implementation:**
- Scheduled Cloud Function (`pubsub.schedule('0 9 * * *')`) iterates
  active customers.
- For each customer's last 60 days of orders, group items, infer
  cadence per item using simple statistics (mean gap, stddev).
- Items past their predicted reorder date with high-confidence
  cadence (low stddev) get queued for a push.
- LLM optional here — for v1, plain heuristics + handcrafted copy.
  v2 adds LLM-generated personalized copy ("It's been 8 days since
  your last milk — want us to grab some?").

**Cost estimate:** zero LLM call on v1. v2 adds ~200 tokens per
notification, so even at 1000 daily nudges, costs < ₹100/day.

#### 3.3 Personalized "you might also like" (PR 49)

**User experience:** on the shop detail screen, a small "Suggested
for you" rail above the regular menu. Items the LLM thinks this
specific customer might want, given their order history + current
shop's menu.

**Implementation:**
- Cloud Function `getPersonalizedSuggestions` takes customer's order
  history (last 30 orders, redacted to item names) + the shop's
  available menu.
- Claude Haiku gets system prompt: "Given this customer's purchase
  history and the items available at this shop, suggest 3–5 items
  they might want today. Return JSON: [{ menuItemId, reasonShort }].
  Reasons must be human-friendly, not generic."
- Cache result per (customerUid × shopId) pair for 24 hours to keep
  cost bounded.

**Cost estimate:** ~800 tokens × 1 call per (customer, shop, day) =
₹0.02 per call. Cache cuts that further. Negligible.

#### 3.4 Review sentiment + summarization (PR 50)

**User experience:** on the shop card, instead of just "4.3★ (127
reviews)," show a one-line LLM-generated summary: "Customers say:
fast delivery, fresh atta, sometimes late on weekends."

**Implementation:**
- When a new rating + comment lands, scheduled function batches new
  reviews (every 6 hrs).
- Claude Haiku given the comments for that shop, produces a 1–2
  sentence summary + sentiment categories.
- Stored on the shop doc under `ratingSummary`.
- Client just reads the field; no AI call at view time.

**Cost estimate:** ~500 tokens per shop summary, refreshed every 6
hours. For 100 shops, that's < ₹1/day. Trivial.

#### 3.5 AI support assistant (PR 51)

**User experience:** "Contact support" → chat-like UI. AI handles
common cases (where's my refund, why was my order cancelled, how
do I change address) by reading the user's actual order data and
responding with the specific answer. Escalates to a human only when
the AI can't confidently answer or when the user explicitly asks.

**Implementation:**
- Cloud Function `aiSupportAssistant` takes user's question + last
  10 orders (with sensitive data masked).
- Claude Haiku with system prompt explaining the kirana model + the
  callable tools (e.g., `lookupRefundStatus(orderId)`).
- Anthropic's tool-use mode lets the AI call back to your functions
  for specific data, then formulate the answer.
- Conversation history stored in `supportConversations/{convId}` for
  audit.

**Cost estimate:** ~2000 tokens per interaction (system prompt +
context + response). Per-deflected ticket cost vs human time: huge
ROI even at modest deflection rates.

### Shop-side AI (Phase A2 — onboarding)

The PRs in Phase A2 use the same `aiHelpers.ts` plumbing but
target the shopkeeper, not the customer. Each one is an explicit
bet that LLMs let us skip a category of human data-entry work that
the established players still impose on their merchants.

#### 3.6 Photo-to-catalog ingestion (PR 32)

**User experience:** during shop onboarding, the shopkeeper opens
"Add menu" → taps "Scan rate-list" → photographs their existing
printed/handwritten rate-list, or a few shelf photos. AI returns a
structured draft menu: 30–80 SKUs with brand, weight/pack-size, MRP,
sell price, category. Shopkeeper reviews row-by-row, accepts or
edits, taps "Add to my menu." A 4-hour data-entry task becomes a
~15-minute review.

**Implementation:**
- Client compresses image(s) to ~1024px JPEG, uploads to Storage
  under `pendingMenuExtractions/{shopId}/{ts}.jpg`.
- Cloud Function `extractMenuFromImage` calls Claude (Sonnet, vision)
  with a structured-output prompt: "Extract every visible product
  into JSON: [{ brand, productName, packSize, unit, mrp, sellPrice,
  categoryGuess }]. If a field is illegible, use null."
- Server joins the extracted rows against the master product catalog
  (3.7) via name + pack-size match; unmatched rows become "new
  product" candidates the admin can promote into the master catalog.
- Returns the draft to the client; client renders an editable list
  with confidence badges; "Add all approved" callable batch-writes
  into the shop's menu subcollection.

**Cost estimate:** Sonnet vision call ~3–5k input tokens (image +
prompt) + ~2k output for a 50-SKU rate-list. ~₹3–5 per shop onboarded.
A field rep's hour costs orders of magnitude more.

#### 3.7 Shared master product catalog (PR 33) — AI-assisted curation

**User experience (admin-facing):** admin sees a queue of "new SKU
candidates" from photo extractions. AI has already attempted to
deduplicate ("Ashirvad atta 5kg" ≈ "Aashirvaad Atta 5 kg") and
suggest the canonical name, category, and pack-size. Admin accepts
or merges; the master product gets created.

**User experience (shopkeeper-facing):** when adding an item, shop
owner types "atta" → autocompletes from master catalog; picks the
right SKU; just sets their own price + stock. No re-creating
duplicate SKUs across shops.

**Smart price suggestion:** when shopkeeper picks a master product,
the form pre-fills suggested price from the median of comparable
shops in the same pincode (+/- 5% band). LLM optional here — straight
SQL/Firestore aggregation does it; AI just generates a one-line
explanation ("Most shops near you sell this for ₹245–₹260").

**Cost estimate:** dedupe call ~500 tokens per new SKU candidate.
At 100 SKUs/shop × 100 shops = trivial.

#### 3.8 Voice + Hindi onboarding assist (PR 34)

**User experience:** during onboarding, shopkeeper can tap a mic
button on any field and speak instead of typing. For full sections
(shop description, address, opening hours) they can speak a
paragraph in Hindi (or regional language); AI fills the right
fields in the right format ("मेरी दुकान सुबह 7 बजे से रात 10 बजे
तक खुलती है" → openTime: 07:00, closeTime: 22:00).

**Implementation:**
- Client records audio (expo-av), uploads to Storage.
- Cloud Function `transcribeAndStructure` calls a speech-to-text
  service (Anthropic doesn't do audio directly — use Google
  Cloud Speech or Whisper via OpenAI-compat endpoint; we'll
  evaluate at PR-34 time which is cheaper for Indian languages).
- Transcript handed to Claude Haiku with the field schema for
  whichever onboarding step the user is on; returns structured JSON.
- Client confirms each parsed field before saving.

**Cost estimate:** STT dominates — ~₹0.50–₹2 per minute of audio
depending on provider. Haiku post-processing is rounding error. Per
shop onboarded with full voice usage: < ₹20.

#### 3.9 (Future, post-Phase A2) WhatsApp onboarding bot

Deferred but noting it here so the AI architecture doesn't pre-empt
it. The same `aiHelpers` + `extractMenuFromImage` Cloud Function
that PR 32 ships can be reused behind a Twilio/Meta WhatsApp Business
webhook later — shopkeeper messages the bot their rate-list photo
and a few details, bot drives the onboarding via WhatsApp. Phase D
candidate once Phase A2 proves the in-app version works.

### Rate limiting + abuse defense

Every AI callable:
- Requires auth (`request.auth` present).
- Per-uid daily quota (e.g. 50 AI calls/day for shopping assistant,
  10 for support, 5 photo-to-catalog extractions per shop per day).
- Server-side caching where applicable (suggestions, summaries,
  master-catalog dedupe results).
- Auditable log entry per call (uid, function, token cost, timestamp).
- Per-feature kill-switch (`aiFeatures/{name}.enabled`) so a runaway
  cost or quality regression can be stopped without a deploy.

### Why this is a real moat (not hype)

The customer-facing AI features above each give measurable lift:
- Recommendations → +basket size and +items/order.
- Auto-replenishment → +retention via reactivation.
- AI assistant → conversion of browse-only sessions to orders.
- Support deflection → -support cost and +response speed.

The shop-side AI features (Phase A2) compound this on a separate
axis: **lower friction to onboard supply.** Established players have
existing merchant bases and can afford slow, form-based onboarding.
A new entrant cannot. Photo-to-catalog + voice-Hindi take the
shopkeeper's setup from "I'll do it on the weekend" (which means
never) to "let's do it now while you're here." That's the difference
between 50 shops and 500 in the first 6 months.

Established players will catch up eventually. But for a 12–18 month
window, **a fresh app built AI-first has a real product advantage
that doesn't require winning on delivery speed or warehouse density.**

---

## Section 4 — Decisions deferred / out of scope

Capturing things we deliberately choose NOT to do, so future Claude
sessions don't have to re-litigate.

| Item | Decision | Reason |
|---|---|---|
| Dark store / warehouse optimization | ⛔ Out of scope, permanently | Kirana marketplace model, not quick-commerce. Different business. |
| ML-based ETA prediction | ⛔ Deferred 6+ months | Manual shop-owner ETA is more accurate at our data scale. Revisit at 1M+ orders. |
| Live delivery-partner GPS on map | ⛔ Deferred to Phase D | High eng cost (battery, geofencing, infra) for marginal trust gain on short kirana deliveries. |
| Voice search | ⛔ Deferred to Phase E+ | Native voice infra is heavy; LLM-based dictation could replace it but isn't a priority. |
| Wallet (RBI PPI flavor) | ⛔ Out of scope unless we get a PPI license | Heavy compliance for marginal gain over internal store credit. |
| `@react-native-firebase/messaging` migration | ⛔ Keep Expo Push | Existing setup works; migration risk outweighs benefit. Documented in PRELAUNCH. |
| Production Firebase split before family-test stabilizes | ⛔ Deferred until 1–2 weeks quiet from testers | Premature; would create two backends to sync. |
| Multi-language UI | ❌ Not in roadmap yet | Will need eventually for tier-2/3; revisit when geography expands. PR 34 (voice-Hindi onboarding) is a narrower precursor — input-only, not UI translation. |
| Bulk CSV/Excel catalog import for shops | ⛔ Deferred from Phase A2 to PR 54a | The first 100 shops won't have an existing digital inventory to import. PR 32 (photo-to-catalog) covers their reality better. Revisit when an onboarding shop legitimately asks for CSV import. |
| WhatsApp-bot shop onboarding | ⛔ Deferred to Phase D (3.9) | In-app + field-rep covers the first 100 shops. WhatsApp adds infra (Twilio/Meta Business webhook, message templates) for marginal additional reach until we hit scale. |
| Multi-shop ownership pre-launch | ⛔ Deferred until first chain signup | Phase 12a hard-caps one shop per owner. Documented in PRELAUNCH line 462. Not blocking launch; not blocking the first 100 single-owner kiranas. |
| Map-based live delivery tracking in onboarding/Phase A2 | ⛔ Phase D (PR 53) at earliest | Onboarding doesn't depend on it. Stays where it is in Phase D. |
| Direct AI calls from the mobile client | ⛔ Permanently | All AI goes through Cloud Functions per Section 3 architecture decision. Protects the API key and gives us one rate-limit point. |
| Multi-category expansion (pharmacy / bakery / electronics / hardware / etc.) | ⛔ Deferred until month 12+ at earliest | Each category has different workflows, regulations (pharmacy needs prescription compliance), and unit economics. Pilot must prove single-category (kirana grocery) viability first. Reviewed 2026-05-22 against a ChatGPT-suggested multi-category pivot; declined. See Strategic principle 1 at the top of this doc. |
| WhatsApp as the primary customer ordering channel | ⛔ Permanently rejected for primary flow | Loses structured order data, payment processing, dispute resolution, repeat-order analytics, push notifications, the Customer CRM (PR 36) that's our biggest merchant differentiator. **WhatsApp as a future AI-shortcut layer is in scope** (PR 59, Phase D, layered on top of PR 53's parser) — but only as a *deep-link into the app*, never as the source-of-truth channel. Reviewed 2026-05-22 against ChatGPT's WhatsApp-first suggestion; declined. See Strategic principle 2. |
| Drop delivery for a pure merchant-tools product | ⛔ Rejected | Customers expect delivery because Blinkit/Zepto trained them to. "MeraYara without delivery" loses to "call the shop directly." Strategic principle 5. |
| Speculative customer-facing AI before pilot validates repeat-order | ⛔ Deferred until pilot proves repeat-order rate ≥30% | If customers aren't coming back without AI, adding AI doesn't fix the underlying issue. PR 32 + PR 34 (shop-side AI) ship pre-pilot because they address known onboarding friction with measurable lift. PR 47–53 (customer-side AI) wait for pilot signal. Strategic principle 3. |
| Digital Udhaar / Khata ledger (PR 37) in pilot scope | ⛔ Deferred until pilot shop owners request credit-tracking | Sudhir's call May 24 — speculative without demand signal. The CRM (PR 36) is the one daily-use hook the pilot needs to validate the merchant retention thesis. If shops report wanting digital khata during pilot, PR 37 + 37.1 prompts are preserved in `docs/` for fast pickup. Saves ~5–6 days of pre-pilot build that would otherwise be guessing at demand. |

---

## Section 5 — How to use this doc

**When starting a new PR:**
1. Find which phase + PR in Section 2.
2. Confirm dependencies (e.g., PR 29 depends on PR 28; all Phase C
   AI PRs depend on PR 32's `aiHelpers.ts` plumbing from Phase A2).
3. Write the windsurf prompt as `docs/pr-N-<slug>-windsurf-prompt.md`.
4. Run through cross-check pattern (Claude prompt → Windsurf execute →
   Sudhir review).

**When evaluating a new feature request not in this doc:**
1. Map it to one of the 15 categories in Section 1.
2. Decide: does it fit Phase A/B/C/D/E, or is it out-of-scope (Section 4)?
3. Update this doc with the decision before doing any work.

**When updating this doc:**
- Strike-through (~~text~~) shipped PRs in the phase tables; don't
  remove them — the history is useful.
- Bump the "Last reviewed" date at the bottom.
- Note major shifts in `docs/SESSION_LOG.md`.

**For AI in particular:**
- Section 3 is the architectural decision record. Implementation
  details belong in the per-PR prompts (PR 47–53). Phase A2's
  shop-side AI features (3.6–3.8 below) reuse the same plumbing.
  PR 53 (AI-assisted express ordering, Sudhir's idea logged
  May 2026) is the seventh Phase C subsection in spirit — see
  the Phase C table for the full description.
- If a new AI feature is requested, add it to Section 3 with the
  same template (UX, implementation, cost estimate) before promising
  to build it.

---

**Last reviewed:** 2026-05-24 (post-PR-34-live; PR 36 + 38
drafted and queued; **PR 37 + PR 37.1 deferred from pilot
scope per Sudhir's call** — build on demand if pilot shop
owners ask for credit-tracking. Prompts preserved for fast
pickup. Pilot sequence is now PR 38 → PR 36 → start pilot).

**Next review trigger:** when the pilot kicks off (validate the
Phase B exit criterion against real-world data); OR when 3 PRs
ship without being on this doc; OR when a major product
decision lands (brand-name commit, pivot to multi-category, etc.).
