/**
 * Dynamically injects the Razorpay Checkout script into the DOM.
 * No-op on native (script tags don't exist there). Safe to call
 * multiple times — checks for existing global before re-loading.
 */
export function loadRazorpayScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('Razorpay Checkout is web-only for now'));
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
};

export type RazorpayInstance = {
  on: (event: 'payment.failed', cb: (err: unknown) => void) => void;
};

export function openRazorpayCheckout(opts: RazorpayCheckoutOptions): RazorpayInstance {
  const rzp = new (window as any).Razorpay(opts);
  rzp.open();
  return rzp;
}
