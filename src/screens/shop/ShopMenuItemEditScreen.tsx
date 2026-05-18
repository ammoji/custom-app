import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import React, { useEffect, useMemo, useState } from 'react';
import {
    Alert,
    Image,
    Pressable,
    ScrollView,
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
import { CATEGORIES, CategoryId } from '../../constants/categories';
import { colors, radii, shadow, spacing, typography } from '../../constants/theme';
import type { RootStackParamList } from '../../navigation/AppNavigator';
import { orderService } from '../../services/orderService';
import { uploadMenuImage } from '../../services/storage';
import { useAuthStore } from '../../store/useAuthStore';
import type { MenuItem } from '../../types';
import { pickAndResizeImage } from '../../utils/imageUpload';

/**
 * Edit a single menu item. The form is reactive to `isCustom`:
 *   - GLOBAL: only price / available / stock fields are exposed.
 *             Name, image, pack, category are read-only because
 *             they're inherited from the global product catalog and
 *             changing them per-shop would break cross-shop comparisons.
 *   - CUSTOM: every field is editable + a Delete button is shown.
 *
 * We re-fetch the item on mount via listMyShopMenu (no getMenuItem
 * callable yet — the list is small and avoiding a new endpoint is
 * worth the marginal extra read). The Save button only sends fields
 * that actually changed to keep the server validation diff small.
 */
export default function ShopMenuItemEditScreen() {
  const nav = useNavigation<any>();
  const route =
    useRoute<RouteProp<RootStackParamList, 'ShopMenuItemEdit'>>();
  const { menuItemId } = route.params;

  const [item, setItem] = useState<MenuItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  // PR 6 — image upload state. Only used in the CUSTOM branch; GLOBAL
  // items inherit their image from the catalog and have no image
  // picker.
  const [uploading, setUploading] = useState(false);
  const shopId = useAuthStore(s => s.shopId);

  // Editable form state. We keep price/mrp as strings while editing
  // so the user can type "" and "12." mid-input without losing focus
  // due to NaN parses.
  const [priceStr, setPriceStr] = useState('');
  const [mrpStr, setMrpStr] = useState('');
  const [stockStr, setStockStr] = useState('');
  const [stockUnlimited, setStockUnlimited] = useState(true);
  const [available, setAvailable] = useState(true);
  // Custom-only fields.
  const [name, setName] = useState('');
  const [packLabel, setPackLabel] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [category, setCategory] = useState<CategoryId>('atta_rice_dal');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await orderService.listMyShopMenu();
        if (cancelled) return;
        const found = list.find(i => i.id === menuItemId) ?? null;
        setItem(found);
        if (found) {
          setPriceStr(String(found.price));
          setMrpStr(String(found.mrp));
          setStockStr(found.stock === null ? '' : String(found.stock));
          setStockUnlimited(found.stock === null);
          setAvailable(found.available);
          setName(found.name);
          setPackLabel(found.packLabel);
          setImageUrl(found.imageUrl);
          setCategory(found.category);
        }
      } catch (e) {
        console.warn('[ShopMenuItemEdit] fetch failed:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [menuItemId]);

  // Compute the diff vs. the loaded item. Only include fields that
  // actually changed; the server's whitelist enforcement will reject
  // anything outside the allowed set, so this also serves as a sanity
  // check on what we attempt to send.
  const dirtyFields = useMemo(() => {
    if (!item) return null;
    const fields: Record<string, unknown> = {};
    const priceNum = Number(priceStr);
    const mrpNum = Number(mrpStr);
    if (Number.isFinite(priceNum) && priceNum !== item.price) {
      fields.price = priceNum;
    }
    if (available !== item.available) fields.available = available;
    const nextStock = stockUnlimited
      ? null
      : Number.isFinite(Number(stockStr))
        ? Number(stockStr)
        : item.stock;
    if (nextStock !== item.stock) fields.stock = nextStock;

    if (item.isCustom) {
      if (Number.isFinite(mrpNum) && mrpNum !== item.mrp) fields.mrp = mrpNum;
      if (name.trim() && name.trim() !== item.name) fields.name = name.trim();
      if (packLabel.trim() && packLabel.trim() !== item.packLabel) {
        fields.packLabel = packLabel.trim();
      }
      if (imageUrl.trim() && imageUrl.trim() !== item.imageUrl) {
        fields.imageUrl = imageUrl.trim();
      }
      if (category !== item.category) fields.category = category;
    }
    return fields;
  }, [
    item,
    priceStr,
    mrpStr,
    stockStr,
    stockUnlimited,
    available,
    name,
    packLabel,
    imageUrl,
    category,
  ]);

  const hasChanges =
    dirtyFields !== null && Object.keys(dirtyFields).length > 0;

  // PR 6 — image picker handler for CUSTOM items. Same shape as the
  // one in AddCustomMenuItemScreen — extracted to a screen-local
  // function rather than a shared hook because the only state it
  // touches is local (setImageUrl, setUploading) and the dirty-fields
  // diff machinery is also local.
  const handlePick = async (source: 'camera' | 'gallery') => {
    if (!shopId) {
      Alert.alert(
        'Not signed in as shop owner',
        'Sign out and back in, then try again.',
      );
      return;
    }
    const picked = await pickAndResizeImage(source);
    if (!picked.ok) {
      if (picked.reason === 'cancelled') return;
      Alert.alert('Could not pick image', picked.message ?? picked.reason);
      return;
    }
    setUploading(true);
    try {
      const url = await uploadMenuImage({ shopId, localUri: picked.uri });
      setImageUrl(url);
    } catch (e: any) {
      Alert.alert('Upload failed', e?.message ?? 'Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    if (!item || !dirtyFields) return;
    if (Object.keys(dirtyFields).length === 0) {
      nav.goBack();
      return;
    }
    // Client-side guard before round-trip so the user sees errors fast.
    const nextPrice = (dirtyFields.price as number | undefined) ?? item.price;
    const nextMrp = (dirtyFields.mrp as number | undefined) ?? item.mrp;
    if (nextPrice <= 0) {
      Alert.alert('Invalid price', 'Price must be greater than zero.');
      return;
    }
    if (nextMrp < nextPrice) {
      Alert.alert('Invalid MRP', 'MRP must be greater than or equal to price.');
      return;
    }
    setSaving(true);
    try {
      await orderService.updateMenuItem({
        menuItemId: item.id,
        fields: dirtyFields,
      });
      nav.goBack();
    } catch (e: any) {
      Alert.alert('Save failed', e?.message || 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    if (!item) return;
    const isCustom = item.isCustom;
    Alert.alert(
      isCustom ? 'Delete custom item?' : 'Disable this item?',
      isCustom
        ? `${item.name} will be removed from your menu permanently.`
        : `${item.name} will be marked unavailable. You can re-enable it later from the menu list.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: isCustom ? 'Delete' : 'Disable',
          style: 'destructive',
          onPress: async () => {
            setRemoving(true);
            try {
              await orderService.removeMenuItem({ menuItemId: item.id });
              nav.goBack();
            } catch (e: any) {
              Alert.alert(
                'Action failed',
                e?.message || 'Please try again.',
              );
            } finally {
              setRemoving(false);
            }
          },
        },
      ],
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="Edit item" onBack={() => nav.goBack()} />
        <Loader fullScreen />
      </SafeAreaView>
    );
  }
  if (!item) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="Edit item" onBack={() => nav.goBack()} />
        <EmptyState
          title="Menu item not found"
          subtitle="It may have been deleted or you no longer own this shop."
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader
        title={item.isCustom ? 'Edit custom item' : 'Edit item'}
        onBack={() => nav.goBack()}
      />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Image source={{ uri: item.imageUrl }} style={styles.heroImage} />
          {!item.isCustom && (
            <View style={styles.lockedBadge}>
              <Text style={styles.lockedText}>
                🔒 Global item — name, image, pack and category are
                inherited from the catalog. Edit price, availability or
                stock below.
              </Text>
            </View>
          )}
        </View>

        {/* Custom-only editable fields */}
        {item.isCustom && (
          <View style={styles.card}>
            <Field label="Name">
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Item name"
                style={styles.input}
                placeholderTextColor={colors.textSecondary}
              />
            </Field>
            <Field label="Pack">
              <TextInput
                value={packLabel}
                onChangeText={setPackLabel}
                placeholder='e.g. "1 kg" or "500 ml"'
                style={styles.input}
                placeholderTextColor={colors.textSecondary}
              />
            </Field>
            {/* PR 6 — image picker replaces URL text input (custom
                items only). Server rejects external URLs via
                validateMenuImageUrl, so the picker is the only path
                to set/replace the image. */}
            <Field label="Image">
              {imageUrl ? (
                <Image
                  source={{ uri: imageUrl }}
                  style={styles.imageEditPreview}
                  accessibilityLabel="Current menu item image"
                />
              ) : (
                <View
                  style={[
                    styles.imageEditPreview,
                    styles.imageEditPlaceholder,
                  ]}
                >
                  <Text style={styles.imageEditPlaceholderText}>
                    No image
                  </Text>
                </View>
              )}
              <View style={styles.imageEditButtonsRow}>
                <View style={styles.imageEditButtonCell}>
                  <Button
                    title="📷 Take photo"
                    variant="secondary"
                    onPress={() => handlePick('camera')}
                    disabled={uploading || saving}
                    loading={uploading}
                  />
                </View>
                <View style={styles.imageEditButtonCell}>
                  <Button
                    title="🖼️ Gallery"
                    variant="secondary"
                    onPress={() => handlePick('gallery')}
                    disabled={uploading || saving}
                  />
                </View>
              </View>
            </Field>
            <Field label="Category">
              <CategoryPicker
                value={category}
                onChange={setCategory}
              />
            </Field>
          </View>
        )}

        {/* Price + MRP */}
        <View style={styles.card}>
          <Field label="Price (₹)">
            <TextInput
              value={priceStr}
              onChangeText={setPriceStr}
              placeholder="0"
              keyboardType="decimal-pad"
              style={styles.input}
              placeholderTextColor={colors.textSecondary}
            />
          </Field>
          <Field label="MRP (₹)">
            <TextInput
              value={mrpStr}
              onChangeText={setMrpStr}
              editable={item.isCustom}
              placeholder="0"
              keyboardType="decimal-pad"
              style={[styles.input, !item.isCustom && styles.inputDisabled]}
              placeholderTextColor={colors.textSecondary}
            />
          </Field>
          {!item.isCustom && (
            <Text style={styles.helper}>
              MRP comes from the global catalog and isn't editable per
              shop.
            </Text>
          )}
        </View>

        {/* Availability */}
        <View style={styles.card}>
          <View style={styles.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.toggleLabel}>Available</Text>
              <Text style={styles.helper}>
                Off = customers won't see this item but its price /
                stock settings are kept for later.
              </Text>
            </View>
            <Switch value={available} onValueChange={setAvailable} />
          </View>
        </View>

        {/* Stock */}
        <View style={styles.card}>
          <View style={styles.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.toggleLabel}>Unlimited stock</Text>
              <Text style={styles.helper}>
                Turn off to enter a numeric stock count.
              </Text>
            </View>
            <Switch
              value={stockUnlimited}
              onValueChange={v => {
                setStockUnlimited(v);
                if (v) setStockStr('');
              }}
            />
          </View>
          {!stockUnlimited && (
            <Field label="Stock count">
              <TextInput
                value={stockStr}
                onChangeText={setStockStr}
                placeholder="e.g. 25"
                keyboardType="number-pad"
                style={styles.input}
                placeholderTextColor={colors.textSecondary}
              />
            </Field>
          )}
        </View>

        <View style={{ marginTop: spacing.md }}>
          <Button
            title={
              saving
                ? 'Saving…'
                : hasChanges
                  ? 'Save changes'
                  : 'No changes'
            }
            onPress={handleSave}
            loading={saving}
            disabled={saving || removing || !hasChanges}
            size="lg"
          />
        </View>
        <View style={{ height: spacing.md }} />
        <Button
          title={
            item.isCustom ? 'Delete this item' : 'Disable this item'
          }
          onPress={handleDelete}
          variant="ghost"
          loading={removing}
          disabled={saving || removing}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

function CategoryPicker({
  value,
  onChange,
}: {
  value: CategoryId;
  onChange: (next: CategoryId) => void;
}) {
  return (
    <View style={styles.categoryGrid}>
      {CATEGORIES.map(c => (
        <Pressable
          key={c.id}
          onPress={() => onChange(c.id)}
          style={[
            styles.categoryChip,
            c.id === value && styles.categoryChipActive,
          ]}
          accessibilityRole="button"
        >
          <Text
            style={[
              styles.categoryChipText,
              c.id === value && styles.categoryChipTextActive,
            ]}
          >
            {c.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
    ...shadow.card,
  },
  heroImage: {
    width: '100%',
    height: 180,
    borderRadius: radii.md,
    backgroundColor: colors.bg,
    marginBottom: spacing.md,
  },
  lockedBadge: {
    backgroundColor: colors.warning + '11',
    borderColor: colors.warning,
    borderWidth: 1,
    borderRadius: radii.sm,
    padding: spacing.sm,
  },
  lockedText: { ...typography.caption, color: colors.textPrimary },
  fieldLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
  input: {
    backgroundColor: colors.bg,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    minHeight: 40,
    ...typography.body,
    color: colors.textPrimary,
  },
  inputDisabled: { opacity: 0.5 },
  helper: { ...typography.caption, color: colors.textSecondary, marginTop: 4 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  toggleLabel: { ...typography.bodyBold },
  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  categoryChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  categoryChipActive: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  categoryChipText: { ...typography.caption, color: colors.textSecondary },
  categoryChipTextActive: { color: colors.primaryDark, fontWeight: '700' },
  // PR 6 — image picker styles (custom-only branch).
  imageEditPreview: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: radii.sm,
    backgroundColor: colors.bg,
    marginBottom: spacing.sm,
  },
  imageEditPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
  },
  imageEditPlaceholderText: {
    ...typography.caption,
    color: colors.textMuted,
  },
  imageEditButtonsRow: { flexDirection: 'row', gap: spacing.sm },
  imageEditButtonCell: { flex: 1 },
});
