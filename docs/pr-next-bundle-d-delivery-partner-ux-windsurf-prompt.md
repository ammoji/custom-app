# PR-NEXT-BUNDLE-D — Delivery partner UX redesign + profile edit + earnings + filters

**Source:** Sudhir's 2026-06-10 e2e findings #1, #2, #3, #4, #6 + the Bundle C bug fixes already shipped in code (#5 server claim check, #7 BottomSheet keyboard) that ride this OTA.

**Design lens — partner needs three things on their phone:** orders (active work), earnings (motivation), profile/settings (admin work). Current dashboard mashes them all into one scrolling page. Bundle D splits them into a 4-tab bottom-nav workspace so each surface is purpose-built.

**Deploy class:** **server-first** (1 new callable for profile edit + 1 new callable for earnings + 1 modified callable for partner data) → IAM verify → client OTA. Includes a fresh native build is NOT required (no native dep changes).

## Autonomous execution authorization

You may run the following without stopping to confirm — execute, report results in the final summary:

- All `Read`, `Grep`, `Glob`, `ls`, `git status`, `git diff` (read-only)
- `npx tsc --noEmit` (root and `functions/`)
- `npm test`, `npm run test:unit`, `npm run test:full`, `npx jest`
- `npm run lint`, `npx eslint`
- `cd functions && npm run build`
- File edits to files explicitly named in §A–§G below
- New file creation in directories explicitly named in the plan
- Re-running any of the above to verify after fixing an error

You MUST stop and ask before:

- Deploy commands: `firebase deploy …`, `eas update`, `eas build`, `gcloud run …`
- File deletes
- Force-push, rebase, branch ops
- Editing files NOT named in §A–§G
- Adding NEW dependencies not already in package.json
- Schema additions / migrations not in the spec
- Firestore rules / index changes not in the spec

Default posture: **execute, report at end.** Final summary should include files changed, test count delta, tsc clean confirmation, any autonomous decisions made.

## Schema audit-grep (Rule 5)

```
grep -rn "DeliveryDashboardScreen\|DeliveryTabNavigator\|DeliveryStack" src
grep -rn "order.deliveryFee\|order.deliveryCharge" src functions/src
grep -rn "users/{uid}.vehicleType\|users/{uid}.profilePhotoUrl" functions/src
grep -rn "listMyAvailablePickups\|coming_up" src functions/src
grep -rn "@react-navigation/bottom-tabs" package.json src
```

| Symbol | Confirmed at | Notes |
| --- | --- | --- |
| `DeliveryDashboardScreen` | `src/screens/delivery/DeliveryDashboardScreen.tsx` | Becomes the Home tab; cleanup pass removes config UI moved to Settings tab |
| Stack registration for delivery role | `src/navigation/AppNavigator.tsx` | Replaced by `DeliveryTabNavigator` for delivery-role users |
| `order.deliveryFee` | `src/types/index.ts:432-438` | Used by Earnings tab summation |
| `users/{uid}.vehicleType / profilePhotoUrl / lowRatingThreshold / lowRatingNotificationsEnabled` | PR-2 + PR-4 fields | Profile and Settings tabs edit these |
| `@react-navigation/bottom-tabs` | already in `package.json` (per existing `bottom-tabs` import in CLAUDE.md stack) | Native module, but already present, no rebuild |

## Plan

### §A — Bottom tab navigator: `src/navigation/DeliveryTabNavigator.tsx` (new)

```tsx
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

const Tab = createBottomTabNavigator();

export default function DeliveryTabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarStyle: { height: 60 + insets.bottom, paddingBottom: insets.bottom },
      }}
    >
      <Tab.Screen name="DeliveryHome" component={DeliveryDashboardScreen}
        options={{ tabBarLabel: 'Home', tabBarIcon: ({color, size}) => <Icon name="home" color={color} size={size}/> }} />
      <Tab.Screen name="DeliveryEarnings" component={DeliveryEarningsScreen}
        options={{ tabBarLabel: 'Earnings', tabBarIcon: ({color, size}) => <Icon name="trending-up" color={color} size={size}/> }} />
      <Tab.Screen name="DeliveryProfile" component={DeliveryProfileScreen}
        options={{ tabBarLabel: 'Profile', tabBarIcon: ({color, size}) => <Icon name="user" color={color} size={size}/> }} />
      <Tab.Screen name="DeliverySettings" component={DeliverySettingsScreen}
        options={{ tabBarLabel: 'Settings', tabBarIcon: ({color, size}) => <Icon name="settings" color={color} size={size}/> }} />
    </Tab.Navigator>
  );
}
```

