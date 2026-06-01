# HamaraSetu — Tester Walkthrough

Thank you for helping test HamaraSetu! This walkthrough takes
about 30 minutes. Follow it step by step. If something doesn't
work the way it's described, no worries — just note it down (see
the "How to report a problem" section at the end).

You don't need any technical knowledge. If a step uses a word
you don't recognise, ask Sudhir.

---

## What is HamaraSetu?

HamaraSetu is a phone app for ordering groceries from your
neighbourhood kirana shop. The tagline is *Shop Smart, Shop
Local*. Customers order through the app, the shop owner sees
the order, packs it, and a delivery partner brings it to the
customer's door.

The app has four kinds of users:

- **Customer** — orders groceries
- **Shop owner** — receives and packs orders
- **Delivery partner** — picks up and delivers
- **Admin** — the HamaraSetu team (Sudhir, for now)

In this walkthrough, you'll play all four roles by signing in
and out with different phone numbers.

---

## Before you start

You'll need:

- An iPhone (or Android phone) with the **TestFlight** app
  installed and HamaraSetu installed through TestFlight
- A working internet connection (Wi-Fi or 4G/5G is fine)
- About 30 minutes
- (Optional but useful) A printed piece of paper with a list
  of grocery items + prices on it — even handwritten on a
  scrap of paper works. You'll use this to test the "scan
  menu" feature.
- A pen and paper, or your notes app, to jot down anything
  that doesn't behave as expected

**These are the test phone numbers you'll use.** They are
special numbers Sudhir set up — they behave like real phones
inside the app, but the verification code (OTP) is always
**123456** instead of being sent by SMS. Don't worry if you
"sign in" as one of these — you're not signing in as a real
person.

| What you're testing as | Phone number | OTP code |
|---|---|---|
| Customer | 9999999991 | 123456 |
| Shop owner | 9999999992 | 123456 |
| Delivery partner | 9999999993 | 123456 |
| Second customer | 9999999994 | 123456 |

For each phone number, the country code is **+91 (India)**.

**Important:** Sudhir will play the Admin role. If a step says
"now admin needs to approve…" — message Sudhir, he'll do it,
then continue.

---

## How to report a problem

If something doesn't work the way the walkthrough describes,
**take a screenshot** (press the power button + volume up on
iPhone) and send it to Sudhir on WhatsApp with a note:

```
What I was doing: (e.g., trying to place an order)
Which user: (e.g., Customer — phone ending 9991)
What I expected: (e.g., order to be placed)
What happened: (e.g., button just spun forever)
```

Don't try to "fix" anything — just report. Your job is to find
problems, not solve them.

---

## Section 1 — Check the app's name and look (2 minutes)

> **First impressions matter. This section just confirms the
> app shows the right name everywhere.**

1. Close the app completely (swipe up from the bottom and flick
   the HamaraSetu card away).
2. Find the HamaraSetu icon on your phone's home screen.
3. **Look at the icon label** (the text under the icon).
   - ✅ Should say: **HamaraSetu**
   - ❌ If it says: Kirana Mart, MeraYara, or anything else,
     write it down.
4. The icon picture itself (the green square with a letter)
   may still look like the old icon — **this is OK for now**.
   The real logo is being designed and will come in a later
   update. Don't report this as a problem.
5. Tap the HamaraSetu icon to open the app.
6. A green splash screen with a small logo appears for a
   second — this is normal.

---

## Section 2 — Sign in for the first time (3 minutes)

> **You'll sign in as a customer first.**

1. The first page should say "Sign in" at the top.
2. **Above** the "Sign in" header, look for a brand block. It
   should show:
   - First line: **HamaraSetu** (in larger text)
   - Second line: *Shop Smart, Shop Local* (in smaller text)
   ✅ Both should be visible. ❌ If either is missing,
   write it down.
3. In the phone field, type **9999999991** (Customer test
   phone). The `+91` country code should already be filled in
   on the left.
4. Tap **Send OTP**.
5. The screen should change to ask for a 6-digit code.
6. Type **123456** and tap to verify.
7. You should land on the **Home page** — a screen with a
   list of shops (or, in this case, an empty list because no
   shops exist yet).
8. **At the very bottom of the sign-in page (before you
   typed the OTP)**, you should have seen a small line:
   *"By continuing, you agree to our Terms of Service and
   Privacy Policy."*
   - Sign out and check this (Tap Profile tab at the bottom
     → scroll down → tap Sign out → confirm). Then look at
     the bottom of the Sign in page again.
   - Tap **Terms of Service**. A web page opens. The title
     at the top should say "Terms of Service — HamaraSetu."
     Scroll down to the very end. The last section (§13)
     should mention "Faridabad, Haryana."
     ✅ All good? Close the page.
   - Tap **Privacy Policy**. Same check — title says
     "Privacy Policy — HamaraSetu." Close the page.
