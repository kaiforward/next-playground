/**
 * Pure depth-to-opacity maths for the nested popover stack's depth cue (`components/ui/popover.tsx`).
 * Extracted so the `FULL_OPACITY_DEPTH` boundary is node-tested rather than read off jsdom, which has
 * no layout and cannot honestly observe a style-only number (AGENTS.md -> Testing: "move the maths
 * to a node-tested helper").
 */

/** How many of the newest stack entries render at full opacity before the depth cue starts fading
 *  older ones out. The sole source of truth for that boundary — `DEPTH_OPACITY` below is derived
 *  from it, rather than carrying its own independent count of leading `1`s, so the two cannot drift
 *  apart. */
export const FULL_OPACITY_DEPTH = 3;

/**
 * Opacity by depth-from-top, derived from `FULL_OPACITY_DEPTH`: indices `0..FULL_OPACITY_DEPTH - 1`
 * are the newest `FULL_OPACITY_DEPTH` entries (opacity 1), the next index is the first faded tier
 * (0.5), and the last index is everything older still (0.28) — `opacityForDepth` clamps into this
 * array rather than indexing past its end, so that last entry serves every depth beyond it.
 */
export const DEPTH_OPACITY: readonly number[] = [
  ...Array<number>(FULL_OPACITY_DEPTH).fill(1),
  0.5,
  0.28,
];

/**
 * Opacity for a popover at `depthFromTop` (0 = the newest entry currently in the stack, 1 = one
 * older than that, and so on). The newest `FULL_OPACITY_DEPTH` entries are full opacity; the next
 * tier is 0.5; anything older is 0.28.
 */
export function opacityForDepth(depthFromTop: number): number {
  const index = Math.min(Math.max(depthFromTop, 0), DEPTH_OPACITY.length - 1);
  return DEPTH_OPACITY[index];
}
