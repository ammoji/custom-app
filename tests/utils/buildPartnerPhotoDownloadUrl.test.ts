/**
 * HOTFIX-PROFILE-PHOTO — DO NOT REMOVE. Tests for buildPartnerPhotoDownloadUrl.
 * Deliberate-break demo: revert to encodeURIComponent(fullPath) in the helper;
 * test #1 must fail (URL contains %2F instead of literal /).
 */

import { buildPartnerPhotoDownloadUrl } from '../../src/utils/buildPartnerPhotoDownloadUrl';

// HOTFIX-PROFILE-PHOTO-3 (2026-06-10) — bucket name corrected from
// .appspot.com (pre-April-2024 default Firebase Storage bucket
// naming) to .firebasestorage.app (new default; what
// google-services.json / GoogleService-Info.plist actually point to
// for this project). Browser test of the old URL returned
// `NoSuchBucket — The specified bucket does not exist`.
const BASE = 'https://storage.googleapis.com/grocery-mvp-dev.firebasestorage.app';

// HOTFIX-PROFILE-PHOTO-4 (2026-06-10) — buildPartnerPhotoDownloadUrl is
// now @deprecated. It builds a GCS-direct URL that bypasses Firebase
// Storage Rules; production partner photos switched to the Firebase
// Storage REST URL (embedded download token) returned by
// getPartnerPhotoUploadUrl. These tests stay to document the GCS URL
// pattern in isolation, NOT because any production code still calls it.
describe('buildPartnerPhotoDownloadUrl (DEPRECATED — see HOTFIX-PROFILE-PHOTO-4)', () => {
  it('preserves literal / between path segments', () => {
    const url = buildPartnerPhotoDownloadUrl('delivery-profile/abc123.jpg');
    expect(url).toBe(`${BASE}/delivery-profile/abc123.jpg`);
    expect(url).not.toContain('%2F');
  });

  it('handles dash and underscore in uid segment', () => {
    const url = buildPartnerPhotoDownloadUrl('delivery-profile/abc-def_456.jpg');
    expect(url).toBe(`${BASE}/delivery-profile/abc-def_456.jpg`);
  });

  it('encodes individual segment with special chars (defense-in-depth)', () => {
    const url = buildPartnerPhotoDownloadUrl('delivery-profile/uid with space.jpg');
    expect(url).toBe(`${BASE}/delivery-profile/uid%20with%20space.jpg`);
    expect(url).not.toContain('%2F');
  });

  it('empty string input returns base URL without trailing slash issues', () => {
    const url = buildPartnerPhotoDownloadUrl('');
    expect(url).toBe(`${BASE}/`);
  });

  it('does not double-encode a normal uid like Ab_-Cd123.jpg', () => {
    const url = buildPartnerPhotoDownloadUrl('delivery-profile/Ab_-Cd123.jpg');
    expect(url).toBe(`${BASE}/delivery-profile/Ab_-Cd123.jpg`);
  });
});
