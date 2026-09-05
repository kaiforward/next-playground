import { describe, it, expect, vi, afterEach } from "vitest";
import { Graphics } from "pixi.js";
import type { StrokeInput } from "pixi.js";
import { ConnectionObject, type ConnectionState } from "../connection-object";
import { LANE_BASE_COLOR, LANE_HOVERED, LANE_MODE, LANE_SELECTED } from "../../theme";
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

const NOT_HOVERED: ConnectionState = { selected: false, hovered: false, mode: "base", factionColor: null };

function lanesState(overrides: Partial<ConnectionState> = {}): ConnectionState {
  return { selected: false, hovered: false, mode: "lanes", factionColor: null, ...overrides };
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
    selected.update(conn({ fuelCost: 1 }), 0, 0, 100, 0, { ...NOT_HOVERED, selected: true });
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
    hovered.update(conn({ fuelCost: 1 }), 0, 0, 100, 0, { ...NOT_HOVERED, hovered: true });
    const colors = strokeSpy.mock.calls.map(([style]) => strokeColor(style));
    expect(strokeSpy.mock.calls.length).toBe(unhoveredCount + 1);
    expect(colors).toContain(LANE_HOVERED.color);
    expect(LANE_HOVERED.color).not.toBe(LANE_SELECTED.color);
  });

  it("removes the hover pass again when un-hovered, and the fingerprint change forces the redraw", () => {
    const object = new ConnectionObject();
    object.update(conn({ fuelCost: 1 }), 0, 0, 100, 0, { ...NOT_HOVERED, hovered: true });
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
    object.update(conn({ fuelCost: 1 }), 0, 0, 100, 0, { ...NOT_HOVERED, selected: true });
    expect(clearSpy).toHaveBeenCalled();
  });

  it("redraws when hover state changes for the same connection id and style (fingerprint is live)", () => {
    const object = new ConnectionObject();
    object.update(conn({ fuelCost: 1 }), 0, 0, 100, 0, NOT_HOVERED);
    const clearSpy = vi.spyOn(Graphics.prototype, "clear");
    object.update(conn({ fuelCost: 1 }), 0, 0, 100, 0, { selected: false, hovered: true, mode: "base", factionColor: null });
    expect(clearSpy).toHaveBeenCalled();
  });
});

describe("ConnectionObject.update — Lanes map mode", () => {
  it("draws a lane with no investor dashed, in the base slate colour", () => {
    const moveToSpy = vi.spyOn(Graphics.prototype, "moveTo");
    const strokeSpy = vi.spyOn(Graphics.prototype, "stroke");
    const object = new ConnectionObject();
    object.update(
      conn({ fuelCost: 1, investorFactionId: null }),
      0, 0, 100, 0,
      lanesState({ factionColor: null }),
    );
    // A dashed lane moves to many short segment starts (one per dash); a solid lane moves once.
    expect(moveToSpy.mock.calls.length).toBeGreaterThan(1);
    const colors = strokeSpy.mock.calls.map(([style]) => strokeColor(style));
    expect(colors.every((c) => c === LANE_BASE_COLOR)).toBe(true);
  });

  it("the same lane WITH an investor draws solid, in that faction's colour", () => {
    const strokeSpy = vi.spyOn(Graphics.prototype, "stroke");
    const object = new ConnectionObject();
    object.update(
      conn({ fuelCost: 1, investorFactionId: "f1" }),
      0, 0, 100, 0,
      lanesState({ factionColor: 0x22cc44 }),
    );
    // Solid draws exactly one pass (no selection/hover underlay in this test).
    expect(strokeSpy.mock.calls).toHaveLength(1);
    expect(strokeColor(strokeSpy.mock.calls[0]?.[0])).toBe(0x22cc44);
  });

  it("a level-3 lane draws wider than a level-0 lane in mode style", () => {
    function widthOf(level: number): number {
      const strokeSpy = vi.spyOn(Graphics.prototype, "stroke");
      const object = new ConnectionObject();
      object.update(
        conn({ fuelCost: 1, investorFactionId: "f1", level }),
        0, 0, 100, 0,
        lanesState({ factionColor: 0x22cc44 }),
      );
      const style = strokeSpy.mock.calls[0]?.[0];
      strokeSpy.mockRestore();
      if (typeof style !== "object" || style === null || !("width" in style) || typeof style.width !== "number") {
        throw new Error("expected a numeric stroke width");
      }
      return style.width;
    }
    expect(widthOf(3)).toBeGreaterThan(widthOf(0));
  });

  it("redraws when the mode changes for the same connection id, position and band", () => {
    const object = new ConnectionObject();
    object.update(conn({ fuelCost: 1, investorFactionId: "f1" }), 0, 0, 100, 0, NOT_HOVERED);
    const clearSpy = vi.spyOn(Graphics.prototype, "clear");
    object.update(
      conn({ fuelCost: 1, investorFactionId: "f1" }),
      0, 0, 100, 0,
      lanesState({ factionColor: 0x22cc44 }),
    );
    expect(clearSpy).toHaveBeenCalled();
  });
});

describe("ConnectionObject.setPulseAlpha — the congested overlay, on its own Graphics child", () => {
  it("strokes the pulse colour on its own child without re-stroking the base line", () => {
    const object = new ConnectionObject();
    object.update(
      conn({ fuelCost: 1, investorFactionId: "f1", band: "congested" }),
      0, 0, 100, 0,
      lanesState({ factionColor: 0x22cc44 }),
    );
    const strokeSpy = vi.spyOn(Graphics.prototype, "stroke");
    object.setPulseAlpha(0.6);
    expect(strokeSpy.mock.calls).toHaveLength(1);
    const style = strokeSpy.mock.calls[0]?.[0];
    if (typeof style !== "object" || style === null || !("color" in style) || !("alpha" in style)) {
      throw new Error("expected an object stroke style");
    }
    expect(style.color).toBe(LANE_MODE.pulseColor);
    expect(style.alpha).toBe(0.6);
  });

  it("clears the overlay at alpha 0 without stroking", () => {
    const object = new ConnectionObject();
    object.update(
      conn({ fuelCost: 1, investorFactionId: "f1", band: "congested" }),
      0, 0, 100, 0,
      lanesState({ factionColor: 0x22cc44 }),
    );
    object.setPulseAlpha(0.6);
    const clearSpy = vi.spyOn(Graphics.prototype, "clear");
    const strokeSpy = vi.spyOn(Graphics.prototype, "stroke");
    object.setPulseAlpha(0);
    expect(clearSpy).toHaveBeenCalled();
    expect(strokeSpy).not.toHaveBeenCalled();
  });
});
