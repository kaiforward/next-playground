import { describe, it, expect, vi, afterEach } from "vitest";
import { Graphics } from "pixi.js";
import type { StrokeInput } from "pixi.js";
import { ConnectionObject } from "../connection-object";
import { EDGE } from "../../theme";
import type { ConnectionData } from "@/lib/hooks/use-map-data";

function conn(isCrossing: boolean): ConnectionData {
  return { id: "a-b", fromId: "a", toId: "b", fuelCost: 1, isCrossing };
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

describe("ConnectionObject.update — crossing-class styling", () => {
  it("strokes the crossing glow+core colours when the connection is crossing-class", () => {
    const strokeSpy = vi.spyOn(Graphics.prototype, "stroke");
    const object = new ConnectionObject();
    object.update(conn(true), 0, 0, 100, 0);
    const colors = strokeSpy.mock.calls.map(([style]) => strokeColor(style));
    expect(colors).toEqual([EDGE.crossingGlow.color, EDGE.crossing.color]);
  });

  it("strokes the default dashed colour, never the crossing colour, for an ordinary lane", () => {
    const strokeSpy = vi.spyOn(Graphics.prototype, "stroke");
    const object = new ConnectionObject();
    object.update(conn(false), 0, 0, 100, 0);
    const colors = strokeSpy.mock.calls.map(([style]) => strokeColor(style));
    expect(colors.length).toBeGreaterThan(0);
    for (const color of colors) {
      expect(color).toBe(EDGE.default.color);
      expect(color).not.toBe(EDGE.crossing.color);
    }
  });

  it("skips redraw (dirty-checked) when the same connection id updates with an unchanged isCrossing", () => {
    const object = new ConnectionObject();
    object.update(conn(true), 0, 0, 100, 0);
    const clearSpy = vi.spyOn(Graphics.prototype, "clear");
    object.update(conn(true), 0, 0, 100, 0);
    expect(clearSpy).not.toHaveBeenCalled();
  });

  it("redraws when isCrossing flips for the same connection id", () => {
    const object = new ConnectionObject();
    object.update(conn(false), 0, 0, 100, 0);
    const clearSpy = vi.spyOn(Graphics.prototype, "clear");
    object.update(conn(true), 0, 0, 100, 0);
    expect(clearSpy).toHaveBeenCalled();
  });
});
