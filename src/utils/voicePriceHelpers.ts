/**
 * PR-NEXT-BUNDLE-K §D — Voice price input pure helpers.
 *
 * `parseVoicePriceInput` turns a raw STT transcript into a price
 * (rupees, integer). No network calls — pure string processing so
 * it can be unit-tested without the Firebase emulator or audio stack.
 *
 * Confidence rules:
 *   - 'high'  → exactly one plausible number found, no ambiguity
 *   - 'low'   → multiple number candidates or spoken form not recognized
 *   - null    → no number detected at all
 */

// ── Hindi digit words ────────────────────────────────────────────────────────

const HINDI_ONES: Record<string, number> = {
  शून्य: 0, एक: 1, दो: 2, तीन: 3, चार: 4, पाँच: 5, पांच: 5,
  छह: 6, छः: 6, सात: 7, आठ: 8, नौ: 9, दस: 10,
  ग्यारह: 11, बारह: 12, तेरह: 13, चौदह: 14, पंद्रह: 15,
  सोलह: 16, सत्रह: 17, अठारह: 18, उन्नीस: 19, बीस: 20,
  तीस: 30, चालीस: 40, पचास: 50, साठ: 60, सत्तर: 70,
  अस्सी: 80, नब्बे: 90,
};

const HINDI_SCALES: Record<string, number> = {
  सौ: 100, हज़ार: 1000, हजार: 1000, लाख: 100000,
};

// ── Transliteration map (latin approximation → canonical hindi) ──────────────

const TRANSLIT_MAP: Record<string, string> = {
  ek: 'एक', do: 'दो', teen: 'तीन', char: 'चार', paanch: 'पाँच',
  chhe: 'छह', saat: 'सात', aath: 'आठ', nau: 'नौ', das: 'दस',
  gyarah: 'ग्यारह', barah: 'बारह', terah: 'तेरह', chaudah: 'चौदह',
  pandrah: 'पंद्रह', solah: 'सोलह', satrah: 'सत्रह', attharah: 'अठारह',
  unnees: 'उन्नीस', bees: 'बीस', tees: 'तीस', chaalees: 'चालीस',
  pachaas: 'पचास', saath: 'साठ', sattar: 'सत्तर', assi: 'अस्सी', nabbe: 'नब्बे',
  sau: 'सौ', hazaar: 'हज़ार', lakh: 'लाख',
  rupay: '', rupaye: '', rupees: '', rupe: '', rs: '', '₹': '',
};

// ── Main parser ──────────────────────────────────────────────────────────────

export type VoicePriceParseResult =
  | { price: number; confidence: 'high' | 'low' }
  | { price: null; confidence: null };

/**
 * Parse a raw STT transcript to extract a price (₹, integer).
 *
 * @param text     Raw transcript from STT (Hindi or English)
 * @param lang     'hi' for Hindi-first parsing, 'en' for English-first
 * @returns        `{ price, confidence }` — price is null if nothing found
 */
export function parseVoicePriceInput(
  text: string,
  lang: 'hi' | 'en',
): VoicePriceParseResult {
  if (!text || text.trim().length === 0) {
    return { price: null, confidence: null };
  }

  const normalized = text.trim().toLowerCase();

  // Step 1: strip currency markers + noise words
  const stripped = normalized
    .replace(/₹/g, ' ')
    .replace(/\brupee?s?\b/gi, ' ')
    .replace(/\brupaye?\b/gi, ' ')
    .replace(/\brs\.?\b/gi, ' ')
    .trim();

  // Step 2: try direct numeric extraction (Arabic digits)
  const numericCandidates = extractNumericCandidates(stripped);

  if (numericCandidates.length === 1) {
    const val = numericCandidates[0];
    if (val >= 1 && val <= 99999) {
      return { price: Math.round(val), confidence: 'high' };
    }
  }
  if (numericCandidates.length > 1) {
    // Multiple numbers — pick the largest as price heuristic, low confidence
    const sorted = [...numericCandidates].sort((a, b) => b - a);
    const val = sorted[0];
    if (val >= 1 && val <= 99999) {
      return { price: Math.round(val), confidence: 'low' };
    }
  }

  // Step 3: try spoken-word Hindi parsing
  if (lang === 'hi') {
    const hindiResult = parseHindiSpokenNumber(stripped);
    if (hindiResult !== null && hindiResult >= 1 && hindiResult <= 99999) {
      return { price: Math.round(hindiResult), confidence: 'high' };
    }
  }

  // Step 4: try English spoken-word parsing
  const englishResult = parseEnglishSpokenNumber(stripped);
  if (englishResult !== null && englishResult >= 1 && englishResult <= 99999) {
    return { price: Math.round(englishResult), confidence: 'high' };
  }

  return { price: null, confidence: null };
}

// ── Numeric extraction ────────────────────────────────────────────────────────

function extractNumericCandidates(text: string): number[] {
  const matches = text.match(/\d+(\.\d+)?/g);
  if (!matches) return [];
  return matches
    .map(m => parseFloat(m))
    .filter(n => Number.isFinite(n) && n > 0);
}

// ── Hindi spoken-number parser ────────────────────────────────────────────────

function parseHindiSpokenNumber(text: string): number | null {
  // Normalize transliterated forms to Hindi unicode
  let normalized = text;
  for (const [latin, hindi] of Object.entries(TRANSLIT_MAP)) {
    normalized = normalized.replace(new RegExp(`\\b${latin}\\b`, 'gi'), hindi);
  }

  const tokens = normalized.split(/[\s,]+/).filter(Boolean);
  let total = 0;
  let current = 0;

  for (const token of tokens) {
    if (HINDI_ONES[token] !== undefined) {
      current += HINDI_ONES[token];
    } else if (HINDI_SCALES[token] !== undefined) {
      const scale = HINDI_SCALES[token];
      if (current === 0) current = 1;
      if (scale >= 1000) {
        total += current * scale;
        current = 0;
      } else {
        current *= scale;
      }
    }
  }
  total += current;
  return total > 0 ? total : null;
}

// ── English spoken-number parser ─────────────────────────────────────────────

const ENGLISH_ONES: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40,
  fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

const ENGLISH_SCALES: Record<string, number> = {
  hundred: 100, thousand: 1000, lakh: 100000,
};

function parseEnglishSpokenNumber(text: string): number | null {
  const tokens = text.split(/[\s,]+/).filter(Boolean);
  let total = 0;
  let current = 0;

  for (const token of tokens) {
    if (ENGLISH_ONES[token] !== undefined) {
      current += ENGLISH_ONES[token];
    } else if (ENGLISH_SCALES[token] !== undefined) {
      const scale = ENGLISH_SCALES[token];
      if (current === 0) current = 1;
      if (scale >= 1000) {
        total += current * scale;
        current = 0;
      } else {
        current *= scale;
      }
    }
  }
  total += current;
  return total > 0 ? total : null;
}
