import { describe, it, expect } from "vitest";
import { isMapMode, MAP_MODES } from "@/lib/types/map";

describe("MapMode prosperity", () => {
  it("includes prosperity in the mode set and ordering", () => {
    expect(MAP_MODES).toContain("prosperity");
    expect(isMapMode("prosperity")).toBe(true);
  });
  it("rejects unknown modes", () => {
    expect(isMapMode("bogus")).toBe(false);
  });
});
