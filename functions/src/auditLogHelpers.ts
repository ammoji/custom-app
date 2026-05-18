/**
 * PR 8 Part A — pure helper for the admin audit log.
 *
 * Background: admin actions (revoke/suspend/approve/reject/refund/
 * settings-change) historically wrote `statusHistory` entries on
 * the affected doc, but there was no central log. Trust + governance
 * needs "who did what when" auditable in one place. This helper
 * builds an entry; the server-side writer (writeAuditLog in
 * index.ts) does the actual Firestore write.
 *
 * Design posture:
 * - Pure: no Firestore access, no clock — `now` is injected so
 *   tests are deterministic. Same posture as
 *   cancelPaidOrderHelpers / customerCancelWindowHelpers.
 * - Optional fields are OMITTED from the doc if unset (not written
 *   as `undefined` or `null`) so the Firestore doc stays clean and
 *   query indexes don't get bloated by phantom fields.
 * - actionType is a free string at the helper boundary because the
 *   set is defined inline in callable wiring; the helper doesn't
 *   need to know the enum. Keeping it loose lets future PRs add
 *   action types without touching this file. Audit consumers
 *   (AuditLogScreen) own the canonical label mapping.
 *
 * actorRole + targetType ARE constrained to string-literal unions
 * because they're orthogonal to action specifics and we don't want
 * a typo (`'shopowner'` lowercase) silently slipping through. Not
 * runtime-enforced — TS catches at the call site.
 *
 * Pinned by tests/functions/auditLogHelpers.test.ts.
 */

// PR 8.1 — 'customer' added as a first-class actor role so
// customer-driven actions (currently only the in-window paid-order
// cancel) stop having to masquerade as 'system'. 'system' now
// strictly means cron / cleanup. Order: admin → shopOwner →
// customer → system, roughly trust-tier descending.
export type AuditActorRole =
  | 'admin'
  | 'shopOwner'
  | 'customer'
  | 'system';
export type AuditTargetType =
  | 'shop'
  | 'user'
  | 'order'
  | 'delivery_request'
  | 'refund';

export type AuditLogInput = {
  actorUid: string;
  actorRole: AuditActorRole;
  actionType: string;
  targetType: AuditTargetType;
  targetId: string;
  targetSummary?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
};

export type AuditLogEntry = {
  id: string;
  doc: {
    id: string;
    timestamp: number;
    actorUid: string;
    actorRole: AuditActorRole;
    actionType: string;
    targetType: AuditTargetType;
    targetId: string;
    // Optional fields only present if non-undefined input.
    targetSummary?: string;
    reason?: string;
    metadata?: Record<string, unknown>;
  };
};

export function buildAuditLogEntry(
  input: AuditLogInput,
  now: number = Date.now(),
  // Injected for test determinism. Default uses a 12-char base36
  // suffix on the timestamp — collision-resistant within a ms.
  randSuffix: () => string = () =>
    Math.random().toString(36).slice(2, 14),
): AuditLogEntry {
  // Audit IDs are sortable lexicographically by timestamp, which
  // helps debugging in the Firestore console without an explicit
  // orderBy. Format: `{timestamp}_{rand12}`.
  const id = `${now}_${randSuffix()}`;
  const doc: AuditLogEntry['doc'] = {
    id,
    timestamp: now,
    actorUid: input.actorUid,
    actorRole: input.actorRole,
    actionType: input.actionType,
    targetType: input.targetType,
    targetId: input.targetId,
  };
  // Only attach optionals when present. Firestore treats
  // `field: undefined` as a hard error in some SDK versions;
  // omitting the key entirely is the safe default.
  if (input.targetSummary !== undefined) {
    doc.targetSummary = input.targetSummary;
  }
  if (input.reason !== undefined) {
    doc.reason = input.reason;
  }
  if (input.metadata !== undefined) {
    doc.metadata = input.metadata;
  }
  return { id, doc };
}
