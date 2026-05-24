import { useNavigation } from '@react-navigation/native';
import React, { useEffect, useMemo, useState } from 'react';
import {
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Button from '../../components/common/Button';
import EmptyState from '../../components/common/EmptyState';
import Loader from '../../components/common/Loader';
import ScreenHeader from '../../components/common/ScreenHeader';
import { colors, radii, spacing, typography } from '../../constants/theme';
// PR 38.1 — DO NOT REMOVE. Reads now route through
// `orderService.queryFeatureUsageLog` (a Cloud Function callable).
// PR 38 originally used the Web SDK's `getDocs`, which fails on
// native because the Web SDK Firestore client can't see RNFB's
// auth context (same root cause as PR 6.1's signed-upload-URL fix).
import { orderService } from '../../services/orderService';
import { useAuthStore } from '../../store/useAuthStore';
import {
    byRole,
    topFeatures,
    uniqueShops,
    uniqueUsers,
    type FeatureUsageEvent,
} from './adminUsageHelpers';

/**
 * PR 38 — Admin feature usage dashboard.
 *
 * Reads the `featureUsageLog/` collection (written in parallel
 * to Firebase Analytics by `src/services/analytics.ts` on every
 * tracked event) and renders aggregated counts:
 *   - 4 summary tiles (total events, unique users, unique shops,
 *     top feature)
 *   - Top-20 features by count with progress-bar rows
 *   - Per-role breakdown bar chart
 *
 * One-shot fetch on mount + period change; no `onSnapshot` to
 * keep Firestore read costs predictable (admin re-visits this
 * tile rarely, and live counters add no decision-relevant info).
 *
 * Query cap: limit(10000) at pilot scale. If pilot crosses that,
 * the next step is a scheduled Cloud Function pre-computing daily
 * counter docs — out of scope for PR 38. Aggregation is pure
 * (see `./adminUsageHelpers.ts`) and unit-tested.
 *
 * Strategic Principle 7 metrics are computable from this screen
 * once events are flowing: time-to-first-menu-item =
 * delta(shop_signed_in, first shop_menu_item_added); merchant
 * weekly active = distinct shopIds with any shop_* event in 7d;
 * customer repeat-order = distinct customer uids with ≥ 2
 * place_order events in 30d.
 */

const ROLE_LABELS: Record<FeatureUsageEvent['role'], string> = {
  customer: 'Customer',
  shop_owner: 'Shop owner',
  delivery: 'Delivery',
  admin: 'Admin',
  anonymous: 'Anonymous',
};

const ROLE_COLORS: Record<FeatureUsageEvent['role'], string> = {
  customer: '#2563EB',
  shop_owner: '#16A34A',
  delivery: '#D97706',
  admin: '#7C3AED',
  anonymous: '#6B7280',
};

export default function AdminUsageScreen() {
  const nav = useNavigation<any>();
  const isAdmin = useAuthStore(s => s.isAdmin);

  // All hooks ABOVE the early return — Rules-of-Hooks discipline
  // (PR 12 / PR 27 / PR 34 lineage). Even though the early return
  // never re-enters with a different value on the same mount,
  // React enforces the discipline statically.
  const [period, setPeriod] = useState<'7d' | '30d'>('7d');
  const [events, setEvents] = useState<FeatureUsageEvent[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAllFeatures, setShowAllFeatures] = useState(false);

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);

    // PR 38.1 — was a direct `getDocs` against `featureUsageLog/`
    // until the Web-SDK-vs-RNFB-auth mismatch surfaced on native
    // (same root cause as PR 6.1's signed-upload-URL fix). The
    // callable runs the same query server-side and returns the
    // events array + a truncation flag.
    orderService
      .queryFeatureUsageLog({ period })
      .then(({ events: list, truncated: tr }) => {
        if (cancelled) return;
        setEvents(list as FeatureUsageEvent[]);
        setTruncated(tr);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const msg =
          e instanceof Error ? e.message : 'Failed to load usage data';
        setError(msg);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isAdmin, period]);

  // Memoize the aggregates so toggling "Show all" doesn't re-walk
  // the event list. The roles + uniqueUsers/uniqueShops walks
  // are cheap individually but compound with `topFeatures` to
  // ~O(3N) on a 10k array — fine at pilot scale but free
  // optimization anyway.
  const featuresAll = useMemo(
    () => topFeatures(events, Infinity),
    [events],
  );
  const featuresTop = useMemo(
    () => featuresAll.slice(0, 20),
    [featuresAll],
  );
  const rolesAgg = useMemo(() => byRole(events), [events]);
  const uniqUsers = useMemo(() => uniqueUsers(events), [events]);
  const uniqShops = useMemo(() => uniqueShops(events), [events]);

  if (!isAdmin) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="Feature usage" onBack={() => nav.goBack()} />
        <EmptyState
          title="Admin access required"
          subtitle="Only admins can view feature usage."
        />
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="Feature usage" onBack={() => nav.goBack()} />
        <Loader fullScreen />
      </SafeAreaView>
    );
  }

  const totalEvents = events.length;
  const top = featuresAll[0];
  const roleTotal = rolesAgg.reduce((acc, r) => acc + r.count, 0);
  const featuresList = showAllFeatures ? featuresAll : featuresTop;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="Feature usage" onBack={() => nav.goBack()} />
      <ScrollView contentContainerStyle={styles.content}>
        {/* Period selector */}
        <View style={styles.periodRow}>
          <Pressable
            onPress={() => setPeriod('7d')}
            style={[
              styles.periodPill,
              period === '7d' && styles.periodPillActive,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Last 7 days"
          >
            <Text
              style={[
                styles.periodPillText,
                period === '7d' && styles.periodPillTextActive,
              ]}
            >
              Last 7 days
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setPeriod('30d')}
            style={[
              styles.periodPill,
              period === '30d' && styles.periodPillActive,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Last 30 days"
          >
            <Text
              style={[
                styles.periodPillText,
                period === '30d' && styles.periodPillTextActive,
              ]}
            >
              Last 30 days
            </Text>
          </Pressable>
        </View>

        {error && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
            <Button
              title="Retry"
              onPress={() => setPeriod(p => p)}
              variant="secondary"
            />
          </View>
        )}

        {totalEvents === 0 ? (
          <EmptyState
            title="No events in this period"
            subtitle="Once shops, customers, and admins use the app, events will appear here."
          />
        ) : (
          <>
            {/* Section A — Summary tiles (2x2) */}
            <View style={styles.tileGrid}>
              <SummaryTile label="Total events" value={String(totalEvents)} />
              <SummaryTile
                label="Unique users"
                value={String(uniqUsers)}
              />
              <SummaryTile
                label="Unique shops"
                value={String(uniqShops)}
              />
              <SummaryTile
                label="Top feature"
                value={top ? top.feature : '—'}
                subValue={top ? `${top.count} (${top.pct.toFixed(1)}%)` : ''}
              />
            </View>

            {/* Section B — Breakdown by feature */}
            <Text style={styles.sectionTitle}>By feature</Text>
            <View style={styles.card}>
              {featuresList.map(f => (
                <View key={f.feature} style={styles.featureRow}>
                  <View style={styles.featureRowHeader}>
                    <Text style={styles.featureName} numberOfLines={1}>
                      {f.feature}
                    </Text>
                    <Text style={styles.featureCount}>
                      {f.count} · {f.pct.toFixed(1)}%
                    </Text>
                  </View>
                  <View style={styles.bar}>
                    <View
                      style={[
                        styles.barFill,
                        {
                          width: `${Math.min(100, f.pct)}%`,
                        },
                      ]}
                    />
                  </View>
                </View>
              ))}
              {featuresAll.length > 20 && (
                <Pressable
                  onPress={() => setShowAllFeatures(v => !v)}
                  style={styles.showAllBtn}
                  accessibilityRole="button"
                  accessibilityLabel={
                    showAllFeatures ? 'Show top 20' : 'Show all features'
                  }
                >
                  <Text style={styles.showAllText}>
                    {showAllFeatures
                      ? '↑ Show top 20'
                      : `↓ Show all ${featuresAll.length} features`}
                  </Text>
                </Pressable>
              )}
            </View>

            {/* Section C — Breakdown by role */}
            <Text style={styles.sectionTitle}>By role</Text>
            <View style={styles.card}>
              {rolesAgg.map(r => {
                const pct = roleTotal ? (r.count / roleTotal) * 100 : 0;
                return (
                  <View key={r.role} style={styles.featureRow}>
                    <View style={styles.featureRowHeader}>
                      <Text style={styles.featureName}>
                        {ROLE_LABELS[r.role]}
                      </Text>
                      <Text style={styles.featureCount}>
                        {r.count} · {pct.toFixed(1)}%
                      </Text>
                    </View>
                    <View style={styles.bar}>
                      <View
                        style={[
                          styles.barFill,
                          {
                            width: `${Math.min(100, pct)}%`,
                            backgroundColor: ROLE_COLORS[r.role],
                          },
                        ]}
                      />
                    </View>
                  </View>
                );
              })}
            </View>

            <Text style={styles.footnote}>
              Showing {totalEvents.toLocaleString()} event
              {totalEvents === 1 ? '' : 's'} from the last{' '}
              {period === '7d' ? '7' : '30'} days.
              {truncated
                ? ' Result truncated at the 10,000-event server cap; the period likely contains more.'
                : ''}
            </Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function SummaryTile({
  label,
  value,
  subValue,
}: {
  label: string;
  value: string;
  subValue?: string;
}) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.tileValue} numberOfLines={1}>
        {value}
      </Text>
      {subValue ? (
        <Text style={styles.tileSubValue} numberOfLines={1}>
          {subValue}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  periodRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  periodPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  periodPillActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  periodPillText: {
    ...typography.body,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  periodPillTextActive: { color: colors.surface },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FEE2E2',
    padding: spacing.md,
    borderRadius: radii.md,
    marginBottom: spacing.md,
  },
  errorText: {
    ...typography.body,
    color: colors.danger,
    flex: 1,
    marginRight: spacing.sm,
  },
  tileGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  tile: {
    flexBasis: '47%',
    flexGrow: 1,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  tileLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '700',
    marginBottom: spacing.xs,
  },
  tileValue: {
    ...typography.h2,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  tileSubValue: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  sectionTitle: {
    ...typography.body,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  featureRow: { marginBottom: spacing.md },
  featureRowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  featureName: {
    ...typography.body,
    color: colors.textPrimary,
    fontWeight: '600',
    flex: 1,
    marginRight: spacing.sm,
  },
  featureCount: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  bar: {
    height: 6,
    backgroundColor: colors.border,
    borderRadius: 3,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 3,
  },
  showAllBtn: { paddingVertical: spacing.sm, alignItems: 'center' },
  showAllText: {
    ...typography.body,
    color: colors.primary,
    fontWeight: '600',
  },
  footnote: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.lg,
    fontStyle: 'italic',
  },
});
