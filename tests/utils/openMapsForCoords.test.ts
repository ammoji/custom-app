/**
 * PR 31.1 — pure tests for the coords-to-maps URL builder.
 * Mocks react-native's `Linking`; verifies the URL shape is
 * correct for labelled / unlabelled / negative coordinates, and
 * that a rejection from `Linking.openURL` is swallowed rather
 * than thrown back to the caller (admin UI has no recovery).
 */
jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  return {
    ...actual,
    Linking: { openURL: jest.fn(async () => {}) },
  };
});

import { Linking } from 'react-native';
import { openMapsForCoords } from '../../src/utils/openMapsForCoords';

describe('PR 31.1 — openMapsForCoords', () => {
  beforeEach(() => jest.clearAllMocks());

  test('builds the universal Google Maps URL with bare coords', async () => {
    await openMapsForCoords(28.61, 77.21);
    expect(Linking.openURL).toHaveBeenCalledWith(
      'https://www.google.com/maps?q=28.61,77.21',
    );
  });

  test('appends a URL-encoded label when provided', async () => {
    await openMapsForCoords(28.61, 77.21, 'Sharma Kirana Mart');
    expect(Linking.openURL).toHaveBeenCalledWith(
      'https://www.google.com/maps?q=28.61,77.21(Sharma%20Kirana%20Mart)',
    );
  });

  test('handles negative coordinates (Southern / Western hemisphere)', async () => {
    await openMapsForCoords(-33.8688, 151.2093, 'Sydney');
    expect(Linking.openURL).toHaveBeenCalledWith(
      'https://www.google.com/maps?q=-33.8688,151.2093(Sydney)',
    );
  });

  test('swallows Linking.openURL rejection without throwing', async () => {
    (Linking.openURL as jest.Mock).mockRejectedValueOnce(
      new Error('no handler'),
    );
    await expect(openMapsForCoords(0, 0)).resolves.toBeUndefined();
  });
});
