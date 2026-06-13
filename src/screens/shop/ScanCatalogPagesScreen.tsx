/**
 * PR-NEXT-BUNDLE-L §D — Scan filled catalog pages (paper workflow).
 *
 * The shopkeeper printed a blank catalog PDF (one page per category)
 * via "Print blank catalog" on BuildCatalogScreen, filled in the
 * "Your price" boxes by hand, and now photographs each filled page
 * here. Each page is OCR'd by `extractCatalogPagePrices` into
 * {productId, sellPrice} pairs; the merged results are turned into
 * `PriceDraft[]` and handed to the EXISTING Bundle K
 * CatalogReviewScreen for edit + commit. No new review surface — the
 * paper, voice, and inline-entry flows all converge on
 * `commitShopMenuItemsBulk`.
 *
 * Modeled on ScanMenuScreen (PR 32) but multi-photo: the user adds
 * one photo per category page, then taps "Process N pages". Pages are
 * OCR'd sequentially with a small gap to stay clear of Claude rate
 * limits. We deliberately do NOT scan the page QR on-device (would
 * require the expo-camera native module + a rebuild, breaking the OTA
 * path); the server identifies each page from the printed Item-ID
 * lines and validates extracted IDs against the approved catalog.
 *
 * All useState calls live above any early return (Rules-of-Hooks).
 */
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import React, { useState } from 'react';
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Button from '../../components/common/Button';
import Loader from '../../components/common/Loader';
import ScreenHeader from '../../components/common/ScreenHeader';
// PR-NEXT-BUNDLE-L — DO NOT REMOVE. expo-image-picker +
// expo-image-manipulator are the photo-pick + resize pipeline; same
// auto-formatter-strip risk as ScanMenuScreen (PR 32).
import { CATEGORIES } from '../../constants/categories';
import { colors, radii, shadow, spacing, typography } from '../../constants/theme';
import { orderService } from '../../services/orderService';
import { Sentry } from '../../services/sentry';
import {
  mergeScannedPrices,
  type ScannedPage,
} from '../../utils/catalogScanHelpers';
import type { MasterProduct, PriceDraft } from '../../types';
import type { RootStackParamList } from '../../navigation/AppNavigator';

type NavProp = NativeStackNavigationProp<RootStackParamList>;

