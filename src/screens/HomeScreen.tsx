import { useFocusEffect, useNavigation } from '@react-navigation/native';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Button from '../components/common/Button';
import QuickSwitchModal from '../components/dev/QuickSwitchModal';
// PR-NEXT-BUNDLE-F — DO NOT REMOVE. Compact banner + strip replace
// the old big "Active orders" + "Order again" cards.
import ActiveOrderBanner from '../components/home/ActiveOrderBanner';
import RecentShopsStrip from '../components/home/RecentShopsStrip';
import ReorderModal from '../components/order/ReorderModal';
import { APP_NAME } from '../constants/branding';
import { CATEGORIES } from '../constants/categories';
import { TEST_ACCOUNTS } from '../constants/testAccounts';
// 2026-06-02 — DO NOT REMOVE. Used by the HomeScreen greeting to
// surface "Hello, <name> 👋" so testers (and real users) see at a
// glance which account is signed in. Falls back to the test-account
// label when profile.name is unset — useful during multi-role testing.
import { colors, radii, spacing, typography } from '../constants/theme';
import { usePendingCounts } from '../hooks/usePendingCounts';
import { Analytics } from '../services/analytics';
import { orderService } from '../services/orderService';
import { useAuthStore } from '../store/useAuthStore';
import { useCartStore } from '../store/useCartStore';
import { useLocationStore } from '../store/useLocationStore';
import { useProfileStore } from '../store/useProfileStore';
import type { Order, Shop } from '../types';
import { buildReorderPlan, planToCartItems, ReorderPlan } from '../utils/buildReorderPlan';
import { formatRupees } from '../utils/format';
import { FrequentShopEntry, pickFrequentlyOrderedShops } from '../utils/pickFrequentlyOrderedShops';
import { pickActiveOrders } from '../utils/pickActiveOrders';

