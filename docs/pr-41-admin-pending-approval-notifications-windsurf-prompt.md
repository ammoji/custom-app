# PR 41 — Admin pending-approval notifications + badges (Windsurf prompt)

## Why this PR exists

Today, when a shopkeeper submits KYC via `RegisterShopScreen`, a
new doc lands in `pendingShopRequests/{id}` and the shopkeeper sits
on `WaitingForApprovalScreen` indefinitely. **The admin only finds
out by manually opening Admin → Pending Shops.** No badge, no
banner, no push.

Same gap exists for `deliveryRequests/{id}` — delivery
partner applicants are blind to admin attention until the admin
happens to scroll there.

During pilot with a single admin (Sudhir), this is the difference
between a shop owner sitting on a blank screen for 12 hours
overnight vs. getting approved within minutes of submitting. It's
a direct Trust Principle 2 (close the loop) violation for both
the applicant and the admin.

The fix is a small additive PR that reuses the existing PR 16
push infrastructure:

1. Two new Firestore `onDocumentCreated` triggers — one per
   pending queue.
2. A shared helper `notifyAllAdmins(title, body, data)` that
   queries `users` for `isAdmin === true`, pulls their
   `fcmTokens`, and fans out via the Expo Push relay.
3. Live badge counts on three admin entry points (HomeScreen
   admin tile, the admin nav rows for each queue, and the
   PendingShops/PendingDeliveryRequests screen headers) sourced
   from `onSnapshot` listeners on the same two collections.

No schema changes. No native rebuild. OTA-eligible client deploy
+ standard `firebase deploy --only functions` for the triggers.

## Read first

- `.windsurf/code-discipline.md` — especially hooks-above-returns
  and import-strip rules. The badge-counts subscription is a hook
  and must sit above any conditional return in HomeScreen.
- `.windsurf/test-discipline.md`.
- `.windsurf/deploy-discipline.md` — confirm this is OTA-eligible
  (no native dependency changes, no permission strings, no
  config plugins).
- **`functions/src/index.ts` lines 2429–2509** — existing
  `registerPushToken` + `unregisterPushToken` callables. New
  triggers reuse this token storage convention (`users/{uid}
  .fcmTokens`).
- **`functions/src/index.ts` lines 2512–2580** — existing
  `sendOrderStatusPush` Firestore trigger. Pattern to copy:
  read `fcmTokens` array, batch-send via
  `https://exp.host/--/api/v2/push/send`, log result counts.
- **`functions/src/index.ts` lines 3852–3880** — comment about
  mirroring claim changes onto `users/{uid}` so push fan-out
  queries work. Confirms that `isAdmin: true` IS mirrored to
  the users doc (via PR 31.1's `set-admin.ts` and the
  `approveShop` callable), so a query `users.where('isAdmin',
  '==', true)` is reliable.
- `src/services/pushService.ts` — client-side token register/
  unregister flow. The Android notification channel `default`
  is already created at line 112; this PR adds a second channel
  `admin-alerts` so admins can mute admin notifications
  separately from order notifications.
- `src/screens/HomeScreen.tsx` — where the admin entry tile
  lives. Look at the existing role tiles (favorites tile around
  line 575, Quick Switch tile around line 589) for the pattern
  to copy for the new badge.
- `src/screens/admin/PendingShopsScreen.tsx` — header treatment.
- `src/screens/admin/PendingDeliveryRequestsScreen.tsx` —
  header treatment.

## Scope of changes

### A. New shared helper in `functions/src/notifyAdminsHelpers.ts`

Pure helper — testable without firebase-admin or the emulator
(same pattern as `searchMenuPublicHelpers.ts`, `aiHelpers.ts`,
etc.).

```ts
/**
 * PR 41 — Build the Expo push payload(s) for an admin fan-out.
 *
 * Pure. Takes a flat list of admin docs (each with a fcmTokens
 * array on it), dedupes tokens across users (an admin signed in
 * on two devices has two tokens; the same token can show up once),
 * and returns an array of Expo push message objects ready to POST.
 *
 * Caller is responsible for the network call + Firestore query —
 * keeping IO out lets us unit-test the dedup + body construction
 * without booting firebase-admin.
 */
export function buildAdminPushMessages(
  admins: Array<{ uid: string; fcmTokens?: string[] }>,
  title: string,
  body: string,
  data: Record<string, unknown>,
): ExpoPushMessage[] { /* ... */ }

export type ExpoPushMessage = {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  channelId?: 'admin-alerts';
  sound: 'default';
  priority: 'high';
};
```

