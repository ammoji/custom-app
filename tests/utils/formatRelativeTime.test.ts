/**
 * PR 36.1 — pure-helper tests for the customer-side pickup
 * countdown formatter. Caller injects `nowMs` so these stay
 * deterministic.
 */
import { formatRelativeTime } from '../../src/utils/formatRelativeTime';

const NOW = 1_700_000_000_000;
const MIN = 60_000;

describe('PR 36.1 — formatRelativeTime', () => {
  test('22 minutes in future → "Ready in 22 minutes"', () => {
    const r = formatRelativeTime(NOW + 22 * MIN, NOW);
    expect(r.primary).toBe('Ready in 22 minutes');
    expect(r.isPast).toBe(false);
    expect(r.totalMinutes).toBe(22);
  });

  test('1 minute in future → singular "minute"', () => {
    const r = formatRelativeTime(NOW + 1 * MIN, NOW);
    expect(r.primary).toBe('Ready in 1 minute');
  });

  test('30 seconds in future → "less than a minute"', () => {
    const r = formatRelativeTime(NOW + 30_000, NOW);
    expect(r.primary).toBe('Ready in less than a minute');
  });

  test('1 hour 5 minutes in future → "1 hour 5 minutes"', () => {
    const r = formatRelativeTime(NOW + 65 * MIN, NOW);
    expect(r.primary).toBe('Ready in 1 hour 5 minutes');
  });

  test('exact hour in future → no minute remainder', () => {
    const r = formatRelativeTime(NOW + 120 * MIN, NOW);
    expect(r.primary).toBe('Ready in 2 hours');
  });

  test('1 minute past → "ready any moment now"', () => {
    const r = formatRelativeTime(NOW - 1 * MIN, NOW);
    expect(r.primary).toBe('Ready any moment now');
    expect(r.isPast).toBe(true);
  });

  test('15 minutes past → "15 minutes ago"', () => {
    const r = formatRelativeTime(NOW - 15 * MIN, NOW);
    expect(r.primary).toBe('Ready 15 minutes ago');
    expect(r.isPast).toBe(true);
    expect(r.totalMinutes).toBe(-15);
  });

  test('1 hour 5 minutes past → "1 hour 5 minutes ago"', () => {
    const r = formatRelativeTime(NOW - 65 * MIN, NOW);
    expect(r.primary).toBe('Ready 1 hour 5 minutes ago');
  });

  test('custom label override applies to both future and past', () => {
    const futR = formatRelativeTime(NOW + 30 * MIN, NOW, {
      label: 'Delivery',
    });
    expect(futR.primary).toBe('Delivery in 30 minutes');
    const pastR = formatRelativeTime(NOW - 30 * MIN, NOW, {
      label: 'Delivery',
    });
    expect(pastR.primary).toBe('Delivery 30 minutes ago');
  });
});
