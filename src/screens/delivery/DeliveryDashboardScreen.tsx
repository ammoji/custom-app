import { useFocusEffect, useNavigation } from '@react-navigation/native';
// PR-NEXT-6 (finding #13) — DO NOT REMOVE. Used by the
// `handleAddDeliveryProof` flow below for the success haptic on
// upload-complete. Auto-formatter risk per code-discipline.
import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    FlatList,
    Pressable,
    StyleSheet,
    Switch,
    Text,
    TextInput,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Button from '../../components/common/Button';
import EmptyState from '../../components/common/EmptyState';
import Loader from '../../components/common/Loader';
import ScreenHeader from '../../components/common/ScreenHeader';
import { colors, radii, shadow, spacing, typography } from '../../constants/theme';
// PR 3 — concurrency cleanup. authService.refreshClaims used by the
// role-revocation UX path; helpers below race-guard rollbacks and
// detect revoked claims. NOTE: auto-formatter has stripped these
// imports twice during this PR — if you save and tsc complains
// about Cannot find name 'handleRoleAuthError' / 'authService' /
// 'shouldRollbackOptimistic', re-add this block.
import { Analytics } from '../../services/analytics';
import { authService } from '../../services/authService';
import { locationService } from '../../services/locationService';
import { orderService } from '../../services/orderService';
// PR-NEXT-5 (finding #7) — DO NOT REMOVE. Sentry breadcrumbs +
// captureMessage on the dashboard's polling-watcher outage gate.
// The auto-formatter has stripped service imports from this file
// before (see the comment block above `authService` below); if tsc
// complains "Cannot find name 'Sentry'", re-add this import.
import { Sentry } from '../../services/sentry';
import { useAuthStore } from '../../store/useAuthStore';
import type { GeoPoint, Order } from '../../types';
// PR 49 — nearest-first sort + per-card ride distance. Pure helper
// so the routing math is unit-tested without booting React Native.
import {
    rideLegsForOrder,
    sortPickupsByProximity,
} from '../../utils/deliveryRoutingHelpers';
// PR-NEXT-BUNDLE-D §E — DO NOT REMOVE. Chip-filter + coming-up
// priority sort helpers (pure, unit-pinned). Auto-formatter strip
// risk — this comment is the canary.
import {
    sortComingUpByPriority,
    sortPickups,
    type PickupSortMode,
} from '../../utils/deliverySortHelpers';
// PR-NEXT-BUNDLE-I §B — DO NOT REMOVE. Top-of-dashboard card grid.
import DashboardCardGrid from '../../components/dashboard/DashboardCardGrid';
// PR-NEXT-BUNDLE-I §A — DO NOT REMOVE. Pure helper for card view model.
import { deriveDeliveryDashboardCards } from '../../utils/deliveryDashboardViewModel';
// PR-NEXT-BUNDLE-I §D — DO NOT REMOVE. AttentionReviewRow type from
// orderService (mirrors the callable's return shape).
import type { AttentionReviewRow } from '../../services/orderService';
import {
    formatOrderTime,
    formatRelativeDeliveryTime,
    formatRupees,
    isToday,
} from '../../utils/format';
import { handleRoleAuthError } from '../../utils/handleRoleAuthError';
import { pickAndResizeImage } from '../../utils/imageUpload';
import { shouldRollbackOptimistic } from '../../utils/optimisticRollback';
// PR-NEXT-6 (finding #13) — DO NOT REMOVE. Used by
// `handleAddDeliveryProof` below to orchestrate the get-url → PUT →
// record-confirm flow. Real correctness lives in the server-side
// helper tests; this client-side helper is a thin glue.
import { uploadDeliveryProof } from '../../utils/uploadDeliveryProof';
// PR-NEXT-5 (finding #7) — temporal dampening helper for the
// dashboard's two polling watchers. Pure / unit-tested in
// `tests/utils/pollFailureGate.test.ts`.
import {
    applyPollOutcome,
    POLL_FAILURE_THRESHOLD,
} from '../../utils/pollFailureGate';

/**
 * DeliveryDashboardScreen — Phase 12b.
 *
 * Layout:
 *   [Online/Offline switch]
 *   [Today stats: completed | active]
 *   [Available pickups section]   (poll 15s, 'Accept' optimistic)
 *   [My active deliveries section] (poll 10s, picked-up / delivered actions)
 *
 * No new state-machine entries. We branch on:
 *   pickedUpAt == null   →  next action is "I've picked it up"
 *   pickedUpAt != null   →  next action is "Delivered"
 *
 * The online toggle writes users/{uid}.deliveryStatus via setDeliveryStatus.
 * That doc is what the sendNewPickupPushToDelivery trigger queries to
 * decide who gets the new-pickup push.
 */
