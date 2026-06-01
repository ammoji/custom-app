# Pilot Smoke Test Plan — build 16 (post PR 39)

> Run this end-to-end after every fresh `reset-pilot-data` + native
> rebuild. Designed to start from a completely empty database (no
> shops, no orders, no menus — only `users/` and `aiFeatures/`
> preserved by the reset script).
>
> **Estimated time:** ~30–40 min on device with all 4 phases of
> the order lifecycle.
>
> **Test accounts (Firebase test phones, hardcoded OTP 123456):**
>
> | Role | Phone | OTP |
> |---|---|---|
> | Admin (you) | +91 3145415346 | 123456 |
> | Customer | +91 9999999991 | 123456 |
> | Shopkeeper 1 | +91 9999999992 | 123456 |
> | Shopkeeper 2 | +91 9999999994 | 123456 |
> | Delivery Partner | +91 9999999993 | 123456 |
>
> **The Quick Switch modal** (PR 18) is the fastest way to flip
> between roles without retyping the OTP every time. When signed
> in with any of the 5 test phone numbers above, scroll down on
> the Customer Home tab past the shop list + favorites tile —
> you'll see a dashed-border tile that reads **"🔀 Switch test
> account"**. Tap it → modal with all 5 test accounts → tap to
> switch. The tile auto-hides for non-test phones, so production
> users never see it. Alternative if the tile doesn't appear:
> Profile → Sign out → re-login with the next test number.

---

## Phase 0 — Pre-flight checks (do these BEFORE installing build 16)

- [ ] `eas build:list --platform ios --limit 3` shows build 16
      as the most recent and status `finished`
- [ ] `eas submit --profile production --platform ios --latest`
      has been run and shows status `finished`
- [ ] TestFlight on the test device shows "HamaraSetu" with
      version 1.0.0 (16) and an Install / Update button
- [ ] `firebase deploy --only hosting` was run after
      `npm run build-legal`; opening
      `https://grocery-mvp-dev.web.app/privacy` in any browser
      shows "HamaraSetu" in the page title and §13 reads
      "courts at Faridabad, Haryana"
- [ ] Firebase Console → Authentication → Settings → Phone
      numbers for testing: all 5 test phones above are listed
      with their OTP `123456`
- [ ] `aiFeatures/menuExtraction.enabled` and
      `aiFeatures/voiceOnboarding.enabled` are both `true` in
      Firestore (the reset script preserves these on purpose)

If any of these fail, fix before continuing — the test plan
assumes them.

---

## Phase 1 — PR 39 brand verification (signed OUT, ~5 min)

Goal: confirm every place "Kirana Mart" used to appear now shows
"HamaraSetu," and the new LoginScreen brand block + tagline render.

> **First step before this phase:** if the app is signed in,
> tap **Profile tab → Sign out → confirm**. The brand block
> only shows on LoginScreen, which only appears when signed out.

