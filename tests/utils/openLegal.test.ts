/**
 * PR 25 — Tests for the URL accessor + browser opener routing logic.
 *
 * Mocks `expo-web-browser` and `react-native`'s `Linking` so the
 * tests don't try to actually open anything. Each test that depends
 * on a different `expo-constants` mock uses `jest.isolateModules`
 * so the module-level read inside `getLegalUrls()` re-evaluates
 * against the fresh mock.
 */
import { Platform } from 'react-native';

jest.mock('expo-web-browser', () => ({
  openBrowserAsync: jest.fn(async () => ({ type: 'opened' })),
}));

// The jest-expo preset's react-native mock omits Linking; stub it.
// jest.mock factories are hoisted above any `const`/`let`, so the
// fn lives inside the factory and is retrieved via `require` below.
jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  return {
    ...actual,
    Linking: { openURL: jest.fn(async () => {}) },
  };
});

describe('PR 25 — openLegal', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('openPrivacy reads the URL from expo-constants extra.legal', async () => {
    await jest.isolateModulesAsync(async () => {
      jest.doMock('expo-constants', () => ({
        __esModule: true,
        default: {
          expoConfig: {
            extra: {
              legal: {
                privacyUrl: 'https://test.example.com/privacy',
                termsUrl: 'https://test.example.com/terms',
              },
            },
          },
        },
      }));
      const WebBrowser = require('expo-web-browser');
      const { openPrivacy } = await import('../../src/utils/openLegal');
      Platform.OS = 'ios';
      await openPrivacy();
      expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith(
        'https://test.example.com/privacy',
      );
    });
  });

  test('openTerms reads the URL from expo-constants extra.legal', async () => {
    await jest.isolateModulesAsync(async () => {
      jest.doMock('expo-constants', () => ({
        __esModule: true,
        default: {
          expoConfig: {
            extra: {
              legal: {
                privacyUrl: 'https://test.example.com/privacy',
                termsUrl: 'https://test.example.com/terms',
              },
            },
          },
        },
      }));
      const WebBrowser = require('expo-web-browser');
      const { openTerms } = await import('../../src/utils/openLegal');
      Platform.OS = 'ios';
      await openTerms();
      expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith(
        'https://test.example.com/terms',
      );
    });
  });

  test('on web, uses Linking.openURL instead of WebBrowser', async () => {
    await jest.isolateModulesAsync(async () => {
      jest.doMock('expo-constants', () => ({
        __esModule: true,
        default: {
          expoConfig: {
            extra: {
              legal: {
                privacyUrl: 'https://test.example.com/privacy',
                termsUrl: 'https://test.example.com/terms',
              },
            },
          },
        },
      }));
      const WebBrowser = require('expo-web-browser');
      const RN = require('react-native');
      const { openPrivacy } = await import('../../src/utils/openLegal');
      Platform.OS = 'web';
      await openPrivacy();
      expect(RN.Linking.openURL).toHaveBeenCalledWith(
        'https://test.example.com/privacy',
      );
      expect(WebBrowser.openBrowserAsync).not.toHaveBeenCalled();
    });
  });

  test('falls back to grocery-mvp-dev URLs when extra.legal is missing', async () => {
    await jest.isolateModulesAsync(async () => {
      jest.doMock('expo-constants', () => ({
        __esModule: true,
        default: { expoConfig: {} },
      }));
      const { getLegalUrls } = await import('../../src/constants/legal');
      const urls = getLegalUrls();
      expect(urls.privacyUrl).toMatch(/grocery-mvp-dev\.web\.app\/privacy$/);
      expect(urls.termsUrl).toMatch(/grocery-mvp-dev\.web\.app\/terms$/);
    });
  });
});
