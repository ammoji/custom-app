/**
 * Tests for scripts/audit-firestore-indexes.ts.
 *
 * The audit catches the v2-iv "Shop Dashboard INTERNAL" bug class:
 * a composite Firestore query in functions/src/index.ts with no
 * matching entry in firestore.indexes.json. Pin the parser +
 * matcher logic so the audit doesn't false-pass under a refactor.
 */
import {
    indexCovers,
    isComposite,
    parseQueries,
    type IndexDef,
    type ParsedQuery,
} from '../../scripts/audit-firestore-indexes';

const mkQuery = (over: Partial<ParsedQuery>): ParsedQuery => ({
  collection: 'orders',
  whereEq: [],
  whereIn: [],
  orderBy: [],
  loc: 'test:1',
  ...over,
});

describe('isComposite', () => {
  test('single equality filter alone — single-field, NOT composite', () => {
    expect(isComposite(mkQuery({ whereEq: ['shopId'] }))).toBe(false);
  });

  test('single orderBy alone — single-field, NOT composite', () => {
    expect(
      isComposite(
        mkQuery({ orderBy: [{ field: 'createdAt', dir: 'DESCENDING' }] }),
      ),
    ).toBe(false);
  });

  test('equality + orderBy on the SAME field — single-field, NOT composite', () => {
    // A `.where('createdAt', '==', X).orderBy('createdAt', 'asc')` is
    // covered by the auto-built single-field index.
    expect(
      isComposite(
        mkQuery({
          whereEq: ['createdAt'],
          orderBy: [{ field: 'createdAt', dir: 'ASCENDING' }],
        }),
      ),
    ).toBe(false);
  });

  test('equality + orderBy on DIFFERENT fields — composite (the v2-iv bug shape)', () => {
    expect(
      isComposite(
        mkQuery({
          whereEq: ['shopId'],
          orderBy: [{ field: 'createdAt', dir: 'DESCENDING' }],
        }),
      ),
    ).toBe(true);
  });

  test('two equality filters on different fields, no orderBy — NOT composite (Firestore intersects single-field indexes)', () => {
    // Firestore implicitly serves multi-equality queries by
    // intersecting single-field indexes. The audit must NOT flag
    // these — sendNewPickupPushToDelivery uses
    // `where('isDelivery', '==', true).where('deliveryStatus', '==', 'online')`
    // and that's a documented Firestore-supported pattern.
    expect(
      isComposite(mkQuery({ whereEq: ['isDelivery', 'deliveryStatus'] })),
    ).toBe(false);
  });

  test('two equality filters PLUS an orderBy on a third field — composite', () => {
    expect(
      isComposite(
        mkQuery({
          whereEq: ['status', 'deliveryPersonId'],
          orderBy: [{ field: 'createdAt', dir: 'ASCENDING' }],
        }),
      ),
    ).toBe(true);
  });

  test('two orderBy fields — composite', () => {
    expect(
      isComposite(
        mkQuery({
          orderBy: [
            { field: 'status', dir: 'ASCENDING' },
            { field: 'createdAt', dir: 'DESCENDING' },
          ],
        }),
      ),
    ).toBe(true);
  });
});

describe('indexCovers', () => {
  test('covers when fields and direction match exactly', () => {
    const q = mkQuery({
      whereEq: ['shopId'],
      orderBy: [{ field: 'createdAt', dir: 'DESCENDING' }],
    });
    const idx: IndexDef = {
      collectionGroup: 'orders',
      fields: [
        { fieldPath: 'shopId', order: 'ASCENDING' },
        { fieldPath: 'createdAt', order: 'DESCENDING' },
      ],
    };
    expect(indexCovers(q, idx)).toBe(true);
  });

  test('rejects when collectionGroup differs', () => {
    const q = mkQuery({
      whereEq: ['shopId'],
      orderBy: [{ field: 'createdAt', dir: 'DESCENDING' }],
    });
    const idx: IndexDef = {
      collectionGroup: 'shops',
      fields: [
        { fieldPath: 'shopId', order: 'ASCENDING' },
        { fieldPath: 'createdAt', order: 'DESCENDING' },
      ],
    };
    expect(indexCovers(q, idx)).toBe(false);
  });

  test('rejects when an equality field is missing from the index', () => {
    const q = mkQuery({
      whereEq: ['shopId', 'status'],
      orderBy: [{ field: 'createdAt', dir: 'DESCENDING' }],
    });
    const idx: IndexDef = {
      collectionGroup: 'orders',
      fields: [
        { fieldPath: 'shopId', order: 'ASCENDING' },
        { fieldPath: 'createdAt', order: 'DESCENDING' },
      ],
    };
    expect(indexCovers(q, idx)).toBe(false);
  });

  test('rejects when orderBy direction differs', () => {
    const q = mkQuery({
      whereEq: ['shopId'],
      orderBy: [{ field: 'createdAt', dir: 'ASCENDING' }],
    });
    const idx: IndexDef = {
      collectionGroup: 'orders',
      fields: [
        { fieldPath: 'shopId', order: 'ASCENDING' },
        { fieldPath: 'createdAt', order: 'DESCENDING' },
      ],
    };
    expect(indexCovers(q, idx)).toBe(false);
  });
});

describe('parseQueries', () => {
  test('extracts collection + whereEq + orderBy from a chain', () => {
    const src = `
      const snap = await db
        .collection('orders')
        .where('shopId', '==', targetShopId)
        .orderBy('createdAt', 'desc')
        .limit(100)
        .get();
    `;
    const qs = parseQueries(src, 'sample.ts');
    expect(qs).toHaveLength(1);
    expect(qs[0].collection).toBe('orders');
    expect(qs[0].whereEq).toEqual(['shopId']);
    expect(qs[0].orderBy).toEqual([
      { field: 'createdAt', dir: 'DESCENDING' },
    ]);
  });

  test('ignores .collection inside line comments', () => {
    const src = `
      // .collection('IGNORED').where('x', '==', 1)
      const snap = await db.collection('orders').get();
    `;
    const qs = parseQueries(src, 'sample.ts');
    expect(qs.map(q => q.collection)).toEqual(['orders']);
  });

  test('extracts multiple chains independently', () => {
    const src = `
      await db.collection('orders').where('shopId', '==', s).orderBy('createdAt', 'desc').get();
      await db.collection('shops').where('status', '==', 'active').orderBy('rating', 'desc').limit(10).get();
    `;
    const qs = parseQueries(src, 'sample.ts');
    expect(qs).toHaveLength(2);
    expect(qs[0].collection).toBe('orders');
    expect(qs[1].collection).toBe('shops');
    expect(qs[1].whereEq).toEqual(['status']);
  });
});
