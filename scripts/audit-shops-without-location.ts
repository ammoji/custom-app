/**
 * PR-NEXT-SHOP-LOCATION-REQUIRED — operational pre-deploy audit.
 *
 * Lists every shop currently in Firestore whose `location` field is
 * missing or out of valid earth-coordinate range. Pre-deploy hook so
 * Sudhir can identify the small set of legacy / mis-registered shops
 * that will become invisible to customers post-deploy (the new
 * `filterShopsByServiceRadius` shop-side-gap branch fail-CLOSEDs
 * them) and warn their owners BEFORE the OTA rolls.
 *
 * Decision per the PR's §E: location-less active shops are LET to
 * disappear post-deploy. Owners re-capture via a new RegisterShop
 * pass; admin re-approves via the new verification gate. This script
 * is the diagnostic affordance, not a fixer.
 *
 * Run: `npx tsx scripts/audit-shops-without-location.ts`
 *
 * Output: tab-separated `shopId<TAB>status<TAB>name<TAB>ownerUid<TAB>reason`
 * for every offending shop, plus a summary line. Exit code 0 either way
 * (this is informational, not a CI gate).
 */
import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const serviceAccount = require('../service-account.json');

import { validateShopLocationForApproval } from '../functions/src/approveShopHelpers';

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

async function main() {
  const snap = await db.collection('shops').get();
  const offenders: Array<{
    id: string;
    status: string;
    name: string;
    ownerUid: string;
    reason: string;
  }> = [];
  let total = 0;
  for (const doc of snap.docs) {
    total++;
    const data = doc.data() as {
      status?: string;
      name?: string;
      ownerUid?: string;
      location?: { lat?: unknown; lng?: unknown } | null;
    };
    const r = validateShopLocationForApproval({ location: data.location });
    if (!r.ok) {
      offenders.push({
        id: doc.id,
        status: data.status ?? '<no-status>',
        name: data.name ?? '<no-name>',
        ownerUid: data.ownerUid ?? '<no-owner>',
        reason: r.code,
      });
    }
  }
  console.log('shopId\tstatus\tname\townerUid\treason');
  for (const o of offenders) {
    console.log(
      `${o.id}\t${o.status}\t${o.name}\t${o.ownerUid}\t${o.reason}`,
    );
  }
  console.log('');
  console.log(
    `[audit-shops-without-location] ${offenders.length} of ${total} shops have no valid GPS location.`,
  );
  const activeOffenders = offenders.filter(o => o.status === 'active');
  if (activeOffenders.length > 0) {
    console.log(
      `[audit-shops-without-location] WARNING: ${activeOffenders.length} of those are CURRENTLY ACTIVE — they will become invisible to customers after PR-NEXT-SHOP-LOCATION-REQUIRED ships. Coordinate with their owners BEFORE deploying.`,
    );
  }
  process.exit(0);
}

main().catch(err => {
  console.error('[audit-shops-without-location] failed:', err);
  process.exit(1);
});
