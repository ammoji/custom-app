/**
 * HOTFIX-PROFILE-PHOTO-4 — tests for the partner profile-photo upload
 * plan helper.
 *
 * Pins the contract the callable relies on: the storage path stamp, the
 * Firebase Storage REST download URL format (token embedded), token
 * consistency between the returned token and the URL, and the
 * extension-header map the client PUT must echo.
 *
 * Deliberate-break demo: break token/URL consistency in
 * buildPartnerPhotoUploadPlan (e.g. embed a different token) → the
 * "downloadToken matches the token embedded in downloadUrl" test fails.
 */
import {
  buildPartnerPhotoUploadPlan,
  partnerPhotoStoragePath,
  PARTNER_PHOTO_TOKEN_HEADER,
} from '../../functions/src/partnerPhotoUploadHelpers';

const BUCKET = 'grocery-mvp-dev.firebasestorage.app';
const UID = 'partner-abc123';
const TOKEN = '123e4567-e89b-12d3-a456-426614174000';

describe('partnerPhotoStoragePath', () => {
  it('stamps delivery-profile/{uid}.jpg for image/jpeg (regression guard)', () => {
    expect(partnerPhotoStoragePath(UID, 'image/jpeg')).toBe(
      `delivery-profile/${UID}.jpg`,
    );
  });

  it('stamps .png for image/png', () => {
    expect(partnerPhotoStoragePath(UID, 'image/png')).toBe(
      `delivery-profile/${UID}.png`,
    );
  });
});

describe('buildPartnerPhotoUploadPlan', () => {
  const plan = buildPartnerPhotoUploadPlan({
    uid: UID,
    contentType: 'image/jpeg',
    bucketName: BUCKET,
    token: TOKEN,
  });

  it('returns a Firebase Storage REST download URL (not GCS-direct)', () => {
    expect(plan.downloadUrl).toBe(
      `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(
        `delivery-profile/${UID}.jpg`,
      )}?alt=media&token=${TOKEN}`,
    );
    // Must NOT be the deprecated GCS-direct scheme that bypasses rules.
    // (Note: `firebasestorage.googleapis.com` legitimately contains the
    // substring `storage.googleapis.com`, so assert on the host prefix.)
    expect(plan.downloadUrl.startsWith('https://storage.googleapis.com/')).toBe(
      false,
    );
    expect(plan.downloadUrl.startsWith('https://firebasestorage.googleapis.com/')).toBe(
      true,
    );
  });

  it('embeds the SAME token in the URL that it returns in downloadToken', () => {
    expect(plan.downloadToken).toBe(TOKEN);
    expect(plan.downloadUrl).toContain(`token=${plan.downloadToken}`);
  });

  it('returns a UUID-shaped token when given one', () => {
    expect(plan.downloadToken).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('exposes the token-echo extension header the client PUT must send', () => {
    expect(plan.extensionHeaders).toEqual({
      [PARTNER_PHOTO_TOKEN_HEADER]: TOKEN,
    });
    // The wire header key MUST be all-lowercase (GCS lowercases it).
    expect(PARTNER_PHOTO_TOKEN_HEADER).toBe(
      'x-goog-meta-firebasestoragedownloadtokens',
    );
  });

  it('stamps the storagePath consistently with partnerPhotoStoragePath', () => {
    expect(plan.storagePath).toBe(`delivery-profile/${UID}.jpg`);
  });
});