9. Sign back in as the customer (9999999991, OTP 123456).

---

## Section 3 — Look around as a Customer (3 minutes)

> **Get a feel for the empty Home page and check the Help
> & Support contact.**

1. You're on the **Home** page. There are 4 tabs at the
   bottom: Home, Search, Orders, Profile.
2. Tap **Search**. Type "milk" — the page should say "no
   results" or similar (because no shops exist yet).
3. Tap **Orders**. Two tabs: Active and Past. Both should be
   empty.
4. Tap **Profile**. Your phone number (9999999991) should
   show at the top.
5. Scroll down on Profile. Look for two sections:
   - **Help & Support** — with one row labelled **"Contact
     support"**
   - **Legal** — with two rows: Terms of Service, Privacy
     Policy
   ✅ Both sections present? Good.
6. Tap **Contact support**. Your phone's email app should
   open with:
   - "To" field: **sarastacklabs@gmail.com**
   - "Subject" field: **HamaraSetu support**
   - Body has some text mentioning iOS and HamaraSetu
   ✅ All good? Tap Cancel on the email — don't actually
   send it.
7. (If the email app doesn't open — maybe you don't have one
   set up — that's fine, just write it down so we know.)

---

## Section 4 — Register a shop (Shop owner journey, ~8 minutes)

> **This is HamaraSetu's most important flow. We're testing
> what a shop owner experiences when they first sign up. Be
> patient and try the voice features — they're a big part of
> what makes HamaraSetu different.**

1. Sign out (Profile → Sign out → confirm).
2. Sign in with the **Shop owner** test phone: **9999999992**,
   OTP **123456**.
3. You land on the Home page again. Look for a button or
   tile that says something like **"Open a shop on
   HamaraSetu"** — usually a coloured row near the top of
   Home. Tap it.
4. A multi-step shop registration form opens. The top of the
   page shows **Step 1 of 5** (or similar).

### Step 1 — Try the voice helper

5. Near the top of the form, you should see:
   - A **language picker** with options **English** and
     **हिन्दी** (Hindi). Default is English.
   - A big **microphone button** with the 🎙 icon
6. Tap the big microphone button. Your phone may ask
   permission to use the microphone — the popup should say:
   *"HamaraSetu uses the microphone for voice-assisted shop
   registration so you can speak your details instead of
   typing."* Tap **OK / Allow**.
7. The mic button changes to "Listening…" (or similar).
8. Speak this slowly and clearly:
   *"My shop name is Sharma Kirana Store. My name is Ramesh
   Sharma. My phone number is nine nine nine nine nine nine
   nine nine nine two."*
9. Wait about 5 seconds after you stop talking. The fields
   on the form (Shop name, Owner name) should fill in
   automatically.
10. ✅ Worked? Great. ❌ Didn't fill in or filled in wrong
    things — write down what you said and what appeared.
11. **Try Hindi too** if you can. Tap the language picker
    → switch to हिन्दी. Tap the big mic. Say a Hindi phrase
    (e.g., "*मेरी दुकान का नाम शर्मा किराना स्टोर है*").
    The transcription should appear in Hindi script
    (देवनागरी). Switch back to English for the rest.
12. **Try per-field mic.** Each text field has a tiny mic
    icon on the right side. Tap the tiny mic next to
    **Address**. Say:
    *"H number 23, Sector 12, Ballabgarh, Faridabad, Haryana,
    1 2 1 0 0 4."*
    The field should fill in.

### Step 2 — Pin your location on the map

13. Continue to the next step. A map appears with a pin in
    the middle.
14. Tap **"Use my current location"** (or drag the pin to
    move it). Your phone may ask permission to use location
    — the popup should say *"HamaraSetu uses your location
    to find nearby grocery shops."* Tap **OK / Allow**.
15. The pin moves to your current location. The lat/lng
    (some numbers) appear below the map.

### Steps 3–4 — Hours and KYC documents

16. Set the shop's opening hours (something reasonable like
    8am to 9pm).
17. The next step asks to upload three documents:
    **Aadhaar**, **Shop photo**, **GST certificate**
    (optional).
