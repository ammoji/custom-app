/**
 * Tests for the ShopList load state machine
 * (src/screens/ShopListScreen.useShopListData.ts).
 *
 * Per the test plan we deliberately do NOT mount the React Native
 * component — RNTL setup is a separate PR. Instead, the hook's load
 * logic is exposed as a pure async function `loadShopListOnce` and
 * tested directly. The hook itself is a thin useState/useEffect
 * wrapper around it; the bug class (loader-stuck-forever) lives in
 * the try/finally wiring, which is reviewed by reading the screen.
 */
import { loadShopListOnce } from '../../src/screens/ShopListScreen.useShopListData';

const userLocation = { lat: 28.6139, lng: 77.209 };

describe('loadShopListOnce', () => {
  test('returns shops + null error on success', async () => {
    const stubShop: any = {
      id: 'a',
      name: 'A',
      location: userLocation,
      rating: 4,
      isOpen: true,
    };
    const result = await loadShopListOnce(userLocation as any, async () => [
      stubShop,
    ]);

    expect(result.error).toBeNull();
    expect(result.shops).toEqual([stubShop]);
  });

  test('returns [] + error message on thrown promise (the bug-class scenario)', async () => {
    const thrower = async () => {
      throw new Error('NETWORK_ERROR');
    };

    const result = await loadShopListOnce(userLocation as any, thrower);

    // Critical: the function NEVER re-throws — the screen's finally
    // block depends on this so the loader can't stay spinning.
    expect(result.error).toBe('NETWORK_ERROR');
    expect(result.shops).toEqual([]);
  });

  test('falls back to a generic message when error has no .message', async () => {
    const result = await loadShopListOnce(
      userLocation as any,
      async () => {
        // eslint-disable-next-line no-throw-literal
        throw 'string-error-no-message-prop';
      },
    );

    expect(result.error).toBe('Could not load shops. Pull to refresh.');
    expect(result.shops).toEqual([]);
  });

  test('does not swallow the loader (failure path resolves, never rejects)', async () => {
    // Regression guard: if someone "improves" loadShopListOnce to
    // re-throw, the screen's try/finally would still flip loading to
    // false, but the error banner would never render. Pin both
    // behaviours: 1) resolve, never reject; 2) populate `error`.
    const settled = await loadShopListOnce(
      userLocation as any,
      async () => {
        throw new Error('boom');
      },
    ).then(
      v => ({ kind: 'resolved' as const, v }),
      e => ({ kind: 'rejected' as const, e }),
    );

    expect(settled.kind).toBe('resolved');
    if (settled.kind === 'resolved') {
      expect(settled.v.error).toBe('boom');
    }
  });
});
