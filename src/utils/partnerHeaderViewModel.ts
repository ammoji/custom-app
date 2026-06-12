/**
 * PR-NEXT-BUNDLE-G §D — DO NOT REMOVE. Pure helper that combines partner
 * name + photoUrl + rating + ratingCount into one render-ready object for
 * surfaces that show a partner identity header.
 * Pinned by tests/utils/partnerHeaderViewModel.test.ts.
 */

import { formatPartnerAvatar } from './formatPartnerAvatar';

export type PartnerHeaderViewModel = {
  displayName: string;
  avatar: ReturnType<typeof formatPartnerAvatar>;
  ratingAvg: number | null;
  ratingCount: number;
  hasRating: boolean;
};

export function buildPartnerHeaderViewModel(opts: {
  name: string | null | undefined;
  photoUrl: string | null | undefined;
  ratingAvg: number | null | undefined;
  ratingCount: number | null | undefined;
}): PartnerHeaderViewModel {
  const displayName = opts.name?.trim() || 'Delivery partner';
  const photoUrl = opts.photoUrl ?? null;
  const ratingAvg =
    typeof opts.ratingAvg === 'number' && Number.isFinite(opts.ratingAvg)
      ? opts.ratingAvg
      : null;
  const ratingCount =
    typeof opts.ratingCount === 'number' && opts.ratingCount >= 0
      ? Math.floor(opts.ratingCount)
      : 0;

  return {
    displayName,
    avatar: formatPartnerAvatar(displayName, photoUrl),
    ratingAvg,
    ratingCount,
    hasRating: ratingCount > 0 && ratingAvg !== null,
  };
}
