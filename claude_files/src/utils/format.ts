import { Product } from '../types';

export function formatRupees(amount: number): string {
  return `₹${Math.round(amount)}`;
}

export function formatPackLabel(packSize: Product['packSize']): string {
  const { value, unit } = packSize;
  if (unit === 'litre') return `${value} L`;
  if (unit === 'ml') return `${value} mL`;
  return `${value} ${unit}`;
}

export function formatDistance(km?: number): string {
  if (km == null) return '';
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}
