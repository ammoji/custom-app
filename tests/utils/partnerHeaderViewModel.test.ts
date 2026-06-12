/**
 * PR-NEXT-BUNDLE-G §D — DO NOT REMOVE. Tests for buildPartnerHeaderViewModel.
 * +3 tests.
 */

import { buildPartnerHeaderViewModel } from '../../src/utils/partnerHeaderViewModel';

describe('buildPartnerHeaderViewModel', () => {
  it('returns initials avatar when no photo URL provided', () => {
    const vm = buildPartnerHeaderViewModel({
      name: 'Ramu Kumar',
      photoUrl: null,
      ratingAvg: 4.8,
      ratingCount: 12,
    });
    expect(vm.displayName).toBe('Ramu Kumar');
    expect(vm.avatar.kind).toBe('initials');
    expect(vm.ratingAvg).toBe(4.8);
    expect(vm.ratingCount).toBe(12);
    expect(vm.hasRating).toBe(true);
  });

  it('returns photo avatar when URL is provided', () => {
    const vm = buildPartnerHeaderViewModel({
      name: 'Priya',
      photoUrl: 'https://storage.googleapis.com/bucket/delivery-profile/abc.jpg',
      ratingAvg: 4.5,
      ratingCount: 3,
    });
    expect(vm.avatar.kind).toBe('photo');
    expect(vm.hasRating).toBe(true);
  });

  it('falls back to default display name and no-rating state for empty inputs', () => {
    const vm = buildPartnerHeaderViewModel({
      name: null,
      photoUrl: null,
      ratingAvg: null,
      ratingCount: null,
    });
    expect(vm.displayName).toBe('Delivery partner');
    expect(vm.hasRating).toBe(false);
    expect(vm.ratingCount).toBe(0);
  });
});
