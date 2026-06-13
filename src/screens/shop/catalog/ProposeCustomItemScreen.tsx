/**
 * PR-NEXT-BUNDLE-K §H — ProposeCustomItemScreen.
 *
 * Shop owner proposes a new product for the master catalog.
 * Calls `proposeMasterCatalogItem` → status 'pending' → admin reviews
 * via PendingCatalogQueueScreen. After approval the item appears in
 * every shop owner's browse screen.
 *
 * Validation mirrors `validateMasterCatalogProposal` in catalogHelpers.ts.
 */

import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { CATEGORIES } from '../../../constants/categories';
import type { CategoryId } from '../../../constants/categories';
import { colors, radii, spacing, typography } from '../../../constants/theme';
import { orderService } from '../../../services/orderService';
import type { RootStackParamList } from '../../../navigation/AppNavigator';

type NavProp = NativeStackNavigationProp<RootStackParamList>;

const PACK_UNITS = ['g', 'kg', 'ml', 'litre', 'piece', 'packet', 'dozen'];

export default function ProposeCustomItemScreen() {
  const navigation = useNavigation<NavProp>();

  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [category, setCategory] = useState<CategoryId>('atta_rice_dal');
  const [mrp, setMrp] = useState('');
  const [packValue, setPackValue] = useState('');
  const [packUnit, setPackUnit] = useState('g');
  const [submitting, setSubmitting] = useState(false);

  function validate(): string | null {
    if (!name.trim()) return 'Product name is required.';
    if (name.trim().length > 120) return 'Product name is too long (max 120 chars).';
    if (brand.trim().length > 60) return 'Brand name is too long (max 60 chars).';
    const mrpNum = parseFloat(mrp);
    if (!Number.isFinite(mrpNum) || mrpNum <= 0 || mrpNum > 99999) {
      return 'MRP must be a positive number (max ₹99999).';
    }
    const packNum = parseFloat(packValue);
    if (!Number.isFinite(packNum) || packNum <= 0) {
      return 'Pack size must be a positive number.';
    }
    return null;
  }

  async function handleSubmit() {
    const error = validate();
    if (error) {
      Alert.alert('Validation Error', error);
      return;
    }
    setSubmitting(true);
    try {
      const result = await orderService.proposeMasterCatalogItem({
        name: name.trim(),
        brand: brand.trim() || null,
        category,
        mrp: parseFloat(mrp),
        packSizeValue: parseFloat(packValue),
        packSizeUnit: packUnit,
      });
      Alert.alert(
        'Proposal Submitted!',
        `Your item "${name.trim()}" has been submitted for review. You'll be able to add it to your menu once approved (usually within 24 hours).`,
        [
          {
            text: 'OK',
            onPress: () => navigation.goBack(),
          },
        ],
      );
      void result;
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Could not submit proposal');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Propose New Item</Text>
      </View>

      <ScrollView contentContainerStyle={styles.form}>
        <Text style={styles.infoText}>
          Submit a new product for our catalog. Once approved by our team, it
          will be available for all shop owners to add to their menus.
        </Text>

        {/* Name */}
        <View style={styles.field}>
          <Text style={styles.label}>Product Name *</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="e.g. Tata Salt"
            maxLength={120}
            returnKeyType="next"
          />
        </View>

        {/* Brand */}
        <View style={styles.field}>
          <Text style={styles.label}>Brand (optional)</Text>
          <TextInput
            style={styles.input}
            value={brand}
            onChangeText={setBrand}
            placeholder="e.g. Tata"
            maxLength={60}
            returnKeyType="next"
          />
        </View>

        {/* Category */}
        <View style={styles.field}>
          <Text style={styles.label}>Category *</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.categoryRow}
          >
            {CATEGORIES.map(cat => (
              <Pressable
                key={cat.id}
                style={[
                  styles.catChip,
                  category === cat.id && styles.catChipActive,
                ]}
                onPress={() => setCategory(cat.id)}
              >
                <Text
                  style={[
                    styles.catChipText,
                    category === cat.id && styles.catChipTextActive,
                  ]}
                >
                  {cat.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        {/* MRP */}
        <View style={styles.field}>
          <Text style={styles.label}>MRP (₹) *</Text>
          <View style={styles.inputRow}>
            <Text style={styles.rupee}>₹</Text>
            <TextInput
              style={[styles.input, styles.inputFlex]}
              value={mrp}
              onChangeText={setMrp}
              placeholder="e.g. 25"
              keyboardType="numeric"
              returnKeyType="next"
            />
          </View>
        </View>

        {/* Pack size */}
        <View style={styles.field}>
          <Text style={styles.label}>Pack Size *</Text>
          <View style={styles.packRow}>
            <TextInput
              style={[styles.input, styles.packValueInput]}
              value={packValue}
              onChangeText={setPackValue}
              placeholder="e.g. 500"
              keyboardType="numeric"
              returnKeyType="done"
            />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.unitRow}
            >
              {PACK_UNITS.map(u => (
                <Pressable
                  key={u}
                  style={[
                    styles.unitChip,
                    packUnit === u && styles.unitChipActive,
                  ]}
                  onPress={() => setPackUnit(u)}
                >
                  <Text
                    style={[
                      styles.unitChipText,
                      packUnit === u && styles.unitChipTextActive,
                    ]}
                  >
                    {u}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>

        {/* Submit */}
        <Pressable
          style={[styles.submitBtn, submitting && styles.submitBtnDisabled]}
          onPress={handleSubmit}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color={colors.bg} />
          ) : (
            <Text style={styles.submitBtnText}>Submit Proposal</Text>
          )}
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: 50,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: { padding: spacing.sm },
  backText: { ...typography.body, color: colors.info },
  headerTitle: { ...typography.h2, flex: 1, textAlign: 'center' },
  form: { padding: spacing.lg, gap: spacing.lg, paddingBottom: 60 },
  infoText: {
    ...typography.body,
    color: colors.textSecondary,
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: radii.sm,
  },
  field: { gap: spacing.xs },
  label: { ...typography.bodyBold },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...typography.body,
    backgroundColor: colors.bg,
  },
  inputFlex: { flex: 1 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rupee: { ...typography.h2, color: colors.primary },
  categoryRow: { gap: spacing.sm, paddingVertical: spacing.xs },
  catChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.bg,
  },
  catChipActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  catChipText: { ...typography.caption, color: colors.textSecondary },
  catChipTextActive: { color: colors.primary, fontWeight: '700' },
  packRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  packValueInput: { width: 100 },
  unitRow: { gap: spacing.xs, paddingVertical: spacing.xs },
  unitChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.bg,
  },
  unitChipActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  unitChipText: { ...typography.caption, color: colors.textSecondary },
  unitChipTextActive: { color: colors.primary, fontWeight: '700' },
  submitBtn: {
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  submitBtnDisabled: { opacity: 0.5 },
  submitBtnText: { ...typography.bodyBold, color: colors.bg, fontSize: 16 },
});
