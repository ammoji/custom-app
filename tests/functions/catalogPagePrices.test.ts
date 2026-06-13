/**
 * PR-NEXT-BUNDLE-L §G — tests for the catalog-page OCR parser
 * (`parseCatalogPagePrices`) + the Devanagari digit normaliser.
 */
import {
  parseCatalogPagePrices,
  normalizeDevanagariDigits,
} from '../../functions/src/menuExtractionHelpers';

const ALLOWED = ['ABCD-1234', 'EFGH-5678', 'IJKL-9012'];

const wrap = (prices: unknown[]): string => JSON.stringify({ prices });

describe('parseCatalogPagePrices', () => {
  it('clean response → all prices returned, none dropped', () => {
    const text = wrap([
      { productId: 'ABCD-1234', sellPrice: 525, confidence: 'high' },
      { productId: 'EFGH-5678', sellPrice: 190, confidence: 'medium' },
    ]);
    const res = parseCatalogPagePrices(text, ALLOWED);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.prices).toHaveLength(2);
    expect(res.droppedCount).toBe(0);
    expect(res.prices[0]).toEqual({
      productId: 'ABCD-1234',
      sellPrice: 525,
      confidence: 'high',
    });
  });

  it('empty handwriting (no prices) → empty array, droppedCount 0', () => {
    const res = parseCatalogPagePrices(wrap([]), ALLOWED);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.prices).toEqual([]);
    expect(res.droppedCount).toBe(0);
  });

  it('productId not in allowed list → dropped', () => {
    const res = parseCatalogPagePrices(
      wrap([
        { productId: 'NOT-IN-ALLOWED-LIST', sellPrice: 100, confidence: 'high' },
        { productId: 'ABCD-1234', sellPrice: 50, confidence: 'high' },
      ]),
      ALLOWED,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.prices.map(p => p.productId)).toEqual(['ABCD-1234']);
    expect(res.droppedCount).toBeGreaterThanOrEqual(1);
  });

  it('negative price → dropped', () => {
    const res = parseCatalogPagePrices(
      wrap([{ productId: 'ABCD-1234', sellPrice: -5, confidence: 'high' }]),
      ALLOWED,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.prices).toHaveLength(0);
    expect(res.droppedCount).toBe(1);
  });

  it('zero price → dropped', () => {
    const res = parseCatalogPagePrices(
      wrap([{ productId: 'ABCD-1234', sellPrice: 0, confidence: 'high' }]),
      ALLOWED,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.prices).toHaveLength(0);
    expect(res.droppedCount).toBe(1);
  });

  it('price > 100000 → dropped (likely OCR misread)', () => {
    const res = parseCatalogPagePrices(
      wrap([{ productId: 'ABCD-1234', sellPrice: 550000, confidence: 'high' }]),
      ALLOWED,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.prices).toHaveLength(0);
    expect(res.droppedCount).toBe(1);
  });

  it('non-numeric price → dropped', () => {
    const res = parseCatalogPagePrices(
      wrap([{ productId: 'ABCD-1234', sellPrice: 'abc', confidence: 'high' }]),
      ALLOWED,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.prices).toHaveLength(0);
    expect(res.droppedCount).toBe(1);
  });

  it('Devanagari numerals → parsed correctly', () => {
    const res = parseCatalogPagePrices(
      wrap([{ productId: 'ABCD-1234', sellPrice: '५२५', confidence: 'high' }]),
      ALLOWED,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.prices).toEqual([
      { productId: 'ABCD-1234', sellPrice: 525, confidence: 'high' },
    ]);
  });

  it('malformed JSON from Claude → ok:false with reason', () => {
    const res = parseCatalogPagePrices('not json at all {', ALLOWED);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toMatch(/JSON parse failed/);
  });

  it('strips ```json fences before parsing', () => {
    const text =
      '```json\n' +
      wrap([{ productId: 'EFGH-5678', sellPrice: 42, confidence: 'low' }]) +
      '\n```';
    const res = parseCatalogPagePrices(text, ALLOWED);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.prices).toEqual([
      { productId: 'EFGH-5678', sellPrice: 42, confidence: 'low' },
    ]);
  });

  it('duplicate productId in one response → first kept, rest dropped', () => {
    const res = parseCatalogPagePrices(
      wrap([
        { productId: 'ABCD-1234', sellPrice: 100, confidence: 'high' },
        { productId: 'ABCD-1234', sellPrice: 200, confidence: 'high' },
      ]),
      ALLOWED,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.prices).toEqual([
      { productId: 'ABCD-1234', sellPrice: 100, confidence: 'high' },
    ]);
    expect(res.droppedCount).toBe(1);
  });

  it('confidence missing → defaults to medium', () => {
    const res = parseCatalogPagePrices(
      wrap([{ productId: 'IJKL-9012', sellPrice: 75 }]),
      ALLOWED,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.prices[0].confidence).toBe('medium');
  });
});

describe('normalizeDevanagariDigits', () => {
  it('converts Devanagari digits to Western', () => {
    expect(normalizeDevanagariDigits('५२५')).toBe('525');
    expect(normalizeDevanagariDigits('०१२३४५६७८९')).toBe('0123456789');
  });

  it('leaves non-Devanagari characters untouched', () => {
    expect(normalizeDevanagariDigits('Rs. 525')).toBe('Rs. 525');
    expect(normalizeDevanagariDigits('१२ kg')).toBe('12 kg');
  });
});
