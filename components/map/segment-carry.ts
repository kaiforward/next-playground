// ── Sub-tab carry-over when the selected system changes ────────

/**
 * Which sub-tab segment (if any) should carry over onto a newly-selected system's detail path.
 * Astrography is always visible regardless of developed tier, so it carries over unconditionally;
 * any other sub-tab only carries over if the TARGET system is developed (undeveloped systems only
 * show Overview + Astrography — see the same gate in @panel/system/layout.tsx). Returns null when
 * there's no sub-tab open, or when the segment doesn't apply to an undeveloped target — either way
 * the caller falls back to the system's base path.
 */
export function resolveCarriedSegment(pathname: string, isDeveloped: boolean): string | null {
  const match = /^\/system\/[^/]+\/([^/?]+)/.exec(pathname);
  const segment = match ? match[1] : null;
  if (segment === null) return null;
  if (segment === "astrography") return segment;
  return isDeveloped ? segment : null;
}