Icon library: use whatever the codebase already uses (likely `@expo/vector-icons` Feather). Grep first.

In `AppNavigator.tsx`, when `isDelivery === true`, render `DeliveryTabNavigator` instead of the existing Stack pointing at `DeliveryDashboardScreen`. Keep stack for `DeliveryOrderDetail` and other transient screens that overlay the tab navigator.

### §B — DeliveryProfileScreen (#4 — partner can edit photo / vehicle / displayName)

`src/screens/delivery/DeliveryProfileScreen.tsx`:

```
┌─────────────────────────────────────┐
│       Profile                       │
├─────────────────────────────────────┤
│                                     │
│        ┌──────────┐                 │
│        │ [photo]  │                 │
│        │          │  Tap to change  │
│        └──────────┘                 │
│                                     │
│        Rahul Bhat                   │
│        ⭐ 4.8 · 142 deliveries       │
│                                     │
│ ─────────────────────────────────── │
│                                     │
│ Display name                        │
│ ┌─────────────────────────────────┐ │
│ │ Rahul Bhat                      │ │
│ └─────────────────────────────────┘ │
│                                     │
│ Phone (verified)                    │
│ +91 8888888885 (read-only)          │
│                                     │
│ Vehicle                             │
│ ( ) 🛵 Motorbike                    │
│ (•) 🚲 Bicycle                       │
│ ( ) 🚶 On foot                       │
│ ( ) 🚗 Car                          │
│                                     │
│           [ Save changes ]          │
└─────────────────────────────────────┘
```

State: `photoUrl`, `displayName`, `vehicleType`, plus `saving` + `dirty`.

Save button enabled only when `dirty`. Saving calls new callable `updateMyDeliveryProfile({ displayName?, vehicleType?, profilePhotoUrl? })`. After success, refresh local state from server (so any server-side normalization wins).

Photo edit reuses `getPartnerPhotoUploadUrl` callable (PR-2) — same signed URL flow as onboarding. Just no `requestDeliveryRole` follow-up; the user is already approved.

### §C — DeliverySettingsScreen (#6 — moves PR-4's low-rating settings here)

`src/screens/delivery/DeliverySettingsScreen.tsx`:

```
┌─────────────────────────────────────┐
│       Settings                      │
├─────────────────────────────────────┤
│                                     │
│ Notifications                       │
│                                     │
│ Low-rating alert                    │
│ Get notified when a customer rates  │
│ you at or below this many ★         │
│                                     │
│ Threshold: [ 3 ★ ▾ ]   (1-5)        │
│                                     │
│ [✓] Enabled                         │
│                                     │
│           [ Save ]                  │
│                                     │
│ ─────────────────────────────────── │
│                                     │
│ Account                             │
│ Sign out                            │
│ Switch role (dev only)              │
└─────────────────────────────────────┘
```

