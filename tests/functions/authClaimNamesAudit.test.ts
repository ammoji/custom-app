/**
 * HOTFIX-RATING-RESPONSE — regression guard.
 *
 * Auth-token claims are named `admin`, `shopOwner`, `delivery`, `shopId`
 * (set via setCustomUserClaims). The `isAdmin` / `isShopOwner` /
 * `isDelivery` variants are USER-DOC MIRROR fields and are NEVER present
 * on `request.auth.token`. Reading `claims.isAdmin === true` therefore
 * always evaluates false and yields a spurious `permission-denied`.
 *
 * This bug shipped at least three times (respondToReview,
 * updateShopRatingAlertSettings, updateAdminRatingAlertConfig). This test
 * statically scans functions/src for the offending pattern so it can
 * never regress. Mirrors the audit-grep referenced in the DO-NOT-REMOVE
 * comments: grep -rn "claims\.is[A-Z]" functions/src
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const SRC_DIR = path.resolve(__dirname, '../../functions/src');

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectTsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('auth-token claim names audit (HOTFIX-RATING-RESPONSE)', () => {
  // Matches claims.isAdmin / claims.isShopOwner / claims.isDelivery etc.
  // (token.is... is a different, legitimate access shape and is not scanned
  // here because the offending pattern was specifically `claims.is`).
  const OFFENDER = /claims\.is[A-Z]/;

  it('has zero `claims.is<PascalCase>` reads anywhere in functions/src', () => {
    const offenders: string[] = [];
    for (const file of collectTsFiles(SRC_DIR)) {
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, idx) => {
        if (OFFENDER.test(line)) {
          offenders.push(`${path.basename(file)}:${idx + 1}  ${line.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
