import { useNavigation } from '@react-navigation/native';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import React, { useMemo, useState } from 'react';
import {
    Alert,
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
import Loader from '../../components/common/Loader';
import ScreenHeader from '../../components/common/ScreenHeader';
// PR 32 — DO NOT REMOVE. expo-image-picker + expo-image-manipulator
// are the photo-pick + resize pipeline; if the auto-formatter strips
// either, every pick path in this screen explodes. Same risk pattern
// as `AddCustomMenuItemScreen` (PR 6) and `RegisterShopScreen`
// (PR 31), both of which have the same defensive comment.
import { CATEGORIES, CategoryId } from '../../constants/categories';
import { colors, radii, shadow, spacing, typography } from '../../constants/theme';
import { usePressGuard } from '../../hooks/usePressGuard';
import { Analytics } from '../../services/analytics';
import { orderService } from '../../services/orderService';
import { Sentry } from '../../services/sentry';
import type { ExtractedMenuDraft, ExtractedMenuItem } from '../../types';

/**
 * PR 32 — AI photo-to-catalog wizard.
 *
 * Four phases, all driven by the `phase` state below:
 *
 *   1. `pick`     — initial. Two CTAs (camera, gallery) + a short
 *                   blurb explaining the flow.
 *   2. `processing` — image picked. Resize to 1024px longest edge
 *                   via ImageManipulator, base64-encode, send to
 *                   `extractMenuFromImage`. Progressive copy keeps
 *                   the ~15s Claude wait from feeling stuck.
 *   3. `review`   — got drafts back. Each row is a card with
 *                   include-checkbox + editable name/pack/MRP/sell
 *                   + category picker + confidence chip. Bottom
 *                   CTA "Add N items to menu" commits the subset.
 *   4. `committing` — calling `addExtractedMenuItems`. On success
 *                   pop back; ShopMenuScreen refetches on focus.
 *
 * All `useState` calls live ABOVE any conditional early return —
 * required by Rules-of-Hooks (PR 27 lesson, restated in PR 31.1).
 * The commit CTA is wrapped in `usePressGuard` so a frantic
 * double-tap can't fire two batch writes (PR 27 lesson).
 *
 * Cost guardrails live entirely on the server — the screen renders
 * whatever error message the callable returns. We deliberately
 * don't pre-check the daily quota on the client; the source of
 * truth is the Firestore counter inside the server's transaction.
 */
export default function ScanMenuScreen() {
  const nav = useNavigation<any>();

  // All useState declarations live here — above any early return —
  // to keep the hook call order stable across render paths.
  const [phase, setPhase] = useState<
    'pick' | 'processing' | 'review' | 'committing'
  >('pick');
  const [progressCopy, setProgressCopy] = useState(
    'Compressing photo…',
  );
  const [drafts, setDrafts] = useState<ExtractedMenuDraft[]>([]);
  const [usageToday, setUsageToday] = useState<{
    used: number;
    quota: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedCount = useMemo(
    () => drafts.filter(d => d.selected).length,
    [drafts],
  );

  // ─── Phase 1 → 2: pick + send ──────────────────────────────
  const handlePick = async (source: 'camera' | 'gallery') => {
    setError(null);
    Analytics.scan_menu_started({ source });

    // Permission gate. Reuse the same pattern as `pickAndResizeImage`
    // but inline — we don't want the 1:1 square crop that helper
    // forces (rate-lists are rectangular).
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
          ? 'Allow camera access to photograph your rate-list.'
          : 'Allow photo library access to pick an image.',
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
        // No forced aspect ratio — rate-lists are tall/wide and
        // need to be captured whole. Editing on keeps the basic
        // crop affordance for users who want it.
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

    setPhase('processing');
    setProgressCopy('Compressing photo…');

    // Resize to 1024px longest edge, JPEG quality 0.7, return
    // base64 inline so we don't need expo-file-system as a new
    // dependency. ImageManipulator's `base64: true` flag is the
    // standard path. Target ~150–300 KB base64 for a clear photo.
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
      setPhase('pick');
      Alert.alert(
        'Image resize failed',
        e instanceof Error ? e.message : 'Please retake the photo.',
      );
      return;
    }
    if (!manipulated.base64) {
      setPhase('pick');
      Alert.alert(
        'Image encoding failed',
        'Please retake the photo and try again.',
      );
      return;
    }

    // Progressive copy: real Claude vision calls land at 10–20s.
    // Three sequential messages keep the user oriented during the
    // wait. Timers are cleared by `setPhase` away from processing.
    setProgressCopy('Reading your rate-list…');
    const t1 = setTimeout(
      () => setProgressCopy('Almost there — extracting items…'),
      6000,
    );
    const t2 = setTimeout(
      () => setProgressCopy('Hang tight, finishing up…'),
      14000,
    );

    try {
      const res = await orderService.extractMenuFromImage({
        imageBase64: manipulated.base64,
        imageMediaType: 'image/jpeg',
      });

      Analytics.scan_menu_extracted({
        item_count: res.items.length,
        dropped_count: res.droppedCount,
      });

      setUsageToday({ used: res.usedTodayCount, quota: res.dailyQuota });
      setDrafts(res.items.map(toDraft));
      setPhase('review');
    } catch (e: unknown) {
      // Errors from the callable arrive with a `code/message` we
      // surface verbatim — they're already shop-owner friendly.
      // Quota-exhausted, kill-switch, image-too-large, parse fails
      // all fall into this branch.
      const message =
        e instanceof Error ? e.message : 'Please try again.';
      // Don't capture quota / kill-switch in Sentry; those are
      // expected user-facing errors. Only true network/parse
      // failures get a Sentry breadcrumb so on-call sees them.
      Sentry.addBreadcrumb({
        category: 'scan-menu',
        level: 'warning',
        message: `extractMenuFromImage failed: ${message}`,
      });
      setError(message);
      setPhase('pick');
    } finally {
      clearTimeout(t1);
      clearTimeout(t2);
    }
  };

  // ─── Phase 3 helpers — draft mutations ─────────────────────
  const patchDraft = (
    tempId: string,
    patch: Partial<ExtractedMenuDraft>,
  ) => {
    setDrafts(curr =>
      curr.map(d => (d.tempId === tempId ? { ...d, ...patch } : d)),
    );
  };

  // ─── Phase 3 → 4: commit ──────────────────────────────────
  // Wrapped in usePressGuard (PR 27) to defeat fast double-tap;
  // without the guard, an impatient tap during the ~1s batch
  // commit can double-submit and create dup items.
  const handleCommit = usePressGuard(async () => {
    const approved = drafts.filter(d => d.selected);
    if (approved.length === 0) {
      Alert.alert(
        'Nothing selected',
        'Tick at least one item to add to your menu.',
      );
      return;
    }

    // Client-side gate matches the server's per-item validation
    // so the most common errors (missing price / mrp < price)
    // surface inline rather than as an opaque "skipped" count.
    for (const d of approved) {
      if (!d.editedName.trim()) {
        Alert.alert(
          'Missing name',
          'One of the selected items has a blank name. Fix it before adding.',
        );
        return;
      }
      if (!Number.isFinite(d.editedSellPrice) || d.editedSellPrice <= 0) {
        Alert.alert(
          'Invalid price',
          `"${d.editedName.trim()}" needs a sell price greater than 0.`,
        );
        return;
      }
      if (!Number.isFinite(d.editedMrp) || d.editedMrp < d.editedSellPrice) {
        Alert.alert(
          'Invalid MRP',
          `"${d.editedName.trim()}" — MRP must be ≥ sell price.`,
        );
        return;
      }
      if (!d.editedPackLabel.trim()) {
        Alert.alert(
          'Missing pack',
          `"${d.editedName.trim()}" needs a pack label like "1 kg".`,
        );
        return;
      }
    }

    setPhase('committing');
    try {
      const result = await orderService.addExtractedMenuItems({
        items: approved.map(d => ({
          name: d.editedName.trim(),
          price: d.editedSellPrice,
          mrp: d.editedMrp,
          packLabel: d.editedPackLabel.trim(),
          category: d.editedCategory,
        })),
      });

      Analytics.scan_menu_committed({
        added_count: result.added,
        skipped_count: result.skipped.length,
      });

      const skippedSummary =
        result.skipped.length > 0
          ? ` ${result.skipped.length} skipped (${result.skipped[0].reason}).`
          : '';
      Alert.alert(
        'Done',
        `Added ${result.added} item${result.added === 1 ? '' : 's'} to your menu.${skippedSummary}`,
        [
          {
            text: 'OK',
            onPress: () => nav.goBack(),
          },
        ],
      );
    } catch (e: unknown) {
      const message =
        e instanceof Error ? e.message : 'Please try again.';
      Sentry.addBreadcrumb({
        category: 'scan-menu',
        level: 'error',
        message: `addExtractedMenuItems failed: ${message}`,
      });
      Alert.alert('Could not add items', message);
      setPhase('review');
    }
  });

  // ─── Render ──────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="Scan rate-list" onBack={() => nav.goBack()} />
      {phase === 'pick' && (
        <PickPhase onPick={handlePick} error={error} />
      )}
      {phase === 'processing' && <ProcessingPhase copy={progressCopy} />}
      {phase === 'review' && (
        <ReviewPhase
          drafts={drafts}
          usageToday={usageToday}
          selectedCount={selectedCount}
          onPatch={patchDraft}
          onCommit={handleCommit}
        />
      )}
      {phase === 'committing' && (
        <ProcessingPhase copy="Adding items to your menu…" />
      )}
    </SafeAreaView>
  );
}

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

