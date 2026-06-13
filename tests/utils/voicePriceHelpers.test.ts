/**
 * PR-NEXT-BUNDLE-K §D — Unit tests for voicePriceHelpers.ts.
 * 14 tests covering parseVoicePriceInput across English and Hindi inputs.
 */

import { parseVoicePriceInput } from '../../src/utils/voicePriceHelpers';

describe('parseVoicePriceInput — English numeric', () => {
  it('extracts a plain integer', () => {
    const r = parseVoicePriceInput('45', 'en');
    expect(r.price).toBe(45);
    expect(r.confidence).toBe('high');
  });

  it('extracts price with ₹ prefix', () => {
    const r = parseVoicePriceInput('₹ 120', 'en');
    expect(r.price).toBe(120);
    expect(r.confidence).toBe('high');
  });

  it('extracts price with rupees suffix', () => {
    const r = parseVoicePriceInput('fifty rupees', 'en');
    expect(r.price).toBe(50);
    expect(r.confidence).toBe('high');
  });

  it('returns low confidence for multiple numbers', () => {
    const r = parseVoicePriceInput('maybe 20 or 30 rupees', 'en');
    expect(r.price).not.toBeNull();
    expect(r.confidence).toBe('low');
  });

  it('returns null for empty string', () => {
    const r = parseVoicePriceInput('', 'en');
    expect(r.price).toBeNull();
    expect(r.confidence).toBeNull();
  });
});

describe('parseVoicePriceInput — English spoken words', () => {
  it('parses "twenty five"', () => {
    const r = parseVoicePriceInput('twenty five', 'en');
    expect(r.price).toBe(25);
    expect(r.confidence).toBe('high');
  });

  it('parses "one hundred"', () => {
    const r = parseVoicePriceInput('one hundred', 'en');
    expect(r.price).toBe(100);
    expect(r.confidence).toBe('high');
  });

  it('parses "two hundred fifty"', () => {
    const r = parseVoicePriceInput('two hundred fifty', 'en');
    expect(r.price).toBe(250);
    expect(r.confidence).toBe('high');
  });

  it('returns null for unrecognized text', () => {
    const r = parseVoicePriceInput('hello world', 'en');
    expect(r.price).toBeNull();
  });
});

describe('parseVoicePriceInput — Hindi', () => {
  it('parses "पचास" (50)', () => {
    const r = parseVoicePriceInput('पचास', 'hi');
    expect(r.price).toBe(50);
    expect(r.confidence).toBe('high');
  });

  it('parses "एक सौ बीस" (120)', () => {
    const r = parseVoicePriceInput('एक सौ बीस', 'hi');
    expect(r.price).toBe(120);
    expect(r.confidence).toBe('high');
  });

  it('parses Hindi digit followed by rupaye suffix noise', () => {
    const r = parseVoicePriceInput('तीस रुपये', 'hi');
    expect(r.price).toBe(30);
    expect(r.confidence).toBe('high');
  });

  it('parses transliterated "pachaas"', () => {
    const r = parseVoicePriceInput('pachaas rupaye', 'hi');
    expect(r.price).toBe(50);
    expect(r.confidence).toBe('high');
  });

  it('rejects out-of-range price (> 99999)', () => {
    const r = parseVoicePriceInput('1000000', 'hi');
    expect(r.price).toBeNull();
  });
});