export default function HomeScreen() {
  const nav = useNavigation<any>();
  // PR-NEXT-2 (finding #1) — Android gesture-nav bar overlaps the
  // floating cart bar at the bottom. `spacing.lg` happens to clear
  // iOS's home indicator (~34dp) but not Android's 48dp gesture
  // pills. Hook must sit with the other hooks (Rule 2).
  const insets = useSafeAreaInsets();
  const itemCount = useCartStore(s => s.itemCount());
  const total = useCartStore(s => s.total());
  const uid = useAuthStore(s => s.uid);
  const isAnonymous = useAuthStore(s => s.isAnonymous);
  const isAdmin = useAuthStore(s => s.isAdmin);
  const isShopOwner = useAuthStore(s => s.isShopOwner);
  const isDelivery = useAuthStore(s => s.isDelivery);
  // PR 18 — phoneNumber drives Quick Switch visibility. Reading
  // it as a top-level store subscription so the screen re-renders
  // when a switch completes (the modal calls setUser, which flips
  // phoneNumber alongside the role flags).
  const phoneNumber = useAuthStore(s => s.phoneNumber);
  const source = useLocationStore(s => s.source);

  // Phase 12a-v2-i. If the user has a shop in flight (registered but
  // not yet approved, or rejected), surface a "Awaiting approval"
  // tile so they can re-open the WaitingForApproval screen without
  // hunting through nav. We refetch on focus so a freshly-rejected
  // shop appears as soon as the user returns to Home.
  const [pendingShop, setPendingShop] = useState<Shop | null>(null);

  // PR 14 — "Order again" rail + reorder modal state.
  //
  // ⚠️ Rules of Hooks: ALL useState calls in this screen MUST stay
  // ABOVE any conditional early returns. PR 12's ETA-modal hotfix
  // was caused by a useState declared after an `if (loading) return`
  // — React requires the same hook call order on every render and
  // crashed the screen on first data load. PR 13 added the same
  // guard comment to OrdersScreen. HomeScreen has no early returns
  // today but enshrining the discipline here prevents a future
  // refactor from quietly reintroducing the bug.
  //
  // `recentOrders` caches the listMine() payload so the reorder
  // tap can find the source order in-memory instead of issuing a
  // second network round-trip (the recommended optimisation from
  // pr-14-...windsurf-prompt.md § Part 5).
  const [recentOrders, setRecentOrders] = useState<Order[]>([]);
  const [frequentShops, setFrequentShops] = useState<FrequentShopEntry[]>([]);
  const [reorderModalVisible, setReorderModalVisible] = useState(false);
  const [reorderLoading, setReorderLoading] = useState(false);
  const [reorderPlan, setReorderPlan] = useState<ReorderPlan | null>(null);
  const [reorderShopMeta, setReorderShopMeta] = useState<{
    id: string;
    name: string;
    deliveryFee: number;
  } | null>(null);

  // PR 17 — ETA ticker. Bumps `nowMs` once per minute so the
  // ActiveOrdersRail's "Arriving in ~X min" copy decrements
  // visibly while the user lingers on Home. Without this, the
  // copy stays stale until the next focus-effect refetch.
  //
  // Lineage: lives with the PR 14 hooks-discipline block above
  // (Rules-of-Hooks — the PR 12 ETA-modal hotfix bug). Adding
  // this useState below the function's later code branches
  // would silently regress the same crash on first data load,
  // so keep ALL state at the top.
  const [nowMs, setNowMs] = useState(() => Date.now());

  // PR 18 — Quick Switch modal visibility. Lives with the rest of
  // the hoisted state per the Rules-of-Hooks discipline (PR 12 ETA
  // modal hotfix lineage — reinforced in PR 13 / 14 / 15 / 17).
  // Adding this useState below any conditional branch in this
  // function would silently regress the same crash on first data
  // load.
  const [quickSwitchVisible, setQuickSwitchVisible] = useState(false);

  // PR 41 — pending-approval counts for HomeScreen badges. Enabled
  // for admin OR shop owner; plain customers skip the poll entirely
  // (hook returns all-zero without calling the server). MUST sit
  // above any conditional return — same Rules-of-Hooks discipline
  // as the state above (PR 12 ETA-modal lineage).
  const pendingCounts = usePendingCounts(isAdmin || isShopOwner);

  // PR 18 — visibility gate for the Quick Switch button. True iff
  // the currently signed-in user's E.164 phone matches one of the
  // configured test accounts. Deliberately NOT gated on `isAdmin`:
  // every test phone (admin AND non-admin) is in TEST_ACCOUNTS, so
  // the button stays visible after switching to a customer-role
  // test account, letting you switch back. A real customer's phone
  // wouldn't be in the list, so they never see the button —
  // automatic production safety without per-role gating.
  //
  // 2026-06-02 — TEST_ACCOUNTS.phone is now full E.164 (was 10-digit
  // pre-PR). The hardcoded `+91` prefix is gone so US (+1) test
  // accounts are recognised correctly. See testAccounts.ts.
  const isTestAccount = phoneNumber
    ? TEST_ACCOUNTS.some(a => a.phone === phoneNumber)
    : false;

  // PR 19 — total favorite count across all shops. Drives both the
  // tile visibility (count > 0) and the badge text. Subscribing
  // here (rather than at the JSX site) means the tile recomputes
  // exactly when the favorites map mutates and not on unrelated
  // profile edits like address-book changes.
  const favoritesCount = useProfileStore(s => {
    const fav = s.profile?.favorites;
    if (!fav) return 0;
    let n = 0;
    for (const ids of Object.values(fav)) n += ids.length;
    return n;
  });

  // 2026-06-02 — greeting personalization. Resolution order:
  //   1. profile.name (real customers / shop owners who completed
  //      profile) → first name only ("Hello, Sudhir 👋" reads cleaner
  //      than "Hello, Sudhir Davim 👋" at h1 size).
  //   2. Test-account label match (e.g. "Customer 1 (India)") so
  //      multi-role testing surfaces which account is signed in
  //      directly on Home — same disambiguation as the Quick Switch
  //      picker, no extra tap needed.
  //   3. Null → falls back to plain "Hello 👋" (anonymous bootstrap,
  //      profile still loading, or signed-in user with no name set).
  //
  // Above the conditional return at line ~165 per Rule 2.
  const profileName = useProfileStore(s => s.profile?.name ?? null);
  const greetingName = (() => {
    if (typeof profileName === 'string' && profileName.trim().length > 0) {
      return profileName.trim().split(/\s+/)[0];
    }
    if (phoneNumber) {
      const match = TEST_ACCOUNTS.find(a => a.phone === phoneNumber);
      if (match) return match.label;
    }
    return null;
  })();

  useEffect(() => {
    // 60s cadence — matches the granularity of the "~N min"
    // rounding, so we don't waste wakeups on sub-minute ticks
    // that wouldn't change the rendered string. Cleanup is
    // essential: a leaked interval would keep firing after
    // HomeScreen unmounts (e.g. on sign-out).
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  useFocusEffect(
    useCallback(() => {
      if (isAnonymous || isShopOwner) {
        setPendingShop(null);
        return;
      }
      let cancelled = false;
      orderService
        .getShopForOwner()
        .then(shop => {
          if (cancelled) return;
          // Active is handled by the isShopOwner branch (claim is set
          // by approveShop). We only show this tile for in-flight or
          // rejected registrations.
          if (shop && shop.status !== 'active') {
            setPendingShop(shop);
          } else {
            setPendingShop(null);
          }
        })
        .catch(err => {
          // Best-effort — failing to fetch shouldn't block Home.
          console.warn('[Home] getShopForOwner failed:', err);
        });
      return () => {
        cancelled = true;
      };
    }, [isAnonymous, isShopOwner]),
  );

  // PR 14 — fetch order history on focus. Mirrors the existing
  // pendingShop focus effect's cancel-token pattern. Skipped for
  // anonymous users (no UID = no orders to fetch) and for shop
  // owners (their listMine returns empty for the customer scope
  // anyway, but skipping saves a needless callable round-trip).
  useFocusEffect(
    useCallback(() => {
      if (!uid || isAnonymous) {
        setRecentOrders([]);
        setFrequentShops([]);
        return;
      }
      let cancelled = false;
      orderService
        .listMine(uid)
        .then(orders => {
          if (cancelled) return;
          setRecentOrders(orders);
          setFrequentShops(pickFrequentlyOrderedShops(orders, 3));
        })
        .catch(err => {
          if (cancelled) return;
          // Best-effort — a failed fetch shouldn't block Home or
          // erase a previously-loaded rail. Just log and move on;
          // the rail will refresh on next focus.
          console.warn('[Home] listMine failed:', err);
        });
      return () => {
        cancelled = true;
      };
    }, [uid, isAnonymous]),
  );

  // PR 14 — reorder tap handler. Reuses the cached past order from
  // recentOrders (no second network call) and fetches the shop's
  // current menu via listShopMenuPublic — same primitive PR 13's
  // OrdersScreen flow uses. Failure modes:
  //   - Source order not found in cache → stale state, surface a
  //     gentle Alert and bail.
  //   - Shop suspended / removed → listShopMenuPublic 404s, we map
  //     that to a customer-facing "may no longer be available".
  const onOrderAgainTap = useCallback(
    async (entry: FrequentShopEntry) => {
      setReorderModalVisible(true);
      setReorderLoading(true);
      setReorderPlan(null);
      setReorderShopMeta(null);
      try {
        const pastOrder = recentOrders.find(o => o.id === entry.lastOrderId);
        if (!pastOrder) {
          throw new Error('Past order no longer in cache.');
        }
        const { shop, items: menu } =
          await orderService.listShopMenuPublic(entry.shopId);
        const plan = buildReorderPlan(pastOrder, menu);
        setReorderPlan(plan);
        setReorderShopMeta({
          id: shop.id,
          name: shop.name,
          deliveryFee: shop.deliveryFee,
        });
      } catch (e: any) {
        console.warn('[Home] reorder fetch failed:', e);
        setReorderModalVisible(false);
        Alert.alert(
          'Reorder unavailable',
          e?.code === 'functions/not-found' || e?.code === 'not-found'
            ? 'This shop may no longer be available. Try a different shop.'
            : 'Could not load this shop right now. Please try again.',
        );
      } finally {
        setReorderLoading(false);
      }
    },
    [recentOrders],
  );

  const onConfirmReorder = useCallback(() => {
    if (!reorderPlan || !reorderShopMeta) return;
    const cartItems = planToCartItems(reorderPlan);
    if (cartItems.length === 0) return; // CTA is disabled in this case
    // getState() (not the hook subscriber) so this screen doesn't
    // re-render mid-swap. Same posture as OrdersScreen.
    useCartStore.getState().replaceCartWithItems(cartItems, reorderShopMeta);
    setReorderModalVisible(false);
    setReorderPlan(null);
    setReorderShopMeta(null);
    nav.navigate('Cart');
  }, [reorderPlan, reorderShopMeta, nav]);

  const onCancelReorder = useCallback(() => {
    setReorderModalVisible(false);
    setReorderPlan(null);
    setReorderShopMeta(null);
  }, []);

  // PR 15 — active orders derived from the same listMine cache PR
  // 14 already populates for the Order Again rail. No additional
  // fetch. useMemo so the active rail only re-renders when the
  // underlying order list actually changes (new placement, status
  // tick, or focus refetch).
  const activeOrders = useMemo(
    () => pickActiveOrders(recentOrders),
    [recentOrders],
  );

  // A user has a "non-customer role" when they wear at least one extra
  // hat. We use this to decide whether to render the "Your Roles"
  // section header.
  const hasAnyExtraRole = isAdmin || isShopOwner || isDelivery;
  const locationLabel =
    source === 'gps'
      ? 'Deliver to your location'
      : 'Deliver to Green Park, Delhi (default)';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          // Add the safe-area inset so the last list item is
          // reachable above both the cart bar and the system nav
          // pills. Always added (a few harmless extra pixels when
          // the cart bar is hidden).
          { paddingBottom: 120 + insets.bottom },
        ]}
      >
        <Text style={[styles.greeting, { paddingHorizontal: spacing.lg }]} numberOfLines={1}>
          {greetingName ? `Hello, ${greetingName} 👋` : 'Hello 👋'}
        </Text>
        <Text style={[styles.location, { paddingHorizontal: spacing.lg }]}>{locationLabel}</Text>
        {source === 'fallback' && (
          <View style={styles.fallbackBanner}>
            <Text style={styles.fallbackText}>
              📍 Using default location. Enable location to find shops near you.
            </Text>
          </View>
        )}

        <Pressable
          onPress={() => nav.navigate('Search')}
          style={[styles.searchBox, { marginHorizontal: spacing.lg }]}
          accessibilityRole="button"
          accessibilityLabel="Search for products"
        >
          <Text style={styles.searchPlaceholder}>🔍  Search for atta, milk, soap...</Text>
        </Pressable>

        {/* PR-NEXT-BUNDLE-F §B — compact active-order banner replaces
            the old big "Active orders" rail. Self-hides when empty.
            Single order → OrderDetail; multiple → Orders list. */}
        <ActiveOrderBanner
          orders={activeOrders}
          nowMs={nowMs}
          onPressSingle={orderId => nav.navigate('OrderDetail', { orderId })}
          onPressMultiple={() => nav.navigate('Orders')}
        />

        {/* PR-NEXT-BUNDLE-F §C — recent shops horizontal strip replaces
            the old big "Order again" card. Tap re-opens the reorder
            flow (same FrequentShopEntry source). Self-hides when empty. */}
        {frequentShops.length > 0 && (
          <View style={styles.recentShopsSection}>
            <Text style={[styles.sectionTitle, { paddingHorizontal: spacing.lg, marginBottom: spacing.xs }]}>
              Recent shops
            </Text>
            <RecentShopsStrip
              shops={frequentShops}
              onPress={shopId => {
                const entry = frequentShops.find(f => f.shopId === shopId);
                if (entry) onOrderAgainTap(entry);
              }}
            />
          </View>
        )}

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipsScroll}
          contentContainerStyle={styles.chipsContent}
        >
          {CATEGORIES.map(cat => (
            <Pressable
              key={cat.id}
              style={styles.chip}
              onPress={() => nav.navigate('Search', { category: cat.id })}
              accessibilityRole="button"
              accessibilityLabel={`Search in ${cat.label}`}
            >
              <Text style={styles.chipText}>{cat.label}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <View style={styles.heroCard}>
          <Text style={styles.heroTitle}>Fresh kirana groceries</Text>
          <Text style={styles.heroSubtitle}>From local shops within 1 km of you</Text>
          <View style={{ marginTop: spacing.md }}>
            <Button title="Browse shops near me" onPress={() => nav.navigate('ShopList')} />
          </View>
        </View>

        <Pressable
          style={styles.ordersRow}
          onPress={() => nav.navigate('Orders')}
          accessibilityRole="button"
          accessibilityLabel="My Orders"
        >
          <Text style={styles.ordersText}>📦  My Orders</Text>
          <Text style={styles.ordersChevron}>›</Text>
        </Pressable>

        {/* Phase 12a-v2-iv: Profile entry-point. Hidden for anonymous
            users — they have nothing to manage yet (no profile doc,
            no saved addresses). The "Sign in with phone" row below
            covers that case. Once signed in, the Profile row replaces
            the sign-in row and gives access to name/email/addresses
            + Sign Out.
            Also require `uid` to be present — between signOut and
            the AuthBootstrap-triggered anon re-auth, isAnonymous is
            false AND uid is null. Without the uid check this row
            would briefly render in that limbo state and tapping it
            would hit getMyProfile with no auth. */}
        {!isAnonymous && uid && (
          <Pressable
            style={styles.ordersRow}
            onPress={() => nav.navigate('Profile')}
            accessibilityRole="button"
            accessibilityLabel="Profile"
          >
            <Text style={styles.ordersText}>👤  Profile</Text>
            <Text style={styles.ordersChevron}>›</Text>
          </Pressable>
        )}

        {isAnonymous && (
          <Pressable
            style={styles.signInRow}
            onPress={() => nav.navigate('Login')}
            accessibilityRole="button"
            accessibilityLabel="Sign in with phone"
          >
            <Text style={styles.signInText}>📱  Sign in with phone</Text>
            <Text style={styles.signInChevron}>›</Text>
          </Pressable>
        )}

        {hasAnyExtraRole && (
          <>
            <Text style={[styles.sectionTitle, { paddingHorizontal: spacing.lg }]}>
              Your Roles
            </Text>
            {isShopOwner && (
              <Pressable
                style={styles.roleRow}
                onPress={() => {
                  // PR 41 — badge-tap funnel signal. Fire only when
                  // the badge currently shows a non-zero count so we
                  // can distinguish "admin opened on schedule" from
                  // "badge actually prompted action".
                  if (pendingCounts.pendingOrderCount > 0) {
                    Analytics.admin_pending_badge_tapped({
                      kind: 'shop_owner_orders',
                      count: pendingCounts.pendingOrderCount,
                    });
                  }
                  nav.navigate('ShopOwnerDashboard');
                }}
                accessibilityRole="button"
                accessibilityLabel={
                  pendingCounts.pendingOrderCount > 0
                    ? `Shop Dashboard, ${pendingCounts.pendingOrderCount} orders need attention`
                    : 'Shop Dashboard'
                }
              >
                <Text style={styles.roleText}>🛍️  Shop Dashboard</Text>
                <View style={styles.roleTrailing}>
                  {pendingCounts.pendingOrderCount > 0 && (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>
                        {formatBadgeCount(pendingCounts.pendingOrderCount)}
                      </Text>
                    </View>
                  )}
                  <Text style={styles.roleChevron}>›</Text>
                </View>
              </Pressable>
            )}
            {isDelivery && (
              <Pressable
                style={styles.roleRow}
                onPress={() => nav.navigate('DeliveryDashboard')}
                accessibilityRole="button"
                accessibilityLabel="Delivery Dashboard"
              >
                <Text style={styles.roleText}>🚚  Delivery Dashboard</Text>
                <Text style={styles.roleChevron}>›</Text>
              </Pressable>
            )}
            {isAdmin && (
              <Pressable
                style={styles.adminRow}
                onPress={() => nav.navigate('AdminOrders')}
                accessibilityRole="button"
                accessibilityLabel="Admin Dashboard"
              >
                <Text style={styles.adminText}>🛠️  Admin Dashboard</Text>
                <Text style={styles.adminChevron}>›</Text>
              </Pressable>
            )}
            {isAdmin && (
              <Pressable
                style={styles.adminRow}
                onPress={() => {
                  if (pendingCounts.shopCount > 0) {
                    Analytics.admin_pending_badge_tapped({
                      kind: 'shop',
                      count: pendingCounts.shopCount,
                    });
                  }
                  nav.navigate('PendingShops');
                }}
                accessibilityRole="button"
                accessibilityLabel={
                  pendingCounts.shopCount > 0
                    ? `Pending Shop Approvals, ${pendingCounts.shopCount} waiting`
                    : 'Pending Shop Approvals'
                }
              >
                <Text style={styles.adminText}>📋  Pending Shop Approvals</Text>
                <View style={styles.adminTrailing}>
                  {pendingCounts.shopCount > 0 && (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>
                        {formatBadgeCount(pendingCounts.shopCount)}
                      </Text>
                    </View>
                  )}
                  <Text style={styles.adminChevron}>›</Text>
                </View>
              </Pressable>
            )}
            {isAdmin && (
              <Pressable
                style={styles.adminRow}
                onPress={() => {
                  if (pendingCounts.deliveryCount > 0) {
                    Analytics.admin_pending_badge_tapped({
                      kind: 'delivery',
                      count: pendingCounts.deliveryCount,
                    });
                  }
                  nav.navigate('PendingDeliveryRequests');
                }}
                accessibilityRole="button"
                accessibilityLabel={
                  pendingCounts.deliveryCount > 0
                    ? `Delivery partner requests, ${pendingCounts.deliveryCount} waiting`
                    : 'Delivery partner requests'
                }
              >
                <Text style={styles.adminText}>🛵  Delivery requests</Text>
                <View style={styles.adminTrailing}>
                  {pendingCounts.deliveryCount > 0 && (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>
                        {formatBadgeCount(pendingCounts.deliveryCount)}
                      </Text>
                    </View>
                  )}
                  <Text style={styles.adminChevron}>›</Text>
                </View>
              </Pressable>
            )}
            {isAdmin && (
              <Pressable
                style={styles.adminRow}
                onPress={() => nav.navigate('UserManagement')}
                accessibilityRole="button"
                accessibilityLabel="User Management"
              >
                <Text style={styles.adminText}>👥  User Management</Text>
                <Text style={styles.adminChevron}>›</Text>
              </Pressable>
            )}
            {isAdmin && (
              <Pressable
                style={styles.adminRow}
                onPress={() => nav.navigate('ShopManagement')}
                accessibilityRole="button"
                accessibilityLabel="All Shops"
              >
                <Text style={styles.adminText}>🏪  All Shops</Text>
                <Text style={styles.adminChevron}>›</Text>
              </Pressable>
            )}
            {/* PR-NEXT-BUNDLE-K §G — pending catalog item review queue. */}
            {isAdmin && (
              <Pressable
                style={styles.adminRow}
                onPress={() => nav.navigate('PendingCatalogQueue')}
                accessibilityRole="button"
                accessibilityLabel="Pending catalog items"
              >
                <Text style={styles.adminText}>🗂️  Pending catalog items</Text>
                <Text style={styles.adminChevron}>›</Text>
              </Pressable>
            )}
            {/* PR 8 Part A — admin audit log tile. */}
            {isAdmin && (
              <Pressable
                style={styles.adminRow}
                onPress={() => nav.navigate('AuditLog')}
                accessibilityRole="button"
                accessibilityLabel="Audit log"
              >
                <Text style={styles.adminText}>📜  Audit log</Text>
                <Text style={styles.adminChevron}>›</Text>
              </Pressable>
            )}
            {/* PR 38 — feature usage dashboard tile. */}
            {isAdmin && (
              <Pressable
                style={styles.adminRow}
                onPress={() => nav.navigate('AdminUsage')}
                accessibilityRole="button"
                accessibilityLabel="Feature usage"
              >
                <Text style={styles.adminText}>📊  Feature usage</Text>
                <Text style={styles.adminChevron}>›</Text>
              </Pressable>
            )}
          </>
        )}

        {pendingShop && (
          <Pressable
            style={styles.pendingRow}
            onPress={() =>
              nav.navigate('WaitingForApproval', { shopId: pendingShop.id })
            }
            accessibilityRole="button"
            accessibilityLabel={`Awaiting approval for ${pendingShop.name}`}
          >
            <Text style={styles.pendingText}>
              {pendingShop.status === 'rejected' ? '❌' : '📋'}{'  '}
              {pendingShop.status === 'rejected'
                ? `Rejected: ${pendingShop.name}`
                : `Awaiting approval for ${pendingShop.name}`}
            </Text>
            <Text style={styles.pendingChevron}>›</Text>
          </Pressable>
        )}

        {/* Opt-in section. Hide rows the user has already taken. The
            section header itself is hidden when there's nothing to
            opt into (i.e. user holds both roles already). Anonymous
            users can still see the section — claimShop / becomeDelivery
            require auth, and the BecomeShopOwner / BecomeDeliveryPartner
            screens render a "sign in first" empty state. That flow
            beats hiding the rows entirely (anon users wouldn't know
            these features exist). */}
        {(!isShopOwner || !isDelivery) && (
          <>
            <Text style={[styles.sectionTitle, { paddingHorizontal: spacing.lg }]}>
              Become more
            </Text>
            {/* Hide the "Open a shop" CTA when the user already has a
                registration in flight — the pendingShop tile above
                covers that case. Once the shop is approved the
                isShopOwner branch above takes over instead. */}
            {!isShopOwner && !pendingShop && (
              <Pressable
                style={styles.optInRow}
                onPress={() => nav.navigate('RegisterShop')}
                accessibilityRole="button"
                accessibilityLabel={`Open a shop on ${APP_NAME}`}
              >
                <Text style={styles.optInText}>{`🏪  Open a shop on ${APP_NAME}`}</Text>
                <Text style={styles.optInChevron}>›</Text>
              </Pressable>
            )}
            {!isDelivery && (
              <Pressable
                style={styles.optInRow}
                onPress={() => nav.navigate('BecomeDeliveryPartner')}
                accessibilityRole="button"
                accessibilityLabel="Become a delivery partner"
              >
                <Text style={styles.optInText}>🚲  Become a delivery partner</Text>
                <Text style={styles.optInChevron}>›</Text>
              </Pressable>
            )}
          </>
        )}

        <Text style={[styles.sectionTitle, { paddingHorizontal: spacing.lg }]}>How it works</Text>
        <View style={[styles.steps, { paddingHorizontal: spacing.lg }]}>
          <Step n="1" title="Pick a shop" desc="Browse nearby kirana stores" />
          <Step n="2" title="Add to cart" desc="Choose your groceries" />
          <Step n="3" title="Place order" desc="Pay on delivery, get it fast" />
        </View>

        {/* PR 19 — Favorites indicator tile. Tap-through to the
            dedicated FavoritesScreen. Self-hides when the customer
            has zero favorites so first-time / anonymous users
            don't see a useless empty link. */}
        {favoritesCount > 0 && (
          <Pressable
            style={styles.favoritesTile}
            onPress={() => nav.navigate('Favorites')}
            accessibilityRole="button"
            accessibilityLabel={`Open ${favoritesCount} favorite${favoritesCount === 1 ? '' : 's'}`}
          >
            <Text style={styles.favoritesText}>
              ❤️  {favoritesCount} {favoritesCount === 1 ? 'favorite' : 'favorites'}
            </Text>
            <Text style={styles.favoritesChevron}>›</Text>
          </Pressable>
        )}

        {/* PR 18 — Quick Switch dev tile. Dashed-border + muted
            color signals "developer tool, not a normal feature"
            so it's visually distinct from the real role tiles
            above. Auto-hidden for non-test users via
            isTestAccount; safe to leave deployed. */}
        {isTestAccount && (
          <View style={styles.devSection}>
            <Pressable
              onPress={() => setQuickSwitchVisible(true)}
              style={styles.quickSwitchButton}
              accessibilityRole="button"
              accessibilityLabel="Switch to test account"
            >
              <Text style={styles.quickSwitchText}>
                🔀 Switch test account
              </Text>
            </Pressable>
          </View>
        )}

        {__DEV__ && (
          <Text style={{ fontSize: 10, color: colors.textMuted, marginTop: spacing.xl, paddingHorizontal: spacing.lg }}>
            uid: {uid ?? 'pending'} {isAnonymous ? '[Anon]' : ''}{' '}
            {isAdmin ? '[Admin]' : ''}
            {isShopOwner ? '[ShopOwner]' : ''}
            {isDelivery ? '[Delivery]' : ''}
          </Text>
        )}
      </ScrollView>

      <ReorderModal
        visible={reorderModalVisible}
        plan={reorderPlan}
        loading={reorderLoading}
        onConfirm={onConfirmReorder}
        onCancel={onCancelReorder}
      />

      {/* PR 18 — Quick Switch modal. Mounted unconditionally
          (cheap when visible=false) so the open/close transitions
          animate cleanly; the visibility-gating happens on the
          trigger button above. */}
      <QuickSwitchModal
        visible={quickSwitchVisible}
        onClose={() => setQuickSwitchVisible(false)}
      />

      {itemCount > 0 && (
        <Pressable
          style={[styles.cartBar, { bottom: insets.bottom + spacing.sm }]}
          onPress={() => nav.navigate('Cart')}
          accessibilityRole="button"
          accessibilityLabel={`View cart, ${itemCount} item${itemCount > 1 ? 's' : ''}, total ${formatRupees(total)}`}
        >
          <Text style={styles.cartText}>
            🛒 {itemCount} item{itemCount > 1 ? 's' : ''} · {formatRupees(total)}
          </Text>
          <Text style={styles.cartCta}>View Cart ›</Text>
        </Pressable>
      )}
    </SafeAreaView>
  );
}

function Step({ n, title, desc }: { n: string; title: string; desc: string }) {
  return (
    <View style={styles.step}>
      <View style={styles.stepNum}>
        <Text style={styles.stepNumText}>{n}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.stepTitle}>{title}</Text>
        <Text style={styles.stepDesc}>{desc}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { paddingVertical: spacing.lg, paddingBottom: 120 },
  greeting: { ...typography.h1 },
  // PR 18 — Quick Switch dev tile styles. Dashed border + muted
  // surface deliberately read as "developer tool" rather than a
  // normal user CTA. Sits inline at the bottom of HomeScreen above
  // the __DEV__ debug line.
  devSection: {
    paddingHorizontal: spacing.lg,
    marginTop: spacing.md,
  },
  quickSwitchButton: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    alignSelf: 'flex-start',
  },
  quickSwitchText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  // PR 19 — favorites tile styles. Same horizontal-pill shape as
  // the saved-address rows on ProfileScreen so the visual language
  // for "tap-through to a list of saved things" stays consistent
  // across screens.
  favoritesTile: {
    marginTop: spacing.md,
    marginHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  favoritesText: {
    ...typography.bodyBold,
    color: colors.textPrimary,
  },
  favoritesChevron: {
    ...typography.h2,
    color: colors.textSecondary,
  },
  location: { ...typography.body, color: colors.textSecondary, marginTop: spacing.xs },
  fallbackBanner: {
    marginTop: spacing.md,
    marginHorizontal: spacing.lg,
    backgroundColor: colors.primaryLight,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  fallbackText: { ...typography.caption, color: colors.primaryDark },
  // PR-NEXT-BUNDLE-F §D — compact search: 40px tall, muted surface,
  // no border / no shadow. Visual weight lifted off the search row.
  searchBox: {
    marginTop: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    height: 40,
    justifyContent: 'center',
  },
  searchPlaceholder: { fontSize: 13, color: colors.textMuted },
  // PR-NEXT-BUNDLE-F §C — recent shops section wrapper.
  recentShopsSection: { marginTop: spacing.md },
  chipsScroll: { marginTop: spacing.md },
  chipsContent: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  chip: {
    backgroundColor: colors.primaryLight,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  chipText: { ...typography.caption, color: colors.primary, fontWeight: '600' },
  heroCard: {
    marginTop: spacing.lg,
    marginHorizontal: spacing.lg,
    backgroundColor: colors.primaryLight,
    padding: spacing.lg,
    borderRadius: radii.lg,
  },
  ordersRow: {
    marginTop: spacing.md,
    marginHorizontal: spacing.lg,
    backgroundColor: colors.bg,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  ordersText: { ...typography.bodyBold },
  ordersChevron: { ...typography.h2, color: colors.textSecondary },
  adminRow: {
    marginTop: spacing.md,
    marginHorizontal: spacing.lg,
    backgroundColor: colors.primaryDark,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  adminText: { ...typography.bodyBold, color: '#fff' },
  adminChevron: { ...typography.h2, color: '#fff' },
  signInRow: {
    marginTop: spacing.sm,
    marginHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  signInText: { ...typography.body, color: colors.textPrimary },
  signInChevron: { ...typography.h2, color: colors.textSecondary },
  // "Your Roles" — solid green for the active shop owner dashboard
  // entry (mirrors the previous adminRow look). The disabled variant
  // grays it out to signal "claimed but not yet usable".
  roleRow: {
    marginTop: spacing.md,
    marginHorizontal: spacing.lg,
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  roleRowDisabled: { backgroundColor: colors.border, opacity: 0.7 },
  roleText: { ...typography.bodyBold, color: '#fff' },
  roleTextDisabled: { color: colors.textSecondary },
  roleChevron: { ...typography.h2, color: '#fff' },
  // "Become more" — outlined cards that draw the eye but don't compete
  // with active role tiles.
  optInRow: {
    marginTop: spacing.md,
    marginHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.primaryLight,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  optInText: { ...typography.bodyBold, color: colors.primary },
  optInChevron: { ...typography.h2, color: colors.primary },
  // "Awaiting approval" tile — same layout as adminRow but warm-toned
  // so it reads as informational status, not a destructive admin
  // action. Color comes from theme.warning.
  pendingRow: {
    marginTop: spacing.md,
    marginHorizontal: spacing.lg,
    backgroundColor: colors.warning,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pendingText: { ...typography.bodyBold, color: '#fff', flex: 1 },
  pendingChevron: { ...typography.h2, color: '#fff' },
  heroTitle: { ...typography.h2, color: colors.primaryDark },
  heroSubtitle: { ...typography.body, color: colors.primaryDark, marginTop: spacing.xs },
  sectionTitle: { ...typography.h3, marginTop: spacing.xl, marginBottom: spacing.md },
  steps: { gap: spacing.md },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.bg,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  stepNum: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumText: { ...typography.bodyBold, color: '#fff' },
  stepTitle: { ...typography.bodyBold },
  stepDesc: { ...typography.caption, marginTop: 2 },
  cartBar: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.lg,
    backgroundColor: colors.primary,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cartText: { ...typography.bodyBold, color: '#fff' },
  cartCta: { ...typography.bodyBold, color: '#fff' },
  // PR 41 — pending-approval badges. The trailing wrappers replace
  // the bare chevron so the badge pill sits between the row text
  // and the chevron without disturbing the existing flex layout.
  // The badge itself is a small white pill on the green admin rows
  // (high contrast against the dark green); the shop-owner role row
  // uses the same pill since it sits on the same green background.
  adminTrailing: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  roleTrailing: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  badge: {
    backgroundColor: '#fff',
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    minWidth: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    ...typography.caption,
    fontWeight: '700',
    color: colors.primaryDark,
    fontVariant: ['tabular-nums'],
  },
});

/**
 * PR 41 — badge count formatter. Display the raw count up to 99 and
 * cap at "99+" for higher values so the pill width stays bounded.
 * Server already caps at 999 (`capPendingCount`); this is the
 * display-side cap on top of that.
 */
function formatBadgeCount(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n > 99) return '99+';
  return String(Math.floor(n));
}
