/**
 * Pure conversions between a SavedAddress (the persisted shape on
 * /users/{uid}.addresses) and the loose CheckoutFields shape that the
 * checkout form's local state holds.
 *
 * Two consumers:
 *   - CheckoutScreen: when the user picks a saved address, fill the
 *     in-progress form from it (so they can still tweak before
 *     submitting); when the user submits an unsaved address, prompt
 *     "save this for next time?" using checkoutFieldsToAddress.
 *   - AddressEditScreen: same shape on input + output; lets the form
 *     stay agnostic to whether the user is editing an existing
 *     address or creating a new one.
 *
 * No React, no React Native imports — trivially unit-testable.
 * Pinned by tests/utils/addressFormatting.test.ts.
 */
import type { SavedAddress } from '../types';

export type CheckoutFields = {
  name: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  pincode: string;
};

/**
 * Project a SavedAddress down to the bare form fields, dropping
 * id/label/timestamps. The resulting shape is exactly what the
 * checkout form binds to (one input per key).
 *
 * `line2` is `undefined` rather than empty string when absent — the
 * checkout Input component renders empty when given undefined and
 * doesn't try to "track" the missing field. Keeps the round-trip
 * symmetric with checkoutFieldsToAddress, which strips empty strings
 * back to undefined.
 */
export function addressToCheckoutFields(addr: SavedAddress): CheckoutFields {
  const out: CheckoutFields = {
    name: addr.name,
    phone: addr.phone,
    line1: addr.line1,
    city: addr.city,
    pincode: addr.pincode,
  };
  if (addr.line2 != null && addr.line2 !== '') {
    out.line2 = addr.line2;
  }
  return out;
}

/**
 * Build the body of a saveAddress() call from raw checkout-form
 * values. The returned shape deliberately omits id / createdAt /
 * updatedAt — those are server-managed (id minted on first save,
 * timestamps stamped server-side every save). The optional `label`
 * is bolted on by the AddressEditScreen; checkout never sets one,
 * so the auto-save-after-checkout prompt produces an unlabelled
 * address by default (the user can re-label it later from Profile).
 *
 * `line2` is collapsed to undefined when blank — server validation
 * also collapses to null, so either representation round-trips.
 */
export function checkoutFieldsToAddress(
  fields: CheckoutFields,
  label?: string,
): Omit<SavedAddress, 'id' | 'createdAt' | 'updatedAt'> {
  const out: Omit<SavedAddress, 'id' | 'createdAt' | 'updatedAt'> = {
    name: fields.name,
    phone: fields.phone,
    line1: fields.line1,
    city: fields.city,
    pincode: fields.pincode,
  };
  if (fields.line2 != null && fields.line2 !== '') {
    out.line2 = fields.line2;
  }
  if (label != null && label !== '') {
    out.label = label;
  }
  return out;
}
