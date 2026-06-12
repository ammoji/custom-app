/**
 * HOTFIX-SILENT-CATCH-GUARD — +detection units for the silent-catch
 * detector. Proves the guard catches empty / comment-only bodies and
 * ignores bodies that report, log, set error state, or are allowlisted.
 */
import {
  findSilentCatches,
  isCatchBodyAcceptable,
} from './noSilentCatchDetect';

describe('noSilentCatchDetect', () => {
  it('flags an empty-body catch', () => {
    const src = `fetch().catch(() => {});`;
    expect(findSilentCatches(src)).toEqual([1]);
  });

  it('flags a comment-only catch body', () => {
    const src = [
      'orderService.load()',
      '  .then(setRows)',
      '  .catch(() => {',
      '    /* silent — section stays empty on failure */',
      '  });',
    ].join('\n');
    expect(findSilentCatches(src)).toEqual([3]);
  });

  it('ignores a catch that reports to Sentry', () => {
    const src = `load().catch(e => { Sentry.captureException(e); });`;
    expect(findSilentCatches(src)).toEqual([]);
  });

  it('ignores a catch that sets an error state', () => {
    const src = `load().catch(e => { setLoadError(e?.message); });`;
    expect(findSilentCatches(src)).toEqual([]);
  });

  it('ignores a catch that sets plain setError (not just setXxxError)', () => {
    const src = `load().catch(e => { setError(e?.message ?? 'failed'); });`;
    expect(findSilentCatches(src)).toEqual([]);
  });

  it('ignores a catch that logs via console.warn', () => {
    const src = `load().catch(e => { console.warn('[x] failed', e); });`;
    expect(findSilentCatches(src)).toEqual([]);
  });

  it('respects an inline silent-catch-audit:allow annotation', () => {
    const src = `Linking.openURL(url).catch(() => {}); // silent-catch-audit:allow telephony best-effort`;
    expect(findSilentCatches(src)).toEqual([]);
  });

  it('respects an allow annotation on the line above', () => {
    const src = [
      '// silent-catch-audit:allow haptics unavailable is not a failure',
      'Haptics.notificationAsync(t).catch(() => {});',
    ].join('\n');
    expect(findSilentCatches(src)).toEqual([]);
  });

  it('does not treat a .catch inside a comment as code', () => {
    const src = `// callers should .catch(() => {}) to stay non-blocking`;
    expect(findSilentCatches(src)).toEqual([]);
  });

  it('brace matcher ignores braces inside strings', () => {
    const src = `load().catch(() => { const s = '}'; setLoadError(s); });`;
    expect(findSilentCatches(src)).toEqual([]);
  });

  it('isCatchBodyAcceptable ignores tokens that only appear in comments', () => {
    expect(isCatchBodyAcceptable('/* throw later */')).toBe(false);
    expect(isCatchBodyAcceptable('throw e;')).toBe(true);
  });
});
