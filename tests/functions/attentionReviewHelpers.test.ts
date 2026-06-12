/**
 * PR-NEXT-BUNDLE-I §D/§E — +8 tests for summarizeAttentionReviewRows.
 *
 * Deliberate-break demo:
 *   Remove the `.filter(d => d.data.correctionState === 'flagged_low')`
 *   → the "filters out non-flagged_low" test fails. Restore. Passes.
 */
import { summarizeAttentionReviewRows } from '../../functions/src/attentionReviewHelpers';

const mk = (id: string, data: Record<string, any>) => ({ id, data });

describe('summarizeAttentionReviewRows', () => {
  it('empty input → empty array', () => {
    expect(summarizeAttentionReviewRows([])).toEqual([]);
  });

  it('filters out non-flagged_low correctionStates', () => {
    const rows = summarizeAttentionReviewRows([
      mk('o1', { correctionState: 'flagged_low', updatedAt: 100 }),
      mk('o2', { correctionState: 'published', updatedAt: 200 }),
      mk('o3', { correctionState: 'responded', updatedAt: 300 }),
    ]);
    expect(rows.map(r => r.orderId)).toEqual(['o1']);
  });

  it('maps all expected fields', () => {
    const rows = summarizeAttentionReviewRows([
      mk('o1', {
        correctionState: 'flagged_low',
        shopName: 'Test Shop',
        deliveryRating: 2,
        deliveryComment: 'late',
        shopRating: 1,
        shopComment: 'bad',
        deliveredAt: 500,
        updatedAt: 600,
      }),
    ]);
    expect(rows[0]).toEqual({
      orderId: 'o1',
      shopName: 'Test Shop',
      deliveryRating: 2,
      deliveryComment: 'late',
      shopRating: 1,
      shopComment: 'bad',
      deliveredAt: 500,
      submittedAt: 600,
    });
  });

  it('missing fields → null defaults', () => {
    const rows = summarizeAttentionReviewRows([
      mk('o1', { correctionState: 'flagged_low' }),
    ]);
    expect(rows[0].shopName).toBeNull();
    expect(rows[0].deliveryRating).toBeNull();
    expect(rows[0].shopComment).toBeNull();
    expect(rows[0].submittedAt).toBeNull();
  });

  it('submittedAt falls back to deliveredAt when updatedAt missing', () => {
    const rows = summarizeAttentionReviewRows([
      mk('o1', { correctionState: 'flagged_low', deliveredAt: 777 }),
    ]);
    expect(rows[0].submittedAt).toBe(777);
  });

  it('sorts by submittedAt descending (most recent first)', () => {
    const rows = summarizeAttentionReviewRows([
      mk('a', { correctionState: 'flagged_low', updatedAt: 100 }),
      mk('b', { correctionState: 'flagged_low', updatedAt: 300 }),
      mk('c', { correctionState: 'flagged_low', updatedAt: 200 }),
    ]);
    expect(rows.map(r => r.orderId)).toEqual(['b', 'c', 'a']);
  });

  it('caps output at 50 rows', () => {
    const docs = Array.from({ length: 80 }, (_, i) =>
      mk(`o${i}`, { correctionState: 'flagged_low', updatedAt: i }),
    );
    expect(summarizeAttentionReviewRows(docs)).toHaveLength(50);
  });

  it('null submittedAt sorts last (treated as 0)', () => {
    const rows = summarizeAttentionReviewRows([
      mk('a', { correctionState: 'flagged_low' }),
      mk('b', { correctionState: 'flagged_low', updatedAt: 50 }),
    ]);
    expect(rows[0].orderId).toBe('b');
    expect(rows[1].orderId).toBe('a');
  });

  // HOTFIX-ATTENTION-CALLABLES-MISSING §E — dimension-aware secondary filter.
  describe('per-dimension filter (Bundle J §G)', () => {
    it("dimension 'shop' reads shopCorrectionState", () => {
      const rows = summarizeAttentionReviewRows(
        [
          mk('o1', { shopCorrectionState: 'flagged_low', updatedAt: 1 }),
          mk('o2', { shopCorrectionState: 'responded', updatedAt: 2 }),
        ],
        'shop',
      );
      expect(rows.map(r => r.orderId)).toEqual(['o1']);
    });

    it("dimension 'delivery' reads deliveryCorrectionState", () => {
      const rows = summarizeAttentionReviewRows(
        [
          mk('o1', { deliveryCorrectionState: 'flagged_low', updatedAt: 1 }),
          mk('o2', { deliveryCorrectionState: 'published', updatedAt: 2 }),
        ],
        'delivery',
      );
      expect(rows.map(r => r.orderId)).toEqual(['o1']);
    });

    // Deliberate-break demo (acceptance #10): shop 5★ + delivery 1★. The
    // order's legacy correctionState is the worst-of ('flagged_low'), but the
    // shop dimension is 'published'. The shop queue must NOT inherit it.
    it('shop 5★ + delivery 1★ → shop dimension sees count 0, delivery sees 1', () => {
      const order = mk('o1', {
        shopCorrectionState: 'published',
        deliveryCorrectionState: 'flagged_low',
        correctionState: 'flagged_low', // legacy worst-of
        updatedAt: 1,
      });
      expect(summarizeAttentionReviewRows([order], 'shop')).toHaveLength(0);
      expect(summarizeAttentionReviewRows([order], 'delivery')).toHaveLength(1);
    });

    it('omitting dimension falls back to legacy correctionState (back-compat)', () => {
      const rows = summarizeAttentionReviewRows([
        mk('o1', { correctionState: 'flagged_low', updatedAt: 1 }),
      ]);
      expect(rows.map(r => r.orderId)).toEqual(['o1']);
    });
  });
});