function toDraft(item: ExtractedMenuItem): ExtractedMenuDraft {
  // Stable per-row React key. Math.random + index lets the same
  // session re-pick without colliding with previous rows still on
  // the stack (unlikely but free to defend).
  const tempId = `draft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    ...item,
    tempId,
    selected: true,
    editedName: item.name,
    editedPackLabel: item.packSize,
    // When Claude returned null (illegible price), pre-fill with 0
    // and let the validator force the owner to edit before submit.
    editedMrp: item.mrp ?? 0,
    editedSellPrice: item.sellPrice ?? item.mrp ?? 0,
    editedCategory: item.category,
  };
}

// ──────────────────────────────────────────────────────────────
// Phase components
// ──────────────────────────────────────────────────────────────

function PickPhase({
  onPick,
  error,
}: {
  onPick: (source: 'camera' | 'gallery') => void;
  error: string | null;
}) {
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.heroCard}>
        <Text style={styles.heroEmoji}>📸</Text>
        <Text style={styles.heroTitle}>
          Photograph your rate-list. We&apos;ll read it.
        </Text>
        <Text style={styles.heroBody}>
          Take or pick a photo of your printed rate card, handwritten price
          list, or a shelf with prices marked. Our AI will extract the items
          and you&apos;ll review them before adding to your menu.
        </Text>
        <Text style={styles.heroBodyHint}>
          Tip: a flat, well-lit photo at arm&apos;s length works best.
        </Text>
      </View>
      {error ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}
      <View style={styles.pickerButtons}>
        <Button
          title="📷 Take photo"
          onPress={() => onPick('camera')}
          size="lg"
        />
        <View style={{ height: spacing.md }} />
        <Button
          title="🖼 Choose from gallery"
          onPress={() => onPick('gallery')}
          variant="secondary"
          size="lg"
        />
      </View>
    </ScrollView>
  );
}

function ProcessingPhase({ copy }: { copy: string }) {
  return (
    <View style={styles.processingWrap}>
      <Loader />
      <Text style={styles.processingText}>{copy}</Text>
      <Text style={styles.processingHint}>
        This usually takes 10–20 seconds. Please keep the app open.
      </Text>
    </View>
  );
}

function ReviewPhase({
  drafts,
  usageToday,
  selectedCount,
  onPatch,
  onCommit,
}: {
  drafts: ExtractedMenuDraft[];
  usageToday: { used: number; quota: number } | null;
  selectedCount: number;
  onPatch: (tempId: string, patch: Partial<ExtractedMenuDraft>) => void;
  onCommit: () => void;
}) {
  if (drafts.length === 0) {
    return (
      <View style={styles.emptyWrap}>
        <Text style={styles.emptyTitle}>No items found</Text>
        <Text style={styles.emptyBody}>
          We couldn&apos;t read any products from this photo. Try a clearer
          shot of your rate-list — flat, well-lit, with prices legible.
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.reviewRoot}>
      <View style={styles.reviewHeader}>
        <Text style={styles.reviewHeaderTitle}>
          AI found {drafts.length} item{drafts.length === 1 ? '' : 's'}
        </Text>
        <Text style={styles.reviewHeaderSubtitle}>
          Review and tap &quot;Add to menu&quot; when ready.
          {usageToday
            ? `  Used ${usageToday.used}/${usageToday.quota} scans today.`
            : ''}
        </Text>
      </View>
      <ScrollView contentContainerStyle={styles.reviewList}>
        {drafts.map(draft => (
          <DraftCard key={draft.tempId} draft={draft} onPatch={onPatch} />
        ))}
      </ScrollView>
      <View style={styles.reviewFooter}>
        <Button
          title={`Add ${selectedCount} item${selectedCount === 1 ? '' : 's'} to menu`}
          onPress={onCommit}
          disabled={selectedCount === 0}
          size="lg"
        />
      </View>
    </View>
  );
}

function DraftCard({
  draft,
  onPatch,
}: {
  draft: ExtractedMenuDraft;
  onPatch: (tempId: string, patch: Partial<ExtractedMenuDraft>) => void;
}) {
  return (
    <View style={[styles.draftCard, !draft.selected && styles.draftCardOff]}>
      <View style={styles.draftHeader}>
        <Switch
          value={draft.selected}
          onValueChange={v => onPatch(draft.tempId, { selected: v })}
        />
        <Text style={styles.draftHeaderText}>
          {draft.selected ? 'Include in batch' : 'Skip this item'}
        </Text>
        {draft.confidence === 'low' ? (
          <View style={styles.confidenceLow}>
            <Text style={styles.confidenceLowText}>⚠ Low</Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.fieldLabel}>Name</Text>
      <TextInput
        value={draft.editedName}
        onChangeText={t => onPatch(draft.tempId, { editedName: t })}
        style={styles.input}
        placeholder="e.g. Aashirvaad Atta"
      />
      <Text style={styles.fieldLabel}>Pack</Text>
      <TextInput
        value={draft.editedPackLabel}
        onChangeText={t => onPatch(draft.tempId, { editedPackLabel: t })}
        style={styles.input}
        placeholder="e.g. 5 kg"
      />
      <View style={styles.priceRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.fieldLabel}>MRP ₹</Text>
          <TextInput
            value={draft.editedMrp > 0 ? String(draft.editedMrp) : ''}
            onChangeText={t =>
              onPatch(draft.tempId, { editedMrp: Number(t) || 0 })
            }
            style={styles.input}
            keyboardType="numeric"
            placeholder="0"
          />
        </View>
        <View style={{ width: spacing.sm }} />
        <View style={{ flex: 1 }}>
          <Text style={styles.fieldLabel}>Sell ₹</Text>
          <TextInput
            value={
              draft.editedSellPrice > 0 ? String(draft.editedSellPrice) : ''
            }
            onChangeText={t =>
              onPatch(draft.tempId, { editedSellPrice: Number(t) || 0 })
            }
            style={styles.input}
            keyboardType="numeric"
            placeholder="0"
          />
        </View>
      </View>
      <Text style={styles.fieldLabel}>Category</Text>
      <View style={styles.categoryRow}>
        {CATEGORIES.map(cat => {
          const isActive = cat.id === draft.editedCategory;
          return (
            <Pressable
              key={cat.id}
              onPress={() =>
                onPatch(draft.tempId, { editedCategory: cat.id as CategoryId })
              }
              style={[
                styles.categoryChip,
                isActive && styles.categoryChipActive,
              ]}
            >
              <Text
                style={[
                  styles.categoryChipText,
                  isActive && styles.categoryChipTextActive,
                ]}
              >
                {cat.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ──────────────────────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────────────────────

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
  heroTitle: {
    ...typography.h2,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
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
  pickerButtons: { marginTop: spacing.md },
  processingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  processingText: {
    ...typography.h3,
    marginTop: spacing.lg,
    textAlign: 'center',
  },
  processingHint: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  emptyTitle: { ...typography.h2, marginBottom: spacing.sm },
  emptyBody: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  reviewRoot: { flex: 1 },
  reviewHeader: {
    padding: spacing.lg,
    paddingBottom: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  reviewHeaderTitle: { ...typography.h3 },
  reviewHeaderSubtitle: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  reviewList: { padding: spacing.lg, paddingBottom: spacing.xxl },
  draftCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
    ...shadow.card,
  },
  draftCardOff: { opacity: 0.55 },
  draftHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  draftHeaderText: { ...typography.caption, flex: 1 },
  confidenceLow: {
    backgroundColor: colors.danger + '22',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.sm,
  },
  confidenceLowText: {
    ...typography.caption,
    color: colors.danger,
    fontWeight: '700',
  },
  fieldLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '700',
    marginTop: spacing.sm,
    marginBottom: 4,
  },
  input: {
    backgroundColor: colors.bg,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    ...typography.body,
    color: colors.textPrimary,
  },
  priceRow: { flexDirection: 'row', marginTop: 0 },
  categoryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: 4,
  },
  categoryChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  categoryChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  categoryChipText: { ...typography.caption, color: colors.textPrimary },
  categoryChipTextActive: { color: '#fff', fontWeight: '700' },
  reviewFooter: {
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
});
