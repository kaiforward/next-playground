import { describe, it, expect, vi, afterEach } from "vitest";
import { Graphics } from "pixi.js";
import type { StrokeInput } from "pixi.js";
import { ConnectionObject } from "../connection-object";
import { LANE_LOAD_COLOR, LANE_SELECTED } from "../../theme";
import type { ConnectionData } from "@/lib/hooks/use-map-data";

function conn(overrides: Partial<ConnectionData> & { fuelCost: number }): ConnectionData {
  return { id: "a-b", fromId: "a", toId: "b", laneKey: "a|b", level: 0, load: 0, blocked: false, ...overrides };
}

/** `ConnectionObject.update` only ever strokes an object style ({ color, alpha, width }), never a
 *  bare colour/gradient/pattern — narrow the union at the test boundary instead of asserting it. */
function strokeColor(style: StrokeInput | undefined): number {
  if (typeof style !== "object" || style === null || !("color" in style)) {
    throw new Error("expected an object stroke style with a color");
  }
  const color = style.color;
  if (typeof color !== "number") {
    throw new Error("expected a numeric stroke color");
  }
  return color;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ConnectionObject.update — lane styling", () => {
  it("strokes a glow + core pass for a major-tier (crossing-priced) lane", () => {
    const strokeSpy = vi.spyOn(Graphics.prototype, "stroke");
    const object = new ConnectionObject();
    object.update(conn({ fuelCost: 25 }), 0, 0, 100, 0, false);
    expect(strokeSpy.mock.calls).toHaveLength(2);
  });

  it("colours an idle (load ~0) lane grey, not the loaded or blocked colour", () => {
    const strokeSpy = vi.spyOn(Graphics.prototype, "stroke");
    const object = new ConnectionObject();
    object.update(conn({ fuelCost: 1, load: 0 }), 0, 0, 100, 0, false);
    const colors = strokeSpy.mock.calls.map(([style]) => strokeColor(style));
    expect(colors.length).toBeGreaterThan(0);
    for (const color of colors) {
      expect(color).toBe(LANE_LOAD_COLOR.idle);
      expect(color).not.toBe(LANE_LOAD_COLOR.blocked);
    }
  });

  it("colours a blocked lane red regardless of fuel tier", () => {
    const strokeSpy = vi.spyOn(Graphics.prototype, "stroke");
    const object = new ConnectionObject();
    object.update(conn({ fuelCost: 1, blocked: true }), 0, 0, 100, 0, false);
    const colors = strokeSpy.mock.calls.map(([style]) => strokeColor(style));
    expect(colors.every((c) => c === LANE_LOAD_COLOR.blocked)).toBe(true);
  });

  it("adds a copper highlight pass when selected", () => {
    const strokeSpy = vi.spyOn(Graphics.prototype, "stroke");
    const notSelected = new ConnectionObject();
    notSelected.update(conn({ fuelCost: 1 }), 0, 0, 100, 0, false);
    const unselectedCount = strokeSpy.mock.calls.length;
    strokeSpy.mockClear();

    const selected = new ConnectionObject();
    selected.update(conn({ fuelCost: 1 }), 0, 0, 100, 0, true);
    const colors = strokeSpy.mock.calls.map(([style]) => strokeColor(style));
    expect(strokeSpy.mock.calls.length).toBe(unselectedCount + 1);
    expect(colors).toContain(LANE_SELECTED.color);
  });

  it("skips redraw (dirty-checked) when the same connection id updates with unchanged style", () => {
    const object = new ConnectionObject();
    object.update(conn({ fuelCost: 25 }), 0, 0, 100, 0, false);
    const clearSpy = vi.spyOn(Graphics.prototype, "clear");
    object.update(conn({ fuelCost: 25 }), 0, 0, 100, 0, false);
    expect(clearSpy).not.toHaveBeenCalled();
  });

  it("redraws when the fuel tier changes for the same connection id", () => {
    const object = new ConnectionObject();
    object.update(conn({ fuelCost: 1 }), 0, 0, 100, 0, false);
    const clearSpy = vi.spyOn(Graphics.prototype, "clear");
    object.update(conn({ fuelCost: 25 }), 0, 0, 100, 0, false);
    expect(clearSpy).toHaveBeenCalled();
  });

  it("redraws when selection state changes for the same connection id and style", () => {
    const object = new ConnectionObject();
    object.update(conn({ fuelCost: 1 }), 0, 0, 100, 0, false);
    const clearSpy = vi.spyOn(Graphics.prototype, "clear");
    object.update(conn({ fuelCost: 1 }), 0, 0, 100, 0, true);
    expect(clearSpy).toHaveBeenCalled();
  });
});
