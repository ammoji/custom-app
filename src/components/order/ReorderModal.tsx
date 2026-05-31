/**
 * PR 13 — Reorder preview modal.
 *
 * Presentation-only component. Takes a ReorderPlan, renders three
 * sections (available items / unavailable items / CTA row), and
 * fires `onConfirm` when the customer commits. The screen is
 * responsible for:
 *   - Building the plan via buildReorderPlan(pastOrder, menu).
 *   - Calling useCartStore.replaceCartWithItems on confirm.
 *   - Navigating to the Cart screen.
 *
 * Loading state shows a spinner while the menu is being fetched
 * (network round-trip via orderService.listShopMenuPublic).
 *
 * Styling matches the cancelWindowCard / ETA modal patterns from
 * earlier PRs — primaryLight tint header, rounded card, scrollable
 * body.
 */

import React from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Button from '../common/Button';
import { colors, radii, spacing, typography } from '../../constants/theme';
import { formatRupees } from '../../utils/format';
import type { ReorderLine, ReorderPlan } from '../../utils/buildReorderPlan';
// PR-NEXT-8 §A (finding #14) — pure helpers for the
// dismissable-✕ behavior on Unavailable rows. Pulled into
// `reorderModalDismissals.ts` so the logic is unit-testable
// without bringing @testing-library/react-native into the suite.
import {
  addDismissedId,
  buildPlanKey,
} from '../../utils/reorderModalDismissals';

type Props = {
  visible: boolean;
  plan: ReorderPlan | null;
  loading: boolean; // true while menu is being fetched
  onConfirm: () => void;
  onCancel: () => void;
};

