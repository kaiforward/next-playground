import { describe, it, expect } from "vitest";
import {
  PRESETS,
  overlaysForPreset,
  presetForOverlays,
} from "../map-presets";

const base = {
  fleet: false,
  events: false,
  priceHeatmap: false,
  tradeFlow: false,
  shipRoutes: false,
};

describe("map presets", () => {
  it("Default preset = fleet + events", () => {
    expect(overlaysForPreset("default")).toEqual({
      ...base,
      fleet: true,
      events: true,
    });
  });

  it("Trader preset = price + events", () => {
    expect(overlaysForPreset("trader")).toEqual({
      ...base,
      priceHeatmap: true,
      events: true,
    });
  });

  it("Navigator preset = fleet + ship routes", () => {
    expect(overlaysForPreset("navigator")).toEqual({
      ...base,
      fleet: true,
      shipRoutes: true,
    });
  });

  it("round-trips a known preset", () => {
    expect(presetForOverlays(overlaysForPreset("navigator"))).toBe("navigator");
  });

  it("falls back to custom for an unmatched set", () => {
    expect(presetForOverlays({ ...base, fleet: true, tradeFlow: true })).toBe(
      "custom",
    );
  });

  it("exposes presets in panel order with custom last", () => {
    expect(PRESETS).toEqual(["default", "trader", "navigator", "custom"]);
  });
});