- [ ] **App icon label.** Close the app. On the iOS home
      screen, the icon label reads "HamaraSetu" (not "Kirana
      Mart"). Icon artwork still old — that's PR 40, not in
      scope.
- [ ] **Splash screen.** Open the app. The green splash
      flashes briefly. (Splash tagline / new artwork = PR 40.)
- [ ] **LoginScreen brand block.** Land on LoginScreen.
      Above the "Sign in" header, a centered two-line block
      reads:
      - Line 1: **HamaraSetu** (large, primary text color)
      - Line 2: *Shop Smart, Shop Local* (smaller, secondary
        text color)
- [ ] **Phone entry.** Tap the phone field, type any test
      number from the table above (e.g., `9999999991`). The
      `+91` prefix is shown to the left.
- [ ] **Legal footer.** Below the Send OTP button, the line
      "By continuing, you agree to our Terms of Service and
      Privacy Policy" is visible. Tap **Terms of Service**.
      An in-app browser opens at
      `https://grocery-mvp-dev.web.app/terms`. Page title /
      H1 shows **HamaraSetu**. Scroll to §13 — reads
      "courts at Faridabad, Haryana." Close the in-app browser.
      Tap **Privacy Policy** — same checks.
- [ ] **iOS permission prompts** (only fire on a fresh
      install — if you've installed build 16 over build 15
      they may not re-prompt; that's normal):
      - First time you allow location on Home: prompt reads
        "HamaraSetu uses your location to find nearby
        grocery shops."
      - First time you tap the mic on RegisterShop: prompt
        reads "HamaraSetu uses the microphone for voice-
        assisted shop registration so you can speak your
        details instead of typing."

---

## Phase 2 — Admin first-look + Contact Support (~3 min)

Sign in as **Admin** (+91 3145415346, OTP 123456).

- [ ] **Sign in.** Send OTP → enter 123456 → land on
      Customer HomeScreen (admin defaults to customer view
      with admin tools surfaced).
- [ ] **Empty home state.** HomeScreen shows zero shops in
      the nearby list (data is wiped). An empty state or
      placeholder message appears where shops would be.
- [ ] **Admin entry visible.** A row / button labeled
      something like "Admin tools" or "Admin dashboard"
      appears on Home (only visible to admin users). Tap it.
- [ ] **PendingShops empty.** Tap Admin tools → Pending
      Shops. List is empty.
- [ ] **AdminOrders empty.** Back → All Orders. Empty.
- [ ] **ShopManagement empty.** Back → All Shops. Empty.
- [ ] **UserManagement non-empty.** Back → All Users. You
      should see all 5 test users (they survived the reset).
      Tap your own admin row → confirm `isAdmin: true` and
      no `isShopOwner` / `isDelivery` flags after the reset.
- [ ] **PR 38 — AdminUsageScreen.** Back → Feature Usage.
      Should show the dashboard with date-range selector;
      counts will be sparse (only events fired during this
      test session). No "Missing or insufficient permissions"
      error (that was PR 38.1's fix).
- [ ] **PR 39 — Contact Support row.** Tap the Profile tab
      (bottom nav). Scroll to a new **"Help & Support"**
      section. One row: "Contact support." Tap it. The OS
      mail app opens with:
      - To: `sarastacklabs@gmail.com`
      - Subject: `HamaraSetu support`
      - Body starts with two blank lines, then `---`, then
        `Platform: ios`, then `App: HamaraSetu`, then a hint
        line about describing the issue.
      Tap **Cancel** in the mail app → return to ProfileScreen.

---

## Phase 3 — Shop owner registration via voice + Hindi (~7 min)

Goal: validate the Mission North Star flow. Use the QuickSwitch
modal or sign out + sign in fresh as Shopkeeper 1.

- [ ] **Switch to Shopkeeper 1.** Scroll down on Customer
      HomeScreen → tap the "🔀 Switch test account" tile →
      QuickSwitch modal opens → tap "Shopkeeper 1" → wait
      for switch (spinner).
      Alternative: Profile tab → Sign out → enter
      `9999999992` → OTP `123456`.
- [ ] **Empty home (as Shopkeeper 1).** Land on Customer
      HomeScreen (Shopkeeper 1 has no shop yet, so they're
      a customer by default).
- [ ] **"Open a shop on HamaraSetu" tile** is visible
      somewhere on HomeScreen (PR 39 confirmed text reads
      "HamaraSetu," not "Kirana Mart"). Tap it.
- [ ] **RegisterShop Step 1 of 5.** Top of screen shows the
      step indicator. A **language picker** is visible
      (Hindi / English). Default is English. A **big
      microphone button** is at the top — tap it once. The
      mic permission prompt may appear → Allow. The button
      goes into "Listening..." state.
- [ ] **Voice fill (English).** With the big mic active,
      speak: *"My shop name is Sharma Kirana Store, owner
      name is Ramesh Sharma, phone is nine nine nine nine
      nine nine nine nine nine."* (No need to say "GST.")
      Wait ~5 seconds after stopping. The form fields
      (shop name, owner name) should auto-fill with the
      AI's best parse. Edit any field that misheard.
- [ ] **Per-field mic.** Each text field has its own tiny
      mic icon on the right. Tap the mic next to "Address"
      → speak: *"H-no 23, Sector 12, Ballabgarh, Faridabad,
      Haryana, 121004."* Field auto-fills. Edit if needed.
- [ ] **Language switch test.** Tap the language picker →
      switch to **हिन्दी (Hindi)**. The big mic now expects
      Hindi. Tap the big mic, speak any Hindi phrase
      ("मेरी दुकान का नाम...") — confirm it transcribes
      Devanagari. Switch back to English for the rest of
      registration.
- [ ] **Map pin.** Step 2 of 5 (or wherever the map is) —
      a map preview with a draggable pin appears. Tap "Use
      my current location" or drag the pin. Confirm the
      lat/lng appears in the form.
- [ ] **KYC document uploads** (Step ~4). Three slots:
      Aadhaar, Shop photo, GST cert (optional). Tap each →
      "Take photo" or "Choose from library." For testing,
      use any phone photo. Confirm thumbnails appear after
      upload. (This exercises PR 31's signed PUT URL flow +
      the PR 31 IAM fix.)
- [ ] **Submit.** Final step → "Submit application" →
      success state.
- [ ] **WaitingForApproval screen.** Land on a status
      screen with copy like "We'll review within 24
      hours." Note the shop request ID if shown.

---

## Phase 4 — Admin approves the shop (~3 min)

Switch back to **Admin**.

- [ ] **QuickSwitch → Admin.** Or sign out + sign in
      (+91 3145415346, 123456).
- [ ] **PendingShops has 1 entry.** Admin tools →
      Pending Shops → 1 row visible: "Sharma Kirana Store
      — Ramesh Sharma — just now." Tap it.
- [ ] **ShopRegistrationDetailScreen renders.** All
      submitted fields visible. Three KYC document
      thumbnails. Tap any thumbnail → full-screen image
      preview opens → close.
- [ ] **PR 31.1 — tappable lat/lng.** The address shows
      a small `Lat: X.XXXX, Lng: Y.YYYY` line. Tap it →
      Google / Apple Maps opens to that coordinate →
      close.
- [ ] **Approve.** Tap "Approve" → confirmation modal →
      confirm. Status flips to Approved. The shop should
      now also appear under Admin → All Shops.

---

## Phase 5 — Shop owner builds menu via AI scan (~5 min)

Switch to **Shopkeeper 1**.

- [ ] **QuickSwitch → Shopkeeper 1.** This time, after
      sign-in, the app should detect the role change
      (shop now approved + claim set) and land on
      **ShopOwnerDashboardScreen** (not Customer Home).
- [ ] **Dashboard is empty.** All 4 tabs (New /
      Preparing / Ready / Past) show empty state. Sound
      alert (PR 16) is silent — no orders yet.
- [ ] **Tap "Menu" tab (bottom nav).** Empty menu.
      FAB visible with two entry points: "Scan menu
      image" + "Add item manually."
- [ ] **Scan menu (PR 32).** Tap "Scan menu image."
      Camera viewfinder opens. Camera permission prompt
      if first time. Point at any sample rate-list (a
      printed Indian kirana price sheet, or even a
      handwritten one on paper) → tap shutter → tap
      "Use this photo." AI extraction kicks off
      (~10–15 seconds, depending on the image).
- [ ] **Review screen.** A list of N extracted items
      appears: name, price, category, checkbox. Edit
      any obviously-wrong item. Untick 1 item to
      confirm partial-add works. Tap "Add N items."
- [ ] **Menu has items.** Returns to ShopMenu → grouped
      by category. Each row has the image (placeholder
      from PR 32.1/32.2 — actual `.png` URL with emoji,
      not blank), name, price, in-stock toggle.
- [ ] **Add custom item manually.** Tap FAB → "Add
      item manually." Fill name "Test Milk 500ml,"
      MRP 30, offer 28, category Dairy, leave photo
      empty (placeholder will fill). Save. New item
      appears in the Dairy section with the dairy
      placeholder image.

---

## Phase 6 — Customer places order (~5 min)

Switch to **Customer**.

- [ ] **QuickSwitch → Customer.** Land on
      Customer HomeScreen.
- [ ] **Shop visible.** "Sharma Kirana Store" card
      appears in the nearby shops list. (No distance
      filter — PR 10 `SHOW_ALL_SHOPS = true` —
      so it shows regardless of customer location.)
- [ ] **Open shop.** Tap the shop card →
      ShopDetailScreen. Hero shows shop name, owner,
      distance, "Open" status. Category nav rail at the
      left/top. Menu items listed below.
- [ ] **Add 3 items.** Tap the "+" on three items
      from different categories. Quantity stepper
      appears, confirming each add. Sticky bottom cart
      bar shows "3 items · ₹X" with "View cart" CTA.
- [ ] **Cart.** Tap "View cart" → CartScreen. Three
      rows with quantity steppers. Subtotal, delivery
      fee, total visible. Tap "Proceed to Checkout."
- [ ] **Checkout.** Address card → tap to add a new
      address. Use "Current location" or type:
      `H-no 5, Sector 12, Ballabgarh, Faridabad, Haryana
      121004`. Save. Back on Checkout, address is
      filled.
- [ ] **Payment method.** Toggle to **Cash on
      Delivery** (Razorpay is on test keys; use COD to
      avoid a test-payment flow). Substitution
      preference: "Call me." Delivery instructions:
      "Ring bell twice."
- [ ] **Place order.** Tap "Place Order ₹XXX" → spinner
      → land on OrderConfirmationScreen with "Order
      placed" and an order ID. Note the order ID.
- [ ] **Track order.** Tap "Track Order" →
      OrderDetailScreen. Status: Placed. Timeline shows
      Placed → Accepted (greyed) → etc.
- [ ] **PR 36.1 countdown timer.** While the order is
      in "Placed" / "Accepted" state, look for a relative
      time line like "Placed 30 seconds ago" or a
      countdown to an ETA. Tick should update each
      minute.

---

## Phase 7 — Shop owner fulfills the order (~5 min)

Switch to **Shopkeeper 1**.

- [ ] **QuickSwitch → Shopkeeper 1.** Land on
      ShopOwnerDashboardScreen.
- [ ] **New order alert (PR 16).** The "New" tab badge
      shows `1`. Audible alert if sound is on. Tap "New."
- [ ] **Tap the order.** ShopOrderDetailScreen opens.
      Customer name + masked phone (e.g., "9XXXXX9991"),
      address, 3 items with in-stock toggles, total.
- [ ] **Mark one item out of stock.** Tap the in-stock
      toggle on one item → confirm it greys out and
      shows substitution prompt.
- [ ] **Accept.** Tap "Accept order" → status flips to
      Accepted. Set ETA: 30 min. (Test the ETA picker
      from PR 12.)
- [ ] **Mark packed.** "Mark packed" CTA. Confirm
      status flips.
- [ ] **Mark ready.** "Mark ready for pickup."

---

## Phase 8 — Delivery partner picks up + delivers (~4 min)

The delivery partner needs to be a registered delivery user
first. If they haven't applied, switch first as the customer
account and apply.

> **Shortcut for pilot:** the Delivery Partner test phone
> (+91 9999999993) was previously a registered delivery user
> but the reset cleared their role claim. They now need to
> re-apply OR you set the role directly via
> `scripts/set-delivery.ts 9999999993` (or via the equivalent
> firebase-admin call). Use the script — saves 5 minutes.

- [ ] **(Pre-step)** From PowerShell:
      `npx tsx scripts/set-delivery.ts <uid-of-9999999993>`
      → confirms claim set.
- [ ] **QuickSwitch → Delivery Partner.** Land on
      DeliveryDashboardScreen.
- [ ] **Available tab has 1 pickup.** The order from
      Phase 7 should appear in "Available." Shop name,
      pickup address, customer address, distance, COD
      amount visible.
- [ ] **Claim.** Tap "Claim" / "Accept delivery." Order
      moves to "My Active."
- [ ] **Tap order.** DeliveryOrderDetailScreen opens.
      Shop address (tap → opens Maps). Customer phone
      (tap → opens dialer; cancel the call). Customer
      address (tap → Maps).
- [ ] **Mark milestones.** "Arrived at shop" → "Picked
      up" → "Out for delivery" → "Delivered."
- [ ] **Collect cash (COD).** A "Cash collected ₹XXX"
      CTA appears. Tap → confirm → order finalises.

---

## Phase 9 — Customer sees delivered + rates (~2 min)

Switch to **Customer**.

- [ ] **QuickSwitch → Customer.**
- [ ] **Orders tab.** Active tab is empty; Past tab has
      1 row: the order, status "Delivered."
- [ ] **Tap order → OrderDetailScreen.** Timeline shows
      all 5 milestones complete. A "Rate this order"
      CTA is prominent.
- [ ] **Rate.** Tap → modal with star rating (1–5) +
      optional comment. Give 5 stars, comment "Smooth
      first pilot order." Submit. Modal closes; rating
      shows on the order.

---

## Phase 10 — Regression spot-checks (~5 min)

Quick sanity passes on shipped features that are easy to
miss when only doing the happy path.

- [ ] **PR 19 / 36.1 Part 2 — Favorites.** As Customer:
      Home → tap the heart icon on the shop card. Heart
      fills. Tap Favorites tab → shop appears. Tap
      Shops → tap "Favorites" filter pill → only
      favorited shops visible.
- [ ] **PR 36 — Shop owner Customers tab.** Switch to
      Shopkeeper 1 → bottom nav → Customers. Tab 1
      "All" has 1 row (the customer who just ordered).
      Tap → see their order history with this shop.
- [ ] **Search (PR 4).** As Customer: Home → Search tab
      → type "milk" → result row showing the custom
      item from Phase 5. Tap → lands on ShopDetail with
      the menu scrolled to that item.
- [ ] **PR 38 admin usage dashboard.** Switch to Admin
      → Feature Usage. Some events should now show:
      `shop_customers_viewed`, voice events from
      Phase 3, menu-scan event from Phase 5. Time-range
      filter works.
- [ ] **PR 18 Quick Switch gated to test phones.**
      Switch to Customer (+91 9999999991). The 🔀 Switch
      test account tile still appears (because 9999999991
      is in the test-account list). To test the production
      gate, you'd need a non-test phone — skip if you
      don't have one to spare.
- [ ] **PR 36.2 reset script** — already proven by the
      empty state we started from, no test needed
      here.

---

## Phase 11 — Failure modes worth probing (~5 min)

These aren't strict pass/fail — just spot-check that the
app degrades gracefully.

- [ ] **Airplane mode order placement.** Customer Cart
      → Checkout → enable airplane mode → tap Place
      Order. Should show a clear error (not a silent
      hang). Disable airplane mode, retry → succeeds
      without duplicate order.
- [ ] **Background tap during retry (PR 27).** During
      any "Submitting…" spinner, the screen behind it
      should not be tappable. Try tapping a button
      behind a modal during loading — should be
      blocked.
- [ ] **Cancel order during window (PR 7).** Place a
      second test order (Phase 6 quick). On
      OrderDetail, a "Cancel order" button is visible
      ONLY while within the cancellation window. Tap
      → confirmation → cancelled status.
- [ ] **Long-running app session.** Leave the app open
      for 5+ min on the Customer HomeScreen → return
      → still works (no auth-token drop / silent
      logout).

---

## Pass / fail summary

When done, paste the counts here for the session log:

- Phase 1 (PR 39 brand): ___ / 6 pass
- Phase 2 (admin first-look): ___ / 9 pass
- Phase 3 (shop registration + voice): ___ / 8 pass
- Phase 4 (admin approval): ___ / 4 pass
- Phase 5 (menu via AI): ___ / 6 pass
- Phase 6 (customer order): ___ / 9 pass
- Phase 7 (shop fulfills): ___ / 6 pass
- Phase 8 (delivery): ___ / 7 pass
- Phase 9 (customer rates): ___ / 4 pass
- Phase 10 (regression): ___ / 5 pass
- Phase 11 (failure modes): ___ / 4 pass

**Total:** ___ / 68

Any failure → file as a follow-up PR or, if it blocks pilot,
treat as a hotfix.

---

## Notes for re-runs

This plan is reusable. Each time you run
`npm run reset:pilot-data -- --execute` you can re-run from
Phase 1 (skip Phase 0 — pre-flight only matters for fresh
builds). Total time the second time through is closer to
~20 min because you'll already know the navigation.

Append timing observations or new failure modes you find at
the bottom of this file — keeps the plan accurate for
future sessions.