export default function ReorderModal({
  visible,
  plan,
  loading,
  onConfirm,
  onCancel,
}: Props) {
  // PR-NEXT-8 §A (finding #14) — modal-local dismissal set for
  // unavailable rows. Hooks discipline (Rule 2): both `useState`
  // and `useEffect` sit ABOVE every conditional render. The
  // existing component had no `if`-returns inside its body, but
  // we follow the rule defensively in case future edits add one.
  const [dismissedIds, setDismissedIds] = React.useState<Set<string>>(
    () => new Set(),
  );

  // Reset the dismissal set whenever the modal opens with a new
  // plan. We key on the plan's identity-stable contents (shopId +
  // line IDs) instead of the plan object reference — the parent
  // screen may re-create the same plan object across renders, and
  // we don't want a re-render to wipe the customer's dismissals
  // mid-interaction. See `buildPlanKey` JSDoc.
  const planKey = buildPlanKey(plan);
  React.useEffect(() => {
    setDismissedIds(new Set());
  }, [planKey]);

  // Subtotal preview: only available lines contribute, at CURRENT
  // (live) prices. Same number planToCartItems would surface in
  // the cart screen, so the customer doesn't see a jump.
  const subtotal =
    plan?.lines
      .filter(l => l.currentMenuItem && l.status.startsWith('available_'))
      .reduce(
        (s, l) => s + (l.currentMenuItem?.price ?? 0) * l.oldQuantity,
        0,
      ) ?? 0;

  // PR-NEXT-8 §A — derive the visible Unavailable list. The CTA
  // count, subtotal, and `planToCartItems` (in the parent screen)
  // are all unchanged: dismissing an unavailable row is a
  // presentation-only act and never affects what gets added to
  // the cart.
  const allUnavailableLines = plan
    ? plan.lines.filter(l => !l.status.startsWith('available_'))
    : [];
  const visibleUnavailableLines = allUnavailableLines.filter(
    l => !dismissedIds.has(l.menuItemId),
  );
  const visibleUnavailableCount = visibleUnavailableLines.length;

  const ctaTitle = !plan
    ? 'Loading…'
    : plan.availableCount === 0
      ? 'No items available'
      : `Add ${plan.availableCount} item${plan.availableCount > 1 ? 's' : ''} to cart`;
  const ctaDisabled = !plan || plan.availableCount === 0 || loading;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <Pressable style={styles.overlay} onPress={onCancel}>
        {/* Inner pressable swallows the tap so taps inside the
            card don't dismiss. Same trick as the ETA modal. */}
        <Pressable style={styles.card} onPress={() => {}}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>
              {plan ? `Reorder from ${plan.shopName}` : 'Reorder'}
            </Text>
            <Text style={styles.subtitle}>
              {loading
                ? 'Checking availability…'
                : plan
                  ? 'Quantities from your past order, prices from today.'
                  : ''}
            </Text>
          </View>

          {/* Body */}
          {loading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.loadingText}>
                Checking availability with the shop…
              </Text>
            </View>
          ) : plan ? (
            <ScrollView
              style={styles.body}
              contentContainerStyle={styles.bodyContent}
            >
              {plan.availableCount > 0 && (
                <Section title={`Available (${plan.availableCount})`}>
                  {plan.lines
                    .filter(l => l.status.startsWith('available_'))
                    .map(l => (
                      <AvailableRow key={l.menuItemId} line={l} />
                    ))}
                </Section>
              )}

              {/* PR-NEXT-8 §A (finding #14) — section title +
                  rendered list both use the post-dismissal counts;
                  whole section disappears when the customer has
                  dismissed all unavailable rows. The underlying
                  `plan.unavailableCount` is unchanged (it's the
                  immutable plan's truth); the visible count is a
                  presentation-only derivation. */}
              {visibleUnavailableCount > 0 && (
                <Section
                  title={`Unavailable (${visibleUnavailableCount})`}
                  muted
                >
                  {visibleUnavailableLines.map(l => (
                    <UnavailableRow
                      key={l.menuItemId}
                      line={l}
                      onDismiss={() =>
                        setDismissedIds(prev =>
                          addDismissedId(prev, l.menuItemId),
                        )
                      }
                    />
                  ))}
                </Section>
              )}

              {plan.availableCount > 0 && (
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>Subtotal</Text>
                  <Text style={styles.totalValue}>
                    {formatRupees(subtotal)}
                  </Text>
                </View>
              )}
            </ScrollView>
          ) : (
            <View style={styles.loadingBox}>
              <Text style={styles.loadingText}>
                We couldn&apos;t load this shop&apos;s menu.
              </Text>
            </View>
          )}

          {/* CTA row */}
          <View style={styles.actions}>
            <View style={styles.actionBtn}>
              <Button
                title="Cancel"
                variant="secondary"
                onPress={onCancel}
                fullWidth
              />
            </View>
            <View style={{ width: spacing.sm }} />
            <View style={styles.actionBtn}>
              <Button
                title={ctaTitle}
                onPress={onConfirm}
                disabled={ctaDisabled}
                fullWidth
              />
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Section({
  title,
  muted,
  children,
}: {
  title: string;
  muted?: boolean;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, muted && styles.sectionTitleMuted]}>
        {title}
      </Text>
      {children}
    </View>
  );
}

function AvailableRow({ line }: { line: ReorderLine }) {
  const live = line.currentMenuItem!;
  const priceChanged = line.status !== 'available_same_price';
  const pctRaw =
    line.oldPrice > 0
      ? Math.round(((live.price - line.oldPrice) / line.oldPrice) * 100)
      : 0;
  const pctLabel = pctRaw > 0 ? `+${pctRaw}%` : `${pctRaw}%`;
  return (
    <View style={styles.row}>
      <Image source={{ uri: live.imageUrl }} style={styles.thumb} />
      <View style={styles.rowBody}>
        <Text style={styles.rowName} numberOfLines={1}>
          {live.name}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {live.packLabel} · Qty {line.oldQuantity}
        </Text>
        <View style={styles.priceRow}>
          <Text style={styles.priceCurrent}>{formatRupees(live.price)}</Text>
          {priceChanged && (
            <>
              <Text style={styles.priceOld}>{formatRupees(line.oldPrice)}</Text>
              <View
                style={[
                  styles.pctBadge,
                  line.status === 'available_price_increased'
                    ? styles.pctBadgeUp
                    : styles.pctBadgeDown,
                ]}
              >
                <Text style={styles.pctBadgeText}>{pctLabel}</Text>
              </View>
            </>
          )}
        </View>
      </View>
      <Text style={styles.rowIcon}>✓</Text>
    </View>
  );
}

