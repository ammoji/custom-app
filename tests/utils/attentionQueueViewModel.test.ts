/**
 * HOTFIX-RESPOND-OWNER-AND-CARD-NAV §D — +5 tests pinning
 * buildAttentionQueueRows (delivery vs shop dimension, empty input,
 * 80-char excerpt cap, and the days-left countdown clamp).
 */
import { buildAttentionQueueRows } from '../../src/utils/attentionQueueViewModel';

const NOW = 1_000_000_000_000;
const DAY = 86_400_000;

describe('buildAttentionQueueRows', () => {
  it('delivery role uses deliveryRating + deliveryComment', () => {
    const rows = buildAttentionQueueRows(
      'delivery',
      [
        {
          orderId: 'o1',
          shopName: 'Shop One',
          deliveryRating: 2,
          deliveryComment: 'Late delivery',
          shopRating: 5,
          shopComment: 'Great food',
          submittedAt: NOW - DAY,
        },
      ],
      NOW,
    );
    expect(rows[0].ratingStars).toBe(2);
    expect(rows[0].commentExcerpt).toBe('Late delivery');
    expect(rows[0].shopName).toBe('Shop One');
  });

  it('shop role uses shopRating + shopComment', () => {
    const rows = buildAttentionQueueRows(
      'shop',
      [
        {
          orderId: 'o1',
          shopName: 'Shop One',
          deliveryRating: 2,
          deliveryComment: 'Late delivery',
          shopRating: 1,
          shopComment: 'Cold food',
          submittedAt: NOW - DAY,
        },
      ],
      NOW,
    );
    expect(rows[0].ratingStars).toBe(1);
    expect(rows[0].commentExcerpt).toBe('Cold food');
  });

  it('returns an empty array for empty input', () => {
    expect(buildAttentionQueueRows('shop', [], NOW)).toEqual([]);
  });

  it('caps the comment excerpt at 80 chars with an ellipsis', () => {
    const long = 'x'.repeat(200);
    const rows = buildAttentionQueueRows(
      'shop',
      [{ orderId: 'o1', shopRating: 1, shopComment: long, submittedAt: NOW }],
      NOW,
    );
    expect(rows[0].commentExcerpt).toBe('x'.repeat(80) + '…');
  });

  it('clamps daysLeft at 0 for reviews older than 7 days; null when no submittedAt', () => {
    const rows = buildAttentionQueueRows(
      'shop',
      [
        { orderId: 'old', shopRating: 1, submittedAt: NOW - 10 * DAY },
        { orderId: 'fresh', shopRating: 1, submittedAt: NOW - 2 * DAY },
        { orderId: 'unknown', shopRating: 1, submittedAt: null },
      ],
      NOW,
    );
    expect(rows[0].daysLeft).toBe(0);
    expect(rows[1].daysLeft).toBe(5);
    expect(rows[2].daysLeft).toBeNull();
    expect(rows[0].commentExcerpt).toBeNull();
  });
});
