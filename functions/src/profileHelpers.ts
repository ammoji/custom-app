/**
 * Pure validation + state-mutation helpers for the profile / saved-
 * address callables in functions/src/index.ts.
 *
 * Split into its own module (same architectural pattern as
 * scripts/reset-test-data.helpers.ts) so the high-stakes input
 * validation and the default-promotion logic can be unit-tested in
 * plain Node, without booting firebase-admin or firebase-functions.
 *
 * Tests live in:
 *   - tests/functions/profileValidation.test.ts
 *   - tests/utils/defaultAddressPromotion.test.ts
 *
 * Nothing in this file may import firebase-admin / firebase-functions /
 * react-native — that's the testability contract. The Cloud Function
 * callable wires these helpers to HttpsError and FieldValue itself.
 */
import { normalizeDeliveryInstructions } from './deliveryInstructionsHelpers';

// -------------------------------------------------------------------
// Types — kept local so the helpers don't depend on the client-side
// types/index.ts (functions/ is its own TS root).
// -------------------------------------------------------------------

export type AddressInput = {
  id?: string;
  label?: string | null;
  name?: string;
  phone?: string;
  line1?: string;
  line2?: string | null;
  city?: string;
  pincode?: string;
  // PR 22 — optional free-text instructions. Validated +
  // normalized via normalizeDeliveryInstructions (see
  // deliveryInstructionsHelpers); validator below treats it like
  // line2 (collapse empty/whitespace to null, length-capped).
  deliveryInstructions?: string | null;
};

export type ValidatedAddress = {
  // id is intentionally absent here — Cloud Function decides whether
  // to mint a new one or reuse the input id, after this returns.
  label: string | null;
  name: string;
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  pincode: string;
  // PR 22 — normalized output. null means "absent"; non-null
  // strings have been trimmed and length-checked. The Cloud
  // Function strips null before writing so we don't store an
  // explicit null on Firestore.
  deliveryInstructions: string | null;
};

export type ProfilePatch = {
  name?: string | null;
  email?: string | null;
};

export type ValidatedProfilePatch = {
  // null means "clear this field"; undefined means "don't touch it".
  // saveAddress / updateMyProfile callable distinguishes these by
  // checking `key in patch` before applying.
  name?: string | null;
  email?: string | null;
};

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; field: string; message: string };

// -------------------------------------------------------------------
// Profile patch validation (updateMyProfile)
// -------------------------------------------------------------------

const NAME_MAX = 80;
// Deliberately permissive — RFC 5322 is impractical to enforce and
// the only consumer is receipts/notifications. We just want to catch
// obvious typos like `foo@` or `no-at-sign`.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validate a profile patch.
 *
 * `email` may be:
 *   - undefined  → not touched
 *   - null / ""  → cleared (normalised to null in the result)
 *   - string     → trimmed and validated
 *
 * `name` is REQUIRED when present (PR 10). Whenever the patch
 * includes a `name` key it must be a non-empty string after trim;
 * empty/null/whitespace-only patches return a validation error
 * (not a null-collapse). Patches that don't include `name` at all
 * pass through unchanged so an "update email only" flow keeps
 * working for users who already have a name set.
 *
 * Empty-string `email` inputs still collapse to null so the Cloud
 * Function can use a single `FieldValue.delete()` path for both
 * null and "". This keeps the "what got cleared" audit story simple.
 */
export function validateProfilePatch(
  patch: ProfilePatch,
): ValidationResult<ValidatedProfilePatch> {
  const out: ValidatedProfilePatch = {};

  if ('name' in patch) {
    // PR 10 — name is now REQUIRED whenever the patch touches it.
    // Previously empty-string / null collapsed to null ("clear it"),
    // which left profiles in a half-set state that bit downstream
    // (e.g. address book defaulting `address.name` from
    // profile.name). Patches that don't touch the name field still
    // pass through unchanged, so existing flows that update only
    // email keep working.
    const raw = patch.name;
    if (raw == null) {
      return { ok: false, field: 'name', message: 'Full name is required' };
    }
    if (typeof raw !== 'string') {
      return { ok: false, field: 'name', message: 'Name must be a string' };
    }
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      return { ok: false, field: 'name', message: 'Full name is required' };
    }
    if (trimmed.length > NAME_MAX) {
      return {
        ok: false,
        field: 'name',
        message: `Name must be ${NAME_MAX} characters or fewer`,
      };
    }
    out.name = trimmed;
  }

  if ('email' in patch) {
    const raw = patch.email;
    if (raw == null || raw === '') {
      out.email = null;
    } else if (typeof raw !== 'string') {
      return { ok: false, field: 'email', message: 'Email must be a string' };
    } else {
      const trimmed = raw.trim();
      if (trimmed.length === 0) {
        out.email = null;
      } else if (!EMAIL_RE.test(trimmed)) {
        return {
          ok: false,
          field: 'email',
          message: 'Enter a valid email address',
        };
      } else {
        out.email = trimmed;
      }
    }
  }

  return { ok: true, value: out };
}

// -------------------------------------------------------------------
// Address validation (saveAddress)
// -------------------------------------------------------------------

const LABEL_MAX = 32;
// Indian mobile: 10 digits, must start 6/7/8/9. Catches the common
// typos (leading 0, country-code prefix, 11-digit, alphabetic junk).
const PHONE_RE = /^[6-9]\d{9}$/;
const PINCODE_RE = /^\d{6}$/;