// PR-NEXT-8 §A (finding #14) — `onDismiss` prop wires the ✕ glyph
// to a real Pressable (was a static <Text> pre-PR). Hit-slop +
// accessibilityLabel make the small touch target reliable on
// Android (where row density is tighter than iOS).
function UnavailableRow({
  line,
  onDismiss,
}: {
  line: ReorderLine;
  onDismiss: () => void;
}) {
  // Use live menu fields when present (e.g. out_of_stock), fall
  // back to the past-order snapshot for removed_from_menu (the
  // menu doc no longer exists).
  const name = line.currentMenuItem?.name ?? line.pastName;
  const pack = line.currentMenuItem?.packLabel ?? line.pastPackLabel;
  const image = line.currentMenuItem?.imageUrl ?? line.pastImageUrl;
  return (
    <View style={[styles.row, styles.rowMuted]}>
      <Image source={{ uri: image }} style={[styles.thumb, styles.thumbMuted]} />
      <View style={styles.rowBody}>
        <Text style={[styles.rowName, styles.rowNameMuted]} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {pack} · Qty {line.oldQuantity}
        </Text>
        <Text style={styles.unavailableReason}>
          {line.reason ?? 'Unavailable'}
        </Text>
      </View>
      <Pressable
        onPress={onDismiss}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel={`Dismiss ${name}`}
        style={({ pressed }) => [
          styles.dismissBtn,
          pressed && { opacity: 0.6 },
        ]}
      >
        <Text style={[styles.rowIcon, styles.rowIconMuted, styles.dismissIcon]}>
          ✕
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    backgroundColor: colors.bg,
    borderRadius: radii.md,
    maxHeight: '85%',
    overflow: 'hidden',
  },
  header: {
    backgroundColor: colors.primaryLight,
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: { ...typography.h2, color: colors.primaryDark },
  subtitle: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 4,
  },
  body: { maxHeight: 480 },
  bodyContent: { padding: spacing.lg, paddingBottom: spacing.md },
  loadingBox: {
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.md,
  },
  loadingText: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  section: { marginBottom: spacing.lg },
  sectionTitle: {
    ...typography.bodyBold,
    marginBottom: spacing.sm,
  },
  sectionTitleMuted: { color: colors.textSecondary },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowMuted: { opacity: 0.6 },
  thumb: {
    width: 44,
    height: 44,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
  },
  thumbMuted: { opacity: 0.7 },
  rowBody: { flex: 1, minWidth: 0 },
  rowName: { ...typography.bodyBold },
  rowNameMuted: { textDecorationLine: 'line-through' },
  rowMeta: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: 2,
  },
  priceCurrent: { ...typography.bodyBold, color: colors.primaryDark },
  priceOld: {
    ...typography.caption,
    color: colors.textSecondary,
    textDecorationLine: 'line-through',
  },
  pctBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radii.sm,
    marginLeft: spacing.xs,
  },
  pctBadgeUp: { backgroundColor: '#FEE2E2' },
  pctBadgeDown: { backgroundColor: '#DCFCE7' },
  pctBadgeText: {
    ...typography.caption,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  unavailableReason: {
    ...typography.caption,
    color: colors.danger,
    marginTop: 2,
  },
  rowIcon: {
    ...typography.h2,
    color: colors.primary,
    marginLeft: spacing.sm,
  },
  rowIconMuted: { color: colors.textSecondary },
  // PR-NEXT-8 §A (finding #14) — pressable touch target around the
  // ✕ glyph. The padding gives Android comfortable hit area beyond
  // the `hitSlop={12}` we already set on the Pressable; the glyph
  // itself drops its left margin so the ROW's spacing comes from
  // this wrapper instead (preserves the pre-PR visual rhythm).
  dismissBtn: {
    padding: spacing.xs,
    marginLeft: spacing.sm,
  },
  dismissIcon: { marginLeft: 0 },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  totalLabel: { ...typography.bodyBold },
  totalValue: { ...typography.h3, color: colors.primaryDark },
  actions: {
    flexDirection: 'row',
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  actionBtn: { flex: 1 },
});
