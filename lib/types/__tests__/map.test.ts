import { describe, it, expect } from "vitest";
import { isMapMode, isValueMapMode, isFactionInteractiveMode, MAP_MODES } from "@/lib/types/map";

describe("MapMode", () => {
  it("includes the territory modes in the mode set and ordering", () => {
    expect(MAP_MODES).toEqual([
      "political", "regions", "stability", "population", "development", "migration", "none",
    ]);
    expect(isMapMode("political")).toBe(true);
    expect(isMapMode("regions")).toBe(true);
    expect(isMapMode("stability")).toBe(true);
    expect(isMapMode("population")).toBe(true);
    expect(isMapMode("development")).toBe(true);
    expect(isMapMode("migration")).toBe(true);
    expect(isMapMode("none")).toBe(true);
  });
  it("rejects unknown modes", () => {
    expect(isMapMode("bogus")).toBe(false);
    expect(isMapMode("prosperity")).toBe(false);
  });
});

describe("isValueMapMode", () => {
  it("is true only for the value-choropleth modes", () => {
    expect(isValueMapMode("population")).toBe(true);
    expect(isValueMapMode("stability")).toBe(true);
    expect(isValueMapMode("development")).toBe(true);
    expect(isValueMapMode("migration")).toBe(true);
  });
  it("is false for the topology / off modes", () => {
    expect(isValueMapMode("political")).toBe(false);
    expect(isValueMapMode("regions")).toBe(false);
    expect(isValueMapMode("none")).toBe(false);
  });
});

describe("isFactionInteractiveMode", () => {
  it("is true for the modes that show faction territory (political + the value modes)", () => {
    // Political opens the faction panel; the value modes also re-scope the gradient to the faction.
    expect(isFactionInteractiveMode("political")).toBe(true);
    expect(isFactionInteractiveMode("population")).toBe(true);
    expect(isFactionInteractiveMode("stability")).toBe(true);
    expect(isFactionInteractiveMode("development")).toBe(true);
    expect(isFactionInteractiveMode("migration")).toBe(true);
  });
  it("is false for modes with no faction territory (a zoomed-out click falls through to the system)", () => {
    expect(isFactionInteractiveMode("regions")).toBe(false);
    expect(isFactionInteractiveMode("none")).toBe(false);
  });
});
