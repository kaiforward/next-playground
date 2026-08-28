import { describe, it, expect } from "vitest";
import { placeAtCursor, CURSOR_CLEARANCE_PX } from "@/components/ui/dwell-placement";

const VIEWPORT = { width: 800, height: 600 };
const SMALL_CONTENT = { width: 200, height: 100 };

describe("placeAtCursor — the default offset", () => {
  it("offsets down-right of the cursor by CURSOR_CLEARANCE_PX when nothing would overflow", () => {
    const pointer = { x: 100, y: 100 };
    expect(placeAtCursor(pointer, SMALL_CONTENT, VIEWPORT)).toEqual({
      left: 100 + CURSOR_CLEARANCE_PX,
      top: 100 + CURSOR_CLEARANCE_PX,
    });
  });
});

describe("placeAtCursor — the right-edge flip", () => {
  it("flips to the cursor's left when the down-right placement would overflow the right edge", () => {
    // At x=750, down-right placement (750 + 12 = 762) plus content width (200) is 962, well past
    // the 800-wide viewport — must flip to sit left of the cursor instead.
    const pointer = { x: 750, y: 100 };
    const result = placeAtCursor(pointer, SMALL_CONTENT, VIEWPORT);
    expect(result.left).toBe(pointer.x - CURSOR_CLEARANCE_PX - SMALL_CONTENT.width);
  });

  it("does not flip when the down-right placement fits", () => {
    const pointer = { x: 400, y: 100 };
    const result = placeAtCursor(pointer, SMALL_CONTENT, VIEWPORT);
    expect(result.left).toBe(pointer.x + CURSOR_CLEARANCE_PX);
  });
});

describe("placeAtCursor — the bottom-edge flip", () => {
  it("flips above the cursor when the down placement would overflow the bottom edge", () => {
    const pointer = { x: 100, y: 550 };
    const result = placeAtCursor(pointer, SMALL_CONTENT, VIEWPORT);
    expect(result.top).toBe(pointer.y - CURSOR_CLEARANCE_PX - SMALL_CONTENT.height);
  });

  it("does not flip when the down placement fits", () => {
    const pointer = { x: 100, y: 200 };
    const result = placeAtCursor(pointer, SMALL_CONTENT, VIEWPORT);
    expect(result.top).toBe(pointer.y + CURSOR_CLEARANCE_PX);
  });
});

describe("placeAtCursor — edge clamps", () => {
  it("stays on the down-right offset at the viewport's own top-left corner, with nothing to flip or clamp", () => {
    // Retitled from an earlier version of this test that claimed to exercise the clamp here: with
    // a non-negative pointer and a positive clearance, the primary (down-right) placement can
    // never go negative on its own — `left`/`top` only go negative through the FLIP formula
    // (`pointer - clearance - content size`), which only triggers when the content doesn't fit the
    // primary placement in the first place. Small content at the origin fits, so this corner never
    // reaches either the flip or the clamp; both are genuinely exercised by the "wider than the
    // space" cases below instead. What this pins is the plain, unflipped, unclamped offset holding
    // at the one pointer position where a stray flip condition would be easiest to trip by
    // accident (a `<` that should be `<=`, or an off-by-one at zero).
    const pointer = { x: 2, y: 2 };
    const result = placeAtCursor(pointer, SMALL_CONTENT, VIEWPORT);
    expect(result).toEqual({
      left: pointer.x + CURSOR_CLEARANCE_PX,
      top: pointer.y + CURSOR_CLEARANCE_PX,
    });
  });

  it("clamps to the right edge when content is wider than the space the flip leaves", () => {
    // A cursor near the right edge with content wider than the viewport itself: down-right
    // overflows, the flip (pointer.x - 12 - width) goes negative, and the result must still sit
    // fully on screen rather than off the left edge.
    const wideContent = { width: 900, height: 100 };
    const pointer = { x: 780, y: 100 };
    const result = placeAtCursor(pointer, wideContent, VIEWPORT);
    expect(result.left).toBe(0);
  });

  it("clamps to the bottom edge when content is taller than the space the flip leaves", () => {
    const tallContent = { width: 100, height: 700 };
    const pointer = { x: 100, y: 580 };
    const result = placeAtCursor(pointer, tallContent, VIEWPORT);
    expect(result.top).toBe(0);
  });
});

describe("placeAtCursor — both axes overflowing at once", () => {
  it("flips both left and up when the cursor is near the bottom-right corner", () => {
    const pointer = { x: 780, y: 580 };
    const result = placeAtCursor(pointer, SMALL_CONTENT, VIEWPORT);
    expect(result.left).toBe(pointer.x - CURSOR_CLEARANCE_PX - SMALL_CONTENT.width);
    expect(result.top).toBe(pointer.y - CURSOR_CLEARANCE_PX - SMALL_CONTENT.height);
  });
});
