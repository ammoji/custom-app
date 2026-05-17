import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
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
import type { RootStackParamList } from '../../navigation/AppNavigator';
import { orderService } from '../../services/orderService';
import type { Shop } from '../../types';

/**
 * PR 5 — Shop owner settings screen.
 *
 * Minimal by design (per the prompt's "Resist adding hours / GST /
 * FSSAI" note). Two numeric inputs that map 1:1 to the
 * `updateShopSettings` callable's whitelisted fields.
 *
 * Dirty-field pattern mirrors `ShopMenuItemEditScreen`: parse strings
 * to numbers on save, build the payload from changed fields only,
 * send. The callable's helper rejects ranges + types server-side, so
 * the client validation here is friendly (highlight + inline error)
 * rather than strict.
 *
 * Keyboard handling: wrap in `KeyboardAvoidingView` per the canonical
 * `CancelAndRefundModal` pattern. Two sequential numeric inputs are
 * exactly the case where the keyboard otherwise covers the Save
 * button on shorter Android devices.
 */
export default function ShopSettingsScreen() {
  const nav = useNavigation<any>();
  const route = useRoute<RouteProp<RootStackParamList, 'ShopSettings'>>();
  // Admin path: route.params.shopId targets a specific shop.
  // Shop owner path: no params → falls back to getShopForOwner (their
  // own shop, scoped by their claim).
  const targetShopId = route.params?.shopId;
  const isAdminPath = typeof targetShopId === 'string' && targetShopId.length > 0;

  const [shop, setShop] = useState<Shop | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [deliveryFeeStr, setDeliveryFeeStr] = useState('');
  const [minOrderStr, setMinOrderStr] = useState('');
  // Per-field inline errors (client-side, friendly). The server's
  // tighter validation runs on Save; if it fires, we surface that
  // through the Alert below.
  const [errors, setErrors] = useState<{
    deliveryFee?: string;
    minOrder?: string;
  }>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Two fetch paths:
        //   - Admin path: route param shopId is set → fetch all shops
        //     (admin-only callable) and find by id. No per-id getter
        //     yet; matches the posture of UserDetailScreen and
        //     ShopDetailManagementScreen which also do list+find.
        //   - Shop owner path: no param → use getShopForOwner which
        //     reads the caller's claim's shopId server-side.
        let resolved: Shop | null = null;
        if (isAdminPath) {
          const allShops = await orderService.listAllShops();
          resolved = allShops.find(s => s.id === targetShopId) ?? null;
        } else {
          resolved = await orderService.getShopForOwner();
        }
        if (cancelled) return;
        setShop(resolved);
        if (resolved) {
          setDeliveryFeeStr(String(resolved.deliveryFee ?? 0));
          setMinOrderStr(String(resolved.minOrder ?? 0));
        }
      } catch (e: any) {
        if (cancelled) return;
        console.warn('[ShopSettings] load failed:', e);
        setLoadError(e?.message ?? 'Could not load shop settings');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAdminPath, targetShopId]);

  // Build the changed-fields payload. Numbers parse with Number()
  // (rejects empty strings via NaN check below). Integer-only enforced
  // here for friendlier client feedback; server re-validates.
  const { dirty, payload } = useMemo(() => {
    if (!shop) return { dirty: false, payload: {} as { deliveryFee?: number; minOrder?: number } };
    const next: { deliveryFee?: number; minOrder?: number } = {};
    const dfNum = Number(deliveryFeeStr);
    const moNum = Number(minOrderStr);
    if (Number.isFinite(dfNum) && Number.isInteger(dfNum) && dfNum !== shop.deliveryFee) {
      next.deliveryFee = dfNum;
    }
    if (Number.isFinite(moNum) && Number.isInteger(moNum) && moNum !== shop.minOrder) {
      next.minOrder = moNum;
    }
    return { dirty: Object.keys(next).length > 0, payload: next };
  }, [shop, deliveryFeeStr, minOrderStr]);

  // Light client-side validation — kept loose to avoid double-pinning
  // the server's policy. We only refuse obviously-broken inputs
  // (empty, NaN, negative). The hard range caps live on the server.
  function validateClient(): boolean {
    const next: { deliveryFee?: string; minOrder?: string } = {};
    const dfNum = Number(deliveryFeeStr);
    if (deliveryFeeStr.trim() === '' || !Number.isFinite(dfNum)) {
      next.deliveryFee = 'Enter a number';
    } else if (!Number.isInteger(dfNum)) {
      next.deliveryFee = 'Whole rupees only';
    } else if (dfNum < 0) {
      next.deliveryFee = 'Cannot be negative';
    }
    const moNum = Number(minOrderStr);
    if (minOrderStr.trim() === '' || !Number.isFinite(moNum)) {
      next.minOrder = 'Enter a number';
    } else if (!Number.isInteger(moNum)) {
      next.minOrder = 'Whole rupees only';
    } else if (moNum < 0) {
      next.minOrder = 'Cannot be negative';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSave() {
    if (!validateClient()) return;
    if (!dirty) {
      Alert.alert('No changes', 'Nothing to update.');
      return;
    }
    setSaving(true);
    try {
      // Admin path passes shopId (required by helper). Shop owner
      // path omits it (helper ignores; uses claim's shopId).
      await orderService.updateShopSettings({
        ...payload,
        ...(isAdminPath ? { shopId: targetShopId } : {}),
      });
      // Refetch to confirm the write took (and to display the
      // canonical server value if any normalization happened). Use
      // the same path as the initial load.
      let fresh: Shop | null = null;
      if (isAdminPath) {
        const allShops = await orderService.listAllShops();
        fresh = allShops.find(s => s.id === targetShopId) ?? null;
      } else {
        fresh = await orderService.getShopForOwner();
      }
      if (fresh) {
        setShop(fresh);
        setDeliveryFeeStr(String(fresh.deliveryFee ?? 0));
        setMinOrderStr(String(fresh.minOrder ?? 0));
      }
      Alert.alert('Saved', 'Shop settings updated.', [
        { text: 'OK', onPress: () => nav.goBack() },
      ]);
    } catch (e: any) {
      // The server's helper returns helpful messages — surface them
      // directly. e.message is already the helper's string (Firebase
      // wraps it as the HttpsError message).
      const msg =
        e?.message ?? 'Could not save settings. Please try again.';
      Alert.alert('Could not save', msg);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="Shop Settings" onBack={() => nav.goBack()} />
        <Loader fullScreen />
      </SafeAreaView>
    );
  }

  if (loadError || !shop) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="Shop Settings" onBack={() => nav.goBack()} />
        <EmptyState
          title="Could not load shop"
          subtitle={
            loadError ??
            (isAdminPath
              ? "Shop not found. It may have been deleted or is outside the 100-shop listAllShops cap."
              : "You don't seem to own a shop. Contact support if this is wrong.")
          }
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="Shop Settings" onBack={() => nav.goBack()} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.kavRoot}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.card}>
            <Text style={styles.shopName}>{shop.name}</Text>
            <Text style={styles.shopMeta}>{shop.address}</Text>
          </View>

          <View style={styles.card}>
            <View style={styles.field}>
              <Text style={styles.label}>Delivery fee (₹)</Text>
              <TextInput
                value={deliveryFeeStr}
                onChangeText={setDeliveryFeeStr}
                placeholder="0"
                keyboardType="number-pad"
                style={[
                  styles.input,
                  errors.deliveryFee ? styles.inputError : null,
                ]}
                placeholderTextColor={colors.textSecondary}
                accessibilityLabel="Delivery fee in rupees"
              />
              <Text
                style={errors.deliveryFee ? styles.errorText : styles.helpText}
              >
                {errors.deliveryFee ??
                  'Charged on every order. Set to 0 to offer free delivery.'}
              </Text>
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Minimum order (₹)</Text>
              <TextInput
                value={minOrderStr}
                onChangeText={setMinOrderStr}
                placeholder="0"
                keyboardType="number-pad"
                style={[
                  styles.input,
                  errors.minOrder ? styles.inputError : null,
                ]}
                placeholderTextColor={colors.textSecondary}
                accessibilityLabel="Minimum order amount in rupees"
              />
              <Text
                style={errors.minOrder ? styles.errorText : styles.helpText}
              >
                {errors.minOrder ??
                  'Customers must order at least this amount.'}
              </Text>
            </View>
          </View>

          <Button
            title={saving ? 'Saving…' : 'Save changes'}
            onPress={handleSave}
            loading={saving}
            disabled={saving || !dirty}
            size="lg"
          />
          <View style={{ height: spacing.md }} />
          <Button
            title="Cancel"
            variant="ghost"
            onPress={() => nav.goBack()}
            disabled={saving}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  kavRoot: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl ?? spacing.xl },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    ...shadow.card,
  },
  shopName: { ...typography.h3, color: colors.textPrimary },
  shopMeta: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 4,
  },

  field: { marginBottom: spacing.md },
  label: {
    ...typography.caption,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
  input: {
    backgroundColor: colors.bg,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...typography.body,
    color: colors.textPrimary,
  },
  inputError: { borderColor: colors.danger },
  helpText: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  errorText: {
    ...typography.caption,
    color: colors.danger,
    marginTop: spacing.xs,
  },
});
