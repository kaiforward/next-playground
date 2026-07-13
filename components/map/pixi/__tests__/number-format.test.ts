import { describe, it, expect } from "vitest";
import { formatValueNumber } from "@/components/map/pixi/number-format";

describe("formatValueNumber", () => {
  describe("population — SI-ish counts", () => {
    it("renders sub-thousands as a whole number", () => {
      expect(formatValueNumber(0, "population")).toBe("0");
      expect(formatValueNumber(742.6, "population")).toBe("743");
    });
    it("renders thousands with a K suffix (rounded)", () => {
      expect(formatValueNumber(1_000, "population")).toBe("1K");
      expect(formatValueNumber(12_500, "population")).toBe("13K");
    });
    it("renders low millions with one decimal", () => {
      expect(formatValueNumber(1_000_000, "population")).toBe("1.0M");
      expect(formatValueNumber(3_450_000, "population")).toBe("3.5M");
    });
    it("drops the decimal at/above 10M", () => {
      expect(formatValueNumber(10_000_000, "population")).toBe("10M");
      expect(formatValueNumber(12_800_000, "population")).toBe("13M");
    });
  });

  describe("stability — 0..1 score rendered as 0–100", () => {
    it("scales by 100 and rounds", () => {
      expect(formatValueNumber(0.9, "stability")).toBe("90");
      expect(formatValueNumber(1, "stability")).toBe("100");
    });
  });

  describe("development — raw tier-weighted points, rounded", () => {
    it("rounds the raw points value with no scaling", () => {
      expect(formatValueNumber(23.4, "development")).toBe("23");
      expect(formatValueNumber(0.234, "development")).toBe("0");
      expect(formatValueNumber(0, "development")).toBe("0");
      expect(formatValueNumber(142, "development")).toBe("142");
    });
  });
});
