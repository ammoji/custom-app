/**
 * Pure unit tests for src/utils/addressFormatting.ts.
 *
 * No mocks needed — both helpers are framework-free, just shape
 * conversions between SavedAddress and the form-fields shape.
 */
import {
  addressToCheckoutFields,
  checkoutFieldsToAddress,
} from '../../src/utils/addressFormatting';
import type { SavedAddress } from '../../src/types';

const fullAddress: SavedAddress = {
  id: 'addr-1',
  label: 'Home',
  name: 'Sudhir Davim',
  phone: '9876543210',
  line1: 'A-12, Green Park',
  line2: 'Near Metro',
  city: 'New Delhi',
  pincode: '110016',
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_001_000,
};

describe('addressToCheckoutFields', () => {
  test('round-trips with all fields present', () => {
    const out = addressToCheckoutFields(fullAddress);
    expect(out).toEqual({
      name: 'Sudhir Davim',
      phone: '9876543210',
      line1: 'A-12, Green Park',
      line2: 'Near Metro',
      city: 'New Delhi',
      pincode: '110016',
    });
    // Critical: id, label, createdAt, updatedAt must NOT bleed into
    // the form-fields shape — that shape is bound to plain Inputs and
    // shouldn't carry server-managed metadata.
    expect(out).not.toHaveProperty('id');
    expect(out).not.toHaveProperty('label');
    expect(out).not.toHaveProperty('createdAt');
    expect(out).not.toHaveProperty('updatedAt');
  });

  test('omits line2 entirely when the saved address has no line2', () => {
    const noLine2: SavedAddress = { ...fullAddress, line2: undefined };
    const out = addressToCheckoutFields(noLine2);
    expect(out.line2).toBeUndefined();
    expect('line2' in out).toBe(false);
  });

  test('omits line2 when the saved address has an empty-string line2', () => {
    // Some legacy docs may have line2 as '' instead of undefined.
    // Both should round-trip to the same "absent" form-state.
    const blankLine2: SavedAddress = { ...fullAddress, line2: '' };
    const out = addressToCheckoutFields(blankLine2);
    expect('line2' in out).toBe(false);
  });
});

describe('checkoutFieldsToAddress', () => {
  test('produces an Omit<id|createdAt|updatedAt> shape', () => {
    const out = checkoutFieldsToAddress({
      name: 'Anita',
      phone: '9000000000',
      line1: 'B-7',
      city: 'Gurgaon',
      pincode: '122001',
    });
    expect(out).not.toHaveProperty('id');
    expect(out).not.toHaveProperty('createdAt');
    expect(out).not.toHaveProperty('updatedAt');
    // Required keys present.
    expect(out).toMatchObject({
      name: 'Anita',
      phone: '9000000000',
      line1: 'B-7',
      city: 'Gurgaon',
      pincode: '122001',
    });
  });

  test('accepts an optional label and includes it in the output', () => {
    const out = checkoutFieldsToAddress(
      {
        name: 'Anita',
        phone: '9000000000',
        line1: 'B-7',
        city: 'Gurgaon',
        pincode: '122001',
      },
      'Office',
    );
    expect(out.label).toBe('Office');
  });

  test('drops empty label rather than sending "" to the server', () => {
    // Sending '' would pass typeof === 'string' on the server but
    // collapse to null inside the validator. Cleaner to omit
    // up-front so the wire payload matches the form's intent.
    const out = checkoutFieldsToAddress(
      {
        name: 'Anita',
        phone: '9000000000',
        line1: 'B-7',
        city: 'Gurgaon',
        pincode: '122001',
      },
      '',
    );
    expect('label' in out).toBe(false);
  });
});
