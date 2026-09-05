import { describe, it, expect, vi, afterEach } from "vitest";
import { Graphics } from "pixi.js";
import type { StrokeInput } from "pixi.js";
import { ConnectionObject } from "../connection-object";
import { LANE_BASE_COLOR, LANE_HOVERED, LANE_SELECTED } from "../../theme";
import type { ConnectionData } from "@/lib/hooks/use-map-data";

function conn(overrides: Partial<ConnectionData> & { fuelCost: number }): ConnectionData {
  return {
    id: "a-b",
    fromId: "a",
    toId: "b",
    laneKey: "a|b",
    level: 0,
    load: 0,
    blocked: false,
    investorFactionId: null,
    band: "fine",
    ...overrides,
  };
}

const NOT_HOVERED = { selected: false, hovered: false };

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

describe("ConnectionObject.update — base lane layer", () => {
  it("strokes exactly one pass, in the base colour, for an ordinary lane with no selection or hover", () => {
    const strokeSpy = vi.spyOn(Graphics.prototype, "stroke");
    const object = new ConnectionObject();
    object.update(conn({ fuelCost: 1 }), 0, 0, 100, 0, NOT_HOVERED);
    expect(strokeSpy.mock.calls).toHaveLength(1);
    expect(strokeColor(strokeSpy.mock.calls[0]?.[0])).toBe(LANE_BASE_COLOR);
  });

  it("strokes the same base colour for a major-tier lane, load 1, and blocked — colour never reads load/tier", () => {
    const strokeSpy = vi.spyOn(Graphics.prototype, "stroke");
    const major = new ConnectionObject();
    major.update(conn({ fuelCost: 25 }), 0, 0, 100, 0, NOT_HOVERED);
    const loaded = new ConnectionObject();
    loaded.update(conn({ fuelCost: 1, load: 1 }), 0, 0, 100, 0, NOT_HOVERED);
    const blocked = new ConnectionObject();
    blocked.update(conn({ fuelCost: 1, blocked: true }), 0, 0, 100, 0, NOT_HOVERED);
    const colors = strokeSpy.mock.calls.map(([style]) => strokeColor(style));
    expect(colors.every((c) => c === LANE_BASE_COLOR)).toBe(true);
  });

  it("adds a copper highlight pass when selected", () => {
    const strokeSpy = vi.spyOn(Graphics.prototype, "stroke");
    const notSelected = new ConnectionObject();
    notSelected.update(conn({ fuelCost: 1 }), 0, 0, 100, 0, NOT_HOVERED);
    const unselectedCount = strokeSpy.mock.calls.length;
    strokeSpy.mockClear();

    const selected = new ConnectionObject();
    selected.update(conn({ fuelCost: 1 }), 0, 0, 100, 0, { selected: true, hovered: false });
    const colors = strokeSpy.mock.calls.map(([style]) => strokeColor(style));
    expect(strokeSpy.mock.calls.length).toBe(unselectedCount + 1);
    expect(colors).toContain(LANE_SELECTED.color);
  });

  it("adds a hover highlight pass when hovered, distinct from the selection colour", () => {
    const strokeSpy = vi.spyOn(Graphics.prototype, "stroke");
    const notHovered = new ConnectionObject();
    notHovered.update(conn({ fuelCost: 1 }), 0, 0, 100, 0, NOT_HOVERED);
    const unhoveredCount = strokeSpy.mock.calls.length;
    strokeSpy.mockClear();

    const hovered = new ConnectionObject();
    hovered.update(conn({ fuelCost: 1 }), 0, 0, 100, 0, { selected: false, hovered: true });
    const colors = strokeSpy.mock.calls.map(([style]) => strokeColor(style));
    expect(strokeSpy.mock.calls.length).toBe(unhoveredCount + 1);
    expect(colors).toContain(LANE_HOVERED.color);
    expect(LANE_HOVERED.color).not.toBe(LANE_SELECTED.color);
  });

  it("removes the hover pass again when un-hovered, and the fingerprint change forces the redraw", () => {
    const object = new ConnectionObject();
    object.update(conn({ fuelCost: 1 }), 0, 0, 100, 0, { selected: false, hovered: true });
    const clearSpy = vi.spyOn(Graphics.prototype, "clear");
    const strokeSpy = vi.spyOn(Graphics.prototype, "stroke");
    object.update(conn({ fuelCost: 1 }), 0, 0, 100, 0, NOT_HOVERED);
    expect(clearSpy).toHaveBeenCalled();
    const colors = strokeSpy.mock.calls.map(([style]) => strokeColor(style));
    expect(colors).not.toContain(LANE_HOVERED.color);
  });

  it("skips redraw (dirty-checked) when the same connection id updates with unchanged style", () => {
    const object = new ConnectionObject();
    object.update(conn({ fuelCost: 25 }), 0, 0, 100, 0, NOT_HOVERED);
    const clearSpy = vi.spyOn(Graphics.prototype, "clear");
    object.update(conn({ fuelCost: 25 }), 0, 0, 100, 0, NOT_HOVERED);
    expect(clearSpy).not.toHaveBeenCalled();
  });

  it("redraws when the fuel tier changes for the same connection id", () => {
    const object = new ConnectionObject();
    object.update(conn({ fuelCost: 1 }), 0, 0, 100, 0, NOT_HOVERED);
    const clearSpy = vi.spyOn(Graphics.prototype, "clear");
    object.update(conn({ fuelCost: 25 }), 0, 0, 100, 0, NOT_HOVERED);
    expect(clearSpy).toHaveBeenCalled();
  });

  it("redraws when selection state changes for the same connection id and style", () => {
    const object = new ConnectionObject();
    object.update(conn({ fuelCost: 1 }), 0, 0, 100, 0, NOT_HOVERED);
    const clearSpy = vi.spyOn(Graphics.prototype, "clear");
    object.update(conn({ fuelCost: 1 }), 0, 0, 100, 0, { selected: true, hovered: false });
    expect(clearSpy).toHaveBeenCalled();
  });

  it("redraws when hover state changes for the same connection id and style (fingerprint is live)", () => {
    const object = new ConnectionObject();
    object.update(conn({ fuelCost: 1 }), 0, 0, 100, 0, NOT_HOVERED);
    const clearSpy = vi.spyOn(Graphics.prototype, "clear");
    object.update(conn({ fuelCost: 1 }), 0, 0, 100, 0, { selected: false, hovered: true });
    expect(clearSpy).toHaveBeenCalled();
  });
});