type PickedPage = { uri: string; base64: string };

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export default function ScanCatalogPagesScreen() {
  const nav = useNavigation<NavProp>();

  const [phase, setPhase] = useState<'pick' | 'processing'>('pick');
  const [pages, setPages] = useState<PickedPage[]>([]);
  const [progressCopy, setProgressCopy] = useState('Reading pages…');
  const [error, setError] = useState<string | null>(null);

  // ─── Phase 1: add a page ───────────────────────────────────
  const handleAddPage = async (source: 'camera' | 'gallery') => {
    setError(null);
    const perm =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        source === 'camera'
          ? 'Camera permission required'
          : 'Photo library permission required',
        source === 'camera'
          ? 'Allow camera access to photograph your filled catalog pages.'
          : 'Allow photo library access to pick page photos.',
      );
      return;
    }

    let picked: ImagePicker.ImagePickerResult;
    try {
      const launcher =
        source === 'camera'
          ? ImagePicker.launchCameraAsync
          : ImagePicker.launchImageLibraryAsync;
      picked = await launcher({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.9,
      });
    } catch (e: unknown) {
      Alert.alert(
        'Image picker failed',
        e instanceof Error ? e.message : 'Please try again.',
      );
      return;
    }
    if (picked.canceled) return;
    const asset = picked.assets?.[0];
    if (!asset) {
      Alert.alert('Picker returned no image', 'Please try again.');
      return;
    }

    let manipulated;
    try {
      manipulated = await ImageManipulator.manipulateAsync(
        asset.uri,
        [{ resize: { width: 1024 } }],
        {
          compress: 0.7,
          format: ImageManipulator.SaveFormat.JPEG,
          base64: true,
        },
      );
    } catch (e: unknown) {
      Alert.alert(
        'Image resize failed',
        e instanceof Error ? e.message : 'Please retake the photo.',
      );
      return;
    }
    if (!manipulated.base64) {
      Alert.alert('Image encoding failed', 'Please retake the photo.');
      return;
    }
    setPages(prev => [...prev, { uri: manipulated.uri, base64: manipulated.base64! }]);
  };

  const handleRemovePage = (idx: number) => {
    setPages(prev => prev.filter((_, i) => i !== idx));
  };

  // ─── Load the approved catalog into a productId → MasterProduct
  //     map so we can build PriceDraft[] from the OCR'd IDs. Mirrors
  //     BuildCatalogScreen's per-category callable loop (native-safe).
  const loadCatalogMap = async (): Promise<Map<string, MasterProduct>> => {
    const map = new Map<string, MasterProduct>();
    const results = await Promise.all(
      CATEGORIES.map(async cat => {
        const res = await orderService.listMasterCatalogByCategory({
          category: cat.id,
          pageSize: 200,
        });
        return (res.items ?? []) as MasterProduct[];
      }),
    );
    results.forEach(items => {
      items.forEach(p => {
        if (p && p.id) map.set(p.id, p);
      });
    });
    return map;
  };

  // ─── Phase 2: process all pages ────────────────────────────
  const handleProcess = async () => {
    if (pages.length === 0) {
      Alert.alert('No pages', 'Add at least one filled page photo first.');
      return;
    }
    setError(null);
    setPhase('processing');

    try {
      setProgressCopy('Loading your catalog…');
      const catalogMap = await loadCatalogMap();

      const scanned: ScannedPage[] = [];
      for (let i = 0; i < pages.length; i += 1) {
        setProgressCopy(`Reading page ${i + 1} of ${pages.length}…`);
        // Sequential with a small gap to avoid Claude rate limits.
        const res = await orderService.extractCatalogPagePrices({
          pageImageBase64: pages[i].base64,
          imageMediaType: 'image/jpeg',
        });
        scanned.push({ prices: res.prices, droppedCount: res.droppedCount });
        if (i < pages.length - 1) {
          await sleep(500);
        }
      }

      const { merged } = mergeScannedPrices(scanned);
      const drafts: PriceDraft[] = [];
      for (const row of merged) {
        const product = catalogMap.get(row.productId);
        if (!product) continue; // unknown id (stale page) — skip
        drafts.push({ productId: row.productId, price: row.sellPrice, product });
      }

      if (drafts.length === 0) {
        setPhase('pick');
        setError(
          'No prices were read from these pages. Make sure the "Your price" boxes are filled clearly, then try again.',
        );
        return;
      }

      // Converge on the existing Bundle K review + commit flow.
      nav.navigate('CatalogReview', { drafts });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Please try again.';
      Sentry.addBreadcrumb({
        category: 'scan-catalog-pages',
        level: 'warning',
        message: `extractCatalogPagePrices failed: ${message}`,
      });
      setError(message);
      setPhase('pick');
    }
  };

  if (phase === 'processing') {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <ScreenHeader title="Scan filled catalog" />
        <View style={styles.processingWrap}>
          <Loader />
          <Text style={styles.processingText}>{progressCopy}</Text>
          <Text style={styles.processingHint}>
            Reading handwriting takes ~10–20 seconds per page. Please keep
            the app open.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="Scan filled catalog" onBack={() => nav.goBack()} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.heroCard}>
          <Text style={styles.heroEmoji}>📷</Text>
          <Text style={styles.heroTitle}>Photograph your filled pages</Text>
          <Text style={styles.heroBody}>
            Add one photo per category page you filled in. We&apos;ll read the
            handwritten prices and let you review them before adding to your
            menu.
          </Text>
          <Text style={styles.heroBodyHint}>
            Tip: a flat, well-lit photo with the price boxes clearly legible
            works best.
          </Text>
        </View>

        {error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {pages.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>
              {pages.length} page{pages.length === 1 ? '' : 's'} added
            </Text>
            <ScrollView horizontal contentContainerStyle={styles.thumbRow}>
              {pages.map((p, idx) => (
                <View key={`${p.uri}_${idx}`} style={styles.thumbWrap}>
                  <Image source={{ uri: p.uri }} style={styles.thumb} />
                  <Pressable
                    style={styles.thumbRemove}
                    onPress={() => handleRemovePage(idx)}
                  >
                    <Text style={styles.thumbRemoveText}>✕</Text>
                  </Pressable>
                  <Text style={styles.thumbLabel}>Page {idx + 1}</Text>
                </View>
              ))}
            </ScrollView>
          </>
        ) : null}

        <View style={styles.pickerButtons}>
          <Button
            title="📷 Add page (camera)"
            onPress={() => handleAddPage('camera')}
            size="lg"
          />
          <View style={{ height: spacing.md }} />
          <Button
            title="🖼 Add page (gallery)"
            onPress={() => handleAddPage('gallery')}
            variant="secondary"
            size="lg"
          />
        </View>
      </ScrollView>

      {pages.length > 0 ? (
        <View style={styles.footer}>
          <Button
            title={`Process ${pages.length} page${pages.length === 1 ? '' : 's'}`}
            onPress={handleProcess}
            size="lg"
          />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  heroCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow.card,
    marginBottom: spacing.lg,
    alignItems: 'center',
  },
  heroEmoji: { fontSize: 40, marginBottom: spacing.sm },
  heroTitle: { ...typography.h2, textAlign: 'center', marginBottom: spacing.sm },
  heroBody: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  heroBodyHint: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  errorCard: {
    backgroundColor: colors.danger + '11',
    borderLeftWidth: 4,
    borderLeftColor: colors.danger,
    borderRadius: radii.sm,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  errorText: { ...typography.body, color: colors.danger },
  sectionTitle: {
    ...typography.bodyBold,
    marginBottom: spacing.sm,
  },
  thumbRow: { gap: spacing.md, paddingBottom: spacing.md },
  thumbWrap: { alignItems: 'center' },
  thumb: {
    width: 90,
    height: 120,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  thumbRemove: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbRemoveText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  thumbLabel: { ...typography.caption, color: colors.textSecondary, marginTop: 4 },
  pickerButtons: { marginTop: spacing.md },
  footer: {
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  processingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  processingText: { ...typography.h3, marginTop: spacing.lg, textAlign: 'center' },
  processingHint: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
});