Implementation notes:
- Dedupe tokens — if the same Expo push token appears under two
  admin user docs (rare but possible), include it once.
- Skip tokens that don't start with `ExponentPushToken[` (defense
  against stale data).
- `channelId: 'admin-alerts'` — separates admin alerts from order
  alerts on Android. Client adds this channel in pushService.ts
  (see Section C below).
- `data` payload carries the deeplink hint:
  - For shop requests: `{ type: 'pending_shop', requestId: '...' }`
  - For delivery requests: `{ type: 'pending_delivery', requestId: '...' }`

### B. Two new Cloud Function triggers in `functions/src/index.ts`

Both follow the same shape as `sendOrderStatusPush`.

```ts
// Triggered when a new pendingShopRequests doc is created
// (i.e. a shopkeeper just hit "Submit application" on
// RegisterShopScreen).
export const notifyAdminsOnNewShopRequest = onDocumentCreated(
  'pendingShopRequests/{requestId}',
  async event => {
    const data = event.data?.data();
    if (!data) return;
    const shopName = String(data.shopName ?? 'A new shop');
    const ownerName = String(data.ownerName ?? '');

    const title = 'New shop awaiting approval';
    const body = ownerName
      ? `${shopName} — ${ownerName} just registered`
      : `${shopName} just registered`;

    await notifyAllAdmins(db, title, body, {
      type: 'pending_shop',
      requestId: event.params.requestId,
    });
  },
);

// Triggered when a new deliveryRequests doc is created
// (i.e. a customer just hit "Apply" on BecomeDeliveryPartnerScreen).
export const notifyAdminsOnNewDeliveryRequest = onDocumentCreated(
  'deliveryRequests/{requestId}',
  async event => {
    const data = event.data?.data();
    if (!data) return;
    const applicantName = String(data.name ?? 'A new applicant');

    const title = 'New delivery partner application';
    const body = `${applicantName} just applied`;

    await notifyAllAdmins(db, title, body, {
      type: 'pending_delivery',
      requestId: event.params.requestId,
    });
  },
);
```

The `notifyAllAdmins(db, title, body, data)` helper lives in
index.ts (not the pure-helpers file — it does Firestore IO):

```ts
async function notifyAllAdmins(
  db: Firestore,
  title: string,
  body: string,
  data: Record<string, unknown>,
): Promise<void> {
  // Query admins. Mirror field is reliable per PR 31.1 +
  // set-admin.ts; PR 38.1's audit confirmed this is the right
  // source for "where to push to" rather than auth custom claims.
  const adminsSnap = await db
    .collection('users')
    .where('isAdmin', '==', true)
    .get();

  const admins = adminsSnap.docs.map(d => ({
    uid: d.id,
    fcmTokens: (d.data() as any).fcmTokens ?? [],
  }));

  const messages = buildAdminPushMessages(admins, title, body, data);

  if (messages.length === 0) {
    console.log('[notifyAllAdmins] no tokens to push to — skipping');
    return;
  }

  // Expo Push API accepts batches up to 100 messages. We'll have
  // very few admins (1 in pilot, maybe 3-5 ever) so a single call
  // is fine.
  const res = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Accept-encoding': 'gzip, deflate',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(messages),
  });
  console.log(
    `[notifyAllAdmins] sent ${messages.length} push(es); status=${res.status}`,
  );
}
```

### C. Android notification channel for admin alerts

In `src/services/pushService.ts`, inside `registerForPushNotifications`,
add a second `setNotificationChannelAsync` call right after the
existing `default` channel:

```ts
if (Platform.OS === 'android') {
  await Notifications.setNotificationChannelAsync('default', {
    name: 'Order Updates',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#0E7C3A',
  });
  // PR 41 — admin alerts go on a separate channel so admins (who
  // may also be customers or shop owners) can mute one without
  // muting the other. Order alerts are HIGH because they need
  // to break through silent mode; admin alerts are DEFAULT.
  await Notifications.setNotificationChannelAsync('admin-alerts', {
    name: 'Admin Approval Queue',
    importance: Notifications.AndroidImportance.DEFAULT,
    vibrationPattern: [0, 200, 200, 200],
    lightColor: '#0E7C3A',
  });
}
```

