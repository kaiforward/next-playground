import { describe, it, expect } from "vitest";
import { formatNumber } from "../format";

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
