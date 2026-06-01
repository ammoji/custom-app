/**
 * PR-NEXT-13a — `initialsFor` pure helper for `PartnerIdentityCard`.
 *
 * Lives in its own file (not co-located with the component) so the
 * test suite can pin it without dragging the `.tsx` component
 * through the `tests/tsconfig.json` toolchain (which is JSX-free by
 * design — `@testing-library/react-native` isn't a project dep).
 *
 * Two-letter initials from the first + last whitespace-separated
 * word, single-letter from a one-word name, fallback emoji glyph
 * when name is missing / non-string / whitespace-only. Always
 * upper-case ASCII.
 */
export function initialsFor(name: string | undefined | null): string {
  if (typeof name !== 'string') return '👤';
  const trimmed = name.trim();
  if (trimmed.length === 0) return '👤';
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return parts[0]!.charAt(0).toUpperCase();
  const first = parts[0]!.charAt(0);
  const last = parts[parts.length - 1]!.charAt(0);
  return (first + last).toUpperCase();
}
