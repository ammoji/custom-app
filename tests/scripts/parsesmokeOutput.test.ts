/**
 * HOTFIX-POST-DEPLOY-SMOKE-SCRIPT — unit tests for the pure CLI-output
 * parsers backing scripts/post-deploy-smoke.ts. These pin the
 * interpretation logic against captured gcloud / firebase sample output
 * so the smoke script's pass/fail decisions are verifiable without live
 * cloud calls.
 */

import {
  parseIamPolicyOutput,
  parseIndexesOutput,
  parseProjectFlag,
} from '../../scripts/parsesmokeOutput';

describe('parseIamPolicyOutput', () => {
  it('detects a healthy allUsers run.invoker binding', () => {
    const sample = [
      'bindings:',
      '- members:',
      '  - allUsers',
      '  role: roles/run.invoker',
      "etag: BwYabc123=",
      'version: 1',
    ].join('\n');
    const r = parseIamPolicyOutput(sample);
    expect(r.hasAllUsers).toBe(true);
    expect(r.etag).toBe('BwYabc123=');
  });

  it('flags the ACAB empty-policy etag as missing allUsers', () => {
    const sample = 'etag: ACAB\nversion: 1\n';
    const r = parseIamPolicyOutput(sample);
    expect(r.hasAllUsers).toBe(false);
    expect(r.etag).toBe('ACAB');
  });

  it('flags a policy that never mentions allUsers/run.invoker', () => {
    const sample = [
      'bindings:',
      '- members:',
      '  - serviceAccount:deploy@x.iam.gserviceaccount.com',
      '  role: roles/run.developer',
      'etag: BwYzzz=',
    ].join('\n');
    expect(parseIamPolicyOutput(sample).hasAllUsers).toBe(false);
  });
});

describe('parseIndexesOutput', () => {
  it('counts building vs enabled from JSON output', () => {
    const sample = JSON.stringify({
      indexes: [
        { state: 'READY' },
        { state: 'CREATING' },
        { state: 'READY' },
      ],
    });
    const r = parseIndexesOutput(sample);
    expect(r.building).toBe(1);
    expect(r.enabled).toBe(2);
  });

  it('counts building tokens from human table output', () => {
    const sample = [
      '┌─ index ─┬─ state ─┐',
      '│ reviews │ CREATING │',
      '│ orders  │ READY    │',
      '└─────────┴──────────┘',
    ].join('\n');
    const r = parseIndexesOutput(sample);
    expect(r.building).toBe(1);
    expect(r.enabled).toBe(1);
  });

  it('reports zero building when all indexes are ready', () => {
    const sample = JSON.stringify([{ state: 'READY' }, { state: 'READY' }]);
    expect(parseIndexesOutput(sample).building).toBe(0);
  });
});

describe('parseProjectFlag', () => {
  it('parses --project=value form', () => {
    expect(parseProjectFlag(['--project=grocery-mvp-dev'])).toBe(
      'grocery-mvp-dev',
    );
  });

  it('parses --project value form', () => {
    expect(parseProjectFlag(['--project', 'other-proj'])).toBe('other-proj');
  });

  it('returns null when the flag is absent', () => {
    expect(parseProjectFlag(['--indexes-only'])).toBeNull();
  });
});