### D. New client hook `src/hooks/usePendingCounts.ts`

Encapsulates the two live count subscriptions. Returns `{
shopCount, deliveryCount, loading }`. Admin-only (returns
zeros for non-admins).

```ts
/**
 * PR 41 — Live counts of pending approval queues, for admin badges.
 *
 * Subscribes to two onSnapshot listeners (one per collection) so
 * counts stay fresh as new submissions land or admin approves
 * existing ones. Auto-tears down on unmount.
 *
 * Non-admins get { shopCount: 0, deliveryCount: 0 } without
 * subscribing — Firestore rules already block them, but skipping
 * the subscription entirely avoids burning a permission-denied
 * error in the console.
 */
export function usePendingCounts(): {
  shopCount: number;
  deliveryCount: number;
  loading: boolean;
} { /* ... */ }
```

Implementation uses the native Firestore SDK
(@react-native-firebase/firestore) on native and the web SDK on
web, mirroring the Plan B pattern already established in
`orderService.ts` / `shopService.ts`. Reason: native callable
context (RNFB auth) doesn't propagate to web SDK reads, and
admin reads need auth claims server-side. Pattern is well-trodden
in this repo; copy what `shopService.getNearbyShops` does.

If you prefer simplicity, use a single callable
`getPendingApprovalCounts` instead — server returns `{ shopCount,
deliveryCount }`. Loses the live-update property but doesn't have
the Plan B branching. **Recommended: callable.** Pilot will have
<10 pending items at any moment; the cost of "tap the screen to
refresh" is acceptable, and the simpler client code is worth it.
The callable should `enforceAppCheck: false` (consistent with
other admin callables) and require `request.auth.token.admin ===
true`.

### E. Badge rendering on three places

**Place 1 — HomeScreen admin entry tile.**

Today the admin entry on HomeScreen looks like:
```
👮  Admin tools  ›
```

Update to:
```
👮  Admin tools  · 2 pending  ›
```

Pattern: read `shopCount + deliveryCount` from the hook; render
a small inline `· N pending` segment only when count > 0. Style
matches existing tile text but with a brighter color to draw the
eye (e.g., `colors.warning` for the "pending" segment).

**Place 2 — Admin nav rows for each queue.**

Wherever the admin navigates to PendingShops and
PendingDeliveryRequests (probably a list in
`AdminOrdersScreen` or wherever the admin tabs are wired), add
a trailing count badge on each row:
- "Pending Shops" → "Pending Shops (2)"
- "Pending Delivery Requests" → "Pending Delivery Requests (0)" (hide
  the count when 0)

**Place 3 — Screen headers.**

`PendingShopsScreen` header text: "Pending Shops (2)" — total
visible at glance even after scrolling. Same for the delivery
screen.

### F. Deeplink handling on notification tap

In `App.js` (or wherever `Notifications.addNotificationResponseReceivedListener`
is set up — look for the existing listener that handles order
notification taps), extend the switch to handle the two new types:

```ts
const data = response.notification.request.content.data;
if (data?.type === 'pending_shop') {
  nav.navigate('Admin', {
    screen: 'ShopRegistrationDetail',
    params: { requestId: data.requestId },
  });
} else if (data?.type === 'pending_delivery') {
  nav.navigate('Admin', {
    screen: 'DeliveryRequestDetail',
    params: { requestId: data.requestId },
  });
}
// existing 'order_status' / etc. cases stay
```

If the user isn't admin (someone reinstalled and signed in as a
different account, or the admin claim was revoked), gracefully
fall back to HomeScreen — don't try to navigate to the admin
stack and crash.

### G. Analytics events (Strategic Principle 8)

Three new events via the existing `track()` helper. The PR 38.1
callable routing ensures these end up in `featureUsageLog/`.

- `admin_pending_shop_notified` — fired server-side via the
  trigger (logged to console; not strictly an analytics event
  since it's not from a user device, but worth a log line for
  debugging delivery).
