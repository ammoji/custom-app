/**
 * Maps Cloud Function callable error codes to user-friendly
 * messages for the ShopOwnerDashboard error banner.
 *
 * The pre-fix banner showed the raw `err.message` from the callable,
 * which on RNFB native was often just "INTERNAL" — useless to the
 * shop owner trying to understand why their dashboard wouldn't
 * load. This mapper covers the four codes we actually expect and
 * falls through to either the server message or a generic Retry
 * hint.
 *
 * Kept in `src/utils/` (not next to the screen) because the same
 * mapping will be reused by:
 *   - AdminOrdersScreen (listAllOrders watcher)
 *   - any future shop-side dashboards
 *
 * Pinned by tests/utils/shopOrdersErrorMessage.test.ts.
 */

export type CallableLikeError =
  | { code?: string; message?: string }
  | Error
  | string
  | null
  | undefined;

export function mapShopOrdersError(err: CallableLikeError): string {
  if (err == null) {
    return "Couldn't load orders. Pull to refresh.";
  }
  if (typeof err === 'string') {
    return err || "Couldn't load orders. Pull to refresh.";
  }
  // Firebase Functions errors expose `code` as `functions/<code>`
  // on the web SDK and as `<code>` on RNFB. Normalize to the bare
  // code so the switch below is platform-agnostic.
  const rawCode = (err as { code?: string }).code ?? '';
  const code = rawCode.startsWith('functions/')
    ? rawCode.slice('functions/'.length)
    : rawCode;
  const message = (err as { message?: string }).message ?? '';

  switch (code) {
    case 'internal':
      return "Couldn't load orders. Please try again or contact support.";
    case 'unauthenticated':
      return 'Session expired. Please sign in again.';
    case 'permission-denied':
      return "You don't have access to this shop's orders.";
    case 'failed-precondition':
      // The classic missing-index error wraps a long Firestore URL
      // in the message. Trim it to something the owner can act on
      // instead of a wall of text.
      if (message.toLowerCase().includes('requires an index')) {
        return 'Orders index is being built. Try again in a few minutes.';
      }
      return message || "Couldn't load orders. Try again.";
    default:
      return message || "Couldn't load orders. Pull to refresh.";
  }
}
