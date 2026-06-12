/**
 * PR-NEXT-BUNDLE-H §A — pure helper that maps the current state of
 * a delivered + rated order to the customer-facing review correction
 * view model.
 *
 * Returns a discriminated union so the component can exhaustively
 * switch on `kind` with no unsafe property access.
 *
 * Pinned by tests/utils/deriveCustomerReviewResponseView.test.ts.
 */

export type ResponderIdentity =
  | { kind: 'shop'; name: string; photoUrl?: string | null }
  | { kind: 'partner'; name: string; photoUrl?: string | null };

export type CustomerReviewResponseView =
  | { kind: 'none' }
  | { kind: 'awaiting' }
  | {
      kind: 'responded';
      responder: ResponderIdentity;
      responseText: string;
      responseAt?: number | null;
      ratingId: string;
      orderId: string;
      shopName?: string | null;
      shopRating: number;
      deliveryPersonName?: string | null;
      deliveryPersonPhotoUrl?: string | null;
      responseBy: 'shop' | 'partner';
      // PR-NEXT-BUNDLE-J §H — DO NOT REMOVE. Which dimension this panel
      // represents + that dimension's current stars. Drives the amend/ack
      // navigation so the customer corrects the RIGHT side independently.
      dimension: 'shop' | 'delivery';
      stars: number;
    }
  | { kind: 'amended' }
  | { kind: 'published' };

export function deriveCustomerReviewResponseView(order: {
  correctionState?: string | null;
  responseText?: string | null;
  responseBy?: string | null;
  responseAt?: number | null;
  ratingId?: string | null;
  id: string;
  shopName?: string | null;
  shopRating?: number | null;
  deliveryPersonName?: string | null;
  deliveryPersonPhotoUrl?: string | null;
}): CustomerReviewResponseView {
  const state = order.correctionState;
  if (!state) return { kind: 'none' };

  if (state === 'flagged_low') return { kind: 'awaiting' };

  if (state === 'responded') {
    // All required fields must be present to render the responded state
    if (
      typeof order.responseText !== 'string' ||
      !order.responseText.trim() ||
      typeof order.ratingId !== 'string' ||
      !order.ratingId
    ) {
      return { kind: 'none' };
    }
    const responseBy = order.responseBy as 'shop' | 'partner' | null | undefined;
    const responder: ResponderIdentity =
      responseBy === 'partner'
        ? {
            kind: 'partner',
            name: order.deliveryPersonName ?? 'Delivery partner',
            photoUrl: order.deliveryPersonPhotoUrl ?? null,
          }
        : {
            kind: 'shop',
            name: order.shopName ?? 'Shop',
            photoUrl: null,
          };

    return {
      kind: 'responded',
      responder,
      responseText: order.responseText.trim(),
      responseAt: order.responseAt ?? null,
      ratingId: order.ratingId,
      orderId: order.id,
      shopName: order.shopName ?? null,
      shopRating: order.shopRating ?? 0,
      deliveryPersonName: order.deliveryPersonName ?? null,
      deliveryPersonPhotoUrl: order.deliveryPersonPhotoUrl ?? null,
      responseBy: responseBy ?? 'shop',
      dimension: responseBy === 'partner' ? 'delivery' : 'shop',
      stars: order.shopRating ?? 0,
    };
  }

  if (state === 'amended') return { kind: 'amended' };
  if (state === 'published') return { kind: 'published' };

  return { kind: 'none' };
}

// ─── PR-NEXT-BUNDLE-J §H — per-dimension customer panels ─────────────────────

export type CustomerReviewPanels = {
  shop: CustomerReviewResponseView;
  delivery: CustomerReviewResponseView;
};

type PerDimOrder = {
  id: string;
  shopName?: string | null;
  shopRating?: number | null;
  deliveryRating?: number | null;
  ratingId?: string | null;
  deliveryPersonName?: string | null;
  deliveryPersonPhotoUrl?: string | null;
  correctionState?: string | null;
  responseText?: string | null;
  responseBy?: string | null;
  responseAt?: number | null;
  shopCorrectionState?: string | null;
  deliveryCorrectionState?: string | null;
  shopResponseText?: string | null;
  partnerResponseText?: string | null;
  shopRespondedAt?: number | null;
  partnerRespondedAt?: number | null;
};

function deriveDimensionView(
  order: PerDimOrder,
  dimension: 'shop' | 'delivery',
): CustomerReviewResponseView {
  const state =
    dimension === 'shop' ? order.shopCorrectionState : order.deliveryCorrectionState;
  if (!state || state === 'n_a') return { kind: 'none' };
  if (state === 'flagged_low') return { kind: 'awaiting' };

  if (state === 'responded') {
    const responseText =
      dimension === 'shop' ? order.shopResponseText : order.partnerResponseText;
    if (
      typeof responseText !== 'string' ||
      !responseText.trim() ||
      typeof order.ratingId !== 'string' ||
      !order.ratingId
    ) {
      return { kind: 'none' };
    }
    const responder: ResponderIdentity =
      dimension === 'delivery'
        ? {
            kind: 'partner',
            name: order.deliveryPersonName ?? 'Delivery partner',
            photoUrl: order.deliveryPersonPhotoUrl ?? null,
          }
        : { kind: 'shop', name: order.shopName ?? 'Shop', photoUrl: null };
    const stars =
      (dimension === 'shop' ? order.shopRating : order.deliveryRating) ?? 0;
    return {
      kind: 'responded',
      responder,
      responseText: responseText.trim(),
      responseAt:
        (dimension === 'shop' ? order.shopRespondedAt : order.partnerRespondedAt) ??
        null,
      ratingId: order.ratingId,
      orderId: order.id,
      shopName: order.shopName ?? null,
      shopRating: stars,
      deliveryPersonName: order.deliveryPersonName ?? null,
      deliveryPersonPhotoUrl: order.deliveryPersonPhotoUrl ?? null,
      responseBy: dimension === 'delivery' ? 'partner' : 'shop',
      dimension,
      stars,
    };
  }

  if (state === 'amended') return { kind: 'amended' };
  if (state === 'published') return { kind: 'published' };
  return { kind: 'none' };
}

/**
 * PR-NEXT-BUNDLE-J §H — DO NOT REMOVE. Per-dimension customer panels. The
 * shop + delivery review sides are independent (Sudhir 2026-06-10), so the
 * customer sees + corrects each separately. Falls back to the legacy single
 * panel (rendered as the shop slot) for pre-Bundle-J orders that have no
 * per-dimension fields, preserving behavior until the backfill runs.
 */
export function deriveCustomerReviewPanels(order: PerDimOrder): CustomerReviewPanels {
  const migrated =
    order.shopCorrectionState != null || order.deliveryCorrectionState != null;
  if (!migrated) {
    return {
      shop: deriveCustomerReviewResponseView(order),
      delivery: { kind: 'none' },
    };
  }
  return {
    shop: deriveDimensionView(order, 'shop'),
    delivery: deriveDimensionView(order, 'delivery'),
  };
}
