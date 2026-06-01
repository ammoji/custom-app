# Play Console pre-fill pack — HamaraSetu

**Purpose:** Have every Play Console answer ready to paste the moment
your phone verification clears, so you flow through Play Console in
~30 minutes instead of 2 hours of fumbling.

**Status assumption when you use this:** Play Console identity
verified ✅. Phone verification pending (Google support case open).
App entry not yet created. Most of this pack stays useful regardless —
the answers don't change once Play unlocks.

**Sources of truth this pack references:**
- Privacy policy: `https://grocery-mvp-dev.web.app/privacy`
- Terms of service: `https://grocery-mvp-dev.web.app/terms`
- Brand constants: `src/constants/branding.ts`
- Bundle ID: `com.sudhirdavim.grocerymvp`

Keep this doc in `docs/` so future re-submissions (and the post-pilot
public launch) reuse the same answers — consistency across versions
matters to Play.

---

## Section 1 — App Content questionnaires (paste-ready)

These live under **Policy → App content** in Play Console. Each is a
small form. Answers below are HamaraSetu-specific.

### 1.1 Privacy policy

| Field | Value |
| --- | --- |
| URL | `https://grocery-mvp-dev.web.app/privacy` |

Verify the URL still resolves before submission. If you move to a
custom domain later (e.g., `kiranamart.in/privacy`), update here AND
in `app.json` `extra.legal`.

### 1.2 App access

Play reviewers need a way to log into a gated app. Phone OTP gates
everything in HamaraSetu, so we hand them a test phone number with a
fixed OTP whitelisted in Firebase Auth.

**Answer:** "All or some functionality is restricted"

**Instructions for reviewer (paste verbatim):**

> HamaraSetu requires phone-OTP login. To review the app, please use
> the following Firebase Auth test phone number:
>
> **Phone:** +91 9999999991
> **OTP:** 999911 *(or whichever 6-digit OTP you have configured for
> this number in Firebase Auth → Authentication → Settings → Phone
> numbers for testing)*
>
> This account has the customer role and can: browse shops, place
> orders (please select **Cash on Delivery**; do not use Online
> Payment to avoid Razorpay test transactions), and view order
> history.
>
> To review the shopkeeper role, please use:
> **Phone:** +91 9999999990
> **OTP:** *(your configured shopkeeper test OTP)*
>
> To review the delivery partner role:
> **Phone:** +91 9999999994
> **OTP:** *(your configured delivery test OTP)*

**Before submitting, confirm in Firebase Console → Authentication →
Sign-in method → Phone → Phone numbers for testing** that all three
numbers are present with the OTPs you cite above. Update the table
above with whatever numbers are actually whitelisted.

### 1.3 Ads

| Field | Value |
| --- | --- |
| Does your app contain ads? | **No** |

### 1.4 Content rating

When you take the questionnaire, the answers for HamaraSetu are:

- **Category:** Reference, news, or educational? → **No.**
  Then choose: **Other (Lifestyle apps)** or the closest match
  available. (Play sometimes routes grocery apps as "Lifestyle.")
- **Violence:** No.
- **Sexuality:** No.
- **Profanity:** No.
- **Controlled substances:** No (you don't sell alcohol/tobacco. If
  any pilot shop ever lists those, this answer changes — flag it.)
- **Gambling:** No.
- **User-generated content / social features:**
  - "Does your app allow users to interact / communicate?" → **No.**
    (The customer-shopkeeper-partner messaging is structured order
    updates, not free-form messaging. If you ever add chat, this
    changes.)
  - "Does your app share user-provided content?" → **No.**
- **Personal information sharing:** Yes — the app shares the
  customer's name, phone, and delivery address with the shop owner
  and the delivery partner of the order they placed. (Required for
  fulfilment.) Disclose this honestly; Play won't penalize for
  legitimate, disclosed sharing.
- **Location sharing:** Yes — same scope (customer's delivery
  location is shared with the order's shop owner + delivery partner
  only).
