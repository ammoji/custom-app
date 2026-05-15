// Sentry stub — services import { Sentry } from './sentry'. We only
// need addBreadcrumb to be callable for orderService.placeOrder.
export const Sentry = {
  addBreadcrumb: (_b: unknown) => {},
  captureException: (_e: unknown) => {},
  captureMessage: (_m: unknown) => {},
};
