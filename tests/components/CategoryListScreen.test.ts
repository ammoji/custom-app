/**
 * PR-NEXT-BUNDLE-K.1 — CategoryListScreen + VoicePriceCapture logic tests.
 *
 * The screen + component are JSX and don't render in the pure-Node test
 * env (see jest.config.js header). Per the established pattern, the
 * orchestration logic is extracted into pure helpers in
 * src/utils/catalogBrowseHelpers.ts; this suite drives a faithful
 * simulation of the screen's type / MRP / voice-auto-advance + save
 * flow against those helpers, plus the §F regression guard.
 */

import fs from 'fs';
import path from 'path';
import {
  buildBulkCommitItems,
  computeCategoryProgress,
  computeRemainingByCategory,
  decideVoiceCapture,
  filterCatalogByExistingMenu,
  findFirstUnpricedRow,
  findNextUnpricedRow,
  validateInlinePrice,
  type CategoryListItemRow,
} from '../../src/utils/catalogBrowseHelpers';

const ROWS: CategoryListItemRow[] = [
  { productId: 'a', name: 'Atta 5kg', packSize: { value: 5, unit: 'kg' }, mrp: 280, imageUrl: '' },
  { productId: 'b', name: 'Atta 10kg', packSize: { value: 10, unit: 'kg' }, mrp: 540, imageUrl: '' },
  { productId: 'c', name: 'Rice 1kg', packSize: { value: 1, unit: 'kg' }, mrp: 60, imageUrl: '' },
];

// ── Faithful simulation of the screen's commit + voice state machine ──────────

type Sim = {
  drafts: Map<string, number>;
  focus: string | null;
  voiceMode: boolean;
  // recorders for the VoicePriceCapture callback contract (§C)
  captured: { productId: string; price: number }[];
  skips: number;
};

function makeSim(): Sim {
  return { drafts: new Map(), focus: null, voiceMode: false, captured: [], skips: 0 };
}

// CategoryListScreen.commitPrice — validate against MRP, then set draft.
function commitPrice(sim: Sim, productId: string, price: number): boolean {
  const row = ROWS.find(r => r.productId === productId);
  const mrp = row?.mrp ?? Number.MAX_SAFE_INTEGER;
  if (!validateInlinePrice(price, mrp).ok) return false;
  sim.drafts.set(productId, Math.round(price));
  return true;
}

// CategoryListScreen.handleVoiceToggle
function startVoice(sim: Sim) {
  sim.voiceMode = true;
  const first = findFirstUnpricedRow(ROWS, sim.drafts);
  sim.focus = first ? first.productId : null;
}

// shared auto-advance used by both capture + skip paths
function advance(sim: Sim, fromId: string | null) {
  const next = findNextUnpricedRow(ROWS, sim.drafts, fromId);
  if (next) {
    sim.focus = next.productId;
  } else {
    sim.voiceMode = false;
    sim.focus = null;
  }
}

// VoicePriceCapture.handleVoiceResult routed through decideVoiceCapture,
// wired to the screen's handlePriceCaptured / handleSkipRow / toggle.
function onUtterance(sim: Sim, transcript: string) {
  const d = decideVoiceCapture(transcript, 'en');
  switch (d.action) {
    case 'commit': {
      if (!sim.focus) break;
      const ok = commitPrice(sim, sim.focus, d.price);
      if (!ok) break;
      sim.captured.push({ productId: sim.focus, price: d.price });
      advance(sim, sim.focus);
      break;
    }
    case 'skip':
      sim.skips += 1;
      advance(sim, sim.focus);
      break;
    case 'stop':
      sim.voiceMode = false;
      break;
    case 'retry':
      break; // no commit, focus unchanged
  }
}

// ── §A — table view: type / MRP / save gating ────────────────────────────────

describe('CategoryListScreen §A — pricing + save gating', () => {
  it('save is disabled until at least one row is priced', () => {
    const sim = makeSim();
    expect(computeCategoryProgress(ROWS, sim.drafts).priced).toBe(0);
    commitPrice(sim, 'a', 275);
    expect(computeCategoryProgress(ROWS, sim.drafts).priced).toBe(1);
  });

  it('MRP one-tap fills the price with the row MRP', () => {
    const sim = makeSim();
    commitPrice(sim, 'a', ROWS[0].mrp);
    expect(sim.drafts.get('a')).toBe(280);
  });

  it('type-then-commit stores a valid price', () => {
    const sim = makeSim();
    expect(commitPrice(sim, 'b', 500)).toBe(true);
    expect(sim.drafts.get('b')).toBe(500);
  });

  it('rejects an absurd price (>10x MRP) and stores nothing', () => {
    const sim = makeSim();
    expect(commitPrice(sim, 'c', 9999)).toBe(false);
    expect(sim.drafts.has('c')).toBe(false);
  });

  it('builds a bulk-commit payload from the draft map for Save', () => {
    const sim = makeSim();
    commitPrice(sim, 'a', 275);
    commitPrice(sim, 'c', 55);
    expect(buildBulkCommitItems(sim.drafts)).toEqual([
      { productId: 'a', price: 275 },
      { productId: 'c', price: 55 },
    ]);
  });
});

// ── §C — VoicePriceCapture decision routing ──────────────────────────────────

