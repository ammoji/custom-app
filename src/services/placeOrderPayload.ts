/**
 * Pure helper that compacts a cart's CartItem[] into the wire shape
 * placeOrder expects on the server (`ClientItem` in
 * functions/src/index.ts). Extracted so the v2-iii dispatch fields
 * (menuItemId, priceSnapshot) are guaranteed to be forwarded — the
 * original inline `.map(...)` in orderService.placeOrder silently
 * dropped them, which forced every order through the legacy
 * products-collection path and produced the "Product X not in this
 * shop" rejection.
 *
 * Pinned by tests/services/buildPlaceOrderPayload.test.ts.
 */
import type { CartItem } from '../types';

export type WireCartLine = {
  productId: string;
  quantity: number;
  menuItemId?: string;
  priceSnapshot?: number;
};

export function buildPlaceOrderPayload(items: CartItem[]): WireCartLine[] {
  return items.map(i => ({
    productId: i.productId,
    quantity: i.quantity,
    // Only emit menuItemId when it's a non-empty string. Cart lines
    // hydrated from old persisted state may have it as undefined,
    // and the server distinguishes "missing" from "empty string"
    // when picking the validation path.
    ...(typeof i.menuItemId === 'string' && i.menuItemId.length > 0
      ? { menuItemId: i.menuItemId }
      : {}),
    // priceSnapshot is the captured menu price at the moment the
    // user added the item to cart. Server compares it to the
    // current menu price within ±1 paisa to detect drift. Only
    // emit when it's a finite number.
    ...(typeof i.priceSnapshot === 'number' && Number.isFinite(i.priceSnapshot)
      ? { priceSnapshot: i.priceSnapshot }
      : {}),
  }));
}
