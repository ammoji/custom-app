import { CommonActions, useNavigation, useRoute } from '@react-navigation/native';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Button from '../components/common/Button';
import { colors, radii, spacing, typography } from '../constants/theme';
import { useOrderStore } from '../store/useOrderStore';
import { formatRupees } from '../utils/format';

export default function OrderConfirmationScreen() {
  const route = useRoute<any>();
  const nav = useNavigation<any>();
  const { orderId } = route.params as { orderId: string };
  const order = useOrderStore(s => s.getById(orderId));

  const goHome = () => {
    nav.dispatch(
      CommonActions.reset({
        index: 0,
        routes: [{ name: 'Home' }],
      })
    );
  };

  const viewOrder = () => nav.navigate('OrderDetail', { orderId });

  if (!order) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.content}>
          <View style={styles.checkCircle}>
            <Text style={styles.check}>✓</Text>
          </View>
          <Text style={styles.title}>Order saved</Text>
          <Text style={styles.subtitle}>Check Orders for details.</Text>
          <View style={styles.buttons}>
            <Button title="My Orders" onPress={() => nav.navigate('Orders')} fullWidth />
            <Button title="Back to Home" variant="secondary" onPress={goHome} fullWidth />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  const etaMinutes = Math.max(
    1,
    Math.round((order.estimatedDeliveryAt - order.createdAt) / 60_000),
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.content}>
        <View style={styles.checkCircle}>
          <Text style={styles.check}>✓</Text>
        </View>

        <Text style={styles.title}>Order placed!</Text>
        <Text style={styles.subtitle}>We've notified {order.shopName}</Text>

        <View style={styles.card}>
          <Row label="Order ID" value={order.id} />
          <Row label="ETA" value={`~${etaMinutes} min`} />
          <Row label="Total" value={formatRupees(order.total)} />
          <Row label="Payment" value="Cash on Delivery" />
        </View>

        <View style={styles.buttons}>
          <Button title="View Order" onPress={viewOrder} fullWidth />
          <Button title="Back to Home" variant="secondary" onPress={goHome} fullWidth />
        </View>
      </View>
    </SafeAreaView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={[typography.body, { color: colors.textSecondary }]}>{label}</Text>
      <Text style={typography.bodyBold}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  checkCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  check: { color: '#fff', fontSize: 40, lineHeight: 44, fontWeight: '800' },
  title: { ...typography.h1, textAlign: 'center' },
  subtitle: { ...typography.body, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.xs },
  card: {
    alignSelf: 'stretch',
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.lg,
    marginTop: spacing.xl,
    gap: spacing.sm,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  buttons: { alignSelf: 'stretch', marginTop: spacing.xl, gap: spacing.md },
});
