/**
 * PR-NEXT-6 (findings #13, #16) — Delivery proof photo viewer.
 *
 * Single component reused by ShopOrderDetailScreen, OrderDetailScreen
 * (customer), and any future admin order-detail surface. Returns
 * null when the order has no proof; otherwise mints a 15-min v4
 * signed read URL on mount and renders a labelled thumbnail with
 * tap-to-zoom into a full-screen modal.
 *
 * Auth boundary lives in `getDeliveryProofReadUrl` (server). This
 * component does NOT check role; if the callable returns
 * permission-denied, the thumbnail silently fails to render with an
 * inline error string. The caller's audience is already correctly
 * scoped by virtue of being on a detail screen the user has reached
 * via their own role-gated navigation.
 *
 * Hooks discipline (Rule 2): all useState/useEffect calls live above
 * the `if (!hasProof) return null` guard so React's hook ordering
 * never sees a conditional path.
 */
import React from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { colors, radii, spacing, typography } from '../../constants/theme';
import { orderService } from '../../services/orderService';

export default function DeliveryProofViewer({
  orderId,
  hasProof,
}: {
  orderId: string;
  hasProof: boolean;
}) {
  const [readUrl, setReadUrl] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [zoomed, setZoomed] = React.useState(false);
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();

  React.useEffect(() => {
    if (!hasProof) {
      // Important reset: when the parent flips `hasProof` from true
      // → false (e.g. an admin nukes the proof on a disputed order),
      // the stale URL must be wiped so a re-flip back to true triggers
      // a fresh mint.
      setReadUrl(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    orderService
      .getDeliveryProofReadUrl(orderId)
      .then(({ readUrl: url }) => {
        if (cancelled) return;
        setReadUrl(url);
      })
      .catch(e => {
        if (cancelled) return;
        // Surface the server's HttpsError message verbatim so a
        // permission-denied / not-found / unauth case shows
        // something actionable rather than a generic "Could not
        // load photo" that hides the bug class.
        setError(e?.message || 'Could not load photo');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [hasProof, orderId]);

  if (!hasProof) return null;
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Delivery proof</Text>
      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : error ? (
        <Text style={styles.errorText}>{error}</Text>
      ) : readUrl ? (
        <>
          <Pressable
            onPress={() => setZoomed(true)}
            accessibilityRole="button"
            accessibilityLabel="View full delivery proof photo"
          >
            <Image source={{ uri: readUrl }} style={styles.thumb} />
          </Pressable>
          <Modal
            visible={zoomed}
            transparent
            animationType="fade"
            onRequestClose={() => setZoomed(false)}
          >
            <Pressable
              style={styles.zoomOverlay}
              onPress={() => setZoomed(false)}
              accessibilityRole="button"
              accessibilityLabel="Close delivery proof photo"
            >
              <Image
                source={{ uri: readUrl }}
                style={{ width: screenWidth, height: screenHeight }}
                resizeMode="contain"
              />
              <View style={styles.zoomCloseHint}>
                <Text style={styles.zoomCloseText}>Tap anywhere to close</Text>
              </View>
            </Pressable>
          </Modal>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginVertical: spacing.md, paddingHorizontal: spacing.lg },
  sectionTitle: { ...typography.bodyBold, marginBottom: spacing.sm },
  loadingBox: { padding: spacing.lg, alignItems: 'center' },
  errorText: { ...typography.caption, color: colors.danger },
  thumb: {
    width: 120,
    height: 120,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
  },
  zoomOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomCloseHint: { position: 'absolute', bottom: 40 },
  zoomCloseText: { ...typography.caption, color: '#fff' },
});