- **Digital purchases:** Yes — customers pay for goods through the
  app via Razorpay (third-party payment processor). Goods are
  physical (groceries), not digital, but Play counts the transaction
  itself.
- **Unrestricted internet access:** Yes.

**Expected rating:** Everyone (or "3+" / "All ages" depending on
region). If the questionnaire pushes to a higher rating, recheck the
violence/controlled-substances answers.

### 1.5 Target audience and content

| Field | Value |
| --- | --- |
| Target age group | **18 and older** (adults only) |
| Does the app appeal to children? | **No** |

Reasoning: payment-taking apps must target 18+ regardless of content;
this avoids COPPA-equivalent disclosures.

### 1.6 News app declaration

| Field | Value |
| --- | --- |
| Is this a news app? | **No** |

### 1.7 COVID-19 contact tracing or status apps

| Field | Value |
| --- | --- |
| Does the app provide contact tracing or COVID-19 status info? | **No** |

### 1.8 Government app declaration

| Field | Value |
| --- | --- |
| Is this app published or developed on behalf of a government? | **No** |

(Sara Stack Labs is private; even though the legal jurisdiction is
Faridabad, this answer is about who *publishes*, not where you operate.)

### 1.9 Health features

| Field | Value |
| --- | --- |
| Does the app contain health features? | **No** |

(Groceries that happen to be food are not "health features" in Play's
sense — that field is for fitness trackers, mental health, medical
device integrations, etc.)

### 1.10 Financial features

| Field | Value |
| --- | --- |
| Does the app provide any financial features? | **No** |

When the questionnaire opens, tick **"My app doesn't provide any
financial features"** at the bottom of the option list.

**Why "No" — important nuance** (this was a correction from an
earlier version of this pack, made after Sudhir reached this screen
during the May 28 submission):

The Play "Financial features" section is for apps that *are*
financial services themselves — wallets (Paytm, PhonePe, Google
Pay), banks, lenders, BNPL providers, crypto exchanges, insurance
apps, etc. HamaraSetu accepts payment for **physical groceries** via
Razorpay's SDK; that's standard e-commerce, not a financial feature
in Play's regulatory sense. Every Indian e-commerce app using
Razorpay or similar (Amazon India, Flipkart, Swiggy, Zomato,
BigBasket) answers No here. If you accidentally tick a category like
"Mobile payments and digital wallets," Play routes your review to
its fintech team and comes back asking for RBI / payment-aggregator
registration documents you don't have.

**The Razorpay disclosure already lives in Data Safety** (§2.2,
"User payment info — shared with Razorpay"). That's the right place
for payment-processor disclosure. Don't double-declare in Financial
Features.

### 1.11 Government identifiers

| Field | Value |
| --- | --- |
| Does the app collect government identifiers? | **Yes — shop owners only** |

Reasoning: customer flow does not collect any government ID. Shop
registration KYC collects either Aadhaar or PAN (Identity Proof) and
GST Certificate from prospective shop owners. Disclose this with the
note:

> "Government identifiers (Aadhaar OR PAN as identity proof; GST
> Certificate) are collected only from prospective shop owners during
> KYC, not from customers. KYC documents are stored in Firebase
> Storage with access restricted to platform admins. Compliance basis:
> CGST Section 24 mandates GST registration for online supplier
> intermediation."

---

## Section 2 — Data Safety form (the big one)

This is the section that takes longest in Play Console. Each data
type asks 4–5 follow-up questions. Below is the complete declaration
for HamaraSetu so you can fly through it.

### 2.1 Does your app collect or share user data?

**Yes.**

### 2.2 Per-data-type declarations

For each item: ✅ = "Yes, collected"; ❌ = "Not collected." For each
collected item: declare *Purpose*, *Required vs Optional*, *Shared
with third parties (Y/N + who)*, *Processed ephemerally (Y/N)*.

