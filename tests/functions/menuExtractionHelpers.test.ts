/**
 * PR 32 — pure tests for menuExtractionHelpers.
 *
 * The helper's contract:
 *   1. The system prompt embeds the 10 canonical CategoryIds so
 *      Claude can ONLY pick from the same set the server validates
 *      against.
 *   2. `parseExtractionResponse` strictly validates each row of
 *      Claude's response, dropping the rows that fail and reporting
 *      the drop count.
 *
 * Mirrors `tests/functions/kycUploadHelpers.test.ts` (PR 31) in
 * style: small, fast, no mocks, every branch covered.
 */
import {
  MENU_EXTRACTION_SYSTEM_PROMPT,
  MENU_EXTRACTION_USER_PROMPT,
  parseExtractionResponse,
} from '../../functions/src/menuExtractionHelpers';

describe('PR 32 — menuExtractionHelpers', () => {
  test('MENU_EXTRACTION_SYSTEM_PROMPT contains all 10 canonical CategoryIds', () => {
    for (const cat of [
      'atta_rice_dal',
      'oil_ghee',
      'dairy_eggs',
      'bakery',
      'masala_spices',
      'snacks_biscuits',
      'beverages',
      'personal_care',
      'household',
      'fruits_vegetables',
    ]) {
      expect(MENU_EXTRACTION_SYSTEM_PROMPT).toContain(cat);
    }
  });

  test('MENU_EXTRACTION_USER_PROMPT is a non-empty exhaustive instruction', () => {
    expect(MENU_EXTRACTION_USER_PROMPT).toMatch(/exhaustive/i);
    expect(MENU_EXTRACTION_USER_PROMPT.length).toBeGreaterThan(20);
  });

  test('parses a valid Claude response into ExtractedItem[]', () => {
    const text = JSON.stringify({
      items: [
        {
          name: 'Aashirvaad Atta',
          brand: 'Aashirvaad',
          packSize: '5 kg',
          mrp: 305,
          sellPrice: 295,
          category: 'atta_rice_dal',
          confidence: 'high',
        },
      ],
    });
    const r = parseExtractionResponse(text);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.items).toHaveLength(1);
      expect(r.items[0].name).toBe('Aashirvaad Atta');
      expect(r.items[0].brand).toBe('Aashirvaad');
      expect(r.items[0].mrp).toBe(305);
      expect(r.items[0].sellPrice).toBe(295);
      expect(r.items[0].confidence).toBe('high');
      expect(r.droppedCount).toBe(0);
    }
  });

  test('strips ```json fences before parsing', () => {
    const text = '```json\n{ "items": [] }\n```';
    const r = parseExtractionResponse(text);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.items).toHaveLength(0);
      expect(r.droppedCount).toBe(0);
    }
  });

  test('drops items with invalid category (preserves valid siblings)', () => {
    const text = JSON.stringify({
      items: [
        {
          name: 'Mystery Soap',
          packSize: '100 g',
          category: 'made_up_category',
          confidence: 'high',
        },
        {
          name: 'Sunflower Oil',
          packSize: '1 L',
          mrp: 180,
          sellPrice: 170,
          category: 'oil_ghee',
          confidence: 'high',
        },
      ],
    });
    const r = parseExtractionResponse(text);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.items).toHaveLength(1);
      expect(r.items[0].name).toBe('Sunflower Oil');
      expect(r.droppedCount).toBe(1);
    }
  });

  test('drops items missing name or packSize', () => {
    const text = JSON.stringify({
      items: [
        { packSize: '1 kg', category: 'atta_rice_dal' }, // no name
        { name: '   ', packSize: '1 kg', category: 'atta_rice_dal' }, // blank name
        { name: 'Salt', category: 'masala_spices' }, // no packSize
        { name: 'Sugar', packSize: '1 kg', category: 'atta_rice_dal' }, // valid
      ],
    });
    const r = parseExtractionResponse(text);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.items).toHaveLength(1);
      expect(r.items[0].name).toBe('Sugar');
      expect(r.droppedCount).toBe(3);
    }
  });

  test('coerces non-number mrp/sellPrice to null without dropping the row', () => {
    const text = JSON.stringify({
      items: [
        {
          name: 'Loose Atta',
          packSize: '1 kg',
          // Claude sometimes returns a string when the price was
          // partially legible — schema should null it out, not
          // drop the entire row.
          mrp: 'illegible',
          sellPrice: null,
          category: 'atta_rice_dal',
          confidence: 'low',
        },
      ],
    });
    const r = parseExtractionResponse(text);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.items).toHaveLength(1);
      expect(r.items[0].mrp).toBeNull();
      expect(r.items[0].sellPrice).toBeNull();
      expect(r.items[0].confidence).toBe('low');
      expect(r.droppedCount).toBe(0);
    }
  });

  test('defaults confidence to "medium" when missing or invalid', () => {
    const text = JSON.stringify({
      items: [
        {
          name: 'Tea',
          packSize: '250 g',
          mrp: 140,
          sellPrice: 140,
          category: 'beverages',
          // confidence omitted
        },
        {
          name: 'Sugar',
          packSize: '1 kg',
          mrp: 50,
          sellPrice: 50,
          category: 'atta_rice_dal',
          confidence: 'definitely', // not in the enum
        },
      ],
    });
    const r = parseExtractionResponse(text);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.items).toHaveLength(2);
      expect(r.items[0].confidence).toBe('medium');
      expect(r.items[1].confidence).toBe('medium');
    }
  });

  test('returns { ok: false } on un-parseable JSON or missing items[]', () => {
    const garbage = parseExtractionResponse('not json at all');
    expect(garbage.ok).toBe(false);
    if (!garbage.ok) {
      expect(garbage.reason).toMatch(/JSON parse failed/i);
    }

    const noItems = parseExtractionResponse(JSON.stringify({ foo: 'bar' }));
    expect(noItems.ok).toBe(false);
    if (!noItems.ok) {
      expect(noItems.reason).toMatch(/items\[\]/);
    }
  });
});
