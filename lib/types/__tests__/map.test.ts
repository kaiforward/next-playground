import { describe, it, expect } from "vitest";
import { isMapMode, isValueMapMode, MAP_MODES } from "@/lib/types/map";

describe("MapMode", () => {
  it("includes the territory modes in the mode set and ordering", () => {
    expect(MAP_MODES).toEqual(["political", "regions", "stability", "population", "development", "none"]);
    expect(isMapMode("political")).toBe(true);
    expect(isMapMode("regions")).toBe(true);
    expect(isMapMode("stability")).toBe(true);
    expect(isMapMode("population")).toBe(true);
    expect(isMapMode("development")).toBe(true);
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
  });
  it("is false for the topology / off modes", () => {
    expect(isValueMapMode("political")).toBe(false);
    expect(isValueMapMode("regions")).toBe(false);
    expect(isValueMapMode("none")).toBe(false);
  });
});