| # | Data type | Collected? | Purpose | Required? | Shared? | Ephemeral? |
| --- | --- | --- | --- | --- | --- | --- |
| **Personal info** |
| 1 | Name | ✅ | Account management, App functionality | Optional | No | No |
| 2 | Email address | ❌ | — | — | — | — |
| 3 | User IDs (UID) | ✅ | Account management, App functionality, Analytics | Required | No (internal only) | No |
| 4 | Address | ✅ | App functionality (delivery destination) | Optional (per-order) | Yes — shared with shop owner + delivery partner of the order placed (intra-platform) | No |
| 5 | Phone number | ✅ | Account management, Account authentication, App functionality, Communications | Required | Yes — shared with shop owner + delivery partner of the order placed | No |
| 6 | Race / ethnicity | ❌ | — | — | — | — |
| 7 | Political or religious beliefs | ❌ | — | — | — | — |
| 8 | Sexual orientation | ❌ | — | — | — | — |
| 9 | Other personal info (Government IDs) | ✅ — shop owners only | Account management (KYC compliance) | Required (for shop role only) | No (admin access only) | No |
| **Financial info** |
| 10 | User payment info | ❌ — *processed directly by Razorpay; not collected or stored by the app* | — | — | — | — |
| 11 | Purchase history | ✅ | App functionality, Account management | Required (auto-recorded on orders placed) | No | No |
| 12 | Credit score / Other financial info | ❌ | — | — | — | — |
| **Health and fitness** | All ❌ | | | | | |
| **Messages** | All ❌ (the order-update notifications are not user-authored messages) | | | | | |
| **Photos and videos** |
| 13 | Photos | ✅ — shop owners only (KYC storefront photo + menu item photos) | App functionality (shop identity verification + product display) | Required for shop role | No (storefront photos are public via shop listing — disclose this) | No |
| 14 | Videos | ❌ | — | — | — | — |
| **Audio files** |
| 15 | Voice or sound recordings | ✅ — *transient only, for the Hindi voice-onboarding feature; sent to Google Speech-to-Text + Anthropic Claude for parsing; not stored* | App functionality (voice-assisted shop registration) | Optional (feature opt-in) | Yes — Google Cloud Speech-to-Text + Anthropic | **Yes — processed ephemerally** |
| 16 | Music files / other audio | ❌ | — | — | — | — |
| **Files and docs** |
| 17 | Files and docs | ✅ — shop owners only (KYC: GST Certificate, Identity Proof, Shop Registration) | App functionality (KYC compliance) | Required for shop role | No (admin access only) | No |
| **Calendar** | All ❌ | | | | | |
| **Contacts** | All ❌ | | | | | |
| **App activity** |
| 18 | App interactions | ✅ | Analytics, App functionality | Optional (no UI to opt out yet — see TODO below) | No (internal analytics + Sentry crash reporter) | No |
| 19 | In-app search history | ✅ | App functionality | Optional | No | No |
| 20 | Installed apps | ❌ | — | — | — | — |
| 21 | Other user-generated content | ❌ | — | — | — | — |
| 22 | Other actions (e.g. likes) | ❌ | — | — | — | — |
| **Web browsing history** | ❌ | | | | | |
| **App info and performance** |
| 23 | Crash logs | ✅ | Analytics (debugging), Fraud prevention | Required (automatic) | Yes — Sentry | No |
| 24 | Diagnostics | ✅ | Analytics | Required (automatic) | Yes — Sentry | No |
| 25 | Other app performance data | ✅ | Analytics | Required (automatic) | Yes — Sentry | No |
| **Device or other IDs** |
| 26 | Device or other IDs (FCM token) | ✅ | App functionality (push notifications) | Required | No (Firebase Cloud Messaging = Google service provider, not a third-party share per Play's definition) | No |
| **Location** |
| 27 | Approximate location | ✅ | App functionality (delivery distance estimation, shop service radius gate) | Optional (per-order) | Yes — shared with shop owner + delivery partner of the order | No |
| 28 | Precise location | ✅ — when user selects "Deliver to current location" at checkout, or for delivery-partner reporting on dashboard focus | App functionality (delivery destination, partner-pickup sort) | Optional (user-initiated) | Yes — same scope | No |

### 2.3 Security practices section

| Question | Answer |
| --- | --- |
| Is all of the user data collected by your app encrypted in transit? | **Yes** — all client-server traffic is HTTPS/TLS (Firebase + Razorpay both enforce TLS). |
| Do you provide a way for users to request that their data be deleted? | **Yes — via support email** (currently `sarastacklabs@gmail.com`). **TODO (post-pilot):** add an in-app "Delete my account" flow. Until then, the email-based path is acceptable to Play. |
| Has your app committed to following the Google Play Families Policy? | **N/A** — app is 18+. |
| Has your data collection and handling been independently validated against a global security standard? | **No** — answer truthfully; no ISO 27001 / SOC 2 at this stage. |

---

## Section 3 — Main Store Listing copy

### 3.1 App name

- **Primary:** `HamaraSetu`
- **Subtitle option (if Play allows):** `HamaraSetu — Local Grocery`
  (within 30-char Play limit; 27 chars)
- **Devanagari note:** Don't put हमारा सेतु in the main name field —
  Play's name limit + Devanagari character width make it look
  cramped. Put it in the long description instead.

### 3.2 Short description (max 80 characters)

> **Order from your neighborhood kirana store. Hyperlocal grocery
> delivery.**

(74 chars — well within the 80 limit.)

Alternative if you want the tagline in: `Shop smart, shop local.
Order groceries from neighborhood kirana stores.` (78 chars.)

### 3.3 Full description (max 4000 characters)

Paste verbatim:

> **HamaraSetu (हमारा सेतु) — Your bridge to the neighborhood kirana
> store.**
>
> Shop Smart. Shop Local.
>
> HamaraSetu connects you with your neighborhood kirana shop for
> everyday groceries, delivered to your door. We're not a warehouse —
> we're your local shopkeeper, online.
>
> **For shoppers**
> - Browse shops in your neighborhood, see live distance and delivery
>   time
> - Order everyday essentials — atta, dal, oil, ghee, fresh produce,
>   personal care, and more
> - Transparent delivery charges that scale by distance — no hidden
>   fees
> - Pay your way: Cash on Delivery or secure online payment via
>   Razorpay (UPI, cards, wallets)
> - Track your order in real time, from "preparing" to "out for
>   delivery" to "delivered"
> - Save your favorite items at each shop for one-tap reordering
> - Rate your shop and delivery partner after each order
>
> **For shopkeepers**
> - Register your shop in minutes — guided KYC, voice-assisted Hindi
>   onboarding available
> - Manage your menu, prices, hours, and delivery charges from one
>   dashboard
> - Get notified instantly when a new order lands
> - Build a regular customer base; we don't compete with you for
>   inventory
>
> **For delivery partners**
> - See available pickups sorted nearest-first
> - Clear ride distance breakdown — partner-to-shop + shop-to-customer
> - Foreground-only location use — no battery-draining background
>   tracking
>
> **Why HamaraSetu?**
> Big delivery platforms run on dark stores and aggregated inventory,
> displacing the corner kirana. HamaraSetu inverts that — the kirana
> *is* the store, the shopkeeper *is* the brand, and the relationship
> is direct.
>
> **Operating area (pilot):** Ballabgarh, Faridabad. Expansion planned
> in phases.
>
> **Operating entity:** Sara Stack Labs, Faridabad, Haryana.
>
> **Support:** sarastacklabs@gmail.com
> **Privacy policy:** https://grocery-mvp-dev.web.app/privacy
> **Terms of service:** https://grocery-mvp-dev.web.app/terms

(~1900 chars including line breaks — well under the 4000 limit, with
room to extend.)

### 3.4 Categorization

| Field | Value |
| --- | --- |
| App category | **Shopping** (primary) |
| Tags | Choose 2–3 from: `Grocery shopping`, `Local services`, `Delivery`, `Marketplace`. (Tags are picked from Play's curated list, not free text.) |

### 3.5 Contact details

| Field | Value |
| --- | --- |
| Email | `sarastacklabs@gmail.com` *(per `src/constants/branding.ts` `SUPPORT_EMAIL`; switch to `sarastacklabs@gmail.com` post-pilot when the email migration happens — flagged in CLAUDE.md)* |
| Phone | Optional — leave blank for pilot, add a support number before public launch |
| Website | `https://grocery-mvp-dev.web.app` *(or a marketing site once one exists)* |

### 3.6 External marketing

| Field | Value |
| --- | --- |
| Is your app promoted outside of Google Play? | **No** for now (no paid marketing during pilot). Change to Yes if you start running ads or have a marketing site funneling installs. |

---

## Section 4 — Assets you need to prepare

These are required *artifacts* (not text) — Play won't let you publish
without them.

### 4.1 App icon (required)

- **Spec:** 512×512 PNG, 32-bit, no alpha, max 1 MB
- **Source:** `assets/images/icon.png` is 1024×1024 (from PR 39.1
  logo swap). Downscale to 512×512 using any image editor or:

  ```
  # In your repo root, with PIL installed:
  python -c "from PIL import Image; img = Image.open('assets/images/icon.png'); img.resize((512,512), Image.LANCZOS).save('play-assets/icon-512.png')"
  ```

- **Action:** create the `play-assets/` folder (git-ignored or
  committed — your call; I'd commit it so the assets ship in the
  repo) and put the 512px icon in it.

### 4.2 Feature graphic (required)

- **Spec:** 1024×500 PNG or JPEG, max 1 MB, no transparency
- **Purpose:** the big banner at the top of your Play Store listing
  page
- **Status:** **does not exist yet — needs design work.**
- **Suggested layout:** HamaraSetu logo (left or centered) + tagline
  "Shop Smart. Shop Local." (right or below) on a clean
  blue-to-green gradient background matching the logo's palette.
  White or very light tone for contrast.
- **TODO:** create this in Canva / Figma / Photoshop. If you can't
  design it in-house, this is the one Play asset worth paying a
  freelancer ~₹500–₹2000 for — it's the first thing potential users
  see.

### 4.3 Phone screenshots (minimum 2, maximum 8)

- **Spec:** 16:9 or 9:16 aspect ratio, min 320 px short edge, max
  3840 px long edge, PNG or JPEG, max 8 MB each
- **Source for now:** capture from your current iOS TestFlight build.
  Play accepts iOS screenshots so long as they don't include obvious
  iOS-only chrome (e.g., the iPhone home indicator bar). Crop the
  bottom 20px to hide that.
- **Better source (once your Android sideload is live):** capture
  from your new Android phone. Use Volume-Down + Power simultaneously
  for a native screenshot.
- **Suggested capture list (in this order):**
  1. **Home / Shop list** — shows neighborhood shops with distances
  2. **Shop detail / Menu** — shows a kirana shop's menu items
  3. **Cart with tiered delivery charge** — shows the
     distance-based pricing preview
  4. **Checkout with "Deliver to current location"** — shows the new
     PR 46 geo feature
  5. **Order tracking** — shows live status (accepted → preparing →
     ready → out for delivery)
  6. **Shop owner dashboard** — shows the new-order alert + active
     orders (use the shopkeeper test account)
- **Optional but valuable:**
  7. **Delivery partner dashboard with nearest-first pickup sort
     and ride distance** — showcases the new PR 49 feature
- **TODO:** capture all 6–7 after your Android sideload is working
  end-to-end. Store them in `play-assets/screenshots/`.

### 4.4 Optional: tablet screenshots

Not required for a phone-first app. Skip for the pilot.

### 4.5 Optional: promo video (YouTube link)

Not required. Skip for the pilot.

---

## Section 5 — What you can do RIGHT NOW (no Play Console)

While Google's case-handler is processing your phone verification:

1. **Confirm the privacy policy URL still resolves and shows
   HamaraSetu branding** (not the older "Kirana Mart" copy). Open
   `https://grocery-mvp-dev.web.app/privacy` in a browser and skim.
   If it's stale, run `npm run build-legal && firebase deploy --only
   hosting` — PR 39 updated the legal docs to HamaraSetu, so a
   re-deploy may be needed if you haven't pushed since.
2. **Verify the Firebase Auth test phone numbers** referenced in
   §1.2 above. Firebase Console → Authentication → Settings → Phone
   numbers for testing. If 9999999991 / 9999999990 / 9999999994
   aren't listed with stable OTPs, add them and note the OTPs in
   §1.2.
3. **Generate the 512×512 app icon** (§4.1) — one-line PIL command,
   takes 30 seconds.
4. **Design or commission the feature graphic** (§4.2) — the slowest
   asset, worth starting now.
5. **Capture iOS screenshots** for §4.3 from your current TestFlight
   build. You can re-capture from Android later for a cleaner set,
   but having draft screenshots now means the listing-page work is
   already done. Save to `play-assets/screenshots/`.
6. **Confirm the "Delete my account" path** mentioned in §2.3.
   For Play purposes the email-based path is acceptable for a pilot.
   But it's worth filing a PRELAUNCH_CHECKLIST item for a future
   in-app "Delete my account" flow (Play strongly recommends this
   for public launch).

---

## Section 6 — What stays blocked until phone verification clears

These literally can't happen until Play unlocks your account:

- Creating the app entry (`Create app` button is gated).
- Uploading any AAB.
- Configuring a Closed Testing track.
- Adding testers' Google accounts to the track.
- Generating the Play Console API service-account JSON
  (`Setup → API access` is also typically gated).
- Submitting the policy questionnaires (they live under the app
  entry).

**The moment phone verification clears,** the sequence is:

1. `Create app` (Section 1 of the Android setup guide, Step 2).
2. Fill the App Content questionnaires using this pack (~20 min if
   you paste from here).
3. Fill the Data Safety form using §2.2 (~30 min — it's tedious
   regardless).
4. Upload the Main Store Listing copy + assets (~15 min).
5. **At Setup → API access:** link your GCP project (`grocery-mvp-dev`),
   create the service account, download the JSON, grant it
   "Release manager" or "Admin" permission. Save the JSON outside the
   repo — never commit.
6. Run a production AAB build: `eas build --profile production
   --platform android`.
7. Submit it to Internal Testing first (not Closed Testing yet — see
   note below), with your own Google account as the sole tester:
   `eas submit --profile production --platform android --latest`.
   (`eas submit` will ask for the path to the service-account JSON
   you generated.)
8. Verify on your Android phone that the Play-installed version works
   correctly. (You'll need to uninstall the sideloaded version first —
   different signature.)
9. Once happy, promote that build to Closed Testing and add the
   offshore team's Gmail addresses as testers.

**Why Internal Testing before Closed Testing:** Internal Testing
publishes within minutes (no review), so it's the fastest way to
verify the Play install path works at all. Closed Testing is reviewed
by Google (1–7 days for the first submission); promoting a build
that's already known-good from Internal Testing skips an iteration
loop.

---

## Section 7 — One-time TODOs surfaced by this prep

These don't block Play submission but are worth tracking for the next
session / PR. I'd add them to `PRELAUNCH_CHECKLIST.md` under "Play
Store readiness":

- [ ] In-app "Delete my account" flow (Play strongly recommends for
      public launch; email-based path acceptable for pilot).
- [ ] Switch `SUPPORT_EMAIL` from `sarastacklabs@gmail.com` to a
      brand email (`sarastacklabs@gmail.com`) — deferred post-pilot
      per CLAUDE.md, but Play listing exposes this email publicly,
      so do it before public launch.
- [ ] Custom domain for legal URLs (e.g. `hamarasetu.in/privacy`) —
      Play accepts the `grocery-mvp-dev.web.app` domain but it
      reads as obviously-not-production; cosmetic issue only.
- [ ] Add a support phone number for the Play listing — optional but
      builds trust.
- [ ] Generate the feature graphic (§4.2).
- [ ] Capture clean screenshot set from Android sideload (§4.3).
- [ ] In-app account-deletion + data-deletion flow.