- `admin_pending_badge_tapped` — when admin taps the badge on
  HomeScreen, with `payload: { kind: 'shop' | 'delivery',
  count: N }`.
- `admin_pending_notification_tapped` — when admin opens a push
  notification, with `payload: { type, requestId }`.

### H. Firestore rules

No rules changes needed. `pendingShopRequests` is already
admin-readable from PR 31. `deliveryRequests` same.
`users.fcmTokens` is server-side only (PR 31.1 / PR 38.1
audit confirmed write-protected).

## Tests to add

1. `tests/functions/notifyAdminsHelpers.test.ts` — pure helper
   tests for `buildAdminPushMessages`:
   - Returns empty array when no admins
   - Returns empty array when admin has no tokens
   - Dedupes a token that appears under two admin docs
   - Skips invalid token formats (not starting with
     `ExponentPushToken[`)
   - Builds correct payload shape (title, body, data, channelId,
     sound, priority)
2. `tests/functions/getPendingApprovalCounts.test.ts` — callable
   tests:
   - Returns counts when caller is admin
   - Returns PERMISSION_DENIED when caller is non-admin
3. Update `tests/functions/index.test.ts` if it registers all
   exports — add the two new triggers + new callable to the
   exports check.

Aim for ~6 new tests. Total suite should be 728+ passing after
this PR.

## Discipline checklist

- [ ] All hook calls in HomeScreen sit above any conditional
      return. The `usePendingCounts()` call goes near the top
      with the other hooks.
- [ ] No import auto-strip on HomeScreen or admin screens.
- [ ] Server-first deploy: deploy functions before client OTA.
      The client badge will just show 0 until the trigger fires,
      so deploying the client first is harmless — but discipline
      says server first anyway.
- [ ] No schema additions to existing types. The badge counts
      are derived; we don't write a `pendingCount` field.
- [ ] Callable enforces admin check: `if (!request.auth?.token
      .admin) throw new HttpsError('permission-denied', ...)`.
- [ ] No native dependency change → OTA-eligible (verify in
      deploy plan).

## Deploy plan (read carefully)

This PR is **OTA-eligible** — no native module additions, no
permission string changes, no config plugin edits, no
`app.json` plugin block changes. Just one new TypeScript file
on the server, two new triggers, one new callable, one new
hook, and three small UI badge edits.

Sequence:

1. `npm run test:unit` — green.
2. Server-first: `firebase deploy --only functions` →
   confirms `notifyAdminsOnNewShopRequest`,
   `notifyAdminsOnNewDeliveryRequest`,
   `getPendingApprovalCounts` show up in
   `firebase functions:list` output.
