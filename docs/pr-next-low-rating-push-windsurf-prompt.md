# PR-NEXT-LOW-RATING-PUSH — Per-role configurable low-rating push notifications

**Source:** Sudhir's 2026-06-09 e2e finding #15: *"Once rating is submitted by customer, I would like to send notification to delivery partner and shop keeper so they can take immediate action if something went wrong. Also, I would like somehow Admin know about it so admin can coordinate and fix things faster… it should be configurable for shop, admin and delivery partner to know if rating is lower than a certain number."* Scope locked: **per-role configurable thresholds + opt-in.**

**Design lens — customer satisfaction recovery:** when a low rating fires, the shop owner or delivery partner shouldn't learn about it the next time they happen to open the admin dashboard. They should know within seconds and have a chance to call the customer, refund, apologize — before the customer tells five friends. Push + configurable threshold makes that possible without spam.

**Deploy class:** **server-first** (1 new callable for settings + 1 modified rating submission callable + new trigger / fan-out) → IAM verify → client OTA.

## Autonomous execution authorization

You may run the following without stopping to confirm — execute, report results in the final summary:

- All `Read`, `Grep`, `Glob`, `ls`, `git status`, `git diff` (read-only)
- `npx tsc --noEmit` (root and `functions/`)
- `npm test`, `npm run test:unit`, `npm run test:full`, `npx jest`
- `npm run lint`, `npx eslint`
- `cd functions && npm run build`
- File edits to files explicitly named in §A–§E below
- New file creation in directories explicitly named in the plan
- Re-running any of the above to verify after fixing an error

You MUST stop and ask before:

- Deploy commands: `firebase deploy …`, `eas update`, `eas build`, `gcloud run …`
- File deletes
- Force-push, rebase, branch ops
- Editing files NOT named in §A–§E
- Adding NEW dependencies not listed in the plan
- Schema additions / migrations not in the spec
- Firestore rules changes not in the spec

Default posture: **execute, report at end.**

## Schema audit-grep (Rule 5)

```
grep -rn "submitRating\|RateOrderCard\|orderRating" src functions/src
grep -rn "pushToOwner\|pushToAdmins\|pushHelpers" functions/src
grep -rn "users/{uid}.notifications\|users/{uid}.preferences" src functions/src
grep -rn "appConfig/" functions/src
```

| Symbol | Confirmed at | Notes |
| --- | --- | --- |
| `submitRating` callable | (find via grep — exact name may vary) | The submit point that this PR extends with fan-out logic |
| `OrderRating` type | `src/types/index.ts:636` | Has `shopStars`, `deliveryStars`, optional `comment` fields |
| `pushToOwner` / `pushToAdmins` | `functions/src/pushHelpers.ts` (likely) | Reuse for fan-out routing |
| `appConfig/{doc}` | established convention (`shopVisibility`, `pilotStatus`, etc.) | New doc `appConfig/ratingAlerts` for global defaults |
| Per-user fields | `users/{uid}` | NEW optional fields for per-role overrides + opt-in |

## Plan

### §A — Schema additions (additive only)

`Shop` type:
```ts
// PR-NEXT-LOW-RATING-PUSH — per-shop threshold override. When null/
// undefined, falls back to appConfig/ratingAlerts.shopDefaultThreshold.
lowRatingThreshold?: number | null;
lowRatingNotificationsEnabled?: boolean | null;
```

`UserProfile` (delivery partner side):
```ts
// PR-NEXT-LOW-RATING-PUSH — per-partner threshold override. Customer
// users may have these set too but they have no effect (no fan-out
// targets a customer).
lowRatingThreshold?: number | null;
lowRatingNotificationsEnabled?: boolean | null;
```

Global config doc `appConfig/ratingAlerts`:
```ts
{
  shopDefaultThreshold: number;       // default 3 (stars; ≤ this triggers)
  partnerDefaultThreshold: number;    // default 3
  adminThreshold: number;             // default 3 (admins always notified)
  adminNotificationsEnabled: boolean; // default true
}
```

Missing doc → all defaults applied (3 stars, enabled). Same fail-OPEN posture as other appConfig flags.

### §B — Pure helpers

`functions/src/lowRatingAlertHelpers.ts`:

```ts
/**
 * PR-NEXT-LOW-RATING-PUSH — pure decision helpers for the
 * low-rating fan-out. Three roles, three independent decisions.
 * Each returns a discriminated-union Result with the threshold
 * used + the rating compared so the audit log can justify the
 * push.
 */

export type AlertConfig = {
  shopDefaultThreshold: number;
  partnerDefaultThreshold: number;
  adminThreshold: number;
  adminNotificationsEnabled: boolean;
};

export type ShopOverride = {
  lowRatingThreshold?: number | null;
  lowRatingNotificationsEnabled?: boolean | null;
};

export type PartnerOverride = ShopOverride;

export type FanoutDecision =
  | { notify: true; threshold: number; reason: 'rating_at_or_below_threshold' }
  | { notify: false; reason: 'rating_above_threshold' | 'opted_out' };

const DEFAULTS: AlertConfig = {
  shopDefaultThreshold: 3,
  partnerDefaultThreshold: 3,
  adminThreshold: 3,
  adminNotificationsEnabled: true,
};

export function parseAlertConfig(raw: unknown): AlertConfig {
  if (!raw || typeof raw !== 'object') return DEFAULTS;
  const r = raw as Record<string, unknown>;
  return {
    shopDefaultThreshold:
      typeof r.shopDefaultThreshold === 'number' && Number.isFinite(r.shopDefaultThreshold)
        ? r.shopDefaultThreshold : DEFAULTS.shopDefaultThreshold,
    partnerDefaultThreshold:
      typeof r.partnerDefaultThreshold === 'number' && Number.isFinite(r.partnerDefaultThreshold)
        ? r.partnerDefaultThreshold : DEFAULTS.partnerDefaultThreshold,
    adminThreshold:
      typeof r.adminThreshold === 'number' && Number.isFinite(r.adminThreshold)
        ? r.adminThreshold : DEFAULTS.adminThreshold,
    adminNotificationsEnabled:
      r.adminNotificationsEnabled === false ? false : DEFAULTS.adminNotificationsEnabled,
  };
}

export function decideShopFanout(args: {
  shopStars: number;
  shopOverride: ShopOverride | null;
  config: AlertConfig;
}): FanoutDecision {
  const enabled = args.shopOverride?.lowRatingNotificationsEnabled !== false; // default true
  if (!enabled) return { notify: false, reason: 'opted_out' };
  const threshold = args.shopOverride?.lowRatingThreshold ?? args.config.shopDefaultThreshold;
  return args.shopStars <= threshold
    ? { notify: true, threshold, reason: 'rating_at_or_below_threshold' }
    : { notify: false, reason: 'rating_above_threshold' };
}

export function decidePartnerFanout(args: {
  partnerStars: number;
  partnerOverride: PartnerOverride | null;
  config: AlertConfig;
}): FanoutDecision { /* mirror decideShopFanout shape */ }

export function decideAdminFanout(args: {
  worstStars: number;  // min(shopStars, partnerStars)
  config: AlertConfig;
}): FanoutDecision {
  if (!args.config.adminNotificationsEnabled) {
    return { notify: false, reason: 'opted_out' };
  }
  return args.worstStars <= args.config.adminThreshold
    ? { notify: true, threshold: args.config.adminThreshold, reason: 'rating_at_or_below_threshold' }
    : { notify: false, reason: 'rating_above_threshold' };
}
```

Pin with **15 tests**: parseAlertConfig (5 cases: null, empty object, partial, full, malformed types); decideShopFanout (4 cases: above/below/at threshold, opted out); decidePartnerFanout (mirror, 3 cases); decideAdminFanout (3 cases: above/below/disabled).

### §C — Server: extend `submitRating` with fan-out

Find the rating-submit callable (grep). After the rating doc write, add:

```ts
// PR-NEXT-LOW-RATING-PUSH — fan-out on low ratings.
const configSnap = await db.doc('appConfig/ratingAlerts').get();
const config = parseAlertConfig(configSnap.exists ? configSnap.data() : null);
const shopSnap = await db.doc(`shops/${order.shopId}`).get();
const shopOverride = shopSnap.exists ? {
  lowRatingThreshold: shopSnap.data()?.lowRatingThreshold ?? null,
  lowRatingNotificationsEnabled: shopSnap.data()?.lowRatingNotificationsEnabled ?? null,
} : null;

const shopFanout = decideShopFanout({ shopStars, shopOverride, config });
if (shopFanout.notify) {
  await pushToOwner(shop.ownerUid, '⚠️ Low rating received', `${shopStars}★ on order ${orderId.slice(-8)}. Tap to view.`);
  // log to auditLog for traceability
}

// repeat for partner (look up partner doc if rated)
// repeat for admins via pushToAdmins
```

Push payload includes `type: 'low_rating_for_shop'` (or `_for_partner` / `_for_admin`) + `orderId` for deep-link routing.

### §D — Client: per-role threshold settings UI

`src/screens/shop/ShopSettingsScreen.tsx` — new "Notifications" section:
```
┌─────────────────────────────────────┐
│ Notifications                       │
│                                     │
│ Low-rating alert                    │
│ Get notified when a customer rates  │
│ your shop at or below this many ★   │
│                                     │
│ Threshold: [ 3 ★ ▾ ]   (1-5)        │
│                                     │
│ [✓] Enabled                         │
│                                     │
│ [ Save ]                            │
└─────────────────────────────────────┘
```

Similar block in `src/screens/delivery/DeliveryProfileScreen.tsx` for partner threshold.