export default function DeliveryDashboardScreen() {
  const nav = useNavigation<any>();
  const isDelivery = useAuthStore(s => s.isDelivery);
  // PR 3 — concurrency cleanup (item 4). Used to push refreshed
  // claims into useAuthStore when a watcher hands back permission-
  // denied (admin revoked delivery role mid-session). NOTE:
  // auto-formatter has stripped this declaration once already; if
  // tsc complains "Cannot find name 'setUser'", re-add it.
  const setUser = useAuthStore(s => s.setUser);

  const [available, setAvailable] = useState<Order[]>([]);
  const [mine, setMine] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState(false);
  const [togglingOnline, setTogglingOnline] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  // PR-NEXT-6 (finding #13) — delivery proof photo state. Per-order
  // upload-in-flight flag so the photo button on a single card can
  // show a spinner without freezing the rest of the dashboard. The
  // recently-uploaded path map lets the just-uploaded card show
  // "Photo added" immediately rather than waiting for the next
  // watcher tick to bring `deliveryProofStoragePath` back from the
  // order doc.
  const [photoUploading, setPhotoUploading] = useState<string | null>(null);
  const [recentlyUploadedProof, setRecentlyUploadedProof] = useState<
    Record<string, string>
  >({});
  const [showAvailable, setShowAvailable] = useState(true);
  // PR 12 — "heads up" pool (accepted/preparing) shown above the
  // claimable section so partners can plan ahead. Defaults open
  // because the whole point of the feature is early visibility.
  const [showHeadsUp, setShowHeadsUp] = useState(true);
  const [showMine, setShowMine] = useState(true);
  // Delivery History defaults collapsed — it's reference data, not
  // action data. The partner shouldn't have to scroll past it to
  // reach the live action lists above.
  const [showHistory, setShowHistory] = useState(false);
  // PR-NEXT-BUNDLE-I §C — DO NOT REMOVE. Attention queue state must be
  // declared here (above early returns) per code-discipline Rule 2.
  const [attentionOrders, setAttentionOrders] = useState<AttentionReviewRow[]>([]);
  const [attentionLoading, setAttentionLoading] = useState(false);
  // HOTFIX-SILENT-CATCH-GUARD — DO NOT REMOVE. Error state so a failed
  // attention fetch (missing callable / building index / IAM denial)
  // surfaces instead of looking like "count = 0" (Sudhir 2026-06-10).
  const [attentionError, setAttentionError] = useState<string | null>(null);
  const [showAttention, setShowAttention] = useState(true);
  const [retryNonce, setRetryNonce] = useState(0);
  // PR 49 — partner's foreground GPS, captured on dashboard focus
  // (best-effort; permission-denial / GPS-timeout leaves this null
  // and the sort silently falls back to time order). Sits with the
  // other useState declarations ABOVE the conditional early returns
  // (code-discipline Rule 2).
  const [partnerLoc, setPartnerLoc] = useState<GeoPoint | null>(null);

  // PR 50 — per-partner notification radius. Two fields: the
  // server-confirmed value (`notificationRadiusKm`, what the
  // push-fanout filter will use right now) and the in-flight input
  // (`radiusInput`, what the partner is currently typing). Save
  // button is enabled only when the input is dirty AND parses to
  // a valid integer. Hardcoded default `3` is kept in sync with
  // `DEFAULT_PARTNER_NOTIFICATION_RADIUS_KM` in
  // `functions/src/notificationRadiusHelpers.ts` — see the helper's
  // header doc. If you bump one, grep for the constant name.
  const [notificationRadiusKm, setNotificationRadiusKm] = useState<number>(3);
  const [radiusInput, setRadiusInput] = useState<string>('3');
  const [savingRadius, setSavingRadius] = useState(false);
  const [radiusError, setRadiusError] = useState<string | null>(null);
  // PR-NEXT-BUNDLE-D §E#3 — per-section sort chip state. The
  // low-rating alert settings that used to live here moved to the
  // dedicated DeliverySettingsScreen tab (§C / §G cleanup).
  const [availableSort, setAvailableSort] =
    useState<PickupSortMode>('distance');

  // Subscribe to the two pollers. Both fire immediately on mount and
  // then every 10/15s respectively. The "loading" flag flips once
  // EITHER list's first callback arrives — success OR failure — so a
  // failed first poll on either watcher can never leave the loader
  // spinning forever.
  useEffect(() => {
    if (!isDelivery) {
      setLoading(false);
      return;
    }
    let firstSeen = false;
    // PR-NEXT-5 (finding #7) — replace the simple `Error | null` flags
    // with per-watcher consecutive-failure counters. Pre-PR the
    // banner showed the INSTANT both watchers happened to error on
    // the same tick — Cloud Run cold start, brief Wi-Fi blip, iOS
    // TCP idle reap — and the partner saw flicker, flicker, flicker
    // even though there was no real outage to act on. Both counters
    // must reach `POLL_FAILURE_THRESHOLD` (default 3 → ~45s at the
    // slower 15s cadence) before the banner shows; a single success
    // on either watcher resets that watcher's counter.
    //
    // `outageCaptured` suppresses repeated `captureMessage` calls
    // while the banner is showing — Sentry hygiene per the
    // `pollFailureGate` helper's `justTripped` contract. The flag
    // is reset whenever the banner goes back to hidden so the NEXT
    // outage fires its own captureMessage cleanly.
    let availableCount = 0;
    let mineCount = 0;
    let outageCaptured = false;
    let latestErrorMessage: string | null = null;

    const reconcileError = () => {
      const availableTripped = availableCount >= POLL_FAILURE_THRESHOLD;
      const mineTripped = mineCount >= POLL_FAILURE_THRESHOLD;
      if (availableTripped && mineTripped) {
        setError(
          latestErrorMessage || 'Network connection lost. Tap Retry.',
        );
      } else {
        setError(null);
        // Banner hidden again — arm the captureMessage gate for the
        // next distinct outage event.
        outageCaptured = false;
      }
    };
    const maybeCaptureOutage = () => {
      const availableTripped = availableCount >= POLL_FAILURE_THRESHOLD;
      const mineTripped = mineCount >= POLL_FAILURE_THRESHOLD;
      if (availableTripped && mineTripped && !outageCaptured) {
        outageCaptured = true;
        Sentry.captureMessage(
          'Delivery dashboard outage: both watchers failed ' +
            `${POLL_FAILURE_THRESHOLD}+ times consecutively`,
          'warning',
        );
      }
    };
    const breadcrumbForFailure = (
      watcher: 'watchAvailableDeliveries' | 'watchMyDeliveries',
      err: Error,
      consecutiveFailures: number,
    ) => {
      Sentry.addBreadcrumb({
        category: 'delivery-dashboard',
        message: `${watcher} poll failed`,
        level: 'warning',
        data: {
          consecutiveFailures,
          errorMessage: err.message?.slice(0, 200) ?? null,
          // firebase-functions errors carry a string `code` (e.g.
          // 'unavailable', 'permission-denied'); surface it when
          // present so a captured event has the diagnostic axis.
          functionsCode:
            typeof (err as any)?.code === 'string'
              ? (err as any).code
              : null,
        },
      });
    };
    const markLoaded = () => {
      if (!firstSeen) {
        firstSeen = true;
        setLoading(false);
      }
    };
    const off1 = orderService.watchAvailableDeliveries((list, err) => {
      if (err) {
        const update = applyPollOutcome({
          currentCount: availableCount,
          outcome: 'failure',
        });
        availableCount = update.nextCount;
        latestErrorMessage = err.message || latestErrorMessage;
        setAvailable([]);
        // PR 3 — best-effort claim refresh on permission-denied.
        // No-op for unrelated errors. Fire-and-forget; the role-guard
        // render branch will pick up the cleared claim on next render.
        void handleRoleAuthError(err, authService.refreshClaims, setUser);
        breadcrumbForFailure('watchAvailableDeliveries', err, availableCount);
      } else {
        const update = applyPollOutcome({
          currentCount: availableCount,
          outcome: 'success',
        });
        availableCount = update.nextCount;
        setAvailable(list);
      }
      reconcileError();
      markLoaded();
      maybeCaptureOutage();
    });
    const off2 = orderService.watchMyDeliveries((list, err) => {
      if (err) {
        const update = applyPollOutcome({
          currentCount: mineCount,
          outcome: 'failure',
        });
        mineCount = update.nextCount;
        latestErrorMessage = err.message || latestErrorMessage;
        setMine([]);
        void handleRoleAuthError(err, authService.refreshClaims, setUser);
        breadcrumbForFailure('watchMyDeliveries', err, mineCount);
      } else {
        const update = applyPollOutcome({
          currentCount: mineCount,
          outcome: 'success',
        });
        mineCount = update.nextCount;
        setMine(list);
      }
      reconcileError();
      markLoaded();
      maybeCaptureOutage();
    });
    return () => {
      off1();
      off2();
    };
  }, [isDelivery, retryNonce]);

  // PR-NEXT-BUNDLE-I §C — DO NOT REMOVE. Fetch the partner's attention
  // queue (flagged_low orders) once on mount and on retryNonce bump (so
  // pull-to-refresh + Retry also refresh the attention section).
  useEffect(() => {
    if (!isDelivery) return;
    let cancelled = false;
    setAttentionLoading(true);
    orderService
      .listMyAttentionReviews()
      .then(rows => { if (!cancelled) { setAttentionOrders(rows); setAttentionError(null); } })
      // HOTFIX-SILENT-CATCH-GUARD — DO NOT REMOVE. Report + surface.
      .catch(e => {
        if (cancelled) return;
        Sentry.captureException(e, { tags: { area: 'DeliveryDashboard.listMyAttentionReviews' } });
        setAttentionError(e?.message ?? 'Could not load reviews. Pull to refresh.');
      })
      .finally(() => { if (!cancelled) setAttentionLoading(false); });
    return () => { cancelled = true; };
  }, [isDelivery, retryNonce]);

  // PR 20.1 fix — bump retryNonce whenever the dashboard regains
  // focus. This addresses the "stale coming-soon card" issue: if
  // partner A is viewing the dashboard while partner B claims one
  // of the visible orders, partner A's list will go stale until
  // the next 15s poll. The user-facing symptom: partner A taps a
  // card → opens detail → "Already Taken" error → navigates back.
  // With this focus-triggered re-poll, navigating back triggers
  // a fresh fetch within ~1s, so the stale card disappears
  // immediately instead of lingering for up to 15s.
  //
  // No-op on initial mount (useEffect above already fetches on
  // mount; useFocusEffect also runs on mount but bumping
  // retryNonce just re-fires the same watcher with no extra cost).
  useFocusEffect(
    useCallback(() => {
      setRetryNonce(n => n + 1);
      // PR 49 — foreground-only location capture. Wrapped in
      // `locationService.getCurrentLocation` so we share PR 46's
      // permission UX (denial → 'fallback' source, never throws).
      // We DROP the fallback case here — reporting the mock pin
      // would pollute the partner's `currentLocation` doc and
      // mislead PR 50's push-radius filter. Permission denied or
      // GPS timeout: silently leave `partnerLoc` null; the sort
      // gracefully degrades and the cards skip the ride line.
      let cancelled = false;
      void (async () => {
        try {
          const result = await locationService.getCurrentLocation();
          if (cancelled || result.source === 'fallback') return;
          const loc: GeoPoint = {
            lat: result.location.lat,
            lng: result.location.lng,
          };
          setPartnerLoc(loc);
          // Persist for PR 50's push-fanout filter. Best-effort —
          // a failed write must NEVER break the dashboard.
          // silent-catch-audit:allow — best-effort telemetry write; the
          // nearest-first sort uses the live client GPS, not this value.
          orderService.reportDeliveryLocation(loc).catch(() => {});
        } catch {
          // swallow — location is an enhancement, not a requirement.
        }
      })();
      // PR 50 — pull authoritative server state for the Online
      // toggle + notification radius. Also incidentally fixes
      // finding #8 (Online toggle persistence across screen
      // navigations) by re-hydrating `online` on every focus.
      // Best-effort: a failed read leaves the local defaults in
      // place — the partner can still operate the dashboard.
      void (async () => {
        try {
          const settings = await orderService.getMyDeliverySettings();
          if (cancelled) return;
          setOnline(settings.deliveryStatus === 'online');
          setNotificationRadiusKm(settings.notificationRadiusKm);
          // Sync the input field too, but only when the partner
          // isn't mid-edit. `savingRadius` is the cheapest signal
          // we have for "user is actively interacting"; if they're
          // typing we leave their draft alone.
          setRadiusInput(prev =>
            prev === String(notificationRadiusKm)
              ? String(settings.notificationRadiusKm)
              : prev,
          );
          // PR-NEXT-BUNDLE-D §G — low-rating alert hydration moved to
          // DeliverySettingsScreen; the dashboard no longer reads it.
        } catch {
          // swallow — settings read is an enhancement, not a
          // requirement.
        }
      })();
      return () => {
        cancelled = true;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  const stats = useMemo(() => {
    let completedToday = 0;
    let active = 0;
    for (const o of mine) {
      if (o.status === 'delivered' && isToday(o.deliveredAt ?? 0)) {
        completedToday += 1;
      }
      if (o.status === 'ready_for_pickup') active += 1;
    }
    return { completedToday, active };
  }, [mine]);

  // Active deliveries = currently assigned and not yet delivered. We
  // intentionally hide already-delivered orders from the active list
  // so the screen doesn't accumulate cruft over the day.
  const activeMine = useMemo(
    () => mine.filter(o => o.status === 'ready_for_pickup'),
    [mine],
  );

  // PR 12 — the server `listAvailableDeliveries` callable now returns
  // the union of {accepted, preparing, ready_for_pickup} that nobody
  // has claimed yet. Split client-side:
  //   - headsUp (accepted | preparing) — NOT claimable yet; shown
  //     so partners can plan routes / batches before the shop
  //     signals "ready".
  //   - availableNow (ready_for_pickup) — the existing claim pool.
  // PR 49 — nearest-shop-first sort applied to BOTH pools after the
  // status partition. `partnerLoc === null` (no GPS yet) makes the
  // sort a stable no-op (every distance Infinity → original order
  // preserved), so a freshly-mounted dashboard reads the same as
  // pre-PR-49 until the location resolves a beat later.
  // PR-NEXT-BUNDLE-D §E#2 — coming-up pool sorts preparing-first
  // (closest to ready), then by readyByEstimate. We keep the
  // proximity sort as the input ordering so two preparing orders
  // with no ETA still cluster nearest-first.
  const headsUp = useMemo(
    () =>
      sortComingUpByPriority(
        sortPickupsByProximity(
          available.filter(
            o => o.status === 'accepted' || o.status === 'preparing',
          ),
          partnerLoc,
        ),
      ),
    [available, partnerLoc],
  );
  // PR-NEXT-BUNDLE-D §E#3 — available pool honors the chip sort.
  // 'distance' uses the existing haversine proximity sort (orders
  // carry shopLocation, not a stored distanceKm); 'pay' / 'age' use
  // the pure sortPickups helper.
  const availableNow = useMemo(() => {
    const filtered = available.filter(o => o.status === 'ready_for_pickup');
    return availableSort === 'distance'
      ? sortPickupsByProximity(filtered, partnerLoc)
      : sortPickups(filtered, availableSort);
  }, [available, partnerLoc, availableSort]);

  // Delivery History = orders this partner has delivered, newest
  // first. Data is already in scope via watchMyDeliveries (same
  // source the "Completed today" stat reads from).
  const deliveredMine = useMemo(
    () =>
      mine
        .filter(o => o.status === 'delivered')
        .sort((a, b) => (b.deliveredAt ?? 0) - (a.deliveredAt ?? 0)),
    [mine],
  );

  // PR-NEXT-BUNDLE-I §C — DO NOT REMOVE. Card grid view model.
  const dashboardCards = useMemo(
    () =>
      deriveDeliveryDashboardCards({
        activeCount: activeMine.length,
        availableCount: availableNow.length,
        comingUpCount: headsUp.length,
        historyCount: deliveredMine.length,
        attentionCount: attentionOrders.length,
      }),
    [activeMine.length, availableNow.length, headsUp.length, deliveredMine.length, attentionOrders.length],
  );

  // HOTFIX-RESPOND-OWNER-AND-CARD-NAV §G — DO NOT REMOVE. The attention
  // card navigates to the dedicated AttentionQueueScreen. Previously it
  // set showAttention(true), but showAttention initializes to true → a
  // React no-op → tapping the card did nothing visible. Other cards stay
  // as inline section-toggles for pilot.
  const handleCardTap = (cardId: string) => {
    if (cardId === 'attention') {
      nav.navigate('AttentionQueue', { role: 'delivery' });
      return;
    }
    if (cardId === 'active') setShowMine(true);
    else if (cardId === 'available') setShowAvailable(true);
    else if (cardId === 'coming') setShowHeadsUp(true);
    else if (cardId === 'history') setShowHistory(true);
  };

  const toggleOnline = async (next: boolean) => {
    setTogglingOnline(true);
    // Optimistic flip — rollback on failure so the switch reflects
    // server reality.
    setOnline(next);
    try {
      await orderService.setDeliveryStatus({
        status: next ? 'online' : 'offline',
      });
      // PR 38 — logged AFTER server confirms so a flapping
      // network doesn't double-count toggles. is_online reflects
      // the FINAL state (post-success), not the optimistic flip.
      Analytics.delivery_online_toggled({ is_online: next });
    } catch (e: any) {
      setOnline(!next);
      Alert.alert(
        'Could not update status',
        e?.message || 'Please try again.',
      );
    } finally {
      setTogglingOnline(false);
    }
  };

  // PR 50 — save the partner's chosen notification radius. Client
  // validation mirrors the server's strict 1–50 integer guard so
  // the most common typo (e.g. "5.5", "abc", "0", "100") fails fast
  // without a round-trip. Server still re-validates.
  const handleSaveRadius = async () => {
    const trimmed = radiusInput.trim();
    const parsed = Number(trimmed);
    if (
      trimmed === '' ||
      !Number.isFinite(parsed) ||
      !Number.isInteger(parsed) ||
      parsed < 1 ||
      parsed > 50
    ) {
      setRadiusError('Enter a whole number from 1 to 50 km.');
      return;
    }
    setRadiusError(null);
    setSavingRadius(true);
    try {
      const res = await orderService.updateMyDeliverySettings({
        notificationRadiusKm: parsed,
      });
      // Pin to the server-returned value (currently identical to
      // `parsed`, but defensive — leaves room for the server to
      // normalize later without a client change).
      setNotificationRadiusKm(res.notificationRadiusKm);
      setRadiusInput(String(res.notificationRadiusKm));
    } catch (e: any) {
      setRadiusError(e?.message || 'Could not save. Please try again.');
    } finally {
      setSavingRadius(false);
    }
  };

  // The inline Accept on AvailablePickupCard was removed in the
  // view-first-cards pass (Phase 12a-v2-iv-followup-view-first).
  // Claim now happens on DeliveryOrderDetailScreen, which owns the
  // claim race + revert via the useDeliveryOrderDetail hook. The
  // previous in-flight-claim state moved with it.

  const handlePickedUp = async (order: Order) => {
    setPendingAction(order.id);
    // PR 3 — concurrency cleanup (item 3b). Capture the OPTIMISTIC
    // pickedUpAt value so the rollback can verify the watcher
    // hasn't installed a different value while the API was in
    // flight. Without this guard, a 10s watcher tick that arrives
    // between markPickedUp() failing and the rollback firing gets
    // clobbered — worst case, undoing a real successful pickup
    // recorded by a parallel call from another device.
    const optimisticPickedUpAt = Date.now();
    setMine(prev =>
      prev.map(o =>
        o.id === order.id ? { ...o, pickedUpAt: optimisticPickedUpAt } : o,
      ),
    );
    try {
      await orderService.markPickedUp({ orderId: order.id });
      Analytics.delivery_picked_up({ order_id: order.id });
    } catch (e: any) {
      setMine(prev => {
        const current = prev.find(o => o.id === order.id);
        if (
          !current ||
          !shouldRollbackOptimistic(current.pickedUpAt, optimisticPickedUpAt)
        ) {
          console.warn(
            '[DeliveryDashboard] handlePickedUp rollback suppressed — watcher already updated',
          );
          return prev;
        }
        return prev.map(o =>
          o.id === order.id ? { ...o, pickedUpAt: null } : o,
        );
      });
      Alert.alert('Update failed', e?.message || 'Please try again.');
    } finally {
      setPendingAction(null);
    }
  };

  const handleDelivered = async (order: Order) => {
    setPendingAction(order.id);
    // PR 3 — concurrency cleanup (item 3c). Same guard pattern as
    // handlePickedUp. We compare the optimistic status — 'delivered'
    // — against current; if a watcher already moved the order to a
    // DIFFERENT status (cancelled by admin, for instance), the
    // rollback to 'ready_for_pickup' would be wrong.
    const optimisticDeliveredAt = Date.now();
    setMine(prev =>
      prev.map(o =>
        o.id === order.id
          ? {
              ...o,
              status: 'delivered',
              deliveredAt: optimisticDeliveredAt,
            }
          : o,
      ),
    );
    try {
      await orderService.markDelivered({ orderId: order.id });
      // PR 38 — minutes-since-pickup powers the delivery-time
      // distribution chart (future PR). Compute from the
      // optimistic pickedUpAt; if the watcher already updated it,
      // the server's deliveredAt is the source of truth elsewhere.
      const pickedUpAt = order.pickedUpAt ?? optimisticDeliveredAt;
      const minutesSincePickup = Math.max(
        0,
        Math.round((optimisticDeliveredAt - pickedUpAt) / 60_000),
      );
      Analytics.delivery_delivered({
        order_id: order.id,
        minutes_since_pickup: minutesSincePickup,
      });
    } catch (e: any) {
      setMine(prev => {
        const current = prev.find(o => o.id === order.id);
        if (
          !current ||
          !shouldRollbackOptimistic(current.status, 'delivered')
        ) {
          console.warn(
            '[DeliveryDashboard] handleDelivered rollback suppressed — watcher already updated to',
            current?.status,
          );
          return prev;
        }
        return prev.map(o =>
          o.id === order.id
            ? { ...o, status: 'ready_for_pickup', deliveredAt: null }
            : o,
        );
      });
      Alert.alert('Update failed', e?.message || 'Please try again.');
    } finally {
      setPendingAction(null);
    }
  };

  // PR-NEXT-3 §H (finding #12 Part B) — delivery-partner COD
  // confirmation. The "Delivered" CTA is replaced with two pills
  // (Cash / UPI) when the order is COD-unpaid; tapping a pill
  // calls `confirmCodPayment` which stamps paid + paidMethod +
  // paidAt. The watcher then refreshes the order; the next render
  // falls through to the existing Delivered button branch.
  //
  // Optimistic update mirrors the `handleDelivered` pattern:
  // flip local state to `paymentStatus: 'paid'` + `paidMethod`
  // immediately, roll back on server failure, suppress rollback
  // if a watcher tick already moved the order on. The server
  // returns `{ alreadyPaid: true }` when the customer's mid-flow
  // Part A conversion landed first — we treat that as success
  // (toast the friendly message and let the watcher update the
  // card to "Delivered" eligibility on the next tick).
  //
  // Hooks discipline: this handler lives at the parent screen
  // level (NOT inside `ActiveDeliveryCard`), consistent with the
  // existing `pendingAction` hoist + `handlePickedUp` /
  // `handleDelivered` pattern.
  const handleConfirmCodPayment = async (
    order: Order,
    paidMethod: 'cash' | 'online',
  ) => {
    setPendingAction(order.id);
    setMine(prev =>
      prev.map(o =>
        o.id === order.id
          ? {
              ...o,
              paymentStatus: 'paid',
              paidMethod,
            }
          : o,
      ),
    );
    try {
      const result = await orderService.confirmCodPayment({
        orderId: order.id,
        paidMethod,
      });
      if (result.alreadyPaid) {
        Alert.alert(
          'Customer paid online',
          'No cash to collect — the customer paid online while you were on the way.',
        );
      }
    } catch (e: any) {
      // Suppress rollback if a watcher tick already paid the
      // order (e.g. customer's Part A conversion landed between
      // our optimistic flip and the server response).
      setMine(prev => {
        const current = prev.find(o => o.id === order.id);
        if (!current || current.paymentStatus !== 'paid') {
          return prev;
        }
        return prev.map(o =>
          o.id === order.id ? { ...o, paymentStatus: 'not_required', paidMethod: undefined } : o,
        );
      });
      Alert.alert('Could not confirm payment', e?.message || 'Please try again.');
    } finally {
      setPendingAction(null);
    }
  };

  // PR-NEXT-6 (finding #13) — orchestrate the optional delivery
  // proof photo flow on an ACTIVE order card. Camera-only by
  // design (gallery would defeat the freshness premise — see
  // out-of-scope notes in the PR prompt). Failures alert + reset;
  // the button stays available so a re-try after a transient
  // network blip is one tap. NO precondition is added to the
  // Delivered CTA — partner can deliver with or without a photo.
  const handleAddDeliveryProof = async (order: Order) => {
    const picked = await pickAndResizeImage('camera');
    if (!picked.ok) {
      // 'cancelled' is the user backing out of the picker — silent.
      // 'permission-denied' / 'too-large' / 'unknown' surface the
      // helper's message verbatim so the partner knows whether to
      // retry or open Settings.
      if (picked.reason === 'cancelled') return;
      Alert.alert(
        'Photo not added',
        picked.message || 'Please try again.',
      );
      return;
    }
    setPhotoUploading(order.id);
    try {
      const { storagePath } = await uploadDeliveryProof({
        orderId: order.id,
        localUri: picked.uri,
      });
      // Track the just-uploaded path locally so the card flips to
      // "Photo added" without waiting for the watcher tick.
      setRecentlyUploadedProof(prev => ({ ...prev, [order.id]: storagePath }));
      // Light haptic confirmation — same posture as the new-order
      // arrival tick (PR 16). Best-effort; no rethrow on platforms
      // without haptics support.
      void Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      );
    } catch (e: any) {
      Alert.alert('Upload failed', e?.message || 'Please try again.');
    } finally {
      setPhotoUploading(null);
    }
  };

  if (!isDelivery) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="Delivery Dashboard" onBack={() => nav.goBack()} />
        <EmptyState
          title="Delivery role required"
          subtitle="Register as a delivery partner from the Home screen first."
        />
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="Delivery Dashboard" onBack={() => nav.goBack()} />
        <Loader fullScreen />
      </SafeAreaView>
    );
  }

  // We render everything inside ONE FlatList to keep the whole screen
  // scrollable. The header builds the static + active-deliveries
  // chunks, the FlatList itself owns the available-pickups list (which
  // is the most likely to grow long).
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="Delivery Dashboard" onBack={() => nav.goBack()} />
      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable
            onPress={() => setRetryNonce(n => n + 1)}
            style={styles.retryBtn}
            accessibilityRole="button"
            accessibilityLabel="Retry loading deliveries"
          >
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      )}
      <FlatList
        data={showAvailable ? availableNow : []}
        keyExtractor={o => `avail-${o.id}`}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
        ListHeaderComponent={
          <View>
            {/* PR-NEXT-BUNDLE-I §B+§C — card grid at top of dashboard.
                Counts are derived from existing watcher data + the new
                attention queue fetch. Tapping a card expands its section. */}
            <DashboardCardGrid
              cards={dashboardCards}
              onCardPress={handleCardTap}
            />

            {/* PR-NEXT-BUNDLE-I §C — Reviews & Ratings attention section.
                Only rendered when there are flagged_low orders awaiting
                this partner's response (or while loading). */}
            {(attentionOrders.length > 0 || attentionLoading || attentionError) && (
              <View>
                <SectionHeader
                  title="Reviews & Ratings"
                  expanded={showAttention}
                  onToggle={() => setShowAttention(s => !s)}
                  count={attentionOrders.length}
                />
                {showAttention && attentionLoading && (
                  <ActivityIndicator
                    style={{ marginVertical: spacing.md }}
                    color={colors.primary}
                  />
                )}
                {showAttention && !attentionLoading && attentionError && (
                  <Text style={{ color: colors.danger, marginVertical: spacing.sm }}>
                    {attentionError}
                  </Text>
                )}
                {showAttention &&
                  !attentionLoading &&
                  attentionOrders.map(row => (
                    <Pressable
                      key={row.orderId}
                      onPress={() =>
                        nav.navigate('DeliveryOrderDetail', { orderId: row.orderId })
                      }
                      style={({ pressed }) => [
                        styles.attentionRow,
                        pressed && { opacity: 0.8 },
                      ]}
                    >
                      <Text style={styles.attentionShop} numberOfLines={1}>
                        {row.shopName ?? 'Order'}
                      </Text>
                      <Text style={styles.attentionMeta}>
                        {'⭐ ' +
                          (row.deliveryRating != null
                            ? `${row.deliveryRating}★ delivery`
                            : 'No delivery rating')}
                        {row.deliveryComment ? ` — "${row.deliveryComment}"` : ''}
                      </Text>
                    </Pressable>
                  ))}
              </View>
            )}

            <View
              style={[
                styles.statusCard,
                online ? styles.statusOnline : styles.statusOffline,
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text
                  style={[
                    styles.statusLabel,
                    online ? styles.statusLabelOnline : styles.statusLabelOffline,
                  ]}
                >
                  {online ? "You're online" : "You're offline"}
                </Text>
                <Text style={styles.statusSub}>
                  {online
                    ? 'Receiving pickup notifications.'
                    : 'Toggle on to receive pickup notifications.'}
                </Text>
              </View>
              <Switch
                value={online}
                onValueChange={toggleOnline}
                disabled={togglingOnline}
                trackColor={{ false: '#ccc', true: colors.primary }}
              />
            </View>

            {/* PR 50 — per-partner notification-radius setting. Server
                filters the new-pickup push by haversine(partner,
                shop) <= radius. 1–50 km integer; server re-validates.
                Sits directly under the Online card because it's a
                presence/notification-related preference, not an
                action-list section. */}
            <View style={styles.settingsCard}>
              <Text style={styles.settingsLabel}>
                Notify me about pickups within
              </Text>
              <View style={styles.radiusRow}>
                <TextInput
                  value={radiusInput}
                  onChangeText={text => {
                    setRadiusInput(text);
                    if (radiusError) setRadiusError(null);
                  }}
                  keyboardType="number-pad"
                  maxLength={2}
                  editable={!savingRadius}
                  style={styles.radiusInput}
                  accessibilityLabel="Notification radius in kilometres"
                />
                <Text style={styles.radiusUnit}>km</Text>
                <Pressable
                  onPress={handleSaveRadius}
                  disabled={
                    savingRadius ||
                    radiusInput.trim() === String(notificationRadiusKm)
                  }
                  accessibilityRole="button"
                  accessibilityLabel="Save notification radius"
                  style={({ pressed }) => [
                    styles.radiusSaveBtn,
                    radiusInput.trim() !== String(notificationRadiusKm) &&
                      styles.radiusSaveBtnActive,
                    pressed && styles.radiusSaveBtnPressed,
                  ]}
                >
                  <Text style={styles.radiusSaveText}>
                    {savingRadius ? 'Saving…' : 'Save'}
                  </Text>
                </Pressable>
              </View>
              {radiusError ? (
                <Text style={styles.radiusError}>{radiusError}</Text>
              ) : (
                <Text style={styles.settingsHelp}>
                  Pickups farther than this won't push you. Range 1–50 km.
                </Text>
              )}
            </View>

            {/* PR-NEXT-BUNDLE-D §G — the LOW-RATING ALERTS card moved
                to the dedicated DeliverySettingsScreen tab. */}

            <View style={styles.statsCard}>
              <Text style={styles.statsTitle}>Today</Text>
              <View style={styles.statsRow}>
                <Stat
                  label="Completed"
                  value={String(stats.completedToday)}
                />
                <Stat
                  label="Active"
                  value={String(stats.active)}
                  emphasize={stats.active > 0}
                />
              </View>
            </View>

            {/* My Active Deliveries section. Inlined into the header
                because FlatList only renders one data type at a time
                and "available pickups" is the long list. */}
            <SectionHeader
              title="My Active Deliveries"
              expanded={showMine}
              onToggle={() => setShowMine(s => !s)}
              count={activeMine.length}
            />
            {showMine && activeMine.length === 0 && (
              <EmptyState
                title="No active deliveries"
                subtitle="Accept a pickup below to start delivering."
              />
            )}
            {showMine &&
              activeMine.map(o => (
                <View key={`mine-${o.id}`} style={{ marginBottom: spacing.md }}>
                  <ActiveDeliveryCard
                    order={o}
                    partnerLoc={partnerLoc}
                    pending={pendingAction === o.id}
                    onPickedUp={() => handlePickedUp(o)}
                    onDelivered={() => handleDelivered(o)}
                    onConfirmCodPayment={paidMethod =>
                      handleConfirmCodPayment(o, paidMethod)
                    }
                    // PR-NEXT-6 — proof photo is per-card. Parent
                    // owns the upload-in-flight + recently-uploaded
                    // state so a re-render of one card doesn't
                    // disrupt another's spinner / "Photo added"
                    // copy.
                    onAddPhoto={() => handleAddDeliveryProof(o)}
                    uploadingPhoto={photoUploading === o.id}
                    hasProof={
                      !!o.deliveryProofStoragePath ||
                      !!recentlyUploadedProof[o.id]
                    }
                    onPress={() =>
                      nav.navigate('DeliveryOrderDetail', { orderId: o.id })
                    }
                  />
                </View>
              ))}

            {/* Delivery History section — collapsed by default. The
                partner can expand to see today's / past completed
                runs. Data is already loaded via watchMyDeliveries. */}
            <SectionHeader
              title="Delivery History"
              expanded={showHistory}
              onToggle={() => setShowHistory(s => !s)}
              count={deliveredMine.length}
            />
            {showHistory && deliveredMine.length === 0 && (
              <EmptyState
                title="No completed deliveries yet"
                subtitle="Your delivered orders will appear here."
              />
            )}
            {showHistory &&
              deliveredMine.map(o => (
                <View
                  key={`hist-${o.id}`}
                  style={{ marginBottom: spacing.md }}
                >
                  <DeliveryHistoryCard
                    order={o}
                    onPress={() =>
                      nav.navigate('DeliveryOrderDetail', { orderId: o.id })
                    }
                    // PR-NEXT-13d — same handler + same per-order
                    // upload state as `ActiveDeliveryCard`; the
                    // server validator already permits post-
                    // delivered upload (no `deliveredAt` gate), so
                    // this is purely a presentation reuse.
                    onAddPhoto={() => handleAddDeliveryProof(o)}
                    uploadingPhoto={photoUploading === o.id}
                    hasProof={
                      !!o.deliveryProofStoragePath ||
                      !!recentlyUploadedProof[o.id]
                    }
                  />
                </View>
              ))}

            {/* PR 12 — Heads up section: accepted / preparing
                orders the shop hasn't yet flipped to
                ready_for_pickup. Visual treatment differs from
                Available Pickups (no "Tap to accept" hint, no
                claim affordance) so partners don't try to
                pre-commit. Tapping opens detail; the detail screen
                shows the pickup is not yet claimable. */}
            <SectionHeader
              title="Heads up — coming soon"
              expanded={showHeadsUp}
              onToggle={() => setShowHeadsUp(s => !s)}
              count={headsUp.length}
            />
            {showHeadsUp && headsUp.length === 0 && (
              <EmptyState
                title="No upcoming pickups"
                subtitle="Accepted / preparing orders will appear here so you can plan routes ahead."
              />
            )}
            {showHeadsUp &&
              headsUp.map(o => (
                <View key={`heads-${o.id}`} style={{ marginBottom: spacing.md }}>
                  <HeadsUpCard
                    order={o}
                    partnerLoc={partnerLoc}
                    onPress={() =>
                      nav.navigate('DeliveryOrderDetail', { orderId: o.id })
                    }
                  />
                </View>
              ))}

            <SectionHeader
              title="Available now"
              expanded={showAvailable}
              onToggle={() => setShowAvailable(s => !s)}
              count={availableNow.length}
            />
            {showAvailable && availableNow.length > 0 && (
              <SortChipRow value={availableSort} onChange={setAvailableSort} />
            )}
            {showAvailable && availableNow.length === 0 && (
              <EmptyState
                title="No pickups available"
                subtitle={
                  online
                    ? 'New pickups will appear here within ~15s.'
                    : 'Toggle online to start receiving pickups.'
                }
              />
            )}
          </View>
        }
        renderItem={({ item }) => (
          <AvailablePickupCard
            order={item}
            partnerLoc={partnerLoc}
            onPress={() =>
              nav.navigate('DeliveryOrderDetail', { orderId: item.id })
            }
          />
        )}
      />
    </SafeAreaView>
  );
}

