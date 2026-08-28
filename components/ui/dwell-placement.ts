/**
 * Pure cursor-anchored placement maths for a popover's dwell ("filling") state
 * (`components/ui/popover.tsx`). Extracted so the offset, edge-flip and edge-clamp rules are
 * node-tested rather than read off jsdom, which has no layout and can't honestly observe a
 * style-only number (AGENTS.md → Testing: "move the maths to a node-tested helper").
 */

export interface DwellPoint {
  x: number;
  y: number;
}

export interface DwellSize {
  width: number;
  height: number;
}

export interface DwellViewport {
  width: number;
  height: number;
}

/** Clear space kept between the cursor and the content's near edge. */
export const CURSOR_CLEARANCE_PX = 12;

/**
 * Given the pointer's viewport position, the content's own size and the viewport, returns the
 * top/left to place the content at: offset down-right of the cursor by default, flipped to
 * up-left of the cursor on whichever axis would overflow, then clamped fully on-screen. No
 * parent-avoidance rule — the overlap is deliberate (E3, `docs/build-plans/nested-tooltips.md`).
 */
export function placeAtCursor(
  pointer: DwellPoint,
  content: DwellSize,
  viewport: DwellViewport,
): { top: number; left: number } {
  let left = pointer.x + CURSOR_CLEARANCE_PX;
  if (left + content.width > viewport.width) {
    left = pointer.x - CURSOR_CLEARANCE_PX - content.width;
  }

  let top = pointer.y + CURSOR_CLEARANCE_PX;
  if (top + content.height > viewport.height) {
    top = pointer.y - CURSOR_CLEARANCE_PX - content.height;
  }

  const maxLeft = Math.max(0, viewport.width - content.width);
  const maxTop = Math.max(0, viewport.height - content.height);
  left = Math.min(Math.max(left, 0), maxLeft);
  top = Math.min(Math.max(top, 0), maxTop);

  return { top, left };
}