18. Tap each one → choose "Take photo" or "Choose from
    library" — for testing, just pick any photo from your
    gallery (any photo at all is fine for now). Wait for
    each upload to finish (you'll see a thumbnail appear).
    ✅ All three upload? ❌ Any of them fail or get stuck
    — write down which one.

### Step 5 — Submit

19. Final step → tap **Submit application**.
20. You should land on a "**Waiting for approval**" page
    with a message like "We'll review your shop within 24
    hours."

### Ask Sudhir to approve

21. **Message Sudhir:** "Shop registration done — please
    approve."
22. Sudhir will approve from his admin account. He'll let
    you know when it's done.
23. While you wait, you can move on to other testing if
    you want. Otherwise, this is a natural break point —
    grab a chai.

---

## Section 5 — Build the shop's menu (Shop owner, ~5 minutes)

> **Sudhir has approved your shop. Now you'll add items to
> your menu — first by photographing a price list (the AI
> "magic"), then by adding one manually.**

1. Make sure you're still signed in as the shop owner
   (9999999992). The home page should now look **different**
   from before — instead of the customer view, you should
   land on a **Shop Owner Dashboard** with tabs like
   New / Preparing / Ready / Past.
   - ❌ If you're still seeing the customer Home page,
     sign out and sign back in.
2. At the bottom, tap the **Menu** tab.
3. The menu is empty. Tap the **+** button (bottom right).
   Two options appear: **Scan menu image** and **Add item
   manually**.

### Scan a menu photo

4. Tap **Scan menu image**.
5. The camera opens. Your phone may ask permission for the
   camera — Allow.
6. Point the camera at a printed price list (or even a
   handwritten one on paper). Tap the round shutter button.
7. A preview shows. Tap **Use this photo**.
8. The app says "Extracting menu…" and shows a spinner.
   This takes about 10–15 seconds.
9. A list of items appears, each with: name, price, category,
   checkbox. ✅ Does the list look roughly right? Some items
   may be slightly off — that's expected. You can edit them.
10. Tap a few items to edit their name or price if they look
    wrong.
11. **Untick one item** to test that you can choose which
    to add.
12. Tap **Add N items** at the bottom.
13. The menu should now show all the items you added, grouped
    by category. Each item has a small picture (a generic
    placeholder — not the real product photo, that's normal).

### Add one item manually

14. Tap the **+** button again → **Add item manually**.
15. Fill in:
    - Name: **Amul Milk 500ml**
    - MRP: **30**
    - Offer price: **28**
    - Category: **Dairy** (pick from the list)
    - Skip the photo for now (a placeholder will fill in)
16. Tap **Save**.
17. The new item appears in the Dairy section with the
    placeholder image.

---

## Section 6 — Place an order (Customer, ~5 minutes)

> **Switch back to being a customer and place an order from
> the shop you just set up.**

1. Sign out of the shop owner account (Profile → Sign out).
2. Sign in as Customer: **9999999991**, OTP **123456**.
3. On the Home page, the shop **"Sharma Kirana Store"** should
   now appear in the list. (Distance might say something —
   that's OK, no filter is applied during testing.)
4. Tap the shop card.
5. The shop's page opens. You see the shop's name, owner,
   and a list of menu items grouped by category.
6. Tap the **+** button next to three different items
   (preferably from different categories — like one item
   from Dairy, one from Snacks, one from Atta & Rice).
7. A "View cart" bar appears at the bottom showing "3 items
   · ₹XXX."
8. Tap **View cart**.
9. The Cart page shows your 3 items. You can change quantities
   here. Tap **Proceed to Checkout**.
10. The Checkout page asks for an address. Tap **Add address**
    (or "+ New address").
11. Fill in:
    - Nickname: **Home**
    - Address: any address (you can type fake details — e.g.,
      "H-5, Sector 12, Ballabgarh, 121004")
    - Use the map to pin if asked
12. Save the address.
13. Back on Checkout, the address is filled in.
14. Choose payment method: **Cash on Delivery** (do NOT pick
    UPI or Card — those will try to charge real money in test
    mode and we don't want to mess with that).
15. (Optional) Add a delivery instruction: "Ring the bell
    twice."
16. Tap **Place Order ₹XXX**.
17. You should land on an **Order placed** confirmation page
    with an order ID (some letters and numbers).
18. Tap **Track Order**.
19. You see the order details with a timeline: Placed →
    Accepted → Packed → Picked Up → Delivered. Right now only
    "Placed" is filled in.
20. There may be a small timer showing "Placed 30 seconds ago"
    — this is normal. Wait one full minute and check that
    the timer increases.

---

## Section 7 — Shop owner accepts and packs the order (~5 minutes)

> **Switch back to shop owner — there's a new order waiting.**

1. Sign out, sign in as Shop owner (9999999992, OTP 123456).
2. You land on the Shop Owner Dashboard. The **New** tab
   should have a **red dot or "1"** badge. You may hear an
   alert sound (if your phone is not on silent).
3. Tap the **New** tab. One order is listed.
4. Tap the order.
5. You see the customer's name and **masked phone number**
   (e.g., 9XXXXX9991 — most digits hidden for privacy), their
   address, and the 3 items with green switches next to each.
6. Tap the green switch on **one** item. It turns grey,
   meaning that item is out of stock.
7. A box may appear asking if you want to suggest a
   substitution — for now, just tap "Skip" or "No
   substitution."
8. Tap **Accept order**.
9. The status updates to "Accepted." A time-picker appears
   asking for ETA — set 30 minutes.
10. Once accepted, the button changes to **Mark packed**.
    Tap it. Status → "Packed."
11. Button changes to **Mark ready for pickup**. Tap it.
    Status → "Ready."
12. The order moves from the New tab to the Ready tab.

---

## Section 8 — Delivery partner picks up and delivers (~5 minutes)

> **Before you can be a delivery partner, Sudhir needs to set
> up the delivery role for the test phone. Message him: "Please
> activate delivery role for 9999999993." Wait for his OK.**

1. Once Sudhir confirms, sign out and sign in as Delivery
   Partner: **9999999993**, OTP **123456**.
2. You land on the **Delivery Dashboard** with tabs:
   Available / My Active / Completed.
3. The Available tab should show the order you just made
   ready — shop name, pickup address, customer address,
   distance, and the COD amount (since the customer paid
   Cash on Delivery).
4. Tap **Claim** (or "Accept delivery").
5. The order moves to **My Active**. Tap it.
6. You see two addresses — the shop's address and the
   customer's address. Each is tappable and opens **Maps**
   (Google Maps or Apple Maps). Try tapping the shop address
   — Maps should open. Close Maps, return to HamaraSetu.
7. The customer's phone number is visible. Tap it — your
   phone's dialler should open. **Cancel the call** — don't
   actually dial. Return to HamaraSetu.
8. Tap **Arrived at shop** → status updates.
9. Tap **Picked up** → status updates.
10. Tap **Delivered** → status updates.
11. A "Cash collected ₹XXX" button appears (because COD).
    Tap → confirm. The order moves to **Completed**.

---

## Section 9 — Rate the order (Customer, ~2 minutes)

> **One last switch — back to customer to confirm the order
> shows as delivered and to leave a rating.**

1. Sign out, sign in as Customer (9999999991, OTP 123456).
2. Tap the **Orders** tab.
3. **Active** tab should be empty.
4. **Past** tab shows the order, marked **Delivered**.
5. Tap the order. The timeline shows all 5 stages complete.
6. A **Rate this order** button is visible. Tap it.
7. Tap 5 stars. Add a comment: "Smooth first test order."
8. Submit. The rating appears on the order.

---

## Section 10 — Quick look-around (5 minutes)

> **A few quick checks of features we haven't covered yet.**

1. Still as Customer. On the Home page, find a **heart icon**
   on the shop card. Tap it. The heart fills in.
2. Tap the **Profile** tab → Favourites (or look for
   "Favourites" on the Home page). The shop should appear.
3. Untap the heart to remove from favourites, then tap again
   to re-add.
4. Tap the **Search** tab → type "milk" — the milk item from
   Section 5 should appear in the results. Tap it — it should
   take you to the shop's page.
5. Tap **Profile** → addresses. The address you saved in
   Section 6 should be there.
6. Try editing the address (rename it from "Home" to "Office")
   and saving. Confirm the new name shows.

---

## Done!

You've finished. Total time: about 30–40 minutes.

**One last thing:** count up roughly how many checks worked
versus didn't, and message Sudhir with a one-line summary:

> *"Smoke test done. About X things didn't work as expected
> — sending screenshots next."*

Then send each problem screenshot with the short description
from the "How to report a problem" section.

Thank you again — your testing is what helps HamaraSetu launch
without embarrassing bugs.

---

## Things you can ignore (don't report these as problems)

These are known and intentional during this testing phase:

- **The icon picture itself** (the green square with a letter)
  is the old design. A new logo is being made. Just check the
  **label under the icon** — that should say HamaraSetu.
- **Some shop / item images look like placeholders** with an
  emoji on a coloured background. That's correct — real product
  photos come later.
- The app shows **every shop** even if it's not near you.
  That's intentional for testing across cities. The "show
  only nearby" filter will turn on for real customers.
- The "+91" country code is **always India**. Other countries
  aren't supported.
- If you can't actually receive an OTP SMS using a real (non-test)
  phone number — that's expected. Only the test numbers in the
  table above work.
- UPI / Card payments will try to use **test mode** — don't
  use them yet. Always pick **Cash on Delivery** for now.
- If the app feels slow on the **very first tap of the day**,
  that's a known thing (~3–4 seconds). Subsequent taps are fast.