function trimmedNonEmpty(
  raw: unknown,
  field: string,
): { ok: true; value: string } | { ok: false; field: string; message: string } {
  if (typeof raw !== 'string') {
    return { ok: false, field, message: `${field} must be a string` };
  }
  const v = raw.trim();
  if (v.length === 0) {
    return { ok: false, field, message: `${field} is required` };
  }
  return { ok: true, value: v };
}

/**
 * Validate the body of a saveAddress() call. The id (if present) is
 * NOT validated here — the Cloud Function looks it up against the
 * user's existing addresses and decides update-vs-create from there.
 *
 * `label` and `line2` are the only optional fields. Both collapse
 * empty strings to null so we have a single "absent" representation
 * downstream.
 */
export function validateAddressInput(
  input: AddressInput,
): ValidationResult<ValidatedAddress> {
  // Required fields, in the order the form renders them so error
  // messages line up with focus order.
  const name = trimmedNonEmpty(input.name, 'name');
  if (!name.ok) return name;

  if (typeof input.phone !== 'string' || !PHONE_RE.test(input.phone.trim())) {
    return {
      ok: false,
      field: 'phone',
      message: 'Enter a valid 10-digit Indian mobile number',
    };
  }

  const line1 = trimmedNonEmpty(input.line1, 'line1');
  if (!line1.ok) return line1;

  const city = trimmedNonEmpty(input.city, 'city');
  if (!city.ok) return city;

  if (typeof input.pincode !== 'string' || !PINCODE_RE.test(input.pincode.trim())) {
    return {
      ok: false,
      field: 'pincode',
      message: 'Enter a valid 6-digit pincode',
    };
  }

  // Optional fields.
  let label: string | null = null;
  if (input.label != null && input.label !== '') {
    if (typeof input.label !== 'string') {
      return { ok: false, field: 'label', message: 'Label must be a string' };
    }
    const trimmed = input.label.trim();
    if (trimmed.length > LABEL_MAX) {
      return {
        ok: false,
        field: 'label',
        message: `Label must be ${LABEL_MAX} characters or fewer`,
      };
    }
    label = trimmed.length > 0 ? trimmed : null;
  }

  let line2: string | null = null;
  if (input.line2 != null && input.line2 !== '') {
    if (typeof input.line2 !== 'string') {
      return { ok: false, field: 'line2', message: 'Line 2 must be a string' };
    }
    const trimmed = input.line2.trim();
    line2 = trimmed.length > 0 ? trimmed : null;
  }

  // PR 22 — delivery instructions. Delegated to the shared pure
  // helper so saveAddress + placeOrder enforce identical rules.
  // The helper returns `undefined` for absent / whitespace-only;
  // we collapse that to `null` to match the existing label / line2
  // representation here.
  const instr = normalizeDeliveryInstructions(input.deliveryInstructions);
  if (!instr.ok) {
    return {
      ok: false,
      field: 'deliveryInstructions',
      message: instr.message,
    };
  }
  const deliveryInstructions = instr.value ?? null;

  return {
    ok: true,
    value: {
      label,
      name: name.value,
      phone: input.phone.trim(),
      line1: line1.value,
      line2,
      city: city.value,
      pincode: input.pincode.trim(),
      deliveryInstructions,
    },
  };
}

// -------------------------------------------------------------------
// Default-address promotion (deleteAddress)
// -------------------------------------------------------------------

/**
 * Decide what `defaultAddressId` should be after deleting `deletedId`
 * from the user's address list.
 *
 * Rules:
 *   - If the deleted id was NOT the current default, keep the
 *     current default (idempotent — deleting any non-default address
 *     leaves the default untouched).
 *   - If the deleted id WAS the default and at least one address
 *     remains, promote the most-recently-updated remaining address.
 *     "Most recent" means largest `updatedAt`. Tie-breaker is
 *     undefined (Array.prototype.sort is not guaranteed stable on
 *     equal keys); in practice tied updatedAt values come from the
 *     same `Date.now()` batch and any tie-break is acceptable.
 *   - If no addresses remain after the delete, return null.
 *
 * The input list is the post-delete list (caller filters out the
 * deleted entry first). This keeps the helper a pure transformation
 * with no knowledge of "the address being deleted" beyond its id.
 *
 * `currentDefaultId` may be undefined (legacy users predating this
 * field) — treated the same as null.
 */
export function promoteDefaultAfterDelete(
  remainingAddresses: Array<{ id: string; updatedAt: number }>,
  deletedId: string,
  currentDefaultId: string | null | undefined,
): string | null {
  // Branch 1: no addresses left → no default possible.
  if (remainingAddresses.length === 0) return null;

  // Branch 2: the deleted address wasn't the default → preserve it.
  // (`currentDefaultId === undefined` collapses to null for a
  // consistent return type.)
  if (currentDefaultId && currentDefaultId !== deletedId) {
    return currentDefaultId;
  }

  // Branch 3: promote the most-recently-updated remaining address.
  // We don't mutate the input array.
  let winner = remainingAddresses[0];
  for (let i = 1; i < remainingAddresses.length; i += 1) {
    if (remainingAddresses[i].updatedAt > winner.updatedAt) {
      winner = remainingAddresses[i];
    }
  }
  return winner.id;
}
