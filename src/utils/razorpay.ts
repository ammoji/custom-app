import { Platform } from 'react-native';

/**
 * Razorpay Checkout — unified web + native dispatcher.
 *
 * Web: dynamically loads the Razorpay Checkout JS SDK and shows an overlay.
 * Native: uses react-native-razorpay's native PaymentSheet (iOS/Android).
 *
 * Both paths share the same option shape and callback semantics so the
 * caller (CheckoutScreen) doesn't branch on Platform.OS.
 *
 * Caveat: react-native-razorpay does not officially support the New
 * Architecture as of v2.x. We rely on Expo's interop layer (default in
 * SDK 54). If this breaks in a future RN/Expo upgrade, fall back to a
 * WebView-based checkout (see PRELAUNCH_CHECKLIST follow-up).
 */

// Lazy-load the native module only on native. The require is wrapped
// in a try so an unexpected web bundle that ends up here doesn't crash
// at import time \u2014 the runtime check below still gates actual use.
let RazorpayCheckout: any = null;
if (Platform.OS !== 'web') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    RazorpayCheckout = require('react-native-razorpay').default;
  } catch (e) {
    console.warn('[razorpay] native module not loaded:', e);
  }
}

export type RazorpaySuccessResponse = {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
};

export type RazorpayCheckoutOptions = {
  key: string;
  order_id: string;
  amount: number; // in paise
  currency: 'INR';
  name: string;
  description?: string;
  prefill?: { name?: string; contact?: string; email?: string };
  theme?: { color?: string };
  handler: (response: RazorpaySuccessResponse) => void;
  modal?: { ondismiss?: () => void };
  onError?: (err: any) => void;
};

/**
 * Loads the Razorpay Checkout JS SDK. Resolves once `window.Razorpay`
 * is available. Web-only \u2014 throws on native (caller never reaches here
 * on native because openRazorpayCheckout branches first).
 */
function loadRazorpayScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('Razorpay JS SDK is web-only'));
      return;
    }
    if ((window as any).Razorpay) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error('Failed to load Razorpay Checkout script'));
    document.body.appendChild(script);
  });
}

/**
 * Opens Razorpay Checkout. Callbacks fire identically on both platforms:
 *   - opts.handler        \u2192 payment success (signature verified later
 *                            server-side via the razorpayWebhook).
 *   - opts.modal.ondismiss \u2192 user closed the sheet/overlay without paying.
 *   - opts.onError        \u2192 payment failed (Razorpay returned an error
 *                            other than user-dismissal).
 *
 * Returns a Promise that resolves once the sheet opens (web) or once
 * the sheet closes (native). The Promise itself never rejects \u2014 errors
 * are surfaced through opts.onError so the caller has one consistent
 * code path.
 */
export async function openRazorpayCheckout(
  opts: RazorpayCheckoutOptions,
): Promise<void> {
  if (Platform.OS === 'web') {
    await loadRazorpayScript();
    const rzp = new (window as any).Razorpay({
      key: opts.key,
      order_id: opts.order_id,
      amount: opts.amount,
      currency: opts.currency,
      name: opts.name,
      description: opts.description,
      prefill: opts.prefill,
      theme: opts.theme,
      handler: opts.handler,
      modal: opts.modal,
    });
    if (opts.onError) {
      rzp.on('payment.failed', opts.onError);
    }
    rzp.open();
    return;
  }

  if (!RazorpayCheckout) {
    const err = new Error(
      'Razorpay native module not available. Rebuild the dev client to include react-native-razorpay.',
    );
    opts.onError?.(err);
    throw err;
  }

  try {
    const response = await RazorpayCheckout.open({
      key: opts.key,
      order_id: opts.order_id,
      amount: opts.amount,
      currency: opts.currency,
      name: opts.name,
      description: opts.description,
      prefill: opts.prefill,
      theme: opts.theme,
    });
    opts.handler(response as RazorpaySuccessResponse);
  } catch (err: any) {
    // react-native-razorpay rejects on BOTH user dismissal and payment
    // failure. Distinguish via error code (0 = cancelled by user) or
    // a "cancel" substring in the description.
    const isDismiss =
      err?.code === 0 ||
      err?.code === 'BAD_REQUEST_ERROR' && /cancel/i.test(err?.description ?? '') ||
      /cancel/i.test(err?.description ?? '');
    if (isDismiss) {
      opts.modal?.ondismiss?.();
    } else {
      opts.onError?.(err);
    }
  }
}
