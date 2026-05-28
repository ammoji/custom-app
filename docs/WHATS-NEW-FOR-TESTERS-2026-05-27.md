# What's New to Test — HamaraSetu (updated 27 May 2026)

This round adds a **distance / location system** across the whole
app. Delivery charges now depend on how far the customer is, shops
can set how far they deliver, and delivery partners see how far each
pickup is. There are also two small bug fixes to re-confirm.

Everything below is already live (over-the-air update) on the latest
build — no new install needed if you already have the current
TestFlight / Android build. Please test on **both iOS and Android**
this round.

---

## ⚠️ Read this first — two things that affect how you test

**1. Location permission.** Several new features need your location.
The first time you open Checkout, edit an address, or open the
Delivery Dashboard, the app will ask for location permission.
**Please tap "Allow."** If you deny it, the new distance features
will quietly do nothing (the app won't crash, but you won't be able
to test them).

**2. You will still see ALL shops, even far ones.** Normally a
customer only sees shops close enough to deliver to them. For this
testing round that filter is **intentionally turned off** so the
whole team (spread across different cities) can see and test every
shop. So: don't be surprised that distant shops still appear — that's
expected right now. You **will** still see the distance on each shop,
and all the delivery-charge math will work normally.

---

## 👤 Customer — what's new

**Deliver to my current location (Checkout).**
At checkout there's a new option to deliver to wherever you are right
now, instead of only a saved address.
- *Test:* On the Checkout screen, choose "Deliver to my current
  location." Confirm it picks up your GPS spot and lets you place the
  order.
- *Test:* If you pick a saved address that has no location saved, the
  app should fall back to your live location and show a small note
  about it.

**Use my current location (Address screen).**
When adding or editing a saved address, there's a "Use my current
location" button that fills in the location for you.
- *Test:* Add/edit an address, tap the button, confirm it captures
  your location without errors.

**Delivery charge now changes with distance.**
Delivery is no longer a flat fee. The closer you are to the shop, the
less you pay; the farther, the more. At checkout you'll see the
estimated distance and time (e.g. "~12 min · 2.3 km") and the
delivery charge that matches that distance.
- *Test:* Place orders to locations at different distances from a
  shop and confirm the delivery charge changes accordingly and the
  distance/time estimate shows.
- *Test:* The charge you see at checkout should match the charge on
  the final placed order.

**Distance shown on each shop.**
Shop cards now show how far the shop is from you.
- *Test:* Open the shop list and confirm each shop shows a distance.

---

## 🏪 Shop Owner — what's new

**Set your own delivery charges by distance (Shop Settings).**
Shop owners can now set their own distance "bands" and prices — for
example: up to 1 km = ₹20, up to 3 km = ₹40, up to 5 km = ₹60, beyond
that = ₹100. You can add bands, remove bands, and change the prices.
The last "More than X km" band can't be removed (it's the catch-all
price).
- *Test:* In Shop Settings → "Delivery charges (by distance)," change
  a price, add a band, remove a band, and Save. Confirm you get a
  success message.
- *Test (IMPORTANT — this was a bug we just fixed):* Change a price
  (e.g. the 5 km charge from 60 to 65), Save, **leave the screen and
  come back.** The new value should still be there. Earlier it was
  reverting to the old number — please confirm it now sticks.

**New "Service area (km)" setting (Shop Settings).**
Shop owners can set how far they're willing to deliver. (Customers
beyond this distance won't see the shop — though remember, that
filter is turned off for this testing round, see the note at top.)
- *Test:* In Shop Settings, set "Service area (km)" to a value and
  Save.
- *Test (IMPORTANT — this was a bug we just fixed):* Change **only**
  the Service area (don't touch anything else) and Save. It should
  save successfully. Earlier this gave a "Could not save" error —
  please confirm it now works.

**The old flat "Delivery fee" box is gone.**
Since delivery charges are now distance-based, the single "Delivery
fee" input was removed from Shop Settings to avoid confusion.
- *Test:* Confirm Shop Settings no longer shows a "Delivery fee" box,
  but still shows "Minimum order" and "Service area," and saving
  those still works.

**New shops get sensible defaults automatically.**
When an admin approves a new shop, it automatically gets a starter
delivery-charge table and a default service area, so a new shop owner
isn't starting from blank.
- *Test:* Approve a new shop and confirm its Shop Settings already
  show delivery bands and a service area filled in.

---

## 🛵 Delivery Partner — what's new

**Pickups sorted nearest-first.**
On the Delivery Dashboard, available pickups are now ordered by which
shop is closest to you.
- *Test:* With two or more available pickups from different shops,
  confirm the nearest shop's pickup appears at the top.

**Ride distance shown on each pickup.**
Each pickup now shows how far the ride is — broken into "distance to
the shop" + "distance from the shop to the customer."
- *Test:* Confirm each available pickup shows a ride distance that
  looks reasonable for where you are.

**Delivery destination type shown.**
Each pickup/active delivery shows whether the drop is a saved address
(e.g. "Home") or a live "Current location" pin.
- *Test:* Place one order to a saved address and one to "current
  location," then check that the delivery partner sees the correct
  label on each.

**Location permission on the dashboard.**
The dashboard asks for your location so it can do the sorting and
distance math.
- *Test:* Grant location permission and confirm sorting/distances
  appear. Deny it and confirm the dashboard still works normally
  (just without the distance sorting).

---

## ✅ Quick re-test checklist (the two fixes)

These two were broken before today and are the most important to
confirm:

1. **Shop Owner:** change a delivery-charge band, save, leave, come
   back → the new value stays (doesn't revert).
2. **Shop Owner:** change only the "Service area" and save → saves
   without a "Could not save" error.

---

## Notes for reporting issues

- Please note **which platform** (iOS or Android) and **which role**
  (customer / shop owner / delivery partner) when you find something.
- For delivery-related flows, remember push notifications need
  **two separate phones** (one customer, one shop/delivery) — a
  single phone switching accounts won't show pushes.
- If a distance or charge looks wrong, please note the shop, the
  delivery location, the distance shown, and the charge shown so we
  can trace it.
