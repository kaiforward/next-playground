import { describe, it, expect } from "vitest";
import { formatNumber, formatHeadcount, formatHeadcountShort } from "../format";

describe("formatNumber", () => {
  it("rounds to the nearest integer", () => {
    // strip locale separators so the assertion is locale-independent
    expect(formatNumber(1234.7).replace(/\D/g, "")).toBe("1235");
    expect(formatNumber(1234.4).replace(/\D/g, "")).toBe("1234");
  });
  it("groups thousands", () => {
    expect(formatNumber(4210)).toMatch(/^4\D?210$/);
  });
  it("renders zero (e.g. an uninhabited system's population)", () => {
    expect(formatNumber(0)).toBe("0");
  });
});

describe("formatHeadcount", () => {
  it("scales abstract units to a realistic headcount", () => {
    // 1 unit = 1,000,000 people; the Float's fraction supplies the low digits.
    expect(formatHeadcount(141.763123).replace(/\D/g, "")).toBe("141763123");
  });
  it("groups thousands with separators", () => {
    expect(formatHeadcount(141.763123)).toMatch(/^141\D763\D123$/);
  });
  it("renders zero for an empty system", () => {
    expect(formatHeadcount(0)).toBe("0");
  });
  it("handles large (billions) values — display-only, never written to Prisma", () => {
    expect(formatHeadcount(3400).replace(/\D/g, "")).toBe("3400000000");
  });
});

describe("formatHeadcountShort", () => {
  it("rounds to a whole unit before scaling (141.8 -> 142M)", () => {
    expect(formatHeadcountShort(141.8)).toBe("142M");
  });
  it("formats billions with at most one fractional digit", () => {
    expect(formatHeadcountShort(3400)).toBe("3.4B");
  });
  it("renders zero", () => {
    expect(formatHeadcountShort(0)).toBe("0");
  });
});