describe('VoicePriceCapture §C — utterance routing', () => {
  it('commits a high-confidence price to the focused row', () => {
    const sim = makeSim();
    startVoice(sim);
    onUtterance(sim, 'two hundred fifty');
    expect(sim.captured[0]).toEqual({ productId: 'a', price: 250 });
  });

  it('low-confidence input does NOT commit (retry)', () => {
    const sim = makeSim();
    startVoice(sim);
    onUtterance(sim, 'hmm uhh');
    expect(sim.captured).toHaveLength(0);
    expect(sim.focus).toBe('a'); // focus unchanged
  });

  it('"skip" advances without committing', () => {
    const sim = makeSim();
    startVoice(sim);
    onUtterance(sim, 'skip');
    expect(sim.skips).toBe(1);
    expect(sim.captured).toHaveLength(0);
    expect(sim.focus).toBe('b');
  });

  it('"stop" exits voice mode', () => {
    const sim = makeSim();
    startVoice(sim);
    onUtterance(sim, 'stop');
    expect(sim.voiceMode).toBe(false);
  });

  it('toggling voice on focuses the first un-priced row', () => {
    const sim = makeSim();
    sim.drafts.set('a', 275); // a already priced
    startVoice(sim);
    expect(sim.focus).toBe('b');
  });
});

// ── §D — voice auto-advance integration ──────────────────────────────────────

describe('CategoryListScreen §D — voice auto-advance', () => {
  it('starts focus on the first row when nothing is priced', () => {
    const sim = makeSim();
    startVoice(sim);
    expect(sim.focus).toBe('a');
  });

  it('after a capture, focus advances to the next un-priced row', () => {
    const sim = makeSim();
    startVoice(sim);
    onUtterance(sim, '275');
    expect(sim.drafts.get('a')).toBe(275);
    expect(sim.focus).toBe('b');
  });

  it('pricing the last row exits voice mode and clears focus', () => {
    const sim = makeSim();
    startVoice(sim);
    onUtterance(sim, '275'); // a → focus b
    onUtterance(sim, '500'); // b → focus c
    onUtterance(sim, '55'); // c → none left
    expect(sim.voiceMode).toBe(false);
    expect(sim.focus).toBeNull();
    expect(computeCategoryProgress(ROWS, sim.drafts).priced).toBe(3);
  });
});

// ── HOTFIX-K1 §A — hide items already in the shop's menu ─────────────────────

describe('CategoryListScreen §A — already-in-menu filter (mount)', () => {
  // 18-item category fixture, 12 of which the shop already has in its menu.
  const catalog: CategoryListItemRow[] = Array.from({ length: 18 }, (_, i) => ({
    productId: `p${i}`,
    name: `Item ${i}`,
    packSize: { value: 1, unit: 'kg' },
    mrp: 100,
    imageUrl: '',
  }));

  it('18 catalog items + 12 already in menu → 6 rows shown', () => {
    const existing = new Set(catalog.slice(0, 12).map(r => r.productId));
    const visible = filterCatalogByExistingMenu(catalog, existing);
    expect(visible).toHaveLength(6);
    expect(visible.map(r => r.productId)).toEqual([
      'p12', 'p13', 'p14', 'p15', 'p16', 'p17',
    ]);
  });

  it('all 18 in menu → empty visible list → "all added" empty state', () => {
    const existing = new Set(catalog.map(r => r.productId));
    const visible = filterCatalogByExistingMenu(catalog, existing);
    // Screen shows the "✓ You've already added…" + Go to Menu CTA when the
    // visible list is empty but the catalog total was non-zero.
    const allAdded = visible.length === 0 && catalog.length > 0;
    expect(visible).toHaveLength(0);
    expect(allAdded).toBe(true);
  });
});

// ── HOTFIX-K1 §A — BuildCatalogScreen tile remaining counts ──────────────────

describe('BuildCatalogScreen §A — per-tile remaining-to-add label', () => {
  const partialCat: CategoryListItemRow[] = Array.from({ length: 18 }, (_, i) => ({
    productId: `a${i}`,
    name: `Atta ${i}`,
    packSize: { value: 1, unit: 'kg' },
    mrp: 100,
    imageUrl: '',
  }));

  const tileLabel = (info?: {
    total: number;
    remaining: number;
    allAdded: boolean;
  }) => (info ? (info.allAdded ? 'All added ✓' : `${info.remaining} to add`) : '');

  it('partial coverage (12 of 18) → tile shows "6 to add"', () => {
    const byCat = new Map([['atta_rice_dal', partialCat]]);
    const existing = new Set(partialCat.slice(0, 12).map(r => r.productId));
    const remaining = computeRemainingByCategory(byCat, existing);
    expect(tileLabel(remaining.get('atta_rice_dal'))).toBe('6 to add');
  });

  it('full coverage (18 of 18) → tile shows "All added ✓"', () => {
    const byCat = new Map([['atta_rice_dal', partialCat]]);
    const existing = new Set(partialCat.map(r => r.productId));
    const remaining = computeRemainingByCategory(byCat, existing);
    expect(tileLabel(remaining.get('atta_rice_dal'))).toBe('All added ✓');
  });
});

// ── §F — regression: no stale swipe-card references ──────────────────────────

describe('§F regression — swipe-card screen fully removed', () => {
  it('no "CategoryBrowse" references remain anywhere in src/', () => {
    const srcDir = path.resolve(__dirname, '../../src');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (/\.(ts|tsx)$/.test(entry.name)) {
          if (fs.readFileSync(full, 'utf8').includes('CategoryBrowse')) {
            offenders.push(full);
          }
        }
      }
    };
    walk(srcDir);
    expect(offenders).toEqual([]);
  });
});
