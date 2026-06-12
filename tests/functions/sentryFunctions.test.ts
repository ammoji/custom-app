/**
 * PR-NEXT-BUNDLE-H §E — +1 test: assert Sentry.captureException
 * invokes console.error with the expected tags shape.
 */
import { Sentry } from '../../functions/src/sentryFunctions';

describe('Sentry shim (sentryFunctions)', () => {
  it('captureException logs structured output with tags + extra', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const err = new Error('push delivery failed');
    Sentry.captureException(err, {
      tags: { area: 'respondToReview.push' },
      extra: { ratingId: 'r1', orderId: 'o1', customerId: 'u1', responseBy: 'shop' },
    });
    expect(spy).toHaveBeenCalledWith(
      '[Sentry]',
      expect.objectContaining({
        message: 'push delivery failed',
        tags: { area: 'respondToReview.push' },
        extra: expect.objectContaining({ ratingId: 'r1', orderId: 'o1' }),
      }),
    );
    spy.mockRestore();
  });

  it('captureException with no context → does not throw', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => Sentry.captureException(new Error('x'))).not.toThrow();
    spy.mockRestore();
  });
});
