import { describe, it, expect } from "vitest";
import {
  Camera,
  codeToPanDirection,
  keyboardPanDelta,
  movedBeyond,
  isTypingTarget,
} from "../camera";

describe("codeToPanDirection — maps WASD and arrows to a pan direction", () => {
  it("maps both W and ArrowUp to up", () => {
    expect(codeToPanDirection("KeyW")).toBe("up");
    expect(codeToPanDirection("ArrowUp")).toBe("up");
  });

  it("maps both S and ArrowDown to down", () => {
    expect(codeToPanDirection("KeyS")).toBe("down");
    expect(codeToPanDirection("ArrowDown")).toBe("down");
  });

  it("maps both A and ArrowLeft to left", () => {
    expect(codeToPanDirection("KeyA")).toBe("left");
    expect(codeToPanDirection("ArrowLeft")).toBe("left");
  });

  it("maps both D and ArrowRight to right", () => {
    expect(codeToPanDirection("KeyD")).toBe("right");
    expect(codeToPanDirection("ArrowRight")).toBe("right");
  });

  it("returns null for unrelated keys", () => {
    expect(codeToPanDirection("KeyQ")).toBeNull();
    expect(codeToPanDirection("Space")).toBeNull();
  });
});

describe("keyboardPanDelta — held directions integrate to a camera delta", () => {
  const base = { dtMs: 1000, zoom: 1, shiftHeld: false, speed: 900, boost: 2 };

  it("pans up as a negative-y world delta at the configured screen speed", () => {
    const { dx, dy } = keyboardPanDelta(["up"], base);
    expect(dx).toBeCloseTo(0);
    expect(dy).toBeCloseTo(-900);
  });

  it("pans right as a positive-x world delta", () => {
    const { dx, dy } = keyboardPanDelta(["right"], base);
    expect(dx).toBeCloseTo(900);
    expect(dy).toBeCloseTo(0);
  });

  it("keeps a constant screen-space speed across zoom (world delta scales by 1/zoom)", () => {
    const near = keyboardPanDelta(["up"], { ...base, zoom: 2 });
    const far = keyboardPanDelta(["up"], { ...base, zoom: 0.5 });
    // Same screen pixels → world delta is inversely proportional to zoom.
    expect(near.dy).toBeCloseTo(-450);
    expect(far.dy).toBeCloseTo(-1800);
    // Screen-space (delta × zoom) is identical.
    expect(near.dy * 2).toBeCloseTo(far.dy * 0.5);
  });

  it("doubles the delta when Shift is held (the boost)", () => {
    const { dy } = keyboardPanDelta(["up"], { ...base, shiftHeld: true });
    expect(dy).toBeCloseTo(-1800);
  });

  it("scales linearly with the frame delta", () => {
    const half = keyboardPanDelta(["up"], { ...base, dtMs: 500 });
    expect(half.dy).toBeCloseTo(-450);
  });

  it("normalises diagonals so W+D is not faster than a single axis", () => {
    const { dx, dy } = keyboardPanDelta(["up", "right"], base);
    const magnitude = Math.hypot(dx, dy);
    expect(magnitude).toBeCloseTo(900); // not 900 * sqrt(2)
    expect(dx).toBeCloseTo(900 / Math.SQRT2);
    expect(dy).toBeCloseTo(-900 / Math.SQRT2);
  });

  it("cancels opposing directions to zero", () => {
    expect(keyboardPanDelta(["up", "down"], base)).toEqual({ dx: 0, dy: 0 });
    expect(keyboardPanDelta(["left", "right"], base)).toEqual({ dx: 0, dy: 0 });
  });

  it("is zero with no directions held", () => {
    expect(keyboardPanDelta([], base)).toEqual({ dx: 0, dy: 0 });
  });
});

describe("movedBeyond — click-vs-drag threshold", () => {
  it("is false when the pointer stayed within the threshold (a click)", () => {
    expect(movedBeyond(0, 0, 3, 0, 5)).toBe(false);
    expect(movedBeyond(0, 0, 3, 4, 5)).toBe(false); // dist exactly 5, not beyond
  });

  it("is true once the pointer moved past the threshold (a drag)", () => {
    expect(movedBeyond(0, 0, 6, 0, 5)).toBe(true);
    expect(movedBeyond(10, 10, 0, 0, 5)).toBe(true);
  });
});

describe("Camera.setCenter — offset-aware centering (clears a left-docked drawer)", () => {
  it("lands the target exactly at screen-center when centerOffsetX is 0 (default, unchanged behaviour)", () => {
    const camera = new Camera();
    camera.setScreenSize(1000, 800);
    camera.setCenter(50, 50, 1, 0);
    expect(camera.worldToScreen(50, 50).x).toBeCloseTo(500);
  });

  it("shifts the target centerOffsetX px right of screen-center when set", () => {
    const camera = new Camera();
    camera.setScreenSize(1000, 800);
    camera.setCenter(50, 50, 1, 0, 240);
    expect(camera.worldToScreen(50, 50).x).toBeCloseTo(500 + 240);
  });

  it("keeps the offset in screen px regardless of zoom", () => {
    const camera = new Camera();
    camera.setScreenSize(1000, 800);
    camera.setCenter(50, 50, 2, 0, 240);
    expect(camera.worldToScreen(50, 50).x).toBeCloseTo(500 + 240);
  });
});

describe("isTypingTarget — guards keyboard pan from hijacking text entry", () => {
  it("treats form fields as typing targets", () => {
    expect(isTypingTarget({ tagName: "INPUT", isContentEditable: false })).toBe(true);
    expect(isTypingTarget({ tagName: "TEXTAREA", isContentEditable: false })).toBe(true);
    expect(isTypingTarget({ tagName: "SELECT", isContentEditable: false })).toBe(true);
  });

  it("treats contentEditable elements as typing targets", () => {
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });

  it("is false for ordinary elements and null", () => {
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: false })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