function SectionHeader({
  title,
  expanded,
  onToggle,
  count,
}: {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  count: number;
}) {
  return (
    <Pressable
      onPress={onToggle}
      style={styles.sectionHeader}
      accessibilityRole="button"
      accessibilityLabel={`${expanded ? 'Collapse' : 'Expand'} ${title}`}
    >
      <Text style={styles.sectionTitle}>
        {title}
        {count > 0 ? `  (${count})` : ''}
      </Text>
      <Text style={styles.sectionChevron}>{expanded ? '▾' : '▸'}</Text>
    </Pressable>
  );
}

// PR-NEXT-BUNDLE-D §E#3 — sort chip row. Tapping a chip re-sorts the
// local array (no server round-trip). Defaults to 'distance'
// (Nearest), preserving the pre-bundle behavior.
const SORT_CHIPS: Array<{ value: PickupSortMode; label: string }> = [
  { value: 'distance', label: 'Nearest' },
  { value: 'pay', label: 'Highest pay' },
  { value: 'age', label: 'Newest' },
];

function SortChipRow({
  value,
  onChange,
}: {
  value: PickupSortMode;
  onChange: (v: PickupSortMode) => void;
}) {
  return (
    <View style={styles.chipRow}>
      {SORT_CHIPS.map(chip => {
        const active = value === chip.value;
        return (
          <Pressable
            key={chip.value}
            onPress={() => onChange(chip.value)}
            style={[styles.chip, active && styles.chipActive]}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`Sort by ${chip.label}`}
          >
            <Text style={[styles.chipText, active && styles.chipTextActive]}>
              {chip.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Stat({
  label,
  value,
  emphasize,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
}) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, emphasize && styles.statValueEmphasize]}>
        {value}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

/**
 * PR 12 — HeadsUpCard.
 *
 * Visually distinct from AvailablePickupCard so partners don't
 * mistake an accepted/preparing order (NOT claimable yet) for an
 * available-now pickup. Differences:
 *   - "Coming soon" pill instead of the implicit available state.
 *   - "Ready by HH:MM" line surfaces the shopkeeper's ETA so the
 *     partner can plan routes / batches.
 *   - "Tap to view items" hint (no mention of accept) — claim
 *     happens later, only on the Available now section.
 *
 * No optimistic claim here. Tapping opens DeliveryOrderDetail,
 * which shows the not-yet-claimable state cleanly.
 */
function HeadsUpCard({
  order,
  partnerLoc,
  onPress,
}: {
  order: Order;
  partnerLoc: GeoPoint | null;
  onPress: () => void;
}) {
  const itemCount = order.items.reduce((n, i) => n + i.quantity, 0);
  const stateLabel =
    order.status === 'preparing' ? 'Shop preparing' : 'Shop accepted';
  // PR 49 — ride distance + locked drop-location label.
  const legs = rideLegsForOrder(order, partnerLoc);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Upcoming pickup for ${order.shopName}`}
      style={({ pressed }) => [
        styles.card,
        styles.headsUpCard,
        pressed && styles.cardBodyPressed,
      ]}
    >
      <View style={styles.cardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.shopName} numberOfLines={1}>
            {order.shopName}
          </Text>
          <Text style={styles.headsUpState}>{stateLabel}</Text>
        </View>
        <Text style={styles.cardChevron}>›</Text>
      </View>
      {order.readyByEstimate ? (
        <Text style={styles.headsUpEta}>
          ⏰ Ready by {formatOrderTime(order.readyByEstimate)}
        </Text>
      ) : (
        <Text style={styles.headsUpEta}>
          ⏰ ETA not yet set by the shop
        </Text>
      )}
      <Text style={styles.address} numberOfLines={2}>
        Drop: {order.deliveryAddress.line1}
        {order.deliveryAddress.line2
          ? `, ${order.deliveryAddress.line2}`
          : ''}
        , {order.deliveryAddress.pincode}
      </Text>
      <RideDistanceLine legs={legs} />
      <DeliveryLocationLabel order={order} />
      <Text style={styles.meta}>
        {itemCount} item{itemCount > 1 ? 's' : ''} ·{' '}
        {formatRupees(order.total)}
      </Text>
      {/* PR-NEXT-BUNDLE-D §E#1 — earnings line on coming-up cards
          (mirrors AvailablePickupCard + ActiveDeliveryCard). */}
      {typeof order.deliveryFee === 'number' && order.deliveryFee > 0 && (
        <Text style={styles.earningsLine}>
          💰 Earn {formatRupees(order.deliveryFee)}
        </Text>
      )}
      <Text style={styles.tapHint}>Tap to view items</Text>
    </Pressable>
  );
}

function AvailablePickupCard({
  order,
  partnerLoc,
  onPress,
}: {
  order: Order;
  partnerLoc: GeoPoint | null;
  onPress: () => void;
}) {
  // View-first card: body is the only tap target. Accept lives
  // inside DeliveryOrderDetail so the partner has seen items +
  // exact drop address before committing. The previous inline
  // Accept button caused accidental commits in solo testing.
  const itemCount = order.items.reduce((n, i) => n + i.quantity, 0);
  // PR 49 — ride distance + locked drop-location label.
  const legs = rideLegsForOrder(order, partnerLoc);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open pickup details for ${order.shopName}`}
      style={({ pressed }) => [styles.card, pressed && styles.cardBodyPressed]}
    >
      <View style={styles.cardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.shopName} numberOfLines={1}>
            {order.shopName}
          </Text>
        </View>
        <Text style={styles.cardChevron}>›</Text>
      </View>
      <Text style={styles.address} numberOfLines={2}>
        Drop: {order.deliveryAddress.line1}
        {order.deliveryAddress.line2
          ? `, ${order.deliveryAddress.line2}`
          : ''}
        , {order.deliveryAddress.pincode}
      </Text>
      <RideDistanceLine legs={legs} />
      <DeliveryLocationLabel order={order} />
      {/* PR-NEXT-PARTNER-VIS (Case 4) — pre-claim earnings
          visibility. `order.deliveryFee` is stamped at placeOrder
          time from the distance-based tier (PR 47). Showing it
          here lets the partner accept based on a known
          compensation, not a guess. Guard hides the line on
          legacy / malformed orders rather than displaying ₹0. */}
      {typeof order.deliveryFee === 'number' && order.deliveryFee > 0 && (
        <Text style={styles.earningsLine}>
          💰 Earn {formatRupees(order.deliveryFee)}
        </Text>
      )}
      <Text style={styles.meta}>
        {itemCount} item{itemCount > 1 ? 's' : ''} ·{' '}
        {formatRupees(order.total)} · {formatOrderTime(order.createdAt)}
      </Text>
      <Text style={styles.tapHint}>Tap to view items & accept</Text>
    </Pressable>
  );
}

/**
 * PR 49 — per-card ride-distance line. Three render branches
 * matching the helper's tri-state output:
 *   - both legs known     → "🛵 ~X.X km ride · A to shop + B to drop"
 *   - only drop known     → "Drop ~B km from shop" (no partner GPS yet,
 *                            but PR 46 stamped the shop→customer leg).
 *   - neither known       → render nothing (legacy order, no
 *                            regression vs pre-PR-49 layout).
 */
function RideDistanceLine({ legs }: { legs: ReturnType<typeof rideLegsForOrder> }) {
  if (legs.totalKm != null && legs.toShopKm != null && legs.toCustomerKm != null) {
    return (
      <Text style={styles.rideLine}>
        🛵 ~{legs.totalKm.toFixed(1)} km ride · {legs.toShopKm.toFixed(1)} to shop
        + {legs.toCustomerKm.toFixed(1)} to drop
      </Text>
    );
  }
  if (legs.toCustomerKm != null) {
    return (
      <Text style={styles.rideLine}>
        Drop ~{legs.toCustomerKm.toFixed(1)} km from shop
      </Text>
    );
  }
  return null;
}

/**
 * PR 49 — surfaces the locked delivery-location label so the
 * partner can tell at a glance whether they're delivering to a
 * saved address ("Home", "Work") or a live pin ("Current location").
 * Falls back to nothing when absent (pre-PR-46 orders) so legacy
 * cards keep their original layout.
 */
function DeliveryLocationLabel({ order }: { order: Order }) {
  const label = order.deliveryLocation?.label;
  if (!label) return null;
  return <Text style={styles.locationLabel}>📍 {label}</Text>;
}

/**
 * Delivery History row — read-only summary of a delivered order.
 *
 * Customer phone is NOT shown (matches the privacy guard on
 * DeliveryOrderDetailScreen's available-for-claim state). The
 * partner already had the phone while assigned; once the order is
 * delivered we don't keep surfacing it on the dashboard.
 */
function DeliveryHistoryCard({
  order,
  onPress,
  // PR-NEXT-13d (finding #13 sub-(d) follow-up) — same photo-upload
  // props as `ActiveDeliveryCard`. Sudhir's HOTFIX-1 smoke testing
  // surfaced the gap: if the partner forgot to capture the proof
  // photo before hitting Delivered, the CTA disappeared with the
  // active card and there was no recovery path. The server validator
  // (post-HOTFIX-1) has no `deliveredAt` gate — only `pickedUpAt`
  // and assignee — so a partner can upload a missed proof any time
  // while still assigned to the order. Window is intentionally
  // unbounded for v1; revisit if pilot disputes show late-upload
  // abuse.
  onAddPhoto,
  uploadingPhoto,
  hasProof,
}: {
  order: Order;
  onPress: () => void;
  onAddPhoto: () => void;
  uploadingPhoto: boolean;
  hasProof: boolean;
}) {
  const when = formatRelativeDeliveryTime(order.deliveredAt ?? 0);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open delivered order for ${order.shopName}`}
      style={({ pressed }) => [styles.card, pressed && styles.cardBodyPressed]}
    >
      <View style={styles.cardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.shopName} numberOfLines={1}>
            {order.shopName}
          </Text>
          <Text style={styles.subStatus}>✅ Delivered · {when}</Text>
        </View>
        <Text style={styles.cardChevron}>›</Text>
      </View>
      <Text style={styles.address} numberOfLines={1}>
        {order.deliveryAddress.line1} · {order.deliveryAddress.pincode}
      </Text>
      <Text style={styles.meta}>{formatRupees(order.total)}</Text>

      {/* PR-NEXT-13d — photo CTA stays available post-delivery so
          the partner can correct a missed capture. Mirrors the
          `ActiveDeliveryCard` styling verbatim (same `photoBtn` /
          `photoBtnText` / `photoBtnDisabled` style tokens). The
          inner `Pressable`'s `e.stopPropagation()` prevents the tap
          from bubbling to the parent card's `onPress` (which would
          otherwise also navigate to the order detail). */}
      <View style={{ marginTop: spacing.sm }}>
        <Pressable
          onPress={e => {
            e.stopPropagation();
            onAddPhoto();
          }}
          disabled={uploadingPhoto}
          style={({ pressed }) => [
            styles.photoBtn,
            uploadingPhoto && styles.photoBtnDisabled,
            pressed && { opacity: 0.85 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={
            hasProof
              ? 'Replace delivery proof photo'
              : 'Add delivery proof photo (optional)'
          }
        >
          {uploadingPhoto ? (
            <ActivityIndicator size="small" color={colors.textPrimary} />
          ) : (
            <Text style={styles.photoBtnText}>
              {hasProof
                ? '📸 Photo added — re-take?'
                : '📸 Add delivery proof (optional)'}
            </Text>
          )}
        </Pressable>
      </View>
    </Pressable>
  );
}

function ActiveDeliveryCard({
  order,
  partnerLoc,
  pending,
  onPickedUp,
  onDelivered,
  onConfirmCodPayment,
  onAddPhoto,
  uploadingPhoto,
  hasProof,
  onPress,
}: {
  order: Order;
  partnerLoc: GeoPoint | null;
  pending: boolean;
  onPickedUp: () => void;
  onDelivered: () => void;
  // PR-NEXT-3 §H — emitted when the partner taps a Cash/UPI pill
  // on a COD-unpaid order. Parent handles the optimistic flip +
  // `confirmCodPayment` callable.
  onConfirmCodPayment: (paidMethod: 'cash' | 'online') => void;
  // PR-NEXT-6 (finding #13) — emitted when the partner taps the
  // proof photo button. Parent runs the
  // `pickAndResizeImage('camera')` → `uploadDeliveryProof` flow
  // and toggles `uploadingPhoto` for the duration.
  // PR-NEXT-BUNDLE-B §C (Finding #13) — proof is now REQUIRED.
  // `hasProof` gates the Delivered CTA — DO NOT REMOVE.
  onAddPhoto: () => void;
  uploadingPhoto: boolean;
  hasProof: boolean;
  onPress: () => void;
}) {
  const itemCount = order.items.reduce((n, i) => n + i.quantity, 0);
  const pickedUp = !!order.pickedUpAt;
  // PR-NEXT-3 §H — gate the COD confirmation selector on:
  //   - pickedUp (the partner is at / on the way to the customer)
  //   - paymentMethod === 'cod' AND paymentStatus !== 'paid'
  // Once `paymentStatus` flips to 'paid' (via Part A or Part B) the
  // card falls through to the standard Delivered button. Online
  // orders + COD-converted-via-payCodOrder orders never reach the
  // selector.
  const needsCodConfirmation =
    pickedUp &&
    order.paymentMethod === 'cod' &&
    order.paymentStatus !== 'paid';
  // PR 49 — surface the same ride-distance + locked-location label
  // on active-delivery cards so the partner sees the legs whether
  // they're staring at an unclaimed pickup or one in their queue.
  const legs = rideLegsForOrder(order, partnerLoc);
  return (
    <Pressable
      style={styles.card}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Delivery details for ${order.shopName}`}
    >
      <View style={styles.cardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.shopName} numberOfLines={1}>
            {order.shopName}
          </Text>
          {/* partner-status-audit:allow — ActiveDeliveryCard renders ONLY
              for in-flight deliveries; delivered/cancelled orders move to
              DeliveryHistoryCard ("✅ Delivered · …"), so this two-state
              label is never shown after handoff and cannot go stale. */}
          <Text style={styles.subStatus}>
            {pickedUp ? '🚚 On the way to customer' : '🏪 Pickup from shop'}
          </Text>
        </View>
      </View>
      <Text style={styles.address} numberOfLines={2}>
        {order.deliveryAddress.name} · 📞 {order.deliveryAddress.phone}
      </Text>
      <Text style={styles.address} numberOfLines={2}>
        {order.deliveryAddress.line1}
        {order.deliveryAddress.line2 ? `, ${order.deliveryAddress.line2}` : ''},{' '}
        {order.deliveryAddress.pincode}
      </Text>
      <RideDistanceLine legs={legs} />
      <DeliveryLocationLabel order={order} />
      {/* PR-NEXT-PARTNER-VIS (Case 4) — same earnings line as
          the available card. Reduces "wait, what was this?"
          thrash on multi-pickup days. */}
      {typeof order.deliveryFee === 'number' && order.deliveryFee > 0 && (
        <Text style={styles.earningsLine}>
          💰 Earn {formatRupees(order.deliveryFee)}
        </Text>
      )}
      <Text style={styles.meta}>
        {itemCount} item{itemCount > 1 ? 's' : ''} ·{' '}
        {formatRupees(order.total)}
      </Text>
      {pickedUp && (
        // PR-NEXT-6 (finding #13) — optional delivery proof photo
        // CTA. Sits ABOVE the Delivered / COD-pill row at lower
        // visual weight (slate-grey, single text line) so it reads
        // as "extra credit", not a primary action. Server gates on
        // `pickedUpAt` precondition, so we only show this branch
        // after pickup; before pickup the upload would be rejected
        // and the button would dead-end.
        <View style={{ marginTop: spacing.md }}>
          <Pressable
            onPress={onAddPhoto}
            disabled={uploadingPhoto}
            style={({ pressed }) => [
              styles.photoBtn,
              uploadingPhoto && styles.photoBtnDisabled,
              pressed && { opacity: 0.85 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={
              hasProof
                ? 'Replace delivery proof photo'
                : 'Add delivery proof photo (optional)'
            }
          >
            {uploadingPhoto ? (
              <ActivityIndicator size="small" color={colors.textPrimary} />
            ) : (
              <Text style={styles.photoBtnText}>
                {hasProof
                  ? '📸 Photo added — re-take?'
                  : '📸 Add delivery proof (optional)'}
              </Text>
            )}
          </Pressable>
        </View>
      )}
      <View style={{ marginTop: spacing.md }}>
        {needsCodConfirmation ? (
          // PR-NEXT-3 §H — COD payment selector. Cash and UPI both
          // result in `paymentStatus: 'paid'`; the difference is
          // recorded in `paidMethod` for accounting / dispute
          // resolution. UPI here means "partner accepted UPI
          // directly outside the app" (not a Razorpay flow).
          <View>
            <Text style={styles.codConfirmLabel}>
              Payment: Cash on Delivery — {formatRupees(order.total)}
            </Text>
            <Text style={styles.codConfirmSub}>
              Confirm payment received:
            </Text>
            <View style={styles.codPillRow}>
              <Pressable
                style={[
                  styles.codPill,
                  pending && styles.codPillDisabled,
                ]}
                onPress={() => onConfirmCodPayment('cash')}
                disabled={pending}
                accessibilityRole="button"
                accessibilityLabel="Mark cash received"
              >
                <Text style={styles.codPillText}>💵 Cash received</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.codPill,
                  pending && styles.codPillDisabled,
                ]}
                onPress={() => onConfirmCodPayment('online')}
                disabled={pending}
                accessibilityRole="button"
                accessibilityLabel="Mark UPI received"
              >
                <Text style={styles.codPillText}>📱 UPI received</Text>
              </Pressable>
            </View>
          </View>
        ) : pickedUp ? (
          // PR-NEXT-BUNDLE-B §C — DO NOT REMOVE. Proof required
          // before Delivered can be tapped. Inline hint above the
          // button directs the partner to upload first.
          <>
            {!hasProof && (
              <Text style={styles.proofHint}>
                📷 Upload delivery proof first
              </Text>
            )}
            <Button
              title="Delivered"
              onPress={onDelivered}
              loading={pending}
              disabled={pending || !hasProof}
            />
          </>
        ) : (
          <Button
            title="I've picked it up"
            onPress={onPickedUp}
            loading={pending}
            disabled={pending}
          />
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  list: { padding: spacing.lg, paddingBottom: spacing.xxl },
  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radii.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    borderWidth: 1,
  },
  statusOnline: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  statusOffline: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  statusLabel: { ...typography.h3 },
  statusLabelOnline: { color: colors.primaryDark },
  statusLabelOffline: { color: colors.textSecondary },
  statusSub: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  // PR 50 — notification-radius settings card. Visual parity with
  // `statsCard` (same surface + border) so it reads as a related
  // preference, not a primary action card.
  settingsCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  settingsLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  settingsHelp: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  radiusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  radiusInput: {
    ...typography.h3,
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minWidth: 64,
    textAlign: 'center',
    backgroundColor: colors.bg,
  },
  radiusUnit: {
    ...typography.body,
    color: colors.textSecondary,
  },
  radiusSaveBtn: {
    marginLeft: 'auto',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: colors.border,
  },
  radiusSaveBtnActive: { backgroundColor: colors.primary },
  radiusSaveBtnPressed: { opacity: 0.7 },
  radiusSaveText: {
    ...typography.bodyBold,
    color: colors.surface,
  },
  radiusError: {
    ...typography.caption,
    color: colors.danger,
    marginTop: spacing.xs,
  },
  statsCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statsTitle: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  // PR 49 — ride-distance + locked-location lines on pickup cards.
  // Slightly tighter color than `meta` so the eye picks them out
  // without screaming, and a tad more spacing above so they don't
  // crowd the address line.
  // PR-NEXT-PARTNER-VIS (Case 4) — pre-claim earnings line on
  // both `AvailablePickupCard` and `ActiveDeliveryCard`. Same
  // visual weight as `rideLine` (bold + primaryDark) so the
  // distance + earnings read as a paired headline.
  earningsLine: {
    ...typography.bodyBold,
    color: colors.primaryDark,
    marginTop: spacing.xs,
  },
  rideLine: {
    ...typography.bodyBold,
    color: colors.primaryDark,
    marginTop: spacing.xs,
  },
  locationLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  stat: { flex: 1 },
  statValue: { ...typography.h2 },
  statValueEmphasize: { color: colors.primaryDark },
  statLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  sectionTitle: { ...typography.bodyBold },
  sectionChevron: { ...typography.h3, color: colors.textSecondary },
  // PR-NEXT-BUNDLE-D §E#3 — sort chip row.
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  chip: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...typography.caption, color: colors.textSecondary },
  chipTextActive: { color: '#fff' },
  attentionRow: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  attentionShop: { ...typography.bodyBold },
  attentionMeta: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  card: {
    backgroundColor: colors.bg,
    borderRadius: radii.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.xs,
  },
  cardBodyPressed: { opacity: 0.7 },
  // PR 12 — heads-up card visual treatment. Soft yellow tint
  // distinguishes from the active blue/green Available cards so
  // partners don't mistake one for the other at a glance.
  headsUpCard: {
    backgroundColor: '#FEF9E7',
    borderColor: '#F4D03F',
  },
  headsUpState: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  headsUpEta: {
    ...typography.bodyBold,
    color: colors.primaryDark,
    marginTop: spacing.xs,
  },
  cardChevron: {
    ...typography.h2,
    color: colors.textSecondary,
    marginLeft: spacing.xs,
  },
  shopName: { ...typography.h3 },
  subStatus: {
    ...typography.caption,
    color: colors.primaryDark,
    fontWeight: '600',
    marginTop: 2,
  },
  address: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  meta: { ...typography.body, marginTop: spacing.sm },
  tapHint: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '600',
    marginTop: spacing.sm,
  },
  errorBanner: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    padding: spacing.md,
    backgroundColor: '#FEF2F2',
    borderColor: colors.danger,
    borderWidth: 1,
    borderRadius: radii.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  errorText: {
    ...typography.body,
    color: colors.danger,
    flex: 1,
    marginRight: spacing.md,
  },
  retryBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.danger,
    borderRadius: radii.sm,
  },
  retryText: { ...typography.bodyBold, color: '#fff' },
  // PR-NEXT-3 §H — COD payment selector on ActiveDeliveryCard.
  codConfirmLabel: {
    ...typography.bodyBold,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  codConfirmSub: {
    ...typography.caption,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  codPillRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  codPill: {
    flex: 1,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
  },
  codPillDisabled: {
    opacity: 0.5,
  },
  codPillText: {
    ...typography.bodyBold,
    color: colors.primary,
  },
  // PR-NEXT-6 (finding #13) — optional delivery proof photo CTA.
  // Lower visual weight than the Delivered button (slate-grey
  // surface, primary text colour) so it reads as "extra credit",
  // not a primary action. NO red error state — failures alert and
  // reset; the button stays available for re-tap.
  photoBtn: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  photoBtnDisabled: {
    opacity: 0.6,
  },
  photoBtnText: {
    ...typography.body,
    color: colors.textPrimary,
  },
  // PR-NEXT-BUNDLE-B §C — DO NOT REMOVE. Shown above the disabled
  // Delivered button when no proof photo has been uploaded yet.
  proofHint: {
    ...typography.caption,
    color: colors.warning ?? colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  // PR-NEXT-LOW-RATING-PUSH §D
  ratingRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  starBtn: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  starBtnActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  starBtnText: {
    ...typography.body,
    color: colors.textSecondary,
  },
  starBtnTextActive: {
    color: colors.primaryDark,
    fontWeight: '700',
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginVertical: spacing.xs,
  },
  alertCheckbox: {
    width: 22,
    height: 22,
    borderRadius: radii.sm,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  alertCheckboxChecked: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  alertCheckMark: {
    color: colors.bg,
    fontWeight: '700',
    fontSize: 14,
  },
  radiusSaveBtnText: {
    ...typography.bodyBold,
    color: colors.bg,
  },
});
