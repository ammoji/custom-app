/**
 * PR-NEXT-BUNDLE-E §D/§E — tests for review moderation helpers.
 *
 * buildReviewTimeline (5): submitted-only / responded / amended /
 *   acknowledged (published, no amend) / timed-out.
 * filterReviewsForCaller (4): admin sees all / public sees published
 *   only / mixed-state filtering / empty.
 */
import { describe, expect, it } from '@jest/globals';
import {
  buildReviewTimeline,
  filterReviewsForCaller,
} from '../../functions/src/reviewModerationHelpers';

describe('buildReviewTimeline', () => {
  it('submitted-only → single event', () => {
    const t = buildReviewTimeline({
      submittedAt: 1000,
      shopStars: 2,
      deliveryStars: 5,
      shopComment: 'missing item',
      correctionState: 'flagged_low',
    });
    expect(t).toEqual([
      {
        type: 'submitted',
        at: 1000,
        shopStars: 2,
        deliveryStars: 5,
        comment: 'missing item',
      },
    ]);
  });

  it('responded → submitted + response in order', () => {
    const t = buildReviewTimeline({
      submittedAt: 1000,
      shopStars: 2,
      responseAt: 2000,
      responseText: 'Sorry, refunded',
      responseBy: 'shop',
      correctionState: 'responded',
    });
    expect(t.map(e => e.type)).toEqual(['submitted', 'response']);
    expect(t[1]).toMatchObject({ type: 'response', by: 'shop', at: 2000 });
  });

  it('amended → submitted + response + amended + published ordered', () => {
    const t = buildReviewTimeline({
      submittedAt: 1000,
      shopStars: 2,
      responseAt: 2000,
      responseText: 'fixed',
      responseBy: 'shop',
      amendedAt: 3000,
      amendedStars: { shopStars: 4, deliveryStars: null },
      publishedAt: 3000,
      publishedReason: 'amended',
      correctionState: 'published',
    });
    expect(t.map(e => e.type)).toEqual([
      'submitted',
      'response',
      'amended',
      'published',
    ]);
    expect(t[2]).toMatchObject({ type: 'amended', shopStars: 4 });
  });

  it('acknowledged → published without amend', () => {
    const t = buildReviewTimeline({
      submittedAt: 1000,
      shopStars: 2,
      responseAt: 2000,
      responseText: 'sorry',
      responseBy: 'partner',
      publishedAt: 2500,
      publishedReason: 'acknowledged',
      correctionState: 'published',
    });
    expect(t.map(e => e.type)).toEqual(['submitted', 'response', 'published']);
    expect(t[2]).toMatchObject({ reason: 'acknowledged' });
  });

  it('timed-out → submitted + published(reason=timeout), no response', () => {
    const t = buildReviewTimeline({
      submittedAt: 1000,
      shopStars: 1,
      publishedAt: 9000,
      publishedReason: 'timeout',
      correctionState: 'published',
    });
    expect(t.map(e => e.type)).toEqual(['submitted', 'published']);
    expect(t[1]).toMatchObject({ reason: 'timeout' });
  });
});

describe('filterReviewsForCaller', () => {
  const reviews = [
    { ratingId: 'a', correctionState: 'published' },
    { ratingId: 'b', correctionState: 'flagged_low' },
    { ratingId: 'c', correctionState: 'responded' },
    { ratingId: 'd', correctionState: 'published' },
  ];

  it('admin sees all', () => {
    expect(filterReviewsForCaller(reviews, true)).toHaveLength(4);
  });

  it('public sees only published', () => {
    const out = filterReviewsForCaller(reviews, false);
    expect(out.map(r => r.ratingId)).toEqual(['a', 'd']);
  });

  it('mixed-state filtering excludes amended/flagged for public', () => {
    const out = filterReviewsForCaller(
      [
        { ratingId: 'x', correctionState: 'amended' },
        { ratingId: 'y', correctionState: 'published' },
      ],
      false,
    );
    expect(out.map(r => r.ratingId)).toEqual(['y']);
  });

  it('empty list → empty', () => {
    expect(filterReviewsForCaller([], false)).toEqual([]);
    expect(filterReviewsForCaller([], true)).toEqual([]);
  });
});
