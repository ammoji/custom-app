import { useNavigation } from '@react-navigation/native';
import React, { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import EmptyState from '../components/common/EmptyState';
import Loader from '../components/common/Loader';
import ScreenHeader from '../components/common/ScreenHeader';
import OrderStatusChip from '../components/order/OrderStatusChip';
import { colors, radii, shadow, spacing, typography } from '../constants/theme';
import { useOrderStore } from '../store/useOrderStore';
import { useOrderStoreHydrated } from '../store/useStoreHydration';
import { formatOrderTime, formatRupees } from '../utils/format';

export default function OrdersScreen() {
  const nav = useNavigation<any>();
  const orders = useOrderStore(s => s.orders);
  const hydrated = useOrderStoreHydrated();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    // Orders are local; this is a UX gesture only.
    await new Promise(res => setTimeout(res, 400));
    setRefreshing(false);
  }, []);

  if (!hydrated) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="My Orders" onBack={() => nav.goBack()} />
        <Loader fullScreen />
      </SafeAreaView>
    );
  }

  if (orders.length === 0) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="My Orders" onBack={() => nav.goBack()} />
        <EmptyState
          title="No orders yet"
          subtitle="Place your first order to see it here."
          ctaLabel="Browse shops"
          onCtaPress={() => nav.navigate('ShopList')}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="My Orders" onBack={() => nav.goBack()} />
      <FlatList
        data={orders}
        keyExtractor={o => o.id}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        renderItem={({ item }) => {
          const itemCount = item.items.reduce((n, i) => n + i.quantity, 0);
          return (
            <Pressable
              style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}
              onPress={() => nav.navigate('OrderDetail', { orderId: item.id })}
              accessibilityRole="button"
              accessibilityLabel={`Order from ${item.shopName}, total ${formatRupees(item.total)}, status ${item.status}`}
            >
              <View style={styles.cardRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.shopName} numberOfLines={1}>{item.shopName}</Text>
                  <Text style={styles.meta}>
                    {itemCount} item{itemCount > 1 ? 's' : ''} · {formatRupees(item.total)}
                  </Text>
                  <Text style={styles.time}>{formatOrderTime(item.createdAt)}</Text>
                </View>
                <OrderStatusChip status={item.status} />
              </View>
            </Pressable>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  list: { padding: spacing.lg, paddingBottom: spacing.xxl },
  card: {
    backgroundColor: colors.bg,
    borderRadius: radii.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
  },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  shopName: { ...typography.h3 },
  meta: { ...typography.caption, marginTop: 2 },
  time: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
});
