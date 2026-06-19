import { describe, it, expect } from "vitest";
import { GOOD_COLORS, getGoodColor } from "../ui";
import { GOOD_NAMES, GOODS } from "../goods";

describe("GOOD_COLORS coverage", () => {
  it("has a chart color for every good", () => {
    for (const goodId of GOOD_NAMES) {
      expect(GOOD_COLORS[goodId], `color: ${goodId}`).toBeDefined();
    }
  });

  it("defines no colors for goods that do not exist", () => {
    const known = new Set(GOOD_NAMES);
    for (const goodId of Object.keys(GOOD_COLORS)) {
      expect(known.has(goodId), `stray color key: ${goodId}`).toBe(true);
    }
  });
});

describe("getGoodColor", () => {
  it("resolves a good's color by display name", () => {
    expect(getGoodColor(GOODS.water.name)).toBe(GOOD_COLORS.water);
  });

  it("falls back to a neutral gray for an unknown good name", () => {
    expect(getGoodColor("Nonexistent Good")).toBe("#6b7280");
  });
});