Replicates the existing low-rating UI from `DeliveryDashboardScreen` (PR-4's "LOW-RATING ALERTS" card) but in dedicated screen. Delete the original card from the dashboard once Settings is wired (cleanup pass in §G).

### §D — DeliveryEarningsScreen (#6 — basic pilot earnings)

`src/screens/delivery/DeliveryEarningsScreen.tsx`:

```
┌─────────────────────────────────────┐
│       Earnings                      │
├─────────────────────────────────────┤
│                                     │
│ ┌─────────────────────────────────┐ │
│ │   Today                         │ │
│ │   ₹240                          │ │
│ │   from 4 deliveries             │ │
│ └─────────────────────────────────┘ │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │   This week                     │ │
│ │   ₹1,420                        │ │
│ │   from 23 deliveries            │ │
│ └─────────────────────────────────┘ │
│                                     │
│ ─────────────────────────────────── │
│                                     │
│ Recent deliveries                   │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ ORD-1781… · 2pm today           │ │
│ │ US Shoppers → Customer A        │ │
│ │ ₹60                             │ │
│ └─────────────────────────────────┘ │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ ORD-1780… · 11am today          │ │
│ │ Merugu Store → Customer B       │ │
│ │ ₹45                             │ │
│ └─────────────────────────────────┘ │
│                                     │
│ (paginated, scroll for more)        │
└─────────────────────────────────────┘
```

New callable `listMyEarnings({ from?: number, limit?: number })`:
- Returns `{ today: { totalRupees, count }, week: { totalRupees, count }, deliveries: [...] }`
- Auth: must be `delivery: true` claim (use the same audit-grep-verified pattern as the HOTFIX-5 fix)
- Server queries `orders` collection where `deliveryPersonId == uid && status == 'delivered'`, sums `deliveryFee` for time windows
- Pin with **+6 tests** (today / week sums; multi-day delivery; partner with zero deliveries; pagination cursor; wrong-role rejection)

### §E — DeliveryDashboardScreen (now Home tab) — #1 + #2 + #3 enhancements

**#1 — Earnings line on coming-up + active cards:**
Already shipped in PR-NEXT-PARTNER-VIS for `AvailablePickupCard` + `ActiveDeliveryCard`. Bundle adds the same line to `ComingUpPickupCard` (new from PR-1 PARTNER-HEADS-UP):

```tsx
{typeof order.deliveryFee === 'number' && order.deliveryFee > 0 && (
  <Text style={styles.earningsLine}>
    💰 Earn {formatRupees(order.deliveryFee)}
  </Text>
)}
```

**#2 — Preparing orders sort to top of Coming up:**
In the `listMyAvailablePickups` callable extension from PR-1, sort the `coming_up` array by status priority: `preparing` first (closest to ready), then `accepted`. Within each status, sort by readyByEstimate ascending.

Pure helper `sortComingUpByPriority(orders)`:
```ts
const STATUS_PRIORITY = { preparing: 0, accepted: 1 };
return orders.sort((a, b) => {
  const aP = STATUS_PRIORITY[a.status] ?? 99;
  const bP = STATUS_PRIORITY[b.status] ?? 99;
  if (aP !== bP) return aP - bP;
  return (a.readyByEstimate ?? Infinity) - (b.readyByEstimate ?? Infinity);
});
```

Pin with **+4 tests** (preparing-before-accepted, secondary readyByEstimate sort, mixed list, empty).

**#3 — Sort/filter chip row at top of each section:**

```
🚚 Available pickups
[ All ] [ Nearest ] [ Highest pay ] [ Newest ]
┌─────────────────────────────────────┐
│ Shop A · 1.2 km · 💰 ₹60            │
└─────────────────────────────────────┘
┌─────────────────────────────────────┐
│ Shop B · 2.5 km · 💰 ₹80            │
└─────────────────────────────────────┘
```

Sort state per section in component state. Chip taps re-sort the local array (no server round-trip). Default: `Nearest` (existing behavior). Pin sorting helpers:

```ts
const sortPickups = (orders: Order[], sort: 'distance' | 'pay' | 'age') => {
  switch (sort) {
    case 'distance': return [...orders].sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
    case 'pay': return [...orders].sort((a, b) => (b.deliveryFee ?? 0) - (a.deliveryFee ?? 0));
    case 'age': return [...orders].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  }
};
```

Pin with **+8 tests** (3 sort modes × 2-3 cases each including ties + missing fields).

Coming up section uses `preparing-first` + chip sort. Available + My deliveries get the chip row too.

### §F — New server callable: `updateMyDeliveryProfile`

`functions/src/index.ts`:

```ts
export const updateMyDeliveryProfile = onCall<{
  displayName?: string;
  vehicleType?: 'motorbike' | 'bicycle' | 'on_foot' | 'car';
  profilePhotoUrl?: string;
}>(
  { cors: true, enforceAppCheck: false, region: 'asia-south1' },
  async req => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in required');
    const claims = (req.auth?.token ?? {}) as Record<string, unknown>;
    // HOTFIX-5 lineage — use `delivery`, NOT `isDelivery`. Rule 5
    // schema-verified against existing convention in claimDelivery,
    // markPickedUp, etc.
    if (claims.delivery !== true) {
      throw new HttpsError('permission-denied', 'Delivery partner role required');
    }
    const { displayName, vehicleType, profilePhotoUrl } = req.data ?? {};
    const validVehicles = ['motorbike', 'bicycle', 'on_foot', 'car'];
    if (vehicleType !== undefined && !validVehicles.includes(vehicleType)) {
      throw new HttpsError('invalid-argument', 'Invalid vehicleType');
    }
    if (profilePhotoUrl !== undefined && typeof profilePhotoUrl !== 'string') {
      throw new HttpsError('invalid-argument', 'Invalid profilePhotoUrl');
    }
    const patch: Record<string, unknown> = {};
    if (typeof displayName === 'string') patch.displayName = displayName.trim().slice(0, 60);
    if (vehicleType !== undefined) patch.vehicleType = vehicleType;
    if (profilePhotoUrl !== undefined) patch.profilePhotoUrl = profilePhotoUrl;
    if (Object.keys(patch).length === 0) {
      return { ok: true, changed: 0 };
    }
    await db.doc(`users/${uid}`).set(patch, { merge: true });
    return { ok: true, changed: Object.keys(patch).length };
  },
);
```

Pin with **+5 tests** (success-all-fields, success-partial, no-op-empty, wrong-role, invalid-vehicle).

### §G — Cleanup pass on DeliveryDashboardScreen

Remove from `DeliveryDashboardScreen`:
- The "LOW-RATING ALERTS" card section (PR-4) — moved to Settings
- The vehicle type display (now editable on Profile)
- Any other config UI that belongs on Settings

Keep: section headers (Coming up / Available pickups / My deliveries) + order cards + sort chips (§E).

---

## Discipline checklist

1. **Rule 1** — all new imports + state reads carry "PR-NEXT-BUNDLE-D — DO NOT REMOVE" comments.
2. **Rule 2** — useStates sit with other top-level hooks above conditional returns on each new screen.
3. **Rule 5** — schema audit-grep table in header. New screens reference fields already audited (no new doc paths).
4. **Rule 7** — fixtures use real auth.token shape with `delivery: true` claim (NOT `isDelivery`).
5. **Rule 11** — IAM verify post-deploy on `updateMyDeliveryProfile` (new), `listMyEarnings` (new), `listMyAvailablePickups` (modified). 3 services.
6. **Rule 13** — N/A.
7. **Rule 14** — both new callables return discriminated-union Results.
8. **Schema-additive** — no new fields; reuses existing `users/{uid}` doc fields from PR-2/PR-4.
9. **Test discipline:** +6 (listMyEarnings) + 4 (sortComingUpByPriority) + 8 (sortPickups) + 5 (updateMyDeliveryProfile) = **+23 tests minimum.** Suite trajectory ~1425 → ~1448.

---

## Acceptance checklist

1. Sign in as delivery partner → bottom nav shows 4 tabs (Home, Earnings, Profile, Settings).
2. **Home tab** (Dashboard): Coming up section shows preparing orders first; chip row at top: All/Nearest/Highest pay/Newest works; coming-up cards show 💰 Earn ₹X line.
3. **Earnings tab**: shows Today + This week sums + recent-delivery list. Verify numbers match Firestore by manually summing `order.deliveryFee` for delivered orders by this partner.
4. **Profile tab**: shows photo + name + ⭐ rating; edit photo via camera/library (reuses PR-2's signed URL flow); change vehicle type radio; save persists.
5. **Settings tab**: threshold + enabled toggle (moved from old dashboard); Save calls `updatePartnerRatingAlertSettings` (now works with HOTFIX-5 deployed).
6. Old dashboard's low-rating card REMOVED. Old vehicle-type display REMOVED.
7. **Server-side bypass attempt**: invoke `updateMyDeliveryProfile` as a customer-role user → returns `permission-denied`.
8. **Cloud Run IAM** — verify `updatemydeliveryprofile` + `listmyearnings` + `listmyavailablepickups` all have `allUsers/roles/run.invoker`.
9. Bundle C bug fixes ride this OTA: #5 partner claim check works; #7 keyboard avoidance works on Android ResponseModal.
10. `npx tsc --noEmit` clean (root + functions). `npm test` clean. Suite +23 minimum.

## Out of scope

- **Per-delivery breakdown** (incentive bonuses, surge, tips). Pilot uses flat `deliveryFee`.
- **Date-range earnings query** (last month, last year). Today + week is enough for pilot.
- **Push notification on payment received** to partner. No payment processor; partners settle out-of-band.
- **Profile photo crop UI**. Phone's native crop in `ImagePicker` is enough.

## Deploy

```
cd functions; npm run build; cd ..
firebase deploy --only "functions:updateMyDeliveryProfile,functions:listMyEarnings,functions:listMyAvailablePickups"

foreach ($svc in 'updatemydeliveryprofile','listmyearnings','listmyavailablepickups') {
  gcloud run services get-iam-policy $svc --region=asia-south1 --project=grocery-mvp-dev
}

eas update --branch production --message "PR-NEXT-BUNDLE-D delivery partner UX: tabs + profile + earnings + sort filters"
```

## Doc trail (Cowork)

After ship: TESTING-FINDINGS — close #1, #2, #3, #4, #6. CLAUDE.md In-flight strike. SESSION_LOG paragraph.
