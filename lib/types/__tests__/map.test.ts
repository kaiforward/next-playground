import { describe, it, expect } from "vitest";
import { isMapMode, MAP_MODES } from "@/lib/types/map";

describe("MapMode", () => {
  it("includes the territory modes in the mode set and ordering", () => {
    expect(MAP_MODES).toEqual(["political", "stability", "population", "development", "none"]);
    expect(isMapMode("political")).toBe(true);
    expect(isMapMode("stability")).toBe(true);
    expect(isMapMode("population")).toBe(true);
    expect(isMapMode("development")).toBe(true);
    expect(isMapMode("none")).toBe(true);
  });
  it("rejects unknown modes", () => {
    expect(isMapMode("bogus")).toBe(false);
    expect(isMapMode("prosperity")).toBe(false);
    expect(isMapMode("regions")).toBe(false);
  });
});