3. **Cloud Run IAM verification — MANDATORY new step per
   `.windsurf/deploy-discipline.md` "Cloud Run `allUsers`
   invoker IAM" section.** A May 26 2026 incident showed that
   Firebase deploys can silently leave new `onCall` functions
   without the `allUsers` → `roles/run.invoker` binding. Symptom
   is 401 from the function at runtime ("access token could not
   be verified"). Run:

   ```powershell
   gcloud run services get-iam-policy notifyadminsonnewshoprequest --region=asia-south1 --project=grocery-mvp-dev
   gcloud run services get-iam-policy notifyadminsonnewdeliveryrequest --region=asia-south1 --project=grocery-mvp-dev
   gcloud run services get-iam-policy getpendingapprovalcounts --region=asia-south1 --project=grocery-mvp-dev
   ```

   For `getpendingapprovalcounts` (the onCall callable), confirm
   `allUsers` + `roles/run.invoker` appears in bindings. If
   missing, apply:

   ```powershell
   gcloud run services add-iam-policy-binding getpendingapprovalcounts --region=asia-south1 --member=allUsers --role=roles/run.invoker --project=grocery-mvp-dev
   ```

   For the two trigger functions (`notifyAdminsOnNewShopRequest`
   and `notifyAdminsOnNewDeliveryRequest`), `allUsers` MUST NOT
   be present — they're invoked by Eventarc via internal service
   account. If allUsers is somehow set on them, remove it. They
   should look like `etag: ACAB` or have only Eventarc / service-
   account members.

4. Client OTA: `eas update --branch production --message "PR 41
   admin pending-approval notifications"`.
5. Trigger sanity test: from any signed-out test phone, register
   a new shop application. Watch:
   - Admin device gets the push within ~5s.
   - Admin HomeScreen tile shows "Admin tools · 1 pending"
     after reload.
   - Tap push → opens `ShopRegistrationDetailScreen`.
5. Same test for delivery applicant via
   `BecomeDeliveryPartnerScreen`.

## Important corrections baked into this prompt (post-smoke-test)

May 26 2026 smoke test surfaced two scope corrections from the
original PR 41 draft. Both are now reflected throughout this
prompt; calling out explicitly so reviewers know what changed:

1. **Collection name correction.** The original draft referenced
   `pendingDeliveryRequests` as the collection. The actual
   collection in production (set by PR 1 security hardening, used
   by `requestDeliveryRole` callable in `functions/src/index.ts`
   line 3642) is **`deliveryRequests`** — single collection,
   doc ID = applicant uid, doc carries `status: 'pending' |
   'approved' | 'rejected'`. All trigger paths and helper
   functions in this prompt now use the correct name.

2. **Cloud Run IAM verification is mandatory.** The deploy plan
   above adds a verification step after `firebase deploy --only
   functions`. This is a hard-learned rule from the same smoke
   test where `listpendingdeliveryrequests` 401'd despite
   "successful" deploys. Without this verification, the
   `getPendingApprovalCounts` callable will likely 401 for
   admins and the badge counts will silently be 0 across the
   app. The discipline doc has the full diagnostic + fix; the
   step above is the PR-specific application.

## Acceptance smoke test (after deploy)

(For the next pilot smoke test run — add to
`docs/PILOT_SMOKE_TEST_PLAN.md` Section 2 admin checklist.)

1. **Admin sees pending count.** Sign in as admin. Land on
   Customer Home. The "Admin tools" tile reads "Admin tools · N
   pending" where N matches the actual count in Firestore.
2. **Push notification on new shop registration.** From a
   second test phone (Shopkeeper 1), sign in fresh, tap "Open a
   shop on HamaraSetu," fill basic fields, submit. On the
   admin's device, a push notification arrives within ~5s
   titled "New shop awaiting approval" with the shop name +
   owner name in the body.
3. **Notification tap deeplinks correctly.** Tap the push on
   admin device → app opens to
   `ShopRegistrationDetailScreen` for that specific applicant.
4. **Badge clears on approval.** Approve the shop. Within ~1s
   the HomeScreen tile drops back to "Admin tools · 0 pending"
   (or just "Admin tools" if the helper hides count when 0).
5. **Same flow for delivery applicant.** Repeat from a third
   test phone via `BecomeDeliveryPartnerScreen`.
6. **Non-admin gets nothing.** Sign in as a regular customer
   (9999999991). Submit a shop registration. The customer's
   own device should NOT receive any admin notification (sanity
   check on the `isAdmin === true` filter server-side).

## Out of scope (defer)

- Rich notifications (image previews, action buttons). Phase D
  polish.
- Per-admin "subscribe to notifications" toggle in Profile.
  Phase D — for pilot, single admin so a global on/off via
  channel settings is enough.
- Sound design (custom notification sound). Future polish.
- Web push (admin opening dashboard on a laptop). Out of scope —
  web SDK Firestore + RNFB auth mismatch (PR 38.1 lesson) makes
  this messier than it sounds.
- Pending-orders-aging escalation (e.g., "this shop has been
  waiting 12 hours"). Worth doing once pilot reaches multiple
  shops; not pilot-blocking.

## Definition of done

- Two Cloud Function triggers + one callable deployed and
  visible in `firebase functions:list`.
- `usePendingCounts` hook returns live counts for admin users.
- Admin HomeScreen tile shows badge.
- Both pending-list screens show count in header.
- Notification tap deeplinks to detail screen.
- 6+ new unit tests, full suite green (~728+).
- Doc trail updated: CLAUDE.md + SESSION_LOG.md + ROADMAP.md
  reference PR 41 as shipped.
- Smoke acceptance section above added to
  `docs/PILOT_SMOKE_TEST_PLAN.md` Phase 2.
