/**
 * Unit tests for `buildAuditLogEntry`.
 *
 * Pins the PR 8 audit-log entry shape. Optional fields MUST be
 * omitted (not undefined-keyed) — this is what keeps Firestore
 * docs clean and avoids index bloat. Mutating that contract should
 * fail tests loudly.
 */
import {
  AuditLogInput,
  buildAuditLogEntry,
} from '../../functions/src/auditLogHelpers';

const FROZEN_NOW = 1_700_000_000_000;
const FROZEN_RAND = () => 'abcdef123456';

const baseInput: AuditLogInput = {
  actorUid: 'admin_uid_1',
  actorRole: 'admin',
  actionType: 'shop.suspend',
  targetType: 'shop',
  targetId: 'shop_42',
};

describe('buildAuditLogEntry', () => {
  test('builds entry with all fields populated', () => {
    const r = buildAuditLogEntry(
      {
        ...baseInput,
        targetSummary: 'Sharma Kirana Store',
        reason: 'repeated complaints',
        metadata: { complaintsCount: 3 },
      },
      FROZEN_NOW,
      FROZEN_RAND,
    );
    expect(r.doc.id).toBe('1700000000000_abcdef123456');
    expect(r.doc.timestamp).toBe(FROZEN_NOW);
    expect(r.doc.actorUid).toBe('admin_uid_1');
    expect(r.doc.actorRole).toBe('admin');
    expect(r.doc.actionType).toBe('shop.suspend');
    expect(r.doc.targetType).toBe('shop');
    expect(r.doc.targetId).toBe('shop_42');
    expect(r.doc.targetSummary).toBe('Sharma Kirana Store');
    expect(r.doc.reason).toBe('repeated complaints');
    expect(r.doc.metadata).toEqual({ complaintsCount: 3 });
  });

  test('id matches doc.id (single source of truth for the entry id)', () => {
    const r = buildAuditLogEntry(baseInput, FROZEN_NOW, FROZEN_RAND);
    expect(r.id).toBe(r.doc.id);
  });

  test('omits optional fields cleanly when not provided', () => {
    const r = buildAuditLogEntry(baseInput, FROZEN_NOW, FROZEN_RAND);
    expect('targetSummary' in r.doc).toBe(false);
    expect('reason' in r.doc).toBe(false);
    expect('metadata' in r.doc).toBe(false);
  });

  test('id is sortable lexicographically by timestamp', () => {
    const earlier = buildAuditLogEntry(
      baseInput,
      1_700_000_000_000,
      () => 'zzz',
    );
    const later = buildAuditLogEntry(
      baseInput,
      1_700_000_000_001,
      () => 'aaa',
    );
    // Lexicographic comparison should put earlier first even though
    // its random suffix is alphabetically later — timestamp prefix
    // wins. This is the property that lets Firestore-console scrolling
    // by id work as a rough chronological view.
    expect(earlier.id < later.id).toBe(true);
  });

  test('uses injected now for deterministic timestamps', () => {
    const r = buildAuditLogEntry(
      baseInput,
      1_700_000_000_000,
      FROZEN_RAND,
    );
    expect(r.doc.timestamp).toBe(1_700_000_000_000);
  });

  test('preserves nested metadata structure (objects, arrays, numbers)', () => {
    const meta = {
      before: { deliveryFee: 30, minOrder: 100 },
      after: { deliveryFee: 40, minOrder: 150 },
      changedFields: ['deliveryFee', 'minOrder'],
      counts: { revisions: 2 },
    };
    const r = buildAuditLogEntry(
      { ...baseInput, metadata: meta },
      FROZEN_NOW,
      FROZEN_RAND,
    );
    expect(r.doc.metadata).toEqual(meta);
  });

  test('actorRole=system supported (cleanup cron actor)', () => {
    const r = buildAuditLogEntry(
      {
        actorUid: 'cleanupAbandonedOrders',
        actorRole: 'system',
        actionType: 'order.cancel_abandoned',
        targetType: 'order',
        targetId: 'order_123',
      },
      FROZEN_NOW,
      FROZEN_RAND,
    );
    expect(r.doc.actorRole).toBe('system');
  });

  test('actorRole=shopOwner supported (bulk menu / settings)', () => {
    const r = buildAuditLogEntry(
      {
        actorUid: 'shopowner_uid_1',
        actorRole: 'shopOwner',
        actionType: 'shop.bulk_menu_availability',
        targetType: 'shop',
        targetId: 'shop_42',
        metadata: { count: 5, available: false },
      },
      FROZEN_NOW,
      FROZEN_RAND,
    );
    expect(r.doc.actorRole).toBe('shopOwner');
    expect(r.doc.actionType).toBe('shop.bulk_menu_availability');
  });

  // PR 8.1 — 'customer' is now a first-class actor role. Pins the
  // union-widening so a future regression that drops 'customer' from
  // the type goes red here, not in production.
  test('actorRole=customer supported (in-window paid-order self-cancel)', () => {
    const r = buildAuditLogEntry(
      {
        actorUid: 'customer_uid_42',
        actorRole: 'customer',
        actionType: 'order.cancel_by_customer_window',
        targetType: 'order',
        targetId: 'order_99',
        reason: 'changed mind',
      },
      FROZEN_NOW,
      FROZEN_RAND,
    );
    expect(r.doc.actorRole).toBe('customer');
    expect(r.doc.actorUid).toBe('customer_uid_42');
    expect(r.doc.actionType).toBe('order.cancel_by_customer_window');
    expect(r.doc.reason).toBe('changed mind');
  });

  test('default rand fn produces different ids when called rapidly', () => {
    // Sanity: the default (Math.random) suffix should diverge across
    // calls, so two entries created in the same millisecond don't
    // collide on id.
    const r1 = buildAuditLogEntry(baseInput, FROZEN_NOW);
    const r2 = buildAuditLogEntry(baseInput, FROZEN_NOW);
    expect(r1.id).not.toBe(r2.id);
  });
});
