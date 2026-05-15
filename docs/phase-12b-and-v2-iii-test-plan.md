# Combined E2E test plan — Phase 12b (delivery) + v2-iii (customer menu)

This is the script for the **family role-play session**. Run it after
v2-iii ships. It exercises the full real-world loop:

> Customer browses **only active shops**, sees a **per-shop menu** with
> per-shop prices, places an order → shop owner accepts/preps/ready →
> delivery partner claims/picks up/delivers → admin can intervene at
> any time.

## 0. Pre-flight (Sudhir / Admin only — 10 min)

Do this on **your** phone (admin) before handing the other phones out.

**Important Home-screen rendering reference (read once, refer back to as needed):**

`HomeScreen` shows three zones — Customer browsing (always visible to
everyone), "Your Roles" (only renders rows for roles you actually hold),
and "Become more" (opt-in CTAs for roles you don't have). Per-phone
expectations:

| Phone | "Your Roles" rows | "Become more" CTAs |
|---|---|---|
| E (Sudhir, admin only) | 🛠️ Admin Dashboard, 📋 Pending Shops, 👥 User Management, 🏪 All Shops | 🏪 Open a shop, 🚲 Become a delivery partner |
| A (customer only) | (section hidden) | 🏪 Open a shop, 🚲 Become a delivery partner |
| B (customer + shop owner) | 🛍️ Shop Dashboard | 🚲 Become a delivery partner |
| C (shop owner + delivery) | 🛍️ Shop Dashboard, 🚚 Delivery Dashboard | (section hidden) |
| D (delivery only) | 🚚 Delivery Dashboard | 🏪 Open a shop |

Sudhir will **not** see a ShopOwner or Delivery active tile on his own
phone because he is admin-only by deliberate choice. That's correct
behaviour, not a defect. To validate those flows visually, look over
the relevant family member's shoulder.

| # | Action | Expected |
|---|---|---|
| 0.1 | On Phone E (Sudhir's), open the app. | Land on Home. Customer browsing zone at top (search, chips, hero, My Orders). Below it: "Your Roles" section with **exactly the 4 admin rows** above. Below that: "Become more" with **🏪 Open a shop** and **🚲 Become a delivery partner**. **No** Shop Dashboard or Delivery Dashboard tile (correct). |
| 0.2 | Open **All Shops** (admin row) → confirm at least 2 active, 1 pending, 1 suspended shop exist. If not, create with the seed flow. | Status chips render correctly. |
| 0.3 | Open **User Management** → after each tester signs in in step 1, search for their phone number. Note their UIDs. | Used later for revoke tests. |
| 0.4 | Confirm `eas update` v2-iii is the active build on your device — Settings → Build info shows update group `db160fae-b9de-4a78-953a-e260477db192`. | Device is on latest. |
| 0.5 | Open **Admin Dashboard** (which routes to AdminOrders). No orders yet → list empty. | Baseline. |

## 1. Phone assignment (5 min)

| Phone | Role(s) | Tester | Sign-in |
|---|---|---|---|
| A | Customer #1 | Family member 1 | Phone OTP |
| B | Customer #2 + Shop Owner #1 | Family member 2 | Phone OTP, register Shop A |
| C | Shop Owner #2 + Delivery Partner #1 | Family member 3 | Phone OTP, register Shop B + apply as delivery |
| D | Delivery Partner #2 | Family member 4 | Phone OTP, apply as delivery |
| E (yours) | Admin | Sudhir | Already set up |

After everyone signs in:

- Phone B and Phone C: tap **🏪 Open a shop on Kirana Mart** from the
  "Become more" section, fill registration form (name, address, phone,
  hours, optional GST/FSSAI), submit. They'll land on
  `WaitingForApproval` screen.
- Phone E (admin): tap **📋 Pending Shop Approvals** → approve Shop A
  (Phone B's) and Shop B (Phone C's). Confirm `bootstrapShopMenu` runs
  — both shops should now have ~34 menu items each in their menu
  subcollection. (Verify by opening `🏪 All Shops` → Shop A → menu
  count, but only after Phone B's session refocuses Home so the new
  shopOwner claim is picked up.)
- Phones B and C: pull-to-refresh Home (or sign out and back in if
  needed). The 🛍️ Shop Dashboard row should now appear under "Your
  Roles", and the 🏪 Open-a-shop CTA should disappear.
- Phones C and D: tap **🚲 Become a delivery partner** from "Become
  more" → tap Apply. Sign out and sign back in if the 🚚 Delivery
  Dashboard row doesn't appear within 30s (custom-claim refresh
  needs a token reissue, which a re-login forces).

## 2. v2-iii customer flow tests (Phone A)

| # | Action | Expected | Pass/Fail |
|---|---|---|---|
| 2.1 | Open **Shop List**. | Only Shop A and Shop B appear. The pending shop and the suspended shop from 0.2 are **not** visible. | |
| 2.2 | Tap Shop A. | Detail screen renders Shop A's per-shop menu, grouped by category. Item count matches what owner B sees in their `ShopMenuScreen`. | |
| 2.3 | On phone B, open Shop A's menu, toggle one item (e.g. "Aashirvaad Atta 5kg") to **Unavailable**. Wait 5s. | On phone A, pull-to-refresh Shop A's detail page. That item disappears from the list. | |
| 2.4 | Phone B: edit Aashirvaad Atta price from default to **₹999**. Save. | On phone A, refresh — new price ₹999 shows. MRP strike-through still correct. | |
| 2.5 | Phone B: revert price + flip Aashirvaad back to Available. | Phone A refresh — back to normal price + visible. | |
| 2.6 | Phone A: add 2× Aashirvaad Atta + 1× Tata Salt to cart. Open cart. | Cart shows correct items + correct totals using **Shop A's prices** (not the global product price). | |
| 2.7 | Phone A: try to add an item from Shop B to the same cart. | Existing behaviour preserved — no new guard added in v2-iii. (Note pass/fail of whatever the app does today.) | |
| 2.8 | Phone B: while phone A's cart is open, set Tata Salt **Unavailable**. | Phone A: tap Checkout → server rejects with "Tata Salt is currently unavailable." Cart state stays intact. | |
| 2.9 | Phone B: set Tata Salt back to Available. Phone A: retry checkout. | Goes through to Razorpay. Pay test card. Order confirmation screen renders with order ID. | |
| 2.10 | Phone B: edit Aashirvaad price to ₹500 **after** phone A has it in cart at the old price. Phone A retries checkout. | Server rejects with "price changed. Please refresh and try again." | |
| 2.11 | Phone E (admin): open Shop Management → suspend Shop B with reason "Test suspension". | Phone A: open Shop List — Shop B disappears within one refresh. Direct deep-link to Shop B's detail page returns "Shop not found". | |
| 2.12 | Phone E: unsuspend Shop B. | Phone A: Shop B reappears. | |

## 3. Phase 12b delivery flow tests (Phones B / C / D, with admin watch)

Use the order placed in step 2.9 as the seed.

| # | Action (phone) | Expected | Pass/Fail |
|---|---|---|---|
| 3.1 | Phone B (Shop Owner Dashboard): see the new order in "New" bucket within 10s (poll cycle). | Order appears with customer name + total + items. Push notification on phone B. | |
| 3.2 | Phone B: tap **Accept**. | Status → `accepted`. Phone A's Order Detail updates within 5s (poll). Push to phone A: "Order accepted by Shop A". | |
| 3.3 | Phone B: tap **Mark Preparing**. | Status → `preparing`. Phone A push fires. | |
| 3.4 | Phone B: tap **Mark Ready**. | Status → `ready`. Push to phone A. | |
| 3.5 | Phone C **and** Phone D: open Delivery Dashboard → "Available" tab. | Both see the ready order in the list within 15s (poll). Each card shows shop name + customer area + item count + payout. | |
| 3.6 | **Race condition test:** Phones C and D tap **Claim** at the same time (count "3, 2, 1, claim"). | Exactly **one** wins (transaction). The loser sees "Already claimed by another partner" toast and the row vanishes from their available list. | |
| 3.7 | Winner (say phone C): order moves to "My Deliveries" tab. Phone E (admin): Admin Orders shows `deliveryPersonId` populated. | Substate: status still `ready`, `deliveryPersonId` set. Push to phone A: "Delivery partner assigned". | |
| 3.8 | Phone C: tap **Mark Picked Up**. | `pickedUpAt` set. Phone A push: "Out for delivery". Order Detail on A updates within 5s. | |
| 3.9 | Phone C: tap **Mark Delivered**. | `deliveredAt` set. Status → `delivered`. Phone A push: "Order delivered". Order Detail shows delivered timestamp. | |
| 3.10 | Phone E: Admin Orders shows the order in completed bucket. | Final state correct. | |

### 3b. Delivery edge cases (run after the happy path above)

Place a second order from phone A → Shop B (will need to unsuspend Shop B from step 2.12).

| # | Action | Expected | Pass/Fail |
|---|---|---|---|
| 3b.1 | Phone B (Shop Owner of A): try to accept an order belonging to Shop B (deep-link if needed). | Server rejects — `permission-denied`. UI shows generic error. | |
| 3b.2 | Phone D claims, marks picked up, then **kills the app**. Restart app. | Order still shows in "My Deliveries" with picked-up state. Idempotency: tapping Mark Delivered now still works. | |
| 3b.3 | Phone D: tap Mark Delivered twice rapidly. | Server is idempotent — second call no-ops, no error toast. | |
| 3b.4 | Phone E: while a delivery is in-flight, **revoke** Phone D's delivery role. | Phone D's Delivery Dashboard tab disappears on next focus. **Existing in-flight order remains accessible** via Order Detail (delivery person id is still set on the order). New claims fail with `permission-denied`. | |
| 3b.5 | Phone E: **suspend** Shop A while it has an `accepted` order in the queue. | Phone B (owner of A) can still see + progress the existing order through to `ready` (existing orders aren't blocked). New customers can't see Shop A in Shop List (test on phone A). | |
| 3b.6 | Phone E: unsuspend Shop A. | Shop visible again on phone A. | |

## 4. Multi-role + admin governance tests (≈10 min)

| # | Action | Expected | Pass/Fail |
|---|---|---|---|
| 4.1 | Phone B (customer + shop owner): browse Shop B as a customer, place order. | Works. Confirms a single user can act in two roles in one session. | |
| 4.2 | Phone E: try to revoke your own admin role from User Management. | Self-protection banner: "Cannot modify your own roles." Buttons disabled. | |
| 4.3 | Phone E: revoke shopOwner role from Phone B. | Phone B's Shop Owner tile disappears on next focus. The shop record itself is **not** deleted (verify in Shop Management). | |
| 4.4 | Phone E: re-approve Phone B as owner of Shop A (via Shop Detail Management → Reassign Owner — if that flow exists in v2-i-bis; if not, this is a v2-iv item). | Re-grants. | |
| 4.5 | Sign out on phone A, sign back in with same number. | Session restores; cart preserved (AsyncStorage). | |

## 5. Push notification matrix (verify each fired in §3)

| Trigger | Recipient | Expected push body |
|---|---|---|
| Order placed | Shop owner | "New order from {customer}: ₹{total}" |
| Accepted | Customer | "Your order from {shop} was accepted" |
| Ready | Available delivery partners | "New delivery available: {shop} → {area} (₹{payout})" |
| Claimed | Customer | "{partnerName} is picking up your order" |
| Picked up | Customer | "Your order is out for delivery" |
| Delivered | Customer | "Your order from {shop} was delivered" |

If any of the above don't fire, log the missing trigger + recipient as a
defect; do **not** retry the whole script.

## 6. Defect-logging template

For every failure in any row above, capture:

```
- Test ID: e.g. 3.6
- Phone: B / C / D / E
- Steps to reproduce: ...
- Expected: ...
- Actual: ...
- Console / Sentry trace ID: ...
- Screenshot (if UI): attach
```

Drop these as a list at the bottom of `PRELAUNCH_CHECKLIST.md` under
"v2-iii + 12b test session — DD MMM YYYY".

## 7. Done criteria

Section 2 (v2-iii customer flow) and section 3 (12b happy path) all
pass → both phases are signed off and we move to Phase 12c (admin
polish: stats cards + onboarding-approval enhancements).

Section 3b (edge cases) and section 4 (multi-role) failures are
**not** blockers for Phase 12c, but each failure goes into the
checklist as a follow-up.

After Phase 12c we run the **detailed code review** (you + Windsurf)
that you flagged earlier, then the cleanup script, then the full
production role-play.
