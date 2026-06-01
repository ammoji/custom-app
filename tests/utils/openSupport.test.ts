/**
 * PR 39 — Tests for the support-email opener used by ProfileScreen.
 *
 * Mocks `react-native`'s `Linking` (the jest-expo preset's
 * react-native mock omits it; same trick as PR 25's
 * `openLegal.test.ts`). Each assertion verifies a different
 * surface of the composed `mailto:` URL — recipient, subject,
 * body markers, platform stamp — so a regression in any one
 * piece surfaces with a precise failure message.
 */
jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  return {
    ...actual,
    Linking: {
      canOpenURL: jest.fn(async () => true),
      openURL: jest.fn(async () => {}),
    },
  };
});

import { Linking } from 'react-native';
import { openSupportEmail } from '../../src/utils/openSupport';

describe('PR 39 — openSupportEmail', () => {
  beforeEach(() => {
    (Linking.canOpenURL as jest.Mock).mockReset();
    (Linking.openURL as jest.Mock).mockReset();
    (Linking.canOpenURL as jest.Mock).mockResolvedValue(true);
    (Linking.openURL as jest.Mock).mockResolvedValue(undefined);
  });

  test('opens a mailto: URL addressed to the Sara Stack Labs support address', async () => {
    // Email migrated from `sudhir.davim@gmail.com` to the
    // operating-entity inbox in the Razorpay-resubmission cleanup.
    // Test pins the new value so an accidental revert trips CI.
    await openSupportEmail();
    expect(Linking.openURL).toHaveBeenCalledTimes(1);
    const url = (Linking.openURL as jest.Mock).mock.calls[0][0] as string;
    expect(url.startsWith('mailto:sarastacklabs@gmail.com')).toBe(true);
  });

  test('subject contains the brand name "HamaraSetu support"', async () => {
    await openSupportEmail();
    const url = (Linking.openURL as jest.Mock).mock.calls[0][0] as string;
    const decoded = decodeURIComponent(url);
    expect(decoded).toContain('subject=HamaraSetu support');
  });

  test('body includes a Platform: stamp + the App: HamaraSetu line', async () => {
    await openSupportEmail();
    const url = (Linking.openURL as jest.Mock).mock.calls[0][0] as string;
    const decoded = decodeURIComponent(url);
    expect(decoded).toMatch(/Platform: [a-z]+/);
    expect(decoded).toContain('App: HamaraSetu');
  });

  test('when canOpenURL returns false, openURL is NOT called (silent fail)', async () => {
    (Linking.canOpenURL as jest.Mock).mockResolvedValueOnce(false);
    await openSupportEmail();
    expect(Linking.openURL).not.toHaveBeenCalled();
  });

  test('when canOpenURL throws, the promise resolves cleanly (no crash)', async () => {
    (Linking.canOpenURL as jest.Mock).mockRejectedValueOnce(
      new Error('boom'),
    );
    await expect(openSupportEmail()).resolves.toBeUndefined();
    expect(Linking.openURL).not.toHaveBeenCalled();
  });
});