For admin: a new `src/screens/admin/AdminSettingsScreen.tsx` (or existing — grep) section editing `appConfig/ratingAlerts.adminThreshold` + `adminNotificationsEnabled`. Admin-only callable `updateRatingAlertConfig` to write to the doc.

Two new callables:
1. `updateShopRatingAlertSettings({ shopId, threshold, enabled })` — auth: admin OR shop owner of this shop
2. `updatePartnerRatingAlertSettings({ threshold, enabled })` — auth: caller is the partner (writes to own user doc)
3. `updateAdminRatingAlertConfig({ shopDefaultThreshold, partnerDefaultThreshold, adminThreshold, adminNotificationsEnabled })` — auth: admin only

Each returns the new state. Pin with **+6 tests** (2 per callable: success + auth fail).

### §E — Deep-link routing

`AuthBootstrap.tsx` push handler (HOTFIX-5 deep-link infra) — add 3 new push types:
- `low_rating_for_shop` → navigate to `ShopOrderDetail` with the orderId
- `low_rating_for_partner` → navigate to `DeliveryOrderDetail`
- `low_rating_for_admin` → navigate to `AdminOrders` (or specific order detail)

Same audience-precedence pattern as PR-NEXT-NOTIFY-EXTEND's `order_picked_up`.

---

## Discipline checklist

1. **Rule 1** — every new import + state read carries "PR-NEXT-LOW-RATING-PUSH — DO NOT REMOVE" comments.
2. **Rule 2** — useStates in settings screens above conditional returns.
3. **Rule 5** — schema audit-grep table in header. All new fields optional + nullable.
4. **Rule 7** — fixtures use real Firestore shapes for users + shops + orders.
5. **Rule 11** — IAM verify on `submitRating` (modified) + 3 new callables.
6. **Rule 13** — N/A.
7. **Rule 14** — `decideShopFanout` etc. return discriminated-union FanoutDecision.
8. **Schema-additive only** — 2 new fields on Shop, 2 new on user, new `appConfig/ratingAlerts` doc.
9. **Test discipline:** **+15** helpers + **+6** callable auth = **+21 tests minimum.** Suite trajectory 1379 → ~1400 (assuming STATIC-MAP landed first).

## Acceptance checklist

1. Customer submits 1-star rating. Shop owner gets push within 5s. Tapping push opens that order's detail.
2. Partner gets separate push if partner-rated ≤ 3. Different deep-link.
3. Admin gets push (if admin notifications enabled). Different deep-link.
4. Shop owner sets threshold to 5 (notify on ANY rating). 5-star rating triggers push.
5. Shop owner disables notifications. Even a 1-star rating does NOT push to shop owner. Partner + admin still get theirs.
6. Customer submits 4-star + 5-star (no low rating). No one pushed.
7. Default config (no `appConfig/ratingAlerts` doc) → all 3 roles at threshold 3, all enabled. 2-star rating fires all 3.
8. Admin changes global `partnerDefaultThreshold` to 2. Partner who hasn't set their own override → threshold = 2. Partner with override = 4 → threshold = 4 (override wins).
9. **Negative — shop owner of a different shop tries to update Shop A's settings.** `updateShopRatingAlertSettings({ shopId: A, ... })` returns permission-denied.
10. IAM verify post-deploy on `submitRating`, `updateShopRatingAlertSettings`, `updatePartnerRatingAlertSettings`, `updateAdminRatingAlertConfig`.
11. `npx tsc --noEmit` clean. `npm run test:unit` clean. Suite +21 minimum.

## Out of scope

- **Per-customer notification preferences.** Customer doesn't receive fan-out pushes; only shop/partner/admin do.
- **Rating-comment NLP** to detect "this was great but I gave 1 star by mistake" anomalies. Trust the stars.
- **Auto-refund on low rating.** Sudhir's call when this signal is real.
- **Daily digest** instead of per-rating push. Per-rating is the design choice — recovery time matters.

## Deploy

```
# Server first
cd functions; npm run build; cd ..
firebase deploy --only "functions:submitRating,functions:updateShopRatingAlertSettings,functions:updatePartnerRatingAlertSettings,functions:updateAdminRatingAlertConfig"

# IAM verify all 4
foreach ($svc in 'submitrating','updateshopratingalertssettings','updatepartnerratingalertssettings','updateadminratingalertconfig') {
  gcloud run services get-iam-policy $svc --region=asia-south1 --project=grocery-mvp-dev
}

# Firestore rules update (allow shop owner to write their own shop's threshold/enabled fields; partner can write their own user doc's fields; admin can write appConfig/ratingAlerts)
firebase deploy --only firestore:rules

# Client OTA
eas update --branch production --message "PR-NEXT-LOW-RATING-PUSH per-role low-rating fan-out"
```

## Doc trail (Cowork)

Append #15 to TESTING-FINDINGS. Update CLAUDE.md + SESSION_LOG.
