import * as Notifications from 'expo-notifications';
import { useEffect } from 'react';
// HOTFIX-5 — DO NOT REMOVE. `navigationRef` powers the cold-start
// race-guard below (`navigationRef.isReady()`); the existing
// `safeNavigate` would silently no-op on a same-tick dispatch
// from `getLastNotificationResponseAsync` before the
// NavigationContainer has mounted.
import { navigationRef, safeNavigate } from '../navigation/navigationRef';
import { Analytics } from '../services/analytics';
import { authService } from '../services/authService';
import { pushService } from '../services/pushService';
import {
  runPushRegistration,
  type PushRegistrationOutcome,
} from '../services/pushRegistrationOrchestrator';
import { Sentry } from '../services/sentry';
import { useAuthStore } from '../store/useAuthStore';
import { useLocationStore } from '../store/useLocationStore';
import { useProfileStore } from '../store/useProfileStore';

/**
 * Renders nothing. Subscribes to Firebase auth state on mount and keeps
 * useAuthStore in sync. Provisions an anonymous uid if none exists after
 * a short grace period (lets AsyncStorage-persisted sessions rehydrate first).
 * Also kicks off a location fetch so most screens have it ready on mount.
 */
export default function AuthBootstrap() {
  const fetchLocation = useLocationStore(s => s.fetch);

  useEffect(() => {
    let refreshedOnce = false;
    // PR 45.2 — uid-aware gate. PR 45 used a boolean `pushRegisteredOk`
    // which had a fatal race: the app's startup sequence is
    // (1) AuthBootstrap mounts → (2) Firebase signs in an anonymous
    // user FIRST (`signInAnonymouslyIfNeeded`) → (3) push branch fires
    // for the anonymous user → boolean gate flips closed → (4) the
    // real user signs in via OTP → push branch re-evaluates → gate
    // says "already done" → token never registers for the REAL uid.
    // Confirmed via PR 45.1 Sentry probes on May 27 2026.
    //
    // Now we track WHICH uid was last successfully registered. The
    // orchestrator skips anonymous outright, short-circuits only when
    // the SAME real uid signs in again, and re-registers on every
    // anonymous→real upgrade or account switch.
    //
    // Scoped INSIDE useEffect so it resets on component remount (app
    // cold start), NOT module-level (would persist across remounts
    // and re-break the retry-on-cold-start semantics — same trap as
    // the PR 45 boolean).
    let lastRegisteredUid: string | null = null;
    const unsubscribe = authService.subscribe(async user => {
      useAuthStore.getState().setUser(user);
      useAuthStore.getState().setReady(true);

      // If the subscription fires with null AFTER we've already been
      // signed in (i.e. the user just hit Sign Out from Profile),
      // kick off a fresh anonymous session so the app doesn't stall
      // in a no-uid state. Without this, post-signOut the user sees
      // a Home screen with no Sign-in CTA (the row is gated on
      // isAnonymous which is false when uid is null) and no path
      // back to login. The 200ms timer below only fires once at
      // mount, so it doesn't cover the runtime signOut case.
      // signInAnonymouslyIfNeeded is idempotent (checks currentUser
      // first), so this is safe even when the null fires for other
      // reasons (token expiry, server-side revoke).
      if (!user) {
        authService.signInAnonymouslyIfNeeded().catch(err => {
          console.warn('[auth] post-signOut anon re-auth failed:', err?.code || err);
        });
        // PR 19 — clear cached profile on sign-out so the next user
        // doesn't briefly see the previous user's favorites flash
        // through HomeScreen / FavoritesScreen before the fresh
        // hydrate completes.
        useProfileStore.getState().setProfile(null);
      }

      // PR 19 — hydrate the profile store for real (non-anonymous)
      // users so HomeScreen's favorites tile + FavoriteHeart's
      // selectors have data on first render. Anonymous users skip
      // the call (their profile doc is the empty seed; nothing to
      // sync). Idempotent: every subsequent setUser tick re-fires
      // this and getMyProfile is itself cheap.
      if (user && !user.isAnonymous) {
        useProfileStore
          .getState()
          .loadFromServer()
          .catch(err => {
            console.warn('[bootstrap] profile hydrate failed:', err);
          });
      }

      // Once we have a real user, force-refresh the ID token ONCE so any
      // newly-granted admin claim shows up without requiring sign-out.
      if (user && !refreshedOnce) {
        refreshedOnce = true;
        try {
          const refreshed = await authService.refreshAdminClaim();
          if (refreshed) useAuthStore.getState().setUser(refreshed);
        } catch (err) {
          console.warn('[auth] refreshAdminClaim failed:', err);
        }

        // PR 38 — role-arrival sign-in events. Fire once per app
        // session AFTER the claim refresh above so the role flags
        // reflect server truth (otherwise a freshly-promoted shop
        // owner would log as 'customer' until the next launch).
        // Anonymous users + plain customers get no event — Firebase
        // Analytics' built-in `first_open` covers them.
        const s = useAuthStore.getState();
        if (s.isAdmin) {
          Analytics.admin_signed_in();
        } else if (s.isShopOwner && s.shopId) {
          Analytics.shop_signed_in({ shop_id: s.shopId });
        } else if (s.isDelivery) {
          Analytics.delivery_signed_in();
        }
      }

      // PR 45 — Register for push notifications once we have an authed
      // user. The callable requires request.auth, so we can't run this
      // earlier. Idempotent on the server (arrayUnion dedupes); the
      // local gate prevents permission-prompt spam by short-circuiting
      // after a successful register.
      //
      // The orchestrator (`runPushRegistration`) owns the retry-aware
      // gate logic — extracted into a pure helper so the
      // "failure leaves the gate open" semantics are unit-testable
      // without rendering React or mocking expo-notifications. The
      // closure-gate regression that broke build 17 is now caught by
      // `tests/services/pushRegistrationOrchestrator.test.ts`.
      // PR 45.2 — breadcrumb (NOT captureMessage; cleanup OTA
      // stripped the diagnostic probe now that the uid-aware
      // gate is confirmed working on-device). Payload carries
      // the uid-aware decision inputs so any future push-related
      // Sentry issue captures WHICH uid we acted on.
      Sentry.addBreadcrumb({
        category: 'push',
        message: 'bootstrap: reached push branch',
        data: {
          currentUidPrefix: user?.uid.slice(0, 8) ?? null,
          isAnonymous: user?.isAnonymous ?? false,
          lastRegisteredUidPrefix: lastRegisteredUid?.slice(0, 8) ?? null,
        },
      });
      // PR 45.2 — orchestrator is now uid-aware. We pass the user's
      // uid + isAnonymous + the cached lastRegisteredUid; the
      // orchestrator decides whether to skip (anonymous /
      // already-this-uid) or to fire the registration. We update
      // `lastRegisteredUid` ONLY on a `registered` outcome, so
      // `skipped` / `failed` correctly leave the gate open for
      // later anonymous→real upgrades or account switches.
      //
      // Note: we do NOT gate on `if (user)` here — the orchestrator
      // returns null for `currentUid: null` and we just no-op on
      // that. This keeps all the gate logic in one tested place.
      runPushRegistration({
        currentUid: user?.uid ?? null,
        isAnonymous: user?.isAnonymous ?? false,
        lastRegisteredUid,
        registerForPush: () => pushService.registerForPushNotifications(),
        logger: {
          breadcrumb: (message: string) =>
            Sentry.addBreadcrumb({ category: 'push', message }),
          captureException: (err: unknown) =>
            Sentry.captureException(err, {
              tags: { push_stage: 'bootstrap_register' },
            }),
        },
      })
        .then((outcome: PushRegistrationOutcome) => {
          if (outcome?.kind === 'registered') {
            // Track WHO, not just "done". Account switches and
            // anonymous→real upgrades will see a different uid here
            // and correctly fall through the short-circuit on the
            // next auth event.
            lastRegisteredUid = outcome.uid;
          }
          // skipped / failed / null → leave lastRegisteredUid
          // unchanged so the next qualifying auth event retries.
        })
        // silent-catch-audit:allow — orchestrator's contract is "never
        // throws" (its inner try/catch turns errors into `failed` outcomes).
        // This .catch is a defensive net so a future regression can't bubble
        // an unhandled rejection out of bootstrap.
        .catch(() => {});
    });

    const timer = setTimeout(() => {
      if (!useAuthStore.getState().uid) {
        authService.signInAnonymouslyIfNeeded().catch(err => {
          console.warn('[auth] anonymous sign-in failed:', err?.code || err);
        });
      }
    }, 200);

    fetchLocation();

    // Tap-to-open hook. PR 41 extends the original PR 16 handler
    // (which only logged orderId) to deeplink admin push taps to
    // the right detail screen. Uses the existing in-callable
    // pushToAdmins payload shapes:
    //   - { shopId, type: 'shop_pending_approval' }
    //       → ShopRegistrationDetail({ shopId })
    //   - { uid, type: 'delivery_request_pending' }
    //       → DeliveryRequestDetail({ uid })
    // Anything else (order_status, new_order_for_shop, refund_*)
    // falls through to the legacy log-only branch.
    //
    // Non-admin callers (someone reinstalled and signed in as a
    // different account, or admin claim was revoked) don't get
    // routed to the admin stack — the admin screens themselves
    // gate on `isAdmin` and render an "Admin only" empty state,
    // so the worst-case UX is a flash of that screen rather than
    // a crash.
    // HOTFIX-5 — extracted from the inline
    // `addNotificationResponseReceivedListener` callback so the SAME
    // routing table can be invoked from both the listener (warm-tap
    // path) and the cold-start dispatch below
    // (`getLastNotificationResponseAsync`). Behavior is identical to
    // the pre-HOTFIX inline arrow — every branch, return, and
    // `safeNavigate` call is preserved verbatim.
    //
    // Stays INSIDE useEffect so it keeps lexical access to the
    // closure (no captured state today, but if a future PR adds
    // any, the extraction stays drop-in). Reads
    // `useAuthStore.getState()` at call time so role precedence
    // reflects current claims at the tap moment, not at mount.
    const handleNotificationResponse = (
      response: Notifications.NotificationResponse,
    ) => {
      const data = response.notification.request.content.data as
        | Record<string, unknown>
        | undefined;
      const type =
        typeof data?.type === 'string' ? (data.type as string) : undefined;

      if (type === 'shop_pending_approval') {
          const shopId =
            typeof data?.shopId === 'string'
              ? (data.shopId as string)
              : undefined;
          if (shopId) {
            Analytics.admin_pending_notification_tapped({
              type: 'shop_pending_approval',
              target_id: shopId,
            });
            safeNavigate('ShopRegistrationDetail', { shopId });
          }
          return;
        }

        if (type === 'delivery_request_pending') {
          const uid =
            typeof data?.uid === 'string' ? (data.uid as string) : undefined;
          if (uid) {
            Analytics.admin_pending_notification_tapped({
              type: 'delivery_request_pending',
              target_id: uid,
            });
            safeNavigate('DeliveryRequestDetail', { uid });
          }
          return;
        }

        // PR-NEXT-1 §E (finding #3) — order-related deep-links.
        // Pre-PR every order push tap landed on Home — fine with
        // 2 orders, painful with 20. Now we route to the audience-
        // appropriate detail screen.
        //
        // Audience is derived from current claims at the moment
        // of the tap (NOT from a field on the push data — admins
        // can have multiple claims and a hardcoded audience would
        // mis-route their personal customer orders). Source-of-
        // truth: `useAuthStore`. The role flags are set by the
        // claim refresh higher up in this same effect, so by the
        // time a tap arrives they reflect server truth.
        //
        // Push-type → screen table (kept in sync with the
        // server-side payload type names in `markPickedUp`,
        // `markDelivered`, `sendOrderStatusPush`,
        // `sendNewOrderPushToShop`, `sendNewPickupPushToDelivery`):
        //
        //   new_order_for_shop      → ShopOrderDetail (shopkeeper)
        //   new_pickup_for_delivery → DeliveryOrderDetail (delivery)
        //   order_cancelled         → audience-aware
        //   order_delivered         → audience-aware
        //   order_picked_up         → OrderDetail (customer; this
        //                             push is only sent to customer)
        //   order_status (legacy)   → OrderDetail (customer; the
        //                             generic trigger push)
        const orderId =
          typeof data?.orderId === 'string'
            ? (data.orderId as string)
            : undefined;
        if (!orderId) {
          // Push has no `data.orderId` and didn't match any of the
          // admin-routed types above — nothing to deep-link to.
          return;
        }

        const auth = useAuthStore.getState();
        // Role precedence for ambiguous types (cancelled /
        // delivered / generic): shopOwner > delivery > admin >
        // customer. A shop-owner-AND-customer who taps a
        // cancellation push for an order from THEIR OWN shop
        // wants the shop view. Their personal customer orders
        // get the same `order_status`-typed push and would route
        // through the customer branch via the same precedence
        // — `data.shopId` would be missing or different. We
        // approximate "this push is about my shop" by presence
        // of `data.shopId === auth.shopId`.
        const pushShopId =
          typeof data?.shopId === 'string'
            ? (data.shopId as string)
            : undefined;

        if (type === 'new_order_for_shop') {
          // Always shopkeeper-targeted — emitted only to the
          // shop owner.
          safeNavigate('ShopOrderDetail', { orderId });
          return;
        }
        if (type === 'new_pickup_for_delivery') {
          safeNavigate('DeliveryOrderDetail', { orderId });
          return;
        }
        // PR-NEXT-PARTNER-HEADS-UP — DO NOT REMOVE. Fires when a shop
        // accepts an order. Partner taps → lands on DeliveryDashboard
        // where the "Coming up" section shows this order. We don't
        // navigate to OrderDetail because the order isn't claimable yet;
        // dashboard context is more useful.
        if (type === 'pickup_heads_up') {
          if (auth.isDelivery) {
            safeNavigate('DeliveryDashboard');
          }
          return;
        }
        if (type === 'order_picked_up') {
          // PR-NEXT-1 emitted only to customer.
          // PR-NEXT-NOTIFY-EXTEND (Case 7) also emits to shop
          // owner + admin. Audience precedence: shopOwner-of-this-
          // shop > admin > customer (mirrors `order_cancelled` /
          // `order_delivered`).
          if (auth.isShopOwner && pushShopId && pushShopId === auth.shopId) {
            safeNavigate('ShopOrderDetail', { orderId });
            return;
          }
          if (auth.isAdmin) {
            safeNavigate('AdminOrders');
            return;
          }
          safeNavigate('OrderDetail', { orderId });
          return;
        }
        // PR-NEXT-NOTIFY-EXTEND (Case 5) — partner-assigned push.
        // Audience: shop owner + admin. Customer doesn't receive
        // this type — they get the parallel `order_partner_accepted`
        // push from PR-NEXT-13a, routed below in its own branch.
        if (type === 'order_partner_assigned') {
          if (auth.isShopOwner && pushShopId && pushShopId === auth.shopId) {
            safeNavigate('ShopOrderDetail', { orderId });
            return;
          }
          if (auth.isAdmin) {
            safeNavigate('AdminOrders');
            return;
          }
          // Defensive — if a non-shop-owner / non-admin somehow
          // received this push (token still registered against an
          // older role), don't fall through to a misleading
          // customer screen.
          return;
        }
        // PR-NEXT-13a — partner-claim push. Only ever sent to the
        // customer (`claimDelivery` emits `pushToUser(customerUid)`
        // after the atomic claim transaction). Same single-target
        // posture as `order_picked_up` — no audience precedence
        // needed because the server doesn't fan this push out to
        // shop owners / admins / partners. Type name pinned in three
        // places: here, the server emit in
        // `functions/src/index.ts::claimDelivery`, and the
        // acceptance checklist in
        // `docs/pr-next-13a-partner-accept-push-windsurf-prompt.md`.
        // Keep all three in sync.
        if (type === 'order_partner_accepted') {
          safeNavigate('OrderDetail', { orderId });
          return;
        }
        // PR-NEXT-3 §I — COD-conversion fan-out push from
        // `confirmPayment`. Audience-aware routing mirrors
        // `order_cancelled` / `order_delivered`. The customer
        // never gets this push (they initiated the conversion);
        // for delivery partner we route to `DeliveryOrderDetail`
        // rather than the customer order detail so the partner
        // lands on the screen that has the "Delivered" CTA.
        if (type === 'order_cod_converted') {
          if (auth.isShopOwner && pushShopId && pushShopId === auth.shopId) {
            safeNavigate('ShopOrderDetail', { orderId });
            return;
          }
          if (auth.isAdmin) {
            safeNavigate('AdminOrders');
            return;
          }
          if (auth.isDelivery) {
            safeNavigate('DeliveryOrderDetail', { orderId });
            return;
          }
          // Fallback (shouldn't be reached — server doesn't push
          // cod_converted to the customer who triggered it).
          safeNavigate('OrderDetail', { orderId });
          return;
        }
        // PR-NEXT-REVIEW-SYSTEM §G — DO NOT REMOVE. Customer correction flow.
        // review_responded → RatingAmendmentScreen (customer only)
        if (type === 'review_responded') {
          const ratingIdParam = data?.ratingId ?? '';
          const orderIdParam = data?.orderId ?? orderId ?? '';
          if (ratingIdParam && orderIdParam) {
            safeNavigate('RatingAmendment', {
              ratingId: ratingIdParam,
              orderId: orderIdParam,
            });
          }
          return;
        }
        // PR-NEXT-LOW-RATING-PUSH §E — DO NOT REMOVE. Fan-out routing.
        // low_rating_for_shop  → shop owner sees the specific order
        // low_rating_for_partner → delivery partner sees the order
        // low_rating_for_admin   → admin sees AdminOrders (or order detail)
        if (type === 'low_rating_for_shop') {
          if (auth.isShopOwner && orderId) {
            safeNavigate('ShopOrderDetail', { orderId });
          }
          return;
        }
        if (type === 'low_rating_for_partner') {
          if (auth.isDelivery && orderId) {
            safeNavigate('DeliveryOrderDetail', { orderId });
          }
          return;
        }
        if (type === 'low_rating_for_admin') {
          if (auth.isAdmin) {
            safeNavigate('AdminOrders');
          }
          return;
        }
        if (type === 'order_cancelled' || type === 'order_delivered') {
          if (auth.isShopOwner && pushShopId && pushShopId === auth.shopId) {
            safeNavigate('ShopOrderDetail', { orderId });
            return;
          }
          if (auth.isAdmin) {
            safeNavigate('AdminOrders');
            return;
          }
          safeNavigate('OrderDetail', { orderId });
          return;
        }
        // Generic / legacy `order_status` push from
        // `sendOrderStatusPush` — customer-only payload shape.
        // Same audience precedence in case a shop owner ever
        // receives it (they shouldn't, but defensive).
        if (auth.isShopOwner && pushShopId && pushShopId === auth.shopId) {
          safeNavigate('ShopOrderDetail', { orderId });
          return;
        }
        safeNavigate('OrderDetail', { orderId });
    };

    // HOTFIX-5 — warm-tap path. Same behavior as pre-HOTFIX; the
    // listener still only fires for taps registered AFTER it
    // attaches (i.e. taps that happen while the JS bundle is
    // running), so cold-start taps are NOT delivered here.
    const tapSub = Notifications.addNotificationResponseReceivedListener(
      handleNotificationResponse,
    );

    // HOTFIX-5 (Case 2 + every other cold-start deep-link)
    // ─────────────────────────────────────────────────────
    // `addNotificationResponseReceivedListener` only fires for taps
    // that occur AFTER registration — cold-start taps (app fully
    // closed when the push arrived, user taps to launch) are
    // consumed by Expo internally before this useEffect ever runs.
    // The launching response is available via
    // `getLastNotificationResponseAsync()`; without this call,
    // every cold-start tap silently lands on Home regardless of
    // the deep-link target. Affects shopkeeper new-order, customer
    // delivered, admin pending-approval, delivery-partner pickup —
    // every push type the handler above routes.
    //
    // Returns null when the app wasn't opened via a tap (normal
    // foreground launch / push received while running), so this is
    // a no-op for non-tap launches. The `coldStartDispatched` flag
    // is belt-and-braces against the rare case where Expo returns
    // a stale-from-earlier response on a non-tap warm boot on
    // specific Android OEMs — catches any double-dispatch path
    // without changing happy-path semantics.
    //
    // Race-guard: even with the response in hand, dispatching
    // immediately is unsafe because (1) `navigationRef.isReady()`
    // is false until the NavigationContainer mounts a few frames
    // later, causing `safeNavigate` to warn-and-drop, and (2)
    // audience-mapped types (`order_status`, `order_delivered`,
    // `order_cancelled`, `order_cod_converted`) read
    // `useAuthStore.getState()` for role precedence, which is
    // `ready=false` until the auth subscription fires. We poll
    // every 100ms for both flags, with a 10s safety ceiling so a
    // stuck launch can't leak an interval.
    let coldStartDispatched = false;
    let coldStartTimer: ReturnType<typeof setTimeout> | null = null;
    Notifications.getLastNotificationResponseAsync()
      .then(response => {
        if (!response || coldStartDispatched) return;

        const startedAt = Date.now();
        const TIMEOUT_MS = 10_000;
        const POLL_MS = 100;

        const tryDispatch = () => {
          if (coldStartDispatched) return;
          const auth = useAuthStore.getState();
          if (navigationRef.isReady() && auth.ready) {
            coldStartDispatched = true;
            handleNotificationResponse(response);
            return;
          }
          if (Date.now() - startedAt > TIMEOUT_MS) {
            // Safety net — don't poll forever. If we couldn't
            // dispatch within 10s the app is in some unusual state
            // (locked SIM, anonymous auth thrash, navigator never
            // mounting). Log so a future Sentry hook can surface a
            // recurring failure pattern.
            console.warn(
              '[AuthBootstrap] cold-start deep-link timed out waiting for nav+auth ready',
              {
                type:
                  typeof response.notification.request.content.data?.type ===
                  'string'
                    ? (response.notification.request.content.data
                        .type as string)
                    : undefined,
              },
            );
            return;
          }
          coldStartTimer = setTimeout(tryDispatch, POLL_MS);
        };
        tryDispatch();
      })
      .catch(err => {
        // Defensive — getLastNotificationResponseAsync shouldn't
        // throw, but if it ever does we don't want to take down the
        // auth bootstrap.
        console.warn('[AuthBootstrap] getLastNotificationResponseAsync failed:', err);
      });

    return () => {
      clearTimeout(timer);
      if (coldStartTimer) clearTimeout(coldStartTimer);
      // Mark dispatched so any in-flight `tryDispatch` chain
      // self-aborts on its next tick if the component unmounts
      // before the navigator becomes ready.
      coldStartDispatched = true;
      unsubscribe();
      tapSub.remove();
    };
  }, [fetchLocation]);

  return null;
}
