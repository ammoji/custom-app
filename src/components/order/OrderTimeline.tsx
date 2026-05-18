/**
 * PR 11 — Admin order timeline.
 *
 * Vertical strip of dots connected by lines on the left, status
 * label + timestamp + actor on the right. Used inside
 * AdminOrdersScreen behind a disclosure (one card open at a time
 * — same pattern as the PR 7 manual-override panel).
 *
 * Renders entries in the order they arrive (i.e. the order
 * `arrayUnion` wrote them in). Do NOT sort by `at`: two server
 * writes in the same millisecond would have identical timestamps
 * (e.g. cancel + refund_pending in one transaction), and a sort
 * would shuffle that pair non-deterministically.
 *
 * All formatting helpers live in `src/utils/orderTimeline.ts` so
 * they're unit-tested without React.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing, typography } from '../../constants/theme';
import { formatOrderTime } from '../../utils/format';
import {
  formatTimelineActor,
  labelForTimelineStatus,
  type TimelineEntry,
} from '../../utils/orderTimeline';

type Props = {
  entries: TimelineEntry[];
};

export default function OrderTimeline({ entries }: Props) {
  if (entries.length === 0) {
    return (
      <View style={styles.emptyWrap}>
        <Text style={styles.emptyText}>No timeline entries yet.</Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      {entries.map((entry, idx) => {
        const isLast = idx === entries.length - 1;
        return (
          <View
            key={`${entry.at}-${idx}-${entry.status}`}
            style={styles.row}
          >
            {/* Left rail: dot + connector line. */}
            <View style={styles.rail}>
              <View style={styles.dot} />
              {!isLast && <View style={styles.connector} />}
            </View>
            {/* Right cell: label, time, actor, optional reason. */}
            <View style={styles.cell}>
              <Text style={styles.statusLine}>
                <Text style={styles.statusLabel}>
                  {labelForTimelineStatus(entry.status)}
                </Text>
                <Text style={styles.timeLabel}>
                  {' · '}
                  {formatOrderTime(entry.at)}
                </Text>
              </Text>
              <Text style={styles.actorLine} numberOfLines={1}>
                by {formatTimelineActor(entry.by)}
              </Text>
              {entry.reason && (
                <Text style={styles.reasonLine} numberOfLines={2}>
                  &ldquo;{entry.reason}&rdquo;
                </Text>
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const DOT_SIZE = 10;

const styles = StyleSheet.create({
  wrap: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  emptyWrap: {
    paddingVertical: spacing.sm,
  },
  emptyText: {
    ...typography.caption,
    color: colors.textMuted,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  rail: {
    width: 18,
    alignItems: 'center',
    paddingTop: 4,
  },
  dot: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: radii.pill,
    backgroundColor: colors.primary,
  },
  connector: {
    flex: 1,
    width: 2,
    backgroundColor: colors.border,
    marginTop: 2,
  },
  cell: {
    flex: 1,
    paddingBottom: spacing.sm,
    paddingLeft: spacing.sm,
  },
  statusLine: {
    ...typography.body,
  },
  statusLabel: {
    ...typography.bodyBold,
    color: colors.textPrimary,
  },
  timeLabel: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  actorLine: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  reasonLine: {
    ...typography.caption,
    color: colors.textMuted,
    fontStyle: 'italic',
    marginTop: 2,
  },
});
