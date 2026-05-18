import { useNavigation } from '@react-navigation/native';
import React, { useState } from 'react';
import {
    Alert,
    Pressable,
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    TextInput,
    View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Button from '../../components/common/Button';
import ScreenHeader from '../../components/common/ScreenHeader';
import { CATEGORIES, CategoryId } from '../../constants/categories';
import { colors, radii, shadow, spacing, typography } from '../../constants/theme';
import { orderService } from '../../services/orderService';
// PR 6 — image upload pipeline. DO NOT REMOVE: auto-formatter has
// stripped these in past PRs (1, 2, 4, 5, 6) and once already during
// PR 6 itself. If tsc complains about useAuthStore /
// pickAndResizeImage / uploadMenuImage, re-add these three lines.

/**
 * Form to add a new CUSTOM menu item to the shop owner's menu.
 * Server-side validation is the source of truth (see addCustomMenuItem
 * in functions/src/index.ts); this screen just provides quick inline
 * checks so the user doesn't have to round-trip for obvious errors
 * like empty name or mrp < price.
 *
 * Image upload is URL-only in MVP — the prelaunch checklist tracks the
 * follow-up to wire Firebase Storage and an in-app camera/gallery
 * picker.
 */
export default function AddCustomMenuItemScreen() {
  const nav = useNavigation<any>();
  const [name, setName] = useState('');
  const [priceStr, setPriceStr] = useState('');
  const [mrpStr, setMrpStr] = useState('');
  const [packLabel, setPackLabel] = useState('');
  const [category, setCategory] = useState<CategoryId>('atta_rice_dal');
  const [imageUrl, setImageUrl] = useState('');
  const [stockUnlimited, setStockUnlimited] = useState(true);
  const [stockStr, setStockStr] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const trimmedName = name.trim();
    const price = Number(priceStr);
    const mrp = Number(mrpStr);
    if (!trimmedName) {
      Alert.alert('Name required', 'Please enter a name for this item.');
      return;
    }
    if (!Number.isFinite(price) || price <= 0) {
      Alert.alert('Invalid price', 'Price must be a positive number.');
      return;
    }
    if (!Number.isFinite(mrp) || mrp < price) {
      Alert.alert('Invalid MRP', 'MRP must be greater than or equal to price.');
      return;
    }
    if (!packLabel.trim()) {
      Alert.alert('Pack required', 'Please enter a pack label like "1 kg" or "500 ml".');
      return;
    }
    let stock: number | null = null;
    if (!stockUnlimited) {
      const n = Number(stockStr);
      if (!Number.isFinite(n) || n < 0) {
        Alert.alert(
          'Invalid stock',
          'Enter a non-negative number, or turn on Unlimited stock.',
        );
        return;
      }
      stock = n;
    }

    setSaving(true);
    try {
      await orderService.addCustomMenuItem({
        name: trimmedName,
        price,
        mrp,
        packLabel: packLabel.trim(),
        category,
        imageUrl: imageUrl.trim() || undefined,
        stock,
      });
      // Pop back to ShopMenuScreen, which refetches on focus.
      nav.goBack();
    } catch (e: any) {
      Alert.alert('Could not add item', e?.message || 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="Add custom item" onBack={() => nav.goBack()} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Field label="Name *">
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="e.g. Fresh paneer (250 g)"
              style={styles.input}
              placeholderTextColor={colors.textSecondary}
            />
          </Field>
          <Field label="Pack *">
            <TextInput
              value={packLabel}
              onChangeText={setPackLabel}
              placeholder='e.g. "250 g" or "1 L"'
              style={styles.input}
              placeholderTextColor={colors.textSecondary}
            />
          </Field>
          <Field label="Image URL (optional)">
            <TextInput
              value={imageUrl}
              onChangeText={setImageUrl}
              placeholder="https://… (placeholder used if blank)"
              style={styles.input}
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </Field>
          <Field label="Category *">
            <View style={styles.categoryGrid}>
              {CATEGORIES.map(c => (
                <Pressable
                  key={c.id}
                  onPress={() => setCategory(c.id)}
                  style={[
                    styles.categoryChip,
                    c.id === category && styles.categoryChipActive,
                  ]}
                  accessibilityRole="button"
                >
                  <Text
                    style={[
                      styles.categoryChipText,
                      c.id === category && styles.categoryChipTextActive,
                    ]}
                  >
                    {c.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </Field>
        </View>

        <View style={styles.card}>
          <Field label="Price (₹) *">
            <TextInput
              value={priceStr}
              onChangeText={setPriceStr}
              placeholder="0"
              keyboardType="decimal-pad"
              style={styles.input}
              placeholderTextColor={colors.textSecondary}
            />
          </Field>
          <Field label="MRP (₹) *">
            <TextInput
              value={mrpStr}
              onChangeText={setMrpStr}
              placeholder="0"
              keyboardType="decimal-pad"
              style={styles.input}
              placeholderTextColor={colors.textSecondary}
            />
          </Field>
          <Text style={styles.helper}>
            MRP must be ≥ price. Customers see "Save ₹X" badges when MRP
            is higher.
          </Text>
        </View>

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

        <Button
          title={saving ? 'Saving…' : 'Add to menu'}
          onPress={handleSave}
          loading={saving}
          disabled={saving}
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
  // PR 6 — image preview + button styles.
  imagePreview: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: radii.sm,
    backgroundColor: colors.bg,
    marginBottom: spacing.sm,
  },
  imagePlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
  },
  placeholderText: { ...typography.caption, color: colors.textMuted },
  imageButtonsRow: { flexDirection: 'row', gap: spacing.sm },
  imageButtonCell: { flex: 1 },
});
