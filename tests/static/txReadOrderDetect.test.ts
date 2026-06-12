/**
 * HOTFIX-PUBLISH-TX-ORDER §C — +2 unit tests pinning the read-order
 * detection logic on synthetic transaction bodies. Proves the static
 * guard's detector flags the violating shape and passes the correct one.
 */
import { extractTransactionBodies, hasReadAfterWrite } from './txReadOrderDetect';

const GOOD = `
runTransaction(async tx => {
  const a = await tx.get(refA);
  const b = await tx.get(refB);
  tx.set(refA, {});
  tx.set(refB, {});
});
`;

const BAD = `
runTransaction(async tx => {
  tx.set(refA, {});
  const b = await tx.get(refB);
  tx.set(refB, {});
});
`;

describe('tx read-order detection', () => {
  it('flags a body with tx.get after tx.set (violation)', () => {
    const bodies = extractTransactionBodies(BAD);
    expect(bodies).toHaveLength(1);
    expect(hasReadAfterWrite(bodies[0])).toBe(true);
  });

  it('passes a body with all reads before all writes', () => {
    const bodies = extractTransactionBodies(GOOD);
    expect(bodies).toHaveLength(1);
    expect(hasReadAfterWrite(bodies[0])).toBe(false);
  });
});
