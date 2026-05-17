/**
 * PR 5 — placeOrder gate helpers (minOrder bypass).
 *
 * Extracted as a pure helper so the "admin bypasses minOrder" policy
 * can be unit-tested without firebase-admin. The placeOrder callable
 * calls this exactly once after computing `subtotal`.
 *
 * Policy:
 *   - Admin caller (`token.admin === true`) bypasses the minOrder
 *     gate. They still hit every other validation (item availability,
 *     stock, price drift, multi-shop cart guard from PR 4).
 *   - Everyone else must satisfy `subtotal >= shop.minOrder`.
 *
 * Strict equality on `admin === true` is platform policy — see
 * `.windsurf/claims-discipline.md` (truthy `1` / `'yes'` tokens have
 * caused real escalations before). The same posture is used in the
 * shopSettings helper for `shopOwner`.
 */

export type MinOrderGateInput = {
  auth: { token?: { admin?: unknown } } | null;
  subtotal: number;
  minOrder: number;
};

export type MinOrderGateResult =
  | { ok: true }
  | { ok: false; message: string };

export function checkMinOrderGate(
  input: MinOrderGateInput,
): MinOrderGateResult {
  const isAdminCaller = input.auth?.token?.admin === true;
  if (isAdminCaller) return { ok: true };
  if (input.subtotal >= input.minOrder) return { ok: true };
  return {
    ok: false,
    message: `Minimum order is ₹${input.minOrder}. Cart total is ₹${input.subtotal}.`,
  };
}
